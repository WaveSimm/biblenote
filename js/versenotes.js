// 절 노트 — 성경을 읽다 색칠된 절을 누르면 그 절의 노트들을 보여 준다.
//
// 조각만 떼어 보여주면 설교의 맥락이 사라진다. 그래서 노트 전체를 펼치되
// 눌린 절에 해당하는 조각만 옅게 강조한다 (설계문서 §6·§7.5).

import * as Notes from "./notes.js";

const $ = (id) => document.getElementById(id);
let hooks = {};        // { openSheet, closeAll, openNote }

let shown = null;        // 지금 시트에 띄운 절

export function initVerseNotes(h) { hooks = h; }

/** 노트가 바뀌었을 때 — 열려 있는 시트를 다시 그리거나, 빌 때는 닫는다 */
export function refreshVerseNotes() {
  if (!shown || $("sheetVerse").hidden) return;
  const { b, c, v, label } = shown;
  if (!Notes.notesAt(b, c, v).length) { hooks.closeAll(); shown = null; return; }
  openVerseNotes(b, c, v, label, { keepScroll: true });
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

export function openVerseNotes(b, c, v, label, { keepScroll = false } = {}) {
  const list = Notes.notesAt(b, c, v);
  if (!list.length) return false;
  shown = { b, c, v, label };

  $("verseTitle").textContent = label;
  $("verseCount").textContent = `노트 ${list.length}개`;
  const box = $("verseNotes");
  const top = keepScroll ? box.scrollTop : 0;   // 지우기 전에 읽어 둔다 (지우면 0 이 된다)
  box.replaceChildren();
  for (const n of list) box.append(noteCard(n, anchorFor(n, b, c, v)));

  if (!keepScroll) hooks.openSheet($("sheetVerse"));
  box.scrollTop = top;
  return true;
}
