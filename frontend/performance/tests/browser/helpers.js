const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { resultsDir, writeJson } = require('../../../scripts/performance/common');
const fixtureManifest = require('../../fixture-manifest.json');

const AUTH_DIRECTORY = path.resolve(__dirname, '..', '..', '..', 'playwright', '.auth');
const ACCOUNT = {
  'new-player': { uid: 'perf-new-player', state: 'new-player.json' },
  player: { uid: 'perf-player', state: 'player.json' },
  dm: { uid: 'perf-dm', state: 'dm.json' },
  webmaster: { uid: 'perf-webmaster', state: 'webmaster.json' },
  'peer-2': { uid: 'perf-peer-2', state: 'peer-2.json' },
  'peer-3': { uid: 'perf-peer-3', state: 'peer-3.json' },
  'peer-4': { uid: 'perf-peer-4', state: 'peer-4.json' },
  'peer-5': { uid: 'perf-peer-5', state: 'peer-5.json' },
};

const storageStateForRole = (role) => {
  if (role === 'anonymous') return undefined;
  const account = ACCOUNT[role];
  if (!account) throw new Error(`No performance account configured for role ${role}`);
  return path.join(AUTH_DIRECTORY, account.state);
};

const installBootstrap = async (context, scenario, iteration) => {
  await context.addInitScript(({ scenarioId, role, runIteration, benchmarkRunId, fixtureVersion }) => {
    window.__FND_PERF_BOOTSTRAP__ = {
      runId: `${benchmarkRunId}:${scenarioId}-${runIteration}`,
      scenarioId,
      routeId: scenarioId,
      actorRole: role,
      release: 'task-01',
      browserProfile: 'desktop-1440x900-dpr1',
      connectionProfile: 'local-emulator',
      fixtureVersion,
    };
  }, {
    scenarioId: scenario.id,
    role: scenario.role,
    runIteration: iteration,
    benchmarkRunId: process.env.FND_PERF_RUN_ID || 'local',
    fixtureVersion: fixtureManifest.version,
  });
};

const waitForBridge = async (page) => {
  await page.waitForFunction(() => Boolean(window.__FND_PERF__?.snapshot));
};

const waitForReadiness = async (page) => {
  await waitForBridge(page);
  await page.waitForFunction(() => {
    const state = window.__FND_PERF__.snapshot().routeState;
    return state?.shellVisible && state?.dataReady && state?.interactive;
  });
};

