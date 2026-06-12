import express from "express";
import mongoose from "mongoose";
import { MenuItem } from "../models/MenuItem.js";
import { Shop } from "../models/Shop.js";
import { Order } from "../models/Order.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireAuth, requireStudent } from "../middleware/auth.js";
import { generateOtp } from "../utils/otp.js";
import {
  createOrder as createPaymentOrder,
  verifyPayment,
  PAYMENT_PROVIDERS,
} from "../services/payments/index.js";

export const ordersRouter = express.Router();

function getCart(req) {
  if (!req.session.cart || typeof req.session.cart !== "object") {
    req.session.cart = { shopId: null, items: [] };
  }
  if (!Array.isArray(req.session.cart.items)) req.session.cart.items = [];
  return req.session.cart;
}

function getPendingCheckout(req) {
  const checkout = req.session?.pendingPayment;
  if (!checkout || typeof checkout !== "object") {
    return null;
  }
  if (!checkout.shopId || !Array.isArray(checkout.lines)) {
    return null;
  }
  return checkout;
}

function rememberPendingCheckout(req, checkout) {
  req.session.pendingPayment = {
    provider: checkout.provider,
    shopId: String(checkout.shopId),
    orderId: String(checkout.orderId || ""),
    amount: Number(checkout.amount) || 0,
    pickupTime: checkout.pickupTime || null,
    lines: Array.isArray(checkout.lines)
      ? checkout.lines.map((line) => ({
          menuItemId: String(line.menuItemId),
          quantity: Math.max(1, Math.min(99, Number(line.quantity) || 1)),
        }))
      : [],
    createdAt: new Date().toISOString(),
  };
}

function clearPendingCheckout(req) {
  delete req.session.pendingPayment;
}

function hydrateCartFromPending(req) {
  const pending = getPendingCheckout(req);
  const cart = getCart(req);

  if (
    pending &&
    (!cart.shopId || !cart.items.length) &&
    pending.shopId &&
    Array.isArray(pending.lines)
  ) {
    cart.shopId = pending.shopId;
    cart.items = pending.lines.map((line) => ({
      menuItemId: String(line.menuItemId),
      quantity: Math.max(1, Math.min(99, Number(line.quantity) || 1)),
    }));
  }

  return cart;
}

async function loadCartShop(cart) {
  if (!cart.shopId || !cart.items.length) {
    return { error: "Cart is empty", status: 400 };
  }

  const shop = await Shop.findById(cart.shopId).lean();
  if (!shop || shop.isActive === false || shop.isOpen === false) {
    return { error: "This shop is currently closed.", status: 400 };
  }

  if (!shop.paymentConfigured) {
    return {
      error:
        "This shop has not configured payments yet. Please try again later.",
      status: 400,
    };
  }

  if (!PAYMENT_PROVIDERS.includes(shop.paymentProvider)) {
    return { error: "This shop has an invalid payment provider.", status: 400 };
  }

  return { shop };
}

