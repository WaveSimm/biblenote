// 노트 본문에서 절 참조를 찾아낸다 — 설교노트의 좌표계는 '설교 본문'이다.
//
// 적는 방식이 세 가지이고, 생략된 것은 직전 참조가 아니라 **본문**에서 채운다:
//
//     롬8:28-30 박지현목사님    ← 본문. 이 노트의 좌표계
//     30 ->영화가 구원의 완성    ← 절만   → 본문의 책·장   = 로마서 8:30
//     13:1 …                   ← 장:절  → 본문의 책      = 로마서 13:1
//     약1:3 인내에는 고난        ← 다른 책은 약어를 쓴다      = 야고보서 1:3
//     9 ->…                    ← 다시 절만 → 본문으로 복귀 = 로마서 8:9
//
// 마지막 줄이 핵심이다. 직전 참조(야고보서)를 이어받지 않는다.
// 4년치 노트로 검증했다 — 직전 참조를 쓰면 1,136건 중 49건이 엉뚱한 곳에 붙는다.
//
// books.json 메타만 참조하는 순수 모듈이다 (parser.js 와 같은 규칙).

// books.json 에 없지만 실제 노트에 나오는 약어
const ALIAS = {
  "행전": 44,
  "요1": 62, "요2": 63, "요3": 64,
  "벧1": 60, "벧2": 61,
  "고1": 46, "고2": 47,
  "살1": 52, "살2": 53,
  "딤1": 54, "딤2": 55,
};

let NAMES = null;      // [별칭, 책번호] 길이 내림차순
let META = null;       // 책번호 -> { chapters, vpc, ko }
let RE_EXPLICIT = null;
let RE_CHAPONLY = null;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildNoteRefs(books) {
  const map = new Map();
  META = {};
  for (const b of books) {
    map.set(b.ko, b.n);
    map.set(b.abbr, b.n);
    META[b.n] = { chapters: b.chapters, vpc: b.vpc, ko: b.ko };
  }
  for (const [k, v] of Object.entries(ALIAS)) if (!map.has(k)) map.set(k, v);

  NAMES = [...map.entries()].sort((a, b) => b[0].length - a[0].length);
  const alt = NAMES.map(([n]) => esc(n)).join("|");
  // 책 + 장:절[-절].  구분자는 : ; ： 또는 '장'
  RE_EXPLICIT = new RegExp(`(?<![가-힣])(${alt})\\s*(\\d{1,3})\\s*[:;：장]\\s*(\\d{1,3})(?:\\s*[-~]\\s*(\\d{1,3}))?`);
  // 절 없이 장만 — '계18', '렘17장'
  RE_CHAPONLY = new RegExp(`(?<![가-힣])(${alt})\\s*(\\d{1,3})\\s*장?(?![\\d:;：])`);
  return map;
}

const RE_CHAPVERSE = /^\s*(\d{1,3})\s*[:;：]\s*(\d{1,3})(?:\s*[-~]\s*(\d{1,3}))?/;

// 절 번호만 적은 줄. 번호 매긴 목록과 구별해야 한다 —
//   '4절-144,000'  '13-14 : 아이가 죽음'  '9 ->용=뱀'  '15 재능대로'  ← 절
//   '1.신자의 삶에는…'  '2)외적'                                    ← 목록 마커
// 실데이터에 목록 마커가 534건 있었다. 안 거르면 앵커의 3분의 1이 가짜가 된다.
//
// 숫자 뒤에 무엇이 오는지로 가른다. '->' 는 범위의 '-' 와 헷갈리기 쉬워 따로 본다
// ('9 ->용' 은 9절이지 9-어딘가가 아니다).
const RE_VERSEONLY = /^(\s*)(\d{1,3})([\s\S]*)$/;

function verseOnly(line) {
  const m = RE_VERSEONLY.exec(line);
  if (!m) return null;
  const [, lead, num, rest] = m;
  const at = lead.length, after = at + num.length;

  const range = /^\s*[-~]\s*(\d{1,3})/.exec(rest);
  if (range) return { v: +num, endV: +range[1], start: at, end: after + range[0].length };

  if (/^\s*->/.test(rest)) return { v: +num, endV: null, start: at, end: after };
  const jeol = /^\s*절/.exec(rest);
  if (jeol) return { v: +num, endV: null, start: at, end: after + jeol[0].length };
  if (/^[\s:]/.test(rest)) return { v: +num, endV: null, start: at, end: after };

  return null;                                  // '1.' '2)' 같은 목록 마커
}

const valid = (b, c, v) =>
  META[b] && c >= 1 && c <= META[b].chapters && v >= 1 && v <= META[b].vpc[c - 1];

const nameToBook = (s) => {
  for (const [alias, n] of NAMES) if (alias === s) return n;
  return null;
};

/**
 * 노트 본문에서 절 앵커를 찾는다.
 * @param {string} text  줄바꿈이 든 본문 전체
 * @returns {Array<{book,c,v,endV,label,start,end,text}>}
 *          start/end 는 text 안에서 '참조 표기'의 위치 — 화면에서 색을 입히는 데 쓴다.
 */
export function resolveAnchors(text) {
  if (!NAMES) throw new Error("buildNoteRefs(books) 를 먼저 부르세요");
  const out = [];
  let pb = null, pc = null;          // 설교 본문의 책·장 (첫 명시 참조로 정해진다)
  let cur = null;                    // 지금 내용을 모으는 앵커
  let pos = 0;

  for (const line of text.split("\n")) {
    const base = pos;
    pos += line.length + 1;          // +1 은 개행

    let hit = null;
    const m = RE_EXPLICIT.exec(line);
    if (m) {
      const b = nameToBook(m[1]), c = +m[2], v = +m[3];
      if (b && valid(b, c, v)) {
        if (pb === null) { pb = b; pc = c; }
        hit = { book: b, c, v, endV: m[4] ? +m[4] : null,
                start: base + m.index, end: base + m.index + m[0].length };
      }
    }
    if (!hit) {
      const mc = RE_CHAPONLY.exec(line);
      if (mc) {
        const b = nameToBook(mc[1]), c = +mc[2];
        if (b && META[b] && c >= 1 && c <= META[b].chapters) {
          if (pb === null) { pb = b; pc = c; }
          hit = { book: b, c, v: 1, endV: null,
                  start: base + mc.index, end: base + mc.index + mc[0].length };
        }
      }
    }
    if (!hit && pb !== null) {
      const mv = RE_CHAPVERSE.exec(line);
      if (mv) {
        const c = +mv[1], v = +mv[2];
        if (valid(pb, c, v)) {
          hit = { book: pb, c, v, endV: mv[3] ? +mv[3] : null,
                  start: base, end: base + mv[0].length };
        }
      } else {
        const vo = verseOnly(line);
        if (vo && valid(pb, pc, vo.v)) {
          hit = { book: pb, c: pc, v: vo.v, endV: vo.endV,
                  start: base + vo.start, end: base + vo.end };
        }
      }
    }

    if (hit) {
      hit.label = `${META[hit.book].ko} ${hit.c}:${hit.v}` + (hit.endV ? `-${hit.endV}` : "");
      hit.lines = [line];
      out.push(hit);
      cur = hit;
    } else if (cur && line.trim()) {
      cur.lines.push(line);          // 앵커에 딸린 내용
    }
  }

  for (const a of out) { a.text = a.lines.join("\n").trim(); delete a.lines; }
  return out;
}

/** 노트의 설교 본문 = 첫 앵커 */
export function passageOf(anchors) {
  return anchors.length ? anchors[0] : null;
}
