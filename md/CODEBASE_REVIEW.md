# FlashFoods — Full Codebase Review

**Project:** FlashFoods — a web-based college canteen pre-ordering platform
**Stack:** Node.js (ESM) + Express 5 + Mongoose 8 + EJS + Socket.IO, MongoDB (Mongoose), Razorpay/Easebuzz/PhonePe payments, Firebase Cloud Messaging, Cloudinary, Gemini Vision (menu photo import), Playwright e2e.
**Scale:** ~10,000 lines of server-side JS across ~45 files, plus ~13k lines of EJS views and `public/js`.

This document reconstructs the important source so a reviewer can reason about the code directly (not just from summaries). Every finding has a `file:line` reference. Findings marked **[verified]** were read directly in the source; others come from a structured read of the full file.

---

## 1. Repository Map

```
server.js                     Express app bootstrap (280 lines)
config/                       db, cloudinary, easebuzz, firebase-admin, phonepe, razorpay
middleware/                   auth.js, requireDb.js, upload.js
models/                       User, Shop, MenuItem, Order, FcmToken (all small)
routes/
  admin.js       2,086 lines  shops+vendors+students+orders+menus+analytics+menu-import
  vendor.js      1,168 lines  menu CRUD + order lifecycle + OTP verify + pay settings + refunds
  orders.js        819 lines  3 payment gateways + verify + callbacks + mock checkout
  cart.js          284 lines  session cart
  auth.js          183 lines  signup/login/logout/password reset
  webhooks.js      153 lines  Razorpay webhook receiver
  profile.js, menu.js, shops.js, api/fcm.js
socket/index.js               40 lines   io → "vendor:join" room, pending-count broadcast
utils/                        otp, phone, email, notification-dispatch, admin, pricing, time, constants
menu-import/                   vision(Gemini), splitter, importer, validator, json-recovery, store, preview, upload, debug
seed.js, scripts/              seed + menu price migration
tests/                        Playwright e2e (smoke, login, permissions, workflows, mobile/, instrumentation/)
public/                       sw.js, firebase-messaging-sw.js, js/ (notification-manager etc.)
docs/, .ai/                    architecture, audits, tech-debt, PAYMENT_FLOW, route/socket maps (some stale — see §9)
```

**Data model at a glance**

- `User`: `name, email(unique), passwordHash, role(student|vendor|admin), shop?, phone, isActive, resetPasswordToken/Expires`
- `Shop`: `name, slug(unique), vendor?, paymentGateway(razorpay|easebuzz|phonepe|paytm|bharatpe), paymentSettings{merchant creds, razorpay{keyId,keySecret,webhookSecret}, easebuzz{salt}, phonepe{clientSecret}}, isOpen, isActive, parcelCharge`
- `MenuItem`: `shop, name, category, price, available, foodType(veg|non-veg|egg|unknown), variants[{label,price}]`
- `Order`: `customer, shop, items[{menuItem,name,price,quantity,status(active|removed),variant*}], orderType(dinein|parcel), parcelCharge, total, pickupTime, pickupReminderSent, collectedAt, status(pending_payment|paid|accepted|ready_for_pickup|completed|cancelled), pickupOtp, paymentNote, transactionId, razorpayOrderId, razorpayPaymentId, webhookEventId, gatewayTxnId, refundStatus(none|pending|completed|failed), originalTotal, updatedTotal, refundAmount, adjustedAt, adjustedBy, adjustmentReason`
- `FcmToken`: `vendorId, token(unique), deviceInfo` (+ TTL index 90 days)

**Session/auth architecture:** `express-session` (default MemoryStore) + `connect-flash`. `attachUser` middleware hydrates `req.user` from `req.session.userId` on every request. Password hashes with bcryptjs (cost 10, hardcoded).

---

## 2. Critical — Payment Integrity & Money Handling

### 2.1 Razorpay `/verify-payment` — insecure comparison + no amount check + non-atomic status transition

