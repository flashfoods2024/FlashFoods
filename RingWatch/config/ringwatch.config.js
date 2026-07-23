/**
 * @file RingWatch Configuration
 * @description Central configuration for RingWatch notification reliability framework.
 * All paths relative to this file or absolute.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULTS = {
  /** Android application package name */
  appPackage: 'com.flashfoods.app',

  /** Web application URL for Playwright automation */
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',

  /** Playwright launch options */
  browser: {
    headless: false,
    slowMo: 100,
    timeout: 30000,
  },

  /**
   * Credentials matching FlashFoods seed data.
   * Run `node seed.js` to create these users.
   */
  student: {
    email: process.env.RINGWATCH_STUDENT_EMAIL || 'student@college.test',
    password: process.env.RINGWATCH_STUDENT_PASSWORD || 'vendor@1',
  },

  /** Vendor credentials */
  vendor: {
    email: process.env.RINGWATCH_VENDOR_EMAIL || 'vendor@college.com',
    password: process.env.RINGWATCH_VENDOR_PASSWORD || 'vendor@1',
  },

  /** ADB configuration */
  adb: {
    binary: 'adb',
    logcatBufferSize: 8192,
    notificationPollIntervalMs: 2000,
  },

  /**
   * SAFETY: The ONLY shop RingWatch is permitted to use for automated testing.
   * Every order is validated against this value before placement.
   * Never change this to a real vendor shop.
   */
  testingShop: process.env.RINGWATCH_TESTING_SHOP || 'juice-corner',

  /** Order configuration */
  order: {
    items: [],
    orderType: 'dinein',
    checkoutType: 'mock',
    maxRetries: 3,
    retryDelayMs: 5000,
  },

  /** Scenario configuration */
  scenario: {
    defaultWaitMs: 300000, // 5 minutes
    maxDurationMs: 3600000, // 1 hour
    loopIntervalMs: 60000,
  },

  /** Overnight testing mode */
  overnight: {
    durationMs: 8 * 60 * 60 * 1000, // 8 hours
    intervalMs: 15 * 60 * 1000, // 15 minutes between cycles
    maxCycles: 999999,
    infinite: false,
    notificationTimeoutMs: 120000, // 2 min wait for notification per cycle
    vendorPollIntervalMs: 3000,
    vendorTimeoutMs: 60000,
    recoveryDelayMs: 30000,
  },

  /** Reporting configuration */
  reporting: {
    outputDir: resolve(__dirname, '..', 'reports'),
    reportTitle: 'FlashFoods RingWatch Report',
    includeScreenshots: true,
    maxScreenshots: 50,
  },

  /** Logging configuration */
  logging: {
    level: process.env.RINGWATCH_LOG_LEVEL || 'info',
    file: resolve(__dirname, '..', 'ringwatch.log'),
    maxFileSize: 10 * 1024 * 1024, // 10MB
  },

  /** Monitoring configuration */
  monitoring: {
    enabled: true,
    pollIntervalMs: 2000,
    chromeDevToolsPort: 9222,
    firebaseProjectId: 'flashfoods-106bf',
  },
};

/**
 * Load and merge configuration from a config file if it exists.
 * @param {string} [configPath] - Path to the config file
 * @returns {object} Merged configuration
 */
export function loadConfig(configPath) {
  const config = { ...DEFAULTS };

  const pathsToTry = configPath
    ? [configPath]
    : [
        resolve(__dirname, 'ringwatch.config.js'),
        resolve(__dirname, 'ringwatch.config.json'),
        resolve(process.cwd(), 'ringwatch.config.js'),
      ];

  for (const p of pathsToTry) {
    if (existsSync(p)) {
      try {
        if (p.endsWith('.json')) {
          const raw = readFileSync(p, 'utf-8');
          const parsed = JSON.parse(raw);
          deepMerge(config, parsed);
        }
        // .js files are loaded via dynamic import; skipped here to avoid circular deps
      } catch (err) {
        console.error(`RingWatch config: failed to load ${p}: ${err.message}`);
      }
      break;
    }
  }

  return config;
}

/**
 * Deep merge two objects.
 * @param {object} target
 * @param {object} source
 * @returns {object}
 */
function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

/** Singleton config instance */
let _instance = null;

/**
 * Get the singleton configuration.
 * @param {string} [configPath] - Optional config file path
 * @returns {object}
 */
export function getConfig(configPath) {
  if (!_instance) {
    _instance = loadConfig(configPath);
    Object.freeze(_instance);
  }
  return _instance;
}

/**
 * Reset the config singleton (useful in tests).
 */
export function resetConfig() {
  _instance = null;
}

export default DEFAULTS;
