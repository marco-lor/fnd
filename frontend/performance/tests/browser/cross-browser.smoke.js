const { test, expect } = require('@playwright/test');
const { installBootstrap, waitForReadiness } = require('./helpers');

test('login route exposes all readiness phases', async ({ page, context }) => {
  await installBootstrap(context, { id: 'login-cross-browser', role: 'anonymous' }, 1);
  await page.goto('/');
  await waitForReadiness(page);
  await expect(page.locator('form')).toBeVisible();
});
