# Socket.IO Events

## Server Setup

Socket.IO is initialized in `socket/index.js` and attached to the HTTP server in `server.js`.

```js
// server.js
import { initSocket } from "./socket/index.js";
const server = app.listen(port, () => { ... });
initSocket(server);
```

## Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `vendor:join` | `shopId: string` | Vendor client joins the room for their shop |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `pending-count` | `count: number` | Number of orders with status "paid" for the shop |

## Room Naming Convention

- Room name: `shop:<shopId>` where shopId is the MongoDB ObjectId string

## Flow

```
1. Vendor navigates to any vendor page
2. Client connects to Socket.IO
3. Client emits "vendor:join" with the shop's ID
4. Server:
   a. Joins socket to room "shop:<shopId>"
   b. Queries Order.countDocuments({ shop: shopId, status: "paid" })
   c. Emits "pending-count" with the count to the connecting socket
5. When an order status changes (new paid order, accept, cancel):
   a. Server calls emitPendingCount(shopId)
   b. Queries Order.countDocuments({ shop: shopId, status: "paid" })
   c. Emits "pending-count" to the room "shop:<shopId>"
```

## emitPendingCount Triggers

| File | Action |
|------|--------|
| routes/orders.js | POST /verify-payment (Razorpay payment verified) |
| routes/orders.js | POST /orders/checkout (mock payment) |
| routes/orders.js | POST /easebuzz/callback (Easebuzz payment success) |
| routes/orders.js | POST /phonepe/callback (PhonePe payment success) |
| routes/vendor.js | POST /vendor/orders/:id/accept |
| routes/vendor.js | POST /vendor/orders/:id/ready |
| routes/vendor.js | POST /vendor/orders/:id/cancel |
| routes/webhooks.js | POST /webhooks/razorpay (payment.captured event) |

## Client Implementation

In `public/js/notification-manager.js`:

- `NotificationManager` class connects to Socket.IO
- On "pending-count" event:
  1. Updates document title: `"(N) Pending Orders - Flash Foods"`
  2. Plays `ringing_sound.mp3` in a loop when count > 0
  3. Stops audio when count reaches 0
- Used in vendor EJS templates via script include

## Helper Functions

```js
// socket/index.js
getIO()        → returns the Socket.IO server instance
emitPendingCount(shopId) → emits pending count to shop room
```

## Current Limitations

- No authentication on Socket.IO connection (any client can join any room)
- No disconnection handling (cleanup when vendor leaves)
- No student-side events (order status updates pushed to student)
- No room leave on vendor logout
- Audio notification is basic (no pause/stop control besides count hitting zero)
