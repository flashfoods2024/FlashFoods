// =============================================================================
// Flash Foods — Service Worker
// Purpose: PWA caching + Firebase Cloud Messaging background notifications
// =============================================================================

// ---- Firebase Messaging ----------------------------------------------------
importScripts("/js/firebase/firebase-app-compat.js");
importScripts("/js/firebase/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "__FIREBASE_API_KEY__",
  authDomain: "__FIREBASE_AUTH_DOMAIN__",
  projectId: "__FIREBASE_PROJECT_ID__",
  storageBucket: "__FIREBASE_STORAGE_BUCKET__",
  messagingSenderId: "__FIREBASE_MESSAGING_SENDER_ID__",
  appId: "__FIREBASE_APP_ID__",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  var data = payload.data || {};
  var notification = payload.notification || {};
  var tag = data.tag || "flashfoods-order-" + (data.orderId || Date.now());

  self.registration.showNotification(notification.title || "New Order", {
    body: notification.body || "A new order has been placed.",
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-192x192.png",
    tag: tag,
    renotify: false,
    requireInteraction: false,
    data: {
      click_action: data.click_action || "/vendor/orders/pending",
      vendorId: data.vendorId || null,
      orderId: data.orderId || null,
      timestamp: data.timestamp || Date.now(),
    },
  });
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  var clickAction = event.notification.data.click_action || "/vendor/orders/pending";
  var urlToOpen = new URL(clickAction, self.location.origin).href;

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (windowClients) {
        for (var i = 0; i < windowClients.length; i++) {
          var client = windowClients[i];
          if (client.url.indexOf(self.location.origin) === 0) {
            return client.focus().then(function (c) {
              return c.navigate(urlToOpen);
            });
          }
        }
        return clients.openWindow(urlToOpen);
      }),
  );
});

// ---- PWA Caching -----------------------------------------------------------
const BUILD_ID = "__BUILD_ID__";
const CACHE_VERSION = "v-" + BUILD_ID;
const STATIC_CACHE = "flashfoods-static-" + CACHE_VERSION;

const PRECACHE = [
  "/styles.css",
  "/food-placeholder.svg",
  "/background-image.png",
  "/images/canteen-bg.png",
  "/fonts/Transcity-DEMO.otf",
  "/icon.png",
  "/icons/icon-192x192.png",
  "/manifest.json",
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(STATIC_CACHE).then(function (c) { return c.addAll(PRECACHE); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) { return k !== STATIC_CACHE; })
            .map(function (k) { return caches.delete(k); }),
        );
      })
      .then(function () { return clients.claim(); }),
  );
});

self.addEventListener("message", function (e) {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req));
    return;
  }
  var url = new URL(req.url);
  if (url.pathname.startsWith("/socket.io/")) return;
  if (url.pathname === "/version.json") return;
  e.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req); }));
});
