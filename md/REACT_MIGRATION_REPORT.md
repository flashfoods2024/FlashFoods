# FlashFoods → React Migration Report

**Scope:** Full architecture analysis of `/flashfoods` (Node.js + Express 5 + Mongoose + EJS + Socket.IO) to plan a client-side React migration.
**Constraint:** No code modified — report only.

---

## 1. Complete Route Inventory

Conventions: `(DB)` = `requireDb`, `(A)` = `requireAuth`, `(S)/(V)/(ADM)` = role guard, `(VS)` = `requireVendorShop` (sets `req.vendorShopId`). "→ JSON" means the handler returns a JSON body usable directly as an API. "→ view" means it renders an EJS template.

### 1.1 App-level (server.js)

| Method | Path | Middleware | Behavior |
|---|---|---|---|
| GET | `/` | — | renders `home.ejs` |
| GET | `/sw.js` | — | injects Firebase env into SW template (no-cache) |
| GET | `/firebase-messaging-sw.js` | — | same, for messaging SW |
| GET | `/version.json` | — | static build metadata (PWA update check) |

### 1.2 Auth — `routes/auth.js`

| Method | Path | MW | Behavior |
|---|---|---|---|
| GET | `/signup` | — | view `auth/signup` |
| POST | `/signup` | (DB) | create student account (role hardcoded `student`), bcrypt, autologin → `/` |
| GET | `/login` | — | view `auth/login` |
| POST | `/login` | (DB) | verify, set `session.userId` → vendor, `/vendor/orders/pending`, else `/` |
| GET | `/forgot-password` | — | view |
| POST | `/forgot-password` | (DB) | emails reset link (swallows errors) |
| GET | `/reset-password/:token` | (DB) | view w/ token |
| POST | `/reset-password/:token` | (DB) | sets new password, does NOT kill other sessions |
| POST | `/logout` | — | destroys session → `/` |

### 1.3 Catalog — `routes/shops.js`, `routes/menu.js`

| Method | Path | MW | Behavior |
|---|---|---|---|
| GET | `/shops` | (DB) | view `shops/index` (list of shops) |
| GET | `/shops/:slug` | (DB) | view `shops/menu` (shop + menuItems) |
| PATCH | `/menu/:id/toggle` | (DB)(A)(V)(VS) | → JSON toggle `available`; 403 if shop disabled |

### 1.4 Cart — `routes/cart.js`

| Method | Path | MW | Behavior |
|---|---|---|---|
| GET | `/cart` | (DB)(A)(S) | view `cart/index` (recomputes subtotal/parcel server-side) |
| POST | `/cart/add` | (DB)(A)(S) | add item to session cart → redirect to shop |
| POST | `/cart/variant` | (DB)(A)(S) | **→ JSON** `{variantName, variantPrice, subtotal, parcelCharge, totalParcel, allVariantsSelected}` |
| POST | `/cart/line` | (DB)(A)(S) | update qty (0..99) → redirect `/cart` |
| POST | `/cart/clear` | (DB)(A)(S) | reset session cart → redirect |

### 1.5 Orders & Payments — `routes/orders.js` (also `routes/webhooks.js`)

| Method | Path | MW | Behavior |
|---|---|---|---|
| POST | `/create-razorpay-order` | (DB)(A)(S) | **→ JSON** `{...rzpOrder, key_id}` |
| POST | `/verify-payment` | (DB)(A)(S) | **→ JSON** success/fail (Razorpay client holds order + payment) |
| POST | `/easebuzz/initiate` | (DB)(A)(S) | **→ JSON** `{redirectUrl}` |
| POST | `/easebuzz/callback` | (DB) | gateway callback → redirect `/orders/:id` |
| POST | `/phonepe/initiate` | (DB)(A)(S) | **→ JSON** `{redirectUrl}` |
| ALL | `/phonepe/callback` | (DB) | gateway callback → redirects |
| POST | `/orders/checkout` | (DB)(A)(S) | mock checkout — QA-only, hard-blocked for non-testing shops |
| GET | `/orders` | (DB)(A)(S) | view `orders/index` |
| GET | `/api/orders/:id/status` | (DB)(A)(S) | **→ JSON** `{status, adjusted, ...}` (student polls 5s) |
| GET | `/orders/:id` | (DB)(A)(S) | view `orders/show` |
| POST | `/webhooks/razorpay` | raw body, (DB) | **→ JSON ack** (signature + idempotent) |

### 1.6 Profile — `routes/profile.js`

| Method | Path | MW | Behavior |
|---|---|---|---|
| GET | `/profile` | (DB)(A) | view `profile/index` |
| POST | `/profile/phone` | (DB)(A)(S) | **→ JSON** `{success, phone}` / `{error}` |

