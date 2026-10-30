import { InvoiceCounter } from "../../models/InvoiceCounter.js";

/**
 * Invoice number format. DECISION-1 (statutory format) is unresolved; this
 * placeholder format is documented in billing-template/00_PRODUCT_CONTRACT.md.
 */
export function formatInvoiceNumber({ slug = "shop", seq = 1 }) {
  const safeSlug = String(slug || "shop")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "shop";
  return `INV-${safeSlug}-${String(seq).padStart(6, "0")}`;
}

/** Atomic, shop-scoped allocation. Never derive numbers from counts. */
export async function allocateInvoiceNumber({ shopId, slug }) {
  const counter = await InvoiceCounter.findOneAndUpdate(
    { shop: shopId },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  if (!counter) throw new Error("Invoice counter allocation failed.");
  return formatInvoiceNumber({ slug, seq: counter.seq });
}
