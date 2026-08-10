import { initData, getBook, BOOKS, VERSIONS, bookMeta, versionMeta, refLabel } from "./data.js";
import { buildAliases, parseRef } from "./parser.js";
import { loadSettings, saveSettings, loadHistory, saveHistory } from "./store.js";

const $ = (id) => document.getElementById(id);
const TOP_OFFSET = 72; // 상단바 아래 본문 기준선(px)

let settings, hist;
let paneA, paneB, active;
let curRef = { b: 1, c: 1, v: 1 };
let savePosTimer = null;

/* ================= Pane ================= */
class Pane {
  constructor(rootEl, version) {
    this.root = rootEl;
    this.content = rootEl.querySelector(".content");
    this.version = version;
    this.loaded = [];        // 연속 로드된 책 번호
    this.busy = false;
    this.suppressUntil = 0;
    this._raf = false;
    this._lastST = 0;
    this.root.addEventListener("scroll", () => this.onScroll(), { passive: true });
    for (const ev of ["pointerdown", "wheel", "touchstart"])
      this.root.addEventListener(ev, () => { active = this; }, { passive: true });
  }

  async buildBook(b) {
    const data = await getBook(this.version, b);
    const meta = bookMeta(b);
    const sec = document.createElement("section");
    sec.className = "book";
    sec.dataset.b = b;
    const h = document.createElement("h2");
    h.className = "bk";
    h.textContent = versionMeta(this.version).lang === "en" ? meta.en : meta.ko;
    sec.append(h);
    data.chapters.forEach((verses, ci) => {
      const p = document.createElement("p");
      p.className = "ch";
      p.dataset.b = b;
      p.dataset.c = ci + 1;
      verses.forEach((t, vi) => {
        const s = document.createElement("span");
        s.className = "v" + (t == null ? " miss" : "");
        s.dataset.v = vi + 1;
        const sup = document.createElement("sup");
        sup.textContent = vi + 1;
        s.append(sup, document.createTextNode(t == null ? " " : t + " "));
        p.append(s);
      });
      sec.append(p);
    });
    return sec;
  }

  findVerse(b, c, v) {
    return this.content.querySelector(
      `p.ch[data-b="${b}"][data-c="${c}"] span.v[data-v="${v}"]`);
  }

  scrollToVerse(b, c, v, { flash = false } = {}) {
    const span = this.findVerse(b, c, v);
    if (!span) return false;
    const delta = span.getBoundingClientRect().top - this.root.getBoundingClientRect().top - TOP_OFFSET;
    this.suppressUntil = performance.now() + 250;
    this.root.scrollTop += delta;
    if (flash) {
      span.classList.remove("flash");
      void span.offsetWidth;
      span.classList.add("flash");
    }
    return true;
  }

  async jump(b, c, v, opts = {}) {
    if (!this.loaded.includes(b)) {
      this.busy = true;
      try {
        const sec = await this.buildBook(b);
        this.content.replaceChildren(sec);
        this.loaded = [b];
      } finally { this.busy = false; }
    }
    this.scrollToVerse(b, c, v, opts);
  }

  async setVersion(code) {
    const anchor = (this === active && this.topRef()) || curRef;
    this.version = code;
    this.loaded = [];
    this.content.replaceChildren();
    await this.jump(anchor.b, anchor.c, anchor.v);
  }

  // 현재 화면 최상단에 보이는 절
  topRef() {
    const base = this.root.getBoundingClientRect().top + TOP_OFFSET;
    let target = null;
    for (const p of this.content.querySelectorAll("p.ch")) {
      if (p.getBoundingClientRect().bottom > base) { target = p; break; }
    }
    if (!target) return null;
    const b = +target.dataset.b, c = +target.dataset.c;
    for (const s of target.children) {
      if (s.tagName === "SPAN" && s.getBoundingClientRect().bottom > base)
        return { b, c, v: +s.dataset.v };
    }
    return { b, c, v: 1 };
  }

  async maybeExtend() {
    if (this.busy || !this.loaded.length) return;
    const st = this.root.scrollTop, sh = this.root.scrollHeight, ch = this.root.clientHeight;
    if (st < 1500 && this.loaded[0] > 1) {
      this.busy = true;
      try {
        const b = this.loaded[0] - 1;
        const sec = await this.buildBook(b);
        const prev = this.root.scrollHeight;
        this.content.prepend(sec);
        this.loaded.unshift(b);
        this.suppressUntil = performance.now() + 250;
        this.root.scrollTop += this.root.scrollHeight - prev;
        this.prune("tail");
      } finally { this.busy = false; }
    } else if (sh - st - ch < 1500 && this.loaded[this.loaded.length - 1] < 66) {
      this.busy = true;
      try {
        const b = this.loaded[this.loaded.length - 1] + 1;
        const sec = await this.buildBook(b);
        this.content.append(sec);
        this.loaded.push(b);
        this.prune("head");
      } finally { this.busy = false; }
    }
  }

