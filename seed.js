import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import connectDb from "./config/db.js";
import { User } from "./models/User.js";
import { Shop } from "./models/Shop.js";
import { MenuItem } from "./models/MenuItem.js";

dotenv.config();

const VENDOR_EMAIL = "vendor@college.com";
const STUDENT_EMAIL = "student@college.test";
const ADMIN_EMAIL = "admin@college.com";
const SHOP_SLUG = "main-canteen";
const VENDOR_STUDENT_PASSWORD = "vendor@1";
const ADMIN_PASSWORD = "admin@1";

async function seed() {
  await connectDb();

  await User.deleteMany({ email: { $in: [VENDOR_EMAIL, STUDENT_EMAIL, ADMIN_EMAIL] } });

  const oldShop = await Shop.findOne({ slug: SHOP_SLUG });
  if (oldShop) {
    await MenuItem.deleteMany({ shop: oldShop._id });
    await Shop.deleteOne({ _id: oldShop._id });
    await User.updateMany({ shop: oldShop._id }, { $set: { shop: null } });
  }

  const passwordHash = await bcrypt.hash(VENDOR_STUDENT_PASSWORD, 10);
  const adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const vendor = await User.create({
    name: "Canteen Vendor",
    email: VENDOR_EMAIL,
    passwordHash,
    role: "vendor",
  });

  const shop = await Shop.create({
    name: "Main Canteen",
    slug: SHOP_SLUG,
    description: "North Indian, snacks, and beverages.",
    vendor: vendor._id,
    paymentProvider: "razorpay",
    paymentConfigured: Boolean(
      process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET,
    ),
    paymentSettings: {
      merchantId: process.env.RAZORPAY_KEY_ID || "demo_merchant",
      apiKey: process.env.RAZORPAY_KEY_ID || "",
      apiSecret: process.env.RAZORPAY_KEY_SECRET || "",
    },
  });

  await User.updateOne({ _id: vendor._id }, { $set: { shop: shop._id } });

  await User.create({
    name: "Test Student",
    email: STUDENT_EMAIL,
    passwordHash,
    role: "student",
  });

  await User.create({
    name: "Super Admin",
    email: ADMIN_EMAIL,
    passwordHash: adminPasswordHash,
    role: "admin",
  });

  await MenuItem.insertMany([
    { shop: shop._id, name: "Masala Dosa", description: "Crispy with potato filling.", price: 60, available: true },
    { shop: shop._id, name: "Samosa (2 pcs)", description: "", price: 20, available: true },
    { shop: shop._id, name: "Masala Chai", description: "", price: 15, available: true },
    { shop: shop._id, name: "Veg Thali", description: "Rice, dal, sabzi, roti.", price: 80, available: true },
  ]);

  console.log("Seed complete.");
  console.log(`  Vendor: ${VENDOR_EMAIL} / ${VENDOR_STUDENT_PASSWORD}`);
  console.log(`  Student: ${STUDENT_EMAIL} / ${VENDOR_STUDENT_PASSWORD}`);
  console.log(`  Admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`  Shop URL: http://localhost:${process.env.PORT || 3000}/shops/${SHOP_SLUG}`);
  process.exit(0);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
