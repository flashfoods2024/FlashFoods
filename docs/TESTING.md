# Testing Guide

## Test Framework

- **Framework:** Playwright
- **Config:** `playwright.config.js`
- **Test Directory:** `./tests`
- **Browsers:** Chromium, Firefox, WebKit (Desktop)
- **CI:** GitHub Actions (`./.github/workflows/playwright.yml`)

## Running Tests

```bash
# Run all tests (headed, non-CI)
npx playwright test

# Run specific test file
npx playwright test tests/login.spec.js

# Run in UI mode
npx playwright test --ui

# Run with specific browser
npx playwright test --project=chromium

# Run tests in CI mode (headless)
npx playwright test --headed=false
```

## Current Test Coverage

| Test | File | Status | Coverage |
|------|------|--------|----------|
| Student login | tests/login.spec.js | ✅ | Happy path only |

## Test Structure

### E2E Test Pattern
```js
// tests/example.spec.js
import { test, expect } from '@playwright/test';

test('description', async ({ page }) => {
  await page.goto('/path');
  await page.fill('selector', 'value');
  await page.click('button');
  await expect(page.locator('.flash-success')).toBeVisible();
});
```

## Test Data

### Seed Data (`seed.js`)
- Vendor: `vendor@college.com` / `vendor123`
- Student: `student@college.test` / `student123`
- Admin: `admin@college.com` / `admin123`
- Shop: "Main Canteen"
- Menu Items: 4 items (with variants)

### Test Prerequisites
1. MongoDB must be running
2. Environment variables must be configured (`.env`)
3. Seed data should be loaded: `npm run seed`

## Manual Testing Checklist

### Auth
- [ ] Signup with valid data creates user
- [ ] Signup with duplicate email shows error
- [ ] Login with valid credentials creates session
- [ ] Login with disabled account shows error
- [ ] Login with wrong password shows error
- [ ] Forgot password sends email (check Resend dashboard)
- [ ] Password reset with valid token works
- [ ] Password reset with expired token shows error
- [ ] Logout destroys session

### Shops
- [ ] Shop listing shows active shops only
- [ ] Shop detail page shows menu items
- [ ] Disabled shops are hidden from listing
- [ ] Visiting disabled shop slug redirects

### Cart
- [ ] Add item to cart (single variant)
- [ ] Add item with multi-variant selection
- [ ] Cross-shop cart protection
- [ ] Update quantity
- [ ] Remove item (set quantity to 0)
- [ ] Clear cart
- [ ] Empty cart checkout blocked

### Orders
- [ ] Razorpay order creation
- [ ] Razorpay payment verification
- [ ] Easebuzz payment flow
- [ ] PhonePe payment flow
- [ ] Mock checkout
- [ ] Order history shows user's orders only
- [ ] Order detail shows correct items/status

### Vendor
- [ ] Menu CRUD (create, read, update, delete)
- [ ] Toggle item availability
- [ ] Toggle shop open/closed
- [ ] Pending orders list
- [ ] Accept order
- [ ] Mark order ready
- [ ] Cancel order (mock and real)
- [ ] OTP verification
- [ ] Order adjustment
- [ ] Completed orders list
- [ ] Payment settings update

### Admin
- [ ] Dashboard shows correct stats
- [ ] Shop CRUD (create, read, update, delete)
- [ ] Shop payment settings
- [ ] Vendor CRUD
- [ ] Student management
- [ ] Order listing with filters
- [ ] Menu management per vendor
- [ ] Menu import (AI)
- [ ] Analytics page

### Webhooks
- [ ] Razorpay payment.captured event
- [ ] Razorpay payment.failed event
- [ ] Idempotent event handling
- [ ] Invalid signature rejection

### Socket.IO
- [ ] Vendor receives pending count on connect
- [ ] Pending count updates on new order
- [ ] Pending count updates on accept/cancel
- [ ] Audio notification plays on pending > 0
- [ ] Tab title updates with count

## Writing New Tests

1. Create test file in `tests/` directory
2. Use `page.goto()` with relative URLs (base URL from config)
3. Use seed data for consistent test state
4. Test edge cases (empty, invalid, unauthorized)
5. Avoid flaky assertions (use `toBeVisible`, `toHaveText`, etc.)
6. Group related tests with `test.describe()`

## Test Configuration

```js
// playwright.config.js key settings
{
  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on',
    headless: false,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
}
```
