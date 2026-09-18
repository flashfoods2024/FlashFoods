# FlashFoods V2 — Route Migration Report

**Objective:** Move FlashFoods to React + Vite without breaking the EJS app, by reducing migration scope to the minimum route set required for V2.

**Method:** Every route read directly from `routes/*.js` + mount prefixes in `server.js`; every handler's response type (render/json/redirect) verified against the source. Classifications reflect **current** behavior, so they also expose the server-side conversion work V2 must do.

---

## Route inventory & classification registry

Legend — response mix:
- **R** = `res.render(...)` (EJS page)
- **J** = `res.json(...)` (API body)
- **→** = `res.redirect(...)` (302 + flash)
- Mixed rows list the dominant/edge behaviors.

Middleware shorthand: `DB`=`requireDb`, `A`=`requireAuth`, `S`=`requireStudent`, `V`=`requireVendor`, `ADM`=`requireAdmin`, `VS`=`requireVendorShop`.

### Auth — `routes/auth.js` (mounted at `/`)

| # | Method | Path | MW | Handler | R/J/→ | Role | V2 | Class |
|---|---|---|---|---|---|---|---|---|
| 1 | GET | `/signup` | — | auth.js:11 | R | Public | ✅ | REQUIRES_API |
| 2 | POST | `/signup` | DB | auth.js:15 | → | Public | ✅ | PARTIAL_API |
| 3 | GET | `/login` | — | auth.js:50 | R | Public | ✅ | REQUIRES_API |
| 4 | POST | `/login` | DB | auth.js:54 | → | Public | ✅ | PARTIAL_API |
| 5 | GET | `/forgot-password` | — | auth.js:87 | R | Public | ✅ | REQUIRES_API |
| 6 | POST | `/forgot-password` | DB | auth.js:91 | → | Public | ✅ | PARTIAL_API |
| 7 | GET | `/reset-password/:token` | DB | auth.js:120 | R | Public | ✅ | REQUIRES_API |
| 8 | POST | `/reset-password/:token` | DB | auth.js:137 | → | Public | ✅ | PARTIAL_API |
| 9 | POST | `/logout` | — | auth.js:180 | → | Any | ✅ | API_READY* |

\* Logout: exists, redirect-based (session destroy). Needs JSON body/204 for SPA, but the controller is trivial.

### Catalog — `routes/shops.js`, `routes/menu.js`

| # | Method | Path | MW | Handler | R/J/→ | Role | V2 | Class |
|---|---|---|---|---|---|---|---|---|
| 10 | GET | `/shops` | DB | shops.js:8 | R | Public | ✅ | PARTIAL_API |
| 11 | GET | `/shops/:slug` | DB | shops.js:13 | R | Public | ✅ | REQUIRES_API |
| 12 | PATCH | `/menu/:id/toggle` | DB,A,V,VS | menu.js:10 | J | Vendor | ✅ | API_READY |

### Cart — `routes/cart.js`

| # | Method | Path | MW | Handler | R/J/→ | Role | V2 | Class |
|---|---|---|---|---|---|---|---|---|
| 13 | GET | `/cart` | DB,A,S | cart.js:19 | R | Student | ✅ | REQUIRES_API |
| 14 | POST | `/cart/add` | DB,A,S | cart.js:97 | → | Student | ✅ | PARTIAL_API |
| 15 | POST | `/cart/variant` | DB,A,S | cart.js:175 | J | Student | ✅ | API_READY |
| 16 | POST | `/cart/line` | DB,A,S | cart.js:249 | → | Student | ✅ | PARTIAL_API |
| 17 | POST | `/cart/clear` | DB,A,S | cart.js:274 | → | Student | ✅ | REQUIRES_API (adds JSON-only; currently a dumb redirect) |

### Orders & Payments — `routes/orders.js`

