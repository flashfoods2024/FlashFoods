/**
 * @file HTML Report Generator
 * @description Generates a comprehensive HTML report with overnight metrics,
 * latency statistics, timeline graphs, and notification validation details.
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getLogger } from '../logger.js';
import { getConfig } from '../config/ringwatch.config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Generate a complete HTML report.
 * @param {object} data - Report data
 * @param {object} [config]
 * @returns {Promise<string>} Path to generated HTML file
 */
export async function generateHtmlReport(data, config) {
  const logger = getLogger();
  const cfg = config || getConfig();
  const outputDir = cfg.reporting?.outputDir || resolve(__dirname, '..', 'reports');
  const title = cfg.reporting?.reportTitle || 'FlashFoods RingWatch Report';

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const screenshotDir = resolve(outputDir, 'screenshots');
  if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `ringwatch-report-${timestamp}.html`;
  const filePath = resolve(outputDir, filename);

  const passed = data.summary?.failures === 0 && !data.summary?.fatalError;
  const overallStatus = passed ? 'PASS' : 'FAIL';

  const latencies = (data.notifications || []).map(n => n.latencyMs).filter(l => l > 0);

  const timelineJson = JSON.stringify((data.timeline || []).map((e, i) => ({
    step: i + 1, action: e.action, duration: e.duration, success: e.success !== false,
  })));

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${_escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #0f172a; color: #e2e8f0; line-height: 1.6; padding: 2rem;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      text-align: center; padding: 2rem 0; border-bottom: 1px solid #334155; margin-bottom: 2rem;
    }
    header h1 { font-size: 1.8rem; font-weight: 700; color: #f8fafc; }
    header .subtitle { color: #94a3b8; font-size: 0.9rem; margin-top: 0.5rem; }
    .status-badge {
      display: inline-block; padding: 0.5rem 2rem; border-radius: 9999px;
      font-size: 1.2rem; font-weight: 700; margin-top: 1rem;
    }
    .status-badge.pass { background: #059669; color: #fff; }
    .status-badge.fail { background: #dc2626; color: #fff; }
    .score { font-size: 2.5rem; font-weight: 800; margin-top: 1rem; }
    .score.good { color: #34d399; }
    .score.ok { color: #fbbf24; }
    .score.bad { color: #f87171; }

    .sub-section { margin: 1.5rem 0; }
    .sub-section h3 { font-size: 1.1rem; color: #f1f5f9; margin-bottom: 0.75rem; border-bottom: 1px solid #334155; padding-bottom: 0.5rem; }

    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin: 2rem 0; }
    .card {
      background: #1e293b; border-radius: 0.75rem; padding: 1.25rem; border: 1px solid #334155;
    }
    .card h3 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin-bottom: 0.5rem; }
    .card .value { font-size: 1.5rem; font-weight: 700; }
    .card .value.green { color: #34d399; }
    .card .value.red { color: #f87171; }
    .card .value.yellow { color: #fbbf24; }

    .overnight-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.75rem; margin: 1rem 0; }
    .overnight-card {
      background: #1e293b; border-radius: 0.5rem; padding: 1rem; border: 1px solid #334155; text-align: center;
    }
    .overnight-card .stat { font-size: 1.8rem; font-weight: 800; }
    .overnight-card .label { font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.25rem; }
    .overnight-card .stat.green { color: #34d399; }
    .overnight-card .stat.red { color: #f87171; }
    .overnight-card .stat.yellow { color: #fbbf24; }

    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { text-align: left; padding: 0.75rem 1rem; border-bottom: 1px solid #334155; font-size: 0.875rem; }
    th { color: #94a3b8; font-weight: 600; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.05em; }
    td { color: #e2e8f0; }
    tr:hover td { background: #1e293b; }
    .success { color: #34d399; }
    .failure { color: #f87171; }
    .warning { color: #fbbf24; }

    .chart-container { background: #1e293b; border-radius: 0.75rem; padding: 1.5rem; margin: 1.5rem 0; border: 1px solid #334155; }
    .chart-container h3 { color: #f1f5f9; margin-bottom: 1rem; }

    .notif-card {
      background: #1e293b; border-radius: 0.75rem; padding: 1rem; margin: 0.75rem 0;
      border-left: 4px solid #059669;
    }
    .notif-card.fail { border-left-color: #dc2626; }
    .notif-card h4 { font-size: 1rem; margin-bottom: 0.25rem; }
    .notif-card .meta { font-size: 0.8rem; color: #94a3b8; }
    .latency { font-weight: 600; }
    .latency.fast { color: #34d399; }
    .latency.slow { color: #fbbf24; }
    .latency.very-slow { color: #f87171; }

    .cycle-card {
      background: #1e293b; border-radius: 0.75rem; padding: 1rem; margin: 0.75rem 0;
      border: 1px solid #334155;
    }
    .cycle-card.pass { border-left: 4px solid #059669; }
    .cycle-card.fail { border-left: 4px solid #dc2626; }
    .cycle-card .cycle-header { display: flex; justify-content: space-between; align-items: center; }
    .cycle-card .cycle-header h4 { font-size: 1rem; }
    .cycle-card .cycle-meta { font-size: 0.8rem; color: #94a3b8; }

    .failure-reason { color: #f87171; font-size: 0.85rem; margin-top: 0.5rem; }

    .safety-pass { color: #34d399; }
    .safety-fail { color: #f87171; }
    .safety-check {
      background: #1e293b; border-radius: 0.5rem; padding: 0.75rem 1rem; margin: 0.5rem 0;
      border-left: 4px solid #34d399; font-size: 0.9rem;
    }
    .safety-check.fail { border-left-color: #dc2626; }

    .device-state { font-size: 0.875rem; }
    .device-state dt { color: #94a3b8; font-weight: 600; margin-top: 0.5rem; }
    .device-state dd { color: #e2e8f0; }

    .log-entry { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.75rem; padding: 0.25rem 0; }
    .log-entry.error { color: #f87171; }
    .log-entry.warn { color: #fbbf24; }
    .log-entry.info { color: #e2e8f0; }
    .log-entry.debug { color: #64748b; }

    footer { text-align: center; padding: 2rem 0; color: #475569; font-size: 0.8rem; border-top: 1px solid #334155; margin-top: 2rem; }
    img.screenshot { max-width: 100%; border-radius: 0.5rem; border: 1px solid #334155; margin: 0.5rem 0; }

    .bar { display: inline-block; height: 12px; border-radius: 6px; margin-right: 2px; }
    .bar.success { background: #34d399; }
    .bar.fail { background: #f87171; }

    @media (max-width: 768px) {
      body { padding: 1rem; }
      .grid { grid-template-columns: 1fr 1fr; }
      .overnight-grid { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>${_escapeHtml(title)}</h1>
      <div class="status-badge ${passed ? 'pass' : 'fail'}">${overallStatus}</div>
      <div class="score ${passed ? 'good' : 'bad'}">${data.reliabilityScore ?? 0}%</div>
      <div class="subtitle">${data.summary?.startTime || 'N/A'} &mdash; ${data.summary?.endTime || 'N/A'}</div>
    </header>

    ${data.summary?.fatalError ? `
    <div class="card" style="border-color: #dc2626;">
      <h3 style="color: #f87171;">Fatal Error</h3>
      <p>${_escapeHtml(data.summary.fatalError)}</p>
    </div>
    ` : ''}

    <!-- Overnight Summary (if available) -->
    ${data.overnight ? `
    <h2 class="sub-section"><h3>Overnight Test Summary</h3></h2>
    <div class="overnight-grid">
      <div class="overnight-card">
        <div class="stat">${data.overnight.cyclesCompleted ?? 0}</div>
        <div class="label">Cycles Completed</div>
      </div>
      <div class="overnight-card">
        <div class="stat green">${data.overnight.ordersCreated ?? 0}</div>
        <div class="label">Orders Created</div>
      </div>
      <div class="overnight-card">
        <div class="stat green">${data.overnight.ordersCompleted ?? 0}</div>
        <div class="label">Orders Completed</div>
      </div>
      <div class="overnight-card">
        <div class="stat green">${data.overnight.notificationsReceived ?? 0}</div>
        <div class="label">Notifications Received</div>
      </div>
      <div class="overnight-card">
        <div class="stat ${(data.overnight.notificationsMissed ?? 0) > 0 ? 'red' : 'green'}">${data.overnight.notificationsMissed ?? 0}</div>
        <div class="label">Notifications Missed</div>
      </div>
      <div class="overnight-card">
        <div class="stat">${_fmtDuration(data.overnight.avgLatencyMs ?? 0)}</div>
        <div class="label">Avg Latency</div>
      </div>
      <div class="overnight-card">
        <div class="stat">${_fmtDuration(data.overnight.minLatencyMs ?? 0)}</div>
        <div class="label">Min Latency</div>
      </div>
      <div class="overnight-card">
        <div class="stat">${_fmtDuration(data.overnight.maxLatencyMs ?? 0)}</div>
        <div class="label">Max Latency</div>
      </div>
      <div class="overnight-card">
        <div class="stat ${(data.overnight.failures ?? 0) > 0 ? 'red' : 'green'}">${data.overnight.failures ?? 0}</div>
        <div class="label">Failures</div>
      </div>
      <div class="overnight-card">
        <div class="stat ${(data.overnight.reliabilityScore ?? 100) >= 80 ? 'green' : (data.overnight.reliabilityScore ?? 100) >= 50 ? 'yellow' : 'red'}">${data.overnight.reliabilityScore ?? 0}%</div>
        <div class="label">Reliability Score</div>
      </div>
    </div>
    ` : ''}

    <!-- Standard summary cards -->
    <div class="grid">
      <div class="card"><h3>Total Steps</h3><div class="value">${data.summary?.totalSteps ?? 0}</div></div>
      <div class="card"><h3>Passed</h3><div class="value green">${data.summary?.passed ?? 0}</div></div>
      <div class="card"><h3>Failures</h3><div class="value ${(data.summary?.failures ?? 0) > 0 ? 'red' : 'green'}">${data.summary?.failures ?? 0}</div></div>
      <div class="card"><h3>Notifications</h3><div class="value">${data.summary?.notificationsDetected ?? 0}</div></div>
      <div class="card"><h3>Duration</h3><div class="value">${_fmtDuration(data.summary?.totalDuration ?? 0)}</div></div>
      <div class="card"><h3>Reliability</h3><div class="value ${(data.reliabilityScore ?? 100) >= 80 ? 'green' : (data.reliabilityScore ?? 100) >= 50 ? 'yellow' : 'red'}">${data.reliabilityScore ?? 0}%</div></div>
    </div>

    <!-- Failure reasons -->
    ${(data.overnight?.failureReasons?.length ?? 0) > 0 ? `
    <h2 class="sub-section"><h3>Failure Reasons</h3></h2>
    <table>
      <thead><tr><th>Cycle</th><th>Reason</th></tr></thead>
      <tbody>
        ${data.overnight.failureReasons.map(f => `
        <tr><td>${f.cycle}</td><td class="failure">${_escapeHtml(f.error)}</td></tr>
        `).join('')}
      </tbody>
    </table>
    ` : ''}

    <!-- Timeline chart -->
    ${(data.timeline?.length ?? 0) > 0 ? `
    <h2 class="sub-section"><h3>Timeline</h3></h2>
    <div class="chart-container">
      <div style="display: flex; gap: 2px; align-items: flex-end; min-height: 40px;">
        ${(data.timeline || []).map((e, i) => {
          const maxDur = Math.max(...(data.timeline || []).map(t => t.duration || 1), 1);
          const h = Math.max(8, Math.min(100, ((e.duration || 1) / maxDur) * 100));
          return `<div title="${_escapeHtml(e.action)}: ${_fmtDuration(e.duration)}" class="bar ${e.success !== false ? 'success' : 'fail'}" style="width: ${Math.max(4, 100 / data.timeline.length)}%; height: ${h}px;"></div>`;
        }).join('')}
      </div>
      <div style="display: flex; justify-content: space-between; margin-top: 0.5rem; font-size: 0.7rem; color: #64748b;">
        <span>Start</span>
        <span>${data.timeline.length} steps</span>
        <span>End</span>
      </div>
    </div>

    <table>
      <thead><tr><th>#</th><th>Action</th><th>Duration</th><th>Status</th><th>Details</th></tr></thead>
      <tbody>
        ${(data.timeline || []).map((event, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${_escapeHtml(event.action)}</td>
          <td>${_fmtDuration(event.duration)}</td>
          <td class="${event.success === false ? 'failure' : 'success'}">${event.success === false ? 'FAIL' : 'OK'}</td>
          <td>${event.error ? `<span class="failure">${_escapeHtml(event.error)}</span>` : event.data?.orderId ? `Order: ${event.data.orderId}` : event.data?.completed !== undefined ? event.data.completed ? 'Completed' : 'Pending' : ''}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    ` : ''}

    <!-- Safety checks -->
    ${(data.safetyChecks?.length ?? 0) > 0 ? `
    <h2 class="sub-section"><h3>Safety Checks</h3></h2>
    ${data.safetyChecks.map(s => `
    <div class="safety-check ${s.passed ? '' : 'fail'}">
      <strong>${s.passed ? '\u2705' : '\u274C'} ${_escapeHtml(s.check)}</strong>
      ${s.detail ? `<br><span style="color: #94a3b8; font-size: 0.85rem;">${_escapeHtml(s.detail)}</span>` : ''}
    </div>
    `).join('')}
    ` : ''}

    <!-- Notifications -->
    <h2 class="sub-section"><h3>Notifications</h3></h2>
    ${(data.notifications || []).length === 0 ? '<p style="color: #64748b;">No notifications detected.</p>' : ''}
    ${(data.notifications || []).map(n => `
    <div class="notif-card ${n.success !== undefined && !n.success ? 'fail' : ''}">
      <h4>${_escapeHtml(n.title || '(no title)')}</h4>
      <p>${_escapeHtml(n.body || '(no body)')}</p>
      <div class="meta">
        ${n.packageName ? `Package: ${_escapeHtml(n.packageName)} &middot; ` : ''}
        Detected: ${n.detectedAt || 'N/A'}
        ${n.latencyMs !== undefined ? `&middot; Latency: <span class="latency ${n.latencyMs < 2000 ? 'fast' : n.latencyMs < 10000 ? 'slow' : 'very-slow'}">${_fmtDuration(n.latencyMs)}</span>` : ''}
        ${n.contentMatched !== undefined ? `&middot; Content matched: ${n.contentMatched ? '\u2705' : '\u274C'}` : ''}
      </div>
      ${n.screenshotPath ? `<img class="screenshot" src="${n.screenshotPath}" alt="Notification screenshot">` : ''}
    </div>`).join('')}

    ${latencies.length > 0 ? `
    <h2 class="sub-section"><h3>Latency Distribution</h3></h2>
    <div class="chart-container">
      <div style="display: flex; gap: 2px; align-items: flex-end; min-height: 60px;">
        ${latencies.map((l, i) => {
          const maxLat = Math.max(...latencies, 1);
          const h = Math.max(8, (l / maxLat) * 60);
          return `<div title="${_fmtDuration(l)}" class="bar success" style="width: ${Math.max(4, 100 / latencies.length)}%; height: ${h}px;"></div>`;
        }).join('')}
      </div>
      <div style="display: flex; justify-content: space-between; margin-top: 0.5rem; font-size: 0.7rem; color: #64748b;">
        <span>0</span>
        <span>${_fmtDuration(Math.max(...latencies))}</span>
      </div>
    </div>
    ` : ''}

    <!-- Overnight cycle detail -->
    ${(data.overnight?.cycles?.length ?? 0) > 0 ? `
    <h2 class="sub-section"><h3>Cycle Details</h3></h2>
    ${data.overnight.cycles.map(c => `
    <div class="cycle-card ${c.success ? 'pass' : 'fail'}">
      <div class="cycle-header">
        <h4>Cycle ${c.cycleIndex} ${c.success ? '\u2705' : '\u274C'}</h4>
        <span class="cycle-meta">${_fmtDuration(c.duration)}</span>
      </div>
      ${c.orderId ? `<div class="cycle-meta">Order: #${_escapeHtml(c.orderId)}</div>` : ''}
      ${c.error ? `<div class="failure-reason">${_escapeHtml(c.error)}</div>` : ''}
      ${c.notificationResult ? `
      <div class="cycle-meta">
        Notification: ${c.notificationResult.success ? '\u2705' : '\u274C'}
        ${c.notificationResult.latencyMs ? `| Latency: ${_fmtDuration(c.notificationResult.latencyMs)}` : ''}
        ${c.notificationResult.title ? `| "${_escapeHtml(c.notificationResult.title)}"` : ''}
      </div>` : ''}
      ${c.vendorResult ? `
      <div class="cycle-meta">
        Vendor: ${c.vendorResult.success ? '\u2705' : '\u274C'}
        ${c.vendorResult.steps ? `| Steps: ${c.vendorResult.steps.length}` : ''}
      </div>` : ''}
    </div>`).join('')}
    ` : ''}

    <!-- Device State -->
    <h2 class="sub-section"><h3>Device State</h3></h2>
    ${(data.deviceStates || []).length === 0 ? '<p style="color: #64748b;">No device state data.</p>' : ''}
    ${(data.deviceStates || []).map(state => `
    <div class="card">
      <dl class="device-state">
        <dt>Timestamp</dt><dd>${state.timestamp}</dd>
        <dt>Screen</dt><dd>${state.screenState}</dd>
        <dt>Battery Saver</dt><dd>${state.batterySaver}</dd>
        <dt>Doze Mode</dt><dd>${state.dozeMode}</dd>
        <dt>Notifications</dt><dd>${state.notificationCount}</dd>
      </dl>
    </div>`).join('')}

    <!-- Logs -->
    <h2 class="sub-section"><h3>Logs</h3></h2>
    <div class="card" style="max-height: 400px; overflow-y: auto; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.75rem;">
      ${(data.logs || []).map(log => `
      <div class="log-entry ${log.level}">[${log.timestamp}] [${log.level.toUpperCase()}] ${_escapeHtml(log.message)}${log.meta ? ' ' + _escapeHtml(JSON.stringify(log.meta)) : ''}</div>
      `).join('')}
    </div>

    <footer>
      Generated by RingWatch &mdash; FlashFoods Notification Reliability Framework
    </footer>
  </div>
</body>
</html>`;

  writeFileSync(filePath, html, 'utf-8');
  logger.info(`HTML report saved: ${filePath}`);
  return filePath;
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

function _escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

export default generateHtmlReport;
