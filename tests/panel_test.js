// Phone pull-tab test: closed by default, opens and closes by tap, swipe and Escape, follows the town and mode,
// stays inside the map at small widths, and on desktop is only a small fold handle.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const THREE_DIR = path.join(__dirname, 'node_modules/three');
const { BASE, OUT, LAUNCH } = require('./env');
const args = Object.fromEntries(process.argv.slice(2).map(a => [a.split('=')[0], a.split('=')[1] ?? '1']));
const W = +(args.w || 390), H = +(args.h || 844), dark = !!args.dark, sfx = args.sfx || '';

(async () => {
  const browser = await chromium.launch({ ...LAUNCH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const mobile = W < 768;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, reducedMotion: args.rm ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const logs = [], fails = [];
  const ok = (cond, msg) => { if (!cond) fails.push(msg); logs.push((cond ? 'PASS ' : 'FAIL ') + msg); };
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.147.0/**', route => {
    const p = route.request().url().split('three@0.147.0/')[1];
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(THREE_DIR, p)) });
  });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.goto(BASE + '/?test=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wx && window.__wx.now && document.querySelector('#wxcard .wxc-temp b'), null, { timeout: 120000 });
  await page.waitForTimeout(1500);

  const state = () => page.evaluate(() => {
    const vp = document.querySelector('#vp').getBoundingClientRect(), p = document.querySelector('#ovPanel'), t = document.querySelector('#ovTab');
    const pr = p.getBoundingClientRect(), tr = t.getBoundingClientRect(), b = document.querySelector('#mbadge'), c = document.querySelector('#wxcard');
    const r = x => Math.round(x);
    return {
      vp: [r(vp.left), r(vp.top), r(vp.right), r(vp.bottom)], panel: [r(pr.left), r(pr.top), r(pr.right), r(pr.bottom)], tab: [r(tr.left), r(tr.top), r(tr.right), r(tr.bottom)],
      tabShown: getComputedStyle(t).display !== 'none', open: p.classList.contains('open'), expanded: t.getAttribute('aria-expanded'), label: t.getAttribute('aria-label'),
      tabText: document.querySelector('#ovSum').textContent, tabK: t.dataset.k, badgeVis: getComputedStyle(b).visibility, cardVis: getComputedStyle(c).visibility,
      cardCollapsed: c.classList.contains('collapsed'), cardScroll: c.scrollHeight > c.clientHeight + 1, transform: getComputedStyle(p).transform,
      hscroll: document.documentElement.scrollWidth > innerWidth, focus: document.activeElement && (document.activeElement.id || document.activeElement.tagName),
      compass: getComputedStyle(document.querySelector('#compass')).opacity
    };
  });
  const shot = async name => { try { await page.screenshot({ path: OUT + name + sfx + '.png', timeout: 60000 }); } catch (e) { logs.push('shot failed ' + name + ': ' + e.message.split('\n')[0]); } };
  const tap = async () => { if (mobile) await page.locator('#ovTab').tap(); else await page.locator('#ovTab').click(); await page.waitForTimeout(600); };

  let s = await state();
  logs.push('closed: ' + JSON.stringify(s));
  if (!mobile) {
    ok(s.tabShown && s.tab[2] - s.tab[0] < 50 && s.expanded === 'true', 'desktop: only the small fold handle shows (tuck_test.js covers folding)');
    ok(s.transform === 'none', 'desktop: panel open, not moved');
    ok(s.badgeVis === 'visible' && s.cardVis === 'visible', 'desktop: badge and card visible');
    await shot('pt_desktop');
  } else {
    ok(s.tabShown, 'tab shown');
    ok(!s.open && s.expanded === 'false', 'starts closed');
    ok(s.panel[0] >= s.vp[2] - 1, 'panel parked past the map edge');
    ok(Math.abs(s.tab[2] - s.vp[2]) <= 2, 'tab flush with the right edge');
    ok(s.tab[0] > s.vp[0] + s.vp[2] * 0.4, 'tab is small (left edge in the right part of the map)');
    ok(s.badgeVis === 'hidden' && s.cardVis === 'hidden', 'closed content hidden from tab order');
    ok(/°/.test(s.tabText), 'tab shows the temperature: ' + s.tabText);
    ok(s.tab[2] - s.tab[0] >= 70, 'temperature is actually visible (tab ' + (s.tab[2] - s.tab[0]) + 'px wide)');
    ok(s.compass === '1', 'compass visible while closed');
    ok(!s.hscroll, 'no horizontal scroll (closed)');
    await shot('pt_closed');

    await tap(); s = await state(); logs.push('open: ' + JSON.stringify(s));
    ok(s.open && s.expanded === 'true', 'tap opens');
    ok(s.panel[0] >= s.vp[0] && s.panel[2] <= s.vp[2], 'open panel inside the map');
    ok(s.tab[0] >= s.vp[0] + 4, 'open tab inside the map');
    ok(s.badgeVis === 'visible' && s.cardVis === 'visible', 'open content visible');
    ok(s.compass === '0', 'compass fades while open');
    ok(s.tab[2] - s.tab[0] <= 44, 'open tab shrinks to a handle (' + (s.tab[2] - s.tab[0]) + 'px)');
    ok(!s.hscroll, 'no horizontal scroll (open)');
    await shot('pt_open');

    await tap(); s = await state();
    ok(!s.open && s.expanded === 'false', 'second tap closes');
    await page.waitForTimeout(300); s = await state();
    ok(s.badgeVis === 'hidden', 'content hidden again after the slide');

    // another town: the tab names it, and a hot town turns the number heat-red
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('bantay:select', { detail: { town: 'Itogon' } })));
    await page.waitForTimeout(400); s = await state();
    ok(/Itogon/.test(s.tabText) && s.tabK === 'hot', 'tab follows the town: ' + s.tabText + ' k=' + s.tabK);
    await shot('pt_town');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('bantay:select', { detail: { town: null } })));
    await page.waitForTimeout(300); s = await state();
    ok(!/Itogon/.test(s.tabText), 'back to Baguio City drops the town name: ' + s.tabText);

    // swipe left on the tab opens, swipe right on the panel closes (synthetic touch pointers)
    const swipe = (sel, dx) => page.evaluate(([sel, dx]) => {
      const el = document.querySelector(sel), r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + Math.min(20, r.height / 2);
      const o = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: x, clientY: y }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: x + dx, clientY: y + 4 }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x + dx, clientY: y + 4 }));
    }, [sel, dx]);
    await swipe('#ovTab', -70); await page.waitForTimeout(600); s = await state();
    ok(s.open, 'swipe left on the tab opens (and the trailing click is swallowed)');
    await swipe('#mbadge', 70); await page.waitForTimeout(600); s = await state();
    ok(!s.open, 'swipe right on the panel closes');
    // a horizontal drag across the hourly chart must not close the panel
    await tap();
    const spark = await page.$('#wxcard .wxc-spark');
    if (spark) { await swipe('#wxcard .wxc-spark', 80); await page.waitForTimeout(400); s = await state(); ok(s.open, 'dragging across the hourly chart keeps it open'); }
    else logs.push('note: card collapsed at this height, chart drag not tested');

    // Escape closes and hands focus back to the tab
    await page.keyboard.press('Escape'); await page.waitForTimeout(500); s = await state();
    ok(!s.open && s.focus === 'ovTab', 'Escape closes and focuses the tab');

    // Pacific mode: no weather, so the tab shows the month
    await page.locator('[data-mode="pacific"]').click(); await page.waitForTimeout(800); s = await state();
    ok(/^[A-Z][a-z]{2}$/.test(s.tabText.trim()), 'Pacific mode tab shows the month: ' + s.tabText);
    await tap(); s = await state();
    ok(s.open && s.panel[0] >= s.vp[0], 'Pacific panel opens inside the map');
    await shot('pt_pacific');
    await tap();
    await page.locator('[data-mode="outlook"]').click(); await page.waitForTimeout(800); s = await state();
    ok(/°/.test(s.tabText), 'back in Outlook the tab shows the temperature again: ' + s.tabText);
    // the open card's own fold state at this map height
    await tap(); s = await state();
    logs.push(`open card collapsed=${s.cardCollapsed} scrolls=${s.cardScroll} map=${s.vp[3] - s.vp[1]}px panel=${s.panel[3] - s.panel[1]}px`);
    await shot('pt_open2');
  }
  logs.push(fails.length ? `${fails.length} FAILED` : 'ALL PASS');
  console.log(logs.join('\n'));
  await browser.close();
})();
