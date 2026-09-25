import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import { Order } from "../../models/Order.js";
import { adjustOrderPaid } from "../../utils/order-adjust.js";

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

const ITEMS = [
  { name: "A", price: 100, quantity: 1 }, // 10000
  { name: "B", price: 50, quantity: 2 }, // 10000
  { name: "C", price: 25, quantity: 1 }, // 2500
];
const CHARGED_PAISE = 22500;

async function mkPaidOrder(overrides = {}) {
  return Order.create({
    customer: new mongoose.Types.ObjectId(),
    shop: shopId,
    items: ITEMS,
    total: CHARGED_PAISE / 100,
    pickupOtp: "123456",
    status: "paid",
    paymentNote: "razorpay",
    razorpayPaymentId: "pay_abc",
    amountChargedPaise: CHARGED_PAISE,
    refundStatus: "none",
    ...overrides,
  });
}

const noopRefund = async () => ({ id: "rfnd_x" });

test("duplicate concurrent adjusts trigger exactly one refund and one write", async () => {
  const order = await mkPaidOrder();
  let refundCalls = 0;
  const refundFn = async (_order, refundPaise) => {
    refundCalls++;
    assert.equal(refundPaise, 12500);
    await new Promise((r) => setTimeout(r, 25));
    return { id: "rfnd_adj" };
  };

  const [a, b] = await Promise.all([
    adjustOrderPaid({
      orderId: String(order._id),
      shopId: String(shopId),
      keepRaw: ["0"],
      adjustmentReason: "Out of Stock",
      adjustedBy: new mongoose.Types.ObjectId(),
      refundFn,
    }),
    adjustOrderPaid({
      orderId: String(order._id),
      shopId: String(shopId),
      keepRaw: ["0"],
      adjustmentReason: "Out of Stock",
      adjustedBy: new mongoose.Types.ObjectId(),
      refundFn,
    }),
  ]);

  assert.equal([a, b].filter((r) => r.ok).length, 1);
  assert.equal(refundCalls, 1, "the gateway must be called exactly once");

  const doc = await Order.findById(order._id).lean();
  assert.equal(doc.total, 100);
  assert.equal(doc.refundAmount, 125);
  assert.equal(doc.refundStatus, "completed");
  assert.equal(doc.refundId, "rfnd_adj");
  assert.ok(doc.adjustedAt instanceof Date);
});

test("adjust rejects out-of-range keep_items (attack: 999)", async () => {
  const order = await mkPaidOrder();
  const result = await adjustOrderPaid({
    orderId: String(order._id),
    shopId: String(shopId),
    keepRaw: ["999"],
    adjustmentReason: "Other",
    adjustedBy: new mongoose.Types.ObjectId(),
    refundFn: noopRefund,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "out_of_range");

  const doc = await Order.findById(order._id).lean();
  assert.equal(doc.total, CHARGED_PAISE / 100);
  assert.equal(doc.refundAmount, undefined);
  assert.equal(doc.adjustedAt ?? null, null);
});

test("adjust rejects negative and non-numeric keep_items", async () => {
  const order = await mkPaidOrder();
  for (const bad of [["-1"], ["abc"]]) {
    const result = await adjustOrderPaid({
      orderId: String(order._id),
      shopId: String(shopId),
      keepRaw: bad,
      adjustmentReason: "Other",
      adjustedBy: new mongoose.Types.ObjectId(),
      refundFn: noopRefund,
    });
    assert.equal(result.ok, false, `expected reject for ${JSON.stringify(bad)}`);
  }
  const doc = await Order.findById(order._id).lean();
  assert.equal(doc.adjustedAt ?? null, null);
});

test("duplicate keep_items indices are de-duplicated, not counted twice", async () => {
  const order = await mkPaidOrder();
  const result = await adjustOrderPaid({
    orderId: String(order._id),
    shopId: String(shopId),
    keepRaw: ["0", "0", "0"],
    adjustmentReason: "Other",
    adjustedBy: new mongoose.Types.ObjectId(),
    refundFn: async () => ({ id: "r" }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.refundPaise, 12500);
  const doc = await Order.findById(order._id).lean();
  assert.equal(doc.total, 100);
});

test("adjust rejects all-removed and none-removed selections", async () => {
  const order = await mkPaidOrder();
  const allRemoved = await adjustOrderPaid({
    orderId: String(order._id),
    shopId: String(shopId),
    keepRaw: [],
    adjustmentReason: "Other",
    adjustedBy: new mongoose.Types.ObjectId(),
    refundFn: noopRefund,
  });
  assert.equal(allRemoved.reason, "all_removed");

  const noneRemoved = await adjustOrderPaid({
    orderId: String(order._id),
    shopId: String(shopId),
    keepRaw: ["0", "1", "2"],
    adjustmentReason: "Other",
    adjustedBy: new mongoose.Types.ObjectId(),
    refundFn: noopRefund,
  });
  assert.equal(noneRemoved.reason, "none_removed");
});

test("adjust fails closed when the refund would exceed the charged amount", async () => {
  // Keep only item A (10000 paise) but claim only 5000 paise was charged.
  const order = await mkPaidOrder({ amountChargedPaise: 5000, total: 50 });
  const result = await adjustOrderPaid({
    orderId: String(order._id),
    shopId: String(shopId),
    keepRaw: ["0"],
    adjustmentReason: "Other",
    adjustedBy: new mongoose.Types.ObjectId(),
    refundFn: noopRefund,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "would_exceed_charged");

  const doc = await Order.findById(order._id).lean();
  assert.equal(doc.adjustedAt ?? null, null);
  assert.equal(doc.total, 50);
});

test("failed partial refund locks the order and is not retried", async () => {
  const order = await mkPaidOrder();
  let refundCalls = 0;
  const refundFn = async () => {
    refundCalls++;
    throw new Error("gateway down");
  };

  const first = await adjustOrderPaid({
    orderId: String(order._id),
    shopId: String(shopId),
    keepRaw: ["0"],
    adjustmentReason: "Other",
    adjustedBy: new mongoose.Types.ObjectId(),
    refundFn,
  });
  assert.equal(first.ok, false);
  assert.equal(first.reason, "refund_failed");

  const second = await adjustOrderPaid({
    orderId: String(order._id),
    shopId: String(shopId),
    keepRaw: ["0"],
    adjustmentReason: "Other",
    adjustedBy: new mongoose.Types.ObjectId(),
    refundFn,
  });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "conflict");
  assert.equal(refundCalls, 1, "failed refund must not be retried");

  const doc = await Order.findById(order._id).lean();
  assert.equal(doc.refundStatus, "failed");
});
