// ── RUNTIME CATEGORY PIPELINE TEST ──
// Connects to MongoDB Atlas, creates a session,
// POSTs to the confirm route, and logs every stage.

import http from "http";
import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { setSession, getSession } from "./menu-import/store.js";
import MenuItem from "./models/MenuItem.js";

dotenv.config();

const PORT = 3000;
const BASE = `http://localhost:${PORT}`;

async function main() {
  console.log("=".repeat(70));
  console.log("RUNTIME CATEGORY PIPELINE TEST");
  console.log("=".repeat(70));

  // ── Simulate a Gemini extraction result ──
  const geminiItems = [
    {
      name: "Butter Maggie",
      description: "Creamy maggie with butter",
      category: "Snacks",
      foodType: "veg",
      variants: [{ label: "Regular", price: 80 }],
      confidence: 0.95,
    },
    {
      name: "Hot Coffee",
      description: "Fresh brewed coffee",
      category: "Hot Beverages",
      foodType: "veg",
      variants: [{ label: "Small", price: 30 }, { label: "Large", price: 50 }],
      confidence: 0.92,
    },
    {
      name: "Club Sandwich",
      description: "Grilled sandwich with veggies",
      category: "Sandwiches",
      foodType: "veg",
      variants: [{ label: "Regular", price: 120 }],
      confidence: 0.88,
    },
  ];

  console.log("\n--- STAGE 1: Simulated Gemini response ---");
  console.log("Category in item[0]:", geminiItems[0].category);
  console.log("Category in item[1]:", geminiItems[1].category);
  console.log("Category in item[2]:", geminiItems[2].category);

  // ── Connect to MongoDB ──
  console.log("\nConnecting to MongoDB...");
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGO_URI not found in env");
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log("MongoDB connected");

  // ── Check if there's a test vendor/shop ──
  const Shop = mongoose.model("Shop", new mongoose.Schema({}, { strict: false }), "shops");
  const Vendor = mongoose.model("Vendor", new mongoose.Schema({}, { strict: false }), "vendors");
  
  const anyShop = await Shop.findOne({}).lean();
  const anyVendor = await Vendor.findOne({}).lean();

  if (!anyShop || !anyVendor) {
    console.error("No shop or vendor found in database");
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log("\nFound shop:", anyShop._id, anyShop.name);
  console.log("Found vendor:", anyVendor._id, anyVendor.email);

  // ── Create import session ──
  const importId = "test-import-" + Date.now();
  setSession(importId, {
    filePath: "/tmp/test-menu.jpg",
    fileName: "test-menu.jpg",
    fileSize: 12345,
    mimeType: "image/jpeg",
    vendorId: String(anyVendor._id),
    shopId: String(anyShop._id),
    status: "uploaded",
    parsed: null,
    preview: null,
    errors: [],
  });

  // ── STAGE 4: Simulate browser form submission ──
  console.log("\n--- STAGE 4: Simulated browser form POST payload ---");
  const formPayload = {
    importId: importId,
    "items[0][name]": "Butter Maggie",
    "items[0][category]": "Snacks",
    "items[0][description]": "Creamy maggie with butter",
    "items[0][foodType]": "veg",
    "items[0][variants][0][label]": "Regular",
    "items[0][variants][0][price]": "80",
    "items[1][name]": "Hot Coffee",
    "items[1][category]": "Hot Beverages",
    "items[1][description]": "Fresh brewed coffee",
    "items[1][foodType]": "veg",
    "items[1][variants][0][label]": "Small",
    "items[1][variants][0][price]": "30",
    "items[1][variants][1][label]": "Large",
    "items[1][variants][1][price]": "50",
    "items[2][name]": "Club Sandwich",
    "items[2][category]": "Sandwiches",
    "items[2][description]": "Grilled sandwich with veggies",
    "items[2][foodType]": "veg",
    "items[2][variants][0][label]": "Regular",
    "items[2][variants][0][price]": "120",
  };

  console.log("items[0][category]:", formPayload["items[0][category]"]);
  console.log("items[1][category]:", formPayload["items[1][category]"]);
  console.log("items[2][category]:", formPayload["items[2][category]"]);

  // ── STAGE 5: POST to express confirm route ──
  console.log("\n--- STAGE 5: POST to /admin/vendors/:id/menu/import/confirm ---");

  const body = new URLSearchParams(formPayload).toString();

  const response = await fetch(
    `${BASE}/admin/vendors/${anyVendor._id}/menu/import/confirm`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": "connect.sid=test-session", // won't matter for this test
      },
      body: body,
      redirect: "manual",
    }
  );

  console.log("Response status:", response.status);
  const location = response.headers.get("location");
  console.log("Redirect to:", location);

  // ── STAGE 8: Query MongoDB for the newly inserted items ──
  console.log("\n--- STAGE 8: MongoDB query ---");
  const recentItems = await MenuItem.find({ name: { $in: ["Butter Maggie", "Hot Coffee", "Club Sandwich"] } })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  console.log(`Found ${recentItems.length} matching items:`);
  recentItems.forEach((item, i) => {
    console.log(`[${i}] name: "${item.name}", category: "${item.category}", foodType: ${item.foodType}, createdAt: ${item.createdAt}`);
  });

  // ── FINAL VERDICT ──
  console.log("\n" + "=".repeat(70));
  console.log("FINAL VERDICT");
  console.log("=".repeat(70));
  
  recentItems.forEach((item, i) => {
    const hasCategory = item.category && item.category.length > 0;
    console.log(`Item "${item.name}": category="${item.category}" — ${hasCategory ? 'PRESENT' : 'MISSING'}`);
  });

  // Clean up test data
  console.log("\nCleaning up test data...");
  await MenuItem.deleteMany({ name: { $in: ["Butter Maggie", "Hot Coffee", "Club Sandwich"] } });
  console.log("Test data cleaned up.");

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});