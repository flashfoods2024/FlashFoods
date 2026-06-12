# FlashFoods — Architecture Review

> Reviewer perspective: incoming CTO. Date: 2026-06-12. Status of codebase: pre-production, ~84 tracked files, single-instance monolith.

## 1. What FlashFoods Is Today

FlashFoods is a **server-rendered monolith** that lets students pre-order food from campus canteens and pick it up with an OTP. Despite the "operating system for campus food ordering" ambition, the current artifact is a **single-college, single-process web app** with a multi-vendor data model bolted on.

| Layer | Technology | Notes |
|---|---|---|
| Runtime | Node.js (ESM, `"type": "module"`) | Top-level `await` used in `server.js` |
| Web framework | Express **5.2** | Auto-forwards async errors, but no error handler is registered |
| Views | EJS server-side templates | No SPA, no API-first design |
| Data | MongoDB via Mongoose 8 | 4 models: User, Shop, MenuItem, Order |
| Auth | `express-session` + `connect-flash` | **Default MemoryStore** (in-process) |
| Payments | Adapter pattern in `services/payments/` | Razorpay real; 3 providers are mocks |
| Media | Cloudinary + Multer | Server-side image transforms |
| Tests | Playwright | One spec (`login.spec.js`) |
| CI | GitHub Actions | Playwright only; no build/deploy/lint |

### Request lifecycle
1. `express.static` → `urlencoded`/`json` body parsing
2. `session` (MemoryStore) → `flash`
3. `attachUser` — **DB lookup on every request** to hydrate `req.user`
4. A global middleware that sets `res.locals` (current user, vendor shop via **another DB query**, cart count, flash, env, view helpers)
5. Routers mounted flat: `authRouter`, `shopsRouter`, `cartRouter`, `ordersRouter`, `menuRouter`, `vendorRouter`, and `/admin`

### Module map
```
server.js                 app wiring, top-level await connectDb()
config/        db, cloudinary, razorpay (singletons built at import time)
middleware/    auth (role guards), requireDb, upload (multer/cloudinary)
models/        User, Shop, MenuItem, Order
routes/        auth, shops, cart, orders, vendor, menu, admin
services/payments/  index (registry) + razorpay/ccavenue/paytm/phonepe
utils/         otp (CSPRNG), time (IST), admin (IST date math, formatters)
views/         EJS for student, vendor, admin, partials
```

## 2. Architecture Assessment

### What is genuinely well-designed
- **Payment adapter pattern** (`services/payments/index.js`): a clean registry with `createOrder`/`verifyPayment`/`refundPayment`/`getPublicKey`. This is the single best architectural decision in the repo — it makes the multi-provider roadmap tractable.
- **Role-based middleware** is small and composable (`requireAuth`, `requireVendor`, `requireStudent`, `requireAdmin`, `requireVendorShop`).
- **Server-side price authority**: order totals are recomputed from the DB (`buildOrderItems`), not trusted from the client.
- **Soft-disable** semantics (`isActive`/`disabledAt`) on users and shops instead of hard deletes (mostly).

### What is structurally wrong or risky

**A. State lives in process memory.** Sessions use the default `MemoryStore`. This means:
- You cannot run more than one instance (no horizontal scale, no zero-downtime deploy).
- Every deploy/restart logs out every user and **drops every in-flight cart**.
- It leaks memory and is explicitly "not designed for a production environment" (per express-session docs).
This single fact caps the whole platform at one box. It contradicts the "multiple colleges / scale" goal.

**B. There is no tenancy model.** The business goal is "multiple colleges," but there is **no `College`/`Campus` entity**. Shops are global; every student sees every shop (`shopsRouter` lists all active shops with no scoping). Onboarding a second college today means data bleed between institutions. This is a foundational gap, not a feature gap.

**C. Read-everything admin queries.** `/admin/orders` calls `loadAdminOrderList()` = `Order.find()` with **no limit, no pagination** — it loads the entire orders collection into Node and filters/searches in JavaScript. At a few thousand orders this becomes the slowest and most memory-hungry path in the app. Vendor/student lists are similarly unbounded.

