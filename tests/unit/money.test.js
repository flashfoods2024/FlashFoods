import test from "node:test";
import assert from "node:assert/strict";
import { toPaise, fromPaise } from "../../utils/money.js";

test("toPaise converts rupees to integer paise", () => {
  assert.equal(toPaise(60), 6000);
  assert.equal(toPaise(0.1), 10);
  assert.equal(toPaise(19.99), 1999);
  assert.equal(toPaise("12.345"), 1235); // single rounding at the boundary
  assert.equal(toPaise(0), 0);
});

test("toPaise returns null for non-finite input", () => {
  assert.equal(toPaise("abc"), null);
  assert.equal(toPaise(Infinity), null);
  assert.equal(toPaise(undefined), null);
  assert.equal(toPaise(null), null);
});

test("fromPaise converts integer paise back to rupees", () => {
  assert.equal(fromPaise(6000), 60);
  assert.equal(fromPaise(1235), 12.35);
  assert.equal(fromPaise(0), 0);
  assert.equal(fromPaise("abc"), null);
});

test("round-trip is exact for representable rupee amounts", () => {
  for (const v of [0, 1, 15, 19.99, 100, 1234.56]) {
    assert.equal(fromPaise(toPaise(v)), v);
  }
});
