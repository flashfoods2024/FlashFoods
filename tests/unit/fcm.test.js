import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import session from "express-session";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import { Shop } from "../../models/Shop.js";
import { User } from "../../models/User.js";
import { Order } from "../../models/Order.js";
import { FcmToken } from "../../models/FcmToken.js";
import { fcmRouter } from "../../routes/api/fcm.js";
import {
  buildNewOrderNotification,
  extractInvalidTokens,
  sendWithRetry,
} from "../../utils/notification-dispatch.js";
import { countPendingOrders, emitPendingCount } from "../../socket/index.js";

// ---------------------------------------------------------------------------
// Payload building (pure) — vendor targeting + duplicate prevention
// ---------------------------------------------------------------------------

test("buildNewOrderNotification targets the shop's vendor and collapses duplicates", () => {
  const order = { _id: "order-1", total: 250, items: [{}, {}, {}] };

  const first = buildNewOrderNotification(order, "vendor-1");
  const second = buildNewOrderNotification(order, "vendor-1");

  assert.equal(first.notification.title, "New Order");
  assert.match(first.notification.body, /250/);
  assert.match(first.notification.body, /3 item/);

  // Vendor targeting: the data carries only the owning vendor's id.
  assert.equal(first.data.vendorId, "vendor-1");
  assert.equal(first.data.orderId, "order-1");
  assert.equal(first.data.click_action, "/vendor/orders/pending");

  // Duplicate prevention: the tag is stable per order, so a repeat delivery of
  // the same order collapses into a single system notification.
  assert.equal(first.data.tag, "flashfoods-new-order-order-1");
  assert.equal(first.data.tag, second.data.tag);
});

test("different orders produce different tags", () => {
  const a = buildNewOrderNotification({ _id: "a", total: 1, items: [] }, "v");
  const b = buildNewOrderNotification({ _id: "b", total: 1, items: [] }, "v");
  assert.notEqual(a.data.tag, b.data.tag);
});

test("extractInvalidTokens classifies redundant/unknown token errors", () => {
  const response = {
    responses: [
      { success: false, error: { code: "messaging/registration-token-not-registered" } },
      { success: false, error: { code: "messaging/invalid-registration-token" } },
      { success: false, error: { code: "messaging/internal-error" } },
    ],
  };
  assert.deepEqual(extractInvalidTokens(response, ["a", "b", "c"]), ["a", "b"]);
});

// ---------------------------------------------------------------------------
// Routes + dispatch (needs the DB)
// ---------------------------------------------------------------------------

let mongo;
let server;
let baseUrl;

let vendorA;
let vendorB;
let student;
let shopA;

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-secret", resave: false, saveUninitialized: false }));
  // Authenticate by injecting the acting user into the session from a test
  // header, and stub connect-flash used by the auth guards on redirect paths.
  app.use((req, _res, next) => {
    const actingUser = req.get("x-test-user");
    if (actingUser) req.session.userId = actingUser;
    req.flash = () => [];
    next();
  });
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
  await Promise.all([Shop.deleteMany({}), User.deleteMany({}), Order.deleteMany({}), FcmToken.deleteMany({})]);

  shopA = await Shop.create({ name: "Shop A", slug: "shop-a" });
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
  });
  student = await User.create({
    name: "Student",
    email: "student@flashfoods.test",
    passwordHash: "hash",
    role: "student",
  });
});

// The FCM router requires an authenticated vendor session; the `x-test-user`
// header is translated into the session id by the middleware above.
async function fcmRequest(pathname, { method = "POST", as = null, body } = {}) {
  const init = {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    redirect: "manual",
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (as) init.headers["x-test-user"] = String(as._id);
  return fetch(`${baseUrl}${pathname}`, init);
}

test("vendor can register a device token", async () => {
  const res = await fcmRequest("/api/fcm/register", {
    as: vendorA,
    body: { token: "token-a", deviceInfo: "Chrome" },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true });

  const tokens = await FcmToken.find({ vendorId: vendorA._id }).lean();
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].token, "token-a");
});

