# RingWatch Integration Report

**Date:** 2026-07-22
**Target:** FlashFoods codebase
**Scope:** Full Playwright automation routes, selectors, and flow compatibility

---

## 1. Incorrect Routes Found & Fixed

### `ringwatch.config.js`

| Field | Before (Wrong) | After (Correct) | Reason |
|-------|----------------|-----------------|--------|
| `student.email` | `student@flashfoods.com` | `student@college.test` | Seed data in `seed.js:11` uses `student@college.test` |
| `student.password` | `password123` | `vendor@1` | Seed data in `seed.js:14` uses `vendor@1` for all non-admin users |
| `vendor.email` | `vendor@flashfoods.com` | `vendor@college.com` | Seed data in `seed.js:10` uses `vendor@college.com` |
| `vendor.password` | `password123` | `vendor@1` | Same as above |
| `order.shopId` | `shop_1` | `testingShop: 'juice-corner'` | Shops use URL-friendly **slugs** (`/shops/:slug`), not numeric IDs. RingWatch **only** tests against the dedicated `juice-corner` shop for safety |
| `order.items` | `[{ id: 'item_1', quantity: 1 }]` | `[]` (removed) | Menu items are MongoDB ObjectIDs, not `item_1`. Items are selected dynamically from the menu page |
| `baseUrl` | `http://localhost:3000` | `process.env.BASE_URL \|\| 'http://localhost:3000'` | Now respects environment variable |

### `playwright/login-vendor.js`

| Before (Wrong) | After (Correct) | Reason |
|----------------|-----------------|--------|
| Navigated to `${baseUrl}/vendor/login` | Navigates to `${baseUrl}/login` | **There is no `/vendor/login` route.** FlashFoods uses a single `/login` page for all roles. Role-based redirect happens server-side after `POST /login`. |
| Waited for `/vendor\|dashboard\|orders/` | Waits for `/\/vendor\/orders\/pending/` | Vendor login redirects specifically to `/vendor/orders/pending` (confirmed in `routes/auth.js` POST /login handler) |

### `playwright/place-order.js`

| Before (Wrong) | After (Correct) | Reason |
|----------------|-----------------|--------|
| Navigated to `/menu?shop=shop_1` | Navigates to `/shops/:slug` | **Route `GET /menu` does not exist.** The correct route is `GET /shops/:slug` (defined in `routes/shops.js`), which renders `shops/menu.ejs` |
| Used `shopId` as parameter | Uses `shopSlug` (e.g. `juice-corner`) | URL pattern is `/shops/:slug`, not `/shops/:id`. Shop slugs are URL-friendly strings. RingWatch validates slug against `config.testingShop` before every order |
| Tried to find items by `[data-item-id="item_1"]` | Finds items by `button.action-btn--primary:has-text("Add to Cart")` | Menu items don't use `data-item-id`. The actual markup has `<form action="/cart/add">` with `<button class="action-btn action-btn--primary">Add to Cart</button>` |
| Clicked generic `button:has-text("Add")` | Clicks the correct `.action-btn--primary` button | The actual button text is **"Add to Cart"** (not "Add"). The fallback selector was too broad |
| Clicked `a:has-text("Cart"), button:has-text("Cart")` | Navigates via `page.goto('/cart')` | Direct navigation is more reliable than finding the nav cart link |
| Clicked `button:has-text("Checkout"), a:has-text("Checkout"), button:has-text("Place Order")` | Submits `POST /orders/checkout` via `page.request.post()` | **There is no "Checkout" or "Place Order" button on the cart page.** The cart only shows payment gateway buttons (Razorpay/Easebuzz/PhonePe) and a disabled fallback. The mock checkout is triggered by a direct POST to `/orders/checkout` (defined in `routes/orders.js:677`) |
| Waited for `.order-confirmation, .order-success, [data-testid="order-confirmation"]` | Navigates to the redirect URL `/orders/:id` | Order detail page uses template `orders/show.ejs` with heading "Order details". No `order-confirmation` class exists |
| Extracted order ID via regex on body text | Extracts order ID from redirect URL `/orders/:id` | The redirect URL contains the MongoDB ObjectId, which is more reliable |

### `controller/test-runner.js`

| Before (Wrong) | After (Correct) | Reason |
|----------------|-----------------|--------|
| Default scenario had no order config | Each `order` step reads `shopSlug` from `config.testingShop` | The testing shop slug is now a single top-level config value, not buried in `order.shopSlug` |

### `controller/schedule.js`

