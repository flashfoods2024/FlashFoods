import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
let _messaging = null;
let _configured = false;

if (admin.apps.length > 0) {
  _messaging = admin.messaging();
  _configured = true;
  console.log("[firebase-admin] already initialized — reusing existing app");
} else if (serviceAccountKey) {
  try {
    const serviceAccount = JSON.parse(serviceAccountKey);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    _messaging = admin.messaging();
    _configured = true;
    console.log("[firebase-admin] initialized — FCM enabled");
  } catch (err) {
    console.error("[firebase-admin] initialization failed:", err.message);
  }
} else {
  console.log("[firebase-admin] FIREBASE_SERVICE_ACCOUNT_KEY not set — FCM disabled");
}

export function getMessaging() {
  return _messaging;
}

export function isFcmConfigured() {
  return _configured;
}
