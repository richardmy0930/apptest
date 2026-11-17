/* 童趣星球 Service Worker */
/* v4：全部改「網路優先」—— 線上一律抓最新(HTML、音檔、圖示都是),抓不到才用離線快取。
   這樣每次更新都會立刻生效,不會再卡在舊版;離線時仍可用之前存的內容。 */
var CACHE = 'tongqu-v4';
var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    })
  );
});

/* 啟用時清掉所有舊版快取(含 v1/v2/v3),立即接管所有分頁 */
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* 取用策略:同源 GET 一律「網路優先」。
   連得到網路 → 回最新,並順手更新快取;
   連不到(離線)→ 回快取;導覽類再退回首頁。 */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; /* 跨網域(氣象 API、字型等)交給瀏覽器 */

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});
