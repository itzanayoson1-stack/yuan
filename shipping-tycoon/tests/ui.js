// Browser checks for the page itself (needs Playwright: npm i -D playwright).
// Usage: node tests/ui.js
'use strict';
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('Playwright가 없어 화면 테스트를 건너뜁니다 (npm i -D playwright)'); process.exit(0); }
// three.js normally comes from the CDN; set THREE_JS=/path/to/three.min.js to test offline
let THREE_LOCAL = null;
try { if (process.env.THREE_JS) THREE_LOCAL = require('fs').readFileSync(process.env.THREE_JS, 'utf8'); } catch (e) { console.log('THREE_JS 파일을 읽지 못해 CDN을 씁니다'); }
const PAGE = 'file://' + path.join(__dirname, '..', 'index.html');

let pass = 0, fail = 0;
const check = (name, okv, detail = '') => { okv ? pass++ : fail++; console.log(` ${okv ? '통과' : '실패'}  ${name}${detail ? ' · ' + detail : ''}`); };

async function open(browser, { width = 400, height = 860, dark = false, blockThree = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: dark ? 'dark' : 'light' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await page.route('**/three.min.js', r => blockThree ? r.abort() : THREE_LOCAL ? r.fulfill({ body: THREE_LOCAL, contentType: 'application/javascript' }) : r.continue());
  await page.goto(PAGE); await page.waitForTimeout(800);
  return { page, errors };
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  console.log('\n선박왕 화면 점검\n');

  { // first voyage on a phone, following the goal card: exchange → load → sail → settlement → next choice
    const { page, errors } = await open(browser);
    await page.click('[data-act=start]'); await page.waitForTimeout(300);
    const g0 = await page.textContent('.goal:visible');
    check('오늘의 목표 카드가 첫 할 일을 알려 줌', /첫 의뢰/.test(g0), g0.slice(0, 40));
    await page.click('.goal:visible .gbtn');
    check('목표 버튼 → 모항 거래소 화물 벽보', await page.evaluate(() => UI.tab === 'home' && UI.bld === 'exchange' && !!document.querySelector('.board')));
    await page.click('.board [data-act=load]:not([disabled])');
    await page.click('.dest.has');
    await page.waitForSelector('#modal:not([hidden]) [data-act=tripnext]', { timeout: 15000 }).catch(() => {});
    const st = await page.evaluate(() => ({ delivered: S.stats.delivered, playing: UI.playing, modal: !$('#modal').hidden, net: S.ships[0].lastTrip && S.ships[0].lastTrip.net }));
    check('첫 항차: 선적 → 출항 → 도착 시 정산표와 일시정지', st.delivered >= 1 && !st.playing && st.modal, JSON.stringify(st));
    const rows = await page.$$eval('#modal .trip tr', els => els.length);
    check('정산표에 운임·연료비·고정비·입항료·순이익', rows >= 5, rows + '줄');
    await page.click('[data-act=tripnext][data-n=ex]');
    const nx = await page.evaluate(() => ({ bld: UI.bld, port: UI.port, to: S.ships[0].loc, m: UI.metrics }));
    check('다음 선택 → 도착 항구의 거래소', nx.bld === 'exchange' && nx.port === nx.to, JSON.stringify({ bld: nx.bld, port: nx.port }));
    check('첫 항차 기록이 남음 (선적·출항·정산·다음 선택)', ['load', 'sail', 'settle', 'next'].every(k => nx.m[k] > 0), `누른 횟수 ${nx.m.clicksAtNext}회`);
    console.log(`        첫 항차까지 누른 횟수 ${nx.m.clicksAtNext}회 (자동 테스트라 시간은 의미 없음)`);
    for (const t of ['map', 'fleet', 'home']) { await page.click(`#tabs [data-t=${t}]`); }
    await page.click('#tabs [data-t=map]'); await page.click('[data-v=nea]'); await page.click('[data-v=kr]');
    await page.click('#tabs [data-t=fleet]'); await page.click('[data-act=fsub][data-x=co]');
    check('회사 장부: 운송·부가 수입과 선박 매매가 따로', await page.evaluate(() => /운송 수입/.test(document.body.textContent) && /부가 수입/.test(document.body.textContent) && /선박 매입/.test(document.body.textContent)));
    await page.click('#tabs [data-t=home]'); await page.click('[data-act=bld][data-b=exchange]'); await page.click('[data-act=extab][data-x=sp]');
    check('거래소 중고선 매매 탭', await page.evaluate(() => /매물/.test($('#panel').textContent)));
    await page.click('[data-act=extab][data-x=tender]');
    check('거래소 입찰 탭 (다음 공고 안내)', await page.evaluate(() => /입찰/.test($('#panel').textContent) && /28일마다/.test($('#panel').textContent)));
    await page.click('[data-act=bld][data-b=""]'); await page.click('[data-act=bld][data-b=teahouse]');
    check('닻 다방: 첫 방문 소개와 선장 구인', await page.evaluate(() => !!document.querySelector('.intro') && document.querySelectorAll('[data-act=hire]').length === 3));
    await page.click('[data-act=seen]');
    check('소개는 한 번 보면 다시 안 나옴', await page.evaluate(() => !document.querySelector('.intro')));
    await page.evaluate(() => { S.cash = 5000; render(); });
    await page.click('[data-act=hire] >> nth=0');
    check('선장 고용 → 배에 선장', await page.evaluate(() => !!S.ships[0].capt));
    // tender: force a notice, bid, and see the result
    await page.evaluate(() => { S.ships.push(Object.assign(JSON.parse(JSON.stringify(S.ships[0])), { id: 99, name: '똑딱 2호', capt: null, loc: S.home, voy: null, cons: [] })); const t = newTender(0.2, 0.5); t.rival = 0.5; t.from = S.home; S.tender = t; render(); });
    await page.click('[data-act=bld][data-b=""]'); await page.click('[data-act=bld][data-b=exchange]'); await page.click('[data-act=extab][data-x=tender]');
    await page.click('[data-act=bid][data-b=mid]');
    check('입찰 응찰', await page.evaluate(() => S.tender.bid === 'mid'));
    await page.evaluate(() => { for (let i = 0; i < 6; i++) tick(); render(); });
    check('낙찰 → 입찰 화물이 벽보에', await page.evaluate(() => S.tender.state === 'won' && S.contracts.some(c => c.kind === 'tender')));
    // yard: worn ship can be repaired, then cannot sail
    await page.evaluate(() => { const sh = S.ships.find(s => s.loc === S.home && !s.voy && !s.cons.length); sh.cond = 50; sh.mode = 'idle'; UI.port = S.home; render(); });
    await page.click('[data-act=bld][data-b=""]'); await page.click('[data-act=bld][data-b=yard]');
    await page.click('[data-act=repair] >> nth=0');
    check('조선·정비소 수리 시작', await page.evaluate(() => S.ships.some(s => s.mode === 'repair')));
    const has3d = await page.evaluate(() => P3.ok && p3Ready);
    if (has3d) {
      await page.click('#tabs [data-t=home]'); await page.waitForTimeout(800);
      const labels = await page.$$eval('.p3lab', els => els.map(e => e.textContent));
      await page.evaluate(() => { UI.dayMode = 'night'; render(); }); await page.waitForTimeout(300);
      check('낮밤: 밤으로 바꾸면 항구가 밤 하늘', await page.evaluate(() => document.querySelector('#p3').classList.contains('night')));
      check('3D 항구: 건물 표지 (거래소·닻 다방·조선·정비소)', labels.some(l => l.startsWith('거래소')) && labels.some(l => l.includes('다방')), labels.join(', '));
      await page.click('.p3lab >> nth=0'); const b = await page.evaluate(() => UI.bld);
      check('3D 항구: 거래소를 누르면 거래소가 열림', b === 'exchange', b);
    } else console.log('   -   3D 라이브러리를 불러오지 못해 3D 항구 점검은 건너뜀 (THREE_JS 지정 또는 CDN 접속 필요)');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('휴대폰 400px에서 가로 스크롤 없음', wide <= 0, `넘침 ${wide}px`);
    await page.screenshot({ path: path.join(__dirname, 'out-phone.png') }).catch(() => {});
    check('페이지 오류 없음 (밝은 화면)', errors.length === 0, errors.join(' | '));
    await page.close();
  }
  { // 3D library unavailable → 2D chart instead
    const { page, errors } = await open(browser, { blockThree: true });
    await page.click('[data-act=start]'); await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({ view: UI.view, map: getComputedStyle(document.querySelector('#map')).visibility }));
    check('3D 라이브러리를 못 불러오면 2D 지도로 대체', st.view !== 'port3d' && st.map === 'visible', JSON.stringify(st));
    await page.click('.goal:visible .gbtn');
    check('3D 없이도 거래소가 열림', await page.evaluate(() => !!document.querySelector('.board')));
    check('페이지 오류 없음 (3D 없음)', errors.length === 0, errors.join(' | '));
    await page.close();
  }
  { // dark theme + desktop width
    const { page, errors } = await open(browser, { width: 1280, height: 820, dark: true });
    await page.click('[data-act=start]'); await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(__dirname, 'out-desktop.png') }).catch(() => {});
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('다크 모드 배경이 어두움', /rgb\((\d+), (\d+), (\d+)\)/.test(bg) && bg.match(/\d+/g).slice(0, 3).every(v => Number(v) < 60), bg);
    check('페이지 오류 없음 (다크·데스크톱)', errors.length === 0, errors.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log(`\n${pass}개 통과 · ${fail}개 실패`);
  if (fail) process.exitCode = 1;
})();
