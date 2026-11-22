#!/usr/bin/env python3
"""숙소 고르기 페이지 데이터(data/hotels.js) 만들기.

입력
  data/hotels_prices.json  scripts/hotel_prices.js 결과(구글 호텔: 평점·리뷰·좌표·날짜별 가격)
  data/restaurants.json    맛집 지도 가게(숙소 근처 맛집 수)
  data/landmarks.js        주요 명소 좌표
간이 지도의 노선·역·강은 아래에 직접 적음(단순화한 좌표).
"""
import base64, json, math, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
prices = json.loads((ROOT / "data/hotels_prices.json").read_text())
R = json.loads((ROOT / "data/restaurants.json").read_text())
lm_src = (ROOT / "data/landmarks.js").read_text()
LMS = json.loads(lm_src[lm_src.index("["): lm_src.rindex("]") + 1])


def dm(a, b):
    dy = (a[0] - b[0]) * 111320
    dx = (a[1] - b[1]) * 111320 * math.cos(math.radians(a[0]))
    return math.hypot(dx, dy)


def gts(ci, co, cur="KRW"):
    """구글 호텔 URL ts 파라미터(날짜·통화)."""
    def dt(s):
        y, m, d = map(int, s.split("-"))
        return bytes([0x08, (y & 0x7F) | 0x80, y >> 7, 0x10, m, 0x18, d])
    a, b = dt(ci), dt(co)
    inner = bytes([0x0A, len(a)]) + a + bytes([0x12, len(b)]) + b
    f2 = bytes([0x12, len(inner)]) + inner + bytes([0x32, 0x02, 0x08, 0x00])
    f3 = bytes([0x12, len(f2)]) + f2
    c = cur.encode()
    allb = bytes([0x08, 0x00, 0x1A, len(f3)]) + f3 + bytes([0x2A, len(c) + 4, 0x0A, len(c) + 2, 0x3A, len(c)]) + c
    return base64.urlsafe_b64encode(allb).decode().rstrip("=")


