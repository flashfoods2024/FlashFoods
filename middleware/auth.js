import { User } from "../models/User.js";

/** Loads DB user onto req.user when session has userId (no redirect). Run after session. */
export async function attachUser(req, res, next) {
  req.user = undefined;
  if (!req.session?.userId) {
    return next();
  }

  try {
    const user = await User.findById(req.session.userId).select("-passwordHash").lean();
    if (!user) {
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
    if (!user) {
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
  if (req.user.role !== "vendor") {
    req.flash("error", "Vendor access only.");
    return res.redirect("/");
  }
  return next();
}

export function requireStudent(req, res, next) {
  if (req.user.role !== "student") {
    req.flash("error", "Student access only.");
    return res.redirect("/");
  }
  return next();
}

export function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    req.flash("error", "Admin access only.");
    return res.redirect("/");
  }
  return next();
}

export function requireVendorShop(req, res, next) {
  if (req.user.role !== "vendor") {
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
