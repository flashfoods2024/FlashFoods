import express from "express";
import crypto from "crypto";
import mongoose from "mongoose";
import { MenuItem } from "../models/MenuItem.js";
import { Shop } from "../models/Shop.js";
import { Order } from "../models/Order.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireAuth, requireStudent } from "../middleware/auth.js";
import { generateOtp } from "../utils/otp.js";
import { createRazorpayFromShop } from "../config/razorpay.js";
import {
  getEasebuzzFromShop,
  buildPaymentHash,
  verifyResponseHash,
  initiatePayment,
  easebuzzPayUrl,
} from "../config/easebuzz.js";
export const ordersRouter = express.Router();

// Build order line items + total from the session cart, validating each item
// against the shop. Shared by the Easebuzz initiate flow. Returns null when
// nothing orderable remains.
async function buildOrderItemsFromCart(cart) {
  const ids = cart.items.map((l) => l.menuItemId);
  const menuItems = await MenuItem.find({
    _id: { $in: ids },
    shop: cart.shopId,
    available: true,
  }).lean();
  const byId = new Map(menuItems.map((m) => [String(m._id), m]));

  const orderItems = [];
  let total = 0;
  for (const line of cart.items) {
    const m = byId.get(String(line.menuItemId));
    if (!m) continue;
    const q = Math.max(1, Math.min(99, Number(line.quantity) || 1));
    orderItems.push({ menuItem: m._id, name: m.name, price: m.price, quantity: q });
    total += m.price * q;
  }
  if (!orderItems.length) return null;
  return { orderItems, total };
}

function getCart(req) {
  if (!req.session.cart || typeof req.session.cart !== "object") {
    req.session.cart = { shopId: null, items: [] };
  }
  if (!Array.isArray(req.session.cart.items)) req.session.cart.items = [];
  return req.session.cart;
}

ordersRouter.post(
  "/create-razorpay-order",
  requireDb,
  requireAuth,
  requireStudent,
  async (req, res) => {
    try {
      const { pickupTime } = req.body;
      const cart = getCart(req);

      if (!cart.shopId || !cart.items.length) {
        return res.status(400).json({ error: "Cart is empty" });
      }

      const shop = await Shop.findById(cart.shopId).lean();
      if (!shop || shop.isActive === false || shop.isOpen === false) {
        return res.status(400).json({ error: "This shop is currently closed." });
      }

      // Build the order line items from the cart and compute the total
      // server-side so the charged amount cannot be tampered with client-side.
      const ids = cart.items.map((l) => l.menuItemId);
      const menuItems = await MenuItem.find({
        _id: { $in: ids },
        shop: cart.shopId,
        available: true,
      }).lean();
      const byId = new Map(menuItems.map((m) => [String(m._id), m]));

      const orderItems = [];
      let total = 0;
      for (const line of cart.items) {
        const m = byId.get(String(line.menuItemId));
        if (!m) continue;
        const q = Math.max(1, Math.min(99, Number(line.quantity) || 1));
        orderItems.push({ menuItem: m._id, name: m.name, price: m.price, quantity: q });
        total += m.price * q;
      }

      if (!orderItems.length) {
        return res.status(400).json({ error: "Nothing in your cart is available to order." });
      }

      const { keyId, instance } = createRazorpayFromShop(shop);

      const rzpOrder = await instance.orders.create({
        amount: Math.round(total * 100),
        currency: "INR",
        receipt: `receipt_${Date.now()}`,
      });

      // Persist a pending order immediately. This gives webhooks a stable
      // identifier (razorpayOrderId) to look up, and is intentionally created
      // with status "pending_payment" so it is excluded from vendor workflows
      // until payment is confirmed (by /verify-payment or the webhook).
      await Order.create({
        customer: req.session.userId,
        shop: cart.shopId,
        items: orderItems,
        total,
        pickupTime: pickupTime ? new Date(pickupTime) : null,
        status: "pending_payment",
        pickupOtp: generateOtp(),
        paymentNote: "pending",
        transactionId: "",
        razorpayOrderId: rzpOrder.id,
      });

      res.json({ ...rzpOrder, key_id: keyId });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create Razorpay order" });
    }
  }
);

