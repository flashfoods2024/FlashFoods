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
    // Operating hours as 24-hour "HH:MM" strings in IST. Empty string means
    // "no hours configured" and availability falls back to the isOpen flag.
    openingTime: {
      type: String,
      default: "",
      trim: true,
    },
    closingTime: {
      type: String,
      default: "",
      trim: true,
    },
    // Pickup-slot configuration. When `enabled`, students must choose one of
    // the generated slots (see utils/pickup-slots.js) and capacity is enforced
    // server-side via the PickupSlotBooking ledger.
    pickupSlots: {
      enabled: { type: Boolean, default: false },
      startTime: { type: String, default: "", trim: true },
      endTime: { type: String, default: "", trim: true },
      durationMinutes: { type: Number, default: 15, min: 5, max: 240 },
      capacity: { type: Number, default: 10, min: 1, max: 500 },
      daysAhead: { type: Number, default: 1, min: 0, max: 7 },
    },
    // Percentage discount applied to the food subtotal (never the parcel
    // charge). The authoritative calculation lives in utils/discount.js.
    discount: {
      enabled: { type: Boolean, default: false },
      percent: { type: Number, default: 0, min: 0, max: 100 },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    disabledAt: {
      type: Date,
      default: null,
    },

    parcelChargeEnabled: {
      type: Boolean,
      default: false,
    },
    parcelCharge: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true },
);

export const Shop = mongoose.model("Shop", shopSchema);
