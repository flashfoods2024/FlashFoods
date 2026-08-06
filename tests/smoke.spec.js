import { test, expect } from '@playwright/test';

test.describe('Smoke Tests', () => {
  test('home page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Flash Foods/);
  });

  test('signup page loads', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('h2')).toContainText(/create account/i);
  });

  test('login page loads', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h2')).toContainText(/log in/i);
  });

  test('shops page loads', async ({ page }) => {
    await page.goto('/shops');
    await expect(page.locator('h1')).toContainText(/canteen/i);
  });

  test('shop detail page loads', async ({ page }) => {
    await page.goto('/shops/hummusery');
    await expect(page.locator('h1')).toContainText(/hummusery/i);
  });

  test('forgot password page loads', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.locator('h2')).toContainText(/forgot/i);
  });
});
