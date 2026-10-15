/*
 * Spiellogik von „Who knows more?“ – das Quiz mit der Fragenwand.
 *
 * Ablauf: Runde 1 (100–500) → Runde 2 (200–1000, nur bei „Normal“) → Finale mit Einsatz → Siegerehrung.
 * Das Team am Zug wählt ein Feld, die Frage erscheint, nach dem Vorlesen ist der Buzzer frei.
 * Wer zuerst buzzert, antwortet laut: richtig = +Wert (und wählt weiter), falsch = −Wert (Buzzer wieder frei
 * für die anderen). Joker-Felder: nur das wählende Team antwortet, vorher setzt es einen Einsatz.
 *
 * Zwei Spielweisen:
 *  - say:   ohne Handy – Buzzer sind Tasten am Laptop (A, F, J, L) oder ein Klick auf das Team
 *  - write: mit Handy – jedes Handy ist ein Buzzer, Einsätze und Finalantworten werden geheim getippt
 * Quizmaster (host 'qm'): eine Person sieht die Antwort (auf dem eigenen Handy) und entscheidet ✓/✗.
 * Ohne Quizmaster entscheidet die Runde am Laptop, die Antwort kann vorher aufgedeckt werden.
 *
 * Fairer Buzzer übers Netz: Jedes Handy misst selbst, wie lange es nach „Buzzer frei“ bis zum Drücken
 * gedauert hat. Der Laptop wartet nach dem ersten Buzz noch BUZZ_WINDOW_MS und nimmt die kleinste Reaktionszeit.
 *
 * Der Laptop („stage“) ist immer Host und Bühne und spielt nicht selbst mit. Handys bekommen über viewFor nur,
 * was sie sehen dürfen: keine Antworten (außer Quizmaster), keine fremden Einsätze/Finalantworten vor dem Aufdecken.
 */
