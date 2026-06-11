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
      error: "This shop has not configured payments yet. Please try again later.",
      status: 400,
    };
  }

  if (!PAYMENT_PROVIDERS.includes(shop.paymentProvider)) {
    return { error: "This shop has an invalid payment provider.", status: 400 };
  }

  return { shop };
}

function buildOrderItems(cart) {
  return MenuItem.find({
    _id: { $in: cart.items.map((l) => l.menuItemId) },
    shop: cart.shopId,
    available: true,
  })
    .lean()
    .then((menuItems) => {
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

      return { orderItems, total };
    });
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
      const { orderItems, total } = await buildOrderItems(cart);

      if (!orderItems.length) {
        return res.status(400).json({ error: "Nothing in your cart is available to order." });
      }

      const paymentOrder = await createPaymentOrder(shop.paymentProvider, {
        amount: total,
        shop,
        receipt: `cart_${cart.shopId}_${Date.now()}`,
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
      const cart = getCart(req);
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

      const verification = await verifyPayment(provider, {
        shop,
        ...req.body,
      });

      if (!verification.success) {
        return res.status(400).json({
          success: false,
          message: verification.message || "Payment verification failed",
        });
      }

      const { orderItems, total } = await buildOrderItems(cart);
      if (!orderItems.length) {
        return res.status(400).json({
          success: false,
          message: "Nothing in your cart is available to order.",
        });
      }

      const pickupOtp = generateOtp();
      const gatewayTransactionId =
        verification.gatewayTransactionId || verification.transactionId || "";

      const order = await Order.create({
        customer: req.session.userId,
        shop: cart.shopId,
        items: orderItems,
        total,
        pickupTime: pickupTime ? new Date(pickupTime) : null,
        status: "paid",
        pickupOtp,
        paymentProvider: provider,
        paymentNote: verification.paymentNote || gatewayTransactionId,
        transactionId: verification.transactionId || gatewayTransactionId,
        gatewayTransactionId,
        paymentStatus: verification.paymentStatus || "paid",
      });

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
      pickupTime: req.body.pickupTime ? new Date(req.body.pickupTime) : null,
      status: "paid",
      pickupOtp,
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