`routes/orders.js:248-292` (the client-facing payment finalize):

```js
const expectedSign = crypto
  .createHmac("sha256", keySecret)
  .update(sign.toString())
  .digest("hex");

const isAuthentic = expectedSign === razorpay_signature;     // BUG: `===` (timing-attackable)

if (!isAuthentic) { /* 400 */ }

const order = await Order.findOne({ razorpayOrderId: razorpay_order_id });
if (!order || String(order.customer) !== String(req.session.userId)) { /* 404 */ }

if (order.status !== "pending_payment") { /* already handled */ }

order.status = "paid";                                        // BUG: read-modify-write, no atomicity
order.paymentNote = razorpay_payment_id;
...
await order.save();
```

Findings:
- **`orders.js:253` — Insecure string comparison of the HMAC.** `expectedSign === razorpay_signature` compares strings, which leaks timing. The *webhook* handler does it right (`webhooks.js:13-19` uses `crypto.timingSafeEqual`). The user-facing verify path should use the same helper. **[verified]**
- **`orders.js:248-260` — No verification that the payment AMOUNT matches `order.total`.** The signature covers `order_id|payment_id`, proving Razorpay issued a payment for this order, but the captured amount is never compared to the stored total. Razorpay's amount is bound to the order at creation, but defense-in-depth (and cross-gateway consistency) demands an explicit amount check.
- **`orders.js:262-292` — find → check → mutate → save is not atomic.** Two concurrent requests (double-click, retry) both read `pending_payment` and both `save()` `paid`. Side effects (`emitPendingCount`, `dispatchNewOrderNotification`, likely FCM push) fire twice; with multiple Node instances a real double-marking is possible. The webhook handler already solves this with `findOneAndUpdate({ razorpayOrderId, status: "pending_payment" })` (`webhooks.js:98-110`) — the pattern exists and should be reused here.

### 2.2 PhonePe callback marks order paid without validating amount

`routes/orders.js` callbacks: `order.status = "paid"` after `getOrderStatus` returns `COMPLETED`, but the charged amount is never compared to `order.total`. Server-rendered checkout confirm + callback-only reconciliation. If the gateway ever echoes a different amount than the order total, the order is still marked paid. Missing an explicit `Number(payload.amount) === order.total` check.

### 2.3 Only Razorpay has a server-side webhook (routes/webhooks.js). Easebuzz and PhonePe depend entirely on the browser redirect.

- Easebuzz: order goes `pending_payment → paid` only inside the HTTP callback (`orders.js:431-470`). If the user closes the tab before the redirect, connectivity drops, or the callback errors, the order is stuck in `pending_payment` forever. There is **no reconciliation job**, no expiry sweep, no webhook.
- Same for PhonePe (`orders.js:632-639`).
- Easebuzz callback **never clears the session cart** — Razorpay (`orders.js:284`) and PhonePe do.
- PhonePe callback route is mounted to accept all methods (`.all()`) so a plain GET can flip order state.

### 2.4 Vendor refund/adjust math edge cases (real money)

`routes/vendor.js:855-975` — partial-adjust endpoint. The money math:

```js
let originalTotal = Number(order.total);      // includes parcelCharge if order was parcel
let updatedTotal = 0;
for (let i = 0; i < order.items.length; i++) { ... }
if (order.orderType === "parcel") updatedTotal += Number(order.parcelCharge);
const refundAmount = originalTotal - updatedTotal;
```

