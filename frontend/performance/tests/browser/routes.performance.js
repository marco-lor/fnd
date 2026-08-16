const { test, expect } = require('./measured-test');
const manifest = require('../../scenarios.json');
const {
  aggregateMetrics,
  captureBrowserMetrics,
  countRouteResources,
  createPageAssetTracker,
  drainPageConnections,
  flushBrowserObservers,
  installBootstrap,
  installDeterministicFontRoutes,
  isExpectedDemoRecaptchaCancellation,
  isExpectedDemoRecaptchaReportOnlyWarning,
  navigateToCleanup,
  retainImageResourceTimings,
  retainLongTaskEntries,
  restoreScenarioState,
  runInteraction,
  storageStateForRole,
  warmBrowserAssetDelivery,
  waitForReadiness,
  writeScenarioRaw,
  writeScenarioResult,
} = require('./helpers');

const scenarios = manifest.scenarios.filter((scenario) => scenario.scheduledOnly !== true);
const iterations = process.env.FND_PERF_ITERATIONS ? Number(process.env.FND_PERF_ITERATIONS) : 1;
const includeWarmup = process.env.FND_PERF_AUTHORITATIVE === '1';

const markScenarioPhase = (page, phase) => page.evaluate((nextPhase) => {
  window.__FND_PERF__?.mark?.('scenario-phase', { phase: nextPhase });
}, phase);

const waitForFinitePageAssets = async (pageAssets, scenarioId, phase) => {
  await expect.poll(
    () => pageAssets.isQuiet(),
    {
      timeout: 10_000,
      message: `Finite page assets did not settle ${phase} for ${scenarioId}.`,
    }
  ).toBe(true);
};

const waitForStableLargestContentfulPaint = async (
  page,
  scenarioId,
  { quietMs = 500, timeoutMs = 5_000 } = {}
) => {
  const deadline = Date.now() + timeoutMs;
  let lastSignature = '';
  let unchangedSince = Date.now();

  while (Date.now() < deadline) {
    await flushBrowserObservers(page);
    const signature = await page.evaluate(() => {
      const events = window.__FND_PERF__?.snapshot?.().events || [];
      const latest = [...events].reverse().find((event) => (
        event.category === 'web-vital' && event.metric === 'LCP'
      ));
      return latest
        ? `${Number(latest.value)}:${Number(latest.timestamp)}`
        : '';
    });
    if (signature !== lastSignature) {
      lastSignature = signature;
      unchangedSince = Date.now();
    }
    if (lastSignature && Date.now() - unchangedSince >= quietMs) return;
    await page.waitForTimeout(50);
  }

  throw new Error(
    `Largest Contentful Paint did not settle before interaction for ${scenarioId}.`
  );
};

const assertChunkIsolation = (scenario, diagnostics) => {
  const scriptPaths = diagnostics.networkRecords
    .filter((record) => record.resourceType === 'script')
    .map((record) => record.path);
  const noneMatch = (pattern, message) => {
    expect(scriptPaths.some((assetPath) => pattern.test(assetPath)), `${message}\n${scriptPaths.join('\n')}`).toBe(false);
  };

  if (scenario.id === 'login-cold' || scenario.id === 'login-warm') {
    noneMatch(/route-(?:grigliata|echi-di-viaggio|dm-dashboard|foes-hub|admin|bazaar)/, 'Login requested an inactive route chunk.');
    noneMatch(/feature-(?:grigliata|bazaar|dm-)/, 'Login requested an inactive feature chunk.');
  }
  if (scenario.id === 'home') {
    noneMatch(/route-grigliata|feature-grigliata/, 'Home requested Grigliata code.');
  }
  if (scenario.id === 'bazaar') {
    noneMatch(/feature-bazaar-.*-editor/, 'Ordinary Bazaar requested an editor chunk.');
  }
};

