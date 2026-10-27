/*
 * Die Bombe von „Wortbombe“ – das Kernstück.
 *
 *  WBBomb.plan(range, random)   Zündzeit, Beschleunigung und Tick-Plan vorab berechnen (reine Rechnung, testbar)
 *  WBBomb.burned(plan, t)       wie weit die ANGEZEIGTE Zündschnur abgebrannt ist (0 … 0,94) – absichtlich
 *                               unabhängig von der echten Zündzeit, damit man nicht mitrechnen kann
 *  WBBomb.Player                spielt einen Plan ab: Ticken + Zischen, Knall (nur im Browser)
 *
 * Zufall: Zündzeit gleichmäßig zwischen min und max. Ab einem zufälligen Anteil (40–90 %) der Zeit wird das Ticken
 * schneller – von ~1/s bis 6/s. Wie lange das Beschleunigen dauert, ist ebenfalls zufällig: Mal bleibt es lange
 * schnell, mal knallt es, bevor es überhaupt richtig schneller geworden ist.
 *
 * Zeit misst performance.now(); gespielt wird mit der AudioContext-Uhr (vorausschauend 150 ms im Voraus geplant),
 * denn setTimeout allein ruckelt. Stumm geschaltet (GameFx.Sound.muted) läuft alles genauso, nur ohne Ton.
 */
