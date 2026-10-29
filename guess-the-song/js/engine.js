/*
 * Spiellogik von „Guess the song“.
 *
 * Zwei Arten von Songs (settings.mode: snip / hum / mixed = abwechselnd):
 *  - 🔊 Ausschnitt (snip): Der Laptop spielt erst 1 s, dann 2, 4, 8, 16, 30 s – immer von derselben Stelle.
 *    Je früher richtig, desto mehr Punkte (6 … 1). Auf der letzten Stufe gibt es einen Hinweis (Jahrzehnt +
 *    Anfangsbuchstabe des Interpreten). Wer zuerst richtig liegt, bekommt +1.
 *  - 🎤 Summen (hum): Reihum sucht sich eine Person einen von 3 Songs aus und summt ihn 60 s (oder pfeift,
 *    klopft, spielt Pantomime). Erster Treffer 3 Punkte, alle weiteren 1. Die Summer/in bekommt 2, wenn
 *    mindestens eine Person es erraten hat – und rät selbst nicht mit.
 *
 * Geraten wird (settings.guess):
 *  - type: am Handy tippen (Titel oder Interpret), automatisch geprüft. Höchstens 3 Fehlversuche pro Song,
 *          „knapp daneben“ (ein Tippfehler zu viel) kostet nichts. Nur der Interpret gibt die Hälfte (einstellbar).
 *  - buzz: Buzzer drücken und laut sagen. Ausschnitt: Laptop oder Spielleitung bestätigt (die Lösung lässt sich am
 *          Laptop aufdecken – dann ist der Song danach für alle vorbei). Summen: die Summer/in bestätigt.
 *          Falsch → für diesen Song raus. Wer zuerst beim Laptop ankommt, ist dran.
 * Ein Gerät (settings.input 'one'): alle rufen, am Laptop wird angetippt, wer zuerst gerufen hat – wie Buzzer.
 *
 * Wertungen gehören „Teams“: ohne Teams hat jede Person ihr eigenes (Team aus einer Person).
 *
 * Phasen: lobby (Handys) → pick (Summen: Song aussuchen) → play (Ausschnitt läuft / es wird gesummt)
 *         → buzzed (jemand hat gebuzzert) → reveal (Auflösung, Punkte verbucht) → … → end
 * Nach dem letzten Song: Gleichstand an der Spitze → Stechen (höchstens 3 Extra-Songs, nur die Punktgleichen raten).
 *
 * Ausschnitt-Ablauf: Die Bühne spielt die Stufe ab und meldet „heard“, dann laufen 10 s Ratezeit, danach kommt
 * die nächste Stufe. Die Spielleitung kann „Nochmal hören“, „Nächste Stufe“ und „Auflösen“ drücken.
 *
 * Gefilterte Ansicht: Titel und Interpret bekommt vor der Auflösung kein Handy – außer der Summer/in.
 * Die Bühne bekommt den Ausschnitt-Song (sie spielt ihn ab), zeigt ihn aber erst bei der Auflösung.
 */
