import express from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";

import { Order } from "../models/Order.js";
import { User } from "../models/User.js";
import { Shop } from "../models/Shop.js";
import { MenuItem } from "../models/MenuItem.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireAuth, requireAdmin, resolveAdminVendorShop } from "../middleware/auth.js";
import { handleShopImageUpload, handleAdminMenuImageUpload } from "../middleware/upload.js";
import { uploadImportFile } from "../menu-import/upload.js";
import { stageImport, markProcessing, markError, discardImport } from "../menu-import/importer.js";
import { updateSession, getSession } from "../menu-import/store.js";
import { extractMenu } from "../menu-import/vision.js";
import { isGatewayConfigured } from "./vendor.js";
import {
  formatOrderStatus,
  normalizeQuery,
  startOfIstDay,
  startOfIstMonth,
  startOfIstWeek,
} from "../utils/admin.js";

export const adminRouter = express.Router();

adminRouter.use(requireDb, requireAuth, requireAdmin);

function toHexId(value) {
  return value ? String(value) : "";
}

function orderNumber(order) {
  return toHexId(order?._id).slice(-6).toUpperCase();
}

function safeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatMoney(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

async function syncVendorShopLink({ vendorId = null, shopId = null }) {
  const vendor =
    vendorId && mongoose.isValidObjectId(vendorId)
      ? await User.findById(vendorId)
      : null;
  const shop =
    shopId && mongoose.isValidObjectId(shopId)
      ? await Shop.findById(shopId)
      : null;

  if (vendor && vendor.role !== "vendor") {
    throw new Error("Selected user is not a vendor.");
  }

  const currentVendorShopId = vendor?.shop ? toHexId(vendor.shop) : null;
  const currentShopVendorId = shop?.vendor ? toHexId(shop.vendor) : null;

  if (
    vendor &&
    currentVendorShopId &&
    currentVendorShopId !== toHexId(shop?._id)
  ) {
    const previousShop = await Shop.findById(currentVendorShopId);
    if (previousShop && toHexId(previousShop.vendor) === toHexId(vendor._id)) {
      previousShop.vendor = null;
      await previousShop.save();
    }
  }

  if (
    shop &&
    currentShopVendorId &&
    currentShopVendorId !== toHexId(vendor?._id)
  ) {
    const previousVendor = await User.findById(currentShopVendorId);
    if (previousVendor && toHexId(previousVendor.shop) === toHexId(shop._id)) {
      previousVendor.shop = null;
      await previousVendor.save();
    }
  }

  if (vendor) {
    vendor.shop = shop ? shop._id : null;
    await vendor.save();
  }

  if (shop) {
    shop.vendor = vendor ? vendor._id : null;
    await shop.save();
  }
}

async function loadShopOrderCounts() {
  const rows = await Order.aggregate([
    {
      $group: {
        _id: "$shop",
        totalOrders: { $sum: 1 },
        completedOrders: {
          $sum: {
            $cond: [{ $eq: ["$status", "completed"] }, 1, 0],
          },
        },
      },
    },
  ]);

  const map = new Map();
  rows.forEach((row) => {
    map.set(toHexId(row._id), {
      totalOrders: row.totalOrders || 0,
      completedOrders: row.completedOrders || 0,
    });
  });
  return map;
}

async function loadVendorCompletedCounts() {
  const rows = await Order.aggregate([
    {
      $match: {
        status: "completed",
      },
    },
    {
      $group: {
        _id: "$shop",
        completedOrders: { $sum: 1 },
      },
    },
  ]);

  const map = new Map();
  rows.forEach((row) => {
    map.set(toHexId(row._id), row.completedOrders || 0);
  });
  return map;
}

async function loadStudentOrderStats() {
  const rows = await Order.aggregate([
    {
      $group: {
        _id: "$customer",
        totalOrders: { $sum: 1 },
        lastOrderDate: { $max: "$createdAt" },
      },
    },
  ]);

  const map = new Map();
  rows.forEach((row) => {
    map.set(toHexId(row._id), {
      totalOrders: row.totalOrders || 0,
      lastOrderDate: row.lastOrderDate || null,
    });
  });
  return map;
}

function humanizeTimeHour(hour) {
  if (hour === null || typeof hour === "undefined") return "Unknown";
  const normalized = Number(hour);
  if (!Number.isFinite(normalized)) return "Unknown";
  const suffix = normalized >= 12 ? "PM" : "AM";
  const value = normalized % 12 || 12;
  return `${value} ${suffix}`;
}

async function loadAdminOrderList() {
  return Order.find()
    .sort({ createdAt: -1 })
    .populate({
      path: "customer",
      select: "name email role isActive",
    })
    .populate({
      path: "shop",
      select: "name slug vendor isActive isOpen",
      populate: {
        path: "vendor",
        select: "name email role isActive",
      },
    })
    .lean();
}

function matchesOrderSearch(order, searchValue) {
  if (!searchValue) return true;

  const haystack = [
    orderNumber(order),
    toHexId(order._id),
    order.customer?.name,
    order.customer?.email,
    order.shop?.name,
    order.shop?.vendor?.name,
    order.shop?.vendor?.email,
    order.paymentNote,
    order.transactionId,
    order.adjustmentReason,
    order.refundStatus,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(searchValue);
}

function matchesOrderFilter(order, filterValue) {
  if (!filterValue) return true;

  const createdAt = new Date(order.createdAt);
  if (filterValue === "today") {
    return createdAt >= startOfIstDay();
  }
  if (filterValue === "week") {
    return createdAt >= startOfIstWeek();
  }
  if (filterValue === "paid") {
    return order.status === "paid";
  }
  if (filterValue === "preparing") {
    return ["paid", "accepted"].includes(order.status);
  }
  if (filterValue === "ready") {
    return order.status === "ready_for_pickup";
  }
  if (filterValue === "completed") {
    return order.status === "completed";
  }
  if (filterValue === "cancelled") {
    return order.status === "cancelled";
  }

  return true;
}

function paymentStatusLabel(order) {
  if (order.status === "cancelled") {
    return order.refundStatus === "completed" ? "Refunded" : "Cancelled";
  }
  if (order.status === "pending_payment") return "Pending";
  if (order.paymentNote && order.paymentNote !== "mock") return "Captured";
  return "Paid";
}

adminRouter.get("/", async (req, res) => {
  const [
    totalShops,
    totalVendors,
    totalStudents,
    totalOrders,
    ordersToday,
    completedOrders,
    pendingOrders,
    recentOrders,
  ] = await Promise.all([
    Shop.countDocuments(),
    User.countDocuments({ role: "vendor" }),
    User.countDocuments({ role: "student" }),
    Order.countDocuments(),
    Order.countDocuments({ createdAt: { $gte: startOfIstDay() } }),
    Order.countDocuments({ status: "completed" }),
    Order.countDocuments({ status: { $in: ["paid", "accepted"] } }),
    Order.find()
      .sort({ createdAt: -1 })
      .limit(8)
      .populate({ path: "customer", select: "name email" })
      .populate({
        path: "shop",
        select: "name slug",
        populate: {
          path: "vendor",
          select: "name email",
        },
      })
      .lean(),
  ]);

  return res.render("admin/dashboard", {
    pageTitle: "Admin Dashboard",
    activeSection: "dashboard",
    stats: {
      totalShops,
      totalVendors,
      totalStudents,
      totalOrders,
      ordersToday,
      completedOrders,
      pendingOrders,
    },
    recentOrders,
    orderNumber,
    formatOrderStatus,
    formatMoney,
  });
});

adminRouter.get("/shops", async (req, res) => {
  const [shops, orderCounts] = await Promise.all([
    Shop.find()
      .sort({ name: 1 })
      .populate("vendor", "name email role isActive")
      .lean(),
    loadShopOrderCounts(),
  ]);

  const rows = shops.map((shop) => {
    const counts = orderCounts.get(toHexId(shop._id)) || {
      totalOrders: 0,
      completedOrders: 0,
    };

    return {
      ...shop,
      totalOrders: counts.totalOrders,
      completedOrders: counts.completedOrders,
      assignedVendorName: shop.vendor?.name || "Unassigned",
      statusLabel:
        shop.isActive === false
          ? "Disabled"
          : shop.isOpen === false
            ? "Closed"
            : "Open",
    };
  });

  return res.render("admin/shops/index", {
    pageTitle: "Manage Shops",
    activeSection: "shops",
    shops: rows,
    orderNumber,
  });
});

adminRouter.get("/shops/new", async (req, res) => {
  const vendors = await User.find({ role: "vendor" }).sort({ name: 1 }).lean();
  return res.render("admin/shops/form", {
    pageTitle: "Create Shop",
    activeSection: "shops",
    mode: "create",
    shop: null,
    vendors,
  });
});

adminRouter.post(
  "/shops",
  handleShopImageUpload("/admin/shops/new"),
  async (req, res) => {
    try {
      const name = normalizeQuery(req.body?.name);
      const slug = safeSlug(req.body?.slug || name);
      const description = normalizeQuery(req.body?.description);
      const isOpen = String(req.body?.isOpen || "open") !== "closed";
      const assignedVendorId = normalizeQuery(req.body?.vendor);

      if (!name) {
        req.flash("error", "Shop name is required.");
        return res.redirect("/admin/shops/new");
      }

      if (!slug) {
        req.flash("error", "Shop slug is required.");
        return res.redirect("/admin/shops/new");
      }

      const existing = await Shop.findOne({ slug });
      if (existing) {
        req.flash("error", "That slug already exists.");
        return res.redirect("/admin/shops/new");
      }

      const shop = await Shop.create({
        name,
        slug,
        description,
        image: req.file?.path || "",
        isOpen,
        isActive: true,
      });

      if (assignedVendorId) {
        await syncVendorShopLink({
          vendorId: assignedVendorId,
          shopId: shop._id,
        });
      }

      req.flash("success", "Shop created.");
      return res.redirect("/admin/shops");
    } catch (error) {
      console.error(error);
      req.flash("error", error.message || "Could not create shop.");
      return res.redirect("/admin/shops/new");
    }
  },
);

adminRouter.get("/shops/:id", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    req.flash("error", "Shop not found.");
    return res.redirect("/admin/shops");
  }

  const [shop, menuItems, orderStats] = await Promise.all([
    Shop.findById(id).populate("vendor", "name email role isActive").lean(),
    MenuItem.find({ shop: id }).sort({ name: 1 }).lean(),
    Order.aggregate([
      { $match: { shop: new mongoose.Types.ObjectId(id) } },
      {
        $group: {
          _id: "$shop",
          totalOrders: { $sum: 1 },
          completedOrders: {
            $sum: {
              $cond: [{ $eq: ["$status", "completed"] }, 1, 0],
            },
          },
          revenue: {
            $sum: {
              $cond: [
                { $in: ["$status", ["paid", "accepted", "ready_for_pickup", "completed"]] },
                "$total",
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  if (!shop) {
    req.flash("error", "Shop not found.");
    return res.redirect("/admin/shops");
  }

  return res.render("admin/shops/show", {
    pageTitle: shop.name,
    activeSection: "shops",
    shop,
    menuItems,
    stats: {
      totalOrders: orderStats[0]?.totalOrders || 0,
      completedOrders: orderStats[0]?.completedOrders || 0,
      revenue: orderStats[0]?.revenue || 0,
    },
    formatMoney,
  });
});

adminRouter.get("/shops/:id/edit", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    req.flash("error", "Shop not found.");
    return res.redirect("/admin/shops");
  }

  const [shop, vendors] = await Promise.all([
    Shop.findById(id).populate("vendor", "name email").lean(),
    User.find({ role: "vendor" }).sort({ name: 1 }).lean(),
  ]);

  if (!shop) {
    req.flash("error", "Shop not found.");
    return res.redirect("/admin/shops");
  }

  return res.render("admin/shops/form", {
    pageTitle: `Edit ${shop.name}`,
    activeSection: "shops",
    mode: "edit",
    shop,
    vendors,
  });
});

adminRouter.post(
  "/shops/:id/edit",
  handleShopImageUpload((req) => `/admin/shops/${req.params.id}/edit`),
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!mongoose.isValidObjectId(id)) {
        req.flash("error", "Shop not found.");
        return res.redirect("/admin/shops");
      }

      const shop = await Shop.findById(id);
      if (!shop) {
        req.flash("error", "Shop not found.");
        return res.redirect("/admin/shops");
      }

      const name = normalizeQuery(req.body?.name);
      const slug = safeSlug(req.body?.slug || name);
      const description = normalizeQuery(req.body?.description);
      const isOpen = String(req.body?.isOpen || "open") !== "closed";
      const assignedVendorId = normalizeQuery(req.body?.vendor);

      if (!name) {
        req.flash("error", "Shop name is required.");
        return res.redirect(`/admin/shops/${id}/edit`);
      }
      if (!slug) {
        req.flash("error", "Shop slug is required.");
        return res.redirect(`/admin/shops/${id}/edit`);
      }

      const slugConflict = await Shop.findOne({ slug, _id: { $ne: shop._id } });
      if (slugConflict) {
        req.flash("error", "That slug already exists.");
        return res.redirect(`/admin/shops/${id}/edit`);
      }

      shop.name = name;
      shop.slug = slug;
      shop.description = description;
      shop.isOpen = isOpen;
      if (req.file?.path) {
        shop.image = req.file.path;
      }
      await shop.save();

      if (assignedVendorId) {
        await syncVendorShopLink({
          vendorId: assignedVendorId,
          shopId: shop._id,
        });
      } else if (shop.vendor) {
        const previousVendor = await User.findById(shop.vendor);
        if (
          previousVendor &&
          toHexId(previousVendor.shop) === toHexId(shop._id)
        ) {
          previousVendor.shop = null;
          await previousVendor.save();
        }
        shop.vendor = null;
        await shop.save();
      }

      req.flash("success", "Shop updated.");
      return res.redirect("/admin/shops");
    } catch (error) {
      console.error(error);
      req.flash("error", error.message || "Could not update shop.");
      return res.redirect(`/admin/shops/${req.params.id}/edit`);
    }
  },
);

adminRouter.post("/shops/:id/toggle", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    req.flash("error", "Shop not found.");
    return res.redirect("/admin/shops");
  }

  const shop = await Shop.findById(id);
  if (!shop) {
    req.flash("error", "Shop not found.");
    return res.redirect("/admin/shops");
  }

  shop.isActive = !shop.isActive;
  shop.disabledAt = shop.isActive ? null : new Date();
  if (!shop.isActive) {
    shop.isOpen = false;
  }
  await shop.save();

  req.flash("success", shop.isActive ? "Shop enabled." : "Shop disabled.");
  return res.redirect("/admin/shops");
});

adminRouter.post("/shops/:id/delete", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    req.flash("error", "Shop not found.");
    return res.redirect("/admin/shops");
  }

  const shop = await Shop.findById(id);
  if (!shop) {
    req.flash("error", "Shop not found.");
    return res.redirect("/admin/shops");
  }

  if (shop.vendor) {
    const vendor = await User.findById(shop.vendor);
    if (vendor && toHexId(vendor.shop) === toHexId(shop._id)) {
      vendor.shop = null;
      await vendor.save();
    }
  }

  await MenuItem.deleteMany({ shop: shop._id });
  await Shop.deleteOne({ _id: shop._id });

  req.flash("success", "Shop deleted.");
  return res.redirect("/admin/shops");
});

