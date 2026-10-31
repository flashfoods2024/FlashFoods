import express from "express";
import mongoose from "mongoose";
import { Shop } from "../models/Shop.js";
import { Order } from "../models/Order.js";
import { Invoice } from "../models/Invoice.js";
import { requireDb } from "../middleware/requireDb.js";
import {
  requireAuth,
  requireVendor,
  requireVendorShop,
} from "../middleware/auth.js";
import { handleBillingTemplateUpload } from "../middleware/billingUpload.js";
import { FIELD_LABELS } from "../utils/invoice/mapping.js";
import {
  activateVersion,
  createTemplateVersion,
  getActiveVersion,
  getTemplate,
  getVersionById,
  latestVersion,
  removeTemplate,
  renderSampleInvoice,
  resetTemplate,
  saveMapping,
} from "../utils/invoice/template-service.js";
import { getFile } from "../utils/invoice/storage.js";
import {
  ensureInvoiceForOrder,
  getInvoiceForOrder,
  resolveActiveTemplate,
} from "../utils/invoice/invoice-resolver.js";

export const billingRouter = express.Router();

const VENDOR_CHAIN = [requireDb, requireAuth, requireVendor, requireVendorShop];

const REASON_MESSAGES = {
  empty_file: "Choose a PDF file to upload.",
  bad_extension: "Only PDF files are supported.",
  bad_mime: "Only PDF files are supported.",
  not_a_pdf: "This file is not a valid PDF.",
  invalid_pdf: "This PDF could not be read. Re-export it and try again.",
  encrypted_pdf:
    "Password-protected PDFs are not supported. Upload an unprotected PDF.",
  unsupported_pdf:
    "This PDF uses features we cannot process. Re-export it and try again.",
  file_too_large: "PDF must be 10 MB or smaller.",
  too_many_pages: "This PDF has too many pages (maximum 10).",
  rotated_page:
    "Rotated pages are not supported. Re-export the PDF in normal orientation.",
  unsupported_page_size: "A page is too small or too large to place fields on.",
  unsupported_page_origin:
    "This PDF has an unsupported page origin. Re-export it and try again.",
  template_not_found: "Upload an invoice PDF first.",
  version_not_found: "That template version no longer exists.",
  mapping_frozen:
    "This template is active. Upload a replacement PDF to change positions.",
  missing_mapping: "Place all required fields before continuing.",
  preview_required: "Generate a sample invoice before activating.",
  invalid_mapping: "The field configuration was invalid.",
  invalid_page: "Select a valid page for the invoice fields.",
  missing_item_table: "Place the item table before saving.",
  invalid_columns: "The item table columns are invalid.",
  invalid_tax_config: "Tax settings are invalid.",
  storage_failed: "Could not store the PDF. Try again.",
  render_failed: "The invoice could not be rendered.",
  text_overflow: "A value is too long for its field. Increase its width or lines.",
  layout_overflow:
    "This order has more items than the template fits. Configure continuation totals or a larger item table.",
  font_asset_missing: "Invoice fonts are unavailable. Contact support.",
  template_file_missing: "The stored template file is missing. Upload it again.",
  no_active_template: "No active billing template for this canteen.",
  reset_failed: "The billing template could not be reset. Try again.",
  shop_required: "No shop is linked to this vendor account.",
  not_completed: "The invoice is issued after the order is collected.",
  not_collected: "The invoice is issued after the order is collected.",
  payment_not_verified: "This order has no verified payment, so no invoice is issued.",
  invalid_payable: "This order has no chargeable amount.",
  totals_mismatch: "Order totals do not reconcile. Please contact support.",
  no_billable_items: "This order has no billable items.",
  invalid_order_item: "The order contains an invalid item.",
  tax_reconciliation_failed: "Tax breakdown does not reconcile with the total.",
};

/**
 * Turn an overflow into an actionable, field-named message. The renderer reports
 * which field did not fit and its real font measurements, so a vendor is never
 * left guessing which of the configured positions is wrong.
 */
function overflowMessage(details) {
  const key = details?.field || details?.column;
  if (!key || !Number.isFinite(details?.requiredLines)) {
    return REASON_MESSAGES.text_overflow;
  }
  const label = FIELD_LABELS[key] || key;
  const scope = details.column ? `${label} column` : label;
  const lines = details.requiredLines;
  const configured = details.maxLines;
  const lineWord = configured === 1 ? "line is" : "lines are";
  const base = `${scope}: this value needs ${lines} lines at ${details.fontSize} pt, but only ${configured} ${lineWord} configured.`;
  if (
    Number.isFinite(details.longestWordWidth) &&
    details.longestWordWidth > details.maxWidth
  ) {
    return `${base} Its longest word alone is ${details.longestWordWidth} pt wide, but Max width is ${details.maxWidth} pt — increase Max width.`;
  }
  return `${base} Increase Max lines or Max width.`;
}

