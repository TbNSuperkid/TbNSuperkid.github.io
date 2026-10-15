/*
 * Sounds für „Pferderennen“ – per WebAudio erzeugt, keine Audiodateien.
 *   PFSounds.bugle()    Fanfare „Call to the Post“ vor dem Start
 *   PFSounds.shot()     Startschuss
 *   PFSounds.drama()    Pferd muss zurück
 *   PFSounds.lead()     Führungswechsel
 *   PFSounds.shutter()  Kamera beim Fotofinish
 *   PFSounds.cheer()    Jubel der Zuschauer
 *   PFSounds.hooves.run(gaitMs) / .stop()   Hufgetrappel in Schleife, .once() ein Sprung
 * Stumm geschaltet (GameFx.Sound.muted) bleibt alles still.
 */
(function (root) {
  'use strict';

  const { synth } = root.GameFx;
  let noiseBuf = null;

  function ctx() {
    return synth.audio();
  }

  /** Weißes Rauschen (einmal erzeugt, 2 s lang, wird wiederverwendet) */
  function buffer(a) {
    if (!noiseBuf || noiseBuf.sampleRate !== a.sampleRate) {
      noiseBuf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  /** Gefiltertes Rauschen mit Hüllkurve: Anstieg attack, danach Abklingen bis dur */
  function burst(o) {
    const a = ctx();
    if (!a) return;
    const t0 = a.currentTime + (o.start || 0);
    const src = a.createBufferSource();
    src.buffer = buffer(a);
    const filter = a.createBiquadFilter();
    filter.type = o.type || 'bandpass';
    filter.frequency.setValueAtTime(o.freq || 1000, t0);
    if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);
    filter.Q.value = o.q || 1;
    const gain = a.createGain();
    const attack = o.attack || 0.004;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(o.vol || 0.3, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(filter).connect(gain).connect(a.destination);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + o.dur + 0.05);
  }

  /** Blechbläser-Ton: Sägezahn durch Tiefpass, leichtes Vibrato */
  function horn(freq, start, dur, vol) {
    const a = ctx();
    if (!a) return;
    const t0 = a.currentTime + start;
    const osc = a.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t0);
    const lfo = a.createOscillator();
    const lfoGain = a.createGain();
    lfo.frequency.value = 5.5;
    lfoGain.gain.value = freq * 0.006;
    lfo.connect(lfoGain).connect(osc.frequency);
    const filter = a.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, t0);
    filter.frequency.linearRampToValueAtTime(2600, t0 + 0.05);
    const gain = a.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol || 0.09, t0 + 0.03);
    gain.gain.setValueAtTime(vol || 0.09, t0 + dur * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(filter).connect(gain).connect(a.destination);
    osc.start(t0);
    lfo.start(t0);
    osc.stop(t0 + dur + 0.05);
    lfo.stop(t0 + dur + 0.05);
  }

  /** Ein Huf: dumpfer Schlag + kurzes Klacken */
  function hoof(start, vol) {
    const v = vol || 1;
    burst({ start, dur: 0.07, freq: 260, q: 1.4, vol: 0.32 * v });
    burst({ start: start + 0.004, dur: 0.03, type: 'highpass', freq: 2500, vol: 0.05 * v });
    synth.tone(95, start, 0.06, { type: 'sine', to: 60, vol: 0.12 * v });
  }

  /* „Call to the Post“ (verkürzt): G C E G – E G … G */
  const BUGLE = [
    [392, 0, 0.16],
    [523, 0.17, 0.16],
    [659, 0.34, 0.16],
    [784, 0.51, 0.3],
    [659, 0.83, 0.16],
    [784, 1.0, 0.5],
    [659, 1.52, 0.16],
    [784, 1.69, 0.16],
    [1047, 1.86, 0.55],
  ];

  const hooves = {
    timer: null,
    gait: 0,
    /** Galopp-Rhythmus „ta-ka-tum“, gaitMs = Dauer eines Sprungs */
    run(gaitMs) {
      if (this.timer && this.gait === gaitMs) return;
      this.stop();
      this.gait = gaitMs;
      const beat = () => {
        if (!ctx()) return;
        const g = gaitMs / 1000;
        hoof(0, 0.8);
        hoof(g * 0.17, 0.7);
        hoof(g * 0.34, 1);
      };
      beat();
      this.timer = setInterval(beat, gaitMs);
    },
    /** Ein einzelner Sprung (Tipp-Modus) */
    once(gaitMs) {
      const g = (gaitMs || 440) / 1000;
      hoof(0, 0.8);
      hoof(g * 0.17, 0.7);
      hoof(g * 0.34, 1);
    },
    stop() {
      clearInterval(this.timer);
      this.timer = null;
      this.gait = 0;
    },
  };

  root.PFSounds = {
    bugle() {
      for (const [f, t, d] of BUGLE) horn(f, t, d, 0.08);
    },
    shot() {
      burst({ dur: 0.5, type: 'lowpass', freq: 3500, to: 300, vol: 0.9, attack: 0.002 });
      burst({ dur: 1.2, start: 0.05, type: 'lowpass', freq: 600, to: 120, vol: 0.18, attack: 0.02 });
      synth.tone(160, 0, 0.25, { type: 'sine', to: 40, vol: 0.3 });
    },
    drama() {
      synth.tone(392, 0, 0.18, { type: 'triangle', vol: 0.12 });
      synth.tone(277, 0.18, 0.45, { type: 'triangle', to: 220, vol: 0.13 });
      burst({ start: 0.05, dur: 0.5, freq: 500, q: 0.8, vol: 0.08, attack: 0.08 }); // „Ohhh“ der Zuschauer
    },
    lead() {
      synth.tone(988, 0, 0.1, { type: 'triangle', vol: 0.08 });
      synth.tone(1319, 0.08, 0.16, { type: 'triangle', vol: 0.08 });
    },
    shutter() {
      burst({ dur: 0.035, type: 'highpass', freq: 3000, vol: 0.4 });
      burst({ start: 0.09, dur: 0.05, type: 'highpass', freq: 2200, vol: 0.3 });
    },
    cheer() {
      burst({ dur: 2.4, freq: 900, q: 0.6, vol: 0.22, attack: 0.35 });
      burst({ dur: 2.0, start: 0.1, freq: 1900, q: 0.9, vol: 0.12, attack: 0.3 });
      for (let i = 0; i < 6; i++) synth.tone(600 + Math.random() * 500, 0.2 + i * 0.22, 0.25, { type: 'triangle', to: 900 + Math.random() * 400, vol: 0.025 });
    },
    hooves,
  };
})(window);
