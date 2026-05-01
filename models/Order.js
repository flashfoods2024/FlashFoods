import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema(
  {
    menuItem: { type: mongoose.Schema.Types.ObjectId, ref: "MenuItem" },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true },
    items: { type: [orderItemSchema], required: true },
    total: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["pending_payment", "paid", "completed", "cancelled"],
      default: "pending_payment",
    },
    pickupOtp: { type: String, required: true },
    paymentNote: { type: String, default: "mock" },
  },
  { timestamps: true }
);

orderSchema.index({ shop: 1, pickupOtp: 1 });
orderSchema.index({ customer: 1, createdAt: -1 });

export const Order = mongoose.model("Order", orderSchema);
