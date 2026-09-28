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
    // Last time this token (re-)registered. Refreshed on every app open so
    // the server can tell a live binding from an abandoned one.
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    // Consecutive permanent FCM failures (invalid / not-registered). Reset
    // on every successful send or fresh registration; the token is removed
    // only after MAX_TOKEN_FAILURES strikes — never on a single failure.
    failCount: {
      type: Number,
      default: 0,
    },
    lastFailureAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

fcmTokenSchema.index({ vendorId: 1, updatedAt: -1 });
fcmTokenSchema.index({ customerId: 1, updatedAt: -1 });
fcmTokenSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const FcmToken = mongoose.model("FcmToken", fcmTokenSchema);
