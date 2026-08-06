import { test, expect } from '@playwright/test';

const ACTIVE_SHOP = 'hummusery';

test.describe('Student Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('student@college.test');
    await page.locator('input[name="password"]').fill('vendor@1');
    await page.getByRole('button', { name: 'Log in' }).click();
  });

  test('student can browse shops', async ({ page }) => {
    await page.goto('/shops');
    await expect(page.locator('h1')).toContainText(/canteen/i);
  });

  test('student can view shop menu', async ({ page }) => {
    await page.goto(`/shops/${ACTIVE_SHOP}`);
    await expect(page.locator('.import-table tbody tr').first()).toBeVisible();
  });

  test('student can add item to cart', async ({ page }) => {
    await page.goto(`/shops/${ACTIVE_SHOP}`);
    await page.locator('form[action="/cart/add"]').first().locator('button[type="submit"]').click();
    await expect(page.locator('.flash--success')).toContainText(/added to cart/i);
  });

  test('student can view cart', async ({ page }) => {
    await page.goto('/cart');
    await expect(page.locator('h1')).toContainText(/cart/i);
  });

  test('student can place mock order', async ({ page }) => {
    await page.goto(`/shops/${ACTIVE_SHOP}`);
    await page.locator('form[action="/cart/add"]').first().locator('button[type="submit"]').click();
    await expect(page.locator('.flash--success')).toContainText(/added to cart/i);
    const resp = await page.request.post('/orders/checkout', {
      form: {
        orderType: 'dinein',
        pickupTime: new Date(Date.now() + 3600_000).toISOString(),
      },
      maxRedirects: 0,
    });
    expect(resp.status()).toBe(302);
    const location = resp.headers()['location'] || '';
    expect(location).toMatch(/^\/orders\/[a-f0-9]{24}$/);
    await page.goto(location);
    await expect(page.locator('.flash--success')).toContainText(/order/i);
  });

  test('student can view order history', async ({ page }) => {
    await page.goto('/orders');
    await expect(page).toHaveURL('/orders');
  });
});
