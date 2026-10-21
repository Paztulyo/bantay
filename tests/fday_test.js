// Forecast days on the map: pick, step, play, back to live, and what the 3D weather draws for each day.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const THREE_DIR = path.join(__dirname, 'node_modules/three');
const { BASE, OUT, LAUNCH } = require('./env');
const args = Object.fromEntries(process.argv.slice(2).map(a => [a.split('=')[0], a.split('=')[1] ?? '1']));
const W = +(args.w || 1440), H = +(args.h || 900), dark = !!args.dark, sfx = (args.sfx || '') + `_${W}${dark ? 'd' : ''}`;

(async () => {
  const browser = await chromium.launch({ ...LAUNCH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const mobile = W < 768;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, reducedMotion: args.rm ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const logs = [], fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); logs.push((c ? 'PASS ' : 'FAIL ') + m); };
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.route('https://cdn.jsdelivr.net/npm/three@0.147.0/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(THREE_DIR, r.request().url().split('three@0.147.0/')[1])) }));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.route('**/api/views**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"off"}' }));
  await page.goto(BASE + '/?test=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wx && __wx.fx && __wx.now && document.querySelector('#wxcard .wxc-temp'), null, { timeout: 180000 });
  await page.waitForTimeout(1500);
  const shot = async name => { try { await page.screenshot({ path: OUT + name + sfx + '.png', timeout: 90000 }); } catch (e) { logs.push('shot failed ' + name + ': ' + e.message.split('\n')[0]); } };
  const st = () => page.evaluate(() => {
    const pill = document.querySelector('#wxPill');
    return {
      day: __wx.day, playing: __wx.playing, fx: __wx.fx.stats(),
      pressed: [...document.querySelectorAll('.wxc-day')].map(b => b.getAttribute('aria-pressed') === 'true' ? 1 : 0).join(''),
      pill: pill && !pill.hidden ? pill.querySelector('.wp-t').textContent : null,
      pillPlaying: !!pill && pill.classList.contains('playing'),
      place: document.querySelector('#wxcard .wxc-place span')?.textContent,
      temp: document.querySelector('#wxcard .wxc-temp')?.textContent,
      play: document.querySelector('#wxcPlay')?.textContent, focus: document.activeElement?.dataset?.date || document.activeElement?.id || document.activeElement?.className,
    };
  });
  const openCard = async () => { if (mobile && !(await page.$('#ovPanel.open'))) { await page.click('#ovTab'); await page.waitForTimeout(600); } };
  const closeCard = async () => { if (mobile && (await page.$('#ovPanel.open'))) { await page.click('#ovTab'); await page.waitForTimeout(600); } };
  const settle = async () => { await page.waitForTimeout(400); await page.waitForFunction(() => document.querySelector('canvas.wx3d')?.style.opacity !== '0', null, { timeout: 60000 }).catch(() => logs.push('fade did not finish')); await page.waitForTimeout(300); };

  if (mobile) { await page.click('#ovTab'); await page.waitForTimeout(500); }
  // open the card's 7-day tab (expand the card first if it starts folded)
  if (await page.$('#wxcBody[hidden]')) { await page.click('#wxcTog'); await page.waitForTimeout(200); }
  await page.click('.wxc-tabs [data-v="days"]'); await page.waitForTimeout(300);
  let s = await st(); const live = s.fx;
  ok(s.pressed === '0000000' && !s.day && !s.pill, `seven day buttons, none picked, no pill (live: ${JSON.stringify(live)})`);
  const dates = await page.$$eval('.wxc-day', bs => bs.map(b => b.dataset.date));

  // a dry, hot day: sun and heat, no rain
  await page.click(`.wxc-day[data-date="${dates[3]}"]`); await settle();
  s = await st(); logs.push('day3 ' + JSON.stringify(s));
  ok(s.day === dates[3] && s.pressed === '0001000' && s.pill && /forecast/.test(s.pill), `picking a day marks it and shows the pill ("${s.pill}")`);
  ok(s.fx.sun >= 8 && s.fx.heat >= 2 && s.fx.drops === 0 && s.fx.storms === 0, `a dry day draws sun on most towns and heat on the hot ones, and no rain (sun ${s.fx.sun}, heat ${s.fx.heat})`);
  ok(/forecast/.test(s.place) && s.fx.opacity === '1', `the card top switches to that day's forecast ("${s.place}", "${s.temp}") and the map fades back in`);
  await shot('fd_day3');

  // a stormy day: rain and lightning everywhere
  await page.click(`.wxc-day[data-date="${dates[6]}"]`); await settle();
  s = await st(); logs.push('day6 ' + JSON.stringify(s.fx));
  ok(s.fx.storms >= 4 && s.fx.drops > 1500 && s.fx.sun === 0, `a stormy day draws storms and rain (storms ${s.fx.storms}, drops ${s.fx.drops})`);
  await page.waitForTimeout(2500); await shot('fd_day6');
  s = await st(); ok(s.fx.strikes > 0 || !!args.rm, `lightning strikes on the stormy day (${s.fx.strikes})`);

  // rain thins with the chance of rain: day 2 has 55% showers in a couple of towns
  await page.click(`.wxc-day[data-date="${dates[2]}"]`); await settle();
  s = await st(); const d2 = s.fx.drops;
  ok(d2 > 0 && d2 < s.fx.parts * 400, `a day of scattered showers draws a little rain (${d2} drops)`);

  // the pill steps a day either way
  await closeCard();
  await page.click('#wxPill .wp-step[data-d="1"]'); await settle();
  s = await st(); ok(s.day === dates[3], `the pill's next arrow moves to the next day (${s.day})`);
  await page.click('#wxPill .wp-step[data-d="-1"]'); await page.click('#wxPill .wp-step[data-d="-1"]'); await settle();
  s = await st(); ok(s.day === dates[1], `the previous arrow goes back (${s.day})`);

  // keyboard: arrows step through the week and keep focus on the picked day
  await openCard();
  await page.focus(`.wxc-day[data-date="${dates[1]}"]`); await page.keyboard.press('ArrowRight'); await settle();
  s = await st(); ok(s.day === dates[2] && s.focus === dates[2], `ArrowRight picks and focuses the next day (${s.day}, focus ${s.focus})`);

  // a refresh keeps the picked date
  await page.evaluate(() => __wx.load()); await page.waitForTimeout(1500);
  s = await st(); ok(s.day === dates[2] && s.pill, 'a data refresh keeps the picked day');

  // play the week
  await page.click('#wxcPlay'); await page.waitForTimeout(400);
  s = await st(); ok(s.playing && s.day === dates[3] && s.pillPlaying && /Pause/.test(s.play), `play starts from the next day and shows Pause (${s.day})`);
  if (mobile) ok(!(await page.$('#ovPanel.open')), 'on a phone, playing tucks the card away so the map shows');
  await page.waitForTimeout(2700);
  s = await st(); ok(s.day === dates[4], `it moves on a day every 2.6 s (${s.day})`);
  await closeCard();
  await page.click('#wxPill .wp-pp'); await page.waitForTimeout(300);
  s = await st(); ok(!s.playing && s.day === dates[4] && /Play/.test(s.play) && !s.pillPlaying, 'the pill pauses it on the day it reached');
  await openCard();
  await page.click('#wxcPlay'); await page.waitForTimeout(400);
  if (!mobile) { await page.click('#wxcPlay'); await page.waitForTimeout(300); s = await st(); ok(!s.playing, 'Pause in the card stops it too'); await page.click('#wxcPlay'); await page.waitForTimeout(400); }
  await page.waitForTimeout(2600 * 2 + 600);
  s = await st(); ok(!s.playing && s.day === dates[6] && /again/.test(s.play), `it stops on the last day and offers to play again (${s.play.trim()})`);
  await shot('fd_played');

  // back to live, three ways
  await closeCard();
  await page.click('#wxPill .wp-live'); await settle();
  await openCard();
  s = await st(); ok(!s.day && !s.pill && s.fx.sun === live.sun && s.fx.drops === live.drops && /Live|As of/.test(s.place), 'Live in the pill returns the map and card to now');
  await page.click(`.wxc-day[data-date="${dates[5]}"]`); await settle();
  await page.click(`.wxc-day[data-date="${dates[5]}"]`); await settle();
  s = await st(); ok(!s.day, 'tapping the picked day again returns to live');
  await page.click(`.wxc-day[data-date="${dates[5]}"]`); await settle();
  await page.click('.wxc-tabs [data-v="hours"]'); await settle();
  s = await st(); ok(!s.day && !s.pill, 'the Next 24 h tab returns to live');
  await page.click('.wxc-tabs [data-v="days"]'); await page.waitForTimeout(200);

  // picking a day turns the map weather on if it was off
  await page.evaluate(() => { const sw = document.querySelector('#wx3d'); sw.checked = false; sw.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(300);
  await page.click(`.wxc-day[data-date="${dates[4]}"]`); await settle();
  s = await st(); ok(s.day === dates[4] && s.fx.shown && await page.$eval('#wx3d', e => e.checked), 'picking a day switches the map weather back on');
  await page.evaluate(() => { const sw = document.querySelector('#wx3d'); sw.checked = false; sw.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(300);
  s = await st(); ok(!s.day && !s.pill, 'switching the map weather off returns to live');

  // pill placement: inside the map, clear of the legend and the camera buttons
  await page.evaluate(() => { const sw = document.querySelector('#wx3d'); sw.checked = true; sw.dispatchEvent(new Event('change')); });
  await page.click(`.wxc-day[data-date="${dates[3]}"]`); await settle();
  await closeCard();
  const geo = await page.evaluate(() => {
    const r = e => { const b = e?.getBoundingClientRect(); return b && b.width ? { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) } : null; };
    const pill = r(document.querySelector('#wxPill')), vp = r(document.querySelector('#vp')), ctl = r(document.querySelector('#vpCtl')), leg = r(document.querySelector('.ov-bl .legend')), att = r(document.querySelector('#attrib')), tab = r(document.querySelector('#ovTab')), cmp = r(document.querySelector('#compass')), tr = r(document.querySelector('#ovPanel .mbadge'));
    const hit = (a, b) => a && b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    return { pill, vp, inside: pill && vp && pill.l >= vp.l && pill.r <= vp.r && pill.b <= vp.b, overCtl: hit(pill, ctl), overLegend: hit(pill, leg), overAttrib: hit(pill, att), overTab: hit(pill, tab), overCompass: hit(pill, cmp), overBadge: hit(pill, tr) };
  });
  logs.push('pill geometry ' + JSON.stringify(geo));
  ok(geo.inside && !geo.overCtl && !geo.overLegend && !geo.overAttrib && !geo.overTab && !geo.overCompass && !geo.overBadge, 'the pill sits inside the map, clear of everything else on it');
  if (mobile) { await page.click('#ovTab'); await page.waitForTimeout(600); ok(await page.$eval('#wxPill', e => getComputedStyle(e).visibility === 'hidden'), 'on a phone the pill steps aside while the card is out'); await page.click('#ovTab'); await page.waitForTimeout(600); }
  await shot('fd_pill');

  logs.push(fails.length ? `${fails.length} FAILED` : 'ALL PASS');
  console.log(logs.join('\n'));
  await browser.close();
})();
