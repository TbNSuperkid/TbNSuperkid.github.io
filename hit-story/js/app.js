/*
 * Oberfläche von „Hit Story“.
 *  - Laptop („Bühne“ und Lautsprecher): Spiel anlegen, Lobby mit QR-Code, Song abspielen (iTunes-Ausschnitt oder
 *    „Selbst abspielen“ mit DJ), alle Zeitstrahle, Einspruch-Zeit, Auflösung, Siegerehrung mit Playlist des Abends.
 *    Ein Gerät: Hier wird auch eingeordnet, Einspruch per Knopf, „Titel gewusst?“ bestätigt die Runde.
 *  - Handy: eigener Zeitstrahl, Lücke antippen, Titel + Interpret tippen, Joker, „✋ Daneben!“, DJ-Karte.
 * Gerendert wird per HTML-String + morphdom. Fortschrittsbalken und Countdown bewegen sich direkt im DOM (data-live).
 */
(function () {
  'use strict';

  const E = window.HSEngine;
  const { Engine, TARGETS, JOKER_STARTS, MIN_PLAYERS, MAX_PLAYERS, MAX_NAME, MIN_POOL, MAX_JOKERS, SKIP_COST, BUY_COST, CHALLENGE_COST, CHALLENGE_MS, EXACT_FACTOR, sanitizeSettings, cleanName } = E;
  const { StageController, ClientController, Store, KEYS, Net, inviteLink, qrSvg } = window.HSControllers;
  const T = window.HSTimeline;
  const Songs = window.Songs;
  const AudioSource = window.AudioSource;
  const { Sound, confetti } = window.GameFx;

  const INPUT = {
    phones: { icon: '📱', label: 'Mit Handys', text: 'Jede/r hat den eigenen Zeitstrahl am Handy, tippt Titel und legt Einspruch ein. Der Laptop ist Bühne und Lautsprecher.' },
    one: { icon: '🖥️', label: 'Ein Gerät', text: 'Alle sitzen um den Laptop. Eingeordnet wird per Klick, Titel und Interpret sagt man laut.' },
  };
  const AUDIO = {
    itunes: { icon: '🍏', label: 'Ausschnitte', text: '30 s aus Apple Music spielen am Laptop – braucht Internet' },
    manual: { icon: '🎧', label: 'Selbst abspielen', text: 'Der DJ sucht den Song in der eigenen Musik-App' },
  };
  const VARIANT = {
    normal: { icon: '🎵', label: 'Normal', text: 'Lücke im eigenen Zeitstrahl' },
    easy: { icon: '🟢', label: 'Leicht', text: 'nur vor oder nach einer Karte' },
    pro: { icon: '🔴', label: 'Profi', text: 'Titel + Interpret Pflicht' },
    coop: { icon: '🤝', label: 'Kooperativ', text: 'ein Zeitstrahl für alle, 3 Fehler' },
    exact: { icon: '🎯', label: 'Jahr genau', text: 'Jahr tippen: 3 / 2 / 1 Punkt' },
  };
  const LEVEL = {
    easy: { icon: '🙂', label: 'Bekannt', text: 'nur Hits, die jede/r kennt' },
    mixed: { icon: '🎶', label: 'Gemischt', text: 'Hits und Bekanntes' },
    all: { icon: '🎲', label: 'Alle', text: 'auch Raritäten' },
    hard: { icon: '🤓', label: 'Kenner', text: 'ohne die größten Hits' },
  };
  const DJ = {
    turn: { icon: '🔁', label: 'Reihum', text: 'wer vor der aktiven Person sitzt' },
    host: { icon: '🎧', label: 'Spielleitung', text: 'eine Person, die nicht mitspielt' },
  };

  const SETUP_KEY = 'hitstory.setup.v2';
  const PREFS_KEY = 'hitstory.prefs.v1';
  const USED_KEY = 'hitstory.used.v1';
  const ACTIVE_KEY = 'hitstory.active';
  const RESUME_MAX_AGE = 12 * 60 * 60 * 1000;
  const EVENING = 12 * 60 * 60 * 1000; // „ein Abend“: so lange wiederholen sich keine Songs

  const app = document.getElementById('app');

  /* ------------------------------------------------------------------ */
  /* Hilfsfunktionen                                                     */
  /* ------------------------------------------------------------------ */

  function esc(s) {
    return String(s == null ? '' : s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  }

  function session(key, value) {
    try {
      if (value === undefined) return window.sessionStorage.getItem(key);
      if (value === null) window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, value);
    } catch {
      /* egal */
    }
    return null;
  }

  function plural(n, one, many) {
    return n === 1 ? one : many;
  }

  function andList(names) {
    return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
  }

  function vibrate(p) {
    try {
      // vor dem ersten Antippen blockiert der Browser das Vibrieren (und meckert in der Konsole)
      const ua = navigator.userActivation;
      if (navigator.vibrate && (!ua || ua.hasBeenActive)) navigator.vibrate(p);
    } catch {
      /* egal */
    }
  }

  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => (wakeLock = null));
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch {
      wakeLock = null;
    }
  }

  function memberName(v, pid) {
    const m = v.members.find((x) => x.id === pid);
    return m ? m.name : '?';
  }

  function teamStyle(t) {
    return `--team:${esc(t.color)}`;
  }

  function jokersHtml(n) {
    return n ? `<span class="jokers" aria-label="${n} ${plural(n, 'Joker', 'Joker')}">${'🪙'.repeat(n)}</span>` : '<span class="jokers is-empty" aria-label="keine Joker">–</span>';
  }

  function decadeClass(year) {
    return 'd-' + Songs.decadeOf(year);
  }

  /* ------------------------------------------------------------------ */
  /* Speicher                                                            */
  /* ------------------------------------------------------------------ */

  function loadSetup() {
    const s = Store.get(SETUP_KEY) || {};
    const names = Array.isArray(s.names) ? s.names.map((n) => String(n || '').slice(0, MAX_NAME)).slice(0, MAX_PLAYERS) : [];
    while (names.length < MIN_PLAYERS) names.push('');
    return { names, settings: sanitizeSettings(s.settings) };
  }

  function saveSetup() {
    Store.set(SETUP_KEY, ui.setup);
  }

  const evening = (() => {
    const saved = Store.get(USED_KEY);
    if (saved && Array.isArray(saved.ids) && Date.now() - saved.at < EVENING) return saved;
    return { at: Date.now(), ids: [] };
  })();

  Engine.evening = {
    used: () => evening.ids,
    onDraw(song, reset) {
      if (reset) evening.ids = [];
      if (!evening.ids.includes(song.id)) evening.ids.push(song.id);
      Store.set(USED_KEY, evening);
    },
  };

  /* ------------------------------------------------------------------ */
  /* Zustand der Oberfläche                                              */
  /* ------------------------------------------------------------------ */

  const params = new URLSearchParams(location.search);
  const prefs = Store.get(PREFS_KEY) || {};

  const ui = {
    screen: 'home', // home | setup | join | connecting | stage | player
    ctrl: null,
    token: null,
    view: null,
    viewAt: 0,
    status: null,
    setup: loadSetup(),
    name: prefs.name || '',
    joinCode: Net.cleanCode(params.get('raum') || ''),
    error: null,
    modal: null, // rules | menu | quit | dj | qr | challenge | settings
    service: 'spotify',
    challengeTeam: null, // ein Gerät: welches Team legt Einspruch ein
    challengeGap: null, // Handy: gewählte Lücke für den Einspruch
    guess: { title: '', artist: '' }, // Handy: Tipp des aktiven Teams
    guessSong: null,
    year: 1990,
    toast: null,
    focus: null,
  };
  if (ui.joinCode) ui.screen = 'join';

  function savePrefs() {
    Store.set(PREFS_KEY, { name: ui.name });
  }

  let toastTimer = null;
  function toast(text) {
    ui.toast = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      ui.toast = null;
      render();
    }, 2800);
    render();
  }

  /* ------------------------------------------------------------------ */
  /* Ton am Laptop (iTunes-Ausschnitte)                                  */
  /* ------------------------------------------------------------------ */

  const Player = {
    el: null,
    id: null,
    hit: null,
    state: 'idle', // idle | loading | ready | playing | paused | ended | missing | error | blocked
    hits: {}, // id → Treffer (für die Store-Links in der Playlist)
    loads: {}, // id → Promise

    audio() {
      if (!this.el) {
        this.el = new Audio();
        this.el.preload = 'auto';
        this.el.addEventListener('timeupdate', () => this.progress());
        this.el.addEventListener('ended', () => {
          this.state = 'ended';
          render();
        });
        this.el.addEventListener('playing', () => {
          this.state = 'playing';
          render();
        });
        this.el.addEventListener('pause', () => {
          if (this.state === 'playing') {
            this.state = 'paused';
            render();
          }
        });
      }
      this.el.muted = Sound.muted;
      return this.el;
    },

    find(song) {
      if (!this.loads[song.id]) {
        this.loads[song.id] = AudioSource.itunes.find(song).then(
          (hit) => {
            this.hits[song.id] = hit;
            return hit;
          },
          (err) => {
            delete this.loads[song.id];
            throw err;
          }
        );
      }
      return this.loads[song.id];
    },

    /** Song wechseln: suchen, laden, abspielen */
    load(song, autoplay) {
      const id = song.id;
      this.stop();
      this.id = id;
      this.hit = null;
      this.state = 'loading';
      this.find(song).then(
        (hit) => {
          if (this.id !== id) return;
          if (!hit) {
            this.state = 'missing';
            render();
            // Kein Ausschnitt: unbemerkt der nächste Song
            if (ui.ctrl && ui.view && ui.view.phase === 'listen' && ui.view.song && ui.view.song.id === id) dispatch('replace', { id });
            return;
          }
          this.hit = hit;
          const el = this.audio();
          el.src = hit.url;
          this.state = 'ready';
          if (autoplay) this.play();
          render();
        },
        () => {
          if (this.id !== id) return;
          this.state = 'error';
          render();
        }
      );
      render();
    },

    play() {
      if (!this.hit) return;
      const el = this.audio();
      if (this.state === 'ended') el.currentTime = 0;
      const p = el.play();
      if (p && p.catch)
        p.catch(() => {
          this.state = 'blocked';
          render();
        });
    },

    pause() {
      if (this.el) this.el.pause();
    },

    restart() {
      if (!this.hit) return;
      this.audio().currentTime = 0;
      this.play();
    },

    stop() {
      if (this.el) {
        this.el.pause();
        this.el.removeAttribute('src');
        try {
          this.el.load();
        } catch {
          /* egal */
        }
      }
      this.id = null;
      this.hit = null;
      this.state = 'idle';
    },

    progress() {
      const bar = app.querySelector('[data-live="audio"] span');
      if (!bar || !this.el || !this.el.duration) return;
      bar.style.width = `${Math.min(100, (100 * this.el.currentTime) / this.el.duration).toFixed(1)}%`;
      const time = app.querySelector('[data-live="audio-time"]');
      if (time) time.textContent = `0:${String(Math.floor(this.el.currentTime)).padStart(2, '0')}`;
    },

    /** Bühne: passt der Ton zur Ansicht? */
    sync(v) {
      const active = v.settings.audio === 'itunes' && v.song && ['listen', 'challenge', 'reveal'].includes(v.phase);
      if (!active) {
        if (this.id) this.stop();
        return;
      }
      if (this.id !== v.song.id && v.phase === 'listen') this.load(v.song, true);
      if (v.nextSong) this.find(v.nextSong).catch(() => {});
    },
  };

  /* ------------------------------------------------------------------ */
  /* Controller starten / beenden                                        */
  /* ------------------------------------------------------------------ */

  function startController(kind, factory) {
    stopController(true);
    const token = {};
    ui.token = token;
    const guard =
      (fn) =>
      (...args) => {
        if (ui.token === token) fn(...args);
      };
    const cb = { onView: guard(handleView), onStatus: guard(handleStatus), onKicked: guard(handleKicked) };
    ui.view = null;
    ui.status = null;
    ui.error = null;
    ui.screen = 'connecting';
    session(ACTIVE_KEY, kind);
    try {
      ui.ctrl = factory(cb);
    } catch (err) {
      ui.ctrl = null;
      ui.token = null;
      session(ACTIVE_KEY, null);
      ui.screen = kind === 'client' ? 'join' : 'setup';
      ui.error = 'Verbindung nicht möglich: ' + err.message;
    }
    render();
  }

  function stopController(keepSave) {
    if (ui.ctrl) ui.ctrl.leave(keepSave);
    ui.ctrl = null;
    ui.token = null;
    ui.view = null;
    ui.modal = null;
    Player.stop();
    session(ACTIVE_KEY, null);
    keepAwake(false);
  }

  function goHome(keepSave) {
    stopController(keepSave);
    ui.screen = 'home';
    history.replaceState(null, '', location.pathname);
    render();
  }

  function startStage(opts) {
    startController('stage', (cb) => new StageController(opts, cb));
  }

  function startClient(opts) {
    startController('client', (cb) => new ClientController(opts, cb));
  }

  function savedGames() {
    const now = Date.now();
    const stage = Store.get(KEYS.stage);
    const client = Store.get(KEYS.client);
    return {
      stage: stage && stage.state && stage.state.v === 2 && stage.state.phase !== 'end' && now - (stage.savedAt || 0) < RESUME_MAX_AGE ? stage : null,
      client: client && client.code && now - (client.savedAt || 0) < RESUME_MAX_AGE ? client : null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Ereignisse aus dem Controller                                       */
  /* ------------------------------------------------------------------ */

  function handleView(v) {
    const prev = ui.view;
    ui.view = v;
    ui.viewAt = performance.now();
    ui.screen = v.me.stage ? 'stage' : 'player';
    if (v.me.stage) Player.sync(v);
    transitions(prev, v);
    if (v.phase !== 'lobby' && v.phase !== 'end') keepAwake(true);
    render();
  }

  /** Sounds, Vibration und Aufräumen bei Phasenwechseln */
  function transitions(prev, v) {
    const was = prev ? prev.phase : null;
    // neuer Zug: eigene Eingaben zurücksetzen
    if (ui.guessSong !== `${v.turns}:${v.songNo}`) {
      ui.guessSong = `${v.turns}:${v.songNo}`;
      ui.guess = { title: '', artist: '' };
      ui.challengeGap = null;
      if (v.year) ui.year = v.year;
    }
    if (was === v.phase) return;
    if (v.phase === 'listen' && was && was !== 'listen' && !v.me.stage && v.me.myTurn) vibrate([60, 40, 60]);
    if (v.phase === 'challenge' && !v.me.stage && v.teams[v.me.team] && v.teams[v.me.team].mayChallenge) vibrate(40);
    if (v.phase === 'reveal' && v.last) {
      Sound.flip();
      const good = v.last.outcome && (v.last.outcome.keep || (v.last.outcome.stolen && v.last.challenge.team === v.me.team));
      setTimeout(() => (good ? Sound.success() : Sound.fail()), 380);
      if (ui.modal === 'dj' || ui.modal === 'challenge') ui.modal = null;
    }
    if (v.phase === 'end' && was && was !== 'end') {
      Sound.fanfare();
      if (v.reason !== 'lost') confetti(['#ff4fa3', '#ffd166', '#34d3c5', '#a78bfa', '#fff']);
      keepAwake(false);
    }
    if (v.phase === 'listen' && ui.modal === 'challenge') ui.modal = null;
  }

  function handleStatus(status, info) {
    ui.status = status;
    if (status === 'error') {
      const e = (info || {}).error;
      const msg =
        e === 'not-found'
          ? 'Kein Spiel mit diesem Code gefunden. Stimmt der Code und ist der Laptop noch online?'
          : e === 'wrong-game'
            ? 'Unter diesem Code läuft ein anderes Spiel.'
            : 'Verbindung fehlgeschlagen. Bitte prüfe deine Internetverbindung.';
      stopController(true);
      ui.screen = 'join';
      ui.error = msg;
    }
    render();
  }

  function handleKicked(reason) {
    stopController(false);
    ui.screen = 'home';
    history.replaceState(null, '', location.pathname);
    toast(reason === 'kicked' ? 'Du wurdest aus dem Spiel entfernt.' : 'Das Spiel auf dem Laptop wurde beendet.');
  }

  function dispatch(type, extra) {
    if (!ui.ctrl) return;
    ui.ctrl.dispatch(Object.assign({ type }, extra || {}));
  }

  /* ------------------------------------------------------------------ */
  /* Bausteine                                                           */
  /* ------------------------------------------------------------------ */

  function vinylSvg(cls) {
    return `
      <svg class="vinyl ${cls || ''}" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="58" fill="#0b0a12" />
        <circle cx="60" cy="60" r="50" fill="none" stroke="#24223a" stroke-width="1.5" />
        <circle cx="60" cy="60" r="42" fill="none" stroke="#24223a" stroke-width="1.5" />
        <circle cx="60" cy="60" r="34" fill="none" stroke="#24223a" stroke-width="1.5" />
        <path d="M24 38 A 44 44 0 0 1 52 17" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="3" stroke-linecap="round" />
        <circle cx="60" cy="60" r="22" fill="#ff4fa3" />
        <circle cx="60" cy="60" r="22" fill="url(#hs-label)" />
        <circle cx="60" cy="60" r="3.5" fill="#0b0a12" />
        <defs>
          <linearGradient id="hs-label" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#ffd166" stop-opacity="0.9" />
            <stop offset="1" stop-color="#ff4fa3" stop-opacity="0" />
          </linearGradient>
        </defs>
      </svg>`;
  }

  function logoHtml(small) {
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="Hit Story"><span class="logo-text">Hit<span>Story</span></span></div>`;
  }

  function muteBtn() {
    return `<button class="icon-btn" data-act="mute" title="Ton an/aus" aria-label="Ton ${Sound.muted ? 'an' : 'aus'}schalten">${Sound.muted ? '🔇' : '🔊'}</button>`;
  }

  function cardHtml(c, extra) {
    return `
      <div class="card ${decadeClass(c.year)} ${extra || ''}">
        <b class="card-year">${c.year}</b>
        <span class="card-title">${esc(c.title)}</span>
        <span class="card-artist">${esc(c.artist)}</span>
      </div>`;
  }

  /**
   * Zeitstrahl mit Lücken.
   * o.act: data-act der Lücken (null = nicht anklickbar) · o.pick: gewählte Lücke · o.skip: Lücke ohne Knopf (Einspruch)
   * o.mark: zusätzlich markierte Lücke (Einspruch) · o.small · o.fresh: neue Karte · o.ghost {at, card} · o.miss: getippte Lücke
   */
  function lineHtml(cards, o) {
    const opt = o || {};
    const items = [];
    for (let g = 0; g <= cards.length; g++) {
      if (opt.act !== undefined) {
        const label = T.gapLabel(cards, g);
        const on = opt.pick === g;
        const marked = opt.mark === g;
        if (opt.skip === g) items.push(`<span class="slot is-taken" aria-label="Lücke ${esc(label)}: schon getippt"><span class="slot-mark">✋</span><span class="slot-label">${esc(label)}</span></span>`);
        else if (opt.act)
          items.push(`
          <button class="slot ${on ? 'on' : ''} ${marked ? 'is-challenge' : ''}" data-act="${opt.act}" data-gap="${g}" aria-pressed="${on}" aria-label="Lücke ${esc(label)}">
            <span class="slot-mark" aria-hidden="true">${on ? '🎵' : marked ? '✋' : '＋'}</span><span class="slot-label">${esc(label)}</span>
          </button>`);
        else items.push(`<span class="slot is-static ${on ? 'on' : ''} ${marked ? 'is-challenge' : ''}"><span class="slot-mark" aria-hidden="true">${on ? '🎵' : marked ? '✋' : '·'}</span><span class="slot-label">${esc(label)}</span></span>`);
      } else {
        if (opt.miss === g) items.push(`<div class="miss" aria-label="Hier getippt"><span>✗</span><small>getippt</small></div>`);
        if (opt.ghost && opt.ghost.at === g) items.push(cardHtml(opt.ghost.card, 'is-ghost'));
        if (opt.challenge === g) items.push(`<div class="miss is-hand" aria-label="Einspruch"><span>✋</span><small>Einspruch</small></div>`);
      }
      if (g < cards.length) items.push(cardHtml(cards[g], opt.fresh === g ? 'is-new' : ''));
    }
    return `<div class="line ${opt.small ? 'line-small' : 'line-active'} ${opt.act ? 'is-choosing' : ''}">${items.join('')}</div>`;
  }

  /** Kleine Zeitstrahle aller anderen */
  function othersHtml(v, skip) {
    const rows = v.teams
      .map((t, i) => ({ t, i }))
      .filter(({ i }) => i !== skip)
      .map(({ t, i }) => {
        const dj = v.dj && t.members.some((m) => m.id === v.dj) && v.phase === 'listen';
        const prog = v.settings.variant === 'exact' ? `${t.points}/${v.goal} P.` : `${t.cards.length}/${v.goal}`;
        return `
        <li class="other ${dj ? 'is-dj' : ''} ${i === v.turn ? 'is-turn' : ''}" style="${teamStyle(t)}">
          <span class="other-name"><i class="dot"></i>${dj ? '🎧 ' : ''}${esc(t.name)}</span>
          <span class="other-count">${prog} ${v.settings.variant === 'coop' ? '' : jokersHtml(t.jokers)}</span>
          <span class="chips">${t.cards.map((c, k) => `<i class="chip ${decadeClass(c.year)} ${t.fresh === k ? 'is-new' : ''}" title="${esc(c.title)} – ${esc(c.artist)}">${c.year}</i>`).join('')}</span>
        </li>`;
      })
      .join('');
    return rows ? `<ul class="others">${rows}</ul>` : '';
  }

  function finalBanner(v) {
    if (v.settings.variant === 'coop') {
      // in der Auflösung schon mit dem Fehler, der gleich verbucht wird
      const lost = Math.min(v.lives, v.mistakes + (v.phase === 'reveal' && v.last && v.last.outcome.mistake ? 1 : 0));
      const hearts = '❤️'.repeat(v.lives - lost) + '🖤'.repeat(lost);
      return `<p class="banner banner-coop">🤝 Gemeinsam ${v.teams[0] ? v.teams[0].cards.length : 0}/${v.goal} Karten · ${hearts}</p>`;
    }
    if (!v.finalRound) return '';
    const leaders = v.teams.filter((t) => t.progress >= v.goal).map((t) => esc(t.name));
    if (!leaders.length) return '';
    return `<p class="banner">🏁 ${andList(leaders)} ${plural(leaders.length, 'hat', 'haben')} das Ziel erreicht – die Runde wird noch zu Ende gespielt.</p>`;
  }

  function turnTitle(v) {
    const t = v.teams[v.turn];
    if (!t) return '';
    const sp = v.speaker ? memberName(v, v.speaker) : null;
    if (v.settings.variant === 'coop') return `<b>${esc(sp || 'Ihr')}</b> ${sp ? 'ist' : 'seid'} dran`;
    if (v.settings.teams && sp) return `<b style="color:${esc(t.color)}">${esc(t.name)}</b> ist dran · ${esc(sp)} tippt`;
    return `<b>${esc(t.name)}</b> ist dran`;
  }

  function goalLabel(v) {
    if (v.settings.variant === 'exact') return `Ziel ${v.goal} Punkte`;
    return `Ziel ${v.goal} Karten`;
  }

  /* ------------------------------------------------------------------ */
  /* Start und Spiel anlegen                                             */
  /* ------------------------------------------------------------------ */

  function homeHtml() {
    const saves = savedGames();
    const resume = [];
    if (saves.stage) {
      const st = saves.stage.state;
      const who = st.phase === 'lobby' ? 'Lobby' : `Runde ${st.round} · ${st.teams.map((t) => t.name).join(', ')}`;
      resume.push(`
        <div class="resume">
          <button class="btn btn-ghost btn-wide" data-act="resume-stage">▶ Weiterspielen <small>${esc(who)}</small></button>
          <button class="icon-btn" data-act="discard-stage" title="Verwerfen" aria-label="Gespeichertes Spiel verwerfen">✕</button>
        </div>`);
    }
    if (saves.client) {
      resume.push(`
        <div class="resume">
          <button class="btn btn-ghost btn-wide" data-act="resume-client">▶ Zurück ins Spiel <small>Raum ${esc(saves.client.code)} · als ${esc(saves.client.name)}</small></button>
          <button class="icon-btn" data-act="discard-client" title="Verwerfen" aria-label="Verwerfen">✕</button>
        </div>`);
    }
    return `
    <div class="screen home">
      <div class="home-top">
        <a class="btn btn-ghost btn-small hub-back" href="../">← Alle Spiele</a>
        ${muteBtn()}
      </div>
      <div class="home-hero">
        <div class="home-vinyl">${vinylSvg('spin')}</div>
        ${logoHtml()}
        <p class="tagline">Song hören, in den eigenen Zeitstrahl legen –<br>kam der <b>vor oder nach</b> „Atemlos“?</p>
        <div class="home-cards" aria-hidden="true">
          ${cardHtml({ year: 1982, title: 'Africa', artist: 'Toto' })}
          <span class="home-q">?</span>
          ${cardHtml({ year: 2013, title: 'Atemlos durch die Nacht', artist: 'Helene Fischer' })}
        </div>
      </div>
      ${resume.join('')}
      <div class="mode-cards">
        <button class="mode-card" data-act="setup">
          <span class="mode-icon">💻</span>
          <span class="mode-body"><b>Spiel anlegen</b><small>Am Laptop: Lautsprecher, Bühne und Zeitstrahle – mit Handys oder alle an einem Gerät.</small></span>
          <span class="mode-go">Los geht’s →</span>
        </button>
        <button class="mode-card" data-act="join-screen">
          <span class="mode-icon">📱</span>
          <span class="mode-body"><b>Mitspielen</b><small>Mit dem Handy beitreten – QR-Code am Laptop scannen oder Raum-Code eingeben.</small></span>
          <span class="mode-go">Beitreten →</span>
        </button>
      </div>
      <button class="btn btn-link" data-act="rules">📖 Spielregeln</button>
      <p class="home-foot">${MIN_PLAYERS}–${MAX_PLAYERS} Personen oder Teams · ${Songs.list().length} Songs von ${Songs.MIN_YEAR} bis heute</p>
    </div>`;
  }

  function choice(scope, key, value, label, on, extra, disabled) {
    return `<button class="choice ${on ? 'on' : ''}" data-act="set" data-scope="${scope}" data-key="${key}" data-value="${value}" aria-pressed="${on}" ${disabled ? 'disabled' : ''}>${label}${extra || ''}</button>`;
  }

  function toggle(scope, key, on, label, text) {
    return `
      <button class="toggle ${on ? 'on' : ''}" data-act="flip" data-scope="${scope}" data-key="${key}" role="switch" aria-checked="${on}">
        <span class="toggle-body"><b>${label}</b><small>${text}</small></span>
        <span class="switch" aria-hidden="true"><i></i></span>
      </button>`;
  }

  /** Mehrfachauswahl-Chip (leere Liste = alle an) */
  function pill(scope, key, value, label, list, count) {
    const on = !list.length || list.includes(value);
    return `<button class="pill ${on ? 'on' : ''}" data-act="pick" data-scope="${scope}" data-key="${key}" data-value="${value}" aria-pressed="${on}" ${count === 0 ? 'disabled' : ''}>${label}${count !== undefined ? `<small>${count}</small>` : ''}</button>`;
  }

  /** Einstellungen – im Setup (scope 'setup') und in der Lobby (scope 'lobby', geht an die Engine) */
  function settingsHtml(st, scope) {
    const songs = E.pool(st).length;
    const perDecade = {};
    for (const x of E.pool(Object.assign({}, st, { decades: [] }))) perDecade[x.decade] = (perDecade[x.decade] || 0) + 1;
    const perCat = {};
    for (const x of Songs.filter({ level: st.level, decades: st.decades })) perCat[x.cat] = (perCat[x.cat] || 0) + 1;
    const exact = st.variant === 'exact';
    const targetLabel = (t) => (exact ? `${t * EXACT_FACTOR} Punkte` : `${t} Karten`);
    return `
      <section class="panel">
        <h2>Ton</h2>
        <div class="choices choices-2">${Object.entries(AUDIO)
          .map(([id, a]) => choice(scope, 'audio', id, `${a.icon} ${a.label}`, st.audio === id, `<small>${a.text}</small>`))
          .join('')}</div>
        ${
          st.audio === 'manual'
            ? `<h2>Wer legt auf?</h2>
               <div class="choices choices-2">${Object.entries(DJ)
                 .map(([id, d]) => choice(scope, 'dj', id, `${d.icon} ${d.label}`, st.dj === id, `<small>${d.text}</small>`))
                 .join('')}</div>
               <p class="note">Der DJ sieht Titel und Interpret (nie das Jahr), sucht den Song in Spotify, YouTube oder Apple Music
                 und spielt ihn laut ab.${st.input === 'phones' ? ' Mit Handys steht der Song direkt auf dem DJ-Handy.' : ''}</p>`
            : `<p class="note">Die Ausschnitte kommen aus der iTunes-Suche. Findet sich kein passender, kommt einfach der nächste Song.</p>`
        }
      </section>
      <section class="panel">
        <h2>Variante</h2>
        <div class="choices choices-variant">${Object.entries(VARIANT)
          .map(([id, x]) => choice(scope, 'variant', id, `${x.icon} ${x.label}`, st.variant === id, `<small>${x.text}</small>`))
          .join('')}</div>
        <h2>Ziel</h2>
        <div class="choices">${TARGETS.map((t) => choice(scope, 'target', t, targetLabel(t), st.target === t, t === 10 ? '<small>Standard</small>' : t === 5 ? '<small>kurz</small>' : '<small>lang</small>')).join('')}</div>
        ${
          st.variant === 'coop'
            ? '<p class="note">🤝 Alle bauen einen Zeitstrahl – schafft ihr das Ziel, bevor 3 Fehler passieren?</p>'
            : `<h2>Joker am Start</h2>
               <div class="choices">${JOKER_STARTS.map((j) => choice(scope, 'jokers', j, j ? '🪙'.repeat(j) : 'keine', st.jokers === j)).join('')}</div>`
        }
        ${
          st.input === 'phones' && st.variant !== 'coop'
            ? `<h2>Teams</h2>
               <div class="choices">${[0, 2, 3, 4].map((n) => choice(scope, 'teams', n, n ? `${n} Teams` : 'jede/r allein', st.teams === n)).join('')}</div>`
            : ''
        }
      </section>
      <section class="panel">
        <h2>Jahrzehnte</h2>
        <div class="pills">${Songs.DECADES.map((d) => pill(scope, 'decades', d, Songs.decadeLabel(d), st.decades, perDecade[d] || 0)).join('')}</div>
        <h2>Kategorien</h2>
        <div class="pills">${Songs.CATEGORIES.map((c) => pill(scope, 'cats', c.id, `${c.icon} ${esc(c.label)}`, st.cats, perCat[c.id] || 0)).join('')}</div>
        <h2>Songs</h2>
        <div class="choices">${Object.entries(LEVEL)
          .map(([id, l]) => choice(scope, 'level', id, `${l.icon} ${l.label}`, st.level === id, `<small>${l.text}</small>`))
          .join('')}</div>
        <p class="note pool-count">🎶 <b>${songs}</b> ${plural(songs, 'Song passt', 'Songs passen')}${songs < MIN_POOL ? ` – mindestens ${MIN_POOL} nötig` : ''}</p>
      </section>
      <section class="panel">
        ${toggle(scope, 'drinks', st.drinks, '🍻 Trinkregeln', 'Falsch eingeordnet → 1 Schluck · erfolgreicher Einspruch → 2 Schlucke')}
      </section>`;
  }

  function setupHtml() {
    const s = ui.setup;
    const st = s.settings;
    const inputCard = (id) => `
      <button class="input-card ${st.input === id ? 'on' : ''}" data-act="set" data-scope="setup" data-key="input" data-value="${id}" aria-pressed="${st.input === id}">
        <span class="input-icon">${INPUT[id].icon}</span><b>${INPUT[id].label}</b><small>${INPUT[id].text}</small>
      </button>`;
    let names = '';
    let problem = '';
    if (st.input === 'one') {
      const rows = s.names
        .map(
          (n, i) => `
          <li class="name-row">
            <span class="seat">${i + 1}</span>
            <input type="text" maxlength="${MAX_NAME}" value="${esc(n)}" placeholder="Name ${i + 1}" data-field="name" data-i="${i}" id="name-${i}" autocomplete="off" enterkeyhint="next" />
            <button class="icon-btn" data-act="remove-name" data-i="${i}" title="Entfernen" aria-label="${esc(n || 'Name ' + (i + 1))} entfernen" ${s.names.length <= MIN_PLAYERS ? 'disabled' : ''}>✕</button>
          </li>`
        )
        .join('');
      names = `
        <section class="panel">
          <h2>Wer spielt mit?</h2>
          <p class="note">In <b>Sitzreihenfolge</b> eintragen – gespielt wird reihum. Teams? Einfach den Teamnamen eintragen.</p>
          <ol class="names">${rows}</ol>
          ${s.names.length < MAX_PLAYERS ? `<button class="btn btn-ghost btn-small" data-act="add-name">＋ Person</button>` : ''}
        </section>`;
      const filled = s.names.map((n) => cleanName(n)).filter(Boolean);
      if (filled.length < MIN_PLAYERS) problem = `Mindestens ${MIN_PLAYERS} Namen eintragen`;
      else if (new Set(filled.map((n) => n.toLowerCase())).size !== filled.length) problem = 'Zwei Personen heißen gleich – bitte unterscheidbar machen';
    }
    if (!problem && E.pool(st).length < MIN_POOL) problem = 'Zu wenige Songs – bitte mehr Jahrzehnte oder Kategorien wählen';
    return `
    <div class="screen setup">
      <header class="screen-head">
        <button class="icon-btn" data-act="home" title="Zurück" aria-label="Zurück">←</button>
        <h1>Neues Spiel</h1>
        ${muteBtn()}
      </header>
      ${ui.error ? `<div class="alert">${esc(ui.error)}</div>` : ''}
      <section class="panel">
        <h2>Spielweise</h2>
        <div class="input-cards">${inputCard('phones')}${inputCard('one')}</div>
      </section>
      ${names}
      ${settingsHtml(st, 'setup')}
      <div class="setup-go">
        ${problem ? `<p class="problem">${esc(problem)}</p>` : ''}
        <button class="btn btn-primary btn-big btn-wide" data-act="create" ${problem ? 'disabled' : ''}>${st.input === 'phones' ? '📱 Raum öffnen' : '🎵 Los geht’s'}</button>
      </div>
    </div>`;
  }

  function joinHtml() {
    return `
    <div class="screen join">
      <header class="screen-head">
        <button class="icon-btn" data-act="home" title="Zurück" aria-label="Zurück">←</button>
        <h1>Mitspielen</h1>
        <span></span>
      </header>
      <div class="join-hero">${vinylSvg('spin')}${logoHtml(true)}</div>
      ${ui.error ? `<div class="alert">${esc(ui.error)}</div>` : ''}
      <form class="panel join-form" data-form="join">
        <label class="label" for="name-input">Dein Name</label>
        <input id="name-input" class="input input-big" type="text" maxlength="${MAX_NAME}" placeholder="z. B. Alex" value="${esc(ui.name)}" data-field="join-name" autocomplete="nickname" enterkeyhint="next" />
        <label class="label" for="code-input">Raum-Code <small>(steht auf dem Laptop)</small></label>
        <input id="code-input" class="input input-code" type="text" maxlength="8" placeholder="ABCDE" value="${esc(ui.joinCode)}" data-field="join-code" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" />
        <button class="btn btn-primary btn-wide btn-big" type="submit">Beitreten</button>
      </form>
    </div>`;
  }

  function connectingHtml() {
    const reconnect = ui.status === 'reconnecting';
    return `
    <div class="screen connecting">
      <div class="spinner" aria-hidden="true"></div>
      <p>${reconnect ? 'Verbindung unterbrochen – verbinde neu…' : 'Verbinde…'}</p>
      <button class="btn btn-ghost" data-act="leave-now">Abbrechen</button>
    </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Laptop (Bühne)                                                      */
  /* ------------------------------------------------------------------ */

  function roomBoxHtml(room, big) {
    if (!room) return '';
    if (room.state === 'error') return `<div class="alert">Der Raum konnte nicht geöffnet werden. Prüfe die Internetverbindung – es wird weiter versucht.</div>`;
    if (!room.code || room.state !== 'online') return `<div class="qr-wait"><div class="spinner" aria-hidden="true"></div><p>Raum wird geöffnet…</p></div>`;
    const link = inviteLink(room.code);
    return `
      <div class="qr ${big ? 'qr-big' : ''}">${qrSvg(link)}</div>
      <div class="room-label">Raum-Code</div>
      <div class="room-code" data-testid="room-code">${esc(room.code)}</div>
      <p class="link-text">${esc(link)}</p>`;
  }

  function barHtml(v) {
    const room = v.room && v.room.code && v.phase !== 'lobby' ? `<button class="pill-btn" data-act="show-qr" title="Mitspieler einladen">📱 ${esc(v.room.code)}</button>` : '';
    const info = v.phase === 'lobby' ? 'Lobby' : v.phase === 'end' ? '🏁 Spielende' : v.settings.variant === 'coop' ? `Song ${v.songNo} · ${goalLabel(v)}` : `Runde ${v.round} · ${goalLabel(v)}`;
    return `
      <header class="bar">
        <span class="bar-left">${logoHtml(true)}<span class="round">${info}</span>${room}</span>
        <span class="bar-right">${muteBtn()}<button class="icon-btn" data-act="menu" title="Menü" aria-label="Menü">☰</button></span>
      </header>`;
  }

  function stageHtml(v) {
    let main;
    if (v.phase === 'lobby') main = lobbyStageHtml(v);
    else if (v.phase === 'end') main = endHtml(v, true);
    else if (v.phase === 'reveal') main = revealStageHtml(v);
    else main = listenStageHtml(v);
    return `<div class="screen game stage-${v.phase}">${barHtml(v)}${main}</div>`;
  }

  function lobbyStageHtml(v) {
    const teams = v.settings.teams;
    const playing = v.members.filter((m) => !m.watch);
    const watching = v.members.filter((m) => m.watch);
    const chip = (m) => `
      <span class="member ${m.online ? '' : 'is-offline'}" ${teams && m.team !== null ? `style="--team:${E.TEAMS[m.team].color}"` : ''}>
        <i class="dot"></i>${esc(m.name)}
        ${teams ? `<button class="member-team" data-act="move-team" data-player="${esc(m.id)}" title="Team wechseln" aria-label="${esc(m.name)}: Team wechseln">⇄</button>` : ''}
        <button class="member-x" data-act="kick" data-player="${esc(m.id)}" aria-label="${esc(m.name)} entfernen">✕</button>
      </span>`;
    let people;
    if (teams) {
      people = Array.from({ length: teams }, (_, i) => {
        const list = playing.filter((m) => m.team === i);
        return `<div class="team-box" style="--team:${E.TEAMS[i].color}"><h3>${esc(E.TEAMS[i].name)}</h3><div class="members">${list.length ? list.map(chip).join('') : '<span class="note">noch niemand</span>'}</div></div>`;
      }).join('');
    } else {
      people = `<div class="members">${playing.length ? playing.map(chip).join('') : '<span class="note">Noch niemand – QR-Code scannen!</span>'}</div>`;
    }
    const st = v.settings;
    const summary = [AUDIO[st.audio].icon + ' ' + AUDIO[st.audio].label, VARIANT[st.variant].icon + ' ' + VARIANT[st.variant].label, goalLabel(v), st.variant === 'coop' ? '' : `${st.jokers} 🪙`, `${v.poolSize} Songs`].filter(Boolean);
    return `
      <div class="lobby-grid">
        <section class="panel join-panel">
          <h2>📱 Handys verbinden</h2>
          <p class="note">QR-Code scannen, Namen eingeben – los geht’s.</p>
          ${roomBoxHtml(v.room, true)}
        </section>
        <div class="lobby-side">
          <section class="panel">
            <h2>Mitspieler <small>(${playing.length})</small></h2>
            ${people}
            ${watching.length ? `<p class="note"><b>Schauen zu:</b> ${watching.map((m) => esc(m.name)).join(', ')}</p>` : ''}
            <p class="note">Das erste Handy ist die 🎬 Spielleitung und kann vom Handy aus weiterschalten.</p>
          </section>
          <section class="panel">
            <h2>Einstellungen</h2>
            <p class="summary">${summary.map((x) => `<span>${esc(x)}</span>`).join('')}</p>
            <button class="btn btn-ghost btn-small" data-act="open-settings">⚙️ Ändern</button>
          </section>
          <div class="setup-go">
            ${v.lobbyProblem ? `<p class="problem">${esc(v.lobbyProblem)}</p>` : ''}
            <button class="btn btn-primary btn-big btn-wide" data-act="start" ${v.lobbyProblem ? 'disabled' : ''}>🎵 Los geht’s</button>
          </div>
        </div>
      </div>`;
  }

  /** Ton-Feld: Ausschnitt (iTunes) oder DJ (Selbst abspielen) */
  function audioHtml(v) {
    const st = v.settings;
    const fallback = st.audio === 'itunes' && Player.id === (v.song && v.song.id) && Player.state === 'error';
    if (st.audio === 'itunes' && !fallback) {
      const s = Player.state;
      let ctrl;
      if (s === 'loading' || s === 'idle') ctrl = `<span class="audio-state"><span class="spinner spinner-small" aria-hidden="true"></span> Ausschnitt wird geladen…</span>`;
      else if (s === 'missing') ctrl = `<span class="audio-state">Kein Ausschnitt – nächster Song…</span>`;
      else if (s === 'blocked') ctrl = `<button class="btn btn-primary" data-act="audio-play">▶ Abspielen</button><span class="audio-state">Der Browser wartet auf einen Klick</span>`;
      else
        ctrl = `
          ${s === 'playing' ? `<button class="btn btn-ghost btn-small" data-act="audio-pause">⏸ Pause</button>` : `<button class="btn btn-primary btn-small" data-act="audio-play">▶ ${s === 'ended' ? 'Nochmal' : 'Weiter'}</button>`}
          <button class="btn btn-ghost btn-small" data-act="audio-restart">⏮ Von vorn</button>`;
      return `
        <div class="mystery">
          ${vinylSvg(s === 'playing' ? 'spin' : '')}
          <div class="mystery-body">
            <span class="mystery-no">Song ${v.songNo}</span>
            <div class="audio-bar" data-live="audio"><span></span></div>
            <div class="audio-ctrl">${ctrl}<span class="audio-time" data-live="audio-time"></span></div>
          </div>
        </div>`;
    }
    const djPhone = v.dj && st.input === 'phones';
    const who = v.djName || 'die Spielleitung';
    return `
      <div class="mystery">
        ${vinylSvg('spin')}
        <div class="mystery-body">
          <span class="mystery-no">Song ${v.songNo}</span>
          ${fallback ? '<p class="mystery-dj">Ausschnitt nicht erreichbar – bitte selbst abspielen.</p>' : ''}
          <p class="mystery-dj">🎧 <b>${esc(who)}</b> legt auf</p>
          ${
            djPhone
              ? `<p class="note">Titel und Interpret stehen auf ${esc(who)}s Handy.</p>`
              : `<button class="btn btn-ghost btn-small" data-act="dj">🙈 Song zeigen <small>nur für ${esc(who)}</small></button>`
          }
          ${fallback ? `<button class="btn btn-link" data-act="audio-retry">Ausschnitt nochmal versuchen</button>` : ''}
        </div>
      </div>`;
  }

  function yearPickerHtml(year, act) {
    return `
      <div class="year-picker">
        <button class="icon-btn" data-act="${act}" data-step="-10" aria-label="10 Jahre früher">«</button>
        <button class="icon-btn" data-act="${act}" data-step="-1" aria-label="1 Jahr früher">‹</button>
        <output class="year-out">${year}</output>
        <button class="icon-btn" data-act="${act}" data-step="1" aria-label="1 Jahr später">›</button>
        <button class="icon-btn" data-act="${act}" data-step="10" aria-label="10 Jahre später">»</button>
      </div>`;
  }

  function jokerButtonsHtml(v, team) {
    if (!team) return '';
    const exact = v.settings.variant === 'exact';
    return `
      <div class="joker-row">
        <span class="joker-have">${jokersHtml(team.jokers)}</span>
        <button class="btn btn-ghost btn-small" data-act="skip" ${team.jokers < SKIP_COST ? 'disabled' : ''}>⏭️ Überspringen <small>${SKIP_COST} 🪙</small></button>
        ${exact ? '' : `<button class="btn btn-ghost btn-small" data-act="buy" ${team.jokers < BUY_COST ? 'disabled' : ''}>🎁 Karte gratis <small>${BUY_COST} 🪙</small></button>`}
      </div>`;
  }

  function challengeTimerHtml(v) {
    if (v.challengeLeft === null || v.challengeLeft === undefined) return '';
    const left = Math.max(0, v.challengeLeft - (performance.now() - ui.viewAt));
    return `<div class="countdown" data-live="countdown" data-left="${Math.round(left)}"><span style="width:${(100 * left) / CHALLENGE_MS}%"></span></div>`;
  }

  function listenStageHtml(v) {
    const t = v.teams[v.turn];
    const one = v.settings.input === 'one';
    const exact = v.settings.variant === 'exact';
    const easy = v.settings.variant === 'easy';
    const listen = v.phase === 'listen';
    let body;
    if (listen) {
      const where = exact ? 'In welchem Jahr kam der Song raus?' : easy ? `Vor oder nach „${esc(v.line[0] ? v.line[0].title : '')}“?` : 'Wo gehört der Song hin?';
      const choose = exact
        ? one
          ? yearPickerHtml(ui.year, 'stage-year')
          : `<p class="waiting">${v.year ? `getippt: <b>${v.year}</b>` : '⌛ tippt das Jahr am Handy …'}</p>`
        : lineHtml(v.line, { act: 'choose', pick: v.pick });
      const label = exact ? (one ? String(ui.year) : v.year ? String(v.year) : '') : v.pick === null ? '' : T.gapLabel(v.line, v.pick);
      const ready = exact ? (one ? true : v.year !== null) : v.pick !== null;
      // Kann gleich jemand Einspruch erheben? Dann erst einloggen, sonst direkt auflösen
      const lock = !exact && v.settings.variant !== 'coop' && v.teams.some((x, i) => i !== v.turn && x.jokers >= CHALLENGE_COST);
      body = `
        <h2 class="turn">${turnTitle(v)} – ${where}</h2>
        ${choose}
        ${!one && v.guessed ? '<p class="note center">✍️ Titel und Interpret sind getippt</p>' : ''}
        <div class="go">
          <button class="btn btn-primary btn-big" data-act="place" ${ready ? '' : 'disabled'}>${lock ? '✔ Einloggen' : '🔍 Auflösen'}${label ? `<small>${esc(label)}</small>` : `<small>${one ? 'erst eine Lücke antippen' : 'wartet aufs Handy'}</small>`}</button>
        </div>
        ${jokerButtonsHtml(v, t)}`;
    } else {
      // Einspruch-Zeit
      const names = v.challengers.map((i) => v.teams[i]);
      const buttons = one
        ? names.length
          ? `<div class="challenge-buttons">${v.challengers
              .map((i) => `<button class="btn btn-ghost" style="${teamStyle(v.teams[i])}" data-act="challenge-open" data-team="${i}">✋ ${esc(v.teams[i].name)} <small>${jokersHtml(v.teams[i].jokers)}</small></button>`)
              .join('')}</div>`
          : ''
        : `<p class="note center">✋ Wer meint, es ist daneben, drückt am Handy auf <b>„Daneben!“</b> (${CHALLENGE_COST} 🪙).</p>`;
      body = `
        <h2 class="turn">✋ Einspruch? ${esc(t.name)} sagt: <b>${esc(exact ? String(v.year) : T.gapLabel(v.line, v.pick))}</b></h2>
        ${challengeTimerHtml(v)}
        ${lineHtml(v.line, { act: null, pick: v.pick })}
        ${buttons}
        <div class="go"><button class="btn btn-primary btn-big" data-act="reveal">🔍 Auflösen</button></div>`;
    }
    return `
      ${finalBanner(v)}
      <section class="stage">${audioHtml(v)}</section>
      ${body}
      ${othersHtml(v, v.turn)}`;
  }

  /** Ergebnis der Auflösung; withBonus: Joker-Bonus extra nennen (nicht, wo „Titel gewusst?“ ohnehin steht) */
  function resultHtml(v, withBonus) {
    const l = v.last;
    const o = l.outcome;
    const t = v.teams[l.team];
    const name = esc(t.name);
    const exact = v.settings.variant === 'exact';
    const line = v.teams[l.team].cards;
    const out = [];
    if (l.bought) out.push(`<p class="result is-right">🎁 ${name} kauft die Karte für ${BUY_COST} 🪙.</p>`);
    else if (exact) {
      const pts = l.points;
      out.push(`<p class="result ${pts ? 'is-right' : 'is-wrong'}">${pts === 3 ? '🎯 Genau!' : pts ? '👍 Knapp!' : '❌ Daneben!'} ${name} tippt ${l.year} – ${l.diff === 0 ? 'auf das Jahr genau' : `${l.diff} ${plural(l.diff, 'Jahr', 'Jahre')} daneben`}: <b>+${pts} ${plural(pts, 'Punkt', 'Punkte')}</b></p>`);
    } else if (o.keep) out.push(`<p class="result is-right">✅ Richtig! Die Karte bleibt bei <b>${name}</b>.</p>`);
    else if (l.correct && !o.valid) out.push(`<p class="result is-wrong">🔴 Richtig eingeordnet – aber ohne Titel + Interpret zählt die Karte nicht (Profi).</p>`);
    else {
      const right = T.gapLabel(v.settings.variant === 'easy' ? v.line : line, l.gaps[0]);
      out.push(`<p class="result is-wrong">❌ Daneben – der Song gehört <b>${esc(right)}</b>.${o.stolen ? '' : ' Die Karte ist weg.'}</p>`);
    }
    if (l.challenge) {
      const ct = v.teams[l.challenge.team];
      out.push(
        o.stolen
          ? `<p class="result is-right">✋ Einspruch von <b>${esc(ct.name)}</b> war richtig – die Karte wandert zu ${esc(ct.name)}!</p>`
          : `<p class="result is-wrong">✋ Einspruch von <b>${esc(ct.name)}</b> ging daneben – der Joker ist weg.</p>`
      );
    }
    if (v.settings.variant === 'coop' && o.mistake) out.push(`<p class="result is-wrong">🖤 Fehler ${v.mistakes + 1} von ${v.lives}</p>`);
    if (o.joker && withBonus) out.push(`<p class="bonus">🎤 Titel + Interpret gewusst: +1 🪙${t.jokers >= MAX_JOKERS ? ' (schon 5 – mehr gehen nicht)' : ''}</p>`);
    for (const d of o.sips) out.push(`<p class="drink">🍻 ${esc(v.teams[d.team].name)} trinkt ${d.sips} ${plural(d.sips, 'Schluck', 'Schlucke')}</p>`);
    return out.join('');
  }

  function namedHtml(v, canSet) {
    const l = v.last;
    if (l.bought) return '';
    const g = l.guess;
    const guessed = g ? `„${esc(g.title || '–')}“ von ${esc(g.artist || '–')}` : '';
    const auto = g && l.check ? `<span class="check">${l.check.title === 'yes' ? '✅' : l.check.title === 'close' ? '🤏' : '❌'} Titel · ${l.check.artist === 'yes' ? '✅' : l.check.artist === 'close' ? '🤏' : '❌'} Interpret</span>` : '';
    const pro = v.settings.variant === 'pro';
    const q = pro ? 'Titel + Interpret gewusst? (Pflicht)' : 'Titel + Interpret gewusst? +1 🪙';
    if (!canSet) return guessed ? `<p class="named">✍️ ${guessed} ${auto}</p>` : '';
    return `
      <div class="named">
        ${guessed ? `<p>✍️ ${guessed} ${auto}</p>` : ''}
        <span>🎤 ${q}</span>
        <div class="named-btns">
          <button class="choice ${l.named ? 'on' : ''}" data-act="named" data-ok="1" aria-pressed="${l.named}">✔ Ja</button>
          <button class="choice ${l.named ? '' : 'on'}" data-act="named" data-ok="0" aria-pressed="${!l.named}">✗ Nein</button>
        </div>
      </div>`;
  }

  function storeLinkHtml(song) {
    const hit = Player.hits[song.id];
    if (hit && hit.storeUrl) return `<a class="store" href="${esc(hit.storeUrl)}" target="_blank" rel="noopener">🍏 In Apple Music öffnen</a>`;
    const links = AudioSource.searchLinks(song)
      .map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${x.icon} ${esc(x.label)}</a>`)
      .join(' · ');
    return `<span class="listen-links">Anhören: ${links}</span>`;
  }

  function revealCardHtml(v) {
    const song = v.song;
    const l = v.last;
    const good = l.outcome.keep || l.outcome.stolen;
    return `
      <div class="big-card ${decadeClass(song.year)} ${good ? 'is-right' : 'is-wrong'}">
        <b class="big-year">${song.year}</b>
        <span class="big-title">${esc(song.title)}</span>
        <span class="big-artist">${esc(song.artist)}</span>
      </div>`;
  }

  /** Zeitstrahl des aktiven Teams nach der Auflösung (mit Geist bzw. neuer Karte) */
  function revealLineHtml(v) {
    const l = v.last;
    const t = v.teams[l.team];
    if (v.settings.variant === 'exact') return lineHtml(t.cards, { fresh: t.fresh });
    if (l.outcome.keep) return lineHtml(t.cards, { fresh: t.fresh });
    const ghostAt = T.correctGaps(t.cards, v.song.year)[0];
    const easy = v.settings.variant === 'easy';
    let miss = null;
    if (!easy && !l.bought) miss = l.gap;
    return lineHtml(t.cards, { ghost: { at: ghostAt, card: v.song }, miss: miss === ghostAt ? null : miss, challenge: !easy && l.challenge && !l.outcome.stolen && l.challenge.gap !== ghostAt && l.challenge.gap !== miss ? l.challenge.gap : null });
  }

  function revealStageHtml(v) {
    const l = v.last;
    const t = v.teams[l.team];
    const next = v.teams[(v.turn + 1) % v.teams.length];
    const stolenTo = l.outcome.stolen ? v.teams[l.challenge.team] : null;
    const prog = v.settings.variant === 'exact' ? `${t.points + (l.points || 0)}/${v.goal} Punkte` : `${t.cards.length}/${v.goal}`;
    const nextLabel = v.willEnd ? '🏆 Zur Siegerehrung' : `Weiter →<small>${v.settings.variant === 'coop' ? 'nächster Song' : `${esc(next.name)} ist dran`}</small>`;
    return `
      ${finalBanner(v)}
      <section class="stage">
        ${revealCardHtml(v)}
        ${storeLinkHtml(v.song)}
        ${resultHtml(v, false)}
        ${namedHtml(v, true)}
      </section>
      <h2 class="turn">Zeitstrahl von <b>${esc(t.name)}</b> · ${prog}</h2>
      ${revealLineHtml(v)}
      ${stolenTo ? `<h2 class="turn">Zeitstrahl von <b>${esc(stolenTo.name)}</b></h2>${lineHtml(stolenTo.cards, { fresh: stolenTo.fresh })}` : ''}
      <div class="go"><button class="btn btn-primary btn-big" data-act="next">${nextLabel}</button></div>
      ${othersHtml(v, l.team)}`;
  }

  function endHtml(v, stage) {
    const coop = v.settings.variant === 'coop';
    let title;
    let sub;
    if (coop) {
      title = v.reason === 'won' ? '🎉 Geschafft!' : v.reason === 'lost' ? '💔 Knapp vorbei!' : 'Spiel beendet';
      sub = `${v.teams[0].cards.length} Karten · ${v.mistakes} ${plural(v.mistakes, 'Fehler', 'Fehler')}`;
    } else {
      const wins = v.ranking.filter((r) => r.place === 1);
      title = `${andList(wins.map((w) => esc(w.name)))} ${plural(wins.length, 'gewinnt', 'gewinnen')}!`;
      sub = v.reason === 'empty' ? 'Die Songs sind ausgegangen.' : v.reason === 'stopped' ? 'Spiel vorzeitig beendet.' : `${v.round} ${plural(v.round, 'Runde', 'Runden')} · ${v.turns} Songs`;
    }
    const exact = v.settings.variant === 'exact';
    const rows = coop
      ? ''
      : `<ol class="ranking">${v.ranking
          .map(
            (r) => `
          <li class="${r.place === 1 ? 'is-win' : ''}" style="--team:${esc(r.color)}">
            <span class="place">${r.place === 1 ? '🏆' : r.place + '.'}</span>
            <span class="rank-name"><i class="dot"></i>${esc(r.name)}</span>
            <span class="rank-info">${exact ? `${r.points} Punkte` : `${r.cards} ${plural(r.cards, 'Karte', 'Karten')}`} · ${r.right}/${r.placed} richtig · ${jokersHtml(r.jokers)}</span>
          </li>`
          )
          .join('')}</ol>`;
    const awards = (v.awards || []).map((a) => `<li>${a.icon} <b>${esc(a.label)}</b>: ${andList(a.teams.map((i) => esc(v.teams[i].name)))} – ${esc(a.text)}</li>`).join('');
    const lines = v.teams.map((t) => `<div class="end-line" style="${teamStyle(t)}"><h3><i class="dot"></i>${esc(t.name)}</h3>${lineHtml(t.cards, { small: true })}</div>`).join('');
    const played = (v.log || []).filter((x) => !x.skipped);
    const playlist = played
      .map((x) => {
        const hit = Player.hits[x.song.id];
        const url = hit && hit.storeUrl ? hit.storeUrl : AudioSource.searchLinks(x.song)[0].url;
        const res = x.stolen !== null && x.stolen !== undefined ? `✋ ${esc(v.teams[x.stolen].name)}` : `${x.keep ? '✅' : '❌'} ${esc(v.teams[x.team].name)}`;
        return `
          <li>
            <span class="pl-year ${decadeClass(x.song.year)}">${x.song.year}</span>
            <a href="${esc(url)}" target="_blank" rel="noopener"><b>${esc(x.song.title)}</b> – ${esc(x.song.artist)}</a>
            <span class="pl-who">${x.named ? '🎤 ' : ''}${res}</span>
          </li>`;
      })
      .join('');
    const actions = stage
      ? `<button class="btn btn-primary btn-big btn-wide" data-act="again">🔁 Revanche</button>
         ${v.settings.input === 'phones' ? '<button class="btn btn-ghost btn-wide" data-act="lobby">👥 Zurück in die Lobby</button>' : ''}
         <button class="btn btn-ghost btn-wide" data-act="new-setup">⚙️ Neues Spiel</button>`
      : '<p class="note">Der Laptop entscheidet, wie es weitergeht.</p>';
    return `
    <div class="end">
      <div class="trophy" aria-hidden="true">${coop && v.reason === 'lost' ? '💔' : '🏆'}</div>
      <h1>${title}</h1>
      <p class="end-sub">${sub}</p>
      ${rows}
      ${awards ? `<ul class="awards">${awards}</ul>` : ''}
      <div class="end-actions">${actions}</div>
      <section class="panel"><h2>Die Zeitstrahle</h2>${lines}</section>
      ${played.length ? `<section class="panel"><h2>🎶 Playlist des Abends</h2><ol class="playlist">${playlist}</ol></section>` : ''}
    </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Handy                                                               */
  /* ------------------------------------------------------------------ */

  function phoneBar(v) {
    const t = v.me.team !== null ? v.teams[v.me.team] : null;
    const mine = t ? `<span class="me-team" style="${teamStyle(t)}"><i class="dot"></i>${esc(v.me.name)}${v.settings.teams ? ` · ${esc(t.name)}` : ''}</span>` : `<span class="me-team">${esc(v.me.name)}</span>`;
    const jok = t && v.settings.variant !== 'coop' ? jokersHtml(t.jokers) : '';
    return `
      <header class="bar phone-bar">
        <span class="bar-left">${mine}${v.me.lead ? '<span class="lead" title="Spielleitung">🎬</span>' : ''}</span>
        <span class="bar-right">${jok}<button class="icon-btn" data-act="menu" title="Menü" aria-label="Menü">☰</button></span>
      </header>
      ${ui.status === 'reconnecting' ? '<p class="banner">Verbindung unterbrochen – verbinde neu…</p>' : ''}`;
  }

  function playerHtml(v) {
    let main;
    if (v.phase === 'lobby') main = phoneLobbyHtml(v);
    else if (v.phase === 'end') main = endHtml(v, false);
    else if (v.me.team === null) main = phoneWatchHtml(v);
    else if (v.phase === 'listen') main = phoneListenHtml(v);
    else if (v.phase === 'challenge') main = phoneChallengeHtml(v);
    else main = phoneRevealHtml(v);
    return `<div class="screen phone phone-${v.phase}">${phoneBar(v)}${main}</div>`;
  }

  function phoneLobbyHtml(v) {
    const teams = v.settings.teams;
    const st = v.settings;
    return `
      <div class="phone-center">
        ${vinylSvg('spin')}
        <h1>Du bist dabei!</h1>
        ${v.me.watch ? '<p class="note">Das Spiel ist voll oder läuft schon – du schaust zu.</p>' : ''}
        ${
          teams && !v.me.watch
            ? `<h2>Dein Team</h2><div class="choices choices-2">${Array.from({ length: teams }, (_, i) => `<button class="choice team-choice ${v.me.lobbyTeam === i ? 'on' : ''}" style="--team:${E.TEAMS[i].color}" data-act="team" data-team="${i}" aria-pressed="${v.me.lobbyTeam === i}"><i class="dot"></i>${esc(E.TEAMS[i].name)}<small>${v.members.filter((m) => m.team === i && !m.watch).map((m) => esc(m.name)).join(', ') || '–'}</small></button>`).join('')}</div>`
            : ''
        }
        <p class="summary">${[VARIANT[st.variant].icon + ' ' + VARIANT[st.variant].label, goalLabel(v), AUDIO[st.audio].label].map((x) => `<span>${esc(x)}</span>`).join('')}</p>
        <p class="waiting">⌛ Der Laptop startet das Spiel, sobald alle da sind.</p>
        <button class="btn btn-link" data-act="rules">📖 Spielregeln</button>
      </div>`;
  }

  function phoneWatchHtml(v) {
    const t = v.teams[v.turn];
    return `
      <div class="phone-center">
        <p class="note">Du schaust zu.</p>
        <h2 class="turn">${turnTitle(v)}</h2>
        ${t ? lineHtml(t.cards, { small: true }) : ''}
      </div>`;
  }

  /** DJ-Karte am Handy: Titel + Interpret, Such-Links */
  function djCardHtml(v) {
    const song = v.djSong;
    const links = AudioSource.searchLinks(song)
      .map((x) => `<a class="btn btn-ghost btn-small" href="${esc(x.url)}" target="_blank" rel="noopener">${x.icon} ${esc(x.label)}</a>`)
      .join('');
    return `
      <section class="dj-card">
        <h2>🎧 Du legst auf!</h2>
        <p class="dj-warn">Nicht verraten – Handy nicht zeigen 🙈</p>
        <div class="dj-song"><b>${esc(song.title)}</b><span>${esc(song.artist)}</span></div>
        <div class="dj-links">${links}</div>
        <p class="note">Die bekannte Version laut abspielen. Nicht zu finden? Dann:</p>
        <button class="btn btn-link" data-act="replace">🔄 Anderer Song</button>
      </section>`;
  }

  function phoneListenHtml(v) {
    const t = v.teams[v.turn];
    const exact = v.settings.variant === 'exact';
    const easy = v.settings.variant === 'easy';
    if (v.djSong) return djCardHtml(v) + `<h2 class="turn">${turnTitle(v)}</h2>${lineHtml(v.line, { act: null, pick: v.pick, small: false })}`;
    if (!v.me.myTurn) {
      return `
        <div class="phone-center">
          <h2 class="turn">${turnTitle(v)}</h2>
          <p class="note">${exact ? 'Welches Jahr?' : 'Wo gehört der Song hin?'} Hör genau hin – vielleicht legst du gleich Einspruch ein.</p>
        </div>
        ${exact ? (v.year ? `<p class="waiting">getippt: <b>${v.year}</b></p>` : '') : lineHtml(v.line, { act: null, pick: v.pick })}
        ${v.dj ? `<p class="note center">🎧 ${esc(v.djName)} legt auf</p>` : ''}`;
    }
    const pro = v.settings.variant === 'pro';
    const label = exact ? String(ui.year) : v.pick === null ? '' : T.gapLabel(v.line, v.pick);
    const ready = exact || v.pick !== null;
    const where = exact ? 'In welchem Jahr kam der Song raus?' : easy ? `Vor oder nach „${esc(v.line[0] ? v.line[0].title : '')}“?` : 'Wo gehört der Song hin?';
    return `
      <h2 class="turn">🎵 Du bist dran!</h2>
      <p class="note center">${where}</p>
      ${exact ? yearPickerHtml(ui.year, 'phone-year') : lineHtml(v.line, { act: 'choose', pick: v.pick })}
      <form class="panel guess" data-form="place">
        <p class="guess-head">🎤 Titel + Interpret ${pro ? '<b>(Pflicht!)</b>' : '<small>richtig → +1 🪙</small>'}</p>
        <input class="input" type="text" maxlength="80" placeholder="Titel" value="${esc(ui.guess.title)}" data-field="guess-title" autocomplete="off" autocapitalize="sentences" spellcheck="false" enterkeyhint="next" />
        <input class="input" type="text" maxlength="80" placeholder="Interpret" value="${esc(ui.guess.artist)}" data-field="guess-artist" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="done" />
        <button class="btn btn-primary btn-big btn-wide" type="submit" ${ready ? '' : 'disabled'}>✔ Einloggen${label ? `<small>${esc(label)}</small>` : '<small>erst eine Lücke antippen</small>'}</button>
      </form>
      ${jokerButtonsHtml(v, t)}`;
  }

  function phoneChallengeHtml(v) {
    const t = v.teams[v.turn];
    const mine = v.teams[v.me.team];
    const exact = v.settings.variant === 'exact';
    const head = `<h2 class="turn">${esc(t.name)} sagt: <b>${esc(exact ? String(v.year) : T.gapLabel(v.line, v.pick))}</b></h2>${challengeTimerHtml(v)}`;
    if (v.me.myTurn) return `${head}${lineHtml(v.line, { act: null, pick: v.pick })}<p class="waiting">⌛ Einspruch-Zeit – hoffentlich traut sich niemand …</p>`;
    if (!mine.mayChallenge) {
      const why = mine.jokers < CHALLENGE_COST ? 'Du hast keinen Joker für einen Einspruch.' : v.me.dj ? 'Als DJ kennst du die Lösung – kein Einspruch.' : '';
      return `${head}${lineHtml(v.line, { act: null, pick: v.pick })}${why ? `<p class="note center">${why}</p>` : ''}`;
    }
    return `
      ${head}
      <p class="note center">✋ <b>Daneben?</b> Tipp die Lücke, in die der Song wirklich gehört – kostet ${CHALLENGE_COST} 🪙.
        Liegt ${esc(t.name)} falsch und du richtig, bekommst du die Karte.</p>
      ${lineHtml(v.line, { act: 'challenge-gap', skip: v.pick, pick: ui.challengeGap })}
      <div class="go"><button class="btn btn-danger btn-big btn-wide" data-act="challenge-send" ${ui.challengeGap === null ? 'disabled' : ''}>✋ Daneben! <small>${ui.challengeGap === null ? 'erst eine Lücke wählen' : esc(T.gapLabel(v.line, ui.challengeGap))}</small></button></div>`;
  }

  function phoneRevealHtml(v) {
    const l = v.last;
    const mine = v.me.team;
    const lead = v.me.lead;
    return `
      <section class="stage">
        ${revealCardHtml(v)}
        ${resultHtml(v, !lead)}
        ${namedHtml(v, lead)}
      </section>
      ${l.team === mine || (l.outcome.stolen && l.challenge.team === mine) ? `<h2 class="turn">Dein Zeitstrahl</h2>${lineHtml(v.teams[mine].cards, { fresh: v.teams[mine].fresh })}` : ''}
      ${lead ? `<div class="go"><button class="btn btn-primary btn-big btn-wide" data-act="next">${v.willEnd ? '🏆 Zur Siegerehrung' : 'Weiter →'}</button></div>` : '<p class="waiting">⌛ Gleich geht’s weiter …</p>'}`;
  }

  /* ------------------------------------------------------------------ */
  /* Fenster                                                             */
  /* ------------------------------------------------------------------ */

  function rulesHtml() {
    return `
      <h2>📖 So geht’s</h2>
      <ol class="rules">
        <li>Jede Person (oder jedes Team) bekommt eine <b>Startkarte</b> mit Song und Jahr – der Anfang des <b>Zeitstrahls</b>.</li>
        <li>Ein <b>Song läuft</b>: als 30-s-Ausschnitt am Laptop oder der <b>DJ</b> spielt ihn selbst ab. Niemand sieht Titel oder Jahr.</li>
        <li>Wer dran ist, tippt die <b>Lücke</b>, in die der Song gehört – <i>vor 1982</i>, <i>1982 – 1999</i>, <i>nach 1999</i> …
            <b>Gleiches Jahr</b> wie eine Nachbarkarte zählt auf beiden Seiten als richtig.</li>
        <li><b>🎤 Bonus:</b> Titel <i>und</i> Interpret gewusst → <b>+1 Joker</b> 🪙 (höchstens ${MAX_JOKERS}). Am Handy tippen, an einem Gerät laut sagen.</li>
        <li><b>✋ Einspruch „Daneben!“:</b> Die anderen dürfen für 1 🪙 eine andere Lücke im Zeitstrahl der aktiven Person wählen.
            Lag die aktive Person falsch und der Einspruch richtig, bekommt die Einspruch-Person die Karte. Wer zuerst drückt, zählt.</li>
        <li><b>🔍 Auflösung:</b> Richtig → die Karte bleibt. Falsch → sie ist weg.</li>
        <li>Joker auch für <b>⏭️ Überspringen</b> (1 🪙, neuer Song) oder <b>🎁 Karte gratis</b> (3 🪙, wird richtig eingeordnet).</li>
        <li>Wer zuerst das <b>Ziel</b> erreicht (Startkarte zählt mit), löst das Ende aus – die Runde wird noch zu Ende gespielt.
            Die meisten Karten gewinnen, bei Gleichstand die meisten Joker.</li>
      </ol>
      <h3>Varianten</h3>
      <ul class="rules-tips">
        ${Object.values(VARIANT)
          .map((x) => `<li>${x.icon} <b>${x.label}</b> – ${x.text}</li>`)
          .join('')}
      </ul>
      <h3>Tipps</h3>
      <ul class="rules-tips">
        <li>🎧 DJ: die <b>bekannte Version</b> abspielen (Interpret beachten), keine Live-, Remix- oder Cover-Fassung. Nicht zu finden? <i>„🔄 Anderer Song“</i> – kostet nichts.</li>
        <li>📅 Das Jahr ist die <b>erste Veröffentlichung</b> der bekannten Version (Single oder Album, was früher war).</li>
        <li>🍏 Die Ausschnitte stammen aus Apple Music – zu jedem Song gibt es den Link „In Apple Music öffnen“.</li>
      </ul>`;
  }

  function djModalHtml(v) {
    const song = v.song;
    const links = AudioSource.searchLinks(song);
    const link = links.find((x) => x.id === ui.service) || links[0];
    const who = esc(v.djName || 'die Spielleitung');
    return `
      <h2>🎧 Nur für ${who}</h2>
      <p class="dj-warn">Alle anderen: wegschauen! 🙈</p>
      <div class="dj-song"><b>${esc(song.title)}</b><span>${esc(song.artist)}</span></div>
      <div class="choices choices-3 dj-services">${links
        .map((x) => `<button class="choice ${x.id === link.id ? 'on' : ''}" data-act="service" data-value="${x.id}" aria-pressed="${x.id === link.id}">${x.icon} ${esc(x.label)}</button>`)
        .join('')}</div>
      <div class="dj-qr">${qrSvg(link.url)}</div>
      <p class="note">QR-Code mit dem eigenen Handy scannen, den Song suchen und <b>laut abspielen</b>. Die bekannte Version nehmen – und das Jahr nicht verraten!</p>
      <a class="btn btn-link" href="${esc(link.url)}" target="_blank" rel="noopener">Auf diesem Gerät in ${esc(link.label)} öffnen ↗</a>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-act="replace">🔄 Anderer Song</button>
        <button class="btn btn-primary" data-act="close-modal">✔ Läuft – verstecken</button>
      </div>`;
  }

  function challengeModalHtml(v) {
    const t = v.teams[ui.challengeTeam];
    if (!t || !v.challengers.includes(ui.challengeTeam)) return '';
    return `
      <h2>✋ ${esc(t.name)}: Daneben!</h2>
      <p class="note">Wohin gehört der Song wirklich? Kostet ${CHALLENGE_COST} 🪙. Liegt ${esc(v.teams[v.turn].name)} falsch und ihr richtig, bekommt ihr die Karte.</p>
      ${lineHtml(v.line, { act: 'challenge-stage', skip: v.pick })}`;
  }

  function menuHtml() {
    const v = ui.view;
    const stage = ui.screen === 'stage';
    const playing = v && v.phase !== 'lobby' && v.phase !== 'end';
    return `
      <h2>Menü</h2>
      <div class="menu">
        <button class="btn btn-ghost btn-wide" data-act="mute">${Sound.muted ? '🔊 Ton einschalten' : '🔇 Ton ausschalten'}</button>
        <button class="btn btn-ghost btn-wide" data-act="rules">📖 Spielregeln</button>
        ${stage && v && v.room && v.room.code ? '<button class="btn btn-ghost btn-wide" data-act="show-qr">📱 Handys einladen</button>' : ''}
        ${stage && playing ? '<button class="btn btn-ghost btn-wide" data-act="end-game">🏁 Spiel jetzt auswerten</button>' : ''}
        ${stage ? '<button class="btn btn-ghost btn-wide" data-act="pause">⏸ Pausieren (später weiter)</button>' : ''}
        <button class="btn btn-danger btn-wide" data-act="quit">${stage ? 'Spiel beenden' : 'Spiel verlassen'}</button>
      </div>`;
  }

  function modalHtml() {
    if (!ui.modal) return '';
    const v = ui.view;
    let body = '';
    if (ui.modal === 'rules') body = rulesHtml();
    else if (ui.modal === 'menu') body = menuHtml();
    else if (ui.modal === 'dj' && v && v.song && v.phase === 'listen' && v.me.stage) body = djModalHtml(v);
    else if (ui.modal === 'challenge' && v && v.phase === 'challenge') body = challengeModalHtml(v);
    else if (ui.modal === 'qr' && v && v.room) body = `<h2>📱 Handys einladen</h2>${roomBoxHtml(v.room, true)}<p class="note">Wer jetzt beitritt, schaut bis zum nächsten Spiel zu.</p>`;
    else if (ui.modal === 'settings' && v && v.phase === 'lobby') body = `<h2>⚙️ Einstellungen</h2>${settingsHtml(v.settings, 'lobby')}`;
    else if (ui.modal === 'quit')
      body = `
        <h2>${ui.screen === 'stage' ? 'Spiel beenden?' : 'Spiel verlassen?'}</h2>
        <p>${ui.screen === 'stage' ? 'Der Spielstand wird gelöscht, die Handys werden getrennt.' : 'Du kannst über den QR-Code wieder beitreten.'}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-act="close-modal">Weiterspielen</button>
          <button class="btn btn-danger" data-act="quit-yes">${ui.screen === 'stage' ? 'Beenden' : 'Verlassen'}</button>
        </div>`;
    if (!body) return '';
    return `
      <div class="modal-bg" data-act="close-modal-bg">
        <div class="modal modal-${ui.modal}" role="dialog" aria-modal="true">
          <button class="icon-btn modal-close" data-act="close-modal" aria-label="Schließen">✕</button>
          ${body}
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Rendern                                                             */
  /* ------------------------------------------------------------------ */

  let renderQueued = false;
  function render() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderNow();
    });
  }

  function renderNow() {
    let html;
    switch (ui.screen) {
      case 'setup':
        html = setupHtml();
        break;
      case 'join':
        html = joinHtml();
        break;
      case 'connecting':
        html = connectingHtml();
        break;
      case 'stage':
        html = ui.view ? stageHtml(ui.view) : connectingHtml();
        break;
      case 'player':
        html = ui.view ? playerHtml(ui.view) : connectingHtml();
        break;
      default:
        html = homeHtml();
    }
    html += modalHtml();
    if (ui.toast) html += `<div class="toast" role="status">${esc(ui.toast)}</div>`;
    window.morphdom(app, `<div id="app">${html}</div>`, {
      onBeforeElUpdated(fromEl, toEl) {
        if (fromEl === document.activeElement && fromEl.tagName === 'INPUT') {
          fromEl.disabled = toEl.disabled;
          return false;
        }
        // Fortschritt des Ausschnitts setzt Player.progress() direkt
        if (fromEl.dataset && (fromEl.dataset.live === 'audio' || fromEl.dataset.live === 'audio-time') && toEl.dataset && toEl.dataset.live) return false;
        return true;
      },
    });
    Player.progress();
    if (ui.focus) {
      const el = app.querySelector(ui.focus);
      ui.focus = null;
      if (el) el.focus();
    }
  }

  /** Countdown der Einspruch-Zeit flüssig nachführen */
  function countdownLoop() {
    const el = app.querySelector('[data-live="countdown"]');
    if (el && ui.view && ui.view.challengeLeft !== null) {
      const left = Math.max(0, ui.view.challengeLeft - (performance.now() - ui.viewAt));
      const bar = el.querySelector('span');
      if (bar) bar.style.width = `${((100 * left) / CHALLENGE_MS).toFixed(1)}%`;
    }
    requestAnimationFrame(countdownLoop);
  }

  /* ------------------------------------------------------------------ */
  /* Aktionen                                                            */
  /* ------------------------------------------------------------------ */

  /** Mehrfachauswahl umschalten; die letzte Auswahl lässt sich nicht abwählen */
  function pickToggle(st, key, value) {
    const all = key === 'decades' ? Songs.DECADES.slice() : Songs.CATEGORY_IDS.slice();
    const v = key === 'decades' ? Number(value) : value;
    const cur = st[key].length ? st[key].slice() : all;
    const out = cur.includes(v) ? cur.filter((x) => x !== v) : cur.concat(v);
    if (!out.length) return null;
    return Object.assign({}, st, { [key]: out });
  }

  function changeSettings(scope, next) {
    if (!next) return;
    if (scope === 'lobby') {
      dispatch('settings', { settings: next });
      return;
    }
    ui.setup.settings = sanitizeSettings(next);
    saveSetup();
    render();
  }

  function scopeSettings(scope) {
    return scope === 'lobby' && ui.view ? ui.view.settings : ui.setup.settings;
  }

  function createGame() {
    const st = ui.setup.settings;
    ui.error = null;
    let state;
    try {
      state = Engine.create({ settings: st, players: st.input === 'one' ? ui.setup.names : [] });
    } catch (err) {
      toast(err.message);
      return;
    }
    Sound.unlock();
    // Erster Klick: Ton freischalten, damit der Ausschnitt gleich spielen darf
    if (st.audio === 'itunes') {
      const el = Player.audio();
      el.play().catch(() => {});
      el.pause();
    }
    startStage({ state });
  }

  function placeFromPhone() {
    const v = ui.view;
    if (!v || v.phase !== 'listen' || !v.me.myTurn) return;
    const extra = { title: ui.guess.title, artist: ui.guess.artist };
    if (v.settings.variant === 'exact') extra.year = ui.year;
    else if (v.pick === null) return;
    else extra.gap = v.pick;
    dispatch('place', extra);
  }

  const actions = {
    home: () => goHome(true),
    setup: () => {
      ui.screen = 'setup';
      ui.error = null;
      window.scrollTo(0, 0);
      render();
    },
    'new-setup': () => {
      stopController(false);
      ui.screen = 'setup';
      window.scrollTo(0, 0);
      render();
    },
    'join-screen': () => {
      ui.screen = 'join';
      ui.error = null;
      ui.focus = ui.name ? '#code-input' : '#name-input';
      render();
    },
    'leave-now': () => goHome(false),
    rules: () => {
      ui.modal = 'rules';
      render();
    },
    menu: () => {
      ui.modal = 'menu';
      render();
    },
    mute: () => {
      Sound.setMuted(!Sound.muted);
      if (Player.el) Player.el.muted = Sound.muted;
      render();
    },
    'resume-stage': () => {
      const g = savedGames().stage;
      if (g) startStage({ state: g.state, code: g.code, key: g.key });
    },
    'discard-stage': () => {
      Store.remove(KEYS.stage);
      render();
    },
    'resume-client': () => {
      const c = savedGames().client;
      if (c) startClient({ code: c.code, name: c.name, pid: c.pid });
    },
    'discard-client': () => {
      Store.remove(KEYS.client);
      render();
    },
    set: (el) => {
      const scope = el.dataset.scope;
      changeSettings(scope, Object.assign({}, scopeSettings(scope), { [el.dataset.key]: el.dataset.value }));
    },
    pick: (el) => {
      const scope = el.dataset.scope;
      changeSettings(scope, pickToggle(scopeSettings(scope), el.dataset.key, el.dataset.value));
    },
    flip: (el) => {
      const scope = el.dataset.scope;
      const st = scopeSettings(scope);
      changeSettings(scope, Object.assign({}, st, { [el.dataset.key]: !st[el.dataset.key] }));
    },
    'add-name': () => {
      if (ui.setup.names.length >= MAX_PLAYERS) return;
      ui.setup.names.push('');
      ui.focus = `#name-${ui.setup.names.length - 1}`;
      saveSetup();
      render();
    },
    'remove-name': (el) => {
      if (ui.setup.names.length <= MIN_PLAYERS) return;
      ui.setup.names.splice(+el.dataset.i, 1);
      saveSetup();
      render();
    },
    create: createGame,
    'open-settings': () => {
      ui.modal = 'settings';
      render();
    },
    'show-qr': () => {
      ui.modal = 'qr';
      render();
    },
    start: () => {
      Sound.unlock();
      if (ui.view && ui.view.settings.audio === 'itunes') {
        const el = Player.audio();
        el.play().catch(() => {});
        el.pause();
      }
      dispatch('start');
    },
    kick: (el) => dispatch('kick', { player: el.dataset.player }),
    'move-team': (el) => {
      const m = ui.view.members.find((x) => x.id === el.dataset.player);
      if (m) dispatch('team', { player: m.id, team: ((m.team === null ? -1 : m.team) + 1) % ui.view.settings.teams });
    },
    team: (el) => dispatch('team', { team: +el.dataset.team }),
    choose: (el) => dispatch('choose', { gap: +el.dataset.gap }),
    'stage-year': (el) => {
      ui.year = Math.max(Songs.MIN_YEAR, Math.min(Songs.MAX_YEAR, ui.year + +el.dataset.step));
      render();
    },
    'phone-year': (el) => {
      ui.year = Math.max(Songs.MIN_YEAR, Math.min(Songs.MAX_YEAR, ui.year + +el.dataset.step));
      dispatch('year', { year: ui.year });
      render();
    },
    place: () => {
      const v = ui.view;
      if (ui.screen === 'player') return placeFromPhone();
      if (v.settings.variant === 'exact' && v.settings.input === 'one') dispatch('place', { year: ui.year });
      else dispatch('place');
    },
    skip: () => dispatch('skip'),
    buy: () => dispatch('buy'),
    replace: () => {
      const v = ui.view;
      dispatch('replace', { id: v && (v.song || v.djSong) ? (v.song || v.djSong).id : undefined });
      toast('Neuer Song');
    },
    reveal: () => dispatch('reveal'),
    'challenge-open': (el) => {
      ui.challengeTeam = +el.dataset.team;
      ui.modal = 'challenge';
      render();
    },
    'challenge-stage': (el) => {
      dispatch('challenge', { team: ui.challengeTeam, gap: +el.dataset.gap });
      ui.modal = null;
      render();
    },
    'challenge-gap': (el) => {
      ui.challengeGap = +el.dataset.gap;
      render();
    },
    'challenge-send': () => {
      if (ui.challengeGap === null) return;
      dispatch('challenge', { gap: ui.challengeGap });
      vibrate(30);
    },
    named: (el) => dispatch('named', { ok: el.dataset.ok === '1' }),
    next: () => dispatch('next'),
    again: () => dispatch('again'),
    lobby: () => dispatch('lobby'),
    'end-game': () => dispatch('end'),
    dj: () => {
      ui.modal = 'dj';
      render();
    },
    service: (el) => {
      ui.service = el.dataset.value;
      render();
    },
    'audio-play': () => Player.play(),
    'audio-pause': () => Player.pause(),
    'audio-restart': () => Player.restart(),
    'audio-retry': () => {
      if (ui.view && ui.view.song) Player.load(ui.view.song, true);
    },
    pause: () => goHome(true),
    quit: () => {
      ui.modal = 'quit';
      render();
    },
    'quit-yes': () => goHome(false),
    'close-modal': () => {
      ui.modal = null;
      render();
    },
    'close-modal-bg': (el, e) => {
      if (e.target === el) actions['close-modal']();
    },
  };

  /* ------------------------------------------------------------------ */
  /* Ereignisse                                                          */
  /* ------------------------------------------------------------------ */

  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled || !app.contains(el)) return;
    const act = el.dataset.act;
    const fn = actions[act];
    if (!fn) return;
    Sound.unlock();
    if (!['close-modal-bg', 'mute'].includes(act)) Sound.click();
    if (['menu'].includes(ui.modal) && el.closest('.modal') && !['close-modal', 'mute'].includes(act)) ui.modal = null;
    fn(el, e);
  });

  app.addEventListener('input', (e) => {
    const el = e.target;
    const f = el.dataset && el.dataset.field;
    if (f === 'name') {
      ui.setup.names[+el.dataset.i] = el.value;
      saveSetup();
      render();
    } else if (f === 'join-name') ui.name = el.value;
    else if (f === 'join-code') ui.joinCode = el.value;
    else if (f === 'guess-title' || f === 'guess-artist') {
      ui.guess[f === 'guess-title' ? 'title' : 'artist'] = el.value;
      clearTimeout(ui.guessTimer);
      ui.guessTimer = setTimeout(() => dispatch('guess', { title: ui.guess.title, artist: ui.guess.artist }), 500);
    }
  });

  app.addEventListener('submit', (e) => {
    const form = e.target;
    e.preventDefault();
    if (form.dataset.form === 'join') {
      const name = cleanName(ui.name);
      const code = Net.cleanCode(ui.joinCode);
      if (!name) {
        ui.error = 'Bitte gib zuerst deinen Namen ein.';
        ui.focus = '#name-input';
        render();
        return;
      }
      if (code.length < 4) {
        ui.error = 'Bitte gib den Raum-Code ein.';
        ui.focus = '#code-input';
        render();
        return;
      }
      ui.name = name;
      savePrefs();
      Sound.unlock();
      startClient({ code, name });
    } else if (form.dataset.form === 'place') {
      if (document.activeElement && document.activeElement.dataset.field === 'guess-title') {
        const next = form.querySelector('[data-field="guess-artist"]');
        if (next && !ui.guess.artist) {
          next.focus();
          return;
        }
      }
      placeFromPhone();
    }
  });

  app.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key === 'Enter' && el.dataset && el.dataset.field === 'name') {
      e.preventDefault();
      const i = +el.dataset.i;
      if (i + 1 < ui.setup.names.length) app.querySelector(`#name-${i + 1}`).focus();
      else if (el.value.trim()) actions['add-name']();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.modal) {
      actions['close-modal']();
      return;
    }
    // Laptop, ein Gerät: ← → Lücke wählen, Enter = einloggen / auflösen / weiter
    const v = ui.view;
    if (e.target !== document.body || ui.modal || !v || ui.screen !== 'stage') return;
    if (v.phase === 'listen' && v.settings.input === 'one' && v.settings.variant !== 'exact' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const max = v.line.length;
      const cur = v.pick === null ? (e.key === 'ArrowLeft' ? max + 1 : -1) : v.pick;
      dispatch('choose', { gap: Math.max(0, Math.min(max, cur + (e.key === 'ArrowLeft' ? -1 : 1))) });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (v.phase === 'listen' && v.settings.input === 'one') actions.place();
      else if (v.phase === 'challenge') dispatch('reveal');
      else if (v.phase === 'reveal') dispatch('next');
    } else if (e.key === ' ' && v.settings.audio === 'itunes') {
      e.preventDefault();
      if (Player.state === 'playing') Player.pause();
      else Player.play();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (ui.ctrl && ui.ctrl.mode === 'client') ui.ctrl.bye();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ui.view && ui.view.phase !== 'lobby' && ui.view.phase !== 'end') keepAwake(true);
  });

  /* ------------------------------------------------------------------ */
  /* Start                                                               */
  /* ------------------------------------------------------------------ */

  // Spielstand aus Etappe 2 (ein Gerät, altes Format) aufräumen
  Store.remove('hitstory.game.v1');

  function autoResume() {
    const active = session(ACTIVE_KEY);
    const saves = savedGames();
    if (active === 'stage' && saves.stage) startStage({ state: saves.stage.state, code: saves.stage.code, key: saves.stage.key });
    else if (active === 'client' && saves.client && (!ui.joinCode || ui.joinCode === saves.client.code)) {
      startClient({ code: saves.client.code, name: saves.client.name, pid: saves.client.pid });
    } else {
      if (ui.screen === 'join') ui.focus = ui.name ? '#code-input' : '#name-input';
      render();
    }
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.HS_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  requestAnimationFrame(countdownLoop);
  autoResume();

  // für Tests
  window.HSApp = { ui, render: renderNow, actions, Player };
})();
