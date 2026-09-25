import express from "express";
import { Shop } from "../models/Shop.js";
import { User } from "../models/User.js";
import { requireDb } from "../middleware/requireDb.js";
import {
  requireAuth,
  requireVendor,
  requireVendorShop,
} from "../middleware/auth.js";
import { normalizeQuery } from "../utils/admin.js";
import {
  getVendorProfileAnalytics,
  validateVendorProfileUpdate,
} from "../utils/vendor-analytics.js";

export const vendorProfileRouter = express.Router();

// Vendor Profile V2.
//
// Security model: the shop a vendor may read/write is ALWAYS derived from the
// authenticated session (requireVendorShop -> req.vendorShopId, sourced from
// req.user.shop). No shopId/vendorId coming from the query string, request
// body, or route params is ever used, so IDOR attempts are inert.
const VENDOR_GUARDS = [requireDb, requireAuth, requireVendor, requireVendorShop];

function formatMemberSince(date) {
  if (!date) return "Unknown";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  return parsed.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Explicit field allowlist for the view — no passwordHash, reset tokens,
// payment/security fields, or other account internals can leak through.
function accountView(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone || "",
    role: user.role,
    memberSince: formatMemberSince(user.createdAt),
  };
}

function wantsJson(req) {
  return req.accepts(["json", "html"]) === "json";
}

vendorProfileRouter.get(
  "/vendor/profile",
  ...VENDOR_GUARDS,
  async (req, res, next) => {
    try {
      const [shop, analytics] = await Promise.all([
        Shop.findById(req.vendorShopId)
          .select("name slug isOpen isActive")
          .lean(),
        getVendorProfileAnalytics({
          shopId: req.vendorShopId,
          range: "month",
        }),
      ]);

      if (!shop) {
        req.flash("error", "Shop not found.");
        return res.redirect("/");
      }

      return res.render("vendor/profile", {
        pageTitle: "Vendor Profile",
        shop,
        account: accountView(req.user),
        analytics,
      });
    } catch (err) {
      return next(err);
    }
  },
);

vendorProfileRouter.get(
  "/vendor/profile/analytics",
  ...VENDOR_GUARDS,
  async (req, res, next) => {
    try {
      const analytics = await getVendorProfileAnalytics({
        // Server-derived ownership only. req.query.shop / shopId / vendorId
        // are deliberately ignored.
        shopId: req.vendorShopId,
        range: normalizeQuery(req.query.range) || "month",
        startDate: normalizeQuery(req.query.startDate),
        endDate: normalizeQuery(req.query.endDate),
      });

      if (!analytics.ok) {
        return res.status(400).json(analytics);
      }
      return res.json(analytics);
    } catch (err) {
      return next(err);
    }
  },
);

vendorProfileRouter.post(
  "/vendor/profile",
  ...VENDOR_GUARDS,
  async (req, res, next) => {
    try {
      const result = validateVendorProfileUpdate({
        name: req.body?.name,
        phone: req.body?.phone,
      });

      if (!result.ok) {
        if (wantsJson(req)) {
          return res.status(400).json({
            success: false,
            error: result.error,
            field: result.field || null,
          });
        }
        req.flash("error", result.error);
        return res.redirect("/vendor/profile");
      }

      // Only whitelisted keys are ever applied; role/shop/isActive/email stay
      // untouched. Scoped to the authenticated user AND the vendor role.
      const updated = await User.findOneAndUpdate(
        { _id: req.user._id, role: "vendor" },
        { $set: result.updates },
        {
          new: true,
          runValidators: true,
          select: "name email phone",
        },
      ).lean();

      if (!updated) {
        if (wantsJson(req)) {
          return res
            .status(404)
            .json({ success: false, error: "Vendor account not found." });
        }
        req.flash("error", "Vendor account not found.");
        return res.redirect("/vendor/profile");
      }

      if (wantsJson(req)) {
        return res.json({
          success: true,
          name: updated.name,
          phone: updated.phone || "",
        });
      }

      req.flash("success", "Profile updated.");
      return res.redirect("/vendor/profile");
    } catch (err) {
      return next(err);
    }
  },
);
