// Agno cascade reservoir levels from PAGASA's dam information table.
import { fetchText, send, stripTags, monIdx, attempt, nowISO } from './_lib.js';

const URL = 'https://www.pagasa.dost.gov.ph/flood';
export { URL as DAMS_URL }; // api/ask.js reads the same table
const WANT = { Ambuklao: 752.0, Binga: 575.0, 'San Roque': 280.0 }; // normal high water level, m
const num = s => { const v = parseFloat(String(s).replace(/[,\s+]/g, '').replace('−', '-')); return Number.isFinite(v) ? v : null; };
const isDate = s => /^[A-Z][a-z]{2}-\d{1,2}$/.test(s.trim());

function manilaNow() { return new Date(Date.now() + 8 * 3600e3); }
function isoFromShort(short, time) { // "Oct-21", "08:00 AM" -> ISO in +08:00
  const m = short.match(/^([A-Z][a-z]{2})-(\d{1,2})$/);
  if (!m) return null;
  const now = manilaNow();
  let y = now.getUTCFullYear();
  const mi = monIdx(m[1]);
  if (mi - now.getUTCMonth() > 6) y -= 1; // December reading seen in January
  let hh = 8, mm = 0;
  const t = String(time || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (t) { hh = +t[1] % 12; mm = +t[2]; if ((t[3] || '').toUpperCase() === 'PM') hh += 12; if (!t[3] && +t[1] === 12) hh = 12; }
  return `${y}-${String(mi + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+08:00`;
}

export function parse(html) {
  const cells = [];
  const re = /<td([^>]*)>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const id = (attrs.match(/data-id="([^"]+)"/i) || [])[1] || null;
    cells.push({ id, attrs, text: stripTags(m[2]).replace(/\s+/g, ' ').trim() });
  }
  const dams = [];
  for (const name of Object.keys(WANT)) {
    let group = cells.filter(c => c.id && c.id.trim().toLowerCase() === name.toLowerCase());
    if (!group.length) {
      const cls = 'td-' + name.split(' ')[0];
      group = cells.filter(c => c.attrs.includes(cls));
    }
    if (!group.length) continue;
    const t = group.map(c => c.text);
    const d1 = t.findIndex(isDate);
    if (d1 < 0) continue;
    let cur = t.slice(0, d1);
    if (cur.length && cur[0].toLowerCase().startsWith(name.toLowerCase().split(' ')[0].toLowerCase())) cur = cur.slice(1);
    // cur: time, RWL, WLD hr, WLD amount, NHWL, dev NHWL, rule curve, dev rule, gates, meters, inflow, outflow
    const level = num(cur[1]);
    const nhwl = num(cur[4]) ?? WANT[name];
    if (level === null || Math.abs(level - nhwl) > 120) continue;
    const rule = num(cur[6]);
    const d2 = t.findIndex((s, i) => i > d1 && isDate(s));
    const prevBlock = d2 > d1 ? t.slice(d1 + 1, d2) : [];
    const prevLevel = num(prevBlock[1]);
    dams.push({
      id: name,
      time: cur[0] || null,
      date: t[d1],
      iso: isoFromShort(t[d1], cur[0]),
      level,
      nhwl,
      dev: +(level - nhwl).toFixed(2),
      rule,
      rdev: rule !== null ? +(level - rule).toFixed(2) : null,
      change24: num(cur[3]),
      gates: num(cur[8]),
      inflow: num(cur[10]),
      outflow: num(cur[11]),
      prev: prevLevel !== null ? { level: prevLevel, time: prevBlock[0] || null, date: d2 > 0 ? t[d2] : null } : null,
    });
  }
  // Basin flood status, e.g. "Ambuklao-Binga-San Roque Sub-basin" -> "Non-Flood Watch"
  let basin = null;
  const bi = cells.findIndex(c => /Ambuklao.*Binga.*San Roque/i.test(c.text));
  if (bi >= 0 && cells[bi + 1]) basin = { name: cells[bi].text, status: cells[bi + 1].text };
  if (!dams.length) throw new Error('dam table not found or format changed');
  const newest = dams.map(d => d.iso).filter(Boolean).sort().at(-1);
  return { dams, basin, issued: newest || undefined };
}

export default async function handler(req, res) {
  const r = await attempt({ id: 'pagasa_dams', name: 'PAGASA Dam Information', url: URL }, async () => parse(await fetchText(URL, { timeout: 20000 })));
  const body = { ok: !!r.value, fetched_at: nowISO(), sources: [r.source], dams: r.value?.dams || [], basin: r.value?.basin || null };
  send(res, body, body.ok ? { cache: 1800, swr: 86400 } : { status: 503 });
}
