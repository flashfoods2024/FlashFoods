/**
 * @file Schedule
 * @description Scenario scheduling engine — executes a timeline of actions (ADB, Playwright, waits, loops).
 */

import { getLogger } from '../logger.js';
import { getConfig } from '../config/ringwatch.config.js';
import { AdbController } from './adb-controller.js';
import { NotificationMonitor } from '../monitor/notification-monitor.js';
import { LogcatMonitor } from '../monitor/logcat-monitor.js';
import { ChromeMonitor } from '../monitor/chrome-monitor.js';
import { FirebaseMonitor } from '../monitor/firebase-monitor.js';
import { loginStudent } from '../playwright/login-student.js';
import { loginVendor } from '../playwright/login-vendor.js';
import { placeOrder, waitForOrderCompletion } from '../playwright/place-order.js';
import { vendorProcessOrder, waitForOrderOnVendor } from '../playwright/vendor-workflow.js';
import { NotificationValidator } from '../playwright/notification-validator.js';

/**
 * @typedef {object} TimelineEvent
 * @property {string} id
 * @property {string} type - 'action' | 'wait' | 'loop' | 'error' | 'complete'
 * @property {string} action - The action name
 * @property {number} timestamp
 * @property {number} duration
 * @property {object} [data]
 * @property {boolean} [success]
 * @property {string} [error]
 */

/**
 * @class ScenarioEngine
 * @description Reads a scenario from config and executes it step-by-step.
 */
export class ScenarioEngine {
  /**
   * @param {object} deps
   * @param {AdbController} deps.adb
   * @param {NotificationMonitor} deps.notificationMonitor
   * @param {LogcatMonitor} deps.logcatMonitor
   * @param {ChromeMonitor} deps.chromeMonitor
   * @param {FirebaseMonitor} deps.firebaseMonitor
   * @param {import('playwright').Browser} [deps.browser]
   * @param {object} [config]
   */
  constructor(deps, config) {
    this._adb = deps.adb;
    this._notifMonitor = deps.notificationMonitor;
    this._logcatMonitor = deps.logcatMonitor;
    this._chromeMonitor = deps.chromeMonitor;
    this._firebaseMonitor = deps.firebaseMonitor;
    this._browser = deps.browser || null;
    this._config = config || getConfig();
    this._logger = getLogger();

    /** @type {Array<TimelineEvent>} */
    this._timeline = [];
    this._studentPage = null;
    this._vendorPage = null;
    this._notifValidator = this._notifMonitor
      ? new NotificationValidator(this._notifMonitor, this._adb, this._config)
      : null;
  }

  /**
   * Execute a full scenario array.
   * @param {Array<object>} scenario - Array of scenario steps
   * @returns {Promise<Array<TimelineEvent>>}
   *
   * @example
   * [
   *   { action: 'order' },
   *   { action: 'wait', duration: 300000 },
   *   { action: 'order' },
   *   { action: 'wait', duration: 900000 },
   *   { action: 'order' },
   *   { action: 'wait', duration: 1800000 },
   *   { action: 'order' },
   * ]
   */
  async executeScenario(scenario) {
    this._logger.info(`Executing scenario with ${scenario.length} steps`);
    this._timeline = [];
    let stepIndex = 0;

    for (const step of scenario) {
      stepIndex++;
      this._logger.info(`Scenario step ${stepIndex}/${scenario.length}`, { action: step.action });

      try {
        await this._executeStep(step, stepIndex);
      } catch (err) {
        this._logger.error(`Scenario step ${stepIndex} failed`, { action: step.action, error: err.message });
        this._timeline.push({
          id: `step_${stepIndex}_${Date.now()}`,
          type: 'error',
          action: step.action,
          timestamp: Date.now(),
          duration: 0,
          error: err.message,
          success: false,
        });

        // Decide whether to stop or continue based on config
        if (this._config.scenario?.stopOnFailure !== false) {
          this._logger.warn('Scenario stopped due to failure (stopOnFailure=true)');
          break;
        }
      }
    }

    this._logger.info(`Scenario completed: ${this._timeline.length} timeline events`);
    return this.getTimeline();
  }

