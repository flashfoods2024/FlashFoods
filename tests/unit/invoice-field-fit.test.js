import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildSampleData } from "../../utils/invoice/invoice-data.js";
import { validateMapping } from "../../utils/invoice/mapping.js";
import { generateInvoicePdf } from "../../utils/invoice/invoice-generator.js";

const PAGE = { width: 595, height: 842 };

async function makeTemplate() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.width, PAGE.height]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("TESTING CANTEEN", { x: 48, y: 792, size: 18, font });
  page.drawText("Tax Invoice", { x: 470, y: 792, size: 12, font });
  page.drawText("Invoice No:", { x: 48, y: 760, size: 9, font });
  page.drawText("Date:", { x: 48, y: 744, size: 9, font });
  page.drawText("Bill To:", { x: 48, y: 720, size: 9, font });
  page.drawText("Item", { x: 48, y: 590, size: 9, font });
  page.drawText("Qty", { x: 320, y: 590, size: 9, font });
  page.drawText("Rate", { x: 370, y: 590, size: 9, font });
  page.drawText("Amount", { x: 450, y: 590, size: 9, font });
  return Buffer.from(await doc.save());
}

const field = (x, y, align, fontSize, maxWidth, maxLines, font = "regular") => ({
  x,
  y,
  align,
  fontSize,
  font,
  maxWidth,
  maxLines,
});

const ITEM_TABLE = {
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
};

function buildMapping(overrides = {}, tableOverrides = {}) {
  const raw = {
    schemaVersion: 1,
    page: 0,
    taxMode: "none",
    fields: {
      invoiceNumber: field(547, 746, "right", 10, 160, 1, "bold"),
      invoiceDate: field(547, 728, "right", 9, 140, 1),
      customerName: field(48, 692, "left", 10, 220, 1, "medium"),
      subtotal: field(547, 260, "right", 9, 140, 1),
      total: field(547, 200, "right", 12, 160, 1, "bold"),
      amountInWords: field(48, 160, "left", 9, 499, 3),
      ...(overrides.fields || {}),
    },
    itemTable: { ...ITEM_TABLE, ...(overrides.itemTable || tableOverrides) },
    continuationTotals: overrides.continuationTotals ?? null,
  };
  const result = validateMapping(raw, { pageSizes: [PAGE] });
  assert.equal(result.ok, true, result.reason);
  return result.mapping;
}

const shop = { _id: "shop1", name: "Testing", slug: "testing" };

test("overflow names the exact field and its measured requirement", async () => {
  const mapping = buildMapping({
    fields: { amountInWords: field(48, 160, "left", 9, 180, 1) },
  });
  const data = buildSampleData({ shop, mapping });

  const templateBytes = await makeTemplate();
  await assert.rejects(
    () => generateInvoicePdf({ templateBytes, mapping, data }),
    (error) => {
      assert.equal(error.reason, "text_overflow");
      assert.equal(error.details.field, "amountInWords");
      assert.equal(error.details.maxLines, 1);
      assert.equal(error.details.maxWidth, 180);
      assert.equal(error.details.fontSize, 9);
      assert.ok(error.details.requiredLines >= 2, "two or more lines required");
      assert.ok(error.details.textWidth > 180, "measured width exceeds the box");
      assert.equal(error.details.canWrap, true);
      // No customer, payment or value text is leaked in diagnostics.
      assert.equal(error.details.text, undefined);
      return true;
    },
  );
});

test("amount in words wraps inside the configured lines instead of failing", async () => {
  const mapping = buildMapping();
  const data = buildSampleData({ shop, mapping });
  data.totals.amountInWords =
    "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees Only";
  const templateBytes = await makeTemplate();

  const rendered = await generateInvoicePdf({ templateBytes, mapping, data });
  assert.ok(rendered.bytes.length > 1000);
  assert.equal(rendered.pageCount, 1);

  // The same long value against a two-line budget must fail closed, naming the
  // field and how many lines it actually needs.
  const tight = buildMapping({
    fields: { amountInWords: field(48, 160, "left", 9, 180, 2) },
  });
  await assert.rejects(
    () => generateInvoicePdf({ templateBytes, mapping: tight, data }),
    (error) =>
      error.reason === "text_overflow" &&
      error.details.field === "amountInWords" &&
      error.details.requiredLines > 2,
  );
});

test("long customer names wrap when lines are configured and fail by name when not", async () => {
  const dataFor = (mapping) => {
    const data = buildSampleData({ shop, mapping });
    data.customer.name = "Ananya Krishnamurthy Venkatesan Subramaniam";
    return data;
  };

  const twoLines = buildMapping({
    fields: { customerName: field(48, 692, "left", 10, 120, 2, "medium") },
  });
  const rendered = await generateInvoicePdf({
    templateBytes: await makeTemplate(),
    mapping: twoLines,
    data: dataFor(twoLines),
  });
  assert.ok(rendered.bytes.length > 1000);

  const oneLine = buildMapping({
    fields: { customerName: field(48, 692, "left", 10, 120, 1, "medium") },
  });
  const templateBytes = await makeTemplate();
  await assert.rejects(
    () =>
      generateInvoicePdf({
        templateBytes,
        mapping: oneLine,
        data: dataFor(oneLine),
      }),
    (error) =>
      error.reason === "text_overflow" &&
      error.details.field === "customerName" &&
      error.details.requiredLines >= 2,
  );
});

