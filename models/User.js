import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["student", "vendor", "admin"], default: "student" },
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", default: null },
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);
