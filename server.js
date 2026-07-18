import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import flash from "connect-flash";
import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import connectDb from "./config/db.js";
import { Shop } from "./models/Shop.js";
import { attachUser } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { shopsRouter } from "./routes/shops.js";
import { cartRouter } from "./routes/cart.js";
import { ordersRouter } from "./routes/orders.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { vendorRouter } from "./routes/vendor.js";
import { menuRouter } from "./routes/menu.js";
import { adminRouter } from "./routes/admin.js";
import {
  formatLocalDateTime,
  formatPickupTime,
  getPickupUrgency,
} from "./utils/time.js";
import { initSocket } from "./socket/index.js";
import { fcmRouter } from "./routes/api/fcm.js";
import "./config/firebase-admin.js";

dotenv.config();
console.log(
  "GEMINI_API_KEY:",
  process.env.GEMINI_API_KEY ? "SET" : "MISSING"
);

console.log(
  "RESEND_API_KEY:",
  process.env.RESEND_API_KEY ? "SET" : "MISSING"
);

// ---------------------------------------------------------------------------
// Global process-level error handlers
// ---------------------------------------------------------------------------
process.on("unhandledRejection", (reason, promise) => {
  console.error("=== UNHANDLED PROMISE REJECTION ===");
  console.error("Reason:", reason);
  if (reason instanceof Error) {
    console.error("Stack trace:", reason.stack);
  } else {
    console.error("(Reason is not an Error object; no stack trace available)");
  }
  console.error("Promise:", promise);
});

process.on("uncaughtException", (err) => {
  console.error("=== UNCAUGHT EXCEPTION ===");
  console.error("Error:", err.message);
  console.error("Stack trace:", err.stack);
  process.exit(1);
});
const app = express();
//RATE LIMITING: 300 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

const disableRateLimit = process.env.DISABLE_RATE_LIMIT === "true";

app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);

if (!disableRateLimit) {
  app.use(limiter);
}

const port = Number(process.env.PORT || 3000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// App version metadata — read at startup, injected into every response
// ---------------------------------------------------------------------------
let appVersion;
try {
  appVersion = JSON.parse(
    readFileSync(path.join(__dirname, "public", "version.json"), "utf-8"),
  );
} catch {
  appVersion = { version: "1.0.0", buildId: "dev", buildTimestamp: null };
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Serve key PWA files with no-cache so browsers always fetch the latest version
app.get("/sw.js", (req, res) => {
  res.set("Content-Type", "application/javascript");
  res.set("Cache-Control", "no-cache");
  const swPath = path.join(__dirname, "public", "sw.js");
  const raw = readFileSync(swPath, "utf-8");
  const injected = raw
    .replace(/__FIREBASE_API_KEY__/g, process.env.FIREBASE_API_KEY || "")
    .replace(/__FIREBASE_AUTH_DOMAIN__/g, process.env.FIREBASE_AUTH_DOMAIN || "")
    .replace(/__FIREBASE_PROJECT_ID__/g, process.env.FIREBASE_PROJECT_ID || "")
    .replace(/__FIREBASE_STORAGE_BUCKET__/g, process.env.FIREBASE_STORAGE_BUCKET || "")
    .replace(/__FIREBASE_MESSAGING_SENDER_ID__/g, process.env.FIREBASE_MESSAGING_SENDER_ID || "")
    .replace(/__FIREBASE_APP_ID__/g, process.env.FIREBASE_APP_ID || "");
  res.send(injected);
});

app.get("/firebase-messaging-sw.js", (req, res) => {
  res.set("Content-Type", "application/javascript");
  res.set("Cache-Control", "no-cache");
  const swPath = path.join(__dirname, "public", "firebase-messaging-sw.js");
  const raw = readFileSync(swPath, "utf-8");
  const injected = raw
    .replace(/__FIREBASE_API_KEY__/g, process.env.FIREBASE_API_KEY || "")
    .replace(/__FIREBASE_AUTH_DOMAIN__/g, process.env.FIREBASE_AUTH_DOMAIN || "")
    .replace(/__FIREBASE_PROJECT_ID__/g, process.env.FIREBASE_PROJECT_ID || "")
    .replace(/__FIREBASE_STORAGE_BUCKET__/g, process.env.FIREBASE_STORAGE_BUCKET || "")
    .replace(/__FIREBASE_MESSAGING_SENDER_ID__/g, process.env.FIREBASE_MESSAGING_SENDER_ID || "")
    .replace(/__FIREBASE_APP_ID__/g, process.env.FIREBASE_APP_ID || "");
  res.send(injected);
});

app.get("/version.json", (req, res) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(__dirname, "public", "version.json"));
});

