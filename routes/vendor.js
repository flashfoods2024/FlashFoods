import express from "express";
import mongoose from "mongoose";
import { Order } from "../models/Order.js";
import { MenuItem } from "../models/MenuItem.js";
import { Shop } from "../models/Shop.js";
import { requireDb } from "../middleware/requireDb.js";
import {
  requireAuth,
  requireVendor,
  requireVendorShop,
} from "../middleware/auth.js";
import { handleMenuImageUpload } from "../middleware/upload.js";
import { createRazorpayFromShop } from "../config/razorpay.js";
import {
  getPhonepeFromShop,
  getAuthToken,
  refundPayment,
} from "../config/phonepe.js";
import { formatPickupTime, getPickupUrgency } from "../utils/time.js";
import { emitPendingCount } from "../socket/index.js";
import { dispatchOrderReadyNotification } from "../utils/notification-dispatch.js";
import { computeParcelCharge } from "../utils/pricing.js";
import { otpExpiryFrom, isOtpExpired } from "../utils/otp.js";
import { toPaise, fromPaise } from "../utils/money.js";
import { computeParcelTotals } from "../utils/order-math.js";
import {
  getShopAvailability,
  validateOperatingHours,
} from "../utils/shop-hours.js";
import { validatePickupSlotSettings } from "../utils/pickup-slots.js";
import { validateDiscountSettings } from "../utils/discount.js";
import { verifyPickupQr } from "../utils/qr-pickup.js";
import { cancelOrderPaid } from "../utils/order-cancel.js";
import { adjustOrderPaid } from "../utils/order-adjust.js";
import rateLimit from "express-rate-limit";

export const vendorRouter = express.Router();

// OTP brute-force guard. The pickup code is 6 digits, so without a throttle a
// vendor session (or a stolen one) could enumerate codes quickly. Scoped to the
// verification endpoint only so normal vendor traffic is unaffected.
const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many pickup code attempts. Please wait and try again." },
});

// Whether the shop's currently selected gateway has the credentials it needs.
export function isGatewayConfigured(shop) {
  if (shop.paymentGateway === "easebuzz") {
    return !!(
      shop.paymentSettings?.easebuzz?.merchantKey &&
      shop.paymentSettings?.easebuzz?.salt
    );
  }
  if (shop.paymentGateway === "phonepe") {
    return !!(
      shop.paymentSettings?.phonepe?.clientId &&
      shop.paymentSettings?.phonepe?.clientSecret
    );
  }
  // Default: Razorpay.
  return !!(
    shop.paymentSettings?.razorpay?.keyId &&
    shop.paymentSettings?.razorpay?.keySecret
  );
}

// ---------------------------------------------------------------------------
// Gateway refund helpers (called by the cancel & adjust routes below)
// ---------------------------------------------------------------------------

// The amount actually captured for an order, in integer paise. Prefers the
// authoritative `amountChargedPaise` recorded at payment time and only falls
// back to the rupee `total` for legacy orders that predate the field.
function resolveChargedPaise(order) {
  const stored = Number(order.amountChargedPaise);
  if (Number.isFinite(stored)) return Math.round(stored);
  const paise = toPaise(order.total);
  if (paise === null) throw new Error("Order has no chargeable amount.");
  return paise;
}

async function refundViaRazorpay(order, shop) {
  const { instance } = createRazorpayFromShop(shop);
  const paymentId = order.razorpayPaymentId;

  const payment = await instance.payments.fetch(paymentId);
  if (payment.status !== "captured") {
    throw new Error("Only captured payments can be refunded.");
  }

  return instance.payments.refund(paymentId, {
    amount: resolveChargedPaise(order),
    speed: "normal",
    notes: { reason: "Vendor cancelled order" },
  });
}

async function refundViaPhonePe(order, shop) {
  const phonepe = getPhonepeFromShop(shop);
  const auth = await getAuthToken({
    clientId: phonepe.clientId,
    clientSecret: phonepe.clientSecret,
    clientVersion: phonepe.clientVersion,
    env: phonepe.env,
  });

  if (!auth || !auth.access_token) {
    throw new Error("Failed to authenticate with PhonePe.");
  }

  const merchantRefundId = `${order.gatewayTxnId}_refund_${Date.now()}`;

  return refundPayment({
    accessToken: auth.access_token,
    merchantOrderId: order.gatewayTxnId,
    transactionId: order.transactionId,
    amountPaise: resolveChargedPaise(order),
    merchantRefundId,
    env: phonepe.env,
  });
}

// Partial refund helpers — used by the adjust route to refund only the
// removed items (refundAmount), not the entire order.
async function partialRefundViaRazorpay(order, shop, refundPaise) {
  const { instance } = createRazorpayFromShop(shop);
  const paymentId = order.razorpayPaymentId;

  const payment = await instance.payments.fetch(paymentId);
  if (payment.status !== "captured") {
    throw new Error("Only captured payments can be refunded.");
  }

  return instance.payments.refund(paymentId, {
    amount: Math.round(refundPaise),
    speed: "normal",
    notes: { reason: `Adjustment refund: ${order.adjustmentReason || "Items removed"}` },
  });
}

