# Architecture Document

## System Overview

FlashFoods is a monolithic web application for college canteen pre-ordering. It uses server-side rendering with EJS templates and real-time updates via Socket.IO.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (ES Modules) |
| Framework | Express 5 |
| Database | MongoDB 7.x |
| ODM | Mongoose 8.x |
| Templating | EJS 5 |
| Real-time | Socket.IO 4 |
| Auth | express-session + bcryptjs |
| Uploads | Multer + Cloudinary |
| Payments | Razorpay, Easebuzz, PhonePe |
| AI | Google Gemini API |
| Email | Resend |
| Testing | Playwright |
| CI | GitHub Actions |

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Client Browser                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ EJS View │  │Vanilla JS│  │ Socket.IO    │  │  Stylesheets  │  │
│  │ (HTML)   │  │ (DOM)    │  │ (Notif)      │  │  (CSS)        │  │
│  └──────────┘  └──────────┘  └──────────────┘  └───────────────┘  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                      Express 5 Application                           │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                   Middleware Pipeline                        │    │
│  │  Helmet → Session → Flash → attachUser →          │    │
│  │  res.locals (user, cart, shop, flash, helpers)              │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌───────────┐  │
│  │  authRouter  │ │ shopsRouter  │ │  cartRouter  │ │ordersRouter│  │
│  ├──────────────┤ ├──────────────┤ ├──────────────┤ ├───────────┤  │
│  │  /signup     │ │  /shops      │ │  /cart       │ │ /orders   │  │
│  │  /login      │ │  /shops/:slug│ │  /cart/add   │ │ /create-  │  │
│  │  /forgot-pwd │ │              │ │  /cart/variant│ │ razorpay  │  │
│  │  /reset-pwd  │ │              │ │  /cart/line  │ │ /verify-  │  │
│  │  /logout     │ │              │ │  /cart/clear │ │ payment   │  │
│  └──────────────┘ └──────────────┘ └──────────────┘ │ /easebuzz │  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │ /phonepe  │  │
│  │ vendorRouter │ │  menuRouter  │ │  adminRouter │ │ /checkout │  │
│  ├──────────────┤ ├──────────────┤ ├──────────────┤ └───────────┘  │
│  │ /vendor/menu │ │ /menu/:id/   │ │ /admin/...   │ ┌───────────┐  │
│  │ /vendor/     │ │ toggle       │ │ (full CRUD)  │ │webhooks   │  │
│  │ orders/*     │ └──────────────┘ └──────────────┘ │Router     │  │
│  │ /vendor/     │                                     │ /webhooks/│  │
│  │ verify       │                                     │ razorpay  │  │
│  └──────────────┘                                     └───────────┘  │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                  Global Error Handler                        │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                     Models (Mongoose)                                │
│  ┌────────┐  ┌────────┐  ┌────────────┐  ┌──────────┐  ┌────────┐  │
│  │  User  │  │  Shop  │  │ MenuItem   │  │  Order   │  │ (Index)│  │
│  │        │  │        │  │            │  │          │  │        │  │
│  │ _id    │  │ _id    │  │ _id        │  │ _id      │  │ shop:1 │  │
│  │ name   │  │ name   │  │ shop (ref) │  │ customer │  │  name:1│  │
│  │ email  │  │ slug   │  │ name       │  │ shop     │  │        │  │
│  │ pwdHash│  │ vendor │  │ price      │  │ items[]  │  │ shop:1 │  │
│  │ role   │  │ isOpen │  │ variants[] │  │ total    │  │  status│  │
│  │ isActive│ │ isActive│ │ available  │  │ pickupOtp│  │        │  │
│  │ shop   │  │ payment │ │ foodType   │  │ status   │  │ shop:1 │  │
│  │        │  │Settings │ │            │  │ refund   │  │  otp:1 │  │
│  └────────┘  └────────┘  └────────────┘  └──────────┘  └────────┘  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│                        MongoDB Database                              │
│                     (canteen_orders)                                 │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  External Services                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │Cloudinary│  │ Resend   │  │Gemini API│  │Razorpay  │            │
│  │(Images)  │  │(Email)   │  │(AI Vision)│  │(Payment) │            │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                           │
│  │ Easebuzz │  │ PhonePe  │  │ Socket.IO│                           │
│  │(Payment) │  │(Payment) │  │(Real-time)│                          │
│  └──────────┘  └──────────┘  └──────────┘                           │
└──────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Order Placement (Razorpay)
```
1. Student adds items to cart (session)
2. Student selects variant for each item
3. POST /create-razorpay-order → validates cart, creates Order (pending_payment), returns Razorpay order
4. Client-side Razorpay checkout popup
5. POST /verify-payment → verifies signature, updates Order to "paid"
6. Socket.IO emits pending-count to vendor shop room
7. Cart cleared
```

### Order Fulfillment
```
1. Vendor sees pending order via Socket.IO notification
2. POST /vendor/orders/:id/accept → status becomes "accepted"
3. Vendor prepares food
4. POST /vendor/orders/:id/ready → status becomes "ready_for_pickup"
5. Student arrives at canteen with OTP
6. POST /vendor/verify with OTP → status becomes "completed"
```

## Session Management

- Session stored in memory (default MemoryStore)
- User ID stored in `req.session.userId`
- Cart stored in `req.session.cart`
- Flash messages via `connect-flash`
- No session persistence across server restart

## File Upload Flow

```
1. POST with multipart/form-data
2. Multer middleware processes upload
3. If Cloudinary configured: upload to Cloudinary CDN
4. Cloudinary URL stored in database
5. If Cloudinary not configured: redirect with error
```

## Menu Import Flow (AI)

```
1. Admin uploads menu image
2. Image temporarily stored on local filesystem
3. Gemini Vision API extracts menu items
4. JSON recovery handles malformed AI responses
5. Preview rendered for admin review
6. Admin confirms → items inserted into database
7. Temporary files cleaned up
```
