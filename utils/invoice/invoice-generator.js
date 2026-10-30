import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";

export const RENDERER_VERSION = 1;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.resolve(HERE, "../../assets/fonts/Roboto");
const INK = rgb(0.06, 0.06, 0.06);

const FONT_FILES = {
  regular: "Roboto-Regular.ttf",
  medium: "Roboto-Medium.ttf",
  bold: "Roboto-Bold.ttf",
};

const TOTALS_KEYS = [
  "subtotal",
  "discount",
  "parcelCharge",
  "cgst",
  "sgst",
  "total",
  "amountInWords",
];

export class InvoiceRenderError extends Error {
  constructor(reason, details) {
    super(reason);
    this.reason = reason;
    this.details = details || null;
  }
}

const FIELD_VALUES = {
  invoiceNumber: (data) => data.invoice.number,
  invoiceDate: (data) => data.invoice.dateIst,
  customerName: (data) => data.customer.name,
  customerPhone: (data) => data.customer.phone,
  customerEmail: (data) => data.customer.email,
  orderRef: (data) => data.order.shortRef,
  orderType: (data) => data.shop.orderTypeLabel,
  pickupTime: (data) => data.order.pickupTimeIst,
  subtotal: (data) => data.totals.foodSubtotalText,
  discount: (data) => (data.totals.discountPaise > 0 ? data.totals.discountText : ""),
  parcelCharge: (data) =>
    data.totals.parcelChargePaise > 0 ? data.totals.parcelChargeText : "",
  cgst: (data) => data.totals.cgstText || "",
  sgst: (data) => data.totals.sgstText || "",
  total: (data) => data.totals.payableText,
  amountInWords: (data) => data.totals.amountInWords,
  paymentReference: (data) => data.payment.transactionId || data.payment.note || "",
  sellerNote: (data) => data.constants.sellerNote || "",
  termsText: (data) => data.constants.termsText || "",
  sampleWatermark: (data) => (data.mode === "sample" ? "SAMPLE" : ""),
};

const COLUMN_VALUES = {
  description: (line) => line.description,
  quantity: (line) => String(line.quantity),
  unitRate: (line) => line.unitRateText,
  lineAmount: (line) => line.lineAmountText,
  serial: (line) => String(line.index),
  foodType: (line) => line.foodType || "",
};

let fontCache = null;

async function loadFontBuffers() {
  if (!fontCache) {
    fontCache = (async () => {
      const buffers = {};
      for (const [alias, file] of Object.entries(FONT_FILES)) {
        try {
          buffers[alias] = await fs.readFile(path.join(FONT_DIR, file));
        } catch {
          throw new InvoiceRenderError("font_asset_missing", { file });
        }
      }
      return buffers;
    })();
  }
  return fontCache;
}

