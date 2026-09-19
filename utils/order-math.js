import { toPaise } from "./money.js";

/**
 * Normalize a `keep_items` payload into a sorted, de-duplicated list of item
 * indices. Fails closed: any out-of-range, negative or non-numeric index is
 * rejected outright rather than silently dropped.
 *
 * @returns {{ ok: true, indices: number[] } | { ok: false, reason: string, value?: unknown }}
 */
export function normalizeKeepIndices(rawKeep, itemCount) {
  const count = Number(itemCount);
  if (!Number.isInteger(count) || count <= 0) {
    return { ok: false, reason: "no_items" };
  }

  let arr;
  if (rawKeep === undefined || rawKeep === null) arr = [];
  else if (Array.isArray(rawKeep)) arr = rawKeep;
  else arr = [rawKeep];

  const seen = new Set();

  for (const raw of arr) {
    if (typeof raw !== "string" && typeof raw !== "number") {
      return { ok: false, reason: "invalid_index", value: raw };
    }
    const s = String(raw).trim();
    if (!/^\d+$/.test(s)) {
      return { ok: false, reason: "invalid_index", value: raw };
    }
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0 || n >= count) {
      return { ok: false, reason: "out_of_range", value: raw };
    }
    seen.add(n);
  }

  return { ok: true, indices: [...seen].sort((a, b) => a - b) };
}

/**
 * Compute the adjusted total (integer paise) for an order after removing items.
 * Kept items are summed in paise; parcel charge is added back when the order is
 * a parcel order.
 *
 * @returns {{ ok: true, updatedPaise: number } | { ok: false, reason: string }}
 */
export function computeAdjustedTotals({
  items,
  keepIndices,
  orderType,
  parcelChargePaise = 0,
}) {
  const list = Array.isArray(items) ? items : [];
  const keepSet = new Set(keepIndices || []);

  if (keepSet.size === 0) return { ok: false, reason: "all_removed" };
  if (keepSet.size >= list.length) return { ok: false, reason: "none_removed" };

  let foodPaise = 0;
  for (let i = 0; i < list.length; i++) {
    if (!keepSet.has(i)) continue;
    const unitPaise = toPaise(list[i].price);
    const qty = Number(list[i].quantity);
    if (unitPaise === null || !Number.isInteger(qty) || qty <= 0) {
      return { ok: false, reason: "invalid_item" };
    }
    foodPaise += unitPaise * qty;
  }

  const parcel = orderType === "parcel" ? Math.max(0, Number(parcelChargePaise) || 0) : 0;
  return { ok: true, updatedPaise: foodPaise + parcel };
}

/**
 * Recompute an order's total (integer paise) from its items plus the parcel
 * charge for the target order type. Replaces the old float `+= / -=` deltas.
 */
export function computeParcelTotals({ items, orderType, parcelChargePaise = 0 }) {
  const list = Array.isArray(items) ? items : [];
  let foodPaise = 0;
  for (const item of list) {
    const unitPaise = toPaise(item.price);
    const qty = Number(item.quantity);
    if (unitPaise === null || !Number.isInteger(qty) || qty <= 0) {
      return { ok: false, reason: "invalid_item" };
    }
    foodPaise += unitPaise * qty;
  }
  const parcel =
    orderType === "parcel" ? Math.max(0, Number(parcelChargePaise) || 0) : 0;
  return { ok: true, totalPaise: foodPaise + parcel, parcelChargePaise: parcel };
}
