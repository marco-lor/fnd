const { test, expect } = require('@playwright/test');

const CONFIG_PATH = '/fatins-runtime/firebase-client';
const CONFIG_DELAY_MS = 750;

test.use({ trace: 'on' });

test('async runtime config remains responsive and makes one request', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  let configRequests = 0;
  let resolveConfigRequest;
  const configRequested = new Promise((resolve) => {
    resolveConfigRequest = resolve;
  });
  const browserErrors = [];

  await context.addInitScript(() => {
    window.__FND_PERF_FORCE_RUNTIME_CONFIG__ = true;
    window.__FND_BOOTSTRAP_PROBE__ = { syncXhrCount: 0, timerTicks: 0 };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function probeOpen(method, url, async = true, ...rest) {
      if (async === false) window.__FND_BOOTSTRAP_PROBE__.syncXhrCount += 1;
      return originalOpen.call(this, method, url, async, ...rest);
    };

    window.setInterval(() => {
      window.__FND_BOOTSTRAP_PROBE__.timerTicks += 1;
    }, 10);
  });

  await context.route(`**${CONFIG_PATH}`, async (route) => {
    configRequests += 1;
    resolveConfigRequest();
    await new Promise((resolve) => setTimeout(resolve, CONFIG_DELAY_MS));
    await route.continue();
  });

  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  try {
    const navigation = page.goto('/', { waitUntil: 'domcontentloaded' });
    await Promise.race([
      configRequested,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('Runtime configuration request was not observed.')),
        15_000
      )),
    ]);

    await page.waitForTimeout(250);
    const duringDelay = await page.evaluate(() => ({ ...window.__FND_BOOTSTRAP_PROBE__ }));
    expect(duringDelay.syncXhrCount).toBe(0);
    expect(duringDelay.timerTicks).toBeGreaterThan(5);
    await expect(page.getByTestId('bootstrap-screen')).toContainText('Etherium');

    await navigation;
    await expect(page.getByRole('heading', { name: 'Enter Etherium' })).toBeVisible();

    const completed = await page.evaluate(() => ({ ...window.__FND_BOOTSTRAP_PROBE__ }));
    expect(completed.syncXhrCount).toBe(0);
    expect(configRequests).toBe(1);
    expect(browserErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
