/**
 * @file Place Order
 * @description Playwright-based order placement automation for FlashFoods.
 * Follows the real FlashFoods user journey:
 *   1. Browse shop menu   → GET  /shops/:slug
 *   2. Add item to cart   → POST /cart/add
 *   3. View cart          → GET  /cart
 *   4. Place mock order   → POST /orders/checkout
 *   5. Order confirmation → GET  /orders/:id
 *
 * SAFETY: This module must NEVER order from any shop other than
 * `config.testingShop`. The shop slug is validated before every order
 * and auto-discovery is prohibited — any redirect to /shops listing is
 * treated as a fatal error.
 */

import { getLogger } from '../logger.js';
import { getConfig } from '../config/ringwatch.config.js';

/**
 * @typedef {object} PlaceOrderResult
 * @property {boolean} success
 * @property {string|null} orderId
 * @property {number} duration
 * @property {string|null} screenshotPath
 */

/**
 * Place an order via the student's page using the real FlashFoods flow.
 *
 * @param {import('playwright').Page} page - An active student page (post-login)
 * @param {object} [overrides]
 * @param {string} [overrides.shopSlug] - Must match config.testingShop or omitted
 * @param {string} [overrides.orderType] - "dinein" | "parcel"
 * @param {number} [overrides.menuItemIndex] - Index of the menu item to add (default 0)
 * @param {number} [overrides.timeout]
 * @param {boolean} [overrides.takeScreenshot=true]
 * @returns {Promise<PlaceOrderResult>}
 */
export async function placeOrder(page, overrides = {}) {
  const logger = getLogger();
  const config = getConfig();

  const baseUrl = overrides.baseUrl || config.baseUrl;
  const shopSlug = overrides.shopSlug || config.testingShop;
  const orderType = overrides.orderType || config.order?.orderType || 'dinein';
  const menuItemIndex = overrides.menuItemIndex ?? 0;
  const timeout = overrides.timeout || config.browser?.timeout || 30000;
  const takeScreenshot = overrides.takeScreenshot !== false;

  if (shopSlug !== config.testingShop) {
    throw new Error(
      `SAFETY BLOCKED: Attempted to place order for shop "${shopSlug}" but ` +
      `config.testingShop is "${config.testingShop}". Only the testing shop is permitted.`
    );
  }

  const startTime = Date.now();
  let orderId = null;
  let screenshotPath = null;

  try {
    // ---- Step 1: Navigate to shop menu page ----
    // Actual route: GET /shops/:slug renders shops/menu.ejs
    logger.info(`Step 1: Navigating to shop menu /shops/${shopSlug}`);
    await page.goto(`${baseUrl}/shops/${shopSlug}`, { waitUntil: 'networkidle', timeout });
    await page.waitForSelector('h1', { timeout });

    // Confirm we're on a shop menu page (not the listing /shops page)
    const currentUrl = page.url();
    if (!currentUrl.includes('/shops/')) {
      throw new Error(
        `SAFETY BLOCKED: Navigated to /shops/${shopSlug} but ended up at ${currentUrl}. ` +
        `The testing shop "${shopSlug}" may not exist. No auto-discovery is permitted.`
      );
    }

    // ---- Step 2: Add a menu item to cart ----
    logger.info(`Step 2: Adding menu item #${menuItemIndex} to cart`);

    const addToCartButtons = page.locator('button.action-btn--primary:has-text("Add to Cart")');
    const buttonCount = await addToCartButtons.count();

    if (buttonCount === 0) {
      // Diagnostic: log what IS in the action column
      const actionCells = page.locator('.import-table tbody tr td:last-child');
      const cellCount = await actionCells.count();
      logger.warn(`No Add to Cart buttons among ${cellCount} menu rows. Dumping action cells:`);
      for (let i = 0; i < Math.min(cellCount, 3); i++) {
        const html = await actionCells.nth(i).evaluate(el => el.innerHTML.trim().substring(0, 200));
        logger.warn(`  Row ${i} action: ${html}`);
      }
      const h1Text = await page.locator('h1').first().textContent().catch(() => '?');
      throw new Error(
        `No "Add to Cart" buttons found on ${currentUrl} (h1="${h1Text}"). ` +
        `Shop may be closed or all items sold out.`
      );
    }

    if (menuItemIndex >= buttonCount) {
      throw new Error(`menuItemIndex ${menuItemIndex} exceeds available items (${buttonCount})`);
    }

    logger.info(`Found ${buttonCount} "Add to Cart" buttons, clicking index ${menuItemIndex}`);
    await addToCartButtons.nth(menuItemIndex).click();

    // Wait for the flash success message after adding to cart
    await page.waitForSelector('.flash--success, .flash-success', { timeout: 10000 }).catch(() => {
      logger.warn('Flash success message not detected after adding to cart');
    });

    // ---- Step 3: Navigate to cart ----
    // Actual route: GET /cart renders cart/index.ejs (requires student auth)
    logger.info('Step 3: Navigating to cart');
    await page.goto(`${baseUrl}/cart`, { waitUntil: 'networkidle', timeout });
    await page.waitForSelector('h1', { timeout });

    // ---- Step 4: Place order via mock checkout ----
    // Actual route: POST /orders/checkout creates a mock "paid" order.
    logger.info('Step 4: Submitting mock checkout');

    const pickupTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const resp = await page.request.post(`${baseUrl}/orders/checkout`, {
      form: { orderType, pickupTime },
    });

    const finalUrl = resp.url();
    const idMatch = finalUrl.match(/\/orders\/([a-f0-9]+)/i);
    if (!idMatch) {
      throw new Error(`Checkout did not redirect to /orders/:id. Final URL: ${finalUrl}`);
    }
    orderId = idMatch[1];

    // ---- Step 5: Navigate to order confirmation page ----
    // Actual route: GET /orders/:id renders orders/show.ejs
    logger.info(`Step 5: Order confirmed — navigating to /orders/${orderId}`);
    await page.goto(finalUrl, { waitUntil: 'networkidle', timeout });
    await page.waitForSelector('h1', { timeout });

    if (takeScreenshot) {
      screenshotPath = `reports/screenshots/order-${orderId}-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }

    const duration = Date.now() - startTime;
    logger.info(`Order placed successfully`, { orderId, shopSlug, orderType, durationMs: duration });

    return { success: true, orderId, duration, screenshotPath };
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error(`Order placement failed`, { orderId, shopSlug, durationMs: duration, error: err.message });

    if (takeScreenshot) {
      try {
        screenshotPath = `reports/screenshots/order-failure-${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
      } catch { /* ignore */ }
    }

    throw new Error(`Order placement failed: ${err.message}`);
  }
}

