import crypto from "crypto";

export function generateOtp() {
  // 6-digit numeric token for easy pickup verification
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, "0");
}

