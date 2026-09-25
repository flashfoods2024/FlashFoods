import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import mongoose from "mongoose";
import {
  BEST_SELLER_LIMIT,
  buildBestSellersPipeline,
  buildPeriodsPipeline,
  buildSummaryPipeline,
  endOfIstDay,
  formatIstDate,
  normalizeBestSellers,
  parseIstDate,
  resolveDateRange,
  roundMoney,
  summarizeAnalytics,
  summarizePeriods,
  validateVendorProfileUpdate,
} from "../../utils/vendor-analytics.js";

// Fixed instant: 2026-09-20 13:00 IST (Sunday).
const NOW = new Date("2026-09-20T07:30:00.000Z");
const shopId = new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Asia/Kolkata date boundaries
// ---------------------------------------------------------------------------

test("today resolves to the current IST day, ending at the IST day boundary", () => {
  const range = resolveDateRange({ range: "today", now: NOW });
  assert.equal(range.ok, true);
  assert.equal(range.range, "today");
  assert.equal(range.start.toISOString(), "2026-09-19T18:30:00.000Z");
  assert.equal(range.end.getTime(), range.start.getTime() + 24 * 60 * 60 * 1000 - 1);
  assert.equal(range.label, "Today");
});

test("week resolves to the IST Monday..today window", () => {
  const range = resolveDateRange({ range: "week", now: NOW });
  assert.equal(range.ok, true);
  // 2026-09-20 is a Sunday, so the week started Monday 2026-09-14 IST.
  assert.equal(range.start.toISOString(), "2026-09-13T18:30:00.000Z");
  assert.equal(formatIstDate(range.start), "2026-09-14");
  assert.equal(formatIstDate(range.end), "2026-09-20");
});

test("month resolves to the 1st of the IST month", () => {
  const range = resolveDateRange({ range: "month", now: NOW });
  assert.equal(range.ok, true);
  assert.equal(range.start.toISOString(), "2026-08-31T18:30:00.000Z");
  assert.equal(formatIstDate(range.start), "2026-09-01");
});

test("an unknown range is rejected instead of silently defaulting", () => {
  const range = resolveDateRange({ range: "yesterday", now: NOW });
  assert.equal(range.ok, false);
  assert.match(range.error, /invalid date range/i);
});

test("a missing range defaults to this month", () => {
  const range = resolveDateRange({ now: NOW });
  assert.equal(range.ok, true);
  assert.equal(range.range, "month");
});

test("custom range covers whole IST days, same-day ranges included", () => {
  const sameDay = resolveDateRange({
    range: "custom",
    startDate: "2026-09-20",
    endDate: "2026-09-20",
    now: NOW,
  });
  assert.equal(sameDay.ok, true);
  assert.equal(sameDay.start.toISOString(), "2026-09-19T18:30:00.000Z");
  assert.equal(sameDay.end.toISOString(), "2026-09-20T18:29:59.999Z");
  assert.equal(sameDay.label, "20 Sept 2026");

  const multiDay = resolveDateRange({
    range: "custom",
    startDate: "2026-08-01",
    endDate: "2026-09-20",
    now: NOW,
  });
  assert.equal(multiDay.ok, true);
  assert.equal(multiDay.start.toISOString(), "2026-07-31T18:30:00.000Z");
  assert.equal(multiDay.label, "1 Aug 2026 – 20 Sept 2026");
});

test("invalid, malformed and overflow custom dates are rejected", () => {
  const cases = [
    { startDate: "abc", endDate: "2026-09-20" },
    { startDate: "2026-09-20", endDate: "" },
    { startDate: "20-09-2026", endDate: "2026-09-20" },
    { startDate: "2026-13-01", endDate: "2026-09-20" },
    // Feb 30 does not exist; JavaScript would silently normalise it to Mar 2.
    { startDate: "2026-02-30", endDate: "2026-03-05" },
    { startDate: "2026-09-20T00:00", endDate: "2026-09-21" },
  ];

  for (const { startDate, endDate } of cases) {
    const range = resolveDateRange({
      range: "custom",
      startDate,
      endDate,
      now: NOW,
    });
    assert.equal(range.ok, false, `expected reject for ${startDate} -> ${endDate}`);
  }
});

