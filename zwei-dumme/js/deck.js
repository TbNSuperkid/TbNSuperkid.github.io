/*
 * Begriffe ziehen – ohne Wiederholung im laufenden Spiel und möglichst auch nicht
 * aus früheren Spielen (der Browser merkt sich gesehene Begriffe in localStorage).
 */
(function (root) {
  'use strict';

  const KINDS = ['einzel', 'kategorie', 'luecke'];
  const SEEN_KEY = 'zweidumme.seen.v1';
  let lists = null;

  function parseList(text) {
    return String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  }

  function keyOf(text) {
    return String(text).toLowerCase();
  }

  function all() {
    if (!lists) {
      const W = root.ZD_WORDS || {};
      lists = {};
      for (const kind of KINDS) lists[kind] = parseList(W[kind]).map((text) => ({ key: keyOf(text), text, kind }));
    }
    return lists;
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
   * Zieht einen Begriff.
   * @param {'begriff'|'start'} pool  begriff = alle Arten, start = nur Einzelbegriffe (Startwörter der Kette)
   * @param {string[]} usedInGame Schlüssel der Begriffe, die in diesem Spiel schon dran waren (wird ergänzt)
   */
  function draw(pool, usedInGame) {
    const L = all();
    const entries = pool === 'start' ? L.einzel : KINDS.flatMap((k) => L[k]);
    if (!entries.length) return { key: '?', text: '???', kind: 'einzel' };
    const used = new Set(usedInGame || []);
    const seen = loadSeen();
    let candidates = entries.filter((e) => !used.has(e.key) && !seen.has(e.key));
    if (!candidates.length) {
      // Alle schon einmal gesehen – gesehene Begriffe dieses Stapels zurückmischen
      for (const e of entries) seen.delete(e.key);
      candidates = entries.filter((e) => !used.has(e.key));
    }
    if (!candidates.length) candidates = entries;
    const entry = candidates[Math.floor(Math.random() * candidates.length)];
    seen.add(entry.key);
    saveSeen(seen);
    if (Array.isArray(usedInGame)) usedInGame.push(entry.key);
    return Object.assign({}, entry);
  }

  function stats() {
    const L = all();
    const out = { total: 0 };
    for (const k of KINDS) {
      out[k] = L[k].length;
      out.total += L[k].length;
    }
    return out;
  }

  root.ZDDeck = { KINDS, draw, stats, all, keyOf, _parseList: parseList };
})(typeof window !== 'undefined' ? window : globalThis);
