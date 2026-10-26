/*
 * Oberfläche von „Pi mal Daumen“.
 *  - Laptop („Bühne“): Spiel anlegen, Lobby mit QR-Code, Fragen, Reihum-Eingabe, Zahlenstrahl, Punktestand
 *  - Handy (Mitspieler): Team wählen, geheim schätzen, eigenes Ergebnis
 * Gerendert wird per HTML-String + morphdom (nur geänderte Teile werden ersetzt).
 */
(function () {
  'use strict';

  const { TEAMS, QUESTION_OPTIONS, SECONDS_OPTIONS, HIT_BONUS, MAX_TEXT, MAX_PLAYERS, Engine, sanitizeSettings } = window.PMDEngine;
  const { StageController, ClientController, Store, KEYS, Net, inviteLink, qrSvg } = window.PMDControllers;
  const { Sound, confetti } = window.GameFx;
  const N = window.PMDNumbers;
  const Deck = window.PMDDeck;

  const INPUT = {
    write: { icon: '✍️', label: 'Mit Handy', text: 'Alle verbinden ihr Handy per QR-Code und tippen ihre Schätzung geheim ein. Alle gleichzeitig.' },
    say: { icon: '🗣️', label: 'Ohne Handy', text: 'Reihum: Die Teams nennen ihre Schätzung nacheinander laut, jede Zahl nur einmal. Am Laptop wird eingetragen.' },
  };
  const SCORING = {
    rank: { label: '🏁 Rang', text: `Für jedes Team, das weiter weg liegt, gibt es 1 Punkt. Höchstens 1 % daneben (Jahreszahlen: genau) = Volltreffer +${HIT_BONUS}.` },
    accuracy: { label: '📏 Genauigkeit', text: 'Punkte nur nach eigener Abweichung: ≤ 1 % = 5 · ≤ 5 % = 4 · ≤ 10 % = 3 · ≤ 25 % = 2 · ≤ 50 % = 1.' },
  };
  const TEAM_INPUT = {
    shared: { label: '🤝 Gemeinsam', text: 'Ein gemeinsames Feld pro Team – alle sehen die Zahl live, eine/r legt fest.' },
    median: { label: '🧮 Median', text: 'Jede/r schätzt geheim, der Median des Teams zählt.' },
  };
  const MULTS = [
    ['Tsd', 'Tsd'],
    ['Mio', 'Mio'],
    ['Mrd', 'Mrd'],
  ];
  const SETUP_KEY = 'pimaldaumen.setup.v1';
  const PREFS_KEY = 'pimaldaumen.prefs.v1';
  const ACTIVE_KEY = 'pimaldaumen.active';
  const RESUME_MAX_AGE = 12 * 60 * 60 * 1000;
  const DRAFT_MS = 250;

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

  function who(v) {
    return v.settings.solo ? { one: 'Person', many: 'Personen' } : { one: 'Team', many: 'Teams' };
  }

  /** Platzierungen mit geteilten Plätzen bei Gleichstand */
  function places(v) {
    return v.ranking.map((id) => {
      const t = teamOf(v, id);
      const better = v.ranking.filter((o) => teamOf(v, o).score > t.score).length;
      return { team: t, place: better + 1 };
    });
  }

  /** Eingetippte Zahl als Vorschau: „= 1,5 Millionen m“ */
  function previewText(text, unit) {
    if (!String(text || '').trim()) return '';
    const n = N.parse(text);
    if (n == null) return '<span class="np-bad">⚠️ Keine gültige Zahl</span>';
    const w = N.isYear(unit) ? null : N.words(n);
    return `= <b>${esc(N.withUnit(n, unit))}</b>${w ? ` <small>(${esc(w)})</small>` : ''}`;
  }

  /** Multiplikator-Knopf: „1,5“ + Mio → „1,5 Mio“ (ein vorhandener wird ersetzt) */
  function applyMult(text, mult) {
    const base = String(text || '')
      .replace(/\s*(tsd|tausend|k|mio|mill|millionen?|mrd|mia|milliarden?)\.?\s*$/i, '')
      .trim();
    return (base || '1') + ' ' + mult;
  }

  /** Zeitplan der Aufdeck-Animation (Sekunden) */
  function revealTiming(n) {
    const first = 0.4;
    const step = 0.45;
    const answer = first + n * step + 0.8;
    return { first, step, answer, list: answer + 0.6, total: (answer + 0.9) * 1000 };
  }

  function questionUnitHint(q) {
    if (N.isYear(q.unit)) return 'Jahreszahl';
    if (q.kind === 'uns') return q.agg === 'count' ? 'Anzahl Personen' : q.unit ? `Summe in ${q.unit}` : 'Summe';
    return q.unit ? `Einheit: ${q.unit}` : 'Anzahl';
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
    inputError: null,
    modal: null,
    confirm: null,
    toast: null,
    flash: null,
    draft: '', // Schätzung auf dem Handy
    editing: false, // tippt gerade jemand ins Schätzfeld?
    ownDraft: '', // „Über uns“: eigene Antwort
    sayDraft: '', // Laptop, Reihum
    countDraft: '', // Laptop, „Über uns“ durchgezählt
    hold: null, // Punktestand während der Aufdeck-Animation noch nicht umspringen lassen
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
    const key = (x) => (x && x.cur ? `${x.cur.no}-${x.cur.qNo}` : null);
    if (key(prev) !== key(v)) {
      ui.draft = '';
      ui.ownDraft = '';
      ui.sayDraft = '';
      ui.countDraft = '';
      ui.inputError = null;
      ui.editing = false;
    }
    // Gemeinsames Feld: Was das Team getippt hat, übernehmen – außer man tippt gerade selbst
    if (v.cur && v.cur.mine && v.teamInput === 'shared' && !ui.editing) ui.draft = v.cur.mine.text || '';
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
    if (!pc || pc.no !== c.no || pc.qNo !== c.qNo) {
      Sound.start();
      return;
    }
    // Joker gesetzt?
    for (const id of c.jokers) {
      if (!pc.jokers.includes(id) && (stage || id === v.me.team)) {
        const t = teamOf(v, id);
        Sound.success();
        if (stage) flash(`🃏 ${t.name} setzt den Joker!`, t.color);
      }
    }
    if (stage && c.said && pc.said && Object.keys(c.said).length > Object.keys(pc.said).length) Sound.hop();
    if (v.phase === 'reveal' && prev.phase !== 'reveal') revealEffects(v, stage);
  }

  function revealEffects(v, stage) {
    const c = v.cur;
    const ids = c.teams.filter((id) => c.results[id] && c.results[id].value != null);
    const tm = revealTiming(ids.length);
    const hitters = c.teams.filter((id) => c.results[id] && c.results[id].hit);
    if (stage) {
      ui.hold = { key: `${c.no}-${c.qNo}`, until: performance.now() + tm.total };
      setTimeout(render, tm.total + 50);
      ids.forEach((_, i) => setTimeout(() => Sound.hop(), (tm.first + i * tm.step) * 1000));
      // Trommelwirbel bis zur Antwort
      const rollStart = tm.first + ids.length * tm.step;
      for (let t = rollStart; t < tm.answer - 0.05; t += 0.09) setTimeout(() => Sound.tick(false), t * 1000);
      setTimeout(() => {
        Sound.flip();
        if (hitters.length) {
          Sound.success();
          confetti(hitters.map((id) => teamOf(v, id).color).concat('#ffffff'), 160);
        }
      }, tm.answer * 1000);
      return;
    }
    const r = v.me.team && c.results[v.me.team];
    if (!r) return;
    setTimeout(() => {
      if (r.hit) {
        Sound.success();
        confetti([teamOf(v, v.me.team).color, '#ffffff'], 110);
      } else if (r.rank === 1 && c.teams.length > 1) Sound.success();
      else if (r.points === 0) Sound.fail();
      else Sound.flip();
      if (navigator.vibrate) navigator.vibrate(r.hit ? [60, 60, 60] : 60);
    }, tm.list * 1000);
  }

  function holding(v) {
    return !!(ui.hold && v.cur && ui.hold.key === `${v.cur.no}-${v.cur.qNo}` && performance.now() < ui.hold.until);
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
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="Pi mal Daumen">
      <span class="logo-icon" aria-hidden="true">👍</span>
      <span class="logo-text"><span class="l1">Pi</span> <span class="l2">mal Daumen</span></span>
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
    const rows = [];
    rows.push(`
      <div class="setting">
        <div class="setting-label"><b>❓ Fragen</b><small>So viele Fragen hat ein Spiel (bei Gleichstand kommt ein Stechen dazu)</small></div>
        ${seg('questions', QUESTION_OPTIONS, s.questions, (o) => String(o), scope)}
      </div>`);
    if (s.input === 'write') {
      rows.push(`
        <div class="setting">
          <div class="setting-label"><b>⏱ Zeit pro Frage</b><small>Danach wird aufgedeckt – ein angefangener Tipp zählt trotzdem</small></div>
          ${seg('seconds', SECONDS_OPTIONS, s.seconds, (o) => (o ? o + ' s' : 'Aus'), scope)}
        </div>`);
    }
    rows.push(`
      <div class="setting">
        <div class="setting-label"><b>Wertung</b><small>${esc(SCORING[s.scoring].text)}</small></div>
        ${seg('scoring', ['rank', 'accuracy'], s.scoring, (o) => SCORING[o].label, scope)}
      </div>`);
    if (s.input === 'write' && !s.solo) {
      rows.push(`
        <div class="setting">
          <div class="setting-label"><b>Team-Tipp</b><small>${esc(TEAM_INPUT[s.teamInput].text)}</small></div>
          ${seg('teamInput', ['shared', 'median'], s.teamInput, (o) => TEAM_INPUT[o].label, scope)}
        </div>`);
    }
    rows.push(`
      <div class="setting">
        <div class="setting-label"><b>🃏 Joker</b><small>Einmal pro Spiel vor dem Aufdecken einsetzen – die Punkte dieser Frage zählen doppelt</small></div>
        ${switchHtml(s.joker, 'toggle-joker', scope)}
      </div>`);
    return `<div class="settings">${rows.join('')}</div>`;
  }

  function categoriesHtml(s, scope) {
    const st = Deck.stats();
    return `<div class="cats">${Deck.CATEGORIES.map((c) => {
      const on = s.categories.includes(c.id);
      return `<button class="cat-chip ${on ? 'on' : ''} ${c.adult ? 'cat-adult' : ''}" data-act="toggle-cat" data-cat="${c.id}" data-scope="${scope}" aria-pressed="${on}">
        <span>${c.icon}</span> ${esc(c.label)} <small>${st[c.id]}</small>
      </button>`;
    }).join('')}</div>
    <p class="muted small">🫵 <b>Über uns</b>: Fragen über eure Runde („Wie viele Geschwister habt ihr zusammen?“) – die Antwort wird live ermittelt.
      ${s.input === 'write' ? 'Jede/r beantwortet die Frage über sich geheim auf dem Handy.' : 'Nach dem Schätzen wird durchgezählt.'}</p>`;
  }

  function questionCardHtml(q, opts) {
    const o = opts || {};
    const cat = Deck.category(q.cat) || { icon: '❓', label: '' };
    return `<div class="q-card ${o.small ? 'q-small' : ''}" id="q-${esc(q.key)}">
      <div class="q-cat">${cat.icon} ${esc(cat.label)}</div>
      <div class="q-text">${esc(q.text)}</div>
      <div class="q-unit">${esc(questionUnitHint(q))}</div>
    </div>`;
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
    return `<div class="banner banner-hot">⚔️ Stechen! Wer näher dran ist, gewinnt: ${v.cur.teams.map((id) => esc(teamOf(v, id).name)).join(' vs. ')}</div>`;
  }

  /**
   * Zahlenstrahl mit farbigen Nadeln (und der Antwort, wenn aufgedeckt).
   * @param {string} id eindeutige Kennung (Animationen starten nur bei neuen Elementen)
   * @param {{key: string, color: string, name: string, value: number}[]} items
   * @param {number|null} answer
   * @param {string} unit
   * @param {{animate?: boolean}} [opts]
   */
  function numberLineHtml(id, items, answer, unit, opts) {
    const o = opts || {};
    const list = items.filter((i) => Number.isFinite(i.value)).sort((a, b) => a.value - b.value);
    const vals = list.map((i) => i.value);
    if (answer != null) vals.push(answer);
    if (!vals.length) {
      return `<div class="nline nline-empty" style="--lanes:1"><div class="nline-track"><div class="nline-axis"></div></div><p class="muted small center">Noch keine Schätzung</p></div>`;
    }
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const log = min > 0 && max / min >= 50;
    const f = log ? Math.log : (x) => x;
    let lo = f(min);
    let hi = f(max);
    if (hi - lo < 1e-9) {
      const pad = log ? 0.1 : Math.abs(min) * 0.1 || 1;
      lo -= pad;
      hi += pad;
    }
    const pos = (x) => 6 + (88 * (f(x) - lo)) / (hi - lo);
    // Beschriftungen auf mehrere Ebenen verteilen, damit sie sich nicht überlappen
    const dense = list.length > 6;
    const gap = dense ? 8 : 12;
    const lanes = [];
    const tm = revealTiming(list.length);
    const pins = list.map((it, i) => {
      const p = pos(it.value);
      let lane = lanes.findIndex((end) => p - end >= gap);
      if (lane < 0) lane = lanes.length < 8 ? lanes.length : lanes.indexOf(Math.min(...lanes));
      lanes[lane] = p;
      const delay = o.animate ? tm.first + i * tm.step : 0;
      return `<div class="pin ${it.hl ? 'is-hl' : ''}" id="${id}-p-${esc(it.key)}" style="left:${p.toFixed(2)}%;${tc(it.color)};--lane:${lane};--d:${delay.toFixed(2)}s">
        <div class="pin-label"><b>${esc(N.format(it.value, unit))}</b><small>${esc(it.name)}</small></div>
        <div class="pin-stem"></div><div class="pin-dot"></div>
      </div>`;
    });
    const ans =
      answer != null
        ? `<div class="pin-answer" id="${id}-a" style="left:${pos(answer).toFixed(2)}%;--d:${(o.animate ? tm.answer : 0).toFixed(2)}s">
            <span class="pin-arrow">▲</span><b>${esc(N.withUnit(answer, unit))}</b>
          </div>`
        : '';
    return `<div class="nline ${o.animate ? 'animate' : ''} ${answer != null ? 'has-answer' : ''} ${dense ? 'is-dense' : ''}" style="--lanes:${Math.max(1, lanes.length)}">
      <div class="nline-track"><div class="nline-axis"></div>${pins.join('')}${ans}</div>
      ${log ? '<p class="nline-note">logarithmische Skala – die Zahlen liegen sehr weit auseinander</p>' : ''}
    </div>`;
  }

  function diffText(r, unit) {
    if (r.value == null) return 'kein Tipp';
    if (r.dir === 'exact') return '🎯 genau richtig!';
    const d = N.distance(r.diff, unit);
    return `${d} ${r.dir === 'over' ? 'zu hoch' : 'zu niedrig'}`;
  }

  function pointsDetail(r) {
    const parts = [];
    if (r.bonus) parts.push(`🎯 +${r.bonus}`);
    if (r.joker) parts.push('🃏 ×2');
    return parts.length ? `<small>${parts.join(' · ')}</small>` : '';
  }

  function resultsHtml(v, delay) {
    const c = v.cur;
    const unit = c.q.unit;
    const ids = c.teams.slice().sort((a, b) => {
      const ra = c.results[a];
      const rb = c.results[b];
      if (ra.rank == null) return 1;
      if (rb.rank == null) return -1;
      return ra.rank - rb.rank;
    });
    return `<div class="results">${ids
      .map((id, i) => {
        const t = teamOf(v, id);
        const r = c.results[id];
        const members =
          r.members && r.members.length > 1
            ? `<div class="res-members">Einzeltipps: ${r.members
                .slice()
                .sort((a, b) => a.value - b.value)
                .map((m) => `${esc(m.name)} <b>${esc(N.format(m.value, unit))}</b>`)
                .join(' · ')}</div>`
            : '';
        return `<div class="res-row ${r.hit ? 'is-hit' : ''} ${r.rank === 1 && c.teams.length > 1 ? 'is-best' : ''}" style="${tc(t.color)};--d:${(delay + i * 0.12).toFixed(2)}s">
          <span class="res-rank">${r.rank ? r.rank + '.' : '–'}</span>
          <span class="team-dot"></span>
          <div class="res-main">
            <div class="res-line"><b class="res-name">${esc(t.name)}</b><span class="res-val">${r.value != null ? esc(N.withUnit(r.value, unit)) : '—'}</span></div>
            <div class="res-diff">${r.hit && r.dir !== 'exact' ? '🎯 Volltreffer · ' : ''}${esc(diffText(r, unit))}</div>
            ${members}
          </div>
          <div class="res-pts"><b>+${r.points}</b>${pointsDetail(r)}</div>
        </div>`;
      })
      .join('')}</div>`;
  }

  function factHtml(q, delay) {
    if (!q.fact) return '';
    return `<div class="fact" style="--d:${delay.toFixed(2)}s">💡 ${esc(q.fact)}</div>`;
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
    return `
    <div class="screen home">
      <a class="btn btn-ghost btn-small hub-back" href="../">← Alle Spiele</a>
      <div class="home-hero">
        ${logoHtml()}
        <p class="tagline">Keiner weiß es genau – wer schätzt am besten?</p>
      </div>
      ${resume.join('')}
      <div class="mode-cards">
        <button class="mode-card mode-stage" data-act="new-game">
          <span class="mode-icon">💻</span>
          <span class="mode-body"><b>Spiel anlegen</b><small>Am Laptop, Tablet oder Fernseher: Er zeigt die Fragen, das Aufdecken auf dem Zahlenstrahl und den Punktestand.</small></span>
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
      <p class="home-foot">${Deck.stats().total} Schätzfragen in ${Deck.CATEGORIES.length} Kategorien · mit oder ohne Handys</p>
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
              <p class="muted small">${st.input === 'write' ? 'Die Spieler treten mit dem Handy bei.' : 'Das Team berät sich und nennt eine Zahl.'}</p>
            </div>`;
        })
        .join('');
      people = `<h2>Teams <small class="muted">(1–4)</small></h2><div class="team-grid">${teams}</div>`;
    } else if (st.input === 'say') {
      const rows = s.players
        .map(
          (p, pi) => `
          <div class="player-row" style="${tc(window.PMDEngine.SOLO_COLORS[pi % 12])}">
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
          <div class="setting-label"><b>Wer schätzt?</b><small>${st.solo ? 'Jede Person spielt für sich und hat eine eigene Farbe.' : 'Die Teams beraten sich und geben eine gemeinsame Schätzung ab.'}</small></div>
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
        <button class="btn btn-primary btn-big" data-act="create-game">${st.input === 'write' ? 'Raum öffnen 📱' : 'Spiel starten 👍'}</button>
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
    else if (v.round) round = `<span class="pill">Frage ${v.round} / ${v.questions}</span>`;
    const cat = v.cur && Deck.category(v.cur.q.cat);
    const room = v.room && v.room.code && v.phase !== 'lobby' ? `<button class="pill pill-room" data-act="show-qr" title="Mitspieler einladen">📱 ${esc(v.room.code)}</button>` : '';
    return `
      <header class="topbar">
        <button class="topbar-brand" data-act="menu" aria-label="Menü">${logoHtml(true)}</button>
        <div class="topbar-info">
          ${cat && v.phase !== 'over' ? `<span class="pill">${cat.icon} ${esc(cat.label)}</span>` : ''}
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
    // Während der Aufdeck-Animation noch den alten Punktestand zeigen
    const held = v.phase === 'reveal' && holding(v);
    const score = (id) => {
      const t = teamOf(v, id);
      const r = held && v.cur.results && v.cur.results[id];
      return t.score - (r ? r.points : 0);
    };
    const max = Math.max(1, ...ids.map(score));
    const lead = Math.max(...ids.map(score));
    const turn = v.cur && v.cur.team;
    return `
      <footer class="scoreboard ${ids.length > 6 ? 'is-many' : ''}" aria-label="Punktestand">
        ${ids
          .map((id) => {
            const t = teamOf(v, id);
            const sc = score(id);
            const playing = !v.cur || v.cur.teams.includes(id);
            const joker = v.settings.joker ? (t.jokerUsed ? '' : ' <span class="joker-left" title="Joker noch da">🃏</span>') : '';
            return `
            <div class="score ${turn === id ? 'is-turn' : ''} ${playing ? '' : 'is-out'}" style="${tc(t.color)}">
              <div class="score-head"><span class="team-dot"></span><b>${esc(t.name)}</b>${sc === lead && lead > 0 && ids.length > 1 ? ' 👑' : ''}${joker}</div>
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
    else if (v.phase === 'count') main = countStageHtml(v);
    else main = v.settings.input === 'write' ? questionWriteStage(v) : questionSayStage(v);
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
            <button class="btn btn-primary btn-big" data-act="start" ${v.lobbyProblem ? 'disabled' : ''}>Spiel starten 👍</button>
            ${v.lobbyProblem ? `<p class="muted small center">${esc(v.lobbyProblem)}</p>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ---------- Frage – mit Handy ---------- */

  function unsBannerHtml(q, phone) {
    if (q.kind !== 'uns') return '';
    const target = q.agg === 'count' ? 'wie viele von euch allen „Ja“ sagen' : 'die Summe von euch allen';
    return `<div class="banner banner-uns">🫵 ${phone ? 'Beantworte' : 'Jede/r beantwortet'} ${phone ? '' : 'geheim auf dem Handy'}: <b>„${esc(q.ask)}“</b><small>Dann schätzt ihr ${target}.</small></div>`;
  }

  function questionWriteStage(v) {
    const c = v.cur;
    const teams = c.teams
      .map((id) => {
        const t = teamOf(v, id);
        const st = c.status[id];
        const pids = c.participants[id] || [];
        let body;
        if (v.teamInput === 'median') {
          body = `<div class="pstats">${pids
            .map((pid) => {
              const done = st.voted.includes(pid);
              const on = isOnline(v, pid);
              return `<span class="pstat ${done ? 'done' : ''} ${on ? '' : 'off'}">${done ? '✓' : on ? '💭' : '📴'} ${esc(playerName(v, pid))}</span>`;
            })
            .join('')}</div>`;
        } else {
          body = st.locked
            ? '<div class="tstat-state done">✓ Festgelegt</div>'
            : st.typing
              ? '<div class="tstat-state typing">✍️ tippt …</div>'
              : '<div class="tstat-state">💭 überlegt …</div>';
        }
        const joker = c.jokers.includes(id) ? '<span class="joker-badge">🃏 Joker!</span>' : '';
        return `
          <div class="tstat ${st.locked ? 'is-done' : ''}" style="${tc(t.color)}">
            <h3><span class="team-dot"></span>${esc(t.name)}${joker}</h3>
            ${body}
          </div>`;
      })
      .join('');
    const allPids = c.teams.flatMap((id) => c.participants[id] || []);
    return `
      <div class="center-stage">
        ${tiebreakBanner(v)}
        ${questionCardHtml(c.q)}
        ${unsBannerHtml(c.q)}
        ${timerHtml(c.timer, true)}
        <p class="hint center">${c.q.kind === 'uns' ? '' : v.settings.solo ? 'Alle tippen ihre Schätzung geheim ins Handy …' : 'Beratet euch und tippt eure Schätzung ins Handy …'}</p>
        <div class="tstats">${teams}</div>
        ${c.q.kind === 'uns' ? `<p class="muted center">🫵 Antworten über euch: <b>${c.ownDone.length} / ${allPids.length}</b></p>` : ''}
        <div class="stage-actions">
          <button class="btn btn-ghost btn-small" data-act="skip">🔀 Andere Frage</button>
          <button class="btn btn-ghost btn-small" data-act="finish-round">⏩ Jetzt aufdecken</button>
        </div>
      </div>`;
  }

  /* ---------- Frage – ohne Handy (reihum) ---------- */

  function saidItems(v) {
    const c = v.cur;
    return Object.entries(c.said || {}).map(([id, value]) => {
      const t = teamOf(v, id);
      return { key: id, color: t.color, name: t.name, value };
    });
  }

  function saidListHtml(v) {
    const c = v.cur;
    return `<div class="said-list">${c.queue
      .map((id, i) => {
        const t = teamOf(v, id);
        const val = c.said[id];
        const now = i === c.idx && c.team === id;
        const joker = v.settings.joker && !c.tiebreak;
        const jOn = c.jokers.includes(id);
        const jBtn = joker
          ? `<button class="joker-btn ${jOn ? 'on' : ''}" data-act="joker" data-team="${id}" ${t.jokerUsed && !jOn ? 'disabled' : ''} title="${jOn ? 'Joker zurücknehmen' : t.jokerUsed ? 'Joker schon verbraucht' : 'Joker einsetzen (Punkte ×2)'}">🃏${jOn ? ' ×2' : ''}</button>`
          : '';
        return `<div class="said ${now ? 'is-now' : ''} ${val != null ? 'is-done' : ''}" style="${tc(t.color)}">
          <span class="team-dot"></span><b>${esc(t.name)}</b>
          <span class="said-val">${val != null ? esc(N.withUnit(val, c.q.unit)) : now ? '← ist dran' : '…'}</span>
          ${jBtn}
        </div>`;
      })
      .join('')}</div>`;
  }

  function questionSayStage(v) {
    const c = v.cur;
    const t = c.team ? teamOf(v, c.team) : null;
    const preview = previewText(ui.sayDraft, c.q.unit);
    return `
      <div class="center-stage say-stage" ${t ? `style="${tc(t.color)}"` : ''}>
        ${tiebreakBanner(v)}
        ${questionCardHtml(c.q)}
        ${c.q.kind === 'uns' ? `<div class="banner banner-uns">🫵 Frage an euch alle: <b>„${esc(c.q.ask)}“</b><small>Erst schätzen, dann wird durchgezählt!</small></div>` : ''}
        <div class="say-grid">
          <div class="say-main">
            ${
              t
                ? `<div class="turn-banner" style="${tc(t.color)}"><span class="team-dot"></span><div><b>${esc(t.name)}</b> – ${t.solo ? 'du bist' : 'ihr seid'} dran!<small>Schätzung laut sagen – jede Zahl darf nur einmal vorkommen</small></div></div>
                   <form class="say-form" data-form="say" data-team="${t.id}">
                     <input id="say-input" class="input input-num" type="text" inputmode="decimal" maxlength="${MAX_TEXT}" placeholder="Zahl eintippen" value="${esc(ui.sayDraft)}"
                       data-field="say-num" autocomplete="off" spellcheck="false" enterkeyhint="done" />
                     <div class="num-preview">${preview || '&nbsp;'}</div>
                     <button class="btn btn-primary" type="submit">Eintragen ⏎</button>
                   </form>`
                : ''
            }
            ${saidListHtml(v)}
          </div>
          <div class="say-side">
            ${numberLineHtml(`nl-${c.no}-${c.qNo}`, saidItems(v), null, c.q.unit)}
          </div>
        </div>
        <div class="stage-actions">
          ${c.idx > 0 ? '<button class="btn btn-ghost btn-small" data-act="undo">↩️ Rückgängig</button>' : ''}
          <button class="btn btn-ghost btn-small" data-act="skip">🔀 Andere Frage</button>
        </div>
      </div>`;
  }

  /** „Über uns“ ohne Handy: durchzählen und echte Zahl eintragen */
  function countStageHtml(v) {
    const c = v.cur;
    const q = c.q;
    return `
      <div class="center-stage say-stage">
        ${questionCardHtml(q, { small: true })}
        <div class="banner banner-uns">🫵 Jetzt zählt nach! ${q.agg === 'count' ? 'Hände hoch, wer „Ja“ sagt:' : 'Jede/r sagt laut:'} <b>„${esc(q.ask)}“</b></div>
        ${numberLineHtml(`nl-${c.no}-${c.qNo}`, saidItems(v), null, q.unit)}
        <form class="say-form" data-form="count">
          <label class="label center" for="count-input">Die echte Zahl${q.agg === 'count' ? ' (Anzahl Hände)' : ' (zusammengezählt)'}</label>
          <input id="count-input" class="input input-num" type="text" inputmode="decimal" maxlength="${MAX_TEXT}" placeholder="z.B. 7" value="${esc(ui.countDraft)}"
            data-field="count-num" autocomplete="off" spellcheck="false" enterkeyhint="done" />
          <div class="num-preview">${previewText(ui.countDraft, q.unit) || '&nbsp;'}</div>
          <button class="btn btn-primary btn-big" type="submit">Auflösen 🥁</button>
        </form>
        <div class="stage-actions"><button class="btn btn-ghost btn-small" data-act="undo">↩️ Rückgängig</button></div>
      </div>`;
  }

  /* ---------- Aufdecken ---------- */

  function revealStageHtml(v) {
    const c = v.cur;
    const items = c.teams
      .filter((id) => c.results[id].value != null)
      .map((id) => {
        const t = teamOf(v, id);
        return { key: id, color: t.color, name: t.name, value: c.results[id].value, hl: c.results[id].rank === 1 };
      });
    const tm = revealTiming(items.length);
    const own = c.ownCount ? `<p class="muted small center" style="--d:${tm.list.toFixed(2)}s">🫵 ${c.ownCount.answered} von ${c.ownCount.total} haben über sich geantwortet.</p>` : '';
    const accuracyNote = c.mode === 'accuracy' && v.settings.scoring !== 'accuracy' && !c.tiebreak ? '<p class="muted small center">Nur ein Team dabei – gewertet wird nach Genauigkeit.</p>' : '';
    return `
      <div class="center-stage reveal" id="rv-${c.no}-${c.qNo}">
        ${tiebreakBanner(v)}
        ${questionCardHtml(c.q, { small: true })}
        ${numberLineHtml(`nl-${c.no}-${c.qNo}`, items, c.answer, c.q.unit, { animate: true })}
        <div class="reveal-after" style="--d:${tm.list.toFixed(2)}s">
          ${resultsHtml(v, tm.list)}
          ${factHtml(c.q, tm.list + 0.4)}
          ${own}${accuracyNote}
        </div>
        <button class="btn btn-primary btn-big next-float" style="--d:${tm.list.toFixed(2)}s" data-act="next" data-no="${c.no}">Weiter →</button>
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
    return `
      <div class="center-stage over">
        <h1 class="over-title">${!pl.length ? '🏁 Spiel vorbei' : single ? `👍 ${pl[0].team.score} Punkte!` : v.winners.length > 1 ? `🤝 Unentschieden: ${winnerNames}` : `🏆 ${winnerNames} ${v.settings.solo ? 'gewinnt' : 'gewinnt'}!`}</h1>
        ${single || !pl.length ? '' : `<div class="podium">${podium}</div>`}
        ${rest.length ? `<div class="summary">${rest.map(({ team, place }) => `<div class="summary-row" style="${tc(team.color)}"><span class="team-dot"></span><b>${place}. ${esc(team.name)}</b><b class="summary-points">${team.score}</b></div>`).join('')}</div>` : ''}
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
    if (v.phase === 'lobby') body = phoneLobbyHtml(v, t);
    else if (v.phase === 'over') body = phoneOverHtml(v);
    else if (!t || !v.order.includes(t.id) || !v.cur.teams.includes(t.id)) body = phoneSpectatorHtml(v, t);
    else if (v.phase === 'reveal') body = phoneRevealHtml(v, t);
    else body = phoneQuestionHtml(v, t);
    // Spielleitung am Handy: Falls die Bühne ein Fernseher ist, kann das erste Handy weiterschalten
    if (v.phase === 'reveal' && me.lead) {
      body += `<button class="btn btn-primary btn-big btn-wide phone-next" data-act="next" data-no="${v.cur.no}">Nächste Frage →<small>Du bist die Spielleitung</small></button>`;
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
      join = `<button class="btn btn-primary btn-wide" data-act="join-team" data-team="me">🙋 Mitspielen (ab der nächsten Frage)</button>`;
    } else if (canJoin) {
      join = `<p class="center">Einem Team beitreten (ab der nächsten Frage dabei):</p>
        <div class="team-pick">${v.order
          .map((id) => teamOf(v, id))
          .map((x) => `<button class="team-btn" style="${tc(x.color)}" data-act="join-team" data-team="${x.id}"><b>${esc(x.name)}</b></button>`)
          .join('')}</div>`;
    }
    const why = !t ? 'Du schaust gerade zu.' : v.cur && v.cur.tiebreak ? 'Stechen – ihr seid diesmal nicht dabei.' : 'Ihr seid ab der nächsten Frage dabei.';
    return `
      ${v.cur ? questionCardHtml(v.cur.q, { small: true }) : ''}
      <div class="look-up">👀<b>Schau auf den Laptop!</b><small>${why}</small></div>
      ${join}`;
  }

  function numberFormHtml(opts) {
    const o = opts;
    return `
      <form class="num-form" data-form="${o.form}">
        ${o.label ? `<label class="label center" for="${o.id}">${o.label}</label>` : ''}
        <input id="${o.id}" class="input input-num" type="text" inputmode="decimal" maxlength="${MAX_TEXT}" placeholder="${esc(o.placeholder)}" value="${esc(o.value)}"
          data-field="${o.field}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="send" />
        ${o.note ? `<div class="num-note">${o.note}</div>` : ''}
        <div class="num-preview">${previewText(o.value, o.unit) || '&nbsp;'}</div>
        ${
          o.mults
            ? `<div class="mults">${MULTS.map(([label, word]) => `<button type="button" class="btn btn-small btn-ghost" data-act="mult" data-mult="${word}" data-field="${o.field}">${label}</button>`).join('')}</div>`
            : ''
        }
        ${ui.inputError && o.errors ? `<div class="word-error">${esc(ui.inputError)}</div>` : ''}
        <button class="btn btn-primary btn-big btn-wide" type="submit">${o.button}</button>
      </form>`;
  }

  function phoneJokerHtml(v, t) {
    const c = v.cur;
    if (!v.settings.joker || c.tiebreak) return '';
    if (c.jokers.includes(t.id)) {
      return `<button class="btn joker-phone on btn-wide" data-act="joker">🃏 Joker aktiv – Punkte ×2 <small>Tippen zum Zurücknehmen</small></button>`;
    }
    if (t.jokerUsed) return `<p class="muted small center">🃏 Euer Joker ist schon verbraucht.</p>`;
    return `<button class="btn joker-phone btn-wide" data-act="joker">🃏 Joker einsetzen <small>Punkte dieser Frage ×2 – nur einmal pro Spiel</small></button>`;
  }

  function phoneQuestionHtml(v, t) {
    const c = v.cur;
    const q = c.q;
    const mine = c.mine;
    if (!mine || !mine.participant) {
      return `${questionCardHtml(q, { small: true })}<div class="look-up">⏳<b>Du bist ab der nächsten Frage dabei.</b></div>`;
    }
    const parts = [questionCardHtml(q), timerHtml(c.timer, true)];
    // „Über uns“: zuerst die eigene Antwort
    if (q.kind === 'uns') {
      if (mine.own == null) {
        parts.push(`<div class="banner banner-uns">🫵 Erst über dich – geheim: <b>„${esc(q.ask)}“</b></div>`);
        if (q.agg === 'count') {
          parts.push(`<div class="yesno">
            <button class="btn btn-ok btn-big" data-act="own" data-yes="1">👍 Ja</button>
            <button class="btn btn-bad btn-big" data-act="own" data-yes="0">👎 Nein</button>
          </div>`);
        } else {
          parts.push(
            numberFormHtml({ form: 'own', id: 'own-input', field: 'own', value: ui.ownDraft, placeholder: 'Deine Zahl', unit: q.unit, button: 'Antworten ✓', errors: true })
          );
        }
        return parts.join('');
      }
      const ownText = q.agg === 'count' ? (mine.own ? 'Ja' : 'Nein') : N.withUnit(mine.own, q.unit);
      parts.push(`<div class="own-done">🫵 Deine Antwort: <b>${esc(ownText)}</b> <button class="btn btn-link btn-small" data-act="unown">ändern</button></div>`);
      parts.push(`<p class="center small muted">Und jetzt: ${q.agg === 'count' ? 'Wie viele von euch allen sagen „Ja“?' : 'Wie groß ist die Summe von euch allen?'}</p>`);
    }
    const unit = q.unit;
    const others = c.teams
      .filter((id) => id !== t.id && !c.status[id].locked)
      .map((id) => esc(teamOf(v, id).name));
    const waiting = `<p class="waiting">${others.length ? `⏳ Warte auf ${others.join(', ')} …` : '⏳ Gleich wird aufgedeckt …'}</p>`;
    if (v.teamInput === 'median') {
      if (mine.vote != null) {
        const pids = c.participants[t.id] || [];
        const open = pids.filter((pid) => !c.status[t.id].voted.includes(pid) && isOnline(v, pid)).map((pid) => esc(playerName(v, pid)));
        parts.push(`
          <div class="submitted"><small>Dein Tipp</small><b>${esc(N.withUnit(mine.vote, unit))}</b>
            <button class="btn btn-ghost btn-small" data-act="unlock">✏️ Ändern</button></div>
          <p class="waiting">${open.length ? `⏳ Warte auf ${open.join(', ')} …` : others.length ? `⏳ Warte auf ${others.join(', ')} …` : '⏳ Gleich wird aufgedeckt …'}</p>`);
      } else {
        parts.push(
          numberFormHtml({
            form: 'guess',
            id: 'guess-input',
            field: 'guess',
            value: ui.draft,
            placeholder: 'Deine Schätzung',
            unit,
            mults: !N.isYear(unit),
            errors: true,
            note: 'Jede/r schätzt geheim – der Median eures Teams zählt.',
            button: 'Festlegen ✓',
          })
        );
      }
    } else if (mine.locked) {
      parts.push(`
        <div class="submitted"><small>${t.solo ? 'Dein Tipp' : 'Euer Tipp'}</small><b>${esc(N.withUnit(mine.value, unit))}</b>
          ${!t.solo && mine.by ? `<small class="by">festgelegt von ${mine.byMe ? 'dir' : esc(mine.by)}</small>` : ''}
          <button class="btn btn-ghost btn-small" data-act="unlock">✏️ Ändern</button></div>
        ${waiting}`);
    } else {
      const typing = !t.solo && mine.text && mine.by && !mine.byMe ? `✍️ ${esc(mine.by)} tippt …` : t.solo ? '' : 'Gemeinsames Feld – alle im Team sehen, was hier steht.';
      parts.push(
        numberFormHtml({
          form: 'guess',
          id: 'guess-input',
          field: 'guess',
          value: ui.draft,
          placeholder: t.solo ? 'Deine Schätzung' : 'Eure Schätzung',
          unit,
          mults: !N.isYear(unit),
          errors: true,
          note: typing,
          button: 'Festlegen ✓',
        })
      );
    }
    parts.push(phoneJokerHtml(v, t));
    return parts.join('');
  }

  function phoneRevealHtml(v, t) {
    const c = v.cur;
    const r = c.results[t.id];
    const n = c.teams.filter((id) => c.results[id].value != null).length;
    const tm = revealTiming(n);
    const unit = c.q.unit;
    let headline;
    if (r.value == null) headline = '😶 Kein Tipp abgegeben';
    else if (r.hit) headline = r.dir === 'exact' ? '🎯 Genau richtig!' : '🎯 Volltreffer!';
    else if (r.rank === 1 && c.teams.length > 1) headline = '🥇 Am nächsten dran!';
    else headline = c.teams.length > 1 ? `Platz ${r.rank}` : '📏 Gar nicht schlecht';
    return `
      ${questionCardHtml(c.q, { small: true })}
      <div class="look-up small phone-look" style="--d:${tm.list.toFixed(2)}s">👀 Schau auf den Laptop!</div>
      <div class="phone-result" style="--d:${tm.list.toFixed(2)}s">
        <div class="pr-answer"><small>Antwort</small><b>${esc(N.withUnit(c.answer, unit))}</b></div>
        <div class="pr-head">${headline}</div>
        ${r.value != null ? `<div class="pr-line">${t.solo ? 'Du' : 'Ihr'}: <b>${esc(N.withUnit(r.value, unit))}</b> · ${esc(diffText(r, unit))}</div>` : ''}
        <div class="pr-points">+${r.points} ${plural(r.points, 'Punkt', 'Punkte')} ${pointsDetail(r)}</div>
        ${c.q.fact ? `<div class="fact">💡 ${esc(c.q.fact)}</div>` : ''}
      </div>`;
  }

  function phoneOverHtml(v) {
    const pl = places(v);
    const mine = pl.find((p) => p.team.id === v.me.team);
    let head = '<div class="look-up">🏁<b>Spiel vorbei!</b></div>';
    if (mine) {
      head =
        mine.place === 1
          ? `<div class="look-up win">🏆<b>${v.winners.length > 1 ? 'Geteilter Sieg!' : mine.team.solo ? 'Du hast gewonnen!' : 'Ihr habt gewonnen!'}</b><small>${mine.team.score} Punkte</small></div>`
          : `<div class="look-up">${mine.place === pl.length ? '🥄' : '🏅'}<b>Platz ${mine.place}</b><small>${mine.team.score} Punkte</small></div>`;
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
    else if (ui.modal === 'qr') {
      body = `<h2>📱 Mitspieler einladen</h2>${roomBoxHtml(ui.view && ui.view.room, false)}
        <p class="muted small center">Wer jetzt beitritt, spielt ab der nächsten Frage mit.</p>
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
        <p>Ein Schätz-Quiz für Teams (oder jede/n für sich). Der <b>Laptop</b> ist die Bühne: Er zeigt die Frage,
          das Aufdecken auf dem Zahlenstrahl und den Punktestand. Nach der eingestellten Zahl an Fragen gewinnt, wer die meisten Punkte hat –
          bei Gleichstand an der Spitze gibt es ein <b>Stechen</b> mit einer Extra-Frage.</p>
        <h3>🏁 Wertung „Rang“</h3>
        <p>Für jedes Team, das weiter weg liegt, gibt es 1 Punkt (bei 4 Teams also 3/2/1/0). Wer höchstens 1 % daneben liegt
          (Jahreszahlen: genau richtig), bekommt einen <b>Volltreffer-Bonus von +${HIT_BONUS}</b>.</p>
        <h3>📏 Wertung „Genauigkeit“</h3>
        <p>Punkte nur nach der eigenen Abweichung: ≤ 1 % = 5 · ≤ 5 % = 4 · ≤ 10 % = 3 · ≤ 25 % = 2 · ≤ 50 % = 1.
          Bei Jahreszahlen: genau = 5 · ≤ 2 Jahre = 4 · ≤ 5 = 3 · ≤ 10 = 2 · ≤ 25 = 1.</p>
        <h3>🃏 Joker</h3>
        <p>Jedes Team hat einen Joker pro Spiel. Vor dem Aufdecken eingesetzt, zählen die Punkte dieser Frage doppelt.</p>
        <h3>🗣️ Ohne Handy – reihum</h3>
        <p>Die Teams nennen ihre Schätzung nacheinander laut, jede Zahl darf nur einmal vorkommen. Wer zuletzt dran ist, kann
          taktisch „knapp drüber“ oder „knapp drunter“ setzen – deshalb fängt jede Frage ein anderes Team an.</p>
        <h3>✍️ Mit Handy</h3>
        <p>Alle scannen den QR-Code. Im Team gibt es entweder ein <b>gemeinsames Feld</b> (alle sehen live, was drinsteht) oder
          jede/r schätzt geheim und der <b>Median</b> zählt. Das Handy, das sich als erstes verbunden hat, ist die <b>Spielleitung</b>
          und kann nach dem Aufdecken weiterschalten – praktisch, wenn die Bühne ein Fernseher ist.</p>
        <h3>🫵 Über uns</h3>
        <p>Manche Fragen drehen sich um eure Runde, z.B. „Wie viele Geschwister habt ihr alle zusammen?“. Mit Handy beantwortet jede/r
          die Frage über sich geheim, ohne Handy wird nach dem Schätzen durchgezählt.</p>
        <h3>Zahlen eingeben</h3>
        <p><code>1.500</code>, <code>1,5 Tsd</code>, <code>2 Mio</code>, <code>3,2 Mrd</code> und <code>753 v. Chr.</code> werden verstanden.</p>
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
      if (write && v.room) items.push(`<button class="menu-item" data-act="show-qr">📱 Mitspieler einladen</button>`);
      if (v.cur && ['question', 'count'].includes(v.phase)) items.push(`<button class="menu-item" data-act="skip">🔀 Andere Frage ziehen</button>`);
      if (v.cur && v.phase === 'question' && write) items.push(`<button class="menu-item" data-act="finish-round">⏩ Jetzt aufdecken</button>`);
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

  let draftTimer = null;
  function sendDraft() {
    clearTimeout(draftTimer);
    draftTimer = null;
    const v = ui.view;
    if (!v || !v.cur || v.teamInput !== 'shared') return;
    dispatch('draft', { text: ui.draft, at: v.me.stepKey });
  }

  function scheduleDraft() {
    if (!draftTimer) draftTimer = setTimeout(sendDraft, DRAFT_MS);
  }

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
      if (['questions', 'seconds'].includes(key)) value = +value;
      if (key === 'solo') value = value === 'solo';
      setSetting(el.dataset.scope, key, value);
    },
    'toggle-joker': (el) => setSetting(el.dataset.scope, 'joker', !scopeSettings(el.dataset.scope).joker),
    'toggle-cat': (el) => {
      const cats = scopeSettings(el.dataset.scope).categories;
      const id = el.dataset.cat;
      const next = cats.includes(id) ? cats.filter((c) => c !== id) : cats.concat(id);
      if (!next.some((c) => c !== 'uns')) {
        toast('Mindestens eine Wissens-Kategorie muss dabei sein.');
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
    undo: () => dispatch('undo'),
    again: () => dispatch('again'),
    joker: (el) => {
      const v = ui.view;
      if (!v || !v.cur) return;
      if (v.me.stage) dispatch('joker', { team: el.dataset.team });
      else dispatch('joker', { at: v.me.stepKey });
    },
    unlock: () => {
      const v = ui.view;
      if (!v || !v.cur || !v.cur.mine) return;
      if (v.teamInput === 'median') ui.draft = v.cur.mine.vote != null ? N.format(v.cur.mine.vote, v.cur.q.unit) : ui.draft;
      ui.focus = '#guess-input';
      dispatch('unlock', { at: v.me.stepKey });
    },
    own: (el) => {
      const v = ui.view;
      if (!v || !v.cur) return;
      dispatch('own', { value: el.dataset.yes === '1', at: v.me.stepKey });
    },
    unown: () => {
      const v = ui.view;
      if (!v || !v.cur || !v.cur.mine) return;
      const own = v.cur.mine.own;
      if (v.cur.q.agg !== 'count' && own != null) ui.ownDraft = N.format(own, v.cur.q.unit);
      dispatch('unown', { at: v.me.stepKey });
    },
    mult: (el) => {
      const field = el.dataset.field;
      if (field === 'guess') {
        ui.draft = applyMult(ui.draft, el.dataset.mult);
        // Ein fokussiertes Feld überspringt morphdom – deshalb direkt setzen
        const input = app.querySelector('#guess-input');
        if (input) input.value = ui.draft;
        sendDraft();
        ui.focus = '#guess-input';
      }
      render();
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
      ui.setup.players[+el.dataset.player] = el.value;
      saveSetup();
    } else if (f === 'name') {
      ui.name = el.value;
    } else if (f === 'join-code') {
      ui.joinCode = Net.cleanCode(el.value);
    } else if (f === 'guess') {
      ui.draft = el.value;
      ui.inputError = null;
      if (ui.view && ui.view.teamInput === 'shared') scheduleDraft();
      render();
    } else if (f === 'own') {
      ui.ownDraft = el.value;
      ui.inputError = null;
      render();
    } else if (f === 'say-num') {
      ui.sayDraft = el.value;
      render();
    } else if (f === 'count-num') {
      ui.countDraft = el.value;
      render();
    }
  });

  app.addEventListener('focusin', (e) => {
    if (e.target.dataset && e.target.dataset.field === 'guess') ui.editing = true;
  });
  app.addEventListener('focusout', (e) => {
    if (e.target.dataset && e.target.dataset.field === 'guess') {
      ui.editing = false;
      if (draftTimer) sendDraft();
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
      if (N.parse(text) == null) {
        ui.inputError = text ? 'Das ist keine gültige Zahl.' : 'Bitte gib eine Zahl ein.';
        render();
        return;
      }
      ui.draft = text;
      clearTimeout(draftTimer);
      draftTimer = null;
      if (document.activeElement) document.activeElement.blur();
      dispatch('lock', { value: text, at: v.me.stepKey });
    } else if (form.dataset.form === 'own') {
      const text = fieldValue('[data-field="own"]');
      const n = N.parse(text);
      if (n == null || n < 0) {
        ui.inputError = 'Bitte gib eine Zahl ab 0 ein.';
        render();
        return;
      }
      if (document.activeElement) document.activeElement.blur();
      dispatch('own', { value: text, at: v.me.stepKey });
    } else if (form.dataset.form === 'say') {
      const text = fieldValue('[data-field="say-num"]');
      const n = N.parse(text);
      if (n == null) {
        toast(text ? 'Das ist keine gültige Zahl.' : 'Bitte die genannte Zahl eintippen.');
        return;
      }
      if (Object.values(v.cur.said).some((x) => Math.abs(x - n) < 1e-9)) {
        toast(`${N.withUnit(n, v.cur.q.unit)} wurde schon genannt – jede Zahl nur einmal!`);
        return;
      }
      ui.sayDraft = '';
      const input = form.querySelector('[data-field="say-num"]');
      if (input) input.value = '';
      ui.focus = '#say-input';
      dispatch('say', { value: text, team: form.dataset.team });
    } else if (form.dataset.form === 'count') {
      const text = fieldValue('[data-field="count-num"]');
      const n = N.parse(text);
      if (n == null || n < 0) {
        toast('Bitte die durchgezählte Zahl eintippen.');
        return;
      }
      if (document.activeElement) document.activeElement.blur();
      dispatch('count', { value: text });
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

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.PMD_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  requestAnimationFrame(timerLoop);
  autoResume();

  // für Tests
  window.PMDApp = { ui, render: renderNow, actions };
})();
