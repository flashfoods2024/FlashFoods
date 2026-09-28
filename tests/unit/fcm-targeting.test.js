import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import { Shop } from "../../models/Shop.js";
import { User } from "../../models/User.js";
import { Order } from "../../models/Order.js";
import { FcmToken } from "../../models/FcmToken.js";
import { dispatchNewOrderNotification } from "../../utils/notification-dispatch.js";

// Proves new-order push is targeted: with 3 vendors holding 1 token each,
// an order for vendor A's shop sends ONLY to vendor A's token. A broadcast
// (all tokens) would deliver other vendors' orders to the wrong devices.
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

async function makeVendorShop(suffix) {
  const shop = await Shop.create({ name: `Shop ${suffix}`, slug: `shop-${suffix}` });
  const vendor = await User.create({
    name: `Vendor ${suffix}`,
    email: `v-${suffix}@flashfoods.test`,
    passwordHash: "h",
    role: "vendor",
    shop: shop._id,
  });
  await Shop.updateOne({ _id: shop._id }, { $set: { vendor: vendor._id } });
  const token = `token-${suffix}`;
  await FcmToken.create({ vendorId: vendor._id, token });
  return { shop, vendor, token };
}

test("new-order push goes only to the order vendor's token", async () => {
  const a = await makeVendorShop("a");
  const b = await makeVendorShop("b");
  const c = await makeVendorShop("c");
  const student = await User.create({
    name: "Student",
    email: "s@flashfoods.test",
    passwordHash: "h",
    role: "student",
  });
  const order = await Order.create({
    customer: student._id,
    shop: a.shop._id,
    items: [{ name: "Meal", price: 100, quantity: 1 }],
    total: 100,
    pickupOtp: "123456",
    status: "paid",
  });

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

  await dispatchNewOrderNotification(order, messaging);

  assert.equal(sends.length, 1, "exactly one multicast send per order");
  assert.deepEqual(sends[0].tokens, [a.token], "only vendor A's token is targeted");
  assert.ok(!sends[0].tokens.includes(b.token), "vendor B token must not receive");
  assert.ok(!sends[0].tokens.includes(c.token), "vendor C token must not receive");

  // No other vendor's registration is disturbed.
  assert.equal(await FcmToken.countDocuments({}), 3);
});