async function partialRefundViaPhonePe(order, shop, refundPaise) {
  const phonepe = getPhonepeFromShop(shop);
  const auth = await getAuthToken({
    clientId: phonepe.clientId,
    clientSecret: phonepe.clientSecret,
    clientVersion: phonepe.clientVersion,
    env: phonepe.env,
  });

  if (!auth || !auth.access_token) {
    throw new Error("Failed to authenticate with PhonePe.");
  }

  const merchantRefundId = `${order.gatewayTxnId}_adj_${Date.now()}`;

  return refundPayment({
    accessToken: auth.access_token,
    merchantOrderId: order.gatewayTxnId,
    transactionId: order.transactionId,
    amountPaise: Math.round(refundPaise),
    merchantRefundId,
    env: phonepe.env,
  });
}

vendorRouter.get(
  "/vendor/menu",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    const shop = await Shop.findById(req.vendorShopId).lean();
    if (!shop) {
      req.flash("error", "Shop not found.");
      return res.redirect("/");
    }
    if (shop && typeof shop.isOpen !== "boolean") shop.isOpen = true;
    const menuItems = await MenuItem.find({ shop: req.vendorShopId })
      .sort({ name: 1 })
      .lean();
    return res.render("vendor/menu", {
      pageTitle: "Vendor Dashboard",
      shop,
      availability: getShopAvailability(shop),
      slotSettings: shop.pickupSlots,
      discountSettings: shop.discount,
      menuItems,
    });
  },
);

vendorRouter.post(
  "/vendor/shop/toggle",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    try {
      const shop = await Shop.findById(req.vendorShopId);

      if (!shop) {
        req.flash("error", "Shop not found.");
        return res.redirect("/vendor/menu");
      }

      if (shop.isActive === false) {
        req.flash("error", "This shop is disabled by an admin.");
        return res.redirect("/vendor/menu");
      }

      shop.isOpen = !shop.isOpen;

      await shop.save();

      req.flash(
        "success",
        shop.isOpen ? "Shop opened successfully." : "Shop closed successfully.",
      );

      return res.redirect("/vendor/menu");
    } catch (error) {
      console.error(error);

      req.flash("error", "Failed to update shop status.");

      return res.redirect("/vendor/menu");
    }
  },
);

// Save the shop's daily operating hours. Times are interpreted in IST and only
// constrain student-facing availability; the manual open/close toggle remains
// the master switch. Both fields blank clears the hours (no time constraint).
vendorRouter.post(
  "/vendor/shop/hours",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    try {
      const shop = await Shop.findById(req.vendorShopId);
      if (!shop) {
        req.flash("error", "Shop not found.");
        return res.redirect("/vendor/menu");
      }

      const result = validateOperatingHours(
        req.body?.openingTime,
        req.body?.closingTime,
      );

      if (!result.ok) {
        req.flash("error", result.error);
        return res.redirect("/vendor/menu");
      }

      shop.openingTime = result.openingTime;
      shop.closingTime = result.closingTime;
      await shop.save();

      req.flash(
        "success",
        result.openingTime
          ? "Operating hours saved."
          : "Operating hours cleared. The manual open/close toggle now applies.",
      );
      return res.redirect("/vendor/menu");
    } catch (error) {
      console.error(error);
      req.flash("error", "Failed to save operating hours.");
      return res.redirect("/vendor/menu");
    }
  },
);

// Save the shop's pickup-slot configuration (window, duration, capacity).
vendorRouter.post(
  "/vendor/shop/pickup-slots",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    try {
      const shop = await Shop.findById(req.vendorShopId);
      if (!shop) {
        req.flash("error", "Shop not found.");
        return res.redirect("/vendor/menu");
      }

      const result = validatePickupSlotSettings(req.body || {});
      if (!result.ok) {
        req.flash("error", result.error);
        return res.redirect("/vendor/menu");
      }

      shop.pickupSlots = result.settings;
      await shop.save();

      req.flash(
        "success",
        result.settings.enabled
          ? "Pickup slots saved."
          : "Pickup slots disabled. Students pick any available time.",
      );
      return res.redirect("/vendor/menu");
    } catch (error) {
      console.error(error);
      req.flash("error", "Failed to save pickup slots.");
      return res.redirect("/vendor/menu");
    }
  },
);

// Save the shop's percentage discount (applies to the food subtotal only).
vendorRouter.post(
  "/vendor/shop/discount",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    try {
      const shop = await Shop.findById(req.vendorShopId);
      if (!shop) {
        req.flash("error", "Shop not found.");
        return res.redirect("/vendor/menu");
      }

      const result = validateDiscountSettings(req.body || {});
      if (!result.ok) {
        req.flash("error", result.error);
        return res.redirect("/vendor/menu");
      }

      shop.discount = result.settings;
      await shop.save();

      req.flash(
        "success",
        result.settings.enabled
          ? `Discount of ${result.settings.percent}% saved.`
          : "Discount disabled.",
      );
      return res.redirect("/vendor/menu");
    } catch (error) {
      console.error(error);
      req.flash("error", "Failed to save discount.");
      return res.redirect("/vendor/menu");
    }
  },
);

