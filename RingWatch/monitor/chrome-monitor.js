/**
 * @file Chrome Monitor
 * @description Monitors browser notification state via Chrome DevTools Protocol.
 */

import { getLogger } from '../logger.js';
import { getConfig } from '../config/ringwatch.config.js';

/**
 * @typedef {object} ChromeNotificationEvent
 * @property {string} id
 * @property {string} timestamp
 * @property {string} type - 'push' | 'notification' | 'service_worker'
 * @property {object} data
 */

/**
 * @class ChromeMonitor
 * @description Connects to Chrome DevTools Protocol to observe push/notification events.
 */
export class ChromeMonitor {
  /**
   * @param {object} [config]
   */
  constructor(config) {
    this._config = config || getConfig();
    this._logger = getLogger();
    /** @type {Array<ChromeNotificationEvent>} */
    this._events = [];
    this._cdp = null;
    this._connected = false;
  }

  /**
   * Connect to an existing Chrome DevTools Protocol endpoint.
   * @param {import('playwright').Browser} browser - Playwright browser instance
   */
  async connect(browser) {
    try {
      // Playwright's CDPSession
      this._cdp = await browser.newBrowserCDPSession();
      this._connected = true;
      this._logger.info('Chrome DevTools Protocol connected');

      // Enable necessary domains
      await this._cdp.send('ServiceWorker.enable');
      await this._cdp.send('Network.enable');

      // Listen for push events
      this._cdp.on('ServiceWorker.workerMessageReceived', (msg) => {
        this._recordEvent('service_worker', msg);
      });

      // Listen for notification events
      if (this._cdp.send('Notification.enable')) {
        this._cdp.on('Notification.onShow', (msg) => {
          this._recordEvent('notification', msg);
        });
      }
    } catch (err) {
      this._logger.warn('Chrome DevTools Protocol connection failed', { error: err.message });
      this._connected = false;
    }
  }

  /**
   * Record a Chrome event.
   * @param {string} type
   * @param {object} data
   */
  _recordEvent(type, data) {
    const event = {
      id: `chrome_${Date.now()}_${this._events.length}`,
      timestamp: new Date().toISOString(),
      type,
      data,
    };
    this._events.push(event);
    this._logger.debug(`Chrome event: ${type}`, data);
  }

  /**
   * Disconnect from CDP.
   */
  async disconnect() {
    if (this._cdp) {
      try {
        await this._cdp.detach();
      } catch { /* ignore */ }
      this._cdp = null;
    }
    this._connected = false;
    this._logger.info('Chrome DevTools Protocol disconnected');
  }

  /**
   * Get recorded events.
   * @returns {Array<ChromeNotificationEvent>}
   */
  getEvents() {
    return [...this._events];
  }

  /** @returns {boolean} */
  isConnected() { return this._connected; }
}

export default ChromeMonitor;
