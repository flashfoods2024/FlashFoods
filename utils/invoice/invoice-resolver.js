import mongoose from "mongoose";
import { Order } from "../../models/Order.js";
import { Shop } from "../../models/Shop.js";
import { User } from "../../models/User.js";
import { Invoice } from "../../models/Invoice.js";
import { InvoiceTemplate } from "../../models/InvoiceTemplate.js";
import { toPaise } from "../money.js";
import { getFile, invoiceKey, putFile } from "./storage.js";
import { sha256 } from "./canonical.js";
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

export async function findActiveVersion(shopId) {
  const template = await InvoiceTemplate.findOne({ shop: shopId }).lean();
  if (!template || !template.currentVersionId) return null;
  const version = (template.versions || []).find(
    (entry) => String(entry._id) === String(template.currentVersionId),
  );
  if (!version || version.status !== "active" || !version.mapping) return null;
  return {
    templateId: String(template._id),
    ...version,
    versionId: String(version._id),
    pageSizes: version.pageSizes || [],
  };
}

export async function getInvoiceForOrder(orderId) {
  return Invoice.findOne({ order: orderId });
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
  if (existing) return { ok: true, invoice: existing, existing: true };

  const order = await Order.findById(orderId).lean();
  if (!order) return { ok: false, reason: "not_found" };

  const eligibility = evaluateEligibility(order);
  if (!eligibility.ok) return eligibility;

  const active = await findActiveVersion(order.shop);
  if (!active) return { ok: false, reason: "no_active_template" };

  const [shop, customer] = await Promise.all([
    Shop.findById(order.shop).select("name slug").lean(),
    User.findById(order.customer).select("name phone email").lean(),
  ]);
  if (!shop || !customer) return { ok: false, reason: "missing_documents" };

  const number = await allocateInvoiceNumber({ shopId: order.shop, slug: shop.slug });

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
    });
  } catch (err) {
    return { ok: false, reason: err.reason || "invalid_data", error: err };
  }

  let templateBytes;
  try {
    templateBytes = await getFile(active.originalFileKey);
  } catch {
    return { ok: false, reason: "template_file_missing" };
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
    return { ok: true, invoice, created: true };
  } catch (err) {
    if (err && err.code === 11000) {
      const won = await Invoice.findOne({ order: orderId }).lean();
      if (won) return { ok: true, invoice: won, existing: true };
      return { ok: false, reason: "duplicate_invoice" };
    }
    return { ok: false, reason: "persist_failed", error: err };
  }
}
