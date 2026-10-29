# FlashFoods — Migration Assessment (React + V2)

**Status: historical planning document.** No React/Vite migration was executed. This merges the
two overlapping planning reports that used to live in `md/`:

- `REACT_MIGRATION_REPORT.md` — architecture/API/component plan for a React migration.
- `ROUTE_MIGRATION_REPORT.md` — route-by-route V2 classification and minimum launch surface.

**Merged 2026-10-29.** Where the two reports duplicated each other (route inventory, migration
ordering, security prerequisites), the merged text keeps one copy. Handler line numbers from the
originals were dropped because they had already drifted; use `routes/` as the source of truth.

> **Read the "What has changed since" section at the end before acting on any task list here.**
> Several prerequisites listed as missing are now implemented.

---

## 1. Shared conclusions

- The app has **~95 routed handlers across 10 modules**, but only ~16 return JSON; the rest render
  EJS or redirect with flash. A React migration is therefore **60 % server/API work, 40 % UI**.
- Three role surfaces share almost nothing structurally: student pages, vendor console, admin
  console. Recommended shape: one React repo, three route-grouped mounts behind the same Express
  server, keeping current URL semantics.
- The money/auth server work (formerly "Stage 0") must land **before** any screen moves; the
  vendor realtime console is the last slice because it combines socket, polling, refunds and OTP.
- Gateway callbacks, `/sw.js`, `/firebase-messaging-sw.js` and `/version.json` stay server-side.

---

## 2. Route registry and V2 classification

Legend — response: **R** render EJS, **J** JSON, **→** redirect+flash, **G** gateway callback.
Guards: `DB` requireDb, `A` requireAuth, `S/V/ADM` role, `VS` requireVendorShop.
V2 class: `API_READY` (usable as-is), `PARTIAL_API` (JSON on some paths), `REQUIRES_API`
(EJS/redirect only), `LEGACY_KEEP` (stays server-side), `DELETE` (mock-only).

### Auth — `routes/auth.js` (mounted at `/`)
- `GET /signup` R REQUIRES_API · `POST /signup` → (creates student only) PARTIAL_API
- `GET /login` R REQUIRES_API · `POST /login` → PARTIAL_API
- `GET /forgot-password` R REQUIRES_API · `POST /forgot-password` → PARTIAL_API
- `GET /reset-password/:token` R REQUIRES_API · `POST /reset-password/:token` → PARTIAL_API
- `POST /logout` → API_READY (trivial session destroy)

### Catalog — `routes/shops.js`, `routes/menu.js`
- `GET /shops` R PARTIAL_API · `GET /shops/:slug` R REQUIRES_API
- `PATCH /menu/:id/toggle` DB,A,V,VS J API_READY

### Cart — `routes/cart.js`
- `GET /cart` R REQUIRES_API
- `POST /cart/add` → PARTIAL_API · `POST /cart/line` → PARTIAL_API
- `POST /cart/variant` J API_READY · `POST /cart/clear` → REQUIRES_API (JSON-only needed)

### Orders & payments — `routes/orders.js`, `routes/webhooks.js`
- `POST /create-razorpay-order` J PARTIAL_API (returns raw gateway object; normalize)
- `POST /verify-payment` J PARTIAL_API (was insecure; see §7.0)
- `POST /easebuzz/initiate` J API_READY · `POST /phonepe/initiate` J API_READY
- `POST /easebuzz/callback`, `ALL /phonepe/callback` G LEGACY_KEEP
- `POST /webhooks/razorpay` G LEGACY_KEEP (raw body, DB)
- `POST /orders/checkout` → DELETE for V2 (mock checkout; hard-blocked outside slug `testing`)
- `GET /orders` R REQUIRES_API · `GET /orders/:id` R REQUIRES_API
- `GET /api/orders/:id/status` J API_READY

### Profile — `routes/profile.js`
- `GET /profile` R REQUIRES_API · `POST /profile/phone` J API_READY

