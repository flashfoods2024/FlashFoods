import test from "node:test";
import assert from "node:assert/strict";
import {
  amountInWords,
  formatPaise,
  formatDateIst,
} from "../../utils/invoice/format.js";

test("amountInWords handles Indian numbering", () => {
  assert.equal(amountInWords(0), "Zero Rupees Only");
  assert.equal(amountInWords(100), "One Rupees Only");
  assert.equal(amountInWords(23600), "Two Hundred Thirty Six Rupees Only");
  assert.equal(amountInWords(123456), "One Thousand Two Hundred Thirty Four Rupees and Fifty Six Paise Only");
  assert.equal(amountInWords(99999), "Nine Hundred Ninety Nine Rupees and Ninety Nine Paise Only");
  assert.equal(
    amountInWords(10000000),
    "One Lakh Rupees Only",
  );
  assert.equal(
    amountInWords(1234567890),
    "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees and Ninety Paise Only",
  );
  assert.equal(
    amountInWords(12345678900),
    "Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Rupees Only",
  );
});

test("formatPaise uses en-IN grouping and the rupee sign", () => {
  assert.equal(formatPaise(0), "\u20B90.00");
  assert.equal(formatPaise(23600), "\u20B9236.00");
  assert.equal(formatPaise(123456789), "\u20B912,34,567.89");
  assert.equal(formatPaise(-2400), "-\u20B924.00");
});

test("formatDateIst renders IST dates", () => {
  assert.equal(formatDateIst(new Date("2026-10-30T14:05:00.000Z")), "30/10/2026");
  assert.equal(formatDateIst(null), "");
});
