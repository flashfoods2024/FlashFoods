// Renders the realistic field-fitting cases to temp/billing-e2e/fit-*.pdf so the
// output can be inspected visually (long values, small/large totals, overflow
// into a continuation page). Uses the real generator, Roboto assets and a clean
// master template; no database is involved.
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildSampleData } from "../utils/invoice/invoice-data.js";
import { generateInvoicePdf } from "../utils/invoice/invoice-generator.js";

const OUT = path.join(process.cwd(), "temp", "billing-e2e");
fs.mkdirSync(OUT, { recursive: true });

const W = 595;
const H = 842;

const templateDoc = await PDFDocument.create();
const page = templateDoc.addPage([W, H]);
const base = await templateDoc.embedFont(StandardFonts.HelveticaBold);
const small = await templateDoc.embedFont(StandardFonts.Helvetica);
page.drawText("WELL B CANTEEN", { x: 48, y: 792, size: 18, font: base });
page.drawText("GSTIN: 29ABCDE1234F1Z5", { x: 48, y: 774, size: 9, font: small });
page.drawText("TAX INVOICE", { x: 470, y: 792, size: 12, font: base });
page.drawText("Invoice No:", { x: 48, y: 760, size: 9, font: small });
page.drawText("Date:", { x: 48, y: 744, size: 9, font: small });
page.drawText("Bill To:", { x: 48, y: 720, size: 9, font: small });
for (const [label, x] of [["Item", 48], ["Qty", 300], ["Rate", 360], ["Amount", 445]]) {
  page.drawText(label, { x, y: 590, size: 9, font: small });
}
for (const [label, y] of [["Subtotal:", 260], ["Discount:", 244], ["Parcel:", 228], ["Total:", 200]]) {
  page.drawText(label, { x: 330, y, size: 9, font: small });
}
page.drawText("Amount in words:", { x: 48, y: 178, size: 8, font: small });
page.drawText("Declaration: goods once sold are not returnable.", { x: 48, y: 60, size: 8, font: small });
const templateBytes = Buffer.from(await templateDoc.save());

const f = (x, y, align, fontSize, maxWidth, maxLines, font = "regular") => ({
  x,
  y,
  align,
  fontSize,
  font,
  maxWidth,
  maxLines,
  lineHeight: Number((fontSize * 1.25).toFixed(3)),
  truncate: false,
});

const mapping = {
  schemaVersion: 1,
  page: 0,
  taxMode: "none",
  cgstRateBp: 0,
  sgstRateBp: 0,
  constants: { sellerNote: "", termsText: "" },
  fields: {
    invoiceNumber: f(547, 746, "right", 10, 460, 1, "bold"),
    invoiceDate: f(547, 728, "right", 9, 140, 1),
    customerName: f(48, 692, "left", 10, 200, 2, "medium"),
    subtotal: f(547, 260, "right", 9, 140, 1),
    discount: f(547, 244, "right", 9, 140, 1),
    parcelCharge: f(547, 228, "right", 9, 140, 1),
    total: f(547, 200, "right", 12, 160, 1, "bold"),
    amountInWords: f(48, 160, "left", 9, 460, 3),
  },
  itemTable: {
    originX: 48,
    originY: 542,
    rowHeight: 22,
    maxRowsFirstPage: 10,
    baselineOffsetFromRowTop: 11,
    columns: [
      { key: "description", x: 48, width: 240, align: "left", fontSize: 9, maxLines: 2 },
      { key: "quantity", x: 300, width: 40, align: "center", fontSize: 9, maxLines: 1 },
      { key: "unitRate", x: 360, width: 70, align: "right", fontSize: 9, maxLines: 1 },
      { key: "lineAmount", x: 445, width: 102, align: "right", fontSize: 9, maxLines: 1 },
    ],
    continuation: { originY: 732, bottomMargin: 60, showPageNumbers: true },
  },
  continuationTotals: {
    subtotal: f(547, 180, "right", 9, 140, 1),
    total: f(547, 150, "right", 12, 160, 1, "bold"),
    amountInWords: f(48, 110, "left", 9, 460, 3),
  },
};

