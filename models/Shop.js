import mongoose from "mongoose";

const shopSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: "" },
    image: { type: String, default: "" },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    isOpen: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    disabledAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

export const Shop = mongoose.model("Shop", shopSchema);
