# FlashFoods Bug Report (QA 2026-09-24)

No Critical or High severity functional bugs were found in the audited flows. All 68 live checks passed.

## Medium

### M1 — Playwright E2E suite unrunnable: fixture vendor missing from DB
- **Module:** test infrastructure (`tests/global-setup.mjs`)
- **Steps:** `npx playwright test tests/smoke.spec.js` → global-setup throws `QA fixture missing: shop=true vendor=false`; teardown then resets the `testing` shop to disabled.
- **Expected:** suite runs against documented fixtures.
- **Actual:** `test.vendor@flashfoods.test` does not exist in the database, so every Playwright run aborts before any test.
- **Root cause:** fixtures were never seeded in this database (or were cleaned without re-seed); setup has no fallback.
- **Fix recommendation:** seed the fixture vendor + `testing`-shop link (e.g. extend `seed.js` or make global-setup create-then-teardown fixtures instead of requiring them).

## Low

### L1 — `/shops/:slug` returns bare 302 for disabled/nonexistent shops
- **Module:** shop routing. Verified: 302 while `testing` was admin-disabled, 200 when enabled.
- **Assessment:** acceptable behavior (no error leak, no crash). Listed for completeness; no fix required unless a branded 404 page is desired.

## Ruled out (investigated, NOT bugs)
- **Login "failure" during QA:** investigator used a mistyped email (`student-001` vs actual `student-1`); auth works correctly.
- **Checkout → `/cart` redirect:** correct rejection — "Please choose a valid pickup slot" (shop has slots enabled; request omitted `pickupTime`).
- **Vendor/shop link asymmetry:** verified symmetric (`shop.vendor` === new vendor id after admin create); `syncVendorShopLink` correctly unlinks previous holders.
- **Expired-QR decode flakiness:** QR-reader library limitation on non-QR embedded PNGs, not app data; resolved by targeting the pickup-QR `<img>`.
