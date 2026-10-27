/*
 * Spiellogik von „Wortbombe“ – reines Ein-Gerät-Spiel, kein Netzwerk.
 *
 * Ein Handy ist die Bombe und wird im Kreis herumgereicht. Es zeigt eine Aufgabe (Silbe, Anfang, Ende, Kategorie
 * oder Wortkette). Wer die Bombe hat, nennt ein passendes Wort und tippt aufs Display = weitergeben an die nächste
 * Person im Uhrzeigersinn (Namen werden in Sitzreihenfolge eingetragen). Irgendwann macht es BUMM – wer die Bombe
 * hält, bekommt einen Strafpunkt. Die nächste Runde beginnt die Person, die verloren hat.
 *
 * Phasen: ready (Aufgabe sichtbar, „Zünden“) → burning → boom (Strafpunkt, ggf. korrigieren) → ready … → end
 *
 * Wertung (settings.out):
 *  - three:  wer 3 Strafpunkte hat, scheidet aus; die letzte Person gewinnt
 *  - rounds: niemand scheidet aus, nach 10 Runden gewinnt, wer die wenigsten Strafpunkte hat
 * Ohne Namen (settings.names = false) zählt das Spiel nur die Runden – endlos, bis ihr aufhört.
 *
 * Aufgaben werden ohne Wiederholung gezogen: über das Spiel (state.used) und – von der Oberfläche
 * mitgegeben – über den ganzen Abend (hooks.used: Liste oder Funktion). Ist ein Topf leer, beginnt er von vorn
 * (hooks.onDraw(task, reset) meldet das, damit die Oberfläche auch ihre Abend-Liste für diesen Topf leert).
 */
