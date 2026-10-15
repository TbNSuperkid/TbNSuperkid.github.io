/*
 * Service Worker: speichert das Spiel im Browser, damit „Ohne Handy“ (und der Editor) auch ohne Internet läuft.
 * Strategie: erst Netzwerk, sonst Cache.
 */
const CACHE = 'wkm-v2';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'favicon.svg',
  'css/style.css',
  'js/questions/katalog.js',
  'js/questions/wissen.js',
  'js/questions/pop.js',
  'js/questions/gaming.js',
  'js/questions/alltag.js',
  'js/questions/schule.js',
  'js/questions/wort.js',
  'js/questions/adult.js',
  'js/board.js',
  'js/engine.js',
  'js/controllers.js',
  'js/editor.js',
  'js/app.js',
  '../shared/config.js',
  '../shared/net.js',
  '../shared/room.js',
  '../shared/fx.js',
  '../shared/match.js',
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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('wkm-') && k !== CACHE).map((k) => caches.delete(k))))
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
