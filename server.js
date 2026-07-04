import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import flash from "connect-flash";
import path from "path";
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
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 300 requests per IP
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);
app.use(limiter);
const port = Number(process.env.PORT || 3000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

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

  req.flash("error", "Something went wrong. Please try again.");
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

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
