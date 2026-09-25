# FlashFoods Critical Incident Report — Unpaid Orders Reaching Vendor Dashboards

**Date:** 2026-08-19 | **Severity:** Critical | **Status:** Root cause confirmed with database evidence; no fixes applied (per investigation scope)

---

## 1. Executive Summary

During Playwright QA testing, orders were created for **The Hummusery** (a real production vendor) without any payment. Investigation confirms **19 orders with `paymentNote: "mock"` / `transactionId: "mock"` in the production database** — 15 for The Hummusery (Rs 139 each) and 4 for Juice Corner (Rs 40 each). All were created by QA test accounts through the mock checkout route **`POST /orders/checkout`**, which creates orders with `status: "paid"` and performs **zero payment verification**. The root cause is a combination of (a) a live mock-order route in production code, (b) an automated Playwright test that exercises it, and (c) total environment isolation failure — local tests ran against the **production MongoDB Atlas database** (`canteenDB`).

Production at flashfoods.in is **still vulnerable today**: the deployed build (`4f643cc-2026-08-07T10-55-31`) still contains the mock checkout route. Any authenticated student (or any logged-in student targeted by a CSRF attack) can create a free "paid" order at any open shop.

---

## 2. Root Cause (exact code path, proven)

### The route: `POST /orders/checkout` — routes/orders.js:677-750

```js
// routes/orders.js:726-738
const order = await Order.create({
  customer: req.session.userId,
  shop: cart.shopId,
  items: orderItems,
  total,
  orderType,
  parcelCharge,
  pickupTime: pickupValidation.date || null,
  status: "paid",          // <-- marked PAID with NO payment
  pickupOtp,
  paymentNote: "mock",     // <-- fake payment note
  transactionId: "mock",   // <-- fake transaction id
});
```

- Requires only `requireDb, requireAuth, requireStudent` (routes/orders.js:680-681). No payment gateway, no signature, no webhook, no verification of any kind.
- Amount is computed server-side from the session cart (routes/orders.js:711), so pricing cannot be tampered — but **payment is entirely bypassable**.
- `emitPendingCount` + `dispatchNewOrderNotification` fire immediately (routes/orders.js:740-741) — the vendor receives a push notification and the order appears in the pending dashboard.

### The vendor sees it: routes/vendor.js:378

```js
status: { $in: ["paid", "accepted", "ready_for_pickup"] },
```

Any order with `status: "paid"` appears in the vendor's pending orders — exactly what happened. The vendor can even accept them (routes/vendor.js:563 accepts when `status === "paid"`).

### The test that fired it: tests/student-workflow.spec.js:34-50

```js
const ACTIVE_SHOP = 'hummusery';            // line 3 — a REAL production vendor

test('student can place mock order', ...) { // line 34
  await page.goto(`/shops/${ACTIVE_SHOP}`); // browse real vendor
  ... add first menu item to cart ...
  const resp = await page.request.post('/orders/checkout', {   // line 38
    form: { orderType: 'dinein', pickupTime: ... }, maxRedirects: 0 });
  expect(resp.status()).toBe(302);
  ...
});
```

### Why it hit production, not local: environment isolation failure

| File | Line | Content | Issue |
|---|---|---|---|
| `.env` | 1 | `MONGO_URI=mongodb://...cy01igd.mongodb.net/canteenDB...` | **Production Atlas cluster** is the only configured DB |
| `.env` | 2-3 | `RAZORPAY_KEY_ID=rzp_live_...` | **Live** Razorpay keys |
| `.env` | 22 | `SESSION_SECRET=my-super-secret-development-key-change-me` | Weak, guessable |
| `.env` | 32 | `DISABLE_RATE_LIMIT=true` | Rate limiting off |
| `playwright.config.js` | 31 | `baseURL: process.env.BASE_URL || 'http://localhost:3000'` | Tests hit localhost — but the local server connects to the prod DB |
| `tests/global-setup.mjs` | 17 | `new MongoClient(process.env.MONGO_URI)` | Test harness connects **directly to the production DB** |

There is no `.env.local` / `.env.development` / `.env.production` — a single `.env` with production credentials serves everything. The Playwright suite ran against `localhost:3000`, whose server process loaded the same `.env` and wrote to production Atlas. Additionally, `npm run seed` was executed against production on **2026-08-06 05:10 UTC**, creating QA users (`vendor@college.com`, `admin@college.com`, `student@college.test`) and the `main-canteen` shop inside the production database.