### 1.7 Vendor console — `routes/vendor.js` (all require `(DB)(A)(V)`; orders/menu additionally `(VS)`)

| Method | Path | MW | Behavior |
|---|---|---|---|
| GET | `/vendor/menu` | (VS) | view `vendor/menu` (uses `menu-manager` partial) |
| POST | `/vendor/shop/toggle` | (VS) | toggle shop open → redirect |
| POST | `/vendor/menu` | (VS) | create item (multipart image) → redirect |
| PATCH | `/vendor/menu/:id` | (VS) | **→ JSON** update item (checks shop disabled → 403) |
| DELETE | `/vendor/menu/:id` | (VS) | **→ JSON** delete (404 if wrong shop) |
| POST | `/vendor/menu/parcel-charge` | (VS) | update parcel charge → redirect |
| GET | `/vendor/orders/pending` | (VS) | view `vendor/pending-orders` (the 757-line real-time page) |
| GET | `/vendor/orders/pending.json` | (VS) | **→ JSON** pending orders array (polled 5s) |
| POST | `/vendor/orders/:id/mark-reminder-sent` | (VS) | **→ JSON** `{success}` |
| POST | `/vendor/orders/:id/ready` | (VS) | status → redirect (client fetch) |
| POST | `/vendor/orders/:id/accept` | (VS) | status → redirect (client fetch) |
| POST | `/vendor/orders/:id/cancel` | (VS) | cancel + refund → redirect (client fetch) |
| GET | `/vendor/verify` | (VS) | view `vendor/verify` (ready orders w/ OTP) |
| POST | `/vendor/verify` | (VS) | OTP check → JSON or redirect |
| POST | `/vendor/orders/:id/toggle-parcel` | (VS) | mutate total → redirect |
| GET | `/vendor/orders/:id/adjust` | (VS) | view `vendor/adjust-order` |
| POST | `/vendor/orders/:id/adjust` | (VS) | partial refund/adjust → redirect |
| GET | `/vendor/orders/completed` | (VS) | view `vendor/completed-orders` (cap 50) |
| GET | `/vendor/orders/:id` | (VS) | view `vendor/order-details` |
| GET | `/vendor/payment/settings` | (VS) | view `vendor/payment-settings` (secrets shown) |
| POST | `/vendor/payment/settings` | (VS) | save gateway creds in plaintext → redirect |

### 1.8 Admin console — `routes/admin.js` (all `(DB)(A)(ADM)`)

| Method | Path | Behavior |
|---|---|---|
| GET | `/admin/` | view `admin/dashboard` (note: `totalOrders` currently = completed-only count) |
| GET | `/admin/shops`, `/admin/shops/new`, `/admin/shops/:id`, `/admin/shops/:id/edit` | views |
| POST | `/admin/shops` | create shop |
| POST | `/admin/shops/:id` | update shop |
| POST | `/admin/shops/:id/toggle` | activate/deactivate |
| POST | `/admin/shops/:id/delete` | **hard delete** (orphans orders) |
| GET/POST | `/admin/shops/:id/payment-settings` | view / save creds |
| GET | `/admin/vendors`, `/new`, `/vendors/:id`, `/vendors/:id/edit` | views |
| POST | `/admin/vendors`, `/admin/vendors/:id/edit` | create/update vendor |
| POST | `/admin/vendors/:id/toggle`, `/delete` | activate / delete |
| GET | `/admin/students`, `/admin/students/:id` | views |
| POST | `/admin/students/:id/toggle` | activate/deactivate |
| GET | `/admin/orders`, `/admin/orders/:id` | views (search via `$lookup`) |
| POST | `/admin/orders/:id/toggle-parcel` | float-mutates `order.total` |
| GET | `/admin/menus` | view (vendor-per-row + counts) |
| GET | `/admin/vendors/:vendorId/menu` | view `admin/vendors/menu` |
| POST | `/admin/vendors/:vendorId/menu` | create item (as admin) |
| PATCH / DELETE | `/admin/vendors/:vendorId/menu/:id` | update / delete item |
| PATCH | `/admin/vendors/:vendorId/menu/:id/toggle` | toggle availability |
| POST | `/admin/vendors/:vendorId/shop/toggle`, `/parcel-charge` | shop control |
| GET/POST | `/admin/vendors/:vendorId/menu/import` | **view** `menu-import` + upload→Gemini pipeline (session-ware) |
| POST | `/admin/vendors/:vendorId/menu/import/confirm` | writes imported items **from `req.body`** (validation gap) |
| GET | `/admin/analytics` | view `admin/analytics` (Chart.js page) |
| GET | `/admin/analytics/data` | **→ JSON** full analytics payload (KPIs, shop insights, revenue trend, status dist, popular items) |

