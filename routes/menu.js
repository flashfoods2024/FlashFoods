import express from "express";
import mongoose from "mongoose";
import { MenuItem } from "../models/MenuItem.js";
import { Shop } from "../models/Shop.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireAuth, requireVendor, requireVendorShop } from "../middleware/auth.js";

export const menuRouter = express.Router();

menuRouter.patch(
  "/menu/:id/toggle",
  requireDb,
  requireAuth,
  requireVendor,
  requireVendorShop,
  async (req, res) => {
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
  }
);