test("custom range without both dates is rejected", () => {
  const missingEnd = resolveDateRange({
    range: "custom",
    startDate: "2026-09-01",
    now: NOW,
  });
  assert.equal(missingEnd.ok, false);
  assert.match(missingEnd.error, /start and an end date/i);

  const missingBoth = resolveDateRange({ range: "custom", now: NOW });
  assert.equal(missingBoth.ok, false);
});

test("reversed custom range is rejected", () => {
  const range = resolveDateRange({
    range: "custom",
    startDate: "2026-09-20",
    endDate: "2026-09-01",
    now: NOW,
  });
  assert.equal(range.ok, false);
  assert.match(range.error, /start date cannot be after/i);
});

test("an oversized custom range is rejected", () => {
  const range = resolveDateRange({
    range: "custom",
    startDate: "2024-01-01",
    endDate: "2026-09-20",
    now: NOW,
  });
  assert.equal(range.ok, false);
  assert.match(range.error, /cannot exceed/i);
});

test("future custom ranges are valid and simply resolve future bounds", () => {
  const range = resolveDateRange({
    range: "custom",
    startDate: "2027-01-01",
    endDate: "2027-01-31",
    now: NOW,
  });
  assert.equal(range.ok, true);
  assert.ok(range.start.getTime() > NOW.getTime());
  assert.ok(range.end.getTime() > NOW.getTime());
});

test("parseIstDate / formatIstDate round-trip and reject non-calendar dates", () => {
  assert.equal(formatIstDate(parseIstDate("2026-09-20")), "2026-09-20");
  assert.equal(parseIstDate("2026-02-30"), null);
  assert.equal(parseIstDate(""), null);
  assert.equal(parseIstDate(null), null);
  assert.equal(parseIstDate("2026-9-2"), null);
  assert.equal(
    parseIstDate("2026-09-20", { endOfDay: true }).getTime(),
    endOfIstDay(parseIstDate("2026-09-20")).getTime(),
  );
});

// ---------------------------------------------------------------------------
// Pipelines: shop scoping, completed-only, removed-item exclusion
// ---------------------------------------------------------------------------

test("summary pipeline is scoped to one shop and completed orders only", () => {
  const start = NOW;
  const end = new Date(NOW.getTime() + 1000);
  const pipeline = buildSummaryPipeline(shopId, start, end);

  assert.deepEqual(pipeline[0].$match.shop, shopId);
  assert.equal(pipeline[0].$match.status, "completed");
  assert.equal(pipeline[0].$match.createdAt.$gte.getTime(), start.getTime());
  assert.equal(pipeline[0].$match.createdAt.$lte.getTime(), end.getTime());
  assert.ok(Array.isArray(pipeline[1].$facet.summary));
  assert.ok(Array.isArray(pipeline[1].$facet.items));

  // Items facet must drop removed lines.
  assert.deepEqual(pipeline[1].$facet.items[1], {
    $match: { "items.status": { $ne: "removed" } },
  });
});

test("an invalid shop id is rejected before any query runs", () => {
  assert.throws(() => buildSummaryPipeline("not-an-object-id", NOW, NOW));
  assert.throws(() => buildBestSellersPipeline({}, NOW, NOW));
  assert.throws(() => buildPeriodsPipeline(null, NOW));
});

test("best sellers pipeline excludes removed items, sorts and caps at 5", () => {
  const pipeline = buildBestSellersPipeline(shopId, NOW, NOW);
  const match = pipeline[1];
  assert.deepEqual(match, { $unwind: "$items" });
  assert.deepEqual(pipeline[2], { $match: { "items.status": { $ne: "removed" } } });
  assert.deepEqual(pipeline[4].$sort, { quantity: -1, revenue: -1, _id: 1 });
  assert.deepEqual(pipeline[5], { $limit: BEST_SELLER_LIMIT });
  assert.equal(BEST_SELLER_LIMIT, 5);

  // A caller cannot widen the limit past the sane ceiling.
  assert.deepEqual(buildBestSellersPipeline(shopId, NOW, NOW, 500)[5], { $limit: 50 });
  assert.deepEqual(buildBestSellersPipeline(shopId, NOW, NOW, -3)[5], { $limit: 1 });
});

