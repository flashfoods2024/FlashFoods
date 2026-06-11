import express from "express";
import mongoose from "mongoose";
import { Order } from "../models/Order.js";
import { MenuItem } from "../models/MenuItem.js";
import { Shop } from "../models/Shop.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireAuth, requireVendor, requireVendorShop } from "../middleware/auth.js";
import { handleMenuImageUpload } from "../middleware/upload.js";
import {
  refundPayment,
  isRefundableOrder,
} from "../services/payments/index.js";

export const vendorRouter = express.Router();

vendorRouter.get("/vendor/menu", requireDb, requireAuth, requireVendor, requireVendorShop, async (req, res) => {
  const shop = await Shop.findById(req.vendorShopId).lean();
  if (!shop) {
    req.flash("error", "Shop not found.");
    return res.redirect("/");
  }
  if (shop && typeof shop.isOpen !== "boolean") shop.isOpen = true;
  const menuItems = await MenuItem.find({ shop: req.vendorShopId }).sort({ name: 1 }).lean();
  res.render("vendor/menu", { pageTitle: "Vendor Dashboard", shop, menuItems });
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

      if (shop.isActive === false) {
        req.flash("error", "This shop is disabled by an admin.");
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
  const shop = await Shop.findById(req.vendorShopId).lean();
  if (!shop || shop.isActive === false) {
    req.flash("error", "This shop is disabled by an admin.");
    return res.redirect("/vendor/menu");
  }
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
  const activeShop = await Shop.findById(req.vendorShopId).lean();
  if (!activeShop || activeShop.isActive === false) {
    return res.status(403).json({ error: "This shop is disabled by an admin." });
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
  const activeShop = await Shop.findById(req.vendorShopId).lean();
  if (!activeShop || activeShop.isActive === false) {
    return res.status(403).json({ error: "This shop is disabled by an admin." });
  }
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
  const orders = await Order.aggregate([
    {
      $match: {
        shop: req.vendorShopId,
        status: "paid",
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

  res.render("vendor/pending-orders", { pageTitle: "Pending Orders", orders });
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
  order.readyAt = order.readyAt || new Date();
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

      if (!isRefundableOrder(order)) {
        req.flash("error", "Invalid payment ID.");
        return res.redirect("/vendor/orders/pending");
      }

      const shop = await Shop.findById(req.vendorShopId).lean();
      if (!shop) {
        req.flash("error", "Shop not found.");
        return res.redirect("/vendor/orders/pending");
      }

      const paymentId =
        order.gatewayTransactionId || order.paymentNote || order.transactionId;

      order.refundStatus = "pending";
      await order.save();

      const refund = await refundPayment(order.paymentProvider || shop.paymentProvider, {
        shop,
        paymentId,
        amount: order.total,
      });

      order.status = "cancelled";
      order.refundStatus = "completed";
      order.paymentStatus = "refunded";

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
  const readyOrders = await Order.find({
    shop: req.vendorShopId,
    status: "ready_for_pickup",
  })
    .sort({ pickupTime: 1, createdAt: 1 })
    .populate("customer", "name")
    .lean();

  res.render("vendor/verify", {
    pageTitle: "Verify Pickup",
    waitingPickup: readyOrders.length,
    orders: readyOrders,
  });
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
    .populate("customer", "name email");

  if (!order) {
    req.flash("error", "No order waiting for pickup matches that code.");
    return res.redirect("/vendor/verify");
  }

  console.log(
    "Completing order via OTP:",
    {
      orderId: String(order._id),
      statusBefore: order.status,
      collectedAtBefore: order.collectedAt || null,
    },
  );

  order.status = "completed";
  if (!order.collectedAt) {
    order.collectedAt = new Date();
  }
  await order.save();

  const persistedCollection = await Order.findById(order._id)
    .select("status collectedAt")
    .lean();

  console.log(
    "Order completed via OTP:",
    {
      orderId: String(order._id),
      statusAfter: persistedCollection?.status || order.status,
      collectedAtAfter: persistedCollection?.collectedAt || null,
    },
  );

  req.flash("success", `Pickup verified for ${order.customer?.name || "customer"}.`);
  return res.redirect("/vendor/verify");
});

vendorRouter.get("/vendor/orders/completed", requireDb, requireAuth, requireVendor, requireVendorShop, async (req, res) => {
  const orders = await Order.find({
    shop: req.vendorShopId,
    status: { $in: ["completed", "cancelled"] },
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.render("vendor/completed-orders", {
    pageTitle: "Completed & Cancelled Orders",
    orders,
  });
});

vendorRouter.get("/vendor/orders/:id", requireDb, requireAuth, requireVendor, requireVendorShop, async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    req.flash("error", "Order not found.");
    return res.redirect("/vendor/orders/pending");
  }

  const order = await Order.findById(id)
    .populate("customer", "name email")
    .populate("shop", "name slug")
    .lean();

  if (!order || String(order.shop?._id || order.shop) !== req.vendorShopIdStr) {
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

  res.render("vendor/order-details", {
    pageTitle: `Order #${String(order._id).slice(-6).toUpperCase()}`,
    order,
    backHref,
  });
});

const VALID_PAYMENT_PROVIDERS = ["razorpay", "ccavenue", "paytm", "phonepe"];

vendorRouter.get(
  "/vendor/payment-settings",
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

    res.render("vendor/payment-settings", {
      pageTitle: "Payment Settings",
      shop,
      providers: VALID_PAYMENT_PROVIDERS,
    });
  },
);

vendorRouter.post(
  "/vendor/payment-settings",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
    const shop = await Shop.findById(req.vendorShopId);
    if (!shop) {
      req.flash("error", "Shop not found.");
      return res.redirect("/");
    }

    if (shop.isActive === false) {
      req.flash("error", "This shop is disabled by an admin.");
      return res.redirect("/vendor/payment-settings");
    }

    const paymentProvider = String(req.body.paymentProvider || "").trim();
    const merchantId = String(req.body.merchantId || "").trim();
    const apiKey = String(req.body.apiKey || "").trim();
    const apiSecret = String(req.body.apiSecret || "").trim();

    if (!VALID_PAYMENT_PROVIDERS.includes(paymentProvider)) {
      req.flash("error", "Select a valid payment provider.");
      return res.redirect("/vendor/payment-settings");
    }

    if (!merchantId || !apiKey || !apiSecret) {
      req.flash("error", "Merchant ID, API Key, and API Secret are required.");
      return res.redirect("/vendor/payment-settings");
    }

    shop.paymentProvider = paymentProvider;
    shop.paymentSettings = {
      merchantId,
      apiKey,
      apiSecret,
    };
    shop.paymentConfigured = true;

    await shop.save();

    req.flash("success", "Payment settings saved.");
    return res.redirect("/vendor/payment-settings");
  },
);
