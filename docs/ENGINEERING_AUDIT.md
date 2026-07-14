# Engineering Audit Report

**Date:** 2026-07-15
**Scope:** Full repository audit

---

## 1. Dead/Unnecessary Files

| File | Reason | Action |
|------|--------|--------|
| `-b` | Netscape cookie file accidentally committed | Remove |
| `package.json.bak` | Backup file committed to repo | Remove |
| `package-lock.json.bak` | Backup file committed to repo | Remove |
| `test.txt` | Binary/unreadable file | Investigate and remove |
| `public/background-image copy.png` | Duplicate of background-image.png | Remove |
| `public/images/canteen-bg.png` | Unused in any template | Check usage |
| `icon.png` (root) | Duplicate of public/icon.png | Remove |
| `1001fonts-transcity-eula.txt` | Font license file, could be moved | Consider moving to docs/ |

## 2. Duplicate Logic

### 2.1 Variant Price Resolution (4 occurrences)
**Files:** `routes/cart.js`, `routes/orders.js` (×2), `routes/vendor.js` (×0 but similar)
The same pattern for resolving variant price from a line item is repeated.

### 2.2 Menu CRUD (2 occurrences)
**Files:** `routes/vendor.js` (lines 197-328), `routes/admin.js` (lines 1223-1349)
Nearly identical create/update/delete/toggle logic for menu items.

### 2.3 Payment Gateway Validation (3 occurrences)
**Files:** `routes/orders.js` (lines 136-151, 302-317, 457-475)
Shop closed check, variant validation, and buildOrderItemsFromCart are repeated for each gateway flow.

### 2.4 Refund Logic (2 occurrences)
**Files:** `routes/vendor.js` (lines 484-588 for full cancel, 707-826 for partial adjust)
Refund processing duplicated with minor differences (full vs partial amount).

### 2.5 isGatewayConfigured (2 occurrences)
**Files:** `routes/vendor.js` (line 25), `routes/admin.js` (imports from vendor.js)
Exported from vendor.js and reused in admin.js (correct reuse pattern).

## 3. Large Files

| File | Lines | Issue |
|------|-------|-------|
| `routes/admin.js` | 1836 | Single file handles 7+ domains |
| `routes/vendor.js` | 1019 | Menu + orders + payment settings |
| `routes/orders.js` | 772 | 3 payment gateways + order management |

## 4. Unused Middleware

- `middleware/requireDb.js` is used in many routes — not unused
- No unused middleware detected

## 5. Unused Routes

- All routes are actively mounted in `server.js`
- Paytm and BharatPe payment configurations exist in the schema but have no routes

## 6. Unused Models

- All 4 models (User, Shop, MenuItem, Order) are actively used

## 7. Unused CSS/JS/Images

- `public/images/canteen-bg.png` — check if referenced in any EJS template
- `public/background-image copy.png` — duplicate file

## 8. Architecture Violations

### 8.1 Cross-Route Import
`routes/admin.js` imports `isGatewayConfigured` from `routes/vendor.js`. This creates a coupling between route modules. Better to extract shared logic into a utility module.

### 8.2 Business Logic in Routes
Route files contain business logic (refund calculations, variant resolution, payment initiation) that should be in a service layer.

### 8.3 Direct Model Access
All routes access Mongoose models directly. No repository/data access layer.

## 9. Potential Scalability Issues

1. **MemoryStore sessions** — Not scalable across multiple server instances
2. **In-memory import sessions** — Menu-import sessions stored in `Map` (lost on restart)
3. **No pagination** on some admin list views
4. **Synchronous file operations** in `vision.js` (`readFileSync`)
5. **No database read replicas** configured

## 10. Potential Performance Issues

1. **N+1 query potential** in `loadAdminOrderList()` with deep population
2. **Missing indexes** — No index on `email` field in User schema (Mongoose adds one for `unique`)
3. **Full collection scans** on some aggregation pipelines

## 11. Potential Security Issues

1. **No CSRF protection** — `sameSite` cookie commented out
2. **No auth rate limiting** — Global rate limit (300/15min) insufficient for brute force
3. **Debug logging** in `config/phonepe.js` logs refund request payloads
4. **No input sanitization** in some EJS template renderings
5. **Socket.IO** has no authentication middleware
6. **Cookie file (-b)** committed to repository (potential credential leak)
7. **Session secret** defaults to "dev-secret" in code if not configured

## 12. Functions Exceeding Reasonable Complexity

1. `routes/orders.js: POST /phonepe/callback` (85 lines) — Handles auth + status check + state machine
2. `routes/admin.js: POST /vendors/:vendorId/menu/import` (130+ lines) — Multi-step pipeline
3. `routes/vendor.js: POST /vendor/orders/:id/cancel` (100+ lines) — Refund logic
4. `routes/admin.js: GET /analytics` (185 lines) — 9 separate aggregation pipelines
