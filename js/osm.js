// Roads, rivers, places and peaks from OpenStreetMap, read in the browser from OpenFreeMap's
// vector tiles (OpenMapTiles schema, zoom 11). The result has the same compact shape that
// api/osm.js returns, so the map can use either: lines are delta-encoded 1e-5° integers
// counted from 120°E, 16°N.
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const Z = 11;
const AREA = [120.38, 16.08, 121.0, 16.99]; // W S E N, same as map3d.js
const ROAD = { motorway: 'trunk', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary' };
const PLACE = new Set(['city', 'town', 'village', 'suburb']);

/* ---------- a minimal protobuf reader for Mapbox Vector Tiles ---------- */
function decodeTile(buf) {
  const p = { pos: 0 }, dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), td = new TextDecoder();
  const varint = () => { let v = 0, s = 0, b; do { b = buf[p.pos++]; v += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return v; };
  const skip = w => { if (w === 0) varint(); else if (w === 1) p.pos += 8; else if (w === 2) { const l = varint(); p.pos += l; } else if (w === 5) p.pos += 4; else throw new Error('bad wire type ' + w); };
  const str = () => { const l = varint(); const s = td.decode(buf.subarray(p.pos, p.pos + l)); p.pos += l; return s; };
  const packed = out => { const end = varint() + p.pos; while (p.pos < end) out.push(varint()); };
  const layers = {};
  while (p.pos < buf.length) {
    const k = varint();
    if (k >> 3 !== 3 || (k & 7) !== 2) { skip(k & 7); continue; }
    const end = varint() + p.pos, L = { name: '', extent: 4096, keys: [], vals: [], feats: [] };
    while (p.pos < end) {
      const k2 = varint(), f = k2 >> 3, w = k2 & 7;
      if (f === 1) L.name = str();
      else if (f === 2) {
        const fe = varint() + p.pos, F = { type: 0, tags: [], geom: [] };
        while (p.pos < fe) {
          const k3 = varint(), g = k3 >> 3, w3 = k3 & 7;
          if (g === 2 && w3 === 2) packed(F.tags); else if (g === 3) F.type = varint(); else if (g === 4 && w3 === 2) packed(F.geom); else skip(w3);
        }
        L.feats.push(F);
      } else if (f === 3) L.keys.push(str());
      else if (f === 4) {
        const ve = varint() + p.pos; let v = null;
        while (p.pos < ve) {
          const k4 = varint(), h = k4 >> 3, w4 = k4 & 7;
          if (h === 1) v = str();
          else if (h === 2) { v = dv.getFloat32(p.pos, true); p.pos += 4; }
          else if (h === 3) { v = dv.getFloat64(p.pos, true); p.pos += 8; }
          else if (h === 4 || h === 5) v = varint();
          else if (h === 6) { const n = varint(); v = n % 2 ? -(n + 1) / 2 : n / 2; }
          else if (h === 7) v = !!varint();
          else skip(w4);
        }
        L.vals.push(v);
      } else if (f === 5) L.extent = varint();
      else skip(w);
    }
    layers[L.name] = L;
  }
  return layers;
}
function geomParts(geom) { // command stream -> arrays of [x, y] in tile units
  const out = []; let x = 0, y = 0, i = 0, cur = null;
  const zz = n => (n % 2 ? -(n + 1) / 2 : n / 2);
  while (i < geom.length) {
    const c = geom[i++], id = c & 7, n = c >> 3;
    if (id === 1 || id === 2) {
      for (let k = 0; k < n && i + 1 < geom.length; k++) {
        x += zz(geom[i++]); y += zz(geom[i++]);
        if (id === 1) { cur = [[x, y]]; out.push(cur); } else if (cur) cur.push([x, y]);
      }
    } else if (id === 7 && cur && cur.length) cur.push(cur[0].slice());
  }
  return out;
}
const props = (L, F) => { const o = {}; for (let i = 0; i + 1 < F.tags.length; i += 2) o[L.keys[F.tags[i]]] = L.vals[F.tags[i + 1]]; return o; };
const enc = pts => {
  const out = []; let px = 0, py = 0;
  pts.forEach(([lon, lat], i) => {
    const x = Math.round((lon - 120) * 1e5), y = Math.round((lat - 16) * 1e5);
    if (i === 0) out.push(x, y); else if (x !== px || y !== py) out.push(x - px, y - py); else return;
    px = x; py = y;
  });
  return out;
};

function collect(layers, tx, ty, out, seen) {
  const n = 2 ** Z;
  const ll = (E, px, py) => { const t = Math.PI * (1 - 2 * (ty + py / E) / n); return [(tx + px / E) / n * 360 - 180, Math.atan(Math.sinh(t)) * 180 / Math.PI]; };
  const inTile = (E, px, py) => px >= 0 && px < E && py >= 0 && py < E;
  // keep only the segments whose midpoint is inside this tile, so tile buffers don't double up
  const pieces = (L, F) => {
    const E = L.extent, res = [];
    for (const ln of geomParts(F.geom)) {
      let cur = null;
      for (let i = 1; i < ln.length; i++) {
        const a = ln[i - 1], b = ln[i];
        if (inTile(E, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) { if (!cur) { cur = [ll(E, a[0], a[1])]; res.push(cur); } cur.push(ll(E, b[0], b[1])); }
        else cur = null;
      }
    }
    return res.filter(pc => pc.length > 1);
  };
  const T = layers.transportation;
  if (T) for (const F of T.feats) {
    if (F.type !== 2) continue;
    const cls = ROAD[props(T, F).class]; if (!cls) continue;
    for (const pc of pieces(T, F)) out.roads[cls].push(enc(pc));
  }
  const W = layers.waterway;
  if (W) for (const F of W.feats) {
    if (F.type !== 2) continue;
    const p = props(W, F), name = String(p.name || p.name_en || '');
    if (/tunnel/i.test(name)) continue;
    const dest = p.class === 'river' || p.class === 'canal' ? out.rivers : p.class === 'stream' && name ? out.streams : null;
    if (!dest) continue;
    for (const pc of pieces(W, F)) dest.push({ n: name, c: enc(pc) });
  }
  const points = (L, fn) => {
    if (!L) return;
    for (const F of L.feats) {
      if (F.type !== 1) continue;
      const p = props(L, F);
      for (const part of geomParts(F.geom)) for (const q of part) if (inTile(L.extent, q[0], q[1])) fn(p, ll(L.extent, q[0], q[1]));
    }
  };
  const ix = (lon, lat) => [Math.round((lon - 120) * 1e5), Math.round((lat - 16) * 1e5)];
  points(layers.place, (p, [lon, lat]) => {
    if (!PLACE.has(p.class) || !p.name) return;
    const k = `pl|${p.name}|${lon.toFixed(3)}|${lat.toFixed(3)}`; if (seen.has(k)) return; seen.add(k);
    out.places.push([String(p.name), p.class, ...ix(lon, lat), 0]);
  });
  points(layers.mountain_peak, (p, [lon, lat]) => {
    if (!p.name || (p.class && p.class !== 'peak' && p.class !== 'volcano')) return;
    const k = `pk|${p.name}|${lon.toFixed(3)}|${lat.toFixed(3)}`; if (seen.has(k)) return; seen.add(k);
    const ele = Number.isFinite(+p.ele) && p.ele !== null && p.ele !== '' ? Math.round(+p.ele) : null;
    out.peaks.push([String(p.name), ele, ...ix(lon, lat)]);
  });
}

async function tileBytes(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  let buf = new Uint8Array(await r.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  return buf;
}

export async function loadOSMTiles({ area = AREA, timeout = 45000 } = {}) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const tj = await (await fetch(TILEJSON, { signal: ctrl.signal })).json();
    const tpl = tj.tiles && tj.tiles[0];
    if (!tpl) throw new Error('OpenFreeMap TileJSON has no tile URL');
    const m = tpl.match(/\/(\d{4})(\d{2})(\d{2})_\d+/);
    const asof = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
    const n = 2 ** Z;
    const tx = lon => Math.floor((lon + 180) / 360 * n);
    const ty = lat => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); };
    const list = [];
    for (let y = ty(area[3]); y <= ty(area[1]); y++) for (let x = tx(area[0]); x <= tx(area[2]); x++) list.push([x, y]);
    const out = { roads: { trunk: [], primary: [], secondary: [], tertiary: [] }, rivers: [], streams: [], places: [], peaks: [] };
    const seen = new Set();
    let failed = 0;
    const queue = list.slice();
    const worker = async () => {
      while (queue.length) {
        const [x, y] = queue.shift();
        const url = tpl.replace('{z}', Z).replace('{x}', x).replace('{y}', y);
        let buf = null;
        for (let a = 0; a < 2 && !buf; a++) { try { buf = await tileBytes(url, ctrl.signal); } catch (e) { if (ctrl.signal.aborted) throw e; } }
        if (!buf) { failed++; continue; }
        try { collect(decodeTile(buf), x, y, out, seen); } catch (e) { failed++; }
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    if (failed > list.length / 2) throw new Error(`${failed} of ${list.length} map tiles failed to load`);
    return {
      ok: true, fetched_at: new Date().toISOString(), asof, tiles: list.length, failed,
      sources: [{ id: 'openfreemap', name: 'OpenFreeMap vector tiles (OpenMapTiles schema, zoom 11)', url: 'https://openfreemap.org/', status: failed ? 'partial' : 'ok' }],
      enc: { origin: [120, 16], scale: 1e5, delta: true }, ...out,
    };
  } finally { clearTimeout(timer); }
}
