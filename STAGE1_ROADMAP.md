# Stage 1 — Reliability, Scale & Operational Readiness

**Status: PLANNED** (promoted from Stage 0 — PASS)
**Gateway scope:** Razorpay (primary). PhonePe/Easebuzz remain secondary/unfunded.

---

## 1. Stage 1 Goals

Stage 0 made the money paths **correct**. Stage 1 makes them **reliable under load, observable in production, and safe across restarts** — plus closing the security debt that was correctly deferred as out-of-scope.

1. **Close the deferred security debt** — login brute-force defense, socket authorization, session persistence.
2. **Eliminate the load cliff** — the admin analytics path that runs 7–11 full-collection aggregations per request.
3. **Make failures visible** — replace debug `console.log` noise with leveled logging and an error monitor, so a failed refund is found by alerting rather than by a support ticket.
4. **Cover the financial math with tests** — the pure functions where a one-line regression silently misprices money.
5. **Prove it under load** — real k6 baselines against real routes instead of a script that targets a missing directory.

**Non-goals:** React migration, new gateways, feature work.

---

## 2. Stage 1 Acceptance Criteria

Stage 1 is complete when **all** of the following hold:

1. `/login` and `/signup` are protected by a dedicated rate limiter (≤10 attempts / 15 min / identity), and a distributed sweep against a single account is also throttled.
2. Socket.IO rejects unauthenticated handshakes; vendor rooms are derived server-side from the session, never from a client-supplied `shopId`.
3. Sessions survive a process restart (Mongo-backed store), and a password reset can invalidate a user's other sessions.
4. `/admin/analytics/data` is cache-backed — a second request within the TTL returns from cache and issues **zero** aggregation pipelines.
5. `Order.createdAt` has a standalone index; analytics time windows are bounded (no unbounded history scans).
6. A k6 suite runs against ≥4 real routes (login, shop browse, cart add, order create) with recorded baselines, checked into the repo and runnable via `npm run`.
7. Unit coverage exists for `money.js`, `payment-verification.js`, `webhook-signature.js`, `order-math.js`, plus a regression test asserting a duplicate webhook delivery fires notifications exactly once.
8. No `[MARK]` debug traces or raw provider bodies in production logs; a leveled logger gates them behind `NODE_ENV=development`.
9. `temp/debug/` has a retention bound (automated cleanup, no unbounded growth).
10. Zero security findings of High or Critical severity on a re-audit.

---

## 3. Stage 1 Tasks in Execution Order

Ordered by (risk to the business ÷ effort). Each entry: **Risk** = consequence of *not* doing it; **Effort**.

### Phase 1.1 — Security debt (highest risk first)

