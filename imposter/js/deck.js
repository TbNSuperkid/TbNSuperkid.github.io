/*
 * Wörter und Fragen für „Imposter“ ziehen – ohne Wiederholung im laufenden Spiel und möglichst auch nicht
 * aus früheren Spielen (der Browser merkt sich Gesehenes in localStorage).
 * Außerdem: Wort raten prüfen (Plural, Tippfehler, „Pilot“ = „Pilot:in“).
 */
(function (root) {
  'use strict';

  const CATEGORIES = [
    { id: 'essen', label: 'Essen & Trinken', icon: '🍕' },
    { id: 'orte', label: 'Orte', icon: '🏖️' },
    { id: 'tiere', label: 'Tiere', icon: '🐧' },
    { id: 'berufe', label: 'Berufe', icon: '👩‍🚒' },
    { id: 'dinge', label: 'Dinge', icon: '☂️' },
    { id: 'film', label: 'Film & Serien', icon: '🎬' },
    { id: 'aktiv', label: 'Aktivitäten', icon: '⛷️' },
    { id: 'adult', label: '18+', icon: '🔞', adult: true },
  ];
  const SEEN_KEY = 'imposter.seen.v1';
  let cache = null;

  function lines(text) {
    return String(text || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  }

  /** Wörter: Kategorie|Wort|ähnliches Wort */
  function parseWords(text) {
    return lines(text).map((l) => {
      const [category, word, decoy] = l.split('|').map((x) => (x || '').trim());
      return { key: 'w:' + String(word).toLowerCase(), category, word, decoy };
    });
  }

  /** Fragen: Crew-Frage|Imposter-Frage */
  function parseQuestions(text, adult) {
    return lines(text).map((l) => {
      const [crew, imposter] = l.split('|').map((x) => (x || '').trim());
      return { key: 'q:' + String(crew).toLowerCase(), crew, imposter, adult: !!adult };
    });
  }

  function all() {
    if (!cache) {
      const W = root.IM_WORDS || {};
      cache = {
        words: parseWords(W.woerter),
        questions: parseQuestions(W.fragen, false).concat(parseQuestions(W.fragenAdult, true)),
      };
    }
    return cache;
  }

  function category(id) {
    return CATEGORIES.find((c) => c.id === id) || { id, label: id, icon: '❓' };
  }

  function defaultCategories() {
    return CATEGORIES.filter((c) => !c.adult).map((c) => c.id);
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

  /** Eintrag ziehen: erst Ungesehenes, sonst wird der Stapel zurückgemischt */
  function pick(entries, usedInGame, random) {
    const rnd = random || Math.random;
    if (!entries.length) return null;
    const used = new Set(usedInGame || []);
    const seen = loadSeen();
    let candidates = entries.filter((e) => !used.has(e.key) && !seen.has(e.key));
    if (!candidates.length) {
      for (const e of entries) seen.delete(e.key);
      candidates = entries.filter((e) => !used.has(e.key));
    }
    if (!candidates.length) candidates = entries;
    const entry = candidates[Math.floor(rnd() * candidates.length)];
    seen.add(entry.key);
    saveSeen(seen);
    if (Array.isArray(usedInGame)) usedInGame.push(entry.key);
    return Object.assign({}, entry);
  }

  /** @param {{categories: string[], used?: string[], random?: Function}} o */
  function drawWord(o) {
    const cats = o && o.categories && o.categories.length ? o.categories : defaultCategories();
    let entries = all().words.filter((w) => cats.includes(w.category));
    if (!entries.length) entries = all().words.filter((w) => w.category !== 'adult');
    return pick(entries, o && o.used, o && o.random);
  }

  /** @param {{adult?: boolean, used?: string[], random?: Function}} o */
  function drawQuestion(o) {
    const entries = all().questions.filter((q) => !q.adult || (o && o.adult));
    return pick(entries, o && o.used, o && o.random);
  }

  function counts() {
    const out = { words: all().words.length, questions: all().questions.length, adultQuestions: 0 };
    for (const c of CATEGORIES) out[c.id] = all().words.filter((w) => w.category === c.id).length;
    out.adultQuestions = all().questions.filter((q) => q.adult).length;
    return out;
  }

  /* ---------- Wort raten ---------- */

  function plainUmlauts(s) {
    return String(s).replace(/ä/gi, 'a').replace(/ö/gi, 'o').replace(/ü/gi, 'u');
  }

  /** Varianten eines Wortes, die beim Raten zählen: „Ärzt:in“ → Ärztin, Ärzt, (Arzt) · „Pizza“ → Pizzen */
  function variants(word) {
    const w = String(word || '');
    const out = [w, w.replace(/:in\b/g, 'in'), w.replace(/:in\b/g, '')];
    // Plural, den match.js nicht kennt: Pizza → Pizzen, Museum → Museen, Globus → Globen
    if (/(a|um|us)$/i.test(w)) out.push(w.replace(/(a|um|us)$/i, 'en'));
    return [...new Set(out.filter(Boolean))];
  }

  /** Hat der Imposter das Wort erraten? Groß/klein, Artikel, Plural und kleine Tippfehler sind egal. */
  function guessMatches(guess, word) {
    const M = root.GameMatch;
    const g = String(guess || '').trim();
    if (!g) return false;
    return variants(word).some((v) => M.same(g, v) || M.same(plainUmlauts(g), plainUmlauts(v)));
  }

  root.IMDeck = {
    CATEGORIES,
    category,
    defaultCategories,
    drawWord,
    drawQuestion,
    counts,
    all,
    guessMatches,
    variants,
    _parseWords: parseWords,
    _parseQuestions: parseQuestions,
  };
})(typeof window !== 'undefined' ? window : globalThis);
