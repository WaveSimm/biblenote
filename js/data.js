// BibleRepository: 본문 데이터의 유일한 공급자
export let BOOKS = null;      // books.json (66권 메타)
export let VERSIONS = null;   // versions.json
let HEADINGS = null;          // headings.json — "책:장:절" -> 단락 제목 (개역개정 소제목)

const cache = new Map();      // "code:book" -> Promise<{book, chapters}>

export async function initData() {
  [BOOKS, VERSIONS, HEADINGS] = await Promise.all([
    fetch("data/books.json").then(r => r.json()),
    fetch("data/versions.json").then(r => r.json()),
    // 소제목은 없어도 앱은 돌아야 한다 (옛 캐시, 파일 미배포)
    fetch("data/headings.json").then(r => (r.ok ? r.json() : null)).catch(() => null),
  ]);
}

/** 그 절 앞에 걸린 단락 제목 — 좌표 기반이라 어느 번역본에서든 같은 자리에 선다 */
export const headingAt = (b, c, v) => (HEADINGS ? HEADINGS[`${b}:${c}:${v}`] : undefined);

export function getBook(code, b) {
  const key = code + ":" + b;
  if (!cache.has(key)) {
    cache.set(key, fetch(`data/${code}/${b}.json`).then(r => {
      if (!r.ok) throw new Error("load fail " + key);
      return r.json();
    }).catch(e => { cache.delete(key); throw e; }));
  }
  return cache.get(key);
}

// 검색용: 이미 읽어 둔 책은 재사용하되, 새로 읽은 책은 캐시에 남기지 않는다.
// 검색은 66권을 훑으므로 캐시에 넣으면 번역본 하나가 통째로 메모리에 상주하게 된다.
// (서비스 워커의 DATA 캐시에는 그대로 남으므로 두 번째 검색부터는 네트워크를 타지 않는다)
export function loadBookOnce(code, b) {
  const key = code + ":" + b;
  if (cache.has(key)) return cache.get(key);
  return fetch(`data/${code}/${b}.json`).then(r => {
    if (!r.ok) throw new Error("load fail " + key);
    return r.json();
  });
}

export function bookMeta(b) { return BOOKS[b - 1]; }
export function versionMeta(code) { return VERSIONS.find(v => v.code === code); }

// 위치 라벨: "요한복음 3:16"
export function refLabel(ref, { abbr = false } = {}) {
  const m = bookMeta(ref.b);
  return `${abbr ? m.abbr : m.ko} ${ref.c}:${ref.v}`;
}
