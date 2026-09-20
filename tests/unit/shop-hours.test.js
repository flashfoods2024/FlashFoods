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
import { shopsRouter } from "../../routes/shops.js";
import { cartRouter } from "../../routes/cart.js";
import { vendorRouter } from "../../routes/vendor.js";
import { ordersRouter } from "../../routes/orders.js";
import { adminRouter } from "../../routes/admin.js";
import {
  parseTimeToMinutes,
  normalizeTime,
  istMinutesOfDay,
  validateOperatingHours,
  hasConfiguredHours,
  isWithinOperatingHours,
  isShopAvailable,
  formatTimeLabel,
  getShopAvailability,
} from "../../utils/shop-hours.js";
import {
  formatLocalDateTime,
  formatPickupTime,
  getPickupUrgency,
} from "../../utils/time.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "..", "views");

// 2026-09-20 13:00 IST (07:30Z).
const NOW = new Date("2026-09-20T07:30:00.000Z");

let mongo;
let server;
let baseUrl;

let vendorA;
let vendorB;
let student;
let adminUser;
let shopOpenHours;
let shopClosedHours;
let shopNoHours;
let itemInClosedShop;

let activeUser = null;
let currentUserId = null;
let seedCart = null;
let lastFlash = null;

// ---------------------------------------------------------------------------
// Pure operating-hours logic
// ---------------------------------------------------------------------------

test("parseTimeToMinutes accepts HH:MM and rejects malformed values", () => {
  assert.equal(parseTimeToMinutes("00:00"), 0);
  assert.equal(parseTimeToMinutes("09:05"), 545);
  assert.equal(parseTimeToMinutes("23:59"), 1439);
  assert.equal(parseTimeToMinutes("9:05"), 545); // unpadded hour accepted
  assert.equal(parseTimeToMinutes("24:00"), null);
  assert.equal(parseTimeToMinutes("12:60"), null);
  assert.equal(parseTimeToMinutes("noon"), null);
  assert.equal(parseTimeToMinutes(""), null);
  assert.equal(parseTimeToMinutes(undefined), null);
  assert.equal(parseTimeToMinutes("12:00 "), 720); // trims
});

test("normalizeTime and formatTimeLabel handle valid values", () => {
  assert.equal(normalizeTime("09:05"), "09:05");
  assert.equal(normalizeTime("bad"), null);
  assert.equal(formatTimeLabel("09:05"), "9:05 AM");
  assert.equal(formatTimeLabel("13:00"), "1:00 PM");
  assert.equal(formatTimeLabel("00:30"), "12:30 AM");
  assert.equal(formatTimeLabel("12:00"), "12:00 PM");
  assert.equal(formatTimeLabel("nope"), null);
});

test("istMinutesOfDay returns the IST clock, not UTC", () => {
  // 07:30Z is 13:00 IST.
  assert.equal(istMinutesOfDay(NOW), 13 * 60);
  // 18:30Z is 00:00 IST the next day.
  assert.equal(istMinutesOfDay(new Date("2026-09-20T18:30:00.000Z")), 0);
});

test("validateOperatingHours accepts blank, valid pairs and normalizes", () => {
  assert.deepEqual(validateOperatingHours("", ""), {
    ok: true,
    openingTime: "",
    closingTime: "",
  });
  assert.deepEqual(validateOperatingHours(null, undefined), {
    ok: true,
    openingTime: "",
    closingTime: "",
  });

  const valid = validateOperatingHours("9:00", "17:00");
  assert.equal(valid.ok, true);
  assert.equal(valid.openingTime, "09:00");
  assert.equal(valid.closingTime, "17:00");
});

test("validateOperatingHours rejects half-configured, malformed and equal times", () => {
  assert.equal(validateOperatingHours("09:00", "").ok, false);
  assert.equal(validateOperatingHours("", "17:00").ok, false);
  assert.equal(validateOperatingHours("25:00", "17:00").ok, false);
  assert.equal(validateOperatingHours("09:00", "17:60").ok, false);
  assert.equal(validateOperatingHours("09:00", "09:00").ok, false);
});

