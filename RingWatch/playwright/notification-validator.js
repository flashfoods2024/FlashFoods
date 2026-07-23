/**
 * @file Notification Validator
 * @description Tracks notification delivery for specific orders.
 * Records pre-order baseline, waits for notification after order placement,
 * validates notification content matches the order, measures latency,
 * and stores evidence including Android screenshots.
 */

import { getLogger } from '../logger.js';
import { getConfig } from '../config/ringwatch.config.js';

/**
 * @typedef {object} NotificationValidationResult
 * @property {boolean} success
 * @property {string} orderId
 * @property {string|null} title
 * @property {string|null} body
 * @property {number} latencyMs
 * @property {string} detectedAt
 * @property {boolean} contentMatched
 * @property {string|null} screenshotPath
 * @property {string|null} error
 */

/**
 * @class NotificationValidator
 * @description Validates that a push notification is delivered for a given order.
 * Records timestamps, measures latency, and captures evidence.
 */
export class NotificationValidator {
  /**
   * @param {import('../monitor/notification-monitor.js').NotificationMonitor} notifMonitor
   * @param {import('../controller/adb-controller.js').AdbController} adb
   * @param {object} [config]
   */
  constructor(notifMonitor, adb, config) {
    this._notifMonitor = notifMonitor;
    this._adb = adb;
    this._config = config || getConfig();
    this._logger = getLogger();
    this._baseline = null;
  }

  /**
   * Record the current notification state BEFORE creating an order.
   * This establishes the baseline so we can detect new notifications.
   * @returns {Promise<void>}
   */
  async recordBaseline() {
    this._baseline = {
      timestamp: Date.now(),
      knownKeys: new Set(this._notifMonitor.getEvents().map(e => e.id)),
    };
    this._logger.info('Notification baseline recorded', { knownCount: this._baseline.knownKeys.size });
  }

  /**
   * Wait for a new notification to arrive after an order was placed.
   * @param {string} orderId - The order ID that was just created
   * @param {object} [options]
   * @param {number} [options.timeout=120000] - Max wait for notification
   * @param {number} [options.pollInterval=2000] - Poll interval
   * @param {boolean} [options.takeScreenshot=true]
   * @returns {Promise<NotificationValidationResult>}
   */
  async waitForNotification(orderId, options = {}) {
    const logger = this._logger;
    const timeout = options.timeout || 120000;
    const pollInterval = options.pollInterval || 2000;
    const takeScreenshot = options.takeScreenshot !== false;
    const startTime = Date.now();

    logger.info(`Waiting for notification for order ${orderId}`, { timeoutMs: timeout });

    let lastScreenshotPath = null;

    try {
      while (Date.now() - startTime < timeout) {
        const events = this._notifMonitor.getEvents();
        const newEvents = this._baseline
          ? events.filter(e => !this._baseline.knownKeys.has(e.id))
          : events;

        for (const event of newEvents) {
          const detectedAt = new Date().toISOString();
          const latencyMs = Date.now() - startTime;

          // Check if the notification content relates to this order
          const titleLower = (event.title || '').toLowerCase();
          const bodyLower = (event.body || '').toLowerCase();
          const contentMatched = titleLower.includes('order') ||
                                bodyLower.includes(orderId) ||
                                bodyLower.includes('order') ||
                                titleLower.includes('flashfoods') ||
                                titleLower.includes(this._config.testingShop);

          logger.info(`Notification detected for order ${orderId}`, {
            title: event.title,
            latencyMs,
            contentMatched,
          });

          if (takeScreenshot) {
            try {
              lastScreenshotPath = `reports/screenshots/notif-${orderId}-${Date.now()}.png`;
              const screenshotDir = lastScreenshotPath.substring(0, lastScreenshotPath.lastIndexOf('/'));
              const { existsSync, mkdirSync } = await import('fs');
              if (!existsSync(screenshotDir)) {
                mkdirSync(screenshotDir, { recursive: true });
              }
              if (this._adb && this._adb.isConnected()) {
                await this._adb.exec(`shell screencap -p /sdcard/notif-${orderId}.png`);
                await this._adb.exec(`pull /sdcard/notif-${orderId}.png ${lastScreenshotPath}`);
                await this._adb.exec(`shell rm /sdcard/notif-${orderId}.png`);
              }
            } catch {
              logger.warn('Failed to capture Android screenshot for notification');
            }
          }

          return {
            success: true,
            orderId,
            title: event.title,
            body: event.body,
            latencyMs,
            detectedAt,
            contentMatched,
            screenshotPath: lastScreenshotPath,
            error: null,
          };
        }

        await new Promise(r => setTimeout(r, pollInterval));
      }

      logger.warn(`No notification detected for order ${orderId} within timeout`);

      if (takeScreenshot) {
        try {
          lastScreenshotPath = `reports/screenshots/notif-timeout-${orderId}-${Date.now()}.png`;
          if (this._adb && this._adb.isConnected()) {
            await this._adb.exec(`shell screencap -p /sdcard/notif-timeout-${orderId}.png`);
            await this._adb.exec(`pull /sdcard/notif-timeout-${orderId}.png ${lastScreenshotPath}`);
            await this._adb.exec(`shell rm /sdcard/notif-timeout-${orderId}.png`);
          }
        } catch { /* ignore */ }
      }

      return {
        success: false,
        orderId,
        title: null,
        body: null,
        latencyMs: Date.now() - startTime,
        detectedAt: new Date().toISOString(),
        contentMatched: false,
        screenshotPath: lastScreenshotPath,
        error: 'Notification timeout - no notification detected',
      };
    } catch (err) {
      logger.error(`Notification validation error for order ${orderId}`, { error: err.message });
      return {
        success: false,
        orderId,
        title: null,
        body: null,
        latencyMs: Date.now() - startTime,
        detectedAt: new Date().toISOString(),
        contentMatched: false,
        screenshotPath: lastScreenshotPath,
        error: err.message,
      };
    }
  }

  /**
   * Record a notification validation result.
   * @param {NotificationValidationResult} result
   */
  recordResult(result) {
    this._logger.info(`Notification validation recorded`, {
      orderId: result.orderId,
      success: result.success,
      latencyMs: result.latencyMs,
    });
  }
}

export default NotificationValidator;
