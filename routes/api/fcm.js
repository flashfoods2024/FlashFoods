import { Router } from "express";
import { requireAuth, requireVendor } from "../../middleware/auth.js";
import { FcmToken } from "../../models/FcmToken.js";

export const fcmRouter = Router();

fcmRouter.use(requireAuth, requireVendor);

fcmRouter.post("/register", async (req, res) => {
  try {
    const { token, deviceInfo } = req.body;

    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "Token is required." });
    }

    const ownedByOther = await FcmToken.exists({
      token,
      vendorId: { $ne: req.user._id },
    });
    if (ownedByOther) {
      return res
        .status(409)
        .json({ error: "Token is already registered to another account." });
    }

    await FcmToken.findOneAndUpdate(
      { token, vendorId: req.user._id },
      {
        $set: { deviceInfo: typeof deviceInfo === "string" ? deviceInfo : "" },
        $setOnInsert: { token, vendorId: req.user._id },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    res.json({ success: true });
  } catch (err) {
    console.error("FCM register error:", err);
    res.status(500).json({ error: "Failed to register device." });
  }
});

fcmRouter.post("/unregister", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "Token is required." });
    }

    await FcmToken.deleteOne({ token, vendorId: req.user._id });

    res.json({ success: true });
  } catch (err) {
    console.error("FCM unregister error:", err);
    res.status(500).json({ error: "Failed to unregister device." });
  }
});
