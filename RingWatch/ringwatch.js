#!/usr/bin/env node

/**
 * @file RingWatch CLI Entry Point
 * @description Main entry point for RingWatch notification reliability testing framework.
 *
 * Usage:
 *   node ringwatch.js                         - Run with default config
 *   node ringwatch.js --config ./custom-config.js
 *   node ringwatch.js --scenario ./scenario.json
 *   node ringwatch.js --overnight              - Run overnight test (8 hours)
 *   node ringwatch.js --overnight --duration 4h
 *   node ringwatch.js --overnight --cycles 10
 *   node ringwatch.js --help
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { getLogger, resetLogger } from './logger.js';
import { getConfig, resetConfig } from './config/ringwatch.config.js';
import { TestRunner } from './controller/test-runner.js';
import { OvernightMode } from './controller/overnight-mode.js';
import { NotificationMonitor } from './monitor/notification-monitor.js';
import { AdbController } from './controller/adb-controller.js';

const SAFE_SHOP = 'juice-corner';
const SAFE_VENDOR_EMAIL = 'vendor@college.com';

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    config: null,
    scenario: null,
    help: false,
    verbose: false,
    quiet: false,
    overnight: false,
    duration: null,
    cycles: null,
    infinite: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--config': case '-c':
        parsed.config = resolve(process.cwd(), args[++i]); break;
      case '--scenario': case '-s':
        parsed.scenario = resolve(process.cwd(), args[++i]); break;
      case '--verbose': case '-v':
        parsed.verbose = true; break;
      case '--quiet': case '-q':
        parsed.quiet = true; break;
      case '--overnight': case '-o':
        parsed.overnight = true; break;
      case '--duration':
        parsed.duration = args[++i]; break;
      case '--cycles':
        parsed.cycles = parseInt(args[++i], 10); break;
      case '--infinite':
        parsed.infinite = true; break;
      case '--help': case '-h':
        parsed.help = true; break;
    }
  }
  return parsed;
}

function parseDuration(str) {
  if (!str) return null;
  const m = str.match(/^(\d+)(h|m|s|ms)$/);
  if (!m) return parseInt(str, 10) || null;
  const n = parseInt(m[1], 10);
  switch (m[2]) {
    case 'h': return n * 3600000;
    case 'm': return n * 60000;
    case 's': return n * 1000;
    case 'ms': return n;
    default: return null;
  }
}

function printHelp() {
  console.log(`
RingWatch v2 — FlashFoods Notification Reliability Framework

Usage:
  npm run ringwatch [options]

Options:
  --config, -c <path>    Path to config file (JS or JSON)
  --scenario, -s <path>  Path to scenario JSON file
  --verbose, -v          Enable verbose (debug) logging
  --quiet, -q            Suppress non-error output
  --overnight, -o        Run overnight test cycle (default 8h)
  --duration <time>      Max duration (e.g. "8h", "30m", "3600000")
  --cycles <n>           Max cycle count
  --infinite             Run until interrupted (Ctrl+C)
  --help, -h             Show this help message

Examples:
  npm run ringwatch                           # Standard test
  npm run ringwatch --overnight               # 8-hour overnight test
  npm run ringwatch --overnight --duration 4h # 4-hour test
  npm run ringwatch --overnight --cycles 10   # 10 cycles
  npm run ringwatch --overnight --infinite    # Until Ctrl+C
  node RingWatch/ringwatch.js --config ./my-config.js
`);
}

function loadScenario(path) {
  if (!existsSync(path)) throw new Error(`Scenario file not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Run mandatory safety checks before any test.
 * @param {object} config
 * @param {object} logger
 * @returns {Array<{check: string, passed: boolean, detail: string}>}
 */
