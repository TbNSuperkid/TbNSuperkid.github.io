/*
 * Zeichenfläche für alle Spiele (Guess the word! – Kategorie Zeichnen, Skribbl, später Stille Post).
 * Koordinaten werden normiert (0..1) übertragen, damit jede Bildschirmgröße passt.
 *
 * Alles, was gezeichnet wird, läuft als kleine Nachrichten (onLocal) zu den anderen Geräten:
 *   { k: 'b', id, c, w, x, y }   Strich beginnt
 *   { k: 'p', id, pts }          neue Punkte (gebündelt, alle ~45 ms)
 *   { k: 'f', id, c, x, y }      Farbeimer (nur mit opts.fill)
 *   { k: 'u', id }               Rückgängig (Strich oder Füllung)
 *   { k: 'clear' }               alles löschen
 *
 * Optionen: editable, onLocal(msg), fill(ctx, px, py, color) – Flood-Fill auf dem Canvas (ohne: kein Farbeimer)
 */
(function (root) {
  'use strict';

  const BG = '#fffdf7';

  class Sketch {
    /**
     * @param {HTMLElement} host Container (feste Seitenverhältnis via CSS)
     * @param {{editable?:boolean, onLocal?:Function, fill?:Function}} opts
     */
    constructor(host, opts) {
      this.host = host;
      this.opts = opts || {};
      this.strokes = []; // Striche und Füllungen in Reihenfolge
      this.color = '#1f2937';
      this.width = 0.008;
      this.tool = 'pen';
      this.editable = !!this.opts.editable;
      this.current = null;
      this.pending = [];
      this.seq = 0;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'sketch-canvas';
      host.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: !!this.opts.fill });
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(host);
      this.bind();
      this.resize();
    }

    destroy() {
      this.ro.disconnect();
      clearTimeout(this.flushTimer);
      this.canvas.remove();
    }

    setEditable(on) {
      this.editable = !!on;
      this.canvas.classList.toggle('editable', this.editable);
      this.canvas.classList.toggle('tool-fill', this.editable && this.tool === 'fill');
    }

    resize() {
      const rect = this.host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(this.opts.maxDpr || 2.5, root.devicePixelRatio || 1);
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (w === this.canvas.width && h === this.canvas.height) return;
      this.canvas.width = w;
      this.canvas.height = h;
      this.redraw();
    }

    point(e) {
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
    }

    nextId() {
      return Date.now().toString(36) + '-' + this.seq++;
    }

    bind() {
      const c = this.canvas;
      c.addEventListener('pointerdown', (e) => {
        if (!this.editable) return;
        e.preventDefault();
        const [x, y] = this.point(e);
        const id = this.nextId();
        if (this.tool === 'fill' && this.opts.fill) {
          const f = { id, fill: true, c: this.color, x, y };
          this.strokes.push(f);
          this.drawFill(f);
          this.emit({ k: 'f', id, c: this.color, x, y });
          return;
        }
        c.setPointerCapture(e.pointerId);
        this.current = { id, c: this.color, w: this.width, pts: [x, y] };
        this.strokes.push(this.current);
        this.emit({ k: 'b', id, c: this.color, w: this.width, x, y });
        this.drawStroke(this.current);
      });
      c.addEventListener('pointermove', (e) => {
        if (!this.editable || !this.current) return;
        e.preventDefault();
        const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of events.length ? events : [e]) {
          const [x, y] = this.point(ev);
          const pts = this.current.pts;
          const lx = pts[pts.length - 2];
          const ly = pts[pts.length - 1];
          if (Math.abs(lx - x) + Math.abs(ly - y) < 0.002) continue;
          pts.push(x, y);
          this.pending.push(x, y);
        }
        this.drawStroke(this.current);
        this.scheduleFlush();
      });
      const end = () => {
        if (!this.current) return;
        this.flush();
        this.current = null;
      };
      c.addEventListener('pointerup', end);
      c.addEventListener('pointercancel', end);
      c.addEventListener('lostpointercapture', end);
    }

    scheduleFlush() {
      if (this.flushTimer) return;
      this.flushTimer = setTimeout(() => this.flush(), 45);
    }

    flush() {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
      if (!this.current || !this.pending.length) return;
      this.emit({ k: 'p', id: this.current.id, pts: this.pending });
      this.pending = [];
    }

    emit(msg) {
      if (this.opts.onLocal) this.opts.onLocal(msg);
    }

    /* ---- Werkzeuge (nur Zeichner) ---- */

    setColor(color) {
      this.color = color;
    }

    setWidth(w) {
      this.width = w;
    }

    /** 'pen' (auch Radierer = Stift in Hintergrundfarbe) oder 'fill' (Farbeimer) */
    setTool(tool) {
      this.tool = tool === 'fill' && this.opts.fill ? 'fill' : 'pen';
      this.canvas.classList.toggle('tool-fill', this.editable && this.tool === 'fill');
    }

    clear() {
      this.strokes = [];
      this.redraw();
      this.emit({ k: 'clear' });
    }

    undo() {
      const last = this.strokes.pop();
      if (!last) return;
      this.redraw();
      this.emit({ k: 'u', id: last.id });
    }

    /* ---- Empfangen ---- */

    /** Eine Nachricht in die Liste übernehmen (ohne zu zeichnen). Gibt das neue/geänderte Element zurück. */
    static add(list, msg) {
      if (!msg) return null;
      if (msg.k === 'clear') {
        list.length = 0;
        return null;
      }
      if (msg.k === 'b') {
        const s = { id: msg.id, c: msg.c, w: msg.w, pts: [msg.x, msg.y] };
        list.push(s);
        return s;
      }
      if (msg.k === 'f') {
        const f = { id: msg.id, fill: true, c: msg.c, x: msg.x, y: msg.y };
        list.push(f);
        return f;
      }
      if (msg.k === 'p') {
        const s = list.find((x) => x.id === msg.id);
        if (!s || s.fill || !Array.isArray(msg.pts)) return null;
        s.pts.push(...msg.pts);
        return s;
      }
      if (msg.k === 'u') {
        const i = list.findIndex((x) => x.id === msg.id);
        if (i >= 0) list.splice(i, 1);
      }
      return null;
    }

    apply(msg) {
      if (!msg) return;
      if (msg.k === 'clear' || msg.k === 'u') {
        Sketch.add(this.strokes, msg);
        this.redraw();
        return;
      }
      const item = Sketch.add(this.strokes, msg);
      if (!item) return;
      if (item.fill) this.drawFill(item);
      else this.drawStroke(item);
    }

    loadAll(list) {
      this.strokes = [];
      for (const msg of list || []) Sketch.add(this.strokes, msg);
      this.redraw();
    }

    reset() {
      this.strokes = [];
      this.current = null;
      this.pending = [];
      this.redraw();
    }

    /* ---- Zeichnen ---- */

    redraw() {
      const { ctx, canvas } = this;
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const s of this.strokes) {
        if (s.fill) this.drawFill(s);
        else this.drawStroke(s);
      }
    }

    drawFill(f) {
      if (!this.opts.fill || !this.canvas.width) return;
      this.opts.fill(this.ctx, Math.floor(f.x * (this.canvas.width - 1)), Math.floor(f.y * (this.canvas.height - 1)), f.c);
    }

    drawStroke(s) {
      const { ctx, canvas } = this;
      const W = canvas.width;
      const H = canvas.height;
      const pts = s.pts;
      ctx.strokeStyle = s.c;
      ctx.fillStyle = s.c;
      ctx.lineWidth = Math.max(1, s.w * W);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (pts.length <= 2) {
        ctx.beginPath();
        ctx.arc(pts[0] * W, pts[1] * H, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(pts[0] * W, pts[1] * H);
      for (let i = 2; i < pts.length - 2; i += 2) {
        const mx = ((pts[i] + pts[i + 2]) / 2) * W;
        const my = ((pts[i + 1] + pts[i + 3]) / 2) * H;
        ctx.quadraticCurveTo(pts[i] * W, pts[i + 1] * H, mx, my);
      }
      ctx.lineTo(pts[pts.length - 2] * W, pts[pts.length - 1] * H);
      ctx.stroke();
    }
  }

  Sketch.BG = BG;
  root.GameSketch = Sketch;
  // früherer Name aus Guess the word! (damals „Activity“)
  root.ActivitySketch = Sketch;
})(typeof window !== 'undefined' ? window : globalThis);
