import { InvoiceTemplate } from "../../models/InvoiceTemplate.js";
import { Invoice } from "../../models/Invoice.js";
import { validateTemplatePdf } from "./pdf-validate.js";
import {
  validateMapping,
  mappingHash,
} from "./mapping.js";
import {
  getFile,
  putFile,
  previewKey,
  templateKey,
} from "./storage.js";
import { buildSampleData } from "./invoice-data.js";
import { generateInvoicePdf } from "./invoice-generator.js";

export async function getTemplate(shopId) {
  return InvoiceTemplate.findOne({ shop: shopId });
}

export function getVersionById(template, versionId) {
  if (!template) return null;
  return (template.versions || []).find(
    (version) => String(version._id) === String(versionId),
  ) || null;
}

export function getActiveVersion(template) {
  if (!template || !template.currentVersionId) return null;
  const version = getVersionById(template, template.currentVersionId);
  if (!version || version.status !== "active" || !version.mapping) return null;
  return version;
}

export async function issuedInvoiceCount(shopId) {
  return Invoice.countDocuments({ shop: shopId });
}

/**
 * Validate bytes and create a new immutable template version. A duplicate file
 * for the same shop reuses the existing version instead of storing twice.
 */
export async function createTemplateVersion({ shopId, bytes, originalFileName }) {
  const validation = await validateTemplatePdf(bytes, { originalFileName });
  if (!validation.ok) return validation;

  let template = await InvoiceTemplate.findOne({ shop: shopId });
  if (!template) {
    template = await InvoiceTemplate.create({ shop: shopId, versions: [] });
  }

  const duplicate = (template.versions || []).find(
    (version) => version.sha256 === validation.sha256,
  );
  if (duplicate) {
    return {
      ok: true,
      duplicate: true,
      template,
      version: duplicate,
      reason: "duplicate_file",
    };
  }

  const versionNumber = template.nextVersion || 1;
  const key = templateKey(shopId, template._id, versionNumber, validation.sha256);
  await putFile(key, bytes);

  template.versions.push({
    version: versionNumber,
    originalFileKey: key,
    originalFileName: String(originalFileName || "template.pdf").slice(0, 200),
    byteSize: bytes.length,
    sha256: validation.sha256,
    pageCount: validation.pageCount,
    pageSizes: validation.pageSizes,
    mapping: null,
    mappingHash: "",
    status: "uploaded",
  });
  template.nextVersion = versionNumber + 1;
  await template.save();

  const version = template.versions[template.versions.length - 1];
  return { ok: true, template, version, duplicate: false };
}

export async function saveMapping({ shopId, versionId, rawMapping }) {
  const template = await InvoiceTemplate.findOne({ shop: shopId });
  if (!template) return { ok: false, reason: "template_not_found" };

  const version = getVersionById(template, versionId);
  if (!version) return { ok: false, reason: "version_not_found" };
  if (version.status === "active") return { ok: false, reason: "mapping_frozen" };

  const page = Number.isInteger(Number(rawMapping?.page))
    ? Number(rawMapping.page)
    : 0;
  const validation = validateMapping(rawMapping, {
    pageSizes: version.pageSizes,
    page,
  });
  if (!validation.ok) return validation;

  const nextHash = mappingHash(validation.mapping);
  const changed = version.mappingHash !== nextHash;

  version.mapping = validation.mapping;
  version.mappingHash = nextHash;
  // A re-save of identical positions must not invalidate an already generated
  // sample: the activation flow saves before activating, and clearing the
  // preview there made activation impossible without a redundant second pass.
  if (changed) {
    version.previewMappingHash = "";
    version.previewedAt = null;
    version.status = "configured";
  } else if (version.status === "uploaded") {
    version.status = "configured";
  }
  await template.save();

  return {
    ok: true,
    mapping: validation.mapping,
    mappingHash: version.mappingHash,
    versionId: String(version._id),
  };
}

