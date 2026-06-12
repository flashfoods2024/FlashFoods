# FlashFoods — 90-Day Engineering Roadmap

> Sequenced to ship a **safe paid pilot at one college fast**, then earn the right to scale to many. Each phase ends in a shippable, demonstrable state. Estimates assume 1–2 engineers.

## Guiding principles
1. **Stop the bleeding before adding features.** Money flaws and the security baseline come first.
2. **One real college, real money, controlled pilot** is the first milestone — not "multi-college platform."
3. **Don't build tenancy until the money is trustworthy.** Tenancy on top of a broken payment flow just multiplies the risk.
4. Keep the monolith. Fix its foundations.

---

## Phase 0 — Stop the Bleeding (Week 1)
*Goal: close the open doors. Mostly small, high-leverage fixes.*

- Remove/gate the **mock checkout** route (TD-1). *0.5d*
- Fix `routes/menu.js` missing `Shop` import (TD-5). *5m*
- **Externalize sessions** to `connect-mongo` + harden cookies (`secure`/`sameSite`/`maxAge`), regenerate session on login, enforce real `SESSION_SECRET` (TD-6, SEC-6). *1d*
- Add **helmet**, **express-rate-limit** (login, verify, payment), and **body size limits** (SEC-5/7/11). *1d*
- **Boot-time env validation** (zod/envalid); guard config singletons (TD-17). *0.5d*
- Repo hygiene: delete `.bak`/`test.txt`/demo cruft, fix `.env.example`, rebrand `package.json`/README (TD-19/20/21). *0.5d*

**Exit:** no free orders, no single-restart logout, baseline hardening in place.

---

## Phase 1 — Make the Money Trustworthy (Weeks 2–4)
*Goal: a payment flow you'd stake real rupees on.*

- **Razorpay webhook ingress** (`/webhooks/razorpay`) with signature verification + **idempotent order creation**; client callback becomes an optimization, webhook is truth (TD-2). *4–6d*
- **Bind charged amount to order**: on confirm, fetch gateway order, assert amount == recomputed total, store gateway amount in **paise** (TD-3, TD-12). *2d*
- **Encrypt vendor credentials at rest** (KMS/envelope); stop selecting/rendering secrets; mask in UI; `.select("-paymentSettings")` by default (TD-4, SEC-2/9). *2d*
- **CSRF tokens** on all mutating routes (esp. refund) (SEC-3). *1.5d*
- Split `Payment` from `Order`; add idempotency keys; **daily reconciliation job** (gateway vs local). *3d*
- **Decide the commission model (A marketplace/split vs B direct+invoice)** and document it. If A: implement Razorpay Route split + linked accounts. *spike 1d, build 3–5d if A*
- Tests around money paths: create→webhook→order, refund, double-callback idempotency (TD-23). *2d*

**Exit:** real payments are safe, reconciled, and commission strategy is decided. **This is the gate for a paid pilot.**

---

## Phase 2 — Operate It Like a Real Service (Weeks 5–6)
*Goal: you can see it, deploy it, and recover it.*

- **Structured logging** (pino) with redaction; **error tracking** (Sentry-class); request IDs (TD-24). *1.5d*
- **`/healthz` + graceful shutdown + DB retry/backoff** (TD-25). *0.5d*
- **Containerize** (Dockerfile) + define hosting & managed MongoDB (replica set for transactions/backups). *1.5d*
- **CI upgrade**: lint + typecheck (or JSDoc/zod) + `npm audit` + tests + build (TD-23, SEC-16). *1d*
- **Automated backups + a tested restore drill.** *1d*
- Global error handler + production error masking (SEC-14). *0.5d*

**Exit:** observable, deployable, recoverable. Ready to run a **controlled paid pilot at one college**.

---

## Phase 3 — Earn Multi-College (Weeks 7–10)
*Goal: the actual platform vision, now that money is safe.*

- **`College`/tenant model** + scope every query (shops, vendors, students, orders); college selection in signup/onboarding (TD-7). *5–8d*
- **DB-side pagination + filtering + indexes** on all admin/vendor lists; kill load-all-then-filter (TD-8). *2–3d*
- **Per-request DB amplification** cleanup (single user hydration, cache on session) (TD-10). *1d*
- **Vendor self-serve onboarding + KYC gate** before `paymentConfigured` (SEC-8). *3–4d*
- Audit log for admin actions (refunds, disables, deletes) (SEC-13). *1d*

**Exit:** a second college can be onboarded with isolated data and self-serve vendors.

---

## Phase 4 — Reduce Friction & Round Out (Weeks 11–13)
*Goal: experience and completeness.*

- **Notifications**: transactional email/SMS/push for order-ready; replace 5s polling with SSE/WebSocket at scale (TD-16). *3–4d*
- **Order lifecycle hardening**: OTP TTL + verify throttle + stale `ready_for_pickup` sweep; student-initiated cancellation; resolve dead `pending_payment` (TD-14, TD-18). *2.5d*
- **Implement or formally retire** the 3 stub providers; never let configuring a provider silently disable checkout (TD-11). *0.5d to hide, 3–5d each to build*
- Refund refactor: push refundability into adapters (TD-15). *1d*
- Commission/billing reports surfaced to admin (depends on Phase 1 model). *2–3d*

**Exit:** a complete, low-friction, multi-college product with notifications and clean lifecycle.

---

## Sequencing rationale
- **Phase 0/1 are non-negotiable and first** — they're the difference between "demo" and "can touch real money."
- **Tenancy (Phase 3) deliberately comes after money safety**, not before. A multi-college rollout on an unreconciled payment flow multiplies financial risk across institutions.
- **Notifications and provider build-out (Phase 4) are last** — high value but not safety- or scale-gating.

## Milestones
| Milestone | When | Means |
|---|---|---|
| **Doors closed** | End Wk 1 | No free orders, hardened sessions/headers |
| **Money-safe** | End Wk 4 | Webhooks, reconciliation, encrypted secrets, CSRF, commission decided |
| **Operable** | End Wk 6 | Observability, CI/CD, backups → **paid pilot, 1 college** |
| **Multi-tenant** | End Wk 10 | College isolation, pagination, KYC → **2nd college** |
| **Rounded out** | End Wk 13 | Notifications, lifecycle, billing reports |
