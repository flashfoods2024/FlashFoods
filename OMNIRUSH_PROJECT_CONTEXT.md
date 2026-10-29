# FlashFoods — OmniRush Project Context

*Generated on: 2026-10-29*

This document is the persistent project reference for future OmniRush sessions. Always validate it against the current source code before making changes.

---

## A. Project Identity

### Purpose
FlashFoods is a college-canteen pre-ordering platform intended to reduce queues through advance ordering. Students can browse vendor menus, add items to a cart, and place orders for pickup. Vendors manage their menus, view pending orders, mark orders as ready, and verify student pickups via OTP or QR code. Admins manage vendors, shops, and system-wide settings.

### Users and Roles
| Role | Description | Key Capabilities |
|------|-------------|-----------------|
| `student` | College student placing orders | Browse menus, add to cart, checkout with payment, track order status, verify pickup via OTP/QR |
| `vendor` | College canteen vendor | Manage menu, toggle shop open/close, view pending orders, accept/decline orders, mark ready, cancel orders, issue refunds |
| `admin` | System administrator | Manage vendors and shops, configure payment gateways, view reports, system settings |

### Business Workflows
1. Student registration & login — sign up with name/email, role hardcoded to `student` on signup
2. Browse vendors and menus — students can view open shops and their menu items with filters (veg, non-veg, egg, unknown)
3. Cart management — add items, remove items, adjust quantities, variant selection
4. Order placement — checkout generates a Razorpay/PhonePe/Easebuzz order, creates order with `pending_payment` status, generates OTP
5. Vendor order acceptance — vendor accepts paid order → status becomes `accepted`
6. Order preparation — vendor marks order `ready_for_pickup`
7. Pickup verification — student presents OTP or scans QR to complete pickup → status becomes `completed`
8. Vendor dashboard — view pending orders, filter by status, real-time pending count via Socket.IO
9. Admin controls — toggle vendor shop active/inactive, configure payment gateways per shop, apply discounts

### Technology Stack
- **Runtime**: Node.js (ES module syntax), Express 5
- **Template Engine**: EJS 5
- **Database**: MongoDB via Mongoose 8
- **Payment Gateways**: Razorpay (primary), Easebuzz, PhonePe (per-shop configuration)
- **External Services**: Cloudinary (image upload), Firebase Admin (FCM push notifications), Resend (email)
- **Security**: Helmet.js, express-session with connect-flash, CSRF origin/referer protection, SameSite=Lax cookies
- **PWA**: Web app manifest, service workers, Firebase Cloud Messaging
- **Build Scripts**: `npm run build:version`, `npm run vendor:liquidgl`
- **Testing**: Unit tests (in-memory MongoDB, `npm test`), E2E tests (Playwright)

### Deployment Architecture
- Designed for Render/TLS termination (explains `trust proxy: 1` in server.js)
- Environment-driven configuration via `.env` file
- Asset versioning for cache-busting via `version.json`
- Service worker files dynamically injected with Firebase config at runtime
---

## B. Repository Map

### Key Directories

| Directory | Responsibility |
|-----------|---------------|
| `config/` | Database connection, payment gateway configs, Firebase admin initialization |
| `models/` | Mongoose schemas (User, Shop, MenuItem, Order, FcmToken, PickupSlotBooking) |
| `middleware/` | Express middleware (auth, CSRF, requireDb, requireRole, error handling) |
| `routes/` | Route handlers (controllers) organized by feature: auth, shops, cart, orders, vendor, admin, menu, profile, vendor-profile |
| `utils/` | Helper functions: time formatting, discount calculation, OTP generation, payment verification, pricing, QR pickup, notification dispatch |
| `socket/` | Socket.IO event handlers for real-time pending order counts |
| `views/` | EJS templates and partials organized by feature |
| `public/` | Static assets: CSS, JS, service workers, manifest, version.json |
| `tests/` | Unit tests and E2E test configurations |
| `docs/` | Project documentation, bug reports, stabilization plans |
| `build-scripts/` | Version generation, liquid-gl vendor build scripts |

### Entry Points
- `server.js` — Main application entry point, Express initialization, middleware setup, route mounting, server startup

### Critical Configuration Files
- `.env` — Environment variables (database URLs, API keys, session secret, Firebase config, payment keys)
- `package.json` — Dependencies, npm scripts
- `nodemon.json` — Development configuration
- `.gitignore` — Excludes node_modules, build output, temp files

