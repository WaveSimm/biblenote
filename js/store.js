// 설정·히스토리 저장 (localStorage) — Phase 2에서 노트는 IndexedDB로 분리 예정
const S_KEY = "biblenote.settings.v1";
const H_KEY = "biblenote.history.v1";

export const DEFAULTS = {
  mode: "single",                 // "single" | "compare"
  verA: "krv",
  verB: "niv",
  pos: { b: 1, c: 1, v: 1 },      // 마지막 위치 (창1 기준)
  fontSize: 2,                    // 0~4
  lineHeight: 2,                  // 0~3 (120 / 150 / 180 / 200 %)
  theme: "auto",                  // auto | light | dark
  face: "serif",                  // serif | sans
  vnum: true,                     // 절 번호 표시
  chmarks: true,                  // 여백 장 번호
  vbreak: false,                  // 절마다 줄바꿈 (기본: 이어쓰기)
  heads: true,                    // 단락 제목(개역개정 소제목) 표시
  recentBooks: [],                // 최근 이동한 책 번호
};

export function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(S_KEY) || "{}");
    return { ...structuredClone(DEFAULTS), ...raw };
  } catch {
    return structuredClone(DEFAULTS);
  }
}
export function saveSettings(s) {
  try { localStorage.setItem(S_KEY, JSON.stringify(s)); } catch {}
}

export function loadHistory() {
  try {
    const h = JSON.parse(localStorage.getItem(H_KEY) || "null");
    if (h && Array.isArray(h.entries)) return h;
  } catch {}
  return { entries: [], idx: -1 };
}
export function saveHistory(h) {
  try { localStorage.setItem(H_KEY, JSON.stringify(h)); } catch {}
}