### 1.9 Device / push — `routes/api/fcm.js`

| Method | Path | MW | Behavior |
|---|---|---|---|
| POST | `/api/fcm/register` | (A)(V) | **→ JSON** upsert token (hijack gap — keyed on token only) |
| POST | `/api/fcm/unregister` | (A)(V) | **→ JSON** delete own token |

**Route counts:** 10 routed modules, ~95 handlers. Only ~16 are true JSON APIs; the rest are form-POST→redirect or EJS renders. **This is the single most important structural fact for the migration: the "API" layer must be built, not reused.**

---

## 2. API Inventory (grouped)

### ✅ Existing JSON APIs (usable as-is after signing/CSRF work)

**Student**
- `GET /api/orders/:id/status` — `{status, adjusted, ...}`
- `POST /cart/variant` — `{variantName, variantPrice, subtotal, parcelCharge, totalParcel, allVariantsSelected}`
- `POST /profile/phone` — `{success, phone}` / `{error}`

**Vendor**
- `GET /vendor/orders/pending.json` — array of pending orders (incl `pickupOtp`)
- `POST /vendor/orders/:id/mark-reminder-sent` — `{success}`
- `PATCH /menu/:id/toggle`, `PATCH /vendor/menu/:id`, `DELETE /vendor/menu/:id` — item JSON

**Admin**
- `GET /admin/analytics/data` — full dashboard JSON

**Device**
- `POST /api/fcm/register`, `POST /api/fcm/unregister`

**Gateway callbacks (server-side, not SPA-facing)**
- `POST /webhooks/razorpay`, `/easebuzz/callback`, `/phonepe/callback`

### 🟡 Partial JSON (returns JSON on success but redirect/flash on failure — must be normalized)

- `POST /vendor/verify` (OTP): JSON on success/400/404, redirect on HTML accept
- `POST /vendor/orders/:id/ready|accept|cancel|adjust|toggle-parcel`: JSON `{orderId}` only on some paths, mostly `302` + flash → **require fully JSON rewrite**
- `POST /auth/login`, `/auth/signup`: redirect-based responses (need `{user}` or `{error}` JSON + proper status codes)
- `POST /cart/line`, `/cart/add`, `/cart/clear`: pure redirects → need JSON/DTO
- `POST /orders/checkout` (mock): redirect → need JSON

### ❌ Missing (form-POST only — must be designed as new endpoints before migration)

- Vendor: create menu item (multipart), parcel charge, shop toggle, payment settings CRUD, completed orders pagination
- Admin: **every** mutation (shops/vendors/students CRUD, toggle, delete, menu CRUD, shop control, menu-import confirm), order search, single-order detail JSON, students/vendors/shops list JSON with stats
- Student: order creation payload for ALL three gateways currently returns raw gateway objects (`{...rzpOrder, key_id}`) rather than a normalized `{orderId, gateway, checkoutParams}` contract
- Auth: no `/api/auth/me` endpoint (identity is server-rendered into `res.locals.currentUser`)

### Security hooks every SPA call must respect
1. Session is cookie-based (`express-session`, `httpOnly`) — SPA can keep same-origin cookies, **but there is no CSRF token today**; migration must introduce per-request CSRF/custom-header verification for non-GET.
2. `attachUser` runs before routes — `req.user` is available; an SPA needs the same hydrated user via `/api/auth/me` (or a meta tag), not template injection.
3. Socket.IO (`socket/index.js`) has **no auth** on connection — vendor realtime must authenticate the socket in the React app (and fix in server before cutover).

---

## 3. EJS Dependency Map

### 3.1 Template tree (45 files, ~6,100 lines)

```
layout roots (no shared base — every page repeats shell)
├── partials/header.ejs          nav, firebase config embed, flash banner      (used by 33 pages)
├── partials/footer.ejs          SW registration, update-banner, socket.io?s   (33 pages)
├── partials/vendor-nav.ejs      vendor sub-nav                                 (vendor pages)
├── partials/menu-table.ejs      student menu render + client menu interactions (733 lines — 91 EJS tags)
├── partials/menu-manager.ejs    vendor/admin menu CRUD forms + JS               (447 lines)
├── partials/update-banner.ejs   PWA update prompt
├── partials/page-background.ejs decorative
└── admin shells:
    ├── partials/layout-start.ejs + partials/layout-end.ejs  (mtx — 17 admin pages)
    ├── partials/sidebar.ejs
    └── (admin pages ALSO include ../../partials/footer)

Leaf views
├── auth/ signup, login, forgot-password, reset-password
├── home.ejs, shops/index, shops/menu
├── cart/index (483), orders/index, orders/show (132)
├── profile/index
├── vendor/ menu, pending-orders (757), verify, adjust-order (146), completed-orders,
│             order-details (161), payment-settings (160)
└── admin/ dashboard (85), shops/{index,form,show,payment-settings},
             vendors/{index,form,show,menu,menu-import,menu-import-preview(644)},
             students/{index,show}, orders/{index,show}, menus/index, analytics (535)
```

