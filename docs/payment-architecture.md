# FlashFoods — Payment Architecture Review

> The most important and most dangerous subsystem. This is where real money moves and where the business model is decided.

## 1. Current Design

FlashFoods uses a **per-shop, bring-your-own-keys** model. Each `Shop` stores its own gateway credentials:

```js
// models/Shop.js
paymentProvider: "razorpay" | "ccavenue" | "paytm" | "phonepe"
paymentConfigured: Boolean
paymentSettings: { merchantId, apiKey, apiSecret }   // plaintext
```

Payments are routed through an **adapter registry** (`services/payments/index.js`):

```
createOrder(provider, opts) ─┐
verifyPayment(provider, …)  ─┼─► getProviderAdapter(provider) ─► razorpay | ccavenue | paytm | phonepe
refundPayment(provider, …)  ─┘
```

| Provider | createOrder | verifyPayment | refundPayment | Status |
|---|---|---|---|---|
| **razorpay** | ✅ real | ✅ HMAC-SHA256 verified | ✅ real | **Live** |
| ccavenue | ⚠️ returns mock object | ❌ "not implemented" | ❌ none | Stub |
| paytm | ⚠️ returns mock object | ❌ "not implemented" | ❌ none | Stub |
| phonepe | ⚠️ returns mock object | ❌ "not implemented" | ❌ none | Stub |

So the marketing claim of "Razorpay, CCAvenue, Paytm, PhonePe" is, in code, **one working provider and three TODO files**. A vendor can *select* Paytm in settings and flip `paymentConfigured=true`, and the cart UI will then show "Paytm checkout coming soon" and **block checkout** — i.e., configuring a non-Razorpay provider silently disables a shop's ability to take orders.

## 2. The Razorpay Flow (the one real path)

```
Client (cart.ejs)                Server (orders.js)              Razorpay
─────────────────                ─────────────────              ────────
click Pay ──────────► POST /create-payment-order
                          loadCartShop() validates shop/provider
                          buildOrderItems() → total A
                          createPaymentOrder(razorpay,{amount:A}) ──► orders.create
                      ◄── { orderId, amount, publicKey }
open Razorpay modal
user pays ──────────────────────────────────────────────────────► capture
handler(response) ──► POST /verify-payment
                          verifyPayment(): HMAC(order_id|payment_id, secret)
                                           === razorpay_signature ?
                          buildOrderItems() → total B   ⚠ recomputed
                          Order.create({ status:"paid", total:B, … })
                      ◄── { success, orderId }
redirect /orders/:id
```

### What's correct
- **Signature verification is done server-side** with the shop's own secret (`crypto.createHmac("sha256", keySecret)`), comparing `order_id|payment_id` to `razorpay_signature`. This is the right primitive.
- Refund checks `payment.status === "captured"` before refunding and refunds in paise.
- Public key is sent from the server, not hard-coded.

### What's broken or dangerous

**🔴 1. No webhooks — order creation depends on the browser.** The order only exists if the client's `handler` callback reaches `/verify-payment`. Close the tab, lose connectivity, or kill the JS after payment, and the **money is captured but no order is created**. There is no `payment.captured` webhook, no reconciliation job, no idempotent "create-order-from-payment" path. For a real-money system this is the #1 defect. The team flagged it themselves in `payment-architecture-V1.md` ("let's try webhooks this time") and never did it.

**🔴 2. Amount is not bound to the order.** `/create-payment-order` charges amount **A** (cart snapshot at time 1). `/verify-payment` **recomputes** total **B** from the cart at time 2 and stores **B** on the order. The Razorpay payment is for A; the order claims B. If the cart changes between the two calls (add items after creating the payment order), the student can be charged less than the order's stated value, or the records simply disagree. The verify step should **load the Razorpay order by id and assert its amount equals the recomputed total**, then store the gateway amount as the source of truth.

**🔴 3. The mock bypass.** `POST /orders/checkout` creates a `paid` order with `paymentProvider:"mock"` and **no payment**. It is live and reachable by any student. This is a free-food generator. Delete it (or hard-gate behind a dev-only flag) before launch.

