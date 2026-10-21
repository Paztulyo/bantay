// Larger screens: the month and weather panel folds to the right edge, the legend to the left; both remember it.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const THREE_DIR = path.join(__dirname, 'node_modules/three');
const { BASE, OUT, LAUNCH } = require('./env');
const args = Object.fromEntries(process.argv.slice(2).map(a => [a.split('=')[0], a.split('=')[1] ?? '1']));
const W = +(args.w || 1440), H = +(args.h || 900), dark = !!args.dark, sfx = `_${W}${dark ? 'd' : ''}`;

(async () => {
  const browser = await chromium.launch({ ...LAUNCH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const logs = [], fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); logs.push((c ? 'PASS ' : 'FAIL ') + m); };
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.147.0/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(THREE_DIR, r.request().url().split('three@0.147.0/')[1])) }));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.route('**/api/views**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"off"}' }));
  const load = async () => {
    await page.goto(BASE + '/?test=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__wx && __wx.now && document.querySelector('#wxcard .wxc-temp b') && document.querySelector('#legend .row'), null, { timeout: 180000 });
  };
  const st = () => page.evaluate(() => {
    const R = e => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
    const p = document.querySelector('#ovPanel'), t = document.querySelector('#ovTab'), lp = document.querySelector('.ov-bl'), lt = document.querySelector('#legTab');
    return {
      vp: R(document.querySelector('#vp')), badge: R(document.querySelector('#mbadge')), card: R(document.querySelector('#wxcard')), tab: R(t), legend: R(document.querySelector('#legend')), ltab: R(lt),
      tuckR: p.classList.contains('tucked'), tuckL: lp.classList.contains('tucked'), open: p.classList.contains('open'),
      badgeVis: getComputedStyle(document.querySelector('#mbadge')).visibility, cardVis: getComputedStyle(document.querySelector('#wxcard')).visibility, legVis: getComputedStyle(document.querySelector('#legend')).visibility,
      tabText: document.querySelector('#ovSum').textContent.trim(), tabExp: t.getAttribute('aria-expanded'), tabLabel: t.getAttribute('aria-label'),
      ltabText: lt.textContent.trim(), ltabExp: lt.getAttribute('aria-expanded'), ltabLabel: lt.getAttribute('aria-label'), ltabW: Math.round(lt.getBoundingClientRect().width),
      store: [localStorage.getItem('bantay.tuckR'), localStorage.getItem('bantay.tuckL')], instant: document.querySelector('#vp').classList.contains('ov-instant'),
      transR: getComputedStyle(p).transform, focus: document.activeElement?.id,
    };
  });
  const offRight = () => page.waitForFunction(() => { const v = document.querySelector('#vp').getBoundingClientRect(), b = document.querySelector('#mbadge').getBoundingClientRect(); return b.left >= v.right - 1 && getComputedStyle(document.querySelector('#mbadge')).visibility === 'hidden'; }, null, { timeout: 30000 }).catch(() => logs.push('right panel never left'));
  const offLeft = () => page.waitForFunction(() => { const v = document.querySelector('#vp').getBoundingClientRect(), b = document.querySelector('#legend').getBoundingClientRect(); return b.right <= v.left + 1 && getComputedStyle(document.querySelector('#legend')).visibility === 'hidden'; }, null, { timeout: 30000 }).catch(() => logs.push('legend never left'));
  const settled = () => page.waitForFunction(() => !document.querySelector('#vp').classList.contains('ov-instant') && [...document.querySelectorAll('#ovPanel,.ov-bl,#ovTab,#legTab')].every(e => e.getAnimations({ subtree: true }).filter(a => a instanceof CSSTransition).length === 0), null, { timeout: 30000 }).catch(() => logs.push('transitions never settled'));
  const shot = async name => { try { await page.screenshot({ path: OUT + name + sfx + '.png', timeout: 90000 }); } catch (e) { logs.push('shot failed ' + name); } };

  await load(); await page.evaluate(() => { localStorage.removeItem('bantay.tuckR'); localStorage.removeItem('bantay.tuckL'); }); await load();
  await page.waitForTimeout(800);
  let s = await st(); logs.push('open ' + JSON.stringify(s));
  ok(!s.tuckR && !s.tuckL && s.badgeVis === 'visible' && s.cardVis === 'visible' && s.legVis === 'visible', 'everything starts open on a large screen');
  ok(s.tab[2] <= s.badge[0] + 1 && s.tab[2] - s.tab[0] < 50 && s.tabExp === 'true' && /Hide/.test(s.tabLabel), `the right panel has a small handle on its left edge (${s.tab[2] - s.tab[0]}px)`);
  ok(s.ltab[0] >= s.legend[2] - 1 && s.ltabW < 50 && s.ltabExp === 'true' && /Hide the legend/.test(s.ltabLabel), `the legend has a small handle on its right edge (${s.ltabW}px)`);
  await shot('tk_open');

  // fold the right panel
  await page.click('#ovTab'); await offRight(); await settled();
  s = await st(); logs.push('right folded ' + JSON.stringify({ badge: s.badge, card: s.card, tab: s.tab, vp: s.vp, text: s.tabText }));
  ok(s.tuckR && s.badge[0] >= s.vp[2] - 1 && s.card[0] >= s.vp[2] - 1, 'the month and weather slide off the right edge');
  ok(s.badgeVis === 'hidden' && s.cardVis === 'hidden', 'and leave the tab order');
  ok(Math.abs(s.tab[2] - s.vp[2]) <= 3 && /°/.test(s.tabText) && s.tab[2] - s.tab[0] >= 70 && s.tabExp === 'false', `the tab waits at the edge with the temperature ("${s.tabText}")`);
  ok(s.store[0] === '1', 'and the fold is remembered');

  // fold the legend
  await page.click('#legTab'); await offLeft(); await settled();
  s = await st(); logs.push('legend folded ' + JSON.stringify({ legend: s.legend, ltab: s.ltab, vp: s.vp, text: s.ltabText }));
  ok(s.tuckL && s.legend[2] <= s.vp[0] + 1 && s.legVis === 'hidden', 'the legend slides off the left edge');
  ok(Math.abs(s.ltab[0] - s.vp[0]) <= 3 && s.ltabText === 'Legend' && s.ltabW >= 60 && s.ltabExp === 'false', `its tab waits at the left edge, labelled (${s.ltabW}px)`);
  await shot('tk_folded');

  // a reload keeps both folded, placed without the slide
  await load();
  s = await st(); logs.push('reloaded ' + JSON.stringify({ tuckR: s.tuckR, tuckL: s.tuckL, transR: s.transR, badge: s.badge, vp: s.vp }));
  ok(s.tuckR && s.tuckL && s.badge[0] >= s.vp[2] - 1, 'a reload keeps both folded');

  // keyboard: Enter on the handles brings them back
  await page.focus('#legTab'); await page.keyboard.press('Enter'); await settled();
  await page.focus('#ovTab'); await page.keyboard.press('Enter'); await settled();
  s = await st();
  ok(!s.tuckR && !s.tuckL && s.badgeVis === 'visible' && s.legVis === 'visible' && s.store.join() === '0,0' && s.focus === 'ovTab', 'Enter on each handle brings it back, remembered, focus kept');

  // the legend's content is redrawn by mode changes; the handle survives
  await page.click('.modes [data-mode="water"]'); await page.waitForTimeout(800);
  s = await st(); ok(!!(await page.$('#legTab')) && s.ltab[0] >= s.legend[2] - 1, 'switching modes keeps the legend handle');
  await page.click('.modes [data-mode="pacific"]'); await page.waitForTimeout(1200);
  await page.click('#ovTab'); await offRight(); await settled();
  s = await st(); ok(s.tuckR && s.badge[0] >= s.vp[2] - 1 && /\S/.test(s.tabText), `in Pacific (no weather) the tab shows the month ("${s.tabText}")`);
  await page.click('#ovTab'); await page.waitForTimeout(500);
  await page.click('.modes [data-mode="outlook"]'); await page.waitForTimeout(800);

  // crossing to phone width folds the right panel the phone way and hides the legend tab; back again restores
  await page.click('#ovTab'); await page.waitForTimeout(600); // fold on desktop
  await page.setViewportSize({ width: 390, height: 844 }); await offRight(); await settled();
  s = await st(); ok(!s.open && s.badge[0] >= s.vp[2] - 1 && (await page.$eval('#legTab', e => getComputedStyle(e).display)) === 'none', 'at phone width the panel is folded and the legend tab is gone');
  await page.setViewportSize({ width: W, height: H }); await page.waitForTimeout(400); await settled();
  s = await st(); ok(s.tuckR && !s.tuckL, 'back at full width, the remembered folds return');

  logs.push(fails.length ? `${fails.length} FAILED` : 'ALL PASS');
  console.log(logs.join('\n'));
  await browser.close();
})();
