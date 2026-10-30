import test from "node:test";
import assert from "node:assert/strict";
import {
  validateMapping,
  mappingHash,
  REQUIRED_FIELDS,
} from "../../utils/invoice/mapping.js";

const pageSizes = [{ width: 595, height: 842 }];

function baseMapping() {
  const fields = {
    invoiceNumber: { x: 500, y: 700, align: "right", fontSize: 10, font: "bold", maxWidth: 150, maxLines: 1 },
    invoiceDate: { x: 500, y: 680, align: "right", fontSize: 9, font: "regular", maxWidth: 150, maxLines: 1 },
    customerName: { x: 48, y: 640, align: "left", fontSize: 10, font: "medium", maxWidth: 220, maxLines: 1 },
    subtotal: { x: 500, y: 300, align: "right", fontSize: 9, font: "regular", maxWidth: 140, maxLines: 1 },
    total: { x: 500, y: 270, align: "right", fontSize: 12, font: "bold", maxWidth: 160, maxLines: 1 },
    amountInWords: { x: 48, y: 200, align: "left", fontSize: 9, font: "regular", maxWidth: 400, maxLines: 3 },
  };
  return {
    schemaVersion: 1,
    page: 0,
    taxMode: "none",
    cgstRateBp: 0,
    sgstRateBp: 0,
    constants: { sellerNote: "", termsText: "" },
    fields,
    itemTable: {
      originX: 48,
      originY: 560,
      rowHeight: 16,
      maxRowsFirstPage: 8,
      baselineOffsetFromRowTop: 11,
      columns: [
        { key: "description", x: 48, width: 260, align: "left", fontSize: 9, maxLines: 2 },
        { key: "quantity", x: 308, width: 48, align: "center", fontSize: 9, maxLines: 1 },
        { key: "unitRate", x: 356, width: 72, align: "right", fontSize: 9, maxLines: 1 },
        { key: "lineAmount", x: 428, width: 90, align: "right", fontSize: 9, maxLines: 1 },
      ],
    },
    continuationTotals: null,
  };
}

test("valid mapping is normalized and keeps PDF coordinates", () => {
  const result = validateMapping(baseMapping(), { pageSizes });
  assert.equal(result.ok, true);
  assert.equal(result.mapping.page, 0);
  assert.equal(result.mapping.fields.total.x, 500);
  assert.equal(result.mapping.itemTable.columns.length, 4);
  for (const key of REQUIRED_FIELDS) {
    assert.ok(result.mapping.fields[key], `missing ${key}`);
  }
});

test("missing required field is rejected", () => {
  const raw = baseMapping();
  delete raw.fields.total;
  const result = validateMapping(raw, { pageSizes });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_field:total");
});

test("out-of-page coordinates and bad font sizes are rejected", () => {
  const raw = baseMapping();
  raw.fields.customerName.x = 900;
  assert.equal(validateMapping(raw, { pageSizes }).reason, "invalid_field:customerName");

  const raw2 = baseMapping();
  raw2.fields.total.fontSize = 40;
  assert.equal(validateMapping(raw2, { pageSizes }).reason, "invalid_field:total");

  const raw3 = baseMapping();
  raw3.itemTable.rowHeight = 2;
  assert.equal(validateMapping(raw3, { pageSizes }).reason, "invalid_row_height");

  const raw4 = baseMapping();
  raw4.itemTable.columns = raw4.itemTable.columns.filter((c) => c.key !== "quantity");
  assert.equal(validateMapping(raw4, { pageSizes }).reason, "missing_column:quantity");
});

test("viewport-style or NaN coordinates are rejected", () => {
  const raw = baseMapping();
  raw.fields.invoiceDate.x = Number.NaN;
  assert.equal(validateMapping(raw, { pageSizes }).reason, "invalid_field:invoiceDate");
});

test("mapping hash is stable regardless of key order", () => {
  const first = validateMapping(baseMapping(), { pageSizes }).mapping;
  const reordered = JSON.parse(JSON.stringify(first));
  const shuffled = Object.fromEntries(Object.entries(reordered).reverse());
  assert.equal(mappingHash(first), mappingHash(shuffled));
});

test("tax mode requires explicit rates", () => {
  const raw = baseMapping();
  raw.taxMode = "inclusive_breakdown";
  assert.equal(validateMapping(raw, { pageSizes }).reason, "invalid_tax_config");

  raw.cgstRateBp = 250;
  raw.sgstRateBp = 250;
  const result = validateMapping(raw, { pageSizes });
  assert.equal(result.ok, true);
  assert.equal(result.mapping.taxMode, "inclusive_breakdown");
});
