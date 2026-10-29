/*
 * Spiellogik von „Finish the lyrics“.
 *
 * Songtexte stehen nirgends im Spiel – weder im Repo noch in der Ansicht. Die Runde hört bzw. singt selbst und
 * bewertet, ob die Fortsetzung stimmte (siehe planung/finish-the-lyrics.md).
 *
 * Zwei Spielweisen (settings.mode):
 *  - 🔊 Audio stoppt (audio): Der Laptop spielt einen 30-s-Ausschnitt (iTunes) und stoppt an einer Stoppstelle
 *    (js/stops.js, sonst zufällig 8–20 s). Wer dran ist, singt weiter (10/15/20 s). Dann läuft der Ausschnitt ab der
 *    Stelle weiter – alle hören, ob es stimmte – und die anderen stimmen ab: 👍 richtig · 🤏 fast · 👎 falsch
 *    → 3 / 1 / 0 Punkte. Mehrheit entscheidet, Gleichstand = 🤏. Die Spielleitung kann überstimmen
 *    (nicht fürs eigene Team).
 *    Variante „alle gleichzeitig“ (answer 'all'): Alle tippen die Fortsetzung am Handy, danach sehen alle die
 *    Antworten (ohne Namen) und vergeben 👍. Mehr als die Hälfte 👍 → richtig (3), mindestens ein 👍 → fast (1).
 *  - 🎙️ Ansingen (sing): Reihum sucht sich eine Person einen von 3 Songs aus und singt den Anfang einer Zeile an.
 *    Wer weitersingen kann, drückt ✋, singt laut weiter, die Ansänger/in bestätigt ✅/❌. Treffer 2 Punkte, die
 *    Ansänger/in bekommt 1, wenn es jemand wusste. Falsch → für diesen Song raus.
 *
 * Wer antwortet (settings.answer): reihum einzeln (turns) · Teams abwechselnd (teams) · alle gleichzeitig (all, nur Audio).
 * Wertungen gehören „Teams“: ohne Teams hat jede Person ihr eigenes (Team aus einer Person).
 * Damit alle gleich oft dran sind, wird die Anzahl Songs auf volle Runden aufgerundet (total).
 * Ein Gerät (settings.input 'one'): reihum, die Runde entscheidet am Laptop; beim Ansingen schaut die Ansänger/in
 * kurz allein auf den Laptop, angetippt wird, wer zuerst weitergesungen hat.
 *
 * Phasen Audio:    lobby → play (Ausschnitt läuft bis zur Stelle) → sing (weitersingen / tippen)
 *                  → vote (Ausschnitt läuft weiter, Abstimmung) → reveal → … → end
 * Phasen Ansingen: lobby → pick (Song aussuchen) → play (ansingen, ✋) → buzzed → reveal → … → end
 *
 * Gefilterte Ansicht: Beim Ansingen kennt nur die Ansänger/in den Song vor der Auflösung (ein Gerät: die Bühne für
 * „nur für dich“). Bei „alle gleichzeitig“ stehen die Antworten vor der Auflösung ohne Namen da.
 */
