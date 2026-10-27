/*
 * Service Worker: speichert das Spiel im Browser (schneller Start, kurze Funklöcher).
 * Strategie: erst Netzwerk, sonst Cache.
 */
const CACHE = 'skribbl-v2';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'favicon.svg',
  'css/style.css',
  'js/woerter/tiere.js',
  'js/woerter/essen.js',
  'js/woerter/berufe.js',
  'js/woerter/filme.js',
  'js/woerter/dinge.js',
  'js/woerter/orte.js',
  'js/woerter/aktionen.js',
  'js/words.js',
  'js/hints.js',
  'js/engine.js',
  'js/controllers.js',
  'js/app.js',
  '../guess-the-word/js/words/zeichnen.js',
  '../shared/config.js',
  '../shared/net.js',
  '../shared/room.js',
  '../shared/fx.js',
  '../shared/match.js',
  '../shared/sketch.js',
  '../shared/fill.js',
  '../vendor/morphdom.min.js',
  '../vendor/peerjs.min.js',
  '../vendor/qrcode.js',
  '../vendor/fonts/fredoka.woff2',
  '../vendor/fonts/nunito.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('skribbl-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.endsWith('/ws')) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        return (req.mode === 'navigate' && (await caches.match('index.html'))) || Response.error();
      })
  );
});
