import mongoose from "mongoose";

const fcmTokenSchema = new mongoose.Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
    },
    deviceInfo: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
);

fcmTokenSchema.index({ vendorId: 1, updatedAt: -1 });
fcmTokenSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const FcmToken = mongoose.model("FcmToken", fcmTokenSchema);
