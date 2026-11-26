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
const START_YEAR = 1955, GOAL = 1000000, SAVE_KEY = 'shipking-proto-v5', SAVE_VERSION = 5;
const ERA = [null,
  { name: '강의 시대', need: 0 },
  { name: '연안의 시대', need: 25000 },
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
// 회사 등급: 화주 신뢰와 배달 실적으로 오르고, 등급이 보유 선대(발주 포함)의 한도를 정한다
const GRADES = [null,
  { name: '나루 상회', fleet: 2, need: 0, trust: 0 },
  { name: '연안 해운', fleet: 3, need: 8, trust: 52 },
  { name: '해운 회사', fleet: 5, need: 25, trust: 55 },
  { name: '중견 선사', fleet: 8, need: 60, trust: 58 },
  { name: '대형 선사', fleet: 14, need: 150, trust: 60 },
  { name: '해운 그룹', fleet: 40, need: 350, trust: 62 },
];
// 선장 3종. 급여는 배 고정비의 3%, 고용비는 고정비 8일치
const CAPTAINS = {
  eco: { name: '연비형', skill: '기관 관리', desc: '연료 소모 40% 감소' },
  storm: { name: '악천후형', skill: '황천 항해', desc: '강풍·태풍 때 느려지는 정도와 추가 연료가 절반, 태풍 피해 확률 절반' },
  swift: { name: '납기형', skill: '항로 단축', desc: '속도 12% 증가 (하루 연료는 5% 더) · 3일 넘는 항로에서 효과' },
};
const CAPT_FX = { eco: 0.6, swift: 1.12, swiftFuel: 1.05 }; // tuned by tests/balance.js
const CAP_NAMES = [['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오'], ['도윤', '만석', '덕수', '영철', '순돌', '병철', '상훈', '기수', '춘식', '태호', '봉구', '창수']];
// 의뢰 종류. 단기·장거리는 거리로 나뉘는 일반 의뢰, 긴급·정기는 화주 신뢰가 쌓이면 열린다
const KINDS = {
  short: { name: '단기 연안' }, long: { name: '장거리 대량' },
  urgent: { name: '긴급', trust: 55 }, regular: { name: '정기 운송', trust: 65 }, tender: { name: '입찰 화물' },
};
const TRUST0 = 50, TENDER_EVERY = 28, TENDER_DAYS = 28, BID_MUL = { low: 0.9, mid: 1, high: 1.15 }, BID_SCORE = { low: 1.25, mid: 1, high: 0.75 };
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
const fullWage = sh => T(sh).wage * (1 + 0.03 * sh.age / 365);
const capWage = sh => sh.capt ? fullWage(sh) * 0.03 : 0;
const capFee = sh => Math.round(fullWage(sh) * 8);
const wage = sh => fullWage(sh) * (sh.mode === 'layup' ? 0.2 : 1) + capWage(sh);
const dayCost = sh => fullWage(sh) + capWage(sh); // a working day: crew + captain
// 선체 상태(내구도) 0~100: 낮을수록 연료를 더 쓰고(100→60이면 +16%), 40 아래에서는 고장이 나고, 20 아래면 정비소가 있는 항구로만 갈 수 있다
const condFuel = sh => 1 + (100 - (sh.cond ?? 100)) / 100 * 0.4;
const yardAt = pid => PORTS[pid].size >= 2 || pid === S.home;
const repairCost = sh => Math.round(T(sh).price * (100 - sh.cond) / 100 * 0.12);
const repairDays = sh => Math.max(1, Math.ceil((100 - sh.cond) / 15));
const fleetCount = () => S.ships.length + S.orders.length;
const fleetLimit = () => GRADES[S.grade].fleet;
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
// one sailing day on the forecast. With the ship given, its captain and hull condition count;
// base = the same day without the captain, for the settlement card
function dayStep(t, area, k, laden, sh) {
  const w = wxNow(area, k), c = sh && sh.capt ? sh.capt.kind : null;
  let sm = t.sail ? WX_SAIL[w] : WX_SPD[w], fm = WX_FUEL[w];
  const base = { spd: t.speed * sm, fuel: t.burn * fm * (laden ? 1 : 0.8) * (sh ? condFuel(sh) : 1) };
  if (c === 'storm' && w >= 2) { sm = 1 - (1 - sm) / 2; fm = 1 + (fm - 1) / 2; }
  const spd = t.speed * sm * (c === 'swift' ? CAPT_FX.swift : 1);
  const fuel = t.burn * fm * (laden ? 1 : 0.8) * (c === 'eco' ? CAPT_FX.eco : c === 'swift' ? CAPT_FX.swiftFuel : 1) * (sh ? condFuel(sh) : 1);
  return { spd, fuel, w, base };
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
  while (done < dist && d < 60) { const st = dayStep(t, areaAt(segs, done), d, laden, sh); done += st.spd; fuel += st.fuel; worst = Math.max(worst, st.w); d++; }
  const fp = fuelPrice(sh.loc);
  const cost = fuel * fp + dayCost(sh) * d + portFee(t);
  return { path, segs, dist, days: d, fuel, worst, cost, fuelCost: fuel * fp };
}
// how much of a job this ship would take: tender cargo can be split, other jobs go whole
const lotQ = (sh, c) => c.kind === 'tender' ? Math.min(c.q, freeCap(sh)) : c.q;
const lotPay = (sh, c) => c.kind === 'tender' ? Math.round(lotQ(sh, c) * c.rate) : c.pay;
const fits = (sh, c) => c.kind === 'tender' ? freeCap(sh) > 0 && c.q > 0 : c.q <= freeCap(sh);
function jobNet(sh, c) {
  const q = lotQ(sh, c); if (q <= 0) return null;
  const p = plan(sh, c.to, q); if (!p) return null;
  const pay = lotPay(sh, c);
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
    trust: TRUST0, grade: 1, capPool: [], kid: 1, tender: null, tenders: 0, autoOK: false, seen: {},
    // company-wide ledger for reports and balance KPIs
    stats: { freight: 0, other: 0, fuel: 0, wage: 0, fees: 0, repair: 0, voyages: 0, ballast: 0, late: 0, delivered: 0, trips: 0, shipBuy: 0, shipSell: 0, hire: 0, capSave: 0, tenderWon: 0, tenderLost: 0, tenderDone: 0, tenderFail: 0, penalty: 0 },
  });
  for (const a in AREAS) { S.wx[a] = [0]; S.wx[a].push(nextWx(a, 0, 1)); S.wx[a].push(nextWx(a, S.wx[a][1], 2)); }
  addShip('ttak', home, 0);
  refreshUsed(); refreshCaptains();
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
  const sh = { id: S.sid++, type, name: `${t.short} ${S.seq[type]}호`, age: ageDays || 0, loc, voy: null, cargo: {}, cons: [], mode: 'idle', busy: 0, fuel: t.tank, earn: 0, spend: 0,
    cond: Math.max(55, 100 - Math.round((ageDays || 0) / 365 * 1.5)), capt: null, route: null, wait: 0 };
  S.ships.push(sh); return sh;
}
function refreshCaptains() {
  S.capPool = [];
  const kinds = Object.keys(CAPTAINS);
  for (let i = 0; i < 3; i++) S.capPool.push({ id: 'k' + (S.kid++), name: pick(CAP_NAMES[0]) + pick(CAP_NAMES[1]), kind: kinds[i] });
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
    const base = q * GOODS[g].rate * (14 + 0.06 * km) * Math.pow(q / 10, -0.05) * rnd(0.85, 1.2) * trustMul();
    let pay = Math.round(base * S.idx * boom / 5) * 5;
    let due = Math.ceil(km / (t.speed * 0.75)) + (GOODS[g].fresh ? 1 : 4);
    let kind = km <= 250 ? 'short' : 'long', offer = S.day + rint(5, 11), legs = 0;
    const roll = rand();
    // 긴급: 운임 1.6배, 기한이 빠듯하다. 정기: 시황과 무관한 고정 운임으로 같은 구간 4회
    if (S.trust >= KINDS.urgent.trust && roll < 0.12) { kind = 'urgent'; pay = Math.round(pay * 1.35 / 5) * 5; due = Math.ceil(km / (t.speed * 0.95)) + 1; }
    else if (S.trust >= KINDS.regular.trust && roll < 0.18 && !forceFrom) { kind = 'regular'; pay = Math.round(base * 1.05 / 5) * 5; legs = 4; offer = S.day + 20; }
    S.contracts.push({ id: S.cid++, from, to, good: g, q, km: Math.round(km), pay, due, offer, size: tk, kind, legs });
    return;
  }
}

