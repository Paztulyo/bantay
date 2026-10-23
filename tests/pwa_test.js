// Installing the site as an app: the manifest and its icons, the service worker (what it keeps and what it never
// keeps), opening offline, Chrome's own installability check, the links people share, and the Install button in Simple
// view: Chrome's native prompt, the steps on iPhone Safari, in-app browsers, an installed app, and hiding it.
// Phones themselves are the last check; this covers everything up to the install sheet.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const THREE_DIR = path.join(__dirname, 'node_modules/three');
const { BASE, OUT, LAUNCH } = require('./env');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const FB_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/482.0.0.47.83;]';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

(async () => {
  const browser = await chromium.launch({ ...LAUNCH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const logs = [], fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); logs.push((c ? 'PASS ' : 'FAIL ') + m); };
  const context = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, ...opts });
    await ctx.route('https://cdn.jsdelivr.net/npm/three@0.147.0/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(THREE_DIR, r.request().url().split('three@0.147.0/')[1])) }));
    await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await ctx.route('https://fonts.gstatic.com/**', r => r.abort());
    return ctx;
  };
  const watch = page => {
    page.on('pageerror', e => { logs.push(`[pageerror] ${e.message}`); fails.push('page error: ' + e.message); });
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) logs.push(`[console] ${m.text()}`); });
    return page;
  };
  const until = (page, fn, arg, t = 60000) => page.waitForFunction(fn, arg, { timeout: t }).then(() => true).catch(() => false);
  const strip = page => page.evaluate(() => { const s = document.querySelector('#sInstall'); return s ? { btn: s.querySelector('#sInstallBtn')?.textContent.trim(), note: s.querySelector('.s-inst-n')?.textContent.trim() || '', share: !!s.querySelector('.s-inst-n svg') } : null; });

  // ---- the manifest, its icons, and the tags on the page
  let ctx = await context({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  const req = ctx.request;
  const mr = await req.get(BASE + '/manifest.webmanifest');
  const M = await mr.json().catch(() => ({}));
  ok(mr.ok() && /manifest\+json/.test(mr.headers()['content-type'] || ''), 'the manifest is served as a web app manifest');
  ok(M.name === 'Bantay El Niño' && M.short_name && M.start_url === '/' && M.scope === '/' && M.display === 'standalone' && M.id === '/', `name, start, scope and standalone display (${M.name}, ${M.short_name}, ${M.display})`);
  ok(/^#[0-9a-f]{6}$/i.test(M.theme_color) && /^#[0-9a-f]{6}$/i.test(M.background_color), `theme and background colours (${M.theme_color}, ${M.background_color})`);
  const pngSize = b => [b.readUInt32BE(16), b.readUInt32BE(20)];
  for (const [size, purpose] of [[192, 'any'], [512, 'any'], [512, 'maskable']]) {
    const ic = (M.icons || []).find(i => i.sizes === `${size}x${size}` && i.purpose === purpose);
    const r = ic && await req.get(BASE + ic.src), b = r && await r.body();
    ok(!!ic && r.ok() && JSON.stringify(pngSize(b)) === `[${size},${size}]`, `a ${size}px ${purpose} icon (${ic ? ic.src : 'missing'})`);
  }
  const home = await (await req.get(BASE + '/')).text();
  ok(/<link rel="manifest" href="\/manifest\.webmanifest"/.test(home) && (home.match(/<meta name="theme-color"/g) || []).length === 2 && /apple-touch-icon/.test(home) && /apple-mobile-web-app-title/.test(home), 'the page links the manifest, both theme colours and the iPhone icon and title');
  // the links people share keep working
  for (const u of ['/', '/?fbclid=IwAR0abc123', '/?lang=tl', '/?utm_source=reddit&utm_medium=social', '/?view=simple']) {
    const r = await req.get(BASE + u);
    ok(r.ok() && /<title>Bantay El Niño<\/title>/.test(await r.text()), `${u} opens the site`);
  }

  // ---- the service worker: what it keeps, what it never keeps, Chrome's install check
  let page = watch(await ctx.newPage());
  await page.goto(BASE + '/?test=1&sw=1&view=simple', { waitUntil: 'domcontentloaded' });
  ok(await until(page, () => navigator.serviceWorker && navigator.serviceWorker.controller, null, 30000) || await page.evaluate(async () => { await navigator.serviceWorker.ready; return true; }), 'the service worker installs');
  await page.reload({ waitUntil: 'domcontentloaded' });
  ok(await until(page, () => !!navigator.serviceWorker.controller), 'it controls the page after a reload');
  ok(await until(page, () => document.querySelector('#simple .s-do') && window.bantayApp && (document.querySelector('#liveBtn')?.textContent || '').includes('7/7'), null, 150000), 'the page and its live feeds load through it');
  await page.waitForTimeout(1500);
  let keys = await page.evaluate(async () => (await (await caches.open('bantay-v1')).keys()).map(r => new URL(r.url).pathname + new URL(r.url).search));
  const must = ['/', '/js/app.js', '/js/simple.js', '/js/pwa.js', '/css/simple.css', '/data/outlook.json', '/data/guide.json', '/js/lang/tl.js', '/img/icon-192.png', '/manifest.webmanifest'];
  ok(must.every(k => keys.includes(k)), `it keeps the page, its code and the dated editorial files (${keys.length} files)${must.filter(k => !keys.includes(k)).length ? ': missing ' + must.filter(k => !keys.includes(k)).join(', ') : ''}`);
  ok(!keys.some(k => /^\/(api|mock)\//.test(k) || /\?/.test(k)), `it keeps no live readings and no copy per link: ${keys.filter(k => /^\/(api|mock)\//.test(k) || /\?/.test(k)).join(', ') || 'none'}`);
  const cdp = await ctx.newCDPSession(page);
  const inst = await cdp.send('Page.getInstallabilityErrors').catch(e => ({ err: e.message }));
  const errs = (inst.installabilityErrors || []).map(e => e.errorId);
  ok(!inst.err && !errs.length, `Chrome's installability check passes${inst.err ? ' (' + inst.err + ')' : errs.length ? ': ' + errs.join(', ') : ''}`);
  const man = await cdp.send('Page.getAppManifest').catch(e => ({ err: e.message }));
  ok(!man.err && !(man.errors || []).length, `Chrome reads the manifest without errors${(man.errors || []).length ? ': ' + man.errors.map(e => e.message).join('; ') : ''}`);

  // ---- offline: the app opens, the hotlines work, live data is not passed off as current
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  ok(await until(page, () => document.querySelector('#simple .s-area') && document.querySelector('#sAreaH'), null, 60000), 'offline: the app opens from what the worker kept');
  ok(await until(page, () => (document.querySelector('#liveBtn')?.textContent || '').startsWith('Offline'), null, 30000), `offline: the status line says so instead of Live (${await page.evaluate(() => document.querySelector('#liveBtn')?.textContent || '')})`);
  const apiOffline = await page.evaluate(async () => { try { await fetch('/api/enso'); return 'answered'; } catch { return 'failed'; } });
  ok(apiOffline === 'failed', 'offline: a live feed fails rather than answering from a stored copy');
  ok(await page.evaluate(() => !document.querySelector('#wxcard .wxc-temp b')), 'offline: the weather card shows no temperature as if it were current');
  await page.click('#sHot'); await page.waitForTimeout(500);
  ok(await page.evaluate(() => document.querySelectorAll('#gpanH .hnum').length > 20), 'offline: the hotlines and their tap-to-call numbers still open');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await page.goto(BASE + '/?fbclid=IwAR0offline&test=1&sw=1&view=simple', { waitUntil: 'domcontentloaded' }).catch(() => {});
  ok(await until(page, () => document.querySelector('#simple .s-area')), 'offline: a shared Facebook link still opens the app');
  await ctx.setOffline(false);
  // the feeds come back by themselves (the map's terrain, which failed offline, waits for the next visit)
  ok(await until(page, () => /^Live · [5-7]\/7 sources/.test(document.querySelector('#liveBtn')?.textContent || ''), null, 60000), `back online: the live feeds return on their own (${await page.evaluate(() => document.querySelector('#liveBtn')?.textContent || '')})`);
  ok(await until(page, () => !!document.querySelector('#wxcard .wxc-temp b'), null, 30000), 'back online: the weather card fills in again');
  keys = await page.evaluate(async () => (await (await caches.open('bantay-v1')).keys()).map(r => new URL(r.url).pathname));
  ok(!keys.some(k => /^\/(api|mock)\//.test(k)), 'after all that, still no live readings in the worker’s store');
  await ctx.close();

  // ---- the Install button: Chrome and Edge offer their own prompt
  ctx = await context({ userAgent: ANDROID });
  page = watch(await ctx.newPage());
  await page.goto(BASE + '/?test=1&view=simple', { waitUntil: 'domcontentloaded' });
  await until(page, () => document.querySelector('#simple .s-area'));
  ok(!(await strip(page)), 'no Install button before the browser offers to install');
  const offer = outcome => page.evaluate(o => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    window.__prompts = window.__prompts || 0;
    e.prompt = () => { window.__prompts++; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: o, platform: 'web' });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  }, outcome);
  ok(await offer('accepted'), 'the browser’s own banner is held back for the button');
  let b = await strip(page);
  ok(b && b.btn === 'Install Bantay El Niño', `Chrome: the button shows (${b && b.btn})`);
  await page.click('.viewsw [data-view="detailed"]'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => !document.querySelector('#sInstall') || !document.querySelector('#sInstall').offsetParent), 'Detailed shows no Install button');
  await page.click('.viewsw [data-view="simple"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + 'pwa_android.png', clip: { x: 0, y: 0, width: 390, height: 844 } }).catch(() => {});
  await page.click('#sInstallBtn'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.__prompts) === 1, 'Chrome: the button opens the native install prompt');
  ok(!(await strip(page)), 'accepted: the button goes away');
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled'))); await page.waitForTimeout(200);
  ok(!(await strip(page)), 'installed: it stays away');
  await ctx.close();

  // ---- iPhone Safari: the steps, in the page's language
  ctx = await context({ userAgent: IPHONE });
  page = watch(await ctx.newPage());
  await page.goto(BASE + '/?test=1&view=simple', { waitUntil: 'domcontentloaded' });
  await until(page, () => document.querySelector('#simple .s-area'));
  b = await strip(page);
  ok(b && b.btn === 'Install Bantay El Niño' && !b.note, 'iPhone Safari: the button shows');
  await page.click('#sInstallBtn'); await page.waitForTimeout(200);
  b = await strip(page);
  ok(b && b.note === 'Tap Share, then Add to Home Screen, then Open as Web App.' && b.share, `iPhone Safari: it shows the steps with the Share icon (${b && b.note})`);
  await page.screenshot({ path: OUT + 'pwa_iphone.png', clip: { x: 0, y: 0, width: 390, height: 844 } }).catch(() => {});
  await page.click('.top .lang [data-lang="tl"]');
  ok(await until(page, () => (document.querySelector('.s-inst-n')?.textContent || '').startsWith('Pindutin ang Share')), 'iPhone Safari: the steps in Tagalog');
  await page.click('.top .lang [data-lang="en"]'); await until(page, () => document.documentElement.lang === 'en');
  // hiding it: stays hidden after a reload, for 30 days
  await page.click('#sInstallX'); await page.waitForTimeout(200);
  const after = await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
  ok(!(await strip(page)) && after === 'sAreaH', `the × hides it, and focus moves to the heading, not the town picker, which a phone would open (${after})`);
  await page.reload({ waitUntil: 'domcontentloaded' }); await until(page, () => document.querySelector('#simple .s-area'));
  const until30 = await page.evaluate(() => (+localStorage.getItem('bantay.installHidden') - Date.now()) / 864e5);
  ok(!(await strip(page)) && until30 > 29 && until30 <= 30, `hidden after a reload, for ${until30.toFixed(1)} days`);
  await ctx.close();

  // ---- installed already: an iPhone home-screen app, and an installed app on Android
  ctx = await context({ userAgent: IPHONE });
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  page = watch(await ctx.newPage());
  await page.goto(BASE + '/?test=1&view=simple', { waitUntil: 'domcontentloaded' });
  await until(page, () => document.querySelector('#simple .s-area'));
  ok(!(await strip(page)), 'opened from the iPhone home screen: no Install button');
  await ctx.close();
  ctx = await context({ userAgent: ANDROID });
  await ctx.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = q => (/display-mode: standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q)); });
  page = watch(await ctx.newPage());
  await page.goto(BASE + '/?test=1&view=simple', { waitUntil: 'domcontentloaded' });
  await until(page, () => document.querySelector('#simple .s-area'));
  await offer('accepted');
  ok(!(await strip(page)), 'running as an installed app: no Install button, even if offered');
  await ctx.close();

  // ---- inside Facebook's browser: open a real browser first
  ctx = await context({ userAgent: FB_ANDROID });
  page = watch(await ctx.newPage());
  await page.goto(BASE + '/?test=1&view=simple&fbclid=IwAR0abc', { waitUntil: 'domcontentloaded' });
  await until(page, () => document.querySelector('#simple .s-area'));
  await page.click('#sInstallBtn').catch(() => {}); await page.waitForTimeout(200);
  b = await strip(page);
  ok(b && b.note === 'To install, open this page in Chrome or Safari first.', `Facebook's browser: it says to open Chrome or Safari (${b && b.note})`);
  await ctx.close();

  console.log(logs.join('\n'));
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); console.log('1 FAILED'); process.exit(1); });
