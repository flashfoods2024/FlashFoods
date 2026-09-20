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
import { MenuItem } from "../../models/MenuItem.js";
import { Order } from "../../models/Order.js";
import { cartRouter } from "../../routes/cart.js";
import { ordersRouter } from "../../routes/orders.js";
import { vendorRouter } from "../../routes/vendor.js";
import {
  normalizeDiscountPercent,
  getShopDiscount,
  computeDiscountPaise,
  validateDiscountSettings,
} from "../../utils/discount.js";
import { adjustOrderPaid } from "../../utils/order-adjust.js";
import { cancelOrderPaid } from "../../utils/order-cancel.js";
import {
  formatLocalDateTime,
  formatPickupTime,
  getPickupUrgency,
} from "../../utils/time.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "..", "views");

// ---------------------------------------------------------------------------
// Pure calculation / configuration
// ---------------------------------------------------------------------------

test("normalizeDiscountPercent accepts 0..100 and rejects the rest", () => {
  assert.equal(normalizeDiscountPercent(0), 0);
  assert.equal(normalizeDiscountPercent("12.5"), 12.5);
  assert.equal(normalizeDiscountPercent(100), 100);
  assert.equal(normalizeDiscountPercent("33.333"), 33.33);
  assert.equal(normalizeDiscountPercent(-1), null);
  assert.equal(normalizeDiscountPercent(101), null);
  assert.equal(normalizeDiscountPercent("abc"), null);
  assert.equal(normalizeDiscountPercent(""), null);
  assert.equal(normalizeDiscountPercent(null), null);
  assert.equal(normalizeDiscountPercent(Infinity), null);
});

test("getShopDiscount collapses disabled or invalid config to zero", () => {
  assert.deepEqual(getShopDiscount(null), { enabled: false, percent: 0 });
  assert.deepEqual(getShopDiscount({}), { enabled: false, percent: 0 });
  assert.deepEqual(getShopDiscount({ discount: { enabled: false, percent: 50 } }), {
    enabled: false,
    percent: 0,
  });
  assert.deepEqual(getShopDiscount({ discount: { enabled: true, percent: 0 } }), {
    enabled: false,
    percent: 0,
  });
  assert.deepEqual(getShopDiscount({ discount: { enabled: true, percent: 150 } }), {
    enabled: false,
    percent: 0,
  });
  assert.deepEqual(getShopDiscount({ discount: { enabled: true, percent: 15 } }), {
    enabled: true,
    percent: 15,
  });
});

test("computeDiscountPaise rounds once and clamps to the food subtotal", () => {
  assert.equal(computeDiscountPaise(10000, 10), 1000);
  assert.equal(computeDiscountPaise(9999, 10), 1000); // 999.9 -> 1000
  assert.equal(computeDiscountPaise(101, 10), 10); // 10.1 -> 10
  assert.equal(computeDiscountPaise(10000, 100), 10000); // 100% -> free food
  assert.equal(computeDiscountPaise(10000, 0), 0);
  assert.equal(computeDiscountPaise(10000, -5), 0);
  assert.equal(computeDiscountPaise(0, 50), 0);
  assert.equal(computeDiscountPaise(-100, 50), 0);
});

test("validateDiscountSettings accepts disabling and valid percentages", () => {
  assert.deepEqual(validateDiscountSettings({}), {
    ok: true,
    settings: { enabled: false, percent: 0 },
  });
  assert.deepEqual(validateDiscountSettings({ enabled: "true", percent: "25" }), {
    ok: true,
    settings: { enabled: true, percent: 25 },
  });
  assert.deepEqual(validateDiscountSettings({ enabled: "on", percent: "7.5" }), {
    ok: true,
    settings: { enabled: true, percent: 7.5 },
  });
});

