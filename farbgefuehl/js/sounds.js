/*
 * Sounds für „Farbgefühl“ – per WebAudio erzeugt, keine Audiodateien.
 *   FGSounds.plop()       Stein wird gesetzt
 *   FGSounds.drumroll(s)  Trommelwirbel vor dem Aufdecken (s Sekunden)
 *   FGSounds.frame()      Rahmen legt sich um die Zielfarbe
 *   FGSounds.score(p)     Punkte für einen Stein (3 = Volltreffer, höher)
 *   FGSounds.reveal()     Zielfarbe leuchtet auf
 * Stumm geschaltet (GameFx.Sound.muted) bleibt alles still.
 */
(function (root) {
  'use strict';

  const { synth } = root.GameFx;

  function plop() {
    synth.tone(320, 0, 0.12, { type: 'sine', to: 760, vol: 0.16 });
    synth.tone(900, 0.04, 0.05, { type: 'triangle', vol: 0.05 });
  }

  function drumroll(seconds) {
    const dur = seconds || 1.2;
    const hits = Math.round(dur / 0.045);
    for (let i = 0; i < hits; i++) synth.noise(0.05, i * 0.045, 0.06 + (0.14 * i) / hits, 900);
  }

  function frame() {
    synth.noise(0.18, 0, 0.28, 400);
    synth.tone(150, 0, 0.25, { type: 'sine', to: 70, vol: 0.2 });
  }

  function reveal() {
    [659, 880, 1175].forEach((f, i) => synth.tone(f, i * 0.06, 0.4, { type: 'sine', vol: 0.08 }));
  }

  function score(points) {
    const base = { 1: 523, 2: 659, 3: 880 }[points] || 440;
    synth.tone(base, 0, 0.14, { type: 'triangle', vol: 0.12 });
    if (points === 3) {
      synth.tone(base * 1.5, 0.08, 0.2, { type: 'triangle', vol: 0.12 });
      synth.tone(base * 2, 0.16, 0.3, { type: 'triangle', vol: 0.1 });
    }
  }

  root.FGSounds = { plop, drumroll, frame, reveal, score };
})(window);
