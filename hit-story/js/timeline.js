/*
 * Zeitstrahl von „Hit Story“: Lücken berechnen, prüfen, einsortieren.
 *
 * Ein Zeitstrahl ist eine nach Jahr sortierte Liste von Karten ({ id, title, artist, year }).
 * Bei n Karten gibt es n + 1 Lücken: Lücke 0 liegt vor der ersten Karte, Lücke n nach der letzten,
 * Lücke i zwischen Karte i − 1 und Karte i.
 * Gleiches Jahr wie eine Nachbarkarte zählt auf beiden Seiten als richtig (1983 passt vor und nach „1983“).
 */
(function (root) {
  'use strict';

  /** Nach Jahr sortieren, gleiche Jahre behalten ihre Reihenfolge */
  function sort(cards) {
    return (cards || [])
      .map((c, i) => ({ c, i }))
      .sort((a, b) => a.c.year - b.c.year || a.i - b.i)
      .map((x) => x.c);
  }

  function gapCount(cards) {
    return (cards || []).length + 1;
  }

  /** Jahre links und rechts einer Lücke – null = offen */
  function bounds(cards, gap) {
    const list = cards || [];
    return {
      lo: gap > 0 && list[gap - 1] ? list[gap - 1].year : null,
      hi: gap < list.length && list[gap] ? list[gap].year : null,
    };
  }

  function validGap(cards, gap) {
    return Number.isInteger(gap) && gap >= 0 && gap <= (cards || []).length;
  }

  /** Passt ein Song aus `year` in diese Lücke? */
  function fits(cards, gap, year) {
    if (!validGap(cards, gap)) return false;
    const { lo, hi } = bounds(cards, gap);
    return (lo === null || lo <= year) && (hi === null || year <= hi);
  }

  /** Alle Lücken, die für `year` richtig sind (bei gleichen Jahren mehrere nebeneinander) */
  function correctGaps(cards, year) {
    const out = [];
    for (let g = 0; g < gapCount(cards); g++) if (fits(cards, g, year)) out.push(g);
    return out;
  }

  /**
   * Karte einsortieren. Mit passender Lücke landet sie genau dort (wichtig bei gleichen Jahren),
   * sonst an der ersten richtigen Stelle. Gibt { cards, at } zurück, die alte Liste bleibt unverändert.
   */
  function insert(cards, card, gap) {
    const list = (cards || []).slice();
    const at = fits(list, gap, card.year) ? gap : correctGaps(list, card.year)[0];
    list.splice(at, 0, card);
    return { cards: list, at };
  }

  /** Beschriftung einer Lücke: „vor 1985“, „1985 – 2013“, „nach 2013“, „auch 1983“ */
  function gapLabel(cards, gap) {
    const { lo, hi } = bounds(cards, gap);
    if (lo === null && hi === null) return 'irgendwann';
    if (lo === null) return `vor ${hi}`;
    if (hi === null) return `nach ${lo}`;
    if (lo === hi) return `auch ${lo}`;
    return `${lo} – ${hi}`;
  }

  root.HSTimeline = { sort, gapCount, bounds, validGap, fits, correctGaps, insert, gapLabel };
})(typeof window !== 'undefined' ? window : globalThis);
