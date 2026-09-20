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
import { ordersRouter } from "../../routes/orders.js";
import { vendorRouter } from "../../routes/vendor.js";
import { createPickupQr, verifyPickupQr } from "../../utils/qr-pickup.js";
import {
  formatLocalDateTime,
  formatPickupTime,
  getPickupUrgency,
} from "../../utils/time.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "..", "views");
const SECRET = "qr-test-secret";

const FUTURE = Date.now() + 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Token sign/verify (pure)
// ---------------------------------------------------------------------------

test("a QR round-trips for the right shop", () => {
  const order = { _id: "6a4944f2f889bb405d929b15", shop: "6a4944f2f889bb405d929b16" };
  const token = createPickupQr(order, { secret: SECRET, now: new Date(0), ttlMs: FUTURE });

  const verdict = verifyPickupQr(token, { secret: SECRET, shopId: order.shop, now: new Date(0) });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.orderId, order._id);
  assert.equal(verdict.shop, order.shop);
});

test("a tampered QR is rejected as forged", () => {
  const order = { _id: "6a4944f2f889bb405d929b15", shop: "6a4944f2f889bb405d929b16" };
  const token = createPickupQr(order, { secret: SECRET, now: new Date(0), ttlMs: FUTURE });

  // Swap the order id but keep the original signature.
  const tampered = token.replace(order._id, "6a4944f2f889bb405d929b99");
  assert.equal(verifyPickupQr(tampered, { secret: SECRET, shopId: order.shop, now: new Date(0) }).reason, "forged");

  // A token signed with the wrong secret must not verify.
  const other = createPickupQr(order, { secret: "different", now: new Date(0), ttlMs: FUTURE });
  assert.equal(verifyPickupQr(other, { secret: SECRET, shopId: order.shop, now: new Date(0) }).reason, "forged");
});

test("a QR for another shop is rejected", () => {
  const order = { _id: "6a4944f2f889bb405d929b15", shop: "6a4944f2f889bb405d929b16" };
  const token = createPickupQr(order, { secret: SECRET, now: new Date(0), ttlMs: FUTURE });
  const verdict = verifyPickupQr(token, {
    secret: SECRET,
    shopId: "6a4944f2f889bb405d929b17",
    now: new Date(0),
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "wrong_shop");
});

test("an expired QR is rejected", () => {
  const order = { _id: "6a4944f2f889bb405d929b15", shop: "6a4944f2f889bb405d929b16" };
  const token = createPickupQr(order, { secret: SECRET, now: new Date(0), ttlMs: 1000 });
  const verdict = verifyPickupQr(token, { secret: SECRET, shopId: order.shop, now: new Date(5000) });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "expired");
});

test("malformed tokens are rejected", () => {
  for (const bad of ["", "garbage", "v1.abc.def.ghi.jkl", "v2.6a4944f2f889bb405d929b15.x.1.sig"]) {
    const verdict = verifyPickupQr(bad, { secret: SECRET });
    assert.equal(verdict.ok, false, `expected reject for ${JSON.stringify(bad)}`);
    assert.equal(verdict.reason, "malformed");
  }
  assert.equal(verifyPickupQr(null, { secret: SECRET }).reason, "malformed");
});

test("QR expiry follows the order's pickup-code expiry when present", () => {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const order = {
    _id: "6a4944f2f889bb405d929b15",
    shop: "6a4944f2f889bb405d929b16",
    pickupOtpExpiresAt: expiresAt,
  };
  const token = createPickupQr(order, { secret: SECRET, now: new Date(0) });
  // Immediately valid...
  assert.equal(verifyPickupQr(token, { secret: SECRET, shopId: order.shop, now: new Date(0) }).ok, true);
  // ...but expired after the recorded timestamp.
  assert.equal(
    verifyPickupQr(token, { secret: SECRET, shopId: order.shop, now: new Date(expiresAt.getTime() + 1) }).reason,
    "expired",
  );
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

let mongo;
let server;
let baseUrl;

let shopA;
let shopB;
let vendorA;
let vendorB;
let student;
let orderReadyA;
let orderReadyB;

let currentUserId = null;
let activeUser = null;
let lastFlash = null;

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
    lastFlash = null;
    req.flash = (type, message) => {
      if (message === undefined) return [];
      lastFlash = { type, message };
      return [];
    };
    next();
  });
  app.use((req, res, next) => {
    res.locals.currentPath = req.path;
    res.locals.currentUser = activeUser
      ? { id: activeUser._id, role: activeUser.role, name: activeUser.name, phone: activeUser.phone || "", createdAt: activeUser.createdAt }
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

  app.use(vendorRouter);
  app.use(ordersRouter);

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
  await Promise.all([Shop.deleteMany({}), User.deleteMany({}), Order.deleteMany({})]);
  currentUserId = null;
  activeUser = null;
  lastFlash = null;

  shopA = await Shop.create({ name: "Shop A", slug: "shop-a" });
  shopB = await Shop.create({ name: "Shop B", slug: "shop-b" });
  vendorA = await User.create({
    name: "Vendor A",
    email: "vendor.a@flashfoods.test",
    passwordHash: "hash",
    role: "vendor",
    shop: shopA._id,
  });
  vendorB = await User.create({
    name: "Vendor B",
    email: "vendor.b@flashfoods.test",
    passwordHash: "hash",
    role: "vendor",
    shop: shopB._id,
  });
  student = await User.create({
    name: "Student One",
    email: "student.one@flashfoods.test",
    passwordHash: "hash",
    role: "student",
  });

  const base = {
    customer: student._id,
    items: [{ name: "Meal", price: 100, quantity: 1 }],
    total: 100,
    pickupOtp: "123456",
    status: "ready_for_pickup",
    pickupOtpExpiresAt: new Date(FUTURE),
  };
  orderReadyA = await Order.create({ ...base, shop: shopA._id });
  orderReadyB = await Order.create({ ...base, shop: shopB._id });
});

