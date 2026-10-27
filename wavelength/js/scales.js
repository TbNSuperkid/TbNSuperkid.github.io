/*
 * Skalen für „Wavelength“ einlesen und ziehen – ohne Wiederholung im laufenden Spiel und möglichst
 * auch nicht aus früheren Spielen (der Browser merkt sich gezogene Skalen in localStorage).
 *
 * Die Skalen liegen in js/skalen/<kategorie>.js als Text, eine Zeile pro Paar:
 *   links | rechts | Stufe 1–3
 * Zeilen mit # werden ignoriert.
 */
(function (root) {
  'use strict';

  const CATEGORIES = [
    { id: 'klassisch', icon: '🌡️', label: 'Klassisch', text: 'kalt ↔ heiß', target: 100 },
    { id: 'meinung', icon: '🧠', label: 'Meinung', text: 'unterschätzt ↔ überschätzt', target: 100 },
    { id: 'kultur', icon: '🎭', label: 'Kultur', text: 'Flop ↔ Kult', target: 70 },
    { id: 'schraeg', icon: '🤪', label: 'Schräg', text: 'Hund ↔ Katze', target: 80 },
    { id: 'adult', icon: '🔥', label: 'Ab 18', text: 'nüchtern ↔ betrunken', target: 50, adult: true },
  ];
  const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
  const DEFAULT_CATEGORIES = CATEGORIES.filter((c) => !c.adult).map((c) => c.id);
  // Beide Enden zusammen, damit es auf dem Handy passt
  const MAX_CHARS = 40;
  const SEEN_KEY = 'wavelength.seen.v1';

  let cache = null;

  function category(id) {
    return CATEGORIES.find((c) => c.id === id) || null;
  }

  /** Vergleichbare Form eines Skalen-Endes (klein, ohne Umlaute und Satzzeichen) */
  function slug(text) {
    return (
      String(text || '')
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9%]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'x'
    );
  }

  /** Kennung eines Paares – gleich, egal in welcher Richtung (kalt ↔ heiß = heiß ↔ kalt) */
  function pairKey(left, right) {
    return [slug(left), slug(right)].sort().join('~');
  }

  /**
   * Eine Zeile einlesen. Gibt null zurück, wenn die Zeile ungültig ist.
   * @param {string} line
   * @param {string} cat Kategorie-ID
   */
  function parseLine(line, cat) {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length !== 3) return null;
    const [left, right, levelText] = parts;
    const level = Number(levelText);
    if (!left || !right || ![1, 2, 3].includes(level)) return null;
    return { id: cat + ':' + slug(left) + '-' + slug(right), cat, left, right, level };
  }

  function parseList(text, cat) {
    return String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => parseLine(line, cat));
  }

  /** Alle Skalen je Kategorie (ungültige Zeilen werden übersprungen) */
  function all() {
    if (!cache) {
      const S = root.WL_SKALEN || {};
      cache = {};
      for (const id of CATEGORY_IDS) cache[id] = parseList(S[id], id).filter(Boolean);
    }
    return cache;
  }

  /** Alle Skalen als eine Liste */
  function list() {
    const L = all();
    return CATEGORY_IDS.flatMap((id) => L[id]);
  }

  function byId(id) {
    return list().find((s) => s.id === id) || null;
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

  /** Gültige Kategorien-Auswahl (mindestens eine, sonst die Standard-Auswahl) */
  function cleanCategories(cats) {
    const out = CATEGORY_IDS.filter((id) => Array.isArray(cats) && cats.includes(id));
    return out.length ? out : DEFAULT_CATEGORIES.slice();
  }

  /** Skalen der gewählten Kategorien (zur Not alle ohne Ab 18) */
  function pool(cats) {
    const L = all();
    const inCats = cleanCategories(cats).flatMap((c) => L[c]);
    return inCats.length ? inCats : DEFAULT_CATEGORIES.flatMap((c) => L[c]);
  }

  /**
   * Zieht eine Skala: zuerst eine, die weder in diesem Spiel noch in früheren Spielen dran war.
   * @param {string[]} cats Kategorien
   * @param {string[]} usedInGame IDs der Skalen, die in diesem Spiel schon dran waren (wird ergänzt)
   * @param {{random?: Function, flip?: boolean}} [opts] flip: false = nie umdrehen (Tests)
   * @returns {{id, cat, left, right, level}} Die Enden werden zufällig vertauscht, damit „gut“ nicht immer rechts ist
   */
  function draw(cats, usedInGame, opts) {
    const o = opts || {};
    const rnd = o.random || Math.random;
    const scales = pool(cats);
    if (!scales.length) return null;
    const used = new Set(usedInGame || []);
    const seen = loadSeen();
    let candidates = scales.filter((s) => !used.has(s.id) && !seen.has(s.id));
    if (!candidates.length) {
      // Alle schon einmal gesehen – gesehene Skalen dieser Auswahl zurückmischen
      for (const s of scales) seen.delete(s.id);
      candidates = scales.filter((s) => !used.has(s.id));
    }
    if (!candidates.length) candidates = scales;
    const s = candidates[Math.floor(rnd() * candidates.length)];
    seen.add(s.id);
    saveSeen(seen);
    if (Array.isArray(usedInGame)) usedInGame.push(s.id);
    // Etwa jede dritte Skala umgedreht – sonst steht das „Gute“ fast immer rechts
    const flip = o.flip !== false && rnd() < 0.3;
    return { id: s.id, cat: s.cat, left: flip ? s.right : s.left, right: flip ? s.left : s.right, level: s.level };
  }

  /** Eigene Skala (Einstellung „Eigene Skala“) */
  function custom(left, right) {
    return { id: 'eigene:' + slug(left) + '-' + slug(right), cat: 'eigene', left, right, level: 0, custom: true };
  }

  function stats() {
    const L = all();
    const out = { total: 0 };
    for (const c of CATEGORIES) {
      out[c.id] = L[c.id].length;
      out.total += L[c.id].length;
    }
    return out;
  }

  root.WLScales = {
    CATEGORIES,
    CATEGORY_IDS,
    DEFAULT_CATEGORIES,
    MAX_CHARS,
    category,
    slug,
    pairKey,
    parseLine,
    parseList,
    all,
    list,
    byId,
    cleanCategories,
    pool,
    draw,
    custom,
    stats,
  };
})(typeof window !== 'undefined' ? window : globalThis);
