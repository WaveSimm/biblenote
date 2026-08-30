// 설교노트 입력 화면 — 본문이 좌표계, 인식된 절은 글자 색으로 알린다.
//
// textarea 안의 글자에는 색을 못 입힌다. 그래서 투명한 textarea 뒤에
// 같은 조판의 사본(#noteHL)을 겹쳐 두고, 거기에만 색을 칠한다.
// 둘의 글꼴·크기·줄간격·여백·스크롤이 정확히 같아야 글자가 어긋나지 않는다.
//
// 저장은 자동이다. 예배 중에 '저장' 을 누르게 하면 안 된다.

import { resolveAnchors } from "./noteref.js";
import * as Notes from "./notes.js";

const $ = (id) => document.getElementById(id);
const WD = ["일", "월", "화", "수", "목", "금", "토"];

let hooks = {};          // { jumpBible, markDraft, showBible, showNote }
let note = null;         // 지금 편집 중인 노트
let anchors = [];
let saveTimer = null;
let onBible = false;     // 성경 쪽을 보고 있는가

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* ---------- 색칠 ---------- */

// 겹쳐 둔 사본을 다시 그린다. innerHTML 을 쓰지 않는다 — 본문이 그대로 들어가므로.
function paint() {
  const text = $("noteText").value;
  anchors = resolveAnchors(text);
  const hl = $("noteHL");
  hl.replaceChildren();

  let pos = 0;
  for (const a of anchors) {
    if (a.start > pos) hl.append(text.slice(pos, a.start));
    const s = document.createElement("span");
    s.className = "ref" + (a === anchors[0] ? " passage" : "");
    s.textContent = text.slice(a.start, a.end);
    hl.append(s);
    pos = a.end;
  }
  hl.append(text.slice(pos));
  hl.append("\n");                       // 마지막 줄 높이 확보

  const first = anchors[0];
  $("notePassage").textContent = first ? first.label : "본문 없음";
  $("notePassage").classList.toggle("empty", !first);
  $("noteStat").textContent = anchors.length
    ? `절 ${anchors.length}곳`
    : "본문을 적으면 절이 인식됩니다";

  if (hooks.markDraft) hooks.markDraft(anchors);
}

function syncScroll() { $("noteHL").scrollTop = $("noteText").scrollTop; }

/* ---------- 저장 ---------- */

function schedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
}

function save() {
  if (!note) return;
  note.body = $("noteText").value;
  note.title = $("noteTitle").value.trim() || undefined;
  note.preacher = $("notePreacherIn").value.trim() || undefined;
  note.tags = parseTags($("noteTags").value);
  if (!note.body.trim() && !note.title) {
    // 새 노트라면 만들지 않는다. 그런데 있던 노트를 비운 것이라면 지워야 한다 —
    // 그냥 돌아가면 저장소에 옛 내용이 남아 절 표시도 그대로 남는다.
    const saved = note.id && Notes.get(note.id);
    if (saved) {
      // 지워야 할 절은 '저장돼 있던' 앵커다. 이 시점의 anchors 는 paint() 가
      // 이미 빈 본문으로 다시 계산해 비워 놓았다.
      const gone = saved.anchors || [];
      Notes.remove(note.id);
      anchors = [];
      if (hooks.onSaved) hooks.onSaved(gone);
    }
    return;
  }
  const before = anchors;
  Notes.put(note);
  anchors = note.anchors;
  // 저장으로 절 표시가 달라질 수 있다 — 사라진 앵커까지 함께 넘겨 되돌린다
  if (hooks.onSaved) hooks.onSaved([...before, ...anchors]);
}

/* ---------- 열기·닫기 ---------- */

export function initNoteEdit(h) {
  hooks = h;
  const ta = $("noteText");
  ta.addEventListener("input", () => { paint(); schedSave(); });
  ta.addEventListener("scroll", syncScroll, { passive: true });
  // 색칠된 절을 누르면 성경으로 간다 (설계문서 §4 "노트에서 색 = 성경으로 가는 길").
  // 사본에 onclick 을 달 수는 없다 — 투명 textarea 가 위에 덮여 클릭을 다 가져간다.
  // 그래서 클릭 뒤의 커서 위치가 앵커 범위 안인지로 판단한다.
  ta.addEventListener("click", () => {
    const at = ta.selectionStart;
    if (at !== ta.selectionEnd) return;                 // 드래그 선택은 그냥 둔다
    const a = anchors.find((x) => at >= x.start && at < x.end);
    if (a) gotoAnchor(a);
  });
  for (const id of ["noteTitle", "notePreacherIn", "noteTags"]) $(id).addEventListener("input", schedSave);

  $("noteBack").onclick = closeNote;
  $("notePassage").onclick = () => { if (anchors[0]) gotoAnchor(anchors[0]); };
  $("noteToBible").onclick = () => toBible();
  $("noteReturn").onclick = toNote;
  $("noteDel").onclick = () => {
    if (!note) return;
    const saved = note.id && Notes.get(note.id);
    const gone = (saved && saved.anchors) || anchors;
    if (saved) Notes.remove(note.id);
    note = null;
    if (hooks.onSaved) hooks.onSaved(gone);
    closeNote();
  };
}

