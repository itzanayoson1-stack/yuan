// Rule checks from the design doc's checklist ("기능 점검표"), run against the real engine.
// Usage: node tests/functional.js
'use strict';
const { loadEngine } = require('./harness');
const { makeBot } = require('./bots');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(` 통과  ${name}`); }
  catch (e) { fail++; console.log(` 실패  ${name}\n        ${e.message}`); }
}
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: 기대 ${JSON.stringify(b)}, 실제 ${JSON.stringify(a)}`); }
function ok(v, msg) { if (!v) throw new Error(msg); }

function fresh(seed = 7, home = 'mapo') {
  const E = loadEngine();
  E.toasts = []; E.HOOK.toast = t => E.toasts.push(t);
  E.newGame('test', home, seed);
  return E;
}
// first ship + a job it can carry from its port, ready to sail
function loadedShip(E) {
  const sh = E.S.ships[0];
  let c = E.S.contracts.find(c => c.from === sh.loc && E.canCarry(sh, c.good) && c.q <= E.freeCap(sh) && E.jobNet(sh, c));
  if (!c) { E.genContract(sh.loc, sh.type); c = E.S.contracts.find(c => c.from === sh.loc && c.q <= E.freeCap(sh) && E.canCarry(sh, c.good)); }
  ok(c, '실을 의뢰를 만들지 못함');
  return { sh, c };
}

console.log('\n선박왕 기능 점검\n');

test('같은 시드와 같은 플레이는 같은 결과를 낸다', () => {
  const run = () => { const E = fresh(42); const bot = makeBot(E, 'safe'); for (let d = 0; d < 300; d++) { bot(); E.tick(); } return JSON.stringify(E.S); };
  eq(run(), run(), '300일 뒤 상태');
});

test('항해 중 저장 → 복원해도 이후 진행이 똑같다 (연료·거리·화물·난수)', () => {
  const E = fresh(9); const bot = makeBot(E, 'expansion');
  let d = 0; while (d < 200 && !E.S.ships.some(s => s.voy && s.cons.length)) { bot(); E.tick(); d++; }
  ok(E.S.ships.some(s => s.voy && s.cons.length), '항해 중인 배를 만들지 못함');
  const snap = JSON.stringify(E.S);
  for (let i = 0; i < 40; i++) E.tick();
  const a = JSON.stringify(E.S);
  E.S = JSON.parse(snap);
  for (let i = 0; i < 40; i++) E.tick();
  eq(JSON.stringify(E.S), a, '복원 후 40일');
});

test('화물을 실은 배는 팔 수 없다', () => {
  const E = fresh(); const { sh, c } = loadedShip(E);
  ok(E.doLoad(c.id, sh), '선적 실패');
  eq(E.doSellShip(sh), false, '매각 결과'); eq(E.S.ships.length, 1, '보유 척수');
});

test('계선 중인 배는 출항할 수 없고, 재가동 2일 뒤에 다시 움직인다', () => {
  const E = fresh(); const sh = E.S.ships[0];
  ok(E.doLayup(sh), '계선 실패');
  eq(Math.round(E.wage(sh) * 100) / 100, Math.round(E.fullWage(sh) * 0.2 * 100) / 100, '계선 중 고정비');
  eq(E.doSail(sh, 'incheon'), false, '계선 중 출항');
  E.S.cash = 10000; ok(E.doReactivate(sh), '재가동 실패'); eq(sh.mode, 'react', '재가동 상태');
  eq(E.doSail(sh, 'incheon'), false, '재가동 중 출항');
  E.tick(); E.tick(); eq(sh.mode, 'idle', '2일 뒤 상태');
});

test('다른 항구의 의뢰는 실을 수 없고, 다음 시대 배는 발주할 수 없다', () => {
  const E = fresh(); const sh = E.S.ships[0];
  E.genContract('busan', 'ttak'); const other = E.S.contracts.find(c => c.from !== sh.loc);
  eq(E.doLoad(other.id, sh), false, '다른 항구 선적');
  E.S.cash = 1e7; eq(E.doOrder('bulk'), false, '3시대 선박 발주(1시대)');
});

test('기한을 넘겨 도착하면 운임이 절반만 들어온다', () => {
  const E = fresh(); const { sh, c } = loadedShip(E);
  c.due = 0; E.doLoad(c.id, sh); E.doRefuel(sh, 1);
  const pay = c.pay, before = E.S.stats.freight;
  ok(E.doSail(sh, c.to), '출항 실패');
  for (let i = 0; i < 60 && sh.voy; i++) E.tick();
  ok(!sh.voy, '도착하지 못함');
  eq(Math.round(E.S.stats.freight - before), Math.round(pay / 2), '받은 운임'); eq(E.S.stats.late, 1, '지연 건수');
});

test('항해 중 시대가 바뀌어도 그 배는 정상 도착한다', () => {
  const E = fresh(); const { sh, c } = loadedShip(E); E.doLoad(c.id, sh); E.doRefuel(sh, 1); E.doSail(sh, c.to);
  E.S.cash = E.ERA[2].need * 2; E.tick(); eq(E.S.era, 2, '시대');
  for (let i = 0; i < 60 && sh.voy; i++) E.tick();
  ok(!sh.voy && sh.loc === c.to, '도착하지 못함');
});

test('항해 중 연료가 떨어지면 긴급 급유 비용이 나가고 배는 멈추지 않는다', () => {
  const E = fresh(); const { sh, c } = loadedShip(E); E.doLoad(c.id, sh); E.doRefuel(sh, 1); E.doSail(sh, c.to);
  sh.fuel = 0; const f0 = E.S.stats.fuel;
  for (let i = 0; i < 60 && sh.voy; i++) E.tick();
  ok(E.S.stats.fuel > f0, '긴급 급유 비용이 기록되지 않음'); ok(!sh.voy, '도착하지 못함');
});

test('현금과 외상 한도가 바닥나면 급유가 막히고 해결 방법을 알려준다', () => {
  const E = fresh(); const sh = E.S.ships[0]; sh.fuel = 0;
  E.S.cash = -(E.creditLine() + 100);
  eq(E.doRefuel(sh, 1), false, '급유 결과'); ok(E.toasts.some(t => t.includes('외상') && t.includes('계선')), '안내 문구 없음');
});

test('연료 탱크가 없는 돛배는 급유를 시도해도 경고가 뜨지 않는다', () => {
  const E = fresh(); const sh = E.addShip('hwangpo', 'mapo', 0); E.toasts.length = 0;
  eq(E.doRefuel(sh, 1), false, '급유 결과'); eq(E.toasts.length, 0, '알림 수');
});

test('순자산이 0 아래로 떨어지면 파산 처리된다', () => {
  const E = fresh(); let over = 0; E.HOOK.over = () => over++;
  E.S.cash = -1e9; E.tick(); ok(E.S.over, '파산 상태 아님'); eq(over, 1, '파산 알림 횟수');
  E.tick(); eq(over, 1, '파산 알림은 한 번만');
});

test('예전 버전 세이브는 거부한다', () => {
  const E = fresh();
  ok(E.isValidSave(JSON.parse(JSON.stringify(E.S))), '현재 세이브가 거부됨');
  eq(E.isValidSave({ ...JSON.parse(JSON.stringify(E.S)), v: 2 }), false, '2버전 세이브');
  eq(E.isValidSave(null), false, '빈 세이브');
});

test('태풍은 겨울에 오지 않고, 강에는 태풍이 없다', () => {
  const E = fresh(3);
  for (let d = 0; d < 365 * 4; d++) {
    E.tick(); const m = E.dateOf(E.S.day).getUTCMonth();
    for (const a in E.S.wx) {
      const w = E.S.wx[a][0];
      if (a === 'river') ok(w < 3, `강에 태풍 (${E.S.day}일)`);
      if (m === 11 || m <= 1) ok(w < 3, `겨울 태풍 (${E.S.day}일, ${a})`);
    }
  }
});

test('수락 마감이 지나도 이미 실은 화물은 배에 남는다', () => {
  const E = fresh(); const { sh, c } = loadedShip(E); E.doLoad(c.id, sh);
  sh.cons[0].offer = E.S.day - 1; E.tick();
  eq(sh.cons.length, 1, '실은 화물 수');
});

test('시대가 바뀌면 새 항구로 가는 항로가 열린다 (항로 캐시 갱신)', () => {
  const E = fresh(); const t = E.SHIPS.coaster;
  eq(E.routes('busan', t).dist.ulsan, undefined, '1시대 부산→울산');
  E.S.era = 2; ok(E.routes('busan', t).dist.ulsan > 0, '2시대 부산→울산');
});

test('같은 날 중고선을 사고팔기를 반복해도 현금·순자산이 늘지 않는다 (순환 이익 없음)', () => {
  for (const idx of [0.6, 1.0, 1.6]) { // 불황·보통·호황 시세 모두
    const E = fresh(11); E.S.cash = 5e6; E.S.idx = idx; E.S.era = 3;
    const cash0 = E.S.cash, nw0 = E.netWorth();
    for (let k = 0; k < 30; k++) {
      if (!E.S.used.length) E.genContract(); // keep the call shape simple; refill the market below
      if (!E.S.used.length) break;
      const L = E.S.used[0]; const before = E.S.ships.length;
      ok(E.doBuyUsed(L.id), '중고선 매입 실패');
      const sh = E.S.ships[E.S.ships.length - 1]; eq(E.S.ships.length, before + 1, '매입 후 척수');
      ok(E.doSellShip(sh), '바로 매각 실패');
      E.S.used.push({ ...L, id: 'again' + k }); // 같은 매물이 다시 나온다고 가정 (가장 불리한 경우)
    }
    ok(E.S.cash < cash0, `시세 ${idx}: 현금이 늘었음 (${Math.round(E.S.cash - cash0)})`);
    ok(E.netWorth() < nw0, `시세 ${idx}: 순자산이 늘었음 (${Math.round(E.netWorth() - nw0)})`);
  }
});

test('신조 발주 → 인도 사이에 순자산이 부풀지 않는다 (미실현 평가 이중 반영 없음)', () => {
  const E = fresh(12); E.S.cash = 1e6; E.S.era = 2;
  const nw0 = E.netWorth();
  ok(E.doOrder('coaster'), '발주 실패');
  ok(E.netWorth() <= nw0, '발주 직후 순자산 증가');
  for (let d = 0; d < E.SHIPS.coaster.build + 1; d++) { E.S.idx = 1; E.tick(); }
  const sh = E.S.ships.find(s => s.type === 'coaster'); ok(sh, '인도되지 않음');
  // 인도 후 선박 평가액은 실제 지불액 이하여야 한다
  ok(E.shipValue(sh) <= E.newPrice(E.SHIPS.coaster), '인도된 배의 평가액이 지불액보다 큼');
});

test('같은 시드면 플레이 방식이 달라도 시황·유가·날씨·라이벌은 똑같다 (외생 시황 고정)', () => {
  const world = style => {
    const E = fresh(21); const bot = makeBot(E, style); const trace = [];
    for (let d = 0; d < 400; d++) { bot(); E.tick(); trace.push([E.S.idx, E.S.oil, E.S.oilShock, JSON.stringify(E.S.wx), E.S.rivals.map(r => r.w).join()].join('|')); }
    return trace;
  };
  const a = world('safe'), b = world('novice');
  // 운임지수·유가·유가 충격·날씨·라이벌 (항구 이벤트는 열린 항구에만 걸리므로 제외)
  eq(a.length, b.length, '기록 길이');
  for (let i = 0; i < a.length; i++) if (a[i].split('|').slice(0, 3).join() !== b[i].split('|').slice(0, 3).join() || a[i].split('|')[3] !== b[i].split('|')[3] || a[i].split('|')[4] !== b[i].split('|')[4]) throw new Error(`${i + 1}일째 시장이 달라짐`);
});

test('항차 결과의 순이익은 실제 현금 변화와 맞는다 (운임 − 입항료 − 고정비 − 기타, 연료는 출항 전 구입분)', () => {
  const E = fresh(31); const { sh, c } = loadedShip(E); E.doLoad(c.id, sh); E.doRefuel(sh, 1);
  let trip = null; E.HOOK.trip = (s, t) => { trip = t; };
  const cash0 = E.S.cash, fuel0 = sh.fuel;
  ok(E.doSail(sh, c.to), '출항 실패');
  for (let i = 0; i < 60 && sh.voy; i++) E.tick();
  ok(trip, '결과 기록 없음');
  const cashDelta = E.S.cash - cash0;
  const fromTrip = trip.freight - trip.fee - trip.wage - trip.extra;
  ok(Math.abs(cashDelta - fromTrip) < 0.01, `현금 변화 ${cashDelta.toFixed(2)} vs 결과 ${fromTrip.toFixed(2)}`);
  ok(Math.abs(trip.fuelT - (fuel0 - sh.fuel)) < 1e-9, '연료 사용량 불일치');
  ok(Math.abs(trip.net - (fromTrip - trip.fuelCost)) < 1e-9, '순이익 계산');
});

test('승리 판정용 순자산은 시세(운임지수)에 흔들리지 않는다 (장부가)', () => {
  const E = fresh(32); E.addShip('hwangpo', 'mapo', 400);
  E.S.idx = 0.6; const a = E.netWorth(); E.S.idx = 1.6; const b = E.netWorth();
  eq(Math.round(a), Math.round(b), '불황·호황 순자산');
  ok(E.shipValue(E.S.ships[1]) > E.bookValue(E.S.ships[1]), '호황 매각가는 장부가보다 높아야 함');
});

test('어느 시드로 시작해도 모항에 첫 항차로 남는 의뢰가 있다', () => {
  for (let seed = 1; seed <= 60; seed++) for (const home of ['mapo', 'gupo']) {
    const E = fresh(seed, home); const sh = E.S.ships[0];
    const good = E.S.contracts.filter(c => c.from === home && E.canCarry(sh, c.good) && c.q <= E.T(sh).cap && (E.jobNet(sh, c) || { net: -1 }).net > 0);
    ok(good.length > 0, `시드 ${seed} ${home}: 남는 의뢰 없음`);
  }
});

/* ---- B2: hull, yard, captains, jobs, trust, grade, tender, auto route ---- */
const sailTo = (E, sh, to) => { E.doRefuel(sh, 1); ok(E.doSail(sh, to), '출항 실패'); for (let i = 0; i < 90 && sh.voy; i++) E.tick(); ok(!sh.voy, '도착 못 함'); };

test('항해하면 선체 상태가 떨어지고, 상태가 나쁘면 연료를 더 쓰고, 20 아래면 정비소 있는 항구로만 갈 수 있다', () => {
  const E = fresh(40); const { sh, c } = loadedShip(E); E.doLoad(c.id, sh);
  const p100 = E.plan(sh, c.to); sh.cond = 60; const p60 = E.plan(sh, c.to);
  ok(p60.fuel > p100.fuel * 1.15 && p60.fuel < p100.fuel * 1.17, `연료 ${p100.fuel} → ${p60.fuel}`);
  sh.cond = 100; sailTo(E, sh, c.to);
  ok(sh.cond < 100, '선체 상태가 그대로');
  sh.loc = 'chungju'; sh.cond = 15; eq(E.doSail(sh, 'yeoju'), false, '낡은 배가 정비소 없는 곳으로 출항');
  E.doRefuel(sh, 1); ok(E.doSail(sh, 'mapo'), '낡은 배도 정비소 있는 항구로는 갈 수 있어야 함');
});

test('수리 중에는 출항할 수 없고, 끝나면 선체 100 · 계선 중 수리는 계선 상태로 돌아간다', () => {
  const E = fresh(41); const sh = E.S.ships[0]; sh.cond = 55; E.S.cash = 5000;
  const cost = E.repairCost(sh), days = E.repairDays(sh), cash0 = E.S.cash;
  ok(E.doRepair(sh), '수리 시작 실패'); eq(Math.round(cash0 - E.S.cash), cost, '수리비');
  eq(E.doSail(sh, 'incheon'), false, '수리 중 출항');
  for (let i = 0; i < days; i++) E.tick();
  eq(sh.mode, 'idle', '수리 뒤 상태'); eq(sh.cond, 100, '수리 뒤 선체');
  sh.cond = 70; E.doLayup(sh); ok(E.doRepair(sh), '계선 중 수리'); for (let i = 0; i < 9; i++) E.tick();
  eq(sh.mode, 'layup', '계선 중 수리 뒤 상태');
});

test('수리는 규모 2 이상 항구나 모항에서만 된다', () => {
  const E = fresh(42); const sh = E.S.ships[0]; sh.cond = 50; sh.loc = 'chungju';
  eq(E.doRepair(sh), false, '충주(작은 나루) 수리');
});

test('선장: 연비형은 연료 40% 절약, 급여는 고정비의 3%, 정산표에 절약액이 나온다', () => {
  const E = fresh(43); const { sh, c } = loadedShip(E); E.doLoad(c.id, sh); E.S.cash = 5000;
  const w0 = E.wage(sh), f0 = E.plan(sh, c.to).fuel;
  const k = E.S.capPool.find(k => k.kind === 'eco'); ok(E.doHire(k.id, sh), '고용 실패');
  ok(Math.abs(E.wage(sh) - w0 * 1.03) < 1e-9, '선장 급여');
  ok(Math.abs(E.plan(sh, c.to).fuel - f0 * 0.6) < 1e-9, '연비형 연료');
  let trip = null; E.HOOK.trip = (s, t) => { trip = t; };
  sailTo(E, sh, c.to);
  ok(trip.capt === 'eco' && trip.capSave > 0, `절약액 ${trip.capSave}`);
});

test('선장: 납기형은 빨리 가고, 악천후형은 태풍 손실이 절반이다', () => {
  const E = fresh(44); const sh = E.S.ships[0]; const t = E.T(sh);
  E.S.wx.river = [3, 3, 3];
  const base = E.dayStep(t, 'river', 0, true, sh);
  sh.capt = { kind: 'swift' }; ok(E.dayStep(t, 'river', 0, true, sh).spd > base.spd * 1.11, '납기형 속도');
  sh.capt = { kind: 'storm' }; const st = E.dayStep(t, 'river', 0, true, sh);
  ok(st.spd > base.spd && st.fuel < base.fuel, '악천후형 태풍');
});

test('화주 신뢰: 납기를 지키면 오르고, 늦으면 떨어진다', () => {
  const E = fresh(45); const { sh, c } = loadedShip(E); E.doLoad(c.id, sh);
  const t0 = E.S.trust; sailTo(E, sh, c.to); ok(E.S.trust > t0, '정시 배달 뒤 신뢰');
  const E2 = fresh(45); const r = loadedShip(E2); E2.doLoad(r.c.id, r.sh); r.sh.cons[0].deadline = -1;
  const t1 = E2.S.trust; sailTo(E2, r.sh, r.c.to); ok(E2.S.trust < t1, '지연 뒤 신뢰');
});

test('긴급·정기 의뢰는 신뢰가 쌓여야 나온다', () => {
  const gen = trust => { const E = fresh(46); E.S.trust = trust; E.S.contracts = []; for (let i = 0; i < 300; i++) E.genContract(); return E.S.contracts; };
  const low = gen(40), high = gen(80);
  ok(!low.some(c => c.kind === 'urgent' || c.kind === 'regular'), '신뢰 40에서 긴급·정기');
  ok(high.some(c => c.kind === 'urgent') && high.some(c => c.kind === 'regular'), '신뢰 80에서 긴급·정기 없음');
  ok(low.every(c => c.kind === (c.km <= 250 ? 'short' : 'long')), '거리별 종류');
});

test('정기 운송: 배달하면 같은 구간 다음 회차가 내 몫으로 남고, 놓치면 신뢰가 떨어진다', () => {
  const E = fresh(47); const { sh, c } = loadedShip(E);
  Object.assign(c, { kind: 'regular', legs: 4 }); E.doLoad(c.id, sh); sailTo(E, sh, c.to);
  const next = E.S.contracts.find(x => x.kind === 'regular' && x.from === c.from && x.to === c.to);
  ok(next && next.legs === 3 && next.mine, '다음 회차');
  const t0 = E.S.trust; for (let i = 0; i < 30; i++) E.tick();
  ok(!E.S.contracts.includes(next) && E.S.trust < t0, '놓친 회차');
});

test('회사 등급이 선대 한도를 정하고, 배달 실적과 신뢰로 오른다', () => {
  const E = fresh(48); E.S.cash = 1e6;
  ok(E.doOrder('ttak'), '두 번째 배'); eq(E.doOrder('ttak'), false, '나루 상회 3번째 배');
  E.S.stats.delivered = 8; E.S.trust = 53; E.tick();
  eq(E.S.grade, 2, '등급'); ok(E.doOrder('ttak'), '등급 오른 뒤 발주');
});

test('입찰: 한 척으로는 지고 두 척이면 이긴다 · 낙찰 물량을 나눠 실어 다 나르면 자동 항로가 열린다', () => {
  const E = fresh(49); E.S.cash = 1e6; E.S.era = 2;
  const one = E.newTender(0.1, 0.5); ok(one, '입찰 생성'); one.close = E.S.day + 5;
  ok(E.tenderScore(one, 'mid') < 0.7, `한 척 점수 ${E.tenderScore(one, 'mid')}`);
  E.addShip(E.S.ships[0].type, E.S.home, 0);
  ok(E.tenderScore(one, 'mid') > 1.0, `두 척 점수 ${E.tenderScore(one, 'mid')}`);
  Object.assign(one, { rival: 1.0, from: E.S.home }); E.S.tender = one; E.doBid('mid');
  for (let i = 0; i < 5; i++) E.tick();
  eq(one.state, 'won', '낙찰');
  const lot = E.S.contracts.find(c => c.kind === 'tender'); ok(lot && lot.q === one.q, '입찰 화물');
  // carry it all with whatever ships are at the loading port
  for (let round = 0; round < 12 && one.state === 'won'; round++) {
    for (const sh of E.S.ships) {
      if (sh.voy || sh.mode !== 'idle') continue;
      if (sh.loc !== one.from) { E.doRefuel(sh, 1); E.doSail(sh, one.from); continue; }
      const l = E.S.contracts.find(c => c.kind === 'tender'); if (!l) break;
      E.doLoad(l.id, sh); E.doRefuel(sh, 1); E.doSail(sh, one.to);
    }
    for (let i = 0; i < 6; i++) E.tick();
  }
  eq(one.state, 'done', '입찰 완수'); ok(E.S.autoOK, '자동 항로 해금');
});

test('입찰 물량을 기한까지 못 채우면 위약금과 신뢰 하락', () => {
  const E = fresh(50); E.S.cash = 1e6; E.addShip('ttak', E.S.home, 0);
  const tn = E.newTender(0.1, 0.5); Object.assign(tn, { rival: 0.1, close: E.S.day + 1 }); E.S.tender = tn; E.doBid('mid');
  E.tick(); eq(tn.state, 'won', '낙찰');
  const cash0 = E.S.cash, t0 = E.S.trust;
  for (let i = 0; i < 30; i++) E.tick();
  eq(tn.state, 'failed', '미이행'); ok(E.S.stats.penalty > 0 && E.S.trust <= t0 - 15 + 1e-9, '위약금·신뢰');
  ok(!E.S.contracts.some(c => c.kind === 'tender'), '남은 입찰 화물 정리');
});

test('자동 항로: 맡겨 두면 두 항구를 오가며 그 구간 화물을 나른다', () => {
  const E = fresh(51); E.S.autoOK = true; const sh = E.S.ships[0];
  ok(E.doRoute(sh, 'mapo', 'incheon'), '항로 등록');
  const d0 = E.S.stats.delivered, v0 = E.S.stats.voyages;
  for (let i = 0; i < 120; i++) { E.tick(); if (sh.loc && !sh.voy && sh.mode === 'idle' && !E.S.contracts.some(c => c.from === sh.loc)) E.genContract(sh.loc, sh.type); }
  ok(E.S.stats.voyages - v0 >= 6, `항해 ${E.S.stats.voyages - v0}회`);
  ok(E.S.stats.delivered > d0, '배달 없음');
});

test('예전 버전(v4) 세이브는 받지 않는다', () => {
  const E = fresh(52); const old = JSON.parse(JSON.stringify(E.S)); old.v = 4;
  eq(E.isValidSave(old), false, 'v4'); eq(E.isValidSave(E.S), true, 'v5');
});

console.log(`\n${pass}개 통과 · ${fail}개 실패`);
if (fail) process.exitCode = 1;