test("periods pipeline buckets today/week/month from the earliest boundary", () => {
  const pipeline = buildPeriodsPipeline(shopId, NOW);
  assert.deepEqual(pipeline[0].$match.shop, shopId);
  assert.equal(pipeline[0].$match.status, "completed");
  // Earliest boundary is the IST month start (2026-08-31T18:30Z), so a week
  // that began in the previous month can never be truncated.
  assert.equal(pipeline[0].$match.createdAt.$gte.toISOString(), "2026-08-31T18:30:00.000Z");
  assert.ok(pipeline[1].$facet.today);
  assert.ok(pipeline[1].$facet.week);
  assert.ok(pipeline[1].$facet.month);
});

// ---------------------------------------------------------------------------
// Result shaping
// ---------------------------------------------------------------------------

test("summarizeAnalytics returns zeros for empty results", () => {
  assert.deepEqual(summarizeAnalytics(undefined), {
    orders: 0,
    revenue: 0,
    itemsSold: 0,
    averageOrderValue: 0,
  });
  assert.deepEqual(summarizeAnalytics({ summary: [], items: [] }), {
    orders: 0,
    revenue: 0,
    itemsSold: 0,
    averageOrderValue: 0,
  });
});

test("summarizeAnalytics rounds revenue to paise and averages per order", () => {
  const summary = summarizeAnalytics({
    summary: [{ orders: 3, revenue: 340.005 }],
    items: [{ itemsSold: 7 }],
  });
  assert.equal(summary.orders, 3);
  assert.equal(summary.revenue, 340.01);
  assert.equal(summary.itemsSold, 7);
  assert.equal(summary.averageOrderValue, 113);
});

test("summarizePeriods tolerates missing buckets", () => {
  assert.deepEqual(summarizePeriods(undefined), {
    today: { orders: 0, revenue: 0 },
    week: { orders: 0, revenue: 0 },
    month: { orders: 0, revenue: 0 },
  });
  assert.deepEqual(
    summarizePeriods({
      today: [{ orders: 2, revenue: 240 }],
      week: [{ orders: 3, revenue: 340 }],
      month: [],
    }),
    {
      today: { orders: 2, revenue: 240 },
      week: { orders: 3, revenue: 340 },
      month: { orders: 0, revenue: 0 },
    },
  );
});

test("normalizeBestSellers coerces bad rows safely", () => {
  assert.deepEqual(normalizeBestSellers(null), []);
  assert.deepEqual(normalizeBestSellers([{ name: "Dosa", quantity: "3", revenue: "180" }]), [
    { name: "Dosa", quantity: 3, revenue: 180 },
  ]);
  assert.deepEqual(normalizeBestSellers([{ quantity: null, revenue: null }]), [
    { name: "Unknown item", quantity: 0, revenue: 0 },
  ]);
});

test("roundMoney keeps two-decimal precision", () => {
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
  assert.equal(roundMoney("12.345"), 12.35);
  assert.equal(roundMoney(undefined), 0);
});

// ---------------------------------------------------------------------------
// Profile edit validation + mass-assignment defence
// ---------------------------------------------------------------------------

test("allowed edits: name and phone only, normalised", () => {
  const name = validateVendorProfileUpdate({ name: "  Ramesh   Kumar " });
  assert.deepEqual(name, { ok: true, updates: { name: "Ramesh Kumar" } });

  const phone = validateVendorProfileUpdate({ phone: "+91 90012 34567" });
  assert.deepEqual(phone, { ok: true, updates: { phone: "9001234567" } });

  const both = validateVendorProfileUpdate({ name: "Ramesh", phone: "9001234567" });
  assert.deepEqual(both.updates, { name: "Ramesh", phone: "9001234567" });
});

test("restricted fields are dropped, never applied", () => {
  const result = validateVendorProfileUpdate({
    name: "Ramesh",
    role: "admin",
    shop: "65f0000000000000000000ff",
    isActive: false,
    email: "attacker@example.com",
    passwordHash: "x",
    paymentGateway: "razorpay",
    refundStatus: "completed",
    isOpen: true,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.updates).sort(), ["name"]);
});

