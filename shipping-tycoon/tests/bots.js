// Four operating styles that play the real rules day by day.
'use strict';

function makeBot(E, style, opts = {}) {
  const idle = new Map(); // ship id -> days spent docked with nothing to do
  const layupAllowed = opts.layup !== false && style !== 'novice';
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
    if (t.tank && style !== 'novice' && sh.fuel < t.tank * (style === 'safe' ? 0.6 : 0.9)) E.doRefuel(sh, 1);
    const jobs = S.contracts
      .filter(c => c.from === sh.loc && E.canCarry(sh, c.good) && c.q <= E.freeCap(sh) && inFocus(sh, c.to))
      .map(c => ({ c, e: E.jobNet(sh, c) }))
      .filter(x => x.e && (style === 'novice' || x.e.net > 0));
    if (jobs.length) {
      // novice looks at the freight figure only; everyone else at profit per day
      jobs.sort((a, b) => style === 'novice' ? b.c.pay - a.c.pay : b.e.perDay - a.e.perDay);
      const to = jobs[0].c.to;
      for (const x of jobs) if (x.c.to === to && x.c.q <= E.freeCap(sh)) E.doLoad(x.c.id, sh);
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
      const work = S.contracts.filter(c => c.from === p && c.q <= t.cap && E.canCarry(sh, c.good)).reduce((a, c) => a + c.pay, 0);
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
    if (S.cash >= E.newPrice(target[1]) * reserve && busyEnough && (style !== 'safe' || S.idx > 0.85)) E.doOrder(target[0]);
  }

  return function turn() {
    for (const sh of E.S.ships) {
      if (!sh.loc || sh.voy || sh.mode === 'fishing' || sh.mode === 'react' || sh.mode === 'layup') continue;
      if (E.T(sh).role === 'cargo') cargoTurn(sh); else serviceTurn(sh);
    }
    invest();
  };
}

module.exports = { makeBot, STYLES: ['safe', 'expansion', 'specialist', 'novice'] };
