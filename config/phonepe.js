import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const BASE_URLS = {
  UAT: "https://api-preprod.phonepe.com/apis/pg",
  PROD: "https://api.phonepe.com/apis/pg",
};

export function phonepeBaseUrl(env) {
  return BASE_URLS[env] || BASE_URLS.UAT;
}

export function getPhonepeFromShop(shop) {
  const phonepe = shop?.paymentSettings?.phonepe;
  const useCustom = phonepe?.merchantId && phonepe?.saltKey;

  if (useCustom) {
    const env = phonepe.env || "UAT";
    return {
      merchantId: phonepe.merchantId,
      saltKey: phonepe.saltKey,
      saltIndex: phonepe.saltIndex || "1",
      env,
      baseUrl: phonepeBaseUrl(env),
    };
  }

  const env = process.env.PHONEPE_ENV || "UAT";
  return {
    merchantId: process.env.PHONEPE_MERCHANT_ID || "",
    saltKey: process.env.PHONEPE_SALT_KEY || "",
    saltIndex: process.env.PHONEPE_SALT_INDEX || "1",
    env,
    baseUrl: phonepeBaseUrl(env),
  };
}

export function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function buildXVerify(payloadBase64, endpointPath, saltKey) {
  const hash = sha256(payloadBase64 + endpointPath + saltKey);
  return `${hash}###${saltKey}`;
}

export function verifyCallbackXVerify(xVerifyHeader, bodyString, endpointPath, saltKey) {
  if (!xVerifyHeader || !bodyString || !saltKey) return false;

  const parts = String(xVerifyHeader).split("###");
  if (parts.length !== 2) return false;

  const expectedHash = parts[0];
  const computedHash = sha256(bodyString + endpointPath + saltKey);

  if (expectedHash.length !== computedHash.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expectedHash, "utf8"),
    Buffer.from(computedHash, "utf8"),
  );
}

export function buildPaymentPayload({ merchantId, transactionId, amount, merchantUserId, redirectUrl, redirectMode = "POST" }) {
  const payload = {
    merchantId,
    merchantTransactionId: transactionId,
    merchantUserId: merchantUserId || "",
    amount: Math.round(amount * 100),
    redirectUrl,
    redirectMode,
    callbackUrl: redirectUrl,
    paymentInstrument: { type: "PAY_PAGE" },
  };
  return payload;
}
