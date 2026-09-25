# FlashFoods V2 — Stage 0 Execution Plan

**Source of truth:** `STAGE0_HARDENING_PLAN.md` (problem analysis) → this plan (how to ship it).
**Rule:** Every task below is an **atomic, independently committable** step that leaves the app in a *working* state. Each task lists its own blast radius + regression. Do not batch tasks into one commit.
**Runbook:** after each commit → `npm run seed` (fresh local DB) → run the named regression. Real-money paths are verified against **mock/"testing" shop only** (there is no gateway in CI; Razorpay test-mode on a local shop is the manual step).

Conventions used below:
- `transitionOrder(...)` — new shared helper (`utils/order-state.js`) wrapping `findOneAndUpdate` with a status precondition; returns the updated doc or `null` on lost race.
- Unit tests: add `tests/unit/*.test.js` run with `node --test` (no framework needed; repo is ESM).
- Existing e2e: `npx playwright test <file>`.

---

## B5 — Identity + error contract (enabler for Stage 1; do first)

### B5-T1 — Add `GET /api/auth/me`

| Item | Detail |
|---|---|
| Files/functions | NEW `routes/api/authMe.js` (or add to `routes/auth.js`); modify `server.js:229` mount |
| Change | Return `{ user: { id, role, name, phone, shop: { id, name, slug }? } }` → `401 {error}` when no session. Reuse the hydration shape from `server.js:165-223` (move shop lookup into the handler, not per-request middleware). Same-origin cookie; no auth header needed. |
| Blast radius | **Low** — purely additive route; touches nothing existing. |
| Regression | `curl /api/auth/me` as anon → 401; as seeded vendor → `{role:"vendor",shop:…}`; as student → `{role:"student"}`. No e2e needed beyond a smoke spec. |
| Independent commit | ✅ Yes |
| Commit msg | `feat(auth): add /api/auth/me for SPA identity bootstrap` |

### B5-T2 — Standardize new/JSON error envelope