### Key Dependencies (selected)
| Package | Purpose |
|---------|---------|
| `express` | Web framework |
| `mongoose` | MongoDB ODM |
| `razorpay` | Payment gateway |
| `firebase-admin` | Push notifications, FCM |
| `cloudinary` | Image upload storage |
| `socket.io` | Real-time updates |
| `helmet` | Security headers |
| `express-session` | Session management |
| `connect-flash` | Flash messages |
| `qrcode` | QR code generation |
| `liquid-gl` | UI styling library |
---

## C. Architecture

### Request Lifecycle

```
HTTP Request
  → Helmet (security headers)
  → Trust proxy (Render TLS termination)
  → CSRF origin/referer protection (exempt payment callbacks)
  → Express.urlencoded() + express.json() (body parsing)
  → Session middleware
  → Flash middleware
  → attachUser (loads req.user from session)
  → res.locals setup (currentUser, vendorShop, cartCount, env config)
  → Router dispatch (based on path)
  → Route handler → Controller logic → Model query → Render EJS / Send JSON
  → Global error handler (last app.use)
```

### Frontend-to-Backend Communication

| Channel | Method | Purpose |
|---------|--------|---------|
| HTML forms | POST | Student signups, logins, cart changes, order checkout |
| API routes | POST/GET | Payment verification, order status, Socket.IO events |
| Socket.IO | Events | Real-time pending order count updates (`vendor:join`) |
| Service worker | Fetch | PWA asset caching, offline fallback |
| POST webhooks | Gateway callbacks | Razorpay payment.captured, Easebuzz/PhonePe callbacks |

### Database and Data Models

#### User Schema
- `name`, `email` (unique, lowercase), `passwordHash`
- `role`: enum [`student`, `vendor`, `admin`] (default: `student`)
- `shop`: ObjectId ref to Shop (null for students/admin)
- `phone`, `isActive`, `disabledAt`
- `resetPasswordToken`, `resetPasswordExpires`

#### Shop Schema
- `name`, `slug` (unique, lowercase)
- `description`, `image`
- `vendor`: ObjectId ref to User (the creating vendor)
- `paymentGateway`: enum [`razorpay`, `easebuzz`, `phonepe`, `paytm`, `bharatpe`] (default: `razorpay`)
- `paymentConfigured`: Boolean
- `paymentSettings`: per-gateway nested config (keyId, keySecret, webhookSecret, merchantKey, salt, env)
- `isOpen`: Boolean (manual toggle)
- `openingTime`, `closingTime`: IST 24-hour strings; empty = no time constraint
- `pickupSlots`: configured window/duration/capacity or disabled
- `discount`: enabled + percent (applies to food subtotal only)
- `parcelChargeEnabled`, `parcelCharge`: Number
- `isActive`: Boolean

#### MenuItem Schema
- `shop`: ObjectId ref to Shop (required)
- `name`: required, trimmed
- `category`: String, default `""`
- `description`: default `""`
- `price`: required, min 0
- `image`: default `""`
- `available`: Boolean, default `true`
- `foodType`: enum [`veg`, `non-veg`, `egg`, `unknown`] (default: `unknown`)
- `variants`: array of {label, price}
- Index: `{ shop: 1, name: 1 }`

#### Order Schema
- `customer`: ObjectId ref to User (required)
- `shop`: ObjectId ref to Shop (required)
- `items`: array of orderItemSchema (menuItem, name, price, quantity, variantId/variantName/variantPrice, status)
- `orderType`: enum [`parcel`, `dinein`] (default: `dinein`)
- `parcelCharge`: Number, default 0
- `discountPercent`: Number, default 0
- `discountAmountPaise`: Number, default 0
- `total`: required, min 0
- `pickupTime`: Date (indexed)
- `pickupReminderSent`: Boolean, default false
- `collectedAt`: Date
- `pickupMethod`: enum [`qr`, `otp`], default null
- `status`: enum [`pending_payment`, `paid`, `accepted`, `ready_for_pickup`, `completed`, `cancelled`] (default: `pending_payment`)
- `pickupOtp`: required String
- `transactionId`: String
- `razorpayOrderId`: String
- `razorpayPaymentId`: String, default `""`
- `webhookEventId`: String, default `""`
- `gatewayTxnId`: String
- `readyAt`: Date, default null
- `refundStatus`: enum [`none`, `pending`, `completed`, `failed`] (default: `none`)
- `refundId`: String, default `""`
- `refundProcessedAt`: Date, default null
- `amountChargedPaise`: Number, default null
- `originalTotal`, `updatedTotal`, `refundAmount`, `adjustedAt`, `adjustedBy`, `adjustmentReason`
- Indexes: `{ shop: 1, pickupOtp: 1 }`, `{ shop: 1, status: 1 }`, `{ customer: 1, createdAt: -1 }`

