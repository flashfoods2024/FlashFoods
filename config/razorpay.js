import dotenv from "dotenv";
import Razorpay from "razorpay";

dotenv.config();

let _defaultRazorpay = null;

function getDefaultRazorpay() {
  if (!_defaultRazorpay) {
    _defaultRazorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return _defaultRazorpay;
}

export function createRazorpayFromShop(shop) {
  if (!shop) {
    return {
      keyId: process.env.RAZORPAY_KEY_ID,
      keySecret: process.env.RAZORPAY_KEY_SECRET,
      instance: getDefaultRazorpay(),
    };
  }

  const razorpaySettings = shop.paymentSettings?.razorpay;
  const useCustom = shop.paymentConfigured && razorpaySettings?.keyId && razorpaySettings?.keySecret;

  if (useCustom) {
    const instance = new Razorpay({
      key_id: razorpaySettings.keyId,
      key_secret: razorpaySettings.keySecret,
    });
    return { keyId: razorpaySettings.keyId, keySecret: razorpaySettings.keySecret, instance };
  }

  return {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    instance: getDefaultRazorpay(),
  };
}

// Resolve the webhook signing secret for a shop.
//
// Fail-closed rules:
//  * A shop that has its own Razorpay credentials MUST have its own webhook
//    secret. We never fall back to the platform secret here, because the
//    vendor's account signs with a secret we do not hold and silently trusting
//    the platform secret would let anyone who knows it forge that shop's events.
//  * A shop on the platform Razorpay account uses RAZORPAY_WEBHOOK_SECRET.
//  * If the applicable secret is missing/blank we return `secret: null` and the
//    caller must reject the request rather than verify against an empty key.
export function resolveWebhookSecret(shop) {
  const vendorSecret = String(
    shop?.paymentSettings?.razorpay?.webhookSecret || "",
  ).trim();
  const useCustom = Boolean(
    shop?.paymentConfigured &&
      shop?.paymentSettings?.razorpay?.keyId &&
      shop?.paymentSettings?.razorpay?.keySecret,
  );

  if (useCustom) {
    if (!vendorSecret) {
      return {
        secret: null,
        source: "vendor",
        reason: "vendor_webhook_secret_missing",
        shopId: shop?._id ? String(shop._id) : null,
      };
    }
    return { secret: vendorSecret, source: "vendor" };
  }

  const platformSecret = String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
  if (!platformSecret) {
    return {
      secret: null,
      source: "platform",
      reason: "platform_webhook_secret_missing",
      shopId: shop?._id ? String(shop._id) : null,
    };
  }
  return { secret: platformSecret, source: "platform" };
}

// Backward-compatible helper: returns the applicable secret or "". Prefer
// resolveWebhookSecret() when you need to distinguish "missing" from "configured".
export function getWebhookSecretFromShop(shop) {
  return resolveWebhookSecret(shop).secret || "";
}

export default getDefaultRazorpay;
