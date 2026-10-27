/*
 * Spiellogik von „Pointe!“.
 *
 * Laptop = Bühne, geschrieben und abgestimmt wird auf den Handys. Ablauf:
 *   lobby → [Duell-Runde: write → (duel → result) × n → scores] × 2 oder 3 → Letzte Pointe: final-write → final-vote → final-result → end
 *   „Nur Finale“: drei Runden Letzte Pointe hintereinander.
 *
 * Duell-Runden: Alle sitzen im Kreis (pairing.js), Duell i = Person i gegen Person i+1 – jede/r bekommt zwei Satzanfänge
 * gegen zwei verschiedene Gegner. Auf der Bühne stehen die beiden Antworten ohne Namen, alle anderen stimmen ab.
 * Punkte (× Runde 1/2/3): 10 pro Prozent der Stimmen, +100 fürs gewonnene Duell, +250 für eine „Pointe!“ (alle Stimmen).
 * Leere oder ausgeblendete Antwort verliert kampflos. Rettung (vorgefertigte Antwort) halbiert die Punkte.
 * Publikum (wer nicht schreibt) zählt zusammen als 20 % der Stimmen.
 *
 * Letzte Pointe: Alle beantworten denselben Satzanfang (1–3 Lücken), jede/r verteilt 3 Stimmen (nicht an sich selbst),
 * 300 Punkte pro Stimme.
 *
 * Sprachausgabe: Mit „Vorlesen“ startet die Abstimmungszeit erst, wenn der Laptop fertig vorgelesen hat
 * (Aktion read, spätestens nach READ_MS) – abstimmen kann man aber schon vorher.
 *
 * Gefilterte Ansichten: Autoren erst ab result; die Satzanfänge einer Duell-Runde sehen beim Schreiben nur die beiden
 * Duellierenden; während der Abstimmung niemand, wer wofür gestimmt hat.
 */