  prune(side) {
    while (this.loaded.length > 3) {
      if (side === "head") {
        const sec = this.content.querySelector(`section.book[data-b="${this.loaded[0]}"]`);
        if (!sec) break;
        const h = sec.offsetHeight;
        sec.remove();
        this.loaded.shift();
        this.suppressUntil = performance.now() + 250;
        this.root.scrollTop -= h;
      } else {
        const sec = this.content.querySelector(`section.book[data-b="${this.loaded[this.loaded.length - 1]}"]`);
        if (!sec) break;
        sec.remove();
        this.loaded.pop();
      }
    }
  }

  onScroll() {
    if (this._raf) return;
    this._raf = true;
    requestAnimationFrame(() => {
      this._raf = false;
      const suppressed = performance.now() < this.suppressUntil;
      if (!suppressed) handleBars(this);
      this.maybeExtend();
      if (suppressed || this !== active) return;
      const ref = this.topRef();
      if (!ref) return;
      curRef = ref;
      updateLoc(ref);
      schedSavePos();
      if (settings.mode === "compare") syncOther(this, ref);
    });
  }
}

/* ================= 동기 스크롤 ================= */
async function syncOther(pane, ref) {
  const other = pane === paneA ? paneB : paneA;
  if (other.root.hidden || other.busy) return;
  if (!other.loaded.includes(ref.b)) {
    await other.jump(ref.b, ref.c, ref.v);
    return;
  }
  // 같은 절이 없으면(합절 등) 가장 가까운 이전 절로
  let v = ref.v;
  while (v > 1 && !other.findVerse(ref.b, ref.c, v)) v--;
  other.scrollToVerse(ref.b, ref.c, v);
}

/* ================= 이동/히스토리 ================= */
async function jumpTo(ref, opts = {}) {
  curRef = { b: ref.b, c: ref.c, v: ref.v };
  await paneA.jump(ref.b, ref.c, ref.v, { flash: true });
  if (settings.mode === "compare") await paneB.jump(ref.b, ref.c, ref.v, { flash: true });
  updateLoc(curRef);
  addRecentBook(ref.b);
  if (opts.push !== false) pushHistory(curRef, opts.query);
  schedSavePos();
  document.body.classList.remove("bars-hidden");
}

function pushHistory(ref, query) {
  const last = hist.entries[hist.idx];
  if (last && last.b === ref.b && last.c === ref.c && last.v === ref.v) return;
  hist.entries = hist.entries.slice(0, hist.idx + 1);
  hist.entries.push({ b: ref.b, c: ref.c, v: ref.v, ts: Date.now() });
  if (hist.entries.length > 100) hist.entries.shift();
  hist.idx = hist.entries.length - 1;
  saveHistory(hist);
  updateNavButtons();
  renderHistoryList();
}

function goHistory(delta) {
  const ni = hist.idx + delta;
  if (ni < 0 || ni >= hist.entries.length) return;
  hist.idx = ni;
  saveHistory(hist);
  jumpTo(hist.entries[ni], { push: false });
  updateNavButtons();
}

function updateNavButtons() {
  $("btnBack").disabled = hist.idx <= 0;
  $("btnFwd").disabled = hist.idx >= hist.entries.length - 1;
}

function renderHistoryList() {
  const box = $("historyList");
  box.replaceChildren();
  const items = hist.entries.map((e, i) => ({ e, i })).slice(-20).reverse();
  for (const { e, i } of items) {
    const btn = document.createElement("button");
    btn.textContent = refLabel(e, { abbr: true });
    if (i === hist.idx) btn.style.fontWeight = "700";
    btn.onclick = () => {
      hist.idx = i;
      saveHistory(hist);
      jumpTo(e, { push: false });
      updateNavButtons();
      closeAll();
    };
    box.append(btn);
  }
}

/* ================= 위치 저장 ================= */
function schedSavePos() {
  clearTimeout(savePosTimer);
  savePosTimer = setTimeout(() => {
    const ref = (paneA === active && paneA.topRef()) || curRef;
    settings.pos = ref;
    saveSettings(settings);
  }, 800);
}

function updateLoc(ref) {
  $("loc").textContent = refLabel(ref);
}

