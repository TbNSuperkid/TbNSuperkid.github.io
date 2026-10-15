/*
 * Spiellogik von „Geheimsache“.
 *
 * Zwei Teams (Rot, Blau), 25 Wörter. Die Geheimdienstchefs kennen die Schlüsselkarte und geben
 * reihum einen Hinweis (Wort + Zahl), ihr Team deckt Karten auf – bis ein Team alle eigenen Karten
 * gefunden hat oder jemand den Attentäter erwischt.
 *
 * Zwei Spielweisen:
 *  - keys:   Nur Chef-Handys – der Laptop ist die Bühne und wird bedient wie das Brettspiel,
 *            die Chefs holen sich die Schlüsselkarte per QR-Code (ohne Raum, ohne Verbindung)
 *  - phones: Alle mit Handy – Raum mit Lobby, Chef tippt den Hinweis ein, das Team schlägt Karten vor
 *            und deckt auf dem Handy auf
 *
 * Der Laptop ("stage") ist immer der Host. Handys bekommen nur Ansichten (viewFor):
 * Farben noch verdeckter Karten sehen nur die Chefs.
 */
(function (root) {
  'use strict';

  const Board = root.GSBoard;

  const STAGE = 'stage';
  const TEAMS = [
    { id: 'rot', label: 'Rot' },
    { id: 'blau', label: 'Blau' },
  ];
  const INPUTS = ['keys', 'phones'];
  const MATCH_OPTIONS = [1, 3, 5, 0]; // 0 = frei (so viele Partien, wie ihr wollt)
  const TIMER_OPTIONS = [0, 60, 120, 180];
  const DRINK_OPTIONS = ['off', 'on', 'free']; // free = alkoholfrei (Strafpunkte)
  const WORD_OPTIONS = ['standard', 'adult']; // adult = normale Wörter + 18+
  const DEFAULT_SETTINGS = { input: 'keys', match: 0, chiefSec: 0, teamSec: 0, drinks: 'off', words: 'standard' };
  const UNLIMITED = 'inf'; // Hinweis „∞“
  const MAX_COUNT = 9;
  const MAX_WORD = 30;
  const MAX_PLAYERS = 10; // pro Team
  const DRINKS = { neutral: 1, opponent: 1, assassin: 3, clue: 1, lost: 1 };
  const CLUE_DRINK_MIN = 3; // Hinweis für so viele Karten komplett gelöst → Gegner trinkt

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
    if (INPUTS.includes(i.input)) s.input = i.input;
    if (MATCH_OPTIONS.includes(+i.match)) s.match = +i.match;
    if (TIMER_OPTIONS.includes(+i.chiefSec)) s.chiefSec = +i.chiefSec;
    if (TIMER_OPTIONS.includes(+i.teamSec)) s.teamSec = +i.teamSec;
    if (DRINK_OPTIONS.includes(i.drinks)) s.drinks = i.drinks;
    if (WORD_OPTIONS.includes(i.words)) s.words = i.words;
    return s;
  }

  /** Zahl eines Hinweises: 0–9 oder „∞“, sonst null */
  function cleanCount(c) {
    if (c === UNLIMITED || c === '∞') return UNLIMITED;
    const n = Number(c);
    return Number.isInteger(n) && n >= 0 && n <= MAX_COUNT ? n : null;
  }

  /** Wie viele Karten darf das Team zum Hinweis aufdecken? null = unbegrenzt („0“ und „∞“) */
  function guessLimit(count) {
    return typeof count === 'number' && count >= 1 ? count + 1 : null;
  }

  /** Siege, die für den Gesamtsieg nötig sind (null = frei) */
  function winsNeeded(match) {
    return match ? Math.ceil(match / 2) : null;
  }

  function other(id) {
    return id === 'rot' ? 'blau' : 'rot';
  }

  class Engine {
    /**
     * @param {object} state Spielzustand (siehe Engine.create)
     * @param {{onChange?: Function, onKick?: Function, now?: Function, random?: Function, timers?: boolean}} hooks
     *   timers: false schaltet die Sanduhr-Automatik ab (Tests rufen dann tick() selbst auf)
     */
    constructor(state, hooks) {
      this.s = state;
      this.hooks = hooks || {};
      this.now = this.hooks.now || (() => Date.now());
      this.random = this.hooks.random || Math.random;
      this.timer = null;
      // Nach einem Neuladen: inzwischen abgelaufene Sanduhr gleich auswerten
      this.tick();
      this.armTimer();
    }

    /**
     * Neues Spiel aus dem Setup.
     * @param {{settings: object, teams: {id, name, players?: string[]}[]}} config
     *   Nur Chef-Handys: Spielernamen werden hier eingetragen (für den Chef-Wechsel), das Spiel startet sofort.
     *   Alle mit Handy: Es beginnt in der Lobby, die Spieler kommen über ihre Handys dazu.
     */
    static create(config, hooks) {
      const settings = sanitizeSettings(config.settings);
      let pid = 0;
      const teams = TEAMS.map((def) => {
        const cfg = (config.teams || []).find((c) => c.id === def.id) || {};
        const t = { id: def.id, label: def.label, name: cleanName(cfg.name, 'Team ' + def.label), players: [], chief: null, wins: 0 };
        if (settings.input === 'keys') {
          const names = (cfg.players || []).slice(0, MAX_PLAYERS);
          while (names.length < 2) names.push('');
          t.players = names.map((n, i) => ({ id: 'p' + ++pid, name: cleanName(n, 'Spieler ' + (i + 1)) }));
          t.chief = t.players[0].id;
        }
        return t;
      });
      const state = {
        v: 1,
        game: 'geheimsache',
        settings,
        phase: 'lobby',
        teams,
        members: {},
        gameNo: 0,
        cards: [],
        code: null,
        starter: null,
        turn: null,
        turnNo: 0,
        clue: null,
        suggestions: {},
        timerEnd: null,
        timerTotal: 0,
        result: null,
        event: null,
        eventNo: 0,
        games: [],
        clues: [],
        drinks: [],
        drinkNo: 0,
        used: [],
        awards: [],
      };
      if (settings.input === 'keys') new Engine(state, Object.assign({}, hooks, { timers: false })).startGame();
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

    /** 'chief' | 'operative' | null */
    roleOf(pid) {
      const t = this.teamOf(pid);
      if (!t) return null;
      return t.chief === pid ? 'chief' : 'operative';
    }

    /** Noch verdeckte Karten eines Teams */
    remaining(teamId) {
      return this.s.cards.filter((c) => c.owner === teamId && !c.revealed).length;
    }

    total(teamId) {
      return this.s.cards.filter((c) => c.owner === teamId).length;
    }

    /** Wörter, die noch offen auf dem Feld liegen (gegen die wird der Hinweis geprüft) */
    openWords() {
      return this.s.cards.filter((c) => !c.revealed).map((c) => c.word);
    }

    playing() {
      return this.s.phase === 'clue' || this.s.phase === 'guess';
    }

    /** Darf dieser Spieler für das Team am Zug Karten aufdecken? */
    canGuess(actor) {
      if (actor === STAGE) return true;
      if (!this.write) return false;
      const t = this.teamOf(actor);
      return !!t && t.id === this.s.turn && t.chief !== actor;
    }

    matchWinner() {
      const need = winsNeeded(this.s.settings.match);
      if (!need) return null;
      const t = this.s.teams.find((x) => x.wins >= need);
      return t ? t.id : null;
    }

    /** Wer wäre nach dem Wechsel Chef? (reihum, bei Handys nur verbundene) */
    nextChief(t) {
      const list = t.players.filter((p) => this.isOnline(p.id) || p.id === t.chief);
      if (!list.length) return null;
      const i = list.findIndex((p) => p.id === t.chief);
      for (let k = 1; k <= list.length; k++) {
        const p = list[(i + k + list.length) % list.length];
        if (this.isOnline(p.id)) return p.id;
      }
      return t.chief;
    }

    /** Fehlt ein Chef (oder ist er weg)? Dann wird der erste verbundene Spieler Chef */
    ensureChiefs() {
      for (const t of this.s.teams) {
        if (t.chief && t.players.some((p) => p.id === t.chief)) continue;
        const p = t.players.find((x) => this.isOnline(x.id)) || t.players[0];
        t.chief = p ? p.id : null;
      }
    }

    event(kind, extra) {
      this.s.event = Object.assign({ n: ++this.s.eventNo, kind }, extra || {});
    }

    /* ---------- Trinkregeln ---------- */

    drink(teamId, amount, reason, pid) {
      const s = this.s;
      if (s.settings.drinks === 'off' || amount <= 0) return;
      s.drinks.push({
        n: ++s.drinkNo,
        game: s.gameNo,
        team: teamId,
        pid: pid || null,
        name: pid ? this.playerName(pid) : null,
        amount,
        reason,
      });
    }

    drinkTotals() {
      const teams = { rot: 0, blau: 0 };
      const players = {};
      for (const d of this.s.drinks) {
        if (d.pid) players[d.pid] = (players[d.pid] || 0) + d.amount;
        else teams[d.team] = (teams[d.team] || 0) + d.amount;
      }
      return { teams, players };
    }

    /* ---------- Verbindungen (Alle mit Handy) ---------- */

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

    /** Nach dem Neuladen des Laptops: alle müssen sich neu verbinden */
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
      s.gameNo += 1;
      s.starter = this.random() < 0.5 ? 'rot' : 'blau';
      const board = Board.deal({ starter: s.starter, adult: s.settings.words === 'adult', used: s.used, random: this.random });
      s.cards = board.cards.map((c) => ({ idx: c.idx, word: c.word, owner: c.owner, revealed: false, by: null, team: null }));
      s.code = board.code;
      s.turn = s.starter;
      s.result = null;
      s.event = null;
      this.ensureChiefs();
      this.beginClue();
    }

    beginClue() {
      const s = this.s;
      s.turnNo += 1;
      s.phase = 'clue';
      s.clue = null;
      s.suggestions = {};
      this.startClock(s.settings.chiefSec);
    }

    startClock(sec) {
      this.s.timerTotal = sec * 1000;
      this.s.timerEnd = sec ? this.now() + sec * 1000 : null;
    }

    /** Hinweis abschließen und für Auswertung/Auszeichnungen merken */
    closeClue(reason) {
      const s = this.s;
      const t = this.team(s.turn);
      if (s.clue) s.clues.push(Object.assign({}, s.clue, { end: reason }));
      else s.clues.push({ team: s.turn, game: s.gameNo, word: '', count: null, found: 0, guesses: 0, chief: t.chief, end: reason });
    }

    endTurn(reason) {
      const s = this.s;
      this.closeClue(reason);
      s.turn = other(s.turn);
      this.beginClue();
    }

    endGame(winner, reason) {
      const s = this.s;
      if (s.clue || s.phase === 'clue') this.closeClue(reason === 'assassin' ? 'assassin' : 'won');
      const loser = other(winner);
      this.team(winner).wins += 1;
      const left = this.remaining(loser);
      this.drink(loser, left * DRINKS.lost, 'lost');
      const mistakes = {};
      for (const t of s.teams) mistakes[t.id] = s.cards.filter((c) => c.revealed && c.team === t.id && c.owner !== t.id).length;
      const hit = reason === 'assassin' ? s.cards.find((c) => c.owner === 'assassin') : null;
      s.result = {
        game: s.gameNo,
        winner,
        loser,
        reason,
        left,
        assassin: hit ? { team: hit.team, pid: hit.by, name: hit.by ? this.playerName(hit.by) : null } : null,
      };
      s.games.push(Object.assign({ starter: s.starter, mistakes, chiefs: { rot: this.team('rot').chief, blau: this.team('blau').chief } }, clone(s.result)));
      s.phase = 'game-over';
      s.clue = null;
      s.suggestions = {};
      s.timerEnd = null;
      s.timerTotal = 0;
    }

    /** Karte aufdecken – Herzstück der Regeln */
    reveal(idx, actor) {
      const s = this.s;
      const card = s.cards[idx];
      const turn = s.turn;
      const pid = actor === STAGE ? null : actor;
      card.revealed = true;
      card.by = pid;
      card.team = turn;
      delete s.suggestions[idx];
      const clue = s.clue;
      clue.guesses += 1;
      let end = null;
      if (card.owner === turn) {
        clue.found += 1;
        if (typeof clue.count === 'number' && clue.count >= CLUE_DRINK_MIN && clue.found === clue.count) {
          this.drink(other(turn), DRINKS.clue, 'clue');
        }
        if (!this.remaining(turn)) {
          this.event('reveal', { idx, owner: card.owner, team: turn, pid, end: 'won' });
          this.endGame(turn, 'cards');
          return;
        }
        if (clue.left != null) {
          clue.left -= 1;
          if (clue.left <= 0) end = 'max';
        }
      } else if (card.owner === 'assassin') {
        this.drink(turn, DRINKS.assassin, 'assassin');
        this.event('reveal', { idx, owner: card.owner, team: turn, pid, end: 'assassin' });
        this.endGame(other(turn), 'assassin');
        return;
      } else if (card.owner === other(turn)) {
        this.drink(turn, DRINKS.opponent, 'opponent');
        if (!this.remaining(other(turn))) {
          this.event('reveal', { idx, owner: card.owner, team: turn, pid, end: 'lost' });
          this.endGame(other(turn), 'cards');
          return;
        }
        end = 'opponent';
      } else {
        this.drink(turn, DRINKS.neutral, 'neutral', pid);
        end = 'neutral';
      }
      this.event('reveal', { idx, owner: card.owner, team: turn, pid, end });
      // Die Sanduhr fürs Raten läuft pro Hinweis weiter, nicht pro Karte
      if (end) this.endTurn(end);
    }

    /* ---------- Sanduhr ---------- */

    armTimer() {
      clearTimeout(this.timer);
      this.timer = null;
      if (this.hooks.timers === false) return;
      const end = this.playing() ? this.s.timerEnd : null;
      if (!end) return;
      this.timer = setTimeout(
        () => {
          if (this.tick()) this.changed();
          else this.armTimer();
        },
        Math.max(0, end - this.now()) + 30
      );
    }

    /** Abgelaufene Sanduhr auswerten: Zug ist vorbei. Gibt true zurück, wenn sich etwas geändert hat. */
    tick() {
      const s = this.s;
      if (!this.playing() || !s.timerEnd || s.timerEnd > this.now()) return false;
      this.event('time', { team: s.turn, phase: s.phase });
      this.endTurn('time');
      return true;
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

    /* Lobby (Alle mit Handy) */

    on_joinTeam(a, actor) {
      const s = this.s;
      if (!this.write || actor === STAGE) return false;
      const m = s.members[actor];
      if (!m) return false;
      const target = a.team ? this.team(a.team) : null;
      if (target && target.players.length >= MAX_PLAYERS) return false;
      const current = this.teamOf(actor);
      if (s.phase === 'lobby') {
        if (current === target) return false;
        if (current) {
          current.players = current.players.filter((p) => p.id !== actor);
          if (current.chief === actor) current.chief = current.players.length ? current.players[0].id : null;
        }
        if (target) {
          target.players.push({ id: actor, name: m.name });
          if (!target.chief) target.chief = actor;
        }
        return true;
      }
      // Später dazukommen: als Ermittler:in in ein Team
      if (s.phase === 'end' || !target || current) return false;
      target.players.push({ id: actor, name: m.name });
      if (!target.chief) target.chief = actor;
      return true;
    }

    /** Chef bestimmen: Laptop jederzeit (z.B. wenn ein Handy ausfällt), Spieler für sich selbst in der Lobby */
    on_setChief(a, actor) {
      const s = this.s;
      if (s.phase === 'end') return false;
      const pid = actor === STAGE ? a.player : actor;
      const t = this.teamOf(pid);
      if (!t || t.chief === pid) return false;
      if (actor !== STAGE && s.phase !== 'lobby') return false;
      t.chief = pid;
      // Ein neuer Chef darf nicht mehr mitraten
      for (const k of Object.keys(s.suggestions)) {
        s.suggestions[k] = s.suggestions[k].filter((x) => x !== pid);
        if (!s.suggestions[k].length) delete s.suggestions[k];
      }
      return true;
    }

    on_kick(a, actor) {
      const s = this.s;
      if (actor !== STAGE || !this.write || !s.members[a.player]) return false;
      for (const t of s.teams) {
        t.players = t.players.filter((p) => p.id !== a.player);
        if (t.chief === a.player) t.chief = null;
      }
      for (const k of Object.keys(s.suggestions)) {
        s.suggestions[k] = s.suggestions[k].filter((x) => x !== a.player);
        if (!s.suggestions[k].length) delete s.suggestions[k];
      }
      delete s.members[a.player];
      this.ensureChiefs();
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

    /** Einstellungen: in der Lobby und zwischen den Partien (die Spielweise bleibt) */
    on_settings(a, actor) {
      const s = this.s;
      if (actor !== STAGE || !['lobby', 'game-over'].includes(s.phase)) return false;
      s.settings = sanitizeSettings(Object.assign({}, a.settings, { input: s.settings.input }), s.settings);
      return true;
    }

    lobbyProblem() {
      for (const t of this.s.teams) {
        const online = t.players.filter((p) => this.isOnline(p.id)).length;
        if (online < 2) return `${t.name} braucht mindestens 2 Spieler (Chef + Ermittler:in).`;
      }
      return null;
    }

    on_start(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby' || this.lobbyProblem()) return false;
      for (const t of s.teams) t.players = t.players.filter((p) => this.isOnline(p.id));
      for (const t of s.teams) if (t.chief && !this.isOnline(t.chief)) t.chief = null;
      this.startGame();
      return true;
    }

    /* Spielen */

    /** Hinweis: {word, count} – vom Chef des Teams am Zug (Handy) oder am Laptop eingetragen */
    on_clue(a, actor) {
      const s = this.s;
      if (s.phase !== 'clue') return false;
      if (a.at !== undefined && a.at !== s.turnNo) return false;
      const t = this.team(s.turn);
      if (actor !== STAGE && (!this.write || t.chief !== actor)) return false;
      const count = cleanCount(a.count);
      const word = cleanName(a.word, '', MAX_WORD);
      if (count === null) return false;
      if (actor !== STAGE && !word) return false;
      if (word && Board.clueProblem(word, this.openWords())) return false;
      const teamEnd = s.settings.teamSec ? this.now() + s.settings.teamSec * 1000 : null;
      s.clue = {
        team: s.turn,
        game: s.gameNo,
        word,
        count,
        left: guessLimit(count),
        found: 0,
        guesses: 0,
        chief: t.chief,
      };
      s.phase = 'guess';
      s.timerEnd = teamEnd;
      s.timerTotal = s.settings.teamSec * 1000;
      return true;
    }

    /** Vorschlag (Handy): Antippen markiert die Karte mit dem eigenen Namen, nochmal antippen nimmt ihn weg */
    on_suggest(a, actor) {
      const s = this.s;
      if (s.phase !== 'guess' || actor === STAGE || !this.canGuess(actor)) return false;
      if (a.at !== undefined && a.at !== s.turnNo) return false;
      const idx = +a.idx;
      const card = s.cards[idx];
      if (!card || card.revealed) return false;
      const had = (s.suggestions[idx] || []).includes(actor);
      for (const k of Object.keys(s.suggestions)) {
        s.suggestions[k] = s.suggestions[k].filter((x) => x !== actor);
        if (!s.suggestions[k].length) delete s.suggestions[k];
      }
      if (!had) (s.suggestions[idx] = s.suggestions[idx] || []).push(actor);
      return true;
    }

    on_reveal(a, actor) {
      const s = this.s;
      if (s.phase !== 'guess' || !this.canGuess(actor)) return false;
      if (a.at !== undefined && a.at !== s.turnNo) return false;
      const idx = +a.idx;
      const card = s.cards[idx];
      if (!card || card.revealed) return false;
      this.reveal(idx, actor);
      return true;
    }

    /** Zug beenden: Laptop jederzeit, Ermittler:innen erst nach mindestens einer Karte */
    on_endTurn(a, actor) {
      const s = this.s;
      if (s.phase !== 'guess' || !this.canGuess(actor)) return false;
      if (a.at !== undefined && a.at !== s.turnNo) return false;
      if (actor !== STAGE && !s.clue.guesses) return false;
      this.event('pass', { team: s.turn });
      this.endTurn('pass');
      return true;
    }

    /** Zug abgeben, ohne Hinweis (z.B. Chef ist weg) – nur am Laptop */
    on_skipTurn(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'clue') return false;
      if (a.at !== undefined && a.at !== s.turnNo) return false;
      this.event('pass', { team: s.turn });
      this.endTurn('skip');
      return true;
    }

    /** Nächste Partie. chiefs: {rot: pid, blau: pid} vom Laptop gewählt, sonst wechseln die Chefs reihum */
    on_nextGame(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'game-over' || this.matchWinner()) return false;
      if (a.game !== undefined && a.game !== s.gameNo) return false;
      const chosen = a.chiefs || {};
      for (const t of s.teams) {
        t.chief = t.players.some((p) => p.id === chosen[t.id]) ? chosen[t.id] : this.nextChief(t);
      }
      this.startGame();
      return true;
    }

    /** Spieleabend beenden → Abschluss mit Auszeichnungen */
    on_finish(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase === 'lobby' || s.phase === 'end') return false;
      s.phase = 'end';
      s.clue = null;
      s.suggestions = {};
      s.timerEnd = null;
      s.awards = this.computeAwards();
      this.dispose();
      return true;
    }

    /** Neuer Abend mit denselben Teams */
    on_again(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'end') return false;
      for (const t of s.teams) t.wins = 0;
      Object.assign(s, { gameNo: 0, games: [], clues: [], drinks: [], awards: [], result: null, event: null, cards: [], code: null });
      if (this.write) {
        s.phase = 'lobby';
        s.turn = null;
      } else {
        for (const t of s.teams) t.chief = this.nextChief(t);
        this.startGame();
      }
      return true;
    }

    /* ---------- Auszeichnungen ---------- */

    computeAwards() {
      const s = this.s;
      const out = [];
      const teamName = (id) => (this.team(id) || {}).name || '?';
      const solved = s.clues.filter((c) => typeof c.count === 'number' && c.count >= 2 && c.found >= c.count);
      if (solved.length) {
        const best = solved.reduce((a, b) => (b.count > a.count ? b : a));
        const chief = best.chief ? this.playerName(best.chief) : '';
        out.push({
          icon: '🧠',
          title: 'Meisterhinweis',
          text: `${chief ? chief + ' (' + teamName(best.team) + ')' : teamName(best.team)} – ${best.word ? `„${best.word}“ für ${best.count}` : `Hinweis für ${best.count}`}`,
        });
      }
      const unlucky = s.games.filter((g) => g.assassin).map((g) => g.assassin.name || teamName(g.assassin.team));
      if (unlucky.length) {
        const counts = {};
        for (const n of unlucky) counts[n] = (counts[n] || 0) + 1;
        const [name, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        out.push({ icon: '☠️', title: 'Pechvogel', text: `${name} – ${n > 1 ? n + '× ' : ''}den Attentäter erwischt` });
      }
      const clean = s.games.filter((g) => g.reason === 'cards' && g.mistakes[g.winner] === 0);
      if (clean.length) {
        const g = clean[0];
        out.push({ icon: '🎯', title: 'Sauberes Team', text: `${teamName(g.winner)} – Partie ${g.game} ohne einen einzigen Fehler` });
      }
      if (s.settings.drinks !== 'off' && s.drinks.length) {
        const tot = this.drinkTotals();
        const all = Object.entries(tot.teams)
          .map(([id, n]) => ({ name: teamName(id), n }))
          .concat(Object.entries(tot.players).map(([pid, n]) => ({ name: this.playerName(pid), n })));
        const top = all.sort((a, b) => b.n - a.n)[0];
        if (top && top.n > 0) {
          const free = s.settings.drinks === 'free';
          out.push({
            icon: free ? '⚠️' : '🍺',
            title: free ? 'Strafpunkte-König' : 'Durstigste',
            text: `${top.name} – ${top.n} ${free ? (top.n === 1 ? 'Strafpunkt' : 'Strafpunkte') : top.n === 1 ? 'Schluck' : 'Schlucke'}`,
          });
        }
      }
      return out;
    }

    /* ---------- Ansicht ---------- */

    viewFor(viewer) {
      const s = this.s;
      const stage = viewer === STAGE;
      const myTeam = stage ? null : this.teamOf(viewer);
      const role = stage ? null : this.roleOf(viewer);
      const over = s.phase === 'game-over' || s.phase === 'end';
      const seeAll = over || (role === 'chief' && this.write);
      const name = (pid) => (pid ? this.playerName(pid) : null);
      const suggestions = {};
      for (const [k, list] of Object.entries(s.suggestions)) suggestions[k] = list.map((pid) => ({ id: pid, name: this.playerName(pid) }));
      const totals = this.drinkTotals();
      const view = {
        game: 'geheimsache',
        phase: s.phase,
        settings: Object.assign({}, s.settings),
        gameNo: s.gameNo,
        need: winsNeeded(s.settings.match),
        teams: s.teams.map((t) => ({
          id: t.id,
          label: t.label,
          name: t.name,
          wins: t.wins,
          chief: t.chief,
          chiefName: name(t.chief),
          nextChief: s.phase === 'game-over' ? this.nextChief(t) : null,
          left: this.remaining(t.id),
          total: this.total(t.id),
          drinks: totals.teams[t.id] || 0,
          players: t.players.map((p) => ({ id: p.id, name: p.name, online: this.isOnline(p.id), drinks: totals.players[p.id] || 0 })),
        })),
        members: this.write
          ? Object.entries(s.members).map(([id, m]) => ({ id, name: m.name, online: m.online, team: (this.teamOf(id) || {}).id || null }))
          : [],
        lobbyProblem: s.phase === 'lobby' && this.write ? this.lobbyProblem() : null,
        cards: s.cards.map((c) => ({
          word: c.word,
          owner: c.revealed || seeAll ? c.owner : null,
          revealed: c.revealed,
          by: name(c.by),
          team: c.team,
        })),
        starter: s.starter,
        turn: s.turn,
        turnNo: s.turnNo,
        clue: s.clue ? { word: s.clue.word, count: s.clue.count, left: s.clue.left, found: s.clue.found, guesses: s.clue.guesses, team: s.clue.team } : null,
        suggestions,
        timer: this.playing() && s.timerEnd ? { total: s.timerTotal, remaining: Math.max(0, s.timerEnd - this.now()) } : null,
        result: clone(s.result),
        matchWinner: this.matchWinner(),
        games: s.games.map((g) => ({ game: g.game, winner: g.winner, reason: g.reason })),
        event: clone(s.event),
        drinks: s.drinks.slice(-8).map((d) => Object.assign({}, d)),
        awards: clone(s.awards),
        // Nur Chef-Handys: Code für den QR-Link der Schlüsselkarte (der Laptop ist der Host)
        secret: stage && !this.write && s.code ? s.code : null,
        me: stage
          ? { stage: true }
          : {
              id: viewer,
              name: (s.members[viewer] || {}).name || '',
              team: myTeam ? myTeam.id : null,
              role,
              suggestion: Object.keys(s.suggestions).find((k) => s.suggestions[k].includes(viewer)) ?? null,
            },
      };
      if (view.me.suggestion != null) view.me.suggestion = +view.me.suggestion;
      return view;
    }
  }

  root.GSEngine = {
    Engine,
    STAGE,
    TEAMS,
    INPUTS,
    MATCH_OPTIONS,
    TIMER_OPTIONS,
    DRINK_OPTIONS,
    WORD_OPTIONS,
    DEFAULT_SETTINGS,
    DRINKS,
    CLUE_DRINK_MIN,
    UNLIMITED,
    MAX_COUNT,
    MAX_WORD,
    MAX_PLAYERS,
    sanitizeSettings,
    cleanName,
    cleanCount,
    guessLimit,
    winsNeeded,
  };
})(typeof window !== 'undefined' ? window : globalThis);