ordersRouter.post(
  "/verify-payment",
  requireDb,
  requireAuth,
  requireStudent,
  async (req, res) => {
    try {
      const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      pickupTime,
} = req.body;

      const cart = getCart(req);

      if (!cart.shopId || !cart.items.length) {
        return res.status(400).json({
          success: false,
          message: "Cart is empty",
        });
      }

      const sign = razorpay_order_id + "|" + razorpay_payment_id;

      const paymentShop = await Shop.findById(cart.shopId)
        .select("paymentConfigured paymentSettings")
        .lean();
      const { keySecret } = createRazorpayFromShop(paymentShop);

      const expectedSign = crypto
        .createHmac("sha256", keySecret)
        .update(sign.toString())
        .digest("hex");

      const isAuthentic = expectedSign === razorpay_signature;

      if (!isAuthentic) {
        return res.status(400).json({
          success: false,
          message: "Invalid payment signature",
        });
      }

      // Locate the pending order created in /create-razorpay-order using the
      // existing Razorpay order identifier. We do NOT create a new record here.
      const order = await Order.findOne({ razorpayOrderId: razorpay_order_id });
      if (!order || String(order.customer) !== String(req.session.userId)) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      // Idempotency / fallback safety: if the webhook (or a previous verify)
      // already moved the order out of pending_payment, just return success
      // without re-processing.
      if (order.status !== "pending_payment") {
        req.session.cart = { shopId: null, items: [] };
        return res.json({ success: true, orderId: order._id });
      }

      order.status = "paid";
      order.paymentNote = razorpay_payment_id;
      order.transactionId = razorpay_payment_id;
      order.razorpayPaymentId = razorpay_payment_id;
      await order.save();

      req.session.cart = {
        shopId: null,
        items: [],
      };

      return res.json({
        success: true,
        orderId: order._id,
      });
    } catch (err) {
      console.error(err);

      return res.status(500).json({
        success: false,
        message: "Payment verification failed",
      });
    }
  }
);

// --- Easebuzz hosted checkout -------------------------------------------
//
// Initiate: create the pending order up front (reusing the same pending-order
// tracking pattern as Razorpay), then return the params the browser must POST
// to the Easebuzz hosted payment page. The order's _id is used as the txnid so
// the callback can reconcile against an existing record (via gatewayTxnId).
ordersRouter.post(
  "/easebuzz/initiate",
  requireDb,
  requireAuth,
  requireStudent,
  async (req, res) => {
    try {
      const { pickupTime } = req.body;
      const cart = getCart(req);

      if (!cart.shopId || !cart.items.length) {
        return res.status(400).json({ error: "Cart is empty" });
      }

      const shop = await Shop.findById(cart.shopId).lean();
      if (!shop || shop.isActive === false || shop.isOpen === false) {
        return res.status(400).json({ error: "This shop is currently closed." });
      }
      if (shop.paymentGateway !== "easebuzz") {
        return res.status(400).json({ error: "This shop is not using Easebuzz." });
      }

      const built = await buildOrderItemsFromCart(cart);
      if (!built) {
        return res.status(400).json({ error: "Nothing in your cart is available to order." });
      }
      const { orderItems, total } = built;

      const { merchantKey, salt, baseUrl } = getEasebuzzFromShop(shop);
      if (!merchantKey || !salt) {
        return res.status(500).json({ error: "Easebuzz is not configured for this shop." });
      }

      const user = req.user || {};
      const amount = total.toFixed(2);
      const txnid = new mongoose.Types.ObjectId().toString();
      const productinfo = `FlashFoods order - ${shop.name}`;
      const firstname = String(user.name || "Customer").slice(0, 60);
      const email = String(user.email || "customer@flashfoods.local");

      // Persist the pending order before redirecting to the gateway.
      await Order.create({
        customer: req.session.userId,
        shop: cart.shopId,
        items: orderItems,
        total,
        pickupTime: pickupTime ? new Date(pickupTime) : null,
        status: "pending_payment",
        pickupOtp: generateOtp(),
        paymentNote: "pending",
        transactionId: "",
        gatewayTxnId: txnid,
      });

      const hash = buildPaymentHash({
        merchantKey,
        salt,
        txnid,
        amount,
        productinfo,
        firstname,
        email,
      });

      const origin = `${req.protocol}://${req.get("host")}`;
      const params = {
        key: merchantKey,
        txnid,
        amount,
        productinfo,
        firstname,
        email,
        phone: "9999999999",
        surl: `${origin}/easebuzz/callback`,
        furl: `${origin}/easebuzz/callback`,
        hash,
      };

      // Step 1: server-to-server initiate. Easebuzz returns an access key on
      // success which we turn into the hosted payment page URL.
      const result = await initiatePayment(params, baseUrl);

      if (!result || Number(result.status) !== 1 || !result.data) {
        console.error("Easebuzz initiateLink rejected:", result?.data || result);
        return res.status(502).json({
          error: typeof result?.data === "string" ? result.data : "Easebuzz declined the payment request.",
        });
      }

      return res.json({ redirectUrl: easebuzzPayUrl(baseUrl, result.data) });
    } catch (err) {
      console.error("Easebuzz initiate failed:", err);
      return res.status(500).json({ error: "Failed to initiate Easebuzz payment" });
    }
  }
);

