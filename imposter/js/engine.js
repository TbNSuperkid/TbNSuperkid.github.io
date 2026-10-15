/*
 * Spiellogik von „Imposter“.
 *
 * Alle bekommen dasselbe geheime Wort – außer dem Imposter. Reihum sagt jede Person ein Wort dazu,
 * dann wird diskutiert und abgestimmt. Wird der Imposter erwischt, darf er noch das Wort raten.
 *
 * Zwei Modi:
 *  - word:     Crew sieht das Wort, der Imposter „Du bist der Imposter“ (+ Kategorie) –
 *              oder bei „Undercover“ ein ähnliches Wort und merkt es nicht
 *  - question: Crew bekommt eine Frage, der Imposter eine andere mit ähnlicher Antwort
 *
 * Zwei Spielweisen:
 *  - pass:   Ein Gerät wird herumgereicht. Der Host ("stage") ist das Gerät selbst und bedient alles.
 *  - phones: Jeder ein Handy. Der Host öffnet einen Raum; spielt er mit (hostPlays), ist er selbst
 *            Spieler mit der ID "stage", sonst ist er nur Bühne (Laptop/Fernseher).
 *
 * Rollen und Wörter kennt nur der Host. Handys bekommen über viewFor nur ihre eigene Karte –
 * fremde Rollen erst, wenn jemand rausgewählt wurde oder die Runde vorbei ist.
 *
 * Phasen: lobby → reveal → clues (bzw. answer) → discuss → vote → guess / out → result → … → end
 */
