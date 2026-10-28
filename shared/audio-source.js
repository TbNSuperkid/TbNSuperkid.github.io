/*
 * Woher der Ton kommt – gemeinsam für die Musikspiele (siehe planung/musik-grundlagen.md).
 *
 * Jede Quelle hat find(song) → Promise<Ausschnitt | null>:
 *   AudioSource.itunes  30-s-Ausschnitt aus der iTunes-Suche (kostenlos, ohne Login):
 *                       { url, storeUrl, artwork, length: 30, source: 'itunes' } – null, wenn nichts Passendes da ist.
 *                       Apple stellt die Ausschnitte zur Werbung bereit: Wer sie zeigt, verlinkt immer den Store
 *                       („In Apple Music öffnen“, storeUrl).
 *   AudioSource.manual  „Selbst abspielen“: { manual: true, links } – eine Person (DJ) sucht den Song in ihrer eigenen
 *                       Musik-App und spielt ihn ab. Die App liefert nur Such-Links (keine Spotify-API, kein Audio im Repo).
 *
 * Die Song-Datenbank speichert keine Links; gesucht wird immer mit „Interpret Titel“. Treffer werden im Browser
 * zwischengespeichert (7 Tage, „nichts gefunden“ 1 Tag). Abgespielt wird nur auf dem Laptop – Handys bekommen nie
 * eine Ausschnitt-URL, sonst stünde der Titel im Entwickler-Werkzeug.
 */
