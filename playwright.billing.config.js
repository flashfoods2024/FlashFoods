// @ts-check
import { defineConfig, devices } from "@playwright/test";

// Isolated billing-template suite. scripts/qa-billing-server.mjs boots an
// in-memory MongoDB, seeds the real "Testing" shop (slug "testing", the only
// shop the application allows mock checkout for) and then starts the app.
process.env.PLAYWRIGHT_QA = "billing";

const PORT = Number(process.env.QA_PORT || 3127);

/**
 * Run with: npm run test:e2e:billing
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "billing-template.spec.js",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/qa-billing-server.mjs",
    env: { QA_PORT: String(PORT) },
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
  },
});
