const { configureOwnedPerformanceEnvironment, median } = require('../../../scripts/performance/common');
const { isDeepStrictEqual } = require('node:util');

configureOwnedPerformanceEnvironment();

const { deleteApp, initializeApp, getApps } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const { test, expect } = require('./measured-test');
const manifest = require('../../scenarios.json');
const {
  GRIGLIATA_PLACEMENT_SUBSCRIBE_METRIC_KEY,
  createPageAssetTracker,
  installBootstrap,
  installDeterministicFontRoutes,
  isExpectedDemoRecaptchaCancellation,
  isExpectedDemoRecaptchaReportOnlyWarning,
  isExpectedFivePeerFirestoreWriteTurnover,
  isExpectedFirestoreLifecycleCancellation,
  isKnownDemoFirestoreStartupWarning,
  navigateToCleanup,
  readChangedDocumentDeliveryTelemetry,
  readKonvaTokenPositions,
  readRouteCleanupSummary,
  storageStateForRole,
  waitForKonvaTokenMove,
  waitForReadiness,
  writeScenarioResult,
} = require('./helpers');

const scenario = manifest.scenarios.find((entry) => entry.id === 'grigliata-five-peer');
// Player presence writes keep their Firestore write streams active during sequential setup.
// Mount the DM last so its normal 60-second idle stream shutdown cannot overlap measurement.
const peers = ['player', 'peer-2', 'peer-3', 'peer-4', 'dm'];
const PROBE_TOKEN_ID = 'perf-token-0000';
const PROBE_PLACEMENT_PATH = 'grigliata_token_placements/perf-map__perf-token-0000';
const PROBE_GRID_DELTA_X = 50;
const CLIENT_READINESS_ROUTE = '/__fnd_perf_cleanup__';
const FIVE_PEER_ROUTE_READINESS_TIMEOUT_MS = 30_000;
const FIVE_PEER_TEST_TIMEOUT_MS = 240_000;
const MAX_EXPECTED_ACTIVE_WRITE_TURNOVERS_PER_PEER = 2;
const LEGACY_MIGRATION_MARKER_FIELDS = [
  'legacyTokenPlacementCleanupCompletedAt',
  'legacyPlacementDeadStateCleanupCompletedAt',
  'legacyPlacementVisibilityCleanupCompletedAt',
];
const LEGACY_MIGRATION_MARKER_VALUE = '2026-01-01T00:00:00.000Z';

