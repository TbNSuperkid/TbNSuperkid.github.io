/*
 * Spiellogik von „Echt jetzt?“.
 *
 * Laptop = Bühne, gelogen und getippt wird auf den Handys. Ablauf je Frage:
 *   [category] → lie → [check] → pick → reveal → (nächste Frage | scores | end)
 *   Runde 1 und 2 mit je 2/3/4 Fragen, danach das Finale (eine Frage, zwei Tipps).
 *
 * - category: Reihum wählt eine Person eine von drei Kategorien (aus: zufällig).
 * - lie:      Alle erfinden eine falsche Antwort. Zu nah an der Wahrheit (questions.tooClose) → abgelehnt, neu schreiben.
 *             Gleiche Lügen werden zu einer Karte zusammengelegt (beide bekommen die Punkte). Wer nichts schreibt,
 *             wird durch eine „Lüge vom Haus“ (Köder aus der Datenbank) ersetzt – die gibt keine Punkte.
 * - check:    Nur Wörterbuch: Die Spielleitung sieht alle Karten (ohne zu wissen, welche wahr ist) und legt Erklärungen
 *             zusammen, die dasselbe meinen. Landet eine Lüge auf der Wahrheit, hat sie die Wahrheit „getroffen“:
 *             Wahrheits-Punkte, und die Person muss nicht mehr tippen.
 * - pick:     Alle Karten gemischt (einmal, für Bühne und Handys gleich), jede/r tippt eine an – nicht die eigene.
 *             Im Finale zwei Tipps: der zweite gibt halbe Punkte.
 * - reveal:   Schritt für Schritt: erst alle Lügen, auf die niemand reingefallen ist, dann jede Lüge mit Reingefallenen,
 *             zum Schluss die Wahrheit. Danach 👍 für die lustigste Lüge.
 *
 * Punkte (Runde 1 / 2 / Finale): Wahrheit 1000 / 1500 / 2000, pro Reingefallene/n 500 / 750 / 1000, 👍 100.
 * Gezählt wird eine Frage erst, wenn sie ganz aufgedeckt ist.
 *
 * Gefilterte Ansichten: Vor der Auflösung wissen weder Handys noch Bühne, welche Karte die Wahrheit ist oder wer was
 * geschrieben hat – auch nicht über die Kennungen (Buchstaben in der gemischten Reihenfolge). In der Auflösung nur das
 * schon Aufgedeckte.
 *
 * Sprachausgabe: Mit „Vorlesen“ startet die Tipp-Zeit erst, wenn der Laptop Frage und Antworten vorgelesen hat
 * (Aktion read, spätestens nach readMs). In der Auflösung meldet der Laptop mit shown, wenn er fertig gesprochen hat.
 */
