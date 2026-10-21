// The map's hover label on touch: shows while a finger drags, goes when it lifts and stays gone; scrolling and drawers clear it.
const { chromium } = require('playwright');
const { BASE, LAUNCH } = require('./env');
const fs = require('fs'), path = require('path');
const THREE_DIR = path.join(__dirname, 'node_modules/three');
(async () => {
  const browser = await chromium.launch({ ...LAUNCH, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const logs = [], fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); logs.push((c ? 'PASS ' : 'FAIL ') + m); };
  const open = async (opts) => {
    const page = await (await browser.newContext(opts)).newPage();
    page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
    await page.route('https://cdn.jsdelivr.net/npm/three@0.147.0/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(THREE_DIR, r.request().url().split('three@0.147.0/')[1])) }));
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route('https://fonts.gstatic.com/**', r => r.abort());
    await page.route('**/api/views**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"off"}' }));
    await page.goto(BASE + '/?test=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__wx && __wx.fx && document.querySelector('#gq'), null, { timeout: 180000 });
    await page.waitForTimeout(1500);
    return page;
  };
  const tipOp = page => page.evaluate(() => getComputedStyle(document.querySelector('#tip')).opacity);
  const waitTip = (page, want) => page.waitForFunction(w => getComputedStyle(document.querySelector('#tip')).opacity === w, want, { timeout: 30000 }).then(() => true).catch(() => false);

  // phone: drag a finger across the map
  let page = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const cdp = await page.context().newCDPSession(page);
  const b = await (await page.$('#vp')).boundingBox();
  const x0 = b.x + b.width * 0.45, y0 = b.y + b.height * 0.55;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + i * 4, y: y0 + i * 2 }] }); await page.waitForTimeout(120); }
  const during = await waitTip(page, '1');
  ok(during, 'while a finger drags over the map, its label shows');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const gone = await waitTip(page, '0');
  await page.waitForTimeout(1500); // long enough for a late hover pick to land
  ok(gone && (await tipOp(page)) === '0', 'lifting the finger clears it, and it stays cleared');
  // a scroll clears a label even mid-drag
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 4; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - i * 4, y: y0 }] }); await page.waitForTimeout(120); }
  await waitTip(page, '1');
  await page.evaluate(() => window.scrollBy(0, 60));
  ok(await waitTip(page, '0'), 'scrolling the page clears it');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  // an open drawer always hides it
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('#tip').style.opacity = '1'; });
  await page.locator('#guideBtn').tap(); await page.waitForTimeout(500);
  ok((await tipOp(page)) === '0', 'a label never shows over an open drawer');
  await page.context().close();

  // desktop: hover still works, and scrolling the side column clears it
  page = await open({ viewport: { width: 1440, height: 900 } });
  const d = await (await page.$('#vp')).boundingBox();
  for (let i = 0; i < 5; i++) { await page.mouse.move(d.x + d.width * 0.45 + i * 3, d.y + d.height * 0.55); await page.waitForTimeout(150); }
  ok(await waitTip(page, '1'), 'desktop hover shows the label as before');
  await page.evaluate(() => { const r = document.querySelector('#rail'); r.scrollTop += 120; });
  ok(await waitTip(page, '0'), 'scrolling the side column clears it');
  await page.mouse.move(d.x + d.width * 0.5, d.y + d.height * 0.5); await page.waitForTimeout(200);
  await page.mouse.move(d.x + d.width * 0.52, d.y + d.height * 0.52);
  ok(await waitTip(page, '1'), 'moving the mouse again brings it back');

  logs.push(fails.length ? `${fails.length} FAILED` : 'ALL PASS');
  console.log(logs.join('\n'));
  await browser.close();
})();
