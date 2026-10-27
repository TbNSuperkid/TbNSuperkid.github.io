/*
 * Spiellogik von „Wavelength“ – Skala zwischen zwei Gegensätzen, geheimes Ziel, ein Hinweis, das Team dreht den Zeiger.
 *
 * Ablauf eines Zugs:  clue (Hinweisgeber/in sieht das Ziel) → dial (Team dreht den Zeiger)
 *                     → side (Gegnerteam tippt: Ziel links oder rechts vom Zeiger?) → reveal (Aufdecken, Punkte)
 *
 * Zwei Spielweisen:
 *  - phones: Laptop = Bühne, Handys: Ziel nur auf dem Handy der hinweisgebenden Person, das Team dreht den Zeiger
 *            live auf den Handys, das Gegnerteam stimmt per Handy ab.
 *  - one:    ein Gerät. Der Laptop zeigt das Ziel, während alle anderen wegschauen; Zeiger mit Maus/Pfeiltasten.
 *
 * Zwei Modi: teams (2 Teams, erstes Team mit 10 Punkten gewinnt) und coop (alle zusammen, 7 Skalen + Extra-Skalen).
 *
 * Der Laptop ("stage") ist immer der Host. Das Ziel steht vor dem Aufdecken nur in der Ansicht der hinweisgebenden
 * Person – mit einem Gerät außerdem in der Hinweis-Phase auf dem Laptop.
 */
