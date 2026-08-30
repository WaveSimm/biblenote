// 노트 목록·검색 — 검색 시트의 '노트' 탭
//
// 목록과 검색을 따로 두지 않는다. 검색어가 비면 전체 목록이고, 치면 걸러진다.
// 하단 바에 아이콘을 더 늘리지 않아도 되고, 찾는 동작이 한 곳에 모인다.
//
// 날짜순(최근 먼저)으로 월마다 묶는다. 본문을 제목보다 위에 강조색으로 두는 건
// 노트가 본문에 매달린다는 개념이 목록에서도 드러나야 하기 때문이다 (설계문서 §7.6).

import * as Notes from "./notes.js";

const $ = (id) => document.getElementById(id);
let hooks = {};        // { onPick }

const SERVICE = { 주일낮: "주일 낮", 주일밤: "주일 밤", 수요: "수요", 특별집회: "특별집회" };

// 한 번에 그리는 개수. 노트는 해마다 쌓이므로 상한을 두지 않고
// 성경 본문처럼 스크롤이 끝에 닿으면 이어 붙인다.
const PAGE = 80;

let cur = { list: [], at: 0, month: null };

export function initNoteList(h) {
  hooks = h || {};
  const box = $("noteResults");
  box.addEventListener("scroll", () => {
    if (box.scrollTop + box.clientHeight > box.scrollHeight - 400) renderMore();
  }, { passive: true });
}

function row(n) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "nl-row";

  const day = document.createElement("span");
  day.className = "nl-day";
  day.textContent = n.date.slice(8);            // 일(日)만 — 월은 묶음 머리에 있다
  const wd = document.createElement("i");
  wd.textContent = n.weekday;
  day.append(wd);

  const main = document.createElement("span");
  main.className = "nl-main";

  const pas = document.createElement("span");
  pas.className = "nl-passage";
  pas.textContent = (n.passage && n.passage.label) || "본문 없음";
  if (n.service) {
    const s = document.createElement("i");
    s.className = "nl-service";
    s.textContent = SERVICE[n.service] || n.service;
    pas.append(s);
  }

  const tit = document.createElement("span");
  tit.className = "nl-title";
  tit.textContent = n.title || firstLine(n) || "(제목 없음)";

  main.append(pas, tit);
  if (n.preacher) {
    const p = document.createElement("span");
    p.className = "nl-preacher";
    p.textContent = n.preacher;
    main.append(p);
  }

  if (n.tags && n.tags.length) main.append(tagChips(n.tags));

  b.append(day, main);
  b.onclick = () => hooks.onPick && hooks.onPick(n.id);
  return b;
}

function tagChips(tags) {
  const box = document.createElement("span");
  box.className = "tags";
  for (const t of tags) {
    const s = document.createElement("span");
    s.textContent = t;
    box.append(s);
  }
  return box;
}

function firstLine(n) {
  const l = (n.body || "").split("\n").find((x) => x.trim());
  return l ? l.trim().slice(0, 40) : "";
}

/** 다음 묶음을 이어 붙인다. 스크롤이 끝에 닿을 때마다 불린다. */
function renderMore() {
  if (cur.at >= cur.list.length) return;
  const box = $("noteResults");
  const end = Math.min(cur.at + PAGE, cur.list.length);
  const frag = document.createDocumentFragment();
  for (; cur.at < end; cur.at++) {
    const n = cur.list[cur.at];
    const m = n.date.slice(0, 7);
    if (m !== cur.month) {            // 월 머리는 달이 바뀔 때만
      cur.month = m;
      const h = document.createElement("div");
      h.className = "nl-month";
      h.textContent = `${+m.slice(0, 4)}년 ${+m.slice(5)}월`;
      frag.append(h);
    }
    frag.append(row(n));
  }
  box.append(frag);
}

export function renderNoteList(query = "") {
  const box = $("noteResults");
  box.replaceChildren();

  const q = query.trim();
  // Notes.all() 은 이미 최근순이다. search() 결과도 같은 순서를 따른다.
  cur = { list: q ? Notes.search(q) : Notes.all().slice(), at: 0, month: null };

  $("noteStatLine").textContent = Notes.all().length
    ? (q ? `${cur.list.length}개 찾음` : `노트 ${cur.list.length}개`)
    : "노트가 없습니다 — 설정에서 가져오거나 성경에서 새로 적으세요";

  box.scrollTop = 0;
  renderMore();
  // 첫 묶음이 화면을 다 못 채우면 스크롤이 생기지 않아 더 불러올 기회가 없다
  requestAnimationFrame(() => {
    if (box.scrollHeight <= box.clientHeight) renderMore();
  });
}
