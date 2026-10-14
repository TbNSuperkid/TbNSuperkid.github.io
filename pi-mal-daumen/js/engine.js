/*
 * Spiellogik von „Pi mal Daumen“ – dem Schätz-Quiz.
 *
 * Jede Runde gibt es eine Frage mit Zahl als Antwort. Die Teams (oder bei „Jeder für sich“ einzelne
 * Personen) schätzen, wer am nächsten dran ist, bekommt die meisten Punkte.
 *
 * Zwei Spielweisen:
 *  - say:   ohne Handy – die Teams nennen ihre Zahl reihum laut, am Laptop wird eingetragen
 *  - write: mit Handy – jedes Team tippt geheim, entweder in ein gemeinsames Feld (shared)
 *           oder jede/r für sich, dann zählt der Median des Teams (median)
 *
 * „Über uns“-Fragen haben keine feste Antwort: Mit Handy beantwortet jede Person geheim die Frage über
 * sich selbst und die App rechnet die Summe aus, ohne Handy wird nach dem Schätzen durchgezählt.
 *
 * Der Laptop ("stage") ist immer der Host und spielt nicht selbst mit. Die Antwort steht in keiner
 * Ansicht (auch nicht in der des Laptops), bevor aufgedeckt wird.
 */
(function (root) {
  'use strict';

  const N = root.PMDNumbers;
  const Deck = root.PMDDeck;

  const GAME = 'pi-mal-daumen';
  const STAGE = 'stage';
  const TEAMS = [
    { id: 'rot', label: 'Rot', color: '#ef4444' },
    { id: 'blau', label: 'Blau', color: '#3b82f6' },
    { id: 'gruen', label: 'Grün', color: '#22c55e' },
    { id: 'gelb', label: 'Gelb', color: '#facc15' },
  ];
  // Farben für „Jeder für sich“
  const SOLO_COLORS = [
    '#ef4444',
    '#3b82f6',
    '#22c55e',
    '#facc15',
    '#a855f7',
    '#f97316',
    '#14b8a6',
    '#ec4899',
    '#84cc16',
    '#38bdf8',
    '#d6a46a',
    '#e5e7eb',
  ];
  const INPUTS = ['say', 'write'];
  const QUESTION_OPTIONS = [5, 10, 15, 20, 30];
  const SECONDS_OPTIONS = [0, 30, 45, 60, 90];
  const SCORINGS = ['rank', 'accuracy'];
  const TEAM_INPUTS = ['shared', 'median'];
  const DEFAULT_SETTINGS = {
    input: 'write',
    solo: false,
    questions: 10,
    seconds: 45,
    scoring: 'rank',
    teamInput: 'shared',
    joker: true,
    categories: Deck.DEFAULT_CATEGORIES.slice(),
  };
  const HIT_BONUS = 2;
  // Volltreffer: höchstens so viel Prozent daneben (Jahreszahlen: genau richtig)
  const HIT_PERCENT = 1;
  // Wertung „Genauigkeit“: Abweichung in Prozent bzw. Jahren → Punkte
  const ACCURACY_STEPS = [
    { pct: 1, years: 0, points: 5 },
    { pct: 5, years: 2, points: 4 },
    { pct: 10, years: 5, points: 3 },
    { pct: 25, years: 10, points: 2 },
    { pct: 50, years: 25, points: 1 },
  ];
  const MAX_PLAYERS = 12;
  const MAX_TEXT = 30;
  const MAX_OWN = 100000;
  // So lange wird auf jemanden gewartet, dessen Handy kurz die Verbindung verliert (Neuladen, Bildschirm aus …)
  const GRACE_MS = 15000;
  const EPS = 1e-9;

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

  function finite(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  function tidy(n) {
    return Math.round(n * 1e6) / 1e6;
  }

  /** Zahl aus einer Aktion: entweder schon eine Zahl oder ein Text wie „1,5 Mio“ */
  function toNumber(v) {
    if (finite(v)) return tidy(v);
    if (typeof v === 'string') return N.parse(v.slice(0, MAX_TEXT));
    return null;
  }

  function sanitizeSettings(input, current) {
    const s = Object.assign({}, current || DEFAULT_SETTINGS);
    s.categories = (s.categories || DEFAULT_SETTINGS.categories).slice();
    const i = input || {};
    if (INPUTS.includes(i.input)) s.input = i.input;
    if (typeof i.solo === 'boolean') s.solo = i.solo;
    if (QUESTION_OPTIONS.includes(+i.questions)) s.questions = +i.questions;
    if (SECONDS_OPTIONS.includes(+i.seconds)) s.seconds = +i.seconds;
    if (SCORINGS.includes(i.scoring)) s.scoring = i.scoring;
    if (TEAM_INPUTS.includes(i.teamInput)) s.teamInput = i.teamInput;
    if (typeof i.joker === 'boolean') s.joker = i.joker;
    if (Array.isArray(i.categories)) {
      const cats = Deck.CATEGORY_IDS.filter((id) => i.categories.includes(id));
      // Mindestens eine Kategorie mit festen Antworten muss dabei sein
      if (cats.some((id) => id !== 'uns')) s.categories = cats;
    }
    return s;
  }

  /* ---------- Wertung ---------- */

  function isHit(diff, answer, year) {
    if (year) return Math.round(diff) === 0;
    if (answer === 0) return diff < EPS;
    return diff <= (Math.abs(answer) * HIT_PERCENT) / 100 + EPS;
  }

  function accuracyPoints(diff, answer, year) {
    for (const st of ACCURACY_STEPS) {
      const ok = year ? Math.round(diff) <= st.years : answer === 0 ? diff < EPS : diff <= (Math.abs(answer) * st.pct) / 100 + EPS;
      if (ok) return st.points;
    }
    return 0;
  }

  /**
   * Punkte einer Frage berechnen.
   * @param {{id: string, value: number|null}[]} entries Schätzungen (null = kein Tipp)
   * @param {number} answer richtige Antwort
   * @param {{mode?: 'rank'|'accuracy', year?: boolean, bonus?: boolean, jokers?: string[]}} opts
   * @returns {Object<string, {value, diff, dir, rank, base, bonus, joker, hit, points}>}
   */
  function scoreRound(entries, answer, opts) {
    const o = opts || {};
    const mode = o.mode === 'accuracy' ? 'accuracy' : 'rank';
    const year = !!o.year;
    const out = {};
    for (const e of entries) {
      const value = finite(e.value) ? e.value : null;
      const r = { value, diff: null, dir: null, rank: null, base: 0, bonus: 0, joker: !!(o.jokers && o.jokers.includes(e.id)), hit: false, points: 0 };
      if (value != null) {
        r.diff = tidy(Math.abs(value - answer));
        r.dir = r.diff < EPS ? 'exact' : value > answer ? 'over' : 'under';
        r.hit = isHit(r.diff, answer, year);
      }
      out[e.id] = r;
    }
    const valid = entries.map((e) => out[e.id]).filter((r) => r.value != null);
    for (const r of valid) {
      r.rank = 1 + valid.filter((x) => x.diff < r.diff - EPS).length;
      if (mode === 'rank') {
        r.base = entries.filter((e) => out[e.id].value == null || out[e.id].diff > r.diff + EPS).length;
        r.bonus = o.bonus !== false && r.hit ? HIT_BONUS : 0;
      } else {
        r.base = accuracyPoints(r.diff, answer, year);
      }
      r.points = (r.base + r.bonus) * (r.joker ? 2 : 1);
    }
    return out;
  }

  /** Median (bei gerader Anzahl der Mittelwert der beiden mittleren Werte) */
  function median(values, year) {
    const v = values.filter(finite).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = v.length >> 1;
    const r = v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    return year ? Math.round(r) : tidy(r);
  }

  /** Antwort einer „Über uns“-Frage aus den Antworten der Personen */
  function aggregate(agg, values) {
    const v = values.filter(finite);
    if (agg === 'count') return v.filter((x) => x > 0).length;
    return tidy(v.reduce((s, x) => s + x, 0));
  }

  function baseTeams() {
    return TEAMS.map((t, i) => ({
      id: t.id,
      label: t.label,
      color: t.color,
      name: 'Team ' + t.label,
      active: i < 2,
      solo: false,
      players: [],
      score: 0,
      jokerUsed: false,
    }));
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
      this.timer = null;
      // Nach einem Neuladen: inzwischen abgelaufene Zeitlimits gleich auswerten
      this.tick();
      this.armTimer();
    }

    /**
     * Neues Spiel aus dem Setup.
     * @param {{settings: object, teams?: {id, active, name}[], players?: string[]}} config
     *   players: Namen bei „Jeder für sich“ ohne Handy. Ohne Handy startet das Spiel sofort,
     *   mit Handy beginnt es in der Lobby.
     */
    static create(config, hooks) {
      const settings = sanitizeSettings(config.settings);
      const state = {
        v: 1,
        game: GAME,
        settings,
        phase: 'lobby',
        teams: [],
        members: {},
        order: [],
        round: 0,
        tiebreak: null,
        cur: null,
        history: [],
        used: [],
        winners: [],
        awards: [],
        nextSolo: 1,
        startedAt: null,
      };
      if (settings.solo) {
        if (settings.input === 'say') {
          const names = (config.players || []).slice(0, MAX_PLAYERS);
          while (names.length < 1) names.push('');
          const e = new Engine(state, { timers: false });
          names.forEach((n, i) => e.addSoloTeam('p' + (i + 1), cleanName(n, 'Spieler ' + (i + 1))));
        }
      } else {
        state.teams = baseTeams();
        for (const t of state.teams) {
          const cfg = (config.teams || []).find((c) => c.id === t.id);
          t.active = !!(cfg && cfg.active);
          if (cfg) t.name = cleanName(cfg.name, 'Team ' + t.label);
        }
        if (!state.teams.some((t) => t.active)) state.teams[0].active = true;
      }
      if (settings.input === 'say') new Engine(state, Object.assign({ timers: false }, hooks)).startGame();
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

    get solo() {
      return !!this.s.settings.solo;
    }

    /** Wie gibt ein Team seinen Tipp ab? Bei „Jeder für sich“ ist jedes „Team“ eine Person. */
    get teamInput() {
      return this.solo ? 'shared' : this.s.settings.teamInput;
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

    /** Ohne Handy: Das Team, das anfängt, wechselt mit jeder Frage */
    sayQueue(playing) {
      const k = (this.s.round - 1) % playing.length;
      return playing.slice(k).concat(playing.slice(0, k));
    }

    /** Kennung der aktuellen Frage – verhindert, dass verspätete Eingaben bei der nächsten landen */
    stepKey() {
      const cur = this.s.cur;
      return cur ? `${cur.no}-${cur.qNo}` : null;
    }

    year() {
      return !!(this.s.cur && N.isYear(this.s.cur.q.unit));
    }

    /** Schätzungen bei Jahreszahlen auf ganze Jahre runden */
    fit(v) {
      return v != null && this.year() ? Math.round(v) : v;
    }

    addSoloTeam(pid, name) {
      const s = this.s;
      const used = new Set(s.teams.filter((t) => t.active).map((t) => t.color));
      const color = SOLO_COLORS.find((c) => !used.has(c)) || SOLO_COLORS[(s.nextSolo - 1) % SOLO_COLORS.length];
      const team = {
        id: 's' + s.nextSolo++,
        label: '',
        color,
        name,
        active: true,
        solo: true,
        players: [{ id: pid, name }],
        score: 0,
        jokerUsed: false,
      };
      s.teams.push(team);
      return team;
    }

    /** „Jeder für sich“: Personen ohne Gerät/Verbindung fliegen raus (in der Lobby ganz, im Spiel aus der Wertung) */
    dropEmptySolo() {
      const s = this.s;
      const empty = s.teams.filter((t) => t.solo && !t.players.length).map((t) => t.id);
      if (!empty.length) return;
      if (s.phase === 'lobby') s.teams = s.teams.filter((t) => !empty.includes(t.id));
      else {
        for (const t of s.teams) if (empty.includes(t.id)) t.active = false;
        s.order = s.order.filter((id) => !empty.includes(id));
        if (s.tiebreak) s.tiebreak = s.tiebreak.filter((id) => !empty.includes(id));
        if (s.cur && s.phase === 'question') s.cur.teams = s.cur.teams.filter((id) => !empty.includes(id));
      }
    }

    /* ---------- Verbindungen (mit Handy) ---------- */

    connect(pid, name) {
      const s = this.s;
      const m = s.members[pid];
      if (m) {
        m.online = true;
        delete m.offlineAt;
        if (name) m.name = cleanName(name, m.name);
      } else {
        s.members[pid] = { name: cleanName(name, 'Gast'), online: true };
      }
      const nm = s.members[pid].name;
      for (const t of s.teams) {
        for (const p of t.players) {
          if (p.id !== pid) continue;
          p.name = nm;
          if (t.solo) t.name = nm;
        }
      }
      // „Jeder für sich“: In der Lobby ist jede/r automatisch dabei
      if (this.solo && s.phase === 'lobby' && !this.teamOf(pid) && s.teams.length < MAX_PLAYERS) this.addSoloTeam(pid, nm);
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
      s.order = s.teams.filter((t) => t.active && (!this.write || t.players.length)).map((t) => t.id);
      for (const t of s.teams) {
        t.score = 0;
        t.jokerUsed = false;
      }
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
      if (!s.order.length) {
        this.finish();
        return;
      }
      if (s.round >= s.settings.questions) {
        const tied = this.leaders(s.tiebreak || s.order);
        if (tied.length > 1) s.tiebreak = tied;
        else {
          this.finish();
          return;
        }
      }
      s.round += 1;
      s.cur = { no: s.round, qNo: 0, tiebreak: !!s.tiebreak, teams: (s.tiebreak || s.order).slice(), jokers: [] };
      this.setupQuestion();
      s.phase = 'question';
    }

    /** Frage ziehen und Eingaben zurücksetzen (auch beim Überspringen einer Frage) */
    setupQuestion() {
      const s = this.s;
      const cur = s.cur;
      // Im Stechen keine „Über uns“-Fragen – da schätzen ja nur noch die führenden Teams
      const cats = cur.tiebreak ? s.settings.categories.filter((c) => c !== 'uns') : s.settings.categories;
      cur.q = Deck.draw(cats, s.used, { random: this.hooks.random });
      cur.jokers = [];
      cur.answer = null;
      cur.results = null;
      if (this.write) {
        cur.participants = {};
        cur.guesses = {};
        cur.votes = {};
        for (const id of cur.teams) {
          cur.participants[id] = this.team(id).players.map((p) => p.id);
          cur.guesses[id] = { text: '', draft: null, by: null, value: null, locked: false };
          cur.votes[id] = {};
        }
        cur.own = {};
        this.startClock(cur);
      } else {
        cur.queue = this.sayQueue(cur.teams);
        cur.idx = 0;
        cur.team = cur.queue[0];
        cur.said = {};
      }
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

    /** Wertung dieser Frage: im Stechen nur der Rang, mit nur einem Team die Genauigkeit */
    roundOpts() {
      const s = this.s;
      const cur = s.cur;
      const year = this.year();
      if (cur.tiebreak) return { mode: 'rank', bonus: false, jokers: [], year };
      return {
        mode: cur.teams.length < 2 ? 'accuracy' : s.settings.scoring,
        bonus: true,
        jokers: s.settings.joker ? cur.jokers.slice() : [],
        year,
      };
    }

    /** Alle Personen, die bei dieser Frage mitspielen */
    allParticipants() {
      const cur = this.s.cur;
      return cur.teams.flatMap((id) => cur.participants[id] || []);
    }

    teamValue(id) {
      const cur = this.s.cur;
      if (!this.write) return finite(cur.said[id]) ? cur.said[id] : null;
      if (this.teamInput === 'median') return median(Object.values(cur.votes[id] || {}), this.year());
      const g = cur.guesses[id];
      if (!g) return null;
      if (g.locked) return g.value;
      return finite(g.draft) ? g.draft : null;
    }

    /** Hat das Team seinen Tipp abgegeben? (bzw. wird auf niemanden mehr gewartet) */
    teamDone(id) {
      const cur = this.s.cur;
      const pids = cur.participants[id] || [];
      if (this.teamInput === 'median') {
        const votes = cur.votes[id] || {};
        return pids.every((pid) => votes[pid] !== undefined || !this.awaited(pid));
      }
      return cur.guesses[id].locked || !pids.some((pid) => this.awaited(pid));
    }

    /** Mit Handy: Haben alle geschätzt (und bei „Über uns“ alle von sich erzählt)? */
    questionComplete() {
      const s = this.s;
      const cur = s.cur;
      if (!cur.teams.every((id) => this.teamDone(id))) return false;
      if (cur.q.kind === 'uns' && this.allParticipants().some((pid) => cur.own[pid] === undefined && this.awaited(pid))) return false;
      // Mindestens ein Tipp muss da sein – sonst wartet der Laptop auf „Jetzt aufdecken“
      return cur.teams.some((id) => this.teamValue(id) != null);
    }

    evaluate() {
      const s = this.s;
      const cur = s.cur;
      const q = cur.q;
      let answer = q.answer;
      if (q.kind === 'uns') {
        if (this.write) {
          answer = aggregate(q.agg, Object.values(cur.own));
          cur.ownCount = { answered: Object.keys(cur.own).length, total: this.allParticipants().length };
        } else answer = cur.answer;
      }
      const opts = this.roundOpts();
      const results = scoreRound(
        cur.teams.map((id) => ({ id, value: this.teamValue(id) })),
        answer,
        opts
      );
      for (const id of cur.teams) {
        const r = results[id];
        this.team(id).score += r.points;
        if (r.joker) this.team(id).jokerUsed = true;
        if (this.write && this.teamInput === 'median') {
          r.members = Object.entries(cur.votes[id] || {}).map(([pid, value]) => ({ pid, name: this.playerName(pid), value }));
        }
      }
      cur.answer = answer;
      cur.results = results;
      cur.mode = opts.mode;
      cur.timerEnd = null;
      s.phase = 'reveal';
    }

    pushHistory() {
      const cur = this.s.cur;
      this.s.history.push({
        no: cur.no,
        tiebreak: cur.tiebreak,
        teams: cur.teams.slice(),
        q: clone(cur.q),
        answer: cur.answer,
        results: clone(cur.results),
      });
    }

    /** Mit Handy: prüfen, ob alle fertig sind (z.B. nachdem jemand gegangen ist) */
    checkProgress() {
      const s = this.s;
      if (s.phase !== 'question' || !s.cur || !this.write) return;
      if (this.questionComplete()) this.evaluate();
    }

    /* ---------- Zeitlimit (mit Handy) ---------- */

    nextDeadline() {
      const s = this.s;
      if (s.phase !== 'question' || !s.cur || !this.write) return null;
      const ends = [];
      if (s.cur.timerEnd) ends.push(s.cur.timerEnd);
      for (const m of Object.values(s.members)) if (!m.online && m.offlineAt) ends.push(m.offlineAt + GRACE_MS);
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

    /** Abgelaufene Zeitlimits auswerten. Gibt true zurück, wenn sich etwas geändert hat. */
    tick() {
      const s = this.s;
      if (s.phase !== 'question' || !s.cur || !this.write) return false;
      const before = this.progressSig();
      if (s.cur.timerEnd && s.cur.timerEnd <= this.now()) this.evaluate();
      // Schonfrist für getrennte Spieler abgelaufen? Dann ohne sie weiter
      else this.checkProgress();
      return this.progressSig() !== before;
    }

    progressSig() {
      const s = this.s;
      return s.cur ? `${s.phase}|${s.cur.no}|${s.cur.qNo}` : s.phase;
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
      if (!m || s.phase === 'over') return false;
      if (this.solo) {
        const mine = this.teamOf(actor);
        if (s.phase === 'lobby') {
          if (!a.team && mine) {
            s.teams = s.teams.filter((t) => t !== mine);
            return true;
          }
          if (a.team && !mine && s.teams.length < MAX_PLAYERS) {
            this.addSoloTeam(actor, m.name);
            return true;
          }
          return false;
        }
        // Im laufenden Spiel einsteigen: ab der nächsten Frage dabei
        if (mine || !a.team || s.order.length >= MAX_PLAYERS) return false;
        const t = this.addSoloTeam(actor, m.name);
        s.order.push(t.id);
        return true;
      }
      const target = a.team ? this.team(a.team) : null;
      if (target && (!target.active || target.players.length >= MAX_PLAYERS)) return false;
      if (s.phase === 'lobby') {
        for (const t of s.teams) t.players = t.players.filter((p) => p.id !== actor);
        if (target) target.players.push({ id: actor, name: m.name });
        return true;
      }
      // Im laufenden Spiel darf man noch einem mitspielenden Team beitreten (ab der nächsten Frage dabei)
      if (!target || !s.order.includes(target.id) || this.teamOf(actor)) return false;
      target.players.push({ id: actor, name: m.name });
      return true;
    }

    on_kick(a, actor) {
      const s = this.s;
      if (actor !== STAGE || !this.write || !s.members[a.player]) return false;
      for (const t of s.teams) t.players = t.players.filter((p) => p.id !== a.player);
      delete s.members[a.player];
      if (s.cur && s.cur.participants) {
        for (const id of Object.keys(s.cur.participants)) s.cur.participants[id] = s.cur.participants[id].filter((p) => p !== a.player);
      }
      if (this.solo) this.dropEmptySolo();
      if (this.hooks.onKick) this.hooks.onKick(a.player);
      if (s.phase !== 'lobby' && s.phase !== 'over' && !s.order.length) this.finish();
      else this.checkProgress();
      return true;
    }

    on_teamName(a, actor) {
      if (actor !== STAGE) return false;
      const t = this.team(a.team);
      if (!t || t.solo) return false;
      t.name = cleanName(a.name, 'Team ' + t.label);
      return true;
    }

    on_teamActive(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby' || this.solo) return false;
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
      // Spielweise und „Jeder für sich“ stehen fest, sobald der Raum offen ist
      s.settings = sanitizeSettings(Object.assign({}, a.settings, { input: s.settings.input, solo: s.settings.solo }), s.settings);
      return true;
    }

    lobbyProblem() {
      const online = (t) => t.players.filter((p) => this.isOnline(p.id)).length;
      if (this.solo) return this.s.teams.some((t) => online(t)) ? null : 'Noch niemand dabei – scannt den QR-Code!';
      if (!this.s.teams.some((t) => t.active && online(t))) return 'Mindestens ein Team braucht einen Spieler.';
      return null;
    }

    on_start(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby' || this.lobbyProblem()) return false;
      for (const t of s.teams) t.players = t.players.filter((p) => this.isOnline(p.id));
      if (this.solo) this.dropEmptySolo();
      this.startGame();
      return true;
    }

    /* Schätzen (mit Handy) */

    /** Gibt das Team des Spielers zurück, wenn er bei der aktuellen Frage mitschätzen darf */
    playing(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!this.write || s.phase !== 'question' || !cur || actor === STAGE) return null;
      if (a.at !== undefined && a.at !== this.stepKey()) return null;
      const team = this.teamOf(actor);
      if (!team || !cur.teams.includes(team.id) || !(cur.participants[team.id] || []).includes(actor)) return null;
      return team;
    }

    /** Gemeinsames Feld: Der Text, den gerade jemand im Team tippt (alle im Team sehen ihn live) */
    on_draft(a, actor) {
      const team = this.playing(a, actor);
      if (!team || this.teamInput !== 'shared') return false;
      const g = this.s.cur.guesses[team.id];
      if (g.locked) return false;
      const text = cleanName(a.text, '', MAX_TEXT);
      if (text === g.text) return false;
      g.text = text;
      g.draft = this.fit(N.parse(text));
      g.by = actor;
      return true;
    }

    on_lock(a, actor) {
      const team = this.playing(a, actor);
      const value = this.fit(toNumber(a.value));
      if (!team || value == null) return false;
      const cur = this.s.cur;
      if (this.teamInput === 'shared') {
        const g = cur.guesses[team.id];
        if (g.locked) return false;
        Object.assign(g, { value, draft: value, locked: true, by: actor });
        if (typeof a.value === 'string') g.text = cleanName(a.value, '', MAX_TEXT);
      } else {
        cur.votes[team.id][actor] = value;
      }
      this.checkProgress();
      return true;
    }

    on_unlock(a, actor) {
      const team = this.playing(a, actor);
      if (!team) return false;
      const cur = this.s.cur;
      if (this.teamInput === 'shared') {
        const g = cur.guesses[team.id];
        if (!g.locked) return false;
        g.locked = false;
        g.by = actor;
        return true;
      }
      if (cur.votes[team.id][actor] === undefined) return false;
      delete cur.votes[team.id][actor];
      return true;
    }

    /** „Über uns“: eigene Antwort (Zahl bzw. Ja = 1 / Nein = 0) */
    on_own(a, actor) {
      const team = this.playing(a, actor);
      const cur = this.s.cur;
      if (!team || cur.q.kind !== 'uns') return false;
      let value;
      if (cur.q.agg === 'count') {
        if (typeof a.value !== 'boolean') return false;
        value = a.value ? 1 : 0;
      } else {
        value = toNumber(a.value);
        if (value == null || value < 0 || value > MAX_OWN) return false;
      }
      cur.own[actor] = value;
      this.checkProgress();
      return true;
    }

    on_unown(a, actor) {
      const team = this.playing(a, actor);
      const cur = this.s.cur;
      if (!team || cur.q.kind !== 'uns' || cur.own[actor] === undefined) return false;
      delete cur.own[actor];
      return true;
    }

    /** Joker an/aus – vom Handy für das eigene Team, vom Laptop für ein beliebiges Team */
    on_joker(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!s.settings.joker || s.phase !== 'question' || !cur || cur.tiebreak) return false;
      if (a.at !== undefined && a.at !== this.stepKey()) return false;
      let team;
      if (actor === STAGE) team = this.team(a.team);
      else {
        team = this.playing(a, actor);
        if (!team && !this.write) return false;
      }
      if (!team || !cur.teams.includes(team.id)) return false;
      if (cur.jokers.includes(team.id)) cur.jokers = cur.jokers.filter((id) => id !== team.id);
      else if (!team.jokerUsed) cur.jokers.push(team.id);
      else return false;
      return true;
    }

    /* Schätzen (ohne Handy, reihum am Laptop eingetragen) */

    on_say(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (actor !== STAGE || this.write || s.phase !== 'question' || !cur || !cur.team) return false;
      if (a.team !== undefined && a.team !== cur.team) return false;
      const value = this.fit(toNumber(a.value));
      if (value == null) return false;
      // Jede Zahl darf nur einmal genannt werden
      if (Object.values(cur.said).some((v) => Math.abs(v - value) < EPS)) return false;
      cur.said[cur.team] = value;
      cur.idx += 1;
      if (cur.idx < cur.queue.length) {
        cur.team = cur.queue[cur.idx];
        return true;
      }
      cur.team = null;
      if (cur.q.kind === 'uns') s.phase = 'count';
      else this.evaluate();
      return true;
    }

    on_undo(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (actor !== STAGE || this.write || !cur || !['question', 'count'].includes(s.phase) || cur.idx < 1) return false;
      cur.idx -= 1;
      cur.team = cur.queue[cur.idx];
      delete cur.said[cur.team];
      s.phase = 'question';
      return true;
    }

    /** „Über uns“ ohne Handy: Die durchgezählte Antwort wird eingetragen */
    on_count(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (actor !== STAGE || s.phase !== 'count' || !cur) return false;
      const value = toNumber(a.value);
      if (value == null || value < 0) return false;
      cur.answer = value;
      this.evaluate();
      return true;
    }

    /* Steuerung (Laptop) */

    on_skip(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (actor !== STAGE || !cur || !['question', 'count'].includes(s.phase)) return false;
      cur.qNo += 1;
      this.setupQuestion();
      s.phase = 'question';
      return true;
    }

    /** Frage sofort auswerten (z.B. wenn jemand nicht mehr antwortet) */
    on_finishRound(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'question' || !s.cur || !this.write) return false;
      this.evaluate();
      return true;
    }

    on_next(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (actor !== STAGE || !cur || s.phase !== 'reveal') return false;
      if (a.no !== undefined && a.no !== cur.no) return false;
      this.pushHistory();
      this.nextRound();
      return true;
    }

    on_end(a, actor) {
      if (actor !== STAGE || this.s.phase === 'lobby' || this.s.phase === 'over') return false;
      if (this.s.phase === 'reveal') this.pushHistory();
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
        for (const t of s.teams) {
          t.score = 0;
          t.jokerUsed = false;
        }
        if (this.solo) {
          s.teams = s.teams.filter((t) => t.active && t.players.length);
          for (const t of s.teams) t.players = t.players.filter((p) => s.members[p.id]);
          s.teams = s.teams.filter((t) => t.players.length);
        }
      } else this.startGame();
      return true;
    }

    /* ---------- Auszeichnungen ---------- */

    computeAwards() {
      const s = this.s;
      const out = [];
      const name = (id) => (this.team(id) || {}).name || '?';
      const hits = {};
      const over = {};
      const under = {};
      let worst = null;
      const bestGuesser = {};
      const inc = (obj, id) => (obj[id] = (obj[id] || 0) + 1);
      for (const h of s.history) {
        if (!h.results) continue;
        let best = null;
        for (const [id, r] of Object.entries(h.results)) {
          if (r.value == null) continue;
          if (r.hit) inc(hits, id);
          if (r.dir === 'over' && !r.hit) inc(over, id);
          if (r.dir === 'under' && !r.hit) inc(under, id);
          if (r.value > 0 && h.answer > 0) {
            const ratio = Math.max(r.value / h.answer, h.answer / r.value);
            if (!worst || ratio > worst.ratio) worst = { id, ratio, text: h.q.text };
          }
          for (const m of r.members || []) {
            const d = Math.abs(m.value - h.answer);
            if (!best || d < best.d) best = { d, name: m.name, tie: false };
            else if (Math.abs(d - best.d) < EPS && m.name !== best.name) best.tie = true;
          }
        }
        if (best && !best.tie) inc(bestGuesser, best.name);
      }
      const top = (obj, min) => {
        const e = Object.entries(obj).sort((a, b) => b[1] - a[1]);
        return e.length && e[0][1] >= min && (e.length < 2 || e[1][1] < e[0][1]) ? e[0] : null;
      };
      const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
      const h = top(hits, 1);
      if (h) out.push({ icon: '🎯', title: 'Scharfschützen', text: `${name(h[0])} – ${plural(h[1], 'Volltreffer', 'Volltreffer')}` });
      const o = top(over, 3);
      if (o) out.push({ icon: '📈', title: 'Optimisten', text: `${name(o[0])} – ${o[1]}× zu hoch geschätzt` });
      const u = top(under, 3);
      if (u) out.push({ icon: '📉', title: 'Tiefstapler', text: `${name(u[0])} – ${u[1]}× zu niedrig geschätzt` });
      if (worst && worst.ratio >= 3) {
        const f = worst.ratio >= 10 ? String(Math.round(worst.ratio)) : worst.ratio.toFixed(1).replace('.', ',');
        out.push({ icon: '🔭', title: 'Weit daneben', text: `${name(worst.id)} – Faktor ${f} bei „${worst.text}“` });
      }
      const b = top(bestGuesser, 2);
      if (b) out.push({ icon: '🧠', title: 'Bauchgefühl-Profi', text: `${b[0]} – ${b[1]}× die beste Einzelschätzung` });
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
      const revealed = s.phase === 'reveal';
      const q = cur.q;
      const v = {
        no: cur.no,
        qNo: cur.qNo,
        tiebreak: cur.tiebreak,
        teams: cur.teams.slice(),
        jokers: cur.jokers.slice(),
        q: { key: q.key, cat: q.cat, kind: q.kind, text: q.text, unit: q.unit, agg: q.agg || null, ask: q.ask || null },
      };
      if (revealed) {
        Object.assign(v.q, { answer: q.answer, fact: q.fact || '' });
        Object.assign(v, { answer: cur.answer, results: clone(cur.results), mode: cur.mode, ownCount: clone(cur.ownCount) || null });
      }
      if (!this.write) {
        Object.assign(v, { queue: cur.queue.slice(), idx: cur.idx, team: cur.team, said: clone(cur.said) });
        return v;
      }
      v.timer = s.phase === 'question' ? this.timerView(cur) : null;
      v.participants = clone(cur.participants);
      v.status = {};
      for (const id of cur.teams) {
        const g = cur.guesses[id];
        v.status[id] = {
          locked: this.teamInput === 'shared' ? g.locked : this.teamDone(id) && Object.keys(cur.votes[id]).length > 0,
          typing: !!g.text,
          voted: Object.keys(cur.votes[id] || {}),
        };
      }
      v.ownDone = Object.keys(cur.own || {});
      const myTeam = viewer === STAGE ? null : this.teamOf(viewer);
      if (myTeam && cur.teams.includes(myTeam.id) && s.phase === 'question') {
        const g = cur.guesses[myTeam.id];
        v.mine = {
          participant: (cur.participants[myTeam.id] || []).includes(viewer),
          text: g.text,
          draft: g.draft,
          value: g.value,
          locked: g.locked,
          by: g.by ? this.playerName(g.by) : null,
          byMe: g.by === viewer,
          vote: cur.votes[myTeam.id][viewer] !== undefined ? cur.votes[myTeam.id][viewer] : null,
          own: cur.own[viewer] !== undefined ? cur.own[viewer] : null,
        };
      }
      return v;
    }

    viewFor(viewer) {
      const s = this.s;
      const stage = viewer === STAGE;
      const myTeam = stage ? null : this.teamOf(viewer);
      return {
        game: GAME,
        phase: s.phase,
        settings: Object.assign({}, s.settings, { categories: s.settings.categories.slice() }),
        teamInput: this.teamInput,
        round: s.round,
        questions: s.settings.questions,
        tiebreak: s.tiebreak ? s.tiebreak.slice() : null,
        order: s.order.slice(),
        teams: s.teams.map((t) => ({
          id: t.id,
          label: t.label,
          name: t.name,
          color: t.color,
          active: t.active,
          solo: !!t.solo,
          score: t.score,
          jokerUsed: !!t.jokerUsed,
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
              stepKey: this.stepKey(),
            },
      };
    }
  }

  root.PMDEngine = {
    Engine,
    GAME,
    STAGE,
    TEAMS,
    SOLO_COLORS,
    QUESTION_OPTIONS,
    SECONDS_OPTIONS,
    DEFAULT_SETTINGS,
    HIT_BONUS,
    HIT_PERCENT,
    ACCURACY_STEPS,
    MAX_PLAYERS,
    MAX_TEXT,
    GRACE_MS,
    sanitizeSettings,
    scoreRound,
    median,
    aggregate,
    cleanName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
