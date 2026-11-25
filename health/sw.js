const CACHE_NAME = 'snap-health-web-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icon.svg',
  './js/storage.js',
  './js/speech.js',
  './js/ai-vision.js',
  './js/chart-and-share.js',
  './js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
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

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Never cache API calls or external origins
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((res) => {
        if (res && res.status === 200 && event.request.method === 'GET') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return res;
      });
    })
  );
});
