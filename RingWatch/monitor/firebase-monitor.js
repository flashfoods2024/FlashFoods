/**
 * @file Firebase Monitor
 * @description Monitors Firebase Cloud Messaging for sent notifications.
 */

import { getLogger } from '../logger.js';
import { getConfig } from '../config/ringwatch.config.js';

/**
 * @typedef {object} FirebaseMessageEvent
 * @property {string} id
 * @property {string} timestamp - ISO timestamp when the message was sent
 * @property {string} messageId - Firebase message ID
 * @property {string} target - Target token or topic
 * @property {object} payload - Message payload
 * @property {string|null} error - Error message if send failed
 */

/**
 * @class FirebaseMonitor
 * @description Tracks Firebase Cloud Messaging sends for notification delivery verification.
 *
 * NOTE: This is a passive monitor. Actual Firebase send API calls should be
 * logged through this monitor at the point of sending in the application layer.
 * In v2, this can be extended to pull delivery status from Firebase Admin SDK.
 */
export class FirebaseMonitor {
  /**
   * @param {object} [config]
   */
  constructor(config) {
    this._config = config || getConfig();
    this._logger = getLogger();
    /** @type {Array<FirebaseMessageEvent>} */
    this._messages = [];
  }

  /**
   * Record a Firebase message that was sent.
   * @param {object} msg
   * @param {string} msg.messageId
   * @param {string} msg.target - FCM token or topic
   * @param {object} msg.payload - The notification payload
   * @param {string} [msg.error] - Optional error
   * @returns {FirebaseMessageEvent}
   */
  recordSend(msg) {
    const event = {
      id: `fcm_${Date.now()}_${this._messages.length}`,
      timestamp: new Date().toISOString(),
      messageId: msg.messageId || `unknown_${Date.now()}`,
      target: msg.target || 'unknown',
      payload: msg.payload || {},
      error: msg.error || null,
    };

    this._messages.push(event);
    this._logger.info(`Firebase message recorded`, { messageId: event.messageId });

    return event;
  }

  /**
   * Get all recorded messages.
   * @returns {Array<FirebaseMessageEvent>}
   */
   getMessages() {
    return [...this._messages];
  }

  /**
   * Get messages that errored.
   * @returns {Array<FirebaseMessageEvent>}
   */
  getFailedMessages() {
    return this._messages.filter(m => m.error);
  }

  /**
   * Get successful messages.
   * @returns {Array<FirebaseMessageEvent>}
   */
  getSuccessfulMessages() {
    return this._messages.filter(m => !m.error);
  }

  /** @returns {object} Statistics */
  getStats() {
    return {
      total: this._messages.length,
      sent: this.getSuccessfulMessages().length,
      failed: this.getFailedMessages().length,
    };
  }
}

export default FirebaseMonitor;
