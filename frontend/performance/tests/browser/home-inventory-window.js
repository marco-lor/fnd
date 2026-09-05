const { expect } = require('@playwright/test');

// The fixture still contains 500 items; Task 08 mounts them in windows of 60.
const assertInitialHomeInventoryWindow = async (page) => {
  await expect(page.locator('[data-home-inventory-row]')).toHaveCount(60);
  await expect(page.getByRole('button', {
    name: 'Load more inventory items, 440 remaining', exact: true,
  })).toBeVisible();
};

const assertRemainingHomeInventoryAccessible = async (page) => {
  await page.getByRole('button', {name: 'Load more inventory items, 440 remaining', exact: true}).click();
  await expect(page.locator('[data-home-inventory-row]')).toHaveCount(120);
  await page.getByPlaceholder('Cerca nome o tipo…').fill('Fixture item 499');
  await expect(page.locator('[data-home-inventory-row]')).toHaveCount(1);
  await expect(page.locator('[data-home-inventory-row]')).toContainText('Fixture item 499');
};

module.exports = { assertInitialHomeInventoryWindow, assertRemainingHomeInventoryAccessible };
