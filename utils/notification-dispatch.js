import { getMessaging, isFcmConfigured } from "../config/firebase-admin.js";
import { FcmToken } from "../models/FcmToken.js";
import { Shop } from "../models/Shop.js";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Build the FCM notification + data payload for a new order.
//
// The `tag` is derived from the order id, so repeat/duplicate deliveries for the
// same order collapse into a single system notification (no duplicate alert),
// and `vendorId` targets only the shop's own vendor.
// Pure + exported so it can be unit-tested without a live FCM connection.
export function buildNewOrderNotification(order, vendorId) {
  const items = Array.isArray(order.items) ? order.items : [];
  return {
    notification: {
      title: "New Order",
      body: `₹${Number(order.total).toFixed(2)} — ${items.length} item(s)`,
      icon: "/icons/icon-192x192.png",
    },
    data: {
      vendorId: String(vendorId),
      orderId: String(order._id),
      click_action: "/vendor/orders/pending",
      tag: "flashfoods-new-order-" + String(order._id),
      timestamp: String(Date.now()),
    },
  };
}

export async function dispatchNewOrderNotification(order, messagingOverride = null) {
  if (!messagingOverride && !isFcmConfigured()) {
    console.log("[FCM] dispatch skipped — Firebase not configured");
    return;
  }

  try {
    const shop = await Shop.findById(order.shop).select("vendor name").lean();
    if (!shop || !shop.vendor) {
      console.log("[FCM] dispatch skipped — no vendor for shop", order.shop);
      return;
    }

    // Targeted send: only tokens owned by THIS order's vendor. Never broadcast.
    const vendorId = String(shop.vendor);
    const tokens = await FcmToken.find({ vendorId }).lean();

    if (!tokens.length) {
      console.log("[FCM] dispatch skipped — no tokens for vendor", vendorId);
      return;
    }

    const registrationTokens = tokens.map((t) => t.token);
    const { notification, data } = buildNewOrderNotification(order, vendorId);

    const result = await sendWithRetry(registrationTokens, notification, data, 0, messagingOverride);
    const sent = result ? result.successCount : 0;
    const failed = result ? result.failureCount : 0;
    console.log(
      `[FCM] order=${order._id} vendor=${vendorId} tokens=${registrationTokens.length} sent=${sent} failed=${failed}`,
    );
    if (result && result.invalidTokens && result.invalidTokens.length > 0) {
      console.log(`[FCM] removed stale token vendor=${vendorId} count=${result.invalidTokens.length}`);
    }
  } catch (err) {
    console.error("[FCM] dispatch error:", err.message);
  }
}

// F06.5 — build the FCM payload notifying a student that their order is
// ready for pickup.
//
// WhatsApp-style delivery: a single system sound, no alarm, no continuous
// ringing. That comes from `requireInteraction: false` + `renotify: false`
// (passed as webpush overrides at send time) and the per-order `tag`
// (`order-ready-<orderId>`), which collapses repeat deliveries for the same
// order into one notification instead of stacking.
// Future-safe metadata (shopId, shopName, type) rides in `data`.
// Pure + exported so it can be unit-tested without a live FCM connection.
export function buildOrderReadyNotification(order, shopName) {
  const orderId = String(order._id);
  return {
    notification: {
      title: "Order Ready",
      body: shopName
        ? `Your order from ${shopName} is ready for pickup.`
        : "Your order is ready for pickup.",
      icon: "/icons/icon-192x192.png",
    },
    data: {
      type: "order_ready",
      orderId,
      shopId: String(order.shop),
      shopName: shopName ? String(shopName) : "",
      click_action: `/orders/${orderId}`,
      url: `/orders/${orderId}`,
      tag: `order-ready-${orderId}`,
      timestamp: String(Date.now()),
    },
  };
}

// All device tokens registered by one student. Exported for testing.
export async function findStudentTokens(customerId) {
  return FcmToken.find({ customerId }).lean();
}

// F06.5 — notify the ordering student when the vendor marks their order
// ready. Call ONLY from the atomic accepted → ready_for_pickup transition,
// so a duplicate/failed transition (null result) never notifies and
// unrelated order saves never notify. Never throws; resolve vendor lookup
// for the shop name, then reuse sendWithRetry. `messagingOverride` is a
// test seam (same pattern as sendWithRetry); production passes nothing.
export async function dispatchOrderReadyNotification(order, messagingOverride = null) {
  if (!messagingOverride && !isFcmConfigured()) {
    console.log("[FCM] order-ready dispatch skipped — Firebase not configured");
    return;
  }

  try {
    if (!order || !order.customer) {
      console.log("[FCM] order-ready dispatch skipped — no customer on order");
      return;
    }

    const shop = await Shop.findById(order.shop).select("name").lean();
    const tokens = await findStudentTokens(order.customer);

    if (!tokens.length) {
      console.log("[FCM] order-ready dispatch skipped — no tokens for customer", String(order.customer));
      return;
    }

    const registrationTokens = tokens.map((t) => t.token);
    const { notification, data } = buildOrderReadyNotification(order, shop?.name);

    // requireInteraction: false → single WhatsApp-style ping, auto-dismiss.
    const result = await sendWithRetry(registrationTokens, notification, data, 0, messagingOverride, {
      requireInteraction: false,
    });
    const sent = result ? result.successCount : 0;
    const failed = result ? result.failureCount : 0;
    const studentId = String(order.customer);
    console.log(
      `[FCM] order-ready order=${order._id} student=${studentId} tokens=${registrationTokens.length} sent=${sent} failed=${failed}`,
    );
    if (result && result.invalidTokens && result.invalidTokens.length > 0) {
      console.log(`[FCM] removed stale token student=${studentId} count=${result.invalidTokens.length}`);
    }
  } catch (err) {
    console.error("[FCM] order-ready dispatch error:", err.message);
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
  webpushOverrides = null,
) {
  const messaging = messagingOverride || getMessaging();
  // Returned so callers can log per-order delivery counts. Existing callers
  // that ignore the return value are unaffected.
  const summary = { successCount: 0, failureCount: 0, invalidTokens: [] };
  if (!messaging) return summary;

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
          ...(webpushOverrides || {}),
        },
        fcmOptions: {
          link: data.click_action || "/vendor/orders/pending",
        },
      },
    });

    if (response.failureCount > 0) {
      invalidTokens = extractInvalidTokens(response, registrationTokens);

      summary.successCount = response.successCount;
      summary.failureCount = response.failureCount;
      summary.invalidTokens = invalidTokens;

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
            webpushOverrides,
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

    if (response.failureCount === 0) {
      summary.successCount = response.successCount;
      summary.failureCount = 0;
    }
    return summary;
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
        webpushOverrides,
      );
    }
    console.error("[FCM] send failed after", MAX_RETRIES + 1, "attempts:", err.message);
    return summary;
  }
}
