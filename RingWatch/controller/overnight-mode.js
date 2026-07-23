/**
 * @file Overnight Mode
 * @description Automated overnight testing loop for RingWatch.
 * Repeats the following cycle until stopped:
 *   1. Student logs in
 *   2. Place test order
 *   3. Wait for push notification
 *   4. Verify notification content
 *   5. Vendor logs in
 *   6. Accept order
 *   7. Complete order
 *   8. Wait configurable interval
 *   9. Repeat
 *
 * Supports fixed duration, infinite mode, repeat count, and graceful recovery.
 */

import { getLogger } from '../logger.js';
import { getConfig } from '../config/ringwatch.config.js';
import { loginStudent } from '../playwright/login-student.js';
import { loginVendor } from '../playwright/login-vendor.js';
import { placeOrder } from '../playwright/place-order.js';
import { vendorProcessOrder, waitForOrderOnVendor } from '../playwright/vendor-workflow.js';
import { NotificationValidator } from '../playwright/notification-validator.js';
import { NotificationMonitor } from '../monitor/notification-monitor.js';
import { AdbController } from './adb-controller.js';

/**
 * @typedef {object} OvernightCycleResult
 * @property {number} cycleIndex
 * @property {boolean} success
 * @property {string|null} orderId
 * @property {object} orderResult
 * @property {object} notificationResult
 * @property {object} vendorResult
 * @property {number} duration
 * @property {string|null} error
 * @property {Array<object>} timeline
 */

/**
 * @typedef {object} OvernightSummary
 * @property {number} cyclesCompleted
 * @property {number} ordersCreated
 * @property {number} ordersCompleted
 * @property {number} notificationsReceived
 * @property {number} notificationsMissed
 * @property {number} avgLatencyMs
 * @property {number} minLatencyMs
 * @property {number} maxLatencyMs
 * @property {number} failures
 * @property {Array<{cycle: number, error: string}>} failureReasons
 * @property {number} reliabilityScore
 * @property {number} totalDuration
 * @property {string} startTime
 * @property {string} endTime
 */

/**
 * @class OvernightMode
 * @description Runs the overnight testing loop with configurable duration, cycles, and error recovery.
 */
export class OvernightMode {
  /**
   * @param {object} config
   * @param {import('playwright').Browser} browser
   * @param {NotificationMonitor} notifMonitor
   * @param {AdbController} adb
   */
  constructor(config, browser, notifMonitor, adb) {
    this._config = config || getConfig();
    this._browser = browser;
    this._notifMonitor = notifMonitor;
    this._adb = adb;
    this._logger = getLogger();
    this._notifValidator = new NotificationValidator(notifMonitor, adb, config);
    this._cycles = [];
    this._running = false;
    this._stopRequested = false;
  }

