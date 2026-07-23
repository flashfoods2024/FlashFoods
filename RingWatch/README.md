# RingWatch v2

**RingWatch** is a notification reliability testing framework for FlashFoods.
It automatically verifies that Android push notifications are delivered reliably
across different app states and generates structured forensic reports.

## Architecture

```
RingWatch/
├── controller/
│   ├── test-runner.js        # Orchestrates the full test lifecycle
│   ├── adb-controller.js     # ADB interface for Android device control
│   ├── schedule.js           # Scenario execution engine
│   └── overnight-mode.js     # Automated overnight testing loop
│
├── playwright/
│   ├── place-order.js        # Playwright-based order placement
│   ├── login-student.js      # Student login automation
│   ├── login-vendor.js       # Vendor login automation
│   ├── vendor-workflow.js    # Vendor order lifecycle automation
│   └── notification-validator.js  # Notification detection & validation
│
├── monitor/
│   ├── notification-monitor.js  # Android notification polling/detection
│   ├── logcat-monitor.js        # Logcat parsing for notification events
│   ├── chrome-monitor.js        # Chrome DevTools Protocol monitoring
│   └── firebase-monitor.js      # Firebase Cloud Messaging tracking
│
├── reports/
│   ├── report-manager.js     # Orchestrates all report generation
│   ├── html-report.js        # HTML report generator (secondary)
│   ├── json-report.js        # JSON report generator (legacy)
│   │
│   ├── latest/               # Copy of the most recent run (auto-updated)
│   │   ├── EXECUTIVE_SUMMARY.md
│   │   ├── HUMAN_REPORT.md
│   │   ├── AI_REPORT.md
│   │   ├── report.html
│   │   ├── report.json
│   │   ├── metadata.json
│   │   ├── logs/
│   │   ├── screenshots/
│   │   ├── artifacts/
│   │   └── timeline/
│   │
│   ├── YYYY-MM-DD/           # Date-stamped run folders
│   │   ├── run-01/
│   │   ├── run-02/
│   │   └── ...
│   │
│   └── archive/              # Compressed historical runs
│
├── config/
│   └── ringwatch.config.js   # Central configuration with sensible defaults
│
├── logger.js                 # Centralised logger (coloured console + file)
├── ringwatch.js              # CLI entry point
├── package.json              # RingWatch npm package
└── README.md                 # This file
```

## Report Types

Every RingWatch run generates the following reports in the run folder:

| Report | Format | Purpose | Reading Time |
|--------|--------|---------|-------------|
| `EXECUTIVE_SUMMARY.md` | Markdown | One-page overview — result, score, key metrics | < 1 minute |
| `HUMAN_REPORT.md` | Markdown | Plain-English explanation for tired humans | 3–5 minutes |
| `AI_REPORT.md` | Markdown | Full forensic dump for AI assistants | Exhaustive |
| `report.html` | HTML | Dark-themed visual dashboard (opens from disk) | Visual scan |
| `report.json` | JSON | Structured data for CI pipelines | Programmatic |
| `metadata.json` | JSON | Run metadata (env, git, config) | Programmatic |

### Sub-directories

