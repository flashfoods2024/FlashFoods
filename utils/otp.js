import crypto from "crypto";
import { OTP_TTL_MS } from "./constants.js";

export { OTP_TTL_MS };

export function generateOtp() {
  // 6-digit numeric token for easy pickup verification
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, "0");
}

// Absolute expiry timestamp for a code issued at `now`. Callers persist this
// alongside the OTP so the verification path can reject stale codes.
export function otpExpiryFrom(now = new Date(), ttlMs = OTP_TTL_MS) {
  const base = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return new Date(base + ttlMs);
}

// Whether `expiresAt` is in the past relative to `now`.
//
// Backward compatibility: legacy orders were created before expiry existed and
// have no timestamp. A missing expiry means "no expiry recorded" and is left
// alone so already-issued pickup codes keep working. A malformed timestamp,
// however, fails closed (treated as expired) because it cannot be trusted.
export function isOtpExpired(expiresAt, now = new Date()) {
  if (expiresAt === null || expiresAt === undefined) return false;

  const exp = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  if (Number.isNaN(exp)) return true;

  const ref = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return ref >= exp;
}