test("hasConfiguredHours only true for a valid distinct pair", () => {
  assert.equal(hasConfiguredHours({ openingTime: "09:00", closingTime: "17:00" }), true);
  assert.equal(hasConfiguredHours({ openingTime: "17:00", closingTime: "09:00" }), true); // overnight
  assert.equal(hasConfiguredHours({ openingTime: "", closingTime: "" }), false);
  assert.equal(hasConfiguredHours({ openingTime: "09:00", closingTime: "" }), false);
  assert.equal(hasConfiguredHours({ openingTime: "bad", closingTime: "17:00" }), false);
  assert.equal(hasConfiguredHours({ openingTime: "09:00", closingTime: "09:00" }), false);
  assert.equal(hasConfiguredHours(null), false);
});

test("isWithinOperatingHours handles same-day boundaries (open inclusive, close exclusive)", () => {
  const shop = { openingTime: "09:00", closingTime: "17:00" };
  const at = (h, m = 0) => new Date(Date.UTC(2026, 8, 20, h - 5, m - 30, 0, 0)); // IST h:m -> UTC

  assert.equal(isWithinOperatingHours(shop, at(8, 59)), false);
  assert.equal(isWithinOperatingHours(shop, at(9, 0)), true); // inclusive
  assert.equal(isWithinOperatingHours(shop, at(12, 0)), true);
  assert.equal(isWithinOperatingHours(shop, at(16, 59)), true);
  assert.equal(isWithinOperatingHours(shop, at(17, 0)), false); // exclusive
  assert.equal(isWithinOperatingHours(shop, at(18, 0)), false);
});

test("isWithinOperatingHours supports overnight windows spanning midnight", () => {
  const shop = { openingTime: "22:00", closingTime: "02:00" };
  const at = (h, m = 0) => new Date(Date.UTC(2026, 8, 20, h - 5, m - 30, 0, 0));

  assert.equal(isWithinOperatingHours(shop, at(23, 0)), true);
  assert.equal(isWithinOperatingHours(shop, at(1, 0)), true);
  assert.equal(isWithinOperatingHours(shop, at(2, 0)), false); // exclusive close
  assert.equal(isWithinOperatingHours(shop, at(12, 0)), false);
});

test("isWithinOperatingHours treats missing/invalid hours as unconstrained", () => {
  const at = new Date("2026-09-20T07:30:00.000Z");
  assert.equal(isWithinOperatingHours({ openingTime: "", closingTime: "" }, at), true);
  assert.equal(isWithinOperatingHours({ openingTime: "09:00", closingTime: "" }, at), true);
  assert.equal(isWithinOperatingHours({ openingTime: "bad", closingTime: "17:00" }, at), true);
  assert.equal(isWithinOperatingHours({ openingTime: "09:00", closingTime: "09:00" }, at), true);
});

test("isShopAvailable combines active, manual open and configured hours", () => {
  const at = new Date("2026-09-20T07:30:00.000Z"); // 13:00 IST

  // active + open + no hours -> available
  assert.equal(isShopAvailable({ isActive: true, isOpen: true }, at), true);
  // manual close wins
  assert.equal(isShopAvailable({ isActive: true, isOpen: false }, at), false);
  // disabled wins
  assert.equal(isShopAvailable({ isActive: false, isOpen: true }, at), false);
  // open + within hours
  assert.equal(
    isShopAvailable({ isActive: true, isOpen: true, openingTime: "09:00", closingTime: "17:00" }, at),
    true,
  );
  // open but outside hours -> not available
  assert.equal(
    isShopAvailable({ isActive: true, isOpen: true, openingTime: "15:00", closingTime: "18:00" }, at),
    false,
  );
  // invalid hours fall back to the manual flag
  assert.equal(
    isShopAvailable({ isActive: true, isOpen: true, openingTime: "bad", closingTime: "18:00" }, at),
    true,
  );
  assert.equal(isShopAvailable(null, at), false);
});