(function (root) {
  'use strict';

  const Scales = root.WLScales;

  const GAME = 'wavelength';
  const STAGE = 'stage';
  const TEAMS = [
    { id: 'blau', label: 'Blau', icon: '🔵', color: '#3b82f6' },
    { id: 'orange', label: 'Orange', icon: '🟠', color: '#f97316' },
  ];
  const PLAYER_COLORS = ['#f472b6', '#38bdf8', '#a855f7', '#22c55e', '#facc15', '#ef4444', '#14b8a6', '#fb923c', '#84cc16', '#818cf8', '#e879f9', '#e5e7eb'];
  const INPUTS = ['phones', 'one'];
  const MODES = ['teams', 'coop'];
  const GOALS = [10, 15];
  // Breite eines Streifens in Grad – das ganze Ziel ist 5 Streifen breit
  const WIDTHS = { wide: 9, normal: 7, narrow: 5 };
  const WIDTH_IDS = ['wide', 'normal', 'narrow'];
  const TIMER_OPTIONS = [0, 60, 90, 120];
  const BANDS = [2, 3, 4, 3, 2];
  const DEFAULT_SETTINGS = {
    input: 'phones',
    mode: 'teams',
    goal: 10,
    width: 'normal',
    sideGuess: true,
    catchUp: true,
    categories: Scales.DEFAULT_CATEGORIES.slice(),
    timer: 0,
    customScale: false,
    drinks: false,
  };
  const MIN_TEAM = 2;
  const MIN_COOP = 2;
  const MAX_PLAYERS = 12;
  // Kooperativ: so viele Skalen (+ eine Extra-Skala für jede 4)
  const COOP_SCALES = 7;
  // „Fertig“ braucht die Zustimmung von so vielen Personen im Team (oder der Spielleitung)
  const LOCKS_NEEDED = 2;
  // So oft darf die hinweisgebende Person eine neue Skala ziehen (Laptop und Spielleitung beliebig oft)
  const MAX_REROLLS = 1;
  const DIAL_START = 90;
  const MAX_CLUE = 40;
  const MAX_END = 24;
  // So lange wird auf jemanden gewartet, dessen Handy kurz die Verbindung verliert
  const GRACE_MS = 15000;

  // Kooperativ: Wertung nach Gesamtpunkten (7 Skalen, höchstens 4 Punkte pro Skala)
  const COOP_RATINGS = [
    { min: 24, icon: '🔮', title: 'Gedankenleser', text: 'Ihr braucht gar keine Hinweise mehr.' },
    { min: 19, icon: '📻', title: 'Gleiche Welle', text: 'Ihr funkt auf derselben Frequenz.' },
    { min: 14, icon: '📶', title: 'Guter Empfang', text: 'Klare Verbindung – fast ohne Störungen.' },
    { min: 8, icon: '〰️', title: 'Rauschen', text: 'Man versteht sich … meistens.' },
    { min: 0, icon: '📵', title: 'Funkloch', text: 'Hallo? Hört mich jemand?' },
  ];

  // Füllwörter in den Skalen-Enden zählen bei der Hinweis-Prüfung nicht („klingt nach Dino“)
  const FILLER = new Set(
    'der die das den dem des ein eine einen und oder nach sehr mit fuer ich man nie nur auf bei von zum zur gut ganz wie vor aus auch noch nicht kein keine total einfach typisch liegt klingt lebt ist bester beste schlechter schlechte schlechtes guter gute gutes'.split(' ')
  );

  const round1 = (n) => Math.round(n * 10) / 10;

  function coopRating(score) {
    return COOP_RATINGS.find((r) => score >= r.min) || COOP_RATINGS[COOP_RATINGS.length - 1];
  }

  /** Breite eines Streifens in Grad */
  function bandWidth(width) {
    return WIDTHS[width] || WIDTHS.normal;
  }

  /** Bereich, in dem das Ziel liegen darf – nie so nah am Rand, dass Streifen abgeschnitten werden */
  function targetRange(width) {
    const edge = 2.5 * bandWidth(width);
    return [edge, 180 - edge];
  }

  /** Punkte für den Zeiger: Mitte 4, daneben 3, außen 2, sonst 0. Genau auf der Kante zählt der bessere Streifen. */
  function points(dial, target, width) {
    const w = bandWidth(width);
    const d = round1(Math.abs(dial - target));
    if (d <= w / 2) return 4;
    if (d <= 1.5 * w) return 3;
    if (d <= 2.5 * w) return 2;
    return 0;
  }

  /** Liegt das Ziel links oder rechts vom Zeiger? (genau darauf: null – dann bekommt niemand den Punkt) */
  function sideOf(dial, target) {
    if (round1(target) === round1(dial)) return null;
    return target < dial ? 'left' : 'right';
  }

  function cleanText(text, max) {
    return String(text == null ? '' : text)
      .replace(/[\u0000-\u001f<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  }

  function cleanName(name, fallback, max) {
    return cleanText(name, max || 24) || fallback;
  }

  function clone(o) {
    return o == null ? o : JSON.parse(JSON.stringify(o));
  }

  function sanitizeSettings(input, current) {
    const s = Object.assign({}, current || DEFAULT_SETTINGS);
    const i = input || {};
    if (INPUTS.includes(i.input)) s.input = i.input;
    if (MODES.includes(i.mode)) s.mode = i.mode;
    if (GOALS.includes(+i.goal) && i.goal !== null && i.goal !== '') s.goal = +i.goal;
    if (WIDTH_IDS.includes(i.width)) s.width = i.width;
    if (TIMER_OPTIONS.includes(+i.timer) && i.timer !== null && i.timer !== '') s.timer = +i.timer;
    if (Array.isArray(i.categories)) s.categories = Scales.cleanCategories(i.categories);
    else s.categories = Scales.cleanCategories(s.categories);
    for (const k of ['sideGuess', 'catchUp', 'customScale', 'drinks']) if (typeof i[k] === 'boolean') s[k] = i[k];
    return s;
  }

  /**
   * Hinweis prüfen (nur als Warnung – gesendet werden darf trotzdem):
   * Zahlen/Prozent und Wörter der Skala selbst sind verboten.
   * @returns {string|null} 'number' | 'scale' | null
   */
  function clueProblem(clue, scale) {
    const text = String(clue || '');
    if (!text.trim() || !scale) return null;
    if (/\d|%|prozent/i.test(text)) return 'number';
    const M = root.GameMatch;
    const norm = (t) => (M ? M.normalize(t) : String(t).toLowerCase());
    const words = (t) =>
      String(t)
        .split(/[\s\-–/,.!?]+/)
        .map(norm)
        .filter((w) => w.length >= 3 && !FILLER.has(w));
    const clueWords = words(text);
    for (const end of [scale.left, scale.right]) {
      for (const w of words(end)) {
        if (clueWords.some((c) => c === w || (M && M.same(c, w)) || (w.length >= 4 && c.includes(w)) || (c.length >= 4 && w.includes(c)))) return 'scale';
      }
    }
    return null;
  }

  class Engine {
    /**
     * @param {object} state Spielzustand (siehe Engine.create)
     * @param {{onChange?: Function, onKick?: Function, now?: Function, timers?: boolean, random?: Function, flip?: boolean}} hooks
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

    /**
     * Neues Spiel aus dem Setup.
     * @param {{settings: object, players?: {name: string, team?: string}[], teamNames?: string[]}} config
     *   players: Namen bei „Ein Gerät“ (mit Team bei 2 Teams). Mit einem Gerät startet das Spiel sofort,
     *   mit Handys beginnt es in der Lobby.
     */
    static create(config, hooks) {
      const settings = sanitizeSettings(config.settings);
      const state = {
        v: 1,
        game: GAME,
        settings,
        phase: 'lobby',
        members: {},
        players: [],
        teams: TEAMS.map((t, i) => ({ id: t.id, label: t.label, icon: t.icon, color: t.color, name: cleanName((config.teamNames || [])[i], 'Team ' + t.label), score: 0, rot: 0 })),
        active: 0,
        rot: 0,
        no: 0,
        cur: null,
        coop: null,
        tiebreak: null,
        winner: null,
        used: [],
        history: [],
        awards: [],
        startedAt: null,
        endedAt: null,
      };
      if (settings.input === 'one') {
        const list = (config.players || []).slice(0, MAX_PLAYERS);
        list.forEach((p, i) => {
          const team = settings.mode === 'teams' ? (TEAMS.some((t) => t.id === p.team) ? p.team : TEAMS[i % 2].id) : null;
          state.players.push({ id: 'p' + (i + 1), name: cleanName(p.name, 'Spieler ' + (i + 1)), team });
        });
        new Engine(state, Object.assign({ timers: false }, hooks)).startGame();
      }
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
      return this.s.settings.input === 'phones';
    }

    get coop() {
      return this.s.settings.mode === 'coop';
    }

    player(pid) {
      return this.s.players.find((p) => p.id === pid) || null;
    }

    playerName(pid) {
      const p = this.player(pid);
      if (p) return p.name;
      const m = this.s.members[pid];
      return m ? m.name : '?';
    }

    team(id) {
      return this.s.teams.find((t) => t.id === id) || null;
    }

    isOnline(pid) {
      if (!this.write) return !!this.player(pid);
      const m = this.s.members[pid];
      return !!(m && m.online);
    }

    /** Wird auf diese Person gewartet? (verbunden oder erst kurz weg) */
    awaited(pid) {
      if (this.isOnline(pid)) return true;
      const m = this.s.members[pid];
      return !!(m && m.offlineAt && this.now() - m.offlineAt < GRACE_MS);
    }

    /** Spielleitung am Handy (z.B. wenn die Bühne ein Fernseher ist): das erste noch verbundene Handy */
    leadPid() {
      if (!this.write) return null;
      let best = null;
      for (const [pid, m] of Object.entries(this.s.members)) {
        if (!m.online || !this.player(pid)) continue;
        if (!best || (m.joined || 0) < best.joined) best = { pid, joined: m.joined || 0 };
      }
      return best ? best.pid : null;
    }

    /** Darf diese Person die Runde steuern? (Laptop oder Spielleitung am Handy) */
    leads(actor) {
      return actor === STAGE || (!!actor && actor === this.leadPid());
    }

    /** Kennung des Zugs samt Skala – verhindert, dass verspätete Eingaben beim nächsten Zug landen */
    stepKey() {
      const cur = this.s.cur;
      return cur ? `${cur.no}-${cur.sNo}` : null;
    }

    /** Team, das gerade dran ist (kooperativ: null) */
    activeTeam() {
      return this.coop ? null : this.s.teams[this.s.active];
    }

    otherTeam() {
      return this.coop ? null : this.s.teams[1 - this.s.active];
    }

    /** Spieler eines Teams (kooperativ: alle) */
    teamPlayers(teamId) {
      return this.s.players.filter((p) => this.coop || p.team === teamId);
    }

    /** Wer darf den Zeiger drehen? Das Team am Zug ohne die hinweisgebende Person */
    guessers() {
      const cur = this.s.cur;
      if (!cur) return [];
      return this.teamPlayers(cur.team)
        .map((p) => p.id)
        .filter((pid) => pid !== cur.giver);
    }

    /** Wer tippt links/rechts? Das andere Team */
    opponents() {
      const other = this.otherTeam();
      if (!other) return [];
      return this.teamPlayers(other.id).map((p) => p.id);
    }

    /** Wie viele „Fertig“ braucht es? (2, oder weniger, wenn nicht so viele da sind) */
    locksNeeded() {
      const here = this.guessers().filter((pid) => this.awaited(pid)).length;
      return Math.max(1, Math.min(LOCKS_NEEDED, here));
    }

    /** Gibt es ein Gegnerteam, das links/rechts tippen kann? */
    sideActive() {
      return !this.coop && !!this.s.settings.sideGuess;
    }

    /* ---------- Verbindungen (mit Handys) ---------- */

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
      // Wer dazukommt, spielt mit (im laufenden Spiel im kleineren Team)
      else if (s.phase !== 'over' && s.players.length < MAX_PLAYERS) this.addPlayer(pid);
      this.checkProgress();
      this.changed();
    }

    addPlayer(pid) {
      const s = this.s;
      s.players.push({ id: pid, name: s.members[pid].name, team: this.smallerTeam() });
    }

    smallerTeam() {
      const count = (id) => this.s.players.filter((p) => p.team === id).length;
      return count('orange') < count('blau') ? 'orange' : 'blau';
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
      for (const t of s.teams) {
        t.score = 0;
        t.rot = 0;
      }
      // Ausgleich für den Vorteil, anzufangen: Das zweite Team startet mit 1 Punkt
      if (!this.coop) s.teams[1].score = 1;
      s.active = 0;
      s.rot = 0;
      s.no = 0;
      s.cur = null;
      s.coop = this.coop ? { total: COOP_SCALES, played: 0, score: 0, bonus: 0 } : null;
      s.tiebreak = null;
      s.winner = null;
      s.history = [];
      s.awards = [];
      s.startedAt = this.now();
      s.endedAt = null;
      s.phase = 'clue';
      this.newTurn();
    }

    /** Neuer Zug: hinweisgebende Person reihum, Skala ziehen, Ziel legen */
    newTurn() {
      const s = this.s;
      s.no += 1;
      const team = this.activeTeam();
      s.cur = { no: s.no, sNo: 0, team: team ? team.id : null, giver: null, rerolls: 0 };
      this.pickGiver();
      this.setupScale(this.drawScale());
    }

    /** Hinweisgeber/in reihum im Team (kooperativ: reihum alle) – Abgemeldete werden übersprungen */
    pickGiver() {
      const s = this.s;
      const cur = s.cur;
      const list = this.teamPlayers(cur.team);
      const holder = this.coop ? s : this.team(cur.team);
      cur.giver = null;
      for (let k = 0; k < list.length; k++) {
        const p = list[holder.rot % list.length];
        holder.rot += 1;
        if (this.isOnline(p.id)) {
          cur.giver = p.id;
          break;
        }
      }
      if (!cur.giver && list.length) cur.giver = list[(holder.rot - 1 + list.length) % list.length].id;
    }

    drawScale() {
      return Scales.draw(this.s.settings.categories, this.s.used, { random: this.random, flip: this.hooks.flip });
    }

    /** Skala setzen und alles für den Zug zurücksetzen (neues Ziel) */
    setupScale(scale) {
      const s = this.s;
      const cur = s.cur;
      const [lo, hi] = targetRange(s.settings.width);
      cur.scale = scale;
      cur.target = round1(lo + this.random() * (hi - lo));
      cur.dial = DIAL_START;
      cur.dialBy = null;
      cur.moved = false;
      cur.locks = [];
      cur.votes = {};
      cur.side = null;
      cur.clue = '';
      cur.result = null;
      cur.timerEnd = null;
      cur.timerTotal = 0;
      cur.startedAt = this.now();
      s.phase = 'clue';
    }

    /** Hinweis ist gegeben – das Team dreht den Zeiger */
    startDial(clue) {
      const s = this.s;
      const cur = s.cur;
      cur.clue = cleanText(clue, MAX_CLUE);
      cur.dial = DIAL_START;
      cur.locks = [];
      const sec = s.settings.timer;
      cur.timerTotal = sec * 1000;
      cur.timerEnd = sec ? this.now() + sec * 1000 : null;
      cur.startedAt = this.now();
      s.phase = 'dial';
    }

    /** Zeiger steht – Gegnerteam tippt (oder gleich aufdecken) */
    finishDial() {
      const s = this.s;
      s.cur.timerEnd = null;
      s.cur.locks = [];
      if (this.sideActive()) {
        s.cur.votes = {};
        s.phase = 'side';
      } else this.reveal();
    }

    /** Mehrheit der Stimmen (Gleichstand: rechts, keine Stimmen: kein Tipp) */
    majority() {
      const votes = Object.values(this.s.cur.votes || {});
      if (!votes.length) return null;
      const left = votes.filter((x) => x === 'left').length;
      return left > votes.length - left ? 'left' : 'right';
    }

    /** Aufdecken: Punkte, Links/Rechts-Tipp, Aufholregel, Spielende */
    reveal() {
      const s = this.s;
      const cur = s.cur;
      const pts = points(cur.dial, cur.target, s.settings.width);
      const res = { points: pts, deviation: round1(Math.abs(cur.dial - cur.target)), actual: sideOf(cur.dial, cur.target), sidePoint: 0, again: false, extra: false, tiebreak: false };
      cur.timerEnd = null;
      if (this.coop) {
        s.coop.played += 1;
        s.coop.score += pts;
        // Volltreffer: eine Skala extra
        if (pts === 4) {
          s.coop.total += 1;
          s.coop.bonus += 1;
          res.extra = true;
        }
      } else {
        const team = this.activeTeam();
        const other = this.otherTeam();
        team.score += pts;
        if (cur.side && res.actual && cur.side === res.actual) {
          other.score += 1;
          res.sidePoint = 1;
        }
        this.checkWinner(res);
        // Aufholregel: Wer eine 4 holt und trotzdem hinten liegt, ist gleich noch mal dran
        if (s.settings.catchUp && pts === 4 && !s.winner && !s.tiebreak && team.score < other.score) res.again = true;
      }
      cur.result = res;
      s.phase = 'reveal';
    }

    /** Spielende? Erstes Team mit genug Punkten – beide gleichzeitig: mehr Punkte, Gleichstand: Stechen */
    checkWinner(res) {
      const s = this.s;
      const [a, b] = s.teams;
      const goal = s.settings.goal;
      const leader = a.score > b.score ? a : b.score > a.score ? b : null;
      if (s.tiebreak) {
        // Stechen: Nach jeder Runde (beide Teams einmal dran) gewinnt, wer vorne liegt
        s.tiebreak.turns += 1;
        if (s.tiebreak.turns % 2 === 0 && leader) s.winner = leader.id;
        return;
      }
      if (a.score < goal && b.score < goal) return;
      if (leader) s.winner = leader.id;
      else {
        s.tiebreak = { turns: 0 };
        res.tiebreak = true;
      }
    }

    finish() {
      const s = this.s;
      s.phase = 'over';
      s.cur = null;
      s.endedAt = this.now();
      if (!this.coop && !s.winner) {
        const [a, b] = s.teams;
        s.winner = a.score > b.score ? a.id : b.score > a.score ? b.id : null;
      }
      s.awards = this.computeAwards();
      this.dispose();
    }

    pushHistory() {
      const s = this.s;
      const cur = s.cur;
      if (!cur || !cur.result) return;
      s.history.push({
        no: cur.no,
        team: cur.team,
        giver: cur.giver,
        giverName: this.playerName(cur.giver),
        left: cur.scale.left,
        right: cur.scale.right,
        custom: !!cur.scale.custom,
        clue: cur.clue,
        target: cur.target,
        dial: cur.dial,
        points: cur.result.points,
        deviation: cur.result.deviation,
        side: cur.side,
        sideOk: cur.result.sidePoint > 0,
      });
    }

    /** Mit Handys: Sind alle fertig? (auf Getrennte wird nach der Schonfrist nicht mehr gewartet) */
    checkProgress() {
      const s = this.s;
      const cur = s.cur;
      if (!cur || !this.write) return;
      if (s.phase === 'dial') {
        cur.locks = cur.locks.filter((pid) => this.guessers().includes(pid) && this.awaited(pid));
        if (cur.locks.length && cur.locks.length >= this.locksNeeded()) this.finishDial();
      } else if (s.phase === 'side') {
        const voters = this.opponents().filter((pid) => this.awaited(pid));
        if (voters.length && voters.every((pid) => cur.votes[pid])) {
          cur.side = this.majority();
          this.reveal();
        }
      }
    }

    /* ---------- Zeitlimit ---------- */

    nextDeadline() {
      const s = this.s;
      if (!s.cur || !['dial', 'side'].includes(s.phase)) return null;
      const ends = [];
      if (s.phase === 'dial' && s.cur.timerEnd) ends.push(s.cur.timerEnd);
      if (this.write) for (const m of Object.values(s.members)) if (!m.online && m.offlineAt) ends.push(m.offlineAt + GRACE_MS);
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

    /** Abgelaufene Zeit auswerten. Gibt true zurück, wenn sich etwas geändert hat. */
    tick() {
      const s = this.s;
      if (!s.cur || !['dial', 'side'].includes(s.phase)) return false;
      const before = s.phase;
      if (s.phase === 'dial' && s.cur.timerEnd && s.cur.timerEnd <= this.now()) {
        s.cur.timedOut = true;
        this.finishDial();
        return true;
      }
      this.checkProgress();
      return s.phase !== before;
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

    /** Aktion gehört zum aktuellen Zug? (a.at weglassen = egal) */
    current(a) {
      return a.at === undefined || a.at === this.stepKey();
    }

    /* Lobby */

    on_settings(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby') return false;
      s.settings = sanitizeSettings(Object.assign({}, a.settings, { input: s.settings.input }), s.settings);
      return true;
    }

    /** Team wählen (Handy für sich selbst, Laptop für alle) */
    on_joinTeam(a, actor) {
      const s = this.s;
      if (this.coop || s.phase !== 'lobby' || !TEAMS.some((t) => t.id === a.team)) return false;
      const pid = actor === STAGE ? a.player : actor;
      const p = this.player(pid);
      if (!p || p.team === a.team) return false;
      p.team = a.team;
      return true;
    }

    on_teamName(a, actor) {
      if (actor !== STAGE) return false;
      const t = this.team(a.team);
      if (!t) return false;
      t.name = cleanName(a.name, 'Team ' + t.label);
      return true;
    }

    on_kick(a, actor) {
      const s = this.s;
      if (actor !== STAGE || !this.write || !s.members[a.player]) return false;
      const pid = a.player;
      s.players = s.players.filter((p) => p.id !== pid);
      delete s.members[pid];
      if (this.hooks.onKick) this.hooks.onKick(pid);
      const cur = s.cur;
      if (cur && !['lobby', 'over'].includes(s.phase)) {
        cur.locks = cur.locks.filter((x) => x !== pid);
        delete cur.votes[pid];
        if (cur.giver === pid && s.phase !== 'reveal') {
          // Hinweisgeber/in weg: jemand anderes aus dem Team, neues Ziel (ohne Wertung)
          if (!this.teamPlayers(cur.team).length) this.finish();
          else this.restartTurn();
          return true;
        }
      }
      this.checkProgress();
      return true;
    }

    /** Zug mit einer anderen hinweisgebenden Person neu beginnen (neues Ziel, neue Skala) */
    restartTurn() {
      const cur = this.s.cur;
      cur.sNo += 1;
      cur.rerolls = 0;
      this.pickGiver();
      this.setupScale(this.drawScale());
    }

    lobbyProblem() {
      const s = this.s;
      const here = s.players.filter((p) => this.isOnline(p.id));
      if (this.coop) return here.length < MIN_COOP ? `Ihr braucht mindestens ${MIN_COOP} Personen – scannt den QR-Code!` : null;
      for (const t of s.teams) {
        const n = here.filter((p) => p.team === t.id).length;
        if (n < MIN_TEAM) return `${t.name} braucht mindestens ${MIN_TEAM} Personen.`;
      }
      return null;
    }

    on_start(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby' || this.lobbyProblem()) return false;
      s.players = s.players.filter((p) => this.isOnline(p.id));
      for (const p of s.players) if (!p.team) p.team = this.smallerTeam();
      this.startGame();
      return true;
    }

    /* Hinweis */

    /**
     * Neue Skala ziehen: Hinweisgeber/in einmal pro Zug (mit einem Gerät: der Laptop für sie/ihn).
     * Laptop und Spielleitung beliebig oft – a.force (aus dem Menü), sonst zählt es wie bei der hinweisgebenden Person.
     */
    on_reroll(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'clue' || !cur || !this.current(a)) return false;
      const asGiver = actor === cur.giver || (actor === STAGE && !this.write);
      if (!asGiver && !this.leads(actor)) return false;
      const free = !!a.force && this.leads(actor);
      if (asGiver && !free) {
        if (cur.rerolls >= MAX_REROLLS) return false;
        cur.rerolls += 1;
      }
      cur.sNo += 1;
      // Das Ziel bleibt – nur die Skala ist neu
      const target = cur.target;
      this.setupScale(this.drawScale());
      cur.target = target;
      return true;
    }

    /** Eigene Skala (Einstellung „Eigene Skala“) */
    on_customScale(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!s.settings.customScale || s.phase !== 'clue' || !cur || !this.current(a)) return false;
      if (actor !== cur.giver && !this.leads(actor)) return false;
      const left = cleanText(a.left, MAX_END);
      const right = cleanText(a.right, MAX_END);
      if (!left || !right || Scales.slug(left) === Scales.slug(right)) return false;
      cur.sNo += 1;
      const target = cur.target;
      this.setupScale(Scales.custom(left, right));
      cur.target = target;
      return true;
    }

    /** Andere Person gibt den Hinweis (z.B. Handy weg) – mit neuem Ziel */
    on_newGiver(a, actor) {
      const s = this.s;
      if (s.phase !== 'clue' || !s.cur || !this.leads(actor) || !this.current(a)) return false;
      if (this.teamPlayers(s.cur.team).length < 2) return false;
      this.restartTurn();
      return true;
    }

    /** Hinweis gegeben (getippt oder laut gesagt): Hinweisgeber/in am Handy, Laptop oder Spielleitung */
    on_clue(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'clue' || !cur || !this.current(a)) return false;
      if (actor !== cur.giver && !this.leads(actor)) return false;
      this.startDial(a.text);
      return true;
    }

    /* Zeiger */

    /** Zeiger drehen: das Team am Zug (ohne Hinweisgeber/in) oder der Laptop */
    on_dial(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'dial' || !cur || !this.current(a)) return false;
      if (actor !== STAGE && !this.guessers().includes(actor)) return false;
      const angle = Number(a.angle);
      if (!Number.isFinite(angle)) return false;
      const v = round1(Math.min(180, Math.max(0, angle)));
      if (v === cur.dial) return false;
      cur.dial = v;
      cur.dialBy = actor;
      cur.moved = true;
      // Wer schon „Fertig“ gesagt hat, muss nach einer Änderung neu zustimmen
      cur.locks = [];
      return true;
    }

    /** „Fertig“ im Team (nochmal = zurücknehmen) */
    on_lock(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!this.write || s.phase !== 'dial' || !cur || !this.current(a) || !this.guessers().includes(actor)) return false;
      if (cur.locks.includes(actor)) cur.locks = cur.locks.filter((x) => x !== actor);
      else cur.locks.push(actor);
      this.checkProgress();
      return true;
    }

    /** Zeiger festlegen ohne Abstimmung: Laptop, Spielleitung */
    on_lockNow(a, actor) {
      const s = this.s;
      if (s.phase !== 'dial' || !s.cur || !this.leads(actor) || !this.current(a)) return false;
      this.finishDial();
      return true;
    }

    /* Links / rechts */

    /** Gegnerteam stimmt ab (nochmal tippen = ändern) */
    on_vote(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'side' || !cur || !this.current(a) || !['left', 'right'].includes(a.side) || !this.opponents().includes(actor)) return false;
      if (cur.votes[actor] === a.side) return false;
      cur.votes[actor] = a.side;
      this.checkProgress();
      return true;
    }

    /** Tipp festlegen: Laptop (Gegnerteam ruft laut) oder Spielleitung */
    on_side(a, actor) {
      const s = this.s;
      if (s.phase !== 'side' || !s.cur || !this.leads(actor) || !this.current(a)) return false;
      if (!['left', 'right', null].includes(a.side == null ? null : a.side)) return false;
      s.cur.side = a.side || null;
      this.reveal();
      return true;
    }

    /** Abstimmung jetzt auswerten (auch wenn noch nicht alle getippt haben) */
    on_closeSide(a, actor) {
      const s = this.s;
      if (s.phase !== 'side' || !s.cur || !this.leads(actor) || !this.current(a)) return false;
      s.cur.side = this.majority();
      this.reveal();
      return true;
    }

    /* Weiter */

    on_next(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!this.leads(actor) || !cur || s.phase !== 'reveal') return false;
      if (a.no !== undefined && a.no !== cur.no) return false;
      this.pushHistory();
      if (s.winner) {
        this.finish();
        return true;
      }
      if (this.coop) {
        if (s.coop.played >= s.coop.total) {
          this.finish();
          return true;
        }
      } else if (!cur.result.again) s.active = 1 - s.active;
      this.newTurn();
      return true;
    }

    on_end(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase === 'lobby' || s.phase === 'over') return false;
      if (s.phase === 'reveal') this.pushHistory();
      this.finish();
      return true;
    }

    /** Nochmal mit denselben Leuten */
    on_again(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'over') return false;
      if (this.write) {
        s.phase = 'lobby';
        s.cur = null;
        s.history = [];
        s.awards = [];
        s.winner = null;
        s.tiebreak = null;
        s.coop = null;
        s.no = 0;
        for (const t of s.teams) t.score = 0;
        s.players = s.players.filter((p) => s.members[p.id]);
      } else this.startGame();
      return true;
    }

    /* ---------- Statistik ---------- */

    computeAwards() {
      const s = this.s;
      const out = [];
      const h = s.history;
      if (!h.length) return out;
      const scaleText = (x) => `${x.left} ↔ ${x.right}`;
      // „Anna: „Kaffee“ auf kalt ↔ heiß“ – laut gesagte Hinweise kennt die App nicht
      const clueText = (x) => (x.clue ? `${x.giverName}: „${x.clue}“ auf ${scaleText(x)}` : `${x.giverName} auf ${scaleText(x)}`);
      // 🎯 Volltreffer: die meisten 4er als Hinweisgeber/in
      const fours = {};
      for (const x of h) if (x.points === 4) fours[x.giverName] = (fours[x.giverName] || 0) + 1;
      const best = Object.entries(fours).sort((p, q) => q[1] - p[1]);
      if (best.length && (best.length < 2 || best[1][1] < best[0][1])) {
        out.push({ icon: '🎯', title: 'Volltreffer', text: `${best[0][0]} – ${best[0][1]}× die 4 als Hinweisgeber/in` });
      }
      // 📻 Gleiche Welle: Hinweis mit der geringsten Abweichung
      const sorted = h.slice().sort((p, q) => p.deviation - q.deviation);
      const top = sorted[0];
      if (top.points >= 3) {
        out.push({ icon: '📻', title: 'Gleiche Welle', text: `${clueText(top)} – nur ${String(top.deviation).replace('.', ',')}° daneben` });
      }
      // 🌀 Funkloch: größte Abweichung des Abends
      const worst = sorted[sorted.length - 1];
      if (worst !== top && worst.points === 0) {
        out.push({ icon: '🌀', title: 'Funkloch', text: `${clueText(worst)} – ${String(worst.deviation).replace('.', ',')}° daneben` });
      }
      // 🧭 Richtungsgefühl: das Team mit den meisten richtigen Links/Rechts-Tipps
      if (!this.coop) {
        const sides = {};
        for (const x of h) if (x.sideOk) {
          const other = s.teams.find((t) => t.id !== x.team);
          if (other) sides[other.name] = (sides[other.name] || 0) + 1;
        }
        const dir = Object.entries(sides).sort((p, q) => q[1] - p[1]);
        if (dir.length && dir[0][1] >= 2 && (dir.length < 2 || dir[1][1] < dir[0][1])) out.push({ icon: '🧭', title: 'Richtungsgefühl', text: `${dir[0][0]} – ${dir[0][1]}× richtig getippt, ob links oder rechts` });
      }
      return out;
    }

    /* ---------- Ansicht ---------- */

    timerView() {
      const cur = this.s.cur;
      if (!cur || !cur.timerEnd || this.s.phase !== 'dial') return null;
      return { total: cur.timerTotal, remaining: Math.max(0, cur.timerEnd - this.now()) };
    }

    curView(viewer) {
      const s = this.s;
      const cur = s.cur;
      if (!cur) return null;
      const stage = viewer === STAGE;
      const phase = s.phase;
      const revealed = phase === 'reveal';
      const votes = Object.values(cur.votes || {});
      const v = {
        no: cur.no,
        sNo: cur.sNo,
        key: this.stepKey(),
        team: cur.team,
        giver: cur.giver,
        giverName: this.playerName(cur.giver),
        scale: { left: cur.scale.left, right: cur.scale.right, cat: cur.scale.cat, custom: !!cur.scale.custom },
        rerolls: cur.rerolls,
        rerollsLeft: Math.max(0, MAX_REROLLS - cur.rerolls),
        clue: phase === 'clue' ? '' : cur.clue,
        dial: phase === 'clue' ? null : cur.dial,
        dialBy: cur.dialBy ? this.playerName(cur.dialBy) : null,
        moved: !!cur.moved,
        guessers: this.guessers(),
        opponents: this.opponents(),
        locks: cur.locks.slice(),
        needed: this.locksNeeded(),
        votes: { left: votes.filter((x) => x === 'left').length, right: votes.filter((x) => x === 'right').length, by: Object.keys(cur.votes || {}) },
        myVote: (cur.votes || {})[viewer] || null,
        side: phase === 'side' ? null : cur.side,
        timer: this.timerView(),
        timedOut: !!cur.timedOut,
        target: null,
        result: revealed ? clone(cur.result) : null,
      };
      // Das Ziel: bei der Auflösung für alle, vorher nur für die hinweisgebende Person (mit Handys)
      // bzw. auf dem Laptop in der Hinweis-Phase (ein Gerät – alle anderen schauen weg)
      const targetOk = revealed || (this.write && viewer === cur.giver) || (stage && !this.write && phase === 'clue');
      if (targetOk) v.target = cur.target;
      return v;
    }

    viewFor(viewer) {
      const s = this.s;
      const stage = viewer === STAGE;
      const me = stage ? null : this.player(viewer);
      return {
        game: GAME,
        phase: s.phase,
        settings: Object.assign({}, s.settings, { categories: s.settings.categories.slice() }),
        band: bandWidth(s.settings.width),
        players: s.players.map((p, i) => ({ id: p.id, name: p.name, team: this.coop ? null : p.team, color: PLAYER_COLORS[i % PLAYER_COLORS.length], online: this.isOnline(p.id) })),
        members: this.write ? Object.entries(s.members).map(([id, m]) => ({ id, name: m.name, online: m.online, playing: !!this.player(id) })) : [],
        teams: s.teams.map((t) => ({ id: t.id, label: t.label, icon: t.icon, name: t.name, color: t.color, score: t.score })),
        active: s.active,
        no: s.no,
        coop: s.coop ? Object.assign({}, s.coop, { rating: s.phase === 'over' ? coopRating(s.coop.score) : null }) : null,
        tiebreak: !!s.tiebreak,
        winner: s.winner,
        lobbyProblem: s.phase === 'lobby' && this.write ? this.lobbyProblem() : null,
        awards: clone(s.awards),
        history: s.phase === 'over' ? clone(s.history) : [],
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        cur: this.curView(viewer),
        me: stage
          ? { stage: true }
          : {
              id: viewer,
              name: (s.members[viewer] || {}).name || '',
              playing: !!me,
              team: me && !this.coop ? me.team : null,
              lead: viewer === this.leadPid(),
              stepKey: this.stepKey(),
            },
      };
    }
  }

  root.WLEngine = {
    Engine,
    GAME,
    STAGE,
    TEAMS,
    PLAYER_COLORS,
    MODES,
    GOALS,
    WIDTHS,
    WIDTH_IDS,
    TIMER_OPTIONS,
    BANDS,
    DEFAULT_SETTINGS,
    MIN_TEAM,
    MIN_COOP,
    MAX_PLAYERS,
    COOP_SCALES,
    LOCKS_NEEDED,
    MAX_REROLLS,
    DIAL_START,
    MAX_CLUE,
    MAX_END,
    GRACE_MS,
    COOP_RATINGS,
    coopRating,
    bandWidth,
    targetRange,
    points,
    sideOf,
    clueProblem,
    sanitizeSettings,
    cleanName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
