import express from "express";
import crypto from "crypto";
import { Order } from "../models/Order.js";
import { Shop } from "../models/Shop.js";
import { requireDb } from "../middleware/requireDb.js";
import { getWebhookSecretFromShop } from "../config/razorpay.js";
import { emitPendingCount } from "../socket/index.js";
import { dispatchNewOrderNotification } from "../utils/notification-dispatch.js";

export const webhooksRouter = express.Router();

// Constant-time signature comparison to avoid timing attacks.
function signaturesMatch(expectedHex, actualHex) {
  if (!expectedHex || !actualHex) return false;
  const a = Buffer.from(expectedHex, "utf8");
  const b = Buffer.from(actualHex, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Razorpay webhook receiver.
//
// IMPORTANT: this route must be mounted with express.raw() (see server.js) so
// that req.body is the exact raw bytes Razorpay signed. Parsing as JSON first
// would change the bytes and break signature verification.
//
// We always respond 200 once the signature is valid so Razorpay stops retrying;
// processing is idempotent via the x-razorpay-event-id header.
webhooksRouter.post(
  "/webhooks/razorpay",
  express.raw({ type: "application/json" }),
  requireDb,
  async (req, res) => {
    try {
      const signature = req.get("x-razorpay-signature");
      const eventId = req.get("x-razorpay-event-id") || "";
      const rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(req.body || "");

      if (!signature) {
        return res.status(400).json({ error: "Missing signature" });
      }

      // Parse only after we have the raw bytes captured for verification.
      let event;
      try {
        event = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return res.status(400).json({ error: "Invalid JSON" });
      }

      const paymentEntity = event?.payload?.payment?.entity || {};
      const razorpayOrderId = paymentEntity.order_id;
      const razorpayPaymentId = paymentEntity.id;

      // Resolve the order first so we can use the shop-specific webhook secret.
      // If the order is unknown we cannot attribute the event; ack with 200 to
      // avoid endless retries for events that don't belong to us.
      const order = razorpayOrderId
        ? await Order.findOne({ razorpayOrderId })
        : null;

      if (!order) {
        return res.status(200).json({ received: true, ignored: true });
      }

      const shop = await Shop.findById(order.shop)
        .select("paymentConfigured paymentSettings")
        .lean();
      const webhookSecret = getWebhookSecretFromShop(shop);

      if (!webhookSecret) {
        console.error("Razorpay webhook secret not configured.");
        return res.status(500).json({ error: "Webhook not configured" });
      }

      const expected = crypto
        .createHmac("sha256", webhookSecret)
        .update(rawBody)
        .digest("hex");

      if (!signaturesMatch(expected, signature)) {
        return res.status(400).json({ error: "Invalid signature" });
      }

      // Idempotency: if this exact event was already processed, ack and stop.
      if (eventId && order.webhookEventId === eventId) {
        return res.status(200).json({ received: true, duplicate: true });
      }

      const eventType = event?.event;

      if (eventType === "payment.captured") {
        // Only advance orders that are still awaiting payment. This prevents a
        // late webhook from clobbering an order already moved forward by a
        // vendor (ready_for_pickup/completed) or by /verify-payment.
        const updated = await Order.findOneAndUpdate(
          { razorpayOrderId, status: "pending_payment" },
          {
            $set: {
              status: "paid",
              paymentNote: razorpayPaymentId,
              transactionId: razorpayPaymentId,
              razorpayPaymentId,
              webhookEventId: eventId,
            },
          },
          { new: true }
        );

        if (updated) {
          emitPendingCount(order.shop);
          dispatchNewOrderNotification(updated);
        }

        // If it was not pending (already paid/handled), still record the event
        // id so repeat deliveries are recognised as duplicates.
        if (!updated && eventId) {
          await Order.updateOne(
            { razorpayOrderId },
            { $set: { webhookEventId: eventId } }
          );
        }
      } else if (eventType === "payment.failed") {
        await Order.findOneAndUpdate(
          { razorpayOrderId, status: "pending_payment" },
          {
            $set: {
              status: "cancelled",
              paymentNote: razorpayPaymentId || "failed",
              razorpayPaymentId: razorpayPaymentId || "",
              webhookEventId: eventId,
            },
          }
        );

        if (eventId) {
          await Order.updateOne(
            { razorpayOrderId, webhookEventId: { $ne: eventId } },
            { $set: { webhookEventId: eventId } }
          );
        }
      }
      // Any other event type is acknowledged but not acted upon.

      return res.status(200).json({ received: true });
    } catch (err) {
      console.error("Razorpay webhook error:", err);
      return res.status(500).json({ error: "Webhook processing failed" });
    }
  }
);
