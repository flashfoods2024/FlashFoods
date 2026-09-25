import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { signaturesMatch } from "../../utils/signature.js";

const hex = (n) => crypto.randomBytes(n).toString("hex");

test("matching hex signatures → true", () => {
  const a = hex(32);
  assert.equal(signaturesMatch(a, a), true);
});

test("mismatched hex signatures → false", () => {
  assert.equal(signaturesMatch(hex(32), hex(32)), false);
});

test("length-mismatched signatures → false", () => {
  assert.equal(signaturesMatch(hex(32), hex(31)), false);
  assert.equal(signaturesMatch(hex(33), hex(32)), false);
});

test("empty or missing signatures → false", () => {
  assert.equal(signaturesMatch("", hex(32)), false);
  assert.equal(signaturesMatch(hex(32), ""), false);
  assert.equal(signaturesMatch(undefined, hex(32)), false);
  assert.equal(signaturesMatch(hex(32), null), false);
  assert.equal(signaturesMatch(undefined, undefined), false);
});