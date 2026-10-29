/*
 * Ausschnitte genau abspielen – „1 Sekunde“ soll wirklich 1 Sekunde sein (Guess the song, Finish the lyrics).
 *
 * Normalweg: Ausschnitt einmal laden (fetch → decodeAudioData) und mit source.start(0, offset, dauer) abspielen.
 * Scheitert fetch (CORS) oder das Dekodieren, gibt es ein <audio>-Element mit currentTime + Stopp per Timer
 * (ungenauer, etwa ±0,1 s).
 *
 *   const sn = new GameSnippet.Snippet();
 *   sn.unlock();                                     // beim ersten Klick (Autoplay-Sperre)
 *   const clip = await sn.load('queen:bohemian', url);
 *   sn.play(clip, 0, 1, () => …);                    // 1 s ab Anfang, danach Rückruf
 *   sn.progress()                                    // 0–1 der laufenden Wiedergabe
 */
(function (root) {
  'use strict';

  const LOAD_TIMEOUT_MS = 12000;
  const FADE_S = 0.03; // kurz ein- und ausblenden, sonst knackt es

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), ms);
      promise.then(
        (x) => {
          clearTimeout(t);
          resolve(x);
        },
        (err) => {
          clearTimeout(t);
          reject(err);
        }
      );
    });
  }

  class Snippet {
    constructor() {
      this.ctx = null;
      this.gain = null;
      this.clips = {};
      this.src = null;
      this.el = null;
      this.timer = null;
      this.now = null; // { token, start, duration, ctx: bool }
      this.muted = false;
      this.elBlocked = false;
    }

    context() {
      if (!this.ctx) {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.gain = this.ctx.createGain();
        this.gain.connect(this.ctx.destination);
        this.gain.gain.value = this.muted ? 0 : 1;
      }
      return this.ctx;
    }

    /** Nach einem Klick: Ton freischalten */
    unlock() {
      const c = this.context();
      if (c && c.state === 'suspended') c.resume().catch(() => {});
      this.elBlocked = false;
    }

    /** Wartet der Browser auf einen Klick? */
    get blocked() {
      return !!((this.ctx && this.ctx.state === 'suspended' && this.now && this.now.ctx) || this.elBlocked);
    }

    get playing() {
      return !!this.now;
    }

    setMuted(m) {
      this.muted = !!m;
      if (this.gain) this.gain.gain.value = this.muted ? 0 : 1;
      if (this.el) this.el.muted = this.muted;
    }

    /** Ausschnitt laden (einmal pro key) → { kind: 'buffer' | 'element', duration } */
    load(key, url) {
      if (!this.clips[key]) {
        this.clips[key] = this.loadBuffer(url)
          .catch(() => this.loadElement(url))
          .catch((err) => {
            delete this.clips[key];
            throw err;
          });
      }
      return this.clips[key];
    }

    async loadBuffer(url) {
      const ctx = this.context();
      if (!ctx || typeof root.fetch !== 'function') throw new Error('kein Web Audio');
      const res = await withTimeout(root.fetch(url, { mode: 'cors' }), LOAD_TIMEOUT_MS);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.arrayBuffer();
      const buffer = await new Promise((resolve, reject) => {
        // ältere Safaris kennen nur die Rückruf-Form
        const p = ctx.decodeAudioData(data, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      });
      return { kind: 'buffer', buffer, duration: buffer.duration };
    }

    loadElement(url) {
      return withTimeout(
        new Promise((resolve, reject) => {
          const el = new Audio();
          el.preload = 'auto';
          el.muted = this.muted;
          const done = () => {
            el.removeEventListener('canplaythrough', done);
            el.removeEventListener('loadedmetadata', done);
            resolve({ kind: 'element', el, duration: el.duration || 30 });
          };
          el.addEventListener('canplaythrough', done);
          el.addEventListener('loadedmetadata', done);
          el.addEventListener('error', () => reject(new Error('Audio-Fehler')), { once: true });
          el.src = url;
          el.load();
        }),
        LOAD_TIMEOUT_MS
      );
    }

    /**
     * Spielt duration Sekunden ab offset. onEnd kommt, wenn die Stelle zu Ende gespielt ist (nicht bei stop()).
     * Gibt die tatsächliche Länge zurück.
     */
    play(clip, offset, duration, onEnd) {
      this.stop();
      const start = Math.max(0, Math.min(offset || 0, Math.max(0, clip.duration - 0.5)));
      const len = Math.max(0.2, Math.min(duration, clip.duration - start));
      const token = {};
      const finish = () => {
        if (!this.now || this.now.token !== token) return;
        this.now = null;
        this.src = null;
        clearTimeout(this.timer);
        this.timer = null;
        if (onEnd) onEnd();
      };
      if (clip.kind === 'buffer') {
        const ctx = this.context();
        const src = ctx.createBufferSource();
        src.buffer = clip.buffer;
        const fade = ctx.createGain();
        const t0 = ctx.currentTime;
        fade.gain.setValueAtTime(0, t0);
        fade.gain.linearRampToValueAtTime(1, t0 + FADE_S);
        fade.gain.setValueAtTime(1, t0 + Math.max(FADE_S, len - FADE_S));
        fade.gain.linearRampToValueAtTime(0, t0 + len);
        src.connect(fade);
        fade.connect(this.gain);
        src.onended = finish;
        src.start(0, start, len);
        this.src = src;
        this.now = { token, start: t0, duration: len, ctx: true };
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      } else {
        const el = clip.el;
        this.el = el;
        el.muted = this.muted;
        try {
          el.currentTime = start;
        } catch {
          /* noch nicht bereit */
        }
        this.now = { token, start: performance.now(), duration: len, ctx: false };
        const p = el.play();
        if (p && p.catch)
          p.catch(() => {
            if (this.now && this.now.token === token) this.elBlocked = true;
          });
        this.timer = setTimeout(() => {
          el.pause();
          finish();
        }, len * 1000);
      }
      return len;
    }

    stop() {
      clearTimeout(this.timer);
      this.timer = null;
      if (this.src) {
        this.src.onended = null;
        try {
          this.src.stop();
        } catch {
          /* schon vorbei */
        }
        this.src = null;
      }
      if (this.el) this.el.pause();
      this.now = null;
    }

    /** Fortschritt der laufenden Wiedergabe (0–1), null wenn nichts läuft */
    progress() {
      const n = this.now;
      if (!n) return null;
      const t = n.ctx ? this.ctx.currentTime - n.start : (performance.now() - n.start) / 1000;
      return Math.max(0, Math.min(1, t / n.duration));
    }

    /** Wie viele Sekunden der laufenden Wiedergabe schon vorbei sind */
    elapsed() {
      const n = this.now;
      if (!n) return null;
      return Math.min(n.duration, n.ctx ? this.ctx.currentTime - n.start : (performance.now() - n.start) / 1000);
    }
  }

  root.GameSnippet = { Snippet };
})(typeof window !== 'undefined' ? window : globalThis);
