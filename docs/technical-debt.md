# FlashFoods — Technical Debt Register

> Prioritized. Severity = impact × likelihood at real-user scale. "Effort" is rough engineering days.

## Legend
- 🔴 Critical — launch-blocking or money/data-integrity risk
- 🟠 High — will cause incidents or hard rework soon
- 🟡 Medium — quality/scale debt, schedule deliberately
- 🟢 Low — hygiene, do opportunistically

---

## 🔴 Critical

### TD-1 — Reachable mock checkout creates free paid orders
`POST /orders/checkout` (`routes/orders.js`) creates a `status:"paid"` order with `paymentProvider:"mock"` and **no payment**, guarded only by `requireStudent`. Any logged-in student can place unlimited free orders.
**Fix:** delete the route, or hard-gate behind `NODE_ENV !== "production"` + an explicit dev flag. **Effort:** 0.5d.

### TD-2 — No payment webhooks; captured-payment-without-order
Order creation depends on the client Razorpay callback reaching `/verify-payment`. Tab close / network drop after capture = money taken, no order, no reconciliation. **Fix:** webhook ingress + idempotent order creation + daily reconciliation. **Effort:** 4–6d. (See `payment-architecture.md`.)

### TD-3 — Charged amount not bound to order total
`/create-payment-order` charges amount A; `/verify-payment` recomputes total B from the live cart and stores B. The two can diverge → underpayment / mismatched records. **Fix:** fetch gateway order by id, assert amount, store gateway amount as truth. **Effort:** 1d.

### TD-4 — Vendor payment secrets stored in plaintext and rendered to HTML
`Shop.paymentSettings.apiSecret` is unencrypted in MongoDB and echoed into `payment-settings.ejs` as an input `value`. **Fix:** envelope-encrypt at rest; never select secrets into views; show masked status. **Effort:** 2d.

### TD-5 — `routes/menu.js` uses `Shop` without importing it
The `/menu/:id/toggle` route throws `ReferenceError: Shop is not defined` on first use — menu availability toggling is broken. **Fix:** add the import (or remove the dead route). **Effort:** 5 min.

---

## 🟠 High

### TD-6 — Session state in MemoryStore
Default `express-session` MemoryStore: single-instance only, leaks memory, **drops all sessions and carts on every restart/deploy**, blocks horizontal scaling. **Fix:** `connect-mongo` or Redis. **Effort:** 0.5d. *Highest ROI on the list.*

### TD-7 — No tenancy / College model
Shops, vendors, students, orders are global; a second college shares data with the first. **Fix:** introduce `College`, scope all queries, add college selection to onboarding. **Effort:** 5–8d (foundational).

### TD-8 — Admin list endpoints load entire collections into memory
`/admin/orders` → `Order.find()` with no limit, filtered/searched in JS. Vendor/student lists similarly unbounded. O(collection) memory + latency. **Fix:** DB-side filtering + pagination + indexes. **Effort:** 2–3d.

### TD-9 — No security baseline
No `helmet`, no CSRF protection, no rate limiting, no global error handler, no security headers. Every state-changing form (including refunds) is CSRF-vulnerable; login is brute-forceable. **Fix:** add the baseline. **Effort:** 2–3d. (See `security-review.md`.)

### TD-10 — Per-request DB amplification
`attachUser` (every request) + `requireAuth` (auth routes) + `res.locals` vendor-shop lookup = up to 3 uncached `findById` calls before a handler runs. **Fix:** cache user on session, single hydration, drop redundant lookups. **Effort:** 1d.

### TD-11 — Three "supported" payment providers are mocks
CCAvenue/Paytm/PhonePe return mock objects and "not implemented." Selecting them flips `paymentConfigured=true` but **blocks checkout** in the UI. **Fix:** implement or hide; never let configuring a provider disable a shop silently. **Effort:** 3–5d each, or 0.5d to hide.

---

## 🟡 Medium

### TD-12 — Money stored as floating-point
`price`/`total` are JS `Number`. Rounding drift over time. **Fix:** integer paise end-to-end. **Effort:** 2d (migration + code).

### TD-13 — Duplicated order-building and cart logic
`buildOrderItems` (orders.js) duplicated inline in `/orders/checkout`; `getCart` duplicated in cart.js and orders.js. **Fix:** extract a shared cart/order service. **Effort:** 1d.

### TD-14 — No OTP expiry or verify throttle; no order pickup timeout
OTPs never expire; `/vendor/verify` has no attempt limit; `ready_for_pickup` orders never auto-expire. **Fix:** OTP TTL, attempt counter, stale-order sweep. **Effort:** 1.5d.

### TD-15 — Refund logic is Razorpay-only by construction
`isRefundableOrder` hard-codes the `pay_` prefix, returns false for other providers. **Fix:** push refundability into each adapter. **Effort:** 1d.

### TD-16 — No notifications
Student relies on a 5-second polling loop with the tab open; no email/SMS/push for "order ready." Polling also won't scale (every open order page hits the server every 5s). **Fix:** SSE/WebSocket or push + transactional notifications. **Effort:** 3–4d.

### TD-17 — Config singletons built at import with possibly-undefined secrets
`config/razorpay.js` / `config/cloudinary.js` instantiate SDK clients from env that may be empty; no boot-time validation. **Fix:** validate env at startup (zod/envalid); lazy/guarded client init. **Effort:** 0.5d.

### TD-18 — `pending_payment` is a dead status
Defined in the schema, never used in the happy path (orders are born `paid`). Indicates the order state machine wasn't finished. **Fix:** either use it (create order pre-payment, confirm via webhook) or remove it. Ties into TD-2.

---

## 🟢 Low (hygiene)

- **TD-19** — Repo cruft committed: `package.json.bak`, `package-lock.json.bak`, `test.txt`, `Readme (DEMO).txt`, demo font + EULA, `background-image copy.png`. Remove. **5 min.**
- **TD-20** — `package.json` `name` is still `"smart-college-canteen"`; README is two lines. Rebrand + write a real README. **0.5d.**
- **TD-21** — `.env.example` has malformed placeholder values (`CLOUDINARY_CLOUD_NAME= dashboard`, `RAZORPAY_KEY_ID= hidden`) — leading spaces and non-empty junk. Clean it up. **5 min.**
- **TD-22** — `SESSION_SECRET` falls back to `"dev-secret"` in code. Fail loudly if unset in production instead. **15 min.**
- **TD-23** — Only one test (`login.spec.js`); no unit tests on payments/orders/auth; CI runs Playwright only (no lint/typecheck). Build a test floor around money paths first. **Ongoing.**
- **TD-24** — `console.log` is the only logging; some logs include order/refund details. Adopt structured logging with levels and redaction. **1d.**
- **TD-25** — No `/healthz` / readiness endpoint; no graceful shutdown; `process.exit(1)` on DB failure with no retry/backoff. **0.5d.**

---

## Debt by Theme

| Theme | Items | Verdict |
|---|---|---|
| **Money integrity** | TD-1,2,3,4,12,15 | Largest cluster; gates launch |
| **Scale / multi-instance** | TD-6,7,8,10,16 | Caps platform at one college / one box |
| **Security baseline** | TD-4,9,14,22 | Standard, missing wholesale |
| **Correctness bugs** | TD-5,3 | Cheap, do immediately |
| **Hygiene** | TD-19–25 | Cheap credibility wins |

**Bottom line:** the debt is *concentrated and conventional*, not sprawling. ~15 focused engineering days clears the launch-blocking tier (Critical + the top of High).
