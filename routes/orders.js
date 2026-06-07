import express from "express";
import crypto from "crypto";
import mongoose from "mongoose";
import { MenuItem } from "../models/MenuItem.js";
import { Shop } from "../models/Shop.js";
import { Order } from "../models/Order.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireAuth, requireStudent } from "../middleware/auth.js";
import { generateOtp } from "../utils/otp.js";
import razorpay from "../config/razorpay.js";
export const ordersRouter = express.Router();

function getCart(req) {
  if (!req.session.cart || typeof req.session.cart !== "object") {
    req.session.cart = { shopId: null, items: [] };
  }
  if (!Array.isArray(req.session.cart.items)) req.session.cart.items = [];
  return req.session.cart;
}

ordersRouter.post("/create-razorpay-order", async (req, res) => {
  try {
    const { amount } = req.body;

    const options = {
      amount: amount * 100,
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);

    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create Razorpay order" });
  }
});

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

      const sign = razorpay_order_id + "|" + razorpay_payment_id;

      const expectedSign = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(sign.toString())
        .digest("hex");

      const isAuthentic = expectedSign === razorpay_signature;

      if (!isAuthentic) {
        return res.status(400).json({
          success: false,
          message: "Invalid payment signature",
        });
      }

      const cart = getCart(req);

      if (!cart.shopId || !cart.items.length) {
        return res.status(400).json({
          success: false,
          message: "Cart is empty",
        });
      }

      const shop = await Shop.findById(cart.shopId).lean();
      if (!shop || shop.isActive === false || shop.isOpen === false) {
        return res.status(400).json({
          success: false,
          message: "This shop is currently closed.",
        });
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

      const pickupOtp = generateOtp();

      const order = await Order.create({
  customer: req.session.userId,
  shop: cart.shopId,
  items: orderItems,
  total,
  pickupTime: pickupTime ? new Date(pickupTime) : null,
  status: "paid",
  pickupOtp,
  paymentNote: razorpay_payment_id,
  transactionId: razorpay_payment_id,
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
