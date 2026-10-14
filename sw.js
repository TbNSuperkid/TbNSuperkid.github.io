/*
 * Service Worker der Spieleauswahl. Strategie: erst Netzwerk, sonst Cache.
 * Jedes Spiel hat zusätzlich einen eigenen Service Worker in seinem Ordner
 * (z. B. guess-the-word/sw.js), der für seine Seiten zuständig ist.
 */
const CACHE = 'hub-v1';
const ASSETS = [
  './',
  'index.html',
  'hub.css',
  'manifest.webmanifest',
  'favicon.svg',
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
      // 'activity-v1' stammt aus der Zeit, als Activity noch direkt auf der Startseite lag
      .then((keys) =>
        Promise.all(
          keys.filter((k) => (k.startsWith('hub-') && k !== CACHE) || k === 'activity-v1').map((k) => caches.delete(k))
        )
      )
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
