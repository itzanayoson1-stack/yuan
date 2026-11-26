// Balance backtest: every bot style x many seeds on the real rules, judged against the plan's KPI targets.
// Usage: node tests/balance.js [--seeds 30] [--days 1000] [--json out.json] [--report-only]
'use strict';
const { loadEngine } = require('./harness');
const { makeBot, STYLES } = require('./bots');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SEEDS = Number(arg('seeds', 30)), DAYS = Number(arg('days', 1000));
const JSON_OUT = arg('json', null), REPORT_ONLY = process.argv.includes('--report-only');

const E = loadEngine();
const median = a => { const b = a.filter(x => x !== null && !Number.isNaN(x)).sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : null; };
const pct = (a, p) => { const b = a.filter(x => x !== null).sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) * p)] : null; };

function runOne(style, seed) {
  const home = seed % 2 ? 'mapo' : 'gupo';
  E.newGame('bot', home, seed);
  const bot = makeBot(E, style.replace('-nolayup', ''), { layup: !style.endsWith('-nolayup') });
  const m = { curve: {}, rivalCurve: {}, style, seed, second: null, era2: null, era3: null, goal: null, bankrupt: false, idleShipDays: 0, noJobDays: 0 };
  const wasAtSea = new Set();
  for (let d = 0; d < DAYS; d++) {
    const S = E.S;
    // arrivals with nothing to load: a cargo ship that just arrived and finds no profitable job at the port
    for (const sh of S.ships) {
      const arrived = sh.loc && !sh.voy && E.T(sh).role === 'cargo' && sh.mode === 'idle' && wasAtSea.has(sh.id);
      if (sh.voy) wasAtSea.add(sh.id); else wasAtSea.delete(sh.id);
      if (!arrived || sh.cons.length) continue;
      m.idleShipDays++;
      const ok = S.contracts.some(c => c.from === sh.loc && E.canCarry(sh, c.good) && c.q <= E.T(sh).cap && (E.jobNet(sh, c) || { net: -1 }).net > 0);
      if (!ok) m.noJobDays++;
    }
    bot(); E.tick();
    if (m.second === null && E.S.ships.length >= 2) m.second = E.S.day;
    if (m.era2 === null && E.S.era >= 2) m.era2 = E.S.day;
    if (m.era3 === null && E.S.era >= 3) m.era3 = E.S.day;
    if (m.goal === null && E.S.won) m.goal = E.S.day;
    if (E.S.day % 100 === 0) { m.curve[E.S.day] = E.netWorth(); m.rivalCurve[E.S.day] = Math.max(...E.S.rivals.map(r => r.w)); }
    if (E.S.over) { m.bankrupt = true; break; }
  }
  const S = E.S, st = S.stats;
  const byType = {};
  for (const sh of S.ships) byType[sh.type] = (byType[sh.type] || 0) + Math.max(0, sh.earn - sh.spend);
  const tot = Object.values(byType).reduce((a, b) => a + b, 0);
  const top = Object.entries(byType).sort((a, b) => b[1] - a[1])[0];
  m.topType = top ? top[0] : null;
  m.topShare = tot > 0 ? top[1] / tot : null;
  m.ballast = st.voyages ? st.ballast / st.voyages : null;
  const opex = st.fuel + st.wage + st.fees;
  m.fuelShare = opex ? st.fuel / opex : null;
  m.netWorth = E.netWorth();
  m.ships = S.ships.length;
  m.noJob = m.idleShipDays ? m.noJobDays / m.idleShipDays : 0;
  m.lateRate = st.delivered ? st.late / st.delivered : 0;
  return m;
}

const t0 = Date.now();
const styles = [...STYLES, 'safe-nolayup'];
const runs = {};
for (const st of styles) { runs[st] = []; for (let s = 1; s <= SEEDS; s++) runs[st].push(runOne(st, s)); }
const ms = Date.now() - t0;

const col = (st, k) => runs[st].map(r => r[k]);
const core = ['safe', 'expansion', 'specialist'];
const fmtD = v => v === null ? '없음' : `${Math.round(v)}일`;
const fmtP = v => v === null ? '-' : `${Math.round(v * 100)}%`;