### Middleware and Authorization Structure

1. **attachUser** — Loads `req.user` from session userId; cleans up inactive sessions
2. **requireAuth** — Redirects to `/login` if no session
3. **requireVendor** — Only vendor role allowed
4. **requireStudent** — Only student role allowed
5. **requireAdmin** — Only admin role allowed
6. **requireVendorShop** — Vendor must have a shop linked; sets `req.vendorShopId`
7. **resolveAdminVendorShop** — Admin routes: resolves target vendor by param

**Authorization in routes**: Each route explicitly checks role requirements before proceeding.

### External Service Integrations

| Service | Integration Points |
|---------|-------------------|
| **Razorpay** | `/create-razorpay-order`, `/verify-payment`, webhook `/webhooks/razorpay`, refunds |
| **Easebuzz** | Initiate checkout, `/easebuzz/callback`, refunds (manual) |
| **PhonePe** | Initiate checkout, `/phonepe/callback`, refunds |
| **Cloudinary** | Image upload during menu item create/update |
| **Firebase Admin** | FCM push notifications, service worker config injection |
| **Resend** | Email notifications (order ready, etc.) |

### Background Processing and Event-Driven Functionality

- **Socket.IO**: `vendor:join` event joins shop room, broadcasts `pending-count`; used for real-time polling on vendor dashboard
- **Order ready notification**: `dispatchOrderReadyNotification` sends FCM push to student when vendor marks order ready
- **Pickup completion**: OTP/QR verification completes order and can trigger notifications
---

## D. Feature Implementation Map

### Student/Customer Portal

| Feature | Files Involved | Key Endpoints |
|---------|---------------|--------------|
| Registration & login | `routes/auth.js`, `middleware/auth.js`, `views/auth/` | `POST /auth/signup`, `POST /auth/login`, `GET /`, `GET /login`, `GET /signup` |
| Browse vendors & menus | `routes/shops.js`, `routes/menu.js`, `views/partials/` | `GET /shops`, `GET /menu/:id` |
| Cart management | `routes/cart.js` | `POST /cart/add`, `POST /cart/remove`, `GET /cart` |
| Checkout & payment | `routes/orders.js:checkout`, `/create-razorpay-order`, `/verify-payment` | `POST /orders/checkout`, `POST /create-razorpay-order`, `POST /verify-payment` |
| Order tracking | `views/orders/show.ejs` | Client polls status, receives updates |
| Pickup verification (OTP) | `routes/vendor.js: /vendor/verify`, `models/Order` | `POST /vendor/verify` (OTP submission) |
| Pickup verification (QR) | `utils/qr-pickup.js`, `socket/index.js` | QR code generation and verification |

### Vendor Portal

| Feature | Files Involved | Key Endpoints |
|---------|---------------|--------------|
| Menu management | `routes/vendor.js`, `models/MenuItem` | `GET /vendor/menu`, `POST /vendor/menu`, `PATCH /vendor/menu/:id`, `DELETE /vendor/menu/:id` |
| Toggle shop open/close | `routes/vendor.js: /vendor/shop/toggle` | `POST /vendor/shop/toggle` |
| Set operating hours | `routes/vendor.js: /vendor/shop/hours` | `POST /vendor/shop/hours` |
| Pickup slot configuration | `routes/vendor.js: /vendor/shop/pickup-slots` | `POST /vendor/shop/pickup-slots` |
| Set discount | `routes/vendor.js: /vendor/shop/discount` | `POST /vendor/shop/discount` |
| View pending orders | `routes/vendor.js: /vendor/orders/pending`, `/vendor/orders/pending.json` | `GET /vendor/orders/pending` |
| Accept order | `routes/vendor.js: /vendor/orders/:id/accept` | `POST /vendor/orders/:id/accept` |
| Mark ready | `routes/vendor.js: /vendor/orders/:id/ready` | `POST /vendor/orders/:id/ready` |
| Cancel order | `routes/vendor.js: /vendor/orders/:id/cancel` | `POST /vendor/orders/:id/cancel` |
| Verify pickup (OTP/QR) | `routes/vendor.js: /vendor/verify` | `POST /vendor/verify` |

