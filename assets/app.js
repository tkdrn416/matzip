/* 간사이 레전드 맛집 지도 — 데이터: data/restaurants.js (window.MATZIP) */
(function () {
  "use strict";

  const D = window.MATZIP;
  if (!D) {
    document.getElementById("list").innerHTML =
      '<li class="empty">data/restaurants.js 를 찾을 수 없어요. scripts/build.py 를 먼저 실행하세요.</li>';
    return;
  }

  const R = D.restaurants;
  // 목록 모드(list.html, 아티팩트): 지도 없이 목록·필터·예약·길찾기만
  const NOMAP = document.body.classList.contains("nomap");
  // 모바일 '목록 크게' 모드: 지도를 접고 목록만 (NOMAP 과 같은 동작)
  const listOnly = () => NOMAP || document.body.classList.contains("listbig");
  const CAT = Object.fromEntries(D.categories.map((c) => [c.name, c]));
  const YEN = { 1: "¥", 2: "¥¥", 3: "¥¥¥", 4: "¥¥¥¥" };
  const LS = { fav: "matzip:fav", vis: "matzip:visited" };

  const store = {
    get(k) { try { return new Set(JSON.parse(localStorage.getItem(k) || "[]")); } catch (e) { return new Set(); } },
    set(k, s) { try { localStorage.setItem(k, JSON.stringify([...s])); } catch (e) { /* private mode */ } },
  };
  const fav = store.get(LS.fav);
  const vis = store.get(LS.vis);

  const state = { q: "", region: "all", cats: new Set(), level: 0, prices: new Set(), books: new Set(), areas: new Set(), favOnly: false, hideVisited: false, openNow: false, easyWait: false, noSmoke: false, strong: false, me: null, sort: "level", tripDay: null, when: "" };
  const BOOK = Object.fromEntries((D.bookingTypes || []).map((b) => [b.name, b]));
  const BOOK_SHORT = { "앱예약": "온라인 예약", "전화예약만": "전화 예약만", "원격줄서기": "원격 번호표", "현장방문": "예약 없이 방문" };
  const resLabel = (r) => (r.reservation === "필수" ? " · 예약 필수" : "");
  // 예약은 받지만 꼭 할 필요는 없는 곳 (예약 '가능'·정보 없음) → 그냥 가도 됨
  const walkInOk = (r) => r.reservation !== "필수" && r.reservation !== "권장";
  const bookShort = (r) => (r.booking_type === "전화예약만" && walkInOk(r) ? "예약 없이 OK · 전화 예약 가능" : paidOnly(r) ? "유료 대행" : BOOK_SHORT[r.booking_type] || r.booking_type);
  const REASON = Object.fromEntries((D.reasonTypes || []).map((t) => [t.name, t]));
  const fmtN = (n) => Number(n).toLocaleString("ko-KR");

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------ map
  const PHONE = window.matchMedia("(max-width: 860px)").matches;
  const map = L.map("map", { zoomControl: !PHONE, preferCanvas: false, maxZoom: 19 }).setView([34.75, 135.6], 9);
  const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });
  const gsi = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>',
  });

  // ---- 한국어 벡터 지도 (OpenFreeMap: 무료·키 없음). 지명은 한국어 → 없으면 일본어
  const DARK = window.matchMedia("(prefers-color-scheme: dark)");
  const OFM = (dark) => `https://tiles.openfreemap.org/styles/${dark ? "dark" : "liberty"}`;
  // 한국어 → 영어(현지 표지판과 같은 로마자) → 일본어 순
  const KO_LABEL = ["coalesce", ["get", "name:ko"], ["get", "name:en"], ["get", "name:latin"], ["get", "name"]];
  function koreanize(gl) {
    try {
      (gl.getStyle().layers || []).forEach((ly) => {
        if (ly.type !== "symbol" || !ly.layout || !ly.layout["text-field"]) return;
        if (!JSON.stringify(ly.layout["text-field"]).includes("name")) return; // 도로 번호 등은 그대로
        gl.setLayoutProperty(ly.id, "text-field", KO_LABEL);
      });
    } catch (e) { /* 스타일 로딩 중 */ }
  }
  let koLayer = null;
  const glOK = !!(window.maplibregl && L.maplibreGL && (!maplibregl.supported || maplibregl.supported()));
  if (glOK) {
    koLayer = L.maplibreGL({
      style: OFM(DARK.matches),
      attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> · &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OSM</a>',
    });
    koLayer.addTo(map);
    const gl = koLayer.getMaplibreMap();
    gl.on("styledata", () => koreanize(gl));
    DARK.addEventListener && DARK.addEventListener("change", (e) => { try { gl.setStyle(OFM(e.matches)); } catch (err) { /* */ } });
  } else {
    osm.addTo(map); // WebGL 이 안 되면 일반 지도
  }
  const bases = {};
  if (koLayer) bases["한국어 지도"] = koLayer;
  bases["OpenStreetMap (일본어)"] = osm;
  bases["지리원 지도(연한색)"] = gsi;
  const layerCtl = L.control.layers(bases, null, { position: "topright" }).addTo(map);

  // ---- (선택) 구글 지도 한국어: Map Tiles API + 브라우저용 키 (tkdrn416.github.io 로 제한한 키)
  //      키 넣는 법: ⚙️ 지도 설정에 붙여넣기, 또는 한 번만 https://…/matzip/#gkey=키 로 열기 → 이 폰에 저장
  const GKEY_LS = "matzip:gkey";
  function captureKeyFromHash() {
    const m = location.hash.match(/^#gkey=([\w-]{20,})$/);
    if (!m) return false;
    try { localStorage.setItem(GKEY_LS, m[1]); } catch (e) { /* */ }
    try { Object.keys(localStorage).filter((k) => k.startsWith("matzip:gsess:")).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* */ }
    history.replaceState(null, "", location.pathname + location.search);
    setTimeout(() => toast("구글 지도 키를 이 폰에 저장했어요"), 600);
    return true;
  }
  captureKeyFromHash();
  window.addEventListener("hashchange", () => { if (captureKeyFromHash()) enableGoogle(true); });
  const gKey = () => { let k = ""; try { k = localStorage.getItem(GKEY_LS) || ""; } catch (e) { /* */ } return k || (window.MATZIP_CONFIG || {}).googleMapsKey || ""; };
  const NIGHT = [
    { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#9aa0a6" }] },
    { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#263c3f" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
    { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
    { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
  ];
  let gLayer = null, gSession = null, gAttrText = "";
  async function googleSession(key) {
    const dark = DARK.matches, ck = "matzip:gsess:" + (dark ? "d" : "l");
    let sess = null;
    try { sess = JSON.parse(localStorage.getItem(ck) || "null"); } catch (e) { /* */ }
    if (sess && sess.session && sess.k === key.slice(-6) && Date.now() / 1000 < Number(sess.expiry) - 3600) return sess.session;
    const body = { mapType: "roadmap", language: "ko-KR", region: "JP", scale: "scaleFactor2x", highDpi: true };
    if (dark) body.styles = NIGHT;
    const res = await fetch("https://tile.googleapis.com/v1/createSession?key=" + encodeURIComponent(key), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 140)}`);
    sess = await res.json(); sess.k = key.slice(-6);
    try { localStorage.setItem(ck, JSON.stringify(sess)); } catch (e) { /* */ }
    return sess.session;
  }
  let gAttrTimer;
  function updateGoogleAttr() {
    if (!gLayer || !map.hasLayer(gLayer)) return;
    clearTimeout(gAttrTimer);
    gAttrTimer = setTimeout(async () => {
      const b = map.getBounds(), key = gKey();
      const url = `https://tile.googleapis.com/tile/v1/viewport?session=${gSession}&key=${encodeURIComponent(key)}&zoom=${map.getZoom()}` +
        `&north=${b.getNorth()}&south=${b.getSouth()}&east=${b.getEast()}&west=${b.getWest()}`;
      try {
        const j = await (await fetch(url)).json();
        const txt = j.copyright ? `지도 데이터 ${j.copyright}` : "Google";
        if (txt !== gAttrText) { if (gAttrText) map.attributionControl.removeAttribution(gAttrText); map.attributionControl.addAttribution(txt); gAttrText = txt; }
      } catch (e) { /* */ }
    }, 800);
  }
  async function enableGoogle(showErrors) {
    const key = gKey();
    if (!key) return false;
    try {
      gSession = await googleSession(key);
      if (gLayer) { layerCtl.removeLayer(gLayer); map.removeLayer(gLayer); }
      gLayer = L.tileLayer(`https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${gSession}&key=${encodeURIComponent(key)}`, { maxZoom: 21, maxNativeZoom: 21, tileSize: 256 });
      layerCtl.addBaseLayer(gLayer, "구글 지도 (한국어)");
      Object.values(bases).forEach((l) => map.hasLayer(l) && map.removeLayer(l));
      gLayer.addTo(map);
      map.getContainer().classList.add("google-on");
      updateGoogleAttr();
      return true;
    } catch (e) {
      if (showErrors) toast("구글 지도를 못 불러와서 기본 지도를 써요: " + e.message);
      return false;
    }
  }
  map.on("moveend", updateGoogleAttr);
  map.on("baselayerchange", (e) => {
    map.getContainer().classList.toggle("google-on", e.layer === gLayer);
    if (e.layer !== gLayer && gAttrText) { map.attributionControl.removeAttribution(gAttrText); gAttrText = ""; }
    else updateGoogleAttr();
  });
  enableGoogle(true);
  // 지도 위 ⚙️ (폰에서도 지도 설정 열기)
  const GearCtl = L.Control.extend({
    options: { position: "topright" },
    onAdd() {
      const b = L.DomUtil.create("button", "gearbtn");
      b.type = "button"; b.title = "지도 설정"; b.setAttribute("aria-label", "지도 설정"); b.textContent = "⚙️";
      L.DomEvent.disableClickPropagation(b);
      L.DomEvent.on(b, "click", () => $("mapSettings") && $("mapSettings").click());
      return b;
    },
  });
  // 지도 설정(구글 지도 키)은 거의 안 쓰는 기능이라 지도 위 버튼 대신 '보는 법' 안으로
  const HelpCtl = L.Control.extend({
    options: { position: "topright" },
    onAdd() {
      const b = L.DomUtil.create("button", "gearbtn");
      b.type = "button"; b.title = "보는 법"; b.setAttribute("aria-label", "보는 법"); b.textContent = "?"; b.classList.add("qbtn");
      L.DomEvent.disableClickPropagation(b);
      L.DomEvent.on(b, "click", () => $("helpDlg") && $("helpDlg").showModal());
      return b;
    },
  });
  if (!NOMAP) new HelpCtl().addTo(map);
  const TripCtl = L.Control.extend({
    options: { position: "topright" },
    onAdd() {
      const b = L.DomUtil.create("button", "gearbtn tripctl");
      b.type = "button"; b.title = "내 동선"; b.setAttribute("aria-label", "내 동선"); b.textContent = "🧳";
      L.DomEvent.disableClickPropagation(b);
      L.DomEvent.on(b, "click", () => openTrip());
      return b;
    },
  });
  if (!NOMAP) new TripCtl().addTo(map);

  // 묶음(클러스터): 많이 확대할수록 작은 반경으로 → 의미 없는 "2"·"3" 묶음이 줄어듦. 묶음 안 최고 타베로그 점수도 표시
  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false, disableClusteringAtZoom: 16, spiderfyOnMaxZoom: true,
    maxClusterRadius: (z) => (z <= 13 ? 40 : 26),
    iconCreateFunction: (cl) => {
      const ms = cl.getAllChildMarkers();
      const n = ms.length, cnt = {};
      let best = 0;
      ms.forEach((m) => { const o = m.options; if (o.score > best) best = o.score; cnt[o.region] = (cnt[o.region] || 0) + 1; });
      const reg = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
      const col = (D.regions[reg] || {}).color || "#e4572e";
      const sz = n < 10 ? 38 : n < 50 ? 44 : 52;
      return L.divIcon({
        className: "mc", iconSize: [sz, sz],
        html: `<div class="mc-b" style="width:${sz}px;height:${sz}px;background:${col}"><b>${n}</b>${best ? `<i>${best.toFixed(2)}</i>` : ""}</div>`,
      });
    },
  });
  map.addLayer(cluster);
  cluster.on("animationend", () => declutter());

  function pinIcon(r) {
    const c = CAT[r.category] || CAT["기타"];
    const cls = "pin lv" + r.legend_level + (fav.has(r.id) ? " fav" : "") + (selId === r.id ? " sel" : "");
    let dot = "";
    if (PIN_STATUS) { const st = openStatus(r); if (st) dot = `<i class="sdot sd-${st.s === "open" || st.s === "soon" ? "open" : "closed"}"></i>`; }
    return L.divIcon({
      className: "pin-wrap",
      html: `<div class="${cls}" style="background:${c.color}">${c.emoji}</div>${dot}<span class="plabel" data-p="${(selId === r.id ? 1000 : 0) + r.legend_level * 10 + (Number(r.tabelog_score) || 0)}">${esc(r.name_ko)} <b>${Number(r.tabelog_score).toFixed(2)}</b></span>`,
      iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -16],
    });
  }

  // 확대하면 핀 아래에 가게 이름·타베로그 점수
  map.attributionControl.setPrefix(false); // 출처 표기를 한 줄로
  const syncLabels = () => map.getContainer().classList.toggle("show-labels", map.getZoom() >= 16);
  map.on("zoomend", syncLabels);
  // 이름표 겹침 정리: 점수 높은(선택한) 가게 이름표부터 놓고, 겹치는 이름표는 숨김 (더 확대하면 다시 보임)
  let dcT;
  function declutter() {
    clearTimeout(dcT);
    dcT = setTimeout(() => {
      const box = map.getContainer();
      if (!box.classList.contains("show-labels")) return;
      const els = [...box.querySelectorAll(".plabel")];
      els.forEach((e) => e.classList.remove("pl-hide"));
      const br = box.getBoundingClientRect();
      const items = els.map((e) => ({ e, r: e.getBoundingClientRect(), p: +e.dataset.p || 0 }))
        .filter((x) => x.r.width && x.r.bottom > br.top && x.r.top < br.bottom && x.r.right > br.left && x.r.left < br.right)
        .sort((a, b) => b.p - a.p);
      const kept = [...box.querySelectorAll(".stop-lbl")].map((e) => e.getBoundingClientRect()); // 동선 경유지 이름표는 항상 보이게
      items.forEach((x) => {
        const hit = kept.some((k) => x.r.left < k.right + 3 && k.left < x.r.right + 3 && x.r.top < k.bottom + 1 && k.top < x.r.bottom + 1);
        if (hit) x.e.classList.add("pl-hide"); else kept.push(x.r);
      });
    }, 80);
  }
  map.on("zoomend moveend resize", declutter);

  let PIN_STATUS = false, selId = null;
  const USE_CARD = PHONE && !NOMAP; // 폰: 팝업 대신 하단 카드
  const markers = new Map();
  // 같은 건물·바로 옆 가게(약 10m 이내)는 핀이 완전히 겹쳐 하나만 눌림 → 지도에서만 작은 원으로 살짝 벌려 놓음
  const POS = new Map();
  (() => {
    const done = new Set();
    R.forEach((a, i) => {
      if (done.has(a.id)) return;
      const grp = [a];
      for (let j = i + 1; j < R.length; j++) {
        const b = R[j];
        if (!done.has(b.id) && Math.abs(a.lat - b.lat) < 0.0001 && Math.abs(a.lng - b.lng) < 0.00012) grp.push(b);
      }
      if (grp.length < 2) return;
      grp.forEach((r, k) => {
        done.add(r.id);
        const ang = (2 * Math.PI * k) / grp.length - Math.PI / 2, m = 16;
        POS.set(r.id, [a.lat + (m * Math.sin(ang)) / 111000, a.lng + (m * Math.cos(ang)) / (111000 * Math.cos((a.lat * Math.PI) / 180))]);
      });
    });
  })();
  R.forEach((r) => {
    const m = L.marker(POS.get(r.id) || [r.lat, r.lng], { icon: pinIcon(r), title: r.name_ko, riseOnHover: true, zIndexOffset: r.legend_level * 100, score: Number(r.tabelog_score) || 0, region: r.region });
    if (USE_CARD) m.on("click", () => showCard(r));
    else m.bindPopup(() => popupHtml(r), { maxWidth: 300, minWidth: 260, maxHeight: Math.max(280, Math.round(map.getSize().y * 0.85)), autoPanPadding: [20, 20] });
    m.on("popupopen", () => {
      history.replaceState(null, "", "#" + r.id);
      if (state.open !== r.id) {
        state.open = r.id;
        renderList(current);
        const el = document.querySelector(`.item[data-id="${r.id}"]`);
        if (el) el.scrollIntoView({ block: "nearest" });
      }
      highlight(r.id);
    });
    markers.set(r.id, m);
  });

  // ------------------------------------------------------------------ popup
  function badgesHtml(r, limit) {
    const b = [];
    if (r.smoking === "흡연가능") b.push(`<span class="badge smk">🚬 흡연 가능</span>`);
    else if (r.smoking === "가열식만") b.push(`<span class="badge smk2">💨 가열식 담배만</span>`);
    if (r.google_status === "CLOSED_TEMPORARILY") b.push(`<span class="badge st-warn">⚠️ 임시 휴업(구글)</span>`);
    else if (r.google_status === "CLOSED_PERMANENTLY") b.push(`<span class="badge st-warn">⚠️ 폐업(구글)</span>`);
    const st = statusBadge(r);
    if (st) b.push(st);
    const wb = waitBadge(r);
    if (wb) b.push(wb);
    else if (qOf(r).s >= 3 && r.reservation !== "필수") b.push(`<span class="badge wt0" title="${esc(qOf(r).why.join(", "))}">🧘 한적한 편(추정)</span>`);
    const hasCta = r.booking_type === "앱예약" && ((r.links && r.links.booking) || []).length;
    if (r.booking_type && BOOK[r.booking_type] && !(hasCta && !limit)) {
      b.push(`<span class="badge bk bk-${esc(r.booking_type)}">${BOOK[r.booking_type].emoji} ${esc(bookShort(r))}${resLabel(r)}</span>`);
    }
    if (r.google_rating) b.push(`<span class="badge gg">⭐ 구글 ${esc(r.google_rating)}${r.google_reviews ? ` (${fmtN(r.google_reviews)})` : ""}</span>`);
    const aw = r.awards || [];
    if (limit) {
      // 목록 카드에선 짧게: "백명점", "Award", "미쉐린 ★"
      const short = [];
      if (aw.some((a) => /미쉐린\s*\d?\s*스타|미쉐린\s*[123]/.test(a))) short.push(["mich", "🎖 미쉐린 ★"]);
      else if (aw.some((a) => /빕/.test(a))) short.push(["mich", "🎖 빕구르망"]);
      if (aw.some((a) => /Award/i.test(a))) short.push(["tb", "🏆 Tabelog Award"]);
      if (aw.some((a) => /백명점/.test(a))) short.push(["tb", "백명점"]);
      short.forEach(([c, t]) => b.push(`<span class="badge ${c}">${t}</span>`));
    } else {
      aw.forEach((a) => {
        const cls = /미쉐린|Michelin/i.test(a) ? "mich" : /백명점|Tabelog|타베로그/i.test(a) ? "tb" : "";
        b.push(`<span class="badge ${cls}">${esc(a)}</span>`);
      });
    }
    if ((r.youtube || []).length || (r.reasons || []).some((x) => x.type === "유튜브")) b.splice(1, 0, `<span class="badge yt">▶ 유튜브 추천</span>`);
    if (limit && b.length > limit) return b.slice(0, limit).join("") + `<span class="badge more">+${b.length - limit}</span>`;
    return b.join("");
  }

  // 목록 카드용 배지: 지금 상태 · 웨이팅 · 예약 방식만 (나머지는 펼치면)
  function cardBadges(r) {
    const b = [];
    const qt = norm(state.q).split(/\s+/).filter(Boolean);
    const dish = qt.length ? dishFor(r, qt) : null;
    if (dish) b.push(`<span class="badge dish dish-${dish.grade}">🍝 ${esc(dish.name)} ${dish.grade === "A" ? "명물" : dish.grade === "B" ? "인기 메뉴" : "메뉴에 있음"}</span>`);
    if (r.smoking === "흡연가능") b.push(`<span class="badge smk">🚬 흡연 가능</span>`);
    else if (r.smoking === "가열식만") b.push(`<span class="badge smk2">💨 가열식만</span>`);
    if (r.google_status === "CLOSED_TEMPORARILY" || r.google_status === "CLOSED_PERMANENTLY") b.push(`<span class="badge st-warn">⚠️ ${r.google_status === "CLOSED_TEMPORARILY" ? "임시 휴업" : "폐업"}(구글)</span>`);
    const st = statusBadge(r).replace(" · 휴무일 변동 있음", "");
    if (st) b.push(st);
    const wb = waitBadge(r);
    if (wb) b.push(wb);
    if (r.booking_type && BOOK[r.booking_type]) b.push(`<span class="badge bk bk-${esc(r.booking_type)}${r.booking_type === "전화예약만" && walkInOk(r) ? " bk-walk" : ""}">${r.booking_type === "전화예약만" && walkInOk(r) ? "🚶" : BOOK[r.booking_type].emoji} ${esc(bookShort(r))}${resLabel(r)}</span>`);
    return b.slice(0, 3).join("");
  }
  const telHref = (p) => "tel:" + String(p).replace(/[^+\d]/g, "");
  // 길찾기: 내 위치가 1.5km 안이면 도보, 아니면 대중교통
  const dirUrl = (r) => {
    const u = r.links.directions;
    if (!state.me) return u;
    const la = state.me.lat !== undefined ? state.me.lat : state.me[0], ln = state.me.lng !== undefined ? state.me.lng : state.me[1];
    const dy = (r.lat - la) * 111000, dx = (r.lng - ln) * 111000 * Math.cos((la * Math.PI) / 180);
    return Math.hypot(dx, dy) <= 1500 ? u.replace(/travelmode=\w+/, "travelmode=walking") : u;
  };
  // +81-6-6211-0000 → 06-6211-0000 (일본 국내 표기, 한국 폰에선 +81 그대로 걸림)
  const telLocal = (p) => String(p).replace(/^\+81[-\s]?/, "0");

  // 예약 행동 버튼: 온라인 예약 → 전화 → 줄서기 순으로 "다음에 할 일"을 크게
  function bookBtns(r) {
    const bk = (r.links && r.links.booking) || [];
    const out = [];
    const canBook = r.booking_type === "앱예약" || r.booking_type === "원격줄서기";
    if (bk.length && canBook) {
      const [first, ...rest] = bk;
      const queue = r.booking_type === "원격줄서기" || /EPARK|Air|LINE/.test(first.app);
      const jp = (a) => (a === "핫페퍼" || a === "잇큐" || a === "구루나비" ? `${a}(일본어)` : appLabel(a));
      out.push(`<a class="cta book${PAID.test(first.app) ? " paid" : ""}" href="${esc(first.url)}" target="_blank" rel="noopener">${queue ? "🎫 번호표 받기" : PAID.test(first.app) ? "💳 예약 대행 신청(수수료)" : "📱 지금 예약하기"} · ${esc(jp(first.app))}</a>`);
      if (rest.length) out.push(`<div class="alt">다른 예약 경로: ${rest.map((b) => `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(jp(b.app))}</a>`).join(" · ")}</div>`);
    } else if (bk.length) {
      // 매장 자체는 예약 불가지만 일부(카페 층·코스 등)만 예약 링크가 있는 경우
      out.push(`<div class="alt">일부만 예약 가능 (예약 팁 참고): ${bk.map((b) => `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.app)}</a>`).join(" · ")}</div>`);
    }
    if (r.booking_type === "앱예약" && !bk.length) {
      out.push(`<div class="alt">예약 방법은 아래 '예약팁' 참고 (링크 미확인)</div>`);
    }
    const phoneOk = r.phone && r.phone_booking !== false && (r.booking_type === "전화예약만" || r.booking_type === "앱예약");
    const onlineCta = bk.length && canBook;
    if (phoneOk && !onlineCta && r.booking_type === "전화예약만" && walkInOk(r)) {
      out.push(`<div class="alt">예약하고 싶으면: <a href="${telHref(r.phone)}">📞 ${esc(telLocal(r.phone))}</a> · <button type="button" class="linkbtn" data-act="concierge" data-id="${r.id}">🏨 예약 부탁 문구</button></div>`);
    } else if (phoneOk && !onlineCta) {
      // 전화 예약이 주 경로: 큰 전화 버튼 + 호텔에 보여줄 문구
      out.push(`<div class="btns two">
        <a class="cta tel" href="${telHref(r.phone)}">📞 전화 예약<small>${esc(telLocal(r.phone))}</small></a>
        <button class="cta conc" data-act="concierge" data-id="${r.id}">🏨 예약 부탁 문구</button>
      </div>`);
      if (r.booking_type === "전화예약만") out.push(`<div class="alt">전화가 어렵다면: 호텔 프런트에 문구를 보여주거나 <a href="https://autoreserve.com/" target="_blank" rel="noopener">AutoReserve</a>(AI 전화 대행 앱)</div>`);
    } else if (phoneOk) {
      // 온라인 예약이 있으면 전화는 한 줄로
      out.push(`<div class="alt">전화도 돼요: <a href="${telHref(r.phone)}">📞 ${esc(telLocal(r.phone))}</a> · <button type="button" class="linkbtn" data-act="concierge" data-id="${r.id}">🏨 예약 부탁 문구</button></div>`);
    } else if (r.booking_type === "현장방문") {
      out.push(`<div class="alt walk">🚶 예약 없이 방문하는 곳이에요${r.tips ? " — 아래 팁 참고" : ""}</div>`);
    }
    return out.length ? `<div class="act">${out.join("")}</div>` : "";
  }

  // ---- 지금 영업 중 (일본 시간 기준, hours_week 사용)
  const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const fmtT = (m) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const JST_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  // 일본 공휴일 (2026-11 ~ 2027-12)
  const JP_HOLIDAYS = new Set(["2026-11-03", "2026-11-23", "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-21", "2027-03-22",
    "2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05", "2027-07-19", "2027-08-11", "2027-09-20", "2027-09-23", "2027-10-11", "2027-11-03", "2027-11-23"]);
  let nowCache = { at: 0, v: null };
  function jstNow() {
    if (Date.now() - nowCache.at < 30000 && nowCache.v) return nowCache.v;
    const parts = JST_FMT.formatToParts(new Date());
    const g = (t) => parts.find((p) => p.type === t).value;
    const date = `${g("year")}-${g("month")}-${g("day")}`;
    const v = { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday")), min: Number(g("hour")) * 60 + Number(g("minute")), date,
      holiday: JP_HOLIDAYS.has(date), yearEnd: /-(12-(29|30|31)|01-0[1-3])$/.test(date) };
    nowCache = { at: Date.now(), v };
    return v;
  }
  // 특정 날짜의 영업 구간: 요일별 시간 + 휴무 규칙(공휴일 휴무/영업, 공휴일 다음 날 휴무, 매월 n째 주 요일 휴무)
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function typicalIvs(w) {
    const cnt = {};
    Object.values(w).forEach((v) => { if (Array.isArray(v) && v.length) { const k = JSON.stringify(v); cnt[k] = (cnt[k] || 0) + 1; } });
    const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
    return best ? JSON.parse(best[0]) : null;
  }
  function dayInfo(r, dateStr) {
    const w = r.hours_week;
    if (!w) return null;
    const dt = new Date(dateStr + "T00:00:00"), k = DAYS[dt.getDay()];
    const cr = r.closed_rule || {};
    const hol = JP_HOLIDAYS.has(dateStr);
    if (hol && cr.hol === "closed") return { ivs: [], k, why: "공휴일 휴무" };
    if (hol && cr.hol === "open" && Array.isArray(w[k]) && !w[k].length) return { ivs: typicalIvs(w), k: null, why: "공휴일이라 영업" };
    const pv = new Date(dt); pv.setDate(pv.getDate() - 1);
    const pk = DAYS[pv.getDay()];
    if (!hol && cr.after && JP_HOLIDAYS.has(ymd(pv)) && Array.isArray(w[pk]) && !w[pk].length) return { ivs: [], k, why: "공휴일 다음 날 휴무" };
    if ((cr.nth || []).some(([n, d]) => d === k && Math.ceil(dt.getDate() / 7) === n)) return { ivs: [], k, why: `매월 ${Math.ceil(dt.getDate() / 7)}째 주 휴무` };
    return { ivs: w[k], k, why: "" };
  }
  // 영업일이 들쭉날쭉한 가게 (n째 주 휴무·부정기·계절·재료 소진) → '확인 필요' 표시
  const IRREG = /째|부정기|불규칙|계절|겨울|여름|시즌|소진|품절|매진|임시/;
  const irregular = (r) => IRREG.test([r.closed, r.hours_note, r.wait && r.wait.sellout].filter(Boolean).join(" "));
  function openStatus(r) {
    const st = openStatusRaw(r);
    if (!st) return st;
    const now = jstNow();
    // 휴무일 칸에서 괄호 속 예외(「공휴일이면 영업」 등)를 뺀 뒤에도 '공휴일'이 남으면 공휴일 휴무
    // 휴무 규칙으로 판단 못 하는 공휴일 문구(「공휴일엔 영업하는 경우 있음」 등)만 경고
    if ((st.s === "open" || st.s === "soon" || st.s === "later") && now.holiday && !(r.closed_rule || {}).hol && /공휴일|祝/.test(String(r.closed || ""))) return { s: "warn", t: "오늘 공휴일 — 휴무일 가능성" };
    if ((st.s === "open" || st.s === "soon" || st.s === "later") && now.yearEnd) return { ...st, t: st.t + " · 연말연시 확인", warn: true };
    if ((st.s === "open" || st.s === "soon") && irregular(r)) return { ...st, t: st.t + " · 휴무일 변동 있음", warn: true };
    if ((st.s === "open" || st.s === "soon") && r.reservation === "필수") return { ...st, t: st.t + " · 예약제" };
    return st;
  }
  // 영업 구간 하나의 상태: 라스트오더(L.O.)를 알면 그 시각부터 '주문 마감'
  function ivStatus(min, om, cm, lo) {
    if (lo != null) {
      if (min >= lo) return { s: "lo", t: `주문 마감 · L.O. ${fmtT(lo)} 지남` };
      return lo - min <= 45 ? { s: "soon", t: `곧 주문 마감 · L.O. ${fmtT(lo)}` } : { s: "open", t: `영업 중 · 주문 ${fmtT(lo)}까지` };
    }
    return cm - min <= 60 ? { s: "soon", t: `곧 마감 · ${fmtT(cm)} (주문은 더 일찍 끝날 수 있음)` } : { s: "open", t: `영업 중 · ${fmtT(cm)} 마감` };
  }
  function openStatusRaw(r) {
    const w = r.hours_week;
    if (!w) return null;
    const lw = r.lo_week || {};
    const { day, min, date } = jstNow();
    const yd = new Date(date + "T00:00:00"); yd.setDate(yd.getDate() - 1);
    const ti = dayInfo(r, date), yi = dayInfo(r, ymd(yd));
    const today = ti.ivs, yest = yi.ivs;
    if (ti.why && Array.isArray(today) && !today.length) return { s: "off", t: `오늘 휴무 · ${ti.why}` };
    if (Array.isArray(yest)) for (let i = 0; i < yest.length; i++) {
      const cm = toMin(yest[i][1]);
      if (cm > 1440 && min < cm - 1440) { const lo = yi.k ? (lw[yi.k] || [])[i] : null; return ivStatus(min + 1440, toMin(yest[i][0]), cm, lo ? toMin(lo) : null); }
    }
    if (today === null || today === undefined) return null;
    if (!today.length) return { s: "off", t: "오늘 휴무" };
    for (let i = 0; i < today.length; i++) {
      const om = toMin(today[i][0]), cm = toMin(today[i][1]);
      const lo = ti.k ? (lw[ti.k] || [])[i] : null;
      if (min >= om && min < cm) { const st = ivStatus(min, om, cm, lo ? toMin(lo) : null); return ti.why ? { ...st, t: st.t + " · " + ti.why } : st; }
    }
    const next = today.map(([o]) => toMin(o)).filter((om) => om > min).sort((a, b) => a - b)[0];
    return next != null ? { s: "later", t: `${fmtT(next)} 오픈` } : { s: "closed", t: "오늘 영업 종료" };
  }
  const SMOKE = Object.fromEntries((D.smokingTypes || []).map((x) => [x.name, x.emoji]));
  const smokeLabel = { "금연": "금연", "분연": "분연(흡연실 따로)", "가열식만": "가열식 담배만", "흡연가능": "흡연 가능" };
  const noSmoke = (r) => r.smoking === "금연" || r.smoking === "분연";
  const WAIT_SHORT = { 0: "웨이팅 거의 없음", 1: "웨이팅 ~15분", 2: "웨이팅 15~45분", 3: "웨이팅 45분+" };
  const waitLv = (r) => (r.wait && [0, 1, 2, 3].includes(r.wait.level) ? r.wait.level : null);
  const waitBadge = (r) => {
    const lv = waitLv(r);
    if (lv === null) return "";
    return `<span class="badge wt wt${lv}" title="최근 후기 기반 예상(피크 시간)">⏳ ${WAIT_SHORT[lv]}</span>`;
  };
  // 웨이팅 짧은 곳: 예상 15분 이하이거나 온라인 예약 가능
  // ---- 한적함 점수: 후기 기반 웨이팅 + 구글 리뷰 수(관광객 몰림) + 태그
  function quiet(r) {
    let s = 0;
    const why = [];
    const lv = waitLv(r);
    if (lv === 0) { s += 3; why.push("웨이팅 거의 없음"); }
    else if (lv === 1) { s += 2; why.push("웨이팅 짧음(~15분)"); }
    else if (lv === 2) { s -= 1; why.push("피크엔 15~45분 대기"); }
    else if (lv === 3) { s -= 3; why.push("피크엔 45분+ 대기"); }
    else if (r.booking_type === "앱예약" || r.booking_type === "전화예약만") { s += 1; why.push("예약하면 줄 없음"); }
    const n = r.google_reviews || 0;
    if (n && n < 300) { s += 2; why.push(`구글 리뷰 ${n}개(관광객 적음)`); }
    else if (n && n < 1000) { s += 1; why.push(`구글 리뷰 ${fmtN(n)}개`); }
    else if (n >= 3000) { s -= 2; why.push(`구글 리뷰 ${fmtN(n)}개(관광객 많음)`); }
    const t = r.tags || [];
    if (t.includes("줄서는집")) s -= 2;
    if (t.includes("웨이팅김")) s -= 2;
    if (t.includes("관광객인기")) s -= 1;
    if (t.includes("한국인인기")) s -= 1;
    if (t.includes("현지인맛집")) { s += 1; why.push("현지인 위주"); }
    return { s, why };
  }
  const QUIET = new Map();
  const qOf = (r) => { if (!QUIET.has(r.id)) QUIET.set(r.id, quiet(r)); return QUIET.get(r.id); };
  // 한적·웨이팅 없음: 점수 2 이상이고, 후기상 피크 대기가 15분 넘는 곳은 제외
  // 웨이팅 없이: 후기상 피크 대기 15분 이하. 후기가 없으면 '예약 가능 + 줄서는 집 아님 + 한적 점수 2+'인 곳만 (추정). 예약 필수는 제외
  const easyWait = (r) => {
    if (r.reservation === "필수") return false;
    const lv = waitLv(r);
    if (lv !== null) return lv <= 1;
    const t = r.tags || [];
    return (r.booking_type === "앱예약" || r.booking_type === "전화예약만") && !t.includes("줄서는집") && !t.includes("웨이팅김") && !t.includes("관광객인기") && qOf(r).s >= 3;
  };
  const quietLabel = (r) => { const q = qOf(r).s; return q >= 4 ? "아주 한적한 편" : q >= 2 ? "한적한 편" : q >= 0 ? "보통" : q >= -2 ? "붐비는 편" : "많이 붐빔"; };
  const statusBadge = (r) => {
    const ps = planStatus(r); // 동선 날짜나 '언제?'를 골랐으면 그 시각 기준
    const st = ps || openStatus(r);
    if (!st) return "";
    const icon = ps ? (st.s === "open" ? "🗓" : st.s === "warn" ? "⚠️" : "⚪") : st.s === "warn" ? "⚠️" : st.s === "open" ? "🟢" : st.s === "soon" ? "🟠" : "⚪";
    return `<span class="badge st-${st.s}" title="요일별 영업시간 기준(L.O.는 보통 30분~1시간 전). 방문 전 확인">${icon} ${esc(st.t)}</span>`;
  };

  function tbScore(r, withGoogle) {
    const g = withGoogle && r.google_rating ? `<i class="gsc" title="구글 지도 평점(리뷰 ${fmtN(r.google_reviews || 0)}개)">구글 ${r.google_rating}</i>` : "";
    if (!r.tabelog_score) return `<span class="tbs none" title="타베로그 점수 미확인">타베로그<b>-</b>${g}</span>`;
    const lvl = r.tabelog_score >= 4 ? "s4" : r.tabelog_score >= 3.7 ? "s3" : r.tabelog_score >= 3.5 ? "s2" : "s1";
    return `<span class="tbs ${lvl}" title="타베로그 점수">타베로그<b>${Number(r.tabelog_score).toFixed(2)}</b>${g}</span>`;
  }

  const PAID = /TABLE ?ALL|MY CONCIERGE|TakeMe/i;
  // 온라인 예약 경로가 유료 대행(수수료)뿐인 곳
  const paidOnly = (r) => r.booking_type === "앱예약" && (r.booking_apps || []).length > 0 && (r.booking_apps || []).every((b) => PAID.test(b.app));
  const appLabel = (a) => { const n = String(a).replace(/^기타:/, ""); return PAID.test(n) ? `${n}(유료 대행)` : n; };
  function onlineHtml(r) {
    const apps = (r.booking_apps || []).map((x) => appLabel(x.app)).join(", ");
    const chk = (r.booking_checked || ["타베로그"]).join("·");
    if (r.booking_type === "앱예약") {
      if (((r.links && r.links.booking) || []).length) return ""; // 아래 '지금 예약하기' 버튼이 같은 내용
      return `<div class="ob yes">📱 온라인 예약 가능${apps ? " · " + esc(apps) : ""}</div>`;
    }
    // 구글의 reservable 은 '예약 받음'(전화 포함) 정보 — 온라인 예약을 뜻하지 않음
    const gnote = r.google_reservable === true ? "구글 정보: 예약 받음(전화 포함일 수 있음)" : r.google_reservable === false ? "구글 정보: 예약 안 받음" : "구글 예약 정보 없음";
    if (r.booking_type === "현장방문") return `<div class="ob walkin">🚶 예약 없이 방문 (줄 서기)<small>${esc(chk)}에 온라인 예약 없음 · ${gnote}</small></div>`;
    if (r.booking_type === "전화예약만" && walkInOk(r)) return `<div class="ob walkin">🚶 예약 없이 가도 돼요 · ☎️ 전화 예약도 가능 (온라인 예약은 없음)</div>`;
    if (r.booking_type) return `<div class="ob no">${BOOK[r.booking_type] ? BOOK[r.booking_type].emoji : ""} ${esc(BOOK_SHORT[r.booking_type] || r.booking_type)} — 온라인 예약 없음<small>확인: ${esc(chk)} · ${gnote}</small></div>`;
    return `<div class="ob unk">❔ 온라인 예약 여부 미확인</div>`;
  }

  function reasonsHtml(r) {
    const rs = r.reasons || [];
    if (!rs.length) return "";
    return `<div class="rs"><b>선정 이유</b><ul>${rs.map((x) => {
      const t = REASON[x.type];
      const d = x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.detail)}</a>` : esc(x.detail);
      return `<li><span class="rt">${t ? t.emoji : "•"} ${esc(x.type)}</span> ${d}</li>`;
    }).join("")}</ul></div>`;
  }

  const isMobile = () => window.matchMedia("(max-width: 860px)").matches;

  function linkBtns(r) {
    const lk = r.links;
    const isFav = fav.has(r.id), isVis = vis.has(r.id);
    // 큰 버튼은 '예약(또는 전화)'과 '길찾기'만, 나머지는 작은 아이콘 줄로
    const navBtn = `<a class="cta nav navwide" href="${esc(dirUrl(r))}" target="_blank" rel="noopener">🧭 구글맵 길찾기${state.me && /walking/.test(dirUrl(r)) ? " (도보)" : ""}</a>`;
    // 그냥 가면 되는 곳은 길찾기를 맨 위로
    const walkFirst = r.booking_type === "현장방문" || (r.booking_type === "전화예약만" && walkInOk(r));
    return `${walkFirst ? navBtn + bookBtns(r) : bookBtns(r) + navBtn}
      <div class="mini">
        <a href="${esc(lk.google_maps)}" target="_blank" rel="noopener"><span>📍</span>구글맵</a>
        <a href="${esc(lk.tabelog)}" target="_blank" rel="noopener"><span>🍽</span>타베로그</a>
        <a href="${esc(photoUrl(r))}" target="_blank" rel="noopener"><span>📷</span>사진</a>
        <button class="${isFav ? "on" : ""}" data-id="${r.id}" data-act="fav"><span>${isFav ? "♥" : "♡"}</span>${isFav ? "찜함" : "찜"}</button>
        <button class="${isVis ? "on" : ""}" data-id="${r.id}" data-act="vis"><span>👣</span>${isVis ? "가봄" : "가봤어요"}</button>
        <button data-id="${r.id}" data-act="share"><span>🔗</span>공유</button>
      </div>
      ${(r.dishes || []).map((d) => `<div class="dishlinks">🍝 ${esc(d.name)} ${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">근거 보기</a> · ` : ""}<a href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent(r.name_ja + " " + (d.ja || d.name))}" target="_blank" rel="noopener">📷 ${esc(d.name)} 사진</a><br><small>구글맵 리뷰는 대부분 일본어예요 — 리뷰 검색창에 「${esc(d.ja || d.name)}」로 찾으면 후기가 나와요</small></div>`).join("")}
      <div class="ytline"><a href="${esc(lk.youtube)}" target="_blank" rel="noopener">▶ 유튜브에서 이 가게 검색</a></div>`;
  }
  // 타베로그 사진 목록(한국어판)
  const photoUrl = (r) => (r.tabelog_url ? r.tabelog_url.replace("https://tabelog.com/", "https://tabelog.com/kr/") + "dtlphotolst/" : `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(r.name_ja)}`);

  function nearHtml(r) {
    const near = R.filter((x) => x.id !== r.id)
      .map((x) => ({ x, d: map.distance([r.lat, r.lng], [x.lat, x.lng]) }))
      .filter((o) => o.d <= 1200)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    if (!near.length) return "";
    return `<div class="near"><b>근처 다른 맛집</b> ${near.map(({ x, d }) =>
      `<a data-goto="${x.id}">${(CAT[x.category] || CAT["기타"]).emoji} ${esc(x.name_ko)}</a> <span class="dist">${fmtDist(d)}</span>`).join(" · ")}</div>`;
  }

  function detailHtml(r) {
    const rows = [];
    if (r.signature) rows.push(["대표메뉴", r.signature]);
    rows.push(["가격", (r.price_note || D.priceLabel[r.price_level] || "-") + (r.price_level ? ` (${YEN[r.price_level]})` : "")]);
    if (r.hours) rows.push(["영업", r.hours]);
    if (r.closed) rows.push(["휴무", r.closed]);
    if (r.booking_type) rows.push(["예약", `${BOOK[r.booking_type] ? BOOK[r.booking_type].emoji + " " : ""}${paidOnly(r) ? "유료 예약 대행" : BOOK_SHORT[r.booking_type] || r.booking_type}${r.reservation ? " · 예약 " + r.reservation : ""}`]);
    else if (r.reservation) rows.push(["예약", r.reservation]);
    if (r.booking_note) rows.push(["예약팁", r.booking_note]);
    const ev = r.evidence || [];
    rows.push(["신뢰도", `근거 ${ev.length}개 · ${ev.length >= 3 ? "탄탄" : ev.length === 2 ? "괜찮음" : "근거 적음"} — ${ev.join(" · ") || "타베로그 등록"}`]);
    rows.push(["혼잡도", r.reservation === "필수" ? "예약제 — 예약 없이 들어가기 어려움" : `${quietLabel(r)}${waitLv(r) === null ? "(추정)" : ""} — ${qOf(r).why.join(", ") || "정보 적음"}`]);
    if (r.wait) {
      const w = r.wait;
      if (w.level !== undefined || w.estimate) rows.push(["웨이팅", [D.waitLabel[w.level], w.estimate].filter(Boolean).join(" — ") + " (후기 기반 예상)"]);
      if (w.best_time) rows.push(["한산한 때", w.best_time]);
      if (w.queue_system) rows.push(["번호표", w.queue_system]);
      if (w.sellout) rows.push(["품절", w.sellout]);
    } else if (r.booking_type === "앱예약") {
      rows.push(["웨이팅", "예약하면 대기 없음 (인기점은 예약 자체가 빨리 마감)"]);
    }
    if (r.smoking) rows.push(["흡연", `${SMOKE[r.smoking] || ""} ${smokeLabel[r.smoking] || r.smoking}${r.smoking_note ? " — " + r.smoking_note : ""} (타베로그 기준)`]);
    if (r.hours_note) rows.push(["영업참고", r.hours_note]);
    if (r.station) rows.push(["역", r.station]);
    if (r.phone) rows.push(["전화", `${telLocal(r.phone)} (해외에서 ${r.phone})`]);
    if ((r.youtube || []).length) rows.push(["유튜브", r.youtube.join(", ")]);
    (r.dishes || []).forEach((d) => rows.unshift([`🍝 ${d.name}`, `${d.grade === "A" ? "명물" : d.grade === "B" ? "인기 메뉴" : "메뉴에 있음"} — ${d.evidence}`]));
    // 예약·이동 버튼을 맨 위에: 고르고 바로 행동할 수 있게
    return `${onlineHtml(r)}
      ${r.notice ? `<div class="notice">⚠️ ${esc(r.notice)}</div>` : ""}
      ${r.google_status && r.google_status !== "OPERATIONAL" ? `<div class="notice">⚠️ 구글 지도에 「${r.google_status === "CLOSED_TEMPORARILY" ? "임시 휴업" : r.google_status === "CLOSED_PERMANENTLY" ? "폐업" : esc(r.google_status)}」 표시 (${esc(r.google_checked_at || "")} 기준) — 방문 전 확인</div>` : ""}
      ${linkBtns(r)}
      <div class="badges dbadges">${badgesHtml(r)}</div>
      <div class="why">${esc(r.why)}</div>
      ${reasonsHtml(r)}
      ${r.tips ? `<div class="tips">💡 ${esc(r.tips)}</div>` : ""}
      ${(() => { // 자주 보는 정보만 펼쳐 두고 나머지는 '자세한 정보'로
        const MAIN = new Set(["대표메뉴", "가격", "영업", "휴무", "예약", "예약팁", "웨이팅", "한산한 때", "흡연", ...(r.dishes || []).map((d) => `🍝 ${d.name}`)]);
        const dl = (xs) => `<dl>${xs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
        const main = rows.filter(([k]) => MAIN.has(k)), rest = rows.filter(([k]) => !MAIN.has(k));
        return dl(main) + (rest.length ? `<details class="moreinfo"><summary>자세한 정보 (${rest.map(([k]) => k).slice(0, 4).join("·")}${rest.length > 4 ? " 등" : ""})</summary>${dl(rest)}</details>` : "");
      })()}
      ${nearHtml(r)}
      ${NOMAP ? "" : `<button class="mapjump" data-act="mapview" data-id="${r.id}">🗺 이 지도에서 위치 보기</button>`}
      <div class="addr">${esc(r.address_ja)} ${esc(r.address_building || "")}</div>`;
  }

  // 모바일 지도 팝업용: 가장 중요한 두 버튼만 (예약 또는 전화 + 길찾기)
  function quickBtns(r) {
    const bk = (r.links && r.links.booking) || [];
    let first = "";
    if (bk.length && (r.booking_type === "앱예약" || r.booking_type === "원격줄서기")) {
      first = `<a class="cta book" href="${esc(bk[0].url)}" target="_blank" rel="noopener">${r.booking_type === "원격줄서기" ? "🎫 번호표" : "📱 예약하기"}</a>`;
    } else if (r.phone && r.phone_booking !== false && r.booking_type === "전화예약만") {
      first = `<a class="cta tel" href="${telHref(r.phone)}">📞 전화 예약</a>`;
    }
    const nav = `<a class="cta nav" href="${esc(dirUrl(r))}" target="_blank" rel="noopener">🧭 길찾기</a>`;
    return `<div class="btns two quick">${first || ""}${nav}</div>`;
  }

  function popupHtml(r) {
    const c = CAT[r.category] || CAT["기타"];
    const head = `<div class="pphead"><h3>${c.emoji} ${esc(r.name_ko)}</h3>${tbScore(r)}</div>
      <div class="ja">${esc(r.name_ja)}${r.name_en ? " · " + esc(r.name_en) : ""}</div>
      <div class="lvl" title="${esc((D.levelRule || {})[r.legend_level] || "")}">${"★".repeat(r.legend_level)} ${esc(D.levelLabel[r.legend_level])}${r.icon ? " · 🏯 지역 상징" : ""} · ${esc(r.category)} · ${esc(r.area)}</div>`;
    if (isMobile()) {
      // 모바일: 지도 위 팝업은 짧게, 자세한 내용은 아래 목록에서 펼침
      const c2 = CAT[r.category] || CAT["기타"];
      const mhead = `<div class="pphead"><h3>${c2.emoji} ${esc(r.name_ko)}</h3>${tbScore(r)}</div>`;
      return `<div class="pp">${mhead}<div class="badges">${statusBadge(r)}${waitBadge(r)}</div>${onlineHtml(r)}${quickBtns(r)}
        <div class="hint">↓ 선정 이유·영업시간·전화·팁은 아래 목록에서</div></div>`;
    }
    return `<div class="pp">${head}${detailHtml(r)}</div>`;
  }

  // ------------------------------------------------------------------ filters
  // 검색 표기 흔들림 보정: 타코야끼/타코야키, 쿠시카쯔/쿠시카츠, 돈까스/돈카츠, 라면/라멘 …
  const ALIAS = [[/나포리탄|나폴리타|napolitan|ナポリタン|케[첩찹]\s*스파게티/gi, "나폴리탄"], [/선술집|술집|대중주점|居酒屋|大衆酒場|izakaya/gi, "이자카야"], [/立ち飲み|立呑み|스탠딩\s*바|서서\s*마시는/g, "다치노미"], [/오무라이스|오무라이수|オムライス/g, "오므라이스"],
    [/함바그|햄버그|함바구|햄버거\s*스테이크|ハンバーグ/g, "함박"], [/푸린|プリン/g, "푸딩"], [/타마고\s*산도|계란\s*샌드|에그\s*샌드|玉子サンド|たまごサンド/g, "타마고산도"],
    [/규카츠|규까츠|牛カツ/g, "규카츠"], [/텐동|天丼/g, "덴동"], [/가이세키|카이세끼/g, "카이세키"], [/오꼬노미|오꼬노미/g, "오코노미"], [/돈가스|돈까스/g, "돈카츠"], [/라면/g, "라멘"], [/초밥/g, "스시"], [/우나기|장어덮밥/g, "장어"], [/고베규|소고기|쇠고기/g, "와규"]];
  const norm = (x) => {
    let t = String(x || "").toLowerCase();
    ALIAS.forEach(([re, to]) => { t = t.replace(re, to); });
    return t.replace(/끼/g, "키").replace(/꼬/g, "코").replace(/꾸/g, "쿠").replace(/까/g, "카").replace(/[쯔쓰]/g, "츠").replace(/찌/g, "치").replace(/따/g, "타").replace(/빠/g, "파").replace(/뽀/g, "포");
  };
  // '이자카야'로 찾을 때 술 마시기 좋은 곳(쿠시카츠·가성비 야키토리·오뎅·다치노미 등)도 함께 나오게
  const DRINKY = /오뎅|おでん|도테야키|다치노미|立ち飲み|사케|일본주|니혼슈|술안주|안주|酒|하이볼|생맥주/;
  const izakayaLike = (r) => r.category === "이자카야·다치노미" || r.category === "쿠시카츠"
    || (r.category === "야키토리·닭요리" && (r.price_level || 9) <= 3) || DRINKY.test([r.signature, r.why, r.tips].join(" "));
  function textOf(r) {
    return [izakayaLike(r) ? "이자카야 술집" : "", (r.dishes || []).map((d) => d.name + " " + (d.ja || "")).join(" "), r.name_ko, r.name_ja, r.name_en, r.area, r.category, r.signature, r.why, r.station, (r.tags || []).join(" "), (r.awards || []).join(" "), r.booking_type, (r.booking_apps || []).map((b) => b.app).join(" "), (r.reasons || []).map((x) => x.type + " " + x.detail).join(" "), r.smoking ? (noSmoke(r) ? "금연" : "흡연") : ""]
      .join(" ");
  }
  const TEXT = new Map(R.map((r) => [r.id, norm(textOf(r))]));

  // 🟢: 지금이면 '영업 중 + 주문 마감 전 + 예약 필수 아님', 다른 시각이면 '그 시각에 영업'
  function openOk(r) {
    const tt = targetTime();
    if (tt && tt.time) return openAt(r, tt.date, toMin(tt.time)) === true;
    if (tt) { const di = dayInfo(r, tt.date); return !!di && Array.isArray(di.ivs) && di.ivs.length > 0; }
    return ["open", "soon"].includes((openStatus(r) || {}).s) && r.reservation !== "필수";
  }
  // 지금(또는 고른 시각)에 갈 수 있는 정도: 0 바로 가능 · 1 나중에/예약제 · 2 오늘(그때) 안 됨
  function tierOf(r) {
    const tt = targetTime();
    if (tt) { const st = planStatus(r); return st && st.s === "open" ? 0 : st && st.s === "off" ? 2 : 1; }
    const st = openStatus(r);
    if (!st) return 1;
    if (["off", "closed", "lo"].includes(st.s)) return 2;
    return ["open", "soon"].includes(st.s) && walkInOk(r) ? 0 : 1;
  }
  const quality = (a, b) => b.legend_level - a.legend_level || (b.evidence || []).length - (a.evidence || []).length || (b.tabelog_score || 0) - (a.tabelog_score || 0);
  const DISH_GRADE = { A: 3, B: 2, C: 1 };
  function dishFor(r, terms) {
    return (r.dishes || []).find((d) => terms.some((t) => norm(d.name).includes(t) || t.includes(norm(d.name))));
  }
  function matchRank(r, terms) {
    const nm = norm(r.name_ko + " " + r.name_ja), sg = norm(r.signature || "");
    const dish = dishFor(r, terms);
    return (terms.every((t) => nm.includes(t)) ? 10 : 0) + (dish ? 4 + DISH_GRADE[dish.grade] : 0) + (terms.every((t) => sg.includes(t)) ? 3 : 0);
  }
  function filtered() {
    const terms = norm(state.q).split(/\s+/).filter(Boolean);
    tripClosedN = 0; tripMealN = 0;
    tripRad = state.tripDay && dayById(state.tripDay) ? computeTripRad(dayById(state.tripDay)) : null;
    let out = R.filter((r) =>
      (state.region === "all" || r.region === state.region) &&
      (!state.areas.size || state.areas.has(r.area)) &&
      (!state.cats.size || state.cats.has(r.category)) &&
      (!state.level || r.legend_level >= state.level) &&
      (!state.prices.size || state.prices.has(r.price_level)) &&
      (!state.books.size || state.books.has(r.booking_type || "미확인")) &&
      (!state.favOnly || fav.has(r.id)) &&
      (!state.openNow || openOk(r)) &&
      (!state.easyWait || easyWait(r)) &&
      (!state.noSmoke || noSmoke(r)) &&
      (!state.strong || (r.evidence || []).length >= 3) &&
      (!state.hideVisited || !vis.has(r.id)) &&
      terms.every((t) => TEXT.get(r.id).includes(t)) &&
      (!state.tripDay || tripKeep(r))
    );
    const sorters = {
      tabelog: (a, b) => (b.tabelog_score || 0) - (a.tabelog_score || 0),
      google: (a, b) => (b.google_reviews || 0) - (a.google_reviews || 0),
      grating: (a, b) => (b.google_rating || 0) - (a.google_rating || 0) || (b.google_reviews || 0) - (a.google_reviews || 0),
      quiet: (a, b) => qOf(b).s - qOf(a).s || (b.tabelog_score || 0) - (a.tabelog_score || 0),
    };
    const hotel = refHotelSort();
    if (hotel) { out.forEach((r) => { r._d = map.distance(hotel, [r.lat, r.lng]); }); out.sort((a, b) => a._d - b._d); return out; }
    if (state.me) out.forEach((r) => { r._d = map.distance(state.me, [r.lat, r.lng]); });
    if (sorters[state.sort]) {
      out.sort(sorters[state.sort]);
    } else if (state.me && state.sort === "dist") {
      out.sort((a, b) => a._d - b._d);
    } else if (state.me) {
      // 근처 추천: 걸어서 약 15분(1.2km) 안은 '지금 갈 수 있는 곳 → 좋은 곳' 순, 그 밖은 가까운 순
      const tier = new Map(out.map((r) => [r.id, tierOf(r)]));
      const nearB = (r) => (r._d <= 1200 ? 0 : 1);
      out.sort((a, b) => nearB(a) - nearB(b) || (nearB(a) === 0 ? tier.get(a.id) - tier.get(b.id) || quality(a, b) : a._d - b._d));
    } else if (state.tripDay) {
      // 동선 근처: 경유지 순서대로 묶고, 그 안에선 등급 → 근거 수 → 점수
      out.sort((a, b) => a._trip.i - b._trip.i || b.legend_level - a.legend_level
        || (b.evidence || []).length - (a.evidence || []).length || (b.tabelog_score || 0) - (a.tabelog_score || 0));
    } else {
      const order = Object.keys(D.regions);
      // 추천순: 오늘 아직 갈 수 있는 곳 먼저(오늘 휴무·영업 끝·주문 마감은 뒤로) → 지역 → 등급 → 근거 수 → 타베로그 점수
      const tier = new Map(out.map((r) => [r.id, tierOf(r)]));
      // 검색어가 있으면: 이름 > 대표 메뉴(그 메뉴의 명물 등급) > 설명 순으로 먼저
      const rel = new Map(out.map((r) => [r.id, terms.length ? matchRank(r, terms) : 0]));
      out.sort((a, b) => rel.get(b.id) - rel.get(a.id) || tier.get(a.id) - tier.get(b.id) || order.indexOf(a.region) - order.indexOf(b.region) || quality(a, b));
    }
    return out;
  }

  function chip(label, pressed, onClick, n) {
    const b = document.createElement("button");
    b.className = "chip";
    b.setAttribute("aria-pressed", String(pressed));
    b.innerHTML = esc(label) + (n != null ? `<span class="n">${n}</span>` : "");
    b.addEventListener("click", onClick);
    return b;
  }

  const allChip = (b) => { b.classList.add("all"); return b; }; // '전체' 칩: 눌려 있어도 필터가 아니므로 파란색 대신 테두리만

  // 지금 걸려 있는 필터 목록 (지도 위 표시·필터 더보기 개수용)
  function activeFilters() {
    const f = [];
    if (state.region !== "all") f.push(D.regions[state.region].ko);
    state.areas.forEach((a) => f.push(a));
    state.cats.forEach((c) => f.push(c));
    if (state.level) f.push(state.level === 3 ? "★★★" : "★★ 이상");
    if (state.prices.size) f.push(isCheap() ? "1만엔 이하" : [...state.prices].sort().map((x) => YEN[x]).join("·"));
    state.books.forEach((b) => f.push(BOOK_SHORT[b] || b));
    if (state.when && !state.tripDay && WHEN[state.when]) f.push("🕐 " + WHEN[state.when][2]);
    if (state.openNow) f.push(targetTime() ? targetTime().label + " 영업" : "지금 영업");
    if (state.strong) f.push("근거 3+");
    if (state.noSmoke) f.push("금연·분연");
    if (state.easyWait) f.push("웨이팅 없이");
    if (state.favOnly) f.push("찜만");
    if (state.hideVisited) f.push("방문 숨김");
    if (state.q) f.push(`"${state.q}"`);
    if (state.tripDay) { const d = dayById(state.tripDay); if (d) f.unshift(`🧳 ${dayLabel(d)} 동선${d.date && d.meal ? " · " + mealLabel(d.meal) : ""}`); }
    return f;
  }
  // 결과가 0일 때 하나씩 끌 수 있는 버튼
  function unblockBtns() {
    const B = [];
    const add = (k, label) => B.push(`<button type="button" class="chip" data-unblock="${k}">✕ ${esc(label)}</button>`);
    if (state.tripDay) add("tripDay", "동선");
    if (state.openNow) add("openNow", "지금 영업");
    if (state.easyWait) add("easyWait", "웨이팅 없이");
    if (state.noSmoke) add("noSmoke", "금연석");
    if (state.prices.size) add("prices", "가격");
    if (state.cats.size) add("cats", "음식 종류");
    if (state.books.size) add("books", "예약 방식");
    if (state.areas.size) add("areas", "세부 지역");
    if (state.region !== "all") add("region", D.regions[state.region].ko);
    if (state.q) add("q", `"${state.q}"`);
    if (state.favOnly) add("favOnly", "찜만");
    if (state.strong) add("strong", "근거 3개+");
    return B.join("") + '<button type="button" class="chip" data-unblock="all">모두 해제</button>';
  }
  function unblock(k) {
    if (k === "all") return clearFilters();
    if (["prices", "cats", "books", "areas"].includes(k)) state[k].clear();
    else if (k === "region") { state.region = "all"; state.areas.clear(); }
    else if (k === "q") { state.q = ""; $("q").value = ""; }
    else if (k === "tripDay") state.tripDay = null;
    else state[k] = false;
    update();
  }
  function clearFilters() {
    Object.assign(state, { q: "", region: "all", level: 0, favOnly: false, hideVisited: false, openNow: false, easyWait: false, noSmoke: false, strong: false, tripDay: null });
    state.cats.clear(); state.prices.clear(); state.books.clear(); state.areas.clear(); $("q").value = "";
    update(true);
  }
  function syncFilterCtl() {
    const box = document.querySelector(".fctl");
    if (!box) return;
    const f = activeFilters();
    box.hidden = !f.length;
    if (f.length) box.querySelector(".fctl-t").innerHTML = `<b>필터 ${f.length}개</b> · ${current.length}곳 <span>${esc(f.join(", "))}</span>`;
  }

  let renderChips = function () {
    const rc = $("regionChips"); rc.innerHTML = "";
    rc.append(allChip(chip("전체", state.region === "all", () => { state.region = "all"; state.areas.clear(); update(true); }, R.length)));
    Object.entries(D.regions).forEach(([k, v]) => {
      const n = R.filter((r) => r.region === k).length;
      if (n) rc.append(chip(v.ko, state.region === k, () => { state.region = k; state.areas.clear(); update(true); }, n));
    });

    const ac = $("areaChips"); ac.innerHTML = "";
    ac.hidden = state.region === "all";
    if (state.region !== "all") {
      const areaCount = {};
      R.filter((r) => r.region === state.region).forEach((r) => { areaCount[r.area] = (areaCount[r.area] || 0) + 1; });
      ac.append(allChip(chip("📍 전체 지역", !state.areas.size, () => { state.areas.clear(); update(true); })));
      const ents = Object.entries(areaCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
      const singles = ents.length > 12 ? ents.filter(([, n]) => n === 1).map(([a]) => a) : [];
      ents.filter(([a]) => !singles.includes(a)).forEach(([a, n]) =>
        ac.append(chip(a, state.areas.has(a), () => {
          state.areas.has(a) ? state.areas.delete(a) : state.areas.add(a);
          update(true);
        }, n)));
      if (singles.length >= 2) {
        const on = singles.every((a) => state.areas.has(a));
        const b = chip("그 외 지역", on, () => { singles.forEach((a) => (on ? state.areas.delete(a) : state.areas.add(a))); update(true); }, singles.length);
        b.title = singles.join(", ");
        ac.append(b);
      }
    }

    const cc = $("catChips"); cc.innerHTML = "";
    const base = R.filter((r) => (state.region === "all" || r.region === state.region) && (!state.areas.size || state.areas.has(r.area)));
    cc.append(allChip(chip("전체 종류", !state.cats.size, () => { state.cats.clear(); update(); })));
    D.categories.forEach((c) => {
      const n = base.filter((r) => r.category === c.name).length;
      if (!n) return;
      cc.append(chip(`${c.emoji} ${c.name}`, state.cats.has(c.name), () => {
        state.cats.has(c.name) ? state.cats.delete(c.name) : state.cats.add(c.name);
        update();
      }, n));
    });

    const bc = $("bookChips"); bc.innerHTML = "";
    bc.append(allChip(chip("예약 전체", !state.books.size, () => { state.books.clear(); update(); })));
    [...(D.bookingTypes || []), { name: "미확인", emoji: "❔" }].forEach((b) => {
      const n = base.filter((r) => (r.booking_type || "미확인") === b.name).length;
      if (!n) return;
      bc.append(chip(`${b.emoji} ${BOOK_SHORT[b.name] || b.name}`, state.books.has(b.name), () => {
        state.books.has(b.name) ? state.books.delete(b.name) : state.books.add(b.name);
        update();
      }, n));
    });

    const lc = $("levelChips"); lc.innerHTML = "";
    [[0, "모든 등급"], [3, "★★★ 3.8+·수상"], [2, "★★ 이상"]].forEach(([v, label]) =>
      lc.append((v ? (x) => x : allChip)(chip(label, state.level === v, () => { state.level = v; update(); }))));

    const pc = $("priceChips"); pc.innerHTML = "";
    [1, 2, 3, 4].forEach((p) => pc.append(chip(YEN[p], state.prices.has(p), () => {
      state.prices.has(p) ? state.prices.delete(p) : state.prices.add(p);
      update();
    })));

    $("favOnly").setAttribute("aria-pressed", String(state.favOnly));
    $("openNow").setAttribute("aria-pressed", String(state.openNow));
    $("easyWait").setAttribute("aria-pressed", String(state.easyWait));
    $("noSmoke").setAttribute("aria-pressed", String(state.noSmoke));
    const tdr = $("tripDays");
    if (tdr) {
      const ds = trip.days.filter((d) => d.stops.length);
      tdr.hidden = !ds.length;
      tdr.innerHTML = "";
      ds.forEach((d) => tdr.append(chip(`${dayLabel(d)}`, state.tripDay === d.id, () => {
        state.tripDay = state.tripDay === d.id ? null : d.id;
        update(); if (state.tripDay) { fitTrip(); toast(`${dayLabel(d)} 동선 근처 ${current.length}곳`); }
      })));
    }
    if ($("tripBtn")) {
      const td = state.tripDay && dayById(state.tripDay);
      $("tripBtn").setAttribute("aria-pressed", String(!!td));
      $("tripBtn").textContent = td ? `🧳 ${dayLabel(td)} 동선` : "🧳 내 동선";
    }
    if ($("cheap")) $("cheap").setAttribute("aria-pressed", String(isCheap()));
    if ($("openNow")) { const tt = targetTime(); $("openNow").textContent = tt ? `🟢 ${tt.label} 영업` : "🟢 지금 영업"; }
    if ($("when")) $("when").value = state.when || "";
    $("strong").setAttribute("aria-pressed", String(state.strong));
    $("favRoute").hidden = !fav.size;
    $("favShare").hidden = !fav.size;
    $("hideVisited").setAttribute("aria-pressed", String(state.hideVisited));
    $("locate").setAttribute("aria-pressed", String(!!state.me));
  }

  function fmtDist(m) { return m < 1000 ? Math.round(m) + "m" : (m / 1000).toFixed(m < 10000 ? 1 : 0) + "km"; }
  // 도보 80m/분 (일본 부동산 표기 기준)
  // 직선거리 × 1.25(길 돌아가는 몫) ÷ 분당 80m → '약 N분'
  const walk = (m) => (m <= 2500 ? `🚶 약 ${Math.max(1, Math.round((m * 1.25) / 80))}분 · ${fmtDist(m)}` : `🚃 ${fmtDist(m)}`);

  function renderList(rs) {
    const ol = $("list");
    if (state.inView && !listOnly()) { const b = map.getBounds(); rs = rs.filter((r) => b.contains([r.lat, r.lng])); }
    const nearN = state.me && !state.inView ? rs.filter((r) => r._d != null && r._d <= 1200).length : null;
    $("count").innerHTML = esc(state.inView && !listOnly() ? `화면 안 ${rs.length}곳` : nearN != null ? `15분 안 ${nearN}곳` : `${rs.length}곳`)
      + (fav.size ? ` · <button type="button" class="favlink${state.favOnly ? " on" : ""}" data-act="favonly">♥ 찜 ${fav.size}${state.favOnly ? " ✓" : ""}</button>` : "")
      + (vis.size ? ` · 가봄 ${vis.size}` : "");
    if (!rs.length) {
      const q = state.q ? state.q + (state.region !== "all" ? " " + D.regions[state.region].ko : "") : "";
      ol.innerHTML = '<li class="empty">조건에 맞는 곳이 없어요.' + (state.q
        ? `<br>이 DB에 없는 가게일 수 있어요 (타베로그 기준 미달·폐점·소개제 등은 뺐어요).<br><a class="cta nav" style="display:inline-block;margin-top:10px" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}" target="_blank" rel="noopener">🔎 구글맵에서 "${esc(state.q)}" 찾기</a>`
        : "") + (activeFilters().length ? `<div class="unblock"><span>이 조건을 빼 보세요:</span>${unblockBtns()}</div>` : "") + "</li>";
      return;
    }
    const favHead = state.favOnly && fav.size ? `<li class="favbar"><b>♥ 찜한 곳 ${rs.length}곳</b><button type="button" data-favbar="route">🗺 경로</button><button type="button" data-favbar="share">📤 일행에게 보내기</button><button type="button" data-favbar="off">✕</button></li>` : "";
    const grp = tripGrouped(), gcount = {};
    if (grp) rs.forEach((r) => { gcount[r._trip.i] = (gcount[r._trip.i] || 0) + 1; });
    const gday = grp && dayById(state.tripDay);
    const gpts = gday ? tripPoints(gday) : [];
    let gNext = 0;
    // 경유지별 '조건 없이' 근처 가게 수 (빈 묶음이 반경 때문인지, 필터 때문인지 알려 주려고)
    const raw = {};
    if (gday) R.forEach((r) => {
      let best = null;
      gpts.forEach((p) => { const d = dm(r, p); if (d <= ((tripRad && tripRad.get(p.i)) || trip.radius) && (!best || d < best.d)) best = { d, i: p.i }; });
      if (best) raw[best.i] = (raw[best.i] || 0) + 1;
    });
    const rad = trip.radius < 1000 ? trip.radius + "m" : trip.radius / 1000 + "km";
    const widened = (pt) => tripRad && tripRad.get(pt.i) > trip.radius;
    const gHead = (pt) => `<li class="grp">${pt.hotel ? "🏨" : `<span class="stop-no">${pt.i + 1}</span>`} ${esc(pt.n)} 근처 <small>${gcount[pt.i] ? gcount[pt.i] + "곳" + (widened(pt) ? " · 가게가 적어 1.2km까지 넓혔어요" : "")
      : raw[pt.i] ? `${raw[pt.i]}곳 있지만 지금 조건(식사 시간·그날 휴무·필터)에 안 맞아요` : `${rad} 안엔 없어요`}</small>${gcount[pt.i] ? "" : `<button type="button" class="grp-act" data-act="tripdlg">${raw[pt.i] ? "조건 보기" : "반경 넓히기"}</button>`}</li>`;
    // 아직 안 나온 경유지(맛집 0곳 포함) 머리글을 순서대로
    const headsUntil = (i) => { let h = ""; while (gNext < gpts.length && gpts[gNext].i <= i) { h += gHead(gpts[gNext]); gNext++; } return h; };
    ol.innerHTML = favHead + rs.map((r) => {
      const c = CAT[r.category] || CAT["기타"];
      const head = grp ? headsUntil(r._trip.i) : "";
      return head + `<li class="item${vis.has(r.id) ? " visited" : ""}${state.open === r.id ? " open" : ""}" data-id="${r.id}">
        <div class="em" style="background:${c.color}22">${c.emoji}</div>
        <div>
          <div class="t">${esc(r.name_ko)}<span class="lv" title="${esc((D.levelRule || {})[r.legend_level] || "")}">${"★".repeat(r.legend_level)}</span>${r.icon ? `<span class="icn" title="점수 기준 밖이지만 꼭 가볼 만한 원조·명물">🏯</span>` : ""}<span class="evc" title="독립 근거 ${(r.evidence || []).length}개: ${esc((r.evidence || []).join(", "))}">근거 ${(r.evidence || []).length}</span></div>
          <div class="meta">${esc(D.regions[r.region].ko)} ${esc(r.area)} · ${esc(r.category)} · <span class="nw">${YEN[r.price_level] || ""}</span>${noSmoke(r) ? ` · <span class="nw" title="${esc(smokeLabel[r.smoking])}">🚭${r.smoking === "분연" ? " 분연" : ""}</span>` : ""}</div>
          ${state.tripDay && r._trip ? `<div class="tripd">📍 ${esc(r._trip.n)}에서 ${walk(r._trip.d)}</div>` : ""}
          ${r.signature ? `<div class="sig">${esc(r.signature)}</div>` : ""}
          <div class="badges">${cardBadges(r)}</div>
        </div>
        <div class="side">
          ${tbScore(r, true)}
          <button class="iconbtn ${fav.has(r.id) ? "on" : ""}" data-act="fav" data-id="${r.id}" aria-label="찜">${fav.has(r.id) ? "♥" : "♡"}</button>
          ${(state.me || refHotelSort()) && r._d != null ? `<span class="dist"><small>${refHotelSort() ? "숙소에서" : "내 위치에서"}</small>${walk(r._d)}</span>` : ""}
        </div>
        ${state.open === r.id ? `<div class="more pp">${detailHtml(r)}</div>` : ""}
      </li>`;
    }).join("") + (grp ? headsUntil(1e9) : "");
  }

  const FLT_LS = "matzip:filters";
  let restoring = true;
  function saveFilters() {
    if (restoring) return;
    try {
      localStorage.setItem(FLT_LS, JSON.stringify({ t: Date.now(), region: state.region, areas: [...state.areas], cats: [...state.cats], prices: [...state.prices], books: [...state.books],
        level: state.level, openNow: state.openNow, easyWait: state.easyWait, noSmoke: state.noSmoke, strong: state.strong, favOnly: state.favOnly, hideVisited: state.hideVisited, tripDay: state.tripDay, sort: state.sort, when: state.when }));
    } catch (e) { /* */ }
  }
  function loadFilters() {
    restoring = false;
    try {
      const f = JSON.parse(localStorage.getItem(FLT_LS) || "null");
      if (!f || Date.now() - f.t > 12 * 3600e3) return false;
      Object.assign(state, { region: f.region || "all", level: f.level || 0, openNow: !!f.openNow, easyWait: !!f.easyWait, noSmoke: !!f.noSmoke, strong: !!f.strong, favOnly: !!f.favOnly, hideVisited: !!f.hideVisited,
        when: WHEN[f.when] ? f.when : "", tripDay: f.tripDay && dayById(f.tripDay) ? f.tripDay : null, sort: f.sort === "hotel" && !hotel ? "level" : f.sort || "level" });
      [["areas", f.areas], ["cats", f.cats], ["prices", f.prices], ["books", f.books]].forEach(([k, v]) => { state[k].clear(); (v || []).forEach((x) => state[k].add(x)); });
      if ($("sort").querySelector(`option[value="${state.sort}"]`)) $("sort").value = state.sort; else state.sort = "level";
      return true;
    } catch (e) { return false; }
  }
  let current = [];
  function update(fit, animate) {
    current = filtered();
    renderChips();
    renderList(current);
    cluster.clearLayers();
    cluster.addLayers(current.map((r) => markers.get(r.id)));
    declutter();
    syncFilterCtl();
    if (typeof drawTrip === "function") drawTrip();
    saveFilters();
    if (fit && current.length && !NOMAP) map.fitBounds(L.latLngBounds(current.map((r) => [r.lat, r.lng])).pad(0.08), { maxZoom: 15, animate: animate !== false });
  }

  function highlight(id) {
    document.querySelectorAll(".item.active").forEach((e) => e.classList.remove("active"));
    const el = document.querySelector(`.item[data-id="${id}"]`);
    if (el) { el.classList.add("active"); }
  }

  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // 폰 반반 화면에서 목록 항목을 눌렀을 때: 지도는 그 핀으로만 옮기고(카드 X) 선택 표시
  function showOnMap(id) {
    const m = markers.get(id);
    if (!m) return;
    hideCard();
    cluster.zoomToShowLayer(m, () => { map.panTo(m.getLatLng()); setSel(id); });
    history.replaceState(null, "", "#" + id);
  }
  function openPlace(id, scrollList) {
    const m = markers.get(id);
    if (!m) return;
    const hidden = listOnly() ? !current.some((x) => x.id === id) : !cluster.hasLayer(m);
    if (hidden) { // 필터에 걸려 숨겨진 경우 필터 해제
      Object.assign(state, { q: "", region: "all", level: 0, favOnly: false, hideVisited: false, openNow: false, easyWait: false, noSmoke: false, strong: false, tripDay: null });
      state.cats.clear(); state.prices.clear(); state.books.clear(); state.areas.clear(); $("q").value = "";
      update();
      toast("필터에 가려진 가게라 필터를 해제하고 보여드려요");
    }
    const r = R.find((x) => x.id === id);
    if (listOnly()) {
      if (state.open !== id) { state.open = id; renderList(current); }
      history.replaceState(null, "", "#" + id);
      const el = document.querySelector(`.item[data-id="${id}"]`);
      if (el) el.scrollIntoView({ block: "start" });
      return;
    }
    map.setView([r.lat, r.lng], Math.max(map.getZoom(), 16), { animate: false });
    cluster.zoomToShowLayer(m, () => (USE_CARD ? showCard(r) : m.openPopup()));
    if (scrollList && !USE_CARD) {
      const el = document.querySelector(`.item[data-id="${id}"]`);
      if (el) el.scrollIntoView({ block: "nearest" });
    }
    if (USE_CARD && document.body.classList.contains("listbig")) setViewMode("split");
  }

  // ---- 폰 하단 카드 (핀을 누르면)
  function setSel(id) {
    const prev = selId; selId = id;
    [prev, id].forEach((x) => { if (x && markers.get(x)) markers.get(x).setIcon(pinIcon(R.find((r) => r.id === x))); });
    declutter();
  }
  function showCard(r) {
    const c = CAT[r.category] || CAT["기타"];
    const bk = (r.links && r.links.booking) || [];
    let act = "";
    if (bk.length && (r.booking_type === "앱예약" || r.booking_type === "원격줄서기")) act = `<a class="cta book${PAID.test(bk[0].app) ? " paid" : ""}" href="${esc(bk[0].url)}" target="_blank" rel="noopener">${r.booking_type === "원격줄서기" ? "🎫 번호표" : PAID.test(bk[0].app) ? "💳 대행 예약" : "📱 예약"}</a>`;
    else if (r.phone && r.phone_booking !== false && r.booking_type === "전화예약만") act = `<a class="cta tel" href="${telHref(r.phone)}">📞 전화</a>`;
    const d = state.me ? map.distance(state.me, [r.lat, r.lng]) : null;
    const card = $("pcard");
    card.innerHTML = `<button class="pc-x" data-pc="close" aria-label="닫기">✕</button>
      <div class="pc-h"><span class="pc-em" style="background:${c.color}22">${c.emoji}</span>
        <div class="pc-t"><b>${esc(r.name_ko)}</b> <span class="lv">${"★".repeat(r.legend_level)}</span>${r.icon ? " 🏯" : ""}
          <div class="pc-m">${esc(r.area)} · ${esc(r.category)} · ${YEN[r.price_level] || ""}${d != null ? ` · ${walk(d)}` : ""}</div></div>
        ${tbScore(r)}</div>
      <div class="badges">${badgesHtml(r, 4)}</div>
      <div class="pc-why">${esc(r.why)}</div>
      <div class="pc-btns">${act}<a class="cta nav" href="${esc(dirUrl(r))}" target="_blank" rel="noopener">🧭 길찾기</a><button class="cta more" data-pc="more">📖 자세히</button><button class="cta pc-fav ${fav.has(r.id) ? "on" : ""}" data-pc="fav" aria-label="찜">${fav.has(r.id) ? "♥ 찜함" : "♡ 찜"}</button></div>`;
    if (curMode() === "split") setViewMode("map"); // 작은 지도에선 카드가 잘림 → 지도 크게
    card.hidden = false;
    card.dataset.id = r.id;
    setTimeout(() => { // 핀이 카드에 가리지 않게
      const pt = map.latLngToContainerPoint(markers.get(r.id).getLatLng()), h = map.getSize().y, top = h - card.offsetHeight - 24;
      if (pt.y > top || pt.y < 70) map.panBy([0, pt.y - Math.max(90, top / 2)]);
    }, 140);
    setSel(r.id);
    history.replaceState(null, "", "#" + r.id);
    state.open = r.id; renderList(current); highlight(r.id);
  }
  function hideCard() { const card = $("pcard"); if (card) card.hidden = true; setSel(null); }
  if ($("pcard")) $("pcard").addEventListener("click", (e) => {
    const t = e.target.closest("[data-pc]");
    if (!t) return;
    if (t.dataset.pc === "close") hideCard();
    if (t.dataset.pc === "fav") {
      const id = $("pcard").dataset.id;
      fav.has(id) ? fav.delete(id) : fav.add(id);
      store.set(LS.fav, fav);
      t.classList.toggle("on", fav.has(id)); t.textContent = fav.has(id) ? "♥ 찜함" : "♡ 찜";
      if (markers.get(id)) markers.get(id).setIcon(pinIcon(R.find((x) => x.id === id)));
      renderList(current); toast(fav.has(id) ? "찜했어요 — 목록 위 '찜'을 누르면 찜한 곳만 볼 수 있어요" : "찜을 뺐어요");
    }
    if (t.dataset.pc === "more") {
      const id = $("pcard").dataset.id;
      setViewMode("split");
      hideCard(); // 상세는 목록에서 펼쳐 보여 주므로 카드는 닫기
      state.open = id; renderList(current);
      setTimeout(() => { const el = document.querySelector(`.item[data-id="${id}"]`); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); }, 120);
    }
  });
  map.on("click", () => { if (USE_CARD) hideCard(); });

  // ---- 공유 · 컨시어지 문구 · 찜 경로
  function shareText(r) {
    return `${r.name_ko} (${r.name_ja})\n${r.category} · ${D.regions[r.region].ko} ${r.area} · 타베로그 ${r.tabelog_score || "-"}\n` +
      `${r.why}\n📍 ${r.links.google_maps}\n🍽 ${r.links.tabelog}` + (r.links.booking[0] && r.booking_type === "앱예약" ? `\n📱 예약 ${r.links.booking[0].url}` : "");
  }
  async function shareOrCopy(title, text) {
    try {
      if (navigator.share) { await navigator.share({ title, text }); return; }
    } catch (e) { if (e && e.name === "AbortError") return; }
    showText(title, text);
  }
  function showText(title, text, extraHtml) {
    $("dlgTitle").textContent = title;
    $("dlgExtra").innerHTML = extraHtml || "";
    $("dlgText").value = text;
    $("dlg").showModal();
  }
  function conciergeText(r) {
    const v = (id) => ($(id) && $(id).value) || "";
    const date = v("cDate"), time = v("cTime"), n = v("cNum") || "2", nm = v("cName");
    const d = date ? new Date(date + "T00:00:00") : null;
    const dj = d ? `${d.getMonth() + 1}月${d.getDate()}日(${"日月火水木金土"[d.getDay()]})` : "◯月◯日";
    return `【お願い】こちらのお店に電話で予約をしていただけますか。\n` +
      `店名：${r.name_ja}\n電話：${r.phone || "（食べログ参照）"}\n日時：${dj} ${time || "◯◯:◯◯"}\n人数：${n}名\n` +
      `名前：${nm || "（ローマ字）"}\n※満席の場合は前後の時間でも大丈夫です。\n\n` +
      `[직접 전화할 때]\nもしもし、予約をお願いしたいのですが、${dj}の${time || "◯◯時"}に${n}名で空いていますか？名前は${nm || "◯◯"}です。`;
  }
  function openConcierge(r) {
    const extra = `<div class="cform">
      <label>날짜 <input type="date" id="cDate"></label>
      <label>시간 <input type="time" id="cTime" step="900" value="18:00"></label>
      <label>인원 <input type="number" id="cNum" min="1" max="20" value="2"></label>
      <label>이름(영문) <input type="text" id="cName" placeholder="KIM"></label>
    </div><p class="cnote">호텔 프런트나 일본어 가능한 일행에게 이 화면을 보여주세요. 날짜·인원을 바꾸면 문구가 바뀝니다.</p>`;
    showText(`🏨 ${r.name_ko} 예약 부탁 문구`, "", extra);
    const td = state.tripDay && dayById(state.tripDay);
    if (td && td.date) $("cDate").value = td.date;
    if (td && td.meal) $("cTime").value = td.meal;
    $("dlgText").value = conciergeText(r); // 폼 값(기본 18:00·동선 날짜)으로 바로 채움
    ["cDate", "cTime", "cNum", "cName"].forEach((id) => $(id).addEventListener("input", () => { $("dlgText").value = conciergeText(r); }));
  }
  function favRouteUrl() {
    let stops = R.filter((r) => fav.has(r.id));
    if (!stops.length) return null;
    // 하루 동선은 한 도시 안에서: 선택한 지역, 없으면 찜이 가장 많은 지역
    let reg = state.region !== "all" ? state.region : null;
    if (!reg) {
      const cnt = {};
      stops.forEach((r) => { cnt[r.region] = (cnt[r.region] || 0) + 1; });
      reg = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
    }
    stops = stops.filter((r) => r.region === reg);
    if (!stops.length) return null;
    // 가까운 순으로 이어 붙이기 (내 위치가 있으면 거기서 출발)
    const ordered = [];
    let cur = state.me ? [state.me.lat, state.me.lng] : [stops[0].lat, stops[0].lng];
    while (stops.length) {
      stops.sort((a, b) => map.distance(cur, [a.lat, a.lng]) - map.distance(cur, [b.lat, b.lng]));
      const nx = stops.shift(); ordered.push(nx); cur = [nx.lat, nx.lng];
    }
    const max = isMobile() ? 4 : 10; // 구글맵 URL: 모바일은 경유지 3개까지
    const pick = ordered.slice(0, max);
    const q = (r) => `${r.name_ja} ${r.address_ja}`;
    const dest = pick[pick.length - 1];
    const way = pick.slice(0, -1).map(q).join("|");
    return { url: "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(q(dest)) + (way ? "&waypoints=" + encodeURIComponent(way) : ""), n: pick.length, total: ordered.length, names: ordered.map((r) => r.name_ko), region: D.regions[reg].ko };
  }

  function toggle(set, key, id) {
    set.has(id) ? set.delete(id) : set.add(id);
    store.set(key, set);
    const r = R.find((x) => x.id === id);
    const m = markers.get(id);
    m.setIcon(pinIcon(r));
    if (m.isPopupOpen()) m.getPopup().update(); // bindPopup(fn) 이라 내용이 다시 계산됨
    if (state.favOnly || state.hideVisited) update(); // 목록 구성이 바뀌는 경우만 재필터
    else { renderChips(); renderList(current); }
    highlight(id);
  }

  function favBar(a) {
    if (a === "route") $("favRoute").click();
    if (a === "share") $("favShare").click();
    if (a === "off") { state.favOnly = false; update(); }
  }
  function handleAct(btn) {
    const id = btn.dataset.id, act = btn.dataset.act, r = R.find((x) => x.id === id);
    if (act === "fav") { toggle(fav, LS.fav, id); toast(fav.has(id) ? `찜했어요 (♥ 찜 ${fav.size}) — 목록 위 '♥ 찜'을 누르면 모아 보기` : "찜을 뺐어요"); }
    else if (act === "vis") toggle(vis, LS.vis, id);
    else if (act === "share") shareOrCopy(r.name_ko, shareText(r));
    else if (act === "concierge") openConcierge(r);
    else if (act === "tripdlg") openTrip();
    else if (act === "mapview") { setListBig(false); setTimeout(() => { map.invalidateSize(); openPlace(id, false); }, 80); }
  }

  // ------------------------------------------------------------------ events
  $("count").addEventListener("click", (e) => {
    if (!e.target.closest('[data-act="favonly"]')) return;
    state.favOnly = !state.favOnly;
    if (state.favOnly) toast("찜한 곳만 보여요 — 필터 ▾ 안에 '찜한 곳 구글맵 경로'·'찜 목록 공유'");
    update(true);
  });
  $("list").addEventListener("click", (e) => {
    const ub = e.target.closest("[data-unblock]");
    if (ub) { unblock(ub.dataset.unblock); return; }
    const fb = e.target.closest("[data-favbar]");
    if (fb) { favBar(fb.dataset.favbar); return; }
    const btn = e.target.closest("button[data-act]");
    if (btn) { e.stopPropagation(); handleAct(btn); return; }
    const go = e.target.closest("[data-goto]");
    if (go) { state.open = go.dataset.goto; openPlace(go.dataset.goto, true); renderList(current); return; }
    if (e.target.closest("a, .more")) return; // 펼친 상세 안의 링크/내용 클릭은 그대로
    const li = e.target.closest(".item");
    if (!li) return;
    const id = li.dataset.id;
    if (state.open === id) { state.open = null; map.closePopup(); renderList(current); return; } // 접기
    state.open = id;
    renderList(current);
    if (USE_CARD) setTimeout(() => { const el = document.querySelector(`.item[data-id="${id}"]`); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); }, 60);
    if (USE_CARD && curMode() === "split") { showOnMap(id); return; } // 목록은 그대로 펼치고 지도에선 핀만 표시
    openPlace(id, true);
  });
  map.getContainer().addEventListener("click", (e) => {
    const go = e.target.closest(".pp [data-goto]");
    if (go) { openPlace(go.dataset.goto, true); return; }
    const btn = e.target.closest(".pp button[data-act]");
    if (btn) handleAct(btn);
  });

  let qTimer;
  $("q").addEventListener("input", (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.q = e.target.value.trim();
      if (state.q && landmarkSearch(state.q)) return;
      update();
      if (!state.q || !current.length || NOMAP) return;
      const b = map.getBounds(); // 결과가 지도 화면에 없거나 결과가 적으면(80곳 이하) 결과로 이동
      if (current.length <= 80 || !current.some((r) => b.contains([r.lat, r.lng]))) map.fitBounds(L.latLngBounds(current.map((r) => [r.lat, r.lng])).pad(0.1), { maxZoom: 16 });
    }, 250);
  });
  if ($("when")) $("when").addEventListener("change", (e) => {
    state.when = e.target.value;
    if (state.when && state.tripDay) { const d = dayById(state.tripDay); if (d && d.date && d.date !== jstNow().date) toast("동선 일차 날짜가 우선이에요 — 동선을 끄면 이 시각으로 봐요"); }
    update();
    if (state.when) toast(`${WHEN[state.when][2]} 기준으로 영업 여부를 보여 드려요 (🟢를 켜면 그때 여는 곳만)`);
  });
  $("sort").addEventListener("change", (e) => { state.sort = e.target.value; update(); $("list").scrollTop = 0; });
  $("favOnly").addEventListener("click", () => { state.favOnly = !state.favOnly; update(); });
  $("favRoute").addEventListener("click", () => {
    const rt = favRouteUrl();
    if (!rt) return;
    if (NOMAP) { // 아티팩트 등에선 window.open 이 막혀 있어 링크로 안내
      showText("🗺 찜한 곳 구글맵 경로", `${rt.region} 찜 ${rt.n}곳: ${rt.names.slice(0, rt.n).join(" → ")}`, `<p><a class="cta book" href="${esc(rt.url)}" target="_blank" rel="noopener">구글맵에서 경로 열기</a></p>`);
      return;
    }
    window.open(rt.url, "_blank", "noopener");
    if (rt.total > rt.n) showText("🗺 찜한 곳 경로", `${rt.region} 찜 ${rt.total}곳 중 가까운 순으로 앞의 ${rt.n}곳만 열었어요(구글맵 링크 제한).\n전체 순서: ${rt.names.join(" → ")}`);
    else toast(`${rt.region} 찜한 곳 ${rt.n}곳으로 경로를 열었어요 (다른 도시는 지역을 바꿔서)`);
  });
  $("favShare").addEventListener("click", () => {
    const list = R.filter((r) => fav.has(r.id));
    const link = "https://tkdrn416.github.io/matzip/#fav=" + list.map((r) => r.id).join(",");
    shareOrCopy("찜한 맛집", `♥ 찜한 맛집 ${list.length}곳\n` + list.map((r, i) => `${i + 1}. ${r.name_ko} (${r.name_ja}) · 타베로그 ${r.tabelog_score ? Number(r.tabelog_score).toFixed(2) : "-"}\n   ${r.links.google_maps}`).join("\n")
      + `\n\n이 링크를 열면 맛집 지도 앱에 찜 목록이 그대로 들어가요:\n${link}`);
  });
  $("dlgCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("dlgText").value); $("dlgCopy").textContent = "복사됨 ✓"; }
    catch (e) { $("dlgText").select(); document.execCommand && document.execCommand("copy"); $("dlgCopy").textContent = "복사됨 ✓"; }
    setTimeout(() => { $("dlgCopy").textContent = "복사"; }, 1500);
  });
  $("dlgClose").addEventListener("click", () => $("dlg").close());
  // ⚙️ 지도 설정 (구글 지도 키)
  const setBtn = $("mapSettings");
  if (setBtn) setBtn.addEventListener("click", () => {
    $("gkeyInput").value = gKey();
    $("gkeyStatus").textContent = gLayer ? "✅ 구글 지도 사용 중" : (gKey() ? "⚠️ 키는 있지만 불러오지 못함" : "키 없음 — 한국어 기본 지도 사용 중");
    $("setDlg").showModal();
  });
  if ($("gkeySave")) $("gkeySave").addEventListener("click", async () => {
    const v = $("gkeyInput").value.trim();
    try { v ? localStorage.setItem(GKEY_LS, v) : localStorage.removeItem(GKEY_LS); } catch (e) { /* */ }
    try { Object.keys(localStorage).filter((k) => k.startsWith("matzip:gsess:")).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* */ }
    if (!v) {
      if (gLayer) { map.removeLayer(gLayer); layerCtl.removeLayer(gLayer); gLayer = null; (koLayer || osm).addTo(map); }
      $("gkeyStatus").textContent = "키를 지웠어요 — 기본 지도"; return;
    }
    $("gkeyStatus").textContent = "확인 중…";
    $("gkeyStatus").textContent = (await enableGoogle(true)) ? "✅ 구글 지도로 바꿨어요" : "⚠️ 이 키로는 구글 지도를 못 불러와요 (설정 확인)";
  });
  if ($("setClose")) $("setClose").addEventListener("click", () => $("setDlg").close());
  // 보는 법(범례): 처음 열 때 한 번 자동으로 보여 줌, 목록 위 ❔ 로 언제든
  if ($("helpDlg")) {
    if ($("helpBtn2")) $("helpBtn2").addEventListener("click", () => $("helpDlg").showModal());
    try { if (!localStorage.getItem("matzip:helped") && !location.hash.slice(1)) { setTimeout(() => $("helpDlg").showModal(), 600); localStorage.setItem("matzip:helped", "1"); } } catch (e) { /* */ }
  }
  if ($("helpBtn") && $("helpDlg")) {
    $("helpBtn").addEventListener("click", () => $("helpDlg").showModal());
    $("helpClose").addEventListener("click", () => $("helpDlg").close());
    $("helpDlg").addEventListener("click", (e) => { if (e.target === $("helpDlg")) $("helpDlg").close(); });
  }
  $("openNow").addEventListener("click", () => { state.openNow = !state.openNow; update(); });
  $("easyWait").addEventListener("click", () => { state.easyWait = !state.easyWait; update(); });
  $("noSmoke").addEventListener("click", () => { state.noSmoke = !state.noSmoke; update(); });
  // 💴 1만 엔 이하(가격 ¥~¥¥¥) — 추천순 상위가 고급 코스로 쏠리는 걸 한 번에 거르기
  function isCheap() { return state.prices.size === 3 && [1, 2, 3].every((x) => state.prices.has(x)); }
  if ($("cheap")) $("cheap").addEventListener("click", () => { const on = isCheap(); state.prices.clear(); if (!on) [1, 2, 3].forEach((x) => state.prices.add(x)); update(); });
  $("strong").addEventListener("click", () => { state.strong = !state.strong; update(); });
  const refreshPins = () => { if (NOMAP) return; markers.forEach((m, id) => m.setIcon(pinIcon(R.find((r) => r.id === id)))); };
  setInterval(() => { if (state.openNow) update(); else renderList(current); refreshPins(); }, 5 * 60 * 1000); // 영업 상태 5분마다 갱신
  $("hideVisited").addEventListener("click", () => { state.hideVisited = !state.hideVisited; update(); });
  $("reset").addEventListener("click", () => {
    Object.assign(state, { q: "", region: "all", level: 0, favOnly: false, hideVisited: false, openNow: false, easyWait: false, noSmoke: false, strong: false, me: null, sort: "level", tripDay: null });
    $("sort").value = "level";
    state.cats.clear(); state.prices.clear(); state.books.clear(); state.areas.clear(); $("q").value = "";
    if (watchId !== null) stopLocate();
    update(true);
  });

  // ---- 내 위치 (파란 점 + 정확도 원, 따라가기)
  let meMarker = null, meCircle = null, watchId = null, follow = false, lastSorted = null;
  const LocateCtl = L.Control.extend({
    options: { position: "bottomright" },
    onAdd() {
      const b = L.DomUtil.create("button", "locbtn");
      b.type = "button"; b.title = "내 위치"; b.setAttribute("aria-label", "내 위치");
      b.innerHTML = "◎";
      L.DomEvent.disableClickPropagation(b);
      L.DomEvent.on(b, "click", () => toggleLocate());
      this._b = b; return b;
    },
  });
  const locCtl = new LocateCtl().addTo(map);
  const setLocBtn = (mode) => { locCtl._b.dataset.mode = mode; }; // off | on | follow
  map.on("dragstart", () => { if (follow) { follow = false; setLocBtn("on"); } });
  function onPos(pos) {
    const ll = L.latLng(pos.coords.latitude, pos.coords.longitude), acc = pos.coords.accuracy || 50;
    if (!meMarker) {
      meMarker = L.marker(ll, { icon: L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: 2000, interactive: false }).addTo(map);
      meCircle = L.circle(ll, { radius: acc, color: "#1a73e8", weight: 1, fillColor: "#1a73e8", fillOpacity: 0.12, interactive: false }).addTo(map);
      map.setView(ll, Math.max(map.getZoom(), 16));
    } else { meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(acc); }
    if (follow) map.panTo(ll, { animate: true });
    state.me = ll;
    // 목록 '가까운순'은 50m 이상 움직였을 때만 다시 정렬 (깜빡임 방지)
    if (!lastSorted || map.distance(lastSorted, ll) > 50) {
      lastSorted = ll;
      $("sort").options[0].text = "근처 추천순";
      if (state.sort === "level") update(); else renderList(current);
    }
  }
  function stopLocate() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null; follow = false; state.me = null; lastSorted = null;
    [meMarker, meCircle, refMarker].forEach((x) => x && map.removeLayer(x)); meMarker = meCircle = refMarker = null;
    $("sort").options[0].text = "추천순"; setLocBtn("off"); update();
  }
  function toggleLocate(forceStart) {
    if (!navigator.geolocation) { toast("이 브라우저는 위치 정보를 지원하지 않아요"); return; }
    if (watchId === null && refMarker) { map.removeLayer(refMarker); refMarker = null; state.me = null; }
    if (watchId !== null && !forceStart) {
      if (!follow && state.me) { follow = true; setLocBtn("follow"); map.setView(state.me, Math.max(map.getZoom(), 16)); return; }
      stopLocate(); return;
    }
    if (watchId !== null) return;
    follow = true; setLocBtn("follow");
    watchId = navigator.geolocation.watchPosition(onPos, (err) => {
      toast(err && err.code === 1 ? "위치 권한이 꺼져 있어요 — 폰 설정에서 브라우저 위치 허용을 켜 주세요" : err && err.code === 3 ? "위치 확인이 오래 걸려요 — 잠시 뒤 다시 눌러 주세요" : "현재 위치를 찾지 못했어요");
      stopLocate();
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
  }

  $("locate").addEventListener("click", () => {
    if (state.me && watchId !== null) { stopLocate(); return; }
    if (state.me && refMarker) { stopLocate(); return; }
    if (state.tripDay) { state.tripDay = null; toast("동선 필터를 끄고 내 위치 근처로 보여 드려요"); }
    state.sort = "level"; $("sort").value = "level";
    if (listOnly() && !NOMAP) setListBig(false);
    toggleLocate(true);
    $("list").scrollTop = 0;
  });

  // 구글 평점 데이터가 거의 없으면(20% 미만) 구글 정렬 옵션 숨김 — 의미 없는 정렬 방지
  if (R.filter((r) => r.google_rating).length < R.length * 0.2) {
    ["grating", "google"].forEach((v) => { const o = document.querySelector(`#sort option[value="${v}"]`); if (o) o.remove(); });
  }

  // 모바일: 상세 필터 접기/펼치기
  const moreBtn = $("moreFilters");
  function syncMore() {
    const n = state.cats.size + state.books.size + (isCheap() ? 1 : state.prices.size) + (state.level ? 1 : 0) + (state.openNow ? 1 : 0) + (state.easyWait ? 1 : 0) + (state.noSmoke ? 1 : 0) + (state.strong ? 1 : 0) + (state.favOnly ? 1 : 0) + (state.hideVisited ? 1 : 0);
    moreBtn.textContent = "필터 ▾" + (n ? ` ${n}` : "");
    if ($("fsApply")) $("fsApply").textContent = `${current.length}곳 보기`;
  }
  // 필터 시트 (폰: 아래에서 올라오는 시트, PC: 왼쪽 패널 안에 그대로)
  function openSheet(on) {
    document.body.classList.toggle("fopen", on);
    if ($("fsBack")) $("fsBack").hidden = !on;
    syncMore();
  }
  moreBtn.addEventListener("click", () => openSheet(!document.body.classList.contains("fopen")));
  if ($("fsClose")) $("fsClose").addEventListener("click", () => openSheet(false));
  if ($("fsApply")) $("fsApply").addEventListener("click", () => openSheet(false));
  if ($("fsBack")) $("fsBack").addEventListener("click", () => openSheet(false));
  const _renderChips = renderChips;
  renderChips = function () { _renderChips(); syncMore(); };

  // 모바일 보기: split(지도+목록) / map(지도 크게) / list(목록 크게)
  function setViewMode(mode) {
    document.body.classList.toggle("listbig", mode === "list");
    document.body.classList.toggle("mapbig", mode === "map");
    document.querySelectorAll("#viewSeg [data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === mode)));
    if (mode !== "list") setTimeout(() => map.invalidateSize(), 60);
    if (mode === "list") hideCard();
  }
  const setListBig = (on) => setViewMode(on ? "list" : "split");
  const curMode = () => (document.body.classList.contains("mapbig") ? "map" : document.body.classList.contains("listbig") ? "list" : "split");
  document.querySelectorAll("#viewSeg [data-view]").forEach((b) => b.addEventListener("click", () => setViewMode(curMode() === b.dataset.view ? "split" : b.dataset.view)));

  // ---- 이 지역 가게만 목록에
  const AreaCtl = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const b = L.DomUtil.create("button", "areabtn");
      b.type = "button"; b.textContent = "🔍 이 지역만 목록에";
      L.DomEvent.disableClickPropagation(b);
      L.DomEvent.on(b, "click", () => { state.inView = !state.inView; b.setAttribute("aria-pressed", String(state.inView)); renderList(current); if (state.inView) toast("지도를 움직이면 화면 안의 가게만 목록에 보여요"); });
      return b;
    },
  });
  if (!NOMAP) new AreaCtl().addTo(map);
  // 지도 위 '필터 N개 적용 중' 표시 — 지도만 크게 볼 때도 필터가 걸린 걸 알 수 있게. 누르면 필터 화면, ✕ 는 모두 해제
  const FilterCtl = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const d = L.DomUtil.create("div", "fctl");
      d.hidden = true;
      d.innerHTML = '<button type="button" class="fctl-t"></button><button type="button" class="fctl-x" aria-label="필터 모두 해제">✕ 해제</button>';
      L.DomEvent.disableClickPropagation(d);
      d.querySelector(".fctl-t").addEventListener("click", () => {
        if (USE_CARD && curMode() !== "split") setViewMode("split");
        $("panel").scrollTop = 0;
        if (typeof openSheet === "function") openSheet(true);
      });
      d.querySelector(".fctl-x").addEventListener("click", clearFilters);
      return d;
    },
  });
  if (!NOMAP) { new FilterCtl().addTo(map); syncFilterCtl(); }
  let inViewTimer;
  map.on("moveend", () => { if (state.inView) { clearTimeout(inViewTimer); inViewTimer = setTimeout(() => renderList(current), 150); } });

  // ---- 결과 전체 보기
  const FitCtl = L.Control.extend({
    options: { position: "bottomright" },
    onAdd() {
      const b = L.DomUtil.create("button", "fitbtn");
      b.type = "button"; b.title = "결과 전체 보기"; b.textContent = "⤢";
      L.DomEvent.disableClickPropagation(b);
      L.DomEvent.on(b, "click", () => { if (current.length) map.fitBounds(L.latLngBounds(current.map((r) => [r.lat, r.lng])).pad(0.08), { maxZoom: 15 }); });
      return b;
    },
  });
  if (!NOMAP) new FitCtl().addTo(map);

  // ---- 길게 누르기(또는 오른쪽 클릭): 여기 기준 가까운순 / 숙소로 저장
  const HOTEL_LS = "matzip:hotel";
  let hotel = null, hotelMarker = null, refMarker = null;
  try { hotel = JSON.parse(localStorage.getItem(HOTEL_LS) || "null"); } catch (e) { /* */ }
  function refHotelSort() { return state.sort === "hotel" && hotel ? L.latLng(hotel.lat, hotel.lng) : null; }
  function drawHotel() {
    if (hotelMarker) { map.removeLayer(hotelMarker); hotelMarker = null; }
    const opt = document.querySelector('#sort option[value="hotel"]');
    if (hotel) {
      hotelMarker = L.marker([hotel.lat, hotel.lng], { icon: L.divIcon({ className: "", html: '<div class="hotel-pin">🏨</div>', iconSize: [34, 34], iconAnchor: [17, 17] }), zIndexOffset: 1500 })
        .bindPopup('<div class="ctx"><b>🏨 내 숙소</b><button data-ctx="hotelsort">숙소에서 가까운순</button><button data-ctx="hoteldel">숙소 지우기</button></div>').addTo(map);
      if (!opt) { const o = document.createElement("option"); o.value = "hotel"; o.textContent = "🏨 숙소에서 가까운순"; $("sort").appendChild(o); }
    } else if (opt) { if (state.sort === "hotel") { state.sort = "level"; $("sort").value = "level"; } opt.remove(); }
  }
  if (!NOMAP) drawHotel();
  // 기준점(관광지·지도에서 고른 곳) 근처 추천
  function setRefPoint(ll, label) {
    if (watchId !== null) stopLocate();
    if (refMarker) map.removeLayer(refMarker);
    if (!NOMAP) refMarker = L.marker(ll, { icon: L.divIcon({ className: "", html: `<div class="ref-pin">📍</div><span class="stop-lbl">${esc(label)}</span>`, iconSize: [30, 30], iconAnchor: [15, 28] }), zIndexOffset: 1500 }).addTo(map);
    state.me = ll; state.tripDay = null; state.sort = "level"; $("sort").value = "level"; $("sort").options[0].text = `${label} 근처 추천순`;
    update();
    const n = current.filter((r) => r._d <= 1200).length;
    if (!NOMAP) map.setView(ll, 15);
    if (USE_CARD && curMode() === "map") setViewMode("split");
    toast(`📍 ${label} 근처: 걸어서 15분 안 ${n}곳 (좋은 곳 먼저) — 다시 누르면 📍 해제`);
  }
  map.on("contextmenu", (e) => {
    L.popup({ closeButton: true, className: "ctxpop" }).setLatLng(e.latlng)
      .setContent(`<div class="ctx"><div class="ctx-h">📌 동선에 추가</div><div class="ctx-days">${trip.days.slice(0, 6).map((d) => `<button data-ctx="stop" data-day="${d.id}" class="${(state.tripDay || trip.sel) === d.id ? "on" : ""}">${esc(dayLabel(d))}</button>`).join("")}<button data-ctx="stop" data-day="new">＋ 새 일차</button></div><button data-ctx="hotel">🏨 여기를 숙소로 저장</button><button data-ctx="here">📍 여기 기준으로 가까운순</button></div>`)
      .openOn(map);
    map._ctxLatLng = e.latlng;
  });
  map.getContainer().addEventListener("click", (e) => {
    const t = e.target.closest("[data-ctx]");
    if (!t) return;
    const ll = map._ctxLatLng;
    if (t.dataset.ctx === "here" && ll) { setRefPoint(ll, "선택한 곳"); map.closePopup(); }
    if (t.dataset.ctx === "here-old" && ll) {
      if (watchId !== null) stopLocate();
      if (refMarker) map.removeLayer(refMarker);
      refMarker = L.marker(ll, { icon: L.divIcon({ className: "", html: '<div class="ref-pin">📍</div>', iconSize: [30, 30], iconAnchor: [15, 28] }), zIndexOffset: 1500 }).addTo(map);
      state.me = ll; state.sort = "level"; $("sort").value = "level"; $("sort").options[0].text = "근처 추천순";
      map.closePopup(); update(); if (curMode() === "map") setViewMode("split");
      toast("선택한 곳에서 가까운 순으로 정렬했어요");
    }
    if (t.dataset.ctx === "stop" && ll) {
      const day = addStop({ n: "지도에서 고른 곳", lat: ll.lat, lng: ll.lng }, t.dataset.day);
      const st = day.stops[day.stops.length - 1];
      map.closePopup(); toast(`${dayLabel(day)}에 추가했어요 — 🧳 내 동선에서 이름·순서를 바꿀 수 있어요`);
      // 주소로 이름 붙이기 (OpenStreetMap)
      fetch("https://nominatim.openstreetmap.org/reverse?" + new URLSearchParams({ lat: ll.lat, lon: ll.lng, format: "json", zoom: "17", namedetails: "1", "accept-language": "ko,en,ja" }))
        .then((res) => res.json()).then((x) => {
          const nd = x.namedetails || {}, ad = x.address || {};
          const nm = nd["name:ko"] || nd["name:en"] || x.name || ad.attraction || ad.tourism || ad.building || ad.neighbourhood || ad.quarter || ad.suburb;
          if (nm && st.n === "지도에서 고른 곳") { st.n = String(nm).slice(0, 40) + " 근처"; saveTrip(); if (state.tripDay === day.id) update(); if (tdlg.open) renderTrip(); }
        }).catch(() => {});
    }
    if (t.dataset.ctx === "hotel" && ll) {
      hotel = { lat: ll.lat, lng: ll.lng, name: "숙소" };
      try { localStorage.setItem(HOTEL_LS, JSON.stringify(hotel)); } catch (err) { /* */ }
      map.closePopup(); drawHotel(); toast("숙소를 저장했어요 — 정렬에서 '숙소에서 가까운순'을 고르세요");
    }
    if (t.dataset.ctx === "hotelsort") { state.sort = "hotel"; $("sort").value = "hotel"; map.closePopup(); update(); if (curMode() === "map") setViewMode("split"); }
    if (t.dataset.ctx === "hoteldel") { hotel = null; try { localStorage.removeItem(HOTEL_LS); } catch (err) { /* */ } map.closePopup(); drawHotel(); update(); }
  });

  // ================================================================ 내 여행 동선
  // 숙소 + 일차별 경유지(관광지)를 저장해 두고, 고른 날 동선 근처 맛집만 보기. 링크로 일행 폰에 공유.
  const TRIP_LS = "matzip:trip";
  let trip = { days: [], radius: 800, withHotel: true, sel: null };
  const mealLabel = (t) => (t === "12:30" ? "점심 12:30" : t === "19:00" ? "저녁 19:00" : t);
  try { trip = Object.assign(trip, JSON.parse(localStorage.getItem(TRIP_LS) || "{}")); } catch (e) { /* */ }
  const saveTrip = () => { try { localStorage.setItem(TRIP_LS, JSON.stringify(trip)); } catch (e) { /* */ } };
  const LM = window.MATZIP_LANDMARKS || [];
  const dm = (a, b) => { const dy = (a.lat - b.lat) * 111000, dx = (a.lng - b.lng) * 111000 * Math.cos((a.lat * Math.PI) / 180); return Math.hypot(dx, dy); };
  const dayById = (id) => trip.days.find((d) => d.id === id);
  const fmtDate = (s) => { const dt = new Date(s + "T00:00:00"); return `${dt.getMonth() + 1}/${dt.getDate()}(${"일월화수목금토"[dt.getDay()]})`; };
  const dayLabel = (d) => `${trip.days.indexOf(d) + 1}일차${d.date ? " " + fmtDate(d.date) : ""}`;
  const saveHotel = () => { try { hotel ? localStorage.setItem(HOTEL_LS, JSON.stringify(hotel)) : localStorage.removeItem(HOTEL_LS); } catch (e) { /* */ } if (!NOMAP) drawHotel(); };
  // 숙소는 그날 경유지 중 하나라도 3km 안에 있을 때만 포함 (오사카 숙소 근처 가게가 교토 당일치기 목록을 채우지 않게)
  const hotelOnDay = (day) => trip.withHotel && hotel && (!day.stops.length || day.stops.some((s) => dm(s, hotel) <= 3000));
  function tripPoints(day) {
    const pts = day.stops.map((s, i) => ({ ...s, i }));
    if (hotelOnDay(day)) pts.push({ n: hotel.name || "숙소", lat: hotel.lat, lng: hotel.lng, i: 999, hotel: true });
    return pts;
  }
  // 그날 휴무인가 (요일 휴무 + 공휴일 휴무)
  function closedOn(r, dateStr) {
    if (!dateStr) return false;
    const di = dayInfo(r, dateStr);
    return !!di && Array.isArray(di.ivs) && di.ivs.length === 0;
  }
  // 그날 그 시각에 들어갈 수 있나 (라스트오더 반영). 영업시간 모르면 null
  function openAt(r, dateStr, min) {
    const di = dayInfo(r, dateStr);
    if (!di || !Array.isArray(di.ivs)) return null;
    const los = di.k ? (r.lo_week || {})[di.k] || [] : [];
    return di.ivs.some(([o, c], i) => { const end = los[i] ? toMin(los[i]) : toMin(c) - 30; return min >= toMin(o) && min < end; });
  }
  // 기준 시각: 동선 일차(날짜) > '언제?' 선택 > 지금(null)
  const WHEN = { "today-l": [0, "12:30", "오늘 점심"], "today-d": [0, "19:00", "오늘 저녁"], "tmr-l": [1, "12:30", "내일 점심"], "tmr-d": [1, "19:00", "내일 저녁"] };
  function targetTime() {
    const day = state.tripDay && dayById(state.tripDay);
    if (day && day.date && day.date !== jstNow().date) return { date: day.date, time: day.meal || "", label: fmtDate(day.date) + (day.meal ? " " + day.meal : "") };
    const w = WHEN[state.when];
    if (!w) return null;
    const d = new Date(jstNow().date + "T00:00:00"); d.setDate(d.getDate() + w[0]);
    return { date: ymd(d), time: w[1], label: w[2] };
  }
  // 계획한 날/시각의 영업 표시
  function planStatus(r) {
    const tt = targetTime();
    if (!tt) return null;
    const di = dayInfo(r, tt.date), md = tt.time ? tt.label : fmtDate(tt.date);
    if (!di || di.ivs === null || di.ivs === undefined) return { s: "warn", t: `${md} 영업시간 확인 필요` };
    if (!di.ivs.length) return { s: "off", t: `${md} 휴무${di.why ? " · " + di.why : ""}` };
    if (tt.time) { const ok = openAt(r, tt.date, toMin(tt.time)); return ok ? { s: "open", t: `${md} 영업` } : { s: "off", t: `${md}엔 영업 안 함` }; }
    return { s: "open", t: `${md} ${di.ivs.map(([o, c]) => `${o}–${fmtT(toMin(c))}`).join(", ")}${di.why ? " · " + di.why : ""}` };
  }
  let tripClosedN = 0, tripMealN = 0, tripRad = null;
  // 경유지 근처에 가게가 5곳 미만이면 그 경유지만 1.2km(걸어서 약 15분)로 넓힘
  function computeTripRad(day) {
    const m = new Map();
    tripPoints(day).forEach((p) => { const n = R.filter((r) => dm(r, p) <= trip.radius).length; m.set(p.i, n < 5 && trip.radius < 1200 ? 1200 : trip.radius); });
    return m;
  }
  function tripKeep(r) {
    const day = dayById(state.tripDay);
    if (!day) return true;
    let best = null;
    for (const p of tripPoints(day)) {
      const d = dm(r, p), rad = (tripRad && tripRad.get(p.i)) || trip.radius;
      if (d <= rad && (!best || d < best.d)) best = { n: p.n, d, i: p.i, hotel: !!p.hotel };
    }
    r._trip = best;
    if (!best) return false;
    if (closedOn(r, day.date)) { tripClosedN++; return false; }
    if (day.date && day.meal && openAt(r, day.date, toMin(day.meal)) === false) { tripMealN++; return false; }
    return true;
  }
  const tripGrouped = () => !!state.tripDay && state.sort === "level" && !state.me && !refHotelSort();

  // 지도: 번호 핀 + 점선 경로 + 반경 원
  let tripLayer = null;
  function drawTrip() {
    if (NOMAP) return;
    if (tripLayer) { map.removeLayer(tripLayer); tripLayer = null; }
    const day = dayById(state.tripDay);
    if (!day) return;
    tripLayer = L.layerGroup();
    const ring = (ll) => L.circle(ll, { radius: trip.radius, color: "#1a73e8", weight: 1, opacity: 0.55, fillOpacity: 0.05, interactive: false }).addTo(tripLayer);
    day.stops.forEach((s, i) => {
      ring([s.lat, s.lng]);
      L.marker([s.lat, s.lng], { interactive: false, zIndexOffset: 1800,
        icon: L.divIcon({ className: "", html: `<div class="stop-pin">${i + 1}</div><span class="stop-lbl">${esc(s.n)}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(tripLayer);
    });
    if (hotelOnDay(day)) ring([hotel.lat, hotel.lng]);
    const line = day.stops.map((s) => [s.lat, s.lng]);
    if (hotel) { line.unshift([hotel.lat, hotel.lng]); line.push([hotel.lat, hotel.lng]); }
    if (line.length > 1) L.polyline(line, { color: "#1a73e8", weight: 3, opacity: 0.7, dashArray: "6 8", interactive: false }).addTo(tripLayer);
    tripLayer.addTo(map);
  }
  function fitTrip() {
    const day = dayById(state.tripDay);
    if (NOMAP || !day) return;
    const pts = day.stops.length ? day.stops : hotel ? [hotel] : [];
    if (pts.length) map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])).pad(0.15), { maxZoom: 15, paddingTopLeft: [20, 110], paddingBottomRight: [70, 70] });
  }
  // 구간별 길찾기 (가까우면 도보, 멀면 대중교통)
  function dayLegs(day) {
    const pts = day.stops.map((s, i) => ({ ...s, tag: String(i + 1) }));
    if (hotelOnDay(day) && pts.length) { pts.unshift({ ...hotel, tag: "🏨" }); pts.push({ ...hotel, tag: "🏨" }); }
    const legs = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], d = dm(a, b);
      legs.push({ label: `${a.tag}→${b.tag}`, url: `https://www.google.com/maps/dir/?api=1&origin=${a.lat.toFixed(5)},${a.lng.toFixed(5)}&destination=${b.lat.toFixed(5)},${b.lng.toFixed(5)}&travelmode=${d < 1300 ? "walking" : "transit"}`, walk: d < 1300 });
    }
    return legs;
  }
  function dayRouteUrl(day) {
    const pts = day.stops.map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`);
    if (!pts.length) return null;
    const h = hotel ? `${hotel.lat.toFixed(5)},${hotel.lng.toFixed(5)}` : null;
    const origin = h || pts[0], dest = h || pts[pts.length - 1];
    const way = h ? pts : pts.slice(1, -1);
    return "https://www.google.com/maps/dir/?api=1&origin=" + origin + "&destination=" + dest + (way.length ? "&waypoints=" + encodeURIComponent(way.slice(0, 9).join("|")) : "");
  }

  // 장소 검색: 주요 관광지(내장) + OpenStreetMap 검색(호텔·주소 등). "34.67, 135.50" 좌표도 됨
  async function geoSearch(q) {
    const g3 = q.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
    const m = g3 || q.match(/(-?\d{1,3}\.\d+)\s*[,\s]\s*(-?\d{1,3}\.\d+)/);
    if (m) return [{ n: /google|goo\.gl/.test(q) ? "구글맵 링크의 장소" : "직접 입력한 좌표", lat: +m[1], lng: +m[2], d: `${(+m[1]).toFixed(5)}, ${(+m[2]).toFixed(5)}` }];
    if (/goo\.gl|maps\.app/.test(q)) throw new Error("short");
    const nq = norm(q).replace(/\s+/g, "");
    const local = LM.filter((x) => norm(x.n).replace(/\s+/g, "").includes(nq) || x.ja.includes(q.trim())).map((x) => ({ n: x.n, lat: x.lat, lng: x.lng, d: "주요 관광지" }));
    let remote = [];
    try {
      const u = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({ q, format: "json", limit: "6", countrycodes: "jp", namedetails: "1", "accept-language": "ko,en,ja", viewbox: "134.9,35.2,136.1,34.3", bounded: "1" });
      const res = await fetch(u, { headers: { Accept: "application/json" } });
      remote = (await res.json()).map((x) => {
        const nd = x.namedetails || {};
        const nm = nd["name:ko"] || nd["name:en"] || x.name || x.display_name.split(",")[0];
        const sub = nm !== (nd.name || x.name) && (nd.name || x.name) ? (nd.name || x.name) + " · " : "";
        return { n: String(nm).slice(0, 40), lat: +x.lat, lng: +x.lon, d: (sub + x.display_name.split(",").slice(1, 3).join(",")).trim() };
      });
    } catch (e) { if (!local.length) throw e; }
    const all = [];
    [...local, ...remote].forEach((x) => { if (!all.some((y) => (y.n === x.n || norm(y.n) === norm(x.n)) && dm(x, y) < 400)) all.push(x); });
    return all.slice(0, 10);
  }

  // ---- 동선 화면 (대화상자)
  const tdlg = document.createElement("dialog");
  tdlg.id = "tripDlg"; tdlg.className = "dlg trip";
  document.body.appendChild(tdlg);
  let tAdd = null, tFor = "stop", tRes = [], tLmReg = null, tMsg = "", tUndo = null;
  function tripSelDay() { if (!dayById(trip.sel)) trip.sel = trip.days[0] ? trip.days[0].id : null; return dayById(trip.sel); }
  function renderTrip() {
    const day = tripSelDay();
    const lmReg = tLmReg || (day && day.stops.length ? nearestRegion(day.stops[day.stops.length - 1]) : "osaka");
    const searchBox = (forWhat) => `<div class="t-search"><input type="search" id="tq" placeholder="${forWhat === "hotel" ? "호텔 이름 (예: Cross Hotel Osaka)" : "관광지·역·주소 (예: 오사카성, 渡月橋)"}" autocomplete="off" enterkeyhint="search"><button type="button" data-t="search-go">찾기</button></div>
      ${forWhat === "hotel" ? '<p class="cnote">영문·일본어 이름이 잘 찾아져요. 구글맵 주소창 링크나 좌표(34.67, 135.50)를 붙여 넣어도 돼요.</p>' : ""}
      <div class="t-res">${tMsg ? `<p class="cnote">${esc(tMsg)}</p>` : ""}${tRes.map((x, i) => `<button type="button" data-t="pick" data-i="${i}"><b>${esc(x.n)}</b><small>${esc(x.d || "")}</small></button>`).join("")}</div>`;
    tdlg.innerHTML = `
      <div class="trip-h"><h3>🧳 내 여행 동선</h3><button type="button" class="xbtn" data-t="close" aria-label="닫기">✕</button></div>
      <section class="t-sec">
        <div class="t-row"><b>🏨 숙소</b><span class="t-hn">${hotel ? esc(hotel.name || "지도에서 고른 곳") : "아직 없음"}</span>${hotel ? '<button type="button" class="t-ic" data-t="hotel-rename" aria-label="숙소 이름 바꾸기">✏️</button>' : ""}</div>
        <div class="t-btns"><button type="button" data-t="hotel-search">🔎 이름으로 찾기</button><button type="button" data-t="hotel-here">📍 지금 위치로</button>${hotel ? '<button type="button" data-t="hotel-del">지우기</button>' : ""}</div>
        ${tAdd === "search" && tFor === "hotel" ? searchBox("hotel") : ""}
        ${NOMAP ? "" : '<p class="cnote">지도를 길게 눌러 "숙소로 저장"해도 돼요.</p>'}
        <p class="cnote"><a href="hotels.html">🏨 아직 숙소를 고르는 중이면: 교토·오사카 숙소 비교 →</a></p>
      </section>
      <div class="t-tabs">${trip.days.map((d) => `<button type="button" data-t="day" data-id="${d.id}" aria-pressed="${d === day}">${esc(dayLabel(d))}</button>`).join("")}<button type="button" data-t="day-add">＋ 일차</button></div>
      ${day ? `<section class="t-sec">
        <label class="t-date">날짜 <input type="date" data-t="date" value="${esc(day.date || "")}"></label>
        <span class="cnote">날짜를 넣으면 그날 쉬는 가게는 빼고 보여요</span>
        <ol class="t-stops">${day.stops.map((s, i) => `<li><span class="no">${i + 1}</span><span class="nm">${esc(s.n)}</span><button type="button" data-t="rename" data-i="${i}" aria-label="이름 바꾸기">✏️</button><button type="button" data-t="up" data-i="${i}" aria-label="위로" ${i ? "" : "disabled"}>↑</button><button type="button" data-t="down" data-i="${i}" aria-label="아래로" ${i < day.stops.length - 1 ? "" : "disabled"}>↓</button><button type="button" class="del" data-t="del" data-i="${i}" aria-label="삭제">🗑</button></li>`).join("") || '<li class="t-empty">아직 장소가 없어요 — 아래에서 추가하세요.</li>'}</ol>
        ${tUndo && tUndo.day === day.id ? `<div class="t-undo">'${esc(tUndo.stop.n)}' 삭제함 <button type="button" data-t="undo">되돌리기</button></div>` : ""}
        <div class="t-btns"><button type="button" data-t="add-lm" aria-pressed="${tAdd === "lm"}">＋ 주요 관광지</button><button type="button" data-t="add-search" aria-pressed="${tAdd === "search" && tFor === "stop"}">🔎 장소 검색</button></div>
        ${tAdd === "lm" ? `<div class="t-lmreg">${Object.entries(D.regions).map(([k, v]) => `<button type="button" data-t="lmreg" data-k="${k}" aria-pressed="${k === lmReg}">${esc(v.ko)}</button>`).join("")}</div>
          <div class="t-lm">${LM.map((x, i) => [x, i]).filter(([x]) => x.r === lmReg).map(([x, i]) => `<button type="button" data-t="lm" data-i="${i}" class="${day.stops.some((s) => s.n === x.n) ? "on" : ""}">${esc(x.n)}</button>`).join("")}</div>` : ""}
        ${tAdd === "search" && tFor === "stop" ? searchBox("stop") : ""}
        <div class="t-meal"><b>식사 시간</b>${["", "12:30", "19:00"].map((v) => `<button type="button" data-t="meal" data-v="${v}" aria-pressed="${(day.meal || "") === v}" ${day.date ? "" : "disabled"}>${v ? mealLabel(v) : "상관없음"}</button>`).join("")}<label class="t-time">직접 <input type="time" data-t="mealtime" step="900" value="${esc(day.meal && !["12:30", "19:00"].includes(day.meal) ? day.meal : "")}" ${day.date ? "" : "disabled"}></label>
          <span class="cnote">${day.date ? "그날 그 시각에 영업 중(라스트오더 전)인 곳만 보여요" : "날짜를 넣으면 고를 수 있어요"}</span></div>
        <button type="button" class="cta book t-go" data-t="go" ${day.stops.length || hotel ? "" : "disabled"}>🍽 ${esc(dayLabel(day))} 동선 근처 맛집 보기</button>
        ${dayLegs(day).length ? `<div class="t-legs"><b>구간 길찾기</b>${dayLegs(day).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${l.walk ? "🚶" : "🚃"} ${esc(l.label)}</a>`).join("")}</div>` : ""}
        <div class="t-btns"><button type="button" data-t="day-del">이 일차 삭제</button></div>
      </section>` : '<p class="cnote t-sec">＋ 일차를 눌러 첫날을 만들어 보세요. 일차마다 갈 곳(관광지)을 넣어 두면 그 근처 맛집만 골라 볼 수 있어요.</p>'}
      <details class="t-adv"><summary>반경·숙소 포함 설정 (지금 ${trip.radius < 1000 ? trip.radius + "m" : trip.radius / 1000 + "km"})</summary><section class="t-sec t-opt">
        <span>동선에서</span>${[500, 800, 1200].map((v) => `<button type="button" data-t="rad" data-v="${v}" aria-pressed="${trip.radius === v}">${v < 1000 ? v + "m" : v / 1000 + "km"}</button>`).join("")}<span class="cnote">(${Math.round(trip.radius / 80)}분 걷는 거리)</span>
        <label class="t-chk"><input type="checkbox" data-t="withhotel" ${trip.withHotel ? "checked" : ""}> 숙소 근처도 포함 <small>(그날 갈 곳에서 3km 안일 때만)</small></label>
      </section></details>
      <div class="dlgbtns">${state.tripDay ? '<button type="button" data-t="off">동선 필터 끄기</button>' : ""}<button type="button" data-t="share">📤 일행에게 동선 보내기</button><button type="button" class="cta" data-t="close">닫기</button></div>`;
    if (tAdd === "search") setTimeout(() => { const q = $("tq"); if (q && !tRes.length) q.focus(); }, 30);
  }
  function nearestRegion(p) {
    let best = null;
    LM.forEach((x) => { const d = dm(p, x); if (!best || d < best.d) best = { d, r: x.r }; });
    return best ? best.r : "osaka";
  }
  function openTrip() { if (!trip.days.length) { trip.days.push({ id: "d" + Date.now(), date: "", stops: [] }); trip.sel = trip.days[0].id; saveTrip(); } tAdd = null; tRes = []; tMsg = ""; renderTrip(); tdlg.showModal(); }
  function addStop(p, dayId) {
    let day = dayId === "new" ? null : dayId ? dayById(dayId) : tripSelDay();
    if (!day) { day = { id: "d" + Date.now(), date: "", stops: [] }; trip.days.push(day); }
    trip.sel = day.id;
    day.stops.push({ n: p.n, lat: +(+p.lat).toFixed(6), lng: +(+p.lng).toFixed(6) });
    saveTrip();
    if (state.tripDay === day.id) update();
    return day;
  }
  async function runSearch() {
    const q = ($("tq") && $("tq").value.trim()) || "";
    if (!q) return;
    tMsg = "찾는 중…"; tRes = []; renderTrip(); $("tq").value = q;
    try { tRes = await geoSearch(q); tMsg = tRes.length ? "" : "못 찾았어요 — 일본어·영문 이름이나 주소로 다시 찾아 보세요. 지도 길게 누르기로도 추가할 수 있어요."; }
    catch (e) { tMsg = e && e.message === "short" ? "짧은 구글맵 링크(maps.app.goo.gl)는 열 수 없어요 — 구글맵에서 장소를 길게 눌러 나오는 좌표(예: 34.67, 135.50)를 붙여 넣거나 영문 이름으로 찾아 주세요." : "검색이 안 돼요(인터넷 확인). 주요 관광지 목록이나 지도 길게 누르기를 써 주세요."; }
    renderTrip(); if ($("tq")) $("tq").value = q;
  }
  tdlg.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "tq") { e.preventDefault(); runSearch(); } });
  tdlg.addEventListener("change", (e) => {
    const t = e.target.closest("[data-t]");
    if (!t) return;
    const day = tripSelDay();
    if (t.dataset.t === "date" && day) { day.date = t.value; saveTrip(); renderTrip(); if (state.tripDay === day.id) update(); }
    if (t.dataset.t === "withhotel") { trip.withHotel = t.checked; saveTrip(); if (state.tripDay) update(); }
    if (t.dataset.t === "mealtime" && day) { day.meal = t.value || ""; saveTrip(); renderTrip(); if (state.tripDay === day.id) update(); }
  });
  tdlg.addEventListener("click", (e) => {
    if (e.target === tdlg) { tdlg.close(); return; }
    const t = e.target.closest("[data-t]");
    if (!t || t.tagName === "INPUT") return;
    const a = t.dataset.t, day = tripSelDay(), i = +t.dataset.i;
    if (a === "close") { tdlg.close(); return; }
    if (a === "hotel-search") { tAdd = tAdd === "search" && tFor === "hotel" ? null : "search"; tFor = "hotel"; tRes = []; tMsg = ""; }
    if (a === "hotel-here") {
      if (!navigator.geolocation) { toast("이 기기에선 위치를 쓸 수 없어요"); return; }
      navigator.geolocation.getCurrentPosition((p) => { hotel = { lat: p.coords.latitude, lng: p.coords.longitude, name: "숙소(현재 위치)" }; saveHotel(); renderTrip(); toast("지금 위치를 숙소로 저장했어요"); if (state.tripDay) update(); },
        () => toast("위치 권한이 없어요 — 이름으로 찾거나 지도를 길게 눌러 주세요"), { enableHighAccuracy: true, timeout: 10000 });
      return;
    }
    if (a === "hotel-del") { hotel = null; saveHotel(); if (state.tripDay) update(); }
    if (a === "hotel-rename" && hotel) { const nm = prompt("숙소 이름", hotel.name || ""); if (nm && nm.trim()) { hotel.name = nm.trim().slice(0, 40); saveHotel(); if (state.tripDay) update(); } }
    if (a === "day") { trip.sel = t.dataset.id; tAdd = null; saveTrip(); }
    if (a === "day-add") { const d = { id: "d" + Date.now(), date: "", stops: [] }; const last = trip.days[trip.days.length - 1]; if (last && last.date) { const n = new Date(last.date + "T00:00:00"); n.setDate(n.getDate() + 1); d.date = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; } trip.days.push(d); trip.sel = d.id; tAdd = "lm"; saveTrip(); }
    if (a === "day-del" && day) { if (!confirm(`${dayLabel(day)}을(를) 지울까요?`)) return; if (state.tripDay === day.id) state.tripDay = null; trip.days = trip.days.filter((d) => d !== day); trip.sel = null; saveTrip(); update(); }
    if (a === "add-lm") { tAdd = tAdd === "lm" ? null : "lm"; }
    if (a === "add-search") { tAdd = tAdd === "search" && tFor === "stop" ? null : "search"; tFor = "stop"; tRes = []; tMsg = ""; }
    if (a === "lmreg") { tLmReg = t.dataset.k; }
    if (a === "lm" && day) { const x = LM[i]; if (day.stops.some((s) => s.n === x.n)) { day.stops = day.stops.filter((s) => s.n !== x.n); saveTrip(); if (state.tripDay === day.id) update(); } else addStop(x); }
    if (a === "search-go") { runSearch(); return; }
    if (a === "pick") {
      const x = tRes[i];
      if (!x) return;
      if (tFor === "hotel") { hotel = { lat: x.lat, lng: x.lng, name: x.n }; saveHotel(); toast(`숙소: ${x.n}`); if (state.tripDay) update(); }
      else { addStop(x); toast(`${dayLabel(tripSelDay())}에 '${x.n}' 추가`); }
      tAdd = null; tRes = []; tMsg = "";
    }
    if (a === "rename" && day) { const nm = prompt("장소 이름", day.stops[i].n); if (nm && nm.trim()) { day.stops[i].n = nm.trim().slice(0, 40); saveTrip(); if (state.tripDay === day.id) update(); } }
    if (a === "up" && day && i > 0) { [day.stops[i - 1], day.stops[i]] = [day.stops[i], day.stops[i - 1]]; saveTrip(); if (state.tripDay === day.id) update(); }
    if (a === "down" && day && i < day.stops.length - 1) { [day.stops[i + 1], day.stops[i]] = [day.stops[i], day.stops[i + 1]]; saveTrip(); if (state.tripDay === day.id) update(); }
    if (a === "del" && day) { tUndo = { day: day.id, i, stop: day.stops[i] }; day.stops.splice(i, 1); saveTrip(); if (state.tripDay === day.id) update(); }
    if (a === "rad") { trip.radius = +t.dataset.v; saveTrip(); if (state.tripDay) update(); }
    if (a === "meal" && day) { day.meal = t.dataset.v; saveTrip(); if (state.tripDay === day.id) update(); }
    if (a === "undo" && tUndo) { const d0 = dayById(tUndo.day); if (d0) { d0.stops.splice(tUndo.i, 0, tUndo.stop); saveTrip(); if (state.tripDay === d0.id) update(); } tUndo = null; }
    if (a === "go" && day) {
      state.tripDay = day.id; tdlg.close();
      if (USE_CARD && curMode() === "list") setViewMode("split");
      update(); fitTrip();
      setTimeout(() => { const el = document.querySelector("#list .grp, #list .item"); if (el) el.scrollIntoView({ block: "nearest" }); }, 80);
      const nh = current.filter((r) => r._trip && r._trip.hotel).length;
      toast(`${dayLabel(day)} 동선 근처 ${current.length}곳${nh ? `(숙소 근처 ${nh})` : ""}${tripClosedN ? ` · 그날 휴무 ${tripClosedN}곳 제외` : ""}${tripMealN ? ` · ${mealLabel(day.meal)}에 영업 안 하는 ${tripMealN}곳 제외` : ""}`);
      return;
    }
    if (a === "off") { state.tripDay = null; tdlg.close(); update(); return; }
    if (a === "share") { shareTrip(); return; }
    renderTrip();
  });
  // 공유: 동선을 링크(#trip=…)로. 받은 사람이 열면 불러오기
  const b64e = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64d = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
  function shareTrip() {
    const data = { h: hotel ? [hotel.name || "숙소", +hotel.lat.toFixed(5), +hotel.lng.toFixed(5)] : null,
      d: trip.days.map((d) => ({ t: d.date || "", m: d.meal || "", s: d.stops.map((s) => [s.n, +(+s.lat).toFixed(5), +(+s.lng).toFixed(5)]) })), r: trip.radius };
    const url = "https://tkdrn416.github.io/matzip/#trip=" + b64e(JSON.stringify(data));
    const lines = trip.days.map((d) => `${dayLabel(d)}: ${d.stops.map((s) => s.n).join(" → ") || "-"}`).join("\n");
    shareOrCopy("우리 여행 동선", `🧳 우리 여행 동선${hotel ? `\n🏨 ${hotel.name || "숙소"}` : ""}\n${lines}\n\n이 링크를 열면 맛집 지도에 동선이 그대로 들어가요:\n${url}`);
  }
  function importTripFromHash() {
    const m = location.hash.match(/^#trip=([\w-]+)/);
    if (!m) return false;
    try {
      const data = JSON.parse(b64d(m[1]));
      const days = (data.d || []).map((d, k) => ({ id: "d" + (Date.now() + k), date: d.t || "", meal: d.m || "", stops: (d.s || []).map(([n, lat, lng]) => ({ n: String(n).slice(0, 40), lat: +lat, lng: +lng })) }));
      history.replaceState(null, "", location.pathname + location.search);
      if ((trip.days.some((d) => d.stops.length) || hotel) && !confirm("일행이 보낸 동선을 불러올까요? (지금 저장된 동선은 바뀌어요)")) return true;
      trip.days = days; trip.sel = days[0] ? days[0].id : null; if (data.r) trip.radius = +data.r;
      if (data.h) { hotel = { name: data.h[0], lat: +data.h[1], lng: +data.h[2] }; saveHotel(); }
      saveTrip(); setTimeout(openTrip, 300); toast("동선을 불러왔어요");
    } catch (e) { toast("동선 링크를 읽지 못했어요"); }
    return true;
  }
  if ($("tripBtn")) $("tripBtn").addEventListener("click", openTrip);

  // 관광지 이름으로 검색하면 그 근처 맛집 (식당 이름에 안 걸릴 때만)
  const LM_ALIAS = { 청수사: "기요미즈데라", 키요미즈: "기요미즈데라", 동대사: "도다이지", 대불: "도다이지", 춘일대사: "가스가", 이나리: "후시미 이나리", 복견도하: "후시미 이나리", 천본도리이: "후시미 이나리",
    "오사카 성": "오사카성", 천수각: "오사카성", 글리코: "도톤보리", 통천각: "신세카이", 츠텐카쿠: "신세카이", 하루카스: "아베노 하루카스", 유니버설: "유니버설", usj: "유니버설", 해유관: "가이유칸",
    대나무숲: "대나무숲", 치쿠린: "대나무숲", 도월교: "도게츠교", 금각: "금각사", 은각: "은각사", 니조: "니조성", 이진칸: "기타노 이진칸", 차이나타운: "난킨마치", 사슴: "나라공원", 고쇼: "교토 고쇼", 평등원: "뵤도인", 하나미코지: "하나미코지" };
  function landmarkSearch(q) {
    const LMs = window.MATZIP_LANDMARKS || [];
    const nq = norm(q).replace(/\s+/g, "");
    if (nq.length < 2) return false;
    const textHits = R.filter((r) => TEXT.get(r.id).includes(norm(q))).length;
    if (textHits >= 3) return false;
    const key = Object.keys(LM_ALIAS).find((k) => nq.includes(norm(k).replace(/\s+/g, "")));
    const want = key ? norm(LM_ALIAS[key]).replace(/\s+/g, "") : nq;
    const lm = LMs.find((x) => norm(x.n).replace(/\s+/g, "").includes(want) || x.ja === q.trim() || (nq.length >= 3 && want.includes(norm(x.n).replace(/[\s()·]+/g, "").slice(0, 4))));
    if (!lm) return false;
    state.q = ""; $("q").value = "";
    setRefPoint(L.latLng(lm.lat, lm.lng), lm.n);
    return true;
  }
  // ------------------------------------------------------------------ init
  $("sub").textContent = Object.entries(D.regions).map(([k, v]) => `${v.ko} ${R.filter((r) => r.region === k).length}`).join(" · ") + ` · 총 ${R.length}곳`;
  $("gen").textContent = `데이터 기준일 ${D.generated}`;
  PIN_STATUS = true;
  refreshPins();
  update(true, false);
  // 마지막으로 보던 지도 위치 기억 (앱을 다시 열면 그 자리에서 시작)
  const VIEW_LS = "matzip:view";
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_LS) || "null");
    if (!NOMAP && v && Date.now() - v.t < 3 * 864e5 && !location.hash.slice(1)) map.setView([v.lat, v.lng], v.z, { animate: false });
  } catch (e) { /* */ }
  let vT;
  map.on("moveend", () => { clearTimeout(vT); vT = setTimeout(() => { try { const c = map.getCenter(); localStorage.setItem(VIEW_LS, JSON.stringify({ lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5), z: map.getZoom(), t: Date.now() })); } catch (e) { /* */ } }, 500); });
  importTripFromHash();
  (() => { // 일행이 보낸 찜 목록(#fav=id,id…) 불러오기
    const m = location.hash.match(/^#fav=([\w,-]+)/);
    if (!m) return;
    const ids = m[1].split(",").filter((id) => R.some((r) => r.id === id));
    history.replaceState(null, "", location.pathname + location.search);
    if (!ids.length) return;
    const before = fav.size;
    ids.forEach((id) => fav.add(id)); store.set(LS.fav, fav);
    state.favOnly = true;
    setTimeout(() => toast(`일행이 보낸 찜 ${ids.length}곳을 내 찜에 넣었어요 (새로 ${fav.size - before}곳)`), 600);
  })();
  // 숙소 고르기 페이지의 '근처 맛집'(#near=위도,경도,이름) → 그 숙소 기준 가까운 좋은 곳 먼저
  const nearM = location.hash.match(/^#near=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+),?(.*)$/);
  if (nearM) {
    history.replaceState(null, "", location.pathname + location.search);
    let nm = "고른 곳"; try { nm = decodeURIComponent(nearM[3] || "") || nm; } catch (e) { /* */ }
    // 예전에 걸어 둔 필터(지금 영업 등)가 남아 있으면 숙소 근처가 덜 보이므로 풀고 시작
    setTimeout(() => { if (activeFilters().length) clearFilters(); setRefPoint(L.latLng(+nearM[1], +nearM[2]), nm.slice(0, 30)); }, 350);
  }
  // 필터 기억 (12시간): 폰이 백그라운드 탭을 새로 고쳐도 그대로. 없으면 오늘 날짜의 동선 일차를 자동 선택
  if (!loadFilters()) {
    const today = trip.days.find((d) => d.date === jstNow().date && d.stops.length);
    if (today) { state.tripDay = today.id; setTimeout(() => toast(`오늘(${dayLabel(today)}) 동선 근처로 보여 드려요 — 끄려면 ✕ 해제`), 800); }
  }
  update(); if (state.tripDay) fitTrip();
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash && markers.has(hash)) setTimeout(() => openPlace(hash, true), 100);
  window.addEventListener("hashchange", () => {
    const h = decodeURIComponent(location.hash.slice(1));
    if (markers.has(h) && !markers.get(h).isPopupOpen()) openPlace(h, true);
  });
})();
