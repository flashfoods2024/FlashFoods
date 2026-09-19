import express from "express";
import { Order } from "../models/Order.js";
import { Shop } from "../models/Shop.js";
import { requireDb } from "../middleware/requireDb.js";
import { resolveWebhookSecret } from "../config/razorpay.js";
import { emitPendingCount } from "../socket/index.js";
import { dispatchNewOrderNotification } from "../utils/notification-dispatch.js";
import { verifyRazorpayWebhook } from "../utils/webhook-signature.js";
import { toPaise } from "../utils/money.js";

export const webhooksRouter = express.Router();

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
        console.warn(
          "[razorpay-webhook] rejected: missing x-razorpay-signature header",
          { eventId },
        );
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

      // Fail closed on missing configuration: never verify with an empty key.
      const { secret, source, reason } = resolveWebhookSecret(shop);
      if (!secret) {
        console.error(
          "[razorpay-webhook] REJECTED: webhook secret not configured — failing closed",
          {
            orderId: String(order._id),
            shopId: order.shop ? String(order.shop) : null,
            secretSource: source,
            reason,
            eventId,
          },
        );
        return res.status(503).json({ error: "Webhook not configured" });
      }

      const verdict = verifyRazorpayWebhook({ secret, rawBody, signature });
      if (!verdict.ok) {
        console.error(
          "[razorpay-webhook] signature verification failed — rejecting event",
          {
            orderId: String(order._id),
            shopId: order.shop ? String(order.shop) : null,
            secretSource: source,
            reason: verdict.reason,
            eventId,
          },
        );
        return res.status(400).json({ error: "Invalid signature" });
      }

      // Idempotency: if this exact event was already processed, ack and stop.
      if (eventId && order.webhookEventId === eventId) {
        console.log("[razorpay-webhook] duplicate event ignored", {
          orderId: String(order._id),
          eventId,
        });
        return res.status(200).json({ received: true, duplicate: true });
      }

      const eventType = event?.event;

      if (eventType === "payment.captured") {
        // Idempotency is part of the atomic claim itself: the
        // `webhookEventId: { $ne: eventId }` precondition means two
        // concurrent deliveries of the same event cannot both win, so
        // notifications and pending counts fire exactly once. Money is
        // already protected by the `status: "pending_payment"` precondition.
        const updated = await Order.findOneAndUpdate(
          {
            razorpayOrderId,
            status: "pending_payment",
            webhookEventId: { $ne: eventId },
          },
          {
            $set: {
              status: "paid",
              paymentNote: razorpayPaymentId,
              transactionId: razorpayPaymentId,
              razorpayPaymentId,
              webhookEventId: eventId,
              amountChargedPaise: toPaise(order.total),
            },
          },
          { new: true }
        );

        if (updated) {
          emitPendingCount(order.shop);
          dispatchNewOrderNotification(updated);
        } else {
          // Either already advanced by /verify-payment, or a duplicate
          // delivery that lost the claim. Record the event id either way so
          // repeat deliveries are recognised as duplicates.
          if (eventId) {
            await Order.updateOne(
              { razorpayOrderId },
              { $set: { webhookEventId: eventId } }
            );
          }
        }
      } else if (eventType === "payment.failed") {
        await Order.findOneAndUpdate(
          { razorpayOrderId, status: "pending_payment", webhookEventId: { $ne: eventId } },
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
