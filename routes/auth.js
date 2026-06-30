import express from "express";
import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { requireDb } from "../middleware/requireDb.js";

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

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

