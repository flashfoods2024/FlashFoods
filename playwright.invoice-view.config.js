// @ts-check
import { defineConfig, devices } from "@playwright/test";

// Isolated runner for the student invoice view/download flow. It reuses
// scripts/qa-billing-server.mjs with QA_BILLING_SEED=invoice-view, which seeds
// an activated template and one already-issued invoice. It must not share a
// server with billing-template.spec.js: that suite mutates (and finally
// removes) the Testing shop template, so its state would leak into these
// assertions.
process.env.PLAYWRIGHT_QA = "invoice-view";

const PORT = Number(process.env.QA_PORT || 3128);

/**
 * Run with: npm run test:e2e:invoice-view
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "view-invoice.spec.js",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/qa-billing-server.mjs",
    env: { QA_PORT: String(PORT), QA_BILLING_SEED: "invoice-view" },
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
  },
});