for (const scenario of scenarios) {
  for (let iteration = includeWarmup ? 0 : 1; iteration <= iterations; iteration += 1) {
    const runLabel = iteration === 0 ? 'warmup' : `iteration ${iteration}`;
    test(`${scenario.id} ${runLabel}`, async ({ browser, baseURL }, testInfo) => {
      await restoreScenarioState(scenario.id);
      const diagnostics = {
        consoleErrors: [],
        explainedRecaptchaCancellations: [],
        explainedRecaptchaReportOnlyWarnings: [],
        unhandledErrors: [],
        failedRequests: [],
        networkRecords: [],
      };
      let context;
      let page;
      let lifecyclePhase = 'route-navigation';
      try {
        context = await browser.newContext({
          baseURL,
          storageState: storageStateForRole(scenario.role),
        });
        await warmBrowserAssetDelivery({
          baseURL,
          context,
          owner: `context-chromium-${scenario.id}-${iteration}`,
        });
        await installDeterministicFontRoutes(context);
        await installBootstrap(context, scenario, iteration);
        page = await context.newPage();
        const pageAssets = createPageAssetTracker();
        page.on('request', (request) => pageAssets.begin(request));
        page.on('requestfinished', (request) => pageAssets.complete(request));
        page.on('console', (message) => {
          if (message.type() !== 'error') return;
          const text = message.text();
          if (isExpectedDemoRecaptchaReportOnlyWarning(text, {baseURL})) {
            diagnostics.explainedRecaptchaReportOnlyWarnings.push(text.slice(0, 500));
            return;
          }
          diagnostics.consoleErrors.push(text.slice(0, 300));
        });
        page.on('pageerror', (error) => diagnostics.unhandledErrors.push(error.message.slice(0, 300)));
        page.on('requestfailed', (request) => {
          pageAssets.complete(request);
          const failure = {
            resourceType: request.resourceType(),
            failure: request.failure()?.errorText || 'unknown',
            path: (() => {
              try { return new URL(request.url()).pathname; } catch { return '[invalid-url]'; }
            })(),
          };
          if (isExpectedDemoRecaptchaCancellation({
            ...failure,
            lifecyclePhase,
            url: request.url(),
          })) {
            diagnostics.explainedRecaptchaCancellations.push({
              ...failure,
              phase: lifecyclePhase,
            });
            return;
          }
          diagnostics.failedRequests.push(failure);
        });
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
      await markScenarioPhase(page, 'route-readiness');
      await waitForReadiness(page);
      await markScenarioPhase(page, 'route-active');
      lifecyclePhase = 'route-active';
      await expect(page).toHaveURL(new RegExp(`${scenario.route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
      if (scenario.cache === 'warm') {
        lifecyclePhase = 'route-navigation';
        await page.reload({ waitUntil: 'domcontentloaded' });
        await markScenarioPhase(page, 'route-readiness');
        await waitForReadiness(page);
        await markScenarioPhase(page, 'route-active');
        lifecyclePhase = 'route-active';
      }
      await markScenarioPhase(page, 'asset-settlement');
      await waitForFinitePageAssets(pageAssets, scenario.id, 'before interaction');
      await markScenarioPhase(page, 'lcp-settlement');
      await waitForStableLargestContentfulPaint(page, scenario.id);
      await markScenarioPhase(page, 'interaction');
      await runInteraction(page, scenario, {
        settleFiniteAssets: async (phase) => {
          pageAssets.beginQuietWindow();
          await flushBrowserObservers(page);
          await waitForFinitePageAssets(pageAssets, scenario.id, phase);
        },
      });
      await markScenarioPhase(page, 'post-interaction-settlement');
      assertChunkIsolation(scenario, diagnostics);
      await page.waitForFunction(() => window.__FND_PERF__.snapshot().routeState?.interactive);
      pageAssets.beginQuietWindow();
      await flushBrowserObservers(page);
      await waitForFinitePageAssets(pageAssets, scenario.id, 'after interaction and observer flush');
      await markScenarioPhase(page, 'capture');
      const capture = await captureBrowserMetrics(page, diagnostics);
      const retainedLongTasks = retainLongTaskEntries(capture.snapshot.events);
      expect(
        capture.resourceTimingBufferOverflow,
        `Resource Timing buffer overflowed for ${scenario.id}.`
      ).toBe(false);
      if (iteration > 0) writeScenarioRaw(scenario, iteration, capture);

      const phases = new Set(capture.snapshot.events
        .filter((event) => event.category === 'route')
        .map((event) => event.metric));
      for (const phase of ['shell-visible', 'data-ready', 'interactive']) expect(phases.has(phase)).toBe(true);

      expect(diagnostics.consoleErrors, diagnostics.consoleErrors.join('\n')).toHaveLength(0);
      expect(diagnostics.unhandledErrors, diagnostics.unhandledErrors.join('\n')).toHaveLength(0);
      expect(diagnostics.failedRequests, JSON.stringify(diagnostics.failedRequests)).toHaveLength(0);

      lifecyclePhase = 'route-cleanup';
      await navigateToCleanup(page);
      await page.waitForFunction(({ route }) => (
        Object.entries(window.__FND_PERF__.snapshot().activeResources || {})
          .filter(([key]) => key.startsWith(`${route}::`))
          .filter(([key]) => !key.startsWith(`${route}::timeout`))
          .reduce((total, [, value]) => total + Number(value || 0), 0) === 0
      ), { route: scenario.route }, { polling: 100, timeout: 10_000 });
      const cleanup = await page.evaluate(() => window.__FND_PERF__.snapshot());
      const activeAfterCleanup = Object.entries(cleanup.activeListeners || {})
        .filter(([key]) => key.startsWith(`${scenario.route}::`))
        .reduce((total, [, value]) => total + Number(value || 0), 0);
      expect(activeAfterCleanup).toBe(0);
      const resourcesAfterCleanup = countRouteResources(cleanup.activeResources, scenario.route);
      expect(resourcesAfterCleanup).toBe(0);
      const timeoutsAfterCleanup = Object.entries(cleanup.activeResources || {})
        .filter(([key]) => key.startsWith(`${scenario.route}::timeout`))
        .reduce((total, [, value]) => total + Number(value || 0), 0);
      expect(timeoutsAfterCleanup).toBe(0);
      expect(Number(cleanup.media?.activeSources || 0)).toBe(0);

      if (iteration > 0) writeScenarioResult(scenario, iteration, {
        environment: {
          projectName: testInfo.project.name,
          browserName: testInfo.project.use.browserName || testInfo.project.name,
          browserVersion: browser.version(),
        },
        metrics: aggregateMetrics(capture, cleanup),
        eventCount: capture.snapshot.events.length,
        readiness: Object.fromEntries(['shell-visible', 'data-ready', 'interactive'].map((phase) => [phase, phases.has(phase)])),
        resources: capture.resources,
        diagnostics: {
          consoleErrors: capture.diagnostics.consoleErrors,
          explainedRecaptchaCancellations:
            diagnostics.explainedRecaptchaCancellations,
          explainedRecaptchaReportOnlyWarnings:
            diagnostics.explainedRecaptchaReportOnlyWarnings,
          unhandledErrors: capture.diagnostics.unhandledErrors,
          failedRequests: capture.diagnostics.failedRequests,
          // These arrays contain only the bounded, text-free fields captured
          // by helpers.js. Keeping them in each scenario result preserves the
          // exact candidate identity and image timeline in both authoritative
          // snapshots; raw iteration files are intentionally reused by run B.
          lcpCandidates: capture.diagnostics.lcpCandidates,
          imageResourceTimingCount: capture.diagnostics.imageResourceTimings.length,
          imageResourceTimings: retainImageResourceTimings(
            capture.diagnostics.imageResourceTimings
          ),
          longTaskEntryCount: retainedLongTasks.totalCount,
          longTaskEntries: retainedLongTasks.entries,
        },
      });
      } catch (error) {
        if (page && !page.isClosed()) {
          const state = await page.evaluate(() => ({
            url: window.location.href,
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
        await drainPageConnections(page).catch(() => {});
        await context?.close().catch(() => {});
        await restoreScenarioState(scenario.id);
      }
    });
  }
}