### The QA report proves the operator knew: report.md (2026-08-06)

- Line 45: "**Main Canteen is disabled in production**; page redirects" — tests knowingly ran against production.
- Line 59: "Uses active shop `hummusery`; **mock order via real `POST /orders/checkout`**" — deliberate.
- Line 108: "mock order (real POST → **`status: paid`, Rs 139 in DB**)" — the paid mock order was observed and documented.
- Line 143: "Green **Ready for Production**".

---

## 3. Contributing Factors

1. **Live mock-order route in production code** — introduced in commit `300f5b7` (2026-05-02, "vendor login and order verification"); still present in HEAD/deployed build.
2. **Tests exercise the mock route against a real vendor** — `ACTIVE_SHOP = 'hummusery'` (tests/student-workflow.spec.js:3), added in `786ec45` (2026-07-15), rewritten in `59f5228` (2026-08-06).
3. **No environment separation** — one `.env` with production DB + live keys; no NODE_ENV gating anywhere in the app.
4. **Test harness writes to the production DB** — global-setup enables `juice-corner` (`isActive=true, isOpen=true`) and re-links the vendor (tests/global-setup.mjs:34-37); global-teardown restores it using a **hardcoded production vendor ObjectId** `69f94f3740d1612eddf0d00c` (tests/global-teardown.mjs:25) — the real Juice Corner vendor.
5. **`seed.js` is destructive and ran against production** — `deleteMany` on QA emails + deletes old `main-canteen` shop and its menu items (seed.js:20-27). This deleted the previous main-canteen shop/menu in prod.
6. **Razorpay webhook path is non-functional in production** — no shop has `paymentSettings.razorpay.webhookSecret` and `RAZORPAY_WEBHOOK_SECRET` is not set → `getWebhookSecretFromShop` returns `""` → webhook handler 500s (routes/webhooks.js:71-76). Server-side confirmation relies solely on `/verify-payment`.
7. **Schema default encourages the flaw** — `paymentNote` defaults to `"mock"` (models/Order.js:66).
8. **UI copy admits it** — "Payment is simulated. You will get a pickup code..." (views/cart/index.ejs:194-196).

---

## 4. Reproduction Steps (already proven in production DB — do not re-run)

1. Start the server locally (`npm start`) with the existing `.env` → connects to production Atlas.
2. `npm run seed` (or signup) → creates `student@college.test` / `vendor@1` in the production DB.
3. `npx playwright test tests/student-workflow.spec.js` → logs in, opens `/shops/hummusery`, adds the first menu item (BBQ Chicken Shawarma Rs 139), POSTs `/orders/checkout`.
4. Result: `Order` document created with `status: "paid"`, `paymentNote: "mock"`, `transactionId: "mock"`, shop = Hummusery.
5. Hummusery's pending orders page (query at routes/vendor.js:378) lists it; push notification dispatched (routes/orders.js:741).

**Any authenticated student can do this manually with one request** — no Playwright needed:

```
POST /orders/checkout   (session cookie of any student, non-empty cart)
form: orderType=dinein&pickupTime=<valid ISO date>
-> 302 /orders/<new id> — order is "paid"
```

---

## 5. Order Execution Chain (exact map)

| Step | Route | Controller | Middleware | Model write | Payment verified? |
|---|---|---|---|---|---|
| Add to cart | `POST /cart/add` | routes/cart.js:97-173 | requireDb, requireAuth, requireStudent | session only | n/a |
| **Mock checkout** | **`POST /orders/checkout`** | routes/orders.js:677-750 | requireDb, requireAuth, requireStudent | `Order.create` status **paid** (line 726) | **NO — none** |
| Razorpay checkout | `POST /create-razorpay-order` | routes/orders.js:130-209 | same | `Order.create` status **pending_payment** (line 188) | Gateway order created; waits for verification |
| Razorpay verify | `POST /verify-payment` | routes/orders.js:211-302 | same | `order.save()` → paid (line 279) | HMAC sha256 over `order_id|payment_id` with shop keySecret (lines 248-253) — correct |
| Razorpay webhook | `POST /webhooks/razorpay` | routes/webhooks.js:29-153 | express.raw, requireDb | `findOneAndUpdate` → paid | HMAC + timingSafeEqual (line 83); **broken in prod: secret empty → 500 (lines 73-76)** |
| Easebuzz | `POST /easebuzz/initiate` + `/easebuzz/callback` | routes/orders.js:305-470 | requireDb (callback: none) | pending_payment (367) → paid via callback (457) | sha512 response hash verified (config/easebuzz.js:92-122) — correct |
| PhonePe | `POST /phonepe/initiate` + `/phonepe/callback` | routes/orders.js:473-675 | requireDb (callback: none) | pending_payment (546) → paid via callback (639) | **Server-side status API check** against PhonePe (lines 625-632) — correct |
| Vendor sees order | `/vendor/orders/pending` | routes/vendor.js:420-432 | requireVendorShop | read | trusts `status: "paid"` |