vendorRouter.post(
  "/vendor/menu",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  handleMenuImageUpload,
  async (req, res) => {
    const shop = await Shop.findById(req.vendorShopId).lean();
    if (!shop || shop.isActive === false) {
      req.flash("error", "This shop is disabled by an admin.");
      return res.redirect("/vendor/menu");
    }
    const name = String((req.body && req.body.name) || "").trim();
    const description = String((req.body && req.body.description) || "").trim();
    const category = String((req.body && req.body.category) || "").trim();
    const price = Number((req.body && req.body.price) || 0);
    const image = req.file?.path || "";

    if (!name) {
      req.flash("error", "Name is required.");
      return res.redirect("/vendor/menu");
    }
    if (!Number.isFinite(price) || price <= 0) {
      req.flash("error", "Price must be greater than 0.");
      return res.redirect("/vendor/menu");
    }

    await MenuItem.create({
      shop: req.vendorShopId,
      name,
      category,
      description,
      price,
      image,
      variants: [{ label: "Regular", price }],
    });

    req.flash("success", "Menu item created.");
    return res.redirect("/vendor/menu");
  },
);

vendorRouter.patch(
  "/vendor/menu/:id",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  handleMenuImageUpload,
  async (req, res) => {
    const activeShop = await Shop.findById(req.vendorShopId).lean();
    if (!activeShop || activeShop.isActive === false) {
      return res
        .status(403)
        .json({ error: "This shop is disabled by an admin." });
    }
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid menu item id." });
    }

    const item = await MenuItem.findOne({ _id: id, shop: req.vendorShopId });
    if (!item) {
      return res.status(404).json({ error: "Menu item not found." });
    }

    const name = String((req.body && req.body.name) || "").trim();
    const description = String((req.body && req.body.description) || "").trim();
    const category = String((req.body && req.body.category) || "").trim();
    const price = Number((req.body && req.body.price) || 0);

    if (!name) {
      return res.status(400).json({ error: "Name is required." });
    }
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ error: "Price must be greater than 0." });
    }

    item.name = name;
    item.category = category;
    item.description = description;
    item.price = price;
    if (item.variants && item.variants.length > 0) {
      item.variants[0].price = price;
    }
    if (req.file?.path) {
      item.image = req.file.path;
    }
    await item.save();

    return res.json({
      success: true,
      message: "Menu item updated.",
      item: {
        _id: String(item._id),
        name: item.name,
        description: item.description,
        category: item.category,
        price: item.price,
        image: item.image,
        available: item.available,
        variants: item.variants,
      },
    });
  },
);

vendorRouter.delete(
  "/vendor/menu/:id",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    const activeShop = await Shop.findById(req.vendorShopId).lean();
    if (!activeShop || activeShop.isActive === false) {
      return res
        .status(403)
        .json({ error: "This shop is disabled by an admin." });
    }
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid menu item id." });
    }

    const result = await MenuItem.deleteOne({
      _id: id,
      shop: req.vendorShopId,
    });
    if (!result.deletedCount) {
      return res.status(404).json({ error: "Menu item not found." });
    }

    return res.json({ success: true, message: "Menu item deleted." });
  },
);

vendorRouter.post(
  "/vendor/menu/parcel-charge",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    try {
      const shop = await Shop.findById(req.vendorShopId);
      if (!shop) {
        req.flash("error", "Shop not found.");
        return res.redirect("/vendor/menu");
      }

      shop.parcelChargeEnabled = req.body.parcelChargeEnabled === "true";

      const charge = Number(req.body.parcelCharge);
      if (!isNaN(charge) && charge >= 0) {
        shop.parcelCharge = charge;
      }

      await shop.save();

      req.flash("success", "Parcel settings saved.");
      return res.redirect("/vendor/menu");
    } catch (err) {
      console.error("Error saving parcel settings:", err);
      req.flash("error", "Failed to save parcel settings.");
      return res.redirect("/vendor/menu");
    }
  },
);

// Shared query for vendor pending orders. Used by both the HTML route and the
// JSON polling endpoint so the match/sort logic stays in one place.
// Matches paid & accepted orders for the shop and orders them by pickup priority
// (pickupTime, falling back to createdAt) then createdAt.
async function getPendingOrders(shopId) {
  return Order.aggregate([
    {
      $match: {
        shop: shopId,
        status: { $in: ["paid", "accepted", "ready_for_pickup"] },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "customer",
        foreignField: "_id",
        as: "_customer",
      },
    },
    {
      $addFields: {
        priorityTime: { $ifNull: ["$pickupTime", "$createdAt"] },
        customerName: {
          $cond: [
            { $gt: [{ $size: "$_customer" }, 0] },
            { $arrayElemAt: ["$_customer.name", 0] },
            null,
          ],
        },
        customerPhone: {
          $ifNull: [{ $arrayElemAt: ["$_customer.phone", 0] }, ""],
        },
      },
    },
    {
      $sort: {
        priorityTime: 1,
        createdAt: 1,
      },
    },
    {
      $project: {
        priorityTime: 0,
        _customer: 0,
      },
    },
  ]);
}

vendorRouter.get(
  "/vendor/orders/pending",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    const orders = await getPendingOrders(req.vendorShopId);
    return res.render("vendor/pending-orders", {
      pageTitle: "Pending Orders",
      orders,
    });
  },
);

