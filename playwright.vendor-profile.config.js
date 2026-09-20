// @ts-check
import { defineConfig, devices } from "@playwright/test";

// Marks this runner so tests/e2e/vendor-profile.spec.js knows it is running
// under the isolated QA harness instead of the shared e2e configuration.
// Workers inherit this process's environment.
process.env.PLAYWRIGHT_QA = "vendor-profile";

const PORT = Number(process.env.QA_PORT || 3123);

/**
 * Self-contained harness for the Vendor Profile V2 browser flow.
 *
 * Unlike the shared playwright.config.js it needs no externally seeded
 * database: scripts/qa-vendor-profile-server.mjs boots an in-memory MongoDB,
 * seeds two competing shops and then starts the real application.
 *
 * Run with: npm run test:e2e:vendor-profile
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "vendor-profile.spec.js",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/qa-vendor-profile-server.mjs",
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
  },
});