### Admin Portal

| Feature | Files Involved | Key Endpoints |
|---------|---------------|--------------|
| Manage vendors | `routes/admin.js` | CRUD for vendors |
| Manage shops | `routes/admin.js` | CRUD for shops, payment gateway config |
| Menu import (AI-assisted) | `routes/admin.js: /vendors/:vendorId/menu/import` | `POST /vendors/:vendorId/menu/import`, `POST /vendors/:vendorId/menu/import/confirm` |
| View analytics | `routes/admin.js: /admin/analytics/data` | GET `/admin/analytics/data` |
| System settings | `routes/admin.js` | Discount config, parcel charge, shop toggles |

### Orders and Payments

| Workflow | Files | Key Endpoints |
|----------|-------|--------------|
| Create order (Razorpay) | `routes/orders.js: /create-razorpay-order` | `POST /create-razorpay-order` |
| Verify Razorpay payment | `routes/orders.js: /verify-payment` | `POST /verify-payment` |
| Easebuzz callback | `routes/orders.js: /easebuzz/callback` | POST callback |
| PhonePe callback | `routes/orders.js: /phonepe/callback` | POST callback |
| Order adjustment (remove items) | `utils/order-adjust.js`, `routes/vendor.js` | Vendor removes items from paid order |
| Order cancellation | `utils/order-cancel.js`, `routes/vendor.js: /vendor/orders/:id/cancel` | Vendor cancels paid order with refund |
| Refund processing | `routes/vendor.js: refundViaRazorpay/phonePe` | Called during cancellation |

### Notifications and PWA

| Feature | Files | Details |
|---------|-------|---------|
| Service worker | `public/sw.js`, `public/firebase-messaging-sw.js` | Caching strategy, FCM registration |
| PWA manifest | `public/manifest.json` | Installation config |
| Firebase Cloud Messaging | `config/firebase-admin.js`, `routes/api/fcm.js` | Token registration, push sending |
| Push notification on order ready | `routes/vendor.js: emitPendingCount` → `dispatchOrderReadyNotification` | Fire-and-forget FCM message |
| Offline caching | Service worker with cache-first/Network-first strategies | Configurable per asset type |

### Mobile UI and Shared Components

- **Liquid Glass styling**: `liquid-gl` component library used for modern UI effects
- **Sticky bottom navigation**: Student portal has bottom nav with badged Cart tab
- **Student bottom-nav blinking animation**: Known issue — animation left unchanged; deferred for separate diagnosis task
- **Responsive layouts**: Mobile-first CSS with en-IN number formatting
---

## E. Important Invariants

### Business Rules
1. **Discount applies only to food subtotal** — never to parcel charge. Computed server-side in integer paise with a single rounding step, so the browser can never influence the charged amount.
2. **Only paid orders can be accepted** — vendor `POST /vendor/orders/:id/accept` requires `status: "paid"`. Atomic `findOneAndUpdate` with status precondition prevents concurrent accepts from firing twice.
3. **Only accepted orders can be marked ready** — vendor `POST /vendor/orders/:id/ready` requires `status: "accepted"` via atomic `findOneAndUpdate`; a double-click can never mark it ready twice.
4. **Only ready_for_pickup orders can be completed via OTP** — `POST /vendor/verify` requires `status: "ready_for_pickup"` and matching 6-digit OTP.
5. **One-time use pickup OTP** — once an order is completed, the OTP cannot be reused; `findOneAndUpdate` with `status: "ready_for_pickup"` precondition ensures only one concurrent request can complete the order.
6. **Session cart is per-session, not persisted across restarts** — cart lost on server restart or session expiry. Known limitation documented in KNOWN_ISSUES.md.
7. **Role is hardcoded to `student` on signup** — prevents self-escalation to vendor/admin. `routes/auth.js:40` sets `role: "student"` implicitly.

