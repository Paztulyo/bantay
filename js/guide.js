// What to do and who to call: tips keyed to PAGASA's dry stage for the month on screen,
// and a hotline drawer with tap-to-call numbers checked against official sites.
// The rail cards are written in English and translated on the page like everything else (js/i18n.js); the drawer
// writes itself in the chosen language, so search can match and highlight words in that language, and redraws when
// the language changes.
import { $, esc, getJSON, MN, fmtDate } from './util.js';
import { hico } from './icons.js';
import { t, tf, ld, getLang } from './i18n.js';

let G = null; // data/guide.json
let opener = null;

export const guideReady = () => !!G;
export async function loadGuide() {
  if (!G) G = await getJSON('/data/guide.json');
  return G;
}

// "(074) 422-4718 to 22" -> tel:+63744224718, "0927 628 0498" -> tel:+639276280498, "911" -> tel:911
export function telHref(v) {
  const d = String(v).split(' to ')[0].replace(/\D/g, '');
  return d.length <= 4 ? 'tel:' + d : 'tel:+63' + d.replace(/^0/, '');
}

const PHASE_BY_STAGE = [null, 'dry1', 'dry2', 'drought'];
// The stage PAGASA gives the month picks the advice; months outside the outlook are before or after it.
export function phaseFor(k, stageMap, outlook) {
  const st = stageMap[k];
  if (st && PHASE_BY_STAGE[st.s]) return PHASE_BY_STAGE[st.s];
  return k > outlook.to ? 'after' : 'prepare';
}

