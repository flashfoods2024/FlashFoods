# 01 — Codebase Audit (verified)

Every statement marked **EXISTING** was verified by reading the source in this
repository. Statements marked **PROPOSED** are new work. Statements marked
**UNVERIFIED** must be confirmed by the implementing agent before relying on
them.

The implementing agent must re-inspect these files before editing: source can
change after this audit.

---

## 1. Application stack

**EXISTING**

| Aspect | Value | Evidence |
|---|---|---|
| Runtime | Node.js, ES modules (`"type": "module"`) | `package.json` |
| Web framework | Express `^5.2.1` | `package.json`, `server.js` |
| Database | MongoDB via Mongoose `^8.14.2` | `package.json`, `config/db.js` |
| Templating | EJS `^5.0.2`, server-side rendering | `server.js` (`app.set("view engine","ejs")`) |
| Sessions | `express-session` `^1.18.1`, default MemoryStore | `server.js`, `.ai/STATUS.md` known issue |
| Flash | `connect-flash` `^0.1.1` | `server.js` |
| Security headers | `helmet` `^8.2.0` with `contentSecurityPolicy: false` | `server.js` |
| CSRF | Custom Origin/Referer allowlist middleware (no tokens) | `middleware/csrfOriginProtection.js`, `middleware/csrfConfig.js` |
| Uploads | `multer` `^2.1.1` + `multer-storage-cloudinary` `^4.0.0` (images only) | `middleware/upload.js`, `config/cloudinary.js` |
| Images | `sharp` `^0.32.6` | `package.json` |
| Payments | `razorpay` `^2.9.6`, Easebuzz (custom `crypto` client), PhonePe (custom `fetch` client) | `config/*.js`, `routes/orders.js`, `routes/vendor.js` |
| Webhooks | Raw-body Razorpay webhook mounted before `express.json()` | `server.js`, `routes/webhooks.js` |
| Realtime | `socket.io` `^4.8.3` | `socket/index.js` |
| Push | `firebase-admin` `^13.2.0` | `config/firebase-admin.js`, `utils/notification-dispatch.js` |
| QR | `qrcode` `^1.5.4` | `routes/orders.js` |
| Email | `resend` `^6.17.1` | `utils/email.js` |
| Rate limiting | None by product policy | comment in `server.js` |
| PDF libraries | **None installed** — no `pdf-lib`, no `@pdf-lib/fontkit`, no `pdfjs-dist` in `package.json` or `package-lock.json` | verified by search |

**Gap:** all three PDF dependencies are PROPOSED additions.

---

## 2. Actual relevant models

### 2.1 `models/Shop.js` — EXISTING

Fields: `name`, `slug` (unique, lowercase), `description`, `image`,
`vendor` (ref `User`, default null), `paymentGateway`
(`razorpay | easebuzz | phonepe | paytm | bharatpe`), `paymentConfigured`,
`paymentSettings` (`merchantId`, `apiKey`, `apiSecret`, `razorpay{keyId,keySecret,webhookSecret}`,
`easebuzz{merchantKey,salt,env}`, `phonepe{clientId,clientSecret,clientVersion,env}`),
`isOpen`, `openingTime`, `closingTime`, `pickupSlots{enabled,startTime,endTime,durationMinutes,capacity,daysAhead}`,
`discount{enabled,percent}`, `isActive`, `disabledAt`, `parcelChargeEnabled`,
`parcelCharge`, plus `timestamps`.

Not present (must not be assumed): business address, GSTIN, phone, email,
invoice prefix, invoice counter, legal name, bank details, tax configuration,
billing template reference.

**Gap:** invoice template configuration, template versions and field mappings are NEW.

### 2.2 `models/Order.js` — EXISTING

Order item subdocument (`_id: false`): `menuItem`, `name`, `price` (unit price
captured at order time, already variant-aware), `quantity`, `status`
(`active|removed`), `variantId`, `variantName`, `variantPrice`.

