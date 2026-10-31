import mongoose from "mongoose";
import { Order } from "../../models/Order.js";
import { Shop } from "../../models/Shop.js";
import { User } from "../../models/User.js";
import { Invoice } from "../../models/Invoice.js";
import { InvoiceTemplate } from "../../models/InvoiceTemplate.js";
import { toPaise } from "../money.js";
import { fileStatus, getFile, invoiceKey, putFile } from "./storage.js";
import { sha256 } from "./canonical.js";
import { validateMapping } from "./mapping.js";
import { resolveAmountWordsStyle } from "./template-text.js";
import { buildInvoiceData } from "./invoice-data.js";
import { generateInvoicePdf, RENDERER_VERSION } from "./invoice-generator.js";
import { attachOutput, buildSnapshot } from "./invoice-snapshot.js";
import { allocateInvoiceNumber } from "./invoice-number.js";

/** Eligibility from persisted order facts only. Never infers capture from status. */
export function evaluateEligibility(order) {
  if (!order) return { ok: false, reason: "not_found" };
  if (order.status !== "completed") return { ok: false, reason: "not_completed" };
  if (!order.collectedAt) return { ok: false, reason: "not_collected" };

  const charged = Number(order.amountChargedPaise);
  const hasPaymentEvidence =
    (Number.isFinite(charged) && charged > 0) || order.paymentNote === "mock";
  if (!hasPaymentEvidence) return { ok: false, reason: "payment_not_verified" };

  const payablePaise = toPaise(order.total);
  if (payablePaise === null || payablePaise <= 0) {
    return { ok: false, reason: "invalid_payable" };
  }

  return { ok: true, payablePaise };
}

/**
 * The single definition of a usable active template. A version counts only when
 * it is the current version, its status is active, its mapping passes
 * validation, and its original PDF is readable from the configured storage
 * backend. The vendor dashboard calls this same function, so an "Active" badge
 * can never disagree with what invoice issuance actually accepts.
 */
export async function resolveActiveTemplate(
  shopId,
  { verifyTemplateSha = false } = {},
) {
  const checks = {
    templateFound: false,
    shopMatches: false,
    currentVersionSet: false,
    versionFound: false,
    versionActive: false,
    mappingPresent: false,
    mappingValid: false,
    originalFilePresent: false,
    templateShaMatches: verifyTemplateSha ? false : null,
  };

  if (!shopId) {
    return { ok: false, reason: "no_active_template", checks, active: null };
  }

  const template = await InvoiceTemplate.findOne({ shop: shopId }).lean();
  checks.templateFound = Boolean(template);
  checks.shopMatches = Boolean(template) && String(template.shop) === String(shopId);
  if (!checks.templateFound || !checks.shopMatches) {
    return { ok: false, reason: "no_active_template", checks, active: null };
  }

  checks.currentVersionSet = Boolean(template.currentVersionId);
  const versions = template.versions || [];
  const version = checks.currentVersionSet
    ? versions.find(
        (entry) => String(entry._id) === String(template.currentVersionId),
      )
    : null;
  checks.versionFound = Boolean(version);
  if (!version) {
    // A template with no current version (never activated, or removed) has no
    // active template at all. A dangling currentVersionId is the anomaly worth
    // reporting separately.
    return {
      ok: false,
      reason: checks.currentVersionSet
        ? "current_version_missing"
        : "no_active_template",
      checks,
      active: null,
    };
  }

  checks.versionActive = version.status === "active";
  checks.mappingPresent = Boolean(version.mapping);
  if (checks.mappingPresent) {
    const page = Number.isInteger(Number(version.mapping.page))
      ? Number(version.mapping.page)
      : 0;
    checks.mappingValid = validateMapping(version.mapping, {
      pageSizes: version.pageSizes || [],
      page,
    }).ok;
  }

  if (version.originalFileKey) {
    const stored = await fileStatus(version.originalFileKey);
    checks.originalFilePresent = stored.exists && stored.size > 0;
  }
  if (verifyTemplateSha && checks.originalFilePresent && version.sha256) {
    try {
      const bytes = await getFile(version.originalFileKey);
      checks.templateShaMatches = sha256(bytes) === version.sha256;
    } catch {
      checks.templateShaMatches = false;
    }
  }

  const reason = !checks.versionActive
    ? "version_not_active"
    : !checks.mappingPresent
      ? "missing_mapping"
      : !checks.mappingValid
        ? "invalid_mapping"
        : !checks.originalFilePresent
          ? "template_file_missing"
          : null;

  if (reason) return { ok: false, reason, checks, active: null };

  const active = {
    templateId: String(template._id),
    ...version,
    versionId: String(version._id),
    pageSizes: version.pageSizes || [],
  };
  return { ok: true, reason: null, checks, active };
}

export async function findActiveVersion(shopId) {
  const resolved = await resolveActiveTemplate(shopId);
  return resolved.ok ? resolved.active : null;
}

export async function getInvoiceForOrder(orderId) {
  return Invoice.findOne({ order: orderId });
}

/**
 * Integrity check for an already-issued invoice. An existing Invoice record is
 * never reissued, renumbered or re-rendered: when its stored PDF is missing or
 * fails verification we report the failure and leave the record untouched.
 */
