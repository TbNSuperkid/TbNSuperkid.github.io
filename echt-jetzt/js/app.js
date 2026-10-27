/*
 * Oberfläche von „Echt jetzt?“.
 *  - Laptop („Bühne“): Spiel anlegen, Lobby mit QR-Code, Kategorie-Wahl, Frage, Lügen-Fortschritt, Prüfen (Wörterbuch),
 *    alle Karten zum Tippen (vorlesen), Auflösung Karte für Karte, Zwischenstand, Siegerehrung.
 *  - Handy: Kategorie wählen, eigene Lüge schreiben, Karten zusammenlegen (Spielleitung), tippen, 👍 vergeben.
 * Gerendert wird per HTML-String + morphdom (nur geänderte Teile werden ersetzt).
 */
(function () {
  'use strict';

  const E = window.EchtJetztEngine;
  const { MIN_PLAYERS, MAX_PLAYERS, MODE_OPTIONS, LENGTH_OPTIONS, LENGTH_QUESTIONS, LIE_OPTIONS, PICK_OPTIONS, SHOWN_OPTIONS, POINTS, Engine, sanitizeSettings } = E;
  const { StageController, ClientController, Store, KEYS, Net, inviteLink, qrSvg } = window.EchtJetztControllers;
  const { Sound, confetti, synth } = window.GameFx;
  const Speech = window.GameSpeech;
  const Q = window.EchtJetztQuestions;

  const SETUP_KEY = 'echtjetzt.setup.v1';
  const PREFS_KEY = 'echtjetzt.prefs.v1';
  const ACTIVE_KEY = 'echtjetzt.active';
  const REPORTS_KEY = 'echtjetzt.reports.v1';
  const RESUME_MAX_AGE = 12 * 60 * 60 * 1000;
  const MODE_LABEL = { facts: '🧠 Fakten', dict: '📖 Wörterbuch', mixed: '🔀 Gemischt' };
  const LENGTH_LABEL = { short: 'Kurz', normal: 'Normal', long: 'Lang' };
  const REPORT_REASONS = ['❌ Stimmt nicht', '🔗 Quelle kaputt', '😴 Zu leicht', '🤷 Unverständlich'];
  const REVEAL_MIN_MS = { none: 2200, lie: 3200, house: 3200, truth: 3400 };

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

  function tc(color) {
    return `--team:${esc(color || '#ffffff')}`;
  }

  function player(v, pid) {
    return v.players.find((p) => p.id === pid) || null;
  }

  function names(list) {
    const n = list.map((x) => x.name || x);
    if (n.length <= 1) return n.join('');
    return n.slice(0, -1).join(', ') + ' und ' + n[n.length - 1];
  }

  /** Frage mit hübscher Lücke (bleibt mit dem Wort davor in einer Zeile); Wörterbuch: „Was bedeutet …?“ */
  function questionHtml(q) {
    if (!q) return '';
    if (q.kind === 'dict') return `<small class="q-dict-label">Was bedeutet …</small><span class="q-word">${esc(q.text)}</span>`;
    return esc(q.text).replace(/(\S*)\s*___/g, '<span class="nowrap">$1&nbsp;<span class="blank" aria-label="Lücke"></span></span>');
  }

  function questionText(q) {
    return q ? (q.kind === 'dict' ? `Was bedeutet „${q.text}“?` : q.text) : '';
  }

  function catHtml(cat) {
    return cat ? `<span class="pill pill-cat">${cat.icon} ${esc(cat.label)}</span>` : '';
  }

  function defaultSetup() {
    return { settings: sanitizeSettings({}) };
  }

  function loadSetup() {
    const saved = Store.get(SETUP_KEY);
    if (!saved || !saved.settings) return defaultSetup();
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

  function roundLabel(v) {
    if (v.round === v.rounds) return '🏁 Finale';
    return `Runde ${v.round}/${v.rounds - 1}`;
  }

  function questionLabel(v) {
    if (!v.cur || v.cur.final) return '';
    return `Frage ${v.cur.index + 1}/${v.plan[v.round - 1]}`;
  }

  function nextLabel(v) {
    if (v.round >= v.rounds) return 'Zur Siegerehrung 🏆';
    if (v.phase === 'scores') return v.round + 1 === v.rounds ? 'Zum Finale 🏁' : `Runde ${v.round + 1} →`;
    const c = v.cur;
    if (c && c.index + 1 < v.plan[v.round - 1]) return 'Nächste Frage →';
    return 'Zum Zwischenstand 📊';
  }

  function fmtPts(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
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
    focus: null,
    report: null,
    // Handy: Entwurf der eigenen Lüge, ob gerade bearbeitet wird, welcher Tipp-Platz (Finale)
    draft: '',
    draftKey: null,
    editing: false,
    slot: 0,
    autoSent: null,
    // Prüfen: zuerst angetippte Karte
    mergeFrom: null,
    // Bühne: was gerade vorgelesen wird
    spoken: null,
    readIdx: -1,
    revealSpoken: null,
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
  function flash(text, color, big) {
    ui.flash = { text, color, big, id: ++flashNo };
    clearTimeout(ui.flashTimer);
    ui.flashTimer = setTimeout(() => {
      ui.flash = null;
      render();
    }, big ? 2600 : 2200);
  }

  /** Spieleigene Sounds */
  const Fx = {
    /** Tipp abgegeben */
    pop() {
      synth.tone(740, 0, 0.05, { type: 'sine', to: 1100, vol: 0.04 });
    },
    /** Trommelwirbel vor der Wahrheit */
    drum() {
      for (let i = 0; i < 12; i++) synth.noise(0.05, i * 0.06, 0.07 + i * 0.01, 260);
      synth.tone(262, 0.75, 0.3, { type: 'triangle', vol: 0.12 });
      synth.tone(392, 0.85, 0.35, { type: 'triangle', vol: 0.1 });
    },
    /** Reingefallen! – fallender Ton */
    fooled() {
      synth.tone(520, 0, 0.18, { type: 'square', to: 220, vol: 0.05 });
      synth.tone(260, 0.2, 0.2, { type: 'square', to: 130, vol: 0.04 });
    },
    /** Lüge ohne Opfer – kurzes Wusch */
    swish() {
      synth.noise(0.18, 0, 0.05, 1800);
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
    Speech.cancel();
    if (ui.ctrl) ui.ctrl.leave(keepSave);
    ui.ctrl = null;
    ui.token = null;
    ui.view = null;
    ui.modal = null;
    ui.flash = null;
    ui.draft = '';
    ui.draftKey = null;
    ui.editing = false;
    ui.mergeFrom = null;
    ui.spoken = null;
    ui.readIdx = -1;
    ui.revealSpoken = null;
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
    syncLocal(v);
    transitions(prev, v);
    if (v.me.stage) speechEffects(prev, v);
    render();
  }

  /** Entwurf der Lüge und Auswahl zur Frage passend halten */
  function syncLocal(v) {
    const key = v.cur ? v.cur.id : null;
    if (key !== ui.draftKey) {
      ui.draftKey = key;
      ui.draft = '';
      ui.editing = false;
      ui.slot = 0;
      ui.autoSent = null;
      ui.mergeFrom = null;
    }
    if (v.phase === 'lie' && v.cur && v.cur.lie) {
      const l = v.cur.lie;
      if (!ui.draft && (l.mine || l.rejected)) ui.draft = l.mine || l.rejected;
      if (l.rejected) ui.editing = true;
    }
    if (v.phase !== 'check') ui.mergeFrom = null;
    if (v.phase === 'pick' && v.cur && v.cur.pick && v.cur.pick.myPicks) {
      const mp = v.cur.pick.myPicks;
      if (ui.slot > 0 && !mp[0]) ui.slot = 0;
    }
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

  /** Was in der Auflösung gerade aufgedeckt wurde */
  function revealStepCards(r) {
    if (!r || !r.step) return [];
    return r.step.keys.map((k) => r.cards.find((c) => c.key === k)).filter(Boolean);
  }

  /** Sounds, Konfetti und Einblendungen bei Zustandswechseln */
  function transitions(prev, v) {
    const stage = !!v.me.stage;
    if (!prev) return;
    const entered = (phase) => v.phase === phase && (prev.phase !== phase || prev.step !== v.step);
    if (entered('end')) {
      ui.flash = null;
      Sound.fanfare();
      setTimeout(() => confetti(['#22d3ee', '#fb923c', '#facc15', '#ffffff'], 220), 150);
      return;
    }
    if (entered('category')) {
      Sound.flip();
      if (!stage && v.cur.category.mine) vibrate([60, 40, 60]);
      return;
    }
    if (entered('lie')) {
      Sound.start();
      if (!stage) vibrate([60, 40, 60]);
      return;
    }
    if (entered('pick') || entered('check')) {
      Sound.flip();
      if (!stage) vibrate(40);
      return;
    }
    if (entered('scores')) {
      Sound.success();
      return;
    }
    // Ablehnung „zu nah an der Wahrheit“
    if (!stage && v.phase === 'lie' && v.cur.lie.rejected && (!prev.cur || !prev.cur.lie || prev.cur.lie.rejected !== v.cur.lie.rejected)) {
      Sound.fail();
      vibrate(200);
    }
    // Auflösung: neuer Schritt
    if (v.phase === 'reveal' && v.cur && v.cur.reveal) {
      const r = v.cur.reveal;
      const pr = prev.phase === 'reveal' && prev.cur && prev.cur.reveal && prev.cur.id === v.cur.id ? prev.cur.reveal : null;
      const before = pr ? pr.shown : 0;
      if (r.shown > before && r.step) {
        if (stage) {
          if (r.step.kind === 'truth') {
            Fx.drum();
            const truth = revealStepCards(r)[0];
            setTimeout(() => {
              if (truth && truth.pickers.length) {
                Sound.success();
                confetti(['#22c55e', '#facc15', '#ffffff'], 120);
              } else Sound.fail();
            }, 900);
          } else if (r.step.kind === 'none') Fx.swish();
          else Fx.fooled();
        } else {
          const cards = revealStepCards(r);
          const fellForIt = cards.some((c) => !c.truth && c.pickers.some((p) => p.id === v.me.id));
          const mine = cards.some((c) => c.mine && c.pickers.length);
          const right = cards.some((c) => c.truth && c.pickers.some((p) => p.id === v.me.id && !p.second));
          if (right) {
            setTimeout(() => Sound.success(), 900);
            vibrate([80, 40, 80]);
          } else if (mine) {
            Sound.success();
            vibrate([80, 40, 80]);
          } else if (fellForIt) {
            Fx.fooled();
            vibrate(200);
          }
        }
      }
    }
    // Neue Tipps auf der Bühne
    if (stage && v.phase === 'pick' && prev.phase === 'pick' && v.cur.pick.done > prev.cur.pick.done) Fx.pop();
  }

  /** Text, den der Laptop zu einem Auflösungs-Schritt vorliest */
  function revealSpeech(v) {
    const r = v.cur.reveal;
    const cards = revealStepCards(r);
    const kind = r.step.kind;
    if (kind === 'none') return cards.length === 1 ? `Auf ${cards[0].text} ist niemand reingefallen.` : 'Auf diese Antworten ist niemand reingefallen.';
    const c = cards[0];
    if (!c) return '';
    const fell = c.pickers.filter((p) => !p.second);
    if (kind === 'truth') {
      const right = names(fell);
      const hit = c.hits && c.hits.length ? ` ${names(c.hits)} ${c.hits.length === 1 ? 'hat' : 'haben'} sie sogar selbst geschrieben.` : '';
      return `Und die Wahrheit ist: ${c.text}! ${right ? `Richtig lagen ${right}.` : 'Niemand lag richtig.'}${hit}`;
    }
    const who = names(c.pickers);
    if (kind === 'house') return `${c.text}. Reingefallen: ${who}. Das war eine Lüge vom Haus!`;
    return `${c.text}. Reingefallen: ${who}. Geschrieben von ${names(c.authors)}!`;
  }

  /** Bühne: vorlesen (Frage, Karten, Auflösung) und der Engine melden, wann es weitergehen kann */
  function speechEffects(prev, v) {
    const step = v.step;
    const c = v.cur;
    if (!c) return;
    // Lügen: Frage einmal vorlesen (die Zeit läuft trotzdem)
    if (v.phase === 'lie' && v.settings.speech && ui.spoken !== step) {
      ui.spoken = step;
      setTimeout(() => {
        if (ui.view && ui.view.step === step) Speech.say(Q.speakable(c.question));
      }, 600);
      return;
    }
    // Tippen: Frage und alle Karten vorlesen, danach läuft die Zeit
    if (v.phase === 'pick' && v.reading && ui.spoken !== step) {
      ui.spoken = step;
      ui.readIdx = -1;
      const list = [Q.speakable(c.question), ...c.pick.options.map((o) => o.text)];
      const target = c.id;
      setTimeout(() => {
        if (!ui.view || ui.view.step !== step) return;
        Speech.sayAll(list, {
          pause: 300,
          onItem: (i) => {
            ui.readIdx = i;
            render();
          },
        }).then(() => {
          if (ui.view && ui.view.step === step && ui.view.reading) dispatch('read', { target });
        });
      }, 450);
      return;
    }
    // Auflösung: jeden Schritt vorlesen und dann weiter
    if (v.phase === 'reveal' && v.settings.speech && c.reveal && c.reveal.step && !c.reveal.done) {
      const key = `${c.id}:${c.reveal.shown}`;
      if (ui.revealSpoken === key) return;
      ui.revealSpoken = key;
      const shown = c.reveal.shown;
      const kind = c.reveal.step.kind;
      const text = revealSpeech(v);
      const started = performance.now();
      const done = () => {
        const wait = Math.max(0, (REVEAL_MIN_MS[kind] || 2500) - (performance.now() - started));
        setTimeout(() => {
          const now = ui.view;
          if (now && now.phase === 'reveal' && now.cur && now.cur.id === c.id && now.cur.reveal.shown === shown) dispatch('shown', { target: c.id, shown });
        }, wait + 500);
      };
      setTimeout(() => Speech.say(text).then(done), kind === 'truth' ? 1100 : 250);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Handy: Lüge abschicken                                              */
  /* ------------------------------------------------------------------ */

  function sendLie() {
    const v = ui.view;
    if (!v || !v.cur || !v.cur.lie) return;
    const text = String(ui.draft || '').trim();
    if (!text) return;
    dispatch('lie', { target: v.cur.id, text: text.slice(0, v.cur.lie.max) });
    ui.editing = false;
    if (document.activeElement) document.activeElement.blur();
    render();
  }

  /** Zeit um: was getippt, aber nicht abgeschickt ist, noch schnell hinterher */
  function flushDraft() {
    const v = ui.view;
    if (!v || v.me.stage || v.phase !== 'lie' || !v.cur || !v.cur.lie || !v.cur.lie.writing) return;
    const text = String(ui.draft || '').trim();
    if (text && text !== (v.cur.lie.mine || '') && text !== (v.cur.lie.rejected || '')) dispatch('lie', { target: v.cur.id, text: text.slice(0, v.cur.lie.max) });
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
      const label = el.hasAttribute('data-clock') ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : String(sec);
      if (text && text.textContent !== label) text.textContent = label;
      const bar = el.querySelector('[data-timer-bar]');
      if (bar) bar.style.width = (100 * rem) / total + '%';
      el.classList.toggle('urgent', sec <= 10);
      if (el.hasAttribute('data-tick') && el.dataset.last !== String(sec)) {
        if (el.dataset.last && sec <= 5 && sec > 0) Sound.tick(sec <= 3);
        el.dataset.last = String(sec);
      }
    }
    // Handy: Lügenzeit gleich um → Entwurf abschicken
    const v = ui.view;
    if (v && v.phase === 'lie' && !v.me.stage && v.timer && ui.autoSent !== ui.draftKey && v.timer.remaining - elapsed <= 400) {
      ui.autoSent = ui.draftKey;
      flushDraft();
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
    if (ui.flash) html += `<div class="flash ${ui.flash.big ? 'flash-big' : ''}" style="${tc(ui.flash.color)}" id="flash-${ui.flash.id}" role="status">${esc(ui.flash.text)}</div>`;
    html += modalHtml();
    if (ui.toast) html += `<div class="toast" role="status">${esc(ui.toast)}</div>`;
    window.morphdom(app, `<div id="app">${html}</div>`, {
      onBeforeElUpdated(fromEl, toEl) {
        if (fromEl === document.activeElement && (fromEl.tagName === 'INPUT' || fromEl.tagName === 'TEXTAREA')) {
          // Fokussiertes Feld nicht anfassen – nur Klassen und gesperrt übernehmen
          fromEl.className = toEl.className;
          fromEl.disabled = toEl.disabled;
          return false;
        }
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
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="Echt jetzt?">
      <span class="logo-icon" aria-hidden="true">🤥</span>
      <span class="logo-text"><span class="l1">Echt jetzt</span><span class="l2">?</span></span>
    </div>`;
  }

  function seg(key, options, value, fmt, scope, disabled) {
    return `<div class="seg" role="group">${options
      .map(
        (o) =>
          `<button class="seg-btn ${o === value ? 'on' : ''}" data-act="set" data-key="${key}" data-value="${esc(o)}" data-scope="${scope}" aria-pressed="${o === value}" ${disabled ? 'disabled' : ''}>${fmt(o)}</button>`
      )
      .join('')}</div>`;
  }

  function switchHtml(on, key, scope) {
    return `<button class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" data-act="toggle" data-key="${key}" data-scope="${scope}">
      <span class="switch-knob"></span><span class="switch-text">${on ? 'An' : 'Aus'}</span>
    </button>`;
  }

  function settingHtml(title, text, control) {
    return `<div class="setting"><div class="setting-label"><b>${title}</b><small>${text}</small></div>${control}</div>`;
  }

  function settingsHtml(s, scope) {
    const n = LENGTH_QUESTIONS[s.length];
    const rows = [
      settingHtml(
        '🎯 Modus',
        s.mode === 'dict' ? 'Seltene echte Wörter – alle erfinden eine Erklärung' : s.mode === 'mixed' ? 'Kuriose Fakten und ab und zu ein seltenes Wort' : 'Kuriose, echte Fakten mit Lücke',
        seg('mode', MODE_OPTIONS, s.mode, (o) => MODE_LABEL[o], scope)
      ),
      settingHtml('⏱️ Länge', `2 Runden à ${n} Fragen + Finale (${2 * n + 1} Fragen)`, seg('length', LENGTH_OPTIONS, s.length, (o) => LENGTH_LABEL[o], scope)),
      settingHtml('🤥 Zeit zum Lügen', 'Wörterbuch: 15 s mehr', seg('lieTime', LIE_OPTIONS, s.lieTime, (o) => o + ' s', scope)),
      settingHtml('👆 Zeit zum Tippen', 'Wörterbuch: 15 s mehr, Finale: 10 s mehr', seg('pickTime', PICK_OPTIONS, s.pickTime, (o) => o + ' s', scope)),
      settingHtml('🎲 Kategorie wählen', s.chooseCategory ? 'Reihum wählt eine Person aus drei Kategorien' : 'Die Kategorie ist jedes Mal zufällig', switchHtml(s.chooseCategory, 'chooseCategory', scope)),
      settingHtml('👍 Likes', s.likes ? `Nach der Auflösung 👍 für die lustigste Lüge (+${POINTS.like})` : 'Keine Likes', switchHtml(s.likes, 'likes', scope)),
      settingHtml('🃏 Karten auf der Bühne', s.maxShown ? `Höchstens ${s.maxShown} Lügen + Wahrheit (bei vielen Leuten)` : 'Alle Lügen + Wahrheit', seg('maxShown', SHOWN_OPTIONS, s.maxShown, (o) => (o ? o : 'alle'), scope)),
      settingHtml('🗣️ Vorlesen', s.speech ? 'Der Laptop liest Frage, Karten und Auflösung vor – erst danach läuft die Tipp-Zeit' : 'Nur lesen, nichts hören', switchHtml(s.speech, 'speech', scope)),
      settingHtml('🍻 Trinkregeln', 'Auf eine Lüge reingefallen → 1 Schluck pro Lüge · Wahrheit getippt → 1 Schluck verteilen', switchHtml(s.drinks, 'drinks', scope)),
    ];
    return `<div class="settings">${rows.join('')}</div>`;
  }

  function catsHtml(s, scope) {
    const stats = Q.stats();
    const off = s.mode === 'dict';
    const cards = Q.CATEGORIES.map((c) => {
      const on = s.categories.includes(c.id);
      return `<button class="pack-card ${on && !off ? 'on' : ''}" data-act="cat-toggle" data-cat="${c.id}" data-scope="${scope}" aria-pressed="${on}" ${off ? 'disabled' : ''}>
        <b>${c.icon} ${esc(c.label)}</b>
        <small>${esc(c.text)} · ${stats[c.id]}</small>
      </button>`;
    }).join('');
    const facts = s.categories.reduce((a, c) => a + (stats[c] || 0), 0);
    const note = off ? `📖 Nur Wörterbuch: ${stats.woerterbuch} Wörter` : `${facts} Fragen im Topf${s.mode === 'mixed' ? ` + ${stats.woerterbuch} Wörter` : ''}`;
    return `<div class="pack-cards">${cards}</div><p class="muted small">${note}</p>`;
  }

  function timerHtml(timer, opts) {
    if (!timer) return '';
    const o = opts || {};
    const sec = Math.ceil(timer.remaining / 1000);
    const label = o.clock ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : String(sec);
    return `<div class="timer ${o.cls || ''}" data-timer ${o.tick ? 'data-tick' : ''} ${o.clock ? 'data-clock' : ''} data-rem="${Math.round(timer.remaining)}" data-total="${timer.total}">
      <div class="timer-bar"><span data-timer-bar style="width:${(100 * timer.remaining) / (timer.total || 1)}%"></span></div>
      <b data-timer-text>${label}</b>
    </div>`;
  }

  function dotsHtml(n, total) {
    return `<span class="dots" aria-label="${n} von ${total}">${Array.from({ length: total }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
  }

  function personChip(p, extra, cls) {
    return `<span class="voter ${cls || ''}" style="${tc(p.color)}"><span class="team-dot"></span>${esc(p.name)}${extra || ''}</span>`;
  }

  function sipsHtml(v, sips, forMe) {
    if (!sips) return '';
    const list = Object.entries(sips.sips || {}).filter(([pid]) => !forMe || pid === forMe);
    const give = (sips.give || []).filter((g) => !forMe || g.pid === forMe);
    if (!list.length && !give.length) return '';
    const name = (pid) => (forMe === pid ? 'Du' : esc((player(v, pid) || {}).name || '?'));
    const parts = list.map(([pid, n]) => `<b>${name(pid)}</b> ${forMe === pid ? 'trinkst' : 'trinkt'} ${n} ${plural(n, 'Schluck', 'Schlucke')}`);
    for (const g of give) parts.push(`<b>${name(g.pid)}</b> ${forMe === g.pid ? 'verteilst' : 'verteilt'} ${g.n} ${plural(g.n, 'Schluck', 'Schlucke')}`);
    return `<p class="drink">🍻 ${parts.join(' · ')}</p>`;
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
            <small>${st.phase === 'lobby' ? 'Lobby' : `Runde ${st.round} · ${esc(st.players.map((p) => p.name).join(' · '))}`}</small></button>
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
    const st = Q.stats();
    return `
    <div class="screen home">
      <a class="btn btn-ghost btn-small hub-back" href="../">← Alle Spiele</a>
      <div class="home-hero">
        ${logoHtml()}
        <p class="tagline">Eine kuriose, echte Frage – und alle lügen, was das Zeug hält.<br /><small>Wer erkennt die Wahrheit? Wer legt die anderen am besten herein?</small></p>
        <div class="home-example" aria-hidden="true">
          <p class="home-prompt">${questionHtml({ kind: 'fact', text: 'Die Kettensäge wurde ursprünglich für die ___ erfunden.' })}</p>
          <div class="home-cards"><span class="mini-card">Eisernte</span><span class="mini-card">Geburtshilfe</span><span class="mini-card">Schafschur</span></div>
        </div>
      </div>
      ${resume.join('')}
      <div class="mode-cards">
        <button class="mode-card mode-stage" data-act="new-game">
          <span class="mode-icon">💻</span>
          <span class="mode-body"><b>Spiel anlegen</b><small>Am Laptop oder Fernseher: Fragen, Karten, Auflösung und Punkte.</small></span>
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
        <button class="btn btn-link" data-act="show-reports">📋 Gemeldete Fragen</button>
      </div>
      <p class="home-foot">${MIN_PLAYERS}–${MAX_PLAYERS} Personen · Laptop + Handys · ${st.facts} Fragen · ${st.woerterbuch} Wörter</p>
    </div>`;
  }

  /* ---------- Spiel anlegen (Laptop) ---------- */

  function setupHtml() {
    const st = ui.setup.settings;
    return `
    <div class="screen setup">
      <header class="screen-head">
        <button class="btn btn-ghost btn-small" data-act="home">← Zurück</button>
        <h1>Neues Spiel</h1>
        <button class="icon-btn" data-act="rules" aria-label="Spielregeln">?</button>
      </header>
      ${ui.error ? `<div class="alert">${esc(ui.error)}</div>` : ''}
      <section class="panel">
        <h2>Mitspieler</h2>
        <p class="muted">Jede/r tritt mit dem eigenen Handy bei (${MIN_PLAYERS}–${MAX_PLAYERS} Personen). Der Laptop ist die Bühne – am besten auf den Fernseher und laut machen!</p>
      </section>
      <section class="panel">
        <h2>Einstellungen</h2>
        ${settingsHtml(st, 'setup')}
      </section>
      <section class="panel">
        <h2>📋 Kategorien</h2>
        ${catsHtml(st, 'setup')}
      </section>
      <div class="sticky-start">
        <button class="btn btn-primary btn-big" data-act="create-game">Raum öffnen 📱</button>
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
    if (v.phase === 'end') info = '<span class="pill">🏁 Spielende</span>';
    else if (v.phase !== 'lobby') {
      info = `<span class="pill ${v.round === v.rounds ? 'pill-hot' : ''}">${esc(roundLabel(v))}</span>`;
      if (questionLabel(v) && v.phase !== 'scores') info += `<span class="pill">${esc(questionLabel(v))}</span>`;
      if (v.cur && v.cur.question && v.phase !== 'scores') info += catHtml(v.cur.question.cat);
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

  function scoreboardHtml(v) {
    if (['lobby', 'end'].includes(v.phase) || !v.players.length) return '';
    const max = Math.max(1, ...v.players.map((p) => p.score));
    const sorted = v.standings.map((s) => player(v, s.id)).filter(Boolean);
    return `<footer class="scoreboard">${sorted
      .map(
        (p) => `<div class="score ${p.online ? '' : 'is-out'}" style="${tc(p.color)}">
          <div class="score-head"><span class="team-dot"></span><b>${esc(p.name)}</b></div>
          <div class="score-bar"><span style="width:${(100 * p.score) / max}%"></span></div>
          <div class="score-num">${fmtPts(p.score)}</div>
        </div>`
      )
      .join('')}</footer>`;
  }

  function stageHtml(v) {
    let main;
    if (v.phase === 'lobby') main = lobbyStageHtml(v);
    else if (v.phase === 'end') main = endHtml(v);
    else if (v.phase === 'category') main = categoryStageHtml(v);
    else if (v.phase === 'lie') main = lieStageHtml(v);
    else if (v.phase === 'check') main = checkStageHtml(v);
    else if (v.phase === 'pick') main = pickStageHtml(v);
    else if (v.phase === 'reveal') main = revealStageHtml(v);
    else main = scoresStageHtml(v);
    return `
      <div class="stage phase-${v.phase} ${v.cur && v.cur.question && v.cur.question.kind === 'dict' ? 'is-dict' : ''}">
        ${topbarHtml(v)}
        <main class="stage-main">${main}</main>
        ${scoreboardHtml(v)}
      </div>`;
  }

  /* ---------- Lobby ---------- */

  function lobbyStageHtml(v) {
    const chip = (p) =>
      `<span class="chip ${p.online ? '' : 'is-offline'}" style="${tc(p.color)}"><span class="team-dot"></span>${esc(p.name)}<button class="chip-x" data-act="kick" data-player="${esc(p.id)}" aria-label="${esc(p.name)} entfernen">✕</button></span>`;
    const w = v.watchers;
    return `
      <div class="lobby-grid">
        <section class="panel join-panel">
          <h2>📱 Handys verbinden</h2>
          <p class="muted">QR-Code scannen, Namen eingeben – los geht's.</p>
          ${roomBoxHtml(v.room, true)}
        </section>
        <div class="lobby-side">
          <section class="panel">
            <h2>🤥 Dabei <small class="muted">(${v.players.length} / ${MAX_PLAYERS})</small></h2>
            <div class="chips">${v.players.length ? v.players.map(chip).join('') : '<span class="muted">Noch niemand – QR-Code scannen!</span>'}</div>
            ${w.length ? `<div class="free"><b>👀 Schauen nur zu:</b> <div class="chips">${w.map((m) => `<span class="chip ${m.online ? '' : 'is-offline'}">${esc(m.name)}<button class="chip-x" data-act="kick" data-player="${esc(m.id)}" aria-label="${esc(m.name)} entfernen">✕</button></span>`).join('')}</div></div>` : ''}
            <p class="muted small">Das erste Handy ist die 🎬 Spielleitung und kann vom Handy aus weiterschalten – im Wörterbuch-Modus legt sie außerdem Erklärungen zusammen, die dasselbe meinen.</p>
          </section>
          <section class="panel">
            <h2>Einstellungen</h2>
            ${settingsHtml(v.settings, 'lobby')}
          </section>
          <section class="panel">
            <h2>📋 Kategorien</h2>
            ${catsHtml(v.settings, 'lobby')}
          </section>
          <div class="sticky-start">
            <button class="btn btn-primary btn-big" data-act="start" ${v.lobbyProblem ? 'disabled' : ''}>Los geht's 🤥</button>
            ${v.lobbyProblem ? `<p class="muted small center">${esc(v.lobbyProblem)}</p>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ---------- Kategorie ---------- */

  function categoryStageHtml(v) {
    const k = v.cur.category;
    const p = player(v, k.chooser);
    return `
      <div class="center-stage category-stage">
        <h1 class="stage-title">${p ? `<span class="who" style="${tc(p.color)}"><span class="team-dot"></span>${esc(p.name)}</span> wählt die Kategorie …` : 'Welche Kategorie?'}</h1>
        <div class="cat-cards">${k.offer
          .map(
            (c, i) => `<button class="cat-card" data-act="category" data-cat="${esc(c.id)}" style="--d:${i * 0.1}s">
              <span class="cat-icon">${c.icon}</span><b>${esc(c.label)}</b><small>${esc(c.text)}</small>
            </button>`
          )
          .join('')}</div>
        ${timerHtml(v.timer, { tick: true, cls: 'timer-big' })}
        <div class="stage-actions"><button class="btn btn-ghost btn-small" data-act="force" data-step="${esc(v.step)}">🎲 Zufällig</button></div>
      </div>`;
  }

  /* ---------- Lügen ---------- */

  function progressHtml(v, list) {
    const items = (list || []).map((x) => ({ x, p: player(v, x.id) })).filter((y) => y.p);
    return `<div class="progress-chips">${items
      .map(
        ({ x, p }) => `<div class="pchip ${p.online ? '' : 'is-offline'} ${x.done ? 'is-done' : ''}" style="${tc(p.color)}">
          <span class="team-dot"></span><b>${esc(p.name)}</b><span class="pchip-mark">${x.done ? '✓' : '…'}</span>${p.online ? '' : '<span>📵</span>'}
        </div>`
      )
      .join('')}</div>`;
  }

  function questionCard(v, cls) {
    const q = v.cur.question;
    return `<div class="question-card ${q.kind === 'dict' ? 'q-dict' : ''} ${cls || ''} ${v.reading && ui.readIdx === 0 ? 'is-reading' : ''}">${questionHtml(q)}</div>`;
  }

  function lieStageHtml(v) {
    const c = v.cur;
    const dict = c.question.kind === 'dict';
    return `
      <div class="center-stage lie-stage">
        ${c.final ? `<h1 class="stage-title">🏁 Finale – Punkte doppelt, zwei Tipps!</h1>` : ''}
        ${questionCard(v)}
        <p class="muted center lie-hint">${dict ? 'Alle erfinden auf dem Handy eine <b>glaubwürdige Erklärung</b>.' : 'Alle erfinden auf dem Handy eine <b>falsche Antwort</b>, die glaubwürdig klingt.'}
          <br />Pro Person, die darauf reinfällt: <b>+${fmtPts(c.points.fooled)}</b> · Wahrheit erkannt: <b>+${fmtPts(c.points.right)}</b></p>
        ${timerHtml(v.timer, { tick: true, clock: true, cls: 'timer-big' })}
        ${progressHtml(v, c.lie.progress)}
        <div class="stage-actions"><button class="btn btn-ghost btn-small" data-act="force" data-step="${esc(v.step)}">⏩ Jetzt beenden</button></div>
      </div>`;
  }

  /* ---------- Prüfen (Wörterbuch) ---------- */

  function checkStageHtml(v) {
    const ch = v.cur.check;
    const cards = ch.options
      .map(
        (o, i) => `<button class="answer-card ${ui.mergeFrom === o.key ? 'is-selected' : ''}" data-act="merge-pick" data-key="${esc(o.key)}" style="--d:${i * 0.06}s">
          <span class="card-no">${String.fromCharCode(65 + i)}</span><span class="card-text">${esc(o.text)}</span>
        </button>`
      )
      .join('');
    return `
      <div class="center-stage pick-stage">
        ${questionCard(v, 'q-small')}
        <p class="center check-hint">🔍 <b>Prüfen:</b> Meinen zwei Erklärungen dasselbe? Erst die eine, dann die andere antippen – sie werden zusammengelegt.
          <small class="muted">Niemand weiß, welche Karte die echte ist. Wer eine (fast) richtige Erklärung geschrieben hat, bekommt die Punkte für die Wahrheit.</small></p>
        <div class="answer-grid">${cards}</div>
        ${timerHtml(v.timer, { cls: 'timer-big' })}
        <div class="stage-actions">
          ${ch.merged ? '<button class="btn btn-ghost btn-small" data-act="unmerge">↩️ Zusammenlegen rückgängig</button>' : ''}
          <button class="btn btn-primary btn-big" data-act="next" data-step="${esc(v.step)}" data-next>Passt so – tippen! 👆</button>
        </div>
      </div>`;
  }

  /* ---------- Tippen ---------- */

  function pickStageHtml(v) {
    const pk = v.cur.pick;
    const cards = pk.options
      .map(
        (o, i) => `<div class="answer-card ${v.reading && ui.readIdx === i + 1 ? 'is-reading' : ''}" style="--d:${i * 0.06}s">
          <span class="card-no">${String.fromCharCode(65 + i)}</span><span class="card-text">${esc(o.text)}</span>
        </div>`
      )
      .join('');
    const status = v.reading ? '<p class="reading-note">🗣️ Wird vorgelesen … <small>tippen geht schon</small></p>' : timerHtml(v.timer, { tick: true, cls: 'timer-big' });
    return `
      <div class="center-stage pick-stage">
        ${questionCard(v, 'q-small')}
        <p class="center pick-hint">${v.cur.final ? '🏁 <b>Zwei Tipps:</b> der erste zählt voll, der zweite halb.' : '👆 <b>Was ist die Wahrheit?</b> Auf dem Handy antippen.'}</p>
        <div class="answer-grid">${cards}</div>
        ${status}
        <p class="muted center">Getippt: ${dotsHtml(pk.done, pk.count)} <small>(${pk.done}/${pk.count})</small></p>
        <div class="stage-actions"><button class="btn btn-ghost btn-small" data-act="force" data-step="${esc(v.step)}">⏩ Jetzt auflösen</button></div>
      </div>`;
  }

  /* ---------- Auflösung ---------- */

  function revealCardHtml(v, card, i, current) {
    const r = v.cur.reveal;
    if (!card.revealed) {
      return `<div class="answer-card is-hidden-card" style="--d:${i * 0.04}s"><span class="card-no">${String.fromCharCode(65 + i)}</span><span class="card-text">${esc(card.text)}</span></div>`;
    }
    const fell = card.pickers.map((p) => personChip(p, p.second ? ' <small>(2.)</small>' : '')).join('');
    let who;
    if (card.truth) {
      who = `<div class="card-who truth-who">✓ DIE WAHRHEIT${card.pickers.length ? ` <span class="card-gain">+${fmtPts(card.points)}</span>` : ''}</div>`;
      if (card.hits.length) who += `<div class="card-hits">🎯 selbst erklärt: ${card.hits.map((p) => personChip(p, '', 'author')).join('')}</div>`;
    } else if (card.house) who = '<div class="card-who">🏠 Lüge vom Haus</div>';
    else who = `<div class="card-who"><small>gelogen von</small> ${card.authors.map((p) => personChip(p, '', 'author')).join('')}${card.pickers.length ? ` <span class="card-gain">+${fmtPts(card.points * card.pickers.filter((p) => !p.second).length + (card.points / 2) * card.pickers.filter((p) => p.second).length)}</span>` : ''}</div>`;
    const likes = r.done && card.likes ? `<span class="card-likes">👍 ${card.likes}</span>` : '';
    return `<div class="answer-card is-revealed ${card.truth ? 'is-truth' : 'is-lie'} ${current ? 'is-current' : ''} ${card.pickers.length ? 'has-fell' : 'no-fell'}" style="--d:${i * 0.04}s">
      <span class="card-no">${String.fromCharCode(65 + i)}</span>
      <span class="card-text">${esc(card.text)}</span>
      ${who}
      ${fell ? `<div class="voters"><small class="voters-label">${card.truth ? '✓ richtig getippt' : '🐟 reingefallen'}</small>${fell}</div>` : card.truth ? '<div class="voters"><span class="voter voter-none">niemand lag richtig 😱</span></div>' : ''}
      ${likes}
    </div>`;
  }

  function revealStageHtml(v) {
    const c = v.cur;
    const r = c.reveal;
    const current = new Set(r.step ? r.step.keys : []);
    const cards = r.cards.map((card, i) => revealCardHtml(v, card, i, current.has(card.key))).join('');
    let banner = '';
    if (!r.shown) banner = '<p class="banner">🥁 Die Auflösung …</p>';
    else if (r.step && !r.done) {
      const k = r.step.kind;
      const first = revealStepCards(r)[0];
      banner = k === 'none' ? `<p class="banner">💨 Darauf ist niemand reingefallen</p>` : k === 'house' ? `<p class="banner">🏠 Eine Lüge vom Haus!</p>` : first ? `<p class="banner">🤥 Reingefallen: ${esc(names(first.pickers))}</p>` : '';
    }
    let after = '';
    if (r.done) {
      after = `<p class="truth-line">✓ <b>${esc(r.truth)}</b></p>
        <p class="source muted small">Quelle: <a href="${esc(r.source)}" target="_blank" rel="noopener">${esc(r.source.replace(/^https?:\/\//, ''))}</a></p>
        ${sipsHtml(v, r.sips)}
        ${v.settings.likes ? '<p class="muted center small">👍 Auf den Handys: Like für die lustigste Lüge</p>' : ''}
        <div class="stage-actions">
          <button class="btn btn-link btn-small" data-act="report">👎 Frage melden</button>
          <button class="btn btn-primary btn-big" data-act="next" data-step="${esc(v.step)}" data-next>${esc(nextLabel(v))}</button>
        </div>`;
    } else {
      after = `<div class="stage-actions"><button class="btn btn-ghost btn-small" data-act="force" data-step="${esc(v.step)}">⏩ Alles aufdecken</button></div>`;
    }
    return `
      <div class="center-stage pick-stage reveal-stage">
        ${questionCard(v, 'q-small')}
        ${banner}
        <div class="answer-grid">${cards}</div>
        ${after}
      </div>`;
  }

  /* ---------- Zwischenstand ---------- */

  function scoresStageHtml(v) {
    const gains = v.gains || {};
    const max = Math.max(1, ...v.standings.map((s) => s.score));
    const rows = v.standings
      .map((s, i) => {
        const p = player(v, s.id);
        const g = gains[s.id] || 0;
        return `<div class="standing" style="${tc(p.color)};--d:${i * 0.08}s">
          <span class="place">${s.place}.</span><span class="team-dot"></span><b>${esc(s.name)}</b>
          <div class="standing-bar"><span style="width:${(100 * s.score) / max}%"></span></div>
          <span class="gain">${g ? '+' + fmtPts(g) : ''}</span><span class="total">${fmtPts(s.score)}</span>
        </div>`;
      })
      .join('');
    const next = v.round + 1 === v.rounds ? '<p class="muted center">Im Finale: eine Frage, <b>zwei Tipps</b>, doppelte Punkte!</p>' : `<p class="muted center">Runde ${v.round + 1}: ${fmtPts(POINTS.truth[v.round])} für die Wahrheit, ${fmtPts(POINTS.fooled[v.round])} pro Reingefallene/n.</p>`;
    return `
      <div class="center-stage scores-stage">
        <h1 class="stage-title">📊 Zwischenstand nach Runde ${v.round}</h1>
        <div class="standings">${rows}</div>
        ${next}
        <button class="btn btn-primary btn-big" data-act="next" data-step="${esc(v.step)}" data-next>${esc(nextLabel(v))}</button>
      </div>`;
  }

  /* ---------- Spielende ---------- */

  function awardsHtml(v) {
    return (v.awards || []).map((a) => `<div class="award"><span class="award-icon">${a.icon}</span><div><b>${esc(a.title)}</b><small>${esc(a.text)}</small>${a.sub ? `<small class="award-sub">${esc(a.sub)}</small>` : ''}</div></div>`).join('');
  }

  function historyHtml(v) {
    return (v.history || [])
      .map(
        (h) => `<li>
          <small class="muted">${h.final ? '🏁 Finale' : `Runde ${h.round}`} · ${h.cat ? `${h.cat.icon} ${esc(h.cat.label)}` : ''}</small><br />
          <b>${esc(h.kind === 'dict' ? `Was bedeutet „${h.text}“?` : h.text)}</b><br />
          ✓ <span class="hl">${esc(h.truth)}</span>${h.truthBy.length ? ` <small class="muted">(erkannt: ${esc(h.truthBy.join(', '))})</small>` : ''}
          <ul>${h.lies.map((l) => `<li>„${esc(l.text)}“ – ${l.house ? '🏠 Haus' : esc(l.authors.join(' & '))}${l.fell.length ? ` · reingefallen: ${esc(l.fell.join(', '))}` : ''}${l.likes ? ` · 👍 ${l.likes}` : ''}</li>`).join('')}</ul>
          <small><a href="${esc(h.source)}" target="_blank" rel="noopener">Quelle</a></small>
        </li>`
      )
      .join('');
  }

  function endHtml(v) {
    const pl = v.standings.map((s) => ({ s, p: player(v, s.id) })).filter((x) => x.p);
    const podium = pl
      .slice(0, 3)
      .map(
        ({ s, p }, i) => `
        <div class="podium-step p${i + 1}" style="${tc(p.color)}">
          <div class="podium-medal">${['🥇', '🥈', '🥉'][s.place - 1] || '🏅'}</div>
          <b>${esc(p.name)}</b>
          <span>${fmtPts(s.score)} ${plural(s.score, 'Punkt', 'Punkte')}</span>
          <div class="podium-block">${s.place}</div>
        </div>`
      )
      .join('');
    const rest = pl.slice(3);
    const winners = pl.filter((x) => x.s.place === 1).map((x) => esc(x.p.name));
    const awards = awardsHtml(v);
    const hist = historyHtml(v);
    return `
      <div class="center-stage over">
        <h1 class="over-title">${!pl.length ? '🏁 Spiel vorbei' : winners.length > 1 ? `🤝 Unentschieden: ${winners.join(' & ')}` : `🏆 ${winners[0]} gewinnt!`}</h1>
        ${pl.length > 1 ? `<div class="podium">${podium}</div>` : ''}
        ${rest.length ? `<div class="summary">${rest.map(({ s, p }) => `<div class="summary-row" style="${tc(p.color)}"><span class="team-dot"></span><b>${s.place}. ${esc(p.name)}</b><b class="summary-points">${fmtPts(s.score)}</b></div>`).join('')}</div>` : ''}
        ${awards ? `<div class="awards">${awards}</div>` : ''}
        ${hist ? `<details class="word-list"><summary>📜 Alle Fragen und Lügen zum Nachlesen</summary><ol>${hist}</ol></details>` : ''}
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
    let body;
    if (v.phase === 'lobby') body = phoneLobbyHtml(v, p);
    else if (v.phase === 'end') body = phoneEndHtml(v);
    else if (v.phase === 'category') body = phoneCategoryHtml(v);
    else if (v.phase === 'lie') body = phoneLieHtml(v);
    else if (v.phase === 'check') body = phoneCheckHtml(v);
    else if (v.phase === 'pick') body = phonePickHtml(v);
    else if (v.phase === 'reveal') body = phoneRevealHtml(v);
    else body = phoneScoresHtml(v);
    const role = p ? '' : 'Zuschauer';
    const score = p && v.phase !== 'lobby' ? `<span class="phone-points">${fmtPts(p.score)} P.</span>` : '';
    return `
      <div class="phone phase-${v.phase}" style="${tc(p ? p.color : '#94a3b8')}">
        <header class="phone-head">
          <span class="team-dot"></span>
          <b>${esc(me.name)}</b>
          <span class="phone-name">${[role, me.lead ? '🎬 Spielleitung' : '', v.phase !== 'lobby' && v.phase !== 'end' ? roundLabel(v) : ''].filter(Boolean).map(esc).join(' · ')}</span>
          ${score}
          <button class="icon-btn" data-act="menu" aria-label="Menü">☰</button>
        </header>
        ${phoneStatusBanner()}
        <main class="phone-main">${body}</main>
      </div>`;
  }

  function leadToolsHtml(v, items) {
    if (!v.me.lead || !items.length) return '';
    return `<div class="lead-tools"><small>🎬 Du bist die Spielleitung</small>${items.join('')}</div>`;
  }

  function forceBtn(v, label) {
    return `<button class="btn btn-ghost btn-small" data-act="force" data-step="${esc(v.step)}">${label}</button>`;
  }

  function phoneQuestion(v) {
    const q = v.cur.question;
    return `<div class="question-card q-phone ${q.kind === 'dict' ? 'q-dict' : ''}">${questionHtml(q)}</div>`;
  }

  function phoneLobbyHtml(v, p) {
    const n = v.players.length;
    if (!p) {
      return `<div class="look-up">👀<b>Du schaust zu</b><small>${n} ${plural(n, 'Person spielt', 'Personen spielen')}</small></div>
        ${n < MAX_PLAYERS ? '<button class="btn btn-primary btn-big btn-wide" data-act="watch" data-watch="0">🤥 Doch mitspielen</button>' : `<p class="muted center">Alle ${MAX_PLAYERS} Plätze sind belegt.</p>`}`;
    }
    return `<div class="look-up">🤥<b>Du bist dabei!</b><small>${n} ${plural(n, 'Person spielt', 'Personen spielen')} mit${n < MIN_PLAYERS ? ` – ab ${MIN_PLAYERS} geht's los` : ''}</small></div>
      <p class="center muted small">Am Laptop erscheint eine kuriose, echte Frage. Du erfindest eine Antwort, die glaubwürdig klingt. Dann tippen alle, was die Wahrheit ist – und wer auf deine Lüge reinfällt, bringt dir Punkte!</p>
      <p class="waiting">⏳ Warte, bis es am Laptop losgeht…</p>
      <button class="btn btn-link" data-act="watch" data-watch="1">Nur zuschauen</button>`;
  }

  function phoneCategoryHtml(v) {
    const k = v.cur.category;
    const lead = leadToolsHtml(v, [forceBtn(v, '🎲 Zufällig')]);
    if (!k.mine) {
      return `<div class="look-up">🎲<b>${esc(k.chooserName || '?')} wählt die Kategorie</b><small>Gleich geht's los …</small></div>
        <div class="cat-list muted">${k.offer.map((c) => `<span class="cat-mini">${c.icon} ${esc(c.label)}</span>`).join('')}</div>
        ${v.me.lead ? `<div class="lead-tools"><small>🎬 Spielleitung: auch du darfst wählen</small>${k.offer.map((c) => `<button class="btn btn-ghost btn-small" data-act="category" data-cat="${esc(c.id)}">${c.icon} ${esc(c.label)}</button>`).join('')}${forceBtn(v, '🎲 Zufällig')}</div>` : ''}`;
    }
    return `<h2 class="phone-title">🎲 Du wählst die Kategorie!</h2>
      ${timerHtml(v.timer)}
      <div class="cat-buttons">${k.offer.map((c) => `<button class="cat-card cat-phone" data-act="category" data-cat="${esc(c.id)}"><span class="cat-icon">${c.icon}</span><b>${esc(c.label)}</b><small>${esc(c.text)}</small></button>`).join('')}</div>
      ${lead}`;
  }

  function phoneLieHtml(v) {
    const c = v.cur;
    const l = c.lie;
    const dict = c.question.kind === 'dict';
    const timer = timerHtml(v.timer, { clock: true });
    const lead = leadToolsHtml(v, [forceBtn(v, '⏩ Für alle beenden')]);
    if (!l.writing) {
      return `${timer}${phoneQuestion(v)}<div class="look-up">✍️<b>Die anderen lügen gerade …</b><small>${v.me.playing ? 'Du bist ab der nächsten Frage mit Lügen dran – tippen darfst du gleich schon.' : 'Gleich wird getippt.'}</small></div>${lead}`;
    }
    if (l.mine && !ui.editing) {
      return `${timer}${phoneQuestion(v)}
        <div class="submitted"><small>Deine ${dict ? 'Erklärung' : 'Lüge'}</small><b>${esc(l.mine)}</b></div>
        <p class="waiting">⏳ Warte auf die anderen … ändern geht noch.</p>
        <button class="btn btn-ghost" data-act="edit-lie">✏️ Ändern</button>
        ${lead}`;
    }
    const has = String(ui.draft || '').trim().length > 0;
    const field = dict
      ? `<textarea id="lie-input" class="input lie-input" rows="3" maxlength="${l.max}" placeholder="Was könnte das bedeuten? Klingt es echt?" data-field="lie" enterkeyhint="send" autocomplete="off">${esc(ui.draft)}</textarea>`
      : `<input id="lie-input" class="input input-big lie-input" type="text" maxlength="${l.max}" placeholder="Deine Lüge …" value="${esc(ui.draft)}" data-field="lie" enterkeyhint="send" autocomplete="off" autocapitalize="sentences" />`;
    return `${timer}${phoneQuestion(v)}
      <form class="lie-form" data-form="lie" autocomplete="off">
        ${l.rejected ? `<p class="reject-note">🤫 <b>„${esc(l.rejected)}“</b> ist (fast) die Wahrheit! Denk dir was anderes aus.</p>` : ''}
        ${field}
        <p class="muted small">${dict ? 'Eine kurze Erklärung, so wie im Wörterbuch.' : 'Kurz und glaubwürdig – so, dass es in die Lücke passt.'}</p>
        <button class="btn btn-primary btn-big btn-wide" type="submit" ${has ? '' : 'disabled'}>Abschicken ✓</button>
      </form>
      ${lead}`;
  }

  function phoneCheckHtml(v) {
    const ch = v.cur.check;
    if (!v.me.lead) {
      return `${phoneQuestion(v)}<div class="look-up">🔍<b>Die Spielleitung prüft …</b><small>ob zwei Erklärungen dasselbe meinen. Gleich wird getippt!</small></div>`;
    }
    const rows = ch.options
      .map(
        (o, i) => `<button class="pick-card ${ui.mergeFrom === o.key ? 'on' : ''} ${o.mine ? 'is-mine' : ''}" data-act="merge-pick" data-key="${esc(o.key)}" ${o.mine ? 'disabled' : ''}>
          <span class="card-no">${String.fromCharCode(65 + i)}</span><span class="card-text">${esc(o.text)}</span>${o.mine ? '<span class="mine-tag">deine</span>' : ''}
        </button>`
      )
      .join('');
    return `<h2 class="phone-title">🔍 Prüfen</h2>
      <p class="muted small center">Meinen zwei Karten dasselbe? Erst die eine, dann die andere antippen. (Du weißt auch nicht, welche echt ist.)</p>
      ${timerHtml(v.timer)}
      <div class="pick-list">${rows}</div>
      <div class="lead-tools">
        ${ch.merged ? '<button class="btn btn-ghost btn-small" data-act="unmerge">↩️ Rückgängig</button>' : ''}
        <button class="btn btn-primary" data-act="next" data-step="${esc(v.step)}">Passt so – tippen! 👆</button>
      </div>`;
  }

  function phonePickHtml(v) {
    const c = v.cur;
    const pk = c.pick;
    const reading = v.reading ? '<p class="muted center small">🗣️ Der Laptop liest gerade vor …</p>' : timerHtml(v.timer);
    const lead = leadToolsHtml(v, [forceBtn(v, '⏩ Jetzt auflösen')]);
    if (pk.hit) return `${phoneQuestion(v)}<div class="look-up win">🎯<b>Volltreffer!</b><small>Deine Erklärung war (fast) die echte – du bekommst die Punkte für die Wahrheit und musst nicht tippen.</small></div>${reading}${lead}`;
    if (!pk.canPick) return `${phoneQuestion(v)}<div class="look-up">👀<b>Schau auf den Laptop</b><small>Die anderen tippen.</small></div>${lead}`;
    const mp = pk.myPicks || [];
    const two = pk.slots > 1;
    const slot = two ? ui.slot : 0;
    const rows = pk.options
      .map((o, i) => {
        const n = mp.indexOf(o.key);
        const tag = o.mine ? '<span class="mine-tag">🔒 deine</span>' : n >= 0 ? `<span class="pick-tag">${two ? (n === 0 ? '1.' : '2.') : '✓'}</span>` : '';
        return `<button class="pick-card ${n >= 0 ? 'on' : ''} ${n === 1 ? 'is-second' : ''} ${o.mine ? 'is-mine' : ''}" data-act="pick" data-key="${esc(o.key)}" data-slot="${slot}" ${o.mine ? 'disabled' : ''} aria-pressed="${n >= 0}">
          <span class="card-no">${String.fromCharCode(65 + i)}</span><span class="card-text">${esc(o.text)}</span>${tag}
        </button>`;
      })
      .join('');
    const slots = two
      ? `<div class="seg slot-seg" role="group">
          <button class="seg-btn ${slot === 0 ? 'on' : ''}" data-act="slot" data-slot="0">1. Tipp ${mp[0] ? '✓' : ''} <small>(voll)</small></button>
          <button class="seg-btn ${slot === 1 ? 'on' : ''}" data-act="slot" data-slot="1" ${mp[0] ? '' : 'disabled'}>2. Tipp ${mp[1] ? '✓' : ''} <small>(halb)</small></button>
        </div>`
      : '';
    const done = mp.filter(Boolean).length >= pk.slots;
    return `<h2 class="phone-title">${two ? '🏁 Zwei Tipps' : '👆 Was ist wahr?'}</h2>
      ${phoneQuestion(v)}
      ${pk.dropped ? '<p class="muted small center">Es gab zu viele Lügen – deine ist diesmal nicht auf der Bühne. Tippen darfst du trotzdem!</p>' : ''}
      ${slots}
      <div class="pick-list">${rows}</div>
      ${done ? '<p class="waiting">✓ Getippt – du kannst noch wechseln.</p>' : ''}
      ${reading}
      ${lead}`;
  }

  function phoneRevealHtml(v) {
    const c = v.cur;
    const r = c.reveal;
    const lead = leadToolsHtml(v, [r.done ? `<button class="btn btn-primary btn-small" data-act="next" data-step="${esc(v.step)}">${esc(nextLabel(v))}</button>` : forceBtn(v, '⏩ Alles aufdecken')]);
    if (!r.done) {
      // Eigene Karte: schon aufgedeckt?
      const mine = r.cards.find((x) => x.mine && x.revealed);
      const picked = (r.myPicks || []).map((k) => r.cards.find((x) => x.key === k)).filter((x) => x && x.revealed && !x.truth);
      let line = '';
      if (mine && mine.pickers.length) line = `<p class="mini-line win">🎉 ${mine.pickers.length} ${plural(mine.pickers.length, 'Person ist', 'Personen sind')} auf „${esc(mine.text)}“ reingefallen!</p>`;
      else if (mine) line = `<p class="mini-line">💨 Auf „${esc(mine.text)}“ ist niemand reingefallen.</p>`;
      if (picked.length) line += `<p class="mini-line bad">🐟 Du bist auf „${esc(picked[0].text)}“ reingefallen${picked[0].house ? ' – eine Lüge vom Haus' : ` – von ${esc(names(picked[0].authors))}`}.</p>`;
      return `<div class="look-up">👀<b>Schau auf den Laptop!</b><small>Die Auflösung läuft …</small></div>${line}${lead}`;
    }
    const g = (r.gains || {})[v.me.id] || null;
    const truthCard = r.cards.find((x) => x.truth);
    const right = truthCard && truthCard.pickers.find((p) => p.id === v.me.id);
    const head = r.hit
      ? `<div class="look-up win">🎯<b>Volltreffer!</b><small>Deine Erklärung war (fast) die echte.</small></div>`
      : right
        ? `<div class="look-up win">🧐<b>${right.second ? 'Im zweiten Anlauf richtig!' : 'Wahrheit erkannt!'}</b><small>${esc(r.truth)}</small></div>`
        : `<div class="look-up">${v.me.playing ? '🐟' : '🏁'}<b>${v.me.playing ? 'Reingelegt!' : 'Aufgelöst!'}</b><small>Die Wahrheit: ${esc(r.truth)}</small></div>`;
    const parts = [];
    if (g) {
      if (g.truth) parts.push(`<span>🧐 Wahrheit +${fmtPts(g.truth)}</span>`);
      if (g.fooled) parts.push(`<span>🤥 ${g.fooledN}× reingelegt +${fmtPts(g.fooled)}</span>`);
      if (g.likes) parts.push(`<span>👍 ${g.likesN} +${fmtPts(g.likes)}</span>`);
    }
    const total = g ? `<div class="submitted"><small>Diese Frage</small><b>+${fmtPts(g.total)}</b></div>${parts.length ? `<div class="my-stats">${parts.join('')}</div>` : ''}` : '';
    let likes = '';
    if (v.settings.likes && v.me.playing) {
      const list = r.cards.filter((x) => !x.truth && !x.house && !x.mine && x.authors && x.authors.length);
      if (list.length) {
        likes = `<h3 class="phone-sub">👍 Welche Lüge war die lustigste?</h3>
          <div class="pick-list">${list
            .map((x) => `<button class="pick-card like-card ${r.myLike === x.key ? 'on' : ''}" data-act="like" data-key="${esc(x.key)}" aria-pressed="${r.myLike === x.key}"><span class="card-text">${esc(x.text)}</span><small class="muted">${esc(names(x.authors))}</small><span class="pick-tag">${r.myLike === x.key ? '👍' : '♡'}</span></button>`)
            .join('')}</div>`;
      }
    }
    return `${head}${total}${sipsHtml(v, r.sips, v.me.id)}${likes}
      <p class="muted small center"><a href="${esc(r.source)}" target="_blank" rel="noopener">Quelle ansehen</a> · <button class="btn btn-link btn-small" data-act="report">👎 melden</button></p>
      ${lead}`;
  }

  function phoneScoresHtml(v) {
    const s = v.standings.find((x) => x.id === v.me.id);
    const g = (v.gains || {})[v.me.id] || 0;
    const lead = leadToolsHtml(v, [`<button class="btn btn-primary btn-small" data-act="next" data-step="${esc(v.step)}">${esc(nextLabel(v))}</button>`]);
    if (!s) return `<div class="look-up">📊<b>Zwischenstand</b><small>Schau auf den Laptop!</small></div>${lead}`;
    return `<div class="look-up ${s.place === 1 ? 'win' : ''}">📊<b>Platz ${s.place} von ${v.standings.length}</b><small>${fmtPts(s.score)} Punkte${g ? ` · diese Runde +${fmtPts(g)}` : ''}</small></div>
      <p class="center muted">${v.round + 1 === v.rounds ? 'Gleich kommt das Finale – doppelte Punkte!' : 'Die nächste Runde bringt mehr Punkte – alles ist offen!'}</p>
      ${lead}`;
  }

  function phoneEndHtml(v) {
    const s = v.standings.find((x) => x.id === v.me.id);
    const st = v.stats && v.stats[v.me.id];
    const head = s
      ? s.place === 1
        ? `<div class="look-up win">🏆<b>Gewonnen!</b><small>${fmtPts(s.score)} Punkte</small></div>`
        : `<div class="look-up">${['', '🥇', '🥈', '🥉'][s.place] || '🏅'}<b>Platz ${s.place}</b><small>${fmtPts(s.score)} Punkte</small></div>`
      : '<div class="look-up">🏁<b>Spiel vorbei</b></div>';
    const mine = st ? `<div class="my-stats"><span>🎭 ${st.fooled}× reingelegt</span><span>🧐 ${st.truths}× Wahrheit</span><span>🐟 ${st.fell}× reingefallen</span><span>👍 ${st.likes} Likes</span></div>` : '';
    const awards = awardsHtml(v);
    return `${head}${mine}${awards ? `<div class="awards">${awards}</div>` : ''}<p class="muted small center">Am Laptop kann eine neue Runde gestartet werden.</p>`;
  }

  /* ------------------------------------------------------------------ */
  /* Dialoge                                                             */
  /* ------------------------------------------------------------------ */

  function modalHtml() {
    if (!ui.modal) return '';
    let body = '';
    if (ui.modal === 'rules') body = rulesHtml();
    else if (ui.modal === 'menu') body = menuHtml();
    else if (ui.modal === 'voice') body = voiceHtml();
    else if (ui.modal === 'report') body = reportHtml();
    else if (ui.modal === 'reports') body = reportsHtml();
    else if (ui.modal === 'qr') {
      body = `<h2>📱 Mitspieler einladen</h2>${roomBoxHtml(ui.view && ui.view.room, false)}
        <p class="muted small center">Wer jetzt beitritt, tippt sofort mit und lügt ab der nächsten Frage.</p>
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
        <p>Am Laptop erscheint eine Frage mit einer <b>kuriosen, echten Antwort</b> – <i>„Die Kettensäge wurde ursprünglich für die ___ erfunden.“</i>
          Alle erfinden auf dem Handy eine <b>falsche Antwort</b>, die glaubwürdig klingt.</p>
        <h3>🤥 Lügen</h3>
        <p>Ist deine Lüge (fast) die Wahrheit, sagt dir das Handy Bescheid – dann musst du dir etwas anderes ausdenken.
          Schreiben zwei dasselbe, steht die Karte nur einmal da und beide bekommen die Punkte. Wer nichts schreibt, wird durch eine <b>Lüge vom Haus</b> ersetzt.</p>
        <h3>👆 Tippen</h3>
        <p>Alle Lügen und die Wahrheit stehen gemischt auf der Bühne. Tippe auf dem Handy, was du für wahr hältst – deine eigene Lüge ist gesperrt.</p>
        <h3>🏆 Punkte</h3>
        <p>Wahrheit erkannt: <b>${fmtPts(POINTS.truth[0])}</b> · pro Person, die auf deine Lüge reinfällt: <b>${fmtPts(POINTS.fooled[0])}</b>.
          Runde 2: ${fmtPts(POINTS.truth[1])} / ${fmtPts(POINTS.fooled[1])}. Im <b>Finale</b> doppelt (${fmtPts(POINTS.truth[2])} / ${fmtPts(POINTS.fooled[2])}) –
          dafür tippt man <b>zwei</b> Antworten, der zweite Tipp zählt halb. 👍 für die lustigste Lüge: +${POINTS.like}.</p>
        <h3>📖 Wörterbuch</h3>
        <p>Statt Fakten: <b>seltene echte Wörter</b>. Alle erfinden eine Erklärung. Vor dem Tippen legt die Spielleitung Erklärungen zusammen,
          die dasselbe meinen – auch sie weiß nicht, welche echt ist. Landet deine Erklärung auf der Wahrheit, hast du sie <b>getroffen</b>
          und bekommst die Wahrheits-Punkte.</p>
        <h3>🍻 Trinkregeln (ab 18, optional)</h3>
        <p>Auf eine Lüge reingefallen → 1 Schluck pro Lüge. Wahrheit getippt → 1 Schluck verteilen.</p>
        <p class="muted small">Jede Frage hat eine Quelle – sie steht nach der Auflösung klein darunter. Etwas stimmt nicht? 👎 melden.</p>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Los geht's!</button></div>`;
  }

  function voiceHtml() {
    const p = Speech.prefs();
    const list = Speech.voices();
    const options = ['<option value="">Automatisch (deutsche Stimme)</option>']
      .concat(list.map((x) => `<option value="${esc(x.name)}" ${x.name === p.voice ? 'selected' : ''}>${esc(x.name)} (${esc(x.lang)})</option>`))
      .join('');
    return `<h2>🗣️ Stimme</h2>
      ${Speech.supported() ? '' : '<p class="alert">Dieser Browser kann nicht vorlesen – das Spiel läuft trotzdem.</p>'}
      ${Sound.muted ? '<p class="alert">Der Ton ist aus – es wird nichts vorgelesen.</p>' : ''}
      <label class="label" for="voice-select">Stimme</label>
      <select id="voice-select" class="input" data-field="voice">${options}</select>
      <label class="label">Tempo</label>
      ${`<div class="seg" role="group">${Speech.RATES.map((r) => `<button class="seg-btn ${r === p.rate ? 'on' : ''}" data-act="rate" data-rate="${r}" aria-pressed="${r === p.rate}">${r === 1 ? 'normal' : r + '×'}</button>`).join('')}</div>`}
      <div class="modal-actions">
        <button class="btn btn-ghost" data-act="voice-test">▶ Probe hören</button>
        <button class="btn btn-primary" data-act="close-modal">Fertig</button>
      </div>`;
  }

  function reportHtml() {
    const f = ui.report;
    if (!f) return '';
    return `<h2>👎 Frage melden</h2>
      <p><b>${esc(f.text)}</b><br /><small class="muted">Wahrheit: ${esc(f.truth)}</small></p>
      <p class="muted">Was stimmt nicht? Die Meldung bleibt auf diesem Gerät – über „Gemeldete Fragen“ kannst du alle kopieren.</p>
      <div class="menu-list">${REPORT_REASONS.map((r) => `<button class="menu-item" data-act="report-reason" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}</div>`;
  }

  function reportsHtml() {
    const list = loadReports();
    return `<h2>📋 Gemeldete Fragen (${list.length})</h2>
      ${
        list.length
          ? `<ol class="report-list">${list.map((r) => `<li><b>${esc(r.text)}</b> – ${esc(r.reason)}<br /><small class="muted">${esc(r.truth)} · ${esc(r.id)}</small></li>`).join('')}</ol>`
          : '<p class="muted">Noch nichts gemeldet. Nach jeder Auflösung gibt es den Knopf „👎 Frage melden“.</p>'
      }
      <div class="modal-actions">
        ${list.length ? '<button class="btn btn-primary" data-act="copy-reports">📋 Kopieren</button><button class="btn btn-ghost" data-act="clear-reports">Leeren</button>' : ''}
        <button class="btn btn-ghost" data-act="close-modal">Schließen</button>
      </div>`;
  }

  function menuHtml() {
    const v = ui.view;
    const items = [];
    items.push(`<button class="menu-item" data-act="rules">📖 Spielregeln</button>`);
    items.push(`<button class="menu-item" data-act="mute">${Sound.muted ? '🔊 Ton einschalten' : '🔇 Ton ausschalten'}</button>`);
    if (v && v.me.stage) {
      items.push(`<button class="menu-item" data-act="voice">🗣️ Stimme & Tempo</button>`);
      if (v.room) items.push(`<button class="menu-item" data-act="show-qr">📱 Mitspieler einladen</button>`);
      items.push(`<button class="menu-item" data-act="show-reports">📋 Gemeldete Fragen <small>(${loadReports().length})</small></button>`);
      items.push(`<button class="menu-item" data-act="home-keep">🏠 Hauptmenü <small>(Spiel bleibt gespeichert)</small></button>`);
      if (!['lobby', 'end'].includes(v.phase)) items.push(`<button class="menu-item danger" data-act="end-game">⏹️ Spiel beenden & Siegerehrung</button>`);
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

  function scopeSettings(scope) {
    return scope === 'setup' ? ui.setup.settings : ui.view.settings;
  }

  function setSettings(scope, patch) {
    if (scope === 'setup') {
      ui.setup.settings = sanitizeSettings(Object.assign({}, ui.setup.settings, patch), ui.setup.settings);
      saveSetup();
      render();
    } else if (ui.view) {
      // Was in der Lobby eingestellt wird, merkt sich der Browser fürs nächste Spiel
      ui.setup.settings = sanitizeSettings(Object.assign({}, ui.view.settings, patch), ui.setup.settings);
      saveSetup();
      dispatch('settings', { settings: Object.assign({}, ui.view.settings, patch) });
    }
  }

  function createGame() {
    ui.error = null;
    const state = Engine.create({ settings: ui.setup.settings });
    Sound.unlock();
    startStage({ state });
  }

  /** Die aktuelle Frage (für „Melden“) – aus dem Spielstand der Bühne bzw. aus der Auflösung */
  function currentQuestionForReport() {
    const v = ui.view;
    if (!v || !v.cur || !v.cur.question || !v.cur.reveal || !v.cur.reveal.done) return null;
    const q = v.cur.question;
    const full = ui.ctrl && ui.ctrl.engine ? ui.ctrl.engine.cur() : null;
    return { id: full && full.q ? full.q.id : `${q.cat ? q.cat.id : '?'}:${Q.slug(q.text).slice(0, 60)}`, text: questionText(q), truth: v.cur.reveal.truth };
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
    voice: () => {
      ui.modal = 'voice';
      Speech.ready().then(render);
      render();
    },
    rate: (el) => {
      Speech.setPrefs({ rate: +el.dataset.rate });
      render();
    },
    'voice-test': () => Speech.say('Die Kettensäge wurde ursprünglich für Dingsbums erfunden. Geburtshilfe!'),
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
      if (Sound.muted) Speech.cancel();
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
        text: 'Das Spiel endet sofort – es zählt, was bisher aufgelöst wurde.',
        yes: 'Beenden',
        danger: true,
        run: () => dispatch('end'),
      }),

    /* Setup & Lobby */
    set: (el) => {
      const key = el.dataset.key;
      const raw = el.dataset.value;
      setSettings(el.dataset.scope, { [key]: /^\d+$/.test(raw) ? +raw : raw });
    },
    toggle: (el) => setSettings(el.dataset.scope, { [el.dataset.key]: !scopeSettings(el.dataset.scope)[el.dataset.key] }),
    'cat-toggle': (el) => {
      const s = scopeSettings(el.dataset.scope);
      const id = el.dataset.cat;
      const has = s.categories.includes(id);
      const next = has ? s.categories.filter((c) => c !== id) : s.categories.concat(id);
      if (!next.length) {
        toast('Mindestens eine Kategorie');
        return;
      }
      setSettings(el.dataset.scope, { categories: next });
    },
    'create-game': createGame,
    kick: (el) => dispatch('kick', { player: el.dataset.player }),
    watch: (el) => {
      ui.modal = null;
      dispatch('watch', { watch: el.dataset.watch === '1' });
    },
    start: () => dispatch('start'),

    /* Spiel */
    force: (el) => {
      flushDraft();
      dispatch('next', { force: true, step: el.dataset.step });
    },
    next: (el) => dispatch('next', { step: el.dataset.step }),
    category: (el) => dispatch('category', { cat: el.dataset.cat }),
    'edit-lie': () => {
      ui.editing = true;
      ui.focus = '#lie-input';
      render();
    },
    'merge-pick': (el) => {
      const key = el.dataset.key;
      if (!ui.mergeFrom) ui.mergeFrom = key;
      else if (ui.mergeFrom === key) ui.mergeFrom = null;
      else {
        dispatch('merge', { from: ui.mergeFrom, into: key });
        ui.mergeFrom = null;
      }
      render();
    },
    unmerge: () => {
      ui.mergeFrom = null;
      dispatch('unmerge');
    },
    slot: (el) => {
      ui.slot = +el.dataset.slot;
      render();
    },
    pick: (el) => {
      const v = ui.view;
      if (!v || !v.cur || !v.cur.pick) return;
      vibrate(20);
      const slot = +el.dataset.slot || 0;
      dispatch('pick', { target: v.cur.id, key: el.dataset.key, slot });
      // Finale: nach dem ersten Tipp gleich zum zweiten
      if (v.cur.pick.slots > 1 && slot === 0) ui.slot = 1;
      render();
    },
    like: (el) => {
      const v = ui.view;
      if (!v || !v.cur) return;
      vibrate(15);
      dispatch('like', { target: v.cur.id, key: el.dataset.key });
    },
    again: () => dispatch('again'),

    /* Melden */
    report: () => {
      const q = currentQuestionForReport();
      if (!q) return;
      ui.report = q;
      ui.modal = 'report';
      render();
    },
    'report-reason': (el) => {
      const f = ui.report;
      if (!f) return;
      const list = loadReports().filter((r) => r.id !== f.id);
      list.push({ id: f.id, text: f.text, truth: f.truth, reason: el.dataset.reason, at: new Date().toISOString().slice(0, 10) });
      Store.set(REPORTS_KEY, list);
      ui.report = null;
      ui.modal = null;
      toast('Danke! Gemeldet – im Menü unter „Gemeldete Fragen“.');
    },
    'show-reports': () => {
      ui.modal = 'reports';
      render();
    },
    'copy-reports': () => {
      const text = loadReports()
        .map((r) => `${r.id} | ${r.reason} | ${r.text} | ${r.truth}`)
        .join('\n');
      const done = () => toast('In die Zwischenablage kopiert.');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => toast('Kopieren nicht möglich.'));
      else toast('Kopieren wird von diesem Browser nicht unterstützt.');
    },
    'clear-reports': () =>
      askConfirm({
        title: 'Meldungen löschen?',
        text: 'Alle gemeldeten Fragen werden von diesem Gerät gelöscht.',
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
    if (f === 'name') ui.name = el.value;
    else if (f === 'join-code') ui.joinCode = Net.cleanCode(el.value);
    else if (f === 'lie') {
      ui.draft = el.value.replace(/\n/g, ' ');
      render();
    }
  });

  app.addEventListener('change', (e) => {
    if (e.target.dataset && e.target.dataset.field === 'voice') {
      Speech.setPrefs({ voice: e.target.value });
      render();
    }
  });

  app.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key !== 'Enter' || !el.dataset) return;
    if (el.dataset.field === 'name') {
      e.preventDefault();
      const code = app.querySelector('#code-input');
      if (code && !code.value) code.focus();
      else app.querySelector('[data-form="join"] button[type="submit"]').click();
    } else if (el.dataset.field === 'lie') {
      e.preventDefault();
      sendLie();
    }
  });

  app.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
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
    } else if (form.dataset.form === 'lie') {
      sendLie();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.modal) {
      ui.modal = null;
      ui.confirm = null;
      render();
      return;
    }
    // Bühne: Leertaste / Pfeil rechts = Weiter
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (ui.screen === 'stage' && !ui.modal && (e.key === ' ' || e.key === 'ArrowRight') && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(tag)) {
      const btn = app.querySelector('[data-next]');
      if (btn) {
        e.preventDefault();
        btn.click();
      }
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

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.ECHTJETZT_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  requestAnimationFrame(timerLoop);
  autoResume();

  // für Tests
  window.EchtJetztApp = { ui, render: renderNow, actions };
})();
