/*
 * Oberfläche von „Geheimsache“.
 *  - Laptop („Bühne“): Spiel anlegen, Spielfeld, Hinweis eintragen, Karten aufdecken, QR-Code der Schlüsselkarte
 *  - Schlüsselkarte (#k=… im Link): Handy der Geheimdienstchefs, klappt ohne Verbindung. Steht ein Raum
 *    im Link (&r=…), verbindet sie sich nebenbei mit dem Laptop und meldet „Hinweis gegeben“
 *  - Handy (Alle mit Handy): Team wählen, als Chef Hinweise geben, als Ermittler:in vorschlagen und aufdecken
 * Gerendert wird per HTML-String + morphdom (nur geänderte Teile werden ersetzt).
 */
(function () {
  'use strict';

  const { TEAMS, MATCH_OPTIONS, TIMER_OPTIONS, DRINK_OPTIONS, WORD_OPTIONS, UNLIMITED, MAX_COUNT, MAX_WORD, MAX_PLAYERS, DRINKS, Engine, sanitizeSettings } =
    window.GSEngine;
  const { StageController, ClientController, Store, KEYS, Net, inviteLink, qrSvg } = window.GSControllers;
  const { Sound, confetti } = window.GameFx;
  const Board = window.GSBoard;

  const TEAM_COLOR = { rot: '#ef4444', blau: '#3b82f6' };
  const INPUT = {
    keys: {
      icon: '📲',
      label: 'Nur Chef-Handys',
      text: 'Wie am Tisch: Der Laptop zeigt das Feld, nur die beiden Geheimdienstchefs scannen die Schlüsselkarte – klappt auch ohne Internet.',
    },
    phones: {
      icon: '📱',
      label: 'Alle mit Handy',
      text: 'Alle verbinden ihr Handy. Der Chef tippt den Hinweis ein, das Team schlägt Karten vor und deckt auf dem Handy auf.',
    },
  };
  const OWNER_ICON = { rot: '🕵️', blau: '🕵️', neutral: '🧍', assassin: '☠️' };
  const DRINK_REASON = {
    neutral: 'Unbeteiligte erwischt',
    opponent: 'Gegnerkarte erwischt',
    assassin: 'Attentäter!',
    clue: 'Hinweis komplett gelöst',
    lost: 'Partie verloren',
  };
  const SETUP_KEY = 'geheimsache.setup.v1';
  const PREFS_KEY = 'geheimsache.prefs.v1';
  const ACTIVE_KEY = 'geheimsache.active';
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

  function plural(n, one, many) {
    return n === 1 ? one : many;
  }

  function otherTeam(id) {
    return id === 'rot' ? 'blau' : 'rot';
  }

  function teamOf(v, id) {
    return v.teams.find((t) => t.id === id);
  }

  function countLabel(c) {
    return c === UNLIMITED ? '∞' : String(c);
  }

  function minutes(sec) {
    return sec ? `${sec / 60} Min` : 'Aus';
  }

  /** „1 Schluck“ / „3 Strafpunkte“ */
  function drinkUnit(n, mode) {
    if (mode === 'free') return `${n} ${plural(n, 'Strafpunkt', 'Strafpunkte')}`;
    return `${n} ${plural(n, 'Schluck', 'Schlucke')}`;
  }

  function defaultSetup() {
    return {
      settings: sanitizeSettings({}),
      teams: TEAMS.map((t) => ({ id: t.id, name: '', players: ['', ''] })),
    };
  }

  function loadSetup() {
    const saved = Store.get(SETUP_KEY);
    if (!saved || !Array.isArray(saved.teams) || saved.teams.length !== TEAMS.length) return defaultSetup();
    saved.settings = sanitizeSettings(saved.settings);
    return saved;
  }

  function saveSetup() {
    Store.set(SETUP_KEY, ui.setup);
  }

  function hashParam(name) {
    const m = new RegExp('[#&]' + name + '=([0-9a-zA-Z]+)').exec(location.hash);
    return m ? m[1] : null;
  }

  /** Code der Schlüsselkarte aus dem Link-Anker (#k=…) */
  function keyFromHash() {
    return hashParam('k');
  }

  /** Link der Schlüsselkarte. room/gameNo nur mit Internet: dann kann das Handy „Hinweis gegeben“ melden */
  function keyLink(code, room, gameNo) {
    return location.origin + location.pathname + '#k=' + code + (room ? '&r=' + room + '&g=' + gameNo : '');
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
    drinkPop: null,
    focus: null,
    pick: null, // Laptop: ausgewählte Karte (zweiter Klick deckt auf)
    clueWord: '', // Hinweis-Wort (Laptop oder Chef-Handy)
    clueCount: 1, // Zahl auf dem Chef-Handy
    clueError: null,
    stageClue: false, // Alle mit Handy: Hinweis doch am Laptop eintragen
    nextChiefs: null, // Laptop zwischen den Partien: {rot: pid, blau: pid}
    keyCode: keyFromHash(),
    keyDone: new Set(), // Schlüsselkarte: abgehakte Felder
    keyHidden: false,
    keyRoom: Net.cleanCode(hashParam('r') || '') || null, // Raum des Laptops (nur mit Internet)
    keyGame: +hashParam('g') || 0, // Partie, zu der die Schlüsselkarte gehört
    keyConn: null, // Verbindung der Schlüsselkarte zum Laptop
    keyView: null,
    keyStatus: null,
  };
  if (ui.joinCode) ui.screen = 'join';
  if (ui.keyCode) ui.screen = 'key';

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
  function flash(text, team) {
    ui.flash = { text, team, id: ++flashNo };
    clearTimeout(ui.flashTimer);
    ui.flashTimer = setTimeout(() => {
      ui.flash = null;
      render();
    }, 2400);
  }

  function showDrinks(list, mode) {
    if (!list.length) return;
    ui.drinkPop = { id: ++flashNo, lines: list, mode };
    clearTimeout(ui.drinkTimer);
    ui.drinkTimer = setTimeout(() => {
      ui.drinkPop = null;
      render();
    }, 4200);
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
    ui.drinkPop = null;
    ui.pick = null;
    session(ACTIVE_KEY, null);
  }

  function goHome(keepSave) {
    stopController(keepSave);
    ui.screen = 'home';
    history.replaceState(null, '', location.pathname);
    render();
  }

  /** Schlüsselkarte: nebenbei mit dem Laptop verbinden (nur für „Hinweis gegeben“) */
  function keyConnect() {
    keyDisconnect();
    if (!ui.keyRoom) return;
    let conn = null;
    const mine = () => !conn || ui.keyConn === conn;
    conn = new ClientController(
      { code: ui.keyRoom, name: 'Schlüsselkarte', hello: { key: true }, save: false },
      {
        onView: (v) => {
          if (!mine()) return;
          if (!ui.keyView || ui.keyView.turnNo !== v.turnNo) ui.clueCount = 1;
          ui.keyView = v;
          render();
        },
        onStatus: (status) => {
          if (!mine()) return;
          ui.keyStatus = status;
          render();
        },
        onKicked: () => {
          if (!mine()) return;
          ui.keyStatus = 'error';
          render();
        },
      },
    );
    ui.keyConn = conn;
  }

  function keyDisconnect() {
    if (ui.keyConn) ui.keyConn.leave();
    ui.keyConn = null;
    ui.keyView = null;
    ui.keyStatus = null;
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
      stage: stage && stage.state && stage.state.phase !== 'end' && now - (stage.savedAt || 0) < RESUME_MAX_AGE ? stage : null,
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
    if (!prev || prev.turnNo !== v.turnNo || prev.phase !== v.phase) {
      ui.pick = null;
      ui.clueError = null;
      if (!prev || prev.turnNo !== v.turnNo) {
        ui.clueWord = '';
        ui.clueCount = 1;
        ui.stageClue = false;
      }
    }
    if (v.phase !== 'game-over') ui.nextChiefs = null;
    else if (!ui.nextChiefs && v.me.stage) {
      ui.nextChiefs = {};
      for (const t of v.teams) ui.nextChiefs[t.id] = t.nextChief;
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

  /** Sounds, Konfetti und Einblendungen bei Zustandswechseln */
  function transitions(prev, v) {
    const stage = !!v.me.stage;
    const keys = v.settings.input === 'keys';
    // Neue Partie mit Chef-Handys: QR-Code der neuen Schlüsselkarte gleich zeigen
    if (stage && keys && v.secret && v.phase === 'clue' && (!prev || prev.gameNo !== v.gameNo)) {
      ui.modal = 'key-qr';
    }
    if (!prev) return;
    const mine = !stage && v.me.team;
    // Trinkregeln: neue Einträge einblenden
    const lastDrink = prev.drinks.length ? prev.drinks[prev.drinks.length - 1].n : 0;
    const fresh = v.drinks.filter((d) => d.n > lastDrink);
    if (fresh.length && v.settings.drinks !== 'off') showDrinks(fresh, v.settings.drinks);

    if (v.phase === 'end' && prev.phase !== 'end') {
      Sound.fanfare();
      const best = v.teams.slice().sort((a, b) => b.wins - a.wins)[0];
      setTimeout(() => confetti([TEAM_COLOR[best.id], '#ffffff', '#f5c451'], 240), 150);
      return;
    }
    const ev = v.event;
    const pev = prev.event;
    if (ev && (!pev || pev.n !== ev.n)) {
      const t = teamOf(v, ev.team);
      if (ev.kind === 'reveal') {
        Sound.flip();
        const own = ev.owner === ev.team;
        let text;
        if (ev.owner === 'assassin') {
          setTimeout(() => Sound.buzzer(), 250);
          text = `☠️ Der Attentäter! ${t.name} verliert`;
        } else if (own) {
          setTimeout(() => Sound.success(), 250);
          text = ev.end === 'won' ? `🎉 ${t.name} hat alle Agenten gefunden!` : ev.end === 'max' ? '✅ Treffer! Keine Versuche mehr' : '✅ Treffer!';
        } else if (ev.owner === 'neutral') {
          setTimeout(() => Sound.fail(), 250);
          text = '🧍 Unbeteiligt – Zug vorbei';
        } else {
          setTimeout(() => Sound.fail(), 250);
          text = ev.end === 'lost' ? `😱 Letzte Karte für ${teamOf(v, ev.owner).name}!` : `❌ Karte für ${teamOf(v, ev.owner).name} – Zug vorbei`;
        }
        if (stage || mine) flash(text, ev.owner);
        if (mine && navigator.vibrate) navigator.vibrate(own ? 60 : [80, 60, 80]);
      } else if (ev.kind === 'time') {
        Sound.buzzer();
        if (stage || mine) flash(`⏰ Zeit um! ${teamOf(v, otherTeam(ev.team)).name} ist dran`, otherTeam(ev.team));
      } else if (ev.kind === 'pass') {
        Sound.hop();
      }
    }
    if (v.phase === 'game-over' && prev.phase !== 'game-over' && v.result) {
      const win = v.result.winner;
      setTimeout(() => {
        Sound.fanfare();
        confetti([TEAM_COLOR[win], '#ffffff'], 200);
      }, 700);
      return;
    }
    if (v.phase === 'guess' && prev.phase === 'clue') {
      Sound.start();
      if (mine && v.me.team === v.turn && v.me.role === 'operative' && navigator.vibrate) navigator.vibrate(120);
    }
    if (v.phase === 'clue' && prev.turn !== v.turn && mine && v.me.team === v.turn && v.me.role === 'chief' && navigator.vibrate) {
      navigator.vibrate([60, 60, 60]);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Sanduhr                                                             */
  /* ------------------------------------------------------------------ */

  function timerLoop() {
    requestAnimationFrame(timerLoop);
    const els = app.querySelectorAll('[data-timer]');
    if (!els.length) return;
    const elapsed = performance.now() - ui.viewAt;
    for (const el of els) {
      const total = +el.dataset.total || 1;
      const rem = Math.max(0, +el.dataset.rem - elapsed);
      const sec = Math.ceil(rem / 1000);
      const text = el.querySelector('[data-timer-text]');
      const label = sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : String(sec);
      if (text && text.textContent !== label) text.textContent = label;
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
      case 'key':
        html = keyScreenHtml();
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
    if (ui.flash) html += `<div class="flash flash-${ui.flash.team} team-${ui.flash.team}" id="flash-${ui.flash.id}" role="status">${esc(ui.flash.text)}</div>`;
    if (ui.drinkPop) html += drinkPopHtml();
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
      if (el) el.focus();
    }
  }

  /* ---------- Bausteine ---------- */

  function logoHtml(small) {
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="Geheimsache">
      <span class="logo-icon" aria-hidden="true">🔐</span>
      <span class="logo-text"><span class="l1">Geheim</span><span class="l2">sache</span></span>
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

  function matchLabel(m) {
    return m === 0 ? 'Frei' : m === 1 ? '1 Partie' : `Best of ${m}`;
  }

  function settingsHtml(s, scope) {
    return `
      <div class="settings">
        <div class="setting">
          <div class="setting-label"><b>🏁 Partien</b><small>${s.match ? `Wer zuerst ${Math.ceil(s.match / 2)} ${plural(Math.ceil(s.match / 2), 'Partie', 'Partien')} gewinnt` : 'So viele Partien, wie ihr Lust habt'} · Chefs wechseln reihum</small></div>
          ${seg('match', MATCH_OPTIONS, s.match, matchLabel, scope)}
        </div>
        <div class="setting">
          <div class="setting-label"><b>⏳ Sanduhr Chef</b><small>Zeit für den Hinweis – danach ist das andere Team dran</small></div>
          ${seg('chiefSec', TIMER_OPTIONS, s.chiefSec, minutes, scope)}
        </div>
        <div class="setting">
          <div class="setting-label"><b>⏳ Sanduhr Team</b><small>Zeit fürs Raten pro Hinweis</small></div>
          ${seg('teamSec', TIMER_OPTIONS, s.teamSec, minutes, scope)}
        </div>
        <div class="setting">
          <div class="setting-label"><b>🔞 Wörter</b><small>${s.words === 'adult' ? `Pro Partie ${Board.ADULT_PER_GAME} von ${Board.adultWords().length} Wörtern ab 18 (Party, Alkohol, Liebe & Sex)` : `${Board.words().length} normale Wörter`}</small></div>
          ${seg('words', WORD_OPTIONS, s.words, (o) => ({ standard: 'Standard', adult: '+ 18+ 🔞' })[o], scope)}
        </div>
        <div class="setting">
          <div class="setting-label"><b>🍻 Trinkregeln</b><small>${s.drinks === 'free' ? 'Alkoholfrei: Strafpunkte statt Schlucke' : s.drinks === 'on' ? 'Fehler kosten Schlucke – siehe Spielregeln' : 'Normales Spiel'}</small></div>
          ${seg('drinks', DRINK_OPTIONS, s.drinks, (o) => ({ off: 'Aus', on: 'An 🍺', free: 'Alkoholfrei' })[o], scope)}
        </div>
      </div>`;
  }

  function timerHtml(timer, tick) {
    if (!timer) return '';
    const sec = Math.ceil(timer.remaining / 1000);
    return `<div class="timer" data-timer ${tick ? 'data-tick' : ''} data-rem="${Math.round(timer.remaining)}" data-total="${timer.total}">
      <span class="timer-icon" aria-hidden="true">⏳</span>
      <div class="timer-bar"><span data-timer-bar style="width:${(100 * timer.remaining) / (timer.total || 1)}%"></span></div>
      <b data-timer-text>${sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : sec}</b>
    </div>`;
  }

  function clueChipHtml(c) {
    return `<span class="clue-chip"><b>${c.word ? esc(c.word) : '🗣️'}</b><span class="clue-count">${countLabel(c.count)}</span></span>`;
  }

  function guessesLeftHtml(c) {
    if (c.left == null) return '<small class="muted">beliebig viele Versuche</small>';
    return `<small class="muted">noch ${c.left} ${plural(c.left, 'Versuch', 'Versuche')}</small>`;
  }

  /**
   * Das Spielfeld.
   * opts: { act: 'card'|'suggest'|null, pick: idx, mine: idx, compact: bool }
   */
  function boardHtml(v, opts) {
    const o = opts || {};
    const over = v.phase === 'game-over' || v.phase === 'end';
    return `<div class="board ${o.compact ? 'board-compact' : ''} ${over ? 'is-over' : ''}" role="grid">${v.cards
      .map((c, i) => {
        const sugg = v.suggestions[i] || [];
        const cls = [
          'card',
          c.revealed ? 'revealed' : '',
          c.owner ? 'owner-' + c.owner : '',
          c.owner && !c.revealed ? 'is-known' : '',
          o.pick === i ? 'is-picked' : '',
          o.mine === i ? 'is-mine' : '',
          sugg.length ? 'is-suggested' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const clickable = o.act && !c.revealed && !over;
        const by = c.revealed && c.by ? `<small class="card-by">${esc(c.by)}</small>` : '';
        const label = `${c.word}${c.revealed ? ' – ' + ({ rot: 'Rot', blau: 'Blau', neutral: 'unbeteiligt', assassin: 'Attentäter' })[c.owner] : ''}`;
        return `<button class="${cls}" ${clickable ? `data-act="${o.act}" data-idx="${i}"` : 'tabindex="-1"'} aria-label="${esc(label)}" ${clickable ? '' : 'aria-disabled="true"'}>
          ${c.revealed ? `<span class="card-icon" aria-hidden="true">${OWNER_ICON[c.owner]}</span>` : ''}
          <span class="card-word">${esc(c.word)}</span>
          ${by}
          ${sugg.length ? `<span class="card-sugg">👆 ${sugg.map((x) => esc(x.name)).join(', ')}</span>` : ''}
          ${o.pick === i ? '<span class="card-confirm">Aufdecken? Nochmal klicken</span>' : ''}
        </button>`;
      })
      .join('')}</div>`;
  }

  function drinkPopHtml() {
    const d = ui.drinkPop;
    const v = ui.view;
    const lines = d.lines
      .map((x) => {
        const who = x.name || (v ? teamOf(v, x.team).name : x.team);
        const extra = x.reason === 'neutral' && !x.name && v && v.settings.input === 'keys' ? ' (wer getippt hat)' : '';
        return `<li class="team-${x.team}"><span class="team-dot"></span><b>${esc(who)}${extra}:</b> ${drinkUnit(x.amount, d.mode)} ${d.mode === 'free' ? '⚠️' : '🍺'}<small>${esc(DRINK_REASON[x.reason] || '')}</small></li>`;
      })
      .join('');
    return `<div class="drink-pop" id="drink-${d.id}" role="status"><ul>${lines}</ul></div>`;
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
            <small>${INPUT[st.settings.input].label} · ${esc(st.teams.map((t) => t.name).join(' gegen '))}${st.gameNo ? ' · Partie ' + st.gameNo : ''}</small></button>
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
    return `
    <div class="screen home">
      <a class="btn btn-ghost btn-small hub-back" href="../">← Alle Spiele</a>
      <div class="home-hero">
        ${logoHtml()}
        <p class="tagline">Zwei Teams, 25 Wörter, ein Attentäter.<br>Wer findet zuerst alle eigenen Agenten?</p>
      </div>
      ${resume.join('')}
      <div class="mode-cards">${modeCard('keys')}${modeCard('phones')}</div>
      <div class="home-links">
        <button class="btn btn-ghost" data-act="join-screen">📱 Mit dem Handy beitreten</button>
        <button class="btn btn-link" data-act="rules">📖 Spielregeln</button>
      </div>
      <p class="home-foot">${Board.words().length} Wörter + ${Board.adultWords().length} ab 18 · 4–20 Personen in 2 Teams · Laptop als Spielfeld</p>
    </div>`;
  }

  /* ---------- Spiel anlegen (Laptop) ---------- */

  function setupHtml() {
    const s = ui.setup;
    const st = s.settings;
    const keys = st.input === 'keys';
    const inputCard = (id) => `
      <button class="input-card ${st.input === id ? 'on' : ''}" data-act="set" data-key="input" data-value="${id}" data-scope="setup" aria-pressed="${st.input === id}">
        <span class="input-icon">${INPUT[id].icon}</span>
        <b>${INPUT[id].label}</b>
        <small>${INPUT[id].text}</small>
      </button>`;
    const teams = s.teams
      .map((t, ti) => {
        const def = TEAMS[ti];
        const players = keys
          ? `<p class="muted small">Reihenfolge = wer Chef ist (wechselt nach jeder Partie)</p>
            <div class="ts-players">${t.players
              .map(
                (p, pi) => `
              <div class="player-row">
                <span class="player-num">${pi === 0 ? '🕵️' : pi + 1}</span>
                <input class="input" type="text" maxlength="24" placeholder="Spieler ${pi + 1}" value="${esc(p)}"
                  data-field="player-name" data-team="${ti}" data-player="${pi}" autocomplete="off" enterkeyhint="next" />
                ${t.players.length > 2 ? `<button class="icon-btn" data-act="remove-player" data-team="${ti}" data-player="${pi}" aria-label="Spieler entfernen">✕</button>` : ''}
              </div>`
              )
              .join('')}</div>
            ${t.players.length < MAX_PLAYERS ? `<button class="btn btn-small btn-ghost" data-act="add-player" data-team="${ti}">＋ Spieler</button>` : ''}`
          : `<p class="muted small">Die Spieler treten mit dem Handy bei und wählen dort ihr Team.</p>`;
        return `
          <div class="team-setup team-${t.id}">
            <div class="ts-head">
              <span class="team-dot"></span>
              <input class="input input-team" type="text" maxlength="24" placeholder="Team ${def.label}" value="${esc(t.name)}"
                data-field="team-name" data-team="${ti}" autocomplete="off" aria-label="Teamname" />
            </div>
            ${players}
          </div>`;
      })
      .join('');
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
        <div class="input-cards">${inputCard('keys')}${inputCard('phones')}</div>
      </section>
      <section class="panel">
        <h2>Teams <small class="muted">(je mindestens 2: ein Chef + Ermittler:innen)</small></h2>
        <div class="team-grid">${teams}</div>
      </section>
      <section class="panel">
        <h2>Einstellungen</h2>
        ${settingsHtml(st, 'setup')}
      </section>
      <div class="sticky-start">
        <button class="btn btn-primary btn-big" data-act="create-game">${keys ? 'Spiel starten 🔐' : 'Raum öffnen 📱'}</button>
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
      <p class="muted small center">Geheimdienstchef bei „Nur Chef-Handys“? Dann einfach den 🔑-QR-Code am Laptop scannen – ohne Raum-Code.</p>
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

  /* ---------- Schlüsselkarte (Handy der Chefs, ohne Verbindung) ---------- */

  function keyGridHtml(key, opts) {
    const o = opts || {};
    return `<div class="keygrid ${key.words ? '' : 'no-words'}">${key.owners
      .map((owner, i) => {
        const done = o.done && o.done.has(i);
        return `<button class="key-cell owner-${owner} ${done ? 'is-done' : ''}" ${o.toggle ? `data-act="key-toggle" data-idx="${i}"` : 'tabindex="-1"'} aria-label="${esc((key.words ? key.words[i] + ': ' : '') + ({ rot: 'Rot', blau: 'Blau', neutral: 'unbeteiligt', assassin: 'Attentäter' })[owner])}">
          ${key.words ? `<span>${esc(key.words[i])}</span>` : `<span aria-hidden="true">${owner === 'assassin' ? '☠️' : ''}</span>`}
        </button>`;
      })
      .join('')}</div>`;
  }

  function keyLegendHtml(key) {
    const n = (o) => key.owners.filter((x) => x === o).length;
    return `<div class="key-legend">
      <span class="kl owner-rot">Rot ${n('rot')}</span>
      <span class="kl owner-blau">Blau ${n('blau')}</span>
      <span class="kl owner-neutral">Unbeteiligt ${n('neutral')}</span>
      <span class="kl owner-assassin">☠️ Attentäter</span>
    </div>`;
  }

  function keyScreenHtml() {
    const key = Board.decode(ui.keyCode);
    if (!key) {
      return `
      <div class="screen keyscreen">
        <div class="look-up">🔑<b>Diese Schlüsselkarte ist kaputt</b><small>Bitte den QR-Code am Laptop nochmal scannen.</small></div>
        <button class="btn btn-ghost" data-act="key-close">Zur Startseite</button>
      </div>`;
    }
    const starter = key.starter;
    return `
    <div class="screen keyscreen team-${starter}">
      <header class="key-head">
        <div><b>🔑 Schlüsselkarte</b><small>Nur für die Geheimdienstchefs!</small></div>
        <span class="key-starter team-${starter}"><span class="team-dot"></span>${starter === 'rot' ? 'Rot' : 'Blau'} beginnt</span>
      </header>
      ${key.words ? '' : '<div class="alert">Diese Seite ist auf einem anderen Stand als der Laptop – die Wörter fehlen. Seite neu laden und den QR-Code nochmal scannen. Die Farben stimmen trotzdem.</div>'}
      <div class="key-wrap ${ui.keyHidden ? 'is-hidden' : ''}">
        ${keyGridHtml(key, { done: ui.keyDone, toggle: true })}
        ${ui.keyHidden ? '<button class="key-cover" data-act="key-hide">🙈 Verdeckt – antippen zum Zeigen</button>' : ''}
      </div>
      ${keyLegendHtml(key)}
      ${keyClueHtml()}
      <div class="stage-actions">
        <button class="btn btn-ghost btn-small" data-act="key-hide">${ui.keyHidden ? '👀 Zeigen' : '🙈 Verdecken'}</button>
        <button class="btn btn-link" data-act="rules">📖 Regeln</button>
      </div>
      <p class="muted small center">Tippe auf eine Karte, um sie als erledigt zu markieren.<br>Neue Partie? Einfach den neuen QR-Code am Laptop scannen.</p>
    </div>`;
  }

  /** Schlüsselkarte mit Verbindung: „Hinweis gegeben“ für den laut gesagten Hinweis */
  function keyClueHtml() {
    if (!ui.keyRoom) return '';
    const v = ui.keyView;
    const note = (text, retry) =>
      `<div class="key-clue is-note"><small>${text}</small>${retry ? '<button class="btn btn-link btn-small" data-act="key-retry">Nochmal verbinden</button>' : ''}</div>`;
    if (ui.keyStatus === 'error') return note('📴 Keine Verbindung zum Laptop – die Zahl dann einfach am Laptop anklicken.', true);
    if (!v) return note('📡 Verbinde mit dem Laptop …');
    if (v.gameNo !== ui.keyGame || v.phase === 'end') return note('🔄 Am Laptop läuft eine andere Partie – bitte den neuen QR-Code scannen.');
    const t = v.teams.find((x) => x.id === v.turn);
    if (v.phase === 'game-over' || !t) return note('🏁 Partie vorbei – für die nächste den neuen QR-Code scannen.');
    if (v.phase === 'guess') {
      return `<div class="key-clue team-${t.id}"><div class="key-clue-head"><span class="team-dot"></span><b>${esc(t.name)} rät</b>${clueChipHtml(v.clue)}</div></div>`;
    }
    const count = ui.clueCount;
    const offline = ui.keyStatus !== 'online';
    return `
      <div class="key-clue team-${t.id}">
        <div class="key-clue-head"><span class="team-dot"></span><b>${esc(t.name)} ist dran</b><small>🕵️ ${esc(t.chiefName || 'Chef')}</small></div>
        <div class="count-step">
          <span>Anzahl</span>
          <button type="button" class="icon-btn" data-act="clue-step" data-d="-1" aria-label="weniger" ${count === 0 ? 'disabled' : ''}>−</button>
          <b class="count-val">${countLabel(count)}</b>
          <button type="button" class="icon-btn" data-act="clue-step" data-d="1" aria-label="mehr" ${count === UNLIMITED ? 'disabled' : ''}>+</button>
        </div>
        <button class="btn btn-primary btn-big btn-wide" data-act="key-clue" ${offline ? 'disabled' : ''}>🗣️ Hinweis gegeben</button>
        <small class="muted center">${offline ? '📡 Verbindung wird wiederhergestellt …' : 'Hinweis laut sagen, Anzahl einstellen und drücken – dann kann das Team raten.'}</small>
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

  function teamCountHtml(v, id) {
    const t = teamOf(v, id);
    const active = (v.phase === 'clue' || v.phase === 'guess') && v.turn === id;
    return `<div class="tcount team-${id} ${active ? 'is-turn' : ''}">
      <span class="tcount-num">${t.left}</span>
      <span class="tcount-text"><b>${esc(t.name)}</b><small>${t.left === 1 ? 'noch 1 Agent' : `noch ${t.left} Agenten`}${v.need ? ` · ${t.wins}/${v.need} 🏆` : t.wins ? ` · ${t.wins} 🏆` : ''}</small></span>
    </div>`;
  }

  function stageHeadHtml(v) {
    const playing = v.phase !== 'lobby' && v.phase !== 'end';
    return `
      <header class="gs-top">
        ${playing ? teamCountHtml(v, 'rot') : '<span></span>'}
        <button class="gs-brand" data-act="menu" aria-label="Menü">${logoHtml(true)}<small>${v.phase === 'lobby' ? 'Lobby' : v.phase === 'end' ? 'Abschluss' : `Partie ${v.gameNo}`}</small></button>
        ${playing ? teamCountHtml(v, 'blau') : '<span></span>'}
        <div class="gs-actions">
          <button class="icon-btn" data-act="mute" aria-label="Ton an/aus" title="Ton an/aus">${Sound.muted ? '🔇' : '🔊'}</button>
          <button class="icon-btn" data-act="menu" aria-label="Menü" title="Menü">☰</button>
        </div>
      </header>`;
  }

  function stageHtml(v) {
    let main;
    if (v.phase === 'lobby') main = lobbyStageHtml(v);
    else if (v.phase === 'end') main = endHtml(v);
    else main = playStageHtml(v);
    return `
      <div class="stage phase-${v.phase}">
        ${stageHeadHtml(v)}
        <main class="stage-main">${main}</main>
        ${v.phase === 'clue' || v.phase === 'guess' || v.phase === 'game-over' ? stageFootHtml(v) : ''}
      </div>`;
  }

  /* ---------- Lobby (Alle mit Handy) ---------- */

  function lobbyStageHtml(v) {
    const chip = (m, t) => {
      const chief = t && t.chief === m.id;
      return `<span class="chip ${m.online ? '' : 'is-offline'} ${chief ? 'is-chief' : ''}">
        ${t ? `<button class="chip-chief" data-act="set-chief" data-player="${esc(m.id)}" title="${chief ? 'Geheimdienstchef' : 'Zum Chef machen'}" aria-label="${esc(m.name)} zum Chef machen">${chief ? '🕵️' : '👤'}</button>` : ''}
        ${esc(m.name)}<button class="chip-x" data-act="kick" data-player="${esc(m.id)}" aria-label="${esc(m.name)} entfernen">✕</button></span>`;
    };
    const teams = v.teams
      .map((t) => {
        const members = t.players.map((p) => v.members.find((m) => m.id === p.id) || { id: p.id, name: p.name, online: false });
        return `
          <div class="team-setup team-${t.id}">
            <div class="ts-head">
              <span class="team-dot"></span>
              <input class="input input-team" type="text" maxlength="24" value="${esc(t.name)}" data-field="lobby-team-name" data-team="${t.id}" aria-label="Teamname" />
            </div>
            <div class="chips">${members.length ? members.map((m) => chip(m, t)).join('') : '<span class="muted">Noch niemand – auf dem Handy dieses Team wählen</span>'}</div>
          </div>`;
      })
      .join('');
    const free = v.members.filter((m) => !m.team);
    return `
      <div class="lobby-grid">
        <section class="panel join-panel">
          <h2>📱 Handys verbinden</h2>
          <p class="muted">QR-Code scannen, Namen eingeben, Team wählen.</p>
          ${roomBoxHtml(v.room, true)}
        </section>
        <div class="lobby-side">
          <section class="panel">
            <h2>Teams <small class="muted">🕵️ = Geheimdienstchef (antippen zum Ändern)</small></h2>
            <div class="team-grid">${teams}</div>
            ${free.length ? `<div class="free"><b>Noch ohne Team:</b> <div class="chips">${free.map((m) => chip(m, null)).join('')}</div></div>` : ''}
          </section>
          <section class="panel">
            <h2>Einstellungen</h2>
            ${settingsHtml(v.settings, 'lobby')}
          </section>
          <div class="sticky-start">
            <button class="btn btn-primary btn-big" data-act="start" ${v.lobbyProblem ? 'disabled' : ''}>Spiel starten 🔐</button>
            ${v.lobbyProblem ? `<p class="muted small center">${esc(v.lobbyProblem)}</p>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ---------- Spielfeld ---------- */

  function turnBarHtml(v) {
    if (v.phase === 'game-over') return resultBarHtml(v);
    const t = teamOf(v, v.turn);
    const keys = v.settings.input === 'keys';
    if (v.phase === 'clue') {
      const showForm = keys || ui.stageClue;
      return `
        <section class="turn team-${t.id}">
          <div class="turn-line">
            <span class="team-dot"></span>
            <div class="turn-text"><span class="turn-head"><b>${esc(t.name)}</b> ist dran</span><small>🕵️ ${esc(t.chiefName || 'Chef')} überlegt sich einen Hinweis …</small></div>
            ${timerHtml(v.timer, true)}
          </div>
          ${
            showForm
              ? stageClueFormHtml(v)
              : `<div class="turn-tools"><button class="btn btn-link btn-small" data-act="stage-clue">Hinweis am Laptop eintragen</button></div>`
          }
        </section>`;
    }
    const c = v.clue;
    return `
      <section class="turn team-${t.id}">
        <div class="turn-line">
          <span class="team-dot"></span>
          <div class="turn-text"><span class="turn-head"><b>${esc(t.name)}</b> rät</span><small>${c.guesses ? `${c.found} ${plural(c.found, 'Treffer', 'Treffer')} bisher` : 'Karte anklicken, nochmal klicken = aufdecken'}</small></div>
          <div class="turn-clue">${clueChipHtml(c)}${guessesLeftHtml(c)}</div>
          ${timerHtml(v.timer, true)}
          <button class="btn btn-ghost btn-small" data-act="end-turn">⏭ Zug beenden</button>
        </div>
      </section>`;
  }

  function stageClueFormHtml(v) {
    const counts = [];
    for (let n = 0; n <= MAX_COUNT; n++) counts.push(n);
    counts.push(UNLIMITED);
    return `
      <form class="stage-clue" data-form="stage-clue">
        <input class="input" type="text" maxlength="${MAX_WORD}" placeholder="Hinweis-Wort (freiwillig)" value="${esc(ui.clueWord)}" data-field="clue-word" autocomplete="off" spellcheck="false" />
        <div class="count-pad" role="group" aria-label="Anzahl">
          ${counts.map((n) => `<button type="button" class="count-btn" data-act="stage-count" data-count="${n}">${countLabel(n)}</button>`).join('')}
        </div>
        ${ui.clueError ? `<div class="word-error">${esc(ui.clueError)}</div>` : ''}
        <small class="muted">Sobald der Chef seinen Hinweis gesagt hat: Zahl anklicken (oder Taste 0–9). <button type="button" class="btn btn-link btn-small" data-act="skip-turn">Zug abgeben</button></small>
      </form>`;
  }

  function resultBarHtml(v) {
    const r = v.result;
    const w = teamOf(v, r.winner);
    const l = teamOf(v, r.loser);
    const why =
      r.reason === 'assassin'
        ? `☠️ ${esc(r.assassin && r.assassin.name ? r.assassin.name + ' (' + l.name + ')' : l.name)} hat den Attentäter erwischt`
        : `Alle ${w.total} Agenten gefunden${l.left ? ` – ${esc(l.name)} fehlten noch ${l.left}` : ''}`;
    const champion = v.matchWinner ? teamOf(v, v.matchWinner) : null;
    return `
      <section class="turn result team-${w.id}">
        <div class="turn-line">
          <span class="result-icon">🏆</span>
          <div class="turn-text"><span class="turn-head"><b>${esc(w.name)}</b> gewinnt Partie ${v.gameNo}!</span><small>${why}</small></div>
          <div class="match-score">${v.teams.map((t) => `<span class="team-${t.id}"><span class="team-dot"></span>${t.wins}</span>`).join('<i>:</i>')}</div>
        </div>
        ${champion ? `<p class="champion">🎉 <b>${esc(champion.name)}</b> hat ${v.need} ${plural(v.need, 'Partie', 'Partien')} gewonnen!</p>` : nextChiefsHtml(v)}
        <div class="stage-actions">
          ${
            champion
              ? `<button class="btn btn-primary btn-big" data-act="finish">🏆 Zur Siegerehrung</button>`
              : `<button class="btn btn-primary btn-big" data-act="next-game" data-game="${v.gameNo}">Nächste Partie →</button>
                 <button class="btn btn-ghost" data-act="finish-ask">🏁 Abend beenden</button>`
          }
        </div>
      </section>`;
  }

  function nextChiefsHtml(v) {
    const chosen = ui.nextChiefs || {};
    const rows = v.teams
      .map((t) => {
        const players = t.players.filter((p) => p.online || p.id === chosen[t.id]);
        return `<div class="next-chief team-${t.id}"><span class="team-dot"></span><b>${esc(t.name)}:</b>
          <div class="chips">${players
            .map(
              (p) =>
                `<button class="chip chip-pick ${chosen[t.id] === p.id ? 'is-chief' : ''}" data-act="pick-chief" data-team="${t.id}" data-player="${esc(p.id)}" aria-pressed="${chosen[t.id] === p.id}">${chosen[t.id] === p.id ? '🕵️ ' : ''}${esc(p.name)}</button>`
            )
            .join('')}</div></div>`;
      })
      .join('');
    return `<div class="next-chiefs"><small class="muted">Geheimdienstchefs der nächsten Partie (reihum vorgeschlagen):</small>${rows}</div>`;
  }

  function playStageHtml(v) {
    const guess = v.phase === 'guess';
    return `
      <div class="play">
        ${turnBarHtml(v)}
        ${boardHtml(v, { act: guess ? 'card' : null, pick: guess ? ui.pick : null })}
      </div>`;
  }

  function stageFootHtml(v) {
    const keys = v.settings.input === 'keys';
    const drinks = v.settings.drinks !== 'off';
    const chiefs = v.teams.map((t) => `<span class="team-${t.id}"><span class="team-dot"></span>🕵️ ${esc(t.chiefName || '–')}</span>`).join('');
    const score = `<span class="foot-score">${v.need ? `Best of ${v.settings.match}: ` : 'Partien: '}${v.teams
      .map((t) => `<b class="team-${t.id}">${t.wins}</b>`)
      .join(' : ')}</span>`;
    const drinkInfo = drinks
      ? `<span class="foot-drinks" title="${v.settings.drinks === 'free' ? 'Strafpunkte' : 'Schlucke'}">${v.settings.drinks === 'free' ? '⚠️' : '🍺'} ${v.teams
          .map((t) => `<b class="team-${t.id}">${t.drinks + t.players.reduce((n, p) => n + p.drinks, 0)}</b>`)
          .join(' : ')}</span>`
      : '';
    return `
      <footer class="gs-foot">
        <div class="foot-left">${score}${drinkInfo}</div>
        <div class="foot-chiefs">${chiefs}</div>
        <div class="foot-right">
          ${
            keys
              ? `<button class="btn btn-primary btn-small" data-act="show-key">🔑 Schlüssel für Chefs</button>`
              : v.room && v.room.code
                ? `<button class="btn btn-ghost btn-small pill-room" data-act="show-qr">📱 ${esc(v.room.code)}</button>`
                : ''
          }
        </div>
      </footer>`;
  }

  /* ---------- Abschluss ---------- */

  function endHtml(v) {
    const sorted = v.teams.slice().sort((a, b) => b.wins - a.wins);
    const tie = sorted[0].wins === sorted[1].wins;
    const awards = (v.awards || [])
      .map((a) => `<div class="award"><span class="award-icon">${a.icon}</span><div><b>${esc(a.title)}</b><small>${esc(a.text)}</small></div></div>`)
      .join('');
    const games = v.games
      .map(
        (g) =>
          `<li class="team-${g.winner}"><span class="team-dot"></span>Partie ${g.game}: <b>${esc(teamOf(v, g.winner).name)}</b> ${g.reason === 'assassin' ? '<small>(Attentäter)</small>' : ''}</li>`
      )
      .join('');
    let drinks = '';
    if (v.settings.drinks !== 'off') {
      const rows = v.teams
        .map((t) => {
          const players = t.players.filter((p) => p.drinks).map((p) => `${esc(p.name)} ${p.drinks}`);
          return `<li class="team-${t.id}"><span class="team-dot"></span><b>${esc(t.name)}:</b> ${drinkUnit(t.drinks, v.settings.drinks)} fürs Team${players.length ? ` <small>+ ${players.join(', ')}</small>` : ''}</li>`;
        })
        .join('');
      drinks = `<section class="panel end-panel"><h2>${v.settings.drinks === 'free' ? '⚠️ Strafpunkte' : '🍻 Schlucke'}</h2><ul class="end-list">${rows}</ul></section>`;
    }
    return `
      <div class="center-stage over">
        <h1 class="over-title">${!v.games.length ? '🔐 Abend beendet' : tie ? `🤝 Unentschieden ${sorted[0].wins} : ${sorted[1].wins}` : `🏆 ${esc(sorted[0].name)} gewinnt ${sorted[0].wins} : ${sorted[1].wins}!`}</h1>
        <div class="end-grid">
          ${games ? `<section class="panel end-panel"><h2>Partien</h2><ul class="end-list">${games}</ul></section>` : ''}
          ${drinks}
        </div>
        ${awards ? `<div class="awards">${awards}</div>` : ''}
        <div class="stage-actions">
          <button class="btn btn-primary btn-big" data-act="again">🔁 Neuer Abend</button>
          <button class="btn btn-ghost" data-act="home">Hauptmenü</button>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Handy (Alle mit Handy)                                              */
  /* ------------------------------------------------------------------ */

  function phoneStatusBanner() {
    if (ui.status === 'reconnecting' || ui.status === 'connecting') {
      return `<div class="status-banner"><span class="spinner-sm"></span> Verbindung zum Laptop unterbrochen – verbinde neu…</div>`;
    }
    return '';
  }

  function playerHtml(v) {
    const me = v.me;
    const t = me.team ? teamOf(v, me.team) : null;
    let body;
    if (v.phase === 'lobby') body = phoneLobbyHtml(v);
    else if (v.phase === 'end') body = phoneEndHtml(v);
    else if (!t) body = phoneSpectatorHtml(v);
    else if (v.phase === 'game-over') body = phoneGameOverHtml(v, t);
    else if (me.role === 'chief') body = phoneChiefHtml(v, t);
    else body = phoneOperativeHtml(v, t);
    const role = me.role === 'chief' ? '🕵️ Chef' : me.role === 'operative' ? '🔎 Ermittler:in' : '';
    return `
      <div class="phone ${t ? 'team-' + t.id : ''} role-${me.role || 'none'}">
        <header class="phone-head">
          <span class="team-dot"></span>
          <b>${t ? esc(t.name) : 'Ohne Team'}</b>
          ${role && v.phase !== 'lobby' ? `<span class="role-badge">${role}</span>` : ''}
          <span class="phone-name">${esc(me.name)}</span>
          <button class="icon-btn" data-act="menu" aria-label="Menü">☰</button>
        </header>
        ${phoneStatusBanner()}
        <main class="phone-main">${body}</main>
      </div>`;
  }

  function phoneLobbyHtml(v) {
    const myTeam = v.me.team ? teamOf(v, v.me.team) : null;
    return `
      <h2 class="phone-title">Wähle dein Team</h2>
      <div class="team-pick">
        ${v.teams
          .map(
            (t) => `
          <button class="team-btn team-${t.id} ${v.me.team === t.id ? 'is-mine' : ''}" data-act="join-team" data-team="${t.id}" aria-pressed="${v.me.team === t.id}">
            <b>${esc(t.name)} ${v.me.team === t.id ? '✓' : ''}</b>
            <small>${t.players.length ? t.players.map((p) => (p.id === t.chief ? '🕵️ ' : '') + esc(p.name)).join(' · ') : 'noch leer'}</small>
          </button>`
          )
          .join('')}
      </div>
      ${
        myTeam
          ? myTeam.chief === v.me.id
            ? '<p class="waiting">🕵️ Du bist Geheimdienstchef!</p><p class="muted small center">Du siehst die Schlüsselkarte und gibst die Hinweise.</p>'
            : `<button class="btn btn-ghost btn-wide" data-act="become-chief">🕵️ Ich will Chef sein</button>`
          : ''
      }
      <p class="waiting">${v.me.team ? '⏳ Warte, bis es am Laptop losgeht…' : 'Tippe auf ein Team.'}</p>`;
  }

  function phoneSpectatorHtml(v) {
    return `
      <div class="look-up">👀<b>Schau auf den Laptop!</b><small>Du schaust gerade zu.</small></div>
      ${
        v.phase !== 'end'
          ? `<p class="center">Einem Team beitreten (als Ermittler:in):</p>
             <div class="team-pick">${v.teams.map((x) => `<button class="team-btn team-${x.id}" data-act="join-team" data-team="${x.id}"><b>${esc(x.name)}</b></button>`).join('')}</div>`
          : ''
      }`;
  }

  /** Zeile oben auf dem Handy: wer ist dran, welcher Hinweis */
  function phoneTurnHtml(v, t) {
    const turn = teamOf(v, v.turn);
    const ours = v.turn === t.id;
    if (v.phase === 'clue') {
      return `<div class="phone-turn team-${turn.id}"><span class="team-dot"></span><div><b>${ours ? 'Ihr seid dran' : esc(turn.name) + ' ist dran'}</b><small>🕵️ ${esc(turn.chiefName || 'Chef')} überlegt …</small></div>${timerHtml(v.timer, ours)}</div>`;
    }
    return `<div class="phone-turn team-${turn.id}"><span class="team-dot"></span><div><b>${ours ? 'Ihr ratet' : esc(turn.name) + ' rät'}</b>${guessesLeftHtml(v.clue)}</div>${clueChipHtml(v.clue)}${timerHtml(v.timer, ours)}</div>`;
  }

  function phoneChiefHtml(v, t) {
    const ours = v.turn === t.id;
    let form = '';
    if (ours && v.phase === 'clue') {
      const word = ui.clueWord.trim();
      const problem = word ? Board.clueProblem(word, v.cards.filter((c) => !c.revealed).map((c) => c.word)) : null;
      const err = problem
        ? problem.reason === 'same'
          ? `⚠️ „${problem.word}“ liegt auf dem Feld – geht nicht`
          : `⚠️ Steckt in „${problem.word}“ auf dem Feld – geht nicht`
        : ui.clueError;
      const count = ui.clueCount;
      form = `
        <form class="clue-form" data-form="clue">
          <label class="label" for="clue-input">Dein Hinweis</label>
          <input id="clue-input" class="input input-word" type="text" maxlength="${MAX_WORD}" placeholder="ein Wort" value="${esc(ui.clueWord)}" data-field="clue-word" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done" />
          <div class="count-step">
            <span>Anzahl</span>
            <button type="button" class="icon-btn" data-act="clue-step" data-d="-1" aria-label="weniger" ${count === 0 ? 'disabled' : ''}>−</button>
            <b class="count-val">${countLabel(count)}</b>
            <button type="button" class="icon-btn" data-act="clue-step" data-d="1" aria-label="mehr" ${count === UNLIMITED ? 'disabled' : ''}>+</button>
          </div>
          ${err ? `<div class="word-error">${esc(err)}</div>` : ''}
          <button class="btn btn-primary btn-big btn-wide" type="submit" ${!word || problem ? 'disabled' : ''}>Hinweis geben ✓</button>
          <div class="clue-or"><span>oder laut am Tisch gesagt?</span></div>
          <button type="button" class="btn btn-ghost btn-big btn-wide" data-act="clue-spoken">🗣️ Hinweis gegeben</button>
          <small class="muted center">Laut gesagt: nur die Anzahl einstellen und „Hinweis gegeben“ drücken.<br />„0“ = keine Karte passt (unbegrenzt raten) · „∞“ = beliebig viele</small>
        </form>`;
    } else if (ours && v.phase === 'guess') {
      form = '<p class="waiting">🔎 Dein Team rät – Pokerface! 😶</p>';
    }
    return `
      ${phoneTurnHtml(v, t)}
      ${form}
      ${boardHtml(v, { compact: true })}
      ${keyLegendHtml({ owners: v.cards.map((c) => c.owner) })}`;
  }

  function phoneOperativeHtml(v, t) {
    const ours = v.turn === t.id;
    const guessing = ours && v.phase === 'guess';
    const mine = v.me.suggestion;
    const card = mine != null ? v.cards[mine] : null;
    const actions = guessing
      ? `<div class="phone-actions">
          <button class="btn btn-primary btn-big" data-act="reveal-mine" ${card && !card.revealed ? '' : 'disabled'}>${card ? `Aufdecken: ${esc(card.word)}` : 'Karte antippen …'}</button>
          <button class="btn btn-ghost" data-act="end-turn" ${v.clue.guesses ? '' : 'disabled'}>⏭ Zug beenden</button>
        </div>`
      : '';
    return `
      ${phoneTurnHtml(v, t)}
      ${guessing ? '<p class="muted small center">Antippen = vorschlagen (alle sehen es). Aufdecken mit dem Knopf unten.</p>' : ours ? '' : '<p class="muted small center">Die anderen sind dran – schaut mal, was sie vorhaben 👀</p>'}
      ${boardHtml(v, { compact: true, act: guessing ? 'suggest' : null, mine })}
      ${actions}`;
  }

  function phoneGameOverHtml(v, t) {
    const r = v.result;
    const won = r.winner === t.id;
    return `
      <div class="look-up ${won ? 'win' : ''}">${won ? '🏆' : r.reason === 'assassin' ? '☠️' : '😿'}<b>${won ? 'Gewonnen!' : 'Verloren'}</b><small>Partie ${v.gameNo} · ${v.teams.map((x) => `${esc(x.name)} ${x.wins}`).join(' : ')}</small></div>
      ${boardHtml(v, { compact: true })}
      <p class="muted small center">Am Laptop geht es mit der nächsten Partie weiter.</p>`;
  }

  function phoneEndHtml(v) {
    const mine = v.me.team ? teamOf(v, v.me.team) : null;
    const other = mine ? teamOf(v, otherTeam(mine.id)) : null;
    let head = '<div class="look-up">🏁<b>Abend vorbei!</b></div>';
    if (mine) {
      head =
        mine.wins > other.wins
          ? `<div class="look-up win">🏆<b>Ihr habt gewonnen!</b><small>${mine.wins} : ${other.wins}</small></div>`
          : mine.wins === other.wins
            ? `<div class="look-up">🤝<b>Unentschieden</b><small>${mine.wins} : ${other.wins}</small></div>`
            : `<div class="look-up">😿<b>Knapp daneben</b><small>${mine.wins} : ${other.wins}</small></div>`;
    }
    const awards = (v.awards || [])
      .map((a) => `<div class="award"><span class="award-icon">${a.icon}</span><div><b>${esc(a.title)}</b><small>${esc(a.text)}</small></div></div>`)
      .join('');
    return `${head}${awards ? `<div class="awards">${awards}</div>` : ''}<p class="muted small center">Am Laptop kann ein neuer Abend gestartet werden.</p>`;
  }

  /* ------------------------------------------------------------------ */
  /* Dialoge                                                             */
  /* ------------------------------------------------------------------ */

  function modalHtml() {
    if (!ui.modal) return '';
    const v = ui.view;
    let body = '';
    if (ui.modal === 'rules') body = rulesHtml();
    else if (ui.modal === 'menu') body = menuHtml();
    else if (ui.modal === 'qr') {
      body = `<h2>📱 Mitspieler einladen</h2>${roomBoxHtml(v && v.room, false)}
        <p class="muted small center">Wer jetzt beitritt, wählt ein Team und spielt als Ermittler:in mit.</p>
        <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig</button></div>`;
    } else if (ui.modal === 'key-qr' && v && v.secret) {
      body = `<h2>🔑 Schlüsselkarte für die Chefs</h2>
        <p>Nur die beiden Geheimdienstchefs scannen diesen Code – <b>alle anderen schauen weg!</b></p>
        <div class="qr qr-big qr-key">${qrSvg(keyLink(v.secret, v.room && v.room.state === 'online' ? v.room.code : null, v.gameNo))}</div>
        <p class="muted small center">Partie ${v.gameNo} · ${v.teams.map((t) => `🕵️ ${esc(t.chiefName)} (${esc(t.name)})`).join(' · ')}<br>
          ${
            v.room && v.room.state === 'online'
              ? 'Hinweis laut sagen und auf dem Handy „Hinweis gegeben“ drücken – oder die Zahl hier am Laptop anklicken.'
              : 'Klappt auch ohne Internet, wenn die Seite auf dem Handy schon einmal geladen war.'
          }</p>
        <div class="modal-actions">
          <button class="btn btn-link" data-act="key-on-stage">Kein Handy? Schlüssel hier zeigen</button>
          <button class="btn btn-primary" data-act="close-modal">Fertig – los geht's!</button>
        </div>`;
    } else if (ui.modal === 'key-show' && v && v.secret) {
      const key = Board.decode(v.secret);
      body = `<h2>🔑 Schlüsselkarte</h2>
        <p class="muted small">Nur die Chefs schauen hin! Startteam: <b>${key.starter === 'rot' ? 'Rot' : 'Blau'}</b></p>
        ${keyGridHtml({ owners: key.owners, words: v.cards.map((c) => c.word) })}
        ${keyLegendHtml(key)}
        <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">🙈 Verbergen</button></div>`;
    } else if (ui.modal === 'settings' && v) {
      body = `<h2>⚙️ Einstellungen</h2>${settingsHtml(v.settings, 'lobby')}
        <p class="muted small">Gilt ab sofort; die Spielweise bleibt.</p>
        <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig</button></div>`;
    } else if (ui.modal === 'confirm' && ui.confirm) {
      body = `
        <h2>${esc(ui.confirm.title)}</h2>
        <p>${esc(ui.confirm.text)}</p>
        <div class="modal-actions">
          <button class="btn ${ui.confirm.danger ? 'btn-danger' : 'btn-primary'}" data-act="confirm-yes">${esc(ui.confirm.yes)}</button>
          <button class="btn btn-ghost" data-act="close-modal">Abbrechen</button>
        </div>`;
    } else return '';
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
        <p>Zwei Teams (🔴 Rot, 🔵 Blau), je ein <b>Geheimdienstchef</b> und Ermittler:innen. Auf dem Tisch – dem Laptop – liegen
          <b>25 Wörter</b>. Nur die Chefs kennen die Schlüsselkarte: <b>9</b> Karten gehören dem Startteam, <b>8</b> dem anderen Team,
          <b>7</b> sind Unbeteiligte und <b>1</b> ist der ☠️ <b>Attentäter</b>.</p>
        <h3>Ein Zug</h3>
        <p>Der Chef des Teams am Zug gibt einen Hinweis: <b>ein Wort und eine Zahl</b>, z.B. „Wasser, 3“. Das Wort darf nicht offen
          auf dem Feld liegen und kein Teil eines Feld-Wortes sein (nicht „Schlosspark“, wenn „Schloss“ daliegt).
          Sonst darf der Chef nichts sagen – kein Zwinkern, kein Stöhnen 😶.</p>
        <p>Das Team deckt nacheinander Karten auf – höchstens <b>Zahl + 1</b>:</p>
        <ul>
          <li><b>Eigene Farbe</b> → weiterraten oder freiwillig aufhören (mindestens eine Karte pro Zug)</li>
          <li><b>Unbeteiligt</b> → Zug vorbei</li>
          <li><b>Gegnerfarbe</b> → Zug vorbei, die Karte zählt für den Gegner</li>
          <li><b>☠️ Attentäter</b> → das Team verliert sofort</li>
        </ul>
        <p>Gewonnen hat, wer <b>zuerst alle eigenen Karten</b> aufgedeckt hat – auch wenn der Gegner die letzte erwischt.</p>
        <p><b>„0“</b>: keine Karte passt zu diesem Wort – unbegrenzt raten. <b>„∞“</b>: beliebig viele Karten, auch zu früheren Hinweisen.</p>
        <h3>📲 Nur Chef-Handys</h3>
        <p>Die Chefs scannen den 🔑-QR-Code am Laptop und sehen die Schlüsselkarte auf dem Handy – ohne Raum, auch ohne Internet.
          Sobald der Chef seinen Hinweis gesagt hat, wird am Laptop die Zahl angeklickt. Karten werden am Laptop angeklickt
          (zweimal = aufdecken). Nach jeder Partie gibt es einen neuen Code.</p>
        <h3>📱 Alle mit Handy</h3>
        <p>Der Chef tippt den Hinweis ins Handy (verbotene Wörter werden abgelehnt), er erscheint groß auf dem Laptop.
          Ermittler:innen tippen Karten an, um sie vorzuschlagen – alle sehen, wer was meint – und decken mit dem Knopf auf.</p>
        <h3>🏁 Partien</h3>
        <p>Eine Partie dauert ca. 10–15 Minuten. Nach jeder Partie wechseln die Chefs reihum. Optional mit Sanduhr:
          Ist die Zeit des Chefs oder des Teams um, ist das andere Team dran.</p>
        <h3>🍻 Trinkregeln (optional)</h3>
        <ul>
          <li>Unbeteiligte erwischt: wer sie angetippt hat, ${DRINKS.neutral} Schluck</li>
          <li>Gegnerkarte erwischt: ganzes Team ${DRINKS.opponent} Schluck</li>
          <li>☠️ Attentäter: ganzes Team ${DRINKS.assassin} Schlucke</li>
          <li>Hinweis für 3+ Karten komplett gelöst: Gegnerteam ${DRINKS.clue} Schluck</li>
          <li>Partie verloren: ${DRINKS.lost} Schluck pro übriger eigener Karte</li>
        </ul>
        <p class="muted small">Alkoholfrei-Variante: Strafpunkte statt Schlucke. Trinkt verantwortungsvoll – Wasser zählt auch. 💧</p>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Alles klar!</button></div>`;
  }

  function menuHtml() {
    const v = ui.view;
    const items = [];
    items.push(`<button class="menu-item" data-act="rules">📖 Spielregeln</button>`);
    items.push(`<button class="menu-item" data-act="mute">${Sound.muted ? '🔊 Ton einschalten' : '🔇 Ton ausschalten'}</button>`);
    if (v && v.me.stage) {
      const keys = v.settings.input === 'keys';
      const playing = v.phase === 'clue' || v.phase === 'guess';
      if (keys && v.secret && v.phase !== 'end') items.push(`<button class="menu-item" data-act="show-key">🔑 Schlüssel-QR für die Chefs</button>`);
      if (!keys && v.room) items.push(`<button class="menu-item" data-act="show-qr">📱 Mitspieler einladen</button>`);
      if (playing) items.push(`<button class="menu-item" data-act="change-chief">🕵️ Chef wechseln <small>(z.B. wenn ein Handy ausfällt)</small></button>`);
      if (v.phase === 'clue') items.push(`<button class="menu-item" data-act="skip-turn">⏭ Zug abgeben <small>(ohne Hinweis)</small></button>`);
      if (v.phase === 'game-over') items.push(`<button class="menu-item" data-act="settings">⚙️ Einstellungen</button>`);
      items.push(`<button class="menu-item" data-act="home-keep">🏠 Hauptmenü <small>(Spiel bleibt gespeichert)</small></button>`);
      if (v.phase !== 'lobby' && v.phase !== 'end') items.push(`<button class="menu-item danger" data-act="finish-ask">🏁 Abend beenden & Abschluss zeigen</button>`);
      items.push(`<button class="menu-item danger" data-act="close-game">🚪 Spiel schließen</button>`);
    } else if (v) {
      if (v.phase === 'lobby' && v.me.team) items.push(`<button class="menu-item" data-act="join-team" data-team="">↩️ Team verlassen</button>`);
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

  function createGame() {
    const s = ui.setup;
    ui.error = null;
    const state = Engine.create({ settings: s.settings, teams: s.teams });
    Sound.unlock();
    startStage({ state });
  }

  /** Laptop: Hinweis eintragen (Zahl angeklickt) */
  function stageClue(count) {
    const v = ui.view;
    if (!v || v.phase !== 'clue') return;
    const input = app.querySelector('[data-field="clue-word"]');
    const word = (input ? input.value : ui.clueWord).trim();
    if (word) {
      const problem = Board.clueProblem(word, v.cards.filter((c) => !c.revealed).map((c) => c.word));
      if (problem) {
        ui.clueError =
          problem.reason === 'same'
            ? `„${problem.word}“ liegt auf dem Feld – dieser Hinweis ist nicht erlaubt!`
            : `„${word}“ steckt in „${problem.word}“ (oder umgekehrt) – dieser Hinweis ist nicht erlaubt!`;
        Sound.fail();
        render();
        return;
      }
    }
    if (input) input.blur();
    dispatch('clue', { word, count, at: v.turnNo });
  }

  function revealCard(idx) {
    const v = ui.view;
    if (!v) return;
    dispatch('reveal', { idx, at: v.turnNo });
    ui.pick = null;
  }

  const actions = {
    home: () => goHome(false),
    'home-keep': () => goHome(true),
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
    settings: () => {
      ui.modal = 'settings';
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
    'show-key': () => {
      ui.modal = 'key-qr';
      render();
    },
    'key-on-stage': () =>
      askConfirm({
        title: '🙈 Alle wegschauen!',
        text: 'Die Schlüsselkarte erscheint jetzt auf dem Laptop. Nur die beiden Geheimdienstchefs dürfen hinsehen.',
        yes: 'Zeigen',
        run: () => {
          ui.modal = 'key-show';
        },
      }),
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
    'finish-ask': () =>
      askConfirm({
        title: 'Abend beenden?',
        text: 'Es geht zum Abschluss mit Gesamtstand und Auszeichnungen. Eine laufende Partie zählt nicht mehr.',
        yes: 'Beenden',
        danger: true,
        run: () => dispatch('finish'),
      }),
    finish: () => dispatch('finish'),

    /* Setup */
    set: (el) => {
      const key = el.dataset.key;
      let value = el.dataset.value;
      if (['match', 'chiefSec', 'teamSec'].includes(key)) value = +value;
      setSetting(el.dataset.scope, key, value);
    },
    'add-player': (el) => {
      const t = ui.setup.teams[+el.dataset.team];
      if (t.players.length >= MAX_PLAYERS) return;
      t.players.push('');
      saveSetup();
      ui.focus = `[data-field="player-name"][data-team="${el.dataset.team}"][data-player="${t.players.length - 1}"]`;
      render();
    },
    'remove-player': (el) => {
      const t = ui.setup.teams[+el.dataset.team];
      if (t.players.length <= 2) return;
      t.players.splice(+el.dataset.player, 1);
      saveSetup();
      render();
    },
    'create-game': createGame,

    /* Lobby */
    kick: (el) => dispatch('kick', { player: el.dataset.player }),
    'set-chief': (el) => dispatch('setChief', { player: el.dataset.player }),
    start: () => dispatch('start'),
    'join-team': (el) => {
      ui.modal = null;
      dispatch('joinTeam', { team: el.dataset.team || null });
    },
    'become-chief': () => dispatch('setChief'),

    /* Spiel – Laptop */
    'stage-clue': () => {
      ui.stageClue = true;
      ui.focus = '[data-field="clue-word"]';
      render();
    },
    'stage-count': (el) => stageClue(el.dataset.count === UNLIMITED ? UNLIMITED : +el.dataset.count),
    card: (el) => {
      const idx = +el.dataset.idx;
      if (ui.pick === idx) revealCard(idx);
      else {
        ui.pick = idx;
        render();
      }
    },
    'end-turn': () => {
      const v = ui.view;
      if (v) dispatch('endTurn', { at: v.turnNo });
    },
    'skip-turn': () => {
      const v = ui.view;
      if (!v) return;
      askConfirm({
        title: 'Zug abgeben?',
        text: `${teamOf(v, v.turn).name} gibt keinen Hinweis – das andere Team ist dran.`,
        yes: 'Abgeben',
        run: () => dispatch('skipTurn', { at: v.turnNo }),
      });
    },
    'change-chief': () => {
      const v = ui.view;
      if (!v) return;
      ui.nextChiefs = null;
      ui.modal = null;
      // Einfach: im Team am Zug reihum zum nächsten Spieler wechseln
      const t = teamOf(v, v.turn);
      const list = t.players.filter((p) => p.online);
      const i = list.findIndex((p) => p.id === t.chief);
      const next = list[(i + 1) % list.length];
      if (!next || next.id === t.chief) {
        toast('Kein anderer Spieler im Team verfügbar.');
        return;
      }
      askConfirm({
        title: 'Chef wechseln?',
        text: `${next.name} wird Geheimdienstchef von ${t.name}${v.settings.input === 'keys' ? ' und scannt den 🔑-QR-Code' : ''}.`,
        yes: 'Wechseln',
        run: () => dispatch('setChief', { player: next.id }),
      });
    },
    'pick-chief': (el) => {
      if (!ui.nextChiefs) ui.nextChiefs = {};
      ui.nextChiefs[el.dataset.team] = el.dataset.player;
      render();
    },
    'next-game': (el) => dispatch('nextGame', { game: +el.dataset.game, chiefs: ui.nextChiefs || undefined }),
    again: () => dispatch('again'),

    /* Spiel – Handy */
    suggest: (el) => {
      const v = ui.view;
      if (v) dispatch('suggest', { idx: +el.dataset.idx, at: v.turnNo });
    },
    'reveal-mine': () => {
      const v = ui.view;
      if (!v || v.me.suggestion == null) return;
      const card = v.cards[v.me.suggestion];
      askConfirm({
        title: `„${card.word}“ aufdecken?`,
        text: 'Ist sich das Team einig? Einmal aufgedeckt, gibt es kein Zurück.',
        yes: 'Aufdecken!',
        run: () => revealCard(v.me.suggestion),
      });
    },
    /** Chef-Handy: Hinweis wurde laut gesagt – nur die Anzahl eintragen */
    'clue-spoken': () => {
      const v = ui.view;
      if (!v || v.phase !== 'clue') return;
      if (document.activeElement) document.activeElement.blur();
      dispatch('clue', { word: '', count: ui.clueCount, at: v.turnNo });
    },
    /** Schlüsselkarte: laut gesagten Hinweis an den Laptop melden */
    'key-clue': () => {
      const v = ui.keyView;
      if (!ui.keyConn || !v || v.phase !== 'clue') return;
      ui.keyConn.dispatch({ type: 'clue', word: '', count: ui.clueCount, key: ui.keyCode, at: v.turnNo });
    },
    'key-retry': () => {
      keyConnect();
      render();
    },
    'clue-step': (el) => {
      const order = [];
      for (let n = 0; n <= MAX_COUNT; n++) order.push(n);
      order.push(UNLIMITED);
      const i = order.indexOf(ui.clueCount);
      ui.clueCount = order[Math.max(0, Math.min(order.length - 1, i + +el.dataset.d))];
      render();
    },

    /* Schlüsselkarte */
    'key-toggle': (el) => {
      const i = +el.dataset.idx;
      if (ui.keyDone.has(i)) ui.keyDone.delete(i);
      else ui.keyDone.add(i);
      render();
    },
    'key-hide': () => {
      ui.keyHidden = !ui.keyHidden;
      render();
    },
    'key-close': () => {
      keyDisconnect();
      ui.keyCode = null;
      ui.screen = 'home';
      history.replaceState(null, '', location.pathname);
      render();
    },
  };

  /* ------------------------------------------------------------------ */
  /* Event-Listener                                                      */
  /* ------------------------------------------------------------------ */

  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled || !app.contains(el)) {
      // Klick daneben hebt die Auswahl einer Karte auf
      if (ui.pick != null && !e.target.closest('.board')) {
        ui.pick = null;
        render();
      }
      return;
    }
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
    if (f === 'team-name') {
      ui.setup.teams[+el.dataset.team].name = el.value;
      saveSetup();
    } else if (f === 'player-name') {
      ui.setup.teams[+el.dataset.team].players[+el.dataset.player] = el.value;
      saveSetup();
    } else if (f === 'name') {
      ui.name = el.value;
    } else if (f === 'join-code') {
      ui.joinCode = Net.cleanCode(el.value);
    } else if (f === 'clue-word') {
      ui.clueWord = el.value;
      ui.clueError = null;
      render(); // Prüfung „liegt auf dem Feld“ live
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
      const next = app.querySelector(`[data-field="player-name"][data-team="${el.dataset.team}"][data-player="${+el.dataset.player + 1}"]`);
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
    } else if (form.dataset.form === 'clue' && v) {
      const word = ui.clueWord.trim();
      if (!word || Board.clueProblem(word, v.cards.filter((c) => !c.revealed).map((c) => c.word))) return;
      if (document.activeElement) document.activeElement.blur();
      dispatch('clue', { word, count: ui.clueCount, at: v.turnNo });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (ui.modal) {
        ui.modal = null;
        ui.confirm = null;
        render();
      } else if (ui.pick != null) {
        ui.pick = null;
        render();
      }
      return;
    }
    // Laptop: Zahl des Hinweises per Tastatur (nicht beim Tippen in ein Feld)
    const v = ui.view;
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    if (ui.screen === 'stage' && v && v.phase === 'clue' && !ui.modal && !typing && /^[0-9]$/.test(e.key)) {
      if (v.settings.input === 'keys' || ui.stageClue) stageClue(+e.key);
    }
  });

  window.addEventListener('hashchange', () => {
    const code = keyFromHash();
    if (!code) return;
    // Neue Schlüsselkarte gescannt (neue Partie)
    ui.keyCode = code;
    ui.keyDone = new Set();
    ui.keyHidden = false;
    ui.keyGame = +hashParam('g') || 0;
    const room = Net.cleanCode(hashParam('r') || '') || null;
    stopController(true);
    ui.screen = 'key';
    if (room !== ui.keyRoom || !ui.keyConn || ui.keyStatus === 'error') {
      ui.keyRoom = room;
      keyConnect();
    }
    render();
  });

  window.addEventListener('beforeunload', () => {
    if (ui.ctrl && ui.ctrl.mode === 'client') ui.ctrl.bye();
    if (ui.keyConn) ui.keyConn.bye();
  });

  /* ------------------------------------------------------------------ */
  /* Start                                                               */
  /* ------------------------------------------------------------------ */

  function autoResume() {
    const active = session(ACTIVE_KEY);
    const saves = savedGames();
    if (ui.screen === 'key') {
      keyConnect();
      render();
    } else if (active === 'stage' && saves.stage) startStage({ state: saves.stage.state, code: saves.stage.code, key: saves.stage.key });
    else if (active === 'client' && saves.client && (!ui.joinCode || ui.joinCode === saves.client.code)) {
      startClient({ code: saves.client.code, name: saves.client.name, pid: saves.client.pid });
    } else {
      if (ui.screen === 'join') ui.focus = ui.name ? '#code-input' : '#name-input';
      render();
    }
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.GS_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  requestAnimationFrame(timerLoop);
  autoResume();

  // für Tests
  window.GSApp = { ui, render: renderNow, actions };
})();
