import mongoose from "mongoose";
import dotenv from "dotenv";
import { MenuItem } from "../models/MenuItem.js";
import connectDb from "../config/db.js";

dotenv.config();

async function migrateMenuPrices() {
  await connectDb();
  console.log("Connected to MongoDB");

  // Phase 1: Add variants field to documents that don't have it.
  // Previously, documents created via insertMany (seed, OCR v1) did not
  // receive the schema default for "variants".
  const missingVariants = await MenuItem.find({
    $or: [
      { variants: { $exists: false } },
      { variants: { $eq: [] } },
    ],
  });

  console.log(`Found ${missingVariants.length} items without variants`);
  let count1 = 0;
  for (const item of missingVariants) {
    item.variants = [{ label: "Regular", price: item.price }];
    await item.save();
    count1++;
  }
  console.log(`Fixed ${count1} items — added variants array`);

  // Phase 2: Sync variant[0].price with the top-level price for items that
  // have a single variant.  Multi-variant items are left untouched because
  // the first variant may legitimately differ from the base price.
  const desynced = await MenuItem.find({
    variants: { $exists: true, $not: { $size: 0 } },
    $expr: { $ne: ["$price", { $arrayElemAt: ["$variants.price", 0] }] },
  });

  console.log(`Found ${desynced.length} items where variants[0].price !== price`);
  let count2 = 0;
  for (const item of desynced) {
    if (item.variants.length > 1) {
      console.log(
        `  Skipping multi-variant item "${item.name}" (${item._id}) — manual review recommended`,
      );
      continue;
    }
    item.variants[0].price = item.price;
    await item.save();
    count2++;
  }
  console.log(`Fixed ${count2} desynced single-variant items`);

  console.log("Migration complete.");
  process.exit(0);
}

migrateMenuPrices().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
