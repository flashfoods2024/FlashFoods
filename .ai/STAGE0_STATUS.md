# Stage 0 — Hardening Status

**Status: COMPLETE — VERDICT: STAGE 0 PASS** ✅
**Final audit:** 2026-09-19 (committed-state re-audit; all 9 objectives verified)
**Promoted to Stage 1:** YES
**Scope:** Razorpay-only gateway. Critical/High findings in Razorpay, authentication, refunds, OTP verification, sessions, and order state transitions.

---

## Resolved findings

### CRITICAL

| ID | Finding | Fix |
|----|---------|-----|
| C1 | Open redirect on `/cart/add` — attacker-controlled `redirect` body param shipped an authenticated student (session cookie in request) to an off-domain URL | `safeRedirect()` in `routes/cart.js` accepts only same-origin path-only destinations; applied to all four redirect sites. Commit `fbbcb0c`. |

### HIGH

| ID | Finding | Fix |
|----|---------|-----|
| H2 | Razorpay webhook event-id dedup was a read-modify-write race — two concurrent deliveries of the same event could both win and double-fire notifications + pending counts | `webhookEventId: { $ne: eventId }` moved into the `findOneAndUpdate` precondition for `payment.captured` and `payment.failed`, making the claim atomic. Commit `7dd8c4f`. |

---

## Excluded by scope decision (carried to Stage 1, not blockers for Razorpay-only)

These were identified during audit but were **not** in the Stage 0 scope you set, and none affect the Razorpay path:

- **H1 — No login rate limiter.** Requested to be excluded. Global limiter (300/15min/IP) remains the only brute-force defense. **This is a real authentication weakness and should be Stage 1's first item.**
- **H2 (audit) — Socket.IO has no auth.** `vendor:join` trusts a client-supplied `shopId`; leaks only integer pending counts, no PII.
- **H4 (audit) — Session store is MemoryStore.** No persistence across restarts, leaks memory under load, and blocks post-password-reset session invalidation.
- **H5 (audit) — Easebuzz path.** No gateway amount verification and no refund support. Out of scope (Razorpay-only), but the code is live; either complete or disable gateway selection.
- **C1 (audit) — Analytics cache is dead code.** 7–11 full-collection aggregations per `/admin/analytics/data` request. Performance, not security — but it will be the first thing to break under k6 load.

---

## Verified sound (no action taken)

Confirmed by line-by-line review; these require **no** change:

- **Webhook signature:** verified against the raw body with constant-time comparison (`verifyRazorpayWebhook`); fails closed on missing/empty secret via `resolveWebhookSecret` — an empty HMAC key can never produce a valid verdict.
- **Payment confirmation (`/verify-payment`):** re-fetches the payment from the gateway and requires `captured` + exact-paise amount match (`verifyRazorpayCapturedPayment`) before confirming — not signature-only.
- **Full refunds (`cancelOrderPaid`):** atomic `refundStatus: none → pending` single-flight claim; refunds the authoritative `amountChargedPaise`; no auto-retry (a timed-out refund may have succeeded — retry risks a double refund).
- **Partial refunds (`adjustOrderPaid`):** same atomic claim plus `would_exceed_charged` guard — an adjustment can never raise the amount owed above what was charged.
- **OTP verification:** rate-limited (30/10 min), expiry enforced *before* completion, completes via an atomic `ready_for_pickup` precondition — the code can never complete an order twice.
- **Order state transitions:** every vendor transition (`accept`, `ready`, `verify`) is an atomic `findOneAndUpdate` with a status precondition, so double-clicks and concurrent requests are idempotent.
- **Sessions:** session ID regenerated on login and signup (anti-fixation).
- **No leaked secrets:** `.env` untracked and gitignored; payment secrets excluded from HTML (`placeholder`-only patterns in views); `DebugSession.saveRequest` omits the API key.

---

## Test status

```
npm test → 61 pass, 0 fail
```

Both fixes pass `node --check`; existing test suite unaffected.

---

## Stage 0 Objective Verification Matrix

Final audit performed against the **committed** tree (commits `fbbcb0c`, `7dd8c4f`).

| # | Objective | Verdict |
|---|-----------|---------|
| 1 | Atomic payment transitions | ✅ `webhooks.js:114`, `orders.js:339` — `status:"pending_payment"` is in the atomic precondition |
| 2 | Atomic refund transitions | ✅ `order-cancel.js:38`, `order-adjust.js:70` — `refundStatus: none→pending` single-flight claim |
| 3 | OTP expiry | ✅ `vendor.js:780` expiry checked before completion; `vendor.js:806` atomic `ready_for_pickup` precondition |
| 4 | Razorpay verify re-fetches + validates captured amount | ✅ `orders.js:303` gateway fetch + `verifyRazorpayCapturedPayment` exact-paise match |
| 5 | Refunds use `amountChargedPaise` | ✅ `vendor.js:70` `resolveChargedPaise()`; `order-adjust.js:58` `would_exceed_charged` cap |
| 6 | Integer paise money math | ✅ `utils/money.js` — single round at boundary; rejects `null`/`""` |
| 7 | Session regeneration | ✅ `auth.js:46` (signup), `auth.js:90` (login) — anti-fixation |
| 8 | Webhook signature verification | ✅ `webhooks.js:84` — raw-body, constant-time, fail-closed secret |
| 9 | Order adjust/cancel races fixed | ✅ Atomic claims; no auto-retry (correct — avoids double refund) |

**All nine objectives pass on the committed code. Remaining Stage 0 blockers: none.**

Promoted to Stage 1 — see `STAGE1_ROADMAP.md`.
