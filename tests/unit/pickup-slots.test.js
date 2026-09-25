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
import { PickupSlotBooking } from "../../models/PickupSlotBooking.js";
import { shopsRouter } from "../../routes/shops.js";
import { cartRouter } from "../../routes/cart.js";
import { ordersRouter } from "../../routes/orders.js";
import { vendorRouter } from "../../routes/vendor.js";
import {
  validatePickupSlotSettings,
  generateSlotInstants,
  formatSlotLabel,
  resolvePickupSlot,
  reserveSlot,
  releaseSlot,
  reservePickupSlot,
  getSlotAvailability,
} from "../../utils/pickup-slots.js";
import {
  formatLocalDateTime,
  formatPickupTime,
  getPickupUrgency,
} from "../../utils/time.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "..", "views");

// 2026-09-20 13:00 IST.
const NOW = new Date("2026-09-20T07:30:00.000Z");

let mongo;
let server;
let baseUrl;

let vendorA;
let student;

let activeUser = null;
let currentUserId = null;
let seedCart = null;
let lastFlash = null;

// ---------------------------------------------------------------------------
// Configuration validation
// ---------------------------------------------------------------------------

test("validatePickupSlotSettings allows disabling without errors", () => {
  const off = validatePickupSlotSettings({ enabled: "false" });
  assert.equal(off.ok, true);
  assert.equal(off.settings.enabled, false);

  const off2 = validatePickupSlotSettings({});
  assert.equal(off2.ok, true);
  assert.equal(off2.settings.enabled, false);
});

