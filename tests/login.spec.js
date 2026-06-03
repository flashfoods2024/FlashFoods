import { test, expect } from '@playwright/test';

test('student login test', async ({ page }) => {
  await page.goto('https://project-7h4z.onrender.com/login');

  await page.getByLabel('Email').fill('shubhamkotak@college.com');

  await page.getByLabel('Password').fill('shubham@123');

  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page).toHaveURL('https://project-7h4z.onrender.com/');
});