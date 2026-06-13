import dotenv from "dotenv";
import Razorpay from "razorpay";

dotenv.config();

const defaultRazorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

export function createRazorpayFromShop(shop) {
  if (!shop) {
    return {
      keyId: process.env.RAZORPAY_KEY_ID,
      keySecret: process.env.RAZORPAY_KEY_SECRET,
      instance: defaultRazorpay,
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
    instance: defaultRazorpay,
  };
}

// Resolve the webhook signing secret for a shop. Prefers a vendor-specific
// secret (paymentSettings.razorpay.webhookSecret) and falls back to the
// platform-wide RAZORPAY_WEBHOOK_SECRET env var.
export function getWebhookSecretFromShop(shop) {
  const vendorSecret = shop?.paymentSettings?.razorpay?.webhookSecret;
  if (shop?.paymentConfigured && vendorSecret) {
    return vendorSecret;
  }
  return process.env.RAZORPAY_WEBHOOK_SECRET || "";
}

export default defaultRazorpay;
