/**
 * natrix.tools Service Worker
 * Version: natrix-tools-v2.018
 *
 * Strategy:
 * - App Shell (HTML, CSS, JS, fonts, icons): Cache-First with Stale-While-Revalidate (0ms instant startup)
 * - API Endpoints (/api/*): Network-only (no caching)
 * - Critical Invariant: Cross-Origin-Opener-Policy & Cross-Origin-Embedder-Policy headers
 *   are preserved for ffmpeg.wasm SharedArrayBuffer isolation.
 */

const CACHE_NAME = 'natrix-tools-v2.018';

const APP_SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/static/manifest.webmanifest',
  '/static/favicon.ico',
  '/static/favicon.svg',
  '/static/icon-96.png',
  '/static/icon-192.png',
  '/static/icon-512.png',
  '/static/style.css?v=2.018',
  '/static/sfx.js?v=2.0.0',
  '/static/ffmpeg/ffmpeg.js?v=1.0.2',
  '/static/ffmpeg-helper.js?v=2.018',
  '/static/dlp.js?v=2.018',
  '/static/mpeg.js?v=2.018',
  '/static/compress.js?v=2.018',
  '/static/wordlist-en.js?v=1.0.9',
  '/static/pass.js?v=2.018',
  '/static/app.js?v=2.018',
  '/static/fonts/inter-400-cyrillic-ext.woff2',
  '/static/fonts/inter-400-cyrillic.woff2',
  '/static/fonts/inter-400-latin.woff2',
  '/static/fonts/inter-500-latin.woff2',
  '/static/fonts/inter-600-latin.woff2',
  '/static/fonts/jetbrains-mono-500-latin.woff2',
  '/static/fonts/jetbrains-mono-600-latin.woff2',
  '/static/fonts/jetbrains-mono-700-latin.woff2',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        APP_SHELL_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
            console.warn('[natrix-sw] Precache item failed:', url, err);
          })
        )
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[natrix-sw] Purging old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Only process GET / HEAD requests
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return;
  }

  // 2. Bypass service worker scripts so updates are not delayed
  if (url.pathname === '/sw.js' || url.pathname === '/static/sw.js') {
    return;
  }

  // 3. Network-only for all /api/ requests
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // 4. Navigation requests (HTML document) - Cache-first with stale-while-revalidate
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('/', { ignoreSearch: true }).then((cached) => {
        const fetchPromise = fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/', clone));
          }
          return networkResponse;
        }).catch((err) => {
          console.warn('[natrix-sw] Navigation network fetch failed, using cache:', err);
          return cached;
        });

        return cached || fetchPromise;
      })
    );
    return;
  }

  // 5. Static assets - Cache-first with stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return networkResponse;
      }).catch((err) => {
        return cached;
      });

      return cached || fetchPromise;
    })
  );
});
