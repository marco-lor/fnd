const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('./measured-test');
const {
  captureBrowserMetrics,
  createPageAssetTracker,
  drainPageConnections,
  flushBrowserObservers,
  installBootstrap,
  installDeterministicFontRoutes,
  isExpectedDemoRecaptchaCancellation,
  isExpectedDemoRecaptchaReportOnlyWarning,
  navigateToCleanup,
  storageStateForRole,
  warmBrowserAssetDelivery,
  waitForReadiness,
} = require('./helpers');
const {
  configureOwnedPerformanceEnvironment,
  frontendRoot,
  fixtureManifestPath,
  projectId,
  readJson,
  resultsDir,
  writeJson,
} = require('../../../scripts/performance/common');
const {
  BACKUP_PATH,
  applyOverlay,
  buildTask09aFixtureSummary,
  restoreOverlay,
} = require('../../../scripts/performance/task09a-overlay');

configureOwnedPerformanceEnvironment();
const { summarizeBazaarProfile } = require('../../../scripts/performance/task09a-profile');
const profiling = process.env.FND_PERF_REACT_PROFILE === '1';

const SCENARIO = Object.freeze({
  id: 'task09a-baseline',
  route: '/bazaar',
  role: 'player',
});
const HOVER_COUNT = 20;
const DETAIL_DEBOUNCE_MS = 150;

const countEvents = (snapshot, predicate) => (
  (snapshot?.events || []).filter(predicate).length
);

const sumEvents = (snapshot, predicate) => (
  (snapshot?.events || [])
    .filter(predicate)
    .reduce((total, event) => total + (Number(event.value) || 0), 0)
);

const readCardAndMediaState = async (page) => page.evaluate(() => {
  const cards = [...document.querySelectorAll('[data-testid^="bazaar-item-card-"]')];
  const images = [...document.querySelectorAll('img')];
  const viewportBottom = window.innerHeight;
  return {
    mountedCards: cards.length,
    mountedMedia: images.length,
    offscreenMediaElements: images.filter((image) => image.getBoundingClientRect().top > viewportBottom).length,
    visibleCards: cards.filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    }).length,
    scrollY: window.scrollY,
  };
});

const summarizeTelemetry = (capture, {
  phase,
  before = null,
  hoverDurationMs = null,
} = {}) => {
  const snapshot = capture.snapshot;
  const firestoreEvents = snapshot.events.filter((event) => event.category === 'firestore');
  const initialDocs = sumEvents(snapshot, (event) => (
    event.category === 'firestore' && event.metric === 'initial-documents-delivered'
  ));
  const estimatedBytes = sumEvents(snapshot, (event) => (
    event.category === 'firestore'
      && event.metric === 'documents-delivery-estimated-bytes'
      && event.tags?.delivery === 'initial'
  ));
  const shellRegistrations = countEvents(snapshot, (event) => (
    event.category === 'firestore'
      && event.metric === 'listener-open'
      && String(event.tags?.target || '') === 'users.shell.subscribe.v2'
  ));
  const profileRegistrations = countEvents(snapshot, (event) => (
    event.category === 'firestore'
      && event.metric === 'listener-open'
      && /^users\.(?:settings|resources|progression)\./.test(String(event.tags?.target || ''))
  ));
  const oneShotDocuments = sumEvents(snapshot, (event) => (
    event.category === 'firestore' && event.metric === 'one-shot-documents-delivered'
  ));
  const previousOneShotDocuments = before
    ? sumEvents(before, (event) => (
      event.category === 'firestore' && event.metric === 'one-shot-documents-delivered'
    ))
    : 0;
  return {
    phase,
    reactProfile: summarizeBazaarProfile(snapshot, before),
    droppedEventCount: snapshot.droppedEventCount,
    countsComplete: snapshot.droppedEventCount === 0,
    initialCatalogEstimatedBytes: sumEvents(snapshot, event => event.category === 'firestore' && event.metric === 'documents-delivery-estimated-bytes' && event.tags?.delivery === 'initial' && event.tags?.target === 'legacy.items.subscribe.v1'),
    route: snapshot.routeState?.routeId || SCENARIO.route,
    initialCatalogDocuments: sumEvents(snapshot, (event) => (
      event.category === 'firestore'
        && event.metric === 'initial-documents-delivered'
        && event.tags?.target === 'legacy.items.subscribe.v1'
    )),
    initialDocumentsDelivered: initialDocs,
    initialEstimatedBytes: estimatedBytes,
    oneShotDocumentsDelivered: oneShotDocuments,
    additionalOneShotDocumentsAfterPrevious: Math.max(0, oneShotDocuments - previousOneShotDocuments),
    firestoreEventCount: firestoreEvents.length,
    profileRegistrations,
    shellRegistrations,
    profileCommitTelemetryAvailable: snapshot.events.some(event => event.category === 'react' && event.tags?.id === 'Bazaar'),
    profileCommitCount: snapshot.events.some(event => event.category === 'react' && event.tags?.id === 'Bazaar')
      ? countEvents(snapshot, event => event.category === 'react' && event.tags?.id === 'Bazaar') : null,
    profileCommitDurationMs: snapshot.events.some(event => event.category === 'react' && event.tags?.id === 'Bazaar')
      ? sumEvents(snapshot, event => event.category === 'react' && event.tags?.id === 'Bazaar') : null,
    committedListRenderCount: countEvents(snapshot, event => event.metric === 'render' && event.tags?.component === 'Bazaar' && event.tags?.source === 'committed-probe'),
    committedCardRenderCount: countEvents(snapshot, event => event.metric === 'render' && event.tags?.component === 'BazaarItemCard' && event.tags?.source === 'committed-probe'),
    hoverDurationMs,
    resourceTimingBufferOverflow: capture.resourceTimingBufferOverflow,
    runtime: {
      finalHeapBytes: capture.cdp?.JSHeapUsedSize || capture.snapshot.heap?.usedJSHeapSize || 0,
      finalDomNodes: capture.cdp?.Nodes || null,
      imageResourceCount: capture.diagnostics.imageResourceTimings.length,
    },
  };
};

