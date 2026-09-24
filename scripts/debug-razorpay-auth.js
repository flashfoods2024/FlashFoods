// Temporary diagnostic: prove which Razorpay credentials reach the API.
// Usage: node --env-file=.env scripts/debug-razorpay-auth.js [shopSlug]
// Never prints a full secret — metadata only. Delete after root cause proven.
import dotenv from "dotenv";
import Razorpay from "razorpay";
import connectDb from "../config/db.js";
import { Shop } from "../models/Shop.js";
import { createRazorpayFromShop } from "../config/razorpay.js";

dotenv.config();

function meta(label, value) {
  const s = String(value ?? "");
  console.log(label, {
    length: s.length,
    first5: s.slice(0, 5),
    last5: s.slice(-5),
    hasWhitespace: /\s/.test(s),
    // eslint-disable-next-line no-control-regex
    hasHiddenChars: /[^\x20-\x7E]/.test(s),
    empty: s.length === 0,
  });
}

const slug = process.argv[2] || "testing";
await connectDb();
const shop = await Shop.findOne({ slug }).lean();
if (!shop) {
  console.error("SHOP NOT FOUND:", slug);
  process.exit(1);
}
console.log("SHOP:", { shopId: String(shop._id), name: shop.name, slug: shop.slug });

const rs = shop.paymentSettings?.razorpay || {};
console.log("SOURCE: shop.paymentSettings.razorpay (raw MongoDB value)");
console.log("  keyId:", rs.keyId);
meta("  keySecret", rs.keySecret);

console.log("SOURCE: .env (process.env)");
console.log("  RAZORPAY_KEY_ID:", process.env.RAZORPAY_KEY_ID);
meta("  RAZORPAY_KEY_SECRET", process.env.RAZORPAY_KEY_SECRET);

const { keyId, keySecret, instance } = createRazorpayFromShop(shop);
const useCustom = Boolean(shop.paymentConfigured && rs.keyId && rs.keySecret);
console.log("RUNTIME RESOLUTION:", {
  source: useCustom ? "shop:paymentSettings.razorpay" : "env:RAZORPAY_*",
  keyId,
});
meta("RUNTIME keySecret", keySecret);
console.log(
  "DB==RUNTIME:",
  String(rs.keySecret ?? "") === String(keySecret ?? "") && useCustom
    ? "yes (shop branch)"
    : "n/a (env branch)",
);

console.log("--- attempting instance.orders.create({amount:1000, currency:'INR'}) ---");
const t0 = Date.now();
try {
  const order = await instance.orders.create({
    amount: 1000,
    currency: "INR",
    receipt: `diag_${Date.now()}`,
  });
  console.log("SUCCESS in", Date.now() - t0 + "ms:", JSON.stringify(order));
} catch (err) {
  console.log("FAILURE in", Date.now() - t0 + "ms");
  console.log("statusCode:", err.statusCode);
  console.log("err.error:", JSON.stringify(err.error, null, 2));
}
process.exit(0);