# ------------------------------------------------------------------ 지도 재료
KY_ST = [  # 이름, lat, lng, 주요역
    ("교토역", 34.98580, 135.75880, 1), ("고조", 34.99630, 135.75980, 0), ("시조·가라스마", 35.00370, 135.75990, 1),
    ("가라스마오이케", 35.01082, 135.75965, 1), ("마루타마치", 35.01770, 135.75960, 0), ("교토가와라마치", 35.00376, 135.76961, 1),
    ("기온시조", 35.00360, 135.77200, 1), ("산조", 35.00900, 135.77220, 0), ("기요미즈고조", 34.99636, 135.76867, 0),
    ("시치조", 34.98930, 135.76860, 0), ("도후쿠지", 34.98107, 135.77008, 0), ("후시미이나리", 34.96700, 135.77030, 0),
    ("시야쿠쇼마에", 35.01090, 135.76887, 0), ("오미야", 35.00390, 135.74840, 0), ("니조조마에", 35.01050, 135.74800, 0),
]
KY_LINES = [
    {"n": "JR (하루카·오사카행)", "c": "#0072bc", "p": [[34.9858, 135.7588], [34.9848, 135.7470], [34.9800, 135.7300]]},
    {"n": "JR 나라선", "c": "#0072bc", "p": [[34.9858, 135.7588], [34.9840, 135.7660], [34.9811, 135.7698], [34.9669, 135.7705], [34.9500, 135.7712]]},
    {"n": "지하철 가라스마선", "c": "#2e9b48", "p": [[34.9700, 135.7598], [34.9858, 135.7598], [34.9963, 135.7598], [35.0037, 135.7599], [35.0108, 135.7597], [35.0177, 135.7596], [35.0300, 135.7594]]},
    {"n": "한큐 (오사카 우메다행)", "c": "#8c1d40", "p": [[35.00376, 135.76961], [35.0037, 135.7604], [35.0039, 135.7484], [35.0040, 135.7300]]},
    {"n": "게이한 (오사카 요도야바시행)", "c": "#00838f", "p": [[35.0307, 135.7732], [35.0090, 135.7722], [35.0036, 135.7720], [34.99636, 135.76867], [34.9893, 135.7686], [34.98107, 135.77008], [34.9670, 135.7703], [34.9500, 135.7690]]},
    {"n": "지하철 도자이선", "c": "#e8711a", "p": [[35.0105, 135.7300], [35.0105, 135.7480], [35.0108, 135.7597], [35.0109, 135.76887], [35.0090, 135.7722], [35.0094, 135.7807], [35.0060, 135.7950]]},
]
KY_RIVERS = [[[35.0350, 135.7730], [35.0200, 135.7722], [35.0100, 135.7717], [35.0037, 135.7712], [34.9963, 135.7703], [34.9893, 135.7697], [34.9800, 135.7690], [34.9600, 135.7680]]]
KY_STREETS = [
    [[35.0037, 135.7380], [35.0037, 135.7780]], [[34.9963, 135.7380], [34.9963, 135.7760]], [[35.0105, 135.7380], [35.0105, 135.7780]],
    [[34.9893, 135.7380], [34.9893, 135.7750]], [[35.0087, 135.7480], [35.0087, 135.7790]], [[35.0177, 135.7400], [35.0177, 135.7790]],
    [[34.9840, 135.7598], [35.0300, 135.7598]], [[34.9900, 135.7690], [35.0250, 135.7690]], [[34.9850, 135.7515], [35.0300, 135.7515]],
    [[34.9850, 135.7790], [35.0250, 135.7790]], [[34.9800, 135.7480], [35.0250, 135.7480]],
]
OS_ST = [
    ("우메다·오사카역", 34.70250, 135.49700, 1), ("요도야바시", 34.69250, 135.50129, 1), ("기타하마", 34.69117, 135.50658, 0),
    ("혼마치", 34.68354, 135.50067, 0), ("신사이바시", 34.67452, 135.50036, 1), ("난바", 34.66620, 135.50030, 1),
    ("난카이 난바", 34.66250, 135.50170, 0), ("오사카난바", 34.66718, 135.49778, 0), ("닛폰바시", 34.66679, 135.50660, 0),
    ("덴노지", 34.64660, 135.51400, 1), ("신이마미야", 34.65014, 135.50100, 0), ("도부쓰엔마에", 34.64837, 135.50536, 0),
    ("교바시", 34.69714, 135.53266, 0), ("오사카조코엔", 34.68776, 135.53440, 0), ("덴마바시", 34.69044, 135.51655, 0),
    ("오사카우에혼마치", 34.66558, 135.52015, 0), ("쓰루하시", 34.66525, 135.53074, 0), ("나가호리바시", 34.67532, 135.50630, 0),
    ("사카이스지혼마치", 34.68262, 135.50646, 0), ("다니마치욘초메", 34.68260, 135.51720, 0), ("미나미모리마치", 34.69758, 135.51100, 0),
    ("후쿠시마", 34.69505, 135.48744, 0), ("히고바시", 34.69123, 135.49651, 0), ("나카노시마", 34.69300, 135.49100, 0),
]
OS_LINES = [
    {"n": "JR 오사카 환상선", "c": "#f39700", "p": [[34.7025, 135.4962], [34.7050, 135.5120], [34.7055, 135.5245], [34.6971, 135.5327], [34.6878, 135.5344], [34.6815, 135.5320], [34.6745, 135.5332], [34.6653, 135.5307], [34.6578, 135.5293], [34.6485, 135.5232], [34.6467, 135.5144], [34.6502, 135.5013], [34.6522, 135.4925], [34.6590, 135.4838], [34.6687, 135.4793], [34.6684, 135.4621], [34.6827, 135.4658], [34.6930, 135.4782], [34.6951, 135.4874], [34.7025, 135.4962]]},
    {"n": "미도스지선", "c": "#e5171f", "p": [[34.7333, 135.5001], [34.7095, 135.4960], [34.7052, 135.4980], [34.6925, 135.5013], [34.6835, 135.5007], [34.6745, 135.5004], [34.6662, 135.5003], [34.6593, 135.4975], [34.6484, 135.5054], [34.6466, 135.5135], [34.6300, 135.5150]]},
    {"n": "난카이 (간사이공항행)", "c": "#e05a00", "p": [[34.6625, 135.5017], [34.6502, 135.5013], [34.6200, 135.4990]]},
    {"n": "긴테쓰·한신 (나라·고베 직통)", "c": "#9c6b30", "p": [[34.6660, 135.4500], [34.6670, 135.4895], [34.66718, 135.49778], [34.66679, 135.5066], [34.66558, 135.52015], [34.66525, 135.53074], [34.6660, 135.5600]]},
    {"n": "게이한 (교토행)", "c": "#00838f", "p": [[34.6925, 135.5013], [34.69117, 135.50658], [34.69044, 135.51655], [34.69714, 135.53266], [34.7100, 135.5550]]},
]
OS_RIVERS = [
    [[34.6683, 135.4905], [34.6688, 135.4960], [34.6690, 135.5000], [34.6688, 135.5040], [34.6680, 135.5085]],
    [[34.6680, 135.5085], [34.6750, 135.5088], [34.6850, 135.5088], [34.6905, 135.5085]],
    [[34.7120, 135.5300], [34.7040, 135.5230], [34.6960, 135.5170], [34.6915, 135.5100]],
    [[34.6915, 135.5100], [34.6937, 135.5050], [34.6952, 135.4990], [34.6950, 135.4920], [34.6930, 135.4830], [34.6900, 135.4700]],
    [[34.6915, 135.5100], [34.6905, 135.5040], [34.6898, 135.4990], [34.6893, 135.4920], [34.6880, 135.4830], [34.6860, 135.4700]],
]
OS_STREETS = [
    [[34.6450, 135.5063], [34.7000, 135.5063]], [[34.6668, 135.4850], [34.6668, 135.5320]], [[34.6755, 135.4850], [34.6755, 135.5250]],
    [[34.6830, 135.4850], [34.6830, 135.5300]], [[34.6450, 135.5165], [34.7000, 135.5165]], [[34.6600, 135.4967], [34.7000, 135.4967]],
    [[34.6550, 135.4920], [34.7050, 135.4920]], [[34.6900, 135.4850], [34.6900, 135.5250]],
]
EMO = {"오사카성": "🏯", "니조성": "🏯", "도톤보리(글리코)": "🏮", "호젠지 요코초": "🏮", "기온·하나미코지": "🏮", "폰토초": "🏮", "산넨자카·니넨자카": "🏮",
       "구로몬 시장": "🐟", "니시키 시장": "🐟", "신세카이·츠텐카쿠": "🗼", "아베노 하루카스": "🏙", "우메다 스카이빌딩": "🏙", "신사이바시 상점가": "🛍",
       "덴진바시스지 상점가": "🛍", "아메리카무라": "🛍", "덴덴타운(닛폰바시)": "🎮", "나카노시마 공원": "🌳", "교토 고쇼": "🌳", "교토역": "🚉",
       "난바역": "🚉", "오사카역·우메다": "🚉", "시조 가와라마치": "🛍"}
SKIP_LM = {"난바역", "오사카역·우메다", "교토역", "신오사카역", "데마치야나기"}


def landmarks(region, bounds):
    s, w, n, e = bounds
    out = []
    for x in LMS:
        if x["r"] != region or x["n"] in SKIP_LM:
            continue
        if s - 0.01 <= x["lat"] <= n + 0.01 and w - 0.01 <= x["lng"] <= e + 0.01:
            out.append({"n": x["n"].replace("(입구)", ""), "e": EMO.get(x["n"], "⛩"), "lat": x["lat"], "lng": x["lng"]})
    return out


# ------------------------------------------------------------------ 권역 배정(좌표로)
def area_kyoto(lat, lng):
    if 34.978 <= lat < 34.992 and 135.746 <= lng <= 135.768: return "station"
    if 34.992 <= lat <= 35.013 and 135.7540 <= lng < 135.7645: return "karasuma"
    if 34.994 <= lat <= 35.013 and 135.7645 <= lng < 135.7725: return "kawara"
    if 34.990 <= lat <= 35.010 and 135.7725 <= lng <= 135.786: return "gion"
    return None