### 3.2 Global `res.locals` injected by server.js middleware (contract the SPA must replace)

| Locals | Consumer views | Notes |
|---|---|---|
| `currentUser {id,role,name,phone}` | header, home, profile, menu-table | nav identity + role gating |
| `cartCount` | header | cart badge |
| `flash {success,error}` | header, auth pages, payment-setting pages | session flash → must become toast/query API errors |
| `vendorShop {name,slug}` | vendor-nav, pending-orders | per-request `Shop.findById` |
| `env {RAZORPAY_KEY_ID}` | cart (Razorpay checkout) | gateway public key |
| `firebaseConfig` | header → `window.__FIREBASE_CONFIG__` → `firebase-client.js` | FCM web push |
| `appVersion` | (unused in views — feed to SW only) | |
| `formatPickupTime`, `formatLocalDateTime`, `getPickupUrgency` | orders/*, vendor/* | **server-shipped formatting; must move client-side (same functions)** |

### 3.3 Client-side assets today

| Asset | Used by | Role after migration |
|---|---|---|
| `https://checkout.razorpay.com/v1/checkout.js` | cart/index | keep (gateway SDK, iframe-based — works beside React) |
| `https://cdn.jsdelivr.net/npm/chart.js@4.4.0` | admin/analytics | could stay or move to React wrapper |
| `/socket.io/socket.io.js` | pending-orders, order status | keep; wire to React via same library |
| `/js/firebase/*-compat.js` + `/js/firebase-client.js` | header (vendor) | keep as-is or wrap in React effect |
| `/js/notification-manager.js` (Class) | pending-orders | extract to a plain module — ideal React refactor |
| `/js/update-manager.js` (Class) | footer → update-banner | keep (PWA) or wrap in React |
| `/js/menu-table.js` | menu-table partial | port to React component state |
| `/sw.js`, `/firebase-messaging-sw.js` | global | keep (must URL presilience `/socket.io`, `/version.json`) |
| `/audio/ringing_sound.mp3` | notification-manager | static asset, keep |

### 3.4 Dependency risk notes
- **HTML-served init state:** views embed Razorpay key, Firebase config, order OTP, shop totals, and JSON `window.__FIREBASE_CONFIG__` directly into the DOM. React must NOT rely on that; replace with API calls + a single bootstrap meta.
- **PWA/SW precaches page HTML** (`sw.js` caches fetch-through). A React SPA changes the precache set and navigation strategy (SPA needs `navigateFallback` → `/index.html`); the "offline/cache-first HTML" pattern must be reworked.

---

## 4. Business Logic Mixed Into Views (migration hot-spots)

| View | Lines | Logic embedded | Migration impact |
|---|---|---|---|
| `views/vendor/pending-orders.ejs` | 757 total, `<script>` 345–744 | full real-time client: `socket "vendor:join"`, 5s `pending.json` polling, new-order sound (`NotificationManager`), accept/ready/cancel fetches, OTP verify modal, parcel toggle, reminder mark, urgency formatting (`getPickupUrgency`) | Highest-complexity page — becomes a Zustand/React Query screen |
| `views/partials/menu-table.ejs` | 733 | multi-variant price matrix, veg/non-veg filters, search, add-to-cart POST forms, student-vs-guest branches, `menu-table.js` coupling | Becomes `MenuGrid` + `MenuItemRow`; the variant-price resolution is **duplicated in routes** (cart.js/orders.js/vendor.js) — extract once to a shared selector |
| `views/admin/vendors/menu-import-preview.ejs` | 644 | preview-table JS: parse/recover AI JSON client-side fallback, per-row edit, confirm POST from client state, `menu-table` review mode | Confirm must be rebuilt around the server vetted items (see security gaps) |
| `views/admin/analytics.ejs` | 535 | Chart.js orchestration, 7+ series, date/shop filter query params → `/admin/analytics/data` | Cleanest page to port (pure data → chart), best "pilot" candidate |
| `views/cart/index.ejs` | 483 | pickup-time generation (5–120min), order-type/parcel display math, variant live pricing via `/cart/variant`, gateway button switch + Razorpay checkout object, `allVariantsSelected` gating | Becomes `CheckoutCart`; pickup-time logic moves to util |
| `views/partials/menu-manager.ejs` | 447 | vendor & ADMIN menu CRUD forms, images, `data-delete-item` fetch+confirm, toggle | Becomes `MenuManager` shared by vendor + admin |
| `views/orders/show.ejs` | 132 | progress-tracker stepIndex math, adjust/refund display, **5s status polling + full page reload** | Becomes `OrderDetail` with live status atom |
| `views/admin/shops/payment-settings.ejs` | 163+ | per-gateway credential forms (razorpay/easebuzz/phonepe), env toggles | Straightforward form components |
| `views/partials/header.ejs` | 111 | role-based nav, cart count, flash chips, firebase config embed | Becomes layout + `<AppHeader>`; flash → query client |
| Non-trivial EJS-side computation (move to JS utilities) | — | status label/step mapping in `orders/show.ejs:9-17`; money formatting `Number(x).toFixed(2)` everywhere; `new Date(...).toLocaleString("en-IN",{timeZone})` formatting | All must become shared `format.ts` utilities |

**Pattern summary:** business decisions (status-state labels, parcel math, variant pricing, pickup-time windows, refund/OTP display rules) are evaluated inside templates and inline `<script>` blocks. A React migration cannot "lift screens" 1:1; it moves this logic into typed TS utilities + server actions, or the duplication that already exists between `routes/cart.js`/`routes/orders.js`/`routes/vendor.js` will triple.

---

## 5. Recommended Migration Order (ranked by risk)

Ranking = (blast radius of breakage) × (complexity) × (realtime/money coupling). Migration should be **progressive per vertical slice**, not big-bang.

| Phase | Slice | Pages | Risk | Why (and what to fix first server-side) |
|---|---|---|---|---|
| **0. Prereq (server work, not UI)** | API layer + auth | all | — | Build the contracts in §7: JSON endpoints for every mutation, `/api/auth/me`, CSRF verification, socket auth. **Zero UI migration before this.** Highest leverage, lowest UI risk. |
| **1. Landing/auth pages** | `home`, `signup`, `login`, `forgot`, `reset` | 5 | Low | No money, no realtime. Replace form-POST with JSON. Also catches auth/session problems deterministically. |
| **2. Read-only catalog** | `shops/index`, `shops/menu` (display), `orders/index` | 3 | Low | Pure data. Strips menu-table JS dependencies. |
| **3. Analytics (admin)** | `admin/analytics` + `/data` | 1 | Low–Med | Already 100% JSON-backed; proves the "server render → client render" pattern for admin shell early. |
| **4. Profile & order detail** | `profile`, `orders/show` (+ its polling) | 2 | Medium | Order-detail polling + statuses touch order state but hidden from money path. |
| **5. Cart & checkout flow** | `cart/index`, gateway buttons, verify-payment | 2 | **High** | Money path. Razorpay iframe + `verify-payment` + amount integrity. Do ONLY after §7 contracts + security fixes (CSRF, amount check). |
| **6. Vendor menu & settings** | `vendor/menu`, payment-settings, completed-orders, order-details | 4 | Medium | Touches payment creds display; keep menu CRUD JSON-first. |
| **7. Vendor real-time orders** | `pending-orders`, `verify` (OTP), `adjust-order`, accept/ready/cancel | 4 | **Highest** | 757-line page + socket + polling + refunds + OTP. Last UI slice so all server endpoints are stable; congruent with the security fixes (atomic transitions, OTP expiry/rate-limit). |
| **8. Admin full console** | shops/vendors/students/orders/menus CRUD + import | 13 | Medium high | Domain breadth but no gateways; menu-import confirm must be rewritten around server-vetted data first. |
| **9. Decommission EJS** | delete views, template middlewares, `sw.js` HTML precache | — | Low | Only after all slices cutover; switch SW to SPA navigation fallback. |

**Ranking rationale:** phases 1–3 produce visible progress with near-zero money/realtime exposure; phase 5 (checkout) is deliberately delayed until §7 security items are closed; phase 7 is last because it is the only page that exercises socket + polling + refunds + OTP simultaneously, and those four server behaviors are the ones with known bugs (non-atomic transitions, OTP/refund gaps).

---

## 6. React Component Hierarchy Proposal

### 6.1 App topology — three co-located SPAs behind one server

Because the three roles share nothing structurally (shells, nav, data), use **one React repo, three mounts** (route-grouped) served by the same Express app under `/app/*`:

```
FlashFoods SPA (React + TS + Vite)
├── apps/
│   ├── student/            ← mounts at /app        (home, catalog, cart, orders, profile, auth)
│   ├── vendor/             ← mounts at /vendor     (console shell)
│   └── admin/              ← mounts at /admin      (console shell)
└── packages/
    ├── ui/                 shared components (Button, Card, Tag, Stepper, Money, StatusBadge…)
    ├── api/                typed clients + react-query hooks per domain
    ├── realtime/           socket.io wrapper (authenticated), usePendingOrders, useOrderStatus
    ├── auth/               session context, route guards, CSRF requester
    └── utils/              format.ts (money, pickup time, INR locale), otp, parcel math, state-machine labels
```

Rationale: preserves current URL semantics (`/vendor/orders/pending` etc.), keeps gateway callbacks server-side, avoids one giant app with three conflicting nav systems.

### 6.2 Student app

```
<AppRouter>
├── <PublicOnly>  AuthRoutes: /login, /signup, /forgot-password, /reset-password/:token
├── <AuthedGuard role="student">  Shell
│   ├── <AppHeader cartCount />  HomeLayout
│   ├── /                     <HomePage>
│   ├── /shops                <ShopsIndex> → <ShopCardList>
│   ├── /shops/:slug          <ShopMenuPage>
│   │                          ├── <MenuGrid> → <MenuRow> (variant select, add-to-cart)
│   │                          └── <CartToast> (uses useCart)
│   ├── /cart                 <CartPage>
│   │                          ├── <CartLineList> <ParcelToggle> <PickupTimePicker>
│   │                          └── <CheckoutGatewaySwitch> → <RazorpayCheckout|Easebuzz|PhonePe>
│   ├── /orders               <OrdersIndex> <OrderCard>
│   ├── /orders/:id           <OrderDetail> → <ProgressTracker> <PickupCode> <AdjustNotice> (useOrderStatus)
│   └── /profile              <ProfilePage> <PhoneForm>
└── <CartProvider (session-based, synced via /cart/*)>
```

### 6.3 Vendor console

```
<AuthedGuard role="vendor">
├── <VendorShell>  <VendorNav/>  layout
│   ├── /vendor/orders/pending     <PendingOrders>            ← realtime
│   │                                ├── <PendingOrderCard> (accept/ready/cancel/parcel)
│   │                                └── <NotificationSound>  (wraps NotificationManager→module)
│   ├── /vendor/verify             <VerifyPickup>  <OtpKeypad>  (uses /vendor/verify)
│   ├── /vendor/orders/completed   <CompletedOrdersList> (pagination)
│   ├── /vendor/orders/:id         <OrderDetails> <AdjustPanel> (refund math)
│   ├── /vendor/menu               <VendorMenu>   → <MenuManager shared>
│   └── /vendor/payment/settings   <PaymentSettingsFormByGateway>
│ └── <usePendingOrders hook>  (socket "pending-count" + pending.json polling)  shared by pending/verify
```

### 6.4 Admin console

```
<AuthedGuard role="admin">
├── <AdminShell>  <AdminSidebar/> <ChartKit/> (reuse admin/analytics charts)
│   ├── /admin/            <DashboardPage> (useAnalyticsData)
│   ├── /admin/analytics   <AnalyticsPage> (+ filters as URLSearchParams state)
│   ├── /admin/shops/*     <ShopList><ShopForm><ShopShow><PaymentSettingsForm>
│   ├── /admin/vendors/*   <VendorList><VendorForm><VendorShow>
│   │                       └── /menu/import → <MenuImportUpload><MenuImportPreview>(row-edit)<Confirm>
│   ├── /admin/menus        <MenusIndex>
│   ├── /admin/students/*   <StudentList><StudentShow>
│   └── /admin/orders/*     <OrderSearch><OrderRow><OrderShow><ParcelToggle>
└── └── shared with vendor: <MenuManager>, <Money/>, status label utils, tables
```

### 6.5 Cross-cutting
- **Server state:** TanStack Query (React Query) with `useMutation` for every action; no ad-hoc `fetch` in components.
- **Client state:** minimal Zustand store for cart badge + notification state; everything else fetched.
- **Routing:** React Router v7 data router (per-app), matching current paths exactly.
- **Auth:** `AuthProvider` hydrating `/api/auth/me`; `RequireRole` guards mirror `requireVendorShop`/`requireAdmin`; 401 → bounce to `/login`.
- **Realtime:** `socket.io-client` authenticated via cookie + server check; events (`pending-count`, rooms `shop:<id>`) become a `useSocket` hook.
- **The middleware `res.locals` contract becomes an API:** format helpers imported from `utils/format.ts`, `currentUser` from `useAuth`, `env.RAZORPAY_KEY_ID` from `/api/bootstrap`.

---

## 7. API Contracts Required BEFORE React Migration

### 7.0 Cross-cutting requirements (every endpoint)
- **Auth:** cookie session + CSRF. Add a per-session CSRF token endpoint/header; SPA sends it on non-GET (or `SameSite=Lax` + custom header). Socket handshake must authenticate.
- **Error shape:** unify to `{ error: string, code?: string, field?: string }` with proper HTTP statuses (today: mixed 302+flash strings and 4xx/5xx).
- **Money:** all amounts as integer paise (`amountPaise`) in API payloads; format client-side. (Today: floats in `total`, `parcelCharge`, `refundAmount`.)
- **Pagination:** add `{ page, limit, total, items }` to list endpoints (vendor completed, admin lists, search).
- **Idempotency headers** on all money mutations (order creation, verify, cancel, adjust).

### 7.1 Auth
```
POST /api/auth/signup        req {name,email,password,phone?}  → 200 {user} | 4xx {error}
POST /api/auth/login         req {email,password}              → 200 {user} | 401 {error}
POST /api/auth/logout                                          → 204
GET  /api/auth/me            (A)                                → 200 {user:{id,role,name,phone,shop?}} (no session cookie → 401)
POST /api/auth/forgot        req {email}                        → 202 (always; no user enumeration)
POST /api/auth/reset         req {token,password}               → 200 | 400 {error}
```
`user.shop` must carry the vendor's shop `{id,name,slug}` (replaces server-side `res.locals.vendorShop` lookup).

### 7.2 Catalog
```
GET /api/shops               → [{id,name,slug,description,image,isOpen,parcelChargeEnabled,parcelCharge,paymentGateway}]
GET /api/shops/:slug         → {shop, menuItems:[{id,name,category,description,price,image,available,foodType,variants:[{label,price}]}]}
PATCH /api/menu/:id/toggle   (V)  → {item} | 403/404 {error}
```

### 7.3 Cart (session-backed — must expose DTO of session cart)
```
GET    /api/cart            (S) → {shopId, items:[{menuItemId,name,price,quantity,variantId,variantName,variantPrice}], subtotal, parcelCharge, total}
POST   /api/cart/add        (S) req {menuItemId, quantity?, variantId?} → 200 {cart}
POST   /api/cart/variant    (S) req {menuItemId, variantId}             → 200 {cart, allVariantsSelected}
PATCH  /api/cart/line       (S) req {menuItemId, quantity}              → 200 {cart}
DELETE /api/cart            (S)                                         → 200 {cart:empty}
```

### 7.4 Checkout / Payment (per gateway — SPA only never handles callbacks)
```
POST /api/orders/checkout            (S) req {orderType, pickupTime}              → 200 {orderId, gateway, status:"pending_payment", totalAmountPaise}
POST /api/orders/:id/payment/razorpay (S)                                         → 200 {orderId, rzpOrderId, amountPaise, keyId}   (idempotent-created lazily)
POST /api/orders/:id/verify-payment   (S) req {razorpay_order_id, razorpay_payment_id, signature} → 200 {status:"paid", orderId} | 4xx
POST /api/orders/:id/payment/easebuzz (S) → 200 {redirectUrl}
POST /api/orders/:id/payment/phonepe  (S) → 200 {redirectUrl}
POST /api/orders/:id/confirm-from-callback (S) — internal confirmation for easebuzz/phonepe fallback (amount re-check server-side)
```
**Server-side obligations before cutover (§5 phase 5):** timing-safe signature compare, amount==`order.total` check, atomic `findOneAndUpdate` transition, webhook reconciliation that a client can query (`GET /api/orders/:id` returns `paymentStatus`, `razorpay*` refs).

### 7.5 Orders
```
GET  /api/orders             (S) → [order summaries (paginated)]
GET  /api/orders/:id         (S) → {id, shortId, status, orderType, totalAmountPaise, parcelChargePaise, pickupOtp? (only when ready_for_pickup or completed), pickupTime, items[{name,quantity,pricePaise,variantName,status}], refundAmountPaise, refundStatus, adjustmentReason, createdAt, shop:{name,slug}}
GET  /api/orders/:id/status  (S) → {status, adjusted, refundStatus}   (replaces 5s-poll-then-reload)
POST /api/orders/:id/cancel  (S, student? currently vendor-only) — add if product wants self-cancel; else exclude
```

### 7.6 Vendor console
```
GET    /api/vendor/orders/pending        (VS) → [order slots: {id, shortId, customerName, phone, orderType, status, totalAmountPaise, items, pickupTimeISO, pickupOtp?, pickupReminderSent, urgency}]
POST   /api/vendor/orders/:id/accept     (VS) → 200 {order}   (atomic; 409 on lost race)
POST   /api/vendor/orders/:id/ready      (VS) → 200 {order}   (atomic)
POST   /api/vendor/orders/:id/cancel     (VS) → 200 {order, refundStatus} | 4xx {error}
POST   /api/vendor/verify                (VS) req {orderId, otp} → 200 {completed} | 400/404/429
POST   /api/vendor/orders/:id/adjust     (VS) req {keepItemIds[], reason} → 200 {order, refundAmountPaise, refundStatus}
POST   /api/vendor/orders/:id/parcel     (VS) req {enabled} → 200 {order}
POST   /api/vendor/orders/:id/mark-reminder (VS) → 204
GET    /api/vendor/orders/completed      (VS) → paginated [order summaries]  (fix the current cap-50)
GET    /api/vendor/menu                  (VS) → [items]
POST   /api/vendor/menu                  (VS) multipart → 201 {item}  (validate image types server-side)
PATCH  /api/vendor/menu/:id              (VS) → 200 {item}
DELETE /api/vendor/menu/:id              (VS) → 204
POST   /api/vendor/shop/toggle           (VS) → 200 {shop}
POST   /api/vendor/menu/parcel-charge    (VS) req {amountPaise} → 200 {shop}  (with a sanity cap)
GET    /api/vendor/payment/settings      (VS) → {gateway, paymentConfigured, env, masked keys — NEVER full secrets back to UI}
POST   /api/vendor/payment/settings      (VS) req {gateway creds} → 200  (store encrypted)
Socket GET  /socket.io?shopId=... authenticated; emits `pending-count` and new-order events into `shop:<id>`.
```

### 7.7 Admin console
```
GET    /api/admin/dashboard           (ADM) → KPIs incl. corrected totalOrders (today's value is wrong — fix before API contracts)
GET    /api/admin/shops[?search]      (ADM) → paginated [{..., orderCounts}]
POST/PATCH/DELETE …/shops/:id         (ADM) → 200 {shop}   (DELETE must be archivable, not DB-delete)
GET/PUT /api/admin/shops/:id/payment-settings (ADM) → masked/update (same encryption req as vendor)
GET    /api/admin/vendors             (ADM) → paginated [{vendor, shop, counts}]
POST   /api/admin/vendors             (ADM) req {name,email,password (min length),shop?} → 201
PATCH  /api/admin/vendors/:id         (ADM) → 200
POST   /api/admin/vendors/:id/toggle  / DELETE → 200/204
GET    /api/admin/students            (ADM) → paginated [{student, orderStats}]
POST   /api/admin/students/:id/toggle (ADM)
GET    /api/admin/orders[?search&status&page] (ADM) → paginated (must lose the unbounded $lookup or paginate it)
GET    /api/admin/orders/:id          (ADM) → full order
POST   /api/admin/orders/:id/parcel   (ADM) → {order} (recompute from items, not float-delta)
GET    /api/admin/menus               (ADM) → per-vendor menu summary
Menu import: 
  POST /api/admin/vendors/:id/menu/import              (ADM) multipart → 200 {importId, previewItems[]} (session held server-side)
  POST /api/admin/vendors/:id/menu/import/:importId/confirm (ADM) req {} → 201 {insertedCount}
        (confirm MUST be sourced from server-vetted importId state, NOT req.body — closing the current validation-bypass)
GET    /api/admin/analytics/data      (ADM) → existing payload + pagination + caching actually implemented
```

### 7.8 FCM
```
POST /api/fcm/register   (V) req {token, deviceInfo} → 200  (fix upsert to key on {token, vendorId: me})
POST /api/fcm/unregister (V) req {token}             → 204
```

---

## Summary

- **~95 routes, only ~16 JSON endpoints today** → the migration is primarily a **server-to-API-conversion**, then a UI swap. Plan ~50–60% of effort in §7 shapes, not components.
- **Biggest single fork in the road:** every screen that now reads `req.user`, flash, formatted money, and `window.__APP_CONFIG__` must be re-sourced from typed APIs; the server-side formatters (`utils/time.js`) and price logic (`utils/pricing.js`, `orders.js:60-99`) should move verbatim into `packages/utils`.
- **Do not start UI before** CSRF, `/api/auth/me`, bool-safe atomic order transitions, and the corrected dashboard/cart/catalog contracts — those four are §7.0 + the four flagged security fixes, and every migration wave depends on them.
- **Lowest-risk first slice:** auth pages → catalog → analytics. **Last slice:** vendor real-time console. This matches ranked risk most accurately.