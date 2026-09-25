import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import { Order } from "../../models/Order.js";
import { Shop } from "../../models/Shop.js";
import { User } from "../../models/User.js";
import { profileRouter } from "../../routes/profile.js";
import { vendorProfileRouter } from "../../routes/vendor-profile.js";
import { getVendorProfileAnalytics } from "../../utils/vendor-analytics.js";
import {
  formatLocalDateTime,
  formatPickupTime,
  getPickupUrgency,
} from "../../utils/time.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "..", "views");

// Fixed instant: 2026-09-20 13:00 IST (Sunday). Today's IST window is
// 2026-09-19T18:30Z..2026-09-20T18:29:59.999Z, the week starts Monday
// 2026-09-14 IST and the month starts 2026-09-01 IST.
const NOW = new Date("2026-09-20T07:30:00.000Z");

let mongo;
let server;
let baseUrl;

let vendorA;
let vendorB;
let vendorC;
let student;
let shopA;
let shopB;
let shopC;

// The test app mirrors the real middleware chain closely enough to exercise the
// real guards: session -> auth/user context -> vendor profile router.
let activeUser = null;
let currentUserId = null;

async function createOrder(doc) {
  // timestamps:false so the fixed createdAt we use for boundary assertions is
  // not overwritten by the timestamp plugin.
  const order = new Order(doc);
  await order.save({ timestamps: false });
  return order;
}

function baseOrder(shop, overrides = {}) {
  return {
    customer: student._id,
    shop: shop._id,
    items: [{ name: "Dosa", price: 60, quantity: 1 }],
    total: 60,
    pickupOtp: "123456",
    status: "completed",
    ...overrides,
  };
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  const app = express();
  app.set("view engine", "ejs");
  app.set("views", VIEWS_DIR);
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(session({ secret: "test-secret", resave: false, saveUninitialized: false }));

  app.use((req, _res, next) => {
    if (currentUserId) req.session.userId = String(currentUserId);
    // connect-flash stand-in used by the guards on rejection paths.
    req.flash = (...args) => (args.length > 1 ? undefined : []);
    next();
  });

  // Minimal res.locals, mirroring server.js, so the real EJS views render.
  app.use((_req, res, next) => {
    res.locals.currentPath = _req.path;
    res.locals.currentUser = activeUser
      ? {
          id: activeUser._id,
          role: activeUser.role,
          name: activeUser.name,
          phone: activeUser.phone || "",
          createdAt: activeUser.createdAt,
        }
      : null;
    res.locals.vendorShop =
      activeUser && activeUser.role === "vendor" && activeUser.shop
        ? { name: "nav shop", slug: "nav-shop" }
        : null;
    res.locals.cartCount = 0;
    res.locals.flash = { success: [], error: [] };
    res.locals.env = { RAZORPAY_KEY_ID: undefined };
    res.locals.firebaseConfig = null;
    res.locals.appVersion = { version: "test", buildId: "test", buildTimestamp: null };
    res.locals.formatPickupTime = formatPickupTime;
    res.locals.formatLocalDateTime = formatLocalDateTime;
    res.locals.getPickupUrgency = getPickupUrgency;
    next();
  });

  app.use(vendorProfileRouter);
  app.use(profileRouter);

  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([Order.deleteMany({}), Shop.deleteMany({}), User.deleteMany({})]);
  activeUser = null;
  currentUserId = null;

  shopA = await Shop.create({ name: "Shop Alpha", slug: "shop-alpha" });
  shopB = await Shop.create({ name: "Shop Bee", slug: "shop-bee" });
  shopC = await Shop.create({ name: "Shop Gamma", slug: "shop-gamma" });

  vendorA = await User.create({
    name: "Ramesh Alpha",
    email: "alpha.vendor@flashfoods.test",
    passwordHash: "hash",
    role: "vendor",
    phone: "9000000001",
    shop: shopA._id,
  });
  vendorB = await User.create({
    name: "Suresh Bee",
    email: "bee.vendor@flashfoods.test",
    passwordHash: "hash",
    role: "vendor",
    phone: "9000000002",
    shop: shopB._id,
  });
  vendorC = await User.create({
    name: "Mahesh Gamma",
    email: "gamma.vendor@flashfoods.test",
    passwordHash: "hash",
    role: "vendor",
    phone: "9000000003",
  }); // deliberately not linked to a shop
  student = await User.create({
    name: "Student One",
    email: "student.one@flashfoods.test",
    passwordHash: "hash",
    role: "student",
    phone: "9000000004",
  });

  await Shop.updateOne({ _id: shopA._id }, { $set: { vendor: vendorA._id } });
  await Shop.updateOne({ _id: shopB._id }, { $set: { vendor: vendorB._id } });
});

