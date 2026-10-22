// Draft of PAGASA's dry stage per province, read from PAGASA's own climate outlook PDF.
// Nothing here publishes. The page /ph/ shows data/ph_stages.json, which changes only by a commit.
// This endpoint reads the PDF and returns the stages it finds plus every check that failed,
// so /ph/review can show what changed before anyone publishes it.
import { UA, send, nowISO } from './_lib.js';
import { extractText, getDocumentProxy } from 'unpdf';
import { parseOutlook } from '../js/phparse.js';

const DEFAULT = 'https://pubfiles.pagasa.dost.gov.ph/climps/climateforum/outlook.pdf';
const ALLOW = /^https:\/\/(pubfiles|www)\.pagasa\.dost\.gov\.ph\/[^\s]+\.pdf$/i;

async function fetchPDF(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { bytes: new Uint8Array(await r.arrayBuffer()), modified: r.headers.get('last-modified') };
  } finally { clearTimeout(t); }
}

export default async function handler(req, res) {
  const u = String(req.query?.u || DEFAULT);
  if (!ALLOW.test(u)) return send(res, { ok: false, error: 'u must be a PAGASA PDF' }, { status: 400 });
  const source = { id: 'pagasa_outlook', name: 'PAGASA Climate Outlook (PDF)', url: u, status: 'ok' };
  try {
    const { bytes, modified } = await fetchPDF(u);
    const pdf = await getDocumentProxy(bytes);
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    if (req.query?.text) return send(res, { ok: true, fetched_at: nowISO(), url: u, pages: totalPages, text }, { cache: 3600, swr: 86400 });
    const draft = parseOutlook(text);
    if (draft.issued) source.issued = draft.issued;
    send(res, { ok: true, fetched_at: nowISO(), url: u, modified, pages: totalPages, ...draft, sources: [source] }, { cache: 3600, swr: 86400 });
  } catch (e) {
    source.status = 'error'; source.error = String(e && e.message || e).slice(0, 200);
    send(res, { ok: false, fetched_at: nowISO(), url: u, sources: [source] }, { status: 502 });
  }
}
