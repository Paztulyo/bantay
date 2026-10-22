// The national page: PAGASA's dry stage for every province, month by month, with the week's weather and
// satellite fire detections. Stages come from data/ph_stages.json (published by hand after a check, see
// /ph/review); weather and fires come from the cached APIs, so the page itself never calls an outside site.
import { getJSON, esc, TEST, MN } from './util.js';
import { t, tf, ld } from './i18n.js';

const $ = s => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const PHONE = matchMedia('(max-width: 760px)');
const K = Math.cos(12 * Math.PI / 180); // longitude squeeze at the Philippines' middle latitude

const STAGE = {
  cond: { n: 'Dry condition', v: '--stage1', d: 'Two months in a row of below-normal rain (21–60% below average).' },
  spell: { n: 'Dry spell', v: '--stage2', d: 'Three months in a row of below-normal rain, or two months in a row way below normal (more than 60% below).' },
  drought: { n: 'Drought', v: '--stage3', d: 'Three months in a row way below normal, or five months in a row below normal.' },
};
const ORDER = ['drought', 'spell', 'cond'];
const RAIN_BINS = [[0, 5], [5, 20], [20, 50], [50, 100], [100, Infinity]];
const HEAT_BINS = [[-Infinity, 30], [30, 35], [35, 39], [39, 42], [42, Infinity]];

const S = { geo: null, stages: null, wx: null, fires: null, month: null, layer: 'stage', fires_on: true, sel: null, view: null, home: null };
const feat = {}; // name -> {f, path el, bbox, fires}

/* ---------------- helpers ---------------- */
const monLabel = ym => { const [y, m] = ym.split('-').map(Number); return `${MN[m - 1]} ${y}`; };
const byEnd = ym => ld(tf('by end of {m}', { m: monLabel(ym) }));
const r0 = v => (v == null || isNaN(v) ? '–' : Math.round(v));
const dayName = (iso, i) => (i === 0 ? t('Today') : t(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(iso + 'T00:00:00Z').getUTCDay()]));
function sky(c) {
  c = +c;
  if (c === 0 || c === 1) return 'Clear';
  if (c === 2) return 'Partly cloudy';
  if (c === 3) return 'Overcast';
  if (c === 45 || c === 48) return 'Fog';
  if (c >= 51 && c <= 57) return 'Drizzle';
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return c === 65 || c === 82 ? 'Heavy rain' : 'Rain';
  if (c >= 95) return 'Thunderstorm';
  return 'Cloudy';
}
const proj = ([lon, lat]) => [lon * K * 100, -lat * 100];
function ringsOf(g) { return g.type === 'Polygon' ? [g.coordinates] : g.coordinates; }
function pathOf(g) {
  let d = '';
  for (const poly of ringsOf(g)) for (const ring of poly) {
    ring.forEach((p, i) => { const [x, y] = proj(p); d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); });
    d += 'Z';
  }
  return d;
}
function bboxOf(g) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const poly of ringsOf(g)) for (const [lon, lat] of poly[0]) { a = Math.min(a, lon); b = Math.min(b, lat); c = Math.max(c, lon); d = Math.max(d, lat); }
  return [a, b, c, d];
}
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inGeom(lon, lat, g) {
  return ringsOf(g).some(poly => inRing(lon, lat, poly[0]) && !poly.slice(1).some(h => inRing(lon, lat, h)));
}
function provinceAt(lon, lat) {
  for (const n in feat) { const b = feat[n].bbox; if (lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && inGeom(lon, lat, feat[n].f.geometry)) return n; }
  return null;
}
const stageOf = (name, m = S.month) => (S.stages?.stages?.[m] || {})[name] || null;
const wxOf = name => S.wx?.places?.[name] || null;
const rain7 = name => { const w = wxOf(name); return w ? w.days.reduce((s, d) => s + (d.mm || 0), 0) : null; };
const heat7 = name => { const w = wxOf(name); return w ? Math.max(...w.days.map(d => d.feels ?? d.hi ?? -99)) : null; };
const binOf = (v, bins) => (v == null ? -1 : bins.findIndex(([a, b]) => v >= a && v < b));

