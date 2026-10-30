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

export function amountInWords(paise) {
  const total = Math.max(0, Math.round(Number(paise) || 0));
  const rupees = Math.floor(total / 100);
  const paisePart = total % 100;

  let words;
  if (rupees === 0) {
    words = "Zero";
  } else {
    const parts = [];
    let remaining = rupees;
    const crore = Math.floor(remaining / 10000000);
    remaining %= 10000000;
    const lakh = Math.floor(remaining / 100000);
    remaining %= 100000;
    const thousand = Math.floor(remaining / 1000);
    remaining %= 1000;

    if (crore) parts.push(`${amountInWords(crore * 100).replace(/ Rupees Only$/, "")} Crore`);
    if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
    if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
    if (remaining) parts.push(belowThousand(remaining));
    words = parts.join(" ");
  }

  const rupeeWords = `${words} Rupees`;
  if (paisePart === 0) return `${rupeeWords} Only`;
  return `${rupeeWords} and ${twoDigits(paisePart)} Paise Only`;
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