### Vendor console — `routes/vendor.js` (all DB,A,V; menu/orders + VS)
- `GET /vendor/menu` R REQUIRES_API · `POST /vendor/menu` → REQUIRES_API (multipart)
- `PATCH /vendor/menu/:id` J API_READY · `DELETE /vendor/menu/:id` J API_READY
- `POST /vendor/menu/parcel-charge` → REQUIRES_API
- `POST /vendor/shop/toggle` → REQUIRES_API
- `GET /vendor/orders/pending` R REQUIRES_API · `GET /vendor/orders/pending.json` J API_READY
- `POST /vendor/orders/:id/mark-reminder-sent` J API_READY
- `POST /vendor/orders/:id/accept|ready|cancel` → REQUIRES_API (must become JSON)
- `GET /vendor/verify` R REQUIRES_API · `POST /vendor/verify` →/J PARTIAL_API (normalize)
- `POST /vendor/orders/:id/toggle-parcel` J PARTIAL_API (now recomputed atomically)
- `GET /vendor/orders/:id/adjust` R REQUIRES_API · `POST /vendor/orders/:id/adjust` → REQUIRES_API
- `GET /vendor/orders/completed` R REQUIRES_API (+ pagination; cap 50)
- `GET /vendor/orders/:id` R REQUIRES_API
- `GET /vendor/payment/settings` R REQUIRES_API (mask secrets) · `POST /vendor/payment/settings` → REQUIRES_API

### Admin console — `routes/admin.js` (mounted `/admin`, all DB,A,ADM)
- `GET /admin/` dashboard R REQUIRES_API (totalOrders metric was completed-only)
- `GET /admin/shops`, `/shops/new`, `/shops/:id`, `/shops/:id/edit` R REQUIRES_API
- `POST /admin/shops`, `/shops/:id/edit`, `/shops/:id/toggle` → REQUIRES_API
- `POST /admin/shops/:id/delete` → REQUIRES_API (should become archive/soft-delete)
- `GET/POST /admin/shops/:id/payment-settings` R/→ REQUIRES_API
- `GET /admin/vendors`, `/new`, `/:id`, `/:id/edit` R REQUIRES_API
- `POST /admin/vendors`, `/:id/edit`, `/:id/toggle`, `/:id/delete` → REQUIRES_API
- `GET /admin/students`, `/:id` R REQUIRES_API · `POST /admin/students/:id/toggle` → REQUIRES_API
- `GET /admin/orders`, `/:id` R REQUIRES_API · `POST /admin/orders/:id/toggle-parcel` → REQUIRES_API
- `GET /admin/menus` R REQUIRES_API
- `GET /admin/vendors/:vendorId/menu` R REQUIRES_API
- `POST /admin/vendors/:vendorId/menu` → REQUIRES_API
- `PATCH|DELETE /admin/vendors/:vendorId/menu/:id` J API_READY
- `PATCH /admin/vendors/:vendorId/menu/:id/toggle` J API_READY
- `POST /admin/vendors/:vendorId/shop/toggle`, `/parcel-charge` → REQUIRES_API
- `GET/POST /admin/vendors/:vendorId/menu/import` R/→ REQUIRES_API (session-ware pipeline)
- `POST /admin/vendors/:vendorId/menu/import/confirm` → REQUIRES_API (must write server-vetted state, not `req.body`)
- `GET /admin/analytics` R REQUIRES_API · `GET /admin/analytics/data` J API_READY

### Device / push — `routes/api/fcm.js` (mounted `/api/fcm`)
- `POST /api/fcm/register` J PARTIAL_API (token scope was hijackable; fixed since)
- `POST /api/fcm/unregister` J API_READY

### Server-level — `server.js`
- `GET /` R REQUIRES_API
- `GET /sw.js`, `GET /firebase-messaging-sw.js` LEGACY_KEEP (env-injected)
- `GET /version.json` API_READY (PWA update check)

