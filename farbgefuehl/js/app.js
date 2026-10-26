/*
 * Oberfläche von „Farbgefühl“.
 *  - Gerät mit der Farbtafel („device“ bei Ein Gerät, „stage“ bei Mit Handys):
 *    Startseite, Spiel anlegen, Lobby mit QR-Code, geheime Karte hinter „Alle wegschauen“, Hinweis,
 *    Steine setzen per Klick mit Lupe, Aufdecken mit Rahmen und Punkten, Siegerehrung mit Auszeichnungen
 *  - Handy („phone“): beitreten, Farbe/Team wählen, Karte + Hinweis (mit Prüfung), Steine setzen mit Lupe, Ergebnis
 * Gerendert wird per HTML-String + morphdom (nur geänderte Teile werden ersetzt).
 */
(function () {
  'use strict';

  const E = window.FGEngine;
  const { Engine, TIMERS, TEAMS, MIN_PLAYERS, MIN_TEAMS, MAX_PLAYERS, GOAL, PLAYER_COLORS, sanitizeSettings, colorHex } = E;
  const { StageController, ClientController, Store, KEYS, Net, inviteLink, qrSvg } = window.FGControllers;
  const { Sound, confetti } = window.GameFx;
  const Sounds = window.FGSounds;
  const Board = window.FGBoard;
  const Cues = window.FGCues;
  const { ROWS, COLS } = Board;

  const INPUT = {
    single: {
      icon: '🖥️',
      label: 'Ein Gerät',
      text: 'Laptop oder Fernseher in der Mitte. Die geheime Farbe zeigt der Bildschirm hinter „Alle wegschauen“, gesetzt wird reihum per Klick.',
    },
    phones: {
      icon: '📱',
      label: 'Mit Handys',
      text: 'Der Laptop zeigt die große Farbtafel. Alle scannen den QR-Code – Karte, Hinweis und Steine kommen vom eigenen Handy.',
    },
  };
  const PHASE_LABEL = { lobby: 'Handys verbinden', pick: 'Farbe wählen', cue: 'Hinweis', place: 'Steine setzen', reveal: 'Aufdecken', end: 'Siegerehrung' };
  const LETTERS = 'ABCD';
  const SETUP_KEY = 'farbgefuehl.setup.v1';
  const PREFS_KEY = 'farbgefuehl.prefs.v1';
  const ACTIVE_KEY = 'farbgefuehl.active';
  const RESUME_MAX_AGE = 12 * 60 * 60 * 1000;
  const REVEAL_FRAME_S = 1.1; // so lange trommelt es, bevor der Rahmen kommt
  const REVEAL_STEP_S = 0.18; // Abstand zwischen den Punkten der einzelnen Steine
  const LOUPE = 7;
  const LIGHT_STONES = ['yellow', 'white', 'orange', 'teal', 'green'];

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
      /* gesperrter Speicher – dann eben ohne */
    }
    return null;
  }

  function plural(n, one, many) {
    return n === 1 ? one : many;
  }

  /** „Anna“, „Anna und Ben“, „Anna, Ben und Cem“ */
  function joinNames(names) {
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' und ' + names[names.length - 1];
  }

  function pl(v, id) {
    return v.players.find((x) => x.id === id) || null;
  }

  function pname(v, id) {
    const p = pl(v, id);
    return p ? p.name : '?';
  }

  function isTeams(s) {
    return !!s.teams;
  }

  function teamWord(v) {
    return isTeams(v.settings) ? 'Team' : 'Person';
  }

  /** Name mit Farbpunkt */
  function who(v, id, cls) {
    const p = pl(v, id);
    if (!p) return '?';
    return `<span class="who ${cls || ''}"><i class="dot" style="--pc:${p.hex}"></i>${esc(p.name)}</span>`;
  }

  function cueQuote(c) {
    if (c === null) return '<i>🗣️ laut gesagt</i>';
    if (!c) return '';
    return `„${esc(c)}“`;
  }

  function cuesHtml(cues) {
    return (cues || [])
      .map((c, i) => (c === '' ? '' : `<span class="cue cue-${i + 1}">${cueQuote(c)}</span>`))
      .filter(Boolean)
      .join('<span class="cue-sep">·</span>');
  }

  /** Helle Zelle? (für Beschriftung und Markierungen) */
  function lightCell(cell) {
    return Board.hexToLab(Board.color(cell))[0] > 0.68;
  }

  function endText(s) {
    if (s.to50) return `Bis ${GOAL} Punkte`;
    if (s.rounds) return `${s.rounds} ${plural(s.rounds, 'Durchgang', 'Durchgänge')}`;
    return 'Automatisch';
  }

  function defaultSetup() {
    return { settings: sanitizeSettings({}), players: ['', '', '', ''], teams: ['', '', '', ''] };
  }

  function loadSetup() {
    const saved = Store.get(SETUP_KEY);
    if (!saved || !Array.isArray(saved.players)) return defaultSetup();
    saved.settings = sanitizeSettings(saved.settings);
    if (!Array.isArray(saved.teams)) saved.teams = ['', '', '', ''];
    while (saved.teams.length < 4) saved.teams.push('');
    while (saved.players.length < 1) saved.players.push('');
    return saved;
  }

  function saveSetup() {
    Store.set(SETUP_KEY, ui.setup);
  }

  /* ------------------------------------------------------------------ */
  /* Zustand der Oberfläche                                              */
  /* ------------------------------------------------------------------ */

  const params = new URLSearchParams(location.search);
  const prefs = Object.assign({ name: '' }, Store.get(PREFS_KEY) || {});

  const ui = {
    screen: 'home',
    ctrl: null,
    token: null,
    view: null,
    status: null,
    setup: loadSetup(),
    name: prefs.name || '',
    joinCode: Net.cleanCode(params.get('raum') || ''),
    error: null,
    modal: null,
    confirm: null,
    toast: null,
    focus: null,
    prefs,
    addName: '',
    sel: null, // ausgewähltes Feld (Lupe)
    cardSel: null, // ausgewählte Kartenfarbe (Index) vor dem Bestätigen
    secret: false, // Gerät: geheime Karte wird gerade gezeigt
    peek: false, // Gerät: Zielfarbe nochmal ansehen
    cueText: '',
    placeFor: null, // Laptop setzt (gleichzeitig) für diese Person
    colorFor: null, // Farbauswahl offen für diese Person (Mitspielende-Fenster)
    deadline: null, // Zeit pro Stein: Ende (lokale Uhr)
    timeoutAt: null, // für diesen Stand wurde 'timeout' schon geschickt
  };
  if (ui.joinCode) ui.screen = 'join';

  function savePrefs() {
    ui.prefs.name = ui.name;
    Store.set(PREFS_KEY, ui.prefs);
  }

  function toast(text) {
    ui.toast = text;
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(() => {
      ui.toast = null;
      render();
    }, 2800);
    render();
  }

  function vibrate(p) {
    if (navigator.vibrate) navigator.vibrate(p);
  }

  /** Bildschirm während des Spiels anlassen */
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
    ui.view = null;
    ui.status = null;
    ui.error = null;
    ui.screen = 'connecting';
    session(ACTIVE_KEY, kind);
    try {
      ui.ctrl = factory({ onView: guard(handleView), onStatus: guard(handleStatus), onKicked: guard(handleKicked) });
    } catch (err) {
      ui.ctrl = null;
      ui.token = null;
      session(ACTIVE_KEY, null);
      ui.screen = kind === 'client' ? 'join' : 'setup';
      ui.error = 'Verbindung nicht möglich: ' + err.message;
    }
    render();
  }

  function startStage(opts) {
    startController('stage', (cb) => new StageController(opts, cb));
  }

  function startClient(opts) {
    startController('client', (cb) => new ClientController(opts, cb));
  }

  function resetTurnUi() {
    ui.sel = null;
    ui.cardSel = null;
    ui.secret = false;
    ui.peek = false;
    ui.cueText = '';
    ui.placeFor = null;
  }

  function stopController(keepSave) {
    if (ui.ctrl) ui.ctrl.leave(keepSave);
    ui.ctrl = null;
    ui.token = null;
    ui.view = null;
    ui.modal = null;
    ui.deadline = null;
    resetTurnUi();
    session(ACTIVE_KEY, null);
    keepAwake(false);
  }

  function goHome(keepSave) {
    stopController(keepSave);
    ui.screen = 'home';
    history.replaceState(null, '', location.pathname);
    render();
  }

  function savedGames() {
    const now = Date.now();
    const stage = Store.get(KEYS.stage);
    const client = Store.get(KEYS.client);
    return {
      stage: stage && stage.state && stage.state.game === E.GAME && stage.state.phase !== 'end' && now - (stage.savedAt || 0) < RESUME_MAX_AGE ? stage : null,
      client: client && client.code && now - (client.savedAt || 0) < RESUME_MAX_AGE ? client : null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Ereignisse aus dem Controller                                       */
  /* ------------------------------------------------------------------ */

  function handleView(v) {
    const prev = ui.view;
    ui.view = v;
    ui.screen = 'game';
    keepAwake(v.phase !== 'end');
    if (!prev || prev.phase !== v.phase || prev.turnNo !== v.turnNo || prev.round !== v.round || prev.cueRound !== v.cueRound) {
      const keepSecret = prev && prev.turnNo === v.turnNo && prev.phase === 'pick' && v.phase === 'pick';
      const secret = ui.secret;
      resetTurnUi();
      if (keepSecret) ui.secret = secret;
    }
    // Ausgewähltes Feld inzwischen belegt? (reihum)
    if (ui.sel && v.settings.order === 'turns' && v.stones.some((x) => Board.same(x, ui.sel)) && v.phase === 'place') ui.sel = null;
    if (ui.placeFor && !v.waiting.includes(ui.placeFor)) {
      ui.placeFor = null;
      ui.sel = null;
    }
    ui.deadline = v.timerLeft != null ? Date.now() + v.timerLeft : null;
    transitions(prev, v);
    render();
  }

  function handleStatus(status, info) {
    ui.status = status;
    if (status === 'error') {
      const e = (info || {}).error;
      const msg =
        e === 'not-found'
          ? 'Kein Spiel mit diesem Code gefunden. Stimmt der Code und ist die Farbtafel noch online?'
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
    toast(reason === 'kicked' ? 'Du wurdest aus dem Spiel entfernt.' : 'Das Spiel ist vorbei. 🎨');
  }

  function myTurn(v) {
    if (!v.me.id || v.phase !== 'place') return false;
    return v.settings.order === 'simultaneous' ? v.waiting.includes(v.me.id) : v.current === v.me.id;
  }

  /** Sounds, Vibration, Konfetti und die Aufdeck-Animation bei Zustandswechseln */
  function transitions(prev, v) {
    if (!prev) return;
    const phone = !v.me.stage;
    const ev = v.event;
    const fresh = ev && (!prev.event || prev.event.n !== ev.n);
    if (fresh) {
      if (ev.kind === 'joined' && !phone) toast(`📱 ${ev.name} ist dabei!`);
      if (ev.kind === 'placed' && !phone) Sounds.plop();
      if (ev.kind === 'cue' && !phone) Sound.start();
      if (ev.kind === 'timeout') toast(`⏱ Zeit um – ${joinNames(ev.names)} ${ev.names.length === 1 ? 'setzt' : 'setzen'} diesmal aus`);
      if (ev.kind === 'skip' && !phone) toast(`⏭ ${joinNames(ev.names)} ${ev.names.length === 1 ? 'setzt' : 'setzen'} aus`);
      if (ev.kind === 'tiebreak') toast(`⚔️ Gleichstand – Stechen zwischen ${joinNames(ev.names)}!`);
    }
    if (phone) {
      if (myTurn(v) && !myTurn(prev)) vibrate([80, 40, 80]);
      if (v.phase === 'pick' && prev.phase !== 'pick' && v.secret) vibrate(200);
    }
    if (v.phase === 'reveal' && prev.phase !== 'reveal' && v.result) startReveal(v, phone);
    if (v.phase === 'end' && prev.phase !== 'end') {
      Sound.fanfare();
      setTimeout(() => confetti(v.players.map((p) => p.hex), 220), 150);
    }
  }

  /** Trommelwirbel → Rahmen → Punkte Stein für Stein (die CSS-Animation läuft mit denselben Zeiten) */
  function startReveal(v, phone) {
    const res = v.result;
    if (phone) {
      const line = res.lines.find((l) => l.id === v.me.id);
      setTimeout(() => {
        if (line && line.bulls) {
          vibrate([150, 80, 300]);
          confetti([Board.color(res.target), '#ffffff'], 120);
        } else if ((line && line.points) || res.giver === v.me.id) vibrate(120);
      }, REVEAL_FRAME_S * 1000);
      return;
    }
    Sounds.drumroll(REVEAL_FRAME_S);
    setTimeout(() => {
      Sounds.frame();
      Sounds.reveal();
    }, REVEAL_FRAME_S * 1000);
    scoredStones(res).forEach((x, i) => setTimeout(() => Sounds.score(x.points), (REVEAL_FRAME_S + 0.5 + i * REVEAL_STEP_S) * 1000));
    if (res.lines.some((l) => l.bulls)) {
      const t = (REVEAL_FRAME_S + 0.6 + scoredStones(res).length * REVEAL_STEP_S) * 1000;
      setTimeout(() => confetti([Board.color(res.target), '#ffffff', Board.color(res.target)], 180), t);
    }
  }

  /** Steine mit Punkten, beste zuerst (Reihenfolge der Animation) */
  function scoredStones(res) {
    return res.stones.filter((x) => x.points > 0).sort((a, b) => a.points - b.points);
  }

  /* ---------- Zeit pro Stein ---------- */

  function timerText(ms) {
    return `${Math.ceil(ms / 1000)} s`;
  }

  setInterval(() => {
    if (!ui.deadline || !ui.view) return;
    const v = ui.view;
    const left = Math.max(0, ui.deadline - Date.now());
    const total = (v.settings.timer || 1) * 1000;
    for (const el of app.querySelectorAll('[data-timer]')) {
      el.querySelector('b').textContent = timerText(left);
      el.style.setProperty('--left', String(Math.min(1, left / total)));
      el.classList.toggle('is-low', left < 5000);
    }
    if (left <= 0 && v.me.host && v.phase === 'place' && ui.timeoutAt !== v.step) {
      ui.timeoutAt = v.step;
      dispatch('timeout', { at: v.step });
    }
  }, 250);

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
      case 'game':
        html = ui.view ? gameHtml(ui.view) : connectingHtml();
        break;
      default:
        html = homeHtml();
    }
    html += overlayHtml();
    html += modalHtml();
    if (ui.toast) html += `<div class="toast" role="status">${esc(ui.toast)}</div>`;
    window.morphdom(app, `<div id="app">${html}</div>`, {
      onBeforeElUpdated(fromEl, toEl) {
        if (fromEl === document.activeElement && (fromEl.tagName === 'INPUT' || fromEl.tagName === 'TEXTAREA' || fromEl.tagName === 'SELECT')) return false;
        // Die 480 Felder ändern sich nie – nur neu aufbauen, wenn sich die Beschriftung ändert
        if (fromEl.classList && fromEl.classList.contains('cells') && fromEl.dataset.k === toEl.dataset.k) return false;
        return true;
      },
    });
    if (ui.focus) {
      const el = app.querySelector(ui.focus);
      ui.focus = null;
      if (el) el.focus();
    }
  }

  /* ---------- Bausteine ---------- */

  function logoHtml(small) {
    const letters = 'Farbgefühl'.split('');
    const hues = [0, 2, 5, 9, 13, 16, 19, 22, 25, 28];
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="Farbgefühl">
      <span class="logo-icon" aria-hidden="true">🎨</span>
      <span class="logo-text">${letters.map((ch, i) => `<span style="--lc:${Board.COLORS[small ? 6 : 5][hues[i]]}">${ch}</span>`).join('')}</span>
    </div>`;
  }

  function seg(key, options, value, fmt, scope, num, disabled) {
    return `<div class="seg" role="group">${options
      .map(
        (o) =>
          `<button class="seg-btn ${o === value ? 'on' : ''}" data-act="set" data-key="${key}" data-value="${o}" data-scope="${scope}" ${num ? 'data-num="1"' : ''} aria-pressed="${o === value}" ${disabled ? 'disabled' : ''}>${fmt(o)}</button>`
      )
      .join('')}</div>`;
  }

  function switchHtml(key, on, scope, label, disabled) {
    return `<button class="switch ${on ? 'on' : ''}" data-act="toggle" data-key="${key}" data-scope="${scope}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" ${disabled ? 'disabled' : ''}><span class="switch-knob"></span>${on ? 'An' : 'Aus'}</button>`;
  }

  function setting(title, sub, control) {
    return `<div class="setting"><div class="setting-label"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div>${control}</div>`;
  }

  /** Spielende als ein Schalter: auto / 1 / 2 / 3 Durchgänge / bis 50 */
  function endValue(s) {
    return s.to50 ? 'to50' : String(s.rounds);
  }

  function settingsHtml(s, scope) {
    const live = scope === 'live';
    const phones = s.input === 'phones';
    const rows = [];
    if (phones)
      rows.push(
        setting(
          '🔁 Setzen',
          s.order === 'simultaneous' ? 'Alle setzen gleichzeitig geheim – mehrere Steine pro Feld erlaubt' : 'Reihum wie im Original – ein Stein pro Feld, Blockieren ist Taktik',
          seg('order', ['turns', 'simultaneous'], s.order, (o) => (o === 'turns' ? '👉 Reihum' : '⚡ Gleichzeitig'), scope)
        )
      );
    rows.push(
      setting(
        '🏁 Spielende',
        s.to50
          ? `Wer zuerst ${GOAL} Punkte hat, gewinnt`
          : s.rounds
            ? `Jede ${isTeams(s) ? 'Team' : 'Person'} gibt ${s.rounds}× den Hinweis`
            : isTeams(s)
              ? 'Automatisch: bei 2 Teams 3 Durchgänge, sonst 2'
              : 'Automatisch: bis 6 Personen 2 Durchgänge, sonst 1',
        seg('end', ['0', '1', '2', '3', 'to50'], endValue(s), (o) => (o === '0' ? 'Auto' : o === 'to50' ? `Bis ${GOAL}` : `${o}×`), scope)
      )
    );
    rows.push(
      setting(
        '💬 Zweiter Hinweis',
        s.secondCue ? 'Zwei Hinweise, zwei Steine pro Person' : '⚡ Schnell: nur ein Hinweis und ein Stein',
        switchHtml('secondCue', s.secondCue, scope, 'Zweiter Hinweis')
      )
    );
    rows.push(
      setting(
        '⌨️ Hinweis am Laptop eintippen',
        (s.typedCues ? 'Steht groß über der Tafel und wird geprüft' : 'Hinweis wird laut gesagt') + (phones ? ' · nur für Personen ohne Handy' : ''),
        switchHtml('typedCues', s.typedCues, scope, 'Hinweis eintippen')
      )
    );
    rows.push(
      setting(
        '🚫 Hinweis-Prüfung',
        s.cueCheck ? 'Warnt bei Grundfarben, hell/dunkel, Koordinaten und schon benutzten Hinweisen' : 'Keine Warnungen',
        switchHtml('cueCheck', s.cueCheck, scope, 'Hinweis-Prüfung')
      )
    );
    rows.push(
      setting(
        '🔤 Koordinaten',
        s.coords === 'all' ? 'In jedem Feld – hilft bei Farbsehschwäche' : s.coords === 'edge' ? 'Klein am Rand' : 'Keine Beschriftung',
        seg('coords', ['edge', 'all', 'off'], s.coords, (o) => ({ edge: 'Rand', all: 'Jedes Feld', off: 'Aus' })[o], scope)
      )
    );
    rows.push(setting('⏱ Zeit pro Stein', s.timer ? `${s.timer} Sekunden, dann wird ausgesetzt` : 'Ohne Zeitlimit', seg('timer', TIMERS, s.timer, (o) => (o ? `${o} s` : 'Aus'), scope, true)));
    rows.push(
      setting(
        '👥 Teams',
        live ? (s.teams ? `${s.teams} Teams` : 'Jede Person für sich') + ' · steht fest' : s.teams ? `${s.teams} Teams beraten sich und setzen gemeinsam` : 'Jede Person spielt für sich',
        seg('teams', TEAMS, s.teams, (o) => (o ? String(o) : 'Aus'), scope, true, live)
      )
    );
    rows.push(setting('🎯 Freie Wahl', s.freePick ? 'Hinweisgeber wählt ein beliebiges Feld der Tafel' : 'Hinweisgeber wählt eine von 4 Kartenfarben', switchHtml('freePick', s.freePick, scope, 'Freie Wahl')));
    rows.push(setting('🙈 Blind', s.blind ? 'Hinweisgeber sieht nur die Farbe, nicht die Tafel drumherum' : 'Hinweisgeber sieht die Farbe auf der Tafel', switchHtml('blind', s.blind, scope, 'Blind')));
    rows.push(setting('🍻 Trinkregeln', s.drinks ? 'Stein völlig daneben → 1 Schluck · Volltreffer → 2 verteilen' : 'Ohne Trinkregeln', switchHtml('drinks', s.drinks, scope, 'Trinkregeln')));
    return `<div class="settings">${rows.join('')}</div>`;
  }

  function summaryText(s) {
    const parts = [INPUT[s.input].label, endText(s)];
    if (s.input === 'phones') parts.push(s.order === 'simultaneous' ? 'gleichzeitig' : 'reihum');
    if (!s.secondCue) parts.push('⚡ Schnell');
    if (s.timer) parts.push(`⏱ ${s.timer} s`);
    if (s.teams) parts.push(`👥 ${s.teams} Teams`);
    if (s.freePick) parts.push('🎯 Freie Wahl');
    if (s.blind) parts.push('🙈 Blind');
    if (s.drinks) parts.push('🍻');
    return parts.join(' · ');
  }

  /* ---------- Farbtafel ---------- */

  const CELLS = {};
  /** Die 480 Felder (einmal gebaut, morphdom lässt sie danach in Ruhe) */
  function cellsHtml(labels) {
    const k = labels ? 'l' : 'n';
    if (!CELLS[k]) {
      let h = '';
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = { r, c };
          h += labels
            ? `<i style="background:${Board.COLORS[r][c]}" class="${lightCell(cell) ? '' : 'dk'}">${Board.label(cell)}</i>`
            : `<i style="background:${Board.COLORS[r][c]}"></i>`;
        }
      }
      CELLS[k] = h;
    }
    return `<div class="cells" data-k="${k}">${CELLS[k]}</div>`;
  }

  /** Position eines Feld-Bereichs auf der Tafel (oben links r/c, w × h Felder) */
  function box(r, c, w, h) {
    return `left:${(c / COLS) * 100}%;top:${(r / ROWS) * 100}%;width:${(w / COLS) * 100}%;height:${(h / ROWS) * 100}%`;
  }

  function stoneInk(p) {
    return p && LIGHT_STONES.includes(p.color) ? '#111' : '#fff';
  }

  function initial(name) {
    const m = /[\p{L}\p{N}]/u.exec(name || '');
    return m ? m[0].toUpperCase() : '•';
  }

  /** Steine (bei gleichzeitigem Setzen ggf. mehrere pro Feld → leicht versetzt) */
  function stonesHtml(v, stones, res) {
    const count = {};
    for (const x of stones) count[x.r + ',' + x.c] = (count[x.r + ',' + x.c] || 0) + 1;
    const seen = {};
    const order = res ? scoredStones(res) : [];
    return stones
      .map((x, idx) => {
        const key = x.r + ',' + x.c;
        const k = (seen[key] = (seen[key] || 0) + 1) - 1;
        const n = count[key];
        const ang = (k / n) * Math.PI * 2;
        const dx = n > 1 ? Math.cos(ang) * 28 : 0;
        const dy = n > 1 ? Math.sin(ang) * 28 : 0;
        const p = pl(v, x.player);
        let badge = '';
        let cls = '';
        if (res) {
          const scored = order.findIndex((o) => o.player === x.player && o.r === x.r && o.c === x.c && o.round === x.round);
          const pts = scored >= 0 ? order[scored].points : 0;
          cls = pts ? `has-pts p${pts}` : 'no-pts';
          if (pts) badge = `<em class="pts" style="--d:${(REVEAL_FRAME_S + 0.5 + scored * REVEAL_STEP_S).toFixed(2)}s">+${pts}</em>`;
        }
        const last = !res && v.phase === 'place' && idx === stones.length - 1 ? 'is-new' : '';
        return `<span class="stone r${x.round} ${cls} ${last}" style="left:${((x.c + 0.5) / COLS) * 100}%;top:${((x.r + 0.5) / ROWS) * 100}%;--pc:${p ? p.hex : '#888'};--ink:${stoneInk(p)};--dx:${dx}%;--dy:${dy}%" title="${esc(p ? p.name : '')}"><b>${esc(initial(p && p.name))}</b>${badge}</span>`;
      })
      .join('');
  }

  /**
   * Farbtafel.
   * o: { mode: 'place' | 'pick' | '' (anklickbar?), stones, target (geheim markiert), marks: [{cell, text}],
   *      reveal: result, sel: Feld, cls: zusätzliche Klasse }
   */
  function boardHtml(v, o) {
    const s = v.settings;
    const coords = s.coords;
    const parts = [];
    if (o.reveal) {
      const t = o.reveal.target;
      parts.push(`<span class="dim" style="${box(t.r - 2, t.c - 2, 5, 5)}"></span>`);
      parts.push(`<span class="ring" style="${box(t.r - 2, t.c - 2, 5, 5)}"></span>`);
      parts.push(`<span class="frame" style="${box(t.r - 1, t.c - 1, 3, 3)}"></span>`);
      parts.push(`<span class="target-mark is-revealed" style="${box(t.r, t.c, 1, 1)}"></span>`);
    }
    if (o.target) parts.push(`<span class="target-mark is-secret ${lightCell(o.target) ? 'on-light' : ''}" style="${box(o.target.r, o.target.c, 1, 1)}"><b>★</b></span>`);
    for (const m of o.marks || []) parts.push(`<span class="card-mark ${m.on ? 'on' : ''} ${lightCell(m.cell) ? 'on-light' : ''}" style="${box(m.cell.r, m.cell.c, 1, 1)}"><b>${m.text}</b></span>`);
    if (o.stones) parts.push(stonesHtml(v, o.stones, o.reveal));
    if (o.sel) parts.push(`<span class="sel-mark ${lightCell(o.sel) ? 'on-light' : ''}" style="${box(o.sel.r, o.sel.c, 1, 1)}"></span>`);
    const edge = coords === 'edge';
    const colLabels = edge ? `<div class="b-cols" aria-hidden="true">${Array.from({ length: COLS }, (_, c) => `<span>${c + 1}</span>`).join('')}</div>` : '';
    const rowLabels = edge ? `<div class="b-rows" aria-hidden="true">${Board.ROW_NAMES.split('').map((ch) => `<span>${ch}</span>`).join('')}</div>` : '';
    return `
      <div class="board-wrap ${edge ? 'with-edge' : ''} ${o.cls || ''}">
        ${colLabels}${rowLabels}
        <div class="board ${o.mode ? 'is-click' : ''} ${o.reveal ? 'is-reveal' : ''}" ${o.mode ? `data-board="${o.mode}"` : ''} role="${o.mode ? 'grid' : 'img'}" aria-label="Farbtafel">
          ${cellsHtml(coords === 'all')}
          <div class="marks">${parts.join('')}</div>
        </div>
      </div>`;
  }

  /** Lupe: 7 × 7-Ausschnitt um das ausgewählte Feld, mit Pfeilen und Bestätigen */
  function loupeHtml(v, mode, stones, confirmText) {
    const sel = ui.sel;
    if (!sel) {
      return `<div class="loupe loupe-empty"><span>🔍</span><p>${mode === 'pick' ? 'Tippe auf die Tafel, um eine Farbe auszuwählen.' : 'Tippe auf die Tafel – hier erscheint die Lupe zum genauen Zielen.'}</p></div>`;
    }
    const half = Math.floor(LOUPE / 2);
    const r0 = Math.max(0, Math.min(ROWS - LOUPE, sel.r - half));
    const c0 = Math.max(0, Math.min(COLS - LOUPE, sel.c - half));
    const cells = [];
    for (let r = r0; r < r0 + LOUPE; r++) {
      for (let c = c0; c < c0 + LOUPE; c++) {
        const cell = { r, c };
        const here = (stones || []).filter((x) => Board.same(x, cell));
        const dots = here.map((x) => `<i class="ldot" style="--pc:${(pl(v, x.player) || {}).hex || '#888'}"></i>`).join('');
        const on = Board.same(cell, sel);
        cells.push(
          `<button class="lcell ${on ? 'on' : ''} ${lightCell(cell) ? 'on-light' : ''} ${here.length ? 'taken' : ''}" style="background:${Board.color(cell)}" data-act="sel-cell" data-r="${r}" data-c="${c}" aria-label="${Board.label(cell)}">${dots}</button>`
        );
      }
    }
    const taken = mode === 'place' && v.settings.order === 'turns' && (stones || []).some((x) => Board.same(x, sel));
    const label = v.settings.coords !== 'off' ? `<span class="loupe-label">${Board.label(sel)}</span>` : '';
    return `
      <div class="loupe">
        <div class="loupe-grid" style="--n:${LOUPE}">${cells.join('')}</div>
        <div class="loupe-side">
          <div class="loupe-swatch" style="background:${Board.color(sel)}">${label}</div>
          <div class="arrows">
            <span></span><button class="icon-btn" data-act="sel-move" data-dr="-1" data-dc="0" aria-label="nach oben">↑</button><span></span>
            <button class="icon-btn" data-act="sel-move" data-dr="0" data-dc="-1" aria-label="nach links">←</button>
            <span></span>
            <button class="icon-btn" data-act="sel-move" data-dr="0" data-dc="1" aria-label="nach rechts">→</button>
            <span></span><button class="icon-btn" data-act="sel-move" data-dr="1" data-dc="0" aria-label="nach unten">↓</button><span></span>
          </div>
        </div>
        <button class="btn btn-primary btn-wide btn-big loupe-ok" data-act="confirm-sel" data-mode="${mode}" ${taken ? 'disabled' : ''}>${taken ? 'Feld ist belegt' : confirmText || 'Hier setzen ✓'}</button>
      </div>`;
  }

  function timerHtml(v) {
    if (v.timerLeft == null || !ui.deadline) return '';
    const left = Math.max(0, ui.deadline - Date.now());
    return `<div class="timer" data-timer style="--left:${Math.min(1, left / ((v.settings.timer || 1) * 1000))}"><span class="timer-bar"></span><b>${timerText(left)}</b></div>`;
  }

  /* ---------- Startseite ---------- */

  function homeHtml() {
    const saves = savedGames();
    const resume = [];
    if (saves.stage) {
      const st = saves.stage.state;
      resume.push(`
        <div class="resume">
          <button class="btn btn-ghost btn-wide" data-act="resume-stage">▶ Spiel fortsetzen
            <small>${INPUT[st.settings.input || 'single'].label} · ${st.players.length} ${st.settings.teams ? 'Teams' : 'Personen'} · Zug ${st.turnNo + 1}</small></button>
          <button class="icon-btn" data-act="discard-stage" title="Spielstand löschen" aria-label="Spielstand löschen">✕</button>
        </div>`);
    }
    if (saves.client) {
      resume.push(`
        <div class="resume">
          <button class="btn btn-ghost btn-wide" data-act="resume-client">▶ Zurück ins Spiel
            <small>Raum ${esc(saves.client.code)} · als ${esc(saves.client.name)}</small></button>
          <button class="icon-btn" data-act="discard-client" title="Verwerfen" aria-label="Verwerfen">✕</button>
        </div>`);
    }
    const modeCard = (id) => `
      <button class="mode-card mode-${id}" data-act="new-game" data-input="${id}">
        <span class="mode-icon">${INPUT[id].icon}</span>
        <span class="mode-body"><b>${INPUT[id].label}</b><small>${INPUT[id].text}</small></span>
        <span class="mode-go">Spielen →</span>
      </button>`;
    const strip = [3, 6, 9, 12].map((r) => `<div class="strip">${Board.COLORS[r].map((hex) => `<i style="background:${hex}"></i>`).join('')}</div>`).join('');
    return `
    <div class="screen home">
      <a class="btn btn-ghost btn-small hub-back" href="../">← Alle Spiele</a>
      <div class="home-hero">
        ${logoHtml()}
        <p class="tagline">480 Farbtöne, ein Wort als Hinweis – wer trifft die Farbe?</p>
        <div class="home-strips" aria-hidden="true">${strip}</div>
      </div>
      ${resume.join('')}
      <div class="mode-cards">${modeCard('phones')}${modeCard('single')}</div>
      <div class="home-links">
        <button class="btn btn-ghost" data-act="join-screen">📱 Mit dem Handy beitreten</button>
        <button class="btn btn-link" data-act="rules">📖 Spielregeln</button>
      </div>
      <p class="home-foot">${MIN_PLAYERS}–${MAX_PLAYERS} Personen oder ${MIN_TEAMS}–4 Teams · nach Hues and Cues</p>
    </div>`;
  }

  /* ---------- Spiel anlegen ---------- */

  function filledNames() {
    return ui.setup.players.map((n) => n.trim()).filter(Boolean);
  }

  function setupHtml() {
    const s = ui.setup;
    const st = s.settings;
    const phones = st.input === 'phones';
    const card = (id) => `
      <button class="input-card ${st.input === id ? 'on' : ''}" data-act="set" data-key="input" data-value="${id}" data-scope="setup" aria-pressed="${st.input === id}">
        <span class="input-icon">${INPUT[id].icon}</span>
        <b>${INPUT[id].label}</b>
        <small>${INPUT[id].text}</small>
      </button>`;
    let people;
    if (st.teams) {
      const rows = Array.from({ length: st.teams }, (_, i) => {
        const c = PLAYER_COLORS[i];
        return `
        <div class="player-row">
          <span class="player-num"><i class="dot" style="--pc:${c.hex}"></i></span>
          <input class="input" type="text" maxlength="24" placeholder="Team ${c.name}" value="${esc(s.teams[i] || '')}"
            data-field="team-name" data-team="${i}" autocomplete="off" enterkeyhint="next" />
        </div>`;
      }).join('');
      people = `
        <h2>Teams <small class="muted">${phones ? '(die Handys wählen ihr Team in der Lobby)' : '(ihr beratet euch im Team und setzt gemeinsam)'}</small></h2>
        <div class="ts-players">${rows}</div>`;
    } else {
      const minRows = phones ? 1 : MIN_PLAYERS;
      const rows = s.players
        .map(
          (p, i) => `
          <div class="player-row">
            <span class="player-num">${i + 1}</span>
            <input class="input" type="text" maxlength="24" placeholder="${phones ? 'Name (ohne Handy)' : 'Name'}" value="${esc(p)}"
              data-field="player-name" data-player="${i}" autocomplete="off" enterkeyhint="next" />
            ${s.players.length > minRows ? `<button class="icon-btn" data-act="remove-player" data-player="${i}" aria-label="Person entfernen">✕</button>` : ''}
          </div>`
        )
        .join('');
      people = `
        <h2>Wer spielt mit? <small class="muted">${
          phones ? '(Handys tragen sich gleich selbst ein – hier nur, wer kein Handy hat)' : `(${MIN_PLAYERS}–${MAX_PLAYERS} Personen, in Sitzreihenfolge)`
        }</small></h2>
        <div class="ts-players">${rows}</div>
        ${s.players.length < MAX_PLAYERS ? `<button class="btn btn-small btn-ghost add-player" data-act="add-player">＋ Person</button>` : ''}`;
    }
    return `
    <div class="screen setup">
      <header class="screen-head">
        <button class="btn btn-ghost btn-small" data-act="home">← Zurück</button>
        <h1>Neues Spiel</h1>
        <button class="icon-btn" data-act="rules" aria-label="Spielregeln">?</button>
      </header>
      ${ui.error ? `<div class="alert">${esc(ui.error)}</div>` : ''}
      <section class="panel">
        <h2>Spielweise</h2>
        <div class="input-cards">${card('phones')}${card('single')}</div>
      </section>
      <section class="panel">${people}</section>
      <section class="panel">
        <h2>Einstellungen</h2>
        ${settingsHtml(st, 'setup')}
      </section>
      <div class="sticky-start">
        <button class="btn btn-primary btn-big" data-act="create-game">${phones ? 'Raum öffnen 📱' : 'Los geht’s 🎨'}</button>
      </div>
    </div>`;
  }

  /* ---------- Beitreten (Handy) ---------- */

  function nightHint() {
    return `<p class="night-hint">🌙 Für echte Farben: <b>Nachtmodus/Blaulichtfilter aus</b> und Helligkeit hoch. Entscheidend ist die Tafel auf dem Laptop.</p>`;
  }

  function joinHtml() {
    return `
    <div class="screen join">
      <header class="screen-head">
        <button class="btn btn-ghost btn-small" data-act="home">← Zurück</button>
        <h1>Mitspielen</h1>
        <span></span>
      </header>
      <div class="join-hero">${logoHtml(true)}</div>
      ${ui.error ? `<div class="alert">${esc(ui.error)}</div>` : ''}
      <form class="panel" data-form="join">
        <label class="label" for="name-input">Dein Name</label>
        <input id="name-input" class="input input-big" type="text" maxlength="24" placeholder="z.B. Alex" value="${esc(ui.name)}" data-field="name" autocomplete="nickname" enterkeyhint="next" />
        <label class="label" for="code-input">Raum-Code <small class="muted">(steht auf der Farbtafel)</small></label>
        <input id="code-input" class="input input-code" type="text" maxlength="8" placeholder="ABCDE" value="${esc(ui.joinCode)}" data-field="join-code" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" />
        <button class="btn btn-primary btn-wide btn-big" type="submit">Beitreten</button>
      </form>
      ${nightHint()}
      <p class="muted small center">Steht dein Name schon auf der Tafel, gib ihn genauso ein – dann bist du gleich zugeordnet.</p>
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
  /* Spiel                                                               */
  /* ------------------------------------------------------------------ */

  /** device = Ein Gerät · stage = Farbtafel mit Handys · phone = Handy */
  function kindOf(v) {
    if (!v.me.stage) return 'phone';
    return v.settings.input === 'phones' ? 'stage' : 'device';
  }

  function roomBoxHtml(room, big) {
    if (!room) return '';
    if (room.state === 'error') return `<div class="alert">Der Raum konnte nicht geöffnet werden. Prüfe die Internetverbindung – es wird weiter versucht.</div>`;
    if (!room.code || room.state !== 'online') return `<div class="qr-wait"><div class="spinner" aria-hidden="true"></div><p>Raum wird geöffnet…</p></div>`;
    const link = inviteLink(room.code);
    return `
      <div class="qr ${big ? 'qr-big' : ''}">${qrSvg(link)}</div>
      <div class="room-label">Raum-Code</div>
      <div class="room-code" data-testid="room-code">${esc(room.code)}</div>
      <p class="small muted link-text">${esc(link)}</p>`;
  }

  function statusBanner() {
    if (ui.ctrl && ui.ctrl.mode === 'client' && (ui.status === 'reconnecting' || ui.status === 'connecting')) {
      return `<div class="status-banner"><span class="spinner-sm"></span> Verbindung zur Farbtafel unterbrochen – verbinde neu…</div>`;
    }
    return '';
  }

  function turnTitle(v) {
    if (v.phase === 'end') return 'Spiel vorbei';
    if (v.phase === 'lobby') return 'Lobby';
    if (v.tiebreak) return '⚔️ Stechen';
    if (v.settings.to50) return `Zug ${v.turnNo + 1} · bis ${GOAL}`;
    return `Zug ${v.turnNo + 1} / ${v.turnsTotal}`;
  }

  function gameHtml(v) {
    const kind = kindOf(v);
    let main;
    if (kind === 'phone') main = phoneHtml(v);
    else if (v.phase === 'lobby') main = lobbyHtml(v);
    else if (v.phase === 'end') main = endHtml(v);
    else main = playHtml(v, kind);
    const info = `<b>${turnTitle(v)}</b><small>${PHASE_LABEL[v.phase]}</small>`;
    const room = v.room && v.room.code && v.me.host ? `<button class="pill pill-room" data-act="show-qr" title="Handys verbinden">📱 ${esc(v.room.code)}</button>` : '';
    const mine = kind === 'phone' ? pl(v, v.me.id) : null;
    const me = mine ? `<span class="g-me"><i class="dot" style="--pc:${mine.hex}"></i>${esc(isTeams(v.settings) ? mine.name : v.me.name)} · ${mine.score}</span>` : '';
    return `
      <div class="game kind-${kind} phase-${v.phase}">
        <header class="g-top">
          <button class="g-brand" data-act="menu" aria-label="Menü">${logoHtml(true)}</button>
          <div class="g-info">${info}</div>
          ${room}${me}
          <div class="g-actions">
            ${kind !== 'phone' ? `<button class="icon-btn" data-act="mute" aria-label="Ton an/aus" title="Ton an/aus">${Sound.muted ? '🔇' : '🔊'}</button>` : ''}
            <button class="icon-btn" data-act="menu" aria-label="Menü" title="Menü">☰</button>
          </div>
        </header>
        ${statusBanner()}
        <main class="g-main">${main}</main>
      </div>`;
  }

  /* ---------- Lobby (Mit Handys) ---------- */

  function playerChipsHtml(v, removable) {
    return v.players
      .map((p) => {
        const members = isTeams(v.settings) ? `<small>${p.members.length ? esc(p.members.map((m) => m.name).join(', ')) : 'noch niemand'}</small>` : '';
        return `<span class="chip ${p.online ? '' : 'is-offline'}"><i class="dot" style="--pc:${p.hex}"></i>${p.phone && !isTeams(v.settings) ? '<span aria-label="mit Handy">📱</span> ' : ''}${esc(p.name)}${members}${
          removable ? `<button class="chip-x" data-act="remove-player-live" data-player="${esc(p.id)}" aria-label="${esc(p.name)} entfernen">✕</button>` : ''
        }</span>`;
      })
      .join('');
  }

  function lobbyHtml(v) {
    const teams = isTeams(v.settings);
    return `
      <div class="lobby-grid">
        <section class="panel join-panel">
          <h2>📱 Handys verbinden</h2>
          <p class="muted">QR-Code scannen und Namen eingeben.</p>
          ${roomBoxHtml(v.room, true)}
        </section>
        <div class="lobby-side">
          <section class="panel">
            <div class="row-between"><h2>${teams ? 'Teams' : 'Wer spielt mit?'} <small class="muted">(${v.players.length})</small></h2><button class="btn btn-ghost btn-small" data-act="people">👥 Bearbeiten</button></div>
            <div class="chips ${teams ? 'chips-teams' : ''}">${playerChipsHtml(v, !teams) || '<span class="muted">Noch niemand da – QR-Code scannen!</span>'}</div>
            <p class="muted small">Die Reihenfolge ist die Sitzordnung (für „reihum“) – unter „Bearbeiten“ verschieben.</p>
          </section>
          <section class="panel">
            <div class="row-between"><h2>Einstellungen</h2><button class="btn btn-ghost btn-small" data-act="settings">⚙️ Ändern</button></div>
            <p class="muted">${esc(summaryText(v.settings))}</p>
          </section>
          <div class="sticky-start">
            <button class="btn btn-primary btn-big" data-act="open" ${v.lobbyProblem ? 'disabled' : ''}>Los geht’s 🎨</button>
            ${v.lobbyProblem ? `<p class="muted small center">${esc(v.lobbyProblem)}</p>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ---------- Spielfeld (Laptop / Ein Gerät) ---------- */

  function scoreboardHtml(v) {
    const rows = v.players
      .map((p) => {
        const role = p.id === v.giver && v.phase !== 'end' ? '<span class="role" title="gibt den Hinweis">🗣️</span>' : '';
        const turn = v.phase === 'place' && (v.current === p.id || (v.settings.order === 'simultaneous' && v.waiting.includes(p.id)));
        const done = v.phase === 'place' && v.settings.order === 'simultaneous' && p.id !== v.giver && !v.waiting.includes(p.id);
        return `<li class="sb-row ${turn ? 'is-turn' : ''} ${p.online ? '' : 'is-offline'}">
            <i class="dot" style="--pc:${p.hex}"></i>
            <span class="sb-name">${esc(p.name)}${p.phone ? '' : v.settings.input === 'phones' && !isTeams(v.settings) ? ' <small title="ohne Handy">🖥️</small>' : ''}</span>
            ${role}${turn ? '<span class="role">🎯</span>' : ''}${done ? '<span class="role">✓</span>' : ''}
            <b class="sb-score">${p.score}</b>
          </li>`;
      })
      .join('');
    return `<ol class="scoreboard">${rows}</ol>`;
  }

  function cueBannerHtml(v) {
    const giver = who(v, v.giver);
    if (v.phase === 'pick') return `<div class="cue-banner is-wait">🎨 ${giver} wählt eine Farbe …</div>`;
    const shown = cuesHtml(v.cues);
    if (v.phase === 'cue' && !shown) return `<div class="cue-banner is-wait">💭 ${giver} überlegt sich einen Hinweis …</div>`;
    if (v.phase === 'cue') return `<div class="cue-banner">${shown}<small>💭 ${giver} überlegt sich Hinweis 2 …</small></div>`;
    return `<div class="cue-banner">${shown || '–'}<small>Hinweis von ${giver}</small></div>`;
  }

  /** Steine auf der Bühne: im Aufdecken die gewerteten */
  function playHtml(v, kind) {
    const reveal = v.phase === 'reveal' ? v.result : null;
    const placeMode = v.phase === 'place' && stagePlacing(v);
    const board = boardHtml(v, {
      mode: placeMode ? 'place' : '',
      stones: reveal ? reveal.stones : v.stones,
      reveal,
      sel: placeMode ? ui.sel : null,
      cls: 'board-main',
    });
    return `
      <div class="play">
        <section class="play-main">
          ${reveal ? revealBannerHtml(v, reveal) : cueBannerHtml(v)}
          ${board}
        </section>
        <aside class="play-side">
          ${sideHtml(v, kind)}
          <section class="panel panel-tight">${scoreboardHtml(v)}</section>
        </aside>
      </div>`;
  }

  /** Setzt der Laptop gerade für jemanden? */
  function stagePlacing(v) {
    if (v.phase !== 'place') return false;
    if (v.settings.order === 'simultaneous') return !!ui.placeFor;
    const p = pl(v, v.current);
    return !!p && p.stage;
  }

  function giverOnStage(v) {
    const g = pl(v, v.giver);
    return !!g && g.stage && !!v.secret;
  }

  function sideHtml(v, kind) {
    switch (v.phase) {
      case 'pick':
        return pickSideHtml(v);
      case 'cue':
        return cueSideHtml(v);
      case 'place':
        return placeSideHtml(v, kind);
      case 'reveal':
        return revealSideHtml(v);
      default:
        return '';
    }
  }

  function pickSideHtml(v) {
    const g = pname(v, v.giver);
    if (!giverOnStage(v)) {
      return `<section class="panel side-wait"><div class="big-emoji">🎨</div><p><b>${esc(g)}</b> wählt am Handy eine Farbe …</p></section>`;
    }
    return `
      <section class="panel side-secret">
        <div class="big-emoji">🙈</div>
        <h2>Alle wegschauen!</h2>
        <p>Nur <b>${esc(g)}</b> darf jetzt auf den Bildschirm schauen.</p>
        <button class="btn btn-primary btn-wide btn-big" data-act="secret-show">👀 Ich bin ${esc(g)} – zeigen</button>
      </section>`;
  }

  function cueCheckHtml(v, round) {
    if (!v.settings.cueCheck || !ui.cueText.trim()) return '';
    const r = Cues.check(ui.cueText, { round, used: v.usedCues });
    if (r.ok) return `<p class="cue-ok">✓ Passt</p>`;
    return `<ul class="cue-warn">${r.problems.map((p) => `<li>⚠️ ${esc(p.text)}</li>`).join('')}</ul>`;
  }

  /** Eingabe für den Hinweis (Handy und Laptop mit „Hinweis eintippen“) */
  function cueFormHtml(v, typed) {
    const round = v.cueRound;
    const send = round === 1 ? 'Hinweis zeigen ✓' : 'Hinweis 2 zeigen ✓';
    const check = v.settings.cueCheck ? Cues.check(ui.cueText, { round, used: v.usedCues }) : { ok: true, problems: [] };
    const warn = ui.cueText.trim() && !check.ok;
    const form = typed
      ? `<form class="cue-form" data-form="cue">
          <input class="input input-big" type="text" maxlength="${Cues.MAX_LEN}" placeholder="${round === 1 ? 'Ein Wort, z.B. Avocado' : 'Ein oder zwei Wörter'}"
            value="${esc(ui.cueText)}" data-field="cue" autocomplete="off" autocapitalize="sentences" spellcheck="false" enterkeyhint="send" />
          <div data-cue-check>${cueCheckHtml(v, round)}</div>
          <button class="btn ${warn ? 'btn-ghost' : 'btn-primary'} btn-wide btn-big" type="submit" data-cue-send>${warn ? '⚠️ Trotzdem senden' : send}</button>
        </form>`
      : `<button class="btn btn-primary btn-wide btn-big" data-act="cue-spoken">🗣️ Hinweis ${round} gesagt – weiter</button>`;
    const skip = round === 2 ? `<button class="btn btn-ghost btn-wide" data-act="skip-cue">🙅 Kein zweiter Hinweis – aufdecken</button>` : '';
    const rules = `<p class="muted small">Verboten: Grundfarben (rot, blau …), hell/dunkel, Koordinaten, Dinge im Raum und schon benutzte Hinweise. ${
      round === 1 ? '<b>Genau ein Wort.</b>' : '<b>Ein oder zwei Wörter</b> – oder verzichten, wenn die Steine schon gut liegen.'
    }</p>`;
    return `${form}${skip}${rules}`;
  }

  function cueSideHtml(v) {
    const g = pname(v, v.giver);
    const round = v.cueRound;
    if (!giverOnStage(v)) {
      return `<section class="panel side-wait"><div class="big-emoji">💭</div><p><b>${esc(g)}</b> tippt Hinweis ${round} am Handy …</p></section>`;
    }
    return `
      <section class="panel side-cue">
        <h2>💬 Hinweis ${round} von ${esc(g)}</h2>
        ${cueFormHtml(v, v.settings.typedCues)}
        <button class="btn btn-ghost btn-small btn-wide" data-act="peek">👁 Farbe nochmal ansehen (nur ${esc(g)})</button>
      </section>`;
  }

  function placeSideHtml(v) {
    const round = v.round;
    const total = v.settings.secondCue ? 2 : 1;
    const head = `<div class="row-between"><h2>🎯 Stein ${round}${total > 1 ? ' von 2' : ''}</h2>${timerHtml(v)}</div>`;
    if (v.settings.order === 'simultaneous') {
      const offline = v.waiting.map((id) => pl(v, id)).filter((p) => p && p.stage);
      const forBtns = offline
        .map((p) => `<button class="btn btn-small ${ui.placeFor === p.id ? 'btn-primary' : 'btn-ghost'}" data-act="place-for" data-player="${esc(p.id)}">🖥️ Für ${esc(p.name)} setzen</button>`)
        .join('');
      const loupe = ui.placeFor ? `<p class="muted small">Setzt für ${who(v, ui.placeFor)}:</p>${loupeHtml(v, 'place', v.stones)}` : '';
      return `
        <section class="panel side-place">
          ${head}
          <p>Alle setzen gleichzeitig am Handy – die Steine erscheinen, wenn alle fertig sind.</p>
          <p class="muted small">Noch offen: ${v.waiting.map((id) => who(v, id)).join(' ') || '–'}</p>
          ${forBtns ? `<div class="btn-row">${forBtns}</div>` : ''}
          ${loupe}
          <button class="btn btn-ghost btn-small btn-wide" data-act="skip">⏭ Weiter ohne die Fehlenden</button>
        </section>`;
    }
    const cur = pl(v, v.current);
    if (!cur) return '';
    if (!cur.stage) {
      return `
        <section class="panel side-place">
          ${head}
          <div class="turn-big"><i class="dot dot-big" style="--pc:${cur.hex}"></i><b>${esc(cur.name)}</b><small>setzt am Handy …</small></div>
          <button class="btn btn-ghost btn-small btn-wide" data-act="skip">⏭ ${esc(cur.name)} überspringen</button>
        </section>`;
    }
    const last = v.stones[v.stones.length - 1];
    const canUndo = !!last && last.round === round && (pl(v, last.player) || {}).stage;
    return `
      <section class="panel side-place">
        ${head}
        <div class="turn-big"><i class="dot dot-big" style="--pc:${cur.hex}"></i><b>${esc(cur.name)}</b><small>ist dran – auf die Tafel klicken, nochmal klicken = setzen</small></div>
        ${loupeHtml(v, 'place', v.stones)}
        <div class="btn-row">
          ${canUndo ? `<button class="btn btn-ghost btn-small" data-act="undo">↩️ Zurück</button>` : ''}
          <button class="btn btn-ghost btn-small" data-act="skip">⏭ Überspringen</button>
        </div>
      </section>`;
  }

  function revealBannerHtml(v, res) {
    return `<div class="cue-banner is-reveal">
        <span class="target-swatch" style="background:${Board.color(res.target)}"></span>
        <span class="reveal-text"><span>${cuesHtml(res.cues) || '–'}</span><small>Hinweis von ${who(v, res.giver)}${v.settings.coords !== 'off' ? ` · Feld ${Board.label(res.target)}` : ''}</small></span>
      </div>`;
  }

  function resultLinesHtml(v, res) {
    const drinks = v.settings.drinks;
    const lines = res.lines
      .map((l) => {
        const extra = [];
        if (l.bulls) extra.push(`🎯${l.bulls > 1 ? ' × ' + l.bulls : ''}`);
        if (drinks && l.drink) extra.push(`🍺 trinkt ${l.drink}`);
        if (drinks && l.give) extra.push(`🎁 verteilt ${l.give}`);
        return `<li class="${l.points ? '' : 'is-zero'}">${who(v, l.id)}<span class="res-extra">${extra.join(' · ')}</span><b>+${l.points}</b></li>`;
      })
      .join('');
    return `<ul class="result-lines">
        <li class="is-giver">${who(v, res.giver)}<span class="res-extra">🗣️ ${res.giverPoints} ${plural(res.giverPoints, 'Stein', 'Steine')} im Rahmen</span><b>+${res.giverPoints}</b></li>
        ${lines}
      </ul>`;
  }

  /** Text für „Weiter“ nach dem Aufdecken: nächster Zug, Stechen oder Ergebnis */
  function nextLabel(v) {
    if (!v.over) return 'Nächster Zug →';
    const st = v.standings;
    return st.length > 1 && st[0].score === st[1].score ? '⚔️ Gleichstand – Stechen' : '🏆 Zum Ergebnis';
  }

  function revealSideHtml(v) {
    const res = v.result;
    return `
      <section class="panel side-reveal" style="--rv:${REVEAL_FRAME_S + 0.3}s">
        <h2>🖼️ Aufgedeckt</h2>
        ${resultLinesHtml(v, res)}
        <button class="btn btn-primary btn-wide btn-big" data-act="next">${nextLabel(v)}</button>
      </section>`;
  }

  /* ---------- Siegerehrung ---------- */

  function podiumHtml(v) {
    const st = v.standings;
    const place = (i) => {
      const p = st[i];
      if (!p) return '<div class="pod pod-empty"></div>';
      const rank = st.findIndex((x) => x.score === p.score) + 1;
      return `<div class="pod pod-${i + 1}" style="--pc:${colorHex(p.color)}">
          <span class="pod-medal">${['🥇', '🥈', '🥉'][rank - 1] || ''}</span>
          <b>${esc(p.name)}</b><small>${p.score} Punkte</small>
          <div class="pod-block">${rank}</div>
        </div>`;
    };
    return `<div class="podium">${place(1)}${place(0)}${place(2)}</div>`;
  }

  function standingsTableHtml(v) {
    const rows = v.standings
      .map((p, i) => {
        const rank = v.standings.findIndex((x) => x.score === p.score) + 1;
        return `<tr><td class="st-rank">${rank === i + 1 ? rank + '.' : ''}</td><td class="st-name"><i class="dot" style="--pc:${colorHex(p.color)}"></i>${esc(p.name)}</td>
          <td>${p.stats.bullseyes}</td><td>${p.stats.giverPoints}</td><td><b>${p.score}</b></td></tr>`;
      })
      .join('');
    return `<table class="standings"><thead><tr><th></th><th class="st-name-h">Name</th><th title="Volltreffer">🎯</th><th title="Punkte als Hinweisgeber">🗣️</th><th>Punkte</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function awardsHtml(v) {
    if (!v.awards.length) return '';
    return `<div class="awards">${v.awards
      .map(
        (a) =>
          `<div class="award">${a.swatch ? `<span class="award-swatch" style="background:${a.swatch}"></span>` : `<span class="award-icon">${a.icon}</span>`}<div><small>${a.icon} ${esc(a.title)}</small><b>${esc(joinNames(a.names))}</b><span>${esc(a.text)}</span></div></div>`
      )
      .join('')}</div>`;
  }

  function historyHtml(v) {
    if (!v.history.length) return '<p class="muted">Noch keine Farbe aufgedeckt.</p>';
    return `<div class="history">${v.history
      .slice()
      .reverse()
      .map(
        (h) => `<div class="hist">
          <span class="hist-swatch" style="background:${Board.color(h.target)}"></span>
          <span class="hist-body"><b>${cuesHtml(h.cues) || '–'}</b><small>${esc(pname(v, h.giver))} · ${h.giverPoints} im Rahmen${h.bulls.length ? ' · 🎯 ' + esc(h.bulls.map((id) => pname(v, id)).join(', ')) : ''}</small></span>
        </div>`
      )
      .join('')}</div>`;
  }

  function endHtml(v) {
    const top = v.standings[0];
    const winners = top ? v.standings.filter((p) => p.score === top.score).map((p) => p.name) : [];
    return `
      <div class="end">
        <div class="end-hero">
          <div class="end-big">🏆</div>
          <h1>${esc(joinNames(winners))} ${winners.length > 1 ? 'gewinnen gemeinsam' : 'gewinnt'}!</h1>
        </div>
        ${podiumHtml(v)}
        ${awardsHtml(v)}
        <section class="panel">${standingsTableHtml(v)}</section>
        <section class="panel"><h2>🎨 Alle Farben des Abends</h2>${historyHtml(v)}</section>
        ${
          v.me.host
            ? `<div class="btn-row center-row">
                <button class="btn btn-primary btn-big" data-act="again">🔁 Nochmal</button>
                <button class="btn btn-ghost" data-act="home">🏠 Hauptmenü</button>
              </div>`
            : ''
        }
      </div>`;
  }

  /* ---------- Handy ---------- */

  function phoneHtml(v) {
    const me = pl(v, v.me.id);
    if (v.phase === 'lobby') return phoneLobbyHtml(v, me);
    if (v.phase === 'end') return phoneEndHtml(v, me);
    if (!me) return `<div class="look-up">👀<b>Du schaust zu</b><small>Das Spiel ist voll – genieß die Farben auf dem Laptop.</small></div>`;
    if (v.phase === 'reveal') return phoneRevealHtml(v, me);
    const giver = v.giver === me.id;
    if (giver) return phoneGiverHtml(v);
    return phoneGuessHtml(v, me);
  }

  function colorPickerHtml(v, me) {
    return `<div class="color-picker">${PLAYER_COLORS.map((c) => {
      const owner = v.players.find((p) => p.color === c.id);
      const mine = me && me.color === c.id;
      return `<button class="color-btn ${mine ? 'on' : ''} ${owner && !mine ? 'taken' : ''}" style="--pc:${c.hex}" data-act="color" data-color="${c.id}" aria-label="${c.name}${owner && !mine ? ' (tauschen mit ' + esc(owner.name) + ')' : ''}" title="${c.name}"></button>`;
    }).join('')}</div>`;
  }

  function phoneLobbyHtml(v, me) {
    const teams = isTeams(v.settings);
    const teamBtns = teams
      ? `<section class="panel"><h2>Dein Team</h2><div class="team-btns">${v.players
          .map(
            (p) =>
              `<button class="team-btn ${me && me.id === p.id ? 'on' : ''}" style="--pc:${p.hex}" data-act="team" data-team="${esc(p.id)}"><b>${esc(p.name)}</b><small>${p.members.map((m) => esc(m.name)).join(', ') || 'noch leer'}</small></button>`
          )
          .join('')}</div></section>`
      : '';
    return `
      <div class="phone-lobby">
        <div class="look-up small">✅ <b>Du bist dabei${me && !teams ? ', ' + esc(me.name) : ''}!</b></div>
        ${teamBtns}
        ${me ? `<section class="panel"><h2>${teams ? 'Teamfarbe' : 'Deine Farbe'}</h2>${colorPickerHtml(v, me)}</section>` : ''}
        ${nightHint()}
        <p class="muted center">Warte, bis es auf dem Laptop losgeht …</p>
      </div>`;
  }

  /** Hinweisgeber am Handy: Karte wählen, dann Hinweis tippen */
  function phoneGiverHtml(v) {
    const sec = v.secret;
    const blind = v.settings.blind;
    if (v.phase === 'pick' && sec) {
      if (v.settings.freePick) {
        return `
          <div class="phone-play">
            <div class="ph-banner is-me">🎯 Du gibst den Hinweis – <b>wähle ein beliebiges Feld</b></div>
            ${boardHtml(v, { mode: 'pick', stones: [], sel: ui.sel, cls: 'board-phone' })}
            ${loupeHtml(v, 'pick', [], 'Diese Farbe ✓')}
          </div>`;
      }
      return `
        <div class="phone-play">
          <div class="ph-banner is-me">🎨 Du gibst den Hinweis – <b>wähle eine Farbe</b></div>
          ${cardPickHtml(v, sec)}
          ${blind ? '' : boardHtml(v, { stones: [], marks: sec.card.map((cell, i) => ({ cell, text: LETTERS[i], on: ui.cardSel === i })), cls: 'board-phone' })}
        </div>`;
    }
    if (v.phase === 'cue' && sec) {
      return `
        <div class="phone-play">
          <div class="ph-banner is-me">💬 Hinweis ${v.cueRound}: beschreibe diese Farbe</div>
          <div class="target-big" style="background:${Board.color(sec.target)}"></div>
          ${cueFormHtml(v, true)}
          ${blind ? '' : boardHtml(v, { stones: v.stones, target: sec.target, cls: 'board-phone' })}
        </div>`;
    }
    // Die anderen setzen
    return `
      <div class="phone-play">
        <div class="ph-banner">${cuesHtml(v.cues)}<small>Die anderen setzen ihre Steine …</small></div>
        ${sec ? `<div class="target-small"><span style="background:${Board.color(sec.target)}"></span>Deine Farbe</div>` : ''}
        ${boardHtml(v, { stones: v.stones, target: blind || !sec ? null : sec.target, cls: 'board-phone' })}
        ${placeWaitHtml(v)}
      </div>`;
  }

  /** Die 4 Kartenfarben zum Antippen (Handy und Laptop) */
  function cardPickHtml(v, sec) {
    const swatches = sec.card
      .map(
        (cell, i) =>
          `<button class="card-swatch ${ui.cardSel === i ? 'on' : ''}" style="background:${Board.color(cell)}" data-act="card-sel" data-index="${i}" aria-label="Farbe ${LETTERS[i]}"><b class="${lightCell(cell) ? 'on-light' : ''}">${LETTERS[i]}</b></button>`
      )
      .join('');
    return `
      <div class="card-pick">
        <div class="card-swatches">${swatches}</div>
        <button class="btn btn-primary btn-wide btn-big" data-act="card-ok" ${ui.cardSel == null ? 'disabled' : ''}>${ui.cardSel == null ? 'Farbe antippen' : `Farbe ${LETTERS[ui.cardSel]} nehmen ✓`}</button>
      </div>`;
  }

  function placeWaitHtml(v) {
    if (v.phase !== 'place') return '';
    if (v.settings.order === 'simultaneous') return `<p class="muted center small">Noch offen: ${v.waiting.map((id) => who(v, id)).join(' ') || '–'}</p>`;
    return v.current ? `<p class="muted center">⏳ ${who(v, v.current)} setzt gerade …</p>` : '';
  }

  function phoneGuessHtml(v, me) {
    if (v.phase === 'pick') {
      return `<div class="phone-play"><div class="ph-banner">🎨 ${who(v, v.giver)} wählt eine Farbe …</div>${boardHtml(v, { stones: [], cls: 'board-phone' })}</div>`;
    }
    if (v.phase === 'cue') {
      return `
        <div class="phone-play">
          <div class="ph-banner"><span>${cuesHtml(v.cues)}</span><small>💭 ${who(v, v.giver)} überlegt sich Hinweis ${v.cueRound} …</small></div>
          ${boardHtml(v, { stones: v.stones, cls: 'board-phone' })}
        </div>`;
    }
    // place
    if (myTurn(v)) {
      return `
        <div class="phone-play is-turn">
          <div class="ph-banner is-me"><span>${cuesHtml(v.cues)}</span><small>🎯 Du bist dran – Stein ${v.round}${v.settings.secondCue ? ' von 2' : ''}</small>${timerHtml(v)}</div>
          <p class="rotate-hint">📱↻ Quer halten = größere Tafel</p>
          <div class="phone-board-row">
            ${boardHtml(v, { mode: 'place', stones: v.stones, sel: ui.sel, cls: 'board-phone' })}
            ${loupeHtml(v, 'place', v.stones)}
          </div>
        </div>`;
    }
    const placed = v.settings.order === 'simultaneous' && !v.waiting.includes(me.id);
    return `
      <div class="phone-play">
        <div class="ph-banner"><span>${cuesHtml(v.cues)}</span><small>${placed ? '✓ Gesetzt – warte auf die anderen' : 'Gleich bist du dran …'}</small>${timerHtml(v)}</div>
        ${boardHtml(v, { stones: v.stones, cls: 'board-phone' })}
        ${placeWaitHtml(v)}
      </div>`;
  }

  function phoneRevealHtml(v, me) {
    const res = v.result;
    const line = res.lines.find((l) => l.id === me.id);
    const giver = res.giver === me.id;
    const pts = giver ? res.giverPoints : line ? line.points : 0;
    const rank = v.standings.findIndex((x) => x.score === me.score) + 1;
    const extra = [];
    if (line && line.bulls) extra.push('🎯 Volltreffer!');
    if (giver) extra.push(`🗣️ ${res.giverPoints} ${plural(res.giverPoints, 'Stein', 'Steine')} im Rahmen`);
    if (v.settings.drinks && line && line.drink) extra.push(`🍺 trink ${line.drink}`);
    if (v.settings.drinks && line && line.give) extra.push(`🎁 verteil ${line.give}`);
    return `
      <div class="phone-reveal" style="--rv:${REVEAL_FRAME_S}s">
        <div class="target-big" style="background:${Board.color(res.target)}"><span>${cuesHtml(res.cues)}</span></div>
        <div class="look-up ${pts ? 'win' : ''}"><b>+${pts}</b><small>${extra.join(' · ') || (pts ? 'Gut geschätzt!' : 'Diesmal nicht dabei')}</small></div>
        <p class="center">Gesamt: <b>${me.score}</b> · Platz ${rank}</p>
        ${v.me.leader ? `<button class="btn btn-primary btn-wide btn-big" data-act="next">${nextLabel(v)}</button>` : '<p class="muted center">👀 Schau auf den Laptop</p>'}
      </div>`;
  }

  function phoneEndHtml(v, me) {
    if (!me) return `<div class="look-up">🏁<b>Spiel vorbei</b></div>`;
    const rank = v.standings.findIndex((x) => x.score === me.score) + 1;
    return `
      <div class="phone-end">
        <div class="look-up ${rank === 1 ? 'win' : ''}">${rank === 1 ? '🏆' : rank <= 3 ? ['', '🥇', '🥈', '🥉'][rank] : '🎨'}<b>Platz ${rank}</b><small>${me.score} Punkte</small></div>
        ${awardsHtml(v)}
        <section class="panel">${historyHtml(v)}</section>
      </div>`;
  }

  /* ---------- Geheime Karte am Laptop (Overlay) ---------- */

  function overlayHtml() {
    const v = ui.view;
    if (ui.screen !== 'game' || !v || !v.me.stage || !giverOnStage(v)) return '';
    const g = pname(v, v.giver);
    const sec = v.secret;
    const blind = v.settings.blind;
    if (v.phase === 'pick' && ui.secret) {
      let body;
      if (v.settings.freePick) {
        body = `
          <p>Wähle <b>ein beliebiges Feld</b> – die anderen raten danach.</p>
          <div class="secret-pick">
            <div class="secret-board">${boardHtml(v, { mode: 'pick', stones: [], sel: ui.sel })}</div>
            ${loupeHtml(v, 'pick', [], 'Diese Farbe ✓')}
          </div>`;
      } else {
        body = `
          ${cardPickHtml(v, sec)}
          ${blind ? '' : `<div class="secret-board">${boardHtml(v, { stones: [], marks: sec.card.map((cell, i) => ({ cell, text: LETTERS[i], on: ui.cardSel === i })) })}</div>`}`;
      }
      return `
        <div class="overlay secret-overlay">
          <div class="secret-box">
            <h2>🤫 Nur für ${esc(g)}</h2>
            ${body}
            <button class="btn btn-ghost btn-small" data-act="secret-hide">🙈 Verdecken</button>
          </div>
        </div>`;
    }
    if (v.phase === 'cue' && ui.peek && sec.target) {
      return `
        <div class="overlay secret-overlay" data-act="peek-hide">
          <div class="secret-box">
            <h2>🤫 Deine Farbe, ${esc(g)}</h2>
            <div class="target-big" style="background:${Board.color(sec.target)}"></div>
            ${blind ? '' : `<div class="secret-board">${boardHtml(v, { stones: v.stones, target: sec.target })}</div>`}
            <button class="btn btn-primary" data-act="peek-hide">🙈 Verdecken</button>
          </div>
        </div>`;
    }
    return '';
  }

  /* ---------- Fenster ---------- */

  function peopleHtml(v) {
    const teams = isTeams(v.settings);
    const canRemove = v.phase === 'lobby' || v.players.length > (teams ? MIN_TEAMS : MIN_PLAYERS);
    const canMove = !['place', 'cue'].includes(v.phase);
    const rows = v.players
      .map((p, i) => {
        const palette =
          ui.colorFor === p.id
            ? `<div class="color-picker small">${PLAYER_COLORS.map(
                (c) => `<button class="color-btn ${p.color === c.id ? 'on' : ''}" style="--pc:${c.hex}" data-act="color" data-player="${esc(p.id)}" data-color="${c.id}" aria-label="${c.name}"></button>`
              ).join('')}</div>`
            : '';
        return `<div class="person-row ${p.online ? '' : 'is-offline'}">
            <button class="color-btn" style="--pc:${p.hex}" data-act="color-open" data-player="${esc(p.id)}" aria-label="Farbe ändern"></button>
            <span class="person-name">${p.phone && !teams ? '📱 ' : ''}${esc(p.name)}${teams && p.members.length ? `<small>${esc(p.members.map((m) => m.name).join(', '))}</small>` : ''}</span>
            ${canMove ? `<button class="icon-btn icon-small" data-act="move" data-player="${esc(p.id)}" data-dir="-1" ${i ? '' : 'disabled'} aria-label="nach vorn">↑</button>` : ''}
            ${canMove ? `<button class="icon-btn icon-small" data-act="move" data-player="${esc(p.id)}" data-dir="1" ${i < v.players.length - 1 ? '' : 'disabled'} aria-label="nach hinten">↓</button>` : ''}
            ${canRemove && !teams ? `<button class="icon-btn icon-small" data-act="remove-player-live" data-player="${esc(p.id)}" aria-label="${esc(p.name)} entfernen">✕</button>` : ''}
          </div>${palette}`;
      })
      .join('');
    const max = teams ? 4 : MAX_PLAYERS;
    return `<h2>👥 ${teams ? 'Teams' : 'Mitspielende'}</h2>
      <p class="muted small">Reihenfolge = Sitzordnung (reihum im Uhrzeigersinn).${v.settings.input === 'phones' && !teams ? ' Handys tragen sich selbst ein (📱).' : ''}</p>
      <div class="people">${rows}</div>
      ${
        v.players.length < max
          ? `<form class="add-row" data-form="add-player">
              <input class="input" type="text" maxlength="24" placeholder="${teams ? 'Teamname' : 'Name'}" value="${esc(ui.addName)}" data-field="add-name" autocomplete="off" enterkeyhint="done" />
              <button class="btn btn-primary" type="submit">＋</button>
            </form>`
          : ''
      }
      <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig</button></div>`;
  }

  function modalHtml() {
    if (!ui.modal) return '';
    const v = ui.view;
    let body = '';
    if (ui.modal === 'rules') body = rulesHtml();
    else if (ui.modal === 'menu') body = menuHtml();
    else if (ui.modal === 'qr') {
      body = `<h2>📱 Handys verbinden</h2>${roomBoxHtml(v && v.room, false)}
        <p class="muted small center">Wer jetzt beitritt, spielt ab sofort mit.</p>
        <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig</button></div>`;
    } else if (ui.modal === 'settings' && v) {
      body = `<h2>⚙️ Einstellungen</h2>${settingsHtml(v.settings, 'live')}
        <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig</button></div>`;
    } else if (ui.modal === 'people' && v) {
      body = peopleHtml(v);
    } else if (ui.modal === 'standings' && v) {
      body = `<h2>📊 Punktestand</h2>${standingsTableHtml(v)}<h3>🎨 Bisherige Farben</h3>${historyHtml(v)}<div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig</button></div>`;
    } else if (ui.modal === 'confirm' && ui.confirm) {
      body = `
        <h2>${esc(ui.confirm.title)}</h2>
        <p>${esc(ui.confirm.text)}</p>
        <div class="modal-actions">
          <button class="btn ${ui.confirm.danger ? 'btn-danger' : 'btn-primary'}" data-act="confirm-yes">${esc(ui.confirm.yes)}</button>
          <button class="btn btn-ghost" data-act="close-modal">Abbrechen</button>
        </div>`;
    } else return '';
    if (!body) return '';
    return `
      <div class="overlay modal-overlay" data-act="close-modal-bg">
        <div class="modal modal-${ui.modal}" role="dialog" aria-modal="true">
          <button class="icon-btn modal-close" data-act="close-modal" aria-label="Schließen">✕</button>
          ${body}
        </div>
      </div>`;
  }

  function rulesHtml() {
    return `
      <h2>📖 Spielregeln</h2>
      <div class="rules">
        <p>Auf der <b>Farbtafel</b> liegen 480 Farbtöne (Spalten 1–30, Reihen A–P). Reihum gibt eine Person den Hinweis,
          alle anderen raten. Nach dem Brettspiel <i>Hues and Cues</i>.</p>
        <h3>🎨 Ablauf eines Zugs</h3>
        <ol>
          <li>Die hinweisgebende Person sieht geheim <b>4 Farben</b> und wählt eine davon.</li>
          <li><b>Hinweis 1 – genau ein Wort</b>, z.B. „Avocado“, „Flamingo“, „Jeans“.</li>
          <li>Reihum <b>im Uhrzeigersinn</b> setzt jede Person einen Stein auf ein <b>freies Feld</b>.</li>
          <li><b>Hinweis 2 – ein oder zwei Wörter</b> (oder verzichten, wenn die Steine schon gut liegen).</li>
          <li>Zweiter Stein, diesmal <b>gegen den Uhrzeigersinn</b>.</li>
          <li><b>Aufdecken:</b> Ein Rahmen legt sich um die Zielfarbe.</li>
        </ol>
        <h3>🚫 Verboten im Hinweis</h3>
        <p>Grundfarben (rot, blau, grün, gelb, orange, lila, pink, braun, schwarz, weiß, grau …), „hell“ und „dunkel“,
          Koordinaten, Dinge im Raum und schon benutzte Hinweise. Erlaubt sind seltenere Farbnamen (Bordeaux, Türkis, Ocker) und alles Bildhafte.</p>
        <h3>🖼️ Punkte</h3>
        <ul>
          <li>Stein <b>genau</b> auf der Farbe: <b>3 Punkte</b></li>
          <li>Im <b>3 × 3-Rahmen</b> (direkt daneben, auch diagonal): <b>2 Punkte</b></li>
          <li><b>Direkt am Rahmen</b> außen: <b>1 Punkt</b></li>
          <li>Die hinweisgebende Person bekommt <b>1 Punkt pro Stein im Rahmen</b>.</li>
        </ul>
        <h3>🏁 Spielende</h3>
        <p>Bis 6 Personen gibt jede Person zweimal den Hinweis, ab 7 einmal (einstellbar, auch „bis ${GOAL} Punkte“).
          Bei Gleichstand an der Spitze gibt es ein <b>Stechen</b>.</p>
        <h3>📱 Mit Handys</h3>
        <p>Karte und Hinweis kommen aufs Handy der hinweisgebenden Person, gesetzt wird per Antippen mit <b>Lupe</b> (Handy quer halten).
          Wer kein Handy hat, spielt am Laptop. Das erste verbundene Handy ist die <b>Spielleitung</b> und kann weiterschalten.</p>
        <h3>🧪 Varianten</h3>
        <ul>
          <li><b>⚡ Schnell:</b> nur ein Hinweis und ein Stein.</li>
          <li><b>👥 Teams:</b> das Team berät sich und setzt gemeinsam.</li>
          <li><b>🙈 Blind:</b> die hinweisgebende Person sieht nur die Farbe, nicht die Tafel drumherum.</li>
          <li><b>🎯 Freie Wahl:</b> beliebiges Feld statt Kartenfarbe.</li>
          <li><b>⚡ Gleichzeitig</b> (mit Handys): alle setzen gleichzeitig, mehrere Steine pro Feld erlaubt.</li>
          <li><b>🍻 Trinkregeln:</b> Stein völlig daneben → 1 Schluck, Volltreffer → 2 verteilen.</li>
        </ul>
        <h3>⌨️ Bedienung am Laptop</h3>
        <p>Feld anklicken = Lupe, nochmal klicken oder <b>Enter</b> = setzen. <b>Pfeiltasten</b> verschieben die Auswahl.</p>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Alles klar!</button></div>`;
  }

  function menuHtml() {
    const v = ui.view;
    const items = [];
    items.push(`<button class="menu-item" data-act="rules">📖 Spielregeln</button>`);
    if (!v || v.me.host) items.push(`<button class="menu-item" data-act="mute">${Sound.muted ? '🔊 Ton einschalten' : '🔇 Ton ausschalten'}</button>`);
    if (v && v.me.host) {
      if (v.phase !== 'end') {
        items.push(`<button class="menu-item" data-act="people">👥 ${isTeams(v.settings) ? 'Teams' : 'Mitspielende'}</button>`);
        items.push(`<button class="menu-item" data-act="settings">⚙️ Einstellungen</button>`);
        if (v.history.length) items.push(`<button class="menu-item" data-act="standings">📊 Punktestand</button>`);
      }
      if (v.room) items.push(`<button class="menu-item" data-act="show-qr">📱 Handys verbinden</button>`);
      items.push(`<button class="menu-item" data-act="home-keep">🏠 Hauptmenü <small>(Spiel bleibt gespeichert)</small></button>`);
      if (v.phase !== 'end' && v.phase !== 'lobby') items.push(`<button class="menu-item danger" data-act="finish-ask">🏁 Spiel beenden <small>(zur Siegerehrung)</small></button>`);
      items.push(`<button class="menu-item danger" data-act="close-game">🚪 Spiel schließen</button>`);
    } else if (v) {
      if (v.history.length) items.push(`<button class="menu-item" data-act="standings">📊 Punktestand</button>`);
      items.push(`<button class="menu-item danger" data-act="leave">🚪 Spiel verlassen</button>`);
    }
    return `<h2>Menü</h2><div class="menu-list">${items.join('')}</div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Aktionen                                                            */
  /* ------------------------------------------------------------------ */

  function dispatch(type, extra) {
    if (!ui.ctrl) return;
    ui.ctrl.dispatch(Object.assign({ type }, extra || {}));
  }

  function askConfirm(opts) {
    ui.confirm = opts;
    ui.modal = 'confirm';
    render();
  }

  function setSetting(scope, key, value) {
    const base = scope === 'setup' ? ui.setup.settings : ui.view ? ui.view.settings : null;
    if (!base) return;
    let patch = { [key]: value };
    if (key === 'end') patch = value === 'to50' ? { to50: true } : { to50: false, rounds: +value };
    const next = Object.assign({}, base, patch);
    if (scope === 'setup') {
      ui.setup.settings = sanitizeSettings(next, ui.setup.settings);
      saveSetup();
      render();
    } else {
      dispatch('settings', { settings: next });
    }
  }

  function currentSettings(scope) {
    return scope === 'setup' ? ui.setup.settings : ui.view ? ui.view.settings : null;
  }

  function createGame() {
    const s = ui.setup;
    ui.error = null;
    const st = s.settings;
    let names;
    if (st.teams) {
      names = s.teams.slice(0, st.teams).map((n, i) => n.trim() || 'Team ' + PLAYER_COLORS[i].name);
    } else {
      names = filledNames();
      if (st.input !== 'phones' && names.length < MIN_PLAYERS) {
        ui.error = `Bitte mindestens ${MIN_PLAYERS} Namen eintragen.`;
        render();
        return;
      }
    }
    const state = Engine.create({ settings: st, players: names });
    Sound.unlock();
    startStage({ state });
  }

  /** Feld anklicken: auswählen; am Laptop ein zweiter Klick auf dasselbe Feld = bestätigen */
  function selectCell(cell, mode, confirmOnRepeat) {
    if (confirmOnRepeat && ui.sel && Board.same(ui.sel, cell)) {
      confirmSel(mode);
      return;
    }
    ui.sel = cell;
    vibrate(10);
    render();
  }

  function confirmSel(mode) {
    const v = ui.view;
    const cell = ui.sel;
    if (!v || !cell) return;
    if (mode === 'pick') {
      dispatch('pick', { cell, at: v.step });
      ui.sel = null;
      ui.secret = false;
      return;
    }
    if (v.phase !== 'place') return;
    if (v.settings.order === 'turns' && v.stones.some((x) => Board.same(x, cell))) {
      toast('Das Feld ist schon belegt.');
      return;
    }
    const extra = { cell };
    if (v.me.host && v.settings.order === 'simultaneous') extra.player = ui.placeFor;
    dispatch('place', extra);
    ui.sel = null;
    vibrate(30);
  }

  /** Welche Tafel ist gerade anklickbar? (für die Tastatur) */
  function activeMode() {
    const el = app.querySelector('[data-board]');
    return el ? el.dataset.board : null;
  }

  /** Hinweis abschicken – Warnungen stehen schon unter dem Feld, der Knopf heißt dann „Trotzdem senden“ */
  function sendCue() {
    const v = ui.view;
    if (!v) return;
    const text = Cues.clean(ui.cueText);
    if (!text) {
      toast('Bitte einen Hinweis eingeben.');
      return;
    }
    dispatch('cue', { text, at: v.step });
  }

  const actions = {
    home: () => goHome(false),
    'home-keep': () => goHome(true),
    'leave-now': () => goHome(false),
    'new-game': (el) => {
      ui.setup.settings = sanitizeSettings(Object.assign({}, ui.setup.settings, { input: el.dataset.input }), ui.setup.settings);
      saveSetup();
      ui.error = null;
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
    'resume-stage': () => {
      const saved = savedGames().stage;
      if (saved) startStage({ state: saved.state, code: saved.code, key: saved.key });
    },
    'discard-stage': () =>
      askConfirm({
        title: 'Spielstand löschen?',
        text: 'Das gespeicherte Spiel wird gelöscht.',
        yes: 'Löschen',
        danger: true,
        run: () => {
          Store.remove(KEYS.stage);
          render();
        },
      }),
    'resume-client': () => {
      const saved = savedGames().client;
      if (saved) startClient({ code: saved.code, name: saved.name, pid: saved.pid });
    },
    'discard-client': () => {
      Store.remove(KEYS.client);
      render();
    },
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
      render();
    },
    'close-modal': () => {
      ui.modal = null;
      ui.confirm = null;
      ui.colorFor = null;
      render();
    },
    'close-modal-bg': (el, e) => {
      if (e.target === el) actions['close-modal']();
    },
    'confirm-yes': () => {
      const c = ui.confirm;
      ui.modal = null;
      ui.confirm = null;
      if (c && c.run) c.run();
      render();
    },
    set: (el) => setSetting(el.dataset.scope, el.dataset.key, el.dataset.num ? +el.dataset.value : el.dataset.value),
    toggle: (el) => {
      const s = currentSettings(el.dataset.scope);
      if (s) setSetting(el.dataset.scope, el.dataset.key, !s[el.dataset.key]);
    },
    'add-player': () => {
      if (ui.setup.players.length >= MAX_PLAYERS) return;
      ui.setup.players.push('');
      saveSetup();
      ui.focus = `[data-field="player-name"][data-player="${ui.setup.players.length - 1}"]`;
      render();
    },
    'remove-player': (el) => {
      ui.setup.players.splice(+el.dataset.player, 1);
      saveSetup();
      render();
    },
    'create-game': createGame,
    open: () => dispatch('open'),
    // Geheime Karte am Laptop
    'secret-show': () => {
      ui.secret = true;
      ui.cardSel = null;
      ui.sel = null;
      render();
    },
    'secret-hide': () => {
      ui.secret = false;
      render();
    },
    peek: () => {
      ui.peek = true;
      render();
    },
    'peek-hide': (el, e) => {
      if (el.classList.contains('overlay') && e.target !== el) return;
      ui.peek = false;
      render();
    },
    'card-sel': (el) => {
      ui.cardSel = +el.dataset.index;
      vibrate(15);
      render();
    },
    'card-ok': () => {
      const v = ui.view;
      if (!v || ui.cardSel == null) return;
      dispatch('pick', { index: ui.cardSel, at: v.step });
      ui.secret = false;
    },
    'cue-spoken': () => {
      const v = ui.view;
      if (v) dispatch('cue', { text: '', at: v.step });
    },
    'skip-cue': () => {
      const v = ui.view;
      if (v) dispatch('skipCue', { at: v.step });
    },
    // Tafel & Lupe
    'sel-cell': (el) => {
      ui.sel = { r: +el.dataset.r, c: +el.dataset.c };
      vibrate(10);
      render();
    },
    'sel-move': (el) => {
      if (!ui.sel) return;
      ui.sel = Board.clamp({ r: ui.sel.r + +el.dataset.dr, c: ui.sel.c + +el.dataset.dc });
      render();
    },
    'confirm-sel': (el) => confirmSel(el.dataset.mode),
    'place-for': (el) => {
      ui.placeFor = ui.placeFor === el.dataset.player ? null : el.dataset.player;
      ui.sel = null;
      render();
    },
    undo: () => dispatch('undo'),
    skip: () => {
      const v = ui.view;
      if (v) dispatch('skip', { at: v.step });
    },
    next: () => {
      const v = ui.view;
      if (v) dispatch('next', { at: v.step });
    },
    color: (el) => {
      const extra = { color: el.dataset.color };
      if (el.dataset.player) extra.player = el.dataset.player;
      dispatch('color', extra);
    },
    'color-open': (el) => {
      ui.colorFor = ui.colorFor === el.dataset.player ? null : el.dataset.player;
      render();
    },
    team: (el) => dispatch('team', { team: el.dataset.team }),
    move: (el) => dispatch('move', { player: el.dataset.player, dir: +el.dataset.dir }),
    standings: () => {
      ui.modal = 'standings';
      render();
    },
    'show-qr': () => {
      ui.modal = 'qr';
      render();
    },
    people: () => {
      ui.modal = 'people';
      ui.addName = '';
      ui.colorFor = null;
      render();
    },
    'remove-player-live': (el) => {
      const v = ui.view;
      const name = v ? pname(v, el.dataset.player) : 'Person';
      askConfirm({
        title: `${name} entfernen?`,
        text: 'Die Person wird aus der Runde genommen, ihre Steine in diesem Zug fallen weg.',
        yes: 'Entfernen',
        danger: true,
        run: () => {
          dispatch('removePlayer', { player: el.dataset.player });
          ui.modal = 'people';
        },
      });
    },
    settings: () => {
      ui.modal = 'settings';
      render();
    },
    'finish-ask': () =>
      askConfirm({
        title: 'Spiel beenden?',
        text: 'Der laufende Zug wird nicht gewertet. Danach gibt es die Siegerehrung.',
        yes: 'Beenden',
        run: () => dispatch('finish'),
      }),
    again: () => dispatch('again'),
    'close-game': () =>
      askConfirm({
        title: 'Spiel schließen?',
        text: ui.view && ui.view.room ? 'Der Raum wird geschlossen, die Handys werden getrennt.' : 'Das Spiel wird beendet und nicht gespeichert.',
        yes: 'Schließen',
        danger: true,
        run: () => goHome(false),
      }),
    leave: () =>
      askConfirm({
        title: 'Spiel verlassen?',
        text: 'Du kannst über den QR-Code jederzeit wieder beitreten.',
        yes: 'Verlassen',
        danger: true,
        run: () => goHome(false),
      }),
  };

  /* ------------------------------------------------------------------ */
  /* Event-Listener                                                      */
  /* ------------------------------------------------------------------ */

  /** Klick auf die Tafel → Feld aus der Position berechnen (Steine und Markierungen liegen darüber) */
  function boardClick(boardEl, e) {
    const rect = boardEl.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * COLS);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * ROWS);
    const cell = { r, c };
    if (!Board.valid(cell)) return;
    const v = ui.view;
    selectCell(cell, boardEl.dataset.board, !!v && v.me.stage);
  }

  app.addEventListener('click', (e) => {
    const boardEl = e.target.closest('[data-board]');
    if (boardEl && app.contains(boardEl)) {
      Sound.unlock();
      boardClick(boardEl, e);
      return;
    }
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled || !app.contains(el)) return;
    Sound.unlock();
    const fn = actions[el.dataset.act];
    if (!fn) return;
    if (!['close-modal-bg', 'sel-cell', 'sel-move', 'peek-hide'].includes(el.dataset.act)) Sound.click();
    // Menüpunkte schließen das Menü, bevor sie etwas tun
    if (ui.modal === 'menu' && el.closest('.modal') && !['close-modal', 'mute'].includes(el.dataset.act)) ui.modal = null;
    fn(el, e);
  });

  app.addEventListener('input', (e) => {
    const el = e.target;
    const f = el.dataset && el.dataset.field;
    if (f === 'player-name') {
      ui.setup.players[+el.dataset.player] = el.value;
      saveSetup();
    } else if (f === 'team-name') {
      ui.setup.teams[+el.dataset.team] = el.value;
      saveSetup();
    } else if (f === 'add-name') {
      ui.addName = el.value;
    } else if (f === 'name') {
      ui.name = el.value;
    } else if (f === 'join-code') {
      ui.joinCode = Net.cleanCode(el.value);
    } else if (f === 'cue') {
      ui.cueText = el.value;
      // Nur Prüfung und Knopf neu zeichnen – das Eingabefeld behält den Fokus
      const v = ui.view;
      if (v) {
        const box = app.querySelector('[data-cue-check]');
        if (box) box.innerHTML = cueCheckHtml(v, v.cueRound);
        const btn = app.querySelector('[data-cue-send]');
        if (btn) {
          const check = v.settings.cueCheck ? Cues.check(ui.cueText, { round: v.cueRound, used: v.usedCues }) : { ok: true };
          const warn = ui.cueText.trim() && !check.ok;
          btn.textContent = warn ? '⚠️ Trotzdem senden' : v.cueRound === 1 ? 'Hinweis zeigen ✓' : 'Hinweis 2 zeigen ✓';
          btn.className = `btn ${warn ? 'btn-ghost' : 'btn-primary'} btn-wide btn-big`;
        }
      }
    }
  });

  app.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key !== 'Enter' || !el.dataset) return;
    if (el.dataset.field === 'player-name') {
      e.preventDefault();
      const nextEl = app.querySelector(`[data-field="player-name"][data-player="${+el.dataset.player + 1}"]`);
      if (nextEl) nextEl.focus();
      else actions['add-player']();
    } else if (el.dataset.field === 'name') {
      e.preventDefault();
      const code = app.querySelector('#code-input');
      if (code && !code.value) code.focus();
      else app.querySelector('[data-form="join"] button[type="submit"]').click();
    }
  });

  app.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.dataset.form === 'join') {
      const name = ui.name.trim();
      const code = Net.cleanCode(form.querySelector('[data-field="join-code"]').value);
      ui.joinCode = code;
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
      savePrefs();
      Sound.unlock();
      startClient({ code, name });
    } else if (form.dataset.form === 'cue') {
      const input = form.querySelector('[data-field="cue"]');
      if (input) ui.cueText = input.value;
      sendCue();
      if (input) input.blur();
    } else if (form.dataset.form === 'add-player') {
      const name = ui.addName.trim();
      if (!name) return;
      dispatch('addPlayer', { name });
      ui.addName = '';
      const input = form.querySelector('input');
      if (input) input.value = '';
      ui.focus = '[data-field="add-name"]';
      render();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (ui.modal) actions['close-modal']();
      else if (ui.peek) actions['peek-hide'](document.body, e);
      else if (ui.sel) {
        ui.sel = null;
        render();
      }
      return;
    }
    // Tastatur am Laptop: Pfeile verschieben die Auswahl, Enter setzt
    const t = e.target;
    if (ui.screen !== 'game' || ui.modal || e.altKey || e.ctrlKey || e.metaKey) return;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const mode = activeMode();
    if (!mode) return;
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[e.key]) {
      e.preventDefault();
      const base = ui.sel || { r: Math.floor(ROWS / 2), c: Math.floor(COLS / 2) };
      ui.sel = ui.sel ? Board.clamp({ r: base.r + moves[e.key][0], c: base.c + moves[e.key][1] }) : base;
      render();
    } else if (e.key === 'Enter' && ui.sel && !(t && t.tagName === 'BUTTON')) {
      e.preventDefault();
      confirmSel(mode);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ui.view && ui.view.phase !== 'end') keepAwake(true);
  });

  window.addEventListener('beforeunload', () => {
    if (ui.ctrl && ui.ctrl.mode === 'client') ui.ctrl.bye();
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

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.FG_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  autoResume();

  // für Tests
  window.FGApp = { ui, render: renderNow, actions };
})();
