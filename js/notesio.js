// 노트 가져오기·내보내기 — 설정 시트
//
// 노트는 개인 기록이라 저장소(공개)에 올리지 않는다. 그래서 마이그레이션한
// 4년치 노트는 파일로 들여온다. 같은 파일을 폰에서도 쓸 수 있다.
//
// 두 번 가져와도 늘어나지 않는다 — 날짜·예배·제목으로 id 를 만들어 같은 노트를
// 알아본다. 파일에 id 가 있으면 그것을 쓴다.

import * as Notes from "./notes.js";

const $ = (id) => document.getElementById(id);
let hooks = {};        // { onImported }

/** 파일에서 온 노트를 앱이 쓰는 모양으로 (앵커는 notes.js 가 본문에서 다시 계산한다) */
function normalize(raw) {
  const body = Array.isArray(raw.body) ? raw.body.join("\n") : String(raw.body || "");
  const n = {
    id: raw.id || stableId(raw),
    date: raw.date,
    weekday: raw.weekday,
    service: raw.service || undefined,
    title: raw.title || undefined,
    titleRaw: raw.titleRaw || undefined,     // 원본 제목 — 정본으로 바꾸기 전 것
    preacher: raw.preacher || undefined,
    series: raw.series || undefined,
    seriesNo: raw.seriesNo || undefined,
    // 앱에서 내보낸 파일이 도로 들어올 때 잃으면 안 되는 것들 — 태그, 옮겨온 표시,
    // 만든 시각(같은 날 노트의 정렬 순서가 여기 달려 있다).
    // 도구가 만든 마이그레이션 파일에는 애초에 없는 필드라, 있을 때만 통과시킨다.
    tags: Array.isArray(raw.tags) && raw.tags.length ? raw.tags : undefined,
    imported: raw.imported || undefined,
    createdAt: raw.createdAt || undefined,
    updatedAt: raw.updatedAt || undefined,
    body,
  };
  for (const k of Object.keys(n)) if (n[k] === undefined) delete n[k];
  return n;
}

// 같은 노트를 다시 가져와도 알아보도록 — 파일에 id 가 없을 때만 쓴다.
// 날짜·예배·제목만으로는 부족하다. 실제로 2023-12-31 에 제목이 같은 다른 노트가
// 둘 있었다(시편 30:11 / 창세기 41:41-43). 본문까지 넣어야 갈린다.
function stableId(raw) {
  const body = Array.isArray(raw.body) ? raw.body.join("\n") : String(raw.body || "");
  return `imp:${raw.date}:${raw.service || ""}:${hash(body)}`;
}

function hash(s) {
  let h = 2166136261;                       // FNV-1a
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

const ok = (m) => { $("ioStat").textContent = m; $("ioStat").className = "io-ok"; };
const bad = (m) => { $("ioStat").textContent = m; $("ioStat").className = "io-bad"; };

async function importFile(file) {
  if (!file) return;
  $("ioStat").textContent = "읽는 중…";
  try {
    const arr = JSON.parse(await file.text());
    if (!Array.isArray(arr)) return bad("노트 배열이 아닙니다");

    const good = arr.filter((n) => n && n.date && (n.body || n.title));
    if (!good.length) return bad("가져올 노트가 없습니다");

    const before = Notes.all().length;
    const added = Notes.importNotes(good.map(normalize));
    const dup = good.length - added;

    ok(`${added}개 들여왔습니다` +
       (dup ? ` (이미 있던 ${dup}개는 건너뜀)` : "") +
       (good.length < arr.length ? ` · 형식이 안 맞는 ${arr.length - good.length}개 제외` : ""));
    paintUsage();
    if (hooks.onImported) hooks.onImported();
    if (Notes.all().length === before) bad("모두 이미 있던 노트입니다");
  } catch (e) {
    bad("읽지 못했습니다 — " + (e.message || e));
  }
}

function exportFile() {
  const blob = new Blob([Notes.exportNotes()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `biblenote-notes-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  ok(`${Notes.all().length}개를 내보냈습니다`);
}

export function paintUsage() {
  const u = Notes.usage();
  $("ioUsage").textContent = u.notes
    ? `노트 ${u.notes}개 · ${(u.chars / 1000).toFixed(0)}K자 (한도의 ${(u.pct * 100).toFixed(1)}%)`
    : "아직 노트가 없습니다";
}

export function initNotesIO(h) {
  hooks = h || {};
  $("ioImport").onchange = (e) => { importFile(e.target.files[0]); e.target.value = ""; };
  $("ioExport").onclick = exportFile;
  paintUsage();
}
