import express from "express";
import crypto from "crypto";
import mongoose from "mongoose";
import { MenuItem } from "../models/MenuItem.js";
import { Shop } from "../models/Shop.js";
import { Order } from "../models/Order.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireAuth, requireStudent } from "../middleware/auth.js";
import { generateOtp } from "../utils/otp.js";
import { validatePickupTime } from "../utils/time.js";
import { createRazorpayFromShop } from "../config/razorpay.js";
import {
  getEasebuzzFromShop,
  buildPaymentHash,
  verifyResponseHash,
  initiatePayment as easebuzzInitiatePayment,
  easebuzzPayUrl,
} from "../config/easebuzz.js";
import {
  getPhonepeFromShop,
  getAuthToken,
  createPayment,
  getOrderStatus,
} from "../config/phonepe.js";
import { emitPendingCount } from "../socket/index.js";
export const ordersRouter = express.Router();

// Build a single order item from a cart line, looking up current MenuItem data.
// Returns null when the menu item is no longer available.
async function buildOrderItemFromLine(line) {
  const m = await MenuItem.findById(line.menuItemId).lean();
  if (!m || !m.available) return null;
  const q = Math.max(1, Math.min(99, Number(line.quantity) || 1));
  var variantId = line.variantId != null ? Number(line.variantId) : null;
  var variantName = null;
  var variantPrice = null;
  var price = m.price;
  var variants = m.variants || [];
  if (variantId != null && variants[variantId]) {
    variantName = variants[variantId].label;
    variantPrice = variants[variantId].price;
    price = variantPrice;
  }
  return {
    menuItem: m._id,
    name: m.name,
    price: price,
    quantity: q,
    variantId: variantId,
    variantName: variantName,
    variantPrice: variantPrice,
  };
}

// Build order line items + total from the session cart, validating each item
// against the shop. Shared by all payment gateway flows. Returns null when
// nothing orderable remains.
async function buildOrderItemsFromCart(cart, parcelCharge) {
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
    var variantId = line.variantId != null ? Number(line.variantId) : null;
    var variantName = null;
    var variantPrice = null;
    var price = m.price;
    var variants = m.variants || [];
    if (variantId != null && variants[variantId]) {
      variantName = variants[variantId].label;
      variantPrice = variants[variantId].price;
      price = variantPrice;
    }
    orderItems.push({
      menuItem: m._id,
      name: m.name,
      price: price,
      quantity: q,
      variantId: variantId,
      variantName: variantName,
      variantPrice: variantPrice,
    });
    total += price * q;
  }
  if (!orderItems.length) return null;
  const charge = Math.max(0, Number(parcelCharge) || 0);
  return { orderItems, total: total + charge, parcelCharge: charge };
}

