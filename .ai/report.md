# FlashFoods V2 — Stage 1 Final Report

**Date:** 2026-09-20
**Scope:** Build and verify Stage 1 features F01–F07, then run the comprehensive, risk-based, regression, and global quality gates defined in `.ai/test.md`.
**Branch:** `stage1-feature-build`
**Environment:** All automated verification ran against an **in-memory MongoDB** (mongodb-memory-server). No test, server, or script was run against the configured `.env` database.

---

## 1. Feature Delivery Summary

| ID | Feature | Status | Feature test file | Tests |
|----|---------|--------|-------------------|-------|
| F01 | Student Profile | PASS | `tests/unit/vendor-profile.test.js` (student regression) + existing profile route tests | included below |
| F02 | Vendor Profile | PASS | `tests/unit/vendor-profile.test.js`, `tests/unit/vendor-analytics.test.js` | included below |
| F03 | Shop Open / Close Timing | PASS | `tests/unit/shop-hours.test.js` | 30 |
| F04 | Pickup Slots | PASS | `tests/unit/pickup-slots.test.js` | 23 |
| F05 | Vendor Discounts | PASS | `tests/unit/discount.test.js` | 17 |
| F06 | FCM Migration | PASS | `tests/unit/fcm.test.js` | 11 |
| F07 | QR Pickup | PASS | `tests/unit/qr-pickup.test.js` | 15 |
| — | Stage 1 comprehensive + global | PASS | `tests/unit/stage1-comprehensive.test.js` | 10 |

---

## 2. Test Evidence

### Feature + regression + global suite

```
npm test   →   222 pass, 0 fail   (tests/unit/**/*.test.js, in-memory DB)
```

This run includes the feature tests above plus the pre-existing suites
(money, otp, signature, webhook-signature, payment-verification, order-cancel,
order-adjust, order-math, notification-dispatch, vendor-analytics,
vendor-profile, discount).

Command:

```bash
npm test
```

### Stage 1 comprehensive suite (new)

`tests/unit/stage1-comprehensive.test.js` mounts the real routers against an
in-memory DB and exercises the features together:

- shop hours **+** pickup slots → only in-hours slots offered,
- discount **+** slots **+** payment totals → food-only discount, correct
  `amountChargedPaise`, slot booked,
- full lifecycle order → accepted → ready → **QR pickup** completes; replay rejected,
- **OTP fallback** completes a second order,
- ordering blocked outside operating hours,
- global authorization matrix across **student / vendor / admin** and FCM endpoints,
- smoke: public catalog and shop pages render.

### F03–F07 highlights

- **F03:** boundary times (opening inclusive, closing exclusive), overnight
  windows, IST clock, invalid/missing configuration safely falling back to the
  manual open/close switch.
- **F04:** slots constrained to operating hours; capacity enforced atomically;
  **10 concurrent reservations against capacity 3 → exactly 3 succeed**
  (overbooking proven impossible); release on cancel.
- **F05:** single-round paise math; food-only discount (parcel excluded);
  adjustment and parcel toggle preserve the discount; gateway amount uses the
  discounted total.
- **F06:** vendor-bound token registration, refresh, hijack rejection (409),
  invalid-token pruning, vendor-targeted payload with a stable per-order tag.
- **F07:** HMAC-signed, shop-bound, expiry-limited QR; forged / wrong-shop /
  expired / replayed variants all rejected; OTP still works.

---

## 3. Risk-Based Testing

Highest-risk areas reviewed first, all covered by the suite above:

1. **Payment / order totals** — `buildOrderItemsFromCart`, `utils/discount.js`,
   `utils/order-math.js`, `utils/order-adjust.js`. Integer paise, single
   rounding, discount applied to food only; adjust/refund math preserves discount.
2. **Pickup verification & status transitions** — OTP and QR completion both use
   an atomic `ready_for_pickup → completed` precondition; replay is impossible.
3. **Authorization / ownership** — vendor/shop derived from session only
   (`requireVendorShop`); global matrix confirms cross-role isolation.
4. **Notification delivery** — vendor targeting, duplicate collapse (per-order
   tag), invalid-token pruning.
