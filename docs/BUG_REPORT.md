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

## Critical (Fixed — Sprint 1 Verification)

### C-2: "Mark Unavailable" returns "Request failed" — ReferenceError on toggle

- **Root Cause**: `routes/menu.js:16` calls `Shop.findById(req.vendorShopId)` but `Shop` was never imported. The file only imported `MenuItem`. This caused a `ReferenceError: Shop is not defined` every time the toggle endpoint was hit.
- **Fix**: Added `import { Shop } from "../models/Shop.js"` to `routes/menu.js`.
- **Files**: `routes/menu.js`
- **Regression Risk**: Low — only adds a missing import. No logic changes.
- **Status**: ✅ Fixed

### C-3: Background image regression — homepage hero references deleted file

- **Root Cause**: `public/styles.css:263` referenced `url("/background-image copy.png")` which was deleted in commit `786ec45` ("ai readiness added"). The file `public/background-image.png` still exists and is the correct file.
- **Fix**: Changed CSS reference from `background-image copy.png` to `background-image.png`.
- **Files**: `public/styles.css`
- **Regression Risk**: None — only fixes a broken image URL.
- **Status**: ✅ Fixed

## High (Fixed — Sprint 1 Verification)

### H-3: Vendor navigation shows "Canteens" link

- **Root Cause**: `views/partials/header.ejs:43` rendered the "Canteens" link unconditionally for all users, including vendors who should not see it.
- **Fix**: Wrapped the "Canteens" link in `<% if (!currentUser || currentUser.role !== "vendor") { %>` so it's hidden for vendors.
- **Files**: `views/partials/header.ejs`
- **Regression Risk**: Low — only affects vendor role. Admin and student still see the link.
- **Status**: ✅ Fixed

### H-4: Category not persisted on import confirm — data lost between preview and database

- **Root Cause**: Two-part issue:
  1. `models/MenuItem.js` had no `category` field in the schema (fixed earlier).
  2. `routes/admin.js:1596-1632` — The import confirmation route (`POST /vendors/:vendorId/menu/import/confirm`) reads `item.name`, `item.description`, `item.foodType`, and `item.variants` from the submitted form data but **never reads `item.category`**. The `docs` array pushed to `MenuItem.insertMany()` omits `category`, so even though the AI extraction correctly identifies categories and the preview form includes `<input name="items[i][category]">`, the value is silently dropped during insert.

- **Fix (part 1)**: Added `category` field (String, default "", trim) to `MenuItem` schema. Added `category` to vendor and admin menu create/update endpoints. Removed "Unknown" button from food type filter in `menu-table.ejs`.

- **Fix (part 2)**: Added `const category = String(item.category || "").trim()` at line 1598 and added `category` to the `docs.push({})` object at line 1628 in `routes/admin.js`.

- **Files**: `models/MenuItem.js`, `routes/vendor.js`, `routes/admin.js`, `views/partials/menu-table.ejs`

- **Verification (all MenuItem write paths)**:
  | Path | `category` saved? |
  |------|:-:|
  | AI Import Confirm (`admin.js:1642`) | ✅ Fixed |
  | Admin Create Item (`admin.js:1250`) | ✅ |
  | Admin Edit Item (`admin.js:1310`) | ✅ |
  | Vendor Create Item (`vendor.js:225`) | ✅ |
  | Vendor Edit Item (`vendor.js:286`) | ✅ |
  | Seed Script (`seed.js:62`) | ⏹️ Optional — dev-only, uses schema default |
  | Toggle Available (`menu.js:33`) | ✅ No category change needed |

- **Regression Risk**: Low — new field is optional with empty default. Existing items retain empty string.
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
