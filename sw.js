/* 童趣星球 Service Worker */
/* v5：混合策略，解決「操作頓頓的」問題。
   - 網頁本體(HTML/導覽)：網路優先 → 更新仍會自動生效，不會卡舊版。
   - 音檔/圖片/程式等靜態資源：快取優先 → 載過一次就存起來，之後點了立刻反應，不必每次連網。
   靜態資源若內容改了(同檔名)，升 CACHE 版本即可強制更新。 */
var CACHE = 'tongqu-v5';
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

/* 取用策略(混合):
   - 導覽/HTML：網路優先(回最新網頁，離線退回快取/首頁) → 更新即時生效。
   - 其他靜態資源(音檔/圖片/JS/CSS)：快取優先(命中就秒回，沒有才連網並存起來) → 操作順暢。 */
function isHtml(req) {
  if (req.mode === 'navigate') return true;
  var a = req.headers.get('accept') || '';
  return a.indexOf('text/html') !== -1;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; /* 跨網域(氣象 API、字型等)交給瀏覽器 */

  if (isHtml(req)) {
    /* 網頁本體：網路優先 */
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
    );
    return;
  }

  /* 靜態資源：快取優先 */
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
