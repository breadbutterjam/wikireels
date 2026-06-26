/* sw.js — Service Worker
   Scope: cache the app shell (HTML/CSS/JS/icons) so the app
   itself opens reliably offline. Wikipedia content still
   requires network — this is intentional for now (see
   roadmap: downloadable articles for true offline reading). */

const CACHE_VERSION = 'rh-shell-v2';

/* Files that make up the app shell — everything needed for the
   app to boot and render its chrome, even with no network. */
const SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './api.js',
  './store.js',
  './categories.js',
  './gestures.js',
  './settings.js',
  './search.js',
  './today.js',
  './date-feed.js',
  './curated.js',
  './curated-feed.js',
  './auth.js',
  './sync.js',
  './profile.js',
  './firebase-config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

/* ── Install: pre-cache the app shell ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('SW install cache error:', err))
  );
});

/* ── Activate: clean up old cache versions ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_VERSION)
            .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch strategy ──
   App shell files: cache-first (instant load, app always opens)
   Everything else (Wikipedia API, Firestore, images): network-first,
   falling back to cache only if previously cached — we are NOT
   trying to cache arbitrary Wikipedia content yet. */
self.addEventListener('fetch', event => {
  const { request } = event;

  /* Only handle GET requests — never intercept POST/PUT (Firestore writes etc) */
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (isSameOrigin) {
    /* App shell — cache-first */
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          /* Cache newly-seen same-origin files opportunistically */
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(request, clone));
          }
          return response;
        }).catch(() => caches.match('./index.html'));
      })
    );
  } else {
    /* External (Wikipedia, Firebase, etc) — network-first, no offline
       guarantee. This is where "download articles for offline" will
       hook in later. */
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
  }
});