const hoverTwentyCards = async (page) => {
  const cards = page.locator('[data-testid^="bazaar-item-card-"]');
  const count = await cards.count();
  if (count < HOVER_COUNT) {
    throw new Error(`Task09A hover trace requires ${HOVER_COUNT} cards; mounted ${count}.`);
  }
  const startedAt = Date.now();
  const rapidTrace = await page.evaluate((traceCount) => {
    const traceCards = [...document.querySelectorAll('[data-testid^="bazaar-item-card-"]')].slice(0, traceCount);
    const startedAt = performance.now();
    traceCards.forEach((card, index) => {
      // React's onMouseEnter delegation is driven by mouseover.  Pair each
      // rapid transition with a mouseout so the probe does not leave twenty
      // pending panel states in the production UI; the final card is held
      // separately below for the declared dwell.
      card.dispatchEvent(new MouseEvent('mouseover', {
        bubbles: true,
        relatedTarget: null,
        clientX: 1,
        clientY: 1,
      }));
      if (index < traceCards.length - 1) {
        card.dispatchEvent(new MouseEvent('mouseout', {
          bubbles: true,
          relatedTarget: null,
          clientX: 1,
          clientY: 1,
        }));
      }
    });
    return {
      count: traceCards.length,
      durationMs: performance.now() - startedAt,
    };
  }, HOVER_COUNT);
  // The final card is deliberately held longer than the declared debounce so
  // a future reader can prove that exactly one detail fetch is attributable to
  // the dwell.  The current reader has no detail fetch on hover.
  await page.waitForTimeout(DETAIL_DEBOUNCE_MS + 25);
  return {
    count: HOVER_COUNT,
    rapidTrace,
    totalDurationMs: Date.now() - startedAt,
    kind: 'synthetic-mouseover',
    dwellMs: DETAIL_DEBOUNCE_MS + 25,
  };
};

const createDiagnostics = (baseURL) => ({
  consoleErrors: [],
  explainedRecaptchaCancellations: [],
  explainedRecaptchaReportOnlyWarnings: [],
  unhandledErrors: [],
  failedRequests: [],
  baseURL,
});

const attachDiagnostics = (page, diagnostics, lifecyclePhase) => {
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (isExpectedDemoRecaptchaReportOnlyWarning(text, { baseURL: diagnostics.baseURL })) {
      diagnostics.explainedRecaptchaReportOnlyWarnings.push(text.slice(0, 500));
      return;
    }
    diagnostics.consoleErrors.push(text.slice(0, 300));
  });
  page.on('pageerror', (error) => diagnostics.unhandledErrors.push(error.message.slice(0, 300)));
  page.on('requestfailed', (request) => {
    const failure = {
      resourceType: request.resourceType(),
      failure: request.failure()?.errorText || 'unknown',
      path: (() => {
        try { return new URL(request.url()).pathname; } catch { return '[invalid-url]'; }
      })(),
    };
    if (isExpectedDemoRecaptchaCancellation({
      ...failure,
      lifecyclePhase: lifecyclePhase(),
      url: request.url(),
      baseURL: diagnostics.baseURL,
    })) {
      diagnostics.explainedRecaptchaCancellations.push(failure);
      return;
    }
    diagnostics.failedRequests.push(failure);
  });
};

