import { test, expect } from "@playwright/test";
import { chromium } from "@playwright/test";

test.describe("FCM Diagnostic", () => {
  test("comprehensive FCM flow diagnosis", async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      permissions: ["notifications"],
    });
    const page = await context.newPage();

    const logs = [];

    page.on("console", (msg) => {
      logs.push({ type: msg.type(), text: msg.text(), ts: Date.now() });
    });
    page.on("pageerror", (err) => {
      logs.push({ type: "error", text: `[PAGE_ERROR] ${err.message}`, ts: Date.now() });
    });
    page.on("requestfailed", (req) => {
      logs.push({ type: "network", text: `[FAILED] ${req.url()} - ${req.failure()?.errorText || "unknown"}`, ts: Date.now() });
    });

    // 1. Log in as vendor
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    await page.locator("input[name=\"email\"]").fill("vendor@college.com");
    await page.locator("input[name=\"password\"]").fill("vendor@1");
    await page.locator("button[type=\"submit\"]").click();
    await page.waitForLoadState("networkidle");

    // 2. Navigate to home page
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Wait for all pending async work (FCM token registration) to settle
    await page.waitForTimeout(3000);

    // 3. Capture full HTML and check for Firebase scripts
    const html = await page.content();

    const checks = {
      firebaseAppCompat: html.includes("firebase-app-compat.js"),
      firebaseMessagingCompat: html.includes("firebase-messaging-compat.js"),
      firebaseConfigInline: html.includes("__FIREBASE_CONFIG__"),
      firebaseClientJs: html.includes("firebase-client.js"),
      firebaseDefined: await page.evaluate(() => typeof firebase !== "undefined"),
      firebaseConfigVar: await page.evaluate(() => {
        const c = window.__FIREBASE_CONFIG__;
        return c ? { apiKey: !!c.apiKey, vapidKey: !!c.vapidKey, keys: Object.keys(c) } : null;
      }),
      serviceWorkerRegistered: await page.evaluate(async () => {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          return regs.map((r) => ({
            scope: r.scope,
            active: !!r.active,
            scriptURL: r.active?.scriptURL || null,
          }));
        } catch {
          return "error";
        }
      }),
      notificationPermission: await page.evaluate(() => Notification.permission),
    };

    // Check if localStorage has the registered flag
    const localStorageFlag = await page.evaluate(() =>
      localStorage.getItem("fcm_token_registered")
    );
    checks.localStorageFlag = localStorageFlag;

    console.log("=== FCM DIAGNOSTIC RESULTS ===");
    console.log(JSON.stringify(checks, null, 2));

    // Categorize logs
    const fcmLogs = logs.filter((l) => l.text.includes("[FCM]"));
    const networkErrors = logs.filter((l) => l.type === "network" || l.type === "error");

    console.log("\n=== FCM-RELATED LOGS ===");
    fcmLogs.forEach((l, i) => console.log(`[${i}] [${l.type}] ${l.text}`));

    console.log("\n=== NETWORK ERRORS ===");
    networkErrors.forEach((l, i) => console.log(`[${i}] [${l.type}] ${l.text}`));

    console.log("\n=== ALL CONSOLE LOGS ===");
    logs.forEach((l, i) => console.log(`[${i}] [${l.type}] ${l.text}`));

    // Assertions
    expect(checks.firebaseAppCompat).toBe(true);
    expect(checks.firebaseMessagingCompat).toBe(true);
    expect(checks.firebaseConfigInline).toBe(true);
    expect(checks.firebaseClientJs).toBe(true);
    expect(checks.firebaseDefined).toBe(true);

    await browser.close();
  });
});