### Handoff counts (from the route report)
| | Count |
|---|---|
| Total routed handlers | ~95 |
| Minimum V2 surface | ~28 core resources |
| Already JSON | ~17 (+5 after hardening) |
| EJS→API conversions | ~35 (collapse to ~8 resource pairs) |
| Must stay server-side | 3 callbacks + webhook + 2 service workers |
| Safe to delete | 1 (`POST /orders/checkout`, mock-only) |

---

## 3. Minimum V2 surface (Section A of the route report)

**Auth/public (7):** `POST /signup`, `POST /login`, `POST /forgot-password`,
`POST /reset-password/:token`, `POST /logout`, `GET /` (home), `GET /api/auth/me` (now exists).

**Catalog (3):** `GET /shops`, `GET /shops/:slug`, `PATCH /menu/:id/toggle`.

**Cart (3):** `GET /cart`, `POST /cart/add`, `POST /cart/variant` (`line`/`clear` fold in or stay).

**Orders/payments (6):** `POST /create-razorpay-order`, `POST /verify-payment`,
`POST /easebuzz/initiate`, `POST /phonepe/initiate`, `GET /orders`, `GET /orders/:id`
(+ existing status JSON).

**Student extras (2):** `GET /profile`, `POST /profile/phone`.

**Vendor (8):** `pending.json` feed, accept, ready, cancel, `POST /vendor/verify`,
`GET /vendor/orders/completed`, `GET /vendor/menu` + CRUD, `GET/POST /vendor/payment/settings`.

**Admin core (7):** `GET /admin/analytics/data`, dashboard, shops/vendors/students lists,
order search, order detail, menu management.

> These 28 resources are the only controllers V2 needs; everything else is fan-out.

### Already JSON and reusable (Section B)
`PATCH /menu/:id/toggle` · `POST /cart/variant` · `POST /easebuzz/initiate` ·
`POST /phonepe/initiate` · `GET /api/orders/:id/status` · `POST /profile/phone` ·
`PATCH|DELETE /vendor/menu/:id` · `GET /vendor/orders/pending.json` ·
`POST /vendor/orders/:id/mark-reminder-sent` · vendor/admin menu patch/delete/toggle ·
`GET /admin/analytics/data` · `POST /api/fcm/unregister` · `GET /version.json`.

Reusable **after small hardening**: `verify-payment` (timing-safe + amount + atomic — now done),
`create-razorpay-order` (normalized contract), vendor `toggle-parcel` (recompute — now done),
`vendor/verify` (drop HTML branch, OTP limits), `fcm/register` (owner scoping — now done).

### EJS renders needing conversion (Section C)
Auth pages; student home/cart/orders/order detail/profile; vendor menu, pending, verify, adjust,
completed, order detail, payment settings; 17 admin renders (collapse `/new` and `/:id/edit` into
one resource contract).

### Deletes, merges, legacy keeps (Section D)
- **Delete:** `POST /orders/checkout` (mock/QA only).
- **Keep experimental, out of V2 path:** mock payment copy in `cart/index.ejs`, the
  `gemini-flash`/`gemini-lite` discrepancy in `menu-import/debug.js`.
- **Merge, not delete:** admin `/new` + `/edit` forms per resource.
- **Consolidate duplicated logic:** menu CRUD (vendor/admin), variant-price resolution
  (cart/orders/vendor), parcel toggle (vendor/admin).
- **Legacy keep:** gateway callbacks, Razorpay webhook, both service workers, menu-import as an
  admin sub-flow.

---

## 4. React target architecture

### 4.1 Topology (three mounts, one server)
```
apps/student   → /app        (home, catalog, cart, orders, profile, auth)
apps/vendor    → /vendor     (console shell)   [URLs preserved]
apps/admin     → /admin      (console shell)
packages/ui         shared Button/Card/Tag/Stepper/Money/StatusBadge
packages/api        typed clients + React Query hooks
packages/realtime   authenticated socket.io client, usePendingOrders/useOrderStatus
packages/auth       session context, role guards, CSRF/requester
packages/utils      money, pickup-time and INR formatting, parcel math, state labels
```

