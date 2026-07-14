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

## Sprint 4: Low Bugs (Not Started)

**Goal**: Polish and hardening.

| Bug | Status |
|-----|--------|
| L-1: Confirm dialog on cancel | ✅ Already handled |
| L-2: Empty state on completed orders | ✅ Already handled |
| L-3: Static asset caching | ⏳ Not started |
| L-4: CSRF protection assessment | ⏳ Not started |
