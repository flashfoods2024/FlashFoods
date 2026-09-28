import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import { User } from "../../models/User.js";
import { Shop } from "../../models/Shop.js";
import { authRouter } from "../../routes/auth.js";
import { attachUser } from "../../middleware/auth.js";
import {
  formatLocalDateTime,
  formatPickupTime,
  getPickupUrgency,
} from "../../utils/time.js";

// Locks the post-login landing contract: vendors go straight to Pending
// Orders, students to home. A logged-in vendor visiting `/` (PWA start_url,
// bookmark, direct visit) is forwarded to Pending Orders as well.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = path.join(__dirname, "..", "..", "views");

let mongo;
let server;
let baseUrl;

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());

  const app = express();
  app.set("view engine", "ejs");
  app.set("views", VIEWS_DIR);
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(session({ secret: "test-secret", resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    req.flash = () => [];
    next();
  });
  app.use(attachUser);
  app.use((req, res, next) => {
    res.locals.currentPath = req.path;
    res.locals.currentUser = req.user
      ? { id: req.user._id, role: req.user.role, name: req.user.name, phone: req.user.phone || "", createdAt: req.user.createdAt }
      : null;
    res.locals.vendorShop = null;
    res.locals.cartCount = 0;
    res.locals.flash = { success: [], error: [] };
    res.locals.env = {};
    res.locals.firebaseConfig = null;
    res.locals.appVersion = { version: "test", buildId: "test", buildTimestamp: null };
    res.locals.formatPickupTime = formatPickupTime;
    res.locals.formatLocalDateTime = formatLocalDateTime;
    res.locals.getPickupUrgency = getPickupUrgency;
    next();
  });
  app.use(authRouter);
  // Same vendor guard as the real `/` handler in server.js.
  app.get("/", (req, res) => {
    if (req.user && req.user.role === "vendor") {
      return res.redirect("/vendor/orders/pending");
    }
    res.render("home", { pageTitle: null });
  });

  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

let vendor;
let student;

beforeEach(async () => {
  await Promise.all([Shop.deleteMany({}), User.deleteMany({})]);
  const shop = await Shop.create({ name: "Shop", slug: "shop-auth" });
  vendor = await User.create({
    name: "Vendor",
    email: "vendor.auth@flashfoods.test",
    passwordHash: await bcrypt.hash("vendorpass", 4),
    role: "vendor",
    shop: shop._id,
  });
  student = await User.create({
    name: "Student",
    email: "student.auth@flashfoods.test",
    passwordHash: await bcrypt.hash("studentpass", 4),
    role: "student",
  });
});

async function login(email, password) {
  return fetch(`${baseUrl}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, password }).toString(),
  });
}

function sessionCookie(res) {
  const raw = res.headers.get("set-cookie") || "";
  return raw.split(";")[0];
}

test("vendor login redirects to Pending Orders with a session", async () => {
  const res = await login("vendor.auth@flashfoods.test", "vendorpass");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/vendor/orders/pending");
  assert.match(sessionCookie(res), /connect\.sid=/);
});

test("student login still redirects to home", async () => {
  const res = await login("student.auth@flashfoods.test", "studentpass");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");
});

test("bad credentials stay on the login page", async () => {
  const res = await login("vendor.auth@flashfoods.test", "wrongpass");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/login");
});

test("logged-in vendor visiting / is forwarded to Pending Orders", async () => {
  const loginRes = await login("vendor.auth@flashfoods.test", "vendorpass");
  const cookie = sessionCookie(loginRes);
  const res = await fetch(`${baseUrl}/`, {
    redirect: "manual",
    headers: { Cookie: cookie },
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/vendor/orders/pending");
});

test("anonymous and student visits to / still render home", async () => {
  const anon = await fetch(`${baseUrl}/`, { redirect: "manual" });
  assert.equal(anon.status, 200);

  const loginRes = await login("student.auth@flashfoods.test", "studentpass");
  const studentHome = await fetch(`${baseUrl}/`, {
    redirect: "manual",
    headers: { Cookie: sessionCookie(loginRes) },
  });
  assert.equal(studentHome.status, 200);
});
