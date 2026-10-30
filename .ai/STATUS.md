# Project Status

## FlashFoods — Smart College Canteen Pre-ordering System

**Version:** 1.0.1
**Last Updated:** 2026-10-29
**Status:** F08 and the navbar-blinking fix COMPLETE; F09 Phase 1 COMPLETE, Phase 2 pending; F10 Custom Billing Template Phases 1–4 COMPLETE, Phase 5 partial (browser evidence outstanding)

---

## Current State

- **Server:** Express 5 (ES modules)
- **Database:** MongoDB with Mongoose ODM
- **Templating:** EJS server-side rendering
- **Real-time:** Socket.IO for order notifications
- **Push:** FCM infrastructure (order-ready student notifications)
- **Testing:** unit and isolated Playwright checks are available; F09 Phase 1
  baseline completed with an isolated in-memory Mongo/browser probe
- **CI/CD:** GitHub Actions (Playwright on push/PR)

## Current Feature / Phase / Blockers

- Current feature: F09 Native-Feel Student Navigation — IN PROGRESS
- Current phase: Phase 1 — Baseline and focused proof — COMPLETE
- F09 implementation status: no persistent shell, DOM navigation controller,
  fragment response, or page-lifecycle migration has been implemented.
- Verified current navigation: ordinary same-origin anchors trigger full-document
  navigation. The footer listener only sets `aria-busy` and appends a skeleton;
  it does not fetch or replace content.
- Completed prerequisite: the navbar-blinking fix is present and must be
  preserved. It keeps `.portal-nav` visible/clickable during Liquid Glass
  startup and isolates its View Transition group.
- Blockers: none for Phase 1 completion. Phase 2 is pending and dependency-locked.
- F09 phase states: Phase 1 COMPLETE; Phases 2–6 PENDING and dependency-locked.

### F09 phase evidence

#### Phase 1 — Baseline and focused proof — COMPLETE 2026-10-29

**Scope and changes**

- No application source, EJS, CSS, configuration, dependency, or repository test
  file was changed.
- A temporary external probe was used at
  `/tmp/opencode/f09-phase1-probe.mjs`; it was not added to the repository.
- The probe observed document navigation timing, first paint, page lifecycle,
  Liquid Glass class changes, navbar computed styles, View Transition computed
  durations, active tabs, response status, and browser/page errors.

**Safe environment and commands**

- Started `scripts/qa-vendor-profile-server.mjs` with `QA_PORT=3124`; it used
  `mongodb-memory-server-core` and a local-only student fixture. No configured
  MongoDB URI, production data, live payment, push notification, or external
  service was used.
- Ran the probe twice with headless Chromium at **393×852**:
  `node /tmp/opencode/f09-phase1-probe.mjs`
- Ran focused syntax checks:
  `node --check public/js/student-glass.js`
  and `node --check /tmp/opencode/f09-phase1-probe.mjs`.
- The generated temporary QA fixture was removed after the run. No broad unit or
  default Playwright suite was run because Phase 1 required only the focused
  browser baseline.

**Measured baseline**

Two traversals covered seven click navigations each (14 total): Home → Browse,
Browse → Home, Home → Orders, Orders → Cart, Cart → Orders, Orders → Browse, and
Browse → Orders.

| Sequence | Mean click→load | Mean response start | Mean load event | HTML transfer |
|---|---:|---:|---:|---:|
| Home → Browse | 539.0 ms | 21.4 ms | 235.3 ms | 18,528 B |
| Browse → Home | 511.1 ms | 32.2 ms | 210.5 ms | 17,576 B |
| Home → Orders | 591.0 ms | 37.1 ms | 270.1 ms | 16,844 B |
| Orders → Cart | 542.7 ms | 21.9 ms | 235.1 ms | 26,412 B |
| Cart → Orders | 497.9 ms | 31.8 ms | 196.8 ms | 16,844 B |
| Orders → Browse | 547.4 ms | 23.7 ms | 234.2 ms | 18,528 B |
| Browse → Orders | 527.0 ms | 31.5 ms | 229.2 ms | 16,844 B |

Across all measurements, click-to-load was **536.6 ms mean**, **539.0 ms
median**, with a **495.5–630.8 ms** range. Navigation response start was
19.1–50.5 ms and load event completion was 188.5–276.1 ms. First contentful
paint was observed after the document response, with route/run variation.

**Verified behavior**

- Every click returned HTTP 200 and had `navigationType: "navigate"`.
- A new document token was observed for every click; this confirms the current
  path is full-document navigation rather than DOM replacement.
- The existing footer listener's skeleton was observed before every destination
  document (`skeletonFromPreviousDocument: true`); it is loading feedback only.
- The active tab matched the destination on all 14 navigations. Back/Forward
  returned to `/shops` and `/orders` with `navigationType: "back_forward"` and
  correct active tabs.
- Each destination document had exactly one `.portal-nav`, one Liquid Glass
  canvas/active lens, and `liquidgl-on` after initialization.
- Navbar sampling found minimum opacity **1**, zero hidden-opacity frames, zero
  `pointer-events: none` frames, and zero non-displayed frames on every measured
  transition. The completed blinking fix remained intact.
- Liquid Glass `liquidgl-pending` → `liquidgl-on` took **85.5 ms mean**, with a
  **44.4–127.8 ms** observed range. The root View Transition computed duration
  was **180 ms** and the `student-bottom-nav` group was **0 ms**.
