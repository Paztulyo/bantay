// Header visitor chip: shows when the counter answers, stays hidden when it is off.
const { chromium } = require('playwright');
const { BASE, OUT, LAUNCH } = require('./env');
const args = Object.fromEntries(process.argv.slice(2).map(a => [a.split('=')[0], a.split('=')[1] ?? '1']));
const W = +(args.w || 1440), H = +(args.h || 900), dark = !!args.dark, mode = args.mode || 'ok', sfx = `_${W}${dark ? '_dark' : ''}_${mode}`;
(async () => {
  const browser = await chromium.launch({ ...LAUNCH });
  const mobile = W < 768;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  const logs = []; page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error') logs.push('[console] ' + m.text()); });
  const calls = [];
  await page.route('**/api/views**', r => {
    calls.push(r.request().method() + ' ' + new URL(r.request().url()).search);
    const body = mode === 'ok' ? { status: 'ok', visitors: 12431, views: 30877, counted: false } : mode === 'one' ? { status: 'ok', visitors: 1, views: 1, counted: false } : { status: mode };
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('https://cdn.jsdelivr.net/**', r => r.abort());
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.goto(BASE + '/?test=1', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => {
    const c = document.querySelector('#visChip'), r = c.getBoundingClientRect(), top = document.querySelector('.top').getBoundingClientRect();
    return { hidden: c.hidden, display: getComputedStyle(c).display, text: c.textContent.trim(), w: Math.round(r.width), x: Math.round(r.left), y: Math.round(r.top), inHeader: r.bottom <= top.bottom + 1 && r.right <= innerWidth, headerH: Math.round(top.height), note: !!document.querySelector('#visNote'), hasVis: document.querySelector('.ctx').classList.contains('has-vis'), shown: [...document.querySelectorAll('.ctx .chip')].filter(c => c.getBoundingClientRect().width > 0).map(c => c.id || c.textContent.trim().slice(0,7)).join(',') };
  });
  logs.push(`${mode} ${JSON.stringify(st)} calls=${JSON.stringify(calls)}`);
  await page.screenshot({ path: OUT + 'vis' + sfx + '.png', clip: { x: 0, y: 0, width: W, height: Math.min(H, st.headerH + 20) } });
  console.log(logs.join('\n'));
  await browser.close();
})();