  /**
   * Execute a single scenario step.
   * @param {object} step
   * @param {number} index
   */
  async _executeStep(step, index) {
    const startTime = Date.now();
    const stepId = `step_${index}_${startTime}`;

    switch (step.action) {
      // --- Playwright actions ---
      case 'loginStudent': {
        if (!this._browser) throw new Error('Browser not available');
        const result = await loginStudent(this._browser, step.config);
        this._studentPage = result.page;
        this._recordTimeline(stepId, 'action', 'loginStudent', startTime, result);
        break;
      }

      case 'loginVendor': {
        if (!this._browser) throw new Error('Browser not available');
        const result = await loginVendor(this._browser, step.config);
        this._vendorPage = result.page;
        this._recordTimeline(stepId, 'action', 'loginVendor', startTime, result);
        break;
      }

      case 'order': {
        if (!this._studentPage) throw new Error('Student not logged in. Run loginStudent first.');
        const orderConfig = {
          shopSlug: step.config?.shopSlug || this._config.testingShop,
          orderType: step.config?.orderType || this._config.order?.orderType,
        };
        const result = await placeOrder(this._studentPage, orderConfig);
        this._recordTimeline(stepId, 'action', 'order', startTime, result);
        break;
      }

      case 'waitForOrder': {
        if (!this._studentPage) throw new Error('Student not logged in');
        const completed = await waitForOrderCompletion(this._studentPage, step.config);
        this._recordTimeline(stepId, 'action', 'waitForOrder', startTime, { completed });
        break;
      }

      // --- Notification validation ---
      case 'notifBaseline': {
        if (!this._notifValidator) throw new Error('Notification monitor not available');
        await this._notifValidator.recordBaseline();
        this._recordTimeline(stepId, 'action', 'notifBaseline', startTime, {});
        break;
      }

      case 'notifWait': {
        if (!this._notifValidator) throw new Error('Notification monitor not available');
        const orderId = step.config?.orderId;
        if (!orderId) throw new Error('notifWait requires step.config.orderId');
        const timeout = step.config?.timeout || this._config.overnight?.notificationTimeoutMs || 120000;
        const result = await this._notifValidator.waitForNotification(orderId, { timeout });
        this._recordTimeline(stepId, 'action', 'notifWait', startTime, result);
        break;
      }

      // --- Vendor workflow ---
      case 'vendorFindOrder': {
        if (!this._vendorPage) throw new Error('Vendor not logged in. Run loginVendor first.');
        const vOrderId = step.config?.orderId;
        if (!vOrderId) throw new Error('vendorFindOrder requires step.config.orderId');
        const vTimeout = step.config?.timeout || this._config.overnight?.vendorTimeoutMs || 60000;
        const found = await waitForOrderOnVendor(this._vendorPage, vOrderId, { timeout: vTimeout });
        this._recordTimeline(stepId, 'action', 'vendorFindOrder', startTime, { orderId: vOrderId, found });
        if (!found) throw new Error(`Order ${vOrderId} not found on vendor dashboard within timeout`);
        break;
      }

      case 'vendorProcess': {
        if (!this._vendorPage) throw new Error('Vendor not logged in');
        const pOrderId = step.config?.orderId;
        if (!pOrderId) throw new Error('vendorProcess requires step.config.orderId');
        const result = await vendorProcessOrder(this._vendorPage, pOrderId, step.config);
        this._recordTimeline(stepId, 'action', 'vendorProcess', startTime, result);
        if (!result.success) throw new Error(`Vendor processing failed for order ${pOrderId}`);
        break;
      }

      // --- ADB actions ---
      case 'launchApp': {
        await this._adb.launchApp(step.config?.packageName);
        this._recordTimeline(stepId, 'action', 'launchApp', startTime, {});
        break;
      }

      case 'closeApp': {
        await this._adb.closeApp(step.config?.packageName);
        this._recordTimeline(stepId, 'action', 'closeApp', startTime, {});
        break;
      }

      case 'wakeDevice': {
        await this._adb.wakeDevice();
        this._recordTimeline(stepId, 'action', 'wakeDevice', startTime, {});
        break;
      }

      case 'sleepDevice': {
        await this._adb.sleepDevice();
        this._recordTimeline(stepId, 'action', 'sleepDevice', startTime, {});
        break;
      }

      case 'checkDeviceState': {
        const state = await this._adb.collectDeviceState();
        this._recordTimeline(stepId, 'action', 'checkDeviceState', startTime, state);
        break;
      }

      // --- Flow control ---
      case 'wait': {
        const duration = step.duration || step.config?.duration || this._config.scenario?.defaultWaitMs || 5000;
        this._logger.info(`Waiting ${duration}ms`);
        this._recordTimeline(stepId, 'wait', `wait_${duration}ms`, startTime, { duration });
        await this._sleep(duration);
        break;
      }

      case 'loop': {
        const iterations = step.iterations || step.config?.iterations || 1;
        const loopSteps = step.steps || [];
        this._logger.info(`Loop ${iterations}x over ${loopSteps.length} steps`);

        for (let i = 0; i < iterations; i++) {
          this._logger.debug(`Loop iteration ${i + 1}/${iterations}`);
          for (const loopStep of loopSteps) {
            await this._executeStep({ ...loopStep, config: { ...step.config, ...loopStep.config } }, `${index}_${i}`);
          }
        }

        this._recordTimeline(stepId, 'loop', `loop_${iterations}x`, startTime, { iterations });
        break;
      }

      case 'screenshot': {
        if (this._studentPage) {
          const path = `reports/screenshots/scenario-${index}-${Date.now()}.png`;
          await this._studentPage.screenshot({ path, fullPage: true });
          this._recordTimeline(stepId, 'action', 'screenshot', startTime, { path });
        }
        break;
      }

      default: {
        this._logger.warn(`Unknown scenario action: "${step.action}"`);
        this._recordTimeline(stepId, 'error', step.action, startTime, { warning: `Unknown action: ${step.action}` });
      }
    }
  }

  /**
   * Record a timeline event.
   */
  _recordTimeline(id, type, action, startTime, data) {
    this._timeline.push({
      id,
      type,
      action,
      timestamp: startTime,
      duration: Date.now() - startTime,
      data: data || {},
      success: true,
      error: null,
    });
  }

  /** @returns {Array<TimelineEvent>} */
  getTimeline() {
    return [...this._timeline];
  }

  /**
   * Get the student page (if logged in).
   * @returns {import('playwright').Page|null}
   */
  getStudentPage() { return this._studentPage; }

  /**
   * Get the vendor page (if logged in).
   * @returns {import('playwright').Page|null}
   */
  getVendorPage() { return this._vendorPage; }

  /**
   * Set the Playwright browser instance.
   * @param {import('playwright').Browser} browser
   */
  setBrowser(browser) { this._browser = browser; }

  /**
   * Sleep helper.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default ScenarioEngine;
