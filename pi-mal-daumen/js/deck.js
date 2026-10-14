/*
 * Fragen für „Pi mal Daumen“ einlesen und ziehen – ohne Wiederholung im laufenden Spiel und möglichst
 * auch nicht aus früheren Spielen (der Browser merkt sich gesehene Fragen in localStorage).
 *
 * Die Fragen liegen in js/fragen/<kategorie>.js als Text, eine Zeile pro Frage:
 *   Wissen:   Frage | Antwort | Einheit | Fun Fact (optional)
 *   Über uns: Frage | sum oder count | Einheit | Frage an jede Person
 * Zeilen mit # werden ignoriert.
 */
(function (root) {
  'use strict';

  const CATEGORIES = [
    { id: 'erde', icon: '🌍', label: 'Erde & Geografie' },
    { id: 'geschichte', icon: '🏛️', label: 'Geschichte' },
    { id: 'natur', icon: '🐘', label: 'Tiere & Natur' },
    { id: 'mensch', icon: '🧍', label: 'Mensch & Körper' },
    { id: 'technik', icon: '🚀', label: 'Weltall & Technik' },
    { id: 'alltag', icon: '🍕', label: 'Alltag & Essen' },
    { id: 'sport', icon: '⚽', label: 'Sport & Rekorde' },
    { id: 'pop', icon: '🎬', label: 'Pop & Medien' },
    { id: 'ab18', icon: '🔞', label: '18+', adult: true },
    { id: 'uns', icon: '🫵', label: 'Über uns', live: true },
  ];
  const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
  const DEFAULT_CATEGORIES = CATEGORIES.filter((c) => !c.adult).map((c) => c.id);
  const AGGREGATES = ['sum', 'count'];
  const SEEN_KEY = 'pimaldaumen.seen.v1';

  let cache = null;

  function category(id) {
    return CATEGORIES.find((c) => c.id === id) || null;
  }

  function keyOf(text) {
    return String(text)
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]+/g, ' ')
      .trim();
  }

  /**
   * Eine Zeile einlesen. Gibt null zurück, wenn die Zeile ungültig ist.
   * @param {string} line
   * @param {string} cat Kategorie-ID
   */
  function parseLine(line, cat) {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length < 3 || !parts[0]) return null;
    const [text, answerText, unit, extra] = parts;
    if (cat === 'uns') {
      if (!AGGREGATES.includes(answerText) || !extra) return null;
      return { key: keyOf(text), cat, kind: 'uns', text, agg: answerText, unit, ask: extra, answer: null, fact: '' };
    }
    const answer = Number(answerText);
    if (answerText === '' || !Number.isFinite(answer)) return null;
    return { key: keyOf(text), cat, kind: 'fact', text, answer, unit, fact: extra || '' };
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
      const F = root.PMD_FRAGEN || {};
      cache = {};
      for (const id of CATEGORY_IDS) cache[id] = parseList(F[id], id).filter(Boolean);
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
   * Zieht eine Frage. Erst wird zufällig eine der gewählten Kategorien bestimmt (gewichtet nach Anzahl
   * Fragen, „Über uns“ seltener), dann eine noch nicht gesehene Frage daraus.
   * @param {string[]} cats Kategorien, aus denen gezogen wird
   * @param {string[]} usedInGame Schlüssel der Fragen, die in diesem Spiel schon dran waren (wird ergänzt)
   * @param {{random?: Function}} [opts]
   */
  function draw(cats, usedInGame, opts) {
    const rnd = (opts && opts.random) || Math.random;
    const L = all();
    let pools = (cats || []).filter((c) => L[c] && L[c].length);
    if (!pools.length) pools = DEFAULT_CATEGORIES.filter((c) => c !== 'uns' && L[c].length);
    if (!pools.length) return { key: '?', cat: 'erde', kind: 'fact', text: 'Keine Fragen gefunden', answer: 0, unit: '', fact: '' };
    const used = new Set(usedInGame || []);
    const seen = loadSeen();
    const fresh = (c) => L[c].filter((q) => !used.has(q.key) && !seen.has(q.key));
    // Kategorie wählen: Gewicht = Anzahl Fragen (Über uns zählt nur ein Viertel, damit es besonders bleibt)
    const weight = (c) => (c === 'uns' ? L[c].length / 4 : L[c].length);
    const total = pools.reduce((s, c) => s + weight(c), 0);
    let r = rnd() * total;
    let cat = pools[pools.length - 1];
    for (const c of pools) {
      r -= weight(c);
      if (r < 0) {
        cat = c;
        break;
      }
    }
    let candidates = fresh(cat);
    if (!candidates.length) {
      // Alle schon einmal gesehen – gesehene Fragen dieser Kategorie zurückmischen
      for (const q of L[cat]) seen.delete(q.key);
      candidates = L[cat].filter((q) => !used.has(q.key));
    }
    if (!candidates.length) candidates = L[cat];
    const q = candidates[Math.floor(rnd() * candidates.length)];
    seen.add(q.key);
    saveSeen(seen);
    if (Array.isArray(usedInGame)) usedInGame.push(q.key);
    return Object.assign({}, q);
  }

  function stats() {
    const L = all();
    const out = { total: 0 };
    for (const id of CATEGORY_IDS) {
      out[id] = L[id].length;
      out.total += L[id].length;
    }
    return out;
  }

  root.PMDDeck = { CATEGORIES, CATEGORY_IDS, DEFAULT_CATEGORIES, AGGREGATES, category, draw, stats, all, keyOf, parseLine, _parseList: parseList };
})(typeof window !== 'undefined' ? window : globalThis);
