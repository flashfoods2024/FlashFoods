# FlashFoods V2 — Stage 0 Remediation Plan (Money/Auth Hardening)

**Source of truth:** `ROUTE_MIGRATION_REPORT.md`, Section E Stage 0, plus the route registry (Sections B/C).
**Scope:** Server-side only. No code modified; this is the remediation plan.
**Exit criteria:** All Stage 0 blockers closed → Stage 1 (wire safe JSON API_READY routes into React Query) is unblocked.

---start-hint-- Do not edit below this point in the report body unless you are the implementer --end-hint---

---

## 1. Blocker identification

Stage 0 of `ROUTE_MIGRATION_REPORT.md` lists five hard blockers. Each has been located and verified in source.

| # | Blocker | Files / lines (verified) | Severity |
|---|---|---|---|
| 1 | All money-mutating order transitions use read-modify-write (non-atomic) — race double-fire, duplicate side effects, lost updates | `routes/orders.js:262-279`, `routes/vendor.js:506-541` (ready), `:544-575` (accept), `:578-655` (cancel), `:708-770` (verify OTP), `:852-975` (adjust), `:774-810` (toggle-parcel), `routes/admin.js:1210-1240` (toggle-parcel) | **Critical** |
| 2 | `verify-payment` — insecure string compares + no amount check + no idempotency key | `routes/orders.js:253` (`===`), `:248-260` (no amount), `:262-279` (find→save, no dedupe) | **Critical** |
| 3 | No CSRF for SPA non-GET + session fixation + weak cookie config | `server.js:150-158`, `routes/auth.js:44` and `:78` | **High** |
| 4 | `/api/fcm/register` token-upsert hijack | `routes/api/fcm.js:17-24` | **High** |
| 5 | Missing `/api/auth/me` + inconsistent error shape | No file (absent) — `server.js:163` `attachUser`, error handler `server.js:242-264` | **Medium** |

---

## 2. Blocker location detail (file:line — exact)

### Blocker 1 — Non-atomic money transitions

Every handler does **find → mutate → save**, with no status precondition in the write.

| Route | Current pattern | Exact lines |
|---|---|---|
| `POST /verify-payment` (Student, Razorpay) | `Order.findOne({razorpayOrderId})` → mutate → `order.save()` | `routes/orders.js:262 → 275-279` |
| `POST /vendor/orders/:id/accept` | `Order.findById(id)` + shop check → `order.status=accept` → `save()` | `routes/vendor.js:557 → 568-569` |
| `POST /vendor/orders/:id/ready` | same → `order.status=ready_for_pickup` → `save()` | `routes/vendor.js:519 → 530-532` |
| `POST /vendor/orders/:id/cancel` | `Order.findOne({_id, shop})` → status refund flow → `save()` ×2–3 | `routes/vendor.js:593 → 625, 655` |
| `POST /vendor/verify` (OTP) | `Order.findOne({shop, pickupOtp, status})` → mutate → `save()` | `routes/vendor.js:726 → 746-750` |
| `POST /vendor/orders/:id/adjust` | `Order.findById` → mutate items/refund → `save()` | `routes/vendor.js:862-975` (see `:862-864`, `:964-966`) |
| `POST /vendor/orders/:id/toggle-parcel` | fetch → float-delta `total` → `save()` | `routes/vendor.js:774-810` |
| `POST /admin/orders/:id/toggle-parcel` | same float-delta, admin scope | `routes/admin.js:1210-1240` |

**Existing correct pattern to copy** (already in repo): the Razorpay webhook uses a **status-preconditioned atomic update** with idempotency:

```js
// routes/webhooks.js:98-110
const updated = await Order.findOneAndUpdate(
  { razorpayOrderId, status: "pending_payment" },
  { $set: { status: "paid", ..., webhookEventId: eventId } },
  { new: true }
);
// + routes/webhooks.js:88-90 — `webhookEventId` idempotency guard
```

---

### Blocker 2 — `verify-payment` security gaps

`routes/orders.js:248-279`:

```js
const expectedSign = crypto.createHmac("sha256", keySecret).update(sign).digest("hex");
const isAuthentic = expectedSign === razorpay_signature;   // :253 — timing-attackable `===`

const order = await Order.findOne({ razorpayOrderId });     // :262 — find-then-save, no atomicity/idempotency
...                                                          // no comparison of captured amount vs order.total
order.status = "paid"; ... await order.save();              // :275-279
```

Three distinct defects:

