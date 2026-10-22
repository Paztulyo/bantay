// Language: English, Tagalog or Ilocano. The site is written in English, and in Tagalog or Ilocano this module translates
// the page as it appears, from the dictionaries in js/lang/. It never touches the app's code: it watches the page and
// swaps each piece of text (and each label for screen readers) for its translation, keeping the English to switch back
// to. Names of agencies, towns and sources, numbers, and quoted text stay as they are; anything without a translation
// stays in English. The choice is remembered; a first visit follows the phone's language.
// guide.js renders its own drawer in the chosen language with t() and redraws on the 'bantay:lang' event.
export const LANGS = [
  { id: 'en', short: 'EN', name: 'English' },
  { id: 'tl', short: 'TL', name: 'Tagalog' },
  { id: 'ilo', short: 'ILO', name: 'Ilokano' },
];
const KEY = 'bantay.lang';
const SKIP = '#guide, script, style, svg defs, [data-i18n-skip]';
const ATTRS = ['aria-label', 'title', 'placeholder', 'alt', 'aria-valuetext'];
const has = id => LANGS.some(l => l.id === id);

// a link with ?lang= wins (for sharing), then the saved choice, then the phone's first language
function firstLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (has(q)) return q;
  try { const s = localStorage.getItem(KEY); if (has(s)) return s; } catch { /* storage blocked */ }
  const n = String((navigator.languages || [])[0] || navigator.language || '').toLowerCase();
  return /^(fil|tl)/.test(n) ? 'tl' : /^ilo/.test(n) ? 'ilo' : 'en';
}

let lang = firstLang(), dict = null;
export const getLang = () => lang;

