// Stage 1 comprehensive + global integration suite.
//
// Exercises the seven Stage 1 features together (shop hours, pickup slots,
// discounts, QR/OTP pickup, FCM payloads, profiles) and the cross-role
// authorization matrix. Uses an in-memory MongoDB only — it never connects to
// the configured application database.

import test, { before, after, beforeEach, afterEach } from "node:test";
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
import { MenuItem } from "../../models/MenuItem.js";
import { Order } from "../../models/Order.js";
import { PickupSlotBooking } from "../../models/PickupSlotBooking.js";
import { FcmToken } from "../../models/FcmToken.js";
import { shopsRouter } from "../../routes/shops.js";
import { cartRouter } from "../../routes/cart.js";
import { ordersRouter } from "../../routes/orders.js";
import { vendorRouter } from "../../routes/vendor.js";
import { profileRouter } from "../../routes/profile.js";
import { vendorProfileRouter } from "../../routes/vendor-profile.js";
import { menuRouter } from "../../routes/menu.js";
import { adminRouter } from "../../routes/admin.js";
import { fcmRouter } from "../../routes/api/fcm.js";
import { createPickupQr } from "../../utils/qr-pickup.js";
import { generateSlotInstants } from "../../utils/pickup-slots.js";
import { countPendingOrders } from "../../socket/index.js";
import {
  formatLocalDateTime,
  formatPickupTime,
  getPickupUrgency,
} from "../../utils/time.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "..", "views");
const QR_SECRET = "stage1-comprehensive-secret";

let mongo;
let server;
let baseUrl;

let admin;
let vendor;
let student;
let shop; // slug "testing" so mock checkout is allowed
let shopClosed; // outside operating hours
let item;

let currentUserId = null;
let activeUser = null;
let seedCart = null;
let lastFlash = null;

// ponytail: F04 slots are today-only with earliest = now + prep, so every
// slot-dependent test freezes the clock at a fixed midday instant (13:00 IST).
// Without this the suite passes or fails depending on the wall-clock hour it
// happens to run in (e.g. after ~22:00 IST no same-day slot can meet prep).
const FIXED_NOW_MS = new Date("2026-09-20T07:30:00.000Z").getTime();
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [FIXED_NOW_MS]));
  }
  static now() {
    return FIXED_NOW_MS;
  }
}

before(async () => {
  process.env.QR_SECRET = QR_SECRET;
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
    if (seedCart) req.session.cart = JSON.parse(JSON.stringify(seedCart));
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

  app.use(shopsRouter);
  app.use(cartRouter);
  app.use(ordersRouter);
  app.use(vendorRouter);
  app.use(menuRouter);
  app.use(profileRouter);
  app.use(vendorProfileRouter);
  app.use("/admin", adminRouter);
  app.use("/api/fcm", fcmRouter);

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
  global.Date = FixedDate;
  await Promise.all([
    Shop.deleteMany({}),
    User.deleteMany({}),
    MenuItem.deleteMany({}),
    Order.deleteMany({}),
    PickupSlotBooking.deleteMany({}),
    FcmToken.deleteMany({}),
  ]);
  currentUserId = null;
  activeUser = null;
  seedCart = null;
  lastFlash = null;

  shop = await Shop.create({
    name: "Stage 1 Canteen",
    slug: "testing",
    openingTime: "00:00",
    closingTime: "23:59",
    pickupSlots: {
      enabled: true,
      startTime: "00:00",
      endTime: "23:59",
      durationMinutes: 60,
      capacity: 2,
    },
    discount: { enabled: true, percent: 10 },
  });
  // A window entirely in the future relative to the IST clock ⇒ closed now.
  const istHHMM = (offsetMinutes) => {
    const shifted = new Date(Date.now() + (330 + offsetMinutes) * 60 * 1000);
    return `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`;
  };
  shopClosed = await Shop.create({
    name: "Closed Canteen",
    slug: "closed-canteen",
    openingTime: istHHMM(120),
    closingTime: istHHMM(240),
  });
  admin = await User.create({ name: "Admin", email: "admin@flashfoods.test", passwordHash: "hash", role: "admin" });
  vendor = await User.create({ name: "Vendor", email: "vendor@flashfoods.test", passwordHash: "hash", role: "vendor", shop: shop._id });
  student = await User.create({ name: "Student", email: "student@flashfoods.test", passwordHash: "hash", role: "student" });
  await Shop.updateOne({ _id: shop._id }, { $set: { vendor: vendor._id } });

  item = await MenuItem.create({
    shop: shop._id,
    name: "Combo Meal",
    price: 100,
    available: true,
    variants: [{ label: "Regular", price: 100 }],
  });
});