  /**
   * Run the overnight test.
   * @param {object} [options]
   * @param {number} [options.durationMs] - Max run duration
   * @param {number} [options.maxCycles] - Max cycle count
   * @param {number} [options.intervalMs] - Wait between cycles
   * @param {boolean} [options.infinite=false] - Run until stopped
   * @returns {Promise<{cycles: Array<OvernightCycleResult>, summary: OvernightSummary}>}
   */
  async run(options = {}) {
    const config = this._config;
    const overnightCfg = config.overnight || {};

    const durationMs = options.durationMs || overnightCfg.durationMs || 8 * 60 * 60 * 1000;
    const maxCycles = options.maxCycles || overnightCfg.maxCycles || 999999;
    const intervalMs = options.intervalMs || overnightCfg.intervalMs || 15 * 60 * 1000;
    const infinite = options.infinite || overnightCfg.infinite || false;

    const startTime = Date.now();
    const endTime = startTime + durationMs;

    this._running = true;
    this._stopRequested = false;
    this._cycles = [];

    this._logger.info('=== RINGWATCH OVERNIGHT MODE STARTED ===');
    this._logger.info(`Duration: ${durationMs}ms, Max cycles: ${maxCycles}, Interval: ${intervalMs}ms`);
    this._logger.info(`Expected end time: ${new Date(endTime).toISOString()}`);

    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║     RINGWATCH — OVERNIGHT TEST MODE         ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Duration:    ${_fmtDuration(durationMs).padEnd(36)}║`);
    console.log(`║  Max cycles:  ${String(maxCycles).padEnd(36)}║`);
    console.log(`║  Interval:    ${_fmtDuration(intervalMs).padEnd(36)}║`);
    console.log(`║  Start time:  ${new Date(startTime).toLocaleTimeString().padEnd(36)}║`);
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');

    let cycleIndex = 0;
    let studentPage = null;
    let vendorPage = null;

    try {
      while (this._running && !this._stopRequested) {
        cycleIndex++;

        if (!infinite && cycleIndex > maxCycles) {
          this._logger.info(`Reached max cycles (${maxCycles}), stopping`);
          break;
        }

        if (!infinite && Date.now() >= endTime) {
          this._logger.info(`Reached duration limit, stopping`);
          break;
        }

        this._logger.info(`=== Overnight cycle ${cycleIndex} ===`);
        console.log(`\n--- Cycle ${cycleIndex} at ${new Date().toLocaleTimeString()} ---`);

        const cycleStart = Date.now();
        const cycleTimeline = [];

        const _recordTimeline = (action, data) => {
          cycleTimeline.push({ action, timestamp: Date.now(), ...data });
        };

        let orderId = null;

        try {
          // ---- Step 1: Student login ----
          _recordTimeline('loginStudent', { status: 'started' });
          this._logger.info(`Cycle ${cycleIndex}: Student login`);
          const studentResult = await loginStudent(this._browser);
          studentPage = studentResult.page;
          _recordTimeline('loginStudent', { status: 'ok', duration: studentResult.duration });

          // ---- Step 2: Record notification baseline ----
          await this._notifValidator.recordBaseline();
          _recordTimeline('baseline', { status: 'ok' });

          // ---- Step 3: Place test order ----
          _recordTimeline('order', { status: 'started' });
          this._logger.info(`Cycle ${cycleIndex}: Placing order`);
          const orderResult = await placeOrder(studentPage, { shopSlug: config.testingShop });
          orderId = orderResult.orderId;
          _recordTimeline('order', { status: 'ok', orderId, duration: orderResult.duration });
          this._logger.info(`Cycle ${cycleIndex}: Order created`, { orderId });

          // ---- Step 4: Wait for and validate notification ----
          _recordTimeline('notification', { status: 'started' });
          this._logger.info(`Cycle ${cycleIndex}: Waiting for notification`);
          const notifResult = await this._notifValidator.waitForNotification(orderId);
          _recordTimeline('notification', {
            status: notifResult.success ? 'ok' : 'missed',
            latencyMs: notifResult.latencyMs,
          });

          // ---- Step 5: Vendor login ----
          _recordTimeline('loginVendor', { status: 'started' });
          this._logger.info(`Cycle ${cycleIndex}: Vendor login`);
          const vendorResult = await loginVendor(this._browser);
          vendorPage = vendorResult.page;
          _recordTimeline('loginVendor', { status: 'ok', duration: vendorResult.duration });

          // ---- Step 6: Wait for order on vendor dashboard ----
          _recordTimeline('vendorFindOrder', { status: 'started' });
          const found = await waitForOrderOnVendor(vendorPage, orderId);
          _recordTimeline('vendorFindOrder', { status: found ? 'ok' : 'not_found' });

          if (!found) {
            throw new Error(`Order ${orderId} never appeared on vendor dashboard`);
          }

          // ---- Step 7: Process order (accept → ready → verify) ----
          _recordTimeline('vendorProcess', { status: 'started' });
          const vendorWorkflow = await vendorProcessOrder(vendorPage, orderId);
          _recordTimeline('vendorProcess', {
            status: vendorWorkflow.success ? 'ok' : 'failed',
            steps: vendorWorkflow.steps.length,
          });

          const cycleDuration = Date.now() - cycleStart;

          const cycleResult = {
            cycleIndex,
            success: notifResult.success && vendorWorkflow.success,
            orderId,
            orderResult,
            notificationResult: notifResult,
            vendorResult: vendorWorkflow,
            duration: cycleDuration,
            error: null,
            timeline: cycleTimeline,
          };

          this._cycles.push(cycleResult);

          this._logger.info(`Cycle ${cycleIndex} completed`, {
            success: cycleResult.success,
            orderId,
            durationMs: cycleDuration,
          });

          // Print cycle summary
          const icon = cycleResult.success ? '\u2705' : '\u274C';
          const notifIcon = notifResult.success ? '\u2705' : '\uD83D\uDD35';
          const latencyStr = notifResult.success ? `${notifResult.latencyMs}ms` : 'N/A';
          console.log(`${icon} Cycle ${cycleIndex}: Order #${orderId} | Notif ${notifIcon} ${latencyStr} | Vendor ${vendorWorkflow.success ? '\u2705' : '\u274C'}`);

          // ---- Step 8: Wait for interval before next cycle ----
          if (Date.now() < endTime && cycleIndex < maxCycles) {
            this._logger.info(`Waiting ${intervalMs}ms before next cycle`);
            await this._sleep(intervalMs);
          }

        } catch (cycleErr) {
          const cycleDuration = Date.now() - cycleStart;

          const cycleResult = {
            cycleIndex,
            success: false,
            orderId,
            orderResult: null,
            notificationResult: null,
            vendorResult: null,
            duration: cycleDuration,
            error: cycleErr.message,
            timeline: cycleTimeline,
          };

          this._cycles.push(cycleResult);

          this._logger.error(`Cycle ${cycleIndex} failed`, { error: cycleErr.message });

          console.log(`\u274C Cycle ${cycleIndex} FAILED: ${cycleErr.message}`);

          // Graceful recovery: close stale pages, wait, retry
          try {
            if (studentPage && !studentPage.isClosed()) await studentPage.close();
          } catch { /* ignore */ }
          try {
            if (vendorPage && !vendorPage.isClosed()) await vendorPage.close();
          } catch { /* ignore */ }

          studentPage = null;
          vendorPage = null;

          // Wait before retry to avoid rapid failure loops
          await this._sleep(30000);

          // Continue to next cycle (graceful recovery)
          if (!infinite && cycleIndex >= maxCycles) break;
        }