function verifyInvoiceBytes(bytes, invoice) {
  if (bytes.length !== Number(invoice.byteSize)) {
    return {
      ok: false,
      code: "size_mismatch",
      actualSize: bytes.length,
      expectedSize: invoice.byteSize,
    };
  }
  if (bytes.subarray(0, 5).toString() !== "%PDF-") {
    return { ok: false, code: "invalid_signature", actualSize: bytes.length };
  }
  const actualSha = sha256(bytes);
  if (actualSha !== invoice.outputSha256) {
    return {
      ok: false,
      code: "checksum_mismatch",
      actualSha,
      expectedSha: invoice.outputSha256,
    };
  }
  return { ok: true, bytes };
}

async function verifyIssuedInvoice(invoice) {
  if (!invoice?.storageKey) return { ok: false, code: "no_storage_key" };

  const stored = await fileStatus(invoice.storageKey);
  if (!stored.exists) {
    return { ok: false, code: "file_missing", errorCode: stored.errorCode };
  }

  let bytes;
  try {
    bytes = await getFile(invoice.storageKey);
  } catch (err) {
    return { ok: false, code: "read_failed", errorCode: err?.code || "UNKNOWN" };
  }

  return verifyInvoiceBytes(bytes, invoice);
}

/**
 * Idempotent invoice issuance. Safe to call on completion and on every
 * download; never creates a second invoice or number for one order.
 */
export async function ensureInvoiceForOrder(orderId) {
  if (!mongoose.isValidObjectId(orderId)) {
    return { ok: false, reason: "not_found" };
  }

  const existing = await Invoice.findOne({ order: orderId }).lean();
  if (existing) {
    const integrity = await verifyIssuedInvoice(existing);
    if (!integrity.ok) {
      return {
        ok: false,
        reason: "invoice_file_missing",
        invoice: existing,
        details: {
          ...integrity,
          invoiceId: String(existing._id),
          storageBackend: "filesystem",
        },
      };
    }
    return { ok: true, invoice: existing, bytes: integrity.bytes, existing: true };
  }

  const order = await Order.findById(orderId).lean();
  if (!order) return { ok: false, reason: "not_found" };

  const eligibility = evaluateEligibility(order);
  if (!eligibility.ok) return eligibility;

  const resolved = await resolveActiveTemplate(order.shop);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      details: { checks: resolved.checks, storageBackend: "filesystem" },
    };
  }
  const active = resolved.active;

  const [shop, customer] = await Promise.all([
    Shop.findById(order.shop).select("name slug").lean(),
    User.findById(order.customer).select("name phone email").lean(),
  ]);
  if (!shop || !customer) return { ok: false, reason: "missing_documents" };

  const number = await allocateInvoiceNumber({ shopId: order.shop, slug: shop.slug });

  let templateBytes;
  try {
    templateBytes = await getFile(active.originalFileKey);
  } catch {
    return { ok: false, reason: "template_file_missing" };
  }

  // Decided before the snapshot is built so the stored invoice data and the
  // rendered PDF always carry the same amount-in-words text. The template bytes
  // are read first because the decision comes from the printed suffix.
  const amountWordsStyle = await resolveAmountWordsStyle({
    mapping: active.mapping,
    templateBytes,
    pageIndex: active.mapping.page || 0,
  });

  let data;
  try {
    data = buildInvoiceData({
      order,
      shop,
      customer,
      mapping: active.mapping,
      invoiceNumber: number,
      mode: "final",
      rendererVersion: RENDERER_VERSION,
      templateVersionId: active.versionId,
      amountWordsStyle,
    });
  } catch (err) {
    return { ok: false, reason: err.reason || "invalid_data", error: err };
  }

  let rendered;
  try {
    rendered = await generateInvoicePdf({
      templateBytes,
      mapping: active.mapping,
      data,
    });
  } catch (err) {
    return { ok: false, reason: err.reason || "render_failed", error: err };
  }

  const outputSha = sha256(rendered.bytes);
  const invoiceId = new mongoose.Types.ObjectId();
  const storageKey = invoiceKey(order.shop, invoiceId, outputSha);

  const baseSnapshot = buildSnapshot({
    data,
    template: {
      versionId: active.versionId,
      version: active.version,
      sha256: active.sha256,
      mappingHash: active.mappingHash,
      page: active.mapping.page || 0,
    },
    renderer: { version: RENDERER_VERSION, fontSha256: {} },
    eligibility: {
      verificationSource: data.payment.verificationSource,
      checkedAt: new Date().toISOString(),
    },
  });
  const snapshot = attachOutput(baseSnapshot, {
    sha256: outputSha,
    byteSize: rendered.bytes.length,
    pageCount: rendered.pageCount,
  });

  try {
    await putFile(storageKey, rendered.bytes);
  } catch {
    return { ok: false, reason: "storage_failed" };
  }

  try {
    const invoice = await Invoice.create({
      _id: invoiceId,
      order: order._id,
      shop: order.shop,
      customer: order.customer,
      number,
      snapshot,
      templateVersionId: active.versionId,
      templateSha256: active.sha256,
      mappingHash: active.mappingHash,
      rendererVersion: RENDERER_VERSION,
      storageKey,
      outputSha256: outputSha,
      byteSize: rendered.bytes.length,
      pageCount: rendered.pageCount,
      issuedAt: new Date(),
    });
    return { ok: true, invoice, bytes: rendered.bytes, created: true };
  } catch (err) {
    if (err && err.code === 11000) {
      const won = await Invoice.findOne({ order: orderId }).lean();
      if (won) return { ok: true, invoice: won, existing: true };
      return { ok: false, reason: "duplicate_invoice" };
    }
    return { ok: false, reason: "persist_failed", error: err };
  }
}
