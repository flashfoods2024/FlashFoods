/**
 * @file Logcat Monitor
 * @description Parses Android logcat output for notification-related events.
 */

import { getLogger } from '../logger.js';
import { getConfig } from '../config/ringwatch.config.js';
import { AdbController } from '../controller/adb-controller.js';

/**
 * @typedef {object} LogcatEvent
 * @property {string} id
 * @property {string} timestamp - ISO timestamp
 * @property {string} raw - Raw log line
 * @property {string} tag - Logcat tag
 * @property {string} level - Log level (V/D/I/W/E/F)
 * @property {string} message - Log message body
 */

/** Known notification-related tags */
const NOTIFICATION_TAGS = [
  'NotificationService',
  'NotificationManager',
  'FlashFoods',
  'FCM',
  'FirebaseMessaging',
  'com.google.android.gms',
];

/**
 * @class LogcatMonitor
 * @description Reads and parses logcat for notification delivery signals.
 */
export class LogcatMonitor {
  /**
   * @param {AdbController} adb
   * @param {object} [config]
   */
  constructor(adb, config) {
    this._adb = adb;
    this._config = config || getConfig();
    this._logger = getLogger();
    /** @type {Array<LogcatEvent>} */
    this._events = [];
    this._lastSnapshot = '';
  }

  /**
   * Capture the latest logcat lines and parse them.
   * @param {object} [options]
   * @param {number} [options.lines=200]
   * @param {string} [options.filter] - Logcat filter
   * @returns {Promise<Array<LogcatEvent>>}
   */
  async snapshot(options = {}) {
    const lines = options.lines || 200;
    const filter = options.filter || '*:V';
    const raw = await this._adb.captureLogcat({ lines, filter });
    const events = this._parse(raw);

    // Deduplicate against last snapshot
    const newEvents = events.filter(e => !this._lastSnapshot.includes(e.raw));
    this._events.push(...newEvents);
    this._lastSnapshot = raw;

    return newEvents;
  }

  /**
   * Parse raw logcat text into structured events.
   * @param {string} raw
   * @returns {Array<LogcatEvent>}
   */
  _parse(raw) {
    const events = [];
    const lines = raw.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      // Typical logcat format: <date> <time>.<ms> <pid> <tid> <level> <tag>: <message>
      const match = line.match(
        /^(\S+\s+\S+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):\s*(.*)$/
      );

      if (match) {
        const tag = match[5].trim();
        // Only keep notification-related tags
        if (NOTIFICATION_TAGS.some(t => tag.includes(t))) {
          events.push({
            id: `logcat_${Date.now()}_${events.length}`,
            timestamp: new Date().toISOString(),
            raw: line,
            tag,
            level: match[4],
            message: match[6].trim(),
          });
        }
      }
    }

    return events;
  }

  /**
   * Get all parsed logcat events.
   * @returns {Array<LogcatEvent>}
   */
  getEvents() {
    return [...this._events];
  }

  /**
   * Find logcat events matching a pattern.
   * @param {RegExp|string} pattern
   * @returns {Array<LogcatEvent>}
   */
  findEvents(pattern) {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
    return this._events.filter(e => regex.test(e.message));
  }

  /** Clear stored events and last snapshot. */
  clear() {
    this._events = [];
    this._lastSnapshot = '';
  }
}

export default LogcatMonitor;
