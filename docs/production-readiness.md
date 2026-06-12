# FlashFoods — Production Readiness Review

> Question answered: *Can we put real students, real vendors, and real money on this today?* **No.** Below is the gate, by category, with a clear go/no-go.

## Overall: 🔴 NOT READY

The app runs and demos well. It is **not** safe for real money or multiple tenants. Three blockers (mock checkout, no webhooks, plaintext+leaked secrets) are disqualifying on their own.

| Category | Status | Blocking? |
|---|---|---|
| Payments integrity | 🔴 | Yes |
| Secrets management | 🔴 | Yes |
| Security baseline (CSRF/headers/rate-limit) | 🔴 | Yes |
| Multi-instance / session store | 🔴 | Yes (for scale/deploys) |
| Tenancy (multi-college) | 🟠 | Yes (for the stated business) |
| Observability | 🟠 | Strongly recommended |
| Data: indexes/pagination | 🟠 | Soon |
| Backups / DR | 🟠 | Yes before real data |
| Deployment / infra | 🟠 | Yes |
| Testing | 🟡 | Recommended |
| Hygiene/docs | 🟢 | No |

---

## 1. Reliability & Availability — 🔴
- **Single point of failure**: one process, in-memory sessions. Any restart logs everyone out and drops carts.
- **No graceful shutdown**: in-flight requests dropped on deploy.
- **DB failure = hard exit** (`process.exit(1)`), no retry/backoff, no readiness gating.
- **No `/healthz`** for load balancers / orchestrators.
- **Polling load**: every open order page hits `/api/orders/:id/status` every 5s — load grows with concurrent active orders.
**Required:** external session store, graceful shutdown, health endpoint, connection retry, replace polling with push at scale.

## 2. Scalability — 🔴 for the stated vision
- Cannot run >1 instance (MemoryStore). Vertical scaling only.
- `/admin/orders` and other lists load whole collections into memory and filter in JS — O(N) memory/latency that degrades with order volume.
- No tenancy → "multiple colleges" is not achievable without a data model change.
**Required:** stateless instances, DB-side pagination/filtering, `College` scoping.

## 3. Security — 🔴
See `security-review.md`. Launch-gating subset: remove mock checkout, encrypt+stop-leaking secrets, CSRF, rate limiting, session/cookie hardening, helmet. **Do not take real payments until these are done.**

## 4. Payments — 🔴
See `payment-architecture.md`. Webhooks + reconciliation, amount-binding, encrypted credentials, and a decided commission model are prerequisites. Three of four advertised providers are stubs.

## 5. Data Management — 🟠
- **Indexes**: Order has thoughtful compound indexes 👍. But list/search paths don't use them (in-memory filtering). User/Shop lack indexes for admin search.
- **No pagination** anywhere in admin.
- **Money as float** (should be paise).
- **No backups/PITR defined**, no restore drill. Before real data exists, automated backups + a tested restore are mandatory.
- **No data migration tooling** — schema changes (tenancy, paise) need a migration approach.

## 6. Observability — 🟠
- Logging is `console.log` only, unstructured, some with sensitive content.
- No metrics, no error tracking (Sentry-class), no request IDs, no tracing, no alerting.
**Required before launch:** structured logs + error tracking + basic uptime/latency alerts. You cannot operate a money system you can't see.

## 7. Deployment & Infra — 🟠
- No `Dockerfile`, no IaC, no documented deploy target.
- CI runs **Playwright only** — no lint, typecheck, build, audit, or deploy.
- Env handling is fragile: secrets read at import time, `.env.example` malformed, `SESSION_SECRET` defaults to a dev value.
**Required:** containerize, define hosting (DB managed/replica set), CI with lint+test+audit, secret manager, boot-time env validation.

## 8. Correctness — 🟠
- `routes/menu.js` toggle route throws (missing `Shop` import) — a shipped, broken feature.
- Amount-mismatch between create/verify (payment integrity).
- Dead `pending_payment` state indicates an unfinished order state machine.

## 9. Compliance & Legal — 🟠 (business, but gating)
- **No KYC** of vendors taking money under your brand.
- **No T&C / privacy policy / refund policy** surfaced.
- Handling student PII (name/email) — basic data-protection posture (consent, retention, deletion) is undefined.
- If moving to a marketplace model, **PCI scope and merchant agreements** apply.

## 10. Testing — 🟡
- One Playwright login spec; no coverage on payments, orders, refunds, auth edge cases, or OTP.
**Required floor:** automated tests around money paths (create→verify→order, refund, OTP verify) before changing those paths.

---

## Production Readiness Checklist (condensed)

**Must-have before ANY real launch (the gate):**
- [ ] Remove/gate mock checkout (SEC-1/TD-1)
- [ ] Encrypt vendor secrets at rest + stop rendering them (SEC-2/TD-4)
- [ ] CSRF on all mutating routes, esp. refund (SEC-3)
- [ ] Razorpay webhooks + reconciliation + amount-binding (TD-2/3)
- [ ] Rate limiting + session/cookie hardening + helmet (SEC-5/6/7)
- [ ] External session store (TD-6)
- [ ] Fix `menu.js` import bug (TD-5)
- [ ] Boot-time env validation; enforce real `SESSION_SECRET` (TD-17/22)
- [ ] Structured logging + error tracking + `/healthz` (TD-24/25)
- [ ] Automated backups + tested restore
- [ ] Decide commission model (A vs B) — see payment doc

**Required before MULTI-COLLEGE:**
- [ ] `College` tenancy model + query scoping (TD-7)
- [ ] DB-side pagination/filtering on all admin lists (TD-8)
- [ ] Vendor KYC/onboarding gate (SEC-8)
- [ ] Notifications (replace/augment polling) (TD-16)

**Time to "real money, one college, controlled pilot":** ~3 focused engineering weeks for the gate items.
**Time to "multi-college platform":** add ~3–4 weeks for tenancy, pagination, KYC, notifications.