const ICON = {
  water: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5c3.5 4.2 6 7.4 6 10.5a6 6 0 01-12 0c0-3.1 2.5-6.3 6-10.5z"/></svg>',
  health: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 6v12M6 12h12"/><rect x="3.5" y="3.5" width="17" height="17" rx="5"/></svg>',
  fire: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.4-5.2 3.6-8.3.4 2 1.5 3.2 2.6 3.7.3-2.5 1.5-4.9 3.6-6.7-.2 3.3 3.2 5.5 3.2 10 0 4.5-2.7 7.5-6.5 7.5z"/></svg>',
  farm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21v-9"/><path d="M12 12c0-4 2.8-6.5 7-6.5 0 4-2.8 6.5-7 6.5zM12 14.5c0-3.2-2.3-5.3-5.8-5.3 0 3.2 2.3 5.3 5.8 5.3z"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6.6 3.8l2.6-.3 1.6 4-1.9 1.4a11 11 0 005.4 5.4l1.4-1.9 4 1.6-.3 2.6a2 2 0 01-2 1.8A15.6 15.6 0 014.8 5.8a2 2 0 011.8-2z"/></svg>',
  search: '<svg class="gs-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
export const phoneIcon = ICON.phone;

const srcLinks = ids => [].concat(ids || []).filter(id => G.src[id])
  .map(id => `<a href="${esc(G.src[id].u)}" target="_blank" rel="noopener" title="${esc(G.src[id].t)}">${esc(G.src[id].s)}</a>`).join(' · ');
const cta = () => `<div class="gcta">
    <a class="btn sos" href="tel:911">${ICON.phone}Emergency 911</a>
    <button class="btn" data-guide="hotlines">All hotlines</button>
    <button class="btn" data-guide="tips">More tips</button></div>`;

// Rail card for the Outlook view: three things to do for the month on screen.
export function guideRail(M, NOW, MONTHS, D) {
  if (!G) return '';
  const past = M.i < NOW, ref = past ? MONTHS[NOW] : M;
  const ph = G.phases[phaseFor(ref.k, D.stage, D.outlook)];
  const when = M.i <= NOW ? `Now · ${MN[MONTHS[NOW].m]} ${MONTHS[NOW].y}` : `For ${MN[M.m]} ${M.y}`;
  return `<div class="sec guide" aria-labelledby="gH"><div class="sec-h"><h3 id="gH">${hico('shield')}What to do</h3><span class="eyebrow">${when}</span></div>
    <div class="gphase"><b>${esc(ph.n)}</b><span>${esc(ph.d)}</span></div>
    ${past ? '<p class="src" style="margin:4px 0 0">Showing tips for now. You’re viewing a past month.</p>' : ''}
    <ol class="gtips">${ph.items.map(it => `<li class="c-${it.c}"><span class="gi" aria-hidden="true">${ICON[it.c] || ''}</span><div><b>${esc(it.t)}</b><p>${esc(it.d)}</p><span class="src">${srcLinks(it.src)}</span></div></li>`).join('')}</ol>
    ${cta()}</div>`;
}

// Rail card for the Water view: household water tips.
export function guideWater() {
  if (!G) return '';
  const cat = G.cats.find(c => c.id === 'water');
  return `<div class="sec guide"><div class="sec-h"><h3>${hico('drop', 'water')}Save water at home</h3></div>
    <ul class="glist">${cat.items.slice(0, 5).map(it => `<li><span class="gi c-water" aria-hidden="true">${ICON.water}</span><span>${esc(it.t)}${it.src ? ` <span class="src">${srcLinks(it.src)}</span>` : ''}</span></li>`).join('')}</ul>
    ${cta()}</div>`;
}

/* ---------------- drawer ---------------- */
function numLink(n) {
  return `<a class="hnum" href="${telHref(n.v)}">${n.l ? `<small>${esc(t(n.l))}</small>` : ''}<span class="mono">${esc(ld(n.v))}</span></a>`;
}
/* ---------------- search ---------------- */
// Words people type, mapped to words the entries use, so "ambulance", "sunog" or "brownout" still find the right line.
const SYN = {
  ambulance: ['emergency', 'ems', 'er', '911', 'rescue'], emergency: ['emergency', 'ems', 'er', '911'], rescue: ['disaster', 'emergency', 'red cross'],
  hospital: ['hospital', 'er'], ospital: ['hospital'], doctor: ['hospital', 'health'], clinic: ['hospital', 'health'], sick: ['health', 'hospital'],
  medicine: ['health', 'hospital'], heatstroke: ['health', 'heat'], police: ['911'], pulis: ['911'],
  sunog: ['fire'], bumbero: ['fire'], bfp: ['fire'], flood: ['disaster'], landslide: ['disaster'], typhoon: ['disaster'],
  drrm: ['disaster'], drrmo: ['disaster'], cdrrmo: ['disaster'], mdrrmo: ['disaster'], pdrrmo: ['disaster'],
  tubig: ['water'], leak: ['water', 'leaks'], power: ['beneco', 'power'], electric: ['beneco'], electricity: ['beneco'],
  kuryente: ['beneco'], brownout: ['beneco'], outage: ['beneco'], blood: ['red cross'], redcross: ['red cross'],
  farmer: ['farm', 'agriculturist'], crop: ['farm', 'crop', 'agriculturist'], agri: ['agriculturist', 'farm'],
  // Tagalog and Ilocano
  danum: ['water'], apuy: ['fire'], uram: ['fire'], asuk: ['fire', 'smoke'], usok: ['fire', 'smoke'], koryente: ['beneco'],
  doktor: ['hospital', 'health'], klinika: ['hospital', 'health'], sakit: ['health', 'hospital'], agsakit: ['health', 'hospital'],
  init: ['heat', 'health'], pudot: ['heat', 'health'], ulan: ['water', 'rain'], tudo: ['water', 'rain'],
  magsasaka: ['farm', 'agriculturist'], mannalon: ['farm', 'agriculturist'], tanim: ['farm', 'crop'], mula: ['farm', 'crop'],
  baha: ['disaster'], layus: ['disaster'], bagyo: ['disaster'], kalamidad: ['disaster'], didigra: ['disaster'],
  tulong: ['emergency', 'rescue', 'red cross'], saklolo: ['emergency', 'rescue'], tulongan: ['emergency', 'rescue'],
};
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// each typed word must match: as the start of a word in the entry, through a synonym, or (3+ digits) inside a number
function parseQuery(q) {
  const words = norm(q).split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return null;
  return words.map(w => {
    const alts = new Set([w]);
    for (const [k, v] of Object.entries(SYN)) if (k === w || (w.length >= 3 && k.startsWith(w))) v.forEach(a => alts.add(a));
    return { alts: [...alts], digits: /^\d{3,}$/.test(w) ? w : '' };
  });
}
function hits(Q, text) {
  const s = norm(text), toks = s.split(/[^a-z0-9]+/), dg = s.replace(/\D/g, '');
  return Q.every(({ alts, digits }) => (digits && dg.includes(digits)) || alts.some(a => (a.includes(' ') ? s.includes(a) : toks.some(k => k.startsWith(a)))));
}
// escaped text with the matched words wrapped in <mark>
function hl(text, Q) {
  text = String(text || '');
  const alts = Q ? [...new Set(Q.flatMap(x => x.alts))].filter(a => a.length > 1 && !/^\d+$/.test(a)).sort((a, b) => b.length - a.length) : [];
  if (!alts.length) return esc(text);
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${alts.map(reEsc).join('|')})`, 'giu');
  let out = '', last = 0, m;
  while ((m = re.exec(text))) {
    const s = m.index + m[1].length, e = s + m[2].length;
    out += esc(text.slice(last, s)) + '<mark>' + esc(text.slice(s, e)) + '</mark>'; last = e;
    if (!m[0].length) re.lastIndex++;
  }
  return out + esc(text.slice(last));
}
const noMatch = q => `<div class="gnone"><b>${esc(t('Nothing matches “{q}”.')).replace('{q}', esc(q))}</b><span>${esc(t('Try water, hospital, fire, power or a town name. In an emergency, call'))} <a href="tel:911">911</a>.</span></div>`;

function hotlinesHTML(Q) {
  let n = 0;
  const html = G.hotlines.map(g => {
    const items = g.items.filter(it => !Q || hits(Q, [g.g, it.n, it.note, t(g.g), t(it.n), t(it.note), it.link && G.src[it.link] ? G.src[it.link].s : '', ...it.nums.map(x => `${x.l || ''} ${t(x.l) || ''} ${x.v}`)].join(' ')));
    n += items.length;
    return items.length ? `<div class="hgrp"><h3><span>${hl(t(g.g), Q)}</span></h3><ul class="hl">${items.map(it => `<li>
      <div class="hname"><b>${hl(t(it.n), Q)}</b>${it.note ? `<span>${hl(t(it.note), Q)}</span>` : ''}</div>
      <div class="hnums">${it.nums.map(numLink).join('')}${it.link && G.src[it.link] ? `<a class="btn" href="${esc(G.src[it.link].u)}" target="_blank" rel="noopener">${esc(tf('Open {site} site', { site: G.src[it.link].s }))}</a>` : ''}</div>
      ${it.src ? `<div class="src">${esc(t('Source:'))} ${srcLinks(it.src)}</div>` : ''}</li>`).join('')}</ul></div>` : '';
  }).join('');
  return { html, n };
}
function tipsHTML(phaseId, Q) {
  const ph = G.phases[phaseId];
  let n = 0;
  const cats = G.cats.map(c => {
    const items = c.items.filter(it => !Q || hits(Q, [c.n, it.t, t(c.n), t(it.t)].join(' ')));
    n += items.length;
    return items.length ? `<div class="hgrp"><h3><span class="gi c-${c.id}" aria-hidden="true">${ICON[c.id] || ''}</span><span>${hl(t(c.n), Q)}</span></h3><ul class="glist plain">${items.map(it => `<li>${hl(t(it.t), Q)}${it.src ? ` <span class="src">${srcLinks(it.src)}</span>` : ''}</li>`).join('')}</ul></div>` : '';
  }).join('');
  return { html: `${ph && !Q ? `<div class="gphase now"><b>${esc(tf('Right now: {phase}', { phase: t(ph.n) }))}</b><span>${esc(t(ph.d))}</span></div>` : ''}${cats}`, n };
}
let query = '', sayT = 0;
// redraw both lists for the search, put counts on the tabs, and jump to the tab that has results
function renderLists() {
  const Q = parseQuery(query), H = hotlinesHTML(Q), T = tipsHTML(nowPhase, Q);
  $('#gpanH').innerHTML = H.n || !Q ? H.html : noMatch(query);
  $('#gpanT').innerHTML = T.n || !Q ? T.html : noMatch(query);
  $('#gtabH').innerHTML = esc(t('Hotlines')) + (Q ? ` <span class="gcount">${H.n}</span>` : '');
  $('#gtabT').innerHTML = esc(t('What to do')) + (Q ? ` <span class="gcount">${T.n}</span>` : '');
  const onTips = $('#gtabT').getAttribute('aria-selected') === 'true';
  if (Q && onTips && !T.n && H.n) selectTab('hotlines');
  else if (Q && !onTips && !H.n && T.n) selectTab('tips');
  $('#gqX').hidden = !query;
  // searching from far down the list: bring the first result up to just under the pinned search bar
  const pan = $('#guide .drawer-c'), bar = $('#guide .gbar'), panel = $('#gpanH').hidden ? $('#gpanT') : $('#gpanH');
  if (pan && bar && !$('#guide').hidden) {
    const over = panel.getBoundingClientRect().top - pan.getBoundingClientRect().top - pan.clientTop - bar.offsetHeight;
    if (over < 0) pan.scrollTop += over;
  }
  clearTimeout(sayT);
  const say = getLang() === 'en' ? `${H.n} hotline${H.n === 1 ? '' : 's'} and ${T.n} tip${T.n === 1 ? '' : 's'} match.` : tf('{h} hotlines and {t} tips match.', { h: H.n, t: T.n });
  sayT = setTimeout(() => { $('#gqRes').textContent = !Q ? '' : H.n + T.n ? say : t('No matches.'); }, 400);
}
function setQuery(v) { const qi = $('#gq'); if (qi) qi.value = v; query = v; renderLists(); }

let built = false, inited = false, nowPhase = 'prepare', lastInit = {};
export const guideInited = () => inited;
// Without the outlook (the page failed to start) the tips fall back to "before the dry months".
export function initGuide({ nowKey = '', stageMap = {}, outlook = { to: '9999-12' } } = {}) {
  if (!G) return;
  inited = true; lastInit = { nowKey, stageMap, outlook };
  nowPhase = phaseFor(nowKey, stageMap, outlook);
  const dr = $('#guide');
  if (!dr) return;
  dr.innerHTML = `<div class="drawer-c guide-c">
    <button class="btn drawer-x x-close" id="guideClose">${ICON.x}${esc(t('Close'))}</button>
    <h2 id="guideTitle">${esc(t('Be ready'))}</h2>
    <p>${esc(t(G.naming))} ${esc(tf('Numbers checked against official sites on {date}. Tap a number to call.', { date: ld(fmtDate(G.checked, true)) }))}</p>
    <div class="sosrow">${G.emergency.map(e => `<a class="sosbig${e.v === '911' ? '' : ' alt'}" href="${telHref(e.v)}"><b class="mono">${esc(e.v)}</b><span><strong>${esc(t(e.n))}</strong>${esc(t(e.note))}</span></a>`).join('')}</div>
    <p class="src" style="margin-top:6px">${esc(t('Sources:'))} ${srcLinks(G.emergency.map(e => e.src))}</p>
    <div class="gbar">
      <div class="gsearch" role="search">${ICON.search}<input type="search" id="gq" placeholder="${esc(t('Search hotlines and tips: water, hospital, a town'))}" aria-label="${esc(t('Search hotlines and tips'))}" autocomplete="off" spellcheck="false" enterkeyhint="search"><button type="button" class="gq-x" id="gqX" aria-label="${esc(t('Clear the search'))}" hidden>${ICON.x}</button></div>
      <div class="gtabs" role="tablist" aria-label="${esc(t('Be ready'))}">
        <button role="tab" id="gtabH" aria-controls="gpanH" aria-selected="true">${esc(t('Hotlines'))}</button>
        <button role="tab" id="gtabT" aria-controls="gpanT" aria-selected="false" tabindex="-1">${esc(t('What to do'))}</button>
      </div>
    </div>
    <p class="sr-only" id="gqRes" aria-live="polite"></p>
    <div role="tabpanel" id="gpanH" aria-labelledby="gtabH"></div>
    <div role="tabpanel" id="gpanT" aria-labelledby="gtabT" hidden></div>
    <p class="src gfoot">${esc(t('This site is not an official warning channel. In an emergency, call 911. For official El Niño advisories, see'))} <a href="${esc(G.src.pag_adv5.u)}" target="_blank" rel="noopener">PAGASA</a>.</p>
  </div>`;
  const tabs = [$('#gtabH'), $('#gtabT')];
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(i ? 'tips' : 'hotlines'));
    tab.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault(); const j = 1 - i; selectTab(j ? 'tips' : 'hotlines'); tabs[j].focus();
    });
  });
  $('#guideClose').addEventListener('click', closeGuide);
  query = ''; renderLists();
  const qi = $('#gq');
  qi.addEventListener('input', () => { query = qi.value; renderLists(); });
  // Escape clears the search first; only an empty search lets Escape close the drawer
  qi.addEventListener('keydown', e => { if (e.key === 'Escape' && qi.value) { e.preventDefault(); e.stopPropagation(); setQuery(''); } });
  $('#gqX').addEventListener('click', () => { setQuery(''); qi.focus(); });
  // the search strip only takes a background once the list scrolls under it
  const pan = dr.querySelector('.drawer-c'), bar = dr.querySelector('.gbar');
  pan.addEventListener('scroll', () => {
    const gap = bar.getBoundingClientRect().top - pan.getBoundingClientRect().top - pan.clientTop; // 0 once pinned
    bar.classList.toggle('stuck', pan.scrollTop > 0 && gap < 1);
  }, { passive: true });
  if (!built) {
    dr.addEventListener('click', e => { if (e.target === dr) closeGuide(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !dr.hidden) closeGuide(); });
    built = true;
  }
}
function selectTab(which) {
  const h = which !== 'tips';
  $('#gtabH').setAttribute('aria-selected', h); $('#gtabT').setAttribute('aria-selected', !h);
  $('#gtabH').tabIndex = h ? 0 : -1; $('#gtabT').tabIndex = h ? -1 : 0;
  $('#gpanH').hidden = !h; $('#gpanT').hidden = h;
}
export function openGuide(which = 'hotlines', from = null) {
  const dr = $('#guide'); if (!dr || !G) return;
  opener = from || document.activeElement;
  if (query) setQuery(''); // each visit starts with the full list
  selectTab(which);
  dr.hidden = false;
  dr.querySelector('.drawer-c').scrollTop = 0;
  dr.querySelector('.gbar')?.classList.remove('stuck');
  $('#guideClose').focus();
}
export function closeGuide() {
  const dr = $('#guide'); if (!dr || dr.hidden) return;
  dr.hidden = true;
  if (opener && document.contains(opener)) opener.focus();
  else { const b = $('#guideBtn'); if (b) b.focus(); }
}

// a new language: redraw the drawer in it, keeping the search, the tab, the scroll and the focus
addEventListener('bantay:lang', () => {
  const dr = $('#guide');
  if (!inited || !dr || !dr.querySelector('.drawer-c')) return;
  const q = query, tips = $('#gtabT')?.getAttribute('aria-selected') === 'true', top = dr.querySelector('.drawer-c').scrollTop;
  const focus = document.activeElement && dr.contains(document.activeElement) ? document.activeElement.id : '';
  initGuide(lastInit);
  if (q) setQuery(q);
  selectTab(tips ? 'tips' : 'hotlines');
  dr.querySelector('.drawer-c').scrollTop = top;
  if (focus && !dr.hidden) $('#' + focus)?.focus();
});
