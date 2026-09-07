import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config';

const VENDOR_EMAIL = 'test.vendor@flashfoods.test';
const SHOP_SLUG = 'testing';
const STATE_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'temp',
  '.qa-shop-state.json'
);

export default async function globalTeardown() {
  let mongo;
  try {
    let original;
    if (fs.existsSync(STATE_FILE)) {
      original = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } else {
      // Interrupted run (no state file): restore to the canonical disabled
      // state without touching the vendor link (unknown without state file).
      original = {
        vendorId: null,
        isActive: false,
        isOpen: false,
        userShop: null,
      };
    }
    mongo = new MongoClient(process.env.MONGO_URI);
    await mongo.connect();
    const db = mongo.db();
    const $set = { isActive: original.isActive, isOpen: original.isOpen };
    if (original.vendorId) {
      $set.vendor = new ObjectId(original.vendorId);
    }
    await db.collection('shops').updateOne({ slug: SHOP_SLUG }, { $set });
    await db
      .collection('users')
      .updateOne({ email: VENDOR_EMAIL }, { $set: { shop: original.userShop } });
    fs.rmSync(STATE_FILE, { force: true });
    console.log('[global-teardown] testing shop restored to original state');
  } catch (err) {
    console.error('[global-teardown] failed:', err.message);
  } finally {
    if (mongo) await mongo.close();
  }
}
