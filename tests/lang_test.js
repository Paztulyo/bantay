// The language switch: English, Tagalog, Ilocano. Switches instantly and back to the exact English, translates the
// header, map cards, side column and the Be ready drawer (and its search), remembers the choice, honours ?lang=, sets
// <html lang>, and fits the header at phone width.
const { chromium } = require('playwright');
const { BASE, OUT, LAUNCH } = require('./env');

(async () => {
  const browser = await chromium.launch({ ...LAUNCH });
  const logs = [], fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); logs.push((c ? 'PASS ' : 'FAIL ') + m); };
  const open = async (opts, q = '') => {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) logs.push('[console] ' + m.text()); });
    await page.route('https://cdn.jsdelivr.net/**', r => r.abort());
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route('https://fonts.gstatic.com/**', r => r.abort());
    await page.route('**/api/views**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"off"}' }));
    await page.goto(BASE + '/?test=1' + q, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__wx && __wx.now && document.querySelector('#wxcard .wxc-temp b') && document.querySelector('#gq'), null, { timeout: 120000 });
    await page.waitForTimeout(800);
    return page;
  };
  const read = page => page.evaluate(() => ({
    lang: document.documentElement.lang, wait: document.documentElement.classList.contains('i18n-wait'),
    hot: document.querySelector('#guideBtn').textContent.trim(), src: document.querySelector('#srcBtn').textContent.trim(),
    modes: [...document.querySelectorAll('.modes button')].map(b => b.textContent.trim()),
    wx: document.querySelector('#wxcard').innerText.replace(/\s+/g, ' ').slice(0, 90),
    rail: document.querySelector('#secs').innerText.replace(/\s+/g, ' ').slice(0, 120),
    pressed: [...document.querySelectorAll('.lang [aria-pressed="true"]')].map(b => b.dataset.lang).join(),
    zoom: document.querySelector('#zin').getAttribute('aria-label'),
    body: document.querySelector('#app').innerText,
  }));

  // desktop: English first, then each language and back
  let page = await open({ viewport: { width: 1440, height: 900 } });
  const en = await read(page);
  ok(en.lang === 'en' && en.pressed === 'en' && en.hot === 'Hotlines' && en.modes[1] === 'Pacific', 'starts in English with EN pressed');
  await page.click('.lang [data-lang="tl"]'); await page.waitForTimeout(500);
  let s = await read(page);
  logs.push('tl: ' + JSON.stringify({ hot: s.hot, src: s.src, modes: s.modes, wx: s.wx, rail: s.rail, zoom: s.zoom }));
  ok(s.lang === 'tl' && s.pressed === 'tl' && s.modes[1] === 'Pasipiko' && s.modes[2] === 'Tubig' && s.src === 'Sanggunian', 'Tagalog: header and modes switch at once');
  ok(/Pakiramdam/.test(s.wx) && /Countdown ng Benguet|Ano ang gagawin/.test(s.rail) && s.zoom === 'Lumapit', 'Tagalog: weather card, side column and screen-reader labels too');
  await page.click('.modes [data-mode="water"]'); await page.waitForTimeout(700);
  ok(/Mga dam ng Agno/.test(await page.locator('#secs').innerText()), 'Tagalog follows into views drawn after the switch (Water)');
  await page.click('.modes [data-mode="outlook"]'); await page.waitForTimeout(500);
  // the drawer, its search and tabs in Tagalog
  await page.click('#guideBtn'); await page.waitForTimeout(400);
  let g = await page.evaluate(() => ({ h: document.querySelector('#guideTitle').textContent, ph: document.querySelector('#gq').placeholder, tab: document.querySelector('#gtabT').textContent }));
  ok(g.h === 'Maging handa' && /Maghanap/.test(g.ph) && /Ano ang gagawin/.test(g.tab), `the Be ready drawer is in Tagalog ("${g.h}")`);
  await page.fill('#gq', 'tubig'); await page.waitForTimeout(500);
  const hitsTl = await page.evaluate(() => ({ marks: [...document.querySelectorAll('#guide mark')].map(m => m.textContent.toLowerCase()), counts: [...document.querySelectorAll('.gcount')].map(c => +c.textContent) }));
  ok(hitsTl.counts[0] + hitsTl.counts[1] > 0 && hitsTl.marks.includes('tubig'), `searching "tubig" finds and highlights Tagalog text (${hitsTl.counts.join('+')} results)`);
  await page.fill('#gq', 'water'); await page.waitForTimeout(400);
  const hitsEn = await page.evaluate(() => [...document.querySelectorAll('.gcount')].map(c => +c.textContent));
  ok(hitsEn[0] + hitsEn[1] > 0, `English words still find things in Tagalog (${hitsEn.join('+')})`);
  // switching language with the drawer open keeps the search and redraws it
  // (the open drawer covers the page, so this is the keyboard path: the switch is still in the tab order)
  await page.evaluate(() => document.querySelector('.lang [data-lang="ilo"]').click()); await page.waitForTimeout(500);
  g = await page.evaluate(() => ({ h: document.querySelector('#guideTitle').textContent, q: document.querySelector('#gq').value, tab: document.querySelector('#gtabH').textContent }));
  ok(g.h === 'Agsagana' && g.q === 'water', `switching to Ilocano redraws the open drawer and keeps the search ("${g.h}", "${g.q}")`);
  await page.fill('#gq', 'danum'); await page.waitForTimeout(400);
  const hitsIlo = await page.evaluate(() => [...document.querySelectorAll('.gcount')].map(c => +c.textContent));
  ok(hitsIlo[0] + hitsIlo[1] > 0, `searching "danum" works in Ilocano (${hitsIlo.join('+')})`);
  await page.fill('#gq', ''); await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
  s = await read(page);
  ok(s.lang === 'ilo' && s.modes[2] === 'Danum' && /Marikna/.test(s.wx), 'Ilocano: modes and weather card');
  await page.screenshot({ path: OUT + 'lang_ilo_1440.png' });
  // back to English: exactly what was there
  await page.click('.lang [data-lang="en"]'); await page.waitForTimeout(500);
  s = await read(page);
  const same = s.body === en.body;
  if (!same) { const a = en.body.split('\n'), b = s.body.split('\n'); logs.push('first difference: ' + JSON.stringify([a.find((x, i) => x !== b[i]), b.find((x, i) => x !== a[i])])); }
  ok(s.lang === 'en' && s.hot === 'Hotlines' && same, 'back to English restores the exact English text');
  // the choice is remembered, and ?lang= wins for a shared link
  await page.click('.lang [data-lang="tl"]'); await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wx && __wx.now && document.querySelector('#wxcard .wxc-temp b'), null, { timeout: 120000 });
  await page.waitForTimeout(800);
  s = await read(page);
  ok(s.lang === 'tl' && s.modes[1] === 'Pasipiko' && !s.wait, 'a reload stays in Tagalog, and the page is shown');
  await page.context().close();
  page = await open({ viewport: { width: 1440, height: 900 } }, '&lang=ilo');
  s = await read(page);
  ok(s.lang === 'ilo' && s.pressed === 'ilo' && s.modes[2] === 'Danum', 'a ?lang=ilo link opens in Ilocano');
  await page.context().close();

  // phone: the switch sits beside the name, the header doesn't grow, nothing spills sideways
  for (const lang of ['en', 'tl', 'ilo']) {
    page = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, '&lang=' + lang);
    const m = await page.evaluate(() => {
      const R = s => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
      return { brand: R('.brand'), lang: R('.lang'), top: R('.top'), modes: R('.modes'), hs: document.documentElement.scrollWidth > innerWidth, tr: R('.top-right') };
    });
    logs.push(`phone ${lang}: ` + JSON.stringify(m));
    ok(Math.abs(m.lang[1] - m.brand[1]) < 12 && m.lang[2] <= 390 - 12 && !m.hs, `phone (${lang}): the switch shares the first row with the name, nothing spills sideways`);
    ok(m.top[3] - m.top[1] <= 206, `phone (${lang}): the header stays as tall as before, 204px in this test browser (${m.top[3] - m.top[1]}px)`);
    await page.screenshot({ path: OUT + `lang_${lang}_390.png` });
    await page.context().close();
  }

  logs.push(fails.length ? `${fails.length} FAILED` : 'ALL PASS');
  console.log(logs.join('\n'));
  await browser.close();
})();
