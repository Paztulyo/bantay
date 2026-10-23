// Live temperature and forecast for each town from Open-Meteo, on a glass card over the map,
// plus the see-through 3D weather on the map itself (js/weather3d.js). The card follows the
// town selected on the map and falls back to Baguio City. Picking a day in the 7-day forecast
// paints every town's forecast for that day on the map, or plays the week day by day, until Live.
import { $, esc, getJSON, TEST, MN, showTip, hideTip } from './util.js';
import { SOURCES, setHealth } from './live.js';
import { createWeather3D } from './weather3d.js';

SOURCES.now = { name: 'Live temperature and forecast', by: 'Open-Meteo weather models (current, hourly, 7-day)', every: 15 * 60e3 };

const DEFAULT_TOWN = 'Baguio City', EVERY = 15 * 60e3, HOT = 32; // HOT: feels-like °C
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem('bantay.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('bantay.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};
let TOWNS = [], NOW = null, town = DEFAULT_TOWN, mode = 'outlook', view = store.get('wxView', 'hours');
let fx = null, effectsOn = store.get('wx3d', !REDUCED), collapsed = store.get('wxCollapsed', null), status = 'loading', errMsg = '', checkedAt = 0, inflight = false;
let fday = null, playing = false, played = false, playT = 0; // fday: the forecast date the map shows ('YYYY-MM-DD'), or null for live
const PHONE = matchMedia('(max-width: 640px)'), STEP = 2600; // STEP: ms per day when the week plays

/* ---------------- WMO weather codes ---------------- */
export function sky(code, day = 1) {
  const c = +code;
  if (c === 0) return { k: 'clear', n: day ? 'Clear' : 'Clear night' };
  if (c === 1) return { k: 'clear', n: 'Mostly clear' };
  if (c === 2) return { k: 'partly', n: 'Partly cloudy' };
  if (c === 3) return { k: 'cloudy', n: 'Overcast' };
  if (c === 45 || c === 48) return { k: 'fog', n: 'Fog' };
  if (c >= 51 && c <= 57) return { k: 'drizzle', n: c <= 51 ? 'Light drizzle' : c === 53 ? 'Drizzle' : 'Heavy drizzle', i: c <= 51 ? 0.15 : c === 53 ? 0.25 : 0.35 };
  if (c >= 61 && c <= 67) return { k: 'rain', n: c === 61 || c === 66 ? 'Light rain' : c === 63 ? 'Rain' : 'Heavy rain', i: c === 61 || c === 66 ? 0.4 : c === 63 ? 0.6 : 0.85 };
  if (c >= 80 && c <= 82) return { k: 'rain', n: c === 80 ? 'Light showers' : c === 81 ? 'Showers' : 'Heavy showers', i: c === 80 ? 0.45 : c === 81 ? 0.65 : 0.9 };
  if (c >= 95) return { k: 'storm', n: c === 95 ? 'Thunderstorm' : 'Thunderstorm with hail', i: c === 95 ? 0.85 : 1 };
  return { k: 'cloudy', n: 'Cloudy' };
}

/* ---------------- condition glyphs (animated with CSS; still under reduced motion) ---------------- */
const CLOUD = 'M15.5 36h19a7.5 7.5 0 0 0 .9-14.95A10.5 10.5 0 0 0 15.3 19.2 8.4 8.4 0 0 0 15.5 36z';
function glyph(k, day, small) {
  const sun = `<g class="g-sun"><g class="g-rays">${[0, 45, 90, 135, 180, 225, 270, 315].map(a => `<path d="M24 6.5v4" transform="rotate(${a} 24 24)"/>`).join('')}</g><circle cx="24" cy="24" r="7.5"/></g>`;
  const moon = '<path class="g-moon" d="M29.5 9.5a14 14 0 1 0 9 22.5 11 11 0 0 1-9-22.5z"/>';
  const cloud = (cls = '') => `<path class="g-cloud ${cls}" d="${CLOUD}"/>`;
  const drops = n => Array.from({ length: n }, (_, i) => `<path class="g-drop d${i}" d="M${18 + i * 6} 39.5l-1.6 4.5"/>`).join('');
  let body;
  if (k === 'clear') body = day ? sun : moon;
  else if (k === 'partly') body = `<g transform="translate(-6 -6) scale(.78)">${day ? sun : moon}</g>${cloud()}`;
  else if (k === 'cloudy') body = cloud('drift');
  else if (k === 'fog') body = `${cloud('faint')}<path class="g-fog f0" d="M9 40h24"/><path class="g-fog f1" d="M15 44h26"/>`;
  else if (k === 'drizzle') body = `${cloud()}${drops(2)}`;
  else if (k === 'rain') body = `${cloud()}${drops(3)}`;
  else body = `${cloud('dark')}<path class="g-bolt" d="M25 31l-4.5 7.5h4l-2.5 6.5 7.5-9h-4.2l2.7-5z"/>${drops(2)}`;
  return `<svg class="wg wg-${k}${small ? ' static' : ''}" viewBox="0 0 48 48" aria-hidden="true">${body}</svg>`;
}

