#!/usr/bin/env python3
"""(선택) Google Places API 로 구글 평점·리뷰 수·예약 가능 표시·영업 상태를 채우는 스크립트.

구글 지도 평점은 Places API 키가 있어야 정확하게 가져올 수 있습니다.
키가 있으면 아래처럼 실행한 뒤 build.py 를 다시 돌리세요.

  export GOOGLE_MAPS_API_KEY=...        # Google Cloud 콘솔에서 'Places API (New)' 사용 설정한 키
  python3 scripts/google_places.py      # data/restaurants.json 갱신
  python3 scripts/build.py              # 산출물 재생성

옵션
  --only-missing   google_rating 이 비어 있는 가게만 조회 (기본: 전체)
  --dry-run        파일을 바꾸지 않고 결과만 출력
  --fill-hours     요일별 영업시간(hours_week)이 비었거나 일부 요일이 '모름'인 가게만 구글 영업시간으로 그 요일을 채움

채우는 필드
  google_rating, google_reviews, google_maps_uri, google_reservable, google_checked_at
  + 평점 4.2 이상 & 리뷰 300개 이상이면 reasons 에 "구글" 근거를 자동으로 추가/갱신
  + 구글에 '폐업'으로 나오면 경고 출력 (자동 삭제는 하지 않음)

요금: Text Search (New) 요청 1건/가게. 최신 요금과 월 무료 사용량은 Google Maps Platform 가격표를 확인하세요.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
import math
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / "data" / "restaurants.json"
ENDPOINT = "https://places.googleapis.com/v1/places:searchText"
FIELDS = ",".join([
    "places.id", "places.displayName", "places.formattedAddress", "places.location",
    "places.rating", "places.userRatingCount", "places.businessStatus", "places.reservable", "places.googleMapsUri",
])


PAGE_FIELD = ["pageSize"]  # 구버전 API 면 maxResultCount 로 자동 전환
GENERIC = {"本店", "総本店", "本舗", "総本家", "本家", "支店", "店", "食堂", "お好み焼", "お好み焼き", "らーめん", "ラーメン", "鮨", "寿司", "珈琲", "喫茶"}


class ApiError(Exception):
    def __init__(self, code: int, body: str):
        super().__init__(f"HTTP {code} {body}")
        self.code = code


HOURS_FIELDS = ",".join(["places.id", "places.displayName", "places.location", "places.regularOpeningHours"])
GDAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]  # 구글 day 0 = 일요일


def google_week(p: dict) -> dict | None:
    """구글 regularOpeningHours.periods → {"mon": [["11:00","15:00"], ...], ...} (자정 넘김은 25:30 식)."""
    periods = (p.get("regularOpeningHours") or {}).get("periods") or []
    if not periods:
        return None
    week = {k: [] for k in GDAY}
    for pr in periods:
        o, c = pr.get("open") or {}, pr.get("close")
        if "day" not in o:
            continue
        if not c:  # 24시간 영업
            week[GDAY[o["day"]]].append(["00:00", "24:00"])
            continue
        ch = c.get("hour", 0) + 24 * ((c.get("day", o["day"]) - o["day"]) % 7)
        week[GDAY[o["day"]]].append([f"{o.get('hour', 0):02d}:{o.get('minute', 0):02d}", f"{ch:02d}:{c.get('minute', 0):02d}"])
    for k in week:
        week[k].sort()
    return week


def search(key: str, r: dict, fields: str = FIELDS) -> dict | None:
    for _ in range(2):
        body = {
            "textQuery": f"{r['name_ja']} {r['address_ja']}",
            "languageCode": "ja",
            "regionCode": "JP",
            PAGE_FIELD[0]: 1,
        }
        if isinstance(r.get("lat"), (int, float)):
            body["locationBias"] = {"circle": {"center": {"latitude": r["lat"], "longitude": r["lng"]}, "radius": 500.0}}
        req = urllib.request.Request(
            ENDPOINT,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": fields},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                places = json.loads(resp.read().decode("utf-8")).get("places") or []
            return places[0] if places else None
        except urllib.error.HTTPError as e:
            txt = e.read()[:2000].decode("utf-8", "replace")
            if e.code == 400 and "pageSize" in txt and PAGE_FIELD[0] == "pageSize":
                PAGE_FIELD[0] = "maxResultCount"  # 구버전 필드로 한 번 재시도
                print("ℹ️  pageSize 미지원 → maxResultCount 로 재시도")
                continue
            raise ApiError(e.code, txt)
    return None


def dist_m(a_lat, a_lng, b_lat, b_lng) -> float:
    dy = (a_lat - b_lat) * 111_000
    dx = (a_lng - b_lng) * 111_000 * math.cos(math.radians(a_lat))
    return math.hypot(dx, dy)


def _kana(x: str) -> str:
    """가타카나→히라가나, 기호·공백 제거 (ハジメ/はじめ, 稲荷ふたば/いなりふたば 비교용)."""
    x = unicodedata.normalize("NFKC", x or "").lower()
    x = "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in x)
    return __import__("re").sub(r"[\s()（）・'’\-_.%&｜|]", "", x)


def same_place(r: dict, p: dict) -> tuple[bool, str]:
    """엉뚱한 가게를 붙이지 않도록: (상호 일치 & 300m 이내) 또는 (상호 강하게 일치 & 1.5km 이내, 우리 좌표가 대략적일 때)
    또는 (같은 건물 수준 80m 이내)."""
    loc = p.get("location") or {}
    d = None
    if isinstance(r.get("lat"), (int, float)) and loc:
        d = dist_m(r["lat"], r["lng"], loc.get("latitude", 0), loc.get("longitude", 0))
    a, b = _kana(r["name_ja"]), _kana((p.get("displayName") or {}).get("text"))
    en = _kana(r.get("name_en") or "")
    core = [_kana(t) for t in __import__("re").split(r"[\s()（）・]", unicodedata.normalize("NFKC", r["name_ja"])) if len(t) >= 2 and t not in GENERIC]
    strong = bool(a and b) and (a in b or b in a or (en and len(en) >= 4 and en in b))
    weak = strong or any(t and t in b for t in core)
    if d is None:
        return (weak, "" if weak else f"상호 불일치({b})")
    if d <= 80:
        return True, ""  # 같은 건물 수준
    if weak and d <= 300:
        return True, ""
    if strong and d <= 1500:
        return True, f"좌표 보정({d:.0f}m)"
    return False, (f"거리 {d:.0f}m" if weak else f"상호 불일치({b}, {d:.0f}m)")


def save(items: list) -> None:
    MASTER.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only-missing", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--fill-hours", action="store_true")
    args = ap.parse_args()

    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not key:
        print("GOOGLE_MAPS_API_KEY 환경변수가 필요합니다.")
        return 1

    items = json.loads(MASTER.read_text(encoding="utf-8"))
    today = dt.date.today().isoformat()
    changed = 0
    for r in items:
        if args.only_missing and r.get("google_rating") is not None:
            continue
        try:
            p = search(key, r)
        except ApiError as e:
            print(f"❌ {r['id']} {r['name_ko']}: {e}")
            if e.code == 403:
                print("👉 Google Cloud 콘솔에서 확인: ① 'Places API (New)' 사용 설정 ② 결제 계정 연결 "
                      "③ API 키 제한 — 애플리케이션 제한 '없음'(GitHub Actions IP 는 매번 바뀜), API 제한에 'Places API (New)' 포함")
            if e.code in (400, 401, 403):  # 키·권한·요청 형식 문제 → 중단
                if not args.dry_run and changed:
                    save(items)
                return 1
            continue
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"⚠️  {r['id']} {r['name_ko']}: 네트워크 오류 {e} — 건너뜀")
            continue
        time.sleep(0.2)
        if not p:
            print(f"❔ {r['id']} {r['name_ko']}: 구글에서 못 찾음")
            continue
        ok, why = same_place(r, p)
        if ok and why:
            print(f"   ↪ {r['id']} {r['name_ko']}: {why}")
        if not ok:
            print(f"❔ {r['id']} {r['name_ko']}: 다른 가게로 보여 건너뜀 ({why})")
            continue
        name = (p.get("displayName") or {}).get("text", "")
        rating, count = p.get("rating"), p.get("userRatingCount")
        status = p.get("businessStatus")
        print(f"⭐ {r['id']} {r['name_ko']} → {name} | {rating} ({count}) | {status} | 예약표시={p.get('reservable')}")
        if status and status != "OPERATIONAL":
            print(f"   ⚠️  구글 영업 상태: {status} — 확인 필요")
        r["google_rating"] = rating
        r["google_reviews"] = count
        manual_geo = str(r.get("geo") or "").startswith("manual")  # 사람이 고정한 좌표(예: 이전한 가게)는 유지
        if not manual_geo:
            r["google_maps_uri"] = p.get("googleMapsUri")
        r["google_reservable"] = p.get("reservable")
        r["google_checked_at"] = today
        r["google_status"] = status
        loc = p.get("location") or {}
        if loc.get("latitude") and not manual_geo:
            # 구글 좌표가 주소 지오코딩보다 정확 → 지도 핀 위치로 사용
            r["lat"], r["lng"] = round(loc["latitude"], 6), round(loc["longitude"], 6)
            r["geo"] = f"google:{name}"
        reasons = [x for x in r.get("reasons") or [] if x.get("type") != "구글"]
        if rating and count and rating >= 4.2 and count >= 300:
            reasons.append({"type": "구글", "detail": f"구글 지도 {rating} / 리뷰 {count:,}개 ({today} 기준)", "url": p.get("googleMapsUri")})
        r["reasons"] = reasons
        if p.get("reservable") and r.get("booking_type") != "앱예약":
            print(f"   ℹ️  구글은 '예약 가능'으로 표시 — booking_type({r.get('booking_type')}) 재확인 권장")
        changed += 1
        if not args.dry_run and changed % 20 == 0:
            save(items)  # 중간 저장

    if args.fill_hours:
        changed += fill_hours(key, items, today)
    if not args.dry_run:
        save(items)
    print(f"완료: {changed}곳 갱신" + (" (dry-run)" if args.dry_run else ""))
    return 0


KO_DAY = {"mon": "월", "tue": "화", "wed": "수", "thu": "목", "fri": "금", "sat": "토", "sun": "일"}


def fill_hours(key: str, items: list, today: str) -> int:
    """타베로그에서 못 채운 요일만 구글 영업시간으로 보완 (이미 있는 요일은 건드리지 않음)."""
    n = 0
    for r in items:
        hw = r.get("hours_week")
        if hw and all(v is not None for v in hw.values()):
            continue
        try:
            p = search(key, r, HOURS_FIELDS)
        except ApiError as e:
            print(f"❌ 영업시간 {r['id']}: {e}")
            if e.code in (400, 401, 403):
                return n
            continue
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"⚠️  영업시간 {r['id']}: 네트워크 오류 {e}")
            continue
        time.sleep(0.2)
        if not p:
            print(f"❔ 영업시간 {r['id']} {r['name_ko']}: 구글에서 못 찾음")
            continue
        ok, why = same_place(r, p)
        if not ok:
            print(f"❔ 영업시간 {r['id']} {r['name_ko']}: 다른 가게로 보여 건너뜀 ({why})")
            continue
        gw = google_week(p)
        if not gw:
            print(f"❔ 영업시간 {r['id']} {r['name_ko']}: 구글에도 영업시간 없음")
            continue
        new = dict(hw or {k: None for k in KO_DAY})
        filled = [k for k in KO_DAY if new.get(k) is None]
        for k in filled:
            new[k] = gw[k]
        r["hours_week"] = new
        note = f"{'·'.join(KO_DAY[k] for k in filled)}요일 영업시간은 구글 지도 기준({today})"
        if note not in (r.get("hours_note") or ""):
            r["hours_note"] = ((r.get("hours_note") or "") + (" / " if r.get("hours_note") else "") + note)
        print(f"🕒 {r['id']} {r['name_ko']}: {', '.join(f'{KO_DAY[k]} {gw[k]}' for k in filled)}")
        n += 1
    print(f"영업시간 보완: {n}곳")
    return n


if __name__ == "__main__":
    sys.exit(main())