test("long shop-scoped invoice numbers fit a wide field", async () => {
  const mapping = buildMapping({
    fields: { invoiceNumber: field(547, 746, "right", 10, 460, 1, "bold") },
  });
  const data = buildSampleData({ shop, mapping });
  data.invoice.number = "INV-well-b-000123";

  const rendered = await generateInvoicePdf({
    templateBytes: await makeTemplate(),
    mapping,
    data,
  });
  assert.ok(rendered.bytes.length > 1000);
});

test("item column overflow names the column", async () => {
  const mapping = buildMapping({
    itemTable: {
      columns: [
        { key: "description", x: 48, width: 235, align: "left", fontSize: 9, maxLines: 2 },
        { key: "quantity", x: 283, width: 61, align: "center", fontSize: 9, maxLines: 1 },
        // 30 pt cannot hold a five-figure rupee amount on one line.
        { key: "unitRate", x: 344, width: 30, align: "right", fontSize: 9, maxLines: 1 },
        { key: "lineAmount", x: 446, width: 101, align: "right", fontSize: 9, maxLines: 1 },
      ],
    },
  });
  const data = buildSampleData({ shop, mapping });
  data.lines[0] = {
    ...data.lines[0],
    unitRateText: "\u20B91,23,456.00",
  };

  const templateBytes = await makeTemplate();
  await assert.rejects(
    () =>
      generateInvoicePdf({
        templateBytes,
        mapping,
        data,
      }),
    (error) =>
      error.reason === "text_overflow" &&
      error.details.column === "unitRate" &&
      error.details.field === undefined,
  );
});

test("item cells are capped to the lines their row height holds", () => {
  const mapping = buildMapping({
    itemTable: {
      rowHeight: 16,
      columns: [
        { key: "description", x: 48, width: 235, align: "left", fontSize: 9, maxLines: 2 },
        { key: "quantity", x: 283, width: 61, align: "center", fontSize: 9, maxLines: 1 },
        { key: "unitRate", x: 344, width: 102, align: "right", fontSize: 9, maxLines: 1 },
        { key: "lineAmount", x: 446, width: 101, align: "right", fontSize: 9, maxLines: 1 },
      ],
    },
  });
  const description = mapping.itemTable.columns.find((c) => c.key === "description");
  assert.equal(description.maxLines, 1, "16 pt holds one 9 pt line");

  const roomy = buildMapping({
    itemTable: {
      rowHeight: 22,
      columns: [
        { key: "description", x: 48, width: 235, align: "left", fontSize: 9, maxLines: 2 },
        { key: "quantity", x: 283, width: 61, align: "center", fontSize: 9, maxLines: 1 },
        { key: "unitRate", x: 344, width: 102, align: "right", fontSize: 9, maxLines: 1 },
        { key: "lineAmount", x: 446, width: 101, align: "right", fontSize: 9, maxLines: 1 },
      ],
    },
  });
  assert.equal(
    roomy.itemTable.columns.find((c) => c.key === "description").maxLines,
    2,
    "22 pt holds two 9 pt lines",
  );
});

test("a raw mapping can never print a cell past its row height", async () => {
  const mapping = buildMapping();
  // Simulate a mapping stored before the row-height cap existed.
  mapping.itemTable.rowHeight = 16;
  mapping.itemTable.columns = mapping.itemTable.columns.map((column) =>
    column.key === "unitRate" ? { ...column, width: 30, maxLines: 2 } : column,
  );
  const data = buildSampleData({ shop, mapping });
  data.lines[0] = { ...data.lines[0], unitRateText: "\u20B91,23,456.00" };

  const templateBytes = await makeTemplate();
  await assert.rejects(
    () => generateInvoicePdf({ templateBytes, mapping, data }),
    (error) =>
      error.reason === "text_overflow" &&
      error.details.column === "unitRate" &&
      error.details.maxLines === 1,
  );
});

test("a field box is bounded by the room on its anchor side", () => {
  const mapping = buildMapping({
    fields: { invoiceNumber: field(547, 746, "right", 10, 590, 1, "bold") },
  });
  // Right-aligned text grows leftwards from x = 547, so the page's remaining
  // 24 pt right margin is not usable and the box is capped at 523 pt.
  assert.ok(mapping.fields.invoiceNumber.maxWidth <= 523);
  assert.ok(mapping.fields.invoiceNumber.maxWidth >= 500);
});
