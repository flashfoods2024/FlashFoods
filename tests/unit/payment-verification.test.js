import test from "node:test";
import assert from "node:assert/strict";
import {
  verifyRazorpayCapturedPayment,
  verifyPhonePeCompletedPayment,
  normalizePhonePeAmountPaise,
} from "../../utils/payment-verification.js";

const captured = (overrides = {}) => ({
  status: "captured",
  amount: 22500,
  currency: "INR",
  order_id: "order_abc",
  ...overrides,
});

test("Razorpay: captured payment with matching amount verifies", () => {
  const r = verifyRazorpayCapturedPayment({
    payment: captured(),
    expectedPaise: 22500,
    razorpayOrderId: "order_abc",
  });
  assert.equal(r.ok, true);
  assert.equal(r.actualPaise, 22500);
});

test("Razorpay: amount mismatch fails closed", () => {
  const r = verifyRazorpayCapturedPayment({
    payment: captured({ amount: 100 }),
    expectedPaise: 22500,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "amount_mismatch");
});

test("Razorpay: uncaptured payment fails closed", () => {
  const r = verifyRazorpayCapturedPayment({
    payment: captured({ status: "authorized", captured: false }),
    expectedPaise: 22500,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_captured");
});

test("Razorpay: missing/malformed amount fails closed", () => {
  assert.equal(
    verifyRazorpayCapturedPayment({ payment: captured({ amount: undefined }), expectedPaise: 1 })
      .reason,
    "missing_amount",
  );
  assert.equal(
    verifyRazorpayCapturedPayment({ payment: captured({ amount: "abc" }), expectedPaise: 1 })
      .reason,
    "missing_amount",
  );
});

test("Razorpay: currency and order-id mismatches fail closed", () => {
  assert.equal(
    verifyRazorpayCapturedPayment({
      payment: captured({ currency: "USD" }),
      expectedPaise: 22500,
    }).reason,
    "currency_mismatch",
  );
  assert.equal(
    verifyRazorpayCapturedPayment({
      payment: captured({ order_id: "other" }),
      expectedPaise: 22500,
      razorpayOrderId: "order_abc",
    }).reason,
    "order_mismatch",
  );
});

test("Razorpay: missing payment fails closed", () => {
  assert.equal(verifyRazorpayCapturedPayment({ payment: null }).reason, "missing_payment");
});

// --- PhonePe ---------------------------------------------------------------

test("PhonePe: COMPLETED with top-level amount verifies", () => {
  const r = verifyPhonePeCompletedPayment({
    statusResult: { state: "COMPLETED", amount: 22500, merchantOrderId: "m1" },
    expectedPaise: 22500,
    merchantOrderId: "m1",
  });
  assert.equal(r.ok, true);
  assert.equal(r.actualPaise, 22500);
});

test("PhonePe: amount can be summed from paymentDetails", () => {
  const r = verifyPhonePeCompletedPayment({
    statusResult: {
      state: "COMPLETED",
      paymentDetails: [{ amount: 20000 }, { amount: 2500 }],
    },
    expectedPaise: 22500,
  });
  assert.equal(r.ok, true);
  assert.equal(r.actualPaise, 22500);
});

test("PhonePe: amount mismatch fails closed", () => {
  const r = verifyPhonePeCompletedPayment({
    statusResult: { state: "COMPLETED", amount: 1 },
    expectedPaise: 22500,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "amount_mismatch");
});

test("PhonePe: missing or malformed amount fails closed", () => {
  assert.equal(
    verifyPhonePeCompletedPayment({ statusResult: { state: "COMPLETED" }, expectedPaise: 1 })
      .reason,
    "missing_amount",
  );
  assert.equal(
    verifyPhonePeCompletedPayment({
      statusResult: { state: "COMPLETED", amount: "not-a-number", paymentDetails: [] },
      expectedPaise: 1,
    }).reason,
    "missing_amount",
  );
});

test("PhonePe: non-COMPLETED state fails closed", () => {
  assert.equal(
    verifyPhonePeCompletedPayment({
      statusResult: { state: "PENDING", amount: 22500 },
      expectedPaise: 22500,
    }).reason,
    "not_completed",
  );
});

test("PhonePe: order id mismatch fails closed", () => {
  assert.equal(
    verifyPhonePeCompletedPayment({
      statusResult: { state: "COMPLETED", amount: 22500, merchantOrderId: "other" },
      expectedPaise: 22500,
      merchantOrderId: "m1",
    }).reason,
    "order_mismatch",
  );
});

test("normalizePhonePeAmountPaise returns null when nothing parseable", () => {
  assert.equal(normalizePhonePeAmountPaise({}), null);
  assert.equal(normalizePhonePeAmountPaise(null), null);
  assert.equal(normalizePhonePeAmountPaise({ paymentDetails: [{}] }), null);
});
