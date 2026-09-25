// Authoritative gateway amount verification. Both helpers FAIL CLOSED: any
// missing, malformed or mismatched amount returns { ok:false } so the caller
// must leave the order unpaid.

/**
 * Verify a Razorpay payment object fetched from `payments.fetch()`.
 *
 * @param {{ payment?: object, expectedPaise?: number, razorpayOrderId?: string }} args
 * @returns {{ ok: boolean, reason?: string, actualPaise?: number, expectedPaise?: number }}
 */
export function verifyRazorpayCapturedPayment({ payment, expectedPaise, razorpayOrderId }) {
  if (!payment || typeof payment !== "object") {
    return { ok: false, reason: "missing_payment" };
  }

  const status = String(payment.status || "");
  if (status !== "captured" && payment.captured !== true) {
    return { ok: false, reason: "not_captured", status };
  }

  if (
    razorpayOrderId !== undefined &&
    razorpayOrderId !== null &&
    payment.order_id !== undefined &&
    String(payment.order_id) !== String(razorpayOrderId)
  ) {
    return { ok: false, reason: "order_mismatch" };
  }

  if (payment.currency !== undefined && String(payment.currency).toUpperCase() !== "INR") {
    return { ok: false, reason: "currency_mismatch" };
  }

  const actualPaise = Number(payment.amount);
  if (!Number.isFinite(actualPaise)) {
    return { ok: false, reason: "missing_amount" };
  }

  const expected = Number(expectedPaise);
  if (!Number.isFinite(expected)) {
    return { ok: false, reason: "missing_expected_amount" };
  }

  if (actualPaise !== expected) {
    return { ok: false, reason: "amount_mismatch", actualPaise, expectedPaise: expected };
  }

  return { ok: true, actualPaise };
}

/**
 * Extract the captured amount in paise from a PhonePe Order Status v2 response.
 * Prefers the top-level `amount` (already paise); falls back to the sum of
 * `paymentDetails[].amount`. Returns null when nothing parseable is present.
 */
export function normalizePhonePeAmountPaise(statusResult) {
  if (!statusResult || typeof statusResult !== "object") return null;

  const top = Number(statusResult.amount);
  if (Number.isFinite(top)) return top;

  const details = Array.isArray(statusResult.paymentDetails)
    ? statusResult.paymentDetails
    : [];
  let sum = 0;
  let found = false;
  for (const d of details) {
    const n = Number(d?.amount);
    if (Number.isFinite(n)) {
      sum += n;
      found = true;
    }
  }
  return found ? sum : null;
}

/**
 * Verify a PhonePe status response marked COMPLETED: the captured amount must
 * exist and equal the expected order total, and the merchant order id (when
 * present) must match.
 *
 * @returns {{ ok: boolean, reason?: string, actualPaise?: number, expectedPaise?: number }}
 */
export function verifyPhonePeCompletedPayment({ statusResult, expectedPaise, merchantOrderId }) {
  if (!statusResult || typeof statusResult !== "object") {
    return { ok: false, reason: "missing_status" };
  }
  if (String(statusResult.state || "") !== "COMPLETED") {
    return { ok: false, reason: "not_completed" };
  }

  if (
    merchantOrderId !== undefined &&
    merchantOrderId !== null &&
    statusResult.merchantOrderId !== undefined &&
    String(statusResult.merchantOrderId) !== String(merchantOrderId)
  ) {
    return { ok: false, reason: "order_mismatch" };
  }

  const actualPaise = normalizePhonePeAmountPaise(statusResult);
  if (actualPaise === null) {
    return { ok: false, reason: "missing_amount" };
  }

  const expected = Number(expectedPaise);
  if (!Number.isFinite(expected)) {
    return { ok: false, reason: "missing_expected_amount" };
  }

  if (actualPaise !== expected) {
    return { ok: false, reason: "amount_mismatch", actualPaise, expectedPaise: expected };
  }

  return { ok: true, actualPaise };
}