def area_osaka(lat, lng):
    if 135.488 <= lng <= 135.513:
        if 34.657 <= lat < 34.6715: return "namba"
        if 34.6715 <= lat < 34.680: return "shinsai"
        if 34.680 <= lat < 34.6965: return "kita"
        if 34.6965 <= lat <= 34.712 and lng <= 135.507: return "umeda"
    if 34.640 <= lat < 34.657 and 135.495 <= lng <= 135.520: return "tennoji"
    return None


AREA_LINE = {
    "station": "교토역 — 하루카·JR 바로, 짐 이동 최소", "karasuma": "지하철로 교토역 2~3정거장, 니시키 시장 걸어서",
    "kawara": "폰토초·기온·니시키 시장 걸어서", "gion": "기온·야사카 신사 걸어서",
    "namba": "난바역에서 라피트(공항)·긴테쓰(나라)·한신(고베) 바로", "shinsai": "미도스지선 신사이바시역 — 난바 1정거장",
    "kita": "미도스지선 혼마치·요도야바시 — 난바 약 5~7분", "umeda": "JR 오사카역 — 교토 29분·고베 21분", "tennoji": "덴노지·신이마미야 — 난카이·JR로 공항",
}

# 추천 기준: 예산 안 + 구글 평점 4.3↑(리뷰 300↑) + 너무 싼 곳(8만 원 미만) 제외
CRIT = dict(min_rating=4.3, min_reviews=300, min_price=80000)


def judge(h, cfg):
    p, r, n = h["price"], h["rating"] or 0, h["reviews"] or 0
    if not p: return "가격 없음"
    if p > cfg["budget"]: return "예산 초과"
    if p < CRIT["min_price"]: return "너무 쌈"
    if r < CRIT["min_rating"]: return f"평점 {r}"
    if n < CRIT["min_reviews"]: return "리뷰 적음"
    return ""


# 새로 찾은 예산 안 호텔에 붙일 메모(확인 가능한 것만). 키: data/hotels_prices.json id
NOTES = {
    "kb-106": dict(cons=["아파 호텔 체인은 객실이 좁기로 유명(캐리어 2개 펼치기 빠듯)"]),
    "ob-22": dict(short="슈퍼호텔 혼마치"),
    "kb-107": dict(short="OMO5 산조", pros=["호시노 리조트의 OMO 브랜드"]),
}
SHORT = {"ob-16": "우메다홀릭", "ob-9": "가너 혼마치 미도스지", "ob-26": "가너 혼마치역", "ob-10": "시즈테쓰 프레지오", "ob-4": "로열파크 캔버스",
         "ob-1": "저스트 슬립", "ob-6": "센츄리온 CEN", "ob-2": "코르디아 혼마치", "ob-3": "코르디아",
         "kb-15": "교마치야 료칸 사쿠라", "kb-14": "더 엠즈", "kb-27": "다이와 테라스 하치조", "kb-101": "엠즈 에스트 교토역",
         "kb-108": "리가 그란", "kb-30": "앤드룸즈 시치조", "kb-2": "사쿠라 크로스 기요미즈", "kb-18": "무세 시조가와라마치",
         "kb-16": "트래블로지 시조", "kb-6": "칸세이 하치조", "kb-10": "로열 트윈 하치조", "kb-12": "알라 호텔", "kb-13": "튠 스테이",
         "kb-103": "REF 하치조구치", "kb-28": "산코 인 하치조구치", "kb-22": "다이와 로이넷 에키마에", "kb-21": "사쿠라 테라스 갤러리"}
for k, v in SHORT.items():
    NOTES.setdefault(k, {}).setdefault("short", v)

