/*
 * Oberfläche von „Guess the song“.
 *  - Laptop („Bühne“ und Lautsprecher): Spiel anlegen, Lobby mit QR-Code, Ausschnitte Stufe für Stufe abspielen,
 *    Ratezeit, Buzz bestätigen (Lösung aufdecken), Summen, Auflösung mit Cover, Siegerehrung mit Playlist.
 *    Ein Gerät: Hier wird angetippt, wer zuerst gerufen hat; die Summer/in schaut kurz allein auf den Laptop.
 *  - Handy: Titel tippen (mit Vorschlägen) oder Buzzer, Summen (Song aussuchen), Spielleitung steuert mit.
 * Gerendert wird per HTML-String + morphdom. Countdown und Stufen-Fortschritt bewegen sich direkt im DOM (data-live).
 */
(function () {
  'use strict';

  const E = window.GTSEngine;
  const { Engine, COUNTS, MIN_PLAYERS, HUM_MIN_PLAYERS, MAX_PLAYERS, MAX_NAME, MIN_POOL, MAX_TRIES, FIRST_BONUS, HUM_FIRST, HUM_MORE, HUM_HUMMER, HUM_MS, GUESS_MS, SIPS_NOBODY, SIPS_GIVE, STEP_SETS, sanitizeSettings, cleanName } = E;
  const { StageController, ClientController, Store, KEYS, Net, inviteLink, qrSvg } = window.GTSControllers;
  const Songs = window.Songs;
  const Titles = window.GameTitles;
  const AudioSource = window.AudioSource;
  const { Sound, confetti } = window.GameFx;

  const INPUT = {
    phones: { icon: '📱', label: 'Mit Handys', text: 'Geraten wird am Handy – tippen oder Buzzer. Der Laptop ist Bühne und Lautsprecher.' },
    one: { icon: '🖥️', label: 'Ein Gerät', text: 'Alle sitzen um den Laptop und rufen. Angetippt wird, wer zuerst gerufen hat.' },
  };
  const MODE = {
    snip: { icon: '🔊', label: 'Ausschnitte', text: '1 s, 2 s, 4 s … vom Laptop – braucht Internet' },
    hum: { icon: '🎤', label: 'Summen', text: 'reihum summt eine Person – ganz ohne Ton' },
    mixed: { icon: '🔀', label: 'Abwechselnd', text: 'ein Ausschnitt, dann wird gesummt …' },
  };
  const GUESS = {
    type: { icon: '⌨️', label: 'Tippen', text: 'Titel oder Interpret am Handy, mit Vorschlägen' },
    buzz: { icon: '🔔', label: 'Buzzer', text: 'drücken und laut sagen – der Laptop bestätigt' },
  };
  const STEPS = {
    classic: { label: '1 · 2 · 4 · 8 · 16 · 30 s', text: 'Standard' },
    easy: { label: '2 · 5 · 10 · 30 s', text: 'leichter' },
  };
  const ARTIST = {
    half: { label: 'halb', text: 'nur Interpret = halbe Punkte' },
    full: { label: 'voll', text: 'Interpret reicht' },
    none: { label: 'nein', text: 'nur der Titel zählt' },
  };
  const START = {
    chorus: { icon: '🎶', label: 'Refrain', text: 'leicht – meist die bekannteste Stelle' },
    random: { icon: '🎲', label: 'Zufällig', text: 'schwer – irgendwo im Ausschnitt' },
  };
  const HUM = {
    hum: { icon: '🎤', label: 'Summen', verb: 'summt', how: 'Nur summen – keine Worte!' },
    whistle: { icon: '😗', label: 'Pfeifen', verb: 'pfeift', how: 'Nur pfeifen – keine Worte!' },
    knock: { icon: '🥁', label: 'Klopfen', verb: 'klopft', how: 'Nur den Rhythmus klopfen – sehr schwer!' },
    mime: { icon: '🙊', label: 'Pantomime', verb: 'spielt vor', how: 'Ohne Ton – nur Gesten zum Song!' },
  };
  const LEVEL = {
    easy: { icon: '🙂', label: 'Bekannt', text: 'nur Hits, die jede/r kennt' },
    mixed: { icon: '🎶', label: 'Gemischt', text: 'Hits und Bekanntes' },
    all: { icon: '🎲', label: 'Alle', text: 'auch Raritäten' },
    hard: { icon: '🤓', label: 'Kenner', text: 'ohne die größten Hits' },
  };
  const SUGGEST_MAX = 5;

  const SETUP_KEY = 'guessthesong.setup.v1';
  const PREFS_KEY = 'guessthesong.prefs.v1';
  const USED_KEY = 'guessthesong.used.v1';
  const ACTIVE_KEY = 'guessthesong.active';
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

  function secsLabel(n) {
    return `${n} ${plural(n, 'Sekunde', 'Sekunden')}`;
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

  function hum(v) {
    return HUM[v.settings.hum] || HUM.hum;
  }

  /** Alle Songs für die Vorschläge beim Tippen (ganze Datenbank, nicht nur die Auswahl) */
  let allSongs = null;
  function songList() {
    if (!allSongs) allSongs = Songs.list();
    return allSongs;
  }

  function suggestions(text) {
    const list = Titles.suggest(text, songList(), SUGGEST_MAX);
    return list.map((title) => {
      const artists = songList()
        .filter((s) => s.title === title)
        .map((s) => s.artist);
      return { title, artist: artists.slice(0, 2).join(' / ') };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Speicher                                                            */
  /* ------------------------------------------------------------------ */

  function loadSetup() {
    const s = Store.get(SETUP_KEY) || {};
    const names = Array.isArray(s.names) ? s.names.map((n) => String(n || '').slice(0, MAX_NAME)).slice(0, MAX_PLAYERS) : [];
    while (names.length < HUM_MIN_PLAYERS) names.push('');
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
    modal: null, // rules | menu | quit | qr | settings | peek
    guess: '', // Handy: getippter Titel
    guessKey: null,
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
  /* Ton am Laptop (iTunes-Ausschnitte, Stufe für Stufe)                 */
  /* ------------------------------------------------------------------ */

  const Player = {
    snip: new window.GameSnippet.Snippet(),
    hits: {}, // id → iTunes-Treffer (Cover, Store-Link)
    finds: {}, // id → Promise
    state: {}, // id → loading | ready | missing | error
    clips: {}, // id → geladener Ausschnitt
    played: null, // zuletzt gestartet: "id:playId" bzw. "id:reveal"
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

    /** Bühne: passt der Ton zur Ansicht? */
    sync(v) {
      this.snip.setMuted(Sound.muted);
      if (v.nextSong) this.find(v.nextSong).catch(() => {});
      const c = v.cur;
      const song = c && c.kind === 'snip' ? c.song : null;
      if (!song || !['play', 'buzzed', 'reveal'].includes(v.phase)) {
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
      if (v.phase === 'buzzed') {
        if (this.snip.playing) this.stop();
        return;
      }
      if (v.phase === 'play') {
        const key = `${id}:${c.playId}`;
        if (this.played === key) return;
        this.played = key;
        const playId = c.playId;
        this.snip.play(clip, c.offset, c.steps[c.step], () => {
          if (ui.view && ui.view.phase === 'play' && ui.view.cur && ui.view.cur.playId === playId) dispatch('heard', { playId });
          render();
        });
        render();
        return;
      }
      // Auflösung: der Ausschnitt läuft weiter bis zum Ende
      const key = `${id}:reveal`;
      if (this.played === key) return;
      this.played = key;
      this.snip.play(clip, c.offset, 30, () => render());
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
    if (ui.guessKey !== key) {
      ui.guessKey = key;
      ui.guess = '';
      if (ui.modal === 'peek') ui.modal = null;
    }
    // eigenes Ergebnis am Handy
    const fbWas = prev && prev.me && prev.me.fb ? prev.me.fb.at : null;
    if (!v.me.stage && v.me.fb && v.me.fb.at !== fbWas && prev && prev.no === v.no) {
      const r = v.me.fb.result;
      if (r === 'title' || r === 'artist') {
        Sound.success();
        vibrate([40, 30, 40]);
      } else if (r === 'no') {
        Sound.fail();
        vibrate(120);
      }
    }
    if (v.phase === 'buzzed' && was !== 'buzzed') {
      Sound.buzzer();
      if (!v.me.stage && v.cur && v.cur.buzz && v.cur.buzz.pid === v.me.id) vibrate([80, 40, 80]);
    }
    if (was === v.phase) return;
    if (v.phase === 'pick' && !v.me.stage && v.me.hummer) vibrate([60, 40, 60]);
    if (v.phase === 'reveal' && v.last) {
      Sound.flip();
      const mine = v.me.stage ? !v.last.nobody : v.me.team !== null && v.last.results[v.me.team] && v.last.results[v.me.team].points > 0;
      setTimeout(() => (mine ? Sound.success() : Sound.fail()), 380);
      if (ui.modal === 'peek') ui.modal = null;
    }
    if (v.phase === 'end' && was && was !== 'end') {
      Sound.fanfare();
      confetti(['#38bdf8', '#a855f7', '#fbbf24', '#f472b6', '#fff']);
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

  function eqSvg(cls) {
    return `
      <svg class="eq ${cls || ''}" viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <linearGradient id="gts-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#38bdf8" />
            <stop offset="1" stop-color="#a855f7" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r="56" fill="#111a33" stroke="url(#gts-ring)" stroke-width="5" />
        <g fill="#fbbf24">
          <rect class="eq-bar b1" x="28" y="44" width="9" height="32" rx="4.5" />
          <rect class="eq-bar b2" x="43" y="30" width="9" height="60" rx="4.5" />
          <rect class="eq-bar b3" x="58" y="38" width="9" height="44" rx="4.5" />
          <rect class="eq-bar b4" x="73" y="26" width="9" height="68" rx="4.5" />
          <rect class="eq-bar b5" x="88" y="46" width="9" height="28" rx="4.5" />
        </g>
      </svg>`;
  }

  function logoHtml(small) {
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="Guess the song"><span class="logo-text">Guess <i>the</i> <span>song</span></span></div>`;
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

  /** Countdown der Ratezeit (läuft per data-live weiter) */
  function countdownHtml(c) {
    if (!c) return '';
    if (c.paused !== null && c.paused !== undefined) return `<div class="countdown is-paused"><span style="width:${(100 * c.paused) / c.total}%"></span></div>`;
    if (c.left === null || c.left === undefined) return '';
    const left = Math.max(0, c.left - (performance.now() - ui.viewAt));
    return `<div class="countdown" data-live="countdown" data-total="${c.total}"><span style="width:${(100 * left) / c.total}%"></span><b>${Math.ceil(left / 1000)}</b></div>`;
  }

  /** Stufen-Leiste: 1s 2s 4s … – gehörte Stufen voll, die laufende mit Fortschritt */
  function stepsHtml(c, live) {
    const secs = c.steps;
    let prev = 0;
    const segs = secs
      .map((x, i) => {
        const w = Math.max(0.6, x - prev);
        prev = x;
        const cls = i < c.step ? 'is-heard' : i === c.step ? 'is-now' : '';
        const fill = i === c.step ? `<span class="seg-fill" ${live ? 'data-live="seg"' : ''} style="width:${c.heard ? 100 : 0}%"></span>` : '';
        return `<div class="seg ${cls}" style="flex-grow:${w}">${fill}<small>${x} s</small></div>`;
      })
      .join('');
    return `<div class="steps" aria-label="Stufe ${c.step + 1} von ${secs.length}">${segs}</div>`;
  }

  function hintHtml(c) {
    if (!c || !c.hint) return '';
    return `<p class="hint">💡 Hinweis: <b>${esc(c.hint.decade)}</b> · Interpret beginnt mit <b>„${esc(c.hint.initial)}“</b></p>`;
  }

  /** Stand aller Teams beim laufenden Song: Treffer, raus, Versuche */
  function chipsHtml(v, opts) {
    const c = v.cur;
    if (!c) return '';
    const o = opts || {};
    const typing = v.settings.input === 'phones' && v.settings.guess === 'type';
    const rows = v.teams
      .map((t, i) => {
        const r = c.res[i];
        if (!r) return '';
        if (!r.may && !r.hit && !r.partial) {
          if (c.kind === 'hum' && i === c.hummerTeam && t.members.length === 1) return `<li class="chip-team is-hummer" style="${teamStyle(t)}"><i class="dot"></i>${esc(t.name)} <span>${hum(v).icon}</span></li>`;
          return '';
        }
        let state;
        if (r.hit) state = `<b class="ok">✅ +${r.points}</b>${r.first && c.kind === 'snip' ? ' <span title="Schnellste/r">⚡</span>' : ''}`;
        else if (r.partial) state = `<b class="part">🎤 +${r.points}</b>`;
        else if (r.out) state = '<b class="no">❌</b>';
        else if (typing && r.tries) state = `<span class="tries">${'●'.repeat(MAX_TRIES - r.tries)}${'○'.repeat(r.tries)}</span>`;
        else state = '<span class="wait">…</span>';
        const btn = o.buzz && !r.done && r.may;
        const key = i < 9 ? `<kbd>${i + 1}</kbd>` : '';
        if (btn) return `<li><button class="chip-team is-btn" style="${teamStyle(t)}" data-act="stage-buzz" data-team="${i}">${key}<i class="dot"></i>${esc(t.name)}</button></li>`;
        return `<li class="chip-team ${r.hit ? 'is-hit' : r.out ? 'is-out' : ''}" style="${teamStyle(t)}"><i class="dot"></i>${esc(t.name)} ${state}</li>`;
      })
      .join('');
    return `<ul class="chips ${o.buzz ? 'chips-buzz' : ''}">${rows}</ul>`;
  }

  /** Punktestand (sortiert) */
  function scoresHtml(v, small) {
    const rows = v.teams
      .map((t, i) => ({ t, i }))
      .sort((a, b) => b.t.points - a.t.points || a.i - b.i)
      .map(({ t, i }) => `<li class="${v.tiebreak && v.tiebreak.includes(i) ? 'is-tie' : ''}" style="${teamStyle(t)}"><i class="dot"></i><span>${esc(t.name)}</span><b>${t.points}</b></li>`)
      .join('');
    return `<ol class="scores ${small ? 'scores-small' : ''}">${rows}</ol>`;
  }

  function songNoLabel(v) {
    if (v.tiebreak && v.no > v.count) return `⚖️ Stechen ${v.no - v.count}`;
    return `Song ${v.no}/${v.count}`;
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
        ${art ? `<img class="cover" src="${esc(art)}" alt="" />` : o.art ? `<div class="cover cover-empty">${eqSvg()}</div>` : ''}
        <div class="song-body">
          <b class="song-title">${esc(song.title)}</b>
          <span class="song-artist">${esc(song.artist)}</span>
          ${o.year ? `<span class="song-year">${song.year}</span>` : ''}
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Start und Spiel anlegen                                             */
  /* ------------------------------------------------------------------ */

  function homeHtml() {
    const saves = savedGames();
    const resume = [];
    if (saves.stage) {
      const st = saves.stage.state;
      const who = st.phase === 'lobby' ? 'Lobby' : `Song ${st.no}/${st.settings.count} · ${st.teams.map((t) => t.name).join(', ')}`;
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
        <div class="home-eq">${eqSvg('dance')}</div>
        ${logoHtml()}
        <p class="tagline">Erst <b>1 Sekunde</b>, dann 2, dann 4 …<br>wer erkennt den Song zuerst? Oder: eine Person <b>summt</b>.</p>
        <div class="home-steps" aria-hidden="true">${[1, 2, 4, 8, 16, 30].map((x, i) => `<span style="--i:${i}">${x}s</span>`).join('')}</div>
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
      <p class="home-foot">${MIN_PLAYERS}–${MAX_PLAYERS} Personen oder Teams · ${Songs.list().length} Songs von ${Songs.MIN_YEAR} bis heute</p>
    </div>`;
  }

  /** Einstellungen – im Setup (scope 'setup') und in der Lobby (scope 'lobby', geht an die Engine) */
  function settingsHtml(st, scope) {
    const songs = E.pool(st).length;
    const perDecade = {};
    for (const x of E.pool(Object.assign({}, st, { decades: [] }))) perDecade[x.decade] = (perDecade[x.decade] || 0) + 1;
    const perCat = {};
    for (const x of Songs.filter({ level: st.level, decades: st.decades })) perCat[x.cat] = (perCat[x.cat] || 0) + 1;
    const snips = st.mode !== 'hum';
    const hums = st.mode !== 'snip';
    const phones = st.input === 'phones';
    return `
      <section class="panel">
        <h2>Modus</h2>
        <div class="choices choices-3">${Object.entries(MODE)
          .map(([id, m]) => choice(scope, 'mode', id, `${m.icon} ${m.label}`, st.mode === id, `<small>${m.text}</small>`))
          .join('')}</div>
        ${
          phones
            ? `<h2>Raten</h2>
               <div class="choices choices-2">${Object.entries(GUESS)
                 .map(([id, g]) => choice(scope, 'guess', id, `${g.icon} ${g.label}`, st.guess === id, `<small>${g.text}</small>`))
                 .join('')}</div>`
            : '<p class="note">🖥️ Ein Gerät: Alle rufen – am Laptop wird angetippt, wer zuerst gerufen hat (Taste 1–9).</p>'
        }
        <h2>Anzahl Songs</h2>
        <div class="choices">${COUNTS.map((n) => choice(scope, 'count', n, `${n} Songs`, st.count === n, n === 15 ? '<small>Standard</small>' : n === 10 ? '<small>kurz</small>' : '<small>lang</small>')).join('')}</div>
        ${phones ? `<h2>Teams</h2><div class="choices">${[0, 2, 3, 4].map((n) => choice(scope, 'teams', n, n ? `${n} Teams` : 'jede/r allein', st.teams === n)).join('')}</div>` : ''}
      </section>
      ${
        snips
          ? `<section class="panel">
        <h2>🔊 Ausschnitte</h2>
        <h3>Stufen</h3>
        <div class="choices choices-2">${Object.entries(STEPS)
          .map(([id, x]) => choice(scope, 'steps', id, x.label, st.steps === id, `<small>${x.text} · ${STEP_SETS[id].points.join('-')} Punkte</small>`))
          .join('')}</div>
        <h3>Interpret allein zählt</h3>
        <div class="choices choices-3">${Object.entries(ARTIST)
          .map(([id, x]) => choice(scope, 'artist', id, x.label, st.artist === id, `<small>${x.text}</small>`))
          .join('')}</div>
        <h3>Startstelle</h3>
        <div class="choices choices-2">${Object.entries(START)
          .map(([id, x]) => choice(scope, 'start', id, `${x.icon} ${x.label}`, st.start === id, `<small>${x.text}</small>`))
          .join('')}</div>
        <p class="note">Die Ausschnitte kommen aus der iTunes-Suche. Findet sich kein passender, kommt einfach der nächste Song.</p>
      </section>`
          : ''
      }
      ${
        hums
          ? `<section class="panel">
        <h2>🎤 Summen</h2>
        <div class="choices choices-4">${Object.entries(HUM)
          .map(([id, x]) => choice(scope, 'hum', id, `${x.icon} ${x.label}`, st.hum === id))
          .join('')}</div>
        <p class="note">Reihum sucht sich eine Person einen von ${E.HUM_OPTIONS} Songs aus (${phones ? 'am eigenen Handy' : 'kurz allein am Laptop'}) und ${esc((HUM[st.hum] || HUM.hum).verb)} ihn ${HUM_MS / 1000} s lang.
          Erster Treffer ${HUM_FIRST}, alle weiteren ${HUM_MORE} Punkt, die Summer/in bekommt ${HUM_HUMMER}, wenn es jemand errät.</p>
      </section>`
          : ''
      }
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
        ${toggle(scope, 'drinks', st.drinks, '🍻 Trinkregeln', `Niemand erkennt den Song → alle trinken ${SIPS_NOBODY} · Treffer nach der ersten Stufe → ${SIPS_GIVE} Schlucke verteilen`)}
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
      const min = st.mode === 'snip' ? MIN_PLAYERS : HUM_MIN_PLAYERS;
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
          <p class="note">Die Nummer ist gleichzeitig die <b>Taste</b> am Laptop. Teams? Einfach den Teamnamen eintragen.</p>
          <ol class="names">${rows}</ol>
          ${s.names.length < MAX_PLAYERS ? `<button class="btn btn-ghost btn-small" data-act="add-name">＋ Person</button>` : ''}
        </section>`;
      const filled = s.names.map((n) => cleanName(n)).filter(Boolean);
      if (filled.length < min) problem = `Mindestens ${min} Namen eintragen${min > MIN_PLAYERS ? ' (zum Summen)' : ''}`;
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
        <button class="btn btn-primary btn-big btn-wide" data-act="create" ${problem ? 'disabled' : ''}>${st.input === 'phones' ? '📱 Raum öffnen' : '🎧 Los geht’s'}</button>
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
      <div class="join-hero">${eqSvg('dance')}${logoHtml(true)}</div>
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
    else if (v.cur && v.cur.kind === 'hum') main = humStageHtml(v);
    else main = snipStageHtml(v);
    const side = ['lobby', 'end'].includes(v.phase) ? '' : `<aside class="stage-side"><h2>Punkte</h2>${scoresHtml(v)}</aside>`;
    return `<div class="screen game stage-${v.phase}">${barHtml(v)}<div class="stage-grid ${side ? '' : 'is-full'}"><div class="stage-mainpart">${main}</div>${side}</div></div>`;
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
    const summary = [MODE[st.mode].icon + ' ' + MODE[st.mode].label, GUESS[st.guess].icon + ' ' + GUESS[st.guess].label, `${st.count} Songs`, st.mode !== 'snip' ? hum(v).icon + ' ' + hum(v).label : '', `${v.poolSize} Songs zur Auswahl`].filter(Boolean);
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
            <button class="btn btn-primary btn-big btn-wide" data-act="start" ${v.lobbyProblem ? 'disabled' : ''}>🎧 Los geht’s</button>
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

  function snipStageHtml(v) {
    const c = v.cur;
    const one = v.settings.input === 'one';
    const playing = Player.snip.playing && v.phase === 'play';
    const secs = c.steps[c.step];
    let body;
    if (v.phase === 'buzzed') body = buzzedStageHtml(v);
    else {
      const typing = !one && v.settings.guess === 'type';
      const how = one ? 'Wer es weiß, ruft – tippt an, wer zuerst gerufen hat:' : typing ? '⌨️ Tippt Titel oder Interpret am Handy!' : '🔔 Wer es weiß, buzzert am Handy!';
      body = `
        ${hintHtml(c)}
        ${countdownHtml(c)}
        <p class="how">${how}</p>
        ${chipsHtml(v, { buzz: one })}
        <div class="controls">
          <button class="btn btn-ghost" data-act="replay">🔁 Nochmal hören</button>
          <button class="btn btn-ghost" data-act="step">⏭️ ${c.step >= c.steps.length - 1 ? 'Auflösen' : 'Nächste Stufe'}</button>
          <button class="btn btn-ghost" data-act="resolve">🔍 Niemand weiß es</button>
        </div>`;
    }
    return `
      ${tiebreakBanner(v)}
      <section class="stage snip-stage">
        <div class="snip-head">
          ${eqSvg(playing ? 'dance' : '')}
          <div class="snip-info">
            <span class="snip-no">${songNoLabel(v)}</span>
            <h2 class="snip-title">🔊 Stufe ${c.step + 1} · ${secsLabel(secs)} · jetzt <b>${pts(c.points)}</b></h2>
            ${stepsHtml(c, true)}
            ${audioStateHtml(v)}
          </div>
        </div>
        ${body}
      </section>`;
  }

  function tiebreakBanner(v) {
    if (!v.tiebreak || v.no <= v.count) return '';
    return `<p class="banner">⚖️ Stechen! Nur ${andList(v.tiebreak.map((i) => esc(v.teams[i].name)))} ${plural(v.tiebreak.length, 'darf', 'dürfen')} raten.</p>`;
  }

  /** Jemand hat gebuzzert: laut sagen, Laptop bestätigt */
  function buzzedStageHtml(v) {
    const c = v.cur;
    const b = c.buzz;
    const t = v.teams[b.team];
    const isHum = c.kind === 'hum';
    const p = isHum ? HUM_FIRST : c.stepPoints[b.step];
    const artist = !isHum && v.settings.artist !== 'none';
    const ap = v.settings.artist === 'full' ? p : Math.ceil(p / 2);
    const who = esc(b.name) + (v.settings.teams ? ` <small>(${esc(t.name)})</small>` : '');
    const solution = isHum
      ? v.settings.input === 'one'
        ? `<p class="note center">${esc(c.hummerName)} weiß die Lösung und entscheidet.</p>`
        : `<p class="note center">${esc(c.hummerName)} hat die Lösung auf dem Handy und entscheidet – oder ihr hier.</p>`
      : c.shown
        ? `<div class="solution">${songCardHtml(c.song)}</div>`
        : `<button class="btn btn-ghost" data-act="show">👁 Lösung zeigen <small>danach ist der Song für alle vorbei</small></button>`;
    return `
      <div class="buzzed" style="${teamStyle(t)}">
        <p class="buzz-who">🔔 ${who}</p>
        <p class="buzz-say">sagt es laut …</p>
        ${solution}
        <div class="judge">
          <button class="btn btn-good btn-big" data-act="judge" data-ok="title">✅ Richtig <small>+${p}</small></button>
          ${artist ? `<button class="btn btn-part" data-act="judge" data-ok="artist">🎤 Nur Interpret <small>+${ap}</small></button>` : ''}
          <button class="btn btn-danger" data-act="judge" data-ok="wrong">❌ Falsch <small>raus für diesen Song</small></button>
        </div>
      </div>`;
  }

  function humStageHtml(v) {
    const c = v.cur;
    const one = v.settings.input === 'one';
    const h = hum(v);
    const name = esc(c.hummerName);
    let body;
    if (v.phase === 'pick') {
      body = one
        ? `<h2 class="turn">${h.icon} <b>${name}</b> ist dran!</h2>
           <p class="note center">Alle anderen: wegschauen! Nur ${name} schaut auf den Laptop.</p>
           <div class="go"><button class="btn btn-primary btn-big" data-act="peek">🙈 Songs zeigen <small>nur für ${name}</small></button></div>`
        : `<h2 class="turn">${h.icon} <b>${name}</b> sucht sich einen Song aus …</h2>
           <p class="note center">Die drei Vorschläge stehen auf ${name}s Handy.</p>
           <div class="go"><button class="btn btn-link" data-act="skiphum">⏭️ Jemand anderes ${esc(h.verb)}</button></div>`;
    } else if (v.phase === 'buzzed') body = buzzedStageHtml(v);
    else {
      const typing = !one && v.settings.guess === 'type';
      const how = one ? `Wer es weiß, ruft – ${name} tippt an, wer es richtig hatte:` : typing ? '⌨️ Tippt den Titel am Handy!' : '🔔 Wer es weiß, buzzert am Handy!';
      body = `
        <h2 class="turn">${h.icon} <b>${name}</b> ${esc(h.verb)}!</h2>
        <p class="note center">${esc(h.how)}</p>
        ${countdownHtml(c)}
        <p class="how">${how}</p>
        ${chipsHtml(v, { buzz: one })}
        <div class="controls">
          ${one ? `<button class="btn btn-ghost" data-act="peek">🙈 Song nochmal zeigen <small>nur ${name}</small></button>` : ''}
          <button class="btn btn-ghost" data-act="resolve">🔍 Auflösen</button>
        </div>`;
    }
    return `
      ${tiebreakBanner(v)}
      <section class="stage hum-stage">
        <div class="hum-head">
          <div class="hum-mic ${v.phase === 'play' ? 'is-live' : ''}" aria-hidden="true">${h.icon}</div>
          <span class="snip-no">${songNoLabel(v)}</span>
        </div>
        ${body}
      </section>`;
  }

  /** Ergebnis-Zeilen der Auflösung */
  function resultsHtml(v) {
    const l = v.last;
    const rows = [];
    const hit = l.results.filter((r) => r.points > 0).sort((a, b) => b.points + b.bonus - (a.points + a.bonus));
    for (const r of hit) {
      const t = v.teams[r.team];
      const by = r.hit && r.hit.by && v.settings.teams ? ` <small>(${esc(memberName(v, r.hit.by))})</small>` : '';
      let what;
      if (l.kind === 'hum') what = r.partial ? '' : '🎤 erraten';
      else if (r.partial) what = '🎤 nur Interpret';
      else what = `nach ${secsLabel(l.secs[r.hit.step])}${r.hit.step === 0 ? ' 🤯' : ''}`;
      const bonus = r.bonus ? ` <span class="bonus">⚡ +${r.bonus} Schnellste/r</span>` : '';
      rows.push(`<li class="res is-hit" style="${teamStyle(t)}"><i class="dot"></i><span class="res-name">${esc(t.name)}${by}</span><span class="res-what">${what}${bonus}</span><b>+${r.points + r.bonus}</b></li>`);
    }
    if (l.kind === 'hum' && l.hummerTeam !== null) {
      const t = v.teams[l.hummerTeam];
      rows.push(`<li class="res ${l.hummerPoints ? 'is-hit' : ''}" style="${teamStyle(t)}"><i class="dot"></i><span class="res-name">${esc(memberName(v, l.hummer))}</span><span class="res-what">${hum(v).icon} ${esc(hum(v).verb)}</span><b>${l.hummerPoints ? '+' + l.hummerPoints : '0'}</b></li>`);
    }
    const missed = l.results.filter((r) => r.points === 0 && r.played && (r.out || r.tries));
    if (missed.length) rows.push(`<li class="res is-miss"><span class="res-name">❌ ${andList(missed.map((r) => esc(v.teams[r.team].name)))}</span></li>`);
    const out = [];
    if (l.nobody) out.push(`<p class="result is-wrong">🙉 Niemand hat den Song erkannt!</p>`);
    else {
      const fast = hit.find((r) => r.hit && r.hit.step === 0 && l.kind === 'snip');
      if (fast) out.push(`<p class="result is-right">🤯 ${esc(fast.hit.by ? memberName(v, fast.hit.by) : v.teams[fast.team].name)} hatte es nach ${secsLabel(l.secs[0])}!</p>`);
    }
    if (l.sips.all) out.push(`<p class="drink">🍻 Alle trinken ${l.sips.all} ${plural(l.sips.all, 'Schluck', 'Schlucke')}</p>`);
    for (const ti of l.sips.give) out.push(`<p class="drink">🍻 ${esc(v.teams[ti].name)} ${plural(v.teams[ti].members.length, 'darf', 'dürfen')} ${SIPS_GIVE} Schlucke verteilen</p>`);
    return `${out.join('')}${rows.length ? `<ul class="results">${rows.join('')}</ul>` : ''}`;
  }

  function nextLabel(v) {
    if (v.willEnd) return '🏆 Zur Siegerehrung';
    if (v.willTie) return '⚖️ Gleichstand – Stechen!';
    return 'Weiter →<small>nächster Song</small>';
  }

  function revealStageHtml(v) {
    const l = v.last;
    return `
      <section class="stage reveal-stage">
        <span class="snip-no">${l.tiebreak ? '⚖️ Stechen' : `Song ${l.no}/${v.count}`} · ${l.kind === 'hum' ? hum(v).icon + ' ' + esc(hum(v).label) : '🔊 Ausschnitt'}</span>
        ${songCardHtml(l.song, { art: true, year: true, cls: 'is-big' })}
        ${storeLinkHtml(l.song)}
        ${resultsHtml(v)}
      </section>
      <div class="go"><button class="btn btn-primary btn-big" data-act="next">${nextLabel(v)}</button></div>`;
  }

  function endHtml(v, stage) {
    const wins = v.ranking.filter((r) => r.place === 1);
    const title = wins.length ? `${andList(wins.map((w) => esc(w.name)))} ${plural(wins.length, 'gewinnt', 'gewinnen')}!` : 'Spiel beendet';
    const songs = (v.log || []).filter((x) => !x.tiebreak).length;
    const sub = v.reason === 'empty' ? 'Die Songs sind ausgegangen.' : v.reason === 'stopped' ? 'Spiel vorzeitig beendet.' : `${songs} Songs${v.log && v.log.some((x) => x.tiebreak) ? ' + Stechen' : ''}`;
    const rows = `<ol class="ranking">${v.ranking
      .map(
        (r) => `
          <li class="${r.place === 1 ? 'is-win' : ''}" style="--team:${esc(r.color)}">
            <span class="place">${r.place === 1 ? '🏆' : r.place + '.'}</span>
            <span class="rank-name"><i class="dot"></i>${esc(r.name)}</span>
            <span class="rank-info"><b>${pts(r.points)}</b> · ${r.hits} ${plural(r.hits, 'Treffer', 'Treffer')}</span>
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
            <span class="pl-kind" title="${x.kind === 'hum' ? 'gesummt' : 'Ausschnitt'}">${x.kind === 'hum' ? hum(v).icon : '🔊'}</span>
            <a href="${esc(url)}" target="_blank" rel="noopener"><b>${esc(x.song.title)}</b> – ${esc(x.song.artist)} <small>${x.song.year}</small></a>
            <span class="pl-who">${x.hummer ? `${esc(memberName(v, x.hummer))} · ` : ''}${who}</span>
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
    const mine = t ? `<span class="me-team" style="${teamStyle(t)}"><i class="dot"></i>${esc(v.me.name)}${v.settings.teams ? ` · ${esc(t.name)}` : ''}</span>` : `<span class="me-team">${esc(v.me.name)}</span>`;
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
    else if (v.cur.kind === 'hum' && v.me.hummer) main = phoneHummerHtml(v);
    else main = phonePlayHtml(v);
    return `<div class="screen phone phone-${v.phase}">${phoneBar(v)}${main}</div>`;
  }

  function phoneLobbyHtml(v) {
    const teams = v.settings.teams;
    const st = v.settings;
    return `
      <div class="phone-center">
        ${eqSvg('dance')}
        <h1>Du bist dabei!</h1>
        ${v.me.watch ? '<p class="note">Das Spiel ist voll oder läuft schon – du schaust zu.</p>' : ''}
        ${
          teams && !v.me.watch
            ? `<h2>Dein Team</h2><div class="choices choices-2">${Array.from({ length: teams }, (_, i) => `<button class="choice team-choice ${v.me.lobbyTeam === i ? 'on' : ''}" style="--team:${E.TEAMS[i].color}" data-act="team" data-team="${i}" aria-pressed="${v.me.lobbyTeam === i}"><i class="dot"></i>${esc(E.TEAMS[i].name)}<small>${v.members.filter((m) => m.team === i && !m.watch).map((m) => esc(m.name)).join(', ') || '–'}</small></button>`).join('')}</div>`
            : ''
        }
        <p class="summary">${[MODE[st.mode].icon + ' ' + MODE[st.mode].label, GUESS[st.guess].label, `${st.count} Songs`].map((x) => `<span>${esc(x)}</span>`).join('')}</p>
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
    if (!v.me.lead || v.phase !== 'play') return '';
    const c = v.cur;
    if (c.kind === 'hum') return `<div class="lead-ctrl"><span>🎬</span><button class="btn btn-ghost btn-small" data-act="resolve">🔍 Auflösen</button></div>`;
    return `
      <div class="lead-ctrl">
        <span>🎬</span>
        <button class="btn btn-ghost btn-small" data-act="replay">🔁 Nochmal</button>
        <button class="btn btn-ghost btn-small" data-act="step">⏭️ ${c.step >= c.steps.length - 1 ? 'Auflösen' : 'Stufe'}</button>
        <button class="btn btn-ghost btn-small" data-act="resolve">🔍 Niemand</button>
      </div>`;
  }

  function feedbackHtml(fb, v) {
    if (!fb) return '';
    const r = fb.result;
    const isHum = v.cur && v.cur.kind === 'hum';
    let text;
    let cls;
    if (r === 'title') {
      text = `✅ Richtig! +${fb.points}`;
      cls = 'is-right';
    } else if (r === 'artist') {
      text = `🎤 Interpret stimmt! +${fb.points}<small>Der Titel bringt mehr – rate ruhig weiter.</small>`;
      cls = 'is-part';
    } else if (r === 'artist-only') {
      text = isHum ? '🎤 Interpret stimmt – gesucht ist der Titel.' : v.settings.artist === 'none' ? '🎤 Interpret stimmt – zählt hier aber nicht, nur der Titel.' : '🎤 Den Interpreten hast du schon – jetzt den Titel!';
      cls = 'is-part';
    } else if (r === 'close') {
      text = '🤏 Knapp daneben!<small>Kostet keinen Versuch – nochmal genauer.</small>';
      cls = 'is-close';
    } else {
      text = `❌ „${esc(fb.text)}“ ist es nicht.`;
      cls = 'is-wrong';
    }
    return `<p class="feedback ${cls}">${text}</p>`;
  }

  function guessFormHtml(v) {
    const c = v.cur;
    const res = c.res[v.me.team];
    const left = MAX_TRIES - (res ? res.tries : 0);
    const isHum = c.kind === 'hum';
    const list = ui.guess.trim().length >= 2 ? suggestions(ui.guess) : [];
    const sugg = list.length
      ? `<div class="suggest">${list.map((x) => `<button type="button" class="suggest-item" data-act="suggest" data-title="${esc(x.title)}">${esc(x.title)}<small>${esc(x.artist)}</small></button>`).join('')}</div>`
      : ui.guess.trim().length >= 2
        ? `<div class="suggest muted small">Kein passender Titel in unserer Sammlung${!isHum && v.settings.artist !== 'none' ? ' – Interpret? Einfach abschicken.' : ''}</div>`
        : '';
    const ph = isHum || v.settings.artist === 'none' ? 'Songtitel …' : 'Titel oder Interpret …';
    return `
      <form class="panel guess" data-form="guess">
        <input class="input input-big" id="guess-input" type="text" maxlength="80" placeholder="${ph}" value="${esc(ui.guess)}" data-field="guess" autocomplete="off" autocapitalize="sentences" spellcheck="false" enterkeyhint="send" />
        ${sugg}
        <div class="guess-foot">
          <span class="tries" aria-label="${left} von ${MAX_TRIES} Versuchen übrig">Versuche: ${'●'.repeat(left)}${'○'.repeat(MAX_TRIES - left)}</span>
          <button class="btn btn-primary" type="submit" ${ui.guess.trim() ? '' : 'disabled'}>Raten ➤</button>
        </div>
      </form>`;
  }

  function buzzerHtml(v) {
    return `<div class="buzzer-wrap"><button class="buzzer" data-act="buzz" aria-label="Buzzer">BUZZ!</button></div>`;
  }

  /** Handy: Ausschnitt läuft bzw. jemand summt (für alle, die raten) */
  function phonePlayHtml(v) {
    const c = v.cur;
    const isHum = c.kind === 'hum';
    const res = c.res[v.me.team];
    const head = isHum
      ? `<h2 class="turn">${hum(v).icon} ${esc(c.hummerName)} ${esc(hum(v).verb)}</h2>`
      : `<h2 class="turn">🎧 ${songNoLabel(v)} · Stufe ${c.step + 1}</h2><p class="note center">${secsLabel(c.steps[c.step])} · jetzt <b>${pts(c.points)}</b></p>${stepsHtml(c, false)}`;
    if (v.phase === 'pick') {
      return `
        <div class="phone-center">
          <div class="hum-mic" aria-hidden="true">${hum(v).icon}</div>
          <h2 class="turn"><b>${esc(c.hummerName)}</b> sucht sich einen Song aus …</h2>
          <p class="note">Gleich wird ${esc(hum(v).verb === 'spielt vor' ? 'vorgespielt' : hum(v).label.toLowerCase())}. Gut hinhören!</p>
        </div>`;
    }
    let body;
    if (v.phase === 'buzzed') {
      const b = c.buzz;
      if (b.pid === v.me.id) body = `<div class="buzzed-me"><p class="buzz-who">🔔 Du bist dran!</p><p class="buzz-say">Sag Titel und Interpret <b>laut</b>.</p></div>`;
      else if (v.me.judge) body = `<div class="buzzed-me"><p class="buzz-who">🔔 ${esc(b.name)}</p><p class="note">sagt es laut – stimmt’s?</p>${phoneJudgeHtml(v)}</div>`;
      else body = `<div class="buzzed-me"><p class="buzz-who">🔔 ${esc(b.name)}</p><p class="note">sagt es gerade laut …</p></div>`;
    } else if (!res || (!res.may && !res.done)) body = `<p class="waiting">${v.tiebreak ? '⚖️ Stechen – du schaust zu.' : '⌛ Du rätst diesmal nicht mit.'}</p>`;
    else if (res.hit) body = `<p class="feedback is-right big">✅ ${res.hit.by === v.me.id ? 'Richtig!' : `${esc(res.hit.name || 'Dein Team')} hat’s!`} +${res.points}</p><p class="waiting">⌛ Die anderen raten noch …</p>`;
    else if (res.out) body = `${feedbackHtml(v.me.fb, v)}<p class="waiting">❌ Für diesen Song bist du raus.</p>`;
    else if (v.settings.guess === 'type') body = `${res.partial ? `<p class="feedback is-part">🎤 Interpret erkannt (+${res.points}) – der Titel bringt mehr!</p>` : ''}${feedbackHtml(v.me.fb, v)}${guessFormHtml(v)}`;
    else body = `${res.partial ? `<p class="feedback is-part">🎤 Interpret gewertet (+${res.points}).</p><p class="waiting">⌛ Die anderen raten noch …</p>` : buzzerHtml(v)}`;
    return `
      ${head}
      ${hintHtml(c)}
      ${countdownHtml(c)}
      ${body}
      ${leadControlsHtml(v)}`;
  }

  function phoneJudgeHtml(v) {
    const c = v.cur;
    const isHum = c.kind === 'hum';
    const p = isHum ? HUM_FIRST : c.stepPoints[c.buzz.step];
    const artist = !isHum && v.settings.artist !== 'none';
    return `
      <div class="judge judge-phone">
        <button class="btn btn-good btn-big btn-wide" data-act="judge" data-ok="title">✅ Richtig <small>+${p}</small></button>
        ${artist ? `<button class="btn btn-part btn-wide" data-act="judge" data-ok="artist">🎤 Nur Interpret</button>` : ''}
        <button class="btn btn-danger btn-wide" data-act="judge" data-ok="wrong">❌ Falsch</button>
      </div>`;
  }

  /** Handy der Summer/in: Song aussuchen, dann summen */
  function phoneHummerHtml(v) {
    const c = v.cur;
    const h = hum(v);
    if (v.phase === 'pick') {
      const opts = (c.options || []).map((s) => `<button class="pick-song" data-act="pick-song" data-id="${esc(s.id)}"><b>${esc(s.title)}</b><span>${esc(s.artist)}</span></button>`).join('');
      return `
        <section class="hum-card">
          <h2>${h.icon} Du ${esc(h.verb)}!</h2>
          <p class="dj-warn">Nicht verraten – Handy nicht zeigen 🙈</p>
          <p class="note">Such dir einen Song aus, den du gut kennst:</p>
          <div class="pick-list">${opts}</div>
          <button class="btn btn-ghost btn-wide" data-act="reroll">↻ Kenn ich nicht – andere Songs</button>
        </section>`;
    }
    const hits = v.teams
      .map((t, i) => ({ t, r: c.res[i] }))
      .filter((x) => x.r && x.r.hit)
      .map((x) => `<li style="${teamStyle(x.t)}"><i class="dot"></i>${esc(x.r.hit.name || x.t.name)} ✅</li>`)
      .join('');
    return `
      <section class="hum-card">
        <h2>${h.icon} Jetzt ${esc(h.verb === 'spielt vor' ? 'vorspielen' : h.label.toLowerCase())}!</h2>
        ${c.song ? `<div class="dj-song"><b>${esc(c.song.title)}</b><span>${esc(c.song.artist)}</span></div>` : ''}
        <p class="dj-warn">${esc(h.how)}</p>
        ${countdownHtml(c)}
        ${v.phase === 'buzzed' ? `<div class="buzzed-me"><p class="buzz-who">🔔 ${esc(c.buzz.name)}</p><p class="note">sagt es laut – stimmt’s?</p>${phoneJudgeHtml(v)}</div>` : ''}
        ${hits ? `<ul class="hum-hits">${hits}</ul>` : v.phase === 'play' ? '<p class="note">Noch hat es niemand …</p>' : ''}
        ${v.phase === 'play' ? '<button class="btn btn-ghost btn-wide" data-act="resolve">🏳️ Auflösen</button>' : ''}
      </section>`;
  }

  function phoneRevealHtml(v) {
    const l = v.last;
    const mine = l.results[v.me.team];
    let me = '';
    if (l.kind === 'hum' && l.hummer === v.me.id) me = l.hummerPoints ? `<p class="feedback is-right big">${hum(v).icon} Erraten! +${l.hummerPoints}</p>` : `<p class="feedback is-wrong big">${hum(v).icon} Leider hat es niemand erkannt.</p>`;
    else if (mine && mine.points > 0) me = `<p class="feedback is-right big">✅ +${mine.points + mine.bonus}${mine.bonus ? ' ⚡' : ''}</p>`;
    else if (mine && mine.played) me = '<p class="feedback is-wrong big">❌ Diesmal nicht.</p>';
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
    const c = STEP_SETS.classic;
    return `
      <h2>📖 So geht’s</h2>
      <h3>🔊 Ausschnitte</h3>
      <ol class="rules">
        <li>Der Laptop spielt einen Song an – erst <b>1 Sekunde</b>, dann ${c.secs.slice(1, -1).join(', ')} und ${c.secs[c.secs.length - 1]} Sekunden, immer von derselben Stelle.</li>
        <li>Nach jeder Stufe gibt es <b>${GUESS_MS / 1000} s Ratezeit</b>. Je früher richtig, desto mehr Punkte: <b>${c.points.join(' – ')}</b>.
            Auf der letzten Stufe gibt es einen Hinweis (Jahrzehnt + Anfangsbuchstabe des Interpreten).</li>
        <li><b>⌨️ Tippen:</b> Titel oder Interpret am Handy, mit Vorschlägen. Der Titel zählt voll, nur der Interpret die Hälfte (einstellbar).
            Höchstens <b>${MAX_TRIES} Fehlversuche</b> pro Song – ein kleiner Tippfehler („knapp daneben“) kostet nichts.</li>
        <li><b>🔔 Buzzer:</b> Wer zuerst drückt, sagt es laut, der Laptop bestätigt. Falsch → für diesen Song raus.
            Wird die Lösung am Laptop aufgedeckt, ist der Song danach für alle vorbei.</li>
        <li><b>⚡ Schnellste/r</b> Treffer pro Song: <b>+${FIRST_BONUS}</b>.</li>
        <li><b>🖥️ Ein Gerät:</b> Alle rufen, am Laptop wird angetippt, wer zuerst gerufen hat (Tasten 1–9).</li>
      </ol>
      <h3>🎤 Summen</h3>
      <ol class="rules">
        <li>Reihum sucht sich eine Person einen von ${E.HUM_OPTIONS} Songs aus („Kenn ich nicht“ bringt neue) und summt ihn – <b>ohne Worte</b>, ${HUM_MS / 1000} s lang.</li>
        <li>Erster Treffer <b>${HUM_FIRST}</b>, alle weiteren <b>${HUM_MORE}</b> Punkt (beim Buzzer endet der Song mit dem ersten Treffer).
            Die Summer/in bekommt <b>${HUM_HUMMER}</b>, wenn es mindestens eine Person errät – und rät selbst nicht mit.</li>
        <li>Varianten: 😗 Pfeifen, 🥁 Klopfen (nur Rhythmus, sehr schwer), 🙊 Pantomime.</li>
      </ol>
      <h3>Ende</h3>
      <ul class="rules-tips">
        <li>🏆 Nach 10, 15 oder 20 Songs gewinnen die meisten Punkte. Bei Gleichstand an der Spitze gibt es ein <b>⚖️ Stechen</b> mit Extra-Songs.</li>
        <li>🍏 Die Ausschnitte stammen aus Apple Music – zu jedem Song gibt es den Link „In Apple Music öffnen“.</li>
        <li>🎶 Am Ende gibt es die <b>Playlist des Abends</b> mit allen Songs.</li>
      </ul>`;
  }

  /** Ein Gerät: Songs bzw. der ausgesuchte Song nur für die Summer/in */
  function peekHtml(v) {
    const c = v.cur;
    if (!c || c.kind !== 'hum') return '';
    const name = esc(c.hummerName);
    const h = hum(v);
    if (v.phase === 'pick') {
      const opts = (c.options || []).map((s) => `<button class="pick-song" data-act="pick-song" data-id="${esc(s.id)}"><b>${esc(s.title)}</b><span>${esc(s.artist)}</span></button>`).join('');
      return `
        <h2>${h.icon} Nur für ${name}</h2>
        <p class="dj-warn">Alle anderen: wegschauen! 🙈</p>
        <p class="note">Such dir einen Song aus, den du gut kennst:</p>
        <div class="pick-list">${opts}</div>
        <button class="btn btn-ghost btn-wide" data-act="reroll">↻ Kenn ich nicht – andere Songs</button>`;
    }
    if (!c.song) return '';
    return `
      <h2>${h.icon} Nur für ${name}</h2>
      <div class="dj-song"><b>${esc(c.song.title)}</b><span>${esc(c.song.artist)}</span></div>
      <p class="dj-warn">${esc(h.how)}</p>
      <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">✔ Verstecken</button></div>`;
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
        // Countdown und Stufen-Fortschritt setzt liveLoop() direkt
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

  /** Countdown und Fortschritt der laufenden Stufe flüssig nachführen */
  let lastSecond = null;
  function liveLoop() {
    const v = ui.view;
    const c = v && v.cur;
    const cd = app.querySelector('[data-live="countdown"]');
    if (cd && c && c.left !== null && c.paused === null) {
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
    const seg = app.querySelector('[data-live="seg"]');
    if (seg && ui.screen === 'stage' && c && c.kind === 'snip') {
      const p = Player.snip.progress();
      const w = c.heard || v.phase !== 'play' ? 100 : p === null ? 0 : 100 * p;
      seg.style.width = `${w.toFixed(1)}%`;
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

  function sendGuess(text) {
    const t = String(text || '').trim();
    if (!t) return;
    dispatch('guess', { text: t });
    ui.guess = '';
    ui.focus = '#guess-input';
    render();
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
    step: () => dispatch('step', { step: ui.view && ui.view.cur ? ui.view.cur.step : undefined }),
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
    'stage-buzz': (el) => dispatch('buzz', { team: +el.dataset.team }),
    buzz: () => {
      vibrate(30);
      dispatch('buzz');
    },
    show: () => dispatch('show'),
    judge: (el) => dispatch('judge', { ok: el.dataset.ok }),
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
    skiphum: () => dispatch('skiphum'),
    suggest: (el) => sendGuess(el.dataset.title),
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
    else if (f === 'guess') {
      ui.guess = el.value;
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
    } else if (form.dataset.form === 'guess') sendGuess(ui.guess);
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
    // Laptop: 1–9 = wer zuerst gerufen hat (ein Gerät), Leertaste = nochmal, → = nächste Stufe, Enter = weiter
    const v = ui.view;
    if (e.target !== document.body || ui.modal || !v || ui.screen !== 'stage') return;
    const c = v.cur;
    if (v.phase === 'play' && v.settings.input === 'one' && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      dispatch('buzz', { team: Number(e.key) - 1 });
    } else if (v.phase === 'play' && c && c.kind === 'snip' && e.key === ' ') {
      e.preventDefault();
      dispatch('replay');
    } else if (v.phase === 'play' && c && c.kind === 'snip' && e.key === 'ArrowRight') {
      e.preventDefault();
      dispatch('step', { step: c.step });
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

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.GTS_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  requestAnimationFrame(liveLoop);
  autoResume();

  // für Tests
  window.GTSApp = { ui, render: renderNow, actions, Player };
})();