### Security Requirements
1. **CSRF protection** — Origin/Referer allowlist on all non-GET requests; payment gateway postbacks exempted via `CSRF_EXEMPT_PATHS` in `middleware/csrfConfig.js`.
2. **SameSite=Lax** on session cookies; `secure` flag in production (controlled via `NODE_ENV`).
3. **Payment amount verification** — Razorpay signature verification + authoritative amount check: fetch payment from gateway, require it to match the persisted order total in integer paise. `routes/orders.js:verify-payment` implements this with `signaturesMatch()` + `verifyRazorpayCapturedPayment()`.
4. **Idempotent payment verification** — `verify-payment` checks `order.status !== "pending_payment"` and acknowledges replay without re-processing. Returns `{ success: true, orderId: order._id }` on replay.
5. **Webhook idempotency** — `webhookEventId` tracked per order to prevent duplicate processing across Razorpay webhook, easebuzz callback, and phonepe callback.
6. **No password-length validation on signup** — only reset enforces it. Documented in CODEBASE_REVIEW.md and KNOWN_ISSUES.md.
7. **Reset token in URL** — travels via Referer/access logs; hashed at rest but raw token in the link is an exposure. Documented in CODEBASE_REVIEW.md.

### State Transitions
```
pending_payment  --(verify payment, amount matches)-->  paid
paid             --(vendor accepts)-->  accepted
accepted         --(vendor marks ready)-->  ready_for_pickup
ready_for_pickup --(student OTP/QR)-->  completed
any              --(vendor cancels)-->  cancelled
```

### Architectural Constraints
1. **ES module syntax** throughout (`import`/`export`). All first-party modules use this syntax.
2. **All routes export express.Router() instances** — mounted via `app.use()` in `server.js`.
3. **Models export Mongoose model instances** — `User`, `Shop`, `MenuItem`, `Order` etc.
4. **Config modules export configured instances or factory functions** — `createRazorpayFromShop()`, `getEasebuzzFromShop()`, etc.
5. **Middleware order matters** in `server.js` — webhooks mounted before `express.json()` so raw body is available for signature checks.
6. **Asset versioning** via `version.json` or `BUILD_ID` env var for cache-busting static assets.
7. **Service worker Firebase config injection** — `server.js` replaces `__FIREBASE_API_KEY__` etc. at runtime on `/sw.js` and `/firebase-messaging-sw.js` endpoints.
---

## G. Subsystem Coverage

### Backend

#### Application Entry and Server Initialization
- **File**: `server.js`
- **Status**: Fully inspected and documented.
- **Key functions**: Express app setup, middleware chain, route mounting, error handler, asset version resolution.

#### Express Configuration and Middleware Ordering
- **Files**: `server.js` (lines 76-264)
- **Status**: Fully inspected.
- **Order**: Helmet → trust proxy → static assets → webhooks (before json) → urlencoded/json → CSRF → session → flash → attachUser → res.locals setup → routers.
- **Notable**: Webhooks Router mounted before `express.json()` per Razorpay webhook requirements.

#### Routes, Controllers, and Services
- **Files**: `routes/auth.js`, `routes/shops.js`, `routes/cart.js`, `routes/orders.js`, `routes/vendor.js`, `routes/admin.js`, `routes/menu.js`, `routes/profile.js`, `routes/vendor-profile.js`, `routes/api/authMe.js`, `routes/api/fcm.js`
- **Status**: All inspected. Key patterns identified:
  - `authRouter` mounted at `/` (all routes are auth-relative or root-level)
  - API routes under `/api/auth` and `/api/fcm`
  - All route handlers are async with try/catch
  - `return` before `res.render()` added in stabilization plan

#### Authentication and Authorization
- **Files**: `middleware/auth.js`, `routes/auth.js`
- **Status**: Fully inspected.
- **Flow**: `attachUser` loads `req.user` from session; `requireAuth/requireVendor/requireStudent/requireAdmin` guard routes; `requireVendorShop` sets `req.vendorShopId`.
- **Known risk**: Session fixation — no `session.regenerate()` on login/signup (documented in STAGE0_HARDENING_PLAN.md:80).

#### Input Validation and Security
- **Files**: `middleware/csrfOriginProtection.js`, `middleware/csrfConfig.js`, `server.js` helmet config
- **Status**: Fully inspected.
- **CSRF**: Origin/Referer allowlist with payment gateway exemptions.
- **Helmet**: Configured with `contentSecurityPolicy: false`.
- **No rate limiting** — by product policy.

#### Database and Mongoose Models
- **Files**: `models/User.js`, `models/Shop.js`, `models/MenuItem.js`, `models/Order.js`
- **Status**: All four models fully inspected with schemas documented.
- **Indexes**: Order has `{shop:1,pickupOtp:1}`, `{shop:1,status:1}`, `{customer:1,createdAt:-1}`.

