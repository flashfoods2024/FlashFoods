import { canonicalJson, hashJson } from "./canonical.js";
import { AMOUNT_WORDS_STYLES } from "./format.js";

export const MAPPING_SCHEMA_VERSION = 1;
export const ALIGNMENTS = ["left", "center", "right"];
export const FONT_ALIASES = ["regular", "medium", "bold"];

// Fields a template must map before activation.
export const REQUIRED_FIELDS = [
  "invoiceNumber",
  "invoiceDate",
  "customerName",
  "subtotal",
  "total",
  "amountInWords",
];

export const OPTIONAL_FIELDS = [
  "customerPhone",
  "customerEmail",
  "orderRef",
  "orderType",
  "pickupTime",
  "discount",
  "parcelCharge",
  "cgst",
  "sgst",
  "paymentReference",
  "sellerNote",
  "termsText",
  "sampleWatermark",
];

export const ALL_FIELDS = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];

// Human labels used by validation messages and the vendor editor.
export const FIELD_LABELS = {
  invoiceNumber: "Invoice number",
  invoiceDate: "Invoice date",
  customerName: "Customer name",
  customerPhone: "Customer phone",
  customerEmail: "Customer email",
  orderRef: "Order reference",
  orderType: "Order type",
  pickupTime: "Pickup time",
  subtotal: "Subtotal",
  discount: "Discount",
  parcelCharge: "Parcel charge",
  cgst: "CGST",
  sgst: "SGST",
  total: "Final total",
  amountInWords: "Amount in words",
  paymentReference: "Payment reference",
  sellerNote: "Seller note",
  termsText: "Terms",
  sampleWatermark: "Sample watermark",
  description: "Item description",
  quantity: "Quantity",
  unitRate: "Unit rate",
  lineAmount: "Line amount",
  serial: "Serial number",
  foodType: "Food type",
};

const PAGE_MARGIN = 24;

/**
 * Horizontal space a field may actually use, in the direction its text grows
 * from the anchor. A right-aligned value grows leftwards, a left-aligned value
 * rightwards, and a centred value both ways. No box can leave the page, so a
 * configured width is always bounded by this room.
 */
export function availableRoom(align, x, pageWidth) {
  const leftRoom = Math.max(10, x - PAGE_MARGIN);
  const rightRoom = Math.max(10, pageWidth - x - PAGE_MARGIN);
  if (align === "right") return leftRoom;
  if (align === "center") return Math.max(10, Math.min(leftRoom, rightRoom) * 2);
  return rightRoom;
}

const REQUIRED_COLUMNS = ["description", "quantity", "unitRate", "lineAmount"];
const OPTIONAL_COLUMNS = ["serial", "foodType"];

/** How many text lines of `fontSize` fit inside one item row. */
export function rowLineCapacity(rowHeight, fontSize) {
  const lineHeight = Math.max(1, Number(fontSize) * 1.2);
  return Math.max(1, Math.floor((Number(rowHeight) + 0.001) / lineHeight));
}

function round3(value) {
  return Number(Number(value).toFixed(3));
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeAlign(value) {
  return ALIGNMENTS.includes(value) ? value : "left";
}

function normalizeFont(value) {
  return FONT_ALIASES.includes(value) ? value : "regular";
}

function normalizeField(raw, pageSize) {
  if (!raw || typeof raw !== "object") return null;
  if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) return null;
  if (raw.x < 0 || raw.y < 0) return null;
  if (raw.x > pageSize.width + 0.01 || raw.y > pageSize.height + 0.01) {
    return null;
  }

  const fontSize = Number(raw.fontSize);
  if (!isFiniteNumber(fontSize) || fontSize < 6 || fontSize > 24) return null;

  const maxWidth = Number(raw.maxWidth);
  if (!isFiniteNumber(maxWidth) || maxWidth < 10 || maxWidth > pageSize.width) {
    return null;
  }

  const maxLines = Number.isFinite(Number(raw.maxLines))
    ? Math.max(1, Math.min(5, Math.round(Number(raw.maxLines))))
    : 1;

  const align = normalizeAlign(raw.align);

  return {
    x: round3(raw.x),
    y: round3(raw.y),
    align,
    fontSize: round3(fontSize),
    font: normalizeFont(raw.font),
    maxWidth: round3(
      Math.min(maxWidth, availableRoom(align, raw.x, pageSize.width)),
    ),
    maxLines,
    lineHeight: isFiniteNumber(Number(raw.lineHeight))
      ? round3(Math.max(fontSize, Math.min(40, Number(raw.lineHeight))))
      : round3(fontSize * 1.25),
    truncate: raw.truncate === true,
    // Optional, only meaningful for amountInWords: lets the vendor declare how
    // the template prints the currency suffix. Omitted means "auto-detect" and
    // is kept out of the stored object so unchanged mappings keep their hash.
    ...(AMOUNT_WORDS_STYLES.includes(raw.wordsStyle)
      ? { wordsStyle: raw.wordsStyle }
      : {}),
  };
}

