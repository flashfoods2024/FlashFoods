// Field-level fitting diagnostic for the billing template renderer.
// Builds representative sample data and reports, per configured field, how many
// lines the value needs at the configured width vs. the configured max lines.
// Also attempts a real render for each scenario so the failing reason (and the
// field behind it) can be observed.
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { buildSampleData } from "../utils/invoice/invoice-data.js";
import { generateInvoicePdf } from "../utils/invoice/invoice-generator.js";

const FONT_DIR = "assets/fonts/Roboto";

const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
const fonts = {
  regular: await doc.embedFont(fs.readFileSync(`${FONT_DIR}/Roboto-Regular.ttf`)),
  medium: await doc.embedFont(fs.readFileSync(`${FONT_DIR}/Roboto-Medium.ttf`)),
  bold: await doc.embedFont(fs.readFileSync(`${FONT_DIR}/Roboto-Bold.ttf`)),
};

function countLines(text, font, size, maxWidth) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return 0;
  const lines = [];
  let line = "";
  const fits = (value) => font.widthOfTextAtSize(value, size) <= maxWidth;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    if (fits(word)) {
      line = word;
      continue;
    }
    let chunk = "";
    for (const char of word) {
      if (fits(chunk + char)) chunk += char;
      else {
        if (chunk) lines.push(chunk);
        chunk = char;
      }
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines.length;
}

const TEMPLATE = await (async () => {
  const templateDoc = await PDFDocument.create();
  const page = templateDoc.addPage([595, 842]);
  page.drawText("TESTING CANTEEN", { x: 48, y: 792, size: 18 });
  page.drawText("Tax Invoice", { x: 470, y: 792, size: 12 });
  page.drawText("Invoice No:", { x: 48, y: 760, size: 9 });
  page.drawText("Date:", { x: 48, y: 744, size: 9 });
  page.drawText("Bill To:", { x: 48, y: 720, size: 9 });
  for (const [label, x] of [["Item", 48], ["Qty", 320], ["Rate", 370], ["Amount", 450]]) {
    page.drawText(label, { x, y: 590, size: 9 });
  }
  for (const [label, y] of [["Subtotal:", 260], ["Discount:", 244], ["Parcel:", 228], ["Total:", 200]]) {
    page.drawText(label, { x: 330, y, size: 9 });
  }
  page.drawText("Amount in words:", { x: 48, y: 175, size: 8 });
  return Buffer.from(await templateDoc.save());
})();

const baseTable = {
  originX: 48,
  originY: 542,
  rowHeight: 16,
  maxRowsFirstPage: 10,
  baselineOffsetFromRowTop: 11,
  columns: [
    { key: "description", x: 48, width: 235, align: "left", fontSize: 9, maxLines: 2 },
    { key: "quantity", x: 283, width: 61, align: "center", fontSize: 9, maxLines: 1 },
    { key: "unitRate", x: 344, width: 102, align: "right", fontSize: 9, maxLines: 1 },
    { key: "lineAmount", x: 446, width: 101, align: "right", fontSize: 9, maxLines: 1 },
  ],
  continuation: { originY: 732, bottomMargin: 60, showPageNumbers: true },
};

const mapping = (fields) => ({
  schemaVersion: 1,
  page: 0,
  taxMode: "none",
  cgstRateBp: 0,
  sgstRateBp: 0,
  constants: { sellerNote: "", termsText: "" },
  fields,
  itemTable: baseTable,
  continuationTotals: null,
});

const F = (x, y, align, size, font, maxWidth, maxLines) => ({
  x,
  y,
  align,
  fontSize: size,
  font,
  maxWidth,
  maxLines,
  lineHeight: Number((size * 1.25).toFixed(3)),
  truncate: false,
});

