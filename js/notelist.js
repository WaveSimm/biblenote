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
const MAX = 200;       // 한 번에 그리는 최대 개수

export function initNoteList(h) { hooks = h || {}; }

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

  b.append(day, main);
  b.onclick = () => hooks.onPick && hooks.onPick(n.id);
  return b;
}

function firstLine(n) {
  const l = (n.body || "").split("\n").find((x) => x.trim());
  return l ? l.trim().slice(0, 40) : "";
}

export function renderNoteList(query = "") {
  const box = $("noteResults");
  box.replaceChildren();

  const q = query.trim();
  const list = q ? Notes.search(q) : Notes.all().slice();
  // Notes.all() 은 이미 최근순이다. search() 결과도 같은 순서를 따른다.

  $("noteStatLine").textContent = Notes.all().length
    ? (q ? `${list.length}개 찾음` : `노트 ${list.length}개`)
    : "노트가 없습니다 — 설정에서 가져오거나 성경에서 새로 적으세요";

  let month = null, added = 0;
  for (const n of list) {
    if (added >= MAX) break;
    const m = n.date.slice(0, 7);
    if (m !== month) {
      month = m;
      const h = document.createElement("div");
      h.className = "nl-month";
      h.textContent = `${+m.slice(0, 4)}년 ${+m.slice(5)}월`;
      box.append(h);
    }
    box.append(row(n));
    added++;
  }
  if (list.length > MAX) {
    const more = document.createElement("div");
    more.className = "nl-more";
    more.textContent = `… 그 외 ${list.length - MAX}개. 검색어로 좁혀 보세요.`;
    box.append(more);
  }
  box.scrollTop = 0;
}
