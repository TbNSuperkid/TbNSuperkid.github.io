/*
 * Weitergabe bei Flüsterpost (reine Rechnerei, ohne Browser testbar).
 *
 * n Personen sitzen in fester Reihenfolge (order). Jede Person besitzt eine Kette (Kette c gehört order[c]).
 * Im Schritt k bearbeitet Person i die Kette (i − k) mod n – im Schritt 0 also die eigene, danach jeweils die der
 * Person „davor“. So sieht niemand seine eigene Kette wieder, bevor sie fertig ist, und bei n Schritten kommt jede
 * Kette bei allen genau einmal vorbei.
 *
 * Schrittarten:
 *   write    einen Satz ausdenken (Schritt 0)
 *   draw     den Satz / das Wort davor zeichnen
 *   describe die Zeichnung davor beschreiben
 *   copy     die Zeichnung davor kurz ansehen und aus dem Gedächtnis nachzeichnen (Modus „Nur Zeichnen“)
 *
 * Modi:
 *   normal  write → draw → describe → draw → …
 *   words   Die Kette beginnt mit einem Startwort (Eintrag 0, von niemandem): draw → describe → draw → …
 *   copy    write → draw → copy → copy → … → describe (letzter Schritt, ab 3 Schritten)
 */
(function (root) {
  'use strict';

  const MIN_STEPS = 2;

  /** Anzahl Schritte: setting 0 = so viele wie Personen, sonst höchstens so viele wie Personen */
  function stepCount(n, setting) {
    const want = setting ? Math.min(setting, n) : n;
    return Math.max(Math.min(MIN_STEPS, n), want);
  }

  /** Welche Kette bearbeitet Person i im Schritt k? */
  function chainOf(n, k, i) {
    return (((i - k) % n) + n) % n;
  }

  /** Wer bearbeitet Kette c im Schritt k? */
  function holderOf(n, k, c) {
    return (c + k) % n;
  }

  /** Bei „Wort-Start“ steht vor dem ersten Schritt das Startwort in der Kette */
  function offset(mode) {
    return mode === 'words' ? 1 : 0;
  }

  /** Art des Schritts k (0-basiert) bei steps Schritten insgesamt */
  function stepType(mode, k, steps) {
    if (mode === 'words') return k % 2 === 0 ? 'draw' : 'describe';
    if (k === 0) return 'write';
    if (mode === 'copy') {
      if (k === 1) return 'draw';
      return k === steps - 1 && k >= 2 ? 'describe' : 'copy';
    }
    return k % 2 === 1 ? 'draw' : 'describe';
  }

  /** Text- oder Bild-Schritt? */
  function isDrawing(type) {
    return type === 'draw' || type === 'copy';
  }

  /**
   * Ganze Tabelle: plan[k][i] = Index der Kette, die Person i im Schritt k bearbeitet.
   * (Für Tests und zur Kontrolle – das Spiel rechnet Schritt für Schritt.)
   */
  function plan(n, steps) {
    const out = [];
    for (let k = 0; k < steps; k++) {
      const row = [];
      for (let i = 0; i < n; i++) row.push(chainOf(n, k, i));
      out.push(row);
    }
    return out;
  }

  root.FpChain = { MIN_STEPS, stepCount, chainOf, holderOf, offset, stepType, isDrawing, plan };
})(typeof window !== 'undefined' ? window : globalThis);