// Callback: Easebuzz redirects (POST) the payment result here. Verify the
// response hash, then reconcile the existing pending order by gatewayTxnId.
// Only transitions orders still in pending_payment so this is idempotent.
ordersRouter.post(
  "/easebuzz/callback",
  requireDb,
  async (req, res) => {
    try {
      const payload = req.body || {};
      const txnid = payload.txnid;

      const order = txnid ? await Order.findOne({ gatewayTxnId: txnid }) : null;
      if (!order) {
        req.flash?.("error", "Payment could not be matched to an order.");
        return res.redirect("/orders");
      }

      const shop = await Shop.findById(order.shop)
        .select("paymentSettings paymentGateway")
        .lean();
      const { merchantKey, salt } = getEasebuzzFromShop(shop);

      const valid = verifyResponseHash({ merchantKey, salt, payload });
      if (!valid) {
        return res.redirect(`/orders/${order._id}`);
      }

      if (order.status === "pending_payment") {
        const success = String(payload.status).toLowerCase() === "success";
        order.status = success ? "paid" : "cancelled";
        order.paymentNote = payload.easepayid || payload.status || "easebuzz";
        order.transactionId = payload.easepayid || "";
        await order.save();
      }

      return res.redirect(`/orders/${order._id}`);
    } catch (err) {
      console.error("Easebuzz callback failed:", err);
      return res.redirect("/orders");
    }
  }
);

ordersRouter.post(
  "/orders/checkout",
  requireDb,
  requireAuth,
  requireStudent,
  async (req, res) => {
    const cart = getCart(req);
    if (!cart.shopId || !cart.items.length) {
      req.flash("error", "Your cart is empty.");
      return res.redirect("/cart");
    }

    const shop = await Shop.findById(cart.shopId).lean();
    if (!shop) {
      req.session.cart = { shopId: null, items: [] };
      req.flash("error", "That canteen no longer exists.");
      return res.redirect("/shops");
    }
    if (shop.isActive === false || shop.isOpen === false) {
      req.flash("error", "This shop is currently closed.");
      return res.redirect("/cart");
    }

    const ids = cart.items.map((l) => l.menuItemId);
    const menuItems = await MenuItem.find({
      _id: { $in: ids },
      shop: cart.shopId,
      available: true,
    }).lean();

    const byId = new Map(menuItems.map((m) => [String(m._id), m]));
    const orderItems = [];
    let total = 0;

    for (const line of cart.items) {
      const m = byId.get(String(line.menuItemId));
      if (!m) continue;
      const q = Math.max(1, Math.min(99, Number(line.quantity) || 1));
      orderItems.push({
        menuItem: m._id,
        name: m.name,
        price: m.price,
        quantity: q,
      });
      total += m.price * q;
    }

    if (!orderItems.length) {
      req.flash("error", "Nothing in your cart is available to order.");
      return res.redirect("/cart");
    }

    const pickupOtp = generateOtp();

    const order = await Order.create({
  customer: req.session.userId,
  shop: cart.shopId,
  items: orderItems,
  total,
  pickupTime: req.body.pickupTime
    ? new Date(req.body.pickupTime)
    : null,
  status: "paid",
  pickupOtp,
  paymentNote: "mock",
  transactionId: "mock",
});

    req.session.cart = { shopId: null, items: [] };
    req.flash(
      "success",
      "Order placed (paid). You’ll get a pickup code after the canteen marks it ready.",
    );
    return res.redirect(`/orders/${order._id}`);
  },
);

ordersRouter.get(
  "/orders",
  requireDb,
  requireAuth,
  requireStudent,
  async (req, res) => {
    const orders = await Order.find({ customer: req.session.userId })
      .sort({ createdAt: -1 })
      .populate("shop", "name slug")
      .lean();
    res.render("orders/index", { pageTitle: "Orders", orders });
  },
);

ordersRouter.get(
  "/api/orders/:id/status",
  requireDb,
  requireAuth,
  requireStudent,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ error: "Order not found." });
    }

    const order = await Order.findById(id).select("customer status").lean();
    if (!order || String(order.customer) !== String(req.session.userId)) {
      return res.status(404).json({ error: "Order not found." });
    }

    return res.json({ status: order.status });
  },
);

ordersRouter.get(
  "/orders/:id",
  requireDb,
  requireAuth,
  requireStudent,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Order not found.");
      return res.redirect("/orders");
    }
    const order = await Order.findById(id).populate("shop", "name slug").lean();
    if (!order || String(order.customer) !== String(req.session.userId)) {
      req.flash("error", "Order not found.");
      return res.redirect("/orders");
    }
    res.render("orders/show", {
      pageTitle: `Order ${String(order._id).slice(-6)}`,
      order,
    });
  },
);
