import test from "node:test";
import assert from "node:assert/strict";
import {
  generateOtp,
  otpExpiryFrom,
  isOtpExpired,
  OTP_TTL_MS,
} from "../../utils/otp.js";

test("generateOtp returns a 6-digit numeric string", () => {
  for (let i = 0; i < 200; i++) {
    const otp = generateOtp();
    assert.equal(typeof otp, "string");
    assert.match(otp, /^\d{6}$/);
  }
});

test("otpExpiryFrom returns a timestamp exactly ttl ahead", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const exp = otpExpiryFrom(now, 60_000);
  assert.equal(exp.getTime() - now.getTime(), 60_000);
});

test("default OTP TTL is 30 minutes", () => {
  assert.equal(OTP_TTL_MS, 30 * 60 * 1000);
  const now = new Date();
  const exp = otpExpiryFrom(now);
  assert.equal(exp.getTime() - now.getTime(), OTP_TTL_MS);
});

test("isOtpExpired is false before expiry and true at/after it", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const future = new Date(now.getTime() + 1000);
  const past = new Date(now.getTime() - 1000);

  assert.equal(isOtpExpired(future, now), false);
  assert.equal(isOtpExpired(past, now), true);
  // Boundary: expiry instant itself counts as expired.
  assert.equal(isOtpExpired(now, now), true);
});

test("missing expiry is backward compatible (legacy orders never expire)", () => {
  assert.equal(isOtpExpired(null), false);
  assert.equal(isOtpExpired(undefined), false);
});

test("malformed expiry fails closed", () => {
  assert.equal(isOtpExpired("not-a-date"), true);
  assert.equal(isOtpExpired(new Date("invalid")), true);
});
