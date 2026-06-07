import express from "express";
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
import { vendorRouter } from "./routes/vendor.js";
import { menuRouter } from "./routes/menu.js";
import { adminRouter } from "./routes/admin.js";
import {
  formatLocalDateTime,
  formatPickupTime,
  getPickupUrgency,
} from "./utils/time.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
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
