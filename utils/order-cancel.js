import { Order } from "../models/Order.js";

// Statuses from which a paid order can still be cancelled.
const CANCELLABLE = { status: "paid", refundStatus: { $in: ["none", null] } };

/**
 * Cancel a paid order exactly once.
 *
 * The single-flight guard is the atomic `refundStatus: none → pending` claim, so
 * concurrent (or double-clicked) cancel requests can never both reach the
 * gateway. Side effects are performed only by the request that wins the claim.
 *
 * No automatic retry: a gateway failure leaves `refundStatus: "failed"` for
 * manual reconciliation. This is deliberate — a timed-out refund may actually
 * have succeeded, so auto-retrying risks a double refund.
 *
 * @param {{ orderId: string, shopId: string, refundFn: (order: object) => Promise<any> }} args
 * @returns {Promise<object>}
 */
export async function cancelOrderPaid({ orderId, shopId, refundFn }) {
  const existing = await Order.findOne({ _id: orderId, shop: shopId }).lean();
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.status !== "paid") return { ok: false, reason: "invalid_status" };

  // Mock/offline orders have no real payment — cancel atomically, no refund.
  if (existing.paymentNote === "mock") {
    const cancelled = await Order.findOneAndUpdate(
      { _id: orderId, shop: shopId, ...CANCELLABLE },
      {
        $set: {
          status: "cancelled",
          refundStatus: "completed",
          refundProcessedAt: new Date(),
        },
      },
      { new: true },
    );
    if (!cancelled) return { ok: false, reason: "conflict" };
    return { ok: true, order: cancelled, refunded: false, mock: true };
  }

  // Atomic single-flight claim.
  const claimed = await Order.findOneAndUpdate(
    { _id: orderId, shop: shopId, ...CANCELLABLE },
    { $set: { refundStatus: "pending" } },
    { new: true },
  );
  if (!claimed) return { ok: false, reason: "conflict" };

  let refund;
  try {
    refund = await refundFn(claimed);
  } catch (err) {
    await Order.updateOne(
      { _id: claimed._id, refundStatus: "pending" },
      { $set: { refundStatus: "failed", refundProcessedAt: new Date() } },
    );
    return { ok: false, reason: "refund_failed", error: err };
  }

  const refundId = String(
    refund?.id || refund?.refundId || refund?.data?.refundId || "",
  );

  const finalized = await Order.findOneAndUpdate(
    { _id: claimed._id, status: "paid", refundStatus: "pending" },
    {
      $set: {
        status: "cancelled",
        refundStatus: "completed",
        refundId,
        refundProcessedAt: new Date(),
      },
    },
    { new: true },
  );

  if (!finalized) {
    // Money has already been refunded; do not retry. Surface for reconciliation.
    return { ok: false, reason: "state_changed_after_refund", refundId };
  }

  return { ok: true, order: finalized, refunded: true };
}
