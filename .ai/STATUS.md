# Project Status

## FlashFoods — Smart College Canteen Pre-ordering System

**Version:** 1.0.1
**Last Updated:** 2026-07-15
**Status:** Sprint 1 Complete — All objectives verified

---

## Current State

- **Server:** Express 5 (ES modules)
- **Database:** MongoDB with Mongoose ODM
- **Templating:** EJS server-side rendering
- **Real-time:** Socket.IO for order notifications
- **Testing:** Playwright E2E (Chromium, Firefox, WebKit)
- **CI/CD:** GitHub Actions (Playwright on push/PR)

## Documentation

| Area | Location | Status |
|------|----------|--------|
| AI Knowledge Base | `.ai/` | ✅ Complete (11 files) |
| Technical Docs | `docs/` | ✅ Complete (13 files) |
| Engineering Audit | `docs/ENGINEERING_AUDIT.md` | ✅ Complete |

## Cleanup Completed

- Removed backup files (`package.json.bak`, `package-lock.json.bak`)
- Removed accidental cookie file (`-b`)
- Removed duplicate image (`background-image copy.png`)
- Removed binary test file (`test.txt`)
- Updated `.gitignore` with backup and temp patterns

## Tests Added

| Test File | Tests | Type |
|-----------|-------|------|
| `tests/login.spec.js` | 3 | Auth E2E |
| `tests/smoke.spec.js` | 6 | Page load smoke tests |
| `tests/permissions.spec.js` | 10 | Role-based access control |
| `tests/vendor-workflow.spec.js` | 5 | Vendor operations |
| `tests/student-workflow.spec.js` | 6 | Student operations |

## Stabilization Sprint (2026-07-15)

### Fixes Applied

| Priority | Bug | Files | Status |
|----------|-----|-------|--------|
| Critical | Missing `return` before `res.json()` in try/catch (double-header risk) | `routes/orders.js`, `routes/vendor.js` | ✅ |
| High | Past pickup time accepted (no validation) | `utils/time.js`, `routes/orders.js` | ✅ |
| High | Optional chaining on `req.flash?.()` in Easebuzz callback | `routes/orders.js` | ✅ |
| Medium | Debug logs in PhonePe refund code leaking transaction IDs | `config/phonepe.js` | ✅ |
| Medium | Missing `return` before `res.render()` in all route files (35+ calls) | All route files | ✅ |
| Medium | Payment buttons not disabled on click (double-click risk) | `views/cart/index.ejs` | ✅ |

### Remaining Known Issues

1. MemoryStore for sessions is not production-safe
2. Easebuzz refunds not implemented (manual processing required)
3. Paytm and BharatPe payment flows not implemented
4. No admin audit logging
5. Password reset does not invalidate existing sessions
6. No CSRF protection (sameSite cookie commented out)
7. No auth rate limiting (brute force risk)
8. Cart not persisted across server restarts
9. Socket.IO has no authentication middleware

## Sprint 1 Verification Fixes (2026-07-15)

### Issues Found & Fixed

| Issue | Root Cause | Files | Status |
|-------|-----------|-------|--------|
| Mark Unavailable broken | Missing `import { Shop }` in `routes/menu.js` — ReferenceError on toggle | `routes/menu.js` | ✅ |
| Background regression | CSS referenced deleted `background-image copy.png` | `public/styles.css` | ✅ |
| Vendor nav shows "Canteens" | Unconditional link in `header.ejs` | `views/partials/header.ejs` | ✅ |
| Category filter missing | No `category` field in MenuItem schema; "Unknown" button shown | `models/MenuItem.js`, `routes/vendor.js`, `routes/admin.js`, `views/partials/menu-table.ejs` | ✅ |
| Parcel charge | Verified working end-to-end | — | ✅ |
| Pickup time banner | Verified implemented | — | ✅ |
| Vendor login redirect | Verified working | — | ✅ |

## Pilot Stability Sprint 1 — Vendor Workflow Optimization (2026-07-15)

### Objectives Applied

| # | Objective | Files | Status |
|---|-----------|-------|--------|
| 1 | Vendor login redirect → pending orders | `routes/auth.js` | ✅ |
| 2 | Remove vendor canteens panel ("View menu" link) | `views/partials/vendor-nav.ejs` | ✅ |
| 3 | Category filter on menu | `views/partials/menu-table.ejs`, `public/js/menu-table.js` | ✅ |
| 4 | Parcel charges (per-shop, per-order) | `models/Shop.js`, `models/Order.js`, `routes/orders.js`, `routes/vendor.js`, `views/vendor/payment-settings.ejs`, `views/vendor/pending-orders.ejs`, `views/orders/show.ejs` | ✅ |
| 5 | Pickup time visibility (color-coded banner on card) | `views/vendor/pending-orders.ejs`, `routes/vendor.js` | ✅ |
