/*
 * Sprachausgabe für alle Spiele (Browser-Stimme über speechSynthesis): deutsche Stimme suchen, vorlesen, abbrechen.
 *  - Stumm geschaltet (GameFx.Sound.muted bzw. games.muted) = es wird nichts vorgelesen.
 *  - Ohne Sprachausgabe im Browser ist say() sofort fertig – das Spiel läuft trotzdem.
 *  - Stimme und Tempo merkt sich der Browser (games.speech.v1).
 *
 *   GameSpeech.say('Hallo')                       → Promise, wenn fertig (oder abgebrochen)
 *   GameSpeech.sayAll(['Satz 1', 'Satz 2'], { onItem(i) {} })
 *   GameSpeech.cancel()
 */
(function (root) {
  'use strict';

  const PREFS_KEY = 'games.speech.v1';
  const RATES = [0.8, 0.9, 1, 1.1, 1.25];
  let generation = 0;
  let voicesReady = null;

  function synth() {
    try {
      return root.speechSynthesis || null;
    } catch {
      return null;
    }
  }

  function supported() {
    return !!(synth() && root.SpeechSynthesisUtterance);
  }

  function muted() {
    const fx = root.GameFx;
    return !!(fx && fx.Sound && fx.Sound.muted);
  }

  function prefs() {
    try {
      const p = JSON.parse(root.localStorage.getItem(PREFS_KEY) || '{}');
      return { voice: typeof p.voice === 'string' ? p.voice : '', rate: RATES.includes(p.rate) ? p.rate : 1 };
    } catch {
      return { voice: '', rate: 1 };
    }
  }

  function setPrefs(patch) {
    const p = Object.assign(prefs(), patch || {});
    try {
      root.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
      /* egal */
    }
    return p;
  }

  /** Deutsche Stimmen (sonst alle) */
  function voices() {
    const s = synth();
    if (!s) return [];
    const all = s.getVoices() || [];
    const de = all.filter((v) => /^de(-|_|$)/i.test(v.lang || ''));
    return de.length ? de : all;
  }

  /** Stimmen werden in manchen Browsern erst nachgeladen */
  function ready() {
    if (voicesReady) return voicesReady;
    voicesReady = new Promise((resolve) => {
      const s = synth();
      if (!s || (s.getVoices() || []).length) return resolve();
      const done = () => {
        clearTimeout(t);
        resolve();
      };
      const t = setTimeout(done, 1200);
      try {
        s.addEventListener('voiceschanged', done, { once: true });
      } catch {
        /* alte Browser */
      }
    });
    return voicesReady;
  }

  function pickVoice() {
    const list = voices();
    const want = prefs().voice;
    return (
      list.find((v) => v.name === want) ||
      list.find((v) => /de-DE/i.test(v.lang) && /google|natural|online/i.test(v.name)) ||
      list.find((v) => /de-DE/i.test(v.lang)) ||
      list[0] ||
      null
    );
  }

  /** Grobe Dauer eines Satzes – falls der Browser das Ende nicht meldet (kommt in Chrome vor) */
  function estimate(text, rate) {
    return Math.min(20000, 900 + (String(text).length * 75) / (rate || 1));
  }

  function speakOne(text, gen) {
    return new Promise((resolve) => {
      const s = synth();
      if (!s || !text || muted() || gen !== generation) return resolve(false);
      const u = new root.SpeechSynthesisUtterance(String(text));
      const p = prefs();
      const voice = pickVoice();
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else u.lang = 'de-DE';
      u.rate = p.rate;
      let finished = false;
      const end = (ok) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => end(true), estimate(text, p.rate) * 1.8 + 1500);
      u.onend = () => end(true);
      u.onerror = () => end(false);
      try {
        s.speak(u);
      } catch {
        end(false);
      }
    });
  }

  /** Einen Text vorlesen. Gibt ein Promise zurück (true = zu Ende gesprochen). */
  function say(text) {
    return sayAll([text]);
  }

  /**
   * Mehrere Texte nacheinander vorlesen (mit kleiner Pause). Ein neuer Aufruf oder cancel() bricht ab.
   * @param {string[]} list
   * @param {{onItem?: Function, pause?: number}} [opts] onItem(i) vor jedem Text, onItem(-1) am Ende
   */
  async function sayAll(list, opts) {
    const o = opts || {};
    cancel();
    const gen = generation;
    if (!supported() || muted()) {
      if (o.onItem) o.onItem(-1);
      return false;
    }
    await ready();
    let ok = true;
    for (let i = 0; i < list.length; i++) {
      if (gen !== generation) return false;
      if (o.onItem) o.onItem(i);
      ok = (await speakOne(list[i], gen)) && ok;
      if (o.pause && i < list.length - 1) await new Promise((r) => setTimeout(r, o.pause));
    }
    if (gen === generation && o.onItem) o.onItem(-1);
    return gen === generation && ok;
  }

  function cancel() {
    generation += 1;
    const s = synth();
    try {
      if (s && (s.speaking || s.pending)) s.cancel();
    } catch {
      /* egal */
    }
  }

  root.GameSpeech = { RATES, supported, voices, ready, prefs, setPrefs, say, sayAll, cancel, estimate };
})(window);
