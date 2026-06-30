import express from "express";
import { Shop } from "../models/Shop.js";
import { MenuItem } from "../models/MenuItem.js";
import { requireDb } from "../middleware/requireDb.js";

export const shopsRouter = express.Router();

shopsRouter.get("/shops", requireDb, async (req, res) => {
  const shops = await Shop.find({ isActive: { $ne: false } }).sort({ name: 1 }).lean();
  res.render("shops/index", { pageTitle: "Canteens", shops });
});

shopsRouter.get("/shops/:slug", requireDb, async (req, res) => {
  const shop = await Shop.findOne({ slug: String(req.params.slug).toLowerCase().trim() }).lean();
  if (!shop || shop.isActive === false) {
    req.flash("error", "Canteen not found.");
    return res.redirect("/shops");
  }
  if (typeof shop.isOpen !== "boolean") shop.isOpen = true;
  const menuItems = await MenuItem.find({ shop: shop._id, available: true }).sort({ name: 1 }).lean();
  res.render("shops/menu", { pageTitle: shop.name, shop, menuItems });
});