/* ---------------- translating a string ---------------- */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const M3 = MON.join('|'), MF = MONTH.join('|');
const RE_DM = new RegExp(`\\b(\\d{1,2}) (${M3})\\b`, 'g'); // 21 Oct
const RE_MY = new RegExp(`\\b(${M3}) (\\d{4}|\\d{2})\\b`, 'g'); // Oct 2026, Mar 26
const RE_MM = new RegExp(`\\b(${M3})–(${M3})\\b`, 'g'); // Oct–Dec
const RE_FY = new RegExp(`\\b(${MF}) (\\d{4})\\b`, 'g'); // October 2026
const RE_WD = new RegExp(`\\b(${DY.join('|')}) (\\d{1,2})\\b`, 'g'); // Thu 22
const mon = m => dict.mon[MON.indexOf(m)];
// month and weekday names inside dates, wherever they sit in a string
export function ld(s) {
  if (!dict || !s) return s;
  return s.replace(RE_FY, (_, m, y) => `${dict.months[MONTH.indexOf(m)]} ${y}`)
    .replace(RE_MM, (_, a, b) => `${mon(a)}–${mon(b)}`)
    .replace(RE_DM, (_, d, m) => `${d} ${mon(m)}`)
    .replace(RE_MY, (_, m, y) => `${mon(m)} ${y}`)
    .replace(RE_WD, (_, w, d) => `${dict.dy[DY.indexOf(w)]} ${d}`);
}
// a captured piece of a pattern, translated like a whole string (a phrase, or a pattern of its own), else given its
// dates in the language. Each capture is shorter than its string, and depth caps it anyway.
let depth = 0;
const piece = s => {
  const k = (s || '').trim();
  if (!k) return s || '';
  let r = null;
  if (depth < 4) { depth++; try { r = translate(k); } finally { depth--; } }
  return r == null ? ld(s) : s.replace(k, r);
};
// English prose: a quote, a headline, a source's title. With nothing to translate it, it stays exactly as written,
// dates included, rather than half-translated; a bare date or a name with a date gets the language's months.
const PROSE = /\b[a-z]{3,}\b/;
const cache = new Map();
function translate(raw) {
  const key = raw.replace(/\s+/g, ' ').trim();
  if (!key || !/[A-Za-z]/.test(key)) return null;
  if (cache.has(key)) return cache.get(key);
  let out = dict.phrases[key];
  if (out == null) {
    for (const [re, rep] of dict.patterns) {
      const m = key.match(re);
      if (m) { out = typeof rep === 'function' ? rep(m, piece) : rep.replace(/\$(\d)/g, (_, i) => piece(m[+i])); break; }
    }
  }
  out = out == null ? (PROSE.test(key) ? key : ld(key)) : ld(out);
  if (out === key) out = null;
  cache.set(key, out);
  return out;
}
// for code that writes its own text (guide.js): the string in the chosen language, or as it is
export function t(s) { if (!dict || s == null) return s; const r = translate(String(s)); return r == null ? String(s) : r; }
// a string with {placeholders}: translate the frame, then fill it in
export function tf(frame, vars = {}) { return t(frame).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')); }

/* ---------------- translating the page ---------------- */
const enText = new WeakMap(), ours = new WeakMap(); // text node -> its English; -> what we last wrote into it
const enAttr = new WeakMap(), oursAttr = new WeakMap(); // element -> {attribute: English}; -> {attribute: ours}
function inLang(en) {
  if (!dict) return en;
  const r = translate(en);
  return r == null ? en : en.match(/^\s*/)[0] + r + en.match(/\s*$/)[0];
}
function doText(n) {
  const cur = n.nodeValue, en = ours.get(n) === cur && enText.has(n) ? enText.get(n) : cur; // otherwise the app rewrote it
  enText.set(n, en);
  const out = inLang(en);
  if (out !== cur) n.nodeValue = out;
  ours.set(n, out);
}
function doAttr(el, a) {
  const cur = el.getAttribute(a);
  if (cur == null) return;
  const e = enAttr.get(el) || {}, o = oursAttr.get(el) || {};
  const en = o[a] === cur && a in e ? e[a] : cur;
  e[a] = en; enAttr.set(el, e);
  const out = inLang(en);
  if (out !== cur) el.setAttribute(a, out);
  o[a] = out; oursAttr.set(el, o);
}
const skip = el => !el || !!el.closest(SKIP);
function walk(root) {
  if (root.nodeType === 3) { if (!skip(root.parentElement)) doText(root); return; }
  if (root.nodeType !== 1 || skip(root)) return;
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    { acceptNode: n => (n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  for (let n = root; n; n = tw.nextNode()) {
    if (n.nodeType === 3) { if (/[A-Za-z]/.test(n.nodeValue) || enText.has(n)) doText(n); }
    else for (const a of ATTRS) if (n.hasAttribute(a)) doAttr(n, a);
  }
}
const mo = new MutationObserver(recs => {
  for (const r of recs) {
    if (r.type === 'childList') r.addedNodes.forEach(walk);
    else if (r.type === 'characterData') { if (!skip(r.target.parentElement)) doText(r.target); }
    else if (!skip(r.target)) doAttr(r.target, r.attributeName);
  }
});
const watch = on => on
  ? mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS })
  : mo.disconnect();

/* ---------------- the switch ---------------- */
async function load(id) {
  if (id === 'en') return null;
  const m = await import(`./lang/${id}.js`);
  return m.default;
}
function paintSwitch() {
  document.querySelectorAll('.lang [data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
}
let pending = 0, target = lang; // target: the language last asked for, which may still be loading
export async function setLang(id, save = true) {
  if (!has(id)) return;
  target = id;
  const mine = ++pending; // two quick taps: the last one wins, whichever dictionary arrives first
  let d = null;
  try { d = await load(id); } catch (e) { console.warn('[i18n] could not load', id, e); id = 'en'; }
  if (mine !== pending) return;
  lang = target = id; dict = d; cache.clear(); // id is 'en' here if the dictionary failed to load
  document.documentElement.lang = id;
  if (save) {
    try { localStorage.setItem(KEY, id); } catch { /* private mode */ }
    const u = new URL(location.href); // a shared ?lang= link shouldn't override a choice made here
    if (u.searchParams.has('lang')) { u.searchParams.delete('lang'); history.replaceState(history.state, '', u); }
  }
  watch(false);
  walk(document.body);
  if (dict) watch(true);
  paintSwitch();
  document.documentElement.classList.remove('i18n-wait');
  dispatchEvent(new CustomEvent('bantay:lang', { detail: id }));
}

document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('.lang [data-lang]');
  if (b && b.dataset.lang !== target) setLang(b.dataset.lang);
});
paintSwitch();
if (lang !== 'en') setLang(lang, false);
else document.documentElement.classList.remove('i18n-wait');
