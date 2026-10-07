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
  var role = REGISTER_URL.indexOf("/student/") !== -1 ? "student" : "vendor";

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

  // Retry delay for a failed register POST (test override, else 10s).
  var REGISTER_RETRY_MS =
    typeof window !== "undefined" && window.__FCM_REGISTER_RETRY_MS__ != null
      ? window.__FCM_REGISTER_RETRY_MS__
      : 10000;

  function tokenPrefix(value) {
    return String(value || "").slice(0, 8);
  }

  // Persist a (possibly refreshed) token, releasing the previous one first.
  // Registration POSTs on EVERY app open (idempotent server upsert that
  // refreshes lastSeenAt), so a rotated token heals itself without the user
  // tapping anything. A failed POST retries once, then surfaces the banner.
  function registerToken(token, attempt) {
    if (!token) return Promise.resolve();
    attempt = attempt || 0;
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
          console.log(
            "[FCM] auto-register role=" + role + " token=" + tokenPrefix(token),
          );
          hideOffBanner();
        } else if (attempt < 1) {
          return new Promise(function (resolve) {
            setTimeout(function () {
              resolve(registerToken(token, attempt + 1));
            }, REGISTER_RETRY_MS);
          });
        } else {
          showOffBanner();
        }
      })
      .catch(function () {
        if (attempt < 1) {
          return new Promise(function (resolve) {
            setTimeout(function () {
              resolve(registerToken(token, attempt + 1));
            }, REGISTER_RETRY_MS);
          });
        }
        showOffBanner();
      });
  }

  var messaging = firebase.messaging();

  // Push subscribe fails with "no active Service Worker" when getToken()
  // runs before a worker has activated (fresh profile, worker still
  // installing/waiting, or registrations just cleared). Every subscribe path
  // below goes through here first. The app's single worker is /sw.js
  // (registered by update-manager.js); no second worker is introduced so
  // update/version management keeps working.
  function ensureServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return Promise.reject(new Error("no-sw"));
    }
    var container = navigator.serviceWorker;
    function withRegistration(reg) {
      if (!reg) {
        return container.register("/sw.js", { scope: "/" }).then(withRegistration);
      }
      console.log("[FCM] SW registered scope=" + reg.scope);
      var pending = reg.active ? null : reg.installing || reg.waiting;
      if (!pending) {
        console.log("[FCM] SW active");
        return Promise.resolve(reg);
      }
      return new Promise(function (resolve) {
        pending.addEventListener("statechange", function (e) {
          if (e.target.state === "activated") {
            console.log("[FCM] SW active");
            resolve(reg);
          }
        });
      });
    }
    try {
      var lookup = typeof container.getRegistration === "function"
        ? container.getRegistration("/")
        : Promise.resolve(null);
      return Promise.resolve(lookup).then(withRegistration).then(function (reg) {
        // Belt-and-braces: ready only fulfills with an active worker.
        return container.ready.then(function () {
          return reg;
        });
      });
    } catch (err) {
      return container.ready;
    }
  }

  function getTokenWithSW() {
    return ensureServiceWorker().then(function (registration) {
      console.log("[FCM] getToken called");
      return messaging.getToken({
        vapidKey: vapidKey,
        serviceWorkerRegistration: registration,
      });
    });
  }

  // Manual retry used by the banner and by in-page opt-in cards
  // (e.g. student home "Turn on order updates"). Re-runs the full
  // permission → subscribe → register chain on demand.
  function retryRegistration() {
    return ensureServiceWorker()
      .then(function () {
        return Notification.requestPermission();
      })
      .then(function (permission) {
        if (permission !== "granted") {
          hideOffBanner();
          return null;
        }
        return getTokenWithSW();
      })
      .then(function (token) {
        if (!token) {
          showOffBanner(true);
          return null;
        }
        return registerToken(token);
      })
      .then(hideOffBanner)
      .catch(function () {
        showOffBanner(true);
      });
  }

  if (typeof window !== "undefined") {
    window.__FCM_RETRY__ = retryRegistration;
  }

  // Removes a previously mounted banner, if any (e.g. rendered by an older
  // cached copy of this script). The banner itself is permanently retired.
  function hideOffBanner() {
    if (typeof document === "undefined") return;
    var el = document.getElementById("fcm-off-banner");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // The in-app "Notifications off" banner was permanently removed — it
  // overlapped the bottom navigation. This is a no-op kept so the existing
  // call sites stay valid; permission is requested via native flows
  // (in-page opt-in cards through window.__FCM_RETRY__).
  function showOffBanner() {
    return;
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

  // Auto-register on every app open while permission is granted: silent and
  // idempotent (the server upsert refreshes lastSeenAt), so a rotated or
  // server-pruned token heals itself with zero taps. Permission is never
  // requested unasked here — the in-page opt-in cards own the ask.
  if (Notification.permission === "granted") {
    getTokenWithSW()
      .then(function (token) {
        if (!token) return null;
        return registerToken(token);
      })
      .catch(function (err) {
        console.error("[FCM] Token registration failed:", err && err.message);
        showOffBanner(true);
      });
  } else {
    showOffBanner();
  }
})();