/* ---------------- data ---------------- */
const hhmm = s => { const h = +s.slice(11, 13), m = s.slice(14, 16); return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`; };
const hourLbl = s => { const h = +s.slice(11, 13); return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`; };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLbl = (s, i) => (i === 0 ? 'Today' : DAYS[new Date(s + 'T00:00:00Z').getUTCDay()]);
const r0 = v => (v == null || isNaN(v) ? '–' : Math.round(v));

async function load() {
  if (!TOWNS.length || inflight) return;
  inflight = true;
  setHealth('now', { status: NOW ? 'ok' : 'loading' });
  const q = new URLSearchParams({
    latitude: TOWNS.map(t => t.lat.toFixed(3)).join(','), longitude: TOWNS.map(t => t.lon.toFixed(3)).join(','),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_probability_max',
    timezone: 'Asia/Manila', forecast_days: '7', forecast_hours: '25',
  });
  try {
    const j = await getJSON((TEST ? '/mock/om_now' : 'https://api.open-meteo.com/v1/forecast') + '?' + q, 30000);
    const arr = Array.isArray(j) ? j : [j], by = {};
    arr.forEach((loc, i) => { const t = TOWNS[i]; if (t && loc.current) by[t.n] = { cur: loc.current, hourly: loc.hourly, daily: loc.daily }; });
    if (!Object.keys(by).length) throw new Error('no town data in the answer');
    NOW = by; status = 'ok'; errMsg = ''; checkedAt = Date.now();
    const asof = arr[0].current.time + ':00+08:00';
    setHealth('now', { status: 'ok', fetched: new Date().toISOString(), checked: new Date().toISOString(), asof, error: null, sub: [{ id: 'openmeteo_now', name: 'Open-Meteo forecast API (current, hourly, daily)', url: 'https://open-meteo.com/', status: 'ok' }] });
    if (fday && !dayTimes().includes(fday)) { stopPlay(); fday = null; } // the picked day has passed: back to live
    render(); push3d(); syncPill();
  } catch (e) {
    status = NOW ? 'stale' : 'error'; errMsg = String(e.message || e); checkedAt = Date.now();
    setHealth('now', { status, checked: new Date().toISOString(), error: errMsg });
    render();
  } finally { inflight = false; }
}
// what each town's patch on the map shows: its current conditions, or its forecast for the picked day
// (that day's worst weather, its rain thinned by the chance of rain, and heat by the day's highest feels-like)
function byTown3d() {
  const out = {};
  for (const [n, d] of Object.entries(NOW || {})) {
    if (fday) {
      const D = d.daily, i = D?.time ? D.time.indexOf(fday) : -1;
      if (i < 0) continue;
      const s = sky(D.weather_code[i], 1), pp = D.precipitation_probability_max?.[i], feels = D.apparent_temperature_max?.[i] ?? D.temperature_2m_max?.[i];
      out[n] = { k: s.k, i: s.i || 0, chance: pp == null ? 1 : pp / 100, hot: feels >= HOT, day: 1 };
    } else {
      const c = d.cur, s = sky(c.weather_code, c.is_day);
      out[n] = { k: s.k, i: s.i || 0, cloud: c.cloud_cover, hot: c.apparent_temperature >= HOT, day: c.is_day };
    }
  }
  return out;
}
function push3d(fade = false) { if (fx && NOW) fx.update(byTown3d(), { fade }); }
function fxState() { if (fx) fx.setEnabled(effectsOn && mode !== 'pacific'); }

