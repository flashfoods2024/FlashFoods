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

async function flush(rounds = 20) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

// Poll-wait for an async condition (timers + promise chains) instead of
// hoping a fixed flush count suffices under parallel-test load.
async function waitFor(fn, tries = 200) {
  for (let i = 0; i < tries; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.ok(fn(), "condition never became true");
}

async function runClient({ permission = "granted", storedToken = null, messagingExtra = {}, getTokenImpl = null, serviceWorkerImpl = null, failPost = null, noBody = false } = {}) {
  const fetchCalls = [];
  const logLines = [];
  const localStorage = memoryStorage();
  if (storedToken) localStorage.setItem("fcm_token:vendor-1", storedToken);

  // Minimal document stub for the offline banner path.
  const elements = {};
  const docHandlers = {};
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
  const bodyObj = {
      appendChild: (el) => {
        if (el.id) elements[el.id] = el;
        el.parentNode = bodyObj;
      },
      removeChild: (el) => {
        if (el.id && elements[el.id] === el) delete elements[el.id];
        el.parentNode = null;
        return el;
      },
    };
  const documentStub = {
    getElementById: (id) => elements[id] || null,
    createElement: () => makeEl(),
    addEventListener: (ev, fn) => void (docHandlers[ev] = fn),
    removeEventListener: (ev) => void delete docHandlers[ev],
    // Test hook: fire a DOM event (e.g. DOMContentLoaded for late mount).
    __fire: (ev) => docHandlers[ev] && docHandlers[ev](),
    // Test hook: simulate <head> execution (no body yet), then parsing done.
    __setBody: () => void (documentStub.body = bodyObj),
    body: noBody ? null : bodyObj,
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
    console: { error: () => {}, log: (m) => void logLines.push(String(m)), warn: () => {} },
    localStorage,
    document: documentStub,
    setTimeout,
    clearTimeout,
    fetch: (url, init) => {
      fetchCalls.push({ url, body: init?.body });
      const regPosts = fetchCalls.filter((c) => c.url === "/api/fcm/register").length;
      if (url === "/api/fcm/register" && (failPost === "always" || (failPost === "once" && regPosts === 1))) {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve({ ok: true });
    },
    Notification: {
      permission,
      requestPermission: () => Promise.resolve(permission),
    },
    navigator: {
      userAgent: "test-agent",
      serviceWorker: serviceWorkerImpl || {
        ready: Promise.resolve({ scope: "https://x.test/" }),
        getRegistration: () => Promise.resolve({ scope: "https://x.test/", active: {}, installing: null, waiting: null }),
        register: () => Promise.resolve({ scope: "https://x.test/", active: {}, installing: null, waiting: null }),
      },
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
    __FCM_REGISTER_RETRY_MS__: 0,
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
  return { thrown, fetchCalls, localStorage, getTokenCalls, onMessageHandler, banner, windowRef: sandbox.window, logLines, document: documentStub };
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

test("cached token + granted permission re-registers (self-heal, no skip)", async () => {
  const { thrown, getTokenCalls, fetchCalls, localStorage, logLines } = await runClient({ storedToken: "cached-token" });
  assert.equal(thrown, null);
  assert.equal(getTokenCalls, 1, "every app open refreshes the binding");
  const regs = fetchCalls.filter((c) => c.url === "/api/fcm/register");
  assert.equal(regs.length, 1, "idempotent upsert keeps lastSeenAt fresh");
  assert.equal(localStorage.getItem("fcm_token:vendor-1"), "fresh-fcm-token");
  assert.ok(
    logLines.some((l) => l.includes("[FCM] auto-register role=vendor token=fresh-fc")),
    `expected auto-register log, got: ${JSON.stringify(logLines)}`,
  );
});

test("window.__FCM_RETRY__ re-runs registration on demand (opt-in card hook)", async () => {
  const ctx = await runClient();
  assert.equal(ctx.thrown, null);
  assert.equal(typeof ctx.windowRef.__FCM_RETRY__, "function");
  const before = ctx.fetchCalls.filter((c) => c.url === "/api/fcm/register").length;
  await ctx.windowRef.__FCM_RETRY__();
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
  const after = ctx.fetchCalls.filter((c) => c.url === "/api/fcm/register").length;
  assert.equal(after, before + 1, "manual retry must register exactly once more");
});

test("getToken failure registers nothing and shows no banner", async () => {
  const failure = new Error("Registration failed - push service error");
  const ctx = await runClient({ getTokenImpl: () => Promise.reject(failure) });
  assert.equal(ctx.thrown, null);
  assert.equal(ctx.banner, null, "retired banner must never mount");
  assert.equal(
    ctx.fetchCalls.filter((c) => c.url === "/api/fcm/register").length,
    0,
    "no registration POST on failure",
  );
});

test("manual retry via __FCM_RETRY__ recovers after a getToken failure", async () => {
  let attempts = 0;
  const ctx = await runClient({
    getTokenImpl: () => (++attempts === 1
      ? Promise.reject(new Error("Registration failed - push service error"))
      : Promise.resolve("recovered-token")),
  });
  assert.equal(ctx.banner, null, "retired banner must never mount");
  await ctx.windowRef.__FCM_RETRY__();
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
  const regs = ctx.fetchCalls.filter((c) => c.url === "/api/fcm/register");
  assert.equal(regs.length, 1, "manual retry must register exactly once");
  assert.equal(JSON.parse(regs[0].body).token, "recovered-token");
});

test("subscribe waits for SW activation: getToken runs only after activated", async () => {
  // Simulates the proven laptop failure: a registration exists but no
  // worker is active yet (installing). getToken/subscribe must not run
  // until the worker fires activated — otherwise the browser throws
  // "Subscription failed - no active Service Worker".
  const listeners = {};
  const worker = {
    state: "installing",
    addEventListener: (ev, fn) => void (listeners[ev] = fn),
  };
  const reg = { scope: "https://x.test/", active: null, installing: worker, waiting: null };
  let getTokenCalls = 0;
  const ctx = await runClient({
    permission: "granted",
    getTokenImpl: () => {
      getTokenCalls += 1;
      assert.equal(worker.state, "activated", "getToken must not run before activation");
      return Promise.resolve("post-activation-token");
    },
    serviceWorkerImpl: {
      ready: Promise.resolve(reg),
      getRegistration: () => Promise.resolve(reg),
      register: () => Promise.resolve(reg),
    },
  });
  assert.equal(ctx.thrown, null);
  assert.equal(getTokenCalls, 0, "getToken must wait while worker is installing");
  // Flip the worker live and flush: registration must now proceed.
  worker.state = "activated";
  reg.active = {};
  listeners.statechange({ target: worker });
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
  assert.equal(getTokenCalls, 1, "getToken runs exactly once after activation");
  const regs = ctx.fetchCalls.filter((c) => c.url === "/api/fcm/register");
  assert.equal(regs.length, 1);
  assert.equal(JSON.parse(regs[0].body).token, "post-activation-token");
});

test("no banner is injected when the script runs in <head> (no body yet)", async () => {
  const ctx = await runClient({ permission: "denied", noBody: true });
  assert.equal(ctx.thrown, null);
  assert.equal(ctx.document.getElementById("fcm-off-banner"), null, "nothing injected without a body");
  ctx.document.__setBody();
  ctx.document.__fire("DOMContentLoaded");
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  assert.equal(ctx.document.getElementById("fcm-off-banner"), null, "retired banner must never mount");
});

test("denied permission subscribes to nothing and shows no banner", async () => {
  const ctx = await runClient({ permission: "denied" });
  assert.equal(ctx.thrown, null);
  assert.equal(ctx.getTokenCalls, 0, "never prompts or subscribes when denied");
  assert.equal(ctx.banner, null, "no banner when permission is not granted");
  await ctx.windowRef.__FCM_RETRY__();
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
  assert.equal(ctx.getTokenCalls, 0, "retry while denied still never subscribes");
  assert.equal(ctx.banner, null, "retry while denied shows no banner");
});

test("failed register POST retries once after delay, then succeeds silently", async () => {
  const ctx = await runClient({ failPost: "once" });
  assert.equal(ctx.thrown, null);
  await waitFor(() => ctx.fetchCalls.filter((c) => c.url === "/api/fcm/register").length === 2);
  assert.equal(ctx.localStorage.getItem("fcm_token:vendor-1"), "fresh-fcm-token");
  assert.equal(ctx.banner, null, "no banner when the retry succeeds");
});

test("register POST failing twice retries once and shows no banner", async () => {
  const ctx = await runClient({ failPost: "always" });
  assert.equal(ctx.thrown, null);
  await waitFor(() => ctx.fetchCalls.filter((c) => c.url === "/api/fcm/register").length === 2);
  assert.equal(
    ctx.fetchCalls.filter((c) => c.url === "/api/fcm/register").length,
    2,
    "exactly one retry, then give up silently",
  );
  assert.equal(ctx.document.getElementById("fcm-off-banner"), null, "retired banner must never mount");
});
