# Payment Flow Documentation

## Overview

FlashFoods supports three payment gateways: Razorpay, Easebuzz, and PhonePe. Each shop can configure its own gateway credentials or use platform-wide defaults.

## Supported Gateways

| Gateway | Status | Full Refund | Partial Refund | Notes |
|---------|--------|-------------|----------------|-------|
| Razorpay | ✅ Implemented | ✅ | ✅ | Primary/default gateway |
| Easebuzz | ✅ Implemented | ❌ Not implemented | ❌ Not implemented | Tested in sandbox |
| PhonePe | ✅ Implemented | ✅ | ✅ | UAT mode |
| Paytm | ❌ Not started | ❌ | ❌ | Schema only |
| BharatPe | ❌ Not started | ❌ | ❌ | Schema only |

## Flow Diagrams

### Razorpay Flow
```
Student                   Server                    Razorpay               Vendor
  │                         │                         │                      │
  │  POST /create-razorpay  │                         │                      │
  │  -order                 │                         │                      │
  │ ──────────────────────► │  POST /orders           │                      │
  │                         │ ──────────────────────► │                      │
  │                         │  ◄────────────────────── │                      │
  │  ◄────────────────────── │   rzpOrder              │                      │
  │                         │                         │                      │
  │  Razorpay Checkout      │                         │                      │
  │  (client-side popup)    │                         │                      │
  │ ──────────────────────────────────────────────────►                      │
  │  ◄──────────────────────────────────────────────────                      │
  │  (payment result)       │                         │                      │
  │                         │                         │                      │
  │  POST /verify-payment   │                         │                      │
  │ ──────────────────────► │                         │                      │
  │                         │  Verify HMAC signature  │                      │
  │                         │  Update order → "paid"  │                      │
  │  ◄────────────────────── │  Emit pending-count     │                      │
  │                         │                         │                      │
  │                         │                         │  Webhook:            │
  │                         │                         │  payment.captured    │
  │                         │  ◄────────────────────── │  (async fallback)    │
```

### Easebuzz Flow
```
Student                   Server                    Easebuzz               Vendor
  │                         │                         │                      │
  │  POST /easebuzz/initiate│                         │                      │
  │ ──────────────────────► │                         │                      │
  │                         │  Build payment hash     │                      │
  │                         │  POST /payment/initiate │                      │
  │                         │  ─────────────────────► │                      │
  │                         │  ◄───────────────────── │  access_key          │
  │  ◄────────────────────── │  redirect URL           │                      │
  │                         │                         │                      │
  │  Redirect to Easebuzz   │                         │                      │
  │  ─────────────────────────────────────────────────►                      │
  │  ◄─────────────────────────────────────────────────                      │
  │  (callback)             │                         │                      │
  │                         │                         │                      │
  │  POST /easebuzz/callback│                         │                      │
  │ ──────────────────────► │                         │                      │
  │                         │  Verify response hash   │                      │
  │                         │  Update order → paid    │                      │
  │  ◄────────────────────── │  or cancelled           │                      │
```

### PhonePe Flow
```
Student                   Server                     PhonePe               Vendor
  │                         │                         │                      │
  │  POST /phonepe/initiate │                         │                      │
  │ ──────────────────────► │                         │                      │
  │                         │  Get OAuth token        │                      │
  │                         │  ─────────────────────► │                      │
  │                         │  ◄───────────────────── │  access_token        │
  │                         │                         │                      │
  │                         │  POST /checkout/v2/pay  │                      │
  │                         │  ─────────────────────► │                      │
  │                         │  ◄───────────────────── │  redirectUrl         │
  │  ◄────────────────────── │                         │                      │
  │                         │                         │                      │
  │  Redirect to PhonePe    │                         │                      │
  │  ─────────────────────────────────────────────────►                      │
  │  ◄─────────────────────────────────────────────────                      │
  │  (callback with         │                         │                      │
  │   merchantOrderId)      │                         │                      │
  │                         │                         │                      │
  │  GET /phonepe/callback  │                         │                      │
  │ ──────────────────────► │                         │                      │
  │                         │  Get OAuth token (again)│                      │
  │                         │  ─────────────────────► │                      │
  │                         │  ◄───────────────────── │                      │
  │                         │  Check order status     │                      │
  │                         │  ─────────────────────► │                      │
  │                         │  ◄───────────────────── │  state: COMPLETED    │
  │                         │  Update order → paid    │                      │
  │  ◄────────────────────── │                         │                      │
```

## Per-Shop Payment Configuration

Each shop has a `paymentSettings` field in the Shop model:

```js
paymentSettings: {
  razorpay: { keyId, keySecret, webhookSecret },
  easebuzz: { merchantKey, salt, env: "test"|"prod" },
  phonepe:  { clientId, clientSecret, clientVersion, env: "UAT"|"PROD" }
}
```

Configuration priority:
1. Shop-specific credentials (if `paymentConfigured` is true)
2. Platform-wide environment variables (fallback)

## Webhook Handling

### Razorpay Webhook
- **URL:** POST /webhooks/razorpay
- **Body:** Raw JSON (mounted with express.raw() to preserve signature)
- **Verification:** HMAC-SHA256 with shop-specific or platform-wide webhook secret
- **Events handled:**
  - `payment.captured` → sets order status to "paid"
  - `payment.failed` → sets order status to "cancelled"
- **Idempotency:** Uses `x-razorpay-event-id` header to prevent duplicate processing
- **Shop resolution:** Order is looked up by `razorpayOrderId` to determine the shop-specific webhook secret

## Refund Processing

### Full Cancel
- Triggered by vendor: POST /vendor/orders/:id/cancel
- Refund gateway: Razorpay (`payment.refund`) or PhonePe (`refundPayment`)
- Uses `refundStatus` field: none → pending → completed | failed

### Partial Adjustment
- Triggered by vendor: POST /vendor/orders/:id/adjust
- Refund gateway: Razorpay (`payment.refund` with amount) or PhonePe
- Records: originalTotal, updatedTotal, refundAmount, adjustedAt, adjustedBy, adjustmentReason

## Mock/Offline Payments

- POST /orders/checkout bypasses all payment gateways
- Order status immediately set to "paid"
- `paymentNote` = "mock", `transactionId` = "mock"
- Refunds for mock orders: immediate (refundStatus = "completed")

## Security Notes

1. Order total is computed server-side from cart items (cannot be tampered)
2. Razorpay payment signature is verified server-side
3. Easebuzz response hash is verified with timing-safe comparison
4. Razorpay webhook signatures are verified with raw body and shop-specific secrets
5. No payment card data is stored on FlashFoods servers