Order fields: `customer` (ref `User`), `shop` (ref `Shop`), `items`,
`orderType` (`parcel|dinein`), `parcelCharge`, `discountPercent`,
`discountAmountPaise`, `total`, `pickupTime`, `pickupReminderSent`,
`collectedAt`, `pickupMethod` (`qr|otp|null`), `status`
(`pending_payment|paid|accepted|ready_for_pickup|completed|cancelled`),
`pickupOtp` (required), `paymentNote` (default `"pending"`, `"mock"` for mock
checkout), `transactionId`, `razorpayOrderId`, `razorpayPaymentId`,
`webhookEventId`, `gatewayTxnId`, `readyAt`, `refundStatus`
(`none|pending|completed|failed`), `refundId`, `refundProcessedAt`,
`amountChargedPaise` (authoritative captured amount in paise), `originalTotal`,
`updatedTotal`, `refundAmount`, `adjustedAt`, `adjustedBy`, `adjustmentReason`
(`Out of Stock | Preparation Issue | Ingredient Unavailable | Kitchen Issue | Other`),
plus `timestamps`.

Indexes: `{shop,pickupOtp}`, `{shop,status}`, `{customer,createdAt:-1}`,
`{status,createdAt}`, `{shop,createdAt}`, `{shop,pickupTime,createdAt}`,
unique sparse `razorpayOrderId`, unique sparse `gatewayTxnId`.

Not present: invoice reference, invoice number, billed address, tax amounts,
GSTIN, invoice status.

**Gap:** invoice record/snapshot is NEW. No `Order` schema change is strictly
required (see `06_STORAGE_SECURITY_AND_INTEGRATION.md` §9 for the two options).

### 2.3 `models/User.js` — EXISTING

`name`, `email` (unique, lowercase), `passwordHash`, `role`
(`student|vendor|admin`), `shop` (ref `Shop`), `phone`, `isActive`,
`disabledAt`, `resetPasswordToken`, `resetPasswordExpires`, `timestamps`.

Not present: address, GSTIN, business name, billing email.

### 2.4 `models/MenuItem.js` — EXISTING

`shop`, `name`, `category`, `description`, `price`, `image`, `available`,
`foodType` (`veg|non-veg|egg|unknown`), `variants[{label,price}]`, index
`{shop,name}`, `timestamps`.

Not present: HSN/SAC code, tax rate, unit of measure for invoicing.

---

## 3. Actual routes (verified)

### 3.1 Vendor — `routes/vendor.js` (mounted at `/` in `server.js`)

| Method | Path | Notes |
|---|---|---|
| GET | `/vendor/menu` | Renders `vendor/menu` with `shop`, `availability`, `slotSettings`, `discountSettings`, `menuItems`; chain `requireDb, requireAuth, requireVendor, requireVendorShop` |
| POST | `/vendor/shop/toggle` | Open/close master switch (blocked when `isActive === false`) |
| POST | `/vendor/shop/hours` | Saves `openingTime`/`closingTime` via `validateOperatingHours` |
| POST | `/vendor/shop/pickup-slots` | Saves `shop.pickupSlots` via `validatePickupSlotSettings` |
| POST | `/vendor/shop/discount` | Saves `shop.discount` via `validateDiscountSettings` |
| POST | `/vendor/menu` | Create menu item (multipart, `handleMenuImageUpload`) |
| PATCH | `/vendor/menu/:id` | Update item |
| DELETE | `/vendor/menu/:id` | Delete item |
| POST | `/vendor/menu/parcel-charge` | Saves parcel settings, recomputes totals via `computeParcelTotals` |
| GET | `/vendor/orders/pending` | Pending orders page |
| GET | `/vendor/orders/pending.json` | Pending orders JSON |
| POST | `/vendor/orders/:id/mark-reminder-sent` | Reminder flag |
| POST | `/vendor/orders/:id/ready` | `accepted → ready_for_pickup` (atomic) |
| POST | `/vendor/orders/:id/accept` | `paid → accepted` (atomic) |
| POST | `/vendor/orders/:id/cancel` | Uses `cancelOrderPaid` |
| GET | `/vendor/verify` | Pickup verification page (lists `ready_for_pickup`) |
| POST | `/vendor/verify` | **OTP completion** — atomic `ready_for_pickup → completed`, sets `collectedAt`, `pickupMethod: "otp"` |
| POST | `/vendor/verify-qr` | **QR completion** — verifies signed token via `verifyPickupQr`, atomic `ready_for_pickup → completed`, `pickupMethod: "qr"` |
| POST | `/vendor/orders/:id/toggle-parcel` | Switches order type/parcel |
| GET | `/vendor/orders/:id/adjust` | Adjustment form (`paid|accepted` only) |
| POST | `/vendor/orders/:id/adjust` | `adjustOrderPaid` + gateway partial refund |
| GET | `/vendor/orders/completed` | Completed orders |
| GET | `/vendor/orders/:id` | Vendor order detail |
| GET/POST | `/vendor/payment/settings` | Gateway credentials |