async function buildOrderItems({ shopId, lines }) {
  return MenuItem.find({
    _id: { $in: lines.map((l) => l.menuItemId) },
    shop: shopId,
    available: true,
  })
    .lean()
    .then((menuItems) => {
      const byId = new Map(menuItems.map((m) => [String(m._id), m]));
      const orderItems = [];
      let total = 0;

      for (const line of lines) {
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

      return { orderItems, total };
    });
}

function buildCallbackUrls(req) {
  const baseUrl =
    process.env.SITE_URL || `${req.protocol}://${req.get("host")}`;
  return {
    redirectUrl:
      process.env.CCAVENUE_REDIRECT_URL ||
      `${baseUrl}/api/orders/ccavenue-callback`,
    cancelUrl: process.env.CCAVENUE_CANCEL_URL || `${baseUrl}/cart`,
  };
}

async function finalizePaidOrder({
  req,
  shop,
  provider,
  verification,
  pickupTime,
}) {
  const checkout = getPendingCheckout(req);
  const currentCart = getCart(req);
  const lines =
    checkout?.shopId === String(shop._id) ? checkout.lines : currentCart.items;

  const { orderItems, total } = await buildOrderItems({
    shopId: shop._id,
    lines,
  });

  if (!orderItems.length) {
    return {
      success: false,
      status: 400,
      message: "Nothing in your cart is available to order.",
    };
  }

  if (checkout && Number.isFinite(checkout.amount)) {
    const expectedAmount = Number(checkout.amount);
    if (Math.abs(expectedAmount - total) > 0.01) {
      return {
        success: false,
        status: 400,
        message: "Order amount changed before payment confirmation.",
      };
    }
  }

  const checkoutPickupTime = pickupTime || checkout?.pickupTime || null;
  const pickupOtp = generateOtp();
  const gatewayTransactionId =
    verification.gatewayTransactionId || verification.transactionId || "";

  const order = await Order.create({
    customer: req.session.userId,
    shop: shop._id,
    items: orderItems,
    total,
    pickupTime: checkoutPickupTime ? new Date(checkoutPickupTime) : null,
    status: "paid",
    pickupOtp,
    paymentProvider: provider,
    paymentNote: verification.paymentNote || gatewayTransactionId,
    transactionId: verification.transactionId || gatewayTransactionId,
    gatewayTransactionId,
    paymentStatus: verification.paymentStatus || "paid",
  });

  req.session.cart = { shopId: null, items: [] };
  req.session.lastSuccessfulPaymentOrderId = String(order._id);
  req.session.lastSuccessfulPaymentProvider = provider;
  clearPendingCheckout(req);

  return {
    success: true,
    orderId: order._id,
  };
}

ordersRouter.post(
  "/create-payment-order",
  requireDb,
  requireAuth,
  requireStudent,
  async (req, res) => {
    try {
      const cart = getCart(req);
      const shopResult = await loadCartShop(cart);
      if (shopResult.error) {
        return res.status(shopResult.status).json({ error: shopResult.error });
      }

      const { shop } = shopResult;
      const { orderItems, total } = await buildOrderItems({
        shopId: cart.shopId,
        lines: cart.items,
      });

      if (!orderItems.length) {
        return res
          .status(400)
          .json({ error: "Nothing in your cart is available to order." });
      }

      const paymentOrder = await createPaymentOrder(shop.paymentProvider, {
        amount: total,
        shop,
        receipt: `cart_${cart.shopId}_${Date.now()}`,
        customer: req.user,
        pickupTime: req.body?.pickupTime || null,
        ...buildCallbackUrls(req),
      });

      rememberPendingCheckout(req, {
        provider: shop.paymentProvider,
        shopId: cart.shopId,
        orderId: paymentOrder.orderId,
        amount: total,
        pickupTime: req.body?.pickupTime || null,
        lines: cart.items,
      });

      return res.json({
        provider: shop.paymentProvider,
        ...paymentOrder,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to create payment order" });
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
      const cart = hydrateCartFromPending(req);
      const shopResult = await loadCartShop(cart);
      if (shopResult.error) {
        return res.status(shopResult.status).json({
          success: false,
          message: shopResult.error,
        });
      }

      const { shop } = shopResult;
      const provider = shop.paymentProvider;
      const { pickupTime } = req.body;
      const pendingCheckout = getPendingCheckout(req);

      const verification = await verifyPayment(provider, {
        shop,
        expectedAmount: pendingCheckout?.amount,
        ...req.body,
      });

      if (!verification.success) {
        return res.status(400).json({
          success: false,
          message: verification.message || "Payment verification failed",
        });
      }

      if (
        provider === "ccavenue" &&
        pendingCheckout?.orderId &&
        verification.orderId &&
        String(pendingCheckout.orderId) !== String(verification.orderId)
      ) {
        return res.status(400).json({
          success: false,
          message: "CCAvenue order reference mismatch.",
        });
      }

      const orderResult = await finalizePaidOrder({
        req,
        shop,
        provider,
        verification,
        pickupTime,
      });

      if (!orderResult.success) {
        return res.status(orderResult.status || 400).json({
          success: false,
          message: orderResult.message || "Payment verification failed",
        });
      }

      return res.json({
        success: true,
        orderId: orderResult.orderId,
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

ordersRouter.post(
  "/api/orders/ccavenue-callback",
  requireDb,
  requireAuth,
  requireStudent,
  async (req, res) => {
    try {
      if (
        req.session.lastSuccessfulPaymentOrderId &&
        req.session.lastSuccessfulPaymentProvider === "ccavenue" &&
        !getPendingCheckout(req)
      ) {
        return res.redirect(
          `/orders/${req.session.lastSuccessfulPaymentOrderId}`,
        );
      }

      const cart = hydrateCartFromPending(req);
      const shopResult = await loadCartShop(cart);
      if (shopResult.error) {
        req.flash("error", shopResult.error);
        return res.redirect("/cart");
      }

      const { shop } = shopResult;
      const pendingCheckout = getPendingCheckout(req);
      const verification = await verifyPayment("ccavenue", {
        shop,
        expectedAmount: pendingCheckout?.amount,
        ...req.body,
      });

      if (!verification.success) {
        req.flash(
          "error",
          verification.message || "CCAvenue payment verification failed.",
        );
        return res.redirect("/cart");
      }

      if (
        pendingCheckout?.orderId &&
        verification.orderId &&
        String(pendingCheckout.orderId) !== String(verification.orderId)
      ) {
        req.flash("error", "CCAvenue order reference mismatch.");
        return res.redirect("/cart");
      }

      if (
        req.session.lastSuccessfulPaymentOrderId &&
        req.session.lastSuccessfulPaymentProvider === "ccavenue"
      ) {
        return res.redirect(
          `/orders/${req.session.lastSuccessfulPaymentOrderId}`,
        );
      }

      const orderResult = await finalizePaidOrder({
        req,
        shop,
        provider: "ccavenue",
        verification,
        pickupTime: pendingCheckout?.pickupTime || null,
      });

      if (!orderResult.success) {
        req.flash(
          "error",
          orderResult.message || "CCAvenue payment verification failed.",
        );
        return res.redirect("/cart");
      }

      req.flash("success", "CCAvenue payment completed successfully.");
      return res.redirect(`/orders/${orderResult.orderId}`);
    } catch (error) {
      console.error("CCAvenue callback error:", error);
      req.flash(
        "error",
        error?.message || "CCAvenue callback processing failed.",
      );
      return res.redirect("/cart");
    }
  },
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

    const { orderItems, total } = await buildOrderItems({
      shopId: cart.shopId,
      lines: cart.items,
    });

    if (!orderItems.length) {
      req.flash("error", "Nothing in your cart is available to order.");
      return res.redirect("/cart");
    }

    const order = await Order.create({
      customer: req.session.userId,
      shop: cart.shopId,
      items: orderItems,
      total,
      pickupTime: req.body.pickupTime ? new Date(req.body.pickupTime) : null,
      status: "paid",
      pickupOtp: generateOtp(),
      paymentProvider: "mock",
      paymentNote: "mock",
      transactionId: "mock",
      gatewayTransactionId: "mock",
      paymentStatus: "paid",
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
