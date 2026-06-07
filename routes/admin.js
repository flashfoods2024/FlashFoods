import express from "express";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";

import { Order } from "../models/Order.js";
import { User } from "../models/User.js";
import { Shop } from "../models/Shop.js";
import { MenuItem } from "../models/MenuItem.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { handleShopImageUpload } from "../middleware/upload.js";
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
  const vendor = vendorId && mongoose.isValidObjectId(vendorId)
    ? await User.findById(vendorId)
    : null;
  const shop = shopId && mongoose.isValidObjectId(shopId)
    ? await Shop.findById(shopId)
    : null;

  if (vendor && vendor.role !== "vendor") {
    throw new Error("Selected user is not a vendor.");
  }

  const currentVendorShopId = vendor?.shop ? toHexId(vendor.shop) : null;
  const currentShopVendorId = shop?.vendor ? toHexId(shop.vendor) : null;

  if (vendor && currentVendorShopId && currentVendorShopId !== toHexId(shop?._id)) {
    const previousShop = await Shop.findById(currentVendorShopId);
    if (previousShop && toHexId(previousShop.vendor) === toHexId(vendor._id)) {
      previousShop.vendor = null;
      await previousShop.save();
    }
  }

  if (shop && currentShopVendorId && currentShopVendorId !== toHexId(vendor?._id)) {
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
  if (filterValue === "paid" || filterValue === "preparing") {
    return order.status === "paid";
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
    Order.countDocuments({ status: "paid" }),
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

  res.render("admin/dashboard", {
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
    Shop.find().sort({ name: 1 }).populate("vendor", "name email role isActive").lean(),
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
      statusLabel: shop.isActive === false
        ? "Disabled"
        : shop.isOpen === false
          ? "Closed"
          : "Open",
    };
  });

  res.render("admin/shops/index", {
    pageTitle: "Manage Shops",
    activeSection: "shops",
    shops: rows,
    orderNumber,
  });
});

adminRouter.get("/shops/new", async (req, res) => {
  const vendors = await User.find({ role: "vendor" }).sort({ name: 1 }).lean();
  res.render("admin/shops/form", {
    pageTitle: "Create Shop",
    activeSection: "shops",
    mode: "create",
    shop: null,
    vendors,
  });
});

adminRouter.post("/shops", handleShopImageUpload("/admin/shops/new"), async (req, res) => {
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
      await syncVendorShopLink({ vendorId: assignedVendorId, shopId: shop._id });
    }

    req.flash("success", "Shop created.");
    return res.redirect("/admin/shops");
  } catch (error) {
    console.error(error);
    req.flash("error", error.message || "Could not create shop.");
    return res.redirect("/admin/shops/new");
  }
});

adminRouter.get("/shops/:id", async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    req.flash("error", "Shop not found.");
    return res.redirect("/admin/shops");
  }

  const [shop, menuItems, orderStats] = await Promise.all([
    Shop.findById(id)
      .populate("vendor", "name email role isActive")
      .lean(),
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
                { $in: ["$status", ["paid", "ready_for_pickup", "completed"]] },
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

  res.render("admin/shops/show", {
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

  res.render("admin/shops/form", {
    pageTitle: `Edit ${shop.name}`,
    activeSection: "shops",
    mode: "edit",
    shop,
    vendors,
  });
});

adminRouter.post("/shops/:id/edit", handleShopImageUpload((req) => `/admin/shops/${req.params.id}/edit`), async (req, res) => {
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
      await syncVendorShopLink({ vendorId: assignedVendorId, shopId: shop._id });
    } else if (shop.vendor) {
      const previousVendor = await User.findById(shop.vendor);
      if (previousVendor && toHexId(previousVendor.shop) === toHexId(shop._id)) {
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
});

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

  req.flash(
    "success",
    shop.isActive ? "Shop enabled." : "Shop disabled."
  );
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
    completedOrders: completedCounts.get(toHexId(vendor.shop?._id || vendor.shop)) || 0,
    assignedShopName: vendor.shop?.name || "Unassigned",
    statusLabel: vendor.isActive === false ? "Disabled" : "Active",
  }));

  res.render("admin/vendors/index", {
    pageTitle: "Manage Vendors",
    activeSection: "vendors",
    vendors: rows,
    orderNumber,
  });
});

adminRouter.get("/vendors/new", async (req, res) => {
  const shops = await Shop.find().sort({ name: 1 }).lean();
  res.render("admin/vendors/form", {
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
      await syncVendorShopLink({ vendorId: vendor._id, shopId: assignedShopId });
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

  const recentOrders = await Order.find({ shop: vendor.shop?._id || vendor.shop })
    .sort({ createdAt: -1 })
    .limit(8)
    .populate("customer", "name email")
    .lean();

  const completedOrders = vendor.shop
    ? await Order.countDocuments({ shop: vendor.shop._id, status: "completed" })
    : 0;

  res.render("admin/vendors/show", {
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
    User.findOne({ _id: id, role: "vendor" }).populate("shop", "name slug").lean(),
    Shop.find().sort({ name: 1 }).lean(),
  ]);

  if (!vendor) {
    req.flash("error", "Vendor not found.");
    return res.redirect("/admin/vendors");
  }

  res.render("admin/vendors/form", {
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
      await syncVendorShopLink({ vendorId: vendor._id, shopId: assignedShopId });
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

  req.flash("success", vendor.isActive ? "Vendor enabled." : "Vendor disabled.");
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

  res.render("admin/students/index", {
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

  res.render("admin/students/show", {
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

  req.flash("success", student.isActive ? "Student enabled." : "Student disabled.");
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

  res.render("admin/orders/index", {
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

  res.render("admin/orders/show", {
    pageTitle: `Order ${orderNumber(order)}`,
    activeSection: "orders",
    order,
    orderNumber,
    formatOrderStatus,
    paymentStatus: paymentStatusLabel(order),
    formatMoney,
  });
});

adminRouter.get("/analytics", async (req, res) => {
  const [totalRevenueAgg, ordersToday, ordersThisWeek, ordersThisMonth, popularShop, popularItem, peakHour, topShops, topVendors] =
    await Promise.all([
      Order.aggregate([
        {
          $match: {
            status: { $in: ["paid", "ready_for_pickup", "completed"] },
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

  res.render("admin/analytics", {
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