(function (root) {
  'use strict';

  const SERVICES = [
    { id: 'spotify', icon: '🟢', label: 'Spotify', url: (q) => 'https://open.spotify.com/search/' + encodeURIComponent(q) },
    { id: 'youtube', icon: '▶️', label: 'YouTube', url: (q) => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q) },
    { id: 'apple', icon: '🍏', label: 'Apple Music', url: (q) => 'https://music.apple.com/de/search?term=' + encodeURIComponent(q) },
  ];
  const SERVICE_IDS = SERVICES.map((s) => s.id);

  const ITUNES_URL = 'https://itunes.apple.com/search';
  const CACHE_KEY = 'audio.itunes.v1';
  const CACHE_DAYS = 7;
  const MISS_DAYS = 1;
  const TIMEOUT_MS = 7000;
  const DAY = 24 * 60 * 60 * 1000;
  // Fassungen, die nicht die bekannte Aufnahme sind
  const WRONG = /\b(live|karaoke|instrumental|tribute|cover|made famous|in the style|acoustic|akustik|remix|rmx|re-?recorded|sped up|slowed|nightcore|8-bit|lullaby|piano version|orchestral)\b/i;

  /** Suchbegriff: Interpret + Titel, ohne Klammerzusätze wie „(Are Made of This)“ */
  function query(song) {
    const title = String((song && song.title) || '')
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .trim();
    return `${(song && song.artist) || ''} ${title}`.replace(/\s+/g, ' ').trim();
  }

  /** Such-Links für alle Dienste: [{ id, icon, label, url }] */
  function searchLinks(song) {
    const q = query(song);
    return SERVICES.map((s) => ({ id: s.id, icon: s.icon, label: s.label, url: s.url(q) }));
  }

  const manual = {
    id: 'manual',
    find(song) {
      return Promise.resolve({ manual: true, links: searchLinks(song) });
    },
  };

  /* ---------- iTunes ---------- */

  function T() {
    return root.GameTitles;
  }

  /** Passt der Interpret eines Treffers? Mindestens ein beteiligter Name muss übereinstimmen */
  function sameArtist(found, wanted) {
    const a = new Set(T().artistKeys(found));
    return T()
      .artistKeys(wanted)
      .some((k) => a.has(k) || T().checkArtist(k, found) === 'yes');
  }

  /**
   * Besten Treffer aus den iTunes-Ergebnissen wählen – oder null.
   * Pflicht: Ausschnitt vorhanden, Interpret und Titel passen, keine Live-/Karaoke-/Remix-Fassung (außer der Titel
   * selbst sagt es). Danach gewinnt, was dem Jahr am nächsten liegt (Remaster haben oft spätere Daten).
   */
  function pick(results, song) {
    const wantWrong = WRONG.test(song.title);
    let best = null;
    for (const r of results || []) {
      if (!r || !r.previewUrl || (r.kind && r.kind !== 'song')) continue;
      if (!sameArtist(r.artistName || '', song.artist)) continue;
      if (T().checkTitle(T().cleanTitle(r.trackName || ''), song) !== 'yes' && T().checkTitle(r.trackName || '', song) !== 'yes') continue;
      const label = `${r.trackName || ''} ${r.collectionName || ''}`;
      if (!wantWrong && WRONG.test(label)) continue;
      const year = Number(String(r.releaseDate || '').slice(0, 4)) || 9999;
      let score = Math.abs(year - song.year);
      if (year < song.year - 1) score += 5; // früher als das Original? dann eher ein anderer Song
      if (/remaster/i.test(label)) score += 1;
      if (/(greatest|best of|hits|collection|essential|gold)\b/i.test(r.collectionName || '')) score += 0.5;
      if (!best || score < best.score) best = { score, r };
    }
    if (!best) return null;
    const r = best.r;
    return {
      source: 'itunes',
      url: r.previewUrl,
      storeUrl: r.trackViewUrl || r.collectionViewUrl || null,
      artwork: r.artworkUrl100 || null,
      length: 30,
    };
  }

  function readCache() {
    try {
      return JSON.parse(root.localStorage.getItem(CACHE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function writeCache(c) {
    try {
      const keys = Object.keys(c);
      // nicht endlos wachsen lassen
      if (keys.length > 1500) keys.sort((a, b) => c[a].at - c[b].at).slice(0, keys.length - 1200).forEach((k) => delete c[k]);
      root.localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch {
      /* voll oder gesperrt */
    }
  }

  /** Aus dem Zwischenspeicher: Treffer, null (= sicher nichts da) oder undefined (= unbekannt) */
  function cached(song) {
    const c = readCache()[song.id];
    if (!c) return undefined;
    const age = Date.now() - (c.at || 0);
    if (c.hit === null) return age < MISS_DAYS * DAY ? null : undefined;
    return age < CACHE_DAYS * DAY ? c.hit : undefined;
  }

  function remember(song, hit) {
    const c = readCache();
    c[song.id] = { at: Date.now(), hit };
    writeCache(c);
  }

  async function search(song, opts) {
    const o = opts || {};
    const fetcher = o.fetch || root.fetch;
    const params = new URLSearchParams({ term: query(song), entity: 'song', media: 'music', country: o.country || 'de', limit: '50' });
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
    try {
      const res = await fetcher(ITUNES_URL + '?' + params.toString(), ctrl ? { signal: ctrl.signal } : undefined);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return data.results || [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const itunes = {
    id: 'itunes',
    /**
     * @param {{id: string, title: string, artist: string, year: number, alts?: string[]}} song
     * @param {{fetch?: Function, country?: string, cache?: boolean}} [opts]
     * @returns {Promise<object|null>} null = nichts Passendes; wirft bei Netzfehlern (dann nicht als „nichts da“ merken)
     */
    async find(song, opts) {
      const useCache = !opts || opts.cache !== false;
      if (useCache) {
        const c = cached(song);
        if (c !== undefined) return c;
      }
      let hit = pick(await search(song, opts), song);
      // Album-Tracks oder Instrumentals können den Song verdrängen → andere Suchbegriffe versuchen
      const first = T().artistParts(song.artist)[0] || '';
      if (!hit) hit = pick(await search({ title: song.title, artist: first }, opts), song);
      if (!hit) hit = pick(await search({ title: song.title, artist: '' }, opts), song);
      if (useCache) remember(song, hit);
      return hit;
    },
  };

  root.AudioSource = { SERVICES, SERVICE_IDS, query, searchLinks, manual, itunes, pick, WRONG };
})(typeof window !== 'undefined' ? window : globalThis);
