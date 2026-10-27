/*
 * Spiellogik von „Stadt, Land, Fluss“.
 *
 * Ein Buchstabe wird gezogen (jeder nur einmal pro Spiel, ohne Q/X/Y abschaltbar), alle füllen ihre Kategorien.
 * Wer alles ausgefüllt hat, darf „Stopp!“ rufen – dann haben alle noch 3 Sekunden. Alternativ feste Zeit (oder beides).
 *
 * Zwei Spielweisen:
 *  - phones: Laptop = Bühne, geschrieben wird auf den Handys. Ablauf je Runde:
 *            (draw) → write → grace → review (Kategorie für Kategorie, Gruppe stimmt mit 👎 ab) → scores
 *  - one:    ein Gerät, geschrieben wird auf Papier. Ablauf: (draw) → write → grace → tally (Punkte eintragen) → scores
 * draw gibt es nur bei „ABC im Kopf“: Das Alphabet läuft, bis jemand Stopp drückt.
 *
 * Punkte je Kategorie: einzige Person mit gültiger Antwort 20 · einzigartig 10 · doppelt 5 · leer/ungültig 0
 * (einfach: 10 / 10 / 5). Gültig ist, was mit dem Buchstaben beginnt und nicht mehrheitlich weggestimmt wurde;
 * bei Gleichstand entscheidet die Spielleitung (sonst zählt die Antwort). Die Spielleitung kann alles überstimmen.
 *
 * Gefilterte Ansichten: Während des Schreibens sieht jedes Handy nur die eigenen Antworten, die Bühne nur den Füllstand.
 */
