/*
 * Spiellogik von „Hit Story“.
 *
 * Ein Song läuft. Wer dran ist, legt ihn in die richtige Lücke des eigenen Zeitstrahls (Startkarte zählt mit).
 * Richtig → die Karte bleibt. Gleiches Jahr wie eine Nachbarkarte zählt auf beiden Seiten als richtig.
 * Wer zuerst das Ziel erreicht, löst das Ende aus – die Runde wird noch zu Ende gespielt.
 *
 * Zwei Spielweisen (settings.input):
 *  - phones: Laptop = Bühne und Lautsprecher, jede/r spielt am eigenen Handy (Zeitstrahl, Titel tippen, Einspruch)
 *  - one:    ein Gerät in der Mitte, alles wird auf dem Laptop getippt, Titel + Interpret laut sagen
 *
 * Ton (settings.audio): itunes = 30-s-Ausschnitt spielt am Laptop · manual = „Selbst abspielen“: der DJ (reihum die
 * Person davor oder eine Spielleitung) sieht Titel + Interpret und spielt den Song in der eigenen Musik-App ab.
 *
 * Zeitstrahle gehören „Teams“: ohne Teams hat jede Person ihr eigenes (Team aus einer Person), mit Teams (Handys)
 * teilen sich die Mitglieder einen Zeitstrahl, bei 🤝 Kooperativ alle zusammen einen.
 *
 * Phasen: lobby (Handys) → listen (Song läuft, Lücke wählen, Titel tippen) → challenge (Einspruch-Zeit)
 *         → reveal (Jahr gezeigt, noch nichts verbucht) → listen … → end
 * Verbucht wird erst beim Weiter (next), damit die Spielleitung „Titel gewusst“ noch korrigieren kann.
 *
 * Joker 🪙 (Start 0/2/3, höchstens 5): Titel + Interpret richtig → +1 · Song überspringen → 1 · 3 Joker → Karte gratis
 * · Einspruch „Daneben!“ → 1: andere legen die Karte in eine andere Lücke des aktiven Zeitstrahls. Lag die aktive
 *   Person falsch und der Einspruch richtig, bekommt die Einspruch-Person die Karte. Wer zuerst drückt, zählt.
 *
 * Varianten: 🟢 Leicht (nur vor/nach einer Karte) · 🔴 Profi (Titel + Interpret Pflicht) · 🤝 Kooperativ (ein
 * Zeitstrahl, Ziel schaffen, bevor 3 Fehler passieren) · 🎯 Jahr genau (Jahr tippen: genau 3, ±1 2, ±3 1 Punkt).
 *
 * Gefilterte Ansicht: Titel, Interpret, Jahr und Ausschnitt des laufenden Songs bekommt vor der Auflösung kein Handy
 * (nur der DJ-Handy Titel + Interpret, ohne Jahr). Die Bühne bekommt den Song, zeigt ihn aber erst bei reveal.
 */