function addRecentBook(b) {
  settings.recentBooks = [b, ...settings.recentBooks.filter(x => x !== b)].slice(0, 4);
  saveSettings(settings);
}

/* ================= 상/하단 바 ================= */
function handleBars(pane) {
  const st = pane.root.scrollTop;
  const d = st - pane._lastST;
  pane._lastST = st;
  if (st < 60) { document.body.classList.remove("bars-hidden"); return; }
  if (d > 10) document.body.classList.add("bars-hidden");
  else if (d < -10) document.body.classList.remove("bars-hidden");
}

/* ================= 시트/팝오버 ================= */
function openSheet(el) { closeAll(); $("backdrop").hidden = false; el.hidden = false; }
function closeAll() {
  for (const id of ["sheetBooks", "sheetSearch", "sheetSettings", "verPop"]) $(id).hidden = true;
  $("backdrop").hidden = true;
}

function openVerPop(slot, anchor) {
  const pop = $("verPop");
  pop.replaceChildren();
  for (const code of settings.favorites) {
    const vm = versionMeta(code);
    if (!vm) continue;
    const btn = document.createElement("button");
    btn.className = "chip" + ((slot === "A" ? settings.verA : settings.verB) === code ? " on" : "");
    btn.textContent = vm.name;
    btn.onclick = async () => {
      if (slot === "A") { settings.verA = code; await paneA.setVersion(code); }
      else { settings.verB = code; await paneB.setVersion(code); }
      saveSettings(settings);
      updateChips();
      closeAll();
    };
    pop.append(btn);
  }
  $("backdrop").hidden = false;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  pop.style.top = (r.bottom + 6) + "px";
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + "px";
}

function updateChips() {
  $("chipA").textContent = versionMeta(settings.verA).short + " ▾";
  $("chipB").textContent = versionMeta(settings.verB).short + " ▾";
}

/* ---- 책·장 선택 ---- */
function renderBookGrid() {
  const grid = $("bookGrid");
  grid.replaceChildren();
  $("chapGrid").hidden = true;
  grid.hidden = false;
  $("sheetBooksTitle").textContent = "책 선택";
  for (const bk of BOOKS) {
    const btn = document.createElement("button");
    btn.textContent = bk.abbr;
    btn.title = bk.ko;
    btn.className = (bk.testament === "old" ? "ot" : "nt") + (bk.n === curRef.b ? " cur" : "");
    btn.onclick = () => renderChapGrid(bk.n);
    grid.append(btn);
  }
  const recent = $("recentBooks");
  recent.replaceChildren();
  for (const b of settings.recentBooks) {
    const btn = document.createElement("button");
    btn.textContent = bookMeta(b).ko;
    btn.onclick = () => renderChapGrid(b);
    recent.append(btn);
  }
}

function renderChapGrid(b) {
  const meta = bookMeta(b);
  $("sheetBooksTitle").textContent = meta.ko + " — 장 선택";
  $("bookGrid").hidden = true;
  const grid = $("chapGrid");
  grid.replaceChildren();
  grid.hidden = false;
  const back = document.createElement("button");
  back.textContent = "←";
  back.onclick = renderBookGrid;
  grid.append(back);
  for (let c = 1; c <= meta.chapters; c++) {
    const btn = document.createElement("button");
    btn.textContent = c;
    if (b === curRef.b && c === curRef.c) btn.className = "cur";
    btn.onclick = () => { closeAll(); jumpTo({ b, c, v: 1 }); };
    grid.append(btn);
  }
}

/* ---- 검색 ---- */
function wireSearch() {
  const input = $("searchInput");
  const preview = $("searchPreview");
  const go = $("searchGo");
  let parsed = null;
  input.addEventListener("input", () => {
    parsed = parseRef(input.value, BOOKS);
    preview.textContent = parsed ? "→ " + refLabel(parsed) : " ";
    go.disabled = !parsed;
  });
  $("searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!parsed) return;
    closeAll();
    jumpTo(parsed, { query: input.value.trim() });
    input.value = "";
    preview.innerHTML = "&nbsp;";
    go.disabled = true;
    parsed = null;
  });
}

/* ---- 설정 ---- */
const FS = ["15px", "17px", "19px", "21.5px", "24px"];

function applySettings() {
  document.documentElement.style.setProperty("--fs", FS[settings.fontSize]);
  document.body.classList.toggle("serif", settings.face === "serif");
  document.body.classList.toggle("novnum", !settings.vnum);
  document.body.classList.toggle("chmarks", settings.chmarks);
  applyTheme();
  syncSegs();
}