| # | Task | Risk | Effort |
|---|------|------|--------|
| **1** | **Login + signup rate limiter.** Dedicated limiter on both auth endpoints; key on `email + IP` (`keyGenerator`) so a distributed sweep against one account is throttled too. | **High** — the only current brute-force defense is the global 300/15min limiter (≈20 guesses/min/IP). Direct account takeover, and for a vendor account that means order + payment-credential access. | **S** (~30 min) |
| **2** | **Fix analytics cache (dead code).** `routes/admin.js` `analyticsCacheSet()` is unreachable — `payload` is referenced but never assigned, after an early `return res.json(...)`. Build the object into a variable, cache it, then respond. | **High** — 7–11 full-collection aggregations per request, no caching, unbounded custom ranges. Will be the first failure under k6 and the cheapest fix in the roadmap. | **S** (~20 min) |
| **3** | **Socket.IO handshake auth.** `io.use()` validates the session; join the vendor's own shop room server-side from `req.user.shop`. | **Medium** — anyone can subscribe to any shop's pending counts today. No PII, but it's an authorization gap in a vendor channel and it invalidates the socket as a trusted notifier. | **M** (~2 h) |
| **4** | **`connect-mongo` session store.** Replace MemoryStore; then implement the post-password-reset session invalidation that `auth.js:188` documents as impossible today. | **Medium** — sessions lost on every restart (deploy = every vendor's pending page goes deaf), memory grows under load, and reset-then-logout can't be enforced. | **M** (~3 h) |
| **5** | **Gate Easebuzz gateway selection.** Disable the option in `views/vendor/payment-settings.ejs` until it has amount verification and refund support. | **Medium** — the path is live and can collect money that the app can never refund. Not a Razorpay blocker, but it is a money path with a known gap. | **S** (~15 min) |

### Phase 1.2 — Performance (the load cliff)

| # | Task | Risk | Effort |
|---|------|------|--------|
| **6** | **Add `createdAt` index on `Order`.** No standalone index today; date-range queries and trend aggregations scan cold. | **Medium** — silent degradation as orders accumulate; analytics times out before anyone notices a query is missing an index. | **S** (~15 min) |
| **7** | **Bound analytics time windows.** Cap trend buckets (last ~90 points) and reject absurd custom ranges. | **Medium** — a wide custom range is a full-history scan. DoS-adjacent on an admin endpoint. | **S** (~30 min) |
| **8** | **Real k6 suite.** `security-hardening/k6.js` references the missing `RingWatch/` directory. Replace with scenarios for login, `/shops`, cart add, order create; record baselines; wire to `npm run load`. | **Medium** — without baselines, "it feels slow" is the only capacity signal, and regressions land undetected. | **M** (~4 h) |

### Phase 1.3 — Observability & reliability

| # | Task | Risk | Effort |
|---|------|------|--------|
| **9** | **Leveled logger; strip debug noise.** Replace the `[MARK]` traces in `routes/admin.js` and the raw-provider-body logging in `menu-import/vision.js`; gate debug output behind `NODE_ENV`. | **Medium** — current volume makes real errors hard to find in logs; a failed refund looks identical to a routine import trace. | **M** (~2 h) |
| **10** | **Error monitoring.** Wire a Sentry-class reporter into the global handlers in `server.js` so a `refund_failed` raises an alert instead of waiting for a vendor complaint. | **Medium** — money-adjacent failures currently surface only through support. | **M** (~2 h) |
| **11** | **`/health` endpoint + `temp/debug` cleanup job.** Cheap availability signal for the deploy platform; bound the debug directory before it fills the disk. | **Low** — undetected disk growth and no way to distinguish "slow" from "dead". | **S** (~1 h) |

### Phase 1.4 — Test coverage on financial math

`npm test` currently exercises `signature.test.js` only. These are pure functions with no DB dependency — the cheapest meaningful coverage in the codebase.

| # | Task | Risk | Effort |
|---|------|------|--------|
| **12** | `utils/money.js` — `toPaise`/`fromPaise` boundary cases (`null`, `""`, non-finite, rounding). | **High** — a regression here silently misprices or zero-amounts an order. | **S** (~30 min) |
| **13** | `utils/payment-verification.js` — every fail-closed `reason` (not captured, amount mismatch, currency, order mismatch). | **High** — guards the paid/not-paid decision. | **M** (~1 h) |
| **14** | `utils/webhook-signature.js` — empty-secret rejection and missing-body paths. | **High** — the empty-key case is exactly what lets a forged webhook through. | **S** (~20 min) |
| **15** | `utils/order-math.js` — `normalizeKeepIndices` out-of-range / non-numeric / duplicate handling. | **Medium** — drives partial refund amounts. | **M** (~1 h) |
| **16** | **Regression test:** two concurrent deliveries of the same Razorpay event fire notifications exactly once. | **High** — this was a real Stage 0 bug; it should have a test so it cannot return. | **M** (~1.5 h) |

### Phase 1.5 — Hygiene (do alongside the above, not after)

| # | Task | Risk | Effort |
|---|------|------|--------|
| **17** | Remove the 7 dead `ringwatch` npm scripts and the `security-hardening/k6.js` reference. | Low — misleading entry points. | **S** |
| **18** | Delete dead `buildOrderItemFromLine` (`routes/orders.js:38`). Never called, but sits in a money path looking authoritative. | Low — misleading but harmless. | **S** |
| **19** | Dedupe `getCart()` (identical in `cart.js` and `orders.js`). | Low — divergence risk only. | **S** |
| **20** | `git rm -r --cached temp/chunks/` — 20 committed binaries despite `temp/` being ignored. | Low — repo bloat. | **S** |
| **21** | Move `mongodb-memory-server-core` to devDependencies (it's a test helper listed as a runtime dep). | Low — dependency hygiene. | **S** |

---

## 4. Sequencing Notes

- **Tasks 1 and 2 first** — small, independent, and together they retire the two largest open risks (account takeover, analytics collapse). No prerequisites.
- **Task 16 depends on nothing**, but should be written *before* task 3 touches the socket layer, so the notification contract is pinned.
- **Task 4 (session store) before task 3** is optional, but doing them in that order lets socket auth benefit from a persistent session collection.
- **Phase 1.4 can run in parallel with everything** — pure functions, no shared state.
- **Task 8 (k6) belongs near the end of Phase 1.2**, after the analytics fix and the index land, so the baseline reflects the improved code rather than measuring the cliff.

## 5. Risk Summary

The highest-risk items in Stage 1 are not the largest tasks — they are **#1 (login brute-force)** and **#12–14 (untested money math)**. Both are small. The largest single risk to the business remains #5/#2-class issues: money paths that *appear* to work while quietly misbehaving. That is why Phase 1.4 is scheduled early rather than last, despite being unglamorous.
