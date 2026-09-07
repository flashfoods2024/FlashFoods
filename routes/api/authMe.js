import express from "express";
import { Shop } from "../../models/Shop.js";

export const authMeRouter = express.Router();

authMeRouter.get("/me", async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const user = {
    id: req.user._id,
    role: req.user.role,
    name: req.user.name,
    phone: req.user.phone || "",
  };

  if (req.user.role === "vendor" && req.user.shop) {
    try {
      const shop = await Shop.findById(req.user.shop).select("name slug").lean();
      if (shop) {
        user.shop = { id: shop._id, name: shop.name, slug: shop.slug };
      }
    } catch {
      /* ignore — identity without shop is still valid */
    }
  }

  res.json({ user });
});