const { test, expect } = require('./measured-test');
const {
  drainPageConnections,
  installBootstrap,
  installDeterministicFontRoutes,
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
  await installDeterministicFontRoutes(context);
  await installBootstrap(context, scenario, 1);
  const errors = [];
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
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
      meteors: document.querySelectorAll('.shooting-star').length,
      managedImages: document.querySelectorAll('img[data-media-state]').length,
    }));
    expect(shell.managedImages).toBeGreaterThan(0);
    expect(shell.meteors).toBe(0);
    expect(shell.audioNodes).toBeLessThanOrEqual(4);
    expect(shell.activeAudioSources).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await drainPageConnections(page).catch(() => {});
    await context.close();
  }
});