(function (root) {
  'use strict';

  const Q = root.EchtJetztQuestions;

  const GAME = 'echt-jetzt';
  const STAGE = 'stage';
  const PLAYER_COLORS = ['#22d3ee', '#fb923c', '#facc15', '#22c55e', '#a855f7', '#f43f5e', '#14b8a6', '#818cf8', '#84cc16', '#ec4899', '#e5e7eb', '#f97316'];
  const MODE_OPTIONS = ['facts', 'dict', 'mixed'];
  const LENGTH_OPTIONS = ['short', 'normal', 'long'];
  const LENGTH_QUESTIONS = { short: 2, normal: 3, long: 4 };
  const LIE_OPTIONS = [45, 60, 90];
  const PICK_OPTIONS = [20, 30, 45];
  const SHOWN_OPTIONS = [0, 6, 8]; // 0 = alle Lügen zeigen
  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 10;
  const MAX_LIE = 40;
  const MAX_LIE_DICT = 80;
  const MIN_LIES = 3; // so viele Lügen stehen mindestens neben der Wahrheit (sonst füllt das Haus auf)
  const ROUNDS = 3; // Runde 1, Runde 2, Finale
  const POINTS = { truth: [1000, 1500, 2000], fooled: [500, 750, 1000], like: 100 };
  const CATEGORY_S = 15;
  const CHECK_S = 45;
  const DICT_EXTRA_S = 15; // Wörterbuch: mehr Zeit zum Schreiben und Tippen
  const GRACE_MS = 1500; // Zeit um: kurz auf die letzten Eingaben der Handys warten
  const REVEAL_MS = { intro: 1400, none: 2600, lie: 3800, truth: 3000, speech: 9000 };
  const SIPS_FELL = 1; // Trinkregeln: pro Lüge, auf die man reingefallen ist
  const SIPS_TRUTH = 1; // Trinkregeln: Wahrheit getippt → verteilen
  const DEFAULT_SETTINGS = {
    mode: 'facts',
    length: 'normal',
    lieTime: 60,
    pickTime: 30,
    chooseCategory: true,
    likes: true,
    maxShown: 0,
    categories: Q.CATEGORY_IDS.slice(),
    speech: true,
    drinks: false,
  };

  function cleanName(name, fallback, max) {
    const s = String(name == null ? '' : name)
      .replace(/[\u0000-\u001f<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max || 24);
    return s || fallback;
  }

  function clone(o) {
    return o == null ? o : JSON.parse(JSON.stringify(o));
  }

  function sanitizeSettings(input, current) {
    const s = Object.assign({}, current || DEFAULT_SETTINGS);
    const i = input || {};
    const num = (v) => (v === null || v === '' || v === undefined ? NaN : +v);
    if (MODE_OPTIONS.includes(i.mode)) s.mode = i.mode;
    if (LENGTH_OPTIONS.includes(i.length)) s.length = i.length;
    if (LIE_OPTIONS.includes(num(i.lieTime))) s.lieTime = num(i.lieTime);
    if (PICK_OPTIONS.includes(num(i.pickTime))) s.pickTime = num(i.pickTime);
    if (SHOWN_OPTIONS.includes(num(i.maxShown))) s.maxShown = num(i.maxShown);
    for (const k of ['chooseCategory', 'likes', 'speech', 'drinks']) if (typeof i[k] === 'boolean') s[k] = i[k];
    if (Array.isArray(i.categories)) s.categories = Q.cleanCategories(i.categories);
    s.categories = Q.cleanCategories(s.categories);
    return s;
  }

  /** Fragen pro Runde: z. B. [3, 3, 1] (das Finale hat immer eine Frage) */
  function roundPlan(settings) {
    const n = LENGTH_QUESTIONS[(settings || DEFAULT_SETTINGS).length] || 3;
    return [n, n, 1];
  }

  function shuffle(list, random) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function keyOf(i) {
    return String.fromCharCode(97 + i); // a, b, c …
  }

  class Engine {
    /**
     * @param {object} state Spielzustand (siehe Engine.create)
     * @param {{onChange?: Function, onKick?: Function, now?: Function, timers?: boolean, random?: Function}} hooks
     *   timers: false schaltet die automatischen Zeitlimits ab (Tests rufen dann tick() selbst auf)
     */
    constructor(state, hooks) {
      this.s = state;
      this.hooks = hooks || {};
      this.now = this.hooks.now || (() => Date.now());
      this.random = this.hooks.random || Math.random;
      this.timer = null;
      this.tick();
      this.armTimer();
    }

    static create(config) {
      return {
        v: 1,
        game: GAME,
        settings: sanitizeSettings((config || {}).settings),
        phase: 'lobby',
        members: {},
        players: [],
        round: 0,
        index: 0, // Frage innerhalb der Runde (0-basiert)
        questions: [], // alle Fragen des Spiels, die letzte ist die aktuelle
        used: [],
        end: null, // Ende der aktuellen Phase (Kategorie, Lügen, Prüfen, Tippen)
        readEnd: null,
        stepEnd: null,
        awards: [],
        startedAt: null,
        endedAt: null,
      };
    }

    static newPlayer(id, name) {
      return { id, name };
    }

    dispose() {
      clearTimeout(this.timer);
      this.timer = null;
    }

    changed() {
      this.armTimer();
      if (this.hooks.onChange) this.hooks.onChange();
    }

    /* Mit Handys wird immer gespielt (StageController öffnet dann einen Raum) */
    get write() {
      return true;
    }

    /* ---------- Hilfsfunktionen ---------- */

    player(pid) {
      return this.s.players.find((p) => p.id === pid) || null;
    }

    playerName(pid) {
      const p = this.player(pid);
      if (p) return p.name;
      const m = this.s.members[pid];
      return m ? m.name : '?';
    }

    colorOf(pid) {
      const i = this.s.players.findIndex((p) => p.id === pid);
      return i < 0 ? '#94a3b8' : PLAYER_COLORS[i % PLAYER_COLORS.length];
    }

    isOnline(pid) {
      const m = this.s.members[pid];
      return !!(m && m.online);
    }

    /** Spielleitung am Handy: das am längsten verbundene Handy, das mitspielt */
    leadPid() {
      let best = null;
      for (const [pid, m] of Object.entries(this.s.members)) {
        if (!m.online || !this.player(pid)) continue;
        if (!best || (m.joined || 0) < best.joined) best = { pid, joined: m.joined || 0 };
      }
      return best ? best.pid : null;
    }

    leads(actor) {
      return actor === STAGE || (actor && actor === this.leadPid());
    }

    plan() {
      return roundPlan(this.s.settings);
    }

    /** Aktuelle Frage */
    cur() {
      return this.s.questions[this.s.questions.length - 1] || null;
    }

    isFinal() {
      return this.s.round === ROUNDS;
    }

    /** Kennung des aktuellen Schritts – Klicks aus einem älteren Schritt werden ignoriert */
    stepKey() {
      return `${this.s.phase}:${this.s.questions.length}`;
    }

    stale(a) {
      return a.step !== undefined && a.step !== this.stepKey();
    }

    /** Wer in der neuen Frage schreibt: alle verbundenen Mitspielenden (sind es zu wenige, alle) */
    activePlayers() {
      const online = this.s.players.filter((p) => this.isOnline(p.id));
      return online.length >= MIN_PLAYERS ? online : this.s.players.slice();
    }

    lieMax(q) {
      return (q || (this.cur() || {}).q || {}).kind === 'dict' ? MAX_LIE_DICT : MAX_LIE;
    }

    lieSeconds(c) {
      return this.s.settings.lieTime + (c && c.q && c.q.kind === 'dict' ? DICT_EXTRA_S : 0);
    }

    pickSeconds(c) {
      return this.s.settings.pickTime + (c && c.q && c.q.kind === 'dict' ? DICT_EXTRA_S : 0) + (c && c.final ? 10 : 0);
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
        // Wer neu dazukommt, spielt mit (mitten in einer Frage: tippen ja, lügen ab der nächsten) – ab 11 schaut man zu
        if (s.phase !== 'end' && s.players.length < MAX_PLAYERS) s.players.push(Engine.newPlayer(pid, s.members[pid].name));
      }
      const p = this.player(pid);
      if (p) p.name = s.members[pid].name;
      this.changed();
    }

    disconnect(pid) {
      const m = this.s.members[pid];
      if (!m || !m.online) return;
      m.online = false;
      m.offlineAt = this.now();
      this.changed();
    }

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
      s.round = 1;
      s.index = 0;
      s.questions = [];
      s.used = [];
      s.awards = [];
      s.startedAt = this.now();
      s.endedAt = null;
      this.newQuestion();
    }

    /** Neue Frage: erst Kategorie wählen (wenn eingeschaltet und es eine Wahl gibt), sonst gleich lügen */
    newQuestion() {
      const s = this.s;
      const active = this.activePlayers().map((p) => p.id);
      const c = {
        id: `q${s.questions.length + 1}`,
        round: s.round,
        index: s.index,
        final: this.isFinal(),
        chooser: null,
        offer: [],
        cat: null,
        q: null,
        pids: active,
        lies: {},
        rejected: {},
        options: [],
        base: null,
        dropped: [],
        hits: [],
        picks: {},
        likes: {},
        steps: [],
        shown: 0,
        done: false,
      };
      s.questions.push(c);
      s.readEnd = null;
      s.stepEnd = null;
      const choices = Q.modeCategories(s.settings);
      if (s.settings.chooseCategory && !c.final && choices.length > 1) {
        c.offer = Q.offer(s.settings, s.used, this.random, 3);
        if (c.offer.length > 1) {
          c.chooser = this.nextChooser(active);
          s.phase = 'category';
          s.end = this.now() + CATEGORY_S * 1000;
          return;
        }
      }
      this.chooseCategory(c.offer[0] || Q.randomCategory(s.settings, s.used, this.random));
    }

    /** Reihum: wer zuletzt gewählt hat, kommt erst wieder dran, wenn alle anderen dran waren */
    nextChooser(active) {
      const online = active.filter((pid) => this.isOnline(pid));
      const list = online.length ? online : active;
      if (!list.length) return null;
      const count = {};
      for (const pid of list) count[pid] = 0;
      let last = null;
      for (const c of this.s.questions) {
        if (!c.chooser) continue;
        if (c.chooser in count) count[c.chooser] += 1;
        last = c.chooser;
      }
      const min = Math.min(...list.map((pid) => count[pid]));
      const cands = list.filter((pid) => count[pid] === min && pid !== last);
      return (cands.length ? cands : list.filter((pid) => count[pid] === min))[0];
    }

    chooseCategory(cat) {
      const s = this.s;
      const c = this.cur();
      c.cat = cat;
      const q = Q.draw(cat, s.used, this.random);
      c.q = { id: q.id, cat: q.cat, kind: q.kind, text: q.text, truth: q.truth, forms: q.forms.slice(), decoys: q.decoys.slice(), source: q.source };
      c.cat = q.cat;
      s.phase = 'lie';
      s.end = this.now() + this.lieSeconds(c) * 1000;
    }

    /** Haben alle geschrieben? Auch auf kurz Getrennte (gesperrtes Handy) wird gewartet. */
    lyingDone() {
      const c = this.cur();
      return !!c && c.pids.length > 0 && c.pids.every((pid) => c.lies[pid]);
    }

    finishLying() {
      const s = this.s;
      const c = this.cur();
      s.end = null;
      this.buildOptions(c);
      if (c.q.kind === 'dict') {
        s.phase = 'check';
        s.end = this.now() + CHECK_S * 1000;
      } else this.startPick();
    }

    /**
     * Karten bauen: gleiche Lügen zusammenlegen, fehlende durch Lügen vom Haus ersetzen, ggf. kürzen, Wahrheit dazu,
     * einmal mischen und Buchstaben vergeben.
     */
    buildOptions(c) {
      const s = this.s;
      const q = c.q;
      const lies = [];
      for (const pid of c.pids) {
        const text = c.lies[pid];
        if (!text) continue;
        const same = lies.find((o) => Q.same(o.text, text));
        if (same) same.authors.push(pid);
        else lies.push({ text, authors: [pid] });
      }
      const missing = c.pids.filter((pid) => !c.lies[pid]).length;
      const decoys = shuffle(q.decoys, this.random).filter((d) => !Q.tooClose(d, q) && !lies.some((o) => Q.same(o.text, d)));
      const house = [];
      const wantHouse = Math.max(missing, MIN_LIES - lies.length);
      while (house.length < wantHouse && decoys.length) house.push({ text: decoys.shift(), authors: [], house: true });
      let shown = lies.concat(house);
      const max = s.settings.maxShown;
      if (max && shown.length > max) {
        // Zuerst Lügen vom Haus weglassen, dann zufällige Lügen der Spielenden
        while (shown.length > max && shown.some((o) => o.house)) shown.splice(shown.findIndex((o) => o.house), 1);
        if (shown.length > max) {
          const keep = shuffle(shown, this.random).slice(0, max);
          for (const o of shown) if (!keep.includes(o)) c.dropped.push(...o.authors);
          shown = shown.filter((o) => keep.includes(o));
        }
      }
      const all = shuffle(shown.concat({ text: Q.tidy(q.truth, q.kind), authors: [], truth: true }), this.random);
      c.options = all.map((o, i) => ({ key: keyOf(i), text: o.text, authors: o.authors.slice(), house: !!o.house, truth: !!o.truth }));
      c.base = clone(c.options);
      c.hits = [];
    }

    option(c, key) {
      return (c && c.options.find((o) => o.key === key)) || null;
    }

    truthOption(c) {
      return (c && c.options.find((o) => o.truth)) || null;
    }

    startPick() {
      const s = this.s;
      const c = this.cur();
      s.phase = 'pick';
      s.end = null;
      if (s.settings.speech) {
        s.readEnd = this.now() + this.readMs(c);
        return;
      }
      this.startPickTimer();
    }

    /** Höchstens so lange wartet das Tippen auf die Sprachausgabe */
    readMs(c) {
      return Math.min(60000, 8000 + 3500 * c.options.length + (c.q.kind === 'dict' ? 1500 * c.options.length : 0));
    }

    startPickTimer() {
      const s = this.s;
      s.readEnd = null;
      s.end = this.now() + this.pickSeconds(this.cur()) * 1000;
      if (this.pickingDone()) this.startReveal();
    }

    /** Wer tippt: alle verbundenen Mitspielenden, außer wer die Wahrheit schon getroffen hat */
    pickers() {
      const c = this.cur();
      return this.s.players.map((p) => p.id).filter((pid) => this.isOnline(pid) && !(c && c.hits.includes(pid)));
    }

    /** Wie viele Tipps braucht diese Person? (Finale 2, sonst 1 – aber nie mehr, als Karten wählbar sind) */
    slotsFor(c, pid) {
      const free = c.options.filter((o) => !o.authors.includes(pid)).length;
      return Math.min(c.final ? 2 : 1, free);
    }

    hasPicked(c, pid) {
      const p = c.picks[pid] || [];
      const need = this.slotsFor(c, pid);
      for (let i = 0; i < need; i++) if (!p[i]) return false;
      return true;
    }

    pickingDone() {
      const c = this.cur();
      const list = this.pickers();
      return !!c && list.length > 0 && list.every((pid) => this.hasPicked(c, pid));
    }

    /** Aufdecken: erst alle Lügen ohne Reingefallene, dann jede Lüge mit Reingefallenen (wenige zuerst), zuletzt die Wahrheit */
    startReveal() {
      const s = this.s;
      const c = this.cur();
      s.phase = 'reveal';
      s.end = null;
      s.readEnd = null;
      const fell = (o) => Object.values(c.picks).filter((p) => p.includes(o.key)).length;
      const lies = c.options.filter((o) => !o.truth);
      const none = lies.filter((o) => !fell(o));
      const some = lies.filter((o) => fell(o) > 0).sort((a, b) => fell(a) - fell(b) || c.options.indexOf(a) - c.options.indexOf(b));
      c.steps = [];
      if (none.length) c.steps.push({ kind: 'none', keys: none.map((o) => o.key) });
      for (const o of some) c.steps.push({ kind: o.house ? 'house' : 'lie', keys: [o.key] });
      c.steps.push({ kind: 'truth', keys: [this.truthOption(c).key] });
      c.shown = 0;
      c.done = false;
      s.stepEnd = this.now() + REVEAL_MS.intro;
    }

    /** Wie lange ein aufgedeckter Schritt stehen bleibt (mit Sprachausgabe: bis der Laptop „shown“ meldet) */
    stepMs(step) {
      if (this.s.settings.speech && step.kind !== 'none') return REVEAL_MS.speech;
      if (step.kind === 'none') return REVEAL_MS.none;
      return step.kind === 'truth' ? REVEAL_MS.truth : REVEAL_MS.lie;
    }

    revealNext() {
      const s = this.s;
      const c = this.cur();
      if (!c || c.done) return;
      c.shown += 1;
      if (c.shown >= c.steps.length) {
        c.shown = c.steps.length;
        c.done = true;
        s.stepEnd = null;
      } else s.stepEnd = this.now() + this.stepMs(c.steps[c.shown - 1]);
    }

    revealAll() {
      const c = this.cur();
      c.shown = c.steps.length;
      c.done = true;
      this.s.stepEnd = null;
    }

    /** Nach der Frage: nächste Frage, Zwischenstand oder Spielende */
    afterQuestion() {
      const s = this.s;
      const plan = this.plan();
      if (s.index < plan[s.round - 1] - 1) {
        s.index += 1;
        this.newQuestion();
      } else if (s.round >= ROUNDS) this.finish();
      else {
        s.phase = 'scores';
        s.end = null;
      }
    }

    nextRound() {
      const s = this.s;
      s.round += 1;
      s.index = 0;
      this.newQuestion();
    }

    finish() {
      const s = this.s;
      s.phase = 'end';
      s.endedAt = this.now();
      s.end = null;
      s.readEnd = null;
      s.stepEnd = null;
      s.awards = this.computeAwards();
      this.dispose();
    }

    /* ---------- Wertung ---------- */

    /**
     * Ergebnis einer Frage.
     * @returns {{gains: Object<string, {truth, fooled, fooledN, likes, likesN, total}>, fell: Object<string, number>, truthBy: string[]}}
     */
    questionResult(c) {
      const r = c.round - 1;
      const gains = {};
      const g = (pid) => (gains[pid] = gains[pid] || { truth: 0, fooled: 0, fooledN: 0, likes: 0, likesN: 0, total: 0 });
      const fell = {};
      const truthBy = [];
      for (const p of this.s.players) g(p.id);
      for (const pid of c.hits) {
        g(pid).truth += POINTS.truth[r];
        truthBy.push(pid);
      }
      for (const [pid, picks] of Object.entries(c.picks)) {
        if (c.hits.includes(pid)) continue;
        picks.forEach((key, slot) => {
          const o = this.option(c, key);
          if (!o || o.authors.includes(pid)) return;
          const factor = slot === 0 ? 1 : 0.5;
          if (o.truth) {
            g(pid).truth += Math.round(POINTS.truth[r] * factor);
            if (slot === 0) truthBy.push(pid);
          } else {
            fell[pid] = (fell[pid] || 0) + 1;
            for (const a of o.authors) {
              g(a).fooled += Math.round(POINTS.fooled[r] * factor);
              g(a).fooledN += 1;
            }
          }
        });
      }
      for (const [pid, key] of Object.entries(c.likes)) {
        const o = this.option(c, key);
        if (!o || o.truth || o.authors.includes(pid)) continue;
        for (const a of o.authors) {
          g(a).likes += POINTS.like;
          g(a).likesN += 1;
        }
      }
      for (const x of Object.values(gains)) x.total = x.truth + x.fooled + x.likes;
      return { gains, fell, truthBy };
    }

    /** Punkte einer Frage (nur ganz aufgedeckte zählen) */
    questionGains(c) {
      const out = {};
      if (!c || !c.done) return out;
      for (const [pid, x] of Object.entries(this.questionResult(c).gains)) out[pid] = x.total;
      return out;
    }

    totals() {
      const t = {};
      for (const p of this.s.players) t[p.id] = 0;
      for (const c of this.s.questions) for (const [pid, n] of Object.entries(this.questionGains(c))) t[pid] = (t[pid] || 0) + n;
      return t;
    }

    roundGains(round) {
      const t = {};
      for (const c of this.s.questions) if (c.round === round) for (const [pid, n] of Object.entries(this.questionGains(c))) t[pid] = (t[pid] || 0) + n;
      return t;
    }

    standings() {
      const t = this.totals();
      const sorted = this.s.players.slice().sort((a, b) => t[b.id] - t[a.id]);
      return sorted.map((p) => ({ id: p.id, name: p.name, score: t[p.id], place: sorted.findIndex((x) => t[x.id] === t[p.id]) + 1 }));
    }

    /** Trinkregeln: pro Lüge, auf die man reingefallen ist, 1 Schluck · Wahrheit (erster Tipp) → 1 verteilen */
    questionSips(c) {
      if (!this.s.settings.drinks || !c.done) return null;
      const res = this.questionResult(c);
      const sips = {};
      for (const [pid, n] of Object.entries(res.fell)) sips[pid] = n * SIPS_FELL;
      const give = res.truthBy.filter((pid) => this.player(pid)).map((pid) => ({ pid, n: SIPS_TRUTH }));
      return { sips, give };
    }

    /* ---------- Zeitlimit ---------- */

    nextDeadline() {
      const s = this.s;
      if (s.phase === 'lie' && s.end) return s.end + GRACE_MS;
      if (s.phase === 'pick') return s.readEnd || s.end || null;
      if (s.phase === 'reveal') return s.stepEnd || null;
      if (s.phase === 'category' || s.phase === 'check') return s.end || null;
      return null;
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

    /** Abgelaufene Zeit auswerten. Gibt true zurück, wenn sich etwas geändert hat. */
    tick() {
      const s = this.s;
      let changed = false;
      for (let guard = 0; guard < 40; guard++) {
        const now = this.now();
        if (s.phase === 'category' && s.end && s.end <= now) this.chooseCategory(this.randomOffer());
        else if (s.phase === 'lie' && s.end && s.end + GRACE_MS <= now) this.finishLying();
        else if (s.phase === 'check' && s.end && s.end <= now) this.startPick();
        else if (s.phase === 'pick' && s.readEnd && s.readEnd <= now) this.startPickTimer();
        else if (s.phase === 'pick' && s.end && s.end <= now) this.startReveal();
        else if (s.phase === 'reveal' && s.stepEnd && s.stepEnd <= now) this.revealNext();
        else break;
        changed = true;
      }
      return changed;
    }

    randomOffer() {
      const c = this.cur();
      return c.offer[Math.floor(this.random() * c.offer.length)];
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
      if (actor !== STAGE || this.s.phase !== 'lobby') return false;
      this.s.settings = sanitizeSettings(a.settings, this.s.settings);
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
        s.players.push(Engine.newPlayer(actor, s.members[actor].name));
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
      const c = this.cur();
      if (c && !c.done) {
        c.pids = c.pids.filter((x) => x !== pid);
        delete c.lies[pid];
        delete c.rejected[pid];
        delete c.picks[pid];
        c.hits = c.hits.filter((x) => x !== pid);
        for (const o of c.options) o.authors = o.authors.filter((x) => x !== pid);
        if (c.base) for (const o of c.base) o.authors = o.authors.filter((x) => x !== pid);
        if (c.chooser === pid) c.chooser = this.nextChooser(c.pids);
      }
      if (c) delete c.likes[pid];
      // Wenn jetzt alle fertig sind, geht es weiter
      if (s.phase === 'lie' && this.lyingDone()) this.finishLying();
      else if (s.phase === 'pick' && !s.readEnd && this.pickingDone()) this.startReveal();
      return true;
    }

    lobbyProblem() {
      const here = this.s.players.filter((p) => this.isOnline(p.id));
      if (here.length < MIN_PLAYERS) return `Ihr braucht mindestens ${MIN_PLAYERS} Personen – scannt den QR-Code!`;
      return null;
    }

    on_start(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby' || this.lobbyProblem()) return false;
      s.players = s.players.filter((p) => this.isOnline(p.id));
      this.startGame();
      return true;
    }

    /* Kategorie */

    /** {cat} – wer dran ist (oder die Spielleitung) wählt eine der angebotenen Kategorien */
    on_category(a, actor) {
      const s = this.s;
      const c = this.cur();
      if (s.phase !== 'category' || !c || !c.offer.includes(a.cat)) return false;
      if (actor !== c.chooser && !this.leads(actor)) return false;
      this.chooseCategory(a.cat);
      return true;
    }

    /* Lügen */

    /** {target: Fragen-ID, text} – leer = zurückziehen. Zu nah an der Wahrheit → abgelehnt (rejected). */
    on_lie(a, actor) {
      const s = this.s;
      const c = this.cur();
      if (s.phase !== 'lie' || !c || a.target !== c.id || !c.pids.includes(actor)) return false;
      const text = Q.tidy(String(a.text == null ? '' : a.text).slice(0, this.lieMax(c.q)), c.q.kind);
      if (!text) {
        if (!c.lies[actor] && !c.rejected[actor]) return false;
        delete c.lies[actor];
        delete c.rejected[actor];
        return true;
      }
      if (Q.tooClose(text, c.q)) {
        if (c.rejected[actor] === text && !c.lies[actor]) return false;
        c.rejected[actor] = text;
        delete c.lies[actor];
        return true;
      }
      if (c.lies[actor] === text && !c.rejected[actor]) return false;
      c.lies[actor] = text;
      delete c.rejected[actor];
      if (this.lyingDone()) this.finishLying();
      return true;
    }

    /* Prüfen (Wörterbuch) */

    /**
     * Spielleitung: zwei Karten meinen dasselbe – {from, into}. Ist eine davon die Wahrheit, bleibt die Wahrheit stehen und
     * wer die Lüge geschrieben hat, hat die Wahrheit getroffen.
     */
    on_merge(a, actor) {
      const s = this.s;
      const c = this.cur();
      if (s.phase !== 'check' || !this.leads(actor) || a.from === a.into) return false;
      const from = this.option(c, a.from);
      const into = this.option(c, a.into);
      if (!from || !into) return false;
      // Die Spielleitung am Handy darf die eigene Erklärung nicht verschieben
      if (actor !== STAGE && (from.authors.includes(actor) || into.authors.includes(actor))) return false;
      let keep = into;
      let gone = from;
      if (from.truth) {
        keep = from;
        gone = into;
      }
      if (keep.truth) {
        for (const pid of gone.authors) if (!c.hits.includes(pid)) c.hits.push(pid);
      } else {
        keep.authors = keep.authors.concat(gone.authors.filter((pid) => !keep.authors.includes(pid)));
        keep.house = keep.house && gone.house;
      }
      c.options = c.options.filter((o) => o !== gone);
      return true;
    }

    /** Spielleitung: Zusammenlegen rückgängig */
    on_unmerge(a, actor) {
      const s = this.s;
      const c = this.cur();
      if (s.phase !== 'check' || !this.leads(actor) || !c.base || c.options.length === c.base.length) return false;
      c.options = clone(c.base);
      c.hits = [];
      return true;
    }

    /* Tippen */

    /** {target, key, slot} – nicht die eigene Lüge; slot 1 (zweiter Tipp) nur im Finale. Umentscheiden geht. */
    on_pick(a, actor) {
      const s = this.s;
      const c = this.cur();
      if (s.phase !== 'pick' || !c || a.target !== c.id || !this.player(actor) || c.hits.includes(actor)) return false;
      const slot = a.slot === undefined ? 0 : +a.slot;
      if (![0, 1].includes(slot) || slot >= this.slotsFor(c, actor)) return false;
      const o = this.option(c, a.key);
      if (!o || o.authors.includes(actor)) return false;
      const p = (c.picks[actor] || []).slice();
      if (p[slot] === a.key) return false;
      const other = 1 - slot;
      if (p[other] === a.key) p[other] = p[slot] || null; // tauschen
      p[slot] = a.key;
      while (p.length && !p[p.length - 1]) p.pop();
      c.picks[actor] = p;
      if (!s.readEnd && this.pickingDone()) this.startReveal();
      return true;
    }

    /** Laptop: fertig vorgelesen – die Tipp-Zeit läuft */
    on_read(a, actor) {
      const s = this.s;
      const c = this.cur();
      if (actor !== STAGE || s.phase !== 'pick' || !s.readEnd || !c || a.target !== c.id) return false;
      this.startPickTimer();
      return true;
    }

    /* Auflösung */

    /** Laptop: Schritt fertig gezeigt/vorgelesen – {target, shown} */
    on_shown(a, actor) {
      const s = this.s;
      const c = this.cur();
      if (actor !== STAGE || s.phase !== 'reveal' || !c || c.done || a.target !== c.id || +a.shown !== c.shown || !c.shown) return false;
      this.revealNext();
      return true;
    }

    /** 👍 für eine Lüge (nach dem Aufdecken) – {target, key}; nochmal auf dieselbe nimmt es zurück */
    on_like(a, actor) {
      const s = this.s;
      const c = this.cur();
      if (!s.settings.likes || s.phase !== 'reveal' || !c || !c.done || a.target !== c.id || !this.player(actor)) return false;
      const o = this.option(c, a.key);
      if (!o || o.truth || o.house || !o.authors.length || o.authors.includes(actor)) return false;
      if (c.likes[actor] === a.key) delete c.likes[actor];
      else c.likes[actor] = a.key;
      return true;
    }

    /* Weiter */

    /**
     * Weiter. force: Kategorie zufällig, Lügen/Tippen sofort beenden, Prüfen beenden, Auflösung überspringen.
     * step (optional): nur, wenn der Klick zum aktuellen Schritt gehört.
     */
    on_next(a, actor) {
      const s = this.s;
      if (!this.leads(actor) || this.stale(a)) return false;
      switch (s.phase) {
        case 'category':
          if (!a.force) return false;
          this.chooseCategory(this.randomOffer());
          return true;
        case 'lie':
          if (!a.force) return false;
          this.finishLying();
          return true;
        case 'check':
          this.startPick();
          return true;
        case 'pick':
          if (!a.force) return false;
          this.startReveal();
          return true;
        case 'reveal':
          if (!this.cur().done) {
            if (!a.force) return false;
            this.revealAll();
            return true;
          }
          this.afterQuestion();
          return true;
        case 'scores':
          this.nextRound();
          return true;
      }
      return false;
    }

    on_end(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase === 'lobby' || s.phase === 'end') return false;
      this.finish();
      return true;
    }

    /** Nochmal mit denselben Leuten */
    on_again(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'end') return false;
      s.phase = 'lobby';
      s.round = 0;
      s.index = 0;
      s.questions = [];
      s.used = [];
      s.awards = [];
      s.players = s.players.filter((p) => s.members[p.id]);
      return true;
    }

    /* ---------- Statistik ---------- */

    playerStats() {
      const st = {};
      for (const p of this.s.players) st[p.id] = { fooled: 0, truths: 0, fell: 0, likes: 0, points: 0 };
      for (const c of this.s.questions) {
        if (!c.done) continue;
        const res = this.questionResult(c);
        for (const [pid, x] of Object.entries(res.gains)) {
          if (!st[pid]) continue;
          st[pid].fooled += x.fooledN;
          st[pid].likes += x.likesN;
          st[pid].points += x.total;
        }
        for (const pid of res.truthBy) if (st[pid]) st[pid].truths += 1;
        for (const [pid, n] of Object.entries(res.fell)) if (st[pid]) st[pid].fell += n;
      }
      return st;
    }

    computeAwards() {
      const s = this.s;
      const out = [];
      if (!s.questions.some((c) => c.done) || s.players.length < 2) return out;
      const st = this.playerStats();
      const best = (key, min) => {
        const top = Math.max(0, ...s.players.map((p) => st[p.id][key]));
        if (top < min) return null;
        return { names: s.players.filter((p) => st[p.id][key] === top).map((p) => p.name), n: top };
      };
      const names = (b) => b.names.join(' & ');
      const liar = best('fooled', 1);
      if (liar) out.push({ icon: '🎭', title: 'Meisterlügner/in', text: `${names(liar)} – ${liar.n} ${liar.n === 1 ? 'Person' : 'Personen'} hereingelegt` });
      const detector = best('truths', 1);
      if (detector) out.push({ icon: '🧐', title: 'Lügendetektor', text: `${names(detector)} – ${detector.n}× die Wahrheit erkannt` });
      const gullible = best('fell', 2);
      if (gullible) out.push({ icon: '🐟', title: 'Leichtgläubig', text: `${names(gullible)} – ${gullible.n}× auf eine Lüge reingefallen` });
      // Beste Lüge: meiste 👍, bei Gleichstand mehr Reingefallene, dann die spätere
      let top = null;
      for (const c of s.questions) {
        if (!c.done) continue;
        for (const o of c.options) {
          if (o.truth || !o.authors.length) continue;
          const likes = Object.values(c.likes).filter((k) => k === o.key).length;
          const fell = Object.values(c.picks).filter((p) => p.includes(o.key)).length;
          if (likes && (!top || likes > top.likes || (likes === top.likes && fell >= top.fell))) top = { likes, fell, o, c };
        }
      }
      if (top) out.push({ icon: '😂', title: 'Beste Lüge', text: `„${top.o.text}“ – ${top.o.authors.map((pid) => this.playerName(pid)).join(' & ')} (${top.likes} 👍)`, sub: this.questionLabel(top.c.q) });
      // Lüge, auf die am meisten reingefallen sind
      let fool = null;
      for (const c of s.questions) {
        if (!c.done) continue;
        for (const o of c.options) {
          if (o.truth || !o.authors.length) continue;
          const fell = Object.values(c.picks).filter((p) => p[0] === o.key).length;
          if (fell >= 2 && (!fool || fell >= fool.fell)) fool = { fell, o, c };
        }
      }
      if (fool) out.push({ icon: '🪤', title: 'Die Falle des Abends', text: `„${fool.o.text}“ – ${fool.o.authors.map((pid) => this.playerName(pid)).join(' & ')} (${fool.fell} reingefallen)`, sub: this.questionLabel(fool.c.q) });
      return out;
    }

    questionLabel(q) {
      return q.kind === 'dict' ? `Was bedeutet „${q.text}“?` : q.text;
    }

    /* ---------- Ansicht ---------- */

    timerView() {
      const s = this.s;
      const c = this.cur();
      if (!s.end || !c) return null;
      let sec = 0;
      if (s.phase === 'category') sec = CATEGORY_S;
      else if (s.phase === 'lie') sec = this.lieSeconds(c);
      else if (s.phase === 'check') sec = CHECK_S;
      else if (s.phase === 'pick') sec = this.pickSeconds(c);
      else return null;
      return { total: sec * 1000, remaining: Math.max(0, s.end - this.now()) };
    }

    catInfo(id) {
      const k = Q.category(id);
      return k ? { id: k.id, icon: k.icon, label: k.label, text: k.text } : null;
    }

    questionView(c) {
      if (!c || !c.q) return null;
      return { id: c.id, kind: c.q.kind, text: c.q.text, cat: this.catInfo(c.q.cat) };
    }

    /** Karten für Prüfen und Tippen: nur Text, ob es die eigene ist – keine Herkunft */
    plainOptions(c, viewer) {
      return c.options.map((o) => ({ key: o.key, text: o.text, mine: viewer !== STAGE && o.authors.includes(viewer) }));
    }

    revealView(c, viewer) {
      const stage = viewer === STAGE;
      const revealed = new Set();
      for (let i = 0; i < c.shown; i++) for (const k of c.steps[i].keys) revealed.add(k);
      const person = (pid) => ({ id: pid, name: this.playerName(pid), color: this.colorOf(pid) });
      const res = c.done ? this.questionResult(c) : null;
      const r = c.round - 1;
      const cards = c.options.map((o) => {
        const out = { key: o.key, text: o.text, mine: !stage && o.authors.includes(viewer), revealed: revealed.has(o.key) };
        if (!out.revealed) return out;
        const pickers = [];
        for (const [pid, p] of Object.entries(c.picks)) p.forEach((k, slot) => k === o.key && pickers.push(Object.assign(person(pid), { second: slot === 1 })));
        Object.assign(out, {
          truth: o.truth,
          house: o.house,
          authors: o.authors.map(person),
          pickers,
          hits: o.truth ? c.hits.map(person) : [],
          points: o.truth ? POINTS.truth[r] : POINTS.fooled[r],
        });
        if (c.done) out.likes = Object.values(c.likes).filter((k) => k === o.key).length;
        return out;
      });
      const step = c.shown > 0 ? c.steps[c.shown - 1] : null;
      return {
        shown: c.shown,
        steps: c.steps.length,
        step: step ? { kind: step.kind, keys: step.keys.slice() } : null,
        done: c.done,
        cards,
        order: c.steps.slice(0, c.shown).map((st) => ({ kind: st.kind, keys: st.keys.slice() })),
        truth: c.done ? Q.tidy(c.q.truth, c.q.kind) : null,
        source: c.done ? c.q.source : null,
        gains: c.done ? clone(res.gains) : null,
        sips: this.questionSips(c),
        myLike: stage ? null : c.likes[viewer] || null,
        myPicks: stage ? null : (c.picks[viewer] || []).slice(),
        hit: !stage && c.hits.includes(viewer),
      };
    }

    currentView(viewer) {
      const s = this.s;
      const c = this.cur();
      if (!c || ['lobby', 'scores', 'end'].includes(s.phase)) return null;
      const stage = viewer === STAGE;
      const out = {
        id: c.id,
        round: c.round,
        index: c.index,
        final: c.final,
        no: s.questions.length,
        question: this.questionView(c),
        points: { right: POINTS.truth[c.round - 1], fooled: POINTS.fooled[c.round - 1] },
      };
      if (s.phase === 'category') {
        out.category = {
          chooser: c.chooser,
          chooserName: c.chooser ? this.playerName(c.chooser) : null,
          offer: c.offer.map((id) => this.catInfo(id)),
          mine: !stage && viewer === c.chooser,
        };
      }
      if (s.phase === 'lie') {
        out.lie = {
          progress: c.pids.map((pid) => ({ id: pid, done: !!c.lies[pid] })),
          writing: c.pids.includes(viewer),
          mine: stage ? null : c.lies[viewer] || null,
          rejected: stage ? null : c.rejected[viewer] || null,
          max: this.lieMax(c.q),
        };
      }
      if (s.phase === 'check') {
        out.check = { options: this.plainOptions(c, viewer), merged: c.base ? c.base.length - c.options.length : 0 };
      }
      if (s.phase === 'pick') {
        const pickers = this.pickers();
        out.pick = {
          options: this.plainOptions(c, viewer),
          slots: stage ? (c.final ? 2 : 1) : this.slotsFor(c, viewer),
          myPicks: stage ? null : (c.picks[viewer] || []).slice(),
          canPick: !stage && !!this.player(viewer) && !c.hits.includes(viewer),
          hit: !stage && c.hits.includes(viewer),
          dropped: !stage && c.dropped.includes(viewer),
          done: pickers.filter((pid) => this.hasPicked(c, pid)).length,
          count: pickers.length,
          progress: pickers.map((pid) => ({ id: pid, done: this.hasPicked(c, pid) })),
        };
      }
      if (s.phase === 'reveal') out.reveal = this.revealView(c, viewer);
      return out;
    }

    /** Rückblick am Ende: alle Fragen mit Wahrheit, Lügen und wer reingefallen ist */
    historyView() {
      const name = (pid) => this.playerName(pid);
      return this.s.questions
        .filter((c) => c.done)
        .map((c) => ({
          round: c.round,
          final: c.final,
          kind: c.q.kind,
          text: c.q.text,
          cat: this.catInfo(c.q.cat),
          truth: Q.tidy(c.q.truth, c.q.kind),
          source: c.q.source,
          truthBy: this.questionResult(c).truthBy.map(name),
          lies: c.options
            .filter((o) => !o.truth)
            .map((o) => ({
              text: o.text,
              house: o.house,
              authors: o.authors.map(name),
              fell: Object.entries(c.picks)
                .filter(([, p]) => p.includes(o.key))
                .map(([pid]) => name(pid)),
              likes: Object.values(c.likes).filter((k) => k === o.key).length,
            })),
        }));
    }

    viewFor(viewer) {
      const s = this.s;
      const stage = viewer === STAGE;
      const me = stage ? null : this.player(viewer);
      const totals = this.totals();
      return {
        game: GAME,
        phase: s.phase,
        step: this.stepKey(),
        settings: clone(s.settings),
        players: s.players.map((p, i) => ({ id: p.id, name: p.name, color: PLAYER_COLORS[i % PLAYER_COLORS.length], online: this.isOnline(p.id), score: totals[p.id] || 0 })),
        watchers: Object.entries(s.members)
          .filter(([id]) => !this.player(id))
          .map(([id, m]) => ({ id, name: m.name, online: m.online })),
        round: s.round,
        rounds: ROUNDS,
        plan: this.plan(),
        index: s.index,
        timer: this.timerView(),
        reading: !!s.readEnd,
        cur: this.currentView(viewer),
        gains: s.phase === 'scores' ? this.roundGains(s.round) : null,
        standings: this.standings(),
        lobbyProblem: s.phase === 'lobby' ? this.lobbyProblem() : null,
        awards: clone(s.awards),
        stats: s.phase === 'end' ? this.playerStats() : null,
        history: s.phase === 'end' ? this.historyView() : [],
        startedAt: s.startedAt,
        me: stage
          ? { stage: true }
          : {
              id: viewer,
              name: (s.members[viewer] || {}).name || '',
              playing: !!me,
              lead: viewer === this.leadPid(),
            },
      };
    }
  }

  root.EchtJetztEngine = {
    Engine,
    GAME,
    STAGE,
    PLAYER_COLORS,
    MODE_OPTIONS,
    LENGTH_OPTIONS,
    LENGTH_QUESTIONS,
    LIE_OPTIONS,
    PICK_OPTIONS,
    SHOWN_OPTIONS,
    MIN_PLAYERS,
    MAX_PLAYERS,
    MAX_LIE,
    MAX_LIE_DICT,
    MIN_LIES,
    ROUNDS,
    POINTS,
    CATEGORY_S,
    CHECK_S,
    GRACE_MS,
    REVEAL_MS,
    SIPS_FELL,
    SIPS_TRUTH,
    DEFAULT_SETTINGS,
    sanitizeSettings,
    roundPlan,
    cleanName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
