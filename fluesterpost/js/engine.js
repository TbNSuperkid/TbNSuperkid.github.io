/*
 * Spiellogik von „Flüsterpost“ – Stille Post mit Zeichnungen. Laptop = Bühne, Handys = Schreib- und Zeichenblock.
 *
 * Alle schreiben gleichzeitig einen Satz. Der Satz wandert zur nächsten Person, die ihn zeichnet, die Zeichnung
 * wandert weiter und wird beschrieben, und so fort (Weitergabe und Schrittarten: js/chain.js). Am Ende zeigt der
 * Laptop jede Kette Schritt für Schritt – die Zeichnungen werden dabei nachgezeichnet.
 *
 * Phasen: lobby → play (Schritt 0 … steps−1) → show (Vorführung, Kette für Kette) → over
 *
 * Ein Schritt endet, wenn alle abgegeben haben (Getrennte nach der Schonfrist zählen nicht) oder die Zeit um ist.
 * Die Handys geben bei Zeitablauf selbst ab, was sie haben; der Laptop wartet danach noch SUBMIT_GRACE_MS und nimmt
 * für alle anderen den letzten Zwischenstand (draft) – oder trägt „(verschollen)“ ein.
 *
 * Zeichnungen liegen in s.images (ref → Liste von Zeichen-Nachrichten, siehe js/replay.js), nie in der Ansicht.
 * Der Controller schickt jedem Handy das eine Bild, das es gerade braucht (imageNeed).
 *
 * Ansichten (viewFor): Jede Person sieht nur den direkten Vorgänger-Schritt der Kette, die sie gerade bearbeitet.
 * Erst in der Vorführung werden die Ketten aufgedeckt – auf den Handys ohne Bilder.
 */
