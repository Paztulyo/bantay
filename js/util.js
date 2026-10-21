// Small shared helpers: DOM, formatting, tooltip, Manila time.
export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const NS = 'http://www.w3.org/2000/svg';
export const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '');
export const fmt1 = v => sgn(+v.toFixed(1)) + Math.abs(v).toFixed(1);
export const fmt2 = v => sgn(+v.toFixed(2)) + Math.abs(v).toFixed(2);
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MF = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const PARAMS = new URLSearchParams(location.search);
export const TEST = PARAMS.has('test');

// "Now" in Asia/Manila (UTC+8, no DST) as a UTC-based Date whose UTC fields read as Manila wall time
export const manila = (d = new Date()) => new Date(d.getTime() + 8 * 3600e3);
export const ymKey = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
export function fmtDate(iso, withYear) {
  if (!iso) return '—';
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00Z' : iso);
  const md = manila(d);
  const base = iso.length <= 10 ? d : md;
  return `${base.getUTCDate()} ${MN[base.getUTCMonth()]}${withYear ? ' ' + base.getUTCFullYear() : ''}`;
}
export function fmtTime(iso) {
  const d = manila(new Date(iso));
  let h = d.getUTCHours(); const m = d.getUTCMinutes(); const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}
export function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!isFinite(s)) return '';
  if (s < 90) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400 * 1.5) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' days ago';
}

// tooltip
let tip;
export function showTip(html, x, y) {
  tip = tip || document.getElementById('tip');
  tip.innerHTML = html; tip.style.opacity = '1';
  let tx = x + 14, ty = y + 14; const tw = tip.offsetWidth, th = tip.offsetHeight;
  if (tx + tw > innerWidth - 8) tx = x - tw - 14;
  if (ty + th > innerHeight - 8) ty = y - th - 14;
  tip.style.left = Math.max(8, tx) + 'px'; tip.style.top = Math.max(8, ty) + 'px';
}
export function hideTip() { (tip || document.getElementById('tip')).style.opacity = '0'; }

export async function getJSON(url, timeout = 25000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
