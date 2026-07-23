/**
 * @file Student Login
 * @description Playwright-based student login automation for FlashFoods.
 * Uses the real FlashFoods login flow: GET /login → fill email/password → POST /login → redirect to /
 */

import { getLogger } from '../logger.js';
import { getConfig } from '../config/ringwatch.config.js';

/**
 * Log in as a student on FlashFoods.
 * @param {import('playwright').Browser} browser - Playwright Browser instance
 * @param {object} [overrides] - Override config for this login
 * @param {string} [overrides.email]
 * @param {string} [overrides.password]
 * @param {number} [overrides.timeout]
 * @returns {Promise<{page: import('playwright').Page, success: boolean, duration: number}>}
 */
export async function loginStudent(browser, overrides = {}) {
  const logger = getLogger();
  const config = getConfig();

  const email = overrides.email || config.student?.email;
  const password = overrides.password || config.student?.password;
  const baseUrl = overrides.baseUrl || config.baseUrl;
  const timeout = overrides.timeout || config.browser?.timeout || 30000;

  const startTime = Date.now();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();

  try {
    logger.info('Student login: navigating to /login');

    // GET /login renders auth/login.ejs with email/password form
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle', timeout });

    // Fill credentials using actual form field names from auth/login.ejs
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);

    // Click "Log in" button (exact text from auth/login.ejs)
    await page.getByRole('button', { name: 'Log in' }).click();

    // Student is redirected to / (home page) on success
    await page.waitForURL(/\/$/, { timeout });

    const duration = Date.now() - startTime;
    logger.info(`Student login successful`, { email, durationMs: duration });

    return { page, success: true, duration };
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error(`Student login failed`, { email, durationMs: duration, error: err.message });

    try {
      await page.screenshot({ path: `reports/screenshots/login-student-failure-${Date.now()}.png`, fullPage: true });
    } catch { /* ignore */ }

    await page.close().catch(() => {});
    throw new Error(`Student login failed: ${err.message}`);
  }
}

export default loginStudent;
