// Four operating styles that play the real rules day by day.
'use strict';

function makeBot(E, style, opts = {}) {
  const idle = new Map(); // ship id -> days spent docked with nothing to do
  const layupAllowed = opts.layup !== false && style !== 'novice';
  const captains = opts.captain !== false && style !== 'novice';
  const capKind = { safe: 'eco', expansion: 'swift', specialist: 'storm' }[style];
  const repairAt = { safe: 65, expansion: 45, specialist: 55, novice: 25 }[style];
  const home = E.S.home;

  // specialist: stays inside a radius around the home port that widens each era
  const radius = () => [0, 300, 700, 1600][E.S.era];
  function inFocus(sh, pid) {
    if (style !== 'specialist') return true;
    const R = E.routes(home, { river: true, range: 1 });
    return R.dist[pid] !== undefined && R.dist[pid] <= radius();
  }

  function cargoTurn(sh) {
    const t = E.T(sh), S = E.S;
    if (sh.cond < repairAt && !sh.cons.length && E.yardAt(sh.loc) && E.doRepair(sh)) return;
    if (sh.cond < repairAt - 15 && !sh.cons.length && !E.yardAt(sh.loc)) { const y = E.nearestYard(sh); if (y) { E.doRefuel(sh, 1); E.doSail(sh, y); } return; }
    // a captain pays off on ships that sail a lot: hire one for every cargo ship past the first months
    if (captains && !sh.capt && S.day > 60 && S.cash > E.capFee(sh) * 4) { const k = S.capPool.find(k => k.kind === capKind) || S.capPool[0]; if (k) E.doHire(k.id, sh); }
    if (t.tank && style !== 'novice' && sh.fuel < t.tank * (style === 'safe' ? 0.6 : 0.9)) E.doRefuel(sh, 1);
    const jobs = S.contracts
      .filter(c => c.from === sh.loc && E.canCarry(sh, c.good) && E.fits(sh, c) && (c.kind === 'tender' || inFocus(sh, c.to)))
      .map(c => ({ c, e: E.jobNet(sh, c) }))
      .filter(x => x.e && (style === 'novice' || x.e.net > 0));
    if (jobs.length) {
      // novice looks at the freight figure only; everyone else at profit per day
      // tender cargo comes first for everyone but the novice: missing it costs a penalty and trust
      jobs.sort((a, b) => (style !== 'novice') * ((b.c.kind === 'tender') - (a.c.kind === 'tender')) || (style === 'novice' ? b.c.pay - a.c.pay : b.e.perDay - a.e.perDay));
      const to = jobs[0].c.to;
      for (const x of jobs) if (x.c.to === to && E.fits(sh, x.c)) E.doLoad(x.c.id, sh);
      if (!E.doSail(sh, to) && t.tank) { E.doRefuel(sh, 1); E.doSail(sh, to); }
      if (sh.voy) { idle.set(sh.id, 0); return; }
    }
    const d = (idle.get(sh.id) || 0) + 1; idle.set(sh.id, d);
    if (layupAllowed && !sh.cons.length) {
      const limit = style === 'expansion' ? 12 : 6;
      if (d > limit) { E.doLayup(sh); return; }
    }
    // reposition empty to the port with the most suitable work, if worth it
    const waitFirst = style === 'safe' ? 2 : 0;
    if (d <= waitFirst || sh.cons.length) return;
    const R = E.routes(sh.loc, t); let best = null;
    for (const p in R.dist) {
      if (!E.PORTS[p] || p === sh.loc || !inFocus(sh, p)) continue;
      const work = S.contracts.filter(c => c.from === p && E.canCarry(sh, c.good) && (c.kind === 'tender' || c.q <= t.cap)).reduce((a, c) => a + (c.kind === 'tender' ? Math.min(c.q, t.cap) * c.rate * 1.5 : c.pay), 0);
      const pl = E.plan(sh, p); if (!pl) continue;
      const v = work - pl.cost * 2; if (!best || v > best.v) best = { p, v };
    }
    if (best && best.v > 0) { if (!E.doSail(sh, best.p) && t.tank) { E.doRefuel(sh, 1); E.doSail(sh, best.p); } }
  }

  function serviceTurn(sh) {
    const t = E.T(sh), P = E.PORTS[sh.loc];
    if (t.tank) E.doRefuel(sh, 1);
    if (t.role === 'tour') { if (P.tour) sh.mode = 'tour'; return; }
    if (t.role === 'bunker') { if (P.traffic) sh.mode = 'bunker'; return; }
    if (t.role === 'fish' && P.fish) E.doFish(sh);
  }

  function bid() {
    const Tn = E.S.tender;
    if (!Tn || Tn.state !== 'open' || Tn.bid) return;
    if (style === 'novice') { E.doBid('high'); return; }
    const odds = E.tenderOdds(Tn, 'mid');
    if (odds !== 'low') E.doBid(style === 'expansion' && odds === 'high' ? 'high' : 'mid');
    else if (style === 'expansion' && E.tenderOdds(Tn, 'low') !== 'low') E.doBid('low');
  }

  function invest() {
    const S = E.S, nw = E.netWorth();
    const cargo = S.ships.filter(s => E.T(s).role === 'cargo');
    const active = cargo.filter(s => s.mode !== 'layup' && s.mode !== 'react');
    // bring a laid-up ship back when its own port has paying work for it again
    for (const sh of cargo) {
      if (sh.mode !== 'layup' || S.cash < E.fullWage(sh) * 8) continue;
      const work = S.contracts.filter(c => c.from === sh.loc && E.canCarry(sh, c.good) && c.q <= E.T(sh).cap && (E.jobNet(sh, c) || { net: -1 }).net > E.fullWage(sh) * 5);
      if (work.length) E.doReactivate(sh);
    }
    const share = { safe: 0.4, expansion: 0.6, specialist: 0.4, novice: 1 }[style];
    const reserve = { safe: 1.5, expansion: 1.05, specialist: 1.4, novice: 1.0 }[style];
    const target = Object.entries(E.SHIPS)
      .filter(([, t]) => t.era <= S.era && t.role === 'cargo' && E.newPrice(t) <= Math.max(1000, nw * share))
      .sort((a, b) => b[1].price - a[1].price)[0];
    if (!target) return;
    const busyEnough = style === 'novice' || style === 'expansion' || S.contracts.length > active.length * 1.3;
    // fleet limit reached: trade up by selling the smallest empty cargo ship in port (the novice never does)
    if (style !== 'novice' && E.fleetCount() >= E.fleetLimit()) {
      const small = cargo.filter(s => s.loc && !s.voy && !s.cons.length && s.mode !== 'repair' && s.mode !== 'react' && E.T(s).cap * 4 <= target[1].cap).sort((a, b) => E.T(a).cap - E.T(b).cap)[0];
      if (small && S.cash >= E.newPrice(target[1]) * reserve - E.shipValue(small)) E.doSellShip(small);
    }
    if (S.cash >= E.newPrice(target[1]) * reserve && busyEnough && (style !== 'safe' || S.idx > 0.85)) E.doOrder(target[0]);
  }

  return function turn() {
    for (const sh of E.S.ships) {
      if (!sh.loc || sh.voy || sh.mode === 'fishing' || sh.mode === 'react' || sh.mode === 'layup') continue;
      if (E.T(sh).role === 'cargo') cargoTurn(sh); else serviceTurn(sh);
    }
    bid();
    invest();
  };
}

module.exports = { makeBot, STYLES: ['safe', 'expansion', 'specialist', 'novice'] };