// JSON endpoint backing the 5s client-side polling on the pending orders page.
// Returns only the fields needed to render the order cards, with pickup
// urgency + formatted pickup time precomputed so the client does not need the
// server-side EJS view helpers.
vendorRouter.get(
  "/vendor/orders/pending.json",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    try {
      const orders = await getPendingOrders(req.vendorShopId);
      const payload = orders.map((order) => ({
        id: String(order._id),
        shortId: String(order._id).slice(-6).toUpperCase(),
        customerName: order.customerName || null,
        customerPhone: order.customerPhone || null,
        orderType: order.orderType || "dinein",
        status: order.status,
        total: Number(order.total),
        parcelCharge: Number(order.parcelCharge) || 0,
        pickupOtp: order.status === "ready_for_pickup" ? order.pickupOtp : null,
        pickupTime: order.pickupTime ? order.pickupTime.toISOString() : null,
        pickupReminderSent: !!order.pickupReminderSent,
        pickupUrgency: getPickupUrgency(order.pickupTime),
        pickupTimeLabel: formatPickupTime(order.pickupTime),
        items: (order.items || [])
          .filter((item) => item.status !== "removed")
          .map((item) => ({
            name: item.name,
            quantity: item.quantity,
            variantName: item.variantName || null,
          })),
      }));
      return res.json({ orders: payload });
    } catch (err) {
      console.error("Failed to load pending orders JSON:", err);
      return res.status(500).json({ error: "Failed to load pending orders." });
    }
  },
);

// Lightweight endpoint called by the client-side polling loop after it fires
// a pickup reminder (sound + notification). Sets the server-side flag so the
// reminder is never replayed on subsequent polls or after a page refresh.
vendorRouter.post(
  "/vendor/orders/:id/mark-reminder-sent",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: "Invalid order ID." });
      }
      const order = await Order.findById(id);
      if (!order || String(order.shop) !== req.vendorShopIdStr) {
        return res.status(404).json({ error: "Order not found." });
      }
      order.pickupReminderSent = true;
      await order.save();
      return res.json({ success: true });
    } catch (err) {
      console.error("Failed to mark reminder sent:", err);
      return res.status(500).json({ error: "Server error." });
    }
  },
);

vendorRouter.post(
  "/vendor/orders/:id/ready",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Invalid order.");
      return res.redirect("/vendor/orders/pending");
    }

    // Atomic transition: only an `accepted` order can become ready, so a
    // double-click can neither mark it ready twice nor refresh the TTL twice.
    const updated = await Order.findOneAndUpdate(
      { _id: id, shop: req.vendorShopId, status: "accepted" },
      {
        $set: {
          status: "ready_for_pickup",
          readyAt: new Date(),
          // Start the pickup-code TTL from the moment the code becomes usable,
          // so a long prep time never eats into the customer's pickup window.
          pickupOtpExpiresAt: otpExpiryFrom(),
        },
      },
      { new: true },
    );

    if (!updated) {
      const existing = await Order.findOne({
        _id: id,
        shop: req.vendorShopId,
      })
        .select("status")
        .lean();
      req.flash(
        "error",
        existing ? "That order is not awaiting confirmation." : "Order not found.",
      );
      return res.redirect("/vendor/orders/pending");
    }

    emitPendingCount(updated.shop);

    // F06.5 — notify the ordering student. Fire-and-forget (never throws,
    // never blocks the redirect). Runs only here, after the atomic
    // accepted → ready_for_pickup transition succeeded, so duplicate or
    // failed transitions never produce a notification. Vendor flow unchanged.
    dispatchOrderReadyNotification(updated);

    req.flash(
      "success",
      "Order marked ready. Student can pick up with their code.",
    );
    return res.redirect("/vendor/orders/pending");
  },
);

vendorRouter.post(
  "/vendor/orders/:id/accept",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Invalid order.");
      return res.redirect("/vendor/orders/pending");
    }

    // Atomic transition: only a `paid` order can be accepted, so concurrent
    // accepts fire the pending-count side effect exactly once.
    const updated = await Order.findOneAndUpdate(
      { _id: id, shop: req.vendorShopId, status: "paid" },
      { $set: { status: "accepted" } },
      { new: true },
    );

    if (!updated) {
      const existing = await Order.findOne({
        _id: id,
        shop: req.vendorShopId,
      })
        .select("status")
        .lean();
      req.flash(
        "error",
        existing ? "Only paid orders can be accepted." : "Order not found.",
      );
      return res.redirect("/vendor/orders/pending");
    }

    emitPendingCount(updated.shop);

    req.flash("success", "Order accepted. Mark it ready when prepared.");
    return res.redirect("/vendor/orders/pending");
  },
);

