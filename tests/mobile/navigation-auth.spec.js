import { test, expect } from '@playwright/test';

test.describe('Mobile PWA — Navigation & Auth', () => {

  test('standalone display-mode is supported', async ({ page }) => {
    await page.goto('/');
    const cdp = await page.context().newCDPSession(page);
    const manifest = await cdp.send('Page.getAppManifest');
    expect(manifest.manifest.display).toBe('kStandalone');
  });

  test('login page loads', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('h1, h2, h3').first()).toBeVisible();
    expect(page.url()).toContain('/login');
  });

  test('home page loads for anonymous user', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Flash Foods/);
    const loginLinks = page.locator('a[href="/login"]');
    expect(await loginLinks.count()).toBeGreaterThanOrEqual(1);
  });

  test('back button from /shops returns to home', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.goto('/shops');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/shops');
    await page.goBack();
    await page.waitForLoadState('networkidle');
    expect(page.url()).toBe('http://localhost:3000/');
  });

  test('back button from login returns to home', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/login');
    await page.goBack();
    await page.waitForLoadState('networkidle');
    expect(page.url()).toBe('http://localhost:3000/');
  });

  test('navigation to shops works via direct URL', async ({ page }) => {
    // On mobile, nav links may be behind hamburger toggle.
    // Using direct URL navigation is the most reliable approach.
    await page.goto('/shops');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/shops');
    const body = page.locator('body');
    await expect(body).not.toBeEmpty();
  });

  test('deep link /shops loads correctly', async ({ page }) => {
    await page.goto('/shops');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/shops');
  });
});