(function (root) {
  'use strict';

  const T = root.HSTimeline;

  const GAME = 'hit-story';
  const STAGE = 'stage';
  const INPUTS = ['phones', 'one'];
  const AUDIOS = ['itunes', 'manual'];
  const TARGETS = [5, 10, 15];
  const JOKER_STARTS = [0, 2, 3];
  const VARIANTS = ['normal', 'easy', 'pro', 'coop', 'exact'];
  const TEAM_COUNTS = [0, 2, 3, 4];
  const DJS = ['turn', 'host'];
  const MAX_JOKERS = 5;
  const SKIP_COST = 1;
  const BUY_COST = 3;
  const CHALLENGE_COST = 1;
  const CHALLENGE_MS = 10000;
  const COOP_LIVES = 3;
  const EXACT_FACTOR = 2; // Jahr genau: Ziel in Punkten = Karten-Ziel × 2
  const SIPS_WRONG = 1;
  const SIPS_CHALLENGED = 2;
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 10; // eigene Zeitstrahle
  const MAX_MEMBERS = 16; // Handys mit Teams
  const MAX_NAME = 20;
  const MAX_GUESS = 80;
  const MIN_POOL = 20;
  const TEAMS = [
    { name: 'Team Rot', color: '#f87171' },
    { name: 'Team Blau', color: '#60a5fa' },
    { name: 'Team Grün', color: '#4ade80' },
    { name: 'Team Gelb', color: '#facc15' },
  ];
  const COLORS = ['#ff4fa3', '#34d3c5', '#ffd166', '#a78bfa', '#fb923c', '#4ade80', '#60a5fa', '#f87171', '#e879f9', '#a3e635'];
  const DEFAULT_SETTINGS = {
    input: 'phones',
    audio: 'itunes',
    target: 10,
    jokers: 2,
    variant: 'normal',
    teams: 0,
    dj: 'turn',
    cats: [],
    decades: [],
    level: 'all',
    drinks: false,
  };

  function Songs() {
    return root.Songs;
  }

  function Titles() {
    return root.GameTitles;
  }

  function pick(list, value, fallback) {
    return list.includes(value) ? value : fallback;
  }

  function uniq(list) {
    return Array.from(new Set(list));
  }

  function clone(o) {
    return o == null ? o : JSON.parse(JSON.stringify(o));
  }

  function sanitizeSettings(input, current) {
    const o = Object.assign({}, current || DEFAULT_SETTINGS, input || {});
    const d = DEFAULT_SETTINGS;
    const S = Songs();
    const cats = Array.isArray(o.cats) ? uniq(o.cats.filter((c) => S.CATEGORY_IDS.includes(c))) : [];
    const decades = Array.isArray(o.decades) ? uniq(o.decades.map(Number).filter((x) => S.DECADES.includes(x))).sort() : [];
    const s = {
      input: pick(INPUTS, o.input, d.input),
      audio: pick(AUDIOS, o.audio, d.audio),
      target: pick(TARGETS, Number(o.target), d.target),
      jokers: pick(JOKER_STARTS, Number(o.jokers), d.jokers),
      variant: pick(VARIANTS, o.variant, d.variant),
      teams: pick(TEAM_COUNTS, Number(o.teams), d.teams),
      dj: pick(DJS, o.dj, d.dj),
      // alles angekreuzt = keine Einschränkung
      cats: cats.length === S.CATEGORY_IDS.length ? [] : cats,
      decades: decades.length === S.DECADES.length ? [] : decades,
      level: pick(S.LEVEL_IDS, o.level, d.level),
      drinks: !!o.drinks,
    };
    // Teams gibt es nur mit Handys und nicht kooperativ (da spielen ohnehin alle zusammen)
    if (s.input === 'one' || s.variant === 'coop') s.teams = 0;
    return s;
  }

  function cleanName(n, fallback) {
    const s = String(n == null ? '' : n)
      .replace(/[\u0000-\u001f<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_NAME);
    return s || fallback || '';
  }

  function cleanGuess(t) {
    return String(t == null ? '' : t)
      .replace(/[\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_GUESS);
  }

  /** Alle Songs, die zu den Einstellungen passen */
  function pool(settings) {
    const s = sanitizeSettings(settings);
    return Songs().filter({ cats: s.cats, decades: s.decades, level: s.level });
  }

  /** Karte für den Zeitstrahl (nur, was das Spiel braucht) */
  function card(song) {
    return { id: song.id, title: song.title, artist: song.artist, year: song.year };
  }

  /** Laufender Song: Karte + weitere Antworten (für die Titel-Prüfung) */
  function current(song) {
    return Object.assign(card(song), { alts: (song.alts || []).slice() });
  }

  /** Jahr genau: Punkte für den Abstand */
  function exactPoints(diff) {
    if (diff === 0) return 3;
    if (diff <= 1) return 2;
    if (diff <= 3) return 1;
    return 0;
  }

  function newStats() {
    return { placed: 0, right: 0, streak: 0, best: 0, named: 0, challenges: 0, challengeWins: 0, skips: 0, bought: 0 };
  }

  /* ------------------------------------------------------------------ */
  /* Spiel                                                               */
  /* ------------------------------------------------------------------ */

  class Engine {
    /**
     * @param {object} state Spielzustand (siehe Engine.create)
     * @param {{onChange?, onKick?, now?, random?, timers?: boolean, used?, onDraw?}} hooks
     *   timers: false schaltet die Einspruch-Zeit ab (Tests rufen tick() selbst auf)
     *   used / onDraw: Songs des Abends (Liste oder Funktion) – sonst aus Engine.evening (setzt die Oberfläche)
     */
    constructor(state, hooks) {
      this.s = state;
      this.hooks = hooks || {};
      this.now = this.hooks.now || (() => Date.now());
      this.timer = null;
      this._pool = null;
      this.tick();
      this.armTimer();
    }

    /**
     * Neues Spiel. Handys: Lobby. Ein Gerät: { players: ['Anna', …] } – das Spiel startet sofort.
     */
    static create(config, hooks) {
      const settings = sanitizeSettings(config.settings);
      if (pool(settings).length < MIN_POOL) throw new Error('Zu wenige Songs – bitte mehr Jahrzehnte oder Kategorien wählen');
      const state = {
        v: 2,
        game: GAME,
        settings,
        phase: 'lobby',
        members: {},
        order: [], // Reihenfolge der Mitglieder (Sitzordnung bzw. Beitritt)
        teams: [],
        first: 0,
        turn: 0,
        round: 1,
        turns: 0,
        song: null,
        next: null,
        pick: null,
        year: null,
        guess: null,
        ref: null,
        challenge: null,
        challengeEnd: null,
        last: null,
        mistakes: 0,
        finalRound: false,
        reason: null,
        used: [],
        log: [],
        startedAt: null,
      };
      if (settings.input === 'one') {
        const names = (config.players || []).map((n) => cleanName(n)).filter(Boolean).slice(0, MAX_PLAYERS);
        if (names.length < MIN_PLAYERS) throw new Error(`Mindestens ${MIN_PLAYERS} Namen`);
        names.forEach((name, i) => {
          const id = 'p' + (i + 1);
          state.members[id] = { name, online: true, local: true, joined: i };
          state.order.push(id);
        });
        new Engine(state, Object.assign({}, hooks, { timers: false, onChange: null })).startGame();
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

    random() {
      return (this.hooks.random || Math.random)();
    }

    /* ---------- Hilfsfunktionen ---------- */

    get write() {
      return this.s.settings.input === 'phones';
    }

    get variant() {
      return this.s.settings.variant;
    }

    get pool() {
      if (!this._pool) this._pool = pool(this.s.settings);
      return this._pool;
    }

    /** Ziel: Karten, bei Jahr genau Punkte */
    goal() {
      return this.variant === 'exact' ? this.s.settings.target * EXACT_FACTOR : this.s.settings.target;
    }

    progress(team) {
      return this.variant === 'exact' ? team.points : team.cards.length;
    }

    get team() {
      return this.s.teams[this.s.turn] || null;
    }

    teamOf(pid) {
      const i = this.s.teams.findIndex((t) => t.members.includes(pid));
      return i < 0 ? null : i;
    }

    memberName(pid) {
      const m = this.s.members[pid];
      return m ? m.name : '?';
    }

    isOnline(pid) {
      const m = this.s.members[pid];
      return !!(m && (m.local || m.online));
    }

    /** Wer aus dem aktiven Team tippt gerade? (Mitglieder wechseln sich ab) */
    speaker(ti) {
      const t = this.s.teams[ti === undefined ? this.s.turn : ti];
      if (!t || !t.members.length) return null;
      return t.members[t.seat % t.members.length];
    }

    /** DJ bei „Selbst abspielen“: Mitglieds-ID – oder null (Spielleitung / iTunes) */
    djMember() {
      const s = this.s;
      if (s.settings.audio !== 'manual' || s.settings.dj === 'host' || !s.teams.length) return null;
      if (s.teams.length === 1) {
        // Kooperativ: die Person vor der, die gerade tippt
        const t = s.teams[0];
        if (t.members.length < 2) return null;
        return t.members[(t.seat - 1 + t.members.length) % t.members.length];
      }
      return this.speaker((s.turn - 1 + s.teams.length) % s.teams.length);
    }

    /** Spielleitung am Handy: das am längsten verbundene Handy */
    leadPid() {
      if (!this.write) return null;
      let best = null;
      for (const pid of this.s.order) {
        const m = this.s.members[pid];
        if (m && m.online && (!best || (m.joined || 0) < best.joined)) best = { pid, joined: m.joined || 0 };
      }
      return best ? best.pid : null;
    }

    /** Darf diese Person den Ablauf steuern? (Laptop oder Spielleitung am Handy) */
    leads(actor) {
      return actor === STAGE || (!!actor && actor === this.leadPid());
    }

    /** Darf diese Person für das aktive Team handeln? (Laptop oder ein Mitglied) */
    actsForTurn(actor) {
      return actor === STAGE || (this.write && this.teamOf(actor) === this.s.turn);
    }

    /** Zeitstrahl, in den gerade gelegt wird – bei 🟢 Leicht nur die Vergleichskarte */
    line(ti) {
      const t = this.s.teams[ti === undefined ? this.s.turn : ti];
      if (!t) return [];
      if (this.variant === 'easy') {
        const ref = t.cards.find((c) => c.id === this.s.ref) || t.cards[t.cards.length - 1];
        return ref ? [ref] : [];
      }
      return t.cards;
    }

    hasGaps() {
      return this.variant !== 'exact';
    }

    canChallengeAtAll() {
      return this.hasGaps() && this.variant !== 'coop' && this.s.teams.length > 1;
    }

    /** Darf dieses Team Einspruch erheben? (nicht dran, ≥1 Joker, nicht das Team des DJs) */
    teamMayChallenge(ti) {
      const s = this.s;
      const t = s.teams[ti];
      if (!t || ti === s.turn || !this.canChallengeAtAll() || t.jokers < CHALLENGE_COST) return false;
      const dj = this.djMember();
      return !(dj && t.members.includes(dj));
    }

    challengers() {
      return this.s.teams.map((_, i) => i).filter((i) => this.teamMayChallenge(i));
    }

    /* ---------- Songs ---------- */

    taken() {
      const ids = new Set(this.s.used);
      for (const t of this.s.teams) for (const c of t.cards) ids.add(c.id);
      if (this.s.song) ids.add(this.s.song.id);
      if (this.s.next) ids.add(this.s.next.id);
      return ids;
    }

    evening() {
      const h = this.hooks.used !== undefined ? this.hooks : Engine.evening || {};
      return { used: typeof h.used === 'function' ? h.used() : h.used, onDraw: this.hooks.onDraw || (Engine.evening || {}).onDraw };
    }

    /** Song ziehen (keine Wiederholung im Spiel, möglichst auch nicht am selben Abend) – null = keine mehr */
    drawSong() {
      const S = Songs();
      const taken = Array.from(this.taken());
      const ev = this.evening();
      const opts = { random: () => this.random() };
      let reset = false;
      let song = S.draw(this.pool, taken.concat(ev.used || []), opts);
      if (!song && ev.used && ev.used.length) {
        reset = true;
        song = S.draw(this.pool, taken, opts);
      }
      if (!song) return null;
      const c = current(song);
      this.s.used.push(c.id);
      if (ev.onDraw) ev.onDraw(c, reset);
      return c;
    }

    /** Nächster Song: der vorgeladene, dann gleich wieder einen vorladen (die Bühne lädt den Ausschnitt schon vor) */
    advanceSong() {
      const s = this.s;
      s.song = null;
      const song = s.next || this.drawSong();
      s.next = null;
      if (!song) return null;
      s.song = song;
      s.next = this.drawSong();
      return song;
    }

    /* ---------- Verbindungen (Handys) ---------- */

    connect(pid, name) {
      const s = this.s;
      const m = s.members[pid];
      if (m) {
        m.online = true;
        delete m.offlineAt;
        if (name) m.name = cleanName(name, m.name);
      } else {
        if (s.phase !== 'lobby' || s.order.length >= this.maxMembers()) {
          // zu spät oder voll: schaut zu
          s.members[pid] = { name: cleanName(name, 'Gast'), online: true, joined: this.now(), watch: true };
        } else {
          s.members[pid] = { name: cleanName(name, 'Gast'), online: true, joined: this.now() };
          s.order.push(pid);
          this.autoTeam(pid);
        }
      }
      // Ohne Teams heißt der Zeitstrahl wie die Person
      const ti = this.teamOf(pid);
      if (ti !== null && !s.settings.teams && s.settings.variant !== 'coop') s.teams[ti].name = s.members[pid].name;
      this.changed();
    }

    maxMembers() {
      return this.s.settings.teams ? MAX_MEMBERS : MAX_PLAYERS;
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
        if (m.local) continue;
        if (m.online) m.offlineAt = now;
        m.online = false;
      }
    }

    /** Lobby mit Teams: neue Person ins kleinste Team */
    autoTeam(pid) {
      const s = this.s;
      if (!s.settings.teams) return;
      const m = s.members[pid];
      const counts = Array.from({ length: s.settings.teams }, (_, i) => s.order.filter((p) => s.members[p].team === i).length);
      m.team = counts.indexOf(Math.min(...counts));
    }

    /** Lobby: Team-Zuteilung an die Einstellung anpassen */
    regroup() {
      const s = this.s;
      for (const pid of s.order) {
        const m = s.members[pid];
        if (!s.settings.teams) delete m.team;
        else if (!(m.team >= 0 && m.team < s.settings.teams)) m.team = undefined;
      }
      for (const pid of s.order) if (s.settings.teams && s.members[pid].team === undefined) this.autoTeam(pid);
    }

    /* ---------- Ablauf ---------- */

    /** Teams aus den Mitgliedern bilden */
    buildTeams() {
      const s = this.s;
      const playing = s.order.filter((pid) => this.isOnline(pid) && !s.members[pid].watch);
      const team = (name, color, members) => ({ id: 't' + (s.teams.length + 1), name, color, members, seat: 0, cards: [], jokers: 0, points: 0, stats: newStats() });
      s.teams = [];
      if (s.settings.variant === 'coop') {
        s.teams.push(team('Alle zusammen', COLORS[0], playing));
      } else if (s.settings.teams) {
        for (let i = 0; i < s.settings.teams; i++) {
          const members = playing.filter((pid) => s.members[pid].team === i);
          if (members.length) s.teams.push(team(TEAMS[i].name, TEAMS[i].color, members));
        }
      } else {
        playing.forEach((pid, i) => s.teams.push(team(s.members[pid].name, COLORS[i % COLORS.length], [pid])));
      }
    }

    lobbyProblem() {
      const s = this.s;
      const playing = s.order.filter((pid) => this.isOnline(pid) && !s.members[pid].watch);
      if (playing.length < MIN_PLAYERS) return `Ihr braucht mindestens ${MIN_PLAYERS} Personen – scannt den QR-Code!`;
      if (s.settings.teams) {
        const used = new Set(playing.map((pid) => s.members[pid].team));
        if (used.size < 2) return 'Mindestens zwei Teams brauchen Mitglieder.';
      }
      if (this.pool.length < MIN_POOL) return 'Zu wenige Songs – bitte mehr Jahrzehnte oder Kategorien wählen.';
      return null;
    }

    startGame() {
      const s = this.s;
      this._pool = null;
      this.buildTeams();
      s.round = 1;
      s.turns = 0;
      s.mistakes = 0;
      s.finalRound = false;
      s.reason = null;
      s.log = [];
      s.used = [];
      s.song = null;
      s.next = null;
      s.startedAt = this.now();
      for (const t of s.teams) {
        t.cards = [];
        t.jokers = s.settings.jokers;
        t.points = 0;
        t.seat = 0;
        t.stats = newStats();
      }
      for (const t of s.teams) {
        const c = this.drawSong();
        if (c) t.cards.push(card(c));
      }
      s.first = Math.floor(this.random() * s.teams.length);
      s.turn = s.first;
      if (s.teams.length === 1) s.teams[0].seat = Math.floor(this.random() * Math.max(1, s.teams[0].members.length));
      this.startTurn();
      if (!s.song) this.finish('empty');
    }

    /** Neuer Zug für das Team s.turn */
    startTurn() {
      const s = this.s;
      s.phase = 'listen';
      s.pick = null;
      s.year = null;
      s.guess = null;
      s.challenge = null;
      s.challengeEnd = null;
      s.last = null;
      s.ref = null;
      if (this.variant === 'easy') {
        const cards = this.team.cards;
        s.ref = cards.length ? cards[Math.floor(this.random() * cards.length)].id : null;
      }
      return this.advanceSong();
    }

    /** Einloggen: Lücke (bzw. Jahr) steht → Einspruch-Zeit oder gleich auflösen */
    lockIn() {
      const s = this.s;
      if (this.write && this.challengers().length) {
        s.phase = 'challenge';
        s.challengeEnd = this.now() + CHALLENGE_MS;
      } else if (!this.write && this.challengers().length) {
        // Ein Gerät: Einspruch per Knopf, ohne Uhr – „Auflösen“ beendet die Zeit
        s.phase = 'challenge';
        s.challengeEnd = null;
      } else {
        this.reveal();
      }
    }

    /** Auflösen: Ergebnis berechnen (verbucht wird erst bei next) */
    reveal(bought) {
      const s = this.s;
      const song = s.song;
      const line = this.line();
      const l = {
        team: s.turn,
        speaker: this.speaker(),
        gap: s.pick,
        year: s.year,
        bought: !!bought,
        correct: false,
        points: 0,
        diff: null,
        gaps: this.hasGaps() ? T.correctGaps(line, song.year) : [],
        named: false,
        namedAuto: false,
        guess: s.guess ? clone(s.guess) : null,
        check: null,
        challenge: null,
      };
      if (bought) l.correct = true;
      else if (this.variant === 'exact') {
        l.diff = Math.abs(s.year - song.year);
        l.points = exactPoints(l.diff);
        l.correct = l.points > 0;
      } else l.correct = T.fits(line, s.pick, song.year);
      if (s.guess && Titles()) {
        l.check = Titles().checkSong(s.guess.title, s.guess.artist, song);
        l.named = l.namedAuto = l.check.both;
      }
      if (s.challenge) {
        l.challenge = Object.assign(clone(s.challenge), { correct: T.fits(line, s.challenge.gap, song.year) });
      }
      s.last = l;
      s.phase = 'reveal';
      s.challengeEnd = null;
      return true;
    }

    /**
     * Was beim Weiter verbucht wird: { keep, stolen, joker, sips: [{team, sips}], mistake, valid }
     * keep = Karte bleibt beim aktiven Team · stolen = Einspruch-Team bekommt sie
     */
    outcome() {
      const s = this.s;
      const l = s.last;
      if (!l) return null;
      const pro = this.variant === 'pro';
      const valid = l.bought || !pro || l.named;
      const keep = l.correct && valid;
      const stolen = !keep && !!(l.challenge && l.challenge.correct);
      const joker = l.named && !l.bought ? 1 : 0;
      const sips = [];
      if (s.settings.drinks) {
        if (stolen) sips.push({ team: l.team, sips: SIPS_CHALLENGED });
        else if (!keep) sips.push({ team: l.team, sips: SIPS_WRONG });
      }
      return { keep, stolen, joker, valid, sips, mistake: this.variant === 'coop' && !keep };
    }

    /** Zeitstrahle so, wie sie nach dem Verbuchen aussehen (für die Auflösung) – [{ cards, fresh }] */
    previewCards() {
      const s = this.s;
      const o = this.outcome();
      return s.teams.map((t, i) => {
        let cards = t.cards.slice();
        let fresh = null;
        const gets = o && ((o.keep && i === s.last.team) || (o.stolen && i === s.last.challenge.team));
        if (gets) {
          // in der gewählten Lücke (wichtig bei gleichen Jahren); bei Leicht, Einspruch und Kauf an der richtigen Stelle
          const gap = i === s.last.team && this.variant !== 'easy' ? s.last.gap : undefined;
          const r = T.insert(cards, card(s.song), gap);
          cards = r.cards;
          fresh = r.at;
        }
        return { cards, fresh };
      });
    }

    /** Verbuchen: Karte, Joker, Statistik, Fehler */
    commit() {
      const s = this.s;
      const l = s.last;
      const o = this.outcome();
      const t = s.teams[l.team];
      const st = t.stats;
      const preview = this.previewCards();
      if (o.keep) t.cards = preview[l.team].cards;
      if (o.stolen) {
        const ct = s.teams[l.challenge.team];
        ct.cards = preview[l.challenge.team].cards;
        ct.stats.challengeWins++;
      }
      if (this.variant === 'exact') t.points += l.points;
      if (!l.bought) {
        st.placed++;
        if (o.keep) {
          st.right++;
          st.streak++;
          st.best = Math.max(st.best, st.streak);
        } else st.streak = 0;
      }
      if (l.named) st.named++;
      t.jokers = Math.min(MAX_JOKERS, t.jokers + o.joker);
      if (o.mistake) s.mistakes++;
      s.turns++;
      s.log.push({
        round: s.round,
        team: l.team,
        speaker: l.speaker,
        song: card(s.song),
        gap: l.gap,
        year: l.year,
        correct: l.correct,
        keep: o.keep,
        stolen: o.stolen ? l.challenge.team : null,
        named: l.named,
        bought: l.bought,
        points: l.points,
      });
    }

    /** Hat jemand das Ziel erreicht? */
    reached() {
      return this.s.teams.some((t) => this.progress(t) >= this.goal());
    }

    /** Endet das Spiel beim nächsten Weiter? (für „🏆 Zur Siegerehrung“) */
    willEnd() {
      const s = this.s;
      if (s.phase !== 'reveal') return false;
      const o = this.outcome();
      const preview = this.previewCards();
      const prog = s.teams.map((t, i) => (this.variant === 'exact' ? t.points + (i === s.last.team ? s.last.points : 0) : preview[i].cards.length));
      const reached = prog.some((p) => p >= this.goal());
      if (this.variant === 'coop') return reached || s.mistakes + (o.mistake ? 1 : 0) >= COOP_LIVES;
      return (s.finalRound || reached) && (s.turn + 1) % s.teams.length === s.first;
    }

    finish(reason) {
      const s = this.s;
      s.phase = 'end';
      s.reason = reason;
      s.challengeEnd = null;
      return true;
    }

    /** Weiter nach der Auflösung: verbuchen, nächstes Team – oder Siegerehrung */
    next() {
      const s = this.s;
      if (s.phase !== 'reveal') return false;
      this.commit();
      const n = s.teams.length;
      if (this.variant === 'coop') {
        if (this.reached()) return this.finish('won');
        if (s.mistakes >= COOP_LIVES) return this.finish('lost');
      }
      if (this.reached()) s.finalRound = true;
      const turn = (s.turn + 1) % n;
      const newRound = turn === s.first;
      if (this.variant !== 'coop' && s.finalRound && newRound) return this.finish('target');
      const t = this.team;
      t.seat = (t.seat + 1) % Math.max(1, t.members.length);
      s.turn = turn;
      if (newRound) s.round++;
      if (!this.startTurn()) return this.finish('empty');
      return true;
    }

    /* ---------- Zeit ---------- */

    armTimer() {
      clearTimeout(this.timer);
      this.timer = null;
      if (this.hooks.timers === false) return;
      const end = this.s.phase === 'challenge' ? this.s.challengeEnd : null;
      if (!end) return;
      this.timer = setTimeout(
        () => {
          if (this.tick()) this.changed();
          else this.armTimer();
        },
        Math.max(0, end - this.now()) + 30
      );
    }

    /** Abgelaufene Einspruch-Zeit auswerten. true = hat sich etwas geändert */
    tick() {
      const s = this.s;
      if (s.phase === 'challenge' && s.challengeEnd && s.challengeEnd <= this.now()) return this.reveal();
      return false;
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
      s.settings = sanitizeSettings(Object.assign({}, a.settings, { input: s.settings.input }), s.settings);
      this._pool = null;
      this.regroup();
      return true;
    }

    /** Team wechseln (Handy oder Laptop für eine Person) */
    on_team(a, actor) {
      const s = this.s;
      const pid = actor === STAGE ? a.player : actor;
      const m = s.members[pid];
      const team = Number(a.team);
      if (s.phase !== 'lobby' || !m || m.watch || !s.settings.teams || !(team >= 0 && team < s.settings.teams) || m.team === team) return false;
      m.team = team;
      return true;
    }

    /** Mitspielen / nur zuschauen (Lobby) */
    on_watch(a, actor) {
      const s = this.s;
      const m = s.members[actor];
      if (!this.write || s.phase !== 'lobby' || !m || !!m.watch === !!a.watch) return false;
      if (!a.watch && s.order.filter((p) => !s.members[p].watch).length >= this.maxMembers()) return false;
      m.watch = !!a.watch;
      if (!s.order.includes(actor)) s.order.push(actor);
      if (!m.watch) this.autoTeam(actor);
      return true;
    }

    on_kick(a, actor) {
      const s = this.s;
      const pid = a.player;
      if (actor !== STAGE || !this.write || !s.members[pid]) return false;
      delete s.members[pid];
      s.order = s.order.filter((p) => p !== pid);
      if (this.hooks.onKick) this.hooks.onKick(pid);
      // mitten im Spiel: Person verlässt ihr Team, der Zeitstrahl bleibt
      for (const t of s.teams) {
        const i = t.members.indexOf(pid);
        if (i >= 0) {
          t.members.splice(i, 1);
          if (t.seat > i) t.seat--;
        }
      }
      return true;
    }

    on_start(a, actor) {
      if (actor !== STAGE || this.s.phase !== 'lobby' || this.lobbyProblem()) return false;
      this.startGame();
      return true;
    }

    /* Zug */

    on_choose(a, actor) {
      const s = this.s;
      const gap = Number(a.gap);
      if (s.phase !== 'listen' || !this.hasGaps() || !this.actsForTurn(actor) || !T.validGap(this.line(), gap)) return false;
      s.pick = gap;
      return true;
    }

    on_year(a, actor) {
      const s = this.s;
      const year = Math.round(Number(a.year));
      if (s.phase !== 'listen' || this.hasGaps() || !this.actsForTurn(actor) || !(year >= Songs().MIN_YEAR && year <= Songs().MAX_YEAR)) return false;
      s.year = year;
      return true;
    }

    /** Titel + Interpret (Handy des aktiven Teams, während der Song läuft) */
    on_guess(a, actor) {
      const s = this.s;
      if (s.phase !== 'listen' || actor === STAGE || !this.actsForTurn(actor)) return false;
      const title = cleanGuess(a.title);
      const artist = cleanGuess(a.artist);
      s.guess = title || artist ? { title, artist, by: actor } : null;
      return true;
    }

    /** Einloggen (mit Lücke/Jahr und Tipp in einer Nachricht möglich) */
    on_place(a, actor) {
      const s = this.s;
      if (s.phase !== 'listen' || !this.actsForTurn(actor)) return false;
      if (a.gap !== undefined) this.on_choose({ gap: a.gap }, actor);
      if (a.year !== undefined) this.on_year({ year: a.year }, actor);
      if ((a.title !== undefined || a.artist !== undefined) && actor !== STAGE) this.on_guess(a, actor);
      if (this.hasGaps() ? s.pick === null : s.year === null) return false;
      this.lockIn();
      return true;
    }

    /** Joker: Song überspringen (1 🪙) */
    on_skip(a, actor) {
      const s = this.s;
      const t = this.team;
      if (s.phase !== 'listen' || !this.actsForTurn(actor) || !t || t.jokers < SKIP_COST) return false;
      const old = s.song;
      if (!s.next) return false;
      t.jokers -= SKIP_COST;
      t.stats.skips++;
      s.log.push({ round: s.round, team: s.turn, speaker: this.speaker(), song: card(old), skipped: true });
      s.pick = null;
      s.year = null;
      s.guess = null;
      this.advanceSong();
      return true;
    }

    /** Ausschnitt nicht zu finden / Song läuft nicht → anderer Song, ohne Folgen (Laptop, DJ oder Spielleitung) */
    on_replace(a, actor) {
      const s = this.s;
      const dj = this.djMember();
      if (s.phase !== 'listen' || !(actor === STAGE || actor === dj || this.leads(actor))) return false;
      if (a.id && s.song && a.id !== s.song.id) return false;
      if (!s.next) return false;
      s.log.push({ round: s.round, team: s.turn, speaker: this.speaker(), song: card(s.song), skipped: true, replaced: true });
      s.pick = null;
      s.year = null;
      s.guess = null;
      this.advanceSong();
      return true;
    }

    /** Joker: 3 🪙 → Karte gratis (wird richtig eingeordnet) */
    on_buy(a, actor) {
      const s = this.s;
      const t = this.team;
      if (s.phase !== 'listen' || !this.hasGaps() || !this.actsForTurn(actor) || !t || t.jokers < BUY_COST) return false;
      t.jokers -= BUY_COST;
      t.stats.bought++;
      return this.reveal(true);
    }

    /** Einspruch „Daneben!“ – Handy eines anderen Teams, oder der Laptop für ein Team ({ team }) */
    on_challenge(a, actor) {
      const s = this.s;
      if (s.phase !== 'challenge' || s.challenge) return false;
      const ti = actor === STAGE ? Number(a.team) : this.teamOf(actor);
      const gap = Number(a.gap);
      if (ti === null || !this.teamMayChallenge(ti)) return false;
      if (!T.validGap(this.line(), gap) || gap === s.pick) return false;
      const t = s.teams[ti];
      t.jokers -= CHALLENGE_COST;
      t.stats.challenges++;
      s.challenge = { team: ti, by: actor === STAGE ? null : actor, gap };
      return this.reveal();
    }

    /** Einspruch-Zeit vorzeitig beenden */
    on_reveal(a, actor) {
      if (this.s.phase !== 'challenge' || !(this.leads(actor) || this.actsForTurn(actor))) return false;
      return this.reveal();
    }

    /** Spielleitung: Titel + Interpret gewusst? (ein Gerät: laut gesagt; Handys: Tippfehler großzügig werten) */
    on_named(a, actor) {
      const s = this.s;
      if (s.phase !== 'reveal' || !this.leads(actor) || !s.last || s.last.bought) return false;
      if (s.last.named === !!a.ok) return false;
      s.last.named = !!a.ok;
      return true;
    }

    on_next(a, actor) {
      if (!this.leads(actor)) return false;
      return this.next();
    }

    /** Spiel vorzeitig beenden (Laptop) */
    on_end(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase === 'lobby' || s.phase === 'end') return false;
      return this.finish('stopped');
    }

    /** Revanche: gleiche Leute, gleiche Einstellungen */
    on_again(a, actor) {
      if (actor !== STAGE || this.s.phase !== 'end') return false;
      this.startGame();
      return true;
    }

    /** Zurück in die Lobby (Handys): Einstellungen ändern, Leute kommen dazu */
    on_lobby(a, actor) {
      const s = this.s;
      if (actor !== STAGE || !this.write || s.phase !== 'end') return false;
      s.phase = 'lobby';
      s.teams = [];
      for (const pid of Object.keys(s.members)) {
        const m = s.members[pid];
        if (m.watch && s.order.length < this.maxMembers()) {
          m.watch = false;
          if (!s.order.includes(pid)) s.order.push(pid);
          this.autoTeam(pid);
        }
      }
      return true;
    }

    /* ---------- Auswertung ---------- */

    /** Rangliste: meiste Karten (Punkte), dann meiste Joker – Gleichstand teilt den Platz */
    ranking() {
      const rows = this.s.teams.map((t, i) => ({ i, name: t.name, color: t.color, progress: this.progress(t), cards: t.cards.length, points: t.points, jokers: t.jokers, right: t.stats.right, placed: t.stats.placed, best: t.stats.best }));
      const cmp = (a, b) => b.progress - a.progress || b.jokers - a.jokers;
      rows.sort((a, b) => cmp(a, b) || a.i - b.i);
      rows.forEach((r, k) => {
        r.place = k > 0 && cmp(rows[k - 1], r) === 0 ? rows[k - 1].place : k + 1;
      });
      return rows;
    }

    winners() {
      return this.ranking().filter((r) => r.place === 1);
    }

    /**
     * Auszeichnungen: 🕰️ Zeitreise (längste Serie, ab 2) · 🎧 Musiklexikon (meiste Titel erkannt) ·
     * ✋ Besserwisser (meiste erfolgreiche Einsprüche) – [{ id, icon, label, text, teams: [i], value }]
     */
    awards() {
      const s = this.s;
      const out = [];
      const best = (fn, min) => {
        const max = Math.max(0, ...s.teams.map(fn));
        return max >= min ? { value: max, teams: s.teams.map((t, i) => (fn(t) === max ? i : -1)).filter((i) => i >= 0) } : null;
      };
      const tt = best((t) => t.stats.best, 2);
      if (tt) out.push(Object.assign({ id: 'time', icon: '🕰️', label: 'Zeitreise', text: `${tt.value} richtig in Folge` }, tt));
      const lex = best((t) => t.stats.named, 1);
      if (lex) out.push(Object.assign({ id: 'lexikon', icon: '🎧', label: 'Musiklexikon', text: `${lex.value} Titel erkannt` }, lex));
      const bw = best((t) => t.stats.challengeWins, 1);
      if (bw) out.push(Object.assign({ id: 'besser', icon: '✋', label: 'Besserwisser', text: `${bw.value} ${bw.value === 1 ? 'Einspruch' : 'Einsprüche'} gewonnen` }, bw));
      return out;
    }

    /* ---------- Ansicht ---------- */

    viewFor(viewer) {
      const s = this.s;
      const stage = viewer === STAGE;
      const myTeam = stage ? null : this.teamOf(viewer);
      const myTurn = myTeam !== null && myTeam === s.turn;
      const open = s.phase === 'reveal' || s.phase === 'end';
      const playing = !['lobby', 'end'].includes(s.phase);
      const dj = this.djMember();
      const preview = s.phase === 'reveal' ? this.previewCards() : null;
      const outcome = s.phase === 'reveal' ? this.outcome() : null;
      const songCard = s.song ? card(s.song) : null;
      return {
        game: GAME,
        phase: s.phase,
        settings: clone(s.settings),
        goal: this.goal(),
        members: s.order
          .concat(Object.keys(s.members).filter((p) => !s.order.includes(p)))
          .map((id) => {
            const m = s.members[id];
            return { id, name: m.name, online: this.isOnline(id), team: m.team === undefined ? null : m.team, watch: !!m.watch, local: !!m.local };
          }),
        teams: s.teams.map((t, i) => ({
          id: t.id,
          name: t.name,
          color: t.color,
          members: t.members.map((pid) => ({ id: pid, name: this.memberName(pid), online: this.isOnline(pid) })),
          speaker: this.speaker(i),
          cards: preview ? preview[i].cards : t.cards.map((c) => Object.assign({}, c)),
          fresh: preview ? preview[i].fresh : null,
          jokers: t.jokers,
          points: t.points,
          progress: this.progress(t),
          mayChallenge: s.phase === 'challenge' && !s.challenge && this.teamMayChallenge(i),
          stats: s.phase === 'end' ? clone(t.stats) : null,
        })),
        turn: s.turn,
        first: s.first,
        round: s.round,
        turns: s.turns,
        songNo: s.log.length + 1,
        speaker: playing ? this.speaker() : null,
        pick: s.pick,
        year: s.year,
        ref: s.ref,
        line: playing ? this.line().map((c) => Object.assign({}, c)) : [],
        // Den Tipp sehen nur das eigene Team und (nach der Auflösung) alle
        guessed: !!s.guess,
        myGuess: s.guess && (myTurn || stage) && !open ? clone(s.guess) : null,
        challenge: s.challenge ? clone(s.challenge) : null,
        challengeEnd: s.phase === 'challenge' ? s.challengeEnd : null,
        // Restzeit statt Uhrzeit – die Uhren der Handys gehen nicht genau gleich
        challengeLeft: s.phase === 'challenge' && s.challengeEnd ? Math.max(0, s.challengeEnd - this.now()) : null,
        challengers: s.phase === 'challenge' && !s.challenge ? this.challengers() : [],
        song: !s.song ? null : stage ? current(s.song) : open ? songCard : null,
        nextSong: stage && s.next ? card(s.next) : null,
        dj,
        djName: dj ? this.memberName(dj) : null,
        // DJ-Handy: Titel + Interpret, nie das Jahr
        djSong: !stage && dj === viewer && s.phase === 'listen' && s.song ? { id: s.song.id, title: s.song.title, artist: s.song.artist } : null,
        last: s.last ? Object.assign(clone(s.last), { outcome }) : null,
        willEnd: this.willEnd(),
        finalRound: s.finalRound,
        mistakes: s.mistakes,
        lives: COOP_LIVES,
        reason: s.reason,
        log: s.phase === 'end' ? clone(s.log) : null,
        ranking: s.phase === 'end' ? this.ranking() : null,
        awards: s.phase === 'end' ? this.awards() : null,
        lobbyProblem: s.phase === 'lobby' && this.write ? this.lobbyProblem() : null,
        poolSize: s.phase === 'lobby' ? this.pool.length : null,
        me: stage
          ? { stage: true }
          : {
              id: viewer,
              name: this.memberName(viewer),
              team: myTeam,
              lobbyTeam: (s.members[viewer] || {}).team ?? null,
              watch: !!(s.members[viewer] || {}).watch,
              lead: viewer === this.leadPid(),
              dj: viewer === dj,
              myTurn,
            },
      };
    }
  }

  /** Songs des Abends – setzt die Oberfläche (der StageController reicht keine eigenen Hooks durch) */
  Engine.evening = null;

  root.HSEngine = {
    Engine,
    GAME,
    STAGE,
    INPUTS,
    AUDIOS,
    TARGETS,
    JOKER_STARTS,
    VARIANTS,
    TEAM_COUNTS,
    DJS,
    TEAMS,
    COLORS,
    MAX_JOKERS,
    SKIP_COST,
    BUY_COST,
    CHALLENGE_COST,
    CHALLENGE_MS,
    COOP_LIVES,
    EXACT_FACTOR,
    SIPS_WRONG,
    SIPS_CHALLENGED,
    MIN_PLAYERS,
    MAX_PLAYERS,
    MAX_MEMBERS,
    MAX_NAME,
    MIN_POOL,
    DEFAULT_SETTINGS,
    sanitizeSettings,
    cleanName,
    pool,
    card,
    exactPoints,
  };
})(typeof window !== 'undefined' ? window : globalThis);
