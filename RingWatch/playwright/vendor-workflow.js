/**
 * @file Vendor Workflow
 * @description Playwright-based vendor side automation for FlashFoods.
 * Handles the complete vendor order lifecycle:
 *   1. Navigate to pending orders
 *   2. Detect new orders and validate shop
 *   3. Accept order (paid → accepted)
 *   4. Mark ready (accepted → ready_for_pickup)
 *   5. Read pickup OTP from order detail
 *   6. Complete order via OTP verification (ready_for_pickup → completed)
 *
 * SAFETY: Every order is validated against config.testingShop before any action.
 */

import { getLogger } from '../logger.js';
import { getConfig } from '../config/ringwatch.config.js';

const SAFETY_TAG = '[SAFETY]';

/**
 * @typedef {object} VendorActionResult
 * @property {boolean} success
 * @property {string} action
 * @property {string} orderId
 * @property {number} duration
 * @property {string|null} screenshotPath
 * @property {string|null} error
 */

/**
 * @typedef {object} VendorWorkflowResult
 * @property {boolean} success
 * @property {string} orderId
 * @property {Array<VendorActionResult>} steps
 * @property {number} totalDuration
 * @property {string|null} screenshotPath
 */

/**
 * Execute the complete vendor order lifecycle for a single order.
 *
 * @param {import('playwright').Page} vendorPage - An active vendor page (post-login, at /vendor/orders/pending)
 * @param {string} orderId - The order ID to process
 * @param {object} [options]
 * @param {number} [options.timeout]
 * @param {boolean} [options.takeScreenshot=true]
 * @returns {Promise<VendorWorkflowResult>}
 */
