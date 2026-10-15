/*
 * Kartendeck für „Pferderennen“: 32 (Skatblatt) oder 52 Karten, Asse raus, mischen.
 *
 * Karten sind kurze Zeichenketten: Farbe + Wert, z.B. 'H7', 'CK', 'S10', 'DA'.
 *   Farben:  S = Pik ♠ · H = Herz ♥ · D = Karo ♦ · C = Kreuz ♣
 *   Werte:   2–10, J (Bube), Q (Dame), K (König), A (Ass)
 * Angezeigt wird deutsch: Bube = B, Dame = D.
 */
(function (root) {
  'use strict';

  const SUITS = ['S', 'H', 'D', 'C'];
  const SUIT = {
    S: { symbol: '♠', name: 'Pik', red: false },
    H: { symbol: '♥', name: 'Herz', red: true },
    D: { symbol: '♦', name: 'Karo', red: true },
    C: { symbol: '♣', name: 'Kreuz', red: false },
  };
  const RANKS = {
    52: ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'],
    32: ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'],
  };
  const SIZES = [52, 32];
  const RANK_LABEL = { J: 'B', Q: 'D', K: 'K', A: 'A' };

  function suitOf(card) {
    return card[0];
  }

  function rankOf(card) {
    return card.slice(1);
  }

  /** Alle Karten eines Decks (mit Assen) */
  function build(size) {
    const ranks = RANKS[size] || RANKS[52];
    const out = [];
    for (const s of SUITS) for (const r of ranks) out.push(s + r);
    return out;
  }

  /** Deck ohne die vier Asse (die sind die Pferde) */
  function withoutAces(size) {
    return build(size).filter((c) => rankOf(c) !== 'A');
  }

  /** Fisher-Yates, gibt ein neues Array zurück */
  function shuffle(cards, random) {
    const rnd = random || Math.random;
    const a = cards.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  /** Zufall mit festem Startwert (mulberry32) – für Tests und wiederholbare Rennen */
  function seeded(seed) {
    let x = (seed >>> 0) || 1;
    return () => {
      x = (x + 0x6d2b79f5) >>> 0;
      let t = x;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Für die Anzeige: { suit, symbol, name, rank ('7', 'B', 'D' …), red } */
  function label(card) {
    const s = SUIT[suitOf(card)] || SUIT.S;
    const r = rankOf(card);
    return { suit: suitOf(card), symbol: s.symbol, name: s.name, rank: RANK_LABEL[r] || r, red: s.red };
  }

  function valid(card) {
    return typeof card === 'string' && !!SUIT[suitOf(card)] && RANKS[52].includes(rankOf(card));
  }

  root.PFCards = { SUITS, SUIT, RANKS, SIZES, suitOf, rankOf, build, withoutAces, shuffle, seeded, label, valid };
})(typeof window !== 'undefined' ? window : globalThis);
