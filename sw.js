// BibleNote Service Worker
// 캐시를 둘로 나눈다 —
//   VER  : 앱 셸(HTML/JS/CSS). 배포마다 새로 만들고 옛것은 지운다.
//   DATA : 성경 본문·폰트. 내용이 변하지 않으므로 배포와 무관하게 계속 남긴다.
//          (한 번 받은 책은 다시 내려받지 않는다)
const VER = "biblenote-v32";
const DATA = "biblenote-data-v1";
const SHELL = [
  "./", "index.html", "css/app.css",
  "js/main.js", "js/data.js", "js/parser.js", "js/store.js", "js/offline.js", "js/search.js",
  "js/noteref.js", "js/notes.js", "js/noteedit.js", "js/versenotes.js", "js/notesio.js", "js/notelist.js",
  "data/books.json", "data/versions.json",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
];

const isData = (url) =>
  url.pathname.includes("/data/") ||
  url.hostname.includes("fonts.googleapis.com") ||
  url.hostname.includes("fonts.gstatic.com");

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

// 옛 캐시를 지우기 전에, 이미 받아 둔 성경 본문을 DATA 로 옮겨 살린다
async function rescueData() {
  const data = await caches.open(DATA);
  for (const key of await caches.keys()) {
    if (key === DATA || key === VER) continue;
    const old = await caches.open(key);
    for (const req of await old.keys()) {
      if (!isData(new URL(req.url))) continue;
      if (await data.match(req)) continue;
      const res = await old.match(req);
      if (res) await data.put(req, res);
    }
  }
}

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    try { await rescueData(); } catch { /* 옮기지 못해도 진행 */ }
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VER && k !== DATA).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // 성경 본문·폰트: cache-first (불변 데이터) — 한 번 받으면 다시 받지 않는다
  if (isData(url)) {
    e.respondWith((async () => {
      const hit = await caches.match(e.request);   // DATA·셸 어디에 있든 재사용
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === "opaque") {
        const clone = res.clone();
        caches.open(DATA).then((c) => c.put(e.request, clone));
      }
      return res;
    })());
    return;
  }

  // 앱 셸: 네트워크 우선, 실패 시 캐시 (업데이트 반영 + 오프라인 동작)
  // GitHub Pages 가 max-age=600 을 주므로 cache:"reload" 로 브라우저 HTTP 캐시를
  // 건너뛴다. 이게 없으면 배포 후 10분 동안 옛 파일이 그대로 돌아온다.
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      for (const init of [{ cache: "reload" }, null]) {
        try {
          const res = init ? await fetch(e.request, init) : await fetch(e.request);
          const clone = res.clone();
          caches.open(VER).then((c) => c.put(e.request, clone));
          return res;
        } catch { /* 다음 방법으로 */ }
      }
      return (await caches.match(e.request, { ignoreSearch: true })) || Response.error();
    })());
  }
});