### 4.2 Student tree
`/login|/signup|/forgot|/reset` → `<HomePage>` → `<ShopsIndex>/<ShopCardList>` →
`<ShopMenuPage>` (`<MenuGrid>` + `<MenuRow>`, variant select, add-to-cart, `<CartToast>`) →
`<CartPage>` (`<CartLineList>`, `<ParcelToggle>`, `<PickupTimePicker>`,
`<CheckoutGatewaySwitch>` → Razorpay/Easebuzz/PhonePe) → `<OrdersIndex>/<OrderCard>` →
`<OrderDetail>` (`<ProgressTracker>`, `<PickupCode>`, `<AdjustNotice>`, polling) →
`<ProfilePage>/<PhoneForm>`. Shared `<CartProvider>` synced via `/cart/*`.

### 4.3 Vendor tree
Shell + nav → `/vendor/orders/pending` `<PendingOrders>` (`<PendingOrderCard>`,
`<NotificationSound>`) → `/vendor/verify` (`<OtpKeypad>`) → `/vendor/orders/completed`
(pagination) → `/vendor/orders/:id` (`<AdjustPanel>`) → `/vendor/menu` (`<MenuManager>` shared
with admin) → `/vendor/payment/settings` (per-gateway form). Realtime via `usePendingOrders`
(socket `pending-count` + `pending.json` polling).

### 4.4 Admin tree
Shell + sidebar + chart kit → dashboard, analytics (URL-search-param filters), shops/vendors/
students CRUD (collapse `new`/`edit`), orders search/detail/parcel, menus, vendor menu + import
(upload → preview row-edit → confirm).

### 4.5 Cross-cutting
React Query for server state, minimal Zustand for cart badge/notification state, React Router v7
matching current paths, `AuthProvider` fed by `/api/auth/me`, authenticated socket handshake,
`utils/time.js`/`utils/pricing.js` logic moved to `packages/utils` verbatim.

---

## 5. API contracts required before migration

### 5.0 Cross-cutting
- Cookie session + CSRF protection for non-GET (origin check or double-submit token); authenticated
  socket handshake.
- Error envelope `{error, code?, field?}` with real HTTP statuses; legacy flash routes may keep
  redirects.
- Money as integer paise (`amountPaise`); format client-side.
- Pagination `{page, limit, total, items}` on list endpoints.
- Idempotency headers on money mutations.

### 5.1 Auth
```
POST /api/auth/signup {name,email,password,phone} → 200 {user} | 4xx
POST /api/auth/login {email,password}            → 200 {user} | 401
POST /api/auth/logout                            → 204
GET  /api/auth/me (A)                            → 200 {user:{id,role,name,phone,shop?}} | 401
POST /api/auth/forgot {email}                    → 202 (no user enumeration)
POST /api/auth/reset {token,password}            → 200 | 400
```

### 5.2 Catalog
```
GET  /api/shops          → [{id,name,slug,description,image,isOpen,parcelChargeEnabled,parcelCharge,paymentGateway}]
GET  /api/shops/:slug    → {shop, menuItems:[{id,name,category,description,price,image,available,foodType,variants}]}
PATCH /api/menu/:id/toggle (V) → {item}
```

### 5.3 Cart (session-backed)
```
GET    /api/cart        (S) → {shopId, items[], subtotal, parcelCharge, total}
POST   /api/cart/add    (S) {menuItemId, quantity?, variantId?} → {cart}
POST   /api/cart/variant(S) {menuItemId, variantId} → {cart, allVariantsSelected}
PATCH  /api/cart/line   (S) {menuItemId, quantity} → {cart}
DELETE /api/cart        (S) → {cart:empty}
```

