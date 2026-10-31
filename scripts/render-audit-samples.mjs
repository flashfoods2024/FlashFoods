/**
 * F14 visual audit samples.
 *
 * Renders the custom invoice over a Well B-shaped master PDF for every layout
 * case the audit requires (1/3/10/30 items, long values, continuation pages),
 * plus a before/after pair for the duplicated "Rupees only" suffix.
 *
 * Output: temp/billing-e2e/audit-*.pdf and audit-*.png (110 dpi, pdftoppm).
 * These are throwaway artifacts; temp/ is gitignored.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { validateMapping } from "../utils/invoice/mapping.js";
import { buildInvoiceData } from "../utils/invoice/invoice-data.js";
import { generateInvoicePdf } from "../utils/invoice/invoice-generator.js";
import { resolveAmountWordsStyle } from "../utils/invoice/template-text.js";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "temp", "billing-e2e");
await fs.mkdir(OUT, { recursive: true });

const PAGE = { width: 595, height: 842 };
const SHOP = { _id: "auditshop000000000000001", name: "Well B", slug: "well-b" };
const CUSTOMER = {
  name: "Aarav Sharma",
  phone: "98765 43210",
  email: "aarav@example.com",
};

/** A master PDF shaped like the Well B invoice, including its printed suffix. */
async function masterPdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE.width, PAGE.height]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = (value, x, y, size = 9, useBold = false) =>
    page.drawText(value, { x, y, size, font: useBold ? bold : font });

  text("WELL B CANTEEN", 48, 800, 16, true);
  text("GSTIN: 27ABCDE1234F1Z5", 48, 782);
  text("TAX INVOICE", 490, 800, 12, true);

  text("Invoice No:", 48, 790);
  text("Date:", 48, 772);
  text("Bill To:", 48, 752);

  text("#", 48, 648);
  text("Item", 72, 648);
  text("Qty", 300, 648);
  text("Rate", 360, 648);
  text("Amount", 460, 648);

  text("Subtotal:", 330, 330);
  text("Discount:", 330, 312);
  text("Parcel:", 330, 294);
  text("CGST 9%:", 330, 276);
  text("SGST 9%:", 330, 262);
  text("Total:", 330, 240);

  text("Amount in words:", 48, 205);
  text("Rupees only", 430, 205);

  text("Thank you for your order. Goods once sold are not returnable.", 48, 70);
  text("Authorised signatory", 420, 70);

  return Buffer.from(await doc.save());
}

function rawMapping(wordsStyle) {
  const fields = {
    invoiceNumber: { x: 540, y: 790, align: "right", fontSize: 9, font: "bold", maxWidth: 160, maxLines: 1 },
    invoiceDate: { x: 540, y: 772, align: "right", fontSize: 9, font: "regular", maxWidth: 120, maxLines: 1 },
    customerName: { x: 48, y: 740, align: "left", fontSize: 10, font: "medium", maxWidth: 300, maxLines: 2 },
    orderRef: { x: 540, y: 754, align: "right", fontSize: 9, font: "regular", maxWidth: 140, maxLines: 1 },
    subtotal: { x: 540, y: 330, align: "right", fontSize: 9, font: "regular", maxWidth: 160, maxLines: 1 },
    discount: { x: 540, y: 312, align: "right", fontSize: 9, font: "regular", maxWidth: 160, maxLines: 1 },
    parcelCharge: { x: 540, y: 294, align: "right", fontSize: 9, font: "regular", maxWidth: 160, maxLines: 1 },
    total: { x: 540, y: 240, align: "right", fontSize: 12, font: "bold", maxWidth: 190, maxLines: 1 },
    // The value box starts after the printed "Amount in words:" label and stops
    // before the printed "Rupees only", exactly as a vendor would place it.
    amountInWords: {
      x: 140, y: 205, align: "left", fontSize: 9, font: "regular", maxWidth: 280, maxLines: 2,
      ...(wordsStyle ? { wordsStyle } : {}),
    },
  };

  return {
    schemaVersion: 1,
    page: 0,
    taxMode: "none",
    fields,
    itemTable: {
      originX: 48,
      originY: 640,
      rowHeight: 22,
      maxRowsFirstPage: 6,
      baselineOffsetFromRowTop: 13,
      columns: [
        { key: "serial", x: 48, width: 24, align: "left", fontSize: 9, maxLines: 1 },
        { key: "description", x: 72, width: 218, align: "left", fontSize: 9, maxLines: 2 },
        { key: "quantity", x: 296, width: 44, align: "center", fontSize: 9, maxLines: 1 },
        { key: "unitRate", x: 346, width: 76, align: "right", fontSize: 9, maxLines: 1 },
        { key: "lineAmount", x: 430, width: 90, align: "right", fontSize: 9, maxLines: 1 },
      ],
      continuation: { originY: 700, bottomMargin: 90, showPageNumbers: true },
    },
    continuationTotals: {
      subtotal: { x: 540, y: 180, align: "right", fontSize: 9, font: "regular", maxWidth: 160, maxLines: 1 },
      discount: { x: 540, y: 162, align: "right", fontSize: 9, font: "regular", maxWidth: 160, maxLines: 1 },
      parcelCharge: { x: 540, y: 144, align: "right", fontSize: 9, font: "regular", maxWidth: 160, maxLines: 1 },
      total: { x: 540, y: 110, align: "right", fontSize: 12, font: "bold", maxWidth: 190, maxLines: 1 },
      amountInWords: { x: 48, y: 80, align: "left", fontSize: 9, font: "regular", maxWidth: 380, maxLines: 2 },
    },
  };
}