/** ref 를 본문으로 새 노트를 열거나(id 없이), 기존 노트를 연다 */
export function openNote({ id = null, ref = null, label = "" } = {}) {
  if (id) {
    note = { ...Notes.get(id) };
    if (!note.id) return;
  } else {
    const date = todayISO();
    note = {
      date, weekday: WD[new Date(date).getDay()],
      title: "", preacher: lastPreacher(), body: label ? label + " " : "",
    };
  }
  $("noteText").value = note.body || "";
  $("noteTitle").value = note.title || "";
  $("notePreacherIn").value = note.preacher || "";
  $("noteTags").value = (note.tags || []).join(", ");
  $("noteDate").textContent = `${note.date} (${note.weekday})`;
  fillPreachers();
  fillTags();

  $("noteView").hidden = false;
  document.body.classList.add("noting");
  onBible = false;
  $("noteReturn").hidden = true;
  paint();

  // 새 노트면 본문 뒤에 커서를 두고 바로 적을 수 있게
  const ta = $("noteText");
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

export function closeNote() {
  save();
  note = null;
  $("noteView").hidden = true;
  $("noteReturn").hidden = true;
  document.body.classList.remove("noting");
  if (hooks.markDraft) hooks.markDraft([]);
  if (hooks.showBible) hooks.showBible();
}

export const isEditing = () => !!note;

/* ---------- 성경 ⇄ 노트 ---------- */

function currentAnchor() {
  // 커서가 있는 자리에서 가장 가까운 앞쪽 앵커
  const at = $("noteText").selectionStart;
  let best = anchors[0] || null;
  for (const a of anchors) if (a.start <= at) best = a;
  return best;
}

const isSplit = () => matchMedia("(min-width: 820px)").matches;

/** 색칠된 절을 눌렀을 때 */
function gotoAnchor(a) {
  const ta = $("noteText");
  ta.focus();
  ta.setSelectionRange(a.end, a.end);
  if (isSplit()) {
    if (hooks.jumpBible) hooks.jumpBible({ b: a.book, c: a.c, v: a.v });
  } else {
    toBible(a);                      // 좁은 화면이면 성경 쪽으로 넘어간다
  }
}

function toBible(anchor) {
  save();
  const a = anchor || currentAnchor();
  $("noteView").hidden = true;
  $("noteReturn").hidden = false;
  onBible = true;
  if (a && hooks.jumpBible) hooks.jumpBible({ b: a.book, c: a.c, v: a.v });
}

function toNote() {
  $("noteView").hidden = false;
  $("noteReturn").hidden = true;
  onBible = false;
  const ta = $("noteText");
  ta.focus();                      // 커서 자리는 브라우저가 지켜 준다
}

/* ---------- 태그 ---------- */

// 쉼표로 나눈다. 낱말 사이 공백을 살려야 '하나님의 은혜' 같은 태그가 쪼개지지 않는다.
function parseTags(v) {
  const out = [];
  for (const t of String(v || "").split(",")) {
    const s = t.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out.length ? out : undefined;
}

function fillTags() {
  const c = new Map();
  for (const n of Notes.all()) for (const t of n.tags || []) c.set(t, (c.get(t) || 0) + 1);
  const dl = $("tagList");
  dl.replaceChildren();
  for (const [t] of [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)) {
    const o = document.createElement("option");
    o.value = t;
    dl.append(o);
  }
}

/* ---------- 설교자 자동완성 ---------- */

function preacherList() {
  const c = new Map();
  for (const n of Notes.all()) if (n.preacher) c.set(n.preacher, (c.get(n.preacher) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

function lastPreacher() {
  const list = preacherList();
  return list.length ? list[0] : "";      // 가장 자주 나온 사람이 기본값
}

function fillPreachers() {
  const dl = $("preacherList");
  dl.replaceChildren();
  for (const p of preacherList()) {
    const o = document.createElement("option");
    o.value = p;
    dl.append(o);
  }
}
