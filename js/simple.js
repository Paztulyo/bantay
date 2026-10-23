// Simple and Detailed views. Simple keeps the map and puts five things beside it: your town, what PAGASA's outlook
// means for it now, the months ahead, three things to do, and help (hotlines, languages, sources). Detailed is the full
// dashboard. The choice is remembered; switching keeps the town, the month, the camera and the language. A link with
// ?view=simple or ?view=detailed wins over the saved choice without replacing it, the way ?lang= does. The inline
// script in index.html sets the view before the first paint. Everything here is written in English and translated on
// the page like the rest of it (js/i18n.js). Simple also carries the Install button (js/pwa.js).
// The outlook figures are app.js's own (data/outlook.json), the actions are guide.js's (data/guide.json).
import { $, esc, MN, MF, fmtDate, TEST } from './util.js';
import { loadGuide, phaseFor, openGuide, phoneIcon } from './guide.js';
import { installState, install } from './pwa.js';

const VIEW_KEY = 'bantay.view', TOWN_KEY = 'bantay.town', HIDE_KEY = 'bantay.installHidden', HIDE_DAYS = 30;
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch { /* private mode */ } },
};
const html = document.documentElement, panel = $('#simple');
const isSimple = () => html.classList.contains('view-simple');
let api = window.bantayApp || null, G = null, prevMode = null, note = '';

const ICON = {
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h10l4 4v12H5z"/><path d="M14 4v5h5M8 13h8M8 17h6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M7 10H6a2 2 0 00-2 2v7a2 2 0 002 2h12a2 2 0 002-2v-7a2 2 0 00-2-2h-1"/></svg>',
};

/* ---------------- the switch ---------------- */
function paintSwitch() {
  const v = isSimple() ? 'simple' : 'detailed';
  document.querySelectorAll('.viewsw [data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
}
function setView(v) {
  store.set(VIEW_KEY, v);
  const u = new URL(location.href); // a shared ?view= link shouldn't override a choice made here
  if (u.searchParams.has('view')) { u.searchParams.delete('view'); history.replaceState(history.state, '', u); }
  const simple = v === 'simple';
  if (simple !== isSimple()) {
    html.classList.toggle('view-simple', simple);
    if (api) {
      // Simple shows Benguet's map: from the Pacific or Water view it switches without moving the camera, and Detailed
      // goes back to the view it had
      if (simple) { api.stopPlay(); if (api.state.mode !== 'outlook') { prevMode = api.state.mode; api.setMode('outlook', false); } render(); }
      else { if (prevMode) { const m = prevMode; prevMode = null; api.setMode(m, false); } api.refresh(); }
    }
    document.dispatchEvent(new CustomEvent('bantay:view', { detail: { view: v } }));
  }
  paintSwitch();
}
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('.viewsw [data-view]'); if (b) setView(b.dataset.view); });
paintSwitch();

/* ---------------- what the panel says ---------------- */
const monthYear = M => `${MF[M.m]} ${M.y}`;
const stageOf = M => api.D.stage[M.k];
const stageName = s => api.STAGES[s].n.toLowerCase();
// the outlook from this month on, in runs of the same stage: Oct · Nov · Dec–Apr
function outlook() {
  const { D, MONTHS, NOW } = api;
  const ahead = MONTHS.filter(M => M.i >= NOW && M.k <= D.outlook.to);
  const runs = [];
  ahead.forEach(M => { const s = stageOf(M)?.s || 0, r = runs.at(-1); if (r && r.s === s) r.to = M; else runs.push({ s, from: M, to: M }); });
  const dry = ahead.filter(M => stageOf(M));
  const extra = dry.map(M => D.drydays[M.k]).filter(Boolean).map(([usual, forecast]) => forecast - usual);
  return { ahead, runs, first: dry[0], last: dry.at(-1), extra, beyond: MONTHS[NOW].k > D.outlook.to };
}
// "What this means": now, the dry period ahead, the extra dry days, and why it reads the same for every town
function summary(o) {
  const { D, MONTHS, NOW, state } = api, st = stageOf(MONTHS[NOW]), out = [];
  if (o.beyond) return ['Beyond the current outlook'];
  out.push(!st ? 'Benguet is not in a dry stage this month.'
    : st.obs ? `PAGASA reports Benguet in ${stageName(st.s)} this month.`
      : `PAGASA’s outlook has Benguet in ${stageName(st.s)} by the end of this month.`);
  const atEnd = o.last && o.last.k === D.outlook.to;
  if (!o.first) out.push(`PAGASA’s outlook lists no dry stage for Benguet through ${MF[+D.outlook.to.slice(5) - 1]} ${D.outlook.to.slice(0, 4)}.`);
  else if (o.first.i > NOW) out.push(atEnd ? `PAGASA projects a dry period from ${monthYear(o.first)} to at least ${monthYear(o.last)}, where its outlook ends.` : `PAGASA projects a dry period from ${monthYear(o.first)} to ${monthYear(o.last)}.`);
  else if (o.last.i > NOW) out.push(atEnd ? `PAGASA projects the dry period to last until at least ${monthYear(o.last)}, where its outlook ends.` : `PAGASA projects the dry period to last until ${monthYear(o.last)}.`);
  if (o.extra.length) {
    const a = Math.max(0, Math.min(...o.extra)), b = Math.max(...o.extra);
    if (b > 0) out.push(a === b ? `Expect ${b} more dry days than usual each month.` : `Expect ${a} to ${b} more dry days than usual each month.`);
  }
  if (state.sel) out.push(st ? `PAGASA rates dry stages by province, so Benguet’s ${stageName(st.s)} applies here too.` : 'PAGASA rates dry stages by province, not by town.');
  return out;
}
function source() {
  const { D, SRC } = api, s = SRC[D.outlook.src];
  const name = s ? s.s.replace(/,\s*\d.*$/, '') : 'PAGASA Climate Outlook';
  return `${s ? `<a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(name)}</a>` : esc(name)} <span aria-hidden="true">·</span> <span>issued ${esc(fmtDate(D.outlook.issued, true))}</span>`;
}

