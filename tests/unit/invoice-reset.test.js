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
  `flashfoods-reset-test-${Date.now()}`,
);

const { Shop } = await import("../../models/Shop.js");
const { User } = await import("../../models/User.js");
const { Order } = await import("../../models/Order.js");
const { Invoice } = await import("../../models/Invoice.js");
const { InvoiceTemplate } = await import("../../models/InvoiceTemplate.js");
const { InvoiceCounter } = await import("../../models/InvoiceCounter.js");
const {
  activateVersion,
  createTemplateVersion,
  getBillingCardState,
  getVersionById,
  latestVersion,
  renderSampleInvoice,
  resetTemplate,
  saveMapping,
  visibleVersions,
} = await import("../../utils/invoice/template-service.js");
const { ensureInvoiceForOrder, resolveActiveTemplate } = await import(
  "../../utils/invoice/invoice-resolver.js"
);
const { fileExists, getFile, previewKey, templateKey } = await import(
  "../../utils/invoice/storage.js"
);

let mongo;
let customerId;
let shopSeq = 0;

async function freshShop() {
  shopSeq += 1;
  return Shop.create({
    name: `Reset Canteen ${shopSeq}`,
    slug: `reset-shop-${shopSeq}`,
    isOpen: true,
  });
}

let pdfSeq = 0;
async function makePdfBytes(label = "template") {
  pdfSeq += 1;
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  // Unique bytes per call: identical uploads are deduplicated by design.
  page.drawText(`RESET TEST ${label} ${pdfSeq}`, { x: 48, y: 800, size: 16 });
  return Buffer.from(await doc.save());
}

async function uploadVersion(shop, label = "template", bytes = null) {
  const created = await createTemplateVersion({
    shopId: shop._id,
    bytes: bytes || (await makePdfBytes(label)),
    originalFileName: `${label}.pdf`,
  });
  assert.equal(created.ok, true, created.reason);
  return created.version;
}

function mappingPayload() {
  return {
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
}

async function configure(shop, versionId) {
  const saved = await saveMapping({
    shopId: shop._id,
    versionId,
    rawMapping: mappingPayload(),
  });
  assert.equal(saved.ok, true, saved.reason);
}

async function preview(shop, versionId) {
  const shopDoc = await Shop.findById(shop._id).lean();
  const result = await renderSampleInvoice({ shopId: shop._id, versionId, shop: shopDoc });
  assert.equal(result.ok, true, result.reason);
  return result;
}

async function activate(shop, versionId) {
  const activated = await activateVersion({ shopId: shop._id, versionId });
  assert.equal(activated.ok, true, activated.reason);
}

async function configureAndActivate(shop, versionId) {
  await configure(shop, versionId);
  await preview(shop, versionId);
  await activate(shop, versionId);
}

function orderPayload(shop) {
  return {
    customer: customerId,
    shop: shop._id,
    items: [
      { name: "Veg Burger", price: 120, quantity: 2, status: "active" },
      { name: "Coffee", price: 35, quantity: 1, status: "active" },
    ],
    orderType: "dinein",
    discountPercent: 10,
    discountAmountPaise: 2750,
    total: 247.5,
    status: "completed",
    pickupOtp: "123456",
    collectedAt: new Date(),
    pickupMethod: "qr",
    paymentNote: "pay_test",
    transactionId: "pay_test",
    razorpayPaymentId: `pay_${new mongoose.Types.ObjectId().toString()}`,
    amountChargedPaise: 24750,
  };
}

async function issueInvoice(shop) {
  const order = await Order.create(orderPayload(shop));
  const result = await ensureInvoiceForOrder(order._id);
  assert.equal(result.ok, true, result.reason);
  return { order, invoice: result.invoice };
}

async function templateDoc(shop) {
  return InvoiceTemplate.findOne({ shop: shop._id }).lean();
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

  const student = await User.create({
    name: "Reset Student",
    email: "reset.student@example.com",
    passwordHash: "x",
    role: "student",
    phone: "9999999998",
  });
  customerId = student._id;
});

after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  await fs.rm(process.env.BILLING_STORAGE_DIR, { recursive: true, force: true });
});

// 1. Reset when no template exists.
test("reset with no template is a harmless no-op", async () => {
  const shop = await freshShop();
  const result = await resetTemplate({ shopId: shop._id });

  assert.equal(result.ok, true);
  assert.equal(result.reset, false);
  assert.equal(result.deletedFiles, 0);
  assert.deepEqual(result.cleanupErrors, []);
  assert.equal(await templateDoc(shop), null);
});