function countLines(text, font, size, maxWidth) {
  const words = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (!words.length) return [];

  const lines = [];
  let line = "";
  const fits = (value) => font.widthOfTextAtSize(value, size) <= maxWidth;

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    if (fits(word)) {
      line = word;
      continue;
    }
    // A single word wider than the column: break by character.
    let chunk = "";
    for (const char of word) {
      if (fits(chunk + char)) {
        chunk += char;
      } else {
        if (chunk) lines.push(chunk);
        chunk = char;
      }
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

function ellipsize(text, font, size, maxWidth) {
  const suffix = "\u2026";
  let value = String(text || "");
  if (font.widthOfTextAtSize(value + suffix, size) <= maxWidth) {
    return value + suffix;
  }
  while (value.length > 0) {
    value = value.slice(0, -1);
    if (font.widthOfTextAtSize(value.trimEnd() + suffix, size) <= maxWidth) {
      return value.trimEnd() + suffix;
    }
  }
  return suffix;
}

function maxWordWidth(text, font, size) {
  let widest = 0;
  for (const word of String(text || "").split(/\s+/)) {
    if (!word) continue;
    const width = font.widthOfTextAtSize(word, size);
    if (width > widest) widest = width;
  }
  return widest;
}

function round2(value) {
  return Number(Number(value).toFixed(2));
}

/**
 * Fit a value into its configured box using real bundled-font metrics. Word
 * wrapping is the first remedy; if the wrapped value still needs more lines than
 * configured, rendering fails with the exact field (or table column) and its
 * measurements so the vendor can widen it instead of guessing. Text is never
 * truncated for template fields and the font size is never shrunk here.
 */
function layoutText({
  text,
  font,
  size,
  maxWidth,
  maxLines,
  truncate,
  reason,
  context,
}) {
  const lines = countLines(text, font, size, maxWidth);
  if (!lines.length) return [];
  if (lines.length <= maxLines) return lines;
  if (!truncate) {
    throw new InvoiceRenderError(reason || "text_overflow", {
      ...(context || {}),
      fontSize: round2(size),
      maxWidth: round2(maxWidth),
      maxLines,
      requiredLines: lines.length,
      textWidth: round2(font.widthOfTextAtSize(String(text), size)),
      longestWordWidth: round2(maxWordWidth(text, font, size)),
      canWrap: lines.length > 1,
    });
  }
  const kept = lines.slice(0, maxLines);
  kept[kept.length - 1] = ellipsize(kept[kept.length - 1], font, size, maxWidth);
  return kept;
}

function drawLines(page, font, lines, { anchorX, y, size, align, lineHeight }) {
  let lineIndex = 0;
  for (const line of lines) {
    const width = font.widthOfTextAtSize(line, size);
    let x = anchorX;
    if (align === "center") x = anchorX - width / 2;
    if (align === "right") x = anchorX - width;
    page.drawText(line, {
      x,
      y: y - lineIndex * lineHeight,
      size,
      font,
      color: INK,
    });
    lineIndex += 1;
  }
}

function drawField(page, key, field, text, fonts, context = {}) {
  const font = fonts[field.font] || fonts.regular;
  // Older/default mappings omit lineHeight; derive it instead of passing
  // undefined into pdf-lib (which surfaced as a NaN y-coordinate crash on the
  // second line of a wrapped value).
  const configuredLineHeight = Number(field.lineHeight);
  const lineHeight =
    Number.isFinite(configuredLineHeight) && configuredLineHeight > 0
      ? configuredLineHeight
      : field.fontSize * 1.2;
  const lines = layoutText({
    text,
    font,
    size: field.fontSize,
    maxWidth: field.maxWidth,
    maxLines: field.maxLines,
    truncate: field.truncate,
    reason: "text_overflow",
    context: { ...context, field: key },
  });
  drawLines(page, font, lines, {
    anchorX: field.x,
    y: field.y,
    size: field.fontSize,
    align: field.align,
    lineHeight,
  });
}

function drawTemplateFields(page, mapping, data, fonts, skipKeys) {
  for (const [key, field] of Object.entries(mapping.fields)) {
    if (skipKeys.includes(key)) continue;
    const getter = FIELD_VALUES[key];
    if (!getter) continue;
    const text = getter(data);
    if (text === "" || text === null || text === undefined) continue;
    drawField(page, key, field, String(text), fonts);
  }
}

function drawItemRow(page, columns, line, rowTop, mapping, fonts) {
  const baseline = rowTop - mapping.itemTable.baselineOffsetFromRowTop;
  for (const column of columns) {
    const getter = COLUMN_VALUES[column.key];
    if (!getter) continue;
    const text = getter(line);
    if (!text) continue;
    const font = fonts[column.font] || fonts.regular;
    // Only lines that fit between this row's top and the next row are drawn;
    // older mappings could ask for more lines than the configured row height
    // holds, which printed the overflow on top of the following item.
    const capacity = Math.max(
      1,
      Math.floor((Number(mapping.itemTable.rowHeight) + 0.001) / (column.fontSize * 1.2)),
    );
    const lines = layoutText({
      text,
      font,
      size: column.fontSize,
      maxWidth: column.width,
      maxLines: Math.min(column.maxLines, capacity),
      truncate: column.key === "description",
      reason: "text_overflow",
      context: { column: column.key },
    });
    drawLines(page, font, lines, {
      anchorX: column.x,
      y: baseline,
      size: column.fontSize,
      align: column.align,
      lineHeight: column.fontSize * 1.2,
    });
  }
}

function drawContinuationHeader(page, { number, shopName, pageNumber, totalPages, font }) {
  const { width, height } = page.getSize();
  const label = `${number} \u00b7 ${shopName} \u00b7 Continued items`;
  page.drawText(label, { x: 40, y: height - 48, size: 9, font, color: INK });
  if (totalPages) {
    const pageLabel = `Page ${pageNumber} of ${totalPages}`;
    const labelWidth = font.widthOfTextAtSize(pageLabel, 9);
    page.drawText(pageLabel, {
      x: width - 40 - labelWidth,
      y: height - 48,
      size: 9,
      font,
      color: INK,
    });
  }
}

/**
 * Render the vendor PDF with dynamic values overlaid. The template bytes are
 * never modified; the returned buffer is a new document.
 */
export async function generateInvoicePdf({ templateBytes, mapping, data }) {
  if (!templateBytes || !templateBytes.length) {
    throw new InvoiceRenderError("missing_template");
  }
  if (!mapping) throw new InvoiceRenderError("missing_mapping");

  const buffers = await loadFontBuffers();

  let doc;
  try {
    doc = await PDFDocument.load(templateBytes, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
  } catch (err) {
    const message = String(err?.message || "").toLowerCase();
    throw new InvoiceRenderError(
      message.includes("encrypt") ? "encrypted_pdf" : "invalid_pdf",
    );
  }

  doc.registerFontkit(fontkit);
  const fonts = {
    regular: await doc.embedFont(buffers.regular, { subset: false }),
    medium: await doc.embedFont(buffers.medium, { subset: false }),
    bold: await doc.embedFont(buffers.bold, { subset: false }),
  };

  const pages = doc.getPages();
  const pageIndex = mapping.page || 0;
  const templatePage = pages[pageIndex];
  if (!templatePage) throw new InvoiceRenderError("invalid_page");

  const table = mapping.itemTable;
  const lines = data.lines || [];
  const rowsFirstPage = Math.min(lines.length, table.maxRowsFirstPage);
  const continuationRows = Math.max(
    1,
    Math.floor((table.continuation.originY - table.continuation.bottomMargin) / table.rowHeight),
  );
  const remaining = Math.max(0, lines.length - table.maxRowsFirstPage);
  const continuationPageCount =
    remaining > 0 ? Math.ceil(remaining / continuationRows) : 0;

  if (continuationPageCount > 0 && !mapping.continuationTotals) {
    throw new InvoiceRenderError("layout_overflow", {
      lines: lines.length,
      maxRowsFirstPage: table.maxRowsFirstPage,
    });
  }

  // Page-1 dynamic fields (and item rows). Totals move to the last continuation
  // page when rows overflow, so a total never sits apart from its line items.
  drawTemplateFields(templatePage, mapping, data, fonts, continuationPageCount ? TOTALS_KEYS : []);

  for (let i = 0; i < rowsFirstPage; i += 1) {
    const rowTop = table.originY - i * table.rowHeight;
    drawItemRow(templatePage, table.columns, lines[i], rowTop, mapping, fonts);
  }

  let lastPage = templatePage;
  if (continuationPageCount > 0) {
    const templateSize = templatePage.getSize();
    const totalPages = pages.length + continuationPageCount;

    for (let pageOffset = 0; pageOffset < continuationPageCount; pageOffset += 1) {
      const page = doc.addPage([templateSize.width, templateSize.height]);
      lastPage = page;
      drawContinuationHeader(page, {
        number: data.invoice.number,
        shopName: data.shop.name,
        // pages.length counts template pages, so the first continuation page
        // is the next one (previously it labelled itself "Page 1 of 2").
        pageNumber: pages.length + pageOffset + 1,
        totalPages: table.continuation.showPageNumbers ? totalPages : 0,
        font: fonts.regular,
      });
      for (const column of table.columns) {
        const label = column.key === "unitRate" ? "Rate" : column.key === "lineAmount" ? "Amount" : column.key === "serial" ? "#" : column.key.charAt(0).toUpperCase() + column.key.slice(1);
        const font = fonts.medium;
        drawLines(page, font, [label], {
          anchorX: column.x,
          y: table.continuation.originY + 14,
          size: column.fontSize,
          align: column.align,
          lineHeight: column.fontSize * 1.2,
        });
      }

      const start = table.maxRowsFirstPage + pageOffset * continuationRows;
      const end = Math.min(lines.length, start + continuationRows);
      for (let i = start; i < end; i += 1) {
        const rowTop = table.continuation.originY - (i - start) * table.rowHeight;
        drawItemRow(page, table.columns, lines[i], rowTop, mapping, fonts);
      }
    }

    for (const [key, field] of Object.entries(mapping.continuationTotals || {})) {
      const getter = FIELD_VALUES[key];
      if (!getter) continue;
      const text = getter(data);
      if (!text) continue;
      drawField(lastPage, key, field, String(text), fonts);
    }
  }

  const bytes = Buffer.from(await doc.save({ useObjectStreams: true }));
  return { bytes, pageCount: doc.getPageCount() };
}