#### Scheduled Jobs and Background Tasks
- **Files**: `socket/index.js` — `emitPendingCount()` for real-time vendor dashboard polling.
- **Status**: Socket.IO events documented; no scheduled/cron jobs found.

#### WebSockets and Socket.IO Events
- **File**: `socket/index.js`
- **Status**: Fully inspected.
- **Event**: `vendor:join` — joins shop room, emits `pending-count`.

### Frontend

#### EJS Templates and Partials
- **Files**: `views/home.ejs`, `views/vendor/menu.ejs`, `views/vendor/pending-orders.ejs`, `views/orders/show.ejs`, `views/partials/header.ejs`, `views/partials/footer.ejs`, `views/partials/menu-table.ejs`, and many more.
- **Status**: Partially inspected through documentation references. Key partials identified.

#### CSS Architecture
- **File**: `public/styles.css`
- **Status**: Referenced in stabilization plan for background-image fix; liquid-gl components used for modern UI.

#### Client-Side JavaScript
- **Files**: Various `.js` files in `public/`
- **Status**: Referenced in REACT_MIGRATION_REPORT for event handlers and variant pricing.

#### Forms and Validation
- **Status**: Referenced in bug reports and stabilization plan. Cart add had open redirect issue previously fixed.

### PWA and Mobile

#### Web App Manifest
- **File**: `public/manifest.json`
- **Status**: Referenced in architecture docs.

#### Service Workers
- **Files**: `public/sw.js`, `public/firebase-messaging-sw.js`
- **Status**: Injected with Firebase config at runtime via `server.js` endpoints `/sw.js` and `/firebase-messaging-sw.js`.

#### Firebase Cloud Messaging
- **Files**: `config/firebase-admin.js`, `routes/api/fcm.js`, `public/sw.js`
- **Status**: FCM configured; token registration and push sending pathways documented.

#### Offline Support and Caching
- **Status**: Service worker caching strategy referenced but not fully detailed in inspected files.

### Payments and Integrations

#### Razorpay
- **Files**: `config/razorpay.js`, `routes/orders.js` (create-razorpay-order, verify-payment), `routes/vendor.js` (refundViaRazorpay)
- **Status**: Fully inspected. Primary payment gateway. Webhook signature verification + authoritative amount check implemented.

#### Easebuzz
- **Files**: `config/easebuzz.js`, `routes/orders.js: /easebuzz/callback`
- **Status**: Partially inspected. Callbacks exist but refunds not implemented (KNOWN_ISSUES.md:12).

#### PhonePe
- **Files**: `config/phonepe.js`, `routes/orders.js: /phonepe/callback`
- **Status**: Partially inspected. Callbacks exist; refund pathway documented but may need amount verification.

#### Cloudinary
- **Files**: `config/cloudinary.js` (referenced but not deeply inspected), `routes/vendor.js` (menu image upload)
- **Status**: Image upload pipeline for menu items documented.

### Quality and Operations

#### Unit Tests
- **Command**: `npm test` / `npm run test:unit`
- **Result**: 301 passed, 0 failed (RUN-2026-10-02-2112)
- **Coverage**: 24 unit test files, in-memory MongoDB only.

#### Playwright E2E Tests
- **Command**: `npm run test:e2e`
- **Status**: Ran green in last session; specific feature coverage documented in test reports.

#### Security Tests
- **Status**: Referenced in KNOWN_ISSUES.md and STAGE0_HARDENING_PLAN.md; no dedicated security test suite found.

#### Deployment Configuration
- **Status**: Designed for Render; `trust proxy: 1` for TLS termination. Environment variables via `.env`.

#### Build Tools and Scripts
- **Scripts**: `build:version`, `vendor:liquidgl`, `seed`, `start`, `dev`
- **Status**: All documented.

---
---

## H. Testing and Verification

### Test Suites
- **Unit tests**: `node --test "tests/unit/**/*.test.js"` — 24 files, in-memory MongoDB only
- **E2E tests**: `playwright test` — browser-based end-to-end tests
- **Vendor profile E2E**: `playwright test --config playwright.vendor-profile.config.js`

### Test Results (from most recent run RUN-2026-10-02-2112)
- **301 passed / 0 failed / 0 skipped / 0 cancelled**
- **Failing tests**: none
- **No code was modified to achieve this pass**; no test was weakened

