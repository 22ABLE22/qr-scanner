/* qr-scanner service worker.
   Strategy: precache the shell and the fast decoder; cache the WebAssembly engine the first
   time a hard image pulls it in. Bump CACHE when any asset changes. */
const CACHE = 'qr-scanner-v7';
const SHELL = [
  './',
  './index.html',
  './privacy.html',
  './404.html',
  './app.js',
  './assets/geist.woff2',
  './assets/favicon.svg',
  './vendor/jsQR.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // cache first for code and fonts, network only for documents on first load
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        // refresh in the background for the next visit
        event.waitUntil(
          fetch(req).then((res) => {
            if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res));
          }).catch(() => {})
        );
        return hit;
      }
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => {
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});