| # | Method | Path | MW | Handler | R/J/→ | Role | V2 | Class |
|---|---|---|---|---|---|---|---|---|
| 18 | POST | `/create-razorpay-order` | DB,A,S | orders.js:130 | J | Student | ✅ | PARTIAL_API (returns raw gateway obj `{...rzpOrder,key_id}`; needs normalized contract) |
| 19 | POST | `/verify-payment` | DB,A,S | orders.js:211 | J | Student | ✅ | PARTIAL_API (JSON but insecure string `===`; amount not re-checked; non-atomic — fix server-side) |
| 20 | POST | `/easebuzz/initiate` | DB,A,S | orders.js:305 | J | Student | ✅ | API_READY |
| 21 | POST | `/easebuzz/callback` | DB | orders.js:431 | → | Gateway | ✅ | LEGACY_KEEP (server→gateway, stay EJS/server-side) |
| 22 | POST | `/phonepe/initiate` | DB,A,S | orders.js:473 | J | Student | ✅ | API_READY |
| 23 | ALL | `/phonepe/callback` | DB | orders.js:588 | → | Gateway | ✅ | LEGACY_KEEP |
| 24 | POST | `/orders/checkout` | DB,A,S | orders.js:677 | → | Student | ⛔ | DELETE / LEGACY_KEEP (mock checkout; **hard-blocked** for non-testing shops, QA-only) |
| 25 | GET | `/orders` | DB,A,S | orders.js:759 | R | Student | ✅ | REQUIRES_API |
| 26 | GET | `/api/orders/:id/status` | DB,A,S | orders.js:773 | J | Student | ✅ | API_READY |
| 27 | GET | `/orders/:id` | DB,A,S | orders.js:798 | R | Student | ✅ | REQUIRES_API |
| 28 | POST | `/webhooks/razorpay` | raw,DB | webhooks.js:29 | J | Gateway | ✅ | LEGACY_KEEP |

### Profile — `routes/profile.js`

| # | Method | Path | MW | Handler | R/J/→ | Role | V2 | Class |
|---|---|---|---|---|---|---|---|---|
| 29 | GET | `/profile` | DB,A | profile.js:51 | R | Student | ✅ | REQUIRES_API |
| 30 | POST | `/profile/phone` | DB,A,S | profile.js:80 | J | Student | ✅ | API_READY |

### Vendor console — `routes/vendor.js` (all `DB,A,V`; menu+order rows also `VS`)

| # | Method | Path | MW | Handler | R/J/→ | Role | V2 | Class |
|---|---|---|---|---|---|---|---|---|
| 31 | GET | `/vendor/menu` | VS | vendor.js:134 | R | Vendor | ✅ | REQUIRES_API |
| 32 | POST | `/vendor/shop/toggle` | VS | vendor.js:158 | → | Vendor | ✅ | REQUIRES_API (currently redirect+flash) |
| 33 | POST | `/vendor/menu` | VS | vendor.js:198 | → | Vendor | ✅ | REQUIRES_API (multipart create → redirect) |
| 34 | PATCH | `/vendor/menu/:id` | VS | vendor.js:241 | J | Vendor | ✅ | API_READY |
| 35 | DELETE | `/vendor/menu/:id` | VS | vendor.js:306 | J | Vendor | ✅ | API_READY |
| 36 | POST | `/vendor/menu/parcel-charge` | VS | vendor.js:336 | → | Vendor | ✅ | REQUIRES_API |
| 37 | GET | `/vendor/orders/pending` | VS | vendor.js:419 | R | Vendor | ✅ | REQUIRES_API |
| 38 | GET | `/vendor/orders/pending.json` | VS | vendor.js:438 | J | Vendor | ✅ | API_READY (the real-time feed) |
| 39 | POST | `/vendor/orders/:id/mark-reminder-sent` | VS | vendor.js:480 | J | Vendor | ✅ | API_READY |
| 40 | POST | `/vendor/orders/:id/ready` | VS | vendor.js:506 | → | Vendor | ✅ | REQUIRES_API (form-POST→redirect today; must become JSON) |
| 41 | POST | `/vendor/orders/:id/accept` | VS | vendor.js:544 | → | Vendor | ✅ | REQUIRES_API (same) |
| 42 | POST | `/vendor/orders/:id/cancel` | VS | vendor.js:578 | → | Vendor | ✅ | REQUIRES_API (same; + refund state) |
| 43 | GET | `/vendor/verify` | VS | vendor.js:685 | R | Vendor | ✅ | REQUIRES_API |
| 44 | POST | `/vendor/verify` | VS | vendor.js:708 | → / J | Vendor | ✅ | PARTIAL_API (JSON on success/404, redirect on HTML-accept; normalize) |
| 45 | POST | `/vendor/orders/:id/toggle-parcel` | VS | vendor.js:774 | J | Vendor | ✅ | PARTIAL_API (JSON but float-mutates total; fix in API_READY) |
| 46 | GET | `/vendor/orders/:id/adjust` | VS | vendor.js:815 | R | Vendor | ✅ | REQUIRES_API |
| 47 | POST | `/vendor/orders/:id/adjust` | VS | vendor.js:852 | → | Vendor | ✅ | REQUIRES_API (refund math; JSON needed) |
| 48 | GET | `/vendor/orders/completed` | VS | vendor.js:977 | R | Vendor | ✅ | REQUIRES_API (+ pagination; currently cap-50) |
| 49 | GET | `/vendor/orders/:id` | VS | vendor.js:999 | R | Vendor | ✅ | REQUIRES_API |
| 50 | GET | `/vendor/payment/settings` | VS | vendor.js:1048 | R | Vendor | ✅ | REQUIRES_API (mask secrets!) |
| 51 | POST | `/vendor/payment/settings` | VS | vendor.js:1074 | → | Vendor | ✅ | REQUIRES_API (store creds; encrypt) |

