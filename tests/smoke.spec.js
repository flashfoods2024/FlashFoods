import { test, expect } from '@playwright/test';

test.describe('Smoke Tests', () => {
  test('home page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/FlashFoods|Smart College/);
  });

  test('signup page loads', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('h1')).toContainText(/sign.?up/i);
  });

  test('login page loads', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h1')).toContainText(/login/i);
  });

  test('shops page loads', async ({ page }) => {
    await page.goto('/shops');
    await expect(page.locator('h1')).toContainText(/canteen/i);
  });

  test('shop detail page loads', async ({ page }) => {
    await page.goto('/shops/main-canteen');
    await expect(page.locator('h1')).toBeVisible();
  });

  test('forgot password page loads', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.locator('h1')).toContainText(/forgot/i);
  });
});
