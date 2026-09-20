import mongoose from "mongoose";

// Atomic per-slot capacity ledger.
//
// One document per (shop, slotStart) records how many orders currently hold a
// place in that slot. Capacity is enforced with a conditional `$inc`, so two
// concurrent order creations can never both take the last place.
const pickupSlotBookingSchema = new mongoose.Schema(
  {
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
    },
    slotStart: { type: Date, required: true },
    booked: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

// Unique so the lazy "ensure document exists" upsert can race harmlessly.
pickupSlotBookingSchema.index({ shop: 1, slotStart: 1 }, { unique: true });

export const PickupSlotBooking = mongoose.model(
  "PickupSlotBooking",
  pickupSlotBookingSchema,
);
