import crypto from "crypto";

// Constant-time signature comparison to avoid timing attacks.
export function signaturesMatch(expectedHex, actualHex) {
  if (!expectedHex || !actualHex) return false;
  const a = Buffer.from(expectedHex, "utf8");
  const b = Buffer.from(actualHex, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}