// ---------------------------------------------------------------------------
// Deterministic fixtures for the fixed-now analytics tests
// ---------------------------------------------------------------------------

async function seedBoundaryOrders() {
  // Today (2026-09-20 IST)
  await createOrder(
    baseOrder(shopA, {
      createdAt: new Date("2026-09-20T05:00:00.000Z"),
      items: [{ name: "Dosa", price: 60, quantity: 2 }],
      total: 120,
    }),
  );
  await createOrder(
    baseOrder(shopA, {
      createdAt: new Date("2026-09-20T06:00:00.000Z"),
      items: [
        { name: "Dosa", price: 60, quantity: 1 },
        { name: "Idli", price: 30, quantity: 2 },
        { name: "Removed Special", price: 55, quantity: 1, status: "removed" },
      ],
      total: 120,
    }),
  );
  // Earlier this week (Tuesday 2026-09-15 IST)
  await createOrder(
    baseOrder(shopA, {
      createdAt: new Date("2026-09-15T06:00:00.000Z"),
      items: [{ name: "Vada", price: 50, quantity: 2 }],
      total: 100,
    }),
  );
  // Earlier this month
  await createOrder(
    baseOrder(shopA, {
      createdAt: new Date("2026-09-03T06:00:00.000Z"),
      items: [{ name: "Pongal", price: 300, quantity: 1 }],
      total: 300,
    }),
  );
  await createOrder(
    baseOrder(shopA, {
      createdAt: new Date("2026-09-05T06:00:00.000Z"),
      items: [
        { name: "Idli", price: 30, quantity: 1 },
        { name: "Tea", price: 10, quantity: 1 },
        { name: "Samosa", price: 25, quantity: 1 },
      ],
      total: 65,
    }),
  );
  // Previous month
  await createOrder(
    baseOrder(shopA, {
      createdAt: new Date("2026-08-10T06:00:00.000Z"),
      items: [{ name: "Dosa", price: 100, quantity: 3 }],
      total: 500,
    }),
  );
  // Cancelled today: must never be counted or listed.
  await createOrder(
    baseOrder(shopA, {
      createdAt: new Date("2026-09-20T06:30:00.000Z"),
      items: [{ name: "Cancelled Special", price: 999, quantity: 1 }],
      total: 9999,
      status: "cancelled",
    }),
  );
  // Another shop's very distinctive data, used as the IDOR canary.
  await createOrder(
    baseOrder(shopB, {
      createdAt: new Date("2026-09-20T05:30:00.000Z"),
      items: [{ name: "Mega Platter", price: 987654, quantity: 1 }],
      total: 987654,
    }),
  );
}