function reasonMessage(reason, details) {
  if (reason === "text_overflow" && details) return overflowMessage(details);
  return (
    REASON_MESSAGES[reason] ||
    (String(reason || "").startsWith("invalid_field:")
      ? "A field position is invalid. Re-place it."
      : String(reason || "").startsWith("missing_field:")
        ? "Map all required fields before activating."
        : String(reason || "").startsWith("missing_column:")
          ? "The item table is missing a required column."
          : "Billing template request failed.")
  );
}

function wantsJson(req) {
  return req.accepts(["json", "html"]) === "json";
}

function sendResult(req, res, result, { okMessage, redirectPath }) {
  if (wantsJson(req)) {
    return res.status(result.ok ? 200 : 400).json({
      ok: Boolean(result.ok),
      reason: result.reason || "",
      error: result.ok ? undefined : reasonMessage(result.reason, result.details),
      ...(result.details ? { details: result.details } : {}),
      ...(result.mappingHash ? { mappingHash: result.mappingHash } : {}),
      ...(result.pageCount ? { pageCount: result.pageCount } : {}),
    });
  }
  if (!result.ok) req.flash("error", reasonMessage(result.reason, result.details));
  else if (okMessage) req.flash("success", okMessage);
  return res.redirect(redirectPath);
}

function streamPdf(res, bytes, filename) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Length", bytes.length);
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.send(bytes);
}

function selectedVersion(req, template) {
  if (!template) return null;
  const requested = req.query?.version || req.body?.versionId;
  if (requested) return getVersionById(template, requested);
  return getActiveVersion(template) || latestVersion(template);
}

// ---------------------------------------------------------------------------
// Vendor billing template pages
// ---------------------------------------------------------------------------

billingRouter.get("/vendor/menu/billing-template", ...VENDOR_CHAIN, async (req, res) => {
  const shop = await Shop.findById(req.vendorShopId).select("name slug").lean();
  if (!shop) {
    req.flash("error", "Shop not found.");
    return res.redirect("/vendor/menu");
  }

  const template = await getTemplate(req.vendorShopId);
  const version = selectedVersion(req, template);

  // The badge and the resolver must agree: a version flagged active whose
  // mapping or stored PDF is unusable is reported as unusable, never Active.
  const resolution = template
    ? await resolveActiveTemplate(req.vendorShopId)
    : { ok: false, reason: "no_active_template" };

  const config = {
    versionId: version ? String(version._id) : "",
    version: version ? version.version : null,
    pageSizes: version ? version.pageSizes : [],
    mapping: version ? version.mapping : null,
    status: version ? version.status : "none",
    mappingFrozen: Boolean(version && version.status === "active"),
    activeUsable: resolution.ok,
    activeIssue: resolution.ok ? null : resolution.reason,
    previewReady: Boolean(
      version && version.mappingHash && version.previewMappingHash === version.mappingHash,
    ),
    fileUrl: version
      ? `/vendor/menu/billing-template/file?version=${version._id}`
      : "",
    saveUrl: "/vendor/menu/billing-template/mapping",
    previewUrl: "/vendor/menu/billing-template/preview",
    sampleUrl: version
      ? `/vendor/menu/billing-template/sample.pdf?version=${version._id}`
      : "",
    activateUrl: "/vendor/menu/billing-template/activate",
    uploadUrl: "/vendor/menu/billing-template/upload",
  };

  // Archived revisions are kept only for audit; they are not part of the
  // editable configuration after a reset.
  const versions = (template?.versions || [])
    .filter((entry) => entry.status !== "archived")
    .map((entry) => ({
    id: String(entry._id),
    version: entry.version,
    status: entry.status,
    pageCount: entry.pageCount,
    hasMapping: Boolean(entry.mapping),
    createdAt: entry.createdAt,
  }));

  return res.render("vendor/billing-template", {
    pageTitle: "Billing Template",
    shop,
    config,
    versions,
    activeVersionId: template?.currentVersionId ? String(template.currentVersionId) : null,
  });
});

