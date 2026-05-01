import mongoose from "mongoose";

const menuItemSchema = new mongoose.Schema(
  {
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    available: { type: Boolean, default: true },
  },
  { timestamps: true }
);

menuItemSchema.index({ shop: 1, name: 1 });

export const MenuItem = mongoose.model("MenuItem", menuItemSchema);
