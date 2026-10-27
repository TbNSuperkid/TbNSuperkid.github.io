/*
 * Oberfläche von „Nur einer“.
 *  - Laptop („Bühne“): Spiel anlegen, Lobby mit QR-Code, wer rät, Kontrolle der Hinweise, Raten, Auflösung, Wertung
 *  - Handy (Hinweis-Tafel): Wort sehen, Hinweis schreiben, Einspruch, als ratende Person wegschauen und raten
 * Gerendert wird per HTML-String + morphdom (nur geänderte Teile werden ersetzt).
 */
(function () {
  'use strict';

  const E = window.NEEngine;
  const { TEAMS, PLAYER_COLORS, CARD_OPTIONS, TIMER_OPTIONS, MIN_PLAYERS, MAX_PLAYERS, MAX_FAILS, MAX_GUESS, MAX_WORD, SPLIT_FROM, Engine, sanitizeSettings, rating, stackSize } = E;
  const { StageController, ClientController, Store, KEYS, Net, inviteLink, qrSvg } = window.NEControllers;
  const { Sound, confetti, synth } = window.GameFx;
  const Words = window.NEWords;
  const Clues = window.NEClues;

  const INPUT = {
    phones: { icon: '📱', label: 'Mit Handys', text: 'Das Wort steht auf allen Handys außer dem der ratenden Person. Hinweise werden getippt, Doppelte streicht die App – die Runde kontrolliert.' },
    one: { icon: '🖥️', label: 'Ein Gerät', text: 'Notfall ohne Handys: Der Laptop zeigt das Wort, während die ratende Person wegschaut. Hinweise auf Zettel, Doppelte von Hand weg.' },
  };
  const LEVEL = { easy: 'Leicht', mixed: 'Gemischt', hard: 'Schwer' };
  const LEVEL_TEXT = {
    easy: 'Nur konkrete Dinge, die jede/r kennt (Pizza, Zebra)',
    mixed: 'Dinge und etwas speziellere Begriffe (Leuchtturm, Flohmarkt)',
    hard: 'Speziell und abstrakt (Eifersucht, Bürokratie)',
  };
  const RESULT = {
    won: { icon: '✅', label: 'Richtig!', color: '#22c55e' },
    lost: { icon: '❌', label: 'Falsch!', color: '#ef4444' },
    pass: { icon: '⏭️', label: 'Gepasst', color: '#94a3b8' },
  };
  const SETUP_KEY = 'nureiner.setup.v1';
  const PREFS_KEY = 'nureiner.prefs.v1';
  const BEST_KEY = 'nureiner.best.v1';
  const ACTIVE_KEY = 'nureiner.active';
  const RESUME_MAX_AGE = 12 * 60 * 60 * 1000;
  const BEST_MAX = 50;

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

  function player(v, pid) {
    return v.players.find((p) => p.id === pid) || null;
  }

  function nameOf(v, pid) {
    const p = player(v, pid);
    if (p) return p.name;
    const m = v.members.find((x) => x.id === pid);
    return m ? m.name : '?';
  }

  function colorOf(v, pid) {
    const p = player(v, pid);
    return p ? p.color : '#e5e7eb';
  }

  function teamOf(v, id) {
    return v.teams.find((t) => t.id === id) || null;
  }

  function curKey(v) {
    return v && v.cur ? v.cur.key : null;
  }

  /** Stapel der laufenden Karte */
  function stackOf(v) {
    return v.cur ? v.stacks[v.cur.stack] : v.stacks[v.turn] || v.stacks[0];
  }

  function defaultSetup() {
    return { settings: sanitizeSettings({}), players: ['', '', '', ''] };
  }

  function loadSetup() {
    const saved = Store.get(SETUP_KEY);
    if (!saved || !Array.isArray(saved.players)) return defaultSetup();
    saved.settings = sanitizeSettings(saved.settings);
    return saved;
  }

  function saveSetup() {
    Store.set(SETUP_KEY, ui.setup);
  }

  function loadBest() {
    const b = Store.get(BEST_KEY);
    return Array.isArray(b) ? b : [];
  }

  /** Ergebnis in die Bestenliste dieses Geräts (einmal pro Spiel) */
  function saveBest(v) {
    if (v.settings.versus || !v.stacks.length || !v.startedAt) return;
    const st = v.stacks[0];
    // Nur fertig gespielte Partien (abgebrochene verzerren die Liste)
    if (!st.played || !(st.size ? st.deck <= 0 : st.fails >= MAX_FAILS)) return;
    const list = loadBest();
    if (list.some((x) => x.id === v.startedAt)) return;
    list.push({
      id: v.startedAt,
      date: new Date(v.endedAt || Date.now()).toISOString().slice(0, 10),
      people: v.players.length,
      cards: st.size,
      won: st.won,
      played: st.played,
      input: v.settings.input,
    });
    list.sort((a, b) => b.won - a.won || a.id - b.id);
    Store.set(BEST_KEY, list.slice(0, BEST_MAX));
  }

  function bestFor(cards) {
    return loadBest().filter((x) => x.cards === cards);
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
    clues: ['', ''], // Hinweise auf dem Handy
    guess: '', // Antwort der ratenden Person
    custom: '', // eigenes Wort
    peek: null, // ein Gerät: Wort aufgedeckt (Kennung der Karte)
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
    /** Doppelt! – ein komisches „Boing-boing“ */
    dupe() {
      synth.tone(300, 0, 0.14, { type: 'square', to: 180, vol: 0.06 });
      synth.tone(300, 0.16, 0.14, { type: 'square', to: 180, vol: 0.06 });
    },
    /** Hinweis abgegeben (auf der Bühne) */
    pop() {
      synth.tone(880, 0, 0.07, { type: 'sine', to: 1320, vol: 0.07 });
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
      ui.clues = ['', ''];
      ui.guess = '';
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

  /** Sounds, Konfetti und Einblendungen bei Zustandswechseln */
  function transitions(prev, v) {
    const stage = !!v.me.stage;
    if (v.phase === 'over' && stage) saveBest(v);
    if (!prev) return;
    const c = v.cur;
    const pc = prev.cur;
    if (v.phase === 'over' && prev.phase !== 'over') {
      ui.flash = null;
      Sound.fanfare();
      setTimeout(() => confetti(['#fde047', '#f59e0b', '#38bdf8', '#ffffff'], 220), 150);
      return;
    }
    if (!c) return;
    if (!pc || pc.no !== c.no) {
      Sound.start();
      if (!stage && c.guesser === v.me.id) vibrate([80, 60, 80]);
      return;
    }
    if (c.wNo !== pc.wNo) {
      Sound.flip();
      if (stage && c.skippedBy) flash(`🔀 Neues Wort – ${c.skippedBy} kannte es nicht`, '#38bdf8');
      else if (stage && c.custom) flash('✍️ Eigenes Wort!', '#fde047');
      return;
    }
    if (stage && v.phase === 'write' && c.submitted.length > pc.submitted.length) Fx.pop();
    if (v.phase === 'check' && prev.phase !== 'check') {
      Sound.flip();
      if (!stage && c.guesser === v.me.id) vibrate([120, 80, 120]);
    }
    // Kontrolle: Hinweise erscheinen auf der Bühne – bei Doppelten ein „Boing“
    if (stage && v.phase === 'check' && c.away && !pc.away) {
      const dupes = (c.clues || []).filter((x) => x.out && x.reason === 'dupe').length;
      if (dupes) setTimeout(() => Fx.dupe(), 300);
      else Sound.flip();
    }
    if (v.phase === 'guess' && prev.phase !== 'guess') Sound.hop();
    if (v.phase === 'reveal' && prev.phase !== 'reveal') revealEffects(v, stage);
    else if (v.phase === 'reveal' && c.result !== pc.result) revealEffects(v, stage);
  }

  function revealEffects(v, stage) {
    const c = v.cur;
    if (c.result === 'won') {
      Sound.success();
      if (stage) setTimeout(() => confetti(['#22c55e', '#fde047', '#ffffff'], 150), 250);
      else vibrate([60, 60, 60]);
    } else if (c.result === 'lost') {
      Sound.fail();
      if (!stage) vibrate(150);
    } else Sound.flip();
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
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="Nur einer">
      <span class="logo-icon" aria-hidden="true">☝️</span>
      <span class="logo-text"><span class="l1">Nur</span> <span class="l2">einer</span></span>
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

  function cardsLabel(n) {
    return n ? String(n) : '∞';
  }

  function settingsHtml(s, scope) {
    const phones = s.input === 'phones';
    const rows = [];
    rows.push(`
      <div class="setting">
        <div class="setting-label"><b>🃏 Karten</b><small>${
          s.cards ? (s.versus ? `Jedes Team hat einen eigenen Stapel mit ${stackSize(s)} Karten` : `${s.cards} Karten – am Ende zählen die gewonnenen`) : `Endlos, bis ihr ${MAX_FAILS}× falsch geraten habt`
        }</small></div>
        ${seg('cards', CARD_OPTIONS, s.cards, cardsLabel, scope)}
      </div>`);
    if (phones) {
      rows.push(`
        <div class="setting">
          <div class="setting-label"><b>💬 Raten</b><small>${
            s.guess === 'type' ? 'Die ratende Person tippt die Antwort – die App prüft selbst („zählt doch“ möglich)' : 'Laut sagen, die Spielleitung klickt richtig oder falsch – schneller und lustiger'
          }</small></div>
          ${seg('guess', ['voice', 'type'], s.guess, (o) => (o === 'type' ? '⌨️ Tippen' : '🗣️ Laut'), scope)}
        </div>
        <div class="setting">
          <div class="setting-label"><b>⏱ Zeit zum Schreiben</b><small>Danach wird mit den Hinweisen verglichen, die da sind</small></div>
          ${seg('timer', TIMER_OPTIONS, s.timer, (o) => (o ? o + ' s' : 'Aus'), scope)}
        </div>`);
    }
    rows.push(`
      <div class="setting">
        <div class="setting-label"><b>Schwierigkeit</b><small>${esc(LEVEL_TEXT[s.level])}</small></div>
        ${seg('level', Words.LEVEL_IDS, s.level, (o) => LEVEL[o], scope)}
      </div>
      <div class="setting">
        <div class="setting-label"><b>👥 Große Runde</b><small>Ab 8 Personen schreiben abwechselnd nur die Hälfte (sonst ist fast alles doppelt). Bei 3 Personen schreibt jede/r automatisch 2 Hinweise.</small></div>
        ${switchHtml(s.split, 'split', scope)}
      </div>
      <div class="setting">
        <div class="setting-label"><b>🏁 Wettkampf</b><small>2 Teams wechseln sich ab – wer mehr Karten holt, gewinnt</small></div>
        ${switchHtml(s.versus, 'versus', scope)}
      </div>
      <div class="setting">
        <div class="setting-label"><b>✍️ Eigenes Wort</b><small>Die Spielleitung darf statt der Karte ein eigenes Wort eintippen</small></div>
        ${switchHtml(s.custom, 'custom', scope)}
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

  /** Das geheime Wort als Karte */
  function wordCardHtml(word, opts) {
    const o = opts || {};
    return `<div class="word-card ${o.small ? 'wc-small' : ''} ${o.cls || ''}" id="wc-${esc(o.id || '')}">
      ${o.label ? `<small>${o.label}</small>` : ''}
      <b>${esc(word)}</b>
    </div>`;
  }

  /** Ein Hinweis als Zettel */
  function noteHtml(x, opts) {
    const o = opts || {};
    const reason = x.out ? Clues.REASONS[x.reason] || 'gestrichen' : '';
    const objections = x.objections && x.objections.length ? `<span class="note-obj" title="Einspruch">✋ ${x.objections.map(esc).join(', ')}</span>` : '';
    const inner = `
      <span class="note-text">${esc(x.text)}</span>
      ${o.names && x.name ? `<span class="note-name">${esc(x.name)}${o.mine ? ' (du)' : ''}</span>` : ''}
      ${x.out ? `<span class="note-reason">✗ ${esc(reason)}</span>` : o.showOk ? '<span class="note-reason ok">✓</span>' : ''}
      ${objections}`;
    const cls = `note ${x.out ? 'is-out' : ''} ${o.mine ? 'is-mine' : ''} ${o.group != null ? 'g' + (o.group % 6) : ''} ${o.cls || ''}`;
    const style = `--d:${((o.i || 0) * 0.07).toFixed(2)}s;--rot:${(((o.i || 0) * 37) % 9) - 4}deg`;
    if (o.act) return `<button class="${cls}" style="${style}" data-act="${o.act}" data-id="${esc(x.id)}">${inner}</button>`;
    return `<div class="${cls}" style="${style}">${inner}</div>`;
  }

  /** Gruppen gleicher Hinweise markieren (nur Gruppen mit 2+) */
  function groupIndex(list) {
    const counts = {};
    for (const x of list) counts[x.group] = (counts[x.group] || 0) + 1;
    const ids = [...new Set(list.filter((x) => counts[x.group] > 1).map((x) => x.group))];
    return (x) => (counts[x.group] > 1 ? ids.indexOf(x.group) : null);
  }

  function scoreHtml(v, st, opts) {
    const o = opts || {};
    if (!st) return '';
    const parts = [`<span class="sc-won" title="gewonnen">✅ ${st.won}</span>`, `<span class="sc-lost" title="verloren">❌ ${st.lost}</span>`];
    if (st.size) parts.push(`<span class="sc-deck" title="Karten im Stapel">🃏 ${st.deck}</span>`);
    else parts.push(`<span class="sc-lives" title="Fehler übrig">${Array.from({ length: v.maxFails }, (_, i) => (i < v.maxFails - st.fails ? '❤️' : '🖤')).join('')}</span>`);
    const team = st.team ? teamOf(v, st.team) : null;
    return `<span class="score-line ${o.active ? 'is-active' : ''}" ${team ? `style="${tc(team.color)}"` : ''}>${team ? `<span class="team-dot"></span><b>${esc(team.name)}</b>` : ''}${parts.join('')}</span>`;
  }

  function cardNoHtml(v) {
    const st = stackOf(v);
    if (!st) return '';
    if (!st.size) return `<span class="pill">🃏 Karte ${st.played}</span>`;
    // Karte x von y: gespielt + verbrannte (falsch kostet die nächste mit)
    const no = st.size - st.deck;
    return `<span class="pill">🃏 Karte ${no} / ${st.size}</span>`;
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
    const st = Words.stats();
    return `
    <div class="screen home">
      <a class="btn btn-ghost btn-small hub-back" href="../">← Alle Spiele</a>
      <div class="home-hero">
        ${logoHtml()}
        <p class="tagline">Wer <b>„Strand“</b> für <b>Sonne</b> schreibt, hofft, dass niemand sonst dieselbe Idee hatte.<br /><small>Doppelte Hinweise fliegen raus!</small></p>
        <div class="home-notes" aria-hidden="true">
          <span class="note is-out" style="--rot:-6deg"><span class="note-text">Strand</span></span>
          <span class="note" style="--rot:3deg"><span class="note-text">Sommer</span></span>
          <span class="note is-out" style="--rot:-2deg"><span class="note-text">Strand</span></span>
          <span class="note" style="--rot:5deg"><span class="note-text">Creme</span></span>
        </div>
      </div>
      ${resume.join('')}
      <div class="mode-cards">
        <button class="mode-card mode-stage" data-act="new-game">
          <span class="mode-icon">💻</span>
          <span class="mode-body"><b>Spiel anlegen</b><small>Am Laptop, Tablet oder Fernseher: Er ist die Bühne – wer rät, Kontrolle der Hinweise, Ergebnis.</small></span>
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
        <button class="btn btn-link" data-act="best">🏆 Bestenliste</button>
      </div>
      <p class="home-foot">Kooperativ · ${MIN_PLAYERS}–${MAX_PLAYERS} Personen · ${st.total} Wörter in 3 Stufen</p>
    </div>`;
  }

  /* ---------- Spiel anlegen (Laptop) ---------- */

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
    if (st.input === 'one') {
      const rows = s.players
        .map((p, pi) => {
          const color = st.versus ? TEAMS[pi % 2].color : PLAYER_COLORS[pi % PLAYER_COLORS.length];
          return `
          <div class="player-row" style="${tc(color)}">
            <span class="team-dot"></span>
            <input class="input" type="text" maxlength="24" placeholder="Spieler ${pi + 1}" value="${esc(p)}"
              data-field="player-name" data-player="${pi}" autocomplete="off" enterkeyhint="next" />
            ${s.players.length > MIN_PLAYERS ? `<button class="icon-btn" data-act="remove-player" data-player="${pi}" aria-label="Spieler entfernen">✕</button>` : ''}
          </div>`;
        })
        .join('');
      people = `<h2>Mitspieler <small class="muted">(${MIN_PLAYERS}–${MAX_PLAYERS}, in der Reihenfolge, in der geraten wird)</small></h2>
        ${st.versus ? '<p class="muted small">Wettkampf: Die Namen werden abwechselnd auf 🔴 Team Rot und 🔵 Team Blau verteilt.</p>' : ''}
        <div class="ts-players solo-players">${rows}</div>
        ${s.players.length < MAX_PLAYERS ? '<button class="btn btn-small btn-ghost" data-act="add-player">＋ Spieler</button>' : ''}`;
    } else {
      people = `<h2>Mitspieler</h2><p class="muted">Jede/r tritt mit dem eigenen Handy bei (${MIN_PLAYERS}–${MAX_PLAYERS} Personen). ${
        st.versus ? 'Im Wettkampf wählt jede/r auf dem Handy ein Team.' : ''
      }</p>`;
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
      <section class="panel">${people}</section>
      <section class="panel">
        <h2>Einstellungen</h2>
        ${settingsHtml(st, 'setup')}
      </section>
      <div class="sticky-start">
        <button class="btn btn-primary btn-big" data-act="create-game">${st.input === 'phones' ? 'Raum öffnen 📱' : "Los geht's ☝️"}</button>
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
    else if (v.phase !== 'lobby') {
      info = cardNoHtml(v) + v.stacks.map((st, i) => scoreHtml(v, st, { active: v.settings.versus && v.cur && v.cur.stack === i })).join('');
    }
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
    else if (v.phase === 'word') main = wordStageHtml(v);
    else if (v.phase === 'write') main = writeStageHtml(v);
    else if (v.phase === 'check') main = checkStageHtml(v);
    else if (v.phase === 'guess') main = guessStageHtml(v);
    else main = revealStageHtml(v);
    return `
      <div class="stage phase-${v.phase}">
        ${topbarHtml(v)}
        <main class="stage-main">${main}</main>
      </div>`;
  }

  /* ---------- Lobby ---------- */

  function lobbyStageHtml(v) {
    const versus = v.settings.versus;
    const chip = (p) => {
      const m = v.members.find((x) => x.id === p.id) || { online: p.online };
      return `<span class="chip ${m.online ? '' : 'is-offline'}" style="${tc(versus && p.team ? teamOf(v, p.team).color : p.color)}"><span class="team-dot"></span>${esc(p.name)}${
        versus ? `<button class="chip-x chip-swap" data-act="swap-team" data-player="${esc(p.id)}" data-team="${p.team === 'rot' ? 'blau' : 'rot'}" title="Team wechseln" aria-label="${esc(p.name)}: Team wechseln">⇄</button>` : ''
      }<button class="chip-x" data-act="kick" data-player="${esc(p.id)}" aria-label="${esc(p.name)} entfernen">✕</button></span>`;
    };
    const watching = v.members.filter((m) => !m.playing);
    let people;
    if (versus) {
      people = `<div class="team-grid">${TEAMS.map((t) => {
        const team = teamOf(v, t.id);
        const list = v.players.filter((p) => p.team === t.id);
        return `<div class="team-setup" style="${tc(team.color)}">
          <div class="ts-head">
            <span class="team-dot"></span>
            <input class="input input-team" type="text" maxlength="24" value="${esc(team.name)}" data-field="lobby-team-name" data-team="${t.id}" aria-label="Teamname" />
          </div>
          <div class="chips">${list.length ? list.map(chip).join('') : '<span class="muted">Noch niemand</span>'}</div>
        </div>`;
      }).join('')}</div>`;
    } else {
      people = `<div class="chips">${v.players.length ? v.players.map(chip).join('') : '<span class="muted">Noch niemand – QR-Code scannen!</span>'}</div>`;
    }
    return `
      <div class="lobby-grid">
        <section class="panel join-panel">
          <h2>📱 Handys verbinden</h2>
          <p class="muted">QR-Code scannen, Namen eingeben${versus ? ', Team wählen' : ''} – los geht's.</p>
          ${roomBoxHtml(v.room, true)}
        </section>
        <div class="lobby-side">
          <section class="panel">
            <h2>Mitspieler <small class="muted">(${v.players.length} / ${MAX_PLAYERS})</small></h2>
            ${people}
            ${watching.length ? `<div class="free"><b>Schauen nur zu:</b> <div class="chips">${watching.map((m) => `<span class="chip ${m.online ? '' : 'is-offline'}">${esc(m.name)}<button class="chip-x" data-act="kick" data-player="${esc(m.id)}" aria-label="${esc(m.name)} entfernen">✕</button></span>`).join('')}</div></div>` : ''}
            <p class="muted small">Geraten wird in dieser Reihenfolge${v.players.length >= SPLIT_FROM + 1 && v.settings.split ? ' · große Runde: pro Karte schreibt nur die Hälfte' : ''}${v.players.length === 3 ? ' · zu dritt schreibt jede/r 2 Hinweise' : ''}.</p>
          </section>
          <section class="panel">
            <h2>Einstellungen</h2>
            ${settingsHtml(v.settings, 'lobby')}
          </section>
          <div class="sticky-start">
            <button class="btn btn-primary btn-big" data-act="start" ${v.lobbyProblem ? 'disabled' : ''}>Los geht's ☝️</button>
            ${v.lobbyProblem ? `<p class="muted small center">${esc(v.lobbyProblem)}</p>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ---------- Wer rät ---------- */

  function guesserBannerHtml(v, text) {
    const c = v.cur;
    const team = c.team ? teamOf(v, c.team) : null;
    return `<div class="guesser" style="${tc(team ? team.color : colorOf(v, c.guesser))}">
      <span class="guesser-icon" aria-hidden="true">☝️</span>
      <div><b>${esc(c.guesserName)} rät</b>${team ? `<small>für ${esc(team.name)}</small>` : ''}${text ? `<small>${text}</small>` : ''}</div>
    </div>`;
  }

  function rulesNoteHtml(v) {
    const c = v.cur;
    const notes = [];
    if (c.per > 1) notes.push(`✌️ Ihr seid wenige – jede/r schreibt <b>${c.per} Hinweise</b>`);
    if (c.resting.length) notes.push(`👥 Große Runde – diesmal Pause: ${c.resting.map((pid) => esc(nameOf(v, pid))).join(', ')}`);
    return notes.length ? `<div class="rule-notes">${notes.map((n) => `<span>${n}</span>`).join('')}</div>` : '';
  }

  /* ---------- Ein Gerät: Wort zeigen ---------- */

  function wordStageHtml(v) {
    const c = v.cur;
    const shown = ui.peek === c.key;
    const custom = v.settings.custom ? '<button class="btn btn-ghost btn-small" data-act="custom-word">✍️ Eigenes Wort</button>' : '';
    if (!shown) {
      return `
        <div class="center-stage">
          ${guesserBannerHtml(v)}
          <div class="look-away">
            <div class="look-away-icon" aria-hidden="true">🙈</div>
            <h1>${esc(c.guesserName)}, schau weg!</h1>
            <p class="muted">Erst wenn ${esc(c.guesserName)} nicht mehr hinschaut, das Wort aufdecken.</p>
            <button class="btn btn-primary btn-big" data-act="peek">👀 Wort zeigen</button>
          </div>
          ${rulesNoteHtml(v)}
        </div>`;
    }
    return `
      <div class="center-stage">
        ${guesserBannerHtml(v, '🙈 schaut weg')}
        ${wordCardHtml(c.word, { id: c.key, label: 'Das geheime Wort' })}
        <ol class="steps">
          <li>Jede/r schreibt <b>${c.per > 1 ? `${c.per} Wörter` : 'genau ein Wort'}</b> auf einen Zettel – kein Wortteil, keine Wortfamilie, keine Übersetzung.</li>
          <li>Wort verstecken, Zettel vergleichen: <b>Doppelte und ungültige weg!</b></li>
          <li>Dann darf ${esc(c.guesserName)} schauen und hat <b>einen</b> Versuch.</li>
        </ol>
        ${rulesNoteHtml(v)}
        <div class="stage-actions">
          <button class="btn btn-primary btn-big" data-act="written" data-at="${esc(c.key)}">✅ Hinweise fertig – ${esc(c.guesserName)} darf schauen</button>
        </div>
        <div class="stage-actions">
          <button class="btn btn-ghost btn-small" data-act="hide-word">🙈 Wort verstecken</button>
          <button class="btn btn-ghost btn-small" data-act="skip" data-at="${esc(c.key)}">🔀 Kenn ich nicht – anderes Wort</button>
          ${custom}
        </div>
      </div>`;
  }

  /* ---------- Hinweise schreiben (mit Handys) ---------- */

  function writeStageHtml(v) {
    const c = v.cur;
    const status = c.writers
      .map((pid) => {
        const done = c.submitted.includes(pid);
        const here = done || c.waiting.includes(pid);
        return `<div class="pstat ${done ? 'done' : ''} ${here ? '' : 'off'}" style="${tc(colorOf(v, pid))}">
          <span class="team-dot"></span><b>${esc(nameOf(v, pid))}</b><span>${done ? '✅' : here ? '✍️' : '📵'}</span>
        </div>`;
      })
      .join('');
    const custom = v.settings.custom ? '<button class="btn btn-ghost btn-small" data-act="custom-word">✍️ Eigenes Wort</button>' : '';
    return `
      <div class="center-stage">
        ${guesserBannerHtml(v)}
        <div class="look-away small-away">
          <div class="look-away-icon" aria-hidden="true">🤫</div>
          <h2>Das Wort steht nur auf den Handys</h2>
          <p class="muted">${c.team ? `${esc(teamOf(v, c.team).name)} außer ${esc(c.guesserName)}` : `Alle außer ${esc(c.guesserName)}`} ${c.writers.length === 1 ? 'schreibt' : 'schreiben'} jetzt ${c.per > 1 ? `${c.per} Hinweise` : 'einen Hinweis'} – genau ein Wort. Doppelte fliegen raus!</p>
        </div>
        ${timerHtml(c.timer, true)}
        <div class="pstats">${status}</div>
        <p class="muted small center">${c.submitted.length} / ${c.writers.length} fertig</p>
        ${rulesNoteHtml(v)}
        <div class="stage-actions">
          <button class="btn btn-ghost btn-small" data-act="close-writing" data-at="${esc(c.key)}">⏩ Jetzt vergleichen</button>
          <button class="btn btn-ghost btn-small" data-act="skip" data-at="${esc(c.key)}">🔀 Anderes Wort</button>
          ${custom}
        </div>
      </div>`;
  }

  /* ---------- Kontrolle ---------- */

  function cluesBoardHtml(list, opts) {
    const o = opts || {};
    if (!list.length) return '<p class="muted center">Keine Hinweise abgegeben.</p>';
    const gi = groupIndex(list);
    return `<div class="notes ${o.cls || ''}">${list.map((x, i) => noteHtml(x, { i, names: o.names, group: gi(x), act: o.act, showOk: o.showOk, mine: o.me && x.pid === o.me })).join('')}</div>`;
  }

  function checkStageHtml(v) {
    const c = v.cur;
    if (!c.away) {
      return `
        <div class="center-stage">
          ${guesserBannerHtml(v)}
          <div class="look-away">
            <div class="look-away-icon" aria-hidden="true">🙈</div>
            <h1>${esc(c.guesserName)}, schau weg!</h1>
            <p class="muted">Gleich erscheinen hier alle Hinweise zur Kontrolle. ${esc(c.guesserName)} bestätigt auf dem Handy mit <b>„🙈 Ich schaue weg“</b>.</p>
            <button class="btn btn-ghost" data-act="away" data-at="${esc(c.key)}">🙈 ${esc(c.guesserName)} schaut weg</button>
          </div>
        </div>`;
    }
    const list = c.clues || [];
    const objected = list.filter((x) => x.objections.length).length;
    const others = c.writers.length + c.resting.length;
    return `
      <div class="center-stage check-stage">
        ${guesserBannerHtml(v, '🙈 schaut weg')}
        <h2 class="stage-title">Kontrolle: Was ist doppelt oder ungültig?</h2>
        <p class="muted center">Gestrichene sind rot. Antippen = <b>doch gültig</b> / <b>doch streichen</b>. Einsprüche von den Handys erscheinen mit ✋.</p>
        ${cluesBoardHtml(list, { names: true, act: 'verdict', showOk: true })}
        <p class="muted small center">${c.ready.length ? `Passt so: ${c.ready.map((pid) => esc(nameOf(v, pid))).join(', ')} (${c.ready.length} / ${others})` : 'Noch niemand hat „Passt so“ gedrückt'}${objected ? ` · ✋ ${objected} ${plural(objected, 'Einspruch', 'Einsprüche')}` : ''}</p>
        <div class="stage-actions">
          <button class="btn btn-primary btn-big" data-act="release" data-at="${esc(c.key)}">✅ Fertig – ${esc(c.guesserName)} darf schauen</button>
        </div>
      </div>`;
  }

  /* ---------- Raten ---------- */

  function judgeButtonsHtml(c, small) {
    const cls = small ? 'btn-small' : 'btn-big';
    return `<div class="judge ${small ? 'judge-small' : ''}">
      <button class="btn btn-ok ${cls}" data-act="judge" data-result="won" data-at="${esc(c.key)}">✅ Richtig</button>
      <button class="btn btn-bad ${cls}" data-act="judge" data-result="lost" data-at="${esc(c.key)}">❌ Falsch</button>
      <button class="btn btn-ghost ${cls}" data-act="judge" data-result="pass" data-at="${esc(c.key)}">⏭️ Passen</button>
    </div>`;
  }

  function guessStageHtml(v) {
    const c = v.cur;
    const phones = v.settings.input === 'phones';
    const type = phones && v.settings.guess === 'type';
    let clues;
    if (!phones) {
      clues = `<div class="look-away"><div class="look-away-icon" aria-hidden="true">📝</div><h2>Legt die übrigen Zettel hin!</h2><p class="muted">${esc(c.guesserName)} hat einen Versuch – oder passt.</p></div>`;
    } else if (!c.valid || !c.valid.length) {
      clues = `<div class="look-away"><div class="look-away-icon" aria-hidden="true">😬</div><h2>Alle Hinweise wurden gestrichen!</h2><p class="muted">Raten auf gut Glück – oder passen.</p></div>`;
    } else {
      clues = `<div class="notes notes-big">${c.valid.map((t, i) => noteHtml({ text: t, out: false }, { i })).join('')}</div>`;
    }
    return `
      <div class="center-stage guess-stage">
        ${guesserBannerHtml(v)}
        <h1 class="stage-title">👀 ${esc(c.guesserName)}, du darfst schauen!</h1>
        ${clues}
        ${
          type
            ? `<p class="muted center">${esc(c.guesserName)} tippt die Antwort auf dem Handy …</p><details class="fallback"><summary>Handy streikt? Hier entscheiden</summary>${judgeButtonsHtml(c, true)}</details>`
            : judgeButtonsHtml(c, false)
        }
        <p class="muted small center">Falsch kostet diese <b>und die nächste</b> Karte – passen nur diese.</p>
      </div>`;
  }

  /* ---------- Auflösung ---------- */

  function resultTextHtml(v) {
    const c = v.cur;
    const r = RESULT[c.result];
    let sub = '';
    if (c.result === 'won') sub = c.accepted ? 'Zählt doch – Karte gewonnen!' : 'Karte gewonnen!';
    else if (c.result === 'pass') sub = 'Nur diese Karte ist weg.';
    else if (c.burned === 'next') sub = 'Diese <b>und die nächste</b> Karte sind weg.';
    else if (c.burned === 'won') sub = 'Letzte Karte falsch – dafür geht eine gewonnene Karte verloren.';
    else if (!stackOf(v).size) sub = `Ein Fehler – noch ${v.maxFails - stackOf(v).fails} übrig.`;
    else sub = 'Die Karte ist weg.';
    return `<div class="result" style="${tc(r.color)}"><b>${r.icon} ${r.label}</b><small>${sub}</small></div>`;
  }

  function revealStageHtml(v) {
    const c = v.cur;
    const phones = v.settings.input === 'phones';
    const list = c.clues || [];
    let guess = '';
    if (c.typed) {
      guess = `<p class="center">${esc(c.guesserName)} hat getippt: <b>„${esc(c.guess)}“</b>
        ${c.result === 'lost' || c.accepted ? `<button class="btn btn-small ${c.accepted ? 'btn-ok' : 'btn-ghost'}" data-act="accept" title="Die App hat eine richtige Antwort nicht erkannt">${c.accepted ? '✓ zählt doch' : 'zählt doch?'}</button>` : ''}</p>`;
    }
    const fix = !phones
      ? `<div class="stage-actions fix">${['won', 'lost', 'pass']
          .filter((r) => r !== c.result)
          .map((r) => `<button class="btn btn-ghost btn-small" data-act="rejudge" data-result="${r}">Doch ${RESULT[r].icon} ${RESULT[r].label.replace('!', '')}</button>`)
          .join('')}</div>`
      : '';
    const dupes = list.filter((x) => x.out && x.reason === 'dupe');
    return `
      <div class="center-stage reveal" id="rv-${esc(c.key)}">
        ${resultTextHtml(v)}
        ${wordCardHtml(c.word, { id: 'rv' + c.key, label: c.custom ? 'Das eigene Wort' : 'Das Wort war' })}
        ${guess}
        ${phones ? `<div class="reveal-after" style="--d:0.4s"><h3 class="center">Alle Hinweise${dupes.length ? ' – auch die doppelten 😄' : ''}</h3>${cluesBoardHtml(list, { names: true })}</div>` : ''}
        ${fix}
        <button class="btn btn-primary btn-big next-float" style="--d:0.5s" data-act="next" data-no="${c.no}">${lastCard(v) ? 'Zum Ergebnis 🏁' : 'Nächste Karte →'}</button>
      </div>`;
  }

  /** Ist das die letzte Karte? (alle Stapel durch) */
  function lastCard(v) {
    return v.stacks.every((st) => (st.size ? st.deck <= 0 : st.fails >= v.maxFails));
  }

  /* ---------- Spielende ---------- */

  function bestListHtml(cards, highlight) {
    const list = bestFor(cards).slice(0, 10);
    if (!list.length) return '<p class="muted">Noch keine Ergebnisse auf diesem Gerät.</p>';
    return `<ol class="best-list">${list
      .map(
        (x) => `<li class="${x.id === highlight ? 'is-new' : ''}"><b>${x.won}</b> ${plural(x.won, 'Karte', 'Karten')}
          <small>${esc(x.date.split('-').reverse().join('.'))} · ${x.people} ${plural(x.people, 'Person', 'Personen')}${x.input === 'one' ? ' · ein Gerät' : ''}</small></li>`
      )
      .join('')}</ol>`;
  }

  function overHtml(v) {
    const versus = v.settings.versus;
    let head;
    if (versus) {
      const [a, b] = v.stacks;
      const ta = teamOf(v, a.team);
      const tb = teamOf(v, b.team);
      const winner = a.won === b.won ? null : a.won > b.won ? ta : tb;
      head = `<h1 class="over-title">${winner ? `🏆 ${esc(winner.name)} gewinnt!` : '🤝 Unentschieden!'}</h1>
        <div class="versus-result">${v.stacks
          .map((st) => {
            const t = teamOf(v, st.team);
            return `<div class="vr" style="${tc(t.color)}"><span class="team-dot"></span><b>${esc(t.name)}</b><span class="vr-num">${st.won}</span><small>von ${st.size} Karten</small></div>`;
          })
          .join('')}</div>`;
    } else {
      const st = v.stacks[0];
      const r = st.rating || rating(st.won, st.size);
      head = `<div class="final">
          <div class="final-icon" aria-hidden="true">${r.icon}</div>
          <div class="final-num"><b>${st.won}</b>${st.size ? `<span> / ${st.size}</span>` : ''}</div>
          <div class="final-label">${plural(st.won, 'Karte', 'Karten')} gewonnen${st.size ? '' : ` · ${st.played} gespielt`}</div>
          <p class="final-text">${esc(r.text)}</p>
        </div>`;
    }
    const awards = (v.awards || [])
      .map((a) => `<div class="award"><span class="award-icon">${a.icon}</span><div><b>${esc(a.title)}</b><small>${esc(a.text)}</small></div></div>`)
      .join('');
    const words = (v.history || [])
      .map((h) => {
        const r = RESULT[h.result] || RESULT.pass;
        const clues = h.clues.map((c) => (c.out ? `<s>${esc(c.text)}</s>` : esc(c.text))).join(', ');
        const team = h.team ? teamOf(v, h.team) : null;
        return `<li><span>${r.icon}</span> <b>${esc(h.word)}</b> <small class="muted">– ${esc(h.guesser)}${team ? ` (${esc(team.name)})` : ''}</small>${clues ? `<br /><small>${clues}</small>` : ''}</li>`;
      })
      .join('');
    const best = !versus ? `<section class="panel best-panel"><h2>🏆 Bestenliste <small class="muted">(${cardsLabel(v.stacks[0].size)} Karten, dieses Gerät)</small></h2>${bestListHtml(v.stacks[0].size, v.startedAt)}</section>` : '';
    return `
      <div class="center-stage over">
        ${head}
        ${awards ? `<div class="awards">${awards}</div>` : ''}
        ${best}
        ${words ? `<details class="word-list"><summary>📜 Alle Wörter dieses Spiels (${v.history.length})</summary><ol>${words}</ol></details>` : ''}
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
    const team = p && p.team && v.settings.versus ? teamOf(v, p.team) : null;
    let body;
    if (v.phase === 'lobby') body = phoneLobbyHtml(v, p);
    else if (v.phase === 'over') body = phoneOverHtml(v);
    else if (v.phase === 'write') body = phoneWriteHtml(v);
    else if (v.phase === 'check') body = phoneCheckHtml(v);
    else if (v.phase === 'guess') body = phoneGuessHtml(v);
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
        ${v.cur ? `<div class="phone-score">${cardNoHtml(v)}${scoreHtml(v, stackOf(v))}</div>` : ''}
        <main class="phone-main">${body}</main>
      </div>`;
  }

  function phoneLobbyHtml(v, p) {
    const n = v.players.length;
    if (!p) {
      return `<div class="look-up">👀<b>Du schaust zu</b><small>${n} ${plural(n, 'Person spielt', 'Personen spielen')}</small></div>
        ${n < MAX_PLAYERS ? '<button class="btn btn-primary btn-big btn-wide" data-act="watch" data-watch="0">☝️ Mitspielen</button>' : '<p class="muted center">Das Spiel ist voll.</p>'}`;
    }
    let teams = '';
    if (v.settings.versus) {
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
    return `<div class="look-up">☝️<b>Du bist dabei!</b><small>${n} ${plural(n, 'Person', 'Personen')} im Spiel${n < MIN_PLAYERS ? ` – ab ${MIN_PLAYERS} geht's los` : ''}</small></div>
      ${teams}
      <p class="waiting">⏳ Warte, bis es am Laptop losgeht…</p>
      <button class="btn btn-link" data-act="watch" data-watch="1">Doch nur zuschauen</button>`;
  }

  /** Bin ich die ratende Person? */
  function guessing(v) {
    return !!(v.cur && v.cur.guesser === v.me.id);
  }

  function phoneGuesserWaitHtml(v, text) {
    return `<div class="look-up you-guess">🙈<b>Du rätst!</b><small>${text}</small></div>`;
  }

  function leadToolsHtml(v, items) {
    if (!v.me.lead || !items.length) return '';
    return `<div class="lead-tools"><small>🎬 Du bist die Spielleitung</small>${items.join('')}</div>`;
  }

  function phoneWriteHtml(v) {
    const c = v.cur;
    if (guessing(v)) {
      return `${phoneGuesserWaitHtml(v, 'Augen zu, bis alle fertig sind … dann auf den Laptop schauen.')}
        <p class="muted center">${c.submitted.length} / ${c.writers.length} Hinweise da</p>
        ${timerHtml(c.timer, false)}`;
    }
    const lead = leadToolsHtml(v, [
      `<button class="btn btn-ghost btn-small" data-act="close-writing" data-at="${esc(c.key)}">⏩ Jetzt vergleichen</button>`,
      ...(v.settings.custom ? ['<button class="btn btn-ghost btn-small" data-act="custom-word">✍️ Eigenes Wort</button>'] : []),
    ]);
    const word = wordCardHtml(c.word, { id: c.key, label: `${esc(c.guesserName)} rät` });
    const skip = c.skipsLeft > 0 ? `<button class="btn btn-ghost btn-small" data-act="skip" data-at="${esc(c.key)}">🤷 Kenn ich nicht</button>` : '';
    if (!c.writers.includes(v.me.id)) {
      const other = v.settings.versus && c.team && v.me.team && v.me.team !== c.team;
      const why = c.resting.includes(v.me.id)
        ? 'Große Runde: Diesmal pausierst du – nächste Karte bist du wieder dran.'
        : other
          ? `${esc(teamOf(v, c.team).name)} ist dran – bei der nächsten Karte seid ihr wieder an der Reihe.`
          : v.me.playing
            ? 'Du bist ab der nächsten Karte dabei.'
            : 'Du schaust zu.';
      return `${word}<div class="look-up small">☕<b>Diesmal kein Hinweis</b><small>${why}</small></div>${timerHtml(c.timer, false)}${lead}`;
    }
    if (c.mine) {
      return `${word}
        <div class="submitted"><small>${plural(c.mine.length, 'Dein Hinweis', 'Deine Hinweise')}</small><b>${c.mine.map(esc).join(' · ')}</b></div>
        <p class="waiting">⏳ ${c.submitted.length} / ${c.writers.length} fertig – warte auf die anderen …</p>
        <button class="btn btn-link" data-act="unclue" data-at="${esc(c.key)}">✏️ Ändern</button>
        ${timerHtml(c.timer, false)}${lead}`;
    }
    const fields = Array.from({ length: c.per }, (_, i) => {
      const val = ui.clues[i] || '';
      const bad = val.trim() ? Clues.invalid(val, c.word) : null;
      return `<input id="clue-${i}" class="input input-big input-clue" type="text" maxlength="${Clues.MAX_CLUE}" placeholder="${c.per > 1 ? `Hinweis ${i + 1}` : 'Dein Hinweis'}" value="${esc(val)}"
          data-field="clue" data-i="${i}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="${i < c.per - 1 ? 'next' : 'send'}" />
        ${bad && bad !== 'empty' ? `<div class="word-error">⚠️ ${esc(Clues.REASONS[bad])} – wird wohl gestrichen</div>` : ''}`;
    }).join('');
    const ready = ui.clues.slice(0, c.per).every((t) => t && t.trim());
    return `${word}
      <form class="clue-form" data-form="clue">
        <label class="label" for="clue-0">${c.per > 1 ? `Deine ${c.per} Hinweise` : 'Dein Hinweis'} <small class="muted">– genau ein Wort, möglichst eins, auf das sonst niemand kommt</small></label>
        ${fields}
        <button class="btn btn-primary btn-big btn-wide" type="submit" ${ready ? '' : 'disabled'}>Senden ✓</button>
      </form>
      ${timerHtml(c.timer, true)}
      ${skip}
      ${lead}`;
  }

  function phoneCheckHtml(v) {
    const c = v.cur;
    if (guessing(v)) {
      if (!c.away) {
        return `${phoneGuesserWaitHtml(v, 'Gleich zeigt der Laptop alle Hinweise zur Kontrolle.')}
          <button class="btn btn-primary btn-big btn-wide btn-away" data-act="away" data-at="${esc(c.key)}">🙈 Ich schaue weg</button>
          <p class="muted small center">Erst drücken, wenn du nicht mehr auf den Laptop schaust.</p>`;
      }
      return phoneGuesserWaitHtml(v, 'Augen zu! Die anderen kontrollieren gerade die Hinweise …');
    }
    const list = c.clues || [];
    const lead = v.me.lead;
    const me = v.me.id;
    const ready = c.ready.includes(v.me.id);
    return `
      ${wordCardHtml(c.word, { small: true, id: c.key, label: 'Das Wort' })}
      <h2 class="phone-title">☝️ Kontrolle</h2>
      <p class="muted small center">${lead ? 'Antippen = doch gültig / doch streichen (du entscheidest).' : 'Stimmt etwas nicht? Antippen = ✋ Einspruch. Die Spielleitung entscheidet.'}</p>
      ${cluesBoardHtml(list, { names: true, act: lead ? 'verdict' : 'objection', showOk: true, me, cls: 'notes-phone' })}
      ${
        lead
          ? `<button class="btn btn-primary btn-big btn-wide" data-act="release" data-at="${esc(c.key)}">✅ Fertig – ${esc(c.guesserName)} darf schauen</button>`
          : v.me.playing
            ? `<button class="btn ${ready ? 'btn-ok' : 'btn-primary'} btn-big btn-wide" data-act="ready" data-at="${esc(c.key)}" ${ready ? 'disabled' : ''}>${ready ? '✓ Passt so' : 'Passt so ✓'}</button>`
            : ''
      }`;
  }

  function phoneGuessHtml(v) {
    const c = v.cur;
    const valid = c.valid || [];
    const notes = valid.length ? `<div class="notes notes-phone notes-big">${valid.map((t, i) => noteHtml({ text: t, out: false }, { i })).join('')}</div>` : '<div class="look-up small">😬<b>Alle Hinweise gestrichen!</b></div>';
    if (guessing(v)) {
      if (v.settings.guess === 'type') {
        return `<h2 class="phone-title">👀 Deine Hinweise</h2>${notes}
          <form class="guess-form" data-form="guess">
            <input id="guess-input" class="input input-big input-guess" type="text" maxlength="${MAX_GUESS}" placeholder="Das Wort ist …" value="${esc(ui.guess)}"
              data-field="guess" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="send" />
            <button class="btn btn-primary btn-big btn-wide" type="submit" ${ui.guess.trim() ? '' : 'disabled'}>Raten ☝️</button>
          </form>
          <p class="muted small center">Nur <b>ein</b> Versuch! Falsch kostet auch die nächste Karte.</p>
          <button class="btn btn-ghost btn-wide" data-act="pass" data-at="${esc(c.key)}">⏭️ Passen</button>`;
      }
      return `<h2 class="phone-title">👀 Deine Hinweise</h2>${notes}
        <div class="look-up small">🗣️<b>Sag deine Antwort laut!</b><small>Nur ein Versuch – falsch kostet auch die nächste Karte.</small></div>
        <button class="btn btn-ghost btn-wide" data-act="pass" data-at="${esc(c.key)}">⏭️ Passen</button>`;
    }
    const lead =
      v.me.lead && v.settings.guess !== 'type'
        ? `<div class="lead-tools"><small>🎬 Du bist die Spielleitung – was hat ${esc(c.guesserName)} gesagt?</small>${judgeButtonsHtml(c, true)}</div>`
        : '';
    return `${wordCardHtml(c.word, { small: true, id: c.key, label: 'Das Wort' })}
      <div class="look-up small">🤞<b>${esc(c.guesserName)} rät …</b><small>Psst – nichts verraten!</small></div>
      ${notes}${lead}`;
  }

  function phoneRevealHtml(v) {
    const c = v.cur;
    const r = RESULT[c.result];
    const list = c.clues || [];
    const me = v.me.id;
    const mine = list.filter((x) => x.pid === me);
    let personal = '';
    if (mine.length && v.settings.input === 'phones') {
      const out = mine.filter((x) => x.out);
      personal = out.length
        ? `<p class="center muted">${out.some((x) => x.reason === 'dupe') ? '👯 Dein Hinweis war doppelt!' : '🚫 Dein Hinweis wurde gestrichen.'}</p>`
        : `<p class="center muted">🦄 Dein Hinweis ist durchgekommen!</p>`;
    }
    const lead = v.me.lead
      ? `<button class="btn btn-primary btn-big btn-wide phone-next" data-act="next" data-no="${c.no}">${lastCard(v) ? 'Zum Ergebnis 🏁' : 'Nächste Karte →'}<small>Du bist die Spielleitung</small></button>
         ${c.typed && (c.result === 'lost' || c.accepted) ? `<button class="btn btn-small ${c.accepted ? 'btn-ok' : 'btn-ghost'}" data-act="accept">${c.accepted ? '✓ zählt doch' : 'zählt doch?'}</button>` : ''}`
      : '';
    return `
      <div class="phone-result">
        <div class="pr-head" style="color:${r.color}">${r.icon} ${r.label}</div>
        ${wordCardHtml(c.word, { id: 'rv' + c.key, label: c.guesser === me ? 'Gesucht war' : 'Das Wort' })}
        ${c.typed ? `<p class="center">getippt: <b>„${esc(c.guess)}“</b></p>` : ''}
      </div>
      ${personal}
      ${cluesBoardHtml(list, { names: true, me, cls: 'notes-phone' })}
      ${lead}`;
  }

  function phoneOverHtml(v) {
    let head;
    if (v.settings.versus) {
      const [a, b] = v.stacks;
      const p = player(v, v.me.id);
      const mine = p ? v.stacks.find((st) => st.team === p.team) : null;
      const other = mine ? v.stacks.find((st) => st !== mine) : null;
      head =
        mine && other && mine.won !== other.won
          ? mine.won > other.won
            ? `<div class="look-up win">🏆<b>Ihr habt gewonnen!</b><small>${mine.won} : ${other.won} Karten</small></div>`
            : `<div class="look-up">😅<b>Knapp verloren</b><small>${mine.won} : ${other.won} Karten</small></div>`
          : `<div class="look-up">🤝<b>${a.won === b.won ? 'Unentschieden!' : 'Spiel vorbei!'}</b><small>${v.stacks.map((st) => `${esc(teamOf(v, st.team).name)} ${st.won}`).join(' · ')}</small></div>`;
    } else {
      const st = v.stacks[0];
      const r = st.rating || rating(st.won, st.size);
      head = `<div class="look-up win">${r.icon}<b>${st.won}${st.size ? ` / ${st.size}` : ''} Karten</b><small>${esc(r.text)}</small></div>`;
    }
    const stats = v.stats && v.stats[v.me.id];
    const mine = stats
      ? `<div class="my-stats"><span>✍️ ${stats.clues} ${plural(stats.clues, 'Hinweis', 'Hinweise')}</span><span>🦄 ${stats.unique} durchgekommen</span><span>👯 ${stats.dupes} doppelt</span></div>`
      : '';
    const awards = (v.awards || []).map((a) => `<div class="award"><span class="award-icon">${a.icon}</span><div><b>${esc(a.title)}</b><small>${esc(a.text)}</small></div></div>`).join('');
    return `${head}${mine}${awards ? `<div class="awards">${awards}</div>` : ''}
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
    else if (ui.modal === 'best') body = bestHtml();
    else if (ui.modal === 'custom') body = customHtml();
    else if (ui.modal === 'qr') {
      body = `<h2>📱 Mitspieler einladen</h2>${roomBoxHtml(ui.view && ui.view.room, false)}
        <p class="muted small center">Wer jetzt beitritt, spielt ab der nächsten Karte mit.</p>
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

  function customHtml() {
    const v = ui.view;
    const who = v && v.cur ? v.cur.guesserName : 'die ratende Person';
    return `<h2>✍️ Eigenes Wort</h2>
      <p class="muted">Statt der Karte rät ${esc(who)} dein Wort. ${v && v.me.stage ? `Achtung: ${esc(who)} darf jetzt nicht auf den Bildschirm schauen!` : ''}</p>
      <form data-form="custom">
        <input id="custom-input" class="input input-big" type="text" maxlength="${MAX_WORD}" placeholder="z.B. Kaktus" value="${esc(ui.custom)}" data-field="custom" autocomplete="off" spellcheck="false" enterkeyhint="done" />
        <div class="modal-actions">
          <button class="btn btn-primary" type="submit">Übernehmen</button>
          <button class="btn btn-ghost" type="button" data-act="close-modal">Abbrechen</button>
        </div>
      </form>`;
  }

  function bestHtml() {
    const tabs = CARD_OPTIONS.map((n) => `<h3>${n ? `${n} Karten` : 'Endlos'}</h3>${bestListHtml(n)}`).join('');
    return `<h2>🏆 Bestenliste <small class="muted">(dieses Gerät)</small></h2>
      <div class="best-modal">${tabs}</div>
      <div class="modal-actions">
        ${loadBest().length ? '<button class="btn btn-ghost" data-act="clear-best">Leeren</button>' : ''}
        <button class="btn btn-primary" data-act="close-modal">Schließen</button>
      </div>`;
  }

  function rulesHtml() {
    return `
      <h2>📖 Spielregeln</h2>
      <div class="rules">
        <p>Ihr spielt <b>zusammen</b> gegen den Kartenstapel (${CARD_OPTIONS[0]} Karten). Reihum rät eine Person ein geheimes Wort.
          Alle anderen schreiben geheim <b>genau ein Wort</b> als Hinweis – aber <b>doppelte Hinweise fliegen raus!</b>
          Wer „Strand“ für <i>Sonne</i> schreibt, hofft, dass niemand sonst dieselbe Idee hatte.</p>
        <h3>🚫 Ungültig</h3>
        <p>Das Wort selbst oder ein Teil davon, die Wortfamilie (<i>Sonne → sonnig</i>), Übersetzungen (<i>Sun</i>), ausgedachte Wörter,
          gleich klingende Wörter (<i>Mehr</i> für <i>Meer</i>). Zahlen als Ziffern sind ok (<i>7</i>).
          Gleich heißt auch: Plural, Wortfamilie, Tippfehler.</p>
        <h3>🔍 Kontrolle</h3>
        <p>Die ratende Person schaut weg, alle anderen sehen die Hinweise. Die App streicht Doppelte und Ungültige vor –
          sie irrt sich aber manchmal (<i>fliegen / Flug</i>). Per <b>Einspruch</b> und Antippen wird korrigiert.</p>
        <h3>☝️ Raten</h3>
        <p>Die ratende Person sieht die übrigen Hinweise und hat <b>einen</b> Versuch:
          <b>richtig</b> = Karte gewonnen ✅, <b>falsch</b> = diese <b>und die nächste</b> Karte verloren ❌❌ (bei der letzten Karte eine gewonnene),
          <b>passen</b> = nur diese Karte verloren.</p>
        <h3>🏆 Wertung</h3>
        <p>13 = Perfekt! · 12 = Unglaublich · 11 = Großartig · 9–10 = Super · 7–8 = Guter Durchschnitt · 4–6 = Ganz okay · 0–3 = Probiert's noch mal.</p>
        <h3>🎛️ Varianten</h3>
        <p><b>Zu dritt</b> schreibt jede/r 2 Hinweise. In der <b>großen Runde</b> (ab 8) schreibt pro Karte nur die Hälfte.
          <b>Endlos</b> geht, bis ihr ${MAX_FAILS}× falsch geraten habt. Im <b>Wettkampf</b> spielen 2 Teams abwechselnd mit eigenem Stapel.</p>
        <h3>🖥️ Ein Gerät</h3>
        <p>Ohne Handys: Der Laptop zeigt das Wort, während die ratende Person wegschaut. Hinweise auf Zettel, Doppelte von Hand weg,
          dann laut raten und richtig/falsch anklicken.</p>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Los geht's!</button></div>`;
  }

  function menuHtml() {
    const v = ui.view;
    const items = [];
    items.push(`<button class="menu-item" data-act="rules">📖 Spielregeln</button>`);
    items.push(`<button class="menu-item" data-act="mute">${Sound.muted ? '🔊 Ton einschalten' : '🔇 Ton ausschalten'}</button>`);
    if (!v || v.me.stage) items.push(`<button class="menu-item" data-act="best">🏆 Bestenliste</button>`);
    if (v && v.me.stage) {
      if (v.room) items.push(`<button class="menu-item" data-act="show-qr">📱 Mitspieler einladen</button>`);
      if (v.cur && ['write', 'word'].includes(v.phase)) items.push(`<button class="menu-item" data-act="skip" data-at="${esc(v.cur.key)}">🔀 Anderes Wort</button>`);
      items.push(`<button class="menu-item" data-act="home-keep">🏠 Hauptmenü <small>(Spiel bleibt gespeichert)</small></button>`);
      if (!['lobby', 'over'].includes(v.phase)) items.push(`<button class="menu-item danger" data-act="end-game">⏹️ Spiel beenden & Ergebnis zeigen</button>`);
      items.push(`<button class="menu-item danger" data-act="close-game">🚪 Spiel schließen</button>`);
    } else if (v) {
      if (v.phase === 'lobby' && v.me.playing) items.push(`<button class="menu-item" data-act="watch" data-watch="1">👀 Nur zuschauen</button>`);
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
    if (s.settings.input === 'one') {
      const min = s.settings.versus ? 4 : MIN_PLAYERS;
      if (s.players.length < min) {
        ui.error = `Ihr braucht mindestens ${min} Personen.`;
        render();
        return;
      }
    }
    const state = Engine.create({ settings: s.settings, players: s.players });
    Sound.unlock();
    startStage({ state });
  }

  function setInput(selector, value) {
    // Ein fokussiertes Feld überspringt morphdom – deshalb direkt setzen
    const input = app.querySelector(selector);
    if (input) input.value = value;
  }

  /** a.at: Kennung der Karte, damit verspätete Klicks nicht beim nächsten Wort landen */
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
    best: () => {
      ui.modal = 'best';
      render();
    },
    'clear-best': () =>
      askConfirm({
        title: 'Bestenliste leeren?',
        text: 'Alle Ergebnisse auf diesem Gerät werden gelöscht.',
        yes: 'Leeren',
        danger: true,
        run: () => Store.remove(BEST_KEY),
      }),
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
        text: 'Das Spiel endet sofort – die laufende Karte zählt nicht.',
        yes: 'Beenden',
        danger: true,
        run: () => dispatch('end'),
      }),

    /* Setup & Lobby */
    set: (el) => {
      const key = el.dataset.key;
      let value = el.dataset.value;
      if (['cards', 'timer'].includes(key)) value = +value;
      setSetting(el.dataset.scope, key, value);
    },
    toggle: (el) => setSetting(el.dataset.scope, el.dataset.key, !scopeSettings(el.dataset.scope)[el.dataset.key]),
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
      if (p.length <= MIN_PLAYERS) return;
      p.splice(+el.dataset.player, 1);
      saveSetup();
      render();
    },
    'create-game': createGame,
    kick: (el) => dispatch('kick', { player: el.dataset.player }),
    'swap-team': (el) => dispatch('joinTeam', { player: el.dataset.player, team: el.dataset.team }),
    'join-team': (el) => dispatch('joinTeam', { team: el.dataset.team }),
    watch: (el) => {
      ui.modal = null;
      dispatch('watch', { watch: el.dataset.watch === '1' });
    },
    start: () => dispatch('start'),

    /* Spiel */
    peek: () => {
      ui.peek = ui.view && ui.view.cur ? ui.view.cur.key : null;
      Sound.flip();
      render();
    },
    'hide-word': () => {
      ui.peek = null;
      render();
    },
    written: (el) => {
      ui.peek = null;
      dispatch('written', at(el));
    },
    skip: (el) => dispatch('skip', at(el)),
    'custom-word': () => {
      ui.custom = '';
      ui.modal = 'custom';
      ui.focus = '#custom-input';
      render();
    },
    'close-writing': (el) => dispatch('closeWriting', at(el)),
    unclue: (el) => {
      const v = ui.view;
      if (v && v.cur && v.cur.mine) ui.clues = v.cur.mine.concat(['', '']).slice(0, 2);
      ui.focus = '#clue-0';
      dispatch('unclue', at(el));
    },
    away: (el) => dispatch('away', at(el)),
    verdict: (el) => {
      const v = ui.view;
      dispatch('verdict', { id: el.dataset.id, at: v && v.cur ? v.cur.key : undefined });
    },
    objection: (el) => {
      const v = ui.view;
      dispatch('objection', { id: el.dataset.id, at: v && v.cur ? v.cur.key : undefined });
    },
    ready: (el) => dispatch('ready', at(el)),
    release: (el) => dispatch('release', at(el)),
    judge: (el) => dispatch('judge', Object.assign({ result: el.dataset.result }, at(el))),
    rejudge: (el) => dispatch('rejudge', { result: el.dataset.result }),
    pass: (el) => dispatch('pass', at(el)),
    accept: () => dispatch('accept'),
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
      ui.setup.players[+el.dataset.player] = el.value;
      saveSetup();
    } else if (f === 'name') {
      ui.name = el.value;
    } else if (f === 'join-code') {
      ui.joinCode = Net.cleanCode(el.value);
    } else if (f === 'clue') {
      ui.clues[+el.dataset.i] = el.value;
      render();
    } else if (f === 'guess') {
      ui.guess = el.value;
      render();
    } else if (f === 'custom') {
      ui.custom = el.value;
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
    } else if (el.dataset.field === 'lobby-team-name') {
      el.blur();
    } else if (el.dataset.field === 'clue') {
      // Enter springt zum nächsten Feld bzw. schickt ab
      const next = app.querySelector(`#clue-${+el.dataset.i + 1}`);
      if (next) {
        e.preventDefault();
        next.focus();
      }
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
    if (form.dataset.form === 'custom') {
      const word = ui.custom.trim();
      if (!word) return;
      ui.modal = null;
      ui.peek = null;
      dispatch('customWord', { word, at: v && v.cur ? v.cur.key : undefined });
      render();
      return;
    }
    if (!v || !v.cur) return;
    if (form.dataset.form === 'clue') {
      const texts = ui.clues.slice(0, v.cur.per).map((t) => (t || '').trim());
      if (texts.some((t) => !t)) return;
      if (texts.some((t) => Clues.wordCount(t) > 1)) {
        toast('Nur ein Wort pro Hinweis!');
        return;
      }
      if (document.activeElement) document.activeElement.blur();
      dispatch('clue', { texts, at: v.cur.key });
    } else if (form.dataset.form === 'guess') {
      const text = ui.guess.trim();
      if (!text) return;
      if (document.activeElement) document.activeElement.blur();
      dispatch('guess', { text, at: v.cur.key });
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

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.NE_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  requestAnimationFrame(timerLoop);
  autoResume();

  // für Tests
  window.NEApp = { ui, render: renderNow, actions };
})();