function normalizeColumn(raw, pageSize, rowHeight) {
  if (!raw || typeof raw !== "object") return null;
  if (![...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS].includes(raw.key)) return null;
  if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.width)) return null;
  if (raw.x < 0 || raw.width < 10) return null;
  if (raw.x + raw.width > pageSize.width + 0.01) return null;

  const fontSize = Number(raw.fontSize);
  if (!isFiniteNumber(fontSize) || fontSize < 6 || fontSize > 24) return null;

  return {
    key: raw.key,
    x: round3(raw.x),
    width: round3(raw.width),
    align: normalizeAlign(raw.align),
    fontSize: round3(fontSize),
    // A cell can never print more lines than its row height holds: wrapping
    // past that point printed over the next row instead of inside its cell.
    maxLines: Number.isFinite(Number(raw.maxLines))
      ? Math.max(
          1,
          Math.min(3, rowLineCapacity(rowHeight, fontSize), Math.round(Number(raw.maxLines))),
        )
      : 1,
  };
}

function normalizeTax(raw) {
  const mode = raw?.taxMode === "inclusive_breakdown" ? "inclusive_breakdown" : "none";
  const cgstRateBp = Number.isFinite(Number(raw?.cgstRateBp))
    ? Math.max(0, Math.min(5000, Math.round(Number(raw.cgstRateBp))))
    : 0;
  const sgstRateBp = Number.isFinite(Number(raw?.sgstRateBp))
    ? Math.max(0, Math.min(5000, Math.round(Number(raw.sgstRateBp))))
    : 0;
  if (mode === "inclusive_breakdown" && cgstRateBp + sgstRateBp === 0) {
    return null;
  }
  return { taxMode: mode, cgstRateBp, sgstRateBp };
}

/**
 * Validate and normalize a vendor-submitted mapping. Coordinates are PDF user
 * space points relative to the mapped page. Returns { ok, mapping } or
 * { ok:false, reason }.
 */
