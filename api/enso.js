// ENSO state from NOAA CPC and PAGASA.
// RONI (relative, official since 2025) is the headline index. Weekly and monthly
// OISST values from CPC are TRADITIONAL anomalies and are labelled as such.
import { fetchText, send, stripTags, monIdx, attempt, nowISO } from './_lib.js';

const CPC = 'https://www.cpc.ncep.noaa.gov';
const URLS = {
  disc: `${CPC}/products/analysis_monitoring/enso_advisory/ensodisc.shtml`,
  roni: `${CPC}/data/indices/RONI.ascii.txt`,
  oni: `${CPC}/data/indices/oni.ascii.txt`,
  weekly: `${CPC}/data/indices/wksst9120.for`,
  monthly: `${CPC}/data/indices/sstoi.indices`,
  pagasa: 'https://www.pagasa.dost.gov.ph/climate/el-nino-la-nina/monitoring',
};
const SEAS = ['DJF', 'JFM', 'FMA', 'MAM', 'AMJ', 'MJJ', 'JJA', 'JAS', 'ASO', 'SON', 'OND', 'NDJ'];
const ym = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
const MONTH_RE = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';

function toISODate(s) { // "8 October 2026" -> 2026-10-08
  const m = String(s).match(new RegExp(`(\\d{1,2})\\s+(${MONTH_RE})\\s+(20\\d{2})`, 'i'));
  if (!m) return null;
  return `${m[3]}-${String(monIdx(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function parseSeasonal(txt, withTotal) {
  const out = [];
  for (const line of txt.split('\n')) {
    const m = line.trim().match(/^([A-Z]{3})\s+(\d{4})\s+(-?\d+\.\d+)(?:\s+(-?\d+\.\d+))?/);
    if (!m) continue;
    const si = SEAS.indexOf(m[1]);
    if (si < 0) continue;
    const rec = { season: m[1], year: +m[2], mid: ym(+m[2], si) };
    if (withTotal) { rec.total = +m[3]; rec.anom = m[4] !== undefined ? +m[4] : null; }
    else rec.anom = +m[3];
    if (rec.anom !== null && Math.abs(rec.anom) < 9) out.push(rec);
  }
  return out;
}

function parseWeekly(txt) {
  const out = [];
  for (const line of txt.split('\n')) {
    const d = line.match(/^\s*(\d{2})([A-Z]{3})(\d{4})/);
    if (!d) continue;
    const nums = (line.slice(d[0].length).match(/-?\d+\.\d/g) || []).map(Number);
    if (nums.length < 8) continue;
    out.push({
      date: `${d[3]}-${String(monIdx(d[2]) + 1).padStart(2, '0')}-${d[1]}`,
      n12: nums[1], n3: nums[3], n34: nums[5], n4: nums[7],
      sst34: nums[4],
    });
  }
  return out;
}

function parseMonthly(txt) { // YR MON NINO1+2 ANOM NINO3 ANOM NINO4 ANOM NINO3.4 ANOM
  const out = [];
  for (const line of txt.split('\n')) {
    const m = line.trim().match(/^(\d{4})\s+(\d{1,2})\s+(.*)$/);
    if (!m) continue;
    const n = (m[3].match(/-?\d+\.\d+/g) || []).map(Number);
    if (n.length < 8) continue;
    out.push({ month: ym(+m[1], +m[2] - 1), n12: n[1], n3: n[3], n4: n[5], n34: n[7], sst34: n[6] });
  }
  return out;
}

function parseDiscussion(html) {
  const text = stripTags(html);
  const flat = text.replace(/\s+/g, ' ');
  const issued = toISODate((flat.match(new RegExp(`\\d{1,2}\\s+${MONTH_RE}\\s+20\\d{2}`, 'i')) || [])[0]);
  const status = ((text.match(/ENSO Alert System Status:\s*([^\n]+)/i) || [])[1] || '').replace(/\s*Synopsis:.*$/i, '').trim() || null;
  let synopsis = ((text.match(/Synopsis:\s*([^\n]+)/i) || [])[1] || '').trim() || null;
  if (synopsis && synopsis.length > 420) synopsis = synopsis.slice(0, 417) + '…';
  const next = toISODate((flat.match(/next ENSO Diagnostics? Discussion is scheduled for\s+([^.]+)/i) || [])[1] || '');

  // Relative Niño values quoted in the text, e.g. "+2.1°C in Niño-3.4"
  const relative = {};
  const re = /([+\-−]?\d\.\d)\s*°\s*C\s+in\s+(?:the\s+)?Ni[ñn]o[-\s]?(3\.4|1\+2|3|4)\b/gi;
  let m;
  while ((m = re.exec(flat))) {
    const key = { '3.4': 'n34', '3': 'n3', '4': 'n4', '1+2': 'n12' }[m[2]];
    if (key && relative[key] === undefined) relative[key] = +m[1].replace('−', '-');
  }

  // Probability sentence, e.g. "the chance is 54% for September-November, 83% for October-December ..."
  let probs = null;
  const sentences = flat.split(/(?<=\.)\s+/);
  const ps = sentences.find(s => /\d{1,3}%\s+for\s+[A-Z][a-z]+\s*[-–]\s*[A-Z][a-z]+/.test(s));
  if (ps) {
    const items = [];
    const pr = /(\d{1,3})%\s+for\s+([A-Z][a-z]+)\s*[-–]\s*([A-Z][a-z]+)/g;
    let q;
    while ((q = pr.exec(ps))) items.push({ pct: +q[1], from: q[2].slice(0, 3), to: q[3].slice(0, 3) });
    probs = { text: ps.length > 360 ? ps.slice(0, 357) + '…' : ps, items };
  }
  if (!status && !synopsis) throw new Error('discussion format not recognised');
  return { issued, status, synopsis, next, relative, probs };
}

function parsePagasa(html) {
  const i = html.search(/ENSO Alert System Status/i);
  if (i < 0) throw new Error('PAGASA status block not found');
  const chunk = html.slice(i, i + 4000);
  const p = chunk.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  const text = p ? stripTags(p[1]).replace(/\s+/g, ' ').trim() : null;
  if (!text) throw new Error('PAGASA status text not found');
  const upd = text.match(/updated:?\s*([^)]+)\)/i);
  const clean = text.replace(/^PAGASA\s*:\s*/i, '').replace(/\s*\(updated:?[^)]*\)\s*$/i, '').trim();
  return { text: clean, updated: upd ? toISODate(upd[1]) : null, issued: upd ? toISODate(upd[1]) : undefined };
}

export default async function handler(req, res) {
  const [disc, roni, oni, weekly, monthly, pag] = await Promise.all([
    attempt({ id: 'cpc_disc', name: 'NOAA CPC ENSO Diagnostic Discussion', url: URLS.disc }, async () => parseDiscussion(await fetchText(URLS.disc))),
    attempt({ id: 'cpc_roni', name: 'NOAA CPC Relative Oceanic Niño Index (RONI)', url: URLS.roni }, async () => parseSeasonal(await fetchText(URLS.roni), false)),
    attempt({ id: 'cpc_oni', name: 'NOAA CPC Oceanic Niño Index (ONI, traditional)', url: URLS.oni }, async () => parseSeasonal(await fetchText(URLS.oni), true)),
    attempt({ id: 'cpc_weekly', name: 'NOAA CPC weekly OISST Niño indices (traditional)', url: URLS.weekly }, async () => parseWeekly(await fetchText(URLS.weekly))),
    attempt({ id: 'cpc_monthly', name: 'NOAA CPC monthly OISST Niño indices (traditional)', url: URLS.monthly }, async () => parseMonthly(await fetchText(URLS.monthly))),
    attempt({ id: 'pagasa_enso', name: 'PAGASA ENSO Alert System status', url: URLS.pagasa }, async () => parsePagasa(await fetchText(URLS.pagasa, { timeout: 20000 }))),
  ]);

  const tail = (a, n) => (a ? a.slice(-n) : []);
  for (const [r, key] of [[roni, 'roni'], [oni, 'oni'], [weekly, 'weekly'], [monthly, 'monthly']]) {
    if (r.value && !r.value.length) { r.source.status = 'error'; r.source.error = 'no rows parsed'; r.value = null; }
    else if (r.value) r.source.latest = key === 'weekly' ? r.value.at(-1).date : key === 'monthly' ? r.value.at(-1).month : r.value.at(-1).mid;
  }
  const body = {
    ok: [disc, roni, weekly, monthly, pag].some(r => r.value),
    fetched_at: nowISO(),
    sources: [disc, roni, oni, weekly, monthly, pag].map(r => r.source),
    cpc: disc.value,
    pagasa: pag.value,
    roni: tail(roni.value, 30),
    oni: tail(oni.value, 30),
    weekly: tail(weekly.value, 30),
    monthly: tail(monthly.value, 30),
  };
  send(res, body, body.ok ? { cache: 21600, swr: 172800 } : { status: 503 });
}
