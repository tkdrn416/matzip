#!/usr/bin/env node
// 숙소 가격·평점 다시 모으기 (구글 호텔, 헤드리스 Chromium)
//   node scripts/hotel_prices.js            → data/hotels_prices.json 갱신 (이미 있는 건 건너뜀)
//   FORCE=1 node scripts/hotel_prices.js    → 전부 다시
//   python3 scripts/build_hotels.py         → data/hotels.js 다시 만들기
// 구글 호텔 화면 글자를 읽는 방식이라 화면이 바뀌면 고쳐야 할 수 있어요. 한 번에 수십 곳 정도만, 천천히.
// 엔티티(호텔) 키는 data/hotels_prices.json 에 저장돼 다음부터는 바로 씀.
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const LIST = [
  { id: "k-granvia", q: "Hotel Granvia Kyoto", ci: "2026-12-27", co: "2026-12-28" },
  { id: "k-thousand", q: "The Thousand Kyoto", ci: "2026-12-27", co: "2026-12-28" },
  { id: "k-vischio", q: "Hotel Vischio Kyoto by Granvia", ci: "2026-12-27", co: "2026-12-28" },
  { id: "k-miyako", q: "Miyako City Kintetsu Kyoto Station", ci: "2026-12-27", co: "2026-12-28" },
  { id: "k-richmond", q: "Richmond Hotel Premier Kyoto Ekimae", ci: "2026-12-27", co: "2026-12-28" },
  { id: "k-rihga", q: "RIHGA Royal Hotel Kyoto", ci: "2026-12-27", co: "2026-12-28" },
  { id: "k-gate", q: "THE GATE HOTEL Kyoto Takasegawa by HULIC", ci: "2026-12-27", co: "2026-12-28" },
  { id: "k-cross", q: "Cross Hotel Kyoto", ci: "2026-12-27", co: "2026-12-28" },
  { id: "k-goodnature", q: "Good Nature Hotel Kyoto", ci: "2026-12-27", co: "2026-12-28" },
  { id: "k-courtyard", q: "コートヤード・バイ・マリオット京都四条烏丸", ci: "2026-12-27", co: "2026-12-28" },
  { id: "k-okura", q: "Hotel Okura Kyoto", ci: "2026-12-27", co: "2026-12-28" },
  { id: "k-ace", q: "Ace Hotel Kyoto", ci: "2026-12-27", co: "2026-12-28" },
  { id: "k-celestine", q: "Hotel The Celestine Kyoto Gion", ci: "2026-12-27", co: "2026-12-28" },
  { id: "k-mitsuishijo", q: "Mitsui Garden Hotel Kyoto Shijo", ci: "2026-12-27", co: "2026-12-28" },
  { id: "o-swissotel", q: "Swissotel Nankai Osaka", ci: "2026-12-28", co: "2026-12-31" },
  { id: "o-oriental", q: "Namba Oriental Hotel", ci: "2026-12-28", co: "2026-12-31" },
  { id: "o-cross", q: "Cross Hotel Osaka", ci: "2026-12-28", co: "2026-12-31" },
  { id: "o-candeo", q: "Candeo Hotels Osaka Namba", ci: "2026-12-28", co: "2026-12-31" },
  { id: "o-royalclassic", q: "Hotel Royal Classic Osaka", ci: "2026-12-28", co: "2026-12-31" },
  { id: "o-nikko", q: "Hotel Nikko Osaka", ci: "2026-12-28", co: "2026-12-31" },
  { id: "o-w", q: "W Osaka", ci: "2026-12-28", co: "2026-12-31" },
  { id: "o-grids", q: "Grids Premium Hotel Osaka Namba", ci: "2026-12-28", co: "2026-12-31" },
  { id: "o-conrad", q: "Conrad Osaka", ci: "2026-12-28", co: "2026-12-31" },
  { id: "o-fresa", q: "Sotetsu Fresa Inn Kitahama", ci: "2026-12-28", co: "2026-12-31" },
  { id: "o-mitsuipremier", q: "Mitsui Garden Hotel Osaka Premier", ci: "2026-12-28", co: "2026-12-31" },
  { id: "o-respire", q: "Hotel Hankyu RESPIRE OSAKA", ci: "2026-12-28", co: "2026-12-31" },
  { id: "o-omo7", q: "OMO7 Osaka by Hoshino Resorts", ci: "2026-12-28", co: "2026-12-31" },
  { id: "o-marriott", q: "Osaka Marriott Miyako Hotel", ci: "2026-12-28", co: "2026-12-31" }
];
// 구글 호텔: 이름 → entity → 개요(평점·리뷰·주소·최저가·좌표) + 가격(판매처별)
const { chromium } = require('playwright');
const fs = require('fs');
const ts = function (ci, co, cur) {
  const dt = (s) => { const [y, m, d] = s.split('-').map(Number); return [0x08, (y & 0x7f) | 0x80, y >> 7, 0x10, m, 0x18, d]; };
  const a = dt(ci), b = dt(co);
  const inner = [0x0a, a.length, ...a, 0x12, b.length, ...b];
  const f2 = [0x12, inner.length, ...inner, 0x32, 0x02, 0x08, 0x00];
  const f3 = [0x12, f2.length, ...f2];
  const c = [...Buffer.from(cur)];
  const all = [0x08, 0x00, 0x1a, f3.length, ...f3, 0x2a, c.length + 4, 0x0a, c.length + 2, 0x3a, c.length, ...c];
  return Buffer.from(all).toString('base64url');
};