(function (root) {
  'use strict';

  const Deck = root.IMDeck;

  const STAGE = 'stage';
  const MODES = ['word', 'question'];
  const INPUTS = ['pass', 'phones'];
  const VARIANTS = ['classic', 'undercover'];
  const IMPOSTER_OPTIONS = [1, 2, 3];
  const CLUE_OPTIONS = [1, 2, 3];
  const DISCUSS_OPTIONS = [60, 120, 180, 300, 0]; // 0 = unbegrenzt
  const ROUND_OPTIONS = ['players', 3, 5, 0]; // players = so viele wie Personen, 0 = endlos
  const VOTING_OPTIONS = ['once', 'last']; // last = abstimmen bis alle Imposter raus sind
  const DRINK_OPTIONS = ['off', 'on', 'free']; // free = alkoholfrei (Strafpunkte)
  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 15;
  const MAX_CLUE = 30;
  const MAX_ANSWER = 60;
  const POINTS = { hidden: 3, guessed: 2, crew: 1, vote: 1 };
  const DRINKS = { caught: 2, give: 3 };
  const PLAYING = ['reveal', 'clues', 'answer', 'discuss', 'vote', 'guess', 'out'];
  const DEFAULT_SETTINGS = {
    mode: 'word',
    input: 'pass',
    hostPlays: true,
    variant: 'classic',
    imposters: 1,
    showCategory: true,
    firstSafe: true,
    voting: 'once',
    clueRounds: 2,
    typeClues: false,
    discussSec: 120,
    rounds: 'players',
    categories: Deck.defaultCategories(),
    drinks: 'off',
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

  function sanitizeSettings(input, current) {
    const s = Object.assign({}, current || DEFAULT_SETTINGS);
    const i = input || {};
    if (MODES.includes(i.mode)) s.mode = i.mode;
    if (INPUTS.includes(i.input)) s.input = i.input;
    if (typeof i.hostPlays === 'boolean') s.hostPlays = i.hostPlays;
    if (VARIANTS.includes(i.variant)) s.variant = i.variant;
    if (IMPOSTER_OPTIONS.includes(+i.imposters)) s.imposters = +i.imposters;
    if (typeof i.showCategory === 'boolean') s.showCategory = i.showCategory;
    if (typeof i.firstSafe === 'boolean') s.firstSafe = i.firstSafe;
    if (VOTING_OPTIONS.includes(i.voting)) s.voting = i.voting;
    if (CLUE_OPTIONS.includes(+i.clueRounds)) s.clueRounds = +i.clueRounds;
    if (typeof i.typeClues === 'boolean') s.typeClues = i.typeClues;
    if (i.discussSec !== undefined && DISCUSS_OPTIONS.includes(+i.discussSec)) s.discussSec = +i.discussSec;
    if (i.rounds !== undefined) {
      const r = i.rounds === 'players' ? 'players' : +i.rounds;
      if (ROUND_OPTIONS.includes(r)) s.rounds = r;
    }
    if (Array.isArray(i.categories)) {
      const cats = Deck.CATEGORIES.map((c) => c.id).filter((id) => i.categories.includes(id));
      if (cats.length) s.categories = cats;
    }
    s.categories = (s.categories || Deck.defaultCategories()).slice();
    if (DRINK_OPTIONS.includes(i.drinks)) s.drinks = i.drinks;
    return s;
  }

  /** Höchstens ein Drittel der Runde darf Imposter sein (mindestens einer) */
  function maxImposters(n) {
    return Math.max(1, Math.floor(n / 3));
  }

  /** Doppelte Namen unterscheidbar machen: Anna, Anna 2 */
  function uniqueNames(names) {
    const used = new Set();
    return names.map((n) => {
      let name = n;
      let k = 2;
      while (used.has(name.toLowerCase())) name = `${n} ${k++}`;
      used.add(name.toLowerCase());
      return name;
    });
  }

  class Engine {
    /**
     * @param {object} state Spielzustand (siehe Engine.create)
     * @param {{onChange?: Function, onKick?: Function, now?: Function, random?: Function, timers?: boolean}} hooks
     *   timers: false schaltet den Diskussions-Timer ab (Tests rufen dann tick() selbst auf)
     */
    constructor(state, hooks) {
      this.s = state;
      this.hooks = hooks || {};
      this.now = this.hooks.now || (() => Date.now());
      this.random = this.hooks.random || Math.random;
      this.timer = null;
      // Nach einem Neuladen: inzwischen abgelaufene Diskussion gleich auswerten
      this.tick();
      this.armTimer();
    }

    /**
     * Neues Spiel aus dem Setup.
     * @param {{settings: object, players?: string[], hostName?: string}} config
     *   Ein Gerät: Namen werden hier eingetragen (in Sitzreihenfolge), die erste Runde startet sofort.
     *   Jeder ein Handy: Es beginnt in der Lobby; spielt der Host mit, ist er schon dabei (hostName).
     */
    static create(config, hooks) {
      const settings = sanitizeSettings(config.settings);
      const state = {
        v: 1,
        game: 'imposter',
        settings,
        phase: 'lobby',
        step: 0,
        players: [],
        members: {},
        round: 0,
        totalRounds: 0,
        rs: null, // Einstellungen dieser Runde (ändern sich erst zur nächsten Runde)
        secret: null,
        roles: {},
        order: [],
        seen: {},
        clue: null,
        clues: [],
        answers: {},
        timerEnd: null,
        timerTotal: 0,
        vote: null,
        voteNo: 0,
        votes: [],
        outs: [],
        guess: null,
        result: null,
        history: [],
        used: [],
        imposterCount: {},
        lastImposters: [],
        drinks: [],
        drinkNo: 0,
        event: null,
        eventNo: 0,
        awards: [],
      };
      if (settings.input === 'pass') {
        const names = (config.players || []).slice(0, MAX_PLAYERS).map((n, i) => cleanName(n, 'Person ' + (i + 1)));
        while (names.length < MIN_PLAYERS) names.push('Person ' + (names.length + 1));
        state.players = uniqueNames(names).map((name, i) => ({ id: 'p' + (i + 1), name, score: 0 }));
        new Engine(state, Object.assign({}, hooks, { timers: false })).startGame();
      } else if (settings.hostPlays) {
        state.players.push({ id: STAGE, name: cleanName(config.hostName, 'Host'), score: 0 });
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
      if (!this.write || pid === STAGE) return true;
      const m = this.s.members[pid];
      return !!(m && m.online);
    }

    playing() {
      return PLAYING.includes(this.s.phase);
    }

    /** Wer spielt in der nächsten Runde mit? (Handys: nur verbundene) */
    participants() {
      return this.s.players.filter((p) => this.isOnline(p.id)).map((p) => p.id);
    }

    isOut(pid) {
      return this.s.outs.some((o) => o.pid === pid);
    }

    /** Noch im Spiel (nicht rausgewählt), in Reihenfolge der Runde */
    alive() {
      return this.s.order.filter((id) => !this.isOut(id));
    }

    imposterIds() {
      return this.s.order.filter((id) => this.s.roles[id] === 'imposter');
    }

    setPhase(phase) {
      this.s.phase = phase;
      this.s.step += 1;
    }

    event(kind, extra) {
      this.s.event = Object.assign({ n: ++this.s.eventNo, kind }, extra || {});
    }

    /** Aktion passt nicht (mehr) zum aktuellen Schritt? (doppelt getippt, veraltete Ansicht) */
    stale(a) {
      return a.at !== undefined && a.at !== this.s.step;
    }

    startClock(sec) {
      this.s.timerTotal = sec * 1000;
      this.s.timerEnd = sec ? this.now() + sec * 1000 : null;
    }

    stopClock() {
      this.s.timerEnd = null;
      this.s.timerTotal = 0;
    }

    /** Was sieht diese Person auf ihrer Karte? */
    cardFor(pid) {
      const s = this.s;
      const sec = s.secret;
      const role = s.roles[pid];
      if (!sec || !role) return null;
      if (sec.kind === 'question') return { kind: 'question', question: role === 'imposter' ? sec.imposter : sec.crew };
      const cat = Deck.category(sec.category);
      if (role === 'imposter' && s.rs.variant === 'classic') {
        return { kind: 'imposter', category: s.rs.showCategory ? cat.label : null, icon: s.rs.showCategory ? cat.icon : null };
      }
      return { kind: 'word', word: role === 'imposter' ? sec.decoy : sec.word, category: cat.label, icon: cat.icon };
    }

    /** Kennt man die eigene Rolle? Nur im klassischen Wort-Modus. */
    knowsRole() {
      const rs = this.s.rs;
      return !!rs && rs.mode === 'word' && rs.variant === 'classic';
    }

    /* ---------- Trinkregeln ---------- */

    drink(pid, amount, reason) {
      const s = this.s;
      if (s.settings.drinks === 'off' || amount <= 0) return;
      s.drinks.push({ n: ++s.drinkNo, round: s.round, pid, name: this.playerName(pid), amount, reason });
    }

    /** Getrunken (verteilte Schlucke zählen nicht) */
    drinkTotals() {
      const out = {};
      for (const d of this.s.drinks) if (d.reason !== 'give') out[d.pid] = (out[d.pid] || 0) + d.amount;
      return out;
    }

    /* ---------- Verbindungen (Jeder ein Handy) ---------- */

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
      const p = this.player(pid);
      if (p) p.name = s.members[pid].name;
      else if (s.players.length < MAX_PLAYERS && s.phase !== 'end') s.players.push({ id: pid, name: s.members[pid].name, score: 0 });
      this.changed();
    }

    disconnect(pid) {
      const m = this.s.members[pid];
      if (!m || !m.online) return;
      m.online = false;
      m.offlineAt = this.now();
      this.changed();
    }

    /** Nach dem Neuladen des Hosts: alle müssen sich neu verbinden */
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
      const n = this.participants().length;
      s.totalRounds = s.settings.rounds === 'players' ? n : s.settings.rounds;
      this.startRound();
    }

    shuffle(list) {
      const a = list.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    /**
     * Imposter auslosen – fair über das ganze Spiel:
     *  - wer zuletzt Imposter war, setzt aus (wenn dann noch genug Auswahl bleibt)
     *  - wer schon öfter dran war, wird seltener gezogen (aber nie berechenbar)
     *  - die erste Person der Reihenfolge ist nie Imposter (abschaltbar)
     */
    pickImposters(order, k) {
      const s = this.s;
      let cands = order.slice(s.settings.firstSafe && order.length > k + 1 ? 1 : 0);
      const fresh = cands.filter((id) => !s.lastImposters.includes(id));
      if (fresh.length > k) cands = fresh;
      const picked = [];
      while (picked.length < k && picked.length < cands.length) {
        const pool = cands.filter((id) => !picked.includes(id));
        const weights = pool.map((id) => 1 / Math.pow(1 + (s.imposterCount[id] || 0), 2));
        let r = this.random() * weights.reduce((a, b) => a + b, 0);
        let i = 0;
        while (i < pool.length - 1 && r >= weights[i]) r -= weights[i++];
        picked.push(pool[i]);
      }
      return picked;
    }

    drawSecret() {
      const s = this.s;
      if (s.rs.mode === 'question') {
        const q = Deck.drawQuestion({ adult: s.settings.categories.includes('adult'), used: s.used, random: this.random });
        return { kind: 'question', crew: q.crew, imposter: q.imposter };
      }
      const w = Deck.drawWord({ categories: s.settings.categories, used: s.used, random: this.random });
      return { kind: 'word', word: w.word, decoy: w.decoy, category: w.category };
    }

    startRound() {
      const s = this.s;
      const ids = this.participants();
      s.round += 1;
      s.rs = {
        mode: s.settings.mode,
        variant: s.settings.variant,
        showCategory: s.settings.showCategory,
        voting: s.settings.voting,
        clueRounds: s.settings.clueRounds,
        typeClues: s.settings.typeClues,
        discussSec: s.settings.discussSec,
      };
      s.order = this.shuffle(ids);
      const k = Math.min(s.settings.imposters, maxImposters(ids.length));
      const imps = this.pickImposters(s.order, k);
      s.roles = {};
      for (const id of ids) s.roles[id] = imps.includes(id) ? 'imposter' : 'crew';
      for (const id of imps) s.imposterCount[id] = (s.imposterCount[id] || 0) + 1;
      s.lastImposters = imps.slice();
      s.secret = this.drawSecret();
      Object.assign(s, { seen: {}, clue: null, clues: [], answers: {}, vote: null, votes: [], outs: [], guess: null, result: null, event: null });
      this.stopClock();
      this.setPhase('reveal');
    }

    /** Ein Gerät: Wer bekommt das Gerät als Nächstes? (Sitzreihenfolge = Reihenfolge der Namen) */
    holder() {
      const s = this.s;
      const p = s.players.find((x) => s.order.includes(x.id) && !s.seen[x.id]);
      return p ? p.id : null;
    }

    checkReveal() {
      const s = this.s;
      if (s.phase !== 'reveal') return;
      if (s.order.every((id) => s.seen[id] || !this.isOnline(id))) this.beginTalk();
    }

    /** Nach dem Verteilen: Hinweise (bzw. Antworten) reihum */
    beginTalk() {
      const s = this.s;
      if (s.rs.mode === 'question' && this.write) {
        this.setPhase('answer');
        return;
      }
      const rounds = s.rs.mode === 'question' ? 1 : s.rs.clueRounds;
      s.clue = { round: 1, idx: 0, rounds };
      this.setPhase('clues');
      this.skipOffline();
    }

    currentClue() {
      const s = this.s;
      if (s.phase !== 'clues' || !s.clue) return null;
      return this.alive()[s.clue.idx] || null;
    }

    /** Handys: wer nicht verbunden ist, wird beim Hinweisgeben übersprungen */
    skipOffline() {
      const s = this.s;
      if (!this.write) return;
      let guard = 0;
      while (s.phase === 'clues' && guard++ < 100) {
        const cur = this.currentClue();
        if (!cur || this.isOnline(cur)) return;
        this.advanceClue(true);
      }
    }

    advanceClue(silent) {
      const s = this.s;
      const alive = this.alive();
      s.clue.idx += 1;
      if (s.clue.idx >= alive.length) {
        s.clue.idx = 0;
        s.clue.round += 1;
      }
      if (s.clue.round > s.clue.rounds) {
        this.beginDiscuss();
        return;
      }
      s.step += 1;
      if (!silent) this.skipOffline();
    }

    checkAnswers() {
      const s = this.s;
      if (s.phase !== 'answer') return;
      if (this.alive().every((id) => s.answers[id] || !this.isOnline(id))) this.beginDiscuss();
    }

    beginDiscuss() {
      this.setPhase('discuss');
      this.startClock(this.s.rs.discussSec);
    }

    startVote() {
      const s = this.s;
      this.stopClock();
      s.vote = { no: ++s.voteNo, runoff: false, candidates: null, votes: {} };
      this.setPhase('vote');
    }

    candidates() {
      const v = this.s.vote;
      return v && v.candidates ? v.candidates.filter((id) => !this.isOut(id) && this.s.order.includes(id)) : this.alive();
    }

    /** Darf diese Person abstimmen, und für wen? */
    canVote(pid) {
      return this.alive().includes(pid) && this.candidates().some((c) => c !== pid);
    }

    checkVotes() {
      const s = this.s;
      if (s.phase !== 'vote' || !s.vote) return;
      const voters = this.alive().filter((id) => this.canVote(id) && this.isOnline(id));
      if (voters.length && voters.every((id) => s.vote.votes[id])) this.resolveVote();
    }

    tally(votes) {
      const t = {};
      for (const target of Object.values(votes)) t[target] = (t[target] || 0) + 1;
      return t;
    }

    resolveVote() {
      const s = this.s;
      const t = this.tally(s.vote.votes);
      const max = Math.max(0, ...Object.values(t));
      const top = this.candidates().filter((id) => max > 0 && t[id] === max);
      this.decide(top, s.vote.votes);
    }

    /** Abstimmung auswerten: eine Person → raus, Gleichstand → Stichwahl, nochmal Gleichstand → niemand fliegt */
    decide(top, votes) {
      const s = this.s;
      s.votes.push({ no: s.vote.no, runoff: s.vote.runoff, votes: clone(votes), tally: this.tally(votes), top: top.slice() });
      if (top.length === 1) {
        this.eliminate(top[0]);
        return;
      }
      if (!s.vote.runoff) {
        s.vote = { no: ++s.voteNo, runoff: true, candidates: top.slice(), votes: {} };
        this.event('tie', { candidates: top.slice() });
        s.step += 1;
        return;
      }
      this.event('deadlock', { candidates: top.slice() });
      s.vote = null;
      this.finishRound('deadlock');
    }

    eliminate(pid) {
      const s = this.s;
      const role = s.roles[pid];
      s.outs.push({ pid, role, vote: s.vote.no, guess: null, correct: null });
      this.event('out', { pid, role });
      s.vote = null;
      if (role === 'imposter' && s.rs.mode === 'word') {
        s.guess = { pid };
        this.setPhase('guess');
        return;
      }
      this.afterOut();
    }

    /** Nach dem Rauswählen: Runde vorbei oder (Variante „bis zum Ende“) weiter diskutieren? */
    afterOut() {
      const s = this.s;
      const alive = this.alive();
      const impsLeft = alive.filter((id) => s.roles[id] === 'imposter').length;
      const crewLeft = alive.length - impsLeft;
      if (s.rs.voting === 'once' || !impsLeft || crewLeft <= impsLeft) {
        this.finishRound('vote');
        return;
      }
      this.setPhase('out');
    }

    /** Runde auswerten: Punkte, Trinkregeln, Verlauf */
    finishRound(reason) {
      const s = this.s;
      const imps = this.imposterIds();
      const points = {};
      const add = (id, n) => {
        if (n) points[id] = (points[id] || 0) + n;
      };
      const caught = s.outs.filter((o) => o.role === 'imposter');
      let failed = 0;
      for (const id of imps) {
        const o = caught.find((x) => x.pid === id);
        if (!o) add(id, POINTS.hidden);
        else if (o.correct) add(id, POINTS.guessed);
        else failed += 1;
      }
      const crew = s.order.filter((id) => s.roles[id] === 'crew');
      for (const id of crew) add(id, failed * POINTS.crew);
      // Bonus: wer als Crew für einen Imposter gestimmt hat (einmal pro Runde)
      const hits = {};
      const received = {};
      for (const v of s.votes) {
        for (const [voter, target] of Object.entries(v.votes)) {
          if (s.roles[voter] === 'crew' && s.roles[target] === 'imposter') hits[voter] = (hits[voter] || 0) + 1;
          if (s.roles[target] === 'crew') received[target] = (received[target] || 0) + 1;
        }
      }
      for (const id of Object.keys(hits)) add(id, POINTS.vote);
      for (const p of s.players) if (points[p.id]) p.score += points[p.id];
      const impScored = imps.some((id) => points[id]);
      const winner = failed && impScored ? 'split' : failed ? 'crew' : 'imposter';
      for (const id of imps) {
        const o = caught.find((x) => x.pid === id);
        if (!o) this.drink(id, DRINKS.give, 'give');
        else if (!o.correct) this.drink(id, DRINKS.caught, 'caught');
      }
      s.result = { round: s.round, reason, winner, imposters: imps.slice(), points, hits };
      s.history.push({
        round: s.round,
        imposters: imps.slice(),
        winner,
        points: clone(points),
        hits: clone(hits),
        received,
        outs: clone(s.outs),
      });
      s.guess = null;
      s.vote = null;
      this.stopClock();
      this.setPhase('result');
    }

    /** Ergebnis der Runde zurücknehmen (z.B. wenn das Raten doch anders gewertet wird) */
    revertResult() {
      const s = this.s;
      const r = s.result;
      if (!r || r.aborted) return;
      for (const p of s.players) if (r.points[p.id]) p.score -= r.points[p.id];
      s.drinks = s.drinks.filter((d) => d.round !== s.round);
      s.history.pop();
      s.result = null;
    }

    /** Runde abbrechen (Imposter hat das Spiel verlassen, zu wenige übrig) – keine Punkte */
    abortRound() {
      const s = this.s;
      s.result = { round: s.round, aborted: true, winner: null, imposters: this.imposterIds(), points: {}, hits: {} };
      s.guess = null;
      s.vote = null;
      this.stopClock();
      this.setPhase('result');
    }

    finish() {
      const s = this.s;
      this.stopClock();
      s.vote = null;
      s.guess = null;
      this.setPhase('end');
      s.awards = this.computeAwards();
      this.dispose();
    }

    /* ---------- Timer ---------- */

    armTimer() {
      clearTimeout(this.timer);
      this.timer = null;
      if (this.hooks.timers === false) return;
      const end = this.s.phase === 'discuss' ? this.s.timerEnd : null;
      if (!end) return;
      this.timer = setTimeout(
        () => {
          if (this.tick()) this.changed();
          else this.armTimer();
        },
        Math.max(0, end - this.now()) + 30
      );
    }

    /** Diskussionszeit abgelaufen → Abstimmung. Gibt true zurück, wenn sich etwas geändert hat. */
    tick() {
      const s = this.s;
      if (s.phase !== 'discuss' || !s.timerEnd || s.timerEnd > this.now()) return false;
      this.event('time');
      this.startVote();
      return true;
    }

    /* ---------- Aktionen ---------- */

    /**
     * Verarbeitet eine Aktion. Gibt true zurück, wenn sich etwas geändert hat.
     * @param {object} a Aktion {type, ...}
     * @param {string} actor 'stage' (Host) oder Spieler-ID (Handy)
     */
    apply(a, actor) {
      if (!a || typeof a.type !== 'string') return false;
      const handler = this['on_' + a.type];
      if (typeof handler !== 'function') return false;
      const ok = handler.call(this, a, actor) === true;
      if (ok) this.changed();
      return ok;
    }

    /* Lobby (Jeder ein Handy) */

    lobbyProblem() {
      const n = this.participants().length;
      if (n < MIN_PLAYERS) return `Mindestens ${MIN_PLAYERS} Personen nötig (gerade ${n}).`;
      return null;
    }

    on_start(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby' || this.lobbyProblem()) return false;
      this.startGame();
      return true;
    }

    on_kick(a, actor) {
      const s = this.s;
      const pid = a.player;
      if (actor !== STAGE || !this.write || pid === STAGE || (!s.members[pid] && !this.player(pid))) return false;
      delete s.members[pid];
      s.players = s.players.filter((p) => p.id !== pid);
      if (this.playing() && s.order.includes(pid)) this.removeFromRound(pid);
      if (this.hooks.onKick) this.hooks.onKick(pid);
      return true;
    }

    removeFromRound(pid) {
      const s = this.s;
      const wasImposter = s.roles[pid] === 'imposter';
      const pos = this.alive().indexOf(pid);
      s.order = s.order.filter((id) => id !== pid);
      delete s.roles[pid];
      delete s.seen[pid];
      delete s.answers[pid];
      if (s.clue && pos !== -1 && pos < s.clue.idx) s.clue.idx -= 1;
      if (s.vote) {
        delete s.vote.votes[pid];
        for (const [voter, target] of Object.entries(s.vote.votes)) if (target === pid) delete s.vote.votes[voter];
        if (s.vote.candidates) {
          s.vote.candidates = s.vote.candidates.filter((id) => id !== pid);
          if (s.vote.candidates.length < 2) Object.assign(s.vote, { runoff: false, candidates: null, votes: {} });
        }
      }
      const impsLeft = this.alive().filter((id) => s.roles[id] === 'imposter').length;
      if (wasImposter || !impsLeft || this.alive().length < MIN_PLAYERS) {
        this.abortRound();
        return;
      }
      if (s.phase === 'reveal') this.checkReveal();
      else if (s.phase === 'answer') this.checkAnswers();
      else if (s.phase === 'vote') this.checkVotes();
      else if (s.phase === 'clues') {
        if (s.clue.idx >= this.alive().length) {
          s.clue.idx -= 1;
          this.advanceClue();
        } else this.skipOffline();
      }
    }

    /** Einstellungen: in der Lobby und zwischen den Runden (Spielweise bleibt) */
    on_settings(a, actor) {
      const s = this.s;
      if (actor !== STAGE || !['lobby', 'result'].includes(s.phase)) return false;
      s.settings = sanitizeSettings(Object.assign({}, a.settings, { input: s.settings.input, hostPlays: s.settings.hostPlays }), s.settings);
      return true;
    }

    /* Verteilen */

    /** „Verstanden“: Ein Gerät → der Host meldet {player}, Handy → die Person selbst */
    on_seen(a, actor) {
      const s = this.s;
      if (s.phase !== 'reveal') return false;
      let pid;
      if (!this.write) {
        if (actor !== STAGE || a.player !== this.holder()) return false;
        pid = a.player;
      } else pid = actor;
      if (!s.order.includes(pid) || s.seen[pid]) return false;
      s.seen[pid] = true;
      this.checkReveal();
      return true;
    }

    /** Host: nicht auf alle warten / Hinweise beenden / weiter nach dem Rauswählen */
    on_continue(a, actor) {
      const s = this.s;
      if (actor !== STAGE || this.stale(a)) return false;
      if (s.phase === 'reveal') this.beginTalk();
      else if (s.phase === 'clues' || s.phase === 'answer' || s.phase === 'out') this.beginDiscuss();
      else return false;
      return true;
    }

    /* Hinweise */

    /** Handy: die Person, die dran ist, ist fertig (bei „Hinweise tippen“ mit Text) */
    on_clue(a, actor) {
      const s = this.s;
      if (s.phase !== 'clues' || !this.write || this.stale(a)) return false;
      if (actor !== this.currentClue()) return false;
      const text = cleanName(a.text, '', MAX_CLUE);
      if (s.rs.typeClues && s.rs.mode === 'word' && !text) return false;
      s.clues.push({ pid: actor, round: s.clue.round, text });
      this.advanceClue();
      return true;
    }

    /** Host: nächste Person (Ein Gerät) bzw. überspringen (Handys) */
    on_nextClue(a, actor) {
      const s = this.s;
      if (s.phase !== 'clues' || actor !== STAGE || this.stale(a)) return false;
      const cur = this.currentClue();
      if (!this.write && cur) s.clues.push({ pid: cur, round: s.clue.round, text: '' });
      this.advanceClue();
      return true;
    }

    /** Host: noch eine Hinweisrunde (aus der Diskussion heraus) */
    on_moreClues(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'discuss' || s.rs.mode !== 'word' || this.stale(a)) return false;
      const last = s.clue ? s.clue.rounds : 0;
      s.clue = { round: last + 1, idx: 0, rounds: last + 1 };
      this.stopClock();
      this.setPhase('clues');
      this.skipOffline();
      return true;
    }

    /* Antworten (Frage-Modus, Handys) */

    on_answer(a, actor) {
      const s = this.s;
      if (s.phase !== 'answer' || !this.alive().includes(actor)) return false;
      const text = cleanName(a.text, '', MAX_ANSWER);
      if (!text) return false;
      s.answers[actor] = text;
      this.checkAnswers();
      return true;
    }

    /* Diskussion & Abstimmung */

    on_startVote(a, actor) {
      if (actor !== STAGE || this.s.phase !== 'discuss' || this.stale(a)) return false;
      this.startVote();
      return true;
    }

    /** Handy: geheim abstimmen (bis alle abgestimmt haben, darf man umentscheiden) */
    on_vote(a, actor) {
      const s = this.s;
      if (s.phase !== 'vote' || !this.write || !s.vote) return false;
      if (a.no !== undefined && a.no !== s.vote.no) return false;
      if (!this.canVote(actor) || a.target === actor || !this.candidates().includes(a.target)) return false;
      s.vote.votes[actor] = a.target;
      this.checkVotes();
      return true;
    }

    /** Host (Handys): Abstimmung beenden, auch wenn noch nicht alle abgestimmt haben */
    on_endVote(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'vote' || !this.write || !s.vote) return false;
      if (a.no !== undefined && a.no !== s.vote.no) return false;
      if (!Object.keys(s.vote.votes).length) return false;
      this.resolveVote();
      return true;
    }

    /**
     * Ein Gerät: Nach „3 – 2 – 1, zeigt!“ tippt der Host an, wer die meisten Stimmen hat.
     * targets: eine Person – oder mehrere bei Gleichstand (→ Stichwahl).
     * voters (optional): wer auf diese eine Person gezeigt hat – für den Bonuspunkt.
     */
    on_accuse(a, actor) {
      const s = this.s;
      if (s.phase !== 'vote' || this.write || actor !== STAGE || !s.vote) return false;
      if (a.no !== undefined && a.no !== s.vote.no) return false;
      const cands = this.candidates();
      const targets = [...new Set(Array.isArray(a.targets) ? a.targets : [])].filter((id) => cands.includes(id));
      if (!targets.length) return false;
      const votes = {};
      if (targets.length === 1 && Array.isArray(a.voters)) {
        for (const id of a.voters) if (id !== targets[0] && this.alive().includes(id)) votes[id] = targets[0];
      }
      this.decide(targets, votes);
      return true;
    }

    /* Letzte Chance: Wort raten */

    on_guess(a, actor) {
      const s = this.s;
      if (s.phase !== 'guess' || !s.guess) return false;
      // Der Host darf für den Imposter tippen (Ein Gerät, Bühne) – ein mitspielender Host nur für sich selbst
      const hostTypes = actor === STAGE && (!this.write || !s.settings.hostPlays);
      if (actor !== s.guess.pid && !hostTypes) return false;
      const text = cleanName(a.text, '', MAX_CLUE);
      if (!text) return false;
      this.judgeGuess(text, Deck.guessMatches(text, s.secret.word));
      return true;
    }

    /** Host: Imposter ist weg oder will nicht raten – zählt als falsch */
    on_skipGuess(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'guess' || !s.guess) return false;
      this.judgeGuess('', false);
      return true;
    }

    judgeGuess(text, correct) {
      const s = this.s;
      const pid = s.guess.pid;
      const o = s.outs.find((x) => x.pid === pid);
      o.guess = text;
      o.correct = correct;
      s.guess = null;
      this.event('guess', { pid, text, correct });
      if (correct) this.finishRound('guess');
      else this.afterOut();
    }

    /** Host: Raten doch anders werten (z.B. „Spaghetti“ statt „Nudeln“ soll zählen) */
    on_judge(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'result' || !s.result || s.result.aborted) return false;
      const last = s.outs[s.outs.length - 1];
      if (!last || last.role !== 'imposter' || last.guess == null || s.rs.mode !== 'word') return false;
      const correct = !!a.correct;
      if (last.correct === correct) return false;
      this.revertResult();
      last.correct = correct;
      if (correct) this.finishRound('guess');
      else this.afterOut();
      return true;
    }

    /* Rundenwechsel */

    on_nextRound(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'result' || this.stale(a)) return false;
      if (s.totalRounds && s.round >= s.totalRounds) {
        this.finish();
        return true;
      }
      if (this.participants().length < MIN_PLAYERS) return false;
      this.startRound();
      return true;
    }

    /** Spiel beenden → Siegerehrung (eine laufende Runde zählt nicht) */
    on_finish(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase === 'lobby' || s.phase === 'end') return false;
      this.finish();
      return true;
    }

    /** Neues Spiel mit denselben Leuten */
    on_again(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'end') return false;
      for (const p of s.players) p.score = 0;
      Object.assign(s, {
        round: 0,
        history: [],
        drinks: [],
        awards: [],
        imposterCount: {},
        lastImposters: [],
        result: null,
        event: null,
        secret: null,
        roles: {},
        order: [],
        outs: [],
        votes: [],
      });
      if (this.write) {
        // Wer während der Siegerehrung dazugekommen ist, spielt jetzt mit
        for (const [id, m] of Object.entries(s.members)) {
          if (!this.player(id) && s.players.length < MAX_PLAYERS) s.players.push({ id, name: m.name, score: 0 });
        }
        this.setPhase('lobby');
      } else this.startGame();
      return true;
    }

    /* ---------- Auszeichnungen ---------- */

    computeAwards() {
      const s = this.s;
      const out = [];
      const best = (counts) => {
        const list = Object.entries(counts).filter(([id, n]) => n > 0 && this.player(id));
        if (!list.length) return null;
        list.sort((a, b) => b[1] - a[1]);
        return { id: list[0][0], n: list[0][1], name: this.playerName(list[0][0]) };
      };
      const hidden = {};
      const caughtCount = {};
      const guessed = {};
      const hits = {};
      const received = {};
      for (const h of s.history) {
        for (const id of h.imposters) {
          const o = h.outs.find((x) => x.pid === id);
          if (!o) hidden[id] = (hidden[id] || 0) + 1;
          else caughtCount[id] = (caughtCount[id] || 0) + 1;
          if (o && o.correct) guessed[id] = (guessed[id] || 0) + 1;
        }
        for (const [id, n] of Object.entries(h.hits)) hits[id] = (hits[id] || 0) + n;
        for (const [id, n] of Object.entries(h.received)) received[id] = (received[id] || 0) + n;
      }
      // Meisterlügner:in: am öftesten unentdeckt – wer nie erwischt wurde, geht vor
      const liars = {};
      for (const [id, n] of Object.entries(hidden)) liars[id] = n * 10 - (caughtCount[id] || 0);
      const liar = best(liars);
      if (liar) {
        const n = hidden[liar.id];
        const never = !caughtCount[liar.id];
        out.push({ icon: '🎭', title: 'Meisterlügner:in', text: `${liar.name} – ${n}× unentdeckt${never ? ', nie erwischt' : ''}` });
      }
      const detective = best(hits);
      if (detective) out.push({ icon: '🔍', title: 'Detektiv:in', text: `${detective.name} – ${detective.n}× richtig getippt` });
      const sus = best(received);
      if (sus) out.push({ icon: '🙈', title: 'Verdächtig', text: `${sus.name} – ${sus.n} ${sus.n === 1 ? 'Stimme' : 'Stimmen'}, obwohl unschuldig` });
      const mind = best(guessed);
      if (mind) out.push({ icon: '🧠', title: 'Gedankenleser:in', text: `${mind.name} – ${mind.n}× das Wort als Imposter erraten` });
      if (s.settings.drinks !== 'off') {
        const top = best(this.drinkTotals());
        if (top) {
          const free = s.settings.drinks === 'free';
          out.push({
            icon: free ? '⚠️' : '🍺',
            title: free ? 'Strafpunkte-König:in' : 'Durstigste',
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
      const pass = !this.write;
      const meId = pass ? null : stage ? (s.settings.hostPlays ? STAGE : null) : viewer;
      const over = s.phase === 'result' || s.phase === 'end';
      const inRound = !!meId && s.order.includes(meId);
      const name = (pid) => (pid ? this.playerName(pid) : null);
      const outOf = (pid) => s.outs.find((o) => o.pid === pid) || null;
      const showAnswers = s.rs && s.rs.mode === 'question' && ['discuss', 'vote', 'guess', 'out', 'result'].includes(s.phase);
      const votedVisible = s.phase === 'vote' && s.vote;
      const drinks = this.drinkTotals();
      const view = {
        game: 'imposter',
        phase: s.phase,
        step: s.step,
        settings: clone(s.settings),
        rs: clone(s.rs),
        round: s.round,
        totalRounds: s.totalRounds,
        maxImposters: maxImposters(Math.max(MIN_PLAYERS, this.playing() ? s.order.length : this.participants().length)),
        players: s.players.map((p) => {
          const o = outOf(p.id);
          return {
            id: p.id,
            name: p.name,
            score: p.score,
            online: this.isOnline(p.id),
            host: p.id === STAGE,
            inRound: s.order.includes(p.id),
            out: !!o,
            // Rollen: erst bei Rauswahl bzw. Rundenende
            role: s.phase === 'result' && s.order.includes(p.id) ? s.roles[p.id] : o ? o.role : null,
            seen: !!s.seen[p.id],
            answered: !!s.answers[p.id],
            voted: votedVisible ? !!s.vote.votes[p.id] : false,
            canVote: votedVisible ? this.canVote(p.id) : false,
            drinks: drinks[p.id] || 0,
            imposterRounds: over ? s.imposterCount[p.id] || 0 : null,
          };
        }),
        order: s.order.slice(),
        clue: s.phase === 'clues' && s.clue ? { round: s.clue.round, rounds: s.clue.rounds, current: this.currentClue() } : null,
        clueRounds: s.clue ? s.clue.rounds : 0,
        clues: s.clues.map((c) => ({ pid: c.pid, name: name(c.pid), round: c.round, text: c.text })),
        crewQuestion: showAnswers ? s.secret.crew : null,
        answers: showAnswers ? clone(s.answers) : {},
        answeredCount: Object.keys(s.answers).length,
        timer: s.phase === 'discuss' && s.timerEnd ? { total: s.timerTotal, remaining: Math.max(0, s.timerEnd - this.now()) } : null,
        vote: s.vote
          ? {
              no: s.vote.no,
              runoff: s.vote.runoff,
              candidates: this.candidates(),
              count: Object.keys(s.vote.votes).length,
              total: this.alive().filter((id) => this.canVote(id) && this.isOnline(id)).length,
            }
          : null,
        // Ergebnisse der Abstimmungen dieser Runde (nur Stimmenzahlen, wer wen gewählt hat erst am Rundenende)
        votes: s.votes.map((v) => ({ no: v.no, runoff: v.runoff, tally: clone(v.tally), top: v.top.slice(), votes: over ? clone(v.votes) : null })),
        outs: s.outs.map((o) => ({ pid: o.pid, name: name(o.pid), role: o.role, guess: o.guess, correct: o.correct })),
        guess: s.guess ? { pid: s.guess.pid, name: name(s.guess.pid) } : null,
        impostersLeft: this.playing() && s.rs && s.rs.voting === 'last' ? this.alive().filter((id) => s.roles[id] === 'imposter').length : null,
        result: s.result
          ? Object.assign(clone(s.result), {
              secret: clone(s.secret),
              category: s.secret && s.secret.kind === 'word' ? Deck.category(s.secret.category) : null,
              names: Object.fromEntries(s.result.imposters.map((id) => [id, name(id)])),
            })
          : null,
        lastRound: !!s.totalRounds && s.round >= s.totalRounds,
        lobbyProblem: s.phase === 'lobby' ? this.lobbyProblem() : null,
        event: clone(s.event),
        drinks: s.drinks.slice(-8).map((d) => Object.assign({}, d)),
        awards: clone(s.awards),
        me: {
          stage,
          host: stage,
          id: meId,
          name: meId ? this.playerName(meId) : '',
          inRound,
          out: inRound && this.isOut(meId),
          card: inRound && this.playing() ? this.cardFor(meId) : null,
          role: inRound && (this.knowsRole() || over) ? s.roles[meId] : null,
          seen: inRound && !!s.seen[meId],
          answer: inRound ? s.answers[meId] || null : null,
          vote: inRound && s.vote ? s.vote.votes[meId] || null : null,
        },
      };
      if (s.phase === 'result' && s.result) view.me.card = inRound ? this.cardFor(meId) : null;
      // Ein Gerät: Das Gerät kennt alle Karten (es wird ja herumgereicht) – die Oberfläche zeigt nur die des Halters
      if (pass && stage) {
        const cards = {};
        if (this.playing()) for (const id of s.order) cards[id] = this.cardFor(id);
        view.pass = { holder: s.phase === 'reveal' ? this.holder() : null, cards };
      }
      return view;
    }
  }

  root.IMEngine = {
    Engine,
    STAGE,
    MODES,
    INPUTS,
    VARIANTS,
    IMPOSTER_OPTIONS,
    CLUE_OPTIONS,
    DISCUSS_OPTIONS,
    ROUND_OPTIONS,
    VOTING_OPTIONS,
    DRINK_OPTIONS,
    DEFAULT_SETTINGS,
    MIN_PLAYERS,
    MAX_PLAYERS,
    MAX_CLUE,
    MAX_ANSWER,
    POINTS,
    DRINKS,
    sanitizeSettings,
    cleanName,
    maxImposters,
  };
})(typeof window !== 'undefined' ? window : globalThis);
