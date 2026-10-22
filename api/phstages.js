// Draft of PAGASA's dry stage per province, read from PAGASA's own PDF.
// Nothing here publishes: the page /ph/ reads data/ph_stages.json, which changes only by a commit.
// This endpoint fetches the PDF, pulls out the province lists, and reports what differs
// from the published file, so a person can check the month's changes before they go live.
import { UA, send, nowISO } from './_lib.js';
import { extractText, getDocumentProxy } from 'unpdf';

const ALLOW = /^https:\/\/(pubfiles|www)\.pagasa\.dost\.gov\.ph\//;

async function fetchPDF(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  } finally { clearTimeout(t); }
}

export default async function handler(req, res) {
  const u = String(req.query?.u || '');
  if (!ALLOW.test(u)) return send(res, { ok: false, error: 'u must be a PAGASA URL' }, { status: 400 });
  try {
    const pdf = await getDocumentProxy(await fetchPDF(u));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    send(res, { ok: true, fetched_at: nowISO(), url: u, pages: totalPages, text }, { cache: 3600, swr: 86400 });
  } catch (e) {
    send(res, { ok: false, url: u, error: String(e && e.message || e).slice(0, 200) }, { status: 502 });
  }
}
