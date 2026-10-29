/*
 * Oberfläche von „Finish the lyrics“.
 *  - Laptop („Bühne“ und Lautsprecher): Spiel anlegen, Lobby mit QR-Code, Ausschnitt bis zur Stoppstelle abspielen,
 *    Weitersingen-Zeit, Auflösung (Ausschnitt läuft weiter) mit Abstimmung, Ansingen, Siegerehrung mit Playlist.
 *    „📍 Hier wäre eine gute Stelle“ sammelt Stoppstellen im Browser (Menü → Liste zum Kopieren).
 *    Ein Gerät: Die Runde entscheidet am Laptop; beim Ansingen schaut die Ansänger/in kurz allein auf den Laptop.
 *  - Handy: 👍/🤏/👎 abstimmen, Fortsetzung tippen (alle gleichzeitig), ✋ beim Ansingen, Spielleitung steuert mit.
 * Gerendert wird per HTML-String + morphdom. Countdown und Ausschnitt-Leiste bewegen sich direkt im DOM (data-live).
 */
(function () {
  'use strict';

  const E = window.FTLEngine;
  const { Engine, COUNTS, TIMES, TEAM_COUNTS, MIN_PLAYERS, MAX_PLAYERS, MAX_NAME, MAX_ANSWER, MIN_POOL, POINTS, SING_HIT, SING_SINGER, SING_MS, TYPE_EXTRA_MS, SIPS_WRONG, SIPS_GIVE, STREAK, sanitizeSettings, cleanName } = E;
  const { StageController, ClientController, Store, KEYS, Net, inviteLink, qrSvg } = window.FTLControllers;
  const Songs = window.Songs;
  const Stops = window.FTLStops;
  const AudioSource = window.AudioSource;
  const { Sound, confetti } = window.GameFx;

  const INPUT = {
    phones: { icon: '📱', label: 'Mit Handys', text: 'Abgestimmt wird am Handy. Der Laptop ist Bühne und Lautsprecher.' },
    one: { icon: '🖥️', label: 'Ein Gerät', text: 'Alle sitzen um den Laptop – die Runde entscheidet gemeinsam per Klick.' },
  };
  const MODE = {
    audio: { icon: '🔊', label: 'Audio stoppt', text: 'der Song bricht ab – weitersingen! Braucht Internet' },
    sing: { icon: '🎙️', label: 'Ansingen', text: 'reihum singt eine Person an – ganz ohne Ton' },
  };
  const ANSWER = {
    teams: { icon: '👥', label: 'Teams abwechselnd', text: 'ein Team singt, das andere bewertet' },
    turns: { icon: '👤', label: 'Reihum', text: 'jede/r einzeln, alle anderen bewerten' },
    all: { icon: '⌨️', label: 'Alle gleichzeitig', text: 'alle tippen die Fortsetzung, die Runde vergibt 👍' },
  };
  const VERDICT = {
    yes: { icon: '👍', label: 'richtig', cls: 'good' },
    close: { icon: '🤏', label: 'fast', cls: 'part' },
    no: { icon: '👎', label: 'falsch', cls: 'danger' },
  };
  const LEVEL = {
    easy: { icon: '🙂', label: 'Bekannt', text: 'nur Hits, die jede/r kennt' },
    mixed: { icon: '🎶', label: 'Gemischt', text: 'Hits und Bekanntes' },
    all: { icon: '🎲', label: 'Alle', text: 'auch Raritäten' },
    hard: { icon: '🤓', label: 'Kenner', text: 'ohne die größten Hits' },
  };
  const SNIPPET_SECS = 30;

  const SETUP_KEY = 'finishlyrics.setup.v1';
  const PREFS_KEY = 'finishlyrics.prefs.v1';
  const USED_KEY = 'finishlyrics.used.v1';
  const ACTIVE_KEY = 'finishlyrics.active';
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

  function pts(n) {
    return `${n} ${plural(n, 'Punkt', 'Punkte')}`;
  }

  function secsText(x) {
    return String(Math.round(x * 10) / 10).replace('.', ',') + ' s';
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

  /** Wer antwortet wirklich? Ein Gerät = reihum, Ansingen kennt kein „alle gleichzeitig“ (die Wahl bleibt gespeichert) */
  function answerOf(st) {
    if (st.input === 'one' || (st.mode === 'sing' && st.answer === 'all')) return 'turns';
    return st.answer;
  }

  function allMode(v) {
    return v.cur && v.cur.kind === 'audio' && v.cur.turn === null;
  }

  /* ------------------------------------------------------------------ */
  /* Speicher                                                            */
  /* ------------------------------------------------------------------ */

  function loadSetup() {
    const s = Store.get(SETUP_KEY) || {};
    const names = Array.isArray(s.names) ? s.names.map((n) => String(n || '').slice(0, MAX_NAME)).slice(0, MAX_PLAYERS) : [];
    while (names.length < MIN_PLAYERS + 1) names.push('');
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
    modal: null, // rules | menu | quit | qr | settings | peek | stops
    answer: '', // Handy: getippte Fortsetzung
    answerKey: null,
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
  /* Ton am Laptop: bis zur Stoppstelle, dann ab dort weiter             */
  /* ------------------------------------------------------------------ */

  const Player = {
    snip: new window.GameSnippet.Snippet(),
    hits: {}, // id → iTunes-Treffer (Cover, Store-Link)
    finds: {}, // id → Promise
    state: {}, // id → loading | ready | missing | error
    clips: {}, // id → geladener Ausschnitt
    played: null, // zuletzt gestartet: "id:playId" bzw. "id:rest"
    from: 0, // ab welcher Sekunde die laufende Wiedergabe startete
    replaced: null,

    find(song) {
      if (!this.finds[song.id]) {
        this.state[song.id] = 'loading';
        this.finds[song.id] = AudioSource.itunes
          .find(song)
          .then((hit) => {
            this.hits[song.id] = hit;
            if (!hit) {
              this.state[song.id] = 'missing';
              return null;
            }
            return this.snip.load(song.id, hit.url).then((clip) => {
              this.clips[song.id] = clip;
              this.state[song.id] = 'ready';
              return clip;
            });
          })
          .catch((err) => {
            delete this.finds[song.id];
            this.state[song.id] = 'error';
            throw err;
          })
          .finally(() => render());
      }
      return this.finds[song.id];
    },

    stop() {
      this.snip.stop();
    },

    reset() {
      this.snip.stop();
      this.played = null;
    },

    /** Stelle im Ausschnitt, die gerade läuft (Sekunden) – null, wenn nichts läuft */
    position() {
      const t = this.snip.elapsed();
      return t === null ? null : this.from + t;
    },

    play(clip, from, len, onEnd) {
      this.from = from;
      this.snip.play(clip, from, len, onEnd);
    },

    /** Bühne: passt der Ton zur Ansicht? */
    sync(v) {
      this.snip.setMuted(Sound.muted);
      if (v.nextSong) this.find(v.nextSong).catch(() => {});
      const c = v.cur;
      const song = c && c.kind === 'audio' ? c.song : null;
      if (!song || !['play', 'sing', 'vote', 'reveal'].includes(v.phase)) {
        if (this.snip.playing) this.stop();
        return;
      }
      const id = song.id;
      if (!this.clips[id]) {
        this.find(song).then(
          (clip) => {
            if (!clip && ui.view && ui.view.phase === 'play' && ui.view.cur && ui.view.cur.song && ui.view.cur.song.id === id && this.replaced !== id) {
              // Kein Ausschnitt: unbemerkt der nächste Song
              this.replaced = id;
              dispatch('replace', { id });
            } else if (clip && ui.view) this.sync(ui.view);
          },
          () => {}
        );
        return;
      }
      const clip = this.clips[id];
      if (v.phase === 'play') {
        const key = `${id}:${c.playId}`;
        if (this.played === key) return;
        this.played = key;
        const playId = c.playId;
        this.play(clip, 0, c.stop, () => {
          if (ui.view && ui.view.phase === 'play' && ui.view.cur && ui.view.cur.playId === playId) {
            Sound.buzzer();
            dispatch('stopped', { playId });
          }
          render();
        });
        render();
        return;
      }
      if (v.phase === 'sing') {
        // „Auflösen“ vor dem Stopp oder der Stopp kam von woanders: Ruhe zum Weitersingen
        if (this.snip.playing && this.played !== `${id}:rest`) this.stop();
        return;
      }
      // Auflösung: ab der Stelle weiter bis zum Ende
      const key = `${id}:rest`;
      if (this.played === key) return;
      this.played = key;
      this.play(clip, c.stop, SNIPPET_SECS, () => render());
      render();
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
    Player.reset();
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
      stage: stage && stage.state && stage.state.v === 1 && stage.state.phase !== 'end' && now - (stage.savedAt || 0) < RESUME_MAX_AGE ? stage : null,
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
    const key = `${v.no}:${v.cur ? v.cur.kind : ''}`;
    if (ui.answerKey !== key) {
      ui.answerKey = key;
      ui.answer = '';
      if (ui.modal === 'peek') ui.modal = null;
    }
    if (v.phase === 'buzzed' && was !== 'buzzed') {
      Sound.buzzer();
      if (!v.me.stage && v.cur && v.cur.buzz && v.cur.buzz.pid === v.me.id) vibrate([80, 40, 80]);
    }
    if (was === v.phase) return;
    if (!v.me.stage && v.phase === 'sing' && (v.me.turn || allMode(v))) vibrate([60, 40, 60]);
    if (!v.me.stage && v.phase === 'vote' && v.me.voter) vibrate(40);
    if (v.phase === 'pick' && !v.me.stage && v.me.singer) vibrate([60, 40, 60]);
    if (v.phase === 'reveal' && v.last) {
      Sound.flip();
      const good = !v.last.nobody;
      setTimeout(() => (good ? Sound.success() : Sound.fail()), 380);
      if (ui.modal === 'peek') ui.modal = null;
    }
    if (v.phase === 'end' && was && was !== 'end') {
      Sound.fanfare();
      confetti(['#f472b6', '#fb923c', '#facc15', '#a78bfa', '#fff']);
      keepAwake(false);
    }
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

  function micSvg(cls) {
    return `
      <svg class="mic ${cls || ''}" viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <linearGradient id="ftl-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#f472b6" />
            <stop offset="1" stop-color="#fb923c" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r="56" fill="#1d1230" stroke="url(#ftl-ring)" stroke-width="5" />
        <rect x="47" y="24" width="26" height="44" rx="13" fill="#facc15" />
        <path d="M38 58 a22 22 0 0 0 44 0" fill="none" stroke="#f9fafb" stroke-width="5" stroke-linecap="round" />
        <rect x="57.5" y="80" width="5" height="12" rx="2.5" fill="#f9fafb" />
        <rect x="46" y="91" width="28" height="5" rx="2.5" fill="#f9fafb" />
        <g class="mic-notes" fill="#f472b6">
          <circle class="n1" cx="92" cy="40" r="4" /><rect class="n1" x="95" y="22" width="2.4" height="18" rx="1.2" />
          <circle class="n2" cx="26" cy="48" r="3.5" /><rect class="n2" x="28.5" y="32" width="2.2" height="16" rx="1.1" />
        </g>
      </svg>`;
  }

  function logoHtml(small) {
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="Finish the lyrics"><span class="logo-text">Finish <i>the</i> <span>lyrics</span></span></div>`;
  }

  function muteBtn() {
    return `<button class="icon-btn" data-act="mute" title="Ton an/aus" aria-label="Ton ${Sound.muted ? 'an' : 'aus'}schalten">${Sound.muted ? '🔇' : '🔊'}</button>`;
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

  /** Countdown (läuft per data-live weiter) */
  function countdownHtml(c) {
    if (!c) return '';
    if (c.paused !== null && c.paused !== undefined) return `<div class="countdown is-paused"><span style="width:${(100 * c.paused) / c.total}%"></span></div>`;
    if (c.left === null || c.left === undefined) return '';
    const left = Math.max(0, c.left - (performance.now() - ui.viewAt));
    return `<div class="countdown" data-live="countdown" data-total="${c.total}"><span style="width:${(100 * left) / c.total}%"></span><b>${Math.ceil(left / 1000)}</b></div>`;
  }

  /** Ausschnitt-Leiste: 0–30 s, Stoppstelle markiert (Fortschritt setzt liveLoop, nur am Laptop) */
  function trackHtml(v) {
    const c = v.cur;
    const stage = v.me.stage;
    const stopPct = stage && c.stop ? (100 * c.stop) / SNIPPET_SECS : null;
    let fill = 0;
    if (stage && v.phase !== 'play') fill = stopPct || 0;
    return `
      <div class="track ${v.phase === 'play' ? 'is-playing' : ''}" aria-hidden="true">
        <span class="track-fill" ${stage ? 'data-live="track"' : ''} style="width:${fill}%"></span>
        ${stopPct !== null ? `<i class="track-stop" style="left:${stopPct}%" title="Stoppstelle ${secsText(c.stop)}"></i>` : ''}
      </div>`;
  }

  /** Punktestand (sortiert) */
  function scoresHtml(v, small) {
    const rows = v.teams
      .map((t, i) => ({ t, i }))
      .sort((a, b) => b.t.points - a.t.points || a.i - b.i)
      .map(({ t, i }) => {
        const turn = v.cur && v.cur.kind === 'audio' && v.cur.turn === i && !['reveal', 'end'].includes(v.phase);
        const fire = v.settings.drinks && t.streak >= 2 ? ' <span title="Serie">🔥</span>' : '';
        return `<li class="${turn ? 'is-turn' : ''}" style="${teamStyle(t)}"><i class="dot"></i><span>${esc(t.name)}${fire}</span><b>${t.points}</b></li>`;
      })
      .join('');
    return `<ol class="scores ${small ? 'scores-small' : ''}">${rows}</ol>`;
  }

  function songNoLabel(v) {
    return `Song ${v.no}/${v.total}`;
  }

  function artworkUrl(id, size) {
    const hit = Player.hits[id];
    if (!hit || !hit.artwork) return null;
    return hit.artwork.replace(/\/\d+x\d+(bb)?\./, `/${size}x${size}bb.`);
  }

  function storeLinkHtml(song) {
    const hit = Player.hits[song.id];
    if (hit && hit.storeUrl) return `<a class="store" href="${esc(hit.storeUrl)}" target="_blank" rel="noopener">🍏 In Apple Music öffnen</a>`;
    const links = AudioSource.searchLinks(song)
      .map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${x.icon} ${esc(x.label)}</a>`)
      .join(' · ');
    return `<span class="listen-links">Anhören: ${links}</span>`;
  }

  function songCardHtml(song, opts) {
    const o = opts || {};
    const art = o.art ? artworkUrl(song.id, 300) : null;
    return `
      <div class="song-card ${o.cls || ''}">
        ${art ? `<img class="cover" src="${esc(art)}" alt="" />` : o.art ? `<div class="cover cover-empty">${micSvg()}</div>` : ''}
        <div class="song-body">
          <b class="song-title">${esc(song.title)}</b>
          <span class="song-artist">${esc(song.artist)}</span>
          ${o.year ? `<span class="song-year">${song.year}</span>` : ''}
        </div>
      </div>`;
  }

  function verdictBadge(verdict) {
    if (!verdict) return '<span class="verdict is-none">–</span>';
    const x = VERDICT[verdict];
    return `<span class="verdict is-${verdict}">${x.icon} ${x.label}</span>`;
  }

  function turnTeam(v) {
    const c = v.cur;
    return c && c.kind === 'audio' && c.turn !== null ? v.teams[c.turn] : null;
  }

  /* ------------------------------------------------------------------ */
  /* Start und Spiel anlegen                                             */
  /* ------------------------------------------------------------------ */

  function homeHtml() {
    const saves = savedGames();
    const resume = [];
    if (saves.stage) {
      const st = saves.stage.state;
      const who = st.phase === 'lobby' ? 'Lobby' : `Song ${st.no}/${st.total || st.settings.count} · ${st.teams.map((t) => t.name).join(', ')}`;
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
        <div class="home-mic">${micSvg('dance')}</div>
        ${logoHtml()}
        <p class="tagline">Die Musik stoppt mitten in der Zeile –<br><b>wer kann weitersingen?</b></p>
        <div class="home-wave" aria-hidden="true">${Array.from({ length: 9 }, (_, i) => `<span style="--i:${i}"></span>`).join('')}<b>⏸</b><em>?</em></div>
      </div>
      ${resume.join('')}
      <div class="mode-cards">
        <button class="mode-card" data-act="setup">
          <span class="mode-icon">💻</span>
          <span class="mode-body"><b>Spiel anlegen</b><small>Am Laptop: Lautsprecher und Bühne – mit Handys oder alle an einem Gerät.</small></span>
          <span class="mode-go">Los geht’s →</span>
        </button>
        <button class="mode-card" data-act="join-screen">
          <span class="mode-icon">📱</span>
          <span class="mode-body"><b>Mitspielen</b><small>Mit dem Handy beitreten – QR-Code am Laptop scannen oder Raum-Code eingeben.</small></span>
          <span class="mode-go">Beitreten →</span>
        </button>
      </div>
      <button class="btn btn-link" data-act="rules">📖 Spielregeln</button>
      <p class="home-foot">${MIN_PLAYERS}–${MAX_PLAYERS} Personen oder Teams · ${Songs.list().length} Songs · keine Songtexte gespeichert – ihr singt selbst</p>
    </div>`;
  }

  /** Einstellungen – im Setup (scope 'setup') und in der Lobby (scope 'lobby', geht an die Engine) */
  function settingsHtml(st, scope) {
    const songs = E.pool(st).length;
    const perDecade = {};
    for (const x of E.pool(Object.assign({}, st, { decades: [] }))) perDecade[x.decade] = (perDecade[x.decade] || 0) + 1;
    const perCat = {};
    for (const x of Songs.filter({ level: st.level, decades: st.decades })) perCat[x.cat] = (perCat[x.cat] || 0) + 1;
    const phones = st.input === 'phones';
    const audio = st.mode === 'audio';
    const answers = Object.entries(ANSWER).filter(([id]) => audio || id !== 'all');
    let who;
    if (!phones) who = '<p class="note">🖥️ Ein Gerät: reihum – wer in Teams spielen will, trägt einfach die Teamnamen ein. Die Runde entscheidet gemeinsam am Laptop.</p>';
    else
      who = `
        <h2>Wer antwortet?</h2>
        <div class="choices choices-${answers.length}">${answers.map(([id, x]) => choice(scope, 'answer', id, `${x.icon} ${x.label}`, answerOf(st) === id, `<small>${x.text}</small>`)).join('')}</div>
        ${answerOf(st) === 'teams' ? `<h3>Teams</h3><div class="choices">${TEAM_COUNTS.map((n) => choice(scope, 'teams', n, `${n} Teams`, st.teams === n)).join('')}</div>` : ''}`;
    return `
      <section class="panel">
        <h2>Spielweise</h2>
        <div class="choices choices-2">${Object.entries(MODE)
          .map(([id, m]) => choice(scope, 'mode', id, `${m.icon} ${m.label}`, st.mode === id, `<small>${m.text}</small>`))
          .join('')}</div>
        ${who}
        <h2>Anzahl Songs</h2>
        <div class="choices">${COUNTS.map((n) => choice(scope, 'count', n, `${n} Songs`, st.count === n, n === 15 ? '<small>Standard</small>' : n === 10 ? '<small>kurz</small>' : '<small>lang</small>')).join('')}</div>
        <p class="note">Damit alle gleich oft dran sind, wird auf volle Runden aufgerundet.</p>
        ${
          audio
            ? `<h2>Zeit zum Weitersingen</h2>
               <div class="choices">${TIMES.map((n) => choice(scope, 'time', n, `${n} s`, st.time === n, n === 10 ? '<small>Standard</small>' : '')).join('')}</div>
               ${answerOf(st) === 'all' ? `<p class="note">Beim Tippen gibt es ${TYPE_EXTRA_MS / 1000} s mehr.</p>` : ''}
               <p class="note">Die Ausschnitte kommen aus der iTunes-Suche. Findet sich keiner, kommt einfach der nächste Song.</p>`
            : `<p class="note">🎙️ Reihum sucht sich eine Person einen von ${E.SING_OPTIONS} Songs aus (${phones ? 'am eigenen Handy' : 'kurz allein am Laptop'}) und singt eine Zeile an.
                Wer weitersingen kann, ${phones ? 'drückt ✋' : 'ruft'} – Treffer ${SING_HIT} Punkte, die Ansänger/in bekommt ${SING_SINGER}.</p>`
        }
      </section>
      <section class="panel">
        <h2>Kategorien</h2>
        <div class="pills">${Songs.CATEGORIES.map((c) => pill(scope, 'cats', c.id, `${c.icon} ${esc(c.label)}`, st.cats, perCat[c.id] || 0)).join('')}</div>
        <h2>Jahrzehnte</h2>
        <div class="pills">${Songs.DECADES.map((d) => pill(scope, 'decades', d, Songs.decadeLabel(d), st.decades, perDecade[d] || 0)).join('')}</div>
        <h2>Songs</h2>
        <div class="choices">${Object.entries(LEVEL)
          .map(([id, l]) => choice(scope, 'level', id, `${l.icon} ${l.label}`, st.level === id, `<small>${l.text}</small>`))
          .join('')}</div>
        <p class="note pool-count">🎶 <b>${songs}</b> ${plural(songs, 'Song passt', 'Songs passen')}${songs < MIN_POOL ? ` – mindestens ${MIN_POOL} nötig` : ''}</p>
      </section>
      <section class="panel">
        ${toggle(scope, 'drinks', st.drinks, '🍻 Trinkregeln', `👎 → ${SIPS_WRONG} Schluck · ${STREAK} × 👍 hintereinander → ${SIPS_GIVE} Schlucke verteilen`)}
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
          <p class="note">Reihenfolge = Reihenfolge im Spiel. Die Nummer ist beim Ansingen die <b>Taste</b> am Laptop. Teams? Einfach den Teamnamen eintragen.</p>
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
        <h2>Geräte</h2>
        <div class="input-cards">${inputCard('phones')}${inputCard('one')}</div>
      </section>
      ${names}
      ${settingsHtml(st, 'setup')}
      <div class="setup-go">
        ${problem ? `<p class="problem">${esc(problem)}</p>` : ''}
        <button class="btn btn-primary btn-big btn-wide" data-act="create" ${problem ? 'disabled' : ''}>${st.input === 'phones' ? '📱 Raum öffnen' : '🎤 Los geht’s'}</button>
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
      <div class="join-hero">${micSvg('dance')}${logoHtml(true)}</div>
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
    const info = v.phase === 'lobby' ? 'Lobby' : v.phase === 'end' ? '🏁 Spielende' : songNoLabel(v);
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
    else if (v.cur && v.cur.kind === 'sing') main = singStageHtml(v);
    else main = audioStageHtml(v);
    const side = ['lobby', 'end'].includes(v.phase) ? '' : `<aside class="stage-side"><h2>Punkte</h2>${scoresHtml(v)}</aside>`;
    return `<div class="screen game stage-${v.phase}">${barHtml(v)}<div class="stage-grid ${side ? '' : 'is-full'}"><div class="stage-mainpart">${main}</div>${side}</div></div>`;
  }

  function summaryList(st) {
    return [
      MODE[st.mode].icon + ' ' + MODE[st.mode].label,
      ANSWER[answerOf(st)].label + (answerOf(st) === 'teams' ? ` (${st.teams})` : ''),
      `${st.count} Songs`,
      st.mode === 'audio' ? `${st.time} s weitersingen` : '',
      st.drinks ? '🍻 Trinkregeln' : '',
    ].filter(Boolean);
  }

  function lobbyStageHtml(v) {
    const teams = answerOf(v.settings) === 'teams' ? v.settings.teams : 0;
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
    const summary = summaryList(v.settings).concat(`${v.poolSize} Songs zur Auswahl`);
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
            <button class="btn btn-primary btn-big btn-wide" data-act="start" ${v.lobbyProblem ? 'disabled' : ''}>🎤 Los geht’s</button>
          </div>
        </div>
      </div>`;
  }

  /** Zustand des Ausschnitts am Laptop */
  function audioStateHtml(v) {
    const c = v.cur;
    const id = c.song.id;
    const st = Player.state[id];
    if (!Player.clips[id]) {
      if (st === 'error')
        return `<div class="audio-state is-error">⚠️ Ausschnitt nicht erreichbar – Internet?
          <button class="btn btn-ghost btn-small" data-act="audio-retry">Nochmal versuchen</button>
          <button class="btn btn-ghost btn-small" data-act="replace">⏭️ Anderer Song</button></div>`;
      if (st === 'missing') return '<div class="audio-state">Kein Ausschnitt – nächster Song…</div>';
      return '<div class="audio-state"><span class="spinner spinner-small" aria-hidden="true"></span> Ausschnitt wird geladen…</div>';
    }
    if (Player.snip.blocked) return '<div class="audio-state"><button class="btn btn-primary" data-act="audio-unlock">🔊 Ton an</button> Der Browser wartet auf einen Klick</div>';
    return '';
  }

  /** „📍 Hier wäre eine gute Stelle“ – nur während der Ausschnitt läuft */
  function markBtnHtml(v) {
    const c = v.cur;
    const known = c.stopKnown ? '<span class="stop-known" title="Diese Stoppstelle ist schon gespeichert">📍 gespeicherte Stelle</span>' : '';
    if (!Player.snip.playing) return known;
    return `${known}<button class="btn btn-ghost btn-small btn-mark" data-act="mark" title="Merkt sich die aktuelle Stelle im Ausschnitt als Stoppstelle">📍 Hier wäre eine gute Stelle</button>`;
  }

  /** Wer bei „alle gleichzeitig“ schon getippt hat */
  function answeredHtml(v) {
    const c = v.cur;
    const rows = v.teams
      .map((t) => {
        const pid = t.members[0] && t.members[0].id;
        const done = pid && c.answered.includes(pid);
        return `<li class="chip-team ${done ? 'is-hit' : ''}" style="${teamStyle(t)}"><i class="dot"></i>${esc(t.name)} ${done ? '<b class="ok">✓</b>' : '<span class="wait">…</span>'}</li>`;
      })
      .join('');
    return `<ul class="chips">${rows}</ul>`;
  }

  /** Abstimmung am Laptop: Reihum/Teams */
  function voteStageHtml(v) {
    const c = v.cur;
    const one = v.settings.input === 'one';
    const t = turnTeam(v);
    const buttons = Object.entries(VERDICT)
      .map(([id, x], i) => `<button class="btn btn-${x.cls} btn-big" data-act="verdict" data-verdict="${id}">${one ? `<kbd>${i + 1}</kbd>` : ''}${x.icon} ${x.label} <small>+${POINTS[id]}</small></button>`)
      .join('');
    const head = one
      ? `<p class="how">Hat <b>${esc(t.name)}</b> richtig weitergesungen? Entscheidet gemeinsam:</p>`
      : `<p class="how">📱 Die anderen stimmen am Handy ab: hat <b>${esc(t.name)}</b> richtig weitergesungen?</p>
         <p class="vote-count">🗳️ <b>${c.voted}</b> von ${c.voters} ${plural(c.voters, 'Stimme', 'Stimmen')}</p>`;
    return `
      ${head}
      <div class="judge">${buttons}</div>
      ${one ? '' : `<p class="note center">Ein Klick hier überstimmt die Runde.${c.voted ? ' <button class="btn btn-link" data-act="count">📊 Jetzt auswerten</button>' : ''}</p>`}`;
  }

  /** Abstimmung am Laptop: alle gleichzeitig – Antworten ohne Namen */
  function answersStageHtml(v) {
    const c = v.cur;
    const cards = c.answers
      .map((a) => {
        const auto = E.likeVerdict(a.likes, Math.max(1, v.teams.length - 1));
        const shown = a.override || auto;
        return `
          <li class="answer-card ${a.override ? 'is-override' : ''}">
            <span class="answer-text">„${esc(a.text)}“</span>
            <span class="answer-likes">👍 ${a.likes}</span>
            <button class="answer-verdict is-${shown}" data-act="cycle" data-i="${a.i}" title="Klick: überstimmen">${VERDICT[shown].icon}${a.override ? '<small>fest</small>' : ''}</button>
          </li>`;
      })
      .join('');
    return `
      <p class="how">📱 Alle vergeben am Handy 👍 für Antworten, die stimmen (nicht die eigene).</p>
      <ul class="answers">${cards}</ul>
      <p class="vote-count">✔ <b>${c.voted}</b> ${plural(c.voted, 'ist', 'sind')} fertig</p>
      <div class="controls"><button class="btn btn-primary" data-act="count">📊 Auswerten</button></div>
      <p class="note center">Mehr als die Hälfte 👍 = richtig (${POINTS.yes}), mindestens ein 👍 = fast (${POINTS.close}). Klick auf das Symbol überstimmt.</p>`;
  }

  function audioStageHtml(v) {
    const c = v.cur;
    const one = v.settings.input === 'one';
    const t = turnTeam(v);
    const all = c.turn === null;
    let body;
    if (v.phase === 'play') {
      body = `
        <p class="turn">${all ? '⌨️ Alle sind dran – gleich tippen!' : `🎤 <b style="${teamStyle(t)}">${esc(t.name)}</b> ist dran`}</p>
        <p class="how">🔊 Gut zuhören … gleich stoppt die Musik!</p>
        ${all ? answeredHtml(v) : ''}`;
    } else if (v.phase === 'sing') {
      body = `
        <p class="turn sing-now">${all ? '⌨️ Tippt die Fortsetzung am Handy!' : `🎤 <b style="${teamStyle(t)}">${esc(t.name)}</b>, sing weiter!`}</p>
        ${countdownHtml(c)}
        ${all ? answeredHtml(v) : ''}`;
    } else body = all ? answersStageHtml(v) : voteStageHtml(v);
    const controls =
      v.phase === 'vote'
        ? ''
        : `<div class="controls">
            <button class="btn btn-ghost" data-act="replay">🔁 Nochmal bis zur Stelle</button>
            <button class="btn btn-ghost" data-act="resolve">▶ Auflösen</button>
          </div>`;
    return `
      <section class="stage audio-stage">
        <div class="audio-head">
          ${micSvg(Player.snip.playing ? 'dance' : '')}
          <div class="audio-info">
            <span class="snip-no">${songNoLabel(v)}${one ? '' : ' · 🔊 Audio stoppt'}</span>
            ${songCardHtml(c.song)}
            ${trackHtml(v)}
            ${audioStateHtml(v)}
            <div class="mark-row">${markBtnHtml(v)}</div>
          </div>
        </div>
        ${v.phase === 'vote' ? '<p class="resolve-banner">▶ Auflösung – der Song läuft ab der Stelle weiter</p>' : ''}
        ${body}
        ${controls}
      </section>`;
  }

  /** Wer beim Ansingen weitersingen darf (ein Gerät: Knöpfe) */
  function singChipsHtml(v, buttons) {
    const c = v.cur;
    const rows = v.teams
      .map((t, i) => {
        if (i === c.singerTeam) return `<li class="chip-team is-singer" style="${teamStyle(t)}"><i class="dot"></i>${esc(t.name)} 🎙️</li>`;
        if (c.out.includes(i)) return `<li class="chip-team is-out" style="${teamStyle(t)}"><i class="dot"></i>${esc(t.name)} <b class="no">❌</b></li>`;
        if (buttons && c.eligible.includes(i)) {
          const key = i < 9 ? `<kbd>${i + 1}</kbd>` : '';
          return `<li><button class="chip-team is-btn" style="${teamStyle(t)}" data-act="stage-buzz" data-team="${i}">${key}<i class="dot"></i>${esc(t.name)}</button></li>`;
        }
        return `<li class="chip-team" style="${teamStyle(t)}"><i class="dot"></i>${esc(t.name)} <span class="wait">…</span></li>`;
      })
      .join('');
    return `<ul class="chips ${buttons ? 'chips-buzz' : ''}">${rows}</ul>`;
  }

  function singStageHtml(v) {
    const c = v.cur;
    const one = v.settings.input === 'one';
    const name = esc(c.singerName);
    let body;
    if (v.phase === 'pick') {
      body = one
        ? `<h2 class="turn">🎙️ <b>${name}</b> singt an!</h2>
           <p class="note center">Alle anderen: wegschauen! Nur ${name} schaut auf den Laptop.</p>
           <div class="go"><button class="btn btn-primary btn-big" data-act="peek">🙈 Songs zeigen <small>nur für ${name}</small></button></div>`
        : `<h2 class="turn">🎙️ <b>${name}</b> sucht sich einen Song aus …</h2>
           <p class="note center">Die drei Vorschläge stehen auf ${name}s Handy.</p>
           <div class="go"><button class="btn btn-link" data-act="skipsing">⏭️ Jemand anderes singt an</button></div>`;
    } else if (v.phase === 'buzzed') {
      const b = c.buzz;
      const t = v.teams[b.team];
      const who = esc(b.name) + (answerOf(v.settings) === 'teams' ? ` <small>(${esc(t.name)})</small>` : '');
      body = `
        <div class="buzzed" style="${teamStyle(t)}">
          <p class="buzz-who">✋ ${who}</p>
          <p class="buzz-say">singt laut weiter …</p>
          <p class="note center">${one ? `${name} weiß, wie es weitergeht, und entscheidet:` : `${name} entscheidet am Handy – oder ihr hier:`}</p>
          <div class="judge">
            <button class="btn btn-good btn-big" data-act="judge" data-ok="yes">✅ Stimmt! <small>+${SING_HIT}</small></button>
            <button class="btn btn-danger" data-act="judge" data-ok="no">❌ Falsch <small>raus für diesen Song</small></button>
          </div>
        </div>`;
    } else {
      body = `
        <h2 class="turn">🎙️ <b>${name}</b> singt an!</h2>
        <p class="note center">Eine Zeile anfangen und mittendrin aufhören …</p>
        ${countdownHtml(c)}
        <p class="how">${one ? 'Wer weitersingen kann, ruft – tippt an, wer zuerst war:' : '✋ Wer weitersingen kann, drückt am Handy!'}</p>
        ${singChipsHtml(v, one)}
        <div class="controls">
          ${one ? `<button class="btn btn-ghost" data-act="peek">🙈 Song nochmal zeigen <small>nur ${name}</small></button>` : ''}
          <button class="btn btn-ghost" data-act="resolve">🔍 Niemand weiß es</button>
        </div>`;
    }
    return `
      <section class="stage sing-stage">
        <div class="sing-head">
          <div class="sing-mic ${v.phase === 'play' ? 'is-live' : ''}" aria-hidden="true">🎙️</div>
          <span class="snip-no">${songNoLabel(v)} · 🎙️ Ansingen</span>
        </div>
        ${body}
      </section>`;
  }

  /** Ergebnis-Zeilen der Auflösung */
  function resultsHtml(v) {
    const l = v.last;
    const out = [];
    const rows = [];
    if (l.kind === 'audio' && l.all) {
      const list = l.results.filter((r) => r.text || r.verdict).sort((a, b) => b.points - a.points);
      for (const r of list) {
        const t = v.teams[r.team];
        rows.push(`
          <li class="res ${r.points ? 'is-hit' : ''}" style="${teamStyle(t)}">
            <i class="dot"></i><span class="res-name">${esc(t.name)}</span>
            <span class="res-what">„${esc(r.text)}“ <small>👍 ${r.likes}${r.overridden ? ' · überstimmt' : ''}</small></span>
            ${verdictBadge(r.verdict)}<b>+${r.points}</b>
          </li>`);
      }
      const silent = l.results.filter((r) => !r.text);
      if (silent.length) rows.push(`<li class="res is-miss"><span class="res-name">🤐 nichts getippt: ${andList(silent.map((r) => esc(v.teams[r.team].name)))}</span></li>`);
    } else if (l.kind === 'audio') {
      const t = v.teams[l.turn];
      const votes = l.votes.total ? `👍 ${l.votes.yes} · 🤏 ${l.votes.close} · 👎 ${l.votes.no}` : '';
      out.push(`<p class="result is-${l.verdict === 'no' ? 'wrong' : 'right'}">${VERDICT[l.verdict].icon} ${esc(t ? t.name : '?')}: ${VERDICT[l.verdict].label}! <b>+${l.points}</b></p>`);
      if (votes || l.overridden) out.push(`<p class="note center">${votes}${l.overridden ? `${votes ? ' · ' : ''}entschieden am Laptop` : ''}</p>`);
    } else {
      if (l.hit) {
        const t = v.teams[l.hit.team];
        rows.push(`<li class="res is-hit" style="${teamStyle(t)}"><i class="dot"></i><span class="res-name">${esc(memberName(v, l.hit.pid))}</span><span class="res-what">✋ weitergesungen</span><b>+${SING_HIT}</b></li>`);
      }
      if (l.singerTeam !== null && l.singerTeam !== undefined) {
        const t = v.teams[l.singerTeam];
        rows.push(`<li class="res ${l.hit ? 'is-hit' : ''}" style="${teamStyle(t)}"><i class="dot"></i><span class="res-name">${esc(memberName(v, l.singer))}</span><span class="res-what">🎙️ angesungen</span><b>${l.hit ? '+' + SING_SINGER : '0'}</b></li>`);
      }
      if (l.wrong.length) rows.push(`<li class="res is-miss"><span class="res-name">❌ ${andList(l.wrong.map((w) => esc(memberName(v, w.pid))))}</span></li>`);
      if (!l.hit) out.push('<p class="result is-wrong">🙉 Niemand konnte weitersingen!</p>');
    }
    for (const ti of l.sips.drink) out.push(`<p class="drink">🍻 ${esc(v.teams[ti].name)} ${plural(v.teams[ti].members.length, 'trinkt', 'trinken')} ${SIPS_WRONG} ${plural(SIPS_WRONG, 'Schluck', 'Schlucke')}</p>`);
    for (const ti of l.sips.give) out.push(`<p class="drink">🔥 ${STREAK} × 👍 in Folge – ${esc(v.teams[ti].name)} ${plural(v.teams[ti].members.length, 'darf', 'dürfen')} ${SIPS_GIVE} Schlucke verteilen</p>`);
    return `${out.join('')}${rows.length ? `<ul class="results">${rows.join('')}</ul>` : ''}`;
  }

  function nextLabel(v) {
    if (v.willEnd) return '🏆 Zur Siegerehrung';
    return 'Weiter →<small>nächster Song</small>';
  }

  function revealStageHtml(v) {
    const l = v.last;
    const audio = l.kind === 'audio';
    return `
      <section class="stage reveal-stage">
        <span class="snip-no">Song ${l.no}/${v.total} · ${audio ? '🔊 Audio stoppt' : '🎙️ Ansingen'}</span>
        ${songCardHtml(l.song, { art: true, year: true, cls: 'is-big' })}
        ${audio && v.cur ? trackHtml(v) : ''}
        ${audio && v.cur ? `<div class="mark-row">${markBtnHtml(v)}</div>` : ''}
        ${storeLinkHtml(l.song)}
        ${resultsHtml(v)}
      </section>
      <div class="go"><button class="btn btn-primary btn-big" data-act="next">${nextLabel(v)}</button></div>`;
  }

  function endHtml(v, stage) {
    const wins = v.ranking.filter((r) => r.place === 1);
    const title = wins.length ? `${andList(wins.map((w) => esc(w.name)))} ${plural(wins.length, 'gewinnt', 'gewinnen')}!` : 'Spiel beendet';
    const songs = (v.log || []).length;
    const sub = v.reason === 'empty' ? 'Die Songs sind ausgegangen.' : v.reason === 'stopped' ? 'Spiel vorzeitig beendet.' : `${songs} Songs`;
    const rows = `<ol class="ranking">${v.ranking
      .map(
        (r) => `
          <li class="${r.place === 1 ? 'is-win' : ''}" style="--team:${esc(r.color)}">
            <span class="place">${r.place === 1 ? '🏆' : r.place + '.'}</span>
            <span class="rank-name"><i class="dot"></i>${esc(r.name)}</span>
            <span class="rank-info"><b>${pts(r.points)}</b> · ${r.hits} × 👍</span>
          </li>`
      )
      .join('')}</ol>`;
    const awards = (v.awards || []).map((a) => `<li>${a.icon} <b>${esc(a.label)}</b>: ${andList(a.pids.map((p) => esc(memberName(v, p))))} – ${esc(a.text)}</li>`).join('');
    const playlist = (v.log || [])
      .map((x) => {
        const hit = Player.hits[x.song.id];
        const url = hit && hit.storeUrl ? hit.storeUrl : AudioSource.searchLinks(x.song)[0].url;
        const who = x.results.length ? x.results.map((r) => `${esc(v.teams[r.team].name)} +${r.points}`).join(', ') : '🙉 niemand';
        return `
          <li>
            <span class="pl-kind" title="${x.kind === 'sing' ? 'angesungen' : 'Audio'}">${x.kind === 'sing' ? '🎙️' : '🔊'}</span>
            <a href="${esc(url)}" target="_blank" rel="noopener"><b>${esc(x.song.title)}</b> – ${esc(x.song.artist)} <small>${x.song.year}</small></a>
            <span class="pl-who">${x.singer ? `${esc(memberName(v, x.singer))} · ` : ''}${who}</span>
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
      <div class="trophy" aria-hidden="true">🏆</div>
      <h1>${title}</h1>
      <p class="end-sub">${sub}</p>
      ${rows}
      ${awards ? `<ul class="awards">${awards}</ul>` : ''}
      <div class="end-actions">${actions}</div>
      ${playlist ? `<section class="panel"><h2>🎶 Playlist des Abends</h2><ol class="playlist">${playlist}</ol></section>` : ''}
    </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Handy                                                               */
  /* ------------------------------------------------------------------ */

  function phoneBar(v) {
    const t = v.me.team !== null ? v.teams[v.me.team] : null;
    const teamMode = answerOf(v.settings) === 'teams';
    const mine = t ? `<span class="me-team" style="${teamStyle(t)}"><i class="dot"></i>${esc(v.me.name)}${teamMode ? ` · ${esc(t.name)}` : ''}</span>` : `<span class="me-team">${esc(v.me.name)}</span>`;
    return `
      <header class="bar phone-bar">
        <span class="bar-left">${mine}${v.me.lead ? '<span class="lead" title="Spielleitung">🎬</span>' : ''}</span>
        <span class="bar-right">${t ? `<b class="me-points">${t.points} P.</b>` : ''}<button class="icon-btn" data-act="menu" title="Menü" aria-label="Menü">☰</button></span>
      </header>
      ${ui.status === 'reconnecting' ? '<p class="banner">Verbindung unterbrochen – verbinde neu…</p>' : ''}`;
  }

  function playerHtml(v) {
    let main;
    if (v.phase === 'lobby') main = phoneLobbyHtml(v);
    else if (v.phase === 'end') main = endHtml(v, false);
    else if (v.me.team === null) main = phoneWatchHtml(v);
    else if (v.phase === 'reveal') main = phoneRevealHtml(v);
    else if (v.cur.kind === 'sing' && v.me.singer) main = phoneSingerHtml(v);
    else if (v.cur.kind === 'sing') main = phoneSingHtml(v);
    else main = phoneAudioHtml(v);
    return `<div class="screen phone phone-${v.phase}">${phoneBar(v)}${main}</div>`;
  }

  function phoneLobbyHtml(v) {
    const st = v.settings;
    const teams = answerOf(st) === 'teams' ? st.teams : 0;
    return `
      <div class="phone-center">
        ${micSvg('dance')}
        <h1>Du bist dabei!</h1>
        ${v.me.watch ? '<p class="note">Das Spiel ist voll oder läuft schon – du schaust zu.</p>' : ''}
        ${
          teams && !v.me.watch
            ? `<h2>Dein Team</h2><div class="choices choices-2">${Array.from({ length: teams }, (_, i) => `<button class="choice team-choice ${v.me.lobbyTeam === i ? 'on' : ''}" style="--team:${E.TEAMS[i].color}" data-act="team" data-team="${i}" aria-pressed="${v.me.lobbyTeam === i}"><i class="dot"></i>${esc(E.TEAMS[i].name)}<small>${v.members.filter((m) => m.team === i && !m.watch).map((m) => esc(m.name)).join(', ') || '–'}</small></button>`).join('')}</div>`
            : ''
        }
        <p class="summary">${summaryList(st).map((x) => `<span>${esc(x)}</span>`).join('')}</p>
        <p class="waiting">⌛ Der Laptop startet das Spiel, sobald alle da sind.</p>
        <button class="btn btn-link" data-act="rules">📖 Spielregeln</button>
      </div>`;
  }

  function phoneWatchHtml(v) {
    return `
      <div class="phone-center">
        <p class="note">Du schaust zu.</p>
        <h2 class="turn">${songNoLabel(v)}</h2>
        ${scoresHtml(v, true)}
      </div>`;
  }

  /** Spielleitung am Handy: Ablauf mitsteuern */
  function leadControlsHtml(v) {
    if (!v.me.lead) return '';
    const c = v.cur;
    if (c.kind === 'sing') return v.phase === 'play' ? `<div class="lead-ctrl"><span>🎬</span><button class="btn btn-ghost btn-small" data-act="resolve">🔍 Niemand weiß es</button></div>` : '';
    if (v.phase === 'vote') return c.voted || c.turn === null ? `<div class="lead-ctrl"><span>🎬</span><button class="btn btn-ghost btn-small" data-act="count">📊 Jetzt auswerten</button></div>` : '';
    return `
      <div class="lead-ctrl">
        <span>🎬</span>
        <button class="btn btn-ghost btn-small" data-act="replay">🔁 Nochmal</button>
        <button class="btn btn-ghost btn-small" data-act="resolve">▶ Auflösen</button>
      </div>`;
  }

  function answerFormHtml(v) {
    const sent = v.me.answer;
    const val = ui.answer || '';
    return `
      <form class="panel answer-form" data-form="answer">
        <label class="label" for="answer-input">Wie geht’s weiter? <small>ein paar Wörter reichen</small></label>
        <input class="input input-big" id="answer-input" type="text" maxlength="${MAX_ANSWER}" placeholder="${sent ? 'ändern …' : 'weiter im Text …'}" value="${esc(val)}" data-field="answer" autocomplete="off" autocapitalize="sentences" spellcheck="false" enterkeyhint="send" />
        <div class="guess-foot">
          ${sent ? `<span class="sent">✓ „${esc(sent)}“</span>` : '<span></span>'}
          <button class="btn btn-primary" type="submit" ${val.trim() ? '' : 'disabled'}>${sent ? 'Ändern' : 'Abschicken'} ➤</button>
        </div>
      </form>`;
  }

  /** Handy: abstimmen 👍/🤏/👎 */
  function voteButtonsHtml(v) {
    return `
      <div class="vote-buttons">
        ${Object.entries(VERDICT)
          .map(([id, x]) => `<button class="vote-btn is-${id} ${v.me.vote === id ? 'on' : ''}" data-act="vote" data-verdict="${id}" aria-pressed="${v.me.vote === id}"><span>${x.icon}</span>${x.label}<small>+${POINTS[id]}</small></button>`)
          .join('')}
      </div>`;
  }

  /** Handy: Antworten bewerten (alle gleichzeitig) */
  function likeListHtml(v) {
    const c = v.cur;
    const rows = c.answers
      .map((a) => {
        if (a.mine) return `<li class="like-row is-mine"><span>„${esc(a.text)}“</span><small>deine</small></li>`;
        return `<li class="like-row ${a.liked ? 'on' : ''}"><span>„${esc(a.text)}“</span><button class="like-btn ${a.liked ? 'on' : ''}" data-act="like" data-i="${a.i}" aria-pressed="${a.liked}" aria-label="Stimmt">👍</button></li>`;
      })
      .join('');
    return `
      <p class="note center">Welche Antworten stimmen? 👍 antippen – dann „Fertig“.</p>
      <ul class="like-list">${rows}</ul>
      ${v.me.done ? '<p class="waiting">✔ Fertig – warte auf die anderen …</p>' : '<button class="btn btn-primary btn-big btn-wide" data-act="done">✔ Fertig</button>'}`;
  }

  /** Handy: Audio stoppt */
  function phoneAudioHtml(v) {
    const c = v.cur;
    const t = turnTeam(v);
    const all = c.turn === null;
    const mine = v.me.turn;
    let body;
    if (v.phase === 'play') {
      if (all) body = `<p class="turn">🔊 Gut zuhören …</p><p class="note center">Gleich stoppt die Musik – dann tippt alle, wie es weitergeht.</p>${answerFormHtml(v)}`;
      else if (mine) body = `<div class="big-turn">🎤</div><p class="turn">${answerOf(v.settings) === 'teams' ? 'Ihr seid' : 'Du bist'} dran!</p><p class="note center">Gut zuhören – gleich stoppt die Musik und ${answerOf(v.settings) === 'teams' ? 'ihr singt' : 'du singst'} weiter.</p>`;
      else body = `<p class="turn"><b style="${teamStyle(t)}">${esc(t.name)}</b> ist dran</p><p class="note center">🔊 Gut zuhören – gleich wird weitergesungen.</p>`;
    } else if (v.phase === 'sing') {
      if (all) body = `<p class="turn sing-now">⌨️ Jetzt tippen!</p>${countdownHtml(c)}${answerFormHtml(v)}`;
      else if (mine) body = `<div class="big-turn is-live">🎤</div><p class="turn sing-now">Jetzt weitersingen – laut!</p>${countdownHtml(c)}`;
      else body = `<p class="turn"><b style="${teamStyle(t)}">${esc(t.name)}</b> singt weiter …</p>${countdownHtml(c)}<p class="note center">Gleich bewertest du, ob es stimmt.</p>`;
    } else if (all) {
      body = v.me.voter ? likeListHtml(v) : '<p class="waiting">⌛ Die anderen bewerten …</p>';
    } else if (v.me.voter) {
      body = `
        <p class="turn">Hat <b style="${teamStyle(t)}">${esc(t.name)}</b> richtig weitergesungen?</p>
        <p class="note center">▶ Hör auf den Laptop – der Song läuft weiter.</p>
        ${voteButtonsHtml(v)}
        ${v.me.vote ? `<p class="waiting">✔ Abgestimmt – ändern geht noch. ${c.voted}/${c.voters}</p>` : ''}`;
    } else if (mine) {
      body = `<p class="turn">▶ Hört zu, ob es stimmte …</p><p class="waiting">⌛ Die anderen stimmen ab (${c.voted}/${c.voters})</p>`;
    } else body = '<p class="waiting">⌛ Es wird abgestimmt …</p>';
    return `
      <div class="phone-song">${songCardHtml(c.song)}</div>
      ${body}
      ${leadControlsHtml(v)}`;
  }

  /** Handy beim Ansingen (alle außer der Ansänger/in) */
  function phoneSingHtml(v) {
    const c = v.cur;
    const name = esc(c.singerName);
    if (v.phase === 'pick') {
      return `
        <div class="phone-center">
          <div class="sing-mic" aria-hidden="true">🎙️</div>
          <h2 class="turn"><b>${name}</b> sucht sich einen Song aus …</h2>
          <p class="note">Gleich wird angesungen. Gut hinhören!</p>
        </div>`;
    }
    let body;
    if (v.phase === 'buzzed') {
      const b = c.buzz;
      body = b.pid === v.me.id ? `<div class="buzzed-me"><p class="buzz-who">✋ Du bist dran!</p><p class="buzz-say">Sing <b>laut</b> weiter!</p></div>` : `<div class="buzzed-me"><p class="buzz-who">✋ ${esc(b.name)}</p><p class="note">singt gerade weiter …</p></div>`;
    } else if (v.me.team === c.singerTeam) body = `<p class="waiting">🎙️ ${name} ist aus deinem Team – diesmal hörst du zu.</p>`;
    else if (c.out.includes(v.me.team)) body = '<p class="waiting">❌ Für diesen Song bist du raus.</p>';
    else body = `<div class="buzzer-wrap"><button class="buzzer" data-act="buzz" aria-label="Ich kann weitersingen">✋<small>Ich kann weitersingen!</small></button></div>`;
    return `
      <h2 class="turn">🎙️ ${name} singt an</h2>
      ${countdownHtml(c)}
      ${body}
      ${leadControlsHtml(v)}`;
  }

  /** Handy der Ansänger/in: Song aussuchen, dann ansingen und bestätigen */
  function phoneSingerHtml(v) {
    const c = v.cur;
    if (v.phase === 'pick') {
      const opts = (c.options || []).map((s) => `<button class="pick-song" data-act="pick-song" data-id="${esc(s.id)}"><b>${esc(s.title)}</b><span>${esc(s.artist)}</span></button>`).join('');
      return `
        <section class="sing-card">
          <h2>🎙️ Du singst an!</h2>
          <p class="dj-warn">Nicht verraten – Handy nicht zeigen 🙈</p>
          <p class="note">Such dir einen Song aus, dessen Text du gut kennst:</p>
          <div class="pick-list">${opts}</div>
          <button class="btn btn-ghost btn-wide" data-act="reroll">↻ Kenn ich nicht – andere Songs</button>
        </section>`;
    }
    return `
      <section class="sing-card">
        <h2>🎙️ Jetzt ansingen!</h2>
        ${c.song ? `<div class="dj-song"><b>${esc(c.song.title)}</b><span>${esc(c.song.artist)}</span></div>` : ''}
        <p class="dj-warn">Eine Zeile anfangen und mittendrin aufhören!</p>
        ${countdownHtml(c)}
        ${
          v.phase === 'buzzed'
            ? `<div class="buzzed-me"><p class="buzz-who">✋ ${esc(c.buzz.name)}</p><p class="note">singt weiter – stimmt’s?</p>
                <div class="judge judge-phone">
                  <button class="btn btn-good btn-big btn-wide" data-act="judge" data-ok="yes">✅ Stimmt! <small>+${SING_HIT}</small></button>
                  <button class="btn btn-danger btn-wide" data-act="judge" data-ok="no">❌ Falsch</button>
                </div></div>`
            : '<p class="note">Wer weitersingen kann, drückt ✋ – dann entscheidest du.</p><button class="btn btn-ghost btn-wide" data-act="resolve">🏳️ Niemand weiß es</button>'
        }
      </section>`;
  }

  function phoneRevealHtml(v) {
    const l = v.last;
    let me = '';
    const myTeam = v.me.team;
    const mine = l.results.filter((r) => r.team === myTeam);
    const got = mine.reduce((a, r) => a + r.points, 0);
    if (l.kind === 'sing' && l.singer === v.me.id) me = l.hit ? `<p class="feedback is-right big">🎙️ Jemand wusste es! +${SING_SINGER}</p>` : '<p class="feedback is-wrong big">🎙️ Niemand konnte weitersingen.</p>';
    else if (got > 0) me = `<p class="feedback is-right big">✅ +${got}</p>`;
    else if (l.kind === 'audio' && (l.all ? mine.some((r) => r.text || r.verdict) : l.turn === myTeam)) me = '<p class="feedback is-wrong big">👎 Diesmal nicht.</p>';
    return `
      <section class="stage">
        ${songCardHtml(l.song, { year: true, cls: 'is-big' })}
        ${me}
        ${resultsHtml(v)}
      </section>
      ${scoresHtml(v, true)}
      ${v.me.lead ? `<div class="go"><button class="btn btn-primary btn-big btn-wide" data-act="next">${nextLabel(v)}</button></div>` : '<p class="waiting">⌛ Gleich geht’s weiter …</p>'}`;
  }

  /* ------------------------------------------------------------------ */
  /* Fenster                                                             */
  /* ------------------------------------------------------------------ */

  function rulesHtml() {
    return `
      <h2>📖 So geht’s</h2>
      <h3>🔊 Audio stoppt</h3>
      <ol class="rules">
        <li>Der Laptop spielt einen Song – und <b>stoppt mitten in der Zeile</b>.</li>
        <li>Wer dran ist (Team oder Person), <b>singt weiter</b> – 10, 15 oder 20 Sekunden.</li>
        <li><b>Auflösung:</b> Der Song läuft ab der Stelle weiter, alle hören, ob es stimmte.</li>
        <li>Die anderen stimmen am Handy ab: <b>👍 richtig ${POINTS.yes}</b> · <b>🤏 fast ${POINTS.close}</b> · <b>👎 falsch ${POINTS.no}</b>.
            Mehrheit entscheidet, Gleichstand = 🤏. Die Spielleitung (oder der Laptop) kann überstimmen – nicht fürs eigene Team.</li>
        <li><b>⌨️ Alle gleichzeitig:</b> Alle tippen die Fortsetzung, danach sieht jede/r die Antworten (ohne Namen) und vergibt 👍.
            Mehr als die Hälfte 👍 = richtig, mindestens ein 👍 = fast. Am lustigsten bei Verhörern!</li>
      </ol>
      <h3>🎙️ Ansingen</h3>
      <ol class="rules">
        <li>Reihum sucht sich eine Person einen von ${E.SING_OPTIONS} Songs aus („Kenn ich nicht“ bringt neue) und <b>singt eine Zeile an</b> – und hört mittendrin auf.</li>
        <li>Wer weitersingen kann, drückt <b>✋</b> und singt laut weiter. Die Ansänger/in bestätigt ✅ oder ❌.</li>
        <li>Treffer <b>${SING_HIT}</b> Punkte, die Ansänger/in bekommt <b>${SING_SINGER}</b>, wenn es jemand wusste. Falsch → für diesen Song raus. ${SING_MS / 1000} s Zeit.</li>
      </ol>
      <h3>Ende</h3>
      <ul class="rules-tips">
        <li>🏆 Nach 10, 15 oder 20 Songs (aufgerundet auf volle Runden) gewinnen die meisten Punkte.</li>
        <li>🖥️ <b>Ein Gerät:</b> reihum, die Runde entscheidet gemeinsam am Laptop.</li>
        <li>🔒 Songtexte speichert das Spiel nicht – ihr singt selbst. Die Ausschnitte stammen aus Apple Music („In Apple Music öffnen“).</li>
      </ul>`;
  }

  /** Ein Gerät: Songs bzw. der ausgesuchte Song nur für die Ansänger/in */
  function peekHtml(v) {
    const c = v.cur;
    if (!c || c.kind !== 'sing') return '';
    const name = esc(c.singerName);
    if (v.phase === 'pick') {
      const opts = (c.options || []).map((s) => `<button class="pick-song" data-act="pick-song" data-id="${esc(s.id)}"><b>${esc(s.title)}</b><span>${esc(s.artist)}</span></button>`).join('');
      return `
        <h2>🎙️ Nur für ${name}</h2>
        <p class="dj-warn">Alle anderen: wegschauen! 🙈</p>
        <p class="note">Such dir einen Song aus, dessen Text du gut kennst:</p>
        <div class="pick-list">${opts}</div>
        <button class="btn btn-ghost btn-wide" data-act="reroll">↻ Kenn ich nicht – andere Songs</button>`;
    }
    if (!c.song) return '';
    return `
      <h2>🎙️ Nur für ${name}</h2>
      <div class="dj-song"><b>${esc(c.song.title)}</b><span>${esc(c.song.artist)}</span></div>
      <p class="dj-warn">Eine Zeile anfangen und mittendrin aufhören!</p>
      <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">✔ Verstecken</button></div>`;
  }

  /** Gesammelte Stoppstellen: Liste zum Kopieren in finish-the-lyrics/js/stops.js */
  function stopsHtml() {
    const list = Stops.collected();
    const ids = Object.keys(list).sort((a, b) => (list[b].at || 0) - (list[a].at || 0));
    const rows = ids
      .map((id) => `<li><span><b>${esc(list[id].title)}</b> – ${esc(list[id].artist)}</span><span class="stop-secs">${secsText(list[id].secs)}</span><button class="icon-btn" data-act="forget-stop" data-id="${esc(id)}" aria-label="Stelle löschen">✕</button></li>`)
      .join('');
    return `
      <h2>📍 Gesammelte Stoppstellen</h2>
      <p class="note">Gelten in diesem Browser sofort. Für alle: Liste kopieren und in <code>finish-the-lyrics/js/stops.js</code> bei <code>STOPS</code> einfügen.</p>
      ${
        ids.length
          ? `<ul class="stop-list">${rows}</ul>
             <textarea class="stop-export" readonly rows="${Math.min(8, ids.length + 1)}" id="stop-export">${esc(Stops.exportText())}</textarea>
             <div class="modal-actions">
               <button class="btn btn-ghost" data-act="clear-stops">🗑️ Alle löschen</button>
               <button class="btn btn-primary" data-act="copy-stops">📋 Kopieren</button>
             </div>`
          : '<p class="note">Noch keine – während ein Ausschnitt läuft, auf „📍 Hier wäre eine gute Stelle“ klicken.</p>'
      }`;
  }

  function menuHtml() {
    const v = ui.view;
    const stage = ui.screen === 'stage';
    const playing = v && v.phase !== 'lobby' && v.phase !== 'end';
    const stops = Object.keys(Stops.collected()).length;
    return `
      <h2>Menü</h2>
      <div class="menu">
        <button class="btn btn-ghost btn-wide" data-act="mute">${Sound.muted ? '🔊 Ton einschalten' : '🔇 Ton ausschalten'}</button>
        <button class="btn btn-ghost btn-wide" data-act="rules">📖 Spielregeln</button>
        ${stage && v && v.room && v.room.code ? '<button class="btn btn-ghost btn-wide" data-act="show-qr">📱 Handys einladen</button>' : ''}
        ${stage ? `<button class="btn btn-ghost btn-wide" data-act="show-stops">📍 Gesammelte Stellen (${stops})</button>` : ''}
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
    else if (ui.modal === 'stops') body = stopsHtml();
    else if (ui.modal === 'peek' && v && v.me.stage) body = peekHtml(v);
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
        // Countdown und Ausschnitt-Leiste setzt liveLoop() direkt
        if (fromEl.dataset && fromEl.dataset.live && toEl.dataset && toEl.dataset.live === fromEl.dataset.live) return false;
        return true;
      },
    });
    if (ui.focus) {
      const el = app.querySelector(ui.focus);
      ui.focus = null;
      if (el) el.focus();
    }
  }

  /** Countdown und Ausschnitt-Fortschritt flüssig nachführen */
  let lastSecond = null;
  let wasPlaying = false;
  function liveLoop() {
    const v = ui.view;
    const c = v && v.cur;
    const cd = app.querySelector('[data-live="countdown"]');
    if (cd && c && c.left !== null && c.paused == null) {
      const left = Math.max(0, c.left - (performance.now() - ui.viewAt));
      const bar = cd.querySelector('span');
      if (bar) bar.style.width = `${((100 * left) / c.total).toFixed(1)}%`;
      const num = cd.querySelector('b');
      const sec = Math.ceil(left / 1000);
      if (num && num.textContent !== String(sec)) num.textContent = String(sec);
      cd.classList.toggle('is-low', left < 3500);
      // Ticken in den letzten Sekunden (nur am Laptop)
      if (ui.screen === 'stage' && left > 0 && sec <= 3 && sec !== lastSecond) Sound.tick(sec === 1);
      lastSecond = sec;
    }
    const track = app.querySelector('[data-live="track"]');
    if (track && ui.screen === 'stage' && c && c.kind === 'audio') {
      const p = Player.position();
      if (p !== null) track.style.width = `${Math.min(100, (100 * p) / SNIPPET_SECS).toFixed(1)}%`;
    }
    // „📍“-Knopf erscheint/verschwindet mit der Wiedergabe
    const playing = Player.snip.playing;
    if (playing !== wasPlaying) {
      wasPlaying = playing;
      if (ui.screen === 'stage') render();
    }
    requestAnimationFrame(liveLoop);
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

  function unlockAudio() {
    Sound.unlock();
    Player.snip.unlock();
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
    // Erster Klick: Ton freischalten, damit der Ausschnitt gleich spielen darf
    unlockAudio();
    startStage({ state });
  }

  function sendAnswer() {
    const t = String(ui.answer || '').trim();
    if (!t) return;
    dispatch('answer', { text: t });
    ui.answer = '';
    vibrate(30);
    render();
  }

  /** Stoppstelle merken (Laptop) */
  function markStop() {
    const v = ui.view;
    const p = Player.position();
    if (!v || !v.cur || v.cur.kind !== 'audio' || p === null) return;
    if (Stops.mark(v.cur.song, p)) toast(`📍 ${secsText(p)} bei „${v.cur.song.title}“ gemerkt`);
    else toast(`📍 ${secsText(p)} geht nicht – die Stelle muss zwischen ${Stops.MIN_STOP} und ${Stops.MAX_STOP} s liegen`);
  }

  async function copyStops() {
    const text = Stops.exportText();
    try {
      await navigator.clipboard.writeText(text);
      toast('📋 Kopiert');
    } catch {
      const el = app.querySelector('#stop-export');
      if (el) {
        el.select();
        toast('Markiert – jetzt Strg+C');
      }
    }
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
      Player.snip.setMuted(Sound.muted);
      render();
    },
    'resume-stage': () => {
      const g = savedGames().stage;
      if (g) {
        unlockAudio();
        startStage({ state: g.state, code: g.code, key: g.key });
      }
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
    'show-stops': () => {
      ui.modal = 'stops';
      render();
    },
    start: () => {
      unlockAudio();
      dispatch('start');
    },
    kick: (el) => dispatch('kick', { player: el.dataset.player }),
    'move-team': (el) => {
      const m = ui.view.members.find((x) => x.id === el.dataset.player);
      if (m) dispatch('team', { player: m.id, team: ((m.team === null ? -1 : m.team) + 1) % ui.view.settings.teams });
    },
    team: (el) => dispatch('team', { team: +el.dataset.team }),
    replay: () => dispatch('replay'),
    resolve: () => dispatch('resolve'),
    replace: () => {
      const v = ui.view;
      if (v && v.cur && v.cur.song) dispatch('replace', { id: v.cur.song.id });
    },
    'audio-retry': () => {
      if (ui.view && ui.view.cur && ui.view.cur.song) Player.sync(ui.view);
      render();
    },
    'audio-unlock': () => {
      unlockAudio();
      // <audio>-Ausweg: nochmal starten
      Player.played = null;
      if (ui.view) Player.sync(ui.view);
      render();
    },
    mark: markStop,
    'forget-stop': (el) => {
      Stops.forget(el.dataset.id);
      render();
    },
    'clear-stops': () => {
      Stops.clear();
      render();
    },
    'copy-stops': copyStops,
    vote: (el) => {
      vibrate(25);
      dispatch('vote', { verdict: el.dataset.verdict });
    },
    verdict: (el) => dispatch('verdict', { verdict: el.dataset.verdict }),
    /** Laptop, alle gleichzeitig: Antwort überstimmen 👍 → 🤏 → 👎 → wieder nach 👍 zählen */
    cycle: (el) => {
      const v = ui.view;
      const a = v && v.cur && v.cur.answers ? v.cur.answers.find((x) => x.i === +el.dataset.i) : null;
      if (!a) return;
      const seq = [null, 'yes', 'close', 'no'];
      dispatch('verdict', { i: a.i, verdict: seq[(seq.indexOf(a.override) + 1) % seq.length] });
    },
    like: (el) => {
      vibrate(15);
      dispatch('like', { i: +el.dataset.i });
    },
    done: () => dispatch('done'),
    count: () => dispatch('count'),
    'stage-buzz': (el) => dispatch('buzz', { team: +el.dataset.team }),
    buzz: () => {
      vibrate(30);
      dispatch('buzz');
    },
    judge: (el) => dispatch('judge', { ok: el.dataset.ok === 'yes' }),
    peek: () => {
      ui.modal = 'peek';
      render();
    },
    'pick-song': (el) => {
      dispatch('pick', { id: el.dataset.id });
      if (ui.modal === 'peek') ui.modal = null;
      render();
    },
    reroll: () => dispatch('reroll'),
    skipsing: () => dispatch('skipsing'),
    next: () => {
      unlockAudio();
      dispatch('next', { no: ui.view ? ui.view.no : undefined });
    },
    again: () => {
      unlockAudio();
      dispatch('again');
    },
    lobby: () => dispatch('lobby'),
    'end-game': () => dispatch('end'),
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
    if (ui.screen === 'stage') Player.snip.unlock();
    if (!['close-modal-bg', 'mute', 'buzz'].includes(act)) Sound.click();
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
    else if (f === 'answer') {
      ui.answer = el.value;
      render();
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
    } else if (form.dataset.form === 'answer') {
      const input = form.querySelector('input');
      if (input) input.value = '';
      sendAnswer();
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
    // Laptop: Leertaste = nochmal bis zur Stelle, Enter = auflösen / weiter, 1–3 = 👍🤏👎 (ein Gerät), 1–9 = wer weitersingt
    const v = ui.view;
    if (e.target !== document.body || ui.modal || !v || ui.screen !== 'stage') return;
    const c = v.cur;
    const one = v.settings.input === 'one';
    if (c && c.kind === 'sing' && v.phase === 'play' && one && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      dispatch('buzz', { team: Number(e.key) - 1 });
    } else if (c && c.kind === 'audio' && v.phase === 'vote' && one && /^[1-3]$/.test(e.key)) {
      e.preventDefault();
      dispatch('verdict', { verdict: ['yes', 'close', 'no'][Number(e.key) - 1] });
    } else if (c && c.kind === 'audio' && ['play', 'sing'].includes(v.phase) && e.key === ' ') {
      e.preventDefault();
      dispatch('replay');
    } else if (c && c.kind === 'audio' && v.phase === 'sing' && e.key === 'Enter') {
      e.preventDefault();
      dispatch('resolve');
    } else if (v.phase === 'reveal' && e.key === 'Enter') {
      e.preventDefault();
      actions.next();
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

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.FTL_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  requestAnimationFrame(liveLoop);
  autoResume();

  // für Tests
  window.FTLApp = { ui, render: renderNow, actions, Player };
})();