function mapping(wordsStyle) {
  const result = validateMapping(rawMapping(wordsStyle), { pageSizes: [PAGE] });
  if (!result.ok) throw new Error(`audit mapping invalid: ${result.reason}`);
  return result.mapping;
}

/** Order fixture whose persisted totals reconcile exactly with its items. */
function orderFrom(items, { discountPercent = 10, parcelCharge = 20 } = {}) {
  const foodSubtotalPaise = items.reduce(
    (sum, item) => sum + Math.round(item.price * 100) * item.quantity,
    0,
  );
  const discountPaise = Math.round((foodSubtotalPaise * discountPercent) / 100);
  const payablePaise = foodSubtotalPaise - discountPaise + Math.round(parcelCharge * 100);

  return {
    _id: "audit000000000000000001",
    customer: "audit000000000000000002",
    shop: SHOP._id,
    items: items.map((item) => ({
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      status: "active",
    })),
    orderType: parcelCharge > 0 ? "parcel" : "dinein",
    parcelCharge,
    discountPercent,
    discountAmountPaise: discountPaise,
    total: payablePaise / 100,
    status: "completed",
    collectedAt: new Date("2026-10-31T09:00:00Z"),
    createdAt: new Date("2026-10-31T08:30:00Z"),
    pickupTime: new Date("2026-10-31T09:15:00Z"),
    pickupMethod: "qr",
    paymentNote: "pay_audit",
    transactionId: "pay_audit_reference",
    razorpayPaymentId: "pay_audit",
    amountChargedPaise: payablePaise,
  };
}

const results = [];
const templateBytes = await masterPdf();

async function render(name, items, { wordsStyle, customerName } = {}) {
  const activeMapping = mapping(wordsStyle);
  const order = orderFrom(items);
  const style = await resolveAmountWordsStyle({
    mapping: activeMapping,
    templateBytes,
    pageIndex: 0,
  });
  const data = buildInvoiceData({
    order,
    shop: SHOP,
    customer: customerName ? { ...CUSTOMER, name: customerName } : CUSTOMER,
    mapping: activeMapping,
    invoiceNumber: "INV-well-b-000123",
    amountWordsStyle: style,
  });

  const rendered = await generateInvoicePdf({
    templateBytes,
    mapping: activeMapping,
    data,
  });

  const pdfPath = path.join(OUT, `${name}.pdf`);
  await fs.writeFile(pdfPath, rendered.bytes);
  execFileSync("pdftoppm", [
    "-png",
    "-r",
    "110",
    "-f",
    "1",
    "-l",
    String(rendered.pageCount),
    pdfPath,
    path.join(OUT, `${name}-page`),
  ]);

  results.push({
    name,
    pages: rendered.pageCount,
    style,
    amountInWords: data.totals.amountInWords,
    payable: data.totals.payableText,
    bytes: rendered.bytes.length,
  });
}

const burger = { name: "Veg Burger", price: 120, quantity: 2 };
const coffee = { name: "Filter Coffee", price: 35, quantity: 1 };
const dosa = { name: "Masala Dosa", price: 90, quantity: 1 };

// A. The reported defect: full suffix on a master that already prints it.
await render("audit-before-amount-words", [burger, coffee, dosa], { wordsStyle: "full" });
// B. Auto-detected suffix: the printed "Rupees only" is no longer repeated.
await render("audit-after-amount-words", [burger, coffee, dosa]);

// C. Layout cases.
await render("audit-01-item", [dosa]);
await render("audit-03-items", [burger, coffee, dosa]);
await render(
  "audit-10-items",
  Array.from({ length: 10 }, (_, index) => ({
    name: `Item ${index + 1}`,
    price: 45,
    quantity: 1,
  })),
);
await render(
  "audit-30-items",
  Array.from({ length: 30 }, (_, index) => ({
    name: `Canteen combo ${index + 1}`,
    price: 45,
    quantity: 1,
  })),
);
await render(
  "audit-long-values",
  [
    {
      name: "Special Grilled Paneer Tikka Masala with Butter Naan and Salad",
      price: 1234.56,
      quantity: 2,
    },
    { name: "Extra Long Item Name That Must Wrap Inside Its Row Without Overlap", price: 999.99, quantity: 1 },
  ],
  { customerName: "Aarav Sharmaa Venkatesh Subramaniam Iyer" },
);

// Self-checks: the pair must demonstrate the defect and its absence.
const before = results.find((entry) => entry.name === "audit-before-amount-words");
const after = results.find((entry) => entry.name === "audit-after-amount-words");
if (!/Only$/.test(before.amountInWords)) {
  throw new Error("before sample should carry our own suffix");
}
if (/Rupees|Only/i.test(after.amountInWords)) {
  throw new Error("after sample must not repeat the printed currency suffix");
}
if (!results.every((entry) => entry.pages >= 1)) {
  throw new Error("every sample must render at least one page");
}

console.log(JSON.stringify(results, null, 2));
console.log(`\nSamples written to ${path.relative(ROOT, OUT)}`);
