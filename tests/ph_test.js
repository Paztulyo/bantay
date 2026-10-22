// The national page (/ph). The PDF parser: the real table parses clean, and tables that don't add up are refused.
// The flat map (?view=flat): every province drawn and coloured by PAGASA's stage, months switch the colours, a
// province opens its card (stage, months, weather, fires), search, ?p= and Near me work, the weather layers repaint.
// The 3D map (the default): terrain draws, a tap on a province selects it and loads sharper terrain, labels follow,
// the Weather view draws clouds and rain by day, the Flat/3D switch works and is remembered.
// Takes w=, h=, dark. Needs the test server (npm run serve).
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { BASE, OUT, LAUNCH } = require('./env');
const THREE_DIR = path.join(__dirname, 'node_modules/three');
const arg = k => (process.argv.find(a => a.startsWith(k + '=')) || '').split('=')[1];
const W = +(arg('w') || 1440), H = +(arg('h') || 900), DARK = process.argv.includes('dark');
const TAG = `${W}${DARK ? '_dark' : ''}`;

(async () => {
  const logs = [], fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); logs.push((c ? 'PASS ' : 'FAIL ') + m); };

  // ---- the parser ----
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
  page.on('pageerror', e => { logs.push('[pageerror] ' + e.message); fails.push('page error: ' + e.message); });
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) logs.push('[console] ' + m.text()); });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.route('https://cdn.jsdelivr.net/npm/three@0.147.0/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(THREE_DIR, r.request().url().split('three@0.147.0/')[1])) }));

  // ---- flat map ----
  await page.goto(BASE + '/ph?test=1&view=flat', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#map .prov').length > 80 && document.querySelector('.fires circle') && document.querySelector('#legend li'), null, { timeout: 60000 });
  await page.waitForTimeout(400);
  const st = await page.evaluate(() => ({
    provs: document.querySelectorAll('#map .prov').length,
    month: document.querySelector('#months [aria-selected="true"]')?.dataset.m,
    legend: document.querySelector('#legend').innerText,
    fills: new Set([...document.querySelectorAll('#map .prov')].map(p => p.style.fill)).size,
    card: document.querySelector('#card').innerText,
    over: document.documentElement.scrollWidth - innerWidth,
    gl: !!document.querySelector('.gl3d'),
    view: document.querySelector('#viewBtn').textContent,
  }));
  ok(st.provs === 85, `flat: 85 provinces and areas drawn (${st.provs})`);
  ok(!st.gl && st.view === '3D map', `flat: ?view=flat keeps the flat map, button offers 3D (${st.view})`);
  ok(st.month === '2026-11', `flat: opens on the first outlook month (${st.month})`);
  ok(/Drought\s*12/.test(st.legend) && /Dry spell\s*56/.test(st.legend) && /Dry condition\s*11/.test(st.legend) && /Not listed\s*6/.test(st.legend), 'flat: legend counts match the November table');
  ok(st.fills >= 4, `flat: four fills on the map (${st.fills})`);
  ok(/Philippines/.test(st.card) && /Drought\s*12/.test(st.card), 'flat: national card lists the drought provinces');
  ok(st.over <= 0, `flat: no sideways scroll (${st.over}px)`);
  await page.screenshot({ path: OUT + `ph_${TAG}_flat.png` });

  await page.click('#months [data-m="2027-02"]'); await page.waitForTimeout(300);
  ok(/Drought\s*80/.test(await page.locator('#legend').innerText()), 'flat: February repaints, 80 in drought');

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
  await page.click('#card .strip [data-m="2026-11"]'); await page.waitForTimeout(200);
  ok(/Dry spell/.test(await page.locator('#card .stage').innerText()), 'strip: November shows dry spell');

  await page.click('#resetBtn'); await page.waitForTimeout(700);
  const box = await page.locator('#map .prov[data-name="Palawan"]').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5); await page.waitForTimeout(700);
  const pc = await page.locator('#card').innerText();
  ok(/Palawan/.test(pc) && /Kalayaan Islands is listed on its own/.test(pc), 'flat: map tap opens Palawan, with Kalayaan noted');

  await page.click('#layers [data-layer="rain"]'); await page.waitForTimeout(300);
  ok(/Rain expected, next 7 days/.test(await page.locator('#legend').innerText()), 'rain layer legend');
  await page.click('#layers [data-layer="heat"]'); await page.waitForTimeout(300);
  ok(/feels-like/.test(await page.locator('#legend').innerText()), 'heat layer legend');
  await page.click('#layers [data-layer="weather"]'); await page.waitForTimeout(300);
  const wl = await page.locator('#legend').innerText(), chips = await page.locator('#months [data-d]').count();
  ok(/Weather now/.test(wl) && /Rain\s*\d+/.test(wl) && chips === 7, `weather layer: legend and 7 day chips (${chips})`);
  await page.click('#months [data-d="2"]'); await page.waitForTimeout(300);
  ok(/Weather, Sun 25/.test(await page.locator('#legend').innerText()), 'weather layer: a day chip switches the day');
  await page.click('#layers [data-layer="stage"]'); await page.waitForTimeout(200);

  await page.goto(BASE + '/ph?test=1&view=flat&p=Cebu', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /Cebu/.test(document.querySelector('#card h2')?.textContent || ''), null, { timeout: 30000 });
  ok(true, '?p=Cebu opens Cebu');
  await page.click('#locBtn');
  await page.waitForFunction(() => document.querySelector('#card h2')?.textContent === 'Benguet', null, { timeout: 15000 }).then(() => ok(true, 'Near me finds Benguet at Baguio'), () => ok(false, 'Near me finds Benguet at Baguio'));

  // ---- 3D map ----
  const map3d = async (q = '') => {
    await page.goto(BASE + '/ph?test=1' + q, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ph?.S.g3 && __ph.S.is3d, null, { timeout: 180000 });
    await page.waitForTimeout(1200);
  };
  // the map area's pixels, from a screenshot: how many distinct colours, so a blank canvas fails
  const colours = async () => {
    const b64 = (await page.locator('#mapBox').screenshot()).toString('base64');
    return page.evaluate(async src => {
      const img = new Image(); img.src = 'data:image/png;base64,' + src; await img.decode();
      const cv = document.createElement('canvas'); cv.width = 200; cv.height = Math.round(200 * img.height / img.width);
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0, cv.width, cv.height);
      const d = g.getImageData(0, 0, cv.width, cv.height).data, set = new Set();
      for (let i = 0; i < d.length; i += 4) set.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | d[i + 2] >> 3);
      return set.size;
    }, b64);
  };
  await page.evaluate(() => { try { localStorage.removeItem('bantay.phview'); } catch { } });
  await map3d();
  const g0 = await page.evaluate(() => ({ info: __ph.S.g3.info(), svg: document.querySelector('#map').hasAttribute('hidden'), btn: document.querySelector('#viewBtn').textContent, canvas: !document.querySelector('.gl3d').hidden }));
  ok(g0.svg && g0.canvas && g0.btn === 'Flat map', `3D: opens in 3D by default, flat map hidden (${g0.btn})`);
  ok(g0.info.relief > 10 && g0.info.fires === 420, `3D: relief exaggerated from far away (${g0.info.relief.toFixed(1)}x), 420 fires drawn (${g0.info.fires})`);
  const k3 = await colours();
  ok(k3 > 60, `3D: the terrain renders (${k3} colours in the map area)`);
  await page.screenshot({ path: OUT + `ph_${TAG}_3d.png` });

  // tap Benguet: selects it, flies in, loads sharper terrain, labels it
  const pt = await page.evaluate(() => __ph.S.g3.project(120.65, 16.45));
  await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction(() => __ph.S.sel === 'Benguet', null, { timeout: 20000 }).then(() => ok(true, '3D: tapping Benguet selects it'), () => ok(false, '3D: tapping Benguet selects it'));
  await page.waitForFunction(() => __ph.S.g3.info().detail === 'Benguet', null, { timeout: 90000 }).then(() => ok(true, '3D: sharper terrain loads for Benguet'), () => ok(false, '3D: sharper terrain loads for Benguet'));
  await page.waitForTimeout(1500);
  const g1 = await page.evaluate(() => ({ info: __ph.S.g3.info(), sel: [...document.querySelectorAll('.l3.sel')].filter(l => l.style.display !== 'none').map(l => l.textContent), names: [...document.querySelectorAll('.l3')].filter(l => l.style.display !== 'none').length }));
  ok(g1.info.dist < 600 && g1.info.relief < 6, `3D: camera flew in (${Math.round(g1.info.dist)} km), relief eased (${g1.info.relief.toFixed(1)}x)`);
  ok(g1.sel.includes('Benguet') && g1.names >= 3, `3D: Benguet labelled, neighbours named once zoomed in (${g1.names} labels)`);
  await page.screenshot({ path: OUT + `ph_${TAG}_3d_benguet.png`, fullPage: W < 761 });

  // the Weather view draws clouds and rain, and follows the day chips
  await page.evaluate(() => scrollTo(0, 0));
  await page.click('#layers [data-layer="weather"]'); await page.waitForTimeout(800);
  await page.click('#resetBtn'); await page.waitForTimeout(2500);
  const g2 = await page.evaluate(() => ({ info: __ph.S.g3.info(), temps: [...document.querySelectorAll('.l3')].filter(l => l.style.display !== 'none' && /°$/.test(l.textContent)).length }));
  ok(g2.info.clouds > 0 && g2.info.rain, `3D weather: clouds and rain drawn (${g2.info.clouds} layers, rain ${g2.info.rain})`);
  ok(g2.temps >= 5, `3D weather: temperatures labelled (${g2.temps})`);
  ok(g2.info.detail === null && g2.info.dist > 1000, '3D: Whole country flies back out and drops the sharper patch');
  await page.click('#months [data-d="3"]'); await page.waitForTimeout(800);
  ok(/Weather, Mon 26/.test(await page.locator('#legend').innerText()), '3D weather: day chips switch the day');
  await page.screenshot({ path: OUT + `ph_${TAG}_3d_weather.png` });

  // Flat / 3D switch, remembered
  await page.click('#viewBtn'); await page.waitForTimeout(500);
  const f1 = await page.evaluate(() => ({ svg: !document.querySelector('#map').hasAttribute('hidden'), canvas: document.querySelector('.gl3d').hidden, btn: document.querySelector('#viewBtn').textContent }));
  ok(f1.svg && f1.canvas && f1.btn === '3D map', 'switch: Flat map shows the flat map');
  await page.goto(BASE + '/ph?test=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#map .prov').length > 80, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  ok(await page.evaluate(() => !__ph.S.is3d && !document.querySelector('.gl3d')), 'switch: the flat choice is remembered on reload');
  await page.click('#viewBtn');
  await page.waitForFunction(() => window.__ph?.S.is3d, null, { timeout: 180000 }).then(() => ok(true, 'switch: 3D map comes back'), () => ok(false, 'switch: 3D map comes back'));
  ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, '3D: no sideways scroll');

  // Tagalog
  await page.click('.lang [data-lang="tl"]'); await page.waitForTimeout(700);
  const tl = await page.evaluate(() => ({ lang: document.documentElement.lang, ph: document.querySelector('#q').placeholder, btn: document.querySelector('#viewBtn').textContent, legend: document.querySelector('#legend').innerText }));
  ok(tl.lang === 'tl' && /probinsya/i.test(tl.ph) && tl.btn !== 'Flat map' && /Wala sa listahan/.test(tl.legend), `Tagalog: search, switch and legend translated (${tl.ph} · ${tl.btn})`);
  await page.screenshot({ path: OUT + `ph_${TAG}_tl.png` });
  await page.evaluate(() => { try { localStorage.removeItem('bantay.phview'); localStorage.removeItem('bantay.lang'); } catch { } });

  logs.forEach(l => console.log(l));
  console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