**🟠 4. Plaintext secrets at rest.** `paymentSettings.apiSecret` is stored unencrypted in MongoDB. A DB dump or read-only breach hands an attacker every vendor's payment secret. These must be encrypted at rest (envelope encryption / KMS) and never selected into views.

**🟠 5. Secret leakage into HTML.** `views/vendor/payment-settings.ejs` renders `value="<%= shop.paymentSettings?.apiSecret %>"` into a password field — the secret is in the page source, visible via "View Source" and to anything that can read the DOM. Never echo secrets back; show a "configured ••••" indicator instead.

**🟠 6. No credential validation.** Saving payment settings flips `paymentConfigured=true` without a test API call. Bad keys are discovered only when a student's payment fails.

**🟡 7. Refund coupling.** `isRefundableOrder` hard-codes Razorpay's `pay_` transaction prefix and returns `false` for all other providers, so the cancel-with-refund flow is Razorpay-only by construction.

**🟡 8. Float money.** Amounts are JS `Number`. Use integer paise end-to-end.

## 3. The Business-Model Problem (read this twice)

The architecture must serve **two** stated goals that, as currently built, are mutually exclusive:

> "Money should go directly to the vendor's account."
> "FlashFoods should generate commission reports and billing."

With **bring-your-own-keys direct settlement**, FlashFoods is *never a party to the transaction*. Consequences:
- No authoritative settlement ledger → commission "reports" would be **reconstructed from FlashFoods' own order records**, which a vendor can dispute (and which diverge from the gateway's truth — see defect #2).
- Commission must be **invoiced after the fact** and collected manually → high leakage, disputes, and zero leverage if a vendor stops paying.
- FlashFoods has no ability to **withhold** its cut; it depends entirely on vendor goodwill.

### The two viable models — decide explicitly, now

| Model | How it works | Commission | Settlement | Effort |
|---|---|---|---|---|
| **A. Marketplace / split (recommended)** | FlashFoods is merchant of record; uses **Razorpay Route / PhonePe / Paytm sub-merchant** APIs to auto-split each payment: vendor share → vendor linked account, commission → FlashFoods, atomically at capture | **Automatic, at source** | Gateway handles vendor payout | Higher — KYC of vendors as sub-merchants, one platform gateway account |
| **B. Direct settlement + invoicing (current)** | Each vendor's own keys; money goes straight to them; FlashFoods bills monthly | **Manual, after the fact** | Vendor's own | Lower today, **expensive forever** in ops + disputes |

The current code implements **B**. The business plan describes **A**. This mismatch should be resolved before signing vendor contracts, because it dictates the data model (sub-merchant/linked-account IDs vs. raw keys), the KYC flow, and the entire ledger design. My recommendation is **Model A with Razorpay Route as the launch provider**, keeping the adapter layer so other gateways' split APIs can be added later.

## 4. Recommended Payment Architecture (target)

1. **Single platform gateway account** (FlashFoods as merchant of record) + **per-vendor linked sub-accounts** for split settlement.
2. **Webhook ingress** (`POST /webhooks/razorpay`) with signature verification → idempotent order/payment upsert. Webhook is the source of truth; client callback is an optimization.
3. **`Payment` entity** separate from `Order`, storing gateway order id, payment id, **amount in paise**, captured amount, split breakdown (vendor share, platform commission), and status — keyed by an idempotency key.
4. **Encrypt vendor credentials / linked-account tokens** at rest; never render them.
5. **Commission ledger** derived from captured webhooks → enables real, defensible billing reports.
6. **Reconciliation job** that compares gateway settlements to local records daily.
7. Keep the **adapter pattern**; add a `splitConfig`/`getLinkedAccount` capability per provider.

## 5. Pre-Launch Payment Checklist

- [ ] Remove/gate `POST /orders/checkout` mock path
- [ ] Implement Razorpay webhook + idempotent order creation
- [ ] Bind charged amount to stored order; verify gateway amount on confirm
- [ ] Encrypt `apiSecret` at rest; stop rendering it in HTML
- [ ] Decide and implement the commission model (A vs B)
- [ ] Validate vendor credentials with a live test call on save
- [ ] Move money to integer paise
- [ ] Either implement or hide the 3 stub providers (don't ship "coming soon" that disables checkout)
