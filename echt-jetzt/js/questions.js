/*
 * Fragen für „Echt jetzt?“ einlesen, prüfen, Kategorien anbieten und ziehen – ohne Wiederholung im laufenden Spiel
 * und möglichst auch nicht aus früheren Spielen (der Browser merkt sich gezogene Fragen in localStorage).
 *
 * Die Fragen liegen in js/fragen/<kategorie>.js als Text, eine Zeile pro Frage:
 *   Frage mit ___ | Wahrheit | weitere Formen (;) | Köder 1; Köder 2; Köder 3 | Quelle
 * Wörterbuch (js/fragen/woerterbuch.js):
 *   Wort | Erklärung (Wahrheit) | weitere Formen (;) | Köder 1; Köder 2; Köder 3 | Quelle
 * Zeilen mit # werden ignoriert.
 */
(function (root) {
  'use strict';

  const Match = root.GameMatch;

  const CATEGORIES = [
    { id: 'gesetze', icon: '⚖️', label: 'Kuriose Gesetze', text: 'Verbote, Vorschriften, Urteile' },
    { id: 'tiere', icon: '🐾', label: 'Tiere', text: 'Rekorde, Namen, seltsames Verhalten' },
    { id: 'erfindungen', icon: '🔧', label: 'Erfindungen', text: 'Wofür es ursprünglich gedacht war' },
    { id: 'menschen', icon: '🧑', label: 'Menschen & Rekorde', text: 'Berühmte Leute, schräge Geschichten' },
    { id: 'deutschland', icon: '🇩🇪', label: 'Deutschland', text: 'Orte, Bräuche, Bürokratie' },
    { id: 'essen', icon: '🍕', label: 'Essen', text: 'Woher es kommt, was drin ist' },
    { id: 'orte', icon: '🌍', label: 'Orte & Namen', text: 'Seltsame Ortsnamen, Länder, Städte' },
  ];
  const DICT = { id: 'woerterbuch', icon: '📖', label: 'Wörterbuch', text: 'Seltene echte Wörter erklären' };
  const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
  const ALL_IDS = CATEGORY_IDS.concat(DICT.id);
  const MODES = ['facts', 'dict', 'mixed'];
  const BLANK = '___';
  const MAX_TRUTH = 30;
  const MAX_TRUTH_DICT = 70;
  const MIN_DECOYS = 3;
  const SEEN_KEY = 'echtjetzt.seen.v1';
  const MIXED_DICT_SHARE = 0.3; // gemischt, ohne Kategorie-Wahl: so oft kommt ein Wort dran

  let cache = null;

  /** Vergleichbare Form (klein, ohne Umlaute und Satzzeichen) */
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
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'x'
    );
  }

  function countBlanks(text) {
    return String(text).split(BLANK).length - 1;
  }

  function splitList(s) {
    return String(s || '')
      .split(';')
      .map((x) => x.trim())
      .filter(Boolean);
  }

  /**
   * Eine Zeile einlesen. Gibt null zurück, wenn die Zeile ungültig ist.
   * @returns {{id, cat, kind: 'fact'|'dict', text, truth, forms: string[], decoys: string[], source}|null}
   */
  function parseLine(line, cat) {
    const parts = String(line || '')
      .split('|')
      .map((x) => x.trim());
    if (parts.length !== 5) return null;
    const [text, truth, forms, decoys, source] = parts;
    const dict = cat === DICT.id;
    if (!text || !truth || !/^https?:\/\/\S+$/.test(source)) return null;
    if (dict) {
      if (countBlanks(text) !== 0 || truth.length > MAX_TRUTH_DICT) return null;
    } else if (countBlanks(text) !== 1 || /____/.test(text) || truth.length > MAX_TRUTH) return null;
    const d = splitList(decoys);
    if (d.length < MIN_DECOYS) return null;
    return {
      id: cat + ':' + slug(text).slice(0, 60),
      cat,
      kind: dict ? 'dict' : 'fact',
      text,
      truth,
      forms: splitList(forms),
      decoys: d,
      source,
    };
  }

  function parseList(text, cat) {
    return String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => parseLine(line, cat));
  }

  /** Alle Fragen je Kategorie (ungültige Zeilen werden übersprungen) */
  function all() {
    if (!cache) {
      const F = root.EJ_FRAGEN || {};
      cache = {};
      for (const id of ALL_IDS) cache[id] = parseList(F[id], id).filter(Boolean);
    }
    return cache;
  }

  function list() {
    const L = all();
    return ALL_IDS.flatMap((id) => L[id]);
  }

  function byId(id) {
    return list().find((q) => q.id === id) || null;
  }

  function category(id) {
    if (id === DICT.id) return DICT;
    return CATEGORIES.find((c) => c.id === id) || null;
  }

  /** Gültige Kategorien-Auswahl (mindestens eine, sonst alle) */
  function cleanCategories(cats) {
    const out = CATEGORY_IDS.filter((id) => Array.isArray(cats) && cats.includes(id));
    return out.length ? out : CATEGORY_IDS.slice();
  }

  /** Welche Kategorien kommen in diesem Modus in Frage? */
  function modeCategories(settings) {
    const s = settings || {};
    const mode = MODES.includes(s.mode) ? s.mode : 'facts';
    if (mode === 'dict') return [DICT.id];
    const facts = cleanCategories(s.categories);
    return mode === 'mixed' ? facts.concat(DICT.id) : facts;
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

  /** Wie viele Fragen einer Kategorie sind in diesem Spiel noch frei? */
  function remaining(cat, usedInGame) {
    const used = new Set(usedInGame || []);
    return (all()[cat] || []).filter((q) => !used.has(q.id)).length;
  }

  /**
   * Bietet bis zu n Kategorien zur Wahl an (nur solche mit freien Fragen). Gemischt: das Wörterbuch ist immer dabei.
   * @returns {string[]} Kategorie-IDs
   */
  function offer(settings, usedInGame, random, n) {
    const rnd = random || Math.random;
    const count = n || 3;
    const cats = modeCategories(settings).filter((c) => remaining(c, usedInGame) > 0);
    const pool = cats.length ? cats : modeCategories(settings);
    const out = [];
    if (pool.includes(DICT.id) && pool.length > 1) out.push(DICT.id);
    const rest = pool.filter((c) => !out.includes(c));
    while (out.length < count && rest.length) out.push(rest.splice(Math.floor(rnd() * rest.length), 1)[0]);
    // Wörterbuch nicht immer an erster Stelle
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** Kategorie ohne Wahl: gemischt ~30 % Wörterbuch, sonst eine zufällige Fakten-Kategorie (nach Vorrat gewichtet) */
  function randomCategory(settings, usedInGame, random) {
    const rnd = random || Math.random;
    const cats = modeCategories(settings);
    const facts = cats.filter((c) => c !== DICT.id);
    if (!facts.length) return DICT.id;
    if (cats.includes(DICT.id) && remaining(DICT.id, usedInGame) > 0 && rnd() < MIXED_DICT_SHARE) return DICT.id;
    const free = facts.filter((c) => remaining(c, usedInGame) > 0);
    const from = free.length ? free : facts;
    const weights = from.map((c) => Math.max(1, remaining(c, usedInGame)));
    let x = rnd() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < from.length; i++) {
      x -= weights[i];
      if (x < 0) return from[i];
    }
    return from[from.length - 1];
  }

  /**
   * Zieht eine Frage aus einer Kategorie: zuerst eine, die weder in diesem Spiel noch in früheren Spielen dran war.
   * @param {string} cat
   * @param {string[]} usedInGame IDs, die in diesem Spiel schon dran waren (wird ergänzt)
   */
  function draw(cat, usedInGame, random) {
    const rnd = random || Math.random;
    const from = all()[cat] && all()[cat].length ? all()[cat] : list();
    const used = new Set(usedInGame || []);
    const seen = loadSeen();
    const pick = (cands) => (cands.length ? cands[Math.floor(rnd() * cands.length)] : null);
    let q = pick(from.filter((x) => !used.has(x.id) && !seen.has(x.id)));
    if (!q) {
      // Alles schon einmal gesehen – Gesehenes dieser Kategorie zurückmischen
      for (const x of from) seen.delete(x.id);
      q = pick(from.filter((x) => !used.has(x.id))) || pick(from);
    }
    seen.add(q.id);
    saveSeen(seen);
    if (Array.isArray(usedInGame) && !usedInGame.includes(q.id)) usedInGame.push(q.id);
    return q;
  }

  /* ---------- Antworten vergleichen ---------- */

  /** Vergleichsform: wie match.js (Artikel, Umlaute, Satzzeichen egal), aber auch Artikel/„für“ nach dem ersten Wort */
  function norm(text) {
    return Match.normalize(
      String(text || '')
        .toLowerCase()
        .replace(/^(für|fuer|als|zum|zur|zu|im|in|am|an|auf|mit|aus|von|vom)\s+/, '')
        .trim()
    );
  }

  function digits(text) {
    return (String(text || '').match(/\d+/g) || []).join(' ');
  }

  /** Zwei Antworten gelten als gleich (Groß/klein, Plural, kleine Tippfehler, Artikel egal – Zahlen müssen genau passen) */
  function same(a, b) {
    const x = norm(a);
    const y = norm(b);
    if (!x || !y) return false;
    if (digits(a) !== digits(b)) return false;
    if (x === y) return true;
    return Match.same(x, y);
  }

  const FILLER = new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines']);

  /** Einzelne Wörter (klein, Umlaute ausgeschrieben, ohne Artikel) */
  function words(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .split(/[^a-z0-9]+/)
      .filter((w) => w && !FILLER.has(w));
  }

  /**
   * Ist die Lüge (fast) die Wahrheit?
   * Gleich mit der Wahrheit oder einer weiteren Form – oder die Wahrheit steckt als ganzes Wort darin
   * („Kaugummi mit Minze“, aber nicht „Augenlider“ bei „Augen“).
   */
  function tooClose(lie, q) {
    if (!norm(lie)) return false;
    const lw = words(lie);
    for (const t of [q.truth].concat(q.forms || [])) {
      if (same(lie, t)) return true;
      if (q.kind === 'dict') continue;
      const tw = words(t);
      if (!tw.length || tw.length >= lw.length) continue;
      if (tw.length === 1) {
        if (tw[0].length >= 4 && lw.some((w) => same(w, tw[0]))) return true;
      } else if ((' ' + lw.join(' ') + ' ').includes(' ' + tw.join(' ') + ' ')) return true;
    }
    return false;
  }

  /** Text hübsch machen: Leerzeichen, kein Punkt am Ende, Wörterbuch: erster Buchstabe groß */
  function tidy(text, kind) {
    let t = String(text == null ? '' : text)
      .replace(/[\u0000-\u001f<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.。]+$/, '')
      .trim();
    if (kind === 'dict' && t) t = t[0].toLocaleUpperCase('de-DE') + t.slice(1);
    return t;
  }

  /** Frage zum Vorlesen: Lücke als „Dingsbums“, Wörterbuch: „Was ist …?“ */
  function speakable(q) {
    if (!q) return '';
    if (q.kind === 'dict') return `Was bedeutet ${q.text}?`;
    return String(q.text || '')
      .replace(/___/g, 'Dingsbums')
      .trim();
  }

  function stats() {
    const L = all();
    const out = { total: 0, facts: 0 };
    for (const id of ALL_IDS) {
      out[id] = L[id].length;
      out.total += L[id].length;
      if (id !== DICT.id) out.facts += L[id].length;
    }
    return out;
  }

  root.EchtJetztQuestions = {
    CATEGORIES,
    CATEGORY_IDS,
    ALL_IDS,
    DICT,
    MODES,
    BLANK,
    MAX_TRUTH,
    MAX_TRUTH_DICT,
    MIN_DECOYS,
    slug,
    countBlanks,
    parseLine,
    parseList,
    all,
    list,
    byId,
    category,
    cleanCategories,
    modeCategories,
    remaining,
    offer,
    randomCategory,
    draw,
    norm,
    same,
    tooClose,
    tidy,
    speakable,
    stats,
  };
})(typeof window !== 'undefined' ? window : globalThis);