### Admin console — `routes/admin.js` (all `DB,A,ADM`)

| # | Method | Path | Handler | R/J/→ | Role | V2 | Class |
|---|---|---|---|---|---|---|---|
| 52 | GET | `/admin/` (dashboard) | admin.js:302 | R | Admin | ✅ | REQUIRES_API |
| 53 | GET | `/admin/shops` | admin.js:354 | R | Admin | ✅ | REQUIRES_API |
| 54 | GET | `/admin/shops/new` | admin.js:391 | R | Admin | ⚠️ | REQUIRES_API (merge into form) |
| 55 | POST | `/admin/shops` | admin.js:402 | → | Admin | ✅ | REQUIRES_API |
| 56 | GET | `/admin/shops/:id` | admin.js:455 | R | Admin | ✅ | REQUIRES_API |
| 57 | GET | `/admin/shops/:id/edit` | admin.js:509 | R | Admin | ⚠️ | REQUIRES_API (merge into form) |
| 58 | POST | `/admin/shops/:id/edit` | admin.js:535 | → | Admin | ✅ | REQUIRES_API |
| 59 | POST | `/admin/shops/:id/toggle` | admin.js:610 | → | Admin | ✅ | REQUIRES_API |
| 60 | POST | `/admin/shops/:id/delete` | admin.js:634 | → | Admin | ✅ | REQUIRES_API (change to soft-delete / archive) |
| 61 | GET/POST | `/admin/shops/:id/payment-settings` | admin.js:662/682 | R/→ | Admin | ✅ | REQUIRES_API |
| 62 | GET | `/admin/vendors` | admin.js:777 | R | Admin | ✅ | REQUIRES_API |
| 63 | GET | `/admin/vendors/new` | admin.js:802 | R | Admin | ⚠️ | REQUIRES_API (merge into form) |
| 64 | POST | `/admin/vendors` | admin.js:813 | → | Admin | ✅ | REQUIRES_API (min password length) |
| 65 | GET | `/admin/vendors/:id` | admin.js:856 | R | Admin | ✅ | REQUIRES_API |
| 66 | GET | `/admin/vendors/:id/edit` | admin.js:902 | R | Admin | ⚠️ | REQUIRES_API (merge into form) |
| 67 | POST | `/admin/vendors/:id/edit` | admin.js:930 | → | Admin | ✅ | REQUIRES_API |
| 68 | POST | `/admin/vendors/:id/toggle` | admin.js:995 | → | Admin | ✅ | REQUIRES_API |
| 69 | POST | `/admin/vendors/:id/delete` | admin.js:1019 | → | Admin | ✅ | REQUIRES_API (soft-delete) |
| 70 | GET | `/admin/students` | admin.js:1042 | R | Admin | ✅ | REQUIRES_API |
| 71 | GET | `/admin/students/:id` | admin.js:1069 | R | Admin | ✅ | REQUIRES_API |
| 72 | POST | `/admin/students/:id/toggle` | admin.js:1121 | → | Admin | ✅ | REQUIRES_API |
| 73 | GET | `/admin/orders` | admin.js:1145 | R | Admin | ✅ | REQUIRES_API |
| 74 | GET | `/admin/orders/:id` | admin.js:1175 | R | Admin | ✅ | REQUIRES_API |
| 75 | POST | `/admin/orders/:id/toggle-parcel` | admin.js:1210 | → | Admin | ⚠️ | REQUIRES_API (fix float-mutation) |
| 76 | GET | `/admin/menus` | admin.js:1247 | R | Admin | ✅ | REQUIRES_API |
| 77 | GET | `/admin/vendors/:vendorId/menu` | admin.js:1283 | R | Admin | ✅ | REQUIRES_API |
| 78 | POST | `/admin/vendors/:vendorId/menu` | admin.js:1300 | → | Admin | ✅ | REQUIRES_API |
| 79 | PATCH | `/admin/vendors/:vendorId/menu/:id` | admin.js:1342 | J | Admin | ✅ | API_READY |
| 80 | DELETE | `/admin/vendors/:vendorId/menu/:id` | admin.js:1405 | J | Admin | ✅ | API_READY |
| 81 | PATCH | `/admin/vendors/:vendorId/menu/:id/toggle` | admin.js:1432 | J | Admin | ✅ | API_READY |
| 82 | POST | `/admin/vendors/:vendorId/shop/toggle` | admin.js:1467 | → | Admin | ⚠️ | REQUIRES_API |
| 83 | POST | `/admin/vendors/:vendorId/parcel-charge` | admin.js:1492 | → | Admin | ⚠️ | REQUIRES_API |
| 84 | GET | `/admin/vendors/:vendorId/menu/import` | admin.js:1526 | R | Admin | ⚠️ | REQUIRES_API |
| 85 | POST | `/admin/vendors/:vendorId/menu/import` | admin.js:1539 | → | Admin | ⚠️ | REQUIRES_API (upload→Gemini pipeline; keep session-ware server-side) |
| 86 | POST | `/admin/vendors/:vendorId/menu/import/confirm` | admin.js:1671 | → | Admin | ⚠️ | REQUIRES_API (write from server vetted state, not req.body) |
| 87 | GET | `/admin/analytics` | admin.js:1763 | R | Admin | ✅ | REQUIRES_API |
| 88 | GET | `/admin/analytics/data` | admin.js:1800 | J | Admin | ✅ | API_READY |

