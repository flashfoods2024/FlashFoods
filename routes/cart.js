import express from "express";
import mongoose from "mongoose";
import { MenuItem } from "../models/MenuItem.js";
import { Shop } from "../models/Shop.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireAuth, requireStudent } from "../middleware/auth.js";

export const cartRouter = express.Router();

function getCart(req) {
  if (!req.session.cart || typeof req.session.cart !== "object") {
    req.session.cart = { shopId: null, items: [] };
  }
  if (!Array.isArray(req.session.cart.items)) req.session.cart.items = [];
  return req.session.cart;
}

cartRouter.get(
  "/cart",
  requireDb,
  requireAuth,
  requireStudent,
  async (req, res) => {
    const cart = getCart(req);
    let shop = null;
    let lines = [];

    if (cart.shopId && cart.items.length) {
      shop = await Shop.findById(cart.shopId).lean();
      if (!shop || shop.isActive === false) {
        req.session.cart = { shopId: null, items: [] };
        req.flash("error", "That canteen is no longer available.");
        return res.redirect("/shops");
      }
      const ids = cart.items.map((l) => l.menuItemId).filter(Boolean);
      const items = await MenuItem.find({ _id: { $in: ids } }).lean();
      const byId = new Map(items.map((m) => [String(m._id), m]));
      lines = cart.items
        .map((line) => {
          const m = byId.get(String(line.menuItemId));
          if (!m) return null;
          var variantId = line.variantId != null ? line.variantId : null;
          var variantName = line.variantName || null;
          var variantPrice = null;
          if (variantId != null && m.variants && m.variants[variantId]) {
            variantPrice = m.variants[variantId].price;
          }
          return {
            menuItemId: String(m._id),
            name: m.name,
            price: m.price,
            quantity: line.quantity,
            available: m.available,
            variants: m.variants || [],
            variantId: variantId,
            variantName: variantName,
            variantPrice: variantPrice,
          };
        })
        .filter(Boolean);
    }

    var subtotal = 0;
    var allVariantsSelected = true;
    lines.forEach(function(l) {
      if (l.variantId == null && l.variants.length > 1) {
        allVariantsSelected = false;
        return;
      }
      subtotal += (l.variantPrice != null ? l.variantPrice : l.price) * l.quantity;
    });

    let razorpayKeyId = "";
    if (shop?.paymentGateway === "razorpay") {
      razorpayKeyId =
        shop.paymentSettings?.razorpay?.keyId ||
        process.env.RAZORPAY_KEY_ID ||
        "";
    }

    res.render("cart/index", {
      pageTitle: "Cart",
      shop,
      lines,
      subtotal,
      allVariantsSelected,
      razorpayKeyId,
    });
  },
);

cartRouter.post(
  "/cart/add",
  requireDb,
  requireAuth,
  requireStudent,
  async (req, res) => {
    const { menuItemId, quantity, redirect } = req.body || {};
    const qty = Math.max(1, Math.min(99, Number(quantity) || 1));

    if (!menuItemId || !mongoose.isValidObjectId(String(menuItemId))) {
      req.flash("error", "Invalid item.");
      return res.redirect(redirect || "/shops");
    }

    const item = await MenuItem.findById(menuItemId).lean();
    if (!item || !item.available) {
      req.flash("error", "That item is not available.");
      return res.redirect(redirect || "/shops");
    }

    const shopIdStr = String(item.shop);
    const shop = await Shop.findById(item.shop).lean();
    if (!shop || shop.isActive === false || shop.isOpen === false) {
      req.flash("error", "This shop is currently closed.");
      return res.redirect(redirect || "/shops");
    }

    const cart = getCart(req);

    if (cart.shopId && String(cart.shopId) !== shopIdStr && cart.items.length) {
      req.flash(
        "error",
        "Your cart has items from another canteen. Clear the cart first.",
      );
      return res.redirect(shop ? `/shops/${shop.slug}` : "/shops");
    }

    cart.shopId = shopIdStr;

    // Determine variant info
    const variants = item.variants || [];
    var variantId = null;
    var variantName = null;

    if (variants.length === 0) {
      // No variants — treat as single default variant
      variantId = 0;
      variantName = "Regular";
    } else if (variants.length === 1) {
      // Single variant — auto-select it
      variantId = 0;
      variantName = variants[0].label;
    }
    // Multiple variants — stay null, user selects in cart

    const existing = cart.items.find(
      (l) => String(l.menuItemId) === String(menuItemId),
    );
    if (existing) {
      existing.quantity = Math.min(99, existing.quantity + qty);
      if (existing.variantId == null) {
        // preserve null; if a variant was selected later, keep it
      }
    } else {
      cart.items.push({
        menuItemId: String(menuItemId),
        quantity: qty,
        variantId: variantId,
        variantName: variantName,
      });
    }

    req.flash("success", "Added to cart.");
    const dest = redirect || (shop ? `/shops/${shop.slug}` : "/shops");
    return res.redirect(dest);
  },
);