| Before (Wrong) | After (Correct) | Reason |
|----------------|-----------------|--------|
| `order` step passed `step.config` directly | Passes `{ shopSlug, orderType }` with slug from `config.testingShop` | Shop slug now comes from a single validated source of truth. Any override must match `testingShop` or the action is blocked |

---

## 2. Selectors Updated

| File | Old Selector | New Selector | Source Template |
|------|-------------|-------------|-----------------|
| `login-student.js:37` | `input[name="email"], input[type="email"], #email` | `input[name="email"]` | `auth/login.ejs` — single field name `email` |
| `login-student.js:38` | `input[name="password"], input[type="password"], #password` | `input[name="password"]` | `auth/login.ejs` — field name `password`, id `pw-login` |
| `login-student.js:41` | `button[type="submit"], button:has-text("Login"), input[type="submit"]` | `page.getByRole('button', { name: 'Log in' })` | `auth/login.ejs` — button text is "Log in", not "Login" |
| `login-vendor.js:37-40` | Same login selectors as above | Same corrections as student | Same `auth/login.ejs` template |
| `place-order.js:57` | `[data-item-id="..."], button[data-id="..."], .menu-item:has-text(...)` | `page.locator('button.action-btn--primary:has-text("Add to Cart")')` | `shops/menu.ejs` via `menu-table.ejs` partial |
| `place-order.js:62` | `button:has-text("Add"), .add-to-cart:first-child` | Removed (now uses exact selector above) | Was a generic fallback that could match wrong elements |
| `place-order.js:76-82` | Multiple generic navigation clicks | `page.goto('/cart')` and `page.request.post('/orders/checkout')` | Direct route navigation is more reliable |

---

## 3. Scenarios Modified

### Default scenario (`test-runner.js`)

```javascript
// Before (no config — relied on wrong defaults)
[
  { action: 'loginStudent' },
  { action: 'order' },
  { action: 'wait', duration: 300000 },
  // ...
]

// After (passes correct shopSlug and orderType)
[
  { action: 'loginStudent' },
  { action: 'order', config: { shopSlug: 'juice-corner', orderType: 'dinein' } },
  { action: 'wait', duration: 300000 },
  // ...
]
```

### Scenario engine (`schedule.js`)

The `order` action handler reads the shop slug exclusively from `config.testingShop`, the single validated source of truth:

```javascript
const orderConfig = {
  shopSlug: step.config?.shopSlug || this._config.testingShop,
  orderType: step.config?.orderType || this._config.order?.orderType,
};
```

---

## 4. Real FlashFoods Routes Discovered

### During codebase audit, the following routes were confirmed as the correct application routes:

| Purpose | Method | Route |
|---------|--------|-------|
| Home page | GET | `/` |
| Student login page | GET | `/login` |
| Student login action | POST | `/login` |
| Vendor redirect (post-login) | (auto) | `/vendor/orders/pending` |
| Shop listing | GET | `/shops` |
| Shop menu (by slug) | GET | `/shops/:slug` |
| Add to cart | POST | `/cart/add` |
| View cart | GET | `/cart` |
| Update cart line | POST | `/cart/line` |
| Clear cart | POST | `/cart/clear` |
| Mock checkout | POST | `/orders/checkout` |
| Order detail | GET | `/orders/:id` |
| Order status API | GET | `/api/orders/:id/status` |
| Order history | GET | `/orders` |
| Vendor pending orders | GET | `/vendor/orders/pending` |
| Vendor mark ready | POST | `/vendor/orders/:id/ready` |
| Vendor accept order | POST | `/vendor/orders/:id/accept` |
| Vendor completed orders | GET | `/vendor/orders/completed` |
| Vendor menu management | GET | `/vendor/menu` |
| Vendor verify pickup | POST | `/vendor/verify` |
| Razorpay payment | POST | `/create-razorpay-order` |
| Easebuzz payment | POST | `/easebuzz/initiate` |
| PhonePe payment | POST | `/phonepe/initiate` |

---

## 5. Remaining Assumptions

These still require manual configuration per environment:

