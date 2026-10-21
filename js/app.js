// Bantay El Niño: app shell. Editorial outlook data (data/outlook.json, updated monthly from
// PAGASA) + live feeds (js/live.js) + the 3D map (js/map3d.js) + the Pacific map and charts.
import { $, $$, NS, css, clamp, fmt1, fmt2, esc, MN, MF, manila, ymKey, fmtDate, fmtTime, ago, showTip, hideTip, getJSON, TEST } from './util.js';
import { createMap } from './map3d.js';
import { LIVE, SOURCES, startLive, onLive, setHealth } from './live.js';

let D, B, AG, PAC, SRC, MONTHS, NOW, TODAY, STAGES;
let G = { ok: false, ready: false };
const state = {
  mode: 'outlook', month: 0, playing: false, speed: 1, sel: null, dam: null,
  layers: { terrain: true, relief: 1.8, stage: true, stageOp: 0.8, trees: true, contours: true, roads: true, rivers: true, munis: true, labels: true, fires: true, rain: false, land: true, boxes: true, grat: true },
  table: {},
};
const PHASE_LABEL = { observed: 'Observed', now: 'Now', outlook: 'Outlook', beyond: 'Beyond outlook' };
const REGIONS = [
  { id: 'n4', n: 'Niño 4', lon: [160, 210], lat: [5, -5] },
  { id: 'n3', n: 'Niño 3', lon: [210, 270], lat: [5, -5] },
  { id: 'n34', n: 'Niño 3.4', lon: [190, 240], lat: [5, -5] },
  { id: 'n12', n: 'Niño 1+2', lon: [270, 280], lat: [0, -10] },
];
const stageColor = s => (s ? css('--stage' + s) : null);
const stageVar = s => 'var(--stage' + s + ')';
const srcLink = id => (SRC[id] ? `<a href="${SRC[id].u}" target="_blank" rel="noopener">${esc(SRC[id].s)}</a>` : '');

/* ================= time ================= */
const NM = () => MONTHS.length;
function buildTime() {
  const [sy, sm] = D.timeline.start.split('-').map(Number);
  MONTHS = [];
  for (let i = 0; i < D.timeline.months; i++) { const t = sm - 1 + i; MONTHS.push({ i, m: t % 12, y: sy + Math.floor(t / 12), k: ymKey(sy + Math.floor(t / 12), t % 12) }); }
  TODAY = Date.now();
  const n = manila(), nk = ymKey(n.getUTCFullYear(), n.getUTCMonth());
  NOW = MONTHS.findIndex(x => x.k === nk); if (NOW < 0) NOW = nk < MONTHS[0].k ? 0 : NM() - 1;
  MONTHS.forEach(x => { x.phase = x.i < NOW ? 'observed' : x.i === NOW ? 'now' : x.k <= D.outlook.to ? 'outlook' : 'beyond'; });
}
function tFrac(x) {
  let y, m, d;
  if (typeof x === 'string' && x.length === 10) { [y, m, d] = x.split('-').map(Number); m -= 1; }
  else { const t = manila(new Date(x)); y = t.getUTCFullYear(); m = t.getUTCMonth(); d = t.getUTCDate(); }
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return ((y - MONTHS[0].y) * 12 + m - MONTHS[0].m + (d - 1) / dim) / NM();
}
const monthMid = i => (i + 0.5) / NM();
const monthIdx = k => MONTHS.findIndex(M => M.k === k);
const dateLabel = iso => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return `${d} ${MN[m - 1]} ${String(y).slice(2)}`; };

/* ================= live-derived views ================= */
function ninoMap() { // CPC relative values by month: editorial history + the live discussion
  const m = JSON.parse(JSON.stringify(D.nino_rel));
  const c = LIVE.enso?.cpc;
  if (c?.relative && c.issued) {
    const [y, mo] = c.issued.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 2, 1));
    const k = ymKey(d.getUTCFullYear(), d.getUTCMonth());
    m[k] = m[k] || {};
    for (const [id, v] of Object.entries(c.relative)) m[k][id] = [v, 'monthly', 'cpc_live'];
  }
  return m;
}
function damList() {
  const live = LIVE.dams?.dams || [], base = D.dams_baseline;
  return D.dams.map(meta => {
    const l = live.find(x => x.id === meta.id);
    if (l) return { ...meta, level: l.level, nhwl: l.nhwl, rule: l.rule, dev: l.dev, rdev: l.rule != null ? +(l.rule - l.nhwl).toFixed(2) : null, change24: l.change24, iso: l.iso, live: true };
    const [level, nhwl, rule] = base.levels[meta.id];
    return { ...meta, level, nhwl, rule, dev: +(level - nhwl).toFixed(2), rdev: +(rule - nhwl).toFixed(2), change24: null, iso: base.asof, live: false };
  });
}
const damAsOf = () => damList()[0]?.iso;
function histInfo() {
  const p = LIVE.enso?.cpc?.probs;
  if (!p || !p.items?.length) return null;
  const historic = /historic/i.test(p.text), strong = /very strong/i.test(p.text) && !historic;
  const items = p.items.map(it => ({ s: `${it.from}–${it.to}`, v: it.pct, from: it.from }));
  const nowMon = MN[manila().getUTCMonth()];
  const cur = items.find(it => it.from === nowMon) || items.reduce((a, b) => (b.v > a.v ? b : a));
  return { items, cur, label: historic ? 'historic' : strong ? 'very strong' : '', text: p.text };
}
function pagasaShort() {
  const t = LIVE.enso?.pagasa?.text;
  if (!t) return 'strong to very strong El Niño';
  return t.split(/(?<=\.)\s/)[0].replace(/\s+in the Tropical Pacific\.?$/i, '').replace(/\.$/, '').replace(/^An?\s/, m => m.toLowerCase());
}
const latestRoni = () => (LIVE.enso?.roni || []).at(-1);
const wxFor = name => LIVE.wx?.by?.[name];
function dryColor(d) {
  const st = [[0, [86, 156, 146]], [10, [148, 190, 160]], [17, [222, 214, 166]], [22, [233, 207, 142]], [26, [207, 148, 64]], [30, [162, 81, 42]]];
  for (let i = 0; i < st.length - 1; i++) if (d <= st[i + 1][0]) { const t = (d - st[i][0]) / (st[i + 1][0] - st[i][0]); return st[i][1].map((a, k) => Math.round(a + (st[i + 1][1][k] - a) * t)); }
  return st.at(-1)[1];
}

/* ================= events ================= */
let EVENTS = [];
function buildEventList() {
  const ev = D.events.map(e => ({ ...e }));
  const c = LIVE.enso?.cpc, lastStatic = D.events.map(e => e.d).sort().at(-1);
  if (c?.issued && c.issued > lastStatic) ev.push({ d: c.issued, t: `CPC: ${c.status || 'update'}${c.relative?.n34 != null ? `; Niño 3.4 at ${fmt1(c.relative.n34)}°C (relative)` : ''}${histInfo() ? `; ${histInfo().cur.v}% chance for ${histInfo().cur.s}` : ''}`, s: 'cpc_live', live: true });
  const p = LIVE.enso?.pagasa;
  if (p?.updated && p.updated > lastStatic) ev.push({ d: p.updated, t: `PAGASA: ${p.text.split(/(?<=\.)\s/)[0]}`, s: 'pag_mon', live: true });
  const dl = damList();
  if (dl[0]?.live) ev.push({ d: dl[0].iso.slice(0, 10), t: 'Agno dams vs normal high water: ' + dl.map(x => `${x.id} ${fmt2(x.dev)} m`).join(', '), s: 'pag_dam', live: true });
  const f = (LIVE.fires?.fires || []).length;
  if (LIVE.fires?.status === 'ok') ev.push({ d: manila().toISOString().slice(0, 10), t: f ? `${f} active fire detection${f > 1 ? 's' : ''} in and around Benguet in the past ${LIVE.fires.days} days` : `No active fires detected in the past ${LIVE.fires.days} days`, s: 'firms', live: true });
  ev.sort((a, b) => a.d.localeCompare(b.d));
  ev.forEach(e => { e.mi = monthIdx(e.d.slice(0, 7)); e.label = dateLabel(e.d); });
  EVENTS = ev.filter(e => e.mi >= 0);
}

