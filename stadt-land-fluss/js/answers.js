/*
 * Antworten prüfen für „Stadt, Land, Fluss“ – die App entscheidet nichts inhaltlich, nur:
 *  - Anfangsbuchstabe: Ä/Ö/Ü zählen für A/O/U (einstellbar), Akzente sind egal (Évian = E).
 *    Ein Artikel am Anfang darf sein: „Die Mosel“ zählt bei M – und weil es auch „Den Haag“ gibt, auch bei D.
 *    „St. Petersburg“ beginnt mit S, passt also von selbst.
 *  - Gleiche Antworten zusammenfassen (shared/match.js: Groß/klein, Tippfehler, Plural, Artikel; „St.“ = „Sankt“)
 *  - ✓ „bekannt“: steht die Antwort in einer Hilfsliste (js/listen/)? Nur eine Hilfe bei der Abstimmung, nie ein Urteil.
 */
(function (root) {
  'use strict';

  const ARTICLE = /^(der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines|the)\s+/i;
  const MAX_ANSWER = 40;

  function match() {
    return root.GameMatch;
  }

  /** Antwort säubern (Steuerzeichen, spitze Klammern, Leerzeichen, Länge) */
  function clean(text) {
    return String(text == null ? '' : text)
      .replace(/[\u0000-\u001f<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_ANSWER);
  }

  /** Erster Buchstabe (groß). umlauts: Ä → A usw. */
  function firstLetter(text, umlauts) {
    const s = String(text == null ? '' : text).replace(/^[^\p{L}]+/u, '');
    if (!s) return '';
    let ch = s[0].toUpperCase();
    if (!umlauts && 'ÄÖÜ'.includes(ch)) return ch;
    if (ch === 'ß') return 'S';
    ch = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return ch;
  }

  /** Beginnt die Antwort mit dem Buchstaben? (mit oder ohne Artikel davor) */
  function startsWith(text, letter, opts) {
    const o = opts || {};
    const umlauts = o.umlauts !== false;
    const t = clean(text);
    if (!t || !letter) return false;
    const L = String(letter).toUpperCase();
    if (firstLetter(t, umlauts) === L) return true;
    const rest = t.replace(ARTICLE, '');
    return rest !== t && firstLetter(rest, umlauts) === L;
  }

  /** Für den Vergleich: „St.“ / „St “ am Wortanfang = „Sankt“ */
  function prepare(text) {
    return clean(text)
      .replace(/(^|\s|-)st\.\s*/gi, '$1Sankt ')
      .replace(/(^|\s|-)st\s+/gi, '$1Sankt ');
  }

  function normalize(text) {
    return match().normalize(prepare(text));
  }

  function same(a, b) {
    return match().same(prepare(a), prepare(b));
  }

  /** Gleiche Antworten zusammenfassen. @returns {number[][]} Gruppen von Indizes (leere fehlen) */
  function group(texts) {
    return match().groups(texts.map(prepare));
  }

  /* ---------- Hilfslisten ---------- */

  const sets = {};

  function listSet(id) {
    if (sets[id]) return sets[id];
    const raw = (root.SLFListen || {})[id];
    if (!raw) return null;
    const items = String(raw)
      .split(/[|\n]/)
      .map((x) => x.trim())
      .filter((x) => x && !x.startsWith('#'));
    const set = new Set(items.map(normalize).filter(Boolean));
    sets[id] = set;
    return set;
  }

  /** Steht die Antwort in der Hilfsliste? (kleine Tippfehler ab 6 Buchstaben ok) */
  function known(id, text) {
    if (!id) return false;
    const set = listSet(id);
    if (!set) return false;
    const n = normalize(text);
    if (!n) return false;
    if (set.has(n)) return true;
    if (n.length < 6) return false;
    for (const x of set) {
      if (x[0] === n[0] && Math.abs(x.length - n.length) <= 1 && match().levenshtein(x, n) <= 1) return true;
    }
    return false;
  }

  /** Anzahl Einträge einer Hilfsliste (für Tests und die Regeln) */
  function listSize(id) {
    const set = listSet(id);
    return set ? set.size : 0;
  }

  root.SLFAnswers = { MAX_ANSWER, clean, firstLetter, startsWith, prepare, normalize, same, group, known, listSize };
})(typeof window !== 'undefined' ? window : globalThis);
