/**
 * @file RingWatch Logger
 * @description Centralised logging with levels, timestamps, and optional file output.
 */

import { appendFileSync, existsSync, mkdirSync, statSync, renameSync } from 'fs';
import { dirname, resolve } from 'path';

const LOG_LEVELS = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

const LOG_COLORS = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[36m',
  debug: '\x1b[90m',
  trace: '\x1b[37m',
  reset: '\x1b[0m',
};

/**
 * @class Logger
 * @description RingWatch central logger. Logs to console (coloured) and optionally to file.
 */
export class Logger {
  /**
   * @param {object} options
   * @param {string} [options.level='info']
   * @param {string|null} [options.file=null] - Path to log file
   * @param {number} [options.maxFileSize=10485760] - Max file size before rotation (bytes)
   */
  constructor(options = {}) {
    this._levelName = options.level || 'info';
    this._level = LOG_LEVELS[this._levelName] ?? LOG_LEVELS.info;
    this._file = options.file || null;
    this._maxFileSize = options.maxFileSize || 10 * 1024 * 1024;
    this._buffer = [];
  }

  /**
   * Format a log entry.
   * @param {string} level
   * @param {string} message
   * @param {object} [meta]
   * @returns {string}
   */
  _format(level, message, meta) {
    const ts = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${ts}] [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  /**
   * Internal log dispatch.
   * @param {string} level
   * @param {string} message
   * @param {object} [meta]
   */
  _log(level, message, meta) {
    if (LOG_LEVELS[level] > this._level) return;

    const formatted = this._format(level, message, meta);

    // Console output with colour
    const color = LOG_COLORS[level] || '';
    const reset = LOG_COLORS.reset;
    console.log(`${color}${formatted}${reset}`);

    // Buffer for in-memory access
    this._buffer.push({ level, message, meta, timestamp: new Date().toISOString() });

    // File output
    if (this._file) {
      this._writeToFile(formatted);
    }
  }

  /**
   * Write to log file with rotation.
   * @param {string} line
   */
  _writeToFile(line) {
    try {
      const dir = dirname(this._file);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Rotate if exceeds max size
      if (existsSync(this._file) && statSync(this._file).size >= this._maxFileSize) {
        renameSync(this._file, `${this._file}.1`);
      }

      appendFileSync(this._file, line + '\n', 'utf-8');
    } catch (err) {
      console.error(`Logger: failed to write to ${this._file}: ${err.message}`);
    }
  }

  trace(message, meta) { this._log('trace', message, meta); }
  debug(message, meta) { this._log('debug', message, meta); }
  info(message, meta) { this._log('info', message, meta); }
  warn(message, meta) { this._log('warn', message, meta); }
  error(message, meta) { this._log('error', message, meta); }

  /** @returns {Array<{level:string, message:string, meta:object, timestamp:string}>} */
  getBuffer() {
    return [...this._buffer];
  }

  /** Clear the in-memory buffer. */
  clearBuffer() {
    this._buffer = [];
  }

  /** @returns {string} Current log level name */
  getLevel() {
    return this._levelName;
  }

  /**
   * Update log level at runtime.
   * @param {string} level
   */
  setLevel(level) {
    if (LOG_LEVELS[level] !== undefined) {
      this._levelName = level;
      this._level = LOG_LEVELS[level];
    }
  }

  /**
   * Get current log level.
   * @returns {string}
   */
  getLevelName() {
    return this._levelName;
  }

  /**
   * Configure per-subsystem log files.
   * Each subsystem writes to a separate file in the given log directory.
   * @param {string} logDir - Directory for subsystem log files
   */
  configureSubsystemLogs(logDir) {
    this._subsystemLogDir = logDir;
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    this._subsystemStreams = {};
  }

  /**
   * Log a message to a specific subsystem log file (in addition to the main log).
   * @param {string} subsystem - One of: student, vendor, ringwatch, adb, firebase, notification, playwright, console
   * @param {string} level - Log level
   * @param {string} message
   * @param {object} [meta]
   */
  subsystem(subsystem, level, message, meta) {
    // Also log to the main logger
    this._log(level, `[${subsystem}] ${message}`, meta);

    // Write to subsystem-specific file
    if (this._subsystemLogDir) {
      try {
        const filePath = resolve(this._subsystemLogDir, `${subsystem}.log`);
        const ts = new Date().toISOString();
        const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
        const line = `[${ts}] [${level.toUpperCase()}] ${message}${metaStr}\n`;
        appendFileSync(filePath, line, 'utf-8');
      } catch { /* ignore subsystem log errors */ }
    }
  }
}

/** Singleton logger instance */
let _instance = null;

/**
 * Get or create the singleton logger.
 * @param {object} [options]
 * @returns {Logger}
 */
export function getLogger(options) {
  if (!_instance) {
    _instance = new Logger(options || {});
  }
  return _instance;
}

/**
 * Reset the logger singleton (useful in tests).
 */
export function resetLogger() {
  _instance = null;
}

export default Logger;