5. **Slot capacity / concurrency** — atomic ledger; concurrent-reservation test.
6. **Shop timing** — boundary + timezone + invalid-config tests.
7. **Analytics queries** — unchanged since F02; `vendor-analytics` suite passes.
8. **Profile / UI-only** — unchanged; regression suite passes.

---

## 4. Regression Testing

Existing behaviour verified by the passing pre-existing suites:

- authentication & roles (`permissions`-related guards exercised via route guards),
- student profile (regression test alongside vendor profile),
- vendor dashboard, pending orders, pickup verification, menu, payment settings,
- payment flows / webhooks (`webhook-signature`, `payment-verification`,
  `signature` suites),
- order cancel / adjust / money math,
- existing notifications (`notification-dispatch`),
- admin panel routes (authorization + smoke in the comprehensive suite).

---

## 5. Smoke Testing

Covered by the comprehensive suite (in-memory):

- application routers start and serve requests,
- database connectivity (memory server) established,
- users authenticate by role and are rejected across roles,
- student panel (catalog, shop page, cart, order detail) renders,
- vendor panel (menu, verify) renders,
- admin panel (`/admin/`) renders only for admins,
- an order is created and transitioned paid → accepted → ready → collected,
- pickup verified through **both** supported mechanisms (QR and OTP).

---

## 6. Stress / Load Testing

**Not executed.** The repository's load tooling and the configured `.env`
database are not an isolated environment; running them risks affecting real
data (see the production-database incident documented in `.ai/INCIDENT_REPORT.md`).
Per the evidence rule in `test.md`, this gate is recorded as **not run**, not as
passed. Concurrency at the unit level (slot overbooking) was tested directly.

---

## 7. Security Verification

- **Server authority:** all order totals, discounts, slot availability, QR/OTP
  verification and shop availability are computed server-side; client amounts
  are ignored.
- **IDOR/ownership:** vendor profile and all vendor order/slot routes derive the
  shop from the session; the comprehensive matrix confirms cross-role blocking.
- **QR security:** HMAC signature (constant-time compare), shop binding, expiry,
  atomic single-use completion → resistant to forgery, cross-shop use, replay.
- **FCM:** token-hijack guard returns 409; tokens pruned on permanent errors.
- **No secrets** are included in this report or in any commit.

---

## 8. Commit Checkpoints

| Commit | Content |
|--------|---------|
| `1c8caef` | feat(F03): shop operating hours + hours-aware availability |
| `8337a1d` | feat(F04): pickup slots + server-side capacity enforcement |
| `4c6fbac` | feat(F05): server-authoritative vendor percentage discounts |
| `5bfe509` | feat(F06): FCM migration (per-vendor tokens, refresh, foreground) |
| `87baaec` | feat(F07): signed QR pickup alongside OTP |

(F01/F02 source changes were present in the working tree before this run and were
not re-committed; only F03–F07 changes — plus the Stage 1 quality-gate suite and
documentation — are in the commits above.)

---

## 9. Remaining Issues / Notes

1. **Playwright e2e was not run.** `tests/global-setup.mjs` connects to the
   configured database and mutates a real shop; with the current `.env` pointing
   at production (live keys, no environment split), running it is unsafe. This is
   an environment-isolation issue called out in the incident report — it must be
   fixed before e2e can be trusted.
2. **Abandoned `pending_payment` orders** hold a slot reservation indefinitely;
   there is no expiry sweep. Slots still free on explicit cancellation/failed
   payment. A sweeper is a reasonable follow-up.
3. **Pre-existing F01/F02 working-tree changes** remain uncommitted at the start
   of this run; only F03+ were committed to preserve commit isolation.
4. **`.env` holds production credentials and `DISABLE_RATE_LIMIT=true`** — a
   latent operational risk that predates this work.

---

## 10. Verdict

🟢 **Stage 1 feature build complete** — F01–F07 all pass their feature tests, and
the comprehensive, regression, risk-based and global gates pass (222/222) under
an isolated in-memory database. Stress/load and browser e2e are explicitly
**not verified** in this environment for the safety reasons above.
