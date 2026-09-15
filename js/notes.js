// 설교노트 저장소 — localStorage + 메모리 색인
//
// 왜 localStorage 인가: 실제 노트 294개를 재보니 180K자(한도의 3.6%)였고,
// 연 60개씩 20년 더 쌓아도 18%다. 그리고 성경을 스크롤하는 내내
// "이 절에 노트가 있나?" 를 물어야 하는데, IndexedDB 는 비동기라 그 자리에서
// 답할 수 없다. 여기서는 시작할 때 통째로 읽어 메모리에 색인을 만들어 둔다.
//
// 색인은 절 하나하나에 건다. 앵커가 롬8:28-30 이면 28·29·30 세 자리에 모두
// 걸어야 29절을 읽을 때도 노트가 뜬다.
//
// 지운 노트는 흔적(tombstone)을 남긴다 — 다른 기기와 합칠 때 되살아나지 않게
// (설교노트 설계 §12.4). 흔적은 노트 배열과 따로 두어 목록·색인·검색은 모른다.

import { buildNoteRefs, resolveAnchors } from "./noteref.js";

const KEY = "biblenote.notes.v1";
const GONE_KEY = "biblenote.notes.gone.v1";
const GONE_KEEP = 180 * 24 * 3600 * 1000;   // 흔적은 180일 뒤 버린다 — 그보다 오래 안 켠 기기는 드물다

let notes = [];                  // Note[]
let byId = new Map();
let byVerse = new Map();         // "b:c:v" -> Note[]
let gone = new Map();            // id -> deletedAt (지운 노트의 흔적)
let listener = null;             // 로컬에서 노트가 바뀌면 부른다 (드라이브 동기화)

const vkey = (b, c, v) => `${b}:${c}:${v}`;
const uid = () => "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// 최근 날짜가 앞으로. 같은 날이면 나중에 만든 것이 앞.
//
// 같을 때 0 을 돌려주는 것이 중요하다. 전에는 `a.date < b.date ? 1 : -1` 이라
// 같은 날짜에도 늘 -1 을 주어 두 원소를 바꿔 물어도 같은 답을 내놓았다.
// 모순된 비교 함수라 정렬 결과가 그때그때 달라졌고, 같은 날 노트가 셋이 되자
// 엉뚱한 자리로 밀려 목록(앞 200개)에서 사라지곤 했다.
const byNewest = (a, b) => {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.createdAt || 0) - (a.createdAt || 0);
};

/* ---------- 색인 ---------- */

function indexNote(n) {
  for (const a of n.anchors || []) {
    const last = a.endV && a.endV >= a.v ? a.endV : a.v;
    for (let v = a.v; v <= last; v++) {
      const k = vkey(a.book, a.c, v);
      let arr = byVerse.get(k);
      if (!arr) byVerse.set(k, (arr = []));
      if (!arr.includes(n)) arr.push(n);
    }
  }
}

function reindex() {
  byId = new Map();
  byVerse = new Map();
  for (const n of notes) { byId.set(n.id, n); indexNote(n); }
  // 각 절의 노트는 최근 것이 위로
  for (const arr of byVerse.values()) arr.sort(byNewest);
}

/* ---------- 읽기·쓰기 ---------- */

// 노트 아이콘을 눌렀다 그냥 닫기만 해도 저장되던 시절(v36 이전)에 쌓인 껍데기.
// 본문이 '참조 한 줄' 뿐이고 제목·태그·설교자가 없는 것만 골라 지운다.
// 실제 노트 294개를 훑어보니 이 모양인 것은 하나도 없었다 — 안전하다.
let lastPruned = 0;
export const prunedStubs = () => lastPruned;

// 설교자는 세지 않는다 — 새 노트를 열면 자주 나온 사람이 미리 채워지므로
// 사용자가 쓴 것이라는 증거가 못 된다.
function isStub(n) {
  if (n.imported || n.title || (n.tags && n.tags.length)) return false;
  const raw = n.body || "";
  if (!raw.trim()) return true;                    // 아예 빈 것
  if (raw.trim().includes("\n")) return false;     // 두 줄 이상이면 뭔가 썼다
  const a = (n.anchors || [])[0];
  if (!a) return false;
  // 그 한 줄이 통째로 참조뿐인가 ('창1:1 ')
  return raw.slice(0, a.start).trim() === "" && raw.slice(a.end).trim() === "";
}

