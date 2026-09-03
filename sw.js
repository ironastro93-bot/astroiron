// ASTRO IRON — 안전 설치용 SW: HTML은 절대 캐시하지 않음(네트워크 우선), 오프라인 시에만 폴백.
// 과거 '흰 화면(stale cache)' 원인이었던 앱 HTML/JS 캐싱을 하지 않는다.
const OFFLINE = "/offline.html";
const CACHE = "astro-offline-v2";
self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.add(OFFLINE); }).catch(function () {}));
});
self.addEventListener("activate", function (e) {
  e.waitUntil((async function () {
    try { var ks = await caches.keys(); await Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); } catch (_) {}
    try { await self.clients.claim(); } catch (_) {}
  })());
});
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  // 페이지 이동(HTML)은 항상 네트워크에서 최신으로. 오프라인일 때만 offline.html.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(function () { return caches.match(OFFLINE); }));
    return;
  }
  // 그 외 자원은 통과(캐시하지 않음 → stale 위험 0)
});
