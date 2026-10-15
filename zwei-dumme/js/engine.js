/*
 * Spiellogik von „2 Dumme, 1 Gedanke“.
 *
 * Zwei Modi:
 *  - kette:   Das Team nennt gleichzeitig Wörter und sucht Runde für Runde ein Wort, das die
 *             letzten Wörter verbindet – bis alle dasselbe sagen. Je schneller, desto mehr Punkte.
 *  - begriff: Alle bekommen einen Begriff, das Team versucht, dasselbe Wort dazu zu nennen.
 *
 * Zwei Spielweisen:
 *  - say:   ohne Handy – die Teams sind nacheinander dran, am Laptop wird das Ergebnis eingetragen
 *  - write: mit Handy – alle Teams gleichzeitig, jeder tippt geheim auf dem eigenen Handy
 *
 * Der Laptop ("stage") ist immer der Host und spielt nicht selbst mit. Handys bekommen nur
 * Ansichten (viewFor) ohne fremde Wörter, solange diese noch nicht aufgedeckt sind.
 */
(function (root) {
  'use strict';

  const M = root.GameMatch;
  const Deck = root.ZDDeck;

  const STAGE = 'stage';
  const TEAMS = [
    { id: 'rot', label: 'Rot' },
    { id: 'blau', label: 'Blau' },
    { id: 'gruen', label: 'Grün' },
    { id: 'gelb', label: 'Gelb' },
  ];
  const MODES = ['kette', 'begriff'];
  const INPUTS = ['say', 'write'];
  const ROUND_OPTIONS = { kette: [3, 5, 8], begriff: [5, 8, 10, 15] };
  const SECONDS_OPTIONS = [0, 15, 20, 30, 45];
  const MAXSTEP_OPTIONS = [5, 8, 10];
  const MODE_DEFAULTS = { kette: { rounds: 5, seconds: 0 }, begriff: { rounds: 8, seconds: 20 } };
  const DEFAULT_SETTINGS = {
    mode: 'begriff',
    input: 'write',
    rounds: 8,
    seconds: 20,
    maxSteps: 8,
    startWords: 'free',
    secondChance: false,
  };
  const KETTE_POINTS = [5, 4, 3, 2]; // Treffer in Runde 1–4, danach 1 Punkt, nicht geschafft 0
  const BEGRIFF_POINTS = { all: 3, second: 2, some: 1, none: 0 };
  const MAX_WORD = 30;
  const MAX_PLAYERS = 12;
  // So lange wird auf jemanden gewartet, dessen Handy kurz die Verbindung verliert (Neuladen, Bildschirm aus …)
  const GRACE_MS = 15000;

  function kettePoints(hit) {
    return hit >= 1 && hit <= KETTE_POINTS.length ? KETTE_POINTS[hit - 1] : 1;
  }

  function cleanName(name, fallback, max) {
    const s = String(name == null ? '' : name)
      .replace(/[\u0000-\u001f<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max || 24);
    return s || fallback;
  }

  function cleanWord(word) {
    return cleanName(word, '', MAX_WORD);
  }

  function clone(o) {
    return o == null ? o : JSON.parse(JSON.stringify(o));
  }

  /**
   * Prüft Einstellungen. Wechselt der Modus gegenüber `current` (z.B. in der Lobby), gelten
   * Rundenzahl und Zeit des neuen Modus – die alten Werte passen meist nicht.
   */
  function sanitizeSettings(input, current) {
    const s = Object.assign({}, current || DEFAULT_SETTINGS);
    const i = input || {};
    const modeChanged = MODES.includes(i.mode) && i.mode !== s.mode;
    if (modeChanged) Object.assign(s, { mode: i.mode }, MODE_DEFAULTS[i.mode]);
    if (INPUTS.includes(i.input)) s.input = i.input;
    if (!modeChanged || !current) {
      if (ROUND_OPTIONS[s.mode].includes(+i.rounds)) s.rounds = +i.rounds;
      if (SECONDS_OPTIONS.includes(+i.seconds)) s.seconds = +i.seconds;
    }
    if (!ROUND_OPTIONS[s.mode].includes(s.rounds)) s.rounds = MODE_DEFAULTS[s.mode].rounds;
    if (MAXSTEP_OPTIONS.includes(+i.maxSteps)) s.maxSteps = +i.maxSteps;
    if (['free', 'given'].includes(i.startWords)) s.startWords = i.startWords;
    if (typeof i.secondChance === 'boolean') s.secondChance = i.secondChance;
    return s;
  }

  function baseTeams() {
    return TEAMS.map((t, i) => ({ id: t.id, label: t.label, name: 'Team ' + t.label, active: i < 2, players: [], score: 0 }));
  }

  class Engine {
    /**
     * @param {object} state Spielzustand (siehe Engine.create)
     * @param {{onChange?: Function, onKick?: Function, now?: Function, timers?: boolean}} hooks
     *   timers: false schaltet die automatischen Zeitlimits ab (Tests rufen dann tick() selbst auf)
     */
    constructor(state, hooks) {
      this.s = state;
      this.hooks = hooks || {};
      this.now = this.hooks.now || (() => Date.now());
      this.timer = null;
      // Nach einem Neuladen: inzwischen abgelaufene Zeitlimits gleich auswerten
      this.tick();
      this.armTimer();
    }

    /**
     * Neues Spiel aus dem Setup.
     * @param {{settings: object, teams: {id, active, name, players?: string[]}[]}} config
     *   Ohne Handy werden die Spielernamen hier eingetragen und das Spiel startet sofort.
     *   Mit Handy beginnt es in der Lobby, die Spieler kommen über ihre Handys dazu.
     */
    static create(config) {
      const settings = sanitizeSettings(config.settings);
      const teams = baseTeams();
      let pid = 0;
      for (const t of teams) {
        const cfg = (config.teams || []).find((c) => c.id === t.id);
        t.active = !!(cfg && cfg.active);
        if (cfg) t.name = cleanName(cfg.name, 'Team ' + t.label);
        if (t.active && settings.input === 'say') {
          const names = (cfg.players || []).slice(0, MAX_PLAYERS);
          while (names.length < 2) names.push('');
          t.players = names.map((n, i) => ({ id: 'p' + ++pid, name: cleanName(n, 'Spieler ' + (i + 1)) }));
        }
      }
      if (!teams.some((t) => t.active)) teams[0].active = true;
      const state = {
        v: 1,
        game: 'zwei-dumme',
        settings,
        phase: 'lobby',
        teams,
        members: {},
        order: [],
        round: 0,
        tiebreak: null,
        cur: null,
        history: [],
        used: [],
        winners: [],
        awards: [],
        startedAt: null,
      };
      if (settings.input === 'say') new Engine(state, { timers: false }).startGame();
      return state;
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

    get write() {
      return this.s.settings.input === 'write';
    }

    team(id) {
      return this.s.teams.find((t) => t.id === id) || null;
    }

    teamOf(pid) {
      return this.s.teams.find((t) => t.players.some((p) => p.id === pid)) || null;
    }

    playerName(pid) {
      for (const t of this.s.teams) {
        const p = t.players.find((x) => x.id === pid);
        if (p) return p.name;
      }
      const m = this.s.members[pid];
      return m ? m.name : '?';
    }

    isOnline(pid) {
      if (!this.write) return true;
      const m = this.s.members[pid];
      return !!(m && m.online);
    }

    /** Wird auf die Eingabe dieses Spielers gewartet? (verbunden oder erst kurz weg) */
    awaited(pid) {
      if (this.isOnline(pid)) return true;
      const m = this.s.members[pid];
      return !!(m && m.offlineAt && this.now() - m.offlineAt < GRACE_MS);
    }

    leaders(ids) {
      const teams = ids.map((id) => this.team(id)).filter(Boolean);
      if (!teams.length) return [];
      const best = Math.max(...teams.map((t) => t.score));
      return teams.filter((t) => t.score === best).map((t) => t.id);
    }

    ranking() {
      return this.s.order
        .map((id) => this.team(id))
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .map((t) => t.id);
    }

    /** Ohne Handy: Reihenfolge der Teams rotiert pro Durchgang, damit nicht immer dasselbe Team anfängt */
    sayQueue(playing) {
      const k = (this.s.round - 1) % playing.length;
      return playing.slice(k).concat(playing.slice(0, k));
    }

    drawTerm() {
      const e = Deck.draw('begriff', this.s.used);
      return { text: e.text, kind: e.kind };
    }

    drawStart() {
      return [Deck.draw('start', this.s.used).text, Deck.draw('start', this.s.used).text];
    }

    /** Kennung des aktuellen Eingabeschritts – verhindert, dass verspätete Eingaben im nächsten Schritt landen */
    stepKey(teamId) {
      const cur = this.s.cur;
      if (!cur) return null;
      if (cur.kind === 'begriff') return `b${cur.no}-${cur.attempt}-${cur.termNo || 0}`;
      const ch = cur.chains[teamId];
      return ch ? `k${cur.no}-${teamId}-${ch.steps.length}` : null;
    }

    /* ---------- Verbindungen (mit Handy) ---------- */

    connect(pid, name) {
      const m = this.s.members[pid];
      if (m) {
        m.online = true;
        delete m.offlineAt;
        if (name) m.name = cleanName(name, m.name);
      } else {
        this.s.members[pid] = { name: cleanName(name, 'Gast'), online: true };
      }
      for (const t of this.s.teams) for (const p of t.players) if (p.id === pid) p.name = this.s.members[pid].name;
      this.changed();
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
      s.order = s.teams.filter((t) => t.active && t.players.length >= 2).map((t) => t.id);
      for (const t of s.teams) t.score = 0;
      s.round = 0;
      s.tiebreak = null;
      s.history = [];
      s.cur = null;
      s.winners = [];
      s.awards = [];
      s.startedAt = this.now();
      this.nextRound();
    }

    nextRound() {
      const s = this.s;
      if (s.round >= s.settings.rounds) {
        const tied = this.leaders(s.tiebreak || s.order);
        if (tied.length > 1) s.tiebreak = tied;
        else {
          this.finish();
          return;
        }
      }
      s.round += 1;
      const playing = (s.tiebreak || s.order).slice();
      if (s.settings.mode === 'kette') this.beginKette(playing);
      else this.beginBegriff(playing);
    }

    finish() {
      const s = this.s;
      s.phase = 'over';
      s.cur = null;
      s.winners = this.leaders(s.order);
      s.awards = this.computeAwards();
      this.dispose();
    }

    startClock(obj) {
      const sec = this.write ? this.s.settings.seconds : 0;
      obj.timerTotal = sec * 1000;
      obj.timerEnd = sec ? this.now() + sec * 1000 : null;
    }

    pushHistory() {
      const cur = clone(this.s.cur);
      delete cur.answers;
      if (cur.chains) for (const ch of Object.values(cur.chains)) delete ch.answers;
      this.s.history.push(cur);
    }

    /* ---------- Modus „Ein Begriff“ ---------- */

    beginBegriff(playing) {
      const s = this.s;
      const cur = { kind: 'begriff', no: s.round, tiebreak: !!s.tiebreak, teams: playing, attempt: 1, results: {}, termNo: 0 };
      if (this.write) {
        cur.term = this.drawTerm();
        cur.active = playing.slice();
        cur.participants = {};
        for (const id of playing) cur.participants[id] = this.team(id).players.map((p) => p.id);
        cur.answers = {};
        this.startClock(cur);
      } else {
        cur.queue = this.sayQueue(playing);
        cur.idx = 0;
        cur.team = cur.queue[0];
        cur.term = this.drawTerm();
        cur.terms = { [cur.team]: cur.term };
      }
      s.cur = cur;
      s.phase = 'play';
    }

    /** Wörter eines Teams für die Auswertung: wer geantwortet hat oder noch verbunden ist */
    collectWords(pids, answers) {
      return pids
        .filter((pid) => answers[pid] !== undefined || this.isOnline(pid))
        .map((pid) => ({ pid, name: this.playerName(pid), word: answers[pid] || '' }));
    }

    begriffComplete() {
      const cur = this.s.cur;
      let any = false;
      for (const id of cur.active) {
        for (const pid of cur.participants[id]) {
          if (cur.answers[pid] !== undefined) any = true;
          else if (this.awaited(pid)) return false;
        }
      }
      return any;
    }

    evaluateBegriff() {
      const s = this.s;
      const cur = s.cur;
      for (const id of cur.active) {
        const words = this.collectWords(cur.participants[id], cur.answers);
        const res = M.assess(words.map((w) => w.word));
        if (cur.attempt === 1) {
          const r = (cur.results[id] = { words, outcome: res.outcome, groups: res.groups, points: 0, final: false });
          if (res.outcome === 'all') r.points = BEGRIFF_POINTS.all;
          if (res.outcome === 'all' || !s.settings.secondChance) {
            if (res.outcome !== 'all') r.points = BEGRIFF_POINTS[res.outcome];
            r.final = true;
            this.team(id).score += r.points;
          }
        } else {
          const r = cur.results[id];
          r.second = { words, outcome: res.outcome, groups: res.groups };
          r.points = res.outcome === 'all' ? BEGRIFF_POINTS.second : BEGRIFF_POINTS[r.outcome];
          r.final = true;
          this.team(id).score += r.points;
        }
      }
      cur.answers = {};
      cur.timerEnd = null;
      s.phase = 'reveal';
    }

    /** Ohne Handy: Ergebnis des Teams, das dran ist, wurde am Laptop eingetragen */
    sayBegriffResult(outcome) {
      const s = this.s;
      const cur = s.cur;
      const id = cur.team;
      let r = cur.results[id];
      if (cur.attempt === 1) {
        r = cur.results[id] = { term: cur.term, outcome, points: 0 };
        if (outcome !== 'all' && s.settings.secondChance) {
          cur.attempt = 2;
          return;
        }
        r.points = BEGRIFF_POINTS[outcome];
      } else {
        r.second = { outcome: outcome === 'all' ? 'all' : 'none' };
        r.points = outcome === 'all' ? BEGRIFF_POINTS.second : BEGRIFF_POINTS[r.outcome];
      }
      this.team(id).score += r.points;
      cur.last = { team: id, points: r.points, outcome: r.second ? r.second.outcome : r.outcome, n: (cur.last ? cur.last.n : 0) + 1 };
      cur.idx += 1;
      if (cur.idx < cur.queue.length) {
        cur.team = cur.queue[cur.idx];
        cur.attempt = 1;
        cur.term = this.drawTerm();
        cur.terms[cur.team] = cur.term;
      } else {
        cur.team = null;
        s.phase = 'summary';
        this.pushHistory();
      }
    }

    /* ---------- Modus „Gedankenkette“ ---------- */

    beginKette(playing) {
      const s = this.s;
      const given = s.settings.startWords === 'given';
      const shared = this.write && given ? this.drawStart() : null;
      const cur = { kind: 'kette', no: s.round, tiebreak: !!s.tiebreak, teams: playing, chains: {} };
      for (const id of playing) {
        cur.chains[id] = {
          players: this.team(id).players.map((p) => p.id),
          start: shared,
          steps: [],
          answers: {},
          done: false,
          hit: null,
          points: 0,
          timerEnd: null,
          timerTotal: 0,
        };
        if (this.write) this.startClock(cur.chains[id]);
      }
      if (!this.write) {
        cur.queue = this.sayQueue(playing);
        cur.idx = 0;
        cur.team = cur.queue[0];
        if (given) cur.chains[cur.team].start = this.drawStart();
      }
      s.cur = cur;
      s.phase = 'play';
    }

    /** Alle bisher genannten Wörter einer Kette (inkl. Startwörter) – die sind gesperrt */
    chainWords(ch) {
      const out = (ch.start || []).slice();
      for (const st of ch.steps) for (const w of st.words) if (w.word) out.push(w.word);
      return out;
    }

    chainReady(ch) {
      if (ch.done) return false;
      const present = ch.players.filter((pid) => this.awaited(pid) || ch.answers[pid] !== undefined);
      if (present.length < 2) return false;
      return present.every((pid) => ch.answers[pid] !== undefined);
    }

    /** Eine Runde der Kette aufdecken */
    revealStep(teamId, words, verdict) {
      const s = this.s;
      const ch = s.cur.chains[teamId];
      const res = M.assess(words.map((w) => w.word));
      const outcome = verdict === 'same' ? 'all' : verdict === 'diff' && res.outcome === 'all' ? 'none' : res.outcome;
      ch.steps.push({ words, outcome, groups: res.groups });
      ch.answers = {};
      if (outcome === 'all') {
        ch.done = true;
        ch.hit = ch.steps.length;
        ch.points = kettePoints(ch.hit);
        this.team(teamId).score += ch.points;
      } else if (ch.steps.length >= s.settings.maxSteps) {
        ch.done = true;
        ch.points = 0;
      }
      if (ch.done) ch.timerEnd = null;
      else this.startClock(ch);
    }

    finishChain(teamId) {
      const ch = this.s.cur.chains[teamId];
      if (ch.done) return;
      ch.done = true;
      ch.points = 0;
      ch.gaveUp = true;
      ch.answers = {};
      ch.timerEnd = null;
    }

    afterChain() {
      const s = this.s;
      const cur = s.cur;
      if (!this.write) {
        const ch = cur.chains[cur.team];
        if (!ch.done) return;
        cur.last = { team: cur.team, points: ch.points, hit: ch.hit, n: (cur.last ? cur.last.n : 0) + 1 };
        cur.idx += 1;
        if (cur.idx < cur.queue.length) {
          cur.team = cur.queue[cur.idx];
          if (s.settings.startWords === 'given') cur.chains[cur.team].start = this.drawStart();
          return;
        }
        cur.team = null;
      }
      if (Object.values(cur.chains).every((ch) => ch.done)) {
        s.phase = 'summary';
        this.pushHistory();
      }
    }

    /** Mit Handy: prüfen, ob irgendwo alle geantwortet haben (z.B. nachdem jemand gegangen ist) */
    checkProgress() {
      const s = this.s;
      if (s.phase !== 'play' || !s.cur || !this.write) return;
      if (s.cur.kind === 'begriff') {
        if (this.begriffComplete()) this.evaluateBegriff();
        return;
      }
      for (const [id, ch] of Object.entries(s.cur.chains)) {
        if (this.chainReady(ch)) this.revealStep(id, this.collectWords(ch.players, ch.answers));
      }
      this.afterChain();
    }

    /* ---------- Zeitlimit (mit Handy) ---------- */

    nextDeadline() {
      const s = this.s;
      if (s.phase !== 'play' || !s.cur || !this.write) return null;
      const ends = [];
      const waitFor = (pids, answers) => {
        for (const pid of pids) {
          const m = s.members[pid];
          if (answers[pid] === undefined && m && !m.online && m.offlineAt) ends.push(m.offlineAt + GRACE_MS);
        }
      };
      if (s.cur.kind === 'begriff') {
        if (s.cur.timerEnd) ends.push(s.cur.timerEnd);
        for (const id of s.cur.active) waitFor(s.cur.participants[id], s.cur.answers);
      } else {
        for (const ch of Object.values(s.cur.chains)) {
          if (ch.done) continue;
          if (ch.timerEnd) ends.push(ch.timerEnd);
          waitFor(ch.players, ch.answers);
        }
      }
      const future = ends.filter((t) => t > this.now());
      return future.length ? Math.min(...future) : null;
    }

    armTimer() {
      clearTimeout(this.timer);
      this.timer = null;
      if (this.hooks.timers === false) return;
      const next = this.nextDeadline();
      if (next == null) return;
      this.timer = setTimeout(() => {
        if (this.tick()) this.changed();
        else this.armTimer();
      }, Math.max(0, next - this.now()) + 30);
    }

    /** Abgelaufene Zeitlimits auswerten. Gibt true zurück, wenn sich etwas geändert hat. */
    tick() {
      const s = this.s;
      if (s.phase !== 'play' || !s.cur || !this.write) return false;
      const now = this.now();
      const before = this.progressSig();
      if (s.cur.kind === 'begriff') {
        if (s.cur.timerEnd && s.cur.timerEnd <= now) this.evaluateBegriff();
      } else {
        let stepped = false;
        for (const [id, ch] of Object.entries(s.cur.chains)) {
          if (ch.done || !ch.timerEnd || ch.timerEnd > now) continue;
          this.revealStep(id, this.collectWords(ch.players, ch.answers));
          stepped = true;
        }
        if (stepped) this.afterChain();
      }
      // Schonfrist für getrennte Spieler abgelaufen? Dann ohne sie weiter
      this.checkProgress();
      return this.progressSig() !== before;
    }

    /** Kurzer Fingerabdruck des Spielfortschritts (für tick) */
    progressSig() {
      const s = this.s;
      const cur = s.cur;
      if (!cur) return s.phase;
      if (cur.kind === 'begriff') return `${s.phase}|${cur.no}|${cur.attempt}|${Object.keys(cur.results).length}`;
      return `${s.phase}|${cur.no}|${Object.values(cur.chains)
        .map((ch) => ch.steps.length + (ch.done ? 'd' : ''))
        .join(',')}`;
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

    /* Lobby (mit Handy) */

    on_joinTeam(a, actor) {
      const s = this.s;
      if (!this.write || actor === STAGE) return false;
      const m = s.members[actor];
      if (!m) return false;
      const target = a.team ? this.team(a.team) : null;
      if (target && (!target.active || target.players.length >= MAX_PLAYERS)) return false;
      if (s.phase === 'lobby') {
        for (const t of s.teams) t.players = t.players.filter((p) => p.id !== actor);
        if (target) target.players.push({ id: actor, name: m.name });
        return true;
      }
      // Im laufenden Spiel darf man noch einem mitspielenden Team beitreten (ab der nächsten Runde dabei)
      if (s.phase === 'over' || !target || !s.order.includes(target.id) || this.teamOf(actor)) return false;
      target.players.push({ id: actor, name: m.name });
      return true;
    }

    on_kick(a, actor) {
      const s = this.s;
      if (actor !== STAGE || !this.write || !s.members[a.player]) return false;
      for (const t of s.teams) t.players = t.players.filter((p) => p.id !== a.player);
      delete s.members[a.player];
      if (this.hooks.onKick) this.hooks.onKick(a.player);
      this.checkProgress();
      return true;
    }

    on_teamName(a, actor) {
      if (actor !== STAGE) return false;
      const t = this.team(a.team);
      if (!t) return false;
      t.name = cleanName(a.name, 'Team ' + t.label);
      return true;
    }

    on_teamActive(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby') return false;
      const t = this.team(a.team);
      if (!t) return false;
      if (!a.active && s.teams.filter((x) => x.active).length <= 1) return false;
      t.active = !!a.active;
      if (!t.active) t.players = [];
      return true;
    }

    on_settings(a, actor) {
      if (actor !== STAGE || this.s.phase !== 'lobby') return false;
      this.s.settings = sanitizeSettings(Object.assign({}, a.settings, { input: this.s.settings.input }), this.s.settings);
      return true;
    }

    lobbyProblem() {
      const active = this.s.teams.filter((t) => t.active);
      const online = (t) => t.players.filter((p) => this.isOnline(p.id)).length;
      const single = active.find((t) => online(t) === 1);
      if (single) return `${single.name} braucht mindestens 2 Spieler.`;
      if (!active.some((t) => online(t) >= 2)) return 'Mindestens ein Team braucht 2 Spieler.';
      return null;
    }

    on_start(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby' || this.lobbyProblem()) return false;
      for (const t of s.teams) t.players = t.players.filter((p) => this.isOnline(p.id));
      this.startGame();
      return true;
    }

    /* Spielen (mit Handy) */

    on_submit(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!this.write || s.phase !== 'play' || !cur || actor === STAGE) return false;
      const team = this.teamOf(actor);
      const word = cleanWord(a.word);
      if (!team || !word || (a.at !== undefined && a.at !== this.stepKey(team.id))) return false;
      if (cur.kind === 'begriff') {
        if (!cur.active.includes(team.id) || !cur.participants[team.id].includes(actor)) return false;
        cur.answers[actor] = word;
        if (this.begriffComplete()) this.evaluateBegriff();
        return true;
      }
      const ch = cur.chains[team.id];
      if (!ch || ch.done || !ch.players.includes(actor)) return false;
      if (M.used(word, this.chainWords(ch))) return false;
      ch.answers[actor] = word;
      if (this.chainReady(ch)) {
        this.revealStep(team.id, this.collectWords(ch.players, ch.answers));
        this.afterChain();
      }
      return true;
    }

    on_unsubmit(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!this.write || s.phase !== 'play' || !cur || actor === STAGE) return false;
      const team = this.teamOf(actor);
      if (!team || (a.at !== undefined && a.at !== this.stepKey(team.id))) return false;
      const answers = cur.kind === 'begriff' ? cur.answers : cur.chains[team.id] && cur.chains[team.id].answers;
      if (!answers || answers[actor] === undefined) return false;
      delete answers[actor];
      return true;
    }

    /* Spielen (ohne Handy, Eingaben am Laptop) */

    on_sayResult(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (actor !== STAGE || this.write || s.phase !== 'play' || !cur || cur.kind !== 'begriff') return false;
      if (!['all', 'some', 'none'].includes(a.outcome)) return false;
      if (a.team !== undefined && a.team !== cur.team) return false;
      this.sayBegriffResult(a.outcome);
      return true;
    }

    on_sayStep(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (actor !== STAGE || this.write || s.phase !== 'play' || !cur || cur.kind !== 'kette') return false;
      if (a.team !== undefined && a.team !== cur.team) return false;
      const ch = cur.chains[cur.team];
      if (a.step !== undefined && a.step !== ch.steps.length) return false;
      const typed = Array.isArray(a.words) ? a.words : [];
      const words = ch.players.map((pid, i) => ({ pid, name: this.playerName(pid), word: cleanWord(typed[i]) }));
      const verdict = a.verdict === 'same' || a.verdict === 'diff' ? a.verdict : null;
      if (!verdict && words.filter((w) => w.word).length < ch.players.length) return false;
      this.revealStep(cur.team, words, verdict);
      this.afterChain();
      return true;
    }

    /* Steuerung (Laptop) */

    on_next(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (actor !== STAGE || !cur) return false;
      if (a.no !== undefined && a.no !== cur.no) return false;
      if (s.phase === 'reveal' && cur.kind === 'begriff') {
        const open = cur.active.filter((id) => !cur.results[id].final);
        if (open.length) {
          // Zweite Chance: Brücke zwischen den eigenen Wörtern
          cur.attempt = 2;
          cur.active = open;
          cur.answers = {};
          this.startClock(cur);
          s.phase = 'play';
          return true;
        }
        this.pushHistory();
        this.nextRound();
        return true;
      }
      if (s.phase === 'summary') {
        this.nextRound();
        return true;
      }
      return false;
    }

    on_skipTerm(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (actor !== STAGE || s.phase !== 'play' || !cur || cur.kind !== 'begriff' || cur.attempt !== 1) return false;
      cur.term = this.drawTerm();
      cur.termNo = (cur.termNo || 0) + 1;
      if (this.write) {
        cur.answers = {};
        this.startClock(cur);
      } else cur.terms[cur.team] = cur.term;
      return true;
    }

    on_giveUp(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (actor !== STAGE || s.phase !== 'play' || !cur || cur.kind !== 'kette') return false;
      const id = this.write ? a.team : cur.team;
      if (!id || !cur.chains[id] || cur.chains[id].done) return false;
      this.finishChain(id);
      this.afterChain();
      return true;
    }

    /** Runde sofort auswerten (z.B. wenn jemand nicht mehr antwortet) */
    on_finishRound(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (actor !== STAGE || s.phase !== 'play' || !cur || !this.write) return false;
      if (cur.kind === 'begriff') this.evaluateBegriff();
      else {
        for (const id of Object.keys(cur.chains)) this.finishChain(id);
        this.afterChain();
      }
      return true;
    }

    on_end(a, actor) {
      if (actor !== STAGE || this.s.phase === 'lobby' || this.s.phase === 'over') return false;
      this.finish();
      return true;
    }

    /** Nochmal mit denselben Teams */
    on_again(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'over') return false;
      if (this.write) {
        s.phase = 'lobby';
        s.round = 0;
        s.tiebreak = null;
        s.cur = null;
        s.history = [];
        s.winners = [];
        s.awards = [];
        for (const t of s.teams) t.score = 0;
      } else this.startGame();
      return true;
    }

    /* ---------- Auszeichnungen ---------- */

    computeAwards() {
      const s = this.s;
      const out = [];
      const teamName = (id) => (this.team(id) || {}).name || '?';
      const pairs = new Map();
      const countPairs = (words, groups) => {
        for (const g of groups || []) {
          for (let i = 0; i < g.length; i++) {
            for (let j = i + 1; j < g.length; j++) {
              const names = [words[g[i]].name, words[g[j]].name].sort();
              const key = names.join(' & ');
              pairs.set(key, (pairs.get(key) || 0) + 1);
            }
          }
        }
      };
      let fastest = null;
      let longest = null;
      const allCount = {};
      let salad = null;
      for (const h of s.history) {
        if (h.kind === 'kette') {
          for (const [id, ch] of Object.entries(h.chains)) {
            for (const st of ch.steps) if (st.words.every((w) => w.word)) countPairs(st.words, st.groups);
            if (ch.hit && (!fastest || ch.hit < fastest.hit)) {
              const last = ch.steps[ch.steps.length - 1];
              fastest = { id, hit: ch.hit, word: last.words[0].word };
            }
            if (!longest || ch.steps.length > longest.steps) longest = { id, steps: ch.steps.length, hit: ch.hit };
          }
        } else {
          for (const [id, r] of Object.entries(h.results)) {
            if (r.words) countPairs(r.words, r.groups);
            if (r.second && r.second.words) countPairs(r.second.words, r.second.groups);
            if (r.outcome === 'all') allCount[id] = (allCount[id] || 0) + 1;
            if (r.words) {
              const distinct = (r.groups || []).length;
              if (distinct >= 3 && (!salad || distinct > salad.n)) {
                salad = { id, n: distinct, term: (h.term || (h.terms && h.terms[id]) || {}).text };
              }
            }
          }
        }
      }
      const bestPair = [...pairs.entries()].sort((a, b) => b[1] - a[1])[0];
      if (bestPair && bestPair[1] >= 2) {
        out.push({ icon: '🧠', title: 'Seelenverwandte', text: `${bestPair[0]} – ${bestPair[1]}× dasselbe Wort` });
      }
      if (fastest) {
        out.push({
          icon: '🔮',
          title: 'Gedankenleser',
          text: `${teamName(fastest.id)} – Treffer nach ${fastest.hit} ${fastest.hit === 1 ? 'Runde' : 'Runden'}${fastest.word ? ` („${fastest.word}“)` : ''}`,
        });
      }
      if (longest && longest.steps >= 5) {
        out.push({
          icon: '🐢',
          title: 'Lange Leitung',
          text: `${teamName(longest.id)} – ${longest.steps} Runden${longest.hit ? ' bis zum Treffer' : ' ohne Treffer'}`,
        });
      }
      const topAll = Object.entries(allCount).sort((a, b) => b[1] - a[1])[0];
      if (topAll) out.push({ icon: '🎯', title: 'Volltreffer', text: `${teamName(topAll[0])} – ${topAll[1]}× alle gleich` });
      if (salad) {
        out.push({ icon: '🙈', title: 'Wortsalat', text: `${teamName(salad.id)} – ${salad.n} verschiedene Wörter${salad.term ? ` bei „${salad.term}“` : ''}` });
      }
      return out;
    }

    /* ---------- Ansicht ---------- */

    timerView(obj) {
      if (!obj || !obj.timerEnd) return null;
      return { total: obj.timerTotal, remaining: Math.max(0, obj.timerEnd - this.now()) };
    }

    curView(viewer) {
      const s = this.s;
      const cur = s.cur;
      if (!cur) return null;
      const myTeam = viewer === STAGE ? null : this.teamOf(viewer);
      const v = { kind: cur.kind, no: cur.no, tiebreak: cur.tiebreak, teams: cur.teams.slice() };
      if (cur.kind === 'begriff') {
        Object.assign(v, {
          term: cur.term,
          attempt: cur.attempt,
          results: clone(cur.results),
        });
        if (this.write) {
          v.active = cur.active.slice();
          v.participants = clone(cur.participants);
          v.answered = Object.keys(cur.answers);
          v.timer = s.phase === 'play' ? this.timerView(cur) : null;
          v.myWord = myTeam && cur.answers[viewer] !== undefined ? cur.answers[viewer] : null;
        } else {
          Object.assign(v, { queue: cur.queue.slice(), idx: cur.idx, team: cur.team, terms: clone(cur.terms), last: clone(cur.last) });
        }
        return v;
      }
      v.chains = {};
      for (const [id, ch] of Object.entries(cur.chains)) {
        v.chains[id] = {
          players: ch.players.slice(),
          start: ch.start ? ch.start.slice() : null,
          steps: clone(ch.steps),
          answered: Object.keys(ch.answers),
          done: ch.done,
          hit: ch.hit,
          points: ch.points,
          gaveUp: !!ch.gaveUp,
          timer: s.phase === 'play' && !ch.done ? this.timerView(ch) : null,
        };
      }
      if (myTeam && cur.chains[myTeam.id]) {
        const a = cur.chains[myTeam.id].answers[viewer];
        v.myWord = a !== undefined ? a : null;
      }
      if (!this.write) Object.assign(v, { queue: cur.queue.slice(), idx: cur.idx, team: cur.team, last: clone(cur.last) });
      return v;
    }

    viewFor(viewer) {
      const s = this.s;
      const stage = viewer === STAGE;
      const myTeam = stage ? null : this.teamOf(viewer);
      const view = {
        game: 'zwei-dumme',
        phase: s.phase,
        settings: Object.assign({}, s.settings),
        round: s.round,
        rounds: s.settings.rounds,
        tiebreak: s.tiebreak ? s.tiebreak.slice() : null,
        order: s.order.slice(),
        teams: s.teams.map((t) => ({
          id: t.id,
          label: t.label,
          name: t.name,
          active: t.active,
          score: t.score,
          players: t.players.map((p) => ({ id: p.id, name: p.name, online: this.isOnline(p.id) })),
        })),
        members: this.write
          ? Object.entries(s.members).map(([id, m]) => ({ id, name: m.name, online: m.online, team: (this.teamOf(id) || {}).id || null }))
          : [],
        lobbyProblem: s.phase === 'lobby' && this.write ? this.lobbyProblem() : null,
        ranking: this.ranking(),
        winners: s.winners.slice(),
        awards: clone(s.awards),
        cur: this.curView(viewer),
        me: stage
          ? { stage: true }
          : {
              id: viewer,
              name: (s.members[viewer] || {}).name || '',
              team: myTeam ? myTeam.id : null,
              stepKey: myTeam ? this.stepKey(myTeam.id) : null,
            },
      };
      if (stage && (s.phase === 'over' || s.phase === 'summary')) view.history = clone(s.history);
      return view;
    }
  }

  root.ZDEngine = {
    Engine,
    STAGE,
    TEAMS,
    MODES,
    ROUND_OPTIONS,
    SECONDS_OPTIONS,
    MAXSTEP_OPTIONS,
    DEFAULT_SETTINGS,
    KETTE_POINTS,
    BEGRIFF_POINTS,
    MAX_WORD,
    MAX_PLAYERS,
    GRACE_MS,
    kettePoints,
    sanitizeSettings,
    cleanName,
    cleanWord,
  };
})(typeof window !== 'undefined' ? window : globalThis);
