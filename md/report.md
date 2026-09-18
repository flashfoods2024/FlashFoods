# FlashFoods QA Report (Post Test Fix)

**Date:** 2026-08-06
**Scope:** Fix the 56 failing automated Playwright tests from the previous QA pass; re-verify the suite and the application.

---

## Summary

| Metric | Value |
|---|---|
| Previous total tests | 118 |
| Previous failures | 56 |
| Tests fixed | 56 / 56 |
| Remaining failures | 0 |
| Newly introduced failures | 0 |

**Application code changes: 0.** Only test files, test infrastructure, and the Playwright config were changed. The 56 failures were all test-side artifacts (stale selectors/assertions/timing), not application defects — confirmed by manual verification during the earlier QA pass.

---

## Fixes Applied

### Priority 1 — Login selector collisions (46 failures)

The login/signup forms contain a "Show password" toggle button with `aria-label="Show password"`. `getByLabel('Password')` matches the toggle button (substring) plus the password input → strict-mode violation. Replaced with the stable attribute selector `input[name="password"]`.

| File | Reason | Before | After |
|---|---|---|---|
| `tests/login.spec.js` (×3) | Strict-mode collision | `page.getByLabel('Password').fill(...)` | `page.locator('input[name="password"]').fill(...)` |
| `tests/permissions.spec.js` (×3) | Strict-mode collision | `getByLabel('Password').fill(...)` | `locator('input[name="password"]').fill(...)` |
| `tests/student-workflow.spec.js` | Strict-mode collision | `getByLabel('Password').fill('vendor@1')` | `locator('input[name="password"]').fill('vendor@1')` |
| `tests/vendor-workflow.spec.js` | Strict-mode collision | `getByLabel('Password').fill('vendor@1')` | `locator('input[name="password"]').fill('Test@123')` |

Note: `getByLabel('Name')` / `getByLabel('Price')` on the vendor menu page also collide — each menu row's edit form has label-wrapped `data-edit-name` inputs (79 matches). The create-item test now scopes to the create form: `form[action="/vendor/menu"] input[name="name"]` (edit-row inputs have no `name` attribute, so this is unambiguous). `getByLabel('Email')` was left unchanged (no collision).

### Priority 2 — Stale UI assertions (8 failures)

| File | Reason | Before | After |
|---|---|---|---|
| `tests/smoke.spec.js` home | App title is `"Flash Foods"` | `toHaveTitle(/FlashFoods\|Smart College/)` | `toHaveTitle(/Flash Foods/)` |
| `tests/smoke.spec.js` signup | Heading is `h2`, text "Create account" | `h1` containing `/sign.?up/i` | `h2` containing `/create account/i` |
| `tests/smoke.spec.js` login | Heading is `h2`, text "Log in" | `h1` containing `/login/i` | `h2` containing `/log in/i` |
| `tests/smoke.spec.js` forgot-password | Heading is `h2` | `h1` containing `/forgot/i` | `h2` containing `/forgot/i` |
| `tests/smoke.spec.js` shop detail | Main Canteen is disabled in production; page redirects | `/shops/main-canteen` + generic `h1` | `/shops/hummusery` + `h1` containing `/hummusery/i` |

### Priority 3 — Service Worker timing flake (2 failures)

| File | Reason | Before | After |
|---|---|---|---|
| `tests/mobile/pwa-installability.spec.js` | `navigator.serviceWorker.controller` is null on the first load (SW only controls from the second load) | fixed 2s wait, then immediate check | `await page.evaluate(() => navigator.serviceWorker.ready)` → `page.reload()` → `expect.poll(...).toBe(true)` |

### Production-state drift (uncovered after fixing the login selector)

Once logins worked, three previously-masked failures surfaced: **Main Canteen is disabled in production** (`isActive: false`), so student menu/cart/order flows against it cannot work, and `vendor@college.com` (linked to Main Canteen) cannot toggle the shop or create menu items (routes hard-block disabled shops).

| File | Reason | Before | After |
|---|---|---|---|
| `tests/student-workflow.spec.js` | Main Canteen disabled | `/shops/main-canteen`, `.menu-item`, `button:has-text("Add")`, `goto('/orders/checkout')` (GET on POST-only route) | Uses active shop `hummusery`; `.import-table tbody tr`; `form[action="/cart/add"]`; mock order via real `POST /orders/checkout` with `orderType` + `pickupTime`, then follows the redirect to `/orders/:id` |
| `tests/vendor-workflow.spec.js` | vendor@college.com's shop is disabled | vendor@college.com + `getByLabel('Name'/'Price')` + `.flash-success` | Uses `test.vendor@flashfoods.test` against `juice-corner`, enabled/restored by global hooks; scoped `input[name=...]` selectors; `.flash--success`; created item deleted after the test (dialog accepted) |
| `tests/login.spec.js` (1 line) | Flash class is `flash--error`, not `flash-error` | `.flash-error` | `.flash--error` |
| `tests/student-workflow.spec.js` (×2) | Flash class drift | `.flash-success` | `.flash--success` |

