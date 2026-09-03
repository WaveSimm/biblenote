// 설교노트 입력 화면 — 본문이 좌표계, 인식된 절은 글자 색으로 알린다.
//
// textarea 안의 글자에는 색을 못 입힌다. 그래서 투명한 textarea 뒤에
// 같은 조판의 사본(#noteHL)을 겹쳐 두고, 거기에만 색을 칠한다.
// 둘의 글꼴·크기·줄간격·여백·스크롤이 정확히 같아야 글자가 어긋나지 않는다.
//
// 저장은 자동이다. 예배 중에 '저장' 을 누르게 하면 안 된다.

import { resolveAnchors } from "./noteref.js";
import * as Notes from "./notes.js";
import { onSwipe } from "./swipe.js";

const $ = (id) => document.getElementById(id);
const WD = ["일", "월", "화", "수", "목", "금", "토"];

let hooks = {};          // { jumpBible, markDraft, showBible, showNote }
let note = null;         // 지금 편집 중인 노트
let anchors = [];
let seedBody = "";      // 새 노트에 미리 넣어 준 본문 라벨 (사용자가 쓴 것이 아니다)
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
  if (hooks.markDraft) hooks.markDraft(anchors);
}

function syncScroll() { $("noteHL").scrollTop = $("noteText").scrollTop; }

/* ---------- 저장 ---------- */

function schedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
}

// 사용자가 실제로 쓴 것이 있는가.
//
// 새 노트에는 본문 라벨('창1:1 ')을 미리 넣어 준다. 예전에는 이것을 내용으로
// 세는 바람에 노트 아이콘을 눌렀다 그냥 닫기만 해도 노트가 하나씩 저장됐고,
// 앵커까지 잡혀 성경 본문의 그 절이 노트 있는 절로 물들었다.
// 그래서 '우리가 미리 넣어 준 만큼' 은 빼고 센다. 기존 노트를 열었을 때는
// 미리 넣은 것이 없으므로(seedBody = "") 예전과 똑같이 동작한다.
// 라벨 자체를 고쳐 쓴 경우(창1:1 → 롬8:28)는 앞부분이 달라지므로 내용으로 친다.
function hasContent() {
  const body = $("noteText").value;
  const rest = body.startsWith(seedBody) ? body.slice(seedBody.length) : body;
  return !!(rest.trim() || $("noteTitle").value.trim() || $("noteTags").value.trim());
}

function save() {
  if (!note) return;
  note.body = $("noteText").value;
  note.title = $("noteTitle").value.trim() || undefined;
  note.preacher = $("notePreacherIn").value.trim() || undefined;
  note.tags = parseTags($("noteTags").value);
  if (!hasContent()) {
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
  // 한 줄로 쓰는 칸이라 줄바꿈은 받지 않는다 (Enter 는 키보드를 내린다)
  $("noteTags").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); e.target.blur(); }
  });

  $("noteBack").onclick = closeNote;
  $("notePassage").onclick = () => { if (anchors[0]) gotoAnchor(anchors[0]); };
  $("noteToBible").onclick = () => toBible();
  // 오른쪽으로 쓸면 성경으로 — 버튼과 같은 동작. 설계의 '스와이프 보류'를 푼 것.
  // 분할 화면에선 둘 다 보이므로 무의미하다.
  onSwipe($("noteView"), { right: () => toBible(), enabled: () => !isSplit() });
  // 노트를 쓰다가 지난 노트를 찾아볼 수 있게 — 시트가 이 화면 위로 열린다
  $("noteFind").onclick = () => { save(); hooks.openNoteList && hooks.openNoteList(); };
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
  seedBody = id ? "" : (note.body || "");
  $("noteText").value = note.body || "";
  $("noteTitle").value = note.title || "";
  $("notePreacherIn").value = note.preacher || "";
  $("noteTags").value = (note.tags || []).join(", ");
  $("noteDate").textContent = `${note.date} (${note.weekday})`;
  fillPreachers();

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

/** 성경 화면에서 스와이프로 돌아올 때 — 쓰던 노트가 있으면 그리로 (커서 그대로) */
export function resumeNote() { if (note) toNote(); }

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
  for (const t of String(v || "").split(/[,\n]/)) {
    const s = t.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out.length ? out : undefined;
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
