# FlashFoods — Project Context

*Authoritative AI/human reference. Verified against source on 2026-10-29. Code wins over this document;
update it when behavior changes.*

FlashFoods is a college-canteen pre-ordering web app. Students browse shops, add items to a
session cart, pay through a per-shop gateway and collect with a pickup QR/OTP. Vendors manage
their own menu, shop state and order queue. Admins manage shops, vendors, students, payments and
analytics.

## 1. Roles

| Role | Capabilities | Entry page |
|---|---|---|
| `student` | Browse shops/menus, cart, checkout, own orders, cart tab badge | `/` |
| `vendor` | Own menu CRUD, shop open/close/hours/slots/discount, pending → ready → verify pickup, refunds on cancel/adjust, payment settings | `/vendor/orders/pending` |
| `admin` | CRUD shops/vendors/students, toggle active, orders, AI menu import, analytics, gateway config per shop | `/admin` |

Public signup hard-codes `role: "student"` and requires a valid Indian 10-digit phone
(`routes/auth.js`). Vendors/admins are created by an admin or by `seed.js`.

## 2. Stack and runtime

Node.js (ES modules, no transpiler), Express 5, EJS 5, MongoDB + Mongoose 8, Socket.IO 4,
`express-session` (MemoryStore) + `connect-flash` + `bcryptjs`, Cloudinary + Multer, Razorpay /
Easebuzz / PhonePe, Firebase Admin FCM + web push, Resend email, Google Gemini vision for menu
import, `liquid-gl@3.0.0` for the student-portal glass effects.

No bundler, no TypeScript, no linter config, no test framework beyond `node:test` and Playwright.

Deployment target is Render behind TLS termination (`app.set("trust proxy", 1)`), configured
entirely through `.env` (see `.env.example`). `NODE_ENV=production` requires `SESSION_SECRET`
or the process exits.

## 3. Repository structure and entry points

```
server.js                 middleware chain, route mounting, /sw.js + /firebase-messaging-sw.js
                          env injection, /version.json, global error handler, listen
seed.js                   DESTRUCTIVE demo seed (deletes demo users + `testing` shop)
config/                   db, cloudinary, razorpay, easebuzz, phonepe, firebase-admin
middleware/               auth guards, requireDb, csrfOriginProtection(+Config), upload
models/                   User, Shop, MenuItem, Order, FcmToken, PickupSlotBooking
routes/                   auth, shops, cart, menu, orders, webhooks, vendor, vendor-profile,
                          profile, admin; api/authMe (`/api/auth`), api/fcm (`/api/fcm`)
utils/                    money, pricing, discount, order-math, order-adjust, order-cancel,
                          pickup-slots, qr-pickup, otp, shop-hours, time, email, phone,
                          payment-verification, signature, webhook-signature,
                          notification-dispatch, vendor-analytics, admin
socket/index.js           initSocket, vendor:join, emitPendingCount
menu-import/              upload (multer → temp/imports), validator, splitter, vision (Gemini),
                          json-recovery, preview, store (in-memory sessions), importer, debug
views/                    EJS: home, auth/, shops/, cart/, orders/, profile/, vendor/, admin/,
                          partials/ (header, footer, menu-manager, menu-table, bottom nav,
                          student-glass, update-banner, page-background, vendor-nav)
public/                   styles.css, js/ (menu-table, notification-manager, firebase-client,
                          student-glass, update-manager, firebase compat SDKs, vendor/liquidGL),
                          sw.template.js, firebase-messaging-sw.js, manifest.json, icons,
                          images, audio, fonts
build-scripts/            generate-version.js (version.json + sw.js), vendor-liquidgl.js
scripts/                  migrate-menu-prices.js (one-off, destructive-ish), qa-vendor-profile-server.mjs
tests/                    unit/ (24 files), Playwright root specs, e2e/, mobile/, instrumentation/
.ai/                      autonomous agent control plane (rules, orchestrator, test protocol, history)
docs/, md/                project docs + historical reports (see docs/README.md)
temp/                     git-ignored scratch: imports/ uploads, debug/ Gemini dumps, QA fixtures
```

Generated (git-ignored): `public/version.json`, `public/sw.js`, `temp/`, `graphify-out/`,
`playwright-report/`, `test-results/`. Tracked-but-generated: `public/js/vendor/liquidGL.js`
(copied from `node_modules/liquid-gl` by postinstall).

