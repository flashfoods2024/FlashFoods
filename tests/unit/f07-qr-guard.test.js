import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import path from "node:path";
import fs from "node:fs";
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

// UX guard only: the client checks token SHAPE before POSTing to
// /vendor/verify-qr. Signature/shop decisions stay server-side; pickup
// credentials never expire by time.
// These tests evaluate the exact function shipped in pending-orders.ejs
// (extracted from the template source, not a copy) plus the server
// contract for structurally-valid-but-forged tokens.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "..", "views");
const PENDING_EJS = path.join(VIEWS_DIR, "vendor", "pending-orders.ejs");
const SECRET = "f07-guard-test-secret";
const FUTURE = Date.now() + 60 * 60 * 1000;

function loadClientGuard() {
  const src = fs.readFileSync(PENDING_EJS, "utf8");
  const fnMatch = src.match(/function isFlashFoodsQrShape\(value\) \{[\s\S]*?\n    \}/);
  assert.ok(fnMatch, "pending-orders.ejs must define isFlashFoodsQrShape");
  const errMatch = src.match(/var QR_SHAPE_ERROR = "([^"]+)";/);
  assert.ok(errMatch, "pending-orders.ejs must define QR_SHAPE_ERROR");
  const isFlashFoodsQrShape = new Function(
    `${fnMatch[0]}; return isFlashFoodsQrShape;`,
  )();
  return { src, isFlashFoodsQrShape, QR_SHAPE_ERROR: errMatch[1] };
}

const { src: EJS_SRC, isFlashFoodsQrShape, QR_SHAPE_ERROR } =
  loadClientGuard();

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

beforeEach(async () => {
  await Promise.all([Shop.deleteMany({}), User.deleteMany({}), Order.deleteMany({})]);
  currentUserId = null;
  activeUser = null;
  shopA = await Shop.create({ name: "Shop A", slug: "shop-a-f07-guard" });
  vendorA = await User.create({ name: "Vendor A", email: "va.f07guard@flashfoods.test", passwordHash: "h", role: "vendor", shop: shopA._id });
  student = await User.create({ name: "Student One", email: "s1.f07guard@flashfoods.test", passwordHash: "h", role: "student", phone: "9876543210" });
});

async function request(pathname, { method = "GET", user = null, body, accept } = {}) {
  activeUser = user;
  currentUserId = user ? user._id : null;
  const init = { method, redirect: "manual", headers: { Accept: accept || "application/json" } };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return fetch(`${baseUrl}${pathname}`, init);
}

async function makeReadyOrder() {
  return Order.create({
    customer: student._id,
    shop: shopA._id,
    items: [{ name: "Meal", price: 100, quantity: 2 }],
    total: 200,
    pickupOtp: "654321",
    status: "ready_for_pickup",
    pickupTime: new Date(FUTURE),
  });
}

test("guard: valid FlashFoods token passes (submission allowed)", async () => {
  const order = await makeReadyOrder();
  const token = createPickupQr(order);
  assert.equal(isFlashFoodsQrShape(token), true);
});

test("guard: '3IWY3IaOhKE9rOyKJaS' blocked locally", () => {
  assert.equal(isFlashFoodsQrShape("3IWY3IaOhKE9rOyKJaS"), false);
});

test("guard: malformed values blocked locally", () => {
  assert.equal(isFlashFoodsQrShape(""), false);
  assert.equal(isFlashFoodsQrShape("not-a-token"), false);
  assert.equal(isFlashFoodsQrShape("upi://pay?pa=shop@upi&pn=Canteen"), false);
  assert.equal(isFlashFoodsQrShape("https://example.com/random-qr"), false);
  assert.equal(isFlashFoodsQrShape("abcdef123456"), false);
});

test("guard: incomplete token blocked locally", async () => {
  const order = await makeReadyOrder();
  const token = createPickupQr(order);
  const parts = token.split(".");
  assert.equal(parts.length, 4);
  assert.equal(isFlashFoodsQrShape(parts.slice(0, 3).join(".")), false);
  assert.equal(isFlashFoodsQrShape(`${parts[0]}.${parts[1]}.${parts[2]}.`), false);
  assert.equal(isFlashFoodsQrShape("v1.zzz.zzz.sig"), false);
  assert.equal(isFlashFoodsQrShape("v1.zzz.zzz.123.sig"), false);
  assert.equal(isFlashFoodsQrShape("v1.aaa.bbb.ccc.ddd.eee"), false);
});

test("guard: legacy 5-part token passes and completes end-to-end (migration window)", async () => {
  const order = await makeReadyOrder();
  const orderId = String(order._id);
  const shop = String(order.shop);
  const exp = "1000000000000";
  const payload = `v1.${orderId}.${shop}.${exp}`;
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(payload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
    .slice(0, 32);
  const legacy = `${payload}.${sig}`;
  assert.equal(isFlashFoodsQrShape(legacy), true);
  const res = await request("/vendor/verify-qr", {
    method: "POST",
    user: vendorA,
    body: { qr: legacy },
  });
  assert.equal(res.status, 200);
  const after = await Order.findById(order._id).lean();
  assert.equal(after.status, "completed");
});

test("guard: structurally-valid-but-forged token still submits (server rejects, zero mutation)", async () => {
  const order = await makeReadyOrder();
  const token = createPickupQr(order);
  const forged = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
  assert.equal(isFlashFoodsQrShape(forged), true);
  const res = await request("/vendor/verify-qr", {
    method: "POST",
    user: vendorA,
    body: { qr: forged },
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error || "", /Invalid pickup QR/i);
  const after = await Order.findById(order._id).lean();
  assert.equal(after.status, "ready_for_pickup");
});

test("guard: valid camera rawValue passes shape check unchanged", async () => {
  const order = await makeReadyOrder();
  const rawValue = createPickupQr(order); // what BarcodeDetector.rawValue carries
  assert.equal(isFlashFoodsQrShape(rawValue), true);
  // Camera handler must assign rawValue verbatim and route through the same
  // validated submitQr() — no repair/truncate/transform in between.
  assert.ok(EJS_SRC.includes("globalQrInput.value = codes[0].rawValue"));
  const cameraBlock = EJS_SRC.slice(EJS_SRC.indexOf("codes[0].rawValue"));
  assert.ok(cameraBlock.slice(0, 200).includes("submitQr()"));
});

test("guard: pending page wires the local error before any fetch", async () => {
  const res = await request("/vendor/orders/pending", {
    user: vendorA,
    accept: "text/html",
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("isFlashFoodsQrShape"));
  assert.ok(html.includes("Invalid FlashFoods pickup QR"));
  const guardPos = html.indexOf("isFlashFoodsQrShape(qr)");
  const fetchPos = html.indexOf('fetch("/vendor/verify-qr"');
  assert.ok(guardPos !== -1 && fetchPos !== -1 && guardPos < fetchPos);
  // OTP fallback untouched.
  assert.ok(html.includes('id="global-verify-form"'));
  assert.ok(html.includes('id="global-otp-input"'));
});

test("guard: local error message is vendor-actionable", () => {
  assert.match(QR_SHAPE_ERROR, /Invalid FlashFoods pickup QR/);
  assert.match(QR_SHAPE_ERROR, /complete QR contents/);
});