adminRouter.get("/shops/:id/payment-settings", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    req.flash("error", "Shop not found.");
    return res.redirect("/admin/shops");
  }

  const shop = await Shop.findById(id).lean();
  if (!shop) {
    req.flash("error", "Shop not found.");
    return res.redirect("/admin/shops");
  }

  return res.render("admin/shops/payment-settings", {
    pageTitle: `Payment Settings - ${shop.name}`,
    activeSection: "shops",
    shop,
  });
});

adminRouter.post("/shops/:id/payment-settings", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    req.flash("error", "Shop not found.");
    return res.redirect("/admin/shops");
  }

  try {
    const {
      paymentGateway,
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

    const shop = await Shop.findById(id);
    if (!shop) {
      req.flash("error", "Shop not found.");
      return res.redirect("/admin/shops");
    }

    if (paymentGateway !== undefined) {
      if (
        !["razorpay", "easebuzz", "phonepe", "paytm", "bharatpe"].includes(
          paymentGateway,
        )
      ) {
        req.flash("error", "Invalid payment gateway.");
        return res.redirect(`/admin/shops/${id}/payment-settings`);
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
    return res.redirect(`/admin/shops/${id}`);
  } catch (err) {
    console.error("Error updating payment settings:", err);
    req.flash("error", "Failed to save payment settings.");
    return res.redirect(`/admin/shops/${id}/payment-settings`);
  }
});

adminRouter.get("/vendors", async (req, res) => {
  const [vendors, completedCounts] = await Promise.all([
    User.find({ role: "vendor" })
      .sort({ name: 1 })
      .populate("shop", "name slug isActive isOpen vendor")
      .lean(),
    loadVendorCompletedCounts(),
  ]);

  const rows = vendors.map((vendor) => ({
    ...vendor,
    completedOrders:
      completedCounts.get(toHexId(vendor.shop?._id || vendor.shop)) || 0,
    assignedShopName: vendor.shop?.name || "Unassigned",
    statusLabel: vendor.isActive === false ? "Disabled" : "Active",
  }));

  return res.render("admin/vendors/index", {
    pageTitle: "Manage Vendors",
    activeSection: "vendors",
    vendors: rows,
    orderNumber,
  });
});

adminRouter.get("/vendors/new", async (req, res) => {
  const shops = await Shop.find().sort({ name: 1 }).lean();
  return res.render("admin/vendors/form", {
    pageTitle: "Create Vendor",
    activeSection: "vendors",
    mode: "create",
    vendor: null,
    shops,
  });
});

adminRouter.post("/vendors", async (req, res) => {
  try {
    const name = normalizeQuery(req.body?.name);
    const email = normalizeQuery(req.body?.email).toLowerCase();
    const password = String(req.body?.password || "");
    const assignedShopId = normalizeQuery(req.body?.shop);

    if (!name || !email || !password) {
      req.flash("error", "Name, email, and password are required.");
      return res.redirect("/admin/vendors/new");
    }

    const existing = await User.findOne({ email });
    if (existing) {
      req.flash("error", "That email already exists.");
      return res.redirect("/admin/vendors/new");
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const vendor = await User.create({
      name,
      email,
      passwordHash,
      role: "vendor",
      isActive: true,
    });

    if (assignedShopId) {
      await syncVendorShopLink({
        vendorId: vendor._id,
        shopId: assignedShopId,
      });
    }

    req.flash("success", "Vendor created.");
    return res.redirect("/admin/vendors");
  } catch (error) {
    console.error(error);
    req.flash("error", error.message || "Could not create vendor.");
    return res.redirect("/admin/vendors/new");
  }
});

adminRouter.get("/vendors/:id", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    req.flash("error", "Vendor not found.");
    return res.redirect("/admin/vendors");
  }

  const vendor = await User.findOne({ _id: id, role: "vendor" })
    .populate({
      path: "shop",
      populate: {
        path: "vendor",
        select: "name email",
      },
    })
    .lean();

  if (!vendor) {
    req.flash("error", "Vendor not found.");
    return res.redirect("/admin/vendors");
  }

  const recentOrders = await Order.find({
    shop: vendor.shop?._id || vendor.shop,
  })
    .sort({ createdAt: -1 })
    .limit(8)
    .populate("customer", "name email")
    .lean();

  const completedOrders = vendor.shop
    ? await Order.countDocuments({ shop: vendor.shop._id, status: "completed" })
    : 0;

  return res.render("admin/vendors/show", {
    pageTitle: vendor.name,
    activeSection: "vendors",
    vendor,
    completedOrders,
    recentOrders,
    formatMoney,
    orderNumber,
    formatOrderStatus,
  });
});