test("validatePickupSlotSettings accepts and normalizes a valid configuration", () => {
  const result = validatePickupSlotSettings({
    enabled: "true",
    startTime: "9:00",
    endTime: "12:30",
    durationMinutes: "30",
    capacity: "20",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.settings, {
    enabled: true,
    startTime: "09:00",
    endTime: "12:30",
    durationMinutes: 30,
    capacity: 20,
  });
});

test("validatePickupSlotSettings ignores daysAhead (removed from F04)", () => {
  const result = validatePickupSlotSettings({
    enabled: "true",
    startTime: "09:00",
    endTime: "12:00",
    durationMinutes: "30",
    capacity: "10",
    daysAhead: "9",
  });
  assert.equal(result.ok, true);
  assert.ok(!("daysAhead" in result.settings), "daysAhead must not be stored");
});

test("validatePickupSlotSettings rejects bad windows, durations and capacities", () => {
  const base = {
    enabled: "true",
    startTime: "09:00",
    endTime: "12:00",
    durationMinutes: "30",
    capacity: "10",
  };

  assert.equal(validatePickupSlotSettings({ ...base, startTime: "" }).ok, false);
  assert.equal(validatePickupSlotSettings({ ...base, endTime: "nope" }).ok, false);
  assert.equal(validatePickupSlotSettings({ ...base, endTime: "08:00" }).ok, false);
  assert.equal(validatePickupSlotSettings({ ...base, endTime: "09:00" }).ok, false);
  assert.equal(validatePickupSlotSettings({ ...base, durationMinutes: "2" }).ok, false);
  assert.equal(validatePickupSlotSettings({ ...base, durationMinutes: "999" }).ok, false);
  assert.equal(validatePickupSlotSettings({ ...base, capacity: "0" }).ok, false);
  assert.equal(validatePickupSlotSettings({ ...base, capacity: "1000" }).ok, false);
  // Window shorter than one slot.
  assert.equal(
    validatePickupSlotSettings({ ...base, startTime: "09:00", endTime: "09:20", durationMinutes: "30" }).ok,
    false,
  );
});

// ---------------------------------------------------------------------------
// Generation + resolution
// ---------------------------------------------------------------------------

function settings(overrides = {}) {
  return {
    enabled: true,
    startTime: "12:00",
    endTime: "14:00",
    durationMinutes: 30,
    capacity: 2,
    ...overrides,
  };
}

test("generateSlotInstants splits the window into fixed-duration slots", () => {
  const slots = generateSlotInstants(settings(), NOW); // 13:00 IST -> only the 13:30 slot remains
  assert.equal(slots.length, 1);
  // 13:30 IST == 08:00Z
  assert.equal(slots[0].start.toISOString(), "2026-09-20T08:00:00.000Z");
  assert.equal(slots[0].end.toISOString(), "2026-09-20T08:30:00.000Z");
});

test("generateSlotInstants is today-only and never returns past slots", () => {
  // Window 09:00-11:00 IST is entirely past at NOW (13:00 IST) → no slots.
  const past = generateSlotInstants(
    settings({ startTime: "09:00", endTime: "11:00", durationMinutes: 30 }),
    NOW,
  );
  assert.deepEqual(past, []);

  // Window 18:00-20:00 IST is entirely future → all 4 same-day slots.
  const future = generateSlotInstants(
    settings({ startTime: "18:00", endTime: "20:00", durationMinutes: 30 }),
    NOW,
  );
  assert.deepEqual(
    future.map((s) => s.start.toISOString()),
    [
      "2026-09-20T12:30:00.000Z", // 18:00 IST
      "2026-09-20T13:00:00.000Z",
      "2026-09-20T13:30:00.000Z",
      "2026-09-20T14:00:00.000Z", // 19:30 IST
    ],
  );
});

test("generateSlotInstants ignores a legacy stored daysAhead value", () => {
  const slots = generateSlotInstants(
    settings({ startTime: "18:00", endTime: "20:00", durationMinutes: 30, daysAhead: 5 }),
    NOW,
  );
  assert.equal(slots.length, 4);
  assert.ok(slots.every((s) => s.start.toISOString().startsWith("2026-09-20")));
});

test("generateSlotInstants returns nothing for a disabled config", () => {
  assert.deepEqual(generateSlotInstants({ enabled: false }, NOW), []);
  assert.deepEqual(generateSlotInstants(null, NOW), []);
});

test("resolvePickupSlot accepts in-window times meeting prep, rejects the rest", () => {
  const shop = { _id: "s1", pickupSlots: settings() }; // 12:00-14:00 IST, prep 30

  const good = resolvePickupSlot(shop, "2026-09-20T08:00:00.000Z", NOW); // 13:30 IST
  assert.equal(good.ok, true);
  assert.equal(good.slot.start.toISOString(), "2026-09-20T08:00:00.000Z");

  // In-window time with prep satisfied is accepted even off the old grid.
  const wide = { _id: "s1", pickupSlots: settings({ endTime: "15:00" }) };
  assert.equal(resolvePickupSlot(wide, "2026-09-20T08:07:00.000Z", NOW).ok, true); // 13:37 IST
  assert.equal(resolvePickupSlot(shop, "2026-09-20T07:00:00.000Z", NOW).ok, false); // 12:30, prep violated
  assert.equal(resolvePickupSlot(shop, "2026-09-20T06:00:00.000Z", NOW).ok, false); // 11:30, outside window
  assert.equal(resolvePickupSlot(shop, "2026-09-20T08:45:00.000Z", NOW).ok, false); // 14:15, outside window
  assert.equal(resolvePickupSlot(shop, "2026-09-21T08:00:00.000Z", NOW).ok, false); // tomorrow, today-only
  assert.equal(resolvePickupSlot(shop, "not-a-date", NOW).ok, false);
  assert.equal(resolvePickupSlot({ pickupSlots: { enabled: false } }, "2026-09-20T08:00:00.000Z", NOW).ok, false);
});

test("formatSlotLabel renders IST times", () => {
  const label = formatSlotLabel(
    new Date("2026-09-20T08:00:00.000Z"),
    new Date("2026-09-20T08:30:00.000Z"),
    NOW,
  );
  assert.match(label, /1:30/);
  assert.match(label, /2:00/);
});

// ---------------------------------------------------------------------------
// Preparation-time enforcement (F04 finalization)
// ---------------------------------------------------------------------------
//
// The configured durationMinutes is the vendor's preparation time: the minimum
// lead time required before a pickup can begin. `generateSlotInstants` must
// never offer a slot that starts before `now + preparation time`.

test("prep-time: a slot starting exactly at now is never offered; now+prep is", () => {
  // Window 12:00-14:00 IST, 30-min slots, now = 13:00 IST.
  // Earliest valid slot begins at 13:30 IST (now + 30 prep).
  const slots = generateSlotInstants(settings(), NOW); // 13:00 IST
  const starts = slots.map((s) => s.start.toISOString());
  // 13:00 IST must NOT appear (slot that just began, no prep given).
  assert.ok(!starts.includes("2026-09-20T07:00:00.000Z"), "slot at now must be excluded");
  // 13:30 IST = 08:00Z must appear (now + prep).
  assert.ok(starts.includes("2026-09-20T08:00:00.000Z"), "slot at now+prep must be offered");
});

test("prep-time: example — current 9:28, prep 10 → first slot is 9:38, not 9:28", () => {
  // NOW = 2026-09-20T03:58:00Z = 09:28 IST.
  const now = new Date("2026-09-20T03:58:00.000Z");
  const slots = generateSlotInstants(
    settings({ startTime: "09:08", endTime: "10:08", durationMinutes: 10 }),
    now,
  );
  const starts = slots.map((s) => s.start.toISOString());
  // 09:38 IST = 04:08Z, 09:48 IST = 04:18Z, 09:58 IST = 04:28Z
  assert.deepEqual(starts, [
    "2026-09-20T04:08:00.000Z", // 09:38 IST — earliest valid (now + 10)
    "2026-09-20T04:18:00.000Z", // 09:48 IST
    "2026-09-20T04:28:00.000Z", // 09:58 IST
  ]);
});

test("prep-time: current time inside the window is NOT rounded to the old grid", () => {
  // NOW = 2026-09-20T04:03:00Z = 09:33 IST (off the 09:08-anchored grid).
  const now = new Date("2026-09-20T04:03:00.000Z");
  const slots = generateSlotInstants(
    settings({ startTime: "09:08", endTime: "10:08", durationMinutes: 10 }),
    now,
  );
  // Earliest valid = 09:43 IST exactly (now + 10); then 09:53 IST.
  assert.equal(slots.length, 2);
  assert.equal(slots[0].start.toISOString(), "2026-09-20T04:13:00.000Z"); // 09:43 IST
  assert.equal(slots[1].start.toISOString(), "2026-09-20T04:23:00.000Z"); // 09:53 IST
  assert.equal(slots[0].end.toISOString(), "2026-09-20T04:23:00.000Z");
});

test("prep-time: current time before the window still offers the whole window", () => {
  // NOW = 2026-09-20T04:30:00Z = 10:00 IST; window 18:00-20:00 is entirely future.
  const now = new Date("2026-09-20T04:30:00.000Z");
  const slots = generateSlotInstants(
    settings({ startTime: "18:00", endTime: "20:00", durationMinutes: 30 }),
    now,
  );
  // earliest = 10:30 IST, well before the first slot; all 4 slots offered.
  assert.equal(slots.length, 4);
  assert.equal(slots[0].start.toISOString(), "2026-09-20T12:30:00.000Z"); // 18:00 IST
  assert.equal(slots[3].start.toISOString(), "2026-09-20T14:00:00.000Z"); // 19:30 IST
});

test("slot-end boundary: a slot whose end would exceed endTime is not generated", () => {
  // Window 12:00-13:10 IST, 30-min slots → 12:00 (ends 12:30) and 12:30 (ends 13:00).
  // 13:00's slot would end 13:30 > 13:10, so it is excluded.
  const now = new Date("2026-09-20T04:30:00.000Z"); // 10:00 IST, before window
  const slots = generateSlotInstants(
    settings({ startTime: "12:00", endTime: "13:10", durationMinutes: 30 }),
    now,
  );
  assert.equal(slots.length, 2);
  assert.equal(slots[0].start.toISOString(), "2026-09-20T06:30:00.000Z"); // 12:00 IST
  assert.equal(slots[1].start.toISOString(), "2026-09-20T07:00:00.000Z"); // 12:30 IST
  assert.equal(slots[1].end.toISOString(), "2026-09-20T07:30:00.000Z"); // 13:00 IST
});

// ---------------------------------------------------------------------------
// Critical bug scenario: 11:20 PM must yield 11:30, not 11:40
// ---------------------------------------------------------------------------
// Window 22:30–23:59 IST (10:30 PM – 11:59 PM), preparation 10 minutes.

test("CRITICAL: at 11:20 PM the first slot is 11:30–11:40, not 11:40", () => {
  const now = new Date("2026-09-20T17:50:00.000Z"); // 23:20 IST
  const slots = generateSlotInstants(
    settings({ startTime: "22:30", endTime: "23:59", durationMinutes: 10 }),
    now,
  );
  const starts = slots.map((s) => s.start.toISOString());
  // 23:30 IST = 18:00Z, 23:40 IST = 18:10Z. (23:50 would end 24:00 > 23:59.)
  assert.deepEqual(starts, ["2026-09-20T18:00:00.000Z", "2026-09-20T18:10:00.000Z"]);
  assert.equal(slots[0].end.toISOString(), "2026-09-20T18:10:00.000Z");
});

test("CRITICAL: at 11:35 PM the first slot is 11:45–11:55", () => {
  const now = new Date("2026-09-20T18:05:00.000Z"); // 23:35 IST
  const slots = generateSlotInstants(
    settings({ startTime: "22:30", endTime: "23:59", durationMinutes: 10 }),
    now,
  );
  // Earliest = 23:45 IST exactly (now + 10), off the old 22:30 grid.
  assert.equal(slots.length, 1);
  assert.equal(slots[0].start.toISOString(), "2026-09-20T18:15:00.000Z"); // 23:45 IST
  assert.equal(slots[0].end.toISOString(), "2026-09-20T18:25:00.000Z"); // 23:55 IST
  // The old grid slot 23:40 IST must NOT be offered (only 5 min prep).
  assert.ok(!slots.some((s) => s.start.toISOString() === "2026-09-20T18:10:00.000Z"));
});

test("window start wins when now+prep falls before it (9:50 + 10 → 10:00)", () => {
  const now = new Date("2026-09-20T04:20:00.000Z"); // 09:50 IST
  const slots = generateSlotInstants(
    settings({ startTime: "10:00", endTime: "11:00", durationMinutes: 10 }),
    now,
  );
  assert.ok(slots.length > 0);
  assert.equal(slots[0].start.toISOString(), "2026-09-20T04:30:00.000Z"); // 10:00 IST
});

test("no grid wait when now+prep lands inside the window (9:55 + 10 → 10:05)", () => {
  const now = new Date("2026-09-20T04:25:00.000Z"); // 09:55 IST
  const slots = generateSlotInstants(
    settings({ startTime: "10:00", endTime: "11:00", durationMinutes: 10 }),
    now,
  );
  assert.ok(slots.length > 0);
  // Must be 10:05 IST, NOT 10:10 IST from the old window-start grid.
  assert.equal(slots[0].start.toISOString(), "2026-09-20T04:35:00.000Z"); // 10:05 IST
  assert.equal(slots[0].end.toISOString(), "2026-09-20T04:45:00.000Z"); // 10:15 IST
});

test("resolvePickupSlot rejects a too-early slot and accepts one at now+prep", () => {
  const now = new Date("2026-09-20T03:58:00.000Z"); // 09:28 IST
  const shop = {
    _id: "s1",
    pickupSlots: settings({ startTime: "09:08", endTime: "10:08", durationMinutes: 10 }),
  };
  // 09:28 IST = 03:58Z (slot at now) must be rejected.
  assert.equal(resolvePickupSlot(shop, "2026-09-20T03:58:00.000Z", now).ok, false);
  // 09:38 IST = 04:08Z (now + prep) must be accepted.
  const good = resolvePickupSlot(shop, "2026-09-20T04:08:00.000Z", now);
  assert.equal(good.ok, true);
  assert.equal(good.slot.start.toISOString(), "2026-09-20T04:08:00.000Z");
  // A slot two minutes before the prep bound (09:36 IST) is rejected.
  assert.equal(resolvePickupSlot(shop, "2026-09-20T04:06:00.000Z", now).ok, false);
});

test("resolvePickupSlot rejects an off-grid early slot even if inside the window", () => {
  // Window 10:30–23:59, prep 10, now 23:35 IST → earliest 23:45 IST.
  const now = new Date("2026-09-20T18:05:00.000Z");
  const shop = {
    _id: "s1",
    pickupSlots: settings({ startTime: "10:30", endTime: "23:59", durationMinutes: 10 }),
  };
  // Old grid slot 23:40 IST (only 5 min prep) must be rejected server-side.
  assert.equal(resolvePickupSlot(shop, "2026-09-20T18:10:00.000Z", now).ok, false);
  // Genuine first slot 23:45 IST accepted.
  assert.equal(resolvePickupSlot(shop, "2026-09-20T18:15:00.000Z", now).ok, true);
});

test("disabled slot config offers no slots even with a future window", () => {
  const now = new Date("2026-09-20T03:58:00.000Z");
  const slots = generateSlotInstants({ enabled: false, startTime: "09:00", endTime: "23:00", durationMinutes: 30 }, now);
  assert.deepEqual(slots, []);
});

// ---------------------------------------------------------------------------
// Capacity (needs the DB)
// ---------------------------------------------------------------------------

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

  app.use(shopsRouter);
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

let shopSlots; // slug "testing" (mock checkout), slots enabled
let shopNoSlots;
let itemSlots;

beforeEach(async () => {
  await Promise.all([
    Shop.deleteMany({}),
    User.deleteMany({}),
    MenuItem.deleteMany({}),
    Order.deleteMany({}),
    PickupSlotBooking.deleteMany({}),
  ]);
  activeUser = null;
  currentUserId = null;
  seedCart = null;
  lastFlash = null;

  shopSlots = await Shop.create({
    name: "Slot Canteen",
    slug: "testing",
    pickupSlots: {
      enabled: true,
      startTime: "00:00",
      endTime: "23:59",
      durationMinutes: 5,
      capacity: 2,
    },
  });
  shopNoSlots = await Shop.create({ name: "Plain Canteen", slug: "plain-canteen" });

  vendorA = await User.create({
    name: "Vendor A",
    email: "vendor.a@flashfoods.test",
    passwordHash: "hash",
    role: "vendor",
    phone: "9000000001",
    shop: shopSlots._id,
  });
  student = await User.create({
    name: "Student One",
    email: "student.one@flashfoods.test",
    passwordHash: "hash",
    role: "student",
    phone: "9000000003",
  });
  await Shop.updateOne({ _id: shopSlots._id }, { $set: { vendor: vendorA._id } });

  itemSlots = await MenuItem.create({
    shop: shopSlots._id,
    name: "Samosa",
    price: 20,
    available: true,
    variants: [{ label: "Regular", price: 20 }],
  });
});

function firstSlotIso(shop, now = new Date()) {
  const slots = generateSlotInstants(shop.pickupSlots, now);
  return slots[0] ? slots[0].start.toISOString() : null;
}

// ---------------------------------------------------------------------------
// Capacity + overbooking
// ---------------------------------------------------------------------------

test("reserveSlot enforces capacity and rejects overbooking", async () => {
  const slot = new Date("2026-09-21T08:00:00.000Z");

  const first = await reserveSlot(shopSlots._id, slot, 1);
  assert.equal(first.ok, true);

  const second = await reserveSlot(shopSlots._id, slot, 1);
  assert.equal(second.ok, false);
  assert.match(second.error, /full/i);

  const doc = await PickupSlotBooking.findOne({ shop: shopSlots._id, slotStart: slot }).lean();
  assert.equal(doc.booked, 1);
});

test("concurrent reservations never exceed capacity", async () => {
  const slot = new Date("2026-09-21T09:00:00.000Z");
  const capacity = 3;

  const results = await Promise.all(
    Array.from({ length: 10 }, () => reserveSlot(shopSlots._id, slot, capacity)),
  );
  const successes = results.filter((r) => r.ok).length;
  assert.equal(successes, capacity);

  const doc = await PickupSlotBooking.findOne({ shop: shopSlots._id, slotStart: slot }).lean();
  assert.equal(doc.booked, capacity);
});

test("releaseSlot frees a place and never goes negative", async () => {
  const slot = new Date("2026-09-21T10:00:00.000Z");

  await reserveSlot(shopSlots._id, slot, 1);
  await releaseSlot(shopSlots._id, slot);
  // Extra releases are harmless.
  await releaseSlot(shopSlots._id, slot);

  const doc = await PickupSlotBooking.findOne({ shop: shopSlots._id, slotStart: slot }).lean();
  assert.equal(doc.booked, 0);

  const again = await reserveSlot(shopSlots._id, slot, 1);
  assert.equal(again.ok, true);
});

test("getSlotAvailability reports live remaining capacity", async () => {
  const now = new Date("2026-09-20T07:30:00.000Z"); // 13:00 IST, fixed
  const slots = generateSlotInstants(shopSlots.pickupSlots, now);
  assert.ok(slots.length > 0);

  const first = slots[0];
  await reserveSlot(shopSlots._id, first.start, 2);

  const availability = await getSlotAvailability(shopSlots, now);
  assert.equal(availability.enabled, true);
  assert.equal(availability.capacity, 2);
  const firstAvail = availability.slots.find((s) => s.startIso === first.start.toISOString());
  assert.equal(firstAvail.booked, 1);
  assert.equal(firstAvail.remaining, 1);
  assert.equal(firstAvail.available, true);

  await reserveSlot(shopSlots._id, first.start, 2);
  const full = await getSlotAvailability(shopSlots, now);
  const fullSlot = full.slots.find((s) => s.startIso === first.start.toISOString());
  assert.equal(fullSlot.remaining, 0);
  assert.equal(fullSlot.available, false);
});

test("slots outside the shop's operating hours are rejected", async () => {
  await Shop.updateOne(
    { _id: shopSlots._id },
    { $set: { openingTime: "09:00", closingTime: "17:00" } },
  );
  const shop = await Shop.findById(shopSlots._id).lean();
  const now = new Date("2026-09-20T02:30:00.000Z"); // 08:00 IST, fixed
  const all = generateSlotInstants(shop.pickupSlots, now);
  const istMinutes = (date) => {
    const shifted = new Date(new Date(date).getTime() + 330 * 60000);
    return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  };
  const inside = all.find((s) => istMinutes(s.start) >= 540 && istMinutes(s.start) < 1020);
  const outside = all.find((s) => istMinutes(s.start) < 540);
  assert.ok(inside, "expected an in-hours slot");
  assert.ok(outside, "expected an out-of-hours slot");

  assert.equal(resolvePickupSlot(shop, inside.start.toISOString(), now).ok, true);
  assert.equal(resolvePickupSlot(shop, outside.start.toISOString(), now).ok, false);

  const availability = await getSlotAvailability(shop, now);
  assert.ok(availability.slots.length > 0);
  assert.ok(
    availability.slots.every((s) => istMinutes(s.startIso) >= 540 && istMinutes(s.startIso) < 1020),
    "availability must only expose in-hours slots",
  );
});

test("reservePickupSlot preserves free-form pickup time for shops without slots", async () => {
  const ok = await reservePickupSlot(shopNoSlots, "");
  assert.equal(ok.ok, true);
  assert.equal(ok.date, null);
  assert.equal(ok.reserved, false);

  const past = await reservePickupSlot(shopNoSlots, "2000-01-01T00:00:00.000Z");
  assert.equal(past.ok, false);
});

test("reservePickupSlot validates and reserves for slot shops", async () => {
  const shop = await Shop.findById(shopSlots._id).lean();
  const fixedNow = new Date("2026-09-20T07:30:00.000Z"); // 13:00 IST
  const iso = firstSlotIso(shop, fixedNow);
  assert.ok(iso);

  const good = await reservePickupSlot(shop, iso, fixedNow);
  assert.equal(good.ok, true);
  assert.equal(good.reserved, true);
  assert.equal(good.date.toISOString(), iso);

  const bad = await reservePickupSlot(shop, "2020-01-01T00:00:00.000Z", fixedNow);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /valid pickup slot/i);
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

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

test("vendor can configure pickup slots", async () => {
  const res = await request("/vendor/shop/pickup-slots", {
    method: "POST",
    user: vendorA,
    form: {
      enabled: "true",
      startTime: "09:00",
      endTime: "13:00",
      durationMinutes: "30",
      capacity: "5",
    },
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/vendor/menu");

  const shop = await Shop.findById(shopSlots._id).lean();
  assert.equal(shop.pickupSlots.enabled, true);
  assert.equal(shop.pickupSlots.startTime, "09:00");
  assert.equal(shop.pickupSlots.endTime, "13:00");
  assert.equal(shop.pickupSlots.durationMinutes, 30);
  assert.equal(shop.pickupSlots.capacity, 5);
});

test("vendor legacy daysAhead value is ignored, not validated", async () => {
  // daysAhead=9 was invalid under the old 0-7 range; it must now be ignored.
  const res = await request("/vendor/shop/pickup-slots", {
    method: "POST",
    user: vendorA,
    form: {
      enabled: "true",
      startTime: "09:00",
      endTime: "13:00",
      durationMinutes: "30",
      capacity: "5",
      daysAhead: "9",
    },
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/vendor/menu");
  const shop = await Shop.findById(shopSlots._id).lean();
  assert.equal(shop.pickupSlots.enabled, true);
});

test("vendor invalid slot configuration is rejected", async () => {
  const before = await Shop.findById(shopSlots._id).lean();
  const res = await request("/vendor/shop/pickup-slots", {
    method: "POST",
    user: vendorA,
    form: { enabled: "true", startTime: "12:00", endTime: "11:00", durationMinutes: "30", capacity: "5" },
  });
  assert.equal(res.status, 302);
  assert.equal(lastFlash.type, "error");
  const after = await Shop.findById(shopSlots._id).lean();
  assert.equal(after.pickupSlots.startTime, before.pickupSlots.startTime);
});

test("students cannot configure pickup slots", async () => {
  const res = await request("/vendor/shop/pickup-slots", {
    method: "POST",
    user: student,
    form: { enabled: "true", startTime: "09:00", endTime: "13:00", durationMinutes: "30", capacity: "5" },
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");
});

test("student cart page lists bookable slots", async () => {
  seedCart = {
    shopId: String(shopSlots._id),
    items: [{ menuItemId: String(itemSlots._id), quantity: 1, variantId: 0, variantName: "Regular" }],
  };
  const res = await request("/cart", { user: student, accept: "text/html" });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("Pickup Slot"));
  assert.ok(html.includes("slotsFromServer = true"));
});

test("mock checkout books a slot and enforces capacity end to end", async () => {
  const shop = await Shop.findById(shopSlots._id).lean();
  const iso = firstSlotIso(shop);
  assert.ok(iso);

  seedCart = {
    shopId: String(shopSlots._id),
    items: [{ menuItemId: String(itemSlots._id), quantity: 1, variantId: 0, variantName: "Regular" }],
  };

  // First order takes one of the two places.
  const first = await request("/orders/checkout", {
    method: "POST",
    user: student,
    form: { orderType: "dinein", pickupTime: iso },
  });
  assert.equal(first.status, 302);
  assert.match(first.headers.get("location"), /^\/orders\//);

  // Second order takes the last place.
  const second = await request("/orders/checkout", {
    method: "POST",
    user: student,
    form: { orderType: "dinein", pickupTime: iso },
  });
  assert.equal(second.status, 302);
  assert.match(second.headers.get("location"), /^\/orders\//);

  // Third order is overbooked.
  const third = await request("/orders/checkout", {
    method: "POST",
    user: student,
    form: { orderType: "dinein", pickupTime: iso },
  });
  assert.equal(third.status, 302);
  assert.equal(third.headers.get("location"), "/cart");
  assert.match(lastFlash.message, /full/i);

  const orders = await Order.countDocuments({ shop: shopSlots._id });
  assert.equal(orders, 2);
});

test("mock checkout rejects an invalid slot value", async () => {
  seedCart = {
    shopId: String(shopSlots._id),
    items: [{ menuItemId: String(itemSlots._id), quantity: 1, variantId: 0, variantName: "Regular" }],
  };
  const res = await request("/orders/checkout", {
    method: "POST",
    user: student,
    form: { orderType: "dinein", pickupTime: "2030-01-01T00:00:00.000Z" },
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/cart");
  assert.match(lastFlash.message, /valid pickup slot/i);
  assert.equal(await Order.countDocuments({ shop: shopSlots._id }), 0);
});

test("mock checkout rejects a manipulated too-early slot (prep violated)", async () => {
  // A slot 2 minutes out cannot satisfy the 15-minute preparation time.
  const early = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  seedCart = {
    shopId: String(shopSlots._id),
    items: [{ menuItemId: String(itemSlots._id), quantity: 1, variantId: 0, variantName: "Regular" }],
  };
  const res = await request("/orders/checkout", {
    method: "POST",
    user: student,
    form: { orderType: "dinein", pickupTime: early },
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/cart");
  assert.match(lastFlash.message, /valid pickup slot/i);
  assert.equal(await Order.countDocuments({ shop: shopSlots._id }), 0);
});

test("cancelling a paid order frees its slot place", async () => {
  const shop = await Shop.findById(shopSlots._id).lean();
  const iso = firstSlotIso(shop);
  seedCart = {
    shopId: String(shopSlots._id),
    items: [{ menuItemId: String(itemSlots._id), quantity: 1, variantId: 0, variantName: "Regular" }],
  };
  await request("/orders/checkout", { method: "POST", user: student, form: { orderType: "dinein", pickupTime: iso } });

  const booking = await PickupSlotBooking.findOne({
    shop: shopSlots._id,
    slotStart: new Date(iso),
  }).lean();
  assert.equal(booking.booked, 1);

  const order = await Order.findOne({ shop: shopSlots._id }).lean();
  const { cancelOrderPaid } = await import("../../utils/order-cancel.js");
  const result = await cancelOrderPaid({
    orderId: String(order._id),
    shopId: String(shopSlots._id),
    refundFn: async () => ({ id: "x" }),
  });
  assert.equal(result.ok, true);

  const after = await PickupSlotBooking.findOne({
    shop: shopSlots._id,
    slotStart: new Date(iso),
  }).lean();
  assert.equal(after.booked, 0);
});

test("vendor menu page renders the pickup-slot settings form", async () => {
  const res = await request("/vendor/menu", { user: vendorA, accept: "text/html" });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('action="/vendor/shop/pickup-slots"'));
  assert.ok(html.includes('name="durationMinutes"'));
  assert.ok(html.includes('name="capacity"'));
  assert.ok(html.includes("Preparation Time (minutes)"));
  assert.ok(!html.includes("Days ahead"), "daysAhead control must be gone");
  assert.ok(!html.includes('name="daysAhead"'), "daysAhead input must be gone");
  assert.ok(!html.includes("Duration (minutes)"), "old label must be gone");
});
