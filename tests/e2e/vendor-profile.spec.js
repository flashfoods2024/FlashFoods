import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Browser flow for Vendor Profile V2. It only runs under the isolated QA
// harness (playwright.vendor-profile.config.js + scripts/qa-vendor-profile-server.mjs),
// which owns an in-memory database and writes this fixture file.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE_FILE = path.join(ROOT, "temp", "qa-vendor-profile-fixture.json");
const fixture = fs.existsSync(FIXTURE_FILE)
  ? JSON.parse(fs.readFileSync(FIXTURE_FILE, "utf8"))
  : null;

const MANAGE = /\/vendor\/orders\/pending$/;

test.describe("Vendor Profile V2", () => {
  test.skip(
    !process.env.PLAYWRIGHT_QA || !fixture,
    "runs via npm run test:e2e:vendor-profile (isolated QA harness)",
  );

  const kpi = (page, key) => page.locator(`[data-kpi="${key}"]`);
  const period = (page, bucket, metric) =>
    page.locator(`[data-period="${bucket}"][data-metric="${metric}"]`);

  async function loginAs(page, credentials, expectedUrl = MANAGE) {
    await page.goto("/login");
    await page.fill('input[name="email"]', credentials.email);
    await page.fill('input[name="password"]', credentials.password);
    await Promise.all([
      page.waitForURL(expectedUrl),
      page.click('button[type="submit"]'),
    ]);
  }

  async function applyCustomRange(page, startDate, endDate) {
    await page.click('[data-range="custom"]');
    await page.fill("#vendor-start-date", startDate);
    await page.fill("#vendor-end-date", endDate);
    await page.click("#vendor-apply-range");
  }

  async function expectSummary(page, expected) {
    await expect(kpi(page, "orders")).toHaveText(String(expected.orders));
    await expect(kpi(page, "revenue")).toHaveText(expected.revenueLabel);
    await expect(kpi(page, "itemsSold")).toHaveText(String(expected.itemsSold));
    await expect(kpi(page, "averageOrderValue")).toHaveText(
      expected.averageOrderValueLabel,
    );
  }

  async function expectBestSellers(page, expected) {
    const rows = page.locator("#vendor-best-sellers-body tr");
    if (expected.length === 0) {
      await expect(page.locator("#vendor-best-sellers-empty")).toBeVisible();
      return;
    }
    await expect(page.locator("#vendor-best-sellers-empty")).toBeHidden();
    await expect(rows).toHaveCount(expected.length);
    for (let index = 0; index < expected.length; index += 1) {
      const row = rows.nth(index);
      await expect(row.locator("td").nth(0)).toHaveText(expected[index].name);
      await expect(row.locator("td").nth(1)).toHaveText(String(expected[index].quantity));
      await expect(row.locator("td").nth(2)).toHaveText(expected[index].revenueLabel);
    }
  }

  test("anonymous visitors are sent to the login page", async ({ page }) => {
    await page.goto("/vendor/profile");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("students cannot open the vendor profile", async ({ page }) => {
    // Students land on the home page after logging in.
    await loginAs(page, fixture.student, `${fixture.baseUrl}/`);
    await page.goto("/vendor/profile");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("body")).not.toContainText("Business Snapshot");
  });

  test("the student profile keeps working", async ({ page }) => {
    await loginAs(page, fixture.student, `${fixture.baseUrl}/`);

    const profile = await page.goto("/profile");
    expect(profile.status()).toBe(200);
    await expect(page.locator("body")).toContainText("Your Profile");
    await expect(page.locator("body")).toContainText("Account Information");

    // The student profile layout is untouched at mobile widths.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/profile");
    await expect(page.locator("#phone-display")).toBeVisible();
    await expect(page.locator("#phone-edit-btn")).toBeVisible();

    const orders = await page.goto("/orders");
    expect(orders.status()).toBe(200);
  });

  test.describe("as the authenticated vendor", () => {
    test.beforeEach(async ({ page }) => {
      await loginAs(page, fixture.vendor);
      await page.goto("/vendor/profile");
    });


    test("shows account details, the shop and the today/week/month snapshot", async ({
      page,
    }) => {
      await expect(page.locator("#vendor-profile-name")).toHaveText(fixture.vendor.name);
      await expect(page.locator("body")).toContainText(fixture.vendor.shopName);
      await expect(page.locator("#vendor-email")).toContainText(fixture.vendor.email);
      await expect(page.locator("#vendor-name-input")).toHaveValue(fixture.vendor.name);
      await expect(page.locator("#vendor-phone-input")).toHaveValue(fixture.vendor.phone);
      await expect(page.locator("body")).toContainText(fixture.vendor.memberSince);

      await expect(period(page, "today", "orders")).toHaveText(String(fixture.today.orders));
      await expect(period(page, "today", "revenue")).toHaveText(fixture.today.revenueLabel);
      await expect(period(page, "week", "orders")).toHaveText(String(fixture.week.orders));
      await expect(period(page, "week", "revenue")).toHaveText(fixture.week.revenueLabel);
      await expect(period(page, "month", "orders")).toHaveText(String(fixture.month.orders));
      await expect(period(page, "month", "revenue")).toHaveText(fixture.month.revenueLabel);
    });

    test("opens on this month and excludes other periods and other shops", async ({
      page,
    }) => {
      await expect(page.locator("#vendor-range-label")).toHaveText("This month");
      await expectSummary(page, fixture.month);
      await expectBestSellers(page, fixture.bestSellersMonth);

      // Previous-month order, cancelled order and rival shop data must not leak.
      await expect(page.locator("body")).not.toContainText("QA Old Combo");
      await expect(page.locator("body")).not.toContainText("QA Cancelled Special");
      await expect(page.locator("body")).not.toContainText(fixture.rival.shopName);
      await expect(page.locator("body")).not.toContainText(fixture.rival.itemName);
      await expect(page.locator("body")).not.toContainText(fixture.rival.revenueLabel);
    });

    test("recomputes analytics for today, including best sellers", async ({ page }) => {
      await page.click('[data-range="today"]');
      await expect(page.locator("#vendor-range-label")).toHaveText("Today");
      await expectSummary(page, fixture.today);
      await expectBestSellers(page, fixture.bestSellersToday);
      await expect(page.locator("body")).not.toContainText("QA Removed Special");
    });

    test("supports a custom same-day range", async ({ page }) => {
      await applyCustomRange(page, fixture.today.date, fixture.today.date);
      await expect(page.locator("#vendor-range-label")).toHaveText(fixture.today.label);
      await expectSummary(page, fixture.today);
    });

    test("supports a custom range spanning previous months", async ({ page }) => {
      await applyCustomRange(page, fixture.wideRange.startDate, fixture.wideRange.endDate);
      await expect(page.locator("#vendor-range-label")).toHaveText(fixture.wideRange.label);
      await expectSummary(page, fixture.wideRange);
      await expectBestSellers(page, fixture.wideRange.bestSellers);
      await expect(page.locator("body")).toContainText("QA Old Combo");
    });

    test("rejects an invalid custom range without losing the last results", async ({
      page,
    }) => {
      await applyCustomRange(page, fixture.today.date, fixture.dayBeforeToday);
      await expect(page.locator("#vendor-analytics-status")).toHaveText(
        "Start date cannot be after the end date.",
      );
      // The month analytics from page load are still on screen.
      await expectSummary(page, fixture.month);
    });

    test("shows an empty state for a future range", async ({ page }) => {
      await applyCustomRange(page, fixture.futureDate, fixture.futureDate);
      await expect(kpi(page, "orders")).toHaveText("0");
      await expect(kpi(page, "revenue")).toHaveText("\u20B90");
      await expect(kpi(page, "itemsSold")).toHaveText("0");
      await expectBestSellers(page, []);
    });

    test("edits name and phone while restricted fields stay read-only", async ({
      page,
    }) => {
      const newName = "Ramesh QA Updated";
      const newPhone = "9000099999";

      await page.fill("#vendor-name-input", newName);
      await page.fill("#vendor-phone-input", newPhone);
      await page.click("#vendor-profile-save");
      await expect(page.locator("#vendor-profile-msg")).toHaveText("Profile updated.");
      await expect(page.locator("#vendor-profile-name")).toHaveText(newName);

      // Persisted server-side.
      await page.reload();
      await expect(page.locator("#vendor-name-input")).toHaveValue(newName);
      await expect(page.locator("#vendor-phone-input")).toHaveValue(newPhone);

      // Email and shop remain display-only: no writable fields exist for the
      // restricted/account fields at all.
      await expect(page.locator("#vendor-email")).toContainText(fixture.vendor.email);
      await expect(page.locator("body")).toContainText(fixture.vendor.shopName);
      for (const name of ["email", "role", "shop", "isActive", "passwordHash"]) {
        expect(await page.locator(`input[name="${name}"]`).count()).toBe(0);
      }
    });

    test("rejects invalid edits and keeps the stored values", async ({ page }) => {
      await page.fill("#vendor-phone-input", "12345");
      await page.click("#vendor-profile-save");
      await expect(page.locator("#vendor-profile-msg")).toHaveText(
        "Enter a valid 10-digit Indian mobile number.",
      );

      await page.fill("#vendor-name-input", "   ");
      await page.click("#vendor-profile-save");
      await expect(page.locator("#vendor-profile-msg")).toHaveText("Name is required.");

      await page.reload();
      await expect(page.locator("#vendor-phone-input")).not.toHaveValue("12345");
      await expect(page.locator("#vendor-name-input")).not.toHaveValue("   ");
    });

    test("the greeting is the only profile entry in the vendor nav", async ({ page }) => {
      const profileLinks = page.locator('#main-nav a[href="/vendor/profile"]');

      // Exactly one profile entry: the clickable greeting.
      await expect(profileLinks).toHaveCount(1);
      const displayName = await page.locator("#vendor-profile-name").innerText();
      await expect(profileLinks.first()).toContainText(`Hi, ${displayName}`);
      await expect(page.locator('#main-nav a', { hasText: /^Profile$/ })).toHaveCount(0);

      // Clicking the greeting opens the vendor profile.
      await expect(profileLinks.first()).toHaveCSS("cursor", "pointer");
      await profileLinks.first().click();
      await expect(page).toHaveURL(/\/vendor\/profile$/);
      await expect(page).toHaveTitle("Vendor Profile - Flash Foods");
      await expect(page.locator("#vendor-profile-name")).toBeVisible();

      // The greeting is highlighted while on the profile page.
      await expect(page.locator('#main-nav a[href="/vendor/profile"]')).toHaveClass(
        /is-active/,
      );
    });

    test("existing vendor pages still render", async ({
      page,
    }) => {

      const pages = [
        ["/vendor/orders/pending", "Pending Orders"],
        ["/vendor/verify", "Verify Pickup"],
        ["/vendor/orders/completed", "Completed & Cancelled Orders"],
        ["/vendor/menu", "Vendor Dashboard"],
        ["/vendor/payment/settings", "Payment Settings"],
        ["/vendor/profile", "Vendor Profile"],
      ];

      // Every non-profile vendor nav item is still present.
      const navLinks = page.locator("#main-nav .vendor-nav a");
      await expect(navLinks).toHaveCount(5);

      for (const [path, title] of pages) {
        const response = await page.goto(path);
        expect(response.status(), `${path} should render`).toBe(200);
        await expect(page).toHaveTitle(`${title} - Flash Foods`);
        await expect(page.locator("body")).not.toContainText("Something went wrong");
      }
    });

    test("stays usable on a mobile viewport", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/vendor/profile");

      await expect(page.locator("#vendor-name-input")).toBeVisible();
      await expect(page.locator("#vendor-phone-input")).toBeVisible();
      await expect(page.locator("#vendor-profile-save")).toBeVisible();
      await expect(period(page, "today", "orders")).toBeVisible();
      await expect(page.locator('[data-range="today"]')).toBeVisible();
      await expect(page.locator("#vendor-best-sellers-table")).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
});