**Gap:** no billing-template routes. New upload/preview/configure/activate/
replace/remove routes are PROPOSED, following the exact middleware chain above.

### 3.2 Student orders — `routes/orders.js` (mounted at `/`)

| Method | Path | Notes |
|---|---|---|
| POST | `/create-razorpay-order` | Creates `pending_payment` order + Razorpay order |
| POST | `/verify-payment` | HMAC signature check + `verifyRazorpayCapturedPayment` amount check, atomic `pending_payment → paid`, sets `amountChargedPaise` |
| POST | `/easebuzz/initiate` | Creates `pending_payment` order |
| POST | `/easebuzz/callback` | Hash-verified; `paid`/`cancelled`; sets `amountChargedPaise = toPaise(order.total)` |
| POST | `/phonepe/initiate` | Creates `pending_payment` order |
| POST | `/orders/checkout` | **Mock/offline** checkout; hard-blocked unless `shop.slug === "testing"`; creates `paid` order with `paymentNote: "mock"`, `amountChargedPaise: totalPaise` |
| GET | `/orders` | Student order list |
| GET | `/api/orders/:id/status` | Polling JSON (owner-scoped) |
| GET | `/orders/:id` | Order detail; owner check; QR generated only when `ready_for_pickup` |
| POST | `/phonepe/callback` | PhonePe status verification; sets `amountChargedPaise` from verdict |

**Gap:** no invoice route or invoice UI.

### 3.3 Webhooks — `routes/webhooks.js`

`POST /webhooks/razorpay` with `express.raw()`: verifies signature using
shop-specific secret (fails closed), rejects duplicate `x-razorpay-event-id`,
`payment.captured` → atomic `pending_payment → paid` (sets `amountChargedPaise =
toPaise(order.total)` — **no independent amount comparison**), `payment.failed`
→ `cancelled` + slot release.

### 3.4 Admin — `routes/admin.js` (mounted at `/admin`)

`GET /admin/orders`, `GET /admin/orders/:id`, `POST /admin/orders/:id/toggle-parcel`,
plus shop/vendor/student/menu/analytics routes.

**Verified:** there is **no admin route that sets an order's status**. Admin
order pages read and filter only. Therefore no administrative completion path
exists today; the implementing agent must re-verify this before finalizing the
completion-path list.

### 3.5 Other mounts

`routes/auth.js`, `routes/api/authMe.js`, `routes/shops.js`, `routes/cart.js`,
`routes/menu.js`, `routes/profile.js`, `routes/vendor-profile.js`,
`routes/api/fcm.js` (mounted at `/api/fcm`) — unrelated to billing except as
regression surface.

---

## 4. Actual middleware

