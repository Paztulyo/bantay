// Active fire detections over the whole Philippines (NASA FIRMS, VIIRS, near real time).
// Compact rows to keep the answer small: [lat, lon, 'YYYY-MM-DD', 'HH:MM', frp, confidence].
import { send, attempt, nowISO } from './_lib.js';
import { firms, parseCSV } from './fires.js';

const AREA = '116.8,4.4,126.8,21.3'; // west,south,east,north
const SOURCES = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'];

export default async function handler(req, res) {
  const key = process.env.FIRMS_MAP_KEY;
  const days = Math.max(1, Math.min(5, parseInt(req.query?.days, 10) || 3));
  if (!key) {
    return send(res, { ok: true, status: 'no_key', fetched_at: nowISO(), days, rows: [],
      sources: [{ id: 'firms', name: 'NASA FIRMS active fires', url: 'https://firms.modaps.eosdis.nasa.gov/', status: 'no_key' }] }, { cache: 600, swr: 3600 });
  }
  const results = await Promise.all(SOURCES.map(s => attempt(
    { id: 'firms_' + s.toLowerCase(), name: `NASA FIRMS ${s.replace(/_/g, ' ')}`, url: 'https://firms.modaps.eosdis.nasa.gov/' },
    async () => parseCSV(await firms(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key.trim())}/${s}/${AREA}/${days}`), s),
  )));
  const rows = results.flatMap(r => r.value || [])
    .filter(f => f.conf !== 'l' && f.conf !== 'low') // VIIRS low-confidence points are mostly noise
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
    .map(f => [+f.lat.toFixed(3), +f.lon.toFixed(3), f.date, f.time, f.frp == null ? null : Math.round(f.frp * 10) / 10, f.conf]);
  const ok = results.some(r => r.value);
  const sources = results.map(r => ({ ...r.source, error: r.source.error ? r.source.error.replaceAll(key, '***') : undefined }));
  send(res, { ok, status: ok ? 'ok' : 'error', fetched_at: nowISO(), days, rows, sources }, ok ? { cache: 1800, swr: 7200 } : { status: 503 });
}
