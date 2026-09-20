import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeKeepIndices,
  computeAdjustedTotals,
  computeParcelTotals,
} from "../../utils/order-math.js";

const items = [
  { name: "A", price: 100, quantity: 1 },
  { name: "B", price: 50, quantity: 2 },
  { name: "C", price: 25, quantity: 1 },
];

test("normalizeKeepIndices accepts single and multi values", () => {
  assert.deepEqual(normalizeKeepIndices("0", 3), { ok: true, indices: [0] });
  assert.deepEqual(normalizeKeepIndices(["2", "0"], 3), {
    ok: true,
    indices: [0, 2],
  });
  assert.deepEqual(normalizeKeepIndices([0, 1], 3), { ok: true, indices: [0, 1] });
});

test("normalizeKeepIndices de-duplicates without inflating the count", () => {
  assert.deepEqual(normalizeKeepIndices(["0", "0", "0"], 3), {
    ok: true,
    indices: [0],
  });
});

test("normalizeKeepIndices rejects out-of-range indices (attack: keep_items=999)", () => {
  const r = normalizeKeepIndices(["999"], 3);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "out_of_range");
});

test("normalizeKeepIndices rejects negative, non-numeric and object values", () => {
  for (const bad of [["-1"], ["abc"], [{}], [1.5], [null]]) {
    const r = normalizeKeepIndices(bad, 3);
    assert.equal(r.ok, false, `expected reject for ${JSON.stringify(bad)}`);
  }
});

test("normalizeKeepIndices fails closed when there are no items", () => {
  assert.equal(normalizeKeepIndices([], 0).reason, "no_items");
});

test("computeAdjustedTotals sums kept items in paise", () => {
  // keep A (100x1) -> 10000 paise
  assert.deepEqual(
    computeAdjustedTotals({ items, keepIndices: [0], orderType: "dinein" }),
    { ok: true, updatedPaise: 10000, discountPaise: 0 },
  );
  // keep B (50x2) + C (25x1) -> 12500 paise
  assert.deepEqual(
    computeAdjustedTotals({ items, keepIndices: [1, 2], orderType: "dinein" }),
    { ok: true, updatedPaise: 12500, discountPaise: 0 },
  );
});

test("computeAdjustedTotals rejects all-removed and none-removed", () => {
  assert.equal(
    computeAdjustedTotals({ items, keepIndices: [], orderType: "dinein" }).reason,
    "all_removed",
  );
  assert.equal(
    computeAdjustedTotals({ items, keepIndices: [0, 1, 2], orderType: "dinein" })
      .reason,
    "none_removed",
  );
});

test("computeAdjustedTotals adds parcel charge only for parcel orders", () => {
  assert.deepEqual(
    computeAdjustedTotals({
      items,
      keepIndices: [0],
      orderType: "parcel",
      parcelChargePaise: 500,
    }),
    { ok: true, updatedPaise: 10500, discountPaise: 0 },
  );
});

test("computeAdjustedTotals fails closed on invalid item quantities", () => {
  const bad = [
    { name: "X", price: 10, quantity: 0 },
    { name: "Y", price: 20, quantity: 1 },
  ];
  assert.equal(
    computeAdjustedTotals({ items: bad, keepIndices: [0], orderType: "dinein" })
      .reason,
    "invalid_item",
  );
});

test("computeParcelTotals recomputes totals without float deltas", () => {
  assert.deepEqual(
    computeParcelTotals({ items, orderType: "parcel", parcelChargePaise: 500 }),
    { ok: true, totalPaise: 23000, parcelChargePaise: 500, discountPaise: 0 },
  );
  assert.deepEqual(
    computeParcelTotals({ items, orderType: "dinein", parcelChargePaise: 500 }),
    { ok: true, totalPaise: 22500, parcelChargePaise: 0, discountPaise: 0 },
  );
});

test("computeParcelTotals applies a discount to the food subtotal only", () => {
  // food = 22500 paise, 10% discount = 2250, parcel 500 is never discounted.
  assert.deepEqual(
    computeParcelTotals({
      items,
      orderType: "parcel",
      parcelChargePaise: 500,
      discountPercent: 10,
    }),
    { ok: true, totalPaise: 20750, parcelChargePaise: 500, discountPaise: 2250 },
  );
});

test("computeAdjustedTotals applies the order discount to kept items", () => {
  // keep A (10000 paise), 20% discount = 2000.
  assert.deepEqual(
    computeAdjustedTotals({
      items,
      keepIndices: [0],
      orderType: "dinein",
      discountPercent: 20,
    }),
    { ok: true, updatedPaise: 8000, discountPaise: 2000 },
  );
});
