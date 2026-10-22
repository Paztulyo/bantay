// Shared helpers for the data API. Every endpoint returns
// { ok, fetched_at, sources:[{id, name, url, status, issued, error?}], ...data }
// and is cached at Vercel's edge so upstream sites are hit at most once per window.

export const UA = 'BantayElNino/1.0 (+https://www.bantayelnino.com; climate dashboard for Benguet)';

export async function fetchText(url, { timeout = 15000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

export async function fetchJSON(url, opts) {
  return JSON.parse(await fetchText(url, opts));
}

// cache: seconds at the edge; swr: serve stale while refreshing
export function send(res, body, { cache = 3600, swr = 86400, status = 200 } = {}) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (status >= 500) res.setHeader('Cache-Control', 'no-store');
  else res.setHeader('Cache-Control', `public, max-age=60, s-maxage=${cache}, stale-while-revalidate=${swr}`);
  res.status(status).send(JSON.stringify(body));
}

const ENT = { nbsp: ' ', amp: '&', ntilde: 'ñ', Ntilde: 'Ñ', deg: '°', lt: '<', gt: '>', quot: '"', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };
export const stripTags = s => s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li|tr|table|center|pre)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&(nbsp|amp|ntilde|Ntilde|deg|lt|gt|quot|rsquo|lsquo|rdquo|ldquo|ndash|mdash|hellip);/g, (_, k) => ENT[k])
  .replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
export const monIdx = s => MONTHS[String(s).slice(0, 3).toUpperCase()];

// run a source fetch, never throw: returns {value, source}
export async function attempt(meta, fn) {
  const source = { id: meta.id, name: meta.name, url: meta.url, status: 'ok' };
  try {
    const value = await fn();
    if (value && value.issued) source.issued = value.issued;
    return { value, source };
  } catch (e) {
    source.status = 'error';
    source.error = String(e && e.message || e).slice(0, 200);
    return { value: null, source };
  }
}

export const nowISO = () => new Date().toISOString();
