// Integer-paise money helpers. All new financial math must go through these so
// no floating-point rupees ever enter a calculation or a gateway payload.

/**
 * Convert a rupee amount to integer paise. Returns null for non-finite input.
 * Uses Math.round only once, at the conversion boundary.
 */
export function toPaise(amount) {
  // Number(null) === 0 and Number("") === 0, which would silently turn a
  // missing amount into zero paise. Reject those explicitly.
  if (amount === null || amount === undefined || amount === "") return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * Convert integer paise back to a rupee Number for storage in legacy rupee
 * fields (`total`, `refundAmount`, …). Returns null for non-finite input.
 */
export function fromPaise(paise) {
  if (paise === null || paise === undefined || paise === "") return null;
  const n = Number(paise);
  if (!Number.isFinite(n)) return null;
  return Math.round(n) / 100;
}