// Scenario A: the editor's current "Use default positions".
const defaults = mapping({
  invoiceNumber: F(547, 746, "right", 10, "bold", 160, 1),
  invoiceDate: F(547, 728, "right", 9, "regular", 140, 1),
  customerName: F(48, 692, "left", 10, "medium", 220, 1),
  subtotal: F(547, 260, "right", 9, "regular", 140, 1),
  discount: F(547, 244, "right", 9, "regular", 140, 1),
  parcelCharge: F(547, 228, "right", 9, "regular", 140, 1),
  total: F(547, 200, "right", 12, "bold", 160, 1),
  amountInWords: F(48, 160, "left", 9, "regular", 499, 3),
});

// Scenario B: a mapping saved while the editor computed right-aligned widths as
// `pageWidth - x - 24` (the pre-fix behaviour). Those widths are 24 pt.
const legacy = mapping({
  ...defaults.fields,
  invoiceNumber: F(547, 746, "right", 10, "bold", 24, 1),
  invoiceDate: F(547, 728, "right", 9, "regular", 24, 1),
  subtotal: F(547, 260, "right", 9, "regular", 24, 1),
  total: F(547, 200, "right", 12, "bold", 24, 1),
});

// Scenario C: amount in words placed through the panel's default inputs
// (Max width 180, Max lines 1) — the vendor widened it later but the saved
// mapping kept the placement-time values.
const narrowWords = mapping({
  ...defaults.fields,
  amountInWords: F(48, 160, "left", 9, "regular", 180, 1),
});

// Scenario D: generous widths and a long name/number; must pass.
const roomy = mapping({
  ...defaults.fields,
  invoiceNumber: F(547, 746, "right", 10, "bold", 460, 1),
  customerName: F(48, 692, "left", 10, "medium", 460, 2),
  amountInWords: F(48, 160, "left", 9, "regular", 480, 3),
});

const scenes = [
  { name: "A: current defaults", mapping: defaults, customer: "Sample Student", number: "SAMPLE" },
  { name: "B: legacy 24pt right widths", mapping: legacy, customer: "Sample Student", number: "SAMPLE" },
  { name: "C: amount in words at 180pt / 1 line", mapping: narrowWords, customer: "Sample Student", number: "SAMPLE" },
  {
    name: "D: realistic long values, roomy fields",
    mapping: roomy,
    customer: "Ananya Krishnamurthy Venkatesan",
    number: "INV-well-b-000123",
  },
];

const report = [];

for (const scene of scenes) {
  const data = buildSampleData({ shop: { name: "Testing", slug: "testing" }, mapping: scene.mapping });
  data.customer.name = scene.customer;
  data.invoice.number = scene.number;

  const rows = [];
  for (const [key, field] of Object.entries(scene.mapping.fields)) {
    const text = (() => {
      switch (key) {
        case "invoiceNumber": return data.invoice.number;
        case "invoiceDate": return data.invoice.dateIst;
        case "customerName": return data.customer.name;
        case "subtotal": return data.totals.foodSubtotalText;
        case "discount": return data.totals.discountText;
        case "parcelCharge": return data.totals.parcelChargeText;
        case "total": return data.totals.payableText;
        case "amountInWords": return data.totals.amountInWords;
        default: return "";
      }
    })();
    if (!text) continue;
    const font = fonts[field.font] || fonts.regular;
    const required = countLines(text, font, field.fontSize, field.maxWidth);
    rows.push({
      field: key,
      text,
      fontSize: field.fontSize,
      maxWidth: field.maxWidth,
      maxLines: field.maxLines,
      requiredLines: required,
      textWidth: Number(font.widthOfTextAtSize(text, field.fontSize).toFixed(1)),
      overflows: required > field.maxLines,
    });
  }

  let render;
  try {
    await generateInvoicePdf({ templateBytes: TEMPLATE, mapping: scene.mapping, data });
    render = { ok: true };
  } catch (error) {
    render = { ok: false, reason: error.reason, details: error.details };
  }

  report.push({ scene: scene.name, fields: rows, render });
}

console.log(JSON.stringify(report, null, 2));