1. **`===` on HMAC hex** (`:253`). The webhook uses `crypto.timingSafeEqual` (`webhooks.js:13-19`) — verify-payment must reuse the same helper. Timing attack → attacker can brute-force the signature.
2. **No amount verification.** The signature covers `order_id|payment_id` only. Amount is charged as `Math.round(total*100)` paise at creation (`orders.js:183`), but verify-payment never confirms the captured amount matches the persisted `order.total`. Defense-in-depth: assert `payment.amount` (or fetch the Razorpay payment) equals `order.total` before `paid`.
3. **No idempotency key.** Uses only `order.status !== "pending_payment"` (`:270-273`) as the guard; two concurrent requests both pass it. Needs the same `findOneAndUpdate({status:"pending_payment"})` + an idempotency field (reuse `webhookEventId` or add a `verifyToken`).

---

### Blocker 3 — CSRF / session / cookie

- **Session cookie** `server.js:148-159`: `secret: process.env.SESSION_SECRET || "dev-secret"`, `cookie: { httpOnly: true }` — `sameSite` is **commented out** (`:156`), no `secure`, no CSRF anywhere in `package.json` or the app. An SPA posting JSON cross-origin (or a malicious site posting forms to `/orders/checkout`, `/verify-payment`, `/vendor/orders/:id/accept`, every admin POST) carries the session cookie with zero protection.
- **Session fixation** `routes/auth.js:44` (signup) and `:78` (login): set `req.session.userId` without `regenerate()`. An attacker who pre-plants a session ID gets it authenticated at signup/login.
- SPA note: the app stays **same-site cookie** (no JWT needed), which is simplest, but CSRF must become per-request header verification on non-GET (custom header `X-Requested-With` / double-submit token or `SameSite=Lax` + referer/origin check).

---

### Blocker 4 — FCM token hijack

`routes/api/fcm.js:17-24`:

```js
await FcmToken.findOneAndUpdate(
  { token },                        // keyed on token ONLY
  { vendorId: req.user._id, ... },  // overwrites vendorId with caller
  { upsert: true, new: true }
);
```

`FcmToken.token` is unique (`models/FcmToken.js:14`). Any authenticated vendor who knows another vendor's token re-registers it under their own `vendorId`, stealing/redirecting the owner's push. `unregister` correctly scopes `{token, vendorId}` (`:41`); register must match on `{token, vendorId: req.user._id}` and use `$setOnInsert` for vendorId.

---

### Blocker 5 — Missing `/api/auth/me` + error-shape inconsistency

- **No `/api/auth/me`**: identity is injected server-side via `server.js:165-223` (`res.locals.currentUser`, `cartCount`, `vendorShop`, `firebaseConfig`, formatters). React cannot hydrate the session without a JSON identity endpoint. (Confirmed absent: no route matches `/api/auth/me` in any router.)
- **Inconsistent error bodies**: page routes flash+redirect (e.g., `vendor.js:563-566` `req.flash(...)+res.redirect`), API routes return `{error}` or `{success:false,message}` (e.g., `orders.js:256-259`, `:296-298`), global handler returns `{error}` only for `/api/*` (`server.js:253-255`). React needs a single contract: `{error: string, code?: string, field?: string}` with real HTTP statuses.

---

## 3. Why each blocker blocks React/Vite migration

| Blocker | Why it blocks Stage 1+ |
|---|---|
| 1 | React replaces 5s-poll/full-reload with realtime + mutation calls. Non-atomic transitions → duplicate `emitPendingCount`/FCM pushes, double-charge/cancel races, and lost refund state once the UI calls them concurrently (double-click, retry). The SPA trusts server state; racing mutations make that contract unreliable. |
| 2 | Stage 4 (checkout) depends on it. An insecure or forgeable `verify-payment` means React's checkout can be driven by forged or replayed requests. The timing-attack bytes (`===`) must be gone before SPA wiring. |
| 3 | A same-origin SPA sends all JSON POSTs with the session cookie. With no CSRF verification, any cross-site form can reach `/verify-payment`, `/vendor/verify`, admin POSTs. Cannot ship SPA without it. |
| 4 | Stage 5 vendor console mounts on the same origin as notifications. If tokens are hijackable, push notifications can be stolen; block before the vendor realtime surface lands. |
| 5 | The first React screens need `currentUser`/`role`/`shop` before any guarded route renders, plus a uniform error `{error, code}` to fail fast in React Query. Without it the SPA has to duplicate `res.locals` guesswork. |

---

## 4. Severity ranking