/* ---------------- card ---------------- */
function hoursSVG(d) {
  const H = d.hourly; if (!H?.time?.length) return '<p class="wxc-empty">No hourly forecast in this answer.</p>';
  const T = H.temperature_2m, P = H.precipitation_probability || [], n = T.length, W = 226, Ht = 62, top = 13, bot = 15;
  const lo = Math.min(...T.filter(v => v != null)), hi = Math.max(...T.filter(v => v != null)), span = Math.max(2, hi - lo);
  const x = i => 4 + i * (W - 8) / (n - 1), y = v => top + (1 - (v - lo + span * 0.15) / (span * 1.3)) * (Ht - top - bot);
  const pts = T.map((v, i) => [x(i), y(v)]);
  let path = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < n; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2; path += `C${cx.toFixed(1)},${y0.toFixed(1)} ${cx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`; }
  const iMax = T.indexOf(hi), iMin = T.indexOf(lo), bw = (W - 8) / (n - 1);
  const bars = P.map((p, i) => p ? `<rect x="${(x(i) - bw * 0.32).toFixed(1)}" y="${(Ht - bot - p / 100 * 12).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${(p / 100 * 12).toFixed(1)}" rx="1" class="pp"/>` : '').join('');
  const ticks = [0, 6, 12, 18, 24].filter(i => i < n).map(i => `<text x="${x(i).toFixed(1)}" y="${Ht - 3}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${i === 0 ? 'Now' : hourLbl(H.time[i])}</text>`).join('');
  // both labels sit above their points so the low never collides with the hour labels
  const lab = i => `<text class="tv" x="${clamp(x(i), 12, W - 12).toFixed(1)}" y="${(y(T[i]) - 6).toFixed(1)}" text-anchor="middle">${r0(T[i])}°</text>`;
  const hits = T.map((v, i) => `<rect class="hit" data-i="${i}" x="${(x(i) - bw / 2).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${Ht}"/>`).join('');
  return `<svg class="wxc-spark" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="Temperature for the next 24 hours, from ${r0(lo)} to ${r0(hi)} degrees">
    <defs><linearGradient id="wxcFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="f0"/><stop offset="1" class="f1"/></linearGradient></defs>
    ${bars}<path class="area" d="${path}L${x(n - 1).toFixed(1)},${Ht - bot}L${x(0).toFixed(1)},${Ht - bot}Z"/><path class="line" d="${path}"/>
    <circle class="nowdot" cx="${pts[0][0].toFixed(1)}" cy="${pts[0][1].toFixed(1)}" r="3"/>
    ${lab(iMax)}${Math.abs(iMin - iMax) > 3 ? lab(iMin) : ''}${ticks}${hits}</svg>
    <div class="wxc-key"><span><i class="kl"></i>Temperature</span><span><i class="kb"></i>Chance of rain</span></div>`;
}
const ICO = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5.5" width="4" height="13" rx="1"/><rect x="13.5" y="5.5" width="4" height="13" rx="1"/></svg>',
  replay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.8h3.8"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
};
function daysHTML(d) {
  const D = d.daily; if (!D?.time?.length) return '<p class="wxc-empty">No daily forecast in this answer.</p>';
  const days = D.time.map((t, i) => {
    const s = sky(D.weather_code[i], 1), pp = D.precipitation_probability_max?.[i];
    const say = `${dayName(t, i)}: ${s.n}, high ${r0(D.temperature_2m_max[i])}°, low ${r0(D.temperature_2m_min[i])}°${pp != null ? `, ${pp}% chance of rain` : ''}`;
    return `<button type="button" class="wxc-day${i === 0 ? ' today' : ''}" data-date="${t}" aria-pressed="${t === fday}" aria-label="${esc(say)}" title="${esc(s.n)}"><span class="dn">${dayLbl(t, i)}</span>${glyph(s.k, 1, true)}<b class="mono">${r0(D.temperature_2m_max[i])}°</b><span class="mono lo">${r0(D.temperature_2m_min[i])}°</span><span class="mono pp">${pp != null ? pp + '%' : ''}</span></button>`;
  }).join('');
  const play = playing ? `${ICO.pause}Pause` : played ? `${ICO.replay}Play again` : `${ICO.play}Play the week`;
  return `<div class="wxc-days" role="group" aria-label="7-day forecast. Pick a day to show it on the map.">${days}</div>
    <div class="wxc-dayctl"><button type="button" class="wxc-play" id="wxcPlay">${play}</button>${fday ? '<button type="button" class="wxc-live" id="wxcLive">Back to live</button>' : '<span class="wxc-hint">Tap a day to map it</span>'}</div>`;
}