- The **`keep_items` index list is not bounds-checked.** `parseInt` of user-supplied form values are filtered to non-negative, but nothing enforces `index < order.items.length` (`vendor.js:873-884`). Submitting a bogus index (e.g., `keep_items=999`) passes the `length !== 0` and `length !== items.length` guards, then `keepIndices.includes(i)` is false for every real index → **all items are marked removed, `updatedTotal` collapses, and a full refund is issued** through the "adjust" path (which bypasses the cancel-flow checks). This is a financial bug that a malicious or erroring vendor can trigger.
- **Interplay with `toggle-parcel` is inconsistent.** `toggle-parcel` mutates `order.total` in place (`+/- parcelCharge`, `vendor.js:795-806`) on already-paid orders with no payment adjustment — the order total then no longer represents what was charged. If an adjust follows a toggle, `originalTotal` reflects the toggled total while `updatedTotal` always re-adds parcel charge, so `refundAmount` can be wrong (potentially negative). The two features don't share a single definition of "total".
- **Refund failure is downgraded silently**: on error `refundStatus = "pending"`, but `order.total` is still reduced and the vendor UI says "Refund of ₹X processed" only when `completed`... actually it flashes an error on `pending`. The order, however, permanently stores `total = updatedTotal` and `refundAmount` while the money was never returned → the student was charged the original amount but the system shows a lower total with a refund that never happened. Cancel-path (`vendor.js:670`) correctly sets `"failed"`; adjust-path does not.
- Vendor can only cancel orders in `paid` status (`vendor.js:603`) — a `accepted` or `ready_for_pickup` order can never be cancelled or refunded through the app (dead end if the kitchen can't fulfill).
- `order.total` was originally a float computed as `foodTotal + parcelCharge` (`orders.js:70-98`) and further mutated by `toggle-parcel` with `-=`/`+=` (`vendor.js:798-805`). **All money is IEEE-754 float**, and the Razorpay amount is `Math.round(total * 100)` paise (`orders.js:183`) — float error amplified through the ×100. Repeated parcel toggles accumulate drift. Money should be integer paise or `Decimal128`.

### 2.5 Payment secrets (`Shop.paymentSettings`) are stored and returned as plaintext

`routes/vendor.js:1082-1153` and admin payment-settings forms write `razorpayKeySecret`, `easebuzzSalt`, phonePe `clientSecret`, etc. into MongoDB unencrypted. A DB dump/backup leak exposes every merchant's live API secrets. No encryption at rest.

---

## 3. Critical — Authentication & Session Security

`server.js:148-159`:

```js
app.use(session({
  secret: process.env.SESSION_SECRET || "dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    // sameSite: "lax",        // <-- commented out
  },
}));
```

- **No CSRF protection anywhere (zero).** There is no csurf/csrf library in `package.json`, no custom token, and `sameSite` is commented out. Every authenticated state-changing POST (create order, verify pickup OTP, refund, cancel, profile update, password change, admin actions) is vulnerable to cross-site request forgery. A for-each-session cookie. Recommend: uncomment `sameSite:"lax"` + add a per-session CSRF token on all POST forms, or CSRF protection via `SameSite` + double-submit cookie.
- **Session fixation — no `session.regenerate()` on signup/login.** `routes/auth.js:44,78` assign `req.session.userId` on a reused session ID. An attacker who plants a known session ID in the victim's browser has it authenticated after the victim signs in. Fix: `req.session.regenerate()` before setting the user.
- **Weak default session secret**: `"dev-secret"` in production if `SESSION_SECRET` not set.
- **Session cookie has no `secure` flag** (Express 5 default is `secure: false`) — cookie rides over plain HTTP.
- **Password reset does not invalidate existing sessions.** `routes/auth.js:137-178` changes the hash but existing open sessions survive (the code even comments the limitation). A hijacked account stays logged in after a forced reset. Fix: delete/rotate the session or bump a `passwordVersion`.

`server.js:64-81` (rate limiting):

```js
const limiter = rateLimit({ windowMs: 15*60*1000, max: 300, ... });
const disableRateLimit = process.env.DISABLE_RATE_LIMIT === "true";
if (!disableRateLimit) app.use(limiter);
```

- One global limiter covers **everything**, so login gets no tighter protection: ~20 auth guesses/min/IP with no lockout, no per-account throttle. And a single env flag (`DISABLE_RATE_LIMIT=true`) disables the app's only brute-force defense — that flag should never work in production.

Other auth findings:
- **bcrypt cost hardcoded to 10** (`routes/auth.js:35,163`) although `utils/constants.js` exports `BCRYPT_SALT_ROUNDS` that is never imported. OWASP 2026 recommendation is ≥12.
- **Reset token travels in the URL** (`routes/auth.js:104-113`) → leaks via Referer/access logs. Hashed at rest, but the raw token in the link is the exposure.
- No password-length validation on **signup** (only reset enforces it); no duplicate-phone check (two accounts can share a phone).
- Role is hardcoded to `"student"` on signup (`routes/auth.js:40`) — correct, prevents self-escalation. **[verified]**
- Email lookups string-coerce input (`String(email).toLowerCase().trim()`), so NoSQL `$`-operator injection into `findOne` is neutralized. **[verified]**

---

## 4. High — Order-State Races (the core flow)

Most status mutations are read-then-write, not atomic. The webhook already shows the correct pattern (`findOneAndUpdate` with status precondition). Non-atomic spots:

| Location | Flow | Risk |
|---|---|---|
| `routes/orders.js:262-279` | verify-payment `pending_payment→paid` | double side-effects, double notification push |
| `routes/vendor.js` accept (`paid→accepted`) | `findById` → check → `save` | double-accept on double-click / two vendor tabs |
| `routes/vendor.js` ready (`accepted→ready_for_pickup`) | same pattern | same |
| `routes/vendor.js:708-771` OTP verify | `findOne({pickupOtp,status:ready_for_pickup})` → mutate → `save` | two concurrent verifications both succeed; OTP side effects double-fired |
| `routes/vendor.js:746-757` | completes with `console.log` debug + re-fetch of the order | dead bytes + logs PII |

**Recommended fix for all:** `Order.findOneAndUpdate({ _id, shop, status: <expected> }, { $set: {...} }, { new: true })` and branch on `updated == null` to detect the lost race.

---

## 5. High — OTP Pickup Verification

The whole business model is "pre-order + OTP pickup verification" but the OTP is weak by construction:

- **6 digits ≈ 20 bits** (`utils/otp.js`), stored **in plaintext** in the Order document (`orders.js:197`, `orders.js:376`, `orders.js:555`, `orders.js:731`, `vendor.js:726-730` compares plaintext).
- **No rate limit on `POST /vendor/verify`** (`vendor.js:708-771`). A compromised/abusive vendor session can brute-force `ready_for_pickup` orders in reasonable time.
- **OTP never expires.** A code generated days ago still completes an order. No `pickedUpBy`/expiry timestamp.
- As a mitigation the OTP scheme is at least scoped to the vendor's own shop (`shop: req.vendorShopId`) — cross-shop enumeration is blocked. But: brute-force + no expiry + plaintext-at-rest = free food for anyone with any vendor session.
- Fix: hash OTP at rest (compare hash, not plaintext), add expiry, add per-vendor slow-down/rate-limit on `/vendor/verify`, and use an atomic `findOneAndUpdate` with `status: "ready_for_pickup"`.

---

## 6. High — FCM Push-Token Hijack

`routes/api/fcm.js:9-31`:

```js
await FcmToken.findOneAndUpdate(
  { token },
  { vendorId: req.user._id, deviceInfo: ... },
  { upsert: true, new: true, setDefaultsOnInsert: true },
);
```

The upsert is keyed **only on `token`** (unique), but overwrites `vendorId` with the caller's id. Any authenticated vendor who knows another vendor's token value mints the push subscription away from its owner — the FCM token is then notified for the attacker's orders (`notification-dispatch.js` fetches by `vendorId`). `unregister` correctly scopes by `{ token, vendorId }`; `register` does not. Fix: match on `{ token, vendorId: req.user._id }` and upsert with `$setOnInsert` for vendorId.

---

## 7. High — Admin Panel

`routes/admin.js` (2,086 lines) is the app's largest and most fragile file.

### 7.1 Unhandled promise rejections crash the process

Node treats an unhandled rejection as fatal (`server.js:45-54` only logs before the process dies on a fresh event loop turn). At least **18 async route handlers in admin.js have no try/catch** (`admin.js:302,354,455,509,610,634,662,777,802,856,902,995,1019,1042,1069,1121,1145,1175,1210`). The dashboard handler itself:

```js
adminRouter.get("/", async (req, res) => {
  const [totalShops, totalVendors, totalStudents, totalOrders, ...] =
    await Promise.all([...]);        // admin.js:302-333 — no try/catch
```

Any Mongo timeout/transient error inside any of these → uncaught async throw → whole app down. This is the single highest-availability risk in the file. Recommended: an `asyncHandler` wrapper used consistently (or rely on Express 5 auto-forwarding rejected promises — but the code doesn't rely on it consistently today; some handlers have try/catch, most don't).

### 7.2 Dashboard stats are wrong

`routes/admin.js:316-318`:

```js
totalOrders:      Order.countDocuments({ status: "completed" }),
...
completedOrders:  Order.countDocuments({ status: "completed" }),
```

`totalOrders` counts *only completed orders* — same query as `completedOrders`. The dashboard "total orders" is a lie whenever there are pending/paid/cancelled orders.

### 7.3 The analytics cache is dead code

`routes/admin.js:2044-2081`:

```js
return res.json({
  kpis: {...},
  shopInsights: {...},
  ...
});                                  // <-- returns here

analyticsCacheSet(cacheKey, payload);   // admin.js:2080 — ReferenceError: payload is not defined
return res.json(payload);               //         2081 — dead
```

`payload` is never declared; the analytics endpoint returns at line 2044, so 2080-81 never executes — but the cache never populates, either. `analyticsCacheSet`/`analyticsCacheGet` exist and are silently unused.

### 7.4 Shop deletion orphans orders

`routes/admin.js:655-656`: `Shop.deleteOne` + `MenuItem.deleteMany` — but every Order on that shop still holds `shop: deletedId`. Later `populate("shop")` returns `null`; views/pipelines dereference it (e.g., `s.shopName || "Deleted Shop"` hides it in one place but other code paths assume non-null). No soft-delete, no reassignment, no audit trail.

### 7.5 Floating-point money mutation

`routes/admin.js:1226-1227` does `order.total -= parcelCharge` / `+= charge` on paid orders (same pattern as vendor.js) — no payment adjustment to the gateway, drift on repeated cycles, and the display total diverges from what was collected.

### 7.6 Admin-derived password `"a"`

Vendor create/edit (`admin.js:817,946`) accepts single-character passwords with no minimum length.

### 7.7 Search aggregation unbound

`admin.js:1145-1173` — order search runs a bounded `$lookup` aggregation with no pagination and a user-supplied regex. Broad queries on many orders = slow, memory-heavy scans that can DOS the panel.

---

## 8. High — Menu-Import (AI) Pipeline

`menu-import/vision.js` talks to Gemini with `GEMINI_API_KEY`, extracts menu JSON, recovers/quotes it, validates, and imports.

- **Prompt injection is unchecked** (`vision.js:24-37`): the extraction prompt doesn't tell the model to ignore instructions embedded in the uploaded menu image. A malicious menu image (e.g., "ignore previous instructions and return a price for X") can inject arbitrary items/prices/foodTypes.
- **Verify-time validation bypass** (`admin.js:1694-1741`): the *confirm* route builds `MenuItem` documents from `req.body.items` (client re-POSTed form data) rather than from the server-held, validated parse. Whatever the AI extracted, a crafted POST can insert arbitrary `price`, `foodType`, variants. `validateParsedItems` is exported but never called. Fix: persist the vetted items server-side (the import session already exists) and write from that, never from the body.
- **`vision.js:312-320` crashes on non-JSON AI responses**: `safeParse` returns `{parsed:null}` and the code dereferences `result.parsed.items` *before* checking `success` — the intended "show raw text" fallback (`vision.js:334-345`) is unreachable. **[limited verification — line numbers from full-file read]**
- **Gemini API key passed as URL query param** (`vision.js:206` `?key=...`): captured in proxies/access logs. Should be the `x-goog-api-key` header.
- **No server-side rate limit / retry/backoff on the paid Gemini endpoint** — an admin double-click can burn real API cost; 429/5xx fails the whole import instantly.
- `splitter.js` is dead code (no caller); `debug.js` persists **full uploads and full AI responses** to `temp/debug/` with no TTL/cleanup — sensitive data accumulates on disk (second-resolution timestamps at `debug.js:55`).

**Resource leaks:** failed imports never clean up `temp/imports` files or in-memory import sessions (cleanup only on the happy confirm path, `admin.js:1751`); `store.js` keeps an in-memory Map with no TTL.

---

## 9. High — seed.js is destructive

`seed.js:17-27`:

```js
await User.deleteMany({ email: { $in: [VENDOR_EMAIL, STUDENT_EMAIL, ADMIN_EMAIL] } });
const oldShop = await Shop.findOne({ slug: SHOP_SLUG });
if (oldShop) {
  await MenuItem.deleteMany({ shop: oldShop._id });
  await Shop.deleteOne({ _id: oldShop._id });
  ...
}
```

Runs unconditionally against whatever `MONGODB_URI` points at. If it points at any real database containing these emails or the `testing` slug, real data is permanently deleted — **no `NODE_ENV !== "production"` guard**. Hardcoded, printed passwords `vendor@1` / `admin@1` shared across every environment (`seed.js:10-15,69-73`). Migration script `scripts/migrate-menu-prices.js` likewise has no environment guard (it's idempotent, but still points at the configured DB).

---

## 10. Testing & CI

`playwright.config.js` + `.github/workflows/playwright.yml`.

### 10.1 CI cannot pass, by construction

- **No `webServer`**: `webServer` block in `playwright.config.js:73-77` is commented out and the workflow never boots the app. `npx playwright test` page.goto's `localhost:3000` with nothing listening → connection refused on every spec.
- **`headless: false`** (`playwright.config.js:35`) on a GitHub runner with no X server and no `xvfb-run`.
- **No database, no seed, no env in CI.** The app refuses to boot without Mongo (`server.js:266-274`); `mongodb-memory-server-core` is a dependency but is never used; `.env` is gitignored; the workflow has no `env:` block. Fix: spin up MongoDB (memory-server or a workflow service container), seed, set the few env vars the suite truly needs, enable headless, restore `webServer`.

### 10.2 Money-path coverage is zero

Webhook signature + idempotency (`webhooks.js`), OTP pickup verification, cancel/partial refund logic, and server-side price re-verification against tampering (`orders.js:160-166` "cannot be tampered with client-side") have **no tests**. This is the highest-value, highest-risk code in the app. *(Another consequence: the signature check regressed from timing-safe → `===` between webhook and verify paths without any test catching it.)*

### 10.3 Suite quality problems

- **Hardcoded credentials committed** (`vendor-workflow.spec.js:3,8` uses `test.vendor@flashfoods.test`/`Test@123` which *nothing in the repo creates* — `global-setup.mjs:22-24` throws if missing, so vendor-workflow can never pass on a fresh DB). Other specs duplicate `seed.js` creds instead of reading them.
- **Shared-DB mutation under `fullyParallel: true`** (`playwright.config.js:20`, 4 projects): student-workflow creates orders per run, login creates users per run, vendor-workflow toggles shop open/closed — concurrent race, test-pollutes the real database, non-reproducible.
- **White-box tests** reach into private socket.io internals (`notification-lifecycle.spec.js:73-77,106-110`) with fixed `waitForTimeout` sleeps — flaky by design.
- **CDP-only tests run in Firefox/WebKit projects** (`pwa-installability.spec.js:6,20`, `navigation-auth.spec.js:7`): `newCDPSession` throws in non-Chromium projects; there's no `testMatch`/project filter.
- **Live Firebase/DOM assertions** (`fcm-diagnostic.spec.js:91-95`) need real Firebase secrets and the SDK CDN.
- **`test-category-runtime.mjs` is an orphan** that connects to the *production* Atlas URI directly, grabs the first shop/vendor, deletes menu items by name globally — destructive, not in CI, not a Playwright spec.
- No-op tests: `tests/mobile/vendor-flow.spec.js:19,27` (`expect(true).toBe(true)`), `student-flow.spec.js:17-22` skips body without asserting.
- Env-var mismatch: global hooks read only `MONGO_URI` while the app prefers `MONGODB_URI` (`config/db.js`, `.env.example`) — documented setup can't run the suite.

What's decent: real signup/login e2e, role-redirect permission matrix, session-persistence cookie checks, PWA installability (Chromium-only), and the global-setup/teardown shop-snapshot pattern — those are worth keeping and extending.

---

## 11. Additional Findings (medium/low)

- **`server.js:165-223`** — per-request DB query on every page (`Shop.findById` for vendors) plus cart reduce; fine at college scale, but it's a per-hit DB round-trip on every render; `res.locals.vendorShop` reload on each request.
- **Money as float throughout** (`order.total`, `parcelCharge`, `menu price`); Razorpay amount computed `Math.round(total*100)` — prefer integer paise.
- **`orders.js:80-84`** — invalid `variantId` silently falls back to base price (over/undercharge depending on variant); should reject. Same normalize pattern is copy-pasted across `cart.js`, `orders.js`, `vendor.js` (4+ copies — a classic "fix in one place" drift bug source, already documented in `docs/TECH_DEBT.md`).
- **Menu CRUD duplicated** between `routes/vendor.js` and `routes/admin.js` (create/update/delete/toggle) — fixes must be applied twice.
- **`routes/admin.js` imports `isGatewayConfigured` from `routes/vendor.js`** — cross-route coupling; belongs in a util.
- **Session store is the default in-memory `MemoryStore`** — sessions lost on restart, not shareable across instances (fine single-instance, note for scale).
- **No pagination** on vendor completed-orders (hard limit 50), admin lists.
- **`requireDb` redirects to `/` with `req.flash` even for JSON consumers** — inconsistent error contract.
- **Bare `var` in `cart.js`/`orders.js`**, magic numbers (6-digit OTP, 300 rate, 99 qty, 20-min pickup urgency), debug `console.log`s left in admin.js (`[MARK]`), vendor.js (OTP completion logs), phonepe config (refund payload logging).
- **`docs/` are partially stale**: `ENGINEERING_AUDIT.md` lists files (`-b`, `*.bak`, `test.txt`) that no longer exist; `.ai/` duplicates docs/. Some doc drift is expected; the payment-vs-actual drift is not (e.g., Paytm/BharatPe enums exist in the schema with no routes).

---

## 12. What's Actually Done Well

Called out so a reviewer doesn't reflexively condemn the whole thing:

1. **Server-side price derivation at order creation.** `buildOrderItemsFromCart` (`orders.js:60-99`) re-reads the DB and recomputes every line's price from the stored MenuItem, so a tampered `price`/`quantity` payload can't inflate totals; quantity is clamped 1–99. The comment even says so. **[verified]**
2. **Webhook handler is the good example.** Constant-time signature check (`webhooks.js:13-19`), signature verified over the raw body, event-ID idempotency (`webhookEventId`), status-preconditioned atomic update, acks 200 to stop retries. The `/verify-payment` route simply failed to reuse it.
3. **Good indexes.** Order has targeted indexes (`shop+pickupOtp`, `shop+status`, `customer+createdAt`, `status+createdAt`, `shop+createdAt`, `shop+pickupTime+createdAt`, sparse-unique `razorpayOrderId` and `gatewayTxnId`, `FcmToken` TTL). **[verified]**
4. **Vendor/auth scoping is mostly correct.** `requireVendorShop` pins `req.vendorShopId`; vendor order routes scope queries by shop (verified in the adjust route's `String(order.shop) !== req.vendorShopIdStr` guard, `vendor.js:862-864`). No obvious cross-shop IDOR on the main vendor paths. **[verified]**
5. **Signup role is hardcoded to `student`** — no self-escalation. Emails are string-coerced → NoSQL injection neutralized. **[verified]**
6. **Secrets hygiene at the repo level.** `.env` is properly gitignored (not tracked); `multer` caps uploads at 5 MB; Cloudinary `allowed_formats` restricts types; `attachUser` selects `-passwordHash` so the hash never hits templates.
7. **Password hashing** with bcrypt (just needs cost ≥12).
8. **helmet is on** and a global rate limiter exists (both need the CSRF/session-secret gaps above fixed to matter).

---

## 13. Prioritized Remediation

**P0 — money & auth (do before anything else):**
1. CSRF protection (enabling `sameSite:"lax"` + tokens) and `session.regenerate()` on login/signup; secure session cookie in production. (`server.js:148-159`, `routes/auth.js`).
2. Make Razorpay `/verify-payment` reuse the webhook's timing-safe compare + amount check + atomic `findOneAndUpdate`. (`orders.js:253-292`).
3. Add PhonePe/Easebuzz **amount verification** in callbacks; add a webhook/reconciliation job so a dropped redirect can't strand orders in `pending_payment`; clear the cart on all three gateways.
4. Make **all** order-status transitions atomic with status-preconditioned `findOneAndUpdate` (verify, accept, ready, OTP-complete).
5. Harden OTP: hash at rest, add expiry, rate-limit `/vendor/verify`, bounds-check `keep_items`. 

**P1:**
6. Wrap every async route handler (esp. `admin.js`, 18+ handlers) in a shared `asyncHandler` so a DB blip can't kill the process.
7. Fix dashboard `totalOrders` (counts only completed) and remove the dead `payload` cache lines; either implement `analyticsCache` properly or delete it.
8. Seed/migration: abort unless a test DB is confirmed; stop printing passwords; guard against production.
9. Soft-delete/archive shops instead of `deleteOne`; keep orders consistent.
10. Add server-side validation at the menu-import **confirm** boundary (write from the vetted parse, not `req.body`); tell Gemini to ignore image-embedded instructions; move API key to header.
11. Guard `seed.js`/migration against `NODE_ENV=production`.

**P2:**
12. Make CI runnable (memory-server or service container + seed + env + headless + `webServer`); then add the money-path tests last but soonest-owned by whoever touches payments.
13. Money as integer paise or `Decimal128`; extract `toPaise`/`fromPaise`.
14. Server-side aggregation of read queries off the HTTP path; paginate admin analytics/search.
15. Split the three giant route files (admin 2k, vendor 1.2k, orders 0.8k) with a small service layer; dedupe variant-resolution, refund, gateway-setup logic; audit and prune debug logging.

---

## 14. Honest Assessment

A functional "move-fast" MVP: the core happy path (browse menu → session cart → gateway checkout → OTP pickup) works and the server correctly re-derives prices and scopes vendor queries. But it is held together by convention, not enforcement: CSRF is absent, session handling is vulnerable, two of three payment gateways have no server-side reconciliation, order-state transitions race, the admin panel can crash the process on a DB hiccup and shows wrong dashboard numbers, the menu-import pipeline bypasses its own validation at the write boundary, and the "testing" suite cannot run in CI and tests none of the money code. Everything P0 uses patterns that already exist correctly elsewhere in this same repo (timing-safe compare + atomic conditional update in `webhooks.js`) — the fixes are mostly "make the rest of the app match the webhook handler."

---

*Review produced 2026-09-08. Line numbers refer to the current working tree. Items marked [verified] were read directly at the cited line; the remainder come from full-file reads and file-level line ranges.*