| File | Exports | Behavior |
|---|---|---|
| `middleware/auth.js` | `attachUser`, `requireAuth`, `requireVendor`, `requireStudent`, `requireAdmin`, `requireVendorShop`, `resolveAdminVendorShop` | `requireVendorShop` requires role `vendor` and `user.shop`, then sets `req.vendorShopId` and `req.vendorShopIdStr`; redirects with flash otherwise |
| `middleware/upload.js` | `uploadMenuImage`, `uploadShopImage`, `handleMenuImageUpload`, `handleAdminMenuImageUpload`, `handleShopImageUpload` | Multer + `CloudinaryStorage`; `fileFilter` accepts only `image/*`; `limits.fileSize = 5MB`; error redirects with flash. **Image-specific.** |
| `middleware/csrfOriginProtection.js` | `csrfOriginProtection` | Applies to POST/PUT/PATCH/DELETE; skips `CSRF_EXEMPT_PATHS`; prefers `Origin`, falls back to `Referer`; allows request `Host`; 403 otherwise |
| `middleware/csrfConfig.js` | `ALLOWED_CSRF_ORIGINS = ["www.flashfoods.in"]`, `CSRF_EXEMPT_PATHS = ["/easebuzz/callback", "/phonepe/callback"]` | Configuration |
| `middleware/requireDb.js` | `requireDb` | DB connection guard used by order/vendor routes |

**Gap:** no PDF upload middleware, no document storage, no invoice access
middleware. PROPOSED additions must reuse the `handleXUpload` error-handling
shape and the CSRF/ownership conventions above.

---

## 5. Existing vendor menu rendering

**EXISTING**

- `views/vendor/menu.ejs` (22 lines): a compact hero plus
  `include("../partials/menu-manager", {...locals})`. It passes `shop`,
  `menuItems`, `createAction: "/vendor/menu"`, `apiUrl: "/vendor/menu"`,
  `toggleApiUrl: "/menu"`, `showShopToggle: true`,
  `shopToggleAction: "/vendor/shop/toggle"`,
  `operatingHoursAction: "/vendor/shop/hours"`,
  `pickupSlotsAction: "/vendor/shop/pickup-slots"`,
  `discountAction: "/vendor/shop/discount"`,
  `parcelChargeAction: "/vendor/menu/parcel-charge"`.
- `views/partials/menu-manager.ejs` (546 lines) renders, in order:
  1. Shop Status card (open/close toggle + hours summary),
  2. Discount card (only when `locals.discountAction`),
  3. **Pickup Slots card** (`locals.pickupSlotsAction`),
  4. **Operating Hours card** (`locals.operatingHoursAction`, lines ~109–126),
  5. Parcel Packaging card (`locals.parcelChargeAction`),
  6. Add new item form,
  7. Menu items table with inline edit/delete/toggle JS.
- The partial's header comment documents optional locals; the card order above
  is verified.

**So:** the locked placement "after Pickup Slots and before Operating Hours"
corresponds to inserting a new card between the Pickup Slots block and the
`<% if (locals.operatingHoursAction) { %>` block in this partial. The Billing
Template card should be opt-in via a new local (for example
`billingTemplateAction`) so the admin menu reuse of this partial does not
suddenly render vendor billing UI.

`views/orders/show.ejs` (143 lines) — see §6.

---

## 6. Existing order detail rendering

**EXISTING**

- `GET /orders/:id` (`routes/orders.js`) loads the order with
  `populate("shop","name slug")`, enforces
  `String(order.customer) === String(req.session.userId)`, builds `pickupQr`
  only when `status === "ready_for_pickup"`, and renders `orders/show`.
- `views/orders/show.ejs` renders: breadcrumb, status label/pill, shop name and
  created-at in IST, order type and pickup time, adjustment notice
  (`adjustNote`: removed names, refund amount, updated total, reason), a
  5-step progress tracker, status-specific messaging (pickup code and QR for
  `ready_for_pickup`), an items list (`quantity x name`, variant, line amount,
  "(unavailable)" for removed), parcel charge line, total using
  `order.updatedTotal || order.total`, then `partials/student-bottomnav`, and a
  5-second poll of `/api/orders/:id/status` that reloads on status/adjustment
  change.
- `views/orders/index.ejs` (36 lines) lists orders with status pills, shop,
  order type, parcel charge, `updatedTotal || total`, created-at, refund line
  when adjusted.

