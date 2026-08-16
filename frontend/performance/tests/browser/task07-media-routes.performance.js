const { test, expect } = require('./measured-test');
const manifest = require('../../task07-media-scenarios.json');
const {
  drainPageConnections,
  installBootstrap,
  installDeterministicFontRoutes,
  isExpectedDemoRecaptchaReportOnlyWarning,
  storageStateForRole,
  waitForImageRegistrySettlement,
  waitForReadiness,
  writeScenarioResult,
} = require('./helpers');

const TASK07_GRIGLIATA_FIXTURE_TOKEN_COUNT = 200;

const task07RegistryMetrics = (registry) => ({
  'task07.registryRequestConcurrencyLimit': Number(registry?.limits?.maxConcurrentRequests),
  'task07.unpinnedRegistryRecords': Number(registry?.unpinnedRecordCount),
  'task07.unpinnedEstimatedDecodedBytes': Number(registry?.unpinnedDecodedBytes),
  'task07.totalEstimatedDecodedBytes': Number(registry?.decodedBytes),
  'task07.lowPriorityQueuedPreloads': Number(registry?.lowPriorityQueuedRequestCount),
});

const inspectManagedMedia = () => {
  const images = Array.from(document.querySelectorAll('img[data-media-state]'));
  const farViewportBottom = window.innerHeight + 300;
  const farViewportTop = -300;
  const farOffscreen = images.filter((image) => {
    const rect = image.getBoundingClientRect();
    return rect.top > farViewportBottom || rect.bottom < farViewportTop;
  });
  return {
    total: images.length,
    attached: images.filter((image) => image.hasAttribute('src')).length,
    farOffscreen: farOffscreen.length,
    farOffscreenAttached: farOffscreen.filter(
      (image) => image.hasAttribute('src')
    ).length,
    dimensionsMissing: images.filter((image) => (
      !(Number(image.getAttribute('width')) > 0)
      || !(Number(image.getAttribute('height')) > 0)
      || !image.style.aspectRatio
    )).length,
    invalidDecoding: images.filter(
      (image) => image.getAttribute('decoding') !== 'async'
    ).length,
    invalidLoading: images.filter((image) => (
      !['eager', 'lazy'].includes(image.getAttribute('loading'))
    )).length,
  };
};

for (const scenario of manifest.scenarios) {
  test(`${scenario.id} uses the bounded media renderer`, async ({
    browser,
    baseURL,
  }, testInfo) => {
    const context = await browser.newContext({
      baseURL,
      storageState: storageStateForRole(scenario.role),
    });
    await installDeterministicFontRoutes(context);
    await installBootstrap(context, scenario, 1);
    const errors = [];
    const explainedRecaptchaReportOnlyWarnings = [];
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (isExpectedDemoRecaptchaReportOnlyWarning(text, {baseURL})) {
        explainedRecaptchaReportOnlyWarnings.push(text.slice(0, 500));
        return;
      }
      errors.push(text);
    });
    page.on('pageerror', (error) => errors.push(error.message));

    try {
      await page.goto(scenario.route, { waitUntil: 'domcontentloaded' });
      await waitForReadiness(page, {
        expectedPathname: scenario.route,
        timeoutMs: 30_000,
      });
      await page.waitForFunction(
        (minimum) => (
          document.querySelectorAll('img[data-media-state]').length >= minimum
        ),
        scenario.minimumManagedImages,
        { polling: 100, timeout: 15_000 }
      );
      await page.waitForTimeout(250);

      const media = await page.evaluate(inspectManagedMedia);
      expect(media.total).toBeGreaterThanOrEqual(scenario.minimumManagedImages);
      expect(media.attached).toBeLessThanOrEqual(scenario.maximumAttachedImages);
      expect(media.dimensionsMissing).toBe(0);
      expect(media.invalidDecoding).toBe(0);
      expect(media.invalidLoading).toBe(0);
      if (scenario.assertOffscreenDetachment && media.farOffscreen > 0) {
        expect(media.farOffscreenAttached).toBe(0);
      }
      expect(errors).toEqual([]);

      if (scenario.id === 'task07-grigliata-media') {
        await page.waitForFunction(() => (
          typeof window.__FND_PERF_BENCHMARKS__?.getImageRegistryStats === 'function'
        ));
        const registry = await page.evaluate(() => (
          window.__FND_PERF_BENCHMARKS__.getImageRegistryStats()
        ));
        expect(registry.limits).toMatchObject({
          profile: 'desktop',
          maxConcurrentRequests: 4,
          maxRecords: 96,
          maxDecodedBytes: 128 * 1024 * 1024,
          maxTotalDecodedBytes: 384 * 1024 * 1024,
          maxLowPriorityQueueSize: 32,
        });
        expect(registry.unpinnedRecordCount).toBeLessThanOrEqual(96);
        expect(registry.unpinnedDecodedBytes).toBeLessThanOrEqual(128 * 1024 * 1024);
        expect(registry.decodedBytes).toBeLessThanOrEqual(384 * 1024 * 1024);
        expect(registry.lowPriorityQueuedRequestCount).toBeLessThanOrEqual(32);
        writeScenarioResult({
          id: 'task07-registry-desktop',
          route: scenario.route,
          role: scenario.role,
        }, 1, {
          environment: {
            projectName: testInfo.project.name,
            browserName: testInfo.project.use.browserName || testInfo.project.name,
            browserVersion: browser.version(),
          },
          metrics: task07RegistryMetrics(registry),
          diagnostics: {
            consoleErrors: errors,
            explainedRecaptchaReportOnlyWarnings,
          },
        });
      }
    } finally {
      await drainPageConnections(page).catch(() => {});
      await context.close();
    }
  });
}