test("re-registering refreshes the same token without duplicating it", async () => {
  await fcmRequest("/api/fcm/register", { as: vendorA, body: { token: "token-a", deviceInfo: "old" } });
  const res = await fcmRequest("/api/fcm/register", {
    as: vendorA,
    body: { token: "token-a", deviceInfo: "new-agent" },
  });
  assert.equal(res.status, 200);

  const tokens = await FcmToken.find({ vendorId: vendorA._id }).lean();
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].deviceInfo, "new-agent");
});

test("re-registering refreshes lastSeenAt and clears strikes (self-heal)", async () => {
  const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  await FcmToken.create({
    vendorId: vendorA._id,
    token: "stale-but-alive",
    lastSeenAt: old,
    failCount: 2,
    lastFailureAt: old,
  });
  const res = await fcmRequest("/api/fcm/register", {
    as: vendorA,
    body: { token: "stale-but-alive", deviceInfo: "Chrome" },
  });
  assert.equal(res.status, 200);

  const tokens = await FcmToken.find({ token: "stale-but-alive" }).lean();
  assert.equal(tokens.length, 1, "idempotent upsert keyed on token");
  assert.equal(tokens[0].failCount, 0, "fresh registration proves aliveness");
  assert.equal(tokens[0].lastFailureAt, null);
  assert.ok(
    new Date(tokens[0].lastSeenAt).getTime() > old.getTime(),
    "lastSeenAt refreshed on every app open",
  );
});

test("pruneStaleTokens removes only long-unseen 3+ strike tokens", async () => {
  const ancient = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000);
  await FcmToken.create({ vendorId: vendorA._id, token: "dead", failCount: 3, lastSeenAt: ancient });
  await FcmToken.create({ vendorId: vendorA._id, token: "old-but-clean", failCount: 0, lastSeenAt: ancient });
  await FcmToken.create({ vendorId: vendorA._id, token: "recent-strikes", failCount: 5, lastSeenAt: new Date() });

  const { pruneStaleTokens } = await import("../../utils/notification-dispatch.js");
  assert.equal(await pruneStaleTokens(), 1);
  assert.equal(await FcmToken.countDocuments({ token: "dead" }), 0);
  assert.equal(await FcmToken.countDocuments({ token: "old-but-clean" }), 1);
  assert.equal(await FcmToken.countDocuments({ token: "recent-strikes" }), 1);
});

test("a token registered to another vendor cannot be hijacked", async () => {
  await fcmRequest("/api/fcm/register", { as: vendorA, body: { token: "shared" } });
  const res = await fcmRequest("/api/fcm/register", { as: vendorB, body: { token: "shared" } });
  assert.equal(res.status, 409);

  const tokens = await FcmToken.find({ token: "shared" }).lean();
  assert.equal(tokens.length, 1);
  assert.equal(String(tokens[0].vendorId), String(vendorA._id));
});

test("unregister removes only the caller's own token", async () => {
  await fcmRequest("/api/fcm/register", { as: vendorA, body: { token: "shared" } });

  // Another vendor cannot delete it.
  await fcmRequest("/api/fcm/unregister", { as: vendorB, body: { token: "shared" } });
  assert.equal(await FcmToken.countDocuments({ token: "shared" }), 1);

  // The owner can.
  await fcmRequest("/api/fcm/unregister", { as: vendorA, body: { token: "shared" } });
  assert.equal(await FcmToken.countDocuments({ token: "shared" }), 0);
});

test("register rejects missing tokens and unauthenticated users", async () => {
  const missing = await fcmRequest("/api/fcm/register", { as: vendorA, body: {} });
  assert.equal(missing.status, 400);

  const anon = await fcmRequest("/api/fcm/register", { body: { token: "x" } });
  assert.equal(anon.status, 302);

  const asStudent = await fcmRequest("/api/fcm/register", { as: student, body: { token: "x" } });
  assert.equal(asStudent.status, 302);
});

