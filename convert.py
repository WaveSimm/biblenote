# -*- coding: utf-8 -*-
"""Phase 0: SQLite 성경 DB 7종 -> 책 단위 JSON + 메타데이터 변환"""
import sqlite3, json, os, unicodedata

SRC = "/mnt/user-data/uploads/biblenote/성경파일"
OUT = "/home/claude/bibleapp/data"

VERSIONS = [
    # (code, 파일명, 표시명, 칩 약칭, 언어)
    ("krv",  "개역개정",         "개역개정",       "개역",   "ko"),
    ("ckb",  "공동번역",         "공동번역",       "공동",   "ko"),
    ("nkr",  "표준새번역",       "표준새번역",     "새번역", "ko"),
    ("klb",  "현대어성경",       "현대어성경",     "현대어", "ko"),
    ("niv",  "NIV",              "NIV",            "NIV",    "en"),
    ("nasb", "영문NASB",         "NASB",           "NASB",   "en"),
    ("msg",  "영문 메시지 성경", "The Message",    "MSG",    "en"),
]

BOOKS_KO = ["창세기","출애굽기","레위기","민수기","신명기","여호수아","사사기","룻기","사무엘상","사무엘하",
"열왕기상","열왕기하","역대상","역대하","에스라","느헤미야","에스더","욥기","시편","잠언",
"전도서","아가","이사야","예레미야","예레미야애가","에스겔","다니엘","호세아","요엘","아모스",
"오바댜","요나","미가","나훔","하박국","스바냐","학개","스가랴","말라기",
"마태복음","마가복음","누가복음","요한복음","사도행전","로마서","고린도전서","고린도후서","갈라디아서","에베소서",
"빌립보서","골로새서","데살로니가전서","데살로니가후서","디모데전서","디모데후서","디도서","빌레몬서","히브리서","야고보서",
"베드로전서","베드로후서","요한일서","요한이서","요한삼서","유다서","요한계시록"]

ABBR_KO = ["창","출","레","민","신","수","삿","룻","삼상","삼하","왕상","왕하","대상","대하","스","느","에","욥","시","잠",
"전","아","사","렘","애","겔","단","호","욜","암","옵","욘","미","나","합","습","학","슥","말",
"마","막","눅","요","행","롬","고전","고후","갈","엡","빌","골","살전","살후","딤전","딤후","딛","몬","히","약",
"벧전","벧후","요일","요이","요삼","유","계"]

BOOKS_EN = ["Genesis","Exodus","Leviticus","Numbers","Deuteronomy","Joshua","Judges","Ruth","1 Samuel","2 Samuel",
"1 Kings","2 Kings","1 Chronicles","2 Chronicles","Ezra","Nehemiah","Esther","Job","Psalms","Proverbs",
"Ecclesiastes","Song of Songs","Isaiah","Jeremiah","Lamentations","Ezekiel","Daniel","Hosea","Joel","Amos",
"Obadiah","Jonah","Micah","Nahum","Habakkuk","Zephaniah","Haggai","Zechariah","Malachi",
"Matthew","Mark","Luke","John","Acts","Romans","1 Corinthians","2 Corinthians","Galatians","Ephesians",
"Philippians","Colossians","1 Thessalonians","2 Thessalonians","1 Timothy","2 Timothy","Titus","Philemon",
"Hebrews","James","1 Peter","2 Peter","1 John","2 John","3 John","Jude","Revelation"]

ABBR_EN = ["gen","exod,ex","lev","num","deut","josh","judg","ruth","1sam","2sam","1kgs,1ki","2kgs,2ki","1chr","2chr",
"ezra","neh","esth","job","ps,psa","prov","eccl","song,sos","isa","jer","lam","ezek","dan","hos","joel","amos",
"obad","jonah,jon","mic","nah","hab","zeph","hag","zech","mal",
"matt,mt","mark,mk","luke,lk","john,jn","acts","rom","1cor","2cor","gal","eph","phil","col","1thess,1th",
"2thess,2th","1tim","2tim","titus,tit","phlm","heb","jas","1pet,1pe","2pet,2pe","1john,1jn","2john,2jn",
"3john,3jn","jude","rev"]

def normalize(text):
    # 전각 문자 등 정리 (메시지 성경의 '：' 등)
    text = text.replace("：", ": ").replace("　", " ")
    return unicodedata.normalize("NFC", text).strip()

def main():
    os.makedirs(OUT, exist_ok=True)
    # 1) 모든 번역본을 읽어 절 좌표의 합집합으로 versification 확정
    data = {}   # code -> {(b,c,v): text}
    for code, fname, *_ in VERSIONS:
        con = sqlite3.connect(os.path.join(SRC, fname))
        rows = con.execute("SELECT book, chapter, verse, content FROM bible").fetchall()
        data[code] = {(int(b), int(c), int(v)): normalize(t) for b, c, v, t in rows if t and t.strip()}
        con.close()

    union = set()
    for d in data.values():
        union |= set(d.keys())

    # 책별 장 수, 장별 최대 절 수 (합집합 기준)
    chapters_of = {}   # book -> max chapter
    verses_of = {}     # (book, chapter) -> max verse
    for (b, c, v) in union:
        chapters_of[b] = max(chapters_of.get(b, 0), c)
        verses_of[(b, c)] = max(verses_of.get((b, c), 0), v)

    # 2) books.json
    books = []
    for b in range(1, 67):
        nch = chapters_of[b]
        vpc = [verses_of[(b, c)] for c in range(1, nch + 1)]
        books.append({
            "n": b, "ko": BOOKS_KO[b-1], "abbr": ABBR_KO[b-1],
            "en": BOOKS_EN[b-1], "abbrEn": ABBR_EN[b-1].split(","),
            "chapters": nch, "vpc": vpc,
            "testament": "old" if b <= 39 else "new",
        })
    with open(os.path.join(OUT, "books.json"), "w", encoding="utf-8") as f:
        json.dump(books, f, ensure_ascii=False, separators=(",", ":"))

    # 3) versions.json
    vers = [{"code": c, "name": n, "short": s, "lang": l} for c, _, n, s, l in VERSIONS]
    with open(os.path.join(OUT, "versions.json"), "w", encoding="utf-8") as f:
        json.dump(vers, f, ensure_ascii=False, indent=1)

    # 4) 번역본별 책 단위 JSON (없는 절은 null로 자리 유지)
    report = []
    for code, *_ in [(v[0],) for v in VERSIONS]:
        d = data[code]
        vdir = os.path.join(OUT, code)
        os.makedirs(vdir, exist_ok=True)
        missing = 0
        for b in range(1, 67):
            chs = []
            for c in range(1, chapters_of[b] + 1):
                verses = []
                for v in range(1, verses_of[(b, c)] + 1):
                    t = d.get((b, c, v))
                    if t is None:
                        missing += 1
                    verses.append(t)
                chs.append(verses)
            with open(os.path.join(vdir, f"{b}.json"), "w", encoding="utf-8") as f:
                json.dump({"book": b, "chapters": chs}, f, ensure_ascii=False, separators=(",", ":"))
        report.append((code, len(d), missing))

    total_ch = sum(chapters_of.values())
    print(f"합집합 절 수: {len(union)}, 총 장 수: {total_ch}")
    for code, n, miss in report:
        print(f"  {code}: {n}절, 누락(null) {miss}")

if __name__ == "__main__":
    main()