# ------------------------------------------------------------------ 호텔(사람이 고른 정보)
# area: 권역 키, short: 지도 칩 이름, pros/cons: 위치·교통 중심으로 확인 가능한 것만
KYOTO = {
    "k-vischio": dict(short="비스키오", en="Hotel Vischio Kyoto by Granvia", area="station", badge=None,
                      pros=["교토역 하치조 출구(남쪽) 바로 앞, 그란비아 계열", "하루카 내려 짐 끌고 몇 분이면 체크인"],
                      cons=["역 남쪽이라 저녁 먹으러 시조까지는 지하철 2정거장"]),
    "k-granvia": dict(short="그란비아", en="Hotel Granvia Kyoto", area="station",
                      pros=["교토역 건물 안(JR 중앙 출구) — 비 와도 우산 필요 없음", "다음날 JR로 오사카 29분, 짐 이동이 제일 짧음"],
                      cons=["판매처별 가격 차이가 큼(아래 표 확인)"]),
    "k-miyako": dict(short="미야코 시티", en="Miyako City Kintetsu Kyoto Station", area="station",
                     pros=["교토역 하치조 출구 쪽 역과 연결", "이 목록에서 가장 싼 편"], cons=["평점 4.2로 무난한 수준"]),
    "k-richmond": dict(short="리치몬드 프리미어", en="Richmond Hotel Premier Kyoto Ekimae", area="station",
                       pros=["교토역 북쪽, 걸어서 몇 분", "구글 4.6로 역 근처에서 평이 가장 좋은 편"], cons=["3성급(객실이 큰 편은 아님)"]),
    "k-rihga": dict(short="리가 로얄", en="RIHGA Royal Hotel Kyoto", area="station",
                    pros=["교토역 서쪽 호리카와 거리, 역까지 걸어서 7분 안팎", "리뷰 6천 개가 넘는 대형 호텔"], cons=["평점 4.1로 역 주변에선 낮은 편"]),
    "k-thousand": dict(short="더 사우전드", en="THE THOUSAND KYOTO", area="station",
                       pros=["교토역 중앙 출구 바로 앞 고급 호텔", "구글 4.5"], cons=["연말이라 1박 가격이 매우 높음"]),
    "k-cross": dict(short="크로스 교토", en="Cross Hotel Kyoto", area="kawara",
                    pros=["산조·가와라마치 한가운데 — 폰토초·기온·니시키 시장 걸어서", "구글 4.7(리뷰 2천+)로 이 목록 최고 평점"],
                    cons=["교토역에서 짐 들고 지하철+도보 또는 택시 15분 정도"]),
    "k-gate": dict(short="더 게이트", en="THE GATE HOTEL Kyoto Takasegawa by HULIC", area="kawara",
                   pros=["가와라마치역 걸어서 3분, 다카세가와 옆", "꼭대기 층 로비에서 히가시야마 쪽 전망"], cons=["교토역에서 택시나 지하철 이동 필요"]),
    "k-goodnature": dict(short="굿 네이처", en="GOOD NATURE HOTEL KYOTO", area="kawara",
                         pros=["가와라마치역 바로 근처, 시조 번화가 한복판"], cons=["연말 가격이 높은 편"]),
    "k-okura": dict(short="오쿠라 교토", en="Hotel Okura Kyoto", area="kawara",
                    pros=["가와라마치 오이케, 시야쿠쇼마에역과 연결", "전통 있는 대형 호텔"], cons=["시조 번화가까지는 10분 정도 걸음"]),
    "k-ace": dict(short="에이스 호텔", en="Ace Hotel Kyoto", area="karasuma",
                  pros=["가라스마오이케역과 연결된 신푸칸 건물", "디자인 호텔로 유명"], cons=["연말 가격이 매우 높음"]),
    "k-courtyard": dict(short="코트야드 시조", en="Courtyard by Marriott Kyoto Shijo Karasuma", area="karasuma",
                        pros=["시조·가라스마, 교토역에서 지하철 2정거장"], cons=["리뷰 수가 아직 적음"]),
    "k-mitsuishijo": dict(short="미쓰이 가든 시조", en="Mitsui Garden Hotel Kyoto Shijo", area="karasuma",
                          pros=["시조·가라스마 서쪽, 가격이 무난한 편", "시조역(지하철)·가라스마역(한큐) 걸어서"], cons=["평점 4.1"]),
    "k-celestine": dict(short="셀레스틴 기온", en="Hotel The Celestine Kyoto Gion", area="gion",
                        pros=["기온·야사카 탑 쪽 조용한 골목, 기요미즈데라 걸어서", "구글 4.6"], cons=["역에서 멀어 짐 들고는 택시 권장", "연말 가격이 높음"]),
}
OSAKA = {
    "o-swissotel": dict(short="스위소텔", en="Swissotel Nankai Osaka", area="namba", badge="공항 최강",
                        pros=["난카이 난바역 바로 위 — 마지막 날 라피트로 간사이공항 약 40분", "긴테쓰(나라)·한신(고베) 오사카난바역도 걸어서"],
                        cons=["연말이라 1박 가격이 높은 편"]),
    "o-cross": dict(short="크로스 오사카", en="Cross Hotel Osaka", area="namba", badge="위치·평점",
                    pros=["도톤보리 에비스바시 바로 옆 — 밤 산책·이자카야 걸어서", "구글 4.5(리뷰 3.6천)"], cons=["번화가 한복판이라 주변이 늦게까지 북적임"]),
    "o-oriental": dict(short="난바 오리엔탈", en="Namba Oriental Hotel", area="namba",
                       pros=["난바 센니치마에, 난바역·구로몬 시장 걸어서", "가격이 무난한 편"], cons=["3성급, 평점 4.1"]),
    "o-candeo": dict(short="칸데오 난바", en="Candeo Hotels Osaka Namba", area="namba", badge=None,
                     pros=["도톤보리 동쪽 끝, 닛폰바시역·구로몬 시장 걸어서", "이 권역 4성급 중 싼 편"], cons=["미도스지선 난바역까지는 7~8분"]),
    "o-royalclassic": dict(short="로열 클래식", en="Hotel Royal Classic Osaka", area="namba",
                           pros=["미도스지선 난바역 바로 앞(옛 신가부키자 자리)", "구글 4.4"], cons=["가격이 높은 편"]),
    "o-grids": dict(short="그릿즈 난바", en="GRIDS PREMIUM HOTEL OSAKA NAMBA", area="namba",
                    pros=["난바역 서쪽, 오사카난바역(긴테쓰·한신)도 가까워 나라·고베 당일치기에 편함", "이 권역에서 싼 편"], cons=["리뷰 수가 적은 편(830개)"]),
    "o-nikko": dict(short="닛코 오사카", en="Hotel Nikko Osaka", area="shinsai",
                    pros=["미도스지선 신사이바시역과 바로 연결", "리뷰 6.7천 개, 오래 검증된 대형 호텔"], cons=["건물이 오래된 편"]),
    "o-w": dict(short="W 오사카", en="W Osaka", area="shinsai",
                pros=["미도스지 신사이바시, 고급 호텔", "신사이바시역 걸어서 몇 분"], cons=["1박 100만 원이 넘음"]),
    "o-conrad": dict(short="콘래드", en="Conrad Osaka", area="kita",
                     pros=["나카노시마 고층(로비 40층) 전망", "게이한(교토)·미도스지 모두 가까움"], cons=["난바 맛집가와는 지하철 3~4정거장", "1박 100만 원대"]),
    "o-fresa": dict(short="프레사 인 기타하마", en="Sotetsu Fresa Inn Kitahama", area="kita",
                    pros=["기타하마역(게이한·사카이스지선) 근처 — 게이한으로 교토 기온시조 직행", "이 목록에서 가장 싼 편, 기타하마 명점 가까움"],
                    cons=["객실이 작은 비즈니스 호텔", "공항 가는 날은 난바에서 갈아타기"]),
    "o-mitsuipremier": dict(short="미쓰이 가든 프리미어", en="Mitsui Garden Hotel Osaka Premier", area="kita",
                            pros=["나카노시마 강변, 조용한 편"], cons=["번화가까지는 지하철 이동"]),
    "o-respire": dict(short="레스파이어", en="Hotel Hankyu RESPIRE OSAKA", area="umeda",
                      pros=["오사카역(JR) 바로 옆 — 교토 29분·고베 21분", "구글 평 좋은 신축급 호텔"], cons=["간사이공항은 하루카(신오사카·덴노지)나 리무진 버스"]),
    "o-omo7": dict(short="OMO7", en="OMO7 Osaka by Hoshino Resorts", area="tennoji",
                   pros=["신이마미야역 앞, 난카이로 간사이공항 직행", "신세카이·쓰텐카쿠 걸어서"], cons=["난바·도톤보리 맛집가는 지하철 1~2정거장"]),
    "o-marriott": dict(short="메리어트 미야코", en="Osaka Marriott Miyako Hotel", area="tennoji",
                       pros=["아베노 하루카스 고층 — 야경", "덴노지역(JR·지하철)과 연결, 하루카로 간사이공항"], cons=["난바 쪽 맛집은 지하철 이동"]),
}

