import test from "node:test";
import assert from "node:assert/strict";
import { generateOtp } from "../../utils/otp.js";

test("generateOtp returns a 6-digit numeric string", () => {
  for (let i = 0; i < 200; i++) {
    const otp = generateOtp();
    assert.equal(typeof otp, "string");
    assert.match(otp, /^\d{6}$/);
  }
});
