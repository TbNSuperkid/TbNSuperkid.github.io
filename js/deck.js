/*
 * Kartenstapel: liest die Begriffslisten ein und zieht zufällige Karten.
 * Bereits gezogene Begriffe merkt sich der Browser (localStorage), damit auch
 * über mehrere Spiele hinweg möglichst wenig doppelt vorkommt.
 */
(function (root) {
  'use strict';

  const CATS = ['erklaeren', 'zeichnen', 'pantomime'];
  const DIFFS = ['leicht', 'mittel', 'schwer'];
  const SEEN_KEY = 'activity.seen.v1';

  const normal = {}; // `${cat}:${diff}` -> [entry]
  const adult = {}; // diff -> [entry]
  let parsed = false;

  function keyOf(term) {
    return term.toLowerCase();
  }

  function parseList(text, isAdult) {
    return String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const parts = line.split('|').map((p) => p.trim());
        return { key: keyOf(parts[0]), term: parts[0], taboo: parts.slice(1, 4), adult: !!isAdult };
      });
  }

  function ensureParsed() {
    if (parsed) return;
    const W = root.ACTIVITY_WORDS || {};
    for (const cat of CATS) {
      for (const diff of DIFFS) {
        normal[cat + ':' + diff] = parseList(W[cat] && W[cat][diff], false);
      }
    }
    for (const diff of DIFFS) adult[diff] = parseList(W.adult && W.adult[diff], true);
    parsed = true;
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

  function pool(cat, diff, withAdult) {
    ensureParsed();
    const base = normal[cat + ':' + diff] || [];
    return withAdult ? base.concat(adult[diff] || []) : base;
  }

  /**
   * Zieht eine Karte.
   * @param {string} cat Kategorie
   * @param {string} diff Schwierigkeit
   * @param {boolean} withAdult 18+-Begriffe einmischen
   * @param {string[]} usedInGame Begriffe, die in diesem Spiel schon dran waren
   */
  function draw(cat, diff, withAdult, usedInGame) {
    const all = pool(cat, diff, withAdult);
    if (!all.length) return { key: '?', term: '???', taboo: [], adult: false };
    const used = new Set(usedInGame || []);
    const seen = loadSeen();
    let candidates = all.filter((e) => !used.has(e.key) && !seen.has(e.key));
    if (!candidates.length) {
      // Stapel einmal komplett durch – gesehene Begriffe dieses Stapels zurückmischen
      for (const e of all) seen.delete(e.key);
      candidates = all.filter((e) => !used.has(e.key));
    }
    if (!candidates.length) candidates = all;
    const entry = candidates[Math.floor(Math.random() * candidates.length)];
    seen.add(entry.key);
    saveSeen(seen);
    return { key: entry.key, term: entry.term, taboo: entry.taboo.slice(), adult: entry.adult };
  }

  /** Anzahl noch nicht gesehener Karten je Schwierigkeit für eine Kategorie */
  function remaining(cat, withAdult, usedInGame) {
    const used = new Set(usedInGame || []);
    const seen = loadSeen();
    const out = {};
    for (const diff of DIFFS) {
      const all = pool(cat, diff, withAdult);
      const left = all.filter((e) => !used.has(e.key) && !seen.has(e.key)).length;
      out[diff] = { left: left || all.length, total: all.length };
    }
    return out;
  }

  function stats() {
    ensureParsed();
    const out = { total: 0, adult: 0 };
    for (const cat of CATS) {
      out[cat] = DIFFS.reduce((n, d) => n + normal[cat + ':' + d].length, 0);
      out.total += out[cat];
    }
    out.adult = DIFFS.reduce((n, d) => n + adult[d].length, 0);
    return out;
  }

  root.ActivityDeck = { CATS, DIFFS, draw, remaining, stats, pool, keyOf, _parseList: parseList };
})(typeof window !== 'undefined' ? window : globalThis);
