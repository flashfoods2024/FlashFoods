import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import session from "express-session";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import { Shop } from "../../models/Shop.js";
import { User } from "../../models/User.js";
import { FcmToken } from "../../models/FcmToken.js";
import { fcmRouter } from "../../routes/api/fcm.js";
import {
  buildOrderReadyNotification,
  dispatchOrderReadyNotification,
  findStudentTokens,
} from "../../utils/notification-dispatch.js";

// ---------------------------------------------------------------------------
// F06.5 — Student Order Ready Notification
// ---------------------------------------------------------------------------

test("buildOrderReadyNotification targets the order page with a stable dedupe tag", () => {
  const order = { _id: "order-1", shop: "shop-1" };

  const first = buildOrderReadyNotification(order, "Hummusery");
  const second = buildOrderReadyNotification(order, "Hummusery");

  assert.equal(first.notification.title, "Order Ready");
  assert.match(first.notification.body, /Hummusery/);
  assert.match(first.notification.body, /ready for pickup/);

  // Tap opens the correct order page.
  assert.equal(first.data.click_action, "/orders/order-1");
  assert.equal(first.data.url, "/orders/order-1");

  // Future-safe metadata.
  assert.equal(first.data.type, "order_ready");
  assert.equal(first.data.orderId, "order-1");
  assert.equal(first.data.shopId, "shop-1");
  assert.equal(first.data.shopName, "Hummusery");

  // Dedupe: stable per order, so repeats collapse instead of stacking.
  assert.equal(first.data.tag, "order-ready-order-1");
  assert.equal(first.data.tag, second.data.tag);
});

test("different orders produce different tags", () => {
  const a = buildOrderReadyNotification({ _id: "a", shop: "s" }, "Shop");
  const b = buildOrderReadyNotification({ _id: "b", shop: "s" }, "Shop");
  assert.notEqual(a.data.tag, b.data.tag);
});

test("missing shop name falls back to a generic body", () => {
  const payload = buildOrderReadyNotification({ _id: "o", shop: "s" }, null);
  assert.equal(payload.notification.body, "Your order is ready for pickup.");
  assert.equal(payload.data.shopName, "");
});

// ---------------------------------------------------------------------------
// Routes + dispatch (needs the DB)
// ---------------------------------------------------------------------------

let mongo;
let server;
let baseUrl;

let studentA;
let studentB;
let vendorA;
let shopA;

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-secret", resave: false, saveUninitialized: false }));
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
  await Promise.all([Shop.deleteMany({}), User.deleteMany({}), FcmToken.deleteMany({})]);

  shopA = await Shop.create({ name: "Shop A", slug: "shop-a" });
  studentA = await User.create({
    name: "Student A",
    email: "student.a@flashfoods.test",
    passwordHash: "hash",
    role: "student",
  });
  studentB = await User.create({
    name: "Student B",
    email: "student.b@flashfoods.test",
    passwordHash: "hash",
    role: "student",
  });
  vendorA = await User.create({
    name: "Vendor A",
    email: "vendor.a@flashfoods.test",
    passwordHash: "hash",
    role: "vendor",
    shop: shopA._id,
  });
});

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

test("student can register a device token under their own customerId", async () => {
  const res = await fcmRequest("/api/fcm/student/register", {
    as: studentA,
    body: { token: "student-token-a", deviceInfo: "Chrome" },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { success: true });

  const tokens = await FcmToken.find({ customerId: studentA._id }).lean();
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].token, "student-token-a");
});

test("student re-register refreshes without duplicating", async () => {
  await fcmRequest("/api/fcm/student/register", { as: studentA, body: { token: "t", deviceInfo: "old" } });
  const res = await fcmRequest("/api/fcm/student/register", {
    as: studentA,
    body: { token: "t", deviceInfo: "new-agent" },
  });
  assert.equal(res.status, 200);

  const tokens = await FcmToken.find({ customerId: studentA._id }).lean();
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].deviceInfo, "new-agent");
});

test("a student token cannot be hijacked by another student", async () => {
  await fcmRequest("/api/fcm/student/register", { as: studentA, body: { token: "shared" } });
  const res = await fcmRequest("/api/fcm/student/register", { as: studentB, body: { token: "shared" } });
  assert.equal(res.status, 409);

  const tokens = await FcmToken.find({ token: "shared" }).lean();
  assert.equal(tokens.length, 1);
  assert.equal(String(tokens[0].customerId), String(studentA._id));
});