(function (root) {
  'use strict';

  const GAME = 'finish-the-lyrics';
  const STAGE = 'stage';
  const INPUTS = ['phones', 'one'];
  const MODES = ['audio', 'sing'];
  const ANSWERS = ['turns', 'teams', 'all'];
  const COUNTS = [10, 15, 20];
  const TIMES = [10, 15, 20];
  const TEAM_COUNTS = [2, 3, 4];
  const VERDICTS = ['yes', 'close', 'no'];
  const POINTS = { yes: 3, close: 1, no: 0 };
  const SING_HIT = 2;
  const SING_SINGER = 1;
  const SING_MS = 45000; // so lange darf beim Ansingen weitergesungen werden
  const TYPE_EXTRA_MS = 10000; // „alle gleichzeitig“: Tippen dauert länger als Singen
  const RESUME_MIN_MS = 5000; // nach einem falschen ✋ bleibt mindestens so viel Zeit
  const SING_OPTIONS = 3;
  const SIPS_WRONG = 1;
  const SIPS_GIVE = 2;
  const STREAK = 3;
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 12; // eigene Wertungen
  const MAX_MEMBERS = 16; // Handys mit Teams
  const MAX_NAME = 20;
  const MAX_ANSWER = 120;
  const MIN_POOL = 40;
  const TEAMS = [
    { name: 'Team Blau', color: '#60a5fa' },
    { name: 'Team Orange', color: '#fb923c' },
    { name: 'Team Grün', color: '#4ade80' },
    { name: 'Team Pink', color: '#f472b6' },
  ];
  const COLORS = ['#f472b6', '#38bdf8', '#facc15', '#a78bfa', '#fb923c', '#4ade80', '#f87171', '#2dd4bf', '#e879f9', '#a3e635', '#60a5fa', '#fda4af'];
  const DEFAULT_SETTINGS = {
    input: 'phones',
    mode: 'audio',
    answer: 'teams',
    teams: 2,
    count: 15,
    time: 10,
    // die kennt man am besten (Plan): Deutsch + Schlager & Party
    cats: ['deutsch', 'schlager-party'],
    decades: [],
    level: 'mixed',
    drinks: false,
  };

  function Songs() {
    return root.Songs;
  }

  function Stops() {
    return root.FTLStops;
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
    const cats = Array.isArray(o.cats) ? uniq(o.cats.filter((c) => S.CATEGORY_IDS.includes(c))) : d.cats.slice();
    const decades = Array.isArray(o.decades) ? uniq(o.decades.map(Number).filter((x) => S.DECADES.includes(x))).sort() : [];
    const s = {
      input: pick(INPUTS, o.input, d.input),
      mode: pick(MODES, o.mode, d.mode),
      answer: pick(ANSWERS, o.answer, d.answer),
      teams: pick(TEAM_COUNTS, Number(o.teams), d.teams),
      count: pick(COUNTS, Number(o.count), d.count),
      time: pick(TIMES, Number(o.time), d.time),
      // alles angekreuzt = keine Einschränkung
      cats: cats.length === S.CATEGORY_IDS.length ? [] : cats,
      decades: decades.length === S.DECADES.length ? [] : decades,
      level: pick(S.LEVEL_IDS, o.level, d.level),
      drinks: !!o.drinks,
    };
    // Ein Gerät spielt immer reihum (wer Teams will, trägt Teamnamen ein), Ansingen kennt kein „alle gleichzeitig“ –
    // die Wahl bleibt trotzdem stehen, damit sie nach dem Umschalten wieder da ist (siehe teamMode / allMode)
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

  function cleanAnswer(t) {
    return String(t == null ? '' : t)
      .replace(/[\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_ANSWER);
  }

  /** Alle Songs, die zu den Einstellungen passen */
  function pool(settings) {
    const s = sanitizeSettings(settings);
    return Songs().filter({ cats: s.cats, decades: s.decades, level: s.level });
  }

  /** Was alle sehen dürfen */
  function card(song) {
    return { id: song.id, title: song.title, artist: song.artist, year: song.year };
  }

  /**
   * Abstimmung auswerten: { yes, close, no, total, verdict }.
   * Mehrheit entscheidet, Gleichstand = 'close' (🤏), keine Stimmen = verdict null.
   */
  function tally(votes) {
    const out = { yes: 0, close: 0, no: 0, total: 0, verdict: null };
    for (const v of votes || []) {
      if (!VERDICTS.includes(v)) continue;
      out[v]++;
      out.total++;
    }
    if (!out.total) return out;
    const max = Math.max(out.yes, out.close, out.no);
    const top = VERDICTS.filter((v) => out[v] === max);
    out.verdict = top.length === 1 ? top[0] : 'close';
    return out;
  }

  /** „Alle gleichzeitig“: mehr als die Hälfte 👍 → richtig, mindestens ein 👍 → fast. Niemand stimmt ab → null. */
  function likeVerdict(likes, voters) {
    if (!(voters > 0)) return null;
    if (likes * 2 > voters) return 'yes';
    return likes > 0 ? 'close' : 'no';
  }

  /** Songs auf volle Runden aufrunden: 15 Songs bei 2 Teams → 16 */
  function totalSongs(count, units) {
    const u = Math.max(1, units || 1);
    return Math.ceil(count / u) * u;
  }

  function newStats() {
    return { right: 0, close: 0, wrong: 0, sang: 0, sangHits: 0, buzzHits: 0 };
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
        streak: [],
        no: 0,
        total: 0,
        cur: null,
        next: null,
        last: null,
        turnAt: 0,
        singers: [],
        singAt: 0,
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

    shuffle(list) {
      const a = list.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    /* ---------- Hilfsfunktionen ---------- */

    get write() {
      return this.s.settings.input === 'phones';
    }

    get pool() {
      if (!this._pool) this._pool = pool(this.s.settings);
      return this._pool;
    }

    get teamMode() {
      return this.write && this.s.settings.answer === 'teams';
    }

    /** Audio „alle gleichzeitig“ (tippen statt singen) */
    get allMode() {
      return this.write && this.s.settings.mode === 'audio' && this.s.settings.answer === 'all';
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

    /** Wer gerade wirklich mitspielt (in einem Team und online) */
    active() {
      return this.s.teams.flatMap((t) => t.members).filter((pid) => this.isOnline(pid));
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

    /** Audio: Wer stimmt ab? Alle, die nicht im Team am Zug sind (nur mit Handys) */
    voters() {
      const cur = this.s.cur;
      if (!this.write || !cur || cur.kind !== 'audio' || cur.turn === null) return [];
      return this.active().filter((pid) => this.teamOf(pid) !== cur.turn);
    }

    /** „Alle gleichzeitig“: Wer bewertet diese Antwort? Alle außer der Person selbst */
    votersFor(author) {
      return this.active().filter((pid) => pid !== author);
    }

    /** Darf überstimmen? Laptop – oder die Spielleitung, wenn ihr Team nicht am Zug ist */
    overrules(actor) {
      const cur = this.s.cur;
      if (actor === STAGE) return true;
      if (!this.leads(actor) || !cur) return false;
      return cur.turn === null || this.teamOf(actor) !== cur.turn;
    }

    /** Ansingen: Darf dieses Team gerade ✋ drücken? */
    teamMayBuzz(ti) {
      const cur = this.s.cur;
      const t = this.s.teams[ti];
      if (!t || !cur || cur.kind !== 'sing' || !cur.song) return false;
      if (ti === this.teamOf(cur.singer) || cur.out.includes(ti)) return false;
      return t.members.some((pid) => pid !== cur.singer && this.isOnline(pid));
    }

    mayBuzz(pid) {
      const cur = this.s.cur;
      if (!cur || cur.kind !== 'sing' || pid === STAGE || pid === cur.singer) return false;
      const ti = this.teamOf(pid);
      return ti !== null && this.teamMayBuzz(ti);
    }

    /** Ansingen: Wer bestätigt ein ✋? Laptop oder die Ansänger/in */
    judges(actor) {
      const cur = this.s.cur;
      if (!cur || cur.kind !== 'sing' || !cur.buzz) return false;
      return actor === STAGE || actor === cur.singer;
    }

    /** Wie viele Songs pro Runde? (damit alle gleich oft dran sind) */
    units() {
      const s = this.s;
      if (s.settings.mode === 'audio' && this.allMode) return 1;
      return s.teams.length;
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
      const c = card(song);
      if (mark) {
        this.s.used.push(c.id);
        if (ev.onDraw) ev.onDraw(c, reset);
      }
      return c;
    }

    drawSong() {
      return this.drawFree(null, true);
    }

    markUsed(song) {
      const ev = this.evening();
      if (!this.s.used.includes(song.id)) this.s.used.push(song.id);
      if (ev.onDraw) ev.onDraw(song, false);
    }

    /** 3 Songs zum Ansingen (ohne die schon gezeigten) */
    drawOptions(seen) {
      const out = [];
      for (let i = 0; i < SING_OPTIONS; i++) {
        const song = this.drawFree(seen.concat(out.map((x) => x.id)), false);
        if (!song) break;
        out.push(song);
      }
      return out;
    }

    stopFor(song) {
      const St = Stops();
      if (St) return St.stopFor(song, () => this.random());
      return { secs: Math.round((8 + this.random() * 12) * 10) / 10, known: false };
    }

    newAudio(song, turn) {
      const now = this.now();
      const stop = this.stopFor(song);
      return {
        kind: 'audio',
        song,
        stop: stop.secs,
        stopKnown: stop.known,
        turn: turn === undefined ? null : turn,
        playId: 1,
        deadline: null,
        startedAt: now,
        singAt: null,
        answers: {},
        order: null,
        votes: {},
        verdict: null,
        likes: {},
        done: [],
        overrides: {},
        replays: 0,
      };
    }

    newSing(singer) {
      const now = this.now();
      return {
        kind: 'sing',
        song: null,
        singer,
        options: null,
        seen: [],
        rerolls: 0,
        deadline: null,
        left: null,
        startedAt: now,
        buzz: null,
        out: [],
        wrong: [],
        hit: null,
      };
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
      if (ti !== null && !this.teamMode) s.teams[ti].name = s.members[pid].name;
      this.changed();
    }

    maxMembers() {
      return this.teamMode ? MAX_MEMBERS : MAX_PLAYERS;
    }

    disconnect(pid) {
      const m = this.s.members[pid];
      if (!m || !m.online) return;
      m.online = false;
      m.offlineAt = this.now();
      this.settle();
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
      if (!this.teamMode) return;
      const m = s.members[pid];
      const counts = Array.from({ length: s.settings.teams }, (_, i) => s.order.filter((p) => s.members[p].team === i && !s.members[p].watch).length);
      m.team = counts.indexOf(Math.min(...counts));
    }

    /** Lobby: Team-Zuteilung an die Einstellung anpassen */
    regroup() {
      const s = this.s;
      for (const pid of s.order) {
        const m = s.members[pid];
        if (!this.teamMode) delete m.team;
        else if (!(m.team >= 0 && m.team < s.settings.teams)) m.team = undefined;
      }
      for (const pid of s.order) if (this.teamMode && s.members[pid].team === undefined && !s.members[pid].watch) this.autoTeam(pid);
    }

    /**
     * Nach Weggang/Rauswurf: Wartet das Spiel noch auf jemanden, der nicht mehr da ist?
     * Alle Antworten da → abstimmen · alle Stimmen da → auflösen · niemand darf mehr ✋ → auflösen
     */
    settle() {
      const s = this.s;
      const cur = s.cur;
      if (!cur) return false;
      if (cur.kind === 'audio') {
        if (s.phase === 'sing' && this.allMode && this.allAnswered()) return this.startVote();
        if (s.phase === 'vote' && this.voteComplete()) return this.reveal();
      } else if (s.phase === 'play' && cur.song && !this.eligible().length) return this.reveal();
      return false;
    }

    /* ---------- Ablauf ---------- */

    buildTeams() {
      const s = this.s;
      const playing = this.playing();
      const team = (name, color, members) => ({ id: 't' + (s.teams.length + 1), name, color, members, points: 0 });
      s.teams = [];
      if (this.teamMode) {
        for (let i = 0; i < s.settings.teams; i++) {
          const members = playing.filter((pid) => s.members[pid].team === i);
          if (members.length) s.teams.push(team(TEAMS[i].name, TEAMS[i].color, members));
        }
      } else {
        playing.forEach((pid, i) => s.teams.push(team(s.members[pid].name, COLORS[i % COLORS.length], [pid])));
      }
      s.streak = s.teams.map(() => 0);
      s.turnAt = 0;
      // Ansingen reihum, mit Teams abwechselnd aus jedem Team
      const lists = s.teams.map((t) => t.members.slice());
      s.singers = [];
      while (lists.some((l) => l.length)) for (const l of lists) if (l.length) s.singers.push(l.shift());
      s.singAt = 0;
    }

    lobbyProblem() {
      const s = this.s;
      const playing = this.playing();
      if (playing.length < MIN_PLAYERS) return `Ihr braucht mindestens ${MIN_PLAYERS} Personen – scannt den QR-Code!`;
      if (this.teamMode) {
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
      s.total = totalSongs(s.settings.count, this.units());
      s.cur = null;
      s.next = null;
      s.last = null;
      s.reason = null;
      s.log = [];
      s.used = [];
      s.startedAt = this.now();
      if (!this.startSong()) this.finish('empty');
    }

    startSong() {
      const s = this.s;
      s.no++;
      s.last = null;
      const ok = s.settings.mode === 'sing' ? this.startSing() : this.startAudio();
      if (ok && s.settings.mode === 'audio' && !s.next && s.no < s.total) s.next = this.drawSong();
      return ok;
    }

    /** Nächstes Team, das dran ist (online) – reihum */
    nextTurn() {
      const s = this.s;
      const n = s.teams.length;
      for (let k = 0; k < n; k++) {
        const ti = (s.turnAt + k) % n;
        if (!s.teams[ti].members.some((pid) => this.isOnline(pid))) continue;
        s.turnAt = (ti + 1) % n;
        return ti;
      }
      return n ? 0 : null;
    }

    startAudio(turn) {
      const s = this.s;
      const song = s.next || this.drawSong();
      s.next = null;
      if (!song) return false;
      s.cur = this.newAudio(song, this.allMode ? null : turn !== undefined ? turn : this.nextTurn());
      s.phase = 'play';
      return true;
    }

    /** Nächste Person, die ansingt (online) */
    nextSinger() {
      const s = this.s;
      const n = s.singers.length;
      for (let k = 0; k < n; k++) {
        const pid = s.singers[(s.singAt + k) % n];
        if (!this.isOnline(pid) || this.teamOf(pid) === null) continue;
        s.singAt = (s.singAt + k + 1) % n;
        return pid;
      }
      return null;
    }

    startSing(singer) {
      const s = this.s;
      const pid = singer || this.nextSinger();
      if (!pid) return false;
      const options = this.drawOptions([]);
      if (!options.length) return false;
      s.cur = this.newSing(pid);
      s.cur.options = options;
      s.cur.seen = options.map((x) => x.id);
      s.phase = 'pick';
      return true;
    }

    /** Weitersingen-Zeit (Audio) in ms */
    singMs() {
      return this.s.settings.time * 1000 + (this.allMode ? TYPE_EXTRA_MS : 0);
    }

    /** Audio: alle, die mitspielen, haben getippt? */
    allAnswered() {
      const cur = this.s.cur;
      const act = this.active();
      return act.length > 0 && act.every((pid) => cur.answers[pid]);
    }

    /** Audio: Auflösung – der Ausschnitt läuft weiter, die Runde stimmt ab */
    startVote() {
      const s = this.s;
      const cur = s.cur;
      s.phase = 'vote';
      cur.deadline = null;
      if (this.allMode) {
        cur.order = this.shuffle(Object.keys(cur.answers).filter((pid) => cur.answers[pid] && cur.answers[pid].text));
        for (const pid of cur.order) cur.likes[pid] = [];
        // niemand hat etwas getippt: nichts zu bewerten
        if (!cur.order.length) return this.reveal();
      }
      return true;
    }

    /** Haben alle abgestimmt? (ohne Stimmberechtigte entscheidet der Laptop) */
    voteComplete() {
      const cur = this.s.cur;
      if (this.allMode) {
        const act = this.active();
        // wer keine fremde Antwort zu bewerten hat, muss nicht „fertig“ drücken
        const need = act.filter((pid) => cur.order.some((a) => a !== pid));
        return need.length > 0 && need.every((pid) => cur.done.includes(pid));
      }
      const v = this.voters();
      return v.length > 0 && v.every((pid) => cur.votes[pid]);
    }

    /** Ansingen: welche Teams dürfen noch ✋ drücken? */
    eligible() {
      return this.s.teams.map((_, i) => i).filter((i) => this.teamMayBuzz(i));
    }

    /** Ansingen: nach falschem ✋ weiter (oder auflösen, wenn niemand mehr darf) */
    resume() {
      const s = this.s;
      const cur = s.cur;
      cur.buzz = null;
      if (!this.eligible().length) return this.reveal();
      s.phase = 'play';
      cur.deadline = this.now() + Math.max(RESUME_MIN_MS, cur.left || 0);
      cur.left = null;
      return true;
    }

    /** Serie von 👍: nach 3 hintereinander darf das Team verteilen */
    streak(ti, right, sips) {
      const s = this.s;
      if (!s.streak[ti]) s.streak[ti] = 0;
      s.streak[ti] = right ? s.streak[ti] + 1 : 0;
      if (s.streak[ti] >= STREAK) {
        s.streak[ti] = 0;
        if (s.settings.drinks) sips.give.push(ti);
      }
    }

    countVerdict(pids, verdict) {
      for (const pid of pids) {
        const st = this.stat(pid);
        if (verdict === 'yes') st.right++;
        else if (verdict === 'close') st.close++;
        else st.wrong++;
      }
    }

    /** Auflösen: Punkte verbuchen, Statistik, Trinkregeln */
    reveal() {
      const s = this.s;
      const cur = s.cur;
      if (!cur || !cur.song) return false;
      const drinks = s.settings.drinks;
      const sips = { drink: [], give: [] };
      let last;
      if (cur.kind === 'audio' && cur.turn === null) {
        // alle gleichzeitig: jede Antwort für sich
        const results = s.teams.map((t, ti) => {
          const pid = t.members[0];
          const a = pid ? cur.answers[pid] : null;
          const text = a ? a.text : '';
          const likes = (cur.likes[pid] || []).length;
          const voters = this.votersFor(pid).length;
          let verdict = null;
          if (text) verdict = cur.overrides[pid] || likeVerdict(likes, voters) || 'no';
          const points = verdict ? POINTS[verdict] : 0;
          t.points += points;
          if (pid && s.stats[pid] !== undefined && (text || this.isOnline(pid))) this.countVerdict([pid], verdict || 'no');
          if (drinks && verdict !== 'yes' && verdict !== 'close' && pid && (text || this.isOnline(pid))) sips.drink.push(ti);
          this.streak(ti, verdict === 'yes', sips);
          return { team: ti, pid: pid || null, text, likes, voters, verdict, points, overridden: !!cur.overrides[pid] };
        });
        last = { kind: 'audio', all: true, results };
      } else if (cur.kind === 'audio') {
        const t = tally(Object.values(cur.votes));
        const verdict = cur.verdict || t.verdict || 'no';
        const points = POINTS[verdict];
        const team = s.teams[cur.turn];
        if (team) {
          team.points += points;
          this.countVerdict(team.members, verdict);
        }
        if (drinks && verdict === 'no') sips.drink.push(cur.turn);
        this.streak(cur.turn, verdict === 'yes', sips);
        last = { kind: 'audio', all: false, turn: cur.turn, verdict, points, votes: { yes: t.yes, close: t.close, no: t.no, total: t.total }, overridden: !!cur.verdict, results: [{ team: cur.turn, verdict, points }] };
      } else {
        const singerTeam = this.teamOf(cur.singer);
        const hit = cur.hit;
        const st = this.stat(cur.singer);
        st.sang++;
        const results = [];
        if (hit) {
          st.sangHits++;
          this.stat(hit.pid).buzzHits++;
          s.teams[hit.team].points += SING_HIT;
          results.push({ team: hit.team, pid: hit.pid, points: SING_HIT, verdict: 'yes' });
          if (singerTeam !== null) {
            s.teams[singerTeam].points += SING_SINGER;
            results.push({ team: singerTeam, pid: cur.singer, points: SING_SINGER, singer: true });
          }
          this.streak(hit.team, true, sips);
        }
        for (const w of cur.wrong) {
          this.stat(w.pid).wrong++;
          if (drinks && !sips.drink.includes(w.team)) sips.drink.push(w.team);
          if (!hit || hit.team !== w.team) this.streak(w.team, false, sips);
        }
        last = {
          kind: 'sing',
          singer: cur.singer,
          singerTeam,
          hit: hit ? { team: hit.team, pid: hit.pid } : null,
          wrong: cur.wrong.map((w) => ({ team: w.team, pid: w.pid })),
          results,
        };
      }
      const nobody = !last.results.some((r) => r.points > 0);
      s.last = Object.assign(last, { no: s.no, song: card(cur.song), sips, nobody });
      s.log.push({
        no: s.no,
        kind: cur.kind,
        song: card(cur.song),
        singer: cur.kind === 'sing' ? cur.singer : null,
        turn: cur.kind === 'audio' ? cur.turn : null,
        results: last.results.filter((r) => r.points > 0).map((r) => ({ team: r.team, points: r.points, verdict: r.verdict || null, by: r.pid || null, singer: !!r.singer })),
      });
      cur.deadline = null;
      cur.buzz = null;
      s.phase = 'reveal';
      return true;
    }

    willEnd() {
      const s = this.s;
      return s.phase === 'reveal' && s.no >= s.total;
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

    /** Weiter nach der Auflösung: nächster Song oder Siegerehrung */
    next() {
      const s = this.s;
      if (s.phase !== 'reveal') return false;
      if (s.no >= s.total) return this.finish('done');
      if (!this.startSong()) return this.finish('empty');
      return true;
    }

    /* ---------- Zeit ---------- */

    armTimer() {
      clearTimeout(this.timer);
      this.timer = null;
      if (this.hooks.timers === false) return;
      const s = this.s;
      const timed = s.cur && ((s.cur.kind === 'audio' && s.phase === 'sing') || (s.cur.kind === 'sing' && s.phase === 'play'));
      const end = timed ? s.cur.deadline : null;
      if (!end) return;
      this.timer = setTimeout(
        () => {
          if (this.tick()) this.changed();
          else this.armTimer();
        },
        Math.max(0, end - this.now()) + 30
      );
    }

    /** Abgelaufene Zeit auswerten. true = hat sich etwas geändert */
    tick() {
      const s = this.s;
      const cur = s.cur;
      if (!cur || !cur.deadline || cur.deadline > this.now()) return false;
      if (cur.kind === 'audio' && s.phase === 'sing') return this.startVote();
      if (cur.kind === 'sing' && s.phase === 'play') return this.reveal();
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
      if (s.phase !== 'lobby' || !m || m.watch || !this.teamMode || !(team >= 0 && team < s.settings.teams) || m.team === team) return false;
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
      const at = s.singers.indexOf(pid);
      if (at >= 0) {
        s.singers.splice(at, 1);
        if (s.singAt > at) s.singAt--;
        if (s.singAt >= s.singers.length) s.singAt = 0;
      }
      const cur = s.cur;
      if (cur && cur.kind === 'sing' && cur.singer === pid && ['pick', 'play', 'buzzed'].includes(s.phase)) {
        // Ansänger/in ist weg: Song ohne Wertung abbrechen, die nächste Person singt an
        s.no--;
        if (!this.startSong()) this.finish('empty');
      } else if (cur && cur.kind === 'sing' && cur.buzz && cur.buzz.pid === pid) this.resume();
      else if (cur && cur.kind === 'audio') {
        delete cur.votes[pid];
        for (const k of Object.keys(cur.likes)) cur.likes[k] = cur.likes[k].filter((p) => p !== pid);
        cur.done = cur.done.filter((p) => p !== pid);
        this.settle();
      } else this.settle();
      return true;
    }

    on_start(a, actor) {
      if (actor !== STAGE || this.s.phase !== 'lobby' || this.lobbyProblem()) return false;
      this.startGame();
      return true;
    }

    /* Audio stoppt */

    /** Bühne: Ausschnitt ist an der Stoppstelle angekommen → weitersingen */
    on_stopped(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (actor !== STAGE || s.phase !== 'play' || !cur || cur.kind !== 'audio') return false;
      if (a.playId !== undefined && Number(a.playId) !== cur.playId) return false;
      s.phase = 'sing';
      cur.singAt = this.now();
      cur.deadline = this.now() + this.singMs();
      return true;
    }

    /** Nochmal bis zur Stelle hören */
    on_replay(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!this.leads(actor) || !['play', 'sing'].includes(s.phase) || !cur || cur.kind !== 'audio') return false;
      s.phase = 'play';
      cur.playId++;
      cur.deadline = null;
      cur.replays++;
      return true;
    }

    /** Kein Ausschnitt zu finden → anderer Song, gleiche Reihenfolge (Laptop) */
    on_replace(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (actor !== STAGE || !['play', 'sing'].includes(s.phase) || !cur || cur.kind !== 'audio') return false;
      if (a.id && a.id !== cur.song.id) return false;
      const song = s.next || this.drawSong();
      s.next = null;
      if (!song) return this.finish('empty');
      s.cur = this.newAudio(song, cur.turn);
      s.phase = 'play';
      if (s.no < s.total) s.next = this.drawSong();
      return true;
    }

    /** Nicht spielbar (z. B. kein Internet) → nächster Song wird neu vorgeladen */
    on_skipnext(a, actor) {
      const s = this.s;
      if (actor !== STAGE || !s.next || (a.id && a.id !== s.next.id)) return false;
      s.next = this.drawSong();
      return true;
    }

    /** Alle gleichzeitig: Fortsetzung tippen (bis die Zeit um ist, darf geändert werden) */
    on_answer(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!this.allMode || !cur || cur.kind !== 'audio' || !['play', 'sing'].includes(s.phase)) return false;
      if (this.teamOf(actor) === null || !this.isOnline(actor)) return false;
      const text = cleanAnswer(a.text);
      if (!text) return false;
      cur.answers[actor] = { text, at: this.now() };
      if (s.phase === 'sing' && this.allAnswered()) this.startVote();
      return true;
    }

    /** Abstimmen (Team am Zug wird von den anderen bewertet) */
    on_vote(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'vote' || !cur || cur.kind !== 'audio' || cur.turn === null || !VERDICTS.includes(a.verdict)) return false;
      if (!this.voters().includes(actor) || cur.votes[actor] === a.verdict) return false;
      cur.votes[actor] = a.verdict;
      if (this.voteComplete()) this.reveal();
      return true;
    }

    /**
     * Überstimmen bzw. am Laptop entscheiden.
     * Reihum/Teams: { verdict } → sofort ausgewertet. Alle gleichzeitig: { i, verdict } für eine Antwort
     * (verdict null = wieder nach 👍 zählen).
     */
    on_verdict(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'vote' || !cur || cur.kind !== 'audio' || !this.overrules(actor)) return false;
      if (cur.turn !== null) {
        if (!VERDICTS.includes(a.verdict)) return false;
        cur.verdict = a.verdict;
        return this.reveal();
      }
      const author = cur.order[Number(a.i)];
      if (!author || author === actor) return false;
      const v = a.verdict === null || a.verdict === undefined ? null : a.verdict;
      if (v !== null && !VERDICTS.includes(v)) return false;
      if ((cur.overrides[author] || null) === v) return false;
      if (v === null) delete cur.overrides[author];
      else cur.overrides[author] = v;
      return true;
    }

    /** Alle gleichzeitig: 👍 für eine Antwort (nicht die eigene) */
    on_like(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'vote' || !this.allMode || !cur || cur.kind !== 'audio') return false;
      const author = cur.order[Number(a.i)];
      if (!author || author === actor || !this.votersFor(author).includes(actor)) return false;
      const list = cur.likes[author] || (cur.likes[author] = []);
      const on = a.on === undefined ? !list.includes(actor) : !!a.on;
      if (on === list.includes(actor)) return false;
      cur.likes[author] = on ? list.concat(actor) : list.filter((p) => p !== actor);
      return true;
    }

    /** Alle gleichzeitig: fertig bewertet */
    on_done(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'vote' || !this.allMode || !cur || cur.done.includes(actor) || this.teamOf(actor) === null) return false;
      cur.done.push(actor);
      if (this.voteComplete()) this.reveal();
      return true;
    }

    /** Abstimmung jetzt auswerten (Spielleitung). Reihum/Teams braucht mindestens eine Stimme. */
    on_count(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!this.leads(actor) || s.phase !== 'vote' || !cur || cur.kind !== 'audio') return false;
      if (cur.turn !== null && !Object.keys(cur.votes).length) return false;
      return this.reveal();
    }

    /* Ansingen */

    /** Ansänger/in sucht sich einen Song aus (ein Gerät: am Laptop) */
    on_pick(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'pick' || !cur || !(actor === cur.singer || (actor === STAGE && !this.write))) return false;
      const song = (cur.options || []).find((x) => x.id === a.id);
      if (!song) return false;
      cur.song = clone(song);
      cur.options = null;
      this.markUsed(song);
      s.phase = 'play';
      cur.startedAt = this.now();
      cur.deadline = this.now() + SING_MS;
      return true;
    }

    /** „Kenn ich nicht“: drei andere */
    on_reroll(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'pick' || !cur || !(actor === cur.singer || (actor === STAGE && !this.write))) return false;
      const options = this.drawOptions(cur.seen);
      if (!options.length) return false;
      cur.options = options;
      cur.seen = cur.seen.concat(options.map((x) => x.id));
      cur.rerolls++;
      return true;
    }

    /** Laptop: jemand anderes singt an */
    on_skipsing(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'pick') return false;
      const pid = this.nextSinger();
      if (!pid || pid === s.cur.singer) return false;
      return this.startSing(pid);
    }

    /** ✋ Ich kann weitersingen! (Handy) – oder am Laptop für ein Team ({ team }) */
    on_buzz(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'play' || !cur || cur.kind !== 'sing' || !cur.song) return false;
      let ti;
      let pid;
      if (actor === STAGE) {
        if (this.write) return false;
        ti = Number(a.team);
        const t = s.teams[ti];
        if (!t || !this.teamMayBuzz(ti)) return false;
        pid = t.members.find((p) => p !== cur.singer) || null;
        if (!pid) return false;
      } else {
        if (!this.mayBuzz(actor)) return false;
        ti = this.teamOf(actor);
        pid = actor;
      }
      cur.buzz = { team: ti, pid, at: this.now() };
      cur.left = cur.deadline ? Math.max(0, cur.deadline - this.now()) : null;
      cur.deadline = null;
      s.phase = 'buzzed';
      return true;
    }

    /** ✋ bestätigen: { ok: true | false } */
    on_judge(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'buzzed' || !cur || !this.judges(actor)) return false;
      const { team, pid } = cur.buzz;
      if (a.ok === true || a.ok === 'yes') {
        cur.hit = { team, pid };
        return this.reveal();
      }
      if (a.ok !== false && a.ok !== 'no') return false;
      cur.out.push(team);
      cur.wrong.push({ team, pid });
      return this.resume();
    }

    /* Allgemein */

    /** Weiter zur Auflösung: Audio → abstimmen bzw. auswerten · Ansingen → niemand weiß es (auch die Ansänger/in) */
    on_resolve(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!cur || !cur.song) return false;
      if (cur.kind === 'audio') {
        if (!this.leads(actor)) return false;
        if (['play', 'sing'].includes(s.phase)) return this.startVote();
        return false;
      }
      if (!['play', 'buzzed'].includes(s.phase) || !(this.leads(actor) || actor === cur.singer)) return false;
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
        const hits = s.log.filter((x) => x.results.some((r) => r.team === i && r.verdict === 'yes')).length;
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
     * Auszeichnungen: 🎤 Textsicher (meiste 👍) · 🙉 Verhörer (meiste 👎) · 🎙️ Ansage-Star (am öftesten
     * erfolgreich angesungen) · ✋ Schnellster Mund (meiste Treffer beim Weitersingen) – [{ id, icon, label, text, pids, value }]
     */
    awards() {
      const s = this.s;
      const out = [];
      const pids = Object.keys(s.stats).filter((p) => s.members[p]);
      const most = (key, min) => {
        const max = Math.max(0, ...pids.map((p) => s.stats[p][key]));
        return max >= min ? { value: max, pids: pids.filter((p) => s.stats[p][key] === max) } : null;
      };
      const sure = most('right', 2);
      if (sure) out.push(Object.assign({ id: 'sure', icon: '🎤', label: 'Textsicher', text: `${sure.value}× richtig weitergesungen` }, sure));
      const fast = most('buzzHits', 2);
      if (fast) out.push(Object.assign({ id: 'fast', icon: '✋', label: 'Schnellster Mund', text: `${fast.value}× zuerst weitergesungen` }, fast));
      const star = most('sangHits', 2);
      if (star) out.push(Object.assign({ id: 'star', icon: '🎙️', label: 'Ansage-Star', text: `${star.value} Songs erfolgreich angesungen` }, star));
      const deaf = most('wrong', 2);
      if (deaf) out.push(Object.assign({ id: 'deaf', icon: '🙉', label: 'Verhörer', text: `${deaf.value}× daneben` }, deaf));
      return out;
    }

    /* ---------- Ansicht ---------- */

    audioView(viewer) {
      const s = this.s;
      const cur = s.cur;
      const stage = viewer === STAGE;
      const voting = s.phase === 'vote';
      const turn = cur.turn;
      const all = turn === null;
      let answers = null;
      if (all && voting) {
        answers = cur.order.map((pid, i) => {
          const likes = cur.likes[pid] || [];
          return {
            i,
            text: cur.answers[pid].text,
            mine: !stage && pid === viewer,
            liked: !stage && likes.includes(viewer),
            // die Zahl der 👍 sieht nur der Laptop – sonst lenkt sie ab
            likes: stage ? likes.length : null,
            override: stage || this.overrules(viewer) ? cur.overrides[pid] || null : null,
          };
        });
      }
      const voters = this.voters();
      return {
        kind: 'audio',
        song: card(cur.song),
        // die Stelle braucht nur die Bühne zum Abspielen
        stop: stage ? cur.stop : null,
        stopKnown: stage ? cur.stopKnown : null,
        playId: cur.playId,
        turn,
        turnName: turn !== null && s.teams[turn] ? s.teams[turn].name : null,
        left: cur.deadline ? Math.max(0, cur.deadline - this.now()) : null,
        total: this.singMs(),
        answered: all ? Object.keys(cur.answers) : null,
        answers,
        voters: voters.length,
        voted: all ? cur.done.length : Object.keys(cur.votes).length,
        votedPids: all ? cur.done.slice() : Object.keys(cur.votes),
        verdict: cur.verdict,
      };
    }

    singView(viewer) {
      const s = this.s;
      const cur = s.cur;
      const stage = viewer === STAGE;
      const isSinger = !stage && viewer === cur.singer;
      const open = s.phase === 'reveal' || s.phase === 'end';
      const knows = cur.song && (open || isSinger || (stage && !this.write));
      return {
        kind: 'sing',
        singer: cur.singer,
        singerName: this.memberName(cur.singer),
        singerTeam: this.teamOf(cur.singer),
        options: s.phase === 'pick' && (isSinger || (stage && !this.write)) ? clone(cur.options) : null,
        rerolls: cur.rerolls,
        song: knows ? card(cur.song) : null,
        buzz: cur.buzz ? { team: cur.buzz.team, pid: cur.buzz.pid, name: this.memberName(cur.buzz.pid) } : null,
        out: cur.out.slice(),
        eligible: this.eligible(),
        left: cur.deadline ? Math.max(0, cur.deadline - this.now()) : null,
        total: SING_MS,
        paused: s.phase === 'buzzed' ? cur.left : null,
      };
    }

    viewFor(viewer) {
      const s = this.s;
      const stage = viewer === STAGE;
      const cur = s.cur;
      const active = ['pick', 'play', 'sing', 'vote', 'buzzed', 'reveal'].includes(s.phase) && cur;
      const myTeam = stage ? null : this.teamOf(viewer);
      let curView = null;
      if (active) curView = cur.kind === 'audio' ? this.audioView(viewer) : this.singView(viewer);
      const audio = cur && cur.kind === 'audio';
      const myAnswer = !stage && audio && cur.answers[viewer] ? cur.answers[viewer].text : null;
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
          streak: s.streak[s.teams.indexOf(t)] || 0,
        })),
        no: s.no,
        total: s.total || s.settings.count,
        cur: curView,
        nextSong: stage && s.next ? card(s.next) : null,
        last: s.last && s.phase === 'reveal' ? clone(s.last) : null,
        willEnd: this.willEnd(),
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
              singer: !!(cur && cur.kind === 'sing' && cur.singer === viewer),
              turn: !!(audio && cur.turn !== null && myTeam === cur.turn),
              voter: !!(audio && s.phase === 'vote' && (cur.turn === null ? myTeam !== null : this.voters().includes(viewer))),
              vote: audio && cur.votes[viewer] ? cur.votes[viewer] : null,
              done: !!(audio && cur.done.includes(viewer)),
              overrule: !!(audio && s.phase === 'vote' && this.overrules(viewer)),
              canBuzz: s.phase === 'play' && this.mayBuzz(viewer),
              judge: s.phase === 'buzzed' && this.judges(viewer),
              answer: myAnswer,
            },
      };
    }
  }

  /** Songs des Abends – setzt die Oberfläche (der StageController reicht keine eigenen Hooks durch) */
  Engine.evening = null;

  root.FTLEngine = {
    Engine,
    GAME,
    STAGE,
    INPUTS,
    MODES,
    ANSWERS,
    COUNTS,
    TIMES,
    TEAM_COUNTS,
    VERDICTS,
    POINTS,
    SING_HIT,
    SING_SINGER,
    SING_MS,
    TYPE_EXTRA_MS,
    RESUME_MIN_MS,
    SING_OPTIONS,
    SIPS_WRONG,
    SIPS_GIVE,
    STREAK,
    TEAMS,
    COLORS,
    MIN_PLAYERS,
    MAX_PLAYERS,
    MAX_MEMBERS,
    MAX_NAME,
    MAX_ANSWER,
    MIN_POOL,
    DEFAULT_SETTINGS,
    sanitizeSettings,
    cleanName,
    cleanAnswer,
    pool,
    card,
    tally,
    likeVerdict,
    totalSongs,
  };
})(typeof window !== 'undefined' ? window : globalThis);
