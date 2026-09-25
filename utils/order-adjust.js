import { Order } from "../models/Order.js";
import { toPaise, fromPaise } from "./money.js";
import { normalizeKeepIndices, computeAdjustedTotals } from "./order-math.js";

/**
 * Adjust (partially remove items from) a paid/accepted order exactly once.
 *
 * All money math is integer paise. The atomic guard is
 * `{ status in [paid, accepted], adjustedAt: null }`, so a second concurrent
 * adjustment loses the claim and never reaches the gateway. No automatic retry:
 * a gateway failure leaves `refundStatus: "failed"` for manual reconciliation.
 *
 * @param {{
 *   orderId: string,
 *   shopId: string,
 *   keepRaw: unknown,
 *   adjustmentReason: string,
 *   adjustedBy: unknown,
 *   refundFn: (order: object, refundPaise: number) => Promise<any>,
 * }} args
 * @returns {Promise<object>}
 */
export async function adjustOrderPaid({
  orderId,
  shopId,
  keepRaw,
  adjustmentReason,
  adjustedBy,
  refundFn,
}) {
  const order = await Order.findOne({ _id: orderId, shop: shopId });
  if (!order) return { ok: false, reason: "not_found" };
  if (!["paid", "accepted"].includes(order.status)) {
    return { ok: false, reason: "invalid_status" };
  }

  const normalized = normalizeKeepIndices(keepRaw, order.items.length);
  if (!normalized.ok) return { ok: false, reason: normalized.reason, value: normalized.value };

  const chargedPaise = Number.isFinite(Number(order.amountChargedPaise))
    ? Number(order.amountChargedPaise)
    : toPaise(order.total);
  if (!Number.isFinite(chargedPaise)) {
    return { ok: false, reason: "invalid_charged_amount" };
  }

  const computed = computeAdjustedTotals({
    items: order.items,
    keepIndices: normalized.indices,
    orderType: order.orderType,
    parcelChargePaise: toPaise(order.parcelCharge) || 0,
    // Preserve the order's original discount across the adjustment.
    discountPercent: Number(order.discountPercent) || 0,
  });
  if (!computed.ok) return { ok: false, reason: computed.reason };

  // Never let an adjustment raise the amount owed above what was charged.
  if (computed.updatedPaise > chargedPaise) {
    return { ok: false, reason: "would_exceed_charged" };
  }

  const refundPaise = chargedPaise - computed.updatedPaise;

  const keepSet = new Set(normalized.indices);
  const newItems = order.items.map((item, i) => {
    const obj = typeof item.toObject === "function" ? item.toObject() : { ...item };
    obj.status = keepSet.has(i) ? "active" : "removed";
    return obj;
  });

  // Atomic claim + write of the full computed state.
  const claim = await Order.findOneAndUpdate(
    {
      _id: orderId,
      shop: shopId,
      status: { $in: ["paid", "accepted"] },
      adjustedAt: null,
    },
    {
      $set: {
        items: newItems,
        originalTotal: fromPaise(chargedPaise),
        updatedTotal: fromPaise(computed.updatedPaise),
        refundAmount: fromPaise(refundPaise),
        total: fromPaise(computed.updatedPaise),
        adjustedAt: new Date(),
        adjustedBy,
        adjustmentReason,
        refundStatus: refundPaise > 0 ? "pending" : "completed",
      },
    },
    { new: true },
  );
  if (!claim) return { ok: false, reason: "conflict" };

  // Nothing to refund (or mock order) — finalize without touching a gateway.
  if (refundPaise <= 0 || claim.paymentNote === "mock") {
    const done = await Order.findOneAndUpdate(
      { _id: claim._id, refundStatus: "pending" },
      { $set: { refundStatus: "completed", refundProcessedAt: new Date() } },
      { new: true },
    );
    return { ok: true, order: done || claim, refunded: false, refundPaise };
  }

  let refund;
  try {
    refund = await refundFn(claim, refundPaise);
  } catch (err) {
    await Order.updateOne(
      { _id: claim._id, refundStatus: "pending" },
      { $set: { refundStatus: "failed", refundProcessedAt: new Date() } },
    );
    return { ok: false, reason: "refund_failed", error: err, order: claim, refundPaise };
  }

  const refundId = String(
    refund?.id || refund?.refundId || refund?.data?.refundId || "",
  );

  const finalized = await Order.findOneAndUpdate(
    { _id: claim._id, refundStatus: "pending" },
    {
      $set: {
        refundStatus: "completed",
        refundId,
        refundProcessedAt: new Date(),
      },
    },
    { new: true },
  );

  return { ok: true, order: finalized || claim, refunded: true, refundPaise };
}
