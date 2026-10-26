/*
 * Spiellogik von „Farbgefühl“ – unsere Version von Hues and Cues.
 *
 * Auf der Farbtafel (board.js, 30 × 16 Felder) wählt die hinweisgebende Person geheim eine von 4 Kartenfarben
 * und beschreibt sie mit einem Wort. Alle anderen setzen reihum einen Stein (ein Stein pro Feld), dann gibt es
 * einen zweiten Hinweis (ein oder zwei Wörter, darf auch weggelassen werden) und einen zweiten Stein in
 * umgekehrter Reihenfolge. Aufgedeckt wird mit einem Rahmen:
 *   genau 3 · im 3 × 3-Rahmen 2 · direkt am Rahmen 1 – die hinweisgebende Person bekommt 1 Punkt pro Stein im Rahmen.
 *
 * „Mitspielende“ (players) sind Personen – oder bei Teams die Teams. Handys (members) gehören zu einer Person
 * bzw. einem Team. Wer kein Handy hat (oder gerade offline ist), wird am Laptop gesteuert (stageControls).
 *
 * Spielweisen (settings.input):
 *  - single: Ein Gerät. Die geheime Karte zeigt der Laptop hinter „Alle wegschauen“, gesetzt wird per Klick.
 *  - phones: Der Laptop ist die Bühne und öffnet einen Raum. Karte, Hinweis und Steine kommen vom Handy.
 *            Das erste verbundene Handy ist die Spielleitung und darf weiterschalten.
 * Setzen (settings.order): turns = reihum wie im Original · simultaneous = alle gleichzeitig (nur mit Handys),
 * dann dürfen auch mehrere Steine auf einem Feld liegen und man sieht die fremden erst, wenn alle gesetzt haben.
 *
 * Phasen: lobby (nur Handys) → pick → cue (1) → place (1) → cue (2) → place (2) → reveal → pick … → end
 * Geheim: Karte und Zielfarbe sieht vor dem Aufdecken nur, wer den Hinweis gibt (bzw. der Laptop, wenn er
 * für diese Person spielt). Die Zeit pro Stein misst die Oberfläche des Laptops und schickt dann 'timeout'.
 */
