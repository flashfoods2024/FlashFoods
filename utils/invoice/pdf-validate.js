import { PDFDocument } from "pdf-lib";
import { sha256 } from "./canonical.js";

export const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;
export const MAX_TEMPLATE_PAGES = 10;
const MIN_PAGE_POINTS = 200;
const MAX_PAGE_POINTS = 2000;

export function hasPdfSignature(bytes) {
  if (!bytes || !bytes.length) return false;
  const head = Buffer.from(bytes.subarray(0, Math.min(1024, bytes.length))).toString(
    "latin1",
  );
  return head.includes("%PDF-");
}

/**
 * Server-side PDF template validation (extension, signature, parseability,
 * encryption, page geometry). Fails closed with a named reason.
 */
export async function validateTemplatePdf(bytes, { originalFileName = "" } = {}) {
  if (!bytes || !bytes.length) return { ok: false, reason: "empty_file" };

  if (originalFileName && !/\.pdf$/i.test(originalFileName)) {
    return { ok: false, reason: "bad_extension" };
  }

  if (bytes.length > MAX_TEMPLATE_BYTES) {
    return { ok: false, reason: "file_too_large" };
  }

  if (!hasPdfSignature(bytes)) {
    return { ok: false, reason: "not_a_pdf" };
  }

  let doc;
  try {
    doc = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
  } catch (err) {
    const message = String(err?.message || "").toLowerCase();
    return {
      ok: false,
      reason: message.includes("encrypt") ? "encrypted_pdf" : "invalid_pdf",
    };
  }

  const pages = doc.getPages();
  if (pages.length === 0) return { ok: false, reason: "invalid_pdf" };
  if (pages.length > MAX_TEMPLATE_PAGES) {
    return { ok: false, reason: "too_many_pages" };
  }

  const pageSizes = [];
  for (const page of pages) {
    const rotation = page.getRotation();
    if (rotation && Number(rotation.angle || 0) % 360 !== 0) {
      return { ok: false, reason: "rotated_page" };
    }

    const { width, height } = page.getSize();
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < MIN_PAGE_POINTS ||
      height < MIN_PAGE_POINTS ||
      width > MAX_PAGE_POINTS ||
      height > MAX_PAGE_POINTS
    ) {
      return { ok: false, reason: "unsupported_page_size" };
    }

    const mediaBox = page.getMediaBox();
    if (
      Math.abs(Number(mediaBox.x) || 0) > 0.001 ||
      Math.abs(Number(mediaBox.y) || 0) > 0.001
    ) {
      return { ok: false, reason: "unsupported_page_origin" };
    }

    pageSizes.push({ width, height });
  }

  // Some PDFs parse but cannot be saved by the library; detect that at upload
  // rather than after a customer has collected an order.
  try {
    await doc.save();
  } catch {
    return { ok: false, reason: "unsupported_pdf" };
  }

  return {
    ok: true,
    pageCount: pages.length,
    pageSizes,
    sha256: sha256(bytes),
  };
}
