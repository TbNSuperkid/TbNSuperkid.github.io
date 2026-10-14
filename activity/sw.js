/*
 * Activity ist nach /guess-the-word/ umgezogen. Dieser Service Worker ersetzt den alten,
 * löscht dessen Cache und meldet sich ab – danach lädt /activity/ wieder frisch die Weiterleitung.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('activity-')).map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => clients.forEach((c) => c.navigate(c.url)))
  );
});
