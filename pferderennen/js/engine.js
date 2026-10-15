/*
 * Spiellogik von „Pferderennen“ – das Trinkspiel mit dem Kartendeck.
 *
 * Die vier Asse sind die Pferde. Alle setzen auf ein Pferd, dann wird Karte für Karte aufgedeckt
 * (Rennlogik in race.js). Mehrere Rennen hintereinander, am Ende eine Rangliste.
 *
 * Spielweisen (settings.input):
 *  - single: Ein Gerät (Laptop/Handy in der Mitte). Wetten reihum eintragen, Rennen läuft hier.
 *  - phones: Der Laptop ist die Rennbahn und öffnet einen Raum. Jede Person setzt auf dem eigenen Handy,
 *            sieht ihr Pferd live und verteilt ihre Schlucke per Antippen. Wer kein Handy hat, wird am
 *            Laptop eingetragen (ein Handy mit demselben Namen übernimmt die Person).
 *  - real:   Mit echten Karten am Tisch – die App ist nur Wettbüro + Abrechnung: Siegerpferd antippen.
 *
 * Währung (settings.currency):
 *  - sips:  Sieger verteilen Einsatz × Faktor, alle anderen trinken (Optionen: Letzter doppelt, Platz 2 frei).
 *  - chips: alkoholfrei – alle starten mit 20 Chips, Sieger bekommen Einsatz × 3 zurück, wer pleite ist,
 *           bekommt pro Rennen einen Mitleidschip. Optional Quoten-Wetten: nach der ersten Streckenkarte
 *           darf einmal nachgesetzt werden, zu Quoten aus den Live-Chancen (odds.js).
 *
 * Phasen: lobby (nur Handys) → betting → racing → payout → (nächstes Rennen) betting … → end
 * Das automatische Ziehen (Tempo) steuert die Oberfläche: sie schickt im Takt 'draw'.
 * Zu jeder Karte schreibt comments.js eine Schlagzeile (race.say), dazu die Live-Chancen (race.odds).
 */
