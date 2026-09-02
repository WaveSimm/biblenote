import { initData, getBook, BOOKS, VERSIONS, bookMeta, versionMeta, refLabel } from "./data.js";
import { buildAliases, parseRef } from "./parser.js";
import { loadSettings, saveSettings, loadHistory, saveHistory } from "./store.js";
import { renderOffline } from "./offline.js";
import { initFind, openFind } from "./search.js";
import * as Notes from "./notes.js";
import { initNoteEdit, openNote, isEditing } from "./noteedit.js";
import { initVerseNotes, openVerseNotes, refreshVerseNotes } from "./versenotes.js";
import { initNotesIO, paintUsage } from "./notesio.js";

const APP_VERSION = "v39";   // ★ 배포할 때 sw.js 의 VER 과 함께 올린다 (설정 시트 오른쪽 위에 보인다)
const $ = (id) => document.getElementById(id);
let TOP_OFFSET = 72; // 상단바 아래 본문 기준선(px) — syncBarMetrics()가 실제 바 높이로 갱신

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
    this.root.addEventListener("click", (e) => {
      // 절 번호를 탭하면 어느 절이든 절 시트(노트+관주)가 열린다.
      // 문장 탭은 노트 있는 절만 — 관주는 94%의 절에 있어 문장 탭으로 열면
      // 스치기만 해도 시트가 뜬다 (관주_설계문서.md §3.1).
      const sp = e.target.closest && e.target.closest("span.v");
      if (!sp) return;
      if (!e.target.closest("sup") && !sp.classList.contains("noted")) return;
      const p = sp.closest("p.ch");
      const b = +p.dataset.b, c = +p.dataset.c, v = +sp.dataset.v;
      openVerseNotes(b, c, v, refLabel({ b, c, v }));
    });
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
      const cn = ci + 1;
      p.className = "ch" + (cn >= 100 ? " c3" : cn >= 10 ? " c2" : "");
      p.dataset.b = b;
      p.dataset.c = cn;
      verses.forEach((t, vi) => {
        const s = document.createElement("span");
        s.className = "v" + (t == null ? " miss" : "")
                          + (Notes.hasNoteAt(b, cn, vi + 1) ? " noted" : "");
        s.dataset.v = vi + 1;
        const sup = document.createElement("sup");
        sup.textContent = vi + 1;
        const text = t == null ? " " : t + " ";
        // 절 번호가 줄 끝에 혼자 남지 않도록 첫 어절(최대 5자)과 한 덩어리로 묶는다
        const sp = text.indexOf(" ");
        const cut = Math.min(sp === -1 ? text.length : sp, 5);
        const head = document.createElement("span");
        head.className = "vh";
        head.append(sup, document.createTextNode(text.slice(0, cut)));
        s.append(head, document.createTextNode(text.slice(cut)));
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
        remarkDraft();
      } finally { this.busy = false; }
    } else if (sh - st - ch < 1500 && this.loaded[this.loaded.length - 1] < 66) {
      this.busy = true;
      try {
        const b = this.loaded[this.loaded.length - 1] + 1;
        const sec = await this.buildBook(b);
        this.content.append(sec);
        this.loaded.push(b);
        this.prune("head");
        remarkDraft();
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

/* ================= 이동/히스토리 =================
   기록은 "머물렀던 자리"의 목록이고 hist.idx가 현재 자리다.
   자리를 떠나기 직전에 실제로 보고 있던 절을 그 자리에 적어 두므로,
   되돌아오면 검색하던 그 지점으로, 다시 앞으로 가면 떠나온 지점으로 온다. */
async function jumpTo(ref, opts = {}) {
  const to = { b: ref.b, c: ref.c, v: ref.v };
  if (opts.push !== false) pushHistory(to, curRef);
  curRef = to;
  await paneA.jump(to.b, to.c, to.v, { flash: true });
  if (settings.mode === "compare") await paneB.jump(to.b, to.c, to.v, { flash: true });
  updateLoc(curRef);
  addRecentBook(to.b);
  schedSavePos();
  remarkDraft();
}

const sameRef = (a, b) => !!a && !!b && a.b === b.b && a.c === b.c && a.v === b.v;

// 현재 항목에 '지금 보고 있는 절'을 적어 둔다 (삼각형 이동·스크롤한 만큼 반영)
function stampCurrent(ref) {
  const e = hist.entries[hist.idx];
  if (!e || !ref) return;
  e.b = ref.b; e.c = ref.c; e.v = ref.v;
}

function pushHistory(to, from) {
  if (!hist.entries.length) {
    // 첫 이동: 떠나온 자리를 먼저 넣어 둬야 되돌아올 곳이 생긴다
    hist.entries.push({ b: from.b, c: from.c, v: from.v, ts: Date.now() });
    hist.idx = 0;
  } else {
    stampCurrent(from);
  }
  if (sameRef(hist.entries[hist.idx], to)) {   // 제자리 이동
    saveHistory(hist);
    updateNavButtons();
    return;
  }
  hist.entries = hist.entries.slice(0, hist.idx + 1);
  hist.entries.push({ b: to.b, c: to.c, v: to.v, ts: Date.now() });
  if (hist.entries.length > 100) hist.entries.shift();
  hist.idx = hist.entries.length - 1;
  saveHistory(hist);
  updateNavButtons();
  renderHistoryList();
}

// 기록 안에서 자리 이동 (↶ ↷, 최근 이동 목록)
function moveHistory(toIdx) {
  if (toIdx < 0 || toIdx >= hist.entries.length || toIdx === hist.idx) return;
  stampCurrent(curRef);          // 떠나기 직전 위치를 남겨 둔다
  hist.idx = toIdx;
  saveHistory(hist);
  jumpTo(hist.entries[toIdx], { push: false });
  updateNavButtons();
  renderHistoryList();
}

function goHistory(delta) { moveHistory(hist.idx + delta); }

/* ---- 장/절 단위 이동 (상단 삼각형) ---- */
function stepVerse(dir) {
  let { b, c, v } = curRef;
  v += dir;
  if (v < 1) {
    c -= 1;
    if (c < 1) {
      if (b === 1) return;
      b -= 1; c = bookMeta(b).chapters;
    }
    v = bookMeta(b).vpc[c - 1];
  } else if (v > bookMeta(b).vpc[c - 1]) {
    c += 1; v = 1;
    if (c > bookMeta(b).chapters) {
      if (b === 66) return;
      b += 1; c = 1;
    }
  }
  jumpTo({ b, c, v }, { push: false });
}

function stepChapter(dir) {
  let { b, c } = curRef;
  c += dir;
  if (c < 1) {
    if (b === 1) return;
    b -= 1; c = bookMeta(b).chapters;
  } else if (c > bookMeta(b).chapters) {
    if (b === 66) return;
    b += 1; c = 1;
  }
  jumpTo({ b, c, v: 1 }, { push: false });
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
      moveHistory(i);
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

// 키보드가 가리고 남은 실제 높이. 뷰포트 meta 로 해결되는 브라우저에서는
// 이 값이 창 높이와 같아 아무 일도 하지 않는다.
function syncViewportHeight() {
  const vv = visualViewport;
  const h = vv ? vv.height : innerHeight;
  document.documentElement.style.setProperty("--vvh", h + "px");
}

// 상·하단 바의 실제 높이를 본문 여백(--topbar-h/--bottombar-h)과 기준선에 반영
function syncBarMetrics() {
  const th = $("topbar").offsetHeight;
  const bh = $("bottombar").offsetHeight;
  const root = document.documentElement.style;
  root.setProperty("--topbar-h", th + "px");
  root.setProperty("--bottombar-h", bh + "px");
  TOP_OFFSET = th + 8;
}

function updateLoc(ref) {
  // 책 이름이 길면 약칭으로 — 좁은 상단 바에서 장·절이 잘리지 않게
  const m = bookMeta(ref.b);
  const name = m.ko.length >= 5 ? m.abbr : m.ko;
  $("loc").textContent = `${name} ${ref.c}:${ref.v}`;
}

function addRecentBook(b) {
  settings.recentBooks = [b, ...settings.recentBooks.filter(x => x !== b)].slice(0, 4);
  saveSettings(settings);
}

/* ---- 작성 중인 노트의 앵커 표시 (설계문서 §7.4) ---- */
let draftMarked = [];
let draftAnchors = [];

// 본문이 다시 그려지면(이동·확장·번역본 교체) 표시가 사라지므로 다시 칠한다
function remarkDraft() { if (draftAnchors.length) markDraft(draftAnchors); }

// 노트를 저장·삭제한 뒤, 그 노트가 걸린 절들의 표시만 다시 맞춘다
// 가져오기처럼 한꺼번에 바뀔 때 — 화면에 있는 절만 다시 훑는다 (많아야 3권)
function remarkAllNoted() {
  for (const pane of [paneA, paneB]) {
    if (!pane) continue;
    for (const p of pane.content.querySelectorAll("p.ch")) {
      const b = +p.dataset.b, c = +p.dataset.c;
      for (const sp of p.children) {
        if (sp.tagName !== "SPAN") continue;
        sp.classList.toggle("noted", Notes.hasNoteAt(b, c, +sp.dataset.v));
      }
    }
  }
}

function refreshNoted(anchors) {
  refreshVerseNotes();
  for (const a of anchors || []) {
    const last = a.endV && a.endV >= a.v ? a.endV : a.v;
    for (let v = a.v; v <= last; v++) {
      for (const pane of [paneA, paneB]) {
        const el = pane && pane.findVerse(a.book, a.c, v);
        if (el) el.classList.toggle("noted", Notes.hasNoteAt(a.book, a.c, v));
      }
    }
  }
}

function markDraft(anchors) {
  draftAnchors = anchors;
  for (const el of draftMarked) el.classList.remove("draft");
  draftMarked = [];
  for (const a of anchors) {
    const last = a.endV && a.endV >= a.v ? a.endV : a.v;
    for (let v = a.v; v <= last; v++) {
      for (const pane of [paneA, paneB]) {
        const el = pane && pane.findVerse(a.book, a.c, v);
        if (el) { el.classList.add("draft"); draftMarked.push(el); }
      }
    }
  }
}

/* ================= 시트/팝오버 ================= */
const SHEETS = ["sheetSearch", "sheetFind", "sheetVerse", "sheetSettings", "verPop"];
function openSheet(el) { closeAll(); $("backdrop").hidden = false; el.hidden = false; }
function closeAll() {
  for (const id of SHEETS) $(id).hidden = true;
  $("backdrop").hidden = true;
}

/* ================= 잠깐 뜨는 알림 ================= */

let toastTimer = null;
function toast(msg, ms = 2000) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ================= 뒤로가기 ================= */
//
// 안드로이드에서 뒤로가기를 누르면 앱이 그대로 닫혔다. 읽던 자리는 저장되지만
// 시트를 열어 둔 채로 눌러도 닫혀 버려서, 노트를 쓰다 실수로 나가기 쉬웠다.
//
// 방법: 히스토리에 지킴목을 쌓아 둔다. 뒤로가기는 지킴목을 하나 무너뜨리고
// popstate 를 부르므로, 우리가 대신 "열려 있는 것 하나"를 닫는다. 더 닫을 게
// 없으면 알림만 띄운다. 남은 지킴목이 없으니 다음 한 번에 OS 가 앱을 닫는다.
//
// 언제 세우느냐가 까다롭다. 크롬은 '조작된 적 없는 문서' 가 쌓은 히스토리
// 항목을 뒤로가기에서 건너뛴다 (히스토리를 채워 못 나가게 하는 페이지를 막는
// 장치다). 그런데 건너뛸 것으로 표시되는 건 새로 쌓은 항목이 아니라 그 앞에
// 있던 항목이라, 조작 없이 한 번이라도 세우면 그 뒤로 뭘 해도 뒤로가기가
// 앱을 그대로 닫는다. 두 번 데었다:
//
//   ① 시작하자마자 세움        → 읽기 화면에서 바로 닫힘
//   ② pointerdown 에서 세움    → 조금만 스크롤해도 바로 닫힘.
//      터치는 손을 내려놓는 순간에는 아직 '조작' 으로 확정되지 않는다.
//   ③ popstate 안에서 다시 세움 → 노트를 뒤로가기로 닫은 다음 한 번 더 누르면
//      바로 닫힘. 뒤로가기로 이동한 것은 '조작' 이 아니다.
//
// 그래서 지킴목은 오직 '손을 뗀 순간'(pointerup·touchend·click·keydown)에만
// 세운다. ③ 때문에 하나만 세워서는 안 된다 — 뒤로가기로 겹을 닫고 나면 다시
// 세울 기회가 없으니, 열려 있는 겹 수 + 1 만큼 미리 쌓아 둔다.
//
// 한 번도 만지지 않고 누른 뒤로가기는 막을 수 없다 — 브라우저가 정한 선이다.
// 대신 그때는 아직 한 일이 없으니 잃을 것도 없다.

const GUARD = { biblenote: "back" };
let guards = 0;            // 지금 쌓여 있는 지킴목 수
let skipPops = 0;          // 우리가 스스로 되감은 것 — popstate 를 무시할 횟수
let exitArmed = false;
let sawInput = false;      // 손가락이 화면에 닿은 적이 있는가 (세우지는 않는다)

const activated = () => !navigator.userActivation || navigator.userActivation.hasBeenActive;

/** 뒤로가기로 닫을 수 있는 겹의 수 */
function layers() {
  let n = SHEETS.some((id) => !$(id).hidden) ? 1 : 0;
  if (!$("noteReturn").hidden) n += 2;        // 성경 보는 중 → 노트로, 그다음 노트 닫기
  else if (!$("noteView").hidden) n += 1;
  return n;
}

/** 겹 수 + 1(종료 확인용) 만큼 지킴목을 맞춘다. 반드시 조작 중에만 부른다.
 *  live: 조작이 아직 살아 있을 때만 (스크롤 중 재시도용 — 아래 설명) */
function syncGuards({ live = false } = {}) {
  if (!activated() || skipPops) return;
  if (live && navigator.userActivation && !navigator.userActivation.isActive) return;
  const want = layers() + 1;
  while (guards < want) { history.pushState(GUARD, ""); guards++; }
  if (guards > want) {                        // ✕ 로 닫아 남은 것은 조용히 걷어낸다
    const k = guards - want;
    guards = want;
    skipPops++;                               // go(-k) 는 popstate 를 한 번만 부른다
    history.go(-k);
  }
}

/** 열려 있는 것을 위에서부터 하나 닫는다. 닫았으면 true */
function backStep() {
  if (SHEETS.some((id) => !$(id).hidden)) { closeAll(); return true; }
  // 노트를 쓰다 성경 쪽을 보는 중이면 먼저 노트로 되돌린다
  if (!$("noteReturn").hidden) { $("noteReturn").click(); return true; }
  if (!$("noteView").hidden) { $("noteBack").click(); return true; }
  return false;
}

function initBackGuard() {
  addEventListener("popstate", () => {
    if (skipPops) { skipPops--; return; }     // 우리가 걷어낸 것
    if (guards > 0) guards--;
    if (backStep()) return;                   // 겹 하나를 닫았다. 지킴목은 이미 아래에 있다
    if (exitArmed) return;                    // 두 번째 — 막지 않는다 (앱이 닫힌다)
    exitArmed = true;
    toast("한 번 더 누르면 앱이 닫힙니다");
  });

  // 손을 뗀 뒤에, 그리고 그 조작의 결과(시트가 열렸는지 등)가 반영된 뒤에 맞춘다.
  // 그래서 capture 가 아니라 버블 단계다 — capture 로 달았더니 시트가 열리기 전
  // 상태를 보고 겹을 못 세어, 두 번째 뒤로가기가 그냥 앱을 닫았다.
  const onGesture = () => { exitArmed = false; syncGuards(); };
  for (const ev of ["pointerup", "touchend", "click", "keydown"])
    addEventListener(ev, onGesture, { passive: true });

  // 손을 안 떼고 길게 끌어 읽으면 그 제스처에 touchend 가 한 번뿐이라, 그때
  // 아직 조작으로 안 잡혀 있으면 기회를 통째로 놓친다 (뒤로 길게 끌 때 그랬다).
  // 그래서 지킴목이 하나도 없는 동안에는 스크롤할 때마다 다시 시도한다.
  //
  // 단, 손가락이 닿은 적이 있을 때만 — 시작할 때 마지막 위치로 옮기는 것도
  // 스크롤이라, 이 조건이 없으면 조작 없이 세워 버려 오히려 무효가 된다.
  // 조작이 아직 살아 있는 동안에만 세우는 것도 같은 이유다.
  for (const ev of ["pointerdown", "touchstart"])
    addEventListener(ev, () => { sawInput = true; }, { passive: true });
  addEventListener("scroll", () => {
    if (sawInput && guards === 0) syncGuards({ live: true });
  }, { capture: true, passive: true });
}

function openVerPop(slot, anchor) {
  closeAll();
  const pop = $("verPop");
  pop.replaceChildren();
  for (const vm of VERSIONS) {
    const code = vm.code;
    const btn = document.createElement("button");
    btn.className = "chip" + ((slot === "A" ? settings.verA : settings.verB) === code ? " on" : "");
    btn.textContent = vm.name;
    btn.onclick = async () => {
      closeAll();
      try {
        if (slot === "A") { settings.verA = code; await paneA.setVersion(code); }
        else { settings.verB = code; await paneB.setVersion(code); }
      } catch (err) { console.error(err); }
      saveSettings(settings);
      updateChips();
    };
    pop.append(btn);
  }
  $("backdrop").hidden = false;
  pop.hidden = false;
  const r = anchor.getBoundingClientRect();
  if (r.bottom + 6 + pop.offsetHeight <= innerHeight - 8) {
    pop.style.top = (r.bottom + 6) + "px";
    pop.style.bottom = "";
  } else {
    pop.style.bottom = (innerHeight - r.top + 6) + "px";
    pop.style.top = "";
  }
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
  $("searchNote").addEventListener("click", () => {
    if (!parsed) return;
    closeAll();
    openNote({ ref: parsed, label: refLabel(parsed, { abbr: true }).replace(" ", "") });
    input.value = "";
    preview.innerHTML = "&nbsp;";
    go.disabled = true;
    $("searchNote").disabled = true;
    parsed = null;
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
const LH = ["1.2", "1.5", "1.8", "2.0"];     // 줄간격 120 / 150 / 180 / 200 %

function applySettings() {
  document.documentElement.style.setProperty("--fs", FS[settings.fontSize]);
  document.documentElement.style.setProperty("--lh", LH[settings.lineHeight]);
  document.body.classList.toggle("serif", settings.face === "serif");
  document.body.classList.toggle("novnum", !settings.vnum);
  document.body.classList.toggle("chmarks", settings.chmarks);
  document.body.classList.toggle("vbreaks", settings.vbreak);
  $("btnVBreak").classList.toggle("on", settings.vbreak);
  applyTheme();
  syncSegs();
}

// 조판이 바뀌면 본문 높이가 달라지므로 읽던 절로 다시 맞춘다
function refitToCurrent() {
  paneA.scrollToVerse(curRef.b, curRef.c, curRef.v);
  if (settings.mode === "compare") paneB.scrollToVerse(curRef.b, curRef.c, curRef.v);
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
  mark("segLine", "lh", settings.lineHeight);
  mark("segTheme", "theme", settings.theme);
  mark("segFace", "face", settings.face);
  mark("segVnum", "vnum", settings.vnum ? 1 : 0);
  mark("segChmark", "chmark", settings.chmarks ? 1 : 0);
}

function wireSettings() {
  $("segFont").onclick = (e) => { if (e.target.dataset.fs) { settings.fontSize = +e.target.dataset.fs; done(); } };
  $("segLine").onclick = (e) => { if (e.target.dataset.lh) { settings.lineHeight = +e.target.dataset.lh; done(); } };
  $("segTheme").onclick = (e) => { if (e.target.dataset.theme) { settings.theme = e.target.dataset.theme; done(); } };
  $("segFace").onclick = (e) => { if (e.target.dataset.face) { settings.face = e.target.dataset.face; done(); } };
  $("segVnum").onclick = (e) => { if (e.target.dataset.vnum) { settings.vnum = e.target.dataset.vnum === "1"; done(); } };
  $("segChmark").onclick = (e) => { if (e.target.dataset.chmark) { settings.chmarks = e.target.dataset.chmark === "1"; done(); } };
  function done() { saveSettings(settings); applySettings(); refitToCurrent(); }
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
  syncBarMetrics();
  paneA.scrollToVerse(curRef.b, curRef.c, curRef.v);
}

/* ================= 초기화 ================= */
async function main() {
  initBackGuard();          // 첫 터치를 놓치지 않게 데이터를 읽기 전에 건다
  await initData();
  buildAliases(BOOKS);
  settings = loadSettings();
  hist = loadHistory();
  curRef = settings.pos || { b: 1, c: 1, v: 1 };

  applySettings();
  wireSearch();
  wireSettings();
  // 검색 결과를 고르면 그 절로 이동한다 (히스토리에도 남는다)
  initFind({
    onPick: (ref) => { closeAll(); jumpTo(ref); },
    onOpenNote: (id) => { closeAll(); openNote({ id }); },
  });
  Notes.initNotes(BOOKS);
  // v36 이전에 노트 아이콘만 눌러도 저장되던 껍데기를 한 번 걷어낸다.
  // 조용히 지우면 "내 노트가 없어졌나" 싶으니 한 번은 알린다.
  if (Notes.prunedStubs()) toast(`빈 노트 ${Notes.prunedStubs()}개를 정리했습니다`, 3000);
  initNoteEdit({
    jumpBible: (ref) => jumpTo(ref, { push: false }),
    markDraft,
    onSaved: refreshNoted,
    openNoteList: () => { openSheet($("sheetFind")); openFind(active.version, { tab: "note" }); },
  });
  initVerseNotes({
    openSheet, closeAll,
    openNote: (o) => openNote(o),
    jump: (ref) => { closeAll(); jumpTo(ref); },     // 관주 탭 → 이동, 뒤로가기로 복귀
    version: () => active.version,                   // 미리보기는 지금 읽는 번역본으로
  });
  initNotesIO({ onImported: remarkAllNoted });

  syncViewportHeight();
  if (window.visualViewport) {
    visualViewport.addEventListener("resize", syncViewportHeight);
    visualViewport.addEventListener("scroll", syncViewportHeight);
  }
  addEventListener("resize", syncViewportHeight);

  paneA = new Pane($("paneA"), settings.verA);
  paneB = new Pane($("paneB"), settings.verB);
  active = paneA;
  updateChips();
  syncBarMetrics();
  $("appVer").textContent = APP_VERSION;

  // 바 버튼
  $("chipA").onclick = (e) => openVerPop("A", e.currentTarget);
  $("chipB").onclick = (e) => openVerPop("B", e.currentTarget);
  $("btnCompare").onclick = () => setCompare(settings.mode !== "compare");
  $("btnVBreak").onclick = () => {
    settings.vbreak = !settings.vbreak;
    saveSettings(settings);
    applySettings();
    refitToCurrent();
  };
  $("btnBack").onclick = () => goHistory(-1);
  $("btnFwd").onclick = () => goHistory(1);
  $("loc").onclick = () => {
    renderHistoryList();
    renderBookGrid();
    openSheet($("sheetSearch"));
  };
  $("btnPrevCh").onclick = () => stepChapter(-1);
  $("btnNextCh").onclick = () => stepChapter(1);
  $("btnPrevV").onclick = () => stepVerse(-1);
  $("btnNextV").onclick = () => stepVerse(1);
  $("btnFind").onclick = () => { openSheet($("sheetFind")); openFind(active.version); };
  // 성경을 읽다가 적고 싶어질 때 — 지금 보고 있는 절이 본문이 된다
  $("btnNote").onclick = () => {
    const ref = active.topRef() || curRef;
    openNote({ ref, label: refLabel(ref, { abbr: true }).replace(" ", "") });
  };
  $("btnSettings").onclick = () => { syncSegs(); openSheet($("sheetSettings")); renderOffline(); paintUsage(); };
  $("backdrop").onclick = closeAll;
  // 닫기 단추가 어떤 이유로든 안 눌릴 때를 대비한 탈출구
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });
  for (const btn of document.querySelectorAll("[data-close]")) btn.onclick = closeAll;

  // 화면 회전/크기 변경 시 현재 절 위치 유지
  let resizeTimer;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      syncBarMetrics();
      paneA.scrollToVerse(curRef.b, curRef.c, curRef.v);
      if (settings.mode === "compare") paneB.scrollToVerse(curRef.b, curRef.c, curRef.v);
    }, 250);
  });

  // 마지막 위치 복원
  await jumpTo(curRef, { push: false });
  if (settings.mode === "compare") await setCompare(true);
  updateNavButtons();

  // PWA — 새 버전이 활성화되면 그 자리에서 한 번 새로 고쳐 반영한다
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloading) return;   // 최초 설치 때는 새로고침하지 않는다
      reloading = true;
      location.reload();
    });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
      .then((reg) => reg.update())               // 실행할 때마다 새 버전 확인
      .catch(() => {});
  }
}

main();
