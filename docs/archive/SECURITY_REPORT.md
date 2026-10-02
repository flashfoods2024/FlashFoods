# FlashFoods Security Report (QA 2026-09-24)

Live adversarial checks against the running server. All attacks rejected.

## Results

| Attack | Target | Result |
|---|---|---|
| Cross-student order read (`GET /orders/:id` of another student) | IDOR / privacy | BLOCKED (302, no data leak) |
| Student `POST /vendor/verify-qr` with valid QR | Role escalation | BLOCKED (302 to login) |
| Student `GET /admin/vendors` | Admin boundary | BLOCKED |
| Vendor `GET /admin/vendors` | Admin boundary | BLOCKED |
| Anonymous `GET /vendor/orders/pending` | Auth boundary | BLOCKED (302) |
| Tampered QR (order-id swap, valid structure) | Forgery | REJECTED 400 (forged) |
| Garbage QR payload | Malformed | REJECTED 400 |
| Replayed QR after completion | Replay / double-spend | REJECTED 409, single completion preserved |
| Wrong-OTP / unknown OTP | OTP forgery | REJECTED 404, zero mutation |
| Empty-cart checkout | Fraud invariant | REJECTED (redirect, no order) |
| Mock checkout confinement | Payment fraud | Server hard-blocks non-`testing` shops with 403 (`routes/orders.js`) |
| Concurrent duplicate scans (unit) | Race / single-flight | Exactly one 200 + one 409; atomic `findOneAndUpdate` precondition |
| 105-op randomized abuse (accept×2, complete×2, replay, invalid OTP, cancel) | Acid | Legal terminal state, `collectedAt` invariant intact |

## Defense-in-depth observed (code-verified)
- HMAC-SHA256 QR tokens, constant-time compare, shop binding. Pickup credentials never expire by time; validity is the order's `ready_for_pickup` status, invalidated by completion.
- Ownership derived from session (`requireVendorShop`); no client-supplied shop/vendor trust.
- Session regeneration on login/logout (anti-fixation); disabled accounts cannot log in.
- No rate limiting (removed by product policy); Helmet, session, CSRF origin protection, and auth/authorization remain active.
- OTP lookup scoped to `{ shop, pickupOtp, status: ready_for_pickup }` + atomic completion; no time-based expiry.

## Recommendation
- Resolve M1 in `BUG_REPORT.md` so Playwright permission specs (`tests/permissions.spec.js`) run in CI again — they are the automated guard for these boundaries.
