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
  const CAT = Object.fromEntries(D.categories.map((c) => [c.name, c]));
  const YEN = { 1: "¥", 2: "¥¥", 3: "¥¥¥", 4: "¥¥¥¥" };
  const LS = { fav: "matzip:fav", vis: "matzip:visited" };

  const store = {
    get(k) { try { return new Set(JSON.parse(localStorage.getItem(k) || "[]")); } catch (e) { return new Set(); } },
    set(k, s) { try { localStorage.setItem(k, JSON.stringify([...s])); } catch (e) { /* private mode */ } },
  };
  const fav = store.get(LS.fav);
  const vis = store.get(LS.vis);

  const state = { q: "", region: "all", cats: new Set(), level: 0, prices: new Set(), books: new Set(), areas: new Set(), favOnly: false, hideVisited: false, me: null, sort: "level" };
  const BOOK = Object.fromEntries((D.bookingTypes || []).map((b) => [b.name, b]));
  const BOOK_SHORT = { "앱예약": "온라인예약 가능", "전화예약만": "전화예약만", "원격줄서기": "원격줄서기", "현장방문": "현장방문" };
  const REASON = Object.fromEntries((D.reasonTypes || []).map((t) => [t.name, t]));
  const fmtN = (n) => Number(n).toLocaleString("ko-KR");

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------ map
  const map = L.map("map", { zoomControl: true, preferCanvas: false }).setView([34.75, 135.6], 9);
  const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const gsi = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>',
  });
  L.control.layers({ "OpenStreetMap": osm, "지리원 지도(연한색)": gsi }, null, { position: "topright" }).addTo(map);

  const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 42, disableClusteringAtZoom: 16, spiderfyOnMaxZoom: true });
  map.addLayer(cluster);

  function pinIcon(r) {
    const c = CAT[r.category] || CAT["기타"];
    const cls = "pin lv" + r.legend_level + (fav.has(r.id) ? " fav" : "");
    return L.divIcon({
      className: "pin-wrap",
      html: `<div class="${cls}" style="background:${c.color}">${c.emoji}</div>`,
      iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -16],
    });
  }

  const markers = new Map();
  R.forEach((r) => {
    const m = L.marker([r.lat, r.lng], { icon: pinIcon(r), title: r.name_ko, riseOnHover: true, zIndexOffset: r.legend_level * 100 });
    m.bindPopup(() => popupHtml(r), { maxWidth: 300, minWidth: 260, maxHeight: Math.max(280, Math.round(map.getSize().y * 0.85)), autoPanPadding: [20, 20] });
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
    if (r.booking_type && BOOK[r.booking_type]) {
      b.push(`<span class="badge bk bk-${esc(r.booking_type)}">${BOOK[r.booking_type].emoji} ${esc(BOOK_SHORT[r.booking_type] || r.booking_type)}</span>`);
    }
    if (r.google_rating) b.push(`<span class="badge gg">⭐ 구글 ${esc(r.google_rating)}${r.google_reviews ? ` (${fmtN(r.google_reviews)})` : ""}</span>`);
    (r.awards || []).forEach((a) => {
      const cls = /미쉐린|Michelin/i.test(a) ? "mich" : /백명점|Tabelog|타베로그/i.test(a) ? "tb" : "";
      b.push(`<span class="badge ${cls}">${esc(a)}</span>`);
    });
    if ((r.youtube || []).length || (r.reasons || []).some((x) => x.type === "유튜브")) b.splice(1, 0, `<span class="badge yt">▶ 유튜브 추천</span>`);
    if (limit && b.length > limit) return b.slice(0, limit).join("") + `<span class="badge more">+${b.length - limit}</span>`;
    return b.join("");
  }

  function bookBtns(r) {
    const apps = (r.booking_apps || []).filter((b) => b.url);
    if (!apps.length) return "";
    return `<div class="btns book">${apps.map((b) =>
      `<a class="bk" href="${esc(b.url)}" target="_blank" rel="noopener">📱 ${esc(b.app)}${/EPARK|Air|LINE/.test(b.app) ? " 번호표" : " 예약"}</a>`).join("")}</div>`;
  }

  function tbScore(r) {
    if (!r.tabelog_score) return `<span class="tbs none" title="타베로그 점수 미확인">타베로그<b>-</b></span>`;
    const lvl = r.tabelog_score >= 4 ? "s4" : r.tabelog_score >= 3.7 ? "s3" : r.tabelog_score >= 3.5 ? "s2" : "s1";
    return `<span class="tbs ${lvl}" title="타베로그 점수">타베로그<b>${Number(r.tabelog_score).toFixed(2)}</b></span>`;
  }

  function onlineHtml(r) {
    const apps = (r.booking_apps || []).map((x) => x.app).join(", ");
    if (r.booking_type === "앱예약") return `<div class="ob yes">📱 온라인 예약 가능${apps ? " · " + esc(apps) : ""}</div>`;
    if (r.booking_type) return `<div class="ob no">🚫 온라인 예약 불가 · ${BOOK[r.booking_type] ? BOOK[r.booking_type].emoji : ""} ${esc(r.booking_type)}</div>`;
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
    return `${bookBtns(r)}
      <div class="btns">
        <a class="g" href="${esc(lk.google_maps)}" target="_blank" rel="noopener">구글 지도</a>
        <a href="${esc(lk.directions)}" target="_blank" rel="noopener">🚃 길찾기</a>
        <a class="tb" href="${esc(lk.tabelog)}" target="_blank" rel="noopener">타베로그${lk.tabelog_is_search ? " 검색" : " (한국어)"}</a>
        <a class="yt" href="${esc(lk.youtube)}" target="_blank" rel="noopener">▶ 유튜브</a>
        <button class="favbtn ${isFav ? "on" : ""}" data-id="${r.id}" data-act="fav">${isFav ? "♥ 찜 해제" : "♡ 찜하기"}</button>
        <button class="vis ${isVis ? "on" : ""}" data-id="${r.id}" data-act="vis">${isVis ? "✓ 방문함" : "방문 체크"}</button>
      </div>`;
  }

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
    if (r.booking_type) rows.push(["예약", `${BOOK[r.booking_type] ? BOOK[r.booking_type].emoji + " " : ""}${r.booking_type}${r.reservation ? " · 예약 " + r.reservation : ""}`]);
    else if (r.reservation) rows.push(["예약", r.reservation]);
    if (r.booking_note) rows.push(["예약팁", r.booking_note]);
    if (r.station) rows.push(["역", r.station]);
    if ((r.youtube || []).length) rows.push(["유튜브", r.youtube.join(", ")]);
    return `${onlineHtml(r)}
      <div class="badges">${badgesHtml(r)}</div>
      <div class="why">${esc(r.why)}</div>
      ${reasonsHtml(r)}
      ${r.tips ? `<div class="tips">💡 ${esc(r.tips)}</div>` : ""}
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      ${nearHtml(r)}
      ${linkBtns(r)}
      <div class="addr">${esc(r.address_ja)} ${esc(r.address_building || "")}</div>`;
  }

  function popupHtml(r) {
    const c = CAT[r.category] || CAT["기타"];
    const head = `<div class="pphead"><h3>${c.emoji} ${esc(r.name_ko)}</h3>${tbScore(r)}</div>
      <div class="ja">${esc(r.name_ja)}${r.name_en ? " · " + esc(r.name_en) : ""}</div>
      <div class="lvl">${"★".repeat(r.legend_level)} ${esc(D.levelLabel[r.legend_level])} · ${esc(r.category)} · ${esc(r.area)}</div>`;
    if (isMobile()) {
      // 모바일: 지도 위 팝업은 짧게, 자세한 내용은 아래 목록에서 펼침
      return `<div class="pp">${head}${onlineHtml(r)}<div class="why">${esc(r.why)}</div>${linkBtns(r)}
        <div class="hint">↓ 선정 이유·영업시간·팁은 아래 목록에서</div></div>`;
    }
    return `<div class="pp">${head}${detailHtml(r)}</div>`;
  }

  // ------------------------------------------------------------------ filters
  function textOf(r) {
    return [r.name_ko, r.name_ja, r.name_en, r.area, r.category, r.signature, r.why, r.station, (r.tags || []).join(" "), (r.awards || []).join(" "), r.booking_type, (r.booking_apps || []).map((b) => b.app).join(" "), (r.reasons || []).map((x) => x.type + " " + x.detail).join(" ")]
      .join(" ").toLowerCase();
  }
  const TEXT = new Map(R.map((r) => [r.id, textOf(r)]));

  function filtered() {
    const terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
    let out = R.filter((r) =>
      (state.region === "all" || r.region === state.region) &&
      (!state.areas.size || state.areas.has(r.area)) &&
      (!state.cats.size || state.cats.has(r.category)) &&
      (!state.level || r.legend_level >= state.level) &&
      (!state.prices.size || state.prices.has(r.price_level)) &&
      (!state.books.size || state.books.has(r.booking_type || "미확인")) &&
      (!state.favOnly || fav.has(r.id)) &&
      (!state.hideVisited || !vis.has(r.id)) &&
      terms.every((t) => TEXT.get(r.id).includes(t))
    );
    const sorters = {
      tabelog: (a, b) => (b.tabelog_score || 0) - (a.tabelog_score || 0),
      google: (a, b) => (b.google_reviews || 0) - (a.google_reviews || 0),
      grating: (a, b) => (b.google_rating || 0) - (a.google_rating || 0) || (b.google_reviews || 0) - (a.google_reviews || 0),
    };
    if (state.me) out.forEach((r) => { r._d = map.distance(state.me, [r.lat, r.lng]); });
    if (sorters[state.sort]) {
      out.sort(sorters[state.sort]);
    } else if (state.me) {
      out.forEach((r) => { r._d = map.distance(state.me, [r.lat, r.lng]); });
      out.sort((a, b) => a._d - b._d);
    } else {
      const order = Object.keys(D.regions);
      out.sort((a, b) => order.indexOf(a.region) - order.indexOf(b.region) || b.legend_level - a.legend_level || a.area.localeCompare(b.area, "ko") || a.name_ko.localeCompare(b.name_ko, "ko"));
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

  function renderChips() {
    const rc = $("regionChips"); rc.innerHTML = "";
    rc.append(chip("전체", state.region === "all", () => { state.region = "all"; state.areas.clear(); update(true); }, R.length));
    Object.entries(D.regions).forEach(([k, v]) => {
      const n = R.filter((r) => r.region === k).length;
      if (n) rc.append(chip(v.ko, state.region === k, () => { state.region = k; state.areas.clear(); update(true); }, n));
    });

    const ac = $("areaChips"); ac.innerHTML = "";
    ac.hidden = state.region === "all";
    if (state.region !== "all") {
      const areaCount = {};
      R.filter((r) => r.region === state.region).forEach((r) => { areaCount[r.area] = (areaCount[r.area] || 0) + 1; });
      ac.append(chip("📍 전체 지역", !state.areas.size, () => { state.areas.clear(); update(true); }));
      Object.entries(areaCount).sort((a, b) => b[1] - a[1]).forEach(([a, n]) =>
        ac.append(chip(a, state.areas.has(a), () => {
          state.areas.has(a) ? state.areas.delete(a) : state.areas.add(a);
          update(true);
        }, n)));
    }

    const cc = $("catChips"); cc.innerHTML = "";
    const base = R.filter((r) => (state.region === "all" || r.region === state.region) && (!state.areas.size || state.areas.has(r.area)));
    cc.append(chip("전체 종류", !state.cats.size, () => { state.cats.clear(); update(); }));
    D.categories.forEach((c) => {
      const n = base.filter((r) => r.category === c.name).length;
      if (!n) return;
      cc.append(chip(`${c.emoji} ${c.name}`, state.cats.has(c.name), () => {
        state.cats.has(c.name) ? state.cats.delete(c.name) : state.cats.add(c.name);
        update();
      }, n));
    });

    const bc = $("bookChips"); bc.innerHTML = "";
    bc.append(chip("예약 전체", !state.books.size, () => { state.books.clear(); update(); }));
    [...(D.bookingTypes || []), { name: "미확인", emoji: "❔" }].forEach((b) => {
      const n = base.filter((r) => (r.booking_type || "미확인") === b.name).length;
      if (!n) return;
      bc.append(chip(`${b.emoji} ${BOOK_SHORT[b.name] || b.name}`, state.books.has(b.name), () => {
        state.books.has(b.name) ? state.books.delete(b.name) : state.books.add(b.name);
        update();
      }, n));
    });

    const lc = $("levelChips"); lc.innerHTML = "";
    [[0, "모든 등급"], [3, "★★★ 필수"], [2, "★★ 이상"]].forEach(([v, label]) =>
      lc.append(chip(label, state.level === v, () => { state.level = v; update(); })));

    const pc = $("priceChips"); pc.innerHTML = "";
    [1, 2, 3, 4].forEach((p) => pc.append(chip(YEN[p], state.prices.has(p), () => {
      state.prices.has(p) ? state.prices.delete(p) : state.prices.add(p);
      update();
    })));

    $("favOnly").setAttribute("aria-pressed", String(state.favOnly));
    $("hideVisited").setAttribute("aria-pressed", String(state.hideVisited));
    $("locate").setAttribute("aria-pressed", String(!!state.me));
  }

  function fmtDist(m) { return m < 1000 ? Math.round(m) + "m" : (m / 1000).toFixed(m < 10000 ? 1 : 0) + "km"; }

  function renderList(rs) {
    const ol = $("list");
    $("count").textContent = `${rs.length}곳 표시 중` + (fav.size ? ` · 찜 ${fav.size}` : "") + (vis.size ? ` · 방문 ${vis.size}` : "");
    if (!rs.length) { ol.innerHTML = '<li class="empty">조건에 맞는 곳이 없어요.</li>'; return; }
    ol.innerHTML = rs.map((r) => {
      const c = CAT[r.category] || CAT["기타"];
      return `<li class="item${vis.has(r.id) ? " visited" : ""}${state.open === r.id ? " open" : ""}" data-id="${r.id}">
        <div class="em" style="background:${c.color}22">${c.emoji}</div>
        <div>
          <div class="t">${esc(r.name_ko)}<span class="lv">${"★".repeat(r.legend_level)}</span></div>
          <div class="ja">${esc(r.name_ja)}</div>
          <div class="meta">${esc(D.regions[r.region].ko)} ${esc(r.area)} · ${esc(r.category)} · ${YEN[r.price_level] || ""}</div>
          ${r.signature ? `<div class="sig">${esc(r.signature)}</div>` : ""}
          <div class="badges">${badgesHtml(r, 3)}</div>
        </div>
        <div class="side">
          ${tbScore(r)}
          <button class="iconbtn ${fav.has(r.id) ? "on" : ""}" data-act="fav" data-id="${r.id}" aria-label="찜">${fav.has(r.id) ? "♥" : "♡"}</button>
          <button class="iconbtn vis ${vis.has(r.id) ? "on" : ""}" data-act="vis" data-id="${r.id}" aria-label="방문">✓</button>
          ${state.me && r._d != null ? `<span class="dist">${fmtDist(r._d)}</span>` : ""}
        </div>
        ${state.open === r.id ? `<div class="more pp">${detailHtml(r)}</div>` : ""}
      </li>`;
    }).join("");
  }

  let current = [];
  function update(fit, animate) {
    current = filtered();
    renderChips();
    renderList(current);
    cluster.clearLayers();
    cluster.addLayers(current.map((r) => markers.get(r.id)));
    if (fit && current.length) map.fitBounds(L.latLngBounds(current.map((r) => [r.lat, r.lng])).pad(0.08), { maxZoom: 15, animate: animate !== false });
  }

  function highlight(id) {
    document.querySelectorAll(".item.active").forEach((e) => e.classList.remove("active"));
    const el = document.querySelector(`.item[data-id="${id}"]`);
    if (el) { el.classList.add("active"); }
  }

  function openPlace(id, scrollList) {
    const m = markers.get(id);
    if (!m) return;
    if (!cluster.hasLayer(m)) { // 필터에 걸려 숨겨진 경우 필터 해제
      Object.assign(state, { q: "", region: "all", level: 0, favOnly: false, hideVisited: false });
      state.cats.clear(); state.prices.clear(); state.books.clear(); state.areas.clear(); $("q").value = "";
      update();
    }
    const r = R.find((x) => x.id === id);
    map.setView([r.lat, r.lng], Math.max(map.getZoom(), 16), { animate: false });
    cluster.zoomToShowLayer(m, () => m.openPopup());
    if (scrollList) {
      const el = document.querySelector(`.item[data-id="${id}"]`);
      if (el) el.scrollIntoView({ block: "nearest" });
    }
    if (window.matchMedia("(max-width: 860px)").matches) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggle(set, key, id) {
    set.has(id) ? set.delete(id) : set.add(id);
    store.set(key, set);
    const r = R.find((x) => x.id === id);
    const m = markers.get(id);
    m.setIcon(pinIcon(r));
    if (m.isPopupOpen()) m.getPopup().update(); // bindPopup(fn) 이라 내용이 다시 계산됨
    if (state.favOnly || state.hideVisited) update(); // 목록 구성이 바뀌는 경우만 재필터
    else renderList(current);
    highlight(id);
  }

  // ------------------------------------------------------------------ events
  $("list").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (btn) { e.stopPropagation(); toggle(btn.dataset.act === "fav" ? fav : vis, btn.dataset.act === "fav" ? LS.fav : LS.vis, btn.dataset.id); return; }
    const go = e.target.closest("[data-goto]");
    if (go) { state.open = go.dataset.goto; openPlace(go.dataset.goto, true); renderList(current); return; }
    if (e.target.closest("a, .more")) return; // 펼친 상세 안의 링크/내용 클릭은 그대로
    const li = e.target.closest(".item");
    if (!li) return;
    const id = li.dataset.id;
    state.open = state.open === id ? null : id;
    renderList(current);
    openPlace(id, true);
  });
  map.getContainer().addEventListener("click", (e) => {
    const go = e.target.closest(".pp [data-goto]");
    if (go) { openPlace(go.dataset.goto, true); return; }
    const btn = e.target.closest(".pp button[data-act]");
    if (btn) toggle(btn.dataset.act === "fav" ? fav : vis, btn.dataset.act === "fav" ? LS.fav : LS.vis, btn.dataset.id);
  });

  let qTimer;
  $("q").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value.trim(); update(); }, 150); });
  $("sort").addEventListener("change", (e) => { state.sort = e.target.value; update(); $("list").scrollTop = 0; });
  $("favOnly").addEventListener("click", () => { state.favOnly = !state.favOnly; update(); });
  $("hideVisited").addEventListener("click", () => { state.hideVisited = !state.hideVisited; update(); });
  $("reset").addEventListener("click", () => {
    Object.assign(state, { q: "", region: "all", level: 0, favOnly: false, hideVisited: false, me: null, sort: "level" });
    $("sort").value = "level";
    state.cats.clear(); state.prices.clear(); state.books.clear(); state.areas.clear(); $("q").value = "";
    if (meMarker) { map.removeLayer(meMarker); meMarker = null; }
    update(true);
  });

  let meMarker = null;
  $("locate").addEventListener("click", () => {
    if (state.me) { state.me = null; if (meMarker) { map.removeLayer(meMarker); meMarker = null; } update(); return; }
    if (!navigator.geolocation) { alert("이 브라우저는 위치 정보를 지원하지 않아요."); return; }
    $("locate").textContent = "📍 찾는 중…";
    navigator.geolocation.getCurrentPosition((pos) => {
      $("locate").textContent = "📍 내 위치순";
      state.me = L.latLng(pos.coords.latitude, pos.coords.longitude);
      state.sort = "level"; $("sort").value = "level";
      if (meMarker) map.removeLayer(meMarker);
      meMarker = L.marker(state.me, { icon: L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), zIndexOffset: 1000 }).addTo(map);
      map.setView(state.me, 15);
      update();
      $("list").scrollTop = 0;
    }, (err) => {
      $("locate").textContent = "📍 내 위치순";
      alert("위치를 가져오지 못했어요: " + err.message);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });

  // ------------------------------------------------------------------ init
  $("sub").textContent = Object.entries(D.regions).map(([k, v]) => `${v.ko} ${R.filter((r) => r.region === k).length}`).join(" · ") + ` · 총 ${R.length}곳`;
  $("gen").textContent = `데이터 기준일 ${D.generated}`;
  update(true, false);
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash && markers.has(hash)) setTimeout(() => openPlace(hash, true), 100);
  window.addEventListener("hashchange", () => {
    const h = decodeURIComponent(location.hash.slice(1));
    if (markers.has(h) && !markers.get(h).isPopupOpen()) openPlace(h, true);
  });
})();
