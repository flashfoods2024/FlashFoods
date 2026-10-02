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