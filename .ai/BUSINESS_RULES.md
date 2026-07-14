# Business Rules

## Authentication

1. **Signup**: Users can register as "student" or "vendor". Role is locked after creation. Admin accounts are seeded, not self-registered.
2. **Password Hashing**: bcrypt with 10 salt rounds.
3. **Login**: Disabled accounts (`isActive: false`) cannot log in.
4. **Password Reset**: Token expires after 15 minutes. Token is SHA-256 hashed before storage. Reset does not invalidate existing sessions.
5. **Rate Limiting**: 300 requests per 15 minutes per IP (can be disabled via `DISABLE_RATE_LIMIT=true`).

## Vendor Rules

1. A vendor must be linked to exactly one shop.
2. A shop can have at most one vendor.
3. Vendors can only manage their own shop's menu items.
4. Vendors can toggle their shop open/closed (only if shop is not disabled by admin).
5. A vendor cannot modify items from other shops.
6. Vendors can configure payment gateway credentials for their shop.

## Student Rules

1. Students can browse shops and their menu items.
2. Students can add items to cart from one shop at a time.
3. Students must select a variant for items with multiple variants before checkout.
4. Students can view their own order history only.

## Shop Rules

1. A shop can be active or disabled (by admin) and open or closed (by vendor).
2. Disabled shops cannot be toggled open by the vendor.
3. Deleting a shop unlinks the vendor, deletes all menu items, but preserves orders.
4. Shop slugs must be unique and are auto-generated from the name.

## Menu Item Rules

1. Each menu item belongs to exactly one shop.
2. Price must be greater than 0.
3. Items have a food type: veg, non-veg, egg, or unknown.
4. Items can have multiple variants (e.g., Regular, Large) with different prices.
5. The default variant has label "Regular" and price equal to the base price.
6. Item availability can be toggled by the vendor.
7. Unavailable items cannot be added to cart.
8. Image uploads limited to 5MB.

## Cart Rules

1. Cart is stored in session only (no database persistence).
2. Cart can contain items from only one shop at a time.
3. Adding items from a different shop prompts cart clearing.
4. Quantity per item limited to 1-99.
5. When a variant is not selected for multi-variant items, checkout is blocked.
6. Cart is cleared after successful order placement.

## Order Lifecycle

```
pending_payment → paid → accepted → ready_for_pickup → completed
                                       \              /
                                        → cancelled (admin/vendor cancel)
pending_payment → cancelled (payment failed or timeout)
```

1. **pending_payment**: Order created but payment not confirmed.
2. **paid**: Payment confirmed, pizza awaiting vendor acceptance.
3. **accepted**: Vendor accepted the order, preparing items.
4. **ready_for_pickup**: Order prepared, awaiting student pickup.
5. **completed**: Student picked up order (verified via 6-digit OTP).
6. **cancelled**: Order cancelled (payment failed, vendor cancelled, etc.).

## Payment Rules

1. Three gateways supported: Razorpay, Easebuzz, PhonePe (Paytm and BharatPe are schema-only).
2. Each shop selects its payment gateway; default is Razorpay.
3. Shop-specific credentials fall back to platform-wide env vars.
4. Order total is computed server-side from cart items (cannot be tampered client-side).
5. Mock/offline checkout (`/orders/checkout`) bypasses real payment.

## Refund Rules

1. Full refund on vendor-initiated cancellation of paid orders.
2. Partial refund when vendor removes items from a paid/accepted order (adjustment).
3. Only captured Razorpay payments and PhonePe payments can be refunded.
4. Razorpay refunds use "normal" speed.
5. Refund status tracking: none → pending → completed | failed.
6. Easebuzz refunds are NOT implemented (marked as pending for manual processing).

## OTP Rules

1. Each order gets a unique 6-digit numeric OTP at creation.
2. OTP is generated using `crypto.randomInt(0, 1000000)` padded to 6 digits.
3. Vendor enters the OTP to mark an order as completed.
4. OTP lookup is scoped to the vendor's shop and `ready_for_pickup` status.

## Notification Rules

1. Socket.IO emits pending count changes to the vendor's shop room.
2. Pending count = number of orders with status "paid".
3. Client-side JS plays a ringing sound when pending count > 0.
4. Browser tab title updates with pending count.
5. Emails are sent only for password resets (no order confirmation emails).

## Admin Rules

1. Admin can manage all shops, vendors, students, orders, and menus.
2. Admin can toggle shop active status (disabling closes the shop).
3. Admin can toggle vendor and student active status.
4. Admin can access analytics (revenue, popular items, peak hours).
5. Admin can use AI-powered menu import for any vendor.

## Adjustment Rules

1. Only paid or accepted orders can be adjusted.
2. At least one item must remain after adjustment.
3. Removing all items is not allowed (use cancel instead).
4. Adjustment requires a reason: Out of Stock, Preparation Issue, Ingredient Unavailable, Kitchen Issue, or Other.
5. Partial refund is processed for removed items.
6. Original total, updated total, and refund amount are recorded.
