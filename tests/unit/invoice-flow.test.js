import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { PDFDocument } from "pdf-lib";
import { MongoMemoryServer } from "mongodb-memory-server-core";

process.env.BILLING_STORAGE_DIR = path.join(
  os.tmpdir(),
  `flashfoods-billing-test-${Date.now()}`,
);

const { Shop } = await import("../../models/Shop.js");
const { User } = await import("../../models/User.js");
const { Order } = await import("../../models/Order.js");
const { Invoice } = await import("../../models/Invoice.js");
const { InvoiceTemplate } = await import("../../models/InvoiceTemplate.js");
const { InvoiceCounter } = await import("../../models/InvoiceCounter.js");
const { createTemplateVersion, saveMapping, renderSampleInvoice, activateVersion } =
  await import("../../utils/invoice/template-service.js");
const { ensureInvoiceForOrder } = await import("../../utils/invoice/invoice-resolver.js");
const { getFile } = await import("../../utils/invoice/storage.js");

let mongo;
let shopId;
let customerId;

let templateCounter = 0;

async function makeTemplateBytes() {
  templateCounter += 1;
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  // Unique content per call so repeated uploads produce distinct template
  // hashes (the upload path deduplicates identical files by design).
  page.drawText(`CANTEEN INVOICE v${templateCounter}`, { x: 48, y: 800, size: 16 });
  return Buffer.from(await doc.save());
}

async function createTemplateAndActivate(slug = "well-b") {
  const bytes = await makeTemplateBytes();
  const created = await createTemplateVersion({
    shopId,
    bytes,
    originalFileName: "invoice.pdf",
  });
  assert.equal(created.ok, true, created.reason);

  const rawMapping = {
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
      maxRowsFirstPage: 10,
      baselineOffsetFromRowTop: 11,
      columns: [
        { key: "description", x: 48, width: 260, align: "left", fontSize: 9, maxLines: 2 },
        { key: "quantity", x: 308, width: 48, align: "center", fontSize: 9, maxLines: 1 },
        { key: "unitRate", x: 356, width: 72, align: "right", fontSize: 9, maxLines: 1 },
        { key: "lineAmount", x: 428, width: 90, align: "right", fontSize: 9, maxLines: 1 },
      ],
    },
    continuationTotals: {
      subtotal: { x: 420, y: 180, align: "right", fontSize: 9, font: "regular", maxWidth: 140, maxLines: 1 },
      total: { x: 420, y: 150, align: "right", fontSize: 12, font: "bold", maxWidth: 160, maxLines: 1 },
      amountInWords: { x: 48, y: 110, align: "left", fontSize: 9, font: "regular", maxWidth: 400, maxLines: 3 },
    },
  };

  const saved = await saveMapping({
    shopId,
    versionId: created.version._id,
    rawMapping,
  });
  assert.equal(saved.ok, true, saved.reason);

  const shop = await Shop.findById(shopId).lean();
  const preview = await renderSampleInvoice({
    shopId,
    versionId: created.version._id,
    shop,
  });
  assert.equal(preview.ok, true, preview.reason);

  const activated = await activateVersion({
    shopId,
    versionId: created.version._id,
  });
  assert.equal(activated.ok, true, activated.reason);

  return { created, shop };
}

function orderPayload({ status = "completed", collectedAt = new Date(), total = 247.5 } = {}) {
  return {
    customer: customerId,
    shop: shopId,
    items: [
      { name: "Veg Burger", price: 120, quantity: 2, status: "active" },
      { name: "Coffee", price: 35, quantity: 1, status: "active" },
    ],
    orderType: "dinein",
    discountPercent: 10,
    discountAmountPaise: 2750,
    total,
    status,
    pickupOtp: "123456",
    collectedAt,
    pickupMethod: "qr",
    paymentNote: "pay_test",
    transactionId: "pay_test",
    razorpayPaymentId: `pay_${new mongoose.Types.ObjectId().toString()}`,
    amountChargedPaise: Math.round(total * 100),
  };
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    Shop.init(),
    User.init(),
    Order.init(),
    Invoice.init(),
    InvoiceTemplate.init(),
    InvoiceCounter.init(),
  ]);

  const shop = await Shop.create({ name: "Well B", slug: "well-b" });
  shopId = shop._id;
  const student = await User.create({
    name: "Aarav Sharma",
    email: "aarav@example.com",
    passwordHash: "x",
    role: "student",
    phone: "9999999999",
  });
  customerId = student._id;
});

after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  await fs.rm(process.env.BILLING_STORAGE_DIR, { recursive: true, force: true });
});

test("template upload, mapping, sample preview and activation", async () => {
  const { created, shop } = await createTemplateAndActivate();
  assert.equal(created.version.pageCount, 1);
  assert.equal(created.version.status, "uploaded");

  const stored = await SaleStorageRead();
  assert.equal(stored.length > 0, true);

  const template = await InvoiceTemplate.findOne({ shop: shopId }).lean();
  assert.ok(template.currentVersionId);
  const active = template.versions.find(
    (version) => String(version._id) === String(template.currentVersionId),
  );
  assert.equal(active.status, "active");
  assert.ok(active.mappingHash);
  assert.equal(shop.slug, "well-b");
});

