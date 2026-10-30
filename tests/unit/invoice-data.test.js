import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInvoiceData,
  buildSampleData,
} from "../../utils/invoice/invoice-data.js";
import { validateMapping } from "../../utils/invoice/mapping.js";

const pageSizes = [{ width: 595, height: 842 }];

function mapping(taxMode = "none") {
  const raw = {
    schemaVersion: 1,
    page: 0,
    taxMode,
    cgstRateBp: taxMode === "none" ? 0 : 250,
    sgstRateBp: taxMode === "none" ? 0 : 250,
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
      maxRowsFirstPage: 8,
      baselineOffsetFromRowTop: 11,
      columns: [
        { key: "description", x: 48, width: 260, align: "left", fontSize: 9, maxLines: 2 },
        { key: "quantity", x: 308, width: 48, align: "center", fontSize: 9, maxLines: 1 },
        { key: "unitRate", x: 356, width: 72, align: "right", fontSize: 9, maxLines: 1 },
        { key: "lineAmount", x: 428, width: 90, align: "right", fontSize: 9, maxLines: 1 },
      ],
    },
  };
  const result = validateMapping(raw, { pageSizes });
  assert.equal(result.ok, true, result.reason);
  return result.mapping;
}

const shop = { _id: "shop1", name: "Well B", slug: "well-b" };
const customer = { name: "Aarav", phone: "9999999999", email: "a@example.com" };

function orderFixture(overrides = {}) {
  return {
    _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    customer: "cccccccccccccccccccccccc",
    shop: "bbbbbbbbbbbbbbbbbbbbbbbb",
    items: [
      { name: "Veg Burger", price: 120, quantity: 2, status: "active", variantName: "Large" },
      { name: "Coffee", price: 35, quantity: 1, status: "active" },
      { name: "Removed Item", price: 50, quantity: 1, status: "removed" },
    ],
    orderType: "dinein",
    parcelCharge: 0,
    discountPercent: 10,
    discountAmountPaise: 2750,
    total: 247.5,
    status: "completed",
    collectedAt: new Date(),
    pickupMethod: "qr",
    paymentNote: "pay_test",
    transactionId: "pay_test",
    razorpayPaymentId: "pay_test",
    amountChargedPaise: 24750,
    refundStatus: "none",
    createdAt: new Date(),
    pickupTime: new Date(),
    ...overrides,
  };
}

test("builds data from persisted order facts and excludes removed items", () => {
  const data = buildInvoiceData({
    order: orderFixture(),
    shop,
    customer,
    mapping: mapping(),
    invoiceNumber: "INV-well-b-000001",
  });

  assert.equal(data.lines.length, 2);
  assert.equal(data.lines[0].description, "Veg Burger (Large)");
  assert.equal(data.totals.foodSubtotalPaise, 27500);
  assert.equal(data.totals.discountPaise, 2750);
  assert.equal(data.totals.payablePaise, 24750);
  assert.equal(data.totals.payableText, "\u20B9247.50");
  assert.equal(data.totals.amountInWords, "Two Hundred Forty Seven Rupees and Fifty Paise Only");
  assert.equal(data.customer.name, "Aarav");
  assert.equal(data.payment.verificationSource, "razorpay");
});

test("rejects a tampered total with totals_mismatch", () => {
  assert.throws(
    () =>
      buildInvoiceData({
        order: orderFixture({ total: 999 }),
        shop,
        customer,
        mapping: mapping(),
        invoiceNumber: "INV-x-000001",
      }),
    (error) => error.reason === "totals_mismatch",
  );
});

test("rejects an order item with invalid price or quantity", () => {
  assert.throws(
    () =>
      buildInvoiceData({
        order: orderFixture({
          items: [{ name: "Bad", price: 10, quantity: 0, status: "active" }],
          total: 10,
          discountPercent: 0,
          discountAmountPaise: 0,
        }),
        shop,
        customer,
        mapping: mapping(),
        invoiceNumber: "INV-x-000001",
      }),
    (error) => error.reason === "invalid_order_item",
  );
});

test("parcel charge is only billed for parcel orders", () => {
  const parcel = buildInvoiceData({
    order: orderFixture({
      orderType: "parcel",
      parcelCharge: 20,
      total: 267.5,
      discountAmountPaise: 2750,
    }),
    shop,
    customer,
    mapping: mapping(),
    invoiceNumber: "INV-x-000002",
  });
  assert.equal(parcel.totals.parcelChargePaise, 2000);
  assert.equal(parcel.totals.payablePaise, 26750);
  assert.equal(parcel.shop.orderTypeLabel, "Parcel");
});

test("inclusive tax breakdown reconciles exactly to the payable total", () => {
  const data = buildInvoiceData({
    order: orderFixture(),
    shop,
    customer,
    mapping: mapping("inclusive_breakdown"),
    invoiceNumber: "INV-x-000003",
  });
  assert.equal(data.totals.taxMode, "inclusive_breakdown");
  assert.equal(
    data.totals.taxableBasePaise + data.totals.cgstPaise + data.totals.sgstPaise,
    data.totals.payablePaise,
  );
});

test("sample data is deterministic and marked SAMPLE", () => {
  const data = buildSampleData({ shop, mapping: mapping() });
  assert.equal(data.invoice.number, "SAMPLE");
  assert.equal(data.mode, "sample");
  assert.equal(data.lines.length, 3);
  assert.ok(data.totals.payablePaise > 0);
});

test("adjusted orders bill the updated total and expose refund metadata", () => {
  const data = buildInvoiceData({
    order: orderFixture({
      adjustedAt: new Date(),
      originalTotal: 247.5,
      updatedTotal: 212.5,
      refundAmount: 35,
      total: 212.5,
      discountAmountPaise: 2750,
      items: [
        { name: "Veg Burger", price: 120, quantity: 2, status: "active" },
        { name: "Coffee", price: 35, quantity: 1, status: "removed" },
      ],
    }),
    shop,
    customer,
    mapping: mapping(),
    invoiceNumber: "INV-x-000004",
  });
  assert.equal(data.lines.length, 1);
  assert.equal(data.totals.payablePaise, 21250);
  assert.equal(data.adjustment.adjusted, true);
  assert.deepEqual(data.adjustment.removedItems, ["Coffee"]);
  assert.equal(data.payment.refundPaise, 3500);
});
