import { getMessaging, isFcmConfigured } from "../config/firebase-admin.js";
import { FcmToken } from "../models/FcmToken.js";
import { Shop } from "../models/Shop.js";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function dispatchNewOrderNotification(order) {
  if (!isFcmConfigured()) {
    console.log("[FCM] dispatch skipped — Firebase not configured");
    return;
  }

  try {
    const shop = await Shop.findById(order.shop).select("vendor name").lean();
    if (!shop || !shop.vendor) {
      console.log("[FCM] dispatch skipped — no vendor for shop", order.shop);
      return;
    }

    const vendorId = String(shop.vendor);
    const tokens = await FcmToken.find({ vendorId }).lean();

    if (!tokens.length) {
      console.log("[FCM] dispatch skipped — no tokens for vendor", vendorId);
      return;
    }

    const registrationTokens = tokens.map((t) => t.token);

    await sendWithRetry(registrationTokens, {
      title: "New Order",
      body: `₹${Number(order.total).toFixed(2)} — ${order.items.length} item(s)`,
      icon: "/icons/icon-192x192.png",
    }, {
      vendorId: vendorId,
      orderId: String(order._id),
      click_action: "/vendor/orders/pending",
      tag: "flashfoods-new-order-" + String(order._id),
      timestamp: String(Date.now()),
    });
  } catch (err) {
    console.error("[FCM] dispatch error:", err.message);
  }
}

// FCM error codes that mean the token can never succeed again (as opposed to a
// transient/network failure). These tokens are pruned from the database.
const PERMANENT_FCM_ERROR_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
  "messaging/mismatched-credential",
  "messaging/invalid-argument",
]);

// Classify a multicast response into tokens that are permanently invalid.
// Pure + exported so it can be unit-tested without a live FCM connection.
export function extractInvalidTokens(response, registrationTokens) {
  const invalidTokens = [];
  const responses = response?.responses || [];
  responses.forEach((resp, idx) => {
    if (!resp || resp.success) return;
    if (PERMANENT_FCM_ERROR_CODES.has(resp.error?.code)) {
      invalidTokens.push(registrationTokens[idx]);
    }
  });
  return invalidTokens;
}

export async function sendWithRetry(
  registrationTokens,
  notification,
  data,
  attempt = 0,
  messagingOverride = null,
) {
  const messaging = messagingOverride || getMessaging();
  if (!messaging) return;

  // Declared for the whole function: the success path (failureCount === 0)
  // never enters the branch below but still logs this value. Declaring it
  // inside that branch caused a ReferenceError on every successful send, which
  // was swallowed by the catch and triggered pointless retries.
  let invalidTokens = [];

  try {
    const response = await messaging.sendEachForMulticast({
      tokens: registrationTokens,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: data,
      webpush: {
        headers: {
          urgency: "high",
        },
        notification: {
          icon: notification.icon || "/icons/icon-192x192.png",
          badge: "/icons/icon-192x192.png",
          tag: data.tag,
          requireInteraction: true,
          renotify: false,
        },
        fcmOptions: {
          link: data.click_action || "/vendor/orders/pending",
        },
      },
    });

    if (response.failureCount > 0) {
      invalidTokens = extractInvalidTokens(response, registrationTokens);

      if (invalidTokens.length > 0) {
        await FcmToken.deleteMany({ token: { $in: invalidTokens } });
        console.log("[FCM] removed", invalidTokens.length, "invalid token(s)");
      }

      const remainingTokens = registrationTokens.filter(
        (t) => !invalidTokens.includes(t),
      );

      if (
        remainingTokens.length > 0 &&
        attempt < MAX_RETRIES &&
        response.failureCount > invalidTokens.length
      ) {
        const transientErrors = response.failureCount - invalidTokens.length;
        if (transientErrors > 0) {
          console.log(
            "[FCM] retrying",
            transientErrors,
            "transient failure(s) (attempt",
            attempt + 1,
            ")",
          );
          await sleep(RETRY_DELAY_MS);
          return sendWithRetry(
            remainingTokens,
            notification,
            data,
            attempt + 1,
            messagingOverride,
          );
        }
      }
    }

    console.log(
      "[FCM] sent:",
      response.successCount,
      "success,",
      response.failureCount,
      "failure(s),",
      invalidTokens.length,
      "invalid token(s) removed",
    );
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      console.log(
        "[FCM] send failed (attempt",
        attempt + 1,
        "):",
        err.message,
        "— retrying",
      );
      await sleep(RETRY_DELAY_MS);
      return sendWithRetry(
        registrationTokens,
        notification,
        data,
        attempt + 1,
        messagingOverride,
      );
    }
    console.error("[FCM] send failed after", MAX_RETRIES + 1, "attempts:", err.message);
  }
}