### Device — `routes/api/fcm.js` (mounted at `/api/fcm`; `DB` implied, `A,V`)

| # | Method | Path | MW | Handler | R/J/→ | Role | V2 | Class |
|---|---|---|---|---|---|---|---|---|
| 89 | POST | `/api/fcm/register` | A,V | fcm.js:9 | J | Vendor | ✅ | PARTIAL_API (fix token-upsert hijack → becomes API_READY) |
| 90 | POST | `/api/fcm/unregister` | A,V | fcm.js:33 | J | Vendor | ✅ | API_READY |

### Server-level (server.js)

| # | Method | Path | R/J/→ | Role | V2 | Class |
|---|---|---|---|---|---|---|
| 91 | GET | `/` | R (home.ejs) | Public | ✅ | REQUIRES_API |
| 92 | GET | `/sw.js` | injected JS | Public | ✅ | LEGACY_KEEP |
| 93 | GET | `/firebase-messaging-sw.js` | injected JS | Public | ✅ | LEGACY_KEEP |
| 94 | GET | `/version.json` | JSON | Public | ✅ | API_READY (used by SW update check) |

---

## Section A — Routes required for V2 launch

The minimum V2 surface. **28 routes** that MUST exist as a working API for React:

**Auth/Public (7):**
`POST /signup` · `POST /login` · `POST /forgot-password` · `POST /reset-password/:token` · `POST /logout` · `GET /` (home) · `GET /api/auth/me` *(new — not in registry; needed so React can hydrate identity)*