test('compact save-data profile exposes the bounded Task 07 registry limits', async ({
  browser,
  baseURL,
}, testInfo) => {
  if (new URL(baseURL).origin !== 'http://127.0.0.1:5000') {
    throw new Error(`Task 07 compact probe refuses non-owned origin: ${baseURL}.`);
  }
  const context = await browser.newContext({
    baseURL,
    storageState: storageStateForRole('dm'),
    viewport: {width: 390, height: 844},
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: Object.freeze({saveData: true}),
    });
  });
  await installDeterministicFontRoutes(context);
  await installBootstrap(context, {
    id: 'task07-compact-save-data',
    role: 'dm',
    route: '/grigliata',
  }, 1);
  const page = await context.newPage();
  const errors = [];
  const explainedRecaptchaReportOnlyWarnings = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (isExpectedDemoRecaptchaReportOnlyWarning(text, {baseURL})) {
      explainedRecaptchaReportOnlyWarnings.push(text.slice(0, 500));
      return;
    }
    errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    await page.goto('/grigliata', {waitUntil: 'domcontentloaded'});
    await waitForReadiness(page, {
      expectedPathname: '/grigliata',
      timeoutMs: 30_000,
    });
    // Readiness can precede the active board image load. Capture only after the
    // finite registry is idle and stable, without requiring it to fill spare
    // capacity with tiny overview token art.
    const registry = await waitForImageRegistrySettlement(page, {
      minimumLoadedRecords: 1,
    });
    const snapshot = await page.evaluate(() => ({
      renderedTokenNodes: (Array.isArray(window.Konva?.stages) ? window.Konva.stages : [])
        .flatMap((stage) => Array.from(stage.find((node) => (
          String(node.getAttr?.('data-testid') || '').startsWith('token-node-')
        )))).length,
      visibleStarFields: Array.from(
        document.querySelectorAll('.global-aurora__star-field')
      ).filter((node) => getComputedStyle(node).display !== 'none').length,
      activeMeteors: document.querySelectorAll(
        '.shooting-star[data-active="true"]'
      ).length,
      meteorSlots: document.querySelectorAll('.shooting-star').length,
    }));
    expect(registry.limits).toMatchObject({
      profile: 'compact',
      maxConcurrentRequests: 2,
      maxRecords: 64,
      maxDecodedBytes: 64 * 1024 * 1024,
      maxTotalDecodedBytes: 320 * 1024 * 1024,
      maxLowPriorityQueueSize: 16,
    });
    expect(snapshot.renderedTokenNodes).toBe(TASK07_GRIGLIATA_FIXTURE_TOKEN_COUNT);
    expect(registry.loadedRecordCount).toBeGreaterThanOrEqual(1);
    expect(registry.pinnedRecordCount).toBe(1);
    expect(registry.namedPins).toContain('grigliata-active-board');
    expect(registry.unpinnedRecordCount).toBeLessThanOrEqual(registry.limits.maxRecords);
    expect(registry.unpinnedDecodedBytes).toBeLessThanOrEqual(registry.limits.maxDecodedBytes);
    expect(registry.decodedBytes).toBeLessThanOrEqual(registry.limits.maxTotalDecodedBytes);
    expect(registry.activeRequestCount).toBe(0);
    expect(registry.queuedRequestCount).toBe(0);
    expect(registry.lowPriorityQueuedRequestCount).toBe(0);
    expect(registry.droppedLowPriorityRequestCount).toBe(0);
    expect(snapshot.visibleStarFields).toBe(1);
    expect(snapshot.meteorSlots).toBe(2);
    expect(snapshot.activeMeteors).toBe(0);
    expect(errors).toEqual([]);
    writeScenarioResult({
      id: 'task07-registry-compact',
      route: '/grigliata',
      role: 'dm',
    }, 1, {
      environment: {
        projectName: testInfo.project.name,
        browserName: testInfo.project.use.browserName || testInfo.project.name,
        browserVersion: browser.version(),
      },
      metrics: task07RegistryMetrics(registry),
      diagnostics: {
        consoleErrors: errors,
        explainedRecaptchaReportOnlyWarnings,
      },
    });
  } finally {
    await drainPageConnections(page).catch(() => {});
    await context.close();
  }
});