(function (root) {
  'use strict';

  const Board = root.FGBoard;
  const Cards = root.FGCards;
  const Cues = root.FGCues;

  const STAGE = 'stage';
  const GAME = 'farbgefuehl';
  const INPUTS = ['single', 'phones'];
  const ORDERS = ['turns', 'simultaneous'];
  const ROUNDS = [0, 1, 2, 3]; // 0 = automatisch nach Personenzahl
  const TIMERS = [0, 20, 30, 45];
  const TEAMS = [0, 2, 3, 4];
  const COORDS = ['edge', 'all', 'off'];
  const MIN_PLAYERS = 3;
  const MIN_TEAMS = 2;
  const MAX_PLAYERS = 10;
  const GOAL = 50;
  const AWARD_MAX = 3;
  const PLAYER_COLORS = [
    { id: 'red', hex: '#ef4444', name: 'Rot' },
    { id: 'blue', hex: '#3b82f6', name: 'Blau' },
    { id: 'green', hex: '#22c55e', name: 'Grün' },
    { id: 'yellow', hex: '#facc15', name: 'Gelb' },
    { id: 'purple', hex: '#a855f7', name: 'Lila' },
    { id: 'orange', hex: '#f97316', name: 'Orange' },
    { id: 'pink', hex: '#ec4899', name: 'Pink' },
    { id: 'teal', hex: '#14b8a6', name: 'Türkis' },
    { id: 'white', hex: '#f8fafc', name: 'Weiß' },
    { id: 'black', hex: '#1f2937', name: 'Schwarz' },
  ];
  const COLOR_IDS = PLAYER_COLORS.map((c) => c.id);
  const DEFAULT_SETTINGS = {
    input: 'phones',
    order: 'turns',
    rounds: 0,
    to50: false,
    secondCue: true,
    typedCues: false,
    cueCheck: true,
    coords: 'edge',
    timer: 0,
    teams: 0,
    freePick: false,
    blind: false,
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

  function same(a, b) {
    return String(a).toLowerCase() === String(b).toLowerCase();
  }

  function sanitizeSettings(input, current) {
    const s = Object.assign({}, DEFAULT_SETTINGS, current || {});
    const i = input || {};
    if (INPUTS.includes(i.input)) s.input = i.input;
    if (ORDERS.includes(i.order)) s.order = i.order;
    if (i.rounds !== undefined && ROUNDS.includes(+i.rounds)) s.rounds = +i.rounds;
    if (i.timer !== undefined && TIMERS.includes(+i.timer)) s.timer = +i.timer;
    if (i.teams !== undefined && TEAMS.includes(+i.teams)) s.teams = +i.teams;
    if (COORDS.includes(i.coords)) s.coords = i.coords;
    for (const k of ['to50', 'secondCue', 'typedCues', 'cueCheck', 'freePick', 'blind', 'drinks']) if (typeof i[k] === 'boolean') s[k] = i[k];
    // Gleichzeitig setzen geht nur mit Handys
    if (s.input !== 'phones') s.order = 'turns';
    return s;
  }

  function emptyStats() {
    return { stones: 0, stonePoints: 0, bullseyes: 0, far: 0, givers: 0, giverPoints: 0 };
  }

  function colorHex(id) {
    const c = PLAYER_COLORS.find((x) => x.id === id);
    return c ? c.hex : '#888888';
  }

  class Engine {
    /**
     * @param {object} state Spielzustand (siehe Engine.create)
     * @param {{onChange?: Function, onKick?: Function, random?: Function, now?: Function}} hooks
     */
    constructor(state, hooks) {
      this.s = state;
      this.hooks = hooks || {};
      this.random = this.hooks.random || Math.random;
      this.now = this.hooks.now || Date.now;
      state.settings = sanitizeSettings({}, state.settings);
      state.members = state.members || {};
      for (const p of state.players) p.stats = Object.assign(emptyStats(), p.stats);
      // Fortgesetztes Spiel: die Zeit für den aktuellen Stein beginnt neu
      if (state.phase === 'place' && state.deadline) this.resetTimer();
    }

    /**
     * Neues Spiel aus dem Setup.
     * @param {{settings: object, players?: string[]}} config
     *   players: Namen (Ein Gerät: alle Personen bzw. Teams; Handys: nur wer kein Handy hat bzw. die Teams)
     */
    static create(config, hooks) {
      const settings = sanitizeSettings(config.settings);
      const state = {
        v: 1,
        game: GAME,
        settings,
        phase: 'lobby',
        step: 0,
        players: [],
        members: {},
        nextId: 1,
        turnNo: 0,
        giver: null,
        card: [],
        target: null,
        cues: [],
        cueRound: 1,
        round: 0,
        queue: [],
        stones: [],
        skipped: [],
        deadline: null,
        tiebreak: false,
        usedCues: [],
        usedTargets: [],
        result: null,
        history: [],
        event: null,
        eventNo: 0,
      };
      const e = new Engine(state, hooks);
      const teams = settings.teams;
      const names = (config.players || []).map((x) => cleanName(x, '')).filter(Boolean);
      if (teams) {
        for (let i = 0; i < teams; i++) e.addPlayer(names[i] || 'Team ' + PLAYER_COLORS[i].name);
      } else {
        for (const n of names) e.addPlayer(n);
      }
      if (settings.input !== 'phones') {
        while (state.players.length < e.minPlayers) e.addPlayer('Person ' + (state.players.length + 1));
        e.startGame();
      }
      return state;
    }

    dispose() {}

    changed() {
      if (this.hooks.onChange) this.hooks.onChange();
    }

    /* ---------- Hilfsfunktionen ---------- */

    get write() {
      return this.s.settings.input === 'phones';
    }

    get teams() {
      return !!this.s.settings.teams;
    }

    get minPlayers() {
      return this.teams ? MIN_TEAMS : MIN_PLAYERS;
    }

    get maxPlayers() {
      return this.teams ? TEAMS[TEAMS.length - 1] : MAX_PLAYERS;
    }

    get simultaneous() {
      return this.write && this.s.settings.order === 'simultaneous';
    }

    player(id) {
      return this.s.players.find((p) => p.id === id) || null;
    }

    /** Person/Team, zu der das Handy gehört */
    playerOfPhone(pid) {
      const m = this.s.members[pid];
      return m && m.player ? this.player(m.player) : null;
    }

    phonesOf(p) {
      return Object.keys(this.s.members).filter((pid) => this.s.members[pid].player === p.id);
    }

    /** Hat die Person/das Team gerade ein verbundenes Handy? */
    onlinePhone(p) {
      return this.phonesOf(p).some((pid) => this.s.members[pid].online);
    }

    /** Spielt der Laptop für diese Person? (Ein Gerät, kein Handy oder Handy gerade weg) */
    stageControls(p) {
      return !!p && (!this.write || !this.onlinePhone(p));
    }

    /** Darf actor für p handeln? */
    canActAs(actor, p) {
      if (!p) return false;
      if (actor === STAGE) return this.stageControls(p);
      const me = this.playerOfPhone(actor);
      return !!me && me.id === p.id;
    }

    /** Spielleitung: das erste verbundene Handy (darf weiterschalten) */
    leader() {
      for (const [pid, m] of Object.entries(this.s.members)) if (m.online) return pid;
      return null;
    }

    canLead(actor) {
      return actor === STAGE || (!!actor && actor === this.leader());
    }

    event(kind, extra) {
      this.s.event = Object.assign({ n: ++this.s.eventNo, kind }, extra || {});
    }

    bump() {
      this.s.step += 1;
    }

    /** Aktion passt nicht (mehr) zum aktuellen Stand? (doppelt getippt, veraltete Ansicht) */
    stale(a) {
      return a.at !== undefined && a.at !== this.s.step;
    }

    uniqueName(name) {
      let out = name;
      let k = 2;
      while (this.s.players.some((p) => same(p.name, out))) out = `${name} ${k++}`;
      return out;
    }

    freeColor() {
      const used = new Set(this.s.players.map((p) => p.color));
      return COLOR_IDS.find((c) => !used.has(c)) || COLOR_IDS[this.s.players.length % COLOR_IDS.length];
    }

    addPlayer(name, phone) {
      const s = this.s;
      if (s.players.length >= this.maxPlayers) return null;
      const p = {
        id: 'p' + s.nextId++,
        name: this.uniqueName(cleanName(name, (this.teams ? 'Team ' : 'Person ') + (s.players.length + 1))),
        color: this.freeColor(),
        phone: phone || null,
        score: 0,
        stats: emptyStats(),
      };
      s.players.push(p);
      if (phone && s.members[phone]) s.members[phone].player = p.id;
      return p;
    }

    /** Verbunden? (wer kein Handy hat, zählt immer als da) */
    online(p) {
      return !this.write || !this.phonesOf(p).length || this.onlinePhone(p);
    }

    /* ---------- Verbindungen (Mit Handys) ---------- */

    /**
     * Handy meldet sich. Einzeln: gleicher Name wie eine eingetragene Person ohne Handy → das ist sie,
     * sonst kommt eine neue Person dazu. Teams: das Handy landet im kleinsten Team (wechseln mit 'team').
     */
    connect(pid, name) {
      const s = this.s;
      const clean = cleanName(name, 'Gast');
      const m = s.members[pid] || (s.members[pid] = { name: clean, online: true, player: null });
      m.online = true;
      if (name) m.name = clean;
      if (!this.playerOfPhone(pid)) {
        m.player = null;
        if (this.teams) {
          this.assignTeam(pid);
        } else {
          let p = s.players.find((x) => !x.phone && same(x.name, clean));
          if (p) {
            p.phone = pid;
            m.player = p.id;
          } else if (s.phase !== 'end') {
            p = this.addPlayer(clean, pid);
            if (p && s.phase !== 'lobby') this.event('joined', { name: p.name });
          }
        }
      }
      this.changed();
    }

    /** Teams: Handy ins Team mit den wenigsten Handys */
    assignTeam(pid) {
      const counts = this.s.players.map((p) => ({ p, n: this.phonesOf(p).length }));
      counts.sort((a, b) => a.n - b.n);
      this.s.members[pid].player = counts.length ? counts[0].p.id : null;
    }

    disconnect(pid) {
      const m = this.s.members[pid];
      if (!m || !m.online) return;
      m.online = false;
      this.changed();
    }

    /** Nach dem Neuladen des Hosts: alle müssen sich neu verbinden */
    setAllOffline() {
      for (const m of Object.values(this.s.members)) m.online = false;
    }

    /* ---------- Ablauf ---------- */

    /** Durchgänge: eingestellt oder automatisch (bis 6 Personen 2, sonst 1 · Teams: 2 Teams 3, sonst 2) */
    roundsTotal() {
      const n = this.s.players.length;
      if (this.s.settings.rounds) return this.s.settings.rounds;
      if (this.teams) return n <= 2 ? 3 : 2;
      return n <= 6 ? 2 : 1;
    }

    turnsTotal() {
      return this.roundsTotal() * this.s.players.length;
    }

    giverPlayer() {
      return this.player(this.s.giver);
    }

    startGame() {
      const s = this.s;
      s.turnNo = 0;
      s.tiebreak = false;
      this.beginTurn();
    }

    /** Neuer Zug: nächste Person gibt den Hinweis, neue Karte */
    beginTurn() {
      const s = this.s;
      const n = s.players.length;
      s.giver = n ? s.players[s.turnNo % n].id : null;
      s.card = s.settings.freePick ? [] : Cards.draw(this.random, s.usedTargets);
      s.target = null;
      s.cues = [];
      s.cueRound = 1;
      s.round = 0;
      s.queue = [];
      s.stones = [];
      s.skipped = [];
      s.deadline = null;
      s.result = null;
      s.phase = 'pick';
      this.bump();
    }

    /** Reihenfolge zum Setzen: Runde 1 im Uhrzeigersinn ab der Person nach dem Hinweisgeber, Runde 2 umgekehrt */
    placeOrder(round) {
      const s = this.s;
      const n = s.players.length;
      const g = s.players.findIndex((p) => p.id === s.giver);
      const out = [];
      for (let k = 1; k < n; k++) out.push(s.players[(g + k) % n].id);
      return round === 2 ? out.reverse() : out;
    }

    resetTimer() {
      const t = this.s.settings.timer;
      this.s.deadline = t ? this.now() + t * 1000 : null;
    }

    startPlacing(round) {
      const s = this.s;
      s.round = round;
      s.queue = this.placeOrder(round);
      s.phase = 'place';
      this.resetTimer();
      this.checkPlaced();
    }

    /** Alle haben gesetzt? → zweiter Hinweis oder Aufdecken */
    checkPlaced() {
      const s = this.s;
      if (s.queue.length) return;
      s.deadline = null;
      if (s.round === 1 && s.settings.secondCue) {
        s.cueRound = 2;
        s.phase = 'cue';
      } else {
        this.reveal();
      }
    }

    cellTaken(cell) {
      return this.s.stones.some((x) => Board.same(x, cell));
    }

    /** Aufdecken: Punkte für alle Steine und für die hinweisgebende Person */
    reveal() {
      const s = this.s;
      const target = s.target;
      const giver = this.giverPlayer();
      const drinks = s.settings.drinks;
      const stones = s.stones.map((x) => Object.assign({}, x, { points: Board.points(x, target), dist: Board.dist(x, target) }));
      const lines = [];
      for (const p of s.players) {
        if (p.id === s.giver) continue;
        const mine = stones.filter((x) => x.player === p.id);
        const points = mine.reduce((sum, x) => sum + x.points, 0);
        const bulls = mine.filter((x) => x.points === 3).length;
        p.score += points;
        p.stats.stones += mine.length;
        p.stats.stonePoints += points;
        p.stats.bullseyes += bulls;
        for (const x of mine) p.stats.far = Math.max(p.stats.far, x.dist);
        const line = { id: p.id, points, bulls, stones: mine.length };
        if (drinks) {
          line.drink = mine.filter((x) => x.points === 0).length;
          line.give = bulls * 2;
        }
        lines.push(line);
      }
      const framed = stones.filter((x) => Board.inFrame(x, target)).length;
      if (giver) {
        giver.score += framed;
        giver.stats.givers += 1;
        giver.stats.giverPoints += framed;
      }
      lines.sort((a, b) => b.points - a.points);
      s.result = {
        turn: s.turnNo + 1,
        giver: s.giver,
        target: clone(target),
        card: clone(s.card),
        cues: clone(s.cues),
        stones,
        lines,
        giverPoints: framed,
        tiebreak: s.tiebreak,
      };
      s.history.push({
        turn: s.turnNo + 1,
        giver: s.giver,
        target: clone(target),
        cues: clone(s.cues),
        giverPoints: framed,
        points: Object.fromEntries(lines.map((l) => [l.id, l.points])),
        bulls: lines.filter((l) => l.bulls).map((l) => l.id),
      });
      s.phase = 'reveal';
      this.event('reveal', { bulls: lines.reduce((n, l) => n + l.bulls, 0) });
    }

    /** Spitzenreiter (bei Gleichstand mehrere) */
    leaders() {
      const max = Math.max(...this.s.players.map((p) => p.score));
      return this.s.players.filter((p) => p.score === max);
    }

    /** Ist das Spiel nach diesem Zug vorbei (ohne Stechen)? */
    over() {
      const s = this.s;
      if (s.settings.to50) return s.players.some((p) => p.score >= GOAL);
      return s.turnNo + 1 >= this.turnsTotal();
    }

    finish() {
      const s = this.s;
      s.phase = 'end';
      s.queue = [];
      s.deadline = null;
      this.bump();
    }

    /* ---------- Aktionen ---------- */

    /**
     * Verarbeitet eine Aktion. Gibt true zurück, wenn sich etwas geändert hat.
     * @param {object} a Aktion {type, ...}
     * @param {string} actor 'stage' (Laptop) oder Handy-ID
     */
    apply(a, actor) {
      if (!a || typeof a.type !== 'string') return false;
      const handler = this['on_' + a.type];
      if (typeof handler !== 'function') return false;
      const ok = handler.call(this, a, actor) === true;
      if (ok) this.changed();
      return ok;
    }

    lobbyProblem() {
      const n = this.s.players.length;
      if (n < this.minPlayers) return this.teams ? `Mindestens ${MIN_TEAMS} Teams nötig.` : `Mindestens ${MIN_PLAYERS} Personen nötig (gerade ${n}).`;
      return null;
    }

    /** Lobby → los (Mit Handys) */
    on_open(a, actor) {
      if (actor !== STAGE || this.s.phase !== 'lobby' || this.lobbyProblem()) return false;
      this.startGame();
      return true;
    }

    /** Zielfarbe wählen: index (0–3) auf der Karte oder bei freier Wahl ein Feld cell */
    on_pick(a, actor) {
      const s = this.s;
      if (s.phase !== 'pick' || this.stale(a) || !this.canActAs(actor, this.giverPlayer())) return false;
      let cell = null;
      if (s.settings.freePick) cell = a.cell && Board.valid(a.cell) ? { r: a.cell.r, c: a.cell.c } : null;
      else if (Number.isInteger(a.index) && s.card[a.index]) cell = clone(s.card[a.index]);
      if (!cell) return false;
      s.target = cell;
      s.usedTargets.push(Board.label(cell));
      s.cueRound = 1;
      s.phase = 'cue';
      this.bump();
      return true;
    }

    /** Hinweis geben. text leer = laut gesagt (nur am Laptop) */
    on_cue(a, actor) {
      const s = this.s;
      if (s.phase !== 'cue' || this.stale(a) || !this.canActAs(actor, this.giverPlayer())) return false;
      const text = Cues.clean(a.text);
      if (!text && actor !== STAGE) return false;
      s.cues[s.cueRound - 1] = text || null;
      if (text) s.usedCues.push(text);
      this.event('cue', { round: s.cueRound });
      this.startPlacing(s.cueRound);
      this.bump();
      return true;
    }

    /** Auf den zweiten Hinweis verzichten → gleich aufdecken */
    on_skipCue(a, actor) {
      const s = this.s;
      if (s.phase !== 'cue' || s.cueRound !== 2 || this.stale(a) || !this.canActAs(actor, this.giverPlayer())) return false;
      s.cues[1] = '';
      this.reveal();
      this.bump();
      return true;
    }

    /**
     * Stein setzen. Reihum: wer dran ist (Handy: die eigene Person, Laptop: für Personen ohne Handy).
     * Gleichzeitig: alle, die noch nicht gesetzt haben (Laptop mit player).
     */
    on_place(a, actor) {
      const s = this.s;
      if (s.phase !== 'place' || !a.cell || !Board.valid(a.cell)) return false;
      const cell = { r: a.cell.r, c: a.cell.c };
      let p;
      if (this.simultaneous) {
        p = actor === STAGE ? this.player(a.player) : this.playerOfPhone(actor);
        if (!p || !s.queue.includes(p.id) || !this.canActAs(actor, p)) return false;
      } else {
        p = this.player(s.queue[0]);
        if (!p || (a.player && a.player !== p.id) || !this.canActAs(actor, p) || this.cellTaken(cell)) return false;
      }
      s.stones.push({ player: p.id, r: cell.r, c: cell.c, round: s.round });
      s.queue = s.queue.filter((id) => id !== p.id);
      this.event('placed', { player: p.id });
      if (!this.simultaneous) this.resetTimer();
      this.checkPlaced();
      this.bump();
      return true;
    }

    /** Letzten Stein zurücknehmen (Laptop, reihum, nur in der laufenden Runde und nur eigene Laptop-Steine) */
    on_undo(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'place' || this.simultaneous) return false;
      const last = s.stones[s.stones.length - 1];
      if (!last || last.round !== s.round || !this.stageControls(this.player(last.player))) return false;
      s.stones.pop();
      s.queue.unshift(last.player);
      this.resetTimer();
      this.bump();
      return true;
    }

    /** Wer gerade dran ist (reihum) bzw. alle Fehlenden (gleichzeitig) setzen diesmal aus */
    skipWaiting(reason) {
      const s = this.s;
      const ids = this.simultaneous ? s.queue.slice() : s.queue.slice(0, 1);
      if (!ids.length) return false;
      for (const id of ids) s.skipped.push({ player: id, round: s.round, reason });
      s.queue = s.queue.filter((id) => !ids.includes(id));
      this.event(reason, { names: ids.map((id) => (this.player(id) || {}).name) });
      if (s.queue.length && !this.simultaneous) this.resetTimer();
      this.checkPlaced();
      this.bump();
      return true;
    }

    on_skip(a, actor) {
      if (this.s.phase !== 'place' || this.stale(a) || !this.canLead(actor)) return false;
      return this.skipWaiting('skip');
    }

    /** Zeit abgelaufen (schickt die Oberfläche des Laptops) */
    on_timeout(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'place' || !s.deadline || this.stale(a)) return false;
      return this.skipWaiting('timeout');
    }

    /** Nach dem Aufdecken: nächster Zug, Stechen oder Ende */
    on_next(a, actor) {
      const s = this.s;
      if (s.phase !== 'reveal' || this.stale(a) || !this.canLead(actor)) return false;
      if (s.tiebreak || this.over()) {
        if (this.leaders().length > 1) {
          s.tiebreak = true;
          s.turnNo += 1;
          this.event('tiebreak', { names: this.leaders().map((p) => p.name) });
          this.beginTurn();
        } else {
          this.finish();
        }
        return true;
      }
      s.turnNo += 1;
      this.beginTurn();
      return true;
    }

    on_finish(a, actor) {
      if (actor !== STAGE || this.s.phase === 'end') return false;
      this.finish();
      return true;
    }

    /** Nochmal mit denselben Leuten */
    on_again(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'end' || s.players.length < this.minPlayers) return false;
      for (const p of s.players) {
        p.score = 0;
        p.stats = emptyStats();
      }
      s.history = [];
      s.usedCues = [];
      s.usedTargets = [];
      this.startGame();
      return true;
    }

    /** Einstellungen: jederzeit; Spielweise und Teams bleiben, Karte/Varianten gelten ab dem nächsten Zug */
    on_settings(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase === 'end') return false;
      const keep = { input: s.settings.input, teams: s.settings.teams };
      // Mitten im Setzen nicht zwischen reihum und gleichzeitig wechseln
      if (s.phase === 'place') keep.order = s.settings.order;
      s.settings = sanitizeSettings(Object.assign({}, a.settings, keep), s.settings);
      if (s.phase === 'place') this.resetTimer();
      if (s.phase === 'pick' && !s.settings.freePick && !s.card.length) s.card = Cards.draw(this.random, s.usedTargets);
      return true;
    }

    on_addPlayer(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase === 'end') return false;
      const name = cleanName(a.name, '');
      if (!name || !this.addPlayer(name)) return false;
      return true;
    }

    on_removePlayer(a, actor) {
      const s = this.s;
      const p = this.player(a.player);
      if (actor !== STAGE || !p || (s.phase !== 'lobby' && s.players.length <= this.minPlayers)) return false;
      s.players = s.players.filter((x) => x !== p);
      for (const pid of this.phonesOf(p)) {
        if (this.teams) {
          s.members[pid].player = null;
        } else {
          delete s.members[pid];
          if (this.hooks.onKick) this.hooks.onKick(pid);
        }
      }
      if (this.teams) for (const pid of Object.keys(s.members)) if (!s.members[pid].player) this.assignTeam(pid);
      s.stones = s.stones.filter((x) => x.player !== p.id);
      s.queue = s.queue.filter((id) => id !== p.id);
      if (s.phase !== 'lobby' && s.phase !== 'end') {
        if (s.giver === p.id) {
          // Hinweisgeber weg: Zug neu beginnen (dieselbe Zugnummer, nächste Person)
          this.beginTurn();
        } else if (s.phase === 'place') {
          this.checkPlaced();
        }
      }
      this.bump();
      return true;
    }

    /** Sitzordnung ändern (wichtig für reihum): dir -1 = nach vorn, +1 = nach hinten */
    on_move(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase === 'place' || s.phase === 'cue') return false;
      const i = s.players.findIndex((p) => p.id === a.player);
      const j = i + (+a.dir === -1 ? -1 : 1);
      if (i < 0 || j < 0 || j >= s.players.length) return false;
      [s.players[i], s.players[j]] = [s.players[j], s.players[i]];
      return true;
    }

    /** Spielerfarbe wählen (Handy: eigene, Laptop: beliebige) */
    on_color(a, actor) {
      const s = this.s;
      const p = actor === STAGE ? this.player(a.player) : this.playerOfPhone(actor);
      if (!p || !COLOR_IDS.includes(a.color) || p.color === a.color) return false;
      const other = s.players.find((x) => x.color === a.color);
      if (other) other.color = p.color; // tauschen
      p.color = a.color;
      return true;
    }

    /** Teams: Handy wechselt das Team (nicht mitten im eigenen Zug als Hinweisgeber) */
    on_team(a, actor) {
      const s = this.s;
      const m = s.members[actor];
      const t = this.player(a.team);
      if (!this.teams || !m || !t || m.player === t.id) return false;
      if (s.phase !== 'lobby' && s.phase !== 'reveal' && s.phase !== 'end' && m.player === s.giver) return false;
      m.player = t.id;
      return true;
    }

    /* ---------- Ansicht ---------- */

    /**
     * Auszeichnungen über alle bisherigen Züge. Gleichstand → mehrere Namen, aber nur solange
     * die Auszeichnung jemanden heraushebt (höchstens AWARD_MAX Namen und nicht alle).
     * @returns {{id, icon, title, names: string[], text, swatch?: string}[]}
     */
    awards() {
      const s = this.s;
      if (!s.history.length) return [];
      const ps = s.players;
      const out = [];
      const special = (names) => names.length <= AWARD_MAX && names.length < ps.length;
      const best = (fn, icon, id, title, text) => {
        const max = Math.max(0, ...ps.map(fn));
        const names = ps.filter((p) => fn(p) === max).map((p) => p.name);
        if (max && special(names)) out.push({ id, icon, title, names, text: text(max) });
      };
      best((p) => p.stats.bullseyes, '🎯', 'eagle', 'Adlerauge', (n) => `${n}× genau getroffen`);
      best((p) => p.stats.giverPoints, '🗣️', 'poet', 'Farbpoet:in', (n) => `${n} Punkte als Hinweisgeber`);
      // Farbenblind erst ab einem Stein, der richtig weit daneben lag (außerhalb jeder Wertung)
      best((p) => (p.stats.far >= 3 ? p.stats.far : 0), '🌫️', 'blind', 'Farbenblind', (n) => `ein Stein ${n} Felder daneben`);
      const top = s.history.filter((h) => h.cues.some(Boolean)).sort((x, y) => y.giverPoints - x.giverPoints)[0];
      if (top && top.giverPoints > 0) {
        const p = this.player(top.giver);
        out.push({
          id: 'cue',
          icon: '💡',
          title: 'Bester Hinweis',
          names: [p ? p.name : '?'],
          text: `„${top.cues.filter(Boolean).join(' · ')}“ – ${top.giverPoints} Steine im Rahmen`,
          swatch: Board.color(top.target),
        });
      }
      return out;
    }

    standings() {
      return this.s.players
        .map((p) => ({ id: p.id, name: p.name, color: p.color, score: p.score, stats: clone(p.stats) }))
        .sort((x, y) => y.score - x.score || y.stats.bullseyes - x.stats.bullseyes || x.name.localeCompare(y.name));
    }

    /** Steine für einen Betrachter. Gleichzeitig: fremde Steine der laufenden Runde erst, wenn alle gesetzt haben */
    stonesFor(me) {
      const s = this.s;
      const hide = this.simultaneous && s.phase === 'place';
      return s.stones.filter((x) => !hide || x.round !== s.round || (me && x.player === me.id)).map((x) => ({ player: x.player, r: x.r, c: x.c, round: x.round }));
    }

    viewFor(viewer) {
      const s = this.s;
      const stage = viewer === STAGE;
      const mine = stage ? null : this.playerOfPhone(viewer);
      const giver = this.giverPlayer();
      const active = !['lobby', 'reveal', 'end'].includes(s.phase);
      // Geheimnis: nur wer den Hinweis gibt – bzw. der Laptop, wenn er für diese Person spielt
      const knows = active && giver && (stage ? this.stageControls(giver) : !!mine && mine.id === giver.id);
      const current = !this.simultaneous && s.phase === 'place' ? s.queue[0] || null : null;
      const leader = this.leader();
      const n = s.players.length;
      return {
        game: GAME,
        phase: s.phase,
        step: s.step,
        settings: clone(s.settings),
        players: s.players.map((p) => ({
          id: p.id,
          name: p.name,
          color: p.color,
          hex: colorHex(p.color),
          score: p.score,
          phone: this.phonesOf(p).length > 0,
          online: this.online(p),
          stage: this.stageControls(p),
          members: this.teams ? this.phonesOf(p).map((pid) => ({ name: s.members[pid].name, online: s.members[pid].online })) : [],
        })),
        turnNo: s.turnNo,
        turnsTotal: this.turnsTotal(),
        roundsTotal: this.roundsTotal(),
        roundNo: n ? Math.floor(s.turnNo / n) + 1 : 1,
        tiebreak: s.tiebreak,
        giver: s.giver,
        cueRound: s.cueRound,
        cues: clone(s.cues),
        round: s.round,
        current,
        waiting: s.phase === 'place' ? s.queue.slice() : [],
        stones: this.stonesFor(mine),
        skipped: clone(s.skipped),
        secret: knows ? { card: clone(s.card), target: clone(s.target) } : null,
        hasCard: s.card.length > 0,
        timerLeft: s.phase === 'place' && s.deadline ? Math.max(0, s.deadline - this.now()) : null,
        usedCues: s.usedCues.slice(),
        result: clone(s.result),
        over: s.phase === 'reveal' && (s.tiebreak || this.over()),
        history: clone(s.history),
        standings: this.standings(),
        awards: s.phase === 'end' ? this.awards() : [],
        lobbyProblem: s.phase === 'lobby' ? this.lobbyProblem() : null,
        event: clone(s.event),
        me: {
          stage,
          host: stage,
          id: mine ? mine.id : null,
          name: stage ? '' : (s.members[viewer] || {}).name || '',
          phone: !stage,
          leader: !stage && viewer === leader,
        },
      };
    }
  }

  root.FGEngine = {
    Engine,
    GAME,
    STAGE,
    INPUTS,
    ORDERS,
    ROUNDS,
    TIMERS,
    TEAMS,
    COORDS,
    MIN_PLAYERS,
    MIN_TEAMS,
    MAX_PLAYERS,
    GOAL,
    PLAYER_COLORS,
    DEFAULT_SETTINGS,
    sanitizeSettings,
    cleanName,
    colorHex,
  };
})(typeof window !== 'undefined' ? window : globalThis);
