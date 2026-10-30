import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { PDFDocument, PDFDict, PDFName } from "pdf-lib";
import { validateTemplatePdf } from "../../utils/invoice/pdf-validate.js";
import { buildSampleData } from "../../utils/invoice/invoice-data.js";
import { validateMapping } from "../../utils/invoice/mapping.js";
import { generateInvoicePdf } from "../../utils/invoice/invoice-generator.js";

async function fontBaseNames(pdfBytes) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const names = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    const baseFont = object.get(PDFName.of("BaseFont"));
    if (baseFont) names.push(String(baseFont).replace(/^\//, ""));
  }
  return names;
}

async function makeTemplate() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawText("VENDOR HEADER", { x: 48, y: 800, size: 14 });
  return Buffer.from(await doc.save());
}

function mappingFor({ withContinuationTotals = true } = {}) {
  const raw = {
    schemaVersion: 1,
    page: 0,
    taxMode: "none",
    fields: {
      invoiceNumber: { x: 500, y: 760, align: "right", fontSize: 10, font: "bold", maxWidth: 150, maxLines: 1 },
      invoiceDate: { x: 500, y: 744, align: "right", fontSize: 9, font: "regular", maxWidth: 150, maxLines: 1 },
      customerName: { x: 48, y: 720, align: "left", fontSize: 10, font: "medium", maxWidth: 240, maxLines: 1 },
      subtotal: { x: 500, y: 300, align: "right", fontSize: 9, font: "regular", maxWidth: 140, maxLines: 1 },
      total: { x: 500, y: 270, align: "right", fontSize: 12, font: "bold", maxWidth: 160, maxLines: 1 },
      amountInWords: { x: 48, y: 220, align: "left", fontSize: 9, font: "regular", maxWidth: 420, maxLines: 3 },
    },
    itemTable: {
      originX: 48,
      originY: 580,
      rowHeight: 16,
      maxRowsFirstPage: 3,
      baselineOffsetFromRowTop: 11,
      columns: [
        { key: "description", x: 48, width: 260, align: "left", fontSize: 9, maxLines: 2 },
        { key: "quantity", x: 308, width: 48, align: "center", fontSize: 9, maxLines: 1 },
        { key: "unitRate", x: 356, width: 72, align: "right", fontSize: 9, maxLines: 1 },
        { key: "lineAmount", x: 428, width: 90, align: "right", fontSize: 9, maxLines: 1 },
      ],
    },
    continuationTotals: withContinuationTotals
      ? {
          subtotal: { x: 420, y: 180, align: "right", fontSize: 9, font: "regular", maxWidth: 140, maxLines: 1 },
          total: { x: 420, y: 150, align: "right", fontSize: 12, font: "bold", maxWidth: 160, maxLines: 1 },
          amountInWords: { x: 48, y: 110, align: "left", fontSize: 9, font: "regular", maxWidth: 400, maxLines: 3 },
        }
      : null,
  };
  const result = validateMapping(raw, { pageSizes: [{ width: 595, height: 842 }] });
  assert.equal(result.ok, true, result.reason);
  return result.mapping;
}

test("template validation accepts a clean PDF and reports geometry", async () => {
  const bytes = await makeTemplate();
  const result = await validateTemplatePdf(bytes, { originalFileName: "invoice.pdf" });
  assert.equal(result.ok, true);
  assert.equal(result.pageCount, 1);
  assert.equal(result.pageSizes[0].width, 595);
});

test("template validation rejects non-PDF bytes and oversized files", async () => {
  const notPdf = await validateTemplatePdf(Buffer.from("hello"), { originalFileName: "a.pdf" });
  assert.equal(notPdf.reason, "not_a_pdf");

  const badExt = await validateTemplatePdf(await makeTemplate(), { originalFileName: "a.png" });
  assert.equal(badExt.reason, "bad_extension");

  const big = Buffer.alloc(10 * 1024 * 1024 + 1);
  const oversize = await validateTemplatePdf(big, { originalFileName: "a.pdf" });
  assert.equal(oversize.reason, "file_too_large");
});