adminRouter.get("/vendors/:id/edit", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    req.flash("error", "Vendor not found.");
    return res.redirect("/admin/vendors");
  }

  const [vendor, shops] = await Promise.all([
    User.findOne({ _id: id, role: "vendor" })
      .populate("shop", "name slug")
      .lean(),
    Shop.find().sort({ name: 1 }).lean(),
  ]);

  if (!vendor) {
    req.flash("error", "Vendor not found.");
    return res.redirect("/admin/vendors");
  }

  return res.render("admin/vendors/form", {
    pageTitle: `Edit ${vendor.name}`,
    activeSection: "vendors",
    mode: "edit",
    vendor,
    shops,
  });
});

adminRouter.post("/vendors/:id/edit", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Vendor not found.");
      return res.redirect("/admin/vendors");
    }

    const vendor = await User.findOne({ _id: id, role: "vendor" });
    if (!vendor) {
      req.flash("error", "Vendor not found.");
      return res.redirect("/admin/vendors");
    }

    const name = normalizeQuery(req.body?.name);
    const email = normalizeQuery(req.body?.email).toLowerCase();
    const password = String(req.body?.password || "");
    const assignedShopId = normalizeQuery(req.body?.shop);
    const activeState = String(req.body?.isActive || "1");

    if (!name || !email) {
      req.flash("error", "Name and email are required.");
      return res.redirect(`/admin/vendors/${id}/edit`);
    }

    const conflict = await User.findOne({ email, _id: { $ne: vendor._id } });
    if (conflict) {
      req.flash("error", "That email already exists.");
      return res.redirect(`/admin/vendors/${id}/edit`);
    }

    vendor.name = name;
    vendor.email = email;
    if (password) {
      vendor.passwordHash = await bcrypt.hash(password, 10);
    }

    if (activeState === "0") {
      vendor.isActive = false;
      vendor.disabledAt = new Date();
    } else {
      vendor.isActive = true;
      vendor.disabledAt = null;
    }

    await vendor.save();

    if (assignedShopId) {
      await syncVendorShopLink({
        vendorId: vendor._id,
        shopId: assignedShopId,
      });
    } else if (vendor.shop) {
      await syncVendorShopLink({ vendorId: vendor._id, shopId: null });
    }

    req.flash("success", "Vendor updated.");
    return res.redirect("/admin/vendors");
  } catch (error) {
    console.error(error);
    req.flash("error", error.message || "Could not update vendor.");
    return res.redirect(`/admin/vendors/${req.params.id}/edit`);
  }
});