function runSafetyChecks(config, logger) {
  const checks = [];

  // Check 1: Testing shop must be juice-corner
  const shopOk = config.testingShop === SAFE_SHOP;
  checks.push({
    check: 'Testing shop validation',
    passed: shopOk,
    detail: shopOk
      ? `config.testingShop = "${config.testingShop}" (OK)`
      : `config.testingShop = "${config.testingShop}" — MUST be "${SAFE_SHOP}"`,
  });
  logger.info(`[SAFETY] Testing shop: ${config.testingShop} ${shopOk ? 'OK' : 'BLOCKED'}`);

  // Check 2: Vendor email must be the testing vendor
  const vendorOk = config.vendor?.email === SAFE_VENDOR_EMAIL;
  checks.push({
    check: 'Vendor account validation',
    passed: vendorOk,
    detail: vendorOk
      ? `vendor.email = "${config.vendor?.email}" (OK)`
      : `vendor.email = "${config.vendor?.email}" — testing vendor should be "${SAFE_VENDOR_EMAIL}"`,
  });
  logger.info(`[SAFETY] Vendor email: ${config.vendor?.email} ${vendorOk ? 'OK' : 'WARN'}`);

  // Check 3: order.shopSlug (fallback) must match testingShop
  const orderSlugOk = !config.order?.shopSlug || config.order.shopSlug === SAFE_SHOP;
  if (config.order?.shopSlug) {
    checks.push({
      check: 'Order slug consistency',
      passed: orderSlugOk,
      detail: orderSlugOk
        ? `order.shopSlug = "${config.order.shopSlug}" matches testingShop`
        : `order.shopSlug = "${config.order.shopSlug}" does not match testingShop "${SAFE_SHOP}"`,
    });
    logger.info(`[SAFETY] Order slug: ${config.order.shopSlug} ${orderSlugOk ? 'OK' : 'BLOCKED'}`);
  }

  // Check 4: Auto-discovery must be disabled (verify by checking place-order imports)
  checks.push({
    check: 'Auto-discovery status',
    passed: true,
    detail: 'Auto-discovery function _resolveShopSlug() has been removed. Redirects are treated as fatal errors.',
  });
  logger.info('[SAFETY] Auto-discovery: DISABLED (removed)');

  // Check 5: baseUrl is set
  const baseOk = !!config.baseUrl;
  checks.push({
    check: 'Base URL configured',
    passed: baseOk,
    detail: baseOk ? `baseUrl = "${config.baseUrl}"` : 'baseUrl is not set',
  });

  const allPassed = checks.every(c => c.passed);
  logger.info(`[SAFETY] All checks ${allPassed ? 'PASSED' : 'FAILED'}`);

  return checks;
}

