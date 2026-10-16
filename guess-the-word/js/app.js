/*
 * Oberfläche von Guess the word!: Bildschirme, Spielbrett, Kartenstapel, Karten & Timer.
 * Gerendert wird per HTML-String + morphdom (nur geänderte Teile werden ersetzt).
 */
(function () {
  'use strict';

  const { CATS, DIFFS, POINTS, TEAMS, TIMER_OPTIONS, LENGTH_OPTIONS, Engine } = window.ActivityEngine;
  const { OfflineController, HostController, ClientController, Store, KEYS, Net, inviteLink, qrSvg } = window.ActivityControllers;
  const { Sound, confetti } = window.GameFx;
  const Sketch = window.ActivitySketch;
  const Deck = window.ActivityDeck;

  const CAT = {
    erklaeren: { label: 'Erklären', icon: '💬', verb: 'erklärt', rule: 'Erklären ohne die verbotenen Wörter' },
    zeichnen: { label: 'Zeichnen', icon: '✏️', verb: 'zeichnet', rule: 'Zeichnen ohne Buchstaben & Zahlen' },
    pantomime: { label: 'Pantomime', icon: '🎭', verb: 'stellt dar', rule: 'Darstellen ohne Worte & Geräusche' },
  };
  const DIFF = { leicht: 'Leicht', mittel: 'Mittel', schwer: 'Schwer' };
  const TEAM_COLOR = { rot: '#ef4444', blau: '#3b82f6', gruen: '#22c55e', gelb: '#facc15' };
  const PEN_COLORS = ['#1f2937', '#ef4444', '#2563eb', '#16a34a', '#f59e0b', '#8b5cf6', '#92400e'];
  const PEN_WIDTHS = [0.005, 0.009, 0.016];
  const SETUP_KEY = 'activity.setup.v1';
  const PREFS_KEY = 'activity.prefs.v1';
  const ACTIVE_KEY = 'activity.active';
  const MAX_PLAYERS = 10;
  const RESUME_MAX_AGE = 12 * 60 * 60 * 1000;

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

  function defaultSetup() {
    return {
      teams: TEAMS.map((t, i) => ({ id: t.id, active: i < 2, name: '', players: ['', ''] })),
      settings: { adult: false, timer: 60, length: 40, phone: false },
    };
  }

  function loadSetup() {
    const saved = Store.get(SETUP_KEY);
    if (!saved || !Array.isArray(saved.teams) || saved.teams.length !== 4) return defaultSetup();
    saved.settings = Object.assign(defaultSetup().settings, saved.settings || {});
    return saved;
  }

  function teamOf(v, id) {
    return v.teams.find((t) => t.id === id);
  }

  function teamLabel(t) {
    return esc(t.name);
  }

  function plural(n, one, many) {
    return n === 1 ? one : many;
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
    status: null,
    statusInfo: {},
    setup: loadSetup(),
    name: prefs.name || '',
    joinCode: Net.cleanCode(params.get('raum') || ''),
    remoteCode: Net.cleanCode(params.get('karte') || ''),
    error: null,
    modal: null,
    confirm: null,
    toast: null,
    revealed: null,
    phoneHidden: null,
    drawOpen: false,
    peek: false,
    fly: null,
    timer: null,
    box: { w: 0, h: 0 },
    layout: null,
    strokeLog: [],
    strokeTurn: null,
    sketch: null,
    pen: { color: PEN_COLORS[0], width: PEN_WIDTHS[1], eraser: false },
    pawnPos: {},
    pawnKey: null,
    focus: null,
  };
  if (ui.joinCode) ui.screen = 'online';

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
    const cb = {
      onView: guard(handleView),
      onStroke: guard(handleStroke),
      onStrokes: guard(handleStrokes),
      onStatus: guard(handleStatus),
      onKicked: guard(handleKicked),
    };
    ui.view = null;
    ui.status = null;
    ui.error = null;
    ui.pawnPos = {};
    ui.pawnKey = null;
    ui.screen = kind === 'offline' ? 'game' : 'connecting';
    session(ACTIVE_KEY, kind);
    try {
      ui.ctrl = factory(cb);
    } catch (err) {
      ui.ctrl = null;
      ui.token = null;
      session(ACTIVE_KEY, null);
      ui.screen = 'online';
      ui.error = 'Online-Modus nicht verfügbar: ' + err.message;
    }
    render();
  }

  function stopController(keepSave) {
    if (ui.ctrl) ui.ctrl.leave(keepSave);
    ui.ctrl = null;
    ui.token = null;
    ui.view = null;
    ui.timer = null;
    ui.modal = null;
    if (ui.sketch) {
      ui.sketch.destroy();
      ui.sketch = null;
    }
    session(ACTIVE_KEY, null);
  }

  function goHome(keepSave) {
    stopController(keepSave);
    ui.screen = 'home';
    history.replaceState(null, '', location.pathname);
    render();
  }

  function startOffline(state) {
    startController('offline', (cb) => new OfflineController(state, cb));
  }

  function startHost(opts) {
    startController('host', (cb) => new HostController(opts, cb));
  }

  function startClient(opts) {
    startController('client', (cb) => new ClientController(opts, cb));
  }

  function savedGames() {
    const now = Date.now();
    const offline = Store.get(KEYS.offline);
    const host = Store.get(KEYS.host);
    const client = Store.get(KEYS.client);
    return {
      offline: offline && offline.phase && offline.phase !== 'over' ? offline : null,
      host: host && host.state && now - (host.savedAt || 0) < RESUME_MAX_AGE ? host : null,
      client: client && client.code && now - (client.savedAt || 0) < RESUME_MAX_AGE ? client : null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Ereignisse aus dem Controller                                       */
  /* ------------------------------------------------------------------ */

  function handleView(v) {
    const prev = ui.view;
    ui.view = v;
    // Ein Handy, das mit einem Offline-Spiel verbunden ist, zeigt die Kartenhand
    if (v.mode === 'offline' && v.isRemote) ui.screen = 'remote';
    else ui.screen = v.phase === 'lobby' ? 'lobby' : 'game';
    transitions(prev, v);
    remoteTransitions(prev, v);
    syncTimer(v);
    render();
  }

  /** Laptop: Meldung, wenn sich das Kartenhand-Handy verbindet oder trennt */
  function remoteTransitions(prev, v) {
    if (v.mode !== 'offline' || v.isRemote) return;
    const before = prev && prev.remote ? prev.remote.connected : 0;
    const now = v.remote ? v.remote.connected : 0;
    if (!before && now) {
      if (ui.modal === 'remote') ui.modal = null;
      toast('📱 Handy verbunden – die Karten erscheinen jetzt dort!');
    } else if (before && !now && v.remote) {
      toast('📱 Handy getrennt – Karten werden wieder hier angezeigt.');
    }
  }

  function handleStroke(msg) {
    const no = ui.view && ui.view.turn ? ui.view.turn.no : null;
    if (ui.strokeTurn !== no) resetStrokes(no);
    ui.strokeLog.push(msg);
    if (ui.sketch) ui.sketch.apply(msg);
    else render(); // Laptop: Zeichnung vom Handy erscheint
  }

  function handleStrokes(all) {
    ui.strokeLog = all.slice();
    ui.strokeTurn = ui.view && ui.view.turn ? ui.view.turn.no : null;
    if (ui.sketch) ui.sketch.loadAll(ui.strokeLog);
  }

  function handleStatus(status, info) {
    ui.status = status;
    ui.statusInfo = info || {};
    if (status === 'error') {
      const e = ui.statusInfo.error;
      const msg =
        e === 'not-found'
          ? 'Kein Spiel mit diesem Code gefunden. Stimmt der Code und ist der Host noch online?'
          : e === 'wrong-game'
            ? 'Unter diesem Code läuft ein anderes Spiel.'
            : e === 'server'
              ? 'Der Verbindungsserver ist gerade nicht erreichbar. Bitte später erneut versuchen.'
              : e === 'browser'
                ? 'Dieser Browser unterstützt den Online-Modus leider nicht.'
                : 'Verbindung fehlgeschlagen. Bitte prüfe deine Internetverbindung.';
      if (ui.ctrl && ui.ctrl.mode === 'client') {
        const remote = ui.ctrl.role === 'remote';
        stopController(true);
        ui.screen = remote ? 'home' : 'online';
        ui.error = msg;
        if (remote) toast(msg);
      } else {
        ui.error = msg;
      }
    }
    render();
  }

  function handleKicked(reason) {
    const remote = ui.ctrl && ui.ctrl.role === 'remote';
    stopController(false);
    ui.screen = 'home';
    history.replaceState(null, '', location.pathname);
    if (reason === 'kicked') toast('Du wurdest vom Host aus dem Spiel entfernt.');
    else toast(remote ? 'Das Spiel auf dem Spielbrett-Gerät wurde beendet.' : 'Der Host hat den Raum geschlossen.');
  }

  function resetStrokes(no) {
    ui.strokeLog = [];
    ui.strokeTurn = no;
    if (ui.sketch) ui.sketch.reset();
  }

  function transitions(prev, v) {
    const t = v.turn;
    const pt = prev && prev.turn;
    const newTurn = !!t && (!pt || pt.no !== t.no);
    if (newTurn) {
      ui.revealed = null;
      ui.phoneHidden = null;
      ui.drawOpen = false;
      ui.peek = false;
      ui.fly = null;
      resetStrokes(t.no);
    }
    if (!prev) return;
    const changed = prev.phase !== v.phase || newTurn;
    if (!changed) return;
    if (v.phase === 'card' && t) {
      Sound.flip();
      ui.fly = { no: t.no, diff: t.diff, started: false };
    } else if (v.phase === 'running' && prev.phase === 'card') {
      Sound.start();
    } else if (v.phase === 'timeout') {
      Sound.buzzer();
    } else if (v.phase === 'result' && v.result && prev.phase !== 'result') {
      if (v.result.success) {
        Sound.success();
        confetti([TEAM_COLOR[v.result.team], '#ffffff', '#facc15'], 120);
      } else Sound.fail();
    } else if (v.phase === 'over' && prev.phase !== 'over') {
      Sound.fanfare();
      const w = v.winner ? TEAM_COLOR[v.winner] : null;
      setTimeout(() => confetti(w ? [w, '#ffffff', '#facc15', w] : null, 260), 150);
      setTimeout(() => confetti(w ? [w, '#ffffff', '#facc15'] : null, 160), 900);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Timer                                                               */
  /* ------------------------------------------------------------------ */

  function syncTimer(v) {
    const t = v.turn;
    if (!t || !['card', 'running', 'timeout'].includes(v.phase)) {
      ui.timer = null;
      return;
    }
    const running = v.phase === 'running' && !t.timer.paused;
    const lastSec = ui.timer && ui.timer.no === t.no ? ui.timer.lastSec : null;
    ui.timer = {
      no: t.no,
      total: t.timer.total,
      running,
      paused: !!t.timer.paused,
      remaining: t.timer.remaining,
      end: running ? performance.now() + t.timer.remaining : null,
      lastSec,
    };
  }

  function timerRemaining() {
    const tm = ui.timer;
    if (!tm) return 0;
    return tm.running ? Math.max(0, tm.end - performance.now()) : tm.remaining || 0;
  }

  const RING = 2 * Math.PI * 52;

  function timerLoop() {
    requestAnimationFrame(timerLoop);
    const tm = ui.timer;
    if (!tm) return;
    const rem = timerRemaining();
    const sec = Math.ceil(rem / 1000);
    const frac = tm.total ? rem / tm.total : 0;
    for (const el of app.querySelectorAll('[data-timer-text]')) {
      if (el.textContent !== String(sec)) el.textContent = String(sec);
    }
    for (const el of app.querySelectorAll('[data-timer-ring]')) {
      el.style.strokeDashoffset = String(RING * (1 - frac));
    }
    for (const el of app.querySelectorAll('[data-timer]')) {
      el.classList.toggle('urgent', tm.running && sec <= 10);
    }
    if (tm.running && sec !== tm.lastSec) {
      if (tm.lastSec !== null && sec <= 10 && sec > 0) Sound.tick(sec <= 3);
      tm.lastSec = sec;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Spielbrett-Layout                                                   */
  /* ------------------------------------------------------------------ */

  /** Wählt Spalten/Zeilen für einen rechteckigen Rundkurs mit n Feldern */
  function boardLayout(n, W, H) {
    const w = W || Math.min(window.innerWidth, 900);
    const h = H || Math.max(320, window.innerHeight - 70);
    const half = n / 2 + 2;
    const gap = w < 520 ? 3 : w < 1100 ? 5 : 6;
    // Auf großen Bildschirmen (Laptop, Fernseher) dürfen die Felder deutlich größer werden
    const maxCell = Math.max(86, Math.min(130, Math.round(Math.min(w, h * 1.6) / 11)));
    // Die Brett-Mitte braucht genug Höhe für Banner, Kategorie und Kartenstapel
    const minCenterH = Math.min(340, Math.max(250, h * 0.42));
    let best = null;
    for (let rows = 4; rows <= half - 4; rows++) {
      const cols = half - rows;
      const raw = Math.floor(Math.min((w - (cols - 1) * gap) / cols, (h - (rows - 1) * gap) / rows));
      if (raw < 12) continue;
      const cell = Math.min(raw, maxCell);
      const centerW = (cols - 2) * (cell + gap);
      const centerH = (rows - 2) * (cell + gap);
      const fits = centerW >= 230 && centerH >= minCenterH;
      // Bei gleicher Feldgröße gewinnt die Form mit der geräumigeren Mitte
      const score = cell + (fits ? 1000 : 0) + Math.min(centerW / 1.6, centerH) / 1000;
      if (!best || score > best.score) best = { cols, rows, cell, gap, score };
    }
    return best;
  }

  function cellOf(i, cols, rows) {
    const top = cols - 1;
    const right = rows - 1;
    if (i <= top) return { c: i, r: 0 };
    if (i <= top + right) return { c: cols - 1, r: i - top };
    if (i <= 2 * top + right) return { c: cols - 1 - (i - top - right), r: rows - 1 };
    return { c: 0, r: rows - 1 - (i - 2 * top - right) };
  }

  /** Richtung zum nächsten Feld – für die kleinen Pfeile auf den Feldern */
  function arrowOf(i, n, cols, rows) {
    if (i >= n - 1) return '';
    const a = cellOf(i, cols, rows);
    const b = cellOf(i + 1, cols, rows);
    if (b.c > a.c) return 'r';
    if (b.c < a.c) return 'l';
    if (b.r > a.r) return 'd';
    return 'u';
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
    let html = '';
    switch (ui.screen) {
      case 'home':
        html = homeHtml();
        break;
      case 'setup':
        html = setupHtml();
        break;
      case 'online':
        html = onlineHtml();
        break;
      case 'connecting':
        html = connectingHtml();
        break;
      case 'lobby':
        html = ui.view ? lobbyHtml(ui.view) : connectingHtml();
        break;
      case 'game':
        html = ui.view ? gameHtml(ui.view) : connectingHtml();
        break;
      case 'remote':
        html = ui.view ? remoteHtml(ui.view) : connectingHtml();
        break;
      default:
        html = homeHtml();
    }
    html += modalHtml();
    if (ui.toast) html += `<div class="toast" role="status">${esc(ui.toast)}</div>`;
    window.morphdom(app, `<div id="app">${html}</div>`, {
      onBeforeElUpdated(fromEl, toEl) {
        if (fromEl.hasAttribute('data-keep') && toEl.hasAttribute('data-keep')) {
          // Attribute übernehmen, Kinder (Canvas, Spielfiguren) behalten
          for (const { name, value } of [...toEl.attributes]) {
            if (fromEl.getAttribute(name) !== value) fromEl.setAttribute(name, value);
          }
          return false;
        }
        if (fromEl === document.activeElement && (fromEl.tagName === 'INPUT' || fromEl.tagName === 'TEXTAREA')) {
          return false;
        }
        return true;
      },
    });
    afterRender();
  }

  function afterRender() {
    observeBoard();
    fitCenter();
    syncPawns();
    mountSketch();
    runFly();
    if (ui.focus) {
      const el = app.querySelector(ui.focus);
      ui.focus = null;
      if (el) el.focus();
    }
  }

  /* ---------- Startseite ---------- */

  function logoHtml(small) {
    let i = 0;
    const words = ['GUESS', 'THE', 'WORD!'].map(
      (w) => `<span class="logo-word">${w
        .split('')
        .map((l) => `<span style="--i:${i++}">${l}</span>`)
        .join('')}</span>`
    );
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="Guess the word!">${words.join('')}</div>`;
  }

  function homeHtml() {
    const saves = savedGames();
    const stats = Deck.stats();
    const resume = [];
    if (saves.offline) {
      const teams = saves.offline.teams.filter((t) => saves.offline.order.includes(t.id));
      resume.push(`
        <div class="resume">
          <button class="btn btn-ghost btn-wide" data-act="resume-offline">▶ Offline-Spiel fortsetzen
            <small>${teams.map((t) => esc(t.name)).join(' · ')}</small></button>
          <button class="icon-btn" data-act="discard-offline" title="Spielstand löschen" aria-label="Spielstand löschen">✕</button>
        </div>`);
    }
    if (saves.host) {
      resume.push(`
        <div class="resume">
          <button class="btn btn-ghost btn-wide" data-act="resume-host">▶ Online-Spiel fortsetzen
            <small>Raum ${esc(saves.host.code)} · du bist Host</small></button>
          <button class="icon-btn" data-act="discard-host" title="Verwerfen" aria-label="Verwerfen">✕</button>
        </div>`);
    }
    if (saves.client) {
      resume.push(`
        <div class="resume">
          <button class="btn btn-ghost btn-wide" data-act="resume-client">${
            saves.client.role === 'remote'
              ? `▶ Wieder als Kartenhand verbinden<small>Spiel ${esc(saves.client.code)}</small>`
              : `▶ Zurück in Raum ${esc(saves.client.code)}<small>als ${esc(saves.client.name)}</small>`
          }</button>
          <button class="icon-btn" data-act="discard-client" title="Verwerfen" aria-label="Verwerfen">✕</button>
        </div>`);
    }
    return `
    <div class="screen home">
      <a class="btn btn-ghost btn-small hub-back" href="../">← Alle Spiele</a>
      <div class="home-hero">
        ${logoHtml()}
        <p class="tagline">
          <span class="cat-pill cat-erklaeren">💬 Erklären</span>
          <span class="cat-pill cat-zeichnen">✏️ Zeichnen</span>
          <span class="cat-pill cat-pantomime">🎭 Pantomime</span>
        </p>
        <div class="home-cards" aria-hidden="true">
          <div class="deco-card diff-leicht"><span>3</span></div>
          <div class="deco-card diff-mittel"><span>4</span></div>
          <div class="deco-card diff-schwer"><span>5</span></div>
        </div>
      </div>
      <div class="home-actions">
        <button class="mode-btn" data-act="offline-setup">
          <span class="mode-icon">🎲</span>
          <span class="mode-text"><b>Offline spielen</b><small>Ein Gerät für alle – wird einfach herumgereicht</small></span>
        </button>
        <button class="mode-btn" data-act="online-menu">
          <span class="mode-icon">🌐</span>
          <span class="mode-text"><b>Online spielen</b><small>Jeder mit eigenem Handy – Raum erstellen oder beitreten</small></span>
        </button>
        ${resume.join('')}
        <button class="btn btn-link" data-act="rules">📖 Spielregeln</button>
      </div>
      <p class="home-foot">${stats.total} Begriffe · ${stats.adult} Begriffe ab 18</p>
    </div>`;
  }

  /* ---------- Einstellungen (Setup & Lobby) ---------- */

  function settingsHtml(settings, editable, scope) {
    const dis = editable ? '' : 'disabled';
    const seg = (name, options, value, fmt) =>
      `<div class="seg" role="group">${options
        .map(
          (o) =>
            `<button class="seg-btn ${o === value ? 'on' : ''}" data-act="set-${name}" data-scope="${scope}" data-value="${o}" ${dis} aria-pressed="${o === value}">${fmt(o)}</button>`
        )
        .join('')}</div>`;
    return `
      <div class="settings">
        ${
          scope === 'setup'
            ? `<div class="setting">
          <div class="setting-label"><b>📱 Handy als Kartenhand</b><small>Laptop/Tablet zeigt das Spielbrett, die Kartenstapel erscheinen auf einem Handy (QR-Code scannen)</small></div>
          <button class="switch ${settings.phone ? 'on on-blue' : ''}" role="switch" aria-checked="${!!settings.phone}" data-act="toggle-phone">
            <span class="switch-knob"></span><span class="switch-text">${settings.phone ? 'An' : 'Aus'}</span>
          </button>
        </div>`
            : ''
        }
        <div class="setting">
          <div class="setting-label"><b>⏱ Zeit pro Begriff</b></div>
          ${seg('timer', TIMER_OPTIONS, settings.timer, (o) => o + ' s')}
        </div>
        <div class="setting">
          <div class="setting-label"><b>🗺 Spielbrett</b></div>
          ${seg('length', LENGTH_OPTIONS, settings.length, (o) => ({ 32: 'Kurz', 40: 'Normal', 48: 'Lang' })[o] + ` <small>${o}</small>`)}
        </div>
        <div class="setting">
          <div class="setting-label"><b>🔞 Begriffe ab 18</b><small>200 Extra-Begriffe, gemischt in alle Stapel</small></div>
          <button class="switch ${settings.adult ? 'on' : ''}" role="switch" aria-checked="${settings.adult}" data-act="toggle-adult" data-scope="${scope}" ${dis}>
            <span class="switch-knob"></span><span class="switch-text">${settings.adult ? 'An' : 'Aus'}</span>
          </button>
        </div>
      </div>`;
  }

  /* ---------- Offline-Setup ---------- */

  function setupHtml() {
    const s = ui.setup;
    const activeCount = s.teams.filter((t) => t.active).length;
    const teams = s.teams
      .map((t, ti) => {
        const def = TEAMS[ti];
        if (!t.active) {
          return `
          <button class="team-setup team-${t.id} off" data-act="team-toggle" data-team="${ti}">
            <span class="ts-add">＋</span>
            <span>Team ${def.label} hinzufügen</span>
          </button>`;
        }
        const players = t.players
          .map(
            (p, pi) => `
            <div class="player-row">
              <span class="player-num">${pi + 1}</span>
              <input class="input" type="text" maxlength="24" placeholder="Spieler ${pi + 1}" value="${esc(p)}"
                data-field="player-name" data-team="${ti}" data-player="${pi}" autocomplete="off" enterkeyhint="next" />
              ${t.players.length > 2 ? `<button class="icon-btn" data-act="remove-player" data-team="${ti}" data-player="${pi}" aria-label="Spieler entfernen">✕</button>` : ''}
            </div>`
          )
          .join('');
        return `
        <div class="team-setup team-${t.id}">
          <div class="ts-head">
            <span class="team-dot"></span>
            <input class="input input-team" type="text" maxlength="24" placeholder="Team ${def.label}" value="${esc(t.name)}"
              data-field="team-name" data-team="${ti}" autocomplete="off" aria-label="Teamname" />
            ${activeCount > 2 ? `<button class="icon-btn" data-act="team-toggle" data-team="${ti}" aria-label="Team entfernen" title="Team entfernen">✕</button>` : ''}
          </div>
          <div class="ts-players">${players}</div>
          ${t.players.length < MAX_PLAYERS ? `<button class="btn btn-small btn-ghost" data-act="add-player" data-team="${ti}">＋ Spieler</button>` : ''}
        </div>`;
      })
      .join('');
    return `
    <div class="screen setup">
      <header class="screen-head">
        <button class="btn btn-ghost btn-small" data-act="home">← Zurück</button>
        <h1>Neues Spiel</h1>
        <span></span>
      </header>
      <p class="hint">Bis zu 4 Teams. Leere Namensfelder werden automatisch ausgefüllt. Der/die Erklärende wechselt in jedem Team von Zug zu Zug.</p>
      <div class="team-grid">${teams}</div>
      <section class="panel">
        <h2>Einstellungen</h2>
        ${settingsHtml(s.settings, true, 'setup')}
      </section>
      <div class="sticky-start">
        <button class="btn btn-primary btn-big" data-act="start-offline">Spiel starten 🎲</button>
      </div>
    </div>`;
  }

  /* ---------- Online-Menü ---------- */

  function onlineHtml() {
    const transportHint =
      Net.transport() === 'ws'
        ? 'Verbindung über diesen Server.'
        : 'Direktverbindung zwischen den Geräten (WebRTC) – kein eigener Server nötig.';
    return `
    <div class="screen online">
      <header class="screen-head">
        <button class="btn btn-ghost btn-small" data-act="home">← Zurück</button>
        <h1>Online spielen</h1>
        <span></span>
      </header>
      ${ui.error ? `<div class="alert">${esc(ui.error)}</div>` : ''}
      <section class="panel">
        <label class="label" for="name-input">Dein Name</label>
        <input id="name-input" class="input input-big" type="text" maxlength="24" placeholder="z.B. Alex" value="${esc(ui.name)}" data-field="online-name" autocomplete="nickname" />
      </section>
      <div class="online-grid">
        <section class="panel">
          <h2>Neues Spiel</h2>
          <p class="muted">Du erstellst einen Raum und lädst die anderen per Code, Link oder QR-Code ein.</p>
          <button class="btn btn-primary btn-wide" data-act="create-room">Raum erstellen</button>
        </section>
        <form class="panel" data-form="join">
          <h2>Beitreten</h2>
          <label class="label" for="code-input">Raum-Code</label>
          <input id="code-input" class="input input-code" type="text" maxlength="8" placeholder="ABCDE" value="${esc(ui.joinCode)}" data-field="join-code" autocomplete="off" autocapitalize="characters" spellcheck="false" />
          <button class="btn btn-primary btn-wide" type="submit">Beitreten</button>
        </form>
      </div>
      <p class="hint center">${transportHint}</p>
    </div>`;
  }

  function connectingHtml() {
    const reconnect = ui.status === 'reconnecting';
    return `
    <div class="screen connecting">
      <div class="spinner" aria-hidden="true"></div>
      <p>${reconnect ? 'Verbindung unterbrochen – verbinde neu…' : 'Verbinde…'}</p>
      ${ui.error ? `<div class="alert">${esc(ui.error)}</div>` : ''}
      <button class="btn btn-ghost" data-act="leave-now">Abbrechen</button>
    </div>`;
  }

  /* ---------- Lobby ---------- */

  function lobbyHtml(v) {
    const me = v.me;
    const host = me.isHost;
    const code = v.room || '…';
    const members = v.members;
    const memberOf = (id) => members.find((m) => m.id === id);
    const playerChip = (p) => {
      const m = memberOf(p.id) || p;
      const isMe = p.id === me.id;
      const kick = host && !isMe && !m.host ? `<button class="chip-x" data-act="kick" data-player="${esc(p.id)}" aria-label="Entfernen">✕</button>` : '';
      return `<span class="chip ${m.online ? '' : 'is-offline'} ${isMe ? 'is-me' : ''}">${m.host ? '👑 ' : ''}${esc(m.name)}${isMe ? ' (du)' : ''}${kick}</span>`;
    };
    const teams = v.teams
      .map((t) => {
        if (!t.active) {
          return host
            ? `<button class="team-setup team-${t.id} off" data-act="lobby-team" data-team="${t.id}" data-on="1"><span class="ts-add">＋</span><span>Team ${t.label} hinzufügen</span></button>`
            : '';
        }
        const nameField = host
          ? `<input class="input input-team" type="text" maxlength="24" value="${esc(t.name)}" data-field="lobby-team-name" data-team="${t.id}" aria-label="Teamname" />`
          : `<b class="ts-name">${esc(t.name)}</b>`;
        const activeCount = v.teams.filter((x) => x.active).length;
        return `
        <div class="team-setup team-${t.id} ${me.team === t.id ? 'is-mine' : ''}">
          <div class="ts-head">
            <span class="team-dot"></span>
            ${nameField}
            ${host && activeCount > 2 ? `<button class="icon-btn" data-act="lobby-team" data-team="${t.id}" data-on="0" aria-label="Team entfernen">✕</button>` : ''}
          </div>
          <div class="chips">${t.players.length ? t.players.map(playerChip).join('') : '<span class="muted">Noch niemand</span>'}</div>
          ${me.team === t.id ? `<button class="btn btn-small btn-ghost" data-act="join-team" data-team="">Team verlassen</button>` : `<button class="btn btn-small btn-team" data-act="join-team" data-team="${t.id}">Beitreten</button>`}
        </div>`;
      })
      .join('');
    const spectators = members.filter((m) => !m.team);
    return `
    <div class="screen lobby">
      <header class="screen-head">
        <button class="btn btn-ghost btn-small" data-act="leave">← Verlassen</button>
        <h1>Lobby</h1>
        <button class="icon-btn" data-act="rules" aria-label="Spielregeln">?</button>
      </header>
      ${statusBanner()}
      <section class="room-box">
        <div class="room-label">Raum-Code</div>
        <div class="room-code" data-testid="room-code">${esc(code)}</div>
        <div class="room-actions">
          <button class="btn btn-small btn-ghost" data-act="copy-link">🔗 Link kopieren</button>
          <button class="btn btn-small btn-ghost" data-act="show-qr">▦ QR-Code</button>
        </div>
      </section>
      <p class="hint center">Wählt euer Team! Jede Person spielt auf dem eigenen Gerät – die Karte sieht nur, wer gerade dran ist.</p>
      <div class="team-grid">${teams}</div>
      ${
        spectators.length
          ? `<section class="panel"><h2>Noch ohne Team</h2><div class="chips">${spectators.map((m) => playerChip(m)).join('')}</div><p class="muted small">Wer beim Start in keinem Team ist, schaut zu.</p></section>`
          : ''
      }
      <section class="panel">
        <h2>Einstellungen ${host ? '' : '<small class="muted">(legt der Host fest)</small>'}</h2>
        ${settingsHtml(v.settings, host, 'lobby')}
      </section>
      <div class="sticky-start">
        ${
          host
            ? `<button class="btn btn-primary btn-big" data-act="start-game" ${v.lobbyProblem ? 'disabled' : ''}>Spiel starten 🎲</button>
               ${v.lobbyProblem ? `<p class="muted small center">${esc(v.lobbyProblem)}</p>` : ''}`
            : `<p class="waiting">⏳ Warte, bis der Host das Spiel startet…</p>`
        }
      </div>
    </div>`;
  }

  function statusBanner() {
    if (!ui.ctrl || ui.ctrl.mode === 'offline') return '';
    if (ui.status === 'reconnecting' || ui.status === 'connecting') {
      return `<div class="status-banner"><span class="spinner-sm"></span> ${ui.ctrl.mode === 'host' ? 'Verbindungsserver wird erreicht…' : 'Verbindung zum Host unterbrochen – verbinde neu…'} <button class="btn btn-small btn-ghost" data-act="leave-now">Verlassen</button></div>`;
    }
    if (ui.status === 'error' && ui.error) return `<div class="status-banner error">${esc(ui.error)}</div>`;
    return '';
  }

  /* ---------- Spiel ---------- */

  function gameHtml(v) {
    const t = v.turn;
    const roundNo = t ? Math.floor((t.no - 1) / Math.max(1, v.order.length)) + 1 : v.result ? Math.floor((v.result.no - 1) / Math.max(1, v.order.length)) + 1 : null;
    const stage = t && ['card', 'running', 'timeout'].includes(v.phase) ? stageHtml(v) : '';
    return `
    <div class="game ${stage ? 'has-stage' : ''}">
      <header class="topbar">
        <button class="topbar-brand" data-act="menu" aria-label="Menü">${logoHtml(true)}</button>
        <div class="topbar-info">
          ${roundNo ? `<span class="pill">Runde ${roundNo}</span>` : ''}
          ${v.mode === 'online' ? `<span class="pill pill-room" title="Raum-Code">Raum ${esc(v.room || '')}</span>` : ''}
          ${v.settings.adult ? '<span class="pill pill-adult">18+</span>' : ''}
        </div>
        <div class="topbar-actions">
          ${v.mode === 'offline' ? remoteButtonHtml(v) : ''}
          <button class="icon-btn" data-act="mute" aria-label="Ton an/aus" title="Ton an/aus">${Sound.muted ? '🔇' : '🔊'}</button>
          <button class="icon-btn" data-act="menu" aria-label="Menü" title="Menü">☰</button>
        </div>
      </header>
      ${statusBanner()}
      <main class="game-main">
        <section class="board-area" aria-label="Spielbrett">${boardHtml(v)}</section>
        <aside class="sidebar">
          ${spectatorHtml(v)}
          ${teamsHtml(v)}
          ${logHtml(v)}
        </aside>
      </main>
      ${stage}
      ${v.phase === 'over' ? winnerHtml(v) : ''}
    </div>`;
  }

  function boardHtml(v) {
    const n = v.board.length;
    if (!n) return '';
    const L = boardLayout(n, ui.box.w, ui.box.h);
    ui.layout = L;
    const activeField = v.turn ? v.turn.field : null;
    const activeTeam = v.turn ? v.turn.team : null;
    const tiles = v.board
      .map((cat, i) => {
        const { c, r } = cellOf(i, L.cols, L.rows);
        const arrow = arrowOf(i, n, L.cols, L.rows);
        let inner;
        if (cat === 'start') inner = '<span class="tile-big">START</span>';
        else if (cat === 'ziel') inner = '<span class="tile-big">ZIEL</span><span class="tile-flag">🏁</span>';
        else inner = `<span class="tile-icon">${CAT[cat].icon}</span><span class="tile-no">${i}</span>`;
        const active = i === activeField && ['choose', 'card', 'running', 'timeout'].includes(v.phase);
        return `<div class="tile tile-${cat} ${active ? 'tile-active' : ''} arrow-${arrow}" style="grid-column:${c + 1};grid-row:${r + 1};${active ? `--team:${TEAM_COLOR[activeTeam]}` : ''}" title="${cat === 'start' ? 'Start – Kategorie frei wählbar' : cat === 'ziel' ? 'Ziel' : 'Feld ' + i + ': ' + CAT[cat].label}">${inner}</div>`;
      })
      .join('');
    return `
      <div class="board" id="board" style="--cols:${L.cols};--rows:${L.rows};--cell:${L.cell}px;--gap:${L.gap}px">
        ${tiles}
        <div class="board-center" style="grid-column:2 / ${L.cols};grid-row:2 / ${L.rows}">${centerHtml(v)}</div>
        <div class="pawns" id="pawns" data-keep></div>
      </div>`;
  }

  function verbFor(cat) {
    return cat ? CAT[cat].verb : 'ist an der Reihe';
  }

  function centerHtml(v) {
    if (v.phase === 'result' && v.result) return resultHtml(v);
    if (v.phase === 'over') {
      return `<div class="center-msg"><div class="big-emoji">🏆</div><p>Spiel beendet</p></div>`;
    }
    const t = v.turn;
    if (!t) return '';
    const team = teamOf(v, t.team);
    const me = v.me;
    const offline = v.mode === 'offline';
    const isMine = offline || me.team === t.team;
    const explainerLabel = offline ? esc(t.explainerName) : t.explainer === me.id ? 'Du' : esc(t.explainerName);
    const verb =
      t.explainer === me.id && !offline
        ? t.cat
          ? { erklaeren: 'erklärst', zeichnen: 'zeichnest', pantomime: 'stellst dar' }[t.cat]
          : 'bist an der Reihe'
        : verbFor(t.cat);
    const choosing = v.phase === 'choose';
    // Mit verbundenem Handy wird nur dort gezogen
    const canPick = choosing && me.canTurn && !!t.cat && !remoteOn(v);

    let catHtml;
    if (t.catFree && !t.cat) {
      catHtml = `
        <div class="cat-choose">
          <p class="center-hint">⭐ Startfeld: ${me.canTurn ? 'Wählt eine Kategorie!' : `${teamLabel(team)} wählt eine Kategorie…`}</p>
          <div class="cat-buttons">
            ${CATS.map((c) => `<button class="cat-btn cat-${c}" data-act="category" data-cat="${c}" ${me.canTurn ? '' : 'disabled'}><span>${CAT[c].icon}</span>${CAT[c].label}</button>`).join('')}
          </div>
        </div>`;
    } else {
      catHtml = `<div class="cat-badge cat-${t.cat}"><span class="cat-badge-icon">${CAT[t.cat].icon}</span><span>${CAT[t.cat].label}</span></div>`;
    }

    const stacks = stacksHtml(t, canPick, choosing);

    let hint = '';
    if (choosing && remoteOn(v)) hint = `📱 Gebt das Handy an ${explainerLabel} – dort wird der Stapel gewählt.`;
    else if (choosing && t.cat) hint = canPick ? 'Wählt einen Kartenstapel!' : `${teamLabel(team)} wählt einen Stapel…`;
    else if (!choosing) hint = `${explainerLabel} ${verb}…`;

    return `
      <div class="center ${isMine ? 'is-mine' : ''}">
        <div class="turn-banner" style="--team:${TEAM_COLOR[t.team]}">
          <div class="tb-team"><span class="team-dot"></span>${teamLabel(team)} ist dran</div>
          <div class="tb-player">🎤 <b>${explainerLabel}</b> ${verb}</div>
        </div>
        ${catHtml}
        <div class="stacks ${canPick ? 'can-pick' : ''}">${stacks}</div>
        ${hint ? `<p class="center-hint">${hint}</p>` : ''}
      </div>`;
  }

  function stacksHtml(t, canPick, choosing) {
    return DIFFS.map((d) => {
      const info = t.deck ? t.deck[d] : null;
      const layers = info ? Math.max(2, Math.min(6, Math.round((info.left / info.total) * 6))) : 5;
      const picked = t.diff === d && !choosing;
      return `
        <button class="stack diff-${d} ${picked ? 'picked' : ''}" data-act="draw" data-diff="${d}" ${canPick ? '' : 'disabled'} aria-label="${DIFF[d]} – ${POINTS[d]} Punkte">
          <span class="stack-cards" style="--layers:${layers}">
            ${Array.from({ length: layers }, (_, i) => `<span class="sc" style="--k:${layers - i}"></span>`).join('')}
            <span class="sc sc-top"><span class="sc-logo">?</span><span class="sc-pts">${POINTS[d]}</span></span>
          </span>
          <span class="stack-label">${DIFF[d]}</span>
          <span class="stack-points">${POINTS[d]} Punkte</span>
          ${info ? `<span class="stack-count">${info.left} Karten</span>` : ''}
        </button>`;
    }).join('');
  }

  function remoteOn(v) {
    return v.mode === 'offline' && !v.isRemote && !!v.remote && v.remote.connected > 0;
  }

  function nextTeamOf(v, teamId) {
    const idx = v.order.indexOf(teamId);
    return teamOf(v, v.order[(idx + 1) % v.order.length]);
  }

  function resultHtml(v) {
    const r = v.result;
    const team = teamOf(v, r.team);
    const next = nextTeamOf(v, r.team);
    const canNext = v.mode === 'offline' || !!v.me.id;
    const sub = r.success
      ? `${teamLabel(team)} zieht <b>${r.to - r.from}</b> ${plural(r.to - r.from, 'Feld', 'Felder')} vor`
      : `${teamLabel(team)} bleibt stehen`;
    return `
      <div class="center">
        <div class="result-card ${r.success ? 'ok' : 'bad'}" style="--team:${TEAM_COLOR[r.team]}">
          <div class="rc-icon">${r.success ? '✓' : '✗'}</div>
          <div class="rc-title">${r.success ? `Erraten! +${r.points}` : 'Nicht erraten'}</div>
          <div class="rc-sub">${sub}</div>
          <div class="rc-term">
            <small>${r.cat ? CAT[r.cat].icon + ' ' + CAT[r.cat].label : ''} · ${DIFF[r.diff] || ''}</small>
            <b>${esc(r.term)}</b>
            ${r.guessedBy ? `<small>💡 ${esc(r.guessedBy)} hat es erraten</small>` : ''}
          </div>
          ${
            r.winner
              ? `<button class="btn btn-primary" data-act="next">🏆 Zur Siegerehrung</button>`
              : canNext
                ? `<button class="btn btn-primary" data-act="next">Weiter – ${teamLabel(next)} ist dran →</button>`
                : ''
          }
        </div>
      </div>`;
  }

  function spectatorHtml(v) {
    if (v.mode !== 'online' || v.me.team || v.phase === 'over') return '';
    const teams = v.order.map((id) => teamOf(v, id));
    return `
      <section class="panel spectator">
        <h3>👀 Du schaust zu</h3>
        <p class="muted small">Du kannst noch einem Team beitreten:</p>
        <div class="chips">${teams.map((t) => `<button class="btn btn-small btn-team team-${t.id}" data-act="join-team" data-team="${t.id}">${esc(t.name)}</button>`).join('')}</div>
      </section>`;
  }

  function teamsHtml(v) {
    const last = v.board.length - 1;
    const t = v.turn;
    const cards = v.order
      .map((id) => {
        const team = teamOf(v, id);
        const isTurn = t && t.team === id && v.phase !== 'over';
        const pct = Math.round((team.pos / last) * 100);
        const players = team.players
          .map((p) => {
            const isExp = isTurn && t.explainer === p.id;
            const isMe = v.mode === 'online' && p.id === v.me.id;
            const kick =
              v.mode === 'online' && v.me.isHost && !p.online && !isExp
                ? `<button class="chip-x" data-act="kick" data-player="${esc(p.id)}" aria-label="Entfernen">✕</button>`
                : '';
            return `<span class="chip ${isExp ? 'is-explainer' : ''} ${p.online ? '' : 'is-offline'} ${isMe ? 'is-me' : ''}">${isExp ? '🎤 ' : ''}${esc(p.name)}${isMe ? ' (du)' : ''}${kick}</span>`;
          })
          .join('');
        return `
        <div class="team-card team-${id} ${isTurn ? 'is-turn' : ''}">
          <div class="tc-head">
            <span class="pawn-mini"></span>
            <b>${esc(team.name)}</b>
            <span class="tc-score">${team.score} P.</span>
          </div>
          <div class="tc-progress" title="Feld ${team.pos} von ${last}"><span style="width:${pct}%"></span></div>
          <div class="tc-meta"><span>Feld ${team.pos}/${last}</span><span>✓ ${team.ok} · ✗ ${team.fail}</span></div>
          <div class="chips">${players}</div>
        </div>`;
      })
      .join('');
    return `<section class="panel teams-panel"><h3>Teams</h3>${cards}</section>`;
  }

  function logHtml(v) {
    if (!v.log.length) return '';
    const rows = v.log
      .slice(0, 8)
      .map(
        (l) => `
        <li class="log-row team-${l.team}">
          <span class="log-dot"></span>
          <span class="log-icon">${l.success ? '✓' : '✗'}</span>
          <span class="log-term">${esc(l.term)}</span>
          <span class="log-meta">${CAT[l.cat] ? CAT[l.cat].icon : ''} ${esc(l.explainer)}${l.success ? ` · +${l.points}` : ''}</span>
        </li>`
      )
      .join('');
    return `<section class="panel log-panel"><h3>Verlauf</h3><ul class="log">${rows}</ul></section>`;
  }

  /* ---------- Karte, Timer & Zeichenfläche ---------- */

  function timerHtml(v) {
    const t = v.turn;
    const rem = ui.timer && ui.timer.no === t.no ? timerRemaining() : t.timer.remaining;
    const frac = t.timer.total ? rem / t.timer.total : 0;
    const sec = Math.ceil(rem / 1000);
    return `
      <div class="timer ${t.timer.paused ? 'paused' : ''} ${v.phase === 'timeout' ? 'done' : ''}" data-timer>
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle class="timer-bg" cx="60" cy="60" r="52"></circle>
          <circle class="timer-fg" cx="60" cy="60" r="52" data-timer-ring style="stroke-dasharray:${RING};stroke-dashoffset:${RING * (1 - frac)}"></circle>
        </svg>
        <div class="timer-center">
          <span class="timer-text" data-timer-text>${sec}</span>
          <span class="timer-unit">${t.timer.paused ? 'Pause' : 'Sek.'}</span>
        </div>
      </div>`;
  }

  function cardHtml(v, revealed, hideFront) {
    const t = v.turn;
    const card = hideFront ? null : t.card;
    const front = card
      ? `
        <div class="card-cat cat-${t.cat}">${CAT[t.cat].icon} ${CAT[t.cat].label}</div>
        <div class="card-term" data-testid="card-term">${esc(card.term)}</div>
        ${
          t.cat === 'erklaeren' && card.taboo && card.taboo.length
            ? `<div class="card-taboo"><span>Nicht sagen:</span><ul>${card.taboo.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
            : `<div class="card-rule">${CAT[t.cat].rule}</div>`
        }
        <div class="card-foot"><span class="card-pts">${POINTS[t.diff]} Punkte</span>${card.adult ? '<span class="card-adult">18+</span>' : ''}</div>`
      : '';
    return `
      <div class="card-fly" id="card-fly">
        <div class="card3d diff-${t.diff} ${revealed ? 'is-flipped' : ''}">
          <div class="card-face card-back">
            <span class="cb-logo">GUESS THE<br />WORD!</span>
            <span class="cb-diff">${DIFF[t.diff]}</span>
            <span class="cb-pts">${POINTS[t.diff]}</span>
          </div>
          <div class="card-face card-front">${front}</div>
        </div>
      </div>`;
  }

  function penToolsHtml() {
    const p = ui.pen;
    return `
      <div class="pen-tools" role="toolbar" aria-label="Zeichenwerkzeuge">
        ${PEN_COLORS.map((c) => `<button class="pen-color ${!p.eraser && p.color === c ? 'on' : ''}" style="--c:${c}" data-act="pen-color" data-value="${c}" aria-label="Farbe"></button>`).join('')}
        <span class="pen-sep"></span>
        ${PEN_WIDTHS.map((w, i) => `<button class="pen-width ${!p.eraser && p.width === w ? 'on' : ''}" data-act="pen-width" data-value="${w}" aria-label="Strichstärke ${i + 1}"><span style="--s:${4 + i * 5}px"></span></button>`).join('')}
        <button class="pen-btn ${p.eraser ? 'on' : ''}" data-act="pen-eraser" aria-label="Radierer" title="Radierer">🧽</button>
        <button class="pen-btn" data-act="pen-undo" aria-label="Rückgängig" title="Rückgängig">↶</button>
        <button class="pen-btn" data-act="pen-clear" aria-label="Alles löschen" title="Alles löschen">🗑</button>
      </div>`;
  }

  function stageHtml(v) {
    const t = v.turn;
    const team = teamOf(v, t.team);
    const me = v.me;
    const offline = v.mode === 'offline';
    const phase = v.phase;
    const flying = !!ui.fly && ui.fly.no === t.no;
    // Ist ein Handy als Kartenhand verbunden, zeigt der Laptop die Karte nie offen
    const viaPhone = remoteOn(v);
    const revealed = !viaPhone && !!t.card && !flying && (offline ? ui.revealed === t.no : true);
    const canControl = offline || me.isExplainer || me.isHost;
    const explainerName = esc(t.explainerName);
    const isZeichnen = t.cat === 'zeichnen';
    const showSketch =
      isZeichnen && phase !== 'card' && (!offline || (viaPhone ? ui.strokeLog.length > 0 : ui.drawOpen));
    const sketchEditable = showSketch && !viaPhone && phase === 'running' && !t.timer.paused && (offline || me.isExplainer);

    // Kopfzeile
    const head = `
      <div class="stage-head" style="--team:${TEAM_COLOR[t.team]}">
        <span class="team-dot"></span>
        <span class="sh-team">${teamLabel(team)}</span>
        <span class="sh-sep">·</span>
        <span>🎤 ${offline || t.explainer !== me.id ? explainerName : 'Du'}</span>
        <span class="cat-chip cat-${t.cat}">${CAT[t.cat].icon} ${CAT[t.cat].label}</span>
        <span class="pts-chip diff-${t.diff}">${POINTS[t.diff]} P.</span>
      </div>`;

    // Hinweistext
    let info = '';
    if (phase === 'card') {
      if (viaPhone) info = `📱 <b>${explainerName}</b> schaut sich die Karte auf dem Handy an…`;
      else if (offline) info = revealed ? `Merk dir den Begriff, ${explainerName}! Bereit?` : `🙈 Nur <b>${explainerName}</b> darf jetzt auf den Bildschirm schauen!`;
      else if (me.isExplainer) info = 'Das ist dein Begriff! Starte die Zeit, sobald du bereit bist.';
      else info = `⏳ ${explainerName} schaut sich die Karte an…`;
    } else if (phase === 'running') {
      if (t.timer.paused) info = '⏸ Pausiert';
      else if (offline) info = `${CAT[t.cat].rule}. Los geht's!`;
      else if (me.isExplainer) info = `${CAT[t.cat].rule}!`;
      else if (me.canGuess) info = `Rate mit! ${isZeichnen ? 'Was zeichnet' : 'Was meint'} ${explainerName}?`;
      else info = `${teamLabel(team)} rät…`;
    } else if (phase === 'timeout') {
      info = canControl ? '⏰ Zeit ist um! Wurde der Begriff rechtzeitig erraten?' : `⏰ Zeit ist um! ${explainerName} entscheidet…`;
    }

    // Buttons
    let actions = '';
    if (phase === 'card') {
      if (viaPhone) {
        actions = `<button class="btn btn-ghost" data-act="startTimer">▶ Zeit starten</button>`;
      } else if (offline && !revealed) {
        actions = `<button class="btn btn-primary btn-big" data-act="reveal">👀 Karte aufdecken</button>`;
      } else if (offline || me.isExplainer) {
        actions = `<button class="btn btn-primary btn-big" data-act="startTimer">▶ Zeit starten</button>
          ${offline ? '<button class="btn btn-ghost" data-act="hide">🙈 Verdecken</button>' : ''}`;
      } else if (me.isHost) {
        actions = `<button class="btn btn-ghost btn-small" data-act="startTimer">▶ Zeit für ${explainerName} starten</button>
          <button class="btn btn-ghost btn-small" data-act="skipExplainer">🔄 Andere Person</button>`;
      }
    } else if (phase === 'running') {
      if (canControl) {
        const mainBtns = `
          <button class="btn btn-success btn-big" data-act="success">✓ Erraten!</button>
          <button class="btn btn-danger" data-act="fail">✗ Nicht geschafft</button>
          <button class="btn btn-ghost" data-act="${t.timer.paused ? 'resume' : 'pause'}">${t.timer.paused ? '▶️ Weiter' : '⏸️ Pause'}</button>`;
        const extras = [];
        if (viaPhone) {
          /* Karte & Zeichenfläche liegen auf dem Handy */
        } else if (offline && isZeichnen) extras.push(`<button class="btn btn-ghost" data-act="draw-toggle">${ui.drawOpen ? '🃏 Karte zeigen' : '✏️ Zeichenfläche'}</button>`);
        if (offline && !viaPhone && !revealed && !ui.drawOpen) extras.push(`<button class="btn btn-ghost" data-act="reveal">👀 Aufdecken</button>`);
        if (offline && !viaPhone && revealed && !ui.drawOpen) extras.push(`<button class="btn btn-ghost" data-act="hide">🙈 Verdecken</button>`);
        actions = mainBtns + extras.join('');
      }
    } else if (phase === 'timeout') {
      if (canControl) {
        actions = `<button class="btn btn-success btn-big" data-act="success">✓ Doch erraten</button>
          <button class="btn btn-danger btn-big" data-act="fail">✗ Nicht erraten</button>`;
      }
    }

    // Tipp-Eingabe (online, Team-Mitglieder)
    const guesses = t.guesses && t.guesses.length
      ? `<ul class="guesses">${t.guesses
          .slice(-6)
          .map((g) => `<li class="${g.hit ? 'hit' : ''}"><b>${esc(g.name)}:</b> ${esc(g.text)}</li>`)
          .join('')}</ul>`
      : '';
    const guessForm = me.canGuess && !t.timer.paused
      ? `<form class="guess-form" data-form="guess">
           <input class="input" type="text" maxlength="40" placeholder="Deinen Tipp eintippen…" data-field="guess" autocomplete="off" enterkeyhint="send" />
           <button class="btn btn-primary" type="submit">Raten</button>
         </form>`
      : '';

    // Mittelteil
    let body;
    if (showSketch) {
      const termBanner = viaPhone
        ? `<div class="term-banner muted-banner">📱 ${explainerName} zeichnet auf dem Handy</div>`
        : t.card && (offline ? ui.peek : me.isExplainer)
          ? `<div class="term-banner">✏️ <b>${esc(t.card.term)}</b></div>`
          : offline
            ? `<button class="btn btn-ghost btn-small peek-btn" data-peek>👁 Begriff zeigen (gedrückt halten)</button>`
            : '';
      body = `
        <div class="stage-body drawing">
          <div class="sketch-col">
            ${termBanner}
            <div class="sketch-frame">
              <div class="sketch-host" id="sketch-host" data-keep data-sketch data-editable="${sketchEditable ? '1' : '0'}"></div>
            </div>
            ${sketchEditable ? penToolsHtml() : ''}
          </div>
          <div class="side-col">
            ${timerHtml(v)}
            ${guesses}
          </div>
        </div>`;
    } else {
      body = `
        <div class="stage-body">
          ${cardHtml(v, revealed, viaPhone)}
          <div class="side-col">
            ${timerHtml(v)}
            ${guesses}
          </div>
        </div>`;
    }

    return `
      <div class="stage" id="stage" role="dialog" aria-modal="true" aria-label="Aktuelle Karte">
        <div class="stage-inner">
          ${head}
          <p class="stage-info">${info}</p>
          ${body}
          ${guessForm}
          <div class="stage-actions">${actions}</div>
        </div>
      </div>`;
  }

  /* ---------- Handy als Kartenhand (Offline-Spiel) ---------- */

  function remoteHtml(v) {
    const t = v.turn;
    const reconnecting = ui.status === 'reconnecting' || ui.status === 'connecting';
    const head = `
      <header class="remote-head">
        ${logoHtml(true)}
        <span class="pill">📱 Kartenhand</span>
        <span class="remote-head-actions">
          <button class="icon-btn" data-act="mute" aria-label="Ton an/aus">${Sound.muted ? '🔇' : '🔊'}</button>
          <button class="icon-btn" data-act="leave-remote" aria-label="Trennen">✕</button>
        </span>
      </header>
      ${reconnecting ? `<div class="status-banner"><span class="spinner-sm"></span> Verbindung zum Spielbrett unterbrochen – verbinde neu…</div>` : ''}`;

    let body = '';
    let teamId = t ? t.team : v.result ? v.result.team : v.winner;

    if (v.phase === 'over') {
      const winner = teamOf(v, v.winner) || teamOf(v, v.order[0]);
      teamId = winner.id;
      body = `
        <div class="remote-msg">
          <div class="big-emoji">🏆</div>
          <h2>${esc(winner.name)} ${v.ended ? 'liegt vorne!' : 'gewinnt!'}</h2>
          <p class="muted">Revanche oder neues Spiel startet ihr am Spielbrett.</p>
        </div>`;
    } else if (v.phase === 'result' && v.result) {
      const r = v.result;
      const next = nextTeamOf(v, r.team);
      body = `
        <div class="remote-result">
          <div class="result-card ${r.success ? 'ok' : 'bad'}" style="--team:${TEAM_COLOR[r.team]}">
            <div class="rc-icon">${r.success ? '✓' : '✗'}</div>
            <div class="rc-title">${r.success ? `Erraten! +${r.points}` : 'Nicht erraten'}</div>
            <div class="rc-term"><small>Der Begriff war</small><b>${esc(r.term)}</b></div>
            <button class="btn btn-primary btn-wide" data-act="next">${r.winner ? '🏆 Zur Siegerehrung' : `Weiter – ${esc(next.name)} ist dran →`}</button>
          </div>
        </div>`;
    } else if (t) {
      const team = teamOf(v, t.team);
      const name = esc(t.explainerName);
      // Während der Karte reicht eine kompakte Zeile – die Karte zeigt die Kategorie
      const banner =
        v.phase === 'choose'
          ? `
        <div class="remote-turn" style="--team:${TEAM_COLOR[t.team]}">
          <div class="rt-team"><span class="team-dot"></span>${esc(team.name)} ist dran</div>
          <div class="rt-player">🎤 ${name}</div>
          ${
            t.cat
              ? `<div class="cat-badge cat-${t.cat}"><span class="cat-badge-icon">${CAT[t.cat].icon}</span><span>${CAT[t.cat].label}</span></div>`
              : ''
          }
        </div>`
          : `
        <div class="stage-head remote-compact" style="--team:${TEAM_COLOR[t.team]}">
          <span class="team-dot"></span>
          <span class="sh-team">${esc(team.name)}</span>
          <span>🎤 ${name}</span>
          <span class="cat-chip cat-${t.cat}">${CAT[t.cat].icon} ${CAT[t.cat].label}</span>
        </div>`;

      if (v.phase === 'choose') {
        const chooser =
          t.catFree && !t.cat
            ? `<p class="remote-hint">⭐ Startfeld – wählt eine Kategorie:</p>
               <div class="cat-buttons">${CATS.map((c) => `<button class="cat-btn cat-${c}" data-act="category" data-cat="${c}"><span>${CAT[c].icon}</span>${CAT[c].label}</button>`).join('')}</div>`
            : `<p class="remote-hint">Nur <b>${name}</b> schaut aufs Handy! Wählt einen Stapel:</p>`;
        body = `
          ${banner}
          ${chooser}
          <div class="stacks remote-stacks ${t.cat ? 'can-pick' : ''}">${stacksHtml(t, !!t.cat, true)}</div>`;
      } else {
        const flying = !!ui.fly && ui.fly.no === t.no;
        const hidden = ui.phoneHidden === t.no;
        const drawing = t.cat === 'zeichnen' && ui.drawOpen && v.phase !== 'card';
        const editable = drawing && v.phase === 'running' && !t.timer.paused;
        let main;
        if (drawing) {
          main = `
            <div class="term-banner">✏️ <b>${t.card ? esc(t.card.term) : ''}</b></div>
            <div class="sketch-frame">
              <div class="sketch-host" id="sketch-host" data-keep data-sketch data-editable="${editable ? '1' : '0'}"></div>
            </div>
            ${editable ? penToolsHtml() : ''}
            <p class="muted small center">Die Zeichnung erscheint live auf dem Spielbrett.</p>`;
        } else {
          main = cardHtml(v, !flying && !hidden);
        }
        let info = '';
        let actions = '';
        if (v.phase === 'card') {
          info = `Merk dir den Begriff, ${name}!`;
          actions = `<button class="btn btn-primary btn-big" data-act="startTimer">▶ Zeit starten</button>
            <button class="btn btn-ghost" data-act="phone-hide">${hidden ? '👀 Zeigen' : '🙈 Verdecken'}</button>`;
        } else if (v.phase === 'running') {
          info = t.timer.paused ? '⏸ Pausiert' : `${CAT[t.cat].rule}!`;
          actions = `
            <button class="btn btn-success btn-big" data-act="success">✓ Erraten!</button>
            <button class="btn btn-danger" data-act="fail">✗ Nicht geschafft</button>
            <button class="btn btn-ghost" data-act="${t.timer.paused ? 'resume' : 'pause'}">${t.timer.paused ? '▶️ Weiter' : '⏸️ Pause'}</button>
            ${t.cat === 'zeichnen' ? `<button class="btn btn-ghost" data-act="draw-toggle">${ui.drawOpen ? '🃏 Karte zeigen' : '✏️ Auf dem Handy zeichnen'}</button>` : ''}
            ${!drawing ? `<button class="btn btn-ghost" data-act="phone-hide">${hidden ? '👀 Zeigen' : '🙈 Verdecken'}</button>` : ''}`;
        } else if (v.phase === 'timeout') {
          info = '⏰ Zeit ist um! Wurde der Begriff rechtzeitig erraten?';
          actions = `<button class="btn btn-success btn-big" data-act="success">✓ Doch erraten</button>
            <button class="btn btn-danger btn-big" data-act="fail">✗ Nicht erraten</button>`;
        }
        body = `
          ${banner}
          <p class="remote-hint">${info}</p>
          <div class="remote-card ${drawing ? 'is-drawing' : ''}">${main}</div>
          <div class="remote-timer">${timerHtml(v)}</div>
          <div class="stage-actions">${actions}</div>`;
      }
    }

    const scores = v.order
      .map((id) => teamOf(v, id))
      .map((team) => `<span class="score-chip team-${team.id}"><span class="team-dot"></span>${esc(team.name)} <b>${team.pos}/${v.board.length - 1}</b></span>`)
      .join('');

    return `
      <div class="screen remote" style="--team:${TEAM_COLOR[teamId] || '#fff'}">
        ${head}
        <div class="remote-body">${body}</div>
        <div class="remote-scores">${scores}</div>
      </div>`;
  }

  /* ---------- Siegerehrung ---------- */

  function winnerHtml(v) {
    const ranking = v.order
      .map((id) => teamOf(v, id))
      .sort((a, b) => b.pos - a.pos || b.score - a.score);
    const winner = v.winner ? teamOf(v, v.winner) : ranking[0];
    const medals = ['🥇', '🥈', '🥉', '4.'];
    const me = v.me;
    let buttons;
    if (v.mode === 'offline') {
      buttons = `<button class="btn btn-primary btn-big" data-act="rematch">🔁 Revanche</button>
        <button class="btn btn-ghost" data-act="new-game">Neues Spiel</button>
        <button class="btn btn-ghost" data-act="home">Hauptmenü</button>`;
    } else if (me.isHost) {
      buttons = `<button class="btn btn-primary btn-big" data-act="rematch">🔁 Revanche</button>
        <button class="btn btn-ghost" data-act="toLobby">Zur Lobby</button>
        <button class="btn btn-ghost" data-act="leave">Raum schließen</button>`;
    } else {
      buttons = `<p class="muted">Warte auf den Host…</p><button class="btn btn-ghost" data-act="leave">Spiel verlassen</button>`;
    }
    return `
      <div class="overlay winner-overlay" role="dialog" aria-modal="true" aria-label="Siegerehrung">
        <div class="winner-box" style="--team:${TEAM_COLOR[winner.id]}">
          <div class="trophy">🏆</div>
          <h2>${v.ended ? 'Spiel beendet!' : 'Gewonnen!'}</h2>
          <p class="winner-name"><span class="team-dot"></span>${esc(winner.name)}</p>
          <ol class="ranking">
            ${ranking
              .map(
                (t, i) => `<li class="team-${t.id}"><span>${medals[i] || i + 1 + '.'}</span><b>${esc(t.name)}</b><span class="muted">Feld ${t.pos} · ${t.score} P. · ✓${t.ok}</span></li>`
              )
              .join('')}
          </ol>
          <div class="winner-actions">${buttons}</div>
        </div>
      </div>`;
  }

  /* ---------- Modale Fenster ---------- */

  function modalHtml() {
    if (!ui.modal) return '';
    let body = '';
    if (ui.modal === 'rules') body = rulesHtml();
    else if (ui.modal === 'menu') body = menuHtml();
    else if (ui.modal === 'qr') body = qrHtml();
    else if (ui.modal === 'remote') body = remoteModalHtml();
    else if (ui.modal === 'adult') {
      body = `
        <h2>🔞 Begriffe ab 18</h2>
        <p>Damit kommen 200 frechere Begriffe (Party, Flirt, Liebe & Co.) in die Stapel.</p>
        <p><b>Sind alle Mitspielenden mindestens 18 Jahre alt?</b></p>
        <div class="modal-actions">
          <button class="btn btn-primary" data-act="adult-yes">Ja, alle sind 18+</button>
          <button class="btn btn-ghost" data-act="close-modal">Abbrechen</button>
        </div>`;
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
        <p><b>Ziel:</b> Als erstes Team mit der Spielfigur das Ziel erreichen.</p>
        <p><b>So geht ein Zug:</b> Das Feld, auf dem eure Figur steht, bestimmt die Kategorie. Ihr wählt einen der drei Kartenstapel:
          <span class="diff-tag diff-leicht">Leicht = 3 Punkte</span>
          <span class="diff-tag diff-mittel">Mittel = 4 Punkte</span>
          <span class="diff-tag diff-schwer">Schwer = 5 Punkte</span>
        </p>
        <ul>
          <li><b>💬 Erklären:</b> Den Begriff umschreiben – ohne ihn selbst, Teile davon oder die <b>3 verbotenen Wörter</b> auf der Karte zu sagen.</li>
          <li><b>✏️ Zeichnen:</b> Den Begriff zeichnen – keine Buchstaben, Zahlen oder Gesten.</li>
          <li><b>🎭 Pantomime:</b> Den Begriff vorspielen – ohne Worte und Geräusche.</li>
        </ul>
        <p>Errät das eigene Team den Begriff in der Zeit, zieht die Figur so viele Felder vor, wie die Karte Punkte bringt. Bei einem Regelverstoß oder wenn die Zeit abläuft, bleibt die Figur stehen.</p>
        <p><b>Reihum:</b> In jedem Team ist bei jedem Zug eine andere Person mit Erklären/Zeichnen/Vorspielen dran.</p>
        <p><b>Startfeld:</b> Hier dürft ihr die Kategorie frei wählen.</p>
        <p><b>Offline:</b> Ein Gerät wird herumgereicht. Nur die Person, die dran ist, deckt die Karte auf.
          Oder: Laptop/Tablet zeigt das Spielbrett und ein Handy dient als <b>Kartenhand</b> (📱-Knopf oben, QR-Code scannen) –
          das Handy geht immer an die Person, die dran ist.</p>
        <p><b>Online:</b> Alle spielen auf dem eigenen Gerät. Die Karte sieht nur, wer dran ist. Zeichnungen werden live übertragen, Tipps kann das eigene Team auch eintippen.</p>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Alles klar!</button></div>`;
  }

  function menuHtml() {
    const v = ui.view;
    const items = [];
    items.push(`<button class="menu-item" data-act="rules">📖 Spielregeln</button>`);
    items.push(`<button class="menu-item" data-act="mute">${Sound.muted ? '🔊 Ton einschalten' : '🔇 Ton ausschalten'}</button>`);
    if (v && v.mode === 'online') items.push(`<button class="menu-item" data-act="show-qr">📱 Mitspieler einladen</button>`);
    if (v && v.turn && ['choose', 'card'].includes(v.phase) && (v.mode === 'offline' || v.me.isHost || v.me.isExplainer)) {
      const team = teamOf(v, v.turn.team);
      if (team.players.length > 1) items.push(`<button class="menu-item" data-act="skipExplainer">🔄 Andere Person aus ${esc(team.name)} ist dran</button>`);
    }
    if (v && v.mode === 'offline') {
      items.push(`<button class="menu-item" data-act="remote">📱 Handy als Kartenhand ${v.remote && v.remote.connected ? '<small>(verbunden)</small>' : ''}</button>`);
      items.push(`<button class="menu-item" data-act="home-keep">🏠 Hauptmenü <small>(Spiel bleibt gespeichert)</small></button>`);
      if (v.phase !== 'over') items.push(`<button class="menu-item danger" data-act="end-game">⏹️ Spiel beenden</button>`);
    } else if (v && v.me.isHost) {
      if (!['lobby', 'over'].includes(v.phase)) items.push(`<button class="menu-item danger" data-act="end-game">⏹️ Spiel beenden</button>`);
      items.push(`<button class="menu-item danger" data-act="leave">🚪 Raum schließen</button>`);
    } else if (v) {
      items.push(`<button class="menu-item danger" data-act="leave">🚪 Spiel verlassen</button>`);
    }
    return `<h2>Menü</h2><div class="menu-list">${items.join('')}</div>`;
  }

  function remoteButtonHtml(v) {
    const on = !!v.remote && v.remote.connected > 0;
    return `<button class="pill-btn ${on ? 'on' : ''}" data-act="remote" title="Handy als Kartenhand" aria-label="Handy als Kartenhand">📱<span class="pill-btn-text">${on ? 'Handy verbunden' : 'Handy verbinden'}</span></button>`;
  }

  function remoteModalHtml() {
    const r = ui.view && ui.view.remote;
    let content;
    if (r && r.state === 'error') {
      content = `<div class="alert">Die Verbindung konnte nicht aufgebaut werden. Prüfe die Internetverbindung und versuche es erneut.</div>`;
    } else if (!r || !r.code || r.state !== 'online') {
      content = `<div class="qr-wait"><div class="spinner" aria-hidden="true"></div><p>QR-Code wird vorbereitet…</p></div>`;
    } else {
      const link = inviteLink(r.code, 'karte');
      content = `
        <div class="qr">${qrSvg(link)}</div>
        <p class="center">Code: <b class="room-code-inline" data-testid="remote-code">${esc(r.code)}</b></p>
        <p class="center small muted link-text">${esc(link)}</p>
        <p class="remote-status ${r.connected ? 'ok' : ''}">${
          r.connected ? `✅ ${r.connected} ${plural(r.connected, 'Handy', 'Handys')} verbunden` : '⏳ Warte auf ein Handy…'
        }</p>`;
    }
    return `
      <h2>📱 Handy als Kartenhand</h2>
      <p class="muted">Scanne den QR-Code mit dem Handy. Dort erscheinen die drei Kartenstapel, wer dran ist und die Kategorie.
        Das Handy wird immer an die Person weitergegeben, die gerade dran ist – nur sie sieht die Karte.
        Dieser Bildschirm zeigt das Spielbrett.</p>
      ${content}
      <div class="modal-actions">
        ${r ? `<button class="btn btn-ghost" data-act="remote-off">Verbindung beenden</button>` : ''}
        <button class="btn btn-primary" data-act="close-modal">Fertig</button>
      </div>`;
  }

  function qrHtml() {
    const code = ui.view && ui.view.room;
    if (!code) return '<p>Noch kein Raum-Code.</p>';
    const link = inviteLink(code);
    const svg = qrSvg(link);
    return `
      <h2>Mitspieler einladen</h2>
      <div class="qr">${svg}</div>
      <p class="center">Code: <b class="room-code-inline">${esc(code)}</b></p>
      <p class="center small muted link-text">${esc(link)}</p>
      <div class="modal-actions"><button class="btn btn-primary" data-act="copy-link">🔗 Link kopieren</button></div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Spielfiguren                                                        */
  /* ------------------------------------------------------------------ */

  const PAWN_OFFSETS = { rot: [-1, -1], blau: [1, -1], gruen: [-1, 1], gelb: [1, 1] };

  function pawnXY(i, L, teamId) {
    const { c, r } = cellOf(i, L.cols, L.rows);
    const step = L.cell + L.gap;
    const off = PAWN_OFFSETS[teamId] || [0, 0];
    const d = L.cell * 0.2;
    return { x: c * step + L.cell / 2 + off[0] * d, y: r * step + L.cell / 2 + off[1] * d };
  }

  function syncPawns() {
    const layer = app.querySelector('#pawns');
    const v = ui.view;
    const L = ui.layout;
    if (!layer || !v || !L || !v.board.length) return;
    const key = v.board.join(',') + '|' + L.cols + 'x' + L.rows + '@' + L.cell;
    const boardKey = v.board.join(',');
    const relayout = ui.pawnKey !== key;
    if (ui.pawnKey && ui.pawnKey.split('|')[0] !== boardKey) ui.pawnPos = {};
    ui.pawnKey = key;
    const size = Math.max(12, Math.round(L.cell * 0.38));
    layer.style.setProperty('--pawn', size + 'px');
    for (const el of [...layer.children]) if (!v.order.includes(el.dataset.team)) el.remove();
    for (const id of v.order) {
      const team = teamOf(v, id);
      let el = layer.querySelector(`[data-team="${id}"]`);
      const fresh = !el;
      if (!el) {
        el = document.createElement('div');
        el.className = `pawn pawn-${id}`;
        el.dataset.team = id;
        el.title = team.name;
        layer.appendChild(el);
      }
      const isTurn = v.turn && v.turn.team === id && v.phase !== 'over';
      el.classList.toggle('is-turn', !!isTurn);
      const known = ui.pawnPos[id];
      const target = team.pos;
      if (relayout && el._anim) {
        el._anim.cancel();
        el._anim = null;
      }
      if (fresh || relayout || known === undefined) {
        const p = pawnXY(target, L, id);
        el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      } else if (known !== target) {
        if (el._anim) el._anim.cancel();
        animatePawn(el, known, target, L, id);
      }
      ui.pawnPos[id] = target;
    }
  }

  function animatePawn(el, from, to, L, id) {
    const dir = to > from ? 1 : -1;
    const steps = Math.abs(to - from);
    const frames = [];
    const hop = L.cell * 0.45;
    for (let k = 0; k <= steps; k++) {
      const p = pawnXY(from + dir * k, L, id);
      if (k > 0) {
        const q = pawnXY(from + dir * (k - 1), L, id);
        frames.push({
          transform: `translate(${(p.x + q.x) / 2}px, ${(p.y + q.y) / 2 - hop}px) scale(1.15)`,
          offset: (k - 0.5) / steps,
        });
      }
      frames.push({ transform: `translate(${p.x}px, ${p.y}px) scale(1)`, offset: k / steps });
    }
    const per = 330;
    const final = pawnXY(to, L, id);
    const anim = el.animate(frames, { duration: per * steps, easing: 'linear', delay: 350, fill: 'backwards' });
    el._anim = anim;
    for (let k = 1; k <= steps; k++) setTimeout(() => el._anim === anim && Sound.hop(), 350 + per * (k - 0.3));
    anim.onfinish = () => {
      if (el._anim === anim) el._anim = null;
    };
    el.style.transform = `translate(${final.x}px, ${final.y}px)`;
    anim.oncancel = () => {
      if (el._anim === anim) el._anim = null;
    };
  }

  /* ------------------------------------------------------------------ */
  /* Board-Größe beobachten, Zeichenfläche & Karten-Animation            */
  /* ------------------------------------------------------------------ */

  let boardObserver = null;
  let observedEl = null;
  function observeBoard() {
    const el = app.querySelector('.board-area');
    if (el === observedEl) return;
    if (!boardObserver) {
      boardObserver = new ResizeObserver((entries) => {
        const r = entries[0].contentRect;
        const w = Math.floor(r.width);
        const h = Math.floor(r.height);
        if (w !== ui.box.w || h !== ui.box.h) {
          ui.box = { w, h };
          render();
        }
      });
    }
    if (observedEl) boardObserver.unobserve(observedEl);
    observedEl = el;
    if (el) boardObserver.observe(el);
  }

  /** Passt der Inhalt der Brett-Mitte nicht hinein, wird er verkleinert statt abgeschnitten */
  function fitCenter() {
    const box = app.querySelector('.board-center');
    const inner = box && box.firstElementChild;
    if (!inner) return;
    inner.style.zoom = '';
    const kids = [...inner.children];
    if (!kids.length) return;
    const cs = getComputedStyle(inner);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    // Inhalt ist mittig ausgerichtet und kann oben wie unten überstehen → über die Kinder messen
    // (offset* statt getBoundingClientRect, damit Einblend-Animationen das Ergebnis nicht verfälschen)
    const last = kids[kids.length - 1];
    const needH = last.offsetTop + last.offsetHeight - kids[0].offsetTop + padY;
    const needW = Math.max(...kids.map((k) => k.scrollWidth)) + padX;
    const k = Math.min(box.clientHeight / needH, box.clientWidth / needW);
    if (k < 1) inner.style.zoom = Math.max(0.4, k * 0.97).toFixed(3);
  }

  function mountSketch() {
    const host = app.querySelector('[data-sketch]');
    if (!host) {
      if (ui.sketch) {
        ui.sketch.destroy();
        ui.sketch = null;
      }
      return;
    }
    if (ui.sketch && ui.sketch.host !== host) {
      ui.sketch.destroy();
      ui.sketch = null;
    }
    if (!ui.sketch) {
      ui.sketch = new Sketch(host, {
        onLocal: (msg) => {
          ui.strokeLog.push(msg);
          if (ui.ctrl) ui.ctrl.sendStroke(msg);
        },
      });
      ui.sketch.loadAll(ui.strokeLog);
    }
    ui.sketch.setEditable(host.dataset.editable === '1');
    applyPen();
  }

  function applyPen() {
    if (!ui.sketch) return;
    if (ui.pen.eraser) {
      ui.sketch.setColor(Sketch.BG);
      ui.sketch.setWidth(0.04);
    } else {
      ui.sketch.setColor(ui.pen.color);
      ui.sketch.setWidth(ui.pen.width);
    }
  }

  function runFly() {
    const f = ui.fly;
    if (!f || f.started) return;
    const wrap = app.querySelector('#card-fly');
    if (!wrap) return;
    f.started = true;
    const done = () => {
      if (ui.fly === f) {
        ui.fly = null;
        render();
      }
    };
    const stackTop = app.querySelector(`.stack[data-diff="${f.diff}"] .sc-top`);
    const to = wrap.getBoundingClientRect();
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!to.width || reduce || !wrap.animate) {
      setTimeout(done, 50);
      return;
    }
    if (!stackTop) {
      const anim = wrap.animate(
        [
          { transform: 'translateY(60%) scale(0.5) rotate(-10deg)', opacity: 0 },
          { transform: 'translateY(-4%) scale(1.04) rotate(2deg)', opacity: 1, offset: 0.7 },
          { transform: 'none' },
        ],
        { duration: 600, easing: 'cubic-bezier(.2,.75,.25,1)' }
      );
      anim.onfinish = done;
      anim.oncancel = done;
      return;
    }
    const from = stackTop.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const s = Math.max(0.15, from.width / to.width);
    const anim = wrap.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(-12deg)`, opacity: 0.6 },
        { transform: `translate(${dx * 0.3}px, ${dy * 0.3 - 40}px) scale(${(s + 1) / 2}) rotate(6deg)`, opacity: 1, offset: 0.55 },
        { transform: 'translate(0, 0) scale(1.04) rotate(-2deg)', offset: 0.85 },
        { transform: 'none' },
      ],
      { duration: 750, easing: 'cubic-bezier(.2,.75,.25,1)' }
    );
    anim.onfinish = done;
    anim.oncancel = done;
  }

  /* ------------------------------------------------------------------ */
  /* Aktionen                                                            */
  /* ------------------------------------------------------------------ */

  function dispatch(type, extra) {
    if (!ui.ctrl) return;
    const v = ui.view;
    const a = Object.assign({ type }, extra || {});
    if (v && a.no === undefined) {
      if (type === 'next' && v.result) a.no = v.result.no;
      else if (v.turn) a.no = v.turn.no;
    }
    ui.ctrl.dispatch(a);
  }

  function openRemote() {
    if (!ui.ctrl || ui.ctrl.mode !== 'offline') return;
    try {
      ui.ctrl.enableRemote();
    } catch (err) {
      toast('Handy-Verbindung nicht verfügbar: ' + err.message);
      return;
    }
    ui.modal = 'remote';
    render();
  }

  function askConfirm(opts) {
    ui.confirm = opts;
    ui.modal = 'confirm';
    render();
  }

  function setSetting(scope, key, value) {
    if (scope === 'setup') {
      ui.setup.settings[key] = value;
      Store.set(SETUP_KEY, ui.setup);
      render();
    } else if (ui.view) {
      dispatch('settings', { settings: Object.assign({}, ui.view.settings, { [key]: value }) });
    }
  }

  async function copyLink() {
    const code = ui.view && ui.view.room;
    if (!code) return;
    const link = inviteLink(code);
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ title: 'Guess the word!', text: `Spiel mit! Raum-Code: ${code}`, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      toast('Link kopiert!');
    } catch {
      toast('Code: ' + code);
    }
  }

  const actions = {
    home: () => goHome(false),
    'home-keep': () => goHome(true),
    'offline-setup': () => {
      ui.screen = 'setup';
      render();
    },
    'online-menu': () => {
      ui.screen = 'online';
      ui.error = null;
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
    mute: () => {
      Sound.setMuted(!Sound.muted);
      if (ui.modal === 'menu') ui.modal = null;
      render();
    },

    /* Spielstände */
    'resume-offline': () => {
      const s = Store.get(KEYS.offline);
      if (s) startOffline(s);
    },
    'discard-offline': () =>
      askConfirm({
        title: 'Spielstand löschen?',
        text: 'Das gespeicherte Offline-Spiel wird gelöscht.',
        yes: 'Löschen',
        danger: true,
        run: () => Store.remove(KEYS.offline),
      }),
    'resume-host': () => {
      const h = Store.get(KEYS.host);
      if (h) startHost({ restore: h });
    },
    'discard-host': () => {
      Store.remove(KEYS.host);
      render();
    },
    'resume-client': () => {
      const c = Store.get(KEYS.client);
      if (c) startClient({ code: c.code, name: c.name, pid: c.pid, role: c.role });
    },
    'discard-client': () => {
      Store.remove(KEYS.client);
      render();
    },

    /* Offline-Setup */
    'team-toggle': (el) => {
      const t = ui.setup.teams[+el.dataset.team];
      const active = ui.setup.teams.filter((x) => x.active).length;
      if (t.active && active <= 2) return;
      t.active = !t.active;
      Store.set(SETUP_KEY, ui.setup);
      render();
    },
    'add-player': (el) => {
      const ti = +el.dataset.team;
      const t = ui.setup.teams[ti];
      if (t.players.length >= MAX_PLAYERS) return;
      t.players.push('');
      ui.focus = `[data-field="player-name"][data-team="${ti}"][data-player="${t.players.length - 1}"]`;
      render();
    },
    'remove-player': (el) => {
      const t = ui.setup.teams[+el.dataset.team];
      if (t.players.length <= 2) return;
      t.players.splice(+el.dataset.player, 1);
      Store.set(SETUP_KEY, ui.setup);
      render();
    },
    'set-timer': (el) => setSetting(el.dataset.scope, 'timer', +el.dataset.value),
    'set-length': (el) => setSetting(el.dataset.scope, 'length', +el.dataset.value),
    'toggle-adult': (el) => {
      const scope = el.dataset.scope;
      const current = scope === 'setup' ? ui.setup.settings.adult : ui.view && ui.view.settings.adult;
      if (current) setSetting(scope, 'adult', false);
      else {
        ui.adultScope = scope;
        ui.modal = 'adult';
        render();
      }
    },
    'adult-yes': () => {
      ui.modal = null;
      setSetting(ui.adultScope, 'adult', true);
      render();
    },
    'toggle-phone': () => {
      ui.setup.settings.phone = !ui.setup.settings.phone;
      Store.set(SETUP_KEY, ui.setup);
      render();
    },
    remote: () => openRemote(),
    'remote-off': () => {
      if (ui.ctrl && ui.ctrl.disableRemote) ui.ctrl.disableRemote();
      ui.modal = null;
      render();
    },
    'phone-hide': () => {
      const t = ui.view && ui.view.turn;
      if (!t) return;
      ui.phoneHidden = ui.phoneHidden === t.no ? null : t.no;
      render();
    },
    'leave-remote': () =>
      askConfirm({
        title: 'Kartenhand trennen?',
        text: 'Das Handy wird vom Spielbrett getrennt. Du kannst den QR-Code jederzeit erneut scannen.',
        yes: 'Trennen',
        danger: true,
        run: () => goHome(false),
      }),
    'start-offline': () => {
      Store.set(SETUP_KEY, ui.setup);
      const state = Engine.offline({
        teams: ui.setup.teams.map((t) => ({ id: t.id, active: t.active, name: t.name, players: t.players })),
        settings: ui.setup.settings,
      });
      Sound.unlock();
      startOffline(state);
      if (ui.setup.settings.phone) openRemote();
    },

    /* Online */
    'create-room': () => {
      const name = ui.name.trim();
      if (!name) {
        ui.error = 'Bitte gib zuerst deinen Namen ein.';
        ui.focus = '#name-input';
        render();
        return;
      }
      savePrefs();
      startHost({ name });
    },
    'leave-now': () => {
      if (ui.ctrl && ui.ctrl.mode === 'host') goHome(false);
      else {
        stopController(false);
        ui.screen = 'online';
        render();
      }
    },
    leave: () => {
      const host = ui.ctrl && ui.ctrl.mode === 'host';
      askConfirm({
        title: host ? 'Raum schließen?' : 'Spiel verlassen?',
        text: host ? 'Das Spiel wird für alle beendet.' : 'Du kannst über den Code jederzeit wieder beitreten.',
        yes: host ? 'Raum schließen' : 'Verlassen',
        danger: true,
        run: () => goHome(false),
      });
    },
    'copy-link': () => copyLink(),
    'show-qr': () => {
      ui.modal = 'qr';
      render();
    },
    'join-team': (el) => dispatch('joinTeam', { team: el.dataset.team || null }),
    'lobby-team': (el) => dispatch('teamActive', { team: el.dataset.team, active: el.dataset.on === '1' }),
    'start-game': () => dispatch('start'),
    kick: (el) => dispatch('kick', { player: el.dataset.player }),

    /* Spiel */
    category: (el) => dispatch('category', { cat: el.dataset.cat }),
    draw: (el) => {
      el.classList.add('drawing');
      dispatch('draw', { diff: el.dataset.diff });
    },
    reveal: () => {
      if (!ui.view || !ui.view.turn) return;
      ui.revealed = ui.view.turn.no;
      Sound.flip();
      render();
    },
    hide: () => {
      ui.revealed = null;
      render();
    },
    startTimer: () => dispatch('startTimer'),
    pause: () => dispatch('pause'),
    resume: () => dispatch('resume'),
    success: () => dispatch('success'),
    fail: () => dispatch('fail'),
    next: () => dispatch('next'),
    skipExplainer: () => {
      ui.modal = null;
      ui.revealed = null;
      dispatch('skipExplainer');
      render();
    },
    'end-game': () =>
      askConfirm({
        title: 'Spiel beenden?',
        text: 'Das Team, das am weitesten vorne steht, gewinnt.',
        yes: 'Beenden',
        danger: true,
        run: () => dispatch('endGame'),
      }),
    rematch: () => dispatch('rematch'),
    toLobby: () => dispatch('toLobby'),
    'new-game': () => {
      stopController(false);
      ui.screen = 'setup';
      render();
    },
    'confirm-yes': () => {
      const c = ui.confirm;
      ui.modal = null;
      ui.confirm = null;
      if (c && c.run) c.run();
      render();
    },
    'draw-toggle': () => {
      ui.drawOpen = !ui.drawOpen;
      render();
    },
    'pen-color': (el) => {
      ui.pen.color = el.dataset.value;
      ui.pen.eraser = false;
      applyPen();
      render();
    },
    'pen-width': (el) => {
      ui.pen.width = +el.dataset.value;
      ui.pen.eraser = false;
      applyPen();
      render();
    },
    'pen-eraser': () => {
      ui.pen.eraser = !ui.pen.eraser;
      applyPen();
      render();
    },
    'pen-undo': () => ui.sketch && ui.sketch.undo(),
    'pen-clear': () => ui.sketch && ui.sketch.clear(),
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
    if (ui.modal && !['close-modal', 'close-modal-bg', 'confirm-yes', 'adult-yes', 'copy-link', 'mute'].includes(el.dataset.act) && el.closest('.modal')) {
      // Menüpunkte schließen das Menü, bevor sie etwas tun
      if (ui.modal === 'menu') ui.modal = null;
    }
    fn(el, e);
  });

  app.addEventListener('input', (e) => {
    const el = e.target;
    const f = el.dataset && el.dataset.field;
    if (!f) return;
    if (f === 'team-name') {
      ui.setup.teams[+el.dataset.team].name = el.value;
      Store.set(SETUP_KEY, ui.setup);
    } else if (f === 'player-name') {
      ui.setup.teams[+el.dataset.team].players[+el.dataset.player] = el.value;
      Store.set(SETUP_KEY, ui.setup);
    } else if (f === 'online-name') {
      ui.name = el.value;
      if (ui.error) {
        ui.error = null;
        render();
      }
    } else if (f === 'join-code') {
      ui.joinCode = Net.cleanCode(el.value);
    }
  });

  app.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.field === 'lobby-team-name') {
      dispatch('teamName', { team: el.dataset.team, name: el.value });
    }
  });

  app.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key !== 'Enter' || !el.dataset) return;
    if (el.dataset.field === 'player-name') {
      e.preventDefault();
      const next = app.querySelector(`[data-field="player-name"][data-team="${el.dataset.team}"][data-player="${+el.dataset.player + 1}"]`);
      if (next) next.focus();
      else actions['add-player'](el);
    } else if (el.dataset.field === 'online-name') {
      e.preventDefault();
      if (ui.joinCode) app.querySelector('[data-form="join"] button[type="submit"]').click();
      else actions['create-room']();
    } else if (el.dataset.field === 'lobby-team-name') {
      el.blur();
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
    } else if (form.dataset.form === 'guess') {
      const input = form.querySelector('[data-field="guess"]');
      const text = input.value.trim();
      if (!text) return;
      dispatch('guess', { text });
      input.value = '';
    }
  });

  // "Begriff zeigen" beim Zeichnen (offline): nur solange gedrückt
  app.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-peek]')) {
      ui.peek = true;
      render();
    }
  });
  const endPeek = () => {
    if (ui.peek) {
      ui.peek = false;
      render();
    }
  };
  window.addEventListener('pointerup', endPeek);
  window.addEventListener('pointercancel', endPeek);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.modal) {
      ui.modal = null;
      ui.confirm = null;
      render();
    }
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
    if (active === 'offline' && saves.offline) startOffline(saves.offline);
    else if (active === 'host' && saves.host) startHost({ restore: saves.host });
    else if (active === 'client' && saves.client) {
      startClient({ code: saves.client.code, name: saves.client.name, pid: saves.client.pid, role: saves.client.role });
    } else if (ui.remoteCode) {
      // QR-Code der Kartenhand gescannt
      startClient({ code: ui.remoteCode, role: 'remote' });
    } else render();
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.ACTIVITY_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  requestAnimationFrame(timerLoop);
  autoResume();

  // für Tests
  window.ActivityApp = { ui, render: renderNow, actions };
})();
