import mongoose from "mongoose";

// Atomic, shop-scoped invoice number sequence. Allocation is a single
// findOneAndUpdate($inc) so concurrent completions can never share a number.
const invoiceCounterSchema = new mongoose.Schema(
  {
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      unique: true,
    },
    seq: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const InvoiceCounter = mongoose.model(
  "InvoiceCounter",
  invoiceCounterSchema,
);
