// Shared settings for the browser tests.
//   BASE_URL     where the site is served (default: the local test server, `npm run serve`)
//   PW_CHROMIUM  path to a Chromium binary, if not using the one `npx playwright install chromium` provides
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8765';
const OUT = path.join(__dirname, 'out') + path.sep; // screenshots land here (git-ignored)
fs.mkdirSync(OUT, { recursive: true });
const LAUNCH = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};
module.exports = { BASE, OUT, LAUNCH };