const navigateToCleanup = async (page) => {
  await page.evaluate(() => {
    window.history.pushState({}, '', '/__fnd_perf_cleanup__');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForFunction(() => (
    window.location.pathname === '/__fnd_perf_cleanup__'
    && window.__FND_PERF__?.snapshot().routeState?.routeId === '/__fnd_perf_cleanup__'
  ));
};

const countRouteResources = (resources, route, { includeTimeouts = false } = {}) => (
  Object.entries(resources || {})
    .filter(([key]) => key.startsWith(`${route}::`))
    .filter(([key]) => includeTimeouts || !key.startsWith(`${route}::timeout`))
    .reduce((total, [, value]) => total + Number(value || 0), 0)
);

const visibleFirst = async (locators) => {
  for (const locator of locators) {
    const candidate = locator.first();
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  throw new Error('None of the deterministic interaction targets was visible.');
};

const runInteraction = async (page, scenario) => {
  switch (scenario.id) {
    case 'login-cold':
    case 'login-warm': {
      const password = page.getByPlaceholder('Password');
      const toggle = page.getByLabel('Show password');
      await expect(password).toBeVisible();
      await toggle.click();
      break;
    }
    case 'character-creation': {
      await page.getByRole('heading', { name: 'Evocazione Permanente' }).click();
      await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
      break;
    }
    case 'home': {
      await page.getByRole('button', { name: 'Expand Parametri Speciali' }).click();
      const currentHp = page.getByText('45/50', { exact: true });
      await expect(currentHp).toBeVisible();
      await page.getByTitle('-1 HP').click();
      await expect(page.getByText('44/50', { exact: true })).toBeVisible();
      await page.getByTitle('+1 HP').click();
      await expect(currentHp).toBeVisible();
      const search = page.getByPlaceholder(/Cerca nome o tipo/);
      await search.fill('Fixture item 42');
      await expect(page.getByText('Fixture item 42', { exact: false }).first()).toBeVisible();
      break;
    }
    case 'bazaar': {
      await page.getByPlaceholder('Cerca per Nome...').fill('Bazaar item 42');
      await page.locator('[data-testid^="bazaar-item-card-"]').first().click();
      await expect(page.getByTestId('bazaar-comparison-panel')).toBeVisible();
      break;
    }
    case 'tecniche-spell': {
      await page.getByPlaceholder('Cerca per nome o effetto...').first().fill('Technique 42');
      const card = await visibleFirst([
        page.getByText('Technique 42', { exact: false }),
        page.locator('main button'),
      ]);
      await card.click();
      break;
    }
    case 'codex': {
      const category = await visibleFirst([
        page.getByText('Categoria 00', { exact: false }),
        page.locator('main button'),
      ]);
      await category.click();
      await expect(page.getByText('Codex 0-42', { exact: false }).first()).toBeVisible();
      break;
    }
    case 'combat': {
      await page.getByText('Encounter 0', { exact: true }).first().click();
      await expect(page.getByText('Encounter Log', { exact: false }).first()).toBeVisible();
      break;
    }
    case 'echi-di-viaggio': {
      const marker = await visibleFirst([
        page.getByLabel(/Zoom image for Fixture NPC/i),
        page.getByText(/Fixture NPC/i),
      ]);
      await marker.hover();
      break;
    }
    case 'dm-dashboard': {
      const player = await visibleFirst([
        page.getByText('Performance Hero 2', { exact: false }),
        page.locator('main button'),
      ]);
      await player.click();
      break;
    }
    case 'foes-hub': {
      const filter = page.locator('main input[type="text"]').first();
      if (await filter.isVisible().catch(() => false)) await filter.fill('Fixture foe 42');
      await page.getByLabel('expand').first().click();
      break;
    }
    case 'admin': {
      const grouping = page.locator('main select').first();
      await expect(grouping).toBeVisible();
      await grouping.focus();
      break;
    }
    case 'grigliata-player':
    case 'grigliata-manager': {
      const canvas = page.locator('canvas').first();
      await expect(canvas).toBeVisible();
      const box = await canvas.boundingBox();
      if (!box) throw new Error('Grigliata canvas has no layout box.');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -240);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 25, { steps: 4 });
      await page.mouse.up();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      if (scenario.id === 'grigliata-manager') {
        const library = await visibleFirst([
          page.getByRole('tab', { name: /DM Gallery/i }),
          page.getByText(/Gallery|Library/i),
        ]);
        await library.click();
        await page.waitForFunction(() => Boolean(window.__FND_PERF_BENCHMARKS__?.runAll));
        await page.evaluate(() => window.__FND_PERF_BENCHMARKS__.runAll());
      }
      break;
    }
    default:
      throw new Error(`Interaction not implemented for ${scenario.id}`);
  }
};

const captureBrowserMetrics = async (page, diagnostics) => {
  const browserCapture = await page.evaluate((capturedDiagnostics) => {
  const snapshot = window.__FND_PERF__.snapshot();
  const resources = performance.getEntriesByType('resource');
  const byClass = resources.reduce((totals, entry) => {
    const pathname = (() => {
      try { return new URL(entry.name).pathname.toLowerCase(); } catch { return ''; }
    })();
    const category = pathname.endsWith('.js') ? 'javascript'
      : pathname.endsWith('.css') ? 'css'
        : /\.(png|jpe?g|gif|svg|webp|avif)$/.test(pathname) ? 'image'
          : /\.(woff2?|ttf|otf)$/.test(pathname) ? 'font'
            : /\.(mp3|wav|ogg|mp4|webm)$/.test(pathname) ? 'media'
              : 'other';
    totals[category] ||= { count: 0, transferBytes: 0, encodedBytes: 0 };
    totals[category].count += 1;
    totals[category].transferBytes += Number(entry.transferSize) || 0;
    totals[category].encodedBytes += Number(entry.encodedBodySize) || 0;
    return totals;
  }, {});
    return { snapshot, resources: byClass, diagnostics: capturedDiagnostics };
  }, diagnostics);
  let cdp = null;
  try {
    const session = await page.context().newCDPSession(page);
    await session.send('Performance.enable');
    const result = await session.send('Performance.getMetrics');
    cdp = Object.fromEntries(result.metrics.map(({ name, value }) => [name, value]));
    await session.detach();
  } catch (_error) {
    // Firefox/WebKit smoke coverage does not expose CDP and does not use timing budgets.
  }
  return { ...browserCapture, cdp };
};

const aggregateMetrics = (capture, cleanup) => {
  const metrics = {};
  const events = capture.snapshot.events;
  const latest = (category, metric) => [...events].reverse().find((event) => (
    event.category === category && event.metric === metric
  ))?.value;
  for (const name of ['CLS', 'INP', 'LCP', 'TTFB']) {
    const value = latest('web-vital', name);
    if (Number.isFinite(value)) metrics[`web-vital.${name}`] = value;
  }
  const longTasks = events.filter((event) => event.category === 'runtime' && event.metric === 'long-task');
  metrics['runtime.maxLongTaskMs'] = Math.max(0, ...longTasks.map((event) => Number(event.value) || 0));
  metrics['runtime.consoleErrors'] = capture.diagnostics.consoleErrors.length;
  metrics['runtime.unhandledErrors'] = capture.diagnostics.unhandledErrors.length;
  metrics['runtime.failedRequests'] = capture.diagnostics.failedRequests.length;
  metrics['runtime.synchronousNetworkCalls'] = events
    .filter((event) => event.category === 'runtime' && event.metric === 'synchronous-network-call').length;
  metrics['firestore.documentsDelivered'] = events
    .filter((event) => event.category === 'firestore' && /documents-delivered$/.test(event.metric))
    .reduce((total, event) => total + (Number(event.value) || 0), 0);
  metrics['firestore.activeListenersAfterCleanup'] = Object.entries(cleanup.activeListeners || {})
    .filter(([key]) => key.startsWith(`${capture.snapshot.routeState?.routeId || 'unknown'}::`))
    .reduce((total, [, value]) => total + Number(value || 0), 0);
  const measuredRoute = capture.snapshot.routeState?.routeId || 'unknown';
  metrics['runtime.activeResourcesAfterCleanup'] = countRouteResources(
    cleanup.activeResources,
    measuredRoute,
  );
  metrics['runtime.activeTimeoutsAfterCleanup'] = Object.entries(cleanup.activeResources || {})
    .filter(([key]) => key.startsWith(`${measuredRoute}::timeout`))
    .reduce((total, [, value]) => total + Number(value || 0), 0);
  metrics['runtime.activeMediaAfterCleanup'] = Number(cleanup.media?.activeSources || 0);
  metrics['runtime.finalHeapBytes'] = capture.cdp?.JSHeapUsedSize || capture.snapshot.heap?.usedJSHeapSize || 0;
  if (Number.isFinite(capture.cdp?.Nodes)) metrics['runtime.finalDomNodes'] = capture.cdp.Nodes;
  events.filter((event) => event.category === 'microbenchmark').forEach((event) => {
    metrics[`microbenchmark.${event.metric}`] = Number(event.value) || 0;
  });
  for (const [category, values] of Object.entries(capture.resources)) {
    metrics[`resource.${category}.transferBytes`] = values.transferBytes;
    metrics[`resource.${category}.gzipBytes`] = values.encodedBytes;
    metrics[`resource.${category}.count`] = values.count;
  }
  return metrics;
};

const writeScenarioResult = (scenario, iteration, result) => {
  const directory = path.join(resultsDir, 'scenarios');
  fs.mkdirSync(directory, { recursive: true });
  writeJson(path.join(directory, `${scenario.id}-${iteration}.json`), {
    schemaVersion: 1,
    scenarioId: scenario.id,
    route: scenario.route,
    role: scenario.role,
    iteration,
    ...result,
  });
};

const writeScenarioRaw = (scenario, iteration, capture) => {
  writeJson(path.join(resultsDir, 'raw', `${scenario.id}-${iteration}.json`), {
    schemaVersion: 1,
    scenarioId: scenario.id,
    iteration,
    snapshot: capture.snapshot,
    resources: capture.resources,
    cdp: capture.cdp,
    diagnostics: capture.diagnostics,
  });
};

const restoreScenarioState = async (scenarioId) => {
  if (!['home', 'grigliata-manager', 'grigliata-five-peer'].includes(scenarioId)) return;
  process.env.GCLOUD_PROJECT ||= 'demo-fnd-perf';
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  const { deleteApp, initializeApp, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const app = getApps()[0] || initializeApp({ projectId: process.env.GCLOUD_PROJECT });
  const db = getFirestore(app);
  try {
    if (scenarioId === 'home') {
      await db.doc('users/perf-player').update({ 'stats.hpCurrent': 45 });
      return;
    }
    await db.doc('grigliata_token_placements/perf-map__perf-token-0000').update({
      col: 0,
      row: 0,
      updatedAt: '2026-01-01T00:00:00.000Z',
      updatedBy: 'perf-dm',
    });
  } finally {
    await deleteApp(app);
  }
};

module.exports = {
  ACCOUNT,
  aggregateMetrics,
  captureBrowserMetrics,
  countRouteResources,
  installBootstrap,
  navigateToCleanup,
  restoreScenarioState,
  runInteraction,
  storageStateForRole,
  waitForBridge,
  waitForReadiness,
  writeScenarioRaw,
  writeScenarioResult,
};
