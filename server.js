import express from "express";
import session from "express-session";
import flash from "connect-flash";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import connectDb from "./config/db.js";
import { authRouter } from "./routes/auth.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
  })
);

app.use(flash());

app.use((req, res, next) => {
  res.locals.currentUser = req.session?.userId
    ? { id: req.session.userId, role: req.session.role, name: req.session.name }
    : null;

  res.locals.flash = {
    success: req.flash("success"),
    error: req.flash("error"),
  };

  next();
});

app.get("/", (req, res) => {
  res.render("home", { pageTitle: "Smart Canteen" });
});

app.use(authRouter);

try {
  await connectDb();
} catch (e) {
  console.error("Server not started because MongoDB could not connect.");
  console.error("Fix your MONGODB_URI in .env (preferred) or MONGO_URI, then restart.");
  process.exit(1);
}

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});