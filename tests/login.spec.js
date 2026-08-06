import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('student login with valid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('student@college.test');
    await page.locator('input[name="password"]').fill('vendor@1');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL('/');
  });

  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('student@college.test');
    await page.locator('input[name="password"]').fill('wrongpassword');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.locator('.flash--error')).toBeVisible();
  });

  test('signup creates new account', async ({ page }) => {
    const email = `test-${Date.now()}@test.com`;
    await page.goto('/signup');
    await page.getByLabel('Name').fill('Test User');
    await page.getByLabel('Email').fill(email);
    await page.locator('input[name="password"]').fill('test123456');
    await page.getByRole('button', { name: 'Sign Up' }).click();
    await expect(page).toHaveURL('/');
  });
});
