import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import { Order } from "../../models/Order.js";
import { cancelOrderPaid } from "../../utils/order-cancel.js";

let mongo;
let shopId;

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

beforeEach(async () => {
  await Order.deleteMany({});
  shopId = new mongoose.Types.ObjectId();
});

async function mkPaidOrder(overrides = {}) {
  return Order.create({
    customer: new mongoose.Types.ObjectId(),
    shop: shopId,
    items: [{ name: "A", price: 100, quantity: 1 }],
    total: 100,
    pickupOtp: "123456",
    status: "paid",
    paymentNote: "razorpay",
    razorpayPaymentId: "pay_abc",
    amountChargedPaise: 10000,
    refundStatus: "none",
    ...overrides,
  });
}

test("duplicate concurrent cancels trigger exactly one refund", async () => {
  const order = await mkPaidOrder();
  let refundCalls = 0;
  const refundFn = async () => {
    refundCalls++;
    await new Promise((r) => setTimeout(r, 25)); // widen the race window
    return { id: "rfnd_1" };
  };

  const [a, b] = await Promise.all([
    cancelOrderPaid({ orderId: String(order._id), shopId: String(shopId), refundFn }),
    cancelOrderPaid({ orderId: String(order._id), shopId: String(shopId), refundFn }),
  ]);

  const oks = [a, b].filter((r) => r.ok);
  assert.equal(oks.length, 1, "exactly one cancel should win the claim");
  assert.equal(refundCalls, 1, "the gateway must be called exactly once");

  const doc = await Order.findById(order._id).lean();
  assert.equal(doc.status, "cancelled");
  assert.equal(doc.refundStatus, "completed");
  assert.equal(doc.refundId, "rfnd_1");
  assert.ok(doc.refundProcessedAt instanceof Date);
});

test("a failed refund is not automatically retried (manual reconciliation)", async () => {
  const order = await mkPaidOrder();
  let refundCalls = 0;
  const refundFn = async () => {
    refundCalls++;
    throw new Error("gateway down");
  };

  const first = await cancelOrderPaid({
    orderId: String(order._id),
    shopId: String(shopId),
    refundFn,
  });
  assert.equal(first.ok, false);
  assert.equal(first.reason, "refund_failed");

  // A retry must NOT reach the gateway again.
  const second = await cancelOrderPaid({
    orderId: String(order._id),
    shopId: String(shopId),
    refundFn,
  });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "conflict");
  assert.equal(refundCalls, 1, "failed refund must not be retried automatically");

  const doc = await Order.findById(order._id).lean();
  assert.equal(doc.status, "paid");
  assert.equal(doc.refundStatus, "failed");
});

test("mock orders cancel without touching a gateway", async () => {
  const order = await mkPaidOrder({ paymentNote: "mock", razorpayPaymentId: "" });
  let refundCalls = 0;
  const result = await cancelOrderPaid({
    orderId: String(order._id),
    shopId: String(shopId),
    refundFn: async () => {
      refundCalls++;
      return {};
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.refunded, false);
  assert.equal(refundCalls, 0);
  const doc = await Order.findById(order._id).lean();
  assert.equal(doc.status, "cancelled");
});

test("cancel rejects orders that are not paid", async () => {
  const order = await mkPaidOrder({ status: "accepted" });
  const result = await cancelOrderPaid({
    orderId: String(order._id),
    shopId: String(shopId),
    refundFn: async () => ({}),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_status");
});
