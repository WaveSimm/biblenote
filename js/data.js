// BibleRepository: 본문 데이터의 유일한 공급자
export let BOOKS = null;      // books.json (66권 메타)
export let VERSIONS = null;   // versions.json

const cache = new Map();      // "code:book" -> Promise<{book, chapters}>

export async function initData() {
  [BOOKS, VERSIONS] = await Promise.all([
    fetch("data/books.json").then(r => r.json()),
    fetch("data/versions.json").then(r => r.json()),
  ]);
}

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

export function bookMeta(b) { return BOOKS[b - 1]; }
export function versionMeta(code) { return VERSIONS.find(v => v.code === code); }

// 위치 라벨: "요한복음 3:16"
export function refLabel(ref, { abbr = false } = {}) {
  const m = bookMeta(ref.b);
  return `${abbr ? m.abbr : m.ko} ${ref.c}:${ref.v}`;
}