## 4. Request lifecycle (verified order in `server.js`)

```
Helmet (CSP disabled) → trust proxy → /sw.js, /firebase-messaging-sw.js, /version.json →
express.static(public) → webhooksRouter (BEFORE body parsers; route uses express.raw) →
express.urlencoded/json → csrfOriginProtection → session → flash → attachUser →
res.locals (currentUser, vendorShop, cartCount, flash, env, firebaseConfig, appVersion,
assetVersion, pickup/date formatters) → routers → GET / → global error handler
```

Route mounting: `authRouter` at `/`, `authMeRouter` at `/api/auth`, `shopsRouter`, `cartRouter`,
`ordersRouter`, `menuRouter`, `vendorRouter`, `fcmRouter` at `/api/fcm`, `adminRouter` at `/admin`,
`vendorProfileRouter`, `profileRouter`.

`attachUser` loads `req.user` from `req.session.userId` and clears the session if the user is
missing or `isActive === false`. `requireAuth` re-reads when `req.user` is stale.
`requireVendorShop` sets `req.vendorShopId` / `req.vendorShopIdStr`; `resolveAdminVendorShop`
does the same for admin routes from `:vendorId`.

## 5. Feature → file map

| Area | Files |
|---|---|
| Auth, signup, login, logout, reset | `routes/auth.js`, `middleware/auth.js`, `utils/email.js`, `views/auth/` |
| Catalog | `routes/shops.js`, `views/shops/index.ejs`, `views/shops/menu.ejs` |
| Cart | `routes/cart.js`, `views/cart/index.ejs` (session cart, single shop) |
| Checkout / mock checkout | `routes/orders.js` `POST /orders/checkout` (only shop slug `testing`) |
| Razorpay | `config/razorpay.js`, `routes/orders.js` `/create-razorpay-order`, `/verify-payment`, `routes/webhooks.js`, `utils/payment-verification.js`, `utils/webhook-signature.js`, `utils/signature.js` |
| Easebuzz | `config/easebuzz.js`, `routes/orders.js` `/easebuzz/initiate`, `/easebuzz/callback` |
| PhonePe | `config/phonepe.js`, `routes/orders.js` `/phonepe/initiate`, `/phonepe/callback` |
| Order views/status | `routes/orders.js`, `views/orders/`, `utils/order-math.js` |
| Vendor queue & pickup | `routes/vendor.js` (`/vendor/orders/*`, `/vendor/verify`, `/vendor/verify-qr`), `utils/qr-pickup.js`, `utils/otp.js`, `views/vendor/` |
| Slots / hours / discounts | `utils/pickup-slots.js`, `utils/shop-hours.js`, `utils/discount.js`, `routes/vendor.js` `/vendor/shop/*` |
| Refunds / adjustments | `utils/order-cancel.js`, `utils/order-adjust.js`, `routes/vendor.js` cancel/adjust |
| Notifications | `socket/index.js`, `utils/notification-dispatch.js`, `routes/api/fcm.js`, `public/js/notification-manager.js`, `public/js/firebase-client.js` |
| Admin console | `routes/admin.js`, `views/admin/`, `utils/admin.js`, `utils/vendor-analytics.js` |
| AI menu import | `menu-import/*`, `routes/admin.js` `/vendors/:vendorId/menu/import[/confirm]`, `views/admin/vendors/menu-import*.ejs` |
| PWA / versioning | `public/sw.template.js`, `public/firebase-messaging-sw.js`, `public/manifest.json`, `public/js/update-manager.js`, `build-scripts/generate-version.js` |

## 6. Data models (`models/`)

- **User** — name, email (unique, lowercase), passwordHash, role (`student|vendor|admin`),
  shop ref, phone, isActive/disabledAt, resetPasswordToken/Expires.
- **Shop** — name, slug (unique), description, image, vendor ref, `paymentGateway`
  (`razorpay|easebuzz|phonepe|paytm|bharatpe`), `paymentConfigured`, nested `paymentSettings`
  (razorpay keyId/keySecret/webhookSecret; easebuzz merchantKey/salt/env; phonepe clientId/
  clientSecret/clientVersion/env), isOpen, openingTime/closingTime (IST "HH:MM", empty = none),
  `pickupSlots {enabled,startTime,endTime,durationMinutes,capacity,daysAhead}`,
  `discount {enabled,percent}`, parcelChargeEnabled/parcelCharge, isActive/disabledAt.
