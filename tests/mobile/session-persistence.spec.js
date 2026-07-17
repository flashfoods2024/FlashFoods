import { test, expect } from '@playwright/test';

test.describe('Mobile PWA — Session Persistence', () => {

  test('session cookie is set on any page visit', async ({ page }) => {
    await page.goto('/');
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find(c => c.name.includes('connect.sid'));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie.httpOnly).toBe(true);
    expect(sessionCookie.sameSite).toBe('Lax');
  });

  test('session persists across page navigations', async ({ page }) => {
    await page.goto('/');
    const cookies1 = await page.context().cookies();
    const sid1 = cookies1.find(c => c.name.includes('connect.sid'));

    await page.goto('/shops');
    await page.waitForLoadState('networkidle');

    const cookies2 = await page.context().cookies();
    const sid2 = cookies2.find(c => c.name.includes('connect.sid'));

    // Session should remain the same across navigations
    expect(sid1.value).toBe(sid2.value);
  });

  test('session persists after page reload', async ({ page }) => {
    await page.goto('/');
    const cookies1 = await page.context().cookies();
    const sid1 = cookies1.find(c => c.name.includes('connect.sid'));

    await page.reload();
    await page.waitForLoadState('networkidle');

    const cookies2 = await page.context().cookies();
    const sid2 = cookies2.find(c => c.name.includes('connect.sid'));

    expect(sid1.value).toBe(sid2.value);
  });

  test('session persists after navigation away and back', async ({ page }) => {
    await page.goto('/');
    const cookies1 = await page.context().cookies();
    const sid1 = cookies1.find(c => c.name.includes('connect.sid'));

    await page.goto('http://localhost:3000/shops');
    await page.waitForLoadState('networkidle');
    await page.goto('http://localhost:3000/');
    await page.waitForLoadState('networkidle');

    const cookies2 = await page.context().cookies();
    const sid2 = cookies2.find(c => c.name.includes('connect.sid'));

    expect(sid1.value).toBe(sid2.value);
  });
});
