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

export const vendorRouter = express.Router();

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

async function refundViaRazorpay(order, shop) {
  const { instance } = createRazorpayFromShop(shop);
  const paymentId = order.razorpayPaymentId;

  const payment = await instance.payments.fetch(paymentId);
  if (payment.status !== "captured") {
    throw new Error("Only captured payments can be refunded.");
  }

  return instance.payments.refund(paymentId, {
    amount: Math.round(order.total * 100),
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
    amount: order.total,
    merchantRefundId,
    env: phonepe.env,
  });
}

// Partial refund helpers — used by the adjust route to refund only the
// removed items (refundAmount), not the entire order.
async function partialRefundViaRazorpay(order, shop, refundAmount) {
  const { instance } = createRazorpayFromShop(shop);
  const paymentId = order.razorpayPaymentId;

  const payment = await instance.payments.fetch(paymentId);
  if (payment.status !== "captured") {
    throw new Error("Only captured payments can be refunded.");
  }

  return instance.payments.refund(paymentId, {
    amount: Math.round(refundAmount * 100),
    speed: "normal",
    notes: { reason: `Adjustment refund: ${order.adjustmentReason || "Items removed"}` },
  });
}

async function partialRefundViaPhonePe(order, shop, refundAmount) {
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
    amount: refundAmount,
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

// Shared query for vendor pending orders. Used by both the HTML route and the
// JSON polling endpoint so the match/sort logic stays in one place.
// Matches paid & accepted orders for the shop and orders them by pickup priority
// (pickupTime, falling back to createdAt) then createdAt.
async function getPendingOrders(shopId) {
  return Order.aggregate([
    {
      $match: {
        shop: shopId,
        status: { $in: ["paid", "accepted"] },
      },
    },
    {
      $addFields: {
        priorityTime: { $ifNull: ["$pickupTime", "$createdAt"] },
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
        status: order.status,
        total: Number(order.total),
        parcelCharge: Number(order.parcelCharge) || 0,
        pickupTime: order.pickupTime ? order.pickupTime.toISOString() : null,
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

    const order = await Order.findById(id);
    if (!order || String(order.shop) !== req.vendorShopIdStr) {
      req.flash("error", "Order not found.");
      return res.redirect("/vendor/orders/pending");
    }

    if (order.status !== "accepted") {
      req.flash("error", "That order is not awaiting confirmation.");
      return res.redirect("/vendor/orders/pending");
    }

    order.status = "ready_for_pickup";
    order.readyAt = order.readyAt || new Date();
    await order.save();

    emitPendingCount(order.shop);

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

    const order = await Order.findById(id);
    if (!order || String(order.shop) !== req.vendorShopIdStr) {
      req.flash("error", "Order not found.");
      return res.redirect("/vendor/orders/pending");
    }

    if (order.status !== "paid") {
      req.flash("error", "Only paid orders can be accepted.");
      return res.redirect("/vendor/orders/pending");
    }

    order.status = "accepted";
    await order.save();

    emitPendingCount(order.shop);

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
    let order = null;

    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        req.flash("error", "Order not found.");
        return res.redirect("/vendor/orders/pending");
      }

      order = await Order.findOne({
        _id: req.params.id,
        shop: req.vendorShopId,
      });

      if (!order) {
        req.flash("error", "Order not found.");
        return res.redirect("/vendor/orders/pending");
      }

      if (order.status !== "paid") {
        req.flash("error", "Only paid orders can be cancelled.");
        return res.redirect("/vendor/orders/pending");
      }

      const shop = await Shop.findById(req.vendorShopId)
        .select("paymentGateway paymentConfigured paymentSettings")
        .lean();

      const gateway = shop?.paymentGateway || "razorpay";

      // Mock/offline orders — no real payment to refund, just cancel.
      if (order.paymentNote === "mock") {
        order.status = "cancelled";
        order.refundStatus = "completed";
        await order.save();
        emitPendingCount(order.shop);
        req.flash("success", "Order cancelled.");
        return res.redirect("/vendor/orders/pending");
      }

      order.refundStatus = "pending";
      await order.save();

      if (gateway === "razorpay") {
        if (!order.razorpayPaymentId) {
          order.refundStatus = "failed";
          await order.save();
          req.flash("error", "Invalid payment ID.");
          return res.redirect("/vendor/orders/pending");
        }
        const refund = await refundViaRazorpay(order, shop);
        console.log("Razorpay refund successful:", refund.id);
      } else if (gateway === "phonepe") {
        if (!order.transactionId || !order.gatewayTxnId) {
          order.refundStatus = "failed";
          await order.save();
          req.flash("error", "Invalid payment ID.");
          return res.redirect("/vendor/orders/pending");
        }
        const result = await refundViaPhonePe(order, shop);
        console.log("PhonePe refund response:", result?.code || result);
      } else {
        order.refundStatus = "failed";
        await order.save();
        req.flash("error", "Refunds not supported for this payment method.");
        return res.redirect("/vendor/orders/pending");
      }

      order.status = "cancelled";
      order.refundStatus = "completed";

      await order.save();

      emitPendingCount(order.shop);

      req.flash("success", "Order cancelled and refund initiated.");

      return res.redirect("/vendor/orders/pending");
    } catch (error) {
      console.error("REFUND ERROR:", error);

      if (error?.error) {
        console.error(error.error);
      }

      if (order) {
        order.refundStatus = "failed";

        await order.save();
      }

      req.flash(
        "error",
        "Refund failed. Please process manually from the payment dashboard.",
      );

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
  async (req, res) => {
    const raw = String((req.body && req.body.otp) || "").replace(/\D/g, "");
    const otp = raw.slice(0, 6);

    if (otp.length !== 6) {
      req.flash("error", "Enter the 6-digit pickup code.");
      return res.redirect("/vendor/verify");
    }

    const order = await Order.findOne({
      shop: req.vendorShopId,
      pickupOtp: otp,
      status: "ready_for_pickup",
    }).populate("customer", "name email");

    if (!order) {
      req.flash("error", "No order waiting for pickup matches that code.");
      return res.redirect("/vendor/verify");
    }

    console.log("Completing order via OTP:", {
      orderId: String(order._id),
      statusBefore: order.status,
      collectedAtBefore: order.collectedAt || null,
    });

    order.status = "completed";
    if (!order.collectedAt) {
      order.collectedAt = new Date();
    }
    await order.save();

    const persistedCollection = await Order.findById(order._id)
      .select("status collectedAt")
      .lean();

    console.log("Order completed via OTP:", {
      orderId: String(order._id),
      statusAfter: persistedCollection?.status || order.status,
      collectedAtAfter: persistedCollection?.collectedAt || null,
    });

    req.flash(
      "success",
      `Pickup verified for ${order.customer?.name || "customer"}.`,
    );
    return res.redirect("/vendor/verify");
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

    const order = await Order.findById(id);
    if (!order || String(order.shop) !== req.vendorShopIdStr) {
      req.flash("error", "Order not found.");
      return res.redirect("/vendor/orders/pending");
    }

    if (!["paid", "accepted"].includes(order.status)) {
      req.flash("error", "Only paid or accepted orders can be adjusted.");
      return res.redirect("/vendor/orders/pending");
    }

    const rawKeep = req.body.keep_items;
    const keepArr = Array.isArray(rawKeep) ? rawKeep : [rawKeep].filter(Boolean);
    const keepIndices = keepArr
      .map((v) => parseInt(v, 10))
      .filter((n) => !isNaN(n) && n >= 0);

    const adjustmentReason = String(req.body.adjustmentReason || "").trim();
    if (!adjustmentReason) {
      req.flash("error", "Please select a reason for the adjustment.");
      return res.redirect(`/vendor/orders/${id}/adjust`);
    }

    if (keepIndices.length === 0) {
      req.flash("error", "All items would be removed. Use Cancel Order instead.");
      return res.redirect(`/vendor/orders/${id}/adjust`);
    }

    if (keepIndices.length === order.items.length) {
      req.flash("error", "No items were removed. No adjustment needed.");
      return res.redirect(`/vendor/orders/${id}/adjust`);
    }

    let originalTotal = Number(order.total);
    let updatedTotal = 0;

    for (let i = 0; i < order.items.length; i++) {
      const item = order.items[i];
      if (keepIndices.includes(i)) {
        item.status = "active";
        updatedTotal += Number(item.price) * Number(item.quantity);
      } else {
        item.status = "removed";
      }
    }

    const refundAmount = originalTotal - updatedTotal;

    order.originalTotal = originalTotal;
    order.updatedTotal = updatedTotal;
    order.refundAmount = refundAmount;
    order.total = updatedTotal;
    order.adjustedAt = new Date();
    order.adjustedBy = req.user._id;
    order.adjustmentReason = adjustmentReason;
    order.refundStatus = "none";

    // --- Payment refund --------------------------------------------------
    if (refundAmount > 0) {
      const shop = await Shop.findById(req.vendorShopId)
        .select("paymentGateway paymentConfigured paymentSettings")
        .lean();

      const gateway = shop?.paymentGateway || "razorpay";

      if (order.paymentNote === "mock") {
        // Mock/offline orders — no real payment to refund.
        order.refundStatus = "completed";
      } else {
        try {
          if (gateway === "razorpay") {
            if (!order.razorpayPaymentId) {
              throw new Error("Invalid payment ID for partial refund.");
            }
            const refund = await partialRefundViaRazorpay(order, shop, refundAmount);
            console.log("Razorpay partial refund successful:", refund.id);
            order.refundStatus = "completed";
          } else if (gateway === "phonepe") {
            if (!order.transactionId || !order.gatewayTxnId) {
              throw new Error("Invalid payment ID for partial refund.");
            }
            const result = await partialRefundViaPhonePe(order, shop, refundAmount);
            console.log("PhonePe partial refund response:", result?.code || result);
            order.refundStatus = "completed";
          } else {
            // Unsupported gateway — mark pending so vendor processes manually.
            order.refundStatus = "pending";
          }
        } catch (err) {
          console.error("Partial refund error:", err);
          order.refundStatus = "pending";
        }
      }
    } else {
      order.refundStatus = "completed";
    }

    await order.save();

    if (order.refundStatus === "pending") {
      req.flash("error", "Order adjusted but refund could not be processed automatically. Please process manually from the payment dashboard.");
    } else {
      req.flash("success", `Order adjusted. Refund of ₹${refundAmount.toFixed(2)} processed.`);
    }
    return res.redirect("/vendor/orders/pending");
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
        parcelCharge,
        razorpayKeyId,
        razorpayKeySecret,
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

      if (parcelCharge !== undefined) {
        const charge = Number(parcelCharge);
        if (!isNaN(charge) && charge >= 0) {
          shop.parcelCharge = charge;
        }
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
