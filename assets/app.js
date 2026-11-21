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
  const CAT = Object.fromEntries(D.categories.map((c) => [c.name, c]));
  const YEN = { 1: "¥", 2: "¥¥", 3: "¥¥¥", 4: "¥¥¥¥" };
  const LS = { fav: "matzip:fav", vis: "matzip:visited" };

  const store = {
    get(k) { try { return new Set(JSON.parse(localStorage.getItem(k) || "[]")); } catch (e) { return new Set(); } },
    set(k, s) { try { localStorage.setItem(k, JSON.stringify([...s])); } catch (e) { /* private mode */ } },
  };
  const fav = store.get(LS.fav);
  const vis = store.get(LS.vis);

  const state = { q: "", region: "all", cats: new Set(), level: 0, prices: new Set(), books: new Set(), areas: new Set(), favOnly: false, hideVisited: false, openNow: false, easyWait: false, me: null, sort: "level" };
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
    const st = statusBadge(r);
    if (st) b.push(st);
    const wb = waitBadge(r);
    if (wb) b.push(wb);
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

  const telHref = (p) => "tel:" + String(p).replace(/[^+\d]/g, "");

  // 예약 행동 버튼: 온라인 예약 → 전화 → 줄서기 순으로 "다음에 할 일"을 크게
  function bookBtns(r) {
    const bk = (r.links && r.links.booking) || [];
    const out = [];
    const canBook = r.booking_type === "앱예약" || r.booking_type === "원격줄서기";
    if (bk.length && canBook) {
      const [first, ...rest] = bk;
      const queue = r.booking_type === "원격줄서기" || /EPARK|Air|LINE/.test(first.app);
      const jp = (a) => (a === "핫페퍼" || a === "잇큐" || a === "구루나비" ? `${a}(일본어)` : appLabel(a));
      out.push(`<a class="cta book" href="${esc(first.url)}" target="_blank" rel="noopener">${queue ? "🎫 번호표 받기" : "📱 지금 예약하기"} · ${esc(jp(first.app))}</a>`);
      if (rest.length) out.push(`<div class="alt">다른 예약 경로: ${rest.map((b) => `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(jp(b.app))}</a>`).join(" · ")}</div>`);
    } else if (bk.length) {
      // 매장 자체는 예약 불가지만 일부(카페 층·코스 등)만 예약 링크가 있는 경우
      out.push(`<div class="alt">일부만 예약 가능 (예약 팁 참고): ${bk.map((b) => `<a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.app)}</a>`).join(" · ")}</div>`);
    }
    if (r.booking_type === "앱예약" && !bk.length) {
      out.push(`<div class="alt">예약 방법은 아래 '예약팁' 참고 (링크 미확인)</div>`);
    }
    const phoneOk = r.phone && r.phone_booking !== false && (r.booking_type === "전화예약만" || r.booking_type === "앱예약");
    if (phoneOk) {
      out.push(`<div class="btns two">
        <a class="cta tel" href="${telHref(r.phone)}">📞 전화 ${esc(r.phone)}</a>
        <button class="cta conc" data-act="concierge" data-id="${r.id}">🏨 예약 부탁 문구</button>
      </div>`);
      if (r.booking_type === "전화예약만") out.push(`<div class="alt">전화가 어렵다면: 호텔 프런트에 문구를 보여주거나 <a href="https://autoreserve.com/" target="_blank" rel="noopener">AutoReserve</a>(AI 전화 대행 앱)</div>`);
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
    const v = { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday")), min: Number(g("hour")) * 60 + Number(g("minute")),
      holiday: JP_HOLIDAYS.has(date), yearEnd: /-(12-(29|30|31)|01-0[1-3])$/.test(date) };
    nowCache = { at: Date.now(), v };
    return v;
  }
  // 영업일이 들쭉날쭉한 가게 (n째 주 휴무·부정기·계절·재료 소진) → '확인 필요' 표시
  const IRREG = /째|부정기|불규칙|계절|겨울|여름|시즌|소진|품절|매진|임시/;
  const irregular = (r) => IRREG.test([r.closed, r.hours_note, r.wait && r.wait.sellout].filter(Boolean).join(" "));
  function openStatus(r) {
    const st = openStatusRaw(r);
    if (!st) return st;
    const now = jstNow();
    // 휴무일 칸에서 괄호 속 예외(「공휴일이면 영업」 등)를 뺀 뒤에도 '공휴일'이 남으면 공휴일 휴무
    const holClosed = /공휴일|祝/.test(String(r.closed || "").replace(/[(（][^)）]*[)）]/g, ""));
    if ((st.s === "open" || st.s === "soon" || st.s === "later") && now.holiday && holClosed) return { s: "warn", t: "오늘 공휴일 — 휴무일 가능성" };
    if ((st.s === "open" || st.s === "soon" || st.s === "later") && now.yearEnd) return { ...st, t: st.t + " · 연말연시 확인", warn: true };
    if ((st.s === "open" || st.s === "soon") && irregular(r)) return { ...st, t: st.t + " · 변동 가능", warn: true };
    return st;
  }
  function openStatusRaw(r) {
    const w = r.hours_week;
    if (!w) return null;
    const { day, min } = jstNow();
    const today = w[DAYS[day]], yest = w[DAYS[(day + 6) % 7]];
    if (Array.isArray(yest)) for (const [o, c] of yest) if (toMin(c) > 1440 && min < toMin(c) - 1440) return { s: "open", t: `영업 중 · ${fmtT(toMin(c))} 마감` };
    if (today === null || today === undefined) return null;
    if (!today.length) return { s: "off", t: "오늘 휴무" };
    for (const [o, c] of today) {
      const om = toMin(o), cm = toMin(c);
      if (min >= om && min < cm) return cm - min <= 45 ? { s: "soon", t: `곧 마감 · ${fmtT(cm)}` } : { s: "open", t: `영업 중 · ${fmtT(cm)} 마감` };
    }
    const next = today.map(([o]) => toMin(o)).filter((om) => om > min).sort((a, b) => a - b)[0];
    return next != null ? { s: "later", t: `${fmtT(next)} 오픈` } : { s: "closed", t: "오늘 영업 종료" };
  }
  const WAIT_SHORT = { 0: "웨이팅 거의 없음", 1: "웨이팅 ~15분", 2: "웨이팅 15~45분", 3: "웨이팅 45분+" };
  const waitLv = (r) => (r.wait && [0, 1, 2, 3].includes(r.wait.level) ? r.wait.level : null);
  const waitBadge = (r) => {
    const lv = waitLv(r);
    if (lv === null) return "";
    return `<span class="badge wt wt${lv}" title="최근 후기 기반 예상(피크 시간)">⏳ ${WAIT_SHORT[lv]}</span>`;
  };
  // 웨이팅 짧은 곳: 예상 15분 이하이거나 온라인 예약 가능
  const easyWait = (r) => { const lv = waitLv(r); return lv !== null && lv <= 1; };
  const statusBadge = (r) => {
    const st = openStatus(r);
    if (!st) return "";
    const icon = st.s === "warn" ? "⚠️" : st.s === "open" ? "🟢" : st.s === "soon" ? "🟠" : "⚪";
    return `<span class="badge st-${st.s}" title="요일별 영업시간 기준(L.O.는 보통 30분~1시간 전). 방문 전 확인">${icon} ${esc(st.t)}</span>`;
  };

  function tbScore(r) {
    if (!r.tabelog_score) return `<span class="tbs none" title="타베로그 점수 미확인">타베로그<b>-</b></span>`;
    const lvl = r.tabelog_score >= 4 ? "s4" : r.tabelog_score >= 3.7 ? "s3" : r.tabelog_score >= 3.5 ? "s2" : "s1";
    return `<span class="tbs ${lvl}" title="타베로그 점수">타베로그<b>${Number(r.tabelog_score).toFixed(2)}</b></span>`;
  }

  const PAID = /TABLE ?ALL|MY CONCIERGE/i;
  const appLabel = (a) => { const n = String(a).replace(/^기타:/, ""); return PAID.test(n) ? `${n}(유료 대행)` : n; };
  function onlineHtml(r) {
    const apps = (r.booking_apps || []).map((x) => appLabel(x.app)).join(", ");
    const chk = (r.booking_checked || ["타베로그"]).join("·");
    if (r.booking_type === "앱예약") return `<div class="ob yes">📱 온라인 예약 가능${apps ? " · " + esc(apps) : ""}</div>`;
    const gnote = r.google_reservable === true ? "구글맵에 「예약」 표시 있음 → 구글맵에서 확인" : r.google_reservable === false ? "구글맵 예약 없음" : "구글맵 예약은 미확인";
    if (r.booking_type === "현장방문") return `<div class="ob no">🚶 예약 없이 방문 (줄 서기)<small>${esc(chk)}에 온라인 예약 없음 · ${gnote}</small></div>`;
    if (r.booking_type) return `<div class="ob no">${BOOK[r.booking_type] ? BOOK[r.booking_type].emoji : ""} ${esc(r.booking_type)} — 온라인 예약 없음<small>확인: ${esc(chk)} · ${gnote}</small></div>`;
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
        <a class="g" href="${esc(lk.directions)}" target="_blank" rel="noopener">🧭 구글맵 길찾기</a>
        <a href="${esc(lk.google_maps)}" target="_blank" rel="noopener">📍 구글맵에서 보기</a>
        <a class="tb" href="${esc(lk.tabelog)}" target="_blank" rel="noopener">타베로그${lk.tabelog_is_search ? " 검색" : " (한국어)"}</a>
        <a class="yt" href="${esc(lk.youtube)}" target="_blank" rel="noopener">▶ 유튜브 검색</a>
        <button class="favbtn ${isFav ? "on" : ""}" data-id="${r.id}" data-act="fav">${isFav ? "♥ 찜 해제" : "♡ 찜하기"}</button>
        <button class="vis ${isVis ? "on" : ""}" data-id="${r.id}" data-act="vis">${isVis ? "✓ 방문함" : "방문 체크"}</button>
        <button class="share" data-id="${r.id}" data-act="share">🔗 일행에게 공유</button>
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
    if (r.wait) {
      const w = r.wait;
      if (w.level !== undefined || w.estimate) rows.push(["웨이팅", [D.waitLabel[w.level], w.estimate].filter(Boolean).join(" — ") + " (후기 기반 예상)"]);
      if (w.best_time) rows.push(["추천시간", w.best_time]);
      if (w.queue_system) rows.push(["번호표", w.queue_system]);
      if (w.sellout) rows.push(["품절", w.sellout]);
    } else if (r.booking_type === "앱예약") {
      rows.push(["웨이팅", "예약하면 대기 없음 (인기점은 예약 자체가 빨리 마감)"]);
    }
    if (r.hours_note) rows.push(["영업참고", r.hours_note]);
    if (r.station) rows.push(["역", r.station]);
    if (r.phone) rows.push(["전화", r.phone]);
    if ((r.youtube || []).length) rows.push(["유튜브", r.youtube.join(", ")]);
    // 예약·이동 버튼을 맨 위에: 고르고 바로 행동할 수 있게
    return `${onlineHtml(r)}
      ${r.notice ? `<div class="notice">⚠️ ${esc(r.notice)}</div>` : ""}
      ${linkBtns(r)}
      <div class="badges">${badgesHtml(r)}</div>
      <div class="why">${esc(r.why)}</div>
      ${reasonsHtml(r)}
      ${r.tips ? `<div class="tips">💡 ${esc(r.tips)}</div>` : ""}
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      ${nearHtml(r)}
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
    const nav = `<a class="cta nav" href="${esc(r.links.directions)}" target="_blank" rel="noopener">🧭 길찾기</a>`;
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
  const ALIAS = [[/돈가스|돈까스/g, "돈카츠"], [/라면/g, "라멘"], [/초밥/g, "스시"], [/우나기|장어덮밥/g, "장어"], [/고베규|소고기|쇠고기/g, "와규"]];
  const norm = (x) => {
    let t = String(x || "").toLowerCase();
    ALIAS.forEach(([re, to]) => { t = t.replace(re, to); });
    return t.replace(/끼/g, "키").replace(/꾸/g, "쿠").replace(/까/g, "카").replace(/[쯔쓰]/g, "츠").replace(/찌/g, "치").replace(/따/g, "타").replace(/빠/g, "파").replace(/뽀/g, "포");
  };
  function textOf(r) {
    return [r.name_ko, r.name_ja, r.name_en, r.area, r.category, r.signature, r.why, r.station, (r.tags || []).join(" "), (r.awards || []).join(" "), r.booking_type, (r.booking_apps || []).map((b) => b.app).join(" "), (r.reasons || []).map((x) => x.type + " " + x.detail).join(" ")]
      .join(" ");
  }
  const TEXT = new Map(R.map((r) => [r.id, norm(textOf(r))]));

  function filtered() {
    const terms = norm(state.q).split(/\s+/).filter(Boolean);
    let out = R.filter((r) =>
      (state.region === "all" || r.region === state.region) &&
      (!state.areas.size || state.areas.has(r.area)) &&
      (!state.cats.size || state.cats.has(r.category)) &&
      (!state.level || r.legend_level >= state.level) &&
      (!state.prices.size || state.prices.has(r.price_level)) &&
      (!state.books.size || state.books.has(r.booking_type || "미확인")) &&
      (!state.favOnly || fav.has(r.id)) &&
      (!state.openNow || ["open", "soon"].includes((openStatus(r) || {}).s)) &&
      (!state.easyWait || easyWait(r)) &&
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

  let renderChips = function () {
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
    [[0, "모든 등급"], [3, "★★★ 3.8+·수상"], [2, "★★ 이상"]].forEach(([v, label]) =>
      lc.append(chip(label, state.level === v, () => { state.level = v; update(); })));

    const pc = $("priceChips"); pc.innerHTML = "";
    [1, 2, 3, 4].forEach((p) => pc.append(chip(YEN[p], state.prices.has(p), () => {
      state.prices.has(p) ? state.prices.delete(p) : state.prices.add(p);
      update();
    })));

    $("favOnly").setAttribute("aria-pressed", String(state.favOnly));
    $("openNow").setAttribute("aria-pressed", String(state.openNow));
    $("easyWait").setAttribute("aria-pressed", String(state.easyWait));
    $("favRoute").hidden = !fav.size;
    $("favShare").hidden = !fav.size;
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
          <div class="t">${esc(r.name_ko)}<span class="lv" title="${esc((D.levelRule || {})[r.legend_level] || "")}">${"★".repeat(r.legend_level)}</span>${r.icon ? `<span class="icn" title="점수 기준 밖이지만 꼭 가볼 만한 원조·명물">🏯</span>` : ""}</div>
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

  function openPlace(id, scrollList) {
    const m = markers.get(id);
    if (!m) return;
    const hidden = NOMAP ? !current.some((x) => x.id === id) : !cluster.hasLayer(m);
    if (hidden) { // 필터에 걸려 숨겨진 경우 필터 해제
      Object.assign(state, { q: "", region: "all", level: 0, favOnly: false, hideVisited: false, openNow: false, easyWait: false });
      state.cats.clear(); state.prices.clear(); state.books.clear(); state.areas.clear(); $("q").value = "";
      update();
      toast("필터에 가려진 가게라 필터를 해제하고 보여드려요");
    }
    const r = R.find((x) => x.id === id);
    if (NOMAP) {
      if (state.open !== id) { state.open = id; renderList(current); }
      history.replaceState(null, "", "#" + id);
      const el = document.querySelector(`.item[data-id="${id}"]`);
      if (el) el.scrollIntoView({ block: "start" });
      return;
    }
    map.setView([r.lat, r.lng], Math.max(map.getZoom(), 16), { animate: false });
    cluster.zoomToShowLayer(m, () => m.openPopup());
    if (scrollList) {
      const el = document.querySelector(`.item[data-id="${id}"]`);
      if (el) el.scrollIntoView({ block: "nearest" });
    }
    if (window.matchMedia("(max-width: 860px)").matches) window.scrollTo({ top: 0, behavior: "smooth" });
  }

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
    showText(`🏨 ${r.name_ko} 예약 부탁 문구`, conciergeText(r), extra);
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

  function handleAct(btn) {
    const id = btn.dataset.id, act = btn.dataset.act, r = R.find((x) => x.id === id);
    if (act === "fav") toggle(fav, LS.fav, id);
    else if (act === "vis") toggle(vis, LS.vis, id);
    else if (act === "share") shareOrCopy(r.name_ko, shareText(r));
    else if (act === "concierge") openConcierge(r);
  }

  // ------------------------------------------------------------------ events
  $("list").addEventListener("click", (e) => {
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
    openPlace(id, true);
  });
  map.getContainer().addEventListener("click", (e) => {
    const go = e.target.closest(".pp [data-goto]");
    if (go) { openPlace(go.dataset.goto, true); return; }
    const btn = e.target.closest(".pp button[data-act]");
    if (btn) handleAct(btn);
  });

  let qTimer;
  $("q").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value.trim(); update(); }, 150); });
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
    shareOrCopy("찜한 맛집", list.map((r, i) => `${i + 1}. ${r.name_ko} (${r.name_ja}) · 타베로그 ${r.tabelog_score || "-"}\n   ${r.links.google_maps}`).join("\n"));
  });
  $("dlgCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("dlgText").value); $("dlgCopy").textContent = "복사됨 ✓"; }
    catch (e) { $("dlgText").select(); document.execCommand && document.execCommand("copy"); $("dlgCopy").textContent = "복사됨 ✓"; }
    setTimeout(() => { $("dlgCopy").textContent = "복사"; }, 1500);
  });
  $("dlgClose").addEventListener("click", () => $("dlg").close());
  $("openNow").addEventListener("click", () => { state.openNow = !state.openNow; update(); });
  $("easyWait").addEventListener("click", () => { state.easyWait = !state.easyWait; update(); });
  setInterval(() => { if (state.openNow) update(); else renderList(current); }, 5 * 60 * 1000); // 영업 상태 5분마다 갱신
  $("hideVisited").addEventListener("click", () => { state.hideVisited = !state.hideVisited; update(); });
  $("reset").addEventListener("click", () => {
    Object.assign(state, { q: "", region: "all", level: 0, favOnly: false, hideVisited: false, openNow: false, easyWait: false, me: null, sort: "level" });
    $("sort").value = "level";
    state.cats.clear(); state.prices.clear(); state.books.clear(); state.areas.clear(); $("q").value = "";
    if (meMarker) { map.removeLayer(meMarker); meMarker = null; }
    update(true);
  });

  let meMarker = null;
  $("locate").addEventListener("click", () => {
    if (state.me) { state.me = null; if (meMarker) { map.removeLayer(meMarker); meMarker = null; } update(); return; }
    if (!navigator.geolocation) { toast("이 브라우저는 위치 정보를 지원하지 않아요."); return; }
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
      toast("위치를 가져오지 못했어요 (위치 권한 확인): " + err.message);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });

  // 구글 평점 데이터가 거의 없으면(20% 미만) 구글 정렬 옵션 숨김 — 의미 없는 정렬 방지
  if (R.filter((r) => r.google_rating).length < R.length * 0.2) {
    ["grating", "google"].forEach((v) => { const o = document.querySelector(`#sort option[value="${v}"]`); if (o) o.remove(); });
  }

  // 모바일: 상세 필터 접기/펼치기
  const moreBtn = $("moreFilters");
  function syncMore() {
    const n = state.cats.size + state.books.size + state.prices.size + (state.level ? 1 : 0) + (state.openNow ? 1 : 0) + (state.easyWait ? 1 : 0) + (state.favOnly ? 1 : 0) + (state.hideVisited ? 1 : 0);
    moreBtn.textContent = (document.body.classList.contains("fopen") ? "필터 접기 ▴" : "필터 더보기 ▾") + (n ? ` (${n})` : "");
  }
  moreBtn.addEventListener("click", () => { document.body.classList.toggle("fopen"); syncMore(); });
  const _renderChips = renderChips;
  renderChips = function () { _renderChips(); syncMore(); };

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
