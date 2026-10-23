// Draws the app icons in img/ from the logo (img/logo.svg) with Chromium, for the web app manifest:
//   icon-192.png, icon-512.png    the logo on white, like the favicon and the home-screen icon for iPhone
//   icon-maskable-512.png         white to the edges with the logo inside the middle 80%, for Android's icon shapes
// Run after changing the logo: node make_icons.js (from tests/)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { LAUNCH } = require('./env');
const IMG = path.join(__dirname, '..', 'img');
const logo = fs.readFileSync(path.join(IMG, 'logo.svg'), 'utf8');

(async () => {
  const browser = await chromium.launch({ ...LAUNCH });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [file, size, width] of [['icon-192.png', 192, 0.78], ['icon-512.png', 512, 0.78], ['icon-maskable-512.png', 512, 0.62]]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;background:#fff;display:grid;place-items:center">
      <div style="width:${Math.round(size * width)}px;transform:translateY(-${Math.round(size * 0.02)}px)">${logo.replace('<svg ', '<svg width="100%" style="display:block" ')}</div></body></html>`);
    await page.screenshot({ path: path.join(IMG, file), clip: { x: 0, y: 0, width: size, height: size } });
    console.log('wrote img/' + file);
  }
  await browser.close();
})();
