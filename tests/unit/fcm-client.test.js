import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression: the vendored Firebase Messaging SDK (v9+ compat) removed
// `messaging.onTokenRefresh`. Calling it threw a synchronous TypeError that
// aborted firebase-client.js BEFORE the initial token registration ran, so
// vendors silently never registered for push. These tests execute the real
// file with a messaging stub shaped like the loaded SDK (no onTokenRefresh)
// and prove init completes and registration proceeds.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = fs.readFileSync(
  path.join(__dirname, "..", "..", "public", "js", "firebase-client.js"),
  "utf8",
);

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

async function runClient({ permission = "granted", storedToken = null, messagingExtra = {}, getTokenImpl = null } = {}) {
  const fetchCalls = [];
  const localStorage = memoryStorage();
  if (storedToken) localStorage.setItem("fcm_token:vendor-1", storedToken);

  // Minimal document stub for the offline banner path.
  const elements = {};
  function makeEl() {
    const handlers = {};
    const el = {
      id: "",
      textContent: "",
      style: {},
      parentNode: null,
      setAttribute: () => {},
      addEventListener: (ev, fn) => void (handlers[ev] = fn),
      click: () => handlers.click && handlers.click(),
    };
    return el;
  }
  const documentStub = {
    getElementById: (id) => elements[id] || null,
    createElement: () => makeEl(),
    body: {
      appendChild: (el) => {
        if (el.id) elements[el.id] = el;
        el.parentNode = documentStub.body;
      },
      removeChild: (el) => {
        if (el.id && elements[el.id] === el) delete elements[el.id];
        el.parentNode = null;
        return el;
      },
    },
  };

  let onMessageHandler = null;
  let getTokenCalls = 0;
  const messaging = {
    // NOTE: deliberately no onTokenRefresh — mirrors the loaded v9+ compat SDK.
    onMessage: (fn) => void (onMessageHandler = fn),
    getToken: () => {
      getTokenCalls += 1;
      return getTokenImpl ? getTokenImpl() : Promise.resolve("fresh-fcm-token");
    },
    ...messagingExtra,
  };

  const sandbox = {
    console: { error: () => {}, log: () => {}, warn: () => {} },
    localStorage,
    document: documentStub,
    fetch: (url, init) => {
      fetchCalls.push({ url, body: init?.body });
      return Promise.resolve({ ok: true });
    },
    Notification: {
      permission,
      requestPermission: () => Promise.resolve(permission),
    },
    navigator: {
      userAgent: "test-agent",
      serviceWorker: { ready: Promise.resolve({}) },
    },
    firebase: {
      apps: [],
      initializeApp: () => ({}),
      messaging: () => messaging,
    },
  };
  sandbox.window = {
    __FIREBASE_CONFIG__: { apiKey: "x", vapidKey: "vkey" },
    __FCM_USER_ID__: "vendor-1",
    // The client probes capabilities on `window`.
    Notification: sandbox.Notification,
    navigator: sandbox.navigator,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  let thrown = null;
  try {
    vm.runInContext(CLIENT_SRC, sandbox, { filename: "firebase-client.js" });
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  } catch (err) {
    thrown = err;
  }
  const banner = sandbox.document.getElementById("fcm-off-banner");
  return { thrown, fetchCalls, localStorage, getTokenCalls, onMessageHandler, banner };
}

test("init completes without TypeError on SDKs lacking onTokenRefresh", async () => {
  const { thrown } = await runClient();
  assert.equal(thrown, null, thrown ? `threw: ${thrown.message}` : "unexpected throw");
});

test("fresh registration calls getToken and POSTs the token to the register endpoint", async () => {
  const { thrown, fetchCalls, localStorage, getTokenCalls } = await runClient();
  assert.equal(thrown, null);
  assert.equal(getTokenCalls, 1);
  const reg = fetchCalls.find((c) => c.url === "/api/fcm/register");
  assert.ok(reg, `expected register POST, got: ${JSON.stringify(fetchCalls)}`);
  assert.equal(JSON.parse(reg.body).token, "fresh-fcm-token");
  assert.equal(localStorage.getItem("fcm_token:vendor-1"), "fresh-fcm-token");
});

test("foreground onMessage handler is still registered", async () => {
  const { thrown, onMessageHandler } = await runClient();
  assert.equal(thrown, null);
  assert.equal(typeof onMessageHandler, "function");
});

test("cached token + granted permission still skips re-registration", async () => {
  const { thrown, getTokenCalls, fetchCalls } = await runClient({ storedToken: "cached-token" });
  assert.equal(thrown, null);
  assert.equal(getTokenCalls, 0);
  assert.equal(fetchCalls.length, 0);
});

test("getToken failure shows the offline banner instead of failing silently", async () => {
  const failure = new Error("Registration failed - push service error");
  const ctx = await runClient({ getTokenImpl: () => Promise.reject(failure) });
  assert.equal(ctx.thrown, null);
  assert.ok(ctx.banner, "expected #fcm-off-banner to be shown");
  assert.match(ctx.banner.textContent, /Notifications off/);
  assert.equal(
    ctx.fetchCalls.filter((c) => c.url === "/api/fcm/register").length,
    0,
    "no registration POST on failure",
  );
});

test("tapping the banner retries permission + getToken and registers", async () => {
  let attempts = 0;
  const ctx = await runClient({
    getTokenImpl: () => (++attempts === 1
      ? Promise.reject(new Error("Registration failed - push service error"))
      : Promise.resolve("recovered-token")),
  });
  assert.ok(ctx.banner, "expected banner after first failure");
  ctx.banner.click();
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
  const regs = ctx.fetchCalls.filter((c) => c.url === "/api/fcm/register");
  assert.equal(regs.length, 1, "banner tap must retry registration exactly once");
  assert.equal(JSON.parse(regs[0].body).token, "recovered-token");
});