**Gap:** no invoice link/button, no invoice status display. PROPOSED: a
download control shown only when an issued **custom** invoice exists; the
existing default bill above stays unchanged for every shop without an active
template (no generic PDF fallback).

---

## 7. Existing payment and pickup lifecycle

**Order status enum (EXISTING):** `pending_payment → paid → accepted →
ready_for_pickup → completed`, plus `cancelled`.

**Payment evidence (EXISTING):**

| Path | Evidence written |
|---|---|
| `POST /verify-payment` (Razorpay) | `verifyRazorpayCapturedPayment` requires `status === "captured"` and exact `amount` match; writes `amountChargedPaise = actualPaise` |
| `POST /webhooks/razorpay` (`payment.captured`) | atomic paid; writes `amountChargedPaise = toPaise(order.total)` (derived from order, not from `payment.amount`) |
| `POST /easebuzz/callback` | hash-verified; writes `amountChargedPaise = toPaise(order.total)`; code comment states Easebuzz amount verification is outstanding |
| `POST /phonepe/callback` | `verifyPhonePeCompletedPayment` amount check; writes `amountChargedPaise = verdict.actualPaise` |
| `POST /orders/checkout` (mock) | `paymentNote: "mock"`, `transactionId: "mock"`, `status: "paid"`, `amountChargedPaise = totalPaise`; only `shop.slug === "testing"` |

**Pickup completion (EXISTING):** exactly two paths, both atomic
`findOneAndUpdate({status:"ready_for_pickup"})` scoped by `shop`:
`POST /vendor/verify` (OTP, `pickupMethod:"otp"`) and `POST /vendor/verify-qr`
(QR, `pickupMethod:"qr"`). Both set `collectedAt`. QR tokens are HMAC-signed and
shop-bound (`utils/qr-pickup.js`); replay is blocked by the status precondition.
There is no time-based pickup expiry.

**Consequence for invoicing:** `completed` implies the order passed through
`paid`, but the *amount* evidence differs per gateway. The invoice generator
must read `amountChargedPaise`/`paymentNote` rather than infer capture from
status (see lock in `00_PRODUCT_CONTRACT.md` §7).

---

## 8. Existing financial calculations

**EXISTING, authoritative**

- `utils/money.js`: `toPaise(amount)`, `fromPaise(paise)`. Integer paise
  boundary; `toPaise` rejects `null`/`undefined`/`""`.
- `utils/discount.js`: `normalizeDiscountPercent`, `getShopDiscount`,
  `computeDiscountPaise(foodPaise, percent)` (single rounding step, clamped),
  `validateDiscountSettings`. Discount applies to food subtotal only.
- `utils/order-math.js`: `normalizeKeepIndices`,
  `computeAdjustedTotals({items, keepIndices, orderType, parcelChargePaise, discountPercent})`,
  `computeParcelTotals({items, orderType, parcelChargePaise, discountPercent})`.
- `utils/pricing.js`: `computeParcelCharge(shop, orderType)`,
  `computeOrderTotal(foodTotal, shop, orderType)`.
- `utils/order-adjust.js`: `adjustOrderPaid` — atomic claim
  `{status in [paid, accepted], adjustedAt: null}`, marks items
  `active`/`removed`, writes `originalTotal`, `updatedTotal`, `refundAmount`,
  `total = updatedTotal`, `adjustedAt`, `adjustedBy`, `adjustmentReason`,
  `refundStatus`; partial refund via injected `refundFn`; mock orders skip the
  gateway.
- `utils/order-cancel.js`: `cancelOrderPaid` — `paid → cancelled` with atomic
  `refundStatus: none → pending` claim, refund via injected function.
- `routes/orders.js` `buildOrderItemsFromCart(cart, shop, orderType)` computes
  `foodTotalPaise`, `parcelChargePaise`, `discountPaise`, `totalPaise` and
  returns rupee values via `fromPaise`. This is the single source of order
  amounts.