(function (root) {
  'use strict';

  const Chain = root.FpChain;
  const Replay = root.FpReplay;
  const Content = root.FpContent;

  const GAME = 'fluesterpost';
  const STAGE = 'stage';
  const PLAYER_COLORS = ['#f59e0b', '#38bdf8', '#a855f7', '#22c55e', '#ef4444', '#ec4899', '#14b8a6', '#facc15', '#84cc16', '#f97316', '#818cf8', '#e5e7eb'];
  const MODES = ['normal', 'words', 'copy'];
  const STEP_OPTIONS = [0, 4, 6, 8];
  const WRITE_TIMES = [30, 45, 60];
  const DRAW_TIMES = [60, 90, 120, 0];
  const REPLAYS = ['animate', 'instant'];
  const DECKS = ['family', 'adult', 'custom'];
  const DRINK_OPTIONS = ['off', 'on', 'free'];
  const DEFAULT_SETTINGS = {
    mode: 'normal',
    steps: 0,
    writeTime: 45,
    drawTime: 90,
    replay: 'animate',
    hearts: true,
    deck: 'family',
    custom: [],
    drinks: 'off',
  };
  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 12;
  // So lange wird auf jemanden gewartet, dessen Handy kurz die Verbindung verliert
  const GRACE_MS = 15000;
  // Nach Ablauf der Zeit: so lange dürfen die Handys noch abgeben
  const SUBMIT_GRACE_MS = 2500;
  // „Beeilung!“ vom Laptop: noch so viel Zeit
  const HURRY_MS = 10000;
  // „Nur Zeichnen“: so lange sieht man die Zeichnung davor
  const PEEK_MS = 3000;
  const MAX_TEXT = Content.MAX_TEXT;
  const STOP_WORDS = new Set(
    'und oder mit auf aus bei nach von vom zum zur fuer ueber unter vor hinter neben einen einem einer eines eine ein der die das den dem des ist sind wird hat haben sein seine ihre ihr sich sehr viel beim nicht noch auch mal ganz zwei drei zehn'.split(' ')
  );

  function cleanText(text, max) {
    return String(text == null ? '' : text)
      .replace(/[\u0000-\u001f<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max || MAX_TEXT);
  }

  function cleanName(name, fallback) {
    return cleanText(name, 24) || fallback;
  }

  function clone(o) {
    return o == null ? o : JSON.parse(JSON.stringify(o));
  }

  function pick(list, value, current) {
    const n = typeof list[0] === 'number' ? +value : value;
    return value !== null && value !== '' && list.includes(n) ? n : current;
  }

  function sanitizeSettings(input, current) {
    const s = Object.assign({}, current || DEFAULT_SETTINGS);
    const i = input || {};
    s.mode = pick(MODES, i.mode, s.mode);
    s.steps = pick(STEP_OPTIONS, i.steps, s.steps);
    s.writeTime = pick(WRITE_TIMES, i.writeTime, s.writeTime);
    s.drawTime = pick(DRAW_TIMES, i.drawTime, s.drawTime);
    s.replay = pick(REPLAYS, i.replay, s.replay);
    s.deck = pick(DECKS, i.deck, s.deck);
    s.drinks = pick(DRINK_OPTIONS, i.drinks, s.drinks);
    if (typeof i.hearts === 'boolean') s.hearts = i.hearts;
    if (i.custom !== undefined) s.custom = Content.parseCustom(i.custom);
    s.custom = (s.custom || []).slice();
    return s;
  }

  /** Inhaltswörter eines Satzes (ohne Füllwörter, ab 3 Buchstaben) */
  function keywords(text) {
    return String(text || '')
      .split(/[\s,.;:!?„“"'()\-–]+/)
      .map((w) => root.GameMatch.normalize(w))
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  }

  /**
   * Ist die Kette „angekommen“? true, wenn Anfang und letzte Beschreibung ein Inhaltswort gemeinsam haben
   * (Plural, Artikel, kleine Tippfehler egal – shared/match.js). null = nicht vergleichbar.
   */
  function arrived(start, end) {
    const a = keywords(start);
    const b = keywords(end);
    if (!a.length || !b.length) return null;
    return a.some((x) => b.some((y) => root.GameMatch.same(x, y)));
  }

  class Engine {
    /**
     * @param {object} state Spielzustand (siehe Engine.create)
     * @param {{onChange?: Function, onKick?: Function, now?: Function, timers?: boolean, random?: Function}} hooks
     *   timers: false schaltet die automatischen Zeitlimits ab (Tests rufen dann tick() selbst auf)
     */
    constructor(state, hooks) {
      this.s = state;
      if (!this.s.images) this.s.images = {};
      this.hooks = hooks || {};
      this.now = this.hooks.now || (() => Date.now());
      this.random = this.hooks.random || Math.random;
      this.timer = null;
      this.tick();
      this.armTimer();
    }

    /** Neues Spiel – es beginnt in der Lobby, alle treten mit dem Handy bei */
    static create(config) {
      return {
        v: 1,
        game: GAME,
        settings: sanitizeSettings((config || {}).settings),
        phase: 'lobby',
        members: {},
        players: [],
        order: [],
        names: {},
        steps: 0,
        step: 0,
        stepAt: null,
        endsAt: null,
        total: 0,
        hurried: false,
        chains: {},
        done: [],
        drafts: {},
        images: {},
        imgRev: 0,
        suggest: {},
        usedSuggest: [],
        usedWords: [],
        show: null,
        hearts: {},
        verdicts: {},
        awards: [],
        startedAt: null,
        endedAt: null,
      };
    }

    get write() {
      return true;
    }

    dispose() {
      clearTimeout(this.timer);
      this.timer = null;
    }

    changed() {
      this.armTimer();
      if (this.hooks.onChange) this.hooks.onChange();
    }

    /* ---------- Hilfsfunktionen ---------- */

    player(pid) {
      return this.s.players.find((p) => p.id === pid) || null;
    }

    playerName(pid) {
      const s = this.s;
      const p = this.player(pid);
      if (p) return p.name;
      if (s.names[pid]) return s.names[pid];
      const m = s.members[pid];
      return m ? m.name : '?';
    }

    colorOf(pid) {
      const i = this.s.order.indexOf(pid);
      const j = i >= 0 ? i : this.s.players.findIndex((p) => p.id === pid);
      return j >= 0 ? PLAYER_COLORS[j % PLAYER_COLORS.length] : '#e5e7eb';
    }

    isOnline(pid) {
      const m = this.s.members[pid];
      return !!(m && m.online);
    }

    /** Wird auf diese Person gewartet? (verbunden oder erst kurz weg) */
    awaited(pid) {
      if (this.isOnline(pid)) return true;
      const m = this.s.members[pid];
      return !!(m && m.offlineAt && this.now() - m.offlineAt < GRACE_MS);
    }

    get n() {
      return this.s.order.length;
    }

    /** Index der Startwort-Verschiebung (Modus „Wort-Start“) */
    get offset() {
      return Chain.offset(this.s.settings.mode);
    }

    typeOf(k) {
      return Chain.stepType(this.s.settings.mode, k, this.s.steps);
    }

    /** Länge einer fertigen Kette */
    get chainLength() {
      return this.offset + this.s.steps;
    }

    /** Aufgabe von pid im laufenden Schritt: { owner, pos, type, prev } oder null */
    task(pid) {
      const s = this.s;
      if (s.phase !== 'play') return null;
      const i = s.order.indexOf(pid);
      if (i < 0) return null;
      const owner = s.order[Chain.chainOf(this.n, s.step, i)];
      const pos = this.offset + s.step;
      return { owner, pos, type: this.typeOf(s.step), prev: pos > 0 ? s.chains[owner][pos - 1] || null : null };
    }

    /** Welche Zeichnung braucht dieses Handy gerade? (ref oder null) */
    imageNeed(pid) {
      const t = this.task(pid);
      return t && t.prev && t.prev.ref && !t.prev.empty ? t.prev.ref : null;
    }

    /** Zeit für einen Schritt (ms) oder 0 = ohne Zeitlimit */
    timeFor(type) {
      const st = this.s.settings;
      if (!Chain.isDrawing(type)) return st.writeTime * 1000;
      if (!st.drawTime) return 0;
      return st.drawTime * 1000 + (type === 'copy' ? PEEK_MS : 0);
    }

    stepKey() {
      return this.s.phase === 'play' ? this.s.step : null;
    }

    /* ---------- Verbindungen ---------- */

    connect(pid, name) {
      const s = this.s;
      const m = s.members[pid];
      if (m) {
        m.online = true;
        delete m.offlineAt;
        if (name) m.name = cleanName(name, m.name);
      } else {
        s.members[pid] = { name: cleanName(name, 'Gast'), online: true, joined: this.now() };
      }
      const p = this.player(pid);
      if (p) p.name = s.members[pid].name;
      if (s.order.includes(pid)) s.names[pid] = s.members[pid].name;
      // Wer in der Lobby dazukommt, spielt mit – mitten im Spiel nicht mehr (die Ketten stehen fest)
      if (!p && s.phase === 'lobby' && s.players.length < MAX_PLAYERS) this.addPlayer(pid);
      this.changed();
    }

    addPlayer(pid) {
      this.s.players.push({ id: pid, name: this.s.members[pid].name });
    }

    disconnect(pid) {
      const m = this.s.members[pid];
      if (!m || !m.online) return;
      m.online = false;
      m.offlineAt = this.now();
      this.changed();
    }

    /** Nach dem Neuladen des Laptops: alle müssen sich neu verbinden (mit Schonfrist) */
    setAllOffline() {
      const now = this.now();
      for (const m of Object.values(this.s.members)) {
        if (m.online) m.offlineAt = now;
        m.online = false;
      }
    }

    /* ---------- Ablauf ---------- */

    startGame() {
      const s = this.s;
      s.order = s.players.map((p) => p.id);
      s.names = Object.fromEntries(s.players.map((p) => [p.id, p.name]));
      s.steps = Chain.stepCount(s.order.length, s.settings.steps);
      s.chains = {};
      s.images = {};
      s.imgRev += 1;
      s.hearts = {};
      s.verdicts = {};
      s.awards = [];
      s.show = null;
      s.usedSuggest = [];
      s.startedAt = this.now();
      s.endedAt = null;
      for (const pid of s.order) {
        s.chains[pid] = [];
        if (s.settings.mode === 'words') s.chains[pid].push({ by: null, kind: 'word', text: this.drawWord() });
      }
      s.step = 0;
      s.phase = 'play';
      this.beginStep();
    }

    /** Startwort ohne Wiederholung (auch über Spiele hinweg, solange der Laptop läuft) */
    drawWord() {
      const s = this.s;
      const all = Content.words();
      let pool = all.filter((w) => !s.usedWords.includes(w));
      if (!pool.length) {
        s.usedWords = [];
        pool = all;
      }
      const w = pool[Math.floor(this.random() * pool.length)] || 'Haus';
      s.usedWords.push(w);
      return w;
    }

    beginStep() {
      const s = this.s;
      const total = this.timeFor(this.typeOf(s.step));
      s.done = [];
      s.drafts = {};
      s.suggest = {};
      s.hurried = false;
      s.stepAt = this.now();
      s.total = total;
      s.endsAt = total ? s.stepAt + total : null;
    }

    /** Eintrag aus einem Zwischenstand (oder leer / verschollen) */
    entryFromDraft(pid, t) {
      const s = this.s;
      const d = s.drafts[pid];
      const drawing = Chain.isDrawing(t.type);
      if (d && drawing && d.ref && s.images[d.ref]) {
        const ref = this.imageRef(t.owner, t.pos);
        s.images[ref] = s.images[d.ref];
        return { by: pid, kind: t.type, ref, empty: !s.images[ref].length, late: true };
      }
      if (d && !drawing && typeof d.text === 'string') return { by: pid, kind: t.type, text: d.text, empty: !d.text, late: true };
      if (!this.awaited(pid)) return drawing ? { by: pid, kind: t.type, missing: true, empty: true } : { by: pid, kind: t.type, text: '', missing: true, empty: true };
      return drawing ? { by: pid, kind: t.type, ref: null, empty: true, late: true } : { by: pid, kind: t.type, text: '', empty: true, late: true };
    }

    imageRef(owner, pos) {
      return `i:${owner}:${pos}`;
    }

    /** Schritt abschließen: fehlende Abgaben aus Zwischenständen, dann weiter (oder zur Vorführung) */
    endStep() {
      const s = this.s;
      for (const pid of s.order) {
        const t = this.task(pid);
        if (!t.owner || s.chains[t.owner][t.pos]) continue;
        s.chains[t.owner][t.pos] = this.entryFromDraft(pid, t);
      }
      for (const ref of Object.keys(s.images)) if (ref.startsWith('d:')) delete s.images[ref];
      s.imgRev += 1;
      s.drafts = {};
      s.step += 1;
      if (s.step >= s.steps) this.startShow();
      else this.beginStep();
    }

    startShow() {
      const s = this.s;
      s.phase = 'show';
      s.show = { i: 0, n: 1 };
      s.done = [];
      s.endsAt = null;
      s.total = 0;
      s.hurried = false;
    }

    finish() {
      const s = this.s;
      s.phase = 'over';
      s.endsAt = null;
      s.endedAt = this.now();
      s.awards = this.computeAwards();
      this.dispose();
    }

    /** Alle (die noch erwartet werden) haben abgegeben? Dann sofort weiter. */
    checkProgress() {
      const s = this.s;
      if (s.phase !== 'play' || !s.done.length) return false;
      if (s.order.every((pid) => s.done.includes(pid) || !this.awaited(pid))) {
        this.endStep();
        return true;
      }
      return false;
    }

    /* ---------- Zeitlimit ---------- */

    nextDeadline() {
      const s = this.s;
      if (s.phase !== 'play') return null;
      const ends = [];
      if (s.endsAt) ends.push(s.endsAt + SUBMIT_GRACE_MS);
      for (const m of Object.values(s.members)) if (!m.online && m.offlineAt) ends.push(m.offlineAt + GRACE_MS);
      const future = ends.filter((t) => t > this.now());
      return future.length ? Math.min(...future) : null;
    }

    armTimer() {
      clearTimeout(this.timer);
      this.timer = null;
      if (this.hooks.timers === false) return;
      const next = this.nextDeadline();
      if (next == null) return;
      this.timer = setTimeout(
        () => {
          if (this.tick()) this.changed();
          else this.armTimer();
        },
        Math.max(0, next - this.now()) + 30
      );
    }

    /** Abgelaufene Zeiten auswerten. Gibt true zurück, wenn sich etwas geändert hat. */
    tick() {
      const s = this.s;
      if (s.phase !== 'play') return false;
      if (s.endsAt && this.now() >= s.endsAt + SUBMIT_GRACE_MS) {
        this.endStep();
        return true;
      }
      // Getrennte, auf die nicht mehr gewartet wird, halten den Schritt nicht auf
      return this.checkProgress();
    }

    /* ---------- Aktionen ---------- */

    /**
     * Verarbeitet eine Aktion. Gibt true zurück, wenn sich etwas geändert hat.
     * @param {object} a Aktion {type, ...}
     * @param {string} actor 'stage' (Laptop) oder Spieler-ID (Handy)
     */
    apply(a, actor) {
      if (!a || typeof a.type !== 'string') return false;
      const handler = this['on_' + a.type];
      if (typeof handler !== 'function') return false;
      const ok = handler.call(this, a, actor) === true;
      if (ok) this.changed();
      return ok;
    }

    /* Lobby */

    on_settings(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby') return false;
      s.settings = sanitizeSettings(a.settings, s.settings);
      return true;
    }

    /** Mitspielen / nur zuschauen (Handy, in der Lobby) */
    on_watch(a, actor) {
      const s = this.s;
      if (actor === STAGE || s.phase !== 'lobby' || !s.members[actor]) return false;
      const p = this.player(actor);
      if (a.watch && p) {
        s.players = s.players.filter((x) => x.id !== actor);
        return true;
      }
      if (!a.watch && !p && s.players.length < MAX_PLAYERS) {
        this.addPlayer(actor);
        return true;
      }
      return false;
    }

    on_kick(a, actor) {
      const s = this.s;
      if (actor !== STAGE || !s.members[a.player]) return false;
      const pid = a.player;
      s.players = s.players.filter((p) => p.id !== pid);
      delete s.members[pid];
      if (this.hooks.onKick) this.hooks.onKick(pid);
      // Mitten im Spiel bleibt die Person in der Reihenfolge (ihre Kette läuft weiter), ihre Schritte bleiben leer
      this.checkProgress();
      return true;
    }

    lobbyProblem() {
      const s = this.s;
      const here = s.players.filter((p) => this.isOnline(p.id));
      if (here.length < MIN_PLAYERS) return `Ihr braucht mindestens ${MIN_PLAYERS} Personen – scannt den QR-Code!`;
      if (s.settings.mode !== 'words' && s.settings.deck === 'custom' && s.settings.custom.length < 3) {
        return 'Für eigene Startsätze braucht ihr mindestens 3 Sätze – oder wählt Familie / Ab 18.';
      }
      return null;
    }

    on_start(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby' || this.lobbyProblem()) return false;
      s.players = s.players.filter((p) => this.isOnline(p.id));
      this.startGame();
      return true;
    }

    /* Schritt */

    /** Gehört die Aktion zum laufenden Schritt? */
    current(a) {
      return this.s.phase === 'play' && a.step === this.s.step;
    }

    /** Abgabe: { step, text } oder { step, ops } */
    on_submit(a, actor) {
      const s = this.s;
      if (!this.current(a)) return false;
      const t = this.task(actor);
      if (!t) return false;
      let entry;
      if (Chain.isDrawing(t.type)) {
        const ops = Replay.compact(Replay.cleanOps(a.ops));
        const ref = this.imageRef(t.owner, t.pos);
        s.images[ref] = ops;
        s.imgRev += 1;
        entry = { by: actor, kind: t.type, ref, empty: !ops.length };
      } else {
        const text = cleanText(a.text);
        entry = { by: actor, kind: t.type, text, empty: !text };
      }
      s.chains[t.owner][t.pos] = entry;
      if (!s.done.includes(actor)) s.done.push(actor);
      if (s.drafts[actor]) {
        if (s.drafts[actor].ref) delete s.images[s.drafts[actor].ref];
        delete s.drafts[actor];
      }
      this.checkProgress();
      return true;
    }

    /** „Doch noch ändern“: Abgabe zurücknehmen (sie bleibt als Rückfall stehen) */
    on_edit(a, actor) {
      const s = this.s;
      if (!this.current(a) || !s.done.includes(actor)) return false;
      if (s.endsAt && this.now() >= s.endsAt) return false;
      s.done = s.done.filter((x) => x !== actor);
      return true;
    }

    /** Zwischenstand (alle paar Sekunden vom Handy), falls die Verbindung abreißt */
    on_draft(a, actor) {
      const s = this.s;
      if (!this.current(a) || s.done.includes(actor)) return false;
      const t = this.task(actor);
      if (!t) return false;
      if (Chain.isDrawing(t.type)) {
        const ref = 'd:' + actor;
        s.images[ref] = Replay.compact(Replay.cleanOps(a.ops));
        s.imgRev += 1;
        s.drafts[actor] = { ref };
      } else s.drafts[actor] = { text: cleanText(a.text) };
      return true;
    }

    /** 🎲 Vorschlag für den Startsatz */
    on_suggest(a, actor) {
      const s = this.s;
      if (!this.current(a) || s.done.includes(actor)) return false;
      const t = this.task(actor);
      if (!t || t.type !== 'write') return false;
      const all = Content.sentences(s.settings.deck, s.settings.custom);
      if (!all.length) return false;
      let pool = all.filter((x) => !s.usedSuggest.includes(x));
      if (!pool.length) {
        s.usedSuggest = [];
        pool = all;
      }
      const text = pool[Math.floor(this.random() * pool.length)];
      s.usedSuggest.push(text);
      const prev = s.suggest[actor];
      s.suggest[actor] = { text, n: prev ? prev.n + 1 : 1 };
      return true;
    }

    /** „Wort-Start“: anderes Startwort für die eigene Kette (nur im ersten Schritt) */
    on_reroll(a, actor) {
      const s = this.s;
      if (!this.current(a) || s.settings.mode !== 'words' || s.step !== 0 || s.done.includes(actor)) return false;
      const t = this.task(actor);
      if (!t) return false;
      s.chains[t.owner][0].text = this.drawWord();
      return true;
    }

    /** Laptop: „Beeilung!“ – noch 10 Sekunden; nochmal gedrückt: sofort abgeben */
    on_hurry(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'play') return false;
      const now = this.now();
      if (s.hurried || (s.endsAt && s.endsAt - now <= HURRY_MS)) {
        s.endsAt = now;
      } else {
        s.endsAt = now + HURRY_MS;
        if (!s.total || s.total < HURRY_MS) s.total = HURRY_MS;
      }
      s.hurried = true;
      return true;
    }

    /** Laptop: Spiel vorzeitig beenden → laufender Schritt wird abgeschlossen, dann Vorführung */
    on_end(a, actor) {
      const s = this.s;
      if (actor !== STAGE) return false;
      if (s.phase === 'play') {
        s.steps = s.step + 1;
        this.endStep();
        return true;
      }
      if (s.phase === 'show') {
        this.finish();
        return true;
      }
      return false;
    }

    /* Vorführung */

    /** Weiter: nächster Eintrag, nächste Kette oder Ende. Darf der Laptop und wem die gezeigte Kette gehört. */
    on_next(a, actor) {
      const s = this.s;
      const sh = s.show;
      if (s.phase !== 'show' || !sh) return false;
      if (a.i !== undefined && (a.i !== sh.i || a.n !== sh.n)) return false; // veralteter Klick
      if (actor !== STAGE && actor !== s.order[sh.i]) return false;
      if (sh.n < this.chainLength) sh.n += 1;
      else if (sh.i < this.n - 1) {
        sh.i += 1;
        sh.n = 1;
      } else this.finish();
      return true;
    }

    /** Laptop: einen Schritt zurück */
    on_back(a, actor) {
      const s = this.s;
      const sh = s.show;
      if (actor !== STAGE || s.phase !== 'show' || !sh) return false;
      if (sh.n > 1) sh.n -= 1;
      else if (sh.i > 0) {
        sh.i -= 1;
        sh.n = this.chainLength;
      } else return false;
      return true;
    }

    /** Laptop: ganze Kette auf einmal aufdecken */
    on_reveal_all(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'show' || s.show.n >= this.chainLength) return false;
      s.show.n = this.chainLength;
      return true;
    }

    /** Laptop: Vorführung von vorne (am Ende) */
    on_rewatch(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'over' || !s.order.length) return false;
      s.phase = 'show';
      s.show = { i: 0, n: 1 };
      return true;
    }

    /** Ist Eintrag idx von Kette owner schon aufgedeckt? */
    revealed(owner, idx) {
      const s = this.s;
      if (s.phase === 'over') return true;
      if (s.phase !== 'show' || !s.show) return false;
      const ci = s.order.indexOf(owner);
      return ci >= 0 && (ci < s.show.i || (ci === s.show.i && idx < s.show.n));
    }

    /** Kette komplett aufgedeckt? */
    complete(owner) {
      return this.revealed(owner, this.chainLength - 1);
    }

    /** ❤️ Lieblingsmoment: pro Kette ein Herz je Person (nochmal = zurücknehmen, anderes = umsetzen) */
    on_heart(a, actor) {
      const s = this.s;
      if (!s.settings.hearts || !['show', 'over'].includes(s.phase) || !s.order.includes(actor)) return false;
      const chain = s.chains[a.owner];
      const idx = a.idx;
      const e = chain && Number.isInteger(idx) ? chain[idx] : null;
      if (!e || e.kind === 'word' || e.missing || e.by === actor || !this.revealed(a.owner, idx)) return false;
      const key = `${a.owner}:${idx}`;
      const had = (s.hearts[key] || []).includes(actor);
      for (const k of Object.keys(s.hearts)) {
        if (!k.startsWith(a.owner + ':')) continue;
        s.hearts[k] = s.hearts[k].filter((x) => x !== actor);
        if (!s.hearts[k].length) delete s.hearts[k];
      }
      if (!had) s.hearts[key] = (s.hearts[key] || []).concat(actor);
      if (s.phase === 'over') s.awards = this.computeAwards();
      return true;
    }

    /** Laptop: „angekommen?“ von Hand umstellen (die Wortprüfung irrt sich manchmal) */
    on_verdict(a, actor) {
      const s = this.s;
      if (actor !== STAGE || !s.chains[a.owner] || !this.complete(a.owner) || typeof a.value !== 'boolean') return false;
      s.verdicts[a.owner] = a.value;
      if (s.phase === 'over') s.awards = this.computeAwards();
      return true;
    }

    /** Nochmal mit denselben Leuten */
    on_again(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'over') return false;
      s.phase = 'lobby';
      s.order = [];
      s.chains = {};
      s.images = {};
      s.imgRev += 1;
      s.hearts = {};
      s.verdicts = {};
      s.show = null;
      s.awards = [];
      s.step = 0;
      s.steps = 0;
      s.done = [];
      s.drafts = {};
      s.endsAt = null;
      s.startedAt = null;
      s.endedAt = null;
      s.players = s.players.filter((p) => s.members[p.id]);
      return true;
    }

    /* ---------- Auswertung ---------- */

    /** Anfang und letzte Beschreibung einer Kette */
    ends(owner) {
      const chain = this.s.chains[owner] || [];
      const start = chain[0] && !chain[0].empty ? chain[0].text : '';
      let end = '';
      for (let i = chain.length - 1; i > 0; i--) {
        const e = chain[i];
        if (e && e.text && !Chain.isDrawing(e.kind)) {
          end = e.text;
          break;
        }
      }
      return { start, end };
    }

    /** Angekommen? { auto, value } – value berücksichtigt die Korrektur am Laptop; null = nicht vergleichbar */
    verdict(owner) {
      const { start, end } = this.ends(owner);
      const auto = start && end ? arrived(start, end) : null;
      const manual = this.s.verdicts[owner];
      return { auto, value: typeof manual === 'boolean' ? manual : auto, manual: typeof manual === 'boolean' };
    }

    /** Trinkregel: Kette völlig anders angekommen → wem sie gehört, trinkt 1 (sobald sie ganz gezeigt wurde) */
    drinksFor(owner) {
      if (this.s.settings.drinks === 'off' || !this.complete(owner)) return 0;
      return this.verdict(owner).value === false ? 1 : 0;
    }

    heartCount(owner, idx) {
      return (this.s.hearts[`${owner}:${idx}`] || []).length;
    }

    computeAwards() {
      const s = this.s;
      const out = [];
      // ❤️ Lieblingsmoment des Abends: der Eintrag mit den meisten Herzen
      let best = null;
      for (const owner of s.order) {
        (s.chains[owner] || []).forEach((e, idx) => {
          const n = this.heartCount(owner, idx);
          if (n && (!best || n > best.n)) best = { owner, idx, n, by: e.by };
        });
      }
      if (best) {
        const where = best.by === best.owner ? `${this.playerName(best.by)}s Startsatz` : `${this.playerName(best.by)} in ${this.playerName(best.owner)}s Kette`;
        out.push({ icon: '❤️', title: 'Lieblingsmoment des Abends', text: `${where} – ${best.n} ${best.n === 1 ? 'Herz' : 'Herzen'}`, owner: best.owner, idx: best.idx });
      }
      // 💘 Herzensbrecher/in: die meisten Herzen insgesamt (eindeutig, ab 2)
      const got = {};
      for (const [key, list] of Object.entries(s.hearts)) {
        const i = key.lastIndexOf(':');
        const e = (s.chains[key.slice(0, i)] || [])[+key.slice(i + 1)];
        if (e && e.by) got[e.by] = (got[e.by] || 0) + list.length;
      }
      const top = Object.entries(got).sort((a, b) => b[1] - a[1]);
      if (top.length && top[0][1] >= 2 && (top.length < 2 || top[1][1] < top[0][1])) {
        out.push({ icon: '💘', title: 'Herzensbrecher/in', text: `${this.playerName(top[0][0])} – ${top[0][1]} Herzen` });
      }
      // 🎯 Angekommen: wie viele Ketten haben überlebt?
      const verdicts = s.order.map((o) => this.verdict(o).value).filter((v) => v !== null);
      if (verdicts.length) {
        const ok = verdicts.filter(Boolean).length;
        out.push({ icon: ok ? '🎯' : '🔀', title: ok ? 'Heil angekommen' : 'Totale Verwandlung', text: `${ok} von ${verdicts.length} ${verdicts.length === 1 ? 'Kette' : 'Ketten'} – Ende ≈ Anfang` });
      }
      return out;
    }

    /* ---------- Ansicht ---------- */

    /** Ein Eintrag für die Ansicht. Bilder (ref) bekommt nur der Laptop. */
    entryView(owner, idx, viewer) {
      const s = this.s;
      const e = s.chains[owner][idx];
      if (!e) return null;
      const stage = viewer === STAGE;
      const hearts = s.hearts[`${owner}:${idx}`] || [];
      return {
        idx,
        kind: e.kind,
        by: e.by,
        name: e.by ? this.playerName(e.by) : null,
        color: e.by ? this.colorOf(e.by) : null,
        drawing: Chain.isDrawing(e.kind),
        text: Chain.isDrawing(e.kind) ? null : e.text,
        ref: stage && e.ref && !e.empty ? e.ref : null,
        empty: !!e.empty,
        missing: !!e.missing,
        late: !!e.late,
        hearts: hearts.length,
        hearted: hearts.includes(viewer),
        canHeart: !!(s.settings.hearts && s.order.includes(viewer) && e.kind !== 'word' && !e.missing && e.by !== viewer),
      };
    }

    chainView(owner, viewer, upto) {
      const chain = this.s.chains[owner] || [];
      const n = upto == null ? chain.length : Math.min(upto, chain.length);
      const entries = [];
      for (let i = 0; i < n; i++) {
        const ev = this.entryView(owner, i, viewer);
        if (ev) entries.push(ev);
      }
      const complete = this.complete(owner);
      return {
        owner,
        ownerName: this.playerName(owner),
        color: this.colorOf(owner),
        entries,
        complete,
        verdict: complete ? this.verdict(owner) : null,
        drinks: this.drinksFor(owner),
      };
    }

    /** Was pid im laufenden Schritt zu tun hat – nur der direkte Vorgänger-Schritt ist sichtbar */
    taskView(pid) {
      const s = this.s;
      const t = this.task(pid);
      if (!t) return null;
      const p = t.prev;
      const mine = s.chains[t.owner][t.pos];
      const draft = s.drafts[pid];
      return {
        step: s.step,
        type: t.type,
        prev: p
          ? {
              kind: p.kind,
              drawing: Chain.isDrawing(p.kind),
              text: Chain.isDrawing(p.kind) ? null : p.text,
              ref: p.ref && !p.empty ? p.ref : null,
              empty: !!p.empty,
              missing: !!p.missing,
            }
          : null,
        done: s.done.includes(pid),
        // Eigener Text (nach „Doch noch ändern“ oder dem Neuladen wieder ins Feld)
        text: mine && !Chain.isDrawing(t.type) ? mine.text : draft && typeof draft.text === 'string' ? draft.text : null,
        submitted: !!mine,
        suggestion: s.suggest[pid] || null,
        canSuggest: t.type === 'write' && Content.sentences(s.settings.deck, s.settings.custom).length > 0,
        canReroll: s.settings.mode === 'words' && s.step === 0,
        peek: t.type === 'copy' ? PEEK_MS : 0,
        last: s.step === s.steps - 1,
      };
    }

    viewFor(viewer) {
      const s = this.s;
      const stage = viewer === STAGE;
      const inGame = s.phase !== 'lobby';
      const people = inGame ? s.order : s.players.map((p) => p.id);
      const settings = Object.assign({}, s.settings, { custom: stage ? s.settings.custom.slice() : [], customCount: s.settings.custom.length });
      const waiting = s.phase === 'play' ? s.order.filter((pid) => !s.done.includes(pid) && this.awaited(pid)) : [];
      let show = null;
      if (s.phase === 'show' && s.show) {
        const owner = s.order[s.show.i];
        show = Object.assign(this.chainView(owner, viewer, s.show.n), { i: s.show.i, n: s.show.n, count: s.order.length, total: this.chainLength });
      }
      let chains = null;
      if (s.phase === 'over') {
        // Laptop: alle Ketten (Galerie), Handys: nur die eigene Kette (ohne Bilder)
        chains = stage ? s.order.map((o) => this.chainView(o, viewer)) : s.order.includes(viewer) ? [this.chainView(viewer, viewer)] : [];
      }
      const myHearts = Object.entries(s.hearts).reduce((n, [key, list]) => {
        const i = key.lastIndexOf(':');
        const e = (s.chains[key.slice(0, i)] || [])[+key.slice(i + 1)];
        return e && e.by === viewer ? n + list.length : n;
      }, 0);
      return {
        game: GAME,
        phase: s.phase,
        settings,
        players: people.map((pid) => ({
          id: pid,
          name: this.playerName(pid),
          color: this.colorOf(pid),
          online: this.isOnline(pid),
          gone: inGame && !s.members[pid],
          done: s.done.includes(pid),
          drinks: inGame ? this.drinksFor(pid) : 0,
        })),
        members: Object.entries(s.members).map(([id, m]) => ({ id, name: m.name, online: m.online, playing: inGame ? s.order.includes(id) : !!this.player(id) })),
        steps: s.steps,
        step: s.step,
        stepType: s.phase === 'play' ? this.typeOf(s.step) : null,
        timer: s.phase === 'play' && s.endsAt ? { total: s.total || 1, remaining: Math.max(0, s.endsAt - this.now()) } : null,
        hurried: s.hurried,
        doneCount: s.done.length,
        waiting,
        lobbyProblem: s.phase === 'lobby' ? this.lobbyProblem() : null,
        task: stage ? null : this.taskView(viewer),
        show,
        chains,
        awards: clone(s.awards),
        startedAt: s.startedAt,
        me: stage
          ? { stage: true }
          : {
              id: viewer,
              name: (s.members[viewer] || {}).name || '',
              playing: inGame ? s.order.includes(viewer) : !!this.player(viewer),
              hearts: myHearts,
            },
      };
    }
  }

  root.FpEngine = {
    Engine,
    GAME,
    STAGE,
    PLAYER_COLORS,
    MODES,
    STEP_OPTIONS,
    WRITE_TIMES,
    DRAW_TIMES,
    REPLAYS,
    DECKS,
    DRINK_OPTIONS,
    DEFAULT_SETTINGS,
    MIN_PLAYERS,
    MAX_PLAYERS,
    GRACE_MS,
    SUBMIT_GRACE_MS,
    HURRY_MS,
    PEEK_MS,
    MAX_TEXT,
    sanitizeSettings,
    cleanText,
    keywords,
    arrived,
  };
})(typeof window !== 'undefined' ? window : globalThis);