- **MenuItem** — shop ref (required), name, category, description, price (min 0), image,
  available, foodType (`veg|non-veg|egg|unknown`), variants `[{label, price}]`
  (schema default `[{label:"Regular", price:0}]`). Index `{shop,name}`.
- **Order** — customer, shop, items `[{menuItem,name,price,quantity,status:active|removed,
  variantId,variantName,variantPrice}]`, orderType (`dinein|parcel`), parcelCharge,
  discountPercent/discountAmountPaise, total, pickupTime, pickupReminderSent, collectedAt,
  pickupMethod (`qr|otp|null`), status (`pending_payment|paid|accepted|ready_for_pickup|
  completed|cancelled`), pickupOtp, paymentNote, transactionId, razorpayOrderId,
  razorpayPaymentId, webhookEventId, gatewayTxnId, readyAt, refundStatus/refundId/
  refundProcessedAt, amountChargedPaise, originalTotal/updatedTotal/refundAmount/adjustedAt/
  adjustedBy/adjustmentReason.
  Indexes: `{shop,pickupOtp}`, `{shop,status}`, `{customer,createdAt}`, `{status,createdAt}`,
  `{shop,createdAt}`, `{shop,pickupTime,createdAt}`, unique sparse `razorpayOrderId`,
  unique sparse `gatewayTxnId`.
- **FcmToken** — vendorId or customerId (one required), unique token, deviceInfo, lastSeenAt,
  failCount/lastFailureAt, 90-day TTL index.
- **PickupSlotBooking** — `{shop, slotStart}` unique, `booked` counter (atomic capacity ledger).

Relationships: Shop 1–n MenuItem; User(vendor) 1–1 Shop; Order references customer + shop and
embeds item snapshots (order history survives menu edits).

## 7. Business invariants (do not break)

1. **Money is server-authoritative** in integer paise (`utils/money.js` `toPaise/fromPaise`).
   Browser-supplied totals are never trusted.
2. **Discount applies only to the food subtotal**, never the parcel charge; one rounding step
   (`utils/discount.js`, `utils/order-math.js`). `amountChargedPaise` is frozen at payment and
   must drive refund math, not mutable `total`.
3. **Order transitions are atomic** via `findOneAndUpdate` with status preconditions:
   `paid → accepted` (`/vendor/orders/:id/accept`), `accepted → ready_for_pickup` (`ready`),
   `ready_for_pickup → completed` (QR/OTP verify). Concurrent double-clicks cannot double-fire.
4. **Pickup**: vendor scans the student's QR (`/vendor/verify-qr`, signed token bound to shop,
   one-time by the `ready_for_pickup` precondition) or falls back to the 6-digit OTP
   (`/vendor/verify`). Successful completion sets `collectedAt` + `pickupMethod`.
5. **Pickup slots**: when enabled, checkout must reserve a slot; capacity is enforced by an
   atomic conditional `$inc` on `PickupSlotBooking` (`utils/pickup-slots.js`); failures release.
6. **Cart is session-only, single-shop**, quantity clamped 1–99; adding from another shop forces
   a cart reset route in `routes/cart.js`.
7. **Shop availability** = `isActive !== false` AND `isOpen` AND inside configured IST hours
   (`utils/shop-hours.js`, overnight windows supported). Admins disabling a shop also closes it.
8. **Checkout is mock-only outside real gateways**: `POST /orders/checkout` hard-blocks any shop
   whose slug is not `testing`; real payments go through the gateway routes.
9. **Vendor data is scoped by `req.vendorShopId`**; consumers must never accept a shop id from
   the request body for vendor actions.
10. **Refunds**: Razorpay and PhonePe full/partial implemented; Easebuzz refunds are manual
    (`refundStatus: pending`). Mock orders complete without a gateway refund.

## 8. Security constraints

- **CSRF**: Origin/Referer allowlist on POST/PUT/PATCH/DELETE (`middleware/csrfOriginProtection.js`).
  Exempt only `/easebuzz/callback` and `/phonepe/callback` (`middleware/csrfConfig.js`);
  `www.flashfoods.in` is an extra allowed origin.
