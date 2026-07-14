import dotenv from "dotenv";

dotenv.config();

const AUTH_URLS = {
  UAT: "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token",
  PROD: "https://api.phonepe.com/apis/identity-manager/v1/oauth/token",
};

const PAY_URLS = {
  UAT: "https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay",
  PROD: "https://api.phonepe.com/apis/pg/checkout/v2/pay",
};

const ORDER_STATUS_URLS = {
  UAT: "https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/order",
  PROD: "https://api.phonepe.com/apis/pg/checkout/v2/order",
};

const REFUND_URLS = {
  UAT: "https://api-preprod.phonepe.com/apis/pg-sandbox/payments/v2/refund",
  PROD: "https://api.phonepe.com/apis/pg/payments/v2/refund",
};

export function getPhonepeFromShop(shop) {
  const phonepe = shop?.paymentSettings?.phonepe;
  const useCustom = phonepe?.clientId && phonepe?.clientSecret;

  if (useCustom) {
    const env = phonepe.env || "UAT";
    return {
      clientId: phonepe.clientId,
      clientSecret: phonepe.clientSecret,
      clientVersion: phonepe.clientVersion || "",
      env,
    };
  }

  const env = process.env.PHONEPE_ENV || "UAT";
  return {
    clientId: process.env.PHONEPE_CLIENT_ID || "",
    clientSecret: process.env.PHONEPE_CLIENT_SECRET || "",
    clientVersion: process.env.PHONEPE_CLIENT_VERSION || "",
    env,
  };
}

export async function getAuthToken({
  clientId,
  clientSecret,
  clientVersion,
  env,
}) {
  const url = AUTH_URLS[env] || AUTH_URLS.UAT;

  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", clientId);
  params.append("client_version", clientVersion);
  params.append("client_secret", clientSecret);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PhonePe auth failed: ${response.status} ${text}`);
  }

  return response.json();
}

export async function createPayment({
  accessToken,
  merchantTransactionId,
  amount,
  redirectUrl,
  env,
}) {
  const url = PAY_URLS[env] || PAY_URLS.UAT;

  const payload = {
    merchantOrderId: merchantTransactionId,
    amount: Math.round(amount * 100),
    paymentFlow: {
      type: "PG_CHECKOUT",
      merchantUrls: {
        redirectUrl,
      },
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `O-Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PhonePe pay failed: ${response.status} ${text}`);
  }

  return response.json();
}

export async function getOrderStatus({ merchantOrderId, accessToken, env }) {
  const baseUrl = ORDER_STATUS_URLS[env] || ORDER_STATUS_URLS.UAT;
  const url = `${baseUrl}/${encodeURIComponent(merchantOrderId)}/status?details=false`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `O-Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PhonePe status check failed: ${response.status} ${text}`);
  }

  return response.json();
}

export async function refundPayment({
  accessToken,
  merchantOrderId,
  transactionId,
  amount,
  merchantRefundId,
  env,
}) {
  const url = REFUND_URLS[env] || REFUND_URLS.UAT;

  // The Standard Checkout refund API expects:
  //   merchantRefundId, originalMerchantOrderId, amount
  // The merchantOrderId value is the same txnid that was sent as
  // merchantOrderId in the original /checkout/v2/pay request.
  if (!merchantOrderId) {
    throw new Error("PhonePe refund failed: merchantOrderId is empty");
  }

  const payload = {
    merchantRefundId,
    originalMerchantOrderId: merchantOrderId,
    amount: Math.round(amount * 100),
    transactionId,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `O-Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PhonePe refund failed: ${response.status} ${text}`);
  }

  const responseData = await response.json();
  return responseData;
}
