const { test, expect } = require('./measured-test');
const {
  drainPageConnections,
  installBootstrap,
  installDeterministicFontRoutes,
  isExpectedDemoRecaptchaReportOnlyWarning,
  storageStateForRole,
  waitForReadiness,
} = require('./helpers');

test('Task 07 media shell renders and stays dormant cross-browser', async ({
  browser,
  baseURL,
}) => {
  const scenario = {
    id: 'task07-cross-browser',
    role: 'player',
    route: '/home',
  };
  const context = await browser.newContext({
    baseURL,
    storageState: storageStateForRole('player'),
    reducedMotion: 'reduce',
  });
  if (browser.browserType().name() === 'webkit') {
    // The local Firestore emulator acknowledges Watch targets but Playwright
    // WebKit buffers the WebChannel response beyond the readiness contract.
    // Keep production/default transports for other browsers and force the
    // SDK-supported fallback only for this owned emulator probe.
    await context.addInitScript(() => {
      window.__FND_PERF_FORCE_FIRESTORE_LONG_POLLING__ = true;
    });
  }
  await installDeterministicFontRoutes(context);
  await installBootstrap(context, scenario, 1);
  const errors = [];
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (isExpectedDemoRecaptchaReportOnlyWarning(text, {baseURL})) return;
    errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    await page.goto('/home', { waitUntil: 'domcontentloaded' });
    await waitForReadiness(page, {
      expectedPathname: '/home',
      timeoutMs: 30_000,
    });
    await expect(page.locator('img[data-media-state]').first()).toBeVisible();

    const shell = await page.evaluate(() => ({
      activeAudioSources: Array.from(document.querySelectorAll('audio'))
        .filter((audio) => Boolean(audio.currentSrc || audio.getAttribute('src')))
        .length,
      audioNodes: document.querySelectorAll('audio').length,
      activeMeteors: document.querySelectorAll(
        '.shooting-star[data-active="true"]'
      ).length,
      meteorSlots: document.querySelectorAll('.shooting-star').length,
      managedImages: document.querySelectorAll('img[data-media-state]').length,
      catalogListeners: Object.entries(window.__FND_PERF__?.snapshot?.().activeListeners || {})
        .filter(([key]) => key.endsWith('::catalog.items-batch.subscribe.v1'))
        .reduce((total, [, count]) => total + Number(count || 0), 0),
    }));
    expect(shell.managedImages).toBeGreaterThanOrEqual(400);
    expect(shell.catalogListeners).toBeGreaterThan(0);
    expect(shell.catalogListeners).toBeLessThanOrEqual(50);
    expect(shell.meteorSlots).toBe(2);
    expect(shell.activeMeteors).toBe(0);
    expect(shell.audioNodes).toBeLessThanOrEqual(4);
    expect(shell.activeAudioSources).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await drainPageConnections(page).catch(() => {});
    await context.close();
  }
});