**D. Per-request DB amplification.** `attachUser` runs on **every** request (including static-adjacent routes), and `requireAuth` may run a second `findById`. The `res.locals` middleware runs a third query for vendors. Three round-trips before a handler executes, uncached.

**E. No payment webhooks / reconciliation.** Order creation depends entirely on the **client-side Razorpay success callback** firing `/verify-payment`. If the browser closes after payment but before the callback, the **money is captured but no order exists**, with no server-side reconciliation. The team's own `payment-architecture-V1.md` notes "let's try webhooks this time" — it was never built. This is the highest-impact architectural omission for a real-money system.

**F. The mock checkout is a live, reachable, free-order endpoint.** `POST /orders/checkout` creates a fully `paid` order with `paymentProvider: "mock"` and **no payment at all**. It is guarded only by `requireStudent`. Any logged-in student can place unlimited free "paid" orders. This must be deleted before any real launch (see security-review).

**G. Config singletons instantiate with possibly-undefined secrets.** `config/razorpay.js` and `config/cloudinary.js` build SDK clients at import time from env that may be empty. There is no boot-time env validation; failures surface as confusing runtime errors deep in a request.

**H. No cross-cutting concerns.** No security headers (helmet), no CSRF, no rate limiting, no structured logging, no request IDs, no global error handler, no health/readiness endpoint, no graceful shutdown.

## 3. Coupling & Cohesion

- **Cohesion** within modules is decent; routes are mostly self-contained.
- **Coupling** to Razorpay leaks past the adapter boundary: `isRefundableOrder` in `services/payments/index.js` hard-codes Razorpay's `pay_` prefix and returns `false` for every other provider; `vendor.js` cancel flow assumes Razorpay-style refunds. The abstraction is real but incomplete.
- **Duplication**: order-building logic exists twice (`buildOrderItems` in `orders.js` and an inline copy in `/orders/checkout`). Cart helpers (`getCart`) are duplicated across `cart.js` and `orders.js`.

## 4. Bugs Found During Review (architecture-relevant)

1. **`routes/menu.js` references `Shop` without importing it** — the `/menu/:id/toggle` route throws `ReferenceError` the moment it executes. It is dead/broken in production.
2. **Price/amount decoupling** between `/create-payment-order` (amount A) and `/verify-payment` (recomputes total B from current cart). The Razorpay-charged amount and the stored `order.total` are not bound to each other, enabling pay-less manipulation if the cart changes mid-flow.
3. **Money stored as floating-point** (`total: Number`, `price: Number`). Rupee math should be integer paise to avoid rounding drift.

## 5. Target Architecture (direction, not a rewrite)

1. **Externalize session state** → `connect-mongo` or Redis. Unblocks multi-instance.
2. **Introduce a `College`/tenant entity**; scope shops, vendors, students, and orders to a college. This is the load-bearing change for the actual business vision.
3. **Add a payments webhook ingress** + an `Order`/`Payment` reconciliation job. Treat the client callback as a hint, the webhook as truth.
4. **Split `Order` and `Payment`** into separate concerns; store amounts in paise; add idempotency keys.
5. **Paginate and index every list endpoint**; kill load-all-then-filter-in-JS.
6. **Add the cross-cutting baseline**: helmet, CSRF, rate limiting, structured logging, a global error handler, `/healthz`, env validation at boot.
7. Keep the monolith — it is the right shape for this stage. The problem is not "not microservices"; it is "not multi-instance-safe and not multi-tenant."

## 6. Verdict

The codebase is a **competent MVP with a thoughtful payment abstraction and a dangerous gap between its ambition and its foundations.** It is structurally a single-college, single-process app wearing multi-vendor clothing. None of the blockers are exotic — they are the standard list (session store, tenancy, webhooks, pagination, the security baseline) — but several are **launch-blocking for a real-money product**, and one (the mock checkout) is an open door. See `production-readiness.md` for the gate and `90-day-roadmap.md` for sequencing.
