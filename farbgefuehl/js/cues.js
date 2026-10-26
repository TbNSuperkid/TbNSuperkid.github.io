/*
 * Hinweis-Prüfung für „Farbgefühl“. Sie warnt nur – die Runde hat das letzte Wort („Trotzdem senden“).
 * Geprüft wird (nach GameMatch.normalize, also ä = ae, Groß/klein egal):
 *  - Grundfarben und „hell“/„dunkel“, auch in Zusammensetzungen (Himmelblau, Dunkelrot)
 *    – mit einer kleinen Ausnahmeliste für Wörter, die nur zufällig so enthalten sind (Brot, Karotte …)
 *  - englische Grundfarben als ganze Wörter (red, blue, light …)
 *  - Koordinaten (B12) und Zahlen
 *  - Hinweis 1: genau ein Wort · Hinweis 2: ein oder zwei Wörter
 *  - schon benutzte Hinweise (auch Plural/Tippfehler, über GameMatch.same)
 */
(function (root) {
  'use strict';

  const Match = root.GameMatch;
  const MAX_LEN = 40;
  const FORBIDDEN = ['rot', 'blau', 'gruen', 'gelb', 'orange', 'lila', 'violett', 'pink', 'rosa', 'braun', 'schwarz', 'weiss', 'grau', 'hell', 'dunkel'];
  const SHOW = { gruen: 'grün', weiss: 'weiß' };
  // Wortteile, in denen ein verbotenes Wort nur zufällig steckt
  const EXCEPTIONS = [
    'brot',
    'karott',
    'protest',
    'rotor',
    'rotat',
    'rotier',
    'grott',
    'sprott',
    'erot',
    'protot',
    'trott',
    'frott',
    'parrot',
    'chell',
    'grauen',
    'grausam',
    'grausig',
    'graupel',
    'pinkel',
  ];
  const ENGLISH = ['red', 'blue', 'green', 'yellow', 'black', 'white', 'gray', 'grey', 'purple', 'brown', 'light', 'dark'];

  function clean(text) {
    return String(text == null ? '' : text)
      .replace(/[\u0000-\u001f<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_LEN);
  }

  function words(text) {
    const c = clean(text);
    return c ? c.split(' ') : [];
  }

  /** Verbotenes Farbwort im Wort? → das Farbwort (zum Anzeigen), sonst null */
  function colorWord(word) {
    let n = Match.normalize(word);
    for (const ex of EXCEPTIONS) n = n.split(ex).join('_');
    const hit = FORBIDDEN.find((f) => n.includes(f));
    if (hit) return SHOW[hit] || hit;
    const lower = String(word).toLowerCase().replace(/[^a-z]/g, '');
    return ENGLISH.includes(lower) ? lower : null;
  }

  /**
   * @param {string} text Hinweis
   * @param {{round?: 1|2, used?: string[]}} [opts]
   * @returns {{ok: boolean, text: string, problems: {code: string, text: string}[]}}
   */
  function check(text, opts) {
    const o = opts || {};
    const round = o.round === 2 ? 2 : 1;
    const c = clean(text);
    const ws = words(c);
    const problems = [];
    if (!ws.length) {
      problems.push({ code: 'empty', text: 'Bitte einen Hinweis eingeben.' });
      return { ok: false, text: c, problems };
    }
    if (round === 1 && ws.length > 1) problems.push({ code: 'words', text: 'Hinweis 1 darf nur ein Wort sein.' });
    if (round === 2 && ws.length > 2) problems.push({ code: 'words', text: 'Hinweis 2 darf höchstens zwei Wörter haben.' });
    const colors = [...new Set(ws.map(colorWord).filter(Boolean))];
    if (colors.length) {
      const list = colors.map((x) => `„${x}“`).join(', ');
      const light = colors.some((x) => ['hell', 'dunkel', 'light', 'dark'].includes(x));
      problems.push({ code: 'color', text: `${list} ist verboten – keine Grundfarben${light ? ' und kein hell/dunkel' : ''}.` });
    }
    if (/(^|[^a-z])[a-p]\s?\d{1,2}([^0-9]|$)/i.test(c)) problems.push({ code: 'coord', text: 'Keine Koordinaten nennen.' });
    else if (/\d/.test(c)) problems.push({ code: 'number', text: 'Keine Zahlen – sie könnten auf ein Feld zeigen.' });
    const used = (o.used || []).filter(Boolean);
    if (used.length && (Match.used(c, used) || ws.some((w) => Match.used(w, used.filter((u) => !u.includes(' ')))))) {
      problems.push({ code: 'used', text: 'Dieser Hinweis wurde schon benutzt.' });
    }
    return { ok: !problems.length, text: c, problems };
  }

  root.FGCues = { MAX_LEN, FORBIDDEN, clean, words, colorWord, check };
})(typeof window !== 'undefined' ? window : globalThis);
