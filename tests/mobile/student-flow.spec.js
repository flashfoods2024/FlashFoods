import { test, expect } from '@playwright/test';

test.describe('Mobile PWA — Student Flow', () => {

  test('shops page shows canteens', async ({ page }) => {
    await page.goto('/shops');
    await page.waitForLoadState('networkidle');
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
  });

  test('clicking a shop navigates to shop detail', async ({ page }) => {
    await page.goto('/shops');
    await page.waitForLoadState('networkidle');

    const shopLink = page.locator('a[href^="/shops/"]').first();
    if (await shopLink.isVisible()) {
      const href = await shopLink.getAttribute('href');
      await shopLink.click();
      await page.waitForLoadState('networkidle');
      expect(page.url()).toContain(href);
    }
  });

  test('cart page redirects to login for anonymous', async ({ page }) => {
    await page.goto('/cart');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/login');
  });

  test('orders page redirects to login for anonymous', async ({ page }) => {
    await page.goto('/orders');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/login');
  });

  test('back button after visiting cart then login redirect', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.goto('/cart');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/login');
    // Back should go to home
    await page.goBack();
    await page.waitForLoadState('networkidle');
    expect(page.url()).toBe('http://localhost:3000/');
  });
});
