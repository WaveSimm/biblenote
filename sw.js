// BibleNote Service Worker — 앱 셸 + 성경 데이터 오프라인 캐시
const VER = "biblenote-v6";
const SHELL = [
  "./", "index.html", "css/app.css",
  "js/main.js", "js/data.js", "js/parser.js", "js/store.js",
  "data/books.json", "data/versions.json",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VER).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // 성경 본문/폰트: cache-first (불변 데이터)
  const cacheFirst = url.pathname.includes("/data/") ||
    url.hostname.includes("fonts.googleapis.com") || url.hostname.includes("fonts.gstatic.com");

  if (cacheFirst) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit ||
        fetch(e.request).then((res) => {
          if (res.ok || res.type === "opaque") {
            const clone = res.clone();
            caches.open(VER).then((c) => c.put(e.request, clone));
          }
          return res;
        })
      )
    );
    return;
  }

  // 앱 셸: 네트워크 우선, 실패 시 캐시 (업데이트 반영 + 오프라인 동작)
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request).then((res) => {
        const clone = res.clone();
        caches.open(VER).then((c) => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
  }
});
