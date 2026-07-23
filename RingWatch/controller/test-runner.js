/**
 * @file Test Runner
 * @description Orchestrates the full RingWatch test lifecycle:
 *   init → connect ADB → launch browser → execute scenario → collect logs → generate reports → cleanup
 */

import { getLogger } from '../logger.js';
import { getConfig } from '../config/ringwatch.config.js';
import { AdbController } from './adb-controller.js';
import { ScenarioEngine } from './schedule.js';
import { NotificationMonitor } from '../monitor/notification-monitor.js';
import { LogcatMonitor } from '../monitor/logcat-monitor.js';
import { ChromeMonitor } from '../monitor/chrome-monitor.js';
import { FirebaseMonitor } from '../monitor/firebase-monitor.js';
import { ReportManager } from '../reports/report-manager.js';

/**
 * @typedef {object} TestRunResult
 * @property {boolean} passed
 * @property {number} reliabilityScore
 * @property {Array} timeline
 * @property {Array} notifications
 * @property {Array} logcatEvents
 * @property {Array} chromeEvents
 * @property {Array} firebaseMessages
 * @property {Array} deviceStates
 * @property {Array} logs
 * @property {object} summary
 * @property {string} reportPath
 * @property {string} jsonReportPath
 */

/**
 * @class TestRunner
 * @description Main orchestrator for RingWatch notification reliability tests.
 */
export class TestRunner {
  /**
   * @param {object} [config]
   * @param {object} [logger]
   */
  constructor(config, logger) {
    this._config = config || getConfig();
    this._logger = logger || getLogger();
    this._logger.info('TestRunner initialised');

    // Sub-modules
    this._adb = null;
    this._browser = null;
    this._notifMonitor = null;
    this._logcatMonitor = null;
    this._chromeMonitor = null;
    this._firebaseMonitor = null;
    this._scenarioEngine = null;
    this._deviceStates = [];
  }

  /**
   * Run the full RingWatch test cycle.
   * @param {Array<object>} [scenario] - Optional scenario steps (defaults to config)
   * @returns {Promise<TestRunResult>}
   */
  async run(scenario) {
    const startTime = Date.now();
    this._logger.info('=== RingWatch Test Run Started ===');

    try {
      // 1. Initialise ADB
      await this._initAdb();

      // 2. Initialise monitors
      this._initMonitors();

      // 3. Launch Playwright browser
      await this._initBrowser();

      // 4. Execute scenario
      const scenarioSteps = scenario || this._config.scenario?.steps || this._defaultScenario();
      this._scenarioEngine = new ScenarioEngine({
        adb: this._adb,
        notificationMonitor: this._notifMonitor,
        logcatMonitor: this._logcatMonitor,
        chromeMonitor: this._chromeMonitor,
        firebaseMonitor: this._firebaseMonitor,
        browser: this._browser,
      }, this._config);

      // Start notification polling
      this._notifMonitor.start();

      // Run the scenario
      const timeline = await this._scenarioEngine.executeScenario(scenarioSteps);

      // Stop monitoring
      const notifications = this._notifMonitor.stop();

      // Collect additional state snapshots
      await this._collectDeviceState();

      // 5. Generate reports
      const { reportPath, jsonReportPath, summary } = await this._generateReports({
        startTime,
        timeline,
        notifications,
      });

      const totalDuration = Date.now() - startTime;
      const passed = summary.failures === 0;
      const reliabilityScore = this._calculateReliability(summary);

      this._logger.info(`=== RingWatch Test Run Complete ===`, {
        passed,
        reliabilityScore: `${reliabilityScore}%`,
        durationMs: totalDuration,
      });

      return {
        passed,
        reliabilityScore,
        timeline,
        notifications,
        safetyChecks: [],
        logcatEvents: this._logcatMonitor.getEvents(),
        chromeEvents: this._chromeMonitor.getEvents(),
        firebaseMessages: this._firebaseMonitor.getMessages(),
        deviceStates: this._deviceStates,
        logs: this._logger.getBuffer(),
        summary,
        reportPath: reportPath || null,
        jsonReportPath: jsonReportPath || null,
      };
    } catch (err) {
      this._logger.error(`Test run failed`, { error: err.message });
      // Still try to generate a partial report
      await this._generateReports({
        startTime,
        timeline: this._scenarioEngine?.getTimeline() || [],
        notifications: this._notifMonitor?.getEvents() || [],
        fatalError: err.message,
      }).catch(() => {});
      throw err;
    } finally {
      await this._cleanup();
    }
  }