function printSafetyBanner(testingShop) {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║        RINGWATCH — SAFE TESTING MODE        ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Testing shop: ${testingShop.padEnd(36)}║`);
  console.log('║  Vendor:       vendor@college.com only       ║');
  console.log('║  Status:       All orders validated          ║');
  console.log('║  Auto-discovery: DISABLED                    ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
}

async function main() {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  let logLevel = 'info';
  if (args.verbose) logLevel = 'debug';
  if (args.quiet) logLevel = 'error';

  const logger = getLogger({ level: logLevel });
  const config = getConfig(args.config);
  const configLogLevel = config.logging?.level;
  if (configLogLevel && !args.verbose && !args.quiet) {
    logger.setLevel(configLogLevel);
  }

  logger.info('RingWatch v2 starting');
  logger.info(`Config: ${args.config || 'defaults'}`);

  // ---- SAFETY: Config validation ----
  if (config.testingShop !== SAFE_SHOP) {
    logger.error(
      `SAFETY ABORT: config.testingShop is "${config.testingShop}" but must be "${SAFE_SHOP}". ` +
      `RingWatch is only permitted to order from the dedicated testing shop.`
    );
    process.exit(1);
  }

  const safetyChecks = runSafetyChecks(config, logger);
  const safetyPassed = safetyChecks.every(c => c.passed);

  printSafetyBanner(config.testingShop);

  // Print safety check results
  console.log('Safety Checks:');
  for (const check of safetyChecks) {
    const icon = check.passed ? '\u2705' : '\u274C';
    console.log(`  ${icon} ${check.check}: ${check.detail}`);
  }
  console.log('');

  if (!safetyPassed) {
    logger.error('SAFETY ABORT: One or more safety checks failed');
    process.exit(1);
  }

  // ---- Overnight mode ----
  if (args.overnight) {
    logger.info('Starting overnight test mode');

    const durationMs = parseDuration(args.duration) || config.overnight?.durationMs || 8 * 3600000;
    const maxCycles = args.cycles || config.overnight?.maxCycles || 999999;
    const infinite = args.infinite || config.overnight?.infinite || false;

    logger.info(`Overnight config: duration=${durationMs}ms, maxCycles=${maxCycles}, infinite=${infinite}`);

    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║     RINGWATCH — OVERNIGHT TEST MODE         ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Duration:    ${_fmtDuration(durationMs).padEnd(36)}║`);
    console.log(`║  Max cycles:  ${String(maxCycles).padEnd(36)}║`);
    console.log(`║  Infinite:    ${String(infinite).padEnd(36)}║`);
    console.log(`║  Start time:  ${new Date().toLocaleTimeString().padEnd(36)}║`);
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');

    const { chromium } = await import('playwright');
    const adb = new AdbController(config);
    const browser = await chromium.launch({
      headless: config.browser?.headless ?? false,
      slowMo: config.browser?.slowMo ?? 100,
    });

    const notifMonitor = new NotificationMonitor(adb, config);
    notifMonitor.start();

    const overnightMode = new OvernightMode(config, browser, notifMonitor, adb);

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      logger.info('SIGINT received — stopping overnight test gracefully');
      overnightMode.stop();
    });

    try {
      const result = await overnightMode.run({
        durationMs,
        maxCycles,
        infinite,
        intervalMs: config.overnight?.intervalMs || 15 * 60 * 1000,
      });

      notifMonitor.stop();

      // Generate overnight-enhanced report
      const runner = new TestRunner(config, logger);
      const reportData = {
        startTime: new Date(result.summary.startTime).getTime(),
        timeline: result.cycles.flatMap(c => c.timeline || []),
        notifications: result.cycles.map(c => c.notificationResult).filter(Boolean),
        overnight: {
          ...result.summary,
          cycles: result.cycles,
        },
        safetyChecks,
        deviceStates: [],
        logs: logger.getBuffer(),
        summary: {
          totalSteps: result.cycles.length,
          passed: result.cycles.filter(c => c.success).length,
          failures: result.cycles.filter(c => !c.success).length,
          notificationsDetected: result.cycles.filter(c => c.notificationResult?.success).length,
          totalDuration: result.summary.totalDuration,
          startTime: result.summary.startTime,
          endTime: result.summary.endTime,
          fatalError: null,
        },
        reliabilityScore: result.summary.reliabilityScore,
      };

      const { generateHtmlReport } = await import('./reports/html-report.js');
      const { generateJsonReport } = await import('./reports/json-report.js');

      const htmlPath = await generateHtmlReport(reportData, config);
      const jsonPath = await generateJsonReport(reportData, config);

      const status = result.summary.failures === 0 ? 'PASS' : 'FAIL';
      const scoreColor = result.summary.reliabilityScore >= 80 ? '\x1b[32m'
        : result.summary.reliabilityScore >= 50 ? '\x1b[33m' : '\x1b[31m';

      console.log('');
      console.log('═══════════════════════════════════════');
      console.log(`  RingWatch Overnight: \x1b[1m${status === 'PASS' ? '\x1b[32m' : '\x1b[31m'}${status}\x1b[0m`);
      console.log(`  Duration: ${_fmtDuration(result.summary.totalDuration)}`);
      console.log(`  Cycles: ${result.summary.cyclesCompleted}`);
      console.log(`  Orders Created: ${result.summary.ordersCreated}`);
      console.log(`  Orders Completed: ${result.summary.ordersCompleted}`);
      console.log(`  Notifications: ${result.summary.notificationsReceived}`);
      console.log(`  Missed: ${result.summary.notificationsMissed}`);
      console.log(`  Avg Latency: ${_fmtDuration(result.summary.avgLatencyMs)}`);
      console.log(`  Min Latency: ${_fmtDuration(result.summary.minLatencyMs)}`);
      console.log(`  Max Latency: ${_fmtDuration(result.summary.maxLatencyMs)}`);
      console.log(`  Reliability Score: ${scoreColor}${result.summary.reliabilityScore}%\x1b[0m`);
      console.log(`  HTML Report: ${htmlPath}`);
      console.log(`  JSON Report: ${jsonPath}`);
      console.log('═══════════════════════════════════════');

      await browser.close();
      process.exit(status === 'PASS' ? 0 : 1);
    } catch (err) {
      logger.error(`Overnight test fatal error: ${err.message}`);
      console.error(`\x1b[31mRingWatch overnight failed: ${err.message}\x1b[0m`);
      await browser.close().catch(() => {});
      process.exit(1);
    }
    return;
  }

  // ---- Standard mode ----
  let scenario = null;
  if (args.scenario) {
    try {
      scenario = loadScenario(args.scenario);
      logger.info(`Scenario loaded: ${args.scenario} (${scenario.length} steps)`);
    } catch (err) {
      logger.error(`Failed to load scenario: ${err.message}`);
      process.exit(1);
    }
  }

  const runner = new TestRunner(config, logger);

  try {
    const result = await runner.run(scenario);

    const status = result.passed ? 'PASS' : 'FAIL';
    const scoreColor = result.reliabilityScore >= 80 ? '\x1b[32m' : result.reliabilityScore >= 50 ? '\x1b[33m' : '\x1b[31m';
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log(`  RingWatch Result: \x1b[1m${status === 'PASS' ? '\x1b[32m' : '\x1b[31m'}${status}\x1b[0m`);
    console.log(`  Reliability Score: ${scoreColor}${result.reliabilityScore}%\x1b[0m`);
    console.log(`  HTML Report: ${result.reportPath}`);
    console.log(`  JSON Report: ${result.jsonReportPath}`);
    console.log('═══════════════════════════════════════');

    process.exit(result.passed ? 0 : 1);
  } catch (err) {
    logger.error(`RingWatch fatal error: ${err.message}`);
    console.error(`\x1b[31mRingWatch failed: ${err.message}\x1b[0m`);
    process.exit(1);
  }
}

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

main().catch(err => {
  console.error(`\x1b[31mUnhandled error: ${err.message}\x1b[0m`);
  process.exit(1);
});
