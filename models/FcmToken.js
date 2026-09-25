import mongoose from "mongoose";

const fcmTokenSchema = new mongoose.Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      // One of vendorId / customerId must be set: vendor tokens drive
      // new-order alerts, customer tokens drive order-ready alerts (F06.5).
      required: function () {
        return !this.customerId;
      },
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: function () {
        return !this.vendorId;
      },
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
fcmTokenSchema.index({ customerId: 1, updatedAt: -1 });
fcmTokenSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const FcmToken = mongoose.model("FcmToken", fcmTokenSchema);