/* ---------------- map ---------------- */
const svg = $('#map');
let gProv, gFire, gSel;
function drawMap() {
  svg.textContent = '';
  gProv = document.createElementNS(NS, 'g'); gProv.setAttribute('class', 'provs');
  gFire = document.createElementNS(NS, 'g'); gFire.setAttribute('class', 'fires');
  gSel = document.createElementNS(NS, 'g'); gSel.setAttribute('class', 'selg');
  svg.append(gProv, gFire, gSel);
  let A = Infinity, B = Infinity, C = -Infinity, D = -Infinity;
  for (const f of S.geo.features) {
    const n = f.properties.name, bb = bboxOf(f.geometry);
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', pathOf(f.geometry));
    p.setAttribute('class', 'prov');
    p.dataset.name = n;
    gProv.append(p);
    feat[n] = { f, el: p, bbox: bb, fires: [] };
    A = Math.min(A, bb[0]); B = Math.min(B, bb[1]); C = Math.max(C, bb[2]); D = Math.max(D, bb[3]);
  }
  const [x0, y0] = proj([A, D]), [x1, y1] = proj([C, B]);
  const pad = 20;
  S.home = [x0 - pad, y0 - pad, x1 - x0 + pad * 2, y1 - y0 + pad * 2];
  setView(S.home, false);
}
function fitBox(bb) {
  const [x0, y0] = proj([bb[0], bb[3]]), [x1, y1] = proj([bb[2], bb[1]]);
  const w = Math.max(x1 - x0, 90), h = Math.max(y1 - y0, 90);
  const box = svg.getBoundingClientRect(), ar = box.width / Math.max(box.height, 1);
  let W = Math.max(w * 2.6, 260), H = Math.max(h * 2.6, 260); // keep the neighbours in view
  if (W / H < ar) W = H * ar; else H = W / ar;
  return [(x0 + x1) / 2 - W / 2, (y0 + y1) / 2 - H / 2, W, H];
}
let anim = 0;
function setView(v, animate = true) {
  cancelAnimationFrame(anim);
  const from = S.view || v;
  const apply = cur => {
    S.view = cur;
    svg.setAttribute('viewBox', cur.map(n => n.toFixed(1)).join(' '));
    const box = svg.getBoundingClientRect();
    const scale = cur[2] / Math.max(box.width, 1); // svg units per screen pixel
    svg.style.setProperty('--px', scale.toFixed(4));
    gFire && gFire.querySelectorAll('circle').forEach(c => c.setAttribute('r', (2.5 * scale).toFixed(2)));
  };
  if (!animate || REDUCED.matches || document.hidden) { apply(v); return; }
  const t0 = performance.now(), dur = 520;
  const step = now => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    apply(from.map((a, i) => a + (v[i] - a) * e));
    if (k < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}

function paint() {
  for (const n in feat) {
    const el = feat[n].el;
    let fill = 'var(--land)', cls = '';
    if (S.layer === 'stage') {
      const s = stageOf(n);
      if (s) fill = `var(${STAGE[s].v})`; else cls = 'none';
    } else if (S.layer === 'rain') {
      const b = binOf(rain7(n), RAIN_BINS);
      fill = b < 0 ? 'var(--land)' : `var(--r${b})`;
    } else {
      const b = binOf(heat7(n), HEAT_BINS);
      fill = b < 0 ? 'var(--land)' : `var(--h${b})`;
    }
    el.style.fill = fill;
    el.classList.toggle('none', cls === 'none');
    el.classList.toggle('sel', n === S.sel);
  }
  gSel.textContent = '';
  if (S.sel && feat[S.sel]) { // the outline on top, so neighbours don't cover it
    const o = feat[S.sel].el.cloneNode(); o.removeAttribute('style'); o.setAttribute('class', 'sel-ring'); gSel.append(o);
  }
  gFire.style.display = S.fires_on ? '' : 'none';
  legend();
  document.querySelectorAll('#months [data-m]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.m === S.month)));
  document.querySelectorAll('#months').forEach(el => el.classList.toggle('off', S.layer !== 'stage'));
  document.querySelectorAll('#layers [data-layer]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.layer === S.layer)));
}

function legend() {
  const L = $('#legend');
  let rows = '', title = '';
  if (S.layer === 'stage') {
    title = byEnd(S.month);
    const c = { cond: 0, spell: 0, drought: 0, none: 0 };
    for (const n in feat) c[stageOf(n) || 'none']++;
    rows = ORDER.map(k => `<li><i style="background:var(${STAGE[k].v})"></i>${t(STAGE[k].n)} <b>${c[k]}</b></li>`).join('')
      + `<li><i class="none"></i>${t('Not listed')} <b>${c.none}</b></li>`;
  } else if (S.layer === 'rain') {
    title = t('Rain expected, next 7 days');
    rows = RAIN_BINS.map(([a, b], i) => `<li><i style="background:var(--r${i})"></i>${b === Infinity ? `${a}+ mm` : `${a}–${b} mm`}</li>`).join('');
  } else {
    title = t('Hottest feels-like, next 7 days');
    rows = HEAT_BINS.map(([a, b], i) => `<li><i style="background:var(--h${i})"></i>${a === -Infinity ? `${t('under')} ${b}°C` : b === Infinity ? `${a}°C+` : `${a}–${b - 1}°C`}</li>`).join('');
  }
  const fires = S.fires_on && S.fires ? `<li class="fl"><i class="dot"></i>${tf('{n} fire detections, last {d} days', { n: S.fires.rows.length.toLocaleString('en'), d: S.fires.days })}</li>` : '';
  const wxMissing = S.layer !== 'stage' && !S.wx ? `<li class="miss">${t('Weather is loading or unavailable.')}</li>` : '';
  L.innerHTML = `<b class="lt">${esc(title)}</b><ul>${rows}${wxMissing}${fires}</ul>`;
}

/* ---------------- months ---------------- */
function drawMonths() {
  const box = $('#months');
  const ms = S.stages.months;
  box.innerHTML = `<span class="ml">${t('By end of')}</span>` + ms.map((m, i) => {
    const [y, mo] = m.split('-').map(Number);
    const yr = i === 0 || mo === 1 ? ` <small>${y}</small>` : '';
    return `<button type="button" role="tab" data-m="${m}" aria-selected="false">${MN[mo - 1]}${yr}</button>`;
  }).join('');
}
function firstMonth() {
  const now = new Date(Date.now() + 8 * 3600e3), ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return S.stages.months.find(m => m >= ym) || S.stages.months[S.stages.months.length - 1];
}

/* ---------------- the card ---------------- */
function stageLine(s) {
  if (!s) return `<div class="stage none"><i></i><div><b>${t('No dry stage listed')}</b><span>${tf('PAGASA does not list this province for a dry condition, dry spell or drought {when}.', { when: byEnd(S.month) })}</span></div></div>`;
  return `<div class="stage s-${s}"><i style="background:var(${STAGE[s].v})"></i><div><b>${t(STAGE[s].n)}</b><span>${esc(byEnd(S.month))} · ${t(STAGE[s].d)}</span></div></div>`;
}
function strip(name) {
  return `<ol class="strip" aria-label="${esc(t('Dry stage, month by month'))}">` + S.stages.months.map(m => {
    const s = stageOf(name, m);
    return `<li class="${m === S.month ? 'cur' : ''}"><button type="button" data-m="${m}"><i style="background:${s ? `var(${STAGE[s].v})` : 'transparent'}" class="${s ? '' : 'none'}"></i><small>${MN[+m.slice(5) - 1]}</small><span>${s ? t(STAGE[s].n) : t('None')}</span></button></li>`;
  }).join('') + '</ol>';
}
function firstDrought(name) { return S.stages.months.find(m => stageOf(name, m) === 'drought') || null; }
function weatherBlock(name) {
  const w = wxOf(name);
  if (!w) return `<p class="muted">${S.wxErr ? t('Weather is unavailable right now.') : t('Loading weather…')}</p>`;
  const n = w.now || {};
  const days = w.days.map((d, i) => `<li><b>${esc(dayName(d.d, i))}</b><span class="hi">${r0(d.hi)}°</span><span class="lo">${r0(d.lo)}°</span><span class="mm">${d.mm == null ? '–' : (Math.round(d.mm * 10) / 10)} mm</span></li>`).join('');
  return `<div class="wx-now"><b>${r0(n.t)}°C</b><span>${tf('feels {t}°C', { t: r0(n.feels) })} · ${t(sky(n.code))}</span></div>
    <ol class="wx-days">${days}</ol>
    <p class="note">${tf('Rain in the next 7 days: {mm} mm. Forecast for one point in the province.', { mm: r0(rain7(name)) })}</p>`;
}
function firesBlock(name) {
  if (!S.fires) return `<p class="muted">${S.firesErr ? t('Fire detections are unavailable right now.') : t('Loading fire detections…')}</p>`;
  const list = feat[name].fires;
  if (!list.length) return `<p>${tf('No fire detections in the last {d} days.', { d: S.fires.days })}</p>`;
  const r = list[0], m = new Date(Date.parse(`${r[2]}T${r[3]}:00Z`) + 8 * 3600e3); // FIRMS times are UTC
  const when = `${m.getUTCDate()} ${MN[m.getUTCMonth()]}, ${String(m.getUTCHours()).padStart(2, '0')}:${String(m.getUTCMinutes()).padStart(2, '0')}`;
  return `<p><b class="big">${list.length}</b> ${tf('fire detections in the last {d} days. Latest: {when}, Manila time.', { d: S.fires.days, when })}</p>
    <p class="note">${t('Satellites see the heat of a fire, not its cause. Most are farm or grass burning.')}</p>`;
}
function card() {
  const C = $('#card');
  if (!S.stages) return;
  if (!S.sel) {
    const c = { cond: [], spell: [], drought: [], none: [] };
    for (const n of Object.keys(feat).sort()) c[stageOf(n) || 'none'].push(n);
    const list = (k, label) => c[k].length ? `<details${k === 'drought' ? ' open' : ''}><summary><i style="background:${k === 'none' ? 'transparent' : `var(${STAGE[k].v})`}" class="${k === 'none' ? 'none' : ''}"></i>${label} <b>${c[k].length}</b></summary><p class="names">${c[k].map(n => `<button type="button" data-go="${esc(n)}">${esc(n)}</button>`).join('')}</p></details>` : '';
    C.innerHTML = `<h2>${t('Philippines')}</h2><p class="sub">${esc(byEnd(S.month))} · ${tf('{n} provinces and areas', { n: Object.keys(feat).length })}</p>
      ${list('drought', t('Drought'))}${list('spell', t('Dry spell'))}${list('cond', t('Dry condition'))}${list('none', t('Not listed'))}
      <p class="hint">${t('Tap a province on the map, search, or use your location.')}</p>`;
    return;
  }
  const n = S.sel, p = feat[n].f.properties, s = stageOf(n), fd = firstDrought(n);
  const subs = Object.entries(S.stages.subs?.[S.month] || {}).filter(([, v]) => v.parent === n)
    .map(([label, v]) => `<p class="note">${tf('{place} is listed on its own: {stage} {when}.', { place: esc(label), stage: t(STAGE[v.stage].n), when: esc(byEnd(S.month)) })}</p>`).join('');
  const ben = n === 'Benguet' ? `<p><a class="btn" href="/">${t('Open the Benguet 3D map')}</a></p>` : '';
  C.innerHTML = `<div class="card-h"><div><h2>${esc(n)}</h2><p class="sub">${esc(p.region)}</p></div><button type="button" class="btn sm" id="clearSel" aria-label="${esc(t('Back to the whole country'))}">${t('All provinces')}</button></div>
    ${stageLine(s)}${subs}
    ${strip(n)}
    <p class="note">${fd ? tf('Drought expected {when}.', { when: byEnd(fd) }) : t('No drought expected in this outlook.')}</p>
    ${ben}
    <h3>${t('Weather')}</h3>${weatherBlock(n)}
    <h3>${t('Fires')}</h3>${firesBlock(n)}`;
}

/* ---------------- selection, search, location ---------------- */
function select(name, zoom = true) {
  if (name && !feat[name]) return;
  S.sel = name;
  paint(); card();
  if (zoom) setView(name ? fitBox(feat[name].bbox) : S.home);
  $('#resetBtn').hidden = !name;
  const u = new URL(location.href);
  if (name) u.searchParams.set('p', name); else u.searchParams.delete('p');
  history.replaceState(null, '', u);
  if (name && PHONE.matches) $('#card').scrollIntoView({ block: 'nearest', behavior: REDUCED.matches ? 'auto' : 'smooth' });
}
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const EXTRA = { 'metro manila': ['ncr', 'manila', 'quezon city', 'makati', 'pasig', 'taguig'], 'benguet': ['baguio', 'la trinidad'], 'davao del sur': ['davao city'], 'cebu': ['cebu city', 'lapu lapu', 'mandaue'], 'davao de oro': ['compostela valley'], 'cotabato': ['north cotabato'], 'samar': ['western samar'], 'special geographic area': ['sga', 'barmm'] };
function matches(q) {
  const k = norm(q); if (!k) return [];
  return Object.keys(feat).filter(n => norm(n).includes(k) || (EXTRA[norm(n)] || []).some(a => a.includes(k))).sort((a, b) => norm(a).indexOf(k) - norm(b).indexOf(k)).slice(0, 8);
}
function wireFind() {
  const q = $('#q'), L = $('#qList');
  let hi = 0, cur = [];
  const show = () => {
    cur = matches(q.value); hi = 0;
    L.innerHTML = cur.map((n, i) => `<li role="option" id="qo${i}" data-n="${esc(n)}" aria-selected="${i === hi}"><b>${esc(n)}</b> <span>${esc(feat[n].f.properties.region)}</span></li>`).join('');
    L.hidden = !cur.length; q.setAttribute('aria-expanded', String(!!cur.length));
  };
  const pick = n => { q.value = ''; L.hidden = true; q.setAttribute('aria-expanded', 'false'); $('#findMsg').textContent = ''; select(n); };
  q.addEventListener('input', show);
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!cur.length) return;
      hi = (hi + (e.key === 'ArrowDown' ? 1 : cur.length - 1)) % cur.length;
      L.querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', String(i === hi)));
      q.setAttribute('aria-activedescendant', 'qo' + hi);
    } else if (e.key === 'Enter') { if (cur[hi]) pick(cur[hi]); } else if (e.key === 'Escape') { L.hidden = true; }
  });
  L.addEventListener('click', e => { const li = e.target.closest('[data-n]'); if (li) pick(li.dataset.n); });
  document.addEventListener('click', e => { if (!e.target.closest('.find')) L.hidden = true; });
  $('#locBtn').addEventListener('click', () => {
    const msg = $('#findMsg');
    if (!navigator.geolocation) { msg.textContent = t('This browser cannot share your location.'); return; }
    msg.textContent = t('Finding your location…');
    navigator.geolocation.getCurrentPosition(pos => {
      const n = provinceAt(pos.coords.longitude, pos.coords.latitude);
      if (n) { msg.textContent = ''; select(n); } else msg.textContent = t('Your location is outside the provinces on this map.');
    }, () => { msg.textContent = t('Location was not shared. Search for your province instead.'); }, { timeout: 12000, maximumAge: 600000 });
  });
}

