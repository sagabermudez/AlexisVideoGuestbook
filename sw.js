/* =================================================================
   THE GUESTBOOK — sw.js
   Minimal service worker that caches the app shell (HTML/CSS/JS) so
   the kiosk keeps working if Chrome ever loses its network connection
   between events. Recordings themselves live in IndexedDB, not here.
   ================================================================= */

const CACHE_NAME = 'guestbook-shell-v2';
const SHELL_FILES = [
  './', './index.html', './style.css', './script.js',
  './manifest.json', './icon-192.png', './icon-512.png', './icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first for the app shell; network requests otherwise fall back
// to whatever the browser already has cached.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).catch(() => cached))
  );
});
