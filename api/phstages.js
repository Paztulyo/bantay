// Draft of PAGASA's dry stage per province, read from PAGASA's own climate outlook PDF.
// Nothing here publishes. The page /ph/ shows data/ph_stages.json, which changes only by a commit.
// This endpoint reads the PDF and returns the stages it finds plus every check that failed,
// so /ph/review can show what changed before anyone publishes it.
import { UA, send, nowISO } from './_lib.js';
import { extractText, extractImages, getDocumentProxy } from 'unpdf';
import zlib from 'node:zlib';
import { parseOutlook } from '../js/phparse.js';

// PAGASA's maps (dry days, temperature) are pictures inside the PDF. ?images=N returns page N's pictures as PNG,
// shrunk to at most 1000 px wide, so a person can read Benguet's values off them for the monthly update.
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = b => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
  const hd = Buffer.alloc(13); hd.writeUInt32BE(w, 0); hd.writeUInt32BE(h, 4); hd[8] = 8; hd[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hd), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function toPNG(img, maxW = 1000) {
  const { width: w0, height: h0, channels: ch, data } = img, k = Math.max(1, w0 / maxW), w = Math.round(w0 / k), h = Math.round(h0 / k);
  const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(w0 - 1, Math.floor(x * k)), sy = Math.min(h0 - 1, Math.floor(y * k)), i = (sy * w0 + sx) * ch, o = (y * w + x) * 3;
    if (ch >= 3) { const a = ch === 4 ? data[i + 3] / 255 : 1; rgb[o] = data[i] * a + 255 * (1 - a); rgb[o + 1] = data[i + 1] * a + 255 * (1 - a); rgb[o + 2] = data[i + 2] * a + 255 * (1 - a); }
    else { rgb[o] = rgb[o + 1] = rgb[o + 2] = data[i]; }
  }
  return { w, h, png: png(w, h, rgb).toString('base64') };
}

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
    const pg = parseInt(req.query?.images, 10);
    if (pg > 0) {
      const imgs = (await extractImages(pdf, pg)).filter(i => i.width >= 200 && i.height >= 200).slice(0, 6);
      return send(res, { ok: true, fetched_at: nowISO(), url: u, page: pg, images: imgs.map(i => toPNG(i)) }, { cache: 3600, swr: 86400 });
    }
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