vendorRouter.post(
  "/vendor/orders/:id/cancel",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        req.flash("error", "Order not found.");
        return res.redirect("/vendor/orders/pending");
      }

      const shop = await Shop.findById(req.vendorShopId)
        .select("paymentGateway paymentConfigured paymentSettings")
        .lean();

      const gateway = shop?.paymentGateway || "razorpay";

      // Only the winning claim calls the gateway. No automatic retry on
      // failure — refundStatus:"failed" is reconciled manually.
      const refundFn = async (order) => {
        if (gateway === "razorpay") {
          if (!order.razorpayPaymentId) {
            throw new Error("Invalid payment ID.");
          }
          const refund = await refundViaRazorpay(order, shop);
          console.log("Razorpay refund successful:", refund.id);
          return refund;
        }
        if (gateway === "phonepe") {
          if (!order.transactionId || !order.gatewayTxnId) {
            throw new Error("Invalid payment ID.");
          }
          const result = await refundViaPhonePe(order, shop);
          console.log("PhonePe refund response:", result?.code || result);
          return result;
        }
        throw new Error("Refunds not supported for this payment method.");
      };

      const result = await cancelOrderPaid({
        orderId: req.params.id,
        shopId: req.vendorShopId,
        refundFn,
      });

      if (!result.ok) {
        if (result.reason === "not_found") {
          req.flash("error", "Order not found.");
        } else if (result.reason === "invalid_status") {
          req.flash("error", "Only paid orders can be cancelled.");
        } else if (result.reason === "conflict") {
          req.flash("error", "This order is already being processed.");
        } else if (result.reason === "refund_failed") {
          console.error("REFUND ERROR:", result.error?.message || result.error);
          req.flash(
            "error",
            "Refund failed. Please process manually from the payment dashboard.",
          );
        } else if (result.reason === "state_changed_after_refund") {
          console.error(
            "[cancel] order state changed after refund; manual reconciliation required",
            { orderId: String(req.params.id), refundId: result.refundId },
          );
          req.flash(
            "error",
            "Refund issued but the order state changed. Please reconcile manually.",
          );
        } else {
          req.flash("error", "Could not cancel this order.");
        }
        return res.redirect("/vendor/orders/pending");
      }

      emitPendingCount(result.order.shop);
      req.flash(
        "success",
        result.refunded
          ? "Order cancelled and refund initiated."
          : "Order cancelled.",
      );
      return res.redirect("/vendor/orders/pending");
    } catch (error) {
      console.error("CANCEL ERROR:", error);
      req.flash("error", "Could not cancel this order. Please try again.");
      return res.redirect("/vendor/orders/pending");
    }
  },
);

vendorRouter.get(
  "/vendor/verify",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    const readyOrders = await Order.find({
      shop: req.vendorShopId,
      status: "ready_for_pickup",
    })
      .sort({ pickupTime: 1, createdAt: 1 })
      .populate("customer", "name")
      .lean();

    return res.render("vendor/verify", {
      pageTitle: "Verify Pickup",
      waitingPickup: readyOrders.length,
      orders: readyOrders,
    });
  },
);

vendorRouter.post(
  "/vendor/verify",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  otpVerifyLimiter,
  async (req, res) => {
    const raw = String((req.body && req.body.otp) || "").replace(/\D/g, "");
    const otp = raw.slice(0, 6);

    if (otp.length !== 6) {
      if (req.accepts("json")) {
        return res.status(400).json({ error: "Enter the 6-digit pickup code." });
      }
      req.flash("error", "Enter the 6-digit pickup code.");
      return res.redirect("/vendor/verify");
    }

    const now = new Date();
    const candidate = await Order.findOne({
      shop: req.vendorShopId,
      pickupOtp: otp,
      status: "ready_for_pickup",
    }).populate("customer", "name email");

    if (!candidate) {
      if (req.accepts("json")) {
        return res.status(404).json({ error: "No order waiting for pickup matches that code." });
      }
      req.flash("error", "No order waiting for pickup matches that code.");
      return res.redirect("/vendor/verify");
    }

    // Expiry check runs before completion. A missing timestamp on a legacy
    // order means "no expiry recorded" and is allowed (backward compatible);
    // every order created after this change carries one.
    if (isOtpExpired(candidate.pickupOtpExpiresAt, now)) {
      console.warn("[OTP] rejected expired pickup code:", {
        orderId: String(candidate._id),
        shop: req.vendorShopIdStr,
        expiredAt: candidate.pickupOtpExpiresAt || null,
      });
      if (req.accepts("json")) {
        return res.status(410).json({
          error: "This pickup code has expired. Ask the canteen to re-issue it.",
        });
      }
      req.flash(
        "error",
        "This pickup code has expired. Ask the canteen to re-issue it.",
      );
      return res.redirect("/vendor/verify");
    }

    console.log("Completing order via OTP:", {
      orderId: String(candidate._id),
      statusBefore: candidate.status,
      collectedAtBefore: candidate.collectedAt || null,
    });

    // Atomic completion: only one concurrent request can move the order out of
    // ready_for_pickup, so the code can never complete an order twice.
    const order = await Order.findOneAndUpdate(
      { _id: candidate._id, shop: req.vendorShopId, status: "ready_for_pickup" },
      {
        $set: {
          status: "completed",
          collectedAt: candidate.collectedAt || now,
          pickupMethod: "otp",
        },
      },
      { new: true },
    ).populate("customer", "name email phone");

    if (!order) {
      console.warn(
        "[OTP] order already completed by a concurrent request:",
        String(candidate._id),
      );
      if (req.accepts("json")) {
        return res.status(409).json({ error: "This order was already marked collected." });
      }
      req.flash("error", "This order was already marked collected.");
      return res.redirect("/vendor/verify");
    }

    console.log("Order completed via OTP:", {
      orderId: String(order._id),
      statusAfter: order.status,
      collectedAtAfter: order.collectedAt || null,
    });

    if (req.accepts("json")) {
      return res.json({
        success: true,
        message: `Pickup verified for ${order.customer?.name || "customer"}.`,
        handover: {
          orderNumber: String(order._id).slice(-6).toUpperCase(),
          studentName: order.customer?.name || "Customer",
          phone: order.customer?.phone || "",
          items: (order.items || []).map((i) => ({ name: i.name, quantity: i.quantity })),
          total: order.total,
          pickupTime: order.pickupTime || null,
          collectedAt: order.collectedAt || null,
          method: "otp",
        },
      });
    }

    req.flash(
      "success",
      `Pickup verified for ${order.customer?.name || "customer"}.`,
    );
    return res.redirect("/vendor/verify");
  },
);

