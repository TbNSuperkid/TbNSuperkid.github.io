/*
 * Die Farbtafel von „Farbgefühl“: 30 Spalten × 16 Reihen = 480 Farbtöne, Felder A1 … P30.
 *
 * Die Farben werden berechnet (nicht vom Original-Brett kopiert), und zwar im Farbraum OKLCH,
 * der wahrnehmungsgleich ist: Benachbarte Felder sehen ungefähr gleich weit voneinander entfernt aus.
 *  - Spalten = Farbton einmal rundherum (12° pro Spalte)
 *  - Reihen  = hell → dunkel; oben pastell, in der Mitte kräftig, unten tief
 * Farben außerhalb des Bildschirm-Farbraums (sRGB) werden durch weniger Sättigung zurückgeholt.
 * Laptop und Handys rechnen so exakt dieselben Hex-Werte.
 *
 * Abstand zweier Felder = Schachkönig-Abstand (diagonal zählt wie gerade).
 */
(function (root) {
  'use strict';

  const ROWS = 16;
  const COLS = 30;
  const ROW_NAMES = 'ABCDEFGHIJKLMNOP';
  const HUE_START = 18; // Spalte 1 beginnt bei Rot
  const L_TOP = 0.88;
  const L_BOTTOM = 0.34;

  /** Ziel-Sättigung pro Reihe (0 = oben, 1 = unten): oben pastell, Mitte kräftig, unten tief */
  function chromaFor(t) {
    return 0.085 + 0.17 * Math.sin(Math.PI * Math.min(1, 0.1 + t * 0.8));
  }

  function lightnessFor(t) {
    return L_TOP + (L_BOTTOM - L_TOP) * t;
  }

  /** OKLCH → lineares sRGB */
  function oklchToLinear(L, C, h) {
    const rad = (h * Math.PI) / 180;
    const a = C * Math.cos(rad);
    const b = C * Math.sin(rad);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
  }

  function inGamut(rgb) {
    return rgb.every((x) => x >= -0.0001 && x <= 1.0001);
  }

  function gamma(x) {
    const v = Math.max(0, Math.min(1, x));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  }

  function hex2(n) {
    return Math.round(n * 255)
      .toString(16)
      .padStart(2, '0');
  }

  /** OKLCH → Hex; zu kräftige Farben werden per Halbierung auf die größte darstellbare Sättigung gebracht */
  function oklchToHex(L, C, h) {
    let rgb = oklchToLinear(L, C, h);
    if (!inGamut(rgb)) {
      let lo = 0;
      let hi = C;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (inGamut(oklchToLinear(L, mid, h))) lo = mid;
        else hi = mid;
      }
      rgb = oklchToLinear(L, lo, h);
    }
    return '#' + rgb.map((x) => hex2(gamma(x))).join('');
  }

  /** Hex → OKLab (für Tests und Abstände) */
  function hexToLab(hex) {
    const lin = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    const [r, g, b] = lin;
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  /** Farbunterschied zweier Hex-Farben (euklidisch in OKLab) */
  function deltaE(h1, h2) {
    const a = hexToLab(h1);
    const b = hexToLab(h2);
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  function hexAt(t, h) {
    return oklchToHex(lightnessFor(t), chromaFor(t), h);
  }

  /**
   * Farbtöne der Spalten: nicht stur alle 12°, sondern so verteilt, dass benachbarte Spalten (gemessen an
   * einigen Referenzreihen) gleich weit auseinanderliegen. Sonst gäbe es viele fast gleiche Türkis-Spalten
   * und nur ein, zwei Gelbgrün-Spalten.
   */
  function columnHues() {
    const STEP = 0.5;
    const ref = [0, 0.25, 0.5, 0.75, 1];
    const cum = [0];
    let prev = ref.map((t) => hexAt(t, HUE_START));
    for (let i = 1; i <= 360 / STEP; i++) {
      const h = (HUE_START + i * STEP) % 360;
      const cur = ref.map((t) => hexAt(t, h));
      cum.push(cum[i - 1] + cur.reduce((sum, hex, k) => sum + deltaE(hex, prev[k]), 0));
      prev = cur;
    }
    const total = cum[cum.length - 1];
    const hues = [];
    let i = 0;
    for (let c = 0; c < COLS; c++) {
      const goal = (c * total) / COLS;
      while (cum[i + 1] < goal) i++;
      const f = cum[i + 1] > cum[i] ? (goal - cum[i]) / (cum[i + 1] - cum[i]) : 0;
      hues.push((HUE_START + (i + f) * STEP) % 360);
    }
    return hues;
  }

  // Alle 480 Farben einmal berechnen: COLORS[r][c]
  const HUES = columnHues();
  const COLORS = [];
  for (let r = 0; r < ROWS; r++) {
    const t = r / (ROWS - 1);
    COLORS.push(HUES.map((h) => hexAt(t, h)));
  }

  function valid(cell) {
    return !!cell && Number.isInteger(cell.r) && Number.isInteger(cell.c) && cell.r >= 0 && cell.r < ROWS && cell.c >= 0 && cell.c < COLS;
  }

  function color(cell) {
    return valid(cell) ? COLORS[cell.r][cell.c] : null;
  }

  /** {r: 0, c: 0} → 'A1' */
  function label(cell) {
    return valid(cell) ? ROW_NAMES[cell.r] + (cell.c + 1) : '';
  }

  /** 'A1' / 'a 1' → {r: 0, c: 0}, ungültig → null */
  function parse(text) {
    const m = /^\s*([a-p])\s*0*([1-9]\d?)\s*$/i.exec(String(text == null ? '' : text));
    if (!m) return null;
    const cell = { r: ROW_NAMES.indexOf(m[1].toUpperCase()), c: +m[2] - 1 };
    return valid(cell) ? cell : null;
  }

  /** Schachkönig-Abstand: diagonal zählt wie gerade */
  function dist(a, b) {
    return Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));
  }

  /** Punkte für einen Stein: genau 3, im Rahmen 2, direkt am Rahmen 1, sonst 0 */
  function points(stone, target) {
    return Math.max(0, 3 - dist(stone, target));
  }

  /** Liegt der Stein im 3 × 3-Rahmen (zählt für die hinweisgebende Person)? */
  function inFrame(stone, target) {
    return dist(stone, target) <= 1;
  }

  function same(a, b) {
    return !!a && !!b && a.r === b.r && a.c === b.c;
  }

  /** Feld innerhalb der Tafel halten */
  function clamp(cell) {
    return { r: Math.max(0, Math.min(ROWS - 1, cell.r | 0)), c: Math.max(0, Math.min(COLS - 1, cell.c | 0)) };
  }

  root.FGBoard = {
    ROWS,
    COLS,
    ROW_NAMES,
    COLORS,
    color,
    label,
    parse,
    dist,
    points,
    inFrame,
    same,
    valid,
    clamp,
    deltaE,
    hexToLab,
    oklchToHex,
  };
})(typeof window !== 'undefined' ? window : globalThis);
