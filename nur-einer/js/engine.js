/*
 * Spiellogik von „Nur einer“ – unsere Version von Just One. Kooperativ: alle gegen den Kartenstapel.
 *
 * Reihum rät eine Person ein geheimes Wort. Alle anderen schreiben einen Hinweis – doppelte und ungültige
 * Hinweise fliegen raus (js/clues.js, die Runde kann per Einspruch korrigieren). Dann rät die Person mit dem,
 * was übrig ist: richtig = Karte gewonnen, falsch = diese und die nächste Karte weg, passen = nur diese weg.
 *
 * Zwei Spielweisen:
 *  - phones: Laptop = Bühne, Handys = Hinweis-Tafeln. Ablauf: write → check → guess → reveal
 *  - one:    ein Gerät, Hinweise auf Zetteln. Ablauf: word (Wort zeigen, ratende Person schaut weg) → guess → reveal
 *
 * Varianten: 13 / 20 / endlos (bis 3 Fehler), große Runde (ab 8: Hinweisgebende abwechselnd in 2 Gruppen),
 * 3 Personen (jede/r schreibt 2 Hinweise), Wettkampf (2 Teams, je ein eigener Stapel), eigenes Wort.
 *
 * Der Laptop ("stage") ist immer der Host. Das Wort steht in keiner Ansicht der ratenden Person und mit Handys
 * auch nicht auf dem Laptop (den sieht die ratende Person ja), bevor aufgelöst wird.
 */
