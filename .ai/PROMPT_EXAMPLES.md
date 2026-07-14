# Prompt Examples

## Example 1: Adding a New Route

```
I need to add a GET /api/health endpoint that returns server status.

Context:
- Read .ai/STATUS.md, ARCHITECTURE.md, BUSINESS_RULES.md, DEPENDENCY_GRAPH.md, COMMON_PATTERNS.md
- Follow the route handler pattern in routes/
- This should be a simple JSON response, no auth required

Implementation:
- Add to routes/ or create new file
- Mount in server.js
- Test with curl
```

## Example 2: Bugfix

```
Bug: Adding an item to cart from a second shop results in a confusing error message.

Expected: Clear the cart and show a prompt, or allow adding from the new shop.

Context:
- Read cart.js route handler
- The cross-shop merge logic is in routes/cart.js POST /cart/add
- Business rule: cart can contain items from only one shop

Fix: Update the error message or implement auto-clear with confirmation.
```

## Example 3: New Business Rule

```
New rule: Vendors should receive an email notification when a new order is placed.

Context:
- Email utility exists at utils/email.js (currently only used for password reset)
- Orders are created in routes/orders.js
- Socket.IO already notifies vendors of pending counts

Implementation:
- Add a new function to utils/email.js for order notification
- Call it from the order creation/verification flows
- Keep email sending non-blocking (fire and forget)
```

## Example 4: Refactor

```
Refactor: Extract variant price calculation into a shared utility.

Context:
- The same variant resolution pattern appears in cart.js, orders.js, vendor.js
- See COMMON_PATTERNS.md for the current inline pattern

Implementation:
- Create utils/variant.js with a resolveVariantPrice function
- Update all callers to use the shared utility
- Maintain exact same behavior
```

## Example 5: Adding Tests

```
Add tests for the order lifecycle:

Context:
- E2E tests use Playwright (see playwright.config.js)
- Test patterns: tests/login.spec.js
- Order lifecycle: pending_payment → paid → accepted → ready_for_pickup → completed

Implementation:
- Create tests/order-lifecycle.spec.js
- Test each status transition
- Test permission boundaries (vendor cannot see other shops' orders)
