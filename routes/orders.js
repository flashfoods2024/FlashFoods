import express from "express";
import mongoose from "mongoose";
import { MenuItem } from "../models/MenuItem.js";
import { Shop } from "../models/Shop.js";
import { Order } from "../models/Order.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireStudent } from "../middleware/auth.js";
import { generateOtp } from "../utils/otp.js";

export const ordersRouter = express.Router();

function getCart(req) {
  if (!req.session.cart || typeof req.session.cart !== "object") {
    req.session.cart = { shopId: null, items: [] };
  }
  if (!Array.isArray(req.session.cart.items)) req.session.cart.items = [];
  return req.session.cart;
}

ordersRouter.post("/orders/checkout", requireDb, requireStudent, async (req, res) => {
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
    status: "paid",
    pickupOtp,
    paymentNote: "mock",
  });

  req.session.cart = { shopId: null, items: [] };
  req.flash("success", "Order placed (paid). You’ll get a pickup code after the canteen marks it ready.");
  return res.redirect(`/orders/${order._id}`);
});

ordersRouter.get("/orders", requireDb, requireStudent, async (req, res) => {
  const orders = await Order.find({ customer: req.session.userId })
    .sort({ createdAt: -1 })
    .populate("shop", "name slug")
    .lean();
  res.render("orders/index", { pageTitle: "My orders", orders });
});

ordersRouter.get("/orders/:id", requireDb, requireStudent, async (req, res) => {
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
  res.render("orders/show", { pageTitle: `Order ${String(order._id).slice(-6)}`, order });
});