test("a single permanent failure does NOT delete the token (strike 1 of 3)", async () => {
  await FcmToken.create({ vendorId: vendorA._id, token: "good" });
  await FcmToken.create({ vendorId: vendorA._id, token: "gone" });

  let calls = 0;
  const messaging = {
    async sendEachForMulticast() {
      calls++;
      return {
        successCount: 1,
        failureCount: 1,
        responses: [
          { success: true },
          { success: false, error: { code: "messaging/registration-token-not-registered" } },
        ],
      };
    },
  };

  await sendWithRetry(
    ["good", "gone"],
    { title: "New Order", body: "₹100 — 1 item(s)", icon: "/icons/i.png" },
    { tag: "t", click_action: "/vendor/orders/pending" },
    0,
    messaging,
  );

  assert.equal(calls, 1, "a strike-only failure must not be retried");
  assert.equal(await FcmToken.countDocuments({ token: "gone" }), 1, "kept after 1 strike");
  assert.equal(await FcmToken.countDocuments({ token: "good" }), 1);
  const struck = await FcmToken.findOne({ token: "gone" }).lean();
  assert.equal(struck.failCount, 1);
  assert.ok(struck.lastFailureAt);
});

test("three permanent failures delete the token (strike 3 of 3)", async () => {
  await FcmToken.create({ vendorId: vendorA._id, token: "doomed", failCount: 2 });

  const messaging = {
    async sendEachForMulticast() {
      return {
        successCount: 0,
        failureCount: 1,
        responses: [
          { success: false, error: { code: "messaging/registration-token-not-registered" } },
        ],
      };
    },
  };

  await sendWithRetry(
    ["doomed"],
    { title: "New Order", body: "₹100 — 1 item(s)", icon: "/icons/i.png" },
    { tag: "t", click_action: "/vendor/orders/pending" },
    0,
    messaging,
  );

  assert.equal(await FcmToken.countDocuments({ token: "doomed" }), 0, "removed on 3rd strike");
});

test("a successful send clears strikes and refreshes lastSeenAt", async () => {
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await FcmToken.create({
    vendorId: vendorA._id,
    token: "healed",
    failCount: 2,
    lastFailureAt: old,
    lastSeenAt: old,
  });

  const messaging = {
    async sendEachForMulticast() {
      return { successCount: 1, failureCount: 0, responses: [{ success: true }] };
    },
  };

  await sendWithRetry(
    ["healed"],
    { title: "New Order", body: "₹100 — 1 item(s)", icon: "/icons/i.png" },
    { tag: "t", click_action: "/vendor/orders/pending" },
    0,
    messaging,
  );

  const after = await FcmToken.findOne({ token: "healed" }).lean();
  assert.ok(after, "live token is kept");
  assert.equal(after.failCount, 0);
  assert.equal(after.lastFailureAt, null);
  assert.ok(new Date(after.lastSeenAt).getTime() > old.getTime(), "lastSeenAt refreshed");
});

// ---------------------------------------------------------------------------
// Socket.IO behaviour preserved
// ---------------------------------------------------------------------------

test("countPendingOrders counts only paid orders for the given shop", async () => {
  const otherShop = await Shop.create({ name: "Shop B", slug: "shop-b" });
  const base = {
    customer: student._id,
    items: [{ name: "X", price: 10, quantity: 1 }],
    total: 10,
    pickupOtp: "123456",
  };
  await Order.create({ ...base, shop: shopA._id, status: "paid" });
  await Order.create({ ...base, shop: shopA._id, status: "paid" });
  await Order.create({ ...base, shop: shopA._id, status: "accepted" });
  await Order.create({ ...base, shop: shopA._id, status: "completed" });
  await Order.create({ ...base, shop: otherShop._id, status: "paid" });

  assert.equal(await countPendingOrders(shopA._id), 2);
  assert.equal(await countPendingOrders(otherShop._id), 1);
});

test("emitPendingCount is a safe no-op before the socket server is initialized", async () => {
  await assert.doesNotReject(() => emitPendingCount(shopA._id));
});
