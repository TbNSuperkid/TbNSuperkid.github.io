/*
 * Rennlogik von „Pferderennen“ – reine Funktionen, ohne Oberfläche.
 *
 * Ein Rennen ist ein schlichtes Objekt (lässt sich speichern und klonen):
 *   {
 *     length: 6,                                  Streckenkarten / Reihen
 *     track: ['H7', 'CK', …],  shown: [true, …],  Streckenkarten und ob sie schon aufgedeckt sind
 *     pos: { S: 0, H: 0, D: 0, C: 0 },            0 = Start, 1…length = Reihen, length + 1 = Ziel
 *     at:  { S: 0, … },                           wann das Pferd auf sein Feld kam (für Gleichstände)
 *     stack: [...], discard: [...],               verdeckter Stapel (oben = Index 0) und Aufgedecktes
 *     tick: 0, seq: 0, last: null, winner: null, events: []
 *   }
 *
 * Ablauf einer Karte (apply):
 *   1. Das Pferd in der Farbe der Karte zieht ein Feld vor. Läuft es über die letzte Reihe hinaus → Sieg.
 *   2. Haben alle vier Pferde die nächste noch verdeckte Reihe erreicht, wird deren Streckenkarte
 *      aufgedeckt und das Pferd dieser Farbe muss ein Feld zurück (nie hinter den Start).
 *      Das kann mehrere Reihen nacheinander auslösen.
 * draw() nimmt die oberste Karte vom Stapel; ist er leer, werden die aufgedeckten Karten neu gemischt.
 *
 * Ereignisse: move {suit, from, to, card} · track {row, card, suit, from, to} · finish {suit} · reshuffle {count}
 */
(function (root) {
  'use strict';

  const Cards = root.PFCards;
  const SUITS = Cards.SUITS;

  function clone(r) {
    return {
      length: r.length,
      track: r.track.slice(),
      shown: r.shown.slice(),
      pos: Object.assign({}, r.pos),
      at: Object.assign({}, r.at),
      stack: r.stack.slice(),
      discard: r.discard.slice(),
      tick: r.tick,
      seq: r.seq,
      last: r.last,
      winner: r.winner,
      events: r.events ? r.events.slice() : [],
    };
  }

  /**
   * Neues Rennen: Deck ohne Asse mischen, die ersten `length` Karten sind die Strecke, der Rest der Stapel.
   * @param {{size?: number, length?: number, random?: Function}} opts
   */
  function create(opts) {
    const o = opts || {};
    const length = o.length || 6;
    const deck = Cards.shuffle(Cards.withoutAces(o.size || 52), o.random);
    const zero = () => ({ S: 0, H: 0, D: 0, C: 0 });
    return {
      length,
      track: deck.slice(0, length),
      shown: deck.slice(0, length).map(() => false),
      pos: zero(),
      at: zero(),
      stack: deck.slice(length),
      discard: [],
      tick: 0,
      seq: 0,
      last: null,
      winner: null,
      events: [],
    };
  }

  function minPos(r) {
    return Math.min(...SUITS.map((s) => r.pos[s]));
  }

  /** Erste noch verdeckte Reihe (1-basiert), 0 wenn alle aufgedeckt sind */
  function nextRow(r) {
    const i = r.shown.indexOf(false);
    return i < 0 ? 0 : i + 1;
  }

  /**
   * Kern der Rennregeln: eine Karte anwenden, verändert r direkt.
   * events (optional) sammelt die Ereignisse – die Simulation der Live-Chancen lässt sie weg.
   */
  function advance(r, card, events) {
    if (r.winner) return;
    const suit = Cards.suitOf(card);
    r.tick += 1;
    r.last = card;
    const from = r.pos[suit];
    r.pos[suit] = from + 1;
    r.at[suit] = ++r.seq;
    if (events) events.push({ type: 'move', suit, from, to: from + 1, card });
    if (r.pos[suit] > r.length) {
      r.winner = suit;
      if (events) events.push({ type: 'finish', suit });
      return;
    }
    let row = nextRow(r);
    while (row && minPos(r) >= row) {
      r.shown[row - 1] = true;
      const tc = r.track[row - 1];
      const ts = Cards.suitOf(tc);
      const tFrom = r.pos[ts];
      const tTo = Math.max(0, tFrom - 1);
      if (tTo !== tFrom) {
        r.pos[ts] = tTo;
        r.at[ts] = ++r.seq;
      }
      if (events) events.push({ type: 'track', row, card: tc, suit: ts, from: tFrom, to: tTo });
      row = nextRow(r);
    }
  }

  /** Oberste Karte nehmen (leerer Stapel → Ablage neu mischen), verändert r direkt */
  function take(r, random, events) {
    if (!r.stack.length) {
      r.stack = Cards.shuffle(r.discard, random);
      r.discard = [];
      if (events) events.push({ type: 'reshuffle', count: r.stack.length });
    }
    const card = r.stack.shift();
    r.discard.push(card);
    return card;
  }

  /**
   * Eine aufgedeckte Karte anwenden. Rührt Stapel und Ablage nicht an.
   * @returns {{race: object, events: object[]}} neues Rennen + Ereignisse
   */
  function apply(race, card) {
    const r = clone(race);
    const events = [];
    advance(r, card, events);
    r.events = events;
    return { race: r, events };
  }

  /** Oberste Karte vom Stapel ziehen und anwenden */
  function draw(race, random) {
    if (race.winner) return { race: clone(race), events: [] };
    const r = clone(race);
    const events = [];
    advance(r, take(r, random, events), events);
    r.events = events;
    return { race: r, events };
  }

  /** Rennen bis zum Ende laufen lassen (verändert r, ohne Ereignisse) – für Simulationen */
  function runToEnd(r, random) {
    let guard = 10000;
    while (!r.winner && guard--) advance(r, take(r, random), null);
    return r.winner;
  }

  /** Platzierung: Sieger zuerst, dann nach Position, bei Gleichstand wer zuerst dort war */
  function ranking(race) {
    return SUITS.slice().sort((a, b) => {
      if (race.winner === a) return -1;
      if (race.winner === b) return 1;
      if (race.pos[b] !== race.pos[a]) return race.pos[b] - race.pos[a];
      return race.at[a] - race.at[b];
    });
  }

  /** Karten, die noch nicht aufgedeckt sind (Stapel + verdeckte Strecke) – z.B. für Live-Chancen */
  function hidden(race) {
    return race.stack.concat(race.track.filter((_, i) => !race.shown[i]));
  }

  root.PFRace = { create, apply, draw, advance, take, runToEnd, ranking, nextRow, hidden, clone };
})(typeof window !== 'undefined' ? window : globalThis);
