/*
 * Oberfläche von „2 Dumme, 1 Gedanke“.
 *  - Laptop („Bühne“): Spiel anlegen, Lobby mit QR-Code, Begriffe, Ketten, Aufdecken, Punktestand
 *  - Handy (Mitspieler): Team wählen, geheim tippen, eigenes Ergebnis
 * Gerendert wird per HTML-String + morphdom (nur geänderte Teile werden ersetzt).
 */
(function () {
  'use strict';

  const { TEAMS, ROUND_OPTIONS, SECONDS_OPTIONS, MAXSTEP_OPTIONS, BEGRIFF_POINTS, MAX_WORD, Engine, sanitizeSettings } = window.ZDEngine;
  const { StageController, ClientController, Store, KEYS, Net, inviteLink, qrSvg } = window.ZDControllers;
  const { Sound, confetti } = window.GameFx;
  const M = window.ZDMatch;
  const Deck = window.ZDDeck;

  const TEAM_COLOR = { rot: '#ef4444', blau: '#3b82f6', gruen: '#22c55e', gelb: '#facc15' };
  const GROUP_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6'];
  const MODE = {
    kette: {
      icon: '🔗',
      label: 'Gedankenkette',
      text: 'Alle im Team nennen gleichzeitig ein Wort – und suchen dann Runde für Runde ein Wort, das die letzten Wörter verbindet. Bis alle dasselbe sagen!',
    },
    begriff: {
      icon: '🎯',
      label: 'Ein Begriff',
      text: 'Ihr bekommt einen Begriff wie „Strand“. Wer im Team nennt dasselbe Wort dazu? Alle gleich gibt die meisten Punkte.',
    },
  };
  const INPUT = {
    say: { icon: '🗣️', label: 'Ohne Handy', text: 'Wörter laut sagen. Die Teams sind nacheinander dran, das Ergebnis wird am Laptop eingetragen.' },
    write: { icon: '✍️', label: 'Mit Handy', text: 'Alle verbinden ihr Handy per QR-Code und tippen geheim. Alle Teams spielen gleichzeitig.' },
  };
  const KIND_LABEL = { einzel: 'Begriff', kategorie: 'Kategorie', luecke: 'Ergänze' };
  const OUTCOME = {
    all: { icon: '🎉', label: 'Alle gleich!' },
    some: { icon: '🤏', label: 'Teilweise' },
    none: { icon: '❌', label: 'Keine Übereinstimmung' },
  };
  const SETUP_KEY = 'zweidumme.setup.v1';
  const PREFS_KEY = 'zweidumme.prefs.v1';
  const ACTIVE_KEY = 'zweidumme.active';
  const MAX_SETUP_PLAYERS = 12;
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

  function defaultSetup(mode) {
    return {
      settings: sanitizeSettings({ mode: mode || 'begriff' }),
      teams: TEAMS.map((t, i) => ({ id: t.id, active: i < 2, name: '', players: ['', ''] })),
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

  function teamOf(v, id) {
    return v.teams.find((t) => t.id === id);
  }

  function playerName(v, pid) {
    for (const t of v.teams) {
      const p = t.players.find((x) => x.id === pid);
      if (p) return p.name;
    }
    const m = v.members.find((x) => x.id === pid);
    return m ? m.name : '?';
  }

  function isOnline(v, pid) {
    if (v.settings.input !== 'write') return true;
    const m = v.members.find((x) => x.id === pid);
    return !!(m && m.online);
  }

  /** Platzierungen mit geteilten Plätzen bei Gleichstand */
  function places(v) {
    return v.ranking.map((id) => {
      const t = teamOf(v, id);
      const better = v.ranking.filter((o) => teamOf(v, o).score > t.score).length;
      return { team: t, place: better + 1 };
    });
  }

  /** Wörter der letzten aufgedeckten Runde einer Kette (oder die Startwörter) */
  function bridgeWords(ch) {
    if (ch.steps.length) return ch.steps[ch.steps.length - 1].words.map((w) => w.word).filter(Boolean);
    return ch.start ? ch.start.slice() : [];
  }

  function chainWords(ch) {
    const out = (ch.start || []).slice();
    for (const st of ch.steps) for (const w of st.words) if (w.word) out.push(w.word);
    return out;
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
    wordError: null,
    modal: null,
    confirm: null,
    toast: null,
    flash: null,
    countdown: null,
    draft: '',
    sayWords: [],
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
  function flash(text, team) {
    ui.flash = { text, team, id: ++flashNo };
    clearTimeout(ui.flashTimer);
    ui.flashTimer = setTimeout(() => {
      ui.flash = null;
      render();
    }, 2200);
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
    ui.countdown = null;
    ui.flash = null;
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
      stage:
        stage && stage.state && stage.state.phase !== 'over' && now - (stage.savedAt || 0) < RESUME_MAX_AGE ? stage : null,
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
    if (!prev || prev.me.stepKey !== v.me.stepKey) {
      ui.draft = '';
      ui.wordError = null;
    }
    const sayKey = (x) => (x && x.cur && x.cur.kind === 'kette' && x.cur.team ? `${x.cur.no}-${x.cur.team}-${x.cur.chains[x.cur.team].steps.length}` : null);
    if (sayKey(prev) !== sayKey(v)) ui.sayWords = [];
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
    if (!prev) return;
    const stage = !!v.me.stage;
    const c = v.cur;
    const pc = prev.cur;
    if (v.phase === 'over' && prev.phase !== 'over') {
      ui.flash = null;
      Sound.fanfare();
      const colors = v.winners.map((id) => TEAM_COLOR[id]);
      setTimeout(() => confetti(colors.concat('#ffffff', '#facc15'), 260), 150);
      setTimeout(() => confetti(colors.concat('#ffffff'), 160), 900);
      return;
    }
    if (!c) return;
    if (!pc || pc.no !== c.no) {
      Sound.start();
      return;
    }
    if (c.kind === 'begriff') {
      if (v.phase === 'reveal' && prev.phase !== 'reveal') {
        Sound.flip();
        const outcome = (id) => {
          const r = c.results[id];
          return r ? (r.second || r).outcome : 'none';
        };
        if (stage) {
          const hits = c.active.filter((id) => outcome(id) === 'all');
          setTimeout(() => {
            if (hits.length) {
              Sound.success();
              confetti(hits.map((id) => TEAM_COLOR[id]).concat('#ffffff'), 140);
            } else Sound.fail();
          }, 900 + c.active.length * 500);
        } else if (v.me.team && c.active.includes(v.me.team)) {
          if (outcome(v.me.team) === 'all') {
            Sound.success();
            confetti([TEAM_COLOR[v.me.team], '#ffffff'], 100);
          } else Sound.fail();
          if (navigator.vibrate) navigator.vibrate(80);
        }
      }
      if (c.last && (!pc.last || pc.last.n !== c.last.n)) {
        const t = teamOf(v, c.last.team);
        if (c.last.outcome === 'all') {
          Sound.success();
          confetti([TEAM_COLOR[t.id], '#ffffff'], 120);
        } else Sound.fail();
        flash(`${OUTCOME[c.last.outcome].icon} ${t.name}: +${c.last.points}`, t.id);
      }
      return;
    }
    for (const [id, ch] of Object.entries(c.chains)) {
      const pch = pc.chains[id];
      if (!pch) continue;
      const mine = !stage && v.me.team === id;
      if (!stage && !mine) continue;
      if (ch.steps.length > pch.steps.length) Sound.flip();
      if (ch.hit && !pch.hit) {
        setTimeout(() => {
          Sound.success();
          confetti([TEAM_COLOR[id], '#ffffff'], 120);
        }, 500);
        if (stage) flash(`🎉 ${teamOf(v, id).name}: Treffer nach ${ch.hit} ${plural(ch.hit, 'Runde', 'Runden')}! +${ch.points}`, id);
        if (mine && navigator.vibrate) navigator.vibrate([60, 60, 60]);
      } else if (ch.done && !pch.done) {
        setTimeout(() => Sound.fail(), 500);
        if (stage) flash(`${ch.gaveUp ? '🏳️' : '❌'} ${teamOf(v, id).name}: nicht geschafft`, id);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Timer & Countdown                                                   */
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
      el.classList.toggle('urgent', sec <= 5);
      if (el.hasAttribute('data-tick') && el.dataset.last !== String(sec)) {
        if (el.dataset.last && sec <= 5 && sec > 0) Sound.tick(sec <= 3);
        el.dataset.last = String(sec);
      }
    }
  }

  /** Countdown 3 – 2 – 1 – Jetzt! (ohne Handy, damit alle gleichzeitig rufen) */
  function runCountdown() {
    if (ui.countdown) return;
    Sound.unlock();
    const steps = [3, 2, 1, 'go'];
    let i = 0;
    const next = () => {
      if (i >= steps.length) {
        ui.countdown = null;
        render();
        return;
      }
      ui.countdown = steps[i];
      if (steps[i] === 'go') Sound.start();
      else Sound.tick(true);
      i += 1;
      render();
      ui.countdownTimer = setTimeout(next, ui.countdown === 'go' ? 900 : 750);
    };
    next();
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
    if (ui.countdown) {
      html += `<div class="countdown" aria-live="assertive"><span id="cd-${ui.countdown}">${ui.countdown === 'go' ? 'Jetzt!' : ui.countdown}</span></div>`;
    }
    if (ui.flash) html += `<div class="flash team-${ui.flash.team}" id="flash-${ui.flash.id}" role="status">${esc(ui.flash.text)}</div>`;
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
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="2 Dumme, 1 Gedanke">
      <span class="logo-icon" aria-hidden="true">🧠</span>
      <span class="logo-text"><span class="l1">2 Dumme,</span> <span class="l2">1 Gedanke</span></span>
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

  function settingsHtml(s, scope, editable) {
    const dis = !editable;
    const rows = [];
    rows.push(`
      <div class="setting">
        <div class="setting-label"><b>🔁 Durchgänge</b><small>${s.mode === 'kette' ? 'Jedes Team spielt pro Durchgang eine Kette' : 'Ein Begriff pro Durchgang'}</small></div>
        ${seg('rounds', ROUND_OPTIONS[s.mode], s.rounds, (o) => String(o), scope, dis)}
      </div>`);
    if (s.input === 'write') {
      rows.push(`
        <div class="setting">
          <div class="setting-label"><b>⏱ Zeit zum Eintippen</b><small>Wer nichts eintippt, zählt als „verschieden“</small></div>
          ${seg('seconds', SECONDS_OPTIONS, s.seconds, (o) => (o ? o + ' s' : 'Aus'), scope, dis)}
        </div>`);
    }
    if (s.mode === 'kette') {
      rows.push(`
        <div class="setting">
          <div class="setting-label"><b>🪜 Max. Runden pro Kette</b><small>Danach ist die Kette gescheitert (0 Punkte)</small></div>
          ${seg('maxSteps', MAXSTEP_OPTIONS, s.maxSteps, (o) => String(o), scope, dis)}
        </div>
        <div class="setting">
          <div class="setting-label"><b>🎲 Startwörter</b><small>${s.startWords === 'given' ? 'Die App gibt zwei Wörter vor, ihr sucht direkt die Brücke' : 'Runde 1: Jede/r sagt irgendein Wort'}</small></div>
          ${seg('startWords', ['free', 'given'], s.startWords, (o) => (o === 'free' ? 'Frei' : 'Vorgegeben'), scope, dis)}
        </div>`);
    } else {
      rows.push(`
        <div class="setting">
          <div class="setting-label"><b>🔁 Zweite Chance</b><small>Nicht alle gleich? Sofort eine Brücke zwischen den eigenen Wörtern suchen – geschafft gibt 2 Punkte</small></div>
          <button class="switch ${s.secondChance ? 'on' : ''}" role="switch" aria-checked="${s.secondChance}" data-act="toggle-second" data-scope="${scope}" ${dis ? 'disabled' : ''}>
            <span class="switch-knob"></span><span class="switch-text">${s.secondChance ? 'An' : 'Aus'}</span>
          </button>
        </div>`);
    }
    return `<div class="settings">${rows.join('')}</div>`;
  }

  function pointsInfoHtml(mode) {
    if (mode === 'kette') {
      return `<p class="points-info">Punkte: Treffer in Runde <b>1 = 5</b> · <b>2 = 4</b> · <b>3 = 3</b> · <b>4 = 2</b> · danach <b>1</b> · nicht geschafft <b>0</b></p>`;
    }
    return `<p class="points-info">Punkte: alle gleich <b>3</b> · mindestens zwei gleich <b>1</b> · keiner <b>0</b></p>`;
  }

  function termCardHtml(term, opts) {
    const o = opts || {};
    return `<div class="term-card ${o.small ? 'term-small' : ''}">
      <small>${KIND_LABEL[term.kind] || 'Begriff'}</small>
      <div class="term">${esc(term.text)}</div>
    </div>`;
  }

  function timerHtml(timer, tick) {
    if (!timer) return '';
    return `<div class="timer" data-timer ${tick ? 'data-tick' : ''} data-rem="${Math.round(timer.remaining)}" data-total="${timer.total}">
      <div class="timer-bar"><span data-timer-bar style="width:${(100 * timer.remaining) / (timer.total || 1)}%"></span></div>
      <b data-timer-text>${Math.ceil(timer.remaining / 1000)}</b>
    </div>`;
  }

  /** Wörter als Kärtchen; gleiche Wörter bekommen dieselbe Farbe */
  function tilesHtml(words, groups, opts) {
    const o = opts || {};
    const color = {};
    (groups || []).forEach((g, gi) => {
      if (g.length >= 2) for (const i of g) color[i] = GROUP_COLORS[gi % GROUP_COLORS.length];
    });
    return `<div class="tiles">${words
      .map((w, i) => {
        const word = w.word === undefined ? w : w.word;
        const style = [color[i] ? `--g:${color[i]}` : '', o.delay != null ? `--d:${(o.delay + i * 0.15).toFixed(2)}s` : ''].join(';');
        return `<span class="tile ${color[i] ? 'is-match' : ''} ${word ? '' : 'is-empty'} ${o.flip ? 'flip' : ''}" style="${style}">
          <b>${word ? esc(word) : '—'}</b>${o.names && w.name ? `<small>${esc(w.name)}</small>` : ''}
        </span>`;
      })
      .join('')}</div>`;
  }

  function statusChipsHtml(v, pids, answered) {
    return `<div class="pstats">${pids
      .map((pid) => {
        const done = answered.includes(pid);
        const on = isOnline(v, pid);
        return `<span class="pstat ${done ? 'done' : ''} ${on ? '' : 'off'}" title="${on ? '' : 'nicht verbunden'}">${done ? '✓' : on ? '💭' : '📴'} ${esc(playerName(v, pid))}</span>`;
      })
      .join('')}</div>`;
  }

  /* ---------- Startseite ---------- */

  function homeHtml() {
    const saves = savedGames();
    const resume = [];
    if (saves.stage) {
      const st = saves.stage.state;
      const teams = st.teams.filter((t) => st.order.includes(t.id) || st.phase === 'lobby').map((t) => t.name);
      resume.push(`
        <div class="resume">
          <button class="btn btn-ghost btn-wide" data-act="resume-stage">▶ Spiel fortsetzen
            <small>${MODE[st.settings.mode].label} · ${esc(teams.join(' · '))}</small></button>
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
      <button class="mode-card mode-${id}" data-act="new-game" data-mode="${id}">
        <span class="mode-icon">${MODE[id].icon}</span>
        <span class="mode-body"><b>${MODE[id].label}</b><small>${MODE[id].text}</small></span>
        <span class="mode-go">Spielen →</span>
      </button>`;
    return `
    <div class="screen home">
      <a class="btn btn-ghost btn-small hub-back" href="../">← Alle Spiele</a>
      <div class="home-hero">
        ${logoHtml()}
        <p class="tagline">Denkt ihr dasselbe? Das Gedankenlese-Spiel für Teams.</p>
      </div>
      ${resume.join('')}
      <div class="mode-cards">${modeCard('begriff')}${modeCard('kette')}</div>
      <div class="home-links">
        <button class="btn btn-ghost" data-act="join-screen">📱 Mit dem Handy beitreten</button>
        <button class="btn btn-link" data-act="rules">📖 Spielregeln</button>
      </div>
      <p class="home-foot">${Deck.stats().total} Begriffe · Laptop als Bühne, mit oder ohne Handys</p>
    </div>`;
  }

  /* ---------- Spiel anlegen (Laptop) ---------- */

  function setupHtml() {
    const s = ui.setup;
    const st = s.settings;
    const activeCount = s.teams.filter((t) => t.active).length;
    const inputCard = (id) => `
      <button class="input-card ${st.input === id ? 'on' : ''}" data-act="set" data-key="input" data-value="${id}" data-scope="setup" aria-pressed="${st.input === id}">
        <span class="input-icon">${INPUT[id].icon}</span>
        <b>${INPUT[id].label}</b>
        <small>${INPUT[id].text}</small>
      </button>`;
    const teams = s.teams
      .map((t, ti) => {
        const def = TEAMS[ti];
        if (!t.active) {
          return `<button class="team-setup team-${t.id} off" data-act="team-toggle" data-team="${ti}"><span class="ts-add">＋</span><span>Team ${def.label} hinzufügen</span></button>`;
        }
        const players =
          st.input === 'say'
            ? `<div class="ts-players">${t.players
                .map(
                  (p, pi) => `
                <div class="player-row">
                  <span class="player-num">${pi + 1}</span>
                  <input class="input" type="text" maxlength="24" placeholder="Spieler ${pi + 1}" value="${esc(p)}"
                    data-field="player-name" data-team="${ti}" data-player="${pi}" autocomplete="off" enterkeyhint="next" />
                  ${t.players.length > 2 ? `<button class="icon-btn" data-act="remove-player" data-team="${ti}" data-player="${pi}" aria-label="Spieler entfernen">✕</button>` : ''}
                </div>`
                )
                .join('')}</div>
              ${t.players.length < MAX_SETUP_PLAYERS ? `<button class="btn btn-small btn-ghost" data-act="add-player" data-team="${ti}">＋ Spieler</button>` : ''}`
            : `<p class="muted small">Die Spieler treten mit dem Handy bei.</p>`;
        return `
          <div class="team-setup team-${t.id}">
            <div class="ts-head">
              <span class="team-dot"></span>
              <input class="input input-team" type="text" maxlength="24" placeholder="Team ${def.label}" value="${esc(t.name)}"
                data-field="team-name" data-team="${ti}" autocomplete="off" aria-label="Teamname" />
              ${activeCount > 1 ? `<button class="icon-btn" data-act="team-toggle" data-team="${ti}" aria-label="Team entfernen" title="Team entfernen">✕</button>` : ''}
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
        <h2>Modus</h2>
        ${seg('mode', ['begriff', 'kette'], st.mode, (o) => `${MODE[o].icon} ${MODE[o].label}`, 'setup')}
        <p class="muted small mode-hint">${MODE[st.mode].text}</p>
        ${pointsInfoHtml(st.mode)}
      </section>
      <section class="panel">
        <h2>Spielweise</h2>
        <div class="input-cards">${inputCard('write')}${inputCard('say')}</div>
      </section>
      <section class="panel">
        <h2>Teams <small class="muted">(1–4${st.input === 'say' ? ', mindestens 2 Spieler pro Team' : ''})</small></h2>
        <div class="team-grid">${teams}</div>
      </section>
      <section class="panel">
        <h2>Einstellungen</h2>
        ${settingsHtml(st, 'setup', true)}
      </section>
      <div class="sticky-start">
        <button class="btn btn-primary btn-big" data-act="create-game">${st.input === 'write' ? 'Raum öffnen 📱' : 'Spiel starten 🧠'}</button>
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
    let round = '';
    if (v.phase === 'over') round = '<span class="pill">🏁 Spielende</span>';
    else if (v.tiebreak && v.phase !== 'lobby') round = '<span class="pill pill-hot">⚔️ Stechen</span>';
    else if (v.round) round = `<span class="pill">Durchgang ${v.round} / ${v.rounds}</span>`;
    const room = v.room && v.room.code && v.phase !== 'lobby' ? `<button class="pill pill-room" data-act="show-qr" title="Mitspieler einladen">📱 ${esc(v.room.code)}</button>` : '';
    return `
      <header class="topbar">
        <button class="topbar-brand" data-act="menu" aria-label="Menü">${logoHtml(true)}</button>
        <div class="topbar-info">
          <span class="pill">${MODE[v.settings.mode].icon} ${MODE[v.settings.mode].label}</span>
          ${round}
          ${room}
        </div>
        <div class="topbar-actions">
          <button class="icon-btn" data-act="mute" aria-label="Ton an/aus" title="Ton an/aus">${Sound.muted ? '🔇' : '🔊'}</button>
          <button class="icon-btn" data-act="menu" aria-label="Menü" title="Menü">☰</button>
        </div>
      </header>`;
  }

  function scoreboardHtml(v) {
    const ids = v.order;
    if (!ids.length) return '';
    const max = Math.max(1, ...ids.map((id) => teamOf(v, id).score));
    const lead = Math.max(...ids.map((id) => teamOf(v, id).score));
    const turn = v.cur && v.cur.team;
    return `
      <footer class="scoreboard" aria-label="Punktestand">
        ${ids
          .map((id) => {
            const t = teamOf(v, id);
            const playing = !v.cur || v.cur.teams.includes(id);
            return `
            <div class="score team-${id} ${turn === id ? 'is-turn' : ''} ${playing ? '' : 'is-out'}">
              <div class="score-head"><span class="team-dot"></span><b>${esc(t.name)}</b>${t.score === lead && lead > 0 && ids.length > 1 ? ' 👑' : ''}</div>
              <div class="score-bar"><span style="width:${(100 * t.score) / max}%"></span></div>
              <div class="score-num">${t.score}</div>
            </div>`;
          })
          .join('')}
      </footer>`;
  }

  function stageHtml(v) {
    let main;
    if (v.phase === 'lobby') main = lobbyStageHtml(v);
    else if (v.phase === 'over') main = overHtml(v);
    else if (v.cur.kind === 'begriff') main = v.settings.input === 'write' ? begriffWriteStage(v) : begriffSayStage(v);
    else main = v.settings.input === 'write' ? ketteWriteStage(v) : ketteSayStage(v);
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
            <h2>Teams</h2>
            <div class="team-grid">${teams}</div>
            ${free.length ? `<div class="free"><b>Noch ohne Team:</b> <div class="chips">${free.map(chip).join('')}</div></div>` : ''}
          </section>
          <section class="panel">
            <h2>Einstellungen</h2>
            ${seg('mode', ['begriff', 'kette'], v.settings.mode, (o) => `${MODE[o].icon} ${MODE[o].label}`, 'lobby')}
            ${pointsInfoHtml(v.settings.mode)}
            ${settingsHtml(v.settings, 'lobby', true)}
          </section>
          <div class="sticky-start">
            <button class="btn btn-primary btn-big" data-act="start" ${v.lobbyProblem ? 'disabled' : ''}>Spiel starten 🧠</button>
            ${v.lobbyProblem ? `<p class="muted small center">${esc(v.lobbyProblem)}</p>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ---------- Ein Begriff – mit Handy ---------- */

  function begriffWriteStage(v) {
    const c = v.cur;
    if (v.phase === 'play') {
      const second = c.attempt === 2;
      const teams = c.teams
        .map((id) => {
          const t = teamOf(v, id);
          const active = c.active.includes(id);
          const r = c.results[id];
          let extra = '';
          if (second && !active && r) extra = `<div class="tstat-done">✓ fertig · +${r.points}</div>`;
          if (second && active && r) extra = `<div class="tstat-bridge"><small>Brücke zwischen:</small>${tilesHtml(r.words, r.groups)}</div>`;
          return `
            <div class="tstat team-${id} ${active ? '' : 'is-idle'}">
              <h3><span class="team-dot"></span>${esc(t.name)}</h3>
              ${active ? statusChipsHtml(v, c.participants[id] || [], c.answered) : ''}
              ${extra}
            </div>`;
        })
        .join('');
      return `
        <div class="center-stage">
          ${second ? `<div class="banner">🔁 Zweite Chance! Findet eine Brücke zwischen euren Wörtern zu „${esc(c.term.text)}“</div>` : termCardHtml(c.term)}
          ${timerHtml(c.timer, true)}
          <p class="hint center">Alle tippen ihr Wort geheim ins Handy …</p>
          <div class="tstats">${teams}</div>
          <div class="stage-actions">
            ${second ? '' : '<button class="btn btn-ghost btn-small" data-act="skip-term">🔀 Anderer Begriff</button>'}
            <button class="btn btn-ghost btn-small" data-act="finish-round">⏩ Jetzt aufdecken</button>
          </div>
        </div>`;
    }
    const pending = c.active.some((id) => c.results[id] && !c.results[id].final);
    const cards = c.active.map((id, i) => revealCardHtml(v, id, c.results[id], i, c.attempt)).join('');
    const done = c.teams.filter((id) => !c.active.includes(id));
    return `
      <div class="center-stage">
        ${termCardHtml(c.term, { small: true })}
        <div class="reveal-grid">${cards}</div>
        ${done.length ? `<p class="muted center small">Schon fertig: ${done.map((id) => `${esc(teamOf(v, id).name)} (+${c.results[id].points})`).join(' · ')}</p>` : ''}
        <div class="stage-actions">
          <button class="btn btn-primary btn-big" data-act="next" data-no="${c.no}">${pending ? '🔁 Zweite Chance starten' : 'Weiter →'}</button>
        </div>
      </div>`;
  }

  function revealCardHtml(v, id, r, i, attempt) {
    const t = teamOf(v, id);
    const shown = r.second || r;
    const delay = 0.3 + i * 0.5;
    let result;
    if (!r.final) result = `<div class="outcome outcome-${r.outcome}">${OUTCOME[r.outcome].icon} ${OUTCOME[r.outcome].label} <span>→ Zweite Chance</span></div>`;
    else if (r.second) {
      result = `<div class="outcome outcome-${r.second.outcome}">${r.second.outcome === 'all' ? '🎉 Brücke geschafft!' : '❌ Brücke nicht geschafft'} <b>+${r.points}</b></div>`;
    } else result = `<div class="outcome outcome-${r.outcome}">${OUTCOME[r.outcome].icon} ${OUTCOME[r.outcome].label} <b>+${r.points}</b></div>`;
    return `
      <section class="reveal-card team-${id}" id="rv-${v.cur.no}-${attempt}-${id}" style="--d:${(delay + shown.words.length * 0.15 + 0.2).toFixed(2)}s">
        <h3><span class="team-dot"></span>${esc(t.name)}</h3>
        ${tilesHtml(shown.words, shown.groups, { names: true, flip: true, delay })}
        ${result}
      </section>`;
  }

  /* ---------- Ein Begriff – ohne Handy ---------- */

  function turnBannerHtml(v, t) {
    return `<div class="turn-banner team-${t.id}">
      <span class="team-dot"></span>
      <div><b>${esc(t.name)}</b> ${plural(t.players.length, 'ist', 'sind')} dran<small>${t.players.map((p) => esc(p.name)).join(' · ')}</small></div>
    </div>`;
  }

  function begriffSayStage(v) {
    const c = v.cur;
    if (v.phase === 'summary') {
      const rows = c.teams
        .map((id) => {
          const t = teamOf(v, id);
          const r = c.results[id];
          if (!r) return '';
          const oc = r.second ? (r.second.outcome === 'all' ? '🎉 Brücke geschafft' : '❌ Brücke nicht geschafft') : `${OUTCOME[r.outcome].icon} ${OUTCOME[r.outcome].label}`;
          return `<div class="summary-row team-${id}"><span class="team-dot"></span><b>${esc(t.name)}</b><span class="summary-term">„${esc(r.term.text)}“</span><span>${oc}</span><b class="summary-points">+${r.points}</b></div>`;
        })
        .join('');
      return `
        <div class="center-stage">
          <h2 class="stage-title">Durchgang ${c.no} ${c.tiebreak ? '(Stechen)' : ''} geschafft!</h2>
          <div class="summary">${rows}</div>
          <div class="stage-actions"><button class="btn btn-primary btn-big" data-act="next" data-no="${c.no}">Weiter →</button></div>
        </div>`;
    }
    const t = teamOf(v, c.team);
    const second = c.attempt === 2;
    const big = t.players.length >= 3;
    const btn = (outcome, cls, label, pts) =>
      `<button class="btn btn-result ${cls}" data-act="say-result" data-outcome="${outcome}" data-team="${t.id}">${label}<small>${pts}</small></button>`;
    return `
      <div class="center-stage say-stage team-${t.id}">
        ${turnBannerHtml(v, t)}
        ${second ? `<div class="banner">🔁 Zweite Chance! Findet eine Brücke zwischen euren Wörtern zu „${esc(c.term.text)}“</div>` : termCardHtml(c.term)}
        <button class="btn btn-countdown" data-act="countdown">▶ Countdown 3 – 2 – 1</button>
        <p class="hint center">Beim „Jetzt!“ ruft das ganze Team gleichzeitig sein Wort.</p>
        <div class="result-buttons">
          ${
            second
              ? btn('all', 'btn-ok', '🎉 Alle gleich!', `+${BEGRIFF_POINTS.second}`) + btn('none', 'btn-bad', '❌ Nicht geschafft', '')
              : btn('all', 'btn-ok', '🎉 Alle gleich', `+${BEGRIFF_POINTS.all}`) +
                (big ? btn('some', 'btn-mid', '🤏 Mindestens zwei gleich', `+${BEGRIFF_POINTS.some}`) : '') +
                btn('none', 'btn-bad', '❌ Keine Übereinstimmung', '0')
          }
        </div>
        ${second ? '' : '<button class="btn btn-link" data-act="skip-term">🔀 Anderer Begriff</button>'}
      </div>`;
  }

  /* ---------- Gedankenkette ---------- */

  function stepRowHtml(st, i, id, no) {
    // Ohne Handy kann eine Runde auch nur per „Gleich!“/„Verschieden“ eingetragen sein (ohne Wörter)
    const noWords = st.words.every((w) => !w.word);
    const body = noWords
      ? `<span class="step-verdict ${st.outcome === 'all' ? 'hit' : ''}">${st.outcome === 'all' ? '🎉 gleich' : '✖ verschieden'}</span>`
      : tilesHtml(st.words.map((w) => ({ word: w.word || '' })), st.groups, { flip: true, delay: 0 });
    return `<li class="step" id="st-${no}-${id}-${i}">
      <span class="step-no">${i + 1}</span>
      ${body}
      ${st.outcome === 'all' && !noWords ? '<span class="step-hit">🎉</span>' : ''}
    </li>`;
  }

  function chainResultHtml(ch) {
    if (ch.hit) return `<div class="chain-result hit">🎉 Treffer in Runde ${ch.hit}! <b>+${ch.points}</b></div>`;
    if (ch.gaveUp) return `<div class="chain-result fail">🏳️ Aufgegeben <b>+0</b></div>`;
    return `<div class="chain-result fail">❌ Nicht geschafft <b>+0</b></div>`;
  }

  function chainColumnHtml(v, id, ch, opts) {
    const t = teamOf(v, id);
    const c = v.cur;
    const write = v.settings.input === 'write';
    const pending =
      !ch.done && write
        ? `<li class="step step-pending"><span class="step-no">${ch.steps.length + 1}</span>${statusChipsHtml(v, ch.players, ch.answered)}</li>`
        : '';
    const waiting = !ch.done && !write && c.team !== id && v.phase === 'play' ? '<p class="muted small center">wartet …</p>' : '';
    return `
      <section class="chain team-${id} ${ch.done ? 'is-done' : ''} ${ch.hit ? 'is-hit' : ''}">
        <header class="chain-head">
          <span class="team-dot"></span><h3>${esc(t.name)}</h3>
          ${opts && opts.giveUp && !ch.done ? `<button class="icon-btn icon-small" data-act="give-up" data-team="${id}" title="Kette aufgeben" aria-label="Kette aufgeben">🏳️</button>` : ''}
        </header>
        <ol class="steps">
          ${ch.start ? `<li class="step step-start"><span class="step-no">▶</span>${tilesHtml(ch.start.map((w) => ({ word: w })), [])}</li>` : ''}
          ${ch.steps.map((st, i) => stepRowHtml(st, i, id, c.no)).join('')}
          ${pending}
        </ol>
        ${waiting}
        ${ch.done ? chainResultHtml(ch) : timerHtml(ch.timer, false)}
      </section>`;
  }

  function ketteWriteStage(v) {
    const c = v.cur;
    const first = c.chains[c.teams[0]];
    const summary = v.phase === 'summary';
    return `
      <div class="kette-stage">
        ${
          summary
            ? `<h2 class="stage-title">Durchgang ${c.no} ${c.tiebreak ? '(Stechen)' : ''} fertig!</h2>`
            : first && first.start
              ? `<div class="banner">Startwörter: <b>${esc(first.start[0])}</b> ✦ <b>${esc(first.start[1])}</b> – findet die Brücke!</div>`
              : `<div class="banner">Alle im Team tippen gleichzeitig ein Wort – bis alle dasselbe haben!</div>`
        }
        <div class="chains cols-${c.teams.length}">${c.teams.map((id) => chainColumnHtml(v, id, c.chains[id], { giveUp: !summary })).join('')}</div>
        <div class="stage-actions">
          ${
            summary
              ? `<button class="btn btn-primary btn-big" data-act="next" data-no="${c.no}">Weiter →</button>`
              : '<button class="btn btn-ghost btn-small" data-act="finish-round">⏹ Durchgang beenden</button>'
          }
        </div>
      </div>`;
  }

  function ketteSayStage(v) {
    const c = v.cur;
    if (v.phase === 'summary') {
      return `
        <div class="kette-stage">
          <h2 class="stage-title">Durchgang ${c.no} ${c.tiebreak ? '(Stechen)' : ''} fertig!</h2>
          <div class="chains cols-${c.teams.length}">${c.teams.map((id) => chainColumnHtml(v, id, c.chains[id])).join('')}</div>
          <div class="stage-actions"><button class="btn btn-primary btn-big" data-act="next" data-no="${c.no}">Weiter →</button></div>
        </div>`;
    }
    const t = teamOf(v, c.team);
    const ch = c.chains[c.team];
    const stepNo = ch.steps.length + 1;
    const prev = bridgeWords(ch);
    const lastUnknown = ch.steps.length && !prev.length;
    let prompt;
    if (prev.length >= 2) {
      prompt = `<div class="bridge"><small>Findet die Brücke zwischen</small>${tilesHtml(prev.map((w) => ({ word: w })), [])}</div>`;
    } else if (lastUnknown) {
      prompt = `<div class="bridge"><small>Findet eine Brücke zwischen euren letzten Wörtern</small></div>`;
    } else {
      prompt = `<div class="bridge"><small>Runde 1</small><b>Jede/r sagt irgendein Wort!</b></div>`;
    }
    const banned = chainWords(ch);
    const inputs = ch.players
      .map((pid, i) => {
        const val = ui.sayWords[i] || '';
        const isBanned = val && M.used(val, banned);
        return `
          <label class="say-word ${isBanned ? 'is-banned' : ''}">
            <span>${esc(playerName(v, pid))}</span>
            <input class="input" type="text" maxlength="${MAX_WORD}" value="${esc(val)}" data-field="say-word" data-i="${i}" autocomplete="off" spellcheck="false" enterkeyhint="${i + 1 < ch.players.length ? 'next' : 'done'}" />
            ${isBanned ? '<em>schon gefallen!</em>' : ''}
          </label>`;
      })
      .join('');
    const others = c.teams.filter((id) => id !== c.team && (c.chains[id].done || c.chains[id].steps.length));
    return `
      <div class="center-stage say-stage team-${t.id}">
        ${turnBannerHtml(v, t)}
        <div class="say-kette">
          <div class="say-main">
            <div class="step-counter">Runde <b>${stepNo}</b> / ${v.settings.maxSteps}</div>
            ${prompt}
            <button class="btn btn-countdown" data-act="countdown">▶ Countdown 3 – 2 – 1</button>
            <form class="say-form" data-form="say-kette" data-step="${ch.steps.length}" data-team="${t.id}">
              <div class="say-words">${inputs}</div>
              <button class="btn btn-primary" type="submit">Eintragen ⏎ <small>(erkennt Treffer automatisch)</small></button>
            </form>
            <div class="result-buttons compact">
              <button class="btn btn-result btn-ok" data-act="say-step" data-verdict="same" data-step="${ch.steps.length}" data-team="${t.id}">🎉 Gleich!</button>
              <button class="btn btn-result btn-bad" data-act="say-step" data-verdict="diff" data-step="${ch.steps.length}" data-team="${t.id}">✖ Verschieden</button>
            </div>
            <p class="hint center">Wörter eintragen ist optional – dann zeigt die Kette, wie ihr zum Ziel gekommen seid.</p>
            <button class="btn btn-link" data-act="give-up">🏳️ Kette aufgeben</button>
          </div>
          <div class="say-side">
            ${chainColumnHtml(v, t.id, ch)}
            ${others.map((id) => chainColumnHtml(v, id, c.chains[id])).join('')}
          </div>
        </div>
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
          <span>${team.score} Punkte</span>
          <div class="podium-block">${place}</div>
        </div>`
      )
      .join('');
    const lastPlace = pl.length >= 2 ? pl[pl.length - 1] : null;
    const loser = lastPlace && lastPlace.place > 1 ? lastPlace.team : null;
    const rest = pl.slice(3);
    const awards = (v.awards || [])
      .map((a) => `<div class="award"><span class="award-icon">${a.icon}</span><div><b>${esc(a.title)}</b><small>${esc(a.text)}</small></div></div>`)
      .join('');
    const winnerNames = v.winners.map((id) => esc(teamOf(v, id).name)).join(' & ');
    return `
      <div class="center-stage over">
        <h1 class="over-title">${single ? `🧠 ${pl[0].team.score} Punkte!` : v.winners.length > 1 ? `🤝 Unentschieden: ${winnerNames}` : `🏆 ${winnerNames} gewinnt!`}</h1>
        ${single ? '' : `<div class="podium">${podium}</div>`}
        ${rest.length ? `<div class="summary">${rest.map(({ team, place }) => `<div class="summary-row team-${team.id}"><span class="team-dot"></span><b>${place}. ${esc(team.name)}</b><b class="summary-points">${team.score}</b></div>`).join('')}</div>` : ''}
        ${loser ? `<p class="loser">🥄 Verloren hat <b>${esc(loser.name)}</b> mit ${loser.score} ${plural(loser.score, 'Punkt', 'Punkten')}.</p>` : ''}
        ${awards ? `<div class="awards">${awards}</div>` : ''}
        <div class="stage-actions">
          <button class="btn btn-primary btn-big" data-act="again">🔁 Nochmal</button>
          <button class="btn btn-ghost" data-act="home">Hauptmenü</button>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Handy (Mitspieler)                                                  */
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
    else if (v.phase === 'over') body = phoneOverHtml(v);
    else if (!t || !v.order.includes(t.id) || !v.cur.teams.includes(t.id)) body = phoneSpectatorHtml(v, t);
    else if (v.cur.kind === 'begriff') body = phoneBegriffHtml(v, t);
    else body = phoneKetteHtml(v, t);
    return `
      <div class="phone ${t ? 'team-' + t.id : ''}">
        <header class="phone-head">
          <span class="team-dot"></span>
          <b>${t ? esc(t.name) : 'Ohne Team'}</b>
          <span class="phone-name">${esc(me.name)}</span>
          <button class="icon-btn" data-act="menu" aria-label="Menü">☰</button>
        </header>
        ${phoneStatusBanner()}
        <main class="phone-main">${body}</main>
      </div>`;
  }

  function phoneLobbyHtml(v) {
    const active = v.teams.filter((t) => t.active);
    return `
      <h2 class="phone-title">Wähle dein Team</h2>
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
      </div>
      <p class="waiting">${v.me.team ? '⏳ Warte, bis es am Laptop losgeht…' : 'Tippe auf ein Team.'}</p>
      <p class="muted small center">${MODE[v.settings.mode].icon} ${MODE[v.settings.mode].label}: ${MODE[v.settings.mode].text}</p>`;
  }

  function phoneSpectatorHtml(v, t) {
    const canJoin = !t && v.phase !== 'over';
    return `
      <div class="look-up">👀<b>Schau auf den Laptop!</b><small>${t ? 'Euer Team spielt in diesem Durchgang nicht mit.' : 'Du schaust gerade zu.'}</small></div>
      ${
        canJoin
          ? `<p class="center">Einem Team beitreten (ab dem nächsten Durchgang dabei):</p>
             <div class="team-pick">${v.order
               .map((id) => teamOf(v, id))
               .map((x) => `<button class="team-btn team-${x.id}" data-act="join-team" data-team="${x.id}"><b>${esc(x.name)}</b></button>`)
               .join('')}</div>`
          : ''
      }`;
  }

  function wordFormHtml(v, placeholder) {
    return `
      <form class="word-form" data-form="word">
        <input id="word-input" class="input input-word" type="text" maxlength="${MAX_WORD}" placeholder="${esc(placeholder || 'Dein Wort')}" value="${esc(ui.draft)}"
          data-field="word" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="send" />
        ${ui.wordError ? `<div class="word-error">${esc(ui.wordError)}</div>` : ''}
        <button class="btn btn-primary btn-big btn-wide" type="submit">Festlegen ✓</button>
      </form>`;
  }

  function submittedHtml(v, word, pids, answered) {
    const waiting = pids.filter((pid) => !answered.includes(pid) && isOnline(v, pid)).map((pid) => esc(playerName(v, pid)));
    return `
      <div class="submitted">
        <small>Dein Wort</small>
        <b>${esc(word)}</b>
        <button class="btn btn-ghost btn-small" data-act="unsubmit">✏️ Ändern</button>
      </div>
      <p class="waiting">${waiting.length ? `⏳ Warte auf ${waiting.join(', ')} …` : '⏳ Gleich wird aufgedeckt …'}</p>`;
  }

  function phoneBegriffHtml(v, t) {
    const c = v.cur;
    const r = c.results[t.id];
    if (v.phase === 'reveal') {
      const shown = r ? r.second || r : null;
      return `
        ${termCardHtml(c.term, { small: true })}
        ${shown ? `<div class="phone-result">${tilesHtml(shown.words, shown.groups, { names: true })}
          <div class="outcome outcome-${shown.outcome}">${r.final ? `${OUTCOME[shown.outcome].icon} ${r.second ? (shown.outcome === 'all' ? 'Brücke geschafft!' : 'Brücke nicht geschafft') : OUTCOME[shown.outcome].label} <b>+${r.points}</b>` : `${OUTCOME[shown.outcome].icon} ${OUTCOME[shown.outcome].label} → Zweite Chance kommt!`}</div></div>` : ''}
        <div class="look-up small">👀 Schau auf den Laptop!</div>`;
    }
    const isPart = (c.participants[t.id] || []).includes(v.me.id);
    if (!isPart) return `${termCardHtml(c.term)}<div class="look-up">⏳<b>Du bist ab dem nächsten Durchgang dabei.</b></div>`;
    if (!c.active.includes(t.id)) {
      return `<div class="look-up">✓<b>Euer Team ist fertig</b><small>${r ? `+${r.points} Punkte` : ''} – die anderen versuchen ihre zweite Chance.</small></div>`;
    }
    const second = c.attempt === 2;
    const prompt = second
      ? `<div class="bridge"><small>🔁 Zweite Chance! Brücke zwischen euren Wörtern:</small>${tilesHtml(r.words, r.groups)}</div>`
      : termCardHtml(c.term);
    const input =
      c.myWord != null ? submittedHtml(v, c.myWord, c.participants[t.id], c.answered) : wordFormHtml(v, second ? 'Eure Brücke' : 'Was fällt dir ein?');
    return `${prompt}${timerHtml(c.timer, true)}${input}
      <p class="muted small center">Ziel: Alle in ${esc(t.name)} schreiben dasselbe Wort.</p>`;
  }

  function phoneKetteHtml(v, t) {
    const c = v.cur;
    const ch = c.chains[t.id];
    const steps = `
      <ol class="steps phone-steps">
        ${ch.start ? `<li class="step step-start"><span class="step-no">▶</span>${tilesHtml(ch.start.map((w) => ({ word: w })), [])}</li>` : ''}
        ${ch.steps.map((st, i) => stepRowHtml(st, i, t.id, c.no)).join('')}
      </ol>`;
    if (ch.done) {
      return `${chainResultHtml(ch)}${steps}
        <div class="look-up small">${v.phase === 'summary' ? '👀 Durchgang vorbei – schau auf den Laptop!' : '⏳ Warte auf die anderen Teams …'}</div>`;
    }
    if (!ch.players.includes(v.me.id)) {
      return `<div class="look-up">⏳<b>Du bist ab dem nächsten Durchgang dabei.</b></div>${steps}`;
    }
    const prev = bridgeWords(ch);
    const prompt =
      prev.length >= 2
        ? `<div class="bridge"><small>Findet die Brücke zwischen</small>${tilesHtml(prev.map((w) => ({ word: w })), [])}</div>`
        : `<div class="bridge"><small>Runde 1</small><b>Tippe irgendein Wort!</b></div>`;
    const input =
      c.myWord != null ? submittedHtml(v, c.myWord, ch.players, ch.answered) : wordFormHtml(v, prev.length >= 2 ? 'Deine Brücke' : 'Irgendein Wort');
    return `
      <div class="step-counter">Runde <b>${ch.steps.length + 1}</b> / ${v.settings.maxSteps}</div>
      ${prompt}
      ${timerHtml(ch.timer, true)}
      ${input}
      ${ch.steps.length || ch.start ? `<h3 class="phone-sub">Eure Kette</h3>${steps}` : ''}`;
  }

  function phoneOverHtml(v) {
    const pl = places(v);
    const mine = pl.find((p) => p.team.id === v.me.team);
    let head = '<div class="look-up">🏁<b>Spiel vorbei!</b></div>';
    if (mine) {
      head =
        mine.place === 1
          ? `<div class="look-up win">🏆<b>${v.winners.length > 1 ? 'Geteilter Sieg!' : 'Ihr habt gewonnen!'}</b><small>${mine.team.score} Punkte</small></div>`
          : `<div class="look-up">${mine.place === pl.length ? '🥄' : '🏅'}<b>Platz ${mine.place}</b><small>${mine.team.score} Punkte</small></div>`;
    }
    return `${head}
      <div class="summary">${pl
        .map(({ team, place }) => `<div class="summary-row team-${team.id}"><span class="team-dot"></span><b>${place}. ${esc(team.name)}</b><b class="summary-points">${team.score}</b></div>`)
        .join('')}</div>
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
        <p class="muted small center">Wer jetzt beitritt, wählt ein Team und spielt ab dem nächsten Durchgang mit.</p>
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
        <p>Ein Gedankenlese-Spiel für Teams. Der <b>Laptop</b> ist die Bühne: Er zeigt Begriffe, Aufdecken und Punktestand.
          Nach der eingestellten Zahl an Durchgängen gewinnt das Team mit den meisten Punkten – wer am wenigsten hat, hat verloren.
          Bei Gleichstand an der Spitze gibt es ein <b>Stechen</b>.</p>
        <h3>🎯 Ein Begriff</h3>
        <p>Alle sehen einen Begriff, z.B. „Strand“. Jede/r im Team nennt das Wort, das ihm/ihr dazu einfällt – Ziel: alle haben dasselbe Wort (z.B. „Sand“).</p>
        <p><b>Punkte:</b> alle gleich 3 · mindestens zwei gleich 1 · keiner 0.
          Mit <b>Zweiter Chance</b>: Wer nicht alle gleich hat, sucht sofort eine Brücke zwischen den eigenen Wörtern – geschafft gibt 2 Punkte.</p>
        <h3>🔗 Gedankenkette</h3>
        <p>Das ganze Team nennt gleichzeitig irgendein Wort. Danach sucht jede/r ein Wort, das die gerade genannten Wörter verbindet –
          Runde für Runde, bis alle dasselbe sagen. Schon genannte Wörter sind gesperrt.</p>
        <p><b>Punkte:</b> Treffer in Runde 1 = 5, Runde 2 = 4, Runde 3 = 3, Runde 4 = 2, danach 1. Nach der maximalen Rundenzahl ist die Kette gescheitert (0).</p>
        <h3>Gleich ist gleich</h3>
        <p>Groß/klein, Artikel, Plural (Rakete = Raketen) und kleine Tippfehler bei längeren Wörtern sind egal.</p>
        <h3>🗣️ Ohne Handy</h3>
        <p>Die Teams sind nacheinander dran. Countdown starten, beim „Jetzt!“ ruft das Team gleichzeitig – am Laptop wird das Ergebnis eingetragen.</p>
        <h3>✍️ Mit Handy</h3>
        <p>Alle scannen den QR-Code, wählen ihr Team und tippen geheim. Alle Teams spielen gleichzeitig, aufgedeckt wird auf dem Laptop.</p>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Alles klar!</button></div>`;
  }

  function menuHtml() {
    const v = ui.view;
    const items = [];
    items.push(`<button class="menu-item" data-act="rules">📖 Spielregeln</button>`);
    items.push(`<button class="menu-item" data-act="mute">${Sound.muted ? '🔊 Ton einschalten' : '🔇 Ton ausschalten'}</button>`);
    if (v && v.me.stage) {
      const write = v.settings.input === 'write';
      const c = v.cur;
      if (write && v.room) items.push(`<button class="menu-item" data-act="show-qr">📱 Mitspieler einladen</button>`);
      if (c && v.phase === 'play' && c.kind === 'begriff' && c.attempt === 1) items.push(`<button class="menu-item" data-act="skip-term">🔀 Anderen Begriff ziehen</button>`);
      if (c && v.phase === 'play' && write) items.push(`<button class="menu-item" data-act="finish-round">⏩ Durchgang jetzt auswerten</button>`);
      items.push(`<button class="menu-item" data-act="home-keep">🏠 Hauptmenü <small>(Spiel bleibt gespeichert)</small></button>`);
      if (!['lobby', 'over'].includes(v.phase)) items.push(`<button class="menu-item danger" data-act="end-game">⏹️ Spiel beenden & Ergebnis zeigen</button>`);
      items.push(`<button class="menu-item danger" data-act="close-game">🚪 Spiel schließen</button>`);
    } else if (v) {
      if (v.phase === 'lobby') items.push(`<button class="menu-item" data-act="join-team" data-team="">↩️ Team verlassen</button>`);
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
    const say = s.settings.input === 'say';
    if (say) {
      // Leere Felder werden automatisch benannt – aber jedes Team braucht mindestens 2 Spieler
      const short = s.teams.find((t) => t.active && t.players.length < 2);
      if (short) {
        ui.error = 'Jedes Team braucht mindestens 2 Spieler.';
        render();
        return;
      }
    }
    ui.error = null;
    const state = Engine.create({ settings: s.settings, teams: s.teams });
    Sound.unlock();
    startStage({ state });
  }

  function submitWord(v, word) {
    const c = v.cur;
    if (c.kind === 'kette') {
      const ch = c.chains[v.me.team];
      if (M.used(word, chainWords(ch))) {
        ui.wordError = `„${word}“ ist in eurer Kette schon gefallen – such ein anderes Wort.`;
        render();
        return;
      }
    }
    ui.wordError = null;
    dispatch('submit', { word, at: v.me.stepKey });
  }

  const actions = {
    home: () => goHome(false),
    'home-keep': () => goHome(true),
    'new-game': (el) => {
      ui.setup.settings = sanitizeSettings(Object.assign({}, ui.setup.settings, { mode: el.dataset.mode }), ui.setup.settings);
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
        text: 'Das Spiel endet sofort mit dem aktuellen Punktestand.',
        yes: 'Beenden',
        danger: true,
        run: () => dispatch('end'),
      }),

    /* Setup */
    set: (el) => {
      const key = el.dataset.key;
      let value = el.dataset.value;
      if (['rounds', 'seconds', 'maxSteps'].includes(key)) value = +value;
      setSetting(el.dataset.scope, key, value);
    },
    'toggle-second': (el) => {
      const s = el.dataset.scope === 'setup' ? ui.setup.settings : ui.view.settings;
      setSetting(el.dataset.scope, 'secondChance', !s.secondChance);
    },
    'team-toggle': (el) => {
      const t = ui.setup.teams[+el.dataset.team];
      if (t.active && ui.setup.teams.filter((x) => x.active).length <= 1) return;
      t.active = !t.active;
      saveSetup();
      render();
    },
    'add-player': (el) => {
      const t = ui.setup.teams[+el.dataset.team];
      if (t.players.length >= MAX_SETUP_PLAYERS) return;
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
    'lobby-team': (el) => dispatch('teamActive', { team: el.dataset.team, active: el.dataset.on === '1' }),
    kick: (el) => dispatch('kick', { player: el.dataset.player }),
    start: () => dispatch('start'),
    'join-team': (el) => {
      ui.modal = null;
      dispatch('joinTeam', { team: el.dataset.team || null });
    },

    /* Spiel */
    next: (el) => dispatch('next', { no: el.dataset.no ? +el.dataset.no : undefined }),
    'skip-term': () => dispatch('skipTerm'),
    'finish-round': () => dispatch('finishRound'),
    'give-up': (el) => {
      const id = el.dataset.team || (ui.view && ui.view.cur && ui.view.cur.team);
      const t = id && teamOf(ui.view, id);
      askConfirm({
        title: 'Kette aufgeben?',
        text: `${t ? t.name : 'Das Team'} bekommt für diese Kette 0 Punkte.`,
        yes: 'Aufgeben',
        danger: true,
        run: () => dispatch('giveUp', { team: el.dataset.team || undefined }),
      });
    },
    again: () => dispatch('again'),
    countdown: runCountdown,
    'say-result': (el) => dispatch('sayResult', { outcome: el.dataset.outcome, team: el.dataset.team }),
    'say-step': (el) =>
      dispatch('sayStep', { verdict: el.dataset.verdict, words: ui.sayWords.slice(), step: +el.dataset.step, team: el.dataset.team }),
    unsubmit: () => {
      const v = ui.view;
      if (!v || v.cur.myWord == null) return;
      ui.draft = v.cur.myWord;
      ui.focus = '#word-input';
      dispatch('unsubmit', { at: v.me.stepKey });
    },
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
    } else if (f === 'word') {
      ui.draft = el.value;
      if (ui.wordError) {
        ui.wordError = null;
        render();
      }
    } else if (f === 'say-word') {
      ui.sayWords[+el.dataset.i] = el.value;
      render(); // Markierung „schon gefallen“
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
    } else if (el.dataset.field === 'say-word') {
      const next = app.querySelector(`[data-field="say-word"][data-i="${+el.dataset.i + 1}"]`);
      if (next) {
        e.preventDefault();
        next.focus();
      }
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
    } else if (form.dataset.form === 'word' && v) {
      const input = form.querySelector('[data-field="word"]');
      const word = input.value.trim();
      if (!word) return;
      input.blur();
      submitWord(v, word);
    } else if (form.dataset.form === 'say-kette' && v) {
      const words = [...form.querySelectorAll('[data-field="say-word"]')].map((i) => i.value.trim());
      if (words.some((w) => !w)) {
        toast('Bitte alle Wörter eintragen – oder „Gleich!“ / „Verschieden“ tippen.');
        return;
      }
      if (document.activeElement) document.activeElement.blur();
      dispatch('sayStep', { words, step: +form.dataset.step, team: form.dataset.team });
    }
  });

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
    if (active === 'stage' && saves.stage) startStage({ state: saves.stage.state, code: saves.stage.code, key: saves.stage.key });
    else if (active === 'client' && saves.client && (!ui.joinCode || ui.joinCode === saves.client.code)) {
      startClient({ code: saves.client.code, name: saves.client.name, pid: saves.client.pid });
    } else {
      if (ui.screen === 'join') ui.focus = ui.name ? '#code-input' : '#name-input';
      render();
    }
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.ZD_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  requestAnimationFrame(timerLoop);
  autoResume();

  // für Tests
  window.ZDApp = { ui, render: renderNow, actions };
})();
