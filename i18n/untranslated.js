// Finds text still in English on the Tagalog or Ilocano page. It walks the site through its states (every month in
// each view, the weather card, chart labels, both drawers, a few searches) in English and in the language, and lists
// the strings that read the same in both, leaving out names kept in English on purpose (KEEP below).
// Needs the test server (cd tests && npm run serve). Usage: node i18n/untranslated.js tl   (or ilo; add "phone")
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url)), require = createRequire(import.meta.url);
const { chromium } = require(path.join(here, '..', 'tests', 'node_modules', 'playwright'));
const { BASE, LAUNCH } = require(path.join(here, '..', 'tests', 'env'));
const LANG = process.argv[2] || 'tl', PHONE = process.argv.includes('phone');

// kept in English by design: agencies, towns, dams, sources, PAGASA's stage and alert names, bulletin terms
const KEEP = /^(Bantay El Niño|El Niño 2026–27|Benguet · CAR|PAGASA|NOAA CPC|CPC|Outlook|Live|3D|OK|ER|Globe|Smart|Wangal|NHWL|RONI.*|Niño [\d.+]+.*|.*(OpenStreetMap|OpenMapTiles|OpenFreeMap|ESA WorldCover|AWS Terrain|Natural Earth|PSA PSGC|Wikipedia|Inquirer|Philstar|Manila Times|Daily Tribune|GMA News|PIA|SunStar|PTV|ANN|GuruPress|BaguioCityGuide|DOH|DENR|BFP|DA-CAR|DA via|Itogon LGU|Task Force).*|Dry condition|Dry spell|Drought|Benguet: (Dry condition|Dry spell|Drought)|Non-Flood Watch|Rule curve.*|Normal high water|contributors ·|Timeline|.*Advisory No\. \d.*|.*Diagnostic Discussion.*|.*Climate Outlook.*|.*Dam Information.*)$/;
const COMMON = new Set('the of and to in for from with by on is are a an not no at as or than this that it its be has have was were will can new now next past last more less every each all only about over under near into out up down vs per their your you we our how what which when'.split(' '));

async function walk(browser, lang) {
  const ctx = await browser.newContext(PHONE ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.route('https://cdn.jsdelivr.net/**', r => r.abort());
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.route('**/api/views**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok","visitors":1234,"views":3000,"counted":false}' }));
  await page.goto(`${BASE}/?test=1&lang=${lang}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wx && __wx.now && document.querySelector('#wxcard .wxc-temp b') && document.querySelector('#gq'), null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const bag = new Map();
  const grab = async () => {
    const found = await page.evaluate(() => {
      const out = [], where = el => { const p = []; for (let e = el; e && e !== document.body && p.length < 3; e = e.parentElement) p.unshift(e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.classList[0] ? '.' + e.classList[0] : '')); return p.join(' > '); };
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode());) {
        const p = n.parentElement; if (!p || p.closest('script,style')) continue;
        const s = n.nodeValue.replace(/\s+/g, ' ').trim();
        if (s && /[A-Za-z]/.test(s)) out.push(['text', s, where(p)]);
      }
      for (const el of document.querySelectorAll('[aria-label],[title],[placeholder],[alt],[aria-valuetext]'))
        for (const a of ['aria-label', 'title', 'placeholder', 'alt', 'aria-valuetext']) { const v = el.getAttribute(a); if (v && /[A-Za-z]/.test(v)) out.push(['@' + a, v.replace(/\s+/g, ' ').trim(), where(el)]); }
      return out;
    });
    for (const [kind, s, w] of found) if (!bag.has(kind + '\u0001' + s)) bag.set(kind + '\u0001' + s, { kind, s, where: w });
  };
  const click = async sel => { try { await page.click(sel, { timeout: 5000 }); await page.waitForTimeout(400); return true; } catch (e) { return false; } };
  await grab();
  for (const mode of ['outlook', 'pacific', 'water']) {
    await click(`.modes [data-mode="${mode}"]`); await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelector('#track').focus());
    for (let i = 0; i < 18; i++) await page.keyboard.press('ArrowLeft');
    for (let i = 0; i < 17; i++) { await page.waitForTimeout(250); await grab(); await page.keyboard.press('ArrowRight'); }
  }
  await click('.modes [data-mode="outlook"]');
  await click('#speed'); await grab(); await click('#speed'); await click('#speed');
  await click('#play'); await page.waitForTimeout(1200); await grab(); await click('#play');
  if (PHONE) await click('#ovTab');
  for (const sel of ['.wxc-tabs button:nth-child(2)', '.wxc-tabs button:nth-child(1)']) { await click(sel); await grab(); }
  await click('.wxc-tabs button:nth-child(2)');
  for (let i = 0; i < 7; i++) if (await click(`.wxc-days button:nth-child(${i + 1})`)) await grab();
  await page.evaluate(() => window.__wx && __wx.setDay && __wx.setDay(null)); await page.waitForTimeout(400); await grab();
  for (const c of ['#c1', '#c2', '#c3']) {
    const b = await (await page.$(c)).boundingBox();
    for (const fx of [0.2, 0.5, 0.8]) { await page.mouse.move(b.x + b.width * fx, b.y + b.height * 0.6); await page.waitForTimeout(200); await grab(); }
  }
  if (!PHONE) { await click('#ovTab'); await grab(); await click('#ovTab'); await click('#legTab'); await grab(); await click('#legTab'); }
  await click('#guideBtn'); await page.waitForTimeout(500); await grab();
  await click('.gtabs button:nth-child(2)'); await grab(); await click('.gtabs button:nth-child(1)');
  for (const q of ['water', 'hosp', 'zzzz']) { await page.fill('#gq', q); await page.waitForTimeout(500); await grab(); }
  await page.fill('#gq', ''); await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
  await click('#srcBtn'); await page.waitForTimeout(500); await grab();
  await ctx.close();
  return [...bag.values()];
}

(async () => {
  const browser = await chromium.launch({ ...LAUNCH });
  const en = new Set((await walk(browser, 'en')).map(r => r.s));
  const rows = await walk(browser, LANG);
  await browser.close();
  const left = rows.filter(({ s }) => en.has(s) && !KEEP.test(s) && /[a-z]{3}/.test(s) && (s.split(' ').length <= 3 || (s.toLowerCase().match(/[a-z]+/g) || []).some(w => COMMON.has(w))));
  for (const r of left) console.log(`${r.kind.padEnd(12)} ${r.s.slice(0, 140).padEnd(140)} | ${r.where}`);
  console.log(`${left.length} strings still in English on the ${LANG} page${PHONE ? ' (phone)' : ''}`);
})();
