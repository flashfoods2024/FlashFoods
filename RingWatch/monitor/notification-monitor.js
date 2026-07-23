/**
 * @file Notification Monitor
 * @description Monitors Android notifications via ADB, records delivery events and latency.
 */

import { getLogger } from '../logger.js';
import { getConfig } from '../config/ringwatch.config.js';
import { AdbController } from '../controller/adb-controller.js';

/**
 * @typedef {object} NotificationEvent
 * @property {string} id - Unique event ID
 * @property {string} title - Notification title
 * @property {string} body - Notification body text
 * @property {string} packageName - Source app package
 * @property {string} detectedAt - ISO timestamp when detected
 * @property {number} latencyMs - Estimated delivery latency
 * @property {string} source - How it was detected (adb/logcat/firebase)
 */

/**
 * @class NotificationMonitor
 * @description Polls device notifications and records structured events.
 */
export class NotificationMonitor {
  /**
   * @param {AdbController} adb - Initialised ADB controller
   * @param {object} [config]
   */
  constructor(adb, config) {
    /** @type {AdbController} */
    this._adb = adb;
    this._config = config || getConfig();
    this._logger = getLogger();
    /** @type {Array<NotificationEvent>} */
    this._events = [];
    /** @type {Set<string>} */
    this._seenKeys = new Set();
    this._polling = false;
    this._pollTimer = null;
    this._startTime = null;
  }

  /**
   * Start polling for notifications.
   * @param {object} [options]
   * @param {number} [options.intervalMs=2000] - Poll interval
   * @param {number} [options.durationMs] - Stop after this duration (optional)
   */
  start(options = {}) {
    if (this._polling) return;

    const interval = options.intervalMs || this._config.monitoring?.pollIntervalMs || 2000;
    this._polling = true;
    this._startTime = Date.now();
    this._logger.info(`Notification monitor started (interval: ${interval}ms)`);

    const poll = async () => {
      if (!this._polling) return;
      try {
        await this._poll();
      } catch (err) {
        this._logger.error('Notification poll error', { error: err.message });
      }
      this._pollTimer = setTimeout(poll, interval);
    };

    this._pollTimer = setTimeout(poll, interval);

    // Auto-stop if duration specified
    if (options.durationMs) {
      setTimeout(() => this.stop(), options.durationMs);
    }
  }

  /**
   * Stop polling.
   * @returns {Array<NotificationEvent>} Events collected so far
   */
  stop() {
    this._polling = false;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    this._logger.info(`Notification monitor stopped`, { totalEvents: this._events.length });
    return this._events;
  }

  /**
   * Single poll cycle.
   */
  async _poll() {
    const notifications = await this._adb.readNotificationHistory();
    const now = Date.now();

    for (const n of notifications) {
      // Deduplicate
      const dedupKey = n.key || `${n.title}|${n.text}|${n.when}`;
      if (this._seenKeys.has(dedupKey)) continue;
      this._seenKeys.add(dedupKey);

      // Calculate latency (best-effort using 'when' field)
      let latencyMs = 0;
      if (n.when) {
        const whenTs = parseInt(n.when, 10);
        if (!isNaN(whenTs)) {
          latencyMs = now - whenTs;
        }
      }

      /** @type {NotificationEvent} */
      const event = {
        id: `notif_${now}_${this._events.length}`,
        title: n.title || '(no title)',
        body: n.text || '(no body)',
        packageName: n.packageName || 'unknown',
        detectedAt: new Date(now).toISOString(),
        latencyMs: Math.max(0, latencyMs),
        source: 'adb',
      };

      this._events.push(event);
      this._logger.info(`Notification detected`, { title: event.title, latencyMs: event.latencyMs });
    }
  }

  /**
   * Get all recorded notification events.
   * @returns {Array<NotificationEvent>}
   */
  getEvents() {
    return [...this._events];
  }

  /**
   * Get events filtered by package name.
   * @param {string} packageName
   * @returns {Array<NotificationEvent>}
   */
  getEventsByPackage(packageName) {
    return this._events.filter(e => e.packageName === packageName);
  }

  /**
   * Calculate statistics for collected events.
   * @returns {object}
   */
  getStats() {
    if (this._events.length === 0) {
      return { total: 0, avgLatencyMs: 0, minLatencyMs: 0, maxLatencyMs: 0, flashfoodsCount: 0 };
    }

    const latencies = this._events.map(e => e.latencyMs);
    const flashfoodsEvents = this._events.filter(
      e => e.packageName && e.packageName.toLowerCase().includes('flashfoods')
    );

    return {
      total: this._events.length,
      avgLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      minLatencyMs: Math.min(...latencies),
      maxLatencyMs: Math.max(...latencies),
      flashfoodsCount: flashfoodsEvents.length,
    };
  }

  /** @returns {boolean} */
  isRunning() { return this._polling; }
}

export default NotificationMonitor;
