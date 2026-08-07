import express from "express";
import { Order } from "../models/Order.js";
import { User } from "../models/User.js";
import { requireDb } from "../middleware/requireDb.js";
import { requireAuth, requireStudent } from "../middleware/auth.js";
import { validateIndianPhone } from "../utils/phone.js";

export const profileRouter = express.Router();

function getGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Good Morning";
  if (h >= 12 && h < 17) return "Good Afternoon";
  return "Good Evening";
}

// Single aggregation over completed orders only — no N+1.
const PROFILE_STATS = [
  {
    $facet: {
      summary: [
        { $group: { _id: null, count: { $sum: 1 }, totalSpent: { $sum: "$total" } } },
        { $project: { _id: 0, count: 1, totalSpent: 1 } },
      ],
      topShop: [
        { $group: { _id: "$shop", count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 1 },
        {
          $lookup: {
            from: "shops",
            localField: "_id",
            foreignField: "_id",
            as: "shop",
          },
        },
        { $unwind: { path: "$shop", preserveNullAndEmptyArrays: true } },
        { $project: { _id: 0, count: 1, name: "$shop.name" } },
      ],
      topItem: [
        { $unwind: "$items" },
        { $group: { _id: "$items.name", qty: { $sum: "$items.quantity" } } },
        { $sort: { qty: -1, _id: 1 } },
        { $limit: 1 },
        { $project: { _id: 0, name: "$_id", qty: 1 } },
      ],
    },
  },
];

profileRouter.get(
  "/profile",
  requireDb,
  requireAuth,
  requireStudent,
  async (req, res) => {
    const [stats] = await Order.aggregate([
      { $match: { customer: req.user._id, status: "completed" } },
      ...PROFILE_STATS,
    ]);

    const summary = stats.summary[0];
    const favShop = stats.topShop[0]?.name || null;
    const favItem = stats.topItem[0]?.name || null;

    return res.render("profile/index", {
      pageTitle: "Profile",
      greeting: getGreeting(),
      firstName: String(req.user.name).trim().split(/\s+/)[0],
      stats: {
        completedCount: summary?.count || 0,
        totalSpent: summary?.totalSpent || 0,
        favShop,
        favItem,
      },
    });
  },
);

profileRouter.post(
  "/profile/phone",
  requireDb,
  requireAuth,
  requireStudent,
  async (req, res) => {
    const digits = validateIndianPhone(req.body?.phone);

    if (!digits) {
      return res
        .status(400)
        .json({ success: false, error: "Enter a valid 10-digit Indian mobile number." });
    }

    const updated = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { phone: digits } },
      { new: true, select: "phone" },
    ).lean();

    if (!updated || updated.phone !== digits) {
      return res
        .status(500)
        .json({ success: false, error: "Could not save phone number. Please try again." });
    }

    return res.json({ success: true, phone: updated.phone });
  },
);