| Item | Detail |
|---|---|
| Files/functions | `server.js:242-264` global error handler; *new* JSON routes only (do NOT rewrite existing success bodies) |
| Change | Global `/api/*` handler returns `{error, code}` (today `{error}` only, `server.js:253-255`). New endpoints use `{error, code?, field?}`. |
| Blast radius | **Low** — additive; only touches the 500 fallback + contract for new routes. |
| Regression | Trigger a forced 500 on `/api/auth/me` → shape is `{error, code}`. |
| Independent commit | ✅ Yes (B5-T2 can be folded into B5-T1's commit) |

---

## B2 — Payment signature + amount + idempotency

### B2-T1 — Extract `signaturesMatch` to shared util

| Item | Detail |
|---|---|
| Files/functions | NEW `utils/signature.js` (`signaturesMatch(expectedHex, actualHex)`); refactor `routes/webhooks.js:13-19` to import it |
| Change | Behavior-preserving move. `crypto.timingSafeEqual` with length guard stays. |
| Blast radius | **Low** — one import swap; webhook behavior byte-identical. |
| Regression | `tests/unit/signature.test.js` (match, mismatch, length-mismatch, empty). Run a fake webhook POST with a valid + invalid signature. |
| Independent commit | ✅ Yes |
| Commit msg | `refactor: extract timingSafeEqual signature helper` |

### B2-T2 — `verify-payment` uses timing-safe compare

| Item | Detail |
|---|---|
| Files/functions | `routes/orders.js:248-253` (`const isAuthentic = expectedSign === razorpay_signature`) |
| Change | `signaturesMatch(expectedSign, razorpay_signature)` from `utils/signature.js`. |
| Blast radius | **Low** — single expression in one handler. |
| Regression | Unit test covers compare; manual: Razorpay test-mode checkout once. |
| Independent commit | ✅ Yes |
| Commit msg | `fix(orders): timing-safe signature check in /verify-payment` |

### B2-T3 — Amount verification before `paid`

| Item | Detail |
|---|---|
| Files/functions | `routes/orders.js:211-302` (`verify-payment` handler, uses `instance` from `createRazorpayFromShop` at `:246`) |
| Change | After signature passes, fetch payment: `instance.payments.fetch(razorpay_payment_id)`; require `payment.status === "captured"` and `payment.amount === Math.round(order.total * 100)` else `400 {error, code:"AMOUNT_MISMATCH"}`. |
| Blast radius | **Medium** — adds an outbound Razorpay API call on this path (latency ±300ms; gateway must be reachable). No schema change. Test with mock/local Razorpay test mode. |
| Regression | Happy path still `paid`. Forged/partial amount → stays `pending_payment` and returns 400. |
| Independent commit | ✅ Yes |
| Commit msg | `fix(orders): verify captured amount in /verify-payment` |

### B2-T4 — Atomic + idempotent `pending_payment → paid`

| Item | Detail |
|---|---|
| Files/functions | `routes/orders.js:262-292` — replace `findOne → mutate → save` with `transitionOrder({ query: { razorpayOrderId, status:"pending_payment" }, set: { status:"paid", paymentNote, transactionId, razorpayPaymentId } })` |
| Change | On `null` (already `paid`/moved on by webhook) → return idempotent `{success:true, orderId}` (mirrors current `:270-273`). Fire `emitPendingCount` + `dispatchNewOrderNotification` **only** when `updated != null`. Clear session cart on success. |
| Blast radius | **Medium** — this is also B1-T8 (same handler); the atomic write is the shared helper's first real caller. |
| Regression | Double-POST the same `{order_id,payment_id,signature}` → exactly one `paid` write + one notification. Manual Razorpay test checkout. |
| Independent commit | ✅ Yes (requires B1 helper task to exist first — see commit sequence) |
| Commit msg | `fix(orders): idempotent atomic payment confirmation` |

---

## B3 — Session + cookie + CSRF

### B3-T1 — Cookie hardening

| Item | Detail |
|---|---|
| Files/functions | `server.js:148-159` session `cookie` block + `secret` |
| Change | Uncomment `sameSite:"lax"` (`server.js:156`); add `secure: process.env.NODE_ENV === "production"`; fail-fast at boot if `SESSION_SECRET` unset in production (remove `"dev-secret"` fallback in prod only). |
| Blast radius | **Low-Medium** — same-site scope may affect legacy embedded redirect flows minimally; verify login + all navigations. |
| Regression | Login on local (HTTP) still works (`secure` false locally). Cross-site form POST to `/cart/add` is blocked (test with a minimal cross-origin iframe/form). |
| Independent commit | ✅ Yes |
| Commit msg | `fix(session): SameSite=Lax + secure cookie + prod secret fail-fast` |

### B3-T2 — Session fixation fix

| Item | Detail |
|---|---|
| Files/functions | `routes/auth.js:44` (signup POST) and `:78` (login POST) |
| Change | `await new Promise((r) => req.session.regenerate(r));` *before* setting `req.session.userId`. Keep `resave:false`. |
| Blast radius | **Low** — two auth POST handlers; session starts fresh at login/signup. |
| Regression | `tests/login.spec.js` full signup→session and login→session. Confirm flash still works (call `regenerate` before `flash` usage). |
| Independent commit | ✅ Yes |
| Commit msg | `fix(auth): regenerate session on login/signup` |

### B3-T3 — CSRF verification (complete last)

| Item | Detail |
|---|---|
| Files/functions | NEW `middleware/csrf.js`; apply in `server.js` before routers (`:229-237`); expose token via `GET /api/auth/me` (B5-T1) or a `_csrf` field |
| Change | Double-submit cookie pattern: set a signed `csrf` cookie; require matching `X-CSRF-Token` header (JSON) or `_csrf` form field on every non-GET. Legacy-compat: keep a skip-list for gateway callbacks (`/webhooks/*`, `/easebuzz/callback`, `/phonepe/callback`) and render the token into EJS forms via `res.locals.csrfToken`. |
| Blast radius | **High — app-wide.** Every POST/PATCH/DELETE now must carry the token. Any straggler form breaks → this is intentionally the LAST commit so all other POST paths are already stable. |
| Regression | Full Playwright pass (`npx playwright test`) + manual click-through of every legacy form: login, signup, forgot, cart add/clear, all vendor buttons, all admin forms, `verify-payment`. |
| Independent commit | ✅ Yes — but ship after B1/B2/B3-T1/B3-T2 are green |
| Commit msg | `feat(security): CSRF double-submit tokens on all state-changing requests` |

---

## B4 — FCM token scope

### B4-T1 — Scope register upsert to owner

| Item | Detail |
|---|---|
| Files/functions | `routes/api/fcm.js:17-24` (`FcmToken.findOneAndUpdate({ token }, { vendorId, deviceInfo }, upsert)`) |
| Change | Match on `{ token, vendorId: { $ne: req.user._id } }` → conflict or upsert scoped: use `findOneAndUpdate({ token, vendorId: req.user._id }, { $set: { deviceInfo }, $setOnInsert: { token, vendorId: req.user._id } }, { upsert: true })`. Any token already owned by another vendor then **fails to re-assign** (returns/ignore) instead of stealing. |
| Blast radius | **Low** — single handler; model untouched. |
| Regression | `tests/instrumentation/fcm-diagnostic.spec.js`; manual: vendor A register token T, vendor B register same T → BOTH docs present with distinct vendorIds (no overwrite), owner A unaffected. |
| Independent commit | ✅ Yes |
| Commit msg | `fix(fcm): scope token upsert to calling vendor` |

---

## B1 — Atomic order transitions (the bulk of the work)

**Prereq task (helper):**

### B1-T0 — Add shared `transitionOrder` helper

| Item | Detail |
|---|---|
| Files/functions | NEW `utils/order-state.js` → `export async function transitionOrder({ query, set, unset, options })` implemented as `Order.findOneAndUpdate(query, { $set, $unset? }, { new: true, ...options })` |
| Change | One function used by all 8 handlers so the atomic-write pattern lives in one tested place (mirrors `webhooks.js:98-110`). |
| Blast radius | **Low** — new file; no callers yet. |
| Regression | `tests/unit/order-state.test.js`: returns doc on precondition match, `null` on status mismatch; uses seeded Mongo (memory-server) or `mongodb-memory-server-core` (already in deps). |
| Independent commit | ✅ Yes |
| Commit msg | `feat(orders): shared atomic status-transition helper` |

### Then one commit per route, dependency-ordered (each converts to `transitionOrder` with proper pre-state):

| Task | Route (file:line) | Pre-state → new state | Blast radius | Regression | Independent | Commit msg |
|---|---|---|---|---|---|---|
| **B1-T1** accept | `routes/vendor.js:544-576` | `paid→accepted` | **Low** (1 handler) | Vendor acet: paid order accepted once; double-POST → one side-effect. `vendor-workflow.spec.js` | ✅ | `fix(vendor): atomic accept` |
| **B1-T2** ready | `routes/vendor.js:506-542` | `accepted→ready_for_pickup` (+ `readyAt`) | **Low** | Ready only from `accepted`; `409` from `paid`. `vendor-workflow.spec.js` | ✅ | `fix(vendor): atomic ready` |
| **B1-T3** cancel | `routes/vendor.js:578-673` | prestate `paid`; refund via `refundViaRazorpay/refundViaPhonePe` (`:50,:66`) unchanged | **Medium** (refund side-effects) | Cancel+refund once; double-cancel → 409, **no second refund**. Manual mock-shop cancel. | ✅ | `fix(vendor): atomic cancel; guard double-refund` |
| **B1-T4** OTP verify | `routes/vendor.js:708-772` | `ready_for_pickup→completed` (+ `collectedAt`) | **Low** | OTP completes once; concurrent same-OTP → one `completed`. Keep dual JSON/redirect responses (`:762-770`). | ✅ | `fix(vendor): atomic OTP verification` |
| **B1-T5** adjust | `routes/vendor.js:852-976` | pre-state `in ["paid","accepted"]`; keep `keep_items` bounds-check + refund recompute | **High** (refund amount math is the risk) | Adjustment on paid/accepted only; `keep_items=999` → 400; refundAmount == original−updated; single save. **Money-path manual test required.** | ✅ (as its own commit; the meatiest) | `fix(vendor): atomic adjust + keep-items bounds + refund math` |
| **B1-T6** vendor toggle-parcel | `routes/vendor.js:774-812` | only on `pending_payment`/pre-paying? — **decide pre-state**: block ≥`accept`ed unless intended; recompute total from items instead of float-delta | **Medium** | Parcel toggle recomputes `total` (no float drift); blocked once order is `accepted`. JSON response `:807-810` preserved. | ✅ | `fix(vendor): atomic parcel toggle, recompute total` |
| **B1-T7** admin toggle-parcel | `routes/admin.js:1210-1241` | same rules as B1-T6 (reuse helper / same precondition) | **Medium** | Admin toggles mirror vendor behavior; `total` recomputed, no float delta (`:1217` `order.total -=`). | ✅ | `fix(admin): atomic parcel toggle, recompute total` |
| **B1-T8** verify-payment | **merged into B2-T4** | — | — | — | — | — |

**Consistency note for B1-T5/T6/T7:** the current float-delta (`vendor.js:798-805`, `admin.js:1217-1224`) is replaced by *recompute* from `order.items` + `computeParcelCharge` (`utils/pricing.js`) — same builder as `orders.js:60-99`. This kills the drift bug class in one move and makes the pre-state decision (block after `accepted`) a single place.

---

## Recommended commit sequence (each = working app)

| # | Commit | Tasks | Why this order |
|---|---|---|---|
| 1 | `feat(auth): add /api/auth/me for SPA identity bootstrap` | B5-T1 (+B5-T2) | Additive, zero risk; unblocks React hydration immediately |
| 2 | `refactor: extract timingSafeEqual signature helper` | B2-T1 | Behavior-preserving; creates the util B2-T2 needs |
| 3 | `fix(orders): timing-safe signature check in /verify-payment` | B2-T2 | One expression; smallest first paid change |
| 4 | `feat(orders): shared atomic status-transition helper` | B1-T0 | Foundation for the whole B1 set |
| 5 | `fix(orders): idempotent atomic payment confirmation` | B2-T4 (+B1-T8) | First consumer of `transitionOrder`; removes the race on the money path |
| 6 | `fix(auth): regenerate session on login/signup` | B3-T2 | Small, isolated; session already working from #5 |
| 7 | `fix(session): SameSite=Lax + secure cookie + prod secret fail-fast` | B3-T1 | Independent session hardening |
| 8 | `fix(vendor): atomic accept` | B1-T1 | Simplest vendor transition; proves the pattern on the vendor console |
| 9 | `fix(vendor): atomic ready` | B1-T2 | Depends on #8 pattern |
| 10 | `fix(vendor): atomic OTP verification` | B1-T4 | Independent; pickup flow secure |
| 11 | `fix(vendor): atomic cancel; guard double-refund` | B1-T3 | Refund path — higher care; ship after simpler transitions |
| 12 | `fix(vendor): atomic adjust + keep-items bounds + refund math` | B1-T5 | Meatiest single change; done with money-path manual test |
| 13 | `fix(vendor): atomic parcel toggle, recompute total` | B1-T6 | Recompute (no float delta) |
| 14 | `fix(admin): atomic parcel toggle, recompute total` | B1-T7 | Same fix, admin duplicate |
| 15 | `fix(fcm): scope token upsert to calling vendor` | B4-T1 | Isolated; any time after #4, fine here |
| 16 | `feat(security): CSRF double-submit tokens on all state-changing requests` | B3-T3 | **Last** — all other POST paths are stable by now; highest blast radius |
| 17 | (optional fold) global `/api/*` error envelope already in #1 | B5-T2 | — |

**Why CSRF is last:** B3-T3 is the only change whose blast radius spans *every* POST/PATCH/DELETE. Sequencing it after every other refactor means the final CSRF roll-out runs against an already-green, behavior-stable set of routes — so any CSRF regression is attributable to CSRF alone, not to a concurrent money-path change.

---

## Regression test master-list (run once at end, before Stage 1)

- [ ] `node --test tests/unit/` (signature, order-state, parcel-recompute helpers)
- [ ] `npx playwright test tests/login.spec.js tests/vendor-workflow.spec.js tests/student-workflow.spec.js`
- [ ] Manual (seeded local testing shop, mock/no-gateway): signup → catalog → cart → checkout (mock) → order detail
- [ ] Manual vendor: accept → ready → OTP verify → completed; cancel + refund (mock shop); adjust (keep/remove)
- [ ] Manual admin: shop/vendor/student toggle, order toggle-parcel, menu CRUD
- [ ] Razorpay test-mode single checkout (verifies B2-T3 amount path end-to-end against real API)
- [ ] CSRF: legacy form POST works (all above cover it); cross-site form blocked

---
*Exit gate = all 16 commits pushed and the master-list green. That closes Stage 0 and unblocks Stage 1 (wire the existing JSON routes into React Query unchanged).*