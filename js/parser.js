// 권장절 검색어 파서: "요3:16", "창세기 1:1", "롬 8", "1 John 3:16" 등
// books.json 메타만 참조하는 순수 모듈 — Phase 2에서 노트 내 구절 링크에 재사용
let ALIASES = null; // [alias(normalized), bookNumber] 길이 내림차순

function norm(s) {
  return s.toLowerCase().replace(/\s+/g, "");
}

export function buildAliases(books) {
  const list = [];
  for (const bk of books) {
    list.push([norm(bk.ko), bk.n]);
    list.push([norm(bk.abbr), bk.n]);
    list.push([norm(bk.en), bk.n]);
    for (const a of bk.abbrEn) list.push([norm(a), bk.n]);
  }
  // 긴 별칭 우선 매칭 ("요일" > "요")
  list.sort((x, y) => y[0].length - x[0].length);
  ALIASES = list;
}

function matchBook(str) {
  const n = norm(str);
  if (!n) return null;
  for (const [alias, b] of ALIASES) if (alias === n) return b;
  return null;
}

export function parseRef(input, books) {
  if (!input) return null;
  let q = input.trim()
    .replace(/(\d+)\s*장/g, "$1 ")
    .replace(/(\d+)\s*절/g, "$1 ");
  if (!q) return null;

  // 토큰화: 구분자(공백 : , . ;)로 분리
  const toks = q.split(/[\s:,.;]+/).filter(Boolean);
  if (!toks.length) return null;

  // 뒤에서부터 숫자 토큰 최대 2개 = [장, 절]
  const nums = [];
  while (toks.length && nums.length < 2 && /^\d+$/.test(toks[toks.length - 1])) {
    nums.unshift(parseInt(toks.pop(), 10));
  }

  let b = null, c = nums[0], v = nums[1];
  let bookStr = toks.join(" ");

  if (bookStr) {
    b = matchBook(bookStr);
    // "요3" 처럼 책+장이 붙은 경우
    if (b === null) {
      const m = norm(bookStr).match(/^(.+?)(\d+)$/);
      if (m) {
        const cand = matchBook(m[1]);
        if (cand !== null) { b = cand; v = c; c = parseInt(m[2], 10); }
      }
    }
  }
  if (b === null) return null;

  const meta = books[b - 1];
  c = Math.min(Math.max(c || 1, 1), meta.chapters);
  v = Math.min(Math.max(v || 1, 1), meta.vpc[c - 1]);
  return { b, c, v };
}
