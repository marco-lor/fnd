const { test, expect } = require('@playwright/test');
const manifest = require('../../scenarios.json');
const {
  aggregateMetrics,
  captureBrowserMetrics,
  countRouteResources,
  installBootstrap,
  navigateToCleanup,
  restoreScenarioState,
  runInteraction,
  storageStateForRole,
  waitForReadiness,
  writeScenarioRaw,
  writeScenarioResult,
} = require('./helpers');

const scenarios = manifest.scenarios.filter((scenario) => scenario.role !== 'five-peer');
const iterations = process.env.FND_PERF_ITERATIONS ? Number(process.env.FND_PERF_ITERATIONS) : 1;
const includeWarmup = process.env.FND_PERF_AUTHORITATIVE === '1';

for (const scenario of scenarios) {
  for (let iteration = includeWarmup ? 0 : 1; iteration <= iterations; iteration += 1) {
    const runLabel = iteration === 0 ? 'warmup' : `iteration ${iteration}`;
    test(`${scenario.id} ${runLabel}`, async ({ browser, baseURL }, testInfo) => {
      await restoreScenarioState(scenario.id);
      const diagnostics = { consoleErrors: [], unhandledErrors: [], failedRequests: [], networkRecords: [] };
      let context;
      let page;
      try {
        context = await browser.newContext({
          baseURL,
          storageState: storageStateForRole(scenario.role),
        });
        await installBootstrap(context, scenario, iteration);
        page = await context.newPage();
      page.on('console', (message) => {
        if (message.type() === 'error') diagnostics.consoleErrors.push(message.text().slice(0, 300));
      });
      page.on('pageerror', (error) => diagnostics.unhandledErrors.push(error.message.slice(0, 300)));
      page.on('requestfailed', (request) => diagnostics.failedRequests.push({
        resourceType: request.resourceType(),
        failure: request.failure()?.errorText || 'unknown',
        path: new URL(request.url()).pathname,
      }));
      page.on('response', async (response) => {
        const request = response.request();
        const headers = await response.allHeaders().catch(() => ({}));
        diagnostics.networkRecords.push({
          path: new URL(response.url()).pathname,
          resourceType: request.resourceType(),
          method: request.method(),
          status: response.status(),
          contentLength: Number(headers['content-length']) || 0,
        });
      });

      await page.goto(scenario.route, { waitUntil: 'domcontentloaded' });
      await waitForReadiness(page);
      await expect(page).toHaveURL(new RegExp(`${scenario.route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
      if (scenario.cache === 'warm') {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForReadiness(page);
      }
      await runInteraction(page, scenario);
      await page.waitForFunction(() => window.__FND_PERF__.snapshot().routeState?.interactive);
      const capture = await captureBrowserMetrics(page, diagnostics);
      if (iteration > 0) writeScenarioRaw(scenario, iteration, capture);

      const phases = new Set(capture.snapshot.events
        .filter((event) => event.category === 'route')
        .map((event) => event.metric));
      for (const phase of ['shell-visible', 'data-ready', 'interactive']) expect(phases.has(phase)).toBe(true);

      expect(diagnostics.consoleErrors, diagnostics.consoleErrors.join('\n')).toHaveLength(0);
      expect(diagnostics.unhandledErrors, diagnostics.unhandledErrors.join('\n')).toHaveLength(0);
      expect(diagnostics.failedRequests, JSON.stringify(diagnostics.failedRequests)).toHaveLength(0);

      await navigateToCleanup(page);
      await page.waitForFunction(({ route }) => (
        Object.entries(window.__FND_PERF__.snapshot().activeResources || {})
          .filter(([key]) => key.startsWith(`${route}::`))
          .filter(([key]) => !key.startsWith(`${route}::timeout`))
          .reduce((total, [, value]) => total + Number(value || 0), 0) === 0
      ), { route: scenario.route }, { timeout: 10_000 });
      const cleanup = await page.evaluate(() => window.__FND_PERF__.snapshot());
      const activeAfterCleanup = Object.entries(cleanup.activeListeners || {})
        .filter(([key]) => key.startsWith(`${scenario.route}::`))
        .reduce((total, [, value]) => total + Number(value || 0), 0);
      expect(activeAfterCleanup).toBe(0);
      const resourcesAfterCleanup = countRouteResources(cleanup.activeResources, scenario.route);
      expect(resourcesAfterCleanup).toBe(0);

      if (iteration > 0) writeScenarioResult(scenario, iteration, {
        metrics: aggregateMetrics(capture, cleanup),
        eventCount: capture.snapshot.events.length,
        readiness: Object.fromEntries(['shell-visible', 'data-ready', 'interactive'].map((phase) => [phase, phases.has(phase)])),
        resources: capture.resources,
        diagnostics: {
          consoleErrors: capture.diagnostics.consoleErrors,
          unhandledErrors: capture.diagnostics.unhandledErrors,
          failedRequests: capture.diagnostics.failedRequests,
        },
      });
      } catch (error) {
        if (page && !page.isClosed()) {
          const state = await page.evaluate(() => ({
            url: location.href,
            title: document.title,
            text: document.body?.innerText?.slice(0, 12000) || '',
            perf: window.__FND_PERF__?.snapshot?.() || null,
          })).catch(() => null);
          await testInfo.attach('page-state.json', {
            body: Buffer.from(JSON.stringify(state, null, 2)),
            contentType: 'application/json',
          });
          await testInfo.attach('failure-page.png', {
            body: await page.screenshot({ fullPage: true }),
            contentType: 'image/png',
          }).catch(() => {});
        }
        throw error;
      } finally {
        await context?.close().catch(() => {});
        await restoreScenarioState(scenario.id);
      }
    });
  }
}
