import { test, expect } from '@playwright/test';

test.describe('Student Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('student@college.test');
    await page.getByLabel('Password').fill('vendor@1');
    await page.getByRole('button', { name: 'Log in' }).click();
  });

  test('student can browse shops', async ({ page }) => {
    await page.goto('/shops');
    await expect(page.locator('h1')).toContainText(/canteen/i);
  });

  test('student can view shop menu', async ({ page }) => {
    await page.goto('/shops/main-canteen');
    await expect(page.locator('.menu-item')).toBeVisible();
  });

  test('student can add item to cart', async ({ page }) => {
    await page.goto('/shops/main-canteen');
    await page.locator('button:has-text("Add")').first().click();
    await expect(page.locator('.flash-success')).toContainText(/Added to cart/i);
  });

  test('student can view cart', async ({ page }) => {
    await page.goto('/cart');
    await expect(page.locator('h1')).toContainText(/cart/i);
  });

  test('student can place mock order', async ({ page }) => {
    await page.goto('/shops/main-canteen');
    await page.locator('button:has-text("Add")').first().click();
    await page.goto('/orders/checkout');
    await expect(page.locator('.flash-success')).toContainText(/order/i);
  });

  test('student can view order history', async ({ page }) => {
    await page.goto('/orders');
    await expect(page).toHaveURL('/orders');
  });
});
