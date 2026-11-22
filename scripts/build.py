#!/usr/bin/env python3
"""간사이 레전드 맛집 DB 빌드 스크립트 (표준 라이브러리만 사용).

하는 일
  1. data/restaurants.json (마스터 DB) 검증
  2. id 가 없는 항목에 id 부여 (osaka-001 ...)
  3. lat/lng 가 없는 항목은 국토지리원(GSI) 주소 검색 API 로 지오코딩
     (결과는 data/geocode_cache.json 에 캐시, 마스터 DB 에도 기록)
  4. 산출물 생성
     - data/restaurants.js        : 지도 앱(index.html)이 읽는 데이터
     - data/restaurants.csv       : 엑셀/구글 시트용 (UTF-8 BOM)
     - data/restaurants.geojson   : GIS/지도 도구용
     - exports/google-mymaps/*.kml, *.csv : 구글 내 지도(My Maps) 가져오기용
     - docs/LIST.md               : 깃허브에서 바로 읽는 목록

사용법
  python3 scripts/build.py              # 검증 + 지오코딩 + 산출물 생성
  python3 scripts/build.py --offline    # 지오코딩 없이 (좌표 없는 항목은 경고)
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import html
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import Counter, OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MASTER = DATA / "restaurants.json"
CACHE = DATA / "geocode_cache.json"

REGIONS = OrderedDict(
    osaka={"ko": "오사카", "pref": "大阪府", "tabelog": "osaka", "bbox": (34.25, 135.05, 35.10, 135.75), "color": "#e4572e"},
    kyoto={"ko": "교토", "pref": "京都府", "tabelog": "kyoto", "bbox": (34.70, 135.05, 35.80, 136.10), "color": "#7b2cbf"},
    kobe={"ko": "고베", "pref": "兵庫県", "tabelog": "hyogo", "bbox": (34.45, 134.50, 35.10, 135.50), "color": "#1d70b8"},
    nara={"ko": "나라", "pref": "奈良県", "tabelog": "nara", "bbox": (33.85, 135.55, 34.80, 136.25), "color": "#2a9d55"},
)

# 선정 근거 종류
REASON_TYPES = OrderedDict([
    ("타베로그", "🍽️"), ("유튜브", "▶️"), ("구글", "⭐"), ("미쉐린", "🎖️"),
    ("수상·백명점", "🏆"), ("노포·원조", "🏯"), ("현지평판", "👥"), ("언론·가이드", "📰"),
])

# 카테고리: (이모지, 색) — 지도 마커와 필터에 사용
CATEGORIES = OrderedDict([
    ("라멘", ("🍜", "#d1495b")),
    ("스시·해산물", ("🍣", "#ef8354")),
    ("오코노미야키", ("🥞", "#c97c10")),
    ("타코야키", ("🐙", "#e36414")),
    ("쿠시카츠", ("🍢", "#a4161a")),
    ("야키니쿠·호르몬", ("🥩", "#9d0208")),
    ("와규·스테이크", ("🐂", "#6a040f")),
    ("우동·소바", ("🍲", "#bc6c25")),
    ("튀김·돈카츠·규카츠", ("🍤", "#dda15e")),
    ("카레", ("🍛", "#b08900")),
    ("경양식·오므라이스", ("🍳", "#f4a261")),
    ("일식·카이세키", ("🍱", "#2a9d8f")),
    ("프렌치·이노베이티브", ("🍷", "#7b2cbf")),
    ("장어", ("🐟", "#264653")),
    ("야키토리·닭요리", ("🍗", "#bb3e03")),
    ("이자카야·다치노미", ("🍶", "#5e548e")),
    ("중화·교자", ("🥟", "#c1121f")),
    ("두부·쇼진요리", ("🥢", "#588157")),
    ("화과자·디저트", ("🍡", "#e56b6f")),
    ("카페·킷사텐", ("☕", "#6f4518")),
    ("베이커리", ("🥐", "#b5838d")),
    ("시장·길거리음식", ("🏮", "#f77f00")),
    ("기타", ("📍", "#6c757d")),
])

TAGS = {
    "노포", "원조", "현지인맛집", "줄서는집", "관광객인기", "한국인인기", "유튜브맛집", "미쉐린", "백명점",
    "예약필수", "현금만", "혼밥가능", "아침식사", "심야영업", "테이크아웃", "가성비", "고급", "웨이팅김",
}
RESERVATION = {"불가", "가능", "권장", "필수", None}

# 예약 방식: 여행자 입장에서 "어떻게 자리를 잡나"
BOOKING_TYPES = OrderedDict([
    ("앱예약", "📱"),       # 타베로그·TableCheck·OMAKASE 등 온라인 예약 확인
    ("전화예약만", "☎️"),   # 예약은 받지만 온라인 예약 없음 → AutoReserve 등 AI 전화대행 활용
    ("원격줄서기", "🎫"),   # 예약 불가, 앱/웹 번호표로 원격 대기
    ("현장방문", "🚶"),     # 예약 불가, 가서 줄 서기/바로 입장
])
# 흡연 (타베로그 「禁煙・喫煙」 기준)
SMOKING = OrderedDict([
    ("금연", "🚭"),       # 전면 금연
    ("분연", "🚪"),       # 별도 흡연실·구역, 좌석은 금연
    ("가열식만", "💨"),   # 좌석에서 가열식 담배(아이코스 등)만 허용
    ("흡연가능", "🚬"),   # 좌석 흡연 가능(시간대별 포함)
])
BOOKING_APPS = {
    "구글예약", "타베로그", "TableCheck", "OMAKASE", "핫페퍼", "잇큐", "구루나비", "포켓컨시어지", "byFood",
    "공식사이트", "EPARK", "Airウェイト", "LINE",
}

FIELD_ORDER = [
    "id", "name_ko", "name_ja", "name_en", "region", "area", "category", "signature", "why", "reasons", "tips",
    "address_ja", "address_building", "station", "phone", "lat", "lng", "geo",
    "price_level", "price_note", "hours", "closed", "hours_week", "hours_note", "notice", "reservation",
    "booking_type", "booking_apps", "booking_note", "booking_checked", "phone_booking", "lo_week", "closed_rule", "wait", "smoking", "smoking_note",
    "tabelog_url", "tabelog_score", "google_rating", "google_reviews", "google_maps_uri", "google_reservable",
    "google_status", "google_checked_at", "awards", "youtube", "tags", "legend_level", "editor_level", "icon", "evidence",
    "sources", "verified_open", "checked_at",
]
REQUIRED = ["name_ko", "name_ja", "region", "area", "category", "why", "address_ja", "legend_level"]

WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
# 예약 링크 우선순위 (한국인 기준으로 쓰기 쉬운 순)
BOOKING_PRIORITY = ["TableCheck", "타베로그", "OMAKASE", "구글예약", "공식사이트", "핫페퍼", "잇큐", "포켓컨시어지", "구루나비", "byFood"]
PRICE_LABEL = {1: "~1,500엔", 2: "1,500~4,000엔", 3: "4,000~10,000엔", 4: "10,000엔+"}
WAIT_LABEL = {0: "거의 없음", 1: "짧음 (~15분)", 2: "보통 (15~45분)", 3: "김 (45분+)"}
LEVEL_LABEL = {3: "필수 레전드", 2: "강력 추천", 1: "추천"}
LEVEL_RULE = {
    3: "타베로그 3.80 이상 · 미쉐린 별 · Tabelog Award 수상",
    2: "타베로그 3.60 이상 · 타베로그 백명점 · 미쉐린 빕구르망",
    1: "그 외 (노포·원조·유튜브 등 다른 이유로 선정)",
}


def evidence(r: dict) -> list[str]:
    """독립 근거 목록 (신뢰도 표시용)."""
    ev = []
    sc = r.get("tabelog_score") or 0
    aw = " ".join(r.get("awards") or [])
    types = {x.get("type") for x in r.get("reasons") or []}
    if sc >= 3.6:
        ev.append(f"타베로그 {sc:.2f}")
    if "백명점" in (r.get("tags") or []) or "백명점" in aw:
        ev.append("백명점")
    if "Award" in aw:
        ev.append("Tabelog Award")
    if "미쉐린" in aw or "미쉐린" in types:
        ev.append("미쉐린")
    g, n = r.get("google_rating"), r.get("google_reviews") or 0
    if g and g >= 4.2 and n >= 300:
        ev.append(f"구글 {g}")
    if "유튜브" in types:
        ev.append("유튜브")
    if "노포·원조" in types:
        ev.append("노포·원조")
    if "언론·가이드" in types:
        ev.append("언론·가이드")
    return ev


LO_TOKEN = re.compile(r"(?:L\.?\s?O\.?|라스트\s?오더|주문\s?마감|최종\s?입[장점]|입[장점]\s?마감)", re.I)
LO_TIMES = re.compile(r"^(?:\s*[:：]?\s*(?:요리|음식|푸드|식사|점심|저녁|런치|디너)?\s*(\d{1,2}:\d{2})(?!\s*[-~〜]\s*\d))((?:\s*[·/,、]\s*(?:요리|음식|푸드|식사|점심|저녁|런치|디너)?\s*\d{1,2}:\d{2}(?!\s*[-~〜]\s*\d))*)")


def last_orders(r: dict) -> list[int]:
    """영업시간 글에서 라스트오더(음식)·최종 입장 시각을 분으로 뽑음. 드링크 L.O. 는 제외."""
    text = " / ".join(x for x in (r.get("hours"), r.get("hours_note")) if x)
    out = set()
    for m in LO_TOKEN.finditer(text):
        if re.search(r"(드링크|음료|drink)\s*$", text[max(0, m.start() - 6):m.start()], re.I):
            continue
        t = LO_TIMES.match(text[m.end():])
        if not t:
            continue
        for hm in [t.group(1)] + re.findall(r"\d{1,2}:\d{2}", t.group(2) or ""):
            h, mi = map(int, hm.split(":"))
            if 0 <= h <= 29 and 0 <= mi < 60:
                out.add(h * 60 + mi)
    # "입점 17:00-19:00" 처럼 입장 가능한 시간대가 적힌 경우 → 끝 시각을 최종 입장으로
    for m in re.finditer(r"입[장점]\s*(?:가능\s*)?\(?\s*\d{1,2}:\d{2}\s*[-~〜]\s*(\d{1,2}):(\d{2})", text):
        out.add(int(m.group(1)) * 60 + int(m.group(2)))
    return sorted(out)


def lo_week(r: dict) -> dict | None:
    """요일별 영업 구간마다 라스트오더 시각 (구간 안에 들어가는 가장 이른 L.O.). 모르면 None."""
    hw, los = r.get("hours_week"), last_orders(r)
    if not hw or not los:
        return None
    tm = lambda x: int(x.split(":")[0]) * 60 + int(x.split(":")[1])
    out, any_lo = {}, False
    for day, ivs in hw.items():
        if not ivs:
            out[day] = ivs if ivs == [] else None
            continue
        row = []
        for o, c in ivs:
            om, cm = tm(o), tm(c)
            cands = [t for t in los + [t + 1440 for t in los] if om <= t < cm and cm - t <= 240]
            if cands:
                lo = min(cands)
                row.append(f"{lo // 60:02d}:{lo % 60:02d}")
                any_lo = True
            else:
                row.append(None)
        out[day] = row
    return out if any_lo else None


KO_WD = {"월": "mon", "화": "tue", "수": "wed", "목": "thu", "금": "fri", "토": "sat", "일": "sun"}
NTH = {"첫째": 1, "첫": 1, "둘째": 2, "두번째": 2, "셋째": 3, "세번째": 3, "넷째": 4, "네번째": 4, "다섯째": 5}


def closed_rule(r: dict) -> dict | None:
    """휴무 문구 → 규칙: hol(공휴일 영업/휴무), after(공휴일이면 다음 날 휴무), nth(매월 n째 주 요일 휴무)."""
    t = " ".join(x for x in (r.get("closed"), r.get("hours_note")) if x)
    if not t:
        return None
    rule = {}
    if re.search(r"공휴일이면\s*(다음\s*날|다음날|화|수|목)|공휴일\s*다음\s*\S*\s*휴무|공휴일인 경우 다음", t):
        rule["hol"], rule["after"] = "open", True
    elif re.search(r"공휴일(이면|은|에는|인 경우|에도)?\s*영업|공휴일[^)）]*영업\)|祝日営業", t) and not re.search(r"영업하는 경우|경우 있음", t):
        rule["hol"] = "open"
    else:
        bare = re.sub(r"[(（][^)）]*[)）]", "", r.get("closed") or "")
        if re.search(r"공휴일|祝", bare) or re.search(r"공휴일(도|포함)\s*휴무|공휴일 포함", t):
            rule["hol"] = "closed"
    nth = []
    for m in re.finditer(r"((?:(?:첫째|둘째|셋째|넷째|다섯째|첫|두번째|세번째|네번째)\s*[·,、]?\s*)+)(?:주\s*)?([월화수목금토일])(?:요일)?", t):
        for w in re.findall(r"첫째|둘째|셋째|넷째|다섯째|두번째|세번째|네번째|첫", m.group(1)):
            pair = [NTH[w], KO_WD[m.group(2)]]
            if pair not in nth:
                nth.append(pair)
    if nth:
        rule["nth"] = nth
    return rule or None


def legend_rule(r: dict) -> int:
    """레전드 등급을 타베로그·수상 기준으로 계산 (사용자가 타베로그를 신뢰하므로 투명한 규칙)."""
    sc = r.get("tabelog_score") or 0
    aw = " ".join(r.get("awards") or [])
    if sc >= 3.80 or re.search(r"미쉐린\s*\d\s*스타|미쉐린\s*[123]스타|Tabelog Award", aw):
        return 3
    if sc >= 3.60 or "백명점" in (r.get("tags") or []) or "백명점" in aw or "빕" in aw:
        return 2
    return 1


# ---------------------------------------------------------------- utils
def nfkc(s: str) -> str:
    return unicodedata.normalize("NFKC", s or "").strip()


def load_json(path: Path, default):
    if path.exists():
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    return default


def dump_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


def ordered(r: dict) -> OrderedDict:
    out = OrderedDict()
    for k in FIELD_ORDER:
        if k in r:
            out[k] = r[k]
    for k in r:  # 알 수 없는 필드는 뒤에 보존
        if k not in out:
            out[k] = r[k]
    return out


# ---------------------------------------------------------------- validate
def validate(items: list[dict]) -> list[str]:
    errors: list[str] = []
    seen: dict[tuple, str] = {}
    for i, r in enumerate(items):
        tag = f"[{i}] {r.get('name_ko') or r.get('name_ja') or '?'}"
        for k in REQUIRED:
            if r.get(k) in (None, "", []):
                errors.append(f"{tag}: 필수 필드 누락 '{k}'")
        reg = r.get("region")
        if reg not in REGIONS:
            errors.append(f"{tag}: region '{reg}' 은 {list(REGIONS)} 중 하나여야 함")
        elif r.get("address_ja") and not nfkc(r["address_ja"]).startswith(REGIONS[reg]["pref"]):
            errors.append(f"{tag}: address_ja 가 {REGIONS[reg]['pref']} 로 시작하지 않음 → {r['address_ja']}")
        if r.get("category") not in CATEGORIES:
            errors.append(f"{tag}: category '{r.get('category')}' 가 목록에 없음")
        if r.get("legend_level") not in (1, 2, 3):
            errors.append(f"{tag}: legend_level 은 1~3")
        if r.get("price_level") not in (1, 2, 3, 4, None):
            errors.append(f"{tag}: price_level 은 1~4 또는 null")
        if r.get("reservation") not in RESERVATION:
            errors.append(f"{tag}: reservation '{r.get('reservation')}' 은 {RESERVATION}")
        if r.get("booking_type") not in (*BOOKING_TYPES, None):
            errors.append(f"{tag}: booking_type '{r.get('booking_type')}' 은 {list(BOOKING_TYPES)} 또는 null")
        for b in r.get("booking_apps") or []:
            if not isinstance(b, dict) or not (b.get("app") in BOOKING_APPS or str(b.get("app", "")).startswith("기타:")):
                errors.append(f"{tag}: booking_apps 항목 이상 → {b}")
            elif b.get("url") and not re.match(r"^https?://", b["url"]):
                errors.append(f"{tag}: booking_apps url 이상 → {b['url']}")
        bad_tags = [t for t in r.get("tags") or [] if t not in TAGS]
        if bad_tags:
            errors.append(f"{tag}: 알 수 없는 태그 {bad_tags}")
        url = r.get("tabelog_url")
        if url and not re.match(r"^https://tabelog\.com/[a-z]+/A\d{4}/A\d{6}/\d{7,9}/?$", url):
            errors.append(f"{tag}: tabelog_url 형식 이상 → {url}")
        score = r.get("tabelog_score")
        if score is not None and not (isinstance(score, (int, float)) and 3.0 <= score <= 5.0):
            errors.append(f"{tag}: tabelog_score 범위 이상 → {score}")
        if r.get("smoking") not in (*SMOKING, None):
            errors.append(f"{tag}: smoking '{r.get('smoking')}' 은 {list(SMOKING)} 또는 null")
        wt = r.get("wait")
        if wt is not None and (not isinstance(wt, dict) or wt.get("level") not in (0, 1, 2, 3, None)):
            errors.append(f"{tag}: wait 형식 이상 → {wt}")
        hw = r.get("hours_week")
        if hw is not None:
            if not isinstance(hw, dict) or any(k not in WEEKDAYS for k in hw):
                errors.append(f"{tag}: hours_week 키는 {WEEKDAYS}")
            else:
                for k, v in hw.items():
                    if v is None:
                        continue
                    if not isinstance(v, list) or any(
                        not (isinstance(iv, list) and len(iv) == 2 and all(isinstance(t, str) and re.match(r"^\d{1,2}:\d{2}$", t) for t in iv))
                        for iv in v
                    ):
                        errors.append(f"{tag}: hours_week.{k} 형식 이상 → {v}")
        for rs in r.get("reasons") or []:
            if not isinstance(rs, dict) or rs.get("type") not in REASON_TYPES or not rs.get("detail"):
                errors.append(f"{tag}: reasons 항목 이상 → {rs}")
        g = r.get("google_rating")
        if g is not None and not (isinstance(g, (int, float)) and 1.0 <= g <= 5.0):
            errors.append(f"{tag}: google_rating 범위 이상 → {g}")
        gr = r.get("google_reviews")
        if gr is not None and not (isinstance(gr, int) and gr >= 0):
            errors.append(f"{tag}: google_reviews 는 0 이상 정수 → {gr}")
        for k in ("lat", "lng"):
            if r.get(k) is not None and not isinstance(r[k], (int, float)):
                errors.append(f"{tag}: {k} 는 숫자")
        key = (r.get("region"), nfkc(r.get("name_ja", "")))
        if key in seen:
            errors.append(f"{tag}: 중복 (같은 지역·같은 상호) ← {seen[key]}")
        seen[key] = tag
        ids = r.get("id")
        if ids is not None and not re.match(r"^(osaka|kyoto|kobe|nara)-\d{3}$", ids):
            errors.append(f"{tag}: id 형식 이상 → {ids}")
        if r.get("tabelog_score") is None or not r.get("tabelog_url"):
            errors.append(f"{tag}: 타베로그 점수·URL 은 필수")
        if r.get("phone_booking") is False and r.get("booking_type") == "전화예약만":
            errors.append(f"{tag}: 전화 예약 불가인데 booking_type=전화예약만")
    dup_ids = [k for k, v in Counter(r.get("id") for r in items if r.get("id")).items() if v > 1]
    for d in dup_ids:
        errors.append(f"id 중복: {d}")
    return errors


def cross_checks(items: list[dict]) -> list[str]:
    """필드 간 모순 점검 (경고)."""
    w = []
    for r in items:
        t = f"{r.get('id')} {r.get('name_ko')}"
        bt = r.get("booking_type")
        urls = [b for b in r.get("booking_apps") or [] if b.get("url")]
        if bt == "앱예약" and not urls:
            w.append(f"{t}: 온라인 예약 가능인데 예약 링크 없음")
        if bt == "전화예약만" and not r.get("phone"):
            w.append(f"{t}: 전화예약만인데 전화번호 없음")
        if bt == "현장방문" and r.get("reservation") in ("필수",):
            w.append(f"{t}: 현장방문인데 예약 필수")
    return w


def assign_ids(items: list[dict]) -> None:
    used = {r["id"] for r in items if r.get("id")}
    counters = Counter()
    for u in used:
        reg, n = u.split("-")
        counters[reg] = max(counters[reg], int(n))
    for r in items:
        if not r.get("id"):
            counters[r["region"]] += 1
            r["id"] = f"{r['region']}-{counters[r['region']]:03d}"
            used.add(r["id"])


# ---------------------------------------------------------------- geocode
def clean_address(addr: str) -> str:
    a = nfkc(addr)
    a = re.sub(r"\s+", "", a)
    a = re.sub(r"(?<=\d)[‐‑‒–—―−ーの](?=\d)", "-", a)  # 숫자 사이 각종 대시 통일
    a = re.sub(r"(\d+)丁目(?=\d)", r"\1-", a)
    a = re.sub(r"(\d+)番地?(?=\d)", r"\1-", a)
    a = re.sub(r"(\d+)(?:番地?|号)", r"\1", a)
    # 번지 뒤의 건물명 제거: 첫 번째 '숫자(-숫자)*' 덩어리까지만 남김
    m = re.match(r"^(\D*\d+(?:-\d+)*)", a)
    return m.group(1) if m else a


def in_bbox(lat: float, lng: float, bbox) -> bool:
    s, w, n, e = bbox
    return s <= lat <= n and w <= lng <= e


def gsi_geocode(query: str) -> list[dict]:
    url = "https://msearch.gsi.go.jp/address-search/AddressSearch?q=" + urllib.parse.quote(query)
    req = urllib.request.Request(url, headers={"User-Agent": "matzip-builder/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


KYOTO_DIR = re.compile(
    r"(区)\D*?(?:通|筋)\D*(?:上る|下る|上ル|下ル|西入ル|東入ル|西入る|東入る|西入|東入)(?:\d+丁目)?(?:[東西南北]側)?"
)
KYOTO_STREET = re.compile(r"(区)[^\d区]+?通(?=\D)")  # 例: 東山区四条通祇園町南側 → 東山区祇園町南側
ITAIJI = str.maketrans({"斉": "斎", "髙": "高", "﨑": "崎", "邉": "辺", "邊": "辺", "冨": "富", "嶋": "島"})
GENERIC_TOKENS = {"本店", "総本店", "本舗", "総本家", "本家", "支店", "店", "食堂", "お好み焼", "お好み焼き", "らーめん", "ラーメン", "鮨", "寿司"}
FOOD_TYPES = {
    "restaurant", "cafe", "fast_food", "bar", "pub", "food_court", "ice_cream", "biergarten",
    "confectionery", "bakery", "pastry", "deli", "tea", "coffee", "seafood", "butcher", "alcohol", "beverages",
}


def is_precise(title: str) -> bool:
    """GSI 결과가 번지(숫자)까지 매칭됐는지."""
    return bool(re.search(r"\d+(番地?|号)?$", nfkc(title)))


def candidates(addr: str) -> list[str]:
    q = clean_address(addr)
    out = [q]
    # 교토식 주소(○○通××上る/下る/西入/東入 + 町名)는 방향 표기를 빼고 町名+번지로 재시도
    for pat in (KYOTO_DIR, KYOTO_STREET):
        alt = clean_address(pat.sub(r"\1", nfkc(addr)))
        if alt not in out:
            out.append(alt)
    # 교토식: 区 + (마지막 町名) + 번지 만 남겨서 재시도  例) 錦小路堺町角菊屋町534-1 → 中京区菊屋町534-1
    a = re.sub(r"\s+", "", nfkc(addr))
    m = re.match(r"^(.+?区)(\D*?)(\d+(?:[-ー‐−]\d+)*)", a)
    if m:
        town = re.split(r"上る|下る|上ル|下ル|西入ル|東入ル|西入る|東入る|西入|東入|入ル|入る|角|通|側|丁目", m.group(2))[-1]
        if town and town != m.group(2):
            alt = clean_address(m.group(1) + town + m.group(3))
            if alt not in out:
                out.append(alt)
    # 이체자(異体字) 변형도 시도: 例) 斉藤町 → 斎藤町
    for c in list(out):
        v = c.translate(ITAIJI)
        if v not in out:
            out.append(v)
    return out


def nominatim_by_name(r: dict, near: dict | None, cache: dict, offline: bool):
    """GSI 가 번지까지 못 찾은 경우: OpenStreetMap 에서 상호명으로 검색 (음식점 종류 + 같은 구/시 + 근접성 확인)."""
    addr = nfkc(r["address_ja"])
    m = re.match(r"^.+?[都道府県](?:.+?郡)?(.+?[市町村])(.+?区)?", addr)
    ward = (m.group(2) or m.group(1)) if m else ""
    key = f"nominatim:{nfkc(r['name_ja'])}|{ward}"
    if key in cache:
        return cache[key] or None
    if offline:
        return None
    s_, w_, n_, e_ = REGIONS[r["region"]]["bbox"]
    best = None
    names = [nfkc(r["name_ja"])]
    parts = [x for x in re.split(r"[ 　()（）]", names[0]) if x]
    for x in (parts[0] if parts else "", parts[-1] if parts else ""):  # 例) '葛屋 中井春風堂' → '中井春風堂'
        if len(x) >= 2 and x not in names and x not in GENERIC_TOKENS:
            names.append(x)
    for name in names:
        url = (
            "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=jp&bounded=1"
            f"&viewbox={w_},{n_},{e_},{s_}&q=" + urllib.parse.quote(name)
        )
        req = urllib.request.Request(url, headers={"User-Agent": "matzip-builder/1.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            res = json.loads(resp.read().decode("utf-8"))
        time.sleep(1.1)  # Nominatim 이용 정책: 초당 1회 이하
        for x in res:
            if x.get("type") not in FOOD_TYPES:
                continue
            if ward and ward not in x.get("display_name", ""):
                continue
            lat, lng = float(x["lat"]), float(x["lon"])
            d = _dist_m(lat, lng, near["lat"], near["lng"]) if near else 0
            if near and d > 2500:
                continue
            if best is None or d < best["_d"]:
                best = {"lat": round(lat, 6), "lng": round(lng, 6), "title": x["display_name"][:80], "_d": d}
        if best:
            break
    if best:
        best.pop("_d", None)
    cache[key] = best or {}
    return best


def _dist_m(a_lat, a_lng, b_lat, b_lng) -> float:
    import math
    dy = (a_lat - b_lat) * 111_000
    dx = (a_lng - b_lng) * 111_000 * math.cos(math.radians(a_lat))
    return (dx * dx + dy * dy) ** 0.5


def lookup(q: str, reg: dict, cache: dict, offline: bool):
    if q in cache:
        return cache[q] or None
    if offline:
        return None
    res = gsi_geocode(q)
    time.sleep(0.3)
    # GSI 결과 제목에는 '郡' 이 빠지므로 시/정/촌 이름으로 대조 (例: 吉野郡吉野町 → 吉野町)
    city = re.match(r"^(.+?[都道府県])(?:.+?郡)?(.+?[市町村])", q)
    hit = None
    for f in res:
        lng, lat = f["geometry"]["coordinates"]
        title = f["properties"]["title"]
        if not in_bbox(lat, lng, reg["bbox"]):
            continue
        if city and city.group(2) not in nfkc(title):
            continue
        hit = {"lat": round(lat, 6), "lng": round(lng, 6), "title": title}
        break
    cache[q] = hit or {}
    return hit


def geocode(items: list[dict], offline: bool) -> list[str]:
    cache = load_json(CACHE, {})
    warnings = []
    for r in items:
        if isinstance(r.get("lat"), (int, float)) and isinstance(r.get("lng"), (int, float)):
            continue
        reg = REGIONS[r["region"]]
        best = None
        try:
            for q in candidates(r["address_ja"]):
                hit = lookup(q, reg, cache, offline)
                if hit and (best is None or (is_precise(hit["title"]) and not is_precise(best["title"]))):
                    best = hit
                if best and is_precise(best["title"]):
                    break
        except Exception as e:  # noqa: BLE001
            warnings.append(f"{r['id']} {r['name_ko']}: 지오코딩 실패 ({e})")
            continue
        if best and not is_precise(best["title"]):
            try:
                osm = nominatim_by_name(r, best, cache, offline)
            except Exception as e:  # noqa: BLE001
                osm = None
                warnings.append(f"{r['id']} {r['name_ko']}: OSM 검색 실패 ({e})")
            if osm:
                r["lat"], r["lng"], r["geo"] = osm["lat"], osm["lng"], f"osm:{osm['title']}"
                continue
        if best:
            r["lat"], r["lng"] = best["lat"], best["lng"]
            r["geo"] = f"gsi:{best['title']}"
            if not is_precise(best["title"]):
                warnings.append(f"{r['id']} {r['name_ko']}: 정밀도 낮음 → {best['title']} (주소: {r['address_ja']})")
        else:
            warnings.append(f"{r['id']} {r['name_ko']}: 좌표 없음 (주소: {r['address_ja']}) → lat/lng 수동 입력 필요")
    dump_json(CACHE, dict(sorted(cache.items())))
    return warnings


# ---------------------------------------------------------------- links
def localize_booking_url(u: str | None) -> str | None:
    """예약 링크를 한국어 페이지로: 타베로그 → /kr/, TableCheck → /ko/"""
    if not u:
        return None
    if re.match(r"^https://tabelog\.com/(?!kr/|en/)", u):
        return u.replace("https://tabelog.com/", "https://tabelog.com/kr/", 1)
    m = re.match(r"^https://(?:www\.)?tablecheck\.com/(?:(?:ja|en|ko|zh-CN|zh-TW)/)?(.*)$", u)
    if m:
        return "https://www.tablecheck.com/ko/" + m.group(1)
    return u


def links(r: dict) -> dict:
    reg = REGIONS[r["region"]]
    q = f"{r['name_ja']} {nfkc(r['address_ja'])}"
    gm = r.get("google_maps_uri") or ("https://www.google.com/maps/search/?api=1&query=" + urllib.parse.quote(q))
    nav = "https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=" + urllib.parse.quote(q)
    # 타베로그 가게 페이지는 한국어판(/kr/)으로 연결 — 점수·예약 가능 여부를 한국어로 확인 가능
    tb = (
        r["tabelog_url"].replace("https://tabelog.com/", "https://tabelog.com/kr/", 1)
        if r.get("tabelog_url")
        else f"https://tabelog.com/{reg['tabelog']}/rstLst/?vs=1&sk=" + urllib.parse.quote(r["name_ja"])
    )
    yt = "https://www.youtube.com/results?search_query=" + urllib.parse.quote(f"{r['name_ko']} {reg['ko']} 맛집")
    booking = []
    for b in r.get("booking_apps") or []:
        u = localize_booking_url(b.get("url"))
        if u:
            booking.append({"app": b["app"].replace("기타:", ""), "url": u})
    booking.sort(key=lambda b: BOOKING_PRIORITY.index(b["app"]) if b["app"] in BOOKING_PRIORITY else 99)
    return {
        "booking": booking,"google_maps": gm, "directions": nav, "tabelog": tb, "tabelog_is_search": not r.get("tabelog_url"), "youtube": yt}


def online_label(r: dict) -> str:
    bt = r.get("booking_type")
    return "가능" if bt == "앱예약" else ("미확인" if not bt else "불가")


def reasons_text(r: dict, sep: str = " / ") -> str:
    return sep.join(f"[{x['type']}] {x['detail']}" for x in r.get("reasons") or [])


def booking_text(r: dict) -> str:
    bt = r.get("booking_type")
    if not bt:
        return ""
    apps = ", ".join(b["app"] for b in r.get("booking_apps") or [])
    return f"{BOOKING_TYPES[bt]} {bt}" + (f" ({apps})" if apps else "")


# ---------------------------------------------------------------- outputs
def write_js(items: list[dict], generated: str) -> None:
    payload = {
        "generated": generated,
        "regions": {k: {"ko": v["ko"], "color": v["color"]} for k, v in REGIONS.items()},
        "categories": [{"name": k, "emoji": e, "color": c} for k, (e, c) in CATEGORIES.items()],
        "priceLabel": PRICE_LABEL,
        "waitLabel": WAIT_LABEL,
        "smokingTypes": [{"name": k, "emoji": v} for k, v in SMOKING.items()],
        "bookingTypes": [{"name": k, "emoji": v} for k, v in BOOKING_TYPES.items()],
        "reasonTypes": [{"name": k, "emoji": v} for k, v in REASON_TYPES.items()],
        "levelLabel": LEVEL_LABEL,
        "levelRule": LEVEL_RULE,
        "restaurants": [dict(r, links=links(r)) for r in items if r.get("lat") is not None],
    }
    with (DATA / "restaurants.js").open("w", encoding="utf-8") as f:
        f.write("// 자동 생성 파일 — 직접 수정하지 말고 data/restaurants.json 수정 후 scripts/build.py 실행\n")
        f.write("window.MATZIP = ")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")


CSV_COLS = [
    "id", "region", "area", "name_ko", "name_ja", "name_en", "category", "signature", "legend_level",
    "online_booking", "booking_type", "booking_apps", "booking_urls", "booking_note", "smoking", "smoking_note", "wait", "wait_estimate", "wait_best_time", "reasons",
    "tabelog_score", "google_rating", "google_reviews",
    "price_level", "price_note", "hours", "closed", "reservation", "awards", "youtube",
    "tags", "why", "tips", "address_ja", "address_building", "station", "phone", "lat", "lng",
    "google_maps", "tabelog", "youtube_search", "sources",
]


def row_for_csv(r: dict) -> dict:
    lk = links(r)
    return {
        "id": r["id"], "region": REGIONS[r["region"]]["ko"], "area": r["area"],
        "name_ko": r["name_ko"], "name_ja": r["name_ja"], "name_en": r.get("name_en") or "",
        "category": r["category"], "signature": r.get("signature") or "", "legend_level": r["legend_level"],
        "price_level": r.get("price_level") or "", "price_note": r.get("price_note") or "",
        "hours": r.get("hours") or "", "closed": r.get("closed") or "", "reservation": r.get("reservation") or "",
        "online_booking": online_label(r), "reasons": reasons_text(r),
        "smoking": r.get("smoking") or "", "smoking_note": r.get("smoking_note") or "",
        "wait": WAIT_LABEL.get((r.get("wait") or {}).get("level"), ""),
        "wait_estimate": (r.get("wait") or {}).get("estimate") or "",
        "wait_best_time": (r.get("wait") or {}).get("best_time") or "",
        "google_rating": r.get("google_rating") or "", "google_reviews": r.get("google_reviews") or "",
        "booking_type": r.get("booking_type") or "",
        "booking_apps": " | ".join(b["app"] for b in r.get("booking_apps") or []),
        "booking_urls": " ".join(b["url"] for b in r.get("booking_apps") or [] if b.get("url")),
        "booking_note": r.get("booking_note") or "",
        "tabelog_score": r.get("tabelog_score") or "", "awards": " | ".join(r.get("awards") or []),
        "youtube": " | ".join(r.get("youtube") or []), "tags": " ".join("#" + t for t in r.get("tags") or []),
        "why": r["why"], "tips": r.get("tips") or "", "address_ja": r["address_ja"],
        "address_building": r.get("address_building") or "", "station": r.get("station") or "",
        "phone": r.get("phone") or "",
        "lat": r.get("lat") or "", "lng": r.get("lng") or "",
        "google_maps": lk["google_maps"], "tabelog": lk["tabelog"], "youtube_search": lk["youtube"],
        "sources": " ".join(r.get("sources") or []),
    }


def write_csv(path: Path, rows: list[dict], cols: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for row in rows:
            w.writerow({k: row.get(k, "") for k in cols})


def write_geojson(items: list[dict]) -> None:
    feats = []
    for r in items:
        if r.get("lat") is None:
            continue
        props = {k: v for k, v in r.items() if k not in ("lat", "lng")}
        props["links"] = links(r)
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [r["lng"], r["lat"]]}, "properties": props})
    dump_json(DATA / "restaurants.geojson", {"type": "FeatureCollection", "features": feats})


def description_html(r: dict) -> str:
    lk = links(r)
    e = html.escape
    parts = [
        f"<b>{e(r['category'])}</b> · {e(r['area'])} · {'★' * r['legend_level']} {e(LEVEL_LABEL[r['legend_level']])}",
        f"<b>대표 메뉴</b> {e(r.get('signature') or '-')}",
        e(r["why"]),
    ]
    if r.get("reasons"):
        parts.append("<b>선정 이유</b><br>" + "<br>".join(f"{REASON_TYPES[x['type']]} {e(x['detail'])}" for x in r["reasons"]))
    parts.insert(1, f"<b>온라인 예약 {online_label(r)}</b>" + (f" · {e(booking_text(r))}" if r.get("booking_type") else ""))
    if r.get("tips"):
        parts.append(f"<b>팁</b> {e(r['tips'])}")
    meta = []
    if r.get("price_note") or r.get("price_level"):
        meta.append(f"가격 {e(r.get('price_note') or PRICE_LABEL[r['price_level']])}")
    if r.get("hours"):
        meta.append(f"영업 {e(r['hours'])}")
    if r.get("closed"):
        meta.append(f"휴무 {e(r['closed'])}")
    if r.get("booking_type"):
        meta.append(f"예약 {e(booking_text(r))}")
    elif r.get("reservation"):
        meta.append(f"예약 {e(r['reservation'])}")
    if r.get("tabelog_score"):
        meta.append(f"타베로그 {r['tabelog_score']}")
    if r.get("google_rating"):
        meta.append(f"구글 {r['google_rating']}" + (f" ({r['google_reviews']:,})" if r.get("google_reviews") else ""))
    if meta:
        parts.append(" / ".join(meta))
    if r.get("booking_note"):
        parts.append(f"<b>예약 팁</b> {e(r['booking_note'])}")
    if r.get("smoking"):
        parts.append(f"<b>{SMOKING[r['smoking']]} 흡연</b> {e(r['smoking'])}" + (f" — {e(r['smoking_note'])}" if r.get("smoking_note") else ""))
    w = r.get("wait") or {}
    if w.get("level") is not None or w.get("estimate"):
        parts.append(f"<b>⏳ 예상 웨이팅</b> {e(WAIT_LABEL.get(w.get('level'), ''))} {e(w.get('estimate') or '')}" + (f"<br>추천 시간: {e(w['best_time'])}" if w.get("best_time") else ""))
    book_links = [f'<a href="{e(b["url"])}">{e(b["app"])} 예약</a>' for b in r.get("booking_apps") or [] if b.get("url")]
    if book_links:
        parts.append(" · ".join(book_links))
    if r.get("awards"):
        parts.append("🏆 " + e(", ".join(r["awards"])))
    parts.append(f"{e(r['name_ja'])}<br>{e(r['address_ja'])} {e(r.get('address_building') or '')}")
    parts.append(f'<a href="{e(lk["google_maps"])}">구글맵(상호 검색)</a> · <a href="{e(lk["tabelog"])}">타베로그</a> · <a href="{e(lk["youtube"])}">유튜브 검색</a>')
    return "<br><br>".join(parts)


def write_mymaps(items: list[dict]) -> None:
    out = ROOT / "exports" / "google-mymaps"
    out.mkdir(parents=True, exist_ok=True)
    for reg, meta in REGIONS.items():
        rs = [r for r in items if r["region"] == reg and r.get("lat") is not None]
        if not rs:
            continue
        # KML
        lines = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
            f"<name>{html.escape(meta['ko'])} 레전드 맛집</name>",
        ]
        for r in rs:
            lines.append(
                "<Placemark>"
                f"<name>{html.escape(r['name_ko'])} ⭐{r['tabelog_score']:.2f}</name>"
                f"<description><![CDATA[{description_html(r)}]]></description>"
                "<ExtendedData>"
                f'<Data name="카테고리"><value>{html.escape(r["category"])}</value></Data>'
                f'<Data name="등급"><value>{"★" * r["legend_level"]}</value></Data>'
                f'<Data name="지역"><value>{html.escape(r["area"])}</value></Data>'
                "</ExtendedData>"
                f"<Point><coordinates>{r['lng']},{r['lat']},0</coordinates></Point>"
                "</Placemark>"
            )
        lines.append("</Document></kml>")
        (out / f"{reg}.kml").write_text("\n".join(lines) + "\n", encoding="utf-8")
        # CSV (My Maps 에서 '카테고리' 열로 스타일 지정 가능)
        rows = [
            {
                "이름": f"{r['name_ko']} ⭐{r['tabelog_score']:.2f}", "일본어": r["name_ja"], "타베로그점수": f"{r['tabelog_score']:.2f}",
                "위도": r["lat"], "경도": r["lng"],
                "카테고리": r["category"], "등급": "★" * r["legend_level"], "지역": r["area"],
                "온라인예약": online_label(r), "흡연": r.get("smoking") or "미확인", "선정이유": reasons_text(r),
                "예상웨이팅": " ".join(x for x in [WAIT_LABEL.get((r.get("wait") or {}).get("level"), ""), (r.get("wait") or {}).get("estimate") or ""] if x),
                "대표메뉴": r.get("signature") or "", "설명": r["why"], "팁": r.get("tips") or "",
                "가격": r.get("price_note") or PRICE_LABEL.get(r.get("price_level"), ""),
                "영업시간": r.get("hours") or "", "휴무": r.get("closed") or "",
                "예약방식": r.get("booking_type") or "미확인",
                "예약앱": ", ".join(b["app"] for b in r.get("booking_apps") or []),
                "예약링크": " ".join(b["url"] for b in r.get("booking_apps") or [] if b.get("url")),
                "주소": r["address_ja"], "전화": r.get("phone") or "", "타베로그": links(r)["tabelog"],
                "구글맵(상호검색)": links(r)["google_maps"],
            }
            for r in rs
        ]
        write_csv(out / f"{reg}.csv", rows, list(rows[0].keys()))


def write_list_md(items: list[dict], generated: str) -> None:
    """docs/LIST.md(목차) + docs/list/<지역>.md(지역별 상세). 한 파일이 너무 크면 깃허브 모바일에서 느려서 분리."""
    (ROOT / "docs" / "list").mkdir(parents=True, exist_ok=True)
    index = [
        "# 간사이 레전드 맛집 목록",
        "",
        f"> 데이터 기준일 {generated} · 총 {len(items)}곳",
        "> 등급: ★★★ " + LEVEL_RULE[3] + " / ★★ " + LEVEL_RULE[2] + " / ★ " + LEVEL_RULE[1] + " · 🏯 지역 상징(점수 기준 밖이지만 꼭 가볼 만한 원조·명물)",
        "> 온라인 예약: ✅ 가능 / 🚫 불가(☎️ 전화예약만 · 🎫 원격줄서기 · 🚶 현장방문) — 앱 사용법은 [README 예약 앱 가이드](../README.md#-예약-앱-가이드)",
        "",
    ]
    for reg, meta in REGIONS.items():
        n = sum(1 for r in items if r["region"] == reg)
        if n:
            index.append(f"- **[{meta['ko']} ({n}곳)](list/{reg}.md)**")
    index += ["", "동네별로 빨리 고르려면 → [거점별 치트시트](CHEATSHEET.md)", ""]
    (ROOT / "docs" / "LIST.md").write_text("\n".join(index), encoding="utf-8")
    for reg, meta in REGIONS.items():
        rs = [r for r in items if r["region"] == reg]
        if not rs:
            continue
        lines = [
            f"# {meta['ko']} 레전드 맛집 ({len(rs)}곳)",
            "",
            f"> 데이터 기준일 {generated} · [← 목록](../LIST.md) · [거점별 치트시트](../CHEATSHEET.md)",
            "> 등급 ★★★ " + LEVEL_RULE[3] + " · ★★ " + LEVEL_RULE[2] + " · 🏯 지역 상징",
            "> 영업시간·휴무는 수시로 바뀌니 방문 전 구글 지도/타베로그에서 꼭 다시 확인하세요.",
            "",
        ]
        # 한눈에 보기 표
        lines += ["## 한눈에 보기 (등급·점수순)", ""]
        for r in sorted(rs, key=lambda x: (-x["legend_level"], -(x.get("tabelog_score") or 0))):
            ob = online_label(r)
            ob = "✅ 가능" if ob == "가능" else ("❔" if ob == "미확인" else f"🚫 {BOOKING_TYPES[r['booking_type']]} {r['booking_type']}")
            g = f"{r['google_rating']}" + (f" ({r['google_reviews']:,})" if r.get("google_reviews") else "") if r.get("google_rating") else ""
            lines.append(
                f"- {'★' * r['legend_level']} **{format(r['tabelog_score'], '.2f')}** [{r['name_ko']}](#{r['id']}) "
                f"· {CATEGORIES[r['category']][0]} {r['category']} · {r['area']} · {ob}" + (f" · 구글 {g}" if g else "")
            )
        lines.append("")
        areas = OrderedDict()
        for r in sorted(rs, key=lambda x: (x["area"], -x["legend_level"], x["name_ko"])):
            areas.setdefault(r["area"], []).append(r)
        for area, ars in areas.items():
            lines += [f"### {area}", ""]
            for r in ars:
                lk = links(r)
                lines.append(f'<a id="{r["id"]}"></a>')
                lines.append(f"#### {'★' * r['legend_level']}{' 🏯' if r.get('icon') else ''} {r['name_ko']} ({r['name_ja']}) — {CATEGORIES[r['category']][0]} {r['category']} · 타베로그 {r['tabelog_score']:.2f}")
                lines.append("")
                lines.append(f"{r['why']}")
                lines.append("")
                if r.get("reasons"):
                    lines.append("**선정 이유**")
                    for x in r["reasons"]:
                        d = f"[{x['detail']}]({x['url']})" if x.get("url") else x["detail"]
                        lines.append(f"- {REASON_TYPES[x['type']]} **{x['type']}** {d}")
                    lines.append("")
                ob = online_label(r)
                if ob == "가능":
                    apps = ", ".join(f"[{b['app']}]({b['url']})" for b in lk["booking"]) or ", ".join(b["app"] for b in r.get("booking_apps") or [])
                    lines.append(f"- **온라인 예약: ✅ 가능** {('· ' + apps) if apps else ''}")
                elif ob == "불가":
                    lines.append(f"- **온라인 예약: 🚫 불가** · {BOOKING_TYPES[r['booking_type']]} {r['booking_type']}")
                else:
                    lines.append("- **온라인 예약: ❔ 미확인**")
                if r.get("booking_note"):
                    lines.append(f"- 예약 팁: {r['booking_note']}")
                if r.get("smoking"):
                    lines.append(f"- {SMOKING[r['smoking']]} 흡연: **{r['smoking']}**" + (f" — {r['smoking_note']}" if r.get("smoking_note") else ""))
                w = r.get("wait") or {}
                if w.get("level") is not None or w.get("estimate"):
                    lines.append(f"- ⏳ 예상 웨이팅: **{WAIT_LABEL.get(w.get('level'), '?')}**" + (f" — {w['estimate']}" if w.get("estimate") else ""))
                    if w.get("best_time"):
                        lines.append(f"- 🕐 추천 방문: {w['best_time']}")
                    if w.get("queue_system"):
                        lines.append(f"- 🎫 {w['queue_system']}")
                    if w.get("sellout"):
                        lines.append(f"- ⚠️ {w['sellout']}")
                if r.get("phone"):
                    lines.append(f"- 📞 [{r['phone']}](tel:{r['phone'].replace('-', '')})")
                if r.get("notice"):
                    lines.append(f"- ⚠️ 공지: {r['notice']}")
                if r.get("signature"):
                    lines.append(f"- 대표 메뉴: {r['signature']}")
                price = r.get("price_note") or PRICE_LABEL.get(r.get("price_level"), "")
                if price:
                    lines.append(f"- 가격: {price}")
                hc = " / ".join(x for x in [r.get("hours") and f"영업 {r['hours']}", r.get("closed") and f"휴무 {r['closed']}"] if x)
                if hc:
                    lines.append(f"- {hc}")
                if r.get("tips"):
                    lines.append(f"- 💡 {r['tips']}")
                if r.get("station"):
                    lines.append(f"- 🚃 {r['station']}")
                lines.append(f"- [구글 지도]({lk['google_maps']}) · [길찾기]({lk['directions']}) · [타베로그]({lk['tabelog']}) · [유튜브]({lk['youtube']})")
                lines.append("")
        (ROOT / "docs" / "list" / f"{reg}.md").write_text("\n".join(lines), encoding="utf-8")

def wait_short(r: dict) -> str:
    w = r.get("wait") or {}
    lv = w.get("level")
    if lv is None:
        return "예약 시 없음" if r.get("booking_type") == "앱예약" else ""
    return {0: "거의 없음", 1: "~15분", 2: "15~45분", 3: "⚠️ 45분+"}[lv]


def write_cheatsheet(items: list[dict], generated: str) -> None:
    """거점(세부 지역)별 치트시트: 현지에서 '여기 근처 뭐 먹지?' 할 때 보는 표."""
    yen = {1: "¥", 2: "¥¥", 3: "¥¥¥", 4: "¥¥¥¥"}
    lines = [
        "# 📍 거점별 맛집 치트시트",
        "",
        f"> 자동 생성 ({generated}) · 지금 있는 동네를 찾아서 타베로그 점수 높은 순으로 고르세요.",
        "> 웨이팅은 최근 후기 기반 예상치(피크 시간 기준)이며 실시간이 아닙니다. 🚬 흡연 가능 / 💨 가열식 담배만 인 곳은 표시해 두었습니다(나머지는 금연·분연).",
        "> ✅ 온라인 예약 가능 · ☎️ 전화예약만 · 🎫 원격줄서기 · 🚶 현장방문(예약 불가) · 가격은 1인 기준 ¥ ~1,500엔 / ¥¥ ~4,000엔 / ¥¥¥ ~10,000엔 / ¥¥¥¥ 10,000엔+",
        "> 가게 이름을 누르면 상세(선정 이유·영업시간·예약·팁)로 이동합니다. ★ 등급: ★★★ " + LEVEL_RULE[3] + " · 🏯 지역 상징",
        "",
    ]
    toc = []
    body = []
    for reg, meta in REGIONS.items():
        rs = [r for r in items if r["region"] == reg]
        if not rs:
            continue
        areas = OrderedDict()
        for r in sorted(rs, key=lambda x: x["area"]):
            areas.setdefault(r["area"], []).append(r)
        areas = OrderedDict(sorted(areas.items(), key=lambda kv: -len(kv[1])))
        toc.append(f"**{meta['ko']}**: " + " · ".join(f"[{a}](#{meta['ko']}--{a.replace('·', '')})" for a in areas))
        body += [f"## {meta['ko']}", ""]
        for area, ars in areas.items():
            body += [f'<a id="{meta["ko"]}--{area.replace("·", "")}"></a>', "", f"### {meta['ko']} · {area} ({len(ars)}곳)", ""]
            # 폰(깃허브 앱)에서 읽기 쉽게: 넓은 표 대신 한 가게 = 두 줄
            for r in sorted(ars, key=lambda x: (-(x.get("tabelog_score") or 0), -x["legend_level"])):
                bt = r.get("booking_type")
                book = "✅ 온라인" if bt == "앱예약" else (f"{BOOKING_TYPES[bt]} {bt.replace('예약만', '만')}" if bt else "❔")
                one = re.split(r"[(（,，、/]", (r.get("signature") or ""))[0].strip().replace("|", "/")
                if len(one) > 30:
                    one = one[:30].rsplit(" ", 1)[0] + "…"
                wt = wait_short(r)
                body.append(
                    f"- **{(format(r['tabelog_score'], '.2f') if r.get('tabelog_score') else '-')}** "
                    f"[**{r['name_ko']}**](list/{r['region']}.md#{r['id']}) {'★' * r['legend_level']}{' 🏯' if r.get('icon') else ''} "
                    f"· {CATEGORIES[r['category']][0]} {r['category']} · {yen.get(r.get('price_level'), '')}  \n"
                    f"  {book}" + (f" · ⏳ {wt}" if wt else "")
                    + (f" · {SMOKING[r['smoking']]} {r['smoking']}" if r.get("smoking") in ("흡연가능", "가열식만") else "")
                    + (f" · {one}" if one else "")
                )
            body.append("")
    lines += toc + [""] + body
    (ROOT / "docs" / "CHEATSHEET.md").write_text("\n".join(lines), encoding="utf-8")


def write_readme_stats(items: list[dict], generated: str) -> None:
    readme = ROOT / "README.md"
    if not readme.exists():
        return
    text = readme.read_text(encoding="utf-8")
    start, end = "<!-- STATS:START -->", "<!-- STATS:END -->"
    if start not in text or end not in text:
        return
    by_reg = Counter(r["region"] for r in items)
    lv3 = Counter(r["region"] for r in items if r["legend_level"] == 3)
    cats = Counter(r["category"] for r in items)
    lines = [
        start,
        f"**총 {len(items)}곳** (데이터 기준일 {generated})",
        "",
        "| 지역 | 맛집 수 | ★★★ 필수 레전드 |",
        "|---|---:|---:|",
    ]
    for k, meta in REGIONS.items():
        if by_reg[k]:
            lines.append(f"| {meta['ko']} | {by_reg[k]} | {lv3[k]} |")
    on = Counter(online_label(r) for r in items)
    lines += ["", f"**온라인 예약 가능 {on['가능']}곳** · 불가 {on['불가']}곳 · 미확인 {on['미확인']}곳"]
    sm = Counter(r.get("smoking") or "미확인" for r in items)
    lines += ["", "흡연: " + " · ".join(f"{SMOKING.get(k, '❔')} {k} {sm[k]}" for k in [*SMOKING, "미확인"] if sm[k])]
    bts = Counter(r.get("booking_type") or "미확인" for r in items)
    lines += ["", "예약: " + " · ".join(f"{BOOKING_TYPES.get(k, '❔')} {k} {bts[k]}" for k in [*BOOKING_TYPES, "미확인"] if bts[k])]
    lines += ["", "카테고리: " + " · ".join(f"{CATEGORIES[c][0]} {c} {n}" for c, n in cats.most_common()), end]
    head, rest = text.split(start, 1)
    _, tail = rest.split(end, 1)
    readme.write_text(head + "\n".join(lines) + tail, encoding="utf-8")


# ---------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="지오코딩 API 호출 안 함")
    args = ap.parse_args()

    items = load_json(MASTER, [])
    errors = validate(items)
    if errors:
        print("❌ 검증 실패:")
        for e in errors:
            print("  -", e)
        return 1

    assign_ids(items)
    for r in items:
        if "editor_level" not in r:
            r["editor_level"] = r.get("legend_level")  # 조사 단계에서 매긴 등급(참고용)
        r["legend_level"] = legend_rule(r)
        r["evidence"] = evidence(r)
        # 가격대 보정: 저녁 가격이 1만 엔 이상에서 시작하거나(8천~1.5만 엔 이상처럼) 1만 엔을 크게 넘으면 ¥¥¥¥
        pn = r.get("price_note") or ""
        seg = re.search(r"(?:저녁|디너)[^0-9]{0,8}(\d{1,3}(?:,\d{3})+|\d{4,6})\s*[~〜-]\s*(\d{1,3}(?:,\d{3})+|\d{4,6})", pn)
        if r.get("price_level") == 3 and seg:
            lo_p, hi_p = (int(x.replace(",", "")) for x in seg.groups())
            if lo_p >= 10000 or (lo_p >= 8000 and hi_p >= 15000):
                r["price_level"] = 4
        cr = closed_rule(r)
        if cr:
            r["closed_rule"] = cr
        else:
            r.pop("closed_rule", None)
        lw = lo_week(r)
        if lw:
            r["lo_week"] = lw
        else:
            r.pop("lo_week", None)
        if r.get("google_maps_uri"):  # 구글이 붙이는 추적 파라미터(g_mp) 제거 — 링크는 그대로 열림, 데이터 용량 절감
            r["google_maps_uri"] = re.sub(r"&g_mp=[^&]*", "", r["google_maps_uri"])
        for x in r.get("reasons") or []:
            if x.get("url"):
                x["url"] = re.sub(r"&g_mp=[^&]*", "", x["url"])
        # 조사자가 '꼭 가볼 곳'으로 봤지만 점수 기준 ★★★ 가 아닌 곳 → 지역 상징 배지
        r["icon"] = bool(r.get("editor_level") == 3 and r["legend_level"] < 3)
    warnings = geocode(items, args.offline)
    # 같은 좌표에 겹치는 핀은 몇 미터씩 떨어뜨려 둘 다 누를 수 있게
    seen_xy = Counter()
    for r in items:
        if r.get("lat") is None:
            continue
        k = (round(r["lat"], 5), round(r["lng"], 5))
        if seen_xy[k]:
            r["lat"] = round(r["lat"] + 0.00006 * seen_xy[k], 6)
            r["lng"] = round(r["lng"] + 0.00006 * seen_xy[k], 6)
        seen_xy[k] += 1
    warnings += cross_checks(items)
    # 타베로그 점수는 필수 (사용자 요구사항) — 빠진 곳은 경고
    for r in items:
        if r.get("tabelog_score") is None:
            warnings.append(f"{r['id']} {r['name_ko']}: 타베로그 점수 없음 (필수)")
        elif not r.get("tabelog_url"):
            warnings.append(f"{r['id']} {r['name_ko']}: 타베로그 URL 없음")
    # (checked_at 은 실제로 확인한 날짜만 기록 — 자동으로 오늘 날짜를 넣지 않음)

    region_rank = {k: i for i, k in enumerate(REGIONS)}
    items.sort(key=lambda r: (region_rank[r["region"]], int(r["id"].split("-")[1])))
    dump_json(MASTER, [ordered(r) for r in items])

    # 데이터 기준일 = 가장 최근에 실제 확인한 날짜 (빌드 날짜가 아님)
    generated = max((r.get("checked_at") or "" for r in items), default="") or dt.date.today().isoformat()
    write_js(items, generated)
    write_csv(DATA / "restaurants.csv", [row_for_csv(r) for r in items], CSV_COLS)
    write_geojson(items)
    write_mymaps(items)
    write_list_md(items, generated)
    write_cheatsheet(items, generated)
    write_readme_stats(items, generated)

    by_reg = Counter(REGIONS[r["region"]]["ko"] for r in items)
    by_cat = Counter(r["category"] for r in items)
    print(f"✅ {len(items)}곳 빌드 완료: " + ", ".join(f"{k} {v}" for k, v in by_reg.items()))
    print("   카테고리: " + ", ".join(f"{k} {v}" for k, v in by_cat.most_common()))
    print("   예약: " + ", ".join(f"{k} {v}" for k, v in Counter(r.get("booking_type") or "미확인" for r in items).most_common()))
    if warnings:
        print(f"⚠️  경고 {len(warnings)}건:")
        for w in warnings:
            print("  -", w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
