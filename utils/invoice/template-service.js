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
  previewDir,
  previewKey,
  sweepFiles,
  templateDir,
  templateKey,
} from "./storage.js";
import { buildSampleData } from "./invoice-data.js";
import { generateInvoicePdf } from "./invoice-generator.js";
import { resolveActiveTemplate } from "./invoice-resolver.js";
import { resolveAmountWordsStyle } from "./template-text.js";

export async function getTemplate(shopId) {
  return InvoiceTemplate.findOne({ shop: shopId });
}

/**
 * Revisions the vendor can see and act on. Archived revisions (kept only
 * because an issued invoice references them) are excluded everywhere: they are
 * neither offered in the editor nor selectable through `?version=`.
 */
export function visibleVersions(template) {
  return (template?.versions || []).filter(
    (version) => version.status !== "archived",
  );
}

export function getVersionById(template, versionId, { includeArchived = false } = {}) {
  if (!template) return null;
  const version = (template.versions || []).find(
    (entry) => String(entry._id) === String(versionId),
  ) || null;
  if (version && !includeArchived && version.status === "archived") return null;
  return version;
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

  // Only revisions the vendor can still see take part in deduplication. An
  // archived revision must never make a post-reset re-upload look like a no-op.
  const duplicate = visibleVersions(template).find(
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

  const amountWordsStyle = await resolveAmountWordsStyle({
    mapping: version.mapping,
    templateBytes: bytes,
    pageIndex: version.mapping.page || 0,
  });
  const data = buildSampleData({
    shop,
    mapping: version.mapping,
    amountWordsStyle,
  });
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

const RESET_STORAGE = { sweep: sweepFiles };

/**
 * Full reset of a shop's billing template configuration.
 *
 * The database transition runs first as one atomic single-document write, so a
 * template can never be left flagged active after the editable configuration
 * has been cleared. Storage cleanup runs afterwards against paths derived from
 * this shop's own template id; unreferenced revisions lose their PDFs, and
 * every revision an issued invoice points at is archived with its original PDF
 * kept intact.
 *
 * Historical data is never touched: Invoice records, generated invoice PDFs,
 * invoice numbers and InvoiceCounter are outside this operation entirely. A
 * repeated reset is a no-op (or only retries leftover file cleanup).
 *
 * @param {object} options
 * @param {string|import("mongoose").Types.ObjectId} options.shopId
 * @param {{ sweep: Function }} [options.storage] injection seam for cleanup tests
 */
export async function resetTemplate({ shopId, storage = RESET_STORAGE } = {}) {
  if (!shopId) return { ok: false, reason: "shop_required" };

  const template = await InvoiceTemplate.findOne({ shop: shopId });
  if (!template) {
    return {
      ok: true,
      reset: false,
      archivedVersions: 0,
      removedVersions: 0,
      preservedFiles: 0,
      deletedFiles: 0,
      cleanupErrors: [],
    };
  }

  const templateId = String(template._id);
  const allVersions = template.versions || [];
  const allVersionIds = allVersions.map((version) => String(version._id));

  // Issued invoices are the only authority on which revisions must survive.
  // The query is shop-scoped, so another shop's invoice can never pin ours.
  const referencedIds = allVersionIds.length
    ? await Invoice.distinct("templateVersionId", {
        shop: shopId,
        templateVersionId: { $in: allVersionIds },
      })
    : [];
  const referenced = new Set(referencedIds.map(String));

  const archived = [];
  const removable = [];
  for (const version of allVersions) {
    if (referenced.has(String(version._id))) archived.push(version);
    else removable.push(version);
  }

  // Original PDFs still needed by a historical invoice.
  const preservedKeys = archived
    .map((version) => String(version.originalFileKey || ""))
    .filter(Boolean);

  const now = new Date();
  try {
    // One atomic single-document write. Activation is cleared and the editable
    // configuration is dropped in the same update, so no partial state can ever
    // show a template as active after its storage was cleaned up. The record
    // stays (even with an empty version list) until cleanup has been attempted,
    // which is what makes a failed cleanup retryable.
    template.versions = archived.map((version) => ({
      _id: version._id,
      version: version.version,
      originalFileKey: version.originalFileKey,
      originalFileName: version.originalFileName,
      byteSize: version.byteSize,
      sha256: version.sha256,
      pageCount: version.pageCount,
      pageSizes: version.pageSizes || [],
      // Editable configuration is cleared; the immutable original PDF and its
      // provenance stay for audit.
      mapping: null,
      mappingHash: "",
      previewMappingHash: "",
      previewedAt: null,
      status: "archived",
      createdAt: version.createdAt,
      activatedAt: null,
      supersededAt: version.supersededAt || now,
      archivedAt: now,
    }));
    template.currentVersionId = null;
    await template.save();
  } catch (err) {
    // No files were deleted yet and the single-document write did not apply,
    // so the template is still usable exactly as before the request.
    return {
      ok: false,
      reason: "reset_failed",
      storageCode: err?.code || "UNKNOWN",
    };
  }

  let deletedFiles = 0;
  const cleanupErrors = [];
  const sweeps = [
    { prefix: templateDir(shopId, templateId), keep: preservedKeys },
    { prefix: previewDir(shopId, templateId), keep: [] },
  ];
  for (const { prefix, keep } of sweeps) {
    try {
      const result = await storage.sweep(prefix, { keep });
      deletedFiles += result.removed.length;
      cleanupErrors.push(...(result.errorCodes || []));
    } catch (err) {
      cleanupErrors.push(err?.code || "UNKNOWN");
    }
  }

  // Nothing is archived, so the record itself is obsolete. It is removed last,
  // and only when cleanup succeeded: if a sweep failed above, keeping the
  // (already inactive, mapping-free) record lets a repeated reset find this
  // shop's directories again and finish the job rather than orphaning files.
  if (!archived.length && cleanupErrors.length === 0) {
    try {
      await InvoiceTemplate.deleteOne({ _id: template._id, shop: shopId });
    } catch (err) {
      cleanupErrors.push(err?.code || "UNKNOWN");
    }
  }

  return {
    ok: true,
    reset: true,
    archivedVersions: archived.length,
    removedVersions: removable.length,
    preservedFiles: preservedKeys.length,
    deletedFiles,
    cleanupErrors,
  };
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
  const versions = visibleVersions(template);
  if (!versions.length) return null;
  return versions[versions.length - 1];
}

/**
 * Compact state for the Vendor → Manage Menu billing card.
 *
 * "active" is reported only when the resolver would actually accept the
 * template (current version, active status, valid mapping, readable original
 * PDF). A version that is flagged active but unusable is reported as
 * "unusable" with the exact reason, so the dashboard never promises invoicing
 * that the resolver will refuse.
 */
export async function getBillingCardState(shopId) {
  const template = await InvoiceTemplate.findOne({ shop: shopId }).lean();
  const issuedCount = await issuedInvoiceCount(shopId);
  const versions = visibleVersions(template);
  // Archived-only (or absent) history is a clean "no template" state: the
  // vendor must upload and configure a PDF from zero after a reset.
  if (!versions.length) return { state: "none", issuedCount };

  const latest = versions[versions.length - 1];
  const resolution = await resolveActiveTemplate(shopId);
  const activeEntry = template?.currentVersionId
    ? versions.find((entry) => String(entry._id) === String(template.currentVersionId))
    : null;

  if (resolution.ok) {
    return {
      state: "active",
      issuedCount,
      versionId: String(latest._id),
      version: latest.version,
      pageCount: latest.pageCount,
      hasMapping: Boolean(latest.mapping),
      activeVersionId: resolution.active.versionId,
      activeVersion: resolution.active.version,
      issue: null,
    };
  }

  return {
    state: activeEntry ? "unusable" : latest.mapping ? "configured" : "uploaded",
    issuedCount,
    versionId: String(latest._id),
    version: latest.version,
    pageCount: latest.pageCount,
    hasMapping: Boolean(latest.mapping),
    activeVersionId: activeEntry ? String(activeEntry._id) : null,
    activeVersion: activeEntry ? activeEntry.version : null,
    issue: activeEntry ? resolution.reason : null,
  };
}
