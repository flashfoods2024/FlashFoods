import crypto from "crypto";
import { signaturesMatch } from "./signature.js";

/**
 * Verify a Razorpay webhook signature.
 *
 * Fails CLOSED: a missing secret, a missing signature/body, or a mismatch all
 * return `{ ok: false, reason }`. An empty or whitespace-only secret can never
 * produce `ok: true` — this is the case the old inline code silently allowed by
 * hashing with an empty HMAC key, which made forged webhooks verifiable.
 *
 * @param {{ secret?: string, rawBody?: Buffer|string, signature?: string }} args
 * @returns {{ ok: boolean, reason?: string }}
 */
export function verifyRazorpayWebhook({ secret, rawBody, signature }) {
  if (!secret || !String(secret).trim()) {
    return { ok: false, reason: "missing_secret" };
  }
  if (!signature) {
    return { ok: false, reason: "missing_signature" };
  }

  const hasBody = Buffer.isBuffer(rawBody)
    ? rawBody.length > 0
    : rawBody !== null && rawBody !== undefined && String(rawBody).length > 0;
  if (!hasBody) {
    return { ok: false, reason: "missing_body" };
  }

  const expected = crypto
    .createHmac("sha256", String(secret))
    .update(rawBody)
    .digest("hex");

  if (!signaturesMatch(expected, String(signature))) {
    return { ok: false, reason: "invalid_signature" };
  }

  return { ok: true };
}
