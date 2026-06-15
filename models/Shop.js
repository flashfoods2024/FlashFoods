import mongoose from "mongoose";

const shopSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: { type: String, default: "" },
    image: { type: String, default: "" },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    paymentGateway: {
      type: String,
      enum: ["razorpay", "easebuzz", "phonepe", "paytm", "bharatpe"],
      default: "razorpay",
    },

    paymentConfigured: {
      type: Boolean,
      default: false,
    },

    paymentSettings: {
      merchantId: { type: String, default: "" },
      apiKey: { type: String, default: "" },
      apiSecret: { type: String, default: "" },
      razorpay: {
        keyId: { type: String, default: "" },
        keySecret: { type: String, default: "" },
        webhookSecret: { type: String, default: "" },
      },
      easebuzz: {
        merchantKey: { type: String, default: "" },
        salt: { type: String, default: "" },
        // "test" (sandbox) or "prod" (live).
        env: { type: String, enum: ["test", "prod"], default: "test" },
      },
      phonepe: {
        clientId: { type: String, default: "" },
        clientSecret: { type: String, default: "" },
        clientVersion: { type: String, default: "" },
        env: { type: String, enum: ["UAT", "PROD"], default: "UAT" },
      },
    },
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
  { timestamps: true },
);

export const Shop = mongoose.model("Shop", shopSchema);