(function (root) {
  'use strict';

  const Cards = root.PFCards;
  const Race = root.PFRace;
  const Comments = root.PFComments;
  const Odds = root.PFOdds;

  const STAGE = 'stage';
  const INPUTS = ['single', 'phones', 'real'];
  const CURRENCIES = ['sips', 'chips'];
  const DECKS = [52, 32];
  const LENGTHS = [5, 6, 7, 8];
  const MAX_BETS = [3, 5, 10];
  const PAYOUTS = [1, 2, 3];
  const SPEEDS = ['slow', 'normal', 'fast', 'tap'];
  const SPEED_MS = { slow: 2500, normal: 1500, fast: 800 };
  const RACES = [3, 5, 10, 0]; // 0 = endlos
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 20;
  const DEFAULT_BET = 3;
  const CHIPS_START = 20;
  const CHIPS_PAYOUT = 3; // Sieger bekommen Einsatz × 3 zurück
  const PITY_CHIPS = 1;
  const AWARD_MAX = 3; // mehr Namen bei Gleichstand → keine Auszeichnung
  const LOYAL_MIN = 3; // Treue Seele ab so vielen Rennen
  const DEFAULT_SETTINGS = {
    input: 'single',
    currency: 'sips',
    deck: 52,
    length: 6,
    maxBet: 5,
    payout: 2,
    lastDouble: false,
    secondFree: false,
    speed: 'normal',
    races: 0,
    secretBets: false,
    odds: true,
    oddsBets: false,
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
    const s = Object.assign({}, DEFAULT_SETTINGS, current || {});
    const i = input || {};
    if (INPUTS.includes(i.input)) s.input = i.input;
    if (CURRENCIES.includes(i.currency)) s.currency = i.currency;
    if (i.deck !== undefined && DECKS.includes(+i.deck)) s.deck = +i.deck;
    if (i.length !== undefined && LENGTHS.includes(+i.length)) s.length = +i.length;
    if (i.maxBet !== undefined && MAX_BETS.includes(+i.maxBet)) s.maxBet = +i.maxBet;
    if (i.payout !== undefined && PAYOUTS.includes(+i.payout)) s.payout = +i.payout;
    for (const k of ['lastDouble', 'secondFree', 'secretBets', 'odds', 'oddsBets']) if (typeof i[k] === 'boolean') s[k] = i[k];
    if (SPEEDS.includes(i.speed)) s.speed = i.speed;
    if (i.races !== undefined && RACES.includes(+i.races)) s.races = +i.races;
    return s;
  }

  function same(a, b) {
    return String(a).toLowerCase() === String(b).toLowerCase();
  }

  function emptyStats() {
    // Chips-Modus: given = gewonnene Chips, drank = verlorene Chips
    return { drank: 0, given: 0, received: 0, wins: 0, races: 0, staked: 0, suits: { S: 0, H: 0, D: 0, C: 0 } };
  }

  class Engine {
    /**
     * @param {object} state Spielzustand (siehe Engine.create)
     * @param {{onChange?: Function, onKick?: Function, random?: Function, oddsRuns?: number}} hooks
     */
    constructor(state, hooks) {
      this.s = state;
      this.hooks = hooks || {};
      this.random = this.hooks.random || Math.random;
      // Ältere Spielstände (vor Handys/Chips) ergänzen
      state.settings = sanitizeSettings({}, state.settings);
      state.members = state.members || {};
      state.oddsBets = state.oddsBets || {};
      state.give = state.give || {};
      if (state.oddsWin === undefined) state.oddsWin = null;
      for (const p of state.players) {
        if (p.chips == null) p.chips = CHIPS_START;
        p.stats = Object.assign(emptyStats(), p.stats);
      }
    }

    /**
     * Neues Spiel aus dem Setup.
     * @param {{settings: object, players?: string[]}} config
     *   players: Namen (Ein Gerät/Echte Karten: alle; Handys: nur wer kein Handy hat)
     */
    static create(config, hooks) {
      const settings = sanitizeSettings(config.settings);
      const state = {
        v: 2,
        game: 'pferderennen',
        settings,
        phase: settings.input === 'phones' ? 'lobby' : 'betting',
        step: 0,
        players: [],
        members: {},
        nextId: 1,
        raceNo: 1,
        bets: {},
        lastBets: {},
        race: null,
        paused: false,
        oddsWin: null,
        oddsBets: {},
        give: {},
        result: null,
        history: [],
        event: null,
        eventNo: 0,
      };
      const e = new Engine(state, hooks);
      for (const n of (config.players || []).map((x) => cleanName(x, '')).filter(Boolean)) e.addPlayer(n);
      if (settings.input !== 'phones') while (state.players.length < MIN_PLAYERS) e.addPlayer('Person ' + (state.players.length + 1));
      return state;
    }

    dispose() {}

    changed() {
      if (this.hooks.onChange) this.hooks.onChange();
    }

    /* ---------- Hilfsfunktionen ---------- */

    get write() {
      return this.s.settings.input === 'phones';
    }

    get chips() {
      return this.s.settings.currency === 'chips';
    }

    get real() {
      return this.s.settings.input === 'real';
    }

    player(id) {
      return this.s.players.find((p) => p.id === id) || null;
    }

    playerOfPhone(pid) {
      return this.s.players.find((p) => p.phone === pid) || null;
    }

    /** Für wen gilt die Aktion? Gerät: a[key] (beliebige Person) · Handy: nur die eigene Person */
    actorPlayer(a, actor, key) {
      const k = key || 'player';
      if (actor === STAGE) return this.player(a[k]);
      const me = this.playerOfPhone(actor);
      if (!me || (a[k] && a[k] !== me.id)) return null;
      return me;
    }

    event(kind, extra) {
      this.s.event = Object.assign({ n: ++this.s.eventNo, kind }, extra || {});
    }

    bump() {
      this.s.step += 1;
    }

    /** Aktion passt nicht (mehr) zum aktuellen Stand? (doppelt getippt, veraltete Ansicht) */
    stale(a) {
      return a.at !== undefined && a.at !== this.s.step;
    }

    uniqueName(name) {
      let out = name;
      let k = 2;
      while (this.s.players.some((p) => same(p.name, out))) out = `${name} ${k++}`;
      return out;
    }

    addPlayer(name, phone) {
      const s = this.s;
      if (s.players.length >= MAX_PLAYERS) return null;
      const p = {
        id: 'p' + s.nextId++,
        name: this.uniqueName(cleanName(name, 'Person ' + (s.players.length + 1))),
        phone: phone || null,
        chips: CHIPS_START,
        stats: emptyStats(),
      };
      s.players.push(p);
      return p;
    }

    /** Höchsteinsatz: Schlucke laut Einstellung, Chips so viele wie man hat */
    maxBet(p) {
      return this.chips ? Math.max(0, p.chips) : this.s.settings.maxBet;
    }

    clampBet(amount, p) {
      const max = this.maxBet(p);
      if (max < 1) return 0;
      const n = Math.round(+amount);
      if (!Number.isFinite(n)) return Math.min(DEFAULT_BET, max);
      return Math.max(1, Math.min(max, n));
    }

    /** Namen pro Pferd für den Kommentar (Wetten und Quoten-Wetten): { S: ['Anna'], … } */
    bettorNames() {
      const out = { S: [], H: [], D: [], C: [] };
      for (const p of this.s.players) {
        for (const b of [this.s.bets[p.id], this.s.oddsBets[p.id]]) if (b && !out[b.suit].includes(p.name)) out[b.suit].push(p.name);
      }
      return out;
    }

    /** Wer noch kein Pferd gewählt hat */
    missing() {
      return this.s.players.filter((p) => !this.s.bets[p.id]).map((p) => p.id);
    }

    online(p) {
      return !p.phone || !!(this.s.members[p.phone] && this.s.members[p.phone].online);
    }

    /* ---------- Verbindungen (Mit Handys) ---------- */

    /** Handy meldet sich: gleicher Name wie eine eingetragene Person ohne Handy → das ist sie, sonst neu dazu */
    connect(pid, name) {
      const s = this.s;
      const clean = cleanName(name, 'Gast');
      const m = s.members[pid];
      if (m) {
        m.online = true;
        if (name) m.name = clean;
      } else {
        s.members[pid] = { name: clean, online: true };
      }
      let p = this.playerOfPhone(pid);
      if (!p) {
        p = s.players.find((x) => !x.phone && same(x.name, clean));
        if (p) p.phone = pid;
        else if (s.phase !== 'end') {
          p = this.addPlayer(clean, pid);
          if (p && s.phase !== 'lobby') this.event('joined', { name: p.name });
        }
      }
      this.changed();
    }

    disconnect(pid) {
      const m = this.s.members[pid];
      if (!m || !m.online) return;
      m.online = false;
      this.changed();
    }

    /** Nach dem Neuladen des Hosts: alle müssen sich neu verbinden */
    setAllOffline() {
      for (const m of Object.values(this.s.members)) m.online = false;
    }

    /* ---------- Ablauf ---------- */

    oddsWanted() {
      const st = this.s.settings;
      return !this.real && (st.odds || (this.chips && st.oddsBets));
    }

    computeOdds() {
      const r = this.s.race;
      if (!r || !this.oddsWanted()) return;
      r.odds = Odds.chances(r, { runs: this.hooks.oddsRuns, random: this.random });
    }

    startRace() {
      const s = this.s;
      s.result = null;
      s.paused = false;
      s.oddsWin = null;
      s.oddsBets = {};
      s.give = {};
      s.phase = 'racing';
      if (this.real) {
        s.race = null;
      } else {
        s.race = Race.create({ size: s.settings.deck, length: s.settings.length, random: this.random });
        this.computeOdds();
      }
      this.bump();
    }

    draw() {
      const s = this.s;
      const before = s.race;
      const out = Race.draw(before, this.random);
      s.race = out.race;
      s.race.say = Comments.say(before, s.race, out.events, { bettors: this.bettorNames(), random: this.random });
      if (s.race.winner) {
        this.settle(Race.ranking(s.race));
      } else {
        s.race.oddsPrev = before.odds || null;
        this.computeOdds();
        // Quoten-Wetten: nach der ersten Streckenkarte darf einmal nachgesetzt werden
        if (this.chips && s.settings.oddsBets && out.events.some((e) => e.type === 'track' && e.row === 1)) this.openOdds();
      }
      this.bump();
    }

    openOdds() {
      const s = this.s;
      const r = s.race;
      const quotes = Odds.quotes(r.odds || Odds.chances(r, { runs: this.hooks.oddsRuns, random: this.random }));
      const bets = {};
      // Wer nichts mehr übrig hat, setzt automatisch aus
      for (const p of s.players) if (this.oddsLeft(p) < 1) bets[p.id] = { skip: true };
      s.oddsWin = { quotes, bets };
      this.event('odds');
      this.checkOdds();
    }

    /** Chips, die für eine Quoten-Wette übrig sind (Haupteinsatz ist schon gebunden) */
    oddsLeft(p) {
      const b = this.s.bets[p.id];
      return Math.max(0, p.chips - (b ? b.amount : 0));
    }

    /** Alle haben nachgesetzt oder ausgesetzt → weiter */
    checkOdds() {
      const w = this.s.oddsWin;
      if (w && this.s.players.every((p) => w.bets[p.id])) this.closeOdds();
    }

    closeOdds() {
      const s = this.s;
      if (!s.oddsWin) return;
      s.oddsBets = {};
      for (const [id, b] of Object.entries(s.oddsWin.bets)) if (!b.skip && this.player(id)) s.oddsBets[id] = b;
      s.oddsWin = null;
    }

    /**
     * Abrechnung. ranking = Platzierung (Sieger zuerst).
     * Schlucke: give/drink pro Person · Chips: delta pro Person (+ Quoten-Wette)
     */
    settle(ranking) {
      const s = this.s;
      const st = s.settings;
      const r = s.race;
      const [winner, second] = ranking;
      const last = ranking[ranking.length - 1];
      const L = r ? r.length : 0;
      // Fotofinish: ein anderes Pferd stand direkt vor dem Ziel
      const photo = !!r && ranking.some((x) => x !== winner && r.pos[x] === L);
      const margin = r ? L + 1 - r.pos[second] : null;
      const lines = [];
      for (const p of s.players) {
        const b = s.bets[p.id];
        if (!b) continue;
        const line = { id: p.id, name: p.name, suit: b.suit, amount: b.amount, place: ranking.indexOf(b.suit) + 1, give: 0, drink: 0, note: null };
        p.stats.races += 1;
        p.stats.staked += b.amount;
        if (!p.stats.suits) p.stats.suits = { S: 0, H: 0, D: 0, C: 0 };
        p.stats.suits[b.suit] += 1;
        if (b.suit === winner) p.stats.wins += 1;
        if (this.chips) {
          line.before = p.chips;
          line.delta = b.suit === winner ? b.amount * (CHIPS_PAYOUT - 1) : -b.amount;
          const ob = s.oddsBets[p.id];
          if (ob) {
            const won = ob.suit === winner;
            line.extra = { suit: ob.suit, amount: ob.amount, odds: ob.odds, delta: won ? Math.round(ob.amount * ob.odds) - ob.amount : -ob.amount };
            line.delta += line.extra.delta;
            p.stats.staked += ob.amount;
          }
          p.chips = Math.max(0, p.chips + line.delta);
          line.after = p.chips;
          if (line.delta > 0) p.stats.given += line.delta;
          else p.stats.drank -= line.delta;
        } else {
          if (b.suit === winner) {
            line.give = b.amount * st.payout;
          } else if (st.secondFree && b.suit === second) {
            line.note = 'second';
          } else if (st.lastDouble && b.suit === last) {
            line.drink = b.amount * 2;
            line.note = 'last';
          } else {
            line.drink = b.amount;
          }
          p.stats.given += line.give;
          p.stats.drank += line.drink;
          if (line.give && this.write) s.give[p.id] = {};
        }
        lines.push(line);
      }
      const draws = r ? r.tick : null;
      s.result = { no: s.raceNo, winner, ranking, lines, draws, photo, margin, say: r ? r.say : null, closed: false };
      s.history.push({ no: s.raceNo, winner, ranking, draws, photo });
      s.oddsWin = null;
      s.phase = 'payout';
    }

    /* ---------- Verteilen (Mit Handys, Schlucke) ---------- */

    /** Wie viele Schlucke giver noch verteilen darf */
    giveLeft(giverId) {
      const s = this.s;
      const line = s.result && s.result.lines.find((l) => l.id === giverId);
      if (!line || !s.give[giverId]) return 0;
      const used = Object.values(s.give[giverId]).reduce((a, b) => a + b, 0);
      return line.give - used;
    }

    /** Erhaltene Schlucke pro Person: { p2: { p1: 3 } } (wer bekommt – von wem – wie viele) */
    received() {
      const out = {};
      for (const [from, targets] of Object.entries(this.s.give || {})) {
        for (const [to, n] of Object.entries(targets)) {
          if (!n) continue;
          (out[to] = out[to] || {})[from] = n;
        }
      }
      return out;
    }

    /** Verteilte Schlucke in die Statistik übernehmen (vor dem nächsten Rennen bzw. am Ende) */
    closeGive() {
      const s = this.s;
      if (!s.result || s.result.closed) return;
      s.result.closed = true;
      for (const [to, from] of Object.entries(this.received())) {
        const p = this.player(to);
        if (!p) continue;
        const n = Object.values(from).reduce((a, b) => a + b, 0);
        p.stats.received = (p.stats.received || 0) + n;
        p.stats.drank += n;
      }
    }

    /** Alle Rennen gelaufen? */
    seriesOver() {
      const n = this.s.settings.races;
      return !!n && this.s.raceNo >= n;
    }

    nextRace() {
      const s = this.s;
      this.closeGive();
      s.lastBets = clone(s.bets);
      s.bets = {};
      s.race = null;
      s.result = null;
      s.give = {};
      s.oddsBets = {};
      s.raceNo += 1;
      s.phase = 'betting';
      if (this.chips) {
        const broke = s.players.filter((p) => p.chips < 1);
        for (const p of broke) p.chips = PITY_CHIPS;
        if (broke.length) this.event('pity', { names: broke.map((p) => p.name) });
      }
      this.bump();
    }

    finish() {
      const s = this.s;
      this.closeGive();
      if (s.phase !== 'payout') s.race = null;
      s.phase = 'end';
      s.paused = false;
      s.oddsWin = null;
      this.bump();
    }

    /* ---------- Aktionen ---------- */

    /**
     * Verarbeitet eine Aktion. Gibt true zurück, wenn sich etwas geändert hat.
     * @param {object} a Aktion {type, ...}
     * @param {string} actor 'stage' (Gerät) oder Handy-ID
     */
    apply(a, actor) {
      if (!a || typeof a.type !== 'string') return false;
      const handler = this['on_' + a.type];
      if (typeof handler !== 'function') return false;
      const ok = handler.call(this, a, actor) === true;
      if (ok) this.changed();
      return ok;
    }

    lobbyProblem() {
      const n = this.s.players.length;
      if (n < MIN_PLAYERS) return `Mindestens ${MIN_PLAYERS} Personen nötig (gerade ${n}).`;
      return null;
    }

    /** Lobby → Wettbüro (Mit Handys) */
    on_open(a, actor) {
      if (actor !== STAGE || this.s.phase !== 'lobby' || this.lobbyProblem()) return false;
      this.s.phase = 'betting';
      this.bump();
      return true;
    }

    /** Pferd wählen (Einsatz bleibt, sonst der vom letzten Rennen, sonst Standard) */
    on_bet(a, actor) {
      const s = this.s;
      const p = this.actorPlayer(a, actor);
      if (s.phase !== 'betting' || !p || !Cards.SUITS.includes(a.suit)) return false;
      const old = s.bets[p.id] || s.lastBets[p.id];
      const amount = this.clampBet(a.amount !== undefined ? a.amount : old ? old.amount : DEFAULT_BET, p);
      if (!amount) return false;
      s.bets[p.id] = { suit: a.suit, amount };
      return true;
    }

    /** Einsatz ändern: amount (absolut) oder delta (±1) */
    on_amount(a, actor) {
      const s = this.s;
      const p = this.actorPlayer(a, actor);
      const b = p && s.bets[p.id];
      if (s.phase !== 'betting' || !b) return false;
      const next = this.clampBet(a.amount !== undefined ? a.amount : b.amount + (+a.delta || 0), p);
      if (!next || next === b.amount) return false;
      b.amount = next;
      return true;
    }

    on_clearBet(a, actor) {
      const s = this.s;
      const p = this.actorPlayer(a, actor);
      if (s.phase !== 'betting' || !p || !s.bets[p.id]) return false;
      delete s.bets[p.id];
      return true;
    }

    /** „Gleiche Wette wie letztes Rennen“ für alle, die damals gewettet haben (und noch nicht neu gesetzt haben) */
    on_sameBets(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'betting') return false;
      let n = 0;
      for (const p of s.players) {
        const b = s.lastBets[p.id];
        if (!b || (p.phone && s.bets[p.id])) continue;
        const amount = this.clampBet(b.amount, p);
        if (!amount) continue;
        s.bets[p.id] = { suit: b.suit, amount };
        n++;
      }
      return n > 0;
    }

    /** Wer noch kein Pferd hat, bekommt eins per Zufall */
    on_randomBets(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'betting') return false;
      let n = 0;
      for (const id of this.missing()) {
        const p = this.player(id);
        const old = s.lastBets[id];
        const amount = this.clampBet(old ? old.amount : DEFAULT_BET, p);
        if (!amount) continue;
        s.bets[id] = { suit: Cards.SUITS[Math.floor(this.random() * Cards.SUITS.length)], amount };
        n++;
      }
      return n > 0;
    }

    /** Startschuss – alle müssen ein Pferd gewählt haben (force: wer fehlt, setzt aus) */
    on_start(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'betting' || this.stale(a) || !Object.keys(s.bets).length) return false;
      if (this.missing().length && !a.force) return false;
      this.startRace();
      return true;
    }

    /** Nächste Karte (automatisch im Takt oder per Tippen) */
    on_draw(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'racing' || !s.race || s.race.winner || s.oddsWin || this.stale(a)) return false;
      this.draw();
      return true;
    }

    /** Echte Karten: Platzierung eintragen (mindestens der Sieger, der Rest in der getippten Reihenfolge) */
    on_result(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'racing' || !this.real || this.stale(a) || !Array.isArray(a.ranking)) return false;
      const given = a.ranking.filter((x, i) => Cards.SUITS.includes(x) && a.ranking.indexOf(x) === i);
      if (!given.length) return false;
      const ranking = given.concat(Cards.SUITS.filter((x) => !given.includes(x)));
      this.settle(ranking);
      this.bump();
      return true;
    }

    /** Quoten-Wette: suit + amount, oder skip */
    on_oddsBet(a, actor) {
      const s = this.s;
      const w = s.oddsWin;
      const p = this.actorPlayer(a, actor);
      if (!w || !p || s.phase !== 'racing') return false;
      if (a.skip || !a.amount) {
        w.bets[p.id] = { skip: true };
      } else {
        const left = this.oddsLeft(p);
        if (!Cards.SUITS.includes(a.suit) || left < 1) return false;
        const amount = Math.max(1, Math.min(left, Math.round(+a.amount) || 1));
        w.bets[p.id] = { suit: a.suit, amount, odds: w.quotes[a.suit] };
      }
      this.checkOdds();
      if (!s.oddsWin) this.bump();
      return true;
    }

    /** Quoten-Fenster schließen (wer nichts getippt hat, setzt aus) */
    on_closeOdds(a, actor) {
      if (actor !== STAGE || !this.s.oddsWin) return false;
      this.closeOdds();
      this.bump();
      return true;
    }

    /** Schluck verteilen: +1 (delta -1 nimmt zurück). Handy: eigene Schlucke · Gerät: für giver */
    on_give(a, actor) {
      const s = this.s;
      const giver = this.actorPlayer(a, actor, 'giver');
      const target = this.player(a.target);
      if (s.phase !== 'payout' || !giver || !target || target === giver || !s.give[giver.id]) return false;
      const d = +a.delta === -1 ? -1 : 1;
      const cur = s.give[giver.id][target.id] || 0;
      if (d > 0 && this.giveLeft(giver.id) < 1) return false;
      if (d < 0 && cur < 1) return false;
      s.give[giver.id][target.id] = cur + d;
      if (!s.give[giver.id][target.id]) delete s.give[giver.id][target.id];
      return true;
    }

    on_pause(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'racing') return false;
      const paused = typeof a.paused === 'boolean' ? a.paused : !s.paused;
      if (paused === s.paused) return false;
      s.paused = paused;
      return true;
    }

    /** Rennen abbrechen: zurück ins Wettbüro, Wetten bleiben */
    on_abort(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'racing') return false;
      s.race = null;
      s.paused = false;
      s.oddsWin = null;
      s.oddsBets = {};
      s.phase = 'betting';
      this.bump();
      return true;
    }

    /** Nach der Abrechnung: nächstes Rennen oder (Rennzahl erreicht) Rangliste */
    on_next(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'payout' || this.stale(a)) return false;
      if (this.seriesOver()) this.finish();
      else this.nextRace();
      return true;
    }

    on_finish(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase === 'end') return false;
      this.finish();
      return true;
    }

    /** Nochmal mit denselben Leuten, Statistik und Chips von vorn */
    on_again(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'end' || s.players.length < MIN_PLAYERS) return false;
      for (const p of s.players) {
        p.stats = emptyStats();
        p.chips = CHIPS_START;
      }
      s.history = [];
      s.lastBets = {};
      s.bets = {};
      s.race = null;
      s.result = null;
      s.give = {};
      s.oddsBets = {};
      s.raceNo = 1;
      s.phase = 'betting';
      this.bump();
      return true;
    }

    /**
     * Einstellungen: jederzeit (Spielweise bleibt). Deck/Strecke gelten ab dem nächsten Rennen.
     * Die Währung lässt sich nur vor dem ersten Rennen wechseln.
     */
    on_settings(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase === 'end') return false;
      const keep = { input: s.settings.input };
      if (s.history.length || s.phase === 'racing' || s.phase === 'payout') keep.currency = s.settings.currency;
      s.settings = sanitizeSettings(Object.assign({}, a.settings, keep), s.settings);
      for (const [id, b] of Object.entries(s.bets)) {
        const p = this.player(id);
        const amount = p ? this.clampBet(b.amount, p) : 0;
        if (amount) b.amount = amount;
        else delete s.bets[id];
      }
      if (s.race && !s.race.odds) this.computeOdds();
      return true;
    }

    on_addPlayer(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase === 'end') return false;
      const name = cleanName(a.name, '');
      if (!name || !this.addPlayer(name)) return false;
      return true;
    }

    on_removePlayer(a, actor) {
      const s = this.s;
      const p = this.player(a.player);
      if (actor !== STAGE || !p || (s.phase !== 'lobby' && s.players.length <= MIN_PLAYERS)) return false;
      s.players = s.players.filter((x) => x !== p);
      delete s.bets[p.id];
      delete s.lastBets[p.id];
      delete s.oddsBets[p.id];
      delete s.give[p.id];
      for (const t of Object.values(s.give)) delete t[p.id];
      if (s.oddsWin) {
        delete s.oddsWin.bets[p.id];
        this.checkOdds();
      }
      if (p.phone) {
        delete s.members[p.phone];
        if (this.hooks.onKick) this.hooks.onKick(p.phone);
      }
      this.bump();
      return true;
    }

    /* ---------- Ansicht ---------- */

    /** Rennen für die Anzeige: verdeckte Streckenkarten und der Stapel bleiben geheim */
    raceView() {
      const r = this.s.race;
      if (!r) return null;
      const showOdds = this.s.settings.odds;
      return {
        length: r.length,
        track: r.track.map((c, i) => (r.shown[i] ? c : null)),
        pos: clone(r.pos),
        last: r.last,
        tick: r.tick,
        left: r.stack.length,
        winner: r.winner,
        ranking: Race.ranking(r),
        events: clone(r.events || []),
        at: clone(r.at),
        say: clone(r.say || null),
        odds: showOdds ? clone(r.odds || null) : null,
        oddsPrev: showOdds ? clone(r.oddsPrev || null) : null,
      };
    }

    /**
     * Auszeichnungen über alle bisherigen Rennen. Gleichstand → mehrere Namen, aber nur solange
     * die Auszeichnung jemanden heraushebt (höchstens AWARD_MAX Namen und nicht alle).
     * @returns {{id, icon, title, names: string[], text}[]}
     */
    awards() {
      const s = this.s;
      if (!s.history.length) return [];
      const ps = s.players.filter((p) => p.stats.races > 0);
      const unit = this.chips ? 'Chips' : 'Schlucke';
      const out = [];
      const special = (names) => names.length <= AWARD_MAX && names.length < ps.length;
      const best = (fn, icon, id, title, text) => {
        const max = Math.max(0, ...ps.map(fn));
        const names = ps.filter((p) => fn(p) === max).map((p) => p.name);
        if (max && special(names)) out.push({ id, icon, title, names, text: text(max) });
      };
      if (this.chips) {
        best((p) => p.stats.given, '💰', 'king', 'Großverdiener:in', (n) => `${n} Chips gewonnen`);
        best((p) => p.stats.drank, '📉', 'unlucky', 'Pechvogel', (n) => `${n} Chips verloren`);
      } else {
        best((p) => p.stats.given, '🎁', 'king', 'Wettkönig:in', (n) => `${n} Schlucke verteilt`);
        best((p) => p.stats.drank, '🍺', 'unlucky', 'Pechvogel', (n) => `${n} Schlucke getrunken`);
      }
      best((p) => p.stats.wins, '🎯', 'seer', 'Glückspilz', (n) => `${n}× richtig getippt`);
      best((p) => p.stats.staked, '🎰', 'gambler', 'Zocker:in', (n) => `${n} ${unit} gesetzt`);
      // Treue Seele: mindestens LOYAL_MIN Rennen, immer dasselbe Pferd
      const loyal = ps.filter((p) => p.stats.races >= LOYAL_MIN && Object.values(p.stats.suits || {}).filter(Boolean).length === 1);
      const max = Math.max(0, ...loyal.map((p) => p.stats.races));
      const top = loyal.filter((p) => p.stats.races === max);
      if (top.length && special(top.map((p) => p.name))) {
        const suits = [...new Set(top.map((p) => Cards.SUITS.find((x) => p.stats.suits[x])))];
        out.push({
          id: 'loyal',
          icon: '🐴',
          title: 'Treue Seele',
          names: top.map((p) => p.name),
          text: `${max}× ${suits.length === 1 ? 'auf ' + Cards.SUIT[suits[0]].name : 'dasselbe Pferd'} gesetzt`,
        });
      }
      return out;
    }

    /** Bilanz der Pferde: Siege, Ø Platz, Fotofinishs */
    horseStats() {
      const h = this.s.history;
      return Cards.SUITS.map((suit) => {
        const places = h.map((x) => x.ranking.indexOf(suit) + 1);
        return {
          suit,
          wins: h.filter((x) => x.winner === suit).length,
          avg: places.length ? places.reduce((a, b) => a + b, 0) / places.length : null,
          photos: h.filter((x) => x.winner === suit && x.photo).length,
        };
      }).sort((a, b) => b.wins - a.wins || (a.avg || 9) - (b.avg || 9));
    }

    /** Rangliste: Chips → nach Chips, Schlucke → meist verteilt, dann wenigsten getrunken */
    standings() {
      const chips = this.chips;
      return this.s.players
        .map((p) => ({ id: p.id, name: p.name, chips: p.chips, stats: clone(p.stats) }))
        .sort((x, y) =>
          chips
            ? y.chips - x.chips || y.stats.wins - x.stats.wins || x.name.localeCompare(y.name)
            : y.stats.given - x.stats.given || x.stats.drank - y.stats.drank || x.name.localeCompare(y.name)
        );
    }

    /** Wetten für einen Betrachter: bei geheimen Wetten sieht man fremde Handy-Wetten erst beim Start */
    betsFor(me) {
      const s = this.s;
      const out = {};
      const hide = s.settings.secretBets && s.phase === 'betting';
      for (const [id, b] of Object.entries(s.bets)) {
        const p = this.player(id);
        out[id] = hide && p && p.phone && (!me || me.id !== id) ? { hidden: true } : clone(b);
      }
      return out;
    }

    giveView() {
      const s = this.s;
      if (!s.result || !Object.keys(s.give).length) return null;
      const givers = {};
      for (const id of Object.keys(s.give)) givers[id] = { to: clone(s.give[id]), left: this.giveLeft(id) };
      return { givers, received: this.received() };
    }

    viewFor(viewer) {
      const s = this.s;
      const stage = viewer === STAGE;
      const mine = stage ? null : this.playerOfPhone(viewer);
      const wins = { S: 0, H: 0, D: 0, C: 0 };
      for (const h of s.history) wins[h.winner] += 1;
      const w = s.oddsWin;
      return {
        game: 'pferderennen',
        phase: s.phase,
        step: s.step,
        settings: clone(s.settings),
        players: s.players.map((p) => ({ id: p.id, name: p.name, phone: !!p.phone, online: this.online(p), chips: p.chips })),
        raceNo: s.raceNo,
        bets: this.betsFor(mine),
        hasLastBets: s.players.some((p) => s.lastBets[p.id]),
        missing: s.phase === 'betting' ? this.missing() : [],
        race: this.raceView(),
        paused: s.paused,
        oddsWin: w
          ? {
              quotes: clone(w.quotes),
              done: Object.keys(w.bets),
              bets: stage ? clone(w.bets) : mine && w.bets[mine.id] ? { [mine.id]: clone(w.bets[mine.id]) } : {},
              left: Object.fromEntries(s.players.map((p) => [p.id, this.oddsLeft(p)])),
            }
          : null,
        oddsBets: clone(s.oddsBets),
        give: this.giveView(),
        result: clone(s.result),
        seriesOver: s.phase === 'payout' && this.seriesOver(),
        history: clone(s.history),
        wins,
        standings: this.standings(),
        awards: this.awards(),
        horses: this.horseStats(),
        lobbyProblem: s.phase === 'lobby' ? this.lobbyProblem() : null,
        event: clone(s.event),
        me: {
          stage,
          host: stage,
          id: mine ? mine.id : null,
          name: mine ? mine.name : stage ? '' : (s.members[viewer] || {}).name || '',
          phone: !stage,
        },
      };
    }
  }

  root.PFEngine = {
    Engine,
    STAGE,
    INPUTS,
    CURRENCIES,
    DECKS,
    LENGTHS,
    MAX_BETS,
    PAYOUTS,
    SPEEDS,
    SPEED_MS,
    RACES,
    MIN_PLAYERS,
    MAX_PLAYERS,
    DEFAULT_BET,
    CHIPS_START,
    CHIPS_PAYOUT,
    PITY_CHIPS,
    DEFAULT_SETTINGS,
    sanitizeSettings,
    cleanName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