PICKS_KYOTO = []  # 아래 데이터 보고 채움
PICKS_OSAKA = []

CITIES = {
    "kyoto": dict(
        ko="교토", when="12/27(일) 1박", whenShort="12/27 1박", ci="2026-12-27", co="2026-12-28", nights=1,
        budget=200000, target=100000, assign=area_kyoto,
        title="결론: 시조·가라스마(교토역에서 지하철 2정거장)가 예산·저녁·이동 균형이 제일 좋아요",
        bounds=[34.962, 135.744, 35.020, 135.790],
        areas=[dict(k="karasuma", n="시조·가라스마", c="#188038", b=[34.992, 135.754, 35.013, 135.7645]),
               dict(k="station", n="교토역", c="#1a73e8", b=[34.978, 135.746, 34.992, 135.768]),
               dict(k="kawara", n="가와라마치", c="#e8710a", b=[34.994, 135.7645, 35.013, 135.7725]),
               dict(k="gion", n="기온", c="#a142f4", b=[34.990, 135.7725, 35.010, 135.786])],
        areaRec=[
            dict(k="karasuma", title="시조·가라스마 (고조~오이케)", tag="1순위 · 균형",
                 verdict="교토역에서 지하철 가라스마선으로 <b>2~3정거장(약 4~6분)</b>. 짐 이동이 짧으면서도 저녁에 니시키 시장·가와라마치·폰토초를 <b>걸어서</b> 갈 수 있고, <b>1박 10~12만 원대에 구글 4.4~4.5</b> 숙소가 있어요.",
                 pros=["하루카로 교토역 도착 → 지하철 2정거장 → 체크인까지 20분 안팎(택시도 10분, 1,000엔대)",
                       "니시키 시장·데라마치/신쿄고쿠 상점가 걸어서 10분, 폰토초·기온은 15~20분 — 첫날 저녁·밤 산책이 다 걸어서 돼요",
                       "12/28 난바 숙소로: 한큐 가라스마역 → 오사카우메다(특급 약 40분) → 미도스지선 난바(약 8분). 갈아타기 1번, 약 1시간(우메다 환승은 걸어서 5~10분)",
                       "캐리어가 크면: 지하철로 교토역(2정거장) → 긴테쓰로 오사카난바(야마토사이다이지에서 한 번 갈아타기, 난바역 바로 도착)"],
                 cons=["기요미즈데라·기온 안쪽은 걸어서 20분 이상(버스·택시)", "사무실 거리라 큰길은 밤에 조용한 편(가와라마치 쪽이 더 번화)"],
                 who="첫날 저녁을 교토 시내에서 먹고 걷고 싶은데 예산도 지키고 싶다면 여기"),
            dict(k="station", title="교토역 주변", tag="짐 최소",
                 verdict="하루카 종점이라 <b>내리자마자 체크인</b>, 다음날도 JR로 오사카 29분. 캐리어 끄는 거리가 가장 짧아요. 대신 걸어서 갈 맛집이 적어 저녁은 지하철로 시조에 나가야 해요.",
                 pros=["도착이 늦거나 짐이 많을 때 가장 편함", "12/28 아침: JR 나라선 2정거장(약 5분)이면 <b>후시미 이나리</b> — 이른 아침엔 도리이 길이 한산해요(짐은 호텔에 맡기고)",
                       "12/28 난바로: 긴테쓰(야마토사이다이지 환승)로 <b>오사카난바역 바로 도착</b>, 약 1시간 10분 — 오는 길에 <b>나라를 들렀다</b> 갈 수도 있음", "교토역 빌딩 안 식당가(라멘코지 등)로 늦은 저녁도 해결", "1박 8~20만 원대 선택지가 가장 많음(구글 4.3~4.5)"],
                 cons=["숙소에서 걸어서 10분 안 '맛집 지도' 가게가 적음 — 맛집은 지하철·택시로", "밤 산책할 분위기는 아님"],
                 who="도착이 늦거나 짐이 많으면 여기"),
            dict(k="kawara", title="가와라마치 (+ 기온)", tag="분위기 최고",
                 verdict="폰토초·기온·니시키 시장이 <b>문 앞</b>이고 맛집 밀도도 최고. 다만 교토역에서 짐 들고 한 번 더 이동해야 하고(택시 약 15분·1,500엔 안팎), 같은 평점이면 <b>1박 11~20만 원대로 조금 비싸요</b>.",
                 pros=["첫날 밤 폰토초·기온 산책, 늦은 저녁까지 걸어서", "12/28 아침 일찍 야사카 신사·산넨자카·기요미즈데라(사람 적을 때) 걸어서",
                       "12/28 난바로: 게이한 기온시조역 → 요도야바시(특급 약 50분) → 같은 역 미도스지선 난바(약 6분). 우메다보다 환승이 짧아요"],
                 cons=["교토역에서 버스는 연말 관광객으로 매우 혼잡 — 캐리어 있으면 택시 추천", "같은 등급이면 교토역·가라스마보다 비쌈"],
                 who="짐이 가볍고 교토의 밤을 제대로 보고 싶다면"),
        ],
        zones=[dict(k="station", n="교토역", lat=34.9858, lng=135.7575, r=650, sx=1.3, sy=0.8),
               dict(k="karasuma", n="시조·가라스마", lat=35.0055, lng=135.7580, r=600, sx=0.9, sy=1.1),
               dict(k="kawara", n="가와라마치", lat=35.0055, lng=135.7697, r=520, sx=0.8, sy=1.2),
               dict(k="gion", n="기온", lat=35.0015, lng=135.7765, r=520)],
        presets=[dict(n="전체", b=[34.962, 135.744, 35.020, 135.790]), dict(n="교토역 확대", b=[34.980, 135.748, 34.992, 135.766]),
                 dict(n="시조·가와라마치·기온 확대", b=[34.996, 135.752, 35.013, 135.781])],
        stations=KY_ST, lines=KY_LINES, rivers=KY_RIVERS, streets=KY_STREETS,
        far=[dict(n="오사카", lat=34.7025, lng=135.4962, note="JR 29분"),
             dict(n="간사이공항", lat=34.4347, lng=135.2440, note="하루카 75분"),
             dict(n="아라시야마", lat=35.0128, lng=135.6778, note="JR 15분"),
             dict(n="금각사", lat=35.0395, lng=135.7295, note="버스 40분"),
             dict(n="은각사", lat=35.0269, lng=135.7984, note="버스 30분")],
        moves=["간사이공항 → 교토역: JR 특급 <b>하루카</b> 직통 약 75~80분(외국인용 할인권 'ICOCA & HARUKA')",
               "교토역 → 시조·가라스마: 지하철 가라스마선 2정거장(시조역, 약 4분) / 가와라마치: 택시 약 15분",
               "체크인은 보통 15시 — 일찍 도착하면 호텔 프런트에 짐부터 맡기고 나가면 돼요",
               "12/28 체크아웃(보통 10~11시) 후 짐 들고 오사카로 → 오사카 숙소에 짐 먼저 맡기고 관광 시작",
               "12/28 <b>난바 숙소</b>로(어디서든 갈아타기 1번, 약 1시간): 시조·가라스마 → 한큐 → 우메다 → 미도스지선 / 가와라마치·기온 → 게이한 → 요도야바시 → 미도스지선 / 교토역 → 긴테쓰 → 야마토사이다이지 환승 → 오사카난바",
               "12/28에 나라도 볼 거면: 긴테쓰 교토역 → 긴테쓰나라(약 35~45분) 구경 → 긴테쓰 오사카난바(약 40분). 캐리어는 역 코인로커(큰 칸은 일찍 참)"],
        warn=None,
        picks=PICKS_KYOTO),
    "osaka": dict(
        ko="오사카", when="12/28(월)~31(목) 3박", whenShort="12/28~31 3박", ci="2026-12-28", co="2026-12-31", nights=3,
        budget=150000, target=100000, assign=area_osaka,
        title="결론: 난바(도톤보리~닛폰바시). 공항·나라·고베가 갈아타기 없이 되고, 연말에도 문 여는 가게가 제일 많아요",
        bounds=[34.641, 135.478, 34.712, 135.540],
        areas=[dict(k="namba", n="난바·도톤보리", c="#e8710a", b=[34.657, 135.488, 34.6715, 135.513]),
               dict(k="shinsai", n="신사이바시", c="#d93025", b=[34.6715, 135.488, 34.680, 135.513]),
               dict(k="kita", n="혼마치·기타하마", c="#188038", b=[34.680, 135.488, 34.6965, 135.513]),
               dict(k="umeda", n="우메다", c="#1a73e8", b=[34.6965, 135.488, 34.712, 135.507]),
               dict(k="tennoji", n="덴노지·신세카이", c="#a142f4", b=[34.640, 135.495, 34.657, 135.520])],
        areaRec=[
            dict(k="namba", title="난바·도톤보리·닛폰바시", tag="1순위 · 이번 일정 정답",
                 verdict="이번 일정의 <b>공항(12/31)·나라·고베가 전부 난바역에서 갈아타지 않고</b> 가요. 도톤보리·우라난바 이자카야·구로몬 시장이 걸어서 거리고, 관광지라 <b>연말(12/29~31)에도 여는 가게가 가장 많은</b> 동네예요.",
                 pros=["12/31 귀국: 난카이 난바역 → 간사이공항 <b>라피트 약 40분</b>(공항급행은 약 45분·더 쌈)",
                       "나라: 긴테쓰 오사카난바역 → 긴테쓰나라역 쾌속급행 <b>약 40분</b>, 내리면 나라공원 걸어서 5분",
                       "고베: 오사카난바역에서 한신 직통으로 산노미야 약 40분 / 교토: 미도스지선 우메다 8분 → JR 29분",
                       "맛집 지도 가게가 가장 많이 몰린 곳(도톤보리·우라난바·센니치마에·구로몬) — 밤 9~10시 이후에도 먹을 데가 많음"],
                 cons=["도톤보리 큰길·에비스바시 근처는 밤늦게까지 시끄럽고 붐빔 → 닛폰바시·난바 남쪽 골목 숙소가 상대적으로 조용",
                       "예산 안 숙소는 대부분 비즈니스 호텔이라 더블룸이 좁음(12~15㎡) — 캐리어 2개 펼치려면 트윈·18㎡ 이상 추천"],
                 who="이번 일정(공항·나라·고베 + 맛집)이면 사실상 정답"),
            dict(k="shinsai", title="신사이바시·나가호리바시", tag="조금 조용",
                 verdict="미도스지선으로 <b>난바 1정거장</b>, 도톤보리까지 걸어서 10분 안. 편의는 난바와 거의 같은데 밤엔 조금 덜 북적여요. 다만 공항·나라·고베 갈 땐 난바에서 한 번 갈아타요.",
                 pros=["도톤보리·아메리카무라·호리에 걸어서", "우메다도 미도스지선 약 7분", "난바보다 큰길 소음이 덜한 편"],
                 cons=["12/31 공항 가는 날: 난바까지 1정거장 + 라피트 환승(캐리어 들고 계단·환승 동선)", "예산 안 숙소 수는 난바보다 적은 편"],
                 who="난바의 편리함은 유지하면서 조금 조용한 밤을 원하면"),
            dict(k="kita", title="혼마치·요도야바시·기타하마", tag="가장 쌈",
                 verdict="오피스 동네라 연말엔 <b>같은 평점이어도 숙박비가 싸요(9~15만 원대, 구글 4.3~4.7)</b>. 미도스지선으로 난바 약 5~7분. 대신 <b>연말엔 직장인 상대 식당이 많이 쉬어서</b> 저녁은 난바·우메다로 나가야 해요.",
                 pros=["같은 등급이면 가장 싸고 조용함", "난바·우메다 모두 미도스지선 직통(각 5~7분)", "요도야바시·기타하마역에서 게이한으로 교토 기온시조 직행"],
                 cons=["12/29~1/3은 주변 식당·카페가 상당수 휴무 — 아침·밤에 숙소 근처에서 먹기 어려움",
                       "공항·나라·고베는 난바(또는 우메다)에서 환승"],
                 who="숙소는 잠만 자고 예산을 최대한 아끼고 싶다면"),
            dict(k="umeda", title="우메다", tag="JR 허브",
                 verdict="JR로 <b>교토 29분·고베 21분</b>, 하루카도 오사카역에 서요. 다만 나라는 환승이 필요하고, 같은 등급이면 난바보다 비싼 편이에요.",
                 pros=["교토·고베 당일치기가 가장 빠름", "오사카역에서 하루카로 간사이공항(약 50분)", "백화점 식당가·지하상가가 넓어 비 와도 OK"],
                 cons=["역이 미로라 캐리어 들고 이동이 힘듦", "나라(긴테쓰)는 난바·쓰루하시 환승", "예산 안 숙소가 적음"],
                 who="고베·교토를 더 자주 오간다면"),
        ],
        zones=[dict(k="namba", n="난바·도톤보리", lat=34.6665, lng=135.5020, r=720, sx=1.2, sy=0.75),
               dict(k="shinsai", n="신사이바시", lat=34.6755, lng=135.5000, r=520, sx=1.0, sy=0.9),
               dict(k="kita", n="혼마치·기타하마", lat=34.6880, lng=135.5010, r=820, sx=1.25, sy=1.0),
               dict(k="umeda", n="우메다", lat=34.7030, lng=135.4975, r=600),
               dict(k="tennoji", n="덴노지·신세카이", lat=34.6490, lng=135.5070, r=750, sx=1.2, sy=0.7)],
        presets=[dict(n="전체", b=[34.641, 135.478, 34.712, 135.540]), dict(n="난바·신사이바시 확대", b=[34.659, 135.492, 34.681, 135.511]),
                 dict(n="기타하마·우메다 확대", b=[34.686, 135.487, 34.708, 135.512]), dict(n="덴노지 확대", b=[34.641, 135.494, 34.657, 135.520])],
        stations=OS_ST, lines=OS_LINES, rivers=OS_RIVERS, streets=OS_STREETS,
        far=[dict(n="간사이공항", lat=34.4347, lng=135.2440, note="라피트 40분"),
             dict(n="교토", lat=34.9858, lng=135.7588, note="JR 29분"),
             dict(n="나라", lat=34.6842, lng=135.8275, note="긴테쓰 40분"),
             dict(n="고베 산노미야", lat=34.6949, lng=135.1951, note="JR 21분"),
             dict(n="USJ", lat=34.6656, lng=135.4325, note="JR 15분")],
        moves=["난바 → 간사이공항: 난카이 특급 <b>라피트</b> 약 40분(마지막 날 12/31). 비행기가 늦으면 체크아웃 후 프런트에 짐을 맡겨 두고 마지막 관광",
               "난바 → 나라: 긴테쓰 오사카난바역에서 쾌속급행 약 40분, 긴테쓰나라역이 나라공원 바로 앞",
               "난바 → 고베 산노미야: 한신 직통(오사카난바역) 약 40분 / 우메다에서 JR 신쾌속 21분",
               "난바 → 교토: 미도스지선으로 우메다(약 10분) → JR 29분, 또는 요도야바시 → 게이한 약 50분(기온시조 도착)"],
        warn="⚠️ 12/29~31은 일본 연말 휴무에 들어가는 가게가 많아요. 숙소 근처 맛집도 가기 전에 가게 공지(인스타·타베로그)를 꼭 확인하세요.",
        picks=PICKS_OSAKA),
}