export async function renderSampleInvoice({ shopId, versionId, shop }) {
  const template = await InvoiceTemplate.findOne({ shop: shopId });
  if (!template) return { ok: false, reason: "template_not_found" };

  const version = getVersionById(template, versionId);
  if (!version) return { ok: false, reason: "version_not_found" };
  if (!version.mapping) return { ok: false, reason: "missing_mapping" };

  let bytes;
  try {
    bytes = await getFile(version.originalFileKey);
  } catch {
    return { ok: false, reason: "template_file_missing" };
  }

  const data = buildSampleData({ shop, mapping: version.mapping });
  let rendered;
  try {
    rendered = await generateInvoicePdf({
      templateBytes: bytes,
      mapping: version.mapping,
      data,
    });
  } catch (err) {
    // Keep the renderer's measurements (field, width, required lines) so the
    // route can report the exact field that did not fit.
    if (process.env.NODE_ENV !== "production" && err.details) {
      console.warn(
        "[billing] sample render failed:",
        err.reason,
        JSON.stringify(err.details),
      );
    }
    return {
      ok: false,
      reason: err.reason || "render_failed",
      details: err.details || null,
      error: err,
    };
  }

  const key = previewKey(shopId, template._id, version.version, version.mappingHash);
  try {
    await putFile(key, rendered.bytes);
  } catch {
    return { ok: false, reason: "storage_failed" };
  }

  version.previewMappingHash = version.mappingHash;
  version.previewedAt = new Date();
  if (version.status === "configured") version.status = "previewed";
  await template.save();

  return { ok: true, bytes: rendered.bytes, storageKey: key, pageCount: rendered.pageCount };
}

export async function activateVersion({ shopId, versionId }) {
  const template = await InvoiceTemplate.findOne({ shop: shopId });
  if (!template) return { ok: false, reason: "template_not_found" };

  const version = getVersionById(template, versionId);
  if (!version) return { ok: false, reason: "version_not_found" };
  if (!version.mapping) return { ok: false, reason: "missing_mapping" };
  if (!version.previewMappingHash || version.previewMappingHash !== version.mappingHash) {
    return { ok: false, reason: "preview_required" };
  }

  for (const entry of template.versions) {
    if (entry.status === "active" && String(entry._id) !== String(version._id)) {
      entry.status = "superseded";
      entry.supersededAt = new Date();
    }
  }

  version.status = "active";
  version.activatedAt = new Date();
  template.currentVersionId = version._id;
  await template.save();

  return { ok: true, versionId: String(version._id) };
}

export async function removeTemplate(shopId) {
  const template = await InvoiceTemplate.findOne({ shop: shopId });
  if (!template) return { ok: false, reason: "template_not_found" };

  const active = getVersionById(template, template.currentVersionId);
  if (active) {
    active.status = "superseded";
    active.supersededAt = new Date();
  }
  template.currentVersionId = null;
  await template.save();
  return { ok: true };
}

// Synchronous on purpose: callers select a version and use its _id inline.
export function latestVersion(template) {
  if (!template || !(template.versions || []).length) return null;
  return template.versions[template.versions.length - 1];
}

/** Compact state for the Vendor → Manage Menu billing card. */
export async function getBillingCardState(shopId) {
  const template = await InvoiceTemplate.findOne({ shop: shopId }).lean();
  const issuedCount = await issuedInvoiceCount(shopId);
  const versions = template?.versions || [];
  if (!versions.length) return { state: "none", issuedCount };

  const latest = versions[versions.length - 1];
  const active = template.currentVersionId
    ? versions.find((entry) => String(entry._id) === String(template.currentVersionId))
    : null;

  return {
    state: active ? "active" : latest.mapping ? "configured" : "uploaded",
    issuedCount,
    versionId: String(latest._id),
    version: latest.version,
    pageCount: latest.pageCount,
    hasMapping: Boolean(latest.mapping),
    activeVersionId: active ? String(active._id) : null,
    activeVersion: active ? active.version : null,
  };
}
