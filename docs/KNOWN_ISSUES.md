# Known Issues

## High Priority

### 1. MemoryStore Session Storage
- **File:** server.js (implicit, no explicit import)
- **Issue:** Express-session uses default MemoryStore which leaks memory and doesn't scale across multiple instances
- **Impact:** Production risk — session data lost on server restart
- **Fix:** Migrate to connect-mongo or Redis session store

### 2. Easebuzz Refunds Not Implemented
- **Files:** routes/vendor.js (refund routes)
- **Issue:** When cancelling or adjusting an Easebuzz order, the refund status is set to "pending" and requires manual processing
- **Impact:** Vendor cannot automatically refund Easebuzz orders
- **Fix:** Implement Easebuzz refund API integration

### 3. No Auth Route Rate Limiting
- **Files:** routes/auth.js
- **Issue:** Rate limiting is global (300 req/15min) but not specifically applied to auth routes
- **Impact:** Brute force attack risk on login/signup endpoints
- **Fix:** Add dedicated rate limiter for auth routes (e.g., 10 attempts/15min)

## Medium Priority

### 4. Paytm and BharatPe Payment Gateways Not Implemented
- **File:** models/Shop.js (schema includes these options)
- **Issue:** Listed as options but no payment flow implemented
- **Impact:** Selection causes errors at checkout
- **Fix:** Either implement or remove from schema

### 5. No Audit Logging
- **Files:** routes/admin.js, routes/vendor.js
- **Issue:** No record of who performed what action
- **Impact:** Cannot trace admin/vendor actions for dispute resolution
- **Fix:** Add audit log model and middleware

### 6. Password Reset Doesn't Invalidate Sessions
- **File:** routes/auth.js (line 158-164 has a comment about this)
- **Issue:** After password reset, existing sessions remain valid
- **Impact:** If account is compromised, password reset should invalidate all sessions
- **Fix:** Implement session invalidation (requires session store migration first)

### 7. Single E2E Test
- **File:** tests/login.spec.js
- **Issue:** Only one test exists covering the happy path of student login
- **Impact:** Low confidence in regression detection
- **Fix:** Add comprehensive test suite

### 8. No Health Check Endpoint
- **Issue:** No GET /health or similar endpoint for monitoring/load balancers
- **Impact:** Cannot monitor server health in production
- **Fix:** Add health check route

### 9. Cart Not Persisted Across Sessions
- **Files:** routes/cart.js
- **Issue:** Cart is stored in session only; server restart or session expiry loses carts
- **Impact:** Users lose cart contents unexpectedly
- **Fix:** Persist cart in database or use a more durable session store

### 10. Inconsistent Error Response Formats
- **Files:** All route files
- **Issue:** Some routes return JSON, some redirect with flash, some return HTML
- **Impact:** API consumers need to handle multiple response types
- **Fix:** Standardize error response format

## Low Priority

### 11. No Notification Preferences
- **Issue:** No way for users to opt in/out of email notifications
- **Impact:** Only password reset emails sent; no order status emails
- **Fix:** Add notification preferences model and email templates

### 12. Socket.IO Authentication
- **File:** socket/index.js
- **Issue:** No authentication on WebSocket connections
- **Impact:** Any client could potentially join any shop room
- **Fix:** Add Socket.IO middleware for session validation

### 13. Debug Console Logs in Production
- **Files:** Various (config/phonepe.js, routes/vendor.js, routes/admin.js, routes/orders.js)
- **Issue:** Extensive `console.log` statements for debugging
- **Impact:** Information leakage, performance overhead
- **Fix:** Remove or replace with structured logging

### 14. No Input Sanitization in EJS Templates
- **Files:** views/*.ejs
- **Issue:** EJS renders user input without explicit sanitization in some places
- **Impact:** Potential XSS vulnerability if user input contains HTML/JS
- **Fix:** Use EJS's built-in escaping or add explicit sanitization

### 15. Hardcoded Payment Gateway Envs
- **File:** config/easebuzz.js (line 33), config/phonepe.js (line 39)
- **Issue:** Environment defaults hardcoded to test/UAT
- **Impact:** Could accidentally be configured as test in production
- **Fix:** Make prod the default and require explicit test configuration

### 16. No Email Verification on Signup
- **File:** routes/auth.js
- **Issue:** Users can signup with any email without verification
- **Impact:** Fake accounts can be created
- **Fix:** Add email verification step during signup

### 17. Orphaned Menu Items on Shop Delete
- **File:** routes/admin.js (line 614)
- **Issue:** Menu items are deleted when shop is deleted, but orders referencing those items retain stale data
- **Impact:** Order history shows item IDs that no longer exist in database (items are embedded, so this is partially mitigated)
- **Fix:** Consider soft-delete for shops and menu items