(function (root) {
  'use strict';

  const MODES = ['silbe', 'anfang', 'ende', 'kategorie', 'kette', 'mix'];
  const TASK_MODES = ['silbe', 'anfang', 'ende', 'kategorie', 'kette'];
  const MIX_WEIGHTS = { silbe: 3, anfang: 2, ende: 2, kategorie: 3, kette: 1 };
  const LEVELS = ['leicht', 'mittel', 'schwer'];
  const LEVEL_STUFEN = { leicht: [1], mittel: [1, 2], schwer: [2, 3] };
  const FUSES = { kurz: [10, 30], normal: [15, 60], lang: [30, 90] };
  const OUTS = ['three', 'rounds'];
  const STRIKES_OUT = 3;
  const ROUNDS = 10;
  const SIPS = 1; // BUMM → 1 Schluck
  const SIPS_OUT = 3; // 3. Strafpunkt → 3 Schlucke
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 12;
  const MAX_NAME = 20;
  const DEFAULT_SETTINGS = {
    mode: 'mix',
    level: 'mittel',
    fuse: 'normal',
    out: 'three',
    names: true,
    adult: false,
    drinks: false,
  };

  function pick(list, value, fallback) {
    return list.includes(value) ? value : fallback;
  }

  function sanitizeSettings(s) {
    const o = s || {};
    const d = DEFAULT_SETTINGS;
    return {
      mode: pick(MODES, o.mode, d.mode),
      level: pick(LEVELS, o.level, d.level),
      fuse: pick(Object.keys(FUSES), o.fuse, d.fuse),
      out: pick(OUTS, o.out, d.out),
      names: o.names === undefined ? d.names : !!o.names,
      adult: !!o.adult,
      drinks: !!o.drinks,
    };
  }

  function cleanName(n) {
    return String(n == null ? '' : n)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_NAME);
  }

  /* ------------------------------------------------------------------ */
  /* Aufgaben                                                            */
  /* ------------------------------------------------------------------ */

  function content() {
    return { silben: root.WBSilben || [], ae: root.WBAnfangEnde || { anfang: [], ende: [], kette: [] }, kat: root.WBKategorien || { familie: [], ab18: [] } };
  }

  /** Alle Aufgaben eines Modus, gefiltert nach Stufe und Ab 18 */
  function pool(mode, settings) {
    const s = sanitizeSettings(settings);
    const stufen = LEVEL_STUFEN[s.level];
    const c = content();
    const byLevel = (list) => list.filter((e) => stufen.includes(e[1]));
    switch (mode) {
      case 'silbe':
        return byLevel(c.silben).map(([text, stufe]) => ({ key: 'silbe:' + text, mode, text, stufe }));
      case 'anfang':
        return byLevel(c.ae.anfang).map(([text, stufe]) => ({ key: 'anfang:' + text, mode, text, stufe }));
      case 'ende':
        return byLevel(c.ae.ende).map(([text, stufe]) => ({ key: 'ende:' + text, mode, text, stufe }));
      case 'kategorie': {
        const list = byLevel(c.kat.familie).map(([text, stufe]) => ({ key: 'kat:' + text, mode, text, stufe }));
        if (s.adult) list.push(...byLevel(c.kat.ab18).map(([text, stufe]) => ({ key: 'kat:' + text, mode, text, stufe, adult: true })));
        return list;
      }
      case 'kette':
        return c.ae.kette.map((text) => ({ key: 'kette:' + text, mode, text, stufe: 0 }));
      default:
        return [];
    }
  }

  function weightedMode(random) {
    const total = TASK_MODES.reduce((n, m) => n + MIX_WEIGHTS[m], 0);
    let r = random() * total;
    for (const m of TASK_MODES) {
      r -= MIX_WEIGHTS[m];
      if (r < 0) return m;
    }
    return TASK_MODES[0];
  }

  /**
   * Nächste Aufgabe ziehen, die noch nicht in `used` steht. Ist alles verbraucht, kommt der volle Topf wieder.
   * Ergebnis: { task, reset } – reset = true, wenn der Topf neu begonnen wurde.
   */
  function drawTask(settings, used, random) {
    const s = sanitizeSettings(settings);
    const rnd = random || Math.random;
    const seen = used instanceof Set ? used : new Set(used || []);
    let mode = s.mode === 'mix' ? weightedMode(rnd) : s.mode;
    let all = pool(mode, s);
    if (!all.length) {
      mode = 'silbe';
      all = pool(mode, Object.assign({}, s, { level: 'mittel' }));
    }
    const fresh = all.filter((t) => !seen.has(t.key));
    const from = fresh.length ? fresh : all;
    return { task: from[Math.floor(rnd() * from.length)], reset: !fresh.length };
  }

  /* ------------------------------------------------------------------ */
  /* Spiel                                                               */
  /* ------------------------------------------------------------------ */

  class Engine {
    /** create({ settings, players: ['Anna', …] }, { random, used }) → Zustand */
    static create(opts, hooks) {
      const settings = sanitizeSettings(opts.settings);
      const names = settings.names ? (opts.players || []).map(cleanName).filter(Boolean).slice(0, MAX_PLAYERS) : [];
      if (settings.names && names.length < MIN_PLAYERS) throw new Error(`Mindestens ${MIN_PLAYERS} Namen`);
      const state = {
        v: 1,
        settings,
        players: names.map((name) => ({ name, strikes: 0, out: false, outRound: 0 })),
        round: 1,
        phase: 'ready',
        task: null,
        starter: null,
        holder: null,
        passes: 0,
        last: null,
        used: [],
        log: [],
      };
      const e = new Engine(state, hooks);
      if (names.length) state.starter = Math.floor(e.random() * names.length);
      e.drawTask();
      return state;
    }

    constructor(state, hooks) {
      this.s = state;
      this.hooks = hooks || {};
    }

    random() {
      return (this.hooks.random || Math.random)();
    }

    get named() {
      return this.s.settings.names && this.s.players.length > 0;
    }

    active() {
      return this.s.players.map((p, i) => (p.out ? -1 : i)).filter((i) => i >= 0);
    }

    /** Nächste noch spielende Person im Uhrzeigersinn nach i */
    nextActive(i) {
      const n = this.s.players.length;
      for (let k = 1; k <= n; k++) {
        const j = (i + k) % n;
        if (!this.s.players[j].out) return j;
      }
      return i;
    }

    drawTask() {
      const used = new Set(this.s.used);
      const evening = typeof this.hooks.used === 'function' ? this.hooks.used() : this.hooks.used;
      (evening || []).forEach((k) => used.add(k));
      const { task, reset } = drawTask(this.s.settings, used, () => this.random());
      if (reset) this.s.used = this.s.used.filter((k) => !k.startsWith(task.key.split(':')[0] + ':'));
      this.s.used.push(task.key);
      this.s.task = task;
      if (this.hooks.onDraw) this.hooks.onDraw(task, reset);
      return task;
    }

    /** Andere Aufgabe (nur vor dem Zünden) */
    skip() {
      if (this.s.phase !== 'ready') return false;
      this.drawTask();
      return true;
    }

    ignite() {
      if (this.s.phase !== 'ready') return false;
      this.s.phase = 'burning';
      this.s.holder = this.named ? this.s.starter : null;
      this.s.passes = 0;
      return true;
    }

    /** Wort gesagt, Display angetippt → Bombe geht an die nächste Person */
    pass() {
      if (this.s.phase !== 'burning') return false;
      this.s.passes++;
      if (this.named) this.s.holder = this.nextActive(this.s.holder);
      return true;
    }

    /** Abbrechen ohne Strafpunkt (z. B. Bildschirm ging aus) – dieselbe Aufgabe bleibt */
    abort() {
      if (this.s.phase !== 'burning') return false;
      this.s.phase = 'ready';
      this.s.holder = null;
      this.s.passes = 0;
      return true;
    }

    /** BUMM – wer die Bombe hält, bekommt den Strafpunkt */
    explode() {
      if (this.s.phase !== 'burning') return false;
      this.s.phase = 'boom';
      this.s.last = { loser: null, strikes: 0, out: false, sips: SIPS, passes: this.s.passes };
      if (this.named) this.penalize(this.s.holder);
      return true;
    }

    penalize(i) {
      const p = this.s.players[i];
      p.strikes++;
      const out = this.s.settings.out === 'three' && p.strikes >= STRIKES_OUT;
      if (out) {
        p.out = true;
        p.outRound = this.s.round;
      }
      Object.assign(this.s.last, { loser: i, strikes: p.strikes, out, sips: out ? SIPS_OUT : SIPS });
    }

    /** Falsche Person erwischt? Strafpunkt nach dem BUMM noch umhängen */
    blame(i) {
      if (this.s.phase !== 'boom' || !this.named || !this.s.last) return false;
      const target = this.s.players[i];
      const prev = this.s.last.loser;
      if (!target || i === prev || target.out) return false;
      if (prev !== null) {
        const p = this.s.players[prev];
        p.strikes--;
        if (this.s.last.out) {
          p.out = false;
          p.outRound = 0;
        }
      }
      this.penalize(i);
      return true;
    }

    isOver() {
      if (!this.named) return false;
      if (this.s.settings.out === 'three') return this.active().length <= 1;
      return this.s.round >= ROUNDS;
    }

    /** Weiter nach dem BUMM: nächste Runde oder Siegerehrung */
    next() {
      if (this.s.phase !== 'boom') return false;
      const last = this.s.last;
      this.s.log.push({ round: this.s.round, task: this.s.task.key, loser: last.loser, passes: last.passes });
      if (this.isOver()) {
        this.s.phase = 'end';
        return true;
      }
      this.s.round++;
      if (this.named) {
        const l = last.loser;
        this.s.starter = this.s.players[l].out ? this.nextActive(l) : l;
      }
      this.s.holder = null;
      this.s.passes = 0;
      this.s.last = null;
      this.s.phase = 'ready';
      this.drawTask();
      return true;
    }

    /**
     * Rangliste: [{ i, name, strikes, out, place }]
     * three: wer noch drin ist, vorn; Ausgeschiedene nach Runde (später ausgeschieden = besser)
     * rounds: wenigste Strafpunkte vorn, Gleichstand teilt sich den Platz
     */
    ranking() {
      const rows = this.s.players.map((p, i) => ({ i, name: p.name, strikes: p.strikes, out: p.out, outRound: p.outRound }));
      const three = this.s.settings.out === 'three';
      const score = (r) => (three ? (r.out ? r.outRound * 100 - r.strikes : 1e6 - r.strikes) : -r.strikes);
      rows.sort((a, b) => score(b) - score(a) || a.i - b.i);
      rows.forEach((r, k) => {
        r.place = k > 0 && score(rows[k - 1]) === score(r) ? rows[k - 1].place : k + 1;
      });
      return rows;
    }

    winners() {
      return this.ranking().filter((r) => r.place === 1);
    }

    /** Neues Spiel mit denselben Leuten und Einstellungen */
    static rematch(state, hooks) {
      return Engine.create({ settings: state.settings, players: state.players.map((p) => p.name) }, hooks);
    }
  }

  root.WBEngine = {
    Engine,
    MODES,
    TASK_MODES,
    MIX_WEIGHTS,
    LEVELS,
    LEVEL_STUFEN,
    FUSES,
    OUTS,
    STRIKES_OUT,
    ROUNDS,
    SIPS,
    SIPS_OUT,
    MIN_PLAYERS,
    MAX_PLAYERS,
    MAX_NAME,
    DEFAULT_SETTINGS,
    sanitizeSettings,
    cleanName,
    pool,
    drawTask,
  };
})(typeof window !== 'undefined' ? window : globalThis);
