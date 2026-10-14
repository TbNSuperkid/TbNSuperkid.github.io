/*
 * Service Worker: speichert die Seite im Browser, damit der Offline-Modus
 * auch ohne Internet funktioniert. Strategie: erst Netzwerk, sonst Cache.
 */
const CACHE = 'activity-v1';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'favicon.svg',
  'css/style.css',
  'js/config.js',
  'js/words/erklaeren.js',
  'js/words/zeichnen.js',
  'js/words/pantomime.js',
  'js/words/adult.js',
  'js/deck.js',
  'js/engine.js',
  'js/net.js',
  'js/controllers.js',
  'js/sketch.js',
  'js/fx.js',
  'js/app.js',
  'vendor/morphdom.min.js',
  'vendor/peerjs.min.js',
  'vendor/qrcode.js',
  'vendor/fonts/fredoka.woff2',
  'vendor/fonts/nunito.woff2',
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
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
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});
