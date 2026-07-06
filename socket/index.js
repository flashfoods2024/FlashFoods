import { Server } from "socket.io";
import { Order } from "../models/Order.js";

let _io;

export function initSocket(server) {
  _io = new Server(server);

  _io.on("connection", (socket) => {
    socket.on("vendor:join", async (shopId) => {
      socket.join(`shop:${shopId}`);
      try {
        const pendingCount = await Order.countDocuments({
          shop: shopId,
          status: "paid",
        });
        socket.emit("pending-count", pendingCount);
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
    const pendingCount = await Order.countDocuments({
      shop: shopId,
      status: "paid",
    });
    _io.to(`shop:${shopId}`).emit("pending-count", pendingCount);
  } catch (err) {
    console.error("emitPendingCount error:", err);
  }
}
