/*
 * Live-Chancen für „Pferderennen“: das restliche Rennen ein paar tausend Mal durchspielen.
 *
 * Bekannt ist nur, WELCHE Karten noch verdeckt sind (Stapel + verdeckte Streckenkarten), nicht wo sie liegen.
 * Jede Simulation mischt diese Karten neu, legt sie auf die verdeckten Streckenplätze und den Stapel und lässt
 * das Rennen mit derselben Regel-Funktion wie das echte Rennen (race.js) zu Ende laufen.
 * So verrät die Chance nichts über die echte Lage der Streckenkarten.
 *
 *   chances(race, {runs, random}) → { S: 0.38, H: 0.12, D: 0.31, C: 0.19 }   (Summe 1)
 *   quote(p)                       → Quote für Quoten-Wetten, z.B. 2.4 (Auszahlung = Einsatz × Quote)
 */
(function (root) {
  'use strict';

  const Cards = root.PFCards;
  const Race = root.PFRace;
  const SUITS = Cards.SUITS;
  const RUNS = 2000;
  const HOUSE = 0.9; // Quoten etwas unter fair, damit Nachsetzen kein sicherer Gewinn ist
  const QUOTE_MIN = 1.1;
  const QUOTE_MAX = 25;

  function chances(race, opts) {
    const o = opts || {};
    const out = { S: 0, H: 0, D: 0, C: 0 };
    if (race.winner) {
      out[race.winner] = 1;
      return out;
    }
    const random = o.random || Math.random;
    const runs = o.runs || RUNS;
    const slots = [];
    race.shown.forEach((open, i) => {
      if (!open) slots.push(i);
    });
    // sortiert: das Ergebnis hängt nur davon ab, WELCHE Karten verdeckt sind – nicht von ihrer Lage
    const pool = race.stack.concat(slots.map((i) => race.track[i])).sort();
    const wins = { S: 0, H: 0, D: 0, C: 0 };
    for (let n = 0; n < runs; n++) {
      // mischen (Fisher-Yates auf einer Kopie)
      const cards = pool.slice();
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const t = cards[i];
        cards[i] = cards[j];
        cards[j] = t;
      }
      const track = race.track.slice();
      slots.forEach((slot, k) => (track[slot] = cards[k]));
      const sim = {
        length: race.length,
        track,
        shown: race.shown.slice(),
        pos: Object.assign({}, race.pos),
        at: Object.assign({}, race.at),
        stack: cards.slice(slots.length),
        discard: race.discard.slice(),
        tick: race.tick,
        seq: race.seq,
        last: race.last,
        winner: null,
      };
      wins[Race.runToEnd(sim, random)] += 1;
    }
    for (const s of SUITS) out[s] = wins[s] / runs;
    return out;
  }

  /** Quote aus der Chance: unter 5 auf 0,1 gerundet, darüber auf 0,5 */
  function quote(p) {
    if (!(p > 0)) return QUOTE_MAX;
    const raw = Math.max(QUOTE_MIN, Math.min(QUOTE_MAX, HOUSE / p));
    return raw < 5 ? Math.round(raw * 10) / 10 : Math.round(raw * 2) / 2;
  }

  function quotes(ch) {
    const out = {};
    for (const s of SUITS) out[s] = quote(ch[s]);
    return out;
  }

  root.PFOdds = { chances, quote, quotes, RUNS, QUOTE_MIN, QUOTE_MAX };
})(typeof window !== 'undefined' ? window : globalThis);