/* ---------------- tooltip ---------------- */
const tip = $('#tip');
function tipText(n) {
  if (S.layer === 'stage') { const s = stageOf(n); return `<b>${esc(n)}</b><br>${s ? t(STAGE[s].n) : t('Not listed')} · ${esc(byEnd(S.month))}`; }
  if (S.layer === 'rain') { const v = rain7(n); return `<b>${esc(n)}</b><br>${v == null ? '–' : r0(v) + ' mm'} · ${t('next 7 days')}`; }
  const v = heat7(n); return `<b>${esc(n)}</b><br>${t('Feels like')} ${v == null ? '–' : r0(v) + '°C'} · ${t('next 7 days')}`;
}
function wireMap() {
  svg.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const p = e.target.closest?.('.prov');
    if (!p) { tip.style.opacity = '0'; return; }
    tip.innerHTML = tipText(p.dataset.name);
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(innerWidth - r.width - 8, e.clientX + 14) + 'px';
    tip.style.top = Math.max(8, e.clientY - r.height - 10) + 'px';
    tip.style.opacity = '1';
  });
  svg.addEventListener('pointerleave', () => { tip.style.opacity = '0'; });
  svg.addEventListener('click', e => {
    const p = e.target.closest?.('.prov');
    if (p) select(p.dataset.name === S.sel ? null : p.dataset.name); else if (S.sel) select(null);
  });
  $('#resetBtn').addEventListener('click', () => select(null));
  $('#months').addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    S.month = b.dataset.m; S.layer = 'stage';
    paint(); card();
  });
  $('#layers').addEventListener('click', e => { const b = e.target.closest('[data-layer]'); if (!b) return; S.layer = b.dataset.layer; paint(); });
  $('#fireTog').addEventListener('change', e => { S.fires_on = e.target.checked; paint(); });
  $('#card').addEventListener('click', e => {
    const m = e.target.closest('[data-m]'); if (m) { S.month = m.dataset.m; S.layer = 'stage'; paint(); card(); return; }
    const g = e.target.closest('[data-go]'); if (g) { select(g.dataset.go); return; }
    if (e.target.closest('#clearSel')) select(null);
  });
  let rz = 0;
  addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => setView(S.sel ? fitBox(feat[S.sel].bbox) : S.home, false)); });
}