test("getShopAvailability never throws on malformed data", () => {
  const at = NOW;

  const unconfigured = getShopAvailability({ isOpen: true }, at);
  assert.equal(unconfigured.available, true);
  assert.equal(unconfigured.configured, false);
  assert.equal(unconfigured.hoursLabel, "Hours not set");
  assert.equal(unconfigured.label, "Open");

  const closed = getShopAvailability(
    { isOpen: true, openingTime: "20:00", closingTime: "21:00" },
    at,
  );
  assert.equal(closed.available, false);
  assert.equal(closed.configured, true);
  assert.equal(closed.withinHours, false);
  assert.equal(closed.label, "Closed");
  assert.equal(closed.hoursLabel, "8:00 PM – 9:00 PM");

  const broken = getShopAvailability(
    { isOpen: true, openingTime: "garbage", closingTime: "nonsense" },
    at,
  );
  assert.equal(broken.available, true);
  assert.equal(broken.configured, false);
  assert.equal(broken.label, "Open");

  const disabled = getShopAvailability({ isActive: false, isOpen: true }, at);
  assert.equal(disabled.available, false);
  assert.equal(disabled.label, "Unavailable");
});

// ---------------------------------------------------------------------------
// Route integration: vendor + admin controls, student behaviour
// ---------------------------------------------------------------------------

// IST clock (HH:MM) offset minutes from the real now.
function istHHMM(offsetMinutes = 0) {
  const shifted = new Date(Date.now() + (330 + offsetMinutes) * 60 * 1000);
  return `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(
    shifted.getUTCMinutes(),
  ).padStart(2, "0")}`;
}

function openNowHours() {
  return { openingTime: istHHMM(-120), closingTime: istHHMM(120) };
}

function closedNowHours() {
  // Entirely in the future, so "now" is always before opening.
  return { openingTime: istHHMM(60), closingTime: istHHMM(180) };
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

  app.use(shopsRouter);
  app.use(cartRouter);
  app.use(ordersRouter);
  app.use(vendorRouter);
  // The admin router defines paths without the /admin prefix (server.js mounts
  // it the same way), so mirror that here.
  app.use("/admin", adminRouter);

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
  await Promise.all([Shop.deleteMany({}), User.deleteMany({}), MenuItem.deleteMany({})]);
  activeUser = null;
  currentUserId = null;
  seedCart = null;
  lastFlash = null;

  shopOpenHours = await Shop.create({
    name: "Morning Canteen",
    slug: "morning-canteen",
    ...openNowHours(),
  });
  shopClosedHours = await Shop.create({
    name: "Night Canteen",
    slug: "night-canteen",
    ...closedNowHours(),
  });
  shopNoHours = await Shop.create({ name: "All Day Canteen", slug: "all-day-canteen" });

  vendorA = await User.create({
    name: "Vendor A",
    email: "vendor.a@flashfoods.test",
    passwordHash: "hash",
    role: "vendor",
    phone: "9000000001",
    shop: shopClosedHours._id,
  });
  vendorB = await User.create({
    name: "Vendor B",
    email: "vendor.b@flashfoods.test",
    passwordHash: "hash",
    role: "vendor",
    phone: "9000000002",
    shop: shopOpenHours._id,
  });
  student = await User.create({
    name: "Student One",
    email: "student.one@flashfoods.test",
    passwordHash: "hash",
    role: "student",
    phone: "9000000003",
  });
  adminUser = await User.create({
    name: "Admin One",
    email: "admin.one@flashfoods.test",
    passwordHash: "hash",
    role: "admin",
    phone: "9000000004",
  });

  await Shop.updateOne({ _id: shopClosedHours._id }, { $set: { vendor: vendorA._id } });
  await Shop.updateOne({ _id: shopOpenHours._id }, { $set: { vendor: vendorB._id } });

  itemInClosedShop = await MenuItem.create({
    shop: shopClosedHours._id,
    name: "Samosa",
    price: 20,
    available: true,
    variants: [{ label: "Regular", price: 20 }],
  });
});

