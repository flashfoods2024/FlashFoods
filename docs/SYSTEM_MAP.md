# System Map

## File → Module Mapping

```
flashfoods/
│
├── server.js                          # Entry point, middleware pipeline, route mounting, error handler
├── seed.js                            # Database seeder (demo data)
├── nodemon.json                       # Dev server config
├── playwright.config.js               # E2E test config
│
├── config/
│   ├── db.js                          # MongoDB connection (fail-fast, timeouts)
│   ├── cloudinary.js                  # Cloudinary SDK + Multer storage config
│   ├── razorpay.js                    # Razorpay SDK + per-shop factory
│   ├── easebuzz.js                    # Easebuzz payment initiation + hash verification
│   └── phonepe.js                     # PhonePe auth, payment, status, refund
│
├── middleware/
│   ├── auth.js                        # attachUser, requireAuth, require{Vendor,Student,Admin},
│   │                                  # requireVendorShop, resolveAdminVendorShop
│   ├── requireDb.js                   # DB connection health check
│   └── upload.js                      # Multer + Cloudinary image upload handlers
│
├── models/
│   ├── User.js                        # name, email, passwordHash, role, shop, isActive, resetToken
│   ├── Shop.js                        # name, slug, vendor, paymentGateway/Settings, isOpen, isActive
│   ├── MenuItem.js                    # shop, name, price, variants[], available, foodType
│   └── Order.js                       # customer, shop, items[], total, status, pickupOtp,
│                                     # payment info, refund fields, adjustment fields
│
├── routes/
│   ├── auth.js                        # GET/POST signup, login, forgot-password, reset-password, logout
│   ├── shops.js                       # GET /shops, GET /shops/:slug
│   ├── cart.js                        # GET /cart, POST /cart/add, /variant, /line, /clear
│   ├── menu.js                        # PATCH /menu/:id/toggle
│   ├── orders.js                      # POST create-razorpay-order, verify-payment, easebuzz/initiate,
│   │                                  # easebuzz/callback, phonepe/initiate, phonepe/callback,
│   │                                  # /orders/checkout, GET /orders, /orders/:id, /api/orders/:id/status
│   ├── vendor.js                      # GET/POST vendor/menu, shop/toggle, orders/pending,
│   │                                  # orders/:id/{accept,ready,cancel,adjust}, verify,
│   │                                  # orders/completed, orders/:id, payment/settings
│   ├── admin.js                       # Full admin CRUD: shops, vendors, students, orders, menus,
│   │                                  # menu import (AI), analytics
│   └── webhooks.js                    # POST /webhooks/razorpay (raw body)
│
├── socket/
│   └── index.js                       # Socket.IO init, vendor:join, emitPendingCount
│
├── utils/
│   ├── admin.js                       # IST timezone helpers, formatOrderStatus, normalizeQuery
│   ├── email.js                       # Resend email client, sendPasswordResetEmail
│   ├── otp.js                         # generateOtp (6-digit crypto)
│   └── time.js                        # formatPickupTime, formatLocalDateTime, getPickupUrgency
│
├── menu-import/
│   ├── index.js                       # Barrel exports
│   ├── importer.js                    # Import pipeline orchestrator
│   ├── store.js                       # In-memory import session store
│   ├── vision.js                      # Gemini Vision API integration
│   ├── upload.js                      # Multer config for import files
│   ├── validator.js                   # File + content validators
│   ├── preview.js                     # Preview transformer
│   ├── splitter.js                    # Image splitting for large menus
│   ├── json-recovery.js              # Malformed JSON recovery
│   └── debug.js                       # Debug logging for AI extraction
│
├── views/
│   ├── home.ejs                       # Landing page
│   ├── auth/                          # login, signup, forgot-password, reset-password
│   ├── shops/                         # index (listing), menu (single shop)
│   ├── cart/                          # index (cart page)
│   ├── orders/                        # index (history), show (detail)
│   ├── vendor/                        # menu, pending-orders, completed-orders, order-details,
│   │                                  # adjust-order, verify, payment-settings
│   ├── admin/                         # dashboard, shops/, vendors/, students/, orders/, menus/,
│   │                                  # analytics
│   └── partials/                      # header, footer, sidebar, layout, menu-manager, etc.
│
├── public/
│   ├── styles.css                     # Global stylesheet
│   ├── js/
│   │   ├── menu-table.js              # Search/filter for menu tables
│   │   └── notification-manager.js     # Socket.IO pending order notifications
│   ├── images/                        # Background images
│   ├── fonts/                         # Custom fonts
│   └── audio/                         # Notification sounds
│
├── tests/
│   └── login.spec.js                  # Playwright E2E login test
│
├── scripts/
│   └── migrate-menu-prices.js         # One-off migration: variants field
│
└── security-hardening/
    └── k6.js                          # K6 load test placeholder
```