const shop = { _id: "shop1", name: "Well B", slug: "well-b" };
const text = (rupees, paise = 0) => {
  const value = rupees + paise / 100;
  return `\u20B9${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const scenarios = [
  {
    name: "long-values",
    customer: "Ananya Krishnamurthy Venkatesan Subramaniam",
    number: "INV-well-b-000123",
    lines: [
      { description: "Paneer Butter Masala with two extra tandoori rotis and salad", quantity: 2, rate: 24500 },
      { description: "Masala Dosa", quantity: 1, rate: 9000 },
    ],
    subtotal: 58000,
    discount: 5800,
    parcel: 2000,
    total: 54200,
    words: "Five Hundred Forty Two Rupees Only",
  },
  {
    name: "large-total",
    customer: "Rahul Sharma",
    number: "INV-well-b-000999",
    lines: [
      { description: "Catering package (100 plates)", quantity: 100, rate: 12300 },
      { description: "Service charge", quantity: 1, rate: 4567 },
    ],
    subtotal: 1234567,
    discount: 0,
    parcel: 0,
    total: 1234567,
    words: "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees Only",
  },
  {
    name: "small-total",
    customer: "Meera",
    number: "INV-well-b-000001",
    lines: [{ description: "Tea", quantity: 1, rate: 850 }],
    subtotal: 850,
    discount: 0,
    parcel: 0,
    total: 850,
    words: "Eight Rupees and Fifty Paise Only",
  },
];

const results = [];

for (const scenario of scenarios) {
  const data = buildSampleData({ shop, mapping });
  data.customer.name = scenario.customer;
  data.invoice.number = scenario.number;
  data.lines = scenario.lines.map((line, index) => ({
    index: index + 1,
    description: line.description,
    quantity: line.quantity,
    unitRatePaise: line.rate,
    lineAmountPaise: line.rate * line.quantity,
    unitRateText: text(line.rate / 100),
    lineAmountText: text((line.rate * line.quantity) / 100),
    foodType: "",
  }));
  data.totals.foodSubtotalText = text(scenario.subtotal / 100);
  data.totals.discountPaise = scenario.discount;
  data.totals.discountText = scenario.discount ? `-\u20B9${(scenario.discount / 100).toFixed(2)}` : "";
  data.totals.parcelChargePaise = scenario.parcel;
  data.totals.parcelChargeText = scenario.parcel ? text(scenario.parcel / 100) : "";
  data.totals.payableText = text(scenario.total / 100);
  data.totals.amountInWords = scenario.words;

  const rendered = await generateInvoicePdf({ templateBytes, mapping, data });
  const file = path.join(OUT, `fit-${scenario.name}.pdf`);
  fs.writeFileSync(file, rendered.bytes);
  results.push({ scenario: scenario.name, file, pages: rendered.pageCount, bytes: rendered.bytes.length });
}

// 30 long items must flow onto a labelled continuation page with totals.
const manyData = buildSampleData({ shop, mapping });
manyData.customer.name = "Kavya Raghunathan Iyer";
manyData.invoice.number = "INV-well-b-000777";
manyData.lines = Array.from({ length: 30 }, (_, index) => ({
  index: index + 1,
  description: `Assorted snack box number ${index + 1} with a long printed description`,
  quantity: (index % 3) + 1,
  unitRatePaise: 4500 + index * 25,
  lineAmountPaise: (4500 + index * 25) * ((index % 3) + 1),
  unitRateText: text((4500 + index * 25) / 100),
  lineAmountText: text(((4500 + index * 25) * ((index % 3) + 1)) / 100),
  foodType: "",
}));
manyData.totals.payableText = text(123456.78);
manyData.totals.amountInWords =
  "One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees and Seventy Eight Paise Only";
const many = await generateInvoicePdf({ templateBytes, mapping, data: manyData });
const manyFile = path.join(OUT, "fit-many-items.pdf");
fs.writeFileSync(manyFile, many.bytes);
results.push({ scenario: "many-items", file: manyFile, pages: many.pageCount, bytes: many.bytes.length });

console.log(JSON.stringify({ results }, null, 2));
