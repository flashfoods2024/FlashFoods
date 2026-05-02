import express from "express";
import mongoose from "mongoose";
import { Order } from "../models/Order.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireVendorShop } from "../middleware/auth.js";

export const vendorRouter = express.Router();

vendorRouter.get("/vendor/orders/pending", requireDb, requireVendorShop, async (req, res) => {
  const orders = await Order.find({
    shop: req.vendorShopId,
    status: "paid",
  })
    .sort({ createdAt: 1 })
    .lean();

  res.render("vendor/pending-orders", { pageTitle: "Pending orders", orders });
});

vendorRouter.post("/vendor/orders/:id/ready", requireDb, requireVendorShop, async (req, res) => {
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
    req.flash("error", "That order is not awaiting confirmation.");
    return res.redirect("/vendor/orders/pending");
  }

  order.status = "ready_for_pickup";
  await order.save();

  req.flash("success", "Order marked ready. Student can pick up with their code.");
  return res.redirect("/vendor/orders/pending");
});

vendorRouter.get("/vendor/verify", requireDb, requireVendorShop, async (req, res) => {
  const waitingPickup = await Order.countDocuments({
    shop: req.vendorShopId,
    status: "ready_for_pickup",
  });
  res.render("vendor/verify", { pageTitle: "Verify pickup", waitingPickup });
});

vendorRouter.post("/vendor/verify", requireDb, requireVendorShop, async (req, res) => {
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
  })
    .populate("customer", "name email")
    .lean();

  if (!order) {
    req.flash("error", "No order waiting for pickup matches that code.");
    return res.redirect("/vendor/verify");
  }

  await Order.updateOne({ _id: order._id }, { $set: { status: "completed" } });
  req.flash("success", `Pickup verified for ${order.customer?.name || "customer"}.`);
  return res.redirect("/vendor/verify");
});

vendorRouter.get("/vendor/orders/completed", requireDb, requireVendorShop, async (req, res) => {
  const orders = await Order.find({
    shop: req.vendorShopId,
    status: "completed",
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.render("vendor/completed-orders", { pageTitle: "Completed orders", orders });
});