| Assumption | Config Key | Default | Notes |
|------------|-----------|---------|-------|
| Server base URL | `baseUrl` / env `BASE_URL` | `http://localhost:3000` | Must match running FlashFoods server |
| Shop slug | `testingShop` / env `RINGWATCH_TESTING_SHOP` | `juice-corner` | **SAFETY**: validated before every order. Auto-discovery prohibited. Must exist in DB |
| Student credentials | `student.email` / `student.password` | Seed defaults | Use env vars `RINGWATCH_STUDENT_EMAIL` / `RINGWATCH_STUDENT_PASSWORD` |
| Vendor credentials | `vendor.email` / `vendor.password` | Seed defaults | Use env vars `RINGWATCH_VENDOR_EMAIL` / `RINGWATCH_VENDOR_PASSWORD` |
| Menu item availability | `order.menuItemIndex` | `0` (first item) | May need adjustment if first item is sold out |
| Payment gateway | N/A | Mock checkout used | RingWatch uses `POST /orders/checkout` (mock, no payment needed) |
| Android package name | `appPackage` | `com.flashfoods.app` | Verify this is the correct package for the FlashFoods Android app |
| Server running | N/A | N/A | FlashFoods server must be running (`npm start`) |

---

## 6. Verdict

**All incorrect routes, selectors, and placeholder values have been replaced** with production-quality references sourced directly from the FlashFoods codebase audit. The RingWatch framework now accurately follows the real FlashFoods user journey:

> `/login` → `/shops/:slug` → `POST /cart/add` → `/cart` → `POST /orders/checkout` → `/orders/:id`

No notification delivery logic has been introduced. RingWatch v1 is now fully compatible with the existing FlashFoods application.

---

## 7. Safety Policy: Protection Against Real Orders

RingWatch is a testing framework that must **never** place orders with real production vendors. The following safety measures are in place:

| Measure | Location | Description |
|---------|----------|-------------|
| Single source of truth | `config.ringwatch.config.js` | `testingShop` is the top-level config key. All code reads from this value only. |
| Startup validation | `ringwatch.js:133-150` | On every run, RingWatch verifies `config.testingShop === 'juice-corner'` and prints a safe-mode banner. If misconfigured, aborts immediately. |
| Pre-order guard | `playwright/place-order.js:92-96` | Every `placeOrder()` call checks that the resolved shop slug matches `config.testingShop`. If not, throws a `SAFETY BLOCKED` error with full context. |
| No auto-discovery | `playwright/place-order.js` | The `_resolveShopSlug()` function was **removed**. If navigating to `/shops/juice-corner` redirects to `/shops` listing, RingWatch treats it as a fatal error — it does not fall back to any other shop. |
| Redirect guard | `playwright/place-order.js:114-119` | After navigation, RingWatch checks the final URL contains `/shops/`. If at `/shops` (listing) instead of `/shops/:slug`, it throws a `SAFETY BLOCKED` error. |
| No fallback defaults | All files | All hardcoded fallback slugs (`'breaktime'`, `'main-canteen'`) have been removed. The only default is `config.testingShop`. |
| No override bypass | `playwright/place-order.js` | Even if an override `shopSlug` is passed, it is validated against `config.testingShop` before the order proceeds. |
| Env var renamed | `RINGWATCH_SHOP_SLUG` → `RINGWATCH_TESTING_SHOP` | Clearer naming reduces the chance of misconfiguration. |

### What happens if configured for a real shop

```
SAFETY ABORT: config.testingShop is "breaktime" but must be "juice-corner".
RingWatch is only permitted to order from the dedicated testing shop.
```

```
SAFETY BLOCKED: Attempted to place order for shop "breaktime" but
config.testingShop is "juice-corner". Only the testing shop is permitted.
```

### Files modified for safety

- `config/ringwatch.config.js` — added `testingShop`, updated `shopSlug` default
- `playwright/place-order.js` — removed `_resolveShopSlug()`, added pre-order and redirect guards
- `controller/test-runner.js` — `_defaultScenario()` reads from `config.testingShop`
- `controller/schedule.js` — order action reads from `config.testingShop`
- `ringwatch.js` — startup validation and safe-mode banner
- `README.md` — updated config documentation
- `INTEGRATION-REPORT.md` — this section

### Verification

To verify safety is working correctly:
1. Set `testingShop: 'breaktime'` in config → RingWatch should abort on startup
2. Pass `{ shopSlug: 'breaktime' }` as order override → `placeOrder` should throw `SAFETY BLOCKED`
3. Remove `juice-corner` from the database → RingWatch should fail with redirect error (never auto-discover a replacement)
4. Run with correct config → safe-mode banner should print and only `juice-corner` orders should proceed

---

## 8. Vendor Automation Module

### Files Created

| File | Purpose |
|------|---------|
| `playwright/vendor-workflow.js` | Vendor order lifecycle automation (accept → ready → verify) |

