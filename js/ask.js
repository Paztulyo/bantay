// Ask: questions about El Niño in Benguet and Baguio, answered from this site's data by /api/ask (Claude Haiku
// through Vercel AI Gateway). It is the third tab of the Be ready drawer, shown only once /api/ask says it's ready.
// Phone numbers never come from the AI: an answer names hotlines by id, and this module shows those entries from
// data/guide.json with tap-to-call links, the same as the Hotlines tab. The newest answer sits right under the
// question box, so it stays in view above a phone's keyboard. The conversation lives in memory for this page load;
// the last three turns go with each question as context.
// guide.js writes the drawer in the chosen language and calls mountAsk() each time it does.
import { esc } from './util.js';
import { t, tf, getLang } from './i18n.js';

const MAX = 400, HIST = 3;
const SUGGEST = ['When will Benguet be in drought?', 'Who do I call about a grass fire?', 'How can I save water at home?', 'Will it rain in Baguio this week?'];
const ERR = {
  limit: 'That’s a lot of questions from this connection. Try again in a few minutes. The Hotlines and What to do tabs still work.',
  busy: 'No answer came back just now. Try again in a minute.',
  unavailable: 'Questions are off right now. The Hotlines and What to do tabs still work.',
  offline: 'You’re offline. Check your connection and try again.',
  long: 'Keep it under 400 characters.',
};
const RETRY = new Set(['busy', 'offline']);
const SEND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';

const S = { turns: [], draft: '', busy: false }; // turn: { q, status: 'wait'|'ok'|'err', answer, hotlines, emergency, reason }
let ctx = null, root = null; // ctx from guide.js: { G, itemHTML }

/* ---------------- is it on? ---------------- */
let readyP = null;
export function askReady() {
  if (!readyP) {
    readyP = fetch('/api/ask', { headers: { Accept: 'application/json' } })
      .then(r => (r.ok ? r.json() : null)).then(j => !!(j && j.ready)).catch(() => false)
      .then(ok => { document.documentElement.classList.toggle('ask-ready', ok); return ok; });
  }
  return readyP;
}
askReady();

/* ---------------- hotlines by id, numbered the way api/ask.js numbers them ---------------- */
function hotline(id) {
  const G = ctx && ctx.G;
  if (!G) return null;
  if (id[0] === 'e') { const e = G.emergency[+id.slice(1)]; return e ? { it: { n: e.n, note: e.note, nums: [{ v: e.v }], src: e.src }, area: '' } : null; }
  let k = +id.slice(1);
  for (const g of G.hotlines) { if (k < g.items.length) return { it: g.items[k], area: g.g }; k -= g.items.length; }
  return null;
}

/* ---------------- drawing ---------------- */
function sosHTML() {
  const e = ctx.G.emergency.find(x => x.v === '911') || { v: '911', n: 'Emergency', note: '' };
  return `<a class="sosbig ask-sos" href="tel:911"><b class="mono">911</b><span><strong>${esc(t(e.n))}</strong>${esc(t(e.note))}</span></a>`;
}
function answerHTML(x) {
  if (x.status === 'wait') return `<div class="ask-a ask-wait"><span class="ask-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${esc(t('Reading the site’s data…'))}</span></div>`;
  if (x.status === 'err') {
    return `<div class="ask-a err"><p>${esc(t(ERR[x.reason] || ERR.busy))}</p>${RETRY.has(x.reason) ? `<button type="button" class="btn ask-retry">${esc(t('Try again'))}</button>` : ''}</div>`;
  }
  const ids = (x.hotlines || []).filter(id => !(x.emergency && id === 'e0'));
  const items = ids.map(hotline).filter(Boolean).map(({ it, area }) => ctx.itemHTML(it, area)).join('');
  return `<div class="ask-a"><span class="sr-only">${esc(t('Answer:'))}</span>${x.emergency ? sosHTML() : ''}<p class="ask-text">${esc(x.answer)}</p>`
    + `${items ? `<div class="ask-hot"><span class="eyebrow">${esc(t('Numbers from the checked hotline list'))}</span><ul class="hl">${items}</ul></div>` : ''}</div>`;
}
function drawLog() {
  if (!root) return;
  const log = root.querySelector('#askLog');
  log.innerHTML = S.turns.map((x, i) => `<article class="ask-turn" data-i="${i}"><p class="ask-q"><span class="sr-only">${esc(t('You asked:'))} </span>${esc(x.q)}</p>${answerHTML(x)}</article>`).reverse().join('');
  root.querySelector('#askSugg').hidden = S.turns.length > 0;
  root.querySelector('#askNew').hidden = !S.turns.length || S.busy;
  root.querySelectorAll('#askSugg button, .ask-send').forEach(b => { b.disabled = S.busy; });
}
// screen readers hear the new answer (or what went wrong) once, not the whole log again
function say(x) {
  const el = root && root.querySelector('#askSay');
  if (el) el.textContent = x.status === 'wait' ? t('Reading the site’s data…') : x.status === 'err' ? t(ERR[x.reason] || ERR.busy) : `${t('Answer:')} ${x.answer}`;
}
function drawLeft() {
  const left = MAX - S.draft.length, el = root && root.querySelector('#askLeft');
  if (el) el.textContent = left <= 80 ? tf('{n} characters left', { n: left }) : '';
}
function fit(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 160) + 'px'; }