---

## 6. Order Creation Surface Area

| Location | Route | Payment gate | Verdict |
|---|---|---|---|
| routes/orders.js:188 | `/create-razorpay-order` | pending_payment; paid only after HMAC-verified `/verify-payment` | SAFE |
| routes/orders.js:367 | `/easebuzz/initiate` | pending_payment; paid only after hash-verified callback | SAFE |
| routes/orders.js:546 | `/phonepe/initiate` | pending_payment; paid only after PhonePe status API says COMPLETED | SAFE |
| **routes/orders.js:726** | **`/orders/checkout`** | **none — instant `status:"paid"`, `paymentNote:"mock"`** | **VULNERABLE — the incident** |
| routes/admin.js:1237 | admin toggle-parcel | admin-only, adjusts totals | SAFE |
| routes/vendor.js:497,532,569,... | vendor status transitions | status-guarded | SAFE |

**Order can be created before payment confirmation? YES** — exclusively via `/orders/checkout`. All three gateway flows correctly start at `pending_payment`.

---

## 7. Playwright Execution Analysis

- Base URL: `process.env.BASE_URL || 'http://localhost:3000'` (playwright.config.js:31). Tests ran against a **local server connected to the production database**. Production (flashfoods.in) itself was not directly targeted by the browser.
- **Not mocked, not stubbed** — API calls are real; payments are not bypassed by stubs because the *route itself* is the bypass.
- `tests/global-setup.mjs` / `tests/global-teardown.mjs` connect **directly to the production DB** and modify shop state.
- Only one test creates an order: tests/student-workflow.spec.js "student can place mock order".
- CI (`.github/workflows/playwright.yml`) runs `npx playwright test` on push — but `.env` is gitignored and absent in CI, so global-setup throws and CI tests fail rather than write to prod. **No CI involvement in the incident.**

---

## 8. Database Evidence (production Atlas `canteenDB`, read-only queries, 2026-08-19)

**19 orders with `paymentNote: "mock"` / `transactionId: "mock"` exist in production:**

| Shop | Count | Item | Total | Status | Created (UTC) |
|---|---|---|---|---|---|
| The Hummusery (`6a4944f2f889bb405d929b15`) | **15** | BBQ Chicken Shawarma x1 | Rs 139 | all **cancelled** (were "paid") | 2026-08-06 09:44 → 2026-08-07 10:43 |
| Juice Corner (`69f568a4f7637ea15152966c`) | 4 | (Juice Corner items) | Rs 40 | **completed** | 2026-08-06 10:50-10:52 |

Sample Hummusery order `6a75b6c1de39b2ee4020e1ac`: `paymentNote:"mock"`, `transactionId:"mock"`, **no `razorpayOrderId`, no `razorpayPaymentId`, no `gatewayTxnId`** — no gateway was ever involved.

**Were they genuinely unpaid? YES, proven.** All 15 Hummusery mock orders lack every gateway identifier and carry `paymentNote: "mock"`. Real Hummusery orders in the same period carry `paymentNote: "pay_..."` and `razorpayPaymentId: "pay_..."` (e.g., `6a75c8dcfbe7fe2ade54c4dc`, Rs 179, completed 2026-08-07 — a genuine paid order).

**Created by:** QA account `6a74172b60412aabfe22a01e` (student@college.test, seeded 2026-08-06 05:10 UTC). The account has since been **deleted** from production; `vendor@college.com` and `admin@college.com` (same seed run) still exist.

**Timeline corroboration:** the 15 Hummusery mock orders' item (BBQ Chicken Shawarma Rs 139) is the first item on Hummusery's menu — exactly what the test's `form[action="/cart/add"] .first()` adds. The last mock order (10:43 UTC) precedes the production deploy (10:55 UTC, build `4f643cc`). The QA report.md (2026-08-06) documents "Rs 139 in DB".