billingRouter.post(
  "/vendor/menu/billing-template/upload",
  ...VENDOR_CHAIN,
  handleBillingTemplateUpload,
  async (req, res) => {
    if (!req.file || !req.file.buffer) {
      return sendResult(req, res, { ok: false, reason: "empty_file" }, {
        redirectPath: "/vendor/menu",
      });
    }

    const result = await createTemplateVersion({
      shopId: req.vendorShopId,
      bytes: req.file.buffer,
      originalFileName: req.file.originalname,
    });

    if (!result.ok) {
      return sendResult(req, res, result, { redirectPath: "/vendor/menu" });
    }

    const message = result.duplicate
      ? "That PDF is already uploaded. Open template settings to configure it."
      : "Invoice PDF uploaded. Configure the field positions next.";
    return sendResult(
      req,
      res,
      { ok: true, pageCount: result.version.pageCount },
      { okMessage: message, redirectPath: "/vendor/menu" },
    );
  },
);

billingRouter.get(
  "/vendor/menu/billing-template/file",
  ...VENDOR_CHAIN,
  async (req, res) => {
    const template = await getTemplate(req.vendorShopId);
    const version = selectedVersion(req, template);
    if (!version) {
      req.flash("error", "Upload an invoice PDF first.");
      return res.redirect("/vendor/menu");
    }
    try {
      const bytes = await getFile(version.originalFileKey);
      return streamPdf(res, bytes, `billing-template-v${version.version}.pdf`);
    } catch {
      req.flash("error", reasonMessage("template_file_missing"));
      return res.redirect("/vendor/menu");
    }
  },
);

billingRouter.post(
  "/vendor/menu/billing-template/mapping",
  ...VENDOR_CHAIN,
  async (req, res) => {
    const template = await getTemplate(req.vendorShopId);
    const version = selectedVersion(req, template);
    if (!version) {
      return sendResult(req, res, { ok: false, reason: "template_not_found" }, {
        redirectPath: "/vendor/menu",
      });
    }

    let rawMapping = req.body?.mapping;
    if (typeof rawMapping === "string") {
      try {
        rawMapping = JSON.parse(rawMapping);
      } catch {
        return sendResult(req, res, { ok: false, reason: "invalid_mapping" }, {
          redirectPath: "/vendor/menu/billing-template",
        });
      }
    }
    if (!rawMapping) {
      return sendResult(req, res, { ok: false, reason: "invalid_mapping" }, {
        redirectPath: "/vendor/menu/billing-template",
      });
    }

    const result = await saveMapping({
      shopId: req.vendorShopId,
      versionId: version._id,
      rawMapping,
    });

    return sendResult(req, res, result, {
      okMessage: "Field positions saved.",
      redirectPath: "/vendor/menu/billing-template",
    });
  },
);

billingRouter.post(
  "/vendor/menu/billing-template/preview",
  ...VENDOR_CHAIN,
  async (req, res) => {
    const shop = await Shop.findById(req.vendorShopId).select("name slug").lean();
    const template = await getTemplate(req.vendorShopId);
    const version = selectedVersion(req, template);
    if (!version) {
      return sendResult(req, res, { ok: false, reason: "template_not_found" }, {
        redirectPath: "/vendor/menu",
      });
    }

    const result = await renderSampleInvoice({
      shopId: req.vendorShopId,
      versionId: version._id,
      shop,
    });

    if (!result.ok) {
      return sendResult(req, res, result, {
        redirectPath: "/vendor/menu/billing-template",
      });
    }

    if (wantsJson(req)) {
      return res.json({
        ok: true,
        sampleUrl: `/vendor/menu/billing-template/sample.pdf?version=${version._id}`,
        pageCount: result.pageCount,
      });
    }
    req.flash("success", "Sample invoice generated.");
    return res.redirect("/vendor/menu/billing-template");
  },
);

billingRouter.get(
  "/vendor/menu/billing-template/sample.pdf",
  ...VENDOR_CHAIN,
  async (req, res) => {
    const shop = await Shop.findById(req.vendorShopId).select("name slug").lean();
    const template = await getTemplate(req.vendorShopId);
    const version = selectedVersion(req, template);
    if (!version) {
      req.flash("error", reasonMessage("template_not_found"));
      return res.redirect("/vendor/menu");
    }
    const result = await renderSampleInvoice({
      shopId: req.vendorShopId,
      versionId: version._id,
      shop,
    });
    if (!result.ok) {
      req.flash("error", reasonMessage(result.reason, result.details));
      return res.redirect("/vendor/menu/billing-template");
    }
    return streamPdf(res, result.bytes, "sample-invoice.pdf");
  },
);