// 2. Reset when an uploaded template is unconfigured.
test("reset removes an uploaded but unconfigured template and its PDF", async () => {
  const shop = await freshShop();
  const version = await uploadVersion(shop, "unconfigured");
  assert.equal(await fileExists(version.originalFileKey), true);

  const result = await resetTemplate({ shopId: shop._id });

  assert.equal(result.ok, true);
  assert.equal(result.reset, true);
  assert.equal(result.removedVersions, 1);
  assert.equal(result.archivedVersions, 0);
  assert.equal(result.deletedFiles, 1);
  assert.deepEqual(result.cleanupErrors, []);
  assert.equal(await templateDoc(shop), null);
  assert.equal(await fileExists(version.originalFileKey), false);
  assert.equal((await getBillingCardState(shop._id)).state, "none");
});

// 3. Reset when a configured template exists.
test("reset removes a configured template and its field mappings", async () => {
  const shop = await freshShop();
  const version = await uploadVersion(shop, "configured");
  await configure(shop, version._id);

  const result = await resetTemplate({ shopId: shop._id });

  assert.equal(result.ok, true);
  assert.equal(result.removedVersions, 1);
  assert.equal(await templateDoc(shop), null);
  assert.equal(await fileExists(version.originalFileKey), false);
  assert.equal((await getBillingCardState(shop._id)).state, "none");
});

// 4. Reset when an active template exists.
test("reset deactivates and clears an active template pointer", async () => {
  const shop = await freshShop();
  const version = await uploadVersion(shop, "active");
  await configureAndActivate(shop, version._id);
  assert.equal((await resolveActiveTemplate(shop._id)).ok, true);

  const result = await resetTemplate({ shopId: shop._id });

  assert.equal(result.ok, true);
  const resolution = await resolveActiveTemplate(shop._id);
  assert.equal(resolution.ok, false);
  assert.equal(resolution.reason, "no_active_template");

  const card = await getBillingCardState(shop._id);
  assert.equal(card.state, "none");
  assert.equal(card.issuedCount, 0);
  assert.equal(await templateDoc(shop), null);
});

// 5. Reset with multiple template versions.
test("reset removes every version's source PDF", async () => {
  const shop = await freshShop();
  const versions = [
    await uploadVersion(shop, "multi-a"),
    await uploadVersion(shop, "multi-b"),
    await uploadVersion(shop, "multi-c"),
  ];
  await configure(shop, versions[2]._id);

  const result = await resetTemplate({ shopId: shop._id });

  assert.equal(result.ok, true);
  assert.equal(result.removedVersions, 3);
  for (const version of versions) {
    assert.equal(await fileExists(version.originalFileKey), false);
  }
  assert.equal(await templateDoc(shop), null);
});

// 6 + 8. Versions referenced by issued invoices are archived, never deleted.
test("a template version referenced by an issued invoice is archived and preserved", async () => {
  const shop = await freshShop();
  const version = await uploadVersion(shop, "referenced");
  await configureAndActivate(shop, version._id);
  const { invoice } = await issueInvoice(shop);

  const result = await resetTemplate({ shopId: shop._id });

  assert.equal(result.ok, true);
  assert.equal(result.archivedVersions, 1);
  assert.equal(result.removedVersions, 0);
  assert.equal(result.preservedFiles, 1);
  // Only the derived sample preview is deleted; the archived source PDF stays.
  assert.equal(result.deletedFiles, 1);

  const template = await templateDoc(shop);
  assert.ok(template, "the archive record must survive a reset");
  assert.equal(template.currentVersionId, null);
  assert.equal(template.versions.length, 1);
  const archived = template.versions[0];
  assert.equal(String(archived._id), String(version._id));
  assert.equal(archived.status, "archived");
  assert.ok(archived.archivedAt);
  assert.equal(archived.mapping, null);
  assert.equal(archived.mappingHash, "");
  assert.equal(archived.previewMappingHash, "");
  assert.equal(archived.previewedAt, null);
  assert.equal(archived.originalFileKey, version.originalFileKey);

  // The original PDF is intact, but the revision is gone from the working set.
  assert.equal(await fileExists(version.originalFileKey), true);
  assert.equal(visibleVersions(template).length, 0);
  assert.equal(latestVersion(template), null);
  assert.equal(getVersionById(template, version._id), null);
  assert.ok(getVersionById(template, version._id, { includeArchived: true }));
  assert.equal((await getBillingCardState(shop._id)).state, "none");
  assert.equal((await resolveActiveTemplate(shop._id)).reason, "no_active_template");

  // Historical invoice data is untouched and still downloadable/verifiable.
  const stored = await Invoice.findOne({ order: invoice.order }).lean();
  assert.equal(stored.number, invoice.number);
  assert.equal(stored.storageKey, invoice.storageKey);
  const bytes = await getFile(stored.storageKey);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  const again = await ensureInvoiceForOrder(invoice.order);
  assert.equal(again.ok, true, again.reason);
  assert.equal(again.invoice.number, invoice.number);
  assert.deepEqual(again.bytes, bytes);
  assert.equal(await Invoice.countDocuments({ shop: shop._id }), 1);
});

