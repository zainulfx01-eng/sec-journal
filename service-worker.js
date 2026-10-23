// Zainul FX Journal service worker. Classic script (no imports) so it runs in any browser that supports service workers.
// Scope: same-origin GET requests only. Everything else (POST/PUT/PATCH/DELETE, supabase.co, Telegram SDK, any cross-origin
// request) is left alone so the browser sends it straight to the network and Supabase auth and sync are never touched.
// Bump CACHE_VERSION whenever a precached file changes.
const CACHE_VERSION = 'zainul-journal-v4';
const CACHE_NAME = CACHE_VERSION;

// Every file the app needs to run offline. Keep in sync with the repo root (stage4.test.js checks this).
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './offline.html',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './app.js',
  './calc.js',
  './calculator.js',
  './calendar.js',
  './chart.js',
  './cloud.js',
  './config.js',
  './csv.js',
  './dashboard.js',
  './discipline.js',
  './insights.js',
  './journal.js',
  './pwa.js',
  './settings.js',
  './shots.js',
  './account.js',
  './analytics.js',
  './storage.js',
  './supabase.js',
  './sync.js',
  './telegram.js',
  './trades.js',
  './ui.js',
];

// Pure routing decision, so it can be tested. Returns 'bypass' (do not touch), 'cache' (cache first, then network), or 'navigate'.
function routeFor(method, url, selfOrigin) {
  if (method !== 'GET') return 'bypass';
  let u;
  try { u = new URL(url); } catch (_) { return 'bypass'; }
  if (u.origin !== selfOrigin) return 'bypass';                 // Telegram SDK, fonts, any CDN
  if (/(^|\.)supabase\.co$/i.test(u.hostname)) return 'bypass'; // auth and sync always go to the network
  if (u.pathname.indexOf('/rest/') !== -1 || u.pathname.indexOf('/auth/') !== -1) return 'bypass';
  return 'cache';
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('zainul-journal-') && k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach((c) => c.postMessage({ type: 'SW_ACTIVATED', version: CACHE_VERSION }));
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function offlineResponse() {
  return caches.match('./offline.html').then((r) => r || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const route = routeFor(req.method, req.url, self.location.origin);
  if (route === 'bypass') return; // no respondWith: the browser handles it normally

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req, { ignoreSearch: true });
    const isNav = req.mode === 'navigate';

    // Refresh in the background when online; keep the cached copy as the fast answer.
    const network = fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    if (cached) return cached;
    const fresh = await network;
    if (fresh) return fresh;
    if (isNav) return offlineResponse();
    return new Response('', { status: 504, statusText: 'Offline' });
  })());
});
