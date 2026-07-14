# Permissions Matrix

## Route Access by Role

| Route | Public | Student | Vendor | Admin |
|-------|--------|---------|--------|-------|
| GET / | ✅ | ✅ | ✅ | ✅ |
| GET/POST /signup | ✅ | - | - | - |
| GET/POST /login | ✅ | - | - | - |
| POST /logout | - | ✅ | ✅ | ✅ |
| GET/POST /forgot-password | ✅ | - | - | - |
| GET/POST /reset-password/:token | ✅ | - | - | - |
| GET /shops | ✅ | ✅ | ✅ | ✅ |
| GET /shops/:slug | ✅ | ✅ | ✅ | ✅ |
| GET /cart | - | ✅ | - | - |
| POST /cart/* | - | ✅ | - | - |
| GET /orders | - | ✅ | - | - |
| GET /orders/:id | - | ✅ | - | - |
| GET /api/orders/:id/status | - | ✅ | - | - |
| POST /create-razorpay-order | - | ✅ | - | - |
| POST /verify-payment | - | ✅ | - | - |
| POST /easebuzz/* | - | ✅ | - | - |
| POST /phonepe/* | - | ✅ | - | - |
| POST /orders/checkout | - | ✅ | - | - |
| PATCH /menu/:id/toggle | - | - | ✅ | - |
| GET /vendor/* | - | - | ✅ | - |
| POST /vendor/* | - | - | ✅ | - |
| GET /admin/* | - | - | - | ✅ |
| POST /admin/* | - | - | - | ✅ |
| POST /webhooks/razorpay | ✅ | - | - | - |

## Permission Enforcement

### Middleware Chain
```
Public routes:   No auth middleware
Student routes:  requireAuth → requireStudent
Vendor routes:   requireAuth → requireVendor → requireVendorShop
Admin routes:    requireAuth → requireAdmin
```

### Middleware Functions

| Function | What it checks | Redirect on failure |
|----------|---------------|-------------------|
| `attachUser` | Session userId → loads user | None (sets req.user = undefined) |
| `requireAuth` | req.session.userId exists | Redirects to /login |
| `requireStudent` | req.user.role === "student" | Redirects to / |
| `requireVendor` | req.user.role === "vendor" | Redirects to / |
| `requireAdmin` | req.user.role === "admin" | Redirects to / |
| `requireVendorShop` | req.user.shop exists | Redirects to / |
| `resolveAdminVendorShop` | Valid vendorId param, vendor exists, shop exists | Redirects to /admin/menus |

## Data Scoping

| Entity | Student sees | Vendor sees | Admin sees |
|--------|-------------|-------------|-----------|
| Users | Own profile only | Own profile only | All users |
| Shops | Active shops only | Own shop | All shops |
| Menu Items | Available items from active shops | Own shop's items | All shops' items |
| Orders | Own orders only | Own shop's orders | All orders |

## Action Permissions

| Action | Student | Vendor | Admin |
|--------|---------|--------|-------|
| Create account | ✅ Self only | ✅ Self only | ✅ Any |
| Edit profile | ❌ | ❌ | ✅ |
| Toggle active | ❌ | ❌ | ✅ Any user |
| Create shop | ❌ | ❌ | ✅ |
| Edit shop | ❌ | ❌ | ✅ |
| Delete shop | ❌ | ❌ | ✅ |
| Create menu item | ❌ | ✅ Own shop | ✅ Any shop |
| Edit menu item | ❌ | ✅ Own shop | ✅ Any shop |
| Delete menu item | ❌ | ✅ Own shop | ✅ Any shop |
| Toggle item availability | ❌ | ✅ Own shop | ✅ Any shop |
| Toggle shop open/closed | ❌ | ✅ Own shop | ✅ Any shop |
| View pending orders | ❌ | ✅ Own shop | ✅ All |
| Accept/cancel orders | ❌ | ✅ Own shop | ❌ |
| Verify pickup OTP | ❌ | ✅ Own shop | ❌ |
| View analytics | ❌ | ❌ | ✅ |
| Import menu (AI) | ❌ | ❌ | ✅ |
| Configure payment settings | ❌ | ✅ Own shop | ✅ Any shop |
| View order history | ✅ Own | ✅ Own shop | ✅ All |