### 5.4 Checkout / payments (SPA never handles callbacks)
```
POST /api/orders/checkout             (S) {orderType, pickupTime} → {orderId, gateway, status, totalAmountPaise}
POST /api/orders/:id/payment/razorpay (S) → {orderId, rzpOrderId, amountPaise, keyId}
POST /api/orders/:id/verify-payment   (S) {razorpay_order_id, razorpay_payment_id, signature} → {status:"paid"}
POST /api/orders/:id/payment/easebuzz (S) → {redirectUrl}
POST /api/orders/:id/payment/phonepe  (S) → {redirectUrl}
```
Server obligations: timing-safe signature, captured amount == order total, atomic + idempotent
transition, queryable payment status. *(Signature/amount/atomic work is implemented; see §7.)*

### 5.5 Orders
```
GET /api/orders        (S) → paginated summaries
GET /api/orders/:id    (S) → {id, shortId, status, totalAmountPaise, parcelChargePaise,
                              pickupOtp? (only ready/completed), pickupTime, items[], refund*, shop}
GET /api/orders/:id/status (S) → {status, adjusted, refundStatus}
```

### 5.6 Vendor console
```
GET  /api/vendor/orders/pending (VS) → [{id, shortId, customerName, phone, orderType, status,
                                         totalAmountPaise, items, pickupTimeISO, pickupOtp?,
                                         pickupReminderSent, urgency}]
POST /api/vendor/orders/:id/accept|ready (VS) → {order} (409 on lost race)
POST /api/vendor/orders/:id/cancel       (VS) → {order, refundStatus}
POST /api/vendor/verify {orderId, otp}   (VS) → {completed} | 400/404/429
POST /api/vendor/orders/:id/adjust {keepItemIds[], reason} → {order, refundAmountPaise, refundStatus}
POST /api/vendor/orders/:id/parcel {enabled} → {order}
POST /api/vendor/orders/:id/mark-reminder → 204
GET  /api/vendor/orders/completed (VS) → paginated summaries
GET/POST/PATCH/DELETE /api/vendor/menu*      (multipart create; JSON update/delete)
POST /api/vendor/shop/toggle                 → {shop}
POST /api/vendor/menu/parcel-charge {amountPaise} → {shop}
GET  /api/vendor/payment/settings → {gateway, paymentConfigured, env, masked keys}
POST /api/vendor/payment/settings (store encrypted)
Socket: authenticated; `pending-count` and new-order events into `shop:<id>`
```

### 5.7 Admin console
```
GET  /api/admin/dashboard (metrics fixed)   GET /api/admin/shops[?search] (paginated)
POST/PATCH/DELETE /api/admin/shops/:id      GET/PUT /api/admin/shops/:id/payment-settings (masked)
GET/POST /api/admin/vendors[/*]             GET/POST /api/admin/students[/*]
GET  /api/admin/orders[?search&status&page] GET /api/admin/orders/:id
POST /api/admin/orders/:id/parcel           GET /api/admin/menus
POST /api/admin/vendors/:id/menu/import      → {importId, previewItems[]} (server-held session)
POST /api/admin/vendors/:id/menu/import/:importId/confirm → {insertedCount}
      (confirm from server-vetted state, never req.body)
GET  /api/admin/analytics/data (existing payload + pagination/cache)
```

### 5.8 FCM
```
POST /api/fcm/register {token, deviceInfo} (V) → 200   (scope key {token, vendorId: me})
POST /api/fcm/unregister {token} (V) → 204
```

---

## 6. EJS dependency map and migration hot-spots

### 6.1 Shared shell and locals
- `partials/header.ejs` (33 pages: nav, flash, Firebase config), `partials/footer.ejs`
  (SW registration, update banner, socket scripts), `partials/vendor-nav.ejs`, admin
  `layout-start/end` + `sidebar`, `partials/menu-table.ejs`, `partials/menu-manager.ejs`.
- `res.locals` contract to replace: `currentUser`, `cartCount`, `flash`, `vendorShop`,
  `env.RAZORPAY_KEY_ID`, `firebaseConfig`, `appVersion`, and the server formatters
  (`formatPickupTime`, `formatLocalDateTime`, `getPickupUrgency`).

