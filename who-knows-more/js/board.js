/*
 * Die Fragenwand von „Who knows more?“:
 *  - Katalog einlesen (js/questions/), Kategorien, Fragen und Finalfragen ziehen – ohne Wiederholung über mehrere
 *    Spiele (der Browser merkt sich gespielte Kategorien und Fragen in localStorage). Jede Katalog-Kategorie hat
 *    viele Fragen mit Stufe 1–5; pro Spiel kommt je Stufe eine noch nicht gespielte Frage auf die Wand.
 *  - Runden bauen: Feldwerte, Joker-Felder (nie in der obersten Reihe)
 *  - Eigene Wände: prüfen, im Browser speichern, als Datei exportieren/importieren, komprimiert in einen Link packen
 *  - Antworten prüfen (Finale): Groß/klein, Tippfehler, mehrere erlaubte Antworten („Oktopus / Krake“)
 */
(function (root) {
  'use strict';

  const ROWS = 5;
  const COLS_OPTIONS = [4, 5, 6];
  const MAX_COLS = 6;
  const MAX_ROUNDS = 2;
  const MAX_GROUP = 2; // höchstens so viele Kategorien derselben Gruppe pro Runde
  const LIMITS = { title: 60, cat: 40, q: 240, a: 120, img: 600 };
  const SEEN_KEY = 'wkm.seen.v1';
  const WALLS_KEY = 'wkm.walls.v1';

  let cache = null;
  let memory = {}; // Ersatz, wenn localStorage fehlt (Tests, privater Modus)

  /* ---------- Speicher ---------- */

  function storage() {
    try {
      const ls = root.localStorage;
      return ls && typeof ls.getItem === 'function' ? ls : null;
    } catch {
      return null;
    }
  }

  function readJson(key, fallback) {
    const ls = storage();
    try {
      const raw = ls ? ls.getItem(key) : memory[key];
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    const raw = JSON.stringify(value);
    const ls = storage();
    try {
      if (ls) ls.setItem(key, raw);
      else memory[key] = raw;
    } catch {
      /* Speicher voll oder gesperrt – egal */
    }
  }

  /* ---------- Hilfen ---------- */

  function clean(s, max) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000b-\u001f]/g, '')
      .replace(/[ \t]+/g, ' ')
      .trim()
      .slice(0, max);
  }

  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function randomId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** 'Stufe|Frage|Antwort' (Stufe 1–5 = Feld 100–500) oder 'Frage|Antwort' */
  function parseQ(line) {
    const parts = String(line).split('|');
    let level = null;
    if (parts.length >= 3 && /^\s*[1-5]\s*$/.test(parts[0])) level = +parts.shift();
    return { level, q: clean(parts[0], LIMITS.q), a: clean(parts.slice(1).join('|'), LIMITS.a) };
  }

  /** Kurzer Schlüssel für „schon gespielt“ (hält localStorage klein) */
  function hashKey(text) {
    let h = 5381;
    const s = String(text).toLowerCase();
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function parseFinal(line) {
    const parts = String(line).split('|');
    return { cat: clean(parts[0], LIMITS.cat), q: clean(parts[1], LIMITS.q), a: clean(parts.slice(2).join('|'), LIMITS.a) };
  }

  /* ---------- Katalog ---------- */

  function readSet(set, adult) {
    const out = { cats: [], finals: [] };
    if (!set) return out;
    for (const k of set.kategorien || []) {
      // Ohne Stufen-Angabe: Reihenfolge = Stufe (alte Kategorien mit genau 5 Fragen)
      const cells = (k.fragen || []).map(parseQ).map((c, i) => Object.assign(c, { level: c.level || Math.min(5, i + 1) }));
      out.cats.push({ name: clean(k.name, LIMITS.cat), group: k.gruppe || 'wissen', adult, cells });
    }
    for (const f of set.finale || []) out.finals.push(Object.assign(parseFinal(f), { adult }));
    return out;
  }

  /** Alle eingebauten Kategorien und Finalfragen (normal + 18+) */
  function catalog() {
    if (!cache) {
      const normal = readSet(root.WKM_KATALOG, false);
      const adult = readSet(root.WKM_ADULT, true);
      cache = { cats: normal.cats.concat(adult.cats), finals: normal.finals.concat(adult.finals) };
    }
    return cache;
  }

  function stats() {
    const c = catalog();
    const normal = c.cats.filter((k) => !k.adult);
    return {
      cats: normal.length,
      questions: normal.reduce((n, k) => n + k.cells.length, 0),
      finals: c.finals.filter((f) => !f.adult).length,
      adultCats: c.cats.length - normal.length,
      adultFinals: c.finals.filter((f) => f.adult).length,
    };
  }

  function finalKey(f) {
    return (f.cat + '|' + f.q).toLowerCase();
  }

  function loadSeen() {
    const s = readJson(SEEN_KEY, {});
    return { cats: new Set(s.cats || []), finals: new Set(s.finals || []), qs: new Set(s.qs || []) };
  }

  function saveSeen(seen) {
    writeJson(SEEN_KEY, { cats: [...seen.cats], finals: [...seen.finals], qs: [...seen.qs] });
  }

  /** Je Stufe 1–5 eine Frage der Kategorie, bevorzugt noch nicht gespielte */
  function pickQuestions(k, seen) {
    const key = (c) => hashKey(k.name + '|' + c.q);
    return [1, 2, 3, 4, 5].map((level) => {
      const [c] = pick(
        k.cells.filter((x) => x.level === level),
        1,
        seen.qs,
        key
      );
      return c ? { q: c.q, a: c.a } : { q: '', a: '' };
    });
  }

  /**
   * Wählt n Einträge, bevorzugt noch nicht gesehene. Sind zu wenige übrig, kommen die gesehenen
   * zurück in den Topf (sie werden in seen vergessen).
   * accept(entry, chosen) kann einzelne Einträge ablehnen (z.B. zu viele aus derselben Gruppe).
   */
  function pick(pool, n, seen, key, accept) {
    const ok = accept || (() => true);
    const chosen = [];
    const take = (list, strict) => {
      for (const e of shuffle(list)) {
        if (chosen.length >= n) return;
        if (!chosen.includes(e) && (!strict || ok(e, chosen))) chosen.push(e);
      }
    };
    // Ungesehenes geht vor Abwechslung: erst mit Gruppen-Grenze, dann ohne
    const unseen = pool.filter((e) => !seen.has(key(e)));
    take(unseen, true);
    take(unseen, false);
    if (chosen.length < n) {
      for (const e of pool) if (!chosen.includes(e)) seen.delete(key(e));
      take(pool, true);
      take(pool, false);
    }
    for (const e of chosen) seen.add(key(e));
    return chosen;
  }

  /** Wie viele 18+-Kategorien bei n Spalten auf die Wand kommen */
  function adultCount(n) {
    return n >= 6 ? 2 : 1;
  }

  /**
   * Zieht Kategorien aus dem Katalog.
   * @param {number} n Anzahl
   * @param {{adult?: boolean, exclude?: string[]}} opts exclude: Namen, die in diesem Spiel schon dran sind
   */
  function drawCategories(n, opts) {
    const o = opts || {};
    const exclude = new Set((o.exclude || []).map((x) => String(x).toLowerCase()));
    const all = catalog().cats.filter((k) => !exclude.has(k.name.toLowerCase()));
    const seen = loadSeen();
    const key = (k) => k.name.toLowerCase();
    const wantAdult = o.adult ? Math.min(adultCount(n), n) : 0;
    const adult = pick(all.filter((k) => k.adult), wantAdult, seen.cats, key);
    const perGroup = (k, chosen) => chosen.filter((c) => c.group === k.group).length < MAX_GROUP;
    const normal = pick(all.filter((k) => !k.adult), n - adult.length, seen.cats, key, perGroup);
    const out = shuffle(adult.concat(normal)).map((k) => ({ name: k.name, cells: pickQuestions(k, seen) }));
    saveSeen(seen);
    return out;
  }

  function drawFinal(opts) {
    const o = opts || {};
    const pool = catalog().finals.filter((f) => o.adult || !f.adult);
    if (!pool.length) return { cat: 'Finale', q: '?', a: '?' };
    const seen = loadSeen();
    const [f] = pick(pool, 1, seen.finals, finalKey);
    saveSeen(seen);
    return { cat: f.cat, q: f.q, a: f.a };
  }

  /* ---------- Runden bauen ---------- */

  function cellValue(row, roundIdx) {
    return (row + 1) * 100 * (roundIdx + 1);
  }

  /**
   * Baut eine Runde aus Kategorien ({name, cells: [{q, a, img?, joker?}]}).
   * @param {number} roundIdx 0 = Runde 1 (100–500), 1 = Runde 2 (200–1000)
   * @param {number} jokers Anzahl Joker-Felder (0 = aus). Sind in den Kategorien Joker markiert
   *   (eigene Wand), zählen diese, sonst werden sie zufällig verteilt – nie in der obersten Reihe.
   */
  function buildRound(cats, roundIdx, jokers) {
    const board = {
      cats: cats.map((k) => ({
        name: clean(k.name, LIMITS.cat) || '?',
        cells: Array.from({ length: ROWS }, (_, row) => {
          const c = (k.cells || [])[row] || {};
          const q = clean(c.q, LIMITS.q);
          const img = clean(c.img, LIMITS.img);
          return {
            q,
            a: clean(c.a, LIMITS.a),
            img: img || null,
            value: cellValue(row, roundIdx),
            joker: false,
            marked: !!c.joker,
            done: !q && !img,
            empty: !q && !img,
            result: null,
          };
        }),
      })),
    };
    if (jokers > 0) {
      const open = [];
      board.cats.forEach((k, col) => k.cells.forEach((c, row) => !c.done && row > 0 && open.push(c)));
      const marked = open.filter((c) => c.marked);
      if (marked.length) for (const c of marked.slice(0, MAX_COLS)) c.joker = true;
      else {
        // möglichst in verschiedenen Spalten
        const byCol = shuffle(board.cats.map((k) => k.cells.filter((c, row) => !c.done && row > 0))).filter((l) => l.length);
        for (let i = 0; i < jokers && byCol.length; i++) {
          const list = byCol[i % byCol.length];
          const c = list.splice(Math.floor(Math.random() * list.length), 1)[0];
          if (c) c.joker = true;
          if (!list.length) byCol.splice(i % byCol.length, 1);
        }
      }
    }
    for (const k of board.cats) for (const c of k.cells) delete c.marked;
    return board;
  }

  function hasFinal(f) {
    return !!(f && clean(f.q, LIMITS.q));
  }

  /**
   * Baut alle Runden und die Finalfrage eines Spiels.
   * @param {object} settings { source: 'katalog'|'custom'|'mixed', length, cols, joker, adult }
   * @param {object|null} wall eigene Wand (bei custom/mixed)
   */
  function buildGame(settings, wall) {
    const s = settings || {};
    const cols = COLS_OPTIONS.includes(s.cols) ? s.cols : 6;
    const useWall = (s.source === 'custom' || s.source === 'mixed') && wall && wall.rounds && wall.rounds.length;
    const source = useWall ? s.source : 'katalog';
    let nRounds = s.length === 'short' ? 1 : 2;
    if (source === 'custom') nRounds = Math.min(MAX_ROUNDS, wall.rounds.length);
    const used = [];
    const rounds = [];
    for (let r = 0; r < nRounds; r++) {
      let cats = [];
      if (source !== 'katalog') {
        cats = ((wall.rounds[r] || {}).cats || []).slice(0, MAX_COLS);
        used.push(...cats.map((k) => k.name));
      }
      if (source !== 'custom' && cats.length < cols) {
        const drawn = drawCategories(cols - cats.length, { adult: !!s.adult, exclude: used });
        used.push(...drawn.map((k) => k.name));
        cats = cats.concat(drawn);
      }
      rounds.push(buildRound(cats, r, s.joker === false ? 0 : r + 1));
    }
    const final = useWall && hasFinal(wall.final) ? Object.assign({}, wall.final) : drawFinal({ adult: !!s.adult });
    return { rounds, final: { cat: clean(final.cat, LIMITS.cat) || 'Finale', q: clean(final.q, LIMITS.q), a: clean(final.a, LIMITS.a) } };
  }

  /* ---------- Antworten prüfen ---------- */

  /** Erlaubte Antworten: „Oktopus / Krake“ → zwei, „Rot (Tor)“ → „Rot“ und „Rot Tor“, „… vom Stamm“ → „vom Stamm“ */
  function alternatives(answer) {
    const out = [];
    for (const part of String(answer || '').split(/\s+\/\s+/)) {
      const base = part.replace(/^[.…\s]+/, '').trim();
      if (!base) continue;
      out.push(base);
      const noParen = base.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
      if (noParen && noParen !== base) out.push(noParen);
    }
    return out;
  }

  /** Stimmt die getippte Antwort (vermutlich)? Nur ein Vorschlag – entschieden wird von Menschen. */
  function checkAnswer(given, answer) {
    const M = root.GameMatch;
    const g = M.normalize(given);
    if (!g) return false;
    return alternatives(answer).some((alt) => {
      const a = M.normalize(alt);
      if (!a) return false;
      if (g === a || M.same(given, alt)) return true;
      // „Mount Everest“ ↔ „Everest“, „42,195 km“ ↔ „42,195“
      if (a.length >= 4 && g.includes(a)) return true;
      return g.length >= 4 && a.includes(g) && g.length >= a.length * 0.6;
    });
  }

  /* ---------- Eigene Wände ---------- */

  function emptyCat() {
    return { name: '', cells: Array.from({ length: ROWS }, () => ({ q: '', a: '', img: '', joker: false })) };
  }

  function emptyWall() {
    return {
      v: 1,
      id: randomId(),
      title: '',
      updatedAt: Date.now(),
      rounds: [{ cats: [emptyCat(), emptyCat(), emptyCat(), emptyCat()] }],
      final: { cat: '', q: '', a: '' },
    };
  }

  function sanitizeCell(c) {
    const x = c || {};
    const img = clean(x.img, LIMITS.img);
    return {
      q: clean(x.q, LIMITS.q),
      a: clean(x.a, LIMITS.a),
      img: /^(https?:)?\/\//i.test(img) || /^data:image\//i.test(img) ? img : '',
      joker: !!x.joker,
    };
  }

  /**
   * Prüft eine Wand (aus Editor, Datei oder Link). keepEmpty: leere Kategorien behalten (Editor).
   * Gibt null zurück, wenn nichts Brauchbares drin ist.
   */
  function sanitizeWall(w, keepEmpty) {
    if (!w || typeof w !== 'object' || !Array.isArray(w.rounds)) return null;
    const rounds = w.rounds.slice(0, MAX_ROUNDS).map((r) => ({
      cats: ((r && r.cats) || [])
        .slice(0, MAX_COLS)
        .map((k) => ({
          name: clean(k && k.name, LIMITS.cat),
          cells: Array.from({ length: ROWS }, (_, i) => sanitizeCell(((k && k.cells) || [])[i])),
        }))
        .filter((k) => keepEmpty || (k.name && k.cells.some((c) => c.q || c.img))),
    }));
    while (rounds.length > 1 && !rounds[rounds.length - 1].cats.length) rounds.pop();
    if (!keepEmpty && !rounds.some((r) => r.cats.length)) return null;
    if (!rounds.length) rounds.push({ cats: [emptyCat()] });
    const f = w.final || {};
    return {
      v: 1,
      id: clean(w.id, 40) || randomId(),
      title: clean(w.title, LIMITS.title),
      updatedAt: +w.updatedAt || Date.now(),
      rounds,
      final: { cat: clean(f.cat, LIMITS.cat), q: clean(f.q, LIMITS.q), a: clean(f.a, LIMITS.a) },
    };
  }

  function wallStats(w) {
    let cats = 0;
    let questions = 0;
    for (const r of (w && w.rounds) || []) {
      for (const k of r.cats) {
        cats++;
        questions += k.cells.filter((c) => c.q || c.img).length;
      }
    }
    return { rounds: ((w && w.rounds) || []).length, cats, questions, final: hasFinal(w && w.final) };
  }

  function listWalls() {
    const list = readJson(WALLS_KEY, []);
    return (Array.isArray(list) ? list : [])
      .map((w) => sanitizeWall(w, true))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function getWall(id) {
    return listWalls().find((w) => w.id === id) || null;
  }

  function saveWall(wall) {
    const w = sanitizeWall(wall, true);
    if (!w) return null;
    w.updatedAt = Date.now();
    const list = listWalls().filter((x) => x.id !== w.id);
    list.unshift(w);
    writeJson(WALLS_KEY, list);
    return w;
  }

  function deleteWall(id) {
    writeJson(
      WALLS_KEY,
      listWalls().filter((w) => w.id !== id)
    );
  }

  /** Wand als Datei (.json) */
  function exportJson(wall) {
    const w = sanitizeWall(wall, false) || sanitizeWall(wall, true);
    return JSON.stringify({ format: 'who-knows-more-wand', version: 1, wall: w }, null, 2);
  }

  function importJson(text) {
    let data;
    try {
      data = JSON.parse(String(text || ''));
    } catch {
      return null;
    }
    const w = sanitizeWall(data && data.wall ? data.wall : data, false);
    if (w) w.id = randomId(); // als neue Wand übernehmen
    return w;
  }

  /* ---------- Teilen per Link ---------- */

  /** Kompakte Form ohne Feldnamen: [titel, [[[name, [[q, a, img, joker], …]], …] je Runde], [kat, q, a]] */
  function pack(w) {
    const cell = (c) => {
      const out = [c.q, c.a];
      if (c.img || c.joker) out.push(c.img || '');
      if (c.joker) out.push(1);
      return out;
    };
    return [w.title, w.rounds.map((r) => r.cats.map((k) => [k.name, k.cells.map(cell)])), [w.final.cat, w.final.q, w.final.a]];
  }

  function unpack(p) {
    if (!Array.isArray(p)) return null;
    return {
      title: p[0],
      rounds: (p[1] || []).map((cats) => ({
        cats: (cats || []).map((k) => ({
          name: k[0],
          cells: (k[1] || []).map((c) => ({ q: c[0], a: c[1], img: c[2] || '', joker: c[3] === 1 })),
        })),
      })),
      final: { cat: (p[2] || [])[0], q: (p[2] || [])[1], a: (p[2] || [])[2] },
    };
  }

  function bytesToB64url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return root.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlToBytes(s) {
    const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
    const bin = root.atob(b64 + '==='.slice((b64.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function streamBytes(bytes, stream) {
    const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Wand → Link-Code (z… = komprimiert, j… = unkomprimiert für alte Browser) */
  async function encodeLink(wall) {
    const w = sanitizeWall(wall, false);
    if (!w) return null;
    const bytes = new TextEncoder().encode(JSON.stringify(pack(w)));
    if (typeof root.CompressionStream === 'function') {
      try {
        return 'z' + bytesToB64url(await streamBytes(bytes, new root.CompressionStream('deflate')));
      } catch {
        /* dann eben unkomprimiert */
      }
    }
    return 'j' + bytesToB64url(bytes);
  }

  async function decodeLink(code) {
    try {
      const s = String(code || '').trim();
      let bytes = b64urlToBytes(s.slice(1));
      if (s[0] === 'z') bytes = await streamBytes(bytes, new root.DecompressionStream('deflate'));
      else if (s[0] !== 'j') return null;
      const w = sanitizeWall(unpack(JSON.parse(new TextDecoder().decode(bytes))), false);
      if (w) w.id = randomId();
      return w;
    } catch {
      return null;
    }
  }

  root.WKMBoard = {
    ROWS,
    COLS_OPTIONS,
    MAX_COLS,
    MAX_ROUNDS,
    LIMITS,
    catalog,
    stats,
    drawCategories,
    drawFinal,
    cellValue,
    buildRound,
    buildGame,
    alternatives,
    checkAnswer,
    emptyCat,
    emptyWall,
    sanitizeWall,
    wallStats,
    listWalls,
    getWall,
    saveWall,
    deleteWall,
    exportJson,
    importJson,
    encodeLink,
    decodeLink,
    _parseQ: parseQ,
    _hashKey: hashKey,
    _reset() {
      cache = null;
      memory = {};
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