**Catalog (3):** `GET /shops` · `GET /shops/:slug` · `PATCH /menu/:id/toggle`

**Cart (3):** `GET /cart` · `POST /cart/add` · `POST /cart/variant` (line + clear can fold into these or stay as-is)

**Orders/Payment (6):** `POST /create-razorpay-order` · `POST /verify-payment` · `POST /easebuzz/initiate` · `POST /phonepe/initiate` · `GET /orders` · `GET /orders/:id` (+ `/api/orders/:id/status` already API).

**Student extras (2):** `GET /profile` · `POST /profile/phone`

**Vendor (8):** `GET /vendor/orders/pending.json` · accept · ready · cancel · `POST /vendor/verify` · `GET /vendor/orders/completed` · `GET /vendor/menu` + menu CRUD · `GET`/`POST /vendor/payment/settings`

**Admin core (7):** `GET /admin/analytics/data` · dashboard · shops/vendors/students list · orders search · order detail · menu management.

> These are the only controllers a React V2 needs. **Everything else in Section C is fan-out to reach them.**

---

## Section B — Routes that are ALREADY JSON and consumable by React immediately

No server change needed (beyond the noted hardening). Consumable in phase 1.

| # | Path | Note |
|---|---|---|
| 12 | `PATCH /menu/:id/toggle` | returns `{item}` |
| 15 | `POST /cart/variant` | returns `{variantName, variantPrice, subtotal, parcelCharge, totalParcel, allVariantsSelected}` |
| 20 | `POST /easebuzz/initiate` | returns `{redirectUrl}` |
| 22 | `POST /phonepe/initiate` | returns `{redirectUrl}` |
| 26 | `GET /api/orders/:id/status` | polling endpoint |
| 30 | `POST /profile/phone` | `{success, phone}` |
| 34 | `PATCH /vendor/menu/:id` | `{item}` |
| 35 | `DELETE /vendor/menu/:id` | `204`/`{error}` |
| 38 | `GET /vendor/orders/pending.json` | the real-time feed |
| 39 | `POST /vendor/orders/:id/mark-reminder-sent` | `{success}` |
| 79 | `PATCH /admin/vendors/:vendorId/menu/:id` | `{item}` |
| 80 | `DELETE /admin/vendors/:vendorId/menu/:id` | |
| 81 | `PATCH /admin/vendors/:vendorId/menu/:id/toggle` | |
| 88 | `GET /admin/analytics/data` | full dashboard JSON |
| 90 | `POST /api/fcm/unregister` | after register fix, also 89 |
| 94 | `GET /version.json` | PWA |

**Also immediately reusable but need small hardening before React trusts them (upgrade to API_READY):**
- 19 `POST /verify-payment` — **must** fix `===` → timing-safe, add amount re-check, atomic `findOneAndUpdate`.
- 18 `POST /create-razorpay-order` — normalize `{...rzpOrder}` into a clean contract.
- 45 `POST /vendor/orders/:id/toggle-parcel` — JSON today but float-mutates `total`; prefer recompute before SPA uses.
- 44 `POST /vendor/verify` — JSON exists, but redirect-branch for HTML-accept must be dropped for a pure JSON contract; add OTP rate-limit/expiry.
- 89 `POST /api/fcm/register` — fix upsert keyed on token-only (hijack).

---

## Section C — Routes that RENDER EJS and need API conversion

These are the real migration work. Grouped:

