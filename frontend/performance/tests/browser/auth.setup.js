const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { ACCOUNT } = require('./helpers');

const authDirectory = path.resolve(__dirname, '..', '..', '..', 'playwright', '.auth');

test('create deterministic emulator authentication states', async ({ browser, baseURL }) => {
  fs.mkdirSync(authDirectory, { recursive: true });
  for (const account of Object.values(ACCOUNT)) {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await page.goto('/');
    await page.locator('input[type="email"]').fill(`${account.uid}@example.test`);
    await page.locator('input[type="password"]').fill('PerfTest!123');
    await page.locator('form button[type="submit"]').click();
    await expect(page).not.toHaveURL(/\/$/, { timeout: 30_000 });
    await context.storageState({ path: path.join(authDirectory, account.state), indexedDB: true });
    await context.close();
  }
});
