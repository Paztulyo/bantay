// The burn-away close: copy and canvas appear, the fire climbs, the copy goes in about a second, everything cleans
// up; reopening or opening another drawer puts the fire out; reduced motion skips it; scroll position is kept.
const { chromium } = require('playwright');
const { BASE, LAUNCH } = require('./env');
const args = Object.fromEntries(process.argv.slice(2).map(a => [a.split('=')[0], a.split('=')[1] ?? '1']));
(async () => {
  const browser = await chromium.launch({ ...LAUNCH });
  const logs = [], fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); logs.push((c ? 'PASS ' : 'FAIL ') + m); };
  const open = async opts => {
    const page = await (await browser.newContext(opts)).newPage();
    page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) logs.push('[console] ' + m.text()); });
    await page.route('https://cdn.jsdelivr.net/**', r => r.abort());
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route('https://fonts.gstatic.com/**', r => r.abort());
    await page.route('**/api/views**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"off"}' }));
    await page.goto(BASE + '/?test=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#gq'), null, { timeout: 60000 });
    await page.waitForTimeout(600);
    return page;
  };
  const st = page => page.evaluate(() => {
    const g = document.querySelector('.drawer-ghost'), p = g && g.querySelector('.drawer-c');
    const ys = p && p.style.clipPath ? [...p.style.clipPath.matchAll(/(-?[\d.]+)px (-?[\d.]+)px/g)].map(m => +m[2]).slice(3, -1) : [];
    return {
      guide: !document.querySelector('#guide').hidden, src: !document.querySelector('#drawer').hidden,
      ghost: document.querySelectorAll('.drawer-ghost').length, cv: document.querySelectorAll('.smoke-cv').length,
      maxY: ys.length ? Math.max(...ys) : null, minY: ys.length ? Math.min(...ys) : null, h: p ? p.getBoundingClientRect().height : null,
      scroll: p ? p.scrollTop : null, ghostIds: g ? g.querySelectorAll('[id]').length : null, ghostInert: g ? g.inert : null,
      cvW: document.querySelector('.smoke-cv')?.width || 0,
    };
  });
  const until = (page, fn, arg, ms = 6000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 20 }).then(() => true).catch(() => false);

  for (const mode of [{ w: 1100, h: 760 }, { w: 390, h: 844, mobile: true }]) {
    const tag = mode.mobile ? '[phone] ' : '[desktop] ';
    const page = await open({ viewport: { width: mode.w, height: mode.h }, isMobile: !!mode.mobile, hasTouch: !!mode.mobile, deviceScaleFactor: mode.mobile ? 3 : 1 });
    // open, scroll, close
    await page.click('#guideBtn'); await page.waitForTimeout(400);
    await page.evaluate(() => { document.querySelector('#guide .drawer-c').scrollTop = 260; }); await page.waitForTimeout(200);
    const want = await page.evaluate(() => document.querySelector('#guide .drawer-c').scrollTop);
    const t0 = Date.now();
    await page.click('#guideClose');
    let s = await st(page);
    ok(!s.guide && s.ghost === 1 && s.cv === 1 && s.ghostInert && s.ghostIds === 0, tag + 'Close hides the drawer and leaves an inert, id-free copy with a canvas');
    ok(Math.abs(s.scroll - want) <= 1, tag + `the copy keeps the scroll position (${s.scroll} vs ${want})`);
    ok(s.cvW > 0 && s.cvW <= Math.ceil(mode.w * 1.4) + 1, tag + `the canvas is capped in density (${s.cvW}px wide for ${mode.w})`);
    // the fire climbs: sample the clip line a few times
    const samples = [];
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(110); const x = await st(page); if (x.maxY != null) samples.push([Date.now() - t0, Math.round(x.maxY), Math.round(x.minY), Math.round(x.h)]); }
    logs.push(tag + 'clip line (ms, lowest, highest, panel h): ' + samples.map(a => a.join('/')).join('  '));
    const climbs = samples.length >= 3 && samples.every((a, i) => i === 0 || a[1] <= samples[i - 1][1]) && samples[samples.length - 1][1] < samples[0][1];
    ok(climbs, tag + 'the fire line only ever climbs');
    ok(samples.length && samples[0][2] < samples[0][1] - 20, tag + 'and its edge is ragged, not a straight wipe');
    const gone = await until(page, () => !document.querySelector('.drawer-ghost'), null, 4000);
    const tGone = Date.now() - t0;
    ok(gone && tGone < 1700, tag + `the panel is gone in about a second (${tGone} ms incl. test overhead)`);
    const clean = await until(page, () => !document.querySelector('.smoke-cv'), null, 5000);
    ok(clean && Date.now() - t0 < 3900, tag + `the embers and smoke clear by themselves (${Date.now() - t0} ms)`);

    // reopen mid-burn
    await page.click('#guideBtn'); await page.waitForTimeout(300);
    await page.click('#guideClose'); await page.waitForTimeout(250);
    await page.click('#guideBtn'); await page.waitForTimeout(60);
    s = await st(page);
    ok(s.guide && s.ghost === 0 && s.cv === 0, tag + 'reopening mid-burn puts the fire out and shows the drawer');
    // Escape closes with the burn too
    await page.keyboard.press('Escape'); await page.waitForTimeout(60);
    s = await st(page); ok(!s.guide && s.ghost === 1, tag + 'Escape closes with the burn');
    // opening the other drawer mid-burn puts the fire out
    await page.waitForTimeout(150);
    await page.evaluate(() => document.querySelector('#srcBtn').click()); await page.waitForTimeout(60);
    s = await st(page); ok(s.src && s.ghost === 0 && s.cv === 0, tag + 'opening Sources mid-burn puts the fire out');
    await page.click('#srcClose'); await page.waitForTimeout(60);
    s = await st(page); ok(!s.src && s.ghost === 1 && s.cv === 1, tag + 'Sources burns away too');
    await until(page, () => !document.querySelector('.smoke-cv'), null, 5000);
    await page.context().close();
  }

  // reduced motion: drawers simply close
  const page = await open({ viewport: { width: 1100, height: 760 }, reducedMotion: 'reduce' });
  await page.click('#guideBtn'); await page.waitForTimeout(300); await page.click('#guideClose'); await page.waitForTimeout(80);
  const s = await st(page); ok(!s.guide && s.ghost === 0 && s.cv === 0, 'with reduced motion the drawer simply closes');

  logs.push(fails.length ? `${fails.length} FAILED` : 'ALL PASS');
  console.log(logs.join('\n'));
  await browser.close();
})();
