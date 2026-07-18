(function () {
  "use strict";

  if (typeof firebase === "undefined") return;
  if (!("Notification" in window)) return;
  if (!("serviceWorker" in navigator)) return;

  var config = window.__FIREBASE_CONFIG__;
  if (!config) return;
  var vapidKey = config.vapidKey || null;

  if (firebase.apps.length === 0) {
    try {
      firebase.initializeApp(config);
    } catch (e) {
      if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
        console.warn("[FCM] Firebase init failed:", e.message);
      }
      return;
    }
  }

  if (localStorage.getItem("fcm_token_registered")) return;

  var messaging = firebase.messaging();

  navigator.serviceWorker.ready
    .then(function (registration) {
      return Notification.requestPermission().then(function (permission) {
        if (permission !== "granted") return null;
        return messaging.getToken({
          vapidKey: vapidKey,
          serviceWorkerRegistration: registration,
        });
      });
    })
    .then(function (token) {
      if (!token) return null;
      return fetch("/api/fcm/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token, deviceInfo: navigator.userAgent }),
      });
    })
    .then(function (response) {
      if (response && response.ok) {
        localStorage.setItem("fcm_token_registered", "true");
      }
    })
    .catch(function (err) {
      if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
        console.warn("[FCM] Token registration skipped:", err.message);
      }
    });
})();