// Validate that every cart item requiring variant selection has one.
// Returns an array of item names missing variant selection.
async function validateCartVariants(cart) {
  const ids = cart.items.map((l) => l.menuItemId);
  const menuItems = await MenuItem.find({ _id: { $in: ids } }).lean();
  const byId = new Map(menuItems.map((m) => [String(m._id), m]));
  var missing = [];
  for (const line of cart.items) {
    var m = byId.get(String(line.menuItemId));
    if (!m) continue;
    var variants = m.variants || [];
    if (variants.length > 1) {
      var vi = line.variantId != null ? Number(line.variantId) : null;
      if (vi == null || !variants[vi]) {
        missing.push(m.name);
      }
    }
  }
  return missing;
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
        return res
          .status(400)
          .json({ error: "This shop is currently closed." });
      }
      if (shop.paymentGateway !== "razorpay") {
        return res
          .status(400)
          .json({ error: "This shop is not using Razorpay." });
      }

      // Validate variants before proceeding
      var missingVariants = await validateCartVariants(cart);
      if (missingVariants.length > 0) {
        return res.status(400).json({
          error: "Variant selection required",
          missingItems: missingVariants,
        });
      }

      // Build the order line items from the cart and compute the total
      // server-side so the charged amount cannot be tampered with client-side.
      const built = await buildOrderItemsFromCart(cart, shop.parcelCharge);
      if (!built) {
        return res
          .status(400)
          .json({ error: "Nothing in your cart is available to order." });
      }
      const { orderItems, total, parcelCharge } = built;

      const pickupValidation = validatePickupTime(pickupTime);
      if (!pickupValidation.valid) {
        return res.status(400).json({ error: pickupValidation.error });
      }

      const { keyId, instance } = createRazorpayFromShop(shop);

      const rzpOrder = await instance.orders.create({
        amount: Math.round(total * 100),
        currency: "INR",
        receipt: `receipt_${Date.now()}`,
      });

      await Order.create({
        customer: req.session.userId,
        shop: cart.shopId,
        items: orderItems,
        total,
        parcelCharge,
        pickupTime: pickupValidation.date || null,
        status: "pending_payment",
        pickupOtp: generateOtp(),
        paymentNote: "pending",
        transactionId: "",
        razorpayOrderId: rzpOrder.id,
      });

      return res.json({ ...rzpOrder, key_id: keyId });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to create Razorpay order" });
    }
  },
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
        .select("paymentGateway paymentConfigured paymentSettings")
        .lean();
      if (paymentShop && paymentShop.paymentGateway !== "razorpay") {
        return res.status(400).json({
          success: false,
          message: "This shop is not using Razorpay.",
        });
      }

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

      const order = await Order.findOne({ razorpayOrderId: razorpay_order_id });
      if (!order || String(order.customer) !== String(req.session.userId)) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      if (order.status !== "pending_payment") {
        req.session.cart = { shopId: null, items: [] };
        return res.json({ success: true, orderId: order._id });
      }

      order.status = "paid";
      order.paymentNote = razorpay_payment_id;
      order.transactionId = razorpay_payment_id;
      order.razorpayPaymentId = razorpay_payment_id;
      await order.save();

      emitPendingCount(order.shop);

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
  },
);

// --- Easebuzz hosted checkout -------------------------------------------
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
        return res
          .status(400)
          .json({ error: "This shop is currently closed." });
      }
      if (shop.paymentGateway !== "easebuzz") {
        return res
          .status(400)
          .json({ error: "This shop is not using Easebuzz." });
      }

      // Validate variants before proceeding
      var missingVariants = await validateCartVariants(cart);
      if (missingVariants.length > 0) {
        return res.status(400).json({
          error: "Variant selection required",
          missingItems: missingVariants,
        });
      }

      const built = await buildOrderItemsFromCart(cart, shop.parcelCharge);
      if (!built) {
        return res
          .status(400)
          .json({ error: "Nothing in your cart is available to order." });
      }
      const { orderItems, total, parcelCharge } = built;

      const { merchantKey, salt, baseUrl } = getEasebuzzFromShop(shop);
      if (!merchantKey || !salt) {
        return res
          .status(500)
          .json({ error: "Easebuzz is not configured for this shop." });
      }

      const pickupValidation = validatePickupTime(pickupTime);
      if (!pickupValidation.valid) {
        return res.status(400).json({ error: pickupValidation.error });
      }

      const user = req.user || {};
      const amount = total.toFixed(2);
      const txnid = new mongoose.Types.ObjectId().toString();
      const productinfo = `FlashFoods order - ${shop.name}`;
      const firstname = String(user.name || "Customer").slice(0, 60);
      const email = String(user.email || "customer@flashfoods.local");

      await Order.create({
        customer: req.session.userId,
        shop: cart.shopId,
        items: orderItems,
        total,
        parcelCharge,
        pickupTime: pickupValidation.date || null,
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

      const result = await easebuzzInitiatePayment(params, baseUrl);

      if (!result || Number(result.status) !== 1 || !result.data) {
        console.error(
          "Easebuzz initiateLink rejected:",
          result?.data || result,
        );
        return res.status(502).json({
          error:
            typeof result?.data === "string"
              ? result.data
              : "Easebuzz declined the payment request.",
        });
      }

      return res.json({ redirectUrl: easebuzzPayUrl(baseUrl, result.data) });
    } catch (err) {
      console.error("Easebuzz initiate failed:", err);
      return res
        .status(500)
        .json({ error: "Failed to initiate Easebuzz payment" });
    }
  },
);

