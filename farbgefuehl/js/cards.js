/*
 * Farbkarten für „Farbgefühl“: Jede Karte zeigt 4 Farben, die hinweisgebende Person wählt eine davon.
 *  - je eine Farbe aus jedem Viertel der Farbtöne (Rot/Gelb · Grün · Blau · Lila/Pink), damit die Wahl echt ist
 *  - mindestens MIN_GAP Felder Abstand zueinander
 *  - schon gespielte Zielfarben kommen bis zum Spielende nicht noch einmal
 * Zufall über random() (für Tests mit festem Startwert: seeded()).
 */
(function (root) {
  'use strict';

  const Board = root.FGBoard;
  const SIZE = 4;
  const MIN_GAP = 5;

  /** Reproduzierbarer Zufall (mulberry32) */
  function seeded(seed) {
    let a = seed >>> 0 || 1;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pickInt(random, n) {
    return Math.min(n - 1, Math.floor(random() * n));
  }

  /**
   * Neue Karte ziehen.
   * @param {Function} random
   * @param {string[]} [used] schon gespielte Felder ('A1', …)
   * @returns {{r: number, c: number}[]}
   */
  function draw(random, used) {
    const rnd = random || Math.random;
    const taken = new Set(used || []);
    const quarter = Board.COLS / SIZE;
    const card = [];
    for (let q = 0; q < SIZE; q++) {
      const from = Math.round(q * quarter);
      const to = Math.round((q + 1) * quarter);
      const options = [];
      for (let r = 0; r < Board.ROWS; r++) {
        for (let c = from; c < to; c++) {
          const cell = { r, c };
          if (!taken.has(Board.label(cell))) options.push(cell);
        }
      }
      const far = options.filter((cell) => card.every((o) => Board.dist(o, cell) >= MIN_GAP));
      const pool = far.length ? far : options;
      if (pool.length) card.push(pool[pickInt(rnd, pool.length)]);
    }
    return card;
  }

  root.FGCards = { SIZE, MIN_GAP, draw, seeded };
})(typeof window !== 'undefined' ? window : globalThis);
