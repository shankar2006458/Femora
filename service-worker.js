/* ============================================================================
   Femora — Service Worker
   Handles offline caching + auto-update.
   ========================================================================== */

const CACHE_VERSION = 'femora-v1';
const RUNTIME_CACHE = 'femora-runtime-v1';

/* Everything the app needs to boot offline. */
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  // Vendored CDN assets — precache so first offline load works
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/lucide@latest/dist/umd/lucide.js',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=Inter:wght@300;400;500;600;700&display=swap'
];

/* ---------------- Install: precache app shell ---------------- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE_URLS).catch(() => {
        // If a CDN asset fails (network blip), still let install succeed
        // for the local files — they're what really matter for offline boot.
        return cache.addAll(['./', './index.html', './manifest.json']);
      }))
      .then(() => self.skipWaiting())
  );
});

/* ---------------- Activate: clean old caches ---------------- */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_VERSION && k !== RUNTIME_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---------------- Fetch: cache strategies ---------------- */
self.addEventListener('fetch', event => {
  const req = event.request;

  // Only GET requests can be served from cache
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Skip non-http(s) schemes
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Navigation requests → network-first, fallback to cached shell
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // Google Fonts CSS → network-first, cache for offline
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(cache =>
        fetch(req)
          .then(res => { cache.put(req, res.clone()); return res; })
          .catch(() => cache.match(req).then(r => r || new Response('', { status: 504 })))
      )
    );
    return;
  }

  // Everything else (Tailwind, Lucide, local assets) → cache-first
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req)
        .then(res => {
          // Cache successful same-origin + known CDN responses
          if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          // Offline fallback for images can be added here if desired
          return new Response('', { status: 504, statusText: 'Offline' });
        });
    })
  );
});

/* ---------------- Messages (e.g. force-update from page) ---------------- */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});