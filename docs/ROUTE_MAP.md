# Route Map

## Authentication Routes (`authRouter`)

| Method | Path | Auth | Middleware | Description |
|--------|------|------|-----------|-------------|
| GET | /signup | No | - | Render signup form |
| POST | /signup | No | requireDb | Register new user |
| GET | /login | No | - | Render login form |
| POST | /login | No | requireDb | Authenticate user |
| GET | /forgot-password | No | - | Render forgot password form |
| POST | /forgot-password | No | requireDb | Send reset email |
| GET | /reset-password/:token | No | requireDb | Render reset form with token |
| POST | /reset-password/:token | No | requireDb | Update password |
| POST | /logout | Yes | - | Destroy session |

## Shop Routes (`shopsRouter`)

| Method | Path | Auth | Middleware | Description |
|--------|------|------|-----------|-------------|
| GET | /shops | No | requireDb | List all active shops |
| GET | /shops/:slug | No | requireDb | Shop detail + menu items |

## Cart Routes (`cartRouter`)

| Method | Path | Auth | Middleware | Description |
|--------|------|------|-----------|-------------|
| GET | /cart | Student | requireDb, requireAuth, requireStudent | View cart |
| POST | /cart/add | Student | requireDb, requireAuth, requireStudent | Add item to cart |
| POST | /cart/variant | Student | requireDb, requireAuth, requireStudent | Update variant selection (AJAX) |
| POST | /cart/line | Student | requireDb, requireAuth, requireStudent | Update line item qty/remove |
| POST | /cart/clear | Student | requireDb, requireAuth, requireStudent | Clear entire cart |

## Order Routes (`ordersRouter`)

| Method | Path | Auth | Middleware | Description |
|--------|------|------|-----------|-------------|
| POST | /create-razorpay-order | Student | requireDb, requireAuth, requireStudent | Create Razorpay order |
| POST | /verify-payment | Student | requireDb, requireAuth, requireStudent | Verify Razorpay payment |
| POST | /easebuzz/initiate | Student | requireDb, requireAuth, requireStudent | Initiate Easebuzz payment |
| POST | /easebuzz/callback | No | requireDb | Easebuzz payment callback |
| POST | /phonepe/initiate | Student | requireDb, requireAuth, requireStudent | Initiate PhonePe payment |
| GET/POST | /phonepe/callback | No | requireDb | PhonePe payment callback |
| POST | /orders/checkout | Student | requireDb, requireAuth, requireStudent | Mock/offline checkout |
| GET | /orders | Student | requireDb, requireAuth, requireStudent | Order history |
| GET | /orders/:id | Student | requireDb, requireAuth, requireStudent | Order detail |
| GET | /api/orders/:id/status | Student | requireDb, requireAuth, requireStudent | Order status JSON API |

## Menu Routes (`menuRouter`)

| Method | Path | Auth | Middleware | Description |
|--------|------|------|-----------|-------------|
| PATCH | /menu/:id/toggle | Vendor | requireDb, requireAuth, requireVendor, requireVendorShop | Toggle item availability |

## Vendor Routes (`vendorRouter`)

