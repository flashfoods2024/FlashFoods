/**
 * @file JSON Report Generator
 * @description Generates a structured JSON report with overnight metrics,
 * notification validation details, and safety check results.
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getLogger } from '../logger.js';
import { getConfig } from '../config/ringwatch.config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Generate a JSON report file.
 * @param {object} data - Complete report data
 * @param {object} [config]
 * @returns {Promise<string>} Path to generated JSON file
 */
export async function generateJsonReport(data, config) {
  const logger = getLogger();
  const cfg = config || getConfig();
  const outputDir = cfg.reporting?.outputDir || resolve(__dirname, '..', 'reports');

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `ringwatch-report-${timestamp}.json`;
  const filePath = resolve(outputDir, filename);

  const report = {
    meta: {
      title: cfg.reporting?.reportTitle || 'FlashFoods RingWatch Report',
      generatedAt: new Date().toISOString(),
      version: '2.0.0',
      testingShop: cfg.testingShop,
    },
    summary: {
      totalSteps: data.summary?.totalSteps ?? (data.timeline || []).length,
      passed: data.summary?.passed ?? 0,
      failures: data.summary?.failures ?? 0,
      notificationsDetected: data.summary?.notificationsDetected ?? (data.notifications || []).length,
      totalDuration: data.summary?.totalDuration ?? 0,
      startTime: data.summary?.startTime ?? null,
      endTime: data.summary?.endTime ?? null,
      fatalError: data.summary?.fatalError ?? null,
    },
    reliabilityScore: data.reliabilityScore ?? 0,
    passed: (data.summary?.failures ?? 0) === 0 && !data.summary?.fatalError,
    overnight: data.overnight ? {
      cyclesCompleted: data.overnight.cyclesCompleted ?? 0,
      ordersCreated: data.overnight.ordersCreated ?? 0,
      ordersCompleted: data.overnight.ordersCompleted ?? 0,
      notificationsReceived: data.overnight.notificationsReceived ?? 0,
      notificationsMissed: data.overnight.notificationsMissed ?? 0,
      avgLatencyMs: data.overnight.avgLatencyMs ?? 0,
      minLatencyMs: data.overnight.minLatencyMs ?? 0,
      maxLatencyMs: data.overnight.maxLatencyMs ?? 0,
      failures: data.overnight.failures ?? 0,
      failureReasons: (data.overnight.failureReasons || []).map(f => ({
        cycle: f.cycle,
        error: f.error,
      })),
      reliabilityScore: data.overnight.reliabilityScore ?? 0,
      totalDuration: data.overnight.totalDuration ?? 0,
      startTime: data.overnight.startTime ?? null,
      endTime: data.overnight.endTime ?? null,
      cycles: (data.overnight.cycles || []).map(c => ({
        cycleIndex: c.cycleIndex,
        success: c.success,
        orderId: c.orderId,
        duration: c.duration,
        error: c.error,
        notificationResult: c.notificationResult ? {
          success: c.notificationResult.success,
          title: c.notificationResult.title,
          body: c.notificationResult.body,
          latencyMs: c.notificationResult.latencyMs,
          detectedAt: c.notificationResult.detectedAt,
          contentMatched: c.notificationResult.contentMatched,
          screenshotPath: c.notificationResult.screenshotPath,
          error: c.notificationResult.error,
        } : null,
        vendorResult: c.vendorResult ? {
          success: c.vendorResult.success,
          steps: (c.vendorResult.steps || []).map(s => ({
            action: s.action,
            success: s.success,
            duration: s.duration,
            error: s.error,
          })),
          totalDuration: c.vendorResult.totalDuration,
        } : null,
      })),
    } : null,
    safetyChecks: (data.safetyChecks || []).map(s => ({
      check: s.check,
      passed: s.passed,
      detail: s.detail,
    })),
    timeline: (data.timeline || []).map(event => ({
      id: event.id,
      type: event.type,
      action: event.action,
      timestamp: event.timestamp,
      duration: event.duration,
      success: event.success,
      error: event.error,
      data: event.data,
    })),
    notifications: (data.notifications || []).map(n => ({
      id: n.id,
      title: n.title,
      body: n.body,
      packageName: n.packageName,
      detectedAt: n.detectedAt,
      latencyMs: n.latencyMs,
      source: n.source,
      contentMatched: n.contentMatched,
      screenshotPath: n.screenshotPath,
      success: n.success,
    })),
    logcatEvents: (data.logcatEvents || []).map(e => ({
      id: e.id, timestamp: e.timestamp, tag: e.tag, level: e.level, message: e.message,
    })),
    chromeEvents: (data.chromeEvents || []).map(e => ({
      id: e.id, timestamp: e.timestamp, type: e.type, data: e.data,
    })),
    firebaseMessages: (data.firebaseMessages || []).map(m => ({
      id: m.id, timestamp: m.timestamp, messageId: m.messageId,
      target: m.target, payload: m.payload, error: m.error,
    })),
    deviceStates: (data.deviceStates || []).map(s => ({
      timestamp: s.timestamp, screenState: s.screenState,
      batterySaver: s.batterySaver, dozeMode: s.dozeMode,
      notificationCount: s.notificationCount,
    })),
    logs: (data.logs || []).map(l => ({
      timestamp: l.timestamp, level: l.level,
      message: l.message, meta: l.meta,
    })),
  };

  writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
  logger.info(`JSON report saved: ${filePath}`);
  return filePath;
}

export default generateJsonReport;