test("tokens cannot leak across roles", async () => {
  // Vendor endpoint cannot claim a student-held token.
  await fcmRequest("/api/fcm/student/register", { as: studentA, body: { token: "cross" } });
  const vendorClaim = await fcmRequest("/api/fcm/register", { as: vendorA, body: { token: "cross" } });
  assert.equal(vendorClaim.status, 409);

  // Student endpoint cannot claim a vendor-held token.
  await fcmRequest("/api/fcm/register", { as: vendorA, body: { token: "vendor-only" } });
  const studentClaim = await fcmRequest("/api/fcm/student/register", {
    as: studentB,
    body: { token: "vendor-only" },
  });
  assert.equal(studentClaim.status, 409);
});

test("student unregister removes only the caller's own token", async () => {
  await fcmRequest("/api/fcm/student/register", { as: studentA, body: { token: "mine" } });

  await fcmRequest("/api/fcm/student/unregister", { as: studentB, body: { token: "mine" } });
  assert.equal(await FcmToken.countDocuments({ token: "mine" }), 1);

  await fcmRequest("/api/fcm/student/unregister", { as: studentA, body: { token: "mine" } });
  assert.equal(await FcmToken.countDocuments({ token: "mine" }), 0);
});

test("role guards: students cannot use vendor endpoints and vice versa", async () => {
  const studentOnVendor = await fcmRequest("/api/fcm/register", { as: studentA, body: { token: "x" } });
  assert.equal(studentOnVendor.status, 302);

  const vendorOnStudent = await fcmRequest("/api/fcm/student/register", {
    as: vendorA,
    body: { token: "x" },
  });
  assert.equal(vendorOnStudent.status, 302);

  const anon = await fcmRequest("/api/fcm/student/register", { body: { token: "x" } });
  assert.equal(anon.status, 302);

  const missing = await fcmRequest("/api/fcm/student/register", { as: studentA, body: {} });
  assert.equal(missing.status, 400);
});

test("findStudentTokens returns only the ordering student's tokens", async () => {
  await FcmToken.create({ customerId: studentA._id, token: "a1" });
  await FcmToken.create({ customerId: studentA._id, token: "a2" });
  await FcmToken.create({ customerId: studentB._id, token: "b1" });
  await FcmToken.create({ vendorId: vendorA._id, token: "v1" });

  const tokens = await findStudentTokens(studentA._id);
  assert.deepEqual(
    tokens.map((t) => t.token).sort(),
    ["a1", "a2"],
  );
});

test("dispatch notifies only the ordering student with WhatsApp-style options", async () => {
  await FcmToken.create({ customerId: studentA._id, token: "a-token" });
  await FcmToken.create({ customerId: studentB._id, token: "b-token" });
  await FcmToken.create({ vendorId: vendorA._id, token: "v-token" });

  const sent = [];
  const messaging = {
    async sendEachForMulticast(message) {
      sent.push(message);
      return {
        successCount: message.tokens.length,
        failureCount: 0,
        responses: message.tokens.map(() => ({ success: true })),
      };
    },
  };

  const order = {
    _id: new mongoose.Types.ObjectId(),
    shop: shopA._id,
    customer: studentA._id,
    total: 120,
  };
  await dispatchOrderReadyNotification(order, messaging);

  assert.equal(sent.length, 1, "exactly one multicast send");
  assert.deepEqual(sent[0].tokens, ["a-token"], "no cross-student or vendor leakage");
  assert.equal(sent[0].notification.title, "Order Ready");
  assert.equal(sent[0].data.type, "order_ready");
  assert.equal(sent[0].data.orderId, String(order._id));
  assert.equal(sent[0].data.shopId, String(shopA._id));
  assert.equal(sent[0].data.shopName, "Shop A");
  assert.equal(sent[0].data.click_action, `/orders/${String(order._id)}`);
  assert.equal(sent[0].data.tag, `order-ready-${String(order._id)}`);
  // WhatsApp-style: single ping, auto-dismiss, no stacking.
  assert.equal(sent[0].webpush.notification.requireInteraction, false);
  assert.equal(sent[0].webpush.notification.renotify, false);
});

test("dispatch is a safe no-op without tokens or customer", async () => {
  let calls = 0;
  const messaging = {
    async sendEachForMulticast() {
      calls++;
      return { successCount: 0, failureCount: 0, responses: [] };
    },
  };

  // No tokens registered at all.
  await dispatchOrderReadyNotification(
    { _id: new mongoose.Types.ObjectId(), shop: shopA._id, customer: studentA._id },
    messaging,
  );
  assert.equal(calls, 0);

  // Order with no customer never notifies.
  await dispatchOrderReadyNotification({ _id: new mongoose.Types.ObjectId(), shop: shopA._id }, messaging);
  assert.equal(calls, 0);
});
