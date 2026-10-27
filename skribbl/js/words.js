/*
 * Wörter für Skribbl – Adapter für alle Quellen:
 *  - „Standard“: Guess the word!, Kategorie Zeichnen (leicht/mittel/schwer → Stufe 1/2/3). Lange Redewendungen
 *    („Den Ast absägen, auf dem man sitzt“) bleiben draußen – die errät man beim Tippen nie wortgenau.
 *  - Wortpakete aus js/woerter/ (Tiere, Essen, Berufe, Filme & Serien, Gegenstände, Orte, Aktionen)
 *  - eigene Wörter der Runde (Einstellung „Eigene Wörter“, nur eigene oder gemischt)
 * Gezogen wird ohne Wiederholung im Spiel und möglichst auch nicht aus früheren Spielen (localStorage).
 *
 * check(tipp, wort) prüft einen Tipp: 'right' (auch mit Artikel, Plural, Groß/klein, Umlaut-Schreibweise),
 * 'close' (ein Tippfehler, bei langen Wörtern zwei) oder 'wrong'.
 */
(function (root) {
  'use strict';

  const SEEN_KEY = 'skribbl.seen.v1';
  const MAX_WORDS = 3; // längere Begriffe aus der Standardliste sind Sprichwörter
  const MAX_CUSTOM = 300;
  const MAX_WORD = 30;
  const STANDARD = { id: 'standard', label: 'Standard', icon: '✏️' };
  const PACK_ORDER = ['standard', 'tiere', 'essen', 'berufe', 'filme', 'dinge', 'orte', 'aktionen'];
  const STANDARD_LEVEL = { leicht: 1, mittel: 2, schwer: 3 };
  const LEVEL_LABEL = { 0: 'eigenes', 1: 'leicht', 2: 'mittel', 3: 'schwer' };
  const ARTICLE = /^(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines)\s+/;
  const PLURAL_ENDINGS = ['e', 'n', 'en', 's', 'er', 'es', 'nen'];
  const cache = {};

  function lines(text) {
    return String(text || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  }

  function key(word) {
    return root.GameMatch.normalize(word);
  }

  /** Normalform ohne Umlaut-Umschreibung (Kühe → kuhe), für Plurale mit Umlaut */
  function loose(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .trim()
      .replace(ARTICLE, '')
      .replace(/ä/g, 'a')
      .replace(/ö/g, 'o')
      .replace(/ü/g, 'u')
      .replace(/ß/g, 'ss')
      .replace(/[éèêë]/g, 'e')
      .replace(/[áàâ]/g, 'a')
      .replace(/[^a-z0-9]/g, '');
  }

  /**
   * Plural/Singular: Tipp = Wort + Endung (Kuh → Kühe) zählt ab 3 Buchstaben. Andersherum (Wort steht im Plural,
   * getippt wird die Einzahl) erst ab 4 Buchstaben und ohne „-s“ – sonst wäre „Mau“ richtig für „Maus“.
   */
  function plural(g, w) {
    if (g.length > w.length) return w.length >= 3 && g.startsWith(w) && PLURAL_ENDINGS.includes(g.slice(w.length));
    const end = w.slice(g.length);
    return g.length >= 4 && w.startsWith(g) && end !== 's' && PLURAL_ENDINGS.includes(end);
  }

  /** Tipp prüfen: 'right' | 'close' | 'wrong' */
  function check(guess, word) {
    const g = key(guess);
    const w = key(word);
    if (!g || !w) return 'wrong';
    if (g === w || plural(g, w)) return 'right';
    const lg = loose(guess);
    const lw = loose(word);
    if (lg === lw || plural(lg, lw)) return 'right';
    const limit = w.length >= 9 ? 2 : w.length >= 4 ? 1 : 0;
    if (limit && Math.abs(g.length - w.length) <= limit && root.GameMatch.levenshtein(g, w) <= limit) return 'close';
    return 'wrong';
  }

  /** Paket-Infos in fester Reihenfolge: [{id, label, icon, count}] */
  function packs() {
    const all = root.SK_PACKS || {};
    return PACK_ORDER.filter((id) => id === 'standard' || all[id]).map((id) => {
      const meta = id === 'standard' ? STANDARD : all[id];
      return { id, label: meta.label, icon: meta.icon, count: entries(id).length };
    });
  }

  function packIds() {
    return packs().map((p) => p.id);
  }

  /** Alle Begriffe eines Pakets: [{key, word, level, pack}] (ohne Doppelte innerhalb des Pakets) */
  function entries(id) {
    if (cache[id]) return cache[id];
    const raw = [];
    if (id === 'standard') {
      const z = (root.ACTIVITY_WORDS || {}).zeichnen || {};
      for (const [diff, lv] of Object.entries(STANDARD_LEVEL)) {
        for (const w of lines(z[diff])) {
          if (w.includes(',') || w.split(/\s+/).length > MAX_WORDS) continue;
          raw.push({ word: w, level: lv });
        }
      }
    } else {
      const p = (root.SK_PACKS || {})[id] || {};
      for (const lv of [1, 2, 3]) for (const w of lines(p[lv])) raw.push({ word: w, level: lv });
    }
    const seen = new Set();
    cache[id] = [];
    for (const e of raw) {
      const k = key(e.word);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      cache[id].push({ key: k, word: e.word, level: e.level, pack: id });
    }
    return cache[id];
  }

  /** Eigene Wörter aus einem Text (eine Zeile oder Komma pro Wort) */
  function parseCustom(text) {
    const list = Array.isArray(text) ? text : String(text || '').split(/[\n,;]+/);
    const out = [];
    const seen = new Set();
    for (const raw of list) {
      const w = String(raw == null ? '' : raw)
        .replace(/[\u0000-\u001f<>]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_WORD);
      const k = key(w);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(w);
      if (out.length >= MAX_CUSTOM) break;
    }
    return out;
  }

  /** Alle Begriffe, die mit diesen Einstellungen dran kommen können (Paket-Doppelte fliegen raus) */
  function pool(settings) {
    const s = settings || {};
    const custom = parseCustom(s.custom || []).map((w) => ({ key: key(w), word: w, level: s.customOnly ? 0 : 2, pack: 'eigene' }));
    if (s.customOnly) return custom;
    const out = [];
    const seen = new Set();
    for (const e of custom) {
      seen.add(e.key);
      out.push(e);
    }
    for (const id of s.packs || ['standard']) {
      for (const e of entries(id)) {
        if (seen.has(e.key)) continue;
        seen.add(e.key);
        out.push(e);
      }
    }
    return out;
  }

  function storage() {
    try {
      return root.localStorage || null;
    } catch {
      return null;
    }
  }

  function loadSeen() {
    const ls = storage();
    if (!ls) return new Set();
    try {
      return new Set(JSON.parse(ls.getItem(SEEN_KEY) || '[]'));
    } catch {
      return new Set();
    }
  }

  function saveSeen(seen) {
    const ls = storage();
    if (!ls) return;
    try {
      ls.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-3000)));
    } catch {
      /* Speicher voll oder gesperrt – egal */
    }
  }

  /** Ein Begriff aus der Liste: zuerst nie gesehene, dann alles außer den in diesem Spiel gespielten */
  function pickFrom(list, inGame, seen, random, taken) {
    const free = list.filter((e) => !taken.has(e.key));
    let cand = free.filter((e) => !inGame.has(e.key) && !seen.has(e.key));
    if (!cand.length) {
      // Alles schon einmal gesehen – diese Begriffe dürfen wieder vorkommen
      for (const e of list) seen.delete(e.key);
      cand = free.filter((e) => !inGame.has(e.key));
    }
    if (!cand.length) cand = free;
    if (!cand.length) return null;
    return cand[Math.floor(random() * cand.length)];
  }

  /**
   * Drei Begriffe zur Auswahl (leicht / mittel / schwer – mit „nur eigene“ drei eigene).
   * @param {object} settings Spiel-Einstellungen (packs, custom, customOnly)
   * @param {string[]} used Schlüssel der Begriffe, die in diesem Spiel schon gezeichnet wurden
   */
  function options(settings, used, opts) {
    const random = (opts && opts.random) || Math.random;
    const list = pool(settings);
    const inGame = new Set(used || []);
    const seen = loadSeen();
    const taken = new Set();
    const out = [];
    const slots = settings && settings.customOnly ? [0, 0, 0] : [1, 2, 3];
    for (const lv of slots) {
      const e = pickFrom(list.filter((x) => x.level === lv), inGame, seen, random, taken) || pickFrom(list, inGame, seen, random, taken);
      if (!e) continue;
      taken.add(e.key);
      out.push(Object.assign({}, e));
    }
    if (!out.length) out.push({ key: 'haus', word: 'Haus', level: 1, pack: 'standard' });
    return out;
  }

  /** Ein zufälliger Begriff (Einstellung „Wortwahl: zufällig“) */
  function random(settings, used, opts) {
    const list = options(settings, used, opts);
    const rnd = (opts && opts.random) || Math.random;
    return list[Math.floor(rnd() * list.length)];
  }

  /** Begriff ist gezeichnet worden: fürs nächste Spiel merken */
  function markSeen(k) {
    const seen = loadSeen();
    seen.delete(k);
    seen.add(k);
    saveSeen(seen);
  }

  function stats() {
    const ids = packIds();
    const all = new Set();
    for (const id of ids) for (const e of entries(id)) all.add(e.key);
    return { total: all.size, packs: ids.length };
  }

  root.SkWords = { LEVEL_LABEL, MAX_CUSTOM, MAX_WORD, PACK_ORDER, check, packs, packIds, entries, parseCustom, pool, options, random, markSeen, stats, key, loose };
})(typeof window !== 'undefined' ? window : globalThis);
