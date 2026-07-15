import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema(
  {
    menuItem: { type: mongoose.Schema.Types.ObjectId, ref: "MenuItem" },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ["active", "removed"],
      default: "active",
    },
    variantId: { type: Number, default: null },
    variantName: { type: String, default: null },
    variantPrice: { type: Number, default: null },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true },
    items: { type: [orderItemSchema], required: true },
    orderType: {
      type: String,
      enum: ["parcel", "dinein"],
      default: "dinein",
    },
    parcelCharge: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },

    pickupTime: {
      type: Date,
      default: null,
      index: true,
    },

    collectedAt: {
      type: Date,
      default: null,
    },

    status: {
      type: String,
      enum: [
        "pending_payment",
        "paid",
        "accepted",
        "ready_for_pickup",
        "completed",
        "cancelled",
      ],
      default: "pending_payment",
    },

    pickupOtp: { type: String, required: true },

    paymentNote: { type: String, default: "mock" },
    transactionId: { type: String, default: "" },

    // Razorpay identifiers persisted at order-creation time so webhooks
    // can reliably map an event back to an existing order.
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String, default: "" },

    // Last Razorpay webhook event id processed for this order.
    // Used to make webhook delivery idempotent (no duplicate processing).
    webhookEventId: { type: String, default: "" },

    // Generic gateway transaction reference for non-Razorpay gateways
    // (e.g. Easebuzz). Lets the pending-order tracking pattern be reused
    // without overloading the Razorpay-specific identifier fields.
    gatewayTxnId: { type: String },

    readyAt: { type: Date, default: null },

    refundStatus: {
      type: String,
      enum: ["none", "pending", "completed", "failed"],
      default: "none",
    },

    // Adjustment fields — populated when vendor removes items from a paid/accepted order
    originalTotal: { type: Number },
    updatedTotal: { type: Number },
    refundAmount: { type: Number },
    adjustedAt: { type: Date },
    adjustedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    adjustmentReason: {
      type: String,
      enum: ["Out of Stock", "Preparation Issue", "Ingredient Unavailable", "Kitchen Issue", "Other"],
    },
  },
  { timestamps: true },
);

orderSchema.index({ shop: 1, pickupOtp: 1 });
orderSchema.index({ shop: 1, status: 1 });
orderSchema.index({ customer: 1, createdAt: -1 });

// New index for priority ordering
orderSchema.index({ shop: 1, pickupTime: 1, createdAt: 1 });

// Fast, unique lookup by Razorpay order id for webhook + verify flows.
// Sparse so existing/mock orders without a razorpayOrderId are unaffected.
orderSchema.index({ razorpayOrderId: 1 }, { unique: true, sparse: true });

// Lookup by generic gateway transaction id (Easebuzz and future gateways).
orderSchema.index({ gatewayTxnId: 1 }, { unique: true, sparse: true });

export const Order = mongoose.model("Order", orderSchema);
