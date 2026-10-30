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
Request → Helmet → Session → Flash → attachUser → 
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

## Current student navigation (verified 2026-10-29)

The student portal currently uses full-document navigation:

1. `views/partials/student-bottomnav.ejs` emits ordinary same-origin anchors.
2. The student-only listener in `views/partials/footer.ejs` observes eligible
   clicks in capture phase, marks `main.container[aria-busy]`, and appends a
   page-shaped skeleton. It does not prevent the default action, fetch a page,
   or replace a content region.
3. The browser requests a new document. Express rebuilds `res.locals`, runs the
   route middleware/data queries, and renders a complete EJS document.
4. The new document loads the shared header/footer scripts and initializes a
   new student Liquid Glass instance when eligible.

The four initial F09 destinations are served by the existing server routes:

| Destination | Current server work | Page-specific client behavior |
|---|---|---|
| `/` | `server.js` loads open shops/items and an active student order | notification opt-in interaction; forms remain POST |
| `/shops` | `routes/shops.js` loads active shops and availability | canteen search and visual-only favourites |
| `/orders` | `routes/orders.js` loads the authenticated student's orders | order links remain ordinary navigation |
| `/cart` | `routes/cart.js` loads session cart, menu items, prices/discounts, and slots | variants, quantities, order type, payment launch, and POST/fetch mutations |

The current document has no shared replaceable student-content boundary. The
bottom navbar is included by each student page, so it is recreated on every
full navigation. `@view-transition { navigation: auto; }` and the 180 ms root
transition provide browser enhancement only; they do not make the application
a client-side router.

The completed navbar blinking fix is part of the current architecture:
`public/js/student-glass.js` uses `liquidgl-pending` while the library starts,
sets `reveal: "none"`, and marks the navbar active only after initialization;
`public/styles.css` keeps the surface visible/clickable and gives
`.portal-nav` the `student-bottom-nav` View Transition group with zero-duration
animation. This behavior is a protected dependency of F09.

## F09 target architecture (planned, not implemented)

F09 will evaluate a persistent, server-rendered student shell with controlled
DOM-based navigation. The target is an incremental enhancement to this
architecture, not a framework migration.

### Persistent and replaceable regions

For supported student destinations, keep these elements mounted:

- the shared student top header/document shell,
- the single `.portal-nav` and its bottom clearance,
- the student backdrop and Liquid Glass canvas/renderer,
- global shell services that are proven safe to initialize once.

Replace only a dedicated `student-page-content` region containing the current
destination's server-rendered EJS content. The exact EJS extraction boundary is
to be proven in Phase 2; do not assume the current page wrappers can be swapped
without lifecycle work.

Initially supported soft navigation is limited to `/`, `/shops`, `/orders`, and
`/cart`. Shop detail, order detail, Profile, authentication, payment redirects,
vendor/admin routes, and unsupported links retain ordinary full-document
navigation until separately covered.

### Server authority and fallback

Express remains responsible for authentication, authorization, session state,
database queries, cart/order/payment rules, flash/redirect behavior, and
server-rendered data. The first proof may fetch an existing full response and
extract a validated boundary; an explicit fragment response should be added
only if measurements justify it. Full-page rendering remains the direct-URL and
failure fallback.

The controller may issue only safe same-origin GET requests. It must not replace
the document with a login page when an authenticated request redirects to
`/login`; it must detect the unexpected destination and use normal browser
navigation. Personalized fragments require appropriate non-shared cache
controls.

### Navigation state and lifecycle

The target controller must synchronize `history.pushState`/`popstate`, URL,
document title, active tab, `aria-current`, scroll restoration, and loading/error
state. It must abort or supersede stale requests and keep the previous content
usable until a validated destination is ready.

Each replaceable page needs an explicit init/cleanup boundary. Browse search,
Cart controls/payment SDK setup, Home notification controls, and any order
polling must not accumulate listeners or timers. Soft navigation does not fire
`beforeunload`, so order-detail polling cannot rely on that event if that page is
ever included in the shell.

### PWA and asset behavior

The current service worker fetches navigation requests from the network and
precaches/static-caches assets; it does not provide cached HTML navigation.
F09 must not change that strategy without measured need and a separate safety
review. Existing asset versioning, Firebase/Socket.IO initialization, and
update-manager behavior must remain correct when a shell is persistent.

### Architectural non-goals

Do not introduce React, a new router framework, client-side copies of business
rules, a second payment path, or a broad rewrite of vendor/admin/auth pages.
Use the smallest persistent-shell design that can satisfy the F09 contract and
keep progressive full-document fallback.
