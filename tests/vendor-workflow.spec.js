import { test, expect } from '@playwright/test';

test.describe('Vendor Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('vendor@college.com');
    await page.getByLabel('Password').fill('vendor@1');
    await page.getByRole('button', { name: 'Log in' }).click();
  });

  test('vendor can view pending orders', async ({ page }) => {
    await page.goto('/vendor/orders/pending');
    await expect(page).toHaveURL('/vendor/orders/pending');
  });

  test('vendor can toggle shop open/closed', async ({ page }) => {
    await page.goto('/vendor/menu');
    await page.getByRole('button', { name: /open|close/i }).first().click();
    await expect(page.locator('.flash-success')).toBeVisible();
  });

  test('vendor can create a menu item', async ({ page }) => {
    await page.goto('/vendor/menu');
    const itemName = `Test Item ${Date.now()}`;
    await page.getByLabel('Name').fill(itemName);
    await page.getByLabel('Price').fill('50');
    await page.getByRole('button', { name: /add|create/i }).click();
    await expect(page.locator(`text=${itemName}`)).toBeVisible();
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
