/*
 * Zeichenfläche für die Kategorie "Zeichnen".
 * Koordinaten werden normiert (0..1) übertragen, damit jede Bildschirmgröße passt.
 */
(function (root) {
  'use strict';

  const BG = '#fffdf7';

  class Sketch {
    /**
     * @param {HTMLElement} host Container (feste Seitenverhältnis via CSS)
     * @param {{editable?:boolean, onLocal?:Function}} opts
     */
    constructor(host, opts) {
      this.host = host;
      this.opts = opts || {};
      this.strokes = [];
      this.color = '#1f2937';
      this.width = 0.008;
      this.editable = !!this.opts.editable;
      this.current = null;
      this.pending = [];
      this.seq = 0;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'sketch-canvas';
      host.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
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
    }

    resize() {
      const rect = this.host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = Math.min(2.5, root.devicePixelRatio || 1);
      this.canvas.width = Math.round(rect.width * dpr);
      this.canvas.height = Math.round(rect.height * dpr);
      this.redraw();
    }

    point(e) {
      const rect = this.canvas.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
    }

    bind() {
      const c = this.canvas;
      c.addEventListener('pointerdown', (e) => {
        if (!this.editable) return;
        e.preventDefault();
        c.setPointerCapture(e.pointerId);
        const [x, y] = this.point(e);
        const id = Date.now().toString(36) + '-' + this.seq++;
        this.current = { id, c: this.color, w: this.width, pts: [x, y] };
        this.strokes.push(this.current);
        this.emit({ k: 'b', id, c: this.color, w: this.width, x, y });
        this.redraw();
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

    apply(msg) {
      if (!msg) return;
      if (msg.k === 'clear') {
        this.strokes = [];
        this.redraw();
      } else if (msg.k === 'b') {
        const s = { id: msg.id, c: msg.c, w: msg.w, pts: [msg.x, msg.y] };
        this.strokes.push(s);
        this.drawStroke(s);
      } else if (msg.k === 'p') {
        const s = this.strokes.find((x) => x.id === msg.id);
        if (!s || !Array.isArray(msg.pts)) return;
        s.pts.push(...msg.pts);
        this.drawStroke(s);
      } else if (msg.k === 'u') {
        this.strokes = this.strokes.filter((x) => x.id !== msg.id);
        this.redraw();
      }
    }

    loadAll(list) {
      this.strokes = [];
      for (const msg of list || []) {
        if (msg.k === 'clear') this.strokes = [];
        else if (msg.k === 'b') this.strokes.push({ id: msg.id, c: msg.c, w: msg.w, pts: [msg.x, msg.y] });
        else if (msg.k === 'p') {
          const s = this.strokes.find((x) => x.id === msg.id);
          if (s && Array.isArray(msg.pts)) s.pts.push(...msg.pts);
        } else if (msg.k === 'u') this.strokes = this.strokes.filter((x) => x.id !== msg.id);
      }
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
      for (const s of this.strokes) this.drawStroke(s);
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
  root.ActivitySketch = Sketch;
})(window);
