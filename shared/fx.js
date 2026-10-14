/*
 * Soundeffekte (per WebAudio erzeugt – keine Audiodateien nötig) und Konfetti.
 */
(function (root) {
  'use strict';

  const MUTE_KEY = 'games.muted';
  let ctx = null;
  let muted = false;
  try {
    const saved = root.localStorage.getItem(MUTE_KEY);
    // früher nur in Activity gespeichert
    muted = (saved === null ? root.localStorage.getItem('activity.muted') : saved) === '1';
  } catch {
    /* egal */
  }

  function audio() {
    if (muted) return null;
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, start, dur, opts) {
    const a = audio();
    if (!a) return;
    const o = opts || {};
    const t0 = a.currentTime + (start || 0);
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    const vol = o.vol || 0.18;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise(dur, start, vol, filterFreq) {
    const a = audio();
    if (!a) return;
    const t0 = a.currentTime + (start || 0);
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource();
    src.buffer = buf;
    const filter = a.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq || 1800;
    const gain = a.createGain();
    gain.gain.value = vol || 0.25;
    src.connect(filter).connect(gain).connect(a.destination);
    src.start(t0);
  }

  const Sound = {
    get muted() {
      return muted;
    },
    setMuted(on) {
      muted = !!on;
      try {
        root.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
      } catch {
        /* egal */
      }
    },
    unlock() {
      audio();
    },
    click() {
      tone(660, 0, 0.06, { type: 'triangle', vol: 0.08 });
    },
    flip() {
      noise(0.18, 0, 0.3, 2400);
      tone(520, 0.02, 0.12, { type: 'triangle', to: 880, vol: 0.06 });
    },
    hop() {
      tone(440, 0, 0.09, { type: 'square', to: 660, vol: 0.05 });
    },
    tick(last) {
      tone(last ? 1200 : 900, 0, 0.05, { type: 'square', vol: last ? 0.09 : 0.05 });
    },
    start() {
      tone(523, 0, 0.12, { type: 'triangle' });
      tone(784, 0.1, 0.18, { type: 'triangle' });
    },
    buzzer() {
      tone(180, 0, 0.6, { type: 'sawtooth', vol: 0.16 });
      tone(120, 0.05, 0.6, { type: 'square', vol: 0.08 });
    },
    success() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.22, { type: 'triangle', vol: 0.14 }));
    },
    fail() {
      tone(392, 0, 0.22, { type: 'triangle', vol: 0.14 });
      tone(311, 0.2, 0.36, { type: 'triangle', vol: 0.14 });
    },
    fanfare() {
      const notes = [523, 523, 523, 659, 784, 659, 784, 1047];
      const times = [0, 0.12, 0.24, 0.36, 0.6, 0.78, 0.9, 1.08];
      notes.forEach((f, i) => tone(f, times[i], i === notes.length - 1 ? 0.6 : 0.16, { type: 'triangle', vol: 0.15 }));
    },
  };

  /* ---------------- Konfetti ---------------- */

  let canvas = null;
  let parts = [];
  let raf = null;

  function confetti(colors, amount) {
    if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'confetti';
      document.body.appendChild(canvas);
    }
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    canvas.width = root.innerWidth * dpr;
    canvas.height = root.innerHeight * dpr;
    const palette = colors && colors.length ? colors : ['#f43f5e', '#3b82f6', '#22c55e', '#facc15', '#a855f7', '#f97316'];
    const n = amount || 160;
    for (let i = 0; i < n; i++) {
      parts.push({
        x: canvas.width * (0.2 + Math.random() * 0.6),
        y: canvas.height * 0.45,
        vx: (Math.random() - 0.5) * 22 * dpr,
        vy: (-Math.random() * 20 - 8) * dpr,
        g: 0.55 * dpr,
        w: (6 + Math.random() * 8) * dpr,
        h: (4 + Math.random() * 6) * dpr,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        c: palette[i % palette.length],
        life: 0,
      });
    }
    if (!raf) raf = requestAnimationFrame(step);
  }

  function step() {
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, canvas.width, canvas.height);
    parts = parts.filter((p) => p.y < canvas.height + 40 && p.life < 400);
    for (const p of parts) {
      p.life++;
      p.vx *= 0.985;
      p.vy = p.vy * 0.985 + p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.r);
      c.fillStyle = p.c;
      c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
      c.restore();
    }
    if (parts.length) raf = requestAnimationFrame(step);
    else {
      raf = null;
      c.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  root.GameFx = { Sound, confetti };
})(window);
