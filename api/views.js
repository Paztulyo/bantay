// Visitor counter. The page asks once per load: POST /api/views?first=1 on a browser's first visit, POST /api/views
// on later ones. Each browser counts once as a visitor; every load counts as a page view. The numbers live in a Redis
// store connected through the Vercel Marketplace (Upstash), read over its REST API. Until one is connected this
// answers { status: 'off' } and the page keeps the counter hidden.
// Only production counts, bots and cross-site requests never do, and new-visitor counts are throttled per connection.
// Nothing about the visitor is kept: the throttle holds a keyed hash of the IP for an hour.
import { createHmac } from 'node:crypto';

const BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = { visitors: 'bantay:visitors', views: 'bantay:views' };
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|curl|wget|python|axios|node-fetch|go-http/i;
const HOURLY_MAX = 60; // new visitors per connection per hour; generous, since mobile carriers put many people behind one IP

async function redis(commands) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(BASE.replace(/\/$/, '') + '/pipeline', {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()).map(x => { if (x.error) throw new Error(x.error); return x.result; });
  } finally { clearTimeout(t); }
}

function reply(res, body, cache = 'no-store') {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.status(200).send(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (!BASE || !TOKEN) return reply(res, { status: 'off' }, 'public, max-age=60, s-maxage=300');
  const q = new URL(req.url, 'http://x').searchParams;
  const site = req.headers['sec-fetch-site'];
  const counts = req.method === 'POST' && process.env.VERCEL_ENV === 'production'
    && !BOT.test(String(req.headers['user-agent'] || '')) && (!site || site === 'same-origin');
  try {
    if (!counts) {
      const [v, p] = await redis([['GET', KEY.visitors], ['GET', KEY.views]]);
      return reply(res, { status: 'ok', visitors: +v || 0, views: +p || 0, counted: false }, req.method === 'GET' ? 'public, max-age=30, s-maxage=60' : 'no-store');
    }
    let first = q.get('first') === '1';
    if (first) {
      const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      const slot = `bantay:rl:${createHmac('sha256', TOKEN).update(ip).digest('hex').slice(0, 20)}:${Math.floor(Date.now() / 3600000)}`;
      const [n] = await redis([['INCR', slot], ['EXPIRE', slot, 3600]]);
      if (n > HOURLY_MAX) first = false;
    }
    const [p, v] = await redis([['INCR', KEY.views], first ? ['INCR', KEY.visitors] : ['GET', KEY.visitors]]);
    return reply(res, { status: 'ok', visitors: +v || 0, views: +p || 0, counted: first });
  } catch (e) {
    return reply(res, { status: 'error', error: String(e && e.message || e).slice(0, 120) });
  }
}
