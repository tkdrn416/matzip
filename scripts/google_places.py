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


def search(key: str, r: dict) -> dict | None:
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
            headers={"Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS},
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


def same_place(r: dict, p: dict) -> tuple[bool, str]:
    """엉뚱한 가게를 붙이지 않도록: 좌표 300m 이내 + 상호 일부 일치."""
    loc = p.get("location") or {}
    if isinstance(r.get("lat"), (int, float)) and loc:
        d = dist_m(r["lat"], r["lng"], loc.get("latitude", 0), loc.get("longitude", 0))
        if d > 300:
            return False, f"거리 {d:.0f}m"
    norm = lambda x: unicodedata.normalize("NFKC", x or "").replace(" ", "").lower()
    a, b = norm(r["name_ja"]), norm((p.get("displayName") or {}).get("text"))
    core = [t for t in __import__("re").split(r"[\s()（）・]", unicodedata.normalize("NFKC", r["name_ja"])) if len(t) >= 2 and t not in GENERIC]
    if not (a in b or b in a or any(norm(t) in b for t in core)):
        return False, f"상호 불일치({b})"
    return True, ""


def save(items: list) -> None:
    MASTER.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only-missing", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
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
        r["google_maps_uri"] = p.get("googleMapsUri")
        r["google_reservable"] = p.get("reservable")
        r["google_checked_at"] = today
        reasons = [x for x in r.get("reasons") or [] if x.get("type") != "구글"]
        if rating and count and rating >= 4.2 and count >= 300:
            reasons.append({"type": "구글", "detail": f"구글 지도 {rating} / 리뷰 {count:,}개 ({today} 기준)", "url": p.get("googleMapsUri")})
        r["reasons"] = reasons
        if p.get("reservable") and r.get("booking_type") != "앱예약":
            print(f"   ℹ️  구글은 '예약 가능'으로 표시 — booking_type({r.get('booking_type')}) 재확인 권장")
        changed += 1
        if not args.dry_run and changed % 20 == 0:
            save(items)  # 중간 저장

    if not args.dry_run:
        save(items)
    print(f"완료: {changed}곳 갱신" + (" (dry-run)" if args.dry_run else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
