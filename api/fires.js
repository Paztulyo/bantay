// Active fire detections from NASA FIRMS (VIIRS + MODIS, near real time).
// Needs a free MAP_KEY in the FIRMS_MAP_KEY environment variable.
import { fetchText, send, attempt, nowISO } from './_lib.js';

const AREA = '120.35,16.05,121.05,17.02'; // west,south,east,north (Benguet + Baguio, padded)
const SOURCES = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'MODIS_NRT'];

function parseCSV(txt, src) {
  const lines = txt.trim().split(/\r?\n/);
  if (lines.length < 1 || !/latitude/i.test(lines[0])) {
    if (/invalid|error|key/i.test(txt.slice(0, 200))) throw new Error(txt.slice(0, 160));
    return [];
  }
  const h = lines[0].split(',').map(s => s.trim().toLowerCase());
  const ix = k => h.indexOf(k);
  const out = [];
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const lat = +c[ix('latitude')], lon = +c[ix('longitude')];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const t = String(c[ix('acq_time')] || '').padStart(4, '0');
    out.push({
      lat, lon,
      date: c[ix('acq_date')],
      time: `${t.slice(0, 2)}:${t.slice(2)}`,
      src,
      conf: c[ix('confidence')],
      frp: +c[ix('frp')] || null,
      dn: c[ix('daynight')] || null,
    });
  }
  return out;
}

export default async function handler(req, res) {
  const key = process.env.FIRMS_MAP_KEY;
  const days = Math.max(1, Math.min(10, parseInt(req.query?.days, 10) || 7));
  if (!key) {
    return send(res, {
      ok: true, status: 'no_key', fetched_at: nowISO(), days, fires: [],
      sources: [{ id: 'firms', name: 'NASA FIRMS active fires', url: 'https://firms.modaps.eosdis.nasa.gov/api/map_key/', status: 'no_key' }],
    }, { cache: 600, swr: 3600 });
  }
  const results = await Promise.all(SOURCES.map(s => attempt(
    { id: 'firms_' + s.toLowerCase(), name: `NASA FIRMS ${s.replace(/_/g, ' ')}`, url: 'https://firms.modaps.eosdis.nasa.gov/' },
    async () => parseCSV(await fetchText(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${s}/${AREA}/${days}`, { timeout: 20000 }), s),
  )));
  const fires = results.flatMap(r => r.value || []).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const ok = results.some(r => r.value);
  // never echo the key back
  const sources = results.map(r => ({ ...r.source, error: r.source.error ? r.source.error.replaceAll(key, '***') : undefined }));
  send(res, { ok, status: ok ? 'ok' : 'error', fetched_at: nowISO(), days, fires, sources }, ok ? { cache: 1800, swr: 7200 } : { status: 503 });
}
