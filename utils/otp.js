import crypto from "crypto";

export function generateOtp() {
  // 6-digit numeric token for easy pickup verification.
  // Pickup codes never expire by time: a code stays valid while its order is
  // `ready_for_pickup` and becomes unusable once verification completes the
  // order (the verifier requires `ready_for_pickup`).
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, "0");
}