async function request(pathname, { method = "GET", user = null, body, form, accept } = {}) {
  activeUser = user;
  currentUserId = user ? user._id : null;

  const init = {
    method,
    redirect: "manual",
    headers: { Accept: accept || "text/html,application/json" },
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

// --- Vendor controls -------------------------------------------------------

test("vendor can set valid operating hours", async () => {
  const res = await request("/vendor/shop/hours", {
    method: "POST",
    user: vendorA,
    form: { openingTime: "09:00", closingTime: "17:00" },
  });

  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/vendor/menu");

  const stored = await Shop.findById(shopClosedHours._id).lean();
  assert.equal(stored.openingTime, "09:00");
  assert.equal(stored.closingTime, "17:00");
});

test("vendor hours are normalized from unpadded input", async () => {
  await request("/vendor/shop/hours", {
    method: "POST",
    user: vendorA,
    form: { openingTime: "9:00", closingTime: "17:30" },
  });

  const stored = await Shop.findById(shopClosedHours._id).lean();
  assert.equal(stored.openingTime, "09:00");
  assert.equal(stored.closingTime, "17:30");
});

test("vendor invalid hours are rejected without writing", async () => {
  const before = await Shop.findById(shopClosedHours._id).lean();

  const cases = [
    { openingTime: "09:00", closingTime: "" },
    { openingTime: "", closingTime: "17:00" },
    { openingTime: "25:00", closingTime: "17:00" },
    { openingTime: "09:00", closingTime: "17:60" },
    { openingTime: "09:00", closingTime: "09:00" },
  ];

  for (const form of cases) {
    const res = await request("/vendor/shop/hours", {
      method: "POST",
      user: vendorA,
      form,
    });
    assert.equal(res.status, 302, JSON.stringify(form));
    assert.equal(res.headers.get("location"), "/vendor/menu");
    assert.equal(lastFlash.type, "error", JSON.stringify(form));
    const after = await Shop.findById(shopClosedHours._id).lean();
    assert.equal(after.openingTime, before.openingTime);
    assert.equal(after.closingTime, before.closingTime);
  }
});

test("vendor can clear hours by submitting both blank", async () => {
  await Shop.updateOne(
    { _id: shopClosedHours._id },
    { $set: { openingTime: "09:00", closingTime: "17:00" } },
  );

  const res = await request("/vendor/shop/hours", {
    method: "POST",
    user: vendorA,
    form: { openingTime: "", closingTime: "" },
  });

  assert.equal(res.status, 302);
  const stored = await Shop.findById(shopClosedHours._id).lean();
  assert.equal(stored.openingTime, "");
  assert.equal(stored.closingTime, "");
});

test("unauthenticated and student users cannot set hours", async () => {
  const before = await Shop.findById(shopClosedHours._id).lean();

  const anon = await request("/vendor/shop/hours", {
    method: "POST",
    user: null,
    form: { openingTime: "09:00", closingTime: "17:00" },
  });
  assert.equal(anon.status, 302);
  assert.equal(anon.headers.get("location"), "/login");

  const asStudent = await request("/vendor/shop/hours", {
    method: "POST",
    user: student,
    form: { openingTime: "09:00", closingTime: "17:00" },
  });
  assert.equal(asStudent.status, 302);
  assert.equal(asStudent.headers.get("location"), "/");

  const stored = await Shop.findById(shopClosedHours._id).lean();
  assert.equal(stored.openingTime, before.openingTime);
  assert.equal(stored.closingTime, before.closingTime);
});

test("vendor hours stay isolated to their own shop", async () => {
  await request("/vendor/shop/hours", {
    method: "POST",
    user: vendorA,
    form: { openingTime: "10:00", closingTime: "16:00" },
  });

  const mine = await Shop.findById(shopClosedHours._id).lean();
  const other = await Shop.findById(shopOpenHours._id).lean();
  assert.equal(mine.openingTime, "10:00");
  assert.equal(other.openingTime, shopOpenHours.openingTime);
});

test("vendor menu page renders the operating-hours form and hours summary", async () => {
  await Shop.updateOne(
    { _id: shopClosedHours._id },
    { $set: { openingTime: "08:00", closingTime: "20:00" } },
  );

  const res = await request("/vendor/menu", { user: vendorA, accept: "text/html" });
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.ok(html.includes('action="/vendor/shop/hours"'));
  assert.ok(html.includes('name="openingTime"'));
  assert.ok(html.includes('name="closingTime"'));
  assert.ok(html.includes('value="08:00"'));
  assert.ok(html.includes('value="20:00"'));
  assert.ok(html.includes("Operating hours:"));
});

// --- Student-facing behaviour ---------------------------------------------

test("shop page shows Closed outside hours even when manually open", async () => {
  const res = await request("/shops/night-canteen", { user: student, accept: "text/html" });
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.ok(html.includes("Closed"), "expected Closed badge outside hours");
  assert.ok(html.includes("Night Canteen"));
  assert.ok(html.includes("Closed"));
});

test("shop page shows Open within hours", async () => {
  const res = await request("/shops/morning-canteen", { user: student, accept: "text/html" });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("Morning Canteen"));
  // The availability badge with the ok modifier is rendered.
  assert.match(html, /tag--ok[^>]*>\s*Open/, html.slice(0, 4000));
});

test("shop list reflects hours-aware availability and shows the window", async () => {
  const res = await request("/shops", { user: student, accept: "text/html" });
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.ok(html.includes("Night Canteen"));
  assert.ok(html.includes("Closed"));
  assert.ok(html.includes("Morning Canteen"));
  // Format like "5:00 AM – 7:00 AM" is not asserted (clock-relative), but the
  // configured window label must not fall back to "Hours not set" for both.
  assert.ok(html.includes("Hours not set")); // the unconfigured All Day Canteen
});

test("add to cart is blocked while the shop is outside its hours", async () => {
  const res = await request("/cart/add", {
    method: "POST",
    user: student,
    form: { menuItemId: String(itemInClosedShop._id), quantity: "1" },
  });

  assert.equal(res.status, 302);
  assert.equal(lastFlash.type, "error");
  assert.match(lastFlash.message, /closed/i);
});

test("add to cart succeeds while the shop is within its hours", async () => {
  const item = await MenuItem.create({
    shop: shopOpenHours._id,
    name: "Idli",
    price: 30,
    available: true,
    variants: [{ label: "Regular", price: 30 }],
  });

  const res = await request("/cart/add", {
    method: "POST",
    user: student,
    form: { menuItemId: String(item._id), quantity: "1" },
  });

  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/shops/morning-canteen");
  assert.equal(lastFlash.type, "success");
  assert.match(lastFlash.message, /Added to cart/);
});

test("order initiation is rejected outside hours before any gateway call", async () => {
  seedCart = {
    shopId: String(shopClosedHours._id),
    items: [
      {
        menuItemId: String(itemInClosedShop._id),
        quantity: 1,
        variantId: 0,
        variantName: "Regular",
      },
    ],
  };

  const res = await request("/create-razorpay-order", {
    method: "POST",
    user: student,
    body: { orderType: "dinein" },
    accept: "application/json",
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /closed/i);
});

test("order initiation passes the hours gate and reaches the gateway check", async () => {
  const item = await MenuItem.create({
    shop: shopOpenHours._id,
    name: "Dosa",
    price: 50,
    available: true,
    variants: [{ label: "Regular", price: 50 }],
  });
  // Morning Canteen uses PhonePe, so the Razorpay route must reject it only
  // AFTER the availability gate — proving the shop was considered open.
  await Shop.updateOne({ _id: shopOpenHours._id }, { $set: { paymentGateway: "phonepe" } });

  seedCart = {
    shopId: String(shopOpenHours._id),
    items: [
      { menuItemId: String(item._id), quantity: 1, variantId: 0, variantName: "Regular" },
    ],
  };

  const res = await request("/create-razorpay-order", {
    method: "POST",
    user: student,
    body: { orderType: "dinein" },
    accept: "application/json",
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /not using Razorpay/i);
});

test("shops without configured hours keep the manual open/close behaviour", async () => {
  // Manually closed, no hours -> blocked.
  await Shop.updateOne({ _id: shopNoHours._id }, { $set: { isOpen: false } });
  const item = await MenuItem.create({
    shop: shopNoHours._id,
    name: "Tea",
    price: 10,
    available: true,
    variants: [{ label: "Regular", price: 10 }],
  });

  const blocked = await request("/cart/add", {
    method: "POST",
    user: student,
    form: { menuItemId: String(item._id), quantity: "1" },
  });
  assert.equal(blocked.status, 302);
  assert.match(lastFlash.message, /closed/i);

  // Manually opened, no hours -> allowed.
  await Shop.updateOne({ _id: shopNoHours._id }, { $set: { isOpen: true } });
  const allowed = await request("/cart/add", {
    method: "POST",
    user: student,
    form: { menuItemId: String(item._id), quantity: "1" },
  });
  assert.equal(allowed.status, 302);
  assert.equal(lastFlash.type, "success");
});

// --- Admin controls --------------------------------------------------------

test("admin shop form exposes the operating-hours fields", async () => {
  await Shop.updateOne(
    { _id: shopClosedHours._id },
    { $set: { openingTime: "08:00", closingTime: "20:00" } },
  );

  const res = await request(`/admin/shops/${shopClosedHours._id}/edit`, {
    user: adminUser,
    accept: "text/html",
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('name="openingTime"'));
  assert.ok(html.includes('name="closingTime"'));
  assert.ok(html.includes('value="08:00"'));
  assert.ok(html.includes('value="20:00"'));
});

test("admin can create a shop with operating hours", async () => {
  // Stub Cloudinary as configured so the upload middleware passes urlencoded
  // requests through to the handler (no file is sent).
  process.env.CLOUDINARY_CLOUD_NAME = "test";
  process.env.CLOUDINARY_API_KEY = "test";
  process.env.CLOUDINARY_API_SECRET = "test";

  const res = await request("/admin/shops", {
    method: "POST",
    user: adminUser,
    form: {
      name: "Admin Cafe",
      slug: "admin-cafe",
      description: "",
      isOpen: "open",
      openingTime: "10:00",
      closingTime: "18:00",
    },
  });

  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/admin/shops");

  const shop = await Shop.findOne({ slug: "admin-cafe" }).lean();
  assert.ok(shop, "shop should be created");
  assert.equal(shop.openingTime, "10:00");
  assert.equal(shop.closingTime, "18:00");
});

test("admin invalid hours are rejected and no shop is created", async () => {
  process.env.CLOUDINARY_CLOUD_NAME = "test";
  process.env.CLOUDINARY_API_KEY = "test";
  process.env.CLOUDINARY_API_SECRET = "test";

  const res = await request("/admin/shops", {
    method: "POST",
    user: adminUser,
    form: {
      name: "Bad Hours Cafe",
      slug: "bad-hours-cafe",
      isOpen: "open",
      openingTime: "09:00",
      closingTime: "09:00",
    },
  });

  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/admin/shops/new");
  const shop = await Shop.findOne({ slug: "bad-hours-cafe" }).lean();
  assert.equal(shop, null);
});

test("students cannot reach the admin shop form", async () => {
  const res = await request(`/admin/shops/${shopClosedHours._id}/edit`, {
    user: student,
    accept: "text/html",
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");
});
