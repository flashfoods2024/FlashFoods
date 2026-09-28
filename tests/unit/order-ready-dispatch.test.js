import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import { Shop } from "../../models/Shop.js";
import { User } from "../../models/User.js";
import { Order } from "../../models/Order.js";
import { FcmToken } from "../../models/FcmToken.js";
import { dispatchOrderReadyNotification } from "../../utils/notification-dispatch.js";

// The order-ready path must send to the ordering STUDENT's tokens only,
// resolve gracefully with no token, and be unaffected by the sendWithRetry
// refactor (which only added a return summary — behavior identical).
let mongo;

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  await Promise.all([
    Shop.deleteMany({}),
    User.deleteMany({}),
    Order.deleteMany({}),
    FcmToken.deleteMany({}),
  ]);
});

async function makeShopStudent() {
  const shop = await Shop.create({ name: "Shop", slug: "shop-ready" });
  const vendor = await User.create({
    name: "Vendor",
    email: "v-ready@flashfoods.test",
    passwordHash: "h",
    role: "vendor",
    shop: shop._id,
  });
  await Shop.updateOne({ _id: shop._id }, { $set: { vendor: vendor._id } });
  const student = await User.create({
    name: "Student",
    email: "s-ready@flashfoods.test",
    passwordHash: "h",
    role: "student",
  });
  const order = await Order.create({
    customer: student._id,
    shop: shop._id,
    items: [{ name: "Meal", price: 100, quantity: 1 }],
    total: 100,
    pickupOtp: "123456",
    status: "ready_for_pickup",
  });
  return { shop, vendor, student, order };
}

test("student token + Ready → dispatch sends to the student token (1/0)", async () => {
  const { student, order } = await makeShopStudent();
  await FcmToken.create({ customerId: student._id, token: "student-token-1" });

  const sends = [];
  const messaging = {
    async sendEachForMulticast(payload) {
      sends.push(payload);
      return {
        successCount: payload.tokens.length,
        failureCount: 0,
        responses: payload.tokens.map(() => ({ success: true })),
      };
    },
  };

  await dispatchOrderReadyNotification(order, messaging);

  assert.equal(sends.length, 1, "exactly one multicast send");
  assert.deepEqual(sends[0].tokens, ["student-token-1"]);
  assert.ok(
    (sends[0].notification.title || "").includes("Ready"),
    "student payload must be the order-ready card",
  );
});

test("student with no token → dispatch resolves gracefully, no send", async () => {
  const { order } = await makeShopStudent();

  let calls = 0;
  const messaging = {
    async sendEachForMulticast(payload) {
      calls++;
      return {
        successCount: payload.tokens.length,
        failureCount: 0,
        responses: payload.tokens.map(() => ({ success: true })),
      };
    },
  };

  await assert.doesNotReject(() => dispatchOrderReadyNotification(order, messaging));
  assert.equal(calls, 0, "no send without a student token");
});

test("sendWithRetry refactor is neutral for order-ready (counts propagate, vendor tokens untouched)", async () => {
  const { student, order } = await makeShopStudent();
  await FcmToken.create({ customerId: student._id, token: "student-token-1" });
  // A vendor token must never be picked up by the student path.
  const otherVendor = await User.create({
    name: "Other",
    email: "o-ready@flashfoods.test",
    passwordHash: "h",
    role: "vendor",
  });
  await FcmToken.create({ vendorId: otherVendor._id, token: "vendor-token-1" });

  const sends = [];
  const messaging = {
    async sendEachForMulticast(payload) {
      sends.push(payload);
      return {
        successCount: payload.tokens.length,
        failureCount: 0,
        responses: payload.tokens.map(() => ({ success: true })),
      };
    },
  };

  await dispatchOrderReadyNotification(order, messaging);

  assert.equal(sends.length, 1);
  assert.deepEqual(sends[0].tokens, ["student-token-1"]);
  assert.equal(await FcmToken.countDocuments({}), 2, "no token pruned on success");
});
