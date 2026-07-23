/**
 * @file Vendor Login
 * @description Playwright-based vendor login automation for FlashFoods.
 * Vendors use the same /login page as students. After POST /login, the server
 * checks the role and redirects vendors to /vendor/orders/pending.
 */

import { getLogger } from '../logger.js';
import { getConfig } from '../config/ringwatch.config.js';

/**
 * Log in as a vendor on FlashFoods.
 * @param {import('playwright').Browser} browser - Playwright Browser instance
 * @param {object} [overrides] - Override config for this login
 * @param {string} [overrides.email]
 * @param {string} [overrides.password]
 * @param {number} [overrides.timeout]
 * @returns {Promise<{page: import('playwright').Page, success: boolean, duration: number}>}
 */
export async function loginVendor(browser, overrides = {}) {
  const logger = getLogger();
  const config = getConfig();

  const email = overrides.email || config.vendor?.email;
  const password = overrides.password || config.vendor?.password;
  const baseUrl = overrides.baseUrl || config.baseUrl;
  const timeout = overrides.timeout || config.browser?.timeout || 30000;

  const startTime = Date.now();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  try {
    logger.info('Vendor login: navigating to /login');

    // NOTE: There is NO /vendor/login route. All users use the shared /login page.
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle', timeout });

    // Fill credentials using actual form field names from auth/login.ejs
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);

    // Click "Log in" button (exact text from auth/login.ejs)
    await page.getByRole('button', { name: 'Log in' }).click();

    // Vendor is redirected to /vendor/orders/pending on success
    await page.waitForURL(/\/vendor\/orders\/pending/, { timeout });

    const duration = Date.now() - startTime;
    logger.info(`Vendor login successful`, { email, durationMs: duration });

    return { page, success: true, duration };
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error(`Vendor login failed`, { email, durationMs: duration, error: err.message });

    try {
      await page.screenshot({ path: `reports/screenshots/login-vendor-failure-${Date.now()}.png`, fullPage: true });
    } catch { /* ignore */ }

    await page.close().catch(() => {});
    throw new Error(`Vendor login failed: ${err.message}`);
  }
}

export default loginVendor;