(function (root) {
  'use strict';

  const GAME = 'guess-the-song';
  const STAGE = 'stage';
  const INPUTS = ['phones', 'one'];
  const MODES = ['snip', 'hum', 'mixed'];
  const GUESSES = ['type', 'buzz'];
  const COUNTS = [10, 15, 20];
  const STEP_SETS = {
    classic: { secs: [1, 2, 4, 8, 16, 30], points: [6, 5, 4, 3, 2, 1] },
    easy: { secs: [2, 5, 10, 30], points: [4, 3, 2, 1] },
  };
  const STEP_IDS = Object.keys(STEP_SETS);
  const ARTISTS = ['half', 'full', 'none'];
  const STARTS = ['chorus', 'random'];
  const HUMS = ['hum', 'whistle', 'knock', 'mime'];
  const TEAM_COUNTS = [0, 2, 3, 4];
  const SNIPPET_SECS = 30; // so lang sind die iTunes-Ausschnitte
  const MAX_OFFSET = 12; // schwere Startstelle: 0–12 s in den Ausschnitt hinein
  const GUESS_MS = 10000; // Ratezeit nach jeder Stufe
  const RESUME_MIN_MS = 3000; // nach einem falschen Buzz bleibt mindestens so viel Ratezeit
  const HUM_MS = 60000;
  const MAX_TRIES = 3;
  const FIRST_BONUS = 1;
  const HUM_FIRST = 3;
  const HUM_MORE = 1;
  const HUM_HUMMER = 2;
  const HUM_OPTIONS = 3;
  const SIPS_NOBODY = 1;
  const SIPS_GIVE = 3;
  const MAX_TIEBREAKS = 3;
  const MIN_PLAYERS = 2;
  const HUM_MIN_PLAYERS = 3;
  const MAX_PLAYERS = 12; // eigene Wertungen
  const MAX_MEMBERS = 16; // Handys mit Teams
  const MAX_NAME = 20;
  const MAX_GUESS = 80;
  const MIN_POOL = 40;
  const TEAMS = [
    { name: 'Team Rot', color: '#f87171' },
    { name: 'Team Blau', color: '#60a5fa' },
    { name: 'Team Grün', color: '#4ade80' },
    { name: 'Team Gelb', color: '#facc15' },
  ];
  const COLORS = ['#38bdf8', '#f472b6', '#facc15', '#a78bfa', '#fb923c', '#4ade80', '#f87171', '#2dd4bf', '#e879f9', '#a3e635', '#60a5fa', '#fda4af'];
  const DEFAULT_SETTINGS = {
    input: 'phones',
    mode: 'snip',
    guess: 'type',
    count: 15,
    steps: 'classic',
    artist: 'half',
    start: 'chorus',
    hum: 'hum',
    teams: 0,
    cats: [],
    decades: [],
    level: 'mixed',
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
      mode: pick(MODES, o.mode, d.mode),
      guess: pick(GUESSES, o.guess, d.guess),
      count: pick(COUNTS, Number(o.count), d.count),
      steps: pick(STEP_IDS, o.steps, d.steps),
      artist: pick(ARTISTS, o.artist, d.artist),
      start: pick(STARTS, o.start, d.start),
      hum: pick(HUMS, o.hum, d.hum),
      teams: pick(TEAM_COUNTS, Number(o.teams), d.teams),
      // alles angekreuzt = keine Einschränkung
      cats: cats.length === S.CATEGORY_IDS.length ? [] : cats,
      decades: decades.length === S.DECADES.length ? [] : decades,
      level: pick(S.LEVEL_IDS, o.level, d.level),
      drinks: !!o.drinks,
    };
    // Ein Gerät: gerufen wird laut, angetippt am Laptop – wie Buzzer, ohne Teams
    if (s.input === 'one') {
      s.teams = 0;
      s.guess = 'buzz';
    }
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

  /** Was alle nach der Auflösung sehen */
  function card(song) {
    return { id: song.id, title: song.title, artist: song.artist, year: song.year };
  }

  /** Laufender Song: Karte + weitere Antworten (für die Titel-Prüfung) */
  function current(song) {
    return Object.assign(card(song), { alts: (song.alts || []).slice() });
  }

  /** Punkte je Stufe */
  function stepPoints(steps, step) {
    const set = STEP_SETS[steps] || STEP_SETS.classic;
    return set.points[Math.max(0, Math.min(set.points.length - 1, step))];
  }

  /** Länge jeder Stufe in Sekunden ab der Startstelle – die letzte spielt den Rest des Ausschnitts */
  function stepSecs(steps, offset) {
    const secs = (STEP_SETS[steps] || STEP_SETS.classic).secs;
    const rest = SNIPPET_SECS - (offset || 0);
    return secs.map((x, i) => (i === secs.length - 1 ? rest : Math.min(x, rest)));
  }

  /** Punkte nur für den Interpreten */
  function artistPoints(mode, points) {
    if (mode === 'full') return points;
    if (mode === 'half') return Math.ceil(points / 2);
    return 0;
  }

  function best(results) {
    if (results.includes('yes')) return 'yes';
    if (results.includes('close')) return 'close';
    return 'no';
  }

  /**
   * Getippte Antwort prüfen: 'title' | 'artist' | 'close' | 'no'.
   * Auch „Titel – Interpret“ wird erkannt (jeder Teil einzeln).
   */
  function judgeGuess(text, song, withArtist) {
    const t = Titles();
    const raw = cleanGuess(text);
    if (!raw) return 'no';
    const parts = uniq([raw].concat(raw.split(/\s+[–—-]\s+|\s+(?:von|by)\s+/i).map((p) => p.trim()))).filter(Boolean);
    const title = best(parts.map((p) => t.checkTitle(p, song)));
    if (title === 'yes') return 'title';
    const artist = withArtist ? best(parts.map((p) => t.checkArtist(p, song.artist))) : 'no';
    if (artist === 'yes') return 'artist';
    return title === 'close' || artist === 'close' ? 'close' : 'no';
  }

  /** Hinweis der letzten Stufe: Jahrzehnt + Anfangsbuchstabe des Interpreten */
  function hintFor(song) {
    const name = String(song.artist || '').replace(/^(the|die|der|das)\s+/i, '');
    const initial = (name.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
    return { decade: Songs().decadeLabel(Songs().decadeOf(song.year)), initial };
  }

  function newStats() {
    return { hits: 0, wrong: 0, hummed: 0, humHits: 0, fast: null };
  }

  /* ------------------------------------------------------------------ */
  /* Spiel                                                               */
  /* ------------------------------------------------------------------ */

  class Engine {
    /**
     * @param {object} state Spielzustand (siehe Engine.create)
     * @param {{onChange?, onKick?, now?, random?, timers?: boolean, used?, onDraw?}} hooks
     *   timers: false schaltet die Uhren ab (Tests rufen tick() selbst auf)
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

    /** Neues Spiel. Handys: Lobby. Ein Gerät: { players: ['Anna', …] } – das Spiel startet sofort. */
    static create(config, hooks) {
      const settings = sanitizeSettings(config.settings);
      if (pool(settings).length < MIN_POOL) throw new Error('Zu wenige Songs – bitte mehr Jahrzehnte oder Kategorien wählen');
      const state = {
        v: 1,
        game: GAME,
        settings,
        phase: 'lobby',
        members: {},
        order: [],
        teams: [],
        stats: {},
        no: 0,
        cur: null,
        next: null,
        last: null,
        hummers: [],
        humAt: 0,
        tiebreak: null,
        tiebreaks: 0,
        reason: null,
        used: [],
        log: [],
        startedAt: null,
      };
      if (settings.input === 'one') {
        const names = (config.players || []).map((n) => cleanName(n)).filter(Boolean).slice(0, MAX_PLAYERS);
        const min = settings.mode === 'snip' ? MIN_PLAYERS : HUM_MIN_PLAYERS;
        if (names.length < min) throw new Error(`Mindestens ${min} Namen`);
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

    get pool() {
      if (!this._pool) this._pool = pool(this.s.settings);
      return this._pool;
    }

    /** Tippen am Handy? (sonst Buzzer bzw. ein Gerät) */
    get typing() {
      return this.write && this.s.settings.guess === 'type';
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

    stat(pid) {
      if (!this.s.stats[pid]) this.s.stats[pid] = newStats();
      return this.s.stats[pid];
    }

    playing() {
      return this.s.order.filter((pid) => this.isOnline(pid) && !this.s.members[pid].watch);
    }

    /** Spielleitung am Handy: das am längsten verbundene Handy */
    leadPid() {
      if (!this.write) return null;
      let top = null;
      for (const pid of this.s.order) {
        const m = this.s.members[pid];
        if (m && m.online && !m.watch && (!top || (m.joined || 0) < top.joined)) top = { pid, joined: m.joined || 0 };
      }
      return top ? top.pid : null;
    }

    /** Darf diese Person den Ablauf steuern? (Laptop oder Spielleitung am Handy) */
    leads(actor) {
      return actor === STAGE || (!!actor && actor === this.leadPid());
    }

    /** Darf diese Person einen Buzz bewerten? Ausschnitt: Laptop/Spielleitung (nicht fürs eigene Team) · Summen: Laptop/Summer/in */
    judges(actor) {
      const cur = this.s.cur;
      if (!cur || !cur.buzz) return false;
      if (actor === STAGE) return true;
      if (cur.kind === 'hum') return actor === cur.hummer;
      return this.leads(actor) && this.teamOf(actor) !== cur.buzz.team;
    }

    /** Welche Art Song ist Nummer n? */
    kindFor(n) {
      const s = this.s;
      const mode = s.settings.mode;
      let kind = mode === 'mixed' ? (n % 2 === 1 ? 'snip' : 'hum') : mode;
      if (s.tiebreak && n > s.settings.count) kind = mode === 'hum' ? 'hum' : 'snip';
      if (kind === 'hum' && this.playing().length < HUM_MIN_PLAYERS) kind = 'snip';
      return kind;
    }

    /** Darf dieses Team beim laufenden Song raten? */
    teamMayGuess(ti) {
      const s = this.s;
      const cur = s.cur;
      const t = s.teams[ti];
      if (!t || !cur) return false;
      if (s.tiebreak && !s.tiebreak.includes(ti)) return false;
      return t.members.some((pid) => pid !== cur.hummer && this.isOnline(pid));
    }

    eligible() {
      return this.s.teams.map((_, i) => i).filter((i) => this.teamMayGuess(i));
    }

    /** Kann diese Person gerade raten? (eigenes Team noch nicht fertig, nicht die Summer/in) */
    mayGuess(pid) {
      const s = this.s;
      const cur = s.cur;
      if (!cur || pid === STAGE || pid === cur.hummer || !cur.song) return false;
      const ti = this.teamOf(pid);
      if (ti === null || !this.teamMayGuess(ti)) return false;
      return !cur.res[ti].done;
    }

    allDone() {
      const cur = this.s.cur;
      return this.eligible().every((i) => cur.res[i].done);
    }

    /* ---------- Songs ---------- */

    taken() {
      const s = this.s;
      const ids = new Set(s.used);
      if (s.cur && s.cur.song) ids.add(s.cur.song.id);
      if (s.next) ids.add(s.next.id);
      return ids;
    }

    evening() {
      const h = this.hooks.used !== undefined ? this.hooks : Engine.evening || {};
      return { used: typeof h.used === 'function' ? h.used() : h.used, onDraw: this.hooks.onDraw || (Engine.evening || {}).onDraw };
    }

    /** Ein Song, der in diesem Spiel (und möglichst an diesem Abend) noch nicht dran war – null = keine mehr */
    drawFree(extra, mark) {
      const S = Songs();
      const taken = Array.from(this.taken()).concat(extra || []);
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
      if (mark) {
        this.s.used.push(c.id);
        if (ev.onDraw) ev.onDraw(c, reset);
      }
      return c;
    }

    drawSong() {
      return this.drawFree(null, true);
    }

    /** Merkt einen Song (Summen: ausgesucht) als gespielt */
    markUsed(song) {
      const ev = this.evening();
      if (!this.s.used.includes(song.id)) this.s.used.push(song.id);
      if (ev.onDraw) ev.onDraw(song, false);
    }

    /** 3 Songs zum Summen (ohne die schon gezeigten) */
    drawOptions(seen) {
      const out = [];
      for (let i = 0; i < HUM_OPTIONS; i++) {
        const song = this.drawFree(seen.concat(out.map((x) => x.id)), false);
        if (!song) break;
        out.push(song);
      }
      return out;
    }

    newCur(kind, song, hummer) {
      const s = this.s;
      const now = this.now();
      return {
        kind,
        song: song || null,
        hummer: hummer || null,
        options: null,
        seen: [],
        rerolls: 0,
        offset: kind === 'snip' && s.settings.start === 'random' ? Math.floor(this.random() * (MAX_OFFSET + 1)) : 0,
        step: 0,
        playId: 1,
        heard: false,
        deadline: null,
        left: null,
        stepAt: now,
        startedAt: now,
        res: s.teams.map(() => ({ tries: 0, points: 0, partial: 0, bonus: 0, done: false, out: false, hit: null })),
        hits: [],
        buzz: null,
        shown: false,
        first: null,
        fb: {},
        replays: 0,
      };
    }

    lastStep() {
      return (STEP_SETS[this.s.settings.steps] || STEP_SETS.classic).secs.length - 1;
    }

    /* ---------- Verbindungen (Handys) ---------- */

    connect(pid, name) {
      const s = this.s;
      const m = s.members[pid];
      if (m) {
        m.online = true;
        delete m.offlineAt;
        if (name) m.name = cleanName(name, m.name);
      } else if (s.phase !== 'lobby' || s.order.length >= this.maxMembers()) {
        // zu spät oder voll: schaut zu
        s.members[pid] = { name: cleanName(name, 'Gast'), online: true, joined: this.now(), watch: true };
      } else {
        s.members[pid] = { name: cleanName(name, 'Gast'), online: true, joined: this.now() };
        s.order.push(pid);
        this.autoTeam(pid);
      }
      // Ohne Teams heißt die Wertung wie die Person
      const ti = this.teamOf(pid);
      if (ti !== null && !s.settings.teams) s.teams[ti].name = s.members[pid].name;
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
      // Wer noch raten könnte, ist vielleicht weg – dann gleich auflösen
      if (this.s.phase === 'play' && this.s.cur && this.s.cur.song && this.typing && this.allDone()) this.reveal();
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
      const counts = Array.from({ length: s.settings.teams }, (_, i) => s.order.filter((p) => s.members[p].team === i && !s.members[p].watch).length);
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

    buildTeams() {
      const s = this.s;
      const playing = this.playing();
      const team = (name, color, members) => ({ id: 't' + (s.teams.length + 1), name, color, members, points: 0 });
      s.teams = [];
      if (s.settings.teams) {
        for (let i = 0; i < s.settings.teams; i++) {
          const members = playing.filter((pid) => s.members[pid].team === i);
          if (members.length) s.teams.push(team(TEAMS[i].name, TEAMS[i].color, members));
        }
      } else {
        playing.forEach((pid, i) => s.teams.push(team(s.members[pid].name, COLORS[i % COLORS.length], [pid])));
      }
      // Summen reihum, mit Teams abwechselnd aus jedem Team
      const lists = s.teams.map((t) => t.members.slice());
      s.hummers = [];
      while (lists.some((l) => l.length)) for (const l of lists) if (l.length) s.hummers.push(l.shift());
      s.humAt = 0;
    }

    lobbyProblem() {
      const s = this.s;
      const playing = this.playing();
      const min = s.settings.mode === 'snip' ? MIN_PLAYERS : HUM_MIN_PLAYERS;
      if (playing.length < min) return `Ihr braucht mindestens ${min} Personen${min > MIN_PLAYERS ? ' zum Summen' : ''} – scannt den QR-Code!`;
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
      s.stats = {};
      for (const t of s.teams) for (const pid of t.members) s.stats[pid] = newStats();
      s.no = 0;
      s.cur = null;
      s.next = null;
      s.last = null;
      s.tiebreak = null;
      s.tiebreaks = 0;
      s.reason = null;
      s.log = [];
      s.used = [];
      s.startedAt = this.now();
      if (!this.startSong()) this.finish('empty');
    }

    /** Nächster Song (Ausschnitt oder Summen) */
    startSong() {
      const s = this.s;
      s.no++;
      s.last = null;
      const ok = (this.kindFor(s.no) === 'hum' && this.startHum()) || this.startSnip();
      if (ok && !s.next && this.kindFor(s.no + 1) === 'snip') s.next = this.drawSong();
      return ok;
    }

    startSnip() {
      const s = this.s;
      const song = s.next || this.drawSong();
      s.next = null;
      if (!song) return false;
      s.cur = this.newCur('snip', song);
      s.phase = 'play';
      return true;
    }

    /** Nächste Person, die summt (online; im Stechen nicht aus einem punktgleichen Team) */
    nextHummer() {
      const s = this.s;
      const n = s.hummers.length;
      for (let k = 0; k < n; k++) {
        const pid = s.hummers[(s.humAt + k) % n];
        const ti = this.teamOf(pid);
        if (!this.isOnline(pid) || ti === null) continue;
        if (s.tiebreak && s.tiebreak.includes(ti)) continue;
        // ohne Teams: es müssen noch andere online sein, die raten
        s.humAt = (s.humAt + k + 1) % n;
        return pid;
      }
      return null;
    }

    startHum(hummer) {
      const s = this.s;
      const pid = hummer || this.nextHummer();
      if (!pid) return false;
      const options = this.drawOptions([]);
      if (!options.length) return false;
      s.cur = this.newCur('hum', null, pid);
      s.cur.options = options;
      s.cur.seen = options.map((x) => x.id);
      s.phase = 'pick';
      return true;
    }

    /** Ausschnitt: nächste Stufe – oder auflösen, wenn es die letzte war */
    advanceStep() {
      const cur = this.s.cur;
      if (cur.step >= this.lastStep()) return this.reveal();
      cur.step++;
      cur.playId++;
      cur.heard = false;
      cur.deadline = null;
      cur.stepAt = this.now();
      return true;
    }

    /** Treffer verbuchen (Punkte zählen erst bei der Auflösung) */
    hit(ti, pid, points, at) {
      const cur = this.s.cur;
      const r = cur.res[ti];
      r.points = Math.max(r.points, points);
      r.done = true;
      r.hit = at ? { step: at.step, by: pid || null, ms: at.ms } : { step: cur.step, by: pid || null, ms: Math.max(0, this.now() - cur.stepAt) };
      if (cur.kind === 'snip' && cur.first === null) {
        cur.first = ti;
        r.bonus = FIRST_BONUS;
      }
      cur.hits.push(ti);
    }

    /** Falsch geraten: Statistik und Versuche */
    miss(ti, pid, buzz) {
      const r = this.s.cur.res[ti];
      if (pid) this.stat(pid).wrong++;
      if (buzz) {
        r.out = true;
        r.done = true;
        return;
      }
      r.tries++;
      if (r.tries >= MAX_TRIES) {
        r.out = true;
        r.done = true;
      }
    }

    /** Nach einem Buzz weiterspielen (oder auflösen, wenn niemand mehr darf) */
    resume() {
      const s = this.s;
      const cur = s.cur;
      cur.buzz = null;
      if (cur.shown || this.allDone()) return this.reveal();
      s.phase = 'play';
      if (cur.kind === 'snip' && !cur.heard) {
        // die Stufe war noch nicht zu Ende – nochmal von vorn
        cur.playId++;
        cur.deadline = null;
      } else cur.deadline = this.now() + Math.max(RESUME_MIN_MS, cur.left || 0);
      cur.left = null;
      return true;
    }

    /** Auflösen: Punkte verbuchen, Statistik, Trinkregeln */
    reveal() {
      const s = this.s;
      const cur = s.cur;
      if (!cur || !cur.song) return false;
      const hum = cur.kind === 'hum';
      const results = cur.res.map((r, ti) => ({
        team: ti,
        points: r.points,
        bonus: r.bonus,
        partial: r.partial > 0 && !r.hit,
        hit: r.hit ? clone(r.hit) : null,
        out: r.out,
        tries: r.tries,
        played: this.teamMayGuess(ti),
      }));
      let hummerPoints = 0;
      let hummerTeam = null;
      if (hum) {
        hummerTeam = this.teamOf(cur.hummer);
        const st = this.stat(cur.hummer);
        st.hummed++;
        if (cur.hits.length) {
          st.humHits++;
          hummerPoints = HUM_HUMMER;
        }
      }
      results.forEach((x) => {
        const t = s.teams[x.team];
        t.points += x.points + x.bonus + (x.team === hummerTeam ? hummerPoints : 0);
        if (x.hit && x.hit.by) {
          const st = this.stat(x.hit.by);
          st.hits++;
          if (!hum) {
            const f = st.fast;
            if (!f || x.hit.step < f.step || (x.hit.step === f.step && x.hit.ms < f.ms)) st.fast = { step: x.hit.step, ms: x.hit.ms, secs: stepSecs(s.settings.steps, cur.offset)[x.hit.step], title: cur.song.title };
          }
        }
      });
      const nobody = !results.some((x) => x.points > 0);
      const sips = { all: 0, give: [] };
      if (s.settings.drinks) {
        if (nobody) sips.all = SIPS_NOBODY;
        else if (!hum) sips.give = results.filter((x) => x.hit && x.hit.step === 0).map((x) => x.team);
      }
      s.last = { no: s.no, kind: cur.kind, song: card(cur.song), hummer: cur.hummer, hummerTeam, hummerPoints, results, nobody, sips, tiebreak: !!s.tiebreak, secs: stepSecs(s.settings.steps, cur.offset) };
      s.log.push({
        no: s.no,
        kind: cur.kind,
        song: card(cur.song),
        hummer: cur.hummer,
        tiebreak: !!s.tiebreak,
        results: results.filter((x) => x.points > 0).map((x) => ({ team: x.team, points: x.points + x.bonus, step: x.hit ? x.hit.step : null, by: x.hit ? x.hit.by : null, partial: x.partial })),
      });
      cur.deadline = null;
      cur.buzz = null;
      s.phase = 'reveal';
      return true;
    }

    /** Punktgleiche an der Spitze (Indizes) – nur, wenn es mehr als eine Wertung gibt */
    tiedTop() {
      const teams = this.s.teams;
      if (teams.length < 2) return [];
      const top = Math.max(...teams.map((t) => t.points));
      const tied = teams.map((t, i) => (t.points === top ? i : -1)).filter((i) => i >= 0);
      return tied.length > 1 ? tied : [];
    }

    /** Kommt nach diesem Song noch einer (oder ein Stechen)? */
    willEnd() {
      const s = this.s;
      if (s.phase !== 'reveal') return false;
      if (!s.tiebreak && s.no < s.settings.count) return false;
      return !(this.tiedTop().length && s.tiebreaks < MAX_TIEBREAKS);
    }

    finish(reason) {
      const s = this.s;
      s.phase = 'end';
      s.reason = reason;
      if (s.cur) {
        s.cur.deadline = null;
        s.cur.buzz = null;
      }
      return true;
    }

    /** Weiter nach der Auflösung: nächster Song, Stechen oder Siegerehrung */
    next() {
      const s = this.s;
      if (s.phase !== 'reveal') return false;
      if (s.tiebreak || s.no >= s.settings.count) {
        const tied = this.tiedTop();
        if (tied.length && s.tiebreaks < MAX_TIEBREAKS) {
          s.tiebreak = tied;
          s.tiebreaks++;
          if (this.startSong()) return true;
        }
        return this.finish('done');
      }
      if (!this.startSong()) return this.finish('empty');
      return true;
    }

    /* ---------- Zeit ---------- */

    armTimer() {
      clearTimeout(this.timer);
      this.timer = null;
      if (this.hooks.timers === false) return;
      const end = this.s.phase === 'play' && this.s.cur ? this.s.cur.deadline : null;
      if (!end) return;
      this.timer = setTimeout(
        () => {
          if (this.tick()) this.changed();
          else this.armTimer();
        },
        Math.max(0, end - this.now()) + 30
      );
    }

    /** Abgelaufene Ratezeit auswerten. true = hat sich etwas geändert */
    tick() {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'play' || !cur || !cur.deadline || cur.deadline > this.now()) return false;
      if (cur.kind === 'snip') return this.advanceStep();
      return this.reveal();
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
      // mitten im Spiel: Person verlässt ihr Team, die Punkte bleiben
      for (const t of s.teams) t.members = t.members.filter((p) => p !== pid);
      const at = s.hummers.indexOf(pid);
      if (at >= 0) {
        s.hummers.splice(at, 1);
        if (s.humAt > at) s.humAt--;
        if (s.humAt >= s.hummers.length) s.humAt = 0;
      }
      const cur = s.cur;
      if (cur && cur.hummer === pid && (s.phase === 'pick' || s.phase === 'play' || s.phase === 'buzzed')) {
        // Summer/in ist weg: Song ohne Wertung abbrechen, nächste Person summt
        s.no--;
        if (!this.startSong()) this.finish('empty');
      } else if (cur && cur.buzz && cur.buzz.pid === pid) this.resume();
      else if (s.phase === 'play' && cur && cur.song && this.typing && this.allDone()) this.reveal();
      return true;
    }

    on_start(a, actor) {
      if (actor !== STAGE || this.s.phase !== 'lobby' || this.lobbyProblem()) return false;
      this.startGame();
      return true;
    }

    /* Ausschnitt */

    /** Bühne: Stufe ist zu Ende gespielt → Ratezeit läuft */
    on_heard(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (actor !== STAGE || s.phase !== 'play' || !cur || cur.kind !== 'snip' || cur.heard) return false;
      if (a.playId !== undefined && Number(a.playId) !== cur.playId) return false;
      cur.heard = true;
      cur.deadline = this.now() + GUESS_MS;
      return true;
    }

    /** Nochmal hören (gleiche Stufe) */
    on_replay(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!this.leads(actor) || s.phase !== 'play' || !cur || cur.kind !== 'snip') return false;
      cur.playId++;
      cur.heard = false;
      cur.deadline = null;
      cur.replays++;
      return true;
    }

    /** Nächste Stufe sofort */
    on_step(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!this.leads(actor) || s.phase !== 'play' || !cur || cur.kind !== 'snip') return false;
      if (a.step !== undefined && Number(a.step) !== cur.step) return false;
      return this.advanceStep();
    }

    /** Kein Ausschnitt zu finden → anderer Song, ohne Folgen (Laptop) */
    on_replace(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (actor !== STAGE || s.phase !== 'play' || !cur || cur.kind !== 'snip') return false;
      if (a.id && a.id !== cur.song.id) return false;
      const song = s.next || this.drawSong();
      s.next = null;
      if (!song) return this.finish('empty');
      s.cur = this.newCur('snip', song);
      if (this.kindFor(s.no + 1) === 'snip') s.next = this.drawSong();
      return true;
    }

    /** Nicht spielbar (z. B. kein Internet) → nächster Song wird vorgeladen, ohne den aktuellen zu ändern */
    on_skipnext(a, actor) {
      const s = this.s;
      if (actor !== STAGE || !s.next || (a.id && a.id !== s.next.id)) return false;
      s.next = this.drawSong();
      return true;
    }

    /* Summen */

    /** Summer/in sucht sich einen Song aus (ein Gerät: am Laptop) */
    on_pick(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'pick' || !cur || !(actor === cur.hummer || (actor === STAGE && !this.write))) return false;
      const song = (cur.options || []).find((x) => x.id === a.id);
      if (!song) return false;
      cur.song = clone(song);
      cur.options = null;
      this.markUsed(song);
      if (s.next && s.next.id === song.id) s.next = this.drawSong();
      s.phase = 'play';
      cur.startedAt = cur.stepAt = this.now();
      cur.deadline = this.now() + HUM_MS;
      return true;
    }

    /** „Kenn ich nicht“: drei andere */
    on_reroll(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'pick' || !cur || !(actor === cur.hummer || (actor === STAGE && !this.write))) return false;
      const options = this.drawOptions(cur.seen);
      if (!options.length) return false;
      cur.options = options;
      cur.seen = cur.seen.concat(options.map((x) => x.id));
      cur.rerolls++;
      return true;
    }

    /** Laptop: jemand anderes summt (z. B. Summer/in ist weg) */
    on_skiphum(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'pick') return false;
      const pid = this.nextHummer();
      if (!pid || pid === s.cur.hummer) return false;
      return this.startHum(pid);
    }

    /* Raten */

    /** Tippen am Handy: Titel oder Interpret */
    on_guess(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'play' || !this.typing || !this.mayGuess(actor)) return false;
      const text = cleanGuess(a.text);
      if (!text) return false;
      const ti = this.teamOf(actor);
      const r = cur.res[ti];
      const hum = cur.kind === 'hum';
      const artistMode = hum ? 'none' : s.settings.artist;
      let result = judgeGuess(text, cur.song, true);
      // Interpret zählt nicht (Einstellung bzw. Summen): kostet aber auch nichts
      if (result === 'artist' && (artistMode === 'none' || r.partial)) result = 'artist-only';
      const points = hum ? (cur.hits.length ? HUM_MORE : HUM_FIRST) : stepPoints(s.settings.steps, cur.step);
      if (result === 'title') this.hit(ti, actor, points);
      else if (result === 'artist') {
        const p = artistPoints(artistMode, points);
        if (artistMode === 'full') this.hit(ti, actor, p);
        else {
          r.partial = p;
          r.points = Math.max(r.points, p);
        }
      } else if (result === 'no') this.miss(ti, actor, false);
      cur.fb[actor] = { text, result, points: result === 'title' ? points : result === 'artist' ? artistPoints(artistMode, points) : 0, at: this.now() };
      if (this.allDone()) this.reveal();
      return true;
    }

    /** Buzzer (Handy) – oder am Laptop für ein Team ({ team }) */
    on_buzz(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'play' || !cur || !cur.song) return false;
      let ti;
      let pid;
      if (actor === STAGE) {
        if (this.write) return false;
        ti = Number(a.team);
        const t = s.teams[ti];
        if (!t) return false;
        pid = t.members.find((p) => p !== cur.hummer) || null;
        if (!pid || !this.mayGuess(pid)) return false;
      } else {
        if (this.typing || !this.mayGuess(actor)) return false;
        ti = this.teamOf(actor);
        pid = actor;
      }
      cur.buzz = { team: ti, pid, step: cur.step, at: this.now(), ms: Math.max(0, this.now() - cur.stepAt) };
      cur.left = cur.deadline ? Math.max(0, cur.deadline - this.now()) : null;
      cur.deadline = null;
      s.phase = 'buzzed';
      return true;
    }

    /** Lösung am Laptop aufdecken (Ausschnitt, während jemand gebuzzert hat) – danach ist der Song für alle vorbei */
    on_show(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'buzzed' || !cur || cur.kind !== 'snip' || cur.shown || !this.judges(actor)) return false;
      cur.shown = true;
      return true;
    }

    /** Buzz bewerten: { ok: 'title' | 'artist' | 'wrong' } */
    on_judge(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'buzzed' || !cur || !cur.buzz || !this.judges(actor)) return false;
      const { team: ti, pid, step } = cur.buzz;
      const r = cur.res[ti];
      const hum = cur.kind === 'hum';
      const artistMode = hum ? 'none' : s.settings.artist;
      const ok = a.ok === true ? 'title' : a.ok;
      if (!['title', 'artist', 'wrong'].includes(ok) || (ok === 'artist' && artistMode === 'none')) return false;
      const points = hum ? HUM_FIRST : stepPoints(s.settings.steps, step);
      if (ok === 'title' || (ok === 'artist' && artistMode === 'full')) {
        this.hit(ti, pid, ok === 'title' ? points : artistPoints(artistMode, points), cur.buzz);
        // laut gesagt – alle haben es gehört
        return this.reveal();
      }
      if (ok === 'artist') {
        r.partial = artistPoints(artistMode, points);
        r.points = Math.max(r.points, r.partial);
        r.done = true;
      } else this.miss(ti, pid, true);
      return this.resume();
    }

    /** Auflösen / niemand weiß es (Spielleitung, beim Summen auch die Summer/in) */
    on_resolve(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!cur || !cur.song || !['play', 'buzzed'].includes(s.phase)) return false;
      if (!(this.leads(actor) || (cur.kind === 'hum' && actor === cur.hummer))) return false;
      return this.reveal();
    }

    on_next(a, actor) {
      if (!this.leads(actor)) return false;
      if (a.no !== undefined && Number(a.no) !== this.s.no) return false;
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
      s.cur = null;
      s.next = null;
      for (const pid of Object.keys(s.members)) {
        const m = s.members[pid];
        if (m.watch && s.order.filter((p) => !s.members[p].watch).length < this.maxMembers()) {
          m.watch = false;
          if (!s.order.includes(pid)) s.order.push(pid);
          this.autoTeam(pid);
        }
      }
      return true;
    }

    /* ---------- Auswertung ---------- */

    /** Rangliste nach Punkten – Gleichstand teilt den Platz */
    ranking() {
      const s = this.s;
      const rows = s.teams.map((t, i) => {
        const hits = s.log.filter((x) => x.results.some((r) => r.team === i && r.step !== null && !r.partial)).length;
        return { i, name: t.name, color: t.color, points: t.points, hits };
      });
      rows.sort((a, b) => b.points - a.points || a.i - b.i);
      rows.forEach((r, k) => {
        r.place = k > 0 && rows[k - 1].points === r.points ? rows[k - 1].place : k + 1;
      });
      return rows;
    }

    winners() {
      return this.ranking().filter((r) => r.place === 1);
    }

    /**
     * Auszeichnungen: ⚡ Eine Sekunde reicht (schnellster Treffer) · 🎤 Summ-Star (meiste erratene Summ-Songs) ·
     * 🙉 Taub (meiste falsche Versuche) – [{ id, icon, label, text, pids, value }]
     */
    awards() {
      const s = this.s;
      const out = [];
      const pids = Object.keys(s.stats).filter((p) => s.members[p]);
      const fast = pids.filter((p) => s.stats[p].fast).sort((a, b) => s.stats[a].fast.step - s.stats[b].fast.step || s.stats[a].fast.ms - s.stats[b].fast.ms)[0];
      if (fast) {
        const f = s.stats[fast].fast;
        out.push({ id: 'fast', icon: '⚡', label: f.step === 0 ? 'Eine Sekunde reicht' : 'Blitzmerker', text: `„${f.title}“ nach ${f.secs} ${f.secs === 1 ? 'Sekunde' : 'Sekunden'}`, pids: [fast], value: f.secs });
      }
      const most = (key, min) => {
        const max = Math.max(0, ...pids.map((p) => s.stats[p][key]));
        return max >= min ? { value: max, pids: pids.filter((p) => s.stats[p][key] === max) } : null;
      };
      const star = most('humHits', 1);
      if (star) out.push(Object.assign({ id: 'hum', icon: '🎤', label: 'Summ-Star', text: `${star.value} ${star.value === 1 ? 'Song' : 'Songs'} erraten lassen` }, star));
      const deaf = most('wrong', 2);
      if (deaf) out.push(Object.assign({ id: 'deaf', icon: '🙉', label: 'Taub', text: `${deaf.value} falsche Versuche` }, deaf));
      return out;
    }

    /* ---------- Ansicht ---------- */

    /** Stand eines Teams beim laufenden Song (verrät nichts über den Titel) */
    resView(ti) {
      const s = this.s;
      const cur = s.cur;
      const r = cur && cur.res[ti];
      if (!r) return null;
      return {
        done: r.done,
        out: r.out,
        tries: r.tries,
        partial: r.partial > 0 && !r.hit,
        hit: r.hit ? { step: r.hit.step, by: r.hit.by, name: r.hit.by ? this.memberName(r.hit.by) : null } : null,
        points: r.points + r.bonus,
        first: cur.first === ti,
        may: this.teamMayGuess(ti),
      };
    }

    viewFor(viewer) {
      const s = this.s;
      const stage = viewer === STAGE;
      const cur = s.cur;
      const open = s.phase === 'reveal' || s.phase === 'end';
      const active = ['pick', 'play', 'buzzed', 'reveal'].includes(s.phase) && cur;
      const myTeam = stage ? null : this.teamOf(viewer);
      const hummer = cur && cur.hummer;
      const isHummer = !stage && viewer === hummer;
      // Wer darf den Song schon kennen?
      const knows = cur && cur.song && (open || isHummer || (stage && (cur.kind === 'snip' || !this.write)));
      let curView = null;
      if (active) {
        const snip = cur.kind === 'snip';
        const secs = snip ? stepSecs(s.settings.steps, cur.offset) : null;
        const last = snip && cur.step === secs.length - 1;
        curView = {
          kind: cur.kind,
          step: cur.step,
          steps: secs,
          points: snip ? stepPoints(s.settings.steps, cur.step) : cur.hits.length ? HUM_MORE : HUM_FIRST,
          stepPoints: snip ? STEP_SETS[s.settings.steps].points.slice() : null,
          playId: cur.playId,
          heard: cur.heard,
          offset: stage && snip ? cur.offset : null,
          // Restzeit statt Uhrzeit – die Uhren der Handys gehen nicht genau gleich
          left: cur.deadline ? Math.max(0, cur.deadline - this.now()) : null,
          total: snip ? GUESS_MS : HUM_MS,
          paused: s.phase === 'buzzed' ? cur.left : null,
          hint: last && cur.song && s.phase !== 'reveal' ? hintFor(cur.song) : null,
          hummer,
          hummerName: hummer ? this.memberName(hummer) : null,
          hummerTeam: hummer ? this.teamOf(hummer) : null,
          options: s.phase === 'pick' && (isHummer || (stage && !this.write)) ? clone(cur.options) : null,
          rerolls: cur.rerolls,
          song: knows ? (stage && !open ? current(cur.song) : card(cur.song)) : null,
          buzz: cur.buzz ? { team: cur.buzz.team, pid: cur.buzz.pid, name: this.memberName(cur.buzz.pid), step: cur.buzz.step } : null,
          shown: cur.shown,
          // Die Lösung zum Aufdecken bekommt nur die Bühne (beim Buzz) – sie hat den Song ohnehin
          res: s.teams.map((_, i) => this.resView(i)),
          hits: cur.hits.length,
          eligible: this.eligible(),
        };
      }
      const fb = cur && !stage && cur.fb[viewer] ? clone(cur.fb[viewer]) : null;
      return {
        game: GAME,
        phase: s.phase,
        settings: clone(s.settings),
        members: s.order
          .concat(Object.keys(s.members).filter((p) => !s.order.includes(p)))
          .map((id) => {
            const m = s.members[id];
            return { id, name: m.name, online: this.isOnline(id), team: m.team === undefined ? null : m.team, watch: !!m.watch, local: !!m.local };
          }),
        teams: s.teams.map((t) => ({
          id: t.id,
          name: t.name,
          color: t.color,
          members: t.members.map((pid) => ({ id: pid, name: this.memberName(pid), online: this.isOnline(pid) })),
          points: t.points,
        })),
        no: s.no,
        count: s.settings.count,
        tiebreak: s.tiebreak ? s.tiebreak.slice() : null,
        cur: curView,
        nextSong: stage && s.next ? card(s.next) : null,
        last: s.last && s.phase === 'reveal' ? clone(s.last) : null,
        willEnd: this.willEnd(),
        willTie: s.phase === 'reveal' && !this.willEnd() && (s.tiebreak || s.no >= s.settings.count),
        reason: s.reason,
        log: s.phase === 'end' ? clone(s.log) : null,
        ranking: s.phase === 'end' ? this.ranking() : null,
        awards: s.phase === 'end' ? this.awards() : null,
        stats: s.phase === 'end' ? clone(s.stats) : null,
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
              hummer: isHummer,
              judge: s.phase === 'buzzed' && this.judges(viewer),
              canGuess: ['play'].includes(s.phase) && this.mayGuess(viewer),
              fb,
            },
      };
    }
  }

  /** Songs des Abends – setzt die Oberfläche (der StageController reicht keine eigenen Hooks durch) */
  Engine.evening = null;

  root.GTSEngine = {
    Engine,
    GAME,
    STAGE,
    INPUTS,
    MODES,
    GUESSES,
    COUNTS,
    STEP_SETS,
    STEP_IDS,
    ARTISTS,
    STARTS,
    HUMS,
    TEAM_COUNTS,
    TEAMS,
    COLORS,
    SNIPPET_SECS,
    MAX_OFFSET,
    GUESS_MS,
    RESUME_MIN_MS,
    HUM_MS,
    MAX_TRIES,
    FIRST_BONUS,
    HUM_FIRST,
    HUM_MORE,
    HUM_HUMMER,
    HUM_OPTIONS,
    SIPS_NOBODY,
    SIPS_GIVE,
    MAX_TIEBREAKS,
    MIN_PLAYERS,
    HUM_MIN_PLAYERS,
    MAX_PLAYERS,
    MAX_MEMBERS,
    MAX_NAME,
    MIN_POOL,
    DEFAULT_SETTINGS,
    sanitizeSettings,
    cleanName,
    pool,
    card,
    stepPoints,
    stepSecs,
    artistPoints,
    judgeGuess,
    hintFor,
  };
})(typeof window !== 'undefined' ? window : globalThis);