function pruneStubs() {
  const before = notes.length;
  const now = Date.now();
  notes = notes.filter((n) => {
    if (!isStub(n)) return true;
    gone.set(n.id, now);
    return false;
  });
  lastPruned = before - notes.length;
  return lastPruned;
}

export function initNotes(books) {
  buildNoteRefs(books);
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    notes = Array.isArray(raw) ? raw : [];
  } catch {
    notes = [];
  }
  gone = readGone();
  for (const n of notes) if (!n.anchors) refresh(n);
  if (pruneStubs()) persist({ quiet: true });
  reindex();
  return notes.length;
}

function readGone() {
  try {
    const raw = JSON.parse(localStorage.getItem(GONE_KEY) || "{}");
    return new Map(Object.entries(raw).filter(([, t]) => Date.now() - t < GONE_KEEP));
  } catch {
    return new Map();
  }
}

function persist({ quiet = false } = {}) {
  try {
    localStorage.setItem(KEY, JSON.stringify(notes));
    localStorage.setItem(GONE_KEY, JSON.stringify(Object.fromEntries(gone)));
    if (!quiet && listener) listener();
    return true;
  } catch (e) {
    // 한도를 넘었거나 사생활 모드 — 조용히 실패하면 안 되는 유일한 곳이다
    console.error("노트 저장 실패", e);
    return false;
  }
}

/** 본문 텍스트에서 앵커를 다시 계산해 노트에 채운다 */
export function refresh(note) {
  note.anchors = resolveAnchors(note.body || "");
  const first = note.anchors[0];
  note.passage = first
    ? { book: first.book, c: first.c, v: first.v, endV: first.endV, label: first.label }
    : null;
  return note;
}

export function all() { return notes; }
export function get(id) { return byId.get(id) || null; }

/** 그 절에 걸린 노트들 (최근 것이 앞) */
export function notesAt(b, c, v) { return byVerse.get(vkey(b, c, v)) || []; }

/** 노트가 하나라도 걸린 절인가 — 읽기 화면에서 절마다 묻는다 */
export function hasNoteAt(b, c, v) { return byVerse.has(vkey(b, c, v)); }

/** 한 장에서 노트가 걸린 절 번호들 — 화면을 그릴 때 한 번에 받아 간다 */
export function versesWithNotes(b, c) {
  const out = new Set();
  const prefix = `${b}:${c}:`;
  for (const k of byVerse.keys()) if (k.startsWith(prefix)) out.add(+k.slice(prefix.length));
  return out;
}

export function put(note) {
  if (!note.id) note.id = uid();
  refresh(note);
  note.updatedAt = Date.now();
  if (!note.createdAt) note.createdAt = note.updatedAt;
  gone.delete(note.id);
  const i = notes.findIndex((x) => x.id === note.id);
  if (i >= 0) notes[i] = note; else notes.push(note);
  notes.sort(byNewest);
  reindex();
  persist();
  return note;
}

export function remove(id) {
  const i = notes.findIndex((x) => x.id === id);
  if (i < 0) return false;
  notes.splice(i, 1);
  gone.set(id, Date.now());
  reindex();
  persist();
  return true;
}

