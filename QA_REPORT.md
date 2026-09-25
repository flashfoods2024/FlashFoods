# FlashFoods QA Report

**Date:** 2026-09-24 (UTC) | **Target:** live server `http://127.0.0.1:3000` (remote Atlas DB, `canteenDB`)
**Scope:** Phases 1–14 per QA mission. Fixtures: `testing` shop + `qa-test-automation-*` identities only. No production data touched.
**Method:** HTTP end-to-end driver (`qa-run.mjs`, 68 assertions), Playwright Chromium screenshots (14 page/viewport combos), full unit suite (`npm test`, 266 tests).

## Results by phase

| Phase | Checks | Pass | Fail |
|---|---|---|---|
| 1 Smoke (startup, routes, EJS, sessions) | 7 | 7 | 0 |
| 2 Auth (register/login/logout, invalid creds, all roles) | 11 | 11 | 0 |
| 3 Shop (fixture link, visibility, slug routing) | 3 | 3 | 0 |
| 4 Menu (create/update/toggle/delete-visibility) | 5 | 5 | 0 |
| 5 Cart (add/qty/total/remove/empty) | 4 | 4 | 0 |
| 6 Lifecycle (paid→accepted→ready→completed; illegal blocked) | 8 | 8 | 0 |
| 7 F06.5 notification hook (code + unit suite) | — | intact | 0 |
| 8 F07 QR (decode, HMAC, expiry, wrong-shop, replay, forged, handover) | 12 | 12 | 0 |
| 9 OTP (reject-bad, no-mutation, parity, pickupMethod) | 4 | 4 | 0 |
| 10 Security (IDOR, role escalation, anon, forged) | 6 | 6 | 0 |
| 11 Regression (populated-shop token, Accept-header) | 3 | 3 | 0 |
| 12 UI/mobile (0px overflow × 14, screenshots) | 14 | 14 | 0 |
| 13 Load (10/50/100 concurrent, 0 errors, ~2ms avg) | 3 | 3 | 0 |
| 14 Acid (105 random ops, legal terminal state) | 1 | 1 | 0 |
| Cleanup (0 qa docs remain, shop restored) | 2 | 2 | 0 |

**Unit suite:** 266/266 pass. **HTTP E2E:** 68/68 pass.

## Verdict: PASS

No critical bugs, no state violations, no security bypasses, no broken flows, no replay vulnerability, no payment-state violations, no data corruption. Details: `BUG_REPORT.md`, `SECURITY_REPORT.md`, `REGRESSION_REPORT.md`.

## Notes
- During QA, two script-side (not app) issues were triaged: pickup-slot selection is mandatory at checkout for the `testing` shop (correct behavior), and item availability toggles via `PATCH /menu/:id/toggle`.
- Pre-existing Playwright fixture vendor (`test.vendor@flashfoods.test`) is absent from the DB, so the repo's Playwright workflow specs cannot run as-is (infra gap, not a prod bug — see `BUG_REPORT.md`).
- Cleanup verified: 0 `qa-test-automation-*` users/items/orders remain; `testing` shop flags restored to pre-run values.
- 7 orphaned `paymentNote:"mock"` orders from earlier (non-QA) runs were observed and deliberately left untouched per the never-touch-others'-data rule.