// QR pickup verification. The QR payload is a signed token bound to a single
// order + shop + expiry; replay is blocked by the atomic `ready_for_pickup`
// precondition (the same guarantee the OTP flow uses). OTP remains available.
vendorRouter.post(
  "/vendor/verify-qr",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  otpVerifyLimiter,
  async (req, res) => {
    const raw = String((req.body && req.body.qr) || "").trim();

    // Best-match negotiation: a truthy req.accepts("json") is true for every
    // browser form POST (Accept includes */*), which stranded vendors on a
    // raw JSON page. Compare the best match instead (existing codebase pattern).
    const wantsJson = req.accepts(["json", "html"]) === "json";

    if (!raw) {
      if (wantsJson) return res.status(400).json({ error: "Scan or enter a pickup QR code." });
      req.flash("error", "Scan or enter a pickup QR code.");
      return res.redirect("/vendor/verify");
    }

    // Server-authoritative validation: signature, shop binding and expiry.
    const verdict = verifyPickupQr(raw, { shopId: req.vendorShopIdStr });
    if (!verdict.ok) {
      if (verdict.reason === "expired") {
        if (wantsJson) {
          return res
            .status(410)
            .json({ error: "This pickup QR code has expired. Ask the canteen to re-issue it." });
        }
        req.flash("error", "This pickup QR code has expired. Ask the canteen to re-issue it.");
        return res.redirect("/vendor/verify");
      }
      if (verdict.reason === "wrong_shop") {
        if (wantsJson) {
          return res.status(404).json({ error: "This pickup QR code is not for this canteen." });
        }
        req.flash("error", "This pickup QR code is not for this canteen.");
        return res.redirect("/vendor/verify");
      }
      // malformed / forged
      console.warn("[QR] rejected pickup QR:", {
        reason: verdict.reason,
        shop: req.vendorShopIdStr,
      });
      if (wantsJson) return res.status(400).json({ error: "Invalid pickup QR code." });
      req.flash("error", "Invalid pickup QR code.");
      return res.redirect("/vendor/verify");
    }

    // Atomic completion scoped to this vendor's shop. A replayed or already
    // completed QR loses the claim and can never complete an order twice.
    // ponytail: handover built inline; shared helper if a third verify path appears.
    const order = await Order.findOneAndUpdate(
      { _id: verdict.orderId, shop: req.vendorShopId, status: "ready_for_pickup" },
      { $set: { status: "completed", collectedAt: new Date(), pickupMethod: "qr" } },
      { new: true },
    ).populate("customer", "name phone");

    if (!order) {
      const existing = await Order.findOne({
        _id: verdict.orderId,
        shop: req.vendorShopId,
      })
        .select("status")
        .lean();

      if (wantsJson) {
        return res.status(409).json({
          error: existing
            ? "This order was already collected or is not ready for pickup."
            : "Order not found.",
        });
      }
      req.flash(
        "error",
        existing
          ? "This order was already collected or is not ready for pickup."
          : "Order not found.",
      );
      return res.redirect("/vendor/verify");
    }

    if (wantsJson) {
      return res.json({
        success: true,
        message: `Pickup verified for ${order.customer?.name || "customer"}.`,
        handover: {
          orderNumber: String(order._id).slice(-6).toUpperCase(),
          studentName: order.customer?.name || "Customer",
          phone: order.customer?.phone || "",
          items: (order.items || []).map((i) => ({ name: i.name, quantity: i.quantity })),
          total: order.total,
          pickupTime: order.pickupTime || null,
          collectedAt: order.collectedAt || null,
          method: "qr",
        },
      });
    }

    const readyOrders = await Order.find({
      shop: req.vendorShopId,
      status: "ready_for_pickup",
    })
      .sort({ pickupTime: 1, createdAt: 1 })
      .populate("customer", "name")
      .lean();

    return res.render("vendor/verify", {
      pageTitle: "Verify Pickup",
      waitingPickup: readyOrders.length,
      orders: readyOrders,
      handover: {
        orderNumber: String(order._id).slice(-6).toUpperCase(),
        studentName: order.customer?.name || "Customer",
        phone: order.customer?.phone || "",
        items: (order.items || []).map((i) => ({ name: i.name, quantity: i.quantity })),
        total: order.total,
        pickupTime: order.pickupTime || null,
        collectedAt: order.collectedAt || null,
        method: "qr",
      },
    });
  }
);

