/**
 * Isolated QA harness for the billing-template HTTP flow.
 *
 * Starts an in-memory MongoDB, seeds a vendor (with shop) and a student with a
 * completed order, then boots the real application against that database.
 * Nothing here touches the configured MONGO_URI or any external service.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.QA_PORT || 3125);
const FIXTURE_FILE = path.join(ROOT, "temp", "qa-billing-fixture.json");

const fileUrl = (relPath) => pathToFileURL(path.join(ROOT, relPath)).href;

const { MongoMemoryServer } = await import("mongodb-memory-server-core");
const mongo = await MongoMemoryServer.create();
const uri = mongo.getUri();

process.env.MONGO_URI = uri;
process.env.MONGODB_URI = uri;
process.env.PORT = String(PORT);
process.env.SESSION_SECRET = "qa-billing-secret";
process.env.BILLING_STORAGE_DIR = path.join(ROOT, "temp", "qa-billing-storage");

// Hard-disable every external integration before server.js (and dotenv) load:
// dotenv does not override already-set keys, so these blank values keep FCM,
// email, Cloudinary, and all payment gateways inert for the whole run.
for (const key of [
  "FIREBASE_SERVICE_ACCOUNT_KEY",
  "RESEND_API_KEY",
  "GEMINI_API_KEY",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "EASEBUZZ_MERCHANT_KEY",
  "EASEBUZZ_SALT",
  "PHONEPE_CLIENT_ID",
  "PHONEPE_CLIENT_SECRET",
  "PHONEPE_CLIENT_VERSION",
]) {
  process.env[key] = "";
}

if (!process.env.NODE_ENV) process.env.NODE_ENV = "development";

const mongoose = (await import("mongoose")).default;
// Connect before seeding: model writes must not buffer waiting for server.js.
await mongoose.connect(uri);
const bcrypt = (await import("bcryptjs")).default;
const { Shop } = await import(fileUrl("models/Shop.js"));
const { User } = await import(fileUrl("models/User.js"));
const { Order } = await import(fileUrl("models/Order.js"));
const { MenuItem } = await import(fileUrl("models/MenuItem.js"));

const VENDOR_EMAIL = "qa.billing.vendor@flashfoods.test";
const STUDENT_EMAIL = "qa.billing.student@flashfoods.test";
const OTHER_STUDENT_EMAIL = "qa.billing.student2@flashfoods.test";
const PASSWORD = "QaPass123!";

const passwordHash = await bcrypt.hash(PASSWORD, 10);

// The billing end-to-end flow MUST run on the real "Testing" shop: the
// application hard-blocks mock checkout for every slug except "testing"
// (routes/orders.js), so this fixture preserves that exact restriction.
const shop = await Shop.create({
  name: "Testing",
  slug: "testing",
  vendor: null,
  isOpen: true,
});

// Variants carry the price the cart/checkout actually charges, so keep them in
// sync with `price` (the schema default variant is priced at 0).
const burger = await MenuItem.create({
  shop: shop._id,
  name: "QA Burger",
  price: 120,
  category: "Snacks",
  available: true,
  variants: [{ label: "Regular", price: 120 }],
});
const coffee = await MenuItem.create({
  shop: shop._id,
  name: "QA Coffee",
  price: 35,
  category: "Beverages",
  available: true,
  variants: [{ label: "Regular", price: 35 }],
});

const vendor = await User.create({
  name: "Testing Vendor",
  email: VENDOR_EMAIL,
  passwordHash,
  role: "vendor",
  shop: shop._id,
});
shop.vendor = vendor._id;
await shop.save();

const student = await User.create({
  name: "Testing Student",
  email: STUDENT_EMAIL,
  passwordHash,
  role: "student",
  phone: "9876543210",
});

// A second student owns no orders: proves cross-student invoice access is
// refused even though the account is a valid student.
const otherStudent = await User.create({
  name: "QA Other Student",
  email: OTHER_STUDENT_EMAIL,
  passwordHash,
  role: "student",
  phone: "9876500001",
});

const completedOrder = await Order.create({
  customer: student._id,
  shop: shop._id,
  items: [
    { name: "Veg Burger", price: 120, quantity: 2, status: "active" },
    { name: "Filter Coffee", price: 35, quantity: 1, status: "active" },
  ],
  orderType: "parcel",
  parcelCharge: 10,
  discountPercent: 10,
  discountAmountPaise: 2750,
  total: 257.5,
  status: "completed",
  pickupOtp: "445566",
  collectedAt: new Date(),
  pickupMethod: "qr",
  paymentNote: "pay_qa_billing",
  transactionId: "pay_qa_billing",
  razorpayPaymentId: "pay_qa_billing",
  amountChargedPaise: 25750,
});

// A competing vendor/shop with no billing template: proves cross-vendor
// template access is refused.
const shopTwo = await Shop.create({ name: "QA Second Canteen", slug: "qa-second" });
const vendorTwo = await User.create({
  name: "QA Second Vendor",
  email: "qa.billing.vendor2@flashfoods.test",
  passwordHash,
  role: "vendor",
  shop: shopTwo._id,
});
shopTwo.vendor = vendorTwo._id;
await shopTwo.save();

// A second shop with a completed order but no billing template: the student
// must keep the existing default order bill and get no custom invoice.
const plainShop = await Shop.create({ name: "QA Plain Canteen", slug: "qa-plain" });
const plainVendor = await User.create({
  name: "QA Plain Vendor",
  email: "qa.billing.plain@flashfoods.test",
  passwordHash,
  role: "vendor",
  shop: plainShop._id,
});
plainShop.vendor = plainVendor._id;
await plainShop.save();
const plainOrder = await Order.create({
  customer: student._id,
  shop: plainShop._id,
  items: [{ name: "Plain Item", price: 40, quantity: 1, status: "active" }],
  orderType: "dinein",
  total: 40,
  status: "completed",
  pickupOtp: "112233",
  collectedAt: new Date(),
  pickupMethod: "otp",
  paymentNote: "pay_qa_plain",
  transactionId: "pay_qa_plain",
  razorpayPaymentId: "pay_qa_plain",
  amountChargedPaise: 4000,
});

fs.mkdirSync(path.join(ROOT, "temp"), { recursive: true });
fs.writeFileSync(
  FIXTURE_FILE,
  JSON.stringify(
    {
      port: PORT,
      vendorEmail: VENDOR_EMAIL,
      vendor2Email: "qa.billing.vendor2@flashfoods.test",
      plainVendorEmail: "qa.billing.plain@flashfoods.test",
      studentEmail: STUDENT_EMAIL,
      otherStudentEmail: OTHER_STUDENT_EMAIL,
      otherStudentId: String(otherStudent._id),
      password: PASSWORD,
      baseUrl: `http://127.0.0.1:${PORT}`,
      shopId: String(shop._id),
      shopSlug: shop.slug,
      shopName: shop.name,
      vendorName: "Testing Vendor",
      completedOrderId: String(completedOrder._id),
      plainOrderId: String(plainOrder._id),
      menuItemIds: [String(burger._id), String(coffee._id)],
    },
    null,
    2,
  ),
);

// Optional seed for tests/e2e/view-invoice.spec.js: an activated template plus
// one already-issued invoice on the seeded completed order, produced through
// the real template-service and resolver (not by inserting a fake record).
// Billing-template.spec.js must NOT run against this mode, because it asserts
// the first-upload state of a fresh shop.
if (process.env.QA_BILLING_SEED === "invoice-view") {
  const { PDFDocument } = await import("pdf-lib");
  const { createTemplateVersion, saveMapping, renderSampleInvoice, activateVersion } =
    await import(fileUrl("utils/invoice/template-service.js"));
  const { ensureInvoiceForOrder } = await import(
    fileUrl("utils/invoice/invoice-resolver.js")
  );

  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawText("TESTING CANTEEN", { x: 48, y: 792, size: 16 });
  page.drawText("Tax Invoice", { x: 470, y: 792, size: 12 });
  page.drawText("Invoice No:", { x: 48, y: 760, size: 9 });
  page.drawText("Total:", { x: 330, y: 200, size: 11 });
  const templateBytes = Buffer.from(await doc.save());

  const created = await createTemplateVersion({
    shopId: shop._id,
    bytes: templateBytes,
    originalFileName: "qa-invoice-template.pdf",
  });
  if (!created.ok) throw new Error(`QA template upload failed: ${created.reason}`);

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
        { key: "serial", x: 48, width: 24, align: "left", fontSize: 9, maxLines: 1 },
        { key: "description", x: 72, width: 236, align: "left", fontSize: 9, maxLines: 2 },
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
    shopId: shop._id,
    versionId: created.version._id,
    rawMapping,
  });
  if (!saved.ok) throw new Error(`QA mapping failed: ${saved.reason}`);

  const shopDoc = await Shop.findById(shop._id).lean();
  const preview = await renderSampleInvoice({
    shopId: shop._id,
    versionId: created.version._id,
    shop: shopDoc,
  });
  if (!preview.ok) throw new Error(`QA sample render failed: ${preview.reason}`);

  const activated = await activateVersion({
    shopId: shop._id,
    versionId: created.version._id,
  });
  if (!activated.ok) throw new Error(`QA activation failed: ${activated.reason}`);

  const issued = await ensureInvoiceForOrder(completedOrder._id);
  if (!issued.ok) throw new Error(`QA invoice issuance failed: ${issued.reason}`);
  console.log(
    `[qa-billing] seeded invoice ${issued.invoice.number} (${issued.invoice.byteSize} bytes)`,
  );
}

console.log(`[qa-billing] seeded; fixture at ${path.relative(ROOT, FIXTURE_FILE)}`);
console.log(`[qa-billing] starting app on http://127.0.0.1:${PORT}`);

await import(fileUrl("server.js"));