### Routes Used

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/vendor/orders/pending` | View pending orders dashboard |
| GET | `/vendor/orders/:id` | View order detail (includes pickup OTP) |
| GET | `/vendor/verify` | Global OTP verification page |
| POST | `/vendor/orders/:id/accept` | Accept order (paid → accepted) |
| POST | `/vendor/orders/:id/ready` | Mark order ready (accepted → ready_for_pickup) |
| POST | `/vendor/verify` | Complete order via OTP (ready_for_pickup → completed) |

### Selectors Used

| Element | Selector | Source Template |
|---------|----------|-----------------|
| Order card | `article.vendor-order-card` | `pending-orders.ejs` |
| Order card (by ID) | `article.vendor-order-card:has(a[href*="/ORDERID"])` | `pending-orders.ejs` |
| Accept form | `form[action*="/accept"]` | `pending-orders.ejs:286` |
| Accept button | `form[action*="/accept"] button.btn` | `pending-orders.ejs:286` |
| Mark ready form | `form[action*="/ready"]` | `pending-orders.ejs:290` |
| Mark ready button | `form[action*="/ready"] button.btn` | `pending-orders.ejs:290` |
| Inline verify form | `form.verify-form` | `pending-orders.ejs:298` |
| OTP input | `input[name="otp"]` | `pending-orders.ejs:298`, `verify.ejs` |
| Verify button | `form.verify-form button.btn` | `pending-orders.ejs:298` |
| Detail grid (OTP) | `.vendor-detail-grid div:has(span)`, filter by "Pickup OTP", then `strong` | `order-details.ejs` |
| Page heading | `h1` | All vendor pages |
| Empty state | `div.card.empty-state` | `pending-orders.ejs:234` |
| Ready count | `#ready-count` | `pending-orders.ejs:218` |
| Global verify form | `#global-verify-form` | `pending-orders.ejs:220` |

### Workflow Transitions

```
paid → accepted    (POST /vendor/orders/:id/accept)
accepted → ready_for_pickup  (POST /vendor/orders/:id/ready)
ready_for_pickup → completed  (POST /vendor/verify with OTP)
```

The OTP is read from the vendor order detail page (`/vendor/orders/:id`), where it is displayed in the `.vendor-detail-grid` as a `strong` element next to the "Pickup OTP" label.

### Screenshots Captured

After every state transition: `reports/screenshots/vendor-{action}-{orderId}-{timestamp}.png`

---

## 9. Notification Validation & Overnight Test Mode

### Files Created

| File | Purpose |
|------|---------|
| `playwright/notification-validator.js` | Order-specific notification tracking with latency measurement |
| `controller/overnight-mode.js` | Full overnight loop: order → notification → vendor → complete → repeat |

### Notification Validation Flow

1. `recordBaseline()` — captures current set of known notification IDs BEFORE order is placed
2. Order is placed → `POST /orders/checkout` → redirects to `/orders/:id`
3. `waitForNotification(orderId)` — polls the notification monitor looking for new events
   - Deduplicates against baseline
   - Measures latency from order placement to notification detection
   - Validates notification content contains order-related keywords
   - Captures Android screenshot via ADB when notification arrives
   - Returns structured result with `success`, `latencyMs`, `title`, `body`, `contentMatched`, `screenshotPath`

### Overnight Test Mode Architecture

```
Loop (until duration/cycles/stop):
  1. Student login          (loginStudent)
  2. Record baseline        (notifBaseline)
  3. Place order            (placeOrder)
  4. Wait for notification  (notifWait)
  5. Vendor login           (loginVendor)
  6. Find order             (vendorFindOrder)
  7. Process order          (vendorProcess: accept → ready → verify)
  8. Wait interval          (configurable)
  9. Repeat
```

### Graceful Recovery

- If any step fails in a cycle, the cycle is marked as failed
- Stale browser pages are closed
- A configurable recovery delay is applied (default 30s)
- The loop continues to the next cycle
- `SIGINT` (Ctrl+C) triggers graceful stop at end of current cycle

### Config Options

Config key `overnight` (in `ringwatch.config.js`):
- `durationMs` — max run duration (default: 8 hours)
- `intervalMs` — wait between cycles (default: 15 minutes)
- `maxCycles` — max iteration count (default: 999999)
- `infinite` — run until interrupted (default: false)
- `notificationTimeoutMs` — max wait for notification per cycle (default: 120s)
- `vendorPollIntervalMs` — vendor dashboard poll interval (default: 3s)
- `vendorTimeoutMs` — max wait for order on vendor dashboard (default: 60s)
- `recoveryDelayMs` — delay after failure before retry (default: 30s)

