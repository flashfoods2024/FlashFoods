import express from "express";
import mongoose from "mongoose";
import { Order } from "../models/Order.js";
import { MenuItem } from "../models/MenuItem.js";
import { Shop } from "../models/Shop.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireAuth, requireVendor, requireVendorShop } from "../middleware/auth.js";
import { handleMenuImageUpload } from "../middleware/upload.js";
import razorpay from "../config/razorpay.js";

export const vendorRouter = express.Router();

vendorRouter.get("/vendor/menu", requireDb, requireAuth, requireVendor, requireVendorShop, async (req, res) => {
  const shop = await Shop.findById(req.vendorShopId).lean();
  if (!shop) {
    req.flash("error", "Shop not found.");
    return res.redirect("/");
  }
  if (shop && typeof shop.isOpen !== "boolean") shop.isOpen = true;
  const menuItems = await MenuItem.find({ shop: req.vendorShopId }).sort({ name: 1 }).lean();
  res.render("vendor/menu", { pageTitle: "Manage menu", shop, menuItems });
});

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

      shop.isOpen = !shop.isOpen;

      await shop.save();

      req.flash(
        "success",
        shop.isOpen
          ? "Shop opened successfully."
          : "Shop closed successfully."
      );

      return res.redirect("/vendor/menu");
    } catch (error) {
      console.error(error);

      req.flash("error", "Failed to update shop status.");

      return res.redirect("/vendor/menu");
    }
  }
);

vendorRouter.post("/vendor/menu", requireDb, requireAuth, requireVendor, requireVendorShop, handleMenuImageUpload, async (req, res) => {
  const name = String((req.body && req.body.name) || "").trim();
  const description = String((req.body && req.body.description) || "").trim();
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
    description,
    price,
    image,
  });

  req.flash("success", "Menu item created.");
  return res.redirect("/vendor/menu");
});

vendorRouter.patch("/vendor/menu/:id", requireDb, requireAuth, requireVendor, requireVendorShop, handleMenuImageUpload, async (req, res) => {
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
  const price = Number((req.body && req.body.price) || 0);

  if (!name) {
    return res.status(400).json({ error: "Name is required." });
  }
  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ error: "Price must be greater than 0." });
  }

  item.name = name;
  item.description = description;
  item.price = price;
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
      price: item.price,
      image: item.image,
      available: item.available,
    },
  });
});

vendorRouter.delete("/vendor/menu/:id", requireDb, requireAuth, requireVendor, requireVendorShop, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ error: "Invalid menu item id." });
  }

  const result = await MenuItem.deleteOne({ _id: id, shop: req.vendorShopId });
  if (!result.deletedCount) {
    return res.status(404).json({ error: "Menu item not found." });
  }

  return res.json({ success: true, message: "Menu item deleted." });
});

vendorRouter.get("/vendor/orders/pending", requireDb, requireAuth, requireVendor, requireVendorShop, async (req, res) => {
  const orders = await Order.find({
    shop: req.vendorShopId,
    status: "paid",
  })
    .sort({ createdAt: 1 })
    .lean();

  res.render("vendor/pending-orders", { pageTitle: "Pending orders", orders });
});

vendorRouter.post("/vendor/orders/:id/ready", requireDb, requireAuth, requireVendor, requireVendorShop, async (req, res) => {
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

      if (!order.paymentNote?.startsWith("pay_")) {
        req.flash("error", "Invalid payment ID.");
        return res.redirect("/vendor/orders/pending");
      }

      const payment = await razorpay.payments.fetch(order.paymentNote);

      if (payment.status !== "captured") {
        req.flash("error", "Only captured payments can be refunded.");
        return res.redirect("/vendor/orders/pending");
      }

      order.refundStatus = "pending";
      await order.save();

      const refund = await razorpay.payments.refund(
        order.paymentNote,
        {
          amount: Math.round(order.total * 100),
          speed: "normal",
          notes: {
            reason: "Vendor cancelled order",
          },
        }
      );

      order.status = "cancelled";
      order.refundStatus = "completed";

      await order.save();

      console.log("Refund successful:", refund.id);

      req.flash(
        "success",
        "Order cancelled and refund initiated."
      );

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
        "Refund failed. Please process manually from Razorpay dashboard."
      );

      return res.redirect("/vendor/orders/pending");
    }
  }
);

vendorRouter.get("/vendor/verify", requireDb, requireAuth, requireVendor, requireVendorShop, async (req, res) => {
  const waitingPickup = await Order.countDocuments({
    shop: req.vendorShopId,
    status: "ready_for_pickup",
  });
  res.render("vendor/verify", { pageTitle: "Verify pickup", waitingPickup });
});

vendorRouter.post("/vendor/verify", requireDb, requireAuth, requireVendor, requireVendorShop, async (req, res) => {
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

vendorRouter.get("/vendor/orders/completed", requireDb, requireAuth, requireVendor, requireVendorShop, async (req, res) => {
  const orders = await Order.find({
    shop: req.vendorShopId,
    status: "completed",
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.render("vendor/completed-orders", { pageTitle: "Completed orders", orders });
});