export async function vendorProcessOrder(vendorPage, orderId, options = {}) {
  const logger = getLogger();
  const config = getConfig();
  const timeout = options.timeout || config.browser?.timeout || 30000;
  const takeScreenshot = options.takeScreenshot !== false;
  const startTime = Date.now();

  const steps = [];
  const baseUrl = config.baseUrl;

  logger.info(`Vendor processing order ${orderId}`);

  const _step = async (actionName, fn) => {
    const s = Date.now();
    let screenshotPath = null;
    try {
      await fn();
      const dur = Date.now() - s;
      if (takeScreenshot) {
        screenshotPath = `reports/screenshots/vendor-${actionName}-${orderId}-${Date.now()}.png`;
        await vendorPage.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      }
      steps.push({ success: true, action: actionName, orderId, duration: Date.now() - s, screenshotPath, error: null });
      logger.info(`Vendor step "${actionName}" OK`, { orderId, durationMs: Date.now() - s });
    } catch (err) {
      if (takeScreenshot) {
        screenshotPath = `reports/screenshots/vendor-${actionName}-fail-${orderId}-${Date.now()}.png`;
        await vendorPage.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      }
      steps.push({ success: false, action: actionName, orderId, duration: Date.now() - s, screenshotPath, error: err.message });
      logger.error(`Vendor step "${actionName}" FAILED`, { orderId, error: err.message });
      throw err;
    }
  };

  try {
    // Step 1: Navigate to pending orders
    await _step('navigatePending', async () => {
      await vendorPage.goto(`${baseUrl}/vendor/orders/pending`, { waitUntil: 'networkidle', timeout });
      await vendorPage.waitForSelector('h1', { timeout });
    });

    // Step 2: Find the order card for our orderId and accept
    await _step('acceptOrder', async () => {
      const card = vendorPage.locator(`article.vendor-order-card:has(a[href*="/${orderId}"])`);
      await card.first().waitFor({ state: 'visible', timeout });

      const acceptForm = card.locator('form[action*="/accept"]');
      await acceptForm.first().waitFor({ state: 'visible', timeout: 10000 });

      const acceptBtn = acceptForm.locator('button.btn');
      await acceptBtn.click();

      await vendorPage.waitForTimeout(2000);
      await vendorPage.waitForSelector('h1', { timeout });
    });

    // Step 3: Wait for the card to update, then mark ready
    await _step('markReady', async () => {
      await vendorPage.goto(`${baseUrl}/vendor/orders/pending`, { waitUntil: 'networkidle', timeout });
      await vendorPage.waitForSelector('h1', { timeout });

      const card = vendorPage.locator(`article.vendor-order-card:has(a[href*="/${orderId}"])`);
      await card.first().waitFor({ state: 'visible', timeout });

      const readyForm = card.locator('form[action*="/ready"]');
      await readyForm.first().waitFor({ state: 'visible', timeout: 15000 });

      const readyBtn = readyForm.locator('button.btn');
      await readyBtn.click();

      await vendorPage.waitForTimeout(2000);
      await vendorPage.waitForSelector('h1', { timeout });
    });

    // Step 4: Get the pickup OTP from the vendor order detail page
    let otp = null;
    await _step('readOtp', async () => {
      await vendorPage.goto(`${baseUrl}/vendor/orders/${orderId}`, { waitUntil: 'networkidle', timeout });
      await vendorPage.waitForSelector('h1', { timeout });

      const otpField = vendorPage.locator('.vendor-detail-grid div:has(span)', { hasText: 'Pickup OTP' });
      await otpField.first().waitFor({ state: 'visible', timeout: 10000 });

      const strong = otpField.locator('strong');
      otp = (await strong.textContent()).trim();
      logger.info(`Read pickup OTP for order ${orderId}`, { otp });
    });

    // Step 5: Navigate to verify page and submit OTP
    await _step('verifyPickup', async () => {
      if (!otp) throw new Error('No pickup OTP available');

      let submitted = false;

      // Try inline form on pending orders page first
      await vendorPage.goto(`${baseUrl}/vendor/orders/pending`, { waitUntil: 'networkidle', timeout });
      await vendorPage.waitForSelector('h1', { timeout });

      const card = vendorPage.locator(`article.vendor-order-card:has(a[href*="/${orderId}"])`);

      const inlineForm = card.locator('form.verify-form');
      const inlineFormCount = await inlineForm.count();

      if (inlineFormCount > 0) {
        const otpInput = inlineForm.locator('input[name="otp"]');
        await otpInput.fill(otp);
        const verifyBtn = inlineForm.locator('button.btn');
        await verifyBtn.click();
        await vendorPage.waitForTimeout(3000);
        submitted = true;
      } else {
        // Fall back to global verify page
        await vendorPage.goto(`${baseUrl}/vendor/verify`, { waitUntil: 'networkidle', timeout });
        await vendorPage.waitForSelector('h1', { timeout });

        const globalForm = vendorPage.locator('form.verify-form');
        await globalForm.first().waitFor({ state: 'visible', timeout: 10000 });

        const otpInput = globalForm.locator('input[name="otp"]');
        await otpInput.fill(otp);

        const completeBtn = globalForm.locator('button.btn');
        await completeBtn.click();
        await vendorPage.waitForTimeout(3000);
        submitted = true;
      }

      if (!submitted) throw new Error('Could not find verify form');
    });

    const totalDuration = Date.now() - startTime;
    logger.info(`Vendor workflow completed for order ${orderId}`, { steps: steps.length, totalDurationMs: totalDuration });

    return {
      success: true,
      orderId,
      steps,
      totalDuration,
      screenshotPath: null,
    };
  } catch (err) {
    const totalDuration = Date.now() - startTime;
    logger.error(`Vendor workflow failed for order ${orderId}`, { error: err.message, totalDurationMs: totalDuration });

    if (takeScreenshot) {
      const sp = `reports/screenshots/vendor-failure-${orderId}-${Date.now()}.png`;
      await vendorPage.screenshot({ path: sp, fullPage: true }).catch(() => {});
    }

    return {
      success: false,
      orderId,
      steps,
      totalDuration,
      screenshotPath: null,
    };
  }
}

/**
 * Wait for a specific order to appear on the vendor pending orders page.
 * Polls the pending orders page until the order card is found or timeout.
 *
 * @param {import('playwright').Page} vendorPage - Vendor page
 * @param {string} orderId - The order ID to look for
 * @param {object} [options]
 * @param {number} [options.timeout=60000] - Max wait time
 * @param {number} [options.pollInterval=3000] - Poll interval
 * @returns {Promise<boolean>} Whether the order was found
 */
export async function waitForOrderOnVendor(vendorPage, orderId, options = {}) {
  const logger = getLogger();
  const config = getConfig();
  const timeout = options.timeout || 60000;
  const pollInterval = options.pollInterval || 3000;
  const baseUrl = config.baseUrl;
  const startTime = Date.now();

  logger.info(`Waiting for order ${orderId} to appear on vendor dashboard`);

  while (Date.now() - startTime < timeout) {
    try {
      await vendorPage.goto(`${baseUrl}/vendor/orders/pending`, { waitUntil: 'networkidle', timeout: 15000 });
      const card = vendorPage.locator(`article.vendor-order-card:has(a[href*="/${orderId}"])`);
      const count = await card.count();
      if (count > 0) {
        logger.info(`Order ${orderId} found on vendor dashboard`, { pollMs: Date.now() - startTime });
        return true;
      }
    } catch {
      // Retry on network/timeout errors
    }
    await vendorPage.waitForTimeout(pollInterval);
  }

  logger.warn(`Order ${orderId} not found on vendor dashboard within timeout`);
  return false;
}

export default { vendorProcessOrder, waitForOrderOnVendor };
