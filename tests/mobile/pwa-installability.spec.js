import { test, expect } from '@playwright/test';

test.describe('Mobile PWA — Installability', () => {

  test('manifest loads and parses correctly', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await page.goto('/');

    const manifest = await cdp.send('Page.getAppManifest');
    expect(manifest.errors).toEqual([]);
    expect(manifest.manifest.name).toBe('Flash Foods');
    expect(manifest.manifest.display).toBe('kStandalone');
    expect(manifest.manifest.startUrl).toBe('http://localhost:3000/');
    expect(manifest.manifest.scope).toBe('http://localhost:3000/');
    expect(manifest.manifest.id).toBe('http://localhost:3000/');
    expect(manifest.manifest.icons.length).toBeGreaterThanOrEqual(2);
  });

  test('has no installability errors', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await page.goto('/');

    const errors = await cdp.send('Page.getInstallabilityErrors');
    // in-incognito is expected in headless/emulated mode; ignore it
    const realErrors = errors.installabilityErrors.filter(e => e.errorId !== 'in-incognito');
    expect(realErrors).toEqual([]);
  });

  test('service worker is registered and active', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration('/');
      return {
        registered: !!reg,
        active: reg?.active?.state,
        scriptURL: reg?.active?.scriptURL,
      };
    });
    expect(sw.registered).toBe(true);
    expect(sw.active).toBe('activated');
    expect(sw.scriptURL).toContain('/sw.js');
  });

  test('service worker controls the page', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    expect(controlled).toBe(true);
  });

  test('manifest link exists in head', async ({ page }) => {
    await page.goto('/');
    const link = await page.evaluate(() => {
      const l = document.querySelector('link[rel="manifest"]');
      return l ? { href: l.href, rel: l.rel } : null;
    });
    expect(link).not.toBeNull();
    expect(link.href).toContain('/manifest.json');
  });

  test('icons load successfully', async ({ page }) => {
    await page.goto('/');
    const icons = await page.evaluate(async () => {
      const urls = ['/icons/icon-192x192.png', '/icon.png'];
      const results = [];
      for (const url of urls) {
        const resp = await fetch(url);
        const blob = await resp.blob();
        results.push({ url, status: resp.status, type: blob.type, size: blob.size });
      }
      return results;
    });
    for (const icon of icons) {
      expect(icon.status).toBe(200);
      expect(icon.type).toBe('image/png');
    }
  });
});