- Persistence convention: `Order.total`, `parcelCharge`, `originalTotal`,
  `updatedTotal`, `refundAmount` are **rupees**; `discountAmountPaise` and
  `amountChargedPaise` are **paise**.

**Not present:** tax computation, tax-inclusive flags, tax lines, rounding rules
for tax, invoice rounding, amount-in-words helper.

**Gap:** an invoice-side money module that converts and reconciles persisted
values must be NEW, and must not duplicate `toPaise`/`fromPaise` or
`computeDiscountPaise`.

---

## 9. Existing storage configuration

**EXISTING**

- `config/cloudinary.js` configures the SDK from `CLOUDINARY_CLOUD_NAME`,
  `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`; exports
  `isCloudinaryConfigured()`, `menuImageStorage`, `shopImageStorage`.
- Both storages set `folder` (`fast-food/menu-items`, `fast-food/shops`),
  `allowed_formats: ["jpg","jpeg","png","webp"]`, `resource_type: "image"`, and
  image transformations.
- `middleware/upload.js` enforces `image/*` and 5 MB, and turns failures into
  flash + redirect.
- `server.js` serves `public/` statically. Nothing else is exposed.
- `public/fonts/` currently contains `Transcity-DEMO.otf` only; the repo root has
  `1001fonts-transcity-eula.txt`. No Roboto assets exist.
- No local document/upload directory is configured in application code; the repo
  has a `temp/` folder used by the QA harness *(`temp/qa-vendor-profile-fixture.json`)*,
  which is not a storage subsystem.

**UNVERIFIED / PROPOSED:** whether Cloudinary raw resources can store and serve
PDFs with authenticated delivery under this project's account and SDK version.
Do not assume it. Default to private local storage with an adapter boundary
(`06_STORAGE_SECURITY_AND_INTEGRATION.md` §3), and record the decision.

---

## 10. Existing testing infrastructure

**EXISTING**

- `npm test` / `npm run test:unit` → `node --test "tests/unit/**/*.test.js"`.
  23 unit files exist, including `money.test.js`, `order-math.test.js`,
  `discount.test.js`, `order-adjust.test.js`, `order-cancel.test.js`,
  `payment-verification.test.js`, `qr-pickup.test.js`, `f07-pickup.test.js`,
  `f07-qr-guard.test.js`, `pickup-slots.test.js`, `webhook-signature.test.js`.
  Unit tests use `mongodb-memory-server-core` where a DB is needed.
- `npm run test:e2e` → default `playwright.config.js`. `.ai/test.md` marks this
  **blocked**: `tests/global-setup.mjs` and `tests/global-teardown.mjs` connect to
  `MONGO_URI` and mutate data.
- `npm run test:e2e:vendor-profile` → `playwright.vendor-profile.config.js`,
  which boots `scripts/qa-vendor-profile-server.mjs`: starts
  `MongoMemoryServer`, overrides `MONGO_URI`/`MONGODB_URI`/`PORT`/`SESSION_SECRET`
  **before** importing `server.js`, seeds fixtures, serves on `QA_PORT` (3123
  default). This is the sanctioned isolated-harness pattern.
- `tests/unit/`, `tests/e2e/`, `tests/mobile/`, `tests/instrumentation/`
  directories exist; specs include `smoke.spec.js`, `login.spec.js`,
  `student-workflow.spec.js`, `vendor-workflow.spec.js`, `permissions.spec.js`.
- `.ai/test.md` forbids production DB, live gateway calls, real FCM, real
  Cloudinary, real Gemini, `npm run seed`, default e2e, and printing `.env`
  values.

**Gap:** no PDF fixture, no invoice tests, no isolated harness variant that
covers invoice routes. PROPOSED: add fixtures and an isolated harness following
the existing pattern.

---

## 11. Existing UI conventions (relevant constraints)

**EXISTING**

- Vendor/admin screens use `.card`, `.h2`, `.form`, `.btn`, `.tag`, `.table`,
  `.muted`, `.small`, `.row`, `.hero` classes from `public/styles.css`.
