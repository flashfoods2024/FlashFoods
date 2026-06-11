import crypto from "crypto";
import Razorpay from "razorpay";

function getCredentials(shop) {
  const settings = shop?.paymentSettings || {};
  const keyId = settings.apiKey || process.env.RAZORPAY_KEY_ID;
  const keySecret = settings.apiSecret || process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials are not configured for this shop.");
  }

  return { keyId, keySecret };
}

function getClient(shop) {
  const { keyId, keySecret } = getCredentials(shop);
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

export function getPublicKey(shop) {
  return getCredentials(shop).keyId;
}

export async function createOrder({ amount, currency = "INR", shop, receipt }) {
  const client = getClient(shop);

  const options = {
    amount: Math.round(Number(amount) * 100),
    currency,
    receipt: receipt || `receipt_${Date.now()}`,
  };

  const order = await client.orders.create(options);

  return {
    provider: "razorpay",
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    publicKey: getPublicKey(shop),
    raw: order,
  };
}

export async function verifyPayment({
  shop,
  razorpay_order_id,
  razorpay_payment_id,
  razorpay_signature,
}) {
  const { keySecret } = getCredentials(shop);
  const sign = `${razorpay_order_id}|${razorpay_payment_id}`;

  const expectedSign = crypto
    .createHmac("sha256", keySecret)
    .update(sign)
    .digest("hex");

  if (expectedSign !== razorpay_signature) {
    return {
      success: false,
      message: "Invalid payment signature",
    };
  }

  return {
    success: true,
    gatewayTransactionId: razorpay_payment_id,
    paymentNote: razorpay_payment_id,
    transactionId: razorpay_payment_id,
    paymentStatus: "paid",
  };
}

export async function refundPayment({ shop, paymentId, amount }) {
  const client = getClient(shop);

  const payment = await client.payments.fetch(paymentId);

  if (payment.status !== "captured") {
    throw new Error("Only captured payments can be refunded.");
  }

  const refund = await client.payments.refund(paymentId, {
    amount: Math.round(Number(amount) * 100),
    speed: "normal",
    notes: {
      reason: "Vendor cancelled order",
    },
  });

  return refund;
}

export function isRefundableTransaction(transactionId) {
  return String(transactionId || "").startsWith("pay_");
}
