import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import 'dotenv/config';

const VENDOR_EMAIL = 'test.vendor@flashfoods.test';
const SHOP_SLUG = 'juice-corner';
const STATE_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'temp',
  '.qa-shop-state.json'
);

export default async function globalSetup() {
  const mongo = new MongoClient(process.env.MONGO_URI);
  await mongo.connect();
  try {
    const db = mongo.db();
    const shop = await db.collection('shops').findOne({ slug: SHOP_SLUG });
    const vendor = await db.collection('users').findOne({ email: VENDOR_EMAIL });
    if (!shop || !vendor) {
      throw new Error(`QA fixture missing: shop=${!!shop} vendor=${!!vendor}`);
    }
    const original = {
      vendorId: String(shop.vendor),
      isActive: shop.isActive,
      isOpen: shop.isOpen,
      userShop: vendor.shop ? String(vendor.shop) : null,
    };
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(original, null, 2));
    await db
      .collection('shops')
      .updateOne({ _id: shop._id }, { $set: { vendor: vendor._id, isActive: true, isOpen: true } });
    await db.collection('users').updateOne({ _id: vendor._id }, { $set: { shop: shop._id } });
    console.log('[global-setup] juice-corner enabled for', VENDOR_EMAIL);
  } finally {
    await mongo.close();
  }
}
