import { writeFileSync, existsSync, mkdirSync, readdirSync, cpSync, rmSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getLogger } from '../logger.js';
import { getConfig } from '../config/ringwatch.config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ANSI = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function stripAnsi(s) {
  return String(s).replace(ANSI, '');
}

function fmtDuration(ms) {
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

function fmtTimestamp(ts) {
  if (!ts) return 'N/A';
  if (typeof ts === 'number') return new Date(ts).toISOString();
  return new Date(ts).toISOString();
}

function pad(s, n) {
  return String(s).padEnd(n);
}

function escMd(s) {
  if (!s) return '';
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function heading(level, text) {
  return `${'#'.repeat(level)} ${text}\n\n`;
}

function table(headers, rows) {
  const h = headers.join(' | ');
  const sep = headers.map(() => '---').join(' | ');
  const r = rows.map(r => r.map(c => escMd(c)).join(' | ')).join('\n');
  return `${h}\n${sep}\n${r}\n\n`;
}

function code(text, lang = '') {
  return '```' + lang + '\n' + text + '\n```\n\n';
}

function bold(text) {
  return `**${text}**`;
}

export class ReportManager {
  constructor(config) {
    this._config = config || getConfig();
    this._logger = getLogger();
    this._baseDir = this._config.reporting?.outputDir || resolve(__dirname, '..', 'reports');
  }

  async generateAllReports(data) {
    const runDir = this._createRunDir();
    const subDirs = this._createSubDirs(runDir);

    this._logger.configureSubsystemLogs(subDirs.logs);
    this._logger.info(`Report run directory: ${runDir}`);

    const results = {};

    results.executiveSummary = await this._generateExecutiveSummary(data, subDirs);
    results.humanReport = await this._generateHumanReport(data, subDirs);
    results.aiReport = await this._generateAiReport(data, subDirs);
    results.reportJson = await this._generateJsonReport(data, subDirs);
    results.reportHtml = await this._generateHtmlReport(data, subDirs);
    results.metadata = await this._generateMetadata(data, subDirs);
    results.timelineMd = await this._generateTimelineMd(data, subDirs);
    results.timelineJson = await this._generateTimelineJson(data, subDirs);

    await this._updateLatest(runDir);

    this._logger.info(`All reports generated in ${runDir}`);
    return { runDir, ...results };
  }

  _createRunDir() {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const dateDir = resolve(this._baseDir, dateStr);

    if (!existsSync(dateDir)) {
      mkdirSync(dateDir, { recursive: true });
    }

    const entries = readdirSync(dateDir, { withFileTypes: true });
    let maxRun = 0;
    for (const e of entries) {
      if (e.isDirectory()) {
        const m = e.name.match(/^run-(\d+)$/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > maxRun) maxRun = n;
        }
      }
    }
    const runNum = maxRun + 1;
    const runDir = resolve(dateDir, `run-${String(runNum).padStart(2, '0')}`);
    mkdirSync(runDir, { recursive: true });
    return runDir;
  }

  _createSubDirs(runDir) {
    const dirs = {};
    for (const name of ['logs', 'screenshots', 'artifacts', 'timeline']) {
      const p = resolve(runDir, name);
      mkdirSync(p, { recursive: true });
      dirs[name] = p;
    }
    dirs.run = runDir;
    return dirs;
  }

  async _generateExecutiveSummary(data, dirs) {
    const passed = (data.summary?.failures ?? 0) === 0 && !data.summary?.fatalError;
    const score = data.reliabilityScore ?? 0;
    const s = data.summary || {};
    const ov = data.overnight;

    let md = heading(1, 'RingWatch Executive Summary');
    md += `**Result:** ${passed ? '✅ PASS' : '❌ FAIL'}\n\n`;
    md += table(
      ['Metric', 'Value'],
      [
        ['Reliability Score', `${score}%`],
        ['Duration', fmtDuration(s.totalDuration || 0)],
        ['Total Steps', String(s.totalSteps ?? 0)],
        ['Passed', String(s.passed ?? 0)],
        ['Failures', String(s.failures ?? 0)],
        ['Notifications Detected', String(s.notificationsDetected ?? 0)],
      ]
    );

    if (ov) {
      md += heading(2, 'Overnight Summary');
      md += table(
        ['Metric', 'Value'],
        [
          ['Cycles Completed', String(ov.cyclesCompleted ?? 0)],
          ['Orders Created', String(ov.ordersCreated ?? 0)],
          ['Orders Completed', String(ov.ordersCompleted ?? 0)],
          ['Notifications Received', String(ov.notificationsReceived ?? 0)],
          ['Notifications Missed', String(ov.notificationsMissed ?? 0)],
          ['Avg Latency', fmtDuration(ov.avgLatencyMs ?? 0)],
          ['Min Latency', fmtDuration(ov.minLatencyMs ?? 0)],
          ['Max Latency', fmtDuration(ov.maxLatencyMs ?? 0)],
          ['Failures', String(ov.failures ?? 0)],
          ['Reliability Score', `${ov.reliabilityScore ?? 0}%`],
        ]
      );

      if (ov.failureReasons?.length > 0) {
        md += heading(3, 'Critical Failures');
        for (const f of ov.failureReasons) {
          md += `- Cycle ${f.cycle}: ${f.error}\n`;
        }
        md += '\n';
      }
    }

    if (s.fatalError) {
      md += heading(2, 'Fatal Error');
      md += code(s.fatalError);
    }

    md += heading(2, 'Next Recommended Action');
    if (s.failures > 0 || s.fatalError) {
      md += '- Review the HUMAN_REPORT.md for a plain-English explanation of failures.\n';
      md += '- Check screenshots in `screenshots/` for visual evidence.\n';
      md += '- Verify the FlashFoods server is running and seed data is populated.\n';
    } else {
      md += '- All systems nominal. Continue monitoring with overnight mode.\n';
    }
    md += '- For detailed forensic analysis, read AI_REPORT.md.\n';
    md += '\n---\n*Generated by RingWatch*\n';

    const filePath = resolve(dirs.run, 'EXECUTIVE_SUMMARY.md');
    writeFileSync(filePath, md, 'utf-8');
    this._logger.info('EXECUTIVE_SUMMARY.md generated');
    return filePath;
  }

  async _generateHumanReport(data, dirs) {
    const passed = (data.summary?.failures ?? 0) === 0 && !data.summary?.fatalError;
    const score = data.reliabilityScore ?? 0;
    const s = data.summary || {};
    const ov = data.overnight;
    const cfg = this._config;

    let md = heading(1, 'RingWatch — Human Report');
    md += `*Generated: ${new Date().toISOString()}*\n\n`;
    md += `**Overall Result:** ${passed ? '✅ Everything looks good!' : '❌ Something went wrong'}\n\n`;

    md += heading(2, 'What Happened');
    if (ov) {
      md += `RingWatch ran ${ov.cyclesCompleted ?? 0} test cycles overnight. `;
      md += `It created ${ov.ordersCreated ?? 0} test orders and completed ${ov.ordersCompleted ?? 0} of them. `;
      md += `Notifications were received ${ov.notificationsReceived ?? 0} times and missed ${ov.notificationsMissed ?? 0} times. `;
      md += `The overall reliability score was **${score}%**.\n\n`;
    } else {
      md += `RingWatch ran ${s.totalSteps ?? 0} test steps. `;
      md += `${s.passed ?? 0} passed and ${s.failures ?? 0} failed.\n\n`;
    }

    md += heading(2, 'Configuration Used');
    md += table(
      ['Setting', 'Value'],
      [
        ['Testing Shop', cfg.testingShop || 'juice-corner'],
        ['Student Email', cfg.student?.email || 'N/A'],
        ['Vendor Email', cfg.vendor?.email || 'N/A'],
        ['Base URL', cfg.baseUrl || 'N/A'],
        ['Headless Browser', String(cfg.browser?.headless ?? false)],
      ]
    );

    if (s.failures > 0 || s.fatalError) {
      md += heading(2, 'Problems Encountered');
      const failures = (data.timeline || []).filter(t => t.success === false);
      for (const f of failures) {
        md += `- **${f.action}** failed: ${stripAnsi(f.error || 'Unknown error')}\n`;
      }
      if (s.fatalError) {
        md += `- **Fatal error**: ${stripAnsi(s.fatalError)}\n`;
      }
      md += '\n';

      md += heading(3, 'Should You Worry?');
      if (s.failures <= 3) {
        md += 'Probably not. A small number of failures is normal in testing. ';
        md += 'Check the screenshots to see what happened visually.\n\n';
      } else {
        md += 'Yes, there were several failures. This needs investigation.\n\n';
      }

      md += heading(3, 'What Should You Do Next?');
      md += '1. Look at the screenshots in the `screenshots/` folder to see what the app looked like when it failed.\n';
      md += '2. Check if the FlashFoods server was running at test time.\n';
      md += '3. Verify seed data is populated (`node seed.js`).\n';
      md += '4. Check the detailed logs in the `logs/` folder.\n';
      md += '5. For deep technical analysis, read AI_REPORT.md.\n\n';
    } else {
      md += heading(2, 'Notifications');
      const notifs = data.notifications || [];
      if (notifs.length > 0) {
        md += `RingWatch detected ${notifs.length} notifications during the run:\n\n`;
        for (const n of notifs) {
          const lat = n.latencyMs !== undefined ? fmtDuration(n.latencyMs) : 'N/A';
          md += `- "${n.title || '(no title)'}" from ${n.packageName || 'unknown'} (latency: ${lat})\n`;
        }
        md += '\n';
      } else {
        md += 'No notifications were detected during this run.\n\n';
      }

      md += heading(3, 'Next Steps');
      md += 'Everything looks healthy. Continue monitoring.\n\n';
    }

    md += heading(2, 'Screenshots');
    md += 'Screenshots from this run are stored in the `screenshots/` folder.\n\n';

    md += heading(2, 'Performance Summary');
    md += table(
      ['Metric', 'Value'],
      [
        ['Total Duration', fmtDuration(s.totalDuration || 0)],
        ['Steps', String(s.totalSteps ?? 0)],
        ['Pass Rate', `${Math.round(((s.passed ?? 0) / Math.max(s.totalSteps ?? 1, 1)) * 100)}%`],
        ['Reliability Score', `${score}%`],
      ]
    );
    md += '\n---\n*Generated by RingWatch*\n';

    const filePath = resolve(dirs.run, 'HUMAN_REPORT.md');
    writeFileSync(filePath, md, 'utf-8');
    this._logger.info('HUMAN_REPORT.md generated');
    return filePath;
  }

  async _generateAiReport(data, dirs) {
    const passed = (data.summary?.failures ?? 0) === 0 && !data.summary?.fatalError;
    const s = data.summary || {};
    const ov = data.overnight;
    const cfg = this._config;

    let md = heading(1, 'RingWatch AI Report — Complete Forensic Dump');
    md += `*Generated: ${new Date().toISOString()}*\n\n`;
    md += `**Overall Result:** ${passed ? 'PASS' : 'FAIL'}\n\n`;

    md += heading(2, 'Run Metadata');
    md += table(
      ['Field', 'Value'],
      [
        ['RingWatch Version', '2.0.0'],
        ['Start Time', fmtTimestamp(s.startTime)],
        ['End Time', fmtTimestamp(s.endTime)],
        ['Duration', fmtDuration(s.totalDuration || 0)],
        ['Mode', ov ? 'overnight' : 'standard'],
        ['Passed', String(passed)],
        ['Reliability Score', `${data.reliabilityScore ?? 0}%`],
      ]
    );

    md += heading(2, 'Environment');
    md += table(
      ['Field', 'Value'],
      [
        ['Node Version', process.version],
        ['Platform', process.platform],
        ['Arch', process.arch],
        ['CWD', process.cwd()],
      ]
    );

    md += heading(2, 'Configuration');
    md += code(JSON.stringify(cfg, null, 2), 'json');

    md += heading(2, 'Safety Checks');
    const checks = data.safetyChecks || [];
    md += table(
      ['Check', 'Passed', 'Detail'],
      checks.map(c => [c.check, c.passed ? '✅' : '❌', c.detail || ''])
    );

    md += heading(2, 'Timeline');
    const timeline = data.timeline || [];
    md += table(
      ['#', 'Action', 'Duration', 'Status', 'Error / Detail'],
      timeline.map((t, i) => [
        String(i + 1),
        t.action || 'unknown',
        fmtDuration(t.duration),
        t.success === false ? 'FAIL' : 'OK',
        stripAnsi(t.error || (t.data?.orderId ? `Order: ${t.data.orderId}` : '')),
      ])
    );

    if (ov) {
      md += heading(2, 'Overnight Mode — Cycle Details');
      const cycles = ov.cycles || [];
      md += `Total cycles: ${cycles.length}\n\n`;
      for (const c of cycles) {
        md += heading(3, `Cycle ${c.cycleIndex} — ${c.success ? '✅' : '❌'}`);
        md += table(
          ['Field', 'Value'],
          [
            ['Order ID', c.orderId || 'N/A'],
            ['Duration', fmtDuration(c.duration)],
            ['Error', c.error || 'none'],
          ]
        );
        if (c.notificationResult) {
          md += `**Notification:** ${c.notificationResult.success ? '✅' : '❌'}\n`;
          md += `- Latency: ${fmtDuration(c.notificationResult.latencyMs)}\n`;
          md += `- Title: ${c.notificationResult.title || '(none)'}\n`;
          md += `- Body: ${c.notificationResult.body || '(none)'}\n`;
          md += `- Content matched: ${c.notificationResult.contentMatched ?? false}\n`;
          md += `- Screenshot: ${c.notificationResult.screenshotPath || 'none'}\n\n`;
        }
        if (c.vendorResult) {
          md += `**Vendor Workflow:** ${c.vendorResult.success ? '✅' : '❌'}\n`;
          md += `- Steps: ${(c.vendorResult.steps || []).length}\n`;
          md += `- Duration: ${fmtDuration(c.vendorResult.totalDuration)}\n\n`;
        }
        const cycleTimeline = c.timeline || [];
        if (cycleTimeline.length > 0) {
          md += '**Cycle Timeline:**\n\n';
          md += table(
            ['Action', 'Status', 'Detail'],
            cycleTimeline.map(t => [t.action, t.status || 'ok', t.orderId ? `Order: ${t.orderId}` : (t.latencyMs !== undefined ? `Latency: ${fmtDuration(t.latencyMs)}` : '')])
          );
        }
      }

      if (ov.failureReasons?.length > 0) {
        md += heading(2, 'Failure Reasons');
        md += table(
          ['Cycle', 'Error'],
          ov.failureReasons.map(f => [String(f.cycle), f.error])
        );
      }
    }

    md += heading(2, 'Notifications Detected');
    const notifs = data.notifications || [];
    if (notifs.length === 0) {
      md += 'No notifications were detected.\n\n';
    } else {
      md += table(
        ['ID', 'Title', 'Body', 'Package', 'Latency', 'Source', 'Content Matched'],
        notifs.map(n => [
          n.id || '',
          n.title || '',
          n.body || '',
          n.packageName || '',
          n.latencyMs !== undefined ? fmtDuration(n.latencyMs) : '',
          n.source || '',
          n.contentMatched !== undefined ? String(n.contentMatched) : '',
        ])
      );
    }

    md += heading(2, 'Logcat Events');
    const logcat = data.logcatEvents || [];
    md += table(
      ['Timestamp', 'Tag', 'Level', 'Message'],
      logcat.slice(0, 50).map(e => [fmtTimestamp(e.timestamp), e.tag || '', e.level || '', (e.message || '').slice(0, 200)])
    );
    if (logcat.length > 50) {
      md += `... and ${logcat.length - 50} more logcat events (see artifacts/ for full dump)\n\n`;
    }

    md += heading(2, 'Chrome DevTools Events');
    const chrome = data.chromeEvents || [];
    md += table(
      ['Timestamp', 'Type', 'Data'],
      chrome.slice(0, 50).map(e => [fmtTimestamp(e.timestamp), e.type || '', JSON.stringify(e.data).slice(0, 200)])
    );
    if (chrome.length > 50) {
      md += `... and ${chrome.length - 50} more CDP events\n\n`;
    }

    md += heading(2, 'Firebase Messages');
    const fb = data.firebaseMessages || [];
    md += table(
      ['Timestamp', 'Message ID', 'Target', 'Error'],
      fb.map(m => [fmtTimestamp(m.timestamp), m.messageId || '', m.target || '', m.error || ''])
    );

    md += heading(2, 'Device States');
    const states = data.deviceStates || [];
    md += table(
      ['Timestamp', 'Screen', 'Battery Saver', 'Doze Mode', 'Notifications'],
      states.map(s => [fmtTimestamp(s.timestamp), s.screenState || '', String(s.batterySaver ?? ''), String(s.dozeMode ?? ''), String(s.notificationCount ?? '')])
    );

    md += heading(2, 'Artifacts Generated');
    md += `- Screenshots: ${dirs.screenshots}\n`;
    md += `- Logs: ${dirs.logs}\n`;
    md += `- Artifacts: ${dirs.artifacts}\n`;
    md += `- Timeline: ${dirs.timeline}\n\n`;

    md += heading(2, 'Recommendations for Future Development');
    const failureCount = s.failures ?? 0;
    if (failureCount > 0) {
      md += `1. Investigate the ${failureCount} failure(s) — root causes are documented in the timeline above.\n`;
      md += '2. Check if the FlashFoods server was running with correct seed data.\n';
      md += '3. Review the `logs/` directory for subsystem-specific error details.\n';
      md += '4. Compare screenshots against expected app states.\n';
    } else {
      md += '1. System appears stable. Continue monitoring with overnight mode.\n';
      md += '2. Consider increasing test frequency or adding more scenarios.\n';
      md += '3. Review for potential edge cases not covered by current tests.\n';
    }
    md += '4. Extend RingWatch with additional monitors as needed.\n\n';

    md += heading(2, 'Known Limitations');
    md += '- Requires FlashFoods server to be running with seed data.\n';
    md += '- Requires Android device with USB debugging enabled for full notification testing.\n';
    md += '- Notification detection depends on ADB logcat polling interval.\n';
    md += '- Browser automation requires Playwright-compatible browser.\n\n';

    md += '---\n*Generated by RingWatch — AI-readable forensic report*\n';

    const filePath = resolve(dirs.run, 'AI_REPORT.md');
    writeFileSync(filePath, md, 'utf-8');
    this._logger.info('AI_REPORT.md generated');
    return filePath;
  }

  async _generateJsonReport(data, dirs) {
    const report = { ...data };
    const filePath = resolve(dirs.run, 'report.json');
    writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
    this._logger.info('report.json generated');
    return filePath;
  }

  async _generateHtmlReport(data, dirs) {
    const { generateHtmlReport } = await import('./html-report.js');
    return generateHtmlReport(data, this._config, dirs.run);
  }

  async _generateMetadata(data, dirs) {
    const s = data.summary || {};
    const cfg = this._config;

    const metadata = {
      runId: `${new Date().toISOString().replace(/[:.]/g, '-')}`,
      startTime: s.startTime || null,
      endTime: s.endTime || null,
      durationMs: s.totalDuration || 0,
      mode: data.overnight ? 'overnight' : 'standard',
      passed: (s.failures ?? 0) === 0 && !s.fatalError,
      reliabilityScore: data.reliabilityScore ?? 0,
      config: {
        testingShop: cfg.testingShop,
        baseUrl: cfg.baseUrl,
        studentEmail: cfg.student?.email,
        vendorEmail: cfg.vendor?.email,
        headless: cfg.browser?.headless ?? false,
      },
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      ringwatchVersion: '2.0.0',
      flashfoodsVersion: '1.0.1',
      git: null,
    };

    try {
      const { execSync } = await import('child_process');
      metadata.git = {
        commit: execSync('git rev-parse HEAD 2>/dev/null', { encoding: 'utf-8' }).trim(),
        branch: execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { encoding: 'utf-8' }).trim(),
      };
    } catch { metadata.git = { commit: 'unknown', branch: 'unknown' }; }

    const filePath = resolve(dirs.run, 'metadata.json');
    writeFileSync(filePath, JSON.stringify(metadata, null, 2), 'utf-8');
    this._logger.info('metadata.json generated');
    return filePath;
  }

  async _generateTimelineMd(data, dirs) {
    const timeline = data.timeline || [];
    let md = heading(1, 'RingWatch Timeline');
    md += `*Generated: ${new Date().toISOString()}*\n\n`;

    if (timeline.length === 0) {
      md += 'No timeline events recorded.\n';
    } else {
      md += table(
        ['#', 'Time', 'Action', 'Duration', 'Status', 'Detail'],
        timeline.map((t, i) => [
          String(i + 1),
          t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : 'N/A',
          t.action || 'unknown',
          fmtDuration(t.duration),
          t.success === false ? '❌ FAIL' : '✅ OK',
          stripAnsi(t.error || (t.data?.orderId ? `Order: ${t.data.orderId}` : (t.data?.latencyMs !== undefined ? `Latency: ${fmtDuration(t.data.latencyMs)}` : ''))),
        ])
      );

      md += '\n## Visual Timeline\n\n';
      for (const t of timeline) {
        const icon = t.success === false ? '❌' : '✅';
        const time = t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : '--:--:--';
        md += `- ${time} ${icon} **${t.action}** (${fmtDuration(t.duration)})\n`;
        if (t.error) md += `  - Error: ${stripAnsi(t.error)}\n`;
        if (t.data?.orderId) md += `  - Order: \`${t.data.orderId}\`\n`;
      }
      md += '\n';
    }

    const filePath = resolve(dirs.timeline, 'timeline.md');
    writeFileSync(filePath, md, 'utf-8');
    this._logger.info('timeline.md generated');

    const jsonPath = resolve(dirs.timeline, 'timeline.json');
    writeFileSync(jsonPath, JSON.stringify(timeline, null, 2), 'utf-8');
    this._logger.info('timeline.json generated');

    return { md: filePath, json: jsonPath };
  }

  async _generateTimelineJson(data, dirs) {
    return resolve(dirs.timeline, 'timeline.json');
  }

  async _updateLatest(runDir) {
    const latestDir = resolve(this._baseDir, 'latest');
    if (existsSync(latestDir)) {
      try {
        rmSync(latestDir, { recursive: true, force: true });
      } catch { }
    }

    try {
      cpSync(runDir, latestDir, { recursive: true });
      this._logger.info(`Updated latest/ from ${runDir}`);
    } catch (err) {
      this._logger.warn(`Failed to update latest/: ${err.message}`);
    }
  }
}

export default ReportManager;
