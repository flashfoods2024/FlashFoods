/**
 * Preview transformer for staged import data.
 *
 * Converts raw parsed items into a preview-friendly structure that the
 * confirmation UI can render before DB writes.  Future OCR/PDF/AI parsers
 * will feed their output through this so the preview step stays uniform.
 *
 * Placeholder – passes items through with no transformation.
 */

/**
 * @param {Array} rawItems – Items extracted by a parser
 * @returns {Array} previewItems – Items enriched with preview metadata
 */
export function buildPreview(rawItems) {
  if (!Array.isArray(rawItems)) return [];

  return rawItems.map((item, index) => ({
    _tempIndex: index,
    name: String(item.name || "").trim(),
    description: String(item.description || "").trim(),
    price: Math.max(0, Number(item.price) || 0),
    available: item.available !== false,
    _confidence: item._confidence || null, // populated by OCR/AI in the future
    _warnings: item._warnings || [],
  }));
}
