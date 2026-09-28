// QR pickup tokens.
//
// A pickup QR encodes a compact, HMAC-signed token bound to a single order
// and a single shop. The server verifies the signature (constant-time) and
// the shop binding before completing anything, so a QR cannot be forged or
// used by another shop.
//
// Pickup credentials never expire by time: a token stays valid while its
// order is `ready_for_pickup` and becomes unusable once verification moves
// the order to `completed` (the verifier requires `ready_for_pickup`, so a
// replayed credential finds no eligible order). Canonical format:
//
//   v1.<orderId>.<shopId>.<signature>
//
// Migration window: tokens minted by the previous generator carry an extra
// expiry segment (`v1.<orderId>.<shopId>.<exp>.<signature>`). The verifier
// still authenticates those (signature covers the received payload, shop
// binding applies) but NEVER rejects on the timestamp — the expiry segment
// is opaque data. New tokens are always minted without it.
// The signature secret prefers QR_SECRET, then SESSION_SECRET, then a dev
// fallback so local development still works. Production should set QR_SECRET.

import crypto from "crypto";

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
 * Build the QR token for an order. No timestamp is embedded: validity is
 * determined solely by the order's status at verification time.
 */
export function createPickupQr(order, { secret } = {}) {
  if (!order || !order._id || !order.shop) return null;
  // Callers may pass a populated shop object (e.g. after `.populate("shop")`);
  // unwrap to the raw id so the token never embeds "[object Object]".
  const shopId = order.shop && typeof order.shop === "object" ? order.shop._id : order.shop;
  if (!shopId) return null;
  const payload = `${VERSION}.${order._id}.${shopId}`;
  return `${payload}.${sign(payload, getSecret(secret))}`;
}

/**
 * Verify a QR token. Accepts the canonical 4-part format and the legacy
 * 5-part format (migration window); the legacy expiry segment is validated
 * structurally but never enforced by time.
 *
 * @returns {{ ok: true, orderId: string, shop: string } | { ok: false, reason: string }}
 *   reason ∈ malformed | forged | wrong_shop
 */
export function verifyPickupQr(token, { shopId, secret } = {}) {
  if (typeof token !== "string") return { ok: false, reason: "malformed" };

  const parts = token.trim().split(".");
  if (parts[0] !== VERSION || (parts.length !== 4 && parts.length !== 5)) {
    return { ok: false, reason: "malformed" };
  }

  const orderId = parts[1];
  const shop = parts[2];
  // Canonical: v1.<orderId>.<shopId>.<signature>.
  // Legacy:    v1.<orderId>.<shopId>.<exp>.<signature> (exp never enforced).
  const signature = parts.length === 5 ? parts[4] : parts[3];
  if (parts.length === 5 && !/^[0-9]+$/.test(parts[3])) {
    return { ok: false, reason: "malformed" };
  }
  if (!/^[a-f0-9]{24}$/i.test(orderId)) return { ok: false, reason: "malformed" };

  const payload = parts.length === 5
    ? `${VERSION}.${orderId}.${shop}.${parts[3]}`
    : `${VERSION}.${orderId}.${shop}`;
  const expected = sign(payload, getSecret(secret));
  if (!signaturesMatch(expected, signature)) return { ok: false, reason: "forged" };

  if (shopId && String(shopId) !== String(shop)) {
    return { ok: false, reason: "wrong_shop" };
  }

  return { ok: true, orderId, shop };
}
