// =============================================================================
// Flash Foods — Service Worker
// Purpose: Unlock standalone PWA install (Android Chrome requirement).
//          Cache only stable static assets. No offline support.
// =============================================================================
// Version — bump on every deploy to trigger SW update
// TODO: automate injection during deployment (prestart script)
const CACHE_VERSION = 'v3';
const STATIC_CACHE = `flashfoods-static-${CACHE_VERSION}`;

// Only stable shell assets — NO JS, NO audio, NO HTML, NO API
const PRECACHE = [
  '/styles.css',
  '/food-placeholder.svg',
  '/background-image.png',
  '/images/canteen-bg.png',
  '/fonts/Transcity-DEMO.otf',
  '/icon.png',
  '/icons/icon-192x192.png',
  '/manifest.json',
];

// ---- Install ----------------------------------------------------------------
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)),
  );
});

// ---- Activate / cleanup -----------------------------------------------------
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => clients.claim()),
  );
});

// ---- Fetch ------------------------------------------------------------------
self.addEventListener('fetch', (e) => {
  const { request: req } = e;

  // Bypass — never intercept these
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req));
    return;
  }
  if (new URL(req.url).pathname.startsWith('/socket.io/')) return;

  // Cache-first for precached assets; everything else goes network-only
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});

// -----------------------------------------------------------------------------
// Development unregister: open DevTools → Console and run:
//   navigator.serviceWorker.getRegistrations().then(r => r.forEach(r => r.unregister()))
// Then hard-reload (Cmd/Ctrl+Shift+R) to clear all caches.
// -----------------------------------------------------------------------------