test("a body containing only restricted fields changes nothing", () => {
  const result = validateVendorProfileUpdate({
    role: "admin",
    shop: "65f0000000000000000000ff",
    isActive: false,
    email: "attacker@example.com",
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /nothing to update/i);
});

test("empty name is rejected, a cleared phone is allowed", () => {
  const blank = validateVendorProfileUpdate({ name: "   " });
  assert.equal(blank.ok, false);
  assert.equal(blank.field, "name");

  const tiny = validateVendorProfileUpdate({ name: "A" });
  assert.equal(tiny.ok, false);

  const long = validateVendorProfileUpdate({ name: "x".repeat(81) });
  assert.equal(long.ok, false);

  assert.deepEqual(validateVendorProfileUpdate({ phone: "" }), {
    ok: true,
    updates: { phone: "" },
  });
});

test("non-string values are rejected (nested form encoding / crafted JSON)", () => {
  for (const bad of [{ x: 1 }, ["a"], ["name"], 42, true]) {
    const result = validateVendorProfileUpdate({ name: bad });
    assert.equal(result.ok, false, `expected reject for name=${JSON.stringify(bad)}`);
    assert.equal(result.field, "name");
  }

  const badPhone = validateVendorProfileUpdate({ phone: { x: 1 } });
  assert.equal(badPhone.ok, false);
  assert.equal(badPhone.field, "phone");

  const proto = validateVendorProfileUpdate(
    JSON.parse('{"name":"Ramesh","__proto__":{"role":"admin"}}'),
  );
  assert.deepEqual(proto, { ok: true, updates: { name: "Ramesh" } });
});

test("invalid phone numbers are rejected", () => {
  for (const phone of ["12345", "12345678901", "abcdefghij", "5001234567"]) {
    const result = validateVendorProfileUpdate({ phone });
    assert.equal(result.ok, false, `expected reject for ${phone}`);
    assert.equal(result.field, "phone");
  }
});

// ---------------------------------------------------------------------------
// The shared IST helpers must not depend on the host timezone
// ---------------------------------------------------------------------------

test("IST day/week/month boundaries are identical in every host timezone", () => {
  const adminUtilsUrl = new URL("../../utils/admin.js", import.meta.url).href;
  const script = `
    import { startOfIstDay, startOfIstWeek, startOfIstMonth } from ${JSON.stringify(adminUtilsUrl)};
    const instants = [
      "2026-09-20T07:30:00.000Z",
      "2026-09-19T21:18:00.000Z",
      "2026-09-13T18:29:59.000Z",
    ];
    console.log(JSON.stringify(instants.map((iso) => {
      const now = new Date(iso);
      return [
        startOfIstDay(now).toISOString(),
        startOfIstWeek(now).toISOString(),
        startOfIstMonth(now).toISOString(),
      ];
    })));
  `;

  const runIn = (tz) => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, TZ: tz },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${tz} failed: ${result.stderr}`);
    return JSON.parse(result.stdout);
  };

  const istHost = runIn("Asia/Calcutta");
  const utcHost = runIn("UTC");
  const usHost = runIn("America/New_York");

  assert.deepEqual(istHost, utcHost);
  assert.deepEqual(istHost, usHost);

  // Reference values, all in IST (UTC+05:30):
  //  - 2026-09-20 13:00 IST (Sun) -> day 20 Sep, week Mon 14 Sep, month 1 Sep
  //  - 2026-09-20 02:48 IST (Sun, just after IST midnight) -> same boundaries.
  //    Its UTC date is still the 19th, so a host-offset-dependent helper
  //    returns the 19th here instead of the 20th.
  //  - 2026-09-13 23:59:59 IST (Sun) -> day 13 Sep, week Mon 7 Sep, month 1 Sep
  assert.deepEqual(istHost, [
    ["2026-09-19T18:30:00.000Z", "2026-09-13T18:30:00.000Z", "2026-08-31T18:30:00.000Z"],
    ["2026-09-19T18:30:00.000Z", "2026-09-13T18:30:00.000Z", "2026-08-31T18:30:00.000Z"],
    ["2026-09-12T18:30:00.000Z", "2026-09-06T18:30:00.000Z", "2026-08-31T18:30:00.000Z"],
  ]);
});
