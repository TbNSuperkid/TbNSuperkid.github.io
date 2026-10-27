/*
 * Oberfläche von „Wavelength“.
 *  - Laptop („Bühne“): Spiel anlegen, Lobby mit QR-Code, Skala mit Zeiger, Links/Rechts, Aufdecken, Siegerehrung
 *  - Handy: Ziel sehen und Hinweis geben, Zeiger live im Team drehen, als Gegnerteam links/rechts tippen
 * Gerendert wird per HTML-String + morphdom (nur geänderte Teile werden ersetzt).
 */
(function () {
  'use strict';

  const E = window.WLEngine;
  const { TEAMS, PLAYER_COLORS, GOALS, WIDTH_IDS, TIMER_OPTIONS, MIN_TEAM, MIN_COOP, MAX_PLAYERS, COOP_SCALES, COOP_RATINGS, MAX_CLUE, MAX_END, Engine, sanitizeSettings, coopRating, clueProblem } = E;
  const { StageController, ClientController, Store, KEYS, Net, inviteLink, qrSvg } = window.WLControllers;
  const { Sound, confetti, synth } = window.GameFx;
  const Scales = window.WLScales;
  const Dial = window.WLDial;

  const INPUT = {
    phones: { icon: '📱', label: 'Mit Handys', text: 'Das Ziel sieht nur die hinweisgebende Person auf dem Handy. Das Team dreht den Zeiger live auf den Handys, das Gegnerteam stimmt ab.' },
    one: { icon: '🖥️', label: 'Ein Gerät', text: 'Alle schauen weg, nur eine Person sieht das Ziel am Laptop. Den Zeiger dreht ihr mit Maus, Finger oder Pfeiltasten.' },
  };
  const MODE = {
    teams: { icon: '👥', label: '2 Teams', text: 'Abwechselnd – wer zuerst das Ziel erreicht, gewinnt' },
    coop: { icon: '🤝', label: 'Kooperativ', text: `Alle zusammen, ${COOP_SCALES} Skalen – wie viele Punkte schafft ihr?` },
  };
  const WIDTH = { wide: 'Breit (Kinder)', normal: 'Normal', narrow: 'Schmal (Profis)' };
  const POINTS = {
    4: { icon: '🎯', label: 'Volltreffer!', color: '#f43f5e' },
    3: { icon: '🔥', label: 'Ganz nah dran!', color: '#fb923c' },
    2: { icon: '👍', label: 'Knapp daneben', color: '#facc15' },
    0: { icon: '📵', label: 'Funkloch …', color: '#94a3b8' },
  };
  const SIDE = { left: '◀ links', right: 'rechts ▶' };
  const PROBLEM = { number: 'Keine Zahlen oder Prozente', scale: 'Kein Wort von der Skala' };
  const SETUP_KEY = 'wavelength.setup.v1';
  const PREFS_KEY = 'wavelength.prefs.v1';
  const ACTIVE_KEY = 'wavelength.active';
  const RESUME_MAX_AGE = 12 * 60 * 60 * 1000;
  // Zeiger-Nachrichten vom Handy: höchstens 10 pro Sekunde
  const DIAL_SEND_MS = 100;
  // Nach dem Loslassen so lange den eigenen Wert zeigen (bis der Laptop ihn zurückmeldet)
  const DIAL_HOLD_MS = 700;

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

  /** sessionStorage lesen (value weglassen), schreiben oder löschen (value = null) */
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

  function tc(color) {
    return `--team:${esc(color || '#ffffff')}`;
  }

  function deg(n) {
    return String(Math.round(n * 10) / 10).replace('.', ',') + '°';
  }

  function player(v, pid) {
    return v.players.find((p) => p.id === pid) || null;
  }

  function nameOf(v, pid) {
    const p = player(v, pid);
    if (p) return p.name;
    const m = v.members.find((x) => x.id === pid);
    return m ? m.name : '?';
  }

  function teamOf(v, id) {
    return v.teams.find((t) => t.id === id) || null;
  }

  function otherTeamOf(v, id) {
    return v.teams.find((t) => t.id !== id) || null;
  }

  function coopMode(v) {
    return v.settings.mode === 'coop';
  }

  /** Farbe des Zugs: Team oder (kooperativ) die hinweisgebende Person */
  function turnColor(v) {
    const c = v.cur;
    if (!c) return '#38bdf8';
    if (c.team) return teamOf(v, c.team).color;
    const p = player(v, c.giver);
    return p ? p.color : '#38bdf8';
  }

  function curKey(v) {
    return v && v.cur ? v.cur.key : null;
  }

  function defaultSetup() {
    return { settings: sanitizeSettings({}), players: { blau: ['', ''], orange: ['', ''], coop: ['', '', ''] }, teamNames: ['', ''] };
  }

  function loadSetup() {
    const saved = Store.get(SETUP_KEY);
    if (!saved || !saved.players || !Array.isArray(saved.players.blau) || !Array.isArray(saved.players.orange) || !Array.isArray(saved.players.coop)) return defaultSetup();
    saved.settings = sanitizeSettings(saved.settings);
    if (!Array.isArray(saved.teamNames)) saved.teamNames = ['', ''];
    return saved;
  }

  function saveSetup() {
    Store.set(SETUP_KEY, ui.setup);
  }

  /* ------------------------------------------------------------------ */
  /* Zustand der Oberfläche                                              */
  /* ------------------------------------------------------------------ */

  const params = new URLSearchParams(location.search);
  const prefs = Store.get(PREFS_KEY) || {};

  const ui = {
    screen: 'home',
    ctrl: null,
    token: null,
    view: null,
    viewAt: 0,
    status: null,
    setup: loadSetup(),
    name: prefs.name || '',
    joinCode: Net.cleanCode(params.get('raum') || ''),
    error: null,
    modal: null,
    confirm: null,
    toast: null,
    flash: null,
    clue: '', // Hinweis (Handy der hinweisgebenden Person bzw. Laptop mit einem Gerät)
    customLeft: '',
    customRight: '',
    peek: null, // ein Gerät: Ziel aufgedeckt (Kennung des Zugs)
    dialLocal: null, // eigener Zeiger-Wert beim Ziehen {key, value}
    focus: null,
  };
  if (ui.joinCode) ui.screen = 'join';

  function savePrefs() {
    Store.set(PREFS_KEY, { name: ui.name });
  }

  function toast(text) {
    ui.toast = text;
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(() => {
      ui.toast = null;
      render();
    }, 2600);
    render();
  }

  let flashNo = 0;
  function flash(text, color) {
    ui.flash = { text, color, id: ++flashNo };
    clearTimeout(ui.flashTimer);
    ui.flashTimer = setTimeout(() => {
      ui.flash = null;
      render();
    }, 2200);
  }

  /** Spieleigene Sounds */
  const Fx = {
    /** Zeiger rastet ein – kurzes, leises Klicken */
    tick() {
      synth.tone(1800, 0, 0.025, { type: 'square', vol: 0.025 });
    },
    /** Abdeckung klappt auf – Rauschen wie ein Radio, das den Sender sucht */
    sweep() {
      synth.noise(1.0, 0, 0.08, 1400);
      synth.tone(300, 0, 1.0, { type: 'sine', to: 1200, vol: 0.05 });
    },
    /** Funkloch */
    static() {
      synth.noise(0.5, 0, 0.12, 700);
      synth.tone(220, 0.05, 0.4, { type: 'sawtooth', to: 110, vol: 0.05 });
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
    ui.flash = null;
    endDrag();
    session(ACTIVE_KEY, null);
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
      stage: stage && stage.state && stage.state.phase !== 'over' && now - (stage.savedAt || 0) < RESUME_MAX_AGE ? stage : null,
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
    if (curKey(prev) !== curKey(v)) {
      ui.clue = '';
      ui.customLeft = '';
      ui.customRight = '';
      ui.dialLocal = null;
    }
    transitions(prev, v);
    render();
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
            : e === 'server'
              ? 'Der Verbindungsserver ist gerade nicht erreichbar. Bitte später erneut versuchen.'
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

  function vibrate(p) {
    try {
      if (navigator.vibrate) navigator.vibrate(p);
    } catch {
      /* egal */
    }
  }

  let lastTickAt = 0;
  /** Sounds, Konfetti und Einblendungen bei Zustandswechseln */
  function transitions(prev, v) {
    const stage = !!v.me.stage;
    if (!prev) return;
    const c = v.cur;
    const pc = prev.cur;
    if (v.phase === 'over' && prev.phase !== 'over') {
      ui.flash = null;
      Sound.fanfare();
      const winner = v.winner ? teamOf(v, v.winner) : null;
      setTimeout(() => confetti(winner ? [winner.color, '#ffffff', '#fde047'] : ['#38bdf8', '#f472b6', '#fde047', '#ffffff'], 220), 150);
      return;
    }
    if (!c) return;
    if (!pc || pc.no !== c.no) {
      Sound.start();
      if (!stage && c.giver === v.me.id) vibrate([80, 60, 80]);
      if (stage && pc && pc.result && pc.result.again) flash('🔁 Aufholregel – nochmal dran!', turnColor(v));
      return;
    }
    if (c.sNo !== pc.sNo) {
      Sound.flip();
      if (c.giver !== pc.giver && stage) flash(`👤 Jetzt gibt ${c.giverName} den Hinweis`, turnColor(v));
      return;
    }
    if (v.phase === 'dial' && prev.phase === 'clue') {
      Sound.flip();
      if (!stage && c.guessers.includes(v.me.id)) vibrate(80);
    }
    // Zeiger bewegt sich: leises Klicken (auf der Bühne, höchstens alle 60 ms)
    if (stage && v.phase === 'dial' && pc.dial != null && c.dial !== pc.dial && Math.abs(c.dial - pc.dial) >= 2) {
      const now = performance.now();
      if (now - lastTickAt > 60) {
        lastTickAt = now;
        Fx.tick();
      }
    }
    if (v.phase === 'side' && prev.phase !== 'side') {
      Sound.hop();
      if (!stage && c.opponents.includes(v.me.id)) vibrate([60, 40, 60]);
    }
    if (v.phase === 'reveal' && prev.phase !== 'reveal') revealEffects(v, stage);
  }

  function revealEffects(v, stage) {
    const r = v.cur.result;
    Fx.sweep();
    setTimeout(() => {
      if (!ui.view || ui.view.phase !== 'reveal') return;
      if (r.points === 4) {
        Sound.success();
        if (stage) confetti([turnColor(v), '#f43f5e', '#fde047', '#ffffff'], 180);
        else vibrate([60, 60, 60, 60, 120]);
      } else if (r.points === 3) Sound.success();
      else if (r.points === 2) Sound.hop();
      else {
        Fx.static();
        if (!stage) vibrate(200);
      }
    }, 1150);
  }

  /* ------------------------------------------------------------------ */
  /* Timer                                                               */
  /* ------------------------------------------------------------------ */

  function timerLoop() {
    requestAnimationFrame(timerLoop);
    const elapsed = performance.now() - ui.viewAt;
    for (const el of app.querySelectorAll('[data-timer]')) {
      const total = +el.dataset.total || 1;
      const rem = Math.max(0, +el.dataset.rem - elapsed);
      const sec = Math.ceil(rem / 1000);
      const text = el.querySelector('[data-timer-text]');
      if (text && text.textContent !== String(sec)) text.textContent = String(sec);
      const bar = el.querySelector('[data-timer-bar]');
      if (bar) bar.style.width = (100 * rem) / total + '%';
      el.classList.toggle('urgent', sec <= 10);
      if (el.hasAttribute('data-tick') && el.dataset.last !== String(sec)) {
        if (el.dataset.last && sec <= 5 && sec > 0) Sound.tick(sec <= 3);
        el.dataset.last = String(sec);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Zeiger ziehen                                                       */
  /* ------------------------------------------------------------------ */

  const drag = { active: false, key: null, pointer: null, sentAt: 0, sent: null, timer: null, holdUntil: 0 };

  /** Darf dieses Gerät den Zeiger gerade drehen? */
  function canDial(v) {
    if (!v || !v.cur || v.phase !== 'dial') return false;
    return !!v.me.stage || v.cur.guessers.includes(v.me.id);
  }

  /** Angezeigter Zeigerwert – beim Ziehen der eigene, sonst der vom Laptop */
  function dialValue(v) {
    const c = v.cur;
    const local = ui.dialLocal;
    if (local && local.key === c.key && v.phase === 'dial' && (drag.active || performance.now() < drag.holdUntil)) return local.value;
    return c.dial == null ? E.DIAL_START : c.dial;
  }

  function sendDial(force) {
    clearTimeout(drag.timer);
    drag.timer = null;
    const local = ui.dialLocal;
    if (!local || local.value === drag.sent) return;
    const wait = DIAL_SEND_MS - (performance.now() - drag.sentAt);
    if (!force && wait > 0) {
      drag.timer = setTimeout(() => sendDial(true), wait);
      return;
    }
    drag.sentAt = performance.now();
    drag.sent = local.value;
    dispatch('dial', { angle: local.value, at: local.key });
  }

  function moveDial(angle) {
    const v = ui.view;
    if (!canDial(v)) return;
    ui.dialLocal = { key: v.cur.key, value: Dial.clampAngle(angle) };
    render();
    sendDial(false);
  }

  function endDrag() {
    if (!drag.active) return;
    drag.active = false;
    drag.pointer = null;
    drag.holdUntil = performance.now() + DIAL_HOLD_MS;
    sendDial(true);
    render();
  }

  app.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-dial-input]');
    if (!el || !canDial(ui.view)) return;
    e.preventDefault();
    Sound.unlock();
    drag.active = true;
    drag.pointer = e.pointerId;
    drag.key = ui.view.cur.key;
    drag.sent = null;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    moveDial(Dial.angleAt(el, e.clientX, e.clientY));
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag.active || e.pointerId !== drag.pointer) return;
    const el = app.querySelector('[data-dial-input]');
    if (!el || !ui.view || curKey(ui.view) !== drag.key) {
      endDrag();
      return;
    }
    e.preventDefault();
    moveDial(Dial.angleAt(el, e.clientX, e.clientY));
  });

  for (const type of ['pointerup', 'pointercancel']) {
    window.addEventListener(type, (e) => {
      if (drag.active && e.pointerId === drag.pointer) endDrag();
    });
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
    if (ui.flash) html += `<div class="flash" style="${tc(ui.flash.color)}" id="flash-${ui.flash.id}" role="status">${esc(ui.flash.text)}</div>`;
    html += modalHtml();
    if (ui.toast) html += `<div class="toast" role="status">${esc(ui.toast)}</div>`;
    window.morphdom(app, `<div id="app">${html}</div>`, {
      onBeforeElUpdated(fromEl) {
        if (fromEl === document.activeElement && (fromEl.tagName === 'INPUT' || fromEl.tagName === 'TEXTAREA')) return false;
        return true;
      },
    });
    if (ui.focus) {
      const el = app.querySelector(ui.focus);
      ui.focus = null;
      if (el) {
        el.focus();
        if (el.setSelectionRange && el.value) el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }

  /* ---------- Bausteine ---------- */

  function logoHtml(small) {
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="Wavelength">
      <span class="logo-icon" aria-hidden="true">📡</span>
      <span class="logo-text"><span class="l1">Wave</span><span class="l2">length</span></span>
    </div>`;
  }

  function seg(key, options, value, fmt, scope, disabled) {
    return `<div class="seg" role="group">${options
      .map(
        (o) =>
          `<button class="seg-btn ${o === value ? 'on' : ''}" data-act="set" data-key="${key}" data-value="${o}" data-scope="${scope}" aria-pressed="${o === value}" ${disabled ? 'disabled' : ''}>${fmt(o)}</button>`
      )
      .join('')}</div>`;
  }

  function switchHtml(on, key, scope) {
    return `<button class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" data-act="toggle" data-key="${key}" data-scope="${scope}">
      <span class="switch-knob"></span><span class="switch-text">${on ? 'An' : 'Aus'}</span>
    </button>`;
  }

  function categoriesHtml(s, scope) {
    const stats = Scales.stats();
    return `<div class="cats">${Scales.CATEGORIES.map((c) => {
      const on = s.categories.includes(c.id);
      return `<button class="cat ${on ? 'on' : ''} ${c.adult ? 'cat-adult' : ''}" data-act="toggle-cat" data-cat="${c.id}" data-scope="${scope}" aria-pressed="${on}">
        <span class="cat-icon">${c.icon}</span><b>${esc(c.label)}</b><small>${esc(c.text)} · ${stats[c.id]}</small>
      </button>`;
    }).join('')}</div>`;
  }

  function settingsHtml(s, scope) {
    const teams = s.mode === 'teams';
    const rows = [];
    rows.push(`
      <div class="setting">
        <div class="setting-label"><b>Modus</b><small>${esc(MODE[s.mode].text)}</small></div>
        ${seg('mode', ['teams', 'coop'], s.mode, (o) => `${MODE[o].icon} ${MODE[o].label}`, scope)}
      </div>`);
    if (teams) {
      rows.push(`
        <div class="setting">
          <div class="setting-label"><b>🏁 Ziel</b><small>Erstes Team mit so vielen Punkten gewinnt (Team 2 startet mit 1 Punkt)</small></div>
          ${seg('goal', GOALS, s.goal, (o) => o + ' Punkte', scope)}
        </div>`);
    }
    rows.push(`
      <div class="setting">
        <div class="setting-label"><b>🎯 Zielbreite</b><small>Wie breit die Zielscheibe ist – schmal ist für Profis</small></div>
        ${seg('width', WIDTH_IDS, s.width, (o) => WIDTH[o], scope)}
      </div>`);
    if (teams) {
      rows.push(`
        <div class="setting">
          <div class="setting-label"><b>◀▶ Links/Rechts-Tipp</b><small>Das Gegnerteam tippt, auf welcher Seite des Zeigers das Ziel liegt – richtig = 1 Punkt</small></div>
          ${switchHtml(s.sideGuess, 'sideGuess', scope)}
        </div>
        <div class="setting">
          <div class="setting-label"><b>🔁 Aufholregel</b><small>Wer eine 4 holt und trotzdem hinten liegt, ist gleich nochmal dran</small></div>
          ${switchHtml(s.catchUp, 'catchUp', scope)}
        </div>`);
    }
    rows.push(`
      <div class="setting setting-col">
        <div class="setting-label"><b>🗂️ Skalen</b><small>Mindestens eine Kategorie – „Ab 18“ ist standardmäßig aus</small></div>
        ${categoriesHtml(s, scope)}
      </div>
      <div class="setting">
        <div class="setting-label"><b>⏱ Zeit fürs Team</b><small>So lange darf das Team den Zeiger drehen – dann zählt, wo er steht</small></div>
        ${seg('timer', TIMER_OPTIONS, s.timer, (o) => (o ? o + ' s' : 'Aus'), scope)}
      </div>
      <div class="setting">
        <div class="setting-label"><b>✍️ Eigene Skala</b><small>Die hinweisgebende Person darf selbst ein Gegensatzpaar eintippen</small></div>
        ${switchHtml(s.customScale, 'customScale', scope)}
      </div>
      <div class="setting">
        <div class="setting-label"><b>🍻 Trinkregeln</b><small>0 Punkte → das Team trinkt 1 · Volltreffer → 2 verteilen</small></div>
        ${switchHtml(s.drinks, 'drinks', scope)}
      </div>`);
    return `<div class="settings">${rows.join('')}</div>`;
  }

  function timerHtml(timer, tick) {
    if (!timer) return '';
    return `<div class="timer" data-timer ${tick ? 'data-tick' : ''} data-rem="${Math.round(timer.remaining)}" data-total="${timer.total}">
      <div class="timer-bar"><span data-timer-bar style="width:${(100 * timer.remaining) / (timer.total || 1)}%"></span></div>
      <b data-timer-text>${Math.ceil(timer.remaining / 1000)}</b>
    </div>`;
  }

  /**
   * Die Skala mit Enden.
   * opts: { id, input, target (sichtbar?), cover, small }
   */
  function dialHtml(v, opts) {
    const o = opts || {};
    const c = v.cur;
    const svg = Dial.svg({
      id: o.id || 'main',
      dial: o.noPointer ? null : dialValue(v),
      target: o.target != null ? o.target : null,
      band: v.band,
      cover: o.cover || 'closed',
      input: !!o.input,
      dragging: drag.active,
      label: `Skala ${c.scale.left} bis ${c.scale.right}`,
    });
    return `<div class="dial-wrap ${o.small ? 'dial-small' : ''} ${o.input ? 'dial-input' : ''} ${o.cls || ''}" style="${tc(turnColor(v))}">
      ${svg}
      <div class="dial-ends">
        <span class="end end-left"><small>◀</small>${esc(c.scale.left)}</span>
        <span class="end end-right">${esc(c.scale.right)}<small>▶</small></span>
      </div>
      ${c.scale.custom ? '<div class="custom-badge">✍️ eigene Skala</div>' : ''}
    </div>`;
  }

  /** Abdeckung für die Ansicht: auf beim Aufdecken, keine, wenn ich das Ziel ohnehin sehe */
  function coverFor(v, seesTarget) {
    if (seesTarget && v.phase !== 'reveal') return 'none';
    if (v.phase === 'reveal') return seesTarget && !v.me.stage && v.cur.giver === v.me.id ? 'none' : 'open';
    return 'closed';
  }

  function clueBoxHtml(v, big) {
    const c = v.cur;
    if (!c.clue) return `<div class="clue clue-voice ${big ? 'clue-big' : ''}"><small>Hinweis von ${esc(c.giverName)}</small><b>🗣️ laut gesagt</b></div>`;
    return `<div class="clue ${big ? 'clue-big' : ''}"><small>Hinweis von ${esc(c.giverName)}</small><b>„${esc(c.clue)}“</b></div>`;
  }

  function scorePillsHtml(v) {
    if (coopMode(v)) {
      const co = v.coop;
      if (!co) return '';
      return `<span class="pill">📡 Skala ${Math.min(co.played + (v.phase === 'reveal' ? 0 : 1), co.total)} / ${co.total}</span><span class="pill pill-hot">${co.score} ${plural(co.score, 'Punkt', 'Punkte')}</span>`;
    }
    return `<span class="scoreline">${v.teams
      .map((t, i) => `<span class="score-pill ${v.cur && v.active === i && v.phase !== 'over' ? 'is-active' : ''}" style="${tc(t.color)}"><span class="team-dot"></span><b>${esc(t.name)}</b><span class="sp-num">${t.score}</span></span>`)
      .join('<span class="sp-sep">:</span>')}</span><span class="pill" title="Ziel">🏁 ${v.settings.goal}</span>${v.tiebreak ? '<span class="pill pill-hot">⚔️ Stechen</span>' : ''}`;
  }

  /** Wer ist dran? */
  function turnBannerHtml(v, text) {
    const c = v.cur;
    const team = c.team ? teamOf(v, c.team) : null;
    return `<div class="turn" style="${tc(turnColor(v))}">
      <span class="turn-icon" aria-hidden="true">📡</span>
      <div><b>${team ? `${esc(team.name)} ist dran` : 'Alle zusammen'}</b><small>Hinweis von ${esc(c.giverName)}${text ? ` · ${text}` : ''}</small></div>
    </div>`;
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
            <small>${st.phase === 'lobby' ? 'Lobby' : esc(st.players.map((p) => p.name).join(' · '))}</small></button>
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
    const demo = Dial.svg({ id: 'home', dial: 128, target: 118, band: 7, cover: 'none' });
    return `
    <div class="screen home">
      <a class="btn btn-ghost btn-small hub-back" href="../">← Alle Spiele</a>
      <div class="home-hero">
        ${logoHtml()}
        <div class="home-dial" aria-hidden="true">${demo}
          <div class="dial-ends"><span class="end end-left"><small>◀</small>kalt</span><span class="end end-right">heiß<small>▶</small></span></div>
          <div class="home-clue">„Kaffee“</div>
        </div>
        <p class="tagline">Eine Person kennt das Ziel auf der Skala und sagt <b>einen</b> Hinweis.<br /><small>Seid ihr auf derselben Wellenlänge?</small></p>
      </div>
      ${resume.join('')}
      <div class="mode-cards">
        <button class="mode-card mode-stage" data-act="new-game">
          <span class="mode-icon">💻</span>
          <span class="mode-body"><b>Spiel anlegen</b><small>Am Laptop, Tablet oder Fernseher: Er zeigt Skala, Zeiger und das große Aufdecken.</small></span>
          <span class="mode-go">Los geht's →</span>
        </button>
        <button class="mode-card mode-phone" data-act="join-screen">
          <span class="mode-icon">📱</span>
          <span class="mode-body"><b>Mitspielen</b><small>Mit dem Handy beitreten – QR-Code am Laptop scannen oder Raum-Code eingeben.</small></span>
          <span class="mode-go">Beitreten →</span>
        </button>
      </div>
      <div class="home-links">
        <button class="btn btn-link" data-act="rules">📖 Spielregeln</button>
      </div>
      <p class="home-foot">2 Teams oder kooperativ · ${MIN_TEAM * 2}–${MAX_PLAYERS} Personen (kooperativ ab ${MIN_COOP}) · ${Scales.stats().total} Skalen</p>
    </div>`;
  }

  /* ---------- Spiel anlegen (Laptop) ---------- */

  function nameRowsHtml(list, listId, color) {
    return list
      .map(
        (p, pi) => `
        <div class="player-row" style="${tc(color(pi))}">
          <span class="team-dot"></span>
          <input class="input" type="text" maxlength="24" placeholder="Spieler ${pi + 1}" value="${esc(p)}"
            data-field="player-name" data-list="${listId}" data-player="${pi}" autocomplete="off" enterkeyhint="next" />
          ${list.length > (listId === 'coop' ? MIN_COOP : MIN_TEAM) ? `<button class="icon-btn" data-act="remove-player" data-list="${listId}" data-player="${pi}" aria-label="Spieler entfernen">✕</button>` : ''}
        </div>`
      )
      .join('');
  }

  function setupHtml() {
    const s = ui.setup;
    const st = s.settings;
    const inputCard = (id) => `
      <button class="input-card ${st.input === id ? 'on' : ''}" data-act="set" data-key="input" data-value="${id}" data-scope="setup" aria-pressed="${st.input === id}">
        <span class="input-icon">${INPUT[id].icon}</span>
        <b>${INPUT[id].label}</b>
        <small>${INPUT[id].text}</small>
      </button>`;
    let people;
    const total = s.players.blau.length + s.players.orange.length;
    if (st.input === 'one' && st.mode === 'teams') {
      people = `<h2>Teams <small class="muted">(je mindestens ${MIN_TEAM}, in der Reihenfolge, in der der Hinweis gegeben wird)</small></h2>
        <div class="team-grid">${TEAMS.map((t, ti) => {
          const list = s.players[t.id];
          return `<div class="team-setup" style="${tc(t.color)}">
            <div class="ts-head">
              <span class="team-dot"></span>
              <input class="input input-team" type="text" maxlength="24" placeholder="Team ${t.label}" value="${esc(s.teamNames[ti] || '')}" data-field="team-name" data-team="${ti}" aria-label="Teamname" />
            </div>
            <div class="ts-players">${nameRowsHtml(list, t.id, () => t.color)}</div>
            ${total < MAX_PLAYERS ? `<button class="btn btn-small btn-ghost" data-act="add-player" data-list="${t.id}">＋ Spieler</button>` : ''}
          </div>`;
        }).join('')}</div>`;
    } else if (st.input === 'one') {
      const list = s.players.coop;
      people = `<h2>Mitspieler <small class="muted">(${MIN_COOP}–${MAX_PLAYERS}, reihum gibt jede/r einen Hinweis)</small></h2>
        <div class="ts-players solo-players">${nameRowsHtml(list, 'coop', (pi) => PLAYER_COLORS[pi % PLAYER_COLORS.length])}</div>
        ${list.length < MAX_PLAYERS ? '<button class="btn btn-small btn-ghost" data-act="add-player" data-list="coop">＋ Spieler</button>' : ''}`;
    } else {
      people = `<h2>Mitspieler</h2><p class="muted">Jede/r tritt mit dem eigenen Handy bei (${st.mode === 'teams' ? `${MIN_TEAM * 2}–${MAX_PLAYERS} Personen, die Teams wählt ihr in der Lobby` : `${MIN_COOP}–${MAX_PLAYERS} Personen`}).</p>`;
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
        <div class="input-cards">${inputCard('phones')}${inputCard('one')}</div>
      </section>
      <section class="panel">
        <h2>Einstellungen</h2>
        ${settingsHtml(st, 'setup')}
      </section>
      <section class="panel">${people}</section>
      <div class="sticky-start">
        <button class="btn btn-primary btn-big" data-act="create-game">${st.input === 'phones' ? 'Raum öffnen 📱' : "Los geht's 📡"}</button>
      </div>
    </div>`;
  }

  /* ---------- Beitreten (Handy) ---------- */

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
        <label class="label" for="code-input">Raum-Code <small class="muted">(steht auf dem Laptop)</small></label>
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
    if (room.state === 'error') {
      return `<div class="alert">Der Raum konnte nicht geöffnet werden. Prüfe die Internetverbindung – es wird weiter versucht.</div>`;
    }
    if (!room.code || room.state !== 'online') {
      return `<div class="qr-wait"><div class="spinner" aria-hidden="true"></div><p>Raum wird geöffnet…</p></div>`;
    }
    const link = inviteLink(room.code);
    return `
      <div class="qr ${big ? 'qr-big' : ''}">${qrSvg(link)}</div>
      <div class="room-label">Raum-Code</div>
      <div class="room-code" data-testid="room-code">${esc(room.code)}</div>
      <p class="small muted link-text">${esc(link)}</p>`;
  }

  function topbarHtml(v) {
    let info = '';
    if (v.phase === 'over') info = '<span class="pill">🏁 Spielende</span>';
    else if (v.phase !== 'lobby') info = scorePillsHtml(v);
    const room = v.room && v.room.code && v.phase !== 'lobby' ? `<button class="pill pill-room" data-act="show-qr" title="Mitspieler einladen">📱 ${esc(v.room.code)}</button>` : '';
    return `
      <header class="topbar">
        <button class="topbar-brand" data-act="menu" aria-label="Menü">${logoHtml(true)}</button>
        <div class="topbar-info">${info}${room}</div>
        <div class="topbar-actions">
          <button class="icon-btn" data-act="mute" aria-label="Ton an/aus" title="Ton an/aus">${Sound.muted ? '🔇' : '🔊'}</button>
          <button class="icon-btn" data-act="menu" aria-label="Menü" title="Menü">☰</button>
        </div>
      </header>`;
  }

  function stageHtml(v) {
    let main;
    if (v.phase === 'lobby') main = lobbyStageHtml(v);
    else if (v.phase === 'over') main = overHtml(v);
    else if (v.phase === 'clue') main = clueStageHtml(v);
    else if (v.phase === 'dial') main = dialStageHtml(v);
    else if (v.phase === 'side') main = sideStageHtml(v);
    else main = revealStageHtml(v);
    return `
      <div class="stage phase-${v.phase}">
        ${topbarHtml(v)}
        <main class="stage-main">${main}</main>
      </div>`;
  }

  /* ---------- Lobby ---------- */

  function lobbyStageHtml(v) {
    const teams = !coopMode(v);
    const chip = (p) => {
      const m = v.members.find((x) => x.id === p.id) || { online: p.online };
      return `<span class="chip ${m.online ? '' : 'is-offline'}" style="${tc(teams && p.team ? teamOf(v, p.team).color : p.color)}"><span class="team-dot"></span>${esc(p.name)}${
        teams ? `<button class="chip-x chip-swap" data-act="swap-team" data-player="${esc(p.id)}" data-team="${p.team === 'blau' ? 'orange' : 'blau'}" title="Team wechseln" aria-label="${esc(p.name)}: Team wechseln">⇄</button>` : ''
      }<button class="chip-x" data-act="kick" data-player="${esc(p.id)}" aria-label="${esc(p.name)} entfernen">✕</button></span>`;
    };
    const watching = v.members.filter((m) => !m.playing);
    let people;
    if (teams) {
      people = `<div class="team-grid">${v.teams
        .map((team) => {
          const list = v.players.filter((p) => p.team === team.id);
          return `<div class="team-setup" style="${tc(team.color)}">
          <div class="ts-head">
            <span class="team-dot"></span>
            <input class="input input-team" type="text" maxlength="24" value="${esc(team.name)}" data-field="lobby-team-name" data-team="${team.id}" aria-label="Teamname" />
          </div>
          <div class="chips">${list.length ? list.map(chip).join('') : '<span class="muted">Noch niemand</span>'}</div>
        </div>`;
        })
        .join('')}</div>`;
    } else {
      people = `<div class="chips">${v.players.length ? v.players.map(chip).join('') : '<span class="muted">Noch niemand – QR-Code scannen!</span>'}</div>`;
    }
    return `
      <div class="lobby-grid">
        <section class="panel join-panel">
          <h2>📱 Handys verbinden</h2>
          <p class="muted">QR-Code scannen, Namen eingeben${teams ? ', Team wählen' : ''} – los geht's.</p>
          ${roomBoxHtml(v.room, true)}
        </section>
        <div class="lobby-side">
          <section class="panel">
            <h2>Mitspieler <small class="muted">(${v.players.length} / ${MAX_PLAYERS})</small></h2>
            ${people}
            ${watching.length ? `<div class="free"><b>Schauen nur zu:</b> <div class="chips">${watching.map((m) => `<span class="chip ${m.online ? '' : 'is-offline'}">${esc(m.name)}<button class="chip-x" data-act="kick" data-player="${esc(m.id)}" aria-label="${esc(m.name)} entfernen">✕</button></span>`).join('')}</div></div>` : ''}
            <p class="muted small">Den Hinweis gibt reihum jede/r einmal – in der Reihenfolge, in der ihr beigetreten seid.</p>
          </section>
          <section class="panel">
            <h2>Einstellungen</h2>
            ${settingsHtml(v.settings, 'lobby')}
          </section>
          <div class="sticky-start">
            <button class="btn btn-primary btn-big" data-act="start" ${v.lobbyProblem ? 'disabled' : ''}>Los geht's 📡</button>
            ${v.lobbyProblem ? `<p class="muted small center">${esc(v.lobbyProblem)}</p>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ---------- Hinweis ---------- */

  function customScaleFormHtml(v) {
    if (!v.settings.customScale) return '';
    return `<details class="custom-scale" ${ui.customLeft || ui.customRight ? 'open' : ''}>
      <summary>✍️ Eigene Skala eintippen</summary>
      <form class="custom-form" data-form="custom-scale">
        <input class="input" type="text" maxlength="${MAX_END}" placeholder="links, z.B. Pizza" value="${esc(ui.customLeft)}" data-field="custom-left" autocomplete="off" />
        <span aria-hidden="true">↔</span>
        <input class="input" type="text" maxlength="${MAX_END}" placeholder="rechts, z.B. Salat" value="${esc(ui.customRight)}" data-field="custom-right" autocomplete="off" />
        <button class="btn btn-small btn-ghost" type="submit" ${ui.customLeft.trim() && ui.customRight.trim() ? '' : 'disabled'}>Übernehmen</button>
      </form>
    </details>`;
  }

  /** Hinweis eintippen (optional) + „Hinweis gegeben“ */
  function clueFormHtml(v, stage) {
    const c = v.cur;
    const problem = clueProblem(ui.clue, c.scale);
    const typed = ui.clue.trim();
    return `<form class="clue-form" data-form="clue">
      <label class="label" for="clue-input">Hinweis <small class="muted">– eintippen oder einfach laut sagen</small></label>
      <input id="clue-input" class="input input-big input-clue" type="text" maxlength="${MAX_CLUE}" placeholder="z.B. Kaffee" value="${esc(ui.clue)}"
        data-field="clue" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="send" />
      ${problem ? `<div class="word-error">⚠️ ${esc(PROBLEM[problem])} – geht trotzdem</div>` : ''}
      <button class="btn btn-primary btn-big btn-wide" type="submit">${stage ? '🙈 Verdecken – ' : ''}${typed ? '📣 Hinweis senden' : '🗣️ Hinweis laut gesagt'}</button>
    </form>`;
  }

  function clueStageHtml(v) {
    const c = v.cur;
    const phones = v.settings.input === 'phones';
    if (phones) {
      return `
        <div class="center-stage clue-stage">
          ${turnBannerHtml(v)}
          ${dialHtml(v, { id: c.key, cover: 'closed' })}
          <div class="look-away small-away">
            <div class="look-away-icon" aria-hidden="true">🤫</div>
            <h2>${esc(c.giverName)} sieht das Ziel auf dem Handy</h2>
            <p class="muted">… und überlegt sich einen Begriff, der genau dort zwischen <b>${esc(c.scale.left)}</b> und <b>${esc(c.scale.right)}</b> liegt.</p>
          </div>
          <div class="stage-actions">
            <button class="btn btn-ghost btn-small" data-act="reroll" data-force="1" data-at="${esc(c.key)}">🔀 Neue Skala</button>
            <button class="btn btn-ghost btn-small" data-act="new-giver" data-at="${esc(c.key)}">👤 Jemand anderes</button>
            <button class="btn btn-ghost btn-small" data-act="clue-given" data-at="${esc(c.key)}">🗣️ Hinweis wurde gesagt</button>
          </div>
        </div>`;
    }
    const shown = ui.peek === c.key && c.target != null;
    if (!shown) {
      return `
        <div class="center-stage clue-stage">
          ${turnBannerHtml(v)}
          ${dialHtml(v, { id: c.key, cover: 'closed' })}
          <div class="look-away">
            <div class="look-away-icon" aria-hidden="true">🙈</div>
            <h1>Alle wegschauen – nur ${esc(c.giverName)}!</h1>
            <p class="muted">Erst wenn niemand sonst hinschaut, das Ziel aufdecken.</p>
            <button class="btn btn-primary btn-big" data-act="peek">👀 Ziel zeigen</button>
          </div>
        </div>`;
    }
    return `
      <div class="center-stage clue-stage">
        ${turnBannerHtml(v, '👀 nur du schaust')}
        ${dialHtml(v, { id: c.key, target: c.target, cover: 'none' })}
        <p class="muted center">Sag einen Begriff, der genau dort auf der Skala liegt – <b>keine Zahlen</b>, keine Wörter der Skala.</p>
        <div class="stage-actions">
          ${c.rerollsLeft > 0 ? `<button class="btn btn-ghost btn-small" data-act="reroll" data-at="${esc(c.key)}">🔀 Andere Skala (1×)</button>` : ''}
        </div>
        ${customScaleFormHtml(v)}
        ${clueFormHtml(v, true)}
      </div>`;
  }

  /* ---------- Zeiger ---------- */

  function locksHtml(v) {
    const c = v.cur;
    if (v.settings.input !== 'phones') return '';
    const here = c.guessers.filter((pid) => {
      const p = player(v, pid);
      return p && p.online;
    });
    const locked = c.locks.map((pid) => esc(nameOf(v, pid)));
    return `<p class="muted small center">${c.dialBy ? `✋ zuletzt gedreht: <b>${esc(c.dialBy)}</b> · ` : ''}${
      locked.length ? `Fertig: ${locked.join(', ')} (${locked.length}/${c.needed})` : `„Fertig“ braucht ${c.needed} ${plural(c.needed, 'Person', 'Personen')} im Team`
    }${here.length < c.guessers.length ? ` · ${c.guessers.length - here.length} offline` : ''}</p>`;
  }

  function dialStageHtml(v) {
    const c = v.cur;
    const phones = v.settings.input === 'phones';
    const team = c.team ? teamOf(v, c.team) : null;
    return `
      <div class="center-stage dial-stage">
        ${turnBannerHtml(v, team ? `${esc(team.name)} dreht den Zeiger` : 'dreht den Zeiger')}
        ${clueBoxHtml(v, true)}
        ${dialHtml(v, { id: c.key, cover: 'closed', input: true })}
        ${timerHtml(c.timer, true)}
        ${
          phones
            ? `${locksHtml(v)}<p class="muted small center">Gedreht wird auf den Handys${team ? ` von ${esc(team.name)}` : ''} – oder hier mit Maus und ← →.</p>`
            : `<p class="muted small center">Zeiger mit der <b>Maus</b>, dem <b>Finger</b> oder den <b>Pfeiltasten ← →</b> drehen (Umschalt = schneller). ${esc(c.giverName)} darf nicht helfen!</p>`
        }
        <div class="stage-actions">
          <button class="btn btn-primary btn-big" data-act="lock-now" data-at="${esc(c.key)}">✅ Zeiger steht${v.settings.mode === 'teams' && v.settings.sideGuess ? ' – Gegner tippt' : ' – aufdecken'}</button>
        </div>
      </div>`;
  }

  /* ---------- Links / rechts ---------- */

  function sideButtonsHtml(v, act, mine) {
    const c = v.cur;
    const n = (side) => (act === 'vote' || v.settings.input === 'phones' ? `<span class="side-count">${c.votes[side]}</span>` : '');
    return `<div class="side-btns">
      <button class="btn side-btn side-left ${mine === 'left' ? 'is-mine' : ''}" data-act="${act}" data-side="left" data-at="${esc(c.key)}">◀ Links${n('left')}</button>
      <button class="btn side-btn side-right ${mine === 'right' ? 'is-mine' : ''}" data-act="${act}" data-side="right" data-at="${esc(c.key)}">Rechts ▶${n('right')}</button>
    </div>`;
  }

  function sideStageHtml(v) {
    const c = v.cur;
    const phones = v.settings.input === 'phones';
    const other = otherTeamOf(v, c.team);
    const waiting = c.opponents.filter((pid) => !c.votes.by.includes(pid) && (player(v, pid) || {}).online);
    const total = c.votes.left + c.votes.right;
    return `
      <div class="center-stage side-stage">
        <div class="turn" style="${tc(other.color)}">
          <span class="turn-icon" aria-hidden="true">🤔</span>
          <div><b>${esc(other.name)} tippt</b><small>Liegt das Ziel links oder rechts vom Zeiger? Richtig = 1 Punkt</small></div>
        </div>
        ${clueBoxHtml(v, false)}
        ${dialHtml(v, { id: c.key, cover: 'closed' })}
        ${
          phones
            ? `<p class="muted center">${total ? `${total} ${plural(total, 'Stimme', 'Stimmen')}` : 'Noch keine Stimmen'}${waiting.length ? ` · warte auf ${waiting.map((pid) => esc(nameOf(v, pid))).join(', ')}` : ''}</p>
               ${sideButtonsHtml(v, 'side', null)}
               <div class="stage-actions">
                 ${total ? `<button class="btn btn-ghost btn-small" data-act="close-side" data-at="${esc(c.key)}">⏩ Jetzt auswerten (Mehrheit)</button>` : ''}
                 <button class="btn btn-ghost btn-small" data-act="side" data-side="" data-at="${esc(c.key)}">Kein Tipp</button>
               </div>
               <p class="muted small center">Die Handys stimmen ab – oder hier direkt anklicken, was ${esc(other.name)} ruft.</p>`
            : `${sideButtonsHtml(v, 'side', null)}
               <div class="stage-actions"><button class="btn btn-ghost btn-small" data-act="side" data-side="" data-at="${esc(c.key)}">Kein Tipp</button></div>`
        }
      </div>`;
  }

  /* ---------- Aufdecken ---------- */

  function resultLinesHtml(v) {
    const c = v.cur;
    const r = c.result;
    const team = c.team ? teamOf(v, c.team) : null;
    const other = c.team ? otherTeamOf(v, c.team) : null;
    const lines = [];
    if (c.side && other) {
      if (r.sidePoint) lines.push(`<li style="${tc(other.color)}">✅ ${esc(other.name)} hat richtig getippt (${SIDE[c.side]}) – <b>+1</b></li>`);
      else if (!r.actual) lines.push(`<li>🎯 Genau auf der Mitte – der Tipp zählt nicht</li>`);
      else lines.push(`<li style="${tc(other.color)}">❌ ${esc(other.name)} tippte ${SIDE[c.side]} – daneben</li>`);
    }
    if (r.extra) lines.push(`<li>🎁 Volltreffer – ihr bekommt eine <b>Skala extra</b>!</li>`);
    if (r.again && team) lines.push(`<li style="${tc(team.color)}">🔁 Aufholregel: <b>${esc(team.name)}</b> ist gleich nochmal dran!</li>`);
    if (r.tiebreak) lines.push(`<li>⚔️ Gleichstand am Ziel – <b>Stechen</b>! Nach jeder Runde gewinnt, wer vorne liegt.</li>`);
    if (v.winner) {
      const w = teamOf(v, v.winner);
      lines.push(`<li class="win" style="${tc(w.color)}">🏆 <b>${esc(w.name)}</b> gewinnt!</li>`);
    }
    if (v.settings.drinks) {
      const who = team ? esc(team.name) : 'Alle';
      if (r.points === 0) lines.push(`<li>🍻 ${who} ${team ? 'trinkt' : 'trinken'} 1 Schluck</li>`);
      else if (r.points === 4) lines.push(`<li>🍻 ${esc(c.giverName)} verteilt 2 Schlucke</li>`);
    }
    return lines.length ? `<ul class="result-lines">${lines.join('')}</ul>` : '';
  }

  /** Ist das der letzte Zug? (Sieger steht fest bzw. kooperativ alle Skalen gespielt) */
  function lastTurn(v) {
    if (v.winner) return true;
    return !!(v.coop && v.coop.played >= v.coop.total);
  }

  function nextLabel(v) {
    if (v.winner) return 'Zur Siegerehrung 🏆';
    if (lastTurn(v)) return 'Zum Ergebnis 🏁';
    return 'Nächste Skala →';
  }

  function revealStageHtml(v) {
    const c = v.cur;
    const r = c.result;
    const p = POINTS[r.points];
    const team = c.team ? teamOf(v, c.team) : null;
    return `
      <div class="center-stage reveal" id="rv-${esc(c.key)}">
        ${clueBoxHtml(v, false)}
        ${dialHtml(v, { id: c.key, target: c.target, cover: 'open', cls: 'is-reveal' })}
        <div class="result reveal-after" style="${tc(p.color)};--d:1.1s">
          <span class="result-num">${r.points}</span>
          <div><b>${p.icon} ${p.label}</b><small>${r.points ? `${r.points} ${plural(r.points, 'Punkt', 'Punkte')} für ${team ? esc(team.name) : 'euch'}` : 'Keine Punkte'} · ${deg(r.deviation)} daneben</small></div>
        </div>
        <div class="reveal-after" style="--d:1.4s">${resultLinesHtml(v)}</div>
        <button class="btn btn-primary btn-big next-float reveal-after" style="--d:1.6s" data-act="next" data-no="${c.no}">${nextLabel(v)}</button>
      </div>`;
  }

  /* ---------- Spielende ---------- */

  function historyHtml(v) {
    const list = v.history || [];
    if (!list.length) return '';
    const items = list
      .map((h) => {
        const team = h.team ? teamOf(v, h.team) : null;
        return `<li style="${tc(team ? team.color : '#38bdf8')}"><span class="h-pts">${h.points}</span>
          <span><b>${esc(h.left)} ↔ ${esc(h.right)}</b>${h.clue ? ` · „${esc(h.clue)}“` : ''}<br /><small class="muted">${esc(h.giverName)}${team ? ` (${esc(team.name)})` : ''} · ${deg(h.deviation)} daneben${h.sideOk ? ' · Gegner tippte richtig' : ''}</small></span></li>`;
      })
      .join('');
    return `<details class="word-list"><summary>📜 Alle Skalen dieses Spiels (${list.length})</summary><ol class="history">${items}</ol></details>`;
  }

  function awardsHtml(v) {
    const awards = (v.awards || []).map((a) => `<div class="award"><span class="award-icon">${a.icon}</span><div><b>${esc(a.title)}</b><small>${esc(a.text)}</small></div></div>`).join('');
    return awards ? `<div class="awards">${awards}</div>` : '';
  }

  function overHtml(v) {
    let head;
    if (coopMode(v)) {
      const co = v.coop || { score: 0, played: 0, bonus: 0 };
      const r = co.rating || coopRating(co.score);
      head = `<div class="final">
          <div class="final-icon" aria-hidden="true">${r.icon}</div>
          <div class="final-num"><b>${co.score}</b><span> ${plural(co.score, 'Punkt', 'Punkte')}</span></div>
          <div class="final-label">${esc(r.title)}</div>
          <p class="final-text">${esc(r.text)} <small class="muted">· ${co.played} ${plural(co.played, 'Skala', 'Skalen')}${co.bonus ? `, davon ${co.bonus} extra` : ''}</small></p>
        </div>
        <p class="muted small center">${COOP_RATINGS.slice()
          .reverse()
          .map((x) => `${x.icon} ${x.min}+ ${esc(x.title)}`)
          .join(' · ')}</p>`;
    } else {
      const w = v.winner ? teamOf(v, v.winner) : null;
      head = `<h1 class="over-title">${w ? `🏆 ${esc(w.name)} gewinnt!` : '🤝 Unentschieden!'}</h1>
        <div class="versus-result">${v.teams
          .map((t) => `<div class="vr ${w && w.id === t.id ? 'is-winner' : ''}" style="${tc(t.color)}"><span class="team-dot"></span><b>${esc(t.name)}</b><span class="vr-num">${t.score}</span><small>${plural(t.score, 'Punkt', 'Punkte')}</small></div>`)
          .join('')}</div>`;
    }
    return `
      <div class="center-stage over">
        ${head}
        ${awardsHtml(v)}
        ${historyHtml(v)}
        <div class="stage-actions">
          <button class="btn btn-primary btn-big" data-act="again">🔁 Nochmal</button>
          <button class="btn btn-ghost" data-act="home">Hauptmenü</button>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Handy                                                               */
  /* ------------------------------------------------------------------ */

  function phoneStatusBanner() {
    if (ui.status === 'reconnecting' || ui.status === 'connecting') {
      return `<div class="status-banner"><span class="spinner-sm"></span> Verbindung zum Laptop unterbrochen – verbinde neu…</div>`;
    }
    return '';
  }

  function playerHtml(v) {
    const me = v.me;
    const p = player(v, me.id);
    const team = p && p.team && !coopMode(v) ? teamOf(v, p.team) : null;
    let body;
    if (v.phase === 'lobby') body = phoneLobbyHtml(v, p);
    else if (v.phase === 'over') body = phoneOverHtml(v);
    else if (v.phase === 'clue') body = phoneClueHtml(v);
    else if (v.phase === 'dial') body = phoneDialHtml(v);
    else if (v.phase === 'side') body = phoneSideHtml(v);
    else body = phoneRevealHtml(v);
    const color = team ? team.color : p ? p.color : '#94a3b8';
    return `
      <div class="phone" style="${tc(color)}">
        <header class="phone-head">
          <span class="team-dot"></span>
          <b>${esc(me.name)}</b>
          <span class="phone-name">${[team ? esc(team.name) : p ? '' : 'Zuschauer', me.lead ? '🎬 Spielleitung' : ''].filter(Boolean).join(' · ')}</span>
          <button class="icon-btn" data-act="menu" aria-label="Menü">☰</button>
        </header>
        ${phoneStatusBanner()}
        ${v.cur ? `<div class="phone-score">${scorePillsHtml(v)}</div>` : ''}
        <main class="phone-main">${body}</main>
      </div>`;
  }

  function phoneLobbyHtml(v, p) {
    const n = v.players.length;
    if (!p) return `<div class="look-up">👀<b>Du schaust zu</b><small>Das Spiel ist voll (${MAX_PLAYERS} Personen).</small></div>`;
    let teams = '';
    if (!coopMode(v)) {
      teams = `<h2 class="phone-title">Wähle dein Team</h2>
        <div class="team-pick">${v.teams
          .map(
            (t) => `<button class="team-btn ${p.team === t.id ? 'is-mine' : ''}" style="${tc(t.color)}" data-act="join-team" data-team="${t.id}" aria-pressed="${p.team === t.id}">
            <b>${esc(t.name)} ${p.team === t.id ? '✓' : ''}</b>
            <small>${v.players.filter((x) => x.team === t.id).map((x) => esc(x.name)).join(' · ') || 'noch leer'}</small>
          </button>`
          )
          .join('')}</div>`;
    }
    return `<div class="look-up">📡<b>Du bist dabei!</b><small>${n} ${plural(n, 'Person', 'Personen')} im Spiel${coopMode(v) ? ' · kooperativ' : ''}</small></div>
      ${teams}
      <p class="waiting">⏳ Warte, bis es am Laptop losgeht…</p>`;
  }

  function leadToolsHtml(v, items) {
    if (!v.me.lead || !items.length) return '';
    return `<div class="lead-tools"><small>🎬 Du bist die Spielleitung</small>${items.join('')}</div>`;
  }

  function isGiver(v) {
    return !!(v.cur && v.cur.giver === v.me.id);
  }

  function phoneClueHtml(v) {
    const c = v.cur;
    const lead = leadToolsHtml(v, [
      `<button class="btn btn-ghost btn-small" data-act="reroll" data-force="1" data-at="${esc(c.key)}">🔀 Neue Skala</button>`,
      `<button class="btn btn-ghost btn-small" data-act="new-giver" data-at="${esc(c.key)}">👤 Jemand anderes</button>`,
    ]);
    if (isGiver(v)) {
      return `<h2 class="phone-title">📡 Du gibst den Hinweis!</h2>
        ${dialHtml(v, { id: 'ph-' + c.key, target: c.target, cover: 'none', noPointer: true })}
        <p class="muted small center">Ein Begriff, der genau dort auf der Skala liegt – <b>keine Zahlen</b>, keine Wörter der Skala, nichts zeigen.</p>
        ${c.rerollsLeft > 0 ? `<button class="btn btn-ghost btn-small" data-act="reroll" data-at="${esc(c.key)}">🔀 Andere Skala (1×)</button>` : ''}
        ${customScaleFormHtml(v)}
        ${clueFormHtml(v, false)}`;
    }
    const mine = v.me.team && c.team && v.me.team === c.team;
    return `${dialHtml(v, { id: 'ph-' + c.key, cover: 'closed', small: true })}
      <div class="look-up small">⏳<b>${esc(c.giverName)} überlegt …</b><small>${coopMode(v) ? 'Gleich dreht ihr alle zusammen den Zeiger.' : mine ? 'Gleich dreht ihr den Zeiger!' : 'Gleich tippt ihr: links oder rechts?'}</small></div>
      ${lead}`;
  }

  function phoneDialHtml(v) {
    const c = v.cur;
    const lead = leadToolsHtml(v, [`<button class="btn btn-ghost btn-small" data-act="lock-now" data-at="${esc(c.key)}">✅ Zeiger steht</button>`]);
    if (isGiver(v)) {
      return `${clueBoxHtml(v, false)}
        ${dialHtml(v, { id: 'ph-' + c.key, target: c.target, cover: 'none' })}
        <div class="look-up small">🤐<b>Psst – nicht helfen!</b><small>Dein Team dreht den Zeiger. Kein Grinsen, kein Seufzen!</small></div>
        ${timerHtml(c.timer, false)}${lead}`;
    }
    if (canDial(v)) {
      const locked = c.locks.includes(v.me.id);
      return `${clueBoxHtml(v, false)}
        ${dialHtml(v, { id: 'ph-' + c.key, cover: 'closed', input: true })}
        <p class="muted small center">👆 Zeiger mit dem Finger ziehen – alle sehen ihn live.${c.dialBy && c.dialBy !== v.me.name ? ` Zuletzt: <b>${esc(c.dialBy)}</b>` : ''}</p>
        ${timerHtml(c.timer, true)}
        <button class="btn ${locked ? 'btn-ok' : 'btn-primary'} btn-big btn-wide" data-act="lock" data-at="${esc(c.key)}">${
          locked ? `✓ Fertig – warte auf die anderen (${c.locks.length}/${c.needed})` : c.needed > 1 ? `Fertig ✓ (${c.locks.length}/${c.needed})` : 'Fertig ✓'
        }</button>
        ${locked ? '<p class="muted small center">Nochmal tippen = doch nicht fertig</p>' : ''}
        ${lead}`;
    }
    const team = c.team ? teamOf(v, c.team) : null;
    return `${clueBoxHtml(v, false)}
      ${dialHtml(v, { id: 'ph-' + c.key, cover: 'closed' })}
      <div class="look-up small">👀<b>${team ? `${esc(team.name)} dreht …` : 'Die anderen drehen …'}</b><small>${v.settings.sideGuess && !coopMode(v) ? 'Gleich tippt ihr: liegt das Ziel links oder rechts vom Zeiger?' : 'Mal sehen, ob sie auf deiner Wellenlänge sind.'}</small></div>
      ${timerHtml(c.timer, false)}${lead}`;
  }

  function phoneSideHtml(v) {
    const c = v.cur;
    const lead = leadToolsHtml(v, [`<button class="btn btn-ghost btn-small" data-act="close-side" data-at="${esc(c.key)}">⏩ Jetzt auswerten</button>`]);
    const other = otherTeamOf(v, c.team);
    const voter = c.opponents.includes(v.me.id);
    if (voter) {
      return `${clueBoxHtml(v, false)}
        ${dialHtml(v, { id: 'ph-' + c.key, cover: 'closed', small: true })}
        <h2 class="phone-title">Liegt das Ziel …</h2>
        ${sideButtonsHtml(v, 'vote', c.myVote)}
        <p class="muted small center">${c.myVote ? 'Abgestimmt – ändern geht, bis alle getippt haben.' : 'Die Mehrheit zählt (Gleichstand: rechts). Richtig = 1 Punkt.'}</p>
        ${lead}`;
    }
    return `${clueBoxHtml(v, false)}
      ${isGiver(v) ? dialHtml(v, { id: 'ph-' + c.key, target: c.target, cover: 'none', small: true }) : dialHtml(v, { id: 'ph-' + c.key, cover: 'closed', small: true })}
      <div class="look-up small">🤔<b>${esc(other.name)} tippt …</b><small>links oder rechts vom Zeiger? ${c.votes.left + c.votes.right} ${plural(c.votes.left + c.votes.right, 'Stimme', 'Stimmen')}</small></div>
      ${lead}`;
  }

  function phoneRevealHtml(v) {
    const c = v.cur;
    const r = c.result;
    const p = POINTS[r.points];
    const team = c.team ? teamOf(v, c.team) : null;
    const lead = v.me.lead
      ? `<button class="btn btn-primary btn-big btn-wide phone-next" data-act="next" data-no="${c.no}">${nextLabel(v)}<small>Du bist die Spielleitung</small></button>`
      : '';
    return `
      <div class="phone-result">
        ${dialHtml(v, { id: 'ph-' + c.key, target: c.target, cover: coverFor(v, isGiver(v)), cls: 'is-reveal' })}
        <div class="result reveal-after" style="${tc(p.color)};--d:1.1s">
          <span class="result-num">${r.points}</span>
          <div><b>${p.icon} ${p.label}</b><small>${team ? esc(team.name) : 'Ihr'} · ${deg(r.deviation)} daneben</small></div>
        </div>
        <div class="reveal-after" style="--d:1.3s">${resultLinesHtml(v)}</div>
      </div>
      ${lead}`;
  }

  function phoneOverHtml(v) {
    let head;
    if (coopMode(v)) {
      const co = v.coop || { score: 0 };
      const r = co.rating || coopRating(co.score);
      head = `<div class="look-up win">${r.icon}<b>${co.score} ${plural(co.score, 'Punkt', 'Punkte')}</b><small>${esc(r.title)} – ${esc(r.text)}</small></div>`;
    } else {
      const w = v.winner ? teamOf(v, v.winner) : null;
      const mine = v.me.team;
      const score = v.teams.map((t) => `${esc(t.name)} ${t.score}`).join(' · ');
      head = !w
        ? `<div class="look-up">🤝<b>Unentschieden!</b><small>${score}</small></div>`
        : w.id === mine
          ? `<div class="look-up win">🏆<b>Ihr habt gewonnen!</b><small>${score}</small></div>`
          : `<div class="look-up">📡<b>${esc(w.name)} gewinnt</b><small>${score}</small></div>`;
    }
    return `${head}${awardsHtml(v)}
      <p class="muted small center">Am Laptop kann eine neue Runde gestartet werden.</p>`;
  }

  /* ------------------------------------------------------------------ */
  /* Dialoge                                                             */
  /* ------------------------------------------------------------------ */

  function modalHtml() {
    if (!ui.modal) return '';
    let body = '';
    if (ui.modal === 'rules') body = rulesHtml();
    else if (ui.modal === 'menu') body = menuHtml();
    else if (ui.modal === 'qr') {
      body = `<h2>📱 Mitspieler einladen</h2>${roomBoxHtml(ui.view && ui.view.room, false)}
        <p class="muted small center">Wer jetzt beitritt, kommt ins kleinere Team.</p>
        <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig</button></div>`;
    } else if (ui.modal === 'confirm' && ui.confirm) {
      body = `
        <h2>${esc(ui.confirm.title)}</h2>
        <p>${esc(ui.confirm.text)}</p>
        <div class="modal-actions">
          <button class="btn ${ui.confirm.danger ? 'btn-danger' : 'btn-primary'}" data-act="confirm-yes">${esc(ui.confirm.yes)}</button>
          <button class="btn btn-ghost" data-act="close-modal">Abbrechen</button>
        </div>`;
    }
    return `
      <div class="overlay modal-overlay" data-act="close-modal-bg">
        <div class="modal" role="dialog" aria-modal="true">
          <button class="icon-btn modal-close" data-act="close-modal" aria-label="Schließen">✕</button>
          ${body}
        </div>
      </div>`;
  }

  function rulesHtml() {
    return `
      <h2>📖 Spielregeln</h2>
      <div class="rules">
        <p>Auf dem Bildschirm liegt eine <b>Skala</b> zwischen zwei Gegensätzen, z.B. <i>kalt ↔ heiß</i>. Nur eine Person sieht,
          wo auf der Skala das <b>Ziel</b> liegt, und sagt <b>einen Hinweis</b> – z.B. <i>„Kaffee“</i>. Ihr Team dreht den
          <b>Zeiger</b> dorthin, wo es das Ziel vermutet.</p>
        <h3>🎯 Punkte</h3>
        <p>Das Ziel hat 5 Streifen: <b>2 · 3 · 4 · 3 · 2</b>. Zeiger in der Mitte = 4 Punkte, daneben 3, außen 2, sonst 0.</p>
        <h3>🗣️ Der Hinweis</h3>
        <p>Ein Begriff (darf auch aus mehreren Wörtern bestehen), der genau dort auf der Skala liegt. Verboten: Zahlen und Prozente,
          Wörter der Skala selbst und Synonyme der Enden. Die hinweisgebende Person darf beim Drehen nicht helfen – kein Grinsen!
          Einmal pro Zug darf sie eine <b>andere Skala</b> ziehen.</p>
        <h3>◀▶ Links oder rechts?</h3>
        <p>Steht der Zeiger, tippt das <b>Gegnerteam</b>: Liegt das Ziel links oder rechts vom Zeiger? Richtig = <b>1 Punkt</b>.
          Steht der Zeiger genau auf der Mitte, bekommt niemand den Punkt.</p>
        <h3>🏁 Gewinnen</h3>
        <p>Die Teams wechseln sich ab, der Hinweis geht reihum. Erstes Team mit <b>10 Punkten</b> gewinnt (Team 2 startet mit 1 Punkt
          als Ausgleich). Kommen beide im selben Zug ans Ziel, gewinnt das Team mit mehr Punkten – bei Gleichstand gibt es ein
          <b>Stechen</b>. <b>Aufholregel:</b> Wer eine 4 holt und trotzdem hinten liegt, ist gleich nochmal dran.</p>
        <h3>🤝 Kooperativ</h3>
        <p>Alle sind ein Team, ${COOP_SCALES} Skalen, kein Links/Rechts-Tipp. Jede 4 bringt eine Skala extra.
          ${COOP_RATINGS.slice()
            .reverse()
            .map((r) => `${r.min}+ ${esc(r.title)}`)
            .join(' · ')}.</p>
        <h3>📱 Mit Handys / 🖥️ Ein Gerät</h3>
        <p>Mit Handys sieht nur die hinweisgebende Person das Ziel, alle im Team drehen den Zeiger live, „Fertig“ braucht 2 Stimmen.
          Mit einem Gerät schauen alle weg, während das Ziel am Laptop kurz aufgedeckt wird.</p>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Los geht's!</button></div>`;
  }

  function menuHtml() {
    const v = ui.view;
    const items = [];
    items.push(`<button class="menu-item" data-act="rules">📖 Spielregeln</button>`);
    items.push(`<button class="menu-item" data-act="mute">${Sound.muted ? '🔊 Ton einschalten' : '🔇 Ton ausschalten'}</button>`);
    if (v && v.me.stage) {
      if (v.room) items.push(`<button class="menu-item" data-act="show-qr">📱 Mitspieler einladen</button>`);
      if (v.cur && v.phase === 'clue') {
        items.push(`<button class="menu-item" data-act="reroll" data-force="1" data-at="${esc(v.cur.key)}">🔀 Neue Skala</button>`);
        items.push(`<button class="menu-item" data-act="new-giver" data-at="${esc(v.cur.key)}">👤 Jemand anderes gibt den Hinweis</button>`);
      }
      items.push(`<button class="menu-item" data-act="home-keep">🏠 Hauptmenü <small>(Spiel bleibt gespeichert)</small></button>`);
      if (!['lobby', 'over'].includes(v.phase)) items.push(`<button class="menu-item danger" data-act="end-game">⏹️ Spiel beenden & Ergebnis zeigen</button>`);
      items.push(`<button class="menu-item danger" data-act="close-game">🚪 Spiel schließen</button>`);
    } else if (v) {
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
    if (scope === 'setup') {
      ui.setup.settings = sanitizeSettings(Object.assign({}, ui.setup.settings, { [key]: value }), ui.setup.settings);
      saveSetup();
      render();
    } else if (ui.view) {
      dispatch('settings', { settings: Object.assign({}, ui.view.settings, { [key]: value }) });
    }
  }

  function scopeSettings(scope) {
    return scope === 'setup' ? ui.setup.settings : ui.view.settings;
  }

  function createGame() {
    const s = ui.setup;
    const st = s.settings;
    ui.error = null;
    let players = [];
    if (st.input === 'one') {
      if (st.mode === 'teams') {
        if (s.players.blau.length < MIN_TEAM || s.players.orange.length < MIN_TEAM) {
          ui.error = `Jedes Team braucht mindestens ${MIN_TEAM} Personen.`;
          render();
          return;
        }
        players = TEAMS.flatMap((t) => s.players[t.id].map((name) => ({ name, team: t.id })));
      } else {
        if (s.players.coop.length < MIN_COOP) {
          ui.error = `Ihr braucht mindestens ${MIN_COOP} Personen.`;
          render();
          return;
        }
        players = s.players.coop.map((name) => ({ name }));
      }
    }
    const state = Engine.create({ settings: st, players, teamNames: s.teamNames });
    Sound.unlock();
    startStage({ state });
  }

  /** a.at: Kennung des Zugs, damit verspätete Klicks nicht beim nächsten Zug landen */
  const at = (el) => (el.dataset.at ? { at: el.dataset.at } : {});

  const actions = {
    home: () => goHome(false),
    'home-keep': () => goHome(true),
    'new-game': () => {
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
    'close-modal': () => {
      ui.modal = null;
      ui.confirm = null;
      render();
    },
    'close-modal-bg': (el, e) => {
      if (e.target === el) actions['close-modal']();
    },
    'confirm-yes': () => {
      const run = ui.confirm && ui.confirm.run;
      ui.modal = null;
      ui.confirm = null;
      if (run) run();
      render();
    },
    mute: () => {
      Sound.setMuted(!Sound.muted);
      render();
    },
    'show-qr': () => {
      ui.modal = 'qr';
      render();
    },
    'leave-now': () => goHome(false),
    leave: () =>
      askConfirm({
        title: 'Spiel verlassen?',
        text: 'Du kannst über den Raum-Code jederzeit wieder beitreten.',
        yes: 'Verlassen',
        danger: true,
        run: () => goHome(false),
      }),
    'close-game': () =>
      askConfirm({
        title: 'Spiel schließen?',
        text: 'Das Spiel wird beendet und nicht gespeichert. Verbundene Handys werden getrennt.',
        yes: 'Schließen',
        danger: true,
        run: () => goHome(false),
      }),
    'end-game': () =>
      askConfirm({
        title: 'Spiel beenden?',
        text: 'Das Spiel endet sofort – der laufende Zug zählt nicht.',
        yes: 'Beenden',
        danger: true,
        run: () => dispatch('end'),
      }),

    /* Setup & Lobby */
    set: (el) => {
      const key = el.dataset.key;
      let value = el.dataset.value;
      if (['goal', 'timer'].includes(key)) value = +value;
      setSetting(el.dataset.scope, key, value);
    },
    toggle: (el) => setSetting(el.dataset.scope, el.dataset.key, !scopeSettings(el.dataset.scope)[el.dataset.key]),
    'toggle-cat': (el) => {
      const cats = scopeSettings(el.dataset.scope).categories;
      const id = el.dataset.cat;
      const next = cats.includes(id) ? cats.filter((c) => c !== id) : cats.concat(id);
      if (!next.length) {
        toast('Mindestens eine Kategorie bleibt an.');
        return;
      }
      setSetting(el.dataset.scope, 'categories', next);
    },
    'add-player': (el) => {
      const s = ui.setup;
      const list = s.players[el.dataset.list];
      const total = el.dataset.list === 'coop' ? list.length : s.players.blau.length + s.players.orange.length;
      if (!list || total >= MAX_PLAYERS) return;
      list.push('');
      saveSetup();
      ui.focus = `[data-field="player-name"][data-list="${el.dataset.list}"][data-player="${list.length - 1}"]`;
      render();
    },
    'remove-player': (el) => {
      const list = ui.setup.players[el.dataset.list];
      if (!list || list.length <= (el.dataset.list === 'coop' ? MIN_COOP : MIN_TEAM)) return;
      list.splice(+el.dataset.player, 1);
      saveSetup();
      render();
    },
    'create-game': createGame,
    kick: (el) => dispatch('kick', { player: el.dataset.player }),
    'swap-team': (el) => dispatch('joinTeam', { player: el.dataset.player, team: el.dataset.team }),
    'join-team': (el) => dispatch('joinTeam', { team: el.dataset.team }),
    start: () => dispatch('start'),

    /* Spiel */
    peek: () => {
      ui.peek = ui.view && ui.view.cur ? ui.view.cur.key : null;
      Sound.flip();
      render();
    },
    reroll: (el) => dispatch('reroll', Object.assign({ force: el.dataset.force === '1' }, at(el))),
    'new-giver': (el) => dispatch('newGiver', at(el)),
    'clue-given': (el) => dispatch('clue', Object.assign({ text: '' }, at(el))),
    'lock-now': (el) => dispatch('lockNow', at(el)),
    lock: (el) => dispatch('lock', at(el)),
    vote: (el) => {
      vibrate(30);
      dispatch('vote', Object.assign({ side: el.dataset.side }, at(el)));
    },
    side: (el) => dispatch('side', Object.assign({ side: el.dataset.side || null }, at(el))),
    'close-side': (el) => dispatch('closeSide', at(el)),
    next: (el) => dispatch('next', { no: el.dataset.no ? +el.dataset.no : undefined }),
    again: () => dispatch('again'),
  };

  /* ------------------------------------------------------------------ */
  /* Event-Listener                                                      */
  /* ------------------------------------------------------------------ */

  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled || !app.contains(el)) return;
    const fn = actions[el.dataset.act];
    if (!fn) return;
    Sound.unlock();
    if (el.dataset.act !== 'close-modal-bg') Sound.click();
    // Menüpunkte schließen das Menü, bevor sie etwas tun
    if (ui.modal === 'menu' && el.closest('.modal') && !['close-modal', 'mute'].includes(el.dataset.act)) ui.modal = null;
    fn(el, e);
  });

  app.addEventListener('input', (e) => {
    const el = e.target;
    const f = el.dataset && el.dataset.field;
    if (!f) return;
    if (f === 'player-name') {
      const list = ui.setup.players[el.dataset.list];
      if (list) list[+el.dataset.player] = el.value;
      saveSetup();
    } else if (f === 'team-name') {
      ui.setup.teamNames[+el.dataset.team] = el.value;
      saveSetup();
    } else if (f === 'name') {
      ui.name = el.value;
    } else if (f === 'join-code') {
      ui.joinCode = Net.cleanCode(el.value);
    } else if (f === 'clue') {
      ui.clue = el.value;
      render();
    } else if (f === 'custom-left') {
      ui.customLeft = el.value;
      render();
    } else if (f === 'custom-right') {
      ui.customRight = el.value;
      render();
    }
  });

  app.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.field === 'lobby-team-name') dispatch('teamName', { team: el.dataset.team, name: el.value });
  });

  app.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key !== 'Enter' || !el.dataset) return;
    if (el.dataset.field === 'player-name') {
      e.preventDefault();
      const next = app.querySelector(`[data-field="player-name"][data-list="${el.dataset.list}"][data-player="${+el.dataset.player + 1}"]`);
      if (next) next.focus();
      else actions['add-player'](el);
    } else if (el.dataset.field === 'name') {
      e.preventDefault();
      const code = app.querySelector('#code-input');
      if (code && !code.value) code.focus();
      else app.querySelector('[data-form="join"] button[type="submit"]').click();
    } else if (el.dataset.field === 'lobby-team-name' || el.dataset.field === 'team-name') {
      el.blur();
    }
  });

  app.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const v = ui.view;
    if (form.dataset.form === 'join') {
      const name = ui.name.trim();
      const input = form.querySelector('[data-field="join-code"]');
      const code = Net.cleanCode(input ? input.value : '');
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
      return;
    }
    if (!v || !v.cur) return;
    if (form.dataset.form === 'clue') {
      if (document.activeElement) document.activeElement.blur();
      ui.peek = null;
      dispatch('clue', { text: ui.clue.trim(), at: v.cur.key });
    } else if (form.dataset.form === 'custom-scale') {
      const left = ui.customLeft.trim();
      const right = ui.customRight.trim();
      if (!left || !right) return;
      if (document.activeElement) document.activeElement.blur();
      dispatch('customScale', { left, right, at: v.cur.key });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.modal) {
      ui.modal = null;
      ui.confirm = null;
      render();
      return;
    }
    // Zeiger mit den Pfeiltasten (Laptop; auf dem Handy, wenn der Zeiger den Fokus hat)
    const v = ui.view;
    if (ui.modal || !canDial(v) || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (!v.me.stage && !(t && t.closest && t.closest('[data-dial-input]'))) return;
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    const base = dialValue(v);
    drag.holdUntil = performance.now() + DIAL_HOLD_MS;
    moveDial(base + (e.key === 'ArrowRight' ? step : -step));
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

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.WL_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  requestAnimationFrame(timerLoop);
  autoResume();

  // für Tests
  window.WLApp = { ui, render: renderNow, actions };
})();
