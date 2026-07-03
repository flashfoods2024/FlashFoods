import crypto from "crypto";
import express from "express";
import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { requireDb } from "../middleware/requireDb.js";
import { sendPasswordResetEmail } from "../utils/email.js";

export const authRouter = express.Router();

authRouter.get("/signup", (req, res) => {
  res.render("auth/signup", { pageTitle: "Sign Up" });
});

authRouter.post("/signup", requireDb, async (req, res) => {
  const { name, email, password, role } = req.body || {};
  const safeRole = role === "vendor" ? "vendor" : "student";

  if (!name || !email || !password) {
    req.flash("error", "All fields are required.");
    return res.redirect("/signup");
  }

  const existing = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (existing) {
    req.flash("error", "Email already registered.");
    return res.redirect("/signup");
  }

  const passwordHash = await bcrypt.hash(String(password), 10);
  const user = await User.create({
    name: String(name).trim(),
    email: String(email).toLowerCase().trim(),
    passwordHash,
    role: safeRole,
  });

  req.session.userId = String(user._id);

  req.flash("success", "Account created.");
  return res.redirect("/");
});

authRouter.get("/login", (req, res) => {
  res.render("auth/login", { pageTitle: "Login" });
});

authRouter.post("/login", requireDb, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    req.flash("error", "Email and password are required.");
    return res.redirect("/login");
  }

  const user = await User.findOne({ email: String(email).toLowerCase().trim() });
  if (!user) {
    req.flash("error", "Invalid credentials.");
    return res.redirect("/login");
  }

  if (user.isActive === false) {
    req.flash("error", "This account has been disabled.");
    return res.redirect("/login");
  }

  const ok = await bcrypt.compare(String(password), user.passwordHash);
  if (!ok) {
    req.flash("error", "Invalid credentials.");
    return res.redirect("/login");
  }

  req.session.userId = String(user._id);

  req.flash("success", "Logged in.");
  return res.redirect("/");
});

authRouter.get("/forgot-password", (req, res) => {
  res.render("auth/forgot-password", { pageTitle: "Forgot Password" });
});

authRouter.post("/forgot-password", requireDb, async (req, res) => {
  const { email } = req.body || {};

  const msg = "If an account with that email exists, a password reset link has been sent.";

  if (!email) {
    req.flash("error", "Please enter your email address.");
    return res.redirect("/forgot-password");
  }

  const user = await User.findOne({ email: String(email).toLowerCase().trim() });

  if (user) {
    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");
    const resetUrl = `${appUrl}/reset-password/${resetToken}`;
    await sendPasswordResetEmail(user.email, resetUrl);
  }

  req.flash("success", msg);
  return res.redirect("/forgot-password");
});

authRouter.get("/reset-password/:token", requireDb, async (req, res) => {
  const { token } = req.params;
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: new Date() },
  });

  if (!user) {
    req.flash("error", "Password reset link is invalid or has expired.");
    return res.redirect("/forgot-password");
  }

  res.render("auth/reset-password", { pageTitle: "Reset Password", token });
});

authRouter.post("/reset-password/:token", requireDb, async (req, res) => {
  const { token } = req.params;
  const { password, confirmPassword } = req.body || {};

  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: new Date() },
  });

  if (!user) {
    req.flash("error", "Password reset link is invalid or has expired.");
    return res.redirect("/forgot-password");
  }

  if (!password || password.length < 6) {
    req.flash("error", "Password must be at least 6 characters.");
    return res.redirect(`/reset-password/${token}`);
  }

  if (password !== confirmPassword) {
    req.flash("error", "Passwords do not match.");
    return res.redirect(`/reset-password/${token}`);
  }

  user.passwordHash = await bcrypt.hash(String(password), 10);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  // Password changed — user is redirected to login and must re-authenticate.
  //
  // Targeted session invalidation (destroying all sessions for this user)
  // is not implemented because the default MemoryStore does not support
  // querying sessions by userId. To enable that, migrate to a store that
  // supports filtering by session data (e.g. connect-mongo) and iterate
  // over sessions to destroy those matching this user's ID.

  req.flash("success", "Password has been reset successfully. Please log in with your new password.");
  return res.redirect("/login");
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

