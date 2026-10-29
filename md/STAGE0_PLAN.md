# FlashFoods — Stage 0 Plan (Money/Auth Hardening)

**Status: implemented (Stage 0 closed).** This merges the two historical planning reports that used
to live in `md/`:

- `STAGE0_HARDENING_PLAN.md` — blocker analysis, severity and remediation design.
- `STAGE0_EXECUTION_PLAN.md` — atomic task/commit breakdown and regression checklist.

Merged 2026-10-29, with the implementation outcome verified against source that day. It is kept as
design/decision evidence, not as an open to-do list. The React/V2 migration that these blockers
gated never started — see `MIGRATION_ASSESSMENT.md`.

> Verification scope: source inspection of the cited modules plus the unit suite
> (`npm test`, 301 passing on 2026-10-29). Live Razorpay/PhonePe/Easebuzz sandbox flows were **not**
> run during this review.

---

## 1. Why Stage 0 existed

The planned SPA would call order and payment mutations concurrently (double-click, retries,
realtime refetch). Five blockers made that unsafe:

| # | Blocker | Severity | Risk |
|---|---|---|---|
| B1 | Money-mutating order transitions were read-modify-write (`findById` → mutate → `save()`) | Critical | lost updates, double refunds/cancels, duplicate notifications |
| B2 | `verify-payment` used `===` on the HMAC, never checked the captured amount, and was not idempotent | Critical | forged/replayed confirmation, amount manipulation |
| B3 | No CSRF protection, session not regenerated on login/signup, weak cookie flags | High | cross-site state-changing POSTs, session fixation |
| B4 | FCM register upsert keyed on `{token}` only | High | another authenticated vendor could steal a push token |
| B5 | No `/api/auth/me`; mixed error bodies | Medium | SPA could not hydrate identity or handle errors uniformly |

---

## 2. Blocker detail, remediation and outcome

### B1 — Atomic order transitions

**Original problem.** Eight handlers read an order, checked its status in JS, mutated and saved.
Concurrent requests could both pass the check.

**Designed fix.** Replace each with `findOneAndUpdate` carrying the expected pre-state:
`paid → accepted`, `accepted → ready_for_pickup`, `ready_for_pickup → completed` (OTP/QR),
`paid → cancelled` (with a `refundStatus` claim), adjust on `paid|accepted`, parcel toggle only on
`pending_payment`. Lost races return 409 (JSON) or flash+redirect (legacy). Side effects
(`emitPendingCount`, FCM) fire only when the update won.

**Outcome (verified 2026-10-29).**
- accept/ready/OTP/QR/parcel toggle use status/order-type preconditions in `routes/vendor.js`;
  admin parcel toggle mirrors it in `routes/admin.js`.
- Cancellation and adjustment are single-flight through `utils/order-cancel.js` and
  `utils/order-adjust.js`: the atomic `refundStatus: none → pending` claim decides who calls the
  gateway, and failures land in `refundStatus: failed` for manual reconciliation.
- The proposed shared `utils/order-state.js` / `transitionOrder()` helper was **not** built; each
  handler calls `findOneAndUpdate` directly. Behavior is correct; the duplication remains (see
  `docs/TECH_DEBT.md`).

### B2 — `verify-payment` signature, amount and idempotency

**Original problem.** `expectedSign === razorpay_signature` (timing-attackable), no captured-amount
check, and a find→save transition that two requests could pass.

**Designed fix.** Shared timing-safe compare, fetch the payment from Razorpay and require
`captured` + `currency INR` + exact paise equality, then atomically claim `pending_payment → paid`
with an idempotency key and return success for replays.

**Outcome (verified).**
- `utils/signature.js` provides `signaturesMatch()` using `crypto.timingSafeEqual` with a length
  guard; `routes/webhooks.js` and `routes/orders.js` use it.
- `utils/payment-verification.js` fails closed on missing/mismatched amounts and also verifies
  PhonePe completed payments (`normalizePhonePeAmountPaise`).
- `routes/orders.js` transitions atomically, stores `amountChargedPaise`, and treats replays as
  already-paid successes. The Razorpay webhook remains the second, idempotent path
  (`webhookEventId`).

### B3 — CSRF, session and cookie

**Original problem.** No CSRF protection; `sameSite` commented out; no `secure`; login/signup set
`session.userId` without regenerating the session.

**Designed fix.** `SameSite=Lax` + `secure` in production + fail-fast on missing `SESSION_SECRET`;
`session.regenerate()` before authenticating; CSRF verification for every non-GET (double-submit
token or origin allowlist), with gateway callbacks exempt.

**Outcome (verified).**
- `server.js` sets `httpOnly`, `sameSite: "lax"`, `secure` in production, and exits when
  `SESSION_SECRET` is missing in production.