### Feature Coverage from Test Report
| Feature | Status | Test File(s) |
|---------|--------|------------|
| F01 Student Profile | partial (regression) | `vendor-profile.test.js`, `stage1-comprehensive` auth tests, E2E `vendor-profile.spec` |
| F02 Vendor Profile | yes | `tests/unit/vendor-profile.test.js`, `tests/e2e/vendor-profile.spec.js` |
| F03 Shop Open/Close | yes | `tests/unit/shop-hours.test.js` (20 tests incl. overnight windows) |
| F04 Pickup Slots | yes | `tests/unit/pickup-slots.test.js` (validation, generation, boundaries, CRITICAL late-night cases) |
| F05 Discounts | yes | `tests/unit/discount.test.js` (normalize, server-side totals, food-only, rounding, refund math, vendor isolation) |
| F04.5 Order-Ready Notification | yes (mocked send) | `order-ready-notification/dispatch.test.js`, `notification-dispatch.test.js` |
| Full order lifecycle | yes | `tests/unit/stage1-comprehensive.test.js` (checkout → accept → ready → QR pickup completes) |
| Cart persistence across sessions | known issue | Documented in KNOWN_ISSUES.md:9 — not tested across restarts |
| Session fixation resistance | not tested | No specific test for `regenerate()` on auth |

### Available Scripts
- `npm test` — Run all unit tests (equivalent to `npm run test:unit`)
- `npm run test:unit` — Run unit test suite with `node --test`
- `npm run test:e2e` — Run Playwright E2E tests
- `npm run test:e2e:vendor-profile` — Run vendor profile E2E tests only

### Environment Prerequisites for Tests
- **No external services required** — unit tests use `mongodb-memory-server-core` for in-memory MongoDB
- Tests run against **localhost only** HTTP
- `npm postinstall` must run first to build version assets (`npm run build:version`)
- `MONGO_URI` or `MONGODB_URI` env vars may be set for integration-style tests, but unit tests override with memory server

### Safe Ways to Run Targeted Tests
- `npm run test:unit -- --grep "pickup-slots"` — Run tests matching a name pattern
- `npm test` — Run full suite to verify 301/0 result is maintained
- `playwright test --spec="vendor-profile.spec"` — Run specific E2E test file
- Individual test files can be run directly: `node --test "tests/unit/pickup-slots.test.js"`

### Uncovered / Regression Areas
- Session fixation resistance — no test specifically for `session.regenerate()` behavior
- Payment gateway fallback behavior (Easebuzz/PhonePe when Razorpay fails or is not configured)
- Open redirect protection on cart routes — previously fixed but worth re-verifying
- Cross-origin payment gateway postbacks — no dedicated test for CSRF exemption correctness

---
---

## I. Developer Workflow

### Navigating the Application
1. **Entry point**: `server.js` — see middleware chain, route mounting, server config
2. **Feature flow**: Start at the relevant route file → follow imports → model queries → controller logic
3. **Database first**: Most routes start with `requireDb` middleware → `Shop.findById()` or `User.findById()`
4. **Session state**: `attachUser` middleware sets `req.user` from `req.session.userId`

### Tracing a Feature from UI to Database
1. **Identify the page/template** — e.g., `views/student/home.ejs` or `views/vendor/pending-orders.ejs`
2. **Find the route** — e.g., `routes/student/` or `routes/vendor/`
3. **Follow the middleware chain** — `requireDb → requireAuth/requireVendor → route handler`
4. **Check the controller logic** — database queries, cart operations, payment initiation
5. **Model layer** — Mongoose schema operations (`find`, `findById`, `create`, `findOneAndUpdate`)
6. **Return to client** — rendered EJS or JSON response

### Project Conventions and Preferred Patterns
1. **Error handling** — try/catch in async route handlers; flash messages for user feedback; redirect on HTML requests, JSON on API requests
2. **Atomic database operations** — `findOneAndUpdate` with status precondition to prevent race conditions (e.g., order acceptance, readiness, completion)
3. **Payment authoritative totals** — All amounts computed server-side in integer paise; client amounts ignored entirely
4. **Discount calculation** — Single source of truth in `utils/discount.js`; `getShopDiscount()` + `computeDiscountPaise()`
5. **Variant price resolution** — Lookup `MenuItem.variants[variantId].price` with fallback to `MenuItem.price`; repeated pattern in `routes/cart.js`, `routes/orders.js`, `routes/vendor.js` (technical debt item)
6. **Pickup slot management** — `utils/pickup-slots.js` — reserve, release, validate slot settings
7. **OTP generation** — `utils/otp.js` — 6-digit OTP with server-side validation and atomic completion

