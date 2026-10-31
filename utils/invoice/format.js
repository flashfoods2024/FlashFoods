// Display formatting for invoice values. All money comes from integer paise.
const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

function twoDigits(value) {
  const n = Number(value);
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${TENS[tens]}${ones ? " " + ONES[ones] : ""}`;
}

function belowThousand(value) {
  const n = Number(value);
  if (n < 100) return twoDigits(n);
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return `${ONES[hundreds]} Hundred${rest ? " " + twoDigits(rest) : ""}`;
}

/**
 * How the currency suffix is presented. Vendor invoice PDFs differ: some print
 * the full phrase, some print only "Only", and some already print
 * "Rupees only" as static text next to an empty value box. Printing our own
 * suffix in front of a printed one produced "One Rupees Only ... Rupees only"
 * on the Well B invoice.
 *
 *   full      → "Two Hundred Rupees and Fifty Paise Only"
 *   noOnly    → "Two Hundred Rupees and Fifty Paise"      (default)
 *   wordsOnly → "Two Hundred and Fifty Paise"             (PDF prints currency)
 */
export const AMOUNT_WORDS_STYLES = ["full", "noOnly", "wordsOnly"];
export const DEFAULT_AMOUNT_WORDS_STYLE = "noOnly";

/** Indian-numbering words for a whole number, without any currency word. */
function indianWords(value) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  if (n === 0) return "Zero";

  const parts = [];
  let remaining = n;
  const crore = Math.floor(remaining / 10000000);
  remaining %= 10000000;
  const lakh = Math.floor(remaining / 100000);
  remaining %= 100000;
  const thousand = Math.floor(remaining / 1000);
  remaining %= 1000;

  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (remaining) parts.push(belowThousand(remaining));
  return parts.join(" ");
}

export function amountInWords(paise, { style = DEFAULT_AMOUNT_WORDS_STYLE } = {}) {
  const total = Math.max(0, Math.round(Number(paise) || 0));
  const rupees = Math.floor(total / 100);
  const paisePart = total % 100;
  const resolvedStyle = AMOUNT_WORDS_STYLES.includes(style)
    ? style
    : DEFAULT_AMOUNT_WORDS_STYLE;

  const rupeeWords = indianWords(rupees);
  // "One Paisa" / "One Rupee" are singular; everything else is plural. The old
  // implementation always said "Rupees", which read as "One Rupees Only".
  const paiseWords = paisePart
    ? `${paisePart === 1 ? "One Paisa" : `${twoDigits(paisePart)} Paise`}`
    : "";

  if (resolvedStyle === "wordsOnly") {
    return paiseWords ? `${rupeeWords} and ${paiseWords}` : rupeeWords;
  }

  const currency = rupees === 1 ? "Rupee" : "Rupees";
  const body = paiseWords
    ? `${rupeeWords} ${currency} and ${paiseWords}`
    : `${rupeeWords} ${currency}`;
  return resolvedStyle === "full" ? `${body} Only` : body;
}

export function formatPaise(paise) {
  const value = Math.round(Number(paise) || 0) / 100;
  const sign = value < 0 ? "-" : "";
  const body = Math.abs(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}\u20B9${body}`;
}

const IST = "Asia/Kolkata";

export function formatDateIst(date) {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-IN", {
    timeZone: IST,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatTimeIst(date) {
  if (!date) return "";
  return new Date(date).toLocaleTimeString("en-IN", {
    timeZone: IST,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTimeIst(date) {
  if (!date) return "";
  return new Date(date).toLocaleString("en-IN", {
    timeZone: IST,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
