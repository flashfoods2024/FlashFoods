# Business Rules — Complete Reference

## 1. User Management

### 1.1 Registration
- Users self-register as "student" or "vendor" via `/signup`
- Admin accounts are seeded only (not self-registerable)
- Email must be unique (case-insensitive)
- Password is hashed with bcrypt (10 salt rounds) before storage
- Invalid roles default to "student"

### 1.2 Login
- Email/password authentication via POST `/login`
- Disabled accounts (`isActive: false`) are rejected with "This account has been disabled."
- Successful login creates a session with `req.session.userId`

### 1.3 Password Reset
- POST `/forgot-password` generates a 32-byte crypto random token
- Token is SHA-256 hashed before storage (stored in DB as `resetPasswordToken`)
- Token expires after 15 minutes (stored in `resetPasswordExpires`)
- Reset URL is sent via email (Resend) to the user's registered email
- GET/POST `/reset-password/:token` validates the token and updates password
- Password must be at least 6 characters and match confirmation
- After reset, the session is NOT invalidated (known limitation)

### 1.4 Account Disabling
- Admin can toggle `isActive` for any user
- Disabled users cannot log in
- DisabledAt timestamp is recorded
- Re-enabling sets `disabledAt` to null

## 2. Roles & Permissions

### 2.1 Student
- Browse shops and menus
- Add items to cart
- Place orders (mock or paid)
- View own order history
- Cannot access vendor or admin routes

### 2.2 Vendor
- Manage own shop's menu (CRUD)
- Toggle shop open/closed
- View pending orders for own shop
- Accept, mark ready, cancel orders
- Verify pickup via OTP
- Configure payment gateway settings
- Cannot access student or admin routes

### 2.3 Admin
- Full CRUD on shops, vendors, students, menus
- Toggle active status on shops, vendors, students
- Access analytics dashboard
- Import menus via AI (Gemini)
- Delete shops (cascades: unlink vendor, delete menu items, preserve orders)
- View all orders with search and filter

## 3. Shops

### 3.1 Shop Lifecycle
- Created by admin only
- Slug is auto-generated from name (lowercased, non-alphanumeric → hyphens)
- Slug must be unique
- Shop can be toggled active/inactive by admin
- Shop can be toggled open/closed by vendor (only if active)
- When disabled by admin: automatically closed, vendor cannot reopen

### 3.2 Shop-Vendor Relationship
- One vendor per shop, one shop per vendor
- Linking/unlinking managed by admin
- When a shop is deleted: vendor is unlinked, all menu items deleted, orders preserved

## 4. Menu Items

### 4.1 Item Properties
- Each item belongs to exactly one shop
- Name is required, trimmed
- Price must be > 0
- Available defaults to true
- FoodType: "veg", "non-veg", "egg", "unknown" (default: "unknown")
- Image is optional (stored as Cloudinary URL)

### 4.2 Variants
- Items can have multiple variants with different prices
- Default variant: [{ label: "Regular", price: <basePrice> }]
- Variants are stored as embedded subdocuments (no _id)
- When only one variant exists, it is auto-selected in cart
- Items with multiple variants require explicit variant selection before checkout

### 4.3 Availability
- Vendor can toggle item availability (available/not available)
- Unavailable items cannot be added to cart
- Unavailable items in cart are excluded from checkout

## 5. Cart

### 5.1 Cart Rules
- Stored in session only (no DB persistence)
- Can contain items from one shop at a time
- Adding from a different shop requires clearing the cart first
- Quantity per item: 1-99 (clamped)
- Item price is resolved from the selected variant (or base price)
- Cart is validated server-side at checkout

### 5.2 Variant Selection
- Single-variant items: auto-selected
- Multi-variant items: user must select via POST `/cart/variant`
- Missing variant selection blocks checkout

## 6. Orders

### 6.1 Order Lifecycle
```
pending_payment → paid → accepted → ready_for_pickup → completed
                                        → cancelled
pending_payment → cancelled (payment failure)
```
Status transitions are one-directional (no rollback).

### 6.2 Order Creation
- Created from cart contents
- Server-side price computation prevents tampering
- 6-digit OTP generated at creation
- Order references customer, shop, items
- Pickup time can be specified (optional)

### 6.3 Payment Flows

#### Razorpay (default)
1. POST `/create-razorpay-order` → creates Order (pending_payment) + Razorpay order
2. Client-side Razorpay Checkout popup
3. POST `/verify-payment` → signature verification → status = "paid"
4. Webhook `/webhooks/razorpay` handles async events (payment.captured, payment.failed)

#### Easebuzz
1. POST `/easebuzz/initiate` → creates Order + Easebuzz hash
2. Server-to-server initiation → redirect URL
3. POST `/easebuzz/callback` → hash verification → status update

#### PhonePe
1. POST `/phonepe/initiate` → creates Order + auth token + payment request
2. Redirect to PhonePe checkout
3. GET/POST `/phonepe/callback` → status check → status update

#### Mock Checkout
1. POST `/orders/checkout` → creates Order with status = "paid" immediately
2. paymentNote = "mock", transactionId = "mock"
3. No real payment processed

### 6.4 OTP Pickup
- 6-digit numeric OTP generated at order creation
- Vendor enters OTP at `/vendor/verify`
- Order must be in "ready_for_pickup" status
- OTP lookup is scoped to vendor's shop
- On successful verification: status = "completed", collectedAt = now

### 6.5 Order Adjustment
- Only "paid" or "accepted" orders can be adjusted
- Vendor selects which items to keep; removed items trigger refund
- At least one item must remain
- Reason required: Out of Stock, Preparation Issue, Ingredient Unavailable, Kitchen Issue, Other
- Partial refund processed for Razorpay and PhonePe; Easebuzz adjustment refunds are manual

### 6.6 Order Cancellation
- Only "paid" orders can be cancelled by vendor
- Full refund processed via gateway
- Mock orders are cancelled immediately without real refund

## 7. Refunds

### 7.1 Refund Rules
| Gateway | Full Cancel | Partial Adjust |
|---------|-------------|----------------|
| Razorpay | ✅ Implemented | ✅ Implemented |
| PhonePe | ✅ Implemented | ✅ Implemented |
| Easebuzz | ❌ Not implemented | ❌ Not implemented |
| Mock | ✅ Immediate | ✅ Immediate |

### 7.2 Refund Status
- none → pending → completed | failed
- Failed refunds are logged; admin must process manually

## 8. Payments

### 8.1 Gateway Configuration
- Each shop selects a primary gateway: razorpay (default), easebuzz, phonepe, paytm, bharatpe
- Shop-specific credentials override platform-wide env vars
- `isGatewayConfigured()` checks if the selected gateway has required credentials
- Paytm and BharatPe are schema-only (no implementation)

## 9. Notifications

### 9.1 Real-time (Socket.IO)
- Vendor joins room `shop:<shopId>` on login
- `pending-count` event sent on: new paid order, order accepted, order cancelled
- Client plays audio and updates tab title when count > 0

### 9.2 Email
- Only password reset emails are implemented
- No order confirmation or status update emails
- Sent via Resend from `noreply@flashfoods.in`

## 10. Admin Dashboard

### 10.1 Dashboard Stats
- Total shops, vendors, students, orders
- Orders today, completed orders, pending orders
- Recent orders (last 8)

### 10.2 Analytics
- Total revenue
- Orders today/week/month
- Most popular shop
- Most popular menu item
- Peak ordering hour
- Top 5 shops by orders
- Top 5 vendors by orders