test('Task 09A current Bazaar baseline: cold, warm, and 20-card hover trace', async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(240_000);
  const resultFile = profiling ? `task09a-profile-${testInfo.repeatEachIndex + 1}.json` : 'task09a-baseline.json';
  const buildReport = readJson(path.join(resultsDir, profiling ? 'profile-build-report.json' : 'build-report.json'));
  expect(buildReport.buildMode).toBe(profiling ? 'performance-react-profile' : 'performance');
  const mainAsset = buildReport.assets.find(asset => asset.classification === 'entry' && asset.category === 'javascript');
  expect(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(frontendRoot, 'build', mainAsset.path))).digest('hex')).toBe(mainAsset.sha256);
  const fixture = readJson(fixtureManifestPath);
  const diagnostics = createDiagnostics(baseURL);
  let phase = 'route-navigation';
  let context;
  let page;
  let overlayApplied = false;
  try {
    await applyOverlay();
    overlayApplied = true;
    context = await browser.newContext({
      baseURL,
      storageState: storageStateForRole(SCENARIO.role),
    });
    await warmBrowserAssetDelivery({
      baseURL,
      context,
      owner: `task09a-${testInfo.project.name}`,
    });
    await installDeterministicFontRoutes(context);
    await installBootstrap(context, SCENARIO, 1);
    page = await context.newPage();
    const pageAssets = createPageAssetTracker();
    page.on('request', (request) => pageAssets.begin(request));
    page.on('requestfinished', (request) => pageAssets.complete(request));
    page.on('requestfailed', (request) => pageAssets.complete(request));
    attachDiagnostics(page, diagnostics, () => phase);

    await page.goto(SCENARIO.route, { waitUntil: 'domcontentloaded' });
    await waitForReadiness(page, { expectedPathname: SCENARIO.route, timeoutMs: 60_000 });
    phase = 'route-active';
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="bazaar-item-card-"]').length >= 20);
    pageAssets.beginQuietWindow();
    await expect.poll(() => pageAssets.isQuiet(), { timeout: 15_000 }).toBe(true);
    await flushBrowserObservers(page);
    const coldCapture = await captureBrowserMetrics(page, diagnostics);
    const coldCards = await readCardAndMediaState(page);
    const coldSummary = summarizeTelemetry(coldCapture, { phase: 'cold' });

    phase = 'interaction';
    const hoverTrace = await hoverTwentyCards(page);
    await flushBrowserObservers(page);
    const afterHoverCapture = await captureBrowserMetrics(page, diagnostics);
    const afterHoverCards = await readCardAndMediaState(page);
    const hoverSummary = summarizeTelemetry(afterHoverCapture, {
      phase: '20-card-hover',
      before: coldCapture.snapshot,
      hoverDurationMs: hoverTrace.totalDurationMs,
    });

    const overlayActive = fs.existsSync(BACKUP_PATH);
    const overlaySummary = overlayActive ? buildTask09aFixtureSummary() : null;
    const coldCatalogDocuments = coldSummary.initialCatalogDocuments;
    const coldHoverOneShotDocuments = hoverSummary.additionalOneShotDocumentsAfterPrevious;

    const warmHoverTrace = await hoverTwentyCards(page);
    await flushBrowserObservers(page);
    const warmCapture = await captureBrowserMetrics(page, diagnostics);
    const warmCards = await readCardAndMediaState(page);
    const warmSummary = summarizeTelemetry(warmCapture, {
      phase: 'warm-same-session-hover',
      before: afterHoverCapture.snapshot,
      hoverDurationMs: warmHoverTrace.totalDurationMs,
    });

    // Deliberate real pointer interactions are a separate measurement window.
    // Their fetches must never be attributed to the synthetic rapid trace.
    const perCardMs = [];
    for (let index = 0; index < HOVER_COUNT; index += 1) {
      const startedAt = Date.now();
      const card = page.locator('[data-testid^="bazaar-item-card-"]').nth(index);
      await card.scrollIntoViewIfNeeded();
      await card.hover();
      await page.waitForTimeout(DETAIL_DEBOUNCE_MS + 25);
      perCardMs.push(Date.now() - startedAt);
    }
    await flushBrowserObservers(page);
    const deliberateCapture = await captureBrowserMetrics(page, diagnostics);
    const deliberateSummary = summarizeTelemetry(deliberateCapture, { phase: 'deliberate-real-pointer', before: warmCapture.snapshot });
    const result = {
      baselineLabel: 'pre-optimization plus numeric panel crash fix and measurement probes',
      buildMode: buildReport.buildMode,
      profiling,
      iteration: testInfo.repeatEachIndex + 1,
      mainAsset,
      schemaVersion: 1,
      contractVersion: 1,
      generatedAt: new Date().toISOString(),
      projectId,
      fixture: {
        manifestVersion: fixture.version,
        manifestHash: fixture.canonicalHash,
        items: fixture.counts.items,
        inventoryEntries: 500,
        source: overlayActive ? 'canonical-v2-fixture plus Task09A overlay' : 'canonical-v2-fixture; Task09A overlay optional',
        overlayActive,
        originalSnapshotHash: overlayActive ? readJson(BACKUP_PATH).sourceHash : null,
        overlaySummary,
      },
      sourceIdentity: {
        head: buildReport.sourceTreeIdentity?.head || null,
        dirty: buildReport.sourceTreeIdentity?.dirty ?? null,
        sourceTreeFingerprint: buildReport.sourceTreeIdentity?.sourceTreeFingerprint || null,
        trackedDiffFingerprint: buildReport.sourceTreeIdentity?.trackedDiffFingerprint || null,
        buildReportGeneratedAt: buildReport.generatedAt || null,
      },
      machine: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        cpuModel: os.cpus()[0]?.model || 'unknown',
        cpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
      },
      environment: {
        project: testInfo.project.name,
        browser: browser.version(),
        baseURL,
        route: SCENARIO.route,
        viewport: page.viewportSize(),
        coldDefinition: 'fresh context/auth; warmed static assets; no prior route detail/config cache',
        warmDefinition: 'same page and session, repeat synthetic hover with populated config cache',
      },
      targets: {
        pageSize: 50,
        searchDebounceMs: DETAIL_DEBOUNCE_MS,
        coldFinalDetailFetchesMax: 1,
        warmDetailFetches: 0,
        additionalProfileRegistrationsDuringHover: 0,
        reactCommitP95Ms: 16.7,
        rapidHoverPerCardMaxMs: DETAIL_DEBOUNCE_MS,
      },
      cold: { ...coldSummary, cards: coldCards },
      hover: {
        ...hoverSummary,
        trace: hoverTrace,
        cards: afterHoverCards,
        additionalOneShotDocuments: coldHoverOneShotDocuments,
      },
      warm: {
        ...warmSummary,
        trace: warmHoverTrace,
        cards: warmCards,
        additionalOneShotDocuments: warmSummary.additionalOneShotDocumentsAfterPrevious,
      },
      deliberate: { ...deliberateSummary, kind: 'real-pointer-with-dwell', count: HOVER_COUNT, perCardMs },
      rawTelemetry: { cold: coldCapture.snapshot, hover: afterHoverCapture.snapshot, warm: warmCapture.snapshot, deliberate: deliberateCapture.snapshot },
      diagnostics: {
        consoleErrors: diagnostics.consoleErrors,
        explainedRecaptchaCancellations: diagnostics.explainedRecaptchaCancellations,
        explainedRecaptchaReportOnlyWarnings: diagnostics.explainedRecaptchaReportOnlyWarnings,
        unhandledErrors: diagnostics.unhandledErrors,
        failedRequests: diagnostics.failedRequests,
      },
      currentReaderInterpretation: {
        initialCatalogTarget: 'legacy.items.subscribe.v1',
        summaryPageBounded: false,
        initialCatalogDocuments: coldCatalogDocuments,
        hoverAdditionalOneShotDocuments: coldHoverOneShotDocuments,
        warmSameSessionAdditionalOneShotDocuments: warmSummary.additionalOneShotDocumentsAfterPrevious,
        oneShotInterpretation: 'all config/directory/item one-shot documents; current reader passes full item documents directly, so this is not a dedicated detail-fetch measurement',
        actualItemDetailFetches: 0,
        actualItemDetailFetchEvidence: 'current reader source uses full subscription documents; no detail getDoc path',
        profileRegistrationTargetPassed: hoverSummary.profileRegistrations === coldSummary.profileRegistrations,
        shellRegistrationsDuringHover: hoverSummary.shellRegistrations - coldSummary.shellRegistrations,
        profileRegistrationsDuringHover: Math.max(0, hoverSummary.profileRegistrations - coldSummary.profileRegistrations),
        profileCommitTelemetryAvailable: hoverSummary.profileCommitTelemetryAvailable,
        profileCommitCount: hoverSummary.profileCommitCount,
        rapidTraceWithinDebounce: hoverTrace.rapidTrace.durationMs < DETAIL_DEBOUNCE_MS,
        estimatedBytes: true,
      },
    };
    result.renderDeltas = {
      syntheticCold: { list: hoverSummary.committedListRenderCount - coldSummary.committedListRenderCount, cards: hoverSummary.committedCardRenderCount - coldSummary.committedCardRenderCount },
      syntheticWarm: { list: warmSummary.committedListRenderCount - hoverSummary.committedListRenderCount, cards: warmSummary.committedCardRenderCount - hoverSummary.committedCardRenderCount },
      deliberate: { list: deliberateSummary.committedListRenderCount - warmSummary.committedListRenderCount, cards: deliberateSummary.committedCardRenderCount - warmSummary.committedCardRenderCount },
    };
    result.harnessIdentity = require('node:crypto').createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
    if (profiling) {
      for (const measured of [coldSummary, hoverSummary, warmSummary, deliberateSummary]) expect(measured.reactProfile.available).toBe(true);
      expect(coldSummary.reactProfile.count).toBeGreaterThan(0);
      expect(coldSummary.reactProfile.totalMs).toBeGreaterThan(0);
      expect(deliberateSummary.reactProfile.count).toBeGreaterThan(0);
      expect(deliberateSummary.reactProfile.totalMs).toBeGreaterThan(0);
    }
    writeJson(path.join(resultsDir, resultFile), result);

    expect(diagnostics.consoleErrors, diagnostics.consoleErrors.join('\n')).toHaveLength(0);
    expect(diagnostics.unhandledErrors, diagnostics.unhandledErrors.join('\n')).toHaveLength(0);
    expect(diagnostics.failedRequests, JSON.stringify(diagnostics.failedRequests)).toHaveLength(0);
    expect(coldSummary.initialCatalogDocuments).toBeGreaterThanOrEqual(
      overlayActive ? overlaySummary.visibleToPlayerCount : 900
    );
    expect(coldSummary.initialEstimatedBytes).toBeGreaterThan(0);
    expect(hoverTrace.count).toBe(HOVER_COUNT);
    expect(hoverTrace.rapidTrace.durationMs).toBeLessThan(DETAIL_DEBOUNCE_MS);
    for (const capture of [coldCapture, afterHoverCapture, warmCapture, deliberateCapture]) {
      expect(capture.snapshot.droppedEventCount).toBe(0);
      expect(capture.resourceTimingBufferOverflow).toBe(false);
    }

    phase = 'route-cleanup';
    await navigateToCleanup(page);
    await page.waitForFunction(() => Object.entries(window.__FND_PERF__.snapshot().activeResources || {})
      .filter(([key]) => key.startsWith('/bazaar::'))
      .reduce((sum, [, count]) => sum + count, 0) === 0, null, { timeout: 10000 });
    result.cleanup = await page.evaluate(() => {
      const snapshot = window.__FND_PERF__.snapshot();
      return { activeListeners: snapshot.activeListeners, activeResources: snapshot.activeResources, media: snapshot.media };
    });
    writeJson(path.join(resultsDir, resultFile), result);
    // The authenticated shell deliberately survives route cleanup. Match the
    // standard route harness ownership gate rather than counting shell state.
    expect(Object.entries(result.cleanup.activeListeners).filter(([key]) => key.startsWith('/bazaar::')).reduce((sum, [, count]) => sum + count, 0)).toBe(0);
    expect(Object.entries(result.cleanup.activeResources).filter(([key]) => key.startsWith('/bazaar::')).reduce((sum, [, count]) => sum + count, 0)).toBe(0);
    expect(result.cleanup.media.activeSources).toBe(0);
    await drainPageConnections(page);
  } catch (error) {
    writeJson(path.join(resultsDir, 'task09a-failure.json'), { phase, message: error.message, diagnostics });
    throw error;
  } finally {
    await drainPageConnections(page).catch(() => {});
    await context?.close().catch(() => {});
    if (overlayApplied || fs.existsSync(BACKUP_PATH)) await restoreOverlay();
  }
});