// guide.js calls this with the Ask panel each time it draws the drawer
export function mountAsk(el, c) {
  ctx = c; root = el;
  if (!el) return;
  el.innerHTML = `<div class="ask">
    <p class="ask-intro">${esc(t('Ask in English, Tagalog or Ilocano about El Niño in Benguet and Baguio: the dry months ahead, water, fires, farms, the heat, or who to call. Answers come from this site’s data.'))}</p>
    <form class="ask-form" id="askForm" novalidate>
      <label class="sr-only" for="askQ">${esc(t('Your question'))}</label>
      <textarea id="askQ" rows="1" maxlength="${MAX}" placeholder="${esc(t('Type your question'))}" enterkeyhint="send" autocomplete="off"></textarea>
      <button type="submit" class="btn ask-send">${SEND_ICON}<span>${esc(t('Send'))}</span></button>
    </form>
    <div class="ask-meta"><span id="askLeft" aria-live="polite"></span><button type="button" class="ask-new" id="askNew" hidden>${esc(t('Start over'))}</button></div>
    <div class="ask-sugg" id="askSugg">${SUGGEST.map(s => `<button type="button" data-q="${esc(s)}">${esc(t(s))}</button>`).join('')}</div>
    <p class="sr-only" id="askSay" aria-live="polite"></p>
    <section class="ask-log" id="askLog" aria-label="${esc(t('Answers'))}"></section>
    <p class="src ask-note">${esc(t('Claude, an AI made by Anthropic, writes these answers from this site’s data, and it can be wrong. Phone numbers come only from the checked hotline list. Your question goes to Anthropic through Vercel to write the answer, and this site doesn’t keep it. In an emergency, call 911.'))}</p>
  </div>`;
  const ta = el.querySelector('#askQ');
  ta.value = S.draft; fit(ta); drawLeft(); drawLog();
  ta.addEventListener('input', () => { S.draft = ta.value; fit(ta); drawLeft(); });
  ta.addEventListener('keydown', e => { // Enter sends, Shift+Enter starts a new line
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(ta.value); }
  });
  el.querySelector('#askForm').addEventListener('submit', e => { e.preventDefault(); send(ta.value); });
  el.querySelector('#askSugg').addEventListener('click', e => { const b = e.target.closest('button[data-q]'); if (b) send(t(b.dataset.q), { chip: true }); });
  el.querySelector('#askNew').addEventListener('click', () => { if (S.busy) return; S.turns = []; drawLog(); ta.focus(); });
  el.querySelector('#askLog').addEventListener('click', e => {
    const b = e.target.closest('.ask-retry'); if (!b || S.busy) return;
    const i = +b.closest('.ask-turn').dataset.i, x = S.turns[i];
    if (x) { S.turns.splice(i, 1); send(x.q, { chip: true }); }
  });
}
export function askFocus() { root && root.querySelector('#askQ')?.focus(); }

/* ---------------- asking ---------------- */
// bring the newest answer into view just under the drawer's pinned tab bar
function reveal() {
  const pan = root && root.closest('.drawer-c'), turn = root && root.querySelector('.ask-turn');
  if (!pan || !turn || pan.closest('[hidden]')) return;
  const bar = pan.querySelector('.gbar'), top = pan.getBoundingClientRect().top + (bar ? bar.offsetHeight : 0);
  const r = turn.getBoundingClientRect(), form = root.querySelector('#askForm').getBoundingClientRect();
  if (form.top >= top && r.top < pan.getBoundingClientRect().bottom - 80) return; // the question box and the answer's start are on screen
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  pan.scrollTo({ top: pan.scrollTop + form.top - top - 8, behavior: reduce ? 'auto' : 'smooth' });
}
// a question from the box clears the box; a suggestion or a retry leaves whatever is being typed there
async function send(raw, { chip = false } = {}) {
  const q = String(raw || '').trim();
  if (!q || S.busy || !root) return;
  const ta = root.querySelector('#askQ');
  if (q.length > MAX) { const x = { q: q.slice(0, 80) + '…', status: 'err', reason: 'long' }; S.turns.push(x); drawLog(); say(x); return; }
  const hist = S.turns.filter(x => x.status === 'ok').slice(-HIST).map(x => ({ q: x.q, a: x.answer }));
  const turn = { q, status: 'wait' };
  S.turns.push(turn); S.busy = true;
  if (!chip) { S.draft = ''; ta.value = ''; fit(ta); drawLeft(); }
  drawLog(); say(turn);
  if (matchMedia('(pointer: coarse)').matches) ta.blur(); // let the phone's keyboard drop so the answer shows
  requestAnimationFrame(reveal);
  try {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 35000);
    const r = await fetch('/api/ask', {
      method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ q, lang: getLang(), hist }),
    }).finally(() => clearTimeout(timer));
    const j = await r.json().catch(() => ({}));
    if (j.ok && j.answer) Object.assign(turn, { status: 'ok', answer: String(j.answer), hotlines: Array.isArray(j.hotlines) ? j.hotlines.map(String) : [], emergency: !!j.emergency });
    else Object.assign(turn, { status: 'err', reason: j.reason === 'forbidden' ? 'unavailable' : ERR[j.reason] ? j.reason : r.status === 429 ? 'limit' : 'busy' });
  } catch {
    Object.assign(turn, { status: 'err', reason: navigator.onLine === false ? 'offline' : 'busy' });
  }
  S.busy = false;
  drawLog(); say(turn);
  requestAnimationFrame(reveal);
}

if (new URLSearchParams(location.search).has('test')) window.__ask = { S, send, askReady };
