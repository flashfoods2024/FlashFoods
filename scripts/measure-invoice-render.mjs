// Measures the real overlay renderer (no database): 1, 12 and 30 billable
// lines on a clean A4 template with the default-style mapping used by the
// vendor editor. Writes temp/billing-e2e/render-perf.json.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { buildSampleData } from "../utils/invoice/invoice-data.js";
import { generateInvoicePdf } from "../utils/invoice/invoice-generator.js";

const OUT = path.join(process.cwd(), "temp", "billing-e2e");
fs.mkdirSync(OUT, { recursive: true });

const templateDoc = await PDFDocument.create();
const page = templateDoc.addPage([595, 842]);
page.drawText("TESTING CANTEEN — perf fixture", { x: 48, y: 792, size: 14 });
const templateBytes = Buffer.from(await templateDoc.save());
const templateSha = crypto.createHash("sha256").update(templateBytes).digest("hex");

const mapping = {
  schemaVersion: 1,
  page: 0,
  taxMode: "none",
  cgstRateBp: 0,
  sgstRateBp: 0,
  constants: { sellerNote: "", termsText: "" },
  fields: {
    invoiceNumber: { x: 547, y: 746, align: "right", fontSize: 10, font: "bold", maxWidth: 160, maxLines: 1 },
    invoiceDate: { x: 547, y: 728, align: "right", fontSize: 9, font: "regular", maxWidth: 140, maxLines: 1 },
    customerName: { x: 48, y: 692, align: "left", fontSize: 10, font: "medium", maxWidth: 220, maxLines: 1 },
    subtotal: { x: 547, y: 260, align: "right", fontSize: 9, font: "regular", maxWidth: 140, maxLines: 1 },
    total: { x: 547, y: 200, align: "right", fontSize: 12, font: "bold", maxWidth: 160, maxLines: 1 },
    amountInWords: { x: 48, y: 160, align: "left", fontSize: 9, font: "regular", maxWidth: 499, maxLines: 3 },
  },
  itemTable: {
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
  },
  continuationTotals: {
    subtotal: { x: 547, y: 180, align: "right", fontSize: 9, font: "regular", maxWidth: 140, maxLines: 1 },
    total: { x: 547, y: 150, align: "right", fontSize: 12, font: "bold", maxWidth: 160, maxLines: 1 },
    amountInWords: { x: 48, y: 110, align: "left", fontSize: 9, font: "regular", maxWidth: 499, maxLines: 3 },
  },
};

const shop = { name: "Testing", slug: "testing" };
const base = buildSampleData({ shop, mapping });
const results = [];

for (const count of [1, 12, 30]) {
  const data = { ...base, lines: base.lines.slice(0, count) };
  if (count > base.lines.length) {
    data.lines = Array.from({ length: count }, (_, index) => ({
      ...base.lines[index % base.lines.length],
      index: index + 1,
      description: `Test item ${index + 1}`,
    }));
  }
  data.lines = data.lines.map((line, index) => ({ ...line, index: index + 1 }));

  const started = process.hrtime.bigint();
  const rendered = await generateInvoicePdf({ templateBytes, mapping, data });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  if (count === 30) {
    fs.writeFileSync(path.join(OUT, "perf-30-items.pdf"), rendered.bytes);
  }

  results.push({
    lines: count,
    renderMs: Number(elapsedMs.toFixed(1)),
    pageCount: rendered.pageCount,
    outputBytes: rendered.bytes.length,
    templateSha256Unchanged:
      crypto.createHash("sha256").update(templateBytes).digest("hex") === templateSha,
  });
}

const peak = process.memoryUsage();
const report = {
  measuredAt: new Date().toISOString(),
  templateBytes: templateBytes.length,
  results,
  rssBytes: peak.rss,
  heapUsedBytes: peak.heapUsed,
};
fs.writeFileSync(path.join(OUT, "render-perf.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
