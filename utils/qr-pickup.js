// QR pickup tokens.
//
// A pickup QR encodes a compact, HMAC-signed token bound to a single order, a
// single shop, and an expiry. The server verifies the signature (constant-time),
// the shop binding, and the expiry before completing anything, so a QR cannot be
// forged, used by another shop, or replayed once the order has been collected.
//
// The signature secret prefers QR_SECRET, then SESSION_SECRET, then a dev
// fallback so local development still works. Production should set QR_SECRET.

import crypto from "crypto";

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const VERSION = "v1";

function getSecret(override) {
  return (
    override ||
    process.env.QR_SECRET ||
    process.env.SESSION_SECRET ||
    "dev-qr-secret"
  );
}

function base64url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function sign(payload, secret) {
  return base64url(crypto.createHmac("sha256", secret).update(payload).digest()).slice(0, 32);
}

// Constant-time string comparison that tolerates different lengths.
function signaturesMatch(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Build the QR token for an order. Expiry follows the order's pickup-code
 * expiry when present, otherwise `now + ttlMs`.
 */
export function createPickupQr(order, { now = new Date(), ttlMs = DEFAULT_TTL_MS, secret } = {}) {
  if (!order || !order._id || !order.shop) return null;
  const expiresAt = order.pickupOtpExpiresAt
    ? new Date(order.pickupOtpExpiresAt).getTime()
    : now.getTime() + ttlMs;
  const exp = Number.isFinite(expiresAt) ? expiresAt : now.getTime() + ttlMs;
  const payload = `${VERSION}.${order._id}.${order.shop}.${exp}`;
  return `${payload}.${sign(payload, getSecret(secret))}`;
}

/**
 * Verify a QR token.
 *
 * @returns {{ ok: true, orderId: string, shop: string } | { ok: false, reason: string }}
 *   reason ∈ malformed | forged | wrong_shop | expired
 */
export function verifyPickupQr(token, { shopId, now = new Date(), secret } = {}) {
  if (typeof token !== "string") return { ok: false, reason: "malformed" };

  const parts = token.trim().split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) {
    return { ok: false, reason: "malformed" };
  }

  const [, orderId, shop, expStr, signature] = parts;
  if (!/^[a-f0-9]{24}$/i.test(orderId)) return { ok: false, reason: "malformed" };
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return { ok: false, reason: "malformed" };

  const payload = `${VERSION}.${orderId}.${shop}.${expStr}`;
  const expected = sign(payload, getSecret(secret));
  if (!signaturesMatch(expected, signature)) return { ok: false, reason: "forged" };

  if (shopId && String(shopId) !== String(shop)) {
    return { ok: false, reason: "wrong_shop" };
  }

  if (now.getTime() > exp) return { ok: false, reason: "expired" };

  return { ok: true, orderId, shop };
}
