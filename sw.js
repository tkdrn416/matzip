// 오프라인 지원: 한 번 열어 두면 로밍이 끊겨도 목록·상세가 열리도록 앱 파일과 데이터를 저장.
// 지도 타일은 저장하지 않음(용량). GitHub Pages 등 https 에서만 동작.
const CACHE = "matzip-v5";
const SHELL = [
  "./", "./index.html", "./list.html", "./manifest.webmanifest",
  "./assets/style.css", "./assets/app.js", "./assets/config.js", "./data/restaurants.js",
  "./assets/vendor/leaflet/leaflet.js", "./assets/vendor/leaflet/leaflet.css",
  "./assets/vendor/leaflet/leaflet.markercluster.js", "./assets/vendor/leaflet/MarkerCluster.css",
  "./assets/vendor/leaflet/MarkerCluster.Default.css", "./assets/icons/icon-192.png",
  "./assets/vendor/maplibre/maplibre-gl.js", "./assets/vendor/maplibre/maplibre-gl.css", "./assets/vendor/maplibre/leaflet-maplibre-gl.js",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // 지도 타일·외부 링크는 그대로
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
