import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import { Shop } from "../../models/Shop.js";
import { User } from "../../models/User.js";
import { Order } from "../../models/Order.js";
import { vendorRouter } from "../../routes/vendor.js";
import { createPickupQr } from "../../utils/qr-pickup.js";
import {
  formatLocalDateTime,
  formatPickupTime,
  getPickupUrgency,
} from "../../utils/time.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "..", "views");
const SECRET = "f07-test-secret";
const FUTURE = Date.now() + 60 * 60 * 1000;

let mongo;
let server;
let baseUrl;
let shopA;
let vendorA;
let student;
let currentUserId = null;
let activeUser = null;

before(async () => {
  process.env.QR_SECRET = SECRET;
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
    req.flash = () => [];
    next();
  });
  app.use((req, res, next) => {
    res.locals.currentPath = req.path;
    res.locals.currentUser = activeUser
      ? { id: activeUser._id, role: activeUser.role, name: activeUser.name, phone: activeUser.phone || "", createdAt: activeUser.createdAt }
      : null;
    res.locals.vendorShop = activeUser?.role === "vendor" ? { name: "nav shop", slug: "nav-shop" } : null;
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
  app.use(vendorRouter);

  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

async function makeOrder(overrides = {}) {
  return Order.create({
    customer: student._id,
    shop: shopA._id,
    items: [
      { name: "Meal", price: 100, quantity: 2 },
      { name: "Juice", price: 50, quantity: 1 },
    ],
    total: 250,
    pickupOtp: "654321",
    status: "ready_for_pickup",
    pickupTime: new Date(FUTURE),
    ...overrides,
  });
}

beforeEach(async () => {
  await Promise.all([Shop.deleteMany({}), User.deleteMany({}), Order.deleteMany({})]);
  currentUserId = null;
  activeUser = null;
  shopA = await Shop.create({ name: "Shop A", slug: "shop-a-f07" });
  vendorA = await User.create({ name: "Vendor A", email: "va.f07@flashfoods.test", passwordHash: "h", role: "vendor", shop: shopA._id });
  student = await User.create({ name: "Student One", email: "s1.f07@flashfoods.test", passwordHash: "h", role: "student", phone: "9876543210" });
});

async function request(pathname, { method = "GET", user = null, body, form, accept } = {}) {
  activeUser = user;
  currentUserId = user ? user._id : null;
  const init = { method, redirect: "manual", headers: { Accept: accept || "application/json" } };
  if (form !== undefined) {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return fetch(`${baseUrl}${pathname}`, init);
}

// P5: handover data + P7: QR method persisted
test("F07: QR success returns handover data and records pickupMethod=qr", async () => {
  const order = await makeOrder();
  const token = createPickupQr(order);
  const res = await request("/vendor/verify-qr", { method: "POST", user: vendorA, body: { qr: token } });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.handover.orderNumber, String(order._id).slice(-6).toUpperCase());
  assert.equal(data.handover.studentName, "Student One");
  assert.equal(data.handover.phone, "9876543210");
  assert.deepEqual(data.handover.items, [{ name: "Meal", quantity: 2 }, { name: "Juice", quantity: 1 }]);
  assert.equal(data.handover.total, 250);
  assert.ok(data.handover.pickupTime);
  assert.equal(data.handover.method, "qr");

  const after = await Order.findById(order._id).lean();
  assert.equal(after.status, "completed");
  assert.equal(after.pickupMethod, "qr");
  assert.ok(after.collectedAt);
});

// P7: OTP method persisted, same terminal semantics
test("F07: OTP success records pickupMethod=otp with identical completed semantics", async () => {
  const order = await makeOrder();
  const res = await request("/vendor/verify", { method: "POST", user: vendorA, body: { otp: "654321" } });
  assert.equal(res.status, 200);
  const after = await Order.findById(order._id).lean();
  assert.equal(after.status, "completed");
  assert.equal(after.pickupMethod, "otp");
  assert.ok(after.collectedAt);
});

// P5: invalid financial states cannot complete pickup; zero mutation
for (const status of ["pending_payment", "cancelled", "paid", "accepted"]) {
  test(`F07: QR for a ${status} order is rejected with zero mutation`, async () => {
    const order = await makeOrder({ status });
    const token = createPickupQr(order);
    const res = await request("/vendor/verify-qr", { method: "POST", user: vendorA, body: { qr: token } });
    assert.equal(res.status, 409);
    const after = await Order.findById(order._id).lean();
    assert.equal(after.status, status);
    assert.equal(after.pickupMethod, null);
    assert.equal(after.collectedAt, null);
  });
}

test("F07: forged QR fails with zero mutation", async () => {
  const order = await makeOrder();
  const res = await request("/vendor/verify-qr", { method: "POST", user: vendorA, body: { qr: "v1.forged.payload.sig" } });
  assert.equal(res.status, 400);
  const after = await Order.findById(order._id).lean();
  assert.equal(after.status, "ready_for_pickup");
  assert.equal(after.pickupMethod, null);
  assert.equal(after.collectedAt, null);
});

test("F07: concurrent duplicate scans single-close", async () => {
  const order = await makeOrder();
  const token = createPickupQr(order);
  const [a, b] = await Promise.all([
    request("/vendor/verify-qr", { method: "POST", user: vendorA, body: { qr: token } }),
    request("/vendor/verify-qr", { method: "POST", user: vendorA, body: { qr: token } }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const after = await Order.findById(order._id).lean();
  assert.equal(after.status, "completed");
  assert.equal(after.pickupMethod, "qr");
});

// P4: HTML form success renders handover with no confirmation button
test("F07: real browser Accept header renders the handover page, not raw JSON", async () => {
  const order = await makeOrder();
  const token = createPickupQr(order);
  const res = await request("/vendor/verify-qr", {
    method: "POST",
    user: vendorA,
    form: { qr: token },
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /html/);
  const html = await res.text();
  assert.ok(html.includes('id="handover-card"'));
  assert.ok(!html.trimStart().startsWith("{"));
});

test("F07: JSON API path still returns JSON", async () => {
  const order = await makeOrder();
  const token = createPickupQr(order);
  const res = await request("/vendor/verify-qr", {
    method: "POST",
    user: vendorA,
    body: { qr: token },
    accept: "application/json",
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /json/);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.handover);
  assert.equal(data.handover.method, "qr");
});

test("F07: HTML QR success renders handover card and no pickup-confirmation button", async () => {
  const order = await makeOrder();
  const token = createPickupQr(order);
  const res = await request("/vendor/verify-qr", {
    method: "POST",
    user: vendorA,
    form: { qr: token },
    accept: "text/html",
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('id="handover-card"'));
  assert.ok(html.includes(`Order #${String(order._id).slice(-6).toUpperCase()}`));
  assert.ok(html.includes("Student One"));
  assert.ok(html.includes("9876543210"));
  assert.ok(!/pickup-confirm|confirm pickup|confirm order/i.test(html));
});

test("F07: pending orders page is the primary pickup surface (QR + OTP UI)", async () => {
  await makeOrder();
  const res = await request("/vendor/orders/pending", { user: vendorA, accept: "text/html" });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('id="global-qr-form"'));
  assert.ok(html.includes('id="global-qr-input"'));
  assert.ok(html.includes('id="global-qr-scan-btn"'));
  assert.ok(html.includes('id="global-handover"'));
  assert.ok(html.includes('id="global-verify-form"'));
  assert.ok(!/pickup-confirm|confirm pickup|confirm order/i.test(html));
});

test("F07: OTP JSON success includes handover with method=otp", async () => {
  await makeOrder();
  const res = await request("/vendor/verify", { method: "POST", user: vendorA, body: { otp: "654321" } });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.handover);
  assert.equal(data.handover.method, "otp");
  assert.equal(data.handover.studentName, "Student One");
  assert.equal(data.handover.phone, "9876543210");
  assert.equal(data.handover.total, 250);
});

test("F07: legacy /vendor/verify page still renders QR + OTP forms", async () => {
  const res = await request("/vendor/verify", { user: vendorA, accept: "text/html" });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('action="/vendor/verify-qr"'));
  assert.ok(html.includes('name="qr"'));
  assert.ok(html.includes('name="otp"'));
});

test("F07: OTP stays valid regardless of elapsed time (no time-based expiry)", async () => {
  const order = await makeOrder({
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  });
  const res = await request("/vendor/verify", { method: "POST", user: vendorA, body: { otp: "654321" } });
  assert.equal(res.status, 200);
  const after = await Order.findById(order._id).lean();
  assert.equal(after.status, "completed");
  assert.equal(after.pickupMethod, "otp");
});

test("F07: same OTP after completion fails (state invalidation, zero mutation)", async () => {
  const order = await makeOrder();
  const first = await request("/vendor/verify", { method: "POST", user: vendorA, body: { otp: "654321" } });
  assert.equal(first.status, 200);
  const replay = await request("/vendor/verify", { method: "POST", user: vendorA, body: { otp: "654321" } });
  assert.equal(replay.status, 404);
  const after = await Order.findById(order._id).lean();
  assert.equal(after.status, "completed");
});

test("F07: concurrent OTP verifications single-close", async () => {
  const order = await makeOrder();
  const [a, b] = await Promise.all([
    request("/vendor/verify", { method: "POST", user: vendorA, body: { otp: "654321" } }),
    request("/vendor/verify", { method: "POST", user: vendorA, body: { otp: "654321" } }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const after = await Order.findById(order._id).lean();
  assert.equal(after.status, "completed");
  assert.equal(after.pickupMethod, "otp");
});

test("F07: verify page has no post-scan pickup-confirmation button", async () => {
  const res = await request("/vendor/verify", { user: vendorA, accept: "text/html" });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(!/pickup-confirm|confirm pickup|confirm order/i.test(html));
});

test("F07: vendor tapping Ready twice dispatches order-ready exactly once", async () => {
  const order = await makeOrder({ status: "accepted" });
  const lines = [];
  const origLog = console.log;
  console.log = (...args) => void lines.push(args.map(String).join(" "));
  try {
    const first = await request(`/vendor/orders/${order._id}/ready`, { method: "POST", user: vendorA });
    assert.equal(first.status, 302);
    const afterFirst = await Order.findById(order._id).lean();
    assert.equal(afterFirst.status, "ready_for_pickup");
    // Fire-and-forget dispatch runs after the transition; allow it to log.
    await new Promise((r) => setTimeout(r, 200));

    const second = await request(`/vendor/orders/${order._id}/ready`, { method: "POST", user: vendorA });
    assert.equal(second.status, 302);
    await new Promise((r) => setTimeout(r, 200));
    const afterSecond = await Order.findById(order._id).lean();
    assert.equal(afterSecond.status, "ready_for_pickup");
    assert.equal(
      String(afterSecond.readyAt),
      String(afterFirst.readyAt),
      "second Ready must not re-transition",
    );
  } finally {
    console.log = origLog;
  }
  const readyLines = lines.filter((l) => l.includes("[FCM] order-ready"));
  assert.equal(readyLines.length, 1, `expected one order-ready dispatch, saw ${readyLines.length}`);
});

test("F07: Ready on an already-collected order dispatches nothing", async () => {
  const order = await makeOrder();
  const done = await request("/vendor/verify", { method: "POST", user: vendorA, body: { otp: "654321" } });
  assert.equal(done.status, 200);
  const lines = [];
  const origLog = console.log;
  console.log = (...args) => void lines.push(args.map(String).join(" "));
  try {
    const res = await request(`/vendor/orders/${order._id}/ready`, { method: "POST", user: vendorA });
    assert.equal(res.status, 302);
    await new Promise((r) => setTimeout(r, 200));
  } finally {
    console.log = origLog;
  }
  assert.equal(
    lines.filter((l) => l.includes("[FCM] order-ready")).length,
    0,
    "completed orders must never dispatch order-ready",
  );
  const after = await Order.findById(order._id).lean();
  assert.equal(after.status, "completed");
});