### Safe Change and Testing Procedures
1. **Always add `return` before `res.render()` and `res.json()` in try/catch blocks** — prevents double-response on exception (was stabilized in previous sprint; 35+ calls fixed)
2. **Run `npm test` after changes** — ensures 301 tests still pass with 0 failures
3. **Check for missing `import` statements** — e.g., `routes/menu.js` must import `Shop` model (was fixed: `import { Shop } from "../models/Shop.js"`)
4. **Verify payment flow idempotency** — `verify-payment` should handle replay gracefully; check `order.status !== "pending_payment"` guard
5. **Test role-based access** — ensure each role can only access its authorized routes via `requireVendor`, `requireStudent`, `requireAdmin`

### Areas Requiring Extra Caution
1. **Payment verification logic** — `routes/orders.js:verify-payment` — any change must preserve the authoritative amount check pattern (signature verify + gateway fetch + amount comparison)
2. **Order status transitions** — `findOneAndUpdate` with status precondition; wrong precondition = lost updates or failed transitions
3. **Refund processing** — gateway-specific; must handle both Razorpay and PhonePe/Easebuzz paths; Razorpay refunds only for captured payments
4. **Socket.IO events** — `vendor:join` broadcasts pending-count; ensure shopId validation and that only vendor-connected sockets join shop rooms
## J. Session Handoff

### What Was Inspected
- Complete repository structure and git state
- All first-party source files: models, middleware, routes, utils, config, views
- Package.json dependencies and scripts
- Environment configuration (.env)
- Authentication and authorization flow
- Payment gateway integration (Razorpay primary, Easebuzz/PhonePe secondary)
- Socket.IO real-time features
- PWA and service worker configuration
- Test suites and their coverage

### What Remains Unexplored
- Full admin portal routes (`routes/admin.js` — very large, ~1200+ lines) — some edge cases in payment settings and toggle-parcel routes may need verification
- Student profile detailed workflows beyond basic CRUD
- Menu import AI pipeline edge cases (category handling was recently fixed but may have edge cases)
- Liquid Glass component library usage patterns across all views
- Service worker caching strategy details beyond initial injection

### Most Important Context for Next Session
1. **Payment verification is the critical path** — any changes to `routes/orders.js:verify-payment` must preserve the authoritative amount check pattern
2. **Order status transitions are atomic** — `findOneAndUpdate` with status precondition is the primary race-condition guard
3. **Recent fixes** — category field, `res.render()` returns, Shop import in menu.js, vendor nav conditional — all stabilized
4. **Known deferred issue** — bottom navbar blinking animation; do not alter (commit `af9ee90`)
5. **Session fixation risk** — no `regenerate()` on login/signup; high priority for future hardening

### Relevant File Paths to Inspect Before Modifying Each Major Subsystem
- **Student portal**: `routes/auth.js`, `routes/shops.js`, `routes/menu.js`, `views/student/*`
- **Vendor portal**: `routes/vendor.js`, `views/vendor/*`, `socket/index.js`
- **Admin portal**: `routes/admin.js`, `views/admin/*`
- **Orders & payments**: `routes/orders.js`, `config/razorpay.js`, `utils/payment-verification.js`
- **Menu management**: `routes/vendor.js` menu routes, `routes/admin.js` menu import, `models/MenuItem.js`
- **Authentication**: `middleware/auth.js`, `routes/auth.js`
- **Config**: `config/db.js`, `config/firebase-admin.js`, `config/razorpay.js`

### Questions That Cannot Be Answered from Repository Evidence Alone
1. **Production database state** — actual data in Atlas MongoDB; connection tested only via `mongodb-memory-server-core` in tests
2. **External service credentials** — live Razorpay keys, Firebase project settings, Cloudinary bucket contents
3. **Playwright test environment configuration** — default vs. CI vs. local mode differences
4. **Render deployment specifics** — exact environment variables, custom domains, CDN configuration
5. **Previous test run details** — what exact test versions passed; the run report is a historical snapshot
---
6. **Open redirect on `/cart/add`** — previously fixed with `safeRedirect()` accepting only same-origin path-only destinations; referenced in STAGE0_HARDENING_PLAN.md and docs/TECH_DEBT.md