import { test, expect } from '@playwright/test';

const VENDOR_EMAIL = 'test.vendor@flashfoods.test';

test.describe('Vendor Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(VENDOR_EMAIL);
    await page.locator('input[name="password"]').fill('Test@123');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL('/vendor/orders/pending');
  });

  test('vendor can view pending orders', async ({ page }) => {
    await page.goto('/vendor/orders/pending');
    await expect(page).toHaveURL('/vendor/orders/pending');
  });

  test('vendor can toggle shop open/closed', async ({ page }) => {
    await page.goto('/vendor/menu');
    await page.getByRole('button', { name: /open shop|close shop/i }).click();
    await expect(page.locator('.flash--success')).toBeVisible();
    await page.getByRole('button', { name: /open shop|close shop/i }).click();
    await expect(page.locator('.flash--success')).toBeVisible();
  });

  test('vendor can create a menu item', async ({ page }) => {
    await page.goto('/vendor/menu');
    const itemName = `Test Item ${Date.now()}`;
    await page.locator('form[action="/vendor/menu"] input[name="name"]').fill(itemName);
    await page.locator('form[action="/vendor/menu"] input[name="price"]').fill('50');
    await page.locator('form[action="/vendor/menu"] button[type="submit"]').click();
    await expect(page.locator('.vendor-menu-item__name', { hasText: itemName })).toBeVisible();
    page.once('dialog', (d) => d.accept());
    const row = page.locator(`tr[data-item-row]:has(.vendor-menu-item__name:text-is("${itemName}"))`);
    await row.locator('[data-delete-item]').click();
    await expect(row).toHaveCount(0);
  });

  test('vendor can view completed orders', async ({ page }) => {
    await page.goto('/vendor/orders/completed');
    await expect(page).toHaveURL('/vendor/orders/completed');
  });

  test('vendor can view payment settings', async ({ page }) => {
    await page.goto('/vendor/payment/settings');
    await expect(page).toHaveURL('/vendor/payment/settings');
  });

  test('vendor can access verify pickup page', async ({ page }) => {
    await page.goto('/vendor/verify');
    await expect(page).toHaveURL('/vendor/verify');
  });
});