| Rank | Blocker | Severity | Rationale |
|---|---|---|---|
| 1 | **B1** — atomic money transitions | **Critical** | Money/order integrity + double-fire; affects every status mutation; reproduced by concurrency that an SPA will make more likely |
| 2 | **B2** — `verify-payment` signature/amount/idempotency | **Critical** | Direct forgery vector on the payment-confirm path; State-0 gate for Stage 4 |
| 3 | **B3** — CSRF + session fixation + cookie flags | **High** | Account-takeover + cross-site state-changing POSTs; required before SPA goes same-origin-cookie |
| 4 | **B4** — FCM token hijack | **High** | Push-notification hijack; gated to Stage 5 but cheap to fix now |
| 5 | **B5** — `/api/auth/me` + error shape | **Medium** | Not a security hole; purely a contract gap that unblocks Stage 1 rendering |

---

## 5. Per-Blocker remediation

### Blocker 1 — Atomic order transitions

- **Current:** find→mutate→save in 8 handlers (see §2). Results: duplicate side-effects, lost-update races, double-cancel/double-refund risk.
- **Recommended:**
  - Replace each `find→mutate→save` with **`findOneAndUpdate` using a status precondition** matching the current EJS `if (order.status !== X)` guard — file-scope the transition to the expected pre-state:
    - accept: `{ _id, shop, status: "paid" }`
    - ready: `{ _id, shop, status: "accepted" }`
    - verify/OTP: `{ shop, pickupOtp, status: "ready_for_pickup" }` (+ collect `collectedAt`)
    - cancel: `{ _id, shop, status: "paid" }` (+ refund sub-flow)
    - verify-payment: `{ razorpayOrderId, status: "pending_payment" }`
    - adjust / toggle-parcel: precondition on `status` and use `$set`/aggregation for totals instead of float delta
  - On `null` return (lost race) → return `409 Conflict` (JSON for SPA) / existing flash message (legacy). Never mutate-and-save.
  - Fire `emitPendingCount`/`dispatchNewOrderNotification` only when `updated != null` (matches webhooks.js pattern).
  - For cancel/adjust, keep refund as **post-conditional**, but gate the final `status` flip on the atomic precondition so two cancels can't double-refund.
- **Estimated effort:** 0.5–1 day (copy the webhook pattern; ~8 handlers, all same shape).
- **Migration risk:** Low — pattern already proven in `webhooks.js`; must preserve legacy flash behavior (route still `redirect`s for non-JSON accept — keep both response paths, add `req.accepts("json")`).

### Blocker 2 — `verify-payment` hardening

- **Current:** `orders.js:253` `expectedSign === razorpay_signature`; no amount check; `findOne→save` no idempotency.
- **Recommended:**
  1. Reuse `signaturesMatch()` from webhooks (export it from a shared util, or duplicate the `timingSafeEqual` helper) — replace `===`.
  2. Before marking `paid`, re-fetch the Razorpay payment by `razorpay_payment_id` (via `instance.payments.fetch`) and assert `payment.amount === Math.round(order.total * 100)` and `payment.captured === true`. If mismatch → `400` and leave order pending.
  3. Make the `pending_payment → paid` transition atomic and idempotent: `findOneAndUpdate({ razorpayOrderId, status: "pending_payment" }, { $set: { status:"paid", ... , webhookEventId: <dedupe key> } }, { new: true })`; on `null`, return success for an order already `paid` (idempotent ack) rather than re-saving.
  4. Keep the `req.session.cart = {}` reset on the success path; also add an explicit `401` block when `order.customer !== req.session.userId` (already present at `:263`).
- **Estimated effort:** 0.5 day.
- **Migration risk:** Medium — must not break Razorpay checkout in legacy EJS (`cart/index.ejs` calls exactly this endpoint). Verify with the existing webhook-shaped atomic path; run Razorpay test-mode end-to-end before and after.

### Blocker 3 — CSRF + session + cookie

- **Current:** `server.js:150-158`; no CSRF lib; `sameSite` commented; no `secure`. `auth.js:44,78` no `regenerate`.
- **Recommended:**
  - **Unblocking simplest path first:** uncomment `sameSite: "lax"` + set `secure: NODE_ENV==="production"` + keep `httpOnly`. This closes the worst (cross-site form POST) with one line. Because the SPA is same-origin, `SameSite=Lax` blocks cross-site POSTs while allowing top-level navigations.
  - Add a **double-submit CSRF** (token in a signed cookie + `X-CSRF-Token` header) middleware for all non-GET, applied before routers; the SPA reads the token from `/api/auth/me` (or `meta`) and sends it. (Alternative: `Origin`/`Referer` allowlist check — lower effort, acceptable for same-origin SPA.)
  - **Session fixation:** call `req.session.regenerate()` before `req.session.userId = ...` at `auth.js:44` and `:78`. (This is why `resave:false` + `saveUninitialized:false` must remain.)
  - Enforce `SESSION_SECRET` set in production (fail-fast at boot; remove `"dev-secret"` fallback in prod).
