/* 선박왕 rules engine — data, weather, freight, voyages and the daily tick.
   Plain script: in the browser its top-level names are shared with index.html;
   in Node the test harness (tests/harness.js) loads it into a vm context.
   It never touches the DOM. Anything the screen should react to goes through HOOK. */
'use strict';
let S = null;
const HOOK = { toast() {}, sound() {}, pause() {}, era() {}, win() {}, over() {}, save() {}, sailed() {}, trip() {} };
// Seeded random (mulberry32). Two streams, both stored in the save:
// S.ms = the outside world (freight index, oil, weather, port booms, rivals) — identical for a seed whatever the player does,
// S.rs = everything the player's choices touch (jobs, used ships, accidents).
function mulberry(key) {
  let t = (S[key] = (S[key] + 0x6D2B79F5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rand = () => mulberry('rs');
const mrand = () => mulberry('ms');
const mgauss = () => (mrand() + mrand() + mrand() - 1.5) * 2;
/* ================= DATA ================= */
const START_YEAR = 1955, GOAL = 1000000, SAVE_KEY = 'shipking-proto-v4', SAVE_VERSION = 4;
const ERA = [null,
  { name: '강의 시대', need: 0 },
  { name: '연안의 시대', need: 20000 },
  { name: '근해의 시대', need: 200000 },
];
// 화물 종류: rate = 운임 배율 (생선은 상하기 쉬워 비싸고 기한이 짧다)
const GOODS = {
  rice: { name: '쌀', cls: 'bulk', era: 1, rate: 1.0 },
  salt: { name: '소금', cls: 'bulk', era: 1, rate: 0.85 },
  wood: { name: '목재', cls: 'bulk', era: 1, rate: 0.85 },
  fish: { name: '생선', cls: 'general', era: 1, rate: 1.35, fresh: true },
  goods: { name: '잡화', cls: 'general', era: 1, rate: 1.3 },
  cement: { name: '시멘트', cls: 'bulk', era: 2, rate: 0.95 },
  coal: { name: '석탄', cls: 'bulk', era: 2, rate: 0.85 },
  fuel: { name: '석유제품', cls: 'liquid', era: 2, rate: 1.15 },
  ore: { name: '철광석', cls: 'bulk', era: 3, rate: 0.85 },
};
// wage = 하루 고정비(선원비·관리비), burn = 항해 중 하루 연료 소모(t), tank = 연료 탱크(t), sail = 돛배(연료 없음)
const SHIPS = {
  ttak:    { name: '똑딱선', short: '똑딱', role: 'cargo', cap: 10, speed: 40, price: 1300, wage: 15, burn: 0.04, tank: 0.6, range: 0, river: true, era: 1, build: 5, cls: ['bulk', 'general'] },
  hwangpo: { name: '황포돛배', short: '황포', role: 'cargo', cap: 25, speed: 50, price: 3000, wage: 40, burn: 0, tank: 0, sail: true, range: 1, river: true, era: 1, build: 10, cls: ['bulk', 'general'] },
  fishing: { name: '소형 어선', short: '어선', role: 'fish', cap: 8, speed: 60, price: 4000, wage: 35, burn: 0.08, tank: 1.2, range: 1, river: false, era: 1, build: 10 },
  leisure: { name: '낚시선', short: '낚시', role: 'tour', cap: 0, speed: 60, price: 6000, wage: 45, burn: 0.07, tank: 1.0, range: 1, river: false, era: 2, build: 12 },
  coaster: { name: '연안 운반선', short: '연안', role: 'cargo', cap: 80, speed: 150, price: 25000, wage: 150, burn: 0.6, tank: 10, range: 1, river: false, era: 2, build: 30, cls: ['bulk', 'general', 'liquid'] },
  bunker:  { name: '급유선', short: '급유', role: 'bunker', cap: 0, speed: 150, price: 30000, wage: 170, burn: 0.65, tank: 12, range: 1, river: false, era: 2, build: 30 },
  bulk:    { name: '소형 벌크선', short: '벌크', role: 'cargo', cap: 600, speed: 350, price: 180000, wage: 1000, burn: 6.5, tank: 120, range: 2, river: false, era: 3, build: 60, cls: ['bulk'] },
  feeder:  { name: '피더 컨테이너선', short: '피더', role: 'cargo', cap: 1000, speed: 450, price: 400000, wage: 2000, burn: 12, tank: 220, range: 2, river: false, era: 3, build: 90, cls: ['general'] },
  tanker:  { name: '연안 탱커', short: '탱커', role: 'cargo', cap: 1500, speed: 350, price: 600000, wage: 2700, burn: 9, tank: 170, range: 2, river: false, era: 3, build: 90, cls: ['liquid'] },
};
const LATER = [
  { name: '케이프사이즈 벌크', cap: '150,000t', era: '4시대' }, { name: '대형 컨테이너선', cap: '80,000t', era: '4시대' },
  { name: 'VLCC', cap: '300,000t', era: '4시대' }, { name: 'LNG선', cap: '170,000㎥', era: '5시대' },
];
const ROLE = { cargo: '운송', fish: '조업', tour: '관광', bunker: '급유' };
const RANGE = ['하천', '연안', '근해'];
// 날씨: 0 맑음 1 흐림 2 강풍 3 태풍 — 속도·연료 배율
const WXN = ['맑음', '흐림', '강풍', '태풍'];
const WX_SPD = [1, 0.95, 0.75, 0.4], WX_FUEL = [1, 1.08, 1.45, 1.9], WX_SAIL = [1, 1.05, 0.8, 0.25];
const AREAS = { river: '강', west: '서해', south: '남해', east: '동해', near: '근해' };
const BASE_FUEL = 200;
const PORTS = {
  chungju:    { name: '충주', sub: '목계나루', lat: 37.00, lon: 127.80, size: 1, era: 1, prod: ['wood'], dem: ['salt', 'fish', 'goods'], lab: 'r' },
  yeoju:      { name: '여주', lat: 37.30, lon: 127.63, size: 1, era: 1, prod: ['rice', 'wood'], dem: ['salt', 'fish'], lab: 'r' },
  mapo:       { name: '마포', sub: '서울', lat: 37.54, lon: 126.94, size: 3, era: 1, prod: ['goods'], dem: ['rice', 'wood', 'fish', 'salt', 'cement', 'coal'], lab: 't' },
  incheon:    { name: '인천', lat: 37.46, lon: 126.62, size: 3, era: 1, prod: ['salt', 'goods'], dem: ['rice', 'wood', 'coal', 'fuel'], fish: 1, tour: 1, traffic: 3, lab: 'l' },
  ganggyeong: { name: '강경', lat: 36.16, lon: 127.01, size: 1, era: 1, prod: ['rice'], dem: ['salt', 'fish', 'goods'], lab: 'r' },
  gunsan:     { name: '군산', lat: 35.99, lon: 126.71, size: 2, era: 1, prod: ['rice', 'salt'], dem: ['goods', 'coal', 'wood'], fish: 1, traffic: 1, lab: 'l' },
  mokpo:      { name: '목포', lat: 34.79, lon: 126.38, size: 2, era: 1, prod: ['salt', 'rice'], dem: ['goods', 'wood', 'cement'], fish: 1, tour: 1, traffic: 1, lab: 'l' },
  jeju:       { name: '제주', lat: 33.52, lon: 126.53, size: 2, era: 1, prod: ['fish'], dem: ['rice', 'goods', 'cement', 'fuel'], fish: 1, tour: 3, traffic: 1, lab: 'b' },
  yeosu:      { name: '여수', lat: 34.74, lon: 127.74, size: 2, era: 1, prod: ['fish', 'fuel'], dem: ['rice', 'goods'], fish: 1, tour: 2, traffic: 2, lab: 'b' },
  tongyeong:  { name: '통영', lat: 34.84, lon: 128.42, size: 2, era: 1, prod: ['fish'], dem: ['rice', 'wood', 'fuel'], fish: 1, tour: 2, traffic: 1, lab: 'b' },
  busan:      { name: '부산', lat: 35.10, lon: 129.04, size: 4, era: 1, prod: ['goods'], dem: ['rice', 'wood', 'coal', 'cement', 'fish'], fish: 1, tour: 3, traffic: 3, lab: 'r' },
  gupo:       { name: '구포', lat: 35.21, lon: 128.99, size: 1, era: 1, prod: ['rice'], dem: ['salt', 'goods'], lab: 'l' },
  samnangjin: { name: '삼랑진', lat: 35.40, lon: 128.84, size: 1, era: 1, prod: ['rice'], dem: ['salt', 'fish'], lab: 'l' },
  daegu:      { name: '대구', sub: '화원나루', lat: 35.80, lon: 128.48, size: 2, era: 1, prod: ['goods'], dem: ['fish', 'salt', 'rice', 'coal'], lab: 'l' },
  andong:     { name: '안동', lat: 36.56, lon: 128.73, size: 1, era: 1, prod: ['wood'], dem: ['salt', 'fish', 'goods'], lab: 'r' },
  ulsan:      { name: '울산', lat: 35.50, lon: 129.38, size: 2, era: 2, prod: ['fuel'], dem: ['coal', 'cement', 'goods'], fish: 1, traffic: 2, lab: 'r' },
  pohang:     { name: '포항', lat: 36.03, lon: 129.37, size: 2, era: 2, prod: ['fish'], dem: ['ore', 'coal', 'rice'], fish: 1, tour: 1, traffic: 2, lab: 'r' },
  donghae:    { name: '동해', sub: '삼척', lat: 37.49, lon: 129.12, size: 2, era: 2, prod: ['cement', 'coal'], dem: ['rice', 'goods'], fish: 1, traffic: 1, lab: 'r' },
  fukuoka:    { name: '후쿠오카', lat: 33.60, lon: 130.40, size: 3, era: 3, prod: ['goods'], dem: ['fish', 'cement', 'rice'], traffic: 2, lab: 'b' },
  osaka:      { name: '오사카', lat: 34.65, lon: 135.43, size: 4, era: 3, prod: ['goods'], dem: ['fish', 'coal', 'ore'], traffic: 3, lab: 't' },
  shanghai:   { name: '상하이', lat: 31.30, lon: 121.60, size: 4, era: 3, prod: ['goods', 'rice'], dem: ['coal', 'fuel', 'cement'], traffic: 3, lab: 'r' },
  qingdao:    { name: '칭다오', lat: 36.07, lon: 120.32, size: 3, era: 3, prod: ['coal', 'salt'], dem: ['goods', 'fuel'], traffic: 2, lab: 'r' },
  dalian:     { name: '다롄', lat: 38.92, lon: 121.65, size: 3, era: 3, prod: ['ore', 'coal'], dem: ['goods', 'rice'], traffic: 2, lab: 'r' },
};
const WPS = {
  h1: [37.56, 127.22], h2: [37.66, 126.68], n1: [36.15, 128.45], n2: [35.58, 128.62],
  w_inc: [37.30, 126.30], w_taean: [36.75, 125.95], w_gun: [35.95, 126.35], w_mok: [34.78, 126.05],
  w_sw: [34.20, 125.95], w_s1: [34.30, 127.20], w_yeo: [34.55, 127.85], w_s2: [34.62, 128.55],
  w_bus: [34.98, 129.15], w_e1: [35.45, 129.55], w_e2: [36.05, 129.60], w_e3: [37.30, 129.45],
  w_tsu: [34.30, 129.70], w_kan: [33.97, 130.95], w_seto: [34.30, 133.20],
  w_ys: [35.80, 123.50], w_bh: [38.30, 122.40], w_ecs: [32.40, 124.50],
};
const EDGES = [
  ['chungju', 'yeoju', 'r'], ['yeoju', 'h1', 'r'], ['h1', 'mapo', 'r'], ['mapo', 'h2', 'r'], ['h2', 'incheon', 'r'],
  ['ganggyeong', 'gunsan', 'r'],
  ['andong', 'n1', 'r'], ['n1', 'daegu', 'r'], ['daegu', 'n2', 'r'], ['n2', 'samnangjin', 'r'], ['samnangjin', 'gupo', 'r'], ['gupo', 'busan', 'r'],
  ['incheon', 'w_inc', 'c'], ['w_inc', 'w_taean', 'c'], ['w_taean', 'w_gun', 'c'], ['w_gun', 'gunsan', 'c'], ['w_gun', 'w_mok', 'c'], ['w_mok', 'mokpo', 'c'], ['w_mok', 'w_sw', 'c'],
  ['w_sw', 'w_s1', 'c'], ['w_sw', 'jeju', 'c'], ['jeju', 'w_s1', 'c'], ['w_s1', 'w_yeo', 'c'], ['w_yeo', 'yeosu', 'c'], ['w_yeo', 'w_s2', 'c'], ['w_s2', 'tongyeong', 'c'], ['w_s2', 'w_bus', 'c'], ['w_bus', 'busan', 'c'],
  ['w_bus', 'w_e1', 'c'], ['w_e1', 'ulsan', 'c'], ['w_e1', 'w_e2', 'c'], ['w_e2', 'pohang', 'c'], ['w_e2', 'w_e3', 'c'], ['w_e3', 'donghae', 'c'],
  ['w_bus', 'w_tsu', 'n'], ['w_tsu', 'fukuoka', 'n'], ['fukuoka', 'w_kan', 'n'], ['w_kan', 'w_seto', 'n'], ['w_seto', 'osaka', 'n'],
  ['w_taean', 'w_ys', 'n'], ['w_ys', 'qingdao', 'n'], ['w_ys', 'w_bh', 'n'], ['w_bh', 'dalian', 'n'], ['w_ys', 'w_ecs', 'n'], ['w_sw', 'w_ecs', 'n'], ['jeju', 'w_ecs', 'n'], ['w_ecs', 'shanghai', 'n'],
];
const LAND = [
  [[39.8,124.3],[39.55,125.1],[38.75,125.15],[38.1,124.75],[37.75,126.15],[37.45,126.65],[37.05,126.8],[36.9,126.2],[36.45,126.5],[36.0,126.65],[35.6,126.5],[35.1,126.3],[34.75,126.35],[34.35,126.5],[34.5,127.3],[34.7,127.75],[34.85,128.3],[35.05,128.7],[35.08,129.05],[35.35,129.35],[35.8,129.45],[36.1,129.45],[36.8,129.45],[37.4,129.2],[38.0,128.7],[38.6,128.35],[39.2,127.5],[39.9,127.8],[40.3,128.6],[41.0,129.7],[42.0,130.4],[42.6,130.7],[42.9,132.5],[46,135],[46,110],[28,110],[28.0,121.2],[29.0,121.8],[30.0,122.3],[30.8,121.9],[31.4,121.8],[32.0,121.8],[33.0,120.9],[34.5,120.2],[35.5,119.6],[36.1,120.5],[36.7,121.3],[36.9,122.4],[37.4,122.6],[37.55,121.5],[37.7,120.5],[37.1,119.5],[37.6,118.9],[38.3,117.8],[39.0,118.0],[40.0,119.8],[40.5,121.0],[40.8,122.2],[40.0,121.9],[39.3,121.4],[38.75,121.15],[39.1,122.0],[39.7,123.0]],
  [[33.95,130.95],[33.62,130.35],[33.45,129.95],[33.2,129.6],[32.7,129.75],[32.5,130.2],[31.4,130.2],[31.0,130.7],[31.4,131.3],[32.5,131.7],[33.5,131.7],[33.85,131.1]],
  [[34.05,131.1],[34.25,131.8],[34.38,132.5],[34.48,133.3],[34.62,134.2],[34.70,135.1],[34.70,135.4],[34.3,135.15],[33.45,135.75],[33.7,136.5],[34.6,138],[36,141],[38,141],[38,139.5],[37.0,136.8],[36.2,136.1],[35.7,135.5],[35.55,134.5],[35.5,133.0],[34.8,131.9],[34.4,131.4]],
  [[34.15,132.9],[34.30,134.0],[34.25,134.6],[33.6,134.75],[33.25,134.2],[32.75,133.0],[33.0,132.4],[33.6,132.4]],
];
const ISLES = [[33.38, 126.55, 0.38, 0.17], [34.45, 129.32, 0.11, 0.3]];
const RIVALS = [
  { name: '한강상선', home: '마포', w: 4000, k: 0.92, sens: 0.3, noise: 0.006 },
  { name: '동남해운', home: '부산', w: 5000, k: 1.0, sens: 1.2, noise: 0.008 },
  { name: '서해물산', home: '인천', w: 3500, k: 0.97, sens: 0.5, noise: 0.016 },
];

/* ================= HELPERS ================= */
const won = n => (n < 0 ? '-' : '') + '₩' + Math.round(Math.abs(n)).toLocaleString('ko-KR');
const sgn = n => (n >= 0 ? '+' : '-') + '₩' + Math.round(Math.abs(n)).toLocaleString('ko-KR');
const nf = n => Math.round(n).toLocaleString('ko-KR');
function wonK(n) {
  const a = Math.abs(n), s = n < 0 ? '-₩' : '₩';
  if (a >= 1e8) return s + (a / 1e8).toFixed(2) + '억';
  if (a >= 1e6) return s + Math.round(a / 1e4).toLocaleString('ko-KR') + '만';
  if (a >= 1e5) return s + (a / 1e4).toFixed(1) + '만';
  return won(n);
}
const rnd = (a, b) => a + rand() * (b - a);
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const pick = a => a[Math.floor(rand() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const gauss = () => (rand() + rand() + rand() - 1.5) * 2;
const proj = (lat, lon) => [(lon - 119.5) * 80.9, (40.5 - lat) * 100];
function hav(a, b) {
  const R = 6371, t = Math.PI / 180, dLa = (b.lat - a.lat) * t, dLo = (b.lon - a.lon) * t;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function dateOf(d) { return new Date(Date.UTC(START_YEAR, 0, 1) + d * 864e5); }
function dateStr(d) { const t = dateOf(d); return `${t.getUTCFullYear()}.${String(t.getUTCMonth() + 1).padStart(2, '0')}.${String(t.getUTCDate()).padStart(2, '0')}`; }

const NODES = {};
for (const [id, p] of Object.entries(PORTS)) { const [x, y] = proj(p.lat, p.lon); NODES[id] = { lat: p.lat, lon: p.lon, x, y, port: true }; }
for (const [id, [lat, lon]] of Object.entries(WPS)) { const [x, y] = proj(lat, lon); NODES[id] = { lat, lon, x, y }; }
const ADJ = {};
for (const [a, b, t] of EDGES) {
  const d = hav(NODES[a], NODES[b]);
  (ADJ[a] = ADJ[a] || []).push({ to: b, t, d });
  (ADJ[b] = ADJ[b] || []).push({ to: a, t, d });
}

/* ================= STATE ================= */

const portOpen = id => PORTS[id].era <= S.era;
const goodOpen = g => GOODS[g].era <= S.era;
const T = sh => SHIPS[sh.type];
function okEdge(t, c) { return t === 'r' ? c.river : t === 'c' ? c.range >= 1 : (c.range >= 2 && S.era >= 3); }
const ROUTE_CACHE = {};
function routes(from, c) {
  const key = `${from}|${c.river ? 1 : 0}|${c.range}|${S.era}`;
  return ROUTE_CACHE[key] || (ROUTE_CACHE[key] = routesRaw(from, c));
}
function routesRaw(from, c) {
  const dist = { [from]: 0 }, prev = {}, done = new Set();
  for (;;) {
    let u = null, best = Infinity;
    for (const k in dist) if (!done.has(k) && dist[k] < best) { best = dist[k]; u = k; }
    if (u === null) break;
    done.add(u);
    for (const e of ADJ[u] || []) {
      if (!okEdge(e.t, c)) continue;
      if (PORTS[e.to] && !portOpen(e.to)) continue;
      const nd = best + e.d;
      if (dist[e.to] === undefined || nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; }
    }
  }
  return { dist, prev };
}
function pathOf(R, to) { const p = []; for (let n = to; n !== undefined; n = R.prev[n]) p.unshift(n); return p; }

/* ---- sea areas & weather ---- */
const EDGE_AREA = {};
for (const [a, b, t] of EDGES) {
  const A = NODES[a], B = NODES[b], la = (A.lat + B.lat) / 2, lo = (A.lon + B.lon) / 2;
  const area = t === 'r' ? 'river' : t === 'n' ? 'near' : lo < 126.9 ? 'west' : (la < 35.25 && lo < 129.25) ? 'south' : 'east';
  EDGE_AREA[a + '|' + b] = EDGE_AREA[b + '|' + a] = area;
}
function portArea(pid) { const e = (ADJ[pid] || []).find(e => e.t !== 'r') || ADJ[pid][0]; return EDGE_AREA[pid + '|' + e.to]; }
function season(m) { return (m === 11 || m <= 1) ? 'winter' : (m >= 6 && m <= 8) ? 'summer' : 'mild'; }
function wxProbs(area, m) {
  const sz = season(m);
  if (area === 'river') return sz === 'summer' ? [0.7, 0.25, 0.05, 0] : [0.85, 0.15, 0, 0];
  if (sz === 'winter') return area === 'south' ? [0.6, 0.25, 0.15, 0] : [0.45, 0.25, 0.3, 0];
  if (sz === 'summer') return area === 'near' || area === 'south' ? [0.5, 0.25, 0.13, 0.12] : [0.55, 0.25, 0.13, 0.07];
  return [0.7, 0.22, 0.08, 0];
}
function nextWx(area, prev, day) {
  const m = dateOf(day).getUTCMonth(), p = wxProbs(area, m);
  const a = mrand(), b = mrand(); let r = mrand(); // always draw three, so the stream never depends on the branch
  if (prev === 3 && a < 0.55) return 3;
  if (prev > 0 && b < 0.5 && p[prev] > 0) return prev; for (let i = 0; i < 4; i++) { if (r < p[i]) return i; r -= p[i]; } return 0;
}
const wxNow = (area, k = 0) => S.wx[area][Math.min(k, 2)];

/* ---- prices & costs ---- */
function fuelPrice(pid) {
  const P = PORTS[pid];
  let m = 1;
  if ((ADJ[pid] || []).every(e => e.t === 'r')) m = 1.15;
  if ((pid === 'ulsan' || pid === 'yeosu') && S.era >= 2) m = 0.82;
  if (P.era === 3) m = 1.05;
  return BASE_FUEL * oilLevel() * m;
}
function oilLevel() { return S.oil + S.oilShock; }
// 외상(운영자금) 한도: 선박 가치의 30%까지 연료를 외상으로 살 수 있다
function creditLine() { return S.ships.reduce((a, sh) => a + shipValue(sh), 0) * 0.3; }
const portFee = t => Math.round(5 + t.cap * 0.4);
const wage = sh => T(sh).wage * (1 + 0.03 * sh.age / 365) * (sh.mode === 'layup' ? 0.2 : 1);
const fullWage = sh => T(sh).wage * (1 + 0.03 * sh.age / 365);
function load(sh) { let u = 0; for (const c of sh.cons) u += c.q; for (const g in sh.cargo) u += sh.cargo[g].q; return u; }
const freeCap = sh => T(sh).cap - load(sh);
function typeCarries(t, g) { return !!t.cls && t.cls.includes(GOODS[g].cls); }
const canCarry = (sh, g) => typeCarries(T(sh), g);
const priceMul = () => 0.85 + 0.15 * S.idx;
const newPrice = t => t.price * priceMul();
function shipValue(sh) { return T(sh).price * Math.max(0.1, 1 - sh.age / 365 / 35) * priceMul() * 0.9; } // what a buyer pays today
// book value: depreciation only, no market swing — used for net worth, rank, eras and the goal,
// so a boom alone cannot win the game and unrealised price gains are never counted
function bookValue(sh) { return T(sh).price * Math.max(0.1, 1 - sh.age / 365 / 35) * 0.9; }
const usedPrice = L => SHIPS[L.type].price * Math.max(0.1, 1 - L.age / 35) * priceMul();
function netWorth() { let v = S.cash; for (const sh of S.ships) v += bookValue(sh) + (sh.fuel || 0) * BASE_FUEL; for (const o of S.orders) v += o.paid * 0.8; return v; }
function rankList() {
  const arr = [{ name: S.name, w: netWorth(), me: true }, ...S.rivals.map(r => ({ name: r.name, w: r.w }))];
  return arr.sort((a, b) => b.w - a.w);
}
const myRank = () => rankList().findIndex(r => r.me) + 1;

/* ---- voyage planning: simulate day by day on the forecast ---- */
function segsOf(path) {
  const segs = []; let at = 0;
  for (let i = 1; i < path.length; i++) { const e = ADJ[path[i - 1]].find(e => e.to === path[i]); segs.push({ from: at, to: at + e.d, area: EDGE_AREA[path[i - 1] + '|' + path[i]] }); at += e.d; }
  return segs;
}
const areaAt = (segs, km) => (segs.find(s => km < s.to) || segs[segs.length - 1]).area;
function dayStep(t, area, k, laden) {
  const w = wxNow(area, k);
  const spd = t.speed * (t.sail ? WX_SAIL[w] : WX_SPD[w]);
  const fuel = t.burn * WX_FUEL[w] * (laden ? 1 : 0.8);
  return { spd, fuel, w };
}
const PLAN_CACHE = {};
function plan(sh, to, extraQ = 0) {
  const t = T(sh), R = routes(sh.loc, t);
  if (R.dist[to] === undefined) return null;
  const key = `${sh.loc}|${t.river ? 1 : 0}|${t.range}|${S.era}>${to}`;
  const geo = PLAN_CACHE[key] || (PLAN_CACHE[key] = { path: pathOf(R, to), segs: segsOf(pathOf(R, to)) });
  const path = geo.path, segs = geo.segs, dist = R.dist[to];
  const laden = load(sh) + extraQ > 0;
  let done = 0, d = 0, fuel = 0, worst = 0;
  while (done < dist && d < 60) { const st = dayStep(t, areaAt(segs, done), d, laden); done += st.spd; fuel += st.fuel; worst = Math.max(worst, st.w); d++; }
  const fp = fuelPrice(sh.loc);
  const cost = fuel * fp + fullWage(sh) * d + portFee(t);
  return { path, segs, dist, days: d, fuel, worst, cost, fuelCost: fuel * fp };
}
function jobNet(sh, c) {
  const p = plan(sh, c.to, c.q); if (!p) return null;
  const pay = c.pay;
  return { ...p, pay, net: pay - p.cost, perDay: (pay - p.cost) / p.days };
}

function news(t) { S.news.unshift({ d: S.day, t }); if (S.news.length > 60) S.news.length = 60; }

/* ================= GAME SETUP ================= */
function newGame(name, home, seed) {
  S = { rs: (seed === undefined ? Math.floor(Math.random() * 2 ** 31) : seed) | 0 };
  S.ms = (S.rs ^ 0x5bd1e995) | 0;
  Object.assign(S, {
    v: SAVE_VERSION, seed: S.rs, name: name || '한국해운', home, day: 0, cash: 600, era: 1, idx: 1, shock: 0, phase: mrand() * 6.28, oil: 1, oilShock: 0,
    ships: [], seq: {}, sid: 1, uid: 1, contracts: [], cid: 1, used: [], orders: [], events: [], wx: {},
    rivals: RIVALS.map(r => ({ ...r })), news: [], hist: [], won: false, over: false, autoPause: true, tip: true,
    // company-wide ledger for reports and balance KPIs
    stats: { freight: 0, other: 0, fuel: 0, wage: 0, fees: 0, repair: 0, voyages: 0, ballast: 0, late: 0, delivered: 0, trips: 0, shipBuy: 0, shipSell: 0 },
  });
  for (const a in AREAS) { S.wx[a] = [0]; S.wx[a].push(nextWx(a, 0, 1)); S.wx[a].push(nextWx(a, S.wx[a][1], 2)); }
  addShip('ttak', home, 0);
  refreshUsed();
  for (let i = 0; i < 12; i++) genContract();
  for (let i = 0; i < 3; i++) genContract(home, 'ttak');
  // the first voyage must be possible: make sure the starting boat has at least one paying job at home
  const first = S.ships[0];
  for (let i = 0; i < 30 && !S.contracts.some(c => c.from === home && canCarry(first, c.good) && c.q <= T(first).cap && (jobNet(first, c) || { net: -1 }).net > 0); i++) genContract(home, 'ttak');
  news(`${S.name} 창업. ${PORTS[home].name} 나루에서 똑딱선 한 척으로 운송업을 시작합니다.`);
  S.hist.push(histPoint());
  return S;
}
function addShip(type, loc, ageDays) {
  const t = SHIPS[type]; S.seq[type] = (S.seq[type] || 0) + 1;
  const sh = { id: S.sid++, type, name: `${t.short} ${S.seq[type]}호`, age: ageDays || 0, loc, voy: null, cargo: {}, cons: [], mode: 'idle', busy: 0, fuel: t.tank, earn: 0, spend: 0 };
  S.ships.push(sh); return sh;
}
function deliveryPort(t) { return t.river ? S.home : (S.home === 'mapo' ? 'incheon' : 'busan'); }
function refreshUsed() {
  const types = Object.keys(SHIPS).filter(k => SHIPS[k].era <= S.era);
  S.used = [];
  for (let i = 0; i < 4; i++) {
    const type = pick(types), t = SHIPS[type];
    const ports = Object.keys(PORTS).filter(p => portOpen(p) && (ADJ[p] || []).some(e => okEdge(e.t, t)));
    if (!ports.length) continue;
    S.used.push({ type, age: rint(3, 25), loc: pick(ports), id: 'u' + (S.uid++) });
  }
}
// 운송 의뢰: 어떤 크기의 배가 실을 만한지 먼저 정하고, 그 배가 갈 수 있는 목적지를 고른다
function genContract(forceFrom, forceType) {
  const open = Object.keys(PORTS).filter(portOpen);
  const cargoTypes = Object.entries(SHIPS).filter(([k, t]) => t.role === 'cargo' && t.era <= S.era);
  for (let tries = 0; tries < 10; tries++) {
    const [tk, t] = forceType ? [forceType, SHIPS[forceType]] : cargoTypes[Math.floor(Math.pow(rand(), 1.6) * cargoTypes.length)];
    const starts = open.filter(p => (ADJ[p] || []).some(e => okEdge(e.t, t)));
    // cargo starts mostly at big ports (weight = size²), so small ports are often one-way trips
    const from = forceFrom || pick(starts.flatMap(p => Array(PORTS[p].size * PORTS[p].size).fill(p)));
    const P = PORTS[from];
    const gs = Object.keys(GOODS).filter(g => goodOpen(g) && typeCarries(t, g));
    if (!gs.length) continue;
    const prod = P.prod.filter(g => gs.includes(g));
    const g = prod.length && rand() < 0.7 ? pick(prod) : pick(gs);
    const R = routes(from, t);
    const cands = open.filter(p => p !== from && R.dist[p] !== undefined);
    if (!cands.length) continue;
    const dem = cands.filter(p => PORTS[p].dem.includes(g));
    const to = dem.length && rand() < 0.75 ? pick(dem) : pick(cands);
    const km = R.dist[to];
    const q = Math.max(3, Math.round(t.cap * rnd(0.35, 1)));
    const boom = S.events.some(e => e.port === from) ? 1.4 : 1;
    // big lots pay less per ton (economies of scale): 10t → ×1.0, 100t → ×0.89, 1,000t → ×0.79
    const pay = Math.round(q * GOODS[g].rate * (14 + 0.06 * km) * Math.pow(q / 10, -0.05) * S.idx * boom * rnd(0.85, 1.2) / 5) * 5;
    const due = Math.ceil(km / (t.speed * 0.75)) + (GOODS[g].fresh ? 1 : 4);
    S.contracts.push({ id: S.cid++, from, to, good: g, q, km: Math.round(km), pay, due, offer: S.day + rint(5, 11), size: tk });
    return;
  }
}

/* ================= ACTIONS =================
   Every action checks its own rules (the screen only hides buttons) and returns true when it happened. */
const docked = sh => !!sh && !!sh.loc && !sh.voy;
const canOperate = sh => docked(sh) && (sh.mode === 'idle' || sh.mode === 'tour' || sh.mode === 'bunker');
function isValidSave(o) { return !!o && o.v === SAVE_VERSION && typeof o.rs === 'number' && typeof o.ms === 'number' && Array.isArray(o.ships) && !!o.stats; }
function doRefuel(sh, frac) {
  if (!docked(sh) || !T(sh).tank) return false;
  const t = T(sh), want = Math.max(0, t.tank * frac - sh.fuel), price = fuelPrice(sh.loc);
  if (want <= 0.001) return false;
  const q = Math.min(want, Math.max(0, S.cash + creditLine()) / price);
  if (q <= 0.001) { HOOK.toast('현금과 외상 한도가 모두 바닥났습니다. 배를 팔거나 계선하세요'); return false; }
  S.cash -= q * price; sh.fuel += q; sh.spend += q * price; S.stats.fuel += q * price;
  HOOK.toast(`${sh.name} 연료 ${q.toFixed(2)}t 보충 ${won(q * price)}`); HOOK.sound('click');
  return true;
}
function doLoad(cid, sh) {
  if (!canOperate(sh) || T(sh).role !== 'cargo') return false;
  const i = S.contracts.findIndex(c => c.id === cid); if (i < 0) return false;
  const c = S.contracts[i];
  if (sh.loc !== c.from || freeCap(sh) < c.q || !canCarry(sh, c.good)) return false;
  S.contracts.splice(i, 1);
  sh.cons.push({ ...c, deadline: S.day + c.due });
  HOOK.sound('click'); HOOK.toast(`${GOODS[c.good].name} ${c.q}t 선적 → ${PORTS[c.to].name} · 운임 ${won(c.pay)}`);
  return true;
}
function doUnload(cid, sh) {
  if (!docked(sh)) return false;
  const i = sh.cons.findIndex(c => c.id === cid); if (i < 0) return false;
  const [c] = sh.cons.splice(i, 1);
  if (c.offer >= S.day) S.contracts.push(c);
  HOOK.toast(`${GOODS[c.good].name} ${c.q}t 하역 (의뢰 반납)`);
  return true;
}
function doSail(sh, to) {
  if (!canOperate(sh) || to === sh.loc || !PORTS[to]) return false;
  const p = plan(sh, to); if (!p) return false;
  if (T(sh).burn && sh.fuel + 1e-6 < p.fuel) { HOOK.toast(`연료가 모자랍니다. 예상 ${p.fuel.toFixed(2)}t 필요, 남은 연료 ${sh.fuel.toFixed(2)}t`); return false; }
  S.cash -= portFee(T(sh)); sh.spend += portFee(T(sh)); S.stats.fees += portFee(T(sh)); S.stats.voyages++; if (!load(sh)) S.stats.ballast++;
  sh.voy = { from: sh.loc, to, path: p.path, segs: p.segs, dist: p.dist, done: 0, dep: S.day, next: 0, eta: p.days,
    // per-voyage account for the settlement card
    fee: portFee(T(sh)), fp: fuelPrice(sh.loc), fuelUsed: 0, emFuel: 0, wage: 0, extra: 0, laden: load(sh) > 0 };
  sh.voy.next = dayStep(T(sh), areaAt(p.segs, 0), 0, load(sh) > 0).spd;
  sh.loc = null; sh.mode = 'idle';
  HOOK.toast(`${sh.name} 출항 → ${PORTS[to].name} (예상 ${p.days}일)`); HOOK.sound('horn');
  HOOK.sailed(sh);
  return true;
}
function doFish(sh) {
  if (!canOperate(sh) || T(sh).role !== 'fish' || !PORTS[sh.loc].fish) return false;
  const need = T(sh).burn * 3 * WX_FUEL[wxNow(portArea(sh.loc))];
  if (sh.fuel < need) { HOOK.toast('조업 나갈 연료가 모자랍니다'); return false; }
  sh.mode = 'fishing'; sh.busy = S.day + 3;
  HOOK.toast(`${sh.name} 조업 출항 (3일)`); HOOK.sound('horn');
  HOOK.sailed(sh);
  return true;
}
function doLayup(sh) {
  if (!canOperate(sh) || sh.cons.length) return false;
  sh.mode = 'layup'; HOOK.toast(`${sh.name} 계선(휴업). 고정비가 ${won(fullWage(sh))} → ${won(wage(sh))}/일로 줄어듭니다`);
  return true;
}
function doReactivate(sh) {
  const fee = fullWage(sh) * 5;
  if (!docked(sh) || sh.mode !== 'layup' || S.cash < fee) return false;
  S.cash -= fee; sh.spend += fee; S.stats.fees += fee; sh.mode = 'react'; sh.busy = S.day + 2;
  HOOK.toast(`${sh.name} 재가동 시작 · ${won(fee)} · 2일 뒤 운항 가능`);
  return true;
}
function doOrder(type) {
  const t = SHIPS[type]; if (!t || t.era > S.era) return false;
  const cost = newPrice(t);
  if (S.cash < cost) return false;
  S.cash -= cost; S.stats.shipBuy += cost;
  S.orders.push({ type, ready: S.day + t.build, port: deliveryPort(t), paid: cost });
  HOOK.toast(`${t.name} 발주 완료. ${t.build}일 뒤 ${PORTS[deliveryPort(t)].name}에서 인도`); HOOK.sound('click');
  return true;
}
function doBuyUsed(id) {
  const i = S.used.findIndex(u => u.id === id); if (i < 0) return false;
  const L = S.used[i], cost = usedPrice(L);
  if (S.cash < cost) return false;
  S.cash -= cost; S.stats.shipBuy += cost; S.used.splice(i, 1);
  const sh = addShip(L.type, L.loc, L.age * 365); sh.fuel = SHIPS[L.type].tank * 0.3;
  HOOK.toast(`${sh.name} 매입 (${L.age}년 된 중고선, ${PORTS[L.loc].name})`);
  return true;
}
function doSellShip(sh) {
  if (!docked(sh) || sh.cons.length || sh.mode === 'fishing' || sh.mode === 'react') return false;
  const v = shipValue(sh);
  S.cash += v; S.stats.shipSell += v; S.ships = S.ships.filter(x => x !== sh);
  HOOK.toast(`${sh.name} 매각 ${won(v)}`);
  return true;
}

/* ================= DAILY TICK ================= */
function histPoint() { return { d: S.day, me: netWorth(), r: S.rivals.map(r => r.w) }; }
function voyProg(sh, t = S.day) { const v = sh.voy; return clamp((v.done + v.next * clamp(t - S.day, 0, 1)) / v.dist, 0, 1); }
function tick() {
  S.day++;
  // weather: shift the 3-day forecast
  for (const a in S.wx) {
    const w = S.wx[a], before = w[0]; w.shift(); w.push(nextWx(a, w[w.length - 1], S.day + 2));
    if (w[0] === 3 && before !== 3 && a !== 'river') news(`${AREAS[a]}에 태풍 — 항해 중인 배가 느려지고 연료를 많이 씁니다`);
  }
  // markets: freight index (2-year cycle) and oil price (random walk + rare shocks)
  S.shock = S.shock * 0.97 + mgauss() * 0.025;
  S.idx = clamp(1 + 0.3 * Math.sin(2 * Math.PI * S.day / 720 + S.phase) + S.shock, 0.55, 1.6);
  S.oilShock *= 0.985;
  const oilDraw = mrand();
  // oil shocks come from outside, whatever era the company is in
  if (oilDraw < 0.0015) { S.oilShock += 0.8; news('중동 정세 불안 — 국제 유가 급등'); HOOK.toast('유가 급등! 기름값이 크게 올랐습니다'); }
  S.oil = clamp(S.oil + (1 - S.oil) * 0.02 + mgauss() * 0.018, 0.6, 1.6);
  S.events = S.events.filter(e => e.until > S.day);
  const evDraw = mrand(), evPort = Object.keys(PORTS)[Math.floor(mrand() * Object.keys(PORTS).length)], evLen = 12 + Math.floor(mrand() * 14);
  if (evDraw < 0.02 && portOpen(evPort)) {
    const p = evPort;
    S.events.push({ port: p, until: S.day + evLen });
    news(`${PORTS[p].name} 물동량 급증 — 그 항구에서 나가는 운임이 오릅니다`);
  }
  // ships
  const tourCount = {}, bunkCount = {};
  for (const sh of S.ships) if (sh.loc && sh.mode === 'tour') tourCount[sh.loc] = (tourCount[sh.loc] || 0) + 1;
  for (const sh of S.ships) if (sh.loc && sh.mode === 'bunker') bunkCount[sh.loc] = (bunkCount[sh.loc] || 0) + 1;
  let arrived = false;
  for (const sh of S.ships) {
    const t = T(sh);
    sh.age++;
    S.cash -= wage(sh); sh.spend += wage(sh); S.stats.wage += wage(sh); if (sh.voy) sh.voy.wage += wage(sh);
    if (sh.loc && sh.mode === 'tour') { const v = (PORTS[sh.loc].tour || 0) * 60 * (0.7 + 0.3 * S.idx) / tourCount[sh.loc]; S.cash += v; sh.earn += v; S.stats.other += v; }
    if (sh.loc && sh.mode === 'bunker') { const v = (PORTS[sh.loc].traffic || 0) * 260 * S.idx * oilLevel() / bunkCount[sh.loc]; S.cash += v; sh.earn += v; S.stats.other += v; }
    if (sh.mode === 'react' && S.day >= sh.busy) { sh.mode = 'idle'; news(`${sh.name} 재가동 완료`); }
    if (sh.mode === 'fishing') {
      sh.fuel = Math.max(0, sh.fuel - t.burn * WX_FUEL[wxNow(portArea(sh.loc))]);
      if (S.day >= sh.busy) {
        const q = rint(4, 8), rev = q * 70 * rnd(0.85, 1.2) * (0.85 + 0.15 * S.idx);
        S.cash += rev; sh.earn += rev; S.stats.other += rev; sh.mode = 'idle';
        news(`${sh.name} 조업 귀항 — 생선 ${q}t 위판 ${won(rev)}`); HOOK.toast(`${sh.name} 귀항: 생선 ${q}t → ${won(rev)}`); HOOK.sound('coin');
        arrived = true;
      }
    }
    if (sh.voy) {
      const v = sh.voy, st = dayStep(t, areaAt(v.segs, v.done), 0, load(sh) > 0);
      let spd = st.spd;
      if (t.burn) {
        if (sh.fuel < st.fuel) {
          const tow = st.fuel * fuelPrice(v.to) * 4 + fullWage(sh) * 3;
          S.cash -= tow; sh.spend += tow; S.stats.fuel += tow; v.extra += tow; v.emFuel += st.fuel - sh.fuel; sh.fuel = st.fuel; spd *= 0.4;
          news(`${sh.name} 연료 고갈 — 긴급 급유·예인 ${won(tow)}`); HOOK.toast(`${sh.name} 연료 고갈! 긴급 급유 비용 ${won(tow)}`);
        }
        sh.fuel = Math.max(0, sh.fuel - st.fuel); v.fuelUsed += st.fuel;
      }
      if (st.w === 3 && rand() < 0.06) { const dmg = t.price * 0.02; S.cash -= dmg; sh.spend += dmg; S.stats.repair += dmg; v.extra += dmg; news(`${sh.name} 태풍 피해 — 수리비 ${won(dmg)}`); }
      v.done += spd;
      if (v.done >= v.dist) {
        sh.loc = v.to; sh.voy = null;
        let msg = `${sh.name} ${PORTS[sh.loc].name} 도착`, got = 0, lateN = 0, jobs = 0;
        const keep = [];
        for (const c of sh.cons) {
          if (c.to === sh.loc) { const late = S.day > c.deadline, pay = late ? c.pay / 2 : c.pay; S.cash += pay; sh.earn += pay; S.stats.freight += pay; S.stats.delivered++; if (late) { S.stats.late++; lateN++; } jobs++; got += pay; if (late) msg += ' · 기한 초과로 운임 절반'; }
          else keep.push(c);
        }
        sh.cons = keep;
        if (got) { msg += ` · 운임 ${won(got)}`; HOOK.sound('coin'); } else HOOK.sound('bell');
        const fuelCost = (v.fuelUsed - v.emFuel) * v.fp;
        const trip = { ship: sh.id, from: v.from, to: v.to, days: S.day - v.dep, jobs, late: lateN, freight: got, fee: v.fee, fuelT: v.fuelUsed, fuelCost, wage: v.wage, extra: v.extra };
        trip.net = trip.freight - trip.fee - trip.fuelCost - trip.wage - trip.extra;
        sh.lastTrip = trip; S.stats.trips++;
        news(msg); arrived = true;
        HOOK.trip(sh, trip, msg);
      } else v.next = dayStep(t, areaAt(v.segs, v.done), 1, load(sh) > 0).spd;
    }
  }
  if (S.cash < 0) S.cash *= 1.001;
  for (const o of S.orders.filter(o => o.ready <= S.day)) {
    const sh = addShip(o.type, o.port, 0);
    news(`신조선 ${sh.name} 인도 (${PORTS[o.port].name})`); HOOK.toast(`신조선 ${sh.name} 인도!`);
  }
  S.orders = S.orders.filter(o => o.ready > S.day);
  // freight jobs: expire, rivals take some, new ones appear
  S.contracts = S.contracts.filter(c => {
    if (c.offer < S.day) return false;
    if (rand() < 0.03) { const r = pick(S.rivals); if (rand() < 0.3) news(`${r.name}이(가) ${PORTS[c.from].name}→${PORTS[c.to].name} ${GOODS[c.good].name} 화물을 가져갔습니다`); return false; }
    return true;
  });
  const growth = Math.min(2.5, 1 + S.day / 500); // 경제 성장으로 물동량이 늘어난다
  const volume = clamp(S.idx, 0.6, 1.4); // a slump means less cargo, not just cheaper cargo
  const want = [0, 34, 60, 90][S.era] * growth * volume;
  for (let k = 0; k < [0, 7, 11, 15][S.era] * growth * volume; k++) if (S.contracts.length < want && rand() < 0.8) genContract();
  // keep a little work around wherever my ships wait
  for (const sh of S.ships) if (sh.loc && !sh.voy && T(sh).role === 'cargo' && rand() < 0.15 && !S.contracts.some(c => c.from === sh.loc && c.q <= T(sh).cap && canCarry(sh, c.good))) genContract(sh.loc, sh.type);
  if (S.day % 30 === 0) refreshUsed();
  for (const r of S.rivals) {
    const g = 0.016 * Math.pow(5000 / r.w, 0.3) * r.k * (1 + r.sens * (S.idx - 1)) - 0.004 * (oilLevel() - 1) + mgauss() * r.noise;
    r.w = Math.max(500, r.w * (1 + g));
  }
  const nw = netWorth();
  if (S.era < 3 && nw >= ERA[S.era + 1].need) {
    S.era++; HOOK.sound('fanfare');
    news(`${ERA[S.era].name} 개막`);
    for (const p in PORTS) if (PORTS[p].era === S.era) news(`${PORTS[p].name} 항로 개설`);
    refreshUsed(); HOOK.pause(); HOOK.era();
  }
  if (S.day % 5 === 0) { S.hist.push(histPoint()); if (S.hist.length > 500) S.hist.splice(0, S.hist.length - 500); }
  if (!S.won && nw >= GOAL && myRank() === 1) { S.won = true; HOOK.pause(); HOOK.win(); }
  if (nw < 0 && !S.over) { S.over = true; HOOK.pause(); HOOK.over(); }
  if (arrived && S.autoPause) HOOK.pause();
  if (S.day % 5 === 0) HOOK.save();
}

