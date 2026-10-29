/*
 * Service Worker: speichert das Spiel im Browser, damit Guess the song ohne Internet startet (Summen geht auch offline)
 * (die Ausschnitte selbst brauchen Internet). Handys verbinden sich über shared/net.js. Strategie: erst Netzwerk, sonst Cache.
 */
const CACHE = 'guessthesong-v1';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'favicon.svg',
  'css/style.css',
  'js/engine.js',
  'js/controllers.js',
  'js/app.js',
  '../shared/config.js',
  '../shared/net.js',
  '../shared/room.js',
  '../shared/fx.js',
  '../shared/match.js',
  '../shared/titles.js',
  '../shared/songs.js',
  '../shared/audio-source.js',
  '../shared/snippet.js',
  '../shared/songs/klassiker-vor-1980.js',
  '../shared/songs/charts-80er.js',
  '../shared/songs/charts-90er.js',
  '../shared/songs/charts-2000er.js',
  '../shared/songs/charts-2010er.js',
  '../shared/songs/charts-2020er.js',
  '../shared/songs/deutsch.js',
  '../shared/songs/rock.js',
  '../shared/songs/hiphop.js',
  '../shared/songs/deutschrap.js',
  '../shared/songs/schlager-party.js',
  '../shared/songs/film-serie.js',
  '../vendor/morphdom.min.js',
  '../vendor/qrcode.js',
  '../vendor/peerjs.min.js',
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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('guessthesong-') && k !== CACHE).map((k) => caches.delete(k))))
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
