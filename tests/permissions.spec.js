import { test, expect } from '@playwright/test';

test.describe('Permissions', () => {
  test.describe('Unauthenticated access', () => {
    test('redirects to login for protected pages', async ({ page }) => {
      await page.goto('/cart');
      await expect(page).toHaveURL('/login');
    });

    test('redirects to login for vendor pages', async ({ page }) => {
      await page.goto('/vendor/menu');
      await expect(page).toHaveURL('/login');
    });

    test('redirects to login for admin pages', async ({ page }) => {
      await page.goto('/admin');
      await expect(page).toHaveURL('/login');
    });
  });

  test.describe('Student access', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      await page.getByLabel('Email').fill('student@college.test');
      await page.getByLabel('Password').fill('vendor@1');
      await page.getByRole('button', { name: 'Log in' }).click();
    });

    test('cannot access vendor pages', async ({ page }) => {
      await page.goto('/vendor/menu');
      await expect(page).toHaveURL('/');
    });

    test('cannot access admin pages', async ({ page }) => {
      await page.goto('/admin');
      await expect(page).toHaveURL('/');
    });

    test('can view cart', async ({ page }) => {
      await page.goto('/cart');
      await expect(page.locator('h1')).toContainText(/cart/i);
    });

    test('can view orders', async ({ page }) => {
      await page.goto('/orders');
      await expect(page).toHaveURL('/orders');
    });
  });

  test.describe('Vendor access', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      await page.getByLabel('Email').fill('vendor@college.com');
      await page.getByLabel('Password').fill('vendor@1');
      await page.getByRole('button', { name: 'Log in' }).click();
    });

    test('can access vendor menu page', async ({ page }) => {
      await page.goto('/vendor/menu');
      await expect(page).toHaveURL('/vendor/menu');
    });

    test('cannot access student cart', async ({ page }) => {
      await page.goto('/cart');
      await expect(page).toHaveURL('/');
    });

    test('cannot access admin pages', async ({ page }) => {
      await page.goto('/admin');
      await expect(page).toHaveURL('/');
    });
  });

  test.describe('Admin access', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      await page.getByLabel('Email').fill('admin@college.com');
      await page.getByLabel('Password').fill('admin@1');
      await page.getByRole('button', { name: 'Log in' }).click();
    });

    test('can access admin dashboard', async ({ page }) => {
      await page.goto('/admin');
      await expect(page).toHaveURL('/admin');
    });
  });
});