vendorRouter.post(
  "/vendor/orders/:id/toggle-parcel",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: "Invalid order." });
    }

    const order = await Order.findOne({ _id: id, shop: req.vendorShopId }).lean();
    if (!order) {
      return res.status(404).json({ error: "Order not found." });
    }

    // Parcel type only affects the amount before payment. Once money is
    // captured the stored total must never diverge from what was charged.
    if (order.status !== "pending_payment") {
      return res
        .status(400)
        .json({ error: "Order type can only be changed before payment." });
    }

    const shop = await Shop.findById(order.shop)
      .select("parcelChargeEnabled parcelCharge")
      .lean();
    const targetType = order.orderType === "parcel" ? "dinein" : "parcel";
    const chargePaise = toPaise(computeParcelCharge(shop, targetType)) || 0;

    const totals = computeParcelTotals({
      items: order.items,
      orderType: targetType,
      parcelChargePaise: chargePaise,
      discountPercent: Number(order.discountPercent) || 0,
    });
    if (!totals.ok) {
      return res.status(400).json({ error: "Order contains an invalid item." });
    }

    // Atomic toggle: the current orderType is part of the precondition, so
    // concurrent toggles cannot both apply.
    const updated = await Order.findOneAndUpdate(
      {
        _id: id,
        shop: req.vendorShopId,
        status: "pending_payment",
        orderType: order.orderType,
      },
      {
        $set: {
          orderType: targetType,
          parcelCharge: fromPaise(totals.parcelChargePaise),
          total: fromPaise(totals.totalPaise),
        },
      },
      { new: true },
    ).lean();

    if (!updated) {
      return res.status(409).json({ error: "Order changed. Please retry." });
    }

    return res.json({
      success: true,
      orderType: updated.orderType,
      parcelCharge: updated.parcelCharge,
      total: updated.total,
    });
  },
);

vendorRouter.get(
  "/vendor/orders/:id/adjust",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Invalid order.");
      return res.redirect("/vendor/orders/pending");
    }

    const order = await Order.findById(id)
      .populate("customer", "name email")
      .lean();

    if (
      !order ||
      String(order.shop?._id || order.shop) !== req.vendorShopIdStr
    ) {
      req.flash("error", "Order not found.");
      return res.redirect("/vendor/orders/pending");
    }

    if (!["paid", "accepted"].includes(order.status)) {
      req.flash("error", "Only paid or accepted orders can be adjusted.");
      return res.redirect("/vendor/orders/pending");
    }

    return res.render("vendor/adjust-order", {
      pageTitle: `Adjust Order #${String(order._id).slice(-6).toUpperCase()}`,
      order,
    });
  },
);

vendorRouter.post(
  "/vendor/orders/:id/adjust",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Invalid order.");
      return res.redirect("/vendor/orders/pending");
    }

    const adjustmentReason = String(req.body.adjustmentReason || "").trim();
    if (!adjustmentReason) {
      req.flash("error", "Please select a reason for the adjustment.");
      return res.redirect(`/vendor/orders/${id}/adjust`);
    }

    try {
      const shop = await Shop.findById(req.vendorShopId)
        .select("paymentGateway paymentConfigured paymentSettings")
        .lean();

      const gateway = shop?.paymentGateway || "razorpay";

      const refundFn = async (order, refundPaise) => {
        if (gateway === "razorpay") {
          if (!order.razorpayPaymentId) {
            throw new Error("Invalid payment ID for partial refund.");
          }
          const refund = await partialRefundViaRazorpay(order, shop, refundPaise);
          console.log("Razorpay partial refund successful:", refund.id);
          return refund;
        }
        if (gateway === "phonepe") {
          if (!order.transactionId || !order.gatewayTxnId) {
            throw new Error("Invalid payment ID for partial refund.");
          }
          const result = await partialRefundViaPhonePe(order, shop, refundPaise);
          console.log("PhonePe partial refund response:", result?.code || result);
          return result;
        }
        throw new Error("Refunds not supported for this payment method.");
      };

      const result = await adjustOrderPaid({
        orderId: id,
        shopId: req.vendorShopId,
        keepRaw: req.body.keep_items,
        adjustmentReason,
        adjustedBy: req.user._id,
        refundFn,
      });

      if (!result.ok) {
        const backToForm = [
          "all_removed",
          "none_removed",
          "invalid_index",
          "out_of_range",
          "invalid_item",
          "would_exceed_charged",
          "invalid_charged_amount",
        ].includes(result.reason);

        if (result.reason === "refund_failed") {
          console.error(
            "Partial refund error:",
            result.error?.message || result.error,
          );
        }

        const messages = {
          not_found: "Order not found.",
          invalid_status: "Only paid or accepted orders can be adjusted.",
          all_removed: "All items would be removed. Use Cancel Order instead.",
          none_removed: "No items were removed. No adjustment needed.",
          invalid_index: "The adjustment selection was invalid.",
          out_of_range: "The adjustment selection was invalid.",
          invalid_item: "The order contains an invalid item.",
          would_exceed_charged:
            "This adjustment would increase the amount owed. Please contact support.",
          conflict: "This order was already adjusted.",
          invalid_charged_amount:
            "Order has no chargeable amount. Please reconcile manually.",
          refund_failed:
            "Order adjusted but refund could not be processed automatically. Please process manually from the payment dashboard.",
        };

        req.flash(
          "error",
          messages[result.reason] || "Could not adjust this order.",
        );
        return res.redirect(
          backToForm ? `/vendor/orders/${id}/adjust` : "/vendor/orders/pending",
        );
      }

      const refundRupees = (result.refundPaise / 100).toFixed(2);
      req.flash(
        "success",
        `Order adjusted. Refund of ₹${refundRupees} processed.`,
      );
      return res.redirect("/vendor/orders/pending");
    } catch (err) {
      console.error("ADJUST ERROR:", err);
      req.flash("error", "Could not adjust this order. Please try again.");
      return res.redirect(`/vendor/orders/${id}/adjust`);
    }
  },
);