afterEach(async () => {
  global.Date = RealDate;
});

async function request(pathname, { method = "GET", user = null, body, form, accept, headers } = {}) {
  activeUser = user;
  currentUserId = user ? user._id : null;
  const init = { method, redirect: "manual", headers: { Accept: accept || "text/html,application/json", ...(headers || {}) } };
  if (form !== undefined) {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return fetch(`${baseUrl}${pathname}`, init);
}

function firstSlotIso(shopDoc, now = new Date()) {
  const slots = generateSlotInstants(shopDoc.pickupSlots, now);
  return slots[0] ? slots[0].start.toISOString() : null;
}

async function placeOrder({ slotIso }) {
  seedCart = {
    shopId: String(shop._id),
    items: [{ menuItemId: String(item._id), quantity: 1, variantId: 0, variantName: "Regular" }],
  };
  return request("/orders/checkout", {
    method: "POST",
    user: student,
    form: { orderType: "dinein", pickupTime: slotIso || "" },
  });
}

// ---------------------------------------------------------------------------
// Comprehensive cross-feature flows
// ---------------------------------------------------------------------------

test("shop hours + pickup slots expose only in-hours slots", async () => {
  await Shop.updateOne(
    { _id: shop._id },
    { $set: { openingTime: "09:00", closingTime: "17:00" } },
  );
  const fresh = await Shop.findById(shop._id).lean();
  const now = new Date();
  const istMinutes = (d) => {
    const s = new Date(new Date(d).getTime() + 330 * 60000);
    return s.getUTCHours() * 60 + s.getUTCMinutes();
  };
  const all = generateSlotInstants(fresh.pickupSlots, now);
  const inHours = all.filter((s) => istMinutes(s.start) >= 540 && istMinutes(s.start) < 1020);
  assert.ok(inHours.length > 0, "expected bookable in-hours slots");

  seedCart = {
    shopId: String(shop._id),
    items: [{ menuItemId: String(item._id), quantity: 1, variantId: 0, variantName: "Regular" }],
  };
  const res = await request("/cart", { user: student, accept: "text/html" });
  const html = await res.text();
  assert.ok(html.includes("Pickup Slot"));
  // The out-of-hours slot must not be offered.
  const outside = all.find((s) => istMinutes(s.start) < 540);
  if (outside) assert.ok(!html.includes(outside.start.toISOString()));
});

test("discount + slots + payment totals line up end to end", async () => {
  const iso = firstSlotIso(await Shop.findById(shop._id).lean());
  const res = await placeOrder({ slotIso: iso });
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location"), /^\/orders\//);

  const order = await Order.findOne({ shop: shop._id }).lean();
  assert.equal(order.discountPercent, 10);
  assert.equal(order.discountAmountPaise, 1000);
  assert.equal(order.total, 90);
  assert.equal(order.amountChargedPaise, 9000);

  const booking = await PickupSlotBooking.findOne({ shop: shop._id, slotStart: new Date(iso) }).lean();
  assert.equal(booking.booked, 1);
});

test("full lifecycle: order → accepted → ready → QR pickup completes", async () => {
  const iso = firstSlotIso(await Shop.findById(shop._id).lean());
  await placeOrder({ slotIso: iso });
  const created = await Order.findOne({ shop: shop._id }).lean();

  const accept = await request(`/vendor/orders/${created._id}/accept`, { method: "POST", user: vendor });
  assert.equal(accept.status, 302);
  const ready = await request(`/vendor/orders/${created._id}/ready`, { method: "POST", user: vendor });
  assert.equal(ready.status, 302);

  const readyOrder = await Order.findById(created._id).lean();
  assert.equal(readyOrder.status, "ready_for_pickup");
  assert.ok(readyOrder.pickupOtpExpiresAt);

  // Notifications: completion of the lifecycle must not throw with FCM unconfigured.
  assert.equal(await countPendingOrders(shop._id), 0);

  const token = createPickupQr(readyOrder);
  const verify = await request("/vendor/verify-qr", {
    method: "POST",
    user: vendor,
    body: { qr: token },
    accept: "application/json",
  });
  assert.equal(verify.status, 200);

  const completed = await Order.findById(created._id).lean();
  assert.equal(completed.status, "completed");

  // Replay is rejected.
  const replay = await request("/vendor/verify-qr", { method: "POST", user: vendor, body: { qr: token }, accept: "application/json" });
  assert.equal(replay.status, 409);
});

test("OTP fallback completes a second order", async () => {
  const iso = firstSlotIso(await Shop.findById(shop._id).lean());
  await placeOrder({ slotIso: iso });
  const created = await Order.findOne({ shop: shop._id }).lean();

  await request(`/vendor/orders/${created._id}/accept`, { method: "POST", user: vendor });
  await request(`/vendor/orders/${created._id}/ready`, { method: "POST", user: vendor });
  const ready = await Order.findById(created._id).lean();

  const verify = await request("/vendor/verify", {
    method: "POST",
    user: vendor,
    body: { otp: ready.pickupOtp },
    accept: "application/json",
  });
  assert.equal(verify.status, 200);
  assert.equal((await Order.findById(created._id).lean()).status, "completed");
});

test("ordering is blocked when the shop is outside its hours", async () => {
  const closedItem = await MenuItem.create({
    shop: shopClosed._id,
    name: "Closed Item",
    price: 50,
    available: true,
    variants: [{ label: "Regular", price: 50 }],
  });

  const add = await request("/cart/add", {
    method: "POST",
    user: student,
    form: { menuItemId: String(closedItem._id), quantity: "1" },
  });
  assert.equal(add.status, 302);
  assert.match(lastFlash.message, /closed/i);
});

// ---------------------------------------------------------------------------
// Global authorization matrix
// ---------------------------------------------------------------------------

test("global authorization: student routes", async () => {
  const asStudent = await request("/profile", { user: student, accept: "text/html" });
  assert.equal(asStudent.status, 200);

  const vendorOnStudent = await request("/profile", { user: vendor, accept: "text/html" });
  assert.equal(vendorOnStudent.status, 302);

  const anonymous = await request("/orders", { accept: "text/html" });
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get("location"), "/login");
});