cartRouter.post(
  "/cart/variant",
  requireDb,
  requireAuth,
  requireStudent,
  async (req, res) => {
    const { menuItemId, variantId } = req.body || {};
    const cart = getCart(req);

    if (!menuItemId) {
      return res.status(400).json({ error: "Missing menuItemId" });
    }

    const line = cart.items.find(
      (l) => String(l.menuItemId) === String(menuItemId),
    );
    if (!line) {
      return res.status(404).json({ error: "Item not found in cart" });
    }

    // Look up current variant names
    const item = await MenuItem.findById(menuItemId).lean();
    if (!item) {
      return res.status(404).json({ error: "Menu item not found" });
    }

    const variants = item.variants || [];
    var vi = variantId != null ? Number(variantId) : null;

    if (vi != null && variants[vi]) {
      line.variantId = vi;
      line.variantName = variants[vi].label;
    } else {
      line.variantId = null;
      line.variantName = null;
    }

    // Recalculate total
    const ids = cart.items.map((l) => l.menuItemId);
    const menuItems = await MenuItem.find({ _id: { $in: ids } }).lean();
    const byId = new Map(menuItems.map((m) => [String(m._id), m]));

    var subtotal = 0;
    var allVariantsSelected = true;
    cart.items.forEach(function(li) {
      var m = byId.get(String(li.menuItemId));
      if (!m) return;
      var lvi = li.variantId != null ? li.variantId : null;
      if (lvi == null && (m.variants || []).length > 1) {
        allVariantsSelected = false;
        return;
      }
      var price = m.price;
      if (lvi != null && m.variants && m.variants[lvi]) {
        price = m.variants[lvi].price;
      }
      subtotal += price * (li.quantity || 1);
    });

    return res.json({
      success: true,
      variantName: line.variantName,
      variantPrice: vi != null && variants[vi] ? variants[vi].price : null,
      subtotal: subtotal,
      allVariantsSelected: allVariantsSelected,
    });
  },
);

cartRouter.post(
  "/cart/line",
  requireDb,
  requireAuth,
  requireStudent,
  async (req, res) => {
    const { menuItemId, quantity } = req.body || {};
    const cart = getCart(req);
    const qty = Math.max(0, Math.min(99, Number(quantity) || 0));
    const line = cart.items.find(
      (l) => String(l.menuItemId) === String(menuItemId),
    );
    if (line) {
      if (qty <= 0)
        cart.items = cart.items.filter(
          (l) => String(l.menuItemId) !== String(menuItemId),
        );
      else line.quantity = qty;
    }
    if (!cart.items.length) cart.shopId = null;
    req.flash("success", "Cart updated.");
    return res.redirect("/cart");
  },
);

cartRouter.post(
  "/cart/clear",
  requireDb,
  requireAuth,
  requireStudent,
  (req, res) => {
    req.session.cart = { shopId: null, items: [] };
    req.flash("success", "Cart cleared.");
    return res.redirect("/cart");
  },
);