- No console errors or page errors were observed.

**Phase 1 measurement-gap follow-up — COMPLETE**

- The smallest safe approach was a temporary wrapper at
  `/tmp/opencode/f09-instrumented-harness.mjs`. Before importing the existing
  QA harness, it injected one timing middleware before the app's first
  middleware and wrapped Express `response.render`.
- The wrapper emitted `Server-Timing: app` for total server request handling
  through response headers and `Server-Timing: ejs` for view lookup/template
  rendering. It changed no application source and was removed with the local
  harness after measurement.
- One isolated headless Chromium traversal at **393×852** covered the same
  seven navigation sequences. All responses were HTTP 200, the probe recorded
  both timing metrics, and no console/page errors occurred.

| Sequence | Server total (`app`) | EJS render (`ejs`) | Browser response start | Local transport/protocol estimate |
|---|---:|---:|---:|---:|
| Home → Browse | 20.478 ms | 7.191 ms | 27.7 ms | 7.2 ms |
| Browse → Home | 36.053 ms | 16.815 ms | 48.6 ms | 12.5 ms |
| Home → Orders | 47.857 ms | 12.940 ms | 57.5 ms | 9.6 ms |
| Orders → Cart | 22.090 ms | 12.672 ms | 31.9 ms | 9.8 ms |
| Cart → Orders | 31.067 ms | 10.843 ms | 38.6 ms | 7.5 ms |
| Orders → Browse | 16.895 ms | 6.050 ms | 24.9 ms | 8.0 ms |
| Browse → Orders | 30.496 ms | 10.248 ms | 42.4 ms | 11.9 ms |

Across the follow-up traversal, server handling averaged **29.277 ms** (range
**16.895–47.857 ms**), EJS rendering averaged **10.966 ms** (range
**6.050–16.815 ms**), and the browser response-start minus server-total estimate
averaged **9.523 ms** (range **7.222–12.547 ms**). Browser response transfer
intervals averaged **1.214 ms**. These measurements distinguish server route/data
plus EJS work from the browser's local transport timing sufficiently for the
Phase 1 completion gate.

Phase 1 is complete. Do not begin Phase 2 in this session.

## F10 — Custom Billing Template System (2026-10-30)

- Status: COMPLETE for the locked scope. Phases 1–5 executed with unit, isolated
  HTTP, security, rendering, Playwright E2E and regression evidence.
- Spec: `billing-template/`; execution log: `billing-template/EXECUTION_LOG.md`;
  final report: `REPORT_BILLING_TEMPLATE.md`.
- Implemented: `pdf-lib` + `@pdf-lib/fontkit` + local `pdfjs-dist` worker;
  Roboto Regular/Medium/Bold with licence; private git-ignored storage;
  `InvoiceTemplate`/`Invoice`/`InvoiceCounter` models; dedicated 10 MB PDF
  upload middleware with signature/parse/encryption/page checks; vendor Billing
  Template card in `views/partials/menu-manager.ejs`; PDF.js preview and
  PDF-space field mapping; Roboto overlay renderer; authoritative invoice data
  and snapshot; atomic shop-scoped numbering; idempotent issuance from both
  pickup completion paths; student and vendor invoice download.
- Fallback preserved: shops without an active template keep the existing
  `views/orders/show.ejs` default order bill, and the download action appears
  only when an `Invoice` row exists.
- Verification executed: `npm test` → 332/332 pass; `npm run test:e2e:billing`
  → 1/1 pass (real Testing shop, mock checkout, OTP pickup, invoice download,
  template replace/remove, fallbacks, role blocks);
  `npm run test:e2e:vendor-profile` → 15/15 pass; isolated HTTP checks → upload,
  template stream (`%PDF-`), invalid-PDF reject, student route blocks,
  cross-vendor 302, CSRF 403, PDF.js assets 200.
- Render measurements: 1 line 146.3 ms; 12 lines 111.9 ms; 30 lines 119.0 ms
  (2 pages, template sha unchanged).
- Defects found and fixed: async `latestVersion()`; right-aligned default
  `maxWidth`; preview invalidated on identical re-save; missing issuance wiring
  after QR/OTP completion; `NaN` lineHeight on wrapped text; null
  `#billing-activate` binding after activation; continuation page number off by
  one.
- Not verified: QR completion driven in the browser (shares the same issuance
  call; existing pickup tests pass), live gateway payments, bulk backfill, tax
  breakdown enabled in E2E.
- Unresolved: DECISION-1 statutory invoice number format; DECISION-7 per-gateway
  payment evidence. No tax is computed (`taxMode: "none"` default).
- No Git operations, deploys, production data, `.env` reads, or live
  gateway/FCM/Cloudinary calls were performed.

## Last Milestone

F07 QR Pickup COMPLETE (2026-09-24), incl. Pending Orders primary pickup
surface; full-suite QA PASS (68/68 live checks, reports at repo root).
History: `.ai/HISTORY.md`.

## Known Issues (carried forward, non-blocking)

1. MemoryStore for sessions is not production-safe
2. Easebuzz refunds not implemented (manual processing required)
3. Paytm and BharatPe payment flows not implemented
4. No admin audit logging
5. Password reset does not invalidate existing sessions
6. CSRF origin protection is present; other session/auth hardening remains
7. No rate limiting (removed by product policy, not a defect)
8. Cart not persisted across server restarts
9. Socket.IO has no authentication middleware