(function (root) {
  'use strict';

  const Prompts = root.PointePrompts;
  const Pairing = root.PointePairing;

  const GAME = 'pointe';
  const STAGE = 'stage';
  const PLAYER_COLORS = ['#ff5c8a', '#38bdf8', '#facc15', '#22c55e', '#a855f7', '#f97316', '#14b8a6', '#ef4444', '#818cf8', '#84cc16', '#ec4899', '#e5e7eb'];
  const ROUND_OPTIONS = [2, 3, 0]; // 0 = nur Finale-Runden
  const WRITE_OPTIONS = [60, 90, 120];
  const VOTE_OPTIONS = [10, 15, 20];
  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 10;
  const MAX_ANSWER = 80;
  const FINAL_ROUNDS = 3; // bei „Nur Finale“
  const FINAL_VOTES = 3;
  const AUDIENCE_SHARE = 0.2;
  const POINTS = { pct: 10, win: 100, pointe: 250, vote: 300 };
  const GRACE_MS = 1500; // Schreibzeit um: kurz auf die letzten Eingaben der Handys warten
  const READ_MS = 15000; // höchstens so lange wartet ein Duell auf die Sprachausgabe
  const READ_FINAL_MS = 50000;
  const FINAL_EXTRA_S = 20; // Finale: mehr Schreibzeit pro weiterer Lücke
  const SIPS_ZERO = 2; // Trinkregeln: keine einzige Stimme
  const SIPS_POINTE = 3; // Trinkregeln: Pointe! → so viele Schlucke verteilen
  const DEFAULT_SETTINGS = {
    rounds: 2,
    writeTime: 90,
    voteTime: 15,
    categories: Prompts.DEFAULT_CATEGORIES.slice(),
    family: false,
    names: false,
    audience: true,
    speech: true,
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

  function cleanAnswer(text) {
    return String(text == null ? '' : text)
      .replace(/[\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_ANSWER);
  }

  function clone(o) {
    return o == null ? o : JSON.parse(JSON.stringify(o));
  }

  function filled(ans) {
    return !!(ans && Array.isArray(ans.parts) && ans.parts.some(Boolean));
  }

  /** Gleiche Antwort? (Groß/klein, Satzzeichen egal) */
  function same(a, b) {
    return Prompts.slug(a) === Prompts.slug(b);
  }

  function sanitizeSettings(input, current) {
    const s = Object.assign({}, current || DEFAULT_SETTINGS);
    const i = input || {};
    const num = (v) => (v === null || v === '' || v === undefined ? NaN : +v);
    if (ROUND_OPTIONS.includes(num(i.rounds))) s.rounds = num(i.rounds);
    if (WRITE_OPTIONS.includes(num(i.writeTime))) s.writeTime = num(i.writeTime);
    if (VOTE_OPTIONS.includes(num(i.voteTime))) s.voteTime = num(i.voteTime);
    for (const k of ['family', 'names', 'audience', 'speech', 'drinks']) if (typeof i[k] === 'boolean') s[k] = i[k];
    if (Array.isArray(i.categories)) s.categories = Prompts.cleanCategories(i.categories);
    s.categories = Prompts.cleanCategories(s.categories);
    return s;
  }

  /** Rundenfolge: z. B. ['duels', 'duels', 'final'] */
  function roundPlan(settings) {
    const n = (settings || DEFAULT_SETTINGS).rounds;
    if (!n) return Array.from({ length: FINAL_ROUNDS }, () => 'final');
    return Array.from({ length: n }, () => 'duels').concat('final');
  }

  /** Stimmengewicht des Publikums: zusammen AUDIENCE_SHARE aller Stimmen (ohne Spieler-Stimmen: zählt allein) */
  function audienceWeight(playerVotes, audVotes) {
    if (!audVotes) return 0;
    if (!playerVotes) return audVotes;
    return (playerVotes * AUDIENCE_SHARE) / (1 - AUDIENCE_SHARE);
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

    static create(config) {
      return {
        v: 1,
        game: GAME,
        settings: sanitizeSettings((config || {}).settings),
        phase: 'lobby',
        members: {},
        players: [],
        round: 0,
        rounds: [],
        used: [],
        current: 0,
        writeEnd: null,
        readEnd: null,
        voteEnd: null,
        awards: [],
        startedAt: null,
        endedAt: null,
      };
    }

    static newPlayer(id, name) {
      return { id, name };
    }

    dispose() {
      clearTimeout(this.timer);
      this.timer = null;
    }

    changed() {
      this.armTimer();
      if (this.hooks.onChange) this.hooks.onChange();
    }

    /* Mit Handys wird immer gespielt (StageController öffnet dann einen Raum) */
    get write() {
      return true;
    }

    /* ---------- Hilfsfunktionen ---------- */

    player(pid) {
      return this.s.players.find((p) => p.id === pid) || null;
    }

    playerName(pid) {
      const p = this.player(pid);
      if (p) return p.name;
      const m = this.s.members[pid];
      return m ? m.name : '?';
    }

    colorOf(pid) {
      const i = this.s.players.findIndex((p) => p.id === pid);
      return i < 0 ? '#94a3b8' : PLAYER_COLORS[i % PLAYER_COLORS.length];
    }

    isOnline(pid) {
      const m = this.s.members[pid];
      return !!(m && m.online);
    }

    /** Spielleitung am Handy: das am längsten verbundene Handy, das mitspielt */
    leadPid() {
      let best = null;
      for (const [pid, m] of Object.entries(this.s.members)) {
        if (!m.online || !this.player(pid)) continue;
        if (!best || (m.joined || 0) < best.joined) best = { pid, joined: m.joined || 0 };
      }
      return best ? best.pid : null;
    }

    leads(actor) {
      return actor === STAGE || (actor && actor === this.leadPid());
    }

    /** Stimmt diese Person ab – als Mitspieler/in oder als Publikum? */
    voterType(pid) {
      if (!pid || pid === STAGE) return null;
      if (this.player(pid)) return 'player';
      if (this.s.members[pid] && this.s.settings.audience) return 'aud';
      return null;
    }

    plan() {
      return roundPlan(this.s.settings);
    }

    cur() {
      return this.s.rounds[this.s.rounds.length - 1] || null;
    }

    duel() {
      const r = this.cur();
      return r && r.kind === 'duels' ? r.duels[this.s.current] || null : null;
    }

    final() {
      const r = this.cur();
      return r && r.kind === 'final' ? r.final : null;
    }

    /** Kennung des aktuellen Schritts – Klicks aus einem älteren Schritt werden ignoriert */
    stepKey() {
      return `${this.s.phase}:${this.s.round}:${this.s.current}`;
    }

    stale(a) {
      return a.step !== undefined && a.step !== this.stepKey();
    }

    /* ---------- Verbindungen ---------- */

    connect(pid, name) {
      const s = this.s;
      const m = s.members[pid];
      if (m) {
        m.online = true;
        delete m.offlineAt;
        if (name) m.name = cleanName(name, m.name);
      } else {
        s.members[pid] = { name: cleanName(name, 'Gast'), online: true, joined: this.now() };
        // Wer neu dazukommt, schreibt mit (mitten im Spiel: ab der nächsten Runde) – ab 11 Personen Publikum
        if (s.phase !== 'end' && s.players.length < MAX_PLAYERS) s.players.push(Engine.newPlayer(pid, s.members[pid].name));
      }
      const p = this.player(pid);
      if (p) p.name = s.members[pid].name;
      this.changed();
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
        if (m.online) m.offlineAt = now;
        m.online = false;
      }
    }

    /** Wer in der neuen Runde schreibt: alle verbundenen Mitspielenden (sind es zu wenige, alle) */
    activePlayers() {
      const online = this.s.players.filter((p) => this.isOnline(p.id));
      return online.length >= MIN_PLAYERS ? online : this.s.players.slice();
    }

    /* ---------- Ablauf ---------- */

    startGame() {
      const s = this.s;
      s.round = 0;
      s.rounds = [];
      s.used = [];
      s.current = 0;
      s.awards = [];
      s.startedAt = this.now();
      s.endedAt = null;
      this.nextRound();
    }

    nextRound() {
      const s = this.s;
      const plan = this.plan();
      s.round += 1;
      s.current = 0;
      s.readEnd = null;
      s.voteEnd = null;
      const kind = plan[s.round - 1];
      const active = this.activePlayers().map((p) => p.id);
      const names = (exclude) => s.players.filter((p) => !exclude.includes(p.id)).map((p) => p.name);
      if (kind === 'duels') {
        const mult = plan.slice(0, s.round).filter((k) => k === 'duels').length;
        const avoid = [];
        for (const r of s.rounds) if (r.kind === 'duels') for (const d of r.duels) avoid.push(Pairing.pairKey(d.a, d.b));
        const pairs = Pairing.duels(active, this.random, avoid);
        const prompts = Prompts.draw(Prompts.pool(s.settings, 'duel'), pairs.length, s.used, this.random);
        const duels = pairs.map((pr, i) => ({
          id: `r${s.round}d${i}`,
          prompt: Prompts.prepare(prompts[i % prompts.length], names([pr.a, pr.b]), this.random),
          a: pr.a,
          b: pr.b,
          answers: {},
          votes: {},
          aud: {},
          hidden: {},
          flip: this.random() < 0.5,
          done: false,
        }));
        s.rounds.push({ no: s.round, kind, mult, duels });
        s.phase = 'write';
        s.writeEnd = this.now() + s.settings.writeTime * 1000;
      } else {
        const [p] = Prompts.draw(Prompts.pool(s.settings, 'final'), 1, s.used, this.random);
        const prompt = Prompts.prepare(p, names([]), this.random);
        s.rounds.push({
          no: s.round,
          kind: 'final',
          mult: 1,
          final: { id: `r${s.round}f`, prompt, pids: active, answers: {}, order: [], votes: {}, aud: {}, hidden: {}, done: false },
        });
        s.phase = 'final-write';
        s.writeEnd = this.now() + (s.settings.writeTime + FINAL_EXTRA_S * (prompt.blanks - 1)) * 1000;
      }
    }

    /**
     * Haben alle geschrieben? Auch auf kurz Getrennte (gesperrtes Handy) wird gewartet –
     * wer gar nicht zurückkommt, verpasst eben die Zeit.
     */
    writingDone() {
      const r = this.cur();
      if (!r) return false;
      if (r.kind === 'duels') return r.duels.every((d) => filled(d.answers[d.a]) && filled(d.answers[d.b]));
      return r.final.pids.every((pid) => filled(r.final.answers[pid]));
    }

    finishWriting() {
      this.s.writeEnd = null;
      if (this.s.phase === 'write') this.startDuel(0);
      else if (this.s.phase === 'final-write') this.startFinalVote();
    }

    startDuel(i) {
      const s = this.s;
      s.current = i;
      s.phase = 'duel';
      s.writeEnd = null;
      const d = this.duel();
      if (this.duelResult(d, 1).forfeit) {
        this.closeDuel();
        return;
      }
      if (s.settings.speech) {
        s.readEnd = this.now() + READ_MS;
        s.voteEnd = null;
      } else this.startVoting();
    }

    /** Vorlesen fertig (oder ohne Sprachausgabe): Abstimmungszeit läuft */
    startVoting() {
      const s = this.s;
      s.readEnd = null;
      s.voteEnd = this.now() + (s.phase === 'final-vote' ? this.finalVoteSeconds() : s.settings.voteTime) * 1000;
      if (s.phase === 'duel' && this.allVotedDuel(this.duel())) this.closeDuel();
      else if (s.phase === 'final-vote' && this.allVotedFinal(this.final())) this.closeFinal();
    }

    finalVoteSeconds() {
      return Math.max(30, this.s.settings.voteTime * 2);
    }

    closeDuel() {
      const d = this.duel();
      if (d) d.done = true;
      this.s.phase = 'result';
      this.s.readEnd = null;
      this.s.voteEnd = null;
    }

    startFinalVote() {
      const s = this.s;
      const f = this.final();
      s.writeEnd = null;
      f.order = Pairing.shuffle(
        f.pids.filter((pid) => filled(f.answers[pid])),
        this.random
      );
      s.phase = 'final-vote';
      if (f.order.length < 2) {
        this.closeFinal();
        return;
      }
      if (s.settings.speech) {
        s.readEnd = this.now() + Math.min(READ_FINAL_MS, 8000 + 3500 * f.order.length);
        s.voteEnd = null;
      } else this.startVoting();
    }

    closeFinal() {
      const f = this.final();
      if (f) f.done = true;
      this.s.phase = 'final-result';
      this.s.readEnd = null;
      this.s.voteEnd = null;
    }

    endRound() {
      if (this.s.round >= this.plan().length) this.finish();
      else this.s.phase = 'scores';
    }

    finish() {
      const s = this.s;
      s.phase = 'end';
      s.endedAt = this.now();
      s.writeEnd = null;
      s.readEnd = null;
      s.voteEnd = null;
      s.awards = this.computeAwards();
      this.dispose();
    }

    /* ---------- Abstimmung ---------- */

    /** Wer stimmt in diesem Duell ab? (verbundene Mitspielende außerhalb des Duells + Publikum) */
    duelVoters(d) {
      return Object.keys(this.s.members).filter((pid) => this.isOnline(pid) && pid !== d.a && pid !== d.b && this.voterType(pid));
    }

    allVotedDuel(d) {
      if (!d) return false;
      return this.duelVoters(d).every((pid) => d.votes[pid] || d.aud[pid]);
    }

    finalVoters() {
      return Object.keys(this.s.members).filter((pid) => this.isOnline(pid) && this.voterType(pid));
    }

    /** Wie viele Stimmen kann diese Person im Finale vergeben? (nicht an sich selbst, nicht an Ausgeblendete) */
    finalChoices(f, pid) {
      return f.order.filter((x) => x !== pid && !f.hidden[x]).length;
    }

    finalUsed(f, pid) {
      const v = f.votes[pid] || f.aud[pid] || {};
      return Object.values(v).reduce((a, b) => a + b, 0);
    }

    allVotedFinal(f) {
      if (!f) return false;
      return this.finalVoters().every((pid) => !this.finalChoices(f, pid) || this.finalUsed(f, pid) >= FINAL_VOTES);
    }

    /* ---------- Wertung ---------- */

    /**
     * Ergebnis eines Duells.
     * @returns {{sides: object[], forfeit: null|'a'|'b'|'both', voters: number, aud: number}}
     *   sides[0] = a, sides[1] = b: {key, pid, parts, rescue, hidden, present, votes: pid[], aud, pct, points, win, pointe}
     */
    duelResult(d, mult) {
      const m = mult || 1;
      const side = (k) => {
        const pid = d[k];
        const ans = d.answers[pid];
        const hidden = !!d.hidden[pid];
        return { key: k, pid, parts: ans ? ans.parts.slice() : [], rescue: !!(ans && ans.rescue), hidden, present: filled(ans) && !hidden, votes: [], aud: 0, pct: 0, points: 0, win: false, pointe: false };
      };
      const A = side('a');
      const B = side('b');
      let forfeit = null;
      if (!A.present && !B.present) forfeit = 'both';
      else if (!A.present) forfeit = 'a';
      else if (!B.present) forfeit = 'b';
      let P = 0;
      let Au = 0;
      if (forfeit === 'a' || forfeit === 'b') {
        const w = forfeit === 'a' ? B : A;
        w.pct = 100;
        w.win = true;
      } else if (!forfeit) {
        const by = { a: A, b: B };
        for (const [pid, pick] of Object.entries(d.votes)) if (by[pick] && this.player(pid)) by[pick].votes.push(pid);
        for (const [pid, pick] of Object.entries(d.aud)) if (by[pick] && this.s.members[pid] && !this.player(pid)) by[pick].aud += 1;
        P = A.votes.length + B.votes.length;
        Au = A.aud + B.aud;
        const audW = audienceWeight(P, Au);
        const total = P + audW;
        if (total > 0) for (const x of [A, B]) x.pct = (100 * (x.votes.length + (Au ? (audW * x.aud) / Au : 0))) / total;
        A.win = A.pct > B.pct;
        B.win = B.pct > A.pct;
        A.pointe = A.votes.length + A.aud > 0 && !B.votes.length && !B.aud;
        B.pointe = B.votes.length + B.aud > 0 && !A.votes.length && !A.aud;
      }
      for (const x of [A, B]) {
        if (!x.present) continue;
        let p = Math.round(x.pct * POINTS.pct * m) + (x.win ? POINTS.win * m : 0) + (x.pointe ? POINTS.pointe * m : 0);
        if (x.rescue) p = Math.round(p / 2);
        x.points = p;
      }
      return { sides: [A, B], forfeit, voters: P, aud: Au };
    }

    /**
     * Ergebnis einer Letzten Pointe.
     * @returns {{entries: object[], voters: number, aud: number}} entries in der Reihenfolge der Bühne (+ wer nichts geschrieben hat)
     */
    finalResult(f) {
      const entries = f.order.map((pid, i) => {
        const ans = f.answers[pid];
        const hidden = !!f.hidden[pid];
        return { key: String(i), pid, parts: ans ? ans.parts.slice() : [], rescue: !!(ans && ans.rescue), hidden, present: filled(ans) && !hidden, votes: 0, aud: 0, weight: 0, points: 0 };
      });
      for (const pid of f.pids) if (!f.order.includes(pid)) entries.push({ key: null, pid, parts: [], rescue: false, hidden: false, present: false, votes: 0, aud: 0, weight: 0, points: 0 });
      const byKey = Object.fromEntries(entries.filter((e) => e.key !== null).map((e) => [e.key, e]));
      let P = 0;
      let Au = 0;
      for (const [voter, map] of Object.entries(f.votes)) {
        if (!this.player(voter)) continue;
        for (const [k, n] of Object.entries(map)) if (byKey[k] && byKey[k].present && byKey[k].pid !== voter) (byKey[k].votes += n), (P += n);
      }
      for (const [voter, map] of Object.entries(f.aud)) {
        if (this.player(voter) || !this.s.members[voter]) continue;
        for (const [k, n] of Object.entries(map)) if (byKey[k] && byKey[k].present) (byKey[k].aud += n), (Au += n);
      }
      const audW = audienceWeight(P, Au);
      for (const e of entries) {
        if (!e.present) continue;
        e.weight = e.votes + (Au ? (audW * e.aud) / Au : 0);
        let p = Math.round(POINTS.vote * e.weight);
        if (e.rescue) p = Math.round(p / 2);
        e.points = p;
      }
      return { entries, voters: P, aud: Au };
    }

    /** Punkte einer Runde (nur fertig aufgelöste Duelle bzw. Finale) */
    roundGains(r) {
      const out = {};
      const add = (pid, n) => (out[pid] = (out[pid] || 0) + n);
      if (r.kind === 'duels') {
        for (const d of r.duels) if (d.done) for (const x of this.duelResult(d, r.mult).sides) add(x.pid, x.points);
      } else if (r.final.done) {
        for (const e of this.finalResult(r.final).entries) add(e.pid, e.points);
      }
      return out;
    }

    totals() {
      const t = {};
      for (const p of this.s.players) t[p.id] = 0;
      for (const r of this.s.rounds) for (const [pid, n] of Object.entries(this.roundGains(r))) t[pid] = (t[pid] || 0) + n;
      return t;
    }

    standings() {
      const t = this.totals();
      const sorted = this.s.players.slice().sort((a, b) => t[b.id] - t[a.id]);
      return sorted.map((p) => ({ id: p.id, name: p.name, score: t[p.id], place: sorted.findIndex((x) => t[x.id] === t[p.id]) + 1 }));
    }

    /** Trinkregeln eines Duells: keine Stimme → 2 Schlucke, Pointe! → 3 verteilen */
    duelSips(res) {
      if (!this.s.settings.drinks || res.forfeit === 'both') return null;
      const sips = {};
      let give = null;
      const total = res.voters + res.aud;
      for (const x of res.sides) {
        if (!x.present || (!res.forfeit && total > 0 && !x.votes.length && !x.aud)) sips[x.pid] = SIPS_ZERO;
        if (x.pointe) give = { pid: x.pid, n: SIPS_POINTE };
      }
      return { sips, give };
    }

    finalSips(res) {
      if (!this.s.settings.drinks) return null;
      const sips = {};
      for (const e of res.entries) if (!e.points) sips[e.pid] = SIPS_ZERO;
      const top = Math.max(0, ...res.entries.map((e) => e.points));
      const best = res.entries.filter((e) => e.points === top);
      return { sips, give: top > 0 && best.length === 1 ? { pid: best[0].pid, n: SIPS_POINTE } : null };
    }

    /* ---------- Zeitlimit ---------- */

    nextDeadline() {
      const s = this.s;
      if ((s.phase === 'write' || s.phase === 'final-write') && s.writeEnd) return s.writeEnd + GRACE_MS;
      if (s.phase === 'duel' || s.phase === 'final-vote') return s.readEnd || s.voteEnd || null;
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
      for (let guard = 0; guard < 5; guard++) {
        const now = this.now();
        if ((s.phase === 'write' || s.phase === 'final-write') && s.writeEnd && s.writeEnd + GRACE_MS <= now) this.finishWriting();
        else if ((s.phase === 'duel' || s.phase === 'final-vote') && s.readEnd && s.readEnd <= now) this.startVoting();
        else if (s.phase === 'duel' && s.voteEnd && s.voteEnd <= now) this.closeDuel();
        else if (s.phase === 'final-vote' && s.voteEnd && s.voteEnd <= now) this.closeFinal();
        else break;
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
      if (actor !== STAGE || this.s.phase !== 'lobby') return false;
      this.s.settings = sanitizeSettings(a.settings, this.s.settings);
      return true;
    }

    /** Mitschreiben / nur abstimmen (Handy, in der Lobby) */
    on_watch(a, actor) {
      const s = this.s;
      if (actor === STAGE || s.phase !== 'lobby' || !s.members[actor]) return false;
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
      if (actor !== STAGE || !s.members[a.player]) return false;
      const pid = a.player;
      s.players = s.players.filter((p) => p.id !== pid);
      delete s.members[pid];
      if (this.hooks.onKick) this.hooks.onKick(pid);
      const r = this.cur();
      if (r && r.kind === 'duels') {
        for (const d of r.duels) {
          if (!d.done) delete d.answers[pid];
          delete d.votes[pid];
          delete d.aud[pid];
        }
      } else if (r && !r.final.done) {
        const f = r.final;
        delete f.votes[pid];
        delete f.aud[pid];
        if (s.phase === 'final-write') {
          f.pids = f.pids.filter((x) => x !== pid);
          delete f.answers[pid];
        }
      }
      // Was jetzt kampflos ist oder wo alle abgestimmt haben, geht weiter
      if (s.phase === 'duel' && (this.duelResult(this.duel(), 1).forfeit || (!s.readEnd && this.allVotedDuel(this.duel())))) this.closeDuel();
      else if (s.phase === 'final-vote' && !s.readEnd && this.allVotedFinal(this.final())) this.closeFinal();
      else if ((s.phase === 'write' || s.phase === 'final-write') && this.writingDone()) this.finishWriting();
      return true;
    }

    lobbyProblem() {
      const here = this.s.players.filter((p) => this.isOnline(p.id));
      if (here.length < MIN_PLAYERS) return `Ihr braucht mindestens ${MIN_PLAYERS} Personen zum Schreiben – scannt den QR-Code!`;
      return null;
    }

    on_start(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby' || this.lobbyProblem()) return false;
      s.players = s.players.filter((p) => this.isOnline(p.id));
      this.startGame();
      return true;
    }

    /* Schreiben */

    /** Antwort auf einen eigenen Satzanfang: {target: Duell- oder Finale-ID, parts: [...]} (oder text) */
    on_answer(a, actor) {
      const s = this.s;
      if (s.phase !== 'write' && s.phase !== 'final-write') return false;
      const r = this.cur();
      let box = null;
      if (s.phase === 'write') box = r.duels.find((d) => d.id === a.target && (d.a === actor || d.b === actor)) || null;
      else if (r.final.id === a.target && r.final.pids.includes(actor)) box = r.final;
      if (!box) return false;
      const blanks = box.prompt.blanks;
      const raw = Array.isArray(a.parts) ? a.parts : [a.text];
      const parts = Array.from({ length: blanks }, (_, i) => cleanAnswer(raw[i]));
      const old = box.answers[actor];
      if (!parts.some(Boolean)) {
        if (!old) return false;
        delete box.answers[actor];
        return true;
      }
      const rescue = box.prompt.rescues.some((r2) => r2.every((x, i) => same(x, parts[i])));
      if (old && old.rescue === rescue && old.parts.every((x, i) => x === parts[i])) return false;
      box.answers[actor] = { parts, rescue };
      if (this.writingDone()) this.finishWriting();
      return true;
    }

    /* Abstimmung */

    /** Duell: {duel, pick: 'a'|'b'} – die eigenen Duelle nicht, umentscheiden geht */
    on_vote(a, actor) {
      const s = this.s;
      const d = this.duel();
      if (s.phase !== 'duel' || !d || a.duel !== d.id || !['a', 'b'].includes(a.pick)) return false;
      const type = this.voterType(actor);
      if (!type || actor === d.a || actor === d.b) return false;
      const map = type === 'player' ? d.votes : d.aud;
      if (map[actor] === a.pick) return false;
      map[actor] = a.pick;
      delete (type === 'player' ? d.aud : d.votes)[actor];
      if (!s.readEnd && this.allVotedDuel(d)) this.closeDuel();
      return true;
    }

    /** Finale: {final, votes: {key: Anzahl}} – höchstens 3 zusammen, nicht für sich selbst */
    on_votes(a, actor) {
      const s = this.s;
      const f = this.final();
      if (s.phase !== 'final-vote' || !f || a.final !== f.id || !a.votes || typeof a.votes !== 'object') return false;
      const type = this.voterType(actor);
      if (!type) return false;
      const clean = {};
      let sum = 0;
      for (const [k, v] of Object.entries(a.votes)) {
        const n = Math.floor(+v);
        if (!n) continue;
        const pid = f.order[+k];
        if (!/^\d+$/.test(k) || !pid || n < 0 || n > FINAL_VOTES || pid === actor || f.hidden[pid]) return false;
        clean[k] = n;
        sum += n;
      }
      if (sum > FINAL_VOTES) return false;
      const map = type === 'player' ? f.votes : f.aud;
      if (JSON.stringify(map[actor] || {}) === JSON.stringify(clean)) return false;
      map[actor] = clean;
      delete (type === 'player' ? f.aud : f.votes)[actor];
      if (!s.readEnd && this.allVotedFinal(f)) this.closeFinal();
      return true;
    }

    /** Laptop: fertig vorgelesen – die Abstimmungszeit läuft */
    on_read(a, actor) {
      const s = this.s;
      if (actor !== STAGE || !s.readEnd) return false;
      if (s.phase === 'duel' && a.target === (this.duel() || {}).id) this.startVoting();
      else if (s.phase === 'final-vote' && a.target === (this.final() || {}).id) this.startVoting();
      else return false;
      return true;
    }

    /**
     * Spielleitung: Antwort ausblenden (🙈) oder wieder zeigen – {target, key, hidden}.
     * Im Duell zählt es dann für den Gegner. Die eigene Antwort (und im eigenen Duell) nur der Laptop.
     */
    on_hide(a, actor) {
      const s = this.s;
      if (!this.leads(actor)) return false;
      const hidden = a.hidden !== false;
      if (s.phase === 'duel' || s.phase === 'result') {
        const d = this.duel();
        if (!d || a.target !== d.id || !['a', 'b'].includes(a.key)) return false;
        if (actor !== STAGE && (actor === d.a || actor === d.b)) return false;
        const pid = d[a.key];
        if (!!d.hidden[pid] === hidden) return false;
        if (hidden) d.hidden[pid] = true;
        else delete d.hidden[pid];
        if (s.phase === 'duel' && this.duelResult(d, 1).forfeit) this.closeDuel();
        return true;
      }
      if (s.phase === 'final-vote' || s.phase === 'final-result') {
        const f = this.final();
        const pid = f && a.target === f.id ? f.order[+a.key] : null;
        if (!pid || (actor !== STAGE && actor === pid)) return false;
        if (!!f.hidden[pid] === hidden) return false;
        if (hidden) {
          f.hidden[pid] = true;
          // Stimmen für die ausgeblendete Antwort gehen zurück
          for (const map of [f.votes, f.aud]) for (const v of Object.values(map)) delete v[a.key];
        } else delete f.hidden[pid];
        return true;
      }
      return false;
    }

    /* Weiter */

    /**
     * Weiter: nächstes Duell / Runde abschließen / nächste Runde. force: Schreiben oder Abstimmen sofort beenden.
     * step (optional): nur, wenn der Klick zum aktuellen Schritt gehört.
     */
    on_next(a, actor) {
      const s = this.s;
      if (!this.leads(actor) || this.stale(a)) return false;
      switch (s.phase) {
        case 'write':
        case 'final-write':
          if (!a.force) return false;
          this.finishWriting();
          return true;
        case 'duel':
          if (!a.force) return false;
          this.closeDuel();
          return true;
        case 'final-vote':
          if (!a.force) return false;
          this.closeFinal();
          return true;
        case 'result':
          if (s.current < this.cur().duels.length - 1) this.startDuel(s.current + 1);
          else this.endRound();
          return true;
        case 'final-result':
          this.endRound();
          return true;
        case 'scores':
          this.nextRound();
          return true;
      }
      return false;
    }

    on_end(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase === 'lobby' || s.phase === 'end') return false;
      this.finish();
      return true;
    }

    /** Nochmal mit denselben Leuten */
    on_again(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'end') return false;
      s.phase = 'lobby';
      s.round = 0;
      s.rounds = [];
      s.used = [];
      s.current = 0;
      s.awards = [];
      s.players = s.players.filter((p) => s.members[p.id]);
      return true;
    }

    /* ---------- Statistik ---------- */

    /** Alle aufgelösten Antworten des Spiels (für Statistik und Rückblick) */
    allResults() {
      const duels = [];
      const finals = [];
      for (const r of this.s.rounds) {
        if (r.kind === 'duels') {
          for (const d of r.duels) if (d.done) duels.push({ round: r.no, mult: r.mult, prompt: d.prompt, res: this.duelResult(d, r.mult) });
        } else if (r.final.done) finals.push({ round: r.no, prompt: r.final.prompt, res: this.finalResult(r.final) });
      }
      return { duels, finals };
    }

    playerStats() {
      const st = {};
      for (const p of this.s.players) st[p.id] = { pointes: 0, wins: 0, zero: 0, rescues: 0, votes: 0, answers: 0 };
      const { duels, finals } = this.allResults();
      for (const { res } of duels) {
        for (const x of res.sides) {
          const o = st[x.pid];
          if (!o) continue;
          if (x.present) o.answers += 1;
          if (x.present && x.rescue) o.rescues += 1;
          if (x.pointe) o.pointes += 1;
          if (x.win) o.wins += 1;
          o.votes += x.votes.length;
          if (x.present && !res.forfeit && res.voters + res.aud > 0 && !x.votes.length && !x.aud) o.zero += 1;
        }
      }
      for (const { res } of finals) {
        for (const e of res.entries) {
          const o = st[e.pid];
          if (!o) continue;
          if (e.present) o.answers += 1;
          if (e.present && e.rescue) o.rescues += 1;
          o.votes += e.votes;
        }
      }
      return st;
    }

    computeAwards() {
      const s = this.s;
      const out = [];
      if (!s.rounds.length || s.players.length < 2) return out;
      const st = this.playerStats();
      const text = (parts) => parts.filter(Boolean).join(' · ');
      const best = (key, min) => {
        const top = Math.max(0, ...s.players.map((p) => st[p.id][key]));
        if (top < min) return null;
        return { names: s.players.filter((p) => st[p.id][key] === top).map((p) => p.name), n: top };
      };
      const names = (b) => b.names.join(' & ');
      const pointes = best('pointes', 1);
      if (pointes) out.push({ icon: '🎤', title: 'Pointen-König/in', text: `${names(pointes)} – ${pointes.n} ${pointes.n === 1 ? 'Pointe!' : 'Pointen!'}` });
      const { duels, finals } = this.allResults();
      // Beste Antwort: höchster Anteil, bei Gleichstand mehr Stimmen, dann die spätere
      let top = null;
      for (const { prompt, res } of duels) {
        if (res.forfeit || !(res.voters + res.aud)) continue;
        for (const x of res.sides) {
          const n = x.votes.length + x.aud;
          if (x.present && (!top || x.pct > top.pct || (x.pct === top.pct && n >= top.n))) top = { pct: x.pct, n, x, prompt };
        }
      }
      if (top) out.push({ icon: '🔥', title: 'Beste Antwort des Abends', text: `„${text(top.x.parts)}“ – ${this.playerName(top.x.pid)} (${Math.round(top.pct)} %)`, sub: top.prompt.text });
      // Grillenzirpen: keine einzige Stimme – die Antwort, gegen die am meisten gestimmt wurde
      let cricket = null;
      for (const { prompt, res } of duels) {
        if (res.forfeit) continue;
        for (const x of res.sides) {
          const other = res.sides.find((y) => y !== x);
          const against = other.votes.length + other.aud;
          if (x.present && !x.votes.length && !x.aud && against > 0 && (!cricket || against >= cricket.against)) cricket = { x, prompt, against };
        }
      }
      if (cricket) out.push({ icon: '🦗', title: 'Grillenzirpen', text: `„${text(cricket.x.parts)}“ – ${this.playerName(cricket.x.pid)} (0 Stimmen)`, sub: cricket.prompt.text });
      const rescues = best('rescues', 1);
      if (rescues) out.push({ icon: '🎲', title: 'Retter/in in der Not', text: `${names(rescues)} – ${rescues.n}× die Rettung benutzt` });
      let fin = null;
      for (const { prompt, res } of finals) for (const e of res.entries) if (e.present && e.points > 0 && (!fin || e.points >= fin.e.points)) fin = { e, prompt };
      if (fin) out.push({ icon: '👑', title: 'Letzte Pointe', text: `„${text(fin.e.parts)}“ – ${this.playerName(fin.e.pid)} (+${fin.e.points})`, sub: fin.prompt.text });
      return out;
    }

    /* ---------- Ansicht ---------- */

    timerView() {
      const s = this.s;
      if ((s.phase === 'write' || s.phase === 'final-write') && s.writeEnd) {
        const r = this.cur();
        const sec = s.phase === 'write' ? s.settings.writeTime : s.settings.writeTime + FINAL_EXTRA_S * (r.final.prompt.blanks - 1);
        return { total: sec * 1000, remaining: Math.max(0, s.writeEnd - this.now()) };
      }
      if ((s.phase === 'duel' || s.phase === 'final-vote') && s.voteEnd) {
        const sec = s.phase === 'duel' ? s.settings.voteTime : this.finalVoteSeconds();
        return { total: sec * 1000, remaining: Math.max(0, s.voteEnd - this.now()) };
      }
      return null;
    }

    /** Rettungen in eigener Reihenfolge, damit die beiden im Duell nicht dieselbe als Erstes bekommen */
    rescuesFor(prompt, offset) {
      const list = prompt.rescues;
      return list.map((_, i) => list[(i + offset) % list.length].slice());
    }

    writeView(viewer) {
      const s = this.s;
      if (s.phase !== 'write' && s.phase !== 'final-write') return null;
      const r = this.cur();
      const progress = [];
      const mine = [];
      if (r.kind === 'duels') {
        const need = {};
        for (const d of r.duels) {
          for (const [pid, off] of [
            [d.a, 0],
            [d.b, 1],
          ]) {
            const n = (need[pid] = need[pid] || { id: pid, need: 0, done: 0 });
            n.need += 1;
            if (filled(d.answers[pid])) n.done += 1;
            if (pid === viewer) {
              const ans = d.answers[pid];
              mine.push({ target: d.id, text: d.prompt.text, blanks: 1, rescues: this.rescuesFor(d.prompt, off), parts: ans ? ans.parts.slice() : [''], rescue: !!(ans && ans.rescue) });
            }
          }
        }
        progress.push(...Object.values(need));
      } else {
        const f = r.final;
        for (const [i, pid] of f.pids.entries()) {
          progress.push({ id: pid, need: 1, done: filled(f.answers[pid]) ? 1 : 0 });
          if (pid === viewer) {
            const ans = f.answers[pid];
            mine.push({ target: f.id, text: f.prompt.text, blanks: f.prompt.blanks, rescues: this.rescuesFor(f.prompt, i), parts: ans ? ans.parts.slice() : Array(f.prompt.blanks).fill(''), rescue: !!(ans && ans.rescue) });
          }
        }
      }
      return {
        progress,
        mine,
        // Den Satzanfang des Finales sehen alle, die der Duelle nur die beiden im Duell
        prompt: r.kind === 'final' ? { text: r.final.prompt.text, blanks: r.final.prompt.blanks } : null,
      };
    }

    duelView(viewer) {
      const s = this.s;
      if (s.phase !== 'duel' && s.phase !== 'result') return null;
      const r = this.cur();
      const d = this.duel();
      const res = this.duelResult(d, r.mult);
      const stage = viewer === STAGE;
      const reveal = s.phase === 'result';
      const order = d.flip ? [1, 0] : [0, 1];
      const role = stage ? 'stage' : viewer === d.a || viewer === d.b ? 'duelist' : this.voterType(viewer) ? 'voter' : 'watch';
      const sides = order.map((i) => {
        const x = res.sides[i];
        const mine = !stage && viewer === x.pid;
        const out = { key: x.key, parts: x.hidden && !mine ? null : x.parts.slice(), hidden: x.hidden, empty: !filled(d.answers[x.pid]), mine };
        if (reveal) {
          Object.assign(out, {
            pid: x.pid,
            name: this.playerName(x.pid),
            color: this.colorOf(x.pid),
            rescue: x.rescue,
            pct: Math.round(x.pct),
            points: x.points,
            win: x.win,
            pointe: x.pointe,
            voters: x.votes.map((pid) => ({ name: this.playerName(pid), color: this.colorOf(pid) })),
            aud: x.aud,
          });
        }
        return out;
      });
      const voters = this.duelVoters(d);
      return {
        id: d.id,
        no: s.current + 1,
        total: r.duels.length,
        mult: r.mult,
        prompt: { text: d.prompt.text },
        sides,
        role,
        myPick: stage ? null : d.votes[viewer] || d.aud[viewer] || null,
        voted: voters.filter((pid) => d.votes[pid] || d.aud[pid]).length,
        voterCount: voters.length,
        forfeit: res.forfeit,
        sips: reveal ? this.duelSips(res) : null,
        last: s.current === r.duels.length - 1,
      };
    }

    finalView(viewer) {
      const s = this.s;
      if (!['final-write', 'final-vote', 'final-result'].includes(s.phase)) return null;
      const f = this.final();
      const stage = viewer === STAGE;
      const out = { id: f.id, prompt: { text: f.prompt.text, blanks: f.prompt.blanks }, votes: FINAL_VOTES, writing: f.pids.includes(viewer) };
      if (s.phase === 'final-vote') {
        const voters = this.finalVoters();
        const my = stage ? null : f.votes[viewer] || f.aud[viewer] || {};
        out.answers = f.order.map((pid, i) => {
          const mine = !stage && pid === viewer;
          return { key: String(i), parts: f.hidden[pid] && !mine ? null : f.answers[pid].parts.slice(), hidden: !!f.hidden[pid], mine };
        });
        out.myVotes = my ? Object.assign({}, my) : null;
        out.canVote = !stage && !!this.voterType(viewer);
        out.done = voters.filter((pid) => !this.finalChoices(f, pid) || this.finalUsed(f, pid) >= FINAL_VOTES).length;
        out.voterCount = voters.length;
      }
      if (s.phase === 'final-result') {
        const res = this.finalResult(f);
        out.results = res.entries
          .map((e) => ({
            key: e.key,
            pid: e.pid,
            name: this.playerName(e.pid),
            color: this.colorOf(e.pid),
            parts: e.parts.slice(),
            hidden: e.hidden,
            present: e.present,
            rescue: e.rescue,
            votes: e.votes,
            aud: e.aud,
            points: e.points,
          }))
          .sort((a, b) => b.points - a.points || (b.present ? 1 : 0) - (a.present ? 1 : 0));
        out.sips = this.finalSips(res);
      }
      return out;
    }

    /** Rückblick am Ende: alle Duelle und Finale */
    historyView() {
      const { duels, finals } = this.allResults();
      const name = (pid) => this.playerName(pid);
      return this.s.rounds.map((r) => {
        if (r.kind === 'duels') {
          return {
            no: r.no,
            kind: r.kind,
            mult: r.mult,
            items: duels
              .filter((x) => x.round === r.no)
              .map(({ prompt, res }) => ({ prompt: prompt.text, forfeit: res.forfeit, sides: res.sides.map((x) => ({ name: name(x.pid), parts: x.hidden ? null : x.parts, pct: Math.round(x.pct), points: x.points, pointe: x.pointe, win: x.win })) })),
          };
        }
        const fin = finals.find((x) => x.round === r.no);
        return {
          no: r.no,
          kind: r.kind,
          prompt: r.final.prompt.text,
          entries: fin ? fin.res.entries.filter((e) => e.present).sort((a, b) => b.points - a.points).map((e) => ({ name: name(e.pid), parts: e.parts, points: e.points })) : [],
        };
      });
    }

    viewFor(viewer) {
      const s = this.s;
      const stage = viewer === STAGE;
      const me = stage ? null : this.player(viewer);
      const plan = this.plan();
      const r = this.cur();
      const totals = this.totals();
      return {
        game: GAME,
        phase: s.phase,
        step: this.stepKey(),
        settings: clone(s.settings),
        players: s.players.map((p, i) => ({ id: p.id, name: p.name, color: PLAYER_COLORS[i % PLAYER_COLORS.length], online: this.isOnline(p.id), score: totals[p.id] || 0 })),
        audience: Object.entries(s.members)
          .filter(([id]) => !this.player(id))
          .map(([id, m]) => ({ id, name: m.name, online: m.online })),
        round: s.round,
        rounds: plan.length,
        plan,
        kind: r ? r.kind : null,
        mult: r ? r.mult : 1,
        timer: this.timerView(),
        reading: !!s.readEnd,
        write: this.writeView(viewer),
        duel: this.duelView(viewer),
        final: this.finalView(viewer),
        gains: s.phase === 'scores' && r ? this.roundGains(r) : null,
        standings: this.standings(),
        lobbyProblem: s.phase === 'lobby' ? this.lobbyProblem() : null,
        awards: clone(s.awards),
        stats: s.phase === 'end' ? this.playerStats() : null,
        history: s.phase === 'end' ? this.historyView() : [],
        startedAt: s.startedAt,
        me: stage
          ? { stage: true }
          : {
              id: viewer,
              name: (s.members[viewer] || {}).name || '',
              playing: !!me,
              audience: !me && !!s.settings.audience,
              lead: viewer === this.leadPid(),
            },
      };
    }
  }

  root.PointeEngine = {
    Engine,
    GAME,
    STAGE,
    PLAYER_COLORS,
    ROUND_OPTIONS,
    WRITE_OPTIONS,
    VOTE_OPTIONS,
    MIN_PLAYERS,
    MAX_PLAYERS,
    MAX_ANSWER,
    FINAL_ROUNDS,
    FINAL_VOTES,
    AUDIENCE_SHARE,
    POINTS,
    GRACE_MS,
    READ_MS,
    SIPS_ZERO,
    SIPS_POINTE,
    DEFAULT_SETTINGS,
    sanitizeSettings,
    roundPlan,
    audienceWeight,
    cleanName,
    cleanAnswer,
  };
})(typeof window !== 'undefined' ? window : globalThis);
