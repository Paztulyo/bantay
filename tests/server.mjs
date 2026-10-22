// Local test server. Serves the site from the repo root and stands in for every live data source, so the app runs
// offline and answers the same way every time. Open http://127.0.0.1:8765/?test=1 (test mode reads these mocks).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib'; import { fileURLToPath } from 'node:url';
const H = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(H, '..'), M = path.join(H, 'mocks');
const PORT = +(process.env.PORT || 8765);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
// Terrain tiles the mocks don't have (the national 3D map asks for the whole country) are made up here: land from the
// province outlines, hills from a few smooth bumps where the real mountain ranges are. Terrarium encoding, as AWS serves.
let RINGS = null;
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = b => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
  const hd = Buffer.alloc(13); hd.writeUInt32BE(w, 0); hd.writeUInt32BE(h, 4); hd[8] = 8; hd[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hd), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const RANGES = [[120.9, 16.9, 0.45, 2300], [121.9, 16.6, 0.35, 1500], [121.2, 15.2, 0.3, 1100], [121.0, 12.9, 0.3, 1700], [122.2, 11.2, 0.35, 1300],
  [123.0, 10.2, 0.35, 1600], [124.9, 7.6, 0.8, 2100], [123.5, 8.0, 0.4, 1400], [125.2, 10.9, 0.4, 900], [118.6, 9.5, 0.5, 1200], [123.6, 13.6, 0.3, 1500]];
const synthCache = new Map();
function synthTile(z, x, y) {
  const key = `${z}/${x}/${y}`; if (synthCache.has(key)) return synthCache.get(key);
  if (!RINGS) { RINGS = []; for (const f of JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'ph_provinces.json'))).features) for (const poly of f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) for (const r of poly) RINGS.push(r); }
  const n = 2 ** z, lonOf = px => (x + px / 256) / n * 360 - 180, latOf = py => Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + py / 256) / n))) * 180 / Math.PI;
  const lon0 = lonOf(0), lon1 = lonOf(256), lat0 = latOf(0), lat1 = latOf(256), edges = [];
  for (const r of RINGS) for (let i = 0; i < r.length - 1; i++) { const a = r[i], b = r[i + 1]; if (Math.max(a[1], b[1]) < lat1 || Math.min(a[1], b[1]) > lat0) continue; edges.push(a, b); }
  const land = new Uint8Array(65536);
  for (let py = 0; py < 256; py++) {
    const lat = latOf(py + 0.5), xs = [];
    for (let k = 0; k < edges.length; k += 2) { const a = edges[k], b = edges[k + 1]; if ((a[1] > lat) !== (b[1] > lat)) xs.push(a[0] + (lat - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - lon0) / (lon1 - lon0) * 256 - 0.5)), c1 = Math.min(255, Math.floor((xs[k + 1] - lon0) / (lon1 - lon0) * 256 - 0.5));
      for (let c = c0; c <= c1; c++) land[py * 256 + c] ^= 1;
    }
  }
  const rgb = Buffer.alloc(65536 * 3);
  for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
    const lon = lonOf(px + 0.5), lat = latOf(py + 0.5);
    let h = -1500;
    if (land[py * 256 + px]) {
      h = 60 + 140 * (0.5 + 0.5 * Math.sin(lon * 9.1) * Math.cos(lat * 7.3));
      for (const [cx, cy, s, a] of RANGES) h += a * Math.exp(-((lon - cx) ** 2 + (lat - cy) ** 2) / (2 * s * s)) * (0.8 + 0.2 * Math.sin(lon * 23 + lat * 17));
    }
    const v = h + 32768, i = (py * 256 + px) * 3;
    rgb[i] = Math.floor(v / 256); rgb[i + 1] = Math.floor(v) % 256; rgb[i + 2] = Math.floor((v % 1) * 256);
  }
  const out = png(256, 256, rgb); synthCache.set(key, out); return out;
}
http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const tm = p.match(/^\/test-tiles\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if (tm && !fs.existsSync(path.join(M, 'tiles', p.slice(12)))) {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(synthTile(+tm[1], +tm[2], +tm[3])); return;
  }
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