/* ---------------- a forecast day on the map ---------------- */
// The pick is kept as a date, so a refresh (or midnight) keeps the same day, or goes back to live once it has passed.
const dayFull = s => { const d = new Date(s + 'T00:00:00Z'); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MN[d.getUTCMonth()]}`; };
const dayName = (s, i) => (i === 0 ? 'Today' : dayFull(s));
const dayTimes = () => (NOW?.[town] || NOW?.[DEFAULT_TOWN])?.daily?.time || [];
function setDay(date, { fromPlay = false } = {}) {
  if (!fromPlay) { stopPlay(); played = false; }
  const was = fday;
  fday = date && dayTimes().includes(date) ? date : null;
  if (fday && !effectsOn) { effectsOn = true; store.set('wx3d', true); fxState(); } // picking a day means: show me the map
  render(); syncPill();
  if (fday !== was) push3d(true);
}
function stopPlay() { playing = false; clearTimeout(playT); }
// Play the week: one day every STEP ms, from the picked day (or today) to the last, then stop there
function startPlay() {
  const T = dayTimes(); if (!T.length) return;
  let i = fday ? T.indexOf(fday) : -1;
  if (i >= T.length - 1) i = -1; // finished last time: start over from today
  playing = true;
  // on a phone the card covers the map, so tuck it away to watch
  if (PHONE.matches && $('#ovPanel')?.classList.contains('open')) $('#ovTab')?.click();
  played = false;
  const step = () => {
    i++;
    if (i >= T.length - 1) { playing = false; played = true; } // the last day: stop there and offer to play again
    setDay(T[i], { fromPlay: true });
    if (playing) playT = setTimeout(step, STEP);
  };
  step();
}

// the pill on the map: which day it shows, step a day either way, or go back to live
let pill = null;
function syncPill() {
  const vp = $('#vp'); if (!vp) return;
  if (!pill) {
    pill = document.createElement('div'); pill.className = 'wxpill'; pill.id = 'wxPill'; pill.hidden = true;
    pill.innerHTML = `<button type="button" class="wp-step" data-d="-1" aria-label="Previous day">${ICO.prev}</button><span class="wp-t" aria-live="polite"></span><button type="button" class="wp-step" data-d="1" aria-label="Next day">${ICO.next}</button><button type="button" class="wp-step wp-pp" aria-label="Pause the week">${ICO.pause}</button><button type="button" class="wp-live">Live</button><i class="wp-prog" aria-hidden="true"></i>`;
    vp.appendChild(pill);
    pill.querySelector('.wp-pp').addEventListener('click', () => { stopPlay(); render(); syncPill(); }); // while the week plays
    pill.querySelectorAll('.wp-step[data-d]').forEach(b => b.addEventListener('click', () => {
      const T = dayTimes(), j = T.indexOf(fday) + +b.dataset.d;
      if (j >= 0 && j < T.length) setDay(T[j]);
    }));
    pill.querySelector('.wp-live').addEventListener('click', () => setDay(null));
  }
  const on = !!fday && mode !== 'pacific';
  pill.hidden = !on;
  if (!on) return;
  const T = dayTimes(), i = T.indexOf(fday);
  pill.querySelector('.wp-t').innerHTML = `<b>${dayName(fday, i)}</b>${i === 0 ? '’s forecast' : ' forecast'}`;
  pill.querySelector('[data-d="-1"]').disabled = i <= 0;
  pill.querySelector('[data-d="1"]').disabled = i >= T.length - 1;
  pill.classList.toggle('playing', playing);
  const bar = pill.querySelector('.wp-prog'); bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; // restart the day's progress bar
}
// phones open the card on demand from a pull tab (js/ovpanel.js), so only a short map starts it folded
function autoCollapsed() { const vp = $('#vp'); return vp ? vp.getBoundingClientRect().height < 470 : false; }
function render() {
  const el = $('#wxcard'); if (!el) return;
  el.hidden = mode === 'pacific';
  if (el.hidden) return;
  const col = collapsed ?? autoCollapsed();
  const d = NOW?.[town] || NOW?.[DEFAULT_TOWN];
  if (!d) {
    el.dataset.k = 'loading';
    el.innerHTML = `<div class="wxc-top"><div class="wxc-ico">${glyph('cloudy', 1, true)}</div><div class="wxc-now"><div class="wxc-meta">${status === 'error' ? 'Live weather is unavailable right now. Trying again in 15 minutes.' : 'Loading live weather…'}</div></div></div>`;
    return;
  }
  const c = d.cur, shown = NOW[town] ? town : DEFAULT_TOWN;
  const D = d.daily, fi = fday && D?.time ? D.time.indexOf(fday) : -1;
  // the top of the card shows what the map shows: now, or the picked day's forecast for this town
  let top, place;
  if (fi >= 0) {
    const s = sky(D.weather_code[fi], 1), pp = D.precipitation_probability_max?.[fi], feels = D.apparent_temperature_max?.[fi], hot = feels != null && feels >= HOT;
    el.dataset.k = hot ? 'hot' : s.k; el.dataset.day = '1';
    top = `<div class="wxc-ico">${glyph(s.k, 1)}</div>
      <div class="wxc-now">
        <div class="wxc-temp"><b>${r0(D.temperature_2m_max[fi])}°</b><span>${esc(s.n)}</span></div>
        <div class="wxc-meta">Low ${r0(D.temperature_2m_min[fi])}°${pp != null ? ` · ${pp}% chance of rain` : ''}${hot ? ` · feels ${r0(feels)}°, <em>hot</em>` : ''}</div>
      </div>`;
    place = `<span class="fc">${dayName(fday, fi)} · forecast</span>`;
  } else {
    const s = sky(c.weather_code, c.is_day), hot = c.apparent_temperature >= HOT;
    const old = Date.now() - new Date(c.time + ':00+08:00').getTime() > 75 * 60e3;
    el.dataset.k = hot ? 'hot' : s.k; el.dataset.day = c.is_day ? '1' : '0';
    top = `<div class="wxc-ico">${glyph(s.k, c.is_day)}</div>
      <div class="wxc-now">
        <div class="wxc-temp"><b>${r0(c.temperature_2m)}°</b><span>${esc(s.n)}</span></div>
        <div class="wxc-meta">Feels ${r0(c.apparent_temperature)}° · ${r0(c.relative_humidity_2m)}% humidity${hot ? ' · <em>hot</em>' : ''}</div>
      </div>`;
    place = `<span class="${old ? 'old' : ''}">${old ? 'As of' : 'Live ·'} ${hhmm(c.time)}</span>`;
  }
  el.classList.toggle('collapsed', col);
  // redrawing replaces the buttons, so note which one had focus and give it back afterwards
  const act = el.contains(document.activeElement) ? document.activeElement : null;
  const refocus = act && (act.dataset.date ? `.wxc-day[data-date="${act.dataset.date}"]` : act.dataset.v ? `.wxc-tabs [data-v="${act.dataset.v}"]` : act.id ? '#' + act.id : null);
  el.innerHTML = `
    <div class="wxc-top">
      ${top}
      <button class="wxc-tog" id="wxcTog" aria-expanded="${!col}" aria-controls="wxcBody" title="${col ? 'Show the forecast' : 'Hide the forecast'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>
    </div>
    <div class="wxc-place"><b>${esc(shown)}</b>${place}</div>
    <div class="wxc-body" id="wxcBody"${col ? ' hidden' : ''}>
      <div class="wxc-tabs" role="tablist" aria-label="Forecast">
        <button role="tab" data-v="hours" aria-selected="${view === 'hours'}">Next 24 h</button>
        <button role="tab" data-v="days" aria-selected="${view === 'days'}">7 days</button>
      </div>
      <div class="wxc-plot">${view === 'days' ? daysHTML(d) : hoursSVG(d)}</div>
      <label class="wxc-sw"><input type="checkbox" id="wx3d"${effectsOn ? ' checked' : ''}><span class="knob" aria-hidden="true"></span>Show weather on the map</label>
      <p class="wxc-src">Open-Meteo model, not a weather station.${status === 'stale' ? ' The last update failed; showing the one before.' : ''} Tap a town on the map to switch.</p>
    </div>`;
  $('#wxcTog').addEventListener('click', () => { collapsed = !col; store.set('wxCollapsed', collapsed); render(); });
  // the hourly view is about now, so it brings the map back to live
  el.querySelectorAll('.wxc-tabs button').forEach(b => b.addEventListener('click', () => { view = b.dataset.v; store.set('wxView', view); if (view === 'hours' && fday) setDay(null); else render(); }));
  const sw = $('#wx3d'); if (sw) sw.addEventListener('change', () => { effectsOn = sw.checked; store.set('wx3d', effectsOn); fxState(); if (!effectsOn && fday) setDay(null); });
  // forecast days: tap to show one on the map, tap it again for live; arrow keys step through the week
  const days = [...el.querySelectorAll('.wxc-day')];
  days.forEach((b, i) => {
    b.addEventListener('click', () => setDay(b.dataset.date === fday ? null : b.dataset.date));
    b.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const j = clamp(i + (e.key === 'ArrowRight' ? 1 : -1), 0, days.length - 1);
      setDay(days[j].dataset.date); el.querySelector(`.wxc-day[data-date="${days[j].dataset.date}"]`)?.focus();
    });
  });
  $('#wxcPlay')?.addEventListener('click', () => { if (playing) { stopPlay(); render(); syncPill(); } else startPlay(); });
  $('#wxcLive')?.addEventListener('click', () => setDay(null));
  if (refocus) el.querySelector(refocus)?.focus({ preventScroll: true });
  el.querySelectorAll('.wxc-spark .hit').forEach(h => {
    const i = +h.dataset.i, H = d.hourly;
    const tip = () => `<b>${i === 0 ? 'Now' : hourLbl(H.time[i])}</b> · <span class="mono">${H.temperature_2m[i]?.toFixed(1)}°C</span><br>${esc(sky(H.weather_code?.[i], 1).n)}${H.precipitation_probability?.[i] != null ? ` · rain chance <span class="mono">${H.precipitation_probability[i]}%</span>` : ''}`;
    h.addEventListener('pointermove', ev => showTip(tip(), ev.clientX, ev.clientY)); h.addEventListener('pointerleave', hideTip);
  });
}

/* ---------------- wiring ---------------- */
function attachMap(G) {
  if (fx || !G || !G.ready || !G.scene || !TOWNS.length) return; // start() retries once the town list is in
  try { fx = createWeather3D(G, TOWNS); fxState(); push3d(); }
  catch (e) { console.warn('3D weather could not start:', e && e.message); }
}
document.addEventListener('bantay:select', e => { town = e.detail?.town || DEFAULT_TOWN; render(); });
document.addEventListener('bantay:mode', e => { mode = e.detail?.mode || 'outlook'; if (mode === 'pacific') stopPlay(); render(); fxState(); syncPill(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && playing) { stopPlay(); render(); syncPill(); } }); // a hidden tab pauses the week
document.addEventListener('bantay:map', e => attachMap(e.detail?.map));
let rz = 0; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (collapsed == null) render(); }, 200); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - checkedAt > EVERY) load(); });
const failed = () => status === 'error' || status === 'stale';
addEventListener('online', () => { if (failed()) { load(); setTimeout(() => { if (failed()) load(); }, 3000); } }); // back online: try again now
setInterval(() => { if (!document.hidden && Date.now() - checkedAt > EVERY) load(); }, 60e3);

if (TEST) window.__wx = { get fx() { return fx; }, get now() { return NOW; }, get day() { return fday; }, get playing() { return playing; }, load, setDay };

(async function start() {
  render();
  try {
    const B = await getJSON('/data/boundaries.json');
    TOWNS = Object.entries(B.munis).map(([n, m]) => ({ n, lon: m.label[0], lat: m.label[1], area: m.area }));
  } catch (e) { status = 'error'; errMsg = 'Town list did not load'; render(); return; }
  if (window.bantayMap) attachMap(window.bantayMap);
  load();
})();
