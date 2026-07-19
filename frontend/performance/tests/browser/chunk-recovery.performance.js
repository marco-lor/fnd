const { test, expect } = require('@playwright/test');

test('a failed Login route chunk can be retried without loading protected routes', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  const page = await context.newPage();
  let rejected = false;

  await page.route(/route-login\.[^.]+\.chunk\.js(?:\?.*)?$/, async (route) => {
    if (!rejected) {
      rejected = true;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('alert')).toContainText(/could not be loaded/i);
  await expect(page.getByRole('button', { name: 'Refresh application' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry loading' }).click();
  await expect(page.getByRole('button', { name: 'Enter', exact: true })).toBeVisible();

  const requestedScripts = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter((entry) => entry.initiatorType === 'script')
    .map((entry) => new URL(entry.name).pathname));
  expect(requestedScripts.some((assetPath) => /route-(?:grigliata|dm-dashboard|admin)/.test(assetPath))).toBe(false);
  await context.close();
});
