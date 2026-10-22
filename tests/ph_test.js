// The national page (/ph): every province drawn and coloured by PAGASA's stage, months switch the colours,
// a province opens its card (stage, months, weather, fires), search and ?p= work, the weather layers repaint,
// the parser refuses tables that don't add up, and nothing overflows at phone width. Takes w=, h=, dark.
const { chromium } = require('playwright');
const { BASE, OUT, LAUNCH } = require('./env');
const arg = k => (process.argv.find(a => a.startsWith(k + '=')) || '').split('=')[1];
const W = +(arg('w') || 1440), H = +(arg('h') || 900), DARK = process.argv.includes('dark');
const TAG = `${W}${DARK ? '_dark' : ''}`;

(async () => {
  const logs = [], fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); logs.push((c ? 'PASS ' : 'FAIL ') + m); };

  // the parser: the real table parses clean; a table with a dropped name is caught, not guessed
  const { parseOutlook } = await import('../js/phparse.js');
  const mock = require('./mocks/pagasa_outlook.json');
  const good = parseOutlook(mock.text);
  ok(good.problems.length === 0 && good.months.length === 6 && good.issued === '2026-10-21', `parser: 6 months, issued 21 Oct, no problems (${good.problems.join('; ')})`);
  ok(good.stages['2026-11'].Benguet === 'spell' && good.stages['2026-12'].Benguet === 'drought', 'parser: Benguet dry spell in Nov, drought in Dec');
  ok(good.stages['2026-11']['Metro Manila'] === 'spell' && good.stages['2026-11'].Samar === 'drought' && good.subs['2027-01']['Davao City'].stage === 'cond', 'parser: aliases and sub-areas mapped');
  const broken = mock.text.map(p => p.replace('Batangas, Benguet, Cagayan', 'Batangas, Cagayan'));
  ok(parseOutlook(broken).problems.some(p => /2026-11 LUZON: 39 names for 40/.test(p)), 'parser: a missing name is reported');
  const typo = mock.text.map(p => p.replace('Ifugao, Ilocos Norte', 'Ifugoa, Ilocos Norte'));
  ok(parseOutlook(typo).problems.some(p => /not recognised: "Ifugoa/.test(p)), 'parser: an unknown name is reported');

  const browser = await chromium.launch({ ...LAUNCH });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: DARK ? 'dark' : 'light', geolocation: { latitude: 16.41, longitude: 120.6 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) logs.push('[console] ' + m.text()); });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.goto(BASE + '/ph?test=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#map .prov').length > 80 && document.querySelector('.fires circle') && document.querySelector('#legend li'), null, { timeout: 60000 });
  await page.waitForTimeout(400);

  const st = await page.evaluate(() => ({
    provs: document.querySelectorAll('#map .prov').length,
    month: document.querySelector('#months [aria-selected="true"]')?.dataset.m,
    legend: document.querySelector('#legend').innerText,
    fills: new Set([...document.querySelectorAll('#map .prov')].map(p => p.style.fill)).size,
    card: document.querySelector('#card').innerText,
    over: document.documentElement.scrollWidth - innerWidth,
  }));
  ok(st.provs === 85, `85 provinces and areas drawn (${st.provs})`);
  ok(st.month === '2026-11', `opens on the first outlook month (${st.month})`);
  ok(/Drought\s*12/.test(st.legend) && /Dry spell\s*56/.test(st.legend) && /Dry condition\s*11/.test(st.legend) && /Not listed\s*6/.test(st.legend), 'legend counts match the November table');
  ok(st.fills >= 4, `four fills on the map (${st.fills})`);
  ok(/Philippines/.test(st.card) && /Drought\s*12/.test(st.card), 'national card lists the drought provinces');
  ok(st.over <= 0, `no sideways scroll (${st.over}px)`);
  await page.screenshot({ path: OUT + `ph_${TAG}_home.png` });

  await page.click('#months [data-m="2027-02"]'); await page.waitForTimeout(300);
  ok(/Drought\s*80/.test(await page.locator('#legend').innerText()), 'February repaints: 80 in drought');

  // search
  await page.fill('#q', 'bagu'); await page.waitForTimeout(150);
  ok((await page.locator('#qList li').first().innerText()).startsWith('Benguet'), 'search: "bagu" finds Benguet');
  await page.keyboard.press('Enter'); await page.waitForTimeout(800);
  const c = await page.locator('#card').innerText();
  ok(/Benguet/.test(c) && /Drought/.test(c) && /CAR/.test(c), 'Benguet card: stage and region');
  ok(/Drought expected by end of Dec 2026/.test(c), 'Benguet card: first drought month');
  ok(/feels/.test(c) && /mm/.test(c), 'Benguet card: weather');
  ok(/fire detections|No fire detections/.test(c), 'Benguet card: fires');
  ok(/Open the Benguet 3D map/.test(c), 'Benguet card links to the 3D map');
  ok(new URL(page.url()).searchParams.get('p') === 'Benguet', 'selection goes in the link (?p=)');
  await page.screenshot({ path: OUT + `ph_${TAG}_benguet.png`, fullPage: W < 761 });

  // strip months: tap Nov in the strip
  await page.click('#card .strip [data-m="2026-11"]'); await page.waitForTimeout(200);
  ok(/Dry spell/.test(await page.locator('#card .stage').innerText()), 'strip: November shows dry spell');

  // tap a province on the map
  await page.click('#resetBtn'); await page.waitForTimeout(700);
  const box = await page.locator('#map .prov[data-name="Palawan"]').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5); await page.waitForTimeout(700);
  const pc = await page.locator('#card').innerText();
  ok(/Palawan/.test(pc) && /Kalayaan Islands is listed on its own/.test(pc), 'map tap opens Palawan, with Kalayaan noted');

  // weather layers
  await page.click('#layers [data-layer="rain"]'); await page.waitForTimeout(300);
  ok(/Rain expected, next 7 days/.test(await page.locator('#legend').innerText()), 'rain layer legend');
  await page.click('#layers [data-layer="heat"]'); await page.waitForTimeout(300);
  ok(/feels-like/.test(await page.locator('#legend').innerText()), 'heat layer legend');
  await page.screenshot({ path: OUT + `ph_${TAG}_heat.png` });

  // ?p= opens straight to a province; location finds Benguet from Baguio's coordinates
  await page.goto(BASE + '/ph?test=1&p=Cebu', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /Cebu/.test(document.querySelector('#card h2')?.textContent || ''), null, { timeout: 30000 });
  ok(true, '?p=Cebu opens Cebu');
  await page.click('#locBtn');
  await page.waitForFunction(() => document.querySelector('#card h2')?.textContent === 'Benguet', null, { timeout: 15000 }).then(() => ok(true, 'Near me finds Benguet at Baguio'), () => ok(false, 'Near me finds Benguet at Baguio'));

  // Tagalog renders without breaking
  await page.click('.lang [data-lang="tl"]'); await page.waitForTimeout(600);
  ok((await page.evaluate(() => document.documentElement.lang)) === 'tl', 'Tagalog switch works');
  await page.screenshot({ path: OUT + `ph_${TAG}_tl.png` });

  logs.forEach(l => console.log(l));
  console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
