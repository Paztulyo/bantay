// Slow-motion frames of a drawer burning away. Args: dark, phone, src (the Sources drawer instead of Be ready),
// map (render the 3D map behind it; slow), scroll=N (scroll the panel first), n=frames, tag=name
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const THREE_DIR = path.join(__dirname, 'node_modules/three');
const { BASE, LAUNCH } = require('./env');
const OUT = path.join(__dirname, 'out', 'burn') + path.sep;
fs.mkdirSync(OUT, { recursive: true });
const args = Object.fromEntries(process.argv.slice(2).map(a => [a.split('=')[0], a.split('=')[1] ?? '1']));
const dark = !!args.dark, phone = !!args.phone, src = !!args.src, map = !!args.map, N = +(args.n || 26), tag = args.tag || 'b';
const F = +(args.f || 0.1);
(async () => {
  const launch = { ...LAUNCH };
  if (map) launch.args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const browser = await chromium.launch(launch);
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light' }
    : { viewport: { width: 1100, height: 760 }, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) logs.push('[console] ' + m.text()); });
  if (map) await page.route('https://cdn.jsdelivr.net/npm/three@0.147.0/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(THREE_DIR, r.request().url().split('three@0.147.0/')[1])) }));
  else await page.route('https://cdn.jsdelivr.net/**', r => r.abort());
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.route('**/api/views**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"off"}' }));
  await page.goto(BASE + '/?test=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(m => document.querySelector('#gq') && (!m || (window.__wx && __wx.fx)), map, { timeout: 180000 });
  await page.waitForTimeout(map ? 3000 : 800);
  const btn = src ? '#srcBtn' : '#guideBtn', close = src ? '#srcClose' : '#guideClose', dr = src ? '#drawer' : '#guide';
  await page.click(btn); await page.waitForTimeout(600);
  if (args.scroll) { await page.evaluate(([d, y]) => { document.querySelector(d + ' .drawer-c').scrollTop = +y; }, [dr, args.scroll]); await page.waitForTimeout(300); }
  const rect = await page.evaluate(d => { const b = document.querySelector(d + ' .drawer-c').getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map(Math.round); }, dr);
  // slow the page clock: performance.now, rAF timestamps, timers and CSS animations
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Animation.enable'); await cdp.send('Animation.setPlaybackRate', { playbackRate: F });
  await page.evaluate(F => {
    const real = performance.now.bind(performance), s = real();
    performance.now = () => s + (real() - s) * F;
    const raf = requestAnimationFrame.bind(window); window.requestAnimationFrame = cb => raf(() => cb(performance.now()));
    const st = setTimeout.bind(window); window.setTimeout = (fn, d, ...a) => st(fn, (d || 0) / F, ...a);
    window.__t0 = null;
  }, F);
  const clip = phone ? undefined : { x: Math.max(0, rect[0] - 40), y: 0, width: Math.min(1100, rect[2] + 80), height: 760 };
  await page.evaluate(c => { window.__t0 = performance.now(); document.querySelector(c).click(); }, close);
  const times = [];
  for (let i = 0; i < N; i++) {
    const tm = await page.evaluate(() => [Math.round(performance.now() - window.__t0), !!document.querySelector('.smoke-cv'), !!document.querySelector('.drawer-ghost')]);
    await page.screenshot({ path: OUT + `${tag}_${String(i).padStart(2, '0')}.png`, clip });
    times.push(tm);
    if (!tm[1] && i > 2) break;
  }
  fs.writeFileSync(OUT + `${tag}_times.json`, JSON.stringify(times));
  console.log('drawer rect', rect.join(','), '\nframes (ms, canvas, ghost):', times.map(t => `${t[0]}${t[1] ? '' : 'x'}${t[2] ? 'g' : ''}`).join(' '));
  if (logs.length) console.log(logs.join('\n'));
  await browser.close();
})();