async function analytics(range, extra = {}) {
  return getVendorProfileAnalytics({
    shopId: shopA._id,
    range,
    now: NOW,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Analytics correctness (fixed now)
// ---------------------------------------------------------------------------

test("today/week/month snapshot counts only completed orders in IST windows", async () => {
  await seedBoundaryOrders();

  const result = await analytics("today");

  assert.equal(result.ok, true);
  assert.deepEqual(result.periods, {
    today: { orders: 2, revenue: 240 },
    week: { orders: 3, revenue: 340 },
    month: { orders: 5, revenue: 705 },
  });
});

test("range summary reports orders, revenue, items sold and average order value", async () => {
  await seedBoundaryOrders();

  const today = await analytics("today");
  assert.deepEqual(today.summary, {
    orders: 2,
    revenue: 240,
    itemsSold: 5, // removed line excluded
    averageOrderValue: 120,
  });

  const week = await analytics("week");
  assert.deepEqual(week.summary, {
    orders: 3,
    revenue: 340,
    itemsSold: 7,
    averageOrderValue: 113,
  });

  const month = await analytics("month");
  assert.deepEqual(month.summary, {
    orders: 5,
    revenue: 705,
    itemsSold: 11,
    averageOrderValue: 141,
  });
});

test("custom same-day range is inclusive and IST exact", async () => {
  await seedBoundaryOrders();

  const result = await analytics("custom", {
    startDate: "2026-09-20",
    endDate: "2026-09-20",
  });

  assert.equal(result.ok, true);
  assert.equal(result.startDate, "2026-09-20");
  assert.equal(result.endDate, "2026-09-20");
  assert.deepEqual(result.summary, {
    orders: 2,
    revenue: 240,
    itemsSold: 5,
    averageOrderValue: 120,
  });
  assert.deepEqual(result.bestSellers, [
    { name: "Dosa", quantity: 3, revenue: 180 },
    { name: "Idli", quantity: 2, revenue: 60 },
  ]);
});

test("custom multi-day range spans months and caps best sellers at 5", async () => {
  await seedBoundaryOrders();

  const result = await analytics("custom", {
    startDate: "2026-08-01",
    endDate: "2026-09-20",
  });

  assert.deepEqual(result.summary, {
    orders: 6,
    revenue: 1205,
    itemsSold: 14,
    averageOrderValue: 201,
  });

  assert.equal(result.bestSellers.length, 5);
  assert.deepEqual(result.bestSellers, [
    { name: "Dosa", quantity: 6, revenue: 480 },
    { name: "Idli", quantity: 3, revenue: 90 },
    { name: "Vada", quantity: 2, revenue: 100 },
    { name: "Pongal", quantity: 1, revenue: 300 },
    { name: "Samosa", quantity: 1, revenue: 25 },
  ]);

  // Removed lines never surface as a best seller.
  const names = result.bestSellers.map((item) => item.name);
  assert.ok(!names.includes("Removed Special"));
});

test("future ranges return a valid empty result", async () => {
  await seedBoundaryOrders();

  const result = await analytics("custom", {
    startDate: "2027-01-01",
    endDate: "2027-01-31",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, {
    orders: 0,
    revenue: 0,
    itemsSold: 0,
    averageOrderValue: 0,
  });
  assert.deepEqual(result.bestSellers, []);
  // The today/week/month snapshot always reflects the current IST clock, not
  // the requested (future) range.
  assert.deepEqual(result.periods, {
    today: { orders: 2, revenue: 240 },
    week: { orders: 3, revenue: 340 },
    month: { orders: 5, revenue: 705 },
  });
});

test("a shop with no completed orders reports zeros, not errors", async () => {
  await seedBoundaryOrders();

  const result = await getVendorProfileAnalytics({
    shopId: shopC._id,
    range: "month",
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, {
    orders: 0,
    revenue: 0,
    itemsSold: 0,
    averageOrderValue: 0,
  });
  assert.deepEqual(result.bestSellers, []);
});

test("shop isolation: analytics never include another shop's orders", async () => {
  await seedBoundaryOrders();

  const a = await analytics("today");
  const b = await getVendorProfileAnalytics({
    shopId: shopB._id,
    range: "today",
    now: NOW,
  });

  assert.deepEqual(a.summary, {
    orders: 2,
    revenue: 240,
    itemsSold: 5,
    averageOrderValue: 120,
  });
  assert.deepEqual(b.summary, {
    orders: 1,
    revenue: 987654,
    itemsSold: 1,
    averageOrderValue: 987654,
  });
  assert.deepEqual(a.bestSellers.map((item) => item.name), ["Dosa", "Idli"]);
  assert.deepEqual(b.bestSellers.map((item) => item.name), ["Mega Platter"]);
});

test("invalid ranges are reported, not thrown", async () => {
  await seedBoundaryOrders();

  const reversed = await analytics("custom", {
    startDate: "2026-09-20",
    endDate: "2026-09-01",
  });
  assert.equal(reversed.ok, false);
  assert.match(reversed.error, /start date cannot be after/i);

  const malformed = await analytics("custom", {
    startDate: "2026-02-30",
    endDate: "2026-03-01",
  });
  assert.equal(malformed.ok, false);

  const unknownRange = await analytics("yesterday");
  assert.equal(unknownRange.ok, false);
});

// ---------------------------------------------------------------------------
// Route + authorization tests
// ---------------------------------------------------------------------------

async function request(pathname, { method = "GET", user = null, body, form } = {}) {
  activeUser = user;
  currentUserId = user ? user._id : null;

  const init = {
    method,
    redirect: "manual",
    headers: { Accept: "application/json" },
  };
  if (form !== undefined) {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  return fetch(`${baseUrl}${pathname}`, init);
}

async function seedLiveOrders() {
  // "Today" relative to the real clock: one order per shop, with distinctive
  // totals so cross-shop leakage is detectable.
  await createOrder(
    baseOrder(shopA, {
      createdAt: new Date(),
      items: [
        { name: "Alpha Thali", price: 617, quantity: 2 },
        { name: "Alpha Removed", price: 999, quantity: 1, status: "removed" },
      ],
      total: 1234,
    }),
  );
  await createOrder(
    baseOrder(shopB, {
      createdAt: new Date(),
      items: [{ name: "Beta Secret", price: 987654, quantity: 1 }],
      total: 987654,
    }),
  );
}

test("unauthenticated visitors are redirected to login", async () => {
  const res = await request("/vendor/profile");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/login");

  const api = await request("/vendor/profile/analytics?range=today");
  assert.equal(api.status, 302);
  assert.equal(api.headers.get("location"), "/login");
});

test("students cannot reach the vendor profile (page, api or update)", async () => {
  await seedLiveOrders();
  const before = await User.findById(vendorA._id).lean();

  const page = await request("/vendor/profile", { user: student });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get("location"), "/");

  const api = await request("/vendor/profile/analytics?range=today", { user: student });
  assert.equal(api.status, 302);

  const update = await request("/vendor/profile", {
    method: "POST",
    user: student,
    body: { name: "Student Override", phone: "9000000009" },
  });
  assert.equal(update.status, 302);

  const after = await User.findById(vendorA._id).lean();
  assert.equal(after.name, before.name);
  assert.equal(after.phone, before.phone);
});

test("a vendor without a shop assignment is redirected safely", async () => {
  const res = await request("/vendor/profile", { user: vendorC });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");
});

test("vendor profile page renders account, shop and month analytics", async () => {
  await seedLiveOrders();

  const res = await request("/vendor/profile?shopId=" + shopB._id, { user: vendorA });
  assert.equal(res.status, 200);

  const html = await res.text();
  const memberSince = new Date(vendorA.createdAt).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // Account + shop details
  assert.ok(html.includes("Ramesh Alpha"));
  assert.ok(html.includes("Shop Alpha"));
  assert.ok(html.includes("alpha.vendor@flashfoods.test"));
  assert.ok(html.includes("9000000001"));
  assert.ok(html.includes(memberSince));

  // Editable fields present, email/phone are not writable inputs the vendor
  // could use to change restricted data.
  assert.ok(html.includes('id="vendor-name-input"'));
  assert.ok(html.includes('id="vendor-phone-input"'));
  assert.ok(!html.includes('id="vendor-email-input"'));
  assert.ok(!html.includes('name="email"'));
  assert.ok(!html.includes('name="role"'));
  assert.ok(!html.includes('name="shop"'));
  assert.ok(!html.includes('name="isActive"'));
  // No account internals or payment/security material reaches the page.
  assert.ok(!html.includes("passwordHash"));
  assert.ok(!html.includes("paymentSettings"));
  assert.ok(!html.includes("keySecret"));
  assert.ok(!html.includes("resetPasswordToken"));

  // Analytics range filter + best sellers sections
  assert.ok(html.includes('data-range="today"'));
  assert.ok(html.includes('data-range="week"'));
  assert.ok(html.includes('data-range="month"'));
  assert.ok(html.includes('data-range="custom"'));
  assert.ok(html.includes("Best Sellers"));
  assert.ok(html.includes("Alpha Thali"));

  // IST month totals for this shop only (₹1,234 = one completed order).
  assert.ok(html.includes("1,234"), "expected this month's revenue in the page");
  assert.ok(html.includes("Alpha Thali"));
});

test("vendor profile page never leaks another shop's data (IDOR by query)", async () => {
  await seedLiveOrders();

  // Even when the browser asks for shop B explicitly, ownership is derived
  // server-side and only shop A data is returned.
  const page = await request(
    `/vendor/profile?shop=${shopB._id}&shopId=${shopB._id}&vendorId=${vendorB._id}`,
    { user: vendorA },
  );
  assert.equal(page.status, 200);
  const html = await page.text();

  assert.ok(!html.includes("Shop Bee"));
  assert.ok(!html.includes("Beta Secret"));
  assert.ok(!html.includes("9,87,654"));
  assert.ok(html.includes("Alpha Thali"));

  const api = await request(
    `/vendor/profile/analytics?range=today&shop=${shopB._id}&shopId=${shopB._id}&vendorId=${vendorB._id}`,
    { user: vendorA },
  );
  assert.equal(api.status, 200);
  const data = await api.json();

  assert.deepEqual(data.summary, {
    orders: 1,
    revenue: 1234,
    itemsSold: 2,
    averageOrderValue: 1234,
  });
  assert.deepEqual(data.bestSellers.map((item) => item.name), ["Alpha Thali"]);
  assert.ok(!JSON.stringify(data).includes("Beta Secret"));
  assert.ok(!JSON.stringify(data).includes("987654"));
});

test("each vendor sees their own shop totals", async () => {
  await seedLiveOrders();

  const res = await request("/vendor/profile/analytics?range=today", { user: vendorB });
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.deepEqual(data.summary, {
    orders: 1,
    revenue: 987654,
    itemsSold: 1,
    averageOrderValue: 987654,
  });
  assert.deepEqual(data.bestSellers.map((item) => item.name), ["Beta Secret"]);
});

test("analytics endpoint validates range parameters with 400s", async () => {
  await seedLiveOrders();

  const cases = [
    "/vendor/profile/analytics?range=yesterday",
    "/vendor/profile/analytics?range=custom",
    "/vendor/profile/analytics?range=custom&startDate=2026-09-20",
    "/vendor/profile/analytics?range=custom&startDate=abc&endDate=2026-09-20",
    "/vendor/profile/analytics?range=custom&startDate=2026-09-20&endDate=2026-09-01",
    "/vendor/profile/analytics?range=custom&startDate=2026-02-30&endDate=2026-03-01",
  ];

  for (const url of cases) {
    const res = await request(url, { user: vendorA });
    assert.equal(res.status, 400, `expected 400 for ${url}`);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.equal(typeof data.error, "string");
  }
});

test("a valid custom range is served over the API", async () => {
  await seedLiveOrders();

  const today = new Date();
  const ist = new Date(today.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);

  const res = await request(
    `/vendor/profile/analytics?range=custom&startDate=${ist}&endDate=${ist}`,
    { user: vendorA },
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.range, "custom");
  assert.equal(data.startDate, ist);
  assert.equal(data.endDate, ist);
  assert.equal(data.summary.orders, 1);
  assert.equal(data.summary.revenue, 1234);
});

test("name and phone edits persist through the profile endpoint", async () => {
  const res = await request("/vendor/profile", {
    method: "POST",
    user: vendorA,
    body: { name: "  Ramesh   Kumar ", phone: "+91 90012 34567" },
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.name, "Ramesh Kumar");
  assert.equal(data.phone, "9001234567");

  const stored = await User.findById(vendorA._id).lean();
  assert.equal(stored.name, "Ramesh Kumar");
  assert.equal(stored.phone, "9001234567");
  // Everything the vendor must not change stays intact.
  assert.equal(stored.email, "alpha.vendor@flashfoods.test");
  assert.equal(stored.role, "vendor");
  assert.equal(String(stored.shop), String(shopA._id));
  assert.equal(stored.isActive, true);
});

test("restricted fields are ignored even when posted in the body", async () => {
  await seedLiveOrders();
  const before = await User.findById(vendorA._id).lean();

  const res = await request("/vendor/profile", {
    method: "POST",
    user: vendorA,
    body: {
      name: "Ramesh Alpha",
      role: "admin",
      shop: String(shopB._id),
      isActive: false,
      disabledAt: "2020-01-01T00:00:00.000Z",
      email: "attacker@example.com",
      passwordHash: "plaintext",
      resetPasswordToken: "abc",
      paymentGateway: "phonepe",
      paymentSettings: { razorpay: { keySecret: "leaked" } },
      isOpen: false,
    },
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);

  const after = await User.findById(vendorA._id).lean();
  assert.equal(after.role, "vendor");
  assert.equal(String(after.shop), String(shopA._id));
  assert.equal(after.isActive, true);
  assert.equal(after.disabledAt, before.disabledAt);
  assert.equal(after.email, "alpha.vendor@flashfoods.test");
  assert.equal(after.passwordHash, "hash");
  assert.equal(after.resetPasswordToken, before.resetPasswordToken);

  const shopAfter = await Shop.findById(shopA._id).lean();
  assert.equal(shopAfter.isOpen, true);
  assert.equal(shopAfter.paymentGateway, "razorpay");
  assert.equal(shopAfter.paymentSettings.razorpay.keySecret, "");
});

test("a request carrying only restricted fields changes nothing", async () => {
  const before = await User.findById(vendorA._id).lean();

  const res = await request("/vendor/profile", {
    method: "POST",
    user: vendorA,
    body: { role: "admin", shop: String(shopB._id), isActive: false },
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.success, false);

  const after = await User.findById(vendorA._id).lean();
  assert.equal(after.role, before.role);
  assert.equal(String(after.shop), String(before.shop));
  assert.equal(after.isActive, before.isActive);
});

test("invalid profile edits are rejected without writing", async () => {
  const before = await User.findById(vendorA._id).lean();

  const badPhone = await request("/vendor/profile", {
    method: "POST",
    user: vendorA,
    body: { phone: "12345" },
  });
  assert.equal(badPhone.status, 400);
  assert.equal((await badPhone.json()).field, "phone");

  const blankName = await request("/vendor/profile", {
    method: "POST",
    user: vendorA,
    body: { name: "   " },
  });
  assert.equal(blankName.status, 400);
  assert.equal((await blankName.json()).field, "name");

  const emptyBody = await request("/vendor/profile", {
    method: "POST",
    user: vendorA,
    body: {},
  });
  assert.equal(emptyBody.status, 400);

  const after = await User.findById(vendorA._id).lean();
  assert.equal(after.name, before.name);
  assert.equal(after.phone, before.phone);
});

test("nested form fields cannot smuggle objects into the profile", async () => {
  const res = await request("/vendor/profile", {
    method: "POST",
    user: vendorA,
    form: { "name[x]": "Evil", phone: "9000000001" },
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.field, "name");

  const after = await User.findById(vendorA._id).lean();
  assert.equal(after.name, "Ramesh Alpha");
  assert.equal(after.email, "alpha.vendor@flashfoods.test");
});

test("preset ranges are served over the API with their own labels", async () => {
  await seedLiveOrders();

  for (const [range, label] of [
    ["today", "Today"],
    ["week", "This week"],
    ["month", "This month"],
  ]) {
    const res = await request(`/vendor/profile/analytics?range=${range}`, { user: vendorA });
    assert.equal(res.status, 200, `${range} should be served`);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.range, range);
    assert.equal(data.label, label);
    // The offline order is old enough to be outside today/week/month windows.
    assert.ok(!JSON.stringify(data.bestSellers).includes("Beta Secret"));
  }
});

test("the vendor nav has a single profile entry: the clickable greeting", async () => {
  const res = await request("/vendor/profile", { user: vendorA });
  assert.equal(res.status, 200);
  const html = await res.text();

  // Exactly one link to the profile: the "Hi, <name>" greeting.
  const links = [...html.matchAll(/<a\b[^>]*href="\/vendor\/profile"[^>]*>[\s\S]*?<\/a>/g)].map(
    (match) => match[0],
  );
  assert.equal(links.length, 1, "only the greeting may link to /vendor/profile");
  assert.match(links[0], /nav__link/);
  assert.match(links[0], /nav-main__greet/);
  assert.match(links[0], /is-active/);
  assert.ok(links[0].includes(`Hi, ${vendorA.name}`), links[0]);

  // The separate "Profile" nav item is gone from the vendor nav.
  assert.ok(!/>\s*Profile\s*</.test(html));
});

test("menu item names are HTML-escaped on the page", async () => {
  const payload = '<img src=x onerror=alert(1)>';
  await createOrder(
    baseOrder(shopA, {
      createdAt: new Date(),
      items: [{ name: payload, price: 10, quantity: 1 }],
      total: 10,
    }),
  );

  const res = await request("/vendor/profile", { user: vendorA });
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.ok(!html.includes(payload), "raw script/HTML from an item name must not render");
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
});

test("student profile keeps working alongside the vendor profile (regression)", async () => {
  await createOrder(baseOrder(shopA, { total: 200, items: [{ name: "Dosa", price: 100, quantity: 2 }] }));

  const page = await request("/profile", { user: student });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes("Your Profile"));
  assert.ok(html.includes("Student One"));
  assert.ok(html.includes("Completed Orders"));

  // The student greeting is still their profile entry, untouched.
  assert.match(html, /<a class="nav__link nav-main__greet[^"]*" href="\/profile">/);
  assert.ok(!html.includes('href="/vendor/profile"'));

  const update = await request("/profile/phone", {
    method: "POST",
    user: student,
    body: { phone: "9000000042" },
  });
  assert.equal(update.status, 200);
  assert.equal((await update.json()).success, true);
  assert.equal((await User.findById(student._id).lean()).phone, "9000000042");

  // Vendors are still bounced away from the student-only profile route.
  const vendorOnStudentProfile = await request("/profile", { user: vendorA });
  assert.equal(vendorOnStudentProfile.status, 302);
  assert.equal(vendorOnStudentProfile.headers.get("location"), "/");
});
