# Stabilization Plan

## Sprint 1: Critical Bugs ✅

**Goal**: Fix double-header risk in try/catch blocks.

| Bug | Status |
|-----|--------|
| C-1: Missing `return` before `res.json()` in try/catch | ✅ Fixed |

### Files Modified
- `routes/orders.js`: Added `return` before `res.json()` and catch block
- `routes/vendor.js`: Added `return` before `res.json()` and catch block

---

## Sprint 1 Verification Pass ✅

**Goal**: Verify all Sprint 1 objectives are implemented and working.

| Acceptance Criteria | Status |
|---------------------|--------|
| Background restored (hero references existing file) | ✅ Fixed |
| Vendor nav "Canteens" link removed for vendors | ✅ Fixed |
| Category filter working, "Unknown" removed from UI | ✅ Fixed |
| Parcel charge feature working (Shop + Order models, payment calculations, views) | ✅ Verified |
| Mark Unavailable works (missing Shop import fixed) | ✅ Fixed |
| Pickup time redesign complete (color-coded banner) | ✅ Verified |
| Vendor login redirects to pending orders | ✅ Verified |
| No syntax errors (all JS files pass node --check) | ✅ Verified |

### Root Cause Summary

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Mark Unavailable broken | `routes/menu.js` missing `import { Shop }` — ReferenceError on toggle | Added import |
| Background regression | CSS referenced deleted `background-image copy.png` | Changed to `background-image.png` |
| Vendor nav shows "Canteens" | `header.ejs:43` unconditional link | Wrapped in `<% if (!currentUser || currentUser.role !== "vendor") { %>` |
| Category filter not working | MenuItem schema had no `category` field — never persisted | Added field to schema + save in create/update routes |
| "Unknown" filter button shown | Unnecessary food type filter for unknown items | Removed button from menu-table.ejs |

### Files Modified (Sprint 1 Verification)
- `routes/menu.js`: Added `import { Shop }`
- `public/styles.css`: Fixed `background-image copy.png` → `background-image.png`
- `views/partials/header.ejs`: Conditional rendering for "Canteens" link
- `models/MenuItem.js`: Added `category` field (String, default "")
- `routes/vendor.js`: Save category on menu create/update
- `routes/admin.js`: Save category on menu create/update
- `views/partials/menu-table.ejs`: Removed "Unknown" filter button

---

## Sprint 2: High Bugs ✅

**Goal**: Fix validation gaps and inconsistency.

| Bug | Status |
|-----|--------|
| H-1: Past pickup time validation | ✅ Fixed |
| H-2: Optional chaining on req.flash | ✅ Fixed |

### Files Modified
- `utils/time.js`: Added `validatePickupTime()` with 5-min tolerance
- `routes/orders.js`: Added validation in all 4 payment flows; fixed req.flash chaining

---

## Sprint 3: Medium Bugs ✅

**Goal**: UX improvements, logging cleanup, code hardening.

| Bug | Status |
|-----|--------|
| M-1: Double-click payment prevention | ✅ Fixed |
| M-2: Broken image placeholder | ✅ Already handled (placeholder exists) |
| M-3: Debug console.log removal | ✅ Fixed |
| M-4: Missing return before res.render() | ✅ Fixed |

### Files Modified
- `views/cart/index.ejs`: Added disabled state + "Processing..." on payment buttons
- `config/phonepe.js`: Removed debug logging
- `routes/auth.js, shops.js, cart.js, vendor.js, orders.js, admin.js`: Added `return` before all `res.render()` calls

---

---

## Pilot Sprint: Vendor Workflow Optimization ✅

**Goal**: Improve vendor dashboard usability during peak hours.

| Objective | Status |
|-----------|--------|
| 1 — Vendor login redirect to pending orders | ✅ Fixed |
| 2 — Remove canteens panel (nav link) | ✅ Fixed |
| 3 — Category filter on menu | ✅ Fixed |
| 4 — Parcel charges per shop & order | ✅ Fixed |
| 5 — Pickup time visibility (color-coded banner) | ✅ Fixed |

### Files Modified
- `routes/auth.js`: Redirect vendors to `/vendor/orders/pending` after login
- `views/partials/vendor-nav.ejs`: Removed "View menu" link
- `views/partials/menu-table.ejs`: Added category filter buttons
- `public/js/menu-table.js`: Added category filter logic
- `models/Shop.js`: Added `parcelCharge` field (Number, default 0)
- `models/Order.js`: Added `parcelCharge` field (Number, default 0)
- `routes/orders.js`: Updated `buildOrderItemsFromCart` + all 4 payment flows for parcel charge
- `routes/vendor.js`: Added parcel charge to JSON endpoint payload, payment settings handler
- `views/vendor/payment-settings.ejs`: Added parcel charge input
- `views/vendor/pending-orders.ejs`: Added parcel charge display + pickup time banner
- `views/orders/show.ejs`: Added parcel charge display
- `views/cart/index.ejs`: Disabled payment buttons on click

---

## Sprint 4: Low Bugs (Not Started)

**Goal**: Polish and hardening.

| Bug | Status |
|-----|--------|
| L-1: Confirm dialog on cancel | ✅ Already handled |
| L-2: Empty state on completed orders | ✅ Already handled |
| L-3: Static asset caching | ⏳ Not started |
| L-4: CSRF protection assessment | ⏳ Not started |