test("validateDiscountSettings rejects enabled with a bad percentage", () => {
  for (const percent of ["0", "", "101", "-5", "abc"]) {
    const result = validateDiscountSettings({ enabled: "true", percent });
    assert.equal(result.ok, false, `expected reject for ${percent}`);
    assert.equal(typeof result.error, "string");
  }
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

let mongo;
let server;
let baseUrl;

let vendorA;
let student;
let shopDiscount;
let item;
let activeUser = null;
let currentUserId = null;
let seedCart = null;
let lastFlash = null;

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

  app.use(cartRouter);
  app.use(ordersRouter);
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
  await Promise.all([Shop.deleteMany({}), User.deleteMany({}), MenuItem.deleteMany({}), Order.deleteMany({})]);
  activeUser = null;
  currentUserId = null;
  seedCart = null;
  lastFlash = null;

  shopDiscount = await Shop.create({
    name: "Discount Canteen",
    slug: "testing",
    discount: { enabled: true, percent: 10 },
  });
  vendorA = await User.create({
    name: "Vendor A",
    email: "vendor.a@flashfoods.test",
    passwordHash: "hash",
    role: "vendor",
    phone: "9000000001",
    shop: shopDiscount._id,
  });
  student = await User.create({
    name: "Student One",
    email: "student.one@flashfoods.test",
    passwordHash: "hash",
    role: "student",
    phone: "9000000003",
  });
  await Shop.updateOne({ _id: shopDiscount._id }, { $set: { vendor: vendorA._id } });

  item = await MenuItem.create({
    shop: shopDiscount._id,
    name: "Meal",
    price: 100,
    available: true,
    variants: [{ label: "Regular", price: 100 }],
  });
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

async function placeMockOrder({ quantity = 1, orderType = "dinein", pickupTime = "" } = {}) {
  seedCart = {
    shopId: String(shopDiscount._id),
    items: [{ menuItemId: String(item._id), quantity, variantId: 0, variantName: "Regular" }],
  };
  return request("/orders/checkout", {
    method: "POST",
    user: student,
    form: { orderType, pickupTime },
  });
}

test("vendor can enable and configure a discount", async () => {
  const res = await request("/vendor/shop/discount", {
    method: "POST",
    user: vendorA,
    form: { enabled: "true", percent: "12.5" },
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/vendor/menu");

  const shop = await Shop.findById(shopDiscount._id).lean();
  assert.equal(shop.discount.enabled, true);
  assert.equal(shop.discount.percent, 12.5);
});

test("vendor can disable a discount", async () => {
  const res = await request("/vendor/shop/discount", {
    method: "POST",
    user: vendorA,
    form: { percent: "12.5" },
  });
  assert.equal(res.status, 302);
  const shop = await Shop.findById(shopDiscount._id).lean();
  assert.equal(shop.discount.enabled, false);
});

test("vendor invalid discount is rejected without writing", async () => {
  const before = await Shop.findById(shopDiscount._id).lean();
  const res = await request("/vendor/shop/discount", {
    method: "POST",
    user: vendorA,
    form: { enabled: "true", percent: "150" },
  });
  assert.equal(res.status, 302);
  assert.equal(lastFlash.type, "error");
  const after = await Shop.findById(shopDiscount._id).lean();
  assert.equal(after.discount.percent, before.discount.percent);
  assert.equal(after.discount.enabled, before.discount.enabled);
});

test("students cannot configure a discount", async () => {
  const res = await request("/vendor/shop/discount", {
    method: "POST",
    user: student,
    form: { enabled: "true", percent: "50" },
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");
});

test("order total and charged amount reflect the server-side discount", async () => {
  const res = await placeMockOrder({ quantity: 1 });
  assert.equal(res.status, 302);

  const order = await Order.findOne({ shop: shopDiscount._id }).lean();
  // ₹100 food - 10% = ₹90.
  assert.equal(order.discountPercent, 10);
  assert.equal(order.discountAmountPaise, 1000);
  assert.equal(order.amountChargedPaise, 9000);
  assert.equal(order.total, 90);
});

test("discount applies to food only; parcel charge is never discounted", async () => {
  await Shop.updateOne(
    { _id: shopDiscount._id },
    { $set: { parcelChargeEnabled: true, parcelCharge: 20 } },
  );
  await placeMockOrder({ quantity: 2, orderType: "parcel" });

  const order = await Order.findOne({ shop: shopDiscount._id }).lean();
  // food 200 - 10% (20) = 180, + parcel 20 = 200.
  assert.equal(order.discountAmountPaise, 2000);
  assert.equal(order.parcelCharge, 20);
  assert.equal(order.amountChargedPaise, 20000);
  assert.equal(order.total, 200);
});

test("percentage discount rounds deterministically", async () => {
  await Shop.updateOne({ _id: shopDiscount._id }, { $set: { "discount.percent": 12.5 } });
  await MenuItem.updateOne({ _id: item._id }, { $set: { price: 99.99, "variants.0.price": 99.99 } });
  await placeMockOrder({ quantity: 1 });

  const order = await Order.findOne({ shop: shopDiscount._id }).lean();
  // food 9999 paise, 12.5% = 1249.875 -> 1250; total 8749 = ₹87.49.
  assert.equal(order.discountAmountPaise, 1250);
  assert.equal(order.amountChargedPaise, 8749);
  assert.equal(order.total, 87.49);
});

test("a disabled discount leaves the total untouched", async () => {
  await Shop.updateOne(
    { _id: shopDiscount._id },
    { $set: { "discount.enabled": false } },
  );
  await placeMockOrder({ quantity: 1 });

  const order = await Order.findOne({ shop: shopDiscount._id }).lean();
  assert.equal(order.discountPercent, 0);
  assert.equal(order.discountAmountPaise, 0);
  assert.equal(order.amountChargedPaise, 10000);
  assert.equal(order.total, 100);
});

test("cart page surfaces the discount to the student", async () => {
  seedCart = {
    shopId: String(shopDiscount._id),
    items: [{ menuItemId: String(item._id), quantity: 1, variantId: 0, variantName: "Regular" }],
  };
  const res = await request("/cart", { user: student, accept: "text/html" });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("Discount (10%)"));
  assert.ok(html.includes('id="discount-amount"'));
});

test("adjusting a discounted order keeps the discount in the refund math", async () => {
  await MenuItem.create({
    shop: shopDiscount._id,
    name: "Side",
    price: 50,
    available: true,
    variants: [{ label: "Regular", price: 50 }],
  });
  // Build an order with two lines: ₹100 + ₹50 = ₹150 food, 10% = ₹15, total ₹135.
  const side = await MenuItem.findOne({ shop: shopDiscount._id, name: "Side" }).lean();
  seedCart = {
    shopId: String(shopDiscount._id),
    items: [
      { menuItemId: String(item._id), quantity: 1, variantId: 0, variantName: "Regular" },
      { menuItemId: String(side._id), quantity: 1, variantId: 0, variantName: "Regular" },
    ],
  };
  await request("/orders/checkout", { method: "POST", user: student, form: { orderType: "dinein" } });

  const order = await Order.findOne({ shop: shopDiscount._id }).lean();
  assert.equal(order.amountChargedPaise, 13500);

  // Remove the second item: remaining food ₹100 - 10% = ₹90; refund ₹45.
  const result = await adjustOrderPaid({
    orderId: String(order._id),
    shopId: String(shopDiscount._id),
    keepRaw: ["0"],
    adjustmentReason: "Out of Stock",
    adjustedBy: student._id,
    refundFn: async () => ({ id: "refund_1" }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.refundPaise, 4500);
  const after = await Order.findById(order._id).lean();
  assert.equal(after.total, 90);
});

test("cancelling a discounted order keeps the charged amount authoritative", async () => {
  await placeMockOrder({ quantity: 1 });
  const order = await Order.findOne({ shop: shopDiscount._id }).lean();
  assert.equal(order.amountChargedPaise, 9000);

  const result = await cancelOrderPaid({
    orderId: String(order._id),
    shopId: String(shopDiscount._id),
    refundFn: async () => ({ id: "x" }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.order.status, "cancelled");

  const after = await Order.findById(order._id).lean();
  assert.equal(after.amountChargedPaise, 9000);
  assert.equal(after.total, 90);
});

test("vendor menu page renders the discount settings form", async () => {
  const res = await request("/vendor/menu", { user: vendorA, accept: "text/html" });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('action="/vendor/shop/discount"'));
  assert.ok(html.includes('name="percent"'));
});
