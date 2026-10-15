/*
 * Oberfläche von „Who knows more?“.
 *  - Laptop („Bühne“): Spiel anlegen, Lobby mit QR-Code, die Wand, Fragen, Buzzer-Tasten, Finale, Siegerehrung
 *  - Handy: Team wählen, großer Buzzer, Joker-/Finale-Einsatz und Finalantwort geheim, Quizmaster-Ansicht
 *  - Editor für eigene Wände (js/editor.js)
 * Gerendert wird per HTML-String + morphdom (nur geänderte Teile werden ersetzt).
 */
(function () {
  'use strict';

  const { TEAMS, ANSWER_OPTIONS, Engine, sanitizeSettings, EARLY_LOCK_MS, MAX_ANSWER, JOKER_MIN } = window.WKMEngine;
  const { StageController, ClientController, Store, KEYS, Net, inviteLink, qrSvg } = window.WKMControllers;
  const { Sound, confetti } = window.GameFx;
  const Board = window.WKMBoard;

  const TEAM_COLOR = { rot: '#ef4444', blau: '#3b82f6', gruen: '#22c55e', gelb: '#facc15' };
  const INPUT = {
    write: { icon: '📱', label: 'Mit Handy', text: 'Alle scannen den QR-Code – jedes Handy ist ein Buzzer. Einsätze und Finalantworten werden geheim getippt.' },
    say: { icon: '🗣️', label: 'Ohne Handy', text: 'Nur der Laptop: Jedes Team hat eine Taste als Buzzer (A, F, J, L) – oder ihr ruft und jemand klickt das Team an.' },
  };
  const HOST = {
    none: { icon: '🤝', label: 'Ohne Quizmaster', text: 'Alle spielen mit. Nach dem Buzzern wird laut geantwortet, die Antwort kann aufgedeckt werden – die Runde entscheidet.' },
    qm: { icon: '🎤', label: 'Mit Quizmaster', text: 'Eine Person liest vor, sieht die Antwort auf dem eigenen Handy und entscheidet ✓ / ✗.' },
  };
  const SOURCE = {
    katalog: { icon: '📚', label: 'Katalog' },
    custom: { icon: '✏️', label: 'Eigene Wand' },
    mixed: { icon: '🔀', label: 'Gemischt' },
  };
  const SETUP_KEY = 'wkm.setup.v1';
  const PREFS_KEY = 'wkm.prefs.v1';
  const ACTIVE_KEY = 'wkm.active';
  const RESUME_MAX_AGE = 12 * 60 * 60 * 1000;
  const QR_MAX_LINK = 1800;

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

  function num(n) {
    return (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('de-DE');
  }

  function signed(n) {
    return (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toLocaleString('de-DE');
  }

  function secs(ms) {
    return (ms / 1000).toFixed(2).replace('.', ',') + ' s';
  }

  function teamOf(v, id) {
    return v.teams.find((t) => t.id === id);
  }

  function teamName(v, id) {
    const t = teamOf(v, id);
    return t ? t.name : '?';
  }

  function places(v) {
    return v.ranking.map((id) => {
      const t = teamOf(v, id);
      const better = v.ranking.filter((o) => teamOf(v, o).score > t.score).length;
      return { team: t, place: better + 1 };
    });
  }

  function defaultSetup() {
    return {
      settings: sanitizeSettings({}),
      teams: TEAMS.map((t, i) => ({ id: t.id, active: i < 2, name: '' })),
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

  /** Quizmaster-Handy verbunden? Sonst entscheidet der Laptop */
  function qmOnline(v) {
    return v.settings.host === 'qm' && v.qm && v.qm.online;
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
    modalData: null,
    confirm: null,
    toast: null,
    focus: null,
    peek: false,
    stageOpen: { id: null, at: 0 },
    buzz: { openId: null, openAt: 0, lockUntil: 0, sent: null },
    wagerDraft: '',
    answerDraft: '',
    sayWager: '',
    fallback: false,
    rewager: false,
    editor: null,
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
    }, 2800);
    render();
  }

  function showModal(name, data) {
    ui.modal = name;
    ui.modalData = data || null;
    render();
  }

  function askConfirm(opts) {
    ui.confirm = opts;
    ui.modal = 'confirm';
    render();
  }

  const Editor = window.WKMEditor.create({
    ui,
    esc,
    render: () => render(),
    toast,
    askConfirm,
    showModal,
    playWall(id) {
      ui.setup.settings = sanitizeSettings(Object.assign({}, ui.setup.settings, { source: ui.setup.settings.source === 'mixed' ? 'mixed' : 'custom', wallId: id }));
      saveSetup();
      ui.error = null;
      ui.screen = 'setup';
      window.scrollTo(0, 0);
      render();
    },
  });

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
    ui.peek = false;
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
    const c = v.cur;
    // Reaktionszeit wird ab dem Moment gemessen, in dem „Buzzer frei“ hier ankommt
    if (c && c.openId && c.openId !== ui.buzz.openId) {
      ui.buzz.openId = c.openId;
      ui.buzz.openAt = performance.now();
    }
    if (c && c.openId && c.openId !== ui.stageOpen.id) ui.stageOpen = { id: c.openId, at: performance.now() };
    const qKey = (x) => (x && x.cur ? x.cur.no : null) + '|' + (x ? x.phase : '');
    if (qKey(prev) !== qKey(v)) {
      ui.peek = false;
      ui.fallback = false;
      if (!prev || !prev.cur || !c || prev.cur.no !== c.no) ui.wagerDraft = '';
    }
    if (!prev || prev.phase !== v.phase) {
      if (v.phase !== 'finalQ') ui.answerDraft = '';
      if (v.phase === 'finalWager') ui.wagerDraft = '';
      ui.rewager = false;
    }
    if (prev && prev.final && v.final && prev.final.step !== v.final.step) ui.sayWager = '';
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

  /** Sounds, Konfetti, Vibration und Einblendungen bei Zustandswechseln */
  function transitions(prev, v) {
    if (!prev) return;
    const stage = !!v.me.stage;
    const c = v.cur;
    const pc = prev.cur;
    const myTeam = v.me.team;
    if (v.phase === 'over' && prev.phase !== 'over') {
      Sound.fanfare();
      const colors = v.winners.map((id) => TEAM_COLOR[id]);
      setTimeout(() => confetti(colors.concat('#ffffff', '#facc15'), 260), 150);
      setTimeout(() => confetti(colors.concat('#ffffff'), 160), 900);
      return;
    }
    if (c && (!pc || pc.no !== c.no)) {
      if (c.joker) {
        Sound.fanfare();
        if (myTeam === v.turn && navigator.vibrate) navigator.vibrate([60, 40, 60]);
      } else Sound.flip();
    }
    if (c && v.phase === 'open' && c.openId && (!pc || pc.openId !== c.openId)) {
      Sound.start();
      if (!stage && myTeam && !c.locked.includes(myTeam) && navigator.vibrate) navigator.vibrate(25);
    }
    if (c && v.phase === 'buzzed' && prev.phase !== 'buzzed' && c.buzzed) {
      Sound.buzzer();
      if (!stage && myTeam === c.buzzed.team && navigator.vibrate) navigator.vibrate([90, 50, 90]);
    }
    if (c && pc && pc.no === c.no && c.attempts.length > pc.attempts.length) {
      const last = c.attempts[c.attempts.length - 1];
      if (last.ok) {
        Sound.success();
        if (stage) confetti([TEAM_COLOR[last.team], '#ffffff'], 110);
        else if (myTeam === last.team) confetti([TEAM_COLOR[last.team], '#ffffff'], 80);
      } else Sound.fail();
    } else if (c && v.phase === 'reveal' && prev.phase !== 'reveal' && !c.attempts.length) {
      Sound.fail();
    }
    const f = v.final;
    const pf = prev.final;
    if (f && pf && f.results && pf.results) {
      for (const [id, r] of Object.entries(f.results)) {
        if (pf.results[id]) continue;
        if (r.ok) {
          Sound.success();
          confetti([TEAM_COLOR[id], '#ffffff'], 120);
        } else Sound.fail();
      }
    }
    if (v.phase === 'finalQ' && prev.phase !== 'finalQ') Sound.start();
  }

  /* ------------------------------------------------------------------ */
  /* Timer                                                               */
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
      if (text && text.textContent !== String(sec)) text.textContent = String(sec);
      const bar = el.querySelector('[data-timer-bar]');
      if (bar) bar.style.width = (100 * rem) / total + '%';
      el.classList.toggle('urgent', sec <= 3);
      if (el.hasAttribute('data-tick') && el.dataset.last !== String(sec)) {
        if (el.dataset.last && sec <= 3 && sec > 0) Sound.tick(sec <= 1);
        if (el.dataset.last && sec === 0) Sound.tick(true);
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
      case 'connecting':
        html = connectingHtml();
        break;
      case 'stage':
        html = ui.view ? stageHtml(ui.view) : connectingHtml();
        break;
      case 'player':
        html = ui.view ? playerHtml(ui.view) : connectingHtml();
        break;
      case 'walls':
        html = Editor.listHtml();
        break;
      case 'editor':
        html = ui.editor && ui.editor.wall ? Editor.editHtml() : Editor.listHtml();
        break;
      default:
        html = homeHtml();
    }
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
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="Who knows more?">
      <span class="logo-icon" aria-hidden="true">🧩</span>
      <span class="logo-text"><span class="l1">Who knows</span> <span class="l2">more?</span></span>
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

  function switchHtml(key, on, scope) {
    return `<button class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" data-act="toggle" data-key="${key}" data-scope="${scope}">
      <span class="switch-knob"></span><span class="switch-text">${on ? 'An' : 'Aus'}</span>
    </button>`;
  }

  function setting(label, small, control) {
    return `<div class="setting"><div class="setting-label"><b>${label}</b>${small ? `<small>${small}</small>` : ''}</div>${control}</div>`;
  }

  function settingsHtml(s, scope) {
    const rows = [];
    const custom = s.source === 'custom';
    if (!custom) {
      rows.push(setting('🔁 Länge', s.length === 'short' ? '1 Runde (100–500) + Finale' : 'Runde 1 (100–500), Runde 2 (200–1000) + Finale', seg('length', ['short', 'normal'], s.length, (o) => (o === 'short' ? 'Kurz' : 'Normal'), scope)));
      rows.push(setting('🧱 Kategorien pro Runde', 'Spalten der Wand', seg('cols', Board.COLS_OPTIONS, s.cols, String, scope)));
    }
    rows.push(setting('🎲 Joker-Felder', 'Versteckt – nur das wählende Team antwortet und setzt vorher einen Einsatz', switchHtml('joker', s.joker, scope)));
    rows.push(setting('➖ Minuspunkte', s.negative ? 'Falsche Antwort = −Wert' : 'Falsche Antwort = 0 (Joker & Finale bleiben ±Einsatz)', switchHtml('negative', s.negative, scope)));
    rows.push(setting('⏱ Antwortzeit', 'Nach dem Buzzern', seg('answerSec', ANSWER_OPTIONS, s.answerSec, (o) => o + ' s', scope)));
    rows.push(setting('🔄 Umgekehrt', 'Die Wand zeigt die Antwort – gesucht ist die passende Frage', switchHtml('reverse', s.reverse, scope)));
    if (!custom) rows.push(setting('🔞 18+', 'Mischt pro Runde 1–2 Kategorien ab 18 dazu (Party, Alkohol, Liebe)', switchHtml('adult', s.adult, scope)));
    return `<div class="settings">${rows.join('')}</div>`;
  }

  function timerHtml(timer, opts) {
    if (!timer) return '';
    const o = opts || {};
    return `<div class="timer timer-${timer.kind || 'x'}" data-timer ${o.tick ? 'data-tick' : ''} data-rem="${Math.round(timer.remaining)}" data-total="${timer.total}">
      <div class="timer-bar"><span data-timer-bar style="width:${(100 * timer.remaining) / (timer.total || 1)}%"></span></div>
      <b data-timer-text>${Math.ceil(timer.remaining / 1000)}</b>
    </div>`;
  }

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

  /** Die Wand (Laptop groß, Handy als Mini-Wand) */
  function wallHtml(v, opts) {
    const o = opts || {};
    const b = v.board;
    if (!b) return '';
    const cols = b.cats.length;
    const heads = b.cats.map((k) => `<div class="wall-cat"><span>${esc(k.name)}</span></div>`).join('');
    let cells = '';
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < cols; col++) {
        const c = b.cats[col].cells[row];
        const cur = v.cur && v.cur.col === col && v.cur.row === row;
        if (c.done && !cur) {
          const by = c.result && c.result.team;
          cells += `<div class="wall-cell is-done ${by ? 'team-' + by : ''}" aria-label="${c.empty ? 'leer' : 'gespielt'}">${by ? '<span class="team-dot"></span>' : ''}${c.joker ? '<i>🎲</i>' : ''}</div>`;
        } else {
          cells += `<button class="wall-cell ${cur ? 'is-current' : ''}" ${o.pick ? `data-act="pick" data-col="${col}" data-row="${row}"` : 'disabled'} aria-label="${esc(b.cats[col].name)} für ${c.value}">${c.value}</button>`;
        }
      }
    }
    return `<div class="wall ${o.mini ? 'wall-mini' : ''}" style="--cols:${cols}">${heads}${cells}</div>`;
  }

  function scoreboardHtml(v) {
    const ids = v.order;
    if (!ids.length) return '';
    const c = v.cur;
    const say = v.settings.input === 'say';
    const canBuzz = c && v.phase === 'open';
    const lead = Math.max(...ids.map((id) => teamOf(v, id).score));
    return `
      <footer class="scoreboard" aria-label="Punktestand">
        ${ids
          .map((id) => {
            const t = teamOf(v, id);
            const locked = c && c.locked.includes(id) && ['open', 'buzzed', 'read'].includes(v.phase);
            const buzzed = c && c.buzzed && c.buzzed.team === id && v.phase === 'buzzed';
            const turn = v.turn === id && ['board', 'wager', 'joker'].includes(v.phase);
            const tag = canBuzz && !locked ? 'button' : 'div';
            const attrs = tag === 'button' ? `data-act="stage-buzz" data-team="${id}" title="${esc(t.name)} hat zuerst gerufen"` : '';
            return `
            <${tag} class="score team-${id} ${turn ? 'is-turn' : ''} ${locked ? 'is-locked' : ''} ${buzzed ? 'is-buzzed' : ''}" ${attrs}>
              <div class="score-head"><span class="team-dot"></span><b>${esc(t.name)}</b>${t.score === lead && lead > 0 && ids.length > 1 ? ' 👑' : ''}</div>
              <div class="score-num">${num(t.score)}</div>
              ${say ? `<kbd class="score-key">${t.key}</kbd>` : ''}
            </${tag}>`;
          })
          .join('')}
      </footer>`;
  }

  /* ---------- Startseite ---------- */

  function homeHtml() {
    const saves = savedGames();
    const resume = [];
    if (saves.stage) {
      const st = saves.stage.state;
      const teams = st.teams.filter((t) => st.order.includes(t.id) || (st.phase === 'lobby' && t.active)).map((t) => t.name);
      resume.push(`
        <div class="resume">
          <button class="btn btn-ghost btn-wide" data-act="resume-stage">▶ Spiel fortsetzen
            <small>${INPUT[st.settings.input].label} · ${esc(teams.join(' · '))}</small></button>
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
    const st = Board.stats();
    const walls = Board.listWalls().length;
    return `
    <div class="screen home">
      <a class="btn btn-ghost btn-small hub-back" href="../">← Alle Spiele</a>
      <div class="home-hero">
        ${logoHtml()}
        <p class="tagline">Das Quiz mit der Fragenwand. Wer zuerst buzzert, darf antworten!</p>
      </div>
      ${resume.join('')}
      <div class="mode-cards">
        <button class="mode-card mode-play" data-act="new-game">
          <span class="mode-icon">🔔</span>
          <span class="mode-body"><b>Neues Spiel</b><small>Der Laptop ist die Wand, die Handys sind Buzzer – oder ihr spielt nur mit dem Laptop. 1–4 Teams.</small></span>
          <span class="mode-go">Spielen →</span>
        </button>
        <button class="mode-card mode-edit" data-act="walls">
          <span class="mode-icon">✏️</span>
          <span class="mode-body"><b>Eigene Wand</b><small>Fragen für Geburtstage, Insider-Runden oder das Schulquiz selbst schreiben – und per Link teilen.${walls ? ` (${walls} gespeichert)` : ''}</small></span>
          <span class="mode-go">Bauen →</span>
        </button>
      </div>
      <div class="home-links">
        <button class="btn btn-ghost" data-act="join-screen">📱 Mit dem Handy beitreten</button>
        <button class="btn btn-link" data-act="rules">📖 Spielregeln</button>
      </div>
      <p class="home-foot">${st.cats} Kategorien · ${st.questions} Fragen · ${st.finals} Finalfragen · dazu ${st.adultCats} Kategorien ab 18</p>
    </div>`;
  }

  /* ---------- Spiel anlegen (Laptop) ---------- */

  function setupHtml() {
    const s = ui.setup;
    const st = s.settings;
    const activeCount = s.teams.filter((t) => t.active).length;
    const card = (key, map, id) => `
      <button class="input-card ${st[key] === id ? 'on' : ''}" data-act="set" data-key="${key}" data-value="${id}" data-scope="setup" aria-pressed="${st[key] === id}">
        <span class="input-icon">${map[id].icon}</span>
        <b>${map[id].label}</b>
        <small>${map[id].text}</small>
      </button>`;
    const teams = s.teams
      .map((t, ti) => {
        const def = TEAMS[ti];
        if (!t.active) {
          return `<button class="team-setup team-${t.id} off" data-act="team-toggle" data-team="${ti}"><span class="ts-add">＋</span><span>Team ${def.label} hinzufügen</span></button>`;
        }
        return `
          <div class="team-setup team-${t.id}">
            <div class="ts-head">
              <span class="team-dot"></span>
              <input class="input input-team" type="text" maxlength="24" placeholder="Team ${def.label}" value="${esc(t.name)}"
                data-field="team-name" data-team="${ti}" autocomplete="off" aria-label="Teamname" />
              ${activeCount > 1 ? `<button class="icon-btn" data-act="team-toggle" data-team="${ti}" aria-label="Team entfernen" title="Team entfernen">✕</button>` : ''}
            </div>
            <p class="muted small">${st.input === 'say' ? `Buzzer-Taste: <kbd>${def.key}</kbd>` : 'Die Spieler treten mit dem Handy bei.'}</p>
          </div>`;
      })
      .join('');
    const walls = Board.listWalls();
    let wallPick = '';
    if (st.source !== 'katalog') {
      wallPick = walls.length
        ? `<div class="wall-pick">${walls
            .map(
              (w) => `<button class="wall-pick-btn ${st.wallId === w.id ? 'on' : ''}" data-act="set" data-key="wallId" data-value="${esc(w.id)}" data-scope="setup" aria-pressed="${st.wallId === w.id}">
                <b>${esc(w.title || 'Ohne Titel')}</b><small>${esc(Editor.statsText(w))}</small></button>`
            )
            .join('')}</div>
           <button class="btn btn-link" data-act="walls">✏️ Wände bearbeiten</button>`
        : `<p class="muted">Noch keine eigene Wand gespeichert.</p><button class="btn btn-ghost btn-small" data-act="walls">✏️ Jetzt eine bauen</button>`;
      wallPick += `<p class="muted small">${st.source === 'custom' ? 'Nur die Fragen der Wand – so viele Runden, wie die Wand hat.' : 'Eure Kategorien zuerst, der Rest der Wand kommt aus dem Katalog.'}</p>`;
    }
    const needsRoom = st.input === 'write' || st.host === 'qm';
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
        <div class="input-cards">${card('input', INPUT, 'write')}${card('input', INPUT, 'say')}</div>
      </section>
      <section class="panel">
        <h2>Quizmaster</h2>
        <div class="input-cards">${card('host', HOST, 'none')}${card('host', HOST, 'qm')}</div>
        ${st.host === 'qm' && st.input === 'say' ? '<p class="muted small">Ohne Handy kann der Quizmaster ein einzelnes Handy verbinden (QR-Code oben in der Leiste). Ohne Handy-Verbindung hält er auf dem Laptop „Antwort ansehen“ gedrückt.</p>' : ''}
      </section>
      <section class="panel">
        <h2>Teams <small class="muted">(1–4, wer allein spielt, ist ein 1-Personen-Team)</small></h2>
        <div class="team-grid">${teams}</div>
      </section>
      <section class="panel">
        <h2>Fragen</h2>
        ${seg('source', ['katalog', 'custom', 'mixed'], st.source, (o) => `${SOURCE[o].icon} ${SOURCE[o].label}`, 'setup')}
        ${wallPick}
      </section>
      <section class="panel">
        <h2>Einstellungen</h2>
        ${settingsHtml(st, 'setup')}
      </section>
      <div class="sticky-start">
        <button class="btn btn-primary btn-big" data-act="create-game">${needsRoom && st.input === 'write' ? 'Raum öffnen 📱' : 'Spiel starten 🧩'}</button>
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

  function topbarHtml(v) {
    let round = '';
    if (v.phase === 'over') round = '<span class="pill">🏁 Spielende</span>';
    else if (v.phase.startsWith('final')) round = '<span class="pill pill-hot">🏁 Finale</span>';
    else if (v.phase !== 'lobby') round = `<span class="pill">Runde ${v.round} / ${v.roundCount}</span>`;
    let room = '';
    if (v.room && v.room.code && v.phase !== 'lobby') {
      const label = v.settings.input === 'write' ? '📱 ' + esc(v.room.code) : v.qm && v.qm.online ? '🎤 ' + esc(v.qm.name) : '🎤 Quizmaster-Handy';
      room = `<button class="pill pill-room" data-act="show-qr" title="${v.settings.input === 'write' ? 'Mitspieler einladen' : 'Quizmaster-Handy verbinden'}">${label}</button>`;
    }
    const wall = v.wallTitle && v.settings.source !== 'katalog' ? `<span class="pill">✏️ ${esc(v.wallTitle)}</span>` : '';
    return `
      <header class="topbar">
        <button class="topbar-brand" data-act="menu" aria-label="Menü">${logoHtml(true)}</button>
        <div class="topbar-info">${round}${wall}${room}</div>
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
    else if (v.phase === 'board') main = boardStageHtml(v);
    else if (v.phase === 'roundEnd') main = roundEndHtml(v, true);
    else if (v.phase.startsWith('final')) main = finalStageHtml(v);
    else main = questionStageHtml(v);
    return `
      <div class="stage phase-${v.phase}">
        ${topbarHtml(v)}
        <main class="stage-main">${main}</main>
        ${v.phase !== 'lobby' && v.phase !== 'over' ? scoreboardHtml(v) : ''}
      </div>`;
  }

  /* ---------- Lobby ---------- */

  function lobbyStageHtml(v) {
    const activeCount = v.teams.filter((t) => t.active).length;
    const chip = (m) =>
      `<span class="chip ${m.online ? '' : 'is-offline'}">${esc(m.name)}<button class="chip-x" data-act="kick" data-player="${esc(m.id)}" aria-label="${esc(m.name)} entfernen">✕</button></span>`;
    const teams = v.teams
      .map((t) => {
        if (!t.active) {
          return `<button class="team-setup team-${t.id} off" data-act="lobby-team" data-team="${t.id}" data-on="1"><span class="ts-add">＋</span><span>Team ${t.label} hinzufügen</span></button>`;
        }
        const members = t.players.map((p) => v.members.find((m) => m.id === p.id) || { id: p.id, name: p.name, online: false });
        return `
          <div class="team-setup team-${t.id}">
            <div class="ts-head">
              <span class="team-dot"></span>
              <input class="input input-team" type="text" maxlength="24" value="${esc(t.name)}" data-field="lobby-team-name" data-team="${t.id}" aria-label="Teamname" />
              ${activeCount > 1 ? `<button class="icon-btn" data-act="lobby-team" data-team="${t.id}" data-on="0" aria-label="Team entfernen">✕</button>` : ''}
            </div>
            <div class="chips">${members.length ? members.map(chip).join('') : '<span class="muted">Noch niemand – auf dem Handy dieses Team wählen</span>'}</div>
          </div>`;
      })
      .join('');
    const free = v.members.filter((m) => !m.team && !m.qm);
    const qmMember = v.qm ? v.members.find((m) => m.id === v.qm.id) : null;
    const qmBox =
      v.settings.host === 'qm'
        ? `<div class="qm-slot"><b>🎤 Quizmaster:</b> ${qmMember ? chip(qmMember) : '<span class="muted">noch niemand – auf dem Handy „Quizmaster werden“ tippen. Ohne Quizmaster-Handy entscheidet der Laptop.</span>'}</div>`
        : '';
    return `
      <div class="lobby-grid">
        <section class="panel join-panel">
          <h2>📱 Handys verbinden</h2>
          <p class="muted">QR-Code scannen, Namen eingeben, Team wählen – das Handy wird zum Buzzer.</p>
          ${roomBoxHtml(v.room, true)}
        </section>
        <div class="lobby-side">
          <section class="panel">
            <h2>Teams</h2>
            <div class="team-grid">${teams}</div>
            ${qmBox}
            ${free.length ? `<div class="free"><b>Noch ohne Team:</b> <div class="chips">${free.map(chip).join('')}</div></div>` : ''}
          </section>
          <section class="panel">
            <h2>Einstellungen</h2>
            ${setting('🎤 Quizmaster', HOST[v.settings.host].text, seg('host', ['none', 'qm'], v.settings.host, (o) => HOST[o].icon + ' ' + (o === 'qm' ? 'Mit' : 'Ohne'), 'lobby'))}
            ${settingsHtml(v.settings, 'lobby')}
          </section>
          <div class="sticky-start">
            <button class="btn btn-primary btn-big" data-act="start" ${v.lobbyProblem ? 'disabled' : ''}>Spiel starten 🧩</button>
            ${v.lobbyProblem ? `<p class="muted small center">${esc(v.lobbyProblem)}</p>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ---------- Wand ---------- */

  function turnBannerHtml(v, text) {
    const t = teamOf(v, v.turn);
    if (!t) return '';
    return `<div class="turn-banner team-${t.id}"><span class="team-dot"></span><b>${esc(t.name)}</b> ${text}</div>`;
  }

  function boardStageHtml(v) {
    const phones = v.settings.input === 'write';
    return `
      <div class="board-stage">
        ${turnBannerHtml(v, phones ? 'wählt ein Feld <small>(auf dem Handy oder hier klicken)</small>' : 'wählt ein Feld')}
        ${wallHtml(v, { pick: true })}
      </div>`;
  }

  /* ---------- Frage ---------- */

  function clueHtml(c, big) {
    return `
      <div class="q-card ${big ? '' : 'q-card-small'}">
        ${c.img ? `<img class="q-img" src="${esc(c.img)}" alt="" referrerpolicy="no-referrer" />` : ''}
        ${c.clue ? `<div class="q-text">${esc(c.clue)}</div>` : ''}
      </div>`;
  }

  function solutionHtml(v, c, label) {
    const reverse = v.settings.reverse;
    return `<div class="solution"><small>${label || (reverse ? 'Gesuchte Frage' : 'Antwort')}</small><b>${esc(c.solution)}</b></div>`;
  }

  function attemptsHtml(v, c) {
    if (!c.attempts.length) return '';
    return `<div class="attempts">${c.attempts
      .map((a) => `<span class="attempt team-${a.team} ${a.ok ? 'ok' : 'bad'}"><span class="team-dot"></span>${esc(teamName(v, a.team))} ${a.ok ? '✓' : '✗'} ${signed(a.delta)}</span>`)
      .join('')}</div>`;
  }

  /** Buttons zum Entscheiden – auf dem Laptop und auf dem Quizmaster-Handy */
  function judgeButtons(v, c, small) {
    const cls = small ? 'btn-small btn-ghost' : '';
    const showable = v.settings.host === 'none' && !c.shown;
    return `
      <div class="result-buttons ${small ? 'compact' : ''}">
        <button class="btn btn-result btn-ok ${cls}" data-act="judge" data-ok="1" data-no="${c.no}">✓ Richtig${v.me.stage && !small ? ' <kbd>R</kbd>' : ''}</button>
        <button class="btn btn-result btn-bad ${cls}" data-act="judge" data-ok="0" data-no="${c.no}">✗ Falsch${v.me.stage && !small ? ' <kbd>X</kbd>' : ''}</button>
        ${showable && v.me.stage ? `<button class="btn btn-result btn-ghost ${cls}" data-act="show" data-no="${c.no}">👁 Antwort zeigen <kbd>␣</kbd></button>` : ''}
      </div>`;
  }

  function peekHtml(c) {
    return `
      <div class="peek">
        <button class="btn btn-ghost btn-small" data-peek>👁 Antwort ansehen <small>(gedrückt halten – nur Quizmaster)</small></button>
        ${ui.peek ? `<div class="peek-box"><small>Antwort</small><b>${esc(c.solution)}</b></div>` : ''}
      </div>`;
  }

  function wagerFormHtml(range, act, placeholder, extra) {
    return `
      <form class="wager-form" data-form="${act}" ${extra || ''}>
        <input class="input input-word" type="number" inputmode="numeric" min="${range.min}" max="${range.max}" step="1" placeholder="${esc(placeholder || range.min + ' – ' + range.max)}" value="${esc(ui.wagerDraft)}" data-field="wager" autocomplete="off" />
        <small class="muted">${range.min.toLocaleString('de-DE')} bis ${range.max.toLocaleString('de-DE')} Punkte</small>
        <button class="btn btn-primary btn-big btn-wide" type="submit">Setzen ✓</button>
      </form>`;
  }

  /** Einsatz stellvertretend eintragen (z.B. wenn das Handy des Teams weg ist) */
  function fallbackHtml(c, label) {
    return ui.fallback
      ? `<div class="stage-fallback">${wagerFormHtml(c.range, 'wager', '', `data-no="${c.no}"`)}</div>`
      : `<button class="btn btn-link" data-act="fallback">${label}</button>`;
  }

  function questionStageHtml(v) {
    const c = v.cur;
    const t = teamOf(v, v.turn);
    const qmMode = v.settings.host === 'qm';
    const remoteQm = qmOnline(v);
    const say = v.settings.input === 'say';
    let status = '';
    let actions = '';
    let below = '';
    switch (v.phase) {
      case 'read':
        status = c.timer ? `<div class="q-status">📖 Lesen … gleich ist der Buzzer frei</div>${timerHtml(c.timer)}` : `<div class="q-status">📖 ${remoteQm ? 'Der Quizmaster liest vor …' : 'Vorlesen – dann den Buzzer freigeben'}</div>`;
        actions = `
          <div class="stage-actions">
            <button class="btn ${c.timer ? 'btn-ghost' : 'btn-primary btn-big'}" data-act="open" data-no="${c.no}">🔔 Buzzer frei <kbd>␣</kbd></button>
            <button class="btn btn-ghost btn-small" data-act="resolve" data-no="${c.no}">⏭ Überspringen</button>
          </div>`;
        if (qmMode && !remoteQm) below = peekHtml(c);
        break;
      case 'open':
        status = `<div class="q-status q-status-open">🔔 Buzzer frei!${say ? ' <small>Taste drücken – oder Team unten anklicken</small>' : c.locked.length ? '' : ' <small>Wer weiß es?</small>'}</div>${timerHtml(c.timer)}`;
        actions = `<div class="stage-actions"><button class="btn btn-ghost btn-small" data-act="resolve" data-no="${c.no}">🤷 Niemand weiß es – auflösen</button></div>`;
        if (qmMode && !remoteQm) below = peekHtml(c);
        break;
      case 'buzzed': {
        const b = c.buzzed;
        status = `
          <div class="buzzed-banner team-${b.team}">
            <span class="team-dot"></span>
            <b>${esc(teamName(v, b.team))}</b> hat gebuzzert! <small>${b.name ? esc(b.name) + ' · ' : ''}${secs(b.reaction)}</small>
          </div>
          ${timerHtml(c.timer, { tick: true })}`;
        if (c.shown) below = solutionHtml(v, c);
        else if (qmMode && !remoteQm) below = peekHtml(c);
        actions = remoteQm ? `<p class="hint center">🎤 ${esc(v.qm.name)} entscheidet …</p>${judgeButtons(v, c, true)}` : judgeButtons(v, c);
        break;
      }
      case 'wager': {
        const phones = v.settings.input === 'write';
        status = `<div class="joker-banner team-${t.id}">🎲 JOKER-FELD!<small>${esc(t.name)} setzt einen Einsatz – nur ${esc(t.name)} darf antworten</small></div>`;
        actions = phones
          ? `<p class="hint center">⏳ ${esc(t.name)} setzt auf dem Handy (${c.range.min}–${num(c.range.max)}) …</p>
             ${fallbackHtml(c, 'Einsatz hier eintragen')}`
          : wagerFormHtml(c.range, 'wager', 'Einsatz', `data-no="${c.no}"`);
        actions += `<div class="stage-actions"><button class="btn btn-link" data-act="resolve" data-no="${c.no}">Joker überspringen</button></div>`;
        break;
      }
      case 'joker':
        status = `
          <div class="buzzed-banner team-${t.id}"><span class="team-dot"></span><b>${esc(t.name)}</b> antwortet · Einsatz <b>${num(c.wager)}</b></div>
          ${timerHtml(c.timer, { tick: true })}`;
        if (c.shown) below = solutionHtml(v, c);
        else if (qmMode && !remoteQm) below = peekHtml(c);
        actions = remoteQm ? `<p class="hint center">🎤 ${esc(v.qm.name)} entscheidet …</p>${judgeButtons(v, c, true)}` : judgeButtons(v, c);
        break;
      case 'reveal': {
        const r = c.result;
        status = r.team
          ? `<div class="buzzed-banner team-${r.team} is-win"><span class="team-dot"></span><b>${esc(teamName(v, r.team))}</b> ${signed(r.delta)}${c.joker ? ' 🎲' : ''}</div>`
          : `<div class="q-status">${c.attempts.length ? '😬 Niemand lag richtig' : '🤷 Niemand wusste es'}</div>`;
        below = solutionHtml(v, c, v.settings.reverse ? 'Die Frage war' : 'Die Antwort');
        actions = `<div class="stage-actions"><button class="btn btn-primary btn-big" data-act="next" data-no="${c.no}">Weiter → <kbd>␣</kbd></button></div>`;
        break;
      }
    }
    return `
      <div class="q-stage phase-${v.phase} ${v.phase === 'open' ? 'is-open' : ''}">
        <div class="q-head"><span class="q-cat">${esc(c.cat)}</span><b>${c.value}</b>${c.joker ? '<span class="pill pill-hot">🎲 Joker</span>' : ''}</div>
        ${v.phase === 'wager' ? '' : clueHtml(c, true)}
        ${status}
        ${attemptsHtml(v, c)}
        ${below}
        ${actions}
      </div>`;
  }

  /* ---------- Rundenende ---------- */

  function rankingHtml(v) {
    return `<div class="summary">${places(v)
      .map(({ team, place }) => `<div class="summary-row team-${team.id}"><span class="team-dot"></span><b>${place}. ${esc(team.name)}</b><b class="summary-points">${num(team.score)}</b></div>`)
      .join('')}</div>`;
  }

  function roundEndHtml(v, judge) {
    const last = v.round >= v.roundCount;
    return `
      <div class="center-stage">
        <h2 class="stage-title">Runde ${v.round} geschafft!</h2>
        ${rankingHtml(v)}
        ${
          judge
            ? `<div class="stage-actions"><button class="btn btn-primary btn-big" data-act="next" data-phase="roundEnd">${last ? '🏁 Zum Finale →' : `Runde ${v.round + 1} starten → <small>doppelte Werte!</small>`}</button></div>`
            : '<p class="muted center">Gleich geht es weiter …</p>'
        }
      </div>`;
  }

  /* ---------- Finale ---------- */

  function finalCatHtml(f) {
    return `<div class="final-cat"><small>🏁 Finale · Kategorie</small><b>${esc(f.cat)}</b></div>`;
  }

  function teamChecksHtml(v, ids, done) {
    return `<div class="pstats">${ids
      .map((id) => `<span class="pstat team-${id} ${done.includes(id) ? 'done' : ''}"><span class="team-dot"></span> ${esc(teamName(v, id))} ${done.includes(id) ? '✓' : '⏳'}</span>`)
      .join('')}</div>`;
  }

  function finalStageHtml(v) {
    const f = v.final;
    const phones = v.settings.input === 'write';
    const out = v.order.filter((id) => !f.eligible.includes(id));
    const outNote = out.length ? `<p class="muted small center">Ohne Punkte nicht im Finale: ${out.map((id) => esc(teamName(v, id))).join(', ')}</p>` : '';
    if (v.phase === 'finalWager') {
      return `
        <div class="center-stage final-stage">
          ${finalCatHtml(f)}
          <p class="hint center big-hint">${phones ? 'Jedes Team setzt jetzt <b>geheim auf dem Handy</b> einen Einsatz – zwischen 0 und dem eigenen Punktestand.' : 'Jedes Team schreibt jetzt <b>geheim auf einen Zettel</b>, wie viel es setzt – zwischen 0 und dem eigenen Punktestand.'}</p>
          ${phones ? teamChecksHtml(v, f.eligible, f.wagered) : ''}
          ${outNote}
          <div class="stage-actions"><button class="btn btn-primary btn-big" data-act="next" data-phase="finalWager">Frage zeigen → <kbd>␣</kbd></button></div>
        </div>`;
    }
    if (v.phase === 'finalQ') {
      return `
        <div class="center-stage final-stage">
          <div class="q-head"><span class="q-cat">🏁 ${esc(f.cat)}</span></div>
          <div class="q-card"><div class="q-text">${esc(f.q)}</div></div>
          ${timerHtml(Object.assign({ kind: 'answer' }, f.timer), { tick: true })}
          <p class="hint center">${phones ? 'Tippt eure Antwort geheim ins Handy …' : 'Schreibt eure Antwort geheim auf!'}</p>
          ${phones ? teamChecksHtml(v, f.eligible, f.answered) : ''}
          <div class="stage-actions"><button class="btn ${phones && f.answered.length === f.eligible.length ? 'btn-primary btn-big' : 'btn-ghost btn-small'}" data-act="next" data-phase="finalQ">⏩ Jetzt auflösen</button></div>
        </div>`;
    }
    // Aufdecken – vom letzten zum ersten Platz
    const rows = f.order
      .map((id, i) => {
        const r = f.results[id];
        const t = teamOf(v, id);
        const now = i === f.step && !f.done;
        let right = '<span class="muted">⏳</span>';
        if (r) right = `<span class="${r.ok ? 'ok-text' : 'bad-text'}">${r.ok ? '✓' : '✗'} Einsatz ${num(r.wager)} → <b>${num(t.score)}</b></span>`;
        else if (now) right = '<span class="pill pill-hot">jetzt</span>';
        return `<div class="summary-row team-${id} ${now ? 'is-now' : ''}"><span class="team-dot"></span><b>${esc(t.name)}</b>
          <span class="summary-term">${r && r.answer ? '„' + esc(r.answer) + '“' : ''}</span>${right}</div>`;
      })
      .join('');
    const anyShown = f.shown || Object.keys(f.results).length || f.done;
    let panel = '';
    if (f.done) {
      panel = `<div class="stage-actions"><button class="btn btn-primary btn-big" data-act="next" data-phase="finalReveal">🏆 Zur Siegerehrung</button></div>`;
    } else {
      const id = f.current;
      const t = teamOf(v, id);
      const ans = f.answers[id];
      const remoteQm = qmOnline(v);
      let reveal = '';
      if (phones) {
        reveal = f.shown
          ? `<div class="final-answer team-${id}"><small>Antwort von ${esc(t.name)}${ans && ans.by ? ' (' + esc(ans.by) + ')' : ''}</small><b>${ans ? esc(ans.text) : '— keine Antwort —'}</b>
              ${ans && v.settings.host === 'none' ? `<em class="${f.suggest ? 'ok-text' : 'bad-text'}">🤖 ${f.suggest ? 'Sieht richtig aus' : 'Sieht nicht richtig aus'} – ihr entscheidet</em>` : ''}</div>`
          : `<button class="btn btn-primary btn-big" data-act="final-show">👀 Antwort von ${esc(t.name)} aufdecken <kbd>␣</kbd></button>`;
      } else {
        reveal = `<p class="hint center"><b>${esc(t.name)}</b>: Antwort vom Zettel vorlesen${f.shown ? '' : ' – dann die Lösung zeigen'}.</p>
          ${f.shown ? '' : `<button class="btn btn-ghost" data-act="final-show">👁 Lösung zeigen <kbd>␣</kbd></button>`}`;
      }
      const judge = `
        ${phones ? '' : `<label class="say-wager">Einsatz von ${esc(t.name)} <small>(0 – ${num(t.score)})</small><input class="input" type="number" inputmode="numeric" min="0" max="${t.score}" value="${esc(ui.sayWager)}" data-field="say-wager" /></label>`}
        <div class="result-buttons ${remoteQm ? 'compact' : ''}">
          <button class="btn btn-result btn-ok ${remoteQm ? 'btn-small btn-ghost' : ''}" data-act="final-judge" data-ok="1" data-team="${id}">✓ Richtig</button>
          <button class="btn btn-result btn-bad ${remoteQm ? 'btn-small btn-ghost' : ''}" data-act="final-judge" data-ok="0" data-team="${id}">✗ Falsch</button>
        </div>
`;
      panel = `
        <div class="final-panel team-${id}">
          <h3><span class="team-dot"></span>${esc(t.name)} <small>${num(t.score)} Punkte</small></h3>
          ${reveal}
          ${remoteQm ? `<p class="hint center">🎤 ${esc(v.qm.name)} entscheidet …</p>` : ''}
          ${phones && !f.shown && !remoteQm ? '' : judge}
        </div>`;
    }
    return `
      <div class="center-stage final-stage">
        <div class="q-head"><span class="q-cat">🏁 ${esc(f.cat)}</span></div>
        <div class="q-card q-card-small"><div class="q-text">${esc(f.q)}</div></div>
        ${anyShown ? `<div class="solution"><small>Richtige Antwort</small><b>${esc(f.a)}</b></div>` : ''}
        <div class="summary final-order">${rows}</div>
        ${panel}
      </div>`;
  }

  /* ---------- Spielende ---------- */

  function overHtml(v) {
    const pl = places(v);
    const single = pl.length === 1;
    const podium = pl
      .slice(0, 3)
      .map(
        ({ team, place }, i) => `
        <div class="podium-step p${i + 1} team-${team.id}">
          <div class="podium-medal">${['🥇', '🥈', '🥉'][place - 1] || '🏅'}</div>
          <b>${esc(team.name)}</b>
          <span>${num(team.score)} Punkte</span>
          <div class="podium-block">${place}</div>
        </div>`
      )
      .join('');
    const rest = pl.slice(3);
    const awards = (v.awards || [])
      .map((a) => `<div class="award"><span class="award-icon">${a.icon}</span><div><b>${esc(a.title)}</b><small>${esc(a.text)}</small></div></div>`)
      .join('');
    const winnerNames = v.winners.map((id) => esc(teamName(v, id))).join(' & ');
    return `
      <div class="center-stage over">
        <h1 class="over-title">${single ? `🧩 ${num(pl[0].team.score)} Punkte!` : v.winners.length > 1 ? `🤝 Unentschieden: ${winnerNames}` : `🏆 ${winnerNames} weiß mehr!`}</h1>
        ${v.final && v.final.skipped ? '<p class="muted center">Kein Team hatte Punkte – das Finale fiel aus.</p>' : ''}
        ${single ? '' : `<div class="podium">${podium}</div>`}
        ${rest.length ? `<div class="summary">${rest.map(({ team, place }) => `<div class="summary-row team-${team.id}"><span class="team-dot"></span><b>${place}. ${esc(team.name)}</b><b class="summary-points">${num(team.score)}</b></div>`).join('')}</div>` : ''}
        ${awards ? `<div class="awards">${awards}</div>` : ''}
        <div class="stage-actions">
          <button class="btn btn-primary btn-big" data-act="again">🔁 Nochmal (neue Wand)</button>
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
    const t = me.team ? teamOf(v, me.team) : null;
    let body;
    let head;
    if (me.role === 'qm') {
      head = `<span class="team-dot qm-dot"></span><b>🎤 Quizmaster</b>`;
      body = qmHtml(v);
    } else {
      head = `<span class="team-dot"></span><b>${t ? esc(t.name) : 'Zuschauer'}</b>${t && v.phase !== 'lobby' ? `<span class="phone-score">${num(t.score)}</span>` : ''}`;
      if (v.phase === 'lobby') body = phoneLobbyHtml(v);
      else if (v.phase === 'over') body = phoneOverHtml(v);
      else if (!t || !v.order.includes(t.id)) body = phoneGuestHtml(v);
      else body = phonePlayHtml(v, t);
    }
    return `
      <div class="phone ${me.role === 'qm' ? 'is-qm' : t ? 'team-' + t.id : ''}">
        <header class="phone-head">
          ${head}
          <span class="phone-name">${esc(me.name)}</span>
          <button class="icon-btn" data-act="menu" aria-label="Menü">☰</button>
        </header>
        ${phoneStatusBanner()}
        <main class="phone-main">${body}</main>
      </div>`;
  }

  function phoneLobbyHtml(v) {
    const write = v.settings.input === 'write';
    const active = v.teams.filter((t) => t.active);
    const qmFree = v.settings.host === 'qm' && (!v.qm || !v.qm.online);
    const teams = write
      ? `<h2 class="phone-title">Wähle dein Team</h2>
        <div class="team-pick">
        ${active
          .map(
            (t) => `
          <button class="team-btn team-${t.id} ${v.me.team === t.id ? 'is-mine' : ''}" data-act="join-team" data-team="${t.id}" aria-pressed="${v.me.team === t.id}">
            <b>${esc(t.name)} ${v.me.team === t.id ? '✓' : ''}</b>
            <small>${t.players.length ? t.players.map((p) => esc(p.name)).join(' · ') : 'noch leer'}</small>
          </button>`
          )
          .join('')}
        </div>`
      : '';
    return `
      ${teams}
      ${qmFree ? `<button class="btn btn-ghost btn-wide qm-btn" data-act="become-qm">🎤 Quizmaster werden <small>liest vor, sieht die Antworten, entscheidet</small></button>` : ''}
      <p class="waiting">${v.me.team ? '⏳ Warte, bis es am Laptop losgeht…' : write ? 'Tippe auf ein Team.' : ''}</p>`;
  }

  function phoneGuestHtml(v) {
    const write = v.settings.input === 'write';
    const qmFree = v.settings.host === 'qm' && (!v.qm || !v.qm.online);
    return `
      <div class="look-up">👀<b>Schau auf die Wand!</b><small>${write ? 'Du schaust gerade zu.' : 'Gespielt wird am Laptop.'}</small></div>
      ${qmFree ? `<button class="btn btn-primary btn-wide qm-btn" data-act="become-qm">🎤 Quizmaster werden</button>` : ''}
      ${
        write
          ? `<p class="center">Einem Team beitreten:</p>
             <div class="team-pick">${v.order
               .map((id) => teamOf(v, id))
               .map((x) => `<button class="team-btn team-${x.id}" data-act="join-team" data-team="${x.id}"><b>${esc(x.name)}</b></button>`)
               .join('')}</div>`
          : ''
      }`;
  }

  function miniScoresHtml(v) {
    return `<div class="mini-scores">${v.order
      .map((id) => {
        const t = teamOf(v, id);
        return `<span class="mini-score team-${id} ${v.turn === id ? 'is-turn' : ''}"><span class="team-dot"></span>${esc(t.name)} <b>${num(t.score)}</b></span>`;
      })
      .join('')}</div>`;
  }

  function buzzState(v, t) {
    const c = v.cur;
    const now = performance.now();
    if (c.locked.includes(t.id)) return { cls: 'out', label: 'Raus', small: 'Ihr habt falsch geantwortet – diesmal nicht mehr' };
    if (v.phase === 'buzzed') {
      if (c.buzzed.team === t.id) return { cls: 'mine', label: 'Ihr seid dran!', small: c.buzzed.name ? `${c.buzzed.name} war am schnellsten – antwortet laut!` : 'Antwortet laut!' };
      return { cls: 'other', label: teamName(v, c.buzzed.team), small: 'war schneller …' };
    }
    if (ui.buzz.lockUntil > now) return { cls: 'lock', label: 'Zu früh! 🙈', small: 'kurz gesperrt' };
    if (v.phase === 'read') return { cls: 'wait', label: 'Gleich …', small: 'Erst wenn der Buzzer frei ist – sonst kurz gesperrt!' };
    if (ui.buzz.sent === c.openId || c.myBuzz) return { cls: 'sent', label: 'Gedrückt!', small: 'Mal sehen, wer schneller war …' };
    return { cls: 'open', label: 'BUZZ!', small: 'Jetzt drücken!' };
  }

  function phonePlayHtml(v, t) {
    const c = v.cur;
    const mine = v.turn === t.id;
    switch (v.phase) {
      case 'board':
        return mine
          ? `<h2 class="phone-title">Ihr seid dran – wählt ein Feld!</h2>${wallHtml(v, { pick: true, mini: true })}${miniScoresHtml(v)}`
          : `<div class="look-up small">⏳ ${esc(teamName(v, v.turn))} wählt ein Feld …</div>${wallHtml(v, { mini: true })}${miniScoresHtml(v)}`;
      case 'read':
      case 'open':
      case 'buzzed': {
        const st = buzzState(v, t);
        return `
          <div class="phone-q"><small>${esc(c.cat)} · ${c.value}</small>${c.clue ? `<p>${esc(c.clue)}</p>` : ''}</div>
          <button class="buzz-btn state-${st.cls} ${st.label.length > 9 ? 'is-long' : ''}" data-buzz ${['open', 'wait'].includes(st.cls) ? '' : 'aria-disabled="true"'}>
            <b>${esc(st.label)}</b><small>${esc(st.small)}</small>
          </button>
          <p class="muted small center">👀 Schau auf die Wand</p>`;
      }
      case 'wager':
        return mine
          ? `<div class="joker-banner team-${t.id}">🎲 JOKER-FELD!<small>${esc(c.cat)} · nur ihr dürft antworten</small></div>
             <p class="center">Wie viel setzt ihr? <b>Geheim</b> – die Frage kommt danach.</p>
             ${wagerFormHtml(c.range, 'wager', 'Euer Einsatz', `data-no="${c.no}"`)}`
          : `<div class="look-up">🎲<b>Joker-Feld!</b><small>${esc(teamName(v, v.turn))} setzt einen Einsatz …</small></div>`;
      case 'joker':
        return mine
          ? `<div class="look-up win">🎲<b>Ihr seid dran!</b><small>Einsatz ${num(c.wager)} – antwortet laut</small></div><div class="phone-q"><small>${esc(c.cat)}</small>${c.clue ? `<p>${esc(c.clue)}</p>` : ''}</div>`
          : `<div class="look-up">🎲<b>${esc(teamName(v, v.turn))} beantwortet den Joker</b><small>Einsatz ${num(c.wager)}</small></div>`;
      case 'reveal': {
        const r = c.result;
        return `
          <div class="look-up ${r.team === t.id ? 'win' : ''}">${r.team === t.id ? '🎉' : r.team ? '🙂' : '🤷'}<b>${r.team ? `${esc(teamName(v, r.team))} ${signed(r.delta)}` : 'Niemand wusste es'}</b></div>
          ${c.solution ? solutionHtml(v, c) : ''}
          ${miniScoresHtml(v)}`;
      }
      case 'roundEnd':
        return roundEndHtml(v, false);
      case 'finalWager':
      case 'finalQ':
      case 'finalReveal':
        return phoneFinalHtml(v, t);
      default:
        return '<div class="look-up">👀<b>Schau auf die Wand!</b></div>';
    }
  }

  function phoneFinalHtml(v, t) {
    const f = v.final;
    const eligible = f.eligible.includes(t.id);
    if (!eligible) {
      return `${finalCatHtml(f)}<div class="look-up">🍿<b>Ihr schaut zu</b><small>Im Finale spielen nur Teams mit Punkten.</small></div>`;
    }
    if (v.phase === 'finalWager') {
      const w = f.wagers[t.id];
      return `
        ${finalCatHtml(f)}
        ${
          w != null && !ui.rewager
            ? `<div class="submitted"><small>Euer Einsatz</small><b>${num(w)}</b><button class="btn btn-ghost btn-small" data-act="final-rewager">✏️ Ändern</button></div>
               <p class="waiting">⏳ Warte auf die anderen Teams …</p>`
            : `<p class="center">Wie viel setzt ihr auf diese Kategorie? <b>Geheim!</b></p>${wagerFormHtml(f.myRange, 'final-wager', 'Euer Einsatz')}`
        }`;
    }
    if (v.phase === 'finalQ') {
      const a = f.answers[t.id];
      return `
        <div class="phone-q"><small>🏁 ${esc(f.cat)} · Einsatz ${num(f.wagers[t.id] || 0)}</small><p>${esc(f.q)}</p></div>
        ${timerHtml(Object.assign({ kind: 'answer' }, f.timer), { tick: true })}
        <form class="word-form" data-form="final-answer">
          <input id="final-input" class="input input-word" type="text" maxlength="${MAX_ANSWER}" placeholder="Eure Antwort" value="${esc(ui.answerDraft)}" data-field="final-answer" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="send" />
          <button class="btn btn-primary btn-big btn-wide" type="submit">${a ? 'Ändern ✓' : 'Abgeben ✓'}</button>
        </form>
        ${a ? `<div class="submitted"><small>Abgegeben${a.by ? ' von ' + esc(a.by) : ''}</small><b>${esc(a.text)}</b></div>` : '<p class="muted small center">Ein Handy pro Team reicht – die letzte Antwort zählt.</p>'}`;
    }
    const r = f.results[t.id];
    return `
      ${finalCatHtml(f)}
      ${
        r
          ? `<div class="look-up ${r.ok ? 'win' : ''}">${r.ok ? '🎉' : '😬'}<b>${r.ok ? 'Richtig!' : 'Leider falsch'}</b><small>Einsatz ${num(r.wager)} → ${num(t.score)} Punkte</small></div>`
          : `<div class="look-up">👀<b>Schau auf die Wand!</b><small>${f.current === t.id ? 'Jetzt wird eure Antwort aufgedeckt …' : 'Es wird vom letzten zum ersten Platz aufgedeckt.'}</small></div>`
      }
      ${f.a ? `<div class="solution"><small>Richtige Antwort</small><b>${esc(f.a)}</b></div>` : ''}`;
  }

  function phoneOverHtml(v) {
    const pl = places(v);
    const mine = pl.find((p) => p.team.id === v.me.team);
    let head = '<div class="look-up">🏁<b>Spiel vorbei!</b></div>';
    if (mine) {
      head =
        mine.place === 1
          ? `<div class="look-up win">🏆<b>${v.winners.length > 1 ? 'Geteilter Sieg!' : 'Ihr wisst mehr!'}</b><small>${num(mine.team.score)} Punkte</small></div>`
          : `<div class="look-up">🏅<b>Platz ${mine.place}</b><small>${num(mine.team.score)} Punkte</small></div>`;
    }
    return `${head}${rankingHtml(v)}<p class="muted small center">Am Laptop kann eine neue Runde gestartet werden.</p>`;
  }

  /* ---------- Quizmaster-Handy ---------- */

  function qmHtml(v) {
    const c = v.cur;
    const f = v.final;
    switch (v.phase) {
      case 'lobby':
        return `<div class="look-up">🎤<b>Du bist Quizmaster</b><small>Du liest die Fragen vor, siehst die Antworten und entscheidest ✓ / ✗. Gleich geht's los.</small></div>`;
      case 'board':
        return `<div class="look-up small">${esc(teamName(v, v.turn))} wählt ein Feld – du kannst es auch für sie antippen.</div>${wallHtml(v, { pick: true, mini: true })}${miniScoresHtml(v)}`;
      case 'roundEnd':
        return `${rankingHtml(v)}<button class="btn btn-primary btn-big btn-wide" data-act="next" data-phase="roundEnd">${v.round >= v.roundCount ? '🏁 Zum Finale' : `Runde ${v.round + 1} starten`} →</button>`;
      case 'over':
        return phoneOverHtml(v);
      case 'finalWager':
        return `${finalCatHtml(f)}${teamChecksHtml(v, f.eligible, f.wagered)}
          <div class="qm-answer"><small>Frage</small><p>${esc(f.q)}</p><small>Antwort</small><b>${esc(f.a)}</b></div>
          <button class="btn btn-primary btn-big btn-wide" data-act="next" data-phase="finalWager">Frage zeigen →</button>`;
      case 'finalQ':
        return `${finalCatHtml(f)}
          <div class="qm-answer"><small>Frage</small><p>${esc(f.q)}</p><small>Antwort</small><b>${esc(f.a)}</b></div>
          ${timerHtml(Object.assign({ kind: 'answer' }, f.timer))}
          ${teamChecksHtml(v, f.eligible, f.answered)}
          <button class="btn btn-ghost btn-wide" data-act="next" data-phase="finalQ">⏩ Jetzt auflösen</button>`;
      case 'finalReveal': {
        if (f.done) return `${rankingHtml(v)}<button class="btn btn-primary btn-big btn-wide" data-act="next" data-phase="finalReveal">🏆 Zur Siegerehrung</button>`;
        const id = f.current;
        const t = teamOf(v, id);
        const ans = f.answers[id];
        const phones = v.settings.input === 'write';
        return `
          <div class="qm-answer"><small>Richtige Antwort</small><b>${esc(f.a)}</b></div>
          <div class="final-panel team-${id}">
            <h3><span class="team-dot"></span>${esc(t.name)} <small>${num(t.score)} Punkte${phones ? ` · Einsatz ${num(f.wagers[id] || 0)}` : ''}</small></h3>
            ${phones ? `<div class="final-answer"><small>Antwort</small><b>${ans ? esc(ans.text) : '— keine —'}</b>${ans ? `<em class="${f.suggest ? 'ok-text' : 'bad-text'}">🤖 ${f.suggest ? 'sieht richtig aus' : 'sieht nicht richtig aus'}</em>` : ''}</div>` : ''}
            ${f.shown ? '' : `<button class="btn btn-ghost btn-wide" data-act="final-show">👀 ${phones ? 'Auf der Wand aufdecken' : 'Lösung auf der Wand zeigen'}</button>`}
            ${phones ? '' : `<label class="say-wager">Einsatz <small>(0 – ${num(t.score)})</small><input class="input" type="number" inputmode="numeric" min="0" max="${t.score}" value="${esc(ui.sayWager)}" data-field="say-wager" /></label>`}
            <div class="result-buttons">
              <button class="btn btn-result btn-ok" data-act="final-judge" data-ok="1" data-team="${id}">✓ Richtig</button>
              <button class="btn btn-result btn-bad" data-act="final-judge" data-ok="0" data-team="${id}">✗ Falsch</button>
            </div>
          </div>`;
      }
    }
    if (!c) return '<div class="look-up">👀<b>Schau auf die Wand!</b></div>';
    const head = `<div class="phone-q"><small>${esc(c.cat)} · ${c.value}${c.joker ? ' · 🎲 Joker' : ''}</small>${c.clue ? `<p>${esc(c.clue)}</p>` : ''}</div>
      <div class="qm-answer"><small>${v.settings.reverse ? 'Gesuchte Frage' : 'Antwort'}</small><b>${esc(c.solution)}</b></div>`;
    switch (v.phase) {
      case 'read':
        return `${head}<p class="center">Lies die Frage vor – dann den Buzzer freigeben.</p>
          <button class="btn btn-primary btn-big btn-wide" data-act="open" data-no="${c.no}">🔔 Buzzer frei</button>
          <button class="btn btn-link" data-act="resolve" data-no="${c.no}">Frage überspringen</button>`;
      case 'open':
        return `${head}${timerHtml(c.timer)}${attemptsHtml(v, c)}<p class="center">🔔 Buzzer ist frei …</p>
          <button class="btn btn-ghost btn-wide" data-act="resolve" data-no="${c.no}">🤷 Niemand weiß es – auflösen</button>`;
      case 'buzzed':
        return `${head}<div class="buzzed-banner team-${c.buzzed.team}"><span class="team-dot"></span><b>${esc(teamName(v, c.buzzed.team))}</b> antwortet <small>${c.buzzed.name ? esc(c.buzzed.name) : ''}</small></div>
          ${timerHtml(c.timer)}${attemptsHtml(v, c)}${judgeButtons(v, c)}`;
      case 'wager':
        return `<div class="joker-banner team-${v.turn}">🎲 Joker!<small>${esc(teamName(v, v.turn))} setzt auf dem Handy …</small></div>${head}
          ${fallbackHtml(c, 'Einsatz für das Team eintragen')}`;
      case 'joker':
        return `${head}<div class="buzzed-banner team-${v.turn}"><span class="team-dot"></span><b>${esc(teamName(v, v.turn))}</b> · Einsatz ${num(c.wager)}</div>${timerHtml(c.timer)}${judgeButtons(v, c)}`;
      case 'reveal':
        return `${head}<div class="look-up small">${c.result.team ? `${esc(teamName(v, c.result.team))} ${signed(c.result.delta)}` : 'Niemand wusste es'}</div>
          <button class="btn btn-primary btn-big btn-wide" data-act="next" data-no="${c.no}">Weiter →</button>`;
      default:
        return head;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Dialoge                                                             */
  /* ------------------------------------------------------------------ */

  function modalHtml() {
    if (!ui.modal) return '';
    let body = '';
    const v = ui.view;
    if (ui.modal === 'rules') body = rulesHtml();
    else if (ui.modal === 'menu') body = menuHtml();
    else if (ui.modal === 'qr') {
      const write = v && v.settings.input === 'write';
      body = `<h2>${write ? '📱 Mitspieler einladen' : '🎤 Quizmaster-Handy verbinden'}</h2>${roomBoxHtml(v && v.room, false)}
        <p class="muted small center">${write ? 'Wer jetzt beitritt, wählt ein Team und buzzert sofort mit.' : 'Das Handy des Quizmasters zeigt die Antworten und die Knöpfe ✓ / ✗.'}</p>
        <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig</button></div>`;
    } else if (ui.modal === 'adjust' && v) {
      body = `<h2>✏️ Punkte korrigieren</h2>
        <p class="muted small">Für Fehlentscheidungen oder Bonuspunkte.</p>
        <div class="adjust-list">${v.order
          .map((id) => {
            const t = teamOf(v, id);
            const steps = [-100, 100].map((d) => d * (v.round || 1));
            return `<div class="adjust-row team-${id}"><span class="team-dot"></span><b>${esc(t.name)}</b><span class="adjust-score">${num(t.score)}</span>
              ${steps.map((d) => `<button class="btn btn-small btn-ghost" data-act="adjust" data-team="${id}" data-delta="${d}">${signed(d)}</button>`).join('')}</div>`;
          })
          .join('')}</div>
        <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig</button></div>`;
    } else if (ui.modal === 'share' && ui.modalData) {
      const d = ui.modalData;
      body = `<h2>🔗 „${esc(d.title || 'Wand')}“ teilen</h2>
        <p class="muted small">Wer den Link öffnet, kann die Wand speichern und damit spielen. Die Fragen stecken im Link selbst – sie werden an keinen Server geschickt.</p>
        <input class="input" type="text" readonly value="${esc(d.link)}" data-field="share-link" />
        ${d.link.length <= QR_MAX_LINK ? `<div class="qr">${qrSvg(d.link)}</div>` : '<p class="muted small">Für einen QR-Code ist diese Wand zu groß – den Link per Nachricht schicken.</p>'}
        <div class="modal-actions"><button class="btn btn-primary" data-act="copy-link">📋 Link kopieren</button><button class="btn btn-ghost" data-act="close-modal">Schließen</button></div>`;
    } else if (ui.modal === 'import-wall' && ui.modalData) {
      const w = ui.modalData.wall;
      body = `<h2>🧩 Wand übernehmen?</h2>
        <p><b>${esc(w.title || 'Ohne Titel')}</b><br /><span class="muted">${esc(Editor.statsText(w))}</span></p>
        <p class="muted small">${esc(w.rounds.flatMap((r) => r.cats.map((k) => k.name)).join(' · '))}</p>
        <div class="modal-actions"><button class="btn btn-primary" data-act="wall-import-save">Speichern</button><button class="btn btn-ghost" data-act="close-modal">Abbrechen</button></div>`;
    } else if (ui.modal === 'confirm' && ui.confirm) {
      body = `
        <h2>${esc(ui.confirm.title)}</h2>
        <p>${esc(ui.confirm.text)}</p>
        <div class="modal-actions">
          <button class="btn ${ui.confirm.danger ? 'btn-danger' : 'btn-primary'}" data-act="confirm-yes">${esc(ui.confirm.yes)}</button>
          ${ui.confirm.no ? `<button class="btn btn-ghost" data-act="confirm-no">${esc(ui.confirm.no)}</button>` : ''}
          <button class="btn btn-ghost" data-act="close-modal">Abbrechen</button>
        </div>`;
    } else return '';
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
        <p>Das Quiz mit der <b>Fragenwand</b>: Kategorien nebeneinander, darunter Felder mit steigendem Wert. Der Laptop (oder Fernseher) ist die Wand.</p>
        <h3>Ablauf</h3>
        <p>Das Team, das dran ist, wählt ein Feld. Die Frage erscheint, nach dem Vorlesen ist der <b>Buzzer frei</b> (Signalton, der Rahmen leuchtet).
          Wer zu früh drückt, ist kurz gesperrt. Das schnellste Team antwortet laut:</p>
        <p><b>Richtig</b> → +Wert, dieses Team wählt das nächste Feld. <b>Falsch</b> → −Wert, der Buzzer ist für die anderen wieder frei.
          Buzzert 10 Sekunden lang niemand, wird die Antwort gezeigt und dasselbe Team wählt weiter.</p>
        <h3>🎲 Joker-Felder</h3>
        <p>Versteckt (Runde 1: eins, Runde 2: zwei – nie in der obersten Reihe). Nur das wählende Team antwortet und setzt vorher einen Einsatz:
          zwischen 5 und dem eigenen Punktestand – mindestens bis zum höchsten Feldwert der Runde. Richtig +Einsatz, falsch −Einsatz.</p>
        <h3>Runden</h3>
        <p>Runde 1: 100–500 · Runde 2: doppelte Werte (200–1000), das Team mit den wenigsten Punkten beginnt · dann das Finale.</p>
        <h3>🏁 Finale</h3>
        <p>Erst wird nur die Kategorie gezeigt. Jedes Team mit mehr als 0 Punkten setzt geheim (0 bis Punktestand).
          Dann kommt die Frage, 30 Sekunden Zeit, jedes Team schreibt geheim (Handy oder Zettel). Aufgedeckt wird vom letzten zum ersten Platz.</p>
        <h3>🎤 Quizmaster</h3>
        <p>Mit Quizmaster sieht eine Person die Antworten (auf dem Handy) und entscheidet. Ohne Quizmaster wird nach der Antwort aufgedeckt
          und die Runde entscheidet – es zählt, was <b>sinngemäß</b> stimmt; im Zweifel entscheiden die anderen Teams.</p>
        <h3>🗣️ Ohne Handy</h3>
        <p>Buzzer-Tasten am Laptop: 🔴 <kbd>A</kbd> · 🔵 <kbd>F</kbd> · 🟢 <kbd>J</kbd> · 🟡 <kbd>L</kbd> – oder Team unten anklicken.
          <kbd>Leertaste</kbd> = Buzzer frei / Antwort zeigen / weiter, <kbd>R</kbd> = richtig, <kbd>X</kbd> = falsch.</p>
        <h3>📱 Mit Handy</h3>
        <p>Jedes Handy misst selbst, wie schnell nach „Buzzer frei“ gedrückt wurde – so gewinnt die schnellste Hand, nicht das schnellste WLAN.</p>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Alles klar!</button></div>`;
  }

  function menuHtml() {
    const v = ui.view;
    const items = [];
    items.push(`<button class="menu-item" data-act="rules">📖 Spielregeln</button>`);
    items.push(`<button class="menu-item" data-act="mute">${Sound.muted ? '🔊 Ton einschalten' : '🔇 Ton ausschalten'}</button>`);
    if (v && v.me.stage) {
      const c = v.cur;
      if (v.room) items.push(`<button class="menu-item" data-act="show-qr">${v.settings.input === 'write' ? '📱 Mitspieler einladen' : '🎤 Quizmaster-Handy verbinden'}</button>`);
      if (!['lobby', 'over'].includes(v.phase)) items.push(`<button class="menu-item" data-act="adjust-open">✏️ Punkte korrigieren</button>`);
      if (c && ['read', 'open', 'wager'].includes(v.phase)) items.push(`<button class="menu-item" data-act="resolve" data-no="${c.no}">⏭ Frage überspringen</button>`);
      if (['board', 'reveal'].includes(v.phase)) items.push(`<button class="menu-item" data-act="skip-round">⏩ Runde beenden</button>`);
      items.push(`<button class="menu-item" data-act="home-keep">🏠 Hauptmenü <small>(Spiel bleibt gespeichert)</small></button>`);
      if (!['lobby', 'over'].includes(v.phase)) items.push(`<button class="menu-item danger" data-act="end-game">⏹️ Spiel beenden & Ergebnis zeigen</button>`);
      items.push(`<button class="menu-item danger" data-act="close-game">🚪 Spiel schließen</button>`);
    } else if (v) {
      if (v.phase === 'lobby' && v.me.team) items.push(`<button class="menu-item" data-act="join-team" data-team="">↩️ Team verlassen</button>`);
      if (v.me.role === 'qm') items.push(`<button class="menu-item" data-act="leave-qm">🎤 Quizmaster abgeben</button>`);
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

  function setSetting(scope, key, value) {
    if (scope === 'setup') {
      ui.setup.settings = sanitizeSettings(Object.assign({}, ui.setup.settings, { [key]: value }), ui.setup.settings);
      // Eigene Wand gewählt, aber noch keine ausgesucht? Die neueste nehmen
      const s = ui.setup.settings;
      if (key === 'source' && s.source !== 'katalog' && !Board.getWall(s.wallId)) {
        const first = Board.listWalls()[0];
        s.wallId = first ? first.id : null;
      }
      ui.error = null;
      saveSetup();
      render();
    } else if (ui.view) {
      dispatch('settings', { settings: Object.assign({}, ui.view.settings, { [key]: value }) });
    }
  }

  function createGame() {
    const s = ui.setup;
    const st = s.settings;
    let wall = null;
    if (st.source !== 'katalog') {
      wall = Board.getWall(st.wallId);
      if (!wall) {
        ui.error = 'Bitte eine eigene Wand auswählen – oder „Katalog“ nehmen.';
        render();
        return;
      }
      if (!Board.sanitizeWall(wall)) {
        ui.error = 'Diese Wand hat noch keine Fragen.';
        render();
        return;
      }
    }
    ui.error = null;
    const state = Engine.create({ settings: st, teams: s.teams, wall });
    Sound.unlock();
    startStage({ state });
  }

  function stageBuzz(teamId) {
    const v = ui.view;
    if (!v || !v.me.stage || !v.cur || !['read', 'open'].includes(v.phase)) return;
    const reaction = v.phase === 'open' && ui.stageOpen.id === v.cur.openId ? Math.round(performance.now() - ui.stageOpen.at) : undefined;
    dispatch('buzz', { team: teamId, reaction });
  }

  /** Handy-Buzzer gedrückt (pointerdown – so schnell wie möglich) */
  function phoneBuzz() {
    const v = ui.view;
    if (!v || !v.cur || !v.me.team || !['read', 'open'].includes(v.phase)) return;
    const c = v.cur;
    if (c.locked.includes(v.me.team)) return;
    const now = performance.now();
    if (v.phase === 'read') {
      ui.buzz.lockUntil = now + EARLY_LOCK_MS;
      dispatch('buzz', { early: true });
      if (navigator.vibrate) navigator.vibrate(200);
      setTimeout(render, EARLY_LOCK_MS + 20);
      render();
      return;
    }
    if (ui.buzz.lockUntil > now || ui.buzz.sent === c.openId || c.myBuzz) return;
    const reaction = ui.buzz.openId === c.openId ? Math.round(now - ui.buzz.openAt) : 0;
    ui.buzz.sent = c.openId;
    dispatch('buzz', { openId: c.openId, reaction });
    if (navigator.vibrate) navigator.vibrate(30);
    render();
  }

  const actions = Object.assign({}, Editor.actions, {
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
    rules: () => showModal('rules'),
    menu: () => showModal('menu'),
    'close-modal': () => {
      ui.modal = null;
      ui.modalData = null;
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
    'confirm-no': () => {
      const run = ui.confirm && ui.confirm.runNo;
      ui.modal = null;
      ui.confirm = null;
      if (run) run();
      render();
    },
    mute: () => {
      Sound.setMuted(!Sound.muted);
      render();
    },
    'show-qr': () => showModal('qr'),
    'adjust-open': () => showModal('adjust'),
    adjust: (el) => dispatch('adjust', { team: el.dataset.team, delta: +el.dataset.delta }),
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
        text: 'Das Spiel endet sofort mit dem aktuellen Punktestand.',
        yes: 'Beenden',
        danger: true,
        run: () => dispatch('end'),
      }),

    /* Setup */
    set: (el) => {
      const key = el.dataset.key;
      let value = el.dataset.value;
      if (['cols', 'answerSec'].includes(key)) value = +value;
      setSetting(el.dataset.scope, key, value);
    },
    toggle: (el) => {
      const s = el.dataset.scope === 'setup' ? ui.setup.settings : ui.view.settings;
      setSetting(el.dataset.scope, el.dataset.key, !s[el.dataset.key]);
    },
    'team-toggle': (el) => {
      const t = ui.setup.teams[+el.dataset.team];
      if (t.active && ui.setup.teams.filter((x) => x.active).length <= 1) return;
      t.active = !t.active;
      saveSetup();
      render();
    },
    'create-game': createGame,

    /* Lobby */
    'lobby-team': (el) => dispatch('teamActive', { team: el.dataset.team, active: el.dataset.on === '1' }),
    kick: (el) => dispatch('kick', { player: el.dataset.player }),
    start: () => dispatch('start'),
    'join-team': (el) => {
      ui.modal = null;
      dispatch('joinTeam', { team: el.dataset.team || null });
    },
    'become-qm': () => dispatch('becomeQM'),
    'leave-qm': () => dispatch('leaveQM'),

    /* Spiel */
    pick: (el) => dispatch('pick', { col: +el.dataset.col, row: +el.dataset.row }),
    open: (el) => dispatch('open', { no: +el.dataset.no || undefined }),
    resolve: (el) => dispatch('resolve', { no: +el.dataset.no || undefined }),
    show: (el) => dispatch('show', { no: +el.dataset.no || undefined }),
    judge: (el) => dispatch('judge', { ok: el.dataset.ok === '1', no: +el.dataset.no || undefined }),
    next: (el) => dispatch('next', { no: el.dataset.no ? +el.dataset.no : undefined, phase: el.dataset.phase || undefined }),
    'stage-buzz': (el) => stageBuzz(el.dataset.team),
    'skip-round': () =>
      askConfirm({
        title: 'Runde beenden?',
        text: 'Die übrigen Felder dieser Runde werden übersprungen.',
        yes: 'Runde beenden',
        danger: true,
        run: () => dispatch('skipRound'),
      }),
    again: () => dispatch('again'),
    'final-show': () => dispatch('finalShow'),
    'final-judge': (el) => {
      const v = ui.view;
      const extra = { ok: el.dataset.ok === '1', team: el.dataset.team };
      if (v.settings.input === 'say') {
        const w = parseInt(ui.sayWager, 10);
        const t = teamOf(v, el.dataset.team);
        if (!Number.isFinite(w) || w < 0 || w > t.score) {
          toast(`Bitte erst den Einsatz von ${t.name} eintragen (0 – ${num(t.score)}).`);
          ui.focus = '[data-field="say-wager"]';
          return;
        }
        extra.wager = w;
      }
      dispatch('finalJudge', extra);
    },
    'final-rewager': () => {
      const v = ui.view;
      ui.wagerDraft = String(v.final.wagers[v.me.team] || '');
      ui.rewager = true;
      ui.focus = '[data-field="wager"]';
      render();
    },
    fallback: () => {
      ui.fallback = true;
      ui.focus = '[data-field="wager"]';
      render();
    },
  });

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
    if (ui.modal === 'menu' && el.closest('.modal') && !['close-modal', 'mute'].includes(el.dataset.act)) ui.modal = null;
    fn(el, e);
  });

  // Buzzer und „Antwort ansehen“ reagieren schon beim Drücken
  app.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-buzz]')) {
      e.preventDefault();
      Sound.unlock();
      phoneBuzz();
    } else if (e.target.closest('[data-peek]')) {
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
  app.addEventListener('pointerup', endPeek);
  app.addEventListener('pointercancel', endPeek);
  app.addEventListener('pointerleave', endPeek);
  app.addEventListener('contextmenu', (e) => {
    if (e.target.closest('[data-buzz], [data-peek]')) e.preventDefault();
  });

  app.addEventListener('input', (e) => {
    const el = e.target;
    if (Editor.onInput(el)) return;
    const f = el.dataset && el.dataset.field;
    if (!f) return;
    if (f === 'team-name') {
      ui.setup.teams[+el.dataset.team].name = el.value;
      saveSetup();
    } else if (f === 'name') ui.name = el.value;
    else if (f === 'join-code') ui.joinCode = Net.cleanCode(el.value);
    else if (f === 'wager') ui.wagerDraft = el.value;
    else if (f === 'final-answer') ui.answerDraft = el.value;
    else if (f === 'say-wager') ui.sayWager = el.value;
  });

  app.addEventListener('change', (e) => {
    const el = e.target;
    if (Editor.onChange(el)) return;
    if (el.dataset && el.dataset.field === 'lobby-team-name') dispatch('teamName', { team: el.dataset.team, name: el.value });
  });

  app.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key !== 'Enter' || !el.dataset) return;
    if (el.dataset.field === 'name') {
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
    if (Editor.onSubmit(form)) return;
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
    } else if ((form.dataset.form === 'wager' || form.dataset.form === 'final-wager') && v) {
      const input = form.querySelector('[data-field="wager"]');
      const amount = parseInt(input.value, 10);
      const range = form.dataset.form === 'wager' ? v.cur && v.cur.range : v.final && v.final.myRange;
      if (!range || !Number.isFinite(amount) || amount < range.min || amount > range.max) {
        toast(`Bitte eine Zahl zwischen ${range ? range.min : JOKER_MIN} und ${range ? num(range.max) : '…'} eingeben.`);
        return;
      }
      input.blur();
      ui.wagerDraft = '';
      ui.rewager = false;
      if (form.dataset.form === 'wager') dispatch('wager', { amount, no: +form.dataset.no || undefined });
      else dispatch('finalWager', { amount });
    } else if (form.dataset.form === 'final-answer' && v) {
      const input = form.querySelector('[data-field="final-answer"]');
      const text = input.value.trim();
      if (!text) return;
      input.blur();
      ui.answerDraft = '';
      dispatch('finalAnswer', { text });
    }
  });

  /** Tastatur am Laptop: Buzzer-Tasten, Leertaste, R / X */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.modal) {
      ui.modal = null;
      ui.modalData = null;
      ui.confirm = null;
      render();
      return;
    }
    const v = ui.view;
    if (!v || !v.me.stage || ui.screen !== 'stage' || ui.modal || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    const key = e.key.toUpperCase();
    const c = v.cur;
    if (['read', 'open'].includes(v.phase)) {
      const t = TEAMS.find((x) => x.key === key && v.order.includes(x.id));
      if (t) {
        e.preventDefault();
        Sound.unlock();
        stageBuzz(t.id);
        return;
      }
    }
    if (key === ' ' || e.code === 'Space') {
      const btn =
        (v.phase === 'read' && app.querySelector('[data-act="open"]')) ||
        (['buzzed', 'joker'].includes(v.phase) && app.querySelector('.stage [data-act="show"]')) ||
        (v.phase === 'finalReveal' && !v.final.done && app.querySelector('.stage [data-act="final-show"]')) ||
        app.querySelector('.stage .stage-actions [data-act="next"]');
      if (btn) {
        e.preventDefault();
        btn.click();
      }
      return;
    }
    if (c && ['buzzed', 'joker'].includes(v.phase) && (key === 'R' || key === 'X')) {
      e.preventDefault();
      Sound.unlock();
      dispatch('judge', { ok: key === 'R', no: c.no });
    }
  });

  window.addEventListener('beforeunload', () => {
    if (ui.ctrl && ui.ctrl.mode === 'client') ui.ctrl.bye();
  });

  window.addEventListener('hashchange', () => Editor.checkHash());

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
      else if (session('wkm.screen') === 'editor' && Editor.restoreDraft()) ui.screen = 'editor';
      render();
    }
    Editor.checkHash();
  }

  // Editor-Bildschirm über ein Neuladen hinweg merken
  setInterval(() => session('wkm.screen', ui.screen === 'editor' ? 'editor' : null), 1000);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.WKM_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  requestAnimationFrame(timerLoop);
  autoResume();

  // für Tests
  window.WKMApp = { ui, render: renderNow, actions };
})();
