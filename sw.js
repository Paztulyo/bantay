// Bantay El Niño service worker: lets the installed app open without a connection, and never passes old live data off
// as new. The page, its scripts, styles and icons, and the editorial data files (the monthly outlook and the hotlines,
// each dated on the page) come from the network first and are kept only as the fallback for when there is no network.
// Live readings are never touched: the /api feeds (PAGASA, NOAA CPC, dams, fires), Open-Meteo weather, map tiles,
// fonts and anything else from another site go straight to the network, so offline they fail and the page says so.
// Only the page itself (/) is kept as a page: any link to it, with or without ?fbclid= or ?lang=, opens it offline.
const CACHE = 'bantay-v1';
const SHELL = [
  '/', '/manifest.webmanifest',
  '/css/app.css', '/css/extra.css', '/css/glass.css', '/css/brief.css', '/css/simple.css',
  '/js/app.js', '/js/map3d.js', '/js/live.js', '/js/osm.js', '/js/weather.js', '/js/weather3d.js', '/js/ovpanel.js', '/js/guide.js',
  '/js/smoke.js', '/js/views.js', '/js/i18n.js', '/js/headfit.js', '/js/icons.js', '/js/util.js', '/js/simple.js', '/js/pwa.js',
  '/js/lang/tl.js', '/js/lang/ilo.js',
  '/data/outlook.json', '/data/guide.json', '/data/boundaries.json', '/data/agno.json', '/data/pacific.json',
  '/img/logo.svg', '/img/favicon.svg', '/img/apple-touch-icon.png', '/img/icon-192.png', '/img/icon-512.png', '/img/icon-maskable-512.png',
];
const KEEP = /^\/(css|js|data|img)\/|^\/manifest\.webmanifest$/; // what may be kept besides the page; never /api
const LIVE = /^\/(api|mock|test-tiles)\//; // live feeds, and the test server's stand-ins for them

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // one by one, so a single missing file doesn't stop the rest from being kept
    await Promise.allSettled(SHELL.map(async u => { const r = await fetch(u, { cache: 'no-cache' }); if (r.ok) await c.put(u, r); }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('bantay-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || LIVE.test(url.pathname) || req.headers.has('range')) return;
  const page = req.mode === 'navigate';
  if (page && url.pathname !== '/' && url.pathname !== '/index.html') return; // other pages are not this app's to keep
  if (!page && !KEEP.test(url.pathname)) return;
  const key = page ? '/' : url.pathname;
  e.respondWith((async () => {
    try {
      const r = await fetch(req);
      if (r.ok && r.type === 'basic' && !r.redirected) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {}); }
      return r;
    } catch (err) {
      const hit = await caches.match(key);
      if (hit) return hit;
      throw err;
    }
  })());
});