| Method | Path | Auth | Middleware | Description |
|--------|------|------|-----------|-------------|
| GET | /vendor/menu | Vendor | requireDb, requireAuth, requireVendor, requireVendorShop | Menu management page |
| POST | /vendor/shop/toggle | Vendor | requireDb, requireAuth, requireVendor, requireVendorShop | Open/close shop |
| POST | /vendor/menu | Vendor | requireDb, requireAuth, requireVendor, requireVendorShop, upload | Create menu item |
| PATCH | /vendor/menu/:id | Vendor | requireDb, requireAuth, requireVendor, requireVendorShop, upload | Update menu item |
| DELETE | /vendor/menu/:id | Vendor | requireDb, requireAuth, requireVendor, requireVendorShop | Delete menu item |
| GET | /vendor/orders/pending | Vendor | requireDb, requireAuth, requireVendor, requireVendorShop | Pending orders page |
| GET | /vendor/orders/pending.json | Vendor | requireDb, requireAuth, requireVendor, requireVendorShop | Pending orders JSON (5s polling) |
| POST | /vendor/orders/:id/accept | Vendor | requireDb, requireAuth, requireVendor, requireVendorShop | Accept paid order |
| POST | /vendor/orders/:id/ready | Vendor | requireDb, requireAuth, requireVendor, requireVendorShop | Mark ready for pickup |
| POST | /vendor/orders/:id/cancel | Vendor | requireDb, requireAuth, requireVendor, requireVendorShop | Cancel + refund order |
| GET | /vendor/orders/:id/adjust | Vendor | requireDb, requireAuth, requireVendor, requireVendorShop | Adjustment page |
| POST | /vendor/orders/:id/adjust | Vendor | requireDb, requireAuth, requireVendor, requireVendorShop | Process adjustment |
| GET | /vendor/verify | Vendor | requireDb, requireAuth, requireVendor, requireVendorShop | OTP verification page |
| POST | /vendor/verify | Vendor | requireDb, requireAuth, requireVendor, requireVendorShop | Verify pickup OTP |
| GET | /vendor/orders/completed | Vendor | requireDb, requireAuth, requireVendor, requireVendorShop | Completed/cancelled orders |
| GET | /vendor/orders/:id | Vendor | requireDb, requireAuth, requireVendor, requireVendorShop | Order detail |
| GET | /vendor/payment/settings | Vendor | requireDb, requireAuth, requireVendor, requireVendorShop | Payment settings page |
| POST | /vendor/payment/settings | Vendor | requireDb, requireAuth, requireVendor, requireVendorShop | Update payment settings |

## Admin Routes (`adminRouter`) — All prefixed with `/admin`

| Method | Path | Middleware | Description |
|--------|------|-----------|-------------|
| GET | / | - | Dashboard with stats |
| GET | /shops | - | List all shops |
| GET | /shops/new | - | Create shop form |
| POST | /shops | upload | Create shop |
| GET | /shops/:id | - | Shop detail |
| GET | /shops/:id/edit | - | Edit shop form |
| POST | /shops/:id/edit | upload | Update shop |
| POST | /shops/:id/toggle | - | Toggle shop active |
| POST | /shops/:id/delete | - | Delete shop |
| GET | /shops/:id/payment-settings | - | Shop payment settings |
| POST | /shops/:id/payment-settings | - | Update shop payment settings |
| GET | /vendors | - | List vendors |
| GET | /vendors/new | - | Create vendor form |
| POST | /vendors | - | Create vendor |
| GET | /vendors/:id | - | Vendor detail |
| GET | /vendors/:id/edit | - | Edit vendor form |
| POST | /vendors/:id/edit | - | Update vendor |
| POST | /vendors/:id/toggle | - | Toggle vendor active |
| POST | /vendors/:id/delete | - | Delete vendor |
| GET | /students | - | List students |
| GET | /students/:id | - | Student detail |
| POST | /students/:id/toggle | - | Toggle student active |
| GET | /orders | - | List orders (filter/search) |
| GET | /orders/:id | - | Order detail |
| GET | /menus | - | Menu overview per vendor |
| GET | /vendors/:vendorId/menu | resolveAdminVendorShop | Vendor's menu items |
| POST | /vendors/:vendorId/menu | resolveAdminVendorShop, upload | Create menu item |
| PATCH | /vendors/:vendorId/menu/:id | resolveAdminVendorShop, upload | Update menu item |
| DELETE | /vendors/:vendorId/menu/:id | resolveAdminVendorShop | Delete menu item |
| PATCH | /vendors/:vendorId/menu/:id/toggle | resolveAdminVendorShop | Toggle item availability |
| POST | /vendors/:vendorId/shop/toggle | resolveAdminVendorShop | Toggle shop open/closed |
| GET | /vendors/:vendorId/menu/import | resolveAdminVendorShop | Menu import page |
| POST | /vendors/:vendorId/menu/import | resolveAdminVendorShop | Process AI import |
| POST | /vendors/:vendorId/menu/import/confirm | resolveAdminVendorShop | Confirm + persist import |
| GET | /analytics | - | Analytics dashboard |

## Webhook Routes (`webhooksRouter`)

| Method | Path | Middleware | Description |
|--------|------|-----------|-------------|
| POST | /webhooks/razorpay | express.raw({type: "application/json"}), requireDb | Razorpay event handler |

## Static Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | / | Home page |
| GET | /public/* | Static assets (CSS, JS, images, fonts, audio) |