- **Session**: httpOnly, `sameSite: lax`, `secure` in production; `session.regenerate()` before
  login/signup (anti-fixation). Store is the default MemoryStore (single-instance).
- **Payments**: Razorpay signature compare is timing-safe (`utils/signature.js`); `/verify-payment`
  fetches the captured payment and requires currency INR + exact paise match
  (`utils/payment-verification.js`), with replay-safe idempotency. Webhooks fail closed when the
  shop has no webhook secret and are idempotent via `webhookEventId`.
- **No rate limiting by product policy** — do not add throttling unless the product policy changes.
- **FCM tokens are owner-scoped**; a token registered to another user returns 409.
- **Sensitive**: `Shop.paymentSettings` (plaintext gateway secrets), `.env`, Firebase service
  account, reset tokens in URLs, and order/analytics logs. Never log or export these.
- Helmet is enabled with CSP disabled (legacy EJS inline scripts/styles).

## 9. Payment / order / notification / PWA flows

- **Razorpay**: `/create-razorpay-order` validates cart + shop, creates `pending_payment` order and
  a Razorpay order → client checkout → `/verify-payment` (signature + fetched-payment amount check)
  → `paid`, `amountChargedPaise` set, cart cleared, `emitPendingCount` + vendor FCM.
  Webhook `payment.captured` claims the same transition atomically; `payment.failed` cancels and
  releases the slot.
- **Easebuzz / PhonePe**: server-built request → gateway redirect → callback verifies hash
  (Easebuzz) or status+amount (PhonePe) → `paid` / `cancelled`.
- **Vendor accept → ready**: each emits `pending-count`; marking ready dispatches an FCM push to
  the student's registered devices and sets `readyAt`.
- **Socket.IO**: only `vendor:join` (shop room) → `pending-count`; the pending-orders page also
  polls `/vendor/orders/pending.json` and plays `public/audio/ringing_sound.mp3`.
- **PWA**: `public/sw.template.js` is turned into `public/sw.js` with `__BUILD_ID__`;
  `server.js` injects Firebase config into `/sw.js` and `/firebase-messaging-sw.js`. Precached:
  `/food-placeholder.svg`, `/background-image.png`, `/images/canteen-bg.png`,
  `/fonts/Transcity-DEMO.otf`, `/icon.png`, `/icons/icon-192x192.png`, `/manifest.json`.
  Runtime caching: navigations are network-only; CSS is network-first with cache fallback; every
  other GET is cache-first with network fallback; non-GET requests, `/socket.io/` and
  `/version.json` bypass the handler.
- **Menu import**: upload to `temp/imports` → `splitter` (sharp) → Gemini vision →
  `json-recovery` → preview (`temp` session store) → admin confirm creates MenuItems;
  debug dumps land in `temp/debug/<timestamp>/`.

## 10. Testing and verified status

- **Unit**: `npm test` (alias `npm run test:unit`) → `node --test "tests/unit/**/*.test.js"`.
  24 files covering auth redirects, discounts, order math, pickup slots/F07, QR guard, OTP,
  payment & webhook signatures, FCM client/targeting/dispatch, vendor analytics/profile,
  shop hours and a full lifecycle (`stage1-comprehensive`). Uses `mongodb-memory-server-core`.
  **Last verified run: 2026-10-29 — 301 passed / 0 failed** (`npm test`, before the documentation
  audit; not re-run during it). Treat it as the regression baseline, not a permanent fact.
- **Playwright**: 13 specs — `tests/*.spec.js` (smoke, login, permissions, student/vendor
  workflow), `tests/mobile/` (navigation-auth, pwa-installability, session-persistence,
  student-flow, vendor-flow), `tests/instrumentation/` (fcm-diagnostic, notification-lifecycle),
  `tests/e2e/vendor-profile.spec.js` (skipped unless `PLAYWRIGHT_QA=1` + fixture).
- **Isolated harness**: `npm run test:e2e:vendor-profile` starts
  `scripts/qa-vendor-profile-server.mjs` (in-memory Mongo, port 3123) and the vendor-profile
  config. Use this pattern for new E2E work.
- **CI** (`.github/workflows/playwright.yml`) runs `npm test` only; Playwright steps are disabled
  because the default config is not isolated (see §11).
