# FlashFoods History — Consolidated Record

> HISTORICAL RECORD ONLY. Nothing in this file is an active instruction.
> If this file conflicts with `ORCHESTRATOR.md`, `rules.md`, or
> `BUSINESS_RULES.md`, the active documents govern. Do not execute phases,
> plans, or checklists quoted here — they already ran.

---

# Stage 0 — Security Hardening (COMPLETE 2026-09-19, verdict PASS)

Status: COMPLETE. Scope: Razorpay-only gateway; auth, refunds, OTP, sessions, order transitions.

Major work:
- Open redirect on `/cart/add` fixed via `safeRedirect()` (commit `fbbcb0c`).
- Razorpay webhook dedup race fixed by moving `webhookEventId: { $ne: eventId }` into the atomic precondition (commit `7dd8c4f`).
- Verified sound without changes: raw-body constant-time webhook signature (fail-closed secret), gateway re-fetch + exact-paise capture check before `paid`, atomic refund single-flight claims on `amountChargedPaise`, OTP expiry-before-completion + atomic `ready_for_pickup` precondition, all vendor transitions atomic, session anti-fixation.

Important decisions:
- Carried out of scope (not blockers for Razorpay-only): login rate limiting, Socket.IO auth, MemoryStore sessions, Easebuzz path, analytics-cache dead code.

Validation: 9/9 objectives green on the committed tree; `npm test` 61 pass.

---

# Stage 1 — Feature Build F01–F07 (COMPLETE 2026-09-20)

Status: COMPLETE. Scope: build + verify F01–F07, then comprehensive / risk-based / regression / global gates (isolated in-memory DB).

Major work:
- **F01 Student Profile** (PASS): authenticated profile display, approved-fields-only editing, empty/error states.
- **F02 Vendor Profile + Analytics** (PASS, commit `4652b44`): self-profile, name/phone editing, read-only email, Today/Week/Month/Custom analytics, top-5 items, strict vendor/shop isolation.
- **F03 Shop Open/Close Timing** (PASS, commit `1c8caef`): operating hours, hours-aware availability, boundary/invalid-config handling (30 tests).
- **F04 Pickup Slots** (PASS, commit `8337a1d`): slot config, server-side atomic capacity (10 concurrent vs capacity 3 → exactly 3 succeed), preparation-time lead enforcement, Days-Ahead removed, today-only IST (39 tests).
- **F05 Vendor Discounts** (PASS, commit `4c6fbac`): server-authoritative food-only percentage discounts, single-round paise math, preserved through adjust/parcel-toggle (17 tests).
- **F06 FCM Migration** (PASS, commit `5bfe509`): per-vendor tokens, refresh, hijack rejection (409), invalid-token pruning (11 tests). Later extended by **F06.5 Student Order Ready Notification** (commit `01a06c1`): `accepted → ready_for_pickup` triggers one student-targeted notification, background-capable, tap-to-open-order, vendor paths untouched.
- **F07 QR Pickup** (PASS, commit `87baaec` + follow-ups): vendor-scans-student-QR as primary, OTP backup-only, `completed` terminal state, handover display, QR-vs-OTP audit.

Important decisions:
- `completed` is the EXISTING terminal pickup state — no `picked_up` or intermediate states were ever introduced.
- Vendor flow is Accept/Adjust/Cancel → Mark Ready; no vendor pickup-confirm button exists anywhere.
- Scan direction is fixed vendor-scans-student; student-scans-vendor is obsolete.
- F07 reused existing infrastructure (`utils/qr-pickup.js`, student display, vendor scanner, `POST /vendor/verify-qr`, OTP path) under REUSE → MODIFY → CREATE ONLY IF NECESSARY; greenfield rebuild was forbidden.
- `ready_for_pickup` implies paid eligibility transitively via `paid → accepted → ready_for_pickup`; no separate payment check was added to pickup.
- Handover data (order no, name, phone, items, qty, amount = `Order.total`, pickup time) is server-rendered visual confirmation only.
- Pickup method persisted minimally as `Order.pickupMethod: qr | otp | null` alongside existing `collectedAt` — no new audit subsystem.

Major fixes (post-complete, root causes preserved):
- **Populated-shop QR corruption:** `routes/orders.js` populated `shop` before `createPickupQr`, embedding `[object Object]` in every token (all QRs unscannable, `wrong_shop`). Fixed in the shared builder (`order.shop._id ?? order.shop`) with regression test.
- **Accept-header negotiation:** truthy `req.accepts("json")` is true for all browser form POSTs (`*/*`), stranding vendors on raw JSON. Fixed with best-match `req.accepts(["json","html"]) === "json"` (pre-existing `vendor-profile.js` pattern) with regression tests.
- **Pending Orders as primary pickup surface:** QR paste + `BarcodeDetector` camera UI and handover rendering added to the existing global verify bar; OTP JSON now carries handover; `/vendor/verify` retained as legacy fallback. No new routes, no duplicated verification logic.

Validation: `npm test` 238/238 isolated; comprehensive suite (10 tests) covers cross-feature interactions; isolated Playwright vendor-profile flow 15/15. Shared Playwright suite and stress/load gates recorded NOT RUN (single `.env` points at production; harness mutates live DB — environment blocker, not code).

Lessons / architectural consequences:
- Atomic `findOneAndUpdate` status preconditions are the standard single-flight mechanism (payments, refunds, slots, pickup).
- Test-harness concurrency can flake (observed transient pass-on-retry); recorded as infra, not product.
- Abandoned `pending_payment` orders hold slot reservations (no expiry sweep) — accepted follow-up.
- `.env` holds production credentials with `DISABLE_RATE_LIMIT=true` — latent operational risk.

---

# Incident — Unpaid Mock Orders in Production (2026-08-19, CRITICAL)

What: 19 orders with `paymentNote/transactionId: "mock"` reached the production DB (15 Hummusery, 4 Juice Corner) via the live mock route `POST /orders/checkout`, which minted `status: "paid"` with zero payment verification; Playwright QA ran against the production Atlas DB.

Consequence: mock checkout is now hard-blocked to the `testing` shop only (403 elsewhere) — a misconfigured test can never mint fake paid orders. Remaining recommendations at the time: remove the route from prod builds, rotate exposed secrets, isolate e2e environments (guard harness against prod cluster), clean prod data, configure webhook secrets, session/CSRF hardening.

Lesson: no test harness may write to a non-isolated database; environment split is a prerequisite for shared e2e/load gates.

---

# Migrations (completed, narrative only)

- **Route inventory / migration reports** (historical): full route + API inventories were produced to plan a React/Vite migration. No migration was executed; the app remains EJS server-rendered (see `ARCHITECTURE.md` for current state).
- **Codebase review** (historical point-in-time audit): drove Stage 0 scope; its live findings were fixed there. Residual backlog items (Easebuzz path, MemoryStore, Socket auth, analytics-cache perf, CSRF, rate limiting) are tracked as future work, not current defects of completed stages.

---

# Carried-forward backlog (not blockers for completed stages)

1. E2E/load environment isolation (staged DB, harness prod-guard).
2. Slot-reservation expiry sweep for abandoned `pending_payment` orders.
3. Login rate limiting; Socket.IO auth; MemoryStore replacement; CSRF; Easebuzz completion-or-disable; analytics-cache perf.
4. Playwright fixture seeding (missing `test.vendor@flashfoods.test` blocks the shared suite).
