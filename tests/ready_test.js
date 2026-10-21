// Be ready search, red close buttons and the smoke dissolve.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const THREE_DIR = path.join(__dirname, 'node_modules/three');
const { BASE, OUT, LAUNCH } = require('./env');
const args = Object.fromEntries(process.argv.slice(2).map(a => [a.split('=')[0], a.split('=')[1] ?? '1']));
const W = +(args.w || 1440), H = +(args.h || 900), dark = !!args.dark, sfx = args.sfx || '';

(async () => {
  const browser = await chromium.launch({ ...LAUNCH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const mobile = W < 768;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, reducedMotion: args.rm ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const logs = [], fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); logs.push((c ? 'PASS ' : 'FAIL ') + m); };
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.147.0/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(THREE_DIR, r.request().url().split('three@0.147.0/')[1])) }));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.goto(BASE + '/?test=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#gq') && document.querySelector('#gpanH .hl'), null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const shot = async (name, clip) => { try { await page.screenshot({ path: OUT + name + sfx + '.png', clip, timeout: 60000 }); } catch (e) { logs.push('shot failed ' + name + ': ' + e.message.split('\n')[0]); } };
  const st = () => page.evaluate(() => ({
    open: !document.querySelector('#guide').hidden,
    tab: document.querySelector('#gtabT').getAttribute('aria-selected') === 'true' ? 'tips' : 'hotlines',
    h: document.querySelectorAll('#gpanH .hl li').length, t: document.querySelectorAll('#gpanT .glist li').length,
    none: !!document.querySelector('.guide-c [aria-selected] ~ *, .gnone') && !!document.querySelector('#guide:not([hidden]) .gnone'),
    marks: document.querySelectorAll('#guide .drawer-c mark').length, x: !document.querySelector('#gqX').hidden,
    tabs: [document.querySelector('#gtabH').textContent, document.querySelector('#gtabT').textContent],
    ghost: document.querySelectorAll('.drawer-ghost').length, smoke: document.querySelectorAll('.smoke-cv').length,
    focus: document.activeElement && (document.activeElement.id || document.activeElement.tagName),
  }));
  const type = async q => { await page.fill('#gq', q); await page.waitForTimeout(150); return st(); };

  await page.click('#guideBtn'); await page.waitForTimeout(500);
  let s = await st();
  ok(s.open && s.h >= 17, `drawer opens with all hotlines (${s.h})`);
  const dc = await page.$('#guide .drawer-c'); const box = await dc.boundingBox();
  await shot('rd_open', { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 520) });

  s = await type('water'); logs.push('water: ' + JSON.stringify(s));
  ok(s.h >= 2 && s.marks > 0 && s.x, `"water" finds the water districts (${s.h}) with highlights`);
  await shot('rd_water', { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 560) });
  s = await type('hosp'); ok(s.h >= 6, `"hosp" finds the hospitals (${s.h})`);
  s = await type('ambulance'); ok(s.h >= 2, `"ambulance" reaches EMS and ER lines through synonyms (${s.h})`);
  s = await type('brownout'); ok(s.h === 1, `"brownout" finds BENECO (${s.h})`);
  s = await type('sunog'); ok(s.h >= 1, `"sunog" finds the fire station (${s.h})`);
  s = await type('itogon'); ok(s.h === 1, `"itogon" finds Itogon District Hospital (${s.h})`);
  s = await type('la trinidad'); ok(s.h >= 4, `"la trinidad" finds the La Trinidad group (${s.h})`);
  s = await type('422-1131'); ok(s.h === 1, `a phone number finds its line (${s.h})`);
  s = await type('0917'); ok(s.h === 1, `"0917" finds BENECO Globe (${s.h})`);
  s = await type('kaingin'); ok(s.tab === 'tips' && s.t >= 1 && s.h === 0, `a tips-only word jumps to What to do (${s.t} tips, tab ${s.tab})`);
  await shot('rd_tips', { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 520) });
  s = await type('zzzq'); ok(s.none, 'no-match message shows');
  await shot('rd_none', { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 420) });

  // Escape clears the search first, then closes
  await page.focus('#gq'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  s = await st(); ok(s.open && (await page.inputValue('#gq')) === '' && s.h >= 17, 'Escape clears the search and keeps the drawer open');
  // hover on Close
  await page.hover('#guideClose'); await page.waitForTimeout(450);
  const cb = await (await page.$('#guideClose')).boundingBox();
  await shot('rd_close_hover', { x: cb.x - 12, y: cb.y - 10, width: cb.width + 24, height: cb.height + 20 });
  const cs = await page.evaluate(() => { const b = getComputedStyle(document.querySelector('#guideClose')); return { bg: b.backgroundColor, color: b.color }; });
  logs.push('close hover style ' + JSON.stringify(cs));

  // close with smoke
  await page.click('#guideClose');
  s = await st(); ok(!s.open && s.ghost === 1 && s.smoke === 1, 'Close hides the drawer at once and leaves a dissolving copy with smoke');
  for (const [t, n] of [[120, 'a'], [260, 'b'], [480, 'c'], [800, 'd']]) { await page.waitForTimeout(t - (n === 'a' ? 0 : 0)); await shot('rd_smoke_' + n); }
  await page.waitForTimeout(1800); s = await st(); ok(s.ghost === 0 && s.smoke === 0, 'the copy and the smoke clean themselves up');

  // reopen mid-smoke
  await page.click('#guideBtn'); await page.waitForTimeout(300); await page.click('#guideClose'); await page.waitForTimeout(150);
  await page.click('#guideBtn', { force: true }); await page.waitForTimeout(100);
  s = await st(); ok(s.open && s.ghost === 0 && s.smoke === 0, 'reopening mid-smoke clears the smoke and shows the drawer');
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  s = await st(); ok(!s.open && s.ghost === 1, 'Escape (empty search) closes with smoke too');
  await page.waitForTimeout(2600);

  // the Sources drawer
  await page.click('#srcBtn'); await page.waitForTimeout(400);
  const sx = await page.evaluate(() => getComputedStyle(document.querySelector('#srcClose')).color);
  await page.click('#srcClose');
  s = await st(); const srcHidden = await page.evaluate(() => document.querySelector('#drawer').hidden);
  ok(srcHidden && s.ghost === 1 && s.smoke === 1, `Sources Close is red (${sx}) and dissolves too`);
  await page.waitForTimeout(2600);

  logs.push(fails.length ? `${fails.length} FAILED` : 'ALL PASS');
  console.log(logs.join('\n'));
  await browser.close();
})();