async function SaleStorageRead() {
  const template = await InvoiceTemplate.findOne({ shop: shopId }).lean();
  const version = template.versions[template.versions.length - 1];
  return getFile(version.originalFileKey);
}

test("eligible completed order issues exactly one invoice", async () => {
  await createTemplateAndActivate();
  const order = await Order.create(orderPayload());

  const first = await ensureInvoiceForOrder(order._id);
  assert.equal(first.ok, true, first.reason);
  assert.equal(first.created, true);
  assert.match(first.invoice.number, /^INV-well-b-\d{6}$/);
  assert.equal(first.invoice.pageCount, 1);
  assert.ok(first.invoice.snapshot.totals.payablePaise === 24750);

  const bytes = await getFile(first.invoice.storageKey);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");

  const second = await ensureInvoiceForOrder(order._id);
  assert.equal(second.ok, true);
  assert.equal(String(second.invoice._id), String(first.invoice._id));
  assert.equal(second.invoice.number, first.invoice.number);
  assert.equal(await Invoice.countDocuments({ order: order._id }), 1);
});

test("concurrent ensure calls never duplicate an invoice or number", async () => {
  await createTemplateAndActivate();
  const order = await Order.create(orderPayload());

  const results = await Promise.all(
    Array.from({ length: 6 }, () => ensureInvoiceForOrder(order._id)),
  );
  assert.equal(results.every((result) => result.ok), true);
  const ids = new Set(results.map((result) => String(result.invoice._id)));
  assert.equal(ids.size, 1);
  assert.equal(await Invoice.countDocuments({ order: order._id }), 1);
});

test("unpaid, uncollected and cancelled orders are never invoiced", async () => {
  await createTemplateAndActivate();
  const cases = [
    { status: "paid", collectedAt: null, reason: "not_completed" },
    { status: "ready_for_pickup", collectedAt: null, reason: "not_completed" },
    { status: "cancelled", collectedAt: null, reason: "not_completed" },
    { status: "completed", collectedAt: null, reason: "not_collected" },
  ];

  for (const item of cases) {
    const order = await Order.create(
      orderPayload({ status: item.status, collectedAt: item.collectedAt }),
    );
    const result = await ensureInvoiceForOrder(order._id);
    assert.equal(result.ok, false);
    assert.equal(result.reason, item.reason, `status ${item.status}`);
    assert.equal(await Invoice.countDocuments({ order: order._id }), 0);
  }
});

test("completed order without captured payment evidence is rejected", async () => {
  await createTemplateAndActivate();
  const order = await Order.create({
    ...orderPayload(),
    paymentNote: "pending",
    transactionId: "",
    razorpayPaymentId: undefined,
    amountChargedPaise: null,
  });
  const result = await ensureInvoiceForOrder(order._id);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "payment_not_verified");
});

test("shop without an active template issues no invoice", async () => {
  const otherShop = await Shop.create({ name: "Other Canteen", slug: "other" });
  const order = await Order.create({
    ...orderPayload(),
    shop: otherShop._id,
  });
  const result = await ensureInvoiceForOrder(order._id);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_active_template");
  assert.equal(await Invoice.countDocuments({ order: order._id }), 0);

  const template = await InvoiceTemplate.findOne({ shop: otherShop._id }).lean();
  assert.equal(template, null);
});

test("invoice numbers are unique and shop-scoped", async () => {
  await createTemplateAndActivate();
  const numbers = [];
  for (let index = 0; index < 3; index += 1) {
    const order = await Order.create(orderPayload());
    const result = await ensureInvoiceForOrder(order._id);
    assert.equal(result.ok, true, result.reason);
    numbers.push(result.invoice.number);
  }
  assert.equal(new Set(numbers).size, 3);
});

test("issued invoices are immutable and survive template replacement", async () => {
  await createTemplateAndActivate();
  const order = await Order.create(orderPayload());
  const issued = await ensureInvoiceForOrder(order._id);
  assert.equal(issued.ok, true);

  await assert.rejects(() =>
    Invoice.updateOne({ _id: issued.invoice._id }, { $set: { number: "HACKED" } }),
  );

  const before = await getFile(issued.invoice.storageKey);

  // A replacement template must not change the issued invoice.
  await createTemplateAndActivate();
  const again = await ensureInvoiceForOrder(order._id);
  assert.equal(again.ok, true);
  assert.equal(String(again.invoice._id), String(issued.invoice._id));
  assert.equal(again.invoice.number, issued.invoice.number);
  const afterBytes = await getFile(issued.invoice.storageKey);
  assert.deepEqual(afterBytes, before);
});

test("removing the template keeps issued invoices downloadable", async () => {
  const { removeTemplate } = await import("../../utils/invoice/template-service.js");
  await createTemplateAndActivate();
  const order = await Order.create(orderPayload());
  const issued = await ensureInvoiceForOrder(order._id);
  assert.equal(issued.ok, true);

  const removed = await removeTemplate(shopId);
  assert.equal(removed.ok, true);

  const invoice = await Invoice.findOne({ order: order._id }).lean();
  assert.ok(invoice);
  const bytes = await getFile(invoice.storageKey);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");

  const newOrder = await Order.create(orderPayload());
  const result = await ensureInvoiceForOrder(newOrder._id);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_active_template");
});