        // Close pages between cycles to avoid memory leaks
        try {
          if (studentPage && !studentPage.isClosed()) {
            const ctx = studentPage.context();
            await ctx.close();
          }
        } catch { /* ignore */ }
        try {
          if (vendorPage && !vendorPage.isClosed()) {
            const ctx = vendorPage.context();
            await ctx.close();
          }
        } catch { /* ignore */ }

        studentPage = null;
        vendorPage = null;
      }
    } finally {
      this._running = false;
    }

    const summary = this._generateSummary(startTime);
    const totalDuration = Date.now() - startTime;

    this._logger.info('=== RINGWATCH OVERNIGHT MODE FINISHED ===');
    this._logger.info(`Cycles: ${summary.cyclesCompleted}, Score: ${summary.reliabilityScore}%`);

    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║      RINGWATCH — OVERNIGHT RESULTS          ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Duration:        ${_fmtDuration(totalDuration).padEnd(36)}║`);
    console.log(`║  Cycles:          ${String(summary.cyclesCompleted).padEnd(36)}║`);
    console.log(`║  Orders created:  ${String(summary.ordersCreated).padEnd(36)}║`);
    console.log(`║  Orders completed:${String(summary.ordersCompleted).padEnd(36)}║`);
    console.log(`║  Notifications:   ${String(summary.notificationsReceived).padEnd(36)}║`);
    console.log(`║  Missed:          ${String(summary.notificationsMissed).padEnd(36)}║`);
    console.log(`║  Avg latency:     ${_fmtDuration(summary.avgLatencyMs).padEnd(36)}║`);
    console.log(`║  Reliability:     ${String(summary.reliabilityScore).padEnd(3)}%${' '.repeat(33)}║`);
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');

    return { cycles: this._cycles, summary };
  }

  /**
   * Request graceful stop at end of current cycle.
   */
  stop() {
    this._stopRequested = true;
    this._logger.info('Stop requested — will stop after current cycle');
  }

  /**
   * Generate summary statistics from completed cycles.
   * @param {number} startTime
   * @returns {OvernightSummary}
   */
  _generateSummary(startTime) {
    const completed = this._cycles.filter(c => c.success);
    const failed = this._cycles.filter(c => !c.success);
    const notificationsReceived = this._cycles.filter(c => c.notificationResult?.success);
    const notificationsMissed = this._cycles.filter(c => c.notificationResult && !c.notificationResult.success);

    const latencies = notificationsReceived.map(c => c.notificationResult.latencyMs);

    const totalCycles = this._cycles.length;

    return {
      cyclesCompleted: totalCycles,
      ordersCreated: totalCycles,
      ordersCompleted: completed.length,
      notificationsReceived: notificationsReceived.length,
      notificationsMissed: notificationsMissed.length,
      avgLatencyMs: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
      minLatencyMs: latencies.length > 0 ? Math.min(...latencies) : 0,
      maxLatencyMs: latencies.length > 0 ? Math.max(...latencies) : 0,
      failures: failed.length,
      failureReasons: failed.map(c => ({ cycle: c.cycleIndex, error: c.error || 'Unknown' })),
      reliabilityScore: totalCycles > 0 ? Math.round((completed.length / totalCycles) * 100) : 0,
      totalDuration: Date.now() - startTime,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date().toISOString(),
    };
  }

  /**
   * Get all cycle results.
   * @returns {Array<OvernightCycleResult>}
   */
  getCycles() {
    return [...this._cycles];
  }

  /**
   * Get summary.
   * @returns {OvernightSummary}
   */
  getSummary() {
    if (this._cycles.length === 0) return null;
    return this._generateSummary(this._cycles[0]?.timeline[0]?.timestamp || Date.now());
  }

  /** @returns {boolean} */
  isRunning() { return this._running; }

  /**
   * Sleep helper.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Format duration in ms to human-readable string.
 * @param {number} ms
 * @returns {string}
 */
function _fmtDuration(ms) {
  if (!ms && ms !== 0) return '0ms';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = ((ms % 60000) / 1000).toFixed(0);
  if (min < 60) return `${min}m ${sec}s`;
  const hours = Math.floor(min / 60);
  const mins = min % 60;
  return `${hours}h ${mins}m ${sec}s`;
}

export default OvernightMode;