(function (root) {
  'use strict';

  const Answers = root.SLFAnswers;
  const Kat = root.SLFKategorien;

  const GAME = 'stadt-land-fluss';
  const STAGE = 'stage';
  const PLAYER_COLORS = ['#f59e0b', '#38bdf8', '#a855f7', '#22c55e', '#ef4444', '#ec4899', '#14b8a6', '#facc15', '#84cc16', '#f97316', '#818cf8', '#e5e7eb'];
  const INPUTS = ['phones', 'one'];
  const ROUND_OPTIONS = [5, 8, 10];
  const END_OPTIONS = ['stop', 'time', 'both'];
  const TIME_OPTIONS = [60, 90, 120, 180];
  const CAT_MODES = ['standard', 'pick', 'random'];
  const SCORINGS = {
    '20-10-5': { solo: 20, unique: 10, dupe: 5 },
    '10-5': { solo: 10, unique: 10, dupe: 5 },
  };
  const VOTES = ['doubt', 'all'];
  const DRAWS = ['random', 'abc'];
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const HARD_LETTERS = ['Q', 'X', 'Y'];
  const DEFAULT_SETTINGS = {
    input: 'phones',
    rounds: 8,
    end: 'both',
    time: 120,
    catMode: 'standard',
    cats: Kat.STANDARD.slice(),
    packs: ['klassisch'],
    custom: [],
    hard: false,
    umlauts: true,
    scoring: '20-10-5',
    vote: 'doubt',
    drinks: false,
    draw: 'random',
  };
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 12;
  const MIN_CATS = 3;
  const MAX_CATS = 12;
  const MAX_CUSTOM = 30;
  const PER_ROUND = 6; // Zufalls-Modus: so viele Kategorien pro Runde
  const GRACE_STOP_MS = 3000; // Nachspielzeit nach „Stopp!“
  const GRACE_TIME_MS = 1200; // Zeit um: kurz warten, bis die letzten Eingaben der Handys da sind
  const SIPS_ZERO = 1; // Trinkregeln: 0 Punkte in einer Kategorie
  const SIPS_STOP = 2; // Trinkregeln: Stopp gerufen und trotzdem einen Fehler

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
    const num = (v) => (v === null || v === '' || v === undefined ? NaN : +v);
    if (INPUTS.includes(i.input)) s.input = i.input;
    if (ROUND_OPTIONS.includes(num(i.rounds))) s.rounds = num(i.rounds);
    if (END_OPTIONS.includes(i.end)) s.end = i.end;
    if (TIME_OPTIONS.includes(num(i.time))) s.time = num(i.time);
    if (CAT_MODES.includes(i.catMode)) s.catMode = i.catMode;
    if (SCORINGS[i.scoring]) s.scoring = i.scoring;
    if (VOTES.includes(i.vote)) s.vote = i.vote;
    if (DRAWS.includes(i.draw)) s.draw = i.draw;
    for (const k of ['hard', 'umlauts', 'drinks']) if (typeof i[k] === 'boolean') s[k] = i[k];
    if (Array.isArray(i.cats)) s.cats = Kat.cleanList(i.cats, MAX_CATS);
    if (Array.isArray(i.custom)) s.custom = Kat.cleanList(i.custom, MAX_CUSTOM);
    if (Array.isArray(i.packs)) {
      const ids = Kat.PACKS.map((p) => p.id).concat(Kat.CUSTOM_PACK.id);
      s.packs = [...new Set(i.packs.filter((id) => ids.includes(id)))];
    }
    s.cats = Array.isArray(s.cats) && s.cats.length ? s.cats.slice() : Kat.STANDARD.slice();
    s.custom = Array.isArray(s.custom) ? s.custom.slice() : [];
    s.packs = Array.isArray(s.packs) ? s.packs.slice() : ['klassisch'];
    return s;
  }

  /** Kategorien-Vorrat für den Zufalls-Modus */
  function catPool(settings) {
    return Kat.pool(settings.packs, settings.custom);
  }

  /** Was stimmt mit den Kategorien nicht? (null = passt) */
  function catProblem(settings) {
    if (settings.catMode === 'pick' && settings.cats.length < MIN_CATS) return `Wählt mindestens ${MIN_CATS} Kategorien aus.`;
    if (settings.catMode === 'random' && catPool(settings).length < MIN_CATS) return `Wählt Pakete mit mindestens ${MIN_CATS} Kategorien.`;
    return null;
  }

  /** Buchstaben, die gezogen werden können */
  function letterPool(settings) {
    return LETTERS.filter((l) => settings.hard || !HARD_LETTERS.includes(l));
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
      this.random = this.hooks.random || Math.random;
      this.timer = null;
      this.tick();
      this.armTimer();
    }

    /**
     * Neues Spiel aus dem Setup.
     * @param {{settings: object, players?: string[]}} config  players: Namen bei „Ein Gerät“ (das Spiel startet sofort)
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
        round: 0,
        letter: null,
        used: [],
        cats: [],
        answers: {},
        stopBy: null,
        stopAt: null,
        writeStart: null,
        writeEnd: null,
        graceEnd: null,
        graceReason: null,
        review: null,
        tally: null,
        history: [],
        awards: [],
        startedAt: null,
        endedAt: null,
      };
      if (settings.input === 'one') {
        const names = (config.players || []).map((n, i) => cleanName(n, 'Spieler ' + (i + 1))).slice(0, MAX_PLAYERS);
        names.forEach((name, i) => state.players.push(Engine.newPlayer('p' + (i + 1), name)));
        new Engine(state, Object.assign({}, hooks, { timers: false })).startGame();
      }
      return state;
    }

    static newPlayer(id, name) {
      return { id, name, score: 0, stats: { stops: 0, solo: 0, unique: 0, dupe: 0, vetoed: 0, zero: 0 } };
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

    get points() {
      return SCORINGS[this.s.settings.scoring] || SCORINGS['20-10-5'];
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

    isOnline(pid) {
      if (!this.write) return !!this.player(pid);
      const m = this.s.members[pid];
      return !!(m && m.online);
    }

    /** Spielleitung am Handy: das am längsten verbundene Handy, das mitspielt */
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
      return actor === STAGE || (actor && actor === this.leadPid());
    }

    /** Aktion gehört zur laufenden Runde? (a.round weglassen = egal) */
    current(a) {
      return a.round === undefined || a.round === this.s.round;
    }

    answersOf(pid) {
      const list = this.s.answers[pid] || [];
      return this.s.cats.map((_, i) => list[i] || '');
    }

    /** Hat die Person alle Kategorien ausgefüllt? */
    complete(pid) {
      return this.answersOf(pid).every((t) => Answers.clean(t));
    }

    filled(pid) {
      return this.answersOf(pid).filter((t) => Answers.clean(t)).length;
    }

    letterOk(text) {
      return Answers.startsWith(text, this.s.letter, { umlauts: this.s.settings.umlauts });
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
      // Wer dazukommt, spielt mit (mitten in der Runde: ab sofort, mit 0 Punkten)
      else if (s.phase !== 'end' && s.players.length < MAX_PLAYERS) s.players.push(Engine.newPlayer(pid, s.members[pid].name));
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
      s.round = 0;
      s.used = [];
      s.history = [];
      s.awards = [];
      s.startedAt = this.now();
      s.endedAt = null;
      for (const p of s.players) {
        const fresh = Engine.newPlayer(p.id, p.name);
        p.score = 0;
        p.stats = fresh.stats;
      }
      this.startRound();
    }

    /** Kategorien der Runde: fest, oder im Zufalls-Modus 6 neue (möglichst nicht dieselben wie zuletzt) */
    roundCats() {
      const st = this.s.settings;
      if (st.catMode === 'standard') return Kat.STANDARD.slice();
      if (st.catMode === 'pick') return st.cats.slice(0, MAX_CATS);
      const pool = catPool(st);
      if (pool.length <= PER_ROUND) return pool;
      const last = new Set((this.s.cats || []).map((c) => c.toLowerCase()));
      const fresh = pool.filter((c) => !last.has(c.toLowerCase()));
      const pickFrom = (list, n) => {
        const a = list.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(this.random() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a.slice(0, n);
      };
      const out = pickFrom(fresh, PER_ROUND);
      if (out.length < PER_ROUND) out.push(...pickFrom(pool.filter((c) => !out.includes(c)), PER_ROUND - out.length));
      // Reihenfolge wie in den Paketen (Stadt vor Land …)
      return pool.filter((c) => out.includes(c));
    }

    /** Freie Buchstaben (sind alle durch, geht es von vorn los) */
    freeLetters() {
      const s = this.s;
      const pool = letterPool(s.settings);
      let free = pool.filter((l) => !s.used.includes(l));
      if (!free.length) {
        s.used = [];
        free = pool;
      }
      return free;
    }

    drawLetter() {
      const free = this.freeLetters();
      return free[Math.floor(this.random() * free.length)];
    }

    startRound() {
      const s = this.s;
      s.round += 1;
      s.cats = this.roundCats();
      s.letter = null;
      s.answers = {};
      s.review = null;
      s.tally = null;
      s.stopBy = null;
      s.stopAt = null;
      s.writeStart = null;
      s.writeEnd = null;
      s.graceEnd = null;
      s.graceReason = null;
      if (s.settings.draw === 'abc') s.phase = 'draw';
      else this.startWriting(this.drawLetter());
    }

    startWriting(letter) {
      const s = this.s;
      s.letter = letter;
      if (!s.used.includes(letter)) s.used.push(letter);
      s.phase = 'write';
      s.writeStart = this.now();
      s.writeEnd = s.settings.end === 'stop' ? null : s.writeStart + s.settings.time * 1000;
    }

    /** Stopp oder Zeit um: Nachspielzeit (bei „Zeit um“ nur kurz für die letzten Eingaben) */
    startGrace(reason, by) {
      const s = this.s;
      s.phase = 'grace';
      s.graceReason = reason;
      s.graceEnd = this.now() + (reason === 'time' ? GRACE_TIME_MS : GRACE_STOP_MS);
      s.stopBy = by || null;
      s.stopAt = this.now();
      s.writeEnd = null;
      if (by && this.player(by)) this.player(by).stats.stops += 1;
    }

    /** Schreiben vorbei: mit Handys vergleichen und abstimmen, mit einem Gerät Punkte eintragen */
    finishWriting() {
      const s = this.s;
      s.graceEnd = null;
      if (!this.write) {
        s.tally = {};
        for (const p of s.players) s.tally[p.id] = s.cats.map(() => null);
        s.phase = 'tally';
        return;
      }
      s.review = { cat: 0, items: s.cats.map((_, c) => this.buildItems(c)), votes: {}, decided: {}, done: [] };
      s.phase = 'review';
    }

    /** Antworten einer Kategorie: gleiche zusammengefasst, Anfangsbuchstabe geprüft, ✓ bekannt */
    buildItems(c) {
      const s = this.s;
      const pids = s.players.map((p) => p.id);
      const texts = pids.map((pid) => Answers.clean(this.answersOf(pid)[c]));
      const list = Kat.listId(s.cats[c]);
      const items = Answers.group(texts).map((g) => {
        const variants = [...new Set(g.map((i) => texts[i]))];
        const text = variants[0];
        return {
          id: `${c}:${g[0]}:${pids[g[0]]}`,
          text,
          variants,
          pids: g.map((i) => pids[i]),
          letterOk: variants.some((t) => this.letterOk(t)),
          known: list ? variants.some((t) => Answers.known(list, t)) : false,
        };
      });
      // Passende zuerst, dann die größten Gruppen, dann alphabetisch
      return items.sort((a, b) => b.letterOk - a.letterOk || b.pids.length - a.pids.length || a.text.localeCompare(b.text, 'de'));
    }

    /* ---------- Abstimmung ---------- */

    /** Wer darf über eine Antwort abstimmen? Alle verbundenen Mitspieler außer denen, die sie geschrieben haben */
    voters(item) {
      return this.s.players.filter((p) => this.isOnline(p.id) && !item.pids.includes(p.id)).map((p) => p.id);
    }

    /** Status einer Antwort: ok | out | tie (Gleichstand – Spielleitung entscheidet), mit Grund */
    itemStatus(item) {
      const r = this.s.review;
      const votes = r.votes[item.id] || {};
      const voters = this.voters(item);
      const downs = voters.filter((pid) => votes[pid] === -1).length;
      const ups = voters.filter((pid) => votes[pid] === 1).length;
      const base = { downs, ups, voters: voters.length };
      if (typeof r.decided[item.id] === 'boolean') return Object.assign(base, { status: r.decided[item.id] ? 'ok' : 'out', reason: 'lead' });
      if (!item.letterOk) return Object.assign(base, { status: 'out', reason: 'letter' });
      if (downs && downs * 2 > voters.length) return Object.assign(base, { status: 'out', reason: 'vote' });
      if (downs && downs * 2 === voters.length) return Object.assign(base, { status: 'tie', reason: 'tie' });
      return Object.assign(base, { status: 'ok', reason: null });
    }

    /** Punkte einer Kategorie (Gleichstand ohne Entscheidung zählt) */
    evalCategory(c) {
      const items = this.s.review.items[c] || [];
      const statuses = items.map((it) => this.itemStatus(it));
      const pts = this.points;
      const validPids = new Set();
      items.forEach((it, i) => {
        if (statuses[i].status !== 'out') it.pids.forEach((pid) => validPids.add(pid));
      });
      const points = {};
      items.forEach((it, i) => {
        const ok = statuses[i].status !== 'out';
        for (const pid of it.pids) points[pid] = !ok ? 0 : validPids.size === 1 ? pts.solo : it.pids.length > 1 ? pts.dupe : pts.unique;
      });
      return { items, statuses, points };
    }

    /** Ist diese Person mit der laufenden Kategorie fertig? */
    isDone(pid) {
      const r = this.s.review;
      if (!r) return false;
      if (this.s.settings.vote === 'doubt') return r.done.includes(pid);
      // Alle Antworten: über jede fremde Antwort abgestimmt
      return (r.items[r.cat] || []).every((it) => it.pids.includes(pid) || (r.votes[it.id] || {})[pid] !== undefined);
    }

    /* ---------- Wertung ---------- */

    /** Runde abschließen: Punkte verteilen, Statistik, Verlauf */
    scoreRound() {
      const s = this.s;
      const pts = this.points;
      const rows = {};
      for (const p of s.players) rows[p.id] = { texts: this.answersOf(p.id).map((t) => Answers.clean(t)), points: s.cats.map(() => 0), status: s.cats.map(() => (this.write ? 'empty' : null)), sum: 0 };
      const vetoed = [];
      const solo = (pid) => this.player(pid) && (this.player(pid).stats.solo += 1);
      if (this.write) {
        s.cats.forEach((cat, c) => {
          const { items, statuses, points } = this.evalCategory(c);
          const valid = Object.keys(points).filter((pid) => points[pid] > 0);
          if (valid.length === 1) solo(valid[0]);
          items.forEach((it, i) => {
            const st = statuses[i];
            for (const pid of it.pids) {
              if (!rows[pid]) continue;
              rows[pid].points[c] = points[pid] || 0;
              rows[pid].status[c] = st.status === 'out' ? st.reason : 'ok';
              if (st.status === 'out' && st.reason !== 'letter' && this.player(pid)) this.player(pid).stats.vetoed += 1;
            }
            if (st.status === 'out' && st.reason !== 'letter') vetoed.push({ text: it.text, cat, names: it.pids.map((pid) => this.playerName(pid)), downs: st.downs });
          });
        });
      } else {
        for (const p of s.players) {
          rows[p.id].points = s.cats.map((_, c) => +((s.tally[p.id] || [])[c] || 0));
          if (pts.solo > pts.unique) rows[p.id].points.filter((n) => n === pts.solo).forEach(() => solo(p.id));
        }
      }
      // Summen, Statistik, Trinkregeln
      const sips = {};
      for (const p of s.players) {
        const row = rows[p.id];
        row.sum = row.points.reduce((a, b) => a + b, 0);
        p.score += row.sum;
        const zero = row.points.filter((n) => !n).length;
        p.stats.zero += zero;
        p.stats.dupe += row.points.filter((n) => n === pts.dupe).length;
        if (s.settings.drinks) {
          let n = zero * SIPS_ZERO;
          if (s.stopBy === p.id && zero) n += SIPS_STOP;
          if (n) sips[p.id] = n;
        }
      }
      s.history.push({
        no: s.round,
        letter: s.letter,
        cats: s.cats.slice(),
        stopBy: s.stopBy,
        stopName: s.stopBy ? this.playerName(s.stopBy) : null,
        rows,
        names: Object.fromEntries(s.players.map((p) => [p.id, p.name])),
        vetoed,
        sips,
      });
      s.phase = 'scores';
    }

    finish() {
      const s = this.s;
      s.phase = 'end';
      s.endedAt = this.now();
      s.review = null;
      s.tally = null;
      s.writeEnd = null;
      s.graceEnd = null;
      s.awards = this.computeAwards();
      this.dispose();
    }

    /* ---------- Zeitlimit ---------- */

    nextDeadline() {
      const s = this.s;
      if (s.phase === 'write') return s.writeEnd || null;
      if (s.phase === 'grace') return s.graceEnd || null;
      return null;
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
      let changed = false;
      if (s.phase === 'write' && s.writeEnd && s.writeEnd <= this.now()) {
        this.startGrace('time');
        changed = true;
      }
      if (s.phase === 'grace' && s.graceEnd && s.graceEnd <= this.now()) {
        this.finishWriting();
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
      const ok = handler.call(this, a, actor) === true;
      if (ok) this.changed();
      return ok;
    }

    /* Lobby */

    on_settings(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby') return false;
      s.settings = sanitizeSettings(Object.assign({}, a.settings, { input: s.settings.input }), s.settings);
      return true;
    }

    /** Mitspielen / nur zuschauen (Handy, in der Lobby) */
    on_watch(a, actor) {
      const s = this.s;
      if (!this.write || actor === STAGE || s.phase !== 'lobby' || !s.members[actor]) return false;
      const p = this.player(actor);
      if (a.watch && p) {
        s.players = s.players.filter((x) => x.id !== actor);
        return true;
      }
      if (!a.watch && !p && s.players.length < MAX_PLAYERS) {
        s.players.push(Engine.newPlayer(actor, s.members[actor].name));
        return true;
      }
      return false;
    }

    on_kick(a, actor) {
      const s = this.s;
      if (actor !== STAGE || !this.write || !s.members[a.player]) return false;
      const pid = a.player;
      s.players = s.players.filter((p) => p.id !== pid);
      delete s.members[pid];
      delete s.answers[pid];
      if (this.hooks.onKick) this.hooks.onKick(pid);
      const r = s.review;
      if (r) {
        r.items = r.items.map((list) => list.map((it) => Object.assign(it, { pids: it.pids.filter((x) => x !== pid) })).filter((it) => it.pids.length));
        for (const v of Object.values(r.votes)) delete v[pid];
        r.done = r.done.filter((x) => x !== pid);
      }
      if (s.tally) delete s.tally[pid];
      return true;
    }

    lobbyProblem() {
      const s = this.s;
      const here = s.players.filter((p) => this.isOnline(p.id));
      if (here.length < MIN_PLAYERS) return `Ihr braucht mindestens ${MIN_PLAYERS} Personen – scannt den QR-Code!`;
      return catProblem(s.settings);
    }

    on_start(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby' || this.lobbyProblem()) return false;
      s.players = s.players.filter((p) => this.isOnline(p.id));
      this.startGame();
      return true;
    }

    /* Buchstabe */

    /** „ABC im Kopf“: Stopp! Die Bühne schickt den Buchstaben, den sie gerade zeigt; ein Handy bekommt einen zufälligen. */
    on_pick(a, actor) {
      const s = this.s;
      if (s.phase !== 'draw' || !this.current(a)) return false;
      if (actor !== STAGE && !this.player(actor)) return false;
      const free = this.freeLetters();
      const letter = actor === STAGE && free.includes(a.letter) ? a.letter : this.drawLetter();
      this.startWriting(letter);
      return true;
    }

    /* Schreiben */

    /** Handy: die eigenen Antworten (alle Kategorien auf einmal, bei jeder Änderung gedrosselt) */
    on_answers(a, actor) {
      const s = this.s;
      if (!this.write || !['write', 'grace'].includes(s.phase) || !this.current(a) || !this.player(actor) || !Array.isArray(a.texts)) return false;
      const texts = s.cats.map((_, i) => Answers.clean(a.texts[i]));
      const old = this.answersOf(actor);
      if (texts.every((t, i) => t === old[i])) return false;
      s.answers[actor] = texts;
      return true;
    }

    /**
     * Stopp! Handy: nur wer alles ausgefüllt hat (die letzten Eingaben kommen gleich mit).
     * Laptop / Spielleitung: beendet die Schreibzeit jederzeit (auch bei fester Zeit).
     */
    on_stop(a, actor) {
      const s = this.s;
      if (s.phase !== 'write' || !this.current(a)) return false;
      if (this.leads(actor) && (a.force || actor === STAGE)) {
        this.startGrace('lead', null);
        return true;
      }
      if (!this.write || !this.player(actor) || s.settings.end === 'time') return false;
      if (Array.isArray(a.texts)) s.answers[actor] = s.cats.map((_, i) => Answers.clean(a.texts[i]));
      if (!this.complete(actor)) return false;
      this.startGrace('stop', actor);
      return true;
    }

    /* Abstimmung (mit Handys) */

    reviewItem(a) {
      const r = this.s.review;
      if (this.s.phase !== 'review' || !r || a.cat !== r.cat) return null;
      return (r.items[r.cat] || []).find((it) => it.id === a.id) || null;
    }

    /** 👎 / 👍 zu einer Antwort (value -1, 1 oder 0 = zurücknehmen). Eigene Antworten: nein. */
    on_vote(a, actor) {
      const r = this.s.review;
      const item = this.reviewItem(a);
      if (!item || !this.player(actor) || item.pids.includes(actor) || ![-1, 0, 1].includes(a.value)) return false;
      if (a.value === 1 && this.s.settings.vote !== 'all') return false;
      const votes = (r.votes[item.id] = r.votes[item.id] || {});
      if ((votes[actor] || 0) === a.value) return false;
      if (a.value) votes[actor] = a.value;
      else delete votes[actor];
      return true;
    }

    /** „Alles ok ✓“ – mit dieser Kategorie fertig */
    on_done(a, actor) {
      const r = this.s.review;
      if (this.s.phase !== 'review' || !r || a.cat !== r.cat || !this.player(actor) || r.done.includes(actor)) return false;
      r.done.push(actor);
      return true;
    }

    /**
     * Spielleitung: Antwort zählt / zählt nicht (valid: true/false, null = wieder der Abstimmung überlassen).
     * Über die eigene Antwort entscheidet die Spielleitung am Handy nicht – das kann nur der Laptop.
     */
    on_decide(a, actor) {
      const r = this.s.review;
      const item = this.reviewItem(a);
      if (!item || !this.leads(actor) || (actor !== STAGE && item.pids.includes(actor))) return false;
      if (a.valid === null) {
        if (!(item.id in r.decided)) return false;
        delete r.decided[item.id];
      } else if (typeof a.valid === 'boolean') r.decided[item.id] = a.valid;
      else return false;
      return true;
    }

    /* Ein Gerät: Punkte eintragen */

    on_cell(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'tally' || !s.tally || !this.current(a)) return false;
      const row = s.tally[a.player];
      const c = +a.cat;
      if (!row || !(c >= 0 && c < s.cats.length)) return false;
      const pts = this.points;
      const allowed = [0, pts.dupe, pts.unique, pts.solo];
      if (a.points !== null && !allowed.includes(a.points)) return false;
      row[c] = a.points;
      return true;
    }

    /* Weiter */

    /** Weiter: nächste Kategorie / Runde abschließen / nächste Runde / Siegerehrung */
    on_next(a, actor) {
      const s = this.s;
      if (!this.leads(actor) || !this.current(a)) return false;
      if (s.phase === 'review') {
        const r = s.review;
        if (a.cat !== undefined && a.cat !== r.cat) return false;
        if (r.cat < s.cats.length - 1) {
          r.cat += 1;
          r.done = [];
        } else this.scoreRound();
        return true;
      }
      if (s.phase === 'tally') {
        if (actor !== STAGE) return false;
        this.scoreRound();
        return true;
      }
      if (s.phase === 'scores') {
        if (s.round >= s.settings.rounds) this.finish();
        else this.startRound();
        return true;
      }
      return false;
    }

    /** Zurück zur vorigen Kategorie (Spielleitung hat zu schnell geklickt) */
    on_back(a, actor) {
      const r = this.s.review;
      if (!this.leads(actor) || this.s.phase !== 'review' || !r || r.cat === 0 || !this.current(a)) return false;
      r.cat -= 1;
      r.done = [];
      return true;
    }

    on_end(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase === 'lobby' || s.phase === 'end') return false;
      // Eine laufende Runde zählt nicht
      if (s.phase !== 'scores') {
        s.used = s.used.filter((l) => l !== s.letter);
        s.round -= 1;
      }
      this.finish();
      return true;
    }

    /** Nochmal mit denselben Leuten */
    on_again(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'end') return false;
      if (this.write) {
        s.phase = 'lobby';
        s.round = 0;
        s.used = [];
        s.cats = [];
        s.letter = null;
        s.answers = {};
        s.history = [];
        s.awards = [];
        s.players = s.players.filter((p) => s.members[p.id]);
        for (const p of s.players) Object.assign(p, Engine.newPlayer(p.id, p.name));
      } else this.startGame();
      return true;
    }

    /* ---------- Statistik ---------- */

    computeAwards() {
      const s = this.s;
      const out = [];
      if (!s.history.length || s.players.length < 2) return out;
      const best = (key, min) => {
        const top = Math.max(...s.players.map((p) => p.stats[key] || 0));
        if (top < min) return null;
        return { names: s.players.filter((p) => (p.stats[key] || 0) === top).map((p) => p.name), n: top };
      };
      const names = (b) => b.names.join(' & ');
      const stops = best('stops', 1);
      if (stops) out.push({ icon: '⚡', title: 'Schnellste Finger', text: `${names(stops)} – ${stops.n}× Stopp gerufen` });
      const solo = best('solo', 1);
      if (solo) out.push({ icon: '🦄', title: 'Kreativ', text: `${names(solo)} – ${solo.n}× als Einzige/r eine gültige Antwort` });
      const dupe = best('dupe', 2);
      if (dupe) out.push({ icon: '🤝', title: 'Mainstream', text: `${names(dupe)} – ${dupe.n}× dieselbe Antwort wie jemand anderes` });
      const vetoed = best('vetoed', 1);
      if (vetoed) out.push({ icon: '🤨', title: 'Erwischt', text: `${names(vetoed)} – ${vetoed.n} ${vetoed.n === 1 ? 'Antwort' : 'Antworten'} weggestimmt` });
      // Die schönste weggestimmte Antwort: die mit den meisten 👎 (bei Gleichstand die neueste)
      let top = null;
      for (const h of s.history) for (const x of h.vetoed || []) if (!top || x.downs >= top.downs) top = x;
      if (top) out.push({ icon: '🙃', title: 'Netter Versuch', text: `„${top.text}“ als ${top.cat} – ${top.names.join(' & ')}` });
      return out;
    }

    /* ---------- Ansicht ---------- */

    timerView() {
      const s = this.s;
      if (s.phase === 'write' && s.writeEnd) return { total: s.settings.time * 1000, remaining: Math.max(0, s.writeEnd - this.now()) };
      if (s.phase === 'grace' && s.graceEnd) {
        const total = s.graceReason === 'time' ? GRACE_TIME_MS : GRACE_STOP_MS;
        return { total, remaining: Math.max(0, s.graceEnd - this.now()), grace: true };
      }
      return null;
    }

    standings() {
      const sorted = this.s.players.slice().sort((a, b) => b.score - a.score);
      return sorted.map((p) => ({ id: p.id, name: p.name, score: p.score, place: sorted.findIndex((x) => x.score === p.score) + 1 }));
    }

    reviewView(viewer) {
      const s = this.s;
      const r = s.review;
      if (s.phase !== 'review' || !r) return null;
      const c = r.cat;
      const { items, statuses, points } = this.evalCategory(c);
      const stage = viewer === STAGE;
      const eligible = s.players.filter((p) => this.isOnline(p.id)).map((p) => p.id);
      return {
        cat: c,
        name: s.cats[c],
        nextName: s.cats[c + 1] || null,
        total: s.cats.length,
        items: items.map((it, i) => {
          const st = statuses[i];
          const votes = r.votes[it.id] || {};
          return {
            id: it.id,
            text: it.text,
            variants: it.variants,
            pids: it.pids.slice(),
            names: it.pids.map((pid) => this.playerName(pid)),
            mine: !stage && it.pids.includes(viewer),
            letterOk: it.letterOk,
            known: it.known,
            status: st.status,
            reason: st.reason,
            downs: st.downs,
            ups: st.ups,
            voters: st.voters,
            decided: typeof r.decided[it.id] === 'boolean' ? r.decided[it.id] : null,
            myVote: stage ? 0 : votes[viewer] || 0,
            points: points[it.pids[0]] || 0,
          };
        }),
        empty: s.players.filter((p) => !Answers.clean(this.answersOf(p.id)[c])).map((p) => p.name),
        done: eligible.filter((pid) => this.isDone(pid)),
        eligible,
        ties: statuses.filter((x) => x.status === 'tie').length,
      };
    }

    viewFor(viewer) {
      const s = this.s;
      const stage = viewer === STAGE;
      const me = stage ? null : this.player(viewer);
      const writing = ['write', 'grace'].includes(s.phase);
      const last = s.phase === 'scores' ? s.history[s.history.length - 1] : null;
      return {
        game: GAME,
        phase: s.phase,
        settings: clone(s.settings),
        players: s.players.map((p, i) => ({ id: p.id, name: p.name, color: PLAYER_COLORS[i % PLAYER_COLORS.length], online: this.isOnline(p.id), score: p.score })),
        members: this.write ? Object.entries(s.members).map(([id, m]) => ({ id, name: m.name, online: m.online, playing: !!this.player(id) })) : [],
        round: s.round,
        rounds: s.settings.rounds,
        letter: s.letter,
        used: s.used.slice(),
        letters: s.phase === 'draw' ? this.freeLetters().slice() : null,
        cats: s.cats.slice(),
        timer: this.timerView(),
        graceReason: s.phase === 'grace' ? s.graceReason : null,
        stopBy: s.stopBy,
        stopName: s.stopBy ? this.playerName(s.stopBy) : null,
        // Während des Schreibens: von allen nur der Füllstand, die eigenen Antworten nur fürs eigene Handy
        fill: writing ? Object.fromEntries(s.players.map((p) => [p.id, this.filled(p.id)])) : null,
        mine: me && s.cats.length && s.phase !== 'lobby' && s.phase !== 'end' ? this.answersOf(viewer) : null,
        review: this.reviewView(viewer),
        tally: stage && s.phase === 'tally' ? clone(s.tally) : null,
        last: last ? clone(last) : null,
        standings: this.standings(),
        lobbyProblem: s.phase === 'lobby' && this.write ? this.lobbyProblem() : null,
        awards: clone(s.awards),
        stats: s.phase === 'end' ? Object.fromEntries(s.players.map((p) => [p.id, clone(p.stats)])) : null,
        history: s.phase === 'end' ? clone(s.history) : [],
        startedAt: s.startedAt,
        me: stage
          ? { stage: true }
          : {
              id: viewer,
              name: (s.members[viewer] || {}).name || '',
              playing: !!me,
              lead: viewer === this.leadPid(),
            },
      };
    }
  }

  root.SLFEngine = {
    Engine,
    GAME,
    STAGE,
    PLAYER_COLORS,
    ROUND_OPTIONS,
    END_OPTIONS,
    TIME_OPTIONS,
    CAT_MODES,
    SCORINGS,
    LETTERS,
    HARD_LETTERS,
    DEFAULT_SETTINGS,
    MIN_PLAYERS,
    MAX_PLAYERS,
    MIN_CATS,
    MAX_CATS,
    MAX_CUSTOM,
    PER_ROUND,
    GRACE_STOP_MS,
    GRACE_TIME_MS,
    SIPS_ZERO,
    SIPS_STOP,
    sanitizeSettings,
    catPool,
    catProblem,
    letterPool,
    cleanName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
