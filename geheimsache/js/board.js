/*
 * Spielfeld von „Geheimsache“:
 *  - 25 Wörter ziehen (ohne Wiederholung im Spieleabend und möglichst auch nicht aus früheren Abenden),
 *    auf Wunsch 8 davon aus der 18+-Liste
 *  - Schlüsselkarte austeilen: 9 Startteam, 8 anderes Team, 7 Unbeteiligte, 1 Attentäter
 *  - Schlüssel ↔ Link-Code (#k=…) für die Handys der Geheimdienstchefs – kommt ohne Netzwerk aus
 *  - Hinweis prüfen: darf kein Wort auf dem Feld sein und nicht darin stecken (Schloss ↔ Schlosspark)
 */
(function (root) {
  'use strict';

  const M = root.GameMatch;

  const SIZE = 25;
  const COLS = 5;
  const COUNTS = { starter: 9, other: 8, neutral: 7, assassin: 1 };
  const LETTER = { rot: 'R', blau: 'B', neutral: 'N', assassin: 'A' };
  const OWNER = { R: 'rot', B: 'blau', N: 'neutral', A: 'assassin' };
  const VERSION = '1';
  const SEEN_KEY = 'geheimsache.seen.v1';
  const PLURAL_ENDINGS = ['e', 'n', 'en', 's', 'er', 'es', 'nen'];

  // 18+-Wörter haben eigene Nummern ab 900 – so verschiebt sich nichts, wenn eine der Listen wächst
  const ADULT_BASE = 900;
  const ADULT_PER_GAME = 8;

  const lists = {};

  function parseList(text) {
    return String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  }

  function list(name) {
    if (!lists[name]) lists[name] = parseList((root.GS_WORDS || {})[name]);
    return lists[name];
  }

  /** Normale Wörter (Reihenfolge = Nummern im Link-Code) */
  function words() {
    return list('standard');
  }

  /** 18+-Wörter (Nummer im Link-Code = ADULT_BASE + Position) */
  function adultWords() {
    return list('adult');
  }

  /** Wort zu einer Nummer aus dem Link-Code (undefined, wenn es sie hier nicht gibt) */
  function wordAt(n) {
    return n < ADULT_BASE ? words()[n] : adultWords()[n - ADULT_BASE];
  }

  function keyOf(word) {
    return M.normalize(word);
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

  function shuffle(arr, rnd) {
    const r = rnd || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Zieht `count` Nummern aus einem Stapel – erst ungesehene, sonst werden gesehene zurückgemischt */
  function drawFrom(numbers, count, used, seen, rnd) {
    const key = (n) => keyOf(wordAt(n));
    let pool = numbers.filter((n) => !used.has(key(n)) && !seen.has(key(n)));
    if (pool.length < count) {
      // Fast alles schon gesehen – gesehene Wörter zurückmischen, nur die dieses Abends bleiben draußen
      for (const n of numbers) seen.delete(key(n));
      pool = numbers.filter((n) => !used.has(key(n)));
    }
    if (pool.length < count) pool = numbers.slice();
    return shuffle(pool, rnd).slice(0, count);
  }

  /**
   * Teilt ein neues Feld aus.
   * @param {{starter: 'rot'|'blau', adult?: boolean, used?: string[], random?: Function}} opts
   *   adult: 8 der 25 Wörter kommen aus der 18+-Liste
   *   used:  Schlüssel der Wörter, die an diesem Abend schon lagen (wird ergänzt)
   * @returns {{cards: {idx, word, owner}[], code: string}}
   */
  function deal(opts) {
    const o = opts || {};
    const rnd = o.random || Math.random;
    const used = new Set(o.used || []);
    const seen = loadSeen();
    const adultCount = o.adult ? Math.min(ADULT_PER_GAME, adultWords().length) : 0;
    const picked = shuffle(
      drawFrom(
        adultWords().map((_, i) => ADULT_BASE + i),
        adultCount,
        used,
        seen,
        rnd
      ).concat(
        drawFrom(
          words().map((_, i) => i),
          SIZE - adultCount,
          used,
          seen,
          rnd
        )
      ),
      rnd
    );
    const starter = o.starter === 'blau' ? 'blau' : 'rot';
    const other = starter === 'rot' ? 'blau' : 'rot';
    const owners = shuffle(
      [].concat(
        Array(COUNTS.starter).fill(starter),
        Array(COUNTS.other).fill(other),
        Array(COUNTS.neutral).fill('neutral'),
        Array(COUNTS.assassin).fill('assassin')
      ),
      rnd
    );
    for (const n of picked) {
      seen.add(keyOf(wordAt(n)));
      if (Array.isArray(o.used)) o.used.push(keyOf(wordAt(n)));
    }
    saveSeen(seen);
    const cards = picked.map((idx, i) => ({ idx, word: wordAt(idx), owner: owners[i] }));
    return { cards, code: encode(cards.map((c) => c.owner), picked) };
  }

  /* ---------- Schlüssel ↔ Link-Code ---------- */

  function b36(n, len) {
    return n.toString(36).padStart(len, '0');
  }

  function checksum(s) {
    let h = 7;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1296;
    return b36(h, 2);
  }

  /**
   * Code für den Link-Anker: Version + 25 Farben (R/B/N/A) + 25 Wortnummern (je 2 Zeichen)
   * + Länge beider Wortlisten (erkennt eine veraltete Liste auf dem Handy) + Prüfsumme. 82 Zeichen.
   */
  function encode(owners, indices) {
    const body =
      VERSION +
      owners.map((o) => LETTER[o]).join('') +
      indices.map((i) => b36(i, 2)).join('') +
      b36(words().length, 2) +
      b36(adultWords().length, 2);
    return body + checksum(body);
  }

  /**
   * Liest einen Link-Code. Gibt null zurück, wenn er kaputt ist.
   * @returns {{owners: string[], indices: number[], words: string[]|null, starter: string}|null}
   *   words ist null, wenn die Wortlisten auf diesem Gerät nicht passen (anderer Stand der Seite)
   */
  function decode(code) {
    const s = String(code || '').trim();
    const len = 1 + SIZE + SIZE * 2 + 4 + 2;
    if (s.length !== len || s[0] !== VERSION) return null;
    const body = s.slice(0, -2);
    if (checksum(body) !== s.slice(-2).toLowerCase()) return null;
    const letters = body.slice(1, 1 + SIZE);
    if (!/^[RBNA]+$/.test(letters)) return null;
    const owners = [...letters].map((l) => OWNER[l]);
    const count = (o) => owners.filter((x) => x === o).length;
    const red = count('rot');
    const blue = count('blau');
    if (count('neutral') !== COUNTS.neutral || count('assassin') !== COUNTS.assassin) return null;
    if (Math.max(red, blue) !== COUNTS.starter || Math.min(red, blue) !== COUNTS.other) return null;
    const indices = [];
    for (let i = 0; i < SIZE; i++) {
      const n = parseInt(body.substr(1 + SIZE + i * 2, 2), 36);
      if (!Number.isFinite(n)) return null;
      indices.push(n);
    }
    const sizes = body.slice(-4);
    const fits =
      parseInt(sizes.slice(0, 2), 36) === words().length &&
      parseInt(sizes.slice(2), 36) === adultWords().length &&
      indices.every((n) => wordAt(n) !== undefined);
    return {
      owners,
      indices,
      words: fits ? indices.map(wordAt) : null,
      starter: red > blue ? 'rot' : 'blau',
    };
  }

  /* ---------- Hinweis prüfen ---------- */

  /** Umlaute als Grundvokal (Bänke → Banke) */
  function fold(s) {
    return s.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
  }

  /** Ist `plural` die Mehrzahl von `word`? (Rakete → Raketen, Bank → Bänke, Schloss → Schlösser) */
  function isPlural(word, plural) {
    const ok = (p) => word.length >= 3 && p.startsWith(word) && PLURAL_ENDINGS.includes(p.slice(word.length));
    return ok(plural) || (fold(plural) !== plural && ok(fold(plural)));
  }

  /**
   * Verhältnis zweier Wörter: 'same' (gleich, auch Plural), 'part' (steckt im anderen) oder null.
   * Teilwörter zählen erst ab 3 Buchstaben, sonst wäre z.B. „Ei“ in jedem zweiten Wort.
   */
  function relation(a, b) {
    const x = M.normalize(a);
    const y = M.normalize(b);
    if (!x || !y) return null;
    if (x === y || isPlural(x, y) || isPlural(y, x)) return 'same';
    const [short, long] = x.length <= y.length ? [x, y] : [y, x];
    if (short.length >= 3 && long.includes(short)) return 'part';
    return null;
  }

  /**
   * Ist der Hinweis erlaubt?
   * @param {string} clue
   * @param {string[]} fieldWords Wörter, die noch offen auf dem Feld liegen
   * @returns {{word: string, reason: 'same'|'part'}|null} null = erlaubt
   */
  function clueProblem(clue, fieldWords) {
    for (const w of fieldWords || []) {
      const r = relation(clue, w);
      if (r) return { word: w, reason: r };
    }
    return null;
  }

  root.GSBoard = { SIZE, COLS, COUNTS, ADULT_BASE, ADULT_PER_GAME, words, adultWords, wordAt, deal, encode, decode, relation, clueProblem, keyOf, _parseList: parseList };
})(typeof window !== 'undefined' ? window : globalThis);
