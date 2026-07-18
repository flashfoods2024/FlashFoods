// =============================================================================
// Flash Foods — Firebase Messaging Service Worker
// Purpose: Handle background FCM push notifications for vendor PWA.
// =============================================================================

importScripts("https://www.gstatic.com/firebasejs/11.1.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.1.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "__FIREBASE_API_KEY__",
  authDomain: "__FIREBASE_AUTH_DOMAIN__",
  projectId: "__FIREBASE_PROJECT_ID__",
  storageBucket: "__FIREBASE_STORAGE_BUCKET__",
  messagingSenderId: "__FIREBASE_MESSAGING_SENDER_ID__",
  appId: "__FIREBASE_APP_ID__",
});

const messaging = firebase.messaging();

const VENDOR_DASHBOARD = "/vendor/orders/pending";
const ICON = "/icons/icon-192x192.png";
const BADGE = "/icons/icon-192x192.png";

messaging.onBackgroundMessage(function (payload) {
  var data = payload.data || {};
  var notification = payload.notification || {};
  var tag = data.tag || "flashfoods-order-" + (data.orderId || Date.now());

  var title = notification.title || "New Order";
  var body = notification.body || "A new order has been placed.";

  self.registration.showNotification(title, {
    body: body,
    icon: ICON,
    badge: BADGE,
    tag: tag,
    renotify: false,
    requireInteraction: false,
    data: {
      click_action: data.click_action || VENDOR_DASHBOARD,
      vendorId: data.vendorId || null,
      orderId: data.orderId || null,
      timestamp: data.timestamp || Date.now(),
    },
  });
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  var clickAction = event.notification.data.click_action || VENDOR_DASHBOARD;
  var urlToOpen = new URL(clickAction, self.location.origin).href;

  var promiseChain = clients
    .matchAll({
      type: "window",
      includeUncontrolled: true,
    })
    .then(function (windowClients) {
      var focusTarget = null;

      for (var i = 0; i < windowClients.length; i++) {
        var client = windowClients[i];
        if (client.url.indexOf(self.location.origin) === 0) {
          focusTarget = client;
          break;
        }
      }

      if (focusTarget) {
        return focusTarget.focus().then(function (client) {
          return client.navigate(urlToOpen);
        });
      }

      return clients.openWindow(urlToOpen);
    });

  event.waitUntil(promiseChain);
});