adminRouter.post("/vendors/:id/toggle", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    req.flash("error", "Vendor not found.");
    return res.redirect("/admin/vendors");
  }

  const vendor = await User.findOne({ _id: id, role: "vendor" });
  if (!vendor) {
    req.flash("error", "Vendor not found.");
    return res.redirect("/admin/vendors");
  }

  vendor.isActive = !vendor.isActive;
  vendor.disabledAt = vendor.isActive ? null : new Date();
  await vendor.save();

  req.flash(
    "success",
    vendor.isActive ? "Vendor enabled." : "Vendor disabled.",
  );
  return res.redirect("/admin/vendors");
});

adminRouter.post("/vendors/:id/delete", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    req.flash("error", "Vendor not found.");
    return res.redirect("/admin/vendors");
  }

  const vendor = await User.findOne({ _id: id, role: "vendor" });
  if (!vendor) {
    req.flash("error", "Vendor not found.");
    return res.redirect("/admin/vendors");
  }

  if (vendor.shop) {
    await syncVendorShopLink({ vendorId: vendor._id, shopId: null });
  }

  await User.deleteOne({ _id: vendor._id });

  req.flash("success", "Vendor deleted.");
  return res.redirect("/admin/vendors");
});

adminRouter.get("/students", async (req, res) => {
  const [students, orderStats] = await Promise.all([
    User.find({ role: "student" }).sort({ name: 1 }).lean(),
    loadStudentOrderStats(),
  ]);

  const rows = students.map((student) => {
    const stats = orderStats.get(toHexId(student._id)) || {
      totalOrders: 0,
      lastOrderDate: null,
    };

    return {
      ...student,
      totalOrders: stats.totalOrders,
      lastOrderDate: stats.lastOrderDate,
      statusLabel: student.isActive === false ? "Disabled" : "Active",
    };
  });

  return res.render("admin/students/index", {
    pageTitle: "Manage Students",
    activeSection: "students",
    students: rows,
  });
});