async function request(pathname, { method = "GET", user = null, body, form, accept } = {}) {
  activeUser = user;
  currentUserId = user ? user._id : null;
  const init = { method, redirect: "manual", headers: { Accept: accept || "text/html,application/json" } };
  if (form !== undefined) {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return fetch(`${baseUrl}${pathname}`, init);
}

test("vendor completes pickup with a valid QR", async () => {
  const token = createPickupQr(orderReadyA);
  const res = await request("/vendor/verify-qr", {
    method: "POST",
    user: vendorA,
    body: { qr: token },
    accept: "application/json",
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);

  const order = await Order.findById(orderReadyA._id).lean();
  assert.equal(order.status, "completed");
  assert.ok(order.collectedAt);
});

test("a replayed QR cannot complete an order twice", async () => {
  const token = createPickupQr(orderReadyA);

  const first = await request("/vendor/verify-qr", { method: "POST", user: vendorA, body: { qr: token }, accept: "application/json" });
  assert.equal(first.status, 200);

  const replay = await request("/vendor/verify-qr", { method: "POST", user: vendorA, body: { qr: token }, accept: "application/json" });
  assert.equal(replay.status, 409);

  const order = await Order.findById(orderReadyA._id).lean();
  assert.equal(order.status, "completed");
});

test("a QR for another shop cannot be used (wrong vendor/shop)", async () => {
  const token = createPickupQr(orderReadyB);
  const res = await request("/vendor/verify-qr", {
    method: "POST",
    user: vendorA, // vendor of shop A
    body: { qr: token },
    accept: "application/json",
  });
  assert.equal(res.status, 404);

  const order = await Order.findById(orderReadyB._id).lean();
  assert.equal(order.status, "ready_for_pickup");
});

test("forged and malformed QR values are rejected", async () => {
  const valid = createPickupQr(orderReadyA);
  const forged = valid.replace(String(orderReadyA._id), "6a4944f2f889bb405d929b99");

  const forgedRes = await request("/vendor/verify-qr", { method: "POST", user: vendorA, body: { qr: forged }, accept: "application/json" });
  assert.equal(forgedRes.status, 400);

  const malformedRes = await request("/vendor/verify-qr", { method: "POST", user: vendorA, body: { qr: "not-a-token" }, accept: "application/json" });
  assert.equal(malformedRes.status, 400);

  const order = await Order.findById(orderReadyA._id).lean();
  assert.equal(order.status, "ready_for_pickup");
});

test("an expired QR is rejected", async () => {
  const past = await Order.create({
    customer: student._id,
    shop: shopA._id,
    items: [{ name: "Meal", price: 100, quantity: 1 }],
    total: 100,
    pickupOtp: "999999",
    status: "ready_for_pickup",
    pickupOtpExpiresAt: new Date(Date.now() - 60 * 1000),
  });
  const token = createPickupQr(past);

  const res = await request("/vendor/verify-qr", { method: "POST", user: vendorA, body: { qr: token }, accept: "application/json" });
  assert.equal(res.status, 410);

  const after = await Order.findById(past._id).lean();
  assert.equal(after.status, "ready_for_pickup");
});

test("students and unauthenticated users cannot use QR verification", async () => {
  const token = createPickupQr(orderReadyA);

  const asStudent = await request("/vendor/verify-qr", { method: "POST", user: student, body: { qr: token }, accept: "application/json" });
  assert.equal(asStudent.status, 302);

  const anon = await request("/vendor/verify-qr", { method: "POST", body: { qr: token }, accept: "application/json" });
  assert.equal(anon.status, 302);

  const order = await Order.findById(orderReadyA._id).lean();
  assert.equal(order.status, "ready_for_pickup");
});

test("OTP pickup still works as a fallback", async () => {
  const res = await request("/vendor/verify", {
    method: "POST",
    user: vendorA,
    body: { otp: "123456" },
    accept: "application/json",
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).success, true);

  const order = await Order.findById(orderReadyA._id).lean();
  assert.equal(order.status, "completed");
});

test("the student order page shows the QR while awaiting pickup", async () => {
  const res = await request(`/orders/${orderReadyA._id}`, { user: student, accept: "text/html" });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("alt=\"Pickup QR code\""));
  assert.ok(html.includes("data:image/png;base64,"));
});

test("the vendor verify page offers the QR form", async () => {
  const res = await request("/vendor/verify", { user: vendorA, accept: "text/html" });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('action="/vendor/verify-qr"'));
  assert.ok(html.includes('name="qr"'));
});