const trustMul = () => 0.95 + S.trust / 1000; // trust 50 → ×1.0, 100 → ×1.05
function addTrust(d, why) {
  const before = S.trust;
  // gains shrink as trust rises (at 50 half a point a job, at 75 a quarter, at 100 none); losses always count in full
  S.trust = clamp(S.trust + (d > 0 ? d * (100 - S.trust) / 100 : d), 0, 100);
  if (Math.floor(before / 5) !== Math.floor(S.trust / 5) && why) news(`화주 신뢰 ${Math.round(S.trust)} (${why})`);
}
function checkGrade() {
  const n = GRADES[S.grade + 1];
  if (n && S.stats.delivered >= n.need && S.trust >= n.trust) {
    S.grade++; news(`회사 등급 상승: ${GRADES[S.grade].name} · 선대 한도 ${GRADES[S.grade].fleet}척`);
    HOOK.toast(`회사 등급 상승! ${GRADES[S.grade].name} · 이제 배를 ${GRADES[S.grade].fleet}척까지 가질 수 있습니다`); HOOK.sound('fanfare');
  }
}

/* ---- 28일 입찰: 대형 화주가 한 구간의 큰 물량을 맡길 회사를 고른다 ---- */
// how much of the lot my fleet could move inside the window, with ships that can make the trip
function tenderCapacity(T0) {
  let cap = 0;
  for (const sh of S.ships) {
    const t = T(sh);
    if (t.role !== 'cargo' || !typeCarries(t, T0.good) || sh.mode === 'layup') continue;
    const R = routes(T0.from, t); if (R.dist[T0.to] === undefined) continue;
    const leg = Math.ceil(R.dist[T0.to] / t.speed) + 1;
    cap += t.cap * Math.max(1, Math.floor(TENDER_DAYS / (2 * leg)));
  }
  for (const o of S.orders) { const t = SHIPS[o.type]; if (o.ready <= T0.close + 7 && t.role === 'cargo' && typeCarries(t, T0.good) && routes(T0.from, t).dist[T0.to] !== undefined) cap += t.cap; }
  return cap;
}
function tenderScore(T0, bid) { return (S.trust / 60) * Math.pow(clamp(tenderCapacity(T0) / T0.q, 0, 1.2), 1.5) * BID_SCORE[bid]; }
// a rough read of the odds for the screen and the bots
function tenderOdds(T0, bid) { const s = tenderScore(T0, bid); return s > 1.25 ? 'high' : s > 0.95 ? 'mid' : 'low'; }
function newTender(r1, r2) {
  const cargo = S.ships.filter(sh => T(sh).role === 'cargo');
  if (!cargo.length) return null;
  const t = T(cargo.reduce((a, b) => T(b).cap > T(a).cap ? b : a));
  const froms = Object.keys(PORTS).filter(p => portOpen(p) && PORTS[p].size >= 2 && (ADJ[p] || []).some(e => okEdge(e.t, t)));
  if (!froms.length) return null;
  const from = froms[Math.floor(r1 * froms.length)], R = routes(from, t);
  const tos = Object.keys(R.dist).filter(p => PORTS[p] && p !== from && R.dist[p] >= 60 && R.dist[p] <= 1200);
  if (!tos.length) return null;
  const to = tos[Math.floor(r2 * tos.length)], km = R.dist[to];
  const gs = Object.keys(GOODS).filter(g => goodOpen(g) && typeCarries(t, g));
  const good = gs.find(g => PORTS[from].prod.includes(g)) || gs[0];
  const leg = Math.ceil(km / t.speed) + 1, trips = Math.max(1, Math.floor(TENDER_DAYS / (2 * leg)));
  const q = Math.round(t.cap * trips * 1.4);
  const rate = GOODS[good].rate * (14 + 0.06 * km) * Math.pow(Math.min(q, t.cap) / 10, -0.05) * 1.05;
  const shipper = pick(['대한제분', '삼양염업', '동양시멘트', '한일목재', '남선물산', '경일수산']);
  return { id: ++S.tenders, shipper, from, to, good, q, km: Math.round(km), rate, open: S.day, close: S.day + 5, bid: null, state: 'open', due: 0, delivered: 0 };
}
function tenderDaily(draws) {
  const Tn = S.tender;
  if (S.day > 0 && S.day % TENDER_EVERY === 0 && (!Tn || Tn.state === 'lost' || Tn.state === 'done' || Tn.state === 'failed' || Tn.state === 'skip')) {
    const nt = newTender(draws[0], draws[1]);
    if (nt) { nt.rival = 0.7 + draws[2] * 0.5; S.tender = nt; news(`입찰 공고: ${nt.shipper} ${GOODS[nt.good].name} ${nf(nt.q)}t ${PORTS[nt.from].name}→${PORTS[nt.to].name} · ${TENDER_DAYS}일 안에 · 마감 ${dateStr(nt.close)}`); HOOK.toast(`입찰 공고! ${nt.shipper} ${nf(nt.q)}t · 거래소에서 응찰하세요`); }
    return;
  }
  if (!Tn) return;
  if (Tn.state === 'open' && S.day >= Tn.close) {
    if (!Tn.bid) { Tn.state = 'skip'; return; }
    const mine = tenderScore(Tn, Tn.bid);
    if (mine > Tn.rival) {
      Tn.state = 'won'; Tn.due = S.day + TENDER_DAYS; Tn.rate *= BID_MUL[Tn.bid]; S.stats.tenderWon++;
      S.contracts.push({ id: S.cid++, from: Tn.from, to: Tn.to, good: Tn.good, q: Tn.q, km: Tn.km, pay: Math.round(Tn.q * Tn.rate), rate: Tn.rate, due: TENDER_DAYS, deadline: Tn.due, offer: Tn.due, size: null, kind: 'tender', legs: 0, tid: Tn.id });
      news(`입찰 낙찰! ${Tn.shipper} ${nf(Tn.q)}t를 ${dateStr(Tn.due)}까지 ${PORTS[Tn.to].name}로`); HOOK.toast(`입찰 낙찰! ${PORTS[Tn.from].name}에서 입찰 화물을 실어 나르세요`); HOOK.sound('fanfare');
    } else {
      Tn.state = 'lost'; S.stats.tenderLost++;
      const r = S.rivals[Math.floor(draws[3] * S.rivals.length)];
      news(`입찰 탈락: ${Tn.shipper} 물량은 ${r.name}이(가) 가져갔습니다`); HOOK.toast(`입찰 탈락 — ${r.name} 낙찰. 배를 늘리고 신뢰를 쌓으면 이길 수 있습니다`);
    }
    return;
  }
  if (Tn.state === 'won' && S.day > Tn.due) {
    const left = Tn.q - Tn.delivered, pen = Math.round(left * Tn.rate * 0.15);
    S.cash -= pen; S.stats.penalty += pen; S.stats.tenderFail++; Tn.state = 'failed';
    S.contracts = S.contracts.filter(c => c.tid !== Tn.id);
    addTrust(-15, '입찰 물량 미달');
    news(`입찰 계약 미이행: ${nf(left)}t 못 나름 · 위약금 ${won(pen)}`); HOOK.toast(`입찰 계약 기한 초과 — 위약금 ${won(pen)}, 신뢰 하락`);
  }
}
function tenderDelivered(c) {
  const Tn = S.tender; if (!Tn || Tn.id !== c.tid || Tn.state !== 'won') return;
  Tn.delivered += c.q;
  if (Tn.delivered >= Tn.q - 1e-6) {
    Tn.state = 'done'; S.stats.tenderDone++; addTrust(8, '입찰 계약 완수');
    news(`입찰 계약 완수: ${Tn.shipper} ${nf(Tn.q)}t`);
    if (!S.autoOK) { S.autoOK = true; news('자동 항로 해금 — 선대 관리에서 배마다 두 항구를 오가는 정기 항로를 맡길 수 있습니다'); HOOK.toast('입찰 완수! 자동 항로가 열렸습니다'); HOOK.sound('fanfare'); }
  }
}

