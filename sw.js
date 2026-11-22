// 오프라인 지원: 한 번 열어 두면 로밍이 끊겨도 목록·상세가 열리도록 앱 파일과 데이터를 저장.
// 한국어 지도(OpenFreeMap) 타일은 본 적 있는 구역만 따로 저장(최대 TILE_MAX개) → 로밍이 끊겨도 가 본 동네 지도는 보임.
// 구글 지도 타일은 약관상 저장하지 않음. GitHub Pages 등 https 에서만 동작.
const CACHE = "matzip-v27";
const TILE_CACHE = "matzip-tiles-v1";
const TILE_MAX = 1500;
const TILE_HOSTS = ["tiles.openfreemap.org"];
const SHELL = [
  "./", "./index.html", "./list.html", "./manifest.webmanifest",
  "./assets/style.css", "./assets/app.js", "./hotels.html", "./assets/hotels.js", "./assets/hotels.css", "./data/hotels.js", "./assets/config.js", "./data/restaurants.js", "./data/landmarks.js",
  "./assets/vendor/leaflet/leaflet.js", "./assets/vendor/leaflet/leaflet.css",
  "./assets/vendor/leaflet/leaflet.markercluster.js", "./assets/vendor/leaflet/MarkerCluster.css",
  "./assets/vendor/leaflet/MarkerCluster.Default.css", "./assets/icons/icon-192.png",
  "./assets/vendor/maplibre/maplibre-gl.js", "./assets/vendor/maplibre/maplibre-gl.css", "./assets/vendor/maplibre/leaflet-maplibre-gl.js",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== TILE_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
let putCount = 0;
async function trimTiles() {
  const c = await caches.open(TILE_CACHE);
  const keys = await c.keys();
  if (keys.length > TILE_MAX) await Promise.all(keys.slice(0, keys.length - TILE_MAX).map((k) => c.delete(k)));
}
function tileFetch(req) {
  // 저장본이 있으면 바로 쓰고 뒤에서 갱신(stale-while-revalidate), 없으면 네트워크
  return caches.open(TILE_CACHE).then((c) => c.match(req).then((hit) => {
    const net = fetch(req).then((res) => {
      if (res && res.ok && (res.type === "cors" || res.type === "basic")) {
        c.put(req, res.clone());
        if (++putCount % 100 === 0) trimTiles();
      }
      return res;
    });
    if (hit) { net.catch(() => {}); return hit; }
    return net;
  }));
}
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (TILE_HOSTS.includes(url.hostname)) { e.respondWith(tileFetch(e.request)); return; }
  if (url.origin !== location.origin) return; // 그 밖의 외부 요청(구글 타일·예약 링크 등)은 그대로
  // 네트워크 우선(최신 데이터), 실패하면 저장본
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((m) => m || caches.match("./index.html")))
  );
});
