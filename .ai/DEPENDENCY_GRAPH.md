# Dependency Graph

## Import Dependencies

### server.js
```
server.js
├── express
├── helmet
├── express-session
├── connect-flash
├── path
├── url (fileURLToPath)
├── dotenv
├── ./config/db.js
├── ./models/Shop.js
├── ./middleware/auth.js (attachUser)
├── ./routes/auth.js
├── ./routes/shops.js
├── ./routes/cart.js
├── ./routes/orders.js
├── ./routes/webhooks.js
├── ./routes/vendor.js
├── ./routes/menu.js
├── ./routes/admin.js
├── ./utils/time.js
└── ./socket/index.js (initSocket)
```

### Routes → Dependencies

```
routes/auth.js
├── crypto
├── express
├── bcryptjs
├── ../models/User.js
├── ../middleware/requireDb.js
└── ../utils/email.js

routes/shops.js
├── express
├── ../models/Shop.js
├── ../models/MenuItem.js
└── ../middleware/requireDb.js

routes/cart.js
├── express
├── mongoose
├── ../models/MenuItem.js
├── ../models/Shop.js
├── ../middleware/requireDb.js
└── ../middleware/auth.js (requireAuth, requireStudent)

routes/orders.js
├── express
├── crypto
├── mongoose
├── ../models/MenuItem.js
├── ../models/Shop.js
├── ../models/Order.js
├── ../middleware/requireDb.js
├── ../middleware/auth.js (requireAuth, requireStudent)
├── ../utils/otp.js
├── ../config/razorpay.js
├── ../config/easebuzz.js
├── ../config/phonepe.js
└── ../socket/index.js (emitPendingCount)

routes/webhooks.js
├── express
├── crypto
├── ../models/Order.js
├── ../models/Shop.js
├── ../middleware/requireDb.js
├── ../config/razorpay.js
└── ../socket/index.js (emitPendingCount)

routes/vendor.js
├── express
├── mongoose
├── ../models/Order.js
├── ../models/MenuItem.js
├── ../models/Shop.js
├── ../middleware/requireDb.js
├── ../middleware/auth.js
├── ../middleware/upload.js (handleMenuImageUpload)
├── ../config/razorpay.js
├── ../config/phonepe.js
├── ../utils/time.js
└── ../socket/index.js (emitPendingCount)

routes/admin.js
├── express
├── bcryptjs
├── mongoose
├── ../models/Order.js
├── ../models/User.js
├── ../models/Shop.js
├── ../models/MenuItem.js
├── ../middleware/requireDb.js
├── ../middleware/auth.js
├── ../middleware/upload.js
├── ../menu-import/upload.js
├── ../menu-import/importer.js
├── ../menu-import/store.js
├── ../menu-import/vision.js
├── ./vendor.js (isGatewayConfigured)
└── ../utils/admin.js
```

### Model Dependencies

```
Models (all) → mongoose
models/User.js → (standalone, refs Shop via ObjectId)
models/Shop.js → (standalone)
models/MenuItem.js → (standalone, refs Shop via ObjectId)
models/Order.js → (standalone, refs User, Shop, MenuItem via ObjectId)
```

### Config Dependencies

```
config/db.js → mongoose
config/cloudinary.js → cloudinary, multer-storage-cloudinary
config/razorpay.js → razorpay
config/easebuzz.js → crypto
config/phonepe.js → (standalone, uses fetch)
```

## Runtime Dependency Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Express   │────▶│   Routes    │────▶│   Models    │────▶ MongoDB
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
                    ┌──────▼───────┐
                    │  Middleware  │
                    │  ┌─────────┐ │
                    │  │  auth   │────▶ User Model
                    │  ├─────────┤ │
                    │  │ upload  │────▶ Cloudinary
                    │  ├─────────┤ │
                    │  │requireDb│────▶ mongoose.connection
                    │  └─────────┘ │
                    └──────────────┘
```

## Circular Dependency Check

- `routes/admin.js` imports `isGatewayConfigured` from `routes/vendor.js` — this is a cross-route dependency but NOT circular (vendor.js does not import from admin.js)
- All other imports are acyclic (tree structure)
- No circular dependencies found

## Socket Event Flow

```
Server (socket/index.js)
  │
  ├── Client connects
  │     └── Emits "vendor:join" with shopId
  │           └── Joins room "shop:<shopId>"
  │                 └── Receives current "pending-count"
  │
  └── emitPendingCount(shopId)
        └── Queries Order.countDocuments({ shop, status: "paid" })
              └── Emits "pending-count" to room "shop:<shopId>"
```

Triggered by:
- `routes/orders.js`: After new paid order (verify-payment, checkout, easebuzz callback, phonepe callback)
- `routes/vendor.js`: After accept, ready, cancel actions
- `routes/webhooks.js`: After payment.captured webhook
