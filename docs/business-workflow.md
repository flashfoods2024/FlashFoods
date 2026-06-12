# FlashFoods — Business Workflow

> What actually happens in the system today, mapped from the code — not the pitch deck.

## 1. Actors

| Role | How created | Capabilities |
|---|---|---|
| **Student** | Self sign-up (`/signup`, role defaults to student) | Browse shops, build cart, pay, track order, show OTP |
| **Vendor** | Self sign-up *or* admin-created; must be linked to a Shop by an admin | Manage menu, open/close shop, view/ready/cancel orders, verify OTP, set payment credentials |
| **Admin** | **Seed script only** (`seed.js`) | CRUD shops/vendors/students, assign vendor↔shop, analytics, view all orders |
| **Shop** | Admin-created | The vendor's storefront + payment config |

There is **no College/Campus actor**, despite the multi-college business goal. All shops are global.

## 2. Vendor Onboarding (current)

```
Admin creates Shop (name, slug, image, open/closed)
        │
Admin creates Vendor user  ──or──  Vendor self-signs-up
        │
Admin links Vendor ↔ Shop  (syncVendorShopLink, maintains both sides)
        │
Vendor logs in → /vendor/payment-settings
        │
Vendor enters provider + merchantId + apiKey + apiSecret
        │
shop.paymentConfigured = true   ← no validation that the keys actually work
        │
Vendor adds menu items (name, price, image via Cloudinary)
        │
Shop is now orderable (if isActive && isOpen && paymentConfigured)
```

**Friction & gaps in onboarding:**
- A self-registered vendor is **stranded** until an admin manually links a shop. No invite flow, no self-serve.
- Payment credentials are **saved without a test call** — a vendor can typo their secret and only discover it when the first student's payment fails.
- **No KYC / business verification.** For a real-money marketplace this is both a trust and a compliance gap.
- Admin creation is seed-only; there is no way to provision a second admin without DB/console access.

## 3. Student Ordering Workflow

```
Browse /shops → /shops/:slug (only available menu items shown)
        │
Add to cart (POST /cart/add)
   • cart is session-bound
   • cart is locked to ONE shop; mixing shops is blocked
        │
/cart → choose pickup time (client-generated 5–120 min options)
        │
[Razorpay path]                          [Mock path — SHOULD NOT EXIST]
POST /create-payment-order               POST /orders/checkout
   creates Razorpay order (amount A)        creates a PAID order with
        │                                    NO payment, provider="mock"
Razorpay checkout modal                      │
   user pays                              order saved as "paid"
        │
handler → POST /verify-payment
   • HMAC signature verified server-side
   • order total RECOMPUTED from cart (amount B)
   • Order created: status "paid", OTP generated
        │
Redirect to /orders/:id
        │
Order page polls /api/orders/:id/status every 5s
```

Key observations:
- Pickup time is **purely cosmetic scheduling** — it drives vendor queue ordering (priority sort) and urgency colors, but nothing enforces or reminds against it.
- The **mock checkout path** (`/orders/checkout`) bypasses payment entirely and is reachable by any student. It is presumably a dev shortcut that was never gated. It undermines the entire revenue model. (See security & technical-debt docs.)
- There is **no order confirmation email/SMS/push** — the student must keep the browser tab open and rely on 5-second polling.

## 4. Order Lifecycle (state machine)

```
            (real flow skips pending_payment)
pending_payment ─────────────────────────────►  paid
   (defined, effectively unused)                  │
                                     ┌────────────┴─────────────┐
                                     ▼                          ▼
                          ready_for_pickup               cancelled (+ refund)
                                     │                    (vendor-initiated)
                                     ▼
                                 completed
                            (OTP verified at counter)
```

| Transition | Trigger | Code |
|---|---|---|
| → `paid` | Successful payment (or mock) | `orders.js` |
| `paid` → `ready_for_pickup` | Vendor clicks "Mark ready" | `vendor.js /ready` |
| `paid` → `cancelled` | Vendor cancels → refund attempted | `vendor.js /cancel` |
| `ready_for_pickup` → `completed` | Vendor enters student's 6-digit OTP | `vendor.js /verify` |

**Lifecycle gaps:**
- `pending_payment` is a defined status that the **happy path never uses** — orders are born `paid`. Dead state.
- **No student-initiated cancellation.** Only vendors can cancel/refund.
- **No timeout/expiry** for orders that are never picked up. They sit in `ready_for_pickup` forever, inflating the vendor's verify queue.
- **Cancellation is only safe for Razorpay.** `isRefundableOrder` returns `false` for every other provider, so a paid Paytm/PhonePe/CCAvenue order (once those go live) cannot be cancelled-with-refund through the UI.
- **OTP has no expiry and no verify-attempt throttle.** It's scoped to `shop + status=ready_for_pickup`, which limits blast radius, but it is brute-forceable in principle.

## 5. The Pickup / OTP Verification Workflow

1. On payment, a 6-digit OTP is generated with a CSPRNG (`crypto.randomInt`) — good.
2. The OTP is **hidden** from the student until the vendor marks the order `ready_for_pickup` (the order page only reveals the code in the ready state) — a nice anti-leak detail.
3. Student shows the code; vendor types it into `/vendor/verify`; the order flips to `completed` and stamps `collectedAt`.

This flow is simple and sound. The only weaknesses are the lack of OTP expiry and no rate-limit on the verify endpoint.

## 6. The Money / Commission Workflow — and the core business contradiction

The stated long-term model has **two requirements that the current architecture cannot satisfy simultaneously**:

1. "Money should go **directly to the vendor's account**." → Implemented: each shop holds its own gateway keys, so funds settle to the vendor, and FlashFoods never touches the money.
2. "FlashFoods should generate **commission reports and billing**." → **Not possible with #1 as built.** If FlashFoods is never in the money flow, it has no authoritative record of settled amounts, no way to withhold a cut, and must instead *invoice vendors after the fact* and chase payment — a weak, high-leakage position.

The reconciling pattern the industry uses is a **marketplace/split-settlement** model (e.g., Razorpay Route, PhonePe/Paytm equivalents): the platform is the merchant of record, takes payment, auto-splits the vendor's share to a linked sub-account, and **retains commission at the moment of capture**. The current "vendor brings their own keys" design is simpler but **structurally forfeits automated commission** — the single most important monetization mechanism. This is a business-architecture decision that should be made deliberately, now, before vendor contracts are signed. (Expanded in `payment-architecture.md`.)

## 7. Admin Workflow

Admins get a genuine back office: dashboard KPIs, shop/vendor/student CRUD, vendor↔shop linking with both-sides consistency, an all-orders view with search/filter, and an analytics page (revenue, peak hour, top shops/vendors, popular item) built on MongoDB aggregations. This is the most complete part of the product. Its weaknesses are operational (loads all orders into memory, no pagination) rather than functional.

## 8. Summary of Workflow Risks

| Risk | Severity |
|---|---|
| Free orders via reachable mock checkout | 🔴 Critical |
| No webhook → captured-payment-without-order | 🔴 Critical |
| Commission model not achievable with direct-settlement design | 🔴 Critical (business) |
| No tenancy → colleges share data | 🟠 High |
| Vendor stranded without admin linking; no KYC | 🟠 High |
| No OTP expiry / no order pickup timeout | 🟡 Medium |
| Refund only works for Razorpay | 🟡 Medium |
| No notifications; reliance on polling | 🟡 Medium |