  /**
   * Initialise ADB controller and detect device.
   */
  async _initAdb() {
    this._logger.info('Initialising ADB...');
    this._adb = new AdbController(this._config);

    const devices = await this._adb.detectDevices();
    if (devices.length === 0) {
      this._logger.warn('No Android devices detected. Running in browser-only mode.');
      return;
    }

    const verified = await this._adb.verifyUsbDebugging();
    if (!verified) {
      this._logger.warn('USB debugging not verified. Running in browser-only mode.');
      return;
    }

    // Clear logcat for fresh monitoring
    await this._adb.clearLogcat();
    this._logger.info('ADB initialised', { device: this._adb.getDeviceId() });
  }

  /**
   * Initialise all monitors.
   */
  _initMonitors() {
    this._notifMonitor = new NotificationMonitor(this._adb, this._config);
    this._logcatMonitor = new LogcatMonitor(this._adb, this._config);
    this._chromeMonitor = new ChromeMonitor(this._config);
    this._firebaseMonitor = new FirebaseMonitor(this._config);
    this._logger.info('Monitors initialised');
  }

  /**
   * Launch Playwright browser.
   */
  async _initBrowser() {
    this._logger.info('Launching Playwright browser...');
    try {
      const { chromium } = await import('playwright');
      const browserConfig = this._config.browser || {};
      this._browser = await chromium.launch({
        headless: browserConfig.headless ?? false,
        slowMo: browserConfig.slowMo ?? 100,
        timeout: browserConfig.timeout ?? 30000,
      });

      // Connect Chrome monitor via CDP
      await this._chromeMonitor.connect(this._browser);

      this._logger.info('Playwright browser launched');
    } catch (err) {
      this._logger.error('Failed to launch Playwright', { error: err.message });
      throw new Error(`Browser launch failed: ${err.message}`);
    }
  }

  /**
   * Collect a device state snapshot.
   */
  async _collectDeviceState() {
    if (this._adb?.isConnected()) {
      try {
        const state = await this._adb.collectDeviceState();
        this._deviceStates.push(state);
      } catch (err) {
        this._logger.warn('Failed to collect device state', { error: err.message });
      }
    }
  }

  /**
   * Generate all reports using the new ReportManager.
   */
  async _generateReports(data) {
    this._logger.info('Generating reports...');

    const summary = {
      totalSteps: data.timeline.length,
      passed: data.timeline.filter(t => t.success !== false).length,
      failures: data.timeline.filter(t => t.success === false).length,
      notificationsDetected: data.notifications.length,
      totalDuration: Date.now() - data.startTime,
      startTime: new Date(data.startTime).toISOString(),
      endTime: new Date().toISOString(),
      fatalError: data.fatalError || null,
    };

    const reportData = { ...data, summary };

    const reportManager = new ReportManager(this._config);
    const result = await reportManager.generateAllReports(reportData);

    this._logger.info(`Reports generated in ${result.runDir}`);

    return {
      reportPath: result.reportHtml,
      jsonReportPath: result.reportJson,
      summary,
      runDir: result.runDir,
    };
  }

  /**
   * Calculate reliability score.
   * @param {object} summary
   * @returns {number} 0-100
   */
  _calculateReliability(summary) {
    if (summary.totalSteps === 0) return 0;
    return Math.round((summary.passed / summary.totalSteps) * 100);
  }

  /**
   * Default scenario if none provided.
   * @returns {Array<object>}
   */
  _defaultScenario() {
    const shopSlug = this._config.testingShop;
    return [
      { action: 'loginStudent' },
      { action: 'order', config: { shopSlug, orderType: 'dinein' } },
      { action: 'wait', duration: 300000 }, // 5 min
      { action: 'order', config: { shopSlug, orderType: 'dinein' } },
      { action: 'wait', duration: 900000 }, // 15 min
      { action: 'order', config: { shopSlug, orderType: 'dinein' } },
      { action: 'wait', duration: 1800000 }, // 30 min
      { action: 'order', config: { shopSlug, orderType: 'dinein' } },
      { action: 'checkDeviceState' },
    ];
  }

  /**
   * Cleanup resources.
   */
  async _cleanup() {
    this._logger.info('Cleaning up...');

    // Close browser pages
    if (this._scenarioEngine) {
      const studentPage = this._scenarioEngine.getStudentPage();
      if (studentPage) {
        try {
          const context = studentPage.context();
          await context.close();
        } catch { /* ignore */ }
      }
      const vendorPage = this._scenarioEngine.getVendorPage();
      if (vendorPage) {
        try {
          const context = vendorPage.context();
          await context.close();
        } catch { /* ignore */ }
      }
    }

    // Disconnect Chrome monitor
    await this._chromeMonitor?.disconnect().catch(() => {});

    // Close browser
    if (this._browser) {
      try {
        await this._browser.close();
        this._logger.info('Browser closed');
      } catch (err) {
        this._logger.warn('Browser close error', { error: err.message });
      }
    }
  }
}

export default TestRunner;