test("global authorization: vendor routes", async () => {
  const asVendor = await request("/vendor/menu", { user: vendor, accept: "text/html" });
  assert.equal(asVendor.status, 200);

  const studentOnVendor = await request("/vendor/menu", { user: student, accept: "text/html" });
  assert.equal(studentOnVendor.status, 302);

  const asVendorProfile = await request("/vendor/profile", { user: vendor, accept: "text/html" });
  assert.equal(asVendorProfile.status, 200);

  const studentOnVendorProfile = await request("/vendor/profile", { user: student, accept: "text/html" });
  assert.equal(studentOnVendorProfile.status, 302);
});

test("global authorization: admin routes", async () => {
  const asAdmin = await request("/admin/", { user: admin, accept: "text/html" });
  assert.equal(asAdmin.status, 200);

  for (const role of [student, vendor]) {
    const res = await request("/admin/shops", { user: role, accept: "text/html" });
    assert.equal(res.status, 302, `role ${role.role} must not reach admin`);
    assert.equal(res.headers.get("location"), "/");
  }
});

test("global authorization: FCM endpoints are vendor-only", async () => {
  const asVendor = await request("/api/fcm/register", { method: "POST", user: vendor, body: { token: "t1" } });
  assert.equal(asVendor.status, 200);

  const asStudent = await request("/api/fcm/register", { method: "POST", user: student, body: { token: "t2" } });
  assert.equal(asStudent.status, 302);

  // The vendor's token is present for targeting.
  assert.equal(await FcmToken.countDocuments({ token: "t1" }), 1);
  assert.equal(await FcmToken.countDocuments({ token: "t2" }), 0);
});

test("global smoke: public catalog and shop pages render", async () => {
  const shops = await request("/shops", { user: student, accept: "text/html" });
  assert.equal(shops.status, 200);
  assert.ok((await shops.text()).includes("Stage 1 Canteen"));

  const shopPage = await request("/shops/testing", { user: student, accept: "text/html" });
  assert.equal(shopPage.status, 200);
  assert.ok((await shopPage.text()).includes("Combo Meal"));
});
