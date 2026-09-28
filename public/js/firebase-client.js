(function () {
  "use strict";

  if (typeof firebase === "undefined") return;
  if (!("Notification" in window)) return;
  if (!("serviceWorker" in navigator)) return;

  var config = window.__FIREBASE_CONFIG__;
  if (!config) return;
  var vapidKey = config.vapidKey || null;

  // Token ownership is keyed per user so switching accounts on the same
  // browser cannot leave a stale token bound to the previous user.
  // Vendors use __FCM_VENDOR_ID__ (kept for compatibility); students set
  // __FCM_USER_ID__ with role-specific register URLs from the header.
  var userId = String(window.__FCM_USER_ID__ || window.__FCM_VENDOR_ID__ || "unknown");
  var TOKEN_KEY = "fcm_token:" + userId;
  var VENDOR_KEY = "fcm_vendor";
  var REGISTER_URL = window.__FCM_REGISTER_URL__ || "/api/fcm/register";
  var UNREGISTER_URL = window.__FCM_UNREGISTER_URL__ || "/api/fcm/unregister";
  var DEFAULT_DASHBOARD = window.__FCM_DEFAULT_PAGE__ || "/vendor/orders/pending";

  if (firebase.apps.length === 0) {
    try {
      firebase.initializeApp(config);
    } catch (e) {
      console.error("[FCM] Firebase init failed:", e.message);
      return;
    }
  }

  function jsonPost(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // If a different user previously registered here, release that binding.
  var previousVendor = localStorage.getItem(VENDOR_KEY);
  if (previousVendor && previousVendor !== userId) {
    var staleToken = localStorage.getItem("fcm_token:" + previousVendor);
    if (staleToken) {
      jsonPost(UNREGISTER_URL, { token: staleToken }).catch(function () {});
    }
    localStorage.removeItem("fcm_token:" + previousVendor);
  }
  localStorage.setItem(VENDOR_KEY, userId);

  // Persist a (possibly refreshed) token, releasing the previous one first.
  function registerToken(token) {
    if (!token) return Promise.resolve();
    var previous = localStorage.getItem(TOKEN_KEY);
    var chain = Promise.resolve();
    if (previous && previous !== token) {
      chain = jsonPost(UNREGISTER_URL, { token: previous }).catch(function () {});
    }
    return chain
      .then(function () {
        return jsonPost(REGISTER_URL, {
          token: token,
          deviceInfo: navigator.userAgent,
        });
      })
      .then(function (response) {
        if (response && response.ok) {
          localStorage.setItem(TOKEN_KEY, token);
          hideOffBanner();
        }
      });
  }

  var messaging = firebase.messaging();

  // Visible fallback: if push registration fails on this device (e.g. the
  // browser's push service rejects subscribe), show a small banner instead
  // of failing silently. Tapping it re-requests permission and retries, so
  // the vendor can self-serve without DevTools.
  function hideOffBanner() {
    if (typeof document === "undefined") return;
    var el = document.getElementById("fcm-off-banner");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function showOffBanner() {
    if (typeof document === "undefined") return;
    if (document.getElementById("fcm-off-banner")) return;
    var el = document.createElement("button");
    el.id = "fcm-off-banner";
    el.type = "button";
    el.textContent = "Notifications off — tap to enable";
    el.setAttribute("style", "position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;padding:12px;border:0;border-radius:10px;background:#ff7a00;color:#fff;font-weight:700;font-size:15px;box-shadow:0 4px 14px rgba(0,0,0,.25);");
    el.addEventListener("click", function () {
      hideOffBanner();
      Notification.requestPermission()
        .then(function (permission) {
          if (permission !== "granted") {
            showOffBanner();
            return null;
          }
          return navigator.serviceWorker.ready.then(function (registration) {
            return messaging.getToken({
              vapidKey: vapidKey,
              serviceWorkerRegistration: registration,
            });
          });
        })
        .then(function (token) {
          if (!token) {
            showOffBanner();
            return null;
          }
          return registerToken(token);
        })
        .then(hideOffBanner)
        .catch(function () {
          showOffBanner();
        });
    });
    if (document.body) document.body.appendChild(el);
  }

  // Foreground delivery: the browser does not auto-display FCM messages while
  // the tab is focused. Show the same notification the background worker would,
  // reusing the payload tag so it never duplicates the socket-driven alert.
  messaging.onMessage(function (payload) {
    try {
      var data = payload.data || {};
      var notification = payload.notification || {};
      navigator.serviceWorker.ready.then(function (registration) {
        registration.showNotification(notification.title || "New Order", {
          body: notification.body || "A new order has been placed.",
          icon: notification.icon || "/icons/icon-192x192.png",
          badge: "/icons/icon-192x192.png",
          tag: data.tag || "flashfoods-order-" + (data.orderId || Date.now()),
          renotify: false,
          data: {
            click_action: data.click_action || DEFAULT_DASHBOARD,
            orderId: data.orderId || null,
          },
        });
      });
    } catch (e) {
      console.error("[FCM] foreground notification failed:", e.message);
    }
  });

  // NOTE: no onTokenRefresh handler. The bundled Firebase Messaging SDK
  // (v9+ compat) removed that callback; token rotation is handled
  // internally and getToken() below always resolves the current token, so
  // every fresh registration re-registers the live value. Calling the
  // removed method throws and would abort registration entirely.

  // Initial registration. Skip the permission prompt when this user already
  // has a registered token and permission is still granted.
  var existing = localStorage.getItem(TOKEN_KEY);
  if (existing && Notification.permission === "granted") return;

  navigator.serviceWorker.ready
    .then(function (registration) {
      console.log("[FCM] SW scope:", registration && registration.scope);
      return Notification.requestPermission().then(function (permission) {
        if (permission !== "granted") {
          showOffBanner();
          return null;
        }
        return messaging.getToken({
          vapidKey: vapidKey,
          serviceWorkerRegistration: registration,
        });
      });
    })
    .then(function (token) {
      if (!token) return null;
      return registerToken(token);
    })
    .catch(function (err) {
      console.error("[FCM] Token registration failed:", err.message);
      showOffBanner();
    });
})();
