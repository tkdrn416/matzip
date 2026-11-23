// 숙소 고르기: 간이 지도(SVG, 실제 지도 타일 없음) + 호텔 카드. 데이터: data/hotels.js (scripts/build_hotels.py)
(() => {
  "use strict";
  const D = window.MATZIP_HOTELS;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const man = (p) => (p >= 1e6 ? Math.round(p / 1e4) : (p / 1e4).toFixed(1).replace(/\.0$/, "")) + "만";
  const won = (p) => "₩" + Math.round(p).toLocaleString("ko-KR");
  const LS = "matzip:hcity";
  let cityKey = (() => { try { const h = location.hash.slice(1); if (D.cities[h]) return h; const v = localStorage.getItem(LS); return D.cities[v] ? v : "kyoto"; } catch (e) { return "kyoto"; } })();
  let C = D.cities[cityKey];
  let sel = null, sortBy = "rec", areaF = "", budgetOnly = true, amenF = "";
  const view = { lat: 0, lng: 0, z: 1 };
  let fitZ = 1;
  const box = $("smap");

  // ---------------------------------------------------------------- 상단
  $("sub").textContent = `2인 기준 · 가격은 ${D.updated} 구글 호텔에서 조회한 세금·수수료 포함 요금`;
  function renderTabs() {
    $("ctabs").innerHTML = Object.entries(D.cities).map(([k, c]) => `<button type="button" role="tab" data-city="${k}" aria-selected="${k === cityKey}"><b>${esc(c.ko)}</b> <span>${esc(c.when)}</span></button>`).join("");
  }
  $("ctabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-city]");
    if (!b || b.dataset.city === cityKey) return;
    cityKey = b.dataset.city; C = D.cities[cityKey]; sel = null; areaF = ""; budgetOnly = true; amenF = "";
    try { localStorage.setItem(LS, cityKey); history.replaceState(null, "", "#" + cityKey); } catch (err) { /* */ }
    renderAll(true);
  });

  window.addEventListener("hashchange", () => {
    const h = location.hash.slice(1);
    if (D.cities[h] && h !== cityKey) { cityKey = h; C = D.cities[h]; sel = null; areaF = ""; budgetOnly = true; try { localStorage.setItem(LS, h); } catch (e) { /* */ } renderAll(true); }
  });
  const H = () => C.hotels;
  const byId = (id) => H().find((h) => h.id === id);
  const areaOf = (k) => C.areas.find((a) => a.k === k) || { n: k, c: "#888" };
  const priceTxt = (h) => (h.price ? `${man(h.price)}${C.nights > 1 ? "/박" : ""}` : "가격 없음");
  const inBudget = (h) => !!h.ok;
  const AMEN = { smoke: ["🚭 전관 금연", (m) => m.smokeFree], bath: ["♨️ 대욕장·온천", (m) => !!m.bath], bf: ["🍳 조식 무료", (m) => m.breakfast === "free"], laundry: ["🧺 셀프 세탁", (m) => m.laundry] };
  const amenOk = (h) => !amenF || (h.amen && AMEN[amenF][1](h.amen));
  const vis = (h, ignoreArea) => (ignoreArea || !areaF || h.area === areaF) && (!budgetOnly || inBudget(h)) && amenOk(h);
  const inB = (b, la, ln) => la >= b[0] && la <= b[2] && ln >= b[1] && ln <= b[3];

  const top3 = (k) => H().filter((h) => h.ok && h.area === k).sort((a, b) => a.no - b.no).slice(0, 3);
  function renderPick() {
    const medal = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
    const recs = C.areaRec.map((r, i) => {
      const a = areaOf(r.k);
      const nb = H().filter((h) => h.area === r.k && inBudget(h)).length;
      const food = C.dots.filter(([la, ln]) => inB(a.b, la, ln)).length;
      return `<div class="ar" style="border-left-color:${a.c}">
        <div class="ar-h"><span class="ar-m">${medal[i] || ""}</span><b style="color:${a.c}">${esc(r.title)}</b>${r.tag ? `<span class="ar-tag">${esc(r.tag)}</span>` : ""}</div>
        <p class="ar-v">${r.verdict}</p>
        <div class="ar-n"><span>🏨 추천 숙소 <b>${nb}</b>곳</span><span>🍽 맛집 지도 가게 <b>${food}</b>곳</span>${r.price ? `<span>시세 ${esc(r.price)}</span>` : ""}</div>
        <div class="pk-hs">${top3(r.k).map((h) => `<button type="button" data-sel="${h.id}"><span class="no" style="background:${a.c}">${h.no}</span>${esc(h.short || h.n)} <small>${priceTxt(h)} · ★${h.rating ?? "-"}</small></button>`).join("")}</div>
        <details><summary>왜 여기? (장단점·이동)</summary>
          <ul class="ar-p">${r.pros.map((x) => `<li>${x}</li>`).join("")}</ul>
          <ul class="ar-c">${r.cons.map((x) => `<li>${x}</li>`).join("")}</ul>
          ${r.who ? `<p class="ar-w">👉 ${r.who}</p>` : ""}
        </details>
        <button type="button" class="ar-go" data-area-go="${r.k}">${esc(a.n)} 숙소 ${nb}곳 모두 보기 →</button>
      </div>`;
    }).join("");
    $("pick").innerHTML = `<h2>${esc(C.title)}</h2>
      <p class="budget">💰 고른 기준: 1박 <b>8만~${man(C.budget)} 원</b>(10만 원 안팎이면 💚) · <b>구글 평점 4.3↑</b>(리뷰 300개↑) · ${C.nights > 1 ? `${C.nights}박 평균 1박 요금` : "1박 요금"}, 세금 포함</p>
      <h3 class="sec">📍 어디에 묵을까 <small>추천 순</small></h3>${recs}
      <details class="move"><summary>🚃 이동 메모</summary><ul>${C.moves.map((m) => `<li>${m}</li>`).join("")}</ul></details>${C.warn ? `<p class="warn">${C.warn}</p>` : ""}`;
  }
  $("pick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sel]");
    if (b) { select(b.dataset.sel, true); scrollMapIntoView(); return; }
    const g = e.target.closest("[data-area-go]");
    if (g) { setArea(g.dataset.areaGo); $("presets").scrollIntoView({ behavior: "smooth", block: "start" }); }
  });

  // ---------------------------------------------------------------- 간이 지도
  const cosK = () => Math.cos((view.lat * Math.PI) / 180);
  const W = () => box.clientWidth, Hh = () => box.clientHeight;
  const px = (lat, lng) => [W() / 2 + (lng - view.lng) * view.z * cosK(), Hh() / 2 - (lat - view.lat) * view.z];
  const mpx = (m) => (m / 111320) * view.z;
  function fit(b, pad = 0.92) {
    const [s, w, n, e] = b;
    view.lat = (s + n) / 2; view.lng = (w + e) / 2;
    const k = Math.cos((view.lat * Math.PI) / 180);
    view.z = Math.min(W() / ((e - w) * k), Hh() / (n - s)) * pad;
  }
  function clampView() {
    const [s, w, n, e] = C.bounds;
    view.z = Math.max(fitZ * 0.75, Math.min(fitZ * 9, view.z));
    const mlat = (n - s) * 0.25, mlng = (e - w) * 0.25;
    view.lat = Math.max(s - mlat, Math.min(n + mlat, view.lat));
    view.lng = Math.max(w - mlng, Math.min(e + mlng, view.lng));
  }
  // 글자 크기 재기: 폰 글꼴·글자 크기 설정이 달라도 실제로 그려지는 폭·높이로 겹침을 판단
  const NS = "http://www.w3.org/2000/svg";
  const measBox = document.createElement("div");
  measBox.className = "smap"; measBox.setAttribute("aria-hidden", "true");
  measBox.style.cssText = "position:absolute;left:-9999px;top:0;width:400px;height:40px;min-height:0;border:0;visibility:hidden;pointer-events:none";
  const measSvg = document.createElementNS(NS, "svg"), measG = document.createElementNS(NS, "g"), measT = document.createElementNS(NS, "text");
  measSvg.setAttribute("width", "400"); measSvg.setAttribute("height", "40");
  measG.appendChild(measT); measSvg.appendChild(measG); measBox.appendChild(measSvg); document.body.appendChild(measBox);
  const mcache = new Map();
  function tm(str, gcls, tcls) {
    const k = gcls + "|" + tcls + "|" + str;
    if (mcache.has(k)) return mcache.get(k);
    measG.setAttribute("class", gcls || ""); measT.setAttribute("class", tcls || ""); measT.textContent = str;
    let r = { w: str.length * 11, h: 14 };
    try { const bb = measT.getBBox(); r = { w: Math.ceil(measT.getComputedTextLength() || bb.width), h: Math.ceil(bb.height) || 14 }; } catch (e) { /* */ }
    mcache.set(k, r); return r;
  }
  function render() {
    const w = W(), h = Hh();
    const boxes = [];
    const P = 2; // 글자끼리 붙지 않게 여백
    const free = (b) => b.x >= 2 && b.y >= 2 && b.x + b.w <= w - 2 && b.y + b.h <= h - 2 && !boxes.some((o) => b.x < o.x + o.w + P && b.x + b.w + P > o.x && b.y < o.y + o.h + P && b.y + b.h + P > o.y);
    const take = (b) => { boxes.push(b); return b; };
    const pts = (arr) => arr.map(([la, ln]) => px(la, ln).map((v) => v.toFixed(1)).join(",")).join(" ");
    const zr = view.z / fitZ;
    let s = "";
    // 권역
    C.zones.forEach((zn) => {
      const [x, y] = px(zn.lat, zn.lng), r = mpx(zn.r);
      s += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(r * (zn.sx || 1)).toFixed(1)}" ry="${(r * (zn.sy || 1)).toFixed(1)}" class="zone" style="fill:${areaOf(zn.k).c}"/>`;
    });
    C.streets.forEach((l) => { s += `<polyline points="${pts(l)}" class="street"/>`; });
    C.rivers.forEach((l) => { s += `<polyline points="${pts(l)}" class="river"/>`; });
    C.lines.forEach((l) => { s += `<polyline points="${pts(l.p)}" class="rail" style="stroke:${l.c}"/>`; });
    // 맛집 점
    if (showDots) C.dots.forEach(([la, ln, sc]) => { const [x, y] = px(la, ln); if (x > -5 && y > -5 && x < w + 5 && y < h + 5) s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${zr > 2.5 ? 3 : 2.2}" class="dot${sc >= 3.6 ? " hi" : ""}"/>`; });
    // 역
    let lbl = "";
    const bg = (b) => `<rect class="lbg" x="${(b.x - 2).toFixed(1)}" y="${(b.y - 1).toFixed(1)}" width="${(b.w + 4).toFixed(1)}" height="${(b.h + 2).toFixed(1)}" rx="3"/>`;
    const stationsDrawn = [];
    C.stations.forEach((st) => {
      const [x, y] = px(st.lat, st.lng);
      if (x < -10 || y < -10 || x > w + 10 || y > h + 10) return;
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${st.m ? 5.5 : 4}" class="st${st.m ? " main" : ""}"/>`;
      stationsDrawn.push([st, x, y]);
    });
    // 자리 예약: 확대 버튼(오른쪽 위)·축척(왼쪽 아래)
    take({ x: w - 48, y: 0, w: 48, h: 88 }); take({ x: 0, y: h - 26, w: 150, h: 26 });
    // 호텔 핀 (항상 그림)
    const hs = H().filter((hh) => vis(hh));
    // 겹치는 핀은 묶음(숫자 = 숙소 수)으로. 누르면 그 묶음으로 확대. 고른 숙소는 묶지 않음
    const pos = new Map(hs.map((hh) => [hh.id, px(hh.lat, hh.lng)]));
    const clusters = [], inCl = new Set();
    if (view.z < fitZ * 7) {
      [...hs].sort((a, b) => a.no - b.no).forEach((hh) => {
        if (inCl.has(hh.id) || hh.id === sel) return;
        const [x, y] = pos.get(hh.id);
        const mem = hs.filter((o) => !inCl.has(o.id) && o.id !== sel && Math.hypot(pos.get(o.id)[0] - x, pos.get(o.id)[1] - y) < 30);
        if (mem.length < 2) return;
        mem.forEach((o) => inCl.add(o.id));
        clusters.push({ mem, x: mem.reduce((a, o) => a + pos.get(o.id)[0], 0) / mem.length, y: mem.reduce((a, o) => a + pos.get(o.id)[1], 0) / mem.length });
      });
    }
    const order = hs.filter((hh) => !inCl.has(hh.id)).sort((a, b) => (a.id === sel ? -1 : b.id === sel ? 1 : a.no - b.no));
    let pins = "", chips = "", lm = "", far = "";
    clusters.forEach((cl) => {
      const ps = cl.mem.map((o) => o.price).filter(Boolean), c0 = areaOf(cl.mem[0].area).c;
      pins += `<g class="pin cl" data-cl="${cl.mem.map((o) => o.id).join(",")}" transform="translate(${cl.x.toFixed(1)},${cl.y.toFixed(1)})"><circle r="24" class="hit"/><circle r="15" class="clr" style="stroke:${c0}"/><circle r="12.5" style="fill:${c0}"/><text dy="0.36em">${cl.mem.length}</text></g>`;
      take({ x: cl.x - 15, y: cl.y - 15, w: 30, h: 30 });
      cl.label = `${cl.mem.length}곳 ${ps.length ? man(Math.min(...ps)).replace("만", "") + (ps.length > 1 ? "~" + man(Math.max(...ps)) : "만") : ""}`;
    });
    order.slice().reverse().forEach((hh) => {
      const [x, y] = px(hh.lat, hh.lng), on = hh.id === sel, r = on ? 13 : 10.5;
      pins += `<g class="pin${on ? " on" : ""}" data-id="${hh.id}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><circle r="${r + 8}" class="hit"/>${on ? `<circle r="${r + 4}" class="ring"/>` : ""}<circle r="${r}" style="fill:${areaOf(hh.area).c}"/><text dy="0.36em">${hh.no}</text></g>`;
      take({ x: x - r, y: y - r, w: 2 * r, h: 2 * r });
    });
    const placeChip = (hh) => {
      const [x, y] = px(hh.lat, hh.lng), on = hh.id === sel;
      const t1 = on ? `${hh.short || hh.n}` : "", t2 = `${priceTxt(hh)} ★${hh.rating ?? "-"}`;
      const m2 = tm(t2, "chip", ""), m1 = on ? tm(t1, "chip on", "t1") : { w: 0, h: 0 };
      const bw = Math.max(m2.w, m1.w) + 12, bh = on ? m1.h + m2.h + 8 : Math.max(19, m2.h + 5);
      const cands = [[x + 14, y - bh / 2], [x - 14 - bw, y - bh / 2], [x - bw / 2, y - 16 - bh], [x - bw / 2, y + 16]];
      for (const [bx, by] of cands) {
        const b = { x: bx, y: by, w: bw, h: bh };
        if (!free(b) && !on) continue;
        take(b);
        chips += `<g class="chip${on ? " on" : ""}" data-id="${hh.id}"><rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh}" rx="6"/>${on ? `<text x="${(bx + 6).toFixed(1)}" y="${(by + 3 + m1.h * 0.8).toFixed(1)}" class="t1">${esc(t1)}</text>` : ""}<text x="${(bx + 6).toFixed(1)}" y="${(by + bh - 3 - m2.h * 0.22).toFixed(1)}">${esc(t2)}</text></g>`;
        break;
      }
    };
    if (sel && byId(sel)) placeChip(byId(sel));
    // 화면 밖 목적지: 가장자리에 한 줄 꼬리표(서로 안 겹치게 쌓기)
    C.far.forEach((f) => {
      const [x, y] = px(f.lat, f.lng);
      if (x >= 0 && y >= 0 && x <= w && y <= h) return;
      const cx = w / 2, cy = h / 2, dx = x - cx, dy = y - cy;
      const t = Math.min((w / 2 - 8) / Math.abs(dx || 1e-6), (h / 2 - 8) / Math.abs(dy || 1e-6));
      const ex = cx + dx * t, ey = cy + dy * t, ang = Math.atan2(dy, dx);
      const txt = `${f.n} · ${f.note}`, mf = tm(txt, "far", "f1"), bw = mf.w + 22, bh = Math.max(18, mf.h + 4);
      const side = Math.abs(ex - 8) < 1 ? "L" : Math.abs(ex - (w - 8)) < 1 ? "R" : Math.abs(ey - 8) < 1 ? "T" : "B";
      let bx = side === "L" ? 4 : side === "R" ? w - bw - 4 : ex - bw / 2, by = side === "T" ? 4 : side === "B" ? h - bh - 4 : ey - bh / 2;
      bx = Math.max(4, Math.min(w - bw - 4, bx)); by = Math.max(4, Math.min(h - bh - 4, by));
      let ok = null;
      for (let k = 0; k < 16 && !ok; k++) {
        const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (side === "L" || side === "R" ? bh + 3 : 40);
        const tx = side === "L" || side === "R" ? bx : Math.max(4, Math.min(w - bw - 4, bx + off));
        const ty = side === "L" || side === "R" ? Math.max(4, Math.min(h - bh - 4, by + off)) : by;
        const cand = { x: tx, y: ty, w: bw, h: bh };
        if (free(cand)) ok = cand;
      }
      if (!ok) return;
      take(ok); bx = ok.x; by = ok.y;
      const ax = side === "R" ? bx + bw - 9 : side === "L" ? bx + 9 : bx + 9, ay = by + bh / 2;
      far += `<g class="far"><rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh}" rx="9"/><path d="M-4,-4 L4,0 L-4,4 Z" transform="translate(${ax.toFixed(1)},${ay.toFixed(1)}) rotate(${((ang * 180) / Math.PI).toFixed(0)})"/><text x="${(side === "R" ? bx + 6 : bx + 17).toFixed(1)}" y="${(by + bh / 2 + mf.h * 0.3).toFixed(1)}" class="f1">${esc(txt)}</text></g>`;
    });
    // 주요 역 이름 → 가격 칩 → 명소 → 작은 역 → 권역 이름 순으로 자리 잡기
    const stLabel = (st, x, y) => {
      const ms = tm(st.n, "", "st-t" + (st.m ? " main" : "")), t0 = ms.w, th = ms.h;
      for (const [bx, by] of [[x + 7, y - th / 2], [x - 7 - t0, y - th / 2], [x - t0 / 2, y + 7], [x - t0 / 2, y - 7 - th]]) {
        const b = { x: bx, y: by, w: t0, h: th };
        if (!free(b)) continue;
        take(b); lbl += bg(b) + `<text x="${bx.toFixed(1)}" y="${(by + th * 0.78).toFixed(1)}" class="st-t${st.m ? " main" : ""}">${esc(st.n)}</text>`;
        return;
      }
    };
    stationsDrawn.filter(([st]) => st.m).forEach(([st, x, y]) => stLabel(st, x, y));
    clusters.forEach((cl) => {
      const mc = tm(cl.label, "chip cl", ""), bw = mc.w + 12, bh = Math.max(19, mc.h + 5);
      for (const [bx, by] of [[cl.x + 18, cl.y - bh / 2], [cl.x - 18 - bw, cl.y - bh / 2], [cl.x - bw / 2, cl.y - 20 - bh], [cl.x - bw / 2, cl.y + 20]]) {
        const b = { x: bx, y: by, w: bw, h: bh };
        if (!free(b)) continue;
        take(b); chips += `<g class="chip cl" data-cl="${cl.mem.map((o) => o.id).join(",")}"><rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh}" rx="6"/><text x="${(bx + 6).toFixed(1)}" y="${(by + bh - 3 - mc.h * 0.22).toFixed(1)}">${esc(cl.label)}</text></g>`;
        break;
      }
    });
    order.filter((hh) => hh.id !== sel).forEach(placeChip);
    C.landmarks.forEach((m) => {
      const [x, y] = px(m.lat, m.lng);
      if (x < -20 || y < -20 || x > w + 20 || y > h + 20) return;
      const me = tm(m.e, "", "lm-e"), ew = Math.max(16, me.w);
      lm += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="lm-e" dy="0.35em">${m.e}</text>`;
      take({ x: x - ew / 2, y: y - ew / 2, w: ew, h: ew });
      const ml = tm(m.n, "", "lm-t"), tw0 = ml.w, th = ml.h;
      for (const [bx, by] of [[x + ew / 2 + 2, y - th / 2], [x - ew / 2 - 2 - tw0, y - th / 2], [x - tw0 / 2, y + ew / 2 + 1], [x - tw0 / 2, y - ew / 2 - 1 - th]]) {
        const b = { x: bx, y: by, w: tw0, h: th };
        if (!free(b)) continue;
        take(b); lbl += bg(b) + `<text x="${bx.toFixed(1)}" y="${(by + th * 0.78).toFixed(1)}" class="lm-t">${esc(m.n)}</text>`;
        break;
      }
    });
    if (zr >= 1.6) stationsDrawn.filter(([st]) => !st.m).forEach(([st, x, y]) => stLabel(st, x, y));
    C.zones.forEach((zn) => {
      if (!zn.n) return;
      const [x, y] = px(zn.lat, zn.lng), r = mpx(zn.r) * (zn.sy || 1), mz = tm(zn.n, "", "zone-t"), t0 = mz.w;
      const b = { x: x - t0 / 2, y: y - r - 2, w: t0, h: mz.h };
      if (free(b)) { take(b); lbl += bg(b) + `<text x="${x.toFixed(1)}" y="${(y - r - 2 + mz.h * 0.78).toFixed(1)}" class="zone-t" text-anchor="middle" style="fill:${areaOf(zn.k).c}">${esc(zn.n)}</text>`; }
    });
    // 축척
    const m500 = mpx(500), sc = m500 > 140 ? [250, mpx(250)] : m500 < 40 ? [1000, mpx(1000)] : [500, m500];
    const scale = `<g class="scale" transform="translate(10,${h - 14})"><line x1="0" y1="0" x2="${sc[1].toFixed(1)}" y2="0"/><text x="${(sc[1] + 5).toFixed(1)}" y="4">${sc[0] < 1000 ? sc[0] + "m" : "1km"} · 걸어서 ${Math.round(sc[0] / 80)}분</text></g>`;
    box.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${s}${lm}${pins}${chips}${lbl}${far}${scale}</svg>`;
  }
  let raf = 0;
  const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };

  // 손가락으로 끌기·두 손가락 확대, 휠 확대
  const ptrs = new Map();
  let moved = 0, last = null, downAt = 0;
  function zoomAt(f, cx, cy) {
    const k = cosK();
    const lng0 = view.lng + (cx - W() / 2) / (view.z * k), lat0 = view.lat - (cy - Hh() / 2) / view.z;
    view.z *= f; clampView();
    view.lng = lng0 - (cx - W() / 2) / (view.z * k); view.lat = lat0 + (cy - Hh() / 2) / view.z;
    clampView(); redraw();
  }
  const rel = (e) => { const r = box.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  box.addEventListener("pointerdown", (e) => {
    box.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, rel(e));
    if (ptrs.size === 1) { moved = 0; downAt = Date.now(); }
    last = null;
  });
  box.addEventListener("pointermove", (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId), cur = rel(e);
    ptrs.set(e.pointerId, cur);
    if (ptrs.size === 1) {
      const dx = cur[0] - prev[0], dy = cur[1] - prev[1];
      moved += Math.abs(dx) + Math.abs(dy);
      view.lng -= dx / (view.z * cosK()); view.lat += dy / view.z; clampView(); redraw();
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (last) { zoomAt(d / last.d, mid[0], mid[1]); view.lng -= (mid[0] - last.mid[0]) / (view.z * cosK()); view.lat += (mid[1] - last.mid[1]) / view.z; clampView(); }
      last = { d, mid }; moved += 99;
    }
  });
  const up = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId); last = null;
    if (ptrs.size === 0 && moved < 8 && Date.now() - downAt < 600) {
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const g = t && t.closest && t.closest("[data-id]"), cg = t && t.closest && t.closest("[data-cl]");
      if (cg) {
        const mem = cg.dataset.cl.split(",").map(byId).filter(Boolean);
        const la = mem.map((o) => o.lat), ln = mem.map((o) => o.lng), pad = 0.0012;
        const z0 = view.z;
        fit([Math.min(...la) - pad, Math.min(...ln) - pad, Math.max(...la) + pad, Math.max(...ln) + pad], 0.8);
        if (view.z < z0 * 1.6) view.z = z0 * 1.6;
        clampView(); redraw();
      } else if (g) select(g.dataset.id, false);
      else if (sel) { sel = null; renderPeek(); redraw(); markCards(); }
    }
  };
  box.addEventListener("pointerup", up);
  box.addEventListener("pointercancel", up);
  box.addEventListener("wheel", (e) => { e.preventDefault(); const [x, y] = rel(e); zoomAt(e.deltaY < 0 ? 1.25 : 0.8, x, y); }, { passive: false });
  box.addEventListener("dblclick", (e) => { const [x, y] = rel(e); zoomAt(1.8, x, y); });
  $("zin").addEventListener("click", () => zoomAt(1.5, W() / 2, Hh() / 2));
  $("zout").addEventListener("click", () => zoomAt(1 / 1.5, W() / 2, Hh() / 2));

  // 권역 바로가기
  function renderPresets() {
    $("presets").innerHTML = C.presets.map((p, i) => `<button type="button" data-p="${i}">${esc(p.n)}</button>`).join("");
  }
  $("presets").addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (!b) return; fit(C.presets[+b.dataset.p].b, 0.9); clampView(); redraw(); });

  let showDots = true;
  function renderLegend() {
    $("legend").innerHTML = `${C.areas.map((a) => `<span><i style="background:${a.c}"></i>${esc(a.n)}</span>`).join("")}<span><i class="cli"></i>숫자 원 = 겹친 숙소 묶음(누르면 확대)</span><label><input type="checkbox" id="dotsChk" ${showDots ? "checked" : ""}><i class="dl"></i>맛집 지도 가게 <i class="dl hi"></i>타베로그 3.6↑</label>`;
  }
  $("legend").addEventListener("change", (e) => { if (e.target.id === "dotsChk") { showDots = e.target.checked; redraw(); } });

  // ---------------------------------------------------------------- 선택 + 카드
  function select(id, center) {
    sel = id;
    const h = byId(id);
    if (h && center) { view.lat = h.lat; view.lng = h.lng; if (view.z < fitZ * 2.2) view.z = fitZ * 2.2; clampView(); }
    renderPeek(); redraw(); markCards();
  }
  function renderPeek() {
    const h = sel && byId(sel);
    const p = $("peek");
    if (!h) { p.hidden = true; return; }
    p.hidden = false;
    p.innerHTML = `<button type="button" class="x" data-peek="close" aria-label="닫기">✕</button><div class="pk-n"><span class="no" style="background:${areaOf(h.area).c}">${h.no}</span><b>${esc(h.n)}</b></div>
      <div class="pk-m">${h.price ? `<b>${man(h.price)} 원</b>${C.nights > 1 ? " /박" : ""}` : "가격 없음"} · ★${h.rating ?? "-"} (${(h.reviews || 0).toLocaleString()}) · ${esc(areaOf(h.area).n)} · ${esc(h.st.n)} ${h.st.m}분</div>
      <div class="pk-b"><button type="button" data-peek="card">카드 보기 ↓</button><a href="${esc(h.gurl)}" target="_blank" rel="noopener">가격 보기</a></div>`;
  }
  $("peek").addEventListener("click", (e) => {
    const b = e.target.closest("[data-peek]");
    if (!b) return;
    if (b.dataset.peek === "close") { sel = null; renderPeek(); redraw(); markCards(); }
    if (b.dataset.peek === "card") { const c = $("h-" + sel); if (c) { c.scrollIntoView({ behavior: "smooth", block: "start" }); c.classList.add("flash"); setTimeout(() => c.classList.remove("flash"), 1200); } }
  });
  function markCards() { document.querySelectorAll(".hc").forEach((c) => c.classList.toggle("on", c.dataset.id === sel)); }
  function scrollMapIntoView() { const r = box.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) box.scrollIntoView({ behavior: "smooth", block: "center" }); }

  const SORTS = [["rec", "추천순"], ["price", "싼 순"], ["rating", "평점순"], ["food", "맛집 많은 순"]];
  function renderTools() {
    $("sortSeg").innerHTML = SORTS.map(([k, n]) => `<button type="button" data-sort="${k}" aria-pressed="${sortBy === k}">${n}</button>`).join("");
    const nb = H().filter(inBudget).length;
    $("budgetSeg").innerHTML = `<button type="button" data-budget="1" aria-pressed="${budgetOnly}">🏨 추천 숙소만 <small>${nb}</small></button><button type="button" data-budget="0" aria-pressed="${!budgetOnly}">참고: 유명·고급 호텔까지 <small>${H().length}</small></button>`;
    const areaN = (k) => H().filter((h) => (!k || h.area === k) && (!budgetOnly || inBudget(h)) && amenOk(h)).length;
    $("areaSeg").innerHTML = [["", "전체"], ...C.areas.map((a) => [a.k, a.n])].filter(([k]) => !k || areaF === k || areaN(k) > 0).map(([k, n]) => `<button type="button" data-area="${k}" aria-pressed="${areaF === k}">${esc(n)} <small>${areaN(k)}</small></button>`).join("");
    const amenCount = (k) => H().filter((h) => (!areaF || h.area === areaF) && (!budgetOnly || inBudget(h)) && h.amen && AMEN[k][1](h.amen)).length;
    $("amenSeg").innerHTML = Object.entries(AMEN).filter(([k]) => amenF === k || amenCount(k) > 0).map(([k, [n]]) => `<button type="button" data-amen="${k}" aria-pressed="${amenF === k}">${n} <small>${amenCount(k)}</small></button>`).join("");
  }
  $("sortSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-sort]"); if (b) { sortBy = b.dataset.sort; renderTools(); renderList(); } });
  function setArea(k) { areaF = k; if (sel && !vis(byId(sel))) { sel = null; renderPeek(); } renderTools(); renderList(); const a = C.areas.find((x) => x.k === areaF); fit(a ? a.b : C.bounds, 0.9); clampView(); redraw(); }
  $("areaSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-area]"); if (b) setArea(b.dataset.area); });
  $("amenSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-amen]"); if (!b) return; amenF = amenF === b.dataset.amen ? "" : b.dataset.amen; if (sel && !vis(byId(sel))) { sel = null; renderPeek(); } renderTools(); renderList(); redraw(); });
  $("budgetSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-budget]"); if (!b) return; budgetOnly = b.dataset.budget === "1"; if (sel && !vis(byId(sel))) { sel = null; renderPeek(); } renderTools(); renderList(); redraw(); });

  function vendTable(h) {
    if (!h.vendors || !h.vendors.length) return "";
    const rows = h.vendors.slice().sort((a, b) => a.p - b.p).map((v) => `<tr${v.o ? ' class="off"' : ""}><td>${esc(v.v)}${v.o ? " <small>공식</small>" : ""}</td><td>${won(v.p)}</td>${C.nights > 1 ? `<td>${won(v.p * C.nights)}</td>` : ""}</tr>`).join("");
    return `<details class="vend"><summary>판매처별 가격 ${h.vendors.length}곳</summary><table><thead><tr><th>판매처</th><th>1박</th>${C.nights > 1 ? `<th>${C.nights}박</th>` : ""}</tr></thead><tbody>${rows}</tbody></table><p class="cnote">객실 종류·조식·취소 조건이 판매처마다 달라요. ${C.nights > 1 ? `${C.nights}박은 1박 요금×${C.nights}로 어림한 값이에요. ` : ""}예약 전 꼭 다시 확인하세요.</p></details>`;
  }
  // 구글 호텔 '편의시설'에 있는 것만 (없다고 나온 게 아니라 '표시 없음'일 수 있음)
  function amenTags(h) {
    const m = h.amen;
    if (!m) return "";
    const t = [];
    if (m.smokeFree) t.push('<span class="am">🚭 전관 금연</span>');
    if (m.breakfast === "free") t.push('<span class="am">🍳 조식 무료</span>');
    if (m.bath) t.push(`<span class="am">♨️ ${m.bath === "onsen" ? "천연 온천" : "대욕장"}</span>`);
    if (m.laundry) t.push('<span class="am">🧺 셀프 세탁</span>');
    return t.join("");
  }
  function card(h) {
    const a = areaOf(h.area);
    const priceBlk = h.price
      ? `<div class="kv-p"><b>${man(h.price)} 원</b><small>${C.nights > 1 ? `1박 평균 · ${C.nights}박 ${man(h.total || h.price * C.nights)}` : `1박 최저${h.pv ? ` · ${esc(h.pv)}` : ""}`}</small></div>`
      : `<div class="kv-p"><b>-</b><small>가격 못 찾음</small></div>`;
    return `<li class="hc${h.id === sel ? " on" : ""}" id="h-${h.id}" data-id="${h.id}">
      <div class="hc-top"><span class="no" style="background:${a.c}">${h.no}</span><div class="nm"><b>${esc(h.n)}</b><small>${esc(h.en && h.en.replace(/\s/g, "") !== h.n.replace(/\s/g, "") ? h.en : "")}</small></div><button type="button" class="onmap" data-map="${h.id}">지도</button></div>
      <div class="tags"><span class="ta" style="border-color:${a.c};color:${a.c}">${esc(a.n)}</span>${h.why ? `<span class="tx">${esc(h.why)}</span>` : h.price <= (C.target || 0) * 1.15 ? '<span class="tg">💚 10만 원 안팎</span>' : ""}${h.badge ? `<span class="tb">${esc(h.badge)}</span>` : ""}${amenTags(h)}${h.cls ? `<span>${esc(h.cls)}</span>` : ""}</div>
      <div class="kv">${priceBlk}
        <div><b>★ ${h.rating ?? "-"}</b><small>구글 ${(h.reviews || 0).toLocaleString()}개</small></div>
        <div><b>${h.st.m}분</b><small>${esc(h.st.n)}</small></div>
        <div><b>${h.food.n}곳</b><small>걸어서 10분 맛집</small></div></div>
      ${h.pros && h.pros.length ? `<ul class="pros">${h.pros.map((p) => `<li>${p}</li>`).join("")}${(h.cons || []).map((p) => `<li class="con">${p}</li>`).join("")}</ul>` : ""}
      ${h.food.best.length ? `<p class="food">🍽 근처: ${h.food.best.map((b) => `<a href="./#${encodeURIComponent(b[2] || "")}">${esc(b[0])}</a> <small>${b[1]}</small>`).join(" · ")}</p>` : ""}
      ${vendTable(h)}
      <div class="btns"><a class="b1" href="${esc(h.gurl)}" target="_blank" rel="noopener">📅 ${esc(C.whenShort)} 가격</a><a href="${esc(h.murl)}" target="_blank" rel="noopener">📍 구글맵</a><a href="./#near=${h.lat.toFixed(5)},${h.lng.toFixed(5)},${encodeURIComponent(h.short || h.n)}">🍽 근처 맛집</a></div>
    </li>`;
  }
  function renderList() {
    let hs = H().filter((h) => vis(h));
    const k = { rec: (h) => h.no, value: (h) => -(h.value || 0), price: (h) => h.price || 1e12, rating: (h) => -(h.rating || 0) * 1e6 - (h.reviews || 0), food: (h) => -h.food.n }[sortBy];
    hs = hs.slice().sort((a, b) => k(a) - k(b));
    $("hlist").innerHTML = hs.map(card).join("");
  }
  $("hlist").addEventListener("click", (e) => { const b = e.target.closest("[data-map]"); if (b) { select(b.dataset.map, true); scrollMapIntoView(); } });

  function renderFoot() {
    $("foot").innerHTML = `<p><b>어떻게 골랐나</b>: 구글 호텔에서 ${Object.values(D.cities).map((c) => `${esc(c.ko)} ${esc(c.whenShort)}`).join(", ")}(성인 2명) 날짜로 권역별 숙소 목록(오사카 6개·교토 4개 권역, 수백 곳)을 훑은 뒤, <b>구글 평점 4.3 이상·리뷰 300개 이상·1박 8만 원 이상·예산 이하</b>만 남겼어요. 단, 교토역 출구에서 5분 안의 대형 호텔은 리뷰 1,000개 이상이면 평점 4.1부터 넣었어요('역 바로 앞' 표시). 처음에 비교용으로 넣은 유명·고급 호텔은 '참고'로 따로 볼 수 있어요.</p>
      <p><b>가격</b>: ${esc(D.updated)} 조회, 세금·수수료 포함 원화. ${D.cities.osaka ? "오사카는 3박 평균 1박 요금이에요. " : ""}판매처 최저가라 객실·조식·취소 조건이 제각각이고, 연말이라 매일 바뀌어요. 예약 직전 카드의 '가격 보기'로 다시 확인하세요.</p>
      <p><b>추천순</b>: 권역 추천 순서 → 같은 권역 안에선 평점이 높고 가격이 낮고 역에서 가까운 순. <b>걸어서 10분 맛집</b>: 이 앱 맛집 지도 가게 중 숙소에서 직선 800m 안. <b>역까지 분</b>: 직선거리로 어림.</p>
      <p><b>🚭·♨️·🧺 표시</b>: 구글 호텔 '편의시설'에 '금연 시설'·'공중목욕탕/천연 온천'·'셀프 세탁실'로 나온 곳만 붙였어요(표시가 없으면 '없음'이 아니라 '정보 없음'일 수 있어요). 조식은 구글상 대부분 '추가 요금'이라, 조식 포함 요금제인지는 예약할 때 확인하세요.</p>
      <p>🛏 비즈니스 호텔 더블룸은 12~15㎡로 좁아요. 캐리어 2개를 펼치려면 '트윈'이나 18㎡ 이상 객실을 고르세요. 🚭 예약할 때 객실명에 '禁煙(금연)'이 있는지 확인하세요.</p>
      <p><b>지도</b>는 실제 축척을 따른 간이 지도예요(노선·강은 단순화). 두 손가락으로 확대, 끌어서 이동.</p>`;
  }

  let toastT = 0;
  function toast(m) { const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); }

  function renderAll(refit) {
    if (!H().some(inBudget)) budgetOnly = false;
    renderTabs(); renderPick(); renderPresets(); renderLegend(); renderTools(); renderList(); renderPeek();
    if (refit) { fit(C.bounds); fitZ = view.z; }
    redraw();
  }
  let lastW = 0;
  new ResizeObserver(() => { if (Math.abs(box.clientWidth - lastW) < 2) return; const first = !lastW; lastW = box.clientWidth; const r = first ? 1 : view.z / fitZ; const c = [view.lat, view.lng]; fit(C.bounds); fitZ = view.z; if (!first) { view.z = fitZ * r; [view.lat, view.lng] = c; clampView(); } redraw(); }).observe(box);
  renderFoot();
  renderAll(true);
  window.__hotels = { select, view, toast };
})();
