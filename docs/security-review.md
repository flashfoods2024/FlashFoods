# FlashFoods — Security Review

> Threat model: a real-money, multi-vendor web app handling student PII and payment credentials. Reviewed against OWASP Top 10 and payment-handling norms. Severity reflects real-world exploitability.

## Executive security verdict
The app has **a few good instincts** (CSPRNG OTPs, server-side price authority, server-side HMAC verification, password hashing with bcrypt) sitting on top of a **missing security baseline** (no CSRF, no rate limiting, no security headers, no secret encryption) and **two critical money flaws**. It is **not safe to handle real payments today.**

---

## Critical findings

### SEC-1 🔴 — Free orders via mock checkout
`POST /orders/checkout` creates a fully `paid` order with no payment. Reachable by any authenticated student. **Financial fraud by design.** → Remove/gate. (TD-1)

### SEC-2 🔴 — Vendor payment secrets in plaintext + leaked to HTML
`Shop.paymentSettings.apiSecret` is stored unencrypted and rendered into `payment-settings.ejs` as an input `value`. A DB read or simple "view source" exposes every vendor's gateway secret — enabling an attacker to **create charges / issue refunds on the vendor's account**. → Encrypt at rest; never render secrets. (TD-4)

### SEC-3 🔴 — No CSRF protection on state-changing routes
Every mutating action is a cookie-authenticated POST/PATCH/DELETE with **no CSRF token**: place order, **cancel + refund** (`/vendor/orders/:id/cancel`), change payment settings, toggle shop, admin delete vendor/shop, disable users. A malicious page can drive any of these against a logged-in user. The refund endpoint means CSRF can **move money**. → Add CSRF tokens (e.g. `csurf`/double-submit) to all forms + `SameSite` cookies. (TD-9)

### SEC-4 🔴 — Payment captured without order on callback failure
No webhook/reconciliation; relies on client callback. A dropped callback = customer charged, no order, no automated remedy. Integrity + chargeback risk. → Webhooks + reconciliation. (TD-2)

---

## High findings

### SEC-5 🟠 — No rate limiting anywhere
- **Login** (`/login`): unlimited bcrypt-compare attempts → credential stuffing / brute force.
- **OTP verify** (`/vendor/verify`): unlimited 6-digit guesses (scoped to one shop's ready orders, so practically narrow, but still unthrottled).
- **Payment endpoints**: unbounded order-creation calls hitting the gateway.
→ Add `express-rate-limit` on auth, verify, and payment routes.

### SEC-6 🟠 — Session & cookie hardening missing
- MemoryStore (not production-safe; also a DoS/leak vector).
- `SESSION_SECRET` falls back to `"dev-secret"` — if env is unset in prod, sessions are forgeable.
- No explicit cookie flags: `secure`, `httpOnly` (default true), `sameSite`, `maxAge` are not configured.
- Session id is **not regenerated on login** → session-fixation risk.
→ Externalize store, enforce secret presence, set cookie flags, `req.session.regenerate()` on auth.

### SEC-7 🟠 — No security headers
No `helmet`. Missing CSP, HSTS, X-Content-Type-Options, X-Frame-Options (clickjacking on refund/admin actions), Referrer-Policy. The cart page also loads an external script (`checkout.razorpay.com`) with no CSP allowlist. → Add helmet with a tuned CSP.

### SEC-8 🟠 — Authorization edge: vendor self-signup + payment config
A self-registered vendor with no KYC can, once an admin links a shop, enter arbitrary payment credentials and take real money under the FlashFoods brand. No business verification gate. → KYC/verification before `paymentConfigured` can be set.

### SEC-9 🟠 — Stored secrets selected into multiple views
Admin and vendor flows `Shop.findById(...).lean()` and pass the full document (incl. `paymentSettings`) to templates. Even where not rendered, the secret rides along in server memory and any template change risks leaking it. → `.select("-paymentSettings")` by default; load secrets only in the adapter.

---

## Medium findings

### SEC-10 🟡 — OTP has no expiry
Pickup codes never expire and there's no attempt throttle (see SEC-5). A code from a forgotten `ready_for_pickup` order stays valid indefinitely. → TTL + attempt counter.

### SEC-11 🟡 — No input hardening / validation layer
Body parsing is raw; validation is ad-hoc per route. No central schema validation (zod/joi). `express.json()`/`urlencoded` have **no size limit** set → large-body DoS. Email/password have no complexity or length policy. → Central validation + body size limits.

### SEC-12 🟡 — Open redirect vector via `redirect` param
`cart.js` uses `req.body.redirect` to choose where to send the user after add-to-cart. It's mostly used for same-site paths, but it's attacker-controllable. → Allowlist redirect targets / ensure leading `/` and same-origin only.

### SEC-13 🟡 — PII exposure surface
Student/vendor names + emails are shown across admin and vendor order views with no field-level access control beyond role. Acceptable for admin, but there's no audit log of who viewed/changed what. → Add an audit trail for admin actions (vendor disable, refund, deletes).

### SEC-14 🟡 — Error handling leaks / inconsistency
No global error handler. Express 5 forwards async errors to a default handler that, without `NODE_ENV=production`, can leak stack traces. Some catch blocks `console.error` full error objects (incl. gateway error payloads). → Global handler + production error masking + log redaction.

---

## Low findings

- **SEC-15** — `.env.example` contains junk placeholder values that look like real hints; ensure no real secret was ever committed (`.env` is gitignored — good). Verify git history is clean of secrets.
- **SEC-16** — No dependency scanning in CI (`npm audit`, Dependabot). Express 5 / Mongoose / Razorpay SDKs should be monitored.
- **SEC-17** — File upload relies on client MIME (`file.mimetype.startsWith("image/")`), which is spoofable; Cloudinary `allowed_formats` mitigates but server-side type sniffing is stronger.

---

## What's already done right (keep it)
- OTPs use `crypto.randomInt` (CSPRNG), not `Math.random`.
- Order totals recomputed server-side from DB — client cannot set its own price.
- Razorpay signature verified server-side with HMAC-SHA256.
- Passwords hashed with bcrypt (cost 10).
- Soft-disable + `isActive` checks enforced in `attachUser`/`requireAuth`.
- OTP hidden from student until order is `ready_for_pickup`.

---

## Prioritized remediation order
1. SEC-1 (delete mock checkout) — *minutes*
2. SEC-2 / SEC-9 (stop leaking & encrypt secrets) — *days*
3. SEC-3 (CSRF, esp. on refund) — *days*
4. SEC-4 (webhooks/reconciliation) — *with payment rework*
5. SEC-5 + SEC-6 + SEC-7 (rate limit, session/cookie hardening, helmet) — *the baseline bundle, ~3 days*
6. SEC-8 (KYC gate) — *with onboarding rework*
7. Medium tier — scheduled into the roadmap

**Gate:** do not accept real payments until 1–5 are complete.
