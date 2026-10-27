/*
 * Duelle verteilen für „Pointe!“: Alle sitzen (gemischt) im Kreis, Duell i = Person i gegen Person i+1.
 * So steht jede/r in genau zwei Duellen (= zwei Satzanfänge) gegen zwei verschiedene Gegner (ab 3 Personen).
 * Ab Runde 2 wird so gemischt, dass möglichst wenige Paare aus früheren Runden wieder aufeinandertreffen.
 */
(function (root) {
  'use strict';

  const TRIES = 40;

  function shuffle(list, random) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Kennung eines Paares – egal, wer links steht */
  function pairKey(a, b) {
    return a < b ? a + '|' + b : b + '|' + a;
  }

  /** Kreis → Duelle */
  function ring(order) {
    const n = order.length;
    if (n < 2) return [];
    if (n === 2) return [{ a: order[0], b: order[1] }];
    return order.map((pid, i) => ({ a: pid, b: order[(i + 1) % n] }));
  }

  /**
   * @param {string[]} pids Mitspielende
   * @param {Function} [random]
   * @param {string[]|Set<string>} [avoid] Paare (pairKey) aus früheren Runden
   * @returns {{a: string, b: string}[]} n Duelle (bei 2 Personen eines)
   */
  function duels(pids, random, avoid) {
    const rnd = random || Math.random;
    const old = new Set(avoid || []);
    let best = null;
    let bestOverlap = Infinity;
    for (let t = 0; t < (old.size ? TRIES : 1); t++) {
      const list = ring(shuffle(pids, rnd));
      const overlap = list.filter((d) => old.has(pairKey(d.a, d.b))).length;
      if (overlap < bestOverlap) {
        best = list;
        bestOverlap = overlap;
        if (!overlap) break;
      }
    }
    // Wer links/rechts steht, ist egal – aber jede/r soll mal „a“ und mal „b“ sein
    return best || [];
  }

  /** Zählt für jede Person: Duelle und Gegner (für Tests und Prüfungen) */
  function summary(list) {
    const out = {};
    for (const d of list) {
      for (const [me, other] of [
        [d.a, d.b],
        [d.b, d.a],
      ]) {
        const s = (out[me] = out[me] || { duels: 0, opponents: [] });
        s.duels += 1;
        s.opponents.push(other);
      }
    }
    return out;
  }

  root.PointePairing = { duels, ring, shuffle, pairKey, summary };
})(typeof window !== 'undefined' ? window : globalThis);