**`seed.js` ran against production on 2026-08-06 05:10 UTC** — users `vendor@college.com` / `admin@college.com` createdAt match; it also **deleted the previous `main-canteen` shop and its menu items** in production (seed.js:22-27).

**Webhook state:** every shop (`hummusery`, `breaktime`, `lalitha-restaurant`, `main-canteen`, `juice-corner`) has `hasWebhookSecret: false`; `RAZORPAY_WEBHOOK_SECRET` not set → webhook path dead.

---

## 9. Client-Side Trust / Session Review

| Concern | Verdict |
|---|---|
| Client amount/status/orderType trusted? | **No** — totals recomputed server-side from the session cart (routes/orders.js:711). The client sends `amount` in the Razorpay flow (views/cart/index.ejs:373) but it is ignored. |
| Client payment signature trusted? | **No** — `/verify-payment` re-derives the HMAC server-side (routes/orders.js:248-253). |
| Payment bypass via forge/replay of `/verify-payment`? | Not without the Razorpay `key_secret` (HMAC verified). |
| Webhook forgeable? | Signature checked with timingSafeEqual (routes/webhooks.js:83) — but **dead in prod** (no secret configured). |
| CSRF | **NO CSRF protection anywhere** (no csurf/token). Combined with no `SameSite` cookie (commented out, server.js:156), a cross-site form POST to `/orders/checkout` (and `/cart/add`) works against logged-in students → CSRF can create free orders. |
| Session | `SESSION_SECRET=my-super-secret-development-key-change-me` (guessable) → session-fixation risk; `secure` cookie flag not set (server.js:154-157). |
| Rate limiting | `DISABLE_RATE_LIMIT=true` (server.js:71, .env:32) — unlimited order creation / brute force. |
| Key exposure | Live `RAZORPAY_KEY_ID` injected into every rendered page (server.js:200-202); live keys in `.env`; a second **live** Razorpay key in Juice Corner's `paymentSettings` in the DB. |
| Cart tampering | `/cart/variant` recomputes prices server-side; `/cart/add` validates against `MenuItem`. Safe. |

---

## 10. Security Impact Assessment

### Severity: CRITICAL

### Exploitability: YES
Any authenticated student can create unlimited unpaid "paid" orders at any open shop with a single POST. Additionally exploitable via CSRF against any logged-in student, and session-fixation via the known session secret. The deployed production build still contains the route.

### Business Impact
- **Vendor receives fake orders** — confirmed: 15 orders hit Hummusery's dashboard with push notifications and socket pending-counts.
- **Inventory/waste loss** — confirmed at Juice Corner: 4 mock orders were marked **completed** (i.e., fulfilled/picked up) → real food given away. Hummusery mock orders were cancelled, but only after appearing in the dashboard.
- **Revenue loss** — every mock order is food prepared for free.
- **Trust damage** — vendors cannot trust the dashboard's "paid" flag; the pickup-code (OTP) flow can be completed on unpaid orders (pickupOtp generated at routes/orders.js:737).
- **Production data compromised** — 19 fake orders written; QA users created in prod; previous main-canteen shop + menu items deleted by seed.js; juice-corner shop state toggled by the test harness.

---

## 11. Confirmed vs Potential Findings