/**
 * Wait for an order to reach a terminal status (ready_for_pickup or completed).
 * Polls GET /api/orders/:id/status (the actual route used by the app).
 *
 * @param {import('playwright').Page} page - Student page currently on the order page
 * @param {object} [options]
 * @param {number} [options.timeout=300000] - Max wait in ms (default 5 min)
 * @param {number} [options.pollInterval=5000] - Poll interval in ms
 * @returns {Promise<{completed: boolean, finalStatus: string}>}
 */
export async function waitForOrderCompletion(page, options = {}) {
  const logger = getLogger();
  const timeout = options.timeout || 300000;
  const pollInterval = options.pollInterval || 5000;
  const startTime = Date.now();

  // Extract order ID from current URL
  const url = page.url();
  const idMatch = url.match(/\/orders\/([a-f0-9]+)/i);
  if (!idMatch) {
    logger.warn('Cannot determine order ID from URL to poll status');
    return { completed: false, finalStatus: 'unknown' };
  }
  const orderId = idMatch[1];

  const terminalStatuses = ['ready_for_pickup', 'completed', 'cancelled'];

  logger.info(`Waiting for order ${orderId} completion`);

  while (Date.now() - startTime < timeout) {
    try {
      const resp = await page.request.get(`/api/orders/${orderId}/status`);
      if (resp.ok()) {
        const data = await resp.json();
        if (terminalStatuses.includes(data.status)) {
          const duration = Date.now() - startTime;
          logger.info(`Order reached terminal status`, { status: data.status, durationMs: duration });
          return { completed: data.status === 'ready_for_pickup' || data.status === 'completed', finalStatus: data.status };
        }
      }
    } catch { /* network error, retry */ }

    await page.waitForTimeout(pollInterval);
  }

  logger.warn('Order completion timeout reached');
  return { completed: false, finalStatus: 'timeout' };
}

export default placeOrder;
