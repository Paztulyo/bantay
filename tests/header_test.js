// The header at every width, in each language, with the real fonts: one row on desktop with the advisory line whole,
// two rows on tablets, no spill sideways, nothing overlapping, every button whole. When an advisory runs long, the
// context chips give way first (js/headfit.js) and the line ends in an ellipsis only once none are left.
// Args: widths=1440,1280 langs=en,tl vis (visitor chip on) shots
const { chromium } = require('playwright');
const { BASE, OUT, LAUNCH } = require('./env');
const { realFonts, available } = require('./fonts');
const args = Object.fromEntries(process.argv.slice(2).map(a => [a.split('=')[0], a.split('=')[1] ?? '1']));
const WIDTHS = (args.widths || '1920,1794,1714,1680,1661,1600,1583,1536,1512,1440,1436,1405,1366,1328,1280,1262,1247,1200,1194,1180,1133,1101,1100,1024,900,820,768,700,641,640,480,412,390,375,360').split(',').map(Number);
const LANGS = (args.langs || 'en,tl,ilo').split(',');
const LONG = 'PAGASA, 21 Oct: a strong to very strong El Niño is present and likely to persist until the middle of 2027';

(async () => {
  if (!available()) { console.log('FAIL real fonts missing: run npm install in tests/'); console.log('1 FAILED'); process.exit(1); }
  const browser = await chromium.launch({ ...LAUNCH });
  const logs = [], fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); logs.push((c ? 'PASS ' : 'FAIL ') + m); };
  const measure = page => page.evaluate(() => {
    const top = document.querySelector('.top'), st = document.querySelector('#status');
    const R = e => e.getBoundingClientRect();
    const kids = [...top.children].filter(e => getComputedStyle(e).display !== 'none' && R(e).width > 0);
    const mids = kids.map(e => (R(e).top + R(e).bottom) / 2);
    let overlap = '';
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const a = R(kids[i]), b = R(kids[j]);
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap = kids[i].className + ' / ' + kids[j].className;
    }
    const lang = R(document.querySelector('.lang')), langBtns = [...document.querySelectorAll('.lang button')].every(b => b.scrollWidth <= b.clientWidth + 1);
    const btns = [...document.querySelectorAll('#guideBtn, #srcBtn, .modes button')].every(b => b.scrollWidth <= b.clientWidth + 1 && R(b).height < 48 && R(b).right <= innerWidth);
    return {
      h: Math.round(R(top).height), oneRow: Math.max(...mids) - Math.min(...mids) < 12, cut: st.scrollWidth - st.clientWidth > 1,
      chips: [...document.querySelectorAll('.ctx .chip')].filter(c => c.offsetWidth).length,
      spill: document.documentElement.scrollWidth > innerWidth, overlap, langOk: lang.right <= innerWidth && langBtns, btns,
    };
  });

  for (const lang of LANGS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
    await page.route('https://cdn.jsdelivr.net/**', r => r.abort());
    await realFonts(page);
    await page.route('**/api/views**', r => r.fulfill({ status: 200, contentType: 'application/json', body: args.vis ? '{"status":"ok","visitors":12431,"views":30000,"counted":false}' : '{"status":"off"}' }));
    await page.goto(BASE + '/?test=1&lang=' + lang, { waitUntil: 'domcontentloaded' });
    // measure with the advisory line in place, not the placeholder the page starts with
    await page.waitForFunction(vis => document.querySelector('#liveBtn') && document.fonts.status === 'loaded' && /PAGASA, \d/.test(document.querySelector('#status b').textContent) && (!vis || !document.querySelector('#visChip').hidden), !!args.vis, { timeout: 120000 });
    await page.waitForTimeout(600);
    const row = [];
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(120);
      const m = await measure(page);
      row.push(`${w}:${m.h}`);
      if (w >= 1101) ok(m.oneRow && !m.cut && m.h <= 60, `${lang} ${w}px: one row, the advisory line whole (${m.h}px, ${m.chips} chips${m.cut ? ', line cut short' : ''})`);
      else if (w >= 641) ok(m.h <= 150, `${lang} ${w}px: two rows at most (${m.h}px)`);
      else ok(m.h <= 210, `${lang} ${w}px: the phone header stays within 210px (${m.h}px)`);
      ok(!m.spill && !m.overlap && m.langOk && m.btns, `${lang} ${w}px: no spill, nothing overlaps, buttons whole${m.overlap ? ' (' + m.overlap + ')' : ''}`);
      if (args.shots && (w === 1101 || w === 768 || w === 1440)) await page.screenshot({ path: `${OUT}hdr_${lang}_${w}.png`, clip: { x: 0, y: 0, width: w, height: m.h + 4 } });
    }
    logs.push(`${lang}: ${row.join('  ')}`);

    // a longer advisory: the chips give way and the line stays whole while any are left; then the ellipsis
    await page.setViewportSize({ width: 1700, height: 900 }); await page.waitForTimeout(150);
    const before = (await measure(page)).chips;
    await page.evaluate(t => { document.querySelector('#status b').textContent = t; }, LONG); await page.waitForTimeout(250);
    let m = await measure(page);
    ok(m.chips < before && !m.cut && m.oneRow && !m.spill, `${lang}: a longer advisory at 1700px hides chips (${before} to ${m.chips}) and keeps the line whole`);
    await page.setViewportSize({ width: 1150, height: 900 }); await page.waitForTimeout(250);
    m = await measure(page);
    ok(m.chips === 0 && m.oneRow && !m.spill && m.btns, `${lang}: at 1150px with no chips left the line ends in an ellipsis, the header stays one row (${m.h}px)`);
    await page.setViewportSize({ width: 1920, height: 900 }); await page.waitForTimeout(250);
    m = await measure(page);
    ok(m.chips > 0 && !m.cut, `${lang}: wider again, the chips come back (${m.chips})`);
    await ctx.close();
  }
  const quiet = logs.filter(l => !l.startsWith('PASS'));
  quiet.push(fails.length ? `${fails.length} FAILED` : 'ALL PASS');
  console.log(quiet.join('\n'));
  await browser.close();
})();
