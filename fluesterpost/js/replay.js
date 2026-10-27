/*
 * Zeichnungen bei Flüsterpost: prüfen, verdichten, nachzeichnen, als Bild speichern.
 *
 * Eine Zeichnung ist eine Liste von Nachrichten aus shared/sketch.js ({k:'b'|'p'|'f'|'u'|'clear', …}), jede mit
 * Zeitstempel t (ms seit Beginn des Schritts). Das Handy schickt sie erst beim „Fertig“ (bzw. als Zwischenstand).
 *
 *   cleanOp(msg)      eine Nachricht vom Handy prüfen (nie blind übernehmen) → saubere Kopie oder null
 *   compact(ops)      Rückgängig/Löschen anwenden, Punkte ausdünnen (~2 px), Größe begrenzen → nur was am Ende zu sehen ist
 *   timeline(ops)     Zeitplan fürs Nachzeichnen: Pausen gekürzt, doppelt so schnell, 1,5 bis 9 s
 *   Player            spielt eine Zeichnung auf einer GameSketch-Fläche Strich für Strich ab (Browser)
 *   exportChain(…)    eine ganze Kette als lange Grafik (Canvas) zum Speichern (Browser)
 */
(function (root) {
  'use strict';

  const MAX_NUMS = 10000; // Koordinaten pro Zeichnung (x und y einzeln) → höchstens ~60 KB
  const MAX_OPS = 3000;
  const THIN = 0.004; // Mindestabstand zweier Punkte (normiert) – auf dem Handy etwa 2 px
  const MAX_T = 60 * 60 * 1000;
  const SPEED = 2;
  const MAX_GAP = 1200; // längere Denkpausen werden gekürzt (vor dem Beschleunigen)
  const MAX_DURATION = 9000;
  const MIN_DURATION = 1500;

  function num(v) {
    return typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, Math.round(v * 1000) / 1000)) : null;
  }

  function time(v) {
    return typeof v === 'number' && isFinite(v) ? Math.min(MAX_T, Math.max(0, Math.round(v))) : 0;
  }

  /** Eine Zeichen-Nachricht prüfen. Gibt eine saubere Kopie (mit t) oder null zurück. */
  function cleanOp(msg) {
    if (!msg || typeof msg !== 'object') return null;
    const id = typeof msg.id === 'string' ? msg.id.slice(0, 24) : null;
    const color = typeof msg.c === 'string' && /^#[0-9a-f]{6}$/i.test(msg.c) ? msg.c : null;
    const t = time(msg.t);
    switch (msg.k) {
      case 'clear':
        return { k: 'clear', t };
      case 'u':
        return id ? { k: 'u', id, t } : null;
      case 'b': {
        const x = num(msg.x);
        const y = num(msg.y);
        const w = typeof msg.w === 'number' && isFinite(msg.w) ? Math.min(0.1, Math.max(0.001, msg.w)) : null;
        return id && color && x !== null && y !== null && w !== null ? { k: 'b', id, c: color, w, x, y, t } : null;
      }
      case 'f': {
        const x = num(msg.x);
        const y = num(msg.y);
        return id && color && x !== null && y !== null ? { k: 'f', id, c: color, x, y, t } : null;
      }
      case 'p': {
        if (!id || !Array.isArray(msg.pts) || !msg.pts.length || msg.pts.length % 2 || msg.pts.length > 4000) return null;
        const pts = msg.pts.map(num);
        return pts.includes(null) ? null : { k: 'p', id, pts, t };
      }
      default:
        return null;
    }
  }

  /** Liste vom Handy prüfen (ungültige Nachrichten fallen weg) */
  function cleanOps(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const msg of list.slice(0, MAX_OPS * 2)) {
      const op = cleanOp(msg);
      if (op) out.push(op);
    }
    return out;
  }

  /**
   * Nur behalten, was am Ende zu sehen ist: Rückgängig gemachte Striche und alles vor „Löschen“ fallen weg,
   * Punkte werden ausgedünnt, Zeitstempel steigen nie ab. Zu große Zeichnungen werden abgeschnitten.
   */
  function compact(ops) {
    let alive = [];
    for (const op of ops || []) {
      if (op.k === 'clear') alive = [];
      else if (op.k === 'b' || op.k === 'f') alive.push(op.id);
      else if (op.k === 'u') {
        const i = alive.lastIndexOf(op.id);
        if (i >= 0) alive.splice(i, 1);
      }
    }
    const keep = new Set(alive);
    const out = [];
    const last = {};
    let nums = 0;
    let t = 0;
    for (const op of ops || []) {
      if (out.length >= MAX_OPS || nums >= MAX_NUMS) break;
      if (!keep.has(op.id)) continue;
      t = Math.max(t, op.t || 0);
      if (op.k === 'b' || op.k === 'f') {
        if (last[op.id]) continue; // doppelte Kennung
        out.push(Object.assign({}, op, { t }));
        last[op.id] = op.k === 'b' ? [op.x, op.y] : null;
        nums += 2;
      } else if (op.k === 'p' && last[op.id]) {
        const pts = [];
        let [lx, ly] = last[op.id];
        for (let i = 0; i + 1 < op.pts.length && nums + pts.length < MAX_NUMS; i += 2) {
          const x = op.pts[i];
          const y = op.pts[i + 1];
          if (Math.abs(x - lx) + Math.abs(y - ly) < THIN) continue;
          pts.push(x, y);
          lx = x;
          ly = y;
        }
        if (!pts.length) continue;
        last[op.id] = [lx, ly];
        out.push({ k: 'p', id: op.id, pts, t });
        nums += pts.length;
      }
    }
    return out;
  }

  /** Anzahl Punkte einer Zeichnung (für Tests und Statistik) */
  function points(ops) {
    let n = 0;
    for (const op of ops || []) n += op.k === 'p' ? op.pts.length / 2 : op.k === 'b' ? 1 : 0;
    return n;
  }

  /**
   * Zeitplan fürs Nachzeichnen: [{at, op}] (ms ab Start) und duration.
   * Reihenfolge bleibt, Pausen über MAX_GAP werden gekürzt, alles läuft SPEED-mal so schnell
   * und dauert MIN_DURATION bis MAX_DURATION (gleichmäßig gestreckt bzw. gestaucht).
   */
  function timeline(ops, opts) {
    const o = opts || {};
    const speed = o.speed || SPEED;
    const maxGap = o.maxGap || MAX_GAP;
    const maxDuration = o.maxDuration || MAX_DURATION;
    const minDuration = o.minDuration != null ? o.minDuration : MIN_DURATION;
    const events = [];
    let at = 0;
    let prev = null;
    for (const op of ops || []) {
      const t = typeof op.t === 'number' ? op.t : prev == null ? 0 : prev + 30;
      if (prev != null) at += Math.min(Math.max(0, t - prev), maxGap) / speed;
      prev = t;
      events.push({ at, op });
    }
    let duration = at;
    // Lange Zeichnungen gleichmäßig stauchen, ganz schnelle Kritzeleien etwas strecken (sonst sieht man nichts)
    const target = duration > maxDuration ? maxDuration : duration > 0 && duration < minDuration ? minDuration : duration;
    if (target !== duration) {
      const f = target / duration;
      for (const e of events) e.at *= f;
      duration = target;
    }
    return { events, duration };
  }

  /* ---------------------------------------------------------------- */
  /* Browser                                                           */
  /* ---------------------------------------------------------------- */

  /** Spielt eine Zeichnung auf einer Zeichenfläche (shared/sketch.js) ab. onDone wird am Ende aufgerufen. */
  class Player {
    constructor(sketch, ops, opts) {
      this.sketch = sketch;
      this.opts = opts || {};
      this.plan = timeline(ops, this.opts);
      this.i = 0;
      this.stopped = false;
      sketch.reset();
      this.start = root.performance.now() + (this.opts.delay || 0);
      this.frame = root.requestAnimationFrame(() => this.step());
    }

    step() {
      if (this.stopped) return;
      const elapsed = root.performance.now() - this.start;
      const ev = this.plan.events;
      while (this.i < ev.length && ev[this.i].at <= elapsed) this.sketch.apply(ev[this.i++].op);
      if (this.i >= ev.length) {
        this.stopped = true;
        if (this.opts.onDone) this.opts.onDone();
        return;
      }
      this.frame = root.requestAnimationFrame(() => this.step());
    }

    /** Sofort fertig zeichnen */
    finish() {
      if (this.stopped) return;
      const ev = this.plan.events;
      while (this.i < ev.length) this.sketch.apply(ev[this.i++].op);
      this.stop();
      if (this.opts.onDone) this.opts.onDone();
    }

    stop() {
      this.stopped = true;
      root.cancelAnimationFrame(this.frame);
    }
  }

  function wrap(ctx, text, maxWidth) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * Eine Kette als lange Grafik.
   * @param {{title:string, entries:{name:string, color:string, kind:string, text?:string, ops?:object[], note?:string}[], fill?:Function, footer?:string}} chain
   * @returns {HTMLCanvasElement}
   */
  function exportChain(chain) {
    const W = 900;
    const PAD = 40;
    const INNER = W - PAD * 2;
    const IMG_H = Math.round((INNER * 3) / 4);
    const display = "'Fredoka', 'Nunito', system-ui, sans-serif";
    const body = "'Nunito', system-ui, sans-serif";
    const measure = root.document.createElement('canvas').getContext('2d');
    measure.font = `700 34px ${body}`;
    const blocks = chain.entries.map((e) => {
      if (e.ops) return { e, h: 44 + IMG_H + 26 };
      const lines = wrap(measure, e.note || e.text || '', INNER - 48);
      return { e, lines, h: 44 + lines.length * 44 + 40 + 26 };
    });
    const H = PAD + 70 + blocks.reduce((a, b) => a + b.h, 0) + 50;
    const canvas = root.document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#1b1640');
    grad.addColorStop(1, '#0f1a33');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fde047';
    ctx.font = `700 44px ${display}`;
    ctx.textBaseline = 'top';
    ctx.fillText(chain.title, PAD, PAD);
    let y = PAD + 70;
    for (const b of blocks) {
      const e = b.e;
      ctx.fillStyle = e.color || '#e5e7eb';
      ctx.beginPath();
      ctx.arc(PAD + 10, y + 15, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e5e7eb';
      ctx.font = `800 26px ${body}`;
      ctx.fillText(`${e.kind === 'word' ? '🎲' : e.ops ? '🖍️' : e.kind === 'write' ? '✍️' : '💬'} ${e.name}`, PAD + 30, y + 1);
      y += 44;
      if (e.ops) {
        const img = root.document.createElement('canvas');
        img.width = INNER;
        img.height = IMG_H;
        root.GameSketch.paint(img, e.ops, chain.fill);
        ctx.save();
        roundRect(ctx, PAD, y, INNER, IMG_H, 18);
        ctx.clip();
        ctx.drawImage(img, PAD, y);
        ctx.restore();
        y += IMG_H + 26;
      } else {
        const boxH = b.lines.length * 44 + 40;
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        roundRect(ctx, PAD, y, INNER, boxH, 18);
        ctx.fill();
        ctx.fillStyle = e.note ? '#b8c1d9' : '#ffffff';
        ctx.font = `${e.note ? 'italic 600' : '700'} 34px ${body}`;
        b.lines.forEach((line, i) => ctx.fillText(line, PAD + 24, y + 22 + i * 44));
        y += boxH + 26;
      }
    }
    ctx.fillStyle = '#b8c1d9';
    ctx.font = `600 22px ${body}`;
    ctx.fillText(chain.footer || '🖍️ Flüsterpost', PAD, H - 44);
    return canvas;
  }

  root.FpReplay = { MAX_NUMS, MAX_OPS, THIN, SPEED, MAX_GAP, MAX_DURATION, MIN_DURATION, cleanOp, cleanOps, compact, points, timeline, Player, exportChain };
})(typeof window !== 'undefined' ? window : globalThis);