adminRouter.get("/students/:id", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    req.flash("error", "Student not found.");
    return res.redirect("/admin/students");
  }

  const student = await User.findOne({ _id: id, role: "student" }).lean();
  if (!student) {
    req.flash("error", "Student not found.");
    return res.redirect("/admin/students");
  }

  const recentOrders = await Order.find({ customer: student._id })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate({
      path: "shop",
      select: "name slug",
      populate: {
        path: "vendor",
        select: "name email",
      },
    })
    .lean();

  const [stats] = await Order.aggregate([
    { $match: { customer: student._id } },
    {
      $group: {
        _id: "$customer",
        totalOrders: { $sum: 1 },
        lastOrderDate: { $max: "$createdAt" },
      },
    },
  ]);

  return res.render("admin/students/show", {
    pageTitle: student.name,
    activeSection: "students",
    student,
    stats: {
      totalOrders: stats?.totalOrders || 0,
      lastOrderDate: stats?.lastOrderDate || null,
    },
    recentOrders,
    formatMoney,
    orderNumber,
    formatOrderStatus,
  });
});

adminRouter.post("/students/:id/toggle", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    req.flash("error", "Student not found.");
    return res.redirect("/admin/students");
  }

  const student = await User.findOne({ _id: id, role: "student" });
  if (!student) {
    req.flash("error", "Student not found.");
    return res.redirect("/admin/students");
  }

  student.isActive = !student.isActive;
  student.disabledAt = student.isActive ? null : new Date();
  await student.save();

  req.flash(
    "success",
    student.isActive ? "Student enabled." : "Student disabled.",
  );
  return res.redirect("/admin/students");
});

adminRouter.get("/orders", async (req, res) => {
  const filter = normalizeQuery(req.query.filter).toLowerCase();
  const search = normalizeQuery(req.query.q).toLowerCase();
  const orders = await loadAdminOrderList();

  const rows = orders
    .filter((order) => matchesOrderFilter(order, filter))
    .filter((order) => matchesOrderSearch(order, search))
    .map((order) => ({
      ...order,
      orderNumber: orderNumber(order),
      paymentStatus: paymentStatusLabel(order),
      statusLabel: formatOrderStatus(order.status),
      customerName: order.customer?.name || "Customer",
      shopName: order.shop?.name || "Deleted shop",
      vendorName: order.shop?.vendor?.name || "Unassigned",
    }));

  return res.render("admin/orders/index", {
    pageTitle: "Manage Orders",
    activeSection: "orders",
    orders: rows,
    filter,
    search,
  });
});

adminRouter.get("/orders/:id", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    req.flash("error", "Order not found.");
    return res.redirect("/admin/orders");
  }

  const order = await Order.findById(id)
    .populate({ path: "customer", select: "name email role isActive" })
    .populate({
      path: "shop",
      select: "name slug vendor isOpen isActive description image",
      populate: {
        path: "vendor",
        select: "name email role isActive",
      },
    })
    .lean();

  if (!order) {
    req.flash("error", "Order not found.");
    return res.redirect("/admin/orders");
  }

  return res.render("admin/orders/show", {
    pageTitle: `Order ${orderNumber(order)}`,
    activeSection: "orders",
    order,
    orderNumber,
    formatOrderStatus,
    paymentStatus: paymentStatusLabel(order),
    formatMoney,
  });
});