const outFile = path.join(ROOT, 'data/hotels_prices.json');
const out = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
// 처음 고른 목록 + 이미 저장된 호텔(권역 검색으로 찾은 가성비 후보 포함) 전부
const list = [...LIST, ...Object.values(out).filter((v) => v.ok && !LIST.some((l) => l.id === v.id)).map((v) => ({ id: v.id, q: v.q, ci: v.ci, co: v.co, ent: v.ent }))];
const won = (s) => +s.replace(/[₩,\s]/g, '');
function parseVendors(t) {
  const L = t.split('\n').map((s) => s.trim()).filter(Boolean);
  const i0 = L.indexOf('모든 옵션');
  const res = [];
  if (i0 < 0) return res;
  let blk = [];
  for (let i = i0 + 1; i < L.length; i++) {
    const l = L[i];
    if (/^최저가 ₩/.test(l) || /^스폰서·비슷한/.test(l) || /^꼭 알아두어야/.test(l)) break;
    if (l === '사이트 방문') {
      const price = blk.find((x) => /^₩[\d,]+$/.test(x));
      if (blk.length && price) res.push({ v: blk[0], p: won(price), official: blk.includes('공식 사이트'), note: blk.find((x) => /취소/.test(x)) || '' });
      blk = [];
    } else blk.push(l);
  }
  return res;
}
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: 'ko-KR', viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  for (const h of list) {
    if (out[h.id] && out[h.id].ok && !process.env.FORCE) continue;
    const T = ts(h.ci, h.co, 'KRW');
    const rec = { id: h.id, q: h.q, ci: h.ci, co: h.co, at: new Date().toISOString() };
    try {
      let ent = h.ent || (out[h.id] && out[h.id].ent);
      if (!ent) {
        await p.goto('https://www.google.com/travel/search?q=' + encodeURIComponent(h.q) + '&hl=ko&gl=kr&ts=' + T, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await p.waitForTimeout(4000);
        let qs = new URL(p.url()).searchParams.get('qs');
        if (!qs) {
          // 목록만 뜨면: 이름이 같은 카드를 눌러 상세 열기
          const a = p.locator(`a[aria-label="${h.q.replace(/"/g, '\\"')}"]`).first();
          if (await a.count()) { await a.click().catch(() => {}); await p.waitForTimeout(3500); qs = new URL(p.url()).searchParams.get('qs'); }
        }
        if (qs) { const bq = Buffer.from(qs, 'base64url'); ent = bq.slice(2, 2 + bq[1]).toString('latin1'); }
      }
      if (!ent) throw new Error('no entity');
      rec.ent = ent;
      await p.goto('https://www.google.com/travel/hotels/entity/' + ent + '?hl=ko&gl=kr&ts=' + T, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(5000);
      const t = await p.evaluate(() => document.body.innerText);
      const html = await p.content();
      const L = t.split('\n').map((s) => s.trim()).filter(Boolean);
      const iStar = L.findIndex((x) => /성급 호텔$|^호텔$|^료칸$|^게스트하우스$|성급 료칸$/.test(x));
      rec.name = iStar > 0 ? L[iStar - 1] : (L.find((x, i) => L[i + 1] === '개요') || '');
      rec.cls = iStar >= 0 ? L[iStar] : '';
      rec.addr = iStar >= 0 ? (L[iStar + 1] || '').split('•')[0] : '';
      const iP = L.findIndex((x, i) => /^₩[\d,]+$/.test(x) && /월 \d+일~/.test(L[i + 1] || ''));
      rec.headline = iP >= 0 ? won(L[iP]) : null;
      rec.headlineDates = iP >= 0 ? L[iP + 1] : null;
      const iR = L.findIndex((x, i) => /^\d\.\d$/.test(x) && /리뷰 [\d,]+개/.test(L.slice(i + 1, i + 4).join(' ')));
      rec.rating = iR >= 0 ? +L[iR] : null;
      if (iR >= 0) { const m = L.slice(iR + 1, iR + 4).join(' ').match(/리뷰 ([\d,]+)개/); rec.reviews = m ? won(m[1]) : null; }
      const c = html.match(/\[null,null,(3[45]\.\d{3,}),(13[45]\.\d{3,})\]/) || html.match(/(3[45]\.\d{5,})\s*,\s*(13[45]\.\d{5,})/);
      rec.lat = c ? +c[1] : null; rec.lng = c ? +c[2] : null;
      rec.perNight = /1박 요금/.test(t);
      await p.goto('https://www.google.com/travel/hotels/entity/' + ent + '/prices?hl=ko&gl=kr&ts=' + T, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(5000);
      const t2 = await p.evaluate(() => document.body.innerText);
      rec.vendors = parseVendors(t2);
      const ml = t2.match(/최저가 (₩[\d,]+)부터/);
      rec.minMore = ml ? won(ml[1]) : null;
      rec.soldout = /예약 가능한 객실이 없|매진|이 날짜에는 객실/.test(t2) && !rec.vendors.length;
      rec.priceMode = (t2.match(/(1박 요금 총액|전체 숙박 요금 총액|1박 요금|총 요금)/) || [])[1] || '';
      // 편의시설(금연·조식·대욕장·세탁)
      await p.goto('https://www.google.com/travel/hotels/entity/' + ent + '/details?hl=ko&gl=kr&ts=' + T, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(4000);
      const L3 = (await p.evaluate(() => document.body.innerText)).split('\n').map((x) => x.trim()).filter(Boolean);
      const iB = L3.indexOf('조식');
      rec.amen = {
        smokeFree: L3.includes('금연 시설'),
        breakfast: iB < 0 ? null : /무료/.test(L3[iB + 1] || '') ? 'free' : /추가 요금/.test(L3[iB + 1] || '') ? 'paid' : 'yes',
        bath: L3.includes('천연 온천') ? 'onsen' : L3.includes('공중목욕탕') ? 'bath' : null,
        laundry: L3.includes('셀프 세탁실'),
        checkin: ((L3.find((x) => /^체크인 시간/.test(x)) || '').split(': ')[1]) || null,
        checkout: ((L3.find((x) => /^체크아웃 시간/.test(x)) || '').split(': ')[1]) || null,
      };
      rec.ok = true;
    } catch (e) { rec.ok = false; rec.err = String(e.message || e).slice(0, 200); }
    out[h.id] = rec;
    fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
    console.log(h.id, rec.ok ? `${rec.name} | ${rec.cls} | ★${rec.rating} (${rec.reviews}) | ₩${rec.headline} ${rec.headlineDates} | vendors ${rec.vendors.length} | ${rec.lat},${rec.lng} | ${rec.priceMode}` : 'ERR ' + rec.err);
  }
  await b.close();
})();