const enterMeasuredGrigliataRoute = async (page) => {
  await page.goto(CLIENT_READINESS_ROUTE, { waitUntil: 'domcontentloaded' });
  await waitForReadiness(page);
  await page.evaluate((route) => {
    const metadata = window.__FND_PERF__.snapshot().metadata;
    window.__FND_PERF__.reset(metadata);
    window.history.pushState({}, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, scenario.route);
  await waitForReadiness(page, { timeoutMs: FIVE_PEER_ROUTE_READINESS_TIMEOUT_MS });
};

const countRouteResources = (resources, route) => Object.entries(resources || {})
  .filter(([key]) => key.startsWith(`${route}::`))
  .filter(([key]) => !key.startsWith(`${route}::timeout`))
  .reduce((total, [, count]) => total + Number(count || 0), 0);

const waitForRouteCleanup = async ({ page, role }) => {
  try {
    await page.waitForFunction(() => (
      Object.entries(window.__FND_PERF__.snapshot().activeResources || {})
        .filter(([key]) => key.startsWith('/grigliata::'))
        .reduce((total, [, value]) => total + Number(value || 0), 0) === 0
    ), null, { polling: 100, timeout: 10_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const snapshot = window.__FND_PERF__.snapshot();
      return {
        routeState: snapshot.routeState,
        activeResources: Object.fromEntries(
          Object.entries(snapshot.activeResources || {})
            .filter(([key]) => key.startsWith('/grigliata::'))
        ),
        activeListeners: Object.fromEntries(
          Object.entries(snapshot.activeListeners || {})
            .filter(([key]) => key.startsWith('/grigliata::'))
        ),
        activeResourceDiagnostics: (snapshot.activeResourceDiagnostics || [])
          .filter((resource) => resource.ownerRoute === '/grigliata'),
      };
    }).catch((diagnosticError) => ({
      diagnosticError: diagnosticError.message,
    }));
    throw new Error(
      `Five-peer cleanup did not settle for ${role}: ${JSON.stringify(diagnostics)}`,
      { cause: error }
    );
  }

  return readRouteCleanupSummary(page, scenario.route);
};

test('grigliata five-peer placement convergence', async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(FIVE_PEER_TEST_TIMEOUT_MS);
  test.skip(process.env.FND_PERF_SKIP_MULTI === '1', 'Explicitly disabled for a reduced smoke run.');
  const contexts = [];
  const pages = [];
  let placement = null;
  let boardState = null;
  let originalMigrationMarkers = null;
  let app = null;
  let primaryError = null;
  try {
    app = getApps()[0] || initializeApp({ projectId: 'demo-fnd-perf' });
    if (app.options.projectId !== 'demo-fnd-perf') {
      throw new Error(`Five-peer Admin app must use demo-fnd-perf, received ${app.options.projectId || 'unknown'}.`);
    }
    const db = getFirestore(app);
    boardState = db.doc('grigliata_state/current');
    placement = db.doc(PROBE_PLACEMENT_PATH);
    const boardStateSnapshot = await boardState.get();
    if (!boardStateSnapshot.exists) {
      throw new Error('Five-peer fixture is missing grigliata_state/current.');
    }
    const boardStateData = boardStateSnapshot.data();
    originalMigrationMarkers = Object.fromEntries(LEGACY_MIGRATION_MARKER_FIELDS.map((field) => [
      field,
      {
        present: Object.prototype.hasOwnProperty.call(boardStateData, field),
        value: boardStateData[field],
      },
    ]));
    await boardState.set(Object.fromEntries(LEGACY_MIGRATION_MARKER_FIELDS.map((field) => [
      field,
      LEGACY_MIGRATION_MARKER_VALUE,
    ])), { merge: true });

    for (const role of peers) {
      const context = await browser.newContext({ baseURL, storageState: storageStateForRole(role) });
      contexts.push(context);
      await installDeterministicFontRoutes(context);
      await installBootstrap(context, { ...scenario, role }, 1);
      const page = await context.newPage();
      const pageAssets = createPageAssetTracker();
      const diagnostics = {
        consoleErrors: [],
        explainedRecaptchaCancellations: [],
        explainedRecaptchaReportOnlyWarnings: [],
        explainedStartupWarnings: [],
        explainedActiveWriteTurnovers: [],
        explainedCleanupTransportCancellations: [],
        unhandledErrors: [],
        failedRequests: [],
        cleanupStarted: false,
        lifecyclePhase: 'route-navigation',
        ready: false,
      };
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (isKnownDemoFirestoreStartupWarning(text, {
          baseURL,
          beforeReadiness: !diagnostics.ready,
        })) {
          diagnostics.explainedStartupWarnings.push({
            kind: 'firestore-emulator-online-state-startup-timeout',
            phase: 'before-readiness',
            text: text.slice(0, 500),
          });
          return;
        }
        if (isExpectedDemoRecaptchaReportOnlyWarning(text, {baseURL})) {
          diagnostics.explainedRecaptchaReportOnlyWarnings.push(text.slice(0, 500));
          return;
        }
        diagnostics.consoleErrors.push(text.slice(0, 300));
      });
      page.on('request', (request) => pageAssets.begin(request));
      page.on('requestfinished', (request) => pageAssets.complete(request));
      const responseStatuses = new WeakMap();
      page.on('response', (response) => {
        responseStatuses.set(response.request(), response.status());
      });
      page.on('pageerror', (error) => diagnostics.unhandledErrors.push(error.message.slice(0, 300)));
      page.on('requestfailed', (request) => {
        pageAssets.complete(request);
        const failure = {
          resourceType: request.resourceType(),
          failure: request.failure()?.errorText || 'unknown',
          method: request.method(),
          path: new URL(request.url()).pathname,
        };
        if (isExpectedFivePeerFirestoreWriteTurnover({
          ...failure,
          lifecyclePhase: diagnostics.lifecyclePhase,
          responseStatus: responseStatuses.get(request),
          url: request.url(),
        })) {
          diagnostics.explainedActiveWriteTurnovers.push({
            ...failure,
            phase: diagnostics.lifecyclePhase,
            responseStatus: responseStatuses.get(request),
          });
          return;
        }
        if (isExpectedFirestoreLifecycleCancellation({
          ...failure,
          lifecyclePhase: diagnostics.lifecyclePhase,
          url: request.url(),
        })) {
          diagnostics.explainedCleanupTransportCancellations.push({
            ...failure,
            phase: 'route-cleanup',
          });
          return;
        }
        if (isExpectedDemoRecaptchaCancellation({
          ...failure,
          lifecyclePhase: diagnostics.lifecyclePhase,
          url: request.url(),
        })) {
          diagnostics.explainedRecaptchaCancellations.push({
            ...failure,
            phase: diagnostics.lifecyclePhase,
          });
          return;
        }
        diagnostics.failedRequests.push(failure);
      });
      pages.push({ page, role, diagnostics });
      try {
        await enterMeasuredGrigliataRoute(page);
        diagnostics.lifecyclePhase = 'route-active';
      } catch (error) {
        throw new Error(`Five-peer readiness failed for ${role}: ${error.message}`, { cause: error });
      }
      await expect.poll(
        () => pageAssets.isQuiet(),
        {
          timeout: 10_000,
          message: `Finite page assets did not settle before five-peer measurement for ${role}.`,
        }
      ).toBe(true);
      diagnostics.ready = true;
    }

    const startingPositions = await Promise.all(pages.map(async ({ page, role }) => {
      const positions = await readKonvaTokenPositions(page, PROBE_TOKEN_ID);
      expect(positions, `${role}: expected one rendered ${PROBE_TOKEN_ID} node`).toHaveLength(1);
      return positions[0];
    }));

    const runProbeTransition = async ({
      col,
      updatedAt,
      fromPositions,
      deltaX,
      label,
    }) => {
      const beforeTelemetry = await Promise.all(pages.map(({ page }) => (
        readChangedDocumentDeliveryTelemetry(
          page,
          GRIGLIATA_PLACEMENT_SUBSCRIBE_METRIC_KEY
        )
      )));
      const startedAt = Date.now();
      await placement.update({ col, updatedAt });
      await Promise.all(pages.map(({ page }, index) => waitForKonvaTokenMove(page, {
        tokenId: PROBE_TOKEN_ID,
        from: fromPositions[index],
        deltaX,
        deltaY: 0,
      })));
      const durationMs = Date.now() - startedAt;
      const serverPlacement = (await placement.get()).data();
      expect(serverPlacement?.col, `${label}: server placement column`).toBe(col);
      expect(serverPlacement?.updatedAt, `${label}: server placement timestamp`).toBe(updatedAt);
      const afterTelemetry = await Promise.all(pages.map(({ page }) => (
        readChangedDocumentDeliveryTelemetry(
          page,
          GRIGLIATA_PLACEMENT_SUBSCRIBE_METRIC_KEY
        )
      )));
      const deliveriesByPeer = afterTelemetry.map((telemetry, index) => (
        telemetry.changedDocumentsDelivered
        - beforeTelemetry[index].changedDocumentsDelivered
      ));
      deliveriesByPeer.forEach((delivered, index) => {
        expect(delivered, `${label}/${pages[index].role}: expected one probe placement delivery`).toBe(1);
      });
      return {
        col,
        updatedAt,
        fromPositions,
        deltaX,
        label,
        deliveriesByPeer,
        durationMs,
        nextPositions: fromPositions.map(({ x, y }) => ({ x: x + deltaX, y })),
        eventCounts: afterTelemetry.map(({ eventCount }) => eventCount),
      };
    };

    const warmupForward = await runProbeTransition({
      col: 1,
      updatedAt: '2026-01-01T00:00:00.250Z',
      fromPositions: startingPositions,
      deltaX: PROBE_GRID_DELTA_X,
      label: 'warmup-forward',
    });
    const warmupReverse = await runProbeTransition({
      col: 0,
      updatedAt: '2026-01-01T00:00:00.000Z',
      fromPositions: warmupForward.nextPositions,
      deltaX: -PROBE_GRID_DELTA_X,
      label: 'warmup-reverse',
    });
    const measuredTransitions = [];
    let measuredPositions = warmupReverse.nextPositions;
    for (const probe of [
      {
        col: 1,
        updatedAt: '2026-01-01T00:00:01.000Z',
        deltaX: PROBE_GRID_DELTA_X,
        label: 'measured-1',
      },
      {
        col: 0,
        updatedAt: '2026-01-01T00:00:02.000Z',
        deltaX: -PROBE_GRID_DELTA_X,
        label: 'measured-2',
      },
      {
        col: 1,
        updatedAt: '2026-01-01T00:00:03.000Z',
        deltaX: PROBE_GRID_DELTA_X,
        label: 'measured-3',
      },
    ]) {
      const transition = await runProbeTransition({
        ...probe,
        fromPositions: measuredPositions,
      });
      measuredTransitions.push(transition);
      measuredPositions = transition.nextPositions;
    }
    const observedPlacementChangeEvents = measuredTransitions.map(({ deliveriesByPeer }) => (
      deliveriesByPeer.reduce((total, value) => total + value, 0)
    ));
    observedPlacementChangeEvents.forEach((observed, index) => {
      expect(observed, `measured-${index + 1}: placement deliveries`).toBe(pages.length);
    });
    for (const { role, diagnostics } of pages) {
      expect(diagnostics.consoleErrors, `${role}: ${diagnostics.consoleErrors.join('\n')}`).toHaveLength(0);
      expect(diagnostics.unhandledErrors, `${role}: ${diagnostics.unhandledErrors.join('\n')}`).toHaveLength(0);
      expect(diagnostics.failedRequests, `${role}: ${JSON.stringify(diagnostics.failedRequests)}`).toHaveLength(0);
      expect(
        diagnostics.explainedActiveWriteTurnovers.length,
        `${role}: ${JSON.stringify(diagnostics.explainedActiveWriteTurnovers)}`
      ).toBeLessThanOrEqual(MAX_EXPECTED_ACTIVE_WRITE_TURNOVERS_PER_PEER);
    }
    const explainedStartupWarnings = pages.flatMap(({ role, diagnostics }) => (
      diagnostics.explainedStartupWarnings.map((entry) => ({ role, ...entry }))
    ));
    expect(
      explainedStartupWarnings.length,
      JSON.stringify(explainedStartupWarnings)
    ).toBe(0);
    const cleanupSnapshots = [];
    for (const { diagnostics } of pages) {
      diagnostics.cleanupStarted = true;
      diagnostics.lifecyclePhase = 'route-cleanup';
    }
    for (const { page, role } of pages) {
      await navigateToCleanup(page);
      cleanupSnapshots.push(await waitForRouteCleanup({ page, role }));
    }
    const leakedRouteListeners = cleanupSnapshots.reduce((total, snapshot) => (
      total + Object.entries(snapshot.activeListeners || {})
        .filter(([key]) => key.startsWith('/grigliata::'))
        .reduce((sum, [, count]) => sum + Number(count || 0), 0)
    ), 0);
    const leakedRouteResources = cleanupSnapshots.reduce((total, snapshot) => (
      total + countRouteResources(snapshot.activeResources, scenario.route)
    ), 0);
    const pendingRouteTimeouts = cleanupSnapshots.reduce((total, snapshot) => (
      total + Object.entries(snapshot.activeResources || {})
        .filter(([key]) => key.startsWith(`${scenario.route}::timeout`))
        .reduce((sum, [, count]) => sum + Number(count || 0), 0)
    ), 0);
    const activeMediaAfterCleanup = cleanupSnapshots.reduce((total, snapshot) => (
      total + Number(snapshot.media?.activeSources || 0)
    ), 0);
    expect(leakedRouteListeners).toBe(0);
    expect(leakedRouteResources).toBe(0);
    expect(pendingRouteTimeouts).toBe(0);
    expect(activeMediaAfterCleanup).toBe(0);
    for (const { role, diagnostics } of pages) {
      expect(diagnostics.consoleErrors, `${role}: ${diagnostics.consoleErrors.join('\n')}`).toHaveLength(0);
      expect(diagnostics.unhandledErrors, `${role}: ${diagnostics.unhandledErrors.join('\n')}`).toHaveLength(0);
      expect(diagnostics.failedRequests, `${role}: ${JSON.stringify(diagnostics.failedRequests)}`).toHaveLength(0);
      expect(
        diagnostics.explainedCleanupTransportCancellations.length,
        `${role}: ${JSON.stringify(diagnostics.explainedCleanupTransportCancellations)}`
      ).toBeLessThanOrEqual(2);
    }
    const convergenceMs = median(measuredTransitions.map(({ durationMs }) => durationMs));
    const finalMeasuredTransition = measuredTransitions[measuredTransitions.length - 1];
    writeScenarioResult(scenario, 1, {
      environment: {
        projectName: testInfo.project.name,
        browserName: testInfo.project.use.browserName || testInfo.project.name,
        browserVersion: browser.version(),
      },
      metrics: {
        'runtime.peerConvergenceMs': convergenceMs,
        'runtime.consoleErrors': pages.reduce((total, peer) => (
          total + peer.diagnostics.consoleErrors.length
        ), 0),
        'runtime.explainedFirestoreEmulatorStartupWarnings': explainedStartupWarnings.length,
        'runtime.unhandledErrors': pages.reduce((total, peer) => (
          total + peer.diagnostics.unhandledErrors.length
        ), 0),
        'runtime.failedRequests': pages.reduce((total, peer) => (
          total + peer.diagnostics.failedRequests.length
        ), 0),
        'firestore.activeListenersAfterCleanup': leakedRouteListeners,
        'runtime.activeResourcesAfterCleanup': leakedRouteResources,
        'runtime.activeTimeoutsAfterCleanup': pendingRouteTimeouts,
        'runtime.activeMediaAfterCleanup': activeMediaAfterCleanup,
        'firestore.changedDocumentsDelivered': pages.length,
      },
      eventCount: finalMeasuredTransition.eventCounts
        .reduce((total, eventCount) => total + eventCount, 0),
      readiness: { 'shell-visible': true, 'data-ready': true, interactive: true },
      peerCount: pages.length,
      diagnostics: {
        peers: pages.map(({ role, diagnostics }) => ({ role, ...diagnostics })),
        explainedStartupWarnings,
        warmup: {
          forwardDurationMs: warmupForward.durationMs,
          reverseDurationMs: warmupReverse.durationMs,
          forwardDeliveriesByPeer: Object.fromEntries(pages.map(({ role }, peerIndex) => [
            role,
            warmupForward.deliveriesByPeer[peerIndex],
          ])),
          reverseDeliveriesByPeer: Object.fromEntries(pages.map(({ role }, peerIndex) => [
            role,
            warmupReverse.deliveriesByPeer[peerIndex],
          ])),
        },
        convergenceMedianMs: convergenceMs,
        measuredTransitions: measuredTransitions.map((transition, index) => ({
          iteration: index + 1,
          label: transition.label,
          col: transition.col,
          updatedAt: transition.updatedAt,
          fromPositions: transition.fromPositions,
          deltaX: transition.deltaX,
          durationMs: transition.durationMs,
          observedPlacementChangeEvents: observedPlacementChangeEvents[index],
          placementDeliveriesByPeer: Object.fromEntries(pages.map(({ role }, peerIndex) => [
            role,
            transition.deliveriesByPeer[peerIndex],
          ])),
        })),
        placementProbe: {
          path: PROBE_PLACEMENT_PATH,
          tokenId: PROBE_TOKEN_ID,
          startingPositions,
          deltaY: 0,
        },
      },
    });
  } catch (error) {
    primaryError = error;
  }

  const cleanupErrors = [];
  for (const context of contexts) {
    try {
      await context.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (placement) {
    try {
      await placement.update({ col: 0, updatedAt: '2026-01-01T00:00:00.000Z' });
      const restored = (await placement.get()).data();
      if (restored?.col !== 0 || restored?.updatedAt !== '2026-01-01T00:00:00.000Z') {
        throw new Error(`Five-peer placement restoration did not persist: ${JSON.stringify(restored)}`);
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (boardState && originalMigrationMarkers) {
    try {
      const restoration = Object.fromEntries(Object.entries(originalMigrationMarkers).map(([field, original]) => [
        field,
        original.present ? original.value : FieldValue.delete(),
      ]));
      await boardState.set(restoration, { merge: true });
      const restoredData = (await boardState.get()).data() || {};
      for (const [field, original] of Object.entries(originalMigrationMarkers)) {
        const restoredPresent = Object.prototype.hasOwnProperty.call(restoredData, field);
        if (restoredPresent !== original.present || (original.present && !isDeepStrictEqual(restoredData[field], original.value))) {
          throw new Error(`Five-peer board-state marker restoration failed for ${field}.`);
        }
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (app) {
    try {
      await deleteApp(app);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (primaryError && cleanupErrors.length) {
    throw new global.AggregateError(
      [primaryError, ...cleanupErrors],
      'Five-peer convergence failed and owned cleanup/restoration also failed.'
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length > 1) {
    throw new global.AggregateError(cleanupErrors, 'Five-peer owned cleanup/restoration failed multiple checks.');
  }
});
