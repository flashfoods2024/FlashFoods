import mongoose from "mongoose";

export function requireDb(req, res, next) {
  if (mongoose.connection.readyState === 1) return next();
  req.flash("error", "Database not connected. Fix MONGODB_URI and restart the server.");
  return res.redirect("/");
}

