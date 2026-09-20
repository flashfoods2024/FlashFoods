import { Server } from "socket.io";
import { Order } from "../models/Order.js";

let _io;

// Pending = paid orders awaiting vendor action. Shared by the real-time
// `vendor:join` snapshot, the broadcast helper, and the unit tests so the
// definition of "pending" lives in exactly one place.
export function countPendingOrders(shopId) {
  return Order.countDocuments({ shop: shopId, status: "paid" });
}

export function initSocket(server) {
  _io = new Server(server);

  _io.on("connection", (socket) => {
    socket.on("vendor:join", async (shopId) => {
      socket.join(`shop:${shopId}`);
      try {
        socket.emit("pending-count", await countPendingOrders(shopId));
      } catch (err) {
        console.error("vendor:join count error:", err);
      }
    });
  });
}

export function getIO() {
  return _io;
}

export async function emitPendingCount(shopId) {
  if (!_io) return;
  try {
    _io.to(`shop:${shopId}`).emit("pending-count", await countPendingOrders(shopId));
  } catch (err) {
    console.error("emitPendingCount error:", err);
  }
}
