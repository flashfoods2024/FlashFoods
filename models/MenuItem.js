import mongoose from "mongoose";

const variantSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const menuItemSchema = new mongoose.Schema(
  {
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, default: "", trim: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    image: { type: String, default: "" },
    available: { type: Boolean, default: true },
    foodType: {
      type: String,
      enum: ["veg", "non-veg", "egg", "unknown"],
      default: "unknown",
    },
    variants: {
      type: [variantSchema],
      default: [{ label: "Regular", price: 0 }],
    },
  },
  { timestamps: true }
);

menuItemSchema.index({ shop: 1, name: 1 });

export const MenuItem = mongoose.model("MenuItem", menuItemSchema);
