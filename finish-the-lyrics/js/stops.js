/*
 * Stoppstellen für „Finish the lyrics“: An welcher Stelle im 30-s-Ausschnitt (iTunes) die Musik stoppt.
 *
 * Gespeichert wird nur eine Zahl in Sekunden – kein Liedtext. Gibt es für einen Song keine (oder eine unbrauchbare)
 * Stelle, stoppt die Musik zufällig zwischen 8 und 20 s. Achtung: Wechselt Apple den Ausschnitt, passt die Stelle
 * nicht mehr – dann eben aus der Liste streichen.
 *
 * Gute Stellen sammelt die Spielleitung im Spiel („📍 Hier wäre eine gute Stelle“). Die landen zuerst nur im
 * eigenen Browser (localStorage) und gelten dort sofort. Als Liste kopiert (exportText) kommen sie hier in STOPS:
 *
 *   'interpret:titel': 12.4, // Titel – Interpret
 *
 * Die Schlüssel sind die Song-IDs aus shared/songs.js (Songs.songId).
 */
(function (root) {
  'use strict';

  const STOPS = {
    // noch keine geprüften Stellen – im Spiel mit „📍“ sammeln und hier eintragen
  };

  const KEY = 'finishlyrics.stops.v1';
  const MIN_STOP = 4; // vorher kennt man den Song noch nicht
  const MAX_STOP = 26; // danach bleibt zu wenig zum Auflösen
  const RANDOM_FROM = 8;
  const RANDOM_TO = 20;

  function round1(x) {
    return Math.round(x * 10) / 10;
  }

  /** Brauchbare Stelle? (Zahl zwischen 4 und 26 s) */
  function valid(secs) {
    return typeof secs === 'number' && isFinite(secs) && secs >= MIN_STOP && secs <= MAX_STOP;
  }

  function storage() {
    try {
      return root.localStorage || null;
    } catch {
      return null;
    }
  }

  /** Im Browser gesammelte Stellen: { id: { secs, title, artist, at } } */
  function collected() {
    const st = storage();
    if (!st) return {};
    try {
      const o = JSON.parse(st.getItem(KEY)) || {};
      return o && typeof o === 'object' ? o : {};
    } catch {
      return {};
    }
  }

  function save(o) {
    const st = storage();
    if (!st) return;
    try {
      st.setItem(KEY, JSON.stringify(o));
    } catch {
      /* voll oder gesperrt */
    }
  }

  /** Stelle merken (überschreibt eine frühere für denselben Song). Gibt false zurück, wenn sie unbrauchbar ist. */
  function mark(song, secs) {
    const s = round1(Number(secs));
    if (!song || !song.id || !valid(s)) return false;
    const o = collected();
    o[song.id] = { secs: s, title: String(song.title || ''), artist: String(song.artist || ''), at: Date.now() };
    save(o);
    return true;
  }

  function forget(id) {
    const o = collected();
    delete o[id];
    save(o);
  }

  function clear() {
    save({});
  }

  /** Gesammelte Stelle (Browser) vor der aus der Liste – oder null */
  function get(id) {
    const c = collected()[id];
    if (c && valid(c.secs)) return c.secs;
    const s = STOPS[id];
    return valid(s) ? s : null;
  }

  /**
   * Wo stoppt die Musik bei diesem Song? → { secs, known }
   * known = aus der Liste bzw. gesammelt, sonst zufällig zwischen 8 und 20 s (eine Nachkommastelle).
   */
  function stopFor(song, random) {
    const known = song && song.id ? get(song.id) : null;
    if (known !== null) return { secs: known, known: true };
    const r = (random || Math.random)();
    return { secs: round1(RANDOM_FROM + r * (RANDOM_TO - RANDOM_FROM)), known: false };
  }

  /** Gesammelte Stellen als Zeilen zum Einfügen in STOPS (sortiert nach ID) */
  function exportText(list) {
    const o = list || collected();
    return Object.keys(o)
      .sort()
      .filter((id) => valid(o[id] && o[id].secs))
      .map((id) => {
        const x = o[id];
        const label = [x.title, x.artist].filter(Boolean).join(' – ').replace(/[\r\n]+/g, ' ');
        return `  '${id.replace(/'/g, "\\'")}': ${x.secs},${label ? ' // ' + label : ''}`;
      })
      .join('\n');
  }

  root.FTLStops = { STOPS, KEY, MIN_STOP, MAX_STOP, RANDOM_FROM, RANDOM_TO, valid, collected, mark, forget, clear, get, stopFor, exportText };
})(typeof window !== 'undefined' ? window : globalThis);
