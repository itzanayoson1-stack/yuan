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

  { // first voyage on a phone: start, load a job, sail, auto-pause on arrival
    const { page, errors } = await open(browser);
    await page.click('[data-act=start]'); await page.click('.shipcard');
    const load = await page.$('[data-act=load]:not([disabled])'); if (load) await load.click();
    await page.click('.dest.has').catch(() => page.click('.dest'));
    await page.waitForTimeout(6000);
    const st = await page.evaluate(() => ({ delivered: S.stats.delivered, playing: UI.playing, view: UI.view }));
    check('첫 항차: 선적 → 출항 → 도착 시 운임과 일시정지', st.delivered >= 1 && !st.playing, JSON.stringify(st));
    for (const t of ['port', 'cons', 'yard', 'rank', 'fleet']) await page.click(`[data-t=${t}]`);
    await page.click('[data-v=kr]'); await page.click('[data-v=nea]');
    const has3d = await page.evaluate(() => P3.ok);
    if (has3d) {
      await page.click('[data-v=port3d]'); await page.waitForTimeout(800);
      const labels = await page.$$eval('.p3lab', els => els.map(e => e.textContent));
      check('3D 항구: 건물 표지가 보이고 누르면 해당 탭이 열림', labels.length >= 3, labels.join(', '));
      await page.click('.p3lab >> nth=0'); const tab = await page.evaluate(() => UI.tab);
      check('3D 항구: 화물 터미널 → 계약 탭', tab === 'cons', tab);
    } else console.log('   -   3D 라이브러리를 불러오지 못해 3D 항구 점검은 건너뜀 (THREE_JS 지정 또는 CDN 접속 필요)');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('휴대폰 400px에서 가로 스크롤 없음', wide <= 0, `넘침 ${wide}px`);
    check('페이지 오류 없음 (밝은 화면)', errors.length === 0, errors.join(' | '));
    await page.close();
  }
  { // 3D library unavailable → 2D chart instead
    const { page, errors } = await open(browser, { blockThree: true });
    await page.click('[data-act=start]'); await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({ view: UI.view, map: getComputedStyle(document.querySelector('#map')).visibility, p3: document.querySelector('#vP3').hidden }));
    check('3D 라이브러리를 못 불러오면 2D 지도로 대체', st.view !== 'port3d' && st.map === 'visible' && st.p3, JSON.stringify(st));
    check('페이지 오류 없음 (3D 없음)', errors.length === 0, errors.join(' | '));
    await page.close();
  }
  { // dark theme + desktop width
    const { page, errors } = await open(browser, { width: 1280, height: 820, dark: true });
    await page.click('[data-act=start]'); await page.waitForTimeout(1500);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('다크 모드 배경이 어두움', /rgb\((\d+), (\d+), (\d+)\)/.test(bg) && bg.match(/\d+/g).slice(0, 3).every(v => Number(v) < 60), bg);
    check('페이지 오류 없음 (다크·데스크톱)', errors.length === 0, errors.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log(`\n${pass}개 통과 · ${fail}개 실패`);
  if (fail) process.exitCode = 1;
})();
