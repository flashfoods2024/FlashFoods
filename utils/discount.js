// Vendor discount logic.
//
// A shop may enable a percentage discount that applies to the FOOD subtotal
// (never to the parcel/packaging charge). All calculation is authoritative on
// the server in integer paise with a single rounding step, so the browser can
// never influence the charged amount.

const MAX_DISCOUNT_PERCENT = 100;

// Normalize a submitted percentage to a finite number in [0, 100] rounded to
// two decimals, or null when invalid. "0"/""/null are treated as invalid here
// (callers decide whether that means "disabled").
export function normalizeDiscountPercent(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > MAX_DISCOUNT_PERCENT) return null;
  return Math.round(n * 100) / 100;
}

// Effective discount for a shop. Anything invalid/disabled collapses to zero,
// so a malformed stored value can never discount an order.
export function getShopDiscount(shop) {
  const discount = shop?.discount;
  if (!discount || discount.enabled !== true) return { enabled: false, percent: 0 };
  const percent = normalizeDiscountPercent(discount.percent);
  if (percent === null || percent <= 0) return { enabled: false, percent: 0 };
  return { enabled: true, percent };
}

// Discount amount in integer paise for a food subtotal. Single rounding step;
// clamped to [0, foodPaise] so a total can never go negative.
export function computeDiscountPaise(foodPaise, percent) {
  const food = Number(foodPaise);
  if (!Number.isFinite(food) || food <= 0) return 0;
  const p = normalizeDiscountPercent(percent);
  if (p === null || p <= 0) return 0;
  const discount = Math.round((food * p) / 100);
  return Math.max(0, Math.min(food, discount));
}

// Validate the vendor/admin discount form.
// Returns { ok: true, settings } or { ok: false, error }.
export function validateDiscountSettings(raw = {}) {
  const enabled =
    raw.enabled === true ||
    raw.enabled === "true" ||
    raw.enabled === "on" ||
    raw.enabled === "1" ||
    raw.enabled === 1;

  if (!enabled) {
    return { ok: true, settings: { enabled: false, percent: 0 } };
  }

  const percent = normalizeDiscountPercent(raw.percent);
  if (percent === null || percent <= 0) {
    return {
      ok: false,
      error: "Discount percentage must be greater than 0 and at most 100.",
    };
  }

  return { ok: true, settings: { enabled: true, percent } };
}