/* ================= Pacific map ================= */
const P = {};
function initPac() {
  const svg = $('#pac'); svg.setAttribute('viewBox', `0 0 ${PAC.vw} ${PAC.vh}`); svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const sc = PAC.scale || 1;
  const prj = (lon, lat) => [(lon - PAC.lon0) / (PAC.lon1 - PAC.lon0) * PAC.vw, (PAC.latN - lat) / (PAC.latN - PAC.latS) * PAC.vh];
  const el = (t, a, p) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); (p || svg).appendChild(e); return e; };
  const defs = el('defs', {});
  const pat = el('pattern', { id: 'hatchP', width: 7 * sc, height: 7 * sc, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  el('line', { x1: 0, y1: 0, x2: 0, y2: 7 * sc, stroke: 'currentColor', 'stroke-width': 1.4 * sc, opacity: 0.35 }, pat);
  el('rect', { x: 0, y: 0, width: PAC.vw, height: PAC.vh, fill: 'var(--sea)' });
  P.grat = el('g', { stroke: 'var(--grat)', 'stroke-width': 0.8 * sc, fill: 'none' });
  for (let lon = 100; lon <= 290; lon += 20) { const [x] = prj(lon, 0); el('line', { x1: x, y1: 0, x2: x, y2: PAC.vh }, P.grat); }
  for (let lat = -30; lat <= 40; lat += 10) { const [, y] = prj(0, lat); el('line', { x1: 0, y1: y, x2: PAC.vw, y2: y, 'stroke-width': (lat === 0 ? 1.6 : 0.8) * sc, stroke: lat === 0 ? 'var(--line-strong)' : 'var(--grat)' }, P.grat); }
  const gl = el('g', { fill: 'var(--muted)', 'font-size': 11 * sc, 'font-family': 'DM Mono, monospace' }, P.grat);
  [[120, '120°E'], [160, '160°E'], [180, '180°'], [200, '160°W'], [240, '120°W'], [280, '80°W']].forEach(([lon, t]) => { const [x] = prj(lon, 0); const tx = el('text', { x: x + 3 * sc, y: PAC.vh - 6 * sc, stroke: 'none' }, gl); tx.textContent = t; });
  const eq = el('text', { x: prj(141, 0)[0], y: prj(0, 0)[1] - 5 * sc, fill: 'var(--muted)', 'font-size': 11 * sc, 'font-family': 'DM Mono, monospace', stroke: 'none' }, P.grat); eq.textContent = 'Equator';
  P.land = el('path', { d: PAC.land, fill: 'var(--land)', stroke: 'var(--line-strong)', 'stroke-width': 0.6 * sc });
  P.ph = el('path', { d: PAC.ph, fill: 'var(--ph)', stroke: 'var(--amber)', 'stroke-width': 0.6 * sc });
  const [bx, by] = prj(120.6, 16.5);
  el('circle', { cx: bx, cy: by, r: 4.5 * sc, fill: 'var(--heat)', stroke: 'var(--panel)', 'stroke-width': 1.5 * sc });
  const bt = el('text', { x: bx + 9 * sc, y: by - 6 * sc, fill: 'var(--forest)', 'font-size': 13 * sc, 'font-weight': 700, 'font-family': 'Manrope, sans-serif' }); bt.textContent = 'Benguet';
  P.boxes = el('g', {}); P.box = {};
  REGIONS.forEach(R => {
    const [x0, y0] = prj(R.lon[0], R.lat[0]), [x1, y1] = prj(R.lon[1], R.lat[1]);
    const g = el('g', { class: 'nbox', tabindex: 0, role: 'img' }, P.boxes);
    const rect = el('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 3 * sc, 'stroke-width': (R.id === 'n34' ? 2.4 : 1.2) * sc, stroke: 'var(--forest)' }, g);
    const hatch = el('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 3 * sc, fill: 'url(#hatchP)', color: 'var(--ink)', 'pointer-events': 'none' }, g);
    P.box[R.id] = { g, rect, hatch, R, x0, y0, x1, y1 };
    g.addEventListener('pointermove', ev => showTip(boxTip(R.id), ev.clientX, ev.clientY));
    g.addEventListener('pointerleave', hideTip);
    g.addEventListener('focus', () => { const r = rect.getBoundingClientRect(); showTip(boxTip(R.id), r.left + r.width / 2, r.top); });
    g.addEventListener('blur', hideTip);
  });
  P.lbl = el('g', { 'font-family': 'DM Sans, sans-serif', 'font-size': 12 * sc, 'pointer-events': 'none' });
  const fo = el('foreignObject', { x: prj(192, -13)[0], y: prj(192, -13)[1], width: 350 * sc, height: 110 * sc });
  fo.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" style="font:${12.5 * sc}px/1.45 DM Sans,sans-serif;color:var(--ink);background:color-mix(in srgb,var(--panel) 92%,transparent);border-radius:${10 * sc}px;padding:${9 * sc}px ${11 * sc}px;box-shadow:var(--shadow)"><b style="font-family:Manrope,sans-serif;color:var(--forest)">Why a warm Pacific dries Benguet</b><br>El Niño warms the central and eastern Pacific. Rain-making storms follow the warm water east, so the western Pacific, including Luzon, gets less rain.</div>`;
}
function anomColor(v) {
  const st = [[0.5, [246, 227, 195]], [1.5, [233, 178, 124]], [2.5, [212, 122, 69]], [3.5, [173, 70, 38]], [4.2, [132, 42, 24]]];
  if (v <= st[0][0]) return `rgb(${st[0][1]})`;
  for (let i = 0; i < st.length - 1; i++) if (v <= st[i + 1][0]) { const t = (v - st[i][0]) / (st[i + 1][0] - st[i][0]); return 'rgb(' + st[i][1].map((a, k) => Math.round(a + (st[i + 1][1][k] - a) * t)).join(',') + ')'; }
  return `rgb(${st.at(-1)[1]})`;
}
const lonTxt = l => (l <= 180 ? l + '°E' : 360 - l + '°W');
function boxTip(id) {
  const R = REGIONS.find(r => r.id === id), M = MONTHS[state.month], rec = (ninoMap()[M.k] || {})[id];
  const span = `${Math.abs(R.lat[0])}°${R.lat[0] >= 0 ? 'N' : 'S'}–${Math.abs(R.lat[1])}°S, ${lonTxt(R.lon[0])}–${lonTxt(R.lon[1])}`;
  const wk = (LIVE.enso?.weekly || []).at(-1);
  const wkTxt = wk && M.i >= NOW ? `<br>Latest weekly reading, traditional: <span class="mono">${fmt1(wk[id])}°C</span> (${fmtDate(wk.date)})` : '';
  if (rec) return `<b>${R.n}</b> · ${span}<br>${MF[M.m]} ${M.y}: <span class="mono">${fmt1(rec[0])}°C</span> relative (${rec[1]})<br><span class="mono">${esc(SRC[rec[2]]?.s || '')}</span>${wkTxt}`;
  return `<b>${R.n}</b> · ${span}<br>${M.i >= NOW ? 'No monthly value yet for ' + MF[M.m] : 'No CPC value quoted for ' + MF[M.m]}${wkTxt}`;
}
function updatePac() {
  if (!P.box) return;
  const M = MONTHS[state.month], rec = ninoMap()[M.k] || {};
  while (P.lbl.firstChild) P.lbl.removeChild(P.lbl.firstChild);
  const sc = PAC.scale || 1;
  REGIONS.forEach(R => {
    const b = P.box[R.id], v = rec[R.id];
    b.rect.setAttribute('fill', v ? anomColor(v[0]) : 'var(--panel)'); b.rect.setAttribute('fill-opacity', v ? (R.id === 'n34' ? 0.92 : 0.78) : 0.35);
    b.hatch.style.display = v ? 'none' : ''; b.g.setAttribute('aria-label', R.n + (v ? ': ' + fmt1(v[0]) + ' degrees' : ': no reading'));
    const lx = R.id === 'n4' ? b.x0 + 8 * sc : R.id === 'n3' ? b.x1 - 70 * sc : R.id === 'n12' ? b.x1 : (b.x0 + b.x1) / 2;
    const ly = R.id === 'n12' ? b.y1 + 16 * sc : R.id === 'n34' ? b.y0 - 10 * sc : b.y1 + 16 * sc;
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', lx); t.setAttribute('y', ly); t.setAttribute('text-anchor', R.id === 'n4' ? 'start' : R.id === 'n3' || R.id === 'n12' ? 'end' : 'middle'); t.setAttribute('fill', 'var(--forest)');
    t.innerHTML = `<tspan font-weight="700">${R.n}</tspan><tspan font-family="DM Mono, monospace" dx="${5 * sc}">${v ? fmt1(v[0]) + '°C' : '—'}</tspan>`;
    P.lbl.appendChild(t);
  });
  P.land.style.display = state.layers.land ? '' : 'none'; P.boxes.style.display = state.layers.boxes ? '' : 'none';
  P.lbl.style.display = state.layers.boxes ? '' : 'none'; P.grat.style.display = state.layers.grat ? '' : 'none';
}

/* ================= charts ================= */
function svgIn(plot) {
  plot.innerHTML = ''; const r = plot.getBoundingClientRect(); const w = Math.max(120, r.width), h = Math.max(80, r.height);
  const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', `0 0 ${w} ${h}`); s.setAttribute('role', 'img'); plot.appendChild(s); return { s, w, h };
}
function E(t, a, p) { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; }
function T(p, x, y, txt, a) { const e = E('text', Object.assign({ x, y, fill: 'var(--muted)', 'font-size': 10, 'font-family': 'DM Sans, sans-serif' }, a || {}), p); e.textContent = txt; return e; }
function hover(el, html) { el.addEventListener('pointermove', ev => showTip(typeof html === 'function' ? html() : html, ev.clientX, ev.clientY)); el.addEventListener('pointerleave', hideTip); }
function monthAxis(g, x, y0, every) { MONTHS.forEach((M, i) => { if (every > 1 && i % every) return; T(g, x(monthMid(i)), y0, M.m === 0 ? MN[M.m] + ' ' + String(M.y).slice(2) : MN[M.m][0], { 'text-anchor': 'middle', 'font-size': 9.5, fill: M.m === 0 ? 'var(--ink)' : 'var(--muted)' }); }); }
function cursorLine(g, x, top, bot) { const xx = x(monthMid(state.month)); E('line', { x1: xx, x2: xx, y1: top, y2: bot, stroke: 'var(--gold)', 'stroke-width': 2 }, g); }
const liveTag = ok => (ok ? '<span class="livetag">Live</span>' : '<span class="livetag off">Saved</span>');

const CHARTS = {
  nino34: {
    title: 'Niño 3.4', unit: '°C vs normal', live: () => !!LIVE.enso?.roni?.length,
    srcText: () => `NOAA CPC: RONI${LIVE.enso?.roni?.length ? ' to ' + latestRoni().season + ' ' + latestRoni().year : ''}, monthly values quoted in CPC discussions, weekly OISST (traditional, grey)`,
    rows: () => {
      const r = [];
      (LIVE.enso?.roni || []).filter(x => monthIdx(x.mid) >= 0).forEach(x => r.push([`${x.season} ${x.year} (RONI, 3-month)`, fmt1(x.anom), 'CPC RONI']));
      const nm = ninoMap(); MONTHS.forEach(M => { const v = nm[M.k]?.n34; if (v) r.push([`${MF[M.m]} ${M.y} (${v[1]}, relative)`, fmt1(v[0]), SRC[v[2]]?.s || '']); });
      (LIVE.enso?.weekly || []).slice(-6).forEach(w => r.push([`Week of ${fmtDate(w.date)} (traditional)`, fmt1(w.n34), 'CPC weekly OISST']));
      return r;
    },
    cols: ['Reading', '°C', 'Source'],
    draw(plot) {
      const { s, w, h } = svgIn(plot);
      const m = { l: 26, r: 6, t: 6, b: 16 }, x = f => m.l + f * (w - m.l - m.r), yMax = 3.5, y = v => m.t + (1 - clamp(v, 0, yMax) / yMax) * (h - m.t - m.b);
      [[0.5, 1, 'Weak'], [1, 1.5, 'Moderate'], [1.5, 2, 'Strong'], [2, 2.5, 'Very strong'], [2.5, 3.5, 'Historic']].forEach(([a, b, n], k) => { E('rect', { x: m.l, y: y(b), width: w - m.l - m.r, height: y(a) - y(b), fill: 'var(--heat)', 'fill-opacity': 0.035 + k * 0.03 }, s); T(s, m.l + 4, y(b) + 10, n, { 'font-size': 9 }); });
      [0, 1, 2, 3].forEach(v => { E('line', { x1: m.l, x2: w - m.r, y1: y(v), y2: y(v), stroke: 'var(--line)', 'stroke-width': v === 0 ? 1 : 0.6 }, s); T(s, m.l - 5, y(v) + 3, v === 0 ? '0' : '+' + v, { 'text-anchor': 'end', 'font-family': 'DM Mono, monospace' }); });
      const nx = x(clamp(tFrac(TODAY), 0, 1)); E('rect', { x: nx, y: m.t, width: Math.max(0, w - m.r - nx), height: h - m.t - m.b, fill: 'var(--pale)', 'fill-opacity': 0.7 }, s);
      cursorLine(s, x, m.t, h - m.b);
      const hi = histInfo(), c = LIVE.enso?.cpc;
      if (w - m.r - nx > 90) {
        E('rect', { x: nx + 3, y: m.t + 3, width: Math.min(w - m.r - nx - 6, 140), height: hi ? 36 : 24, rx: 4, fill: 'var(--panel)', 'fill-opacity': 0.88 }, s);
        T(s, nx + 6, m.t + 13, c?.next ? `Next CPC update ${fmtDate(c.next)}` : 'No readings yet', { 'font-size': 9.5, fill: 'var(--ink)', 'font-weight': 700 });
        if (hi) T(s, nx + 6, m.t + 25, `${hi.cur.v}% chance ${hi.label ? 'of a ' + hi.label + ' event ' : ''}in ${hi.cur.s}`, { 'font-size': 9.5 });
      }
      monthAxis(s, x, h - 4, w < 380 ? 2 : 1);
      // weekly traditional OISST (grey)
      const wk = (LIVE.enso?.weekly || []).map(p => [x(tFrac(p.date)), y(p.n34), p]).filter(p => p[0] >= m.l && p[0] <= w - m.r);
      if (wk.length > 1) {
        E('path', { d: 'M' + wk.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L'), fill: 'none', stroke: 'var(--faint)', 'stroke-width': 1.2, 'stroke-dasharray': '2 2' }, s);
        const lw = wk.at(-1); T(s, lw[0] - 6, lw[1] + 12, `weekly, traditional ${fmt1(lw[2].n34)}`, { 'text-anchor': 'end', 'font-size': 9, fill: 'var(--muted)' });
        wk.forEach(p => { const hit = E('circle', { cx: p[0], cy: p[1], r: 5, fill: 'transparent' }, s); hover(hit, `<b>${fmt1(p[2].n34)}°C</b> · week of ${fmtDate(p[2].date)}<br>Weekly OISST, traditional anomaly (runs about 0.7–0.9°C above the relative index)`); });
      }
      // RONI (official relative, 3-month)
      const ro = (LIVE.enso?.roni || []).map(r => ({ i: monthIdx(r.mid), r })).filter(o => o.i >= 0).map(o => [x(monthMid(o.i)), y(o.r.anom), o.r]);
      if (ro.length > 1) E('path', { d: 'M' + ro.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L'), fill: 'none', stroke: 'var(--heat)', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-opacity': 0.55 }, s);
      ro.forEach(p => { E('circle', { cx: p[0], cy: p[1], r: 2.6, fill: 'var(--heat)', 'fill-opacity': 0.6 }, s); const hit = E('circle', { cx: p[0], cy: p[1], r: 8, fill: 'transparent' }, s); hover(hit, `<b>${fmt1(p[2].anom)}°C</b> · RONI ${p[2].season} ${p[2].year}<br>3-month relative index, the official ENSO measure`); });
      // monthly relative values quoted by CPC
      const nm = ninoMap();
      const mon = MONTHS.map(M => ({ M, v: nm[M.k]?.n34 })).filter(o => o.v);
      mon.forEach(({ M, v }, k) => {
        const px = v[1].startsWith('weekly') ? x(tFrac((D.n34_weekly_quotes.find(q => q.d.slice(0, 7) === M.k) || { d: M.k + '-15' }).d)) : x(monthMid(M.i)), py = y(v[0]);
        const isW = v[1].startsWith('weekly');
        E('circle', { cx: px, cy: py, r: isW ? 3.6 : k === mon.length - 1 ? 5 : 4, fill: isW ? 'var(--panel)' : 'var(--heat)', stroke: isW ? 'var(--heat)' : 'var(--panel)', 'stroke-width': 1.5 }, s);
        const hit = E('circle', { cx: px, cy: py, r: 11, fill: 'transparent' }, s);
        hover(hit, `<b>${fmt1(v[0])}°C</b> · ${MF[M.m]} ${M.y}, ${esc(v[1])}<br>Relative index as quoted by ${esc(SRC[v[2]]?.s || 'CPC')}`);
      });
      const last = mon.filter(o => !o.v[1].startsWith('weekly')).at(-1);
      if (last) T(s, x(monthMid(last.M.i)) - 7, y(last.v[0]) - 8, `${fmt1(last.v[0])}°C ${MN[last.M.m]}`, { 'text-anchor': 'end', fill: 'var(--ink)', 'font-weight': 700, 'font-family': 'DM Mono, monospace' });
      s.setAttribute('aria-label', 'Niño 3.4 index: relative monthly values, RONI and weekly traditional readings');
    },
  },
  rain46: {
    title: () => `Rain, ${(state.sel || 'Baguio City').replace(' City', '')}`, unit: 'mm/day · last 30 days + 16-day forecast', live: () => !!LIVE.wx,
    srcText: () => 'Open-Meteo weather models at the town centre, not rain-gauge readings' + (LIVE.wx ? ` · ${fmtDate(LIVE.wx.fetched)} ${fmtTime(LIVE.wx.fetched)}` : ''),
    rows: () => { const v = wxFor(state.sel || 'Baguio City'); if (!v) return []; return v.series.t.map((t, i) => [t + (i >= v.series.today ? ' (forecast)' : ''), v.series.p[i] == null ? '—' : v.series.p[i].toFixed(1), v.series.tx[i] == null ? '—' : v.series.tx[i].toFixed(1)]); },
    cols: ['Date', 'mm', 'Max °C'],
    draw(plot) {
      const { s, w, h } = svgIn(plot);
      const name = state.sel || 'Baguio City', v = wxFor(name);
      if (!v) { T(s, 8, 22, LIVE.health.wx?.status === 'error' ? 'Weather feed unavailable right now.' : 'Loading town weather…', { fill: 'var(--muted)', 'font-size': 11 }); return; }
      const S = v.series, n = S.t.length, mx = Math.max(10, ...S.p.filter(q => q != null)), yMax = Math.ceil(mx / 10) * 10;
      const m = { l: 28, r: 6, t: 8, b: 16 }, bw = (w - m.l - m.r) / n, y = q => m.t + (1 - q / yMax) * (h - m.t - m.b);
      [0, yMax / 2, yMax].forEach(q => { E('line', { x1: m.l, x2: w - m.r, y1: y(q), y2: y(q), stroke: 'var(--line)', 'stroke-width': q ? 0.6 : 1 }, s); T(s, m.l - 5, y(q) + 3, String(q), { 'text-anchor': 'end', 'font-family': 'DM Mono, monospace' }); });
      const tx = m.l + S.today * bw;
      E('rect', { x: tx, y: m.t, width: w - m.r - tx, height: h - m.t - m.b, fill: 'var(--pale)', 'fill-opacity': 0.7 }, s);
      E('line', { x1: tx, x2: tx, y1: m.t, y2: h - m.b, stroke: 'var(--gold)', 'stroke-width': 2 }, s);
      T(s, tx + 4, m.t + 10, 'Forecast', { 'font-size': 9, fill: 'var(--ink)', 'font-weight': 700 });
      if (name === 'Baguio City') {
        const mo = manila().getUTCMonth(), dim = new Date(Date.UTC(2026, mo + 1, 0)).getUTCDate(), avg = D.normals.rain[mo] / dim;
        if (avg < yMax) { E('line', { x1: m.l, x2: w - m.r, y1: y(avg), y2: y(avg), stroke: 'var(--teal)', 'stroke-width': 1.2, 'stroke-dasharray': '4 3' }, s); T(s, w - m.r - 2, y(avg) - 3, `usual ${MN[mo]} average ${avg.toFixed(1)} mm/day`, { 'text-anchor': 'end', 'font-size': 9, fill: 'var(--teal)' }); }
      }
      S.p.forEach((q, i) => {
        const cx = m.l + (i + 0.5) * bw, fut = i >= S.today;
        if (q != null && q >= 0.05) E('rect', { x: cx - bw * 0.36, y: y(q), width: bw * 0.72, height: Math.max(1, y(0) - y(q)), rx: Math.min(2, bw / 4), fill: fut ? 'var(--water)' : 'var(--teal)', 'fill-opacity': fut ? 0.5 : 0.85 }, s);
        else if (q != null) E('circle', { cx, cy: y(0) - 3, r: Math.min(1.8, bw / 3), fill: 'var(--stage2)' }, s);
        const hit = E('rect', { x: cx - bw / 2, y: m.t, width: bw, height: h - m.t - m.b, fill: 'transparent' }, s);
        hover(hit, `<b>${fmtDate(S.t[i], true)}</b>${fut ? ' · forecast' : ''}<br>Rain <span class="mono">${q == null ? '—' : q.toFixed(1) + ' mm'}</span>${q != null && q < 1 ? ' (dry day)' : ''}${S.tx[i] != null ? `<br>High <span class="mono">${S.tx[i].toFixed(1)}°C</span>` : ''}${fut && S.pp[i] != null ? ` · chance of rain <span class="mono">${S.pp[i]}%</span>` : ''}`);
      });
      [0, S.today, n - 1].forEach(i => T(s, m.l + (i + 0.5) * bw, h - 4, fmtDate(S.t[i]), { 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle', 'font-size': 9.5, 'font-family': 'DM Mono, monospace' }));
      s.setAttribute('aria-label', `Daily rain at ${name}: ${v.rain30.toFixed(0)} mm in the last 30 days, ${v.fc16.toFixed(0)} mm forecast for the next 16`);
    },
  },
  nat: {
    title: 'Provinces in a dry stage', unit: 'nationwide, end of month', srcText: () => 'PAGASA Advisory No. 5 (Sep, observed); PAGASA Climate Outlook, 23 Sep (Oct–Mar)',
    rows: () => Object.entries(D.nat).map(([k, v]) => { const M = MONTHS[monthIdx(k)]; return [MN[M.m] + ' ' + M.y + (v[4] === 'obs' ? ' (obs.)' : ''), v[0], v[1], v[2], v[0] + v[1] + v[2]]; }),
    cols: ['Month', 'Dry cond.', 'Dry spell', 'Drought', 'Total'],
    draw(plot) {
      const { s, w, h } = svgIn(plot);
      const keys = Object.keys(D.nat).filter(k => monthIdx(k) >= 0), m = { l: 24, r: 6, t: 8, b: 30 }, n = keys.length, bw = (w - m.l - m.r) / n, yMax = 90, y = v => m.t + (1 - v / yMax) * (h - m.t - m.b);
      [0, 40, 80].forEach(v => { E('line', { x1: m.l, x2: w - m.r, y1: y(v), y2: y(v), stroke: 'var(--line)', 'stroke-width': v ? 0.6 : 1 }, s); T(s, m.l - 5, y(v) + 3, String(v), { 'text-anchor': 'end', 'font-family': 'DM Mono, monospace' }); });
      const defs = E('defs', {}, s), pt = E('pattern', { id: 'hatchC', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs); E('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: 'var(--ink)', 'stroke-width': 1, opacity: 0.35 }, pt);
      keys.forEach((k, j) => {
        const v = D.nat[k], M = MONTHS[monthIdx(k)], x0 = m.l + j * bw + bw * 0.18, ww = bw * 0.64, sel = M.i === state.month; let acc = 0;
        [0, 1, 2].forEach(ci => { const val = v[ci]; if (!val) return; const y1 = y(acc + val), y0 = y(acc); E('rect', { x: x0, y: y1 + 1, width: ww, height: Math.max(0.5, y0 - y1 - 2), rx: 2, fill: stageVar(ci + 1), 'fill-opacity': sel ? 1 : 0.82 }, s); acc += val; });
        if (v[4] !== 'obs') E('rect', { x: x0, y: y(acc), width: ww, height: y(0) - y(acc), fill: 'url(#hatchC)', opacity: 0.5 }, s);
        const st = D.stage[k]; if (st) { let base = 0; for (let ci = 0; ci < st.s - 1; ci++) base += v[ci]; E('circle', { cx: x0 + ww / 2, cy: y(base + v[st.s - 1] / 2), r: 4.2, fill: 'var(--panel)', stroke: 'var(--forest)', 'stroke-width': 1.6 }, s); }
        T(s, x0 + ww / 2, y(acc) - 3, String(acc), { 'text-anchor': 'middle', 'font-family': 'DM Mono, monospace', fill: 'var(--ink)', 'font-size': 9.5 });
        T(s, x0 + ww / 2, h - m.b + 11, MN[M.m], { 'text-anchor': 'middle', fill: sel ? 'var(--ink)' : 'var(--muted)', 'font-weight': sel ? 700 : 400 });
        if (sel) E('rect', { x: x0 - 3, y: m.t, width: ww + 6, height: h - m.t - m.b, fill: 'none', stroke: 'var(--gold)', 'stroke-width': 1.6, rx: 3 }, s);
        const hit = E('rect', { x: m.l + j * bw, y: m.t, width: bw, height: h - m.t - m.b + 12, fill: 'transparent' }, s);
        hover(hit, `<b>${MF[M.m]} ${M.y}</b>${v[4] === 'obs' ? ' · observed' : ' · outlook'}<br>Dry condition <span class="mono">${v[0]}</span> · Dry spell <span class="mono">${v[1]}</span> · Drought <span class="mono">${v[2]}</span>${st ? '<br>Benguet: ' + STAGES[st.s].n : ''}`);
        hit.addEventListener('click', () => setMonth(M.i));
      });
      const lg = E('g', {}, s); let lx = m.l; const ly = h - 6;
      [['Dry condition', 1], ['Dry spell', 2], ['Drought', 3]].forEach(([t, c]) => { E('rect', { x: lx, y: ly - 7, width: 8, height: 8, rx: 2, fill: stageVar(c) }, lg); const tt = T(lg, lx + 11, ly, t, { 'font-size': 9.5 }); lx += tt.getComputedTextLength() + 22; });
      E('circle', { cx: lx + 4, cy: ly - 3, r: 3.6, fill: 'var(--panel)', stroke: 'var(--forest)', 'stroke-width': 1.5 }, lg); T(lg, lx + 11, ly, 'Benguet', { 'font-size': 9.5 });
    },
  },
  regions: {
    title: 'Niño regions', unit: '°C, relative, as quoted by CPC', live: () => !!LIVE.enso?.cpc,
    srcText: () => 'NOAA CPC diagnostic discussions (relative indices)',
    months: () => { const nm = ninoMap(); return Object.keys(nm).filter(k => nm[k].n34 && nm[k].n34[1] === 'monthly').sort().slice(-3); },
    rows() { const nm = ninoMap(), ks = this.months(); return [['n12', 'Niño 1+2'], ['n3', 'Niño 3'], ['n34', 'Niño 3.4'], ['n4', 'Niño 4']].map(([id, n]) => [n, ...ks.map(k => (nm[k][id] ? fmt1(nm[k][id][0]) : '—'))]); },
    cols: () => ['Region', ...CHARTS.regions.months().map(k => MN[+k.slice(5) - 1])],
    draw(plot) {
      const { s, w, h } = svgIn(plot);
      const nm = ninoMap(), ks = this.months();
      const R = [['n12', 'Niño 1+2', 'Coast of Peru and Ecuador'], ['n3', 'Niño 3', 'Eastern Pacific'], ['n34', 'Niño 3.4', 'Central Pacific, the main index']].map(([id, n, d]) => [n, ks.map(k => nm[k][id] ? nm[k][id][0] : null), d]);
      const m = { l: 62, r: 30, t: 8, b: 30 }, x = v => m.l + (v / 4.5) * (w - m.l - m.r), rh = (h - m.t - m.b) / 3;
      [0, 1, 2, 3, 4].forEach(v => { E('line', { x1: x(v), x2: x(v), y1: m.t, y2: h - m.b, stroke: 'var(--line)', 'stroke-width': v ? 0.6 : 1 }, s); T(s, x(v), h - m.b + 12, v ? '+' + v : '0', { 'text-anchor': 'middle', 'font-family': 'DM Mono, monospace' }); });
      const cols = ['var(--m1)', 'var(--m2)', 'var(--m3)'].slice(3 - ks.length);
      R.forEach((r, k) => {
        const cy = m.t + rh * (k + 0.5), vals = r[1].filter(v => v != null);
        T(s, m.l - 8, cy + 3, r[0], { 'text-anchor': 'end', fill: 'var(--ink)', 'font-weight': k === 2 ? 700 : 500, 'font-size': 10.5 });
        if (vals.length > 1) E('line', { x1: x(Math.min(...vals)), x2: x(Math.max(...vals)), y1: cy, y2: cy, stroke: 'var(--line-strong)', 'stroke-width': 2 }, s);
        r[1].forEach((v, j) => { if (v == null) return; E('circle', { cx: x(v), cy, r: j === r[1].length - 1 ? 6 : 5, fill: cols[j], stroke: 'var(--panel)', 'stroke-width': 1.5 }, s); const hit = E('circle', { cx: x(v), cy, r: 11, fill: 'transparent' }, s); hover(hit, `<b>${r[0]}</b> · ${MF[+ks[j].slice(5) - 1]}<br><span class="mono">${fmt1(v)}°C</span> relative · ${r[2]}`); });
        if (vals.length) T(s, x(r[1].filter(v => v != null).at(-1)) + 9, cy + 3.5, fmt1(r[1].filter(v => v != null).at(-1)), { fill: 'var(--ink)', 'font-family': 'DM Mono, monospace', 'font-size': 10 });
      });
      const ly = h - 6; let lx = m.l;
      ks.forEach((k, j) => { E('circle', { cx: lx + 4, cy: ly - 3, r: 4, fill: cols[j] }, s); const tt = T(s, lx + 11, ly, MN[+k.slice(5) - 1], { 'font-size': 9.5 }); lx += tt.getComputedTextLength() + 22; });
    },
  },
  hist: {
    title: () => (histInfo()?.label === 'historic' ? 'Chance of a historic event' : 'CPC strength odds'), unit: () => (histInfo()?.label === 'historic' ? 'RONI ≥ +2.5°C' : ''), live: () => !!histInfo(),
    srcText: () => (LIVE.enso?.cpc?.issued ? `NOAA CPC, ${fmtDate(LIVE.enso.cpc.issued, true)}` : 'NOAA CPC') + (D.hist_prev ? ` (${D.hist_prev})` : ''),
    rows: () => (histInfo()?.items || []).map(r => [r.s, r.v + '%']), cols: ['Season', 'Chance'],
    draw(plot) {
      const { s, w, h } = svgIn(plot); const hi = histInfo();
      if (!hi) { T(s, 8, 22, LIVE.enso ? 'CPC’s probability table could not be read this time.' : 'Loading NOAA CPC…', { fill: 'var(--muted)', 'font-size': 11 }); return; }
      const m = { l: 58, r: 34, t: 10, b: 30 }, x = v => m.l + v / 100 * (w - m.l - m.r), rh = (h - m.t - m.b) / hi.items.length;
      [0, 50, 100].forEach(v => { E('line', { x1: x(v), x2: x(v), y1: m.t, y2: h - m.b, stroke: 'var(--line)', 'stroke-width': v ? 0.6 : 1 }, s); T(s, x(v), h - m.b + 12, v + '%', { 'text-anchor': 'middle', 'font-family': 'DM Mono, monospace' }); });
      hi.items.forEach((r, k) => {
        const cy = m.t + rh * (k + 0.5), bh = Math.min(16, rh * 0.55);
        T(s, m.l - 8, cy + 3, r.s, { 'text-anchor': 'end', fill: 'var(--ink)', 'font-size': 10.5 });
        const b = E('rect', { x: x(0), y: cy - bh / 2, width: x(r.v) - x(0), height: bh, rx: 4, fill: 'var(--heat)', 'fill-opacity': r === hi.cur ? 1 : 0.6 }, s);
        T(s, x(r.v) + 6, cy + 3.5, r.v + '%', { fill: 'var(--ink)', 'font-family': 'DM Mono, monospace', 'font-weight': 700 });
        hover(b, `<b>${r.s}</b><br>${esc(hi.text)}`);
      });
      if (hi.label === 'historic') T(s, m.l, h - 4, 'Historic = stronger than any El Niño since 1950', { 'font-size': 9.5 });
    },
  },
  profile: {
    title: 'Agno River profile', unit: 'm, by km from source', live: () => !!LIVE.dams?.ok,
    srcText: () => `River profile from the elevation grid; dam levels from PAGASA, ${fmtDate(damAsOf())}`,
    rows: () => AG.profile.filter((p, i) => i % 8 === 0).map(p => [p[0].toFixed(1), p[1]]), cols: ['km', 'm'],
    draw(plot) {
      const { s, w, h } = svgIn(plot);
      const pr = AG.profile, Lk = pr.at(-1)[0], m = { l: 34, r: 8, t: 10, b: 16 }, x = v => m.l + v / Lk * (w - m.l - m.r), yMax = 2200, y = v => m.t + (1 - v / yMax) * (h - m.t - m.b);
      [0, 1000, 2000].forEach(v => { E('line', { x1: m.l, x2: w - m.r, y1: y(v), y2: y(v), stroke: 'var(--line)', 'stroke-width': v ? 0.6 : 1 }, s); T(s, m.l - 5, y(v) + 3, v.toLocaleString(), { 'text-anchor': 'end', 'font-family': 'DM Mono, monospace' }); });
      [0, 25, 50, 75, 100].forEach(v => T(s, x(v), h - 4, v + ' km', { 'text-anchor': 'middle', 'font-family': 'DM Mono, monospace', 'font-size': 9.5 }));
      E('path', { d: 'M' + x(0) + ',' + y(0) + pr.map(p => 'L' + x(p[0]).toFixed(1) + ',' + y(p[1]).toFixed(1)).join('') + 'L' + x(Lk) + ',' + y(0) + 'Z', fill: 'var(--water)', 'fill-opacity': 0.16 }, s);
      E('path', { d: 'M' + pr.map(p => x(p[0]).toFixed(1) + ',' + y(p[1]).toFixed(1)).join('L'), fill: 'none', stroke: 'var(--water)', 'stroke-width': 1.8 }, s);
      damList().forEach(dm => {
        const km = AG.damProfile[dm.id], xx = x(km);
        E('line', { x1: xx, x2: xx, y1: y(dm.nhwl) - 14, y2: y(0), stroke: 'var(--ink)', 'stroke-width': 1, 'stroke-dasharray': '2 2' }, s);
        E('line', { x1: xx - 14, x2: xx + 2, y1: y(dm.level), y2: y(dm.level), stroke: 'var(--water)', 'stroke-width': 2.4 }, s);
        T(s, xx + (dm.id === 'Binga' ? 4 : -4), y(dm.nhwl) - 17, dm.id, { 'text-anchor': dm.id === 'Binga' ? 'start' : 'end', fill: 'var(--ink)', 'font-weight': 700, 'font-size': 10 });
        const hit = E('rect', { x: xx - 10, y: m.t, width: 20, height: h - m.t - m.b, fill: 'transparent' }, s);
        hover(hit, `<b>${dm.id}</b> · ${km.toFixed(0)} km downstream<br>Level <span class="mono">${dm.level.toFixed(2)} m</span>, normal high water <span class="mono">${dm.nhwl.toFixed(2)} m</span>`);
      });
      const hb = E('rect', { x: m.l, y: m.t, width: w - m.l - m.r, height: h - m.t - m.b, fill: 'transparent' }, s); s.insertBefore(hb, s.firstChild.nextSibling);
      hb.addEventListener('pointermove', ev => { const r = s.getBoundingClientRect(), km = (ev.clientX - r.left - m.l) / (w - m.l - m.r) * Lk; let best = pr[0]; for (const p of pr) if (Math.abs(p[0] - km) < Math.abs(best[0] - km)) best = p; showTip(`<span class="mono">${best[0].toFixed(1)} km · ${best[1].toLocaleString()} m</span>`, ev.clientX, ev.clientY); });
      hb.addEventListener('pointerleave', hideTip);
    },
  },
  dams: {
    title: 'Dam level vs normal high water', unit: () => `m · ${fmtDate(damAsOf())}${damList()[0]?.live ? '' : ' (saved)'}`, live: () => !!damList()[0]?.live,
    srcText: () => `PAGASA Dam Information, ${fmtDate(damAsOf(), true)}, ${fmtTime(damAsOf())}`,
    rows: () => damList().map(d => [d.id, d.level.toFixed(2), d.nhwl.toFixed(2), fmt2(d.dev), d.rule != null ? d.rule.toFixed(2) : '—', d.change24 != null ? fmt2(d.change24) : '—']), cols: ['Dam', 'Level', 'NHWL', 'Diff.', 'Rule curve', '24 h'],
    draw(plot) {
      const { s, w, h } = svgIn(plot), DL = damList();
      const lo = Math.min(-8, ...DL.map(d => d.dev - 1), ...DL.map(d => (d.rdev ?? 0) - 1)), hi = Math.max(3, ...DL.map(d => d.dev + 1));
      const m = { l: 66, r: 44, t: 8, b: 30 }, x = v => m.l + (v - lo) / (hi - lo) * (w - m.l - m.r), rh = (h - m.t - m.b) / DL.length;
      [Math.ceil(lo / 4) * 4, Math.ceil(lo / 8) * 4, 0, Math.floor(hi)].filter((v, i, a) => a.indexOf(v) === i).forEach(v => { E('line', { x1: x(v), x2: x(v), y1: m.t, y2: h - m.b, stroke: v === 0 ? 'var(--ink)' : 'var(--line)', 'stroke-width': v === 0 ? 1.2 : 0.6 }, s); T(s, x(v), h - m.b + 12, (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + ' m', { 'text-anchor': 'middle', 'font-family': 'DM Mono, monospace', 'font-size': 9.5 }); });
      T(s, x(0) + 3, m.t + 8, 'NHWL', { 'font-size': 9, fill: 'var(--ink)', 'font-weight': 700 });
      DL.forEach((d, k) => {
        const cy = m.t + rh * (k + 0.5), bh = Math.min(14, rh * 0.5);
        T(s, m.l - 8, cy + 3, d.id, { 'text-anchor': 'end', fill: 'var(--ink)', 'font-size': 10.5 });
        const x0 = x(Math.min(0, d.dev)), x1 = x(Math.max(0, d.dev));
        const b = E('rect', { x: x0, y: cy - bh / 2, width: Math.max(1, x1 - x0), height: bh, rx: 3, fill: 'var(--water)' }, s);
        if (d.rdev != null) E('line', { x1: x(d.rdev), x2: x(d.rdev), y1: cy - bh / 2 - 4, y2: cy + bh / 2 + 4, stroke: 'var(--amber)', 'stroke-width': 2 }, s);
        T(s, d.dev < 0 ? x0 - 4 : x1 + 4, cy + 3.5, fmt2(d.dev), { 'text-anchor': d.dev < 0 ? 'end' : 'start', fill: 'var(--ink)', 'font-family': 'DM Mono, monospace', 'font-weight': 700, 'font-size': 10 });
        hover(b, `<b>${d.id}</b><br>Level <span class="mono">${d.level.toFixed(2)} m</span> · NHWL <span class="mono">${d.nhwl.toFixed(2)} m</span>${d.rule != null ? `<br>Rule curve <span class="mono">${d.rule.toFixed(2)} m</span>` : ''}${d.change24 != null ? `<br>Last 24 h <span class="mono">${fmt2(d.change24)} m</span>` : ''}`);
      });
      const ly = h - 6; E('rect', { x: m.l, y: ly - 7, width: 10, height: 8, rx: 2, fill: 'var(--water)' }, s); T(s, m.l + 14, ly, 'Level vs normal high water', { 'font-size': 9.5 });
      E('line', { x1: m.l + 150, x2: m.l + 150, y1: ly - 9, y2: ly + 1, stroke: 'var(--amber)', 'stroke-width': 2 }, s); T(s, m.l + 156, ly, 'Rule curve for the date', { 'font-size': 9.5 });
    },
  },
  drydays: {
    title: 'Dry days in Benguet', unit: 'usual → outlook', srcText: () => 'Read from PAGASA’s Oct–Mar outlook maps by BaguioCityGuide (1 Oct 2026)',
    rows: () => Object.entries(D.drydays).map(([k, v]) => { const M = MONTHS[monthIdx(k)]; return [MN[M.m] + ' ' + M.y, v[0], v[1], '+' + (v[1] - v[0])]; }), cols: ['Month', 'Usual', 'Outlook', 'Change'],
    draw(plot) {
      const { s, w, h } = svgIn(plot);
      const keys = Object.keys(D.drydays).filter(k => monthIdx(k) >= 0), m = { l: 28, r: 8, t: 10, b: 30 }, bw = (w - m.l - m.r) / keys.length, y0v = 15, y1v = 30, y = v => m.t + (1 - (v - y0v) / (y1v - y0v)) * (h - m.t - m.b);
      [15, 20, 25, 30].forEach(v => { E('line', { x1: m.l, x2: w - m.r, y1: y(v), y2: y(v), stroke: 'var(--line)', 'stroke-width': 0.6 }, s); T(s, m.l - 5, y(v) + 3, String(v), { 'text-anchor': 'end', 'font-family': 'DM Mono, monospace' }); });
      keys.forEach((k, j) => {
        const v = D.drydays[k], M = MONTHS[monthIdx(k)], cx = m.l + bw * (j + 0.5), sel = M.i === state.month;
        if (sel) E('rect', { x: cx - bw * 0.4, y: m.t, width: bw * 0.8, height: h - m.t - m.b, rx: 4, fill: 'var(--gold)', 'fill-opacity': 0.2 }, s);
        E('line', { x1: cx, x2: cx, y1: y(v[0]), y2: y(v[1]), stroke: 'var(--line-strong)', 'stroke-width': 2 }, s);
        E('circle', { cx, cy: y(v[0]), r: 4, fill: 'var(--panel)', stroke: 'var(--muted)', 'stroke-width': 1.6 }, s);
        E('circle', { cx, cy: y(v[1]), r: 4.6, fill: 'var(--stage2)', stroke: 'var(--panel)', 'stroke-width': 1.4 }, s);
        T(s, cx, y(v[1]) - 8, '+' + (v[1] - v[0]), { 'text-anchor': 'middle', 'font-family': 'DM Mono, monospace', fill: 'var(--ink)', 'font-size': 9.5, 'font-weight': 700 });
        T(s, cx, h - m.b + 12, MN[M.m], { 'text-anchor': 'middle', fill: sel ? 'var(--ink)' : 'var(--muted)', 'font-weight': sel ? 700 : 400 });
        const hit = E('rect', { x: cx - bw / 2, y: m.t, width: bw, height: h - m.t - m.b + 14, fill: 'transparent' }, s);
        hover(hit, `<b>${MF[M.m]} ${M.y}</b><br>Usual <span class="mono">${v[0]}</span> dry days → outlook <span class="mono">${v[1]}</span>`); hit.addEventListener('click', () => setMonth(M.i));
      });
      const ly = h - 6; E('circle', { cx: m.l + 4, cy: ly - 3, r: 3.6, fill: 'var(--panel)', stroke: 'var(--muted)', 'stroke-width': 1.5 }, s); T(s, m.l + 11, ly, 'Usual', { 'font-size': 9.5 });
      E('circle', { cx: m.l + 52, cy: ly - 3, r: 4, fill: 'var(--stage2)' }, s); T(s, m.l + 59, ly, 'Outlook', { 'font-size': 9.5 });
    },
  },
};
const MODE_CHARTS = { outlook: ['nino34', 'rain46', 'nat'], pacific: ['nino34', 'regions', 'hist'], water: ['profile', 'dams', 'drydays'] };
const val = v => (typeof v === 'function' ? v.call(null) : v);
function renderCharts() {
  MODE_CHARTS[state.mode].forEach((id, k) => {
    const host = $('#c' + (k + 1)), C = CHARTS[id], tbl = !!state.table[id];
    const live = C.live ? `${liveTag(C.live())}` : '';
    host.innerHTML = `<div class="chart-h"><h3>${esc(val(C.title))}</h3><span class="unit">${esc(val(C.unit))}</span>${live}<button aria-pressed="${tbl}" data-tbl="${id}">${tbl ? 'Chart' : 'Data'}</button></div><div class="plot"></div><div class="chart-src" title="${esc(val(C.srcText))}">${esc(val(C.srcText))}</div>`;
    const plot = host.querySelector('.plot');
    if (tbl) { const cols = typeof C.cols === 'function' ? C.cols() : C.cols; plot.innerHTML = `<div class="tbl"><table><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${C.rows.call(C).map(r => `<tr>${r.map((v, i) => `<td class="${i ? 'n' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
    else C.draw.call(C, plot);
    host.querySelector('[data-tbl]').addEventListener('click', () => { state.table[id] = !state.table[id]; renderCharts(); });
  });
}

/* ================= timeline ================= */
function buildTimeline() {
  const tr = $('#track'); tr.innerHTML = '';
  const months = document.createElement('div'); months.className = 'months'; months.style.gridTemplateColumns = `repeat(${NM()},1fr)`;
  const strip = document.createElement('div'); strip.className = 'strip'; strip.style.gridTemplateColumns = `repeat(${NM()},1fr)`;
  MONTHS.forEach((M, i) => {
    const l = document.createElement('div'); l.className = 'mlab' + (M.m === 0 || i === 0 ? ' yr' : '') + (i % 2 ? ' odd' : ''); l.textContent = M.m === 0 || i === 0 ? MN[M.m] + ' ' + String(M.y).slice(2) : MN[M.m]; months.appendChild(l);
    const c = document.createElement('div'); c.className = 'cell'; const st = D.stage[M.k];
    if (st) { c.style.background = stageVar(st.s); if (M.phase === 'outlook') c.classList.add('hatch'); }
    else if (M.phase === 'beyond') { c.style.background = 'transparent'; c.style.border = '1px dashed var(--line-strong)'; }
    c.title = `${MF[M.m]} ${M.y}: ${st ? STAGES[st.s].n : M.phase === 'beyond' ? 'beyond the outlook' : 'no dry stage listed'}`; strip.appendChild(c);
  });
  tr.appendChild(months); tr.appendChild(strip);
  const rl = document.createElement('div'); rl.className = 'rail-line'; tr.appendChild(rl);
  EVENTS.forEach((e, k) => { const d = document.createElement('div'); d.className = 'ev' + (e.live ? ' live' : ''); d.style.left = (tFrac(e.d) * 100) + '%'; d.dataset.k = k; d.title = e.label + ': ' + e.t; tr.appendChild(d); });
  const td = document.createElement('div'); td.className = 'today'; td.style.left = (clamp(tFrac(TODAY), 0, 1) * 100) + '%'; td.innerHTML = '<span>Today</span>'; tr.appendChild(td);
  const sel = document.createElement('div'); sel.className = 'sel'; sel.id = 'tlSel'; tr.appendChild(sel);
  const a = monthIdx(D.outlook.from), b = monthIdx(D.outlook.to);
  if (a >= 0 && b >= 0) { const ob = document.createElement('div'); ob.className = 'outlook-band'; ob.style.left = (a / NM() * 100) + '%'; ob.style.width = ((b - a + 1) / NM() * 100) + '%'; ob.innerHTML = `<span>${esc(D.outlook.label)}</span>`; tr.appendChild(ob); }
  $('#track').setAttribute('aria-valuemax', NM() - 1);
}
function bindTimeline() {
  const tr = $('#track');
  const pickM = ev => { const r = tr.getBoundingClientRect(); return clamp(Math.floor((ev.clientX - r.left) / r.width * NM()), 0, NM() - 1); };
  let drag = false;
  tr.addEventListener('pointerdown', ev => { drag = true; try { tr.setPointerCapture(ev.pointerId); } catch (e) { } stopPlay(); setMonth(pickM(ev)); });
  tr.addEventListener('pointermove', ev => { if (drag) setMonth(pickM(ev)); });
  tr.addEventListener('pointerup', () => { drag = false; }); tr.addEventListener('pointercancel', () => { drag = false; });
  tr.addEventListener('keydown', ev => {
    const k = { ArrowRight: Math.min(NM() - 1, state.month + 1), ArrowLeft: Math.max(0, state.month - 1), Home: 0, End: NM() - 1 }[ev.key];
    if (k !== undefined) { stopPlay(); setMonth(k); ev.preventDefault(); }
  });
}
function updateTimeline() {
  const sel = $('#tlSel'); sel.style.left = (state.month / NM() * 100) + '%'; sel.style.width = (100 / NM()) + '%';
  const M = MONTHS[state.month]; $('#track').setAttribute('aria-valuenow', state.month); $('#track').setAttribute('aria-valuetext', MF[M.m] + ' ' + M.y);
  $$('#track .ev').forEach(d => d.classList.toggle('hl', EVENTS[+d.dataset.k]?.mi === state.month));
  $('#tlRead').innerHTML = `<b>${MF[M.m]} ${M.y}</b><span>${PHASE_LABEL[M.phase]}</span>`;
}
function buildEvents() {
  const ul = $('#evlist'); ul.innerHTML = ''; $('#evCount').textContent = EVENTS.length + ' dated';
  EVENTS.forEach((e, k) => {
    const li = document.createElement('li');
    li.innerHTML = `<button data-k="${k}"><span class="d${e.live ? ' live' : ''}" aria-hidden="true"></span><span class="when">${esc(e.label)}</span><span class="what">${esc(e.t)}<small>${esc(SRC[e.s]?.s || '')}${e.live ? ' · live' : ''}</small></span></button>`;
    li.querySelector('button').addEventListener('click', () => { stopPlay(); setMonth(e.mi); });
    ul.appendChild(li);
  });
}
function updateEvents() {
  let first = null;
  $$('#evlist button').forEach(b => { const on = EVENTS[+b.dataset.k].mi === state.month; b.classList.toggle('cur', on); if (on && !first) first = b; });
  if (first) { const ul = $('#evlist'), top = first.offsetTop - ul.offsetTop; if (top < ul.scrollTop || top > ul.scrollTop + ul.clientHeight - 40) ul.scrollTo({ top: Math.max(0, top - 6), behavior: 'smooth' }); }
}

/* ================= overlays ================= */
function nextStageText(i) { for (let j = i + 1; j < NM(); j++) { const st = D.stage[MONTHS[j].k]; if (st && MONTHS[j].phase === 'outlook') return `Next on the outlook: ${STAGES[st.s].n.toLowerCase()} by the end of ${MF[MONTHS[j].m]}.`; } return ''; }
function updateBadge() {
  const M = MONTHS[state.month], st = D.stage[M.k], b = $('#mbadge');
  if (state.mode === 'pacific') {
    const rec = (ninoMap()[M.k] || {}).n34, hi = histInfo();
    b.innerHTML = `<div class="mbadge-h"><b>${MN[M.m]} ${M.y}</b><span class="phase ${M.phase}">${PHASE_LABEL[M.phase]}</span></div>
      <div class="stagepill"><span class="sw" style="background:${rec ? anomColor(rec[0]) : 'transparent'};${rec ? '' : 'border-style:dashed'}"></span>Niño 3.4: ${rec ? `<span class="mono">${fmt1(rec[0])}°C</span>&nbsp;<span style="color:var(--muted);font-weight:400">relative, ${esc(rec[1])}</span>` : M.i >= NOW ? 'not out yet' : 'no value quoted'}</div>
      <small>${M.i >= NOW && hi ? `CPC: ${hi.cur.v}% chance ${hi.label ? 'of a ' + hi.label + ' event ' : ''}in ${hi.cur.s}.` : 'Relative indices as quoted by NOAA CPC; weekly readings where no monthly value was given.'}</small>`;
    return;
  }
  if (state.mode === 'water') {
    const dl = damList(), live = dl[0]?.live;
    b.innerHTML = `<div class="mbadge-h"><b>${fmtDate(dl[0].iso, true)}</b><span class="phase now">${live ? 'Latest reading' : 'Saved reading'}</span></div>
      <div class="stagepill"><span class="sw" style="background:var(--water)"></span>${dl.every(d => d.dev > -3) ? 'Agno dams near normal high water' : 'Agno dams drawing down'}</div>
      <small>${dl.map(d => `${d.id} ${fmt2(d.dev)} m`).join(' · ')} vs normal high water. PAGASA’s outlook puts Benguet in drought by the end of February.</small>`;
    return;
  }
  b.innerHTML = `<div class="mbadge-h"><b>${MN[M.m]} ${M.y}</b><span class="phase ${M.phase}">${PHASE_LABEL[M.phase]}</span></div>
    <div class="stagepill">${st ? `<span class="sw ${M.phase === 'outlook' ? 'hatch' : ''}" style="background-color:${stageVar(st.s)}"></span>Benguet: ${STAGES[st.s].n}` : `<span class="sw none"></span>${M.phase === 'beyond' ? 'Beyond the current outlook' : 'Benguet: no dry stage listed'}`}</div>
    <small>${st && M.phase === 'outlook' ? `PAGASA outlook, issued ${fmtDate(D.outlook.issued)}. Stripes mark forecast months.` : st ? 'PAGASA Baguio, as of May.' : esc(nextStageText(state.month))}</small>`;
}
function updateLegend() {
  const lg = $('#legend');
  if (state.mode === 'pacific') {
    lg.innerHTML = `<div class="eyebrow">Sea-surface anomaly, relative</div>
      <div class="row" style="gap:0">${[0.5, 1.5, 2.5, 3.5].map(v => `<span class="sw" style="border-radius:0;width:26px;background:${anomColor(v)}"></span>`).join('')}</div>
      <div class="row" style="justify-content:space-between;font-family:var(--f-mono);font-size:10px;color:var(--muted)"><span>+0.5</span><span>+4°C</span></div>
      <div class="row"><span class="sw hatch" style="background-color:var(--panel)"></span>No value for this month</div>`;
    return;
  }
  const fires = state.layers.fires && LIVE.fires?.status === 'ok' ? `<div class="row"><span class="firedot"></span>Active fire, past ${LIVE.fires.days} days (${(LIVE.fires.fires || []).length})</div>` : '';
  if (state.layers.rain && LIVE.wx && state.mode !== 'pacific') {
    lg.innerHTML = `<div class="eyebrow">Dry days, last 30 (model)</div>
      <div class="row" style="gap:0">${[4, 13, 19, 24, 29].map(d => `<span class="sw" style="border-radius:0;width:22px;background:rgb(${dryColor(d)})"></span>`).join('')}</div>
      <div class="row" style="justify-content:space-between;font-family:var(--f-mono);font-size:10px;color:var(--muted)"><span>0</span><span>30</span></div>${fires}`;
    return;
  }
  if (state.mode === 'water') {
    lg.innerHTML = `<div class="eyebrow">Water</div>
      <div class="row"><span class="ln" style="background:var(--water);height:4px"></span>Agno River (OpenStreetMap)</div>
      <div class="row"><span class="ln" style="background:#4f95bb;opacity:.8"></span>Rivers and named streams</div>
      <div class="row"><span class="sw" style="background:#78b0cc"></span>Water (ESA WorldCover 2021)</div>${fires}`;
    return;
  }
  lg.innerHTML = `<div class="eyebrow">Benguet dry stage (PAGASA)</div>
    ${[1, 2, 3].map(s => `<div class="row"><span class="sw" style="background:${stageVar(s)}"></span>${STAGES[s].n}</div>`).join('')}
    <div class="row"><span class="sw hatch" style="background-color:var(--stage1)"></span>Stripes: outlook month</div>
    <div class="row"><span class="sw" style="background:linear-gradient(90deg,#a1b06e,#dbc28c)"></span>Ground dries with the stage</div>
    <div class="row"><span class="tree-ico" aria-hidden="true"></span>Trees: ESA WorldCover tree cover</div>${fires}`;
}
function updateTitle() {
  const t = $('#vpTitle');
  if (state.mode === 'pacific') t.innerHTML = '<h2>The tropical Pacific</h2><p>Niño regions, coloured by NOAA CPC relative indices</p>';
  else if (state.mode === 'water') t.innerHTML = '<h2>The Agno, from source to San Roque</h2><p>Live reservoir levels from PAGASA</p>';
  else t.innerHTML = '<h2>Benguet, measured</h2><p>Terrain from SRTM · land cover from ESA WorldCover · roads and rivers from OpenStreetMap</p>';
}
function updateStatus() {
  const H = LIVE.health, keys = ['enso', 'dams', 'wx', 'fires', 'osm', 'terrain', 'cover'];
  const recs = keys.map(k => H[k]).filter(Boolean);
  const good = recs.filter(r => ['ok', 'partial', 'no_key'].includes(r.status)).length;
  const loading = recs.some(r => r.status === 'loading');
  const bad = recs.filter(r => ['error', 'stale'].includes(r.status)).length;
  const cls = loading ? 'load' : bad ? 'warn' : 'ok';
  const checked = recs.map(r => r.checked).filter(Boolean).sort().at(-1);
  const p = LIVE.enso?.pagasa;
  $('#status').innerHTML = `<b>PAGASA: ${esc(pagasaShort())}</b><br><button class="livebtn" id="liveBtn" aria-haspopup="dialog"><span class="ldot ${cls}"></span>${loading ? 'Connecting to live sources…' : `Live · ${good}/${recs.length} sources${checked ? ' · checked ' + fmtTime(checked) : ''}`}</button>${p?.updated ? ` · updated ${fmtDate(p.updated)}` : ''}`;
  $('#liveBtn').addEventListener('click', openDrawer);
  if (!$('#drawer').hidden) renderHealth();
}

/* ================= rail ================= */
function layerRow(key, name, sub, swatch, range, disabled) {
  return `<label class="layer${disabled ? ' dis' : ''}"><input type="checkbox" data-layer="${key}" ${state.layers[key] ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span class="lsw" style="${swatch}"></span><span class="lname">${name}${sub ? `<small>${sub}</small>` : ''}</span>${range || '<span></span>'}</label>`;
}
function renderRail() {
  const M = MONTHS[state.month], st = D.stage[M.k], secs = $('#secs'); let html = '';
  if (state.mode === 'pacific') {
    html += `<div class="sec"><div class="sec-h"><h3>Layers</h3></div>
      ${layerRow('boxes', 'Niño regions', 'Coloured by CPC relative indices', 'background:' + anomColor(2.1))}
      ${layerRow('land', 'Land', 'Natural Earth', 'background:var(--land)')}
      ${layerRow('grat', 'Grid and equator', '', 'background:var(--sea)')}</div>`;
  } else {
    const fs = LIVE.fires?.status, fireSub = fs === 'no_key' ? 'Needs a NASA FIRMS key' : fs === 'ok' ? `${(LIVE.fires.fires || []).length} in the past ${LIVE.fires.days} days` : 'NASA FIRMS';
    html += `<div class="sec"><div class="sec-h"><h3>Layers</h3><span class="eyebrow">Relief <span class="mono" id="relV">${state.layers.relief.toFixed(1)}×</span></span></div>
      ${layerRow('terrain', 'Land cover', 'ESA WorldCover 2021, 10 m', 'background:linear-gradient(90deg,#55733f,#a9b56d,#d8c597)', `<input type="range" id="relief" min="1" max="3" step="0.1" value="${state.layers.relief}" aria-label="Relief exaggeration">`)}
      ${layerRow('trees', 'Trees', 'Where WorldCover maps tree cover', 'background:#2f5531')}
      ${layerRow('stage', 'PAGASA dry stage', 'Province-wide · stripes mark outlook', 'background:var(--stage2)', `<input type="range" id="stageOp" min="0.2" max="1" step="0.05" value="${state.layers.stageOp}" aria-label="Dry-stage opacity">`)}
      ${layerRow('rain', 'Dry days, last 30', 'By town · Open-Meteo models', `background:linear-gradient(90deg,rgb(${dryColor(4)}),rgb(${dryColor(26)}))`, '', !LIVE.wx)}
      ${layerRow('fires', 'Active fires', fireSub, 'background:#e0542e;border-radius:50%', '', fs !== 'ok')}
      ${layerRow('rivers', 'Rivers and reservoirs', 'OpenStreetMap', 'background:var(--water)')}
      ${layerRow('roads', 'Roads', 'OpenStreetMap', 'background:#efe7d6')}
      ${layerRow('contours', 'Contours', 'Every 100 m', 'background:repeating-linear-gradient(0deg,transparent 0 4px,#fff 4px 5px),#9aa88a')}
      ${layerRow('munis', 'Municipal boundaries', 'PSA PSGC 2023', 'background:transparent;border:1.5px dashed var(--muted)')}
      ${layerRow('labels', 'Place labels', '', 'background:var(--panel)')}</div>`;
  }
  // event overview (live)
  const c = LIVE.enso?.cpc, p = LIVE.enso?.pagasa, ro = latestRoni(), hi = histInfo(), nm = ninoMap();
  const lastN34 = Object.keys(nm).sort().reverse().map(k => [k, nm[k].n34]).find(x => x[1] && x[1][1] === 'monthly');
  html += `<div class="sec"><div class="sec-h"><h3>Event overview</h3>${liveTag(!!LIVE.enso)}</div><dl class="kv">
    <dt>PAGASA</dt><dd>${p ? esc(p.text.split(/(?<=\.)\s/)[0]) + ` <span class="dim">${fmtDate(p.updated)}</span>` : 'Strong to very strong El Niño · ' + srcLink('pag_adv5')}</dd>
    <dt>NOAA CPC</dt><dd>${c ? `${esc(c.status || '')} · ${fmtDate(c.issued)}` : srcLink('cpc_oct')}${c?.next ? ` <span class="dim">· next ${fmtDate(c.next)}</span>` : ''}</dd>
    ${lastN34 ? `<dt>Niño 3.4, ${MN[+lastN34[0].slice(5) - 1]}</dt><dd><span class="mono">${fmt1(lastN34[1][0])}°C</span> <span class="dim">relative, monthly</span></dd>` : ''}
    ${ro ? `<dt>RONI, ${ro.season} ${ro.year}</dt><dd><span class="mono">${fmt1(ro.anom)}°C</span> <span class="dim">3-month, official</span></dd>` : ''}
    ${hi ? `<dt>${hi.label === 'historic' ? 'Historic chance' : 'CPC odds'}</dt><dd><span class="mono">${hi.cur.v}%</span> for ${hi.cur.s}</dd>` : ''}
    <dt>Area</dt><dd>Benguet, CAR · 13 municipalities and Baguio City</dd></dl></div>`;
  if (state.mode === 'outlook') {
    const note = D.note[M.k], dd = D.drydays[M.k], rec = (nm[M.k] || {}).n34, RAIN = D.normals.rain, RDAYS = D.normals.rdays;
    html += `<div class="sec"><div class="month-h"><b>${MF[M.m]} ${M.y}</b><span class="phase ${M.phase}">${PHASE_LABEL[M.phase]}</span></div>
      <div class="stagebox"><div class="st">${st ? `<span class="sw ${M.phase === 'outlook' ? 'hatch' : ''}" style="background-color:${stageVar(st.s)}"></span>${STAGES[st.s].n}` : `<span class="sw none"></span>${M.phase === 'beyond' ? 'Beyond the outlook' : 'No dry stage listed'}`}</div>
        <p>${st ? esc(STAGES[st.s].d) : M.phase === 'beyond' ? 'PAGASA’s current outlook covers October 2026 to March 2027.' : 'PAGASA assigns dry stages to whole provinces at the end of each month.'}</p></div>
      ${note ? `<p class="note">${esc(note[0])}</p>` : ''}
      ${st && st.flag ? `<p class="note warn">${esc(st.flag)}</p>` : ''}
      <div class="stats">
        <div class="stat"><div class="k">Usual rain, Baguio</div><div class="v">${RAIN[M.m].toFixed(0)}<small> mm</small></div></div>
        <div class="stat"><div class="k">Usual rainy days</div><div class="v">${RDAYS[M.m]}</div></div>
        <div class="stat"><div class="k">Dry days, Benguet</div><div class="v">${dd ? `${dd[0]}<small> → </small>${dd[1]}` : '—'}</div></div>
        <div class="stat"><div class="k">Temperature, Baguio</div><div class="v" style="font-size:12.5px">${D.temp[M.k] || '—'}</div></div>
        <div class="stat"><div class="k">Cyclones in PAR</div><div class="v">${D.tc[M.k] || '—'}</div></div>
        <div class="stat"><div class="k">Niño 3.4</div><div class="v">${rec ? fmt1(rec[0]) + '<small>°C</small>' : '—'}</div></div>
      </div>
      <div class="src">Stage: ${st ? srcLink(st.src) : '—'} · Notes: ${note ? srcLink(note[1]) : '—'} · Normals: ${srcLink('norm')}${dd || D.temp[M.k] ? ' · Dry days, temperature: ' + srcLink('bcg') : ''}${D.tc[M.k] ? ' · Cyclones: ' + srcLink(M.k === '2026-09' ? 'pag_adv5' : 'pag_out') : ''}</div>
      ${M.phase !== 'outlook' && M.i <= NOW ? `<button class="btn cta" id="playOutlook">Play the outlook, ${MN[+D.outlook.from.slice(5) - 1]} to ${MN[+D.outlook.to.slice(5) - 1]}</button>` : ''}
      ${state.sel ? placeCard() : ''}</div>`;
    html += nowSection();
  } else if (state.mode === 'pacific') {
    const rec = nm[M.k] || {}, wk = (LIVE.enso?.weekly || []).at(-1);
    html += `<div class="sec"><div class="month-h"><b>${MF[M.m]} ${M.y}</b><span class="phase ${M.phase}">${PHASE_LABEL[M.phase]}</span></div>
      <table class="ntable" style="margin-top:10px"><tbody>${[['n12', 'Niño 1+2'], ['n3', 'Niño 3'], ['n34', 'Niño 3.4'], ['n4', 'Niño 4']].map(([id, n]) => { const v = rec[id];
        return `<tr><td style="width:84px;font-weight:${id === 'n34' ? 700 : 400}">${n}</td><td><div class="nbar" style="width:${v ? Math.min(100, v[0] / 4.2 * 100) : 0}%;background:${v ? anomColor(v[0]) : 'transparent'}"></div></td><td style="width:62px">${v ? fmt1(v[0]) + '°C' : '—'}</td></tr>`; }).join('')}</tbody></table>
      <p class="src">${Object.values(rec)[0] ? 'Relative index, ' + esc(Object.values(rec)[0][1]) + ' · ' + srcLink(Object.values(rec)[0][2]) : M.i >= NOW ? 'No monthly value yet for this month.' : 'No CPC value is quoted for this month.'}</p>
      ${wk ? `<div class="stagebox"><div class="st">Latest weekly reading <span class="livetag">Live</span></div><p>Week of ${fmtDate(wk.date, true)}: Niño 3.4 <span class="mono">${fmt1(wk.n34)}°C</span>, Niño 3 <span class="mono">${fmt1(wk.n3)}°C</span>, Niño 1+2 <span class="mono">${fmt1(wk.n12)}°C</span>, Niño 4 <span class="mono">${fmt1(wk.n4)}°C</span>. These are traditional anomalies, which run about 0.7 to 0.9°C above the relative index CPC now uses.</p></div>` : ''}
      <p class="note"><b>The warmth sits in the east.</b> In August, Niño 1+2 off South America read +3.4°C while Niño 4 in the west-central Pacific read +0.1°C. ${srcLink('cpc_sep')}</p>
      <p class="note">El Niño warms the central and eastern Pacific. Storms follow the warm water east, leaving the western Pacific, including Luzon, drier than usual.</p>
      ${c?.synopsis ? `<p class="note"><b>CPC synopsis, ${fmtDate(c.issued)}.</b> ${esc(c.synopsis)}</p>` : ''}
      <div class="stagebox"><div class="st">Strength scale</div><p>Relative Niño 3.4 anomaly: weak +0.5 to +0.9°C, moderate +1.0 to +1.4°C, strong +1.5 to +1.9°C, very strong +2.0°C and above. CPC calls an event historic at a 3-month RONI of +2.5°C or more.</p></div></div>`;
  } else {
    const DL = damList(), live = DL[0]?.live, basin = LIVE.dams?.basin;
    html += `<div class="sec"><div class="sec-h"><h3>Agno reservoirs</h3>${liveTag(live)}<span class="eyebrow">${fmtDate(DL[0].iso)} · ${fmtTime(DL[0].iso)}</span></div>
      ${DL.map(d => { const lo = Math.min(d.rule ?? d.nhwl - 8, d.level) - 3, hi2 = d.nhwl + 3, f = v => clamp((v - lo) / (hi2 - lo) * 100, 0, 100);
        return `<button class="res" data-dam="${d.id}" aria-pressed="${state.dam === d.id}"><div class="res-h"><b>${d.id}</b><span>${esc(d.where)}</span></div>
        <div class="gauge"><div class="fill" style="width:${f(d.level)}%"></div>${d.rule != null ? `<div class="tick rc" style="left:${f(d.rule)}%" title="Rule curve"></div>` : ''}<div class="tick" style="left:${f(d.nhwl)}%" title="Normal high water"></div></div>
        <div class="res-k"><span>${d.rule != null ? 'Rule curve ' + d.rule.toFixed(2) : ''}</span><span>NHWL ${d.nhwl.toFixed(2)}</span></div>
        <div class="res-n"><div>Level<b>${d.level.toFixed(2)} m</b></div><div>vs NHWL<b>${fmt2(d.dev)} m</b></div><div>${d.change24 != null ? 'Last 24 h<b>' + fmt2(d.change24) + ' m</b>' : 'Capacity<b>' + d.mw + ' MW</b>'}</div></div></button>`; }).join('')}
      ${basin ? `<p class="src">Flood status, ${esc(basin.name)}: <b>${esc(basin.status)}</b></p>` : ''}
      <p class="src">${srcLink('pag_dam')} · capacities and locations: ${srcLink('wiki_dams')}</p></div>
      <div class="sec"><div class="sec-h"><h3>Reading the water</h3></div>
      <p class="note" style="margin-top:0">${DL.every(d => d.rdev == null || d.level >= d.rule) ? `As of ${fmtDate(DL[0].iso)}, all three reservoirs sit above their rule curves` : `As of ${fmtDate(DL[0].iso)}, ${DL.filter(d => d.rule != null && d.level < d.rule).map(d => d.id).join(' and ')} sit below the rule curve`}${DL.every(d => d.dev > -3) ? ', at or near normal high water' : ''}. The test is the dry months. Read from PAGASA’s outlook maps, Benguet gets 2 to 5 more dry days than usual each month from October to March.</p></div>`;
  }
  secs.innerHTML = html;
  secs.querySelectorAll('[data-layer]').forEach(cb => cb.addEventListener('change', () => { state.layers[cb.dataset.layer] = cb.checked; applyLayers(); }));
  const rel = $('#relief'); if (rel) rel.addEventListener('input', () => { state.layers.relief = +rel.value; $('#relV').textContent = state.layers.relief.toFixed(1) + '×'; if (G.ok) G.setRelief(state.layers.relief); });
  const so = $('#stageOp'); if (so) so.addEventListener('input', () => { state.layers.stageOp = +so.value; applyStage(); });
  const po = $('#playOutlook'); if (po) po.addEventListener('click', () => { setMonth(monthIdx(D.outlook.from)); startPlay(monthIdx(D.outlook.to)); });
  secs.querySelectorAll('[data-dam]').forEach(b => b.addEventListener('click', () => { state.dam = b.dataset.dam; if (G.ready) { const p = G.damPos(state.dam, 9, AG); G.flyTo(p.pos, p.tgt, 900); } renderRail(); }));
  secs.querySelectorAll('[data-town]').forEach(b => b.addEventListener('click', () => { selectMuni(b.dataset.town); if (G.ready) G.focusMuni(b.dataset.town); }));
  const pc = $('#placeX'); if (pc) pc.addEventListener('click', () => selectMuni(null));
}
function nowSection() {
  const W = LIVE.wx, h = LIVE.health.wx;
  if (!W) return `<div class="sec"><div class="sec-h"><h3>Right now in Benguet</h3></div><p class="src" style="margin:0">${h?.status === 'error' ? 'Town weather could not be loaded: ' + esc(h.error || '') : 'Loading town weather…'}</p></div>`;
  const pv = W.prov, rows = Object.entries(W.by).sort((a, b) => b[1].dry30 - a[1].dry30 || a[1].rain30 - b[1].rain30);
  const mx = Math.max(1, ...rows.map(r => r[1].rain30));
  return `<div class="sec"><div class="sec-h"><h3>Right now in Benguet</h3>${liveTag(true)}<span class="eyebrow">${fmtTime(W.fetched)}</span></div>
    <div class="stats" style="margin-top:0">
      <div class="stat"><div class="k">Rain, last 30 days</div><div class="v">${pv.rain30.toFixed(0)}<small> mm, median town</small></div></div>
      <div class="stat"><div class="k">Dry days, last 30</div><div class="v">${pv.dry30}<small> of 30</small></div></div>
      <div class="stat"><div class="k">Longest dry run now</div><div class="v">${pv.streak}<small> days</small></div></div>
      <div class="stat"><div class="k">Rain, next 16 days</div><div class="v">${pv.fc16.toFixed(0)}<small> mm</small></div></div>
    </div>
    <table class="ntable towns" style="margin-top:10px"><thead><tr><th>Town</th><th>Rain, 30 days</th><th>Dry</th></tr></thead><tbody>
    ${rows.map(([n, v]) => `<tr class="${state.sel === n ? 'on' : ''}"><td><button data-town="${esc(n)}">${esc(n.replace(' City', ''))}</button></td><td><div class="tbar"><span style="width:${Math.max(2, v.rain30 / mx * 100)}%"></span></div><span class="mono">${v.rain30.toFixed(0)}</span></td><td class="mono" style="color:rgb(${dryColor(v.dry30)})">${v.dry30}</td></tr>`).join('')}
    </tbody></table>
    <p class="src">Weather models at each town’s centre point (Open-Meteo), not rain-gauge readings. A dry day has under 1 mm of rain.</p></div>`;
}
function placeCard() {
  const m = B.munis[state.sel]; if (!m) return '';
  const M = MONTHS[state.month], st = D.stage[M.k], v = wxFor(state.sel);
  return `<div class="place"><div class="res-h"><h4>${esc(state.sel)}</h4><button class="btn" id="placeX" style="padding:3px 8px">Clear</button></div>
    <p>${m.area.toLocaleString()} km² · ${state.sel === 'Baguio City' ? 'Independent city' : 'Municipality of Benguet'}</p>
    <div class="elev"><span>Low ${m.elev[0].toLocaleString()} m</span><span>Median ${m.elev[1].toLocaleString()} m</span><span>High ${m.elev[2].toLocaleString()} m</span></div>
    ${v ? `<div class="stats" style="margin-top:8px"><div class="stat"><div class="k">Rain, last 30 days</div><div class="v">${v.rain30.toFixed(0)}<small> mm</small></div></div><div class="stat"><div class="k">Dry days, last 30</div><div class="v">${v.dry30}</div></div><div class="stat"><div class="k">Dry run now</div><div class="v">${v.streak}<small> days</small></div></div><div class="stat"><div class="k">High today</div><div class="v">${v.tmaxToday != null ? v.tmaxToday.toFixed(0) + '<small>°C</small>' : '—'}</div></div></div>` : ''}
    <p>${st ? `PAGASA rates dry stages by province, so Benguet’s ${STAGES[st.s].n.toLowerCase()} applies here too.` : 'PAGASA rates dry stages by province, not by town.'}</p></div>`;
}

/* ================= sources and data health ================= */
function buildSources() {
  const groups = [
    ['El Niño status and Pacific readings', ['cpc_oct', 'cpc_sep', 'cpc_aug', 'cpc_jul', 'cpc_jun', 'pag_adv5', 'pag_mon', 'gma', 'inq']],
    ['Benguet and Cordillera outlook', ['pag_out', 'pia', 'guru', 'bcg', 'norm']],
    ['Water', ['pag_dam', 'wiki_dams']],
    ['Maps', ['dem', 'cover', 'osm', 'psgc', 'ne']],
  ];
  $('#srcBody').innerHTML = `<div class="srcgrp"><h3>Live data health</h3><div id="health"></div></div>` +
    groups.map(([g, ids]) => `<div class="srcgrp"><h3>${esc(g)}</h3><ul>${ids.filter(id => SRC[id]).map(id => `<li><a href="${SRC[id].u}" target="_blank" rel="noopener">${esc(SRC[id].t)}</a></li>`).join('')}</ul></div>`).join('') +
    `<div class="srcgrp"><h3>Method</h3><ul>
      <li>Live feeds: the site’s server reads NOAA CPC, PAGASA and NASA FIRMS and caches each answer (ENSO 6 hours, dams and fires 30 minutes). Town weather comes straight from Open-Meteo. If a feed fails, the page keeps the last good values and says so here.</li>
      <li>Niño 3.4: CPC now leads with relative indices (the Niño anomaly minus the tropical average). RONI is the official 3-month measure. CPC’s weekly OISST file is still traditional, so it reads about 0.7 to 0.9°C higher and is drawn in grey.</li>
      <li>Terrain: Terrarium tiles at zoom 11, resampled onto a 1/1500° grid (about 72 m). Peaks read lower than surveyed heights at this resolution.</li>
      <li>Ground and trees: ESA WorldCover 2021 classes on the same grid. Trees are drawn only where WorldCover maps tree cover, as pines in the 950 to 2,450 m pine belt and as broadleaf below and above it. Tree size is exaggerated so they read at map scale.</li>
      <li>Ground colour shifts from green to tan with PAGASA’s province-wide dry stage. It is a symbol for the stage, not a measurement of vegetation.</li>
      <li>Baguio City boundary: Benguet’s outline minus its 13 municipalities, 57.9 km² against the official 57.5 km².</li>
      <li>Nothing here is a forecast of its own. Every value is quoted or derived from the sources above.</li></ul></div>`;
}
function renderHealth() {
  const el = $('#health'); if (!el) return;
  const H = LIVE.health, label = { ok: 'OK', partial: 'Partly OK', loading: 'Loading', error: 'Failed', stale: 'Stale', no_key: 'Needs key' };
  el.innerHTML = `<table class="health"><thead><tr><th></th><th>Source</th><th>Data as of</th><th>Checked</th></tr></thead><tbody>${Object.entries(SOURCES).map(([k, s]) => { const h = H[k] || {};
    const note = h.status === 'no_key' ? 'Add a free NASA FIRMS MAP_KEY as FIRMS_MAP_KEY in the Vercel project to switch this on.' : h.error ? esc(h.error) : '';
    return `<tr><td><span class="ldot ${h.status === 'ok' ? 'ok' : h.status === 'loading' ? 'load' : h.status === 'no_key' || h.status === 'partial' ? 'key' : 'warn'}" title="${label[h.status] || '—'}"></span></td><td><b>${esc(s.name)}</b><br><span>${esc(s.by)}</span>${note ? `<br><span class="hnote">${note}</span>` : ''}</td><td class="mono">${h.asof ? fmtDate(h.asof, true) : '—'}</td><td class="mono">${h.checked ? ago(h.checked) : label[h.status] || '—'}</td></tr>`; }).join('')}</tbody></table>`;
}
function openDrawer() { const dr = $('#drawer'); dr.hidden = false; renderHealth(); $('#srcClose').focus(); }

/* ================= actions ================= */
function applyStage() {
  if (!G.ready) return;
  const M = MONTHS[state.month], st = D.stage[M.k], on = state.layers.stage && state.mode !== 'pacific' && !!st;
  const amt = on ? state.layers.stageOp * (state.mode === 'water' ? 0.45 : 1) : 0;
  const dry = state.layers.stage && st ? [0, 0.45, 0.72, 1][st.s] : 0.1;
  G.setStage(st ? stageColor(st.s) : null, amt, M.phase === 'outlook', dry);
}
function applyRainTint() {
  if (!G.ready) return;
  if (!(state.layers.rain && LIVE.wx && state.mode !== 'pacific')) { G.setMuniTint({}, 0); return; }
  const cols = {}; for (const [n, v] of Object.entries(LIVE.wx.by)) cols[n] = dryColor(v.dry30);
  G.setMuniTint(cols, 0.72);
}
function applyLive() {
  if (!G.ready) return;
  G.setDamLevels(Object.fromEntries(damList().map(d => [d.id, d.level])), state.mode === 'water');
  G.setFires(LIVE.fires?.status === 'ok' ? LIVE.fires.fires : []);
  if (LIVE.osm?.ok) G.setOSM(LIVE.osm);
  applyRainTint();
}
function applyLayers() { if (G.ok) { G.sync(); applyStage(); applyRainTint(); } updatePac(); updateLegend(); }
let renderedOnce = false;
function setMonth(i) {
  if (i === state.month && renderedOnce) return;
  state.month = i; updateTimeline(); updateBadge(); renderRail(); renderCharts(); updateEvents(); updatePac(); applyStage();
}
function selectMuni(name) { state.sel = name; if (G.ok) G.sync(); renderRail(); if (state.mode === 'outlook') renderCharts(); }
function setMode(m) {
  state.mode = m; $$('.modes button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === m));
  const pac = m === 'pacific';
  $('#pac').toggleAttribute('hidden', !pac); $('#gl').hidden = pac; $('#labels').hidden = pac; $('#vpCtl').hidden = pac;
  if (pac && !P.box && PAC) initPac();
  if (G.ok && !pac) { G.flyPreset(m === 'water' ? 'water' : 'd3', m === 'water' ? 1000 : 900); $('#v3d').setAttribute('aria-pressed', 'true'); $('#v2d').setAttribute('aria-pressed', 'false'); G.dirty = true; }
  state.dam = null; updateTitle(); updateLegend(); updateBadge(); renderRail(); renderCharts(); applyLayers(); applyLive();
}
let playTimer = null, playEnd = null;
function startPlay(end) {
  stopPlay(); state.playing = true; playEnd = end === undefined ? null : end;
  $('#play').innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>'; $('#play').setAttribute('aria-label', 'Pause');
  playTimer = setInterval(() => { if (playEnd !== null && state.month >= playEnd) { stopPlay(); return; } setMonth((state.month + 1) % NM()); }, 1300 / state.speed);
}
function stopPlay() {
  if (playTimer) clearInterval(playTimer); playTimer = null; state.playing = false;
  $('#play').innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"/></svg>'; $('#play').setAttribute('aria-label', 'Play months');
}

/* ================= boot ================= */
let refreshQueued = false;
function refreshAll(rebuildEvents) {
  if (refreshQueued) return; refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    if (rebuildEvents) { buildEventList(); buildTimeline(); buildEvents(); updateTimeline(); updateEvents(); }
    updateBadge(); renderRail(); renderCharts(); updatePac(); updateLegend(); updateStatus(); applyLive();
  });
}
async function boot() {
  [D, B, AG] = await Promise.all([getJSON('/data/outlook.json'), getJSON('/data/boundaries.json'), getJSON('/data/agno.json')]);
  STAGES = D.stages;
  SRC = Object.assign({}, D.src, {
    dem: { t: 'AWS Terrain Tiles (Terrarium, SRTM-derived), zoom 11', u: 'https://registry.opendata.aws/terrain-tiles/', s: 'AWS Terrain Tiles' },
    cover: { t: 'ESA WorldCover 10 m 2021 v200 (CC BY 4.0)', u: 'https://esa-worldcover.org/', s: 'ESA WorldCover' },
    osm: { t: 'OpenStreetMap contributors (ODbL), via Overpass', u: 'https://www.openstreetmap.org/copyright', s: 'OpenStreetMap' },
    psgc: { t: 'PSA PSGC 2023 boundaries via faeldon/philippines-json-maps', u: 'https://github.com/faeldon/philippines-json-maps', s: 'PSA PSGC 2023' },
    ne: { t: 'Natural Earth coastlines via world-atlas', u: 'https://github.com/topojson/world-atlas', s: 'Natural Earth' },
    firms: { t: 'NASA FIRMS active fire data (VIIRS, MODIS)', u: 'https://firms.modaps.eosdis.nasa.gov/', s: 'NASA FIRMS' },
    cpc_live: { t: 'NOAA CPC ENSO Diagnostic Discussion (latest)', u: 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml', s: 'CPC, latest' },
  });
  buildTime(); state.month = NOW;
  buildEventList(); buildTimeline(); bindTimeline(); buildEvents(); buildSources();
  getJSON('/data/pacific.json').then(j => { PAC = j; if (state.mode === 'pacific' && !P.box) { initPac(); updatePac(); } }).catch(() => {});
  setHealth('terrain', { status: 'loading' }); setHealth('cover', { status: 'loading' });
  try {
    G = createMap({
      canvas: $('#gl'), vp: $('#vp'), labelsEl: $('#labels'), msgEl: $('#vpMsg'), state,
      onSelect: selectMuni,
      hoverExtra: name => { const v = wxFor(name); return v ? `Last 30 days: <span class="mono">${v.rain30.toFixed(0)} mm</span>, ${v.dry30} dry days` : ''; },
      onReady: () => { applyStage(); applyLive(); },
    });
    if (TEST) window.__G = G;
    G.load(B, AG).then(() => {
      const now = new Date().toISOString();
      setHealth('terrain', { status: 'ok', checked: now, asof: null });
      setHealth('cover', G.coverOk ? { status: 'ok', checked: now, asof: '2021-12-31' } : { status: 'error', checked: now, error: 'Land cover did not load; the map falls back to an elevation-based guess.' });
    }).catch(e => setHealth('terrain', { status: 'error', checked: new Date().toISOString(), error: String(e.message || e) }));
  } catch (err) {
    $('#gl').hidden = true; const m = $('#vpMsg'); m.hidden = false;
    m.innerHTML = '<div><b>The 3D view needs WebGL and three.js, which didn’t load.</b><br>The timeline, charts and the Pacific map still work.</div>';
    setHealth('terrain', { status: 'error', error: String(err.message || err) });
  }
  updateTitle(); updateLegend();
  setMonth(NOW); renderedOnce = true; applyLayers(); updateStatus();
  $$('.modes button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('#prev').addEventListener('click', () => { stopPlay(); setMonth(Math.max(0, state.month - 1)); });
  $('#next').addEventListener('click', () => { stopPlay(); setMonth(Math.min(NM() - 1, state.month + 1)); });
  $('#play').addEventListener('click', () => { state.playing ? stopPlay() : startPlay(); });
  $('#speed').addEventListener('click', () => { state.speed = state.speed === 1 ? 2 : 1; $('#speed').textContent = state.speed + '×'; if (state.playing) startPlay(playEnd === null ? undefined : playEnd); });
  $('#v3d').addEventListener('click', () => { if (!G.ok) return; $('#v3d').setAttribute('aria-pressed', 'true'); $('#v2d').setAttribute('aria-pressed', 'false'); G.flyPreset(state.mode === 'water' ? 'water' : 'd3', 900); });
  $('#v2d').addEventListener('click', () => { if (!G.ok) return; $('#v2d').setAttribute('aria-pressed', 'true'); $('#v3d').setAttribute('aria-pressed', 'false'); G.flyPreset('top', 900); });
  const zoom = f => { if (!G.ok) return; const c = G.camera, t = G.controls.target, v = c.position.clone().sub(t).multiplyScalar(f), d = v.length(); if (d < G.controls.minDistance || d > G.controls.maxDistance) return; G.flyTo(t.clone().add(v), t.clone(), 350); };
  $('#zin').addEventListener('click', () => zoom(0.7)); $('#zout').addEventListener('click', () => zoom(1.4));
  $('#zreset').addEventListener('click', () => { if (!G.ok) return; $('#v3d').setAttribute('aria-pressed', 'true'); $('#v2d').setAttribute('aria-pressed', 'false'); G.flyPreset(state.mode === 'water' ? 'water' : 'd3', 800); });
  const dr = $('#drawer');
  $('#srcBtn').addEventListener('click', openDrawer);
  $('#srcClose').addEventListener('click', () => { dr.hidden = true; $('#srcBtn').focus(); });
  dr.addEventListener('click', e => { if (e.target === dr) dr.hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !dr.hidden) { dr.hidden = true; $('#srcBtn').focus(); } });
  const reTheme = () => { if (G.ok) G.applyTheme(); updateTimeline(); updateLegend(); updateBadge(); renderRail(); renderCharts(); updatePac(); applyStage(); };
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reTheme); } catch (e) { }
  new MutationObserver(reTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  let rt = 0; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderCharts, 120); });
  onLive(key => {
    if (key === 'health') { updateStatus(); return; }
    if (key === 'osm') { if (G.ok && LIVE.osm?.ok) G.setOSM(LIVE.osm); return; }
    refreshAll(key === 'enso' || key === 'dams' || key === 'fires');
  });
  startLive(Object.entries(B.munis).map(([name, m]) => ({ name, lon: m.label[0], lat: m.label[1] })));
}
boot().catch(err => {
  console.error(err);
  const m = $('#vpMsg'); if (m) { m.hidden = false; m.innerHTML = `<div class="loading"><b>Something went wrong while starting.</b><br><span>${esc(err.message || err)}</span></div>`; }
});
