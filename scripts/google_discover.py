#!/usr/bin/env python3
"""구글 지도 리뷰 기반 '레전드' 후보 찾기 (Google Places API Text Search).

동네 × 음식 종류로 검색해 평점이 높고 리뷰가 많은 곳을 모으고, 이미 DB에 있는 곳은 빼서
data/google_candidates.json 에 저장합니다. (후보일 뿐 — 타베로그·영업 정보 확인 후 DB에 넣음)

  GOOGLE_MAPS_API_KEY=... python3 scripts/google_discover.py --max-requests 170

요금: Text Search 1건 = 요청 1회(평점·리뷰 수 필드 포함). --max-requests 로 상한을 둡니다.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from google_places import _kana, dist_m  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / "data" / "restaurants.json"
OUT = ROOT / "data" / "google_candidates.json"
ENDPOINT = "https://places.googleapis.com/v1/places:searchText"
FIELDS = ",".join(["places.id", "places.displayName", "places.formattedAddress", "places.location", "places.rating",
                   "places.userRatingCount", "places.priceLevel", "places.primaryType", "places.types",
                   "places.businessStatus", "places.googleMapsUri"])
AREAS = [  # (이름, 일본어 지명, 위도, 경도, 지역)
    ("우메다", "梅田", 34.7025, 135.4980, "osaka"), ("난바·도톤보리", "難波 道頓堀", 34.6680, 135.5015, "osaka"),
    ("신사이바시", "心斎橋", 34.6740, 135.5010, "osaka"), ("텐마·텐진바시", "天満", 34.7040, 135.5120, "osaka"),
    ("신세카이·덴노지", "新世界 天王寺", 34.6500, 135.5080, "osaka"), ("쓰루하시", "鶴橋", 34.6650, 135.5300, "osaka"),
    ("기타하마·혼마치", "北浜 本町", 34.6880, 135.5020, "osaka"),
    ("기온·가와라마치", "祇園 河原町", 35.0040, 135.7720, "kyoto"), ("교토역", "京都駅", 34.9858, 135.7588, "kyoto"),
    ("시조·카라스마", "四条烏丸", 35.0040, 135.7600, "kyoto"), ("아라시야마", "嵐山", 35.0140, 135.6770, "kyoto"),
    ("산노미야·모토마치", "三宮 元町", 34.6920, 135.1920, "kobe"), ("나라", "奈良 ならまち", 34.6830, 135.8290, "nara"),
]
FOODS = ["ラーメン", "寿司", "焼肉", "お好み焼き", "居酒屋", "うどん そば", "とんかつ 天ぷら", "和食 定食", "カフェ スイーツ", "洋食 カレー", "中華 餃子", "焼き鳥"]
OSAKA_EXTRA = ["串カツ たこ焼き"]
FOOD_TYPES = {"restaurant", "food", "cafe", "bakery", "bar", "meal_takeaway", "meal_delivery", "coffee_shop", "dessert_shop", "confectionery"}


def search(key: str, q: str, lat: float, lng: float) -> list:
    body = {"textQuery": q, "languageCode": "ja", "regionCode": "JP", "pageSize": 20,
            "locationBias": {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": 1500.0}}}
    req = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode()).get("places") or []


def legend(p: dict) -> float:
    """리뷰 수를 반영한 평점(베이지안 평균): 리뷰가 적은 고평점은 덜 믿음."""
    r, v, m, c = p.get("rating") or 0, p.get("userRatingCount") or 0, 500, 4.0
    return (v / (v + m)) * r + (m / (v + m)) * c


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-requests", type=int, default=170)
    args = ap.parse_args()
    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not key:
        print("GOOGLE_MAPS_API_KEY 환경변수가 필요합니다.")
        return 1
    db = json.loads(MASTER.read_text(encoding="utf-8"))
    seen, n = {}, 0
    for area, ja, lat, lng, region in AREAS:
        for food in FOODS + (OSAKA_EXTRA if region == "osaka" else []):
            if n >= args.max_requests:
                break
            q = f"{ja} {food}"
            try:
                places = search(key, q, lat, lng)
            except urllib.error.HTTPError as e:
                print(f"❌ {q}: HTTP {e.code} {e.read()[:300].decode('utf-8', 'replace')}")
                if e.code in (400, 401, 403):
                    return 1
                continue
            except (urllib.error.URLError, TimeoutError) as e:
                print(f"⚠️ {q}: {e}")
                continue
            n += 1
            time.sleep(0.15)
            for p in places:
                if p.get("businessStatus") not in (None, "OPERATIONAL"):
                    continue
                if not FOOD_TYPES & set(p.get("types") or []):
                    continue
                pid = p["id"]
                if pid in seen:
                    seen[pid]["queries"].append(q)
                    continue
                seen[pid] = {**p, "area": area, "region": region, "queries": [q]}
    print(f"요청 {n}회, 장소 {len(seen)}곳")
    out = []
    for p in seen.values():
        r, v = p.get("rating") or 0, p.get("userRatingCount") or 0
        if not ((r >= 4.3 and v >= 1000) or (r >= 4.5 and v >= 400)):
            continue
        loc = p.get("location") or {}
        nm = (p.get("displayName") or {}).get("text", "")
        match = None
        for d in db:
            if not isinstance(d.get("lat"), (int, float)):
                continue
            dd = dist_m(d["lat"], d["lng"], loc.get("latitude", 0), loc.get("longitude", 0))
            a, b = _kana(d["name_ja"]), _kana(nm)
            if dd < 300 and a and b and (a in b or b in a or a[:4] == b[:4]):
                match = d["id"]
                break
        out.append({"name": nm, "rating": r, "reviews": v, "legend": round(legend(p), 3), "price": p.get("priceLevel"),
                    "type": p.get("primaryType"), "address": p.get("formattedAddress"), "lat": loc.get("latitude"), "lng": loc.get("longitude"),
                    "area": p["area"], "region": p["region"], "maps": p.get("googleMapsUri"), "in_db": match, "queries": p["queries"][:3]})
    out.sort(key=lambda x: -x["legend"])
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    new = [x for x in out if not x["in_db"]]
    print(f"구글 레전드 기준 통과 {len(out)}곳 (DB에 이미 있음 {len(out) - len(new)}, 새 후보 {len(new)}) → {OUT.relative_to(ROOT)}")
    for x in new[:60]:
        print(f"  {x['legend']:.2f} ★{x['rating']} ({x['reviews']:,}) {x['region']}/{x['area']} {x['name']} [{x['type']}]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
