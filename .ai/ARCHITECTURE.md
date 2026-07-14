# FlashFoods Architecture

## Overview

FlashFoods is a server-side rendered web application using the Express framework with MongoDB. It follows a Model-View-Controller (MVC) pattern with routes acting as controllers.

## Layered Architecture

```
┌────────────────────────────────────────────────────────┐
│                    Client Browser                       │
│  (EJS templates + vanilla JS + Socket.IO client)       │
└─────────────────────┬──────────────────────────────────┘
                      │ HTTP / WebSocket
┌─────────────────────▼──────────────────────────────────┐
│                  Express 5 Server                       │
│  ┌───────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐  │
│  │ Middleware │ │  Routes  │ │ Socket   │ │ Static  │  │
│  │ (auth,    │ │ (CRUD)   │ │ (IO)     │ │ Assets  │  │
│  │  upload,  │ │          │ │          │ │         │  │
│  │  db,rate) │ │          │ │          │ │         │  │
│  └───────────┘ └──────────┘ └──────────┘ └─────────┘  │
└─────────────────────┬──────────────────────────────────┘
                      │
┌─────────────────────▼──────────────────────────────────┐
│                    Models (Mongoose)                    │
│  ┌──────┐  ┌──────┐  ┌──────────┐  ┌───────┐         │
│  │ User │  │ Shop │  │ MenuItem │  │ Order │         │
│  └──────┘  └──────┘  └──────────┘  └───────┘         │
└─────────────────────┬──────────────────────────────────┘
                      │
┌─────────────────────▼──────────────────────────────────┐
│                   MongoDB Database                      │
└────────────────────────────────────────────────────────┘
```

## Request Flow

```
Request → Helmet → Rate Limiter → Session → Flash → attachUser → 
  res.locals setup → Router → Route Handler → 
  (Middleware chain: requireDb → requireAuth → requireRole) →
  Controller Logic → Model Query → Render EJS / Send JSON
```

## Key Design Decisions

1. **No client-side framework**: Uses EJS server-side rendering with vanilla JavaScript for interactivity (menu search/filter, pending order polling, notification audio)
2. **Session-based auth**: Express-session with MemoryStore (default); not stateless/JWT
3. **Webhooks before JSON parser**: Razorpay webhooks are mounted with `express.raw()` before `express.json()` to preserve raw body for signature verification
4. **Per-shop payment configuration**: Each shop can configure its own payment gateway credentials, falling back to platform-wide defaults
5. **Cart in session**: No server-side cart persistence; cart lives in `req.session.cart`
6. **Aggregation for analytics**: Admin analytics use MongoDB aggregation pipelines

## Directory Structure

```
flashfoods/
  ├── server.js           — Entry point, middleware setup, route mounting
  ├── config/             — DB, Cloudinary, Payment gateway configs
  ├── middleware/         — Auth, upload, DB health check
  ├── models/            — Mongoose schemas (User, Shop, MenuItem, Order)
  ├── routes/            — Route handlers (controllers)
  ├── utils/             — Helper functions (time, OTP, email, admin)
  ├── socket/            — Socket.IO event handlers
  ├── views/             — EJS templates
  ├── public/            — Static assets (CSS, JS, images, fonts)
  ├── menu-import/       — AI-powered menu import pipeline
  ├── tests/             — Playwright E2E tests
  └── scripts/           — One-off scripts (data migration, seed)
```

## Module Pattern

All modules use ES module syntax (`import`/`export`). Routes export Express Router instances. Models export Mongoose model instances. Config modules export configured instances or factory functions.
