// 관주(貫珠) — 성경이 성경 자신에 매달아 둔 참조 (관주_설계문서.md)
//
// 데이터는 tools/build-xref.py 가 OpenBible 교차참조(CC-BY)에서 추린
// 절당 상위 5개, 정경 순서다. 좌표라 번역본과 무관하다.
// 본문과 같은 방식으로 책 단위 지연 로드 — SW 의 DATA 캐시에 실려 오프라인도 된다.

const cache = new Map();     // b -> Promise<{book, refs}>

function loadBook(b) {
  if (!cache.has(b)) {
    cache.set(b, fetch(`data/xref/${b}.json`).then((r) => {
      if (!r.ok) throw new Error("xref load fail " + b);
      return r.json();
    }).catch((e) => { cache.delete(b); throw e; }));
  }
  return cache.get(b);
}

/** 그 절의 관주들 — [{book, c, v, endV?}] 정경 순. 없거나 못 받으면 [] */
export async function xrefsAt(b, c, v) {
  try {
    const d = await loadBook(b);
    return (d.refs[`${c}:${v}`] || []).map(([book, cc, vv, endV]) =>
      endV ? { book, c: cc, v: vv, endV } : { book, c: cc, v: vv });
  } catch {
    return [];               // 오프라인에서 아직 안 받은 책 — 관주 없이 조용히 넘어간다
  }
}