// ---------------------------------------------------------------------------
// Manage Menus – Admin can manage every vendor's menu
// ---------------------------------------------------------------------------

adminRouter.get("/menus", async (req, res) => {
  const [vendors, menuCounts] = await Promise.all([
    User.find({ role: "vendor" })
      .sort({ name: 1 })
      .populate("shop", "name slug isActive isOpen")
      .lean(),
    MenuItem.aggregate([
      { $group: { _id: "$shop", count: { $sum: 1 } } },
    ]),
  ]);

  const countsMap = new Map();
  menuCounts.forEach((row) => {
    countsMap.set(toHexId(row._id), row.count);
  });

  const rows = vendors.map((vendor) => ({
    ...vendor,
    menuCount: countsMap.get(toHexId(vendor.shop?._id || vendor.shop)) || 0,
    assignedShopName: vendor.shop?.name || "Unassigned",
    statusLabel: vendor.isActive === false ? "Disabled" : "Active",
    shopStatusLabel:
      vendor.shop?.isActive === false
        ? "Disabled"
        : vendor.shop?.isOpen === false
          ? "Closed"
          : "Open",
  }));

  return res.render("admin/menus/index", {
    pageTitle: "Manage Menus",
    activeSection: "menus",
    vendors: rows,
  });
});

adminRouter.get(
  "/vendors/:vendorId/menu",
  resolveAdminVendorShop,
  async (req, res) => {
    const menuItems = await MenuItem.find({ shop: req.vendorShopId })
      .sort({ name: 1 })
      .lean();
    return res.render("admin/vendors/menu", {
      pageTitle: `Menu – ${req.targetVendor.name}`,
      activeSection: "menus",
      vendor: req.targetVendor,
      shop: req.targetShop,
      menuItems,
    });
  },
);

adminRouter.post(
  "/vendors/:vendorId/menu",
  resolveAdminVendorShop,
  handleAdminMenuImageUpload(
    (req) => `/admin/vendors/${req.params.vendorId}/menu`,
  ),
  async (req, res) => {
    const shop = await Shop.findById(req.vendorShopId).lean();
    if (!shop || shop.isActive === false) {
      req.flash("error", "This shop is disabled by an admin.");
      return res.redirect(`/admin/vendors/${req.params.vendorId}/menu`);
    }
    const name = String((req.body && req.body.name) || "").trim();
    const description = String((req.body && req.body.description) || "").trim();
    const price = Number((req.body && req.body.price) || 0);
    const image = req.file?.path || "";

    if (!name) {
      req.flash("error", "Name is required.");
      return res.redirect(`/admin/vendors/${req.params.vendorId}/menu`);
    }
    if (!Number.isFinite(price) || price <= 0) {
      req.flash("error", "Price must be greater than 0.");
      return res.redirect(`/admin/vendors/${req.params.vendorId}/menu`);
    }

    await MenuItem.create({
      shop: req.vendorShopId,
      name,
      description,
      price,
      image,
      variants: [{ label: "Regular", price }],
    });

    req.flash("success", "Menu item created.");
    return res.redirect(`/admin/vendors/${req.params.vendorId}/menu`);
  },
);

adminRouter.patch(
  "/vendors/:vendorId/menu/:id",
  resolveAdminVendorShop,
  handleAdminMenuImageUpload(
    (req) => `/admin/vendors/${req.params.vendorId}/menu`,
  ),
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
        price: item.price,
        image: item.image,
        available: item.available,
        variants: item.variants,
      },
    });
  },
);

adminRouter.delete(
  "/vendors/:vendorId/menu/:id",
  resolveAdminVendorShop,
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

adminRouter.patch(
  "/vendors/:vendorId/menu/:id/toggle",
  resolveAdminVendorShop,
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

    item.available = !item.available;
    await item.save();

    return res.json({
      item: {
        _id: String(item._id),
        name: item.name,
        price: item.price,
        available: item.available,
      },
    });
  },
);

adminRouter.post(
  "/vendors/:vendorId/shop/toggle",
  resolveAdminVendorShop,
  async (req, res) => {
    try {
      const shop = await Shop.findById(req.vendorShopId);
      if (!shop) {
        req.flash("error", "Shop not found.");
        return res.redirect(`/admin/vendors/${req.params.vendorId}/menu`);
      }
      shop.isOpen = !shop.isOpen;
      await shop.save();
      req.flash(
        "success",
        shop.isOpen ? "Shop opened successfully." : "Shop closed successfully.",
      );
      return res.redirect(`/admin/vendors/${req.params.vendorId}/menu`);
    } catch (error) {
      console.error(error);
      req.flash("error", "Failed to update shop status.");
      return res.redirect(`/admin/vendors/${req.params.vendorId}/menu`);
    }
  },
);

// ---------------------------------------------------------------------------
// Smart Menu Import – Gemini Vision AI → structured items → editable preview
// ---------------------------------------------------------------------------

adminRouter.get(
  "/vendors/:vendorId/menu/import",
  resolveAdminVendorShop,
  async (req, res) => {
    return res.render("admin/vendors/menu-import", {
      pageTitle: `Import Menu – ${req.targetVendor.name}`,
      activeSection: "menus",
      vendor: req.targetVendor,
      shop: req.targetShop,
    });
  },
);

