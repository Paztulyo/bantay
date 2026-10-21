// The visitor chip in the header: shows the count when the counter answers, says "visitor" for one, stays hidden when
// the counter is off or failing, fits the header on desktop and phone, and never counts an automated browser.
const { chromium } = require('playwright');
const { BASE, OUT, LAUNCH } = require('./env');

(async () => {
  const browser = await chromium.launch({ ...LAUNCH });
  const logs = [], fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); logs.push((c ? 'PASS ' : 'FAIL ') + m); };

  async function look({ w = 1440, h = 900, mode }) {
    const mobile = w < 768;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
    const calls = [];
    await page.route('**/api/views**', r => {
      calls.push(r.request().method() + ' ' + new URL(r.request().url()).search);
      if (mode === 'error') return r.fulfill({ status: 500, contentType: 'application/json', body: '{"status":"error"}' });
      const body = mode === 'ok' ? { status: 'ok', visitors: 12431, views: 30877, counted: false } : mode === 'one' ? { status: 'ok', visitors: 1, views: 1, counted: false } : { status: 'off' };
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.route('https://cdn.jsdelivr.net/**', r => r.abort()); // the map isn't needed here
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route('https://fonts.gstatic.com/**', r => r.abort());
    await page.goto(BASE + '/?test=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#gq'), null, { timeout: 60000 });
    await page.waitForTimeout(1200);
    const s = await page.evaluate(() => {
      const c = document.querySelector('#visChip'), r = c.getBoundingClientRect(), top = document.querySelector('.top').getBoundingClientRect();
      return {
        hidden: c.hidden || getComputedStyle(c).display === 'none', text: c.textContent.replace(/\s+/g, ' ').trim(),
        inHeader: r.top >= top.top - 1 && r.bottom <= top.bottom + 1 && r.left >= 0 && r.right <= innerWidth, headerH: Math.round(top.height),
        hasVis: document.querySelector('.ctx').classList.contains('has-vis'), note: !!document.querySelector('#visNote'),
        hscroll: document.documentElement.scrollWidth > innerWidth,
      };
    });
    if (mode === 'ok') await page.screenshot({ path: `${OUT}vis_${w}.png`, clip: { x: 0, y: 0, width: w, height: Math.min(h, s.headerH + 20) } });
    await ctx.close();
    return { ...s, calls };
  }

  let s = await look({ mode: 'ok' });
  logs.push('desktop ' + JSON.stringify(s));
  ok(!s.hidden && s.text === '12,431 visitors' && s.hasVis, 'desktop: the count shows in the header');
  ok(s.inHeader && s.headerH <= 60, `desktop: it fits without growing the header (${s.headerH}px)`);
  ok(s.note, 'Sources explains how visitors are counted');
  ok(s.calls.length === 1 && s.calls[0] === 'GET ', `an automated browser only reads the count (${s.calls.join(', ')})`);

  s = await look({ mode: 'one' });
  ok(!s.hidden && s.text === '1 visitor', `one visitor reads "1 visitor" ("${s.text}")`);

  for (const mode of ['off', 'error']) {
    s = await look({ mode });
    ok(s.hidden && !s.hasVis && !s.note, `counter ${mode}: the chip stays hidden and Sources says nothing`);
  }

  s = await look({ w: 390, h: 844, mode: 'ok' });
  logs.push('phone ' + JSON.stringify(s));
  ok(!s.hidden && s.inHeader && !s.hscroll, 'phone: the count fits in the header with no sideways scroll');

  logs.push(fails.length ? `${fails.length} FAILED` : 'ALL PASS');
  console.log(logs.join('\n'));
  await browser.close();
})();