app.use(express.static(path.join(__dirname, "public")));

// Razorpay webhooks must be mounted BEFORE express.json() so the route-level
// express.raw() middleware receives the unparsed body for signature checks.
app.use(webhooksRouter);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      // sameSite: "lax",
    },
  }),
);

app.use(flash());

app.use(attachUser);

app.use(async (req, res, next) => {
  res.locals.currentUser = req.user
    ? {
        id: req.user._id,
        role: req.user.role,
        name: req.user.name,
      }
    : null;

  res.locals.vendorShop = null;
  if (req.user?.role === "vendor" && req.user.shop) {
    try {
      res.locals.vendorShop = await Shop.findById(req.user.shop)
        .select("name slug")
        .lean();
    } catch {
      /* ignore */
    }
  }

  const cart = req.session?.cart;
  const items = cart && Array.isArray(cart.items) ? cart.items : [];
  res.locals.cartCount = items.reduce(
    (sum, line) => sum + (Number(line.quantity) || 0),
    0,
  );

  res.locals.flash = {
    success: req.flash("success"),
    error: req.flash("error"),
  };

  res.locals.env = {
    RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
  };

  res.locals.firebaseConfig = process.env.FIREBASE_API_KEY
    ? {
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID,
        vapidKey: process.env.FIREBASE_VAPID_KEY || null,
      }
    : null;

  res.locals.appVersion = appVersion;

  res.locals.formatPickupTime = formatPickupTime;
  res.locals.formatLocalDateTime = formatLocalDateTime;
  res.locals.getPickupUrgency = getPickupUrgency;

  next();
});

app.get("/", (req, res) => {
  res.render("home", { pageTitle: null });
});

app.use(authRouter);
app.use(shopsRouter);
app.use(cartRouter);
app.use(ordersRouter);
app.use(menuRouter);
app.use(vendorRouter);
app.use("/api/fcm", fcmRouter);
app.use("/admin", adminRouter);

// ---------------------------------------------------------------------------
// Global Express error handler (must be last app.use)
// ---------------------------------------------------------------------------
app.use((err, req, res, _next) => {
  console.error("=== GLOBAL EXPRESS ERROR HANDLER ===");
  console.error("Request:", req.method, req.originalUrl);
  console.error("Error:", err.message || err);
  if (err instanceof Error) {
    console.error("Stack trace:", err.stack);
  } else {
    console.error("(Error is not an Error instance)");
  }

  // Avoid sending HTML in API routes; fall back to generic 500 for page routes
  if (req.path.startsWith("/api/")) {
    return res.status(500).json({ error: "Internal server error." });
  }

  if (typeof req.flash === "function") {
    req.flash("error", "Something went wrong. Please try again.");
  }
  const fallback =
    req.headers.referer ||
    (req.user?.role === "admin" ? "/admin/dashboard" : "/");
  res.status(500).redirect(fallback);
});

try {
  await connectDb();
} catch (e) {
  console.error("Server not started because MongoDB could not connect.");
  console.error(
    "Fix your MONGODB_URI in .env (preferred) or MONGO_URI, then restart.",
  );
  process.exit(1);
}

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${port}`);
});

initSocket(server);
