import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

// Easebuzz hosted-checkout base URLs by environment.
const BASE_URLS = {
  test: "https://testpay.easebuzz.in",
  prod: "https://pay.easebuzz.in",
};

export function easebuzzBaseUrl(env) {
  return BASE_URLS[env] || BASE_URLS.test;
}

// Resolve Easebuzz credentials for a shop. Prefers vendor-specific
// credentials and falls back to the platform-wide env vars. Mirrors the
// per-shop adapter pattern used by config/razorpay.js.
export function getEasebuzzFromShop(shop) {
  const easebuzz = shop?.paymentSettings?.easebuzz;
  const useCustom = easebuzz?.merchantKey && easebuzz?.salt;

  if (useCustom) {
    const env = easebuzz.env || "test";
    return {
      merchantKey: easebuzz.merchantKey,
      salt: easebuzz.salt,
      env,
      baseUrl: easebuzzBaseUrl(env),
    };
  }

  const env = process.env.EASEBUZZ_ENV || "test";
  return {
    merchantKey: process.env.EASEBUZZ_MERCHANT_KEY || "",
    salt: process.env.EASEBUZZ_SALT || "",
    env,
    baseUrl: easebuzzBaseUrl(env),
  };
}

function sha512(input) {
  return crypto.createHash("sha512").update(input).digest("hex");
}

// Request hash for initiating a payment.
// Easebuzz forward hash sequence:
// key|txnid|amount|productinfo|firstname|email|udf1..udf10||||||salt
export function buildPaymentHash({ merchantKey, salt, txnid, amount, productinfo, firstname, email }) {
  const udf = ["", "", "", "", "", "", "", "", "", ""];
  const sequence = [
    merchantKey,
    txnid,
    amount,
    productinfo,
    firstname,
    email,
    ...udf,
    salt,
  ].join("|");
  return sha512(sequence);
}

// Verify the response hash returned by Easebuzz on the callback.
// Reverse hash sequence:
// salt|status|udf10..udf1|email|firstname|productinfo|amount|txnid|key
export function verifyResponseHash({ merchantKey, salt, payload }) {
  const {
    status = "",
    txnid = "",
    amount = "",
    productinfo = "",
    firstname = "",
    email = "",
    hash = "",
  } = payload || {};

  const udf = ["", "", "", "", "", "", "", "", "", ""];
  const sequence = [
    salt,
    status,
    ...udf, // udf10..udf1 (all empty here)
    email,
    firstname,
    productinfo,
    amount,
    txnid,
    merchantKey,
  ].join("|");

  const expected = sha512(sequence);
  if (!hash || expected.length !== String(hash).length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(String(hash), "utf8")
  );
}
