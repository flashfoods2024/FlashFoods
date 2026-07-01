import { User } from "../models/User.js";
import { Shop } from "../models/Shop.js";
import mongoose from "mongoose";

/** Loads DB user onto req.user when session has userId (no redirect). Run after session. */
export async function attachUser(req, res, next) {
  req.user = undefined;
  if (!req.session?.userId) {
    return next();
  }

  try {
    const user = await User.findById(req.session.userId).select("-passwordHash").lean();
    if (!user || user.isActive === false) {
      delete req.session.userId;
      return next();
    }
    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

export async function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    req.flash("error", "Please log in to continue.");
    return res.redirect("/login");
  }

  const sid = String(req.session.userId);
  if (req.user && String(req.user._id) === sid) {
    return next();
  }

  try {
    const user = await User.findById(req.session.userId).select("-passwordHash").lean();
    if (!user || user.isActive === false) {
      req.flash("error", "Please log in to continue.");
      delete req.session.userId;
      return res.redirect("/login");
    }
    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

export function requireVendor(req, res, next) {
  if (!req.user || req.user.role !== "vendor") {
    req.flash("error", "Vendor access only.");
    return res.redirect("/");
  }
  return next();
}

export function requireStudent(req, res, next) {
  if (!req.user || req.user.role !== "student") {
    req.flash("error", "Student access only.");
    return res.redirect("/");
  }
  return next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    req.flash("error", "Admin access only.");
    return res.redirect("/");
  }
  return next();
}

export function requireVendorShop(req, res, next) {
  if (!req.user || req.user.role !== "vendor") {
    req.flash("error", "Vendor access only.");
    return res.redirect("/");
  }
  if (!req.user.shop) {
    req.flash("error", "Your vendor account is not linked to a shop yet.");
    return res.redirect("/");
  }
  req.vendorShopId = req.user.shop;
  req.vendorShopIdStr = String(req.user.shop);
  return next();
}

/**
 * Admin-only middleware: loads the target vendor's shop by vendorId param
 * and sets req.vendorShopId / req.vendorShopIdStr.
 * Also sets req.targetVendor and req.targetShop for display in the admin banner.
 */
export async function resolveAdminVendorShop(req, res, next) {
  const { vendorId } = req.params;
  if (!mongoose.isValidObjectId(vendorId)) {
    req.flash("error", "Vendor not found.");
    return res.redirect("/admin/menus");
  }

  try {
    const vendor = await User.findOne({ _id: vendorId, role: "vendor" })
      .populate("shop")
      .lean();
    if (!vendor) {
      req.flash("error", "Vendor not found.");
      return res.redirect("/admin/menus");
    }
    if (!vendor.shop) {
      req.flash("error", "This vendor does not have an assigned shop.");
      return res.redirect("/admin/menus");
    }

    const shopId = vendor.shop._id || vendor.shop;
    req.vendorShopId = shopId;
    req.vendorShopIdStr = String(shopId);
    req.targetVendor = vendor;
    req.targetShop = vendor.shop;
    return next();
  } catch (err) {
    return next(err);
  }
}
