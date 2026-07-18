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

async function sendWithRetry(registrationTokens, notification, data, attempt = 0) {
  const messaging = getMessaging();
  if (!messaging) return;

  try {
    const response = await messaging.sendEachForMulticast({
      tokens: registrationTokens,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: data,
      webpush: {
        notification: {
          icon: notification.icon || "/icons/icon-192x192.png",
          badge: "/icons/icon-192x192.png",
          tag: data.tag,
          requireInteraction: false,
          renotify: false,
        },
        fcmOptions: {
          link: data.click_action || "/vendor/orders/pending",
        },
      },
    });

    if (response.failureCount > 0) {
      const invalidTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errorCode = resp.error?.code;
          if (
            errorCode === "messaging/invalid-registration-token" ||
            errorCode === "messaging/registration-token-not-registered" ||
            errorCode === "messaging/mismatched-credential" ||
            errorCode === "messaging/invalid-argument"
          ) {
            invalidTokens.push(registrationTokens[idx]);
          }
        }
      });

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
          return sendWithRetry(remainingTokens, notification, data, attempt + 1);
        }
      }
    }

    console.log(
      "[FCM] sent:",
      response.successCount,
      "success,",
      response.failureCount,
      "failure(s),",
      invalidTokens ? invalidTokens.length : 0,
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
      return sendWithRetry(registrationTokens, notification, data, attempt + 1);
    }
    console.error("[FCM] send failed after", MAX_RETRIES + 1, "attempts:", err.message);
  }
}
