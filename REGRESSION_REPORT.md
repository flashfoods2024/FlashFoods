# FlashFoods Regression Report (QA 2026-09-24)

## R1 — QR populated-shop bug (`[object Object]` shop segment)
- **Status:** FIXED and verified end-to-end.
- **Evidence:** decoded live student QR from `/orders/:id` at `ready_for_pickup`:
  `v1.6ab5b2fc….<24-hex shop>.1790294560779.<sig>` — strict `v1.24hex.24hex.exp.sig` format, no `[object Object]`.
- **Behavioral proof:** the decoded token completed `ready_for_pickup → completed` with `pickupMethod=qr` (a corrupted token would 404 on `wrong_shop`).
- **Unit guard:** `tests/unit/qr-pickup.test.js` ("populated shop object still yields a valid QR token").

## R2 — Accept-header content-negotiation bug (raw JSON page on form POST)
- **Status:** FIXED and verified end-to-end.
- **Evidence:** form POST with real browser header (`text/html,…,*/ *;q=0.8`) renders the HTML handover page (`Content-Type: text/html`, `handover-card` present); `Accept: application/json` still returns the JSON handover payload.
- **Unit guards:** `tests/unit/f07-pickup.test.js` (browser-header render test + JSON-path test).

## R3 — F07 workflow invariants (re-verified, no drift)
- `ready_for_pickup → completed` only; no `picked_up`/intermediate states (codebase grep clean).
- No pickup-confirmation button on pending, verify, or handover surfaces (asserted in tests + screenshots).
- QR and OTP produce identical terminal state (`completed` + `collectedAt`); method recorded (`qr` vs `otp`).
- F06.5 ready-notification hook untouched; `order-ready-notification` unit tests green; full suite 266/266.

## R4 — Previously fixed stabilization items (spot-checked, intact)
- Past-pickup-time validation, double-submit guards (accept/ready atomic preconditions), parcel-charge math (cart total 3×80=240 verified live), pickup-time banner, vendor nav scoping — all observed working during this run.