test("renderer keeps the template unchanged and draws Roboto text", async () => {
  const templateBytes = await makeTemplate();
  const before = Buffer.from(templateBytes);
  const mapping = mappingFor();
  const shop = { _id: "shop1", name: "Well B", slug: "well-b" };
  const data = buildSampleData({ shop, mapping });

  const rendered = await generateInvoicePdf({ templateBytes, mapping, data });
  assert.ok(rendered.bytes.length > 1000);
  assert.equal(rendered.pageCount, 1);
  assert.deepEqual(templateBytes, before);

  const templateFonts = await fontBaseNames(templateBytes);
  const renderedFonts = await fontBaseNames(rendered.bytes);
  assert.ok(
    renderedFonts.some((name) => name.includes("Roboto")),
    `embedded Roboto font expected, found ${renderedFonts.join(",")}`,
  );
  // The template's own static text may legitimately use Helvetica; dynamic text
  // must not add any standard-font fallback.
  const templateHelvetica = templateFonts.filter((name) => name.includes("Helvetica")).length;
  const renderedHelvetica = renderedFonts.filter((name) => name.includes("Helvetica")).length;
  assert.equal(renderedHelvetica, templateHelvetica, "no standard font fallback");
});

test("renderer adds continuation pages for long item lists", async () => {
  const templateBytes = await makeTemplate();
  const mapping = mappingFor();
  const shop = { _id: "shop1", name: "Well B", slug: "well-b" };
  const data = buildSampleData({ shop, mapping });
  data.lines = Array.from({ length: 30 }, (_, index) => ({
    index: index + 1,
    description: `Item number ${index + 1} with a fairly long description`,
    quantity: 1,
    unitRatePaise: 5000,
    lineAmountPaise: 5000,
    unitRateText: "\u20B950.00",
    lineAmountText: "\u20B950.00",
    foodType: "",
  }));

  const rendered = await generateInvoicePdf({ templateBytes, mapping, data });
  assert.ok(rendered.pageCount >= 2, "continuation page expected");
  const reloaded = await PDFDocument.load(rendered.bytes);
  assert.equal(reloaded.getPageCount(), rendered.pageCount);
  const sizes = reloaded.getPages().map((page) => page.getSize());
  assert.equal(sizes[0].width, 595);
  assert.equal(sizes[sizes.length - 1].width, 595);
});

test("renderer fails closed when overflow totals are not configured", async () => {
  const templateBytes = await makeTemplate();
  const mapping = mappingFor({ withContinuationTotals: false });
  const shop = { _id: "shop1", name: "Well B", slug: "well-b" };
  const data = buildSampleData({ shop, mapping });
  data.lines = Array.from({ length: 10 }, (_, index) => ({
    index: index + 1,
    description: `Item ${index + 1}`,
    quantity: 1,
    unitRatePaise: 5000,
    lineAmountPaise: 5000,
    unitRateText: "\u20B950.00",
    lineAmountText: "\u20B950.00",
    foodType: "",
  }));

  await assert.rejects(
    () => generateInvoicePdf({ templateBytes, mapping, data }),
    (error) => error.reason === "layout_overflow",
  );
});

test("Roboto assets contain the rupee glyph with matching checksums", () => {
  const hashes = {
    "Roboto-Regular.ttf": "15256405ecb0d880678833a582760efad538ab2932318b52c8105b267d159459",
    "Roboto-Medium.ttf": "79343dc641a2e8d48a703a4667b71fc8dc6565cc8ce47dfc34fc52c12aadbf38",
    "Roboto-Bold.ttf": "4aaf8c5b661a386998c2e70cf2b87e2440f5404e0b8fd81164f0413fb3435ec6",
  };
  for (const [file, expected] of Object.entries(hashes)) {
    const bytes = fs.readFileSync(`assets/fonts/Roboto/${file}`);
    const actual = crypto.createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, expected, `${file} checksum`);
  }
});
