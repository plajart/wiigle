// 포인트 관리 프로그램 — 최소 서비스워커.
// 포인트 잔액 같은 실시간 데이터가 걸려있으므로 API/페이지는 캐싱하지 않고 항상 네트워크로 보낸다.
// 아이콘/매니페스트 같은 정적 자산만 캐시해서 "홈 화면에 추가" 설치 조건을 만족시키는 용도.
const CACHE = "pm-static-v1";
const STATIC_ASSETS = ["/icon.svg", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
  }
  // 그 외(페이지/API)는 서비스워커가 손대지 않고 그대로 네트워크로 통과시킨다.
});
