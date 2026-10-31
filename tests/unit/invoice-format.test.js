import test from "node:test";
import assert from "node:assert/strict";
import {
  AMOUNT_WORDS_STYLES,
  amountInWords,
  formatPaise,
  formatDateIst,
} from "../../utils/invoice/format.js";

test("amountInWords handles Indian numbering with correct singular/plural", () => {
  assert.equal(amountInWords(0), "Zero Rupees");
  assert.equal(amountInWords(100), "One Rupee");
  assert.equal(amountInWords(200), "Two Rupees");
  assert.equal(amountInWords(1), "Zero Rupees and One Paisa");
  assert.equal(amountInWords(23600), "Two Hundred Thirty Six Rupees");
  assert.equal(
    amountInWords(123456),
    "One Thousand Two Hundred Thirty Four Rupees and Fifty Six Paise",
  );
  assert.equal(
    amountInWords(99999),
    "Nine Hundred Ninety Nine Rupees and Ninety Nine Paise",
  );
  assert.equal(amountInWords(10000000), "One Lakh Rupees");
  assert.equal(
    amountInWords(1234567890),
    "One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees and Ninety Paise",
  );
  assert.equal(
    amountInWords(12345678900),
    "Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Rupees",
  );
});

test("amountInWords never duplicates a suffix the template already prints", () => {
  assert.deepEqual(AMOUNT_WORDS_STYLES, ["full", "noOnly", "wordsOnly"]);

  // Printed label: none (traditional cheque phrasing).
  assert.equal(
    amountInWords(23600, { style: "full" }),
    "Two Hundred Thirty Six Rupees Only",
  );
  // Printed label: "Only".
  assert.equal(
    amountInWords(23600, { style: "noOnly" }),
    "Two Hundred Thirty Six Rupees",
  );
  // Printed label: "Rupees only" (the Well B master): omit currency words and
  // the trailing "Only" so the printed label is not repeated.
  assert.equal(
    amountInWords(23600, { style: "wordsOnly" }),
    "Two Hundred Thirty Six",
  );
  assert.equal(
    amountInWords(23650, { style: "wordsOnly" }),
    "Two Hundred Thirty Six and Fifty Paise",
  );

  // The default is the form that cannot repeat a printed "Only".
  assert.equal(amountInWords(23600), "Two Hundred Thirty Six Rupees");
  // An invalid style falls back instead of producing doubled suffixes.
  assert.equal(
    amountInWords(23600, { style: "nonsense" }),
    "Two Hundred Thirty Six Rupees",
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