### CONFIRMED FINDINGS
1. `POST /orders/checkout` creates `status:"paid"` orders with no payment verification (routes/orders.js:726-738). Introduced 2026-05-02 (commit `300f5b7`); present in deployed production build `4f643cc`.
2. tests/student-workflow.spec.js:34-50 exercises it against the real vendor `hummusery`.
3. 19 `paymentNote:"mock"` orders in the production DB — 15 Hummusery (Rs 139) + 4 Juice Corner (Rs 40) — proven unpaid (no gateway identifiers).
4. Tests ran against a local server connected to the **production** Atlas DB (single `.env`, MONGO_URI=prod; playwright.config.js:31 default localhost).
5. `seed.js` executed against production on 2026-08-06 05:10 UTC (QA users' createdAt; destructive delete of previous main-canteen).
6. Test harness writes to prod DB: global-setup enables juice-corner / re-links vendor; teardown restores via hardcoded prod vendor id.
7. Razorpay webhook path non-functional in production (no webhook secret anywhere; routes/webhooks.js:73-76 → 500).
8. No CSRF protection anywhere; no SameSite/secure cookie flags.
9. report.md documents the operator knowingly ran the suite against production and recorded the paid mock order.

### POTENTIAL FINDINGS
1. **Juice Corner live Razorpay key** (`rzp_live_...` in shop paymentSettings) and `.env` live keys — possible compromise if the repo/machine was shared; rotate as precaution.
2. **4 Juice Corner mock orders marked completed** — may have been fulfilled (real food given away). Vendor interaction unverified.
3. **session-fixation via known SESSION_SECRET** — exploitable only if attacker can pre-sign a fixation cookie; requires the victim to log in through it.
4. **Weak/absent password policies and unverified signup** (anyone can sign up, then exploit `/orders/checkout`) — no evidence of external attackers; all 19 mock orders trace to the QA account.
5. **Rate limiting disabled** — amplifies any of the above.

---

## 12. Affected Components

| Component | File:Line |
|---|---|
| Mock checkout route | routes/orders.js:677-750 (create at 726-738) |
| Order model default | models/Order.js:66 |
| Vendor pending query | routes/vendor.js:378 |
| Playwright test | tests/student-workflow.spec.js:3,34-50 |
| Test harness DB writes | tests/global-setup.mjs:17,34-37; tests/global-teardown.mjs:24-29,31 |
| Config / secrets | .env (prod MONGO_URI, live Razorpay, weak SESSION_SECRET, DISABLE_RATE_LIMIT) |
| Session setup | server.js:148-158, 200-202 |
| Razorpay webhook | routes/webhooks.js:71-76 |
| Seeder | seed.js:20-27 |
| Cart UI copy | views/cart/index.ejs:194-196 |

---

## 13. Recommended Fixes (ranked by urgency)

1. **IMMEDIATE — Remove the mock route.** Delete `POST /orders/checkout` (routes/orders.js:677-750) from production code; fix the test to assert against a real gateway flow or a test-only flag that is impossible in prod (e.g., `NODE_ENV !== 'production'` + non-default env var, then DELETE the route entirely once tests are updated). Deploy now — production is currently exploitable.
2. **IMMEDIATE — Rotate all secrets** that touched tests: Razorpay live key (`.env` + Juice Corner `paymentSettings` in DB), Cloudinary, CCAvenue, PhonePe, RESEND, Firebase service account. They sat in `.env` used against prod and in the DB.
3. **IMMEDIATE — Environment isolation:** separate `.env.production` (server only) from `.env.local` (dev); guard `global-setup.mjs` to abort if `MONGO_URI` is the production cluster; never run `seed.js` or Playwright against prod.
4. **HIGH — Clean production data:** delete/archive the 19 mock orders, remove QA users (`vendor@college.com`, `admin@college.com`), restore main-canteen if needed, verify juice-corner state (currently disabled — correct).
5. **HIGH — Fix webhooks:** set `RAZORPAY_WEBHOOK_SECRET` and per-shop secrets so server-side payment confirmation works; consider PhonePe/Easebuzz webhooks.
6. **MEDIUM — Session hardening:** strong random `SESSION_SECRET`, `secure: true`, `sameSite: 'lax'`, re-enable rate limiting.
7. **MEDIUM — CSRF protection** on all state-changing routes.
8. **LOW — Remove `paymentNote: "mock"` default** from models/Order.js:66 and the "Payment is simulated" copy (views/cart/index.ejs:195).

---

## 14. Investigation Checklist Answers

1. **How orders were created:** `POST /orders/checkout` mock route (routes/orders.js:677-750). | 2. **Which route:** `/orders/checkout`. | 3. **Payment verification skipped?** YES — none exists on this route. | 4. **Playwright hit Production?** It hit a local server **connected to the production DB**; same effect. | 5. **Can test users create unpaid orders?** YES — proven 19 times. | 6. **Any route allowing direct order creation without payment?** YES — `/orders/checkout`. | 7. **Razorpay/PhonePe/Easebuzz verification bypassed?** Not in the gateway flows themselves (all verified correctly); they are bypassed *by not being used*. | 8. **Webhook verification broken?** Signature logic correct but **non-functional** (no secrets configured anywhere). | 9. **Session manipulation can create orders?** Weak SESSION_SECRET enables fixation; CSRF can create orders for logged-in students. | 10. **Cart trusts client data?** No — server-side recomputation (good). | 11. **Developer shortcut reached production?** YES — the route is live in the deployed build. | 12. **Additional vulnerabilities:** CSRF, weak session secret, disabled rate limit, live key exposure, destructive seed, test harness writes to prod DB.

---

*Investigation performed read-only against production; no fixes applied. Report generated 2026-08-19.*