(function (root) {
  'use strict';

  const ACCEL_FROM = 0.4; // Beschleunigung beginnt frühestens bei 40 % …
  const ACCEL_TO = 0.9; // … und spätestens bei 90 % der Zündzeit
  const FAST = 1 / 6; // schnellster Tick-Abstand (6 pro Sekunde)
  const LOOKAHEAD = 0.15; // so weit im Voraus werden Ticks beim AudioContext angemeldet (s)
  const SCHEDULE_MS = 25;
  const MAX_BURN = 0.94; // die angezeigte Schnur brennt nie ganz ab

  /** Zündzeit, Beschleunigung und alle Tick-Zeitpunkte (Sekunden ab Zünden) */
  function plan(range, random) {
    const rnd = random || Math.random;
    const [min, max] = range;
    const fuse = min + rnd() * (max - min);
    const accelAt = fuse * (ACCEL_FROM + rnd() * (ACCEL_TO - ACCEL_FROM));
    // Dauer bis zum Höchsttempo: von 2 s bis deutlich länger als die ganze Zündschnur
    const ramp = 2 + rnd() * fuse * 1.2;
    const base = 0.85 + rnd() * 0.25; // Grundtempo knapp 1 Tick pro Sekunde
    const p = { fuse, accelAt, ramp, base, fast: FAST, ticks: [], show: showParams(rnd) };
    for (let t = 0; t < fuse; t += interval(p, t)) p.ticks.push(t);
    return p;
  }

  /** Abstand zum nächsten Tick, wenn gerade bei t getickt wurde */
  function interval(p, t) {
    if (t < p.accelAt) return p.base;
    const k = Math.min(1, (t - p.accelAt) / p.ramp);
    return p.base * Math.pow(p.fast / p.base, Math.pow(k, 0.8));
  }

  /** Zufällige Brenngeschwindigkeit der angezeigten Schnur – hat nichts mit der Zündzeit zu tun */
  function showParams(rnd) {
    return {
      tau: 16 + rnd() * 40,
      w1: 0.6 + rnd() * 0.9,
      w2: 2.1 + rnd() * 1.7,
      p1: rnd() * Math.PI * 2,
      p2: rnd() * Math.PI * 2,
    };
  }

  /**
   * Angezeigter Abbrand: Brennrate r(t) = (1 + 0,6·sin(w1·t+p1) + 0,3·sin(w2·t+p2)) / tau ist immer > 0,
   * die Schnur wird also nie wieder länger, brennt aber mal schneller, mal langsamer.
   */
  function burned(p, t) {
    const s = p.show;
    if (t <= 0) return 0;
    const i1 = (Math.cos(s.p1) - Math.cos(s.w1 * t + s.p1)) / s.w1;
    const i2 = (Math.cos(s.p2) - Math.cos(s.w2 * t + s.p2)) / s.w2;
    const integral = (t + 0.6 * i1 + 0.3 * i2) / s.tau;
    return MAX_BURN * (1 - Math.exp(-integral));
  }

  /* ------------------------------------------------------------------ */
  /* Ton (nur im Browser)                                                */
  /* ------------------------------------------------------------------ */

  let noiseBuf = null;

  function audio() {
    return root.GameFx ? root.GameFx.synth.audio() : null;
  }

  function noiseBuffer(a) {
    if (!noiseBuf || noiseBuf.sampleRate !== a.sampleRate) {
      noiseBuf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  /** Gefiltertes Rauschen mit Hüllkurve (Startzeit t0 in AudioContext-Zeit) */
  function burst(a, out, o) {
    const src = a.createBufferSource();
    src.buffer = noiseBuffer(a);
    const filter = a.createBiquadFilter();
    filter.type = o.type || 'bandpass';
    filter.frequency.setValueAtTime(o.freq, o.t0);
    if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, o.t0 + o.dur);
    filter.Q.value = o.q || 1;
    const gain = a.createGain();
    gain.gain.setValueAtTime(0.0001, o.t0);
    gain.gain.exponentialRampToValueAtTime(o.vol, o.t0 + (o.attack || 0.004));
    gain.gain.exponentialRampToValueAtTime(0.0001, o.t0 + o.dur);
    src.connect(filter).connect(gain).connect(out);
    src.start(o.t0, Math.random() * 1.5);
    src.stop(o.t0 + o.dur + 0.05);
  }

  function osc(a, out, o) {
    const node = a.createOscillator();
    node.type = o.type || 'sine';
    node.frequency.setValueAtTime(o.freq, o.t0);
    if (o.to) node.frequency.exponentialRampToValueAtTime(o.to, o.t0 + o.dur);
    const gain = a.createGain();
    gain.gain.setValueAtTime(0.0001, o.t0);
    gain.gain.exponentialRampToValueAtTime(o.vol, o.t0 + (o.attack || 0.003));
    gain.gain.exponentialRampToValueAtTime(0.0001, o.t0 + o.dur);
    node.connect(gain).connect(out);
    node.start(o.t0);
    node.stop(o.t0 + o.dur + 0.05);
  }

  /** Ein Tick: kurzer Klick, abwechselnd hell (tick) und etwas tiefer (tack) */
  function tick(a, out, t0, tock) {
    osc(a, out, { t0, freq: tock ? 1350 : 1900, dur: 0.035, type: 'square', vol: 0.07, attack: 0.001 });
    burst(a, out, { t0, freq: tock ? 2600 : 3600, dur: 0.03, q: 3, vol: 0.12, attack: 0.001 });
    osc(a, out, { t0, freq: 170, to: 90, dur: 0.06, vol: 0.06, attack: 0.002 });
  }

  /** Knall: tiefes Rauschen, das sich zum Grollen absenkt, Bass-Wumms und Knistern */
  function explosion() {
    const a = audio();
    if (!a) return;
    const t0 = a.currentTime + 0.01;
    const comp = a.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    comp.connect(a.destination);
    burst(a, comp, { t0, type: 'lowpass', freq: 2400, to: 60, dur: 2.2, q: 0.7, vol: 0.9, attack: 0.004 });
    burst(a, comp, { t0, type: 'bandpass', freq: 900, to: 120, dur: 0.6, q: 0.8, vol: 0.6, attack: 0.002 });
    osc(a, comp, { t0, freq: 110, to: 28, dur: 1.4, vol: 0.9, attack: 0.004 });
    osc(a, comp, { t0, freq: 55, to: 24, dur: 1.8, type: 'triangle', vol: 0.5, attack: 0.01 });
    for (let i = 0; i < 14; i++) {
      const t = t0 + 0.08 + Math.random() * 0.9;
      burst(a, comp, { t0: t, freq: 1500 + Math.random() * 3000, dur: 0.04 + Math.random() * 0.05, q: 2, vol: 0.12 + Math.random() * 0.15, attack: 0.001 });
    }
  }

  /** Streichholz beim Zünden */
  function strike() {
    const a = audio();
    if (!a) return;
    const t0 = a.currentTime;
    burst(a, a.destination, { t0, type: 'highpass', freq: 2500, dur: 0.25, vol: 0.18, attack: 0.01 });
    burst(a, a.destination, { t0: t0 + 0.05, freq: 1200, to: 3000, dur: 0.4, q: 0.6, vol: 0.08, attack: 0.05 });
  }

  /** Weitergeben: kurzes „Wusch“ */
  function swoosh() {
    const a = audio();
    if (!a) return;
    const t0 = a.currentTime;
    burst(a, a.destination, { t0, freq: 500, to: 2600, dur: 0.16, q: 1.2, vol: 0.09, attack: 0.03 });
  }

  /** Zischen der Zündschnur in Schleife, mit unruhigem Knistern */
  function hiss(a, out, t0) {
    const src = a.createBufferSource();
    src.buffer = noiseBuffer(a);
    src.loop = true;
    const filter = a.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 3200;
    const gain = a.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.022, t0 + 0.3);
    src.connect(filter).connect(gain).connect(out);
    src.start(t0);
    return { src, gain };
  }

  /* ------------------------------------------------------------------ */
  /* Abspielen                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * new Player(plan, { onTick(i) }) – start() zündet, elapsed() = Sekunden seit dem Zünden,
   * stop() bricht ab (still), boom() beendet mit Knall.
   */
  class Player {
    constructor(p, hooks) {
      this.plan = p;
      this.hooks = hooks || {};
      this.next = 0; // nächster noch nicht angemeldeter Tick
      this.timer = null;
      this.timeouts = [];
      this.a = null;
      this.out = null;
      this.fizz = null;
      this.started = 0;
    }

    now() {
      return root.performance ? root.performance.now() : Date.now();
    }

    elapsed() {
      return this.started ? (this.now() - this.started) / 1000 : 0;
    }

    start() {
      this.started = this.now();
      const a = audio();
      if (a && a.state !== 'closed') {
        this.a = a;
        this.out = a.createGain();
        this.out.gain.value = 1;
        this.out.connect(a.destination);
        this.fizz = hiss(a, this.out, a.currentTime + 0.02);
      }
      this.schedule();
      this.timer = setInterval(() => this.schedule(), SCHEDULE_MS);
    }

    /** Alle Ticks der nächsten 150 ms anmelden – Ton exakt per AudioContext, Puls fürs Bild per Timeout */
    schedule() {
      const t = this.elapsed();
      const ticks = this.plan.ticks;
      const audioNow = this.a ? this.a.currentTime : 0;
      while (this.next < ticks.length && ticks[this.next] < t + LOOKAHEAD) {
        const i = this.next++;
        const delay = Math.max(0, ticks[i] - t);
        if (this.a) tick(this.a, this.out, audioNow + delay, i % 2 === 1);
        if (this.hooks.onTick) this.timeouts.push(setTimeout(() => this.hooks.onTick(i), delay * 1000));
      }
      // Knistern: das Zischen schwankt unruhig
      if (this.fizz && Math.random() < 0.3) {
        this.fizz.gain.gain.setTargetAtTime(0.012 + Math.random() * 0.025, audioNow, 0.03);
      }
    }

    silence() {
      clearInterval(this.timer);
      this.timer = null;
      this.timeouts.forEach(clearTimeout);
      this.timeouts = [];
      if (this.a && this.out) {
        const t = this.a.currentTime;
        try {
          this.out.gain.cancelScheduledValues(t);
          this.out.gain.setValueAtTime(this.out.gain.value, t);
          this.out.gain.linearRampToValueAtTime(0, t + 0.03);
          this.fizz.src.stop(t + 0.05);
        } catch {
          /* schon gestoppt */
        }
        const out = this.out;
        setTimeout(() => out.disconnect(), 200);
      }
      this.out = null;
      this.fizz = null;
    }

    stop() {
      this.silence();
    }

    boom() {
      this.silence();
      explosion();
    }
  }

  root.WBBomb = { plan, interval, burned, Player, sounds: { explosion, strike, swoosh }, ACCEL_FROM, ACCEL_TO, FAST, MAX_BURN };
})(typeof window !== 'undefined' ? window : globalThis);