// KPI targets from the design doc ("테스트 계획 > 합격 수치"); medians over seeds
const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok, detail });
{ // styles differ in cash reserve, so one band per style is impossible; judge the core styles together
  const v = median(core.flatMap(st => col(st, 'second'))); check('두 번째 배 30~60일 (핵심 3성향 중앙값)', v !== null && v >= 30 && v <= 60, fmtD(v));
  const fast = Math.min(...core.map(st => median(col(st, 'second')))); check('가장 빠른 성향도 두 번째 배 20일 이상', fast >= 20, fmtD(fast));
}
for (const st of core) {
  const v = median(col(st, 'era2')); check(`연안의 시대 250~350일 (${st})`, v !== null && v >= 250 && v <= 350, fmtD(v));
}
{ const v = median(core.flatMap(st => col(st, 'goal').map(g => g ?? Infinity)).map(x => x === Infinity ? 99999 : x));
  check('목표 달성 500~700일 (핵심 3성향 중앙값)', v >= 500 && v <= 700, v >= 99999 ? '기간 안 미달성' : fmtD(v)); }
{ const r = col('novice', 'goal').filter(v => v !== null).length / SEEDS; check('초보형 30% 이상이 기간 안에 목표 달성', r >= 0.3, fmtP(r)); }
{ const r = col('safe', 'bankrupt').filter(Boolean).length / SEEDS; check('파산률 안전형 2% 미만', r < 0.02, fmtP(r)); }
{ const r = col('novice', 'bankrupt').filter(Boolean).length / SEEDS; check('파산률 초보형 20% 미만', r < 0.2, fmtP(r)); }
for (const st of STYLES) { const v = median(col(st, 'noJob')); check(`도착했는데 실을 짐이 없음 30% 미만 (${st})`, v !== null && v < 0.3, fmtP(v)); }
for (const st of core) { const v = median(col(st, 'topShare')); check(`한 선종 이익 점유 60% 이하 (${st})`, v !== null && v <= 0.6, `${fmtP(v)} (${median([])===null ? '' : ''}${runs[st].map(r => r.topType).sort().reduce((a, t, i, arr) => (arr.filter(x => x === t).length > arr.filter(x => x === a).length ? t : a), runs[st][0].topType)})`); }
for (const st of core) { const v = median(col(st, 'ballast')); check(`빈 배 항해 20~40% (${st})`, v !== null && v >= 0.2 && v <= 0.4, fmtP(v)); }
// specialist may legitimately run sail boats (no fuel), so the fuel band applies to safe/expansion
for (const st of ['safe', 'expansion']) { const v = median(col(st, 'fuelShare')); check(`운항비 중 연료비 30~50% (${st})`, v !== null && v >= 0.3 && v <= 0.5, fmtP(v)); }
{ // paired by seed, so market luck cancels out
  const diff = runs.safe.map((r, i) => r.netWorth - runs['safe-nolayup'][i].netWorth);
  const wins = diff.filter(d => d > 0).length / diff.length, md = median(diff);
  check('계선이 이득 (같은 시드 짝 비교, 중앙 차이 > 0)', md > 0, `중앙 차이 ₩${Math.round(md).toLocaleString()} · 계선 쪽 우세 ${fmtP(wins)}`); }
checks.push({ name: '선장 효과 +10~20%', ok: null, detail: '선장 미구현 (B 단계)' });

console.log(`\n선박왕 밸런스 백테스트 · 시드 ${SEEDS}개 × 봇 ${styles.length}종 × ${DAYS}일 · ${(ms / 1000).toFixed(1)}초\n`);
console.log('성향          두번째배  연안시대  근해시대  목표달성(중앙/달성률)  파산   최종 순자산(중앙)   선박수');
for (const st of styles) {
  const g = col(st, 'goal'), done = g.filter(v => v !== null).length / SEEDS;
  console.log(`${st.padEnd(13)} ${fmtD(median(col(st, 'second'))).padStart(7)} ${fmtD(median(col(st, 'era2'))).padStart(8)} ${fmtD(median(col(st, 'era3'))).padStart(8)}   ${fmtD(median(g)).padStart(7)} / ${fmtP(done).padStart(4)}     ${fmtP(col(st, 'bankrupt').filter(Boolean).length / SEEDS).padStart(4)}   ₩${Math.round(median(col(st, 'netWorth'))).toLocaleString().padStart(14)}   ${median(col(st, 'ships'))}`);
}
console.log('\n순자산 곡선 (중앙값, 단위 만원) · 마지막 줄은 가장 큰 라이벌');
const days = [100, 200, 300, 400, 500, 600, 700, 800, 1000].filter(d => d <= DAYS);
console.log('              ' + days.map(d => String(d).padStart(7)).join(''));
const man = v => v === null ? '      -' : String(Math.round(v / 1e4)).padStart(7);
for (const st of styles) console.log(st.padEnd(14) + days.map(d => man(median(runs[st].map(r => r.curve[d] ?? null)))).join(''));
console.log('rival(best)'.padEnd(14) + days.map(d => man(median(runs.safe.map(r => r.rivalCurve[d] ?? null)))).join(''));
console.log('\n합격 수치');
let fail = 0;
for (const c of checks) {
  const mark = c.ok === null ? '  -  ' : c.ok ? ' 통과' : ' 실패';
  if (c.ok === false) fail++;
  console.log(`${mark}  ${c.name.padEnd(36)} ${c.detail}`);
}
console.log(`\n${checks.filter(c => c.ok).length}개 통과 · ${fail}개 실패 · ${checks.filter(c => c.ok === null).length}개 보류`);
if (JSON_OUT) require('fs').writeFileSync(JSON_OUT, JSON.stringify({ seeds: SEEDS, days: DAYS, checks, runs }, null, 1));
if (fail && !REPORT_ONLY) process.exitCode = 1;
