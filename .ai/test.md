# FlashFoods — Test Protocol (.ai/test.md)

## Purpose

Testing is a sequence of quality gates. This file is the source of truth for what may
be tested, what must never be run against production, and the order gates must be
executed in.

Autonomous agents MUST read this file before running ANY test.

## Core Safety Rules (Non-Negotiable)

The following are NEVER allowed during any test run:

1. Connect to the production MongoDB (Atlas). Any script or config that resolves
   MONGO_URI from .env must be considered production-connected unless proven otherwise.
2. Call a live payment API (Razorpay, Easebuzz, PhonePe). Sandbox/test-mode keys only,
   and only in a dedicated sandbox environment.
3. Send a real FCM push notification.
4. Upload to real Cloudinary.
5. Call real Gemini Vision.
6. Run `npm run seed` (deliberate deleteMany against the configured DB).
7. Run `npm run test:e2e` with the default Playwright config (real-DB global hooks).
8. Print, log, or commit any value from .env.

When uncertain whether a test is safe: STOP, mark UNCERTAIN, and report.

## Safe Test Surfaces (Run These)

- `npm test` / `npm run test:unit`
  Node test runner. All files under tests/unit/**.
  Verified: no MONGO_URI usage; uses mongodb-memory-server-core; localhost-only HTTP.

- `npm run test:e2e:vendor-profile`
  Isolated Playwright harness (playwright.vendor-profile.config.js).
  Boots an in-memory Mongo via scripts/qa-vendor-profile-server.mjs on port 3123.
  No external DB, no external network.

- Any new test written following the isolated-harness pattern (in-memory Mongo +
  ephemeral port + stubbed external services).

## Blocked Test Surfaces (Do NOT Run Today)

- `npm run test:e2e` (default playwright.config.js)
  tests/global-setup.mjs and tests/global-teardown.mjs connect to MONGO_URI and
  mutate shops/users. Unblocking requires rewriting those hooks to use the
  isolated-harness pattern.

- `npm run seed`
  Destructive by design.

- Any spec under tests/ that boots a real server pointed at .env.

## Test Taxonomy

1. Unit — pure logic, no I/O. Always safe.
2. Integration — route + middleware + in-memory DB. Safe with harness pattern.
3. Contract/API — request/response shape, status codes, auth boundaries. Safe.
4. End-to-end — full user flows. Safe ONLY via isolated harness.
5. Payment sandbox — gateway test mode. RISKY; separate environment only.
6. Webhook signature + replay — HMAC, raw body, idempotency. Safe on in-memory DB.
7. Notification dispatch — mocked FCM. Safe.
8. PWA/service-worker — headless browser + local server. Safe.
9. Security — CSRF allowlist, IDOR, injection, secret redaction. Safe on in-memory DB.
10. Concurrency/races — double-accept, double-pay, double-QR. Safe on in-memory DB.
11. Data integrity — illegal-transition matrix, atomic checks. Safe.
12. Migration/backfill — idempotency on fixtures. Safe on in-memory DB.
13. Load/stress — disposable local env only. RISKY.
14. Accessibility — axe-core on isolated harness. Safe.
15. Visual regression — Playwright snapshots on isolated harness. Safe.
16. Failure/recovery — DB down, gateway down, FCM down. RISKY.
17. Cold-start/smoke — boots cleanly, env validation. Safe.

## Feature Test Requirements

## F09 Native-Feel Student Navigation (planned)

F09 is not implemented or verified by this documentation update. When a future
session executes it, use the existing safe-test rules above and the phase gates
in `.ai/roadmap.md`.

### Phase test contract

**Phase 1 — Baseline and focused proof**

- Use an isolated/local browser harness; do not use the default Playwright
  global setup while it points at `MONGO_URI` from `.env`.
- Capture Home → Browse, Browse → Home, Home → Orders, Orders → Cart,
  Cart → Orders, and Browse → Orders.
- Record request/response, server/render, DOM/script initialization, Liquid
  Glass, paint, and animation timing separately where the browser exposes them.
- Assert current behavior honestly: ordinary navigation is still the baseline;
  the footer skeleton is feedback, not a router.

**Phase 2 — Persistent shell proof**

- Use a minimal isolated browser prototype, not a broad page migration.
- Assert one navbar and one Liquid Glass renderer/canvas across a supported
  content swap, stable navbar geometry, direct full-page rendering, and no
  console errors.
- Verify the existing pending-state blinking fix, orange active indicator,
  entrance animation, card staggering, and desktop-frozen rules are preserved.

**Phase 3 — Controlled navigation**

- Cover each required route sequence plus Back/Forward, rapid clicks, aborted
  requests, stale responses, a failed/500/offline response, and an expired
  session redirect.
- Assert URL, title, active tab, `aria-current`, content, scroll behavior,
  navbar DOM identity, one renderer, no blank state, and normal fallback.
- Assert that POST/PUT/PATCH/DELETE forms, payment flows, cart mutations,
  logout, external links, downloads, and unsupported routes are not intercepted.

**Phase 4 — Page initialization and cleanup**

- Swap supported content repeatedly and verify Browse search/favourites, Cart
  variant/quantity/order-type/payment launch, Home notification interaction,
  and any included order polling.
- Assert no duplicate event handlers, intervals, observers, SDK setup, or stale
  requests after repeated swaps. Polling must stop on content replacement;
  `beforeunload` alone is not sufficient.

**Phase 5 — Response optimization**

- Only test fragment negotiation if Phase 1 measurements justify it.
- Compare full and fragment responses for authorization, redirects, session
  cart, flash/error state, title, active tab, cart badge, totals, empty states,
  and visible data.
- Verify personalized fragments have safe cache behavior and reuse the same
  server-side business logic.

**Phase 6 — Transition polish**

- Measure before/after behavior at the mobile reference viewport and the
  desktop boundary.
- Verify subtle content-only motion, immediate active feedback, no navbar
  opacity/position animation, no blank frames, and reduced-motion behavior.
- Do not use arbitrary timeouts or animation durations to hide request,
  rendering, or initialization latency.

### F09 browser matrix

Required sequences:

1. Home → Browse
2. Browse → Home
3. Home → Orders
4. Orders → Cart
5. Cart → Orders
6. Browse → Orders
7. Back and Forward across supported destinations

Required browser conditions: 393×852, the existing Pixel 5 profile where safe,
390×844 or equivalent mobile viewport, 767/768 px boundary, desktop ≥768 px,
reduced motion, slow response, rapid clicks, cancellation, offline/error, and
session expiry. Browser checks are required for DOM identity, renderer count,
visual continuity, history/scroll, and post-swap behavior; unit/integration
checks cannot substitute for them.

### F09 safety gate

No F09 browser run may connect to production MongoDB, mutate production data,
call live payment gateways, send real FCM notifications, upload to Cloudinary,
or use destructive seed hooks. If isolation cannot be demonstrated, stop and
report the environment blocker rather than running the test.

### F09 evidence rule

For every phase, record the exact command, isolated environment, route/viewport
scope, passed/failed/skipped checks, timing observations, console errors,
regressions, fixes, and rerun result in `.ai/STATUS.md`. Documentation or source
inspection alone cannot mark a browser or performance check PASS.

F01 Student Profile
- authenticated access, correct data, approved-only edits, unauthorized blocked,
  prior profile behaviour preserved.

F02 Vendor Profile
- authenticated access, account data, name/phone editable, email read-only,
  Today/Week/Month/Custom analytics, correct orders/revenue/items/AOV,
  best sellers, empty states, IST boundaries, shop isolation, vendor IDOR,
  shop IDOR, restricted-field protection, student profile regression.

F03 Shop Open / Close
- configuration, valid/invalid values, availability, boundary times, missing config,
  student/vendor behaviour.

F04 Pickup Slots
- creation, visibility, capacity, full slots, invalid slots, outside-hours slots,
  overbooking attempts, concurrent booking, authorization.

F05 Discounts
- enable/disable, valid/invalid percentage, boundary values, server-side total,
  payment amount, rounding, cancellation/refund interactions, vendor isolation.

F06.5 Student Order-Ready Notification
- vendor ready → exactly one student notification, correct targeting,
  single sound, background/closed-PWA delivery, tap opens correct order page,
  existing vendor notifications unchanged.

F07 QR Pickup
- QR generated per order, scanner shows name/phone/order/items/qty/amount,
  valid QR closes immediately (completed), invalid does NOT close
  (stays ready_for_pickup), malformed, wrong vendor, wrong shop, wrong order,
  reused QR, replay, concurrent verification (single close),
  server-authoritative completion, OTP fallback works, existing OTP intact,
  no vendor confirm button, no partial-close, no reopening.

## F08 Student Portal UI Standardization
For each in-scope student screen (shops, menu, cart, orders, order detail,
profile, login, signup):
- Mobile 393x852: renders with the F08 card, button, pill, top bar, bottom
  nav, and typography recipes from `.ai/UI_STANDARD.md`.
- Desktop 1440x900: renders identical to the F08 baseline commit
  (pixel-diff under a 0.5% threshold; Student Home desktop exempt per F08-D3).
- No business logic touched (routes, forms, submits still work).
- No console errors.
- Unit suite green (`npm test`); new classes reused, never redefined globally.

## Order Lifecycle Pipeline Test — Testing Shop

Purpose: prove the end-to-end pipeline works, using a dedicated shop rather than
production vendor data.

Test shop slug: `testing-shop`

Full path to verify:

1. Student browses `testing-shop` menu (at least one item available).
2. Student adds an item to cart.
3. Student proceeds to checkout.
4. Order is created in state `pending_payment`.
5. Payment is stubbed (no live gateway).
6. Order transitions to `paid`.
7. Vendor (owner of `testing-shop`) sees the order in pending list.
8. Vendor accepts → state `accepted`.
9. Vendor marks ready → state `ready_for_pickup`.
10. Order-ready FCM notification is dispatched (mocked) exactly once
    to the correct student.
11. Student displays QR for the order.
12. Vendor scans QR → order transitions to `completed`.
13. OTP fallback path verified separately for a second order.

At each step, verify:
- The transition is atomic.
- Illegal transitions are rejected (e.g., `pending_payment` → `completed`).
- Only the correct role can perform the transition.
- Concurrent requests do not create duplicate side effects.

Never use production data for this test. Use in-memory Mongo and seed
`testing-shop` as a fixture.

## Regression Suite

Verify existing behaviour for:
- authentication, student profile, student ordering
- vendor dashboard, pending orders, pickup verification, menu, payment settings
- completed orders, admin panel, admin analytics
- payment flows, webhooks, existing notifications

## Smoke Test

Verify the app can:
- start successfully
- connect to configured DB (isolated)
- authenticate users
- load student, vendor, admin panels
- create and view an order
- transition through the expected flow
- verify pickup through supported mechanisms

## Risk-Ordered Testing

After feature tests pass, test affected modules from highest to lowest risk:

1. payment/order total logic
2. pickup verification and order state transitions
3. authorization / ownership boundaries
4. notification delivery
5. slot capacity / concurrency
6. shop timing logic
7. analytics queries
8. profile/UI-only changes

## Evidence Rule

Never mark a test PASS unless it was actually executed and observed.

Record for every run:
- command
- scope
- result
- failures
- fixes
- rerun result

## Reporting Format

Every test session must produce:

1. Commands actually run.
2. Tests passed / failed / skipped, with names.
3. Blocked tests and why.
4. Any regression discovered.
5. Any test that could not be safely run, with the exact reason.
6. Explicit statement: no production database was modified.
7. Explicit statement: no .env value was read, printed, or modified.