(function (root) {
  'use strict';

  const Words = root.NEWords;
  const Clues = root.NEClues;

  const GAME = 'nur-einer';
  const STAGE = 'stage';
  const TEAMS = [
    { id: 'rot', label: 'Rot', color: '#ef4444' },
    { id: 'blau', label: 'Blau', color: '#3b82f6' },
  ];
  const PLAYER_COLORS = ['#f59e0b', '#38bdf8', '#a855f7', '#22c55e', '#ef4444', '#ec4899', '#14b8a6', '#facc15', '#84cc16', '#f97316', '#818cf8', '#e5e7eb'];
  const INPUTS = ['phones', 'one'];
  const GUESSES = ['voice', 'type'];
  const CARD_OPTIONS = [13, 20, 0]; // 0 = endlos
  const TIMER_OPTIONS = [0, 30, 60];
  const DEFAULT_SETTINGS = {
    input: 'phones',
    cards: 13,
    guess: 'voice',
    level: 'mixed',
    timer: 60,
    split: true,
    versus: false,
    custom: false,
  };
  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 12;
  // Große Runde: ab so vielen Hinweisgebenden wird geteilt (= ab 8 Personen)
  const SPLIT_FROM = 7;
  // Endlos: so viele Fehler, dann ist Schluss
  const MAX_FAILS = 3;
  const MAX_SKIPS = 5;
  const MAX_GUESS = 40;
  const MAX_WORD = 30;
  // So lange wird auf jemanden gewartet, dessen Handy kurz die Verbindung verliert
  const GRACE_MS = 15000;

  // Wertung am Ende (13 Karten, wie im Original); bei 20 Karten wird umgerechnet
  const RATINGS = [
    { min: 13, icon: '🏆', text: 'Perfekt! Schafft ihr das noch mal?' },
    { min: 12, icon: '🤩', text: 'Unglaublich – ihr seid ein eingespieltes Team' },
    { min: 11, icon: '🎉', text: 'Großartig, die Runde redet noch morgen davon' },
    { min: 9, icon: '😎', text: 'Super, da geht aber noch was' },
    { min: 7, icon: '🙂', text: 'Guter Durchschnitt' },
    { min: 4, icon: '😌', text: 'Ganz okay, nächstes Mal besser' },
    { min: 0, icon: '😅', text: "Probiert's noch mal" },
  ];

  function rating(won, cards) {
    const scaled = cards ? Math.round((won * 13) / cards) : won;
    return RATINGS.find((r) => scaled >= r.min) || RATINGS[RATINGS.length - 1];
  }

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
    if (GUESSES.includes(i.guess)) s.guess = i.guess;
    if (CARD_OPTIONS.includes(+i.cards) && i.cards !== null && i.cards !== '') s.cards = +i.cards;
    if (TIMER_OPTIONS.includes(+i.timer) && i.timer !== null && i.timer !== '') s.timer = +i.timer;
    if (Words.LEVEL_IDS.includes(i.level)) s.level = i.level;
    for (const k of ['split', 'versus', 'custom']) if (typeof i[k] === 'boolean') s[k] = i[k];
    // Tippen geht nur mit Handys
    if (s.input === 'one') s.guess = 'voice';
    // Im Wettkampf hat jedes Team einen festen Stapel
    if (s.versus && !s.cards) s.cards = 13;
    return s;
  }

  /** Stapelgröße pro Team (Wettkampf: jedes Team die Hälfte, aufgerundet) */
  function stackSize(settings) {
    if (!settings.cards) return 0;
    return settings.versus ? Math.ceil(settings.cards / 2) : settings.cards;
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
      this.tick();
      this.armTimer();
    }

    /**
     * Neues Spiel aus dem Setup.
     * @param {{settings: object, players?: string[], teamNames?: string[]}} config
     *   players: Namen bei „Ein Gerät“ (im Wettkampf abwechselnd Rot, Blau, Rot …). Mit einem Gerät startet
     *   das Spiel sofort, mit Handys beginnt es in der Lobby.
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
        teams: TEAMS.map((t, i) => ({ id: t.id, label: t.label, color: t.color, name: cleanName((config.teamNames || [])[i], 'Team ' + t.label) })),
        stacks: [],
        turn: 0,
        no: 0,
        cur: null,
        used: [],
        history: [],
        awards: [],
        startedAt: null,
        endedAt: null,
      };
      if (settings.input === 'one') {
        const names = (config.players || []).map((n, i) => cleanName(n, 'Spieler ' + (i + 1))).slice(0, MAX_PLAYERS);
        names.forEach((name, i) => state.players.push({ id: 'p' + (i + 1), name, team: settings.versus ? TEAMS[i % 2].id : null }));
        new Engine(state, Object.assign({ timers: false }, hooks)).startGame();
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

    get versus() {
      return !!this.s.settings.versus;
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

    team(id) {
      return this.s.teams.find((t) => t.id === id) || null;
    }

    isOnline(pid) {
      if (!this.write) return !!this.player(pid);
      const m = this.s.members[pid];
      return !!(m && m.online);
    }

    /** Wird auf die Eingabe dieser Person gewartet? (verbunden oder erst kurz weg) */
    awaited(pid) {
      if (this.isOnline(pid)) return true;
      const m = this.s.members[pid];
      return !!(m && m.offlineAt && this.now() - m.offlineAt < GRACE_MS);
    }

    /** Spielleitung am Handy (z.B. wenn die Bühne ein Fernseher ist): das erste noch verbundene Handy – nie die ratende Person */
    leadPid() {
      if (!this.write) return null;
      const guesser = this.s.cur ? this.s.cur.guesser : null;
      let best = null;
      for (const [pid, m] of Object.entries(this.s.members)) {
        if (!m.online || pid === guesser || !this.player(pid)) continue;
        if (!best || (m.joined || 0) < best.joined) best = { pid, joined: m.joined || 0 };
      }
      return best ? best.pid : null;
    }

    /** Darf diese Person die Runde steuern? (Laptop oder Spielleitung am Handy) */
    leads(actor) {
      return actor === STAGE || (actor && actor === this.leadPid());
    }

    /** Kennung der aktuellen Karte samt Wort – verhindert, dass verspätete Eingaben beim nächsten Wort landen */
    stepKey() {
      const cur = this.s.cur;
      return cur ? `${cur.no}-${cur.wNo}` : null;
    }

    stack() {
      return this.s.stacks[this.s.turn] || null;
    }

    /** Ist ein Stapel durch? (endlos: nach 3 Fehlern) */
    stackDone(st) {
      if (!st.size) return st.fails >= MAX_FAILS;
      return st.deck <= 0;
    }

    /** Spieler eines Stapels (Wettkampf: das Team, sonst alle) */
    stackPlayers(st) {
      return this.s.players.filter((p) => !st.team || p.team === st.team);
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
      // Wer dazukommt, spielt mit (im laufenden Spiel ab der nächsten Karte)
      else if (s.phase !== 'over' && s.players.length < MAX_PLAYERS) this.addPlayer(pid);
      this.checkProgress();
      this.changed();
    }

    addPlayer(pid) {
      const s = this.s;
      let team = null;
      if (this.versus) {
        const count = (id) => s.players.filter((p) => p.team === id).length;
        team = count('blau') < count('rot') ? 'blau' : 'rot';
      }
      s.players.push({ id: pid, name: s.members[pid].name, team });
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
      const size = stackSize(s.settings);
      const teams = this.versus ? TEAMS.map((t) => t.id) : [null];
      s.stacks = teams.map((team) => ({ team, size, deck: size || null, won: 0, lost: 0, fails: 0, rot: 0, played: 0 }));
      s.turn = 0;
      s.no = 0;
      s.cur = null;
      s.history = [];
      s.awards = [];
      s.startedAt = this.now();
      s.endedAt = null;
      this.nextCard();
    }

    /** Nächste Karte vom Stapel, der dran ist (Wettkampf: abwechselnd) */
    nextCard() {
      const s = this.s;
      const open = s.stacks.map((st, i) => i).filter((i) => !this.stackDone(s.stacks[i]));
      if (!open.length) {
        this.finish();
        return;
      }
      if (!open.includes(s.turn)) s.turn = open[0];
      const st = this.stack();
      if (st.size) st.deck -= 1;
      st.played += 1;
      s.no += 1;
      s.cur = { no: s.no, wNo: 0, stack: s.turn, guesser: null, writers: [], resting: [], per: 1, word: null, skips: 0, custom: false };
      this.setupCard();
    }

    /** Ratende Person (reihum, Abgemeldete werden übersprungen) und Hinweisgebende festlegen */
    pickGuesser() {
      const s = this.s;
      const cur = s.cur;
      const st = s.stacks[cur.stack];
      const list = this.stackPlayers(st);
      cur.guesser = null;
      for (let k = 0; k < list.length; k++) {
        const p = list[st.rot % list.length];
        st.rot += 1;
        if (this.isOnline(p.id)) {
          cur.guesser = p.id;
          break;
        }
      }
      if (!cur.guesser && list.length) cur.guesser = list[(st.rot - 1 + list.length) % list.length].id;
      // Hinweisgebende: alle anderen (Wettkampf: aus dem eigenen Team), die gerade da sind
      let writers = list.map((p) => p.id).filter((pid) => pid !== cur.guesser && this.isOnline(pid));
      cur.resting = [];
      // Große Runde: abwechselnd nur die Hälfte (4–6 Personen pro Karte)
      if (s.settings.split && writers.length >= SPLIT_FROM) {
        const half = st.played % 2;
        cur.resting = writers.filter((_, i) => i % 2 !== half);
        writers = writers.filter((_, i) => i % 2 === half);
      }
      cur.writers = writers;
      // Zu wenige Hinweisgebende (3 Personen): jede/r schreibt 2 Hinweise
      cur.per = writers.length <= 2 ? 2 : 1;
    }

    drawWord() {
      const cur = this.s.cur;
      cur.word = Words.draw(this.s.settings.level, this.s.used, { random: this.hooks.random });
      cur.custom = false;
    }

    /** Karte vorbereiten: wer rät, Wort ziehen, Eingaben leeren */
    setupCard() {
      this.pickGuesser();
      this.drawWord();
      this.startWriting();
    }

    /** Hinweise sammeln (mit Handys) bzw. Wort zeigen (ein Gerät) – auch nach einem neuen Wort */
    startWriting() {
      const s = this.s;
      const cur = s.cur;
      cur.clues = {};
      cur.list = null;
      cur.objections = {};
      cur.ready = [];
      cur.away = false;
      cur.guess = null;
      cur.result = null;
      cur.effect = null;
      cur.accepted = false;
      cur.startedAt = this.now();
      if (this.write) {
        const sec = s.settings.timer;
        cur.timerTotal = sec * 1000;
        cur.timerEnd = sec ? cur.startedAt + sec * 1000 : null;
        s.phase = 'write';
      } else {
        cur.timerTotal = 0;
        cur.timerEnd = null;
        s.phase = 'word';
      }
    }

    /** Neues Wort für dieselbe Karte („Kenn ich nicht“, eigenes Wort) */
    newWord(word) {
      const cur = this.s.cur;
      cur.wNo += 1;
      if (word) {
        cur.word = { key: Words.key(word), word, level: 0, src: 'eigenes' };
        cur.custom = true;
      } else this.drawWord();
      this.startWriting();
    }

    finish() {
      const s = this.s;
      s.phase = 'over';
      s.cur = null;
      s.endedAt = this.now();
      s.awards = this.computeAwards();
      this.dispose();
    }

    /** Alle Hinweise abgegeben? (auf Getrennte wird nach der Schonfrist nicht mehr gewartet) */
    writingDone() {
      const cur = this.s.cur;
      return cur.writers.every((pid) => (cur.clues[pid] || []).length >= cur.per || !this.awaited(pid));
    }

    /** Hinweise prüfen und zur Kontrolle zeigen */
    startCheck() {
      const s = this.s;
      const cur = s.cur;
      const items = [];
      for (const pid of cur.writers) {
        (cur.clues[pid] || []).forEach((text, k) => items.push({ id: `${pid}:${k}`, pid, text }));
      }
      const res = Clues.check(
        items.map((x) => x.text),
        cur.word.word
      );
      items.forEach((x, i) => {
        x.auto = res.verdicts[i];
        x.reason = res.reasons[i] || (res.verdicts[i] === 'dupe' ? 'dupe' : null);
        x.out = res.verdicts[i] !== 'ok';
        x.group = res.groups.findIndex((g) => g.includes(i));
      });
      // Nach Gruppen sortiert (gleiche Hinweise nebeneinander), gültige zuerst
      cur.list = res.groups.flatMap((g) => g.map((i) => items[i]));
      cur.timerEnd = null;
      s.phase = 'check';
    }

    /** Gültige Hinweise (nach der Kontrolle) */
    validClues() {
      const cur = this.s.cur;
      return (cur.list || []).filter((x) => !x.out);
    }

    /* ---------- Wertung ---------- */

    /** Ergebnis einer Karte auf den Stapel anwenden. Gibt die Änderungen zurück (zum Rückgängig-Machen). */
    score(st, result) {
      const e = { won: 0, lost: 0, deck: 0, fails: 0, burned: null };
      if (result === 'won') e.won = 1;
      else {
        e.lost = 1;
        if (result === 'lost') {
          if (!st.size) e.fails = 1;
          else if (st.deck > 0) {
            // Falsch: Die nächste Karte ist auch weg
            e.deck = -1;
            e.lost += 1;
            e.burned = 'next';
          } else if (st.won > 0) {
            // Letzte Karte falsch geraten: dafür geht eine schon gewonnene Karte verloren
            e.won = -1;
            e.lost += 1;
            e.burned = 'won';
          }
        }
      }
      st.won += e.won;
      st.lost += e.lost;
      if (st.size) st.deck += e.deck;
      st.fails += e.fails;
      return e;
    }

    unscore(st, e) {
      st.won -= e.won;
      st.lost -= e.lost;
      if (st.size) st.deck -= e.deck;
      st.fails -= e.fails;
    }

    resolve(result) {
      const s = this.s;
      const cur = s.cur;
      const st = s.stacks[cur.stack];
      cur.result = result;
      cur.effect = this.score(st, result);
      cur.timerEnd = null;
      s.phase = 'reveal';
    }

    pushHistory() {
      const s = this.s;
      const cur = s.cur;
      s.history.push({
        no: cur.no,
        stack: cur.stack,
        team: s.stacks[cur.stack].team,
        word: cur.word.word,
        custom: cur.custom,
        guesser: cur.guesser,
        guesserName: this.playerName(cur.guesser),
        result: cur.result,
        accepted: cur.accepted,
        guess: cur.guess ? cur.guess.text : null,
        clues: (cur.list || []).map((x) => ({ pid: x.pid, name: this.playerName(x.pid), text: x.text, out: x.out, reason: x.out ? x.reason || 'manual' : null, auto: x.auto })),
      });
    }

    /** Mit Handys: prüfen, ob alle fertig sind bzw. ob die ratende Person weg ist */
    checkProgress() {
      const s = this.s;
      const cur = s.cur;
      if (!cur || !this.write) return;
      if (s.phase === 'write' && this.writingDone()) this.startCheck();
    }

    /* ---------- Zeitlimit (mit Handys) ---------- */

    nextDeadline() {
      const s = this.s;
      if (s.phase !== 'write' || !s.cur || !this.write) return null;
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

    /** Abgelaufene Zeit auswerten. Gibt true zurück, wenn sich etwas geändert hat. */
    tick() {
      const s = this.s;
      if (s.phase !== 'write' || !s.cur || !this.write) return false;
      if (s.cur.timerEnd && s.cur.timerEnd <= this.now()) {
        this.startCheck();
        return true;
      }
      this.checkProgress();
      return s.phase !== 'write';
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

    /** Aktion gehört zur aktuellen Karte? (a.at weglassen = egal) */
    current(a) {
      return a.at === undefined || a.at === this.stepKey();
    }

    /* Lobby */

    on_settings(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby') return false;
      s.settings = sanitizeSettings(Object.assign({}, a.settings, { input: s.settings.input }), s.settings);
      // Wettkampf eingeschaltet: Wer noch kein Team hat, kommt ins kleinere
      if (this.versus) {
        for (const p of s.players) {
          if (p.team) continue;
          const count = (id) => s.players.filter((x) => x.team === id).length;
          p.team = count('blau') < count('rot') ? 'blau' : 'rot';
        }
      }
      return true;
    }

    /** Wettkampf: Team wählen (Handy für sich selbst, Laptop für alle) */
    on_joinTeam(a, actor) {
      const s = this.s;
      if (!this.versus || s.phase !== 'lobby' || !TEAMS.some((t) => t.id === a.team)) return false;
      const pid = actor === STAGE ? a.player : actor;
      const p = this.player(pid);
      if (!p || p.team === a.team) return false;
      p.team = a.team;
      return true;
    }

    on_teamName(a, actor) {
      if (actor !== STAGE) return false;
      const t = this.team(a.team);
      if (!t) return false;
      t.name = cleanName(a.name, 'Team ' + t.label);
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
        this.addPlayer(actor);
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
      if (this.hooks.onKick) this.hooks.onKick(pid);
      const cur = s.cur;
      if (cur && s.phase !== 'over') {
        cur.writers = cur.writers.filter((x) => x !== pid);
        delete cur.clues[pid];
        if (cur.list) cur.list = cur.list.filter((x) => x.pid !== pid);
        if (cur.guesser === pid && s.phase !== 'reveal') {
          // Ratende Person weg: Karte mit jemand anderem neu beginnen (ohne Wertung)
          if (!s.players.length) this.finish();
          else {
            cur.wNo += 1;
            this.setupCard();
          }
          return true;
        }
      }
      this.checkProgress();
      return true;
    }

    lobbyProblem() {
      const s = this.s;
      const here = s.players.filter((p) => this.isOnline(p.id));
      if (!this.versus) return here.length < MIN_PLAYERS ? `Ihr braucht mindestens ${MIN_PLAYERS} Personen – scannt den QR-Code!` : null;
      for (const t of TEAMS) {
        const n = here.filter((p) => p.team === t.id).length;
        if (n < 2) return `${this.team(t.id).name} braucht mindestens 2 Personen.`;
      }
      return null;
    }

    on_start(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby' || this.lobbyProblem()) return false;
      s.players = s.players.filter((p) => this.isOnline(p.id));
      if (!this.versus) for (const p of s.players) p.team = null;
      this.startGame();
      return true;
    }

    /* Wort */

    /** „Kenn ich nicht“ – neues Wort (Hinweisgebende am Handy, Laptop) */
    on_skip(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!cur || !['write', 'word'].includes(s.phase) || !this.current(a)) return false;
      if (actor !== STAGE && !cur.writers.includes(actor) && !cur.resting.includes(actor)) return false;
      if (cur.skips >= MAX_SKIPS && actor !== STAGE) return false;
      cur.skips += 1;
      cur.skippedBy = actor === STAGE ? null : this.playerName(actor);
      this.newWord();
      return true;
    }

    /** Eigenes Wort (Einstellung „Eigenes Wort“): Laptop oder Spielleitung am Handy */
    on_customWord(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!s.settings.custom || !cur || !['write', 'word'].includes(s.phase) || !this.leads(actor)) return false;
      const word = cleanName(a.word, '', MAX_WORD);
      if (!root.GameMatch.normalize(word)) return false;
      cur.skippedBy = null;
      this.newWord(word);
      return true;
    }

    /* Hinweise schreiben (mit Handys) */

    on_clue(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!this.write || s.phase !== 'write' || !cur || !this.current(a) || !cur.writers.includes(actor)) return false;
      const raw = Array.isArray(a.texts) ? a.texts : [a.text];
      const texts = raw.slice(0, cur.per).map((t) => Clues.clean(t));
      if (texts.length !== cur.per || texts.some((t) => !root.GameMatch.normalize(t))) return false;
      cur.clues[actor] = texts;
      this.checkProgress();
      return true;
    }

    /** Hinweis zurückziehen und ändern (solange noch nicht alle fertig sind) */
    on_unclue(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'write' || !cur || !this.current(a) || !cur.clues[actor]) return false;
      delete cur.clues[actor];
      return true;
    }

    /** Jetzt vergleichen, auch wenn noch nicht alle fertig sind */
    on_closeWriting(a, actor) {
      const s = this.s;
      if (!this.leads(actor) || s.phase !== 'write' || !s.cur || !this.current(a)) return false;
      this.startCheck();
      return true;
    }

    /* Kontrolle */

    /** Ratende Person bestätigt: „Ich schaue weg“ (oder der Laptop für sie) */
    on_away(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'check' || !cur || cur.away || !this.current(a)) return false;
      if (actor !== STAGE && actor !== cur.guesser) return false;
      cur.away = true;
      return true;
    }

    /** Spielleitung: Hinweis doch gültig / doch streichen */
    on_verdict(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'check' || !cur || !this.leads(actor) || !this.current(a)) return false;
      const item = (cur.list || []).find((x) => x.id === a.id);
      if (!item) return false;
      item.out = typeof a.out === 'boolean' ? a.out : !item.out;
      if (item.out && !item.reason) item.reason = 'manual';
      delete cur.objections[item.id];
      return true;
    }

    /** Hinweisgebende: Einspruch zu einem Hinweis (nochmal = zurücknehmen) */
    on_objection(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'check' || !cur || !this.current(a) || actor === cur.guesser || !this.player(actor)) return false;
      if (!(cur.list || []).some((x) => x.id === a.id)) return false;
      const list = cur.objections[a.id] || [];
      cur.objections[a.id] = list.includes(actor) ? list.filter((x) => x !== actor) : list.concat(actor);
      if (!cur.objections[a.id].length) delete cur.objections[a.id];
      cur.ready = cur.ready.filter((x) => x !== actor);
      return true;
    }

    /** Hinweisgebende: „Passt so“ */
    on_ready(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'check' || !cur || !this.current(a) || actor === cur.guesser || !this.player(actor) || cur.ready.includes(actor)) return false;
      cur.ready.push(actor);
      for (const id of Object.keys(cur.objections)) {
        cur.objections[id] = cur.objections[id].filter((x) => x !== actor);
        if (!cur.objections[id].length) delete cur.objections[id];
      }
      return true;
    }

    /** Spielleitung: Kontrolle fertig – die ratende Person darf schauen */
    on_release(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'check' || !cur || !this.leads(actor) || !this.current(a)) return false;
      cur.away = true;
      cur.startedAt = this.now();
      s.phase = 'guess';
      return true;
    }

    /* Ein Gerät */

    /** Hinweise sind geschrieben (und Doppelte von Hand aussortiert) – die ratende Person darf schauen */
    on_written(a, actor) {
      const s = this.s;
      if (actor !== STAGE || this.write || s.phase !== 'word' || !s.cur || !this.current(a)) return false;
      s.cur.startedAt = this.now();
      s.phase = 'guess';
      return true;
    }

    /* Raten */

    /** Ratende Person tippt die Antwort (Einstellung „tippen“) */
    on_guess(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!this.write || s.phase !== 'guess' || !cur || actor !== cur.guesser || s.settings.guess !== 'type' || !this.current(a)) return false;
      const text = cleanName(a.text, '', MAX_GUESS);
      if (!root.GameMatch.normalize(text)) return false;
      cur.guess = { text, by: actor };
      this.resolve(Clues.correct(text, cur.word.word) ? 'won' : 'lost');
      return true;
    }

    /** Ratende Person passt */
    on_pass(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'guess' || !cur || actor !== cur.guesser || !this.current(a)) return false;
      this.resolve('pass');
      return true;
    }

    /** Spielleitung: richtig / falsch / passen (laut geraten – oder wenn das Handy der ratenden Person streikt) */
    on_judge(a, actor) {
      const s = this.s;
      if (s.phase !== 'guess' || !s.cur || !this.leads(actor) || !this.current(a)) return false;
      if (!['won', 'lost', 'pass'].includes(a.result)) return false;
      this.resolve(a.result);
      return true;
    }

    /** „Zählt doch“ – die getippte Antwort war richtig gemeint (nochmal = zurücknehmen) */
    on_accept(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'reveal' || !cur || !this.leads(actor) || !cur.guess) return false;
      if (!cur.accepted && cur.result !== 'lost') return false;
      const st = s.stacks[cur.stack];
      this.unscore(st, cur.effect);
      cur.accepted = !cur.accepted;
      cur.result = cur.accepted ? 'won' : 'lost';
      cur.effect = this.score(st, cur.result);
      return true;
    }

    /** Ein Gerät: Ergebnis korrigieren (falsch geklickt) */
    on_rejudge(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'reveal' || !cur || actor !== STAGE || !['won', 'lost', 'pass'].includes(a.result) || a.result === cur.result) return false;
      const st = s.stacks[cur.stack];
      this.unscore(st, cur.effect);
      cur.result = a.result;
      cur.accepted = false;
      cur.effect = this.score(st, cur.result);
      return true;
    }

    on_next(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (!this.leads(actor) || !cur || s.phase !== 'reveal') return false;
      if (a.no !== undefined && a.no !== cur.no) return false;
      this.pushHistory();
      // Wettkampf: das andere Team ist dran
      if (this.versus) s.turn = (s.turn + 1) % s.stacks.length;
      this.nextCard();
      return true;
    }

    on_end(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase === 'lobby' || s.phase === 'over') return false;
      if (s.phase === 'reveal') this.pushHistory();
      else if (s.cur) {
        // Die laufende Karte zählt nicht – zurück auf den Stapel
        const st = s.stacks[s.cur.stack];
        if (st.size) st.deck += 1;
        st.played -= 1;
      }
      this.finish();
      return true;
    }

    /** Nochmal mit denselben Leuten */
    on_again(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'over') return false;
      if (this.write) {
        s.phase = 'lobby';
        s.cur = null;
        s.stacks = [];
        s.history = [];
        s.awards = [];
        s.no = 0;
        s.players = s.players.filter((p) => s.members[p.id]);
      } else this.startGame();
      return true;
    }

    /* ---------- Statistik ---------- */

    /** Pro Person: Hinweise gesamt, davon einzigartig / doppelt / ungültig */
    playerStats() {
      const out = {};
      for (const h of this.s.history) {
        for (const c of h.clues) {
          const o = (out[c.pid] = out[c.pid] || { name: c.name, clues: 0, unique: 0, dupes: 0, invalid: 0 });
          o.name = c.name;
          o.clues += 1;
          if (c.auto === 'dupe') o.dupes += 1;
          else if (c.auto === 'invalid') o.invalid += 1;
          else o.unique += 1;
        }
      }
      return out;
    }

    computeAwards() {
      const s = this.s;
      const out = [];
      if (!this.write || !s.history.length) return out;
      const stats = this.playerStats();
      // 🦄 Einzigartig: nie doppelt, die meisten Hinweise
      const uniq = Object.entries(stats)
        .filter(([, o]) => o.clues >= 3 && !o.dupes)
        .sort((a, b) => b[1].clues - a[1].clues);
      if (uniq.length) out.push({ icon: '🦄', title: 'Einzigartig', text: `${uniq[0][1].name} – ${uniq[0][1].clues} Hinweise, kein einziger doppelt` });
      // 👯 Seelenverwandte: die zwei, die am häufigsten denselben Hinweis hatten
      const pairs = {};
      for (const h of s.history) {
        const dupes = h.clues.filter((c) => c.auto === 'dupe');
        for (let i = 0; i < dupes.length; i++) {
          for (let j = i + 1; j < dupes.length; j++) {
            const x = dupes[i];
            const y = dupes[j];
            if (x.pid === y.pid || !Clues.alike(x.text, y.text)) continue;
            const k = [x.pid, y.pid].sort().join('|');
            pairs[k] = pairs[k] || { names: [x.name, y.name], n: 0, words: [] };
            pairs[k].n += 1;
            pairs[k].words.push(x.text);
          }
        }
      }
      const best = Object.values(pairs).sort((a, b) => b.n - a.n)[0];
      if (best && best.n >= 2) out.push({ icon: '👯', title: 'Seelenverwandte', text: `${best.names.join(' & ')} – ${best.n}× derselbe Hinweis (${best.words.slice(0, 3).map((w) => `„${w}“`).join(', ')})` });
      // 🎯 Bester Hinweis: einziger übrig gebliebener Hinweis, der trotzdem gereicht hat
      const solo = s.history.filter((h) => h.result === 'won' && h.clues.filter((c) => !c.out).length === 1);
      if (solo.length) {
        const h = solo[solo.length - 1];
        const c = h.clues.find((x) => !x.out);
        out.push({ icon: '🎯', title: 'Bester Hinweis', text: `${c.name}: „${c.text}“ – der einzige Hinweis für „${h.word}“, und ${h.guesserName} hatte es` });
      }
      // 👯‍♂️ Doppelt hält nicht besser: wer am häufigsten gestrichen wurde
      const dup = Object.values(stats).sort((a, b) => b.dupes - a.dupes)[0];
      if (dup && dup.dupes >= 3) out.push({ icon: '🙈', title: 'Gleiche Wellenlänge', text: `${dup.name} – ${dup.dupes} Hinweise, die jemand anderes auch hatte` });
      // 🧠 Ratefuchs: die meisten richtig geratenen Wörter
      const guessed = {};
      for (const h of s.history) if (h.result === 'won') guessed[h.guesserName] = (guessed[h.guesserName] || 0) + 1;
      const fox = Object.entries(guessed).sort((a, b) => b[1] - a[1]);
      if (fox.length && fox[0][1] >= 2 && (fox.length < 2 || fox[1][1] < fox[0][1])) out.push({ icon: '🧠', title: 'Ratefuchs', text: `${fox[0][0]} – ${fox[0][1]} Wörter erraten` });
      return out;
    }

    /* ---------- Ansicht ---------- */

    timerView() {
      const cur = this.s.cur;
      if (!cur || !cur.timerEnd || this.s.phase !== 'write') return null;
      return { total: cur.timerTotal, remaining: Math.max(0, cur.timerEnd - this.now()) };
    }

    clueView(x, withReason) {
      const cur = this.s.cur;
      return {
        id: x.id,
        pid: x.pid,
        name: this.playerName(x.pid),
        text: x.text,
        out: x.out,
        auto: withReason ? x.auto : undefined,
        reason: withReason && x.out ? x.reason || 'manual' : null,
        group: x.group,
        objections: withReason && this.s.phase === 'check' ? (cur.objections[x.id] || []).map((pid) => this.playerName(pid)) : [],
      };
    }

    curView(viewer) {
      const s = this.s;
      const cur = s.cur;
      if (!cur) return null;
      const stage = viewer === STAGE;
      const isGuesser = viewer === cur.guesser;
      const st = s.stacks[cur.stack];
      const phase = s.phase;
      const revealed = phase === 'reveal';
      const v = {
        no: cur.no,
        wNo: cur.wNo,
        key: this.stepKey(),
        stack: cur.stack,
        team: st.team,
        guesser: cur.guesser,
        guesserName: this.playerName(cur.guesser),
        writers: cur.writers.slice(),
        resting: cur.resting.slice(),
        per: cur.per,
        skips: cur.skips,
        skipsLeft: Math.max(0, MAX_SKIPS - cur.skips),
        skippedBy: cur.skippedBy || null,
        custom: cur.custom,
        away: !!cur.away,
        timer: this.timerView(),
        result: revealed ? cur.result : null,
        burned: revealed && cur.effect ? cur.effect.burned : null,
        accepted: revealed ? cur.accepted : false,
        guess: revealed && cur.guess ? cur.guess.text : null,
        typed: !!cur.guess,
        word: null,
        clues: null,
        valid: null,
        submitted: this.write ? cur.writers.filter((pid) => (cur.clues[pid] || []).length >= cur.per) : [],
        waiting: this.write && phase === 'write' ? cur.writers.filter((pid) => !(cur.clues[pid] || []).length && this.awaited(pid)) : [],
        ready: (cur.ready || []).slice(),
      };
      // Das Wort: nie für die ratende Person, auf dem Laptop (mit Handys) erst bei der Auflösung,
      // ein Gerät: der Laptop zeigt es in der Wort-Phase (die ratende Person schaut weg)
      const wordOk = revealed || (!isGuesser && !stage) || (stage && !this.write && phase === 'word');
      if (wordOk) v.word = cur.word.word;
      if (!this.write) return v;
      // Eigene Hinweise
      if (cur.clues[viewer]) v.mine = cur.clues[viewer].slice();
      const list = cur.list || [];
      if (revealed) v.clues = list.map((x) => this.clueView(x, true));
      else if (phase === 'check') {
        // Kontrolle: Handys der Hinweisgebenden sehen alles, der Laptop erst wenn die ratende Person wegschaut
        if (!isGuesser && (!stage || cur.away)) v.clues = list.map((x) => this.clueView(x, true));
      } else if (phase === 'guess') {
        // Raten: nur die gültigen (der Laptop ist jetzt für alle sichtbar)
        v.valid = this.validClues().map((x) => x.text);
        if (!isGuesser && !stage) v.clues = list.map((x) => this.clueView(x, true));
      }
      return v;
    }

    viewFor(viewer) {
      const s = this.s;
      const stage = viewer === STAGE;
      const me = stage ? null : this.player(viewer);
      const st = this.stack();
      return {
        game: GAME,
        phase: s.phase,
        settings: Object.assign({}, s.settings),
        size: stackSize(s.settings),
        maxFails: MAX_FAILS,
        players: s.players.map((p, i) => ({ id: p.id, name: p.name, team: p.team, color: PLAYER_COLORS[i % PLAYER_COLORS.length], online: this.isOnline(p.id) })),
        members: this.write ? Object.entries(s.members).map(([id, m]) => ({ id, name: m.name, online: m.online, playing: !!this.player(id) })) : [],
        teams: s.teams.map((t) => ({ id: t.id, label: t.label, name: t.name, color: t.color })),
        stacks: s.stacks.map((x) => ({ team: x.team, size: x.size, deck: x.deck, won: x.won, lost: x.lost, fails: x.fails, played: x.played, rating: s.phase === 'over' ? rating(x.won, x.size) : null })),
        turn: s.turn,
        no: s.no,
        lobbyProblem: s.phase === 'lobby' && this.write ? this.lobbyProblem() : null,
        awards: clone(s.awards),
        stats: s.phase === 'over' && this.write ? this.playerStats() : null,
        history:
          s.phase === 'over'
            ? s.history.map((h) => ({ no: h.no, team: h.team, word: h.word, guesser: h.guesserName, result: h.result, clues: h.clues.map((c) => ({ text: c.text, out: c.out, name: c.name })) }))
            : [],
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        cur: this.curView(viewer),
        current: st ? { team: st.team } : null,
        me: stage
          ? { stage: true }
          : {
              id: viewer,
              name: (s.members[viewer] || {}).name || '',
              playing: !!me,
              team: me ? me.team : null,
              lead: viewer === this.leadPid(),
              stepKey: this.stepKey(),
            },
      };
    }
  }

  root.NEEngine = {
    Engine,
    GAME,
    STAGE,
    TEAMS,
    PLAYER_COLORS,
    CARD_OPTIONS,
    TIMER_OPTIONS,
    DEFAULT_SETTINGS,
    MIN_PLAYERS,
    MAX_PLAYERS,
    SPLIT_FROM,
    MAX_FAILS,
    MAX_SKIPS,
    MAX_GUESS,
    MAX_WORD,
    GRACE_MS,
    RATINGS,
    rating,
    stackSize,
    sanitizeSettings,
    cleanName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