adminRouter.post(
  "/vendors/:vendorId/menu/import",
  resolveAdminVendorShop,
  (req, res, next) => {
    uploadImportFile.single("importFile")(req, res, (err) => {
      if (err) {
        req.flash("error", err.message || "Upload failed.");
        return res.redirect(`/admin/vendors/${req.params.vendorId}/menu/import`);
      }
      next();
    });
  },
  async (req, res) => {
      // ---- Guard: file present ----
      if (!req.file) {
        console.log("[MARK] no file uploaded — redirecting");
        req.flash("error", "No file was uploaded.");
        return res.redirect(`/admin/vendors/${req.params.vendorId}/menu/import`);
      }
      console.log("[MARK] file received:", req.file.originalname, req.file.path);

      // ---- Step 1: stageImport ----
      let importId;
      try {
        console.log("[MARK] stageImport start");
        const staged = await stageImport(
          req.file,
          req.params.vendorId,
          req.vendorShopIdStr,
        );
        importId = staged.importId;
        console.log("[MARK] stageImport done — importId:", importId);
      } catch (err) {
        console.error("=== [IMPORT] stageImport failed ===");
        console.error("Error message:", err.message || err);
        console.error("Full stack:", err instanceof Error ? err.stack : "(no stack)");
        req.flash("error", err.message || "Failed to process import.");
        return res.redirect(`/admin/vendors/${req.params.vendorId}/menu/import`);
      }

      // ---- Step 2: markProcessing ----
      try {
        console.log("[MARK] markProcessing start");
        markProcessing(importId);
        console.log("[MARK] markProcessing done");
      } catch (err) {
        console.error("=== [IMPORT] markProcessing failed ===");
        console.error("Error message:", err.message || err);
        console.error("Full stack:", err instanceof Error ? err.stack : "(no stack)");
        req.flash("error", err.message || "Failed to process import.");
        return res.redirect(`/admin/vendors/${req.params.vendorId}/menu/import`);
      }

      // ---- Step 3: extractMenu (Gemini fetch) ----
      let result;
      try {
        console.log("[MARK] extractMenu start");
        result = await extractMenu(req.file.path);
        console.log("[MARK] extractMenu done — items:", result.items.length, "error:", result.metadata?.error);
      } catch (err) {
        console.error("=== [IMPORT] extractMenu (Gemini) failed ===");
        console.error("Error message:", err.message || err);
        console.error("Full stack:", err instanceof Error ? err.stack : "(no stack)");
        // Mark the session as errored so it can be cleaned up later
        try { markError(importId, err.message || "Gemini extraction failed."); } catch {}
        req.flash("error", err.message || "Failed to process import.");
        return res.redirect(`/admin/vendors/${req.params.vendorId}/menu/import`);
      }

      const hasItems = result.items.length > 0;
      const errorMsg = result.metadata?.error || null;

      // ---- Step 4: updateSession ----
      try {
        console.log("[MARK] updateSession start");
        if (hasItems) {
          updateSession(importId, {
            status: "ready",
            visionResult: {
              items: result.items,
              rawText: result.rawText,
              metadata: result.metadata,
            },
          });
        } else {
          updateSession(importId, {
            status: hasItems ? "ready" : "error",
            visionResult: {
              items: [],
              rawText: result.rawText,
              metadata: result.metadata,
            },
            errors: errorMsg ? [errorMsg] : [],
          });
        }
        console.log("[MARK] updateSession done");
      } catch (err) {
        console.error("=== [IMPORT] updateSession failed ===");
        console.error("Error message:", err.message || err);
        console.error("Full stack:", err instanceof Error ? err.stack : "(no stack)");
        req.flash("error", err.message || "Failed to process import.");
        return res.redirect(`/admin/vendors/${req.params.vendorId}/menu/import`);
      }

      // ---- Step 5: render ----
      try {
        console.log("[MARK] res.render start");
        return res.render("admin/vendors/menu-import-preview", {
          pageTitle: hasItems ? "Review Extracted Items" : "Extraction Failed",
          activeSection: "menus",
          vendor: req.targetVendor,
          shop: req.targetShop,
          importId,
          fileName: req.file.originalname,
          items: result.items,
          rawText: result.rawText,
          avgConfidence: result.metadata.averageConfidence || 0,
          itemCount: result.metadata.itemCount || 0,
          visionError: errorMsg,
          provider: result.metadata.provider || "gemini-vision",
        });
        console.log("[MARK] res.render done — response sent");
      } catch (err) {
        console.error("=== [IMPORT] render preview failed ===");
        console.error("Error message:", err.message || err);
        console.error("Full stack:", err instanceof Error ? err.stack : "(no stack)");
        req.flash("error", err.message || "Failed to display preview.");
        return res.redirect(`/admin/vendors/${req.params.vendorId}/menu/import`);
      }
  },
);