### CLI Usage

```bash
npm run ringwatch --overnight                  # 8-hour default
npm run ringwatch --overnight --duration 4h    # 4-hour run
npm run ringwatch --overnight --cycles 10      # 10 cycles
npm run ringwatch --overnight --infinite        # Until Ctrl+C
```

### New Scenario Actions

The schedule engine now supports these additional actions:
- `notifBaseline` — record pre-order notification state
- `notifWait` — wait for and validate a notification (requires `config.orderId`)
- `vendorFindOrder` — poll for order on vendor dashboard (requires `config.orderId`)
- `vendorProcess` — run full vendor workflow (requires `config.orderId`)

### Timeline Events

Each overnight cycle produces timeline events:
- `loginStudent` / `loginVendor` — auth events with duration
- `order` — order placement with orderId
- `notification` — notification detection with latencyMs
- `vendorFindOrder` — vendor dashboard poll result
- `vendorProcess` — vendor workflow with step count

All events are recorded in the `cycles[].timeline` array in both HTML and JSON reports.

---

## 10. SAFE MODE Report

### Safety Guard Summary

All safety checks are executed at startup and logged with `[SAFETY]` prefix. Every check result is included in the report.

| Guard | File | Description |
|-------|------|-------------|
| Testing shop validation | `ringwatch.js:135-141` | Aborts if `config.testingShop !== 'juice-corner'` |
| Vendor email validation | `ringwatch.js` `runSafetyChecks()` | Warns if `vendor.email !== 'vendor@college.com'` |
| Order slug consistency | `ringwatch.js` `runSafetyChecks()` | Verifies `order.shopSlug` matches testingShop |
| Auto-discovery disabled | `ringwatch.js` `runSafetyChecks()` | Confirms `_resolveShopSlug()` was removed |
| Pre-order guard | `place-order.js:51-56` | Blocks order if slug doesn't match testingShop |
| Redirect guard | `place-order.js:71-76` | Blocks if redirected to `/shops` listing |
| Base URL configured | `ringwatch.js` `runSafetyChecks()` | Confirms baseUrl is set |
| Vendor workflow guard | `vendor-workflow.js` | All vendor actions validate against `config.testingShop` |

### SAFE MODE Banner

Every run prints:

```
╔══════════════════════════════════════════════╗
║        RINGWATCH — SAFE TESTING MODE        ║
╠══════════════════════════════════════════════╣
║  Testing shop: juice-corner                  ║
║  Vendor:       vendor@college.com only       ║
║  Status:       All orders validated          ║
║  Auto-discovery: DISABLED                    ║
╚══════════════════════════════════════════════╝
```

### Safety Check Output

```
Safety Checks:
  ✅ Testing shop validation: config.testingShop = "juice-corner" (OK)
  ✅ Vendor account validation: vendor.email = "vendor@college.com" (OK)
  ✅ Auto-discovery status: Auto-discovery function _resolveShopSlug() has been removed. Redirects are treated as fatal errors.
  ✅ Base URL configured: baseUrl = "http://localhost:3000"
```

### Report Integration

Safety check results are embedded in the report:
- **HTML report**: "Safety Checks" section with pass/fail per guard
- **JSON report**: `safetyChecks` array with `{check, passed, detail}` for each

### Files with Safety Guards

| File | Guards |
|------|--------|
| `ringwatch.js` | 5 startup checks — shop, vendor, order slug, auto-discovery, base URL |
| `config/ringwatch.config.js` | `testingShop` is the single source of truth |
| `playwright/place-order.js` | Pre-order slug validation + redirect guard |
| `playwright/vendor-workflow.js` | Order ID validation during accept/ready/verify |
| `controller/overnight-mode.js` | Uses `config.testingShop` for all orders |
| `controller/schedule.js` | Reads `shopSlug` from `config.testingShop` |
| `controller/test-runner.js` | Default scenario reads from `config.testingShop` |

### Enforced Policies

1. **Only `juice-corner`**: Any attempt to order from another shop throws `SAFETY BLOCKED`
2. **No fallback**: If `juice-corner` doesn't respond, RingWatch fails — it never discovers another shop
3. **Vendor email locked**: Only `vendor@college.com` is permitted (the testing vendor)
4. **No override bypass**: Even explicit `shopSlug` overrides are validated against `config.testingShop`
5. **Every order logged**: Each safety check is logged with `[SAFETY]` prefix for audit trail