/* ================= ACTIONS =================
   Every action checks its own rules (the screen only hides buttons) and returns true when it happened. */
const docked = sh => !!sh && !!sh.loc && !sh.voy;
const canOperate = sh => docked(sh) && (sh.mode === 'idle' || sh.mode === 'tour' || sh.mode === 'bunker');
const say = (quiet, t) => { if (!quiet) HOOK.toast(t); };
function isValidSave(o) { return !!o && o.v === SAVE_VERSION && typeof o.rs === 'number' && typeof o.ms === 'number' && Array.isArray(o.ships) && !!o.stats; }
function doRefuel(sh, frac, quiet) {
  if (!docked(sh) || !T(sh).tank) return false;
  const t = T(sh), want = Math.max(0, t.tank * frac - sh.fuel), price = fuelPrice(sh.loc);
  if (want <= 0.001) return false;
  const q = Math.min(want, Math.max(0, S.cash + creditLine()) / price);
  if (q <= 0.001) { HOOK.toast('현금과 외상 한도가 모두 바닥났습니다. 배를 팔거나 계선하세요'); return false; }
  S.cash -= q * price; sh.fuel += q; sh.spend += q * price; S.stats.fuel += q * price;
  if (!quiet) { HOOK.toast(`${sh.name} 연료 ${q.toFixed(2)}t 보충 ${won(q * price)}`); HOOK.sound('click'); }
  return true;
}
function doLoad(cid, sh, quiet) {
  if (!canOperate(sh) || T(sh).role !== 'cargo') return false;
  const i = S.contracts.findIndex(c => c.id === cid); if (i < 0) return false;
  const c = S.contracts[i];
  if (sh.loc !== c.from || !fits(sh, c) || !canCarry(sh, c.good)) return false;
  let lot;
  if (c.kind === 'tender') {
    const q = lotQ(sh, c); lot = { ...c, id: S.cid++, q, pay: Math.round(q * c.rate), deadline: c.deadline };
    c.q -= q; c.pay = Math.round(c.q * c.rate); if (c.q <= 0) S.contracts.splice(i, 1);
  } else { S.contracts.splice(i, 1); lot = { ...c, deadline: S.day + c.due }; }
  sh.cons.push(lot);
  if (!quiet) { HOOK.sound('click'); HOOK.toast(`${GOODS[c.good].name} ${lot.q}t 선적 → ${PORTS[c.to].name} · 운임 ${won(lot.pay)}`); }
  return true;
}
function doUnload(cid, sh) {
  if (!docked(sh)) return false;
  const i = sh.cons.findIndex(c => c.id === cid); if (i < 0) return false;
  const [c] = sh.cons.splice(i, 1);
  if (c.kind === 'tender') { const pool = S.contracts.find(x => x.tid === c.tid); if (pool) { pool.q += c.q; pool.pay = Math.round(pool.q * pool.rate); } else if (S.tender && S.tender.id === c.tid && S.tender.state === 'won') S.contracts.push({ ...c, id: S.cid++ }); }
  else if (c.offer >= S.day) S.contracts.push(c);
  HOOK.toast(`${GOODS[c.good].name} ${c.q}t 하역 (의뢰 반납)`);
  return true;
}
function doSail(sh, to, quiet) {
  if (!canOperate(sh) || to === sh.loc || !PORTS[to]) return false;
  // a worn-out hull may still limp to the nearest yard, never anywhere else
  if (sh.cond < 20 && !yardAt(to)) { say(quiet, `${sh.name} 선체 상태 ${Math.round(sh.cond)} — 조선·정비소가 있는 항구로만 갈 수 있습니다`); return false; }
  const p = plan(sh, to); if (!p) return false;
  if (T(sh).burn && sh.fuel + 1e-6 < p.fuel) { say(quiet, `연료가 모자랍니다. 예상 ${p.fuel.toFixed(2)}t 필요, 남은 연료 ${sh.fuel.toFixed(2)}t`); return false; }
  S.cash -= portFee(T(sh)); sh.spend += portFee(T(sh)); S.stats.fees += portFee(T(sh)); S.stats.voyages++; if (!load(sh)) S.stats.ballast++;
  sh.voy = { from: sh.loc, to, path: p.path, segs: p.segs, dist: p.dist, done: 0, dep: S.day, next: 0, eta: p.days,
    // per-voyage account for the settlement card
    fee: portFee(T(sh)), fp: fuelPrice(sh.loc), fuelUsed: 0, emFuel: 0, wage: 0, extra: 0, laden: load(sh) > 0,
    capSave: 0, capKm: 0, wear: 0, auto: !!quiet };
  sh.voy.next = dayStep(T(sh), areaAt(p.segs, 0), 0, load(sh) > 0, sh).spd;
  sh.loc = null; sh.mode = 'idle'; sh.wait = 0;
  if (!quiet) { HOOK.toast(`${sh.name} 출항 → ${PORTS[to].name} (예상 ${p.days}일)`); HOOK.sound('horn'); HOOK.sailed(sh); }
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
function fleetFull(quiet) {
  if (fleetCount() < fleetLimit()) return false;
  const n = GRADES[S.grade + 1];
  say(quiet, `선대 한도 ${fleetLimit()}척이 찼습니다 (${GRADES[S.grade].name}).${n ? ` 배달 ${n.need}건·화주 신뢰 ${n.trust}이면 ${n.name}로 올라 ${n.fleet}척까지 늘릴 수 있습니다` : ''}`);
  return true;
}
function doOrder(type, quiet) {
  const t = SHIPS[type]; if (!t || t.era > S.era) return false;
  const cost = newPrice(t);
  if (S.cash < cost || fleetFull(quiet)) return false;
  S.cash -= cost; S.stats.shipBuy += cost;
  S.orders.push({ type, ready: S.day + t.build, port: deliveryPort(t), paid: cost });
  HOOK.toast(`${t.name} 발주 완료. ${t.build}일 뒤 ${PORTS[deliveryPort(t)].name}에서 인도`); HOOK.sound('click');
  return true;
}
function doBuyUsed(id) {
  const i = S.used.findIndex(u => u.id === id); if (i < 0) return false;
  const L = S.used[i], cost = usedPrice(L);
  if (S.cash < cost || fleetFull()) return false;
  S.cash -= cost; S.stats.shipBuy += cost; S.used.splice(i, 1);
  const sh = addShip(L.type, L.loc, L.age * 365); sh.fuel = SHIPS[L.type].tank * 0.3;
  HOOK.toast(`${sh.name} 매입 (${L.age}년 된 중고선, ${PORTS[L.loc].name})`);
  return true;
}
function doSellShip(sh) {
  if (!docked(sh) || sh.cons.length || sh.mode === 'fishing' || sh.mode === 'react' || sh.mode === 'repair') return false;
  const v = shipValue(sh);
  S.cash += v; S.stats.shipSell += v; S.ships = S.ships.filter(x => x !== sh);
  HOOK.toast(`${sh.name} 매각 ${won(v)}`);
  return true;
}

// 조선·정비소: 선체를 100으로 되돌린다. 수리하는 동안은 출항할 수 없다
function doRepair(sh, quiet) {
  if (!docked(sh) || !(sh.mode === 'idle' || sh.mode === 'tour' || sh.mode === 'bunker' || sh.mode === 'layup') || sh.cond >= 99.5 || !yardAt(sh.loc)) return false;
  const cost = repairCost(sh), days = repairDays(sh);
  // like fuel, a repair can go on the company's credit line
  if (S.cash + creditLine() < cost) { say(quiet, `수리비 ${won(cost)}가 현금과 외상 한도를 넘습니다`); return false; }
  if (sh.cons.length) { say(quiet, '화물을 실은 채로는 수리할 수 없습니다. 먼저 배달하거나 내리세요'); return false; }
  S.cash -= cost; sh.spend += cost; S.stats.repair += cost; sh.after = sh.mode === 'layup' ? 'layup' : 'idle'; sh.mode = 'repair'; sh.busy = S.day + days;
  say(quiet, `${sh.name} 수리 시작 · ${won(cost)} · ${days}일 동안 출항 불가`);
  return true;
}
// 닻 다방: 선장 고용. 한 배에 한 명, 바꾸면 이전 선장은 떠난다
function doHire(kid, sh) {
  const i = S.capPool.findIndex(k => k.id === kid);
  if (i < 0 || !sh || T(sh).role !== 'cargo') return false;
  const fee = capFee(sh);
  if (S.cash < fee) { HOOK.toast(`고용비 ${won(fee)}가 모자랍니다`); return false; }
  const [k] = S.capPool.splice(i, 1);
  S.cash -= fee; sh.spend += fee; S.stats.hire += fee;
  if (sh.capt) news(`${sh.capt.name} 선장이 ${sh.name}에서 내렸습니다`);
  sh.capt = k; news(`${k.name} 선장(${CAPTAINS[k.kind].name}) ${sh.name}에 승선`);
  HOOK.toast(`${k.name} 선장 고용 · ${CAPTAINS[k.kind].skill}: ${CAPTAINS[k.kind].desc}`); HOOK.sound('click');
  return true;
}
function doFire(sh) { if (!sh || !sh.capt) return false; news(`${sh.capt.name} 선장 하선`); sh.capt = null; return true; }
function doBid(level) {
  const Tn = S.tender;
  if (!Tn || Tn.state !== 'open' || !BID_MUL[level] || S.day >= Tn.close) return false;
  Tn.bid = level; HOOK.toast(`응찰 완료 · 운임 ${{ low: '낮게', mid: '보통', high: '높게' }[level]} · 결과는 ${dateStr(Tn.close)}`);
  return true;
}
// 자동 항로: 두 항구 사이를 오가며 그 구간 의뢰를 싣는다 (첫 입찰 완수로 해금)
function doRoute(sh, a, b) {
  if (!S.autoOK || !sh || T(sh).role !== 'cargo') return false;
  if (!a) { sh.route = null; return true; }
  const R = routes(a, T(sh));
  if (a === b || !PORTS[a] || !PORTS[b] || R.dist[b] === undefined) return false;
  sh.route = { a, b }; news(`${sh.name} 자동 항로 ${PORTS[a].name} ⇄ ${PORTS[b].name}`);
  return true;
}
function nearestYard(sh) {
  const R = routes(sh.loc, T(sh)); let best = null;
  for (const p in R.dist) if (PORTS[p] && p !== sh.loc && yardAt(p) && (!best || R.dist[p] < R.dist[best])) best = p;
  return best;
}
function autoTurn(sh) {
  if (!sh.route || !canOperate(sh) || sh.mode !== 'idle') return;
  const { a, b } = sh.route, at = sh.loc, home = at === a || at === b, dest = at === a ? b : a;
  if (sh.cond < 45 && yardAt(at) && doRepair(sh, true)) return;
  if (sh.cond < 20 && !yardAt(at)) { const y = nearestYard(sh); if (y) { doRefuel(sh, 1, true); doSail(sh, y, true); } return; }
  if (home) {
    const jobs = S.contracts.filter(c => c.from === at && c.to === dest && canCarry(sh, c.good)).sort((x, y) => (y.kind === 'tender') - (x.kind === 'tender') || y.pay - x.pay);
    for (const c of jobs) if (fits(sh, c)) doLoad(c.id, sh, true);
    sh.wait = (sh.wait || 0) + 1;
    if (!sh.cons.length && sh.wait < 3) return;
  }
  const p = plan(sh, dest); if (!p) return;
  if (T(sh).tank && sh.fuel < p.fuel * 1.2) doRefuel(sh, 1, true);
  doSail(sh, dest, true);
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
  const tdraws = [mrand(), mrand(), mrand(), mrand()]; // drawn every day so the market never depends on the tender
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
    if (sh.mode === 'repair' && S.day >= sh.busy) { sh.mode = sh.after || 'idle'; sh.cond = 100; news(`${sh.name} 수리 완료 · 선체 상태 100`); if (!sh.route) HOOK.toast(`${sh.name} 수리 완료`); }
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
      const v = sh.voy, st = dayStep(t, areaAt(v.segs, v.done), 0, load(sh) > 0, sh);
      let spd = st.spd;
      if (sh.capt) { v.capSave += Math.max(0, st.base.fuel - st.fuel) * v.fp; v.capKm += Math.max(0, st.spd - st.base.spd); }
      // hull wear: more in bad weather; a storm captain halves it in wind and typhoons
      const wear = [0.25, 0.3, 0.6, 1.5][st.w] * (sh.capt && sh.capt.kind === 'storm' && st.w >= 2 ? 0.5 : 1);
      sh.cond = Math.max(0, sh.cond - wear); v.wear += wear;
      if (sh.cond < 40 && rand() < (40 - sh.cond) / 400) {
        const fix = Math.round(fullWage(sh) * 2 + t.price * 0.004);
        S.cash -= fix; sh.spend += fix; S.stats.repair += fix; v.extra += fix; spd *= 0.3;
        news(`${sh.name} 기관 고장 — 응급 수리 ${won(fix)} (선체 상태 ${Math.round(sh.cond)})`);
      }
      if (t.burn) {
        if (sh.fuel < st.fuel) {
          const tow = st.fuel * fuelPrice(v.to) * 4 + fullWage(sh) * 3;
          S.cash -= tow; sh.spend += tow; S.stats.fuel += tow; v.extra += tow; v.emFuel += st.fuel - sh.fuel; sh.fuel = st.fuel; spd *= 0.4;
          news(`${sh.name} 연료 고갈 — 긴급 급유·예인 ${won(tow)}`); HOOK.toast(`${sh.name} 연료 고갈! 긴급 급유 비용 ${won(tow)}`);
        }
        sh.fuel = Math.max(0, sh.fuel - st.fuel); v.fuelUsed += st.fuel;
      }
      if (st.w === 3 && rand() < (sh.capt && sh.capt.kind === 'storm' ? 0.03 : 0.06)) { sh.cond = Math.max(0, sh.cond - 12); v.wear += 12; news(`${sh.name} 태풍 피해 — 선체 상태 ${Math.round(sh.cond)}로 떨어짐. 조선·정비소에서 수리하세요`); }
      v.done += spd;
      if (v.done >= v.dist) {
        sh.loc = v.to; sh.voy = null;
        let msg = `${sh.name} ${PORTS[sh.loc].name} 도착`, got = 0, lateN = 0, jobs = 0;
        const keep = [];
        for (const c of sh.cons) {
          if (c.to === sh.loc) {
            const late = S.day > c.deadline, pay = late ? c.pay / 2 : c.pay; S.cash += pay; sh.earn += pay; S.stats.freight += pay; S.stats.delivered++; if (late) { S.stats.late++; lateN++; } jobs++; got += pay; if (late) msg += ' · 기한 초과로 운임 절반';
            // shippers remember: on time builds trust, late costs it
            if (c.kind === 'tender') tenderDelivered(c);
            else if (late) addTrust(c.kind === 'urgent' ? -8 : -5, '납기 지연');
            else addTrust(c.kind === 'urgent' ? 3 : c.kind === 'regular' ? 2 : 1, '납기 준수');
            if (c.kind === 'regular' && c.legs > 1) {
              S.contracts.push({ ...c, id: S.cid++, legs: c.legs - 1, offer: S.day + 25, deadline: undefined, mine: true });
              msg += ` · 정기 운송 다음 회차 ${PORTS[c.from].name}에서 대기 (${c.legs - 1}회 남음)`;
            }
          } else keep.push(c);
        }
        sh.cons = keep;
        if (got) { msg += ` · 운임 ${won(got)}`; HOOK.sound('coin'); } else HOOK.sound('bell');
        const fuelCost = (v.fuelUsed - v.emFuel) * v.fp;
        const trip = { ship: sh.id, from: v.from, to: v.to, days: S.day - v.dep, jobs, late: lateN, freight: got, fee: v.fee, fuelT: v.fuelUsed, fuelCost, wage: v.wage, extra: v.extra,
          capt: sh.capt ? sh.capt.kind : null, capSave: v.capSave || 0, capDays: sh.capt ? (v.capKm || 0) / t.speed : 0, wear: v.wear || 0, cond: sh.cond, auto: !!v.auto };
        trip.net = trip.freight - trip.fee - trip.fuelCost - trip.wage - trip.extra;
        S.stats.capSave += trip.capSave;
        sh.lastTrip = trip; S.stats.trips++;
        news(msg); if (!v.auto) arrived = true;
        HOOK.trip(sh, trip, msg);
      } else v.next = dayStep(t, areaAt(v.segs, v.done), 1, load(sh) > 0, sh).spd;
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
    if (c.kind === 'tender') return true;
    if (c.offer < S.day) { if (c.mine) { addTrust(-6, '정기 운송 회차 누락'); news(`정기 운송 ${PORTS[c.from].name}→${PORTS[c.to].name} 회차를 놓쳤습니다 — 신뢰 하락`); } return false; }
    if (c.mine) return true;
    if (rand() < 0.03) { const r = pick(S.rivals); if (rand() < 0.3) news(`${r.name}이(가) ${PORTS[c.from].name}→${PORTS[c.to].name} ${GOODS[c.good].name} 화물을 가져갔습니다`); return false; }
    return true;
  });
  const growth = Math.min(2.5, 1 + S.day / 500); // 경제 성장으로 물동량이 늘어난다
  const volume = clamp(S.idx, 0.6, 1.4); // a slump means less cargo, not just cheaper cargo
  const want = [0, 34, 60, 90][S.era] * growth * volume;
  for (let k = 0; k < [0, 7, 11, 15][S.era] * growth * volume; k++) if (S.contracts.length < want && rand() < 0.8) genContract();
  // keep a little work around wherever my ships wait
  for (const sh of S.ships) if (sh.loc && !sh.voy && T(sh).role === 'cargo' && rand() < 0.15 && !S.contracts.some(c => c.from === sh.loc && c.q <= T(sh).cap && canCarry(sh, c.good))) genContract(sh.loc, sh.type);
  if (S.day % 30 === 0) { refreshUsed(); refreshCaptains(); }
  tenderDaily(tdraws);
  checkGrade();
  if (S.autoOK) for (const sh of S.ships) if (sh.route) autoTurn(sh);
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