adminRouter.post(
  "/vendors/:vendorId/menu/import/confirm",
  resolveAdminVendorShop,
  async (req, res) => {
    try {
      const { importId } = req.body;
      if (!importId) {
        req.flash("error", "Import session not found.");
        return res.redirect(`/admin/vendors/${req.params.vendorId}/menu`);
      }

      const session = getSession(importId);
      if (!session) {
        req.flash("error", "Import session has expired.");
        return res.redirect(`/admin/vendors/${req.params.vendorId}/menu`);
      }

      const shop = await Shop.findById(req.vendorShopId).lean();
      if (!shop || shop.isActive === false) {
        req.flash("error", "This shop is disabled by an admin.");
        return res.redirect(`/admin/vendors/${req.params.vendorId}/menu`);
      }

      const rawItems = req.body.items;
      if (!rawItems || (Array.isArray(rawItems) && rawItems.length === 0)) {
        req.flash("error", "No items to import.");
        return res.redirect(`/admin/vendors/${req.params.vendorId}/menu/import`);
      }

      const items = Array.isArray(rawItems) ? rawItems : [rawItems];

      const docs = [];
      for (const item of items) {
        const name = String(item.name || "").trim();
        const description = String(item.description || "").trim();
        const foodType = String(item.foodType || "unknown").trim().toLowerCase();
        const rawVariants = item.variants;

        if (!name) continue;

        const variants = [];
        if (Array.isArray(rawVariants)) {
          for (const v of rawVariants) {
            const label = String(v.label || "Regular").trim() || "Regular";
            const price = Number(v.price) || 0;
            if (price > 0) {
              variants.push({ label, price });
            }
          }
        }

        if (variants.length === 0) continue;

        const price = variants[0].price;

        const validFoodTypes = ["veg", "non-veg", "egg", "unknown"];
        const normalizedFoodType = validFoodTypes.includes(foodType)
          ? foodType
          : "unknown";

        docs.push({
          shop: req.vendorShopId,
          name,
          description,
          price,
          foodType: normalizedFoodType,
          variants,
          available: true,
        });
      }

      if (docs.length === 0) {
        req.flash("error", "No valid items to import.");
        return res.redirect(`/admin/vendors/${req.params.vendorId}/menu/import`);
      }

      await MenuItem.insertMany(docs);

      discardImport(importId);

      req.flash("success", `${docs.length} menu item(s) imported successfully.`);
      return res.redirect(`/admin/vendors/${req.params.vendorId}/menu`);
    } catch (err) {
      console.error("Import confirm error:", err);
      req.flash("error", err.message || "Failed to import menu items.");
      return res.redirect(`/admin/vendors/${req.params.vendorId}/menu/import`);
    }
  },
);

adminRouter.get("/analytics", async (req, res) => {
  const [
    totalRevenueAgg,
    ordersToday,
    ordersThisWeek,
    ordersThisMonth,
    popularShop,
    popularItem,
    peakHour,
    topShops,
    topVendors,
  ] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          status: { $in: ["paid", "accepted", "ready_for_pickup", "completed"] },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$total" },
        },
      },
    ]),
    Order.countDocuments({ createdAt: { $gte: startOfIstDay() } }),
    Order.countDocuments({ createdAt: { $gte: startOfIstWeek() } }),
    Order.countDocuments({ createdAt: { $gte: startOfIstMonth() } }),
    Order.aggregate([
      {
        $group: {
          _id: "$shop",
          orders: { $sum: 1 },
          revenue: { $sum: "$total" },
        },
      },
      { $sort: { orders: -1, revenue: -1 } },
      { $limit: 1 },
      {
        $lookup: {
          from: "shops",
          localField: "_id",
          foreignField: "_id",
          as: "shop",
        },
      },
      {
        $unwind: {
          path: "$shop",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          orders: 1,
          revenue: 1,
          name: "$shop.name",
          slug: "$shop.slug",
        },
      },
    ]),
    Order.aggregate([
      { $unwind: "$items" },
      { $match: { "items.status": { $ne: "removed" } } },
      {
        $group: {
          _id: "$items.name",
          quantity: { $sum: "$items.quantity" },
          revenue: {
            $sum: {
              $multiply: ["$items.price", "$items.quantity"],
            },
          },
        },
      },
      { $sort: { quantity: -1, revenue: -1 } },
      { $limit: 1 },
    ]),
    Order.aggregate([
      {
        $group: {
          _id: {
            $hour: {
              date: "$createdAt",
              timezone: "Asia/Kolkata",
            },
          },
          orders: { $sum: 1 },
        },
      },
      { $sort: { orders: -1, _id: 1 } },
      { $limit: 1 },
    ]),
    Order.aggregate([
      {
        $group: {
          _id: "$shop",
          orders: { $sum: 1 },
          revenue: { $sum: "$total" },
        },
      },
      { $sort: { orders: -1, revenue: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "shops",
          localField: "_id",
          foreignField: "_id",
          as: "shop",
        },
      },
      {
        $unwind: {
          path: "$shop",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          orders: 1,
          revenue: 1,
          shopName: "$shop.name",
          shopSlug: "$shop.slug",
        },
      },
    ]),
    Order.aggregate([
      {
        $lookup: {
          from: "shops",
          localField: "shop",
          foreignField: "_id",
          as: "shop",
        },
      },
      {
        $unwind: {
          path: "$shop",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "shop.vendor",
          foreignField: "_id",
          as: "vendor",
        },
      },
      {
        $unwind: {
          path: "$vendor",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $group: {
          _id: "$shop.vendor",
          vendorName: { $first: "$vendor.name" },
          vendorEmail: { $first: "$vendor.email" },
          shopName: { $first: "$shop.name" },
          orders: { $sum: 1 },
          revenue: { $sum: "$total" },
        },
      },
      { $sort: { orders: -1, revenue: -1 } },
      { $limit: 5 },
    ]),
  ]);

  return res.render("admin/analytics", {
    pageTitle: "Analytics",
    activeSection: "analytics",
    stats: {
      totalRevenue: totalRevenueAgg[0]?.total || 0,
      ordersToday,
      ordersThisWeek,
      ordersThisMonth,
    },
    mostPopularShop: popularShop[0] || null,
    mostPopularItem: popularItem[0] || null,
    peakHour: peakHour[0] ? humanizeTimeHour(peakHour[0]._id) : "Unknown",
    topShops,
    topVendors,
    formatMoney,
  });
});
