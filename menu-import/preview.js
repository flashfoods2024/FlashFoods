/**
 * Preview transformer for staged import data.
 *
 * Converts raw parsed items into a preview-friendly structure that the
 * confirmation UI can render before DB writes.  Future OCR/PDF/AI parsers
 * will feed their output through this so the preview step stays uniform.
 */

const VALID_FOOD_TYPES = ["veg", "non-veg", "egg", "unknown"];

function normalizeFoodType(value) {
  const raw = String(value || "").trim().toLowerCase();
  return VALID_FOOD_TYPES.includes(raw) ? raw : "unknown";
}

function normalizeVariants(rawVariants) {
  if (!Array.isArray(rawVariants) || rawVariants.length === 0) {
    return [{ label: "Regular", price: 0 }];
  }

  return rawVariants
    .filter((v) => v && typeof v === "object")
    .map((v) => ({
      label: String(v.label || "Regular").trim() || "Regular",
      price: Math.max(0, Number(v.price) || 0),
    }));
}

/**
 * @param {Array} rawItems – Items extracted by a parser
 * @returns {Array} previewItems – Items enriched with preview metadata
 */
export function buildPreview(rawItems) {
  if (!Array.isArray(rawItems)) return [];

  return rawItems.map((item, index) => {
    const variants = normalizeVariants(item.variants);

    return {
      _tempIndex: index,
      name: String(item.name || "").trim(),
      description: String(item.description || "").trim(),
      category: String(item.category || "Uncategorized").trim(),
      foodType: normalizeFoodType(item.foodType),
      variants,
      price: variants[0]?.price || 0,
      available: item.available !== false,
      _confidence: item.confidence || null,
      _warnings: item._warnings || [],
    };
  });
}
