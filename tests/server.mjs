// Local test server. Serves the site from the repo root and stands in for every live data source, so the app runs
// offline and answers the same way every time. Open http://127.0.0.1:8765/?test=1 (test mode reads these mocks).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const H = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(H, '..'), M = path.join(H, 'mocks');
const PORT = +(process.env.PORT || 8765);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f;
  if (p.startsWith('/test-tiles/')) f = path.join(M, 'tiles', p.slice(12)); // terrain tiles (AWS Terrain Tiles)
  else if (p === '/api/landcover') f = path.join(M, 'landcover.png'); // ESA WorldCover, as the API returns it
  else if (p.startsWith('/api/')) f = path.join(M, p.slice(5) + '.json'); // enso, dams, fires, osm, views
  else if (p === '/mock/om') f = path.join(M, 'om.json'); // Open-Meteo, by town
  else if (p === '/mock/om_now') f = path.join(M, 'om_now.json'); // Open-Meteo, now and the week ahead
  else if (p === '/ph' || p === '/ph/review') f = path.join(ROOT, p, 'index.html'); // cleanUrls, as on Vercel
  else f = path.join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (e, b) => {
    if (e) { res.writeHead(404); res.end('not found ' + p); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(b);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`test server: http://127.0.0.1:${PORT}/?test=1`));
