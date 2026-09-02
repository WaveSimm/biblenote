// 절 시트 — 절 번호(또는 색칠된 절)를 누르면 그 절에 매달린 것들을 보여 준다:
// 내 노트(들은 설교)와 관주(성경 자신의 참조). 관주_설계문서.md §3.3.
//
// 노트는 조각만 떼면 설교의 맥락이 사라지므로 전체를 펼치되
// 눌린 절에 해당하는 조각만 옅게 강조한다 (설교노트 설계문서 §6·§7.5).

import * as Notes from "./notes.js";
import { xrefsAt } from "./xref.js";
import { getBook, bookMeta } from "./data.js";

const $ = (id) => document.getElementById(id);
let hooks = {};        // { openSheet, closeAll, openNote, jump, version }

let shown = null;        // 지금 시트에 띄운 절

export function initVerseNotes(h) { hooks = h; }

/** 노트가 바뀌었을 때 — 열려 있는 시트를 다시 그리거나, 빌 때는 닫는다 */
export function refreshVerseNotes() {
  if (!shown || $("sheetVerse").hidden) return;
  const { b, c, v, label } = shown;
  openVerseNotes(b, c, v, label, { keepScroll: true }).then((ok) => {
    if (!ok) { hooks.closeAll(); shown = null; }
  });
}

const SERVICE = { 주일낮: "주일 낮", 주일밤: "주일 밤", 수요: "수요", 특별집회: "특별집회" };

function noteCard(note, hit) {
  const box = document.createElement("div");
  box.className = "vn-note";

  const head = document.createElement("div");
  head.className = "vn-head";
  const bits = [`${note.date} (${note.weekday})`];
  if (note.service) bits.push(SERVICE[note.service] || note.service);
  if (note.preacher) bits.push(note.preacher);
  head.textContent = bits.join(" · ");
  if (note.imported) {
    const tag = document.createElement("span");
    tag.className = "vn-imported";
    tag.textContent = "옮겨온 노트";
    head.append(" ", tag);
  }
  box.append(head);

  if (note.title) {
    const t = document.createElement("div");
    t.className = "vn-title";
    t.textContent = note.title;
    box.append(t);
  }

  // 본문 전체 — 눌린 절의 조각만 강조한다
  const body = document.createElement("div");
  body.className = "vn-body";
  const text = note.body || "";
  if (hit && hit.start < text.length) {
    const end = hitEnd(note, hit, text);
    body.append(text.slice(0, hit.start));
    const m = document.createElement("span");
    m.className = "hit";
    m.textContent = text.slice(hit.start, end);
    body.append(m, text.slice(end));
  } else {
    body.textContent = text;
  }
  box.append(body);

  if (note.tags && note.tags.length) {
    const tg = document.createElement("div");
    tg.className = "tags";
    for (const t of note.tags) {
      const c = document.createElement("span");
      c.textContent = t;
      tg.append(c);
    }
    box.append(tg);
  }

  const open = document.createElement("button");
  open.className = "vn-open";
  open.textContent = "노트 열기";
  open.onclick = () => { hooks.closeAll(); hooks.openNote({ id: note.id }); };
  box.append(open);
  return box;
}

/** 조각의 끝 = 다음 앵커가 시작하는 자리 (없으면 본문 끝) */
function hitEnd(note, hit, text) {
  let end = text.length;
  for (const a of note.anchors || []) if (a.start > hit.start && a.start < end) end = a.start;
  return end;
}

/** 그 절을 담고 있는 앵커 하나 */
function anchorFor(note, b, c, v) {
  for (const a of note.anchors || []) {
    const last = a.endV && a.endV >= a.v ? a.endV : a.v;
    if (a.book === b && a.c === c && v >= a.v && v <= last) return a;
  }
  return null;
}

function secHead(text) {
  const el = document.createElement("div");
  el.className = "vn-sec";
  el.textContent = text;
  return el;
}

/** 관주 한 줄: 라벨(정경 순) + 현재 번역본 미리보기. ● 은 그 절에도 내 노트가 있다는 표시 */
function xrefRow(x) {
  const row = document.createElement("div");
  row.className = "xr";

  const ref = document.createElement("span");
  ref.className = "xr-ref";
  ref.textContent = `${bookMeta(x.book).abbr} ${x.c}:${x.v}` + (x.endV ? `-${x.endV}` : "");
  let hasNote = false;
  for (let vv = x.v; vv <= (x.endV || x.v); vv++)
    if (Notes.hasNoteAt(x.book, x.c, vv)) { hasNote = true; break; }
  if (hasNote) {
    const dot = document.createElement("span");
    dot.className = "xr-dot";
    dot.textContent = "●";
    ref.append(" ", dot);
  }

  const prev = document.createElement("span");
  prev.className = "xr-prev";
  getBook(hooks.version(), x.book).then((d) => {
    const t = d.chapters[x.c - 1] && d.chapters[x.c - 1][x.v - 1];
    if (t) prev.textContent = t;         // 범위여도 미리보기는 첫 절만 (설계 §3.3)
  }).catch(() => { /* 오프라인에 없는 책 — 라벨만 남긴다 */ });

  row.append(ref, prev);
  row.onclick = () => hooks.jump({ b: x.book, c: x.c, v: x.v });
  return row;
}

export async function openVerseNotes(b, c, v, label, { keepScroll = false } = {}) {
  const list = Notes.notesAt(b, c, v);
  const xrefs = await xrefsAt(b, c, v);
  if (!list.length && !xrefs.length) return false;
  shown = { b, c, v, label };

  $("verseTitle").textContent = label;
  const bits = [];
  if (list.length) bits.push(`노트 ${list.length}개`);
  if (xrefs.length) bits.push(`관주 ${xrefs.length}개`);
  $("verseCount").textContent = bits.join(" · ");

  const box = $("verseNotes");
  const top = keepScroll ? box.scrollTop : 0;   // 지우기 전에 읽어 둔다 (지우면 0 이 된다)
  box.replaceChildren();
  // 둘 다 있을 때만 섹션 제목을 단다 — 하나뿐이면 제목 없이 담백하게 (설계 §3.3)
  if (list.length && xrefs.length) box.append(secHead("내 노트"));
  for (const n of list) box.append(noteCard(n, anchorFor(n, b, c, v)));
  if (list.length && xrefs.length) box.append(secHead("관주"));
  for (const x of xrefs) box.append(xrefRow(x));

  if (!keepScroll) hooks.openSheet($("sheetVerse"));
  box.scrollTop = top;
  return true;
}
