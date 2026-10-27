/*
 * Wörter für „Nur einer“ – Adapter für alle Quellen:
 *  - eigene Liste (js/woerter.js, Stufen 1–3)
 *  - Guess the word!, Kategorie Erklären (leicht/mittel/schwer → Stufe 1/2/3)
 *  - Imposter (ohne 18+; Essen, Orte, Tiere, Dinge → Stufe 1, der Rest → Stufe 2)
 * Doppelte (auch Plural/Schreibweise) fliegen raus, die erste Quelle gewinnt.
 * Gezogen wird ohne Wiederholung im Spiel und möglichst auch nicht aus früheren Spielen
 * (der Browser merkt sich gespielte Wörter in localStorage, wie deck.js bei 2 Dumme).
 */
(function (root) {
  'use strict';

  const SEEN_KEY = 'nureiner.seen.v1';
  const LEVELS = {
    easy: [1],
    mixed: [1, 2],
    hard: [2, 3],
  };
  const LEVEL_IDS = Object.keys(LEVELS);
  const IMPOSTER_LEVEL = { essen: 1, orte: 1, tiere: 1, dinge: 1, berufe: 2, aktiv: 2, film: 2 };
  const ERKLAEREN_LEVEL = { leicht: 1, mittel: 2, schwer: 3 };
  // „Ärzt:in“ → Arzt (für alle anderen reicht es, „:in“ wegzulassen)
  const MALE = { 'ärzt': 'Arzt', 'zahnärzt': 'Zahnarzt', 'köch': 'Koch', 'anwält': 'Anwalt', 'archäolog': 'Archäologe', 'psycholog': 'Psychologe' };
  let cache = null;

  function lines(text) {
    return String(text || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  }

  function key(word) {
    return root.GameMatch.normalize(word);
  }

  function ungender(word) {
    if (!/:in$/.test(word)) return word;
    const base = word.slice(0, -3);
    return MALE[base.toLowerCase()] || base;
  }

  /** Alle Quellen als [{word, level, src}] (mit Doppelten) */
  function sources() {
    const out = [];
    const own = root.NE_WORDS || {};
    for (const lv of [1, 2, 3]) for (const w of lines(own[lv])) out.push({ word: w, level: lv, src: 'eigene' });
    const erk = (root.ACTIVITY_WORDS || {}).erklaeren || {};
    for (const [diff, lv] of Object.entries(ERKLAEREN_LEVEL)) {
      for (const l of lines(erk[diff])) out.push({ word: l.split('|')[0].trim(), level: lv, src: 'guess-the-word' });
    }
    for (const l of lines((root.IM_WORDS || {}).woerter)) {
      const [cat, w] = l.split('|').map((x) => (x || '').trim());
      if (!IMPOSTER_LEVEL[cat] || !w) continue;
      out.push({ word: ungender(w), level: IMPOSTER_LEVEL[cat], src: 'imposter' });
    }
    return out;
  }

  /** Alle Wörter ohne Doppelte: [{key, word, level, src}] */
  function all() {
    if (cache) return cache;
    const seen = new Set();
    cache = [];
    for (const e of sources()) {
      const k = key(e.word);
      if (!k || seen.has(k)) continue;
      // Plural-Doppelte wie Stern / Sterne
      if (cache.some((x) => x.level === e.level && root.GameMatch.same(x.word, e.word))) continue;
      seen.add(k);
      cache.push({ key: k, word: e.word, level: e.level, src: e.src });
    }
    return cache;
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
      ls.setItem(SEEN_KEY, JSON.stringify([...seen]));
    } catch {
      /* Speicher voll oder gesperrt – egal */
    }
  }

  /**
   * Zieht ein Wort.
   * @param {string} level easy | mixed | hard
   * @param {string[]} used Schlüssel der Wörter, die in diesem Spiel schon dran waren (wird ergänzt)
   * @param {{random?: Function}} [opts]
   */
  function draw(level, used, opts) {
    const random = (opts && opts.random) || Math.random;
    const levels = LEVELS[level] || LEVELS.mixed;
    const entries = all().filter((e) => levels.includes(e.level));
    if (!entries.length) return { key: 'sonne', word: 'Sonne', level: 1, src: 'eigene' };
    const inGame = new Set(used || []);
    const seen = loadSeen();
    let candidates = entries.filter((e) => !inGame.has(e.key) && !seen.has(e.key));
    if (!candidates.length) {
      // Alles schon einmal gesehen – gesehene Wörter dieser Stufen zurückmischen
      for (const e of entries) seen.delete(e.key);
      candidates = entries.filter((e) => !inGame.has(e.key));
    }
    if (!candidates.length) candidates = entries;
    const entry = candidates[Math.floor(random() * candidates.length)];
    seen.add(entry.key);
    saveSeen(seen);
    if (Array.isArray(used)) used.push(entry.key);
    return Object.assign({}, entry);
  }

  function stats() {
    const list = all();
    const out = { total: list.length, 1: 0, 2: 0, 3: 0 };
    for (const e of list) out[e.level] += 1;
    return out;
  }

  root.NEWords = { LEVELS, LEVEL_IDS, all, sources, draw, stats, key, ungender };
})(typeof window !== 'undefined' ? window : globalThis);