### 6.2 Client assets
Razorpay checkout SDK (keep), Chart.js (analytics), `/socket.io/socket.io.js`,
Firebase compat + `firebase-client.js` (keep/wrap), `notification-manager.js` (extract to module),
`update-manager.js` (PWA), `menu-table.js` (port to component state), service workers (keep),
ringing sound (static).

### 6.3 Business logic embedded in views (highest risk)
| View | Embedded logic |
|---|---|
| `views/vendor/pending-orders.ejs` (~943 lines) | socket join, 5s polling, sound, accept/ready/cancel fetch, OTP modal, parcel toggle, reminder, urgency formatting |
| `views/partials/menu-table.ejs` (~779) | variant matrix, filters/search, add-to-cart forms, guest/student branches |
| `views/admin/vendors/menu-import-preview.ejs` (~743) | client-side AI JSON recovery, per-row edit, confirm from client state |
| `views/admin/analytics.ejs` (~535) | Chart.js orchestration and filters |
| `views/cart/index.ejs` (~483) | pickup-time generation, parcel math, variant live pricing, gateway switch |
| `views/orders/show.ejs` (~132) | status step math, 5s polling + reload |

These move to typed utilities/components; otherwise variant/parcel/status logic will exist in
three more places.

---

## 7. Migration order (merged from both reports)

| Stage | Work | Risk | Gate |
|---|---|---|---|
| **0. Hardening** | Atomic money transitions, verify-payment signature+amount+idempotency, CSRF/session/cookie, FCM token scope, `/api/auth/me` + error shape | Critical work, server-only | Must be green before any UI work; see `STAGE0_PLAN.md` |
| **1. JSON client** | Wire the ~16 existing JSON endpoints into a typed client + React Query | Low | Stage 0 done |
| **2. Read-only screens** | home, shops, shop menu, orders list/detail, profile, admin analytics | Low | API client |
| **3. Auth + session** | signup/login/forgot/reset/logout as JSON, route guards | Medium | Stage 0 identity |
| **4. Money flow (student)** | cart, gateway switch, verify-payment; mock checkout excluded | **High** | Stage 0 payment fixes |
| **5. Vendor console** | pending feed, accept/ready/cancel, verify, adjust, menu, settings, completed | **Highest** | Orders state machine stable |
| **6. Admin console** | dashboard/analytics, shops/vendors/students, orders, menus, import | Medium-high | Stages 2–5 |
| **7. Decommission EJS** | route cutover per prefix, SW navigation fallback, delete views + locals | Low | All screens live |

Risk rationale: stages 1–3 give visible progress with no money/realtime exposure; stage 4 waits for
payment hardening; stage 5 is last because it combines socket + polling + refunds + OTP (the four
highest-bug-density behaviors).

---

## 8. What has changed since these reports (verified 2026-10-29)

The reports assumed a pre-hardening codebase. Current source:

- `GET /api/auth/me` exists (`routes/api/authMe.js`).
- CSRF protection exists (`middleware/csrfOriginProtection.js`, origin/referer allowlist; gateway
  callbacks exempt) — not the double-submit token design proposed here.
- Session cookie has `sameSite: lax` + `secure` in production; login and signup call
  `session.regenerate()`.
- `verify-payment` uses timing-safe comparison, fetch-based captured-amount verification
  (`utils/payment-verification.js`), and an atomic idempotent transition.
- Order transitions (accept/ready/cancel/adjust/OTP/QR/parcel) use status-preconditioned
  `findOneAndUpdate`; parcel changes recompute totals from items (no float delta).
- FCM register is owner-scoped with a 409 conflict for another user's token.
- There is **no** shared `transitionOrder` helper (`utils/order-state.js` was proposed, not built).
- Error envelopes remain mixed; the global handler still returns `{error}` only for `/api/*`.
- The migration itself has not started: all views are still EJS, no React/Vite tooling exists.

So Stage 0 is largely complete; the remaining migration work is stages 1–7, preceded by an API
normalization pass. This document is retained as planning evidence, not as a to-do list.