export function validateMapping(raw, { pageSizes = [], page = 0 } = {}) {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "invalid_mapping" };

  const pageIndex = Number.isInteger(Number(raw.page)) ? Number(raw.page) : page;
  const pageSize = pageSizes[pageIndex];
  if (!pageSize) return { ok: false, reason: "invalid_page" };

  const tax = normalizeTax(raw);
  if (!tax) return { ok: false, reason: "invalid_tax_config" };

  const fields = {};
  const rawFields = raw.fields && typeof raw.fields === "object" ? raw.fields : {};
  for (const key of ALL_FIELDS) {
    if (!rawFields[key]) continue;
    const normalized = normalizeField(rawFields[key], pageSize);
    if (!normalized) return { ok: false, reason: `invalid_field:${key}` };
    fields[key] = normalized;
  }
  for (const key of REQUIRED_FIELDS) {
    if (!fields[key]) return { ok: false, reason: `missing_field:${key}` };
  }

  const tableRaw = raw.itemTable;
  if (!tableRaw || typeof tableRaw !== "object") {
    return { ok: false, reason: "missing_item_table" };
  }
  if (!isFiniteNumber(tableRaw.originX) || !isFiniteNumber(tableRaw.originY)) {
    return { ok: false, reason: "invalid_item_table" };
  }
  if (
    tableRaw.originX < 0 ||
    tableRaw.originY < 0 ||
    tableRaw.originX > pageSize.width ||
    tableRaw.originY > pageSize.height
  ) {
    return { ok: false, reason: "invalid_item_table" };
  }

  const rowHeight = Number(tableRaw.rowHeight);
  if (!isFiniteNumber(rowHeight) || rowHeight < 8 || rowHeight > 60) {
    return { ok: false, reason: "invalid_row_height" };
  }

  const maxRowsFirstPage = Number(tableRaw.maxRowsFirstPage);
  if (
    !Number.isInteger(maxRowsFirstPage) ||
    maxRowsFirstPage < 1 ||
    maxRowsFirstPage > 40
  ) {
    return { ok: false, reason: "invalid_max_rows" };
  }

  const baselineOffset = Number.isFinite(Number(tableRaw.baselineOffsetFromRowTop))
    ? Number(tableRaw.baselineOffsetFromRowTop)
    : Math.round(Number(fields.description?.fontSize || 9) * 1.2);
  if (baselineOffset < 1 || baselineOffset > rowHeight + 4) {
    return { ok: false, reason: "invalid_baseline_offset" };
  }

  const rawColumns = Array.isArray(tableRaw.columns) ? tableRaw.columns : [];
  const columns = [];
  const seen = new Set();
  for (const col of rawColumns) {
    const normalized = normalizeColumn(col, pageSize, rowHeight);
    if (!normalized) return { ok: false, reason: "invalid_column" };
    if (seen.has(normalized.key)) return { ok: false, reason: "duplicate_column" };
    seen.add(normalized.key);
    columns.push(normalized);
  }
  for (const key of REQUIRED_COLUMNS) {
    if (!seen.has(key)) return { ok: false, reason: `missing_column:${key}` };
  }
  columns.sort((a, b) => a.x - b.x);

  const continuationRaw =
    tableRaw.continuation && typeof tableRaw.continuation === "object"
      ? tableRaw.continuation
      : {};
  const continuation = {
    originY: isFiniteNumber(Number(continuationRaw.originY))
      ? round3(Math.min(pageSize.height, Math.max(0, Number(continuationRaw.originY))))
      : round3(pageSize.height - 96),
    bottomMargin: isFiniteNumber(Number(continuationRaw.bottomMargin))
      ? round3(Math.max(24, Math.min(200, Number(continuationRaw.bottomMargin))))
      : 60,
    showPageNumbers: continuationRaw.showPageNumbers !== false,
  };

  let continuationTotals = null;
  if (raw.continuationTotals && typeof raw.continuationTotals === "object") {
    const totals = {};
    for (const key of ["subtotal", "discount", "parcelCharge", "cgst", "sgst", "total", "amountInWords"]) {
      const entry = raw.continuationTotals[key];
      if (!entry) continue;
      const normalized = normalizeField(entry, pageSize);
      if (!normalized) return { ok: false, reason: `invalid_continuation_totals:${key}` };
      totals[key] = normalized;
    }
    if (Object.keys(totals).length) continuationTotals = totals;
  }

  const constantsRaw = raw.constants && typeof raw.constants === "object" ? raw.constants : {};
  const clip = (value) => String(value || "").slice(0, 300);

  const mapping = {
    schemaVersion: MAPPING_SCHEMA_VERSION,
    page: pageIndex,
    ...tax,
    constants: {
      sellerNote: clip(constantsRaw.sellerNote),
      termsText: clip(constantsRaw.termsText),
    },
    fields,
    itemTable: {
      originX: round3(tableRaw.originX),
      originY: round3(tableRaw.originY),
      rowHeight: round3(rowHeight),
      maxRowsFirstPage,
      baselineOffsetFromRowTop: round3(baselineOffset),
      columns,
      continuation,
    },
    continuationTotals,
  };

  return { ok: true, mapping };
}

export function mappingHash(mapping) {
  return hashJson(mapping);
}

export function mappingJson(mapping) {
  return canonicalJson(mapping);
}
