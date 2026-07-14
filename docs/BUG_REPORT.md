# Bug Report

## Critical (Fixed)

### C-1: Missing `return` before `res.json()` in try/catch blocks — double-header risk on throw

- **Root Cause**: `routes/orders.js:192` and `routes/vendor.js:404`, `res.json()` called without `return`. If response stream throws after headers commit, catch block calls `res.status(500).json()` on closed response.
- **Fix**: Added `return` before `res.json()` and `res.status().json()` in both try/catch blocks.
- **Files**: `routes/orders.js`, `routes/vendor.js`
- **Status**: ✅ Fixed

## High (Fixed)

### H-1: Past pickup time accepted (no date validation)

- **Root Cause**: `routes/orders.js` — No validation that pickupTime is in the future.
- **Fix**: Added `validatePickupTime()` in `utils/time.js`. Rejects pickup times > 5 min in the past. Applied to all 4 payment flows (Razorpay, Easebuzz, PhonePe, Mock).
- **Files**: `utils/time.js`, `routes/orders.js`
- **Status**: ✅ Fixed

### H-2: Optional chaining on `req.flash?.()` in Easebuzz callback may silently swallow errors

- **Root Cause**: `routes/orders.js:419` — `req.flash?.()` uses optional chaining inconsistently.
- **Fix**: Changed to `req.flash()` consistent with all other routes.
- **Files**: `routes/orders.js`
- **Status**: ✅ Fixed

## Medium (Fixed)

### M-1: No disabled/loading state on payment buttons

- **Root Cause**: Cart page JS didn't disable buttons during payment processing.
- **Fix**: Added `btn.disabled = true` and "Processing..." text on click for all 3 gateway buttons (Razorpay, Easebuzz, PhonePe). Re-enabled on error. Razorpay modal flow handled with try/catch.
- **Files**: `views/cart/index.ejs`
- **Status**: ✅ Fixed

### M-2: Broken image URLs shown without fallback

- **Root Cause**: Always had fallback via `item.image || '/food-placeholder.svg'` — placeholder file exists.
- **Status**: ✅ Already handled (no fix needed)

### M-3: Debug `console.log` in PhonePe refund code leaks sensitive data

- **Root Cause**: `config/phonepe.js` logged full refund request payloads including transaction IDs.
- **Fix**: Removed all debug logging (`PHONEPE REFUND REQUEST`, `PHONEPE REFUND ERROR RESPONSE`, `PHONEPE REFUND SUCCESS RESPONSE`).
- **Files**: `config/phonepe.js`
- **Status**: ✅ Fixed

### M-4: All `res.render()` calls lack `return`

- **Root Cause**: 35+ `res.render()` calls across route files called without `return`.
- **Fix**: Added `return` before every `res.render()` call in `routes/auth.js`, `routes/shops.js`, `routes/cart.js`, `routes/vendor.js`, `routes/orders.js`, `routes/admin.js`.
- **Files**: All route files
- **Status**: ✅ Fixed

## Low (Not Fixed — Already Handled)

### L-1: Cancel confirmation dialog
- **Status**: ✅ Already present in `views/vendor/pending-orders.ejs:60` via `onsubmit="return confirm(...)"`

### L-2: Empty state on completed orders
- **Status**: ✅ Already present in `views/vendor/completed-orders.ejs:9-12`

### L-3: No static asset caching
- **Status**: ⏳ Not yet implemented — low priority

### L-4: No CSRF protection
- **Status**: ⏳ Not yet implemented — requires careful consideration
