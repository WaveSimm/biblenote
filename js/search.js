// 본문 단어 검색 — 지금 보고 있는 번역본 전체에서 낱말이 든 절을 찾는다.
// 낱말을 여러 개 넣으면 그 전부를 담은 절만 나온다 ("하나님 사랑").
import { BOOKS, loadBookOnce, versionMeta, refLabel } from "./data.js";

const MAX_SHOW = 300;   // 목록에 그리는 최대 개수 (센 개수는 그대로 알려 준다)
const WINDOW = 6;       // 미리 받아 둘 책 수

const $ = (id) => document.getElementById(id);

let onPick = null;         // 결과를 고르면 부를 함수
let scope = "all";         // all | ot | nt
let curVersion = null;     // 지금 열려 있는 번역본
let shownVersion = null;   // 화면에 남아 있는 결과가 어느 번역본 것인지
let seq = 0;               // 검색 세대 — 새 검색이 시작되면 옛 검색은 스스로 멈춘다
let running = false;

/* ---------- 낱말 처리 ---------- */

const terms = (q) => q.trim().toLowerCase().split(/\s+/).filter(Boolean);

const hasAll = (lower, ts) => {
  for (const t of ts) if (!lower.includes(t)) return false;
  return true;
};

// 낱말이 나오는 자리를 모두 찾아 겹치는 것끼리 합친다
function markRanges(text, ts) {
  const lower = text.toLowerCase();
  const found = [];
  for (const t of ts) {
    let i = 0;
    while ((i = lower.indexOf(t, i)) !== -1) { found.push([i, i + t.length]); i += t.length; }
  }
  found.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of found) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

// 절이 길면 첫 일치 앞뒤만 잘라 보여 준다
function snip(text, ts) {
  if (text.length <= 150) return { text, head: "", tail: "" };
  const lower = text.toLowerCase();
  let first = Infinity;
  for (const t of ts) {
    const i = lower.indexOf(t);
    if (i >= 0 && i < first) first = i;
  }
  if (first === Infinity) first = 0;
  const start = first > 40 ? first - 30 : 0;
  const body = text.slice(start, start + 150);
  return { text: body, head: start > 0 ? "…" : "", tail: start + 150 < text.length ? "…" : "" };
}

function paintText(box, text, ts) {
  const ranges = markRanges(text, ts);
  let pos = 0;
  for (const [s, e] of ranges) {
    if (s > pos) box.append(text.slice(pos, s));
    const m = document.createElement("mark");
    m.textContent = text.slice(s, e);
    box.append(m);
    pos = e;
  }
  if (pos < text.length) box.append(text.slice(pos));
}

/* ---------- 검색 ---------- */

const inScope = (n) =>
  scope === "all" || (scope === "ot" ? BOOKS[n - 1].testament === "old" : BOOKS[n - 1].testament !== "old");

function setRunning(on) {
  running = on;
  $("findGo").textContent = on ? "중지" : "찾기";
}

function stat(msg) { $("findStat").textContent = msg; }

function addResult(ref, text, ts) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "find-item";
  const label = document.createElement("span");
  label.className = "find-ref";
  label.textContent = refLabel(ref);
  const body = document.createElement("span");
  const s = snip(text, ts);
  if (s.head) body.append(s.head);
  paintText(body, s.text, ts);
  if (s.tail) body.append(s.tail);
  btn.append(label, body);
  btn.onclick = () => onPick && onPick(ref);
  $("findResults").append(btn);
}

async function run(query) {
  const ts = terms(query);
  if (!ts.length) return;

  const my = ++seq;
  const version = curVersion;
  setRunning(true);
  $("findResults").replaceChildren();
  shownVersion = version;

  const books = [];
  for (let n = 1; n <= 66; n++) if (inScope(n)) books.push(n);

  let hits = 0, shown = 0, failed = 0, done = 0;

  // 순서대로 보여 주되 받기는 앞질러 해 둔다 (WINDOW 권)
  const ahead = new Map();
  let next = 0;
  const fill = () => {
    while (ahead.size < WINDOW && next < books.length) {
      const n = books[next++];
      ahead.set(n, loadBookOnce(version, n).catch(() => null));
    }
  };
  fill();

  for (const n of books) {
    if (my !== seq) return;                     // 새 검색이 시작됨 — 조용히 물러난다
    const p = ahead.get(n) || loadBookOnce(version, n).catch(() => null);
    ahead.delete(n);
    fill();

    const data = await p;
    done++;
    if (!data) { failed++; continue; }

    data.chapters.forEach((verses, ci) => {
      verses.forEach((t, vi) => {
        if (t == null) return;
        if (!hasAll(t.toLowerCase(), ts)) return;
        hits++;
        if (shown < MAX_SHOW) { addResult({ b: n, c: ci + 1, v: vi + 1 }, t, ts); shown++; }
      });
    });

    if (my !== seq) return;
    stat(`${done}/${books.length}권 · ${hits}곳`);
  }

  setRunning(false);
  if (hits === 0) {
    stat(failed ? "찾지 못했습니다 — 일부 책을 읽지 못했습니다(오프라인?)" : "찾지 못했습니다");
  } else {
    let msg = `${hits}곳`;
    if (hits > MAX_SHOW) msg += ` (처음 ${MAX_SHOW}곳만 표시)`;
    if (failed) msg += ` · ${failed}권은 읽지 못함`;
    stat(msg);
  }
}

/* ---------- 배선 ---------- */

export function initFind(opts) {
  onPick = opts.onPick;

  $("findForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (running) { seq++; setRunning(false); stat("중지했습니다"); return; }
    run($("findInput").value);
  });

  $("segScope").onclick = (e) => {
    const s = e.target.dataset.scope;
    if (!s || s === scope) return;
    scope = s;
    paintScope();
    if ($("findInput").value.trim()) run($("findInput").value);
  };

  $("findInput").addEventListener("input", () => {
    $("findGo").disabled = !running && !$("findInput").value.trim();
  });
}

function paintScope() {
  for (const btn of $("segScope").querySelectorAll("button"))
    btn.classList.toggle("on", btn.dataset.scope === scope);
}

export function openFind(version) {
  curVersion = version;
  $("findVer").textContent = versionMeta(version).name;
  paintScope();

  // 번역본이 바뀌었으면 앞선 결과는 더 이상 이 화면의 것이 아니다
  if (shownVersion && shownVersion !== version) {
    seq++;
    setRunning(false);
    $("findResults").replaceChildren();
    stat("");
    shownVersion = null;
  }
  $("findGo").disabled = !running && !$("findInput").value.trim();
  $("findInput").focus();
  $("findInput").select();
}
