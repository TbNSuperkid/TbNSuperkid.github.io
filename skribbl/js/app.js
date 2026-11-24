/*
 * Oberfläche von „Skribbl“.
 *  - Laptop („Bühne“): Lobby mit QR-Code und Einstellungen, Zeichnung live, Lücken-Wort, Chat, Punktetafel,
 *    Auflösung, Siegerehrung mit Galerie. Optional wird am Laptop gezeichnet.
 *  - Handy: Wort wählen und zeichnen bzw. Live-Vorschau sehen und Tipps eintippen, Chat, Melden.
 * Gerendert wird per HTML-String + morphdom (nur geänderte Teile werden ersetzt). Zeichenflächen (data-keep)
 * bleiben dabei erhalten, Striche kommen getrennt vom Controller (onStroke/onStrokes).
 */
(function () {
  'use strict';

  const E = window.SkEngine;
  const { ROUND_OPTIONS, TIME_OPTIONS, HINT_OPTIONS, DRINK_OPTIONS, MIN_PLAYERS, MAX_PLAYERS, MAX_GUESS, Engine, sanitizeSettings } = E;
  const { StageController, ClientController, Store, KEYS, Net, inviteLink, qrSvg } = window.SkControllers;
  const { Sound, confetti, synth } = window.GameFx;
  const I = (name, opts) => window.GameIcons.svg(name, opts);
  const UI = window.GameUI;
  const { esc, session, plural } = UI;
  const Words = window.SkWords;
  const Sketch = window.GameSketch;
  const Fill = window.GameFill;

  const PEN_COLORS = ['#1f2937', '#9ca3af', '#ef4444', '#f97316', '#facc15', '#22c55e', '#38bdf8', '#2563eb', '#8b5cf6', '#ec4899', '#92400e', '#f5c9a0'];
  const PEN_WIDTHS = [0.006, 0.014, 0.03];
  const ERASER_FACTOR = 2.5;
  const LEVEL = { 0: { label: 'eigenes', color: '#a855f7' }, 1: { label: 'leicht', color: '#22c55e' }, 2: { label: 'mittel', color: '#f59e0b' }, 3: { label: 'schwer', color: '#ef4444' } };
  const REASON = {
    all: 'Alle haben es erraten!',
    time: 'Die Zeit ist um',
    reported: 'Gemeldet – der Zug zählt nicht',
    skip: 'Zug übersprungen',
    left: 'Die zeichnende Person ist weg',
  };
  const DRINK_LABEL = { off: 'Aus', on: 'An', free: 'Alkoholfrei' };
  const SETTINGS_KEY = 'skribbl.settings.v1';
  const PREFS_KEY = 'skribbl.prefs.v1';
  const ACTIVE_KEY = 'skribbl.active';
  const RESUME_MAX_AGE = 12 * 60 * 60 * 1000;

  const app = document.getElementById('app');

  /* ------------------------------------------------------------------ */
  /* Hilfsfunktionen                                                     */
  /* ------------------------------------------------------------------ */

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

  function curNo(v) {
    return v && v.cur ? v.cur.no : null;
  }

  function seconds(ms) {
    return Math.max(1, Math.round(ms / 1000));
  }

  function loadSettings() {
    return sanitizeSettings(Store.get(SETTINGS_KEY) || {});
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
    name: prefs.name || '',
    joinCode: Net.cleanCode(params.get('raum') || ''),
    error: null,
    modal: null,
    confirm: null,
    toast: null,
    focus: null,
    guess: '',
    feedback: null,
    customText: null, // Entwurf der eigenen Wörter in der Lobby (null = aus den Einstellungen)
    pen: { color: PEN_COLORS[0], width: PEN_WIDTHS[1], tool: 'pen' },
    sketch: null,
    strokeLog: [],
    strokeAt: null,
    thumbs: new Map(), // Galerie: Element → Sketch
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

  function feedback(text, kind) {
    ui.feedback = { text, kind };
    clearTimeout(ui.feedbackTimer);
    ui.feedbackTimer = setTimeout(() => {
      ui.feedback = null;
      render();
    }, 2600);
  }

  /** Spieleigene Sounds */
  const Fx = {
    /** Jemand hat es erraten */
    hit(first) {
      synth.tone(first ? 988 : 880, 0, 0.09, { type: 'triangle', vol: 0.1 });
      synth.tone(first ? 1480 : 1320, 0.08, 0.16, { type: 'triangle', vol: 0.1 });
    },
    /** Knapp daneben – ein kurzes „Hm?“ */
    close() {
      synth.tone(520, 0, 0.1, { type: 'sine', to: 700, vol: 0.08 });
    },
    /** Ein Buchstabe wird aufgedeckt */
    hint() {
      synth.tone(1200, 0, 0.06, { type: 'sine', vol: 0.06 });
      synth.tone(1600, 0.06, 0.08, { type: 'sine', vol: 0.05 });
    },
    /** Melden */
    report() {
      synth.tone(260, 0, 0.12, { type: 'square', vol: 0.05 });
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
    ui.screen = 'connecting';
    resetStrokes(null);
    session(ACTIVE_KEY, kind);
    try {
      ui.ctrl = factory(cb);
      // Die erste Ansicht kam schon während des Aufbaus – jetzt die gespeicherte Zeichnung nachladen
      if (ui.view && ui.view.me.stage && ui.ctrl.galleryOps && ui.view.cur) resetStrokes(ui.view.cur.no, ui.ctrl.galleryOps(ui.view.cur.no));
    } catch (err) {
      ui.ctrl = null;
      ui.token = null;
      session(ACTIVE_KEY, null);
      ui.screen = kind === 'client' ? 'join' : 'home';
      ui.error = 'Verbindung nicht möglich: ' + err.message;
      if (kind !== 'client') toast(ui.error);
    }
    render();
  }

  function stopController(keepSave) {
    if (ui.ctrl) ui.ctrl.leave(keepSave);
    ui.ctrl = null;
    ui.token = null;
    ui.view = null;
    ui.modal = null;
    ui.customText = null;
    destroySketches();
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
    if (curNo(prev) !== curNo(v)) {
      ui.guess = '';
      ui.feedback = null;
    }
    if (ui.strokeAt !== curNo(v)) {
      // Laptop: Zeichnung aus dem Controller (auch nach dem Neuladen), Handy: kommt per 'strokes'
      const ops = v.me.stage && v.cur && ui.ctrl && ui.ctrl.galleryOps ? ui.ctrl.galleryOps(v.cur.no) : null;
      resetStrokes(curNo(v), ops);
    }
    if (v.me.stage && v.phase === 'lobby') Store.set(SETTINGS_KEY, v.settings);
    transitions(prev, v);
    render();
  }

  function handleStroke(msg, at) {
    if (at !== curNo(ui.view)) return;
    ui.strokeLog.push(msg);
    if (ui.sketch) ui.sketch.apply(msg);
  }

  function handleStrokes(all, at) {
    if (at !== curNo(ui.view)) return;
    ui.strokeLog = all.slice();
    ui.strokeAt = at;
    if (ui.sketch) ui.sketch.loadAll(ui.strokeLog);
  }

  function resetStrokes(no, ops) {
    ui.strokeLog = ops ? ops.slice() : [];
    ui.strokeAt = no;
    if (ui.sketch) ui.sketch.loadAll(ui.strokeLog);
  }

  function handleStatus(status, info) {
    ui.status = status;
    if (status === 'error') {
      const msg = UI.connectError((info || {}).error);
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

  /** Sounds, Konfetti und Rückmeldungen bei Zustandswechseln */
  function transitions(prev, v) {
    if (!prev) return;
    const stage = !!v.me.stage;
    const c = v.cur;
    const pc = prev.cur;
    if (v.phase === 'over' && prev.phase !== 'over') {
      Sound.fanfare();
      setTimeout(() => confetti(['#fde047', '#f472b6', '#38bdf8', '#ffffff'], 220), 150);
      return;
    }
    if (!c) return;
    const me = v.me.id;
    if (!pc || pc.no !== c.no) {
      Sound.flip();
      if (!stage && c.drawer === me) vibrate([80, 60, 80]);
      if (v.phase !== 'draw') return;
    }
    const samePhase = pc && pc.no === c.no && prev.phase === v.phase;
    if (v.phase === 'draw' && !samePhase) Sound.start();
    if (v.phase === 'draw' && samePhase) {
      // Neue Treffer
      if (c.hits.length > pc.hits.length) {
        const fresh = c.hits.filter((pid) => !pc.hits.includes(pid));
        if (!stage && fresh.includes(me)) {
          Sound.success();
          vibrate([60, 50, 60]);
          feedback(`${I('check')} Richtig! +${c.mine ? c.mine.pts : ''}`, 'ok');
        } else Fx.hit(pc.hits.length === 0);
      }
      // Knapp daneben (nur für mich)
      const close = c.chat.filter((x) => x.kind === 'close' && x.pid === me).pop();
      const seen = pc.chat.length ? pc.chat[pc.chat.length - 1].n : 0;
      if (close && close.n > seen) {
        Fx.close();
        feedback(`${I('target')} „${close.text}“ ist knapp daneben!`, 'close');
      }
      if (c.mask && pc.mask && c.mask !== pc.mask) Fx.hint();
      if (c.reports > pc.reports) Fx.report();
    }
    if (v.phase === 'reveal' && !samePhase) {
      const r = c.result;
      if (r.reason === 'all') Sound.success();
      else if (!r.gains.length) Sound.fail();
      else Sound.flip();
      if (stage && r.reason === 'all') setTimeout(() => confetti(['#22c55e', '#fde047', '#ffffff'], 120), 200);
    }
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
      el.classList.toggle('urgent', sec <= 10 && total > 20000);
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
      case 'join':
        html = joinHtml();
        break;
      case 'connecting':
        html = UI.connecting(ui.status);
        break;
      case 'stage':
        html = ui.view ? stageHtml(ui.view) : UI.connecting(ui.status);
        break;
      case 'player':
        html = ui.view ? playerHtml(ui.view) : UI.connecting(ui.status);
        break;
      default:
        html = homeHtml();
    }
    html += modalHtml();
    if (ui.toast) html += `<div class="toast" role="status">${esc(ui.toast)}</div>`;
    window.morphdom(app, `<div id="app">${html}</div>`, {
      onBeforeElUpdated(fromEl, toEl) {
        if (fromEl.hasAttribute('data-keep') && toEl.hasAttribute('data-keep')) {
          // Attribute übernehmen, Kinder (Zeichenfläche) behalten
          for (const { name, value } of [...toEl.attributes]) {
            if (fromEl.getAttribute(name) !== value) fromEl.setAttribute(name, value);
          }
          return false;
        }
        if (fromEl === document.activeElement && (fromEl.tagName === 'INPUT' || fromEl.tagName === 'TEXTAREA')) return false;
        return true;
      },
    });
    afterRender();
  }

  function afterRender() {
    mountSketch();
    mountThumbs();
    for (const el of app.querySelectorAll('[data-autoscroll]')) el.scrollTop = 0;
    if (ui.focus) {
      const el = app.querySelector(ui.focus);
      ui.focus = null;
      if (el) {
        el.focus();
        if (el.setSelectionRange && el.value) el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }

  /* ---------- Zeichenflächen ---------- */

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
        fill: Fill.paint,
        maxDpr: 2,
        onLocal: (msg) => {
          const at = curNo(ui.view);
          ui.strokeLog.push(msg);
          if (ui.ctrl && at != null) ui.ctrl.sendStroke(msg, at);
        },
      });
      ui.sketch.loadAll(ui.strokeLog);
    }
    ui.sketch.setEditable(host.dataset.editable === '1');
    applyPen();
  }

  function applyPen() {
    const sk = ui.sketch;
    if (!sk) return;
    const p = ui.pen;
    if (p.tool === 'eraser') {
      sk.setTool('pen');
      sk.setColor(Sketch.BG);
      sk.setWidth(p.width * ERASER_FACTOR);
    } else {
      sk.setTool(p.tool);
      sk.setColor(p.color);
      sk.setWidth(p.width);
    }
  }

  /** Galerie am Spielende: kleine Zeichenflächen, gefüllt aus dem Controller */
  function mountThumbs() {
    const hosts = new Set(app.querySelectorAll('[data-gallery]'));
    for (const [el, sk] of ui.thumbs) {
      if (!hosts.has(el)) {
        sk.destroy();
        ui.thumbs.delete(el);
      }
    }
    for (const el of hosts) {
      if (ui.thumbs.has(el)) continue;
      const sk = new Sketch(el, { fill: Fill.paint, maxDpr: 1.5 });
      const ops = ui.ctrl && ui.ctrl.galleryOps ? ui.ctrl.galleryOps(+el.dataset.gallery) : null;
      sk.loadAll(ops || []);
      ui.thumbs.set(el, sk);
    }
  }

  function destroySketches() {
    if (ui.sketch) {
      ui.sketch.destroy();
      ui.sketch = null;
    }
    for (const sk of ui.thumbs.values()) sk.destroy();
    ui.thumbs.clear();
  }

  /* ---------- Bausteine ---------- */

  function logoHtml(small) {
    return UI.logo('Skribbl', 'pencil', small);
  }

  function seg(key, options, value, fmt, disabled) {
    return `<div class="seg" role="group">${options
      .map(
        (o) =>
          `<button class="seg-btn ${o === value ? 'on' : ''}" data-act="set" data-key="${key}" data-value="${o}" aria-pressed="${o === value}" ${disabled ? 'disabled' : ''}>${fmt(o)}</button>`
      )
      .join('')}</div>`;
  }

  function switchHtml(on, key) {
    return `<button class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" data-act="toggle" data-key="${key}">
      <span class="switch-knob"></span><span class="switch-text">${on ? 'An' : 'Aus'}</span>
    </button>`;
  }

  function timerHtml(timer, opts) {
    if (!timer) return '';
    const o = opts || {};
    const sec = Math.ceil(timer.remaining / 1000);
    if (o.clock) {
      return `<span class="clock" data-timer ${o.tick ? 'data-tick' : ''} data-rem="${Math.round(timer.remaining)}" data-total="${timer.total}">${I('clock')} <b data-timer-text>${sec}</b></span>`;
    }
    return `<div class="timer ${o.cls || ''}" data-timer data-rem="${Math.round(timer.remaining)}" data-total="${timer.total}">
      <div class="timer-bar"><span data-timer-bar style="width:${(100 * timer.remaining) / (timer.total || 1)}%"></span></div>
      <b data-timer-text>${sec}</b>
    </div>`;
  }

  /** Wort als Lücken („_ _ _ A _“), offen gezeigt oder ganz aufgedeckt */
  function maskHtml(text, lengths, opts) {
    const o = opts || {};
    if (!text) return '';
    const slots = [...text]
      .map((ch) => {
        if (ch === ' ') return '<span class="gap"></span>';
        if (ch === '_') return '<span class="slot"></span>';
        return `<span class="slot open">${esc(ch)}</span>`;
      })
      .join('');
    const len = lengths && lengths.length ? `<small class="mask-len">${lengths.join(' ')}</small>` : '';
    return `<div class="mask ${o.word ? 'is-word' : ''} ${o.small ? 'mask-small' : ''}" aria-label="${o.word ? esc(text) : `Gesuchtes Wort, ${(lengths || []).join(' + ')} Buchstaben`}">${slots}${len}</div>`;
  }

  function levelHtml(level) {
    const l = LEVEL[level] || LEVEL[2];
    return `<span class="level" style="--lv:${l.color}">${l.label}</span>`;
  }

  /** Chat-Zeilen (neueste unten). max: nur die letzten n */
  function chatHtml(v, list, opts) {
    const o = opts || {};
    const items = o.max ? list.slice(-o.max) : list;
    const firstHit = list.find((x) => x.kind === 'hit');
    const rows = items
      .map((x) => {
        const color = x.pid ? colorOf(v, x.pid) : '#e5e7eb';
        const who = `<b style="color:${esc(color)}">${esc(x.name)}</b>`;
        if (x.kind === 'hit') return `<li class="msg hit">${firstHit && firstHit.n === x.n ? I('zap') : I('check')} ${who} hat es!</li>`;
        if (x.kind === 'close') return `<li class="msg close">${I('target')} „${esc(x.text)}“ – knapp daneben!</li>`;
        if (x.kind === 'insider') return `<li class="msg insider" title="Nur für alle, die es schon haben">${I('lock')} ${who} ${esc(x.text)}</li>`;
        if (x.kind === 'sys') return `<li class="msg sys">${esc(x.text)}</li>`;
        return `<li class="msg">${who} ${esc(x.text)}</li>`;
      })
      .reverse()
      .join('');
    if (!rows) return `<div class="chat chat-empty ${o.cls || ''}"><p class="muted small">${esc(o.empty || 'Noch keine Tipps …')}</p></div>`;
    return `<ol class="chat ${o.cls || ''}" data-autoscroll>${rows}</ol>`;
  }

  /* ---------- Startseite ---------- */

  function homeHtml() {
    const saves = savedGames();
    const resume = [];
    if (saves.stage) {
      const st = saves.stage.state;
      resume.push(`
        <div class="resume">
          <button class="btn btn-ghost btn-wide" data-act="resume-stage">${I('play')} Spiel fortsetzen
            <small>${st.phase === 'lobby' ? 'Lobby' : esc(st.players.map((p) => p.name).join(' · '))}</small></button>
          <button class="icon-btn" data-act="discard-stage" title="Spielstand löschen" aria-label="Spielstand löschen">${I('x')}</button>
        </div>`);
    }
    if (saves.client) {
      resume.push(`
        <div class="resume">
          <button class="btn btn-ghost btn-wide" data-act="resume-client">${I('play')} Zurück ins Spiel
            <small>Raum ${esc(saves.client.code)} · als ${esc(saves.client.name)}</small></button>
          <button class="icon-btn" data-act="discard-client" title="Verwerfen" aria-label="Verwerfen">${I('x')}</button>
        </div>`);
    }
    const st = Words.stats();
    return `
    <div class="screen home">
      ${UI.hubBack()}
      <div class="home-hero">
        ${logoHtml()}
        <p class="tagline">Eine Person <b>zeichnet</b>, alle anderen <b>tippen</b> – wer schneller richtig liegt, bekommt mehr Punkte.</p>
        <div class="home-doodle" aria-hidden="true">
          <span class="doodle-card" style="--r:-7deg"></span>
          <span class="doodle-chat">
            <span>Pferd?</span><span>Kamel</span><span class="ok">${I('zap')} Anna hat es!</span>
          </span>
        </div>
      </div>
      ${ui.error && ui.screen === 'home' ? `<div class="alert">${esc(ui.error)}</div>` : ''}
      ${resume.join('')}
      <div class="mode-cards">
        ${UI.modeCard({ cls: 'mode-stage', act: 'new-game', icon: 'laptop', title: 'Spiel anlegen', text: 'Am Laptop, Tablet oder Fernseher: Er ist die Bühne – die Zeichnung erscheint hier live.', go: "Los geht's" })}
        ${UI.modeCard({ cls: 'mode-phone', act: 'join-screen', icon: 'phone', title: 'Mitspielen', text: 'Mit dem Handy beitreten – QR-Code am Laptop scannen oder Raum-Code eingeben.', go: 'Beitreten' })}
      </div>
      <div class="home-links">
        <button class="btn btn-link" data-act="rules">${I('book')} Spielregeln</button>
      </div>
      <p class="home-foot">${MIN_PLAYERS}–${MAX_PLAYERS} Personen · Laptop + Handys · ${st.total} Begriffe in ${st.packs} Paketen</p>
    </div>`;
  }

  /* ---------- Beitreten (Handy) ---------- */

  function joinHtml() {
    return `
    <div class="screen join">
      <header class="screen-head">
        <button class="back-btn" data-act="home">${I('back')} Zurück</button>
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

  /* ------------------------------------------------------------------ */
  /* Laptop (Bühne)                                                      */
  /* ------------------------------------------------------------------ */

  function topbarHtml(v) {
    const c = v.cur;
    let info = '';
    if (v.phase === 'over') info = `<span class="pill">${I('flag')} Spielende</span>`;
    else if (c) {
      info = `<span class="pill">Runde ${c.round} / ${v.rounds}</span>
        <span class="pill pill-drawer" style="${tc(colorOf(v, c.drawer))}"><span class="team-dot"></span>${esc(c.drawerName)} ${v.phase === 'choose' ? 'wählt' : 'zeichnet'}${v.settings.drawOn === 'laptop' && v.phase === 'draw' ? ' – hier am Laptop' : ''}</span>
        ${v.phase !== 'reveal' ? timerHtml(c.timer, { clock: true, tick: v.phase === 'draw' }) : ''}`;
    }
    const room = v.room && v.room.code && v.phase !== 'lobby' ? `<button class="pill pill-room" data-act="show-qr" title="Mitspieler einladen">${I('phone')} ${esc(v.room.code)}</button>` : '';
    return `
      <header class="topbar">
        <button class="topbar-brand" data-act="menu" aria-label="Menü">${logoHtml(true)}</button>
        <div class="topbar-info">${info}${room}</div>
        ${UI.topbarActions(Sound.muted)}
      </header>`;
  }

  function stageHtml(v) {
    let main;
    if (v.phase === 'lobby') main = `<main class="stage-main">${lobbyStageHtml(v)}</main>`;
    else if (v.phase === 'over') main = `<main class="stage-main">${overHtml(v)}</main>`;
    else main = playStageHtml(v);
    return `
      <div class="stage phase-${v.phase}">
        ${topbarHtml(v)}
        ${main}
      </div>`;
  }

  /* ---------- Lobby ---------- */

  function settingsHtml(s) {
    return `<div class="settings">
      <div class="setting">
        <div class="setting-label"><b>${I('refresh')} Runden</b><small>In jeder Runde zeichnet jede/r einmal</small></div>
        ${seg('rounds', ROUND_OPTIONS, s.rounds, String)}
      </div>
      <div class="setting">
        <div class="setting-label"><b>${I('clock')} Zeichenzeit</b><small>Je schneller jemand richtig liegt, desto mehr Punkte</small></div>
        ${seg('time', TIME_OPTIONS, s.time, (o) => o + ' s')}
      </div>
      <div class="setting">
        <div class="setting-label"><b>${I('target')} Wortwahl</b><small>${s.choice === 'pick' ? 'Die zeichnende Person wählt aus 3 Begriffen (leicht, mittel, schwer)' : 'Der Begriff wird zufällig gezogen'}</small></div>
        ${seg('choice', ['pick', 'random'], s.choice, (o) => (o === 'pick' ? '3 zur Auswahl' : 'Zufällig'))}
      </div>
      <div class="setting">
        <div class="setting-label"><b>${I('lightbulb')} Hinweis-Buchstaben</b><small>${s.hints ? `Nach der Hälfte${s.hints > 1 ? ' und nach drei Vierteln' : ''} der Zeit wird ein Buchstabe aufgedeckt` : 'Nur die Lücken, keine Buchstaben'}</small></div>
        ${seg('hints', HINT_OPTIONS, s.hints, String)}
      </div>
      <div class="setting">
        <div class="setting-label"><b>${I('pencil')} Zeichnen auf</b><small>${s.drawOn === 'phone' ? 'Gezeichnet wird auf dem Handy, die Bühne zeigt es live' : 'Die zeichnende Person kommt an den Laptop (Maus oder Touchscreen) – das Wort steht auf ihrem Handy'}</small></div>
        ${seg('drawOn', ['phone', 'laptop'], s.drawOn, (o) => (o === 'phone' ? 'Handy' : 'Laptop'))}
      </div>
      <div class="setting">
        <div class="setting-label"><b>${I('speak')} Chat am Laptop</b><small>Falsche Tipps laufen über die Bühne – aus: nur „hat es!“</small></div>
        ${switchHtml(s.chat, 'chat')}
      </div>
      <div class="setting">
        <div class="setting-label"><b>${I('glass')} Trinkregeln</b><small>${s.drinks === 'off' ? 'Normales Spiel' : `Niemand errät es → die zeichnende Person ${s.drinks === 'free' ? 'bekommt 2 Strafpunkte' : 'trinkt 2'} · wer es als Letzte/r errät → 1`}</small></div>
        ${seg('drinks', DRINK_OPTIONS, s.drinks, (o) => DRINK_LABEL[o])}
      </div>
    </div>`;
  }

  function wordsPanelHtml(s) {
    const packs = Words.packs();
    const chips = packs
      .map((p) => {
        const on = s.packs.includes(p.id);
        return `<button class="pack ${on ? 'on' : ''}" data-act="pack" data-pack="${p.id}" aria-pressed="${on}" ${s.customOnly ? 'disabled' : ''}>
          <span>${UI.icon(p.icon)}</span> ${esc(p.label)} <small>${p.count}</small></button>`;
      })
      .join('');
    const text = ui.customText != null ? ui.customText : s.custom.join('\n');
    const n = s.custom.length;
    return `<section class="panel">
      <h2>${I('book')} Begriffe</h2>
      <div class="packs">${chips}</div>
      <label class="label" for="custom-words">${I('pencil')} Eigene Wörter <small class="muted">(eins pro Zeile oder mit Komma – z.B. eure Insider)</small></label>
      <textarea id="custom-words" class="input textarea" rows="3" maxlength="6000" placeholder="Omas Dackel, Partykeller, …" data-field="custom-words">${esc(text)}</textarea>
      <div class="setting">
        <div class="setting-label"><b>Nur eigene Wörter</b><small>${n ? `${n} ${plural(n, 'eigenes Wort', 'eigene Wörter')} – ${s.customOnly ? 'es kommen nur diese dran' : 'werden unter die Pakete gemischt'}` : 'Noch keine eigenen Wörter'}</small></div>
        ${switchHtml(s.customOnly, 'customOnly')}
      </div>
    </section>`;
  }

  function lobbyStageHtml(v) {
    const chip = (p) => `<span class="chip ${p.online ? '' : 'is-offline'}" style="${tc(p.color)}"><span class="team-dot"></span>${esc(p.name)}<button class="chip-x" data-act="kick" data-player="${esc(p.id)}" aria-label="${esc(p.name)} entfernen">${I('x')}</button></span>`;
    const watching = v.members.filter((m) => !m.playing);
    return `
      <div class="lobby-grid">
        <section class="panel join-panel">
          <h2>${I('phone')} Handys verbinden</h2>
          <p class="muted">QR-Code scannen, Namen eingeben – los geht's.</p>
          ${UI.roomBox(v.room, true)}
        </section>
        <div class="lobby-side">
          <section class="panel">
            <h2>Mitspieler <small class="muted">(${v.players.length} / ${MAX_PLAYERS})</small></h2>
            <div class="chips">${v.players.length ? v.players.map(chip).join('') : '<span class="muted">Noch niemand – QR-Code scannen!</span>'}</div>
            ${watching.length ? `<div class="free"><b>Schauen nur zu:</b> <div class="chips">${watching.map((m) => `<span class="chip ${m.online ? '' : 'is-offline'}">${esc(m.name)}<button class="chip-x" data-act="kick" data-player="${esc(m.id)}" aria-label="${esc(m.name)} entfernen">${I('x')}</button></span>`).join('')}</div></div>` : ''}
            <p class="muted small">Gezeichnet wird in dieser Reihenfolge.</p>
          </section>
          ${UI.settingsSummary(UI.settingsParts(settingsHtml(v.settings)))}
          <div class="sticky-start">
            <button class="btn btn-primary btn-big" data-act="start" ${v.lobbyProblem ? 'disabled' : ''}>Los geht's ${I('pencil')}</button>
            ${v.lobbyProblem ? `<p class="muted small center">${esc(v.lobbyProblem)}</p>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ---------- Spiel ---------- */

  function penToolsHtml() {
    const p = ui.pen;
    const colors = PEN_COLORS.map(
      (c) => `<button class="pen-color ${p.tool !== 'eraser' && p.color === c ? 'on' : ''}" style="--c:${c}" data-act="pen-color" data-value="${c}" aria-label="Farbe ${c}"></button>`
    ).join('');
    const widths = PEN_WIDTHS.map(
      (w, i) => `<button class="pen-width ${p.tool !== 'fill' && p.width === w ? 'on' : ''}" data-act="pen-width" data-value="${w}" aria-label="Strichstärke ${i + 1}"><span style="--s:${4 + i * 6}px"></span></button>`
    ).join('');
    return `
      <div class="pen-tools" role="toolbar" aria-label="Zeichenwerkzeuge">
        <div class="pen-row pen-colors">${colors}</div>
        <div class="pen-row">
          ${widths}
          <span class="pen-sep"></span>
          <button class="pen-btn ${p.tool === 'pen' ? 'on' : ''}" data-act="pen-tool" data-value="pen" aria-label="Stift" title="Stift">${I('pencil')}</button>
          <button class="pen-btn ${p.tool === 'fill' ? 'on' : ''}" data-act="pen-tool" data-value="fill" aria-label="Farbeimer" title="Farbeimer">${I('bucket')}</button>
          <button class="pen-btn ${p.tool === 'eraser' ? 'on' : ''}" data-act="pen-tool" data-value="eraser" aria-label="Radierer" title="Radierer">${I('eraser')}</button>
          <button class="pen-btn" data-act="pen-undo" aria-label="Rückgängig" title="Rückgängig">${I('undo')}</button>
          <button class="pen-btn" data-act="pen-clear" aria-label="Alles löschen" title="Alles löschen">${I('trash')}</button>
        </div>
      </div>`;
  }

  function scoreboardHtml(v) {
    const c = v.cur;
    const gains = c && c.result ? Object.fromEntries(c.result.gains.map((g) => [g.pid, g.pts])) : {};
    if (c && c.result && c.result.drawerPts) gains[c.drawer] = c.result.drawerPts;
    const list = v.players.slice().sort((a, b) => a.rank - b.rank || v.players.indexOf(a) - v.players.indexOf(b));
    return `<footer class="sk-scores">${list
      .map((p) => {
        const drawing = c && c.drawer === p.id;
        const hit = c && c.hits.includes(p.id);
        const gain = gains[p.id];
        return `<div class="sk-score ${p.online ? '' : 'is-off'} ${hit ? 'is-hit' : ''} ${drawing ? 'is-drawing' : ''}" style="${tc(p.color)}" id="sc-${esc(p.id)}">
          <span class="sk-rank">${p.rank}.</span>
          <span class="team-dot"></span>
          <b class="sk-name">${esc(p.name)}</b>
          <span class="sk-mark">${drawing ? I('pencil') : hit ? I('check') : ''}</span>
          <span class="sk-pts">${p.score}</span>
          ${gain ? `<span class="sk-gain" id="gain-${esc(p.id)}-${c.no}">+${gain}</span>` : ''}
          ${v.settings.drinks !== 'off' && p.drinks ? `<span class="sk-drinks" title="${v.settings.drinks === 'free' ? 'Strafpunkte' : 'Schlucke'}">${v.settings.drinks === 'free' ? I('alert') : I('glass')}${p.drinks}</span>` : ''}
        </div>`;
      })
      .join('')}</footer>`;
  }

  function drinksHtml(v, r) {
    if (!r.drinks.length || v.settings.drinks === 'off') return '';
    const unit = (n) => (v.settings.drinks === 'free' ? `${n} ${plural(n, 'Strafpunkt', 'Strafpunkte')}` : `${n} ${plural(n, 'Schluck', 'Schlucke')}`);
    return `<div class="drinks">${r.drinks
      .map((d) => `<span>${v.settings.drinks === 'free' ? I('alert') : I('glass')} <b>${esc(d.name)}</b> ${unit(d.n)} – ${d.why === 'none' ? 'niemand hat es erraten' : 'als Letzte/r erraten'}</span>`)
      .join('')}</div>`;
  }

  function revealBoxHtml(v, opts) {
    const c = v.cur;
    const r = c.result;
    const o = opts || {};
    const gains = r.gains
      .map((g, i) => `<li><span class="team-dot" style="${tc(colorOf(v, g.pid))}"></span><b>${esc(g.name)}</b> <span class="gain">+${g.pts}</span> <small class="muted">${i === 0 ? I('zap') + ' ' : ''}${seconds(g.ms)} s</small></li>`)
      .join('');
    return `
      <div class="reveal-box" id="rv-${c.no}">
        <small class="reveal-label">Das Wort war</small>
        <b class="reveal-word">${esc(c.word)}</b>
        <p class="reveal-reason">${REASON[r.reason] || ''}${r.reason !== 'reported' && r.guessers ? ` · ${r.gains.length} von ${r.guessers}` : ''}</p>
        ${gains ? `<ol class="gains">${gains}</ol>` : ''}
        <p class="drawer-gain"><span class="team-dot" style="${tc(colorOf(v, c.drawer))}"></span>${I('pencil')} <b>${esc(c.drawerName)}</b> <span class="gain">+${r.drawerPts}</span> <small class="muted">für die Zeichnung</small></p>
        ${drinksHtml(v, r)}
        ${o.next ? `<button class="btn btn-primary" data-act="next" data-at="${c.no}">Weiter ${I('next')} ${timerHtml(c.timer, { clock: true })}</button>` : ''}
      </div>`;
  }

  function playStageHtml(v) {
    const c = v.cur;
    const editable = v.phase === 'draw' && c.canDraw;
    let overlay = '';
    if (v.phase === 'choose') {
      overlay = `<div class="board-overlay"><div class="choose-box">
        <span class="choose-icon" aria-hidden="true">${I('thinking')}</span>
        <b>${esc(c.drawerName)} wählt ein Wort …</b>
        <small class="muted">${v.settings.drawOn === 'laptop' ? `Gleich kommt ${esc(c.drawerName)} an den Laptop zum Zeichnen.` : 'Gleich geht es los – Handys bereithalten!'}</small>
        ${timerHtml(c.timer, { cls: 'timer-small' })}
      </div></div>`;
    } else if (v.phase === 'reveal') {
      overlay = `<div class="board-overlay is-reveal">${revealBoxHtml(v, { next: true })}</div>`;
    }
    const line = v.phase === 'reveal' ? maskHtml(c.word, c.lengths, { word: true }) : maskHtml(c.mask, c.lengths);
    const open = c.guessers.length;
    const status =
      v.phase === 'draw'
        ? `<p class="board-status">${c.hits.length ? `${I('check')} ${c.hits.length} von ${open} ${plural(c.hits.length, 'hat', 'haben')} es` : 'Noch niemand hat es'}${c.reports ? ` · ${I('flag')} ${c.reports}× gemeldet` : ''}</p>`
        : '';
    return `
      <main class="play">
        <section class="board">
          <div class="sketch-frame">
            <div class="sketch-host" id="sketch-host" data-keep data-sketch data-editable="${editable ? '1' : '0'}"></div>
            ${overlay}
          </div>
          <div class="board-line">${line}</div>
          ${v.phase === 'draw' ? timerHtml(c.timer, { cls: 'timer-board' }) : ''}
          ${editable ? penToolsHtml() : status}
        </section>
        <aside class="chat-col">
          <h2 class="chat-title">${I('speak')} Tipps${v.settings.chat ? '' : ' <small class="muted">(Chat aus)</small>'}</h2>
          ${chatHtml(v, c.chat, { empty: v.phase === 'choose' ? 'Gleich geht es los …' : 'Noch keine Tipps …' })}
        </aside>
      </main>
      ${scoreboardHtml(v)}`;
  }

  /* ---------- Spielende ---------- */

  function podiumHtml(v) {
    const ranked = v.players.slice().sort((a, b) => b.score - a.score);
    const medals = [I('trophy'), I('medal'), I('medal')];
    const top = ranked.slice(0, 3);
    return `<div class="podium">${top
      .map(
        (p, i) => `<div class="podium-step p${i + 1}" style="${tc(p.color)}">
          <span class="podium-medal">${medals[i]}</span>
          <b>${esc(p.name)}</b>
          <span>${p.score} Punkte</span>
          <div class="podium-block">${p.rank}</div>
        </div>`
      )
      .join('')}</div>
      ${ranked.length > 3 ? `<ol class="ranking" start="4">${ranked.slice(3).map((p) => `<li style="${tc(p.color)}"><span class="team-dot"></span><b>${esc(p.name)}</b> <span>${p.score}</span></li>`).join('')}</ol>` : ''}`;
  }

  function awardsHtml(v) {
    return (v.awards || []).map((a) => `<div class="award"><span class="award-icon">${UI.icon(a.icon)}</span><div><b>${esc(a.title)}</b><small>${esc(a.text)}</small></div></div>`).join('');
  }

  function galleryHtml(v) {
    const riddle = (v.awards || []).find((a) => a.no);
    const items = (v.history || []).filter((h) => !['skip', 'left'].includes(h.reason));
    if (!items.length) return '';
    return `<section class="panel gallery-panel">
      <h2>${I('image')} Galerie <small class="muted">(${items.length} ${plural(items.length, 'Zeichnung', 'Zeichnungen')})</small></h2>
      <div class="gallery">${items
        .map(
          (h) => `<figure class="gallery-item ${riddle && riddle.no === h.no ? 'is-riddle' : ''}">
            <div class="gallery-host" id="g-${h.no}" data-keep data-gallery="${h.no}"></div>
            <figcaption><b>${esc(h.word)}</b><small>${I('pencil')} ${esc(h.drawerName)} · ${h.reason === 'reported' ? 'gemeldet' : `${h.hits} / ${h.guessers} erkannt`}</small></figcaption>
          </figure>`
        )
        .join('')}</div>
    </section>`;
  }

  function overHtml(v) {
    const ranked = v.players.slice().sort((a, b) => b.score - a.score);
    const winners = ranked.filter((p) => ranked[0] && p.score === ranked[0].score);
    const title = !ranked.length ? 'Spiel vorbei!' : winners.length > 1 ? `${I('users')} Gleichstand: ${winners.map((p) => esc(p.name)).join(' & ')}` : `${I('trophy')} ${esc(winners[0].name)} gewinnt!`;
    const drinks = v.settings.drinks !== 'off' && v.players.some((p) => p.drinks)
      ? `<p class="center muted">${v.settings.drinks === 'free' ? 'Strafpunkte' : 'Schlucke'}: ${v.players.filter((p) => p.drinks).map((p) => `${esc(p.name)} ${p.drinks}`).join(' · ')}</p>`
      : '';
    const awards = awardsHtml(v);
    return `
      <div class="center-stage over">
        <h1 class="over-title">${title}</h1>
        ${podiumHtml(v)}
        ${drinks}
        ${awards ? `<div class="awards">${awards}</div>` : ''}
        ${galleryHtml(v)}
        <div class="stage-actions">
          <button class="btn btn-primary btn-big" data-act="again">${I('refresh')} Nochmal</button>
          <button class="btn btn-ghost" data-act="home">Hauptmenü</button>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Handy                                                               */
  /* ------------------------------------------------------------------ */

  function playerHtml(v) {
    const me = v.me;
    const p = player(v, me.id);
    const c = v.cur;
    let body;
    if (v.phase === 'lobby') body = phoneLobbyHtml(v, p);
    else if (v.phase === 'over') body = phoneOverHtml(v, p);
    else if (v.phase === 'choose') body = phoneChooseHtml(v);
    else if (v.phase === 'draw') body = c.drawer === me.id ? phoneDrawHtml(v) : phoneGuessHtml(v, p);
    else body = phoneRevealHtml(v, p);
    const info = c && v.phase !== 'over' ? `<span class="phone-round">Runde ${c.round}/${v.rounds}</span>${v.phase !== 'reveal' ? timerHtml(c.timer, { clock: true }) : ''}` : '';
    const drawing = v.phase === 'draw' && c && c.drawer === me.id && c.canDraw;
    return `
      <div class="phone ${drawing ? 'is-drawing' : ''}" style="${tc(p ? p.color : '#94a3b8')}">
        <header class="phone-head">
          <span class="team-dot"></span>
          <b>${esc(me.name)}</b>
          <span class="phone-name">${p ? `${p.score} Pkt.` : 'Zuschauer'}</span>
          ${info}
          <button class="icon-btn" data-act="menu" aria-label="Menü">${I('menu')}</button>
        </header>
        ${UI.statusBanner(ui.status)}
        <main class="phone-main">${body}</main>
      </div>`;
  }

  function phoneLobbyHtml(v, p) {
    const n = v.players.length;
    if (!p) {
      return `<div class="look-up">${I('eye')}<b>Du schaust zu</b><small>${n} ${plural(n, 'Person spielt', 'Personen spielen')}</small></div>
        ${n < MAX_PLAYERS ? `<button class="btn btn-primary btn-big btn-wide" data-act="watch" data-watch="0">${I('pencil')} Mitspielen</button>` : '<p class="muted center">Das Spiel ist voll.</p>'}`;
    }
    return `<div class="look-up">${I('pencil')}<b>Du bist dabei!</b><small>${n} ${plural(n, 'Person', 'Personen')} im Spiel${n < MIN_PLAYERS ? ` – ab ${MIN_PLAYERS} geht's los` : ''}</small></div>
      <p class="waiting">Warte, bis es am Laptop losgeht…</p>
      <p class="muted small center">Tipp: Beim Zeichnen das Handy hochkant halten.</p>
      <button class="btn btn-link" data-act="watch" data-watch="1">Doch nur zuschauen</button>`;
  }

  function phoneChooseHtml(v) {
    const c = v.cur;
    if (c.drawer !== v.me.id) {
      return `<div class="look-up">${I('thinking')}<b>${esc(c.drawerName)} wählt ein Wort …</b><small>Gleich geht es los – schau auf den Laptop!</small></div>
        ${timerHtml(c.timer, { cls: 'timer-small' })}`;
    }
    const opts = (c.options || [])
      .map((o, i) => `<button class="word-option" style="--lv:${(LEVEL[o.level] || LEVEL[2]).color}" data-act="choose" data-i="${i}" data-at="${c.no}"><b>${esc(o.word)}</b>${levelHtml(o.level)}</button>`)
      .join('');
    return `<h2 class="phone-title">${I('pencil')} Du zeichnest! Wähle ein Wort:</h2>
      <div class="word-options">${opts}</div>
      ${timerHtml(c.timer, { cls: 'timer-small' })}
      <p class="muted small center">Schwere Wörter sind riskant: Erkennt es niemand, gibt es für dich keine Punkte.${v.settings.drawOn === 'laptop' ? ' <b>Gezeichnet wird am Laptop.</b>' : ''}</p>`;
  }

  function hitStatusHtml(c) {
    const n = c.guessers.length;
    return `<p class="draw-status">${c.hits.length ? `${I('check')} ${c.hits.length} von ${n} ${plural(c.hits.length, 'hat', 'haben')} es` : 'Noch niemand hat es'}${c.reports ? ` · ${I('flag')} ${c.reports}× gemeldet` : ''}</p>`;
  }

  function phoneDrawHtml(v) {
    const c = v.cur;
    const word = `<div class="draw-word"><small>Zeichne</small><b>${esc(c.word)}</b></div>`;
    if (!c.canDraw) {
      // Gezeichnet wird am Laptop
      return `${word}
        <div class="look-up">${I('laptop')}<b>Zeichne am Laptop!</b><small>Nur du siehst das Wort – keine Buchstaben, keine Zahlen.</small></div>
        ${hitStatusHtml(c)}
        ${chatHtml(v, c.chat, { max: 5, cls: 'chat-phone' })}`;
    }
    return `${word}
      <div class="sketch-frame phone-sketch">
        <div class="sketch-host" id="sketch-host" data-keep data-sketch data-editable="1"></div>
      </div>
      ${penToolsHtml()}
      ${hitStatusHtml(c)}
      ${chatHtml(v, c.chat, { max: 3, cls: 'chat-phone' })}`;
  }

  function phoneGuessHtml(v, p) {
    const c = v.cur;
    const hit = !!c.mine;
    const line = hit ? maskHtml(c.word, c.lengths, { word: true }) : maskHtml(c.mask, c.lengths);
    const preview = `<div class="sketch-frame phone-sketch is-preview">
        <div class="sketch-host" id="sketch-host" data-keep data-sketch data-editable="0"></div>
      </div>`;
    if (!p) {
      return `<div class="board-line">${line}</div>${preview}${chatHtml(v, c.chat, { max: 5, cls: 'chat-phone' })}`;
    }
    const fb = ui.feedback ? `<p class="feedback fb-${ui.feedback.kind}" role="status">${esc(ui.feedback.text)}</p>` : '';
    const mine = hit ? `<div class="you-hit">${I('check')} <b>Du hast es!</b> +${c.mine.pts} <small>${c.mine.rank === 1 ? 'Als Erste/r!' : `als ${c.mine.rank}.`}</small></div>` : '';
    const report = !hit
      ? `<button class="btn btn-link btn-report ${c.reported ? 'on' : ''}" data-act="report" data-at="${c.no}" title="Buchstaben, Zahlen oder Unpassendes gezeichnet?">${c.reported ? 'Gemeldet (zurücknehmen)' : 'Melden'}</button>`
      : '';
    return `<div class="board-line">${line}</div>
      ${preview}
      ${mine}
      <form class="guess-form" data-form="guess">
        <input id="guess-input" class="input input-guess" type="text" maxlength="${MAX_GUESS}" placeholder="${hit ? 'Nachricht an alle, die es auch haben …' : 'Dein Tipp …'}" value="${esc(ui.guess)}"
          data-field="guess" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="send" />
        <button class="btn btn-primary" type="submit" aria-label="Senden">${I('next')}</button>
      </form>
      ${fb}
      ${chatHtml(v, c.chat, { max: 5, cls: 'chat-phone', empty: 'Tippe so oft du willst – falsche Tipps sehen alle.' })}
      ${report}`;
  }

  function phoneRevealHtml(v, p) {
    const c = v.cur;
    const r = c.result;
    const me = v.me.id;
    let mine = '';
    if (c.drawer === me) mine = `<div class="look-up small">${I('pencil')}<b>+${r.drawerPts} für deine Zeichnung</b><small>${r.gains.length} von ${r.guessers} haben es erkannt</small></div>`;
    else if (c.mine) mine = `<div class="look-up small win">${I('check')}<b>+${c.mine.pts} Punkte</b><small>nach ${seconds(c.mine.ms)} s${c.mine.rank === 1 ? ' – als Erste/r!' : ''}</small></div>`;
    else if (p) mine = `<div class="look-up small">${I('smile')}<b>Diesmal nicht erraten</b><small>Nächstes Mal!</small></div>`;
    return `
      <div class="phone-result">
        <small class="reveal-label">Das Wort war</small>
        <b class="reveal-word">${esc(c.word)}</b>
        <p class="reveal-reason">${REASON[r.reason] || ''}</p>
      </div>
      ${mine}
      ${drinksHtml(v, r)}
      ${p ? `<p class="center muted">Du bist auf Platz <b>${p.rank}</b> mit ${p.score} Punkten.</p>` : ''}
      <p class="waiting">Gleich geht es weiter …</p>`;
  }

  function phoneOverHtml(v, p) {
    const head = p
      ? `<div class="look-up win">${p.rank === 1 ? I('trophy') : p.rank === 2 ? I('medal') : p.rank === 3 ? I('medal') : I('palette')}<b>Platz ${p.rank}</b><small>${p.score} Punkte</small></div>`
      : `<div class="look-up">${I('flag')}<b>Spiel vorbei!</b></div>`;
    const awards = awardsHtml(v);
    return `${head}${awards ? `<div class="awards">${awards}</div>` : ''}
      <p class="muted small center">Die Galerie mit allen Zeichnungen steht am Laptop. Dort kann auch eine neue Runde gestartet werden.</p>`;
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
      body = `<h2>${I('phone')} Mitspieler einladen</h2>${UI.roomBox(ui.view && ui.view.room, false)}
        <p class="muted small center">Wer jetzt beitritt, rät sofort mit und kommt später auch ans Zeichnen.</p>
        ${UI.modalDone()}`;
    } else if (ui.modal === 'settings' && ui.view && ui.view.settings) {
      body = `<h2>Einstellungen</h2>${settingsHtml(ui.view.settings)}${wordsPanelHtml(ui.view.settings)}${UI.modalDone()}`;
    } else if (ui.modal === 'confirm' && ui.confirm) {
      body = UI.confirmBody(ui.confirm);
    }
    return UI.modal(body, { wide: ui.modal === 'settings' });
  }

  function rulesHtml() {
    return `
      <h2>${I('book')} Spielregeln</h2>
      <div class="rules">
        <p>Reihum <b>zeichnet</b> eine Person einen Begriff auf dem Handy – die Zeichnung erscheint <b>live am Laptop</b>.
          Alle anderen <b>tippen</b> ihre Tipps ins Handy, so oft sie wollen. In jeder Runde zeichnet jede/r einmal.</p>
        <h3>${I('pencil')} Zeichnen</h3>
        <p>Du wählst aus <b>3 Begriffen</b> (leicht, mittel, schwer). <b>Keine Buchstaben, keine Zahlen, keine Zeichen-Sprache</b>
          („Ohr“ + Pfeil) – technisch geht das, aber die Runde passt auf. Werkzeuge: Farben, 3 Stärken, Farbeimer, Radierer, Rückgängig.</p>
        <h3>${I('keyboard')} Raten</h3>
        <p><b>Richtig</b> (auch mit Artikel, Plural, Groß/klein) → ${I('check')} du siehst das Wort, alle anderen nur „hat es!“.
          <b>Knapp daneben</b> (ein Tippfehler) erfährst nur du. <b>Falsche</b> Tipps laufen im Chat über die Bühne.
          Wer es schon hat, kann weiterschreiben – das lesen nur die, die es auch haben.</p>
        <h3>${I('lightbulb')} Hinweise</h3>
        <p>Das Wort steht als Lücken da (mit Buchstabenzahl). Nach der Hälfte und nach drei Vierteln der Zeit wird je ein Buchstabe aufgedeckt.</p>
        <h3>${I('trophy')} Punkte</h3>
        <p>Ratende: <b>Rest-Zeit-Anteil × 100 + 50</b> – wer zuerst richtig liegt, bekommt <b>+50</b>.
          Die zeichnende Person bekommt den <b>Durchschnitt der Ratenden-Punkte × Anteil der Treffer</b>: Erkennen es alle, gibt es viel, erkennt es niemand, gibt es 0.</p>
        <h3>${I('flag')} Melden</h3>
        <p>Werden Buchstaben gezeichnet oder etwas Unpassendes, können die Ratenden melden. Bei Mehrheit wird der Zug abgebrochen – 0 Punkte für die zeichnende Person.</p>
        <h3>${I('glass')} Trinkregeln (optional)</h3>
        <p>Niemand errät es → die zeichnende Person trinkt 2. Wer es als Letzte/r errät, trinkt 1. Alkoholfrei: Strafpunkte statt Schlucke.</p>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Los geht's!</button></div>`;
  }

  function menuHtml() {
    const v = ui.view;
    const items = UI.menuBasics(Sound.muted);
    if (v && v.me.stage) {
      if (v.room) items.push(UI.menuItem('show-qr', 'phone', 'Mitspieler einladen'));
      if (v.cur && ['choose', 'draw'].includes(v.phase)) items.push(UI.menuItem('skip', 'next', 'Zug überspringen', { attrs: `data-at="${v.cur.no}"`, small: `(z.B. wenn ${esc(v.cur.drawerName)} nicht da ist)` }));
      items.push(UI.menuItem('home-keep', 'home', 'Hauptmenü', { small: '(Spiel bleibt gespeichert)' }));
      if (!['lobby', 'over'].includes(v.phase)) items.push(UI.menuItem('end-game', 'stop', 'Spiel beenden & Ergebnis zeigen', { danger: true }));
      items.push(UI.menuItem('close-game', 'logout', 'Spiel schließen', { danger: true }));
    } else if (v) {
      if (v.phase === 'lobby' && v.me.playing) items.push(UI.menuItem('watch', 'eye', 'Nur zuschauen', { attrs: 'data-watch="1"' }));
      items.push(UI.menuItem('leave', 'logout', 'Spiel verlassen', { danger: true }));
    }
    return UI.menu(items);
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

  function setSetting(key, value) {
    if (!ui.view) return;
    dispatch('settings', { settings: Object.assign({}, ui.view.settings, { [key]: value }) });
  }

  function saveCustomWords(text) {
    if (!ui.view) return;
    ui.customText = null;
    setSetting('custom', Words.parseCustom(text));
  }

  function createGame() {
    const state = Engine.create({ settings: loadSettings() });
    Sound.unlock();
    startStage({ state });
  }

  function setInput(selector, value) {
    // Ein fokussiertes Feld überspringt morphdom – deshalb direkt setzen
    const input = app.querySelector(selector);
    if (input) input.value = value;
  }

  /** a.at: Zug, damit verspätete Klicks nicht beim nächsten landen */
  const at = (el) => (el.dataset.at ? { at: +el.dataset.at } : {});

  const actions = {
    'lobby-settings': () => {
      ui.modal = 'settings';
      render();
    },
    home: () => goHome(false),
    'home-keep': () => goHome(true),
    'new-game': createGame,
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
          Store.remove(window.SkControllers.DRAW_KEY);
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

    /* Lobby */
    set: (el) => {
      const key = el.dataset.key;
      let value = el.dataset.value;
      if (['rounds', 'time', 'hints'].includes(key)) value = +value;
      setSetting(key, value);
    },
    toggle: (el) => setSetting(el.dataset.key, !ui.view.settings[el.dataset.key]),
    pack: (el) => {
      const id = el.dataset.pack;
      const packs = ui.view.settings.packs;
      setSetting('packs', packs.includes(id) ? packs.filter((x) => x !== id) : packs.concat(id));
    },
    kick: (el) => dispatch('kick', { player: el.dataset.player }),
    watch: (el) => {
      ui.modal = null;
      dispatch('watch', { watch: el.dataset.watch === '1' });
    },
    start: () => {
      const ta = app.querySelector('#custom-words');
      if (ui.customText != null && ta) saveCustomWords(ta.value);
      dispatch('start');
    },

    /* Spiel */
    choose: (el) => dispatch('choose', Object.assign({ i: +el.dataset.i }, at(el))),
    report: (el) => dispatch('report', at(el)),
    skip: (el) => dispatch('skip', at(el)),
    next: (el) => dispatch('next', at(el)),
    again: () => dispatch('again'),

    /* Zeichnen */
    'pen-color': (el) => {
      ui.pen.color = el.dataset.value;
      if (ui.pen.tool === 'eraser') ui.pen.tool = 'pen';
      applyPen();
      render();
    },
    'pen-width': (el) => {
      ui.pen.width = +el.dataset.value;
      if (ui.pen.tool === 'fill') ui.pen.tool = 'pen';
      applyPen();
      render();
    },
    'pen-tool': (el) => {
      ui.pen.tool = el.dataset.value;
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
    if (el.dataset.act !== 'close-modal-bg' && !el.dataset.act.startsWith('pen-')) Sound.click();
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
    else if (f === 'custom-words') ui.customText = el.value;
    else if (f === 'guess') ui.guess = el.value;
  });

  app.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.field === 'custom-words') saveCustomWords(el.value);
  });

  app.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key !== 'Enter' || !el.dataset) return;
    if (el.dataset.field === 'name') {
      e.preventDefault();
      const code = app.querySelector('#code-input');
      if (code && !code.value) code.focus();
      else app.querySelector('[data-form="join"] button[type="submit"]').click();
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
    if (form.dataset.form === 'guess' && v && v.cur) {
      const input = form.querySelector('#guess-input');
      const text = (input ? input.value : ui.guess).trim();
      if (!text) return;
      dispatch('guess', { text, at: v.cur.no });
      ui.guess = '';
      setInput('#guess-input', '');
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
    // Am Laptop zeichnen: Strg+Z = rückgängig
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && ui.sketch && ui.sketch.editable && !/INPUT|TEXTAREA/.test((e.target || {}).tagName || '')) {
      e.preventDefault();
      ui.sketch.undo();
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

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.SK_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  requestAnimationFrame(timerLoop);
  autoResume();

  // für Tests
  window.SkApp = { ui, render: renderNow, actions };
})();