- Single test file: `node --test tests/unit/<file>.test.js`. Playwright file:
  `npx playwright test tests/<file>.spec.js`.

## 11. Known issues and risks

Verified / current:
1. **Default Playwright config is destructive**: `tests/global-setup.mjs` connects to
   `process.env.MONGO_URI` and rewrites the `testing` shop/vendor. Never run `npm run test:e2e`
   with a production `.env`; CI keeps it disabled.
2. **MemoryStore sessions** — not multi-instance safe; restarts drop sessions and carts.
3. **Easebuzz refunds** are manual (both cancel and adjust).
4. **Paytm / BharatPe** exist in the `Shop.paymentGateway` enum but have no flow.
5. **Password reset does not invalidate existing sessions.**
6. **No health-check endpoint** and **no audit log** for admin/vendor actions.
7. **Socket.IO has no authentication middleware** on `vendor:join` (shop-room join accepts the
   client-supplied shop id).
8. **Debug logging is verbose** (PhonePe refunds, QR verification, FCM, menu-import dumps).
9. **`seed.js` and `scripts/migrate-menu-prices.js` run against the configured database** with no
   environment guard (`seed.js` deletes/recreates demo records).
10. **Menu-import sessions are in-memory Map** (lost on restart) and uploads are never swept,
    so `temp/imports` and `temp/debug` grow (currently ~71 MB locally, git-ignored).
11. **No ESLint/Prettier/TS**; large route files (`routes/admin.js` ~2.2k lines,
    `routes/vendor.js` ~1.5k, `routes/orders.js` ~1.0k) hold duplicated menu/payment/refund logic.
12. Item cards with no explicit variants display the schema-default `Regular: ₹0.00` while the
    base `price` is non-zero — a data-shape quirk in variant-less items, not a pricing bug.

Historical claims now resolved (do not repeat as open): CSRF protection exists; `sameSite` is set;
session fixation is mitigated by `regenerate()`; the `.bak`/cookie files and duplicated background
image are gone; `public/images/canteen-bg.png` **is** used (service-worker precache).

## 12. UI decisions and intentionally deferred issues

- Student portal is mobile-first. Per `.ai/rules.md` §17, UI changes apply only at
  `max-width: 767px` (reference canvas 393×852); desktop (≥768px) is frozen except the accepted
  student-home state. `.ai/UI_STANDARD.md` holds the tokens/recipes.
- Canteens page: horizontal cards, pill `.canteen-search` (mobile only, hidden ≥768px), header block.
  Shop Details reuses `.canteen-search` (with `--menu` modifier, visible at all widths) as the
  single menu search; the filter chips live in `#filter-bar` (shared `menu-table.ejs` partial),
  and `public/js/menu-table.js` does name/category search + food-type/category filters with an
  empty state. The vendor/import toolbar keeps its own `#import-search`.
- Bottom-nav blinking/entrance animation and Liquid Glass lifecycle are **deliberately deferred**
  (commit `af9ee90`): do not "fix" them as incidental cleanup.
- Warm orange/coral/cream palette, blurred `student_home_background.png`, translucent glass cards.

## 13. Development limitations

- Do not point tests, seeds or scripts at production MongoDB/Atlas or live gateways.
- E2E suites need a running server plus fixtures; there is no `webServer` block in the default
  Playwright config.
- External services (Razorpay/PhonePe/Easebuzz/FCM/Cloudinary/Gemini/Resend) are not available
  locally; unit tests mock or bypass them.
- No rate limiting, no session store, no migrations framework.

## 14. Safe investigation and change procedure

1. Read this file, then the relevant `docs/` file (see `docs/README.md` for freshness) and the
   actual module. Treat old reports (`md/`, `docs/archive/`) as evidence only.
2. Trace the path: route in `routes/` → middleware guards → model queries → view/client script.
3. Check invariants in §7–§8 before editing money, transitions, pickup, or auth code.
4. Make the smallest change; reuse existing utils (`money`, `pricing`, `discount`, `order-math`,
   `pickup-slots`, `shop-hours`) instead of adding helpers.
5. Verify: `npm test` (expect 301 passing), plus the affected Playwright flow in an isolated
   harness. Never claim E2E or external-service verification that did not run.
6. Update this file and `docs/README.md` if architecture, commands, routes or known issues change.