vendorRouter.get(
  "/vendor/orders/completed",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    const orders = await Order.find({
      shop: req.vendorShopId,
      status: { $in: ["completed", "cancelled"] },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.render("vendor/completed-orders", {
      pageTitle: "Completed & Cancelled Orders",
      orders,
    });
  },
);

vendorRouter.get(
  "/vendor/orders/:id",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Order not found.");
      return res.redirect("/vendor/orders/pending");
    }

    const order = await Order.findById(id)
      .populate("customer", "name email")
      .populate("shop", "name slug")
      .lean();

    if (
      !order ||
      String(order.shop?._id || order.shop) !== req.vendorShopIdStr
    ) {
      req.flash("error", "Order not found.");
      return res.redirect("/vendor/orders/pending");
    }

    const referrer = req.get("Referrer");
    let backHref = "/vendor/orders/pending";
    if (referrer) {
      try {
        const referrerUrl = new URL(referrer);
        if (referrerUrl.host === req.get("host")) {
          backHref = `${referrerUrl.pathname}${referrerUrl.search}`;
        }
      } catch {
        if (referrer.startsWith("/")) {
          backHref = referrer;
        }
      }
    }

    return res.render("vendor/order-details", {
      pageTitle: `Order #${String(order._id).slice(-6).toUpperCase()}`,
      order,
      backHref,
    });
  },
);

vendorRouter.get(
  "/vendor/payment/settings",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    try {
      const shop = await Shop.findById(req.vendorShopId).lean();
      if (!shop) {
        req.flash("error", "Shop not found.");
        return res.redirect("/vendor/menu");
      }

      return res.render("vendor/payment-settings", {
        pageTitle: "Payment Settings",
        shop,
      });
    } catch (err) {
      console.error("Error fetching payment settings:", err);
      req.flash("error", "Failed to load payment settings.");
      return res.redirect("/vendor/menu");
    }
  },
);

vendorRouter.post(
  "/vendor/payment/settings",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    try {
      const {
        paymentGateway,
        razorpayKeyId,
        razorpayKeySecret,
        razorpayWebhookSecret,
        easebuzzMerchantKey,
        easebuzzSalt,
        easebuzzEnv,
        phonepeClientId,
        phonepeClientSecret,
        phonepeClientVersion,
        phonepeEnv,
      } = req.body;

      const shop = await Shop.findById(req.vendorShopId);
      if (!shop) {
        req.flash("error", "Shop not found.");
        return res.redirect("/vendor/payment/settings");
      }

      if (paymentGateway !== undefined) {
        if (
          !["razorpay", "easebuzz", "phonepe", "paytm", "bharatpe"].includes(
            paymentGateway,
          )
        ) {
          req.flash("error", "Invalid payment gateway.");
          return res.redirect("/vendor/payment/settings");
        }
        shop.paymentGateway = paymentGateway;
      }

      const keyId = String(razorpayKeyId || "").trim();
      if (keyId) {
        shop.paymentSettings.razorpay.keyId = keyId;
      }

      if (razorpayKeySecret !== undefined && String(razorpayKeySecret).trim()) {
        shop.paymentSettings.razorpay.keySecret =
          String(razorpayKeySecret).trim();
      }

      if (
        razorpayWebhookSecret !== undefined &&
        String(razorpayWebhookSecret).trim()
      ) {
        shop.paymentSettings.razorpay.webhookSecret =
          String(razorpayWebhookSecret).trim();
      }

      const merchantKey = String(easebuzzMerchantKey || "").trim();
      if (merchantKey) {
        shop.paymentSettings.easebuzz.merchantKey = merchantKey;
      }
      if (easebuzzSalt !== undefined && String(easebuzzSalt).trim()) {
        shop.paymentSettings.easebuzz.salt = String(easebuzzSalt).trim();
      }
      if (easebuzzEnv !== undefined && ["test", "prod"].includes(easebuzzEnv)) {
        shop.paymentSettings.easebuzz.env = easebuzzEnv;
      }

      const ppClientId = String(phonepeClientId || "").trim();
      if (ppClientId) {
        shop.paymentSettings.phonepe.clientId = ppClientId;
      }
      if (
        phonepeClientSecret !== undefined &&
        String(phonepeClientSecret).trim()
      ) {
        shop.paymentSettings.phonepe.clientSecret =
          String(phonepeClientSecret).trim();
      }
      if (
        phonepeClientVersion !== undefined &&
        String(phonepeClientVersion).trim()
      ) {
        shop.paymentSettings.phonepe.clientVersion =
          String(phonepeClientVersion).trim();
      }
      if (phonepeEnv !== undefined && ["UAT", "PROD"].includes(phonepeEnv)) {
        shop.paymentSettings.phonepe.env = phonepeEnv;
      }

      shop.paymentConfigured = isGatewayConfigured(shop);

      await shop.save();

      req.flash("success", "Payment settings saved successfully.");
      return res.redirect("/vendor/payment/settings");
    } catch (err) {
      console.error("Error updating payment settings:", err);
      req.flash("error", "Failed to save payment settings.");
      return res.redirect("/vendor/payment/settings");
    }
  },
);
