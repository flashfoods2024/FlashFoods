import mongoose from "mongoose";

// Immutable issued invoice. Created once per order; the snapshot, number and
// storage keys are never updated after issuance. Later refund/refund-state
// events are appended to `events` only.
const invoiceSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      unique: true,
    },
    shop: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    number: { type: String, required: true, unique: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    templateVersionId: { type: String, default: "" },
    templateSha256: { type: String, default: "" },
    mappingHash: { type: String, default: "" },
    rendererVersion: { type: Number, default: 1 },
    storageKey: { type: String, required: true },
    outputSha256: { type: String, required: true },
    byteSize: { type: Number, required: true },
    pageCount: { type: Number, required: true },
    issuedAt: { type: Date, default: Date.now },
    events: {
      type: [
        {
          type: { type: String },
          at: Date,
          amountPaise: Number,
          reference: String,
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

invoiceSchema.index({ shop: 1, issuedAt: -1 });
invoiceSchema.index({ customer: 1, issuedAt: -1 });

const PROTECTED_ON_UPDATE = [
  "order",
  "shop",
  "customer",
  "number",
  "snapshot",
  "templateVersionId",
  "templateSha256",
  "mappingHash",
  "storageKey",
  "outputSha256",
  "byteSize",
  "pageCount",
  "issuedAt",
];

// Collect every updated path, including paths nested under $set/$inc/etc.
function collectUpdatePaths(node, out = []) {
  if (!node || typeof node !== "object") return out;
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("$")) {
      collectUpdatePaths(value, out);
      continue;
    }
    out.push(key);
  }
  return out;
}

function rejectProtectedUpdate(update) {
  const touched = collectUpdatePaths(update).some((path) =>
    PROTECTED_ON_UPDATE.includes(path.split(".")[0]),
  );
  if (touched) {
    throw new Error("Issued invoices are immutable.");
  }
}

invoiceSchema.pre("save", function preSave(next) {
  if (!this.isNew) {
    return next(new Error("Issued invoices are immutable."));
  }
  return next();
});

invoiceSchema.pre("findOneAndUpdate", function preFindOneAndUpdate(next) {
  rejectProtectedUpdate(this.getUpdate());
  next();
});

invoiceSchema.pre("updateOne", function preUpdateOne(next) {
  rejectProtectedUpdate(this.getUpdate());
  next();
});

invoiceSchema.pre("updateMany", function preUpdateMany(next) {
  rejectProtectedUpdate(this.getUpdate());
  next();
});

invoiceSchema.pre("replaceOne", function preReplaceOne(next) {
  rejectProtectedUpdate(this.getUpdate());
  next();
});

export const Invoice = mongoose.model("Invoice", invoiceSchema);
