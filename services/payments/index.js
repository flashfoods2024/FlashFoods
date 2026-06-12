import * as razorpay from "./razorpay.js";
import * as ccavenue from "./ccavenue.js";
import * as paytm from "./paytm.js";
import * as phonepe from "./phonepe.js";

const providers = {
  razorpay,
  ccavenue,
  paytm,
  phonepe,
};

export const PAYMENT_PROVIDERS = Object.keys(providers);

export function getProviderAdapter(provider) {
  const adapter = providers[provider];
  if (!adapter) {
    throw new Error(`Unknown payment provider: ${provider}`);
  }
  return adapter;
}

export async function createOrder(provider, options) {
  return getProviderAdapter(provider).createOrder(options);
}

export async function verifyPayment(provider, payload) {
  return getProviderAdapter(provider).verifyPayment(payload);
}

export async function refundPayment(provider, options) {
  const adapter = getProviderAdapter(provider);
  if (typeof adapter.refundPayment !== "function") {
    throw new Error(`Refunds are not supported for provider: ${provider}`);
  }
  return adapter.refundPayment(options);
}

export function getProviderPublicKey(provider, shop) {
  const adapter = getProviderAdapter(provider);
  if (typeof adapter.getPublicKey === "function") {
    return adapter.getPublicKey(shop);
  }
  return shop?.paymentSettings?.apiKey || "";
}

export function isRefundableOrder(order) {
  const provider = order.paymentProvider || "razorpay";
  const txId =
    order.gatewayTransactionId || order.transactionId || order.paymentNote;
  const adapter = providers[provider];

  if (adapter && typeof adapter.isRefundableTransaction === "function") {
    return adapter.isRefundableTransaction(txId);
  }

  if (provider === "razorpay" || !order.paymentProvider) {
    return razorpay.isRefundableTransaction(txId);
  }

  return false;
}