/** 제목·본문·설교자·시리즈·태그에서 낱말 찾기 (모두 포함하는 것만) */
export function search(query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return notes.filter((n) => {
    const hay = [n.title, n.body, n.preacher, n.series, (n.tags || []).join(" ")]
      .join("\n").toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

/* ---------- 가져오기·내보내기 ---------- */

/** 들어온 노트를 저장소 모양으로 — 앵커를 다시 계산하고 빠진 필드를 채운다 */
function adopt(raw, imported) {
  const n = { ...raw };
  if (!n.id) n.id = uid();          // id 는 부르는 쪽에서 정해 오는 게 낫다 (다시 가져와도 늘지 않게)
  // createdAt 이 있으면 앱을 거친 노트다(내보내기 왕복) — 제 플래그를 믿는다.
  // 없으면 도구가 만든 마이그레이션 파일이라 여기서 옮겨온 표시를 단다.
  if (imported && !n.createdAt) n.imported = true;
  if (typeof n.body !== "string") n.body = (n.body || []).join("\n");
  refresh(n);
  n.createdAt = n.createdAt || Date.parse(n.date) || Date.now();
  n.updatedAt = n.updatedAt || n.createdAt;
  return n;
}

// 한 id 의 상태: { note, t } (살아 있음, t = updatedAt) 또는 { dead: true, t } (지움, t = deletedAt)
const later = (x, y) => (!x ? y : !y ? x : y.t > x.t ? y : x);   // 같으면 앞(이쪽)이 이긴다
const same = (x, y) => !!x && !!y && x.t === y.t && !!x.dead === !!y.dead;

/**
 * 다른 곳(파일·드라이브)에서 온 노트·흔적을 합친다. 규칙은 하나 —
 * 같은 id 끼리는 나중에 바뀐 쪽이 이긴다 (노트는 updatedAt, 흔적은 deletedAt).
 * 지운 뒤에 다른 기기에서 고쳤다면 고친 쪽이 살아난다.
 *
 *   incoming : { notes: Note[], gone: { id: deletedAt } }
 *   skip     : 건드리지 않을 id — 지금 편집 중인 노트 (쓰는 도중 글자가 바뀌면 안 된다)
 *   imported : createdAt 없는 노트에 '옮겨온 노트' 표시를 단다 (마이그레이션 파일)
 *   quiet    : 바뀜 알림을 부르지 않는다 (동기화가 스스로 부른 합치기)
 *
 * 돌려주는 값 { added, updated, removed, behind }
 *   behind = 합친 결과가 들어온 것과 다르다 — 저쪽(드라이브)에 다시 올려야 한다
 */
export function merge(incoming, { skip = null, imported = false, quiet = false } = {}) {
  const now = Date.now();
  const theirs = new Map();
  for (const raw of incoming.notes || []) {
    if (!raw) continue;
    const n = adopt(raw, imported);
    theirs.set(n.id, later(theirs.get(n.id), { note: n, t: n.updatedAt }));
  }
  for (const [id, t] of Object.entries(incoming.gone || {}))
    if (now - t < GONE_KEEP) theirs.set(id, later(theirs.get(id), { dead: true, t }));

  const r = { added: 0, updated: 0, removed: 0, behind: false };
  let goneChanged = false;
  const ids = new Set([...byId.keys(), ...gone.keys(), ...theirs.keys()]);
  for (const id of ids) {
    const mn = byId.get(id);
    const mine = later(mn && { note: mn, t: mn.updatedAt }, gone.has(id) ? { dead: true, t: gone.get(id) } : null);
    const their = theirs.get(id);
    const win = id === skip && mine ? mine : later(mine, their);
    if (!same(win, their)) r.behind = true;
    if (win === mine || same(win, mine)) {
      // 이쪽이 이겼다. 흔적과 노트가 둘 다 있던 id 라면 진 쪽을 치운다.
      if (win.dead && mn) { notes.splice(notes.indexOf(mn), 1); byId.delete(id); r.removed++; }
      if (!win.dead && gone.delete(id)) goneChanged = true;
      continue;
    }
    if (win.dead) {
      if (mn) { notes.splice(notes.indexOf(mn), 1); byId.delete(id); r.removed++; }
      gone.set(id, win.t);
      goneChanged = true;
    } else {
      if (mn) { notes[notes.indexOf(mn)] = win.note; r.updated++; }
      else { notes.push(win.note); r.added++; }
      byId.set(id, win.note);
      gone.delete(id);
    }
  }

  if (r.added || r.updated || r.removed) {
    notes.sort(byNewest);
    reindex();
  }
  if (r.added || r.updated || r.removed || goneChanged) persist({ quiet });
  return r;
}

/** 파일에서 온 노트 주입. 같은 id 는 더 최근에 고친 쪽이 남는다. 새로 들어온 수를 돌려준다. */
export function importNotes(arr, { imported = true, gone: incomingGone = {} } = {}) {
  return merge({ notes: arr, gone: incomingGone }, { imported }).added;
}

/** 내보내기·동기화 파일 — 노트와 흔적 */
export function snapshot() {
  return { app: "biblenote", version: 2, notes, gone: Object.fromEntries(gone) };
}
export function exportNotes() { return JSON.stringify(snapshot(), null, 2); }

/** 로컬에서 노트가 바뀔 때마다 부를 함수 하나 (드라이브 동기화가 등록한다) */
export function onLocalChange(fn) { listener = fn; }

/** 저장 용량 상황 — 설정 화면에서 보여 준다 */
export function usage() {
  const chars = JSON.stringify(notes).length;
  return { notes: notes.length, chars, pct: chars / 5_000_000 };
}
