/**
 * Isolated QA harness for the Vendor Profile V2 browser flow.
 *
 * Starts an in-memory MongoDB, seeds two competing shops plus a student, writes
 * the expected analytics values to temp/qa-vendor-profile-fixture.json, and then
 * boots the real application (server.js) against that database.
 *
 * Nothing here touches the configured MONGO_URI or any external environment:
 * the memory-server URI is set before server.js (and dotenv) load, and the app
 * runs on its own port.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.QA_PORT || 3123);
const FIXTURE_FILE = path.join(ROOT, "temp", "qa-vendor-profile-fixture.json");
const DAY_MS = 24 * 60 * 60 * 1000;

const fileUrl = (relPath) => pathToFileURL(path.join(ROOT, relPath)).href;

const { MongoMemoryServer } = await import("mongodb-memory-server-core");
const mongo = await MongoMemoryServer.create();
const uri = mongo.getUri();

// Set these BEFORE server.js is imported so dotenv in the app never overrides
// them with the developer's real values.
process.env.MONGO_URI = uri;
process.env.MONGODB_URI = uri;
process.env.PORT = String(PORT);
process.env.SESSION_SECRET = "qa-vendor-profile-secret";
if (!process.env.NODE_ENV) process.env.NODE_ENV = "development";

const mongoose = (await import("mongoose")).default;
const bcrypt = (await import("bcryptjs")).default;
const { Shop } = await import(fileUrl("models/Shop.js"));
const { User } = await import(fileUrl("models/User.js"));
const { Order } = await import(fileUrl("models/Order.js"));
const { startOfIstDay, startOfIstMonth, startOfIstWeek } = await import(
  fileUrl("utils/admin.js")
);

const VENDOR_EMAIL = "qa.vendor@flashfoods.test";
const VENDOR_PASSWORD = "QaPass123!";
const STUDENT_EMAIL = "qa.student@flashfoods.test";
const STUDENT_PASSWORD = "QaPass123!";

function money(value) {
  return "\u20B9" + Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function istDateLabel(date) {
  return new Date(date).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function istDateString(date) {
  const ist = new Date(new Date(date).getTime() + 330 * 60 * 1000);
  const month = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const day = String(ist.getUTCDate()).padStart(2, "0");
  return `${ist.getUTCFullYear()}-${month}-${day}`;
}

async function createOrder(doc) {
  const order = new Order(doc);
  await order.save({ timestamps: false });
  return order;
}

await mongoose.connect(uri);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = new Date();
const todayStart = startOfIstDay(now);
const todayEnd = new Date(todayStart.getTime() + DAY_MS - 1);
const weekStart = startOfIstWeek(now);
const monthStart = startOfIstMonth(now);

const shopA = await Shop.create({
  name: "QA Canteen",
  slug: "qa-canteen",
  vendor: null,
});
const shopB = await Shop.create({
  name: "QA Rival Canteen",
  slug: "qa-rival-canteen",
  vendor: null,
});

const vendorA = await User.create({
  name: "Ramesh QA",
  email: VENDOR_EMAIL,
  passwordHash: await bcrypt.hash(VENDOR_PASSWORD, 10),
  role: "vendor",
  phone: "9000001111",
  shop: shopA._id,
});
const vendorB = await User.create({
  name: "Suresh QA",
  email: "qa.rival@flashfoods.test",
  passwordHash: await bcrypt.hash(VENDOR_PASSWORD, 10),
  role: "vendor",
  phone: "9000002222",
  shop: shopB._id,
});
const student = await User.create({
  name: "Student QA",
  email: STUDENT_EMAIL,
  passwordHash: await bcrypt.hash(STUDENT_PASSWORD, 10),
  role: "student",
  phone: "9000003333",
});

await Shop.updateOne({ _id: shopA._id }, { $set: { vendor: vendorA._id } });
await Shop.updateOne({ _id: shopB._id }, { $set: { vendor: vendorB._id } });

const completed = (shop, createdAt, items, total) => ({
  customer: student._id,
  shop: shop._id,
  items,
  total,
  pickupOtp: "123456",
  status: "completed",
  createdAt,
});

const seeded = [];

// Today (always inside the current IST day).
seeded.push(
  await createOrder(
    completed(
      shopA,
      new Date(todayStart.getTime() + 60_000),
      [{ name: "QA Dosa", price: 60, quantity: 2 }],
      120,
    ),
  ),
);
seeded.push(
  await createOrder(
    completed(
      shopA,
      new Date(todayStart.getTime() + 120_000),
      [
        { name: "QA Dosa", price: 60, quantity: 1 },
        { name: "QA Idli", price: 30, quantity: 2 },
        { name: "QA Removed Special", price: 55, quantity: 1, status: "removed" },
      ],
      120,
    ),
  ),
);

// Week / month extras are only seeded when their window does not overlap a
// smaller one, so every expectation below stays exact no matter which weekday
// or day of month the harness happens to run on.
if (weekStart.getTime() < todayStart.getTime()) {
  seeded.push(
    await createOrder(
      completed(
        shopA,
        new Date(weekStart.getTime() + 60_000),
        [{ name: "QA Vada", price: 50, quantity: 2 }],
        100,
      ),
    ),
  );
}
if (monthStart.getTime() < weekStart.getTime()) {
  seeded.push(
    await createOrder(
      completed(
        shopA,
        new Date(monthStart.getTime() + 60_000),
        [{ name: "QA Pongal", price: 300, quantity: 1 }],
        300,
      ),
    ),
  );
}

// Previous month: outside "this month", inside a wide custom range.
seeded.push(
  await createOrder(
    completed(
      shopA,
      new Date(monthStart.getTime() - DAY_MS),
      [{ name: "QA Old Combo", price: 400, quantity: 1 }],
      400,
    ),
  ),
);

// Cancelled today: must never appear anywhere.
await createOrder({
  customer: student._id,
  shop: shopA._id,
  items: [{ name: "QA Cancelled Special", price: 999, quantity: 1 }],
  total: 9999,
  pickupOtp: "654321",
  status: "cancelled",
  createdAt: new Date(todayStart.getTime() + 180_000),
});

// Rival shop canary data — must never show up on shop A's profile.
await createOrder(
  completed(
    shopB,
    new Date(todayStart.getTime() + 60_000),
    [{ name: "Rival Secret Platter", price: 987654, quantity: 1 }],
    987654,
  ),
);

// ---------------------------------------------------------------------------
// Expectations (computed independently of the app's aggregation)
// ---------------------------------------------------------------------------

const inRange = (order, start, end) =>
  order.createdAt.getTime() >= start.getTime() &&
  order.createdAt.getTime() <= end.getTime();

const activeItems = (order) => order.items.filter((item) => item.status !== "removed");

function summarize(start, end) {
  const orders = seeded.filter((order) => inRange(order, start, end));
  const revenue = orders.reduce((sum, order) => sum + order.total, 0);
  const itemsSold = orders.reduce(
    (sum, order) => sum + activeItems(order).reduce((qty, item) => qty + item.quantity, 0),
    0,
  );
  return {
    orders: orders.length,
    revenue,
    revenueLabel: money(revenue),
    itemsSold,
    averageOrderValueLabel: money(orders.length ? Math.round(revenue / orders.length) : 0),
  };
}

function bestSellers(start, end) {
  const buckets = new Map();
  for (const order of seeded.filter((order) => inRange(order, start, end))) {
    for (const item of activeItems(order)) {
      const bucket = buckets.get(item.name) || { name: item.name, quantity: 0, revenue: 0 };
      bucket.quantity += item.quantity;
      bucket.revenue += item.price * item.quantity;
      buckets.set(item.name, bucket);
    }
  }
  return [...buckets.values()]
    .sort(
      (a, b) =>
        b.quantity - a.quantity ||
        b.revenue - a.revenue ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 5)
    .map((bucket) => ({ ...bucket, revenueLabel: money(bucket.revenue) }));
}

const today = summarize(todayStart, todayEnd);
const wideStart = new Date(monthStart.getTime() - 5 * DAY_MS);
const futureDate = istDateString(new Date(todayStart.getTime() + 200 * DAY_MS));

const fixture = {
  baseUrl: `http://127.0.0.1:${PORT}`,
  vendor: {
    email: VENDOR_EMAIL,
    password: VENDOR_PASSWORD,
    name: vendorA.name,
    phone: vendorA.phone,
    shopName: shopA.name,
    memberSince: istDateLabel(vendorA.createdAt),
  },
  student: { email: STUDENT_EMAIL, password: STUDENT_PASSWORD },
  rival: {
    shopName: shopB.name,
    itemName: "Rival Secret Platter",
    revenueLabel: money(987654),
  },
  today: {
    ...today,
    date: istDateString(todayStart),
    label: istDateLabel(todayStart),
  },
  week: summarize(weekStart, todayEnd),
  month: summarize(monthStart, todayEnd),
  bestSellersToday: bestSellers(todayStart, todayEnd),
  bestSellersMonth: bestSellers(monthStart, todayEnd),
  wideRange: {
    ...summarize(wideStart, todayEnd),
    startDate: istDateString(wideStart),
    endDate: istDateString(todayStart),
    label: `${istDateLabel(wideStart)} \u2013 ${istDateLabel(todayEnd)}`,
    bestSellers: bestSellers(wideStart, todayEnd),
  },
  dayBeforeToday: istDateString(new Date(todayStart.getTime() - DAY_MS)),
  futureDate,
};

fs.mkdirSync(path.dirname(FIXTURE_FILE), { recursive: true });
fs.writeFileSync(FIXTURE_FILE, JSON.stringify(fixture, null, 2));

// ---------------------------------------------------------------------------
// Boot the real application
// ---------------------------------------------------------------------------

await import(fileUrl("server.js"));

console.log(
  `[qa] vendor profile harness ready on ${fixture.baseUrl} (fixture: ${path.relative(ROOT, FIXTURE_FILE)})`,
);
