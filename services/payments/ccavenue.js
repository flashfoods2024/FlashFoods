import crypto from "crypto";
import querystring from "querystring";

const TEST_GATEWAY_URL =
  "https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction";
const PRODUCTION_GATEWAY_URL =
  "https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction";

function getGatewayUrl() {
  if (process.env.CCAVENUE_GATEWAY_URL) {
    return process.env.CCAVENUE_GATEWAY_URL;
  }

  // Default to the test gateway so the integration works in sandbox mode.
  return process.env.CCAVENUE_TEST_MODE === "false"
    ? PRODUCTION_GATEWAY_URL
    : TEST_GATEWAY_URL;
}

function getCredentials(shop) {
  const settings = shop?.paymentSettings || {};
  const merchantId = settings.merchantId || process.env.CCAVENUE_MERCHANT_ID;
  const accessCode = settings.apiKey || process.env.CCAVENUE_ACCESS_CODE;
  const workingKey = settings.apiSecret || process.env.CCAVENUE_WORKING_KEY;

  if (!merchantId || !accessCode || !workingKey) {
    throw new Error(
      "CCAvenue credentials are not configured for this shop. Set merchantId, access code, and working key.",
    );
  }

  return { merchantId, accessCode, workingKey };
}

function getCipherKey(workingKey) {
  const key = Buffer.from(String(workingKey), "utf8");

  // The downloaded AES-256 kit expects a 32-byte working key.
  if (key.length !== 32) {
    throw new Error(
      "CCAvenue working key must be exactly 32 bytes for the AES-256 integration kit.",
    );
  }

  return key;
}

function encrypt(plainText, workingKey) {
  // Mirror the kit logic: random IV, AES-256-GCM, IV hex prefix plus ciphertext+tag hex suffix.
  const algorithm = "aes-256-gcm";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, getCipherKey(workingKey), iv);

  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();
  return (
    iv.toString("hex") + Buffer.concat([encrypted, authTag]).toString("hex")
  );
}

function decrypt(encryptedText, workingKey) {
  const algorithm = "aes-256-gcm";
  const encryptedBuffer = Buffer.from(String(encryptedText), "hex");

  if (encryptedBuffer.length < 29) {
    throw new Error("CCAvenue encrypted payload is malformed.");
  }

  const iv = encryptedBuffer.slice(0, 12);
  const authTag = encryptedBuffer.slice(-16);
  const ciphertext = encryptedBuffer.slice(12, -16);

  const decipher = crypto.createDecipheriv(
    algorithm,
    getCipherKey(workingKey),
    iv,
  );

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

function cleanupPayload(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  );
}

function buildRedirectUrl(value, fallback) {
  const url = String(value || fallback || "").trim();
  if (!url) {
    throw new Error("CCAvenue redirect URL is missing.");
  }
  return url;
}

function normalizeAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Invalid CCAvenue amount.");
  }
  return value.toFixed(2);
}

function parseResponse(encResp, workingKey) {
  const decrypted = decrypt(encResp, workingKey);
  return querystring.parse(decrypted);
}

export function getPublicKey(shop) {
  return getCredentials(shop).accessCode;
}

export async function createOrder({
  amount,
  shop,
  receipt,
  redirectUrl,
  cancelUrl,
  customer,
  pickupTime,
  checkoutToken,
}) {
  const { merchantId, accessCode, workingKey } = getCredentials(shop);
  const orderId =
    String(receipt || "")
      .trim()
      .replace(/[^A-Za-z0-9_-]/g, "") ||
    `FF${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;

  const payload = cleanupPayload({
    merchant_id: merchantId,
    order_id: orderId,
    currency: "INR",
    amount: normalizeAmount(amount),
    redirect_url: buildRedirectUrl(
      redirectUrl,
      process.env.CCAVENUE_REDIRECT_URL,
    ),
    cancel_url: buildRedirectUrl(
      cancelUrl,
      process.env.CCAVENUE_CANCEL_URL || `${process.env.SITE_URL || ""}/cart`,
    ),
    language: "EN",
    billing_name: customer?.name || "Flash Foods Customer",
    billing_email: customer?.email || "",
    merchant_param1: checkoutToken || "",
    merchant_param2: String(shop?._id || ""),
    merchant_param3: pickupTime || "",
  });

  const encRequest = encrypt(querystring.stringify(payload), workingKey);

  return {
    provider: "ccavenue",
    orderId,
    amount: Math.round(Number(amount) * 100),
    currency: "INR",
    accessCode,
    gatewayUrl: getGatewayUrl(),
    encRequest,
    merchantId,
    redirectUrl: payload.redirect_url,
    cancelUrl: payload.cancel_url,
    raw: payload,
  };
}

export async function verifyPayment(payload) {
  try {
    const shop = payload?.shop;
    const { workingKey } = getCredentials(shop);
    const encResp =
      payload?.encResp ||
      payload?.encResponse ||
      payload?.enc_response ||
      payload?.body?.encResp ||
      payload?.body?.encResponse ||
      "";

    if (!encResp) {
      return {
        success: false,
        message: "CCAvenue response is missing encResp.",
      };
    }

    const response = parseResponse(encResp, workingKey);
    const orderStatus = String(response.order_status || "").trim();
    const normalizedStatus = orderStatus.toLowerCase();
    const transactionId = String(
      response.tracking_id || response.bank_ref_no || response.order_id || "",
    ).trim();
    const amount = Number(response.amount);

    if (normalizedStatus !== "success") {
      return {
        success: false,
        message:
          String(
            response.failure_message || response.status_message || "",
          ).trim() || "CCAvenue payment was not successful.",
        paymentStatus: "failed",
        orderStatus,
        raw: response,
      };
    }

    if (!transactionId) {
      return {
        success: false,
        message: "CCAvenue response is missing transaction details.",
        paymentStatus: "failed",
        raw: response,
      };
    }

    if (
      payload.expectedAmount !== undefined &&
      payload.expectedAmount !== null
    ) {
      const expectedAmount = Number(payload.expectedAmount);
      if (
        Number.isFinite(expectedAmount) &&
        Number.isFinite(amount) &&
        Math.abs(amount - expectedAmount) > 0.01
      ) {
        return {
          success: false,
          message: "CCAvenue amount mismatch.",
          paymentStatus: "failed",
          raw: response,
        };
      }
    }

    return {
      success: true,
      gatewayTransactionId: transactionId,
      transactionId,
      paymentNote: response.order_id || transactionId,
      paymentStatus: "paid",
      orderStatus,
      amount: Number.isFinite(amount) ? amount : null,
      raw: response,
    };
  } catch (error) {
    return {
      success: false,
      message: error?.message || "CCAvenue verification failed.",
      paymentStatus: "failed",
    };
  }
}

export async function refundPayment() {
  throw new Error("CCAvenue refunds are not supported in this integration.");
}
