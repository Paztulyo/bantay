// Weather for every province in one cached answer: one point per province (on its main island),
// current conditions and the next 7 days from Open-Meteo. Cached at the edge for an hour, so
// Open-Meteo is asked at most about 24 times a day however many people open the page.
import { fetchJSON, send, attempt, nowISO } from './_lib.js';
import fs from 'node:fs';
import path from 'node:path';

let POINTS = null;
function points() {
  if (POINTS) return POINTS;
  const geo = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'ph_provinces.json'), 'utf8'));
  POINTS = geo.features.map(f => ({ name: f.properties.name, lat: f.properties.lat, lon: f.properties.lon }));
  return POINTS;
}

export default async function handler(req, res) {
  const P = points();
  const q = new URLSearchParams({
    latitude: P.map(p => p.lat).join(','), longitude: P.map(p => p.lon).join(','),
    current: 'temperature_2m,apparent_temperature,precipitation,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_sum,precipitation_probability_max',
    timezone: 'Asia/Manila', forecast_days: '7',
  });
  const { value, source } = await attempt(
    { id: 'openmeteo', name: 'Open-Meteo forecast API (current and 7-day, one point per province)', url: 'https://open-meteo.com/' },
    async () => {
      const j = await fetchJSON('https://api.open-meteo.com/v1/forecast?' + q, { timeout: 25000 });
      const arr = Array.isArray(j) ? j : [j];
      if (arr.length !== P.length) throw new Error(`asked for ${P.length} places, got ${arr.length}`);
      const by = {};
      arr.forEach((loc, i) => {
        const c = loc.current || {}, d = loc.daily || {};
        by[P[i].name] = {
          now: { t: c.temperature_2m, feels: c.apparent_temperature, rain: c.precipitation, code: c.weather_code, day: c.is_day, time: c.time },
          days: (d.time || []).map((t, k) => ({ d: t, code: d.weather_code?.[k], hi: d.temperature_2m_max?.[k], lo: d.temperature_2m_min?.[k], feels: d.apparent_temperature_max?.[k], mm: d.precipitation_sum?.[k], pp: d.precipitation_probability_max?.[k] })),
        };
      });
      return { by, asof: arr[0]?.current?.time };
    },
  );
  if (!value) return send(res, { ok: false, fetched_at: nowISO(), sources: [source] }, { status: 503 });
  send(res, { ok: true, fetched_at: nowISO(), asof: value.asof, places: value.by, sources: [source] }, { cache: 3600, swr: 3 * 3600 });
}
