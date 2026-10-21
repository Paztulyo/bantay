// Live data: the site's own cached API (NOAA CPC, PAGASA, NASA FIRMS, OSM) plus town-level
// weather from Open-Meteo, fetched by the browser. Every source keeps a health record so the
// page can say what is fresh, what is stale and what failed.
import { getJSON, TEST, manila } from './util.js';

export const LIVE = { enso: null, dams: null, fires: null, osm: null, wx: null, health: {} };
export const SOURCES = {
  enso: { name: 'ENSO status and indices', by: 'NOAA CPC · PAGASA', every: 6 * 3600e3, url: '/api/enso' },
  dams: { name: 'Agno dam levels', by: 'PAGASA', every: 30 * 60e3, url: '/api/dams' },
  wx: { name: 'Rain and temperature by town', by: 'Open-Meteo weather models', every: 60 * 60e3 },
  fires: { name: 'Active fire detections', by: 'NASA FIRMS (VIIRS, MODIS)', every: 30 * 60e3, url: '/api/fires' },
  osm: { name: 'Roads, rivers and places', by: 'OpenStreetMap', every: 0, url: '/api/osm' },
  terrain: { name: 'Terrain', by: 'AWS Terrain Tiles (SRTM)', every: 0 },
  cover: { name: 'Land cover', by: 'ESA WorldCover 2021', every: 0 },
};
const listeners = new Set();
export const onLive = fn => listeners.add(fn);
const emit = key => listeners.forEach(fn => fn(key));
export function setHealth(key, rec) { LIVE.health[key] = { ...(LIVE.health[key] || {}), ...rec }; emit('health'); }

function asOf(key, j) {
  if (key === 'enso') return [j.cpc?.issued, j.pagasa?.updated].filter(Boolean).sort().at(-1) || null;
  if (key === 'dams') return j.dams?.map(d => d.iso).filter(Boolean).sort().at(-1) || null;
  if (key === 'fires') return j.fires?.[0] ? `${j.fires[0].date}T${j.fires[0].time}:00Z` : null;
  return null;
}
async function loadAPI(key) {
  setHealth(key, { status: LIVE.health[key]?.status === 'ok' ? 'ok' : 'loading' });
  try {
    const j = await getJSON(SOURCES[key].url, key === 'osm' ? 90000 : 30000);
    LIVE[key] = j;
    const bad = (j.sources || []).filter(s => s.status === 'error');
    const status = j.status === 'no_key' ? 'no_key' : !j.ok ? 'error' : bad.length ? 'partial' : 'ok';
    setHealth(key, { status, fetched: j.fetched_at || new Date().toISOString(), checked: new Date().toISOString(), asof: asOf(key, j), sub: j.sources || [], error: bad.map(s => `${s.name}: ${s.error}`).join('; ') || null });
    emit(key);
  } catch (e) {
    setHealth(key, { status: LIVE[key] ? 'stale' : 'error', checked: new Date().toISOString(), error: String(e.message || e) });
  }
}

/* ---------------- Open-Meteo, per municipality ---------------- */
let POINTS = [];
const ymd = d => d.toISOString().slice(0, 10);
export async function loadWeather() {
  if (!POINTS.length) return;
  setHealth('wx', { status: LIVE.wx ? 'ok' : 'loading' });
  const base = TEST ? '/mock/om' : 'https://api.open-meteo.com/v1/forecast';
  const q = new URLSearchParams({
    latitude: POINTS.map(p => p.lat.toFixed(3)).join(','), longitude: POINTS.map(p => p.lon.toFixed(3)).join(','),
    daily: 'precipitation_sum,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'Asia/Manila', past_days: '31', forecast_days: '16',
  });
  try {
    const j = await getJSON(`${base}?${q}`);
    const arr = Array.isArray(j) ? j : [j];
    const today = ymd(manila());
    const out = {};
    arr.forEach((loc, k) => {
      const p = POINTS[k]; if (!p || !loc.daily) return;
      const t = loc.daily.time, P = loc.daily.precipitation_sum, TX = loc.daily.temperature_2m_max, TN = loc.daily.temperature_2m_min, PP = loc.daily.precipitation_probability_max || [];
      let i0 = t.indexOf(today); if (i0 < 0) i0 = Math.min(31, t.length - 1);
      const past = [], fut = [];
      for (let i = Math.max(0, i0 - 30); i < i0; i++) past.push(P[i]);
      for (let i = i0; i < Math.min(t.length, i0 + 16); i++) fut.push(P[i]);
      const ok = past.filter(v => v != null);
      let streak = 0; for (let i = i0 - 1; i >= 0 && P[i] != null && P[i] < 1; i--) streak++;
      let longest = 0, run = 0; past.forEach(v => { if (v != null && v < 1) { run++; longest = Math.max(longest, run); } else run = 0; });
      const tx7 = TX.slice(Math.max(0, i0 - 7), i0).filter(v => v != null);
      out[p.name] = {
        rain30: ok.reduce((a, b) => a + b, 0), days: ok.length, dry30: ok.filter(v => v < 1).length, streak, longest,
        fc16: fut.filter(v => v != null).reduce((a, b) => a + b, 0), fcDry: fut.filter(v => v != null && v < 1).length,
        tmaxToday: TX[i0], tminToday: TN[i0], tmax7: tx7.length ? tx7.reduce((a, b) => a + b, 0) / tx7.length : null,
        elev: loc.elevation,
        series: { t: t.slice(Math.max(0, i0 - 30), i0 + 16), p: P.slice(Math.max(0, i0 - 30), i0 + 16), tx: TX.slice(Math.max(0, i0 - 30), i0 + 16), pp: PP.slice(Math.max(0, i0 - 30), i0 + 16), today: Math.min(30, i0) },
      };
    });
    const vals = Object.values(out);
    const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
    LIVE.wx = { by: out, today, fetched: new Date().toISOString(), prov: { rain30: med(vals.map(v => v.rain30)), dry30: med(vals.map(v => v.dry30)), streak: Math.max(...vals.map(v => v.streak)), fc16: med(vals.map(v => v.fc16)), fcDry: med(vals.map(v => v.fcDry)) } };
    setHealth('wx', { status: 'ok', fetched: LIVE.wx.fetched, checked: LIVE.wx.fetched, asof: today + 'T00:00:00+08:00', error: null, sub: [{ id: 'openmeteo', name: 'Open-Meteo forecast API (past 31 days + 16-day forecast)', url: 'https://open-meteo.com/', status: 'ok' }] });
    emit('wx');
  } catch (e) {
    setHealth('wx', { status: LIVE.wx ? 'stale' : 'error', checked: new Date().toISOString(), error: String(e.message || e) });
  }
}

export function startLive(points) {
  POINTS = points;
  for (const k of ['enso', 'dams', 'fires']) loadAPI(k);
  loadAPI('osm');
  loadWeather();
  const due = k => { const h = LIVE.health[k]; return !h?.checked || Date.now() - new Date(h.checked).getTime() > SOURCES[k].every; };
  const tick = () => {
    if (document.hidden) return;
    for (const k of ['enso', 'dams', 'fires']) if (due(k)) loadAPI(k);
    if (due('wx')) loadWeather();
  };
  setInterval(tick, 60e3);
  document.addEventListener('visibilitychange', tick);
}
