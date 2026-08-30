// 설교노트 저장소 — localStorage + 메모리 색인
//
// 왜 localStorage 인가: 실제 노트 294개를 재보니 180K자(한도의 3.6%)였고,
// 연 60개씩 20년 더 쌓아도 18%다. 그리고 성경을 스크롤하는 내내
// "이 절에 노트가 있나?" 를 물어야 하는데, IndexedDB 는 비동기라 그 자리에서
// 답할 수 없다. 여기서는 시작할 때 통째로 읽어 메모리에 색인을 만들어 둔다.
//
// 색인은 절 하나하나에 건다. 앵커가 롬8:28-30 이면 28·29·30 세 자리에 모두
// 걸어야 29절을 읽을 때도 노트가 뜬다.

import { buildNoteRefs, resolveAnchors } from "./noteref.js";

const KEY = "biblenote.notes.v1";

let notes = [];                  // Note[]
let byId = new Map();
let byVerse = new Map();         // "b:c:v" -> Note[]

const vkey = (b, c, v) => `${b}:${c}:${v}`;
const uid = () => "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

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
  for (const arr of byVerse.values()) arr.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/* ---------- 읽기·쓰기 ---------- */

export function initNotes(books) {
  buildNoteRefs(books);
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    notes = Array.isArray(raw) ? raw : [];
  } catch {
    notes = [];
  }
  reindex();
  return notes.length;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(notes));
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
  const i = notes.findIndex((x) => x.id === note.id);
  if (i >= 0) notes[i] = note; else notes.push(note);
  notes.sort((a, b) => (a.date < b.date ? 1 : -1));
  reindex();
  persist();
  return note;
}

export function remove(id) {
  const i = notes.findIndex((x) => x.id === id);
  if (i < 0) return false;
  notes.splice(i, 1);
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

/** 마이그레이션 데이터 주입. 같은 id 는 건너뛴다. */
export function importNotes(arr, { imported = true } = {}) {
  let added = 0;
  for (const raw of arr) {
    const n = { ...raw };
    if (!n.id) n.id = uid();          // id 는 부르는 쪽에서 정해 오는 게 낫다 (다시 가져와도 늘지 않게)
    if (byId.has(n.id)) continue;
    if (imported) n.imported = true;
    if (typeof n.body !== "string") n.body = (n.body || []).join("\n");
    refresh(n);
    n.createdAt = n.createdAt || Date.parse(n.date) || Date.now();
    n.updatedAt = n.updatedAt || n.createdAt;
    notes.push(n);
    byId.set(n.id, n);
    added++;
  }
  notes.sort((a, b) => (a.date < b.date ? 1 : -1));
  reindex();
  persist();
  return added;
}

export function exportNotes() { return JSON.stringify(notes, null, 2); }

/** 저장 용량 상황 — 설정 화면에서 보여 준다 */
export function usage() {
  const chars = JSON.stringify(notes).length;
  return { notes: notes.length, chars, pct: chars / 5_000_000 };
}
