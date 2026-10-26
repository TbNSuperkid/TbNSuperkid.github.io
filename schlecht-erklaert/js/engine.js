/*
 * Spiellogik von „Schlecht erklärt“ – Filme aus schlechten Beschreibungen erraten.
 *
 * Jede Runde gibt es eine Beschreibung (1–3 Sätze). Wer den Film errät, bekommt Punkte – je weniger
 * Hinweise (Jahr & Genre → Tipp → Titel-Lücken) aufgedeckt sind, desto mehr.
 *
 * Zwei Spielweisen:
 *  - say:   ein Gerät – alle rufen, die Spielleitung deckt Hinweise auf, löst auf und klickt an, wer es hatte
 *  - write: mit Handy – jedes Team tippt den Titel (oder wählt aus 4 Antworten), die App prüft selbst
 *
 * Zwei Modi:
 *  - db:      Beschreibungen aus der Datenbank
 *  - explain: Reihum erklärt eine Person auf dem Handy selbst einen Film, alle anderen raten (nur mit Handy)
 *
 * Der Laptop ("stage") ist immer der Host und spielt nicht selbst mit. Der Filmtitel steht in keiner Ansicht
 * (auch nicht in der des Laptops), bevor aufgelöst wird – nur die erklärende Person sieht ihn.
 */