function applyTheme() {
  const t = settings.theme === "auto"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : settings.theme;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')
    .setAttribute("content", t === "dark" ? "#17181c" : "#faf8f4");
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (settings?.theme === "auto") applyTheme();
});

function syncSegs() {
  const mark = (segId, attr, val) => {
    for (const btn of $(segId).querySelectorAll("button"))
      btn.classList.toggle("on", btn.dataset[attr] === String(val));
  };
  mark("segFont", "fs", settings.fontSize);
  mark("segTheme", "theme", settings.theme);
  mark("segFace", "face", settings.face);
  mark("segVnum", "vnum", settings.vnum ? 1 : 0);
  mark("segChmark", "chmark", settings.chmarks ? 1 : 0);
}

function wireSettings() {
  $("segFont").onclick = (e) => { if (e.target.dataset.fs) { settings.fontSize = +e.target.dataset.fs; done(); } };
  $("segTheme").onclick = (e) => { if (e.target.dataset.theme) { settings.theme = e.target.dataset.theme; done(); } };
  $("segFace").onclick = (e) => { if (e.target.dataset.face) { settings.face = e.target.dataset.face; done(); } };
  $("segVnum").onclick = (e) => { if (e.target.dataset.vnum) { settings.vnum = e.target.dataset.vnum === "1"; done(); } };
  $("segChmark").onclick = (e) => { if (e.target.dataset.chmark) { settings.chmarks = e.target.dataset.chmark === "1"; done(); } };
  function done() { saveSettings(settings); applySettings(); }
}

function renderFavList() {
  const box = $("favList");
  box.replaceChildren();
  for (const vm of VERSIONS) {
    const btn = document.createElement("button");
    btn.className = "chip" + (settings.favorites.includes(vm.code) ? " on" : "");
    btn.textContent = vm.name;
    btn.onclick = () => {
      const i = settings.favorites.indexOf(vm.code);
      if (i >= 0) {
        if (settings.favorites.length <= 1) return;
        settings.favorites.splice(i, 1);
      } else {
        if (settings.favorites.length >= 4) return;
        settings.favorites.push(vm.code);
      }
      saveSettings(settings);
      renderFavList();
    };
    box.append(btn);
  }
}

/* ---- 비교 모드 ---- */
async function setCompare(on) {
  settings.mode = on ? "compare" : "single";
  saveSettings(settings);
  document.body.classList.toggle("compare", on);
  $("paneB").hidden = !on;
  $("chipB").hidden = !on;
  $("btnCompare").classList.toggle("on", on);
  if (on) {
    if (!paneB.loaded.length || paneB.version !== settings.verB) {
      paneB.version = settings.verB;
      paneB.loaded = [];
      paneB.content.replaceChildren();
    }
    await paneB.jump(curRef.b, curRef.c, curRef.v);
  }
  // 레이아웃 변경 후 pane A 위치 재조정
  paneA.scrollToVerse(curRef.b, curRef.c, curRef.v);
}

/* ================= 초기화 ================= */
async function main() {
  await initData();
  buildAliases(BOOKS);
  settings = loadSettings();
  hist = loadHistory();
  curRef = settings.pos || { b: 1, c: 1, v: 1 };

  applySettings();
  wireSearch();
  wireSettings();

  paneA = new Pane($("paneA"), settings.verA);
  paneB = new Pane($("paneB"), settings.verB);
  active = paneA;
  updateChips();

  // 바 버튼
  $("chipA").onclick = (e) => openVerPop("A", e.currentTarget);
  $("chipB").onclick = (e) => openVerPop("B", e.currentTarget);
  $("btnCompare").onclick = () => setCompare(settings.mode !== "compare");
  $("btnBack").onclick = () => goHistory(-1);
  $("btnFwd").onclick = () => goHistory(1);
  $("btnBooks").onclick = () => { renderBookGrid(); openSheet($("sheetBooks")); };
  $("btnSearch").onclick = () => {
    renderHistoryList();
    openSheet($("sheetSearch"));
    setTimeout(() => $("searchInput").focus(), 80);
  };
  $("btnSettings").onclick = () => { renderFavList(); syncSegs(); openSheet($("sheetSettings")); };
  $("backdrop").onclick = closeAll;
  for (const btn of document.querySelectorAll("[data-close]")) btn.onclick = closeAll;

  // 본문 탭 → 바 토글
  $("panes").addEventListener("click", () => {
    if (String(getSelection())) return;
    document.body.classList.toggle("bars-hidden");
  });

  // 마지막 위치 복원
  await jumpTo(curRef, { push: false });
  if (settings.mode === "compare") await setCompare(true);
  updateNavButtons();

  // PWA
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

main();
