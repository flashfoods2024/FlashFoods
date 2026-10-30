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

console.log(`[qa-billing] seeded; fixture at ${path.relative(ROOT, FIXTURE_FILE)}`);
console.log(`[qa-billing] starting app on http://127.0.0.1:${PORT}`);

await import(fileUrl("server.js"));