(function (root) {
  'use strict';

  const Films = root.SEFilms;
  const Titles = root.SETitles;

  const GAME = 'schlecht-erklaert';
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
  const ANSWERS = ['type', 'choice'];
  const MODES = ['db', 'explain'];
  const FILM_OPTIONS = [10, 15, 20, 30];
  const SECONDS_OPTIONS = [0, 45, 60, 90];
  const DEFAULT_SETTINGS = {
    input: 'write',
    solo: false,
    answer: 'type',
    mode: 'db',
    films: 15,
    seconds: 60,
    hints: true,
    strict: false,
    suggest: true,
    level: 'mixed',
    categories: Films.DEFAULT_CATEGORIES.slice(),
  };
  // Punkte nach Anzahl aufgedeckter Hinweise (0 = nur die Beschreibung)
  const HINT_POINTS = [4, 3, 2, 1];
  const MAX_HINT = HINT_POINTS.length - 1;
  const CHOICE_POINTS = 2;
  const FIRST_BONUS = 1;
  const MAX_TRIES = 3;
  // „Knapp daneben“ kostet keinen Versuch – aber höchstens so oft
  const MAX_CLOSE = 3;
  // Selbst erklären: Punkte pro Team, das den Film errät (zu leicht = alle in den ersten Sekunden → 0)
  const EXPLAIN_POINT = 1;
  const EASY_MS = 10000;
  const MAX_REROLLS = 3;
  const MAX_EXPLAIN = 300;
  const MIN_EXPLAIN = 10;
  const MAX_GUESS = 80;
  const MAX_PLAYERS = 12;
  // So lange wird auf jemanden gewartet, dessen Handy kurz die Verbindung verliert (Neuladen, Bildschirm aus …)
  const GRACE_MS = 15000;

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
    s.categories = (s.categories || DEFAULT_SETTINGS.categories).slice();
    const i = input || {};
    if (INPUTS.includes(i.input)) s.input = i.input;
    if (typeof i.solo === 'boolean') s.solo = i.solo;
    if (ANSWERS.includes(i.answer)) s.answer = i.answer;
    if (MODES.includes(i.mode)) s.mode = i.mode;
    if (FILM_OPTIONS.includes(+i.films)) s.films = +i.films;
    if (SECONDS_OPTIONS.includes(+i.seconds)) s.seconds = +i.seconds;
    for (const k of ['hints', 'strict', 'suggest']) if (typeof i[k] === 'boolean') s[k] = i[k];
    if (Films.LEVEL_IDS.includes(i.level)) s.level = i.level;
    if (Array.isArray(i.categories)) {
      const cats = Films.CATEGORY_IDS.filter((id) => i.categories.includes(id));
      if (cats.length) s.categories = cats;
    }
    // Selbst erklären braucht Handys (der Film ist geheim)
    if (s.input === 'say') s.mode = 'db';
    return s;
  }

  /** Punkte für einen Treffer nach so vielen Hinweisen */
  function hintPoints(hint, hintsOn) {
    if (!hintsOn) return HINT_POINTS[0];
    return HINT_POINTS[Math.max(0, Math.min(MAX_HINT, hint || 0))];
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
     *   players: Namen bei „Jeder für sich“ mit einem Gerät. Mit einem Gerät startet das Spiel sofort,
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
        explainIdx: 0,
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

    get choice() {
      return this.s.settings.answer === 'choice';
    }

    /** Läuft gerade eine Runde, in der jemand selbst erklärt? */
    get explaining() {
      return !!(this.s.cur && this.s.cur.explainer);
    }

    /** Gibt es Hinweise in dieser Runde? (nicht bei Auswahl-Antworten) */
    get hintsOn() {
      return !!this.s.settings.hints && !this.choice;
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

    /** Spielleitung am Handy (z.B. wenn die Bühne ein Fernseher ist): das Handy, das als erstes da war und noch verbunden ist */
    leadPid() {
      if (!this.write) return null;
      let best = null;
      for (const [pid, m] of Object.entries(this.s.members)) {
        if (!m.online) continue;
        const joined = m.joined || Infinity;
        if (!best || joined < best.joined) best = { pid, joined };
      }
      return best ? best.pid : null;
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

    /** Kennung des aktuellen Films – verhindert, dass verspätete Eingaben beim nächsten landen */
    stepKey() {
      const cur = this.s.cur;
      return cur ? `${cur.no}-${cur.qNo}` : null;
    }

    addSoloTeam(pid, name) {
      const s = this.s;
      const used = new Set(s.teams.filter((t) => t.active).map((t) => t.color));
      const color = SOLO_COLORS.find((c) => !used.has(c)) || SOLO_COLORS[(s.nextSolo - 1) % SOLO_COLORS.length];
      const team = { id: 's' + s.nextSolo++, label: '', color, name, active: true, solo: true, players: [{ id: pid, name }], score: 0 };
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
        if (s.cur && ['explain', 'guess'].includes(s.phase)) {
          s.cur.teams = s.cur.teams.filter((id) => !empty.includes(id));
          s.cur.guessing = (s.cur.guessing || []).filter((id) => !empty.includes(id));
        }
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
        s.members[pid] = { name: cleanName(name, 'Gast'), online: true, joined: this.now() };
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
      for (const t of s.teams) t.score = 0;
      s.round = 0;
      s.tiebreak = null;
      s.history = [];
      s.cur = null;
      s.winners = [];
      s.awards = [];
      s.explainIdx = 0;
      s.startedAt = this.now();
      this.nextRound();
    }

    nextRound() {
      const s = this.s;
      if (!s.order.length) {
        this.finish();
        return;
      }
      if (s.round >= s.settings.films) {
        const tied = this.leaders(s.tiebreak || s.order);
        if (tied.length > 1) s.tiebreak = tied;
        else {
          this.finish();
          return;
        }
      }
      s.round += 1;
      s.cur = { no: s.round, qNo: 0, tiebreak: !!s.tiebreak, teams: (s.tiebreak || s.order).slice() };
      this.setupFilm();
    }

    /** Alle Spieler, die erklären können – abwechselnd aus den Teams (A1, B1, A2, B2 …) */
    explainers() {
      const s = this.s;
      const teams = s.order.map((id) => this.team(id)).filter(Boolean);
      const max = Math.max(0, ...teams.map((t) => t.players.length));
      const out = [];
      for (let i = 0; i < max; i++) for (const t of teams) if (t.players[i]) out.push(t.players[i].id);
      return out;
    }

    /** Nächste erklärende Person (verbunden), oder null */
    pickExplainer() {
      const s = this.s;
      const list = this.explainers();
      for (let k = 0; k < list.length; k++) {
        const pid = list[s.explainIdx % list.length];
        s.explainIdx += 1;
        if (this.isOnline(pid)) return pid;
      }
      return null;
    }

    drawFilm() {
      const s = this.s;
      const cur = s.cur;
      const film = Films.draw(s.settings.categories, s.settings.level, s.used, { random: this.hooks.random });
      cur.film = film || { id: 'x', cat: 'animation', title: '?', alts: [], year: 2000, level: 1, text: 'Keine Filme gefunden.', tip: '' };
      cur.choices = this.choice ? Films.choices(cur.film, { random: this.hooks.random }) : null;
    }

    /** Film ziehen und Eingaben zurücksetzen (auch beim Überspringen) */
    setupFilm() {
      const s = this.s;
      const cur = s.cur;
      this.drawFilm();
      cur.hint = 0;
      cur.results = null;
      cur.text = null;
      cur.explainer = null;
      cur.rerolls = 0;
      // Selbst erklären (nicht im Stechen – da raten nur noch die führenden Teams)
      if (this.write && s.settings.mode === 'explain' && !cur.tiebreak) {
        cur.explainer = this.pickExplainer();
        if (cur.explainer) {
          cur.timerEnd = null;
          cur.startedAt = null;
          s.phase = 'explain';
          return;
        }
      }
      this.startGuess();
    }

    /** Raten beginnt: Beschreibung zeigen, Eingaben vorbereiten, Uhr starten */
    startGuess() {
      const s = this.s;
      const cur = s.cur;
      cur.hint = 0;
      cur.startedAt = this.now();
      if (this.write) {
        cur.participants = {};
        cur.guesses = {};
        for (const id of cur.teams) {
          cur.participants[id] = this.team(id).players.map((p) => p.id).filter((pid) => pid !== cur.explainer);
          cur.guesses[id] = { list: [], tries: 0, close: 0, ok: false, done: false, hint: null, ms: null, by: null, pick: null, seq: null };
        }
        cur.guessing = cur.teams.filter((id) => cur.participants[id].length);
        cur.hits = 0;
        const sec = s.settings.seconds;
        cur.timerTotal = sec * 1000;
        cur.timerEnd = sec ? cur.startedAt + sec * 1000 : null;
      } else {
        cur.guessing = cur.teams.slice();
        cur.timerTotal = 0;
        cur.timerEnd = null;
      }
      s.phase = 'guess';
    }

    finish() {
      const s = this.s;
      s.phase = 'over';
      s.cur = null;
      s.winners = this.leaders(s.order);
      s.awards = this.computeAwards();
      this.dispose();
    }

    /** Alle Personen, die bei diesem Film mitraten */
    allParticipants() {
      const cur = this.s.cur;
      return cur.guessing.flatMap((id) => cur.participants[id] || []);
    }

    /** Hat das Team fertig geraten? (bzw. wird auf niemanden mehr gewartet) */
    teamDone(id) {
      const cur = this.s.cur;
      const g = cur.guesses[id];
      if (!g || g.done) return true;
      return !(cur.participants[id] || []).some((pid) => this.awaited(pid));
    }

    /** Mit Handy: Sind alle fertig? */
    roundComplete() {
      const cur = this.s.cur;
      return cur.guessing.every((id) => this.teamDone(id));
    }

    /** Punkte für einen Treffer in diesem Film */
    hitPoints(hint) {
      return this.choice ? CHOICE_POINTS : hintPoints(hint, this.hintsOn);
    }

    /** Mit Handy: Runde auswerten */
    evaluate() {
      const s = this.s;
      const cur = s.cur;
      const results = {};
      for (const id of cur.teams) {
        const g = cur.guesses[id];
        const ok = !!(g && g.ok);
        results[id] = { ok, hint: ok ? g.hint : null, ms: ok ? g.ms : null, base: ok ? this.hitPoints(g.hint) : 0, bonus: 0, explain: 0, accepted: false, points: 0 };
      }
      // Wer zuerst richtig lag, bekommt einen Bonus (nur wenn mehrere Teams raten)
      const hits = cur.guessing.filter((id) => results[id].ok).sort((a, b) => cur.guesses[a].seq - cur.guesses[b].seq);
      if (hits.length && cur.guessing.length > 1) results[hits[0]].bonus = FIRST_BONUS;
      // Selbst erklären: Punkte für jedes andere Team, das den Film erraten hat
      if (cur.explainer) {
        const et = (this.teamOf(cur.explainer) || {}).id;
        const others = cur.guessing.filter((id) => id !== et);
        const got = others.filter((id) => results[id].ok);
        const tooEasy = others.length >= 2 && got.length === others.length && got.every((id) => results[id].hint === 0 && results[id].ms < EASY_MS);
        cur.explainPoints = tooEasy ? 0 : got.length * EXPLAIN_POINT;
        cur.tooEasy = tooEasy;
        if (et && results[et]) results[et].explain = cur.explainPoints;
      }
      for (const id of cur.teams) {
        const r = results[id];
        r.points = r.base + r.bonus + r.explain;
        this.team(id).score += r.points;
      }
      cur.results = results;
      cur.timerEnd = null;
      s.phase = 'reveal';
    }

    /** Ein Gerät: auflösen – wer es hatte, klickt die Spielleitung danach an */
    revealSay() {
      const s = this.s;
      const cur = s.cur;
      cur.results = {};
      for (const id of cur.teams) cur.results[id] = { ok: false, hint: null, ms: null, base: 0, bonus: 0, explain: 0, accepted: false, points: 0 };
      cur.timerEnd = null;
      s.phase = 'reveal';
    }

    /** Punkte eines Teams in der Auflösung ändern (Treffer anklicken, „zählt doch“) */
    setPoints(id, points) {
      const r = this.s.cur.results[id];
      this.team(id).score += points - r.points;
      r.points = points;
    }

    pushHistory() {
      const s = this.s;
      const cur = s.cur;
      const f = cur.film;
      s.history.push({
        no: cur.no,
        tiebreak: cur.tiebreak,
        teams: cur.teams.slice(),
        film: { id: f.id, title: f.title, year: f.year, cat: f.cat },
        text: cur.explainer ? cur.text : f.text,
        explainer: cur.explainer ? { pid: cur.explainer, name: this.playerName(cur.explainer), points: cur.explainPoints || 0 } : null,
        results: clone(cur.results),
        wrong: this.write
          ? Object.fromEntries(cur.teams.map((id) => [id, ((cur.guesses[id] || {}).list || []).filter((x) => x.res === 'no').map((x) => x.text)]))
          : {},
        fastest: this.fastest(),
      });
    }

    /** Schnellster Treffer dieser Runde: {name, ms} */
    fastest() {
      const cur = this.s.cur;
      if (!this.write || !cur.guesses) return null;
      let best = null;
      for (const id of cur.guessing || []) {
        const g = cur.guesses[id];
        if (g && g.ok && (!best || g.ms < best.ms)) best = { name: this.playerName(g.by), team: id, ms: g.ms };
      }
      return best;
    }

    /** Mit Handy: prüfen, ob alle fertig sind bzw. ob die erklärende Person weg ist */
    checkProgress() {
      const s = this.s;
      const cur = s.cur;
      if (!cur || !this.write) return;
      if (s.phase === 'explain') {
        if (!this.awaited(cur.explainer)) this.nextExplainer();
        return;
      }
      if (s.phase === 'guess' && this.roundComplete()) this.evaluate();
    }

    /** Selbst erklären: jemand anderes ist dran (neuer Film) */
    nextExplainer() {
      const s = this.s;
      const cur = s.cur;
      cur.qNo += 1;
      cur.explainer = null;
      this.setupFilm();
    }

    /* ---------- Zeitlimit & Hinweise (mit Handy) ---------- */

    /** Zeitpunkt, an dem der nächste Hinweis automatisch kommt (mit Zeitlimit: nach je einem Viertel der Zeit) */
    nextHintAt() {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'guess' || !cur || !this.write || !this.hintsOn || !cur.timerTotal || cur.hint >= MAX_HINT) return null;
      return cur.startedAt + ((cur.hint + 1) * cur.timerTotal) / (MAX_HINT + 1);
    }

    nextDeadline() {
      const s = this.s;
      if (!['guess', 'explain'].includes(s.phase) || !s.cur || !this.write) return null;
      const ends = [];
      if (s.cur.timerEnd) ends.push(s.cur.timerEnd);
      const h = this.nextHintAt();
      if (h) ends.push(h);
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

    /** Abgelaufene Zeitlimits auswerten und fällige Hinweise aufdecken. Gibt true zurück, wenn sich etwas geändert hat. */
    tick() {
      const s = this.s;
      if (!['guess', 'explain'].includes(s.phase) || !s.cur || !this.write) return false;
      const before = this.progressSig();
      if (s.phase === 'guess' && s.cur.timerEnd && s.cur.timerEnd <= this.now()) this.evaluate();
      else {
        for (let h = this.nextHintAt(); h && h <= this.now(); h = this.nextHintAt()) s.cur.hint += 1;
        // Schonfrist für getrennte Spieler abgelaufen? Dann ohne sie weiter
        this.checkProgress();
      }
      return this.progressSig() !== before;
    }

    progressSig() {
      const s = this.s;
      return s.cur ? `${s.phase}|${s.cur.no}|${s.cur.qNo}|${s.cur.hint}` : s.phase;
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
        // Im laufenden Spiel einsteigen: ab dem nächsten Film dabei
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
      // Im laufenden Spiel darf man noch einem mitspielenden Team beitreten (ab dem nächsten Film dabei)
      if (!target || !s.order.includes(target.id) || this.teamOf(actor)) return false;
      target.players.push({ id: actor, name: m.name });
      return true;
    }

    on_kick(a, actor) {
      const s = this.s;
      if (actor !== STAGE || !this.write || !s.members[a.player]) return false;
      for (const t of s.teams) t.players = t.players.filter((p) => p.id !== a.player);
      delete s.members[a.player];
      const cur = s.cur;
      if (cur && cur.participants) {
        for (const id of Object.keys(cur.participants)) cur.participants[id] = cur.participants[id].filter((p) => p !== a.player);
      }
      if (this.solo) this.dropEmptySolo();
      if (this.hooks.onKick) this.hooks.onKick(a.player);
      if (s.phase !== 'lobby' && s.phase !== 'over' && !s.order.length) this.finish();
      else if (cur && s.phase === 'explain' && cur.explainer === a.player) this.nextExplainer();
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
      const people = this.s.teams.filter((t) => t.active).reduce((n, t) => n + online(t), 0);
      if (this.solo && !people) return 'Noch niemand dabei – scannt den QR-Code!';
      if (!this.solo && !this.s.teams.some((t) => t.active && online(t))) return 'Mindestens ein Team braucht einen Spieler.';
      if (this.s.settings.mode === 'explain' && people < 2) return 'Zum Selbst-Erklären braucht ihr mindestens zwei Personen.';
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

    /* Raten (mit Handy) */

    /** Gibt das Team des Spielers zurück, wenn er beim aktuellen Film mitraten darf */
    playing(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!this.write || s.phase !== 'guess' || !cur || actor === STAGE) return null;
      if (a.at !== undefined && a.at !== this.stepKey()) return null;
      const team = this.teamOf(actor);
      if (!team || !cur.guessing.includes(team.id) || !(cur.participants[team.id] || []).includes(actor)) return null;
      return team;
    }

    /** Titel tippen: richtig, knapp daneben (kostet nichts) oder falsch (kostet einen Versuch) */
    on_guess(a, actor) {
      const team = this.playing(a, actor);
      if (!team || this.choice) return false;
      const cur = this.s.cur;
      const g = cur.guesses[team.id];
      if (g.done) return false;
      const text = cleanName(a.text, '', MAX_GUESS);
      if (!Titles.key(text)) return false;
      // Denselben falschen Titel nochmal? Zählt nicht
      if (g.list.some((x) => x.res !== 'yes' && Titles.key(x.text) === Titles.key(text))) return false;
      let res = Titles.check(text, cur.film, { strict: this.s.settings.strict });
      if (res === 'close' && g.close >= MAX_CLOSE) res = 'no';
      g.list.push({ text, res, by: actor, hint: cur.hint });
      if (res === 'close') g.close += 1;
      else if (res === 'yes') Object.assign(g, { ok: true, done: true, hint: cur.hint, ms: this.now() - cur.startedAt, by: actor, seq: ++cur.hits });
      else {
        g.tries += 1;
        if (g.tries >= MAX_TRIES) g.done = true;
      }
      this.checkProgress();
      return true;
    }

    /** Auswahl-Modus: eine der 4 Antworten antippen (nur ein Versuch) */
    on_pick(a, actor) {
      const team = this.playing(a, actor);
      if (!team || !this.choice) return false;
      const cur = this.s.cur;
      const g = cur.guesses[team.id];
      const i = +a.index;
      if (g.done || !Number.isInteger(i) || i < 0 || i >= cur.choices.length) return false;
      const ok = cur.choices[i] === cur.film.title;
      Object.assign(g, { pick: i, ok, done: true, hint: 0, ms: this.now() - cur.startedAt, by: actor, seq: ok ? ++cur.hits : null });
      g.list.push({ text: cur.choices[i], res: ok ? 'yes' : 'no', by: actor, hint: 0 });
      if (!ok) g.tries = 1;
      this.checkProgress();
      return true;
    }

    /* Selbst erklären */

    explainerOk(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'explain' || !cur || actor !== cur.explainer) return false;
      return a.at === undefined || a.at === this.stepKey();
    }

    /** „Kenn ich nicht“ – anderer Film */
    on_reroll(a, actor) {
      const cur = this.s.cur;
      if (!this.explainerOk(a, actor) || cur.rerolls >= MAX_REROLLS) return false;
      cur.rerolls += 1;
      this.drawFilm();
      return true;
    }

    /** Beschreibung abschicken – dann wird geraten */
    on_explain(a, actor) {
      const cur = this.s.cur;
      if (!this.explainerOk(a, actor)) return false;
      const text = cleanName(a.text, '', MAX_EXPLAIN);
      if (text.length < MIN_EXPLAIN) return false;
      cur.text = text;
      this.startGuess();
      return true;
    }

    /* Hinweise & Steuerung */

    /** Nächsten Hinweis aufdecken (Laptop oder Spielleitung am Handy) */
    on_hint(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if ((actor !== STAGE && actor !== this.leadPid()) || s.phase !== 'guess' || !cur || !this.hintsOn) return false;
      if (a.at !== undefined && a.at !== this.stepKey()) return false;
      if (cur.hint >= MAX_HINT) return false;
      cur.hint += 1;
      return true;
    }

    /** Ein Gerät: auflösen */
    on_reveal(a, actor) {
      const s = this.s;
      if (actor !== STAGE || this.write || s.phase !== 'guess' || !s.cur) return false;
      this.revealSay();
      return true;
    }

    /** Ein Gerät: Team/Person hatte es (nochmal klicken = zurücknehmen) */
    on_had(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (actor !== STAGE || this.write || s.phase !== 'reveal' || !cur || !cur.results[a.team]) return false;
      const r = cur.results[a.team];
      r.ok = !r.ok;
      r.hint = r.ok ? cur.hint : null;
      r.base = r.ok ? this.hitPoints(cur.hint) : 0;
      this.setPoints(a.team, r.base);
      return true;
    }

    /** Mit Handy: „zählt doch“ – die App hat eine richtige Antwort nicht erkannt (nochmal klicken = zurücknehmen) */
    on_accept(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (actor !== STAGE || !this.write || s.phase !== 'reveal' || !cur || !cur.results[a.team]) return false;
      const r = cur.results[a.team];
      const g = cur.guesses[a.team];
      if (r.ok || !g || !g.list.length) return false;
      r.accepted = !r.accepted;
      const last = g.list[g.list.length - 1];
      r.base = r.accepted ? this.hitPoints(last.hint) : 0;
      this.setPoints(a.team, r.base + r.bonus + r.explain);
      return true;
    }

    on_skip(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (actor !== STAGE || !cur || !['explain', 'guess'].includes(s.phase)) return false;
      cur.qNo += 1;
      this.setupFilm();
      return true;
    }

    /** Film sofort auflösen (z.B. wenn jemand nicht mehr antwortet) */
    on_finishRound(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'guess' || !s.cur) return false;
      if (this.write) this.evaluate();
      else this.revealSay();
      return true;
    }

    on_next(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if ((actor !== STAGE && actor !== this.leadPid()) || !cur || s.phase !== 'reveal') return false;
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
        for (const t of s.teams) t.score = 0;
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
      const clean = {};
      const wrong = {};
      const explainers = {};
      let fastest = null;
      let hardest = null;
      const inc = (obj, id, n) => (obj[id] = (obj[id] || 0) + (n == null ? 1 : n));
      for (const h of s.history) {
        if (!h.results) continue;
        let anyone = false;
        for (const [id, r] of Object.entries(h.results)) {
          if (r.ok || r.accepted) anyone = true;
          if (r.ok && r.hint === 0) inc(clean, id);
        }
        for (const [id, list] of Object.entries(h.wrong || {})) if (list.length) inc(wrong, id, list.length);
        if (h.fastest && (!fastest || h.fastest.ms < fastest.ms)) fastest = Object.assign({ title: h.film.title }, h.fastest);
        if (!anyone && !hardest && h.film) hardest = h.film.title;
        if (h.explainer && h.explainer.points) inc(explainers, h.explainer.name, h.explainer.points);
      }
      const top = (obj, min) => {
        const e = Object.entries(obj).sort((a, b) => b[1] - a[1]);
        return e.length && e[0][1] >= min && (e.length < 2 || e[1][1] < e[0][1]) ? e[0] : null;
      };
      const sec = (ms) => (ms / 1000).toFixed(1).replace('.', ',');
      if (fastest) out.push({ icon: '⚡', title: 'Blitzmerker', text: `${fastest.name} – ${sec(fastest.ms)} s bei „${fastest.title}“` });
      const c = top(clean, 2);
      if (c) out.push({ icon: '🧠', title: 'Ohne Hilfe', text: `${name(c[0])} – ${c[1]} Filme ohne einen einzigen Hinweis` });
      const w = top(wrong, 3);
      if (w) out.push({ icon: '🙈', title: 'Filmriss', text: `${name(w[0])} – ${w[1]} falsche Titel` });
      const ex = top(explainers, 1);
      if (ex) out.push({ icon: '📜', title: 'Erklärbär', text: `${ex[0]} – ${ex[1]} Punkte fürs Erklären` });
      if (hardest) out.push({ icon: '🤯', title: 'Härtester Film', text: `„${hardest}“ – den hatte niemand` });
      return out;
    }

    /* ---------- Ansicht ---------- */

    timerView(obj) {
      if (!obj || !obj.timerEnd) return null;
      return { total: obj.timerTotal, remaining: Math.max(0, obj.timerEnd - this.now()) };
    }

    /** Aufgedeckte Hinweise – ohne den Titel selbst */
    hintsView() {
      const cur = this.s.cur;
      const f = cur.film;
      return {
        meta: cur.hint >= 1 ? { year: f.year, cat: f.cat } : null,
        tip: cur.hint >= 2 ? f.tip : null,
        gaps: cur.hint >= 3 ? Titles.gaps(f.title) : null,
      };
    }

    curView(viewer) {
      const s = this.s;
      const cur = s.cur;
      if (!cur) return null;
      const revealed = s.phase === 'reveal';
      const f = cur.film;
      const v = {
        no: cur.no,
        qNo: cur.qNo,
        tiebreak: cur.tiebreak,
        teams: cur.teams.slice(),
        guessing: (cur.guessing || []).slice(),
        hint: cur.hint,
        maxHint: MAX_HINT,
        hintsOn: this.hintsOn,
        pointsNow: this.hitPoints(cur.hint),
        text: s.phase === 'explain' ? null : cur.explainer ? cur.text : f.text,
        hints: s.phase === 'explain' ? { meta: null, tip: null, gaps: null } : this.hintsView(),
        choices: s.phase === 'explain' || !cur.choices ? null : cur.choices.slice(),
        explain: cur.explainer
          ? {
              pid: cur.explainer,
              name: this.playerName(cur.explainer),
              team: (this.teamOf(cur.explainer) || {}).id || null,
              rerollsLeft: MAX_REROLLS - cur.rerolls,
              points: revealed ? cur.explainPoints || 0 : null,
              tooEasy: revealed ? !!cur.tooEasy : false,
            }
          : null,
      };
      // Nur die erklärende Person sieht vorher, um welchen Film es geht
      if (cur.explainer && viewer === cur.explainer && s.phase === 'explain') {
        v.secret = { title: f.title, alts: f.alts.slice(), year: f.year, cat: f.cat };
      }
      if (revealed) {
        v.film = { id: f.id, title: f.title, year: f.year, cat: f.cat, text: f.text, tip: f.tip, alts: f.alts.filter((x) => !x.startsWith('~')) };
        v.results = clone(cur.results);
      }
      if (!this.write) return v;
      v.timer = s.phase === 'guess' ? this.timerView(cur) : null;
      const nh = this.nextHintAt();
      v.nextHint = s.phase === 'guess' && nh ? Math.max(0, nh - this.now()) : null;
      if (s.phase === 'explain') return v;
      v.participants = clone(cur.participants);
      v.status = {};
      for (const id of cur.teams) {
        const g = cur.guesses[id];
        v.status[id] = { done: this.teamDone(id), ok: g.ok, tries: g.tries, guessed: g.list.length > 0 };
      }
      const named = (list) => list.map((x) => ({ text: x.text, res: x.res, by: this.playerName(x.by) }));
      if (revealed) v.guesses = Object.fromEntries(cur.teams.map((id) => [id, named(cur.guesses[id].list)]));
      const myTeam = viewer === STAGE ? null : this.teamOf(viewer);
      if (myTeam && cur.guesses[myTeam.id] && s.phase === 'guess') {
        const g = cur.guesses[myTeam.id];
        v.mine = {
          participant: (cur.participants[myTeam.id] || []).includes(viewer),
          list: named(g.list),
          tries: g.tries,
          triesLeft: MAX_TRIES - g.tries,
          done: g.done,
          ok: g.ok,
          pick: g.pick,
          points: g.ok ? this.hitPoints(g.hint) : 0,
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
        round: s.round,
        films: s.settings.films,
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
          players: t.players.map((p) => ({ id: p.id, name: p.name, online: this.isOnline(p.id) })),
        })),
        members: this.write
          ? Object.entries(s.members).map(([id, m]) => ({ id, name: m.name, online: m.online, team: (this.teamOf(id) || {}).id || null }))
          : [],
        lobbyProblem: s.phase === 'lobby' && this.write ? this.lobbyProblem() : null,
        ranking: this.ranking(),
        winners: s.winners.slice(),
        awards: clone(s.awards),
        history: s.phase === 'over' ? s.history.map((h) => ({ no: h.no, film: h.film, text: h.text, explainer: h.explainer ? h.explainer.name : null })) : [],
        cur: this.curView(viewer),
        me: stage
          ? { stage: true }
          : {
              id: viewer,
              name: (s.members[viewer] || {}).name || '',
              team: myTeam ? myTeam.id : null,
              lead: viewer === this.leadPid(),
              stepKey: this.stepKey(),
            },
      };
    }
  }

  root.SEEngine = {
    Engine,
    GAME,
    STAGE,
    TEAMS,
    SOLO_COLORS,
    FILM_OPTIONS,
    SECONDS_OPTIONS,
    DEFAULT_SETTINGS,
    HINT_POINTS,
    MAX_HINT,
    CHOICE_POINTS,
    FIRST_BONUS,
    MAX_TRIES,
    MAX_CLOSE,
    EXPLAIN_POINT,
    EASY_MS,
    MAX_REROLLS,
    MAX_EXPLAIN,
    MIN_EXPLAIN,
    MAX_GUESS,
    MAX_PLAYERS,
    GRACE_MS,
    sanitizeSettings,
    hintPoints,
    cleanName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
