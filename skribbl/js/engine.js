/*
 * Spiellogik von „Skribbl“ – zeichnen und raten. Laptop = Bühne, Handys = Zeichenblock und Tipp-Eingabe.
 *
 * Reihum zeichnet eine Person (jede/r einmal pro Runde, 1–3 Runden). Ablauf eines Zuges:
 *   choose (3 Begriffe zur Auswahl, 10 s) → draw (Zeichenzeit, alle anderen tippen) → reveal (Wort + Punkte, 8 s)
 * Tipps prüft nur der Laptop: richtig = Tempo-Punkte, knapp = nur die tippende Person erfährt es,
 * falsch = erscheint im Chat. Nach 50 % und 75 % der Zeit wird je ein Buchstabe aufgedeckt (js/hints.js).
 *
 * Punkte: Ratende Rest-Zeit-Anteil × 100 + 50 (wer zuerst richtig liegt +50). Die zeichnende Person bekommt den
 * Durchschnitt der Ratenden-Punkte × Anteil der Treffer. Melden (🚩) mit Mehrheit bricht den Zug ab → 0 Punkte.
 *
 * Die Striche selbst laufen nicht durch die Engine, sondern als schnelle Nachrichten über den Controller
 * (js/controllers.js); canDraw(pid) sagt ihm, wer gerade zeichnen darf.
 *
 * Ansichten: Das Wort sehen nur die zeichnende Person und alle, die es schon erraten haben – die Bühne erst bei der
 * Auflösung. Chat-Nachrichten von Leuten, die es schon haben, sehen nur die, die es auch haben.
 */