/* ---------------- drawing ---------------- */
function installHTML() {
  const st = installState();
  if (st === 'installed' || st === 'none' || +store.get(HIDE_KEY) > Date.now()) return '';
  const say = { ios: `${ICON.share}<span>Tap Share, then Add to Home Screen, then Open as Web App.</span>`, inapp: '<span>To install, open this page in Chrome or Safari first.</span>', menu: '<span>Use your browser’s menu: Install app.</span>' }[note];
  return `<div class="s-install" id="sInstall">
      <img src="/img/icon-192.png" alt="" width="40" height="40">
      <div class="s-inst-t"><button type="button" class="s-inst-b" id="sInstallBtn" aria-expanded="${!!say}">Install Bantay El Niño</button><span>Open it from your home screen, like an app.</span></div>
      <button type="button" class="s-inst-x" id="sInstallX" aria-label="Hide" title="Hide">${ICON.x}</button>
      ${say ? `<p class="s-inst-n" role="status">${say}</p>` : ''}
    </div>`;
}
function areaHTML(o) {
  const { B, MONTHS, NOW, STAGES, state } = api, now = MONTHS[NOW], st = stageOf(now);
  const towns = Object.keys(B.munis), list = ['Baguio City', ...towns.filter(n => n !== 'Baguio City').sort()];
  const label = st ? STAGES[st.s].n : o.beyond ? 'Beyond the current outlook' : 'No dry stage yet';
  return `<section class="s-card s-area" aria-labelledby="sAreaH">
      <label class="s-label" for="sTown">Your area</label>
      <div class="s-select"><select id="sTown">
        <option value=""${state.sel ? '' : ' selected'}>All of Benguet</option>
        ${list.map(n => `<option value="${esc(n)}"${state.sel === n ? ' selected' : ''}>${esc(n)}</option>`).join('')}
      </select>${ICON.chev}</div>
      <h2 class="s-h" id="sAreaH">What this means for ${esc(state.sel || 'Benguet')}</h2>
      <div class="s-now"><span class="sw s-sw${st ? '' : ' none'}${st && now.phase === 'outlook' ? ' hatch' : ''}"${st ? ` style="background-color:var(--stage${st.s})"` : ''}></span><b>${esc(label)}</b><span>Now · ${esc(monthYear(now))}</span></div>
      <p class="s-sum">${summary(o).map(t => `<span>${esc(t)}</span>`).join(' ')}</p>
      <p class="s-src"><span>Source:</span> ${source()}</p>
    </section>`;
}
function outlookHTML(o) {
  const { D, NOW, STAGES, state } = api;
  if (o.beyond) return '';
  const rows = o.runs.map(r => {
    const on = state.month >= r.from.i && state.month <= r.to.i, lab = `${MN[r.from.m]}${r.to !== r.from ? '–' + MN[r.to.m] : ''}`;
    return `<li><button type="button" id="sRun${r.from.i}" data-m="${r.from.i}" aria-pressed="${on}">
        <span class="sw s-sw${r.s ? '' : ' none'}${r.s && r.from.phase === 'outlook' ? ' hatch' : ''}"${r.s ? ` style="background-color:var(--stage${r.s})"` : ''}></span>
        <span class="s-m">${esc(lab)}</span><span class="s-st">${esc(r.s ? STAGES[r.s].n : r.from.i === NOW ? 'No dry stage yet' : 'No dry stage listed')}</span>${r.from.i === NOW ? '<span class="s-nowtag">Now</span>' : ''}</button></li>`;
  }).join('');
  return `<section class="s-card s-out" aria-labelledby="sOutH">
      <h2 class="s-h" id="sOutH">Outlook for the coming months</h2>
      ${o.first ? `<p class="s-period"><span>Projected dry period</span><b>${esc(monthYear(o.first))} – ${esc(monthYear(o.last))}</b></p>` : ''}
      <ul class="s-runs">${rows}</ul>
      <p class="s-hint">Tap a month to see it on the map.</p>
      <p class="s-src">${source()} <span>· revised monthly</span></p>
      <p class="s-fine"><span>PAGASA’s current outlook covers ${esc(MF[+D.outlook.from.slice(5) - 1])} ${D.outlook.from.slice(0, 4)} to ${esc(MF[+D.outlook.to.slice(5) - 1])} ${D.outlook.to.slice(0, 4)}.</span> <span>An outlook is a forecast. It can change when PAGASA updates it.</span></p>
    </section>`;
}
function doHTML() {
  if (!G) return '';
  const { D, MONTHS, NOW } = api, ph = G.phases[phaseFor(MONTHS[NOW].k, D.stage, D.outlook)];
  if (!ph) return '';
  return `<section class="s-card s-do" aria-labelledby="sDoH">
      <h2 class="s-h" id="sDoH">What you can do right now</h2>
      <p class="s-phase">${esc(ph.n)}</p>
      <ol class="s-acts">${ph.items.slice(0, 3).map((it, i) => `<li><span class="s-n" aria-hidden="true">${i + 1}</span><div><b>${esc(it.t)}</b><p>${esc(it.d)}</p></div></li>`).join('')}</ol>
      <button type="button" class="s-more" id="sMore"><span>See more</span>${ICON.arrow}</button>
    </section>`;
}
function helpHTML() {
  const e = G && G.emergency.find(x => x.v === '911'), pag = G && G.src.pag_adv5;
  return `<section class="s-card s-help" aria-labelledby="sHelpH">
      <h2 class="s-h" id="sHelpH">Get help</h2>
      <a class="s-sos" href="tel:911">${phoneIcon}<span><b>Emergency 911</b>${e ? `<small>${esc(e.note)}</small>` : ''}</span></a>
      <div class="s-btns">
        <button type="button" class="s-btn" id="sHot">${phoneIcon}<span>All hotlines</span></button>
        <button type="button" class="s-btn" id="sSrc">${ICON.doc}<span>Sources</span></button>
      </div>
      <div class="s-langrow" data-i18n-skip><span id="sLangL">Language · Wika · Pagsasao</span>
        <div class="lang" role="group" aria-labelledby="sLangL">
          <button type="button" data-lang="en" lang="en" aria-label="English" aria-pressed="${html.lang === 'en'}">EN</button>
          <button type="button" data-lang="tl" lang="tl" aria-label="Tagalog" aria-pressed="${html.lang === 'tl'}">TL</button>
          <button type="button" data-lang="ilo" lang="ilo" aria-label="Ilokano" aria-pressed="${html.lang === 'ilo'}">ILO</button>
        </div></div>
      ${pag ? `<p class="s-fine">This site is not an official warning channel. In an emergency, call 911. For official El Niño advisories, see <a href="${esc(pag.u)}" target="_blank" rel="noopener">PAGASA</a>.</p>` : ''}
    </section>`;
}
function render() {
  if (!api || !panel || !isSimple()) return;
  const focus = document.activeElement && panel.contains(document.activeElement) ? document.activeElement.id : '';
  const o = outlook();
  panel.innerHTML = installHTML() + areaHTML(o) + outlookHTML(o) + doHTML() + helpHTML();
  panel.querySelector('#sTown').addEventListener('change', e => api.selectTown(e.target.value || null, true));
  panel.querySelectorAll('.s-runs [data-m]').forEach(b => b.addEventListener('click', () => api.setMonth(+b.dataset.m)));
  panel.querySelector('#sMore')?.addEventListener('click', e => openGuide('tips', e.currentTarget));
  panel.querySelector('#sHot').addEventListener('click', e => openGuide('hotlines', e.currentTarget));
  panel.querySelector('#sSrc').addEventListener('click', () => api.openSources());
  panel.querySelector('#sInstallBtn')?.addEventListener('click', async () => {
    const st = installState();
    note = st === 'ios' || st === 'inapp' ? st : '';
    if (st === 'prompt') { const r = await install(); if (r === 'unavailable') note = 'menu'; }
    else if (!note) note = 'menu';
    render();
  });
  panel.querySelector('#sInstallX')?.addEventListener('click', () => { store.set(HIDE_KEY, Date.now() + HIDE_DAYS * 864e5); render(); panel.querySelector('#sTown')?.focus(); });
  if (focus) panel.querySelector('#' + focus)?.focus();
}

/* ---------------- wiring ---------------- */
function init(a) {
  api = a;
  // the town picked last time, unless the page already has one
  const t = store.get(TOWN_KEY);
  if (t && api.B.munis[t] && !api.state.sel) api.selectTown(t, false);
  if (isSimple() && api.state.mode !== 'outlook') { prevMode = api.state.mode; api.setMode('outlook', false); }
  render();
}
if (api) init(api); else document.addEventListener('bantay:ready', e => init(e.detail), { once: true });
document.addEventListener('bantay:select', e => { store.set(TOWN_KEY, e.detail?.town || null); render(); });
document.addEventListener('bantay:month', render);
document.addEventListener('bantay:install', render);
loadGuide().then(g => { G = g; render(); }).catch(() => { /* the hotline drawer says so; the rest still works */ });
if (TEST) window.__simple = { setView, render, get prevMode() { return prevMode; } };