**Auth pages (pure render → API + no page server-side):**
1 GET `/signup` · 3 GET `/login` · 5 GET `/forgot-password` · 7 GET `/reset-password/:token`
→ Replace page render with JSON; the React router owns the page. `POST` variants are in PARTIAL/* (A).

**Student pages:**
13 GET `/cart`, 25 GET `/orders`, 27 GET `/orders/:id`, 29 GET `/profile`, 91 GET `/` (home)

**Vendor pages:**
31 GET `/vendor/menu`, 37 GET `/vendor/orders/pending`, 43 GET `/vendor/verify`, 46 GET `/vendor/orders/:id/adjust`, 48 GET `/vendor/orders/completed`, 49 GET `/vendor/orders/:id`, 50 GET `/vendor/payment/settings`

**Admin pages (17 renders):**
52 dashboard, 53 shops, 56 shop show, 61 payment-settings, 62 vendors, 65 vendor show, 70 students, 71 student show, 73 orders, 74 order show, 76 menus, 77 vendor menu, 84 menu-import, 87 analytics, + 54/57/63/66 (new/edit forms — merge into single {create, edit} route per resource)

**Conversion principle:** every page becomes a typed endpoint pair. Most already have POST counterparts; the GET→page→JSON is the additive work. Prefer **one list + one detail + one mutation per domain** (shops, vendors, students, orders, menu), collapsing the `/new` and `/edit` views onto the detail/mutation contract.

---

## Section D — Routes that appear unused, duplicated, experimental, or safe for deletion

### D1. Actual deletes / risk-gated retain

| # | Path | Why | Action |
|---|---|---|---|
| 24 | `POST /orders/checkout` | Mock/QA checkout — hard-blocked for non-testing shops, not used by any real flow. | **DELETE** for V2 (or keep as `LEGACY_KEEP` gated behind env; not shipped to end users). |

### D2. Experimental / dev-only code — keep but out of V2 critical path

- `POST /orders/checkout` (above).
- **Mock payment paths / "Payment is simulated"** copy in `cart/index.ejs` — indicates a future/QA gateway path; not part of V2 real-money flow.
- The **`gemini-flash` vs `gemini-lite` discrepancy** in `menu-import/debug.js` (model mismatch) — import pipeline is experimental; keep server-side, do not prioritize for V2.

### D3. Duplicated logic — low-risk to consolidate during API phase (not route deletes)

- **Menu CRUD duplicated** across `vendor.js` (31–36) and `admin.js` (77–83). Same shape. Collapse V2 admin menu ops onto the vendor-shaped handlers; keep one authoritative impl.
- **Variant-price resolution** duplicated in `cart.js`, `orders.js`, `vendor.js` — extract to one service (not a route, but removes the "fix breaks one copy" class).
- **Admin `toggle-parcel` (75)** duplicates vendor `toggle-parcel` (45) — one implementation.

### D4. Admin form routes — merge, not delete

- `GET /admin/shops/new` (54) + `GET /admin/shops/:id/edit` (57) → combine into a single `GET /api/admin/shops/:id?` returning `{shop:null|shop}`.
- Same for vendors: 63 + 66.
- Keep the POST create/update endpoints, but rename to REST-consistent `/api/admin/shops`, `/api/admin/shops/:id`.

### D5. Candidates to leave as `LEGACY_KEEP` (server-side, not ported to React)

| # | Path | Why keep legacy |
|---|---|---|
| 21, 23, 28 | `easebuzz/callback`, `phonepe/callback`, `webhooks/razorpay` | **Gateway callbacks.** Must stay server-side; do not convert to React. |
| 92, 93 | `/sw.js`, `/firebase-messaging-sw.js` | Service-workers. Stay as static/special route; not a React route. |
| 84, 85, 86 isolation into a **modal/flow within admin**, not converted to its own page | menu-import | Keep as admin sub-flow (server session + JSON drop-in), not separate SPA page. |

> Route count consideration: of ~95 routes, V2 needs a clean API surface of roughly **30–40 endpoints**. The rest are either legacy-keep (gateway/SW), deletable (checkout mock), or EJS-page renders that collapse into ~8 Read/List/Detail resources.

---

## Section E — Recommended migration order (dependency-ranked)

**Stage 0 — API hardening (blocking, server-side only).** No UI moves until these are green; they gate Section B and C:
1. All money-mutating transitions atomic: `verify-payment`, vendor `accept/ready/cancel/adjust/verify`, admin `toggle-parcel` → `findOneAndUpdate` with status precondition.
2. `verify-payment`: timing-safe compare + amount==`order.total` check + idempotent `webhookEventId`-style dedupe.
3. CSRF verification for SPA non-GET + `session.regenerate()` on login/signup + `secure`/`sameSite` cookie flags.
4. `POST /api/fcm/register`: scope upsert to `{token, vendorId: me}`.
5. Add `GET /api/auth/me` and unify error shape `{error, code}`.

**Stage 1 — Consumable-but-safe JSON (Section B + hardening items).** Wire the 16+ API_READY endpoints into a typed api-client + React Query so the first screens render from real data:
- `GET /api/orders/:id/status`, `/cart/variant`, `/analytics/data`, `/pending.json`, `/profile/phone`, menu CRUD (vendor+admin), gateway `initiate`.

**Stage 2 — Read-only screens (Section C low-risk).** Because these convert a GET→page to a GET→JSON with no mutations:
1. Home, catalog (`/shops`, `/shops/:slug`) ← depends on 10/11.
2. Orders list + order detail + `/api/orders/:id/status` polling.
3. Analytics → already JSON; lowest cost.
4. Profile (needs `/api/auth/me`).

**Stage 3 — Auth + session flows.** Depends on Stage 0 items 3 & 5. Signup/login/forgot/reset/logout now work as JSON; this unlocks personalization and session handling across all screens.

**Stage 4 — Money flows (Student).** Depends on Stage 0 items 1–2 (verify-payment fixed) + Stage 2 catalog:
1. Cart (`GET/POST /cart*`).
2. Checkout rail: `create-razorpay-order` → `verify-payment`; `easebuzz/initiate`; `phonepe/initiate`.
3. `orders/checkout` deleted from SPA surface.

**Stage 5 — Vendor console.** Depends on Stage 4 (orders state machine stable) + Stage 1 feed:
1. `pending.json` feed + socket wiring.
2. accept / ready / cancel / toggle-parcel / verify(OTP) / adjust — now pure JSON (Stage 0 #1).
3. menu + parcel + payment-settings.
4. completed-orders with pagination.

**Stage 6 — Admin console.** Depends on Stages 0–5 (menu ops reuse vendor handlers; orders reuse Stage 4/5):
1. dashboard + analytics (mostly done Stage 2).
2. shops/vendors/students CRUD (collapse /new & /edit).
3. orders search + order detail + toggle-parcel.
4. menu-import flow (server session → JSON confirm writing server-vetted data).

**Stage 7 — Decommission EJS.** After every screen routed in React:
- Add SPA mount at `/app` (student) + `/vendor` + `/admin`; keep legacy EJS on the old prefixes until each is cut.
- Re-route `/`, `/shops…`, `/cart…`, `/orders…`, `/profile` to React; keep gateway callbacks, `/sw.js`, `/version.json`, `/api/*` server-side.
- Update `sw.js` precache → SPA `navigateFallback`; delete EJS templates + render-middleware + `res.locals` formatters.

---

## Handoff summary (minimal V2 surface vs legacy)

| | Count |
|---|---|
| Total routed handlers (registry) | ~95 |
| **Required for V2 (Section A)** | ~28 core resources |
| Already JSON for React (Section B) | ~17 (+5 after hardening) |
| Need EJS→API conversion (Section C) | ~35 (many collapse to ~8 resource pairs) |
| Gateway/SW — must stay server-side (LEGACY_KEEP) | 3 callbacks + 2 SW + webhook = 6 |
| Safe to delete (Section D) | 1 (`POST /orders/checkout`); form-route merges in Section D4 |

**Bottom line:** The migration is *not* "port 95 screens." It is: **(1)** harden ~5 money/auth endpoints, **(2)** expose ~8 Read/List/Detail + mutation contracts, **(3)** reuse the 16 JSON routes as-is, **(4)** delete/keep the mock+gateway+SW surface as-is. Stages 0 → 2 unlock the bulk of value with the least risk; Stage 5 (vendor real-time) and Stage 6 (admin) carry the most complexity and should land last.