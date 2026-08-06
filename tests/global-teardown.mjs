import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config';

const VENDOR_EMAIL = 'test.vendor@flashfoods.test';
const SHOP_SLUG = 'juice-corner';
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
      // Interrupted run (no state file): fall back to the canonical original state.
      original = {
        vendorId: '69f94f3740d1612eddf0d00c',
        isActive: false,
        isOpen: false,
        userShop: null,
      };
    }
    mongo = new MongoClient(process.env.MONGO_URI);
    await mongo.connect();
    const db = mongo.db();
    await db
      .collection('shops')
      .updateOne(
        { slug: SHOP_SLUG },
        {
          $set: {
            vendor: new ObjectId(original.vendorId),
            isActive: original.isActive,
            isOpen: original.isOpen,
          },
        }
      );
    await db
      .collection('users')
      .updateOne({ email: VENDOR_EMAIL }, { $set: { shop: original.userShop } });
    fs.rmSync(STATE_FILE, { force: true });
    console.log('[global-teardown] juice-corner restored to original state');
  } catch (err) {
    console.error('[global-teardown] failed:', err.message);
  } finally {
    if (mongo) await mongo.close();
  }
}
