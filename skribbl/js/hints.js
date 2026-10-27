/*
 * Hinweise für Skribbl: Das Wort erscheint als Lücken („_ _ _ _ A _ _“), nach 50 % und 75 % der Zeichenzeit wird
 * je ein Buchstabe aufgedeckt. Leerzeichen und Bindestriche sind von Anfang an sichtbar.
 *  - kurze Wörter (bis 4 Buchstaben) bekommen höchstens einen Hinweis
 *  - aufgedeckte Buchstaben stehen nie direkt nebeneinander (sonst wäre es bei 2 Hinweisen zu leicht)
 */
(function (root) {
  'use strict';

  const SHORT = 4;
  const HIDDEN = '_';

  /** Ist das Zeichen ein Buchstabe/eine Ziffer, also etwas zum Erraten? */
  function isLetter(ch) {
    return /[\p{L}\p{N}]/u.test(ch);
  }

  /** Positionen aller Buchstaben (ohne Leerzeichen, Bindestriche, Satzzeichen) */
  function letters(word) {
    const out = [];
    [...String(word || '')].forEach((ch, i) => {
      if (isLetter(ch)) out.push(i);
    });
    return out;
  }

  /** Wie viele Buchstaben werden aufgedeckt? (Einstellung 0/1/2, kurze Wörter höchstens 1) */
  function count(word, setting) {
    const n = letters(word).length;
    const want = Math.max(0, Math.min(2, setting | 0));
    if (n <= 1) return 0;
    if (n <= SHORT) return Math.min(want, 1);
    return want;
  }

  /** Reihenfolge der aufgedeckten Buchstaben (zufällig, nie zwei nebeneinander, solange das geht) */
  function pick(word, n, random) {
    const rnd = random || Math.random;
    const pool = letters(word);
    const out = [];
    for (let k = 0; k < n && pool.length; k++) {
      const free = pool.filter((i) => !out.includes(i));
      const apart = free.filter((i) => out.every((j) => Math.abs(i - j) > 1));
      const list = apart.length ? apart : free;
      if (!list.length) break;
      out.push(list[Math.floor(rnd() * list.length)]);
    }
    return out;
  }

  /** Zeitpunkte (ms ab Zeichenbeginn): 1 Hinweis nach 50 %, 2 Hinweise nach 50 % und 75 % */
  function times(total, n) {
    return [0.5, 0.75].slice(0, n).map((f) => Math.round(total * f));
  }

  /** Lücken-Text: versteckte Buchstaben als „_“, aufgedeckte und alle anderen Zeichen wie im Wort */
  function mask(word, shown) {
    const open = new Set(shown || []);
    return [...String(word || '')].map((ch, i) => (isLetter(ch) && !open.has(i) ? HIDDEN : ch)).join('');
  }

  /** Buchstaben je Teilwort, z.B. „Mann im Mond“ → [4, 2, 4] */
  function lengths(word) {
    return String(word || '')
      .split(/\s+/)
      .map((w) => [...w].filter(isLetter).length)
      .filter((n) => n > 0);
  }

  root.SkHints = { SHORT, HIDDEN, isLetter, letters, count, pick, times, mask, lengths };
})(typeof window !== 'undefined' ? window : globalThis);