(function (root) {
  'use strict';

  const Board = root.WKMBoard;

  const STAGE = 'stage';
  const TEAMS = [
    { id: 'rot', label: 'Rot', key: 'A' },
    { id: 'blau', label: 'Blau', key: 'F' },
    { id: 'gruen', label: 'Grün', key: 'J' },
    { id: 'gelb', label: 'Gelb', key: 'L' },
  ];
  const INPUTS = ['say', 'write'];
  const HOSTS = ['none', 'qm'];
  const SOURCES = ['katalog', 'custom', 'mixed'];
  const LENGTHS = ['short', 'normal'];
  const ANSWER_OPTIONS = [5, 10, 15];
  const DEFAULT_SETTINGS = {
    input: 'write',
    host: 'none',
    source: 'katalog',
    wallId: null,
    length: 'normal',
    cols: 6,
    joker: true,
    negative: true,
    answerSec: 10,
    reverse: false,
    adult: false,
  };
  const OPEN_MS = 10000; // so lange ist der Buzzer frei, bis die Antwort gezeigt wird
  const BUZZ_WINDOW_MS = 250; // nach dem ersten Buzz noch auf langsamere Netze warten
  const EARLY_LOCK_MS = 500; // Frühstarter-Sperre
  const FINAL_MS = 30000;
  const READ_BASE_MS = 1500;
  const READ_PER_CHAR_MS = 45;
  const READ_MAX_MS = 7000;
  const JOKER_MIN = 5;
  const MAX_PLAYERS = 12;
  const MAX_ANSWER = 80;
  const MAX_ADJUST = 10000;
  const LOCKED_PHASES = ['lobby', 'over'];

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

  function toInt(x) {
    const n = typeof x === 'number' ? x : parseInt(String(x == null ? '' : x).replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  function readMs(text) {
    return Math.min(READ_MAX_MS, READ_BASE_MS + String(text || '').length * READ_PER_CHAR_MS);
  }

  function sanitizeSettings(input, current) {
    const s = Object.assign({}, current || DEFAULT_SETTINGS);
    const i = input || {};
    if (INPUTS.includes(i.input)) s.input = i.input;
    if (HOSTS.includes(i.host)) s.host = i.host;
    if (SOURCES.includes(i.source)) s.source = i.source;
    if (i.wallId !== undefined) s.wallId = i.wallId ? String(i.wallId).slice(0, 40) : null;
    if (LENGTHS.includes(i.length)) s.length = i.length;
    if (Board.COLS_OPTIONS.includes(+i.cols)) s.cols = +i.cols;
    if (ANSWER_OPTIONS.includes(+i.answerSec)) s.answerSec = +i.answerSec;
    for (const k of ['joker', 'negative', 'reverse', 'adult']) if (typeof i[k] === 'boolean') s[k] = i[k];
    return s;
  }

  function newStats() {
    return { right: 0, wrong: 0, early: 0, best: null, maxWager: 0 };
  }

  function baseTeams() {
    return TEAMS.map((t, i) => ({
      id: t.id,
      label: t.label,
      key: t.key,
      name: 'Team ' + t.label,
      active: i < 2,
      players: [],
      score: 0,
      stats: newStats(),
    }));
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
     * @param {{settings: object, teams: {id, active, name}[], wall?: object}} config
     *   Ohne Handy startet das Spiel sofort, mit Handy in der Lobby.
     */
    static create(config) {
      const settings = sanitizeSettings(config.settings);
      const wall = settings.source !== 'katalog' ? Board.sanitizeWall(config.wall, false) : null;
      if (!wall) settings.source = 'katalog';
      const teams = baseTeams();
      for (const t of teams) {
        const cfg = (config.teams || []).find((c) => c.id === t.id);
        t.active = !!(cfg && cfg.active);
        if (cfg) t.name = cleanName(cfg.name, 'Team ' + t.label);
      }
      if (!teams.some((t) => t.active)) teams[0].active = true;
      const state = {
        v: 1,
        game: 'who-knows-more',
        settings,
        wall,
        phase: 'lobby',
        teams,
        members: {},
        qm: null,
        order: [],
        rounds: [],
        round: 0,
        final: null,
        turn: null,
        cur: null,
        qNo: 0,
        history: [],
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

    /** Braucht das Spiel einen Raum? (Handys als Buzzer – oder ein Quizmaster-Handy) */
    get write() {
      return this.s.settings.input === 'write' || this.s.settings.host === 'qm';
    }

    get phones() {
      return this.s.settings.input === 'write';
    }

    team(id) {
      return this.s.teams.find((t) => t.id === id) || null;
    }

    teamOf(pid) {
      return this.s.teams.find((t) => t.players.some((p) => p.id === pid)) || null;
    }

    playerName(pid) {
      const m = this.s.members[pid];
      return m ? m.name : '?';
    }

    isOnline(pid) {
      const m = this.s.members[pid];
      return !!(m && m.online);
    }

    /** Darf entscheiden (✓/✗, Buzzer frei, Weiter): Laptop oder Quizmaster-Handy */
    isJudge(actor) {
      return actor === STAGE || (this.s.settings.host === 'qm' && !!actor && actor === this.s.qm);
    }

    board() {
      return this.s.rounds[this.s.round] || null;
    }

    cell(col, row) {
      const b = this.board();
      const k = b && b.cats[col];
      return k ? k.cells[row] || null : null;
    }

    maxValue() {
      return Board.cellValue(Board.ROWS - 1, this.s.round);
    }

    jokerRange(teamId) {
      const t = this.team(teamId);
      return { min: JOKER_MIN, max: Math.max(t ? t.score : 0, this.maxValue()) };
    }

    ranking() {
      return this.s.order
        .map((id) => this.team(id))
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)
        .map((t) => t.id);
    }

    leaders() {
      const teams = this.s.order.map((id) => this.team(id)).filter(Boolean);
      if (!teams.length) return [];
      const best = Math.max(...teams.map((t) => t.score));
      return teams.filter((t) => t.score === best).map((t) => t.id);
    }

    clue(c) {
      return this.s.settings.reverse ? c.a : c.q;
    }

    solution(c) {
      return this.s.settings.reverse ? c.q : c.a;
    }

    /* ---------- Verbindungen (mit Handy / Quizmaster-Handy) ---------- */

    connect(pid, name) {
      const m = this.s.members[pid];
      if (m) {
        m.online = true;
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
      this.changed();
    }

    /** Nach dem Neuladen des Laptops: alle müssen sich neu verbinden */
    setAllOffline() {
      for (const m of Object.values(this.s.members)) m.online = false;
    }

    /* ---------- Ablauf ---------- */

    startGame() {
      const s = this.s;
      s.order = s.teams.filter((t) => t.active && (!this.phones || t.players.length)).map((t) => t.id);
      for (const t of s.teams) {
        t.score = 0;
        t.stats = newStats();
      }
      const game = Board.buildGame(s.settings, s.wall);
      s.rounds = game.rounds;
      s.final = { cat: game.final.cat, q: game.final.q, a: game.final.a };
      s.history = [];
      s.qNo = 0;
      s.winners = [];
      s.awards = [];
      s.startedAt = this.now();
      this.startRound(0);
    }

    startRound(idx) {
      const s = this.s;
      s.round = idx;
      s.cur = null;
      s.phase = 'board';
      if (idx === 0) s.turn = s.order[Math.floor(Math.random() * s.order.length)];
      else {
        // Wer hinten liegt, fängt an
        const low = Math.min(...s.order.map((id) => this.team(id).score));
        const lows = s.order.filter((id) => this.team(id).score === low);
        s.turn = lows[Math.floor(Math.random() * lows.length)];
      }
    }

    roundDone() {
      const b = this.board();
      return !b || b.cats.every((k) => k.cells.every((c) => c.done));
    }

    pick(col, row) {
      const s = this.s;
      const c = this.cell(col, row);
      if (!c || c.done) return false;
      s.qNo += 1;
      const now = this.now();
      s.cur = {
        no: s.qNo,
        col,
        row,
        value: c.value,
        joker: !!c.joker,
        locked: [],
        attempts: [],
        buzzes: [],
        earlyUntil: {},
        buzzed: null,
        shown: false,
        wager: null,
        result: null,
        openId: null,
      };
      if (c.joker) {
        s.phase = 'wager';
        return true;
      }
      s.phase = 'read';
      const ms = readMs(this.clue(c));
      s.cur.readTotal = ms;
      // Mit Quizmaster gibt er/sie den Buzzer frei, sonst automatisch nach der Lesezeit
      s.cur.readEnd = s.settings.host === 'qm' ? null : now + ms;
      return true;
    }

    /** at: Zeitpunkt der Freigabe (beim Nachholen nach einem Neuladen liegt er in der Vergangenheit) */
    openBuzzer(at) {
      const cur = this.s.cur;
      const now = at || this.now();
      this.s.phase = 'open';
      cur.openId = cur.no + '.' + (cur.attempts.length + 1);
      cur.openAt = now;
      cur.openEnd = now + OPEN_MS;
      cur.buzzes = [];
      cur.windowEnd = null;
      cur.readEnd = null;
      cur.buzzed = null;
    }

    setBuzzed(teamId, pid, reaction) {
      const cur = this.s.cur;
      const t = this.team(teamId);
      cur.buzzed = { team: teamId, pid: pid || null, reaction: Math.max(0, Math.round(reaction)) };
      cur.answerTotal = this.s.settings.answerSec * 1000;
      cur.answerEnd = this.now() + cur.answerTotal;
      cur.windowEnd = null;
      if (t.stats.best == null || cur.buzzed.reaction < t.stats.best.ms) t.stats.best = { ms: cur.buzzed.reaction, pid: pid || null };
      this.s.phase = 'buzzed';
    }

    resolveBuzz() {
      const cur = this.s.cur;
      const best = cur.buzzes.slice().sort((a, b) => a.reaction - b.reaction || a.at - b.at)[0];
      if (best) this.setBuzzed(best.team, best.pid, best.reaction);
      else {
        cur.windowEnd = null;
      }
    }

    /** Frage fertig: Feld ist weg. team = wer richtig lag (null = niemand) */
    reveal(team, ok, delta) {
      const s = this.s;
      const cur = s.cur;
      const c = this.cell(cur.col, cur.row);
      cur.result = { team: team || null, ok: !!ok, delta: delta || 0 };
      cur.readEnd = cur.openEnd = cur.answerEnd = cur.windowEnd = null;
      if (c) {
        c.done = true;
        c.result = { team: team || null, ok: !!ok };
      }
      s.history.push({
        round: s.round,
        cat: this.board().cats[cur.col].name,
        value: cur.value,
        joker: cur.joker,
        wager: cur.wager,
        attempts: clone(cur.attempts),
        result: clone(cur.result),
      });
      s.phase = 'reveal';
    }

    startFinal() {
      const s = this.s;
      const eligible = s.order.filter((id) => this.team(id).score > 0);
      Object.assign(s.final, { eligible, wagers: {}, answers: {}, order: [], step: 0, shown: false, results: {}, endAt: null, done: false });
      s.cur = null;
      if (!eligible.length) {
        s.final.skipped = true;
        this.finish();
        return;
      }
      s.phase = 'finalWager';
    }

    startFinalQuestion() {
      this.s.phase = 'finalQ';
      this.s.final.endAt = this.now() + FINAL_MS;
    }

    startFinalReveal() {
      const s = this.s;
      const f = s.final;
      // Vom letzten zum ersten Platz
      f.order = f.eligible.slice().sort((a, b) => this.team(a).score - this.team(b).score || s.order.indexOf(b) - s.order.indexOf(a));
      f.step = 0;
      f.shown = false;
      f.endAt = null;
      s.phase = 'finalReveal';
    }

    finish() {
      const s = this.s;
      s.phase = 'over';
      s.cur = null;
      s.winners = this.leaders();
      s.awards = this.computeAwards();
      this.dispose();
    }

    /* ---------- Zeitlimits ---------- */

    nextDeadline() {
      const s = this.s;
      const cur = s.cur;
      let t = null;
      if (s.phase === 'read' && cur) t = cur.readEnd;
      else if (s.phase === 'open' && cur) t = cur.windowEnd || cur.openEnd;
      else if (s.phase === 'finalQ' && s.final) t = s.final.endAt;
      return t || null;
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
        Math.max(0, next - this.now()) + 15
      );
    }

    /** Abgelaufene Zeitlimits auswerten. Gibt true zurück, wenn sich etwas geändert hat. */
    tick() {
      const s = this.s;
      let changed = false;
      for (let guard = 0; guard < 6; guard++) {
        const now = this.now();
        const cur = s.cur;
        if (s.phase === 'read' && cur && cur.readEnd && cur.readEnd <= now) this.openBuzzer(cur.readEnd);
        else if (s.phase === 'open' && cur && cur.windowEnd && cur.windowEnd <= now) this.resolveBuzz();
        else if (s.phase === 'open' && cur && !cur.windowEnd && cur.openEnd && cur.openEnd <= now) this.reveal(null, false, 0);
        else if (s.phase === 'finalQ' && s.final.endAt && s.final.endAt <= now) this.startFinalReveal();
        else break;
        changed = true;
      }
      return changed;
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
      this.tick();
      const ok = handler.call(this, a, actor) === true;
      if (ok) this.changed();
      return ok;
    }

    /** Passt die Aktion noch zur aktuellen Frage? (verspätete Klicks ignorieren) */
    stale(a) {
      return a.no !== undefined && (!this.s.cur || a.no !== this.s.cur.no);
    }

    /* Lobby */

    on_joinTeam(a, actor) {
      const s = this.s;
      if (!this.phones || actor === STAGE || s.phase === 'over') return false;
      const m = s.members[actor];
      if (!m) return false;
      const target = a.team ? this.team(a.team) : null;
      if (target && (!target.active || target.players.length >= MAX_PLAYERS)) return false;
      if (s.phase === 'lobby') {
        for (const t of s.teams) t.players = t.players.filter((p) => p.id !== actor);
        if (s.qm === actor) s.qm = null;
        if (target) target.players.push({ id: actor, name: m.name });
        return true;
      }
      // Im laufenden Spiel darf man noch einem mitspielenden Team beitreten
      if (!target || !s.order.includes(target.id) || this.teamOf(actor)) return false;
      if (s.qm === actor) s.qm = null;
      target.players.push({ id: actor, name: m.name });
      return true;
    }

    on_becomeQM(a, actor) {
      const s = this.s;
      if (s.settings.host !== 'qm' || actor === STAGE || s.phase === 'over' || !s.members[actor]) return false;
      if (s.qm === actor) return false;
      if (s.qm && this.isOnline(s.qm)) return false;
      // Im laufenden Spiel bleibt man in seinem Team, wenn man schon spielt
      if (s.phase !== 'lobby' && this.teamOf(actor)) return false;
      for (const t of s.teams) t.players = t.players.filter((p) => p.id !== actor);
      s.qm = actor;
      return true;
    }

    on_leaveQM(a, actor) {
      if (this.s.qm !== actor || actor === STAGE) return false;
      this.s.qm = null;
      return true;
    }

    on_kick(a, actor) {
      const s = this.s;
      if (actor !== STAGE || !s.members[a.player]) return false;
      for (const t of s.teams) t.players = t.players.filter((p) => p.id !== a.player);
      if (s.qm === a.player) s.qm = null;
      delete s.members[a.player];
      if (this.hooks.onKick) this.hooks.onKick(a.player);
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
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby') return false;
      // Spielweise und Fragenquelle stehen fest, sobald der Raum offen ist
      const fixed = { input: s.settings.input, source: s.settings.source, wallId: s.settings.wallId };
      s.settings = sanitizeSettings(Object.assign({}, a.settings, fixed), s.settings);
      if (s.settings.host !== 'qm') s.qm = null;
      return true;
    }

    lobbyProblem() {
      const active = this.s.teams.filter((t) => t.active);
      if (!active.some((t) => t.players.some((p) => this.isOnline(p.id)))) return 'Mindestens ein Team braucht einen Spieler.';
      return null;
    }

    on_start(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby' || this.lobbyProblem()) return false;
      for (const t of s.teams) t.players = t.players.filter((p) => this.isOnline(p.id));
      this.startGame();
      return true;
    }

    /* Wand */

    on_pick(a, actor) {
      const s = this.s;
      if (s.phase !== 'board') return false;
      if (!this.isJudge(actor)) {
        const t = this.teamOf(actor);
        if (!t || t.id !== s.turn) return false;
      }
      return this.pick(+a.col, +a.row);
    }

    /** Buzzer freigeben (Quizmaster / Laptop) */
    on_open(a, actor) {
      if (!this.isJudge(actor) || this.s.phase !== 'read' || this.stale(a)) return false;
      this.openBuzzer();
      return true;
    }

    /**
     * Buzz. Vom Laptop: {team, reaction?} – Taste oder Klick, gilt sofort.
     * Vom Handy: {openId, reaction} – die Reaktionszeit hat das Handy selbst gemessen.
     *   {early: true} meldet einen Frühstart (für die Auszeichnung „Voreilig“).
     */
    on_buzz(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!cur || (s.phase !== 'read' && s.phase !== 'open')) return false;
      const now = this.now();
      if (actor === STAGE) {
        const t = this.team(a.team);
        if (!t || !s.order.includes(t.id) || cur.locked.includes(t.id)) return false;
        if (s.phase === 'read') {
          t.stats.early += 1;
          cur.earlyUntil[t.id] = now + EARLY_LOCK_MS;
          return true;
        }
        if ((cur.earlyUntil[t.id] || 0) > now) return false;
        const r = toInt(a.reaction);
        this.setBuzzed(t.id, null, r != null && r >= 0 ? Math.min(r, now - cur.openAt) : now - cur.openAt);
        return true;
      }
      const t = this.teamOf(actor);
      if (!t || !s.order.includes(t.id) || cur.locked.includes(t.id)) return false;
      if (a.early || s.phase === 'read') {
        cur.earlyBy = cur.earlyBy || [];
        if (!cur.earlyBy.includes(actor)) {
          cur.earlyBy.push(actor);
          t.stats.early += 1;
        }
        return false;
      }
      if (a.openId !== cur.openId) return false;
      const elapsed = now - cur.openAt;
      const r = toInt(a.reaction);
      const reaction = r != null && r >= 0 ? Math.min(r, elapsed) : elapsed;
      const mine = cur.buzzes.find((b) => b.team === t.id);
      if (mine) {
        if (reaction >= mine.reaction) return false;
        Object.assign(mine, { pid: actor, reaction });
      } else cur.buzzes.push({ team: t.id, pid: actor, reaction, at: now });
      if (!cur.windowEnd) cur.windowEnd = now + BUZZ_WINDOW_MS;
      return true;
    }

    /** Antwort für alle aufdecken (ohne Quizmaster: zum Nachprüfen) */
    on_show(a, actor) {
      const s = this.s;
      if (!this.isJudge(actor) || !s.cur || this.stale(a) || !['buzzed', 'joker'].includes(s.phase) || s.cur.shown) return false;
      s.cur.shown = true;
      return true;
    }

    on_judge(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!this.isJudge(actor) || !cur || this.stale(a) || typeof a.ok !== 'boolean') return false;
      if (s.phase === 'joker') {
        const t = this.team(s.turn);
        const delta = a.ok ? cur.wager : -cur.wager;
        t.score += delta;
        t.stats[a.ok ? 'right' : 'wrong'] += 1;
        cur.attempts.push({ team: t.id, ok: a.ok, delta });
        this.reveal(a.ok ? t.id : null, a.ok, delta);
        return true;
      }
      if (s.phase !== 'buzzed' || !cur.buzzed) return false;
      const t = this.team(cur.buzzed.team);
      const delta = a.ok ? cur.value : s.settings.negative ? -cur.value : 0;
      t.score += delta;
      t.stats[a.ok ? 'right' : 'wrong'] += 1;
      cur.attempts.push({ team: t.id, pid: cur.buzzed.pid, reaction: cur.buzzed.reaction, ok: a.ok, delta });
      if (a.ok) {
        s.turn = t.id;
        this.reveal(t.id, true, delta);
        return true;
      }
      cur.locked.push(t.id);
      const left = s.order.filter((id) => !cur.locked.includes(id));
      // Wurde die Antwort schon gezeigt, bringt ein neuer Buzzer nichts mehr
      if (cur.shown || !left.length) this.reveal(null, false, 0);
      else this.openBuzzer();
      return true;
    }

    /** Niemand weiß es / Frage überspringen – Antwort zeigen, gleiches Team wählt weiter */
    on_resolve(a, actor) {
      const s = this.s;
      if (!this.isJudge(actor) || !s.cur || this.stale(a) || !['read', 'open', 'wager'].includes(s.phase)) return false;
      this.reveal(null, false, 0);
      return true;
    }

    /** Joker-Einsatz des Teams am Zug (Handy des Teams, Quizmaster oder Laptop) */
    on_wager(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'wager' || !cur || this.stale(a)) return false;
      if (!this.isJudge(actor)) {
        const t = this.teamOf(actor);
        if (!t || t.id !== s.turn) return false;
      }
      const range = this.jokerRange(s.turn);
      const amount = toInt(a.amount);
      if (amount == null || amount < range.min || amount > range.max) return false;
      cur.wager = amount;
      const t = this.team(s.turn);
      t.stats.maxWager = Math.max(t.stats.maxWager, amount);
      const c = this.cell(cur.col, cur.row);
      s.phase = 'joker';
      cur.answerTotal = readMs(this.clue(c)) + s.settings.answerSec * 1000;
      cur.answerEnd = this.now() + cur.answerTotal;
      return true;
    }

    /* Finale */

    on_finalWager(a, actor) {
      const s = this.s;
      const f = s.final;
      if (s.phase !== 'finalWager') return false;
      const t = actor === STAGE ? this.team(a.team) : this.teamOf(actor);
      if (!t || !f.eligible.includes(t.id)) return false;
      const amount = toInt(a.amount);
      if (amount == null || amount < 0 || amount > t.score) return false;
      f.wagers[t.id] = amount;
      t.stats.maxWager = Math.max(t.stats.maxWager, amount);
      // Haben alle gesetzt, erscheint die Frage
      if (this.phones && f.eligible.every((id) => f.wagers[id] != null)) this.startFinalQuestion();
      return true;
    }

    on_finalAnswer(a, actor) {
      const s = this.s;
      const f = s.final;
      if (s.phase !== 'finalQ' || actor === STAGE) return false;
      const t = this.teamOf(actor);
      if (!t || !f.eligible.includes(t.id)) return false;
      const text = cleanName(a.text, '', MAX_ANSWER);
      if (!text) return false;
      f.answers[t.id] = { text, by: this.playerName(actor) };
      return true;
    }

    on_finalShow(a, actor) {
      const f = this.s.final;
      if (!this.isJudge(actor) || this.s.phase !== 'finalReveal' || f.done || f.shown) return false;
      f.shown = true;
      return true;
    }

    /** ✓/✗ für das Team, das gerade aufgedeckt wird. Ohne Handy wird hier auch der Einsatz eingetragen. */
    on_finalJudge(a, actor) {
      const s = this.s;
      const f = s.final;
      if (!this.isJudge(actor) || s.phase !== 'finalReveal' || f.done || typeof a.ok !== 'boolean') return false;
      const id = f.order[f.step];
      if (a.team !== undefined && a.team !== id) return false;
      const t = this.team(id);
      let wager = f.wagers[id];
      if (!this.phones || wager == null) {
        const w = toInt(a.wager);
        if (this.phones && w == null) wager = 0;
        else {
          if (w == null || w < 0 || w > t.score) return false;
          wager = w;
        }
      }
      f.wagers[id] = wager;
      t.stats.maxWager = Math.max(t.stats.maxWager, wager);
      const delta = a.ok ? wager : -wager;
      t.score += delta;
      t.stats[a.ok ? 'right' : 'wrong'] += 1;
      f.results[id] = { ok: a.ok, wager, delta, answer: f.answers[id] ? f.answers[id].text : null };
      f.step += 1;
      f.shown = false;
      if (f.step >= f.order.length) f.done = true;
      return true;
    }

    /* Steuerung (Laptop / Quizmaster) */

    on_next(a, actor) {
      const s = this.s;
      if (!this.isJudge(actor) || this.stale(a)) return false;
      if (a.phase !== undefined && a.phase !== s.phase) return false;
      switch (s.phase) {
        case 'reveal':
          s.cur = null;
          if (this.roundDone()) s.phase = 'roundEnd';
          else s.phase = 'board';
          return true;
        case 'roundEnd':
          if (s.round + 1 < s.rounds.length) this.startRound(s.round + 1);
          else this.startFinal();
          return true;
        case 'finalWager':
          this.startFinalQuestion();
          return true;
        case 'finalQ':
          this.startFinalReveal();
          return true;
        case 'finalReveal':
          if (!s.final.done) return false;
          this.finish();
          return true;
        default:
          return false;
      }
    }

    /** Restliche Felder der Runde überspringen */
    on_skipRound(a, actor) {
      const s = this.s;
      if (actor !== STAGE || !['board', 'reveal'].includes(s.phase)) return false;
      for (const k of this.board().cats) for (const c of k.cells) c.done = true;
      s.cur = null;
      s.phase = 'roundEnd';
      return true;
    }

    /** Punkte von Hand korrigieren (z.B. nach einer Fehlentscheidung) */
    on_adjust(a, actor) {
      const s = this.s;
      if (actor !== STAGE || LOCKED_PHASES.includes(s.phase)) return false;
      const t = this.team(a.team);
      const d = toInt(a.delta);
      if (!t || !s.order.includes(t.id) || !d || Math.abs(d) > MAX_ADJUST) return false;
      t.score += d;
      return true;
    }

    on_end(a, actor) {
      if (actor !== STAGE || LOCKED_PHASES.includes(this.s.phase)) return false;
      this.finish();
      return true;
    }

    /** Nochmal mit denselben Teams (neue Wand) */
    on_again(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'over') return false;
      if (this.phones) {
        s.phase = 'lobby';
        s.rounds = [];
        s.final = null;
        s.cur = null;
        s.history = [];
        s.winners = [];
        s.awards = [];
        for (const t of s.teams) {
          t.score = 0;
          t.stats = newStats();
        }
      } else this.startGame();
      return true;
    }

    /* ---------- Auszeichnungen ---------- */

    computeAwards() {
      const s = this.s;
      const out = [];
      const teams = s.order.map((id) => this.team(id)).filter(Boolean);
      const fmtMs = (ms) => (ms / 1000).toFixed(2).replace('.', ',') + ' s';
      const top = (fn, min) => {
        const best = teams.slice().sort((a, b) => fn(b) - fn(a))[0];
        return best && fn(best) >= (min || 1) ? best : null;
      };
      const fast = teams.filter((t) => t.stats.best).sort((a, b) => a.stats.best.ms - b.stats.best.ms)[0];
      if (fast) {
        const who = fast.stats.best.pid ? `${this.playerName(fast.stats.best.pid)} (${fast.name})` : fast.name;
        out.push({ icon: '⚡', title: 'Schnellster Buzzer', text: `${who} – ${fmtMs(fast.stats.best.ms)}` });
      }
      const right = top((t) => t.stats.right);
      if (right) out.push({ icon: '🎯', title: 'Treffsicher', text: `${right.name} – ${right.stats.right} richtige ${right.stats.right === 1 ? 'Antwort' : 'Antworten'}` });
      const wager = top((t) => t.stats.maxWager);
      if (wager) out.push({ icon: '🎲', title: 'Zocker', text: `${wager.name} – ${wager.stats.maxWager.toLocaleString('de-DE')} Punkte gesetzt` });
      const early = top((t) => t.stats.early, 2);
      if (early) out.push({ icon: '🙈', title: 'Voreilig', text: `${early.name} – ${early.stats.early}× zu früh gebuzzert` });
      else {
        const wrong = top((t) => t.stats.wrong, 2);
        if (wrong) out.push({ icon: '🙈', title: 'Mutig daneben', text: `${wrong.name} – ${wrong.stats.wrong}× falsch geantwortet` });
      }
      return out;
    }

    /* ---------- Ansicht ---------- */

    timerView(end, total) {
      if (!end) return null;
      return { total: total || 1, remaining: Math.max(0, end - this.now()) };
    }

    boardView() {
      const b = this.board();
      if (!b) return null;
      return {
        cats: b.cats.map((k) => ({
          name: k.name,
          cells: k.cells.map((c) => ({ value: c.value, done: c.done, empty: !!c.empty, joker: c.done && !c.empty ? c.joker : false, result: clone(c.result) })),
        })),
      };
    }

    curView(viewer, insider, myTeam) {
      const s = this.s;
      const cur = s.cur;
      if (!cur) return null;
      const c = this.cell(cur.col, cur.row);
      const k = this.board().cats[cur.col];
      const showClue = s.phase !== 'wager';
      const open = insider || cur.shown || s.phase === 'reveal';
      const v = {
        no: cur.no,
        col: cur.col,
        row: cur.row,
        cat: k.name,
        value: cur.value,
        joker: cur.joker,
        clue: showClue ? this.clue(c) : null,
        img: showClue ? c.img : null,
        // Bei „Umgekehrt“ ist die Antwort auf der Wand, gesucht ist die Frage
        solution: open ? this.solution(c) : null,
        shown: cur.shown,
        locked: cur.locked.slice(),
        attempts: clone(cur.attempts),
        buzzed: cur.buzzed ? { team: cur.buzzed.team, name: cur.buzzed.pid ? this.playerName(cur.buzzed.pid) : null, reaction: cur.buzzed.reaction } : null,
        wager: cur.wager,
        result: clone(cur.result),
        openId: s.phase === 'open' ? cur.openId : null,
        timer: null,
      };
      if (s.phase === 'read') v.timer = cur.readEnd ? Object.assign(this.timerView(cur.readEnd, cur.readTotal), { kind: 'read' }) : null;
      else if (s.phase === 'open') v.timer = Object.assign(this.timerView(cur.openEnd, OPEN_MS), { kind: 'open' });
      else if (s.phase === 'buzzed' || s.phase === 'joker') v.timer = Object.assign(this.timerView(cur.answerEnd, cur.answerTotal), { kind: 'answer' });
      if (s.phase === 'wager') v.range = this.jokerRange(s.turn);
      if (myTeam) v.myBuzz = cur.buzzes.some((b) => b.team === myTeam.id);
      return v;
    }

    finalView(viewer, insider, myTeam) {
      const s = this.s;
      const f = s.final;
      if (!f || !f.eligible) return f && f.skipped ? { skipped: true } : null;
      const showQ = ['finalQ', 'finalReveal', 'over'].includes(s.phase);
      const revealed = (id) => f.results[id] !== undefined || (f.order[f.step] === id && f.shown);
      const mine = (id) => myTeam && myTeam.id === id;
      const wagers = {};
      const answers = {};
      for (const id of f.eligible) {
        if (insider || mine(id) || f.results[id] !== undefined) {
          if (f.wagers[id] != null) wagers[id] = f.wagers[id];
        }
        if ((insider || mine(id) || revealed(id)) && f.answers[id]) answers[id] = clone(f.answers[id]);
      }
      const cur = f.order[f.step];
      const v = {
        cat: f.cat,
        q: showQ ? f.q : null,
        a: insider || s.phase === 'finalReveal' || s.phase === 'over' ? f.a : null,
        eligible: f.eligible.slice(),
        wagered: f.eligible.filter((id) => f.wagers[id] != null),
        answered: f.eligible.filter((id) => !!f.answers[id]),
        wagers,
        answers,
        order: f.order.slice(),
        step: f.step,
        current: cur || null,
        shown: f.shown,
        done: f.done,
        results: clone(f.results),
        timer: s.phase === 'finalQ' ? this.timerView(f.endAt, FINAL_MS) : null,
        skipped: !!f.skipped,
      };
      if (insider && cur && f.answers[cur]) v.suggest = Board.checkAnswer(f.answers[cur].text, f.a);
      if (myTeam && f.eligible.includes(myTeam.id)) v.myRange = { min: 0, max: this.team(myTeam.id).score };
      return v;
    }

    viewFor(viewer) {
      const s = this.s;
      const stage = viewer === STAGE;
      const qm = !stage && s.settings.host === 'qm' && viewer === s.qm;
      const insider = stage || qm;
      const myTeam = stage ? null : this.teamOf(viewer);
      const settings = Object.assign({}, s.settings);
      const view = {
        game: 'who-knows-more',
        phase: s.phase,
        settings,
        wallTitle: s.wall ? s.wall.title : null,
        round: s.round + 1,
        roundCount: s.rounds.length,
        order: s.order.slice(),
        turn: s.turn,
        teams: s.teams.map((t) => ({
          id: t.id,
          label: t.label,
          key: t.key,
          name: t.name,
          active: t.active,
          score: t.score,
          players: t.players.map((p) => ({ id: p.id, name: p.name, online: this.isOnline(p.id) })),
        })),
        members: this.write
          ? Object.entries(s.members).map(([id, m]) => ({ id, name: m.name, online: m.online, team: (this.teamOf(id) || {}).id || null, qm: id === s.qm }))
          : [],
        qm: s.settings.host === 'qm' && s.qm ? { id: s.qm, name: this.playerName(s.qm), online: this.isOnline(s.qm) } : null,
        lobbyProblem: s.phase === 'lobby' ? this.lobbyProblem() : null,
        board: this.boardView(),
        cur: this.curView(viewer, insider, myTeam),
        final: this.finalView(viewer, insider, myTeam),
        ranking: this.ranking(),
        winners: s.winners.slice(),
        awards: clone(s.awards),
        me: stage
          ? { stage: true, role: 'stage' }
          : {
              id: viewer,
              name: (s.members[viewer] || {}).name || '',
              team: myTeam ? myTeam.id : null,
              role: qm ? 'qm' : myTeam ? 'player' : 'guest',
            },
      };
      if (stage && s.phase === 'over') view.history = clone(s.history);
      return view;
    }
  }

  root.WKMEngine = {
    Engine,
    STAGE,
    TEAMS,
    INPUTS,
    HOSTS,
    SOURCES,
    LENGTHS,
    ANSWER_OPTIONS,
    DEFAULT_SETTINGS,
    OPEN_MS,
    BUZZ_WINDOW_MS,
    EARLY_LOCK_MS,
    FINAL_MS,
    JOKER_MIN,
    MAX_PLAYERS,
    MAX_ANSWER,
    readMs,
    sanitizeSettings,
    cleanName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
