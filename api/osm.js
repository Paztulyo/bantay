// OpenStreetMap roads, rivers, places and peaks for the map, via Overpass.
// Output is simplified and delta-encoded (1e-5 degree integers from 120E,16N) to stay small.
import { send, attempt, nowISO, UA } from './_lib.js';

const BB = '16.05,120.35,17.02,121.05'; // south,west,north,east
const HEAD = '[out:json][timeout:150][maxsize:268435456];';
const QUERIES = {
  roads: `${HEAD}way["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link)$"](${BB});out geom qt;`,
  water: `${HEAD}(way["waterway"~"^(river|canal)$"](${BB});way["waterway"="stream"]["name"](${BB}););out geom qt;`,
  points: `${HEAD}(node["place"~"^(city|town|village|suburb)$"]["name"](${BB});node["natural"="peak"]["name"](${BB}););out qt;`,
};
const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

// Hedged request: start on the main instance, add a mirror every 12 s until one answers.
// Each attempt gives up after 110 s, so the whole call settles well inside the 300 s limit.
function overpass(query) {
  return new Promise((resolve, reject) => {
    let done = false, failed = 0;
    const errors = [], ctrls = [];
    MIRRORS.forEach((url, i) => {
      setTimeout(async () => {
        if (done) return;
        const ctrl = new AbortController(); ctrls.push(ctrl);
        const host = new URL(url).host;
        const timer = setTimeout(() => ctrl.abort(new Error(`${host} timed out`)), 110000);
        try {
          const r = await fetch(url, {
            method: 'POST',
            headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(query),
            signal: ctrl.signal,
          });
          if (!r.ok) throw new Error(`${host} HTTP ${r.status}`);
          const j = await r.json();
          if (!j.elements) throw new Error(`${host}: ${(j.remark || 'no elements').slice(0, 120)}`);
          if (j.remark && /runtime error/i.test(j.remark)) throw new Error(`${host}: ${j.remark.slice(0, 120)}`);
          if (!done) { done = true; ctrls.forEach(c => c !== ctrl && c.abort()); resolve({ j, host }); }
        } catch (e) {
          if (done) return;
          errors.push(String(e.message || e));
          if (++failed === MIRRORS.length) reject(new Error(errors.join('; ')));
        } finally { clearTimeout(timer); }
      }, i * 12000);
    });
  });
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py, d = ex * ex + ey * ey;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps * eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const enc = pts => {
  const out = [];
  let px = 0, py = 0;
  pts.forEach(([lon, lat], i) => {
    const x = Math.round((lon - 120) * 1e5), y = Math.round((lat - 16) * 1e5);
    if (i === 0) out.push(x, y); else if (x !== px || y !== py) out.push(x - px, y - py); else return;
    px = x; py = y;
  });
  return out;
};
const xy = (lon, lat) => [Math.round((lon - 120) * 1e5), Math.round((lat - 16) * 1e5)];

function build(j) {
  const roads = { trunk: [], primary: [], secondary: [], tertiary: [] };
  const rivers = [], streams = [], places = [], peaks = [];
  for (const e of j.elements) {
    const tg = e.tags || {};
    if (e.type === 'way' && e.geometry) {
      const pts = e.geometry.map(g => [g.lon, g.lat]);
      if (tg.highway) {
        const h = tg.highway.replace('_link', '');
        const cls = h === 'motorway' || h === 'trunk' ? 'trunk' : h;
        if (roads[cls]) { const s = rdp(pts, 0.00018); if (s.length > 1) roads[cls].push(enc(s)); }
      } else if (tg.waterway === 'river' || tg.waterway === 'canal') {
        const s = rdp(pts, 0.00022); if (s.length > 1) rivers.push({ n: tg.name || '', c: enc(s) });
      } else if (tg.waterway === 'stream') {
        const s = rdp(pts, 0.0003); if (s.length > 1) streams.push({ n: tg.name || '', c: enc(s) });
      }
    } else if (e.type === 'node') {
      if (tg.place) places.push([tg.name, tg.place, ...xy(e.lon, e.lat), tg.population ? +tg.population || 0 : 0]);
      else if (tg.natural === 'peak') peaks.push([tg.name, tg.ele ? Math.round(parseFloat(tg.ele)) || null : null, ...xy(e.lon, e.lat)]);
    }
  }
  return { roads, rivers, streams, places, peaks };
}

export default async function handler(req, res) {
  const hosts = {};
  const r = await attempt({ id: 'osm', name: 'OpenStreetMap via Overpass', url: 'https://www.openstreetmap.org/copyright' }, async () => {
    const parts = await Promise.allSettled(Object.entries(QUERIES).map(async ([k, q]) => { const o = await overpass(q); hosts[k] = o.host; return o.j.elements; }));
    const failed = parts.filter(p => p.status === 'rejected');
    if (failed.length === parts.length) throw failed[0].reason;
    const out = build({ elements: parts.flatMap(p => p.status === 'fulfilled' ? p.value : []) });
    out.partial = failed.length ? Object.keys(QUERIES).filter((_, i) => parts[i].status === 'rejected') : undefined;
    return out;
  });
  r.source.mirror = hosts;
  const body = { ok: !!r.value, fetched_at: nowISO(), sources: [r.source], enc: { origin: [120, 16], scale: 1e5, delta: true }, ...(r.value || {}) };
  // a partial answer is cached briefly so the missing layer is retried soon
  send(res, body, body.ok ? (r.value.partial ? { cache: 3600, swr: 3600 } : { cache: 2592000, swr: 2592000 }) : { status: 503 });
}