(function (root) {
  'use strict';

  const Words = root.SkWords;
  const Hints = root.SkHints;

  const GAME = 'skribbl';
  const STAGE = 'stage';
  const PLAYER_COLORS = ['#f59e0b', '#38bdf8', '#a855f7', '#22c55e', '#ef4444', '#ec4899', '#14b8a6', '#facc15', '#84cc16', '#f97316', '#818cf8', '#e5e7eb'];
  const ROUND_OPTIONS = [1, 2, 3];
  const TIME_OPTIONS = [60, 80, 100, 120];
  const HINT_OPTIONS = [0, 1, 2];
  const CHOICES = ['pick', 'random'];
  const DRAW_ON = ['phone', 'laptop'];
  const DRINK_OPTIONS = ['off', 'on', 'free'];
  const DEFAULT_SETTINGS = {
    rounds: 2,
    time: 80,
    choice: 'pick',
    hints: 2,
    packs: ['standard'],
    custom: [],
    customOnly: false,
    chat: true,
    drawOn: 'phone',
    drinks: 'off',
  };
  const MIN_PLAYERS = 3;
  const MAX_PLAYERS = 12;
  const CHOOSE_MS = 10000;
  const REVEAL_MS = 8000;
  // So lange wird auf jemanden gewartet, dessen Handy kurz die Verbindung verliert
  const GRACE_MS = 15000;
  const FIRST_BONUS = 50;
  const MAX_GUESS = 40;
  const MAX_CHAT = 60;
  // Mindestabstand zwischen zwei Tipps derselben Person (gegen Dauerfeuer)
  const GUESS_GAP_MS = 350;

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

  function pick(list, value, current) {
    const n = typeof list[0] === 'number' ? +value : value;
    return value !== null && value !== '' && list.includes(n) ? n : current;
  }

  function sanitizeSettings(input, current) {
    const s = Object.assign({}, current || DEFAULT_SETTINGS);
    const i = input || {};
    s.rounds = pick(ROUND_OPTIONS, i.rounds, s.rounds);
    s.time = pick(TIME_OPTIONS, i.time, s.time);
    s.hints = pick(HINT_OPTIONS, i.hints, s.hints);
    s.choice = pick(CHOICES, i.choice, s.choice);
    s.drawOn = pick(DRAW_ON, i.drawOn, s.drawOn);
    s.drinks = pick(DRINK_OPTIONS, i.drinks, s.drinks);
    for (const k of ['chat', 'customOnly']) if (typeof i[k] === 'boolean') s[k] = i[k];
    if (Array.isArray(i.packs)) {
      const ids = Words.packIds();
      s.packs = ids.filter((id) => i.packs.includes(id));
    }
    if (i.custom !== undefined) s.custom = Words.parseCustom(i.custom);
    s.packs = (s.packs || []).slice();
    s.custom = (s.custom || []).slice();
    return s;
  }

  /** Punkte für einen Treffer: Rest-Zeit-Anteil × 100 + 50 (+50 für die Erste / den Ersten) */
  function guessPoints(remaining, total, first) {
    const frac = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
    return Math.round(frac * 100 + 50) + (first ? FIRST_BONUS : 0);
  }

  /** Punkte der zeichnenden Person: Durchschnitt der Treffer-Punkte × Anteil der Treffer */
  function drawerPoints(gains, guessers) {
    if (!gains.length || guessers <= 0) return 0;
    const avg = gains.reduce((a, b) => a + b, 0) / gains.length;
    return Math.round(avg * Math.min(1, gains.length / guessers));
  }

  /** Eine Zeichen-Nachricht prüfen (vom Handy – nie blind weitergeben). Gibt eine saubere Kopie oder null zurück. */
  function cleanOp(msg) {
    if (!msg || typeof msg !== 'object') return null;
    const num = (v) => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, Math.round(v * 1000) / 1000)) : null);
    const id = typeof msg.id === 'string' ? msg.id.slice(0, 24) : null;
    const color = typeof msg.c === 'string' && /^#[0-9a-f]{6}$/i.test(msg.c) ? msg.c : null;
    switch (msg.k) {
      case 'clear':
        return { k: 'clear' };
      case 'u':
        return id ? { k: 'u', id } : null;
      case 'b': {
        const x = num(msg.x);
        const y = num(msg.y);
        const w = typeof msg.w === 'number' && isFinite(msg.w) ? Math.min(0.1, Math.max(0.001, msg.w)) : null;
        return id && color && x !== null && y !== null && w !== null ? { k: 'b', id, c: color, w, x, y } : null;
      }
      case 'f': {
        const x = num(msg.x);
        const y = num(msg.y);
        return id && color && x !== null && y !== null ? { k: 'f', id, c: color, x, y } : null;
      }
      case 'p': {
        if (!id || !Array.isArray(msg.pts) || !msg.pts.length || msg.pts.length % 2 || msg.pts.length > 4000) return null;
        const pts = msg.pts.map(num);
        return pts.includes(null) ? null : { k: 'p', id, pts };
      }
      default:
        return null;
    }
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

    /** Neues Spiel – es beginnt in der Lobby, alle treten mit dem Handy bei */
    static create(config) {
      return {
        v: 1,
        game: GAME,
        settings: sanitizeSettings((config || {}).settings),
        phase: 'lobby',
        members: {},
        players: [],
        round: 0,
        drawn: [],
        no: 0,
        cur: null,
        used: [],
        history: [],
        awards: [],
        startedAt: null,
        endedAt: null,
      };
    }

    get write() {
      return true;
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
      const m = this.s.members[pid];
      return !!(m && m.online);
    }

    /** Wird auf diese Person gewartet? (verbunden oder erst kurz weg) */
    awaited(pid) {
      if (this.isOnline(pid)) return true;
      const m = this.s.members[pid];
      return !!(m && m.offlineAt && this.now() - m.offlineAt < GRACE_MS);
    }

    hit(pid) {
      const cur = this.s.cur;
      return !!(cur && cur.hits.some((h) => h.pid === pid));
    }

    /** Kennung des laufenden Zuges – verhindert, dass verspätete Eingaben beim nächsten Zug landen */
    stepKey() {
      return this.s.cur ? this.s.cur.no : null;
    }

    /** Darf pid gerade zeichnen? ('stage' = am Laptop) */
    canDraw(pid) {
      const s = this.s;
      if (s.phase !== 'draw' || !s.cur) return false;
      return s.settings.drawOn === 'laptop' ? pid === STAGE : pid === s.cur.drawer;
    }

    /** Ratende, auf die noch gewartet wird (nicht getroffen, verbunden oder kurz weg) */
    openGuessers() {
      const cur = this.s.cur;
      return cur ? cur.guessers.filter((pid) => !this.hit(pid) && this.awaited(pid)) : [];
    }

    chat(kind, pid, text) {
      const cur = this.s.cur;
      if (!cur) return;
      cur.chatNo += 1;
      cur.chat.push({ n: cur.chatNo, kind, pid: pid || null, text: text || '' });
      if (cur.chat.length > MAX_CHAT) cur.chat.splice(0, cur.chat.length - MAX_CHAT);
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
      }
      const p = this.player(pid);
      if (p) p.name = s.members[pid].name;
      // Wer dazukommt, spielt mit – im laufenden Zug darf er gleich mitraten
      else if (s.phase !== 'over' && s.players.length < MAX_PLAYERS) {
        this.addPlayer(pid);
        const cur = s.cur;
        if (cur && s.phase !== 'lobby') {
          if (s.phase === 'draw' && !cur.guessers.includes(pid)) cur.guessers.push(pid);
          this.chat('sys', pid, 'join');
        }
      }
      this.changed();
    }

    addPlayer(pid) {
      this.s.players.push({ id: pid, name: this.s.members[pid].name, score: 0, drinks: 0 });
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
      for (const p of s.players) {
        p.score = 0;
        p.drinks = 0;
      }
      s.round = 1;
      s.drawn = [];
      s.no = 0;
      s.cur = null;
      s.history = [];
      s.awards = [];
      s.startedAt = this.now();
      s.endedAt = null;
      this.nextTurn();
    }

    /** Wer zeichnet als Nächstes? Reihum in der Reihenfolge des Beitretens, Abgemeldete werden übersprungen. */
    nextDrawer() {
      const s = this.s;
      for (const p of s.players) {
        if (s.drawn.includes(p.id)) continue;
        // Kurz Getrennte (z.B. nach dem Neuladen des Laptops) sind noch dran – kommen sie nicht zurück, endet ihr Zug
        if (this.awaited(p.id)) return p.id;
        s.drawn.push(p.id);
      }
      return null;
    }

    nextTurn() {
      const s = this.s;
      if (!s.players.some((p) => this.awaited(p.id))) {
        this.finish();
        return;
      }
      let pid = this.nextDrawer();
      while (!pid) {
        if (s.round >= s.settings.rounds) {
          this.finish();
          return;
        }
        s.round += 1;
        s.drawn = [];
        pid = this.nextDrawer();
      }
      s.drawn.push(pid);
      s.no += 1;
      s.cur = {
        no: s.no,
        round: s.round,
        drawer: pid,
        options: null,
        word: null,
        guessers: [],
        hits: [],
        reports: [],
        chat: [],
        chatNo: 0,
        lastAt: {},
        hintPos: [],
        hintAt: [],
        hints: 0,
        startedAt: this.now(),
        total: 0,
        endsAt: null,
        result: null,
      };
      if (s.settings.choice === 'pick') {
        s.cur.options = Words.options(s.settings, s.used, { random: this.random });
        s.cur.total = CHOOSE_MS;
        s.cur.endsAt = this.now() + CHOOSE_MS;
        s.phase = 'choose';
      } else {
        this.beginDrawing(Words.random(s.settings, s.used, { random: this.random }));
      }
    }

    /** Wort steht fest – die Zeichenzeit läuft */
    beginDrawing(entry) {
      const s = this.s;
      const cur = s.cur;
      cur.word = { word: entry.word, key: entry.key, level: entry.level, pack: entry.pack };
      cur.options = null;
      s.used.push(entry.key);
      if (Words.markSeen) Words.markSeen(entry.key);
      cur.total = s.settings.time * 1000;
      cur.startedAt = this.now();
      cur.endsAt = cur.startedAt + cur.total;
      cur.guessers = s.players.map((p) => p.id).filter((pid) => pid !== cur.drawer && this.awaited(pid));
      const n = Hints.count(entry.word, s.settings.hints);
      cur.hintPos = Hints.pick(entry.word, n, this.random);
      cur.hintAt = Hints.times(cur.total, cur.hintPos.length).map((t) => cur.startedAt + t);
      cur.hints = 0;
      s.phase = 'draw';
    }

    /** Zug beenden: Punkte für die zeichnende Person, Trinkregeln, Auflösung zeigen */
    endTurn(reason) {
      const s = this.s;
      const cur = s.cur;
      // Wer endgültig weg ist, zählt nicht gegen die zeichnende Person
      const counted = cur.guessers.filter((pid) => this.hit(pid) || this.awaited(pid)).length;
      const gains = cur.hits.map((h) => h.pts);
      const drawerPts = ['reported', 'skip', 'left'].includes(reason) ? 0 : drawerPoints(gains, counted);
      const drawer = this.player(cur.drawer);
      if (drawer) drawer.score += drawerPts;
      const drinks = [];
      if (s.settings.drinks !== 'off' && !['skip', 'left'].includes(reason)) {
        if (!cur.hits.length && counted) drinks.push({ pid: cur.drawer, n: 2, why: 'none' });
        else if (cur.hits.length >= 2) drinks.push({ pid: cur.hits[cur.hits.length - 1].pid, n: 1, why: 'last' });
      }
      for (const d of drinks) {
        const p = this.player(d.pid);
        if (p) p.drinks += d.n;
      }
      cur.result = { reason, drawerPts, guessers: counted, drinks };
      cur.hints = cur.hintPos.length;
      cur.total = REVEAL_MS;
      cur.endsAt = this.now() + REVEAL_MS;
      s.phase = 'reveal';
      s.history.push({
        no: cur.no,
        round: cur.round,
        drawer: cur.drawer,
        drawerName: this.playerName(cur.drawer),
        word: cur.word.word,
        reason,
        drawerPts,
        guessers: counted,
        hits: cur.hits.map((h) => ({ pid: h.pid, name: this.playerName(h.pid), ms: h.ms, pts: h.pts })),
      });
    }

    finish() {
      const s = this.s;
      s.phase = 'over';
      s.cur = null;
      s.endedAt = this.now();
      s.awards = this.computeAwards();
      this.dispose();
    }

    /** Alle haben es? (mindestens ein Treffer und niemand mehr offen) */
    checkProgress() {
      const s = this.s;
      if (s.phase !== 'draw' || !s.cur) return false;
      if (s.cur.hits.length && !this.openGuessers().length) {
        this.endTurn('all');
        return true;
      }
      return false;
    }

    /* ---------- Zeitlimit ---------- */

    nextDeadline() {
      const s = this.s;
      const cur = s.cur;
      if (!cur || !['choose', 'draw', 'reveal'].includes(s.phase)) return null;
      const ends = [cur.endsAt];
      if (s.phase === 'draw') ends.push(...cur.hintAt);
      for (const m of Object.values(s.members)) if (!m.online && m.offlineAt) ends.push(m.offlineAt + GRACE_MS);
      const future = ends.filter((t) => t && t > this.now());
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

    /** Abgelaufene Zeiten auswerten. Gibt true zurück, wenn sich etwas geändert hat. */
    tick() {
      const s = this.s;
      const cur = s.cur;
      if (!cur) return false;
      const now = this.now();
      const drawerGone = !this.awaited(cur.drawer);
      if (s.phase === 'choose') {
        if (drawerGone) {
          this.nextTurn();
          return true;
        }
        if (cur.endsAt <= now) {
          // Keine Wahl getroffen: der Zufall entscheidet
          this.beginDrawing(cur.options[Math.floor(this.random() * cur.options.length)]);
          return true;
        }
        return false;
      }
      if (s.phase === 'draw') {
        if (drawerGone) {
          this.endTurn('left');
          return true;
        }
        if (cur.endsAt <= now) {
          this.endTurn('time');
          return true;
        }
        let changed = false;
        const shown = cur.hintAt.filter((t) => t <= now).length;
        if (shown !== cur.hints) {
          cur.hints = shown;
          changed = true;
        }
        // Getrennte Ratende, auf die nicht mehr gewartet wird, halten den Zug nicht auf
        return this.checkProgress() || changed;
      }
      if (s.phase === 'reveal' && cur.endsAt <= now) {
        this.nextTurn();
        return true;
      }
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

    /** Aktion gehört zum laufenden Zug? (a.at weglassen = egal) */
    current(a) {
      return a.at === undefined || a.at === this.stepKey();
    }

    /* Lobby */

    on_settings(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby') return false;
      s.settings = sanitizeSettings(a.settings, s.settings);
      return true;
    }

    /** Mitspielen / nur zuschauen (Handy, in der Lobby) */
    on_watch(a, actor) {
      const s = this.s;
      if (actor === STAGE || s.phase !== 'lobby' || !s.members[actor]) return false;
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
      if (actor !== STAGE || !s.members[a.player]) return false;
      const pid = a.player;
      s.players = s.players.filter((p) => p.id !== pid);
      delete s.members[pid];
      if (this.hooks.onKick) this.hooks.onKick(pid);
      const cur = s.cur;
      if (cur && s.phase !== 'over') {
        cur.guessers = cur.guessers.filter((x) => x !== pid);
        cur.reports = cur.reports.filter((x) => x !== pid);
        if (cur.drawer === pid) {
          if (s.phase === 'choose') this.nextTurn();
          else if (s.phase === 'draw') this.endTurn('left');
          return true;
        }
        this.checkProgress();
      }
      return true;
    }

    lobbyProblem() {
      const s = this.s;
      const here = s.players.filter((p) => this.isOnline(p.id));
      if (here.length < MIN_PLAYERS) return `Ihr braucht mindestens ${MIN_PLAYERS} Personen – scannt den QR-Code!`;
      if (s.settings.customOnly) {
        if (s.settings.custom.length < 3) return 'Für „nur eigene Wörter“ braucht ihr mindestens 3 eigene Wörter.';
      } else if (!s.settings.packs.length && !s.settings.custom.length) return 'Wählt mindestens ein Wortpaket aus.';
      return null;
    }

    on_start(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'lobby' || this.lobbyProblem()) return false;
      s.players = s.players.filter((p) => this.isOnline(p.id));
      this.startGame();
      return true;
    }

    /* Zug */

    /** Zeichnende Person wählt einen der drei Begriffe */
    on_choose(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'choose' || !cur || actor !== cur.drawer || !this.current(a)) return false;
      const entry = (cur.options || [])[a.i];
      if (!entry) return false;
      this.beginDrawing(entry);
      return true;
    }

    /** Tipp (oder Chat, wenn man es schon hat) */
    on_guess(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'draw' || !cur || !this.current(a) || actor === STAGE || actor === cur.drawer || !this.player(actor)) return false;
      const text = cleanName(a.text, '', MAX_GUESS);
      if (!root.GameMatch.normalize(text)) return false;
      const now = this.now();
      if (cur.lastAt[actor] && now - cur.lastAt[actor] < GUESS_GAP_MS) return false;
      cur.lastAt[actor] = now;
      if (!cur.guessers.includes(actor)) cur.guessers.push(actor);
      if (this.hit(actor)) {
        // Hat es schon: Nachricht nur für die, die es auch haben
        this.chat('insider', actor, text);
        return true;
      }
      const verdict = Words.check(text, cur.word.word);
      if (verdict === 'right') {
        const pts = guessPoints(cur.endsAt - now, cur.total, !cur.hits.length);
        cur.hits.push({ pid: actor, ms: now - cur.startedAt, pts });
        cur.reports = cur.reports.filter((x) => x !== actor);
        this.player(actor).score += pts;
        this.chat('hit', actor, '');
        this.checkProgress();
      } else this.chat(verdict === 'close' ? 'close' : 'guess', actor, text);
      return true;
    }

    /** 🚩 Melden (nochmal = zurücknehmen). Mehrheit der Ratenden bricht den Zug ab. */
    on_report(a, actor) {
      const s = this.s;
      const cur = s.cur;
      if (s.phase !== 'draw' || !cur || !this.current(a) || actor === cur.drawer || !this.player(actor) || this.hit(actor)) return false;
      if (!cur.guessers.includes(actor)) return false;
      const was = cur.reports.includes(actor);
      cur.reports = was ? cur.reports.filter((x) => x !== actor) : cur.reports.concat(actor);
      if (!was) this.chat('sys', actor, 'report');
      const voters = cur.guessers.filter((pid) => this.awaited(pid)).length;
      if (cur.reports.length * 2 > voters) this.endTurn('reported');
      return true;
    }

    /** Laptop: Zug überspringen (z.B. wenn die zeichnende Person nicht da ist) */
    on_skip(a, actor) {
      const s = this.s;
      if (actor !== STAGE || !s.cur || !this.current(a)) return false;
      if (s.phase === 'choose') this.nextTurn();
      else if (s.phase === 'draw') this.endTurn('skip');
      else return false;
      return true;
    }

    /** Auflösung überspringen – weiter zum nächsten Zug */
    on_next(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'reveal' || !s.cur || !this.current(a)) return false;
      this.nextTurn();
      return true;
    }

    on_end(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase === 'lobby' || s.phase === 'over') return false;
      this.finish();
      return true;
    }

    /** Nochmal mit denselben Leuten */
    on_again(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'over') return false;
      s.phase = 'lobby';
      s.cur = null;
      s.history = [];
      s.awards = [];
      s.round = 0;
      s.no = 0;
      s.drawn = [];
      s.startedAt = null;
      s.endedAt = null;
      s.players = s.players.filter((p) => s.members[p.id]);
      for (const p of s.players) {
        p.score = 0;
        p.drinks = 0;
      }
      return true;
    }

    /* ---------- Statistik ---------- */

    computeAwards() {
      const s = this.s;
      const out = [];
      const turns = s.history.filter((h) => !['skip', 'left'].includes(h.reason));
      if (!turns.length) return out;
      // 🎨 Picasso: die meisten Treffer auf die eigenen Zeichnungen
      const byDrawer = {};
      for (const h of turns) {
        const o = (byDrawer[h.drawer] = byDrawer[h.drawer] || { name: h.drawerName, hits: 0, of: 0, pts: 0 });
        o.hits += h.hits.length;
        o.of += h.guessers;
        o.pts += h.drawerPts;
      }
      const best = Object.values(byDrawer).sort((a, b) => b.hits - a.hits || b.pts - a.pts)[0];
      if (best && best.hits) out.push({ icon: '🎨', title: 'Picasso', text: `${best.name} – ${best.hits} von ${best.of} möglichen Treffern` });
      // ⚡ Adlerauge: der schnellste Treffer
      let fast = null;
      for (const h of turns) for (const x of h.hits) if (!fast || x.ms < fast.ms) fast = Object.assign({ word: h.word }, x);
      if (fast) out.push({ icon: '⚡', title: 'Adlerauge', text: `${fast.name} hatte „${fast.word}“ nach ${Math.max(1, Math.round(fast.ms / 1000))} s` });
      // 🔍 Spürnase: die meisten erratenen Begriffe
      const guessed = {};
      for (const h of turns) for (const x of h.hits) guessed[x.pid] = { name: x.name, n: ((guessed[x.pid] || {}).n || 0) + 1 };
      const nose = Object.values(guessed).sort((a, b) => b.n - a.n);
      if (nose.length && nose[0].n >= 2 && (nose.length < 2 || nose[1].n < nose[0].n)) out.push({ icon: '🔍', title: 'Spürnase', text: `${nose[0].name} – ${nose[0].n} Begriffe erraten` });
      // 🙈 Rätselhaft: eine Zeichnung, die niemand erkannt hat (wird in der Galerie gezeigt)
      const riddle = turns.filter((h) => h.reason !== 'reported' && !h.hits.length && h.guessers > 0).pop();
      if (riddle) out.push({ icon: '🙈', title: 'Rätselhaft', text: `${riddle.drawerName}s „${riddle.word}“ hat niemand erkannt`, no: riddle.no });
      return out;
    }

    /* ---------- Ansicht ---------- */

    /** Darf viewer diese Chat-Zeile sehen? */
    chatVisible(entry, viewer) {
      const s = this.s;
      const cur = s.cur;
      const stage = viewer === STAGE;
      if (entry.kind === 'close') return entry.pid === viewer;
      if (s.phase === 'reveal') return !stage || s.settings.chat || entry.kind !== 'guess';
      if (entry.kind === 'insider') return !stage && (viewer === cur.drawer || this.hit(viewer));
      if (entry.kind === 'guess') return !stage || s.settings.chat;
      return true;
    }

    chatView(viewer) {
      const cur = this.s.cur;
      return cur.chat
        .filter((e) => this.chatVisible(e, viewer))
        .map((e) => {
          let text = e.text;
          if (e.kind === 'sys' && e.text === 'join') text = `👋 ${this.playerName(e.pid)} ist dabei`;
          else if (e.kind === 'sys' && e.text === 'report') text = `🚩 ${this.playerName(e.pid)} meldet die Zeichnung`;
          return { n: e.n, kind: e.kind, pid: e.pid, name: e.pid ? this.playerName(e.pid) : '', text };
        });
    }

    curView(viewer) {
      const s = this.s;
      const cur = s.cur;
      if (!cur) return null;
      const stage = viewer === STAGE;
      const drawer = viewer === cur.drawer;
      const phase = s.phase;
      const v = {
        no: cur.no,
        key: cur.no,
        round: cur.round,
        drawer: cur.drawer,
        drawerName: this.playerName(cur.drawer),
        timer: cur.endsAt ? { total: cur.total, remaining: Math.max(0, cur.endsAt - this.now()) } : null,
        options: null,
        word: null,
        mask: null,
        lengths: null,
        level: null,
        hits: cur.hits.map((h) => h.pid),
        guessers: cur.guessers.slice(),
        open: phase === 'draw' ? this.openGuessers() : [],
        reports: cur.reports.length,
        reported: cur.reports.includes(viewer),
        canDraw: this.canDraw(viewer),
        chat: this.chatView(viewer),
        mine: null,
        result: null,
      };
      if (phase === 'choose') {
        if (drawer) v.options = cur.options.map((e) => ({ word: e.word, level: e.level }));
        return v;
      }
      const word = cur.word.word;
      v.lengths = Hints.lengths(word);
      v.level = cur.word.level;
      v.mask = Hints.mask(word, cur.hintPos.slice(0, cur.hints));
      if (phase === 'reveal' || (!stage && (drawer || this.hit(viewer)))) v.word = word;
      const myHit = cur.hits.find((h) => h.pid === viewer);
      if (myHit) v.mine = { pts: myHit.pts, ms: myHit.ms, rank: cur.hits.indexOf(myHit) + 1 };
      if (phase === 'reveal') {
        const r = cur.result;
        v.result = {
          reason: r.reason,
          drawerPts: r.drawerPts,
          guessers: r.guessers,
          gains: cur.hits.map((h) => ({ pid: h.pid, name: this.playerName(h.pid), pts: h.pts, ms: h.ms })),
          drinks: r.drinks.map((d) => ({ pid: d.pid, name: this.playerName(d.pid), n: d.n, why: d.why })),
        };
      }
      return v;
    }

    viewFor(viewer) {
      const s = this.s;
      const stage = viewer === STAGE;
      const me = stage ? null : this.player(viewer);
      const settings = Object.assign({}, s.settings, { custom: stage ? s.settings.custom.slice() : [], customCount: s.settings.custom.length });
      const ranked = s.players.slice().sort((a, b) => b.score - a.score);
      return {
        game: GAME,
        phase: s.phase,
        settings,
        players: s.players.map((p, i) => ({
          id: p.id,
          name: p.name,
          color: PLAYER_COLORS[i % PLAYER_COLORS.length],
          online: this.isOnline(p.id),
          score: p.score,
          drinks: p.drinks,
          rank: ranked.filter((x) => x.score > p.score).length + 1,
        })),
        members: Object.entries(s.members).map(([id, m]) => ({ id, name: m.name, online: m.online, playing: !!this.player(id) })),
        round: s.round,
        rounds: s.settings.rounds,
        no: s.no,
        turnsPerRound: s.players.length,
        lobbyProblem: s.phase === 'lobby' ? this.lobbyProblem() : null,
        awards: clone(s.awards),
        history:
          s.phase === 'over'
            ? s.history.map((h) => ({ no: h.no, round: h.round, drawer: h.drawer, drawerName: h.drawerName, word: h.word, reason: h.reason, hits: h.hits.length, guessers: h.guessers, drawerPts: h.drawerPts }))
            : [],
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        cur: this.curView(viewer),
        me: stage
          ? { stage: true }
          : {
              id: viewer,
              name: (s.members[viewer] || {}).name || '',
              playing: !!me,
              stepKey: this.stepKey(),
            },
      };
    }
  }

  root.SkEngine = {
    Engine,
    GAME,
    STAGE,
    PLAYER_COLORS,
    ROUND_OPTIONS,
    TIME_OPTIONS,
    HINT_OPTIONS,
    CHOICES,
    DRAW_ON,
    DRINK_OPTIONS,
    DEFAULT_SETTINGS,
    MIN_PLAYERS,
    MAX_PLAYERS,
    CHOOSE_MS,
    REVEAL_MS,
    GRACE_MS,
    FIRST_BONUS,
    MAX_GUESS,
    guessPoints,
    drawerPoints,
    cleanOp,
    sanitizeSettings,
    cleanName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
