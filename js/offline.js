// 오프라인 저장 — 번역본 단위로 본문을 미리 받아 둔다
// 받은 본문은 sw.js 의 DATA 캐시에 들어가며, 앱을 새로 배포해도 지워지지 않는다.
import { BOOKS, VERSIONS } from "./data.js";

const DATA_CACHE = "biblenote-data-v1";   // ★ sw.js 의 DATA 와 같아야 한다
const WORKERS = 6;                        // 동시 다운로드 수

const $ = (id) => document.getElementById(id);
const bookUrl = (code, n) => `data/${code}/${n}.json`;
const absUrl = (code, n) => new URL(bookUrl(code, n), location.href).href;

// 관주도 본문과 같은 파일 모양(data/xref/{n}.json)이라 번역본 하나처럼 취급한다.
// 탭한 책은 어차피 자동으로 캐시되지만, 미리 받아 두면 안 가 본 책도 오프라인에서 뜬다.
const items = () => [...VERSIONS, { code: "xref", name: "관주" }];

const state = new Map();   // code -> { done, running, stop }
const rows = new Map();    // code -> { stat, btn }

function st(code) {
  if (!state.has(code)) state.set(code, { done: 0, running: false, stop: false });
  return state.get(code);
}

function paint(code) {
  const r = rows.get(code);
  if (!r) return;
  const s = st(code);
  const total = BOOKS.length;
  r.stat.textContent = `${s.done}/${total}권`;
  if (s.running) {
    r.btn.textContent = "중지";
    r.btn.className = "dl-btn";
  } else if (s.done >= total) {
    r.btn.textContent = "삭제";
    r.btn.className = "dl-btn del";
  } else {
    r.btn.textContent = s.done ? "이어받기" : "받기";
    r.btn.className = "dl-btn";
  }
}

async function updateTotal() {
  const el = $("dlTotal");
  try {
    const { usage } = await navigator.storage.estimate();
    el.textContent = usage ? `기기 사용 ${(usage / 1048576).toFixed(1)}MB` : "";
  } catch {
    el.textContent = "";
  }
}

// 캐시에 이미 들어 있는 책 수를 번역본별로 센다 (키를 한 번만 읽는다)
async function countAll() {
  const cache = await caches.open(DATA_CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  for (const vm of items()) {
    st(vm.code).done = BOOKS.filter((b) => have.has(absUrl(vm.code, b.n))).length;
  }
}

async function download(code) {
  const s = st(code);
  if (s.running) { s.stop = true; return; }     // 진행 중이면 중지
  s.running = true; s.stop = false;
  paint(code);

  const cache = await caches.open(DATA_CACHE);
  const todo = [];
  for (const b of BOOKS) {
    if (!(await cache.match(bookUrl(code, b.n)))) todo.push(b.n);
  }
  let i = 0;
  const worker = async () => {
    while (i < todo.length && !s.stop) {
      const n = todo[i++];
      try {
        const res = await fetch(bookUrl(code, n));
        if (res.ok) {
          await cache.put(bookUrl(code, n), res);
          s.done++;
          paint(code);
        }
      } catch { /* 네트워크 실패한 책은 건너뛴다 — 나중에 이어받기 */ }
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));

  s.running = false;
  paint(code);
  updateTotal();
}

async function remove(code) {
  const cache = await caches.open(DATA_CACHE);
  await Promise.all(BOOKS.map((b) => cache.delete(bookUrl(code, b.n))));
  st(code).done = 0;
  paint(code);
  updateTotal();
}

async function downloadAll() {
  const btn = $("dlAll");
  btn.disabled = true;
  try {
    for (const vm of items()) {          // 한 번에 한 종씩 — 요청이 몰리지 않게
      if (st(vm.code).done < BOOKS.length) await download(vm.code);
    }
  } finally {
    btn.disabled = false;
  }
}

export async function renderOffline() {
  const box = $("dlList");
  if (!box.childElementCount) {          // 목록은 한 번만 만든다
    rows.clear();
    for (const vm of items()) {
      const row = document.createElement("div");
      row.className = "dl-row";
      const name = document.createElement("span");
      name.className = "dl-name";
      name.textContent = vm.name;
      const stat = document.createElement("span");
      stat.className = "dl-stat";
      const btn = document.createElement("button");
      btn.onclick = () => (st(vm.code).done >= BOOKS.length && !st(vm.code).running)
        ? remove(vm.code)
        : download(vm.code);
      row.append(name, stat, btn);
      box.append(row);
      rows.set(vm.code, { stat, btn });
    }
    $("dlAll").onclick = downloadAll;
  }
  await countAll();
  for (const vm of items()) paint(vm.code);
  updateTotal();
}