// 7. Mixed referenced/unreferenced versions.
test("reset deletes unreferenced sources and archives referenced ones", async () => {
  const shop = await freshShop();
  const referenced = await uploadVersion(shop, "mixed-referenced");
  await configureAndActivate(shop, referenced._id);
  await issueInvoice(shop);
  const unreferenced = await uploadVersion(shop, "mixed-unreferenced");

  const result = await resetTemplate({ shopId: shop._id });

  assert.equal(result.ok, true);
  assert.equal(result.archivedVersions, 1);
  assert.equal(result.removedVersions, 1);
  assert.equal(await fileExists(referenced.originalFileKey), true);
  assert.equal(await fileExists(unreferenced.originalFileKey), false);

  const template = await templateDoc(shop);
  assert.equal(template.versions.length, 1);
  assert.equal(String(template.versions[0]._id), String(referenced._id));
  assert.equal(template.currentVersionId, null);
});

// 9. Sample/preview PDFs are removed; the source they were rendered from is not
// needed by any issued invoice.
test("reset removes stale sample previews", async () => {
  const shop = await freshShop();
  const version = await uploadVersion(shop, "previewed");
  await configure(shop, version._id);
  await preview(shop, version._id);

  const template = await templateDoc(shop);
  const key = previewKey(
    shop._id,
    template._id,
    version.version,
    template.versions[0].mappingHash,
  );
  assert.equal(await fileExists(key), true);

  const result = await resetTemplate({ shopId: shop._id });

  assert.equal(result.ok, true);
  assert.equal(await fileExists(key), false);
  assert.equal(result.deletedFiles, 2); // original PDF + preview
});

// 10. Invoice numbering continues from the preserved counter.
test("reset never reuses or resets invoice numbers", async () => {
  const shop = await freshShop();
  const first = await uploadVersion(shop, "counter-first");
  await configureAndActivate(shop, first._id);
  const firstInvoice = await issueInvoice(shop);

  await resetTemplate({ shopId: shop._id });

  const counterAfterReset = await InvoiceCounter.findOne({ shop: shop._id }).lean();
  assert.equal(counterAfterReset.seq, 1);

  const second = await uploadVersion(shop, "counter-second");
  await configureAndActivate(shop, second._id);
  const secondInvoice = await issueInvoice(shop);

  assert.match(firstInvoice.invoice.number, /000001$/);
  assert.match(secondInvoice.invoice.number, /000002$/);
  const counter = await InvoiceCounter.findOne({ shop: shop._id }).lean();
  assert.equal(counter.seq, 2);
});

// 11. Another shop's templates are never touched.
test("reset only affects the calling shop", async () => {
  const shopA = await freshShop();
  const shopB = await freshShop();

  const versionA = await uploadVersion(shopA, "shop-a");
  await configureAndActivate(shopA, versionA._id);
  const versionB = await uploadVersion(shopB, "shop-b");
  await configureAndActivate(shopB, versionB._id);

  const result = await resetTemplate({ shopId: shopA._id });
  assert.equal(result.ok, true);

  assert.equal(await templateDoc(shopA), null);
  const templateB = await templateDoc(shopB);
  assert.ok(templateB);
  assert.ok(templateB.currentVersionId);
  assert.equal(String(templateB.currentVersionId), String(versionB._id));
  assert.equal(templateB.versions[0].status, "active");
  assert.equal(await fileExists(versionB.originalFileKey), true);
  assert.equal((await resolveActiveTemplate(shopB._id)).ok, true);
});