### Test infrastructure

| File | Change |
|---|---|
| `tests/global-setup.mjs` (new) | Before the run: captures juice-corner's original state to `temp/.qa-shop-state.json`, links `test.vendor@flashfoods.test` to juice-corner, enables it (`isActive=true`, `isOpen=true`) |
| `tests/global-teardown.mjs` (new) | After the run: restores the exact original shop state (vendor, isActive, isOpen, user.shop link); falls back to the canonical original if the state file is missing (interrupted run) |
| `playwright.config.js` | Registered `globalSetup` / `globalTeardown` hooks |

The global hooks run once per invocation (not per worker), which avoids the race that an in-spec `beforeAll`/`afterAll` fixture would have had under `fullyParallel`.

---

## Test Results

**Full suite (chromium + Mobile Chrome, 2 projects):**

| Metric | Count |
|---|---|
| Total tests | 118 |
| Passed | 118 |
| Failed | 0 |
| Skipped | 0 |

Previously failing subset re-run: 76/76 passed before the full-suite run.

---

## Newly Introduced Failures

None.

---

## Functional Validation

| Area | Verification | Result |
|---|---|---|
| Auth — student login | `tests/login.spec.js`, curl session check | PASS |
| Auth — vendor login | `tests/permissions.spec.js`, vendor-workflow (redirects to `/vendor/orders/pending`) | PASS |
| Auth — admin login | `tests/permissions.spec.js` | PASS |
| Auth — invalid credentials | shows `flash--error` | PASS |
| Signup | creates account, redirects to `/` | PASS |
| Logout | POST `/logout` → 302 `/`, session destroyed (subsequent `/orders` → 302 `/login`) | PASS |
| Password visibility toggle | `aria-label="Show password"` toggle still rendered; login flows unaffected | PASS |
| Student | browse shops, view menu (hummusery), add to cart, view cart, mock order (real POST → `status: paid`, ₹139 in DB), order history | PASS |
| Vendor | pending/completed orders, shop open/close toggle, menu CRUD (create + delete), payment settings, verify page | PASS |
| Admin | all admin pages + analytics endpoint (from prior QA pass) | PASS |
| Analytics | unchanged app code; prior QA validated before/after deltas match DB exactly | PASS |
| Order lifecycle | intake verified (mock order persisted `paid`); full paid→accepted→ready→verified→completed lifecycle validated in prior QA pass | PASS |
| Notifications | FCM registration emits an expected console error when notification permission is blocked in the test browser (test passes; pre-existing, test-environment only) | PASS |
| Service Worker | registered, `activated`, controls the page (deterministic check) | PASS |
| PWA | manifest loads/parses (name "Flash Foods", standalone), no installability errors, manifest link, icons 200 | PASS |

---

## Performance

- No application code changed; no performance impact from this work.
- Test suite runtime: ~1.2 min for the full 118-test run (both projects).

## Security

- No application code changed; no security impact.
- Test credentials used (`test.vendor@flashfoods.test` / `Test@123`) are QA fixtures, not production secrets.
- The global hooks modify only the QA shop (`juice-corner`) and restore it exactly afterward — verified post-run (`isActive=false`, `isOpen=false`, original vendor, `user.shop=null`).

---

## Remaining Issues

1. **firefox / webkit projects** are configured in `playwright.config.js` but their browsers are not installed on this machine — running those projects would fail with a launch error. Not a product issue.
2. **Vendor workflow depends on the QA fixture**: `tests/vendor-workflow.spec.js` requires `test.vendor@flashfoods.test` and temporarily enables `juice-corner` via the global hooks. If a vendor with known credentials for an active shop is ever created, the fixture can be removed.
3. **Interrupted runs** may leave `juice-corner` enabled; the teardown's fallback restores it on the next invocation, or manually via the documented original state (vendor `69f94f3740d1612eddf0d00c`, closed/disabled, `user.shop=null`).
4. FCM notification permission console error during tests (test-environment artifact, test passes).

---

## Final Recommendation

🟢 **Ready for Production**

All 56 previously failing tests are fixed with zero application code changes; the full suite is green (118/118), and manual verification confirms auth, logout, PWA/SW, vendor, student, admin, and order flows behave correctly.
