// ASTRO IRON — 캐시 청소 모드: 옛 서비스워커/캐시로 인한 흰 화면을 없앤다.
self.addEventListener("install", function(){ self.skipWaiting(); });
self.addEventListener("activate", function(e){
  e.waitUntil((async function(){
    try{ var keys = await caches.keys(); await Promise.all(keys.map(function(k){return caches.delete(k)})); }catch(_){}
    try{ await self.registration.unregister(); }catch(_){}
    try{ var cs = await self.clients.matchAll(); cs.forEach(function(c){ try{ c.navigate(c.url); }catch(_){} }); }catch(_){}
  })());
});
// fetch 핸들러 없음 → 항상 네트워크에서 최신 로드
