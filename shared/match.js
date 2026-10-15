/*
 * Wörter vergleichen (gemeinsam für alle Spiele): Wann sagen zwei Leute "dasselbe"?
 *  - Groß/klein, Leerzeichen, Satzzeichen, Umlaute (ä = ae) und Artikel sind egal
 *  - Plural zählt als gleich (Rakete = Raketen, Kind = Kinder)
 *  - kleine Tippfehler bei längeren Wörtern zählen als gleich (Gitare = Gitarre)
 */
(function (root) {
  'use strict';

  const ARTICLE = /^(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines)\s+/;
  const PLURAL_ENDINGS = ['e', 'n', 'en', 's', 'er', 'es', 'nen'];

  function normalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .trim()
      .replace(ARTICLE, '')
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[éèêë]/g, 'e')
      .replace(/[áàâ]/g, 'a')
      .replace(/[^a-z0-9]/g, '');
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  /** Gelten zwei Wörter als gleich? */
  function same(a, b) {
    const x = normalize(a);
    const y = normalize(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const [short, long] = x.length <= y.length ? [x, y] : [y, x];
    if (short.length >= 3 && long.startsWith(short) && PLURAL_ENDINGS.includes(long.slice(short.length))) return true;
    // Tippfehler nur bei längeren Wörtern mit gleichem Anfang (sonst wäre Kerzen = Herzen)
    return short.length >= 6 && x[0] === y[0] && long.length - short.length <= 1 && levenshtein(x, y) <= 1;
  }

  /**
   * Fasst gleiche Wörter zu Gruppen zusammen.
   * @param {string[]} words (leere Einträge = kein Wort)
   * @returns {number[][]} Gruppen von Indizes, größte zuerst; leere Wörter kommen in keine Gruppe
   */
  function groups(words) {
    const parent = words.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j < words.length; j++) {
        if (same(words[i], words[j])) parent[find(j)] = find(i);
      }
    }
    const map = new Map();
    words.forEach((w, i) => {
      if (!normalize(w)) return;
      const r = find(i);
      if (!map.has(r)) map.set(r, []);
      map.get(r).push(i);
    });
    return [...map.values()].sort((a, b) => b.length - a.length || a[0] - b[0]);
  }

  /**
   * Bewertet die Wörter eines Teams.
   * @returns {{outcome: 'all'|'some'|'none', groups: number[][]}}
   *   all  = alle (mindestens 2) haben dasselbe Wort
   *   some = mindestens zwei sind gleich, aber nicht alle
   */
  function assess(words) {
    const g = groups(words);
    const filled = words.filter((w) => normalize(w)).length;
    let outcome = 'none';
    if (words.length >= 2 && filled === words.length && g.length === 1) outcome = 'all';
    else if (g.length && g[0].length >= 2) outcome = 'some';
    return { outcome, groups: g };
  }

  /** Wurde das Wort (oder eine Variante davon) schon genannt? */
  function used(word, list) {
    return (list || []).some((w) => same(word, w));
  }

  root.GameMatch = { normalize, same, groups, assess, used, levenshtein };
})(typeof window !== 'undefined' ? window : globalThis);
