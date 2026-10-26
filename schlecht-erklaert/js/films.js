/*
 * Filme für „Schlecht erklärt“ einlesen und ziehen – ohne Wiederholung im laufenden Spiel und möglichst
 * auch nicht aus früheren Spielen (der Browser merkt sich gezogene Filme in localStorage).
 *
 * Die Filme liegen in js/filme/<kategorie>.js als Text, eine Zeile pro Film:
 *   Titel | weitere Antworten (; getrennt, ~ = Reihenname) | Jahr | Stufe 1–3 | Beschreibung | Tipp
 * Zeilen mit # werden ignoriert.
 */
(function (root) {
  'use strict';

  const CATEGORIES = [
    { id: 'animation', icon: '🧸', label: 'Animation & Familie', target: 90 },
    { id: 'action', icon: '💥', label: 'Action & Abenteuer', target: 75 },
    { id: 'komoedie', icon: '😂', label: 'Komödie', target: 75 },
    { id: 'fantasy', icon: '🚀', label: 'Sci-Fi & Fantasy', target: 80 },
    { id: 'spannung', icon: '🔪', label: 'Spannung & Horror', target: 70 },
    { id: 'drama', icon: '💔', label: 'Drama & Liebe', target: 75 },
    { id: 'deutsch', icon: '🇩🇪', label: 'Deutsche Filme', target: 55 },
    { id: 'klassiker', icon: '🎩', label: 'Klassiker', target: 40 },
    { id: 'serien', icon: '📺', label: 'Serien', target: 50, series: true },
  ];
  const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
  const DEFAULT_CATEGORIES = CATEGORIES.filter((c) => !c.series).map((c) => c.id);
  const LEVELS = {
    easy: [1],
    mixed: [1, 2],
    all: [1, 2, 3],
    hard: [2, 3],
  };
  const LEVEL_IDS = Object.keys(LEVELS);
  const MIN_YEAR = 1920;
  const MAX_YEAR = 2026;
  const SEEN_KEY = 'schlechterklaert.seen.v1';

  let cache = null;

  function category(id) {
    return CATEGORIES.find((c) => c.id === id) || null;
  }

  function slug(text) {
    return root.SETitles.words(text).join('-') || 'x';
  }

  /**
   * Eine Zeile einlesen. Gibt null zurück, wenn die Zeile ungültig ist.
   * @param {string} line
   * @param {string} cat Kategorie-ID
   */
  function parseLine(line, cat) {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length !== 6) return null;
    const [title, altText, yearText, levelText, text, tip] = parts;
    const year = Number(yearText);
    const level = Number(levelText);
    if (!title || !text || !tip) return null;
    if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return null;
    if (![1, 2, 3].includes(level)) return null;
    const alts = altText
      .split(';')
      .map((a) => a.trim())
      .filter(Boolean);
    return { id: cat + ':' + slug(title), cat, title, alts, year, level, text, tip };
  }

  function parseList(text, cat) {
    return String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => parseLine(line, cat));
  }

  /** Alle Filme je Kategorie (ungültige Zeilen werden übersprungen) */
  function all() {
    if (!cache) {
      const F = root.SE_FILME || {};
      cache = {};
      for (const id of CATEGORY_IDS) cache[id] = parseList(F[id], id).filter(Boolean);
    }
    return cache;
  }

  /** Alle Filme als eine Liste */
  function list() {
    const L = all();
    return CATEGORY_IDS.flatMap((id) => L[id]);
  }

  function byId(id) {
    return list().find((f) => f.id === id) || null;
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

  /** Filme, die zu Kategorien und Schwierigkeit passen (zur Not alle aus den Kategorien bzw. alle) */
  function pool(cats, level) {
    const levels = LEVELS[level] || LEVELS.mixed;
    const L = all();
    const inCats = (cats || []).filter((c) => L[c]).flatMap((c) => L[c]);
    const fit = inCats.filter((f) => levels.includes(f.level));
    if (fit.length) return fit;
    if (inCats.length) return inCats;
    return list();
  }

  /**
   * Zieht einen Film: zuerst einen, der weder in diesem Spiel noch in früheren Spielen dran war.
   * @param {string[]} cats Kategorien
   * @param {string} level Schwierigkeit (easy | mixed | all | hard)
   * @param {string[]} usedInGame IDs der Filme, die in diesem Spiel schon dran waren (wird ergänzt)
   * @param {{random?: Function}} [opts]
   */
  function draw(cats, level, usedInGame, opts) {
    const rnd = (opts && opts.random) || Math.random;
    const films = pool(cats, level);
    if (!films.length) return null;
    const used = new Set(usedInGame || []);
    const seen = loadSeen();
    let candidates = films.filter((f) => !used.has(f.id) && !seen.has(f.id));
    if (!candidates.length) {
      // Alle schon einmal gesehen – gesehene Filme dieser Auswahl zurückmischen
      for (const f of films) seen.delete(f.id);
      candidates = films.filter((f) => !used.has(f.id));
    }
    if (!candidates.length) candidates = films;
    const f = candidates[Math.floor(rnd() * candidates.length)];
    seen.add(f.id);
    saveSeen(seen);
    if (Array.isArray(usedInGame)) usedInGame.push(f.id);
    return Object.assign({}, f, { alts: f.alts.slice() });
  }

  function shuffle(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * 4 Antworten für den Auswahl-Modus: der Film + 3 aus derselben Kategorie, möglichst aus ähnlicher Zeit.
   * @returns {string[]} Titel in zufälliger Reihenfolge
   */
  function choices(film, opts) {
    const rnd = (opts && opts.random) || Math.random;
    const T = root.SETitles;
    const others = list().filter((f) => f.id !== film.id && T.check(f.title, film) === 'no' && T.check(film.title, f) === 'no');
    const picked = [];
    const take = (cands) => {
      for (const f of shuffle(cands, rnd)) {
        if (picked.length >= 3) return;
        if (!picked.some((p) => p.title === f.title)) picked.push(f);
      }
    };
    take(others.filter((f) => f.cat === film.cat && Math.abs(f.year - film.year) <= 12));
    take(others.filter((f) => f.cat === film.cat));
    take(others.filter((f) => Math.abs(f.year - film.year) <= 12));
    take(others);
    return shuffle([film.title].concat(picked.map((f) => f.title)), rnd);
  }

  function stats() {
    const L = all();
    const out = { total: 0, films: 0 };
    for (const c of CATEGORIES) {
      out[c.id] = L[c.id].length;
      out.total += L[c.id].length;
      if (!c.series) out.films += L[c.id].length;
    }
    return out;
  }

  /** Titel + weitere Antworten aller Einträge (für die Vorschläge beim Tippen) */
  function titles() {
    return list().map((f) => ({ title: f.title, alts: f.alts }));
  }

  root.SEFilms = {
    CATEGORIES,
    CATEGORY_IDS,
    DEFAULT_CATEGORIES,
    LEVELS,
    LEVEL_IDS,
    MIN_YEAR,
    MAX_YEAR,
    category,
    parseLine,
    all,
    list,
    byId,
    pool,
    draw,
    choices,
    stats,
    titles,
    _parseList: parseList,
  };
})(typeof window !== 'undefined' ? window : globalThis);