- `.ai/UI_STANDARD.md` and `.ai/rules.md` §17 lock student-portal UI to
  `@media (max-width: 767px)` and freeze desktop rendering (≥768 px) on every
  screen, with a documented Student Home exception (F08-D3).
- Vendor screens are not part of the student `portal-*` system; new vendor UI
  must use the existing vendor card/form classes and must not alter desktop
  rendering of existing vendor screens beyond adding the new card.
- Student order detail uses `portal-*` classes and must stay consistent with
  `.ai/UI_STANDARD.md`; any new invoice control inside `views/orders/show.ejs`
  must follow the same mobile scoping rules.

---

## 12. Missing functionality this feature must introduce

| # | Missing now | Introduced by |
|---|---|---|
| 1 | `pdf-lib`, `@pdf-lib/fontkit`, `pdfjs-dist` dependencies | Phase 1–2 |
| 2 | Bundled Roboto Regular/Medium/Bold + licence | Phase 1 |
| 3 | Template model(s): template, immutable versions, field mapping | Phase 1 |
| 4 | Private PDF storage adapter + PDF validation middleware | Phase 1 |
| 5 | Vendor Billing Template card in `views/partials/menu-manager.ejs` (after Pickup Slots, before Operating Hours) | Phase 1–2 |
| 6 | Upload / preview / configure / activate / replace / remove routes | Phase 1–2 |
| 7 | PDF.js browser preview + coordinate capture + PDF.js→PDF conversion | Phase 2 |
| 8 | Overlay renderer: Roboto embedding, text, item table, overflow, continuation pages | Phase 2 |
| 9 | Sample preview renderer | Phase 2 |
| 10 | Invoice data builder from persisted `Order`/`Shop`/`User` | Phase 3 |
| 11 | Invoice numbering (atomic, shop-scoped) | Phase 3 |
| 12 | Invoice record + immutable snapshot + generated PDF storage | Phase 3 |
| 13 | Completion integration (QR + OTP paths) and lazy ensure-on-download | Phase 3 |
| 14 | Student invoice download route + order-detail control | Phase 4 |
| 15 | Default-bill fallback: keep the existing order-detail bill for shops without an active custom template (no generic PDF) | Phase 4 |
| 16 | Invoice test suite, PDF fixtures, isolated harness coverage | Phase 5 |

---

## 13. Audit method

- Listed the repository root and the `models/`, `routes/`, `middleware/`,
  `utils/`, `config/`, `views/`, `tests/`, `scripts/`, `public/` trees.
- Read the models, middleware, financial utilities, `server.js`, the vendor route
  file's route table and key handlers, the order route file's payment/checkout/
  detail handlers, `routes/webhooks.js`, the admin route table, the vendor menu
  view and menu-manager partial, the student order views, `.ai/ORCHESTRATOR.md`,
  `.ai/rules.md`, `.ai/BUSINESS_RULES.md`, `.ai/ARCHITECTURE.md`,
  `.ai/COMMON_PATTERNS.md`, `.ai/DEPENDENCY_GRAPH.md`, `.ai/STATUS.md`,
  `.ai/test.md`, `.ai/UI_STANDARD.md`, and `package.json`.
- Confirmed absence of PDF dependencies by searching `package.json` and
  `package-lock.json`.
- Confirmed absence of any `res.sendFile`/download handler in `routes/`.
- Route line numbers and handler semantics cited above come from the actual
  source read during this audit; re-verify before editing.
- Nothing outside the repository was inspected. No application file was modified.

**UNVERIFIED items carried forward:**

1. Cloudinary raw/PDF storage + delivery capability under this project account.
2. Whether `pdfjs-dist` worker assets are compatible with the existing static
   asset/versioning scheme (`assetVersion`, service worker precache).
3. Exact behavior of Express 5 route matching for any new nested path
   (verify by test, not assumption).
4. Whether any third completion path exists outside `routes/vendor.js`
   (admin currently has none — re-verify).
5. Roboto's `₹` glyph coverage in the specific bundled TTF version (must be
   proven by test).
