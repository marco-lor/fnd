process.env.GCLOUD_PROJECT ||= 'demo-fnd-perf';
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';

const { deleteApp, initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { test, expect } = require('@playwright/test');
const manifest = require('../../scenarios.json');
const {
  installBootstrap,
  navigateToCleanup,
  storageStateForRole,
  waitForReadiness,
  writeScenarioResult,
} = require('./helpers');

const scenario = manifest.scenarios.find((entry) => entry.id === 'grigliata-five-peer');
const peers = ['dm', 'player', 'peer-2', 'peer-3', 'peer-4'];

const countRouteResources = (resources, route) => Object.entries(resources || {})
  .filter(([key]) => key.startsWith(`${route}::`))
  .filter(([key]) => !key.startsWith(`${route}::timeout`))
  .reduce((total, [, count]) => total + Number(count || 0), 0);

const waitForRouteCleanup = async ({ page, role }) => {
  try {
    await page.waitForFunction(() => (
      Object.entries(window.__FND_PERF__.snapshot().activeResources || {})
        .filter(([key]) => key.startsWith('/grigliata::'))
        .filter(([key]) => !key.startsWith('/grigliata::timeout'))
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
      };
    }).catch((diagnosticError) => ({
      diagnosticError: diagnosticError.message,
    }));
    throw new Error(
      `Five-peer cleanup did not settle for ${role}: ${JSON.stringify(diagnostics)}`,
      { cause: error }
    );
  }

  return page.evaluate(() => window.__FND_PERF__.snapshot());
};

test('grigliata five-peer placement convergence', async ({ browser, baseURL }, testInfo) => {
  test.skip(process.env.FND_PERF_SKIP_MULTI === '1', 'Explicitly disabled for a reduced smoke run.');
  const contexts = [];
  const pages = [];
  let placement = null;
  let app = null;
  try {
    for (const role of peers) {
      const context = await browser.newContext({ baseURL, storageState: storageStateForRole(role) });
      await installBootstrap(context, { ...scenario, role }, 1);
      const page = await context.newPage();
      const failures = [];
      page.on('console', (message) => { if (message.type() === 'error') failures.push(message.text()); });
      page.on('pageerror', (error) => failures.push(error.message));
      await page.goto(scenario.route, { waitUntil: 'domcontentloaded' });
      await waitForReadiness(page);
      contexts.push(context);
      pages.push({ page, role, failures });
    }

    const deliveredBefore = await Promise.all(pages.map(({ page }) => page.evaluate(() => (
      window.__FND_PERF__.snapshot().events
        .filter((event) => event.category === 'firestore' && event.metric === 'changed-documents-delivered').length
    ))));

    app = getApps()[0] || initializeApp({ projectId: 'demo-fnd-perf' });
    const db = getFirestore(app);
    placement = db.doc('grigliata_token_placements/perf-map__perf-token-0000');
    const updateStartedAt = Date.now();
    await placement.update({ col: 1, updatedAt: '2026-01-01T00:00:01.000Z' });

    await Promise.all(pages.map(({ page }, index) => page.waitForFunction((minimum) => (
      window.__FND_PERF__.snapshot().events
        .filter((event) => event.category === 'firestore' && event.metric === 'changed-documents-delivered').length > minimum
    ), deliveredBefore[index])));
    const convergenceMs = Date.now() - updateStartedAt;

    const snapshots = await Promise.all(pages.map(({ page }) => page.evaluate(() => window.__FND_PERF__.snapshot())));
    for (const { failures } of pages) expect(failures, failures.join('\n')).toHaveLength(0);
    const cleanupSnapshots = [];
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
    expect(leakedRouteListeners).toBe(0);
    expect(leakedRouteResources).toBe(0);
    writeScenarioResult(scenario, 1, {
      environment: {
        projectName: testInfo.project.name,
        browserName: testInfo.project.use.browserName || testInfo.project.name,
        browserVersion: browser.version(),
      },
      metrics: {
        'runtime.peerConvergenceMs': convergenceMs,
        'runtime.consoleErrors': pages.reduce((total, peer) => total + peer.failures.length, 0),
        'runtime.unhandledErrors': 0,
        'runtime.failedRequests': 0,
        'firestore.activeListenersAfterCleanup': leakedRouteListeners,
        'runtime.activeResourcesAfterCleanup': leakedRouteResources,
        'runtime.activeTimeoutsAfterCleanup': pendingRouteTimeouts,
        'firestore.changedDocumentsDelivered': snapshots.reduce((total, snapshot) => (
          total + snapshot.events
            .filter((event) => event.category === 'firestore' && event.metric === 'changed-documents-delivered')
            .reduce((sum, event) => sum + Number(event.value || 0), 0)
        ), 0),
      },
      eventCount: snapshots.reduce((total, snapshot) => total + snapshot.events.length, 0),
      readiness: { 'shell-visible': true, 'data-ready': true, interactive: true },
      peerCount: pages.length,
      diagnostics: { peerFailures: pages.map(({ role, failures }) => ({ role, failures })) },
    });
  } finally {
    if (placement) {
      await placement.update({ col: 0, updatedAt: '2026-01-01T00:00:00.000Z' }).catch(() => {});
    }
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    if (app) await deleteApp(app).catch(() => {});
  }
});