// 12. Orders (and the data behind the default order bill) are unchanged.
test("reset leaves orders and invoice financial records untouched", async () => {
  const shop = await freshShop();
  const version = await uploadVersion(shop, "orders");
  await configureAndActivate(shop, version._id);
  const { order, invoice } = await issueInvoice(shop);

  const beforeOrder = await Order.findById(order._id).lean();
  const beforeInvoice = await Invoice.findById(invoice._id).lean();

  await resetTemplate({ shopId: shop._id });

  const afterOrder = await Order.findById(order._id).lean();
  const afterInvoice = await Invoice.findById(invoice._id).lean();
  assert.deepEqual(afterOrder, beforeOrder);
  assert.deepEqual(afterInvoice, beforeInvoice);
  assert.equal(await Order.countDocuments({ shop: shop._id }), 1);
});

// 13. Repeated resets are harmless (archived state and fully-removed state).
test("repeated reset requests do not corrupt or remove anything", async () => {
  const shop = await freshShop();
  const version = await uploadVersion(shop, "repeat");
  await configureAndActivate(shop, version._id);
  const { invoice } = await issueInvoice(shop);

  const first = await resetTemplate({ shopId: shop._id });
  const second = await resetTemplate({ shopId: shop._id });
  const third = await resetTemplate({ shopId: shop._id });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, true);
  assert.equal(second.deletedFiles, 0);
  assert.equal(third.deletedFiles, 0);
  assert.equal(second.archivedVersions, 1);
  assert.equal(third.archivedVersions, 1);
  assert.equal(await fileExists(version.originalFileKey), true);
  assert.equal(await Invoice.countDocuments({ order: invoice.order }), 1);
  assert.equal((await templateDoc(shop)).versions.length, 1);

  const removedShop = await freshShop();
  await uploadVersion(removedShop, "repeat-removed");
  await resetTemplate({ shopId: removedShop._id });
  const again = await resetTemplate({ shopId: removedShop._id });
  assert.equal(again.ok, true);
  assert.equal(again.reset, false);
});

// 14. A storage failure cannot leave a template marked active.
test("a cleanup failure still leaves a consistent, non-active template", async () => {
  const shop = await freshShop();
  const version = await uploadVersion(shop, "cleanup-failure");
  await configureAndActivate(shop, version._id);

  const failingStorage = {
    sweep: async () => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    },
  };

  const result = await resetTemplate({ shopId: shop._id, storage: failingStorage });

  assert.equal(result.ok, true);
  assert.equal(result.cleanupErrors.length > 0, true);
  assert.equal(result.cleanupErrors.every((code) => code === "EACCES"), true);
  assert.equal(result.deletedFiles, 0);
  assert.equal((await resolveActiveTemplate(shop._id)).ok, false);
  assert.equal((await getBillingCardState(shop._id)).state, "none");

  // The files are now unreferenced. A later reset with a healthy backend
  // finishes the cleanup, which is what makes the failure recoverable.
  assert.equal(await fileExists(version.originalFileKey), true);
  const retried = await resetTemplate({ shopId: shop._id });
  assert.equal(retried.ok, true);
  assert.equal(retried.deletedFiles >= 1, true);
  assert.deepEqual(retried.cleanupErrors, []);
  assert.equal(await fileExists(version.originalFileKey), false);
  assert.equal(await templateDoc(shop), null);
});

// 15. A post-reset upload of the archived PDF is a fresh template, not a
// duplicate of history.
test("the archived revision's PDF can be uploaded again after a reset", async () => {
  const shop = await freshShop();
  const bytes = await makePdfBytes("reupload");
  const version = await uploadVersion(shop, "reupload-1", bytes);
  await configureAndActivate(shop, version._id);
  await issueInvoice(shop);

  await resetTemplate({ shopId: shop._id });

  const again = await createTemplateVersion({
    shopId: shop._id,
    bytes,
    originalFileName: "reupload-2.pdf",
  });

  assert.equal(again.ok, true, again.reason);
  assert.equal(again.duplicate, false);
  assert.notEqual(String(again.version._id), String(version._id));
  const template = await templateDoc(shop);
  assert.equal(visibleVersions(template).length, 1);
  assert.equal(template.versions.find((v) => v.status === "archived").sha256, version.sha256);
});

// 16. The storage key layout is exactly what the reset cleanup targets.
test("reset cleanup is scoped to this shop's template and preview directories", async () => {
  const shop = await freshShop();
  const version = await uploadVersion(shop, "layout");
  const template = await templateDoc(shop);
  assert.equal(
    version.originalFileKey,
    templateKey(shop._id, template._id, version.version, version.sha256),
  );

  const otherShop = await freshShop();
  const otherVersion = await uploadVersion(otherShop, "layout-other");

  await resetTemplate({ shopId: shop._id });

  assert.equal(await fileExists(version.originalFileKey), false);
  assert.equal(await fileExists(otherVersion.originalFileKey), true);
});
