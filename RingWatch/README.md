# RingWatch v1

**RingWatch** is a notification reliability testing framework for FlashFoods. It automatically verifies that Android push notifications are delivered reliably across different app states and generates detailed HTML reports — all without manual intervention.

## Architecture

```
RingWatch/
├── controller/
│   ├── test-runner.js       # Orchestrates the full test lifecycle
│   ├── adb-controller.js    # ADB interface for Android device control
│   └── schedule.js          # Scenario execution engine
│
├── playwright/
│   ├── place-order.js       # Playwright-based order placement
│   ├── login-student.js     # Student login automation
│   └── login-vendor.js      # Vendor login automation
│
├── monitor/
│   ├── notification-monitor.js  # Android notification polling/detection
│   ├── logcat-monitor.js        # Logcat parsing for notification events
│   ├── chrome-monitor.js        # Chrome DevTools Protocol monitoring
│   └── firebase-monitor.js      # Firebase Cloud Messaging tracking
│
├── reports/
│   ├── html-report.js       # Modern responsive HTML report generation
│   ├── json-report.js       # Structured JSON report generation
│   └── screenshots/         # Captured screenshots
│
├── config/
│   └── ringwatch.config.js  # Central configuration with sensible defaults
│
├── logger.js                # Centralised logger (coloured console + file)
├── ringwatch.js             # CLI entry point
├── package.json             # RingWatch npm package
└── README.md                # This file
```

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
| `testingShop` | | `juice-corner` | **SAFETY**: The ONLY shop RingWatch may order from. All orders validated at runtime. |
| `order` | `shopSlug` | `juice-corner` | Shop slug (always matches `testingShop`) |
| `order` | `orderType` | `dinein` | Default order type |
| `scenario` | `defaultWaitMs` | `300000` (5 min) | Default wait between steps |
| `logging` | `level` | `info` | Log level (silent/error/warn/info/debug/trace) |

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

## Reports

RingWatch generates two report files in `reports/`:

- **HTML Report** — Modern, responsive, dark-themed dashboard with:
  - Pass/Fail badge and reliability score
  - Summary cards (steps, notifications, duration)
  - Full timeline with per-step status
  - Notification cards with latency indicators
  - Device state snapshots
  - Complete log output

- **JSON Report** — Structured data for CI pipelines and programmatic analysis.

## Requirements

- Node.js 18+
- Android device with USB debugging enabled (`adb devices` must show the device)
- Playwright browsers installed (`npx playwright install chromium`)
- FlashFoods server running

## Development

All modules use ES modules (`import`/`export`), async/await, and JSDoc annotations. Each module is designed to be extensible for RingWatch v2.

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
