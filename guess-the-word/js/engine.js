/*
 * Spiellogik von Activity.
 *
 * Die Engine hält den kompletten Spielzustand und verarbeitet Aktionen.
 * Offline läuft sie direkt im Browser, online im Browser des Hosts –
 * die Mitspieler bekommen nur "Ansichten" (viewFor) ohne geheime Infos.
 */
(function (root) {
  'use strict';

  const Deck = root.ActivityDeck;
  const CATS = ['erklaeren', 'zeichnen', 'pantomime'];
  const DIFFS = ['leicht', 'mittel', 'schwer'];
  const POINTS = { leicht: 3, mittel: 4, schwer: 5 };
  const TEAMS = [
    { id: 'rot', label: 'Rot' },
    { id: 'blau', label: 'Blau' },
    { id: 'gruen', label: 'Grün' },
    { id: 'gelb', label: 'Gelb' },
  ];
  const TIMER_OPTIONS = [30, 45, 60, 90, 120];
  const LENGTH_OPTIONS = [32, 40, 48];
  const DEFAULT_SETTINGS = { adult: false, timer: 60, length: 40 };

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Spielbrett: Start, zufällige Kategorien (nie 3 gleiche hintereinander), Ziel */
  function makeBoard(length) {
    const inner = Math.max(6, length - 2);
    const fields = [];
    for (let i = 0; i < inner; i++) fields.push(CATS[i % 3]);
    shuffle(fields);
    for (let pass = 0; pass < 100; pass++) {
      let fixed = true;
      for (let i = 2; i < fields.length; i++) {
        if (fields[i] === fields[i - 1] && fields[i] === fields[i - 2]) {
          fixed = false;
          const j = Math.floor(Math.random() * fields.length);
          [fields[i], fields[j]] = [fields[j], fields[i]];
        }
      }
      if (fixed) break;
    }
    return ['start'].concat(fields, ['ziel']);
  }

  function cleanName(name, fallback, max) {
    const s = String(name == null ? '' : name)
      .replace(/[\u0000-\u001f<>]/g, '')
      .trim()
      .slice(0, max || 24);
    return s || fallback;
  }

  /** Vereinfachte Schreibweise zum Vergleichen von Tipps */
  function normalizeGuess(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[éèê]/g, 'e')
      .replace(/[^a-z0-9]/g, '');
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function guessMatches(guess, term) {
    const g = normalizeGuess(guess);
    const t = normalizeGuess(term);
    if (!g || !t) return false;
    if (g === t) return true;
    // kleine Tippfehler bei längeren Wörtern verzeihen
    return t.length >= 6 && Math.abs(g.length - t.length) <= 1 && levenshtein(g, t) <= 1;
  }

  function baseTeams() {
    return TEAMS.map((t, i) => ({
      id: t.id,
      label: t.label,
      name: 'Team ' + t.label,
      active: i < 2,
      players: [],
      pos: 0,
      score: 0,
      next: 0,
      ok: 0,
      fail: 0,
    }));
  }

  function sanitizeSettings(input, current) {
    const s = Object.assign({}, current || DEFAULT_SETTINGS);
    if (!input) return s;
    if (typeof input.adult === 'boolean') s.adult = input.adult;
    if (TIMER_OPTIONS.includes(Number(input.timer))) s.timer = Number(input.timer);
    if (LENGTH_OPTIONS.includes(Number(input.length))) s.length = Number(input.length);
    return s;
  }

  /* ------------------------------------------------------------------ */

  class Engine {
    /**
     * @param {object} state Spielzustand (siehe Engine.offline / Engine.lobby)
     * @param {{onChange?: Function, now?: Function}} hooks
     */
    constructor(state, hooks) {
      this.s = state;
      this.hooks = hooks || {};
      this.now = this.hooks.now || (() => Date.now());
      this.timer = null;
      // Nach einem Neuladen läuft die Zeit einfach weiter (oder ist inzwischen abgelaufen)
      const t = this.s.turn;
      if (this.s.phase === 'running' && t && !t.paused) {
        if (t.timerEnd && t.timerEnd > this.now()) this.armTimer();
        else {
          this.s.phase = 'timeout';
          t.remaining = 0;
        }
      }
    }

    /** Neues Offline-Spiel aus dem Setup-Formular */
    static offline(config) {
      const settings = sanitizeSettings(config.settings);
      const teams = baseTeams();
      let pid = 0;
      for (const t of teams) {
        const cfg = (config.teams || []).find((c) => c.id === t.id);
        t.active = !!(cfg && cfg.active);
        if (!t.active) continue;
        t.name = cleanName(cfg.name, 'Team ' + t.label);
        t.players = (cfg.players || []).map((n, i) => ({ id: 'p' + ++pid, name: cleanName(n, 'Spieler ' + (i + 1)) }));
        if (t.players.length < 2) {
          while (t.players.length < 2) t.players.push({ id: 'p' + ++pid, name: 'Spieler ' + (t.players.length + 1) });
        }
      }
      const state = {
        v: 1,
        mode: 'offline',
        phase: 'lobby',
        settings,
        teams,
        members: {},
        hostId: 'local',
        board: [],
        order: [],
        turnIdx: 0,
        turnNo: 0,
        turn: null,
        result: null,
        winner: null,
        used: [],
        log: [],
        startedAt: null,
      };
      const engine = new Engine(state);
      engine.startGame();
      return state;
    }

    /** Neue Online-Lobby; der Host ist selbst Mitglied */
    static lobby(hostId, hostName) {
      return {
        v: 1,
        mode: 'online',
        phase: 'lobby',
        settings: Object.assign({}, DEFAULT_SETTINGS),
        teams: baseTeams(),
        members: { [hostId]: { name: cleanName(hostName, 'Host'), online: true } },
        hostId,
        board: [],
        order: [],
        turnIdx: 0,
        turnNo: 0,
        turn: null,
        result: null,
        winner: null,
        used: [],
        log: [],
        startedAt: null,
      };
    }

    dispose() {
      clearTimeout(this.timer);
      this.timer = null;
    }

    changed() {
      if (this.hooks.onChange) this.hooks.onChange();
    }

    /* ---------- Hilfsfunktionen ---------- */

    team(id) {
      return this.s.teams.find((t) => t.id === id) || null;
    }

    teamOf(playerId) {
      return this.s.teams.find((t) => t.players.some((p) => p.id === playerId)) || null;
    }

    currentTeam() {
      return this.s.turn ? this.team(this.s.turn.team) : null;
    }

    isOnline(playerId) {
      if (this.s.mode === 'offline') return true;
      const m = this.s.members[playerId];
      return !!(m && m.online);
    }

    isHost(actor) {
      return this.s.mode === 'offline' || actor === this.s.hostId;
    }

    isExplainer(actor) {
      return this.s.mode === 'offline' || (!!this.s.turn && this.s.turn.explainer === actor);
    }

    /**
     * Darf der Spieler für das aktive Team Entscheidungen treffen (Kategorie / Stapel)?
     * Der Host springt nur ein, wenn aus dem Team gerade niemand verbunden ist.
     */
    canTurn(actor) {
      if (this.s.mode === 'offline') return true;
      const team = this.currentTeam();
      if (!team) return false;
      if (team.players.some((p) => p.id === actor)) return true;
      return this.isHost(actor) && !team.players.some((p) => this.isOnline(p.id));
    }

    syncPlayerNames() {
      if (this.s.mode !== 'online') return;
      for (const t of this.s.teams) {
        for (const p of t.players) {
          const m = this.s.members[p.id];
          if (m) p.name = m.name;
        }
      }
    }

    /* ---------- Verbindungen (online) ---------- */

    connect(playerId, name) {
      const s = this.s;
      const m = s.members[playerId];
      if (m) {
        m.online = true;
        if (name) m.name = cleanName(name, m.name);
      } else {
        s.members[playerId] = { name: cleanName(name, 'Gast'), online: true };
      }
      this.syncPlayerNames();
      this.changed();
    }

    disconnect(playerId) {
      const m = this.s.members[playerId];
      if (!m || !m.online) return;
      m.online = false;
      this.changed();
    }

    setAllOffline() {
      for (const [id, m] of Object.entries(this.s.members)) if (id !== this.s.hostId) m.online = false;
    }

    /* ---------- Ablauf ---------- */

    startGame() {
      const s = this.s;
      s.board = makeBoard(s.settings.length);
      s.order = shuffle(s.teams.filter((t) => t.active && t.players.length).map((t) => t.id));
      for (const t of s.teams) {
        t.pos = 0;
        t.score = 0;
        t.ok = 0;
        t.fail = 0;
        if (t.players.length) t.next = t.next % t.players.length;
      }
      s.turnIdx = 0;
      s.turnNo = 0;
      s.winner = null;
      s.result = null;
      s.log = [];
      s.startedAt = this.now();
      this.beginTurn();
    }

    pickExplainer(team) {
      const n = team.players.length;
      if (!n) return null;
      const start = team.next % n;
      for (let k = 0; k < n; k++) {
        const idx = (start + k) % n;
        if (this.isOnline(team.players[idx].id)) {
          team.next = (idx + 1) % n;
          return team.players[idx];
        }
      }
      team.next = (start + 1) % n;
      return team.players[start];
    }

    beginTurn() {
      const s = this.s;
      const team = this.team(s.order[s.turnIdx]);
      const explainer = this.pickExplainer(team);
      const field = s.board[team.pos];
      s.turnNo += 1;
      s.turn = {
        no: s.turnNo,
        team: team.id,
        explainer: explainer ? explainer.id : null,
        explainerName: explainer ? explainer.name : '?',
        field: team.pos,
        cat: field === 'start' ? null : field,
        catFree: field === 'start',
        diff: null,
        card: null,
        timerTotal: s.settings.timer * 1000,
        timerEnd: null,
        remaining: null,
        paused: false,
        guesses: [],
      };
      s.result = null;
      s.phase = 'choose';
    }

    finishTurn(success, extra) {
      const s = this.s;
      const turn = s.turn;
      const team = this.currentTeam();
      this.dispose();
      const points = success ? POINTS[turn.diff] : 0;
      const last = s.board.length - 1;
      const from = team.pos;
      const to = Math.min(last, from + points);
      team.pos = to;
      team.score += points;
      if (success) team.ok += 1;
      else team.fail += 1;
      s.result = {
        no: turn.no,
        team: team.id,
        success: !!success,
        points,
        from,
        to,
        cat: turn.cat,
        diff: turn.diff,
        term: turn.card ? turn.card.term : '',
        taboo: turn.card ? turn.card.taboo : [],
        explainerName: turn.explainerName,
        guessedBy: (extra && extra.guessedBy) || null,
        winner: to >= last,
      };
      s.log.unshift({
        no: turn.no,
        team: team.id,
        explainer: turn.explainerName,
        term: s.result.term,
        cat: turn.cat,
        diff: turn.diff,
        success: !!success,
        points,
      });
      if (s.log.length > 60) s.log.length = 60;
      s.phase = 'result';
    }

    nextTurn() {
      const s = this.s;
      if (s.result && s.result.winner) {
        s.winner = s.result.team;
        s.phase = 'over';
        s.turn = null;
        return;
      }
      s.turnIdx = (s.turnIdx + 1) % s.order.length;
      this.beginTurn();
    }

    armTimer() {
      clearTimeout(this.timer);
      const turn = this.s.turn;
      if (this.s.phase !== 'running' || !turn || turn.paused || !turn.timerEnd) return;
      const no = turn.no;
      const ms = Math.max(0, turn.timerEnd - this.now());
      this.timer = setTimeout(() => {
        const t = this.s.turn;
        if (this.s.phase === 'running' && t && t.no === no && !t.paused) {
          this.s.phase = 'timeout';
          t.remaining = 0;
          this.changed();
        }
      }, ms + 30);
    }

    /* ---------- Aktionen ---------- */

    /**
     * Verarbeitet eine Aktion. Gibt true zurück, wenn sich etwas geändert hat.
     * @param {object} a Aktion {type, ...}
     * @param {string} actor Spieler-ID ("local" im Offline-Modus)
     */
    apply(a, actor) {
      if (!a || typeof a.type !== 'string') return false;
      const handler = this['on_' + a.type];
      if (typeof handler !== 'function') return false;
      const ok = handler.call(this, a, actor) === true;
      if (ok) this.changed();
      return ok;
    }

    // Stale Klicks (z.B. doppelte Nachrichten) ignorieren
    sameTurn(a) {
      return !!this.s.turn && (a.no === undefined || a.no === this.s.turn.no);
    }

    on_joinTeam(a, actor) {
      const s = this.s;
      if (s.mode !== 'online') return false;
      const pid = a.player && this.isHost(actor) ? a.player : actor;
      const m = s.members[pid];
      if (!m) return false;
      const target = a.team ? this.team(a.team) : null;
      if (s.phase === 'lobby') {
        if (target && !target.active) return false;
        for (const t of s.teams) t.players = t.players.filter((p) => p.id !== pid);
        if (target) target.players.push({ id: pid, name: m.name });
        return true;
      }
      // Im laufenden Spiel dürfen Zuschauer noch einem Team beitreten
      if (!target || !s.order.includes(target.id) || this.teamOf(pid)) return false;
      target.players.push({ id: pid, name: m.name });
      return true;
    }

    on_kick(a, actor) {
      const s = this.s;
      if (s.mode !== 'online' || !this.isHost(actor) || a.player === s.hostId || !s.members[a.player]) return false;
      const inGame = s.phase !== 'lobby' && s.phase !== 'over';
      if (inGame && (this.isOnline(a.player) || (s.turn && s.turn.explainer === a.player))) return false;
      for (const t of s.teams) {
        const idx = t.players.findIndex((p) => p.id === a.player);
        if (idx < 0) continue;
        t.players.splice(idx, 1);
        if (idx < t.next) t.next -= 1;
        if (t.players.length) t.next %= t.players.length;
        else t.next = 0;
      }
      delete s.members[a.player];
      if (this.hooks.onKick) this.hooks.onKick(a.player);
      return true;
    }

    on_teamName(a, actor) {
      if (!this.isHost(actor)) return false;
      const t = this.team(a.team);
      if (!t) return false;
      t.name = cleanName(a.name, 'Team ' + t.label);
      return true;
    }

    on_teamActive(a, actor) {
      const s = this.s;
      if (!this.isHost(actor) || s.phase !== 'lobby') return false;
      const t = this.team(a.team);
      if (!t) return false;
      if (!a.active && s.teams.filter((x) => x.active).length <= 2) return false;
      t.active = !!a.active;
      if (!t.active) t.players = [];
      return true;
    }

    on_settings(a, actor) {
      if (!this.isHost(actor) || this.s.phase !== 'lobby') return false;
      this.s.settings = sanitizeSettings(a.settings, this.s.settings);
      return true;
    }

    lobbyProblem() {
      const ready = this.s.teams.filter((t) => t.active && t.players.some((p) => this.isOnline(p.id)));
      if (ready.length < 2) return 'Mindestens zwei Teams brauchen Spieler.';
      return null;
    }

    on_start(a, actor) {
      if (!this.isHost(actor) || this.s.phase !== 'lobby' || this.lobbyProblem()) return false;
      for (const t of this.s.teams) {
        t.players = t.players.filter((p) => this.isOnline(p.id));
        if (!t.players.length) t.active = false;
      }
      this.startGame();
      return true;
    }

    on_category(a, actor) {
      const s = this.s;
      if (s.phase !== 'choose' || !this.sameTurn(a) || !s.turn.catFree || !this.canTurn(actor)) return false;
      if (!CATS.includes(a.cat)) return false;
      s.turn.cat = a.cat;
      return true;
    }

    on_draw(a, actor) {
      const s = this.s;
      if (s.phase !== 'choose' || !this.sameTurn(a) || !s.turn.cat || !this.canTurn(actor)) return false;
      if (!DIFFS.includes(a.diff)) return false;
      const card = Deck.draw(s.turn.cat, a.diff, s.settings.adult, s.used);
      s.used.push(card.key);
      s.turn.diff = a.diff;
      s.turn.card = card;
      s.phase = 'card';
      return true;
    }

    on_startTimer(a, actor) {
      const s = this.s;
      if (s.phase !== 'card' || !this.sameTurn(a)) return false;
      if (!this.isExplainer(actor) && !this.isHost(actor)) return false;
      s.turn.timerEnd = this.now() + s.turn.timerTotal;
      s.turn.remaining = null;
      s.turn.paused = false;
      s.phase = 'running';
      this.armTimer();
      return true;
    }

    on_pause(a, actor) {
      const s = this.s;
      const t = s.turn;
      if (s.phase !== 'running' || !this.sameTurn(a) || t.paused) return false;
      if (!this.isExplainer(actor) && !this.isHost(actor)) return false;
      t.remaining = Math.max(0, t.timerEnd - this.now());
      t.paused = true;
      this.dispose();
      return true;
    }

    on_resume(a, actor) {
      const s = this.s;
      const t = s.turn;
      if (s.phase !== 'running' || !this.sameTurn(a) || !t.paused) return false;
      if (!this.isExplainer(actor) && !this.isHost(actor)) return false;
      t.timerEnd = this.now() + (t.remaining || 0);
      t.remaining = null;
      t.paused = false;
      this.armTimer();
      return true;
    }

    on_success(a, actor) {
      const s = this.s;
      if (!['running', 'timeout'].includes(s.phase) || !this.sameTurn(a)) return false;
      if (!this.isExplainer(actor) && !this.isHost(actor)) return false;
      this.finishTurn(true);
      return true;
    }

    on_fail(a, actor) {
      const s = this.s;
      if (!['card', 'running', 'timeout'].includes(s.phase) || !this.sameTurn(a)) return false;
      if (!this.isExplainer(actor) && !this.isHost(actor)) return false;
      this.finishTurn(false);
      return true;
    }

    on_guess(a, actor) {
      const s = this.s;
      const t = s.turn;
      if (s.mode !== 'online' || s.phase !== 'running' || !this.sameTurn(a) || t.paused) return false;
      const team = this.currentTeam();
      if (actor === t.explainer || !team.players.some((p) => p.id === actor)) return false;
      const text = cleanName(a.text, '', 40);
      if (!text) return false;
      const m = s.members[actor];
      const name = m ? m.name : '?';
      const hit = guessMatches(text, t.card.term);
      t.guesses.push({ name, text, hit });
      if (t.guesses.length > 30) t.guesses.shift();
      if (hit) this.finishTurn(true, { guessedBy: name });
      return true;
    }

    on_next(a, actor) {
      const s = this.s;
      if (s.phase !== 'result' || !s.result || (a.no !== undefined && a.no !== s.result.no)) return false;
      if (s.mode === 'online' && !s.members[actor] && !this.isHost(actor)) return false;
      this.nextTurn();
      return true;
    }

    on_skipExplainer(a, actor) {
      const s = this.s;
      if (!['choose', 'card'].includes(s.phase) || !this.sameTurn(a)) return false;
      if (!this.isHost(actor) && !this.isExplainer(actor)) return false;
      const team = this.currentTeam();
      if (team.players.length < 2) return false;
      const next = this.pickExplainer(team);
      if (!next || next.id === s.turn.explainer) {
        // nur ein Spieler online – reihum zum nächsten wechseln
        const idx = team.players.findIndex((p) => p.id === s.turn.explainer);
        const alt = team.players[(idx + 1) % team.players.length];
        team.next = (idx + 2) % team.players.length;
        s.turn.explainer = alt.id;
        s.turn.explainerName = alt.name;
      } else {
        s.turn.explainer = next.id;
        s.turn.explainerName = next.name;
      }
      return true;
    }

    on_endGame(a, actor) {
      const s = this.s;
      if (!this.isHost(actor) || s.phase === 'lobby' || s.phase === 'over') return false;
      this.dispose();
      const ranking = this.ranking();
      s.winner = ranking.length ? ranking[0].id : null;
      s.phase = 'over';
      s.turn = null;
      s.ended = true;
      return true;
    }

    on_rematch(a, actor) {
      const s = this.s;
      if (!this.isHost(actor) || s.phase !== 'over') return false;
      s.ended = false;
      this.startGame();
      return true;
    }

    on_toLobby(a, actor) {
      const s = this.s;
      if (s.mode !== 'online' || !this.isHost(actor) || s.phase !== 'over') return false;
      s.phase = 'lobby';
      s.ended = false;
      s.winner = null;
      s.turn = null;
      s.result = null;
      for (const t of s.teams) {
        t.players = t.players.filter((p) => s.members[p.id] && s.members[p.id].online);
        if (s.order.includes(t.id)) t.active = true;
      }
      return true;
    }

    ranking() {
      return this.s.teams
        .filter((t) => this.s.order.includes(t.id))
        .slice()
        .sort((x, y) => y.pos - x.pos || y.score - x.score);
    }

    /* ---------- Ansicht für einen Spieler ---------- */

    viewFor(viewer) {
      const s = this.s;
      const offline = s.mode === 'offline';
      const t = s.turn;
      const myTeam = offline ? null : this.teamOf(viewer);
      const isExplainer = !!t && this.isExplainer(viewer);
      const view = {
        mode: s.mode,
        phase: s.phase,
        settings: Object.assign({}, s.settings),
        board: s.board.slice(),
        order: s.order.slice(),
        teams: s.teams.map((team) => ({
          id: team.id,
          label: team.label,
          name: team.name,
          active: team.active,
          pos: team.pos,
          score: team.score,
          ok: team.ok,
          fail: team.fail,
          players: team.players.map((p) => ({ id: p.id, name: p.name, online: this.isOnline(p.id) })),
        })),
        members: offline
          ? []
          : Object.entries(s.members).map(([id, m]) => ({
              id,
              name: m.name,
              online: m.online,
              team: (this.teamOf(id) || {}).id || null,
              host: id === s.hostId,
            })),
        hostId: s.hostId,
        result: s.result ? Object.assign({}, s.result) : null,
        winner: s.winner,
        ended: !!s.ended,
        log: s.log.slice(0, 12),
        lobbyProblem: s.phase === 'lobby' ? this.lobbyProblem() : null,
        turn: null,
        me: {
          id: viewer,
          isHost: this.isHost(viewer),
          team: myTeam ? myTeam.id : null,
          isExplainer,
          canTurn: !!t && this.canTurn(viewer),
          canGuess:
            !offline && !!t && !isExplainer && !!myTeam && myTeam.id === t.team && s.phase === 'running',
        },
      };
      if (t) {
        const now = this.now();
        let remaining = t.timerTotal;
        if (s.phase === 'running') remaining = t.paused ? t.remaining : Math.max(0, t.timerEnd - now);
        else if (s.phase === 'timeout') remaining = 0;
        view.turn = {
          no: t.no,
          team: t.team,
          explainer: t.explainer,
          explainerName: t.explainerName,
          field: t.field,
          cat: t.cat,
          catFree: t.catFree,
          diff: t.diff,
          points: t.diff ? POINTS[t.diff] : null,
          adult: !!(t.card && t.card.adult),
          timer: { total: t.timerTotal, remaining, paused: !!t.paused },
          guesses: t.guesses.slice(-12),
          card: null,
          deck: t.cat ? Deck.remaining(t.cat, s.settings.adult, s.used) : null,
        };
        if (t.card && (offline || isExplainer)) view.turn.card = Object.assign({}, t.card);
      }
      return view;
    }
  }

  root.ActivityEngine = {
    Engine,
    CATS,
    DIFFS,
    POINTS,
    TEAMS,
    TIMER_OPTIONS,
    LENGTH_OPTIONS,
    DEFAULT_SETTINGS,
    makeBoard,
    normalizeGuess,
    guessMatches,
    cleanName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
