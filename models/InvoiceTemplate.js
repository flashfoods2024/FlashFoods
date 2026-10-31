import mongoose from "mongoose";

// One immutable uploaded revision of a vendor's invoice PDF, plus the field
// mapping configured once against that exact revision.
const templateVersionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    originalFileKey: { type: String, required: true },
    originalFileName: { type: String, default: "" },
    byteSize: { type: Number, required: true },
    sha256: { type: String, required: true },
    pageCount: { type: Number, required: true },
    pageSizes: {
      type: [{ width: Number, height: Number }],
      default: [],
    },
    // Field mapping (PDF-native coordinates). Frozen once the version is
    // activated; validation lives in utils/invoice/mapping.js.
    mapping: { type: mongoose.Schema.Types.Mixed, default: null },
    mappingHash: { type: String, default: "" },
    previewMappingHash: { type: String, default: "" },
    previewedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: [
        "uploaded",
        "configured",
        "previewed",
        "active",
        "superseded",
        // A vendor reset archives every revision that an issued invoice still
        // references. Archived revisions keep their original PDF for audit and
        // are hidden from the active/editable configuration.
        "archived",
      ],
      default: "uploaded",
    },
    createdAt: { type: Date, default: Date.now },
    activatedAt: { type: Date, default: null },
    supersededAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
  },
  { _id: true },
);

const invoiceTemplateSchema = new mongoose.Schema(
  {
    shop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      unique: true,
    },
    currentVersionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    nextVersion: { type: Number, default: 1 },
    versions: { type: [templateVersionSchema], default: [] },
  },
  { timestamps: true },
);

export const InvoiceTemplate = mongoose.model(
  "InvoiceTemplate",
  invoiceTemplateSchema,
);