def short_name(n):
    n = re.sub(r"\s*\(.*?\)|\s*~.*?~", "", n or "")
    n = re.sub(r"\s+(by|바이)\s+.*$", "", n, flags=re.I)
    for w in ["오사카", "교토", "Osaka", "Kyoto", "OSAKA", "KYOTO", "大阪", "京都"]:
        n = n.replace(w, " ")
    n = re.sub(r"^(The|THE|Hotel|HOTEL|hotel|호텔|더)\s+", "", re.sub(r"\s+", " ", n).strip(" -·/"))
    out = ""
    for w in n.split(" "):
        if len((out + " " + w).strip()) > 16:
            break
        out = (out + " " + w).strip()
    return out or n[:16]


def build_city(key, cfg, curated, region):
    hotels = []
    pre = "kb-" if key == "kyoto" else "ob-"
    curated = dict(curated)
    for hid, p in prices.items():
        if hid.startswith(pre) and hid not in curated:
            nt = NOTES.get(hid, {})
            if not p.get("name") or re.match(r"^\s*\(.*\)\s*$|^[\d.,]+$|^\d", p["name"]):
                p["name"] = p["q"]
            curated[hid] = dict(short=nt.get("short") or short_name(p.get("name") or p["q"]), en=p.get("q"), area=None,
                                badge=nt.get("badge"), pros=nt.get("pros", []), cons=nt.get("cons", []), auto=True)
    for hid, cur in curated.items():
        p = prices.get(hid)
        if not p or not p.get("ok") or not p.get("lat"):
            print("  (빠짐: 구글 정보 없음)", hid, file=sys.stderr)
            continue
        vend = [{"v": v["v"], "p": v["p"], "o": bool(v.get("official"))} for v in p.get("vendors", []) if v.get("p")]
        cands = [(v["p"], v["v"]) for v in vend] + ([(p["headline"], "구글")] if p.get("headline") else [])
        price, pv = min(cands) if cands else (None, None)
        lat, lng = p["lat"], p["lng"]
        area = cfg["assign"](lat, lng)
        if not area:
            print("  (빠짐: 추천 권역 밖)", hid, p.get("name"), file=sys.stderr)
            continue
        st = min(cfg["stations"], key=lambda s: dm((lat, lng), (s[1], s[2])))
        sd = dm((lat, lng), (st[1], st[2]))
        near = sorted(((dm((lat, lng), (r["lat"], r["lng"])), r) for r in R if r.get("lat")), key=lambda x: x[0])
        n800 = [r for d, r in near if d <= 800]
        best = sorted(n800, key=lambda r: -(r.get("tabelog_score") or 0))[:3]
        ent = p.get("ent")
        gurl = (f"https://www.google.com/travel/hotels/entity/{ent}/prices?hl=ko&gl=kr&ts={gts(cfg['ci'], cfg['co'])}" if ent
                else f"https://www.google.com/travel/search?q={cur['en']}")
        hotels.append({
            "id": hid, "n": p.get("name") or cur["short"], "short": cur["short"], "en": cur["en"], "area": area,
            "badge": cur.get("badge"), "lat": round(lat, 6), "lng": round(lng, 6), "cls": p.get("cls") or "",
            "rating": p.get("rating"), "reviews": p.get("reviews"), "price": price, "pv": pv, "vendors": vend,
            "st": {"n": st[0] + "역" if not st[0].endswith("역") else st[0], "m": max(1, round(sd * 1.25 / 80))},
            "food": {"n": len(n800), "hi": sum(1 for r in n800 if (r.get("tabelog_score") or 0) >= 3.6),
                     "best": [[r["name_ko"], r.get("tabelog_score"), r["id"]] for r in best]},
            "pros": cur.get("pros") or [], "amen": p.get("amen"),
            "cons": cur.get("cons", []), "gurl": gurl,
            "murl": "https://www.google.com/maps/search/?api=1&query=" + re.sub(r"\s+", "+", (cur.get("en") or p.get("name") or "") + (" 오사카" if key == "osaka" else " 교토")),
            "checked": (p.get("at") or "")[:10],
        })
    # 새로 찾은(자동) 호텔은 추천 기준을 통과한 것만 남김. 처음에 고른 유명 호텔은 '전체'에서 참고용으로
    for h in hotels:
        h["why"] = judge(h, cfg)
        h["ok"] = not h["why"]
    hotels[:] = [h for h in hotels if h["ok"] or not h["id"].startswith(("kb-", "ob-"))]
    rank = {r["k"]: i for i, r in enumerate(cfg["areaRec"])}
    # 정렬 점수: 평점 0.1 ≈ 2만 원, 역에서 먼 만큼 조금 감점
    def value(h):
        return (h["rating"] or 0) * 10 - (h["price"] or 9e5) / 20000 - 0.15 * h["st"]["m"] + min(1.0, math.log10(max(10, h["reviews"] or 10)) - 2.5)
    for h in hotels:
        h["value"] = round(value(h), 2)
    okh = [h for h in hotels if h["ok"]]
    if okh:  # 자동 배지: 평점 1위
        br = max(okh, key=lambda h: ((h["rating"] or 0), h["reviews"] or 0))
        br["badge"] = "평점 1위"
    hotels.sort(key=lambda h: (not h["ok"], rank.get(h["area"], 9), -h["value"]))
    for i, h in enumerate(hotels, 1):
        h["no"] = i
    s, w, n, e = cfg["bounds"]
    m = 0.02
    dots = [[round(r["lat"], 5), round(r["lng"], 5), r.get("tabelog_score") or 0] for r in R
            if r.get("lat") and s - m <= r["lat"] <= n + m and w - m <= r["lng"] <= e + m]
    out = {k: v for k, v in cfg.items() if k not in ("stations", "assign")}
    out["stations"] = [{"n": a, "lat": b, "lng": c, "m": d} for a, b, c, d in cfg["stations"]]
    out["landmarks"] = landmarks(region, cfg["bounds"])
    out["hotels"] = hotels
    out["dots"] = dots
    if cfg["picks"]:
        out["picks"] = [dict(pk, ids=[i for i in pk["ids"] if any(h["id"] == i for h in hotels)]) for pk in cfg["picks"]]
    else:  # 권역 추천 순서대로, 권역마다 상위 3곳
        out["picks"] = []
        for i, r in enumerate(cfg["areaRec"][:3]):
            top = sorted([h for h in hotels if h["ok"] and h["area"] == r["k"]], key=lambda h: -h["value"])[:3]
            if not top:
                continue
            lo, hi = min(h["price"] for h in top), max(h["price"] for h in top)
            out["picks"].append(dict(
                t=f"{'①②③'[i]} {r['title']}", ids=[h["id"] for h in top],
                why=f"이 권역 추천 {len(top)}곳: 구글 평점 <b>{min(h['rating'] for h in top)}~{max(h['rating'] for h in top)}</b>, "
                    f"1박 <b>{lo / 1e4:.1f}~{hi / 1e4:.1f}만 원</b>{' (3박 평균)' if cfg['nights'] > 1 else ''}."))
    return out


def main():
    data = {"updated": max((p.get("at") or "")[:10] for p in prices.values()), "cities": {
        "kyoto": build_city("kyoto", CITIES["kyoto"], KYOTO, "kyoto"),
        "osaka": build_city("osaka", CITIES["osaka"], OSAKA, "osaka"),
    }}
    js = "// scripts/build_hotels.py 로 생성 — 직접 고치지 마세요\nwindow.MATZIP_HOTELS = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (ROOT / "data/hotels.js").write_text(js)
    for k, c in data["cities"].items():
        print(k, len(c["hotels"]), "hotels,", len(c["dots"]), "dots,", len(c["landmarks"]), "landmarks")
        for h in c["hotels"]:
            print(f"  {h['no']:2} {h['short']:<14} ★{h['rating']} ({h['reviews']}) ₩{h['price']:,} {h['st']['n']} {h['st']['m']}분 맛집 {h['food']['n']}({h['food']['hi']})" if h["price"] else f"  {h['no']} {h['short']} 가격없음")


if __name__ == "__main__":
    main()