billingRouter.post(
  "/vendor/menu/billing-template/activate",
  ...VENDOR_CHAIN,
  async (req, res) => {
    const template = await getTemplate(req.vendorShopId);
    const version = selectedVersion(req, template);
    if (!version) {
      return sendResult(req, res, { ok: false, reason: "template_not_found" }, {
        redirectPath: "/vendor/menu",
      });
    }
    const result = await activateVersion({
      shopId: req.vendorShopId,
      versionId: version._id,
    });
    return sendResult(req, res, result, {
      okMessage: "Billing template activated. Invoices will use your design.",
      redirectPath: "/vendor/menu/billing-template",
    });
  },
);

billingRouter.post(
  "/vendor/menu/billing-template/remove",
  ...VENDOR_CHAIN,
  async (req, res) => {
    const result = await removeTemplate(req.vendorShopId);
    return sendResult(req, res, result, {
      okMessage:
        "Billing template removed. Students see the default order bill; issued invoices remain available.",
      redirectPath: "/vendor/menu",
    });
  },
);

/**
 * Destructive, shop-scoped reset of the whole billing-template configuration.
 *
 * The shop is taken exclusively from the session (`req.vendorShopId`); no shop
 * id is read from the body, so one vendor can never reset another's templates.
 * Issued invoices, their generated PDFs, their numbers and the invoice counter
 * are outside this operation. Storage paths are never echoed to the client.
 */
billingRouter.post(
  "/vendor/menu/billing-template/reset",
  ...VENDOR_CHAIN,
  async (req, res) => {
    let result;
    try {
      result = await resetTemplate({ shopId: req.vendorShopId });
    } catch (err) {
      console.error("[billing] template reset failed:", err?.message);
      result = { ok: false, reason: "reset_failed" };
    }

    if (!result.ok) {
      return sendResult(req, res, result, { redirectPath: "/vendor/menu" });
    }

    if (result.cleanupErrors?.length) {
      // The database state is already clean; these files were simply no longer
      // referenced and could not be removed. A repeat reset retries cleanup.
      console.warn(
        `[billing] template reset cleanup incomplete shop=${req.vendorShopIdStr} codes=${result.cleanupErrors.join(",")}`,
      );
    }
    if (result.reset) {
      console.info(
        `[billing] template reset shop=${req.vendorShopIdStr} archived=${result.archivedVersions} removed=${result.removedVersions} preservedFiles=${result.preservedFiles} deletedFiles=${result.deletedFiles}`,
      );
    }

    return sendResult(
      req,
      res,
      {
        ok: true,
        details: {
          reset: Boolean(result.reset),
          archivedVersions: result.archivedVersions,
          removedVersions: result.removedVersions,
          deletedFiles: result.deletedFiles,
        },
      },
      {
        okMessage: "Billing template reset successfully. Upload a new PDF to begin.",
        redirectPath: "/vendor/menu",
      },
    );
  },
);

// ---------------------------------------------------------------------------
// Vendor view of an issued invoice (shop-scoped)
// ---------------------------------------------------------------------------

billingRouter.get(
  "/vendor/orders/:id/invoice",
  ...VENDOR_CHAIN,
  async (req, res) => {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      req.flash("error", "Order not found.");
      return res.redirect("/vendor/orders/pending");
    }

    const order = await Order.findOne({ _id: id, shop: req.vendorShopId })
      .select("_id")
      .lean();
    if (!order) {
      req.flash("error", "Order not found.");
      return res.redirect("/vendor/orders/pending");
    }

    const result = await ensureInvoiceForOrder(order._id);
    if (!result.ok) {
      req.flash("error", reasonMessage(result.reason, result.details));
      return res.redirect(`/vendor/orders/${order._id}`);
    }

    let bytes;
    const invoice =
      result.invoice?.storageKey !== undefined
        ? result.invoice
        : await getInvoiceForOrder(order._id);
    const storageKey = invoice?.storageKey || result.invoice?.storageKey;
    try {
      bytes = await getFile(storageKey);
    } catch {
      req.flash("error", "The invoice file could not be read.");
      return res.redirect(`/vendor/orders/${order._id}`);
    }
    return streamPdf(res, bytes, `invoice-${invoice.number || "order"}.pdf`);
  },
);
