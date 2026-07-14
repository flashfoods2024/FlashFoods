# Technical Debt Register

## Code Quality

### 1. Large Route Files
| File | Lines | Issue |
|------|-------|-------|
| routes/admin.js | 1836 | Violates single responsibility; handles shops, vendors, students, orders, menus, analytics, menu import |
| routes/vendor.js | 1019 | Mixes menu CRUD, order management, payment settings, OTP verification |
| routes/orders.js | 772 | Handles 3 payment gateways + mock checkout + order listing + status API |

**Suggested refactor:** Split admin.js into multiple route files (admin-shops.js, admin-vendors.js, admin-orders.js, admin-analytics.js). Similarly refactor vendor.js and orders.js.

### 2. Duplicate Payment Gateway Logic
- **Files:** routes/orders.js, routes/vendor.js
- **Issue:** Payment initiation logic is duplicated across routes (shop validation, variant validation, cart validation). Refund logic is duplicated across full cancel and partial adjustment.
- **Impact:** Changes to payment flow must be made in multiple places.

### 3. Duplicate Menu CRUD Logic
- **Files:** routes/vendor.js, routes/admin.js
- **Issue:** Vendor menu CRUD and admin menu CRUD have nearly identical implementations (create, update, delete, toggle)
- **Impact:** Bug fixes must be applied to both files

### 4. Inline Variant Resolution Pattern
- **Files:** routes/cart.js, routes/orders.js, routes/vendor.js
- **Issue:** The pattern for resolving variant price from a line item is repeated inline:
  ```js
  var variantId = line.variantId != null ? Number(line.variantId) : null;
  var variantName = null;
  var variantPrice = null;
  var price = m.price;
  if (variantId != null && variants[variantId]) {
    variantName = variants[variantId].label;
    variantPrice = variants[variantId].price;
    price = variantPrice;
  }
  ```
- **Impact:** Inconsistent behavior if one instance is modified

### 5. Inconsistent Error Handling
- **Files:** All routes
- **Issue:** Some routes use try/catch, some don't. Some return JSON error, some redirect with flash. Inconsistent HTTP status codes.
- **Impact:** Makes API consumption unpredictable

### 6. Magic Numbers
- **Files:** Various
- **Issue:** Numeric literals without named constants:
  - 15 * 60 * 1000 (session expiry, token expiry)
  - 300 (rate limit max)
  - 5 * 1024 * 1024 (upload max size)
  - 10 (bcrypt salt rounds)
  - 6 (OTP length)
  - 99 (max quantity)
  - 20 (pickup urgency minutes)

### 7. `var` Keyword Usage
- **Files:** routes/cart.js, routes/orders.js
- **Issue:** Uses `var` instead of `const`/`let` in many places (likely legacy code)
- **Impact:** Inconsistent with modern JS practices

### 8. Mixed Response Types
- **Files:** Various
- **Issue:** Same route sometimes returns JSON, sometimes HTML redirect (e.g., upload middleware checks `req.accepts`)
- **Impact:** Confusing for API consumers

## Architecture

### 9. No Service Layer
- **Issue:** Business logic is mixed with route handlers
- **Impact:** Routes are hard to test in isolation; logic cannot be reused across routes

### 10. No Repository/Data Access Layer
- **Issue:** Direct Mongoose calls in route handlers
- **Impact:** Database queries scattered across codebase; changing DB requires changing all routes

### 11. Circular Dependency Risk (Mitigated)
- **File:** routes/admin.js imports from routes/vendor.js
- **Issue:** `isGatewayConfigured` is exported from vendor.js and used in admin.js
- **Impact:** If vendor.js ever imports from admin.js, circular dependency occurs

## Testing

### 12. Insufficient Test Coverage
- **Issue:** Only one E2E test exists for the entire application
- **Impact:** No safety net for refactoring

### 13. No Unit Tests
- **Issue:** All tests are E2E (Playwright)
- **Impact:** Slow feedback loop; cannot test business logic in isolation

## Performance

### 14. No Database Query Optimization
- **Issue:** Some queries lack proper indexes or use inefficient patterns
- **Impact:** May degrade with scale

### 15. N+1 Query Potential
- **File:** routes/admin.js (loadAdminOrderList uses populate which can cause N+1)
- **Issue:** Deep population chains may cause multiple queries

## Security

### 16. Missing CSRF Protection
- **Issue:** No CSRF tokens on form submissions
- **Impact:** CSRF attack vector

### 17. `sameSite` Cookie Commented Out
- **File:** server.js (line 104)
- **Issue:** `sameSite: "lax"` is commented out
- **Impact:** CSRF protection weakened

### 18. Debug Logging Sensitive Data
- **File:** config/phonepe.js (refundPayment logs full request payload with transaction IDs)
- **Impact:** Sensitive transaction data in logs

## Maintainability

### 19. No TypeScript
- **Issue:** Pure JavaScript with no type checking
- **Impact:** Runtime errors that could be caught at compile time

### 20. Inconsistent Import Order
- **Files:** Various
- **Issue:** Imports are not consistently ordered (stdlib, npm, local)
- **Impact:** Reduced readability

### 21. No Linting Configuration
- **Issue:** No ESLint or Prettier config
- **Impact:** Inconsistent code style

### 22. .bak Files in Repository
- **Files:** package.json.bak, package-lock.json.bak
- **Issue:** Backup files committed to git
- **Impact:** Clutters repository

### 23. Cookie File in Repository
- **File:** `-b` (Netscape cookie file)
- **Issue:** Cookie file accidentally committed
- **Impact:** Potential security risk; should be removed

### 24. No Package.json Scripts for Common Tasks
- **Issue:** No lint, test, typecheck scripts
- **Impact:** Harder to maintain code quality
