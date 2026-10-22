// Serves the site's Google Fonts from local files, so layout checks measure real text widths offline.
// The fonts come from the @fontsource packages in package.json (npm install), or FONTS_DIR if set.
const fs = require('fs'), path = require('path');
const DIR = process.env.FONTS_DIR || path.join(__dirname, 'node_modules');
const FACES = [['DM Sans', 'dm-sans', [400, 500, 700]], ['Manrope', 'manrope', [500, 600, 700]], ['DM Mono', 'dm-mono', [400, 500]]];
const file = (pkg, w) => path.join(DIR, '@fontsource', pkg, 'files', `${pkg}-latin-${w}-normal.woff2`);
const available = () => FACES.every(([, pkg, ws]) => ws.every(w => fs.existsSync(file(pkg, w))));
async function realFonts(page) {
  if (!available()) return false;
  const css = FACES.flatMap(([fam, pkg, ws]) => ws.map(w => `@font-face{font-family:'${fam}';font-style:normal;font-weight:${w};font-display:block;src:url(https://fonts.gstatic.com/local/${pkg}/${w}.woff2) format('woff2')}`)).join('\n');
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: css }));
  await page.route('https://fonts.gstatic.com/local/**', r => {
    const [pkg, w] = r.request().url().split('/local/')[1].replace('.woff2', '').split('/');
    r.fulfill({ status: 200, contentType: 'font/woff2', body: fs.readFileSync(file(pkg, w)) });
  });
  return true;
}
module.exports = { realFonts, available };
