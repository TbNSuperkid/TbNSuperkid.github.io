/*
 * Spiellogik von „Prost!“ – das Trinkspiel als Kartenstapel.
 *
 * Eine Karte nach der anderen, mit den Namen der Mitspielenden eingesetzt. Regeln und Viren gelten, bis sie
 * 5–15 Karten später wieder aufgehoben werden (oder bis zum Spielende). Optional kommt etwa alle 15 Karten
 * eine Wasserpause.
 *
 * Zwei Spielweisen:
 *  - pass:   Ein Gerät liegt in der Mitte. Alles läuft nur hier, komplett offline.
 *  - phones: Das Kartengerät öffnet einen Raum. Handys sind Fernbedienungen für anonyme Abstimmungen
 *            („Wer würde eher“, „Ich hab noch nie“) und zeigen die aktuelle Karte mit an.
 *            Wer kein Handy hat, wird am Kartengerät eingetragen und spielt trotzdem mit.
 *
 * Der Stapel wird zu Spielbeginn gebaut, Namen werden aber erst beim Aufdecken eingesetzt.
 * Phasen: lobby (nur Handys) → play → end
 */
(function (root) {
  'use strict';

  const Deck = root.PRDeck;

  const STAGE = 'stage';
  const INPUTS = ['pass', 'phones'];
  const LENGTH_OPTIONS = [30, 50, 80, 0]; // 0 = endlos
  const INTENSITIES = ['leicht', 'normal', 'heftig'];
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 20;
  const RULE_MIN = 5; // Regel-Ende frühestens … Karten später
  const RULE_MAX = 15; // … und spätestens
  const WATER_MIN = 13; // Wasserpause etwa alle 15 Karten
  const WATER_MAX = 17;
  const WATER_SIPS = 3;
  const ENDLESS_BATCH = 50;
  const DEFAULT_SETTINGS = {
    input: 'pass',
    length: 50,
    sets: Deck.DEFAULT_SETS.slice(),
    intensity: 'normal',
    water: true,
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
    if (INPUTS.includes(i.input)) s.input = i.input;
    if (i.length !== undefined && LENGTH_OPTIONS.includes(+i.length)) s.length = +i.length;
    if (Array.isArray(i.sets)) {
      const sets = Deck.SETS.map((x) => x.id).filter((id) => i.sets.includes(id));
      if (sets.length) s.sets = sets;
    }
    s.sets = (s.sets || Deck.DEFAULT_SETS).slice();
    if (INTENSITIES.includes(i.intensity)) s.intensity = i.intensity;
    if (typeof i.water === 'boolean') s.water = i.water;
    return s;
  }

  function same(a, b) {
    return String(a).toLowerCase() === String(b).toLowerCase();
  }

  class Engine {
    /**
     * @param {object} state Spielzustand (siehe Engine.create)
     * @param {{onChange?: Function, onKick?: Function, random?: Function}} hooks
     */
    constructor(state, hooks) {
      this.s = state;
      this.hooks = hooks || {};
      this.random = this.hooks.random || Math.random;
    }

    /**
     * Neues Spiel aus dem Setup.
     * @param {{settings: object, players?: string[], couples?: string[][]}} config
     *   players: Namen (Ein Gerät: alle; Handys: nur wer kein Handy hat – die anderen kommen per QR-Code dazu)
     *   couples: Paare als Namenspaare (für das Pärchen-Set)
     */
    static create(config, hooks) {
      const settings = sanitizeSettings(config.settings);
      const state = {
        v: 1,
        game: 'prost',
        settings,
        phase: 'lobby',
        step: 0,
        players: [],
        members: {},
        couples: [],
        nextId: 1,
        deck: [],
        cursor: 0,
        count: 0,
        shown: [],
        view: 0,
        active: [],
        ended: [],
        nextWater: 0,
        ruleNo: 0,
        vote: null,
        voteNo: 0,
        event: null,
        eventNo: 0,
      };
      const e = new Engine(state, hooks);
      for (const n of (config.players || []).map((x) => cleanName(x, '')).filter(Boolean)) e.addPlayer(n);
      for (const pair of config.couples || []) {
        const a = state.players.find((p) => same(p.name, pair[0]));
        const b = state.players.find((p) => same(p.name, pair[1]));
        if (a && b) e.addCouple(a.id, b.id);
      }
      if (settings.input === 'pass') {
        while (state.players.length < MIN_PLAYERS) e.addPlayer('Person ' + (state.players.length + 1));
        e.startGame();
      }
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

    player(id) {
      return this.s.players.find((p) => p.id === id) || null;
    }

    /** Spieler, der zu diesem Handy gehört */
    playerOfPhone(pid) {
      return this.s.players.find((p) => p.phone === pid) || null;
    }

    name(id) {
      const p = this.player(id);
      return p ? p.name : '?';
    }

    rand(min, max) {
      return min + Math.floor(this.random() * (max - min + 1));
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

    /** Neue Person: startet mit so vielen Einsätzen wie die Seltenste, damit sie nicht gleich dauernd dran ist */
    addPlayer(name, phone) {
      const s = this.s;
      if (s.players.length >= MAX_PLAYERS) return null;
      const picked = s.players.length ? Math.min(...s.players.map((p) => p.picked)) : 0;
      const p = { id: 'p' + s.nextId++, name: this.uniqueName(cleanName(name, 'Person ' + (s.players.length + 1))), picked, phone: phone || null };
      s.players.push(p);
      return p;
    }

    addCouple(a, b) {
      const s = this.s;
      if (a === b || !this.player(a) || !this.player(b)) return false;
      // Jede Person ist höchstens in einem Paar
      if (s.couples.some((c) => c.includes(a) || c.includes(b))) return false;
      s.couples.push([a, b]);
      return true;
    }

    /** Personen für die Abstimmung: mit verbundenem Handy */
    voters() {
      return this.s.players.filter((p) => p.phone && this.s.members[p.phone] && this.s.members[p.phone].online).map((p) => p.id);
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
          if (p && s.phase === 'play') this.event('joined', { name: p.name });
        }
      }
      this.changed();
    }

    disconnect(pid) {
      const m = this.s.members[pid];
      if (!m || !m.online) return;
      m.online = false;
      this.checkVote();
      this.changed();
    }

    /** Nach dem Neuladen des Hosts: alle müssen sich neu verbinden */
    setAllOffline() {
      for (const m of Object.values(this.s.members)) m.online = false;
    }

    /* ---------- Ablauf ---------- */

    startGame() {
      const s = this.s;
      s.phase = 'play';
      s.deck = Deck.build({ sets: s.settings.sets, length: s.settings.length, couples: s.couples.length > 0, random: this.random });
      s.cursor = 0;
      s.count = 0;
      s.active = [];
      s.ended = [];
      s.vote = null;
      s.nextWater = this.rand(WATER_MIN, WATER_MAX);
      for (const p of s.players) p.picked = 0;
      // Erste Karte: Startkarte, zählt nicht mit
      s.shown = [{ n: 0, kind: 'start', type: 'start', text: 'Los geht’s – viel Spaß!', players: [], count: 0 }];
      s.view = 0;
      this.bump();
    }

    /** Wie viele Karten noch im Stapel liegen (endlos: null) */
    left() {
      const s = this.s;
      if (!s.settings.length) return null;
      return Math.max(0, Math.min(s.settings.length - s.count, s.deck.length - s.cursor));
    }

    played() {
      return this.s.shown.filter((x) => x.kind === 'card').map((x) => x.key);
    }

    push(entry) {
      const s = this.s;
      entry.n = s.shown.length;
      entry.count = s.count;
      s.shown.push(entry);
      s.view = s.shown.length - 1;
    }

    /** Nächste Karte aufdecken: fällige Regel-Enden, Wasserpause, sonst die nächste Karte vom Stapel */
    reveal() {
      const s = this.s;
      const due = s.active.find((r) => r.endAt != null && r.endAt <= s.count);
      if (due) {
        s.active = s.active.filter((r) => r !== due);
        this.push({ kind: 'end', type: 'ende', of: due.type, text: due.endText, rule: due.id, ruleText: due.text, players: due.players.slice() });
        return;
      }
      const over = s.settings.length && s.count >= s.settings.length;
      if (s.settings.water && s.count >= s.nextWater && !over) {
        s.nextWater = s.count + this.rand(WATER_MIN, WATER_MAX);
        this.push({ kind: 'pause', type: 'pause', text: `Wasserpause! Alle trinken ${WATER_SIPS} Schlucke Wasser.`, players: [] });
        return;
      }
      if (over) {
        this.finish();
        return;
      }
      const last = s.shown[s.shown.length - 1];
      const ctx = {
        players: s.players,
        couples: s.couples,
        intensity: s.settings.intensity,
        avoid: last ? last.players : [],
        random: this.random,
      };
      for (let tries = 0; tries < 400; tries++) {
        if (s.cursor >= s.deck.length) {
          if (s.settings.length) break;
          // Endlos: nachlegen
          s.deck.push(...Deck.more({ sets: s.settings.sets, couples: s.couples.length > 0, exclude: this.played(), count: ENDLESS_BATCH, random: this.random }));
          if (s.cursor >= s.deck.length) break;
        }
        const card = s.deck[s.cursor++];
        const f = Deck.fill(card, ctx);
        if (!f) continue; // passt gerade nicht (z.B. kein Paar mehr) – nächste Karte
        s.count += 1;
        for (const id of f.players) {
          const p = this.player(id);
          if (p) p.picked += 1;
        }
        Deck.markSeen(card.key);
        const entry = { kind: 'card', key: card.key, set: card.set, type: card.type, text: f.text, note: f.note, players: f.players };
        if (Deck.LASTING.includes(card.type)) {
          const endAt = s.count + this.rand(RULE_MIN, RULE_MAX);
          const rule = {
            id: 'r' + ++s.ruleNo,
            type: card.type,
            text: f.text,
            endText: f.endText,
            players: f.players,
            endAt: s.settings.length && endAt > s.settings.length ? null : endAt,
          };
          s.active.push(rule);
          entry.rule = rule.id;
        }
        this.push(entry);
        this.openVote(entry);
        return;
      }
      // Stapel leer
      this.finish();
    }

    finish() {
      const s = this.s;
      s.vote = null;
      s.ended = s.active.map((r) => ({ id: r.id, type: r.type, text: r.text, endText: r.endText }));
      s.active = [];
      s.phase = 'end';
      this.bump();
    }

    /** Endlos oder geänderte Sets/Länge: noch nicht gezogene Karten neu bauen */
    rebuildRest() {
      const s = this.s;
      const remaining = s.settings.length ? Math.max(0, s.settings.length - s.count) : ENDLESS_BATCH;
      const exclude = this.played();
      s.deck = s.deck.slice(0, s.cursor).concat(
        Deck.build({ sets: s.settings.sets, length: remaining, couples: s.couples.length > 0, exclude, warmup: s.count === 0, random: this.random })
      );
      // Regeln, deren Ende jetzt hinter dem Spielende läge, gelten bis zum Schluss – und umgekehrt
      for (const r of s.active) {
        if (s.settings.length && r.endAt != null && r.endAt > s.settings.length) r.endAt = null;
        if (r.endAt == null && !s.settings.length) r.endAt = s.count + this.rand(RULE_MIN, RULE_MAX);
      }
    }

    /* ---------- Abstimmungen (Mit Handys) ---------- */

    openVote(entry) {
      const s = this.s;
      s.vote = null;
      if (!this.write || !Deck.VOTE_SIPS[entry.type] || !this.voters().length) return;
      s.vote = { no: ++s.voteNo, entry: entry.n, kind: entry.type, votes: {} };
    }

    /** Alle mit Handy haben abgestimmt → auflösen */
    checkVote() {
      const v = this.s.vote;
      if (!v) return;
      const voters = this.voters();
      if (voters.length && voters.every((id) => v.votes[id] !== undefined)) this.closeVote();
    }

    closeVote() {
      const s = this.s;
      const v = s.vote;
      if (!v) return;
      s.vote = null;
      const entry = s.shown[v.entry];
      if (!entry) return;
      const values = Object.values(v.votes);
      if (v.kind === 'eher') {
        const tally = {};
        for (const id of values) if (this.player(id)) tally[id] = (tally[id] || 0) + 1;
        const max = Math.max(0, ...Object.values(tally));
        entry.result = { kind: 'eher', tally, top: max ? Object.keys(tally).filter((id) => tally[id] === max) : [], total: values.length };
      } else {
        entry.result = { kind: 'nie', yes: values.filter((x) => x === 'yes').length, total: values.length };
      }
      this.event('vote', { entry: entry.n });
    }

    /* ---------- Aktionen ---------- */

    /**
     * Verarbeitet eine Aktion. Gibt true zurück, wenn sich etwas geändert hat.
     * @param {object} a Aktion {type, ...}
     * @param {string} actor 'stage' (Kartengerät) oder Handy-ID
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

    on_start(a, actor) {
      if (actor !== STAGE || this.s.phase !== 'lobby' || this.lobbyProblem()) return false;
      this.startGame();
      return true;
    }

    /** Weiter: offene Abstimmung erst auflösen, nach „Zurück“ erst wieder vorblättern, sonst neue Karte */
    on_next(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'play' || this.stale(a)) return false;
      if (s.vote && s.vote.entry === s.view && Object.keys(s.vote.votes).length) {
        this.closeVote();
      } else if (s.view < s.shown.length - 1) {
        s.view += 1;
      } else {
        s.vote = null;
        this.reveal();
      }
      this.bump();
      return true;
    }

    on_back(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase !== 'play' || s.view <= 0 || this.stale(a)) return false;
      s.view -= 1;
      this.bump();
      return true;
    }

    /** Abstimmung jetzt auflösen (auch wenn noch nicht alle abgestimmt haben) */
    on_closeVote(a, actor) {
      if (actor !== STAGE || !this.s.vote) return false;
      this.closeVote();
      this.bump();
      return true;
    }

    /** Handy stimmt ab: „Wer würde eher“ → Spieler-ID, „Ich hab noch nie“ → 'yes' / 'no' */
    on_vote(a, actor) {
      const s = this.s;
      const v = s.vote;
      const me = this.playerOfPhone(actor);
      if (!v || !me || (a.no !== undefined && a.no !== v.no)) return false;
      if (v.kind === 'eher' && !this.player(a.value)) return false;
      if (v.kind === 'nie' && !['yes', 'no'].includes(a.value)) return false;
      v.votes[me.id] = a.value;
      this.checkVote();
      return true;
    }

    /** Einstellungen: jederzeit (Spielweise bleibt). Andere Sets/Länge → Rest des Stapels neu bauen */
    on_settings(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase === 'end') return false;
      const before = s.settings;
      s.settings = sanitizeSettings(Object.assign({}, a.settings, { input: before.input }), before);
      if (s.phase === 'play') {
        if (s.settings.water && !before.water) s.nextWater = s.count + this.rand(WATER_MIN, WATER_MAX);
        if (s.settings.length !== before.length || s.settings.sets.join() !== before.sets.join()) this.rebuildRest();
      }
      return true;
    }

    on_addPlayer(a, actor) {
      const s = this.s;
      if (actor !== STAGE || s.phase === 'end') return false;
      const name = cleanName(a.name, '');
      if (!name || !this.addPlayer(name)) return false;
      return true;
    }

    /** Person geht: Regeln/Viren mit ihr enden, ihr Paar wird aufgelöst, ihr Handy fliegt raus */
    on_removePlayer(a, actor) {
      const s = this.s;
      const p = this.player(a.player);
      if (actor !== STAGE || !p) return false;
      if (s.phase === 'play' && s.players.length <= MIN_PLAYERS) return false;
      s.players = s.players.filter((x) => x !== p);
      s.couples = s.couples.filter((c) => !c.includes(p.id));
      const gone = s.active.filter((r) => r.players.includes(p.id));
      s.active = s.active.filter((r) => !r.players.includes(p.id));
      if (s.vote) {
        delete s.vote.votes[p.id];
        for (const [voter, target] of Object.entries(s.vote.votes)) if (target === p.id) delete s.vote.votes[voter];
        this.checkVote();
      }
      if (p.phone) {
        delete s.members[p.phone];
        if (this.hooks.onKick) this.hooks.onKick(p.phone);
      }
      if (gone.length) this.event('left', { name: p.name, rules: gone.length });
      this.bump();
      return true;
    }

    on_addCouple(a, actor) {
      if (actor !== STAGE || this.s.phase === 'end') return false;
      if (!this.addCouple(a.a, a.b)) return false;
      if (this.s.phase === 'play' && this.s.settings.sets.includes('paerchen') && this.s.couples.length === 1) this.rebuildRest();
      return true;
    }

    on_removeCouple(a, actor) {
      const s = this.s;
      if (actor !== STAGE || !s.couples[a.index]) return false;
      s.couples.splice(a.index, 1);
      return true;
    }

    /** Regel/Virus von Hand aufheben (z.B. weil es keinen Spaß macht) */
    on_endRule(a, actor) {
      const s = this.s;
      const r = s.active.find((x) => x.id === a.id);
      if (actor !== STAGE || !r) return false;
      s.active = s.active.filter((x) => x !== r);
      return true;
    }

    on_finish(a, actor) {
      if (actor !== STAGE || this.s.phase !== 'play') return false;
      this.finish();
      return true;
    }

    /** Nochmal mit denselben Leuten */
    on_again(a, actor) {
      if (actor !== STAGE || this.s.phase !== 'end') return false;
      if (this.s.players.length < MIN_PLAYERS) return false;
      this.startGame();
      return true;
    }

    /* ---------- Ansicht ---------- */

    viewFor(viewer) {
      const s = this.s;
      const stage = viewer === STAGE;
      const mine = stage ? null : this.playerOfPhone(viewer);
      const entry = s.phase === 'play' ? s.shown[s.view] || null : null;
      const vote = s.vote && entry && s.vote.entry === entry.n ? s.vote : null;
      const online = (p) => !p.phone || !!(s.members[p.phone] && s.members[p.phone].online);
      return {
        game: 'prost',
        phase: s.phase,
        step: s.step,
        settings: clone(s.settings),
        players: s.players.map((p) => ({ id: p.id, name: p.name, picked: p.picked, phone: !!p.phone, online: online(p) })),
        couples: clone(s.couples),
        count: s.count,
        total: s.settings.length,
        left: s.phase === 'play' ? this.left() : null,
        entry: entry ? clone(entry) : null,
        latest: s.view === s.shown.length - 1,
        canBack: s.phase === 'play' && s.view > 0,
        active: s.active.map((r) => ({ id: r.id, type: r.type, text: r.text, players: r.players.slice(), left: r.endAt == null ? null : Math.max(0, r.endAt - s.count) })),
        ended: clone(s.ended),
        vote: vote
          ? {
              no: vote.no,
              kind: vote.kind,
              count: Object.keys(vote.votes).length,
              total: this.voters().length,
              mine: mine ? (vote.votes[mine.id] === undefined ? null : vote.votes[mine.id]) : null,
            }
          : null,
        voters: this.write ? this.voters().length : 0,
        lobbyProblem: s.phase === 'lobby' ? this.lobbyProblem() : null,
        event: clone(s.event),
        stats: s.phase === 'end' ? s.players.map((p) => ({ id: p.id, name: p.name, picked: p.picked })).sort((x, y) => y.picked - x.picked) : null,
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

  root.PREngine = {
    Engine,
    STAGE,
    INPUTS,
    LENGTH_OPTIONS,
    INTENSITIES,
    DEFAULT_SETTINGS,
    MIN_PLAYERS,
    MAX_PLAYERS,
    RULE_MIN,
    RULE_MAX,
    WATER_MIN,
    WATER_MAX,
    WATER_SIPS,
    sanitizeSettings,
    cleanName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
