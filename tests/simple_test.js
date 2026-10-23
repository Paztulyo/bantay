// Simple and Detailed views: the switch, what Simple shows (the map plus five things) and hides, the town, the month,
// the camera and the language surviving a switch, the choice remembered, the Water view coming back, Tagalog, and the
// phone layout. Takes w=, h=, dark, rm (reduced motion).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const THREE_DIR = path.join(__dirname, 'node_modules/three');
const { BASE, OUT, LAUNCH } = require('./env');
const args = Object.fromEntries(process.argv.slice(2).map(a => [a.split('=')[0], a.split('=')[1] ?? '1']));
const W = +(args.w || 1440), H = +(args.h || 900), dark = !!args.dark, rm = !!args.rm;
const mobile = W < 768, tag = `${W}${dark ? '_dark' : ''}${rm ? '_rm' : ''}`;

(async () => {
  const browser = await chromium.launch({ ...LAUNCH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, reducedMotion: rm ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const logs = [], fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); logs.push((c ? 'PASS ' : 'FAIL ') + m); };
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) { logs.push(`[console] ${m.text()}`); fails.push('console error: ' + m.text()); } });
  page.on('pageerror', e => { logs.push(`[pageerror] ${e.message}`); fails.push('page error: ' + e.message); });
  await page.route('https://cdn.jsdelivr.net/npm/three@0.147.0/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(THREE_DIR, r.request().url().split('three@0.147.0/')[1])) }));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  const until = (fn, arg, t = 60000) => page.waitForFunction(fn, arg, { timeout: t }).then(() => true).catch(() => false);
  const shot = async name => { try { await page.screenshot({ path: OUT + name + '_' + tag + '.png', fullPage: mobile, timeout: 60000 }); } catch (e) { logs.push('shot failed ' + name + ': ' + e.message.split('\n')[0]); } };
  const st = () => page.evaluate(() => {
    const vis = s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0; };
    const A = window.bantayApp, p = document.querySelector('#simple');
    return {
      simple: document.documentElement.classList.contains('view-simple'),
      pressed: [...document.querySelectorAll('.viewsw button')].map(b => b.dataset.view + ':' + b.getAttribute('aria-pressed')).join(' '),
      shown: Object.fromEntries(['.ctx', '.modes', '.tl', '.bottom', '#secs', '#simple', '#gl', '#status', '#guideBtn', '#srcBtn', '.lang'].map(s => [s, vis(s)])),
      sel: A && A.state.sel, month: A && A.state.month, mode: A && A.state.mode, now: A && A.NOW, lang: document.documentElement.lang,
      town: p.querySelector('#sTown')?.value, h2: [...p.querySelectorAll('.s-h')].map(h => h.textContent.trim()),
      sum: p.querySelector('.s-sum')?.textContent.trim() || '', src: p.querySelector('.s-area .s-src')?.textContent.replace(/\s+/g, ' ').trim() || '',
      period: [...(p.querySelector('.s-period')?.children || [])].map(e => e.textContent.trim()).join(' '), runs: [...p.querySelectorAll('.s-runs button')].map(b => [...b.children].map(e => e.textContent.trim()).filter(Boolean).join(' ') + (b.getAttribute('aria-pressed') === 'true' ? ' *' : '')),
      acts: p.querySelectorAll('.s-acts li').length, more: !!p.querySelector('#sMore'), sos: p.querySelector('.s-sos')?.getAttribute('href'),
      hot: !!p.querySelector('#sHot'), srcBtn: !!p.querySelector('#sSrc'), langBtns: p.querySelectorAll('.s-langrow [data-lang]').length, install: !!p.querySelector('#sInstall'),
      text: p.textContent.replace(/\s+/g, ' '), badge: document.querySelector('#mbadge .mbadge-h b')?.textContent, tl: document.querySelector('#tlRead b')?.textContent,
      lblSel: document.querySelector('#labels .lbl.sel')?.textContent.trim() || '', wxTown: document.querySelector('#wxcard .wxc-place b')?.textContent.trim() || '',
      spill: document.documentElement.scrollWidth - innerWidth, store: { view: localStorage.getItem('bantay.view'), town: localStorage.getItem('bantay.town') }, url: location.search,
    };
  });

  // ---- Simple, as a shared link opens it
  await page.goto(BASE + '/?test=1&view=simple', { waitUntil: 'domcontentloaded' });
  ok(await until(() => document.querySelector('#simple .s-do') && window.__G && window.__G.ready, null, 150000), 'Simple view draws its panel and the map loads');
  let s = await st();
  ok(s.simple && s.pressed === 'simple:true detailed:false', `the switch shows Simple chosen (${s.pressed})`);
  ok(!s.shown['.ctx'] && !s.shown['.modes'] && !s.shown['.tl'] && !s.shown['.bottom'] && !s.shown['#secs'], 'Simple hides the chips, the views, the timeline, the charts and the rail sections');
  ok(s.shown['#simple'] && s.shown['#gl'], 'the map and the Simple panel show');
  ok(s.shown['#status'] && /PAGASA, \d+ \w+: .*El Niño/.test(await page.textContent('#status b')), 'the PAGASA advisory line stays in the header');
  ok(s.shown['#guideBtn'] && s.shown['#srcBtn'] && s.shown['.lang'], 'Hotlines, Sources and the language switch stay in the header');
  const geo = await page.evaluate(() => { const v = document.querySelector('#vp').getBoundingClientRect(); return { w: v.width, h: v.height, iw: innerWidth }; });
  ok(mobile ? geo.h >= 380 : geo.w >= geo.iw * 0.6, `the map stays the biggest thing on screen (${Math.round(geo.w)}×${Math.round(geo.h)})`);
  // the five things, and nothing that counts down
  ok(s.town === '' && s.h2[0] === 'What this means for Benguet', `1-2: the town picker (All of Benguet) and the summary heading (${s.h2[0]})`);
  ok(/Benguet is not in a dry stage this month\./.test(s.sum) && /PAGASA projects a dry period from November 2026 to at least April 2027, where its outlook ends\./.test(s.sum) && /Expect 3 to 5 more dry days than usual each month\./.test(s.sum), `2: the summary reads from PAGASA's outlook (${s.sum})`);
  ok(/^Source: PAGASA Climate Outlook · issued 21 Oct 2026$/.test(s.src), `2: the summary names its source and date (${s.src})`);
  ok(s.h2[1] === 'Outlook for the coming months' && s.period === 'Projected dry period November 2026 – April 2027', `3: the outlook is labelled, with the projected dry period (${s.period})`);
  ok(s.runs.join(' | ') === 'Oct No dry stage yet Now * | Nov Dry spell | Dec–Apr Drought', `3: month by month (${s.runs.join(' | ')})`);
  ok(/PAGASA Climate Outlook · issued 21 Oct 2026 · revised monthly/.test(s.text) && /An outlook is a forecast\./.test(s.text), '3: the outlook carries its attribution and says it can change');
  ok(!/\b\d+\s*(days?|weeks?|months?)\s+to\b|countdown/i.test(s.text), 'no countdown wording in Simple');
  ok(s.h2[2] === 'What you can do right now' && s.acts === 3 && s.more, `4: three things to do and See more (${s.acts})`);
  ok(s.h2[3] === 'Get help' && s.sos === 'tel:911' && s.hot && s.srcBtn && s.langBtns === 3, '5: 911, all hotlines, sources and the languages in one place');
  ok(!s.install, 'no Install button where the browser offers no install');
  ok(s.spill <= 0, `no sideways scroll (${s.spill})`);
  // big, clear switch and readable text
  const look = await page.evaluate(() => {
    const lum = c => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const solid = el => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (!/rgba\(.*, 0\)$/.test(c) && c !== 'transparent') return c; } return 'rgb(255,255,255)'; };
    const btns = [...document.querySelectorAll('.viewsw button')].map(b => { const cs = getComputedStyle(b); return { size: parseFloat(cs.fontSize), h: b.getBoundingClientRect().height, ratio: ratio(cs.color, solid(b)), bg: cs.backgroundColor }; });
    const small = [...document.querySelectorAll('#simple .s-sum, #simple .s-acts p, #simple .s-st, #simple select')].map(e => parseFloat(getComputedStyle(e).fontSize));
    const targets = [...document.querySelectorAll('#simple button, #simple select, #simple a.s-sos')].filter(e => e.offsetWidth).map(e => Math.round(e.getBoundingClientRect().height));
    return { btns, minText: Math.min(...small), minTarget: Math.min(...targets.filter(h => h > 0)) };
  });
  ok(look.btns.every(b => b.size >= 15 && b.ratio >= 4.5), `the switch: large type, strong contrast (${look.btns.map(b => b.size + 'px ' + b.ratio.toFixed(1) + ':1').join(', ')})`);
  ok(look.btns[0].bg !== look.btns[1].bg, 'the chosen side of the switch is filled');
  ok(look.minText >= 15, `Simple's main text is 15px or more (${look.minText}px)`);
  if (mobile) ok(look.minTarget >= 40 && look.btns.every(b => b.h >= 40), `phone: every Simple control is a thumb wide (${look.minTarget}px, switch ${look.btns.map(b => Math.round(b.h)).join('/')}px)`);
  await shot('simple');

  // ---- the town picker. iPhone Safari reopens a <select> that a script replaces and focuses, so the picker must stay
  // the same element through a pick, and nothing may focus it
  await page.evaluate(() => {
    window.__pick = document.querySelector('#sTown'); window.__pickFocus = 0;
    const f = HTMLSelectElement.prototype.focus;
    HTMLSelectElement.prototype.focus = function (...a) { window.__pickFocus++; return f.apply(this, a); };
  });
  await page.selectOption('#sTown', 'La Trinidad');
  ok(await until(() => window.bantayApp.state.sel === 'La Trinidad' && document.querySelector('#sAreaH')?.textContent === 'What this means for La Trinidad'), 'picking La Trinidad selects it on the map and in the summary');
  await page.waitForTimeout(400);
  const kept = await page.evaluate(() => ({ same: document.querySelector('#sTown') === window.__pick, focus: window.__pickFocus, value: window.__pick.value }));
  ok(kept.same && kept.focus === 0 && kept.value === 'La Trinidad', `the picker stays the same element and no script focuses it, so a phone's town list closes (same ${kept.same}, focused ${kept.focus}x)`);
  s = await st();
  ok(s.lblSel === 'La Trinidad' && s.wxTown === 'La Trinidad', `the map label and the weather card follow (${s.lblSel}, ${s.wxTown})`);
  ok(/PAGASA rates dry stages by province, not by town\./.test(s.sum), 'the summary says why it reads the same for every town');
  ok(s.store.town === 'La Trinidad', 'the town is remembered');

  // ---- a month from the outlook, shown on the map
  await page.evaluate(() => { window.__runs = [...document.querySelectorAll('.s-runs button')]; });
  await page.click('.s-runs button >> nth=2');
  await page.waitForTimeout(300);
  s = await st();
  ok(s.month === s.now + 2 && /^Dec 2026/.test(s.badge || '') && s.runs[2].endsWith('*'), `tapping Dec–Apr shows December on the map (${s.badge})`);
  ok(await page.evaluate(() => [...document.querySelectorAll('.s-runs button')].every((b, i) => b === window.__runs[i]) && document.activeElement === window.__runs[2]),
    'the month rows only change which one is marked: the tapped row keeps focus, nothing is redrawn');

  // ---- to Detailed: the town, month, language and camera stay
  // a camera the user moved: any flight still running ends first (software rendering draws few frames), then the view
  // is set at once, the way a drag leaves it
  const frames = n => page.evaluate(k => new Promise(r => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const camAt = () => page.evaluate(() => window.__G.camera.position.toArray().map(v => +v.toFixed(3)).join(','));
  await frames(4);
  await page.evaluate(() => window.__G.lookAt(120.62, 16.45, 26, 48, 170, 0));
  await frames(4);
  const cam0 = await camAt();
  await page.click('.viewsw [data-view="detailed"]');
  ok(await until(() => !document.documentElement.classList.contains('view-simple') && document.querySelector('#secs .sec') && document.querySelector('#c1 .plot svg')), 'Detailed brings back the rail and the charts');
  await frames(4);
  s = await st();
  const cam1 = await camAt();
  ok(s.pressed === 'simple:false detailed:true' && s.shown['.tl'] && s.shown['.bottom'] && s.shown['.modes'] && s.shown['#secs'] && !s.shown['#simple'], 'Detailed shows the whole dashboard');
  ok(s.sel === 'La Trinidad' && s.month === s.now + 2 && s.tl === 'December 2026' && s.lang === 'en', `the town, the month and the language stay (${s.sel}, ${s.tl}, ${s.lang})`);
  ok(cam0 === cam1, `the camera stays where it was (${cam0} vs ${cam1})`);
  const chartW = await page.evaluate(() => document.querySelector('#c1 .plot svg').getBoundingClientRect().width);
  ok(chartW > 200, `the charts redraw at full size (${Math.round(chartW)}px)`);
  ok(s.store.view === 'detailed' && !/view=/.test(s.url), 'the choice is saved and ?view= leaves the address');

  // ---- the Water view comes back after a visit to Simple, without the camera moving
  await page.click('.modes [data-mode="water"]'); await page.waitForTimeout(1300);
  await page.click('.viewsw [data-view="simple"]'); await page.waitForTimeout(500);
  s = await st();
  ok(s.simple && s.mode === 'outlook' && !s.shown['.modes'], 'Simple shows Benguet’s map when coming from Water');
  await page.click('.viewsw [data-view="detailed"]'); await page.waitForTimeout(500);
  s = await st();
  ok(!s.simple && s.mode === 'water', 'Detailed goes back to the Water view');

  // ---- the saved choice wins over the test default; the town comes back
  await page.click('.viewsw [data-view="simple"]'); await page.waitForTimeout(300);
  await page.goto(BASE + '/?test=1', { waitUntil: 'domcontentloaded' });
  ok(await until(() => document.querySelector('#simple .s-area')), 'reload: Simple again, as saved');
  s = await st();
  ok(s.simple && s.sel === 'La Trinidad' && s.town === 'La Trinidad', `reload: La Trinidad again (${s.sel})`);

  // ---- Tagalog: the switch, the panel and the summary translate; switching keeps the language
  await page.click('.top .lang [data-lang="tl"]');
  ok(await until(() => document.documentElement.lang === 'tl' && document.querySelector('#sAreaH')?.textContent.startsWith('Ano ang ibig sabihin')), 'Tagalog: the panel translates');
  s = await st();
  const pressedTL = await page.evaluate(() => [...document.querySelectorAll('.viewsw button')].map(b => b.textContent.trim()).join('/'));
  ok(pressedTL === 'Simple/Detalyado', `Tagalog: the switch reads ${pressedTL}`);
  ok(/Wala sa dry stage ang Benguet ngayong buwan\./.test(s.sum) && /Inaasahan ng PAGASA ang tuyong panahon mula Nobyembre 2026 hanggang Abril 2027 o higit pa/.test(s.sum) && /Asahan ang 3 hanggang 5 pang tuyong araw/.test(s.sum), `Tagalog: the summary (${s.sum})`);
  const english = ['What this means', 'Your area', 'Outlook for the coming months', 'Projected dry period', 'What you can do right now', 'See more', 'Get help', 'All hotlines', 'Tap a month', 'An outlook is a forecast', 'issued 21', 'is not in a dry stage', 'more dry days than usual'];
  const left = english.filter(e => s.text.includes(e));
  ok(!left.length, `Tagalog: no English left in the panel${left.length ? ' (' + left.join(', ') + ')' : ''}`);
  await page.click('.viewsw [data-view="detailed"]'); await page.waitForTimeout(400);
  s = await st();
  ok(!s.simple && s.lang === 'tl', 'switching views keeps Tagalog');
  await page.click('.viewsw [data-view="simple"]'); await page.waitForTimeout(400);
  if (mobile) await shot('simple_tl');

  // ---- the panel's own links open the drawers
  await page.click('.top .lang [data-lang="en"]'); await until(() => document.documentElement.lang === 'en');
  await page.click('#sMore'); await page.waitForTimeout(400);
  ok(await page.evaluate(() => !document.querySelector('#guide').hidden && document.querySelector('#gtabT').getAttribute('aria-selected') === 'true'), 'See more opens Be ready on What to do');
  await page.keyboard.press('Escape'); await page.waitForTimeout(700);
  await page.click('#sHot'); await page.waitForTimeout(400);
  ok(await page.evaluate(() => !document.querySelector('#guide').hidden && document.querySelector('#gtabH').getAttribute('aria-selected') === 'true'), 'All hotlines opens Be ready on Hotlines');
  await page.keyboard.press('Escape'); await page.waitForTimeout(700);
  await page.click('#sSrc'); await page.waitForTimeout(400);
  ok(await page.evaluate(() => !document.querySelector('#drawer').hidden), 'Sources opens the sources drawer');
  await page.keyboard.press('Escape'); await page.waitForTimeout(500);

  console.log(logs.join('\n'));
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('1 FAILED'); process.exit(1); });