- `routes/auth.js` calls `session.regenerate()` before login and signup.
- CSRF is implemented as an **Origin/Referer allowlist** (`middleware/csrfOriginProtection.js` +
  `csrfConfig.js`) rather than a double-submit token. Only `/easebuzz/callback` and
  `/phonepe/callback` are exempt; `www.flashfoods.in` is an extra allowed host. This deliberately
  requires no token plumbing in EJS forms.
- Note: requests with no usable Origin/Referer (non-browser clients) pass. That is documented in
  the middleware as safe because cross-site browser attacks carry an Origin; treat it as a known
  design decision, not an oversight.

### B4 — FCM token ownership

**Original problem.** `findOneAndUpdate({token}, {vendorId: caller}, {upsert:true})` allowed one
vendor to take over another vendor's token.

**Designed fix.** Scope the query to the caller and reject tokens owned by someone else.

**Outcome (verified).** `routes/api/fcm.js` returns 409 when the token exists for another vendor
and upserts scoped to `{token, vendorId|req.user}`; student registration mirrors it with
`customerId` (F06.5). Tokens also carry `lastSeenAt`/`failCount` and a 90-day TTL.

### B5 — Identity endpoint and error envelope

**Original problem.** Identity was only injected into EJS via `res.locals`; errors were a mix of
flash redirects, `{error}`, and `{success:false,message}`.

**Designed fix.** Add `GET /api/auth/me` returning `{user:{id,role,name,phone,shop?}}` or 401, and
standardize new/JSON routes on `{error, code?, field?}`.

**Outcome (verified).**
- `routes/api/authMe.js` exists and returns the vendor's `shop` (`{id,name,slug}`) — the SPA
  bootstrap gap is closed.
- The error envelope is **only partially** standardized: the global handler still returns
  `{error}` for `/api/*`, and legacy routes keep their mixed shapes. New work should follow
  `{error, code?, field?}`; retrofitting the rest remains debt.

---

## 3. Historical task and commit sequence

The execution plan split the work into independently shippable steps so every commit left a working
app. Kept here as the implementation record (all of the money/auth items were subsequently
completed or superseded as described above):

1. `feat(auth): add /api/auth/me for SPA identity bootstrap` (B5)
2. `refactor: extract timingSafeEqual signature helper` (B2)
3. `fix(orders): timing-safe signature check in /verify-payment` (B2)
4. `feat(orders): shared atomic status-transition helper` (B1 — proposed, not built)
5. `fix(orders): idempotent atomic payment confirmation` (B2/B1)
6. `fix(auth): regenerate session on login/signup` (B3)
7. `fix(session): SameSite=Lax + secure cookie + prod secret fail-fast` (B3)
8–14. One atomic conversion per transition: accept, ready, OTP verify, cancel, adjust,
vendor parcel toggle, admin parcel toggle (B1)
15. `fix(fcm): scope token upsert to calling vendor` (B4)
16. `feat(security): CSRF on state-changing requests` (B3 — shipped as origin allowlist)
17. Global `/api/*` error envelope (B5 — partial)

Ordering rationale: CSRF/global changes last, after every POST path was stable, so a CSRF
regression would be attributable to one change.

---

## 4. Regression checklist (as designed)

- `node --test "tests/unit/**/*.test.js"` — signature, payment verification, order math,
  cancellation/adjustment, pickup slots, FCM, auth redirects.
- Playwright: login, vendor workflow, student workflow (isolated database only — the shared config
  mutates the `testing` shop on `MONGO_URI`).
- Manual, seeded testing shop: signup → catalog → cart → mock checkout → order detail.
- Manual vendor: accept → ready → OTP verify → completed; cancel + refund; adjust.
- Manual admin: shop/vendor/student toggles, order parcel toggle, menu CRUD.
- Razorpay test-mode checkout once (amount verification path against the real API).
- CSRF: same-origin form POST works; cross-origin form rejected.

Current evidence: the unit suite covers the money/signature/state logic and passes (301/0 on
2026-10-29). The Playwright and manual gateway checks above were **not** re-run in this review.

---

## 5. Remaining gaps after Stage 0

- No shared `transitionOrder` helper; atomic patterns are repeated per route.
- Error envelopes are still inconsistent; only `/api/*` 500s return JSON.
- CSRF is origin-based (no per-request token); acceptable for same-origin EJS, revisit if the SPA
  ever needs cross-origin API calls.
- No socket authentication (`vendor:join` accepts a client-supplied shop id) — was out of Stage 0
  scope but blocks the vendor SPA slice.
- Session storage is still MemoryStore; password reset still leaves other sessions alive.

These are tracked in `docs/TECH_DEBT.md` and `docs/KNOWN_ISSUES.md`.
