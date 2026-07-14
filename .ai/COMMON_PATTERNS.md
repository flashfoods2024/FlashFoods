# Common Patterns

## Route Handler Pattern

```js
router.get("/path",
  requireDb,        // 1. DB connection check
  requireAuth,      // 2. Authentication
  requireRole,      // 3. Role authorization (optional)
  async (req, res) => {
    // 4. Business logic
    // 5. Render or redirect
  }
);
```

## Error Handling Pattern

```js
// Page routes: flash + redirect
req.flash("error", "Message");
return res.redirect("/path");

// JSON routes: status + JSON
return res.status(400).json({ error: "Message" });

// Try/catch with flash fallback
try {
  // logic
} catch (err) {
  console.error(err);
  req.flash("error", err.message);
  return res.redirect("/path");
}
```

## ID Validation Pattern

```js
const { id } = req.params;
if (!mongoose.isValidObjectId(id)) {
  req.flash("error", "Invalid ID.");
  return res.redirect("/path");
}
```

## Shop Ownership Check

```js
const order = await Order.findById(id);
if (!order || String(order.shop) !== req.vendorShopIdStr) {
  req.flash("error", "Order not found.");
  return res.redirect("/path");
}
```

## Session Cart Pattern

```js
function getCart(req) {
  if (!req.session.cart || typeof req.session.cart !== "object") {
    req.session.cart = { shopId: null, items: [] };
  }
  if (!Array.isArray(req.session.cart.items)) req.session.cart.items = [];
  return req.session.cart;
}
```

## Variant Price Resolution

```js
var price = m.price;
var variants = m.variants || [];
if (variantId != null && variants[variantId]) {
  price = variants[variantId].price;
}
```

## Flash Message Pattern

```js
// Set:
req.flash("success", "Message");
req.flash("error", "Message");

// Read (in res.locals setup):
res.locals.flash = {
  success: req.flash("success"),
  error: req.flash("error"),
};
```

## Payment Gateway Factory Pattern

```js
// Each gateway has a getXxxFromShop(shop) function
// that returns shop-specific or default credentials
export function getGatewayFromShop(shop) {
  const settings = shop?.paymentSettings?.gateway;
  const useCustom = settings?.keyId && settings?.keySecret;
  if (useCustom) { return { ...settings }; }
  return { keyId: process.env.KEY_ID, ... };
}
```

## Export Pattern

```js
// Route files
export const routerName = express.Router();

// Model files
export const ModelName = mongoose.model("ModelName", schema);

// Utility files
export function functionName() { ... }