- **logs/** — Per-subsystem log files: `student.log`, `vendor.log`, `ringwatch.log`, `adb.log`, `firebase.log`, `notification.log`, `playwright.log`, `console.log`
- **screenshots/** — Numbered screenshots captured during the run
- **artifacts/** — Raw debugging data (network captures, DOM snapshots, etc.)
- **timeline/** — `timeline.md` (human-readable) + `timeline.json` (machine-readable)

## Report Hierarchy

Markdown reports are the **primary** source of truth. HTML is secondary.

1. Start with **EXECUTIVE_SUMMARY.md** — did it pass? what's the score?
2. Read **HUMAN_REPORT.md** — what happened and what should I do?
3. Dig into **AI_REPORT.md** — full technical details and forensic data

## Quick Start

```bash
# From the project root, run:
npm run ringwatch

# With verbose logging:
npm run ringwatch -- --verbose

# With custom config:
npm run ringwatch -- --config ./ringwatch.config.json

# With custom scenario:
npm run ringwatch -- --scenario ./scenario.json

# Overnight mode (8 hours):
npm run ringwatch --overnight

# From the RingWatch directory:
node ringwatch.js
```

## Configuration

RingWatch works out of the box with sensible defaults. Configure via `ringwatch.config.js` or a JSON config file:

| Section | Key | Default | Description |
|---------|-----|---------|-------------|
| `appPackage` | | `com.flashfoods.app` | Android app package name |
| `baseUrl` | | `http://localhost:3000` | Web app URL |
| `browser` | `headless` | `false` | Run Playwright in headless mode |
| `browser` | `slowMo` | `100` | Slow-motion for debugging |
| `student` | `email` | `student@college.test` | Student credentials (seed data) |
| `student` | `password` | `vendor@1` | Student password (seed data) |
| `vendor` | `email` | `vendor@college.com` | Vendor credentials (seed data) |
| `vendor` | `password` | `vendor@1` | Vendor password (seed data) |
| `testingShop` | | `juice-corner` | **SAFETY**: The ONLY shop RingWatch may order from |
| `order` | `shopSlug` | `juice-corner` | Shop slug |
| `order` | `orderType` | `dinein` | Default order type |
| `scenario` | `defaultWaitMs` | `300000` (5 min) | Default wait between steps |
| `logging` | `level` | `info` | Log level |
| `reporting` | `outputDir` | `RingWatch/reports/` | Reports output directory |

## Scenario Format

Scenarios are arrays of step objects executed in order:

```json
[
  { "action": "loginStudent" },
  { "action": "order" },
  { "action": "wait", "duration": 300000 },
  { "action": "order" },
  { "action": "checkDeviceState" },
  { "action": "screenshot" }
]
```

### Supported Actions

| Action | Description |
|--------|-------------|
| `loginStudent` | Log in as student via Playwright |
| `loginVendor` | Log in as vendor via Playwright |
| `order` | Place an order as the logged-in student |
| `waitForOrder` | Wait for current order to complete |
| `launchApp` | Launch FlashFoods on Android device |
| `closeApp` | Force-close FlashFoods |
| `wakeDevice` | Wake the Android device |
| `sleepDevice` | Put device to sleep |
| `checkDeviceState` | Capture device state snapshot |
| `wait` | Wait for a duration (ms) |
| `loop` | Repeat a sub-scenario N times |
| `screenshot` | Capture a browser screenshot |

### Loop Example

```json
{
  "action": "loop",
  "iterations": 3,
  "steps": [
    { "action": "order" },
    { "action": "wait", "duration": 60000 }
  ]
}
```

## Reading Reports

### Quick check (under 1 minute)

```bash
# Open the executive summary
cat RingWatch/reports/latest/EXECUTIVE_SUMMARY.md

# Or the timeline
cat RingWatch/reports/latest/timeline/timeline.md
```

### Full human-readable report

```bash
cat RingWatch/reports/latest/HUMAN_REPORT.md
```

### AI forensic analysis

```bash
cat RingWatch/reports/latest/AI_REPORT.md
```

### HTML dashboard (opens in any browser)

```bash
# From the project root:
open RingWatch/reports/latest/report.html

# Or:
xdg-open RingWatch/reports/latest/report.html
```

## Historical Runs

Every run is automatically archived in a dated folder:

```
RingWatch/reports/2026-07-23/run-01/
RingWatch/reports/2026-07-23/run-02/
RingWatch/reports/2026-07-22/run-01/
```

The `latest/` folder always contains a copy of the most recent run for quick access.

## Requirements

- Node.js 18+
- Android device with USB debugging enabled (`adb devices` must show the device)
- Playwright browsers installed (`npx playwright install chromium`)
- FlashFoods server running

## Development

All modules use ES modules (`import`/`export`), async/await, and JSDoc annotations.

```bash
# Install RingWatch dependencies (from RingWatch/ directory)
cd RingWatch && npm install
```

## RingWatch v2 Roadmap

- Real-time notification delivery confirmation via FCM data API
- Multi-device parallel testing
- Deep link verification
- Network condition simulation
- Video recording of test sessions
- CI integration (GitHub Actions reporter)

---

Built for FlashFoods notification reliability testing.