/* ---------------- fires ---------------- */
function drawFires() {
  gFire.textContent = '';
  if (!S.fires) return;
  for (const n in feat) feat[n].fires = [];
  const frag = document.createDocumentFragment();
  for (const r of S.fires.rows) {
    const [x, y] = proj([r[1], r[0]]);
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', x.toFixed(1)); c.setAttribute('cy', y.toFixed(1));
    frag.append(c);
    const n = provinceAt(r[1], r[0]);
    if (n) feat[n].fires.push(r);
  }
  gFire.append(frag);
  setView(S.view, false);
}

/* ---------------- sources ---------------- */
function sources() {
  const st = S.stages;
  const iss = st.issued ? `${+st.issued.slice(8)} ${MN[+st.issued.slice(5, 7) - 1]} ${st.issued.slice(0, 4)}` : '';
  const wxT = S.wx?.asof ? S.wx.asof.slice(11, 16) : null;
  $('#srcs').innerHTML = `<h3>${t('Sources')}</h3><ul>
    <li><a href="${esc(st.source.url)}" target="_blank" rel="noopener">PAGASA Climate Outlook</a>, ${t('issued')} ${esc(iss)}. ${t('Dry stages as PAGASA lists them, checked against its totals before publishing.')}</li>
    <li><a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>: ${S.wx ? tf('weather as of {t}, Manila time', { t: wxT }) : S.wxErr ? t('unavailable') : t('loading')}</li>
    <li><a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener">NASA FIRMS</a> (VIIRS): ${S.fires ? tf('fire detections, last {d} days', { d: S.fires.days }) : S.firesErr ? t('unavailable') : t('loading')}</li>
    <li>${t('Province boundaries')}: PSA PSGC 2023, ${t('via')} <a href="https://github.com/faeldon/philippines-json-maps" target="_blank" rel="noopener">philippines-json-maps</a> (MIT)</li>
  </ul>`;
}

/* ---------------- start ---------------- */
async function start() {
  try {
    [S.geo, S.stages] = await Promise.all([getJSON('/data/ph_provinces.json'), getJSON('/data/ph_stages.json')]);
  } catch (e) {
    $('#mapMsg').hidden = false; $('#mapMsg').textContent = t('The map could not load. Check your connection and reload.');
    return;
  }
  S.month = firstMonth();
  drawMap(); drawMonths(); wireMap(); wireFind();
  const want = new URLSearchParams(location.search).get('p');
  paint(); card(); sources();
  if (want && feat[want]) select(want);
  getJSON('/api/phweather', 30000).then(j => { if (!j.ok) throw new Error('weather'); S.wx = j; })
    .catch(() => { S.wxErr = true; }).finally(() => { paint(); card(); sources(); });
  getJSON('/api/phfires', 30000).then(j => { if (!j.ok) throw new Error('fires'); S.fires = j; drawFires(); })
    .catch(() => { S.firesErr = true; }).finally(() => { paint(); card(); sources(); });
  addEventListener('bantay:lang', () => { drawMonths(); paint(); card(); sources(); });
}
if (TEST) document.documentElement.classList.add('test');
start();
