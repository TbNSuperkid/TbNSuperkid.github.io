/*
 * Oberfläche von „Schlecht erklärt“.
 *  - Laptop („Bühne“): Spiel anlegen, Lobby mit QR-Code, Beschreibung mit Hinweisen, Auflösung, Punktestand
 *  - Handy (Mitspieler): Team wählen, Titel tippen (mit Vorschlägen) oder auswählen, selbst erklären
 * Gerendert wird per HTML-String + morphdom (nur geänderte Teile werden ersetzt).
 */
(function () {
  'use strict';

  const E = window.SEEngine;
  const { TEAMS, FILM_OPTIONS, SECONDS_OPTIONS, HINT_POINTS, CHOICE_POINTS, FIRST_BONUS, MAX_TRIES, MAX_EXPLAIN, MIN_EXPLAIN, MAX_GUESS, MAX_PLAYERS, Engine, sanitizeSettings } = E;
  const { StageController, ClientController, Store, KEYS, Net, inviteLink, qrSvg } = window.SEControllers;
  const { Sound, confetti } = window.GameFx;
  const Films = window.SEFilms;
  const Titles = window.SETitles;

  const INPUT = {
    write: { icon: '📱', label: 'Mit Handys', text: 'Alle verbinden ihr Handy per QR-Code und tippen den Filmtitel – die App prüft, wer richtig liegt und wer am schnellsten war.' },
    say: { icon: '🗣️', label: 'Ein Gerät', text: 'Alle rufen ihre Antwort laut. Hinweise und Auflösung per Klick, danach wird angetippt, wer es hatte.' },
  };
  const ANSWER = {
    type: { label: '⌨️ Tippen', text: 'Titel eintippen (mit Vorschlägen) – 3 Versuche, Tippfehler sind kein Problem.' },
    choice: { label: '🔘 Auswahl', text: `4 Antworten zur Wahl, ein Versuch, ${CHOICE_POINTS} Punkte – schnell und gut für Kinder. Ohne Hinweise.` },
  };
  const MODE = {
    db: { label: '📚 Aus der Sammlung', text: `${Films.stats().films} schlecht erklärte Filme (und ${Films.stats().serien} Serien) warten.` },
    explain: { label: '✍️ Selbst erklären', text: 'Reihum bekommt eine Person geheim einen Film und erklärt ihn selbst schlecht. Punkte für jedes Team, das ihn errät.' },
  };
  const LEVEL = {
    easy: 'Leicht',
    mixed: 'Gemischt',
    all: 'Alle',
    hard: 'Schwer',
  };
  const REPORT_REASONS = ['😴 Zu leicht', '🤯 Zu schwer', '❌ Stimmt nicht', '😐 Nicht lustig'];
  const SETUP_KEY = 'schlechterklaert.setup.v1';
  const PREFS_KEY = 'schlechterklaert.prefs.v1';
  const REPORTS_KEY = 'schlechterklaert.reports.v1';
  const ACTIVE_KEY = 'schlechterklaert.active';
  const RESUME_MAX_AGE = 12 * 60 * 60 * 1000;
  const SUGGEST_MAX = 5;

  const app = document.getElementById('app');
  let allTitles = null;

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

  function catOf(id) {
    return Films.category(id) || { icon: '🎬', label: 'Film' };
  }

  function curKey(v) {
    return v && v.cur ? `${v.cur.no}-${v.cur.qNo}` : null;
  }

  function seconds(ms) {
    return (ms / 1000).toFixed(1).replace('.', ',');
  }

  function titles() {
    if (!allTitles) allTitles = Films.titles();
    return allTitles;
  }

  function defaultSetup() {
    return {
      settings: sanitizeSettings({}),
      teams: TEAMS.map((t, i) => ({ id: t.id, active: i < 2, name: '' })),
      players: ['', '', ''],
    };
  }

  function loadSetup() {
    const saved = Store.get(SETUP_KEY);
    if (!saved || !Array.isArray(saved.teams) || saved.teams.length !== TEAMS.length || !Array.isArray(saved.players)) return defaultSetup();
    saved.settings = sanitizeSettings(saved.settings);
    return saved;
  }

  function saveSetup() {
    Store.set(SETUP_KEY, ui.setup);
  }

  function loadReports() {
    const r = Store.get(REPORTS_KEY);
    return Array.isArray(r) ? r : [];
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
    guess: '', // Titel auf dem Handy
    explain: '', // eigene Beschreibung auf dem Handy
    report: null, // Film, der gemeldet werden soll
    hold: null, // Punktestand während der Auflösung noch nicht umspringen lassen
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
    ui.hold = null;
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
      ui.guess = '';
      ui.explain = '';
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
    if (!prev) return;
    const stage = !!v.me.stage;
    const c = v.cur;
    const pc = prev.cur;
    if (v.phase === 'over' && prev.phase !== 'over') {
      ui.flash = null;
      Sound.fanfare();
      const colors = v.winners.map((id) => teamOf(v, id).color);
      setTimeout(() => confetti(colors.concat('#ffffff', '#facc15'), 260), 150);
      setTimeout(() => confetti(colors.concat('#ffffff'), 160), 900);
      return;
    }
    if (!c) return;
    if (!pc || curKey(prev) !== curKey(v)) {
      Sound.start();
      return;
    }
    if (v.phase === 'guess' && prev.phase === 'explain') Sound.start();
    if (c.hint > pc.hint && v.phase === 'guess') {
      Sound.hop();
      if (stage) flash(`💡 Hinweis ${c.hint} – jetzt noch ${c.pointsNow} ${plural(c.pointsNow, 'Punkt', 'Punkte')}`, '#f5c542');
    }
    // Neue Treffer
    if (c.status && pc.status) {
      for (const id of c.guessing) {
        const now = c.status[id];
        const before = pc.status[id];
        if (!now || !before) continue;
        if (now.ok && !before.ok) {
          const t = teamOf(v, id);
          if (stage) {
            Sound.success();
            flash(`✅ ${t.name} hat es!`, t.color);
          }
        } else if (now.tries > before.tries && stage) Sound.tick(false);
      }
    }
    // Eigenes Ergebnis auf dem Handy
    if (c.mine && pc.mine && c.mine.list.length > pc.mine.list.length) {
      const last = c.mine.list[c.mine.list.length - 1];
      if (last.res === 'yes') {
        Sound.success();
        confetti([teamOf(v, v.me.team).color, '#ffffff'], 90);
        if (navigator.vibrate) navigator.vibrate([60, 60, 60]);
      } else if (last.res === 'no') {
        Sound.fail();
        if (navigator.vibrate) navigator.vibrate(120);
      } else Sound.hop();
    }
    if (v.phase === 'reveal' && prev.phase !== 'reveal') revealEffects(v, stage);
  }

  function revealEffects(v, stage) {
    const c = v.cur;
    const hitters = c.teams.filter((id) => c.results[id] && c.results[id].ok);
    if (stage) {
      // Mit Handy stehen die Punkte schon fest – kurz den alten Stand zeigen, dann umspringen lassen
      if (v.settings.input === 'write') {
        ui.hold = { key: curKey(v), until: performance.now() + 1400 };
        setTimeout(render, 1450);
      }
      Sound.flip();
      if (hitters.length) setTimeout(() => confetti(hitters.map((id) => teamOf(v, id).color).concat('#ffffff'), 150), 700);
      return;
    }
    const r = v.me.team && c.results[v.me.team];
    if (!r) return;
    setTimeout(() => {
      if (r.points > 0) Sound.success();
      else Sound.flip();
    }, 500);
  }

  function holding(v) {
    return !!(ui.hold && v.cur && ui.hold.key === curKey(v) && performance.now() < ui.hold.until);
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
      el.classList.toggle('urgent', sec <= 5);
      if (el.hasAttribute('data-tick') && el.dataset.last !== String(sec)) {
        if (el.dataset.last && sec <= 5 && sec > 0) Sound.tick(sec <= 3);
        el.dataset.last = String(sec);
      }
    }
    // „Nächster Hinweis in … s“
    for (const el of app.querySelectorAll('[data-countdown]')) {
      const sec = Math.max(0, Math.ceil((+el.dataset.countdown - elapsed) / 1000));
      if (el.textContent !== String(sec)) el.textContent = String(sec);
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
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="Schlecht erklärt">
      <span class="logo-icon" aria-hidden="true">🎬</span>
      <span class="logo-text"><span class="l1">Schlecht</span> <span class="l2">erklärt</span></span>
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

  function switchHtml(on, act, scope) {
    return `<button class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" data-act="${act}" data-scope="${scope}">
      <span class="switch-knob"></span><span class="switch-text">${on ? 'An' : 'Aus'}</span>
    </button>`;
  }

  function settingsHtml(s, scope) {
    const write = s.input === 'write';
    const rows = [];
    if (write) {
      rows.push(`
        <div class="setting">
          <div class="setting-label"><b>Beschreibungen</b><small>${esc(MODE[s.mode].text)}</small></div>
          ${seg('mode', ['db', 'explain'], s.mode, (o) => MODE[o].label, scope)}
        </div>`);
    }
    rows.push(`
      <div class="setting">
        <div class="setting-label"><b>Antworten</b><small>${esc(write ? ANSWER[s.answer].text : s.answer === 'choice' ? '4 Antworten stehen auf dem Bildschirm, alle rufen ihren Tipp.' : 'Alle rufen den Titel – ganz ohne Vorgaben.')}</small></div>
        ${seg('answer', ['type', 'choice'], s.answer, (o) => (write ? ANSWER[o].label : o === 'type' ? '🗣️ Frei' : ANSWER[o].label), scope)}
      </div>`);
    rows.push(`
      <div class="setting">
        <div class="setting-label"><b>🎞️ Filme</b><small>So viele Filme hat ein Spiel (bei Gleichstand kommt ein Stechen dazu)</small></div>
        ${seg('films', FILM_OPTIONS, s.films, (o) => String(o), scope)}
      </div>`);
    if (write) {
      rows.push(`
        <div class="setting">
          <div class="setting-label"><b>⏱ Zeit pro Film</b><small>${s.hints && s.answer === 'type' ? 'Die Hinweise kommen automatisch nach je einem Viertel der Zeit' : 'Danach wird aufgelöst'}</small></div>
          ${seg('seconds', SECONDS_OPTIONS, s.seconds, (o) => (o ? o + ' s' : 'Aus'), scope)}
        </div>`);
    }
    if (s.answer === 'type') {
      rows.push(`
        <div class="setting">
          <div class="setting-label"><b>💡 Hinweise</b><small>Jahr & Genre → Tipp → Titel-Lücken. Punkte: ${HINT_POINTS.join(' / ')} je nach Hinweis${write ? `, +${FIRST_BONUS} für die Schnellsten` : ''}</small></div>
          ${switchHtml(s.hints, 'toggle-hints', scope)}
        </div>`);
      if (write) {
        rows.push(`
          <div class="setting">
            <div class="setting-label"><b>🎯 Streng</b><small>${s.strict ? 'Nur der genaue Film zählt – „Harry Potter“ reicht nicht für Teil 3.' : 'Der Name der Reihe zählt auch („Harry Potter“, „Star Wars“).'}</small></div>
            ${switchHtml(s.strict, 'toggle-strict', scope)}
          </div>
          <div class="setting">
            <div class="setting-label"><b>🔎 Vorschläge beim Tippen</b><small>Ab 2 Buchstaben erscheinen passende Titel aus der ganzen Sammlung</small></div>
            ${switchHtml(s.suggest, 'toggle-suggest', scope)}
          </div>`);
      }
    }
    rows.push(`
      <div class="setting">
        <div class="setting-label"><b>Schwierigkeit</b><small>Leicht = kennt wirklich jede/r · Schwer = für Filmfans</small></div>
        ${seg('level', Films.LEVEL_IDS, s.level, (o) => LEVEL[o], scope)}
      </div>`);
    return `<div class="settings">${rows.join('')}</div>`;
  }

  function categoriesHtml(s, scope) {
    const st = Films.stats();
    return `<div class="cats">${Films.CATEGORIES.map((c) => {
      const on = s.categories.includes(c.id);
      return `<button class="cat-chip ${on ? 'on' : ''} ${c.series ? 'cat-series' : ''}" data-act="toggle-cat" data-cat="${c.id}" data-scope="${scope}" aria-pressed="${on}">
        <span>${c.icon}</span> ${esc(c.label)} <small>${st[c.id]}</small>
      </button>`;
    }).join('')}</div>
    <p class="muted small">📺 <b>Serien</b> sind ein Extra und standardmäßig aus.</p>`;
  }

  function timerHtml(timer, tick) {
    if (!timer) return '';
    return `<div class="timer" data-timer ${tick ? 'data-tick' : ''} data-rem="${Math.round(timer.remaining)}" data-total="${timer.total}">
      <div class="timer-bar"><span data-timer-bar style="width:${(100 * timer.remaining) / (timer.total || 1)}%"></span></div>
      <b data-timer-text>${Math.ceil(timer.remaining / 1000)}</b>
    </div>`;
  }

  function tiebreakBanner(v) {
    if (!v.cur || !v.cur.tiebreak) return '';
    return `<div class="banner banner-hot">⚔️ Stechen! ${v.cur.teams.map((id) => esc(teamOf(v, id).name)).join(' vs. ')}</div>`;
  }

  /** Die Beschreibung als Kinokarte */
  function filmCardHtml(c, opts) {
    const o = opts || {};
    const by = c.explain ? `<div class="fc-by">✍️ erklärt von ${esc(c.explain.name)}</div>` : '';
    return `<figure class="film-card ${o.small ? 'fc-small' : ''}" id="fc-${c.no}-${c.qNo}">
      <div class="fc-strip" aria-hidden="true"></div>
      <blockquote class="fc-text">„${esc(c.text)}“</blockquote>
      ${by}
    </figure>`;
  }

  /** Die drei Hinweise (zugedeckt oder aufgedeckt) */
  function hintsHtml(c, opts) {
    if (!c.hintsOn) return '';
    const o = opts || {};
    const h = c.hints;
    const cat = h.meta ? catOf(h.meta.cat) : null;
    const chip = (i, label, content, cls) =>
      `<div class="hint ${content ? 'is-open' : ''} ${cls || ''}">
        <span class="hint-no">${content ? '💡' : '🔒'} ${label}</span>
        ${content ? `<b class="hint-body">${content}</b>` : `<span class="hint-body muted">noch zu</span>`}
      </div>`;
    const next =
      o.countdown && c.nextHint != null && c.hint < c.maxHint
        ? `<p class="muted small center hint-next">Nächster Hinweis in <b data-countdown="${Math.round(c.nextHint)}">${Math.ceil(c.nextHint / 1000)}</b> s</p>`
        : '';
    return `<div class="hints">
      ${chip(1, 'Jahr & Genre', h.meta ? `${h.meta.year} · ${cat.icon} ${esc(cat.label)}` : '')}
      ${chip(2, 'Tipp', h.tip ? esc(h.tip) : '')}
      ${chip(3, 'Titel', h.gaps ? `<span class="gaps">${esc(h.gaps)}</span>` : '', 'hint-gaps')}
    </div>${next}`;
  }

  function pointsNowHtml(c) {
    if (!c.hintsOn) return '';
    return `<div class="points-now">jetzt <b>${c.pointsNow}</b> ${plural(c.pointsNow, 'Punkt', 'Punkte')}</div>`;
  }

  function choicesHtml(c, opts) {
    if (!c.choices) return '';
    const o = opts || {};
    return `<div class="choices ${o.phone ? 'choices-phone' : ''}">${c.choices
      .map((t, i) => {
        const letter = 'ABCD'[i];
        const mine = o.pick === i;
        const right = o.answer && t === o.answer;
        const cls = `${mine ? 'is-mine' : ''} ${right ? 'is-right' : ''} ${o.answer && mine && !right ? 'is-wrong' : ''}`;
        const inner = `<span class="choice-letter">${letter}</span><span class="choice-title">${esc(t)}</span>`;
        return o.phone && !o.locked
          ? `<button class="choice ${cls}" data-act="pick" data-index="${i}">${inner}</button>`
          : `<div class="choice ${cls}">${inner}</div>`;
      })
      .join('')}</div>`;
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
            <small>${esc(teams.join(' · ') || 'Lobby')}</small></button>
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
    const st = Films.stats();
    return `
    <div class="screen home">
      <a class="btn btn-ghost btn-small hub-back" href="../">← Alle Spiele</a>
      <div class="home-hero">
        ${logoHtml()}
        <p class="tagline">„Ein Rentner weigert sich, ins Altersheim zu ziehen, und nimmt einfach das ganze Haus mit.“<br /><small>Na, welcher Film?</small></p>
      </div>
      ${resume.join('')}
      <div class="mode-cards">
        <button class="mode-card mode-stage" data-act="new-game">
          <span class="mode-icon">💻</span>
          <span class="mode-body"><b>Spiel anlegen</b><small>Am Laptop, Tablet oder Fernseher: Er zeigt die Beschreibungen, Hinweise, die Auflösung und den Punktestand.</small></span>
          <span class="mode-go">Los geht's →</span>
        </button>
        <button class="mode-card mode-phone" data-act="join-screen">
          <span class="mode-icon">📱</span>
          <span class="mode-body"><b>Mitspielen</b><small>Mit dem Handy einem Spiel beitreten – QR-Code am Laptop scannen oder Raum-Code eingeben.</small></span>
          <span class="mode-go">Beitreten →</span>
        </button>
      </div>
      <div class="home-links">
        <button class="btn btn-link" data-act="rules">📖 Spielregeln</button>
      </div>
      <p class="home-foot">${st.films} Filme und ${st.serien} Serien in ${Films.CATEGORIES.length} Kategorien · mit oder ohne Handys</p>
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
    let people;
    if (!st.solo) {
      const teams = s.teams
        .map((t, ti) => {
          const def = TEAMS[ti];
          if (!t.active) {
            return `<button class="team-setup off" style="${tc(def.color)}" data-act="team-toggle" data-team="${ti}"><span class="ts-add">＋</span><span>Team ${def.label} hinzufügen</span></button>`;
          }
          return `
            <div class="team-setup" style="${tc(def.color)}">
              <div class="ts-head">
                <span class="team-dot"></span>
                <input class="input input-team" type="text" maxlength="24" placeholder="Team ${def.label}" value="${esc(t.name)}"
                  data-field="team-name" data-team="${ti}" autocomplete="off" aria-label="Teamname" />
                ${activeCount > 1 ? `<button class="icon-btn" data-act="team-toggle" data-team="${ti}" aria-label="Team entfernen" title="Team entfernen">✕</button>` : ''}
              </div>
              <p class="muted small">${st.input === 'write' ? 'Die Spieler treten mit dem Handy bei.' : 'Das Team berät sich und ruft gemeinsam.'}</p>
            </div>`;
        })
        .join('');
      people = `<h2>Teams <small class="muted">(1–4)</small></h2><div class="team-grid">${teams}</div>`;
    } else if (st.input === 'say') {
      const rows = s.players
        .map(
          (p, pi) => `
          <div class="player-row" style="${tc(E.SOLO_COLORS[pi % 12])}">
            <span class="team-dot"></span>
            <input class="input" type="text" maxlength="24" placeholder="Spieler ${pi + 1}" value="${esc(p)}"
              data-field="player-name" data-player="${pi}" autocomplete="off" enterkeyhint="next" />
            ${s.players.length > 1 ? `<button class="icon-btn" data-act="remove-player" data-player="${pi}" aria-label="Spieler entfernen">✕</button>` : ''}
          </div>`
        )
        .join('');
      people = `<h2>Mitspieler <small class="muted">(1–${MAX_PLAYERS}, jede/r spielt für sich)</small></h2>
        <div class="ts-players solo-players">${rows}</div>
        ${s.players.length < MAX_PLAYERS ? '<button class="btn btn-small btn-ghost" data-act="add-player">＋ Spieler</button>' : ''}`;
    } else {
      people = `<h2>Mitspieler</h2><p class="muted">Jede/r tritt mit dem eigenen Handy bei und spielt für sich (bis ${MAX_PLAYERS} Personen).</p>`;
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
        <div class="input-cards">${inputCard('write')}${inputCard('say')}</div>
      </section>
      <section class="panel">
        <div class="setting setting-top">
          <div class="setting-label"><b>Wer rät?</b><small>${st.solo ? 'Jede Person spielt für sich und hat eine eigene Farbe.' : 'Die Teams beraten sich und raten gemeinsam.'}</small></div>
          ${seg('solo', ['teams', 'solo'], st.solo ? 'solo' : 'teams', (o) => (o === 'solo' ? '🙋 Jeder für sich' : '👥 Teams'), 'setup')}
        </div>
        ${people}
      </section>
      <section class="panel">
        <h2>Einstellungen</h2>
        ${settingsHtml(st, 'setup')}
      </section>
      <section class="panel">
        <h2>Kategorien</h2>
        ${categoriesHtml(st, 'setup')}
      </section>
      <div class="sticky-start">
        <button class="btn btn-primary btn-big" data-act="create-game">${st.input === 'write' ? 'Raum öffnen 📱' : 'Film ab! 🎬'}</button>
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
    else if (v.round) round = `<span class="pill">🎞️ Film ${v.round} / ${v.films}</span>`;
    const room = v.room && v.room.code && v.phase !== 'lobby' ? `<button class="pill pill-room" data-act="show-qr" title="Mitspieler einladen">📱 ${esc(v.room.code)}</button>` : '';
    return `
      <header class="topbar">
        <button class="topbar-brand" data-act="menu" aria-label="Menü">${logoHtml(true)}</button>
        <div class="topbar-info">${round}${room}</div>
        <div class="topbar-actions">
          <button class="icon-btn" data-act="mute" aria-label="Ton an/aus" title="Ton an/aus">${Sound.muted ? '🔇' : '🔊'}</button>
          <button class="icon-btn" data-act="menu" aria-label="Menü" title="Menü">☰</button>
        </div>
      </header>`;
  }

  function scoreboardHtml(v) {
    const ids = v.order;
    if (!ids.length) return '';
    // Während der Auflösung kurz noch den alten Punktestand zeigen
    const held = v.phase === 'reveal' && holding(v);
    const score = (id) => {
      const t = teamOf(v, id);
      const r = held && v.cur.results && v.cur.results[id];
      return t.score - (r ? r.points : 0);
    };
    const max = Math.max(1, ...ids.map(score));
    const lead = Math.max(...ids.map(score));
    return `
      <footer class="scoreboard ${ids.length > 6 ? 'is-many' : ''}" aria-label="Punktestand">
        ${ids
          .map((id) => {
            const t = teamOf(v, id);
            const sc = score(id);
            const playing = !v.cur || v.cur.teams.includes(id);
            return `
            <div class="score ${playing ? '' : 'is-out'}" style="${tc(t.color)}">
              <div class="score-head"><span class="team-dot"></span><b>${esc(t.name)}</b>${sc === lead && lead > 0 && ids.length > 1 ? ' 👑' : ''}</div>
              <div class="score-bar"><span style="width:${(100 * sc) / max}%"></span></div>
              <div class="score-num">${sc}</div>
            </div>`;
          })
          .join('')}
      </footer>`;
  }

  function stageHtml(v) {
    let main;
    if (v.phase === 'lobby') main = lobbyStageHtml(v);
    else if (v.phase === 'over') main = overHtml(v);
    else if (v.phase === 'reveal') main = revealStageHtml(v);
    else if (v.phase === 'explain') main = explainStageHtml(v);
    else main = guessStageHtml(v);
    return `
      <div class="stage phase-${v.phase}">
        ${topbarHtml(v)}
        <main class="stage-main">${main}</main>
        ${v.phase !== 'lobby' && v.phase !== 'over' ? scoreboardHtml(v) : ''}
      </div>`;
  }

  /* ---------- Lobby ---------- */

  function lobbyStageHtml(v) {
    const solo = v.settings.solo;
    const chip = (m, color) =>
      `<span class="chip ${m.online ? '' : 'is-offline'}" ${color ? `style="${tc(color)}"` : ''}>${color ? '<span class="team-dot"></span>' : ''}${esc(m.name)}<button class="chip-x" data-act="kick" data-player="${esc(m.id)}" aria-label="${esc(m.name)} entfernen">✕</button></span>`;
    let people;
    if (solo) {
      const playing = v.teams.filter((t) => t.players.length);
      const watching = v.members.filter((m) => !m.team);
      people = `
        <section class="panel">
          <h2>Mitspieler <small class="muted">(${playing.length} / ${MAX_PLAYERS})</small></h2>
          <div class="chips">${
            playing.length
              ? playing.map((t) => chip(v.members.find((m) => m.id === t.players[0].id) || { id: t.players[0].id, name: t.name, online: false }, t.color)).join('')
              : '<span class="muted">Noch niemand – QR-Code scannen!</span>'
          }</div>
          ${watching.length ? `<div class="free"><b>Schauen nur zu:</b> <div class="chips">${watching.map((m) => chip(m)).join('')}</div></div>` : ''}
        </section>`;
    } else {
      const activeCount = v.teams.filter((t) => t.active).length;
      const teams = v.teams
        .map((t) => {
          if (!t.active) {
            return `<button class="team-setup off" style="${tc(t.color)}" data-act="lobby-team" data-team="${t.id}" data-on="1"><span class="ts-add">＋</span><span>Team ${t.label} hinzufügen</span></button>`;
          }
          const members = t.players.map((p) => v.members.find((m) => m.id === p.id) || { id: p.id, name: p.name, online: false });
          return `
            <div class="team-setup" style="${tc(t.color)}">
              <div class="ts-head">
                <span class="team-dot"></span>
                <input class="input input-team" type="text" maxlength="24" value="${esc(t.name)}" data-field="lobby-team-name" data-team="${t.id}" aria-label="Teamname" />
                ${activeCount > 1 ? `<button class="icon-btn" data-act="lobby-team" data-team="${t.id}" data-on="0" aria-label="Team entfernen">✕</button>` : ''}
              </div>
              <div class="chips">${members.length ? members.map((m) => chip(m)).join('') : '<span class="muted">Noch niemand – auf dem Handy dieses Team wählen</span>'}</div>
            </div>`;
        })
        .join('');
      const free = v.members.filter((m) => !m.team);
      people = `
        <section class="panel">
          <h2>Teams</h2>
          <div class="team-grid">${teams}</div>
          ${free.length ? `<div class="free"><b>Noch ohne Team:</b> <div class="chips">${free.map((m) => chip(m)).join('')}</div></div>` : ''}
        </section>`;
    }
    return `
      <div class="lobby-grid">
        <section class="panel join-panel">
          <h2>📱 Handys verbinden</h2>
          <p class="muted">QR-Code scannen, Namen eingeben${solo ? '' : ', Team wählen'}.</p>
          ${roomBoxHtml(v.room, true)}
        </section>
        <div class="lobby-side">
          ${people}
          <section class="panel">
            <h2>Einstellungen</h2>
            ${settingsHtml(v.settings, 'lobby')}
          </section>
          <section class="panel">
            <h2>Kategorien</h2>
            ${categoriesHtml(v.settings, 'lobby')}
          </section>
          <div class="sticky-start">
            <button class="btn btn-primary btn-big" data-act="start" ${v.lobbyProblem ? 'disabled' : ''}>Film ab! 🎬</button>
            ${v.lobbyProblem ? `<p class="muted small center">${esc(v.lobbyProblem)}</p>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ---------- Selbst erklären (Bühne wartet) ---------- */

  function explainStageHtml(v) {
    const c = v.cur;
    const t = teamOf(v, c.explain.team);
    return `
      <div class="center-stage">
        ${tiebreakBanner(v)}
        <div class="explain-wait" style="${tc(t && t.color)}">
          <div class="explain-pen" aria-hidden="true">✍️</div>
          <h2><span class="team-dot"></span> ${esc(c.explain.name)} erklärt gerade einen Film …</h2>
          <p class="muted">Nur ${esc(c.explain.name)} sieht den Titel auf dem Handy. Gleich geht's los!</p>
        </div>
        <div class="stage-actions">
          <button class="btn btn-ghost btn-small" data-act="skip">⏭️ Jemand anderes</button>
        </div>
      </div>`;
  }

  /* ---------- Raten ---------- */

  function teamStatusHtml(v) {
    const c = v.cur;
    if (!c.status) return '';
    const cards = c.teams
      .map((id) => {
        const t = teamOf(v, id);
        const st = c.status[id];
        let state;
        if (!c.guessing.includes(id)) state = '<div class="tstat-state">✍️ erklärt</div>';
        else if (st.ok) state = '<div class="tstat-state done">✅ Richtig!</div>';
        else if (st.done) state = '<div class="tstat-state out">❌ raus</div>';
        else if (st.tries) state = `<div class="tstat-state typing">🤔 ${st.tries}× daneben</div>`;
        else state = '<div class="tstat-state">💭 überlegt …</div>';
        const dots = c.choices || !c.guessing.includes(id) ? '' : `<div class="tries">${Array.from({ length: MAX_TRIES }, (_, i) => `<span class="${i < st.tries ? 'used' : ''}"></span>`).join('')}</div>`;
        return `<div class="tstat ${st.ok ? 'is-done' : ''} ${st.done && !st.ok ? 'is-out' : ''}" style="${tc(t.color)}">
          <h3><span class="team-dot"></span>${esc(t.name)}</h3>
          ${state}${dots}
        </div>`;
      })
      .join('');
    return `<div class="tstats">${cards}</div>`;
  }

  function guessStageHtml(v) {
    const c = v.cur;
    const write = v.settings.input === 'write';
    const hintBtn = c.hintsOn && c.hint < c.maxHint ? `<button class="btn btn-ghost btn-small" data-act="hint">💡 Hinweis aufdecken</button>` : '';
    const actions = write
      ? `${hintBtn}<button class="btn btn-ghost btn-small" data-act="skip">🔀 Anderer Film</button><button class="btn btn-ghost btn-small" data-act="finish-round">⏩ Jetzt auflösen</button>`
      : `${hintBtn}<button class="btn btn-ghost btn-small" data-act="skip">🔀 Anderer Film</button>`;
    return `
      <div class="center-stage guess-stage">
        ${tiebreakBanner(v)}
        ${filmCardHtml(c)}
        ${choicesHtml(c)}
        ${hintsHtml(c, { countdown: write })}
        ${write ? timerHtml(c.timer, true) : ''}
        ${pointsNowHtml(c)}
        ${write ? teamStatusHtml(v) : `<button class="btn btn-primary btn-big" data-act="reveal">🎬 Auflösen</button><p class="muted small center">Alle rufen ihren Tipp – danach tippt ihr an, wer es hatte.</p>`}
        <div class="stage-actions">${actions}</div>
      </div>`;
  }

  /* ---------- Auflösung ---------- */

  function resultLine(v, id) {
    const c = v.cur;
    const r = c.results[id];
    const parts = [];
    if (r.ok && c.hintsOn) parts.push(r.hint ? `nach Hinweis ${r.hint}` : 'ohne Hinweis');
    if (r.ok && r.ms != null) parts.push(`${seconds(r.ms)} s`);
    if (r.bonus) parts.push(`⚡ +${r.bonus} am schnellsten`);
    if (r.explain) parts.push(`✍️ +${r.explain} fürs Erklären`);
    if (r.accepted) parts.push('✓ zählt doch');
    return parts.join(' · ');
  }

  function revealStageHtml(v) {
    const c = v.cur;
    const f = c.film;
    const cat = catOf(f.cat);
    const write = v.settings.input === 'write';
    const ids = c.teams.slice().sort((a, b) => c.results[b].points - c.results[a].points);
    const rows = ids
      .map((id, i) => {
        const t = teamOf(v, id);
        const r = c.results[id];
        const got = r.ok || r.accepted;
        const wrong = write && c.guesses ? c.guesses[id].filter((x) => x.res !== 'yes').map((x) => `„${esc(x.text)}“`) : [];
        let action = '';
        if (!write) {
          action = `<button class="btn btn-small ${r.ok ? 'btn-ok' : 'btn-ghost'}" data-act="had" data-team="${id}">${r.ok ? '✅ hatte es' : 'Hatte es?'}</button>`;
        } else if (!r.ok && c.guesses && c.guesses[id].length) {
          action = `<button class="btn btn-small ${r.accepted ? 'btn-ok' : 'btn-ghost'}" data-act="accept" data-team="${id}" title="Die App hat eine richtige Antwort nicht erkannt">${r.accepted ? '✓ zählt doch' : 'zählt doch?'}</button>`;
        }
        const role = c.explain && c.explain.team === id && !c.guessing.includes(id) ? '<span class="muted small"> · hat erklärt</span>' : '';
        return `<div class="res-row ${got ? 'is-hit' : ''}" style="${tc(t.color)};--d:${(0.5 + i * 0.12).toFixed(2)}s">
          <span class="res-rank">${got ? '✅' : r.points ? '✍️' : '❌'}</span>
          <span class="team-dot"></span>
          <div class="res-main">
            <div class="res-line"><b class="res-name">${esc(t.name)}</b>${role}</div>
            <div class="res-diff">${esc(resultLine(v, id)) || (wrong.length ? `tippte ${wrong.join(', ')}` : write && c.guessing.includes(id) ? 'kein Tipp' : '')}</div>
            ${got && wrong.length ? `<div class="res-members">vorher: ${wrong.join(', ')}</div>` : ''}
          </div>
          ${action}
          <div class="res-pts"><b>+${r.points}</b></div>
        </div>`;
      })
      .join('');
    const explainNote = c.explain
      ? `<div class="fact">✍️ ${esc(c.explain.name)} hat erklärt: ${
          c.explain.tooEasy ? 'Viel zu leicht – alle hatten es sofort, deshalb 0 Punkte.' : `+${c.explain.points} ${plural(c.explain.points, 'Punkt', 'Punkte')} fürs Erklären.`
        }<br /><small>So steht's in unserer Sammlung: „${esc(f.text)}“</small></div>`
      : '';
    return `
      <div class="center-stage reveal" id="rv-${c.no}-${c.qNo}">
        ${tiebreakBanner(v)}
        <div class="clapper" aria-hidden="true">🎬</div>
        <h1 class="film-title">${esc(f.title)}</h1>
        <div class="film-meta">${f.year} · ${cat.icon} ${esc(cat.label)}${f.tip ? ` · ${esc(f.tip)}` : ''}</div>
        ${filmCardHtml(c, { small: true })}
        ${choicesHtml(c, { answer: f.title })}
        <div class="reveal-after" style="--d:0.5s">
          ${!write ? '<p class="muted center">Wer hatte es? Antippen – nochmal tippen nimmt es zurück.</p>' : ''}
          <div class="results">${rows}</div>
          ${explainNote}
          <button class="btn btn-link btn-small" data-act="report">👎 Diesen Film melden</button>
        </div>
        <button class="btn btn-primary btn-big next-float" style="--d:0.6s" data-act="next" data-no="${c.no}">Weiter →</button>
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
        <div class="podium-step p${i + 1}" style="${tc(team.color)}">
          <div class="podium-medal">${['🥇', '🥈', '🥉'][place - 1] || '🏅'}</div>
          <b>${esc(team.name)}</b>
          <span>${team.score} ${plural(team.score, 'Punkt', 'Punkte')}</span>
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
    const films = (v.history || [])
      .map((h) => `<li><b>${esc(h.film.title)}</b> <small class="muted">(${h.film.year})</small>${h.explainer ? `<br /><small>✍️ ${esc(h.explainer)}: „${esc(h.text)}“</small>` : ''}</li>`)
      .join('');
    return `
      <div class="center-stage over">
        <h1 class="over-title">${!pl.length ? '🏁 Spiel vorbei' : single ? `🎬 ${pl[0].team.score} Punkte!` : v.winners.length > 1 ? `🤝 Unentschieden: ${winnerNames}` : `🏆 ${winnerNames} gewinnt!`}</h1>
        ${single || !pl.length ? '' : `<div class="podium">${podium}</div>`}
        ${rest.length ? `<div class="summary">${rest.map(({ team, place }) => `<div class="summary-row" style="${tc(team.color)}"><span class="team-dot"></span><b>${place}. ${esc(team.name)}</b><b class="summary-points">${team.score}</b></div>`).join('')}</div>` : ''}
        ${loser ? `<p class="loser">🍿 Verloren hat <b>${esc(loser.name)}</b> mit ${loser.score} ${plural(loser.score, 'Punkt', 'Punkten')}.</p>` : ''}
        ${awards ? `<div class="awards">${awards}</div>` : ''}
        ${films ? `<details class="film-list"><summary>🎞️ Alle Filme dieses Spiels (${v.history.length})</summary><ol>${films}</ol></details>` : ''}
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
    if (v.phase === 'lobby') body = phoneLobbyHtml(v, t);
    else if (v.phase === 'over') body = phoneOverHtml(v);
    else if (v.phase === 'explain') body = phoneExplainHtml(v, t);
    else if (!t || !v.order.includes(t.id) || !v.cur.teams.includes(t.id)) body = phoneSpectatorHtml(v, t);
    else if (v.phase === 'reveal') body = phoneRevealHtml(v, t);
    else body = phoneGuessHtml(v, t);
    // Spielleitung am Handy: Falls die Bühne ein Fernseher ist, kann das erste Handy weiterschalten
    if (me.lead && v.phase === 'guess' && v.cur.hintsOn && v.cur.hint < v.cur.maxHint) {
      body += `<button class="btn btn-ghost btn-wide phone-lead" data-act="hint">💡 Hinweis aufdecken <small>Du bist die Spielleitung</small></button>`;
    }
    if (me.lead && v.phase === 'reveal') {
      body += `<button class="btn btn-primary btn-big btn-wide phone-next" data-act="next" data-no="${v.cur.no}">Nächster Film →<small>Du bist die Spielleitung</small></button>`;
    }
    return `
      <div class="phone" ${t ? `style="${tc(t.color)}"` : ''}>
        <header class="phone-head">
          <span class="team-dot"></span>
          <b>${t ? esc(t.name) : 'Zuschauer'}</b>
          <span class="phone-name">${t && t.solo ? '' : esc(me.name)}</span>
          <button class="icon-btn" data-act="menu" aria-label="Menü">☰</button>
        </header>
        ${phoneStatusBanner()}
        <main class="phone-main">${body}</main>
      </div>`;
  }

  function phoneLobbyHtml(v, t) {
    if (v.settings.solo) {
      const n = v.teams.filter((x) => x.players.length).length;
      return t
        ? `<div class="look-up">🙋<b>Du bist dabei!</b><small>${n} ${plural(n, 'Person', 'Personen')} im Spiel · jede/r spielt für sich</small></div>
           <p class="waiting">⏳ Warte, bis es am Laptop losgeht…</p>
           <button class="btn btn-link" data-act="join-team" data-team="">Doch nur zuschauen</button>`
        : `<div class="look-up">👀<b>Du schaust zu</b></div>
           <button class="btn btn-primary btn-big btn-wide" data-act="join-team" data-team="me">🙋 Mitspielen</button>`;
    }
    const active = v.teams.filter((x) => x.active);
    return `
      <h2 class="phone-title">Wähle dein Team</h2>
      <div class="team-pick">
        ${active
          .map(
            (x) => `
          <button class="team-btn ${v.me.team === x.id ? 'is-mine' : ''}" style="${tc(x.color)}" data-act="join-team" data-team="${x.id}" aria-pressed="${v.me.team === x.id}">
            <b>${esc(x.name)} ${v.me.team === x.id ? '✓' : ''}</b>
            <small>${x.players.length ? x.players.map((p) => esc(p.name)).join(' · ') : 'noch leer'}</small>
          </button>`
          )
          .join('')}
      </div>
      <p class="waiting">${v.me.team ? '⏳ Warte, bis es am Laptop losgeht…' : 'Tippe auf ein Team.'}</p>`;
  }

  function phoneSpectatorHtml(v, t) {
    const canJoin = !t && v.phase !== 'over';
    let join = '';
    if (canJoin && v.settings.solo) {
      join = `<button class="btn btn-primary btn-wide" data-act="join-team" data-team="me">🙋 Mitspielen (ab dem nächsten Film)</button>`;
    } else if (canJoin) {
      join = `<p class="center">Einem Team beitreten (ab dem nächsten Film dabei):</p>
        <div class="team-pick">${v.order
          .map((id) => teamOf(v, id))
          .map((x) => `<button class="team-btn" style="${tc(x.color)}" data-act="join-team" data-team="${x.id}"><b>${esc(x.name)}</b></button>`)
          .join('')}</div>`;
    }
    const why = !t ? 'Du schaust gerade zu.' : v.cur && v.cur.tiebreak ? 'Stechen – ihr seid diesmal nicht dabei.' : 'Ihr seid ab dem nächsten Film dabei.';
    return `
      ${v.cur && v.cur.text ? filmCardHtml(v.cur, { small: true }) : ''}
      <div class="look-up">👀<b>Schau auf den Laptop!</b><small>${why}</small></div>
      ${join}`;
  }

  /** Selbst erklären: geheimer Film + Textfeld (nur die erklärende Person) */
  function phoneExplainHtml(v, t) {
    const c = v.cur;
    if (!c.secret) {
      return `<div class="look-up">✍️<b>${esc(c.explain.name)} erklärt gerade einen Film …</b><small>Gleich geht's los – halte dich bereit!</small></div>`;
    }
    const s = c.secret;
    const cat = catOf(s.cat);
    const leaks = Titles.leaks(ui.explain, { title: s.title, alts: s.alts });
    const len = ui.explain.trim().length;
    const warn = leaks.length ? `<div class="word-error">⚠️ Verrät den Titel: ${leaks.map((w) => `„${esc(w)}“`).join(', ')}</div>` : '';
    return `
      <div class="secret-card">
        <small>🙈 Nur für dich – erkläre diesen Film schlecht:</small>
        <b>${esc(s.title)}</b>
        <span>${s.year} · ${cat.icon} ${esc(cat.label)}</span>
      </div>
      ${c.explain.rerollsLeft > 0 ? `<button class="btn btn-ghost btn-small" data-act="reroll">🔀 Kenn ich nicht <small>(noch ${c.explain.rerollsLeft}×)</small></button>` : ''}
      <form class="explain-form" data-form="explain">
        <label class="label" for="explain-input">1–3 Sätze: technisch wahr, aber völlig daneben</label>
        <textarea id="explain-input" class="input input-explain" rows="4" maxlength="${MAX_EXPLAIN}" placeholder="z.B. „Ein Mann redet am Strand mit einem Ball.“" data-field="explain">${esc(ui.explain)}</textarea>
        <div class="num-note">${len} / ${MAX_EXPLAIN} Zeichen · keine Namen, keine Wörter aus dem Titel</div>
        ${warn}
        <button class="btn btn-primary btn-big btn-wide" type="submit" ${len < MIN_EXPLAIN ? 'disabled' : ''}>${leaks.length ? 'Trotzdem senden' : 'Senden ✓'}</button>
      </form>`;
  }

  function suggestionsHtml(v) {
    if (!v.settings.suggest || ui.guess.trim().length < 2) return '';
    const list = Titles.suggest(ui.guess, titles(), SUGGEST_MAX);
    if (!list.length) return '<div class="suggest muted small">Kein passender Titel in unserer Sammlung</div>';
    return `<div class="suggest">${list.map((t) => `<button type="button" class="suggest-item" data-act="suggest" data-title="${esc(t)}">${esc(t)}</button>`).join('')}</div>`;
  }

  function guessFeedbackHtml(mine) {
    const last = mine.list[mine.list.length - 1];
    if (!last || last.res === 'yes') return '';
    if (last.res === 'close') return `<div class="feedback close">🤏 „${esc(last.text)}“ – knapp daneben! Tippfehler? <small>Kostet keinen Versuch</small></div>`;
    return `<div class="feedback wrong">❌ „${esc(last.text)}“ ist es nicht${last.by && last.by !== ui.view.me.name ? ` <small>(${esc(last.by)})</small>` : ''}</div>`;
  }

  function phoneGuessHtml(v, t) {
    const c = v.cur;
    const mine = c.mine;
    // Selbst erklären: Die erklärende Person schaut zu
    if (c.explain && c.explain.pid === v.me.id) {
      return `${filmCardHtml(c, { small: true })}
        <div class="look-up">🍿<b>Die anderen raten deinen Film …</b><small>Du bekommst ${E.EXPLAIN_POINT} Punkt für jedes Team, das ihn errät – aber nicht, wenn es alle sofort wissen.</small></div>
        ${timerHtml(c.timer, false)}`;
    }
    if (!mine || !mine.participant) {
      return `${filmCardHtml(c, { small: true })}<div class="look-up">⏳<b>Du bist ab dem nächsten Film dabei.</b></div>`;
    }
    const parts = [filmCardHtml(c, { small: true }), timerHtml(c.timer, true)];
    if (c.choices) {
      parts.push(choicesHtml(c, { phone: true, pick: mine.pick, locked: mine.done }));
      if (mine.done) parts.push(`<p class="waiting">${mine.ok ? '✅ Richtig! ' : '❌ Leider daneben. '}⏳ Warte auf die anderen …</p>`);
      return parts.join('');
    }
    if (mine.ok) {
      parts.push(`<div class="submitted is-ok"><small>${t.solo ? 'Du hast es' : 'Ihr habt es'}!</small><b>✅ +${mine.points}</b><small class="by">${esc(mine.list[mine.list.length - 1].text)}</small></div>
        <p class="waiting">⏳ Warte auf die anderen …</p>`);
      return parts.join('');
    }
    if (mine.done) {
      parts.push(`<div class="look-up">🙈<b>Keine Versuche mehr</b><small>Schau auf den Laptop – gleich wird aufgelöst.</small></div>`, hintsHtml(c));
      return parts.join('');
    }
    parts.push(`
      ${pointsNowHtml(c)}
      <form class="guess-form" data-form="guess">
        <input id="guess-input" class="input input-big input-guess" type="text" maxlength="${MAX_GUESS}" placeholder="Welcher Film?" value="${esc(ui.guess)}"
          data-field="guess" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="send" />
        ${suggestionsHtml(v)}
        <div class="tries tries-big" aria-label="${mine.triesLeft} Versuche übrig">${Array.from({ length: MAX_TRIES }, (_, i) => `<span class="${i < mine.tries ? 'used' : ''}"></span>`).join('')}</div>
        ${guessFeedbackHtml(mine)}
        <button class="btn btn-primary btn-big btn-wide" type="submit">Raten 🎬</button>
      </form>
      ${hintsHtml(c, { countdown: true })}
      ${!t.solo && mine.list.length ? `<p class="muted small center">Euer Team: ${mine.list.map((x) => `${esc(x.by)} „${esc(x.text)}“ ${x.res === 'no' ? '❌' : x.res === 'close' ? '🤏' : '✅'}`).join(' · ')}</p>` : ''}`);
    return parts.join('');
  }

  function phoneRevealHtml(v, t) {
    const c = v.cur;
    const r = c.results[t.id];
    const f = c.film;
    const got = r.ok || r.accepted;
    let headline;
    if (c.explain && c.explain.team === t.id && !c.guessing.includes(t.id)) headline = c.explain.tooEasy ? '😅 Zu leicht erklärt' : '✍️ Gut erklärt!';
    else if (got) headline = r.bonus ? '⚡ Am schnellsten!' : '✅ Richtig!';
    else headline = '🙈 Nicht erkannt';
    return `
      <div class="phone-result">
        <div class="pr-answer"><small>Der Film</small><b>${esc(f.title)}</b><span class="muted">${f.year}</span></div>
        <div class="pr-head">${headline}</div>
        <div class="pr-points">+${r.points} ${plural(r.points, 'Punkt', 'Punkte')}</div>
      </div>
      <div class="look-up small">👀 Schau auf den Laptop!</div>`;
  }

  function phoneOverHtml(v) {
    const pl = places(v);
    const mine = pl.find((p) => p.team.id === v.me.team);
    let head = '<div class="look-up">🏁<b>Spiel vorbei!</b></div>';
    if (mine) {
      head =
        mine.place === 1
          ? `<div class="look-up win">🏆<b>${v.winners.length > 1 ? 'Geteilter Sieg!' : mine.team.solo ? 'Du hast gewonnen!' : 'Ihr habt gewonnen!'}</b><small>${mine.team.score} Punkte</small></div>`
          : `<div class="look-up">${mine.place === pl.length ? '🍿' : '🏅'}<b>Platz ${mine.place}</b><small>${mine.team.score} Punkte</small></div>`;
    }
    return `${head}
      <div class="summary">${pl
        .map(({ team, place }) => `<div class="summary-row" style="${tc(team.color)}"><span class="team-dot"></span><b>${place}. ${esc(team.name)}</b><b class="summary-points">${team.score}</b></div>`)
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
    else if (ui.modal === 'report') body = reportHtml();
    else if (ui.modal === 'reports') body = reportsHtml();
    else if (ui.modal === 'qr') {
      body = `<h2>📱 Mitspieler einladen</h2>${roomBoxHtml(ui.view && ui.view.room, false)}
        <p class="muted small center">Wer jetzt beitritt, spielt ab dem nächsten Film mit.</p>
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

  function reportHtml() {
    const f = ui.report;
    if (!f) return '';
    return `<h2>👎 „${esc(f.title)}“ melden</h2>
      <p class="muted">Was stimmt mit der Beschreibung nicht? Die Meldung bleibt auf diesem Gerät – über das Menü kannst du alle Meldungen kopieren.</p>
      <div class="menu-list">${REPORT_REASONS.map((r) => `<button class="menu-item" data-act="report-reason" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}</div>`;
  }

  function reportsHtml() {
    const list = loadReports();
    return `<h2>📋 Gemeldete Filme (${list.length})</h2>
      ${
        list.length
          ? `<ol class="report-list">${list.map((r) => `<li><b>${esc(r.title)}</b> – ${esc(r.reason)}<br /><small class="muted">${esc(r.text)}</small></li>`).join('')}</ol>`
          : '<p class="muted">Noch nichts gemeldet. Nach jeder Auflösung gibt es den Knopf „👎 Diesen Film melden“.</p>'
      }
      <div class="modal-actions">
        ${list.length ? '<button class="btn btn-primary" data-act="copy-reports">📋 Kopieren</button><button class="btn btn-ghost" data-act="clear-reports">Leeren</button>' : ''}
        <button class="btn btn-ghost" data-act="close-modal">Schließen</button>
      </div>`;
  }

  function rulesHtml() {
    return `
      <h2>📖 Spielregeln</h2>
      <div class="rules">
        <p>Auf dem Laptop steht eine <b>schlecht erklärte</b> Filmbeschreibung: technisch wahr, aber völlig daneben.
          Wer den Film erkennt, bekommt Punkte. Nach der eingestellten Zahl an Filmen gewinnt, wer die meisten Punkte hat –
          bei Gleichstand an der Spitze gibt es ein <b>Stechen</b>.</p>
        <h3>💡 Hinweise</h3>
        <p>Kommt niemand drauf, werden nacheinander <b>Jahr & Genre</b>, ein <b>Tipp</b> (z.B. ein Darsteller) und die
          <b>Titel-Lücken</b> aufgedeckt. Ein Treffer bringt ${HINT_POINTS.join(' / ')} Punkte – je nachdem, wie viele Hinweise schon offen waren.</p>
        <h3>📱 Mit Handys</h3>
        <p>Alle tippen den Titel auf dem Handy – deutscher oder Originaltitel, kleine Tippfehler sind egal. Jedes Team hat
          <b>${MAX_TRIES} Versuche</b>, „knapp daneben“ kostet nichts. Wer zuerst richtig liegt, bekommt <b>+${FIRST_BONUS}</b>.
          Erkennt die App eine richtige Antwort nicht, kann sie am Laptop mit <b>„zählt doch“</b> nachträglich gewertet werden.</p>
        <h3>🔘 Auswahl</h3>
        <p>Statt zu tippen gibt es 4 Antworten zur Wahl – ein Versuch, ${CHOICE_POINTS} Punkte, +${FIRST_BONUS} für die Schnellsten.</p>
        <h3>🗣️ Ein Gerät</h3>
        <p>Alle rufen ihren Tipp. Hinweise werden am Laptop aufgedeckt, nach dem Auflösen tippt ihr an, wer es hatte.</p>
        <h3>✍️ Selbst erklären</h3>
        <p>Reihum bekommt eine Person geheim einen Film aufs Handy und erklärt ihn selbst schlecht (1–3 Sätze, keine Namen,
          keine Wörter aus dem Titel). Alle anderen raten. Für jedes andere Team, das den Film errät, gibt es ${E.EXPLAIN_POINT} Punkt –
          wissen es alle in den ersten ${E.EASY_MS / 1000} Sekunden, war es zu leicht und gibt 0.</p>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Film ab!</button></div>`;
  }

  function menuHtml() {
    const v = ui.view;
    const items = [];
    items.push(`<button class="menu-item" data-act="rules">📖 Spielregeln</button>`);
    items.push(`<button class="menu-item" data-act="mute">${Sound.muted ? '🔊 Ton einschalten' : '🔇 Ton ausschalten'}</button>`);
    if (!v || v.me.stage) items.push(`<button class="menu-item" data-act="show-reports">📋 Gemeldete Filme <small>(${loadReports().length})</small></button>`);
    if (v && v.me.stage) {
      const write = v.settings.input === 'write';
      if (write && v.room) items.push(`<button class="menu-item" data-act="show-qr">📱 Mitspieler einladen</button>`);
      if (v.cur && ['explain', 'guess'].includes(v.phase)) items.push(`<button class="menu-item" data-act="skip">🔀 Anderer Film</button>`);
      if (v.cur && v.phase === 'guess') items.push(`<button class="menu-item" data-act="finish-round">⏩ Jetzt auflösen</button>`);
      items.push(`<button class="menu-item" data-act="home-keep">🏠 Hauptmenü <small>(Spiel bleibt gespeichert)</small></button>`);
      if (!['lobby', 'over'].includes(v.phase)) items.push(`<button class="menu-item danger" data-act="end-game">⏹️ Spiel beenden & Ergebnis zeigen</button>`);
      items.push(`<button class="menu-item danger" data-act="close-game">🚪 Spiel schließen</button>`);
    } else if (v) {
      if (v.phase === 'lobby' && v.me.team) items.push(`<button class="menu-item" data-act="join-team" data-team="">↩️ ${v.settings.solo ? 'Nur zuschauen' : 'Team verlassen'}</button>`);
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
    ui.error = null;
    const state = Engine.create({ settings: s.settings, teams: s.teams, players: s.players });
    Sound.unlock();
    startStage({ state });
  }

  function setInput(selector, value) {
    // Ein fokussiertes Feld überspringt morphdom – deshalb direkt setzen
    const input = app.querySelector(selector);
    if (input) input.value = value;
  }

  const toggle = (key) => (el) => setSetting(el.dataset.scope, key, !scopeSettings(el.dataset.scope)[key]);

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
        text: 'Das Spiel endet sofort mit dem aktuellen Punktestand.',
        yes: 'Beenden',
        danger: true,
        run: () => dispatch('end'),
      }),

    /* Setup & Lobby */
    set: (el) => {
      const key = el.dataset.key;
      let value = el.dataset.value;
      if (['films', 'seconds'].includes(key)) value = +value;
      if (key === 'solo') value = value === 'solo';
      setSetting(el.dataset.scope, key, value);
    },
    'toggle-hints': toggle('hints'),
    'toggle-strict': toggle('strict'),
    'toggle-suggest': toggle('suggest'),
    'toggle-cat': (el) => {
      const cats = scopeSettings(el.dataset.scope).categories;
      const id = el.dataset.cat;
      const next = cats.includes(id) ? cats.filter((c) => c !== id) : cats.concat(id);
      if (!next.length) {
        toast('Mindestens eine Kategorie muss dabei sein.');
        return;
      }
      setSetting(el.dataset.scope, 'categories', next);
    },
    'team-toggle': (el) => {
      const t = ui.setup.teams[+el.dataset.team];
      if (t.active && ui.setup.teams.filter((x) => x.active).length <= 1) return;
      t.active = !t.active;
      saveSetup();
      render();
    },
    'add-player': () => {
      const p = ui.setup.players;
      if (p.length >= MAX_PLAYERS) return;
      p.push('');
      saveSetup();
      ui.focus = `[data-field="player-name"][data-player="${p.length - 1}"]`;
      render();
    },
    'remove-player': (el) => {
      const p = ui.setup.players;
      if (p.length <= 1) return;
      p.splice(+el.dataset.player, 1);
      saveSetup();
      render();
    },
    'create-game': createGame,
    'lobby-team': (el) => dispatch('teamActive', { team: el.dataset.team, active: el.dataset.on === '1' }),
    kick: (el) => dispatch('kick', { player: el.dataset.player }),
    start: () => dispatch('start'),
    'join-team': (el) => {
      ui.modal = null;
      dispatch('joinTeam', { team: el.dataset.team || null });
    },

    /* Spiel */
    next: (el) => dispatch('next', { no: el.dataset.no ? +el.dataset.no : undefined }),
    skip: () => dispatch('skip'),
    'finish-round': () => dispatch('finishRound'),
    reveal: () => dispatch('reveal'),
    hint: () => dispatch('hint', ui.view && !ui.view.me.stage ? { at: ui.view.me.stepKey } : {}),
    had: (el) => dispatch('had', { team: el.dataset.team }),
    accept: (el) => dispatch('accept', { team: el.dataset.team }),
    again: () => dispatch('again'),
    pick: (el) => {
      const v = ui.view;
      if (!v || !v.cur) return;
      dispatch('pick', { index: +el.dataset.index, at: v.me.stepKey });
    },
    suggest: (el) => {
      ui.guess = el.dataset.title;
      setInput('#guess-input', ui.guess);
      ui.focus = '#guess-input';
      render();
    },
    reroll: () => {
      const v = ui.view;
      if (!v || !v.cur) return;
      dispatch('reroll', { at: v.me.stepKey });
    },

    /* Melden */
    report: () => {
      const v = ui.view;
      if (!v || !v.cur || !v.cur.film) return;
      ui.report = { id: v.cur.film.id, title: v.cur.film.title, text: v.cur.film.text };
      ui.modal = 'report';
      render();
    },
    'report-reason': (el) => {
      const f = ui.report;
      if (!f) return;
      const list = loadReports().filter((r) => r.id !== f.id);
      list.push({ id: f.id, title: f.title, text: f.text, reason: el.dataset.reason, at: new Date().toISOString().slice(0, 10) });
      Store.set(REPORTS_KEY, list);
      ui.report = null;
      ui.modal = null;
      toast('Danke! Gemeldet – im Menü unter „Gemeldete Filme“.');
    },
    'show-reports': () => {
      ui.modal = 'reports';
      render();
    },
    'copy-reports': () => {
      const text = loadReports()
        .map((r) => `${r.id} | ${r.reason} | ${r.title} | ${r.text}`)
        .join('\n');
      const done = () => toast('In die Zwischenablage kopiert.');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => toast('Kopieren nicht möglich.'));
      else toast('Kopieren wird von diesem Browser nicht unterstützt.');
    },
    'clear-reports': () =>
      askConfirm({
        title: 'Meldungen löschen?',
        text: 'Alle gemeldeten Filme werden von diesem Gerät gelöscht.',
        yes: 'Löschen',
        danger: true,
        run: () => Store.remove(REPORTS_KEY),
      }),
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
      ui.setup.players[+el.dataset.player] = el.value;
      saveSetup();
    } else if (f === 'name') {
      ui.name = el.value;
    } else if (f === 'join-code') {
      ui.joinCode = Net.cleanCode(el.value);
    } else if (f === 'guess') {
      ui.guess = el.value;
      render();
    } else if (f === 'explain') {
      ui.explain = el.value;
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
      const next = app.querySelector(`[data-field="player-name"][data-player="${+el.dataset.player + 1}"]`);
      if (next) next.focus();
      else actions['add-player']();
    } else if (el.dataset.field === 'name') {
      e.preventDefault();
      const code = app.querySelector('#code-input');
      if (code && !code.value) code.focus();
      else app.querySelector('[data-form="join"] button[type="submit"]').click();
    } else if (el.dataset.field === 'lobby-team-name' || el.dataset.field === 'team-name') {
      el.blur();
    } else if (el.dataset.field === 'explain' && !e.shiftKey) {
      // Enter schickt ab (Zeilenumbrüche braucht eine Beschreibung nicht)
      e.preventDefault();
      const btn = app.querySelector('[data-form="explain"] button[type="submit"]');
      if (btn && !btn.disabled) btn.click();
    }
  });

  app.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const v = ui.view;
    const fieldValue = (sel) => {
      const input = form.querySelector(sel);
      return input ? input.value.trim() : '';
    };
    if (form.dataset.form === 'join') {
      const name = ui.name.trim();
      const code = Net.cleanCode(fieldValue('[data-field="join-code"]'));
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
    if (form.dataset.form === 'guess') {
      const text = fieldValue('[data-field="guess"]');
      if (!Titles.key(text)) return;
      const mine = v.cur.mine;
      if (mine && mine.list.some((x) => x.res !== 'yes' && Titles.key(x.text) === Titles.key(text))) {
        toast(`„${text}“ hattet ihr schon.`);
        return;
      }
      ui.guess = '';
      setInput('#guess-input', '');
      ui.focus = '#guess-input';
      dispatch('guess', { text, at: v.me.stepKey });
      render();
    } else if (form.dataset.form === 'explain') {
      const text = fieldValue('[data-field="explain"]').replace(/\s+/g, ' ');
      if (text.length < MIN_EXPLAIN) return;
      if (document.activeElement) document.activeElement.blur();
      dispatch('explain', { text, at: v.me.stepKey });
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

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.SE_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  requestAnimationFrame(timerLoop);
  autoResume();

  // für Tests
  window.SEApp = { ui, render: renderNow, actions };
})();
