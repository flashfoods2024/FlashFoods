import { Server } from "socket.io";
import { Order } from "../models/Order.js";

let _io;

export function initSocket(server) {
  _io = new Server(server);

  _io.on("connection", (socket) => {
    socket.on("vendor:join", (shopId) => {
      socket.join(`shop:${shopId}`);
    });
  });
}

export function getIO() {
  return _io;
}

export async function emitPendingCount(shopId) {
  if (!_io) return;
  try {
    const pendingCount = await Order.countDocuments({
      shop: shopId,
      status: { $in: ["paid", "accepted"] },
    });
    _io.to(`shop:${shopId}`).emit("pending-count", pendingCount);
  } catch (err) {
    console.error("emitPendingCount error:", err);
  }
}