ordersRouter.post("/easebuzz/callback", requireDb, async (req, res) => {
  try {
    const payload = req.body || {};
    const txnid = payload.txnid;

    const order = txnid ? await Order.findOne({ gatewayTxnId: txnid }) : null;
    if (!order) {
      req.flash("error", "Payment could not be matched to an order.");
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

      if (success) emitPendingCount(order.shop);
    }

    return res.redirect(`/orders/${order._id}`);
  } catch (err) {
    console.error("Easebuzz callback failed:", err);
    return res.redirect("/orders");
  }
});

// --- PhonePe hosted checkout ---------------------------------------------
ordersRouter.post(
  "/phonepe/initiate",
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
        return res
          .status(400)
          .json({ error: "This shop is currently closed." });
      }
      if (shop.paymentGateway !== "phonepe") {
        return res
          .status(400)
          .json({ error: "This shop is not using PhonePe." });
      }

      // Validate variants before proceeding
      var missingVariants = await validateCartVariants(cart);
      if (missingVariants.length > 0) {
        return res.status(400).json({
          error: "Variant selection required",
          missingItems: missingVariants,
        });
      }

      const built = await buildOrderItemsFromCart(cart, shop.parcelCharge);
      if (!built) {
        return res
          .status(400)
          .json({ error: "Nothing in your cart is available to order." });
      }
      const { orderItems, total, parcelCharge } = built;

      const phonepe = getPhonepeFromShop(shop);
      if (!phonepe.clientId || !phonepe.clientSecret) {
        return res
          .status(500)
          .json({ error: "PhonePe is not configured for this shop." });
      }

      const pickupValidation = validatePickupTime(pickupTime);
      if (!pickupValidation.valid) {
        return res.status(400).json({ error: pickupValidation.error });
      }

      const user = req.user || {};
      const txnid = new mongoose.Types.ObjectId().toString();
      const origin = `${req.protocol}://${req.get("host")}`;

      const auth = await getAuthToken({
        clientId: phonepe.clientId,
        clientSecret: phonepe.clientSecret,
        clientVersion: phonepe.clientVersion,
        env: phonepe.env,
      });

      if (!auth || !auth.access_token) {
        console.error("PhonePe auth rejected:", auth);
        return res.status(502).json({
          error: auth?.message || "Failed to authenticate with PhonePe.",
        });
      }

      await Order.create({
        customer: req.session.userId,
        shop: cart.shopId,
        items: orderItems,
        total,
        parcelCharge,
        pickupTime: pickupValidation.date || null,
        status: "pending_payment",
        pickupOtp: generateOtp(),
        paymentNote: "pending",
        transactionId: "",
        gatewayTxnId: txnid,
      });

      const result = await createPayment({
        accessToken: auth.access_token,
        merchantTransactionId: txnid,
        amount: total,
        redirectUrl: `${origin}/phonepe/callback?merchantOrderId=${txnid}`,
        env: phonepe.env,
      });

      const redirectUrl = result?.redirectUrl;

      if (!redirectUrl) {
        console.error("PhonePe pay rejected:", result?.message || result);
        return res.status(502).json({
          error: result?.message || "PhonePe declined the payment request.",
        });
      }

      return res.json({ redirectUrl });
    } catch (err) {
      console.error("PhonePe initiate failed:", err);
      return res
        .status(500)
        .json({ error: "Failed to initiate PhonePe payment" });
    }
  },
);