- **Estimated effort:** 1–1.5 days (middleware + token plumbing + both auth POSTs).
- **Migration risk:** Medium — CSRF middleware can break existing form POSTs if not routed carefully; keep legacy paths exempt or add the token to all forms. Highest-risk single change; test all role POSTs in a regression pass.

### Blocker 4 — FCM register scope

- **Current:** `fcm.js:17-24` upsert keyed on `{token}` overwriting `vendorId`.
- **Recommended:** `findOneAndUpdate({ token, vendorId: req.user._id }, { $set: { deviceInfo }, $setOnInsert: { vendorId: req.user._id, token } }, { upsert: true, ... })`. An attacker trying to steal another vendor's token will then upsert **their own document** with the same token → pushes go to both; or (cleaner) keep token unique and reject when `vendorId` mismatch: `updateOne({token, vendorId})` w/ `upsert` (matching `unregister` behavior).
- **Estimated effort:** < 2 hours.
- **Migration risk:** Low.

### Blocker 5 — `/api/auth/me` + unified error shape

- **Current:** absent identity endpoint; divergent error bodies.
- **Recommended:**
  - `GET /api/auth/me` → `200 {user:{id,role,name,phone,shop:{id,name,slug}?}}` or `401 {error}`. Reuse `server.js:165-223` hydration logic (it already computes `currentUser` + `vendorShop`); move it behind a route so React calls it once at bootstrap.
  - Define a single error envelope `{error:string, code?:string, field?:string}` used by all JSON routes + global error handler (`server.js:253` today returns `{error}` only). Keep legacy page-route flash/redirect behavior untouched.
- **Estimated effort:** 0.5 day.
- **Migration risk:** Low (additive route; error-shape change is non-breaking if you leave `{success:false,message}` routes alone and only standardize new ones).

---

## 6. Final checklist

**Critical**
- [ ] **Blocker 1** — Convert all 8 status transitions to precondition-atomic `findOneAndUpdate` (verify-payment, accept, ready, cancel, OTP verify, adjust, vendor toggle-parcel, admin toggle-parcel); `409` on lost race; side-effects only when `updated != null`.
- [ ] **Blocker 2** — `verify-payment`: shared `timingSafeEqual` signature check; capture amount==`order.total` (paise) verification; idempotent atomic `pending_payment→paid`; keep cart reset on success.

**High**
- [ ] **Blocker 3a** — Session cookie: uncomment `sameSite:"lax"`, add `secure` in prod, drop `"dev-secret"` fallback in prod.
- [ ] **Blocker 3b** — CSRF verification on all non-GET (double-submit token or origin allowlist) applied before routers.
- [ ] **Blocker 3c** — `req.session.regenerate()` before `session.userId` at `auth.js:44` and `:78`.
- [ ] **Blocker 4** — `fcm/register` upsert scoped to `{token, vendorId: me}` (`$setOnInsert`); no longer steal other vendors' tokens.

**Medium**
- [ ] **Blocker 5a** — Add `GET /api/auth/me` returning `{user}` with vendor `shop`, hydrated from the same logic as `server.js:165-223`.
- [ ] **Blocker 5b** — Standardize new/JSON error envelope to `{error, code?, field?}` (leave legacy flash routes as-is).

**Stage-1 gate (after checklist done)**
- [ ] Run full regression: Razorpay test-mode checkout (legacy EJS), all vendor status buttons, OTP verify, admin toggle-parcel — each must behave identically under the atomic pattern.
- [ ] Confirm no new routes break the existing legacy POST forms (regression pass over §C routes).

---

## Stage-1 handoff summary

After this checklist: `verify-payment`, vendor transitions, admin parcel toggle are atomic-safe; CSRF/session/cookie are hardened; FCM token scope is closed; and React can hydrate via `/api/auth/me` with a uniform error shape.

Stage 1 can then wire the already-JSON routes (`/cart/variant`, `/api/orders/:id/status`, `/vendor/orders/pending.json`, `/analytics/data`, menu CRUD, gateway `initiate`, `/profile/phone`) into a typed React Query client **without modifying any of them**. That is the shortest path: ~3–4 days of server hardening unblocks the entire read-green phase of the migration.