/*
 * Oberfläche von „Prost!“.
 *  - Kartengerät („device“ bei Ein Gerät, „stage“ bei Mit Handys): zeigt die Karte groß, Tippen/Wischen/Leertaste = weiter
 *  - Handy („phone“): liest die Karte mit und stimmt anonym ab („Wer würde eher“, „Ich hab noch nie“)
 * Gerendert wird per HTML-String + morphdom (nur geänderte Teile werden ersetzt).
 */
(function () {
  'use strict';

  const E = window.PREngine;
  const { Engine, STAGE, LENGTH_OPTIONS, INTENSITIES, MIN_PLAYERS, MAX_PLAYERS, RULE_MIN, RULE_MAX, WATER_SIPS, sanitizeSettings } = E;
  const { StageController, ClientController, Store, KEYS, Net, inviteLink, qrSvg } = window.PRControllers;
  const { Sound, confetti } = window.GameFx;
  const Deck = window.PRDeck;

  const INPUT = {
    pass: {
      icon: '📲',
      label: 'Ein Gerät',
      text: 'Handy, Tablet oder Laptop liegt in der Mitte. Tippen = nächste Karte. Abgestimmt wird per Zeigen – klappt auch offline.',
    },
    phones: {
      icon: '📱',
      label: 'Mit Handys',
      text: 'Wie „Ein Gerät“, aber alle scannen den QR-Code: „Wer würde eher“ und „Ich hab noch nie“ werden anonym abgestimmt.',
    },
  };
  const INTENSITY_LABEL = { leicht: '🌿 Leicht', normal: '🍺 Normal', heftig: '🔥 Heftig' };
  const INTENSITY_TEXT = { leicht: 'Halb so viele Schlucke', normal: 'Schlucke wie auf der Karte', heftig: 'Anderthalb mal so viele Schlucke' };
  const CONFETTI = ['#ffb347', '#ff7a3d', '#ff6fb5', '#4fc3f7', '#fff8e7'];
  const SETUP_KEY = 'prost.setup.v1';
  const PREFS_KEY = 'prost.prefs.v1';
  const ACTIVE_KEY = 'prost.active';
  const RESUME_MAX_AGE = 12 * 60 * 60 * 1000;
  const SWIPE_PX = 60;

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

  function pname(v, id) {
    const p = v.players.find((x) => x.id === id);
    return p ? p.name : '?';
  }

  /** „Anna“, „Anna und Ben“, „Anna, Ben und Cem“ */
  function joinNames(names) {
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' und ' + names[names.length - 1];
  }

  function lengthLabel(n) {
    return n ? String(n) : '∞';
  }

  function defaultSetup() {
    return { settings: sanitizeSettings({}), players: ['', '', '', ''], couples: [] };
  }

  function loadSetup() {
    const saved = Store.get(SETUP_KEY);
    if (!saved || !Array.isArray(saved.players)) return defaultSetup();
    saved.settings = sanitizeSettings(saved.settings);
    while (saved.players.length < MIN_PLAYERS) saved.players.push('');
    saved.couples = Array.isArray(saved.couples) ? saved.couples.filter((c) => Array.isArray(c) && c.length === 2) : [];
    return saved;
  }

  function saveSetup() {
    Store.set(SETUP_KEY, ui.setup);
  }

  function typeInfo(type) {
    return Deck.TYPES[type] || Deck.TYPES.aufgabe;
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
    setup: loadSetup(),
    name: prefs.name || '',
    joinCode: Net.cleanCode(params.get('raum') || ''),
    error: null,
    modal: null,
    confirm: null,
    toast: null,
    flash: null,
    focus: null,
    countdown: null,
    addName: '', // Dialog „Mitspielende“: neuer Name
    coupleA: '',
    coupleB: '',
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

  let flashNo = 0;
  function flash(text, kind) {
    ui.flash = { text, kind: kind || 'info', id: ++flashNo };
    clearTimeout(ui.flashTimer);
    ui.flashTimer = setTimeout(() => {
      ui.flash = null;
      render();
    }, 2600);
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
    stopCountdown();
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
    ui.screen = 'game';
    if (!prev || !v.entry || !prev.entry || prev.entry.n !== v.entry.n) stopCountdown();
    keepAwake(v.phase === 'play');
    transitions(prev, v);
    render();
  }

  function handleStatus(status, info) {
    ui.status = status;
    if (status === 'error') {
      const e = (info || {}).error;
      const msg =
        e === 'not-found'
          ? 'Kein Spiel mit diesem Code gefunden. Stimmt der Code und ist das Kartengerät noch online?'
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
    toast(reason === 'kicked' ? 'Du wurdest aus dem Spiel entfernt.' : 'Das Spiel wurde beendet. Prost! 🍻');
  }

  function vibrate(p) {
    if (navigator.vibrate) navigator.vibrate(p);
  }

  /** Sounds, Konfetti und Einblendungen bei Zustandswechseln */
  function transitions(prev, v) {
    if (!prev) return;
    const phone = !v.me.stage;
    const ev = v.event;
    const pev = prev.event;
    if (ev && (!pev || pev.n !== ev.n)) {
      if (ev.kind === 'joined' && !phone) toast(`📱 ${ev.name} ist dabei!`);
      if (ev.kind === 'left' && !phone) toast(`👋 ${ev.name} ist weg – ${ev.rules} ${plural(ev.rules, 'Regel/Virus', 'Regeln/Viren')} aufgehoben`);
    }
    if (v.phase === 'end' && prev.phase !== 'end') {
      Sound.fanfare();
      setTimeout(() => confetti(CONFETTI, 220), 150);
      return;
    }
    if (v.phase === 'play' && prev.phase === 'lobby') Sound.start();
    const e = v.entry;
    const pe = prev.entry;
    if (!e) return;
    // Neue Karte (nicht beim Zurückblättern)
    if (v.latest && (!pe || e.n > pe.n)) {
      Sound.flip();
      if (e.type === 'regel' || e.type === 'virus') setTimeout(() => Sound.hop(), 250);
      else if (e.type === 'pause') setTimeout(() => Sound.start(), 200);
      else if (e.type === 'ende') setTimeout(() => Sound.success(), 200);
      if (phone) vibrate(v.vote ? [60, 50, 60] : 40);
    }
    // Abstimmung aufgelöst
    if (e.result && pe && pe.n === e.n && !pe.result) {
      Sound.success();
      if (e.result.kind === 'eher' && e.result.top.length) setTimeout(() => confetti(CONFETTI, 80), 200);
      if (phone && e.result.kind === 'eher' && e.result.top.includes(v.me.id)) vibrate([120, 60, 120]);
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
      case 'game':
        html = ui.view ? gameHtml(ui.view) : connectingHtml();
        break;
      default:
        html = homeHtml();
    }
    if (ui.countdown != null) html += countdownHtml();
    if (ui.flash) html += `<div class="flash flash-${ui.flash.kind}" id="flash-${ui.flash.id}" role="status">${esc(ui.flash.text)}</div>`;
    html += modalHtml();
    if (ui.toast) html += `<div class="toast" role="status">${esc(ui.toast)}</div>`;
    window.morphdom(app, `<div id="app">${html}</div>`, {
      onBeforeElUpdated(fromEl) {
        if (fromEl === document.activeElement && (fromEl.tagName === 'INPUT' || fromEl.tagName === 'TEXTAREA' || fromEl.tagName === 'SELECT')) return false;
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
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="Prost!">
      <span class="logo-icon" aria-hidden="true">🍻</span>
      <span class="logo-text"><span class="l1">Pro</span><span class="l2">st!</span></span>
    </div>`;
  }

  function seg(key, options, value, fmt, scope) {
    return `<div class="seg" role="group">${options
      .map(
        (o) =>
          `<button class="seg-btn ${o === value ? 'on' : ''}" data-act="set" data-key="${key}" data-value="${o}" data-scope="${scope}" aria-pressed="${o === value}">${fmt(o)}</button>`
      )
      .join('')}</div>`;
  }

  function switchHtml(key, on, scope, label) {
    return `<button class="switch ${on ? 'on' : ''}" data-act="toggle" data-key="${key}" data-scope="${scope}" role="switch" aria-checked="${on}" aria-label="${esc(label)}"><span class="switch-knob"></span>${on ? 'An' : 'Aus'}</button>`;
  }

  function setting(title, sub, control) {
    return `<div class="setting"><div class="setting-label"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div>${control}</div>`;
  }

  function ageNoteHtml() {
    return `<div class="age-note"><span aria-hidden="true">🔞</span><div>Ab 18. Niemand muss trinken – <b>Wasser zählt auch</b>. Trinkt verantwortungsvoll und fahrt nicht mehr Auto.</div></div>`;
  }

  /** Kartensets zum An- und Abwählen. couplesOk: gibt es Paare? (sonst Hinweis beim Pärchen-Set) */
  function setsHtml(s, scope, couplesOk) {
    const c = Deck.counts();
    const chips = Deck.SETS.map((x) => {
      const on = s.sets.includes(x.id);
      const hint = x.couples && on && !couplesOk ? ' · ⚠️ Paare eintragen' : '';
      return `<button class="set-chip ${on ? 'on' : ''} ${x.adult ? 'is-adult' : ''}" data-act="set-toggle" data-set="${x.id}" data-scope="${scope}" aria-pressed="${on}">
        <span class="set-icon" aria-hidden="true">${x.icon}</span>
        <span><b>${esc(x.label)}</b><small>${esc(x.text)} · ${c[x.id]} Karten${hint}</small></span>
        <span class="set-check" aria-hidden="true">${on ? '✅' : '⬜'}</span>
      </button>`;
    }).join('');
    const total = Deck.SETS.filter((x) => s.sets.includes(x.id) && (!x.couples || couplesOk)).reduce((n, x) => n + c[x.id], 0);
    const few = s.length && total < s.length ? ` – weniger als ${s.length}, das Spiel endet früher` : '';
    return `<div class="setting-label"><b>🃏 Kartensets</b><small>${total} Karten ausgewählt${few}</small></div><div class="set-chips">${chips}</div>`;
  }

  function settingsHtml(s, scope) {
    const rows = [];
    rows.push(
      setting(
        '⏱ Spieldauer',
        s.length ? `${s.length} Karten (plus Regel-Enden und Wasserpausen)` : 'Endlos – bis ihr über das Menü beendet',
        seg('length', LENGTH_OPTIONS, s.length, lengthLabel, scope)
      )
    );
    rows.push(setting('🍺 Intensität', INTENSITY_TEXT[s.intensity], seg('intensity', INTENSITIES, s.intensity, (o) => INTENSITY_LABEL[o], scope)));
    rows.push(
      setting(
        '💧 Wasserpausen',
        s.water ? `Etwa alle 15 Karten: alle trinken ${WATER_SIPS} Schlucke Wasser` : 'Keine Wasserpausen',
        switchHtml('water', s.water, scope, 'Wasserpausen')
      )
    );
    return `<div class="settings">${rows.join('')}</div>`;
  }

  function countdownHtml() {
    const c = ui.countdown;
    return `<div class="countdown" role="status"><b id="cd-${esc(c)}">${c === 0 ? '👉' : c}</b><small>${c === 0 ? 'Zeigt jetzt auf eine Person!' : 'Gleich zeigen alle gleichzeitig auf eine Person …'}</small></div>`;
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
            <small>${INPUT[st.settings.input].label} · ${st.players.length} Personen${st.count ? ' · Karte ' + st.count : ''}</small></button>
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
    const c = Deck.counts();
    return `
    <div class="screen home">
      <a class="btn btn-ghost btn-small hub-back" href="../">← Alle Spiele</a>
      <div class="home-hero">
        ${logoHtml()}
        <p class="tagline">Das Trinkspiel als Kartenstapel – mit euren Namen.<br>Aufgaben, Regeln, Viren, Duelle und „Ich hab noch nie“.</p>
      </div>
      ${resume.join('')}
      <div class="mode-cards">${modeCard('pass')}${modeCard('phones')}</div>
      ${ageNoteHtml()}
      <div class="home-links">
        <button class="btn btn-ghost" data-act="join-screen">📱 Mit dem Handy beitreten</button>
        <button class="btn btn-link" data-act="rules">📖 Spielregeln</button>
      </div>
      <p class="home-foot">${c.total} Karten in ${Deck.SETS.length} Sets · ${MIN_PLAYERS}–${MAX_PLAYERS} Personen · ab 18</p>
    </div>`;
  }

  /* ---------- Spiel anlegen ---------- */

  function filledNames() {
    return ui.setup.players.map((n) => n.trim()).filter(Boolean);
  }

  function couplesSetupHtml() {
    const names = filledNames();
    const options = (sel) =>
      `<option value="">– wählen –</option>` + names.map((n) => `<option value="${esc(n)}" ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('');
    const rows = ui.setup.couples
      .map(
        (c, i) => `
        <div class="couple-row">
          <select class="select" data-field="couple" data-i="${i}" data-side="0" aria-label="Person 1 des Paares">${options(c[0])}</select>
          <span class="heart" aria-hidden="true">💕</span>
          <select class="select" data-field="couple" data-i="${i}" data-side="1" aria-label="Person 2 des Paares">${options(c[1])}</select>
          <button class="icon-btn" data-act="remove-couple-setup" data-i="${i}" aria-label="Paar entfernen">✕</button>
        </div>`
      )
      .join('');
    return `<section class="panel">
        <h2>💕 Paare <small class="muted">(für das Pärchen-Set)</small></h2>
        <div class="couple-list">${rows || '<p class="muted small">Noch keine Paare eingetragen – ohne Paare wird das Pärchen-Set übersprungen.</p>'}</div>
        ${names.length >= 2 ? `<button class="btn btn-small btn-ghost add-player" data-act="add-couple-setup">＋ Paar</button>` : '<p class="muted small">Erst Namen eintragen.</p>'}
      </section>`;
  }

  function setupHtml() {
    const s = ui.setup;
    const st = s.settings;
    const pass = st.input === 'pass';
    const card = (id) => `
      <button class="input-card ${st.input === id ? 'on' : ''}" data-act="set" data-key="input" data-value="${id}" data-scope="setup" aria-pressed="${st.input === id}">
        <span class="input-icon">${INPUT[id].icon}</span>
        <b>${INPUT[id].label}</b>
        <small>${INPUT[id].text}</small>
      </button>`;
    const names = s.players
      .map(
        (p, i) => `
        <div class="player-row">
          <span class="player-num">${i + 1}</span>
          <input class="input" type="text" maxlength="24" placeholder="${pass ? 'Name' : 'Name (ohne Handy)'}" value="${esc(p)}"
            data-field="player-name" data-player="${i}" autocomplete="off" enterkeyhint="next" />
          ${s.players.length > (pass ? MIN_PLAYERS : 1) ? `<button class="icon-btn" data-act="remove-player" data-player="${i}" aria-label="Person entfernen">✕</button>` : ''}
        </div>`
      )
      .join('');
    const couplesOk = s.couples.some((c) => c[0] && c[1] && c[0] !== c[1]);
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
        <div class="input-cards">${card('pass')}${card('phones')}</div>
      </section>
      <section class="panel">
        <h2>Wer spielt mit? <small class="muted">${
          pass ? `(${MIN_PLAYERS}–${MAX_PLAYERS} Personen)` : '(Handys tragen sich gleich selbst ein – hier nur, wer kein Handy hat)'
        }</small></h2>
        <div class="ts-players">${names}</div>
        ${s.players.length < MAX_PLAYERS ? `<button class="btn btn-small btn-ghost add-player" data-act="add-player">＋ Person</button>` : ''}
      </section>
      <section class="panel">${setsHtml(st, 'setup', couplesOk)}</section>
      ${st.sets.includes('paerchen') ? couplesSetupHtml() : ''}
      <section class="panel">
        <h2>Einstellungen</h2>
        ${settingsHtml(st, 'setup')}
      </section>
      ${ageNoteHtml()}
      <div class="sticky-start">
        <button class="btn btn-primary btn-big" data-act="create-game">${pass ? "Los geht's 🍻" : 'Raum öffnen 📱'}</button>
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
        <label class="label" for="code-input">Raum-Code <small class="muted">(steht auf dem Kartengerät)</small></label>
        <input id="code-input" class="input input-code" type="text" maxlength="8" placeholder="ABCDE" value="${esc(ui.joinCode)}" data-field="join-code" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" />
        <button class="btn btn-primary btn-wide btn-big" type="submit">Beitreten</button>
      </form>
      <p class="muted small center">Steht dein Name schon auf dem Kartengerät, gib ihn genauso ein – dann bist du gleich zugeordnet.</p>
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

  /** device = Ein Gerät · stage = Kartengerät mit Handys · phone = Handy */
  function kindOf(v) {
    if (!v.me.stage) return 'phone';
    return v.settings.input === 'pass' ? 'device' : 'stage';
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

  function gameHtml(v) {
    const kind = kindOf(v);
    const ctx = { kind, host: !!v.me.host, v };
    let main;
    if (v.phase === 'lobby') main = lobbyHtml(v, ctx);
    else if (v.phase === 'end') main = endHtml(v, ctx);
    else main = playHtml(v, ctx);
    const e = v.entry;
    const info =
      v.phase === 'play' && e
        ? `<b>${e.count ? `Karte ${e.count}${v.total ? ' / ' + v.total : ''}` : 'Los geht’s'}</b>${!v.latest ? '<small>⏪ zurückgeblättert</small>' : ''}`
        : `<b>${v.phase === 'lobby' ? 'Lobby' : 'Prost!'}</b>`;
    const rules = v.phase === 'play' && v.active.length ? `<button class="pill pill-rules" data-act="active-rules" title="Aktive Regeln">📜 ${v.active.length}</button>` : '';
    const room = v.room && v.room.code && ctx.host ? `<button class="pill pill-room" data-act="show-qr" title="Handys verbinden">📱 ${esc(v.room.code)}</button>` : '';
    return `
      <div class="game kind-${kind} phase-${v.phase}">
        <header class="g-top">
          <button class="g-brand" data-act="menu" aria-label="Menü">${logoHtml(true)}</button>
          <div class="g-info">${info}</div>
          ${rules}
          ${room}
          ${kind === 'phone' && v.me.name ? `<span class="g-me">${esc(v.me.name)}</span>` : ''}
          <div class="g-actions">
            <button class="icon-btn" data-act="mute" aria-label="Ton an/aus" title="Ton an/aus">${Sound.muted ? '🔇' : '🔊'}</button>
            <button class="icon-btn" data-act="menu" aria-label="Menü" title="Menü">☰</button>
          </div>
        </header>
        ${statusBanner()}
        <div class="g-body">
          <main class="g-main">${main}</main>
        </div>
      </div>`;
  }

  function statusBanner() {
    if (ui.ctrl && ui.ctrl.mode === 'client' && (ui.status === 'reconnecting' || ui.status === 'connecting')) {
      return `<div class="status-banner"><span class="spinner-sm"></span> Verbindung zum Kartengerät unterbrochen – verbinde neu…</div>`;
    }
    return '';
  }

  /* ---------- Lobby (Mit Handys) ---------- */

  function playerChipsHtml(v, removable) {
    return v.players
      .map(
        (p) => `<span class="chip ${p.online ? '' : 'is-offline'}">${p.phone ? '<span class="chip-phone" aria-label="mit Handy">📱</span> ' : ''}${esc(p.name)}${
          removable ? `<button class="chip-x" data-act="remove-player-live" data-player="${esc(p.id)}" aria-label="${esc(p.name)} entfernen">✕</button>` : ''
        }</span>`
      )
      .join('');
  }

  function summaryText(s) {
    const sets = Deck.SETS.filter((x) => s.sets.includes(x.id))
      .map((x) => x.icon)
      .join(' ');
    return `${s.length ? s.length + ' Karten' : 'Endlos'} · ${sets} · ${INTENSITY_LABEL[s.intensity]}${s.water ? ' · 💧' : ''}`;
  }

  function lobbyHtml(v, ctx) {
    if (!ctx.host) {
      return `
        <div class="look-up">✅<b>Du bist dabei${v.me.name ? ' als ' + esc(v.me.name) : ''}!</b><small>Gleich geht’s los – schau auf das Kartengerät. Bei Abstimmungen tippst du hier.</small></div>
        <section class="panel wide"><h2>Mitspielende <small class="muted">(${v.players.length})</small></h2><div class="chips">${playerChipsHtml(v, false)}</div></section>
        <p class="muted small center">${esc(summaryText(v.settings))}</p>`;
    }
    const couplesHint =
      v.settings.sets.includes('paerchen') && !v.couples.length ? `<p class="muted small">💕 Pärchen-Set ist an – Paare unter „👥 Bearbeiten“ eintragen.</p>` : '';
    return `
      <div class="lobby-grid">
        <section class="panel join-panel">
          <h2>📱 Handys verbinden</h2>
          <p class="muted">QR-Code scannen und Namen eingeben.</p>
          ${roomBoxHtml(v.room, true)}
        </section>
        <div class="lobby-side">
          <section class="panel">
            <div class="row-between"><h2>Mitspielende <small class="muted">(${v.players.length})</small></h2><button class="btn btn-ghost btn-small" data-act="people">👥 Bearbeiten</button></div>
            <div class="chips">${playerChipsHtml(v, true) || '<span class="muted">Noch niemand da – QR-Code scannen!</span>'}</div>
            ${couplesHint}
          </section>
          <section class="panel">
            <div class="row-between"><h2>Einstellungen</h2><button class="btn btn-ghost btn-small" data-act="settings">⚙️ Ändern</button></div>
            <p class="muted">${esc(summaryText(v.settings))}</p>
          </section>
          <div class="sticky-start">
            <button class="btn btn-primary btn-big" data-act="start" ${v.lobbyProblem ? 'disabled' : ''}>Los geht’s 🍻</button>
            ${v.lobbyProblem ? `<p class="muted small center">${esc(v.lobbyProblem)}</p>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ---------- Karte ---------- */

  function cardHtml(v, ctx) {
    const e = v.entry;
    if (!e) return '';
    const t = typeInfo(e.type);
    const tap = ctx.host;
    let label = t.label;
    let extra = '';
    if (e.kind === 'end') {
      label = e.of === 'virus' ? 'Virus geheilt' : 'Regel aufgehoben';
      extra = `<p class="pcard-old">${esc(e.ruleText)}</p>`;
    } else if (e.kind === 'start') {
      extra = `<p class="pcard-foot">🔞 Ab 18 · ${v.players.length} Personen · ${esc(summaryText(v.settings))}</p>`;
    } else if (e.type === 'regel' || e.type === 'virus') {
      const rule = v.active.find((r) => r.id === e.rule);
      extra = `<p class="pcard-foot">${rule ? (rule.left == null ? 'Gilt bis zum Spielende' : 'Gilt, bis sie aufgehoben wird') : '✅ Schon wieder aufgehoben'}</p>`;
    } else if (e.type === 'pause') {
      extra = `<div class="pcard-big" aria-hidden="true">🥤</div>`;
    }
    const long = e.text.length > 110 ? 'is-long' : '';
    return `
      <div class="pcard t-${esc(e.type)} ${long} ${tap ? 'is-tap' : ''}" style="--tc:${t.color}" ${tap ? 'data-swipe tabindex="0" role="button" aria-label="Nächste Karte"' : ''} id="card-${e.n}">
        ${!v.latest && ctx.host ? '<span class="pcard-back">⏪ ältere Karte</span>' : ''}
        <span class="pcard-type"><span aria-hidden="true">${e.kind === 'end' ? '✅' : t.icon}</span>${esc(label)}</span>
        ${e.kind === 'start' ? `<div class="pcard-big" aria-hidden="true">🍻</div>` : ''}
        <p class="pcard-text">${esc(e.text)}</p>
        ${e.note ? `<p class="pcard-note">${esc(e.note)}</p>` : ''}
        ${extra}
        ${tap ? `<span class="pcard-tap">${e.kind === 'start' ? 'Tippen zum Starten' : 'Tippen oder wischen für weiter'}</span>` : ''}
      </div>`;
  }

  function sipsFor(v, kind) {
    return Deck.sips(Deck.VOTE_SIPS[kind], v.settings.intensity);
  }

  /** Ergebnis einer Handy-Abstimmung */
  function resultHtml(v, e) {
    const r = e.result;
    const t = typeInfo(e.type);
    if (r.kind === 'nie') {
      const line = !r.total
        ? 'Niemand hat abgestimmt.'
        : r.yes
          ? r.yes === 1
            ? 'Trinkt jetzt auch wirklich jemand? 😏'
            : `Trinken jetzt auch wirklich alle ${r.yes}? 😏`
          : 'Lauter Unschuldslämmer! 😇';
      return `<div class="vote-box" style="--tc:${t.color}">
        <p class="big-count"><b>${r.yes} von ${r.total}</b>${plural(r.yes, 'hat', 'haben')} das schon mal gemacht</p>
        <p class="vote-status">${line}</p>
      </div>`;
    }
    const rows = Object.entries(r.tally).sort((a, b) => b[1] - a[1]);
    const max = rows.length ? rows[0][1] : 1;
    const bars = rows
      .map(
        ([id, n]) => `<div class="bar-row ${r.top.includes(id) ? 'is-top' : ''}">
          <span class="bar-name">${esc(pname(v, id))}</span>
          <span class="bar"><span style="width:${(100 * n) / max}%"></span></span>
          <b>${n}</b>
        </div>`
      )
      .join('');
    const top = r.top.map((id) => pname(v, id));
    const verdict = !top.length
      ? 'Niemand hat abgestimmt.'
      : top.length === 1
        ? `🍺 ${top[0]} trinkt ${sipsFor(v, 'eher')}!`
        : `🍺 Gleichstand: ${joinNames(top)} trinken je ${sipsFor(v, 'eher')}!`;
    return `<div class="vote-box" style="--tc:${t.color}">
      <div class="bars">${bars}</div>
      <p class="vote-verdict">${esc(verdict)}</p>
    </div>`;
  }

  /** Abstimmungsbereich unter „Wer würde eher“ / „Ich hab noch nie“ */
  function voteAreaHtml(v, ctx) {
    const e = v.entry;
    if (!e || e.kind !== 'card' || !Deck.VOTE_SIPS[e.type]) return '';
    if (e.result) return resultHtml(v, e);
    const vote = v.vote;
    if (vote) {
      if (ctx.kind === 'phone') {
        if (!v.me.id) return `<div class="vote-box"><p class="vote-status">👀 Du schaust zu – die Runde ist voll.</p></div>`;
        const done = vote.mine != null;
        const head = `<h3>${done ? '✓ Abgestimmt' : vote.kind === 'eher' ? 'Wer würde eher? Tippe auf eine Person' : 'Und du?'}</h3>`;
        const sub = `<p class="vote-status"><small>${done ? 'Du kannst noch ändern, bis aufgelöst wird · ' : ''}geheim – niemand sieht, was du tippst · ${vote.count}/${vote.total}</small></p>`;
        if (vote.kind === 'nie') {
          return `<div class="vote-box">${head}
            <div class="vote-yesno">
              <button class="vote-btn ${vote.mine === 'yes' ? 'on' : ''}" data-act="vote" data-value="yes"><span aria-hidden="true">🙋</span>Hab ich schon</button>
              <button class="vote-btn ${vote.mine === 'no' ? 'on' : ''}" data-act="vote" data-value="no"><span aria-hidden="true">🙅</span>Noch nie</button>
            </div>${sub}</div>`;
        }
        const opts = v.players
          .map((p) => `<button class="vote-btn ${vote.mine === p.id ? 'on' : ''}" data-act="vote" data-value="${esc(p.id)}">${esc(p.name)}${p.id === v.me.id ? ' 🙈' : ''}</button>`)
          .join('');
        return `<div class="vote-box">${head}<div class="vote-options">${opts}</div>${sub}</div>`;
      }
      return `<div class="vote-box">
        <p class="vote-status">📱 ${vote.count} von ${vote.total} haben abgestimmt<small>Geheim auf den Handys – aufgelöst wird, sobald alle getippt haben</small></p>
        ${ctx.host ? `<button class="btn btn-ghost" data-act="close-vote" ${vote.count ? '' : 'disabled'}>Jetzt auflösen</button>` : ''}
      </div>`;
    }
    // Ohne Handys: gleichzeitig zeigen
    if (e.type === 'eher' && ctx.host && v.latest) {
      return `<button class="btn btn-ghost btn-wide" data-act="countdown">👉 3 – 2 – 1 … zeigen!</button>`;
    }
    return '';
  }

  function playHtml(v, ctx) {
    const nav = ctx.host
      ? `<div class="nav-bar">
          <button class="btn btn-ghost btn-big" data-act="back" ${v.canBack ? '' : 'disabled'} aria-label="Zurück">◀ Zurück</button>
          <button class="btn btn-primary btn-big" data-act="next">${v.vote && v.vote.count && v.latest ? 'Auflösen 🗳️' : 'Weiter ▶'}</button>
        </div>`
      : '';
    const progress =
      ctx.host && v.total ? `<div class="progress" aria-hidden="true"><span style="width:${Math.min(100, (100 * (v.entry ? v.entry.count : 0)) / v.total)}%"></span></div>` : '';
    const spectator = ctx.kind === 'phone' && !v.me.id ? '<div class="banner">👀 Die Runde ist voll – du liest mit.</div>' : '';
    return `${progress}${spectator}${cardHtml(v, ctx)}${voteAreaHtml(v, ctx)}${nav}`;
  }

  /* ---------- Ende ---------- */

  function endHtml(v, ctx) {
    const ended = v.ended.length
      ? `<section class="panel wide"><h2>📜 Diese Regeln sind jetzt aufgehoben</h2>
          <ul class="rule-list">${v.ended
            .map((r) => `<li class="rule-item" style="--tc:${typeInfo(r.type).color}"><span aria-hidden="true">${typeInfo(r.type).icon}</span><div>${esc(r.endText || r.text)}</div></li>`)
            .join('')}</ul></section>`
      : '';
    const stats = (v.stats || []).slice(0, 5);
    // Gleich oft dran = gleiche Medaille
    const levels = [...new Set(stats.map((p) => p.picked))];
    const statsHtml = stats.length
      ? `<section class="panel wide"><h2>🎯 Am häufigsten dran</h2><div class="stats">${stats
          .map(
            (p) =>
              `<div class="stat-row"><span>${['🥇', '🥈', '🥉'][levels.indexOf(p.picked)] || '·'} ${esc(p.name)}</span><small>${p.picked} ${plural(p.picked, 'Karte', 'Karten')}</small></div>`
          )
          .join('')}</div></section>`
      : '';
    const buttons = ctx.host
      ? `<div class="host-bar">
          <button class="btn btn-primary btn-big" data-act="again">🔁 Nochmal</button>
          <button class="btn btn-ghost" data-act="close-game">🏠 Hauptmenü</button>
        </div>`
      : `<p class="muted center">Danke fürs Mitspielen!</p>`;
    return `
      <div class="end-hero">
        <div class="pcard-big" aria-hidden="true">🍻</div>
        <h1>Prost – das war’s!</h1>
        <p class="muted">${v.count} Karten gespielt. Trinkt noch ein Glas Wasser 💧</p>
      </div>
      ${ended}
      ${statsHtml}
      ${buttons}`;
  }

  /* ------------------------------------------------------------------ */
  /* Dialoge                                                             */
  /* ------------------------------------------------------------------ */

  function activeRulesHtml(v) {
    if (!v.active.length) return `<h2>📜 Aktive Regeln</h2><p class="muted">Gerade gilt keine Regel und kein Virus.</p>`;
    const items = v.active
      .map((r) => {
        const t = typeInfo(r.type);
        const left = r.left == null ? 'gilt bis zum Spielende' : r.left <= 1 ? 'wird gleich aufgehoben' : `noch ca. ${r.left} Karten`;
        return `<li class="rule-item" style="--tc:${t.color}"><span aria-hidden="true">${t.icon}</span>
          <div>${esc(r.text)}<small>${left}</small></div>
          ${v.me.host ? `<button class="btn btn-ghost btn-small" data-act="end-rule" data-id="${esc(r.id)}">Aufheben</button>` : ''}
        </li>`;
      })
      .join('');
    return `<h2>📜 Aktive Regeln</h2><ul class="rule-list">${items}</ul>`;
  }

  function peopleHtml(v) {
    const playing = v.phase === 'play';
    const canRemove = !playing || v.players.length > MIN_PLAYERS;
    const inCouple = new Set(v.couples.flat());
    const free = v.players.filter((p) => !inCouple.has(p.id));
    const opt = (sel) => `<option value="">– wählen –</option>` + free.map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    const couples = v.couples
      .map(
        (c, i) => `<span class="chip">${esc(pname(v, c[0]))} 💕 ${esc(pname(v, c[1]))}<button class="chip-x" data-act="remove-couple" data-i="${i}" aria-label="Paar auflösen">✕</button></span>`
      )
      .join('');
    return `<h2>👥 Mitspielende</h2>
      <p class="muted small">${playing ? 'Wer neu dazukommt, wird ab der nächsten Karte eingesetzt. Wer geht: Regeln und Viren mit dieser Person enden.' : ''}${
        v.settings.input === 'phones' ? ' Handys tragen sich selbst ein (📱).' : ''
      }</p>
      <div class="chips">${playerChipsHtml(v, canRemove)}</div>
      ${
        v.players.length < MAX_PLAYERS
          ? `<form class="add-row" data-form="add-player">
              <input class="input" type="text" maxlength="24" placeholder="Name" value="${esc(ui.addName)}" data-field="add-name" autocomplete="off" enterkeyhint="done" />
              <button class="btn btn-primary" type="submit">＋</button>
            </form>`
          : ''
      }
      <h3 style="margin-top:18px">💕 Paare</h3>
      <div class="chips">${couples || '<span class="muted small">Keine Paare eingetragen.</span>'}</div>
      ${
        free.length >= 2
          ? `<form class="couple-row add-row" data-form="add-couple">
              <select class="select" data-field="couple-a" aria-label="Person 1">${opt(ui.coupleA)}</select>
              <span class="heart" aria-hidden="true">💕</span>
              <select class="select" data-field="couple-b" aria-label="Person 2">${opt(ui.coupleB)}</select>
              <button class="btn btn-ghost" type="submit">＋</button>
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
        <p class="muted small center">Wer jetzt beitritt, ist ab der nächsten Karte dabei.</p>
        <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig</button></div>`;
    } else if (ui.modal === 'settings' && v) {
      body = `<h2>⚙️ Einstellungen</h2>
        <div class="cats-block">${setsHtml(v.settings, 'live', v.couples.length > 0)}</div>
        <div style="margin-top:18px">${settingsHtml(v.settings, 'live')}</div>
        <p class="muted small">Gilt ab der nächsten Karte. Andere Sets oder Spieldauer mischen den Rest des Stapels neu.</p>
        <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig</button></div>`;
    } else if (ui.modal === 'active-rules' && v) {
      body = `${activeRulesHtml(v)}<div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig</button></div>`;
    } else if (ui.modal === 'people' && v) {
      body = peopleHtml(v);
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
    const T = Deck.TYPES;
    const row = (type, text) => `<li><b>${T[type].icon} ${esc(T[type].label)}:</b> ${text}</li>`;
    return `
      <h2>📖 Spielregeln</h2>
      <div class="rules">
        <p>Ein Gerät liegt in der Mitte. Eine Karte nach der anderen wird aufgedeckt – mit euren Namen darauf.
          <b>Tippen, Wischen oder Leertaste</b> = nächste Karte, <b>◀ Zurück</b> falls jemand zu schnell war.
          Gespielt wird mit ${MIN_PLAYERS}–${MAX_PLAYERS} Personen.</p>
        <h3>Kartentypen</h3>
        <ul>
          ${row('aufgabe', 'macht, was draufsteht – „verteilen“ heißt: an andere Personen eurer Wahl.')}
          ${row('alle', 'alle, auf die es zutrifft, trinken.')}
          ${row('nie', 'wer es schon mal gemacht hat, trinkt.')}
          ${row('eher', 'auf „3“ zeigen alle gleichzeitig auf eine Person – die mit den meisten Fingern trinkt.')}
          ${row('duell', 'zwei Personen treten gegeneinander an.')}
          ${row('kategorie', 'reihum Begriffe nennen, wer nichts mehr weiß oder wiederholt, trinkt.')}
          ${row('wahrheit', 'ehrlich antworten – oder trinken.')}
          ${row('regel', `gilt für alle, bis sie ${RULE_MIN}–${RULE_MAX} Karten später aufgehoben wird.`)}
          ${row('virus', 'wie eine Regel, aber nur für bestimmte Personen.')}
          ${row('pause', `alle trinken ${WATER_SIPS} Schlucke Wasser (abschaltbar).`)}
        </ul>
        <p>Aktive Regeln und Viren stehen oben unter <b>📜</b>. Bei Spielende werden alle aufgehoben.</p>
        <h3>📱 Mit Handys</h3>
        <p>Alle scannen den QR-Code. Bei „Wer würde eher“ und „Ich hab noch nie“ wird <b>geheim</b> auf dem Handy getippt –
          das Kartengerät zeigt nur, wer wie viele Stimmen hat bzw. wie viele es schon mal gemacht haben.
          Wer kein Handy hat, wird am Kartengerät eingetragen und spielt ganz normal mit.</p>
        <h3>Einstellungen</h3>
        <ul>
          <li><b>Kartensets:</b> 🌱 Warm-up (kommt zuerst), 🎉 Party, 🔥 Heftig, 💕 Pärchen (Paare eintragen), 🔞 18+</li>
          <li><b>Intensität:</b> leicht = halb so viele Schlucke, heftig = anderthalb mal so viele</li>
          <li><b>Spieldauer:</b> 30, 50, 80 Karten oder endlos</li>
        </ul>
        <p class="muted small">Ab 18. Niemand muss trinken – Wasser zählt auch. 💧 Karten, die ihr schon gespielt habt, merkt sich der Browser:
          Beim nächsten Abend kommen erst die neuen.</p>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Alles klar!</button></div>`;
  }

  function menuHtml() {
    const v = ui.view;
    const items = [];
    items.push(`<button class="menu-item" data-act="rules">📖 Spielregeln</button>`);
    items.push(`<button class="menu-item" data-act="mute">${Sound.muted ? '🔊 Ton einschalten' : '🔇 Ton ausschalten'}</button>`);
    if (v && v.me.host) {
      const playing = v.phase === 'play';
      if (playing) items.push(`<button class="menu-item" data-act="active-rules">📜 Aktive Regeln <small>(${v.active.length})</small></button>`);
      if (v.phase !== 'end') items.push(`<button class="menu-item" data-act="people">👥 Mitspielende & Paare</button>`);
      if (v.phase !== 'end') items.push(`<button class="menu-item" data-act="settings">⚙️ Einstellungen</button>`);
      if (v.room) items.push(`<button class="menu-item" data-act="show-qr">📱 Handys verbinden</button>`);
      items.push(`<button class="menu-item" data-act="home-keep">🏠 Hauptmenü <small>(Spiel bleibt gespeichert)</small></button>`);
      if (playing) items.push(`<button class="menu-item danger" data-act="finish-ask">🏁 Spiel beenden</button>`);
      items.push(`<button class="menu-item danger" data-act="close-game">🚪 Spiel schließen</button>`);
    } else if (v) {
      if (v.phase === 'play') items.push(`<button class="menu-item" data-act="active-rules">📜 Aktive Regeln <small>(${v.active.length})</small></button>`);
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

  function currentSettings(scope) {
    return scope === 'setup' ? ui.setup.settings : ui.view ? ui.view.settings : null;
  }

  function next() {
    const v = ui.view;
    if (!v || !v.me.host || v.phase !== 'play' || ui.modal || ui.countdown != null) return;
    dispatch('next', { at: v.step });
  }

  function back() {
    const v = ui.view;
    if (!v || !v.me.host || v.phase !== 'play' || !v.canBack || ui.modal) return;
    dispatch('back', { at: v.step });
  }

  function createGame() {
    const s = ui.setup;
    ui.error = null;
    const pass = s.settings.input === 'pass';
    const names = filledNames();
    if (pass && names.length < MIN_PLAYERS) {
      ui.error = `Bitte mindestens ${MIN_PLAYERS} Namen eintragen.`;
      render();
      return;
    }
    const couples = s.couples.filter((c) => c[0] && c[1] && c[0] !== c[1] && names.includes(c[0]) && names.includes(c[1]));
    const state = Engine.create({ settings: s.settings, players: names, couples });
    Sound.unlock();
    startStage({ state });
  }

  function stopCountdown() {
    clearInterval(ui.countdownTimer);
    clearTimeout(ui.countdownHide);
    ui.countdown = null;
  }

  function runCountdown() {
    stopCountdown();
    ui.countdown = 3;
    Sound.tick(false);
    render();
    ui.countdownTimer = setInterval(() => {
      ui.countdown -= 1;
      if (ui.countdown > 0) Sound.tick(ui.countdown === 1);
      else {
        clearInterval(ui.countdownTimer);
        Sound.start();
        ui.countdownHide = setTimeout(() => {
          ui.countdown = null;
          render();
        }, 1600);
      }
      render();
    }, 900);
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
    mute: () => {
      Sound.setMuted(!Sound.muted);
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
      const c = ui.confirm;
      ui.modal = null;
      ui.confirm = null;
      if (c && c.run) c.run();
      render();
    },
    set: (el) => setSetting(el.dataset.scope, el.dataset.key, el.dataset.key === 'length' ? +el.dataset.value : el.dataset.value),
    toggle: (el) => {
      const s = currentSettings(el.dataset.scope);
      if (s) setSetting(el.dataset.scope, el.dataset.key, !s[el.dataset.key]);
    },
    'set-toggle': (el) => {
      const s = currentSettings(el.dataset.scope);
      if (!s) return;
      const id = el.dataset.set;
      const sets = s.sets.includes(id) ? s.sets.filter((x) => x !== id) : s.sets.concat(id);
      if (!sets.length) {
        toast('Mindestens ein Set muss an sein.');
        return;
      }
      setSetting(el.dataset.scope, 'sets', sets);
    },
    'add-player': () => {
      if (ui.setup.players.length >= MAX_PLAYERS) return;
      ui.setup.players.push('');
      saveSetup();
      ui.focus = `[data-field="player-name"][data-player="${ui.setup.players.length - 1}"]`;
      render();
    },
    'remove-player': (el) => {
      const name = (ui.setup.players[+el.dataset.player] || '').trim();
      ui.setup.players.splice(+el.dataset.player, 1);
      if (name) ui.setup.couples = ui.setup.couples.filter((c) => !c.includes(name));
      saveSetup();
      render();
    },
    'add-couple-setup': () => {
      ui.setup.couples.push(['', '']);
      saveSetup();
      render();
    },
    'remove-couple-setup': (el) => {
      ui.setup.couples.splice(+el.dataset.i, 1);
      saveSetup();
      render();
    },
    'create-game': createGame,
    'leave-now': () => goHome(false),
    start: () => dispatch('start'),
    next,
    back,
    countdown: runCountdown,
    'close-vote': () => dispatch('closeVote'),
    vote: (el) => {
      const v = ui.view;
      if (!v || !v.vote) return;
      vibrate(30);
      dispatch('vote', { value: el.dataset.value, no: v.vote.no });
    },
    'active-rules': () => {
      ui.modal = 'active-rules';
      render();
    },
    'end-rule': (el) => dispatch('endRule', { id: el.dataset.id }),
    people: () => {
      ui.modal = 'people';
      ui.addName = '';
      ui.coupleA = '';
      ui.coupleB = '';
      render();
    },
    'remove-player-live': (el) => {
      const v = ui.view;
      const name = v ? pname(v, el.dataset.player) : '';
      askConfirm({
        title: `${name} entfernen?`,
        text: v && v.phase === 'play' ? 'Regeln und Viren mit dieser Person enden, ein Paar wird aufgelöst.' : 'Die Person wird aus der Runde genommen.',
        yes: 'Entfernen',
        danger: true,
        run: () => {
          dispatch('removePlayer', { player: el.dataset.player });
          ui.modal = 'people';
        },
      });
    },
    'remove-couple': (el) => dispatch('removeCouple', { index: +el.dataset.i }),
    settings: () => {
      ui.modal = 'settings';
      render();
    },
    'show-qr': () => {
      ui.modal = 'qr';
      render();
    },
    'finish-ask': () =>
      askConfirm({
        title: 'Spiel beenden?',
        text: 'Alle Regeln und Viren werden aufgehoben.',
        yes: 'Beenden',
        run: () => dispatch('finish'),
      }),
    again: () => dispatch('again'),
    'close-game': () =>
      askConfirm({
        title: 'Spiel schließen?',
        text: ui.view && ui.view.room ? 'Der Raum wird geschlossen, die Handys werden getrennt.' : 'Das Spiel wird beendet.',
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

  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled || !app.contains(el)) return;
    const fn = actions[el.dataset.act];
    if (!fn) return;
    Sound.unlock();
    if (el.dataset.act !== 'close-modal-bg' && el.dataset.act !== 'next') Sound.click();
    // Menüpunkte schließen das Menü, bevor sie etwas tun
    if (ui.modal === 'menu' && el.closest('.modal') && !['close-modal', 'mute'].includes(el.dataset.act)) ui.modal = null;
    fn(el, e);
  });

  /* Karte: Tippen = weiter, nach links wischen = weiter, nach rechts = zurück */
  let swipe = null;
  app.addEventListener('pointerdown', (e) => {
    const el = e.target.closest && e.target.closest('[data-swipe]');
    if (!el || (e.pointerType === 'mouse' && e.button !== 0)) return;
    swipe = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  app.addEventListener('pointerup', (e) => {
    if (!swipe || swipe.id !== e.pointerId) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    swipe = null;
    const el = e.target.closest && e.target.closest('[data-swipe]');
    Sound.unlock();
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) next();
      else back();
    } else if (el && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      next();
    }
  });
  app.addEventListener('pointercancel', () => (swipe = null));

  app.addEventListener('input', (e) => {
    const el = e.target;
    const f = el.dataset && el.dataset.field;
    if (!f) return;
    if (f === 'player-name') {
      const i = +el.dataset.player;
      const old = (ui.setup.players[i] || '').trim();
      ui.setup.players[i] = el.value;
      // Umbenennen: Paare ziehen mit
      const now = el.value.trim();
      for (const c of ui.setup.couples) for (const k of [0, 1]) if (old && c[k] === old) c[k] = now;
      saveSetup();
    } else if (f === 'name') {
      ui.name = el.value;
    } else if (f === 'join-code') {
      ui.joinCode = Net.cleanCode(el.value);
    } else if (f === 'add-name') {
      ui.addName = el.value;
    }
  });

  app.addEventListener('change', (e) => {
    const el = e.target;
    const f = el.dataset && el.dataset.field;
    if (f === 'couple') {
      const c = ui.setup.couples[+el.dataset.i];
      if (!c) return;
      c[+el.dataset.side] = el.value;
      saveSetup();
      el.blur();
      render();
    } else if (f === 'couple-a') ui.coupleA = el.value;
    else if (f === 'couple-b') ui.coupleB = el.value;
    else if (f === 'player-name') render(); // Namen in den Paar-Auswahlen aktualisieren
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
    } else if (form.dataset.form === 'add-player') {
      const name = ui.addName.trim();
      if (!name) return;
      dispatch('addPlayer', { name });
      ui.addName = '';
      const input = form.querySelector('input');
      if (input) input.value = '';
      ui.focus = '[data-field="add-name"]';
      render();
    } else if (form.dataset.form === 'add-couple') {
      if (!ui.coupleA || !ui.coupleB || ui.coupleA === ui.coupleB) {
        toast('Bitte zwei verschiedene Personen wählen.');
        return;
      }
      dispatch('addCouple', { a: ui.coupleA, b: ui.coupleB });
      ui.coupleA = '';
      ui.coupleB = '';
      render();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.modal) {
      ui.modal = null;
      ui.confirm = null;
      render();
      return;
    }
    // Tastatur am Laptop: Leertaste/Enter/→ = weiter, ← = zurück
    const t = e.target;
    if (ui.screen !== 'game' || ui.modal || e.altKey || e.ctrlKey || e.metaKey) return;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (t && t.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
    if ([' ', 'Enter', 'ArrowRight', 'PageDown'].includes(e.key)) {
      e.preventDefault();
      next();
    } else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) {
      e.preventDefault();
      back();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ui.view && ui.view.phase === 'play') keepAwake(true);
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

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.PR_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  autoResume();

  // für Tests
  window.PRApp = { ui, render: renderNow, actions };
})();