ordersRouter.all("/phonepe/callback", requireDb, async (req, res) => {
  try {
    const merchantOrderId = req.query.merchantOrderId || "";

    if (!merchantOrderId) {
      console.error("PhonePe callback missing merchantOrderId in query");
      req.flash("error", "PhonePe callback missing order reference.");
      return res.redirect("/orders");
    }

    const order = await Order.findOne({ gatewayTxnId: merchantOrderId });
    if (!order) {
      console.error("PhonePe callback: no order for", merchantOrderId);
      req.flash("error", "Order not found for this payment.");
      return res.redirect("/orders");
    }

    if (order.status !== "pending_payment") {
      return res.redirect(`/orders/${order._id}`);
    }
    const shop = await Shop.findById(order.shop)
      .select("paymentSettings paymentGateway")
      .lean();

    const phonepe = getPhonepeFromShop(shop);
    const auth = await getAuthToken({
      clientId: phonepe.clientId,
      clientSecret: phonepe.clientSecret,
      clientVersion: phonepe.clientVersion,
      env: phonepe.env,
    });

    if (!auth || !auth.access_token) {
      console.error("PhonePe callback auth failed:", auth);
      req.flash("error", "Payment verification failed.");
      return res.redirect(`/orders/${order._id}`);
    }
    const statusResult = await getOrderStatus({
      merchantOrderId,
      accessToken: auth.access_token,
      env: phonepe.env,
    });
    const state = statusResult?.state || "";

    if (state === "COMPLETED") {
      const transactionId =
        statusResult?.paymentDetails?.[0]?.transactionId || "";

      order.status = "paid";
      order.paymentNote = "paid";
      order.transactionId = transactionId;
      await order.save();

      emitPendingCount(order.shop);

      if (req.session) {
        req.session.cart = { shopId: null, items: [] };
      }

      req.flash("success", "Payment successful! Your order has been placed.");
      return res.redirect(`/orders/${order._id}`);
    }

    if (["FAILED", "EXPIRED", "CANCELLED", "REVERSED"].includes(state)) {
      order.status = "cancelled";
      order.paymentNote = `phonepe_${state.toLowerCase()}`;
      await order.save();

      req.flash(
        "error",
        `Payment was ${state.toLowerCase()}. Please try again.`,
      );
      return res.redirect(`/orders/${order._id}`);
    }

    console.error("PhonePe unexpected state:", state, statusResult);
    req.flash(
      "error",
      `Payment is in an unexpected state: ${state}. Please contact support.`,
    );
    return res.redirect(`/orders/${order._id}`);
  } catch (err) {
    console.error("PhonePe callback error:", err);
    req.flash("error", "Failed to process payment callback.");
    return res.redirect("/orders");
  }
});

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

    // Validate variants before proceeding
    var missingVariants = await validateCartVariants(cart);
    if (missingVariants.length > 0) {
      req.flash(
        "error",
        "Please select a variant for all items before checking out."
      );
      return res.redirect("/cart");
    }

    const built = await buildOrderItemsFromCart(cart, shop.parcelCharge);
    if (!built) {
      req.flash("error", "Nothing in your cart is available to order.");
      return res.redirect("/cart");
    }
    const { orderItems, total, parcelCharge } = built;

    const pickupValidation = validatePickupTime(req.body.pickupTime);
    if (!pickupValidation.valid) {
      req.flash("error", pickupValidation.error);
      return res.redirect("/cart");
    }

    const pickupOtp = generateOtp();

    const order = await Order.create({
      customer: req.session.userId,
      shop: cart.shopId,
      items: orderItems,
      total,
      parcelCharge,
      pickupTime: pickupValidation.date || null,
      status: "paid",
      pickupOtp,
      paymentNote: "mock",
      transactionId: "mock",
    });

    emitPendingCount(cart.shopId);

    req.session.cart = { shopId: null, items: [] };
    req.flash(
      "success",
      "Order placed (paid). You'll get a pickup code after the canteen marks it ready.",
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
    return res.render("orders/index", { pageTitle: "Orders", orders });
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

    const order = await Order.findById(id).select("customer status adjustedAt refundAmount").lean();
    if (!order || String(order.customer) !== String(req.session.userId)) {
      return res.status(404).json({ error: "Order not found." });
    }

    const adjusted = !!(order.adjustedAt);
    return res.json({
      status: order.status,
      adjusted,
      refundAmount: adjusted ? (order.refundAmount || 0) : undefined,
    });
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
    return res.render("orders/show", {
      pageTitle: `Order ${String(order._id).slice(-6)}`,
      order,
    });
  },
);
