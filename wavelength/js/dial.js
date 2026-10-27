/*
 * Die Skala von „Wavelength“ als SVG: Halbkreis, Zielscheibe mit 5 Streifen (2 · 3 · 4 · 3 · 2), Abdeckung,
 * die wie ein Fächer aufklappt, und der Zeiger. Winkel 0° = linkes Ende, 90° = oben, 180° = rechtes Ende.
 *
 *   WLDial.svg({ id, dial, target, band, cover, input, ... })  → SVG als Text (für morphdom)
 *   WLDial.angleAt(svgEl, clientX, clientY)                    → Winkel unter dem Finger / der Maus
 *
 * Gezeichnet wird in einem festen Koordinatensystem (viewBox 400 × 214) – skaliert sauber auf Fernseher und Handy.
 */
(function (root) {
  'use strict';

  const W = 400;
  const H = 214;
  const CX = 200;
  const CY = 202;
  const R = 188;
  const BANDS = [2, 3, 4, 3, 2];

  const round1 = (n) => Math.round(n * 10) / 10;

  function clampAngle(a) {
    if (!Number.isFinite(a)) return 90;
    return round1(Math.min(180, Math.max(0, a)));
  }

  /** Punkt auf dem Halbkreis (Radius r) zum Winkel a */
  function point(a, r) {
    const rad = (a * Math.PI) / 180;
    return [CX - r * Math.cos(rad), CY - r * Math.sin(rad)];
  }

  const f = (n) => n.toFixed(2);

  /** Tortenstück von a1 bis a2 (a1 < a2) */
  function wedge(a1, a2, r) {
    const [x1, y1] = point(a1, r);
    const [x2, y2] = point(a2, r);
    const large = a2 - a1 > 180 ? 1 : 0;
    return `M${CX} ${CY} L${f(x1)} ${f(y1)} A${r} ${r} 0 ${large} 1 ${f(x2)} ${f(y2)} Z`;
  }

  /** Halbe Scheibe (die Skala selbst) */
  function half(r) {
    return `M${CX - r} ${CY} A${r} ${r} 0 0 1 ${CX + r} ${CY} Z`;
  }

  function ticks() {
    let out = '';
    for (let a = 0; a <= 180; a += 10) {
      const long = a % 30 === 0;
      const [x1, y1] = point(a, R - (long ? 14 : 8));
      const [x2, y2] = point(a, R - 2);
      out += `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" class="wl-tick ${long ? 'is-long' : ''}" />`;
    }
    return out;
  }

  /** Zielscheibe: 5 Streifen um den Zielwinkel, jeder `band` Grad breit */
  function targetHtml(target, band) {
    let out = '';
    BANDS.forEach((pts, i) => {
      const k = i - 2;
      const a1 = target + (k - 0.5) * band;
      const a2 = target + (k + 0.5) * band;
      out += `<path d="${wedge(a1, a2, R - 3)}" class="wl-band wl-b${pts}" />`;
      const [tx, ty] = point(target + k * band, R - 26);
      out += `<text x="${f(tx)}" y="${f(ty)}" class="wl-band-num" dominant-baseline="central" text-anchor="middle">${pts}</text>`;
    });
    return out;
  }

  /**
   * @param {object} o
   * @param {string} o.id        eindeutige Kennung (morphdom hält damit Zeiger und Abdeckung fest → Animationen)
   * @param {number} o.dial      Winkel des Zeigers (null = kein Zeiger)
   * @param {number} [o.target]  Zielwinkel (null = unbekannt)
   * @param {number} o.band      Breite eines Streifens in Grad
   * @param {'closed'|'open'|'none'} [o.cover] Abdeckung: zu, aufgeklappt (Animation) oder gar keine
   * @param {boolean} [o.input]  Zeiger lässt sich ziehen
   * @param {boolean} [o.dragging] gerade wird gezogen (ohne Nachlauf-Animation)
   * @param {number} [o.ghost]   zweiter, blasser Zeiger (z.B. der Tipp vom Handy, solange gezogen wird)
   * @param {string} [o.cls]     zusätzliche CSS-Klassen
   * @param {string} [o.label]   Beschreibung für Screenreader
   */
  function svg(o) {
    const id = String(o.id || 'dial').replace(/[^a-zA-Z0-9_-]/g, '');
    const cover = o.cover || 'none';
    const hasTarget = o.target != null && Number.isFinite(o.target);
    const showDial = o.dial != null && Number.isFinite(o.dial);
    const parts = [];
    parts.push(`<defs>
      <clipPath id="wl-clip-${id}"><path d="${half(R)}" /></clipPath>
      <pattern id="wl-stripes-${id}" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
        <rect width="14" height="14" class="wl-cover-a" /><rect width="7" height="14" class="wl-cover-b" />
      </pattern>
    </defs>`);
    parts.push(`<path d="${half(R)}" class="wl-face" />`);
    parts.push(`<g clip-path="url(#wl-clip-${id})">`);
    // Immer vorhanden (auch leer), damit morphdom die Abdeckung dahinter nicht verschiebt – sonst stockt die Animation
    parts.push(`<g id="wl-target-${id}" class="wl-target">${hasTarget ? targetHtml(o.target, o.band) : ''}</g>`);
    if (cover !== 'none') {
      parts.push(`<g id="wl-cover-${id}" class="wl-cover ${cover === 'open' ? 'is-open' : ''}">
        <path d="${half(R + 4)}" fill="url(#wl-stripes-${id})" />
        <path d="${half(R * 0.36)}" class="wl-cover-hub" />
        <text x="${CX}" y="${CY - R * 0.58}" class="wl-cover-q" text-anchor="middle" dominant-baseline="central">?</text>
      </g>`);
    }
    parts.push('</g>');
    parts.push(`<path d="${half(R)}" class="wl-rim" />`);
    parts.push(ticks());
    parts.push(`<line x1="${CX - R}" y1="${CY}" x2="${CX + R}" y2="${CY}" class="wl-base" />`);
    if (o.ghost != null && Number.isFinite(o.ghost)) {
      parts.push(`<g class="wl-pointer wl-ghost" style="transform:rotate(${round1(o.ghost)}deg)"><line x1="${CX}" y1="${CY}" x2="${CX - R + 10}" y2="${CY}" /></g>`);
    }
    if (showDial) {
      parts.push(`<g id="wl-ptr-${id}" class="wl-pointer ${o.dragging ? 'is-dragging' : ''}" style="transform:rotate(${round1(o.dial)}deg)">
        <line x1="${CX}" y1="${CY}" x2="${CX - R + 6}" y2="${CY}" class="wl-pointer-line" />
        <circle cx="${CX - R + 14}" cy="${CY}" r="7" class="wl-pointer-tip" />
      </g>`);
    }
    parts.push(`<circle cx="${CX}" cy="${CY}" r="17" class="wl-hub" />`);
    if (o.input) parts.push(`<path d="${half(R + 12)}" class="wl-hit" />`);
    const label = o.label ? `<title>${o.label}</title>` : '';
    return `<svg class="wl-dial ${o.input ? 'is-input' : ''} ${o.cls || ''}" id="wl-dial-${id}" viewBox="0 0 ${W} ${H}" role="img" ${
      o.input ? `data-dial-input="1" tabindex="0" aria-label="Zeiger: Pfeiltasten oder ziehen"` : ''
    }>${label}${parts.join('')}</svg>`;
  }

  /** Winkel (0–180) an einer Bildschirmposition über dem SVG – unterhalb der Grundlinie: das nähere Ende */
  function angleAt(el, clientX, clientY) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return 90;
    const x = ((clientX - rect.left) / rect.width) * W;
    const y = ((clientY - rect.top) / rect.height) * H;
    const dx = x - CX;
    const dy = CY - y;
    let a = (Math.atan2(dy, -dx) * 180) / Math.PI;
    if (dy < 0 || a < 0) a = dx < 0 ? 0 : 180;
    return clampAngle(a);
  }

  root.WLDial = { W, H, CX, CY, R, BANDS, svg, angleAt, clampAngle, point };
})(typeof window !== 'undefined' ? window : globalThis);
