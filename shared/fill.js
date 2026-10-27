/*
 * Farbeimer für alle Zeichenspiele (Skribbl, Flüsterpost): Flood-Fill auf dem Canvas.
 * Gefüllt wird die zusammenhängende Fläche mit (fast) derselben Farbe wie der angeklickte Punkt. Danach wird die
 * Fläche um einen Pixel erweitert, damit an weichgezeichneten Strichkanten keine hellen Säume stehen bleiben.
 *
 * flood(data, w, h, x, y, rgba, tol) arbeitet auf reinen Pixeldaten (testbar ohne Browser),
 * paint(ctx, x, y, color) ist die Brücke zum Canvas (wird an shared/sketch.js als opts.fill übergeben).
 */
(function (root) {
  'use strict';

  const TOLERANCE = 48;

  /** '#rrggbb' → [r, g, b, 255] */
  function rgba(color) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(color || ''));
    if (!m) return [0, 0, 0, 255];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }

  /**
   * Füllt die Fläche um (x, y).
   * @param {Uint8ClampedArray|number[]} data RGBA-Pixel (wird verändert)
   * @returns {number} Anzahl gefärbter Pixel (0 = schon diese Farbe / außerhalb)
   */
  function flood(data, w, h, x, y, color, tol) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    const t = tol == null ? TOLERANCE : tol;
    const fill = Array.isArray(color) ? color : rgba(color);
    const i0 = (y * w + x) * 4;
    const target = [data[i0], data[i0 + 1], data[i0 + 2], data[i0 + 3]];
    if (target.every((v, k) => Math.abs(v - fill[k]) <= 2)) return 0;
    const mask = new Uint8Array(w * h);
    const fits = (px, py) => {
      const p = py * w + px;
      if (mask[p]) return false;
      const i = p * 4;
      return (
        Math.abs(data[i] - target[0]) <= t &&
        Math.abs(data[i + 1] - target[1]) <= t &&
        Math.abs(data[i + 2] - target[2]) <= t &&
        Math.abs(data[i + 3] - target[3]) <= t
      );
    };
    // Scanline-Füllung: ganze Zeilenstücke auf einmal, darüber und darunter neue Startpunkte
    const stack = [x, y];
    while (stack.length) {
      const py = stack.pop();
      const px = stack.pop();
      if (!fits(px, py)) continue;
      let lx = px;
      while (lx > 0 && fits(lx - 1, py)) lx--;
      let rx = px;
      while (rx < w - 1 && fits(rx + 1, py)) rx++;
      for (let i = lx; i <= rx; i++) mask[py * w + i] = 1;
      for (const ny of [py - 1, py + 1]) {
        if (ny < 0 || ny >= h) continue;
        let run = false;
        for (let i = lx; i <= rx; i++) {
          if (fits(i, ny)) {
            if (!run) stack.push(i, ny);
            run = true;
          } else run = false;
        }
      }
    }
    // Fläche plus 1 Pixel Rand einfärben
    let count = 0;
    const paint = (p) => {
      const i = p * 4;
      data[i] = fill[0];
      data[i + 1] = fill[1];
      data[i + 2] = fill[2];
      data[i + 3] = fill[3];
      count++;
    };
    const edge = new Uint8Array(w * h);
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      paint(p);
      const px = p % w;
      const py = (p - px) / w;
      if (px > 0 && !mask[p - 1]) edge[p - 1] = 1;
      if (px < w - 1 && !mask[p + 1]) edge[p + 1] = 1;
      if (py > 0 && !mask[p - w]) edge[p - w] = 1;
      if (py < h - 1 && !mask[p + w]) edge[p + w] = 1;
    }
    for (let p = 0; p < edge.length; p++) if (edge[p]) paint(p);
    return count;
  }

  /** Farbeimer auf einem Canvas (Koordinaten in Canvas-Pixeln) */
  function paint(ctx, x, y, color) {
    const { width, height } = ctx.canvas;
    if (!width || !height) return;
    const img = ctx.getImageData(0, 0, width, height);
    if (flood(img.data, width, height, x, y, color)) ctx.putImageData(img, 0, 0);
  }

  root.GameFill = { flood, paint, rgba, TOLERANCE };
})(typeof window !== 'undefined' ? window : globalThis);
