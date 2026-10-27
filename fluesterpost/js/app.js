/*
 * Oberfläche von „Flüsterpost“.
 *  - Laptop („Bühne“): Lobby mit QR-Code und Einstellungen, Wartebildschirm während der Schritte (wer ist fertig?),
 *    Vorführung Kette für Kette (Zeichnungen werden nachgezeichnet), Spielende mit Lieblingsmoment und Galerie,
 *    jede Kette als Bild zum Speichern.
 *  - Handy: Satz schreiben (🎲 Vorschlag), zeichnen, beschreiben bzw. nachzeichnen; in der Vorführung Herzen
 *    verteilen und – wenn es die eigene Kette ist – weiterschalten.
 * Gerendert wird per HTML-String + morphdom. Zeichenflächen (data-keep) bleiben dabei erhalten.
 *
 * Auf dem Handy bleibt die laufende Arbeit (Text oder Striche mit Zeitstempeln) im sessionStorage, damit Neuladen
 * nichts verliert; alle paar Sekunden geht ein Zwischenstand an den Laptop. Läuft die Zeit ab, gibt das Handy selbst ab.
 */
(function () {
  'use strict';

  const E = window.FpEngine;
  const { MODES, STEP_OPTIONS, WRITE_TIMES, DRAW_TIMES, DRINK_OPTIONS, MIN_PLAYERS, MAX_PLAYERS, MAX_TEXT, Engine, sanitizeSettings } = E;
  const { StageController, ClientController, Store, KEYS, Net, inviteLink, qrSvg, IMG_KEY } = window.FpControllers;
  const { Sound, confetti, synth } = window.GameFx;
  const Content = window.FpContent;
  const Replay = window.FpReplay;
  const Sketch = window.GameSketch;
  const Fill = window.GameFill;

  const PEN_COLORS = ['#1f2937', '#9ca3af', '#ef4444', '#f97316', '#facc15', '#22c55e', '#38bdf8', '#2563eb', '#8b5cf6', '#ec4899', '#92400e', '#f5c9a0'];
  const PEN_WIDTHS = [0.006, 0.014, 0.03];
  const ERASER_FACTOR = 2.5;
  const DRAFT_MS = 6000;
  const MODE_INFO = {
    normal: { label: 'Normal', icon: '🖍️', text: 'Satz schreiben → zeichnen → beschreiben → zeichnen …' },
    words: { label: 'Wort-Start', icon: '🎲', text: 'Jede Kette beginnt mit einem Begriff aus Guess the word! – erst wird gezeichnet' },
    copy: { label: 'Nur Zeichnen', icon: '🔁', text: 'Zeichnung nur 3 Sekunden ansehen, dann aus dem Gedächtnis nachzeichnen – am Ende wird beschrieben' },
  };
  const STEP_INFO = {
    write: { icon: '✍️', stage: 'Alle schreiben einen Satz', phone: 'Schreib einen Satz', verb: 'schreibt' },
    draw: { icon: '🖍️', stage: 'Alle zeichnen', phone: 'Zeichne', verb: 'zeichnet' },
    describe: { icon: '💬', stage: 'Alle beschreiben eine Zeichnung', phone: 'Was ist das?', verb: 'sieht darin' },
    copy: { icon: '🔁', stage: 'Alle zeichnen nach', phone: 'Zeichne nach', verb: 'zeichnet nach' },
    word: { icon: '🎲', verb: 'Startwort' },
  };
  const TIPS = {
    write: ['Etwas, das man zeichnen kann – je verrückter, desto besser!', 'Personen, Tiere, Dinge, die etwas tun – das wird lustig.'],
    draw: ['Strichmännchen sind völlig okay!', 'Keine Buchstaben – nur zeichnen!', 'Der Farbeimer füllt ganze Flächen 🪣'],
    describe: ['Beschreibt, was ihr seht – nicht, was gemeint war.', 'Ein ganzer Satz macht es für die Nächsten lustiger.'],
    copy: ['Nur 3 Sekunden hinschauen – dann aus dem Gedächtnis nachzeichnen.', 'Wie Stille Post, nur mit Bildern 🔁'],
  };
  const DRINK_LABEL = { off: 'Aus', on: 'An 🍺', free: 'Alkoholfrei' };
  const SETTINGS_KEY = 'fluesterpost.settings.v1';
  const PREFS_KEY = 'fluesterpost.prefs.v1';
  const ACTIVE_KEY = 'fluesterpost.active';
  const CLIENT_KEY = 'fluesterpost.client'; // sessionStorage: Beitritt dieses Tabs (zum Neuladen)
  const WORK_KEY = 'fluesterpost.work.v1';
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

  function tc(color) {
    return `--team:${esc(color || '#ffffff')}`;
  }

  function player(v, pid) {
    return v.players.find((p) => p.id === pid) || null;
  }

  /** „Annas“, „Max'“ */
  function genitive(name) {
    return /[sßxz]$/i.test(name) ? name + '’' : name + 's';
  }

  function domId(ref) {
    return String(ref).replace(/[^a-z0-9]/gi, '-');
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
    customText: null, // Entwurf der eigenen Startsätze in der Lobby (null = aus den Einstellungen)
    pen: { color: PEN_COLORS[0], width: PEN_WIDTHS[1], tool: 'pen' },
    sketch: null, // Zeichenfläche des Handys
    arts: new Map(), // Element → { sketch, ref, player, loaded }
    animated: new Set(), // Bühne: schon nachgezeichnete Bilder
    images: {}, // Handy: ref → Striche (vom Laptop geschickt)
    thumbs: new Map(), // Bühne: ref → Bild-URL (Galerie)
    work: null, // Handy: laufende Arbeit { key, text, ops, t0, peekStart, sugN, draftSig, auto }
    lastShow: null,
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

  /** Spieleigene Sounds */
  const Fx = {
    /** Jemand ist fertig */
    done() {
      synth.tone(740, 0, 0.07, { type: 'triangle', vol: 0.07 });
      synth.tone(988, 0.06, 0.1, { type: 'triangle', vol: 0.07 });
    },
    /** Nächster Eintrag in der Vorführung */
    reveal() {
      synth.tone(392, 0, 0.12, { type: 'sine', to: 784, vol: 0.08 });
    },
    /** ❤️ */
    heart() {
      synth.tone(1047, 0, 0.07, { type: 'sine', vol: 0.07 });
      synth.tone(1319, 0.07, 0.12, { type: 'sine', vol: 0.07 });
    },
    /** Kette völlig anders angekommen: ein schiefes „Wah-wah“ */
    twist() {
      synth.tone(330, 0, 0.25, { type: 'triangle', to: 300, vol: 0.12 });
      synth.tone(262, 0.25, 0.45, { type: 'triangle', to: 220, vol: 0.12 });
    },
  };

  /* ------------------------------------------------------------------ */
  /* Arbeit auf dem Handy (Text / Striche)                               */
  /* ------------------------------------------------------------------ */

  function freshWork(key) {
    return { key, text: '', ops: [], t0: Date.now(), peekStart: 0, sugN: 0, draftSig: '', auto: false };
  }

  function loadWork(key) {
    try {
      const saved = JSON.parse(session(WORK_KEY) || 'null');
      if (saved && saved.key === key && Array.isArray(saved.ops)) return Object.assign(freshWork(key), saved, { auto: false });
    } catch {
      /* kaputt – neu anfangen */
    }
    return freshWork(key);
  }

  function saveWorkSoon() {
    if (ui.workTimer) return;
    ui.workTimer = setTimeout(saveWork, 700);
  }

  function saveWork() {
    clearTimeout(ui.workTimer);
    ui.workTimer = null;
    const w = ui.work;
    if (!w || !w.key) return;
    try {
      session(WORK_KEY, JSON.stringify({ key: w.key, text: w.text, ops: w.ops, t0: w.t0, peekStart: w.peekStart, sugN: w.sugN }));
    } catch {
      /* zu groß – egal, der Zwischenstand liegt auch am Laptop */
    }
  }

  function workKey(v) {
    return v && v.task ? `${v.startedAt}:${v.task.step}` : null;
  }

  function isDrawTask(task) {
    return !!task && (task.type === 'draw' || task.type === 'copy');
  }

  /** Läuft beim Nachzeichnen noch der kurze Blick auf die Vorlage? */
  function peeking(v) {
    const t = v.task;
    if (!t || t.type !== 'copy' || t.done || !t.prev || !t.prev.ref) return false;
    const w = ui.work;
    if (!ui.images[t.prev.ref]) return false;
    if (!w.peekStart) {
      w.peekStart = Date.now();
      saveWork();
    }
    const left = w.peekStart + t.peek - Date.now();
    if (left > 0) {
      clearTimeout(ui.peekTimer);
      ui.peekTimer = setTimeout(render, left + 20);
      return true;
    }
    return false;
  }

  function submitWork() {
    const v = ui.view;
    const t = v && v.task;
    if (!t || t.done) return;
    const w = ui.work;
    if (isDrawTask(t)) dispatch('submit', { step: t.step, ops: Replay.compact(w.ops) });
    else {
      const input = app.querySelector('#text-input');
      if (input) w.text = input.value;
      dispatch('submit', { step: t.step, text: w.text.trim() });
    }
    saveWork();
    vibrate(40);
  }

  /** Zwischenstand an den Laptop (nur wenn sich etwas geändert hat) */
  function sendDraft() {
    const v = ui.view;
    const t = v && v.task;
    const w = ui.work;
    if (!t || t.done || !w || !ui.ctrl || ui.ctrl.mode !== 'client') return;
    const drawing = isDrawTask(t);
    const sig = drawing ? `${w.ops.length}:${w.ops.length ? w.ops[w.ops.length - 1].t : 0}` : w.text;
    if (sig === w.draftSig || (!drawing && !w.text) || (drawing && !w.ops.length)) return;
    w.draftSig = sig;
    if (drawing) dispatch('draft', { step: t.step, ops: Replay.compact(w.ops) });
    else dispatch('draft', { step: t.step, text: w.text });
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
      onImage: guard(handleImage),
      onStatus: guard(handleStatus),
      onKicked: guard(handleKicked),
    };
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
    ui.images = {};
    ui.thumbs.clear();
    ui.animated.clear();
    ui.lastShow = null;
    destroySketches();
    session(ACTIVE_KEY, null);
    if (!keepSave) session(CLIENT_KEY, null);
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
    // Pro Tab merken, mit wem wir verbunden sind – der localStorage gehört allen Tabs des Geräts
    if (ui.ctrl) session(CLIENT_KEY, JSON.stringify({ code: ui.ctrl.code, name: ui.ctrl.name, pid: ui.ctrl.pid }));
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
    if (!v.me.stage) syncWork(v);
    if (v.me.stage && v.phase === 'lobby') Store.set(SETTINGS_KEY, v.settings);
    if (v.me.stage && prev && prev.startedAt !== v.startedAt) {
      ui.thumbs.clear();
      ui.animated.clear();
    }
    transitions(prev, v);
    render();
  }

  /** Handy: Arbeit zum laufenden Schritt laden, Vorschläge übernehmen */
  function syncWork(v) {
    const key = workKey(v);
    if (!ui.work || ui.work.key !== key) {
      ui.work = key ? loadWork(key) : freshWork(null);
      if (ui.sketch) ui.sketch.loadAll(ui.work.ops);
    }
    const t = v.task;
    if (!t) return;
    if (!ui.work.text && t.text) ui.work.text = t.text;
    const sug = t.suggestion;
    if (sug && sug.n !== ui.work.sugN) {
      ui.work.sugN = sug.n;
      ui.work.text = sug.text;
      setInput('#text-input', sug.text);
      saveWork();
    }
  }

  function handleImage(ref, ops) {
    ui.images = { [ref]: ops };
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

  function heartTotal(show) {
    return show ? show.entries.reduce((n, e) => n + e.hearts, 0) : 0;
  }

  /** Sounds, Konfetti und Vibration bei Zustandswechseln */
  function transitions(prev, v) {
    if (!prev) return;
    const stage = !!v.me.stage;
    if (v.phase === 'over' && prev.phase !== 'over') {
      Sound.fanfare();
      if (stage) setTimeout(() => confetti(['#fde047', '#f472b6', '#38bdf8', '#ffffff'], 220), 150);
      return;
    }
    if (v.phase === 'play') {
      if (prev.phase !== 'play' || prev.step !== v.step) {
        if (prev.phase === 'lobby') Sound.start();
        else Sound.flip();
        if (!stage && v.task) vibrate([80, 60, 80]);
        return;
      }
      if (stage && v.doneCount > prev.doneCount) Fx.done();
      if (v.hurried && !prev.hurried) {
        Sound.tick(true);
        if (!stage) vibrate(120);
      }
      return;
    }
    if (v.phase === 'show' && v.show) {
      const ps = prev.phase === 'show' ? prev.show : null;
      if (!ps) {
        Sound.start();
        if (!stage && v.show.owner === v.me.id) vibrate([80, 60, 80]);
        return;
      }
      if (ps.i !== v.show.i || ps.n !== v.show.n) {
        const finished = v.show.complete && !(ps.i === v.show.i && ps.complete);
        const verdict = v.show.verdict && v.show.verdict.value;
        if (finished && verdict === true) Sound.success();
        else if (finished && verdict === false) Fx.twist();
        else if (ps.i !== v.show.i) Sound.flip();
        else Fx.reveal();
        if (!stage && ps.i !== v.show.i && v.show.owner === v.me.id) vibrate([80, 60, 80]);
      } else if (heartTotal(v.show) > heartTotal(ps)) Fx.heart();
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
    // Handy: Zeit um → selbst abgeben, was da ist
    const v = ui.view;
    if (v && !v.me.stage && v.task && !v.task.done && v.timer && ui.work && !ui.work.auto) {
      if (v.timer.remaining - elapsed <= 0) {
        ui.work.auto = true;
        submitWork();
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
    mountArts();
    scrollShow();
    if (ui.focus) {
      const el = app.querySelector(ui.focus);
      ui.focus = null;
      if (el) {
        el.focus();
        if (el.setSelectionRange && el.value) el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }

  /** Vorführung: neuesten Eintrag ins Bild scrollen */
  function scrollShow() {
    const v = ui.view;
    const key = v && v.me.stage && v.phase === 'show' && v.show ? `${v.show.i}:${v.show.n}` : null;
    if (key === ui.lastShow) return;
    const firstOfChain = !ui.lastShow || !key || ui.lastShow.split(':')[0] !== key.split(':')[0];
    ui.lastShow = key;
    if (!key) return;
    if (firstOfChain) window.scrollTo({ top: 0 });
    const last = app.querySelector('.feed > li:last-child');
    if (last && !firstOfChain) last.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---------- Zeichenflächen ---------- */

  /** Handy: die eigene Zeichenfläche */
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
          const w = ui.work;
          if (!w) return;
          w.ops.push(Object.assign({ t: Date.now() - w.t0 }, msg));
          saveWorkSoon();
        },
      });
      ui.sketch.loadAll(ui.work ? ui.work.ops : []);
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

  function artOps(ref) {
    if (!ref) return null;
    if (ui.ctrl && ui.ctrl.image) return ui.ctrl.image(ref);
    return ui.images[ref] || null;
  }

  /** Zeichnungen zum Ansehen (Vorführung, Beschreiben, Nachzeichnen). data-anim="1": Strich für Strich abspielen. */
  function mountArts() {
    const hosts = new Set(app.querySelectorAll('[data-art]'));
    for (const [el, a] of ui.arts) {
      if (!hosts.has(el) || el.dataset.art !== a.ref) {
        if (a.player) a.player.stop();
        a.sketch.destroy();
        ui.arts.delete(el);
      }
    }
    for (const el of hosts) {
      let a = ui.arts.get(el);
      if (!a) {
        a = { sketch: new Sketch(el, { fill: Fill.paint, maxDpr: 2 }), ref: el.dataset.art, player: null, loaded: false };
        ui.arts.set(el, a);
      }
      if (a.loaded) continue;
      const ops = artOps(a.ref);
      if (!ops) continue;
      a.loaded = true;
      if (el.dataset.anim === '1' && !ui.animated.has(a.ref)) {
        ui.animated.add(a.ref);
        play(a, ops);
      } else a.sketch.loadAll(ops);
    }
  }

  function play(a, ops) {
    if (a.player) a.player.stop();
    const host = a.sketch.host;
    host.classList.add('is-playing');
    a.player = new Replay.Player(a.sketch, ops, {
      delay: 300,
      onDone: () => host.classList.remove('is-playing'),
    });
  }

  function destroySketches() {
    if (ui.sketch) {
      ui.sketch.destroy();
      ui.sketch = null;
    }
    for (const a of ui.arts.values()) {
      if (a.player) a.player.stop();
      a.sketch.destroy();
    }
    ui.arts.clear();
  }

  /** Bühne: kleines Bild einer Zeichnung (Galerie) – einmal gemalt, dann als Bild-URL gemerkt */
  function thumbUrl(ref, w) {
    const key = ref + '@' + w;
    if (ui.thumbs.has(key)) return ui.thumbs.get(key);
    const ops = artOps(ref);
    if (!ops) return '';
    const c = document.createElement('canvas');
    c.width = w;
    c.height = Math.round((w * 3) / 4);
    Sketch.paint(c, ops, Fill.paint);
    const url = c.toDataURL('image/png');
    ui.thumbs.set(key, url);
    return url;
  }

  /* ---------- Bausteine ---------- */

  function logoHtml(small) {
    const letters = [...'Flüsterpost'].map((ch, i) => `<span style="--i:${i}">${ch}</span>`).join('');
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="Flüsterpost">
      <span class="logo-icon" aria-hidden="true">🖍️</span>
      <span class="logo-text">${letters}</span>
    </div>`;
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
      return `<span class="clock" data-timer ${o.tick ? 'data-tick' : ''} data-rem="${Math.round(timer.remaining)}" data-total="${timer.total}">⏱ <b data-timer-text>${sec}</b></span>`;
    }
    return `<div class="timer ${o.cls || ''}" data-timer ${o.tick ? 'data-tick' : ''} data-rem="${Math.round(timer.remaining)}" data-total="${timer.total}">
      <div class="timer-bar"><span data-timer-bar style="width:${(100 * timer.remaining) / (timer.total || 1)}%"></span></div>
      <b data-timer-text>${sec}</b>
    </div>`;
  }

  /** Text eines Eintrags (mit Platzhaltern für leer / verschollen) */
  function entryText(e) {
    if (e.missing) return '(verschollen)';
    if (e.empty) return '(nichts geschrieben)';
    return `„${e.text}“`;
  }

  /** Zeichnung (Bühne): live gezeichnet, optional mit Nachzeichnen */
  function artHtml(ref, opts) {
    const o = opts || {};
    return `<div class="art-host ${o.cls || ''}" id="art-${domId(ref)}${o.suffix || ''}" data-keep data-art="${esc(ref)}" data-anim="${o.anim ? '1' : '0'}"></div>`;
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
    return `
    <div class="screen home">
      <a class="btn btn-ghost btn-small hub-back" href="../">← Alle Spiele</a>
      <div class="home-hero">
        ${logoHtml()}
        <p class="tagline">Stille Post mit Zeichnungen: Alle <b>schreiben</b>, <b>zeichnen</b> und <b>beschreiben</b> gleichzeitig – am Ende zeigt der Laptop, was aus jedem Satz geworden ist.</p>
        <div class="home-chain" aria-hidden="true">
          <span class="hc-card" style="--r:-6deg">„Ein Pinguin fährt Ski“</span>
          <span class="hc-arrow">→</span>
          <span class="hc-card hc-doodle" style="--r:4deg">🐧⛷️</span>
          <span class="hc-arrow">→</span>
          <span class="hc-card" style="--r:-3deg">„Oma bügelt einen Fisch“</span>
        </div>
      </div>
      ${ui.error && ui.screen === 'home' ? `<div class="alert">${esc(ui.error)}</div>` : ''}
      ${resume.join('')}
      <div class="mode-cards">
        <button class="mode-card mode-stage" data-act="new-game">
          <span class="mode-icon">💻</span>
          <span class="mode-body"><b>Spiel anlegen</b><small>Am Laptop, Tablet oder Fernseher: Er ist die Bühne für die Vorführung am Ende.</small></span>
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
      </div>
      <p class="home-foot">${MIN_PLAYERS}–${MAX_PLAYERS} Personen · Laptop + Handys · ${Content.DECKS.family.list.length + Content.DECKS.adult.list.length} Startsätze</p>
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
    if (v.phase === 'play') {
      const si = STEP_INFO[v.stepType];
      info = `<span class="pill">Schritt ${v.step + 1} / ${v.steps}</span>
        <span class="pill pill-hot">${si.icon} ${esc(si.phone)}</span>
        ${timerHtml(v.timer, { clock: true })}`;
    } else if (v.phase === 'show' && v.show) {
      info = `<span class="pill">🎬 Kette ${v.show.i + 1} / ${v.show.count}</span>`;
    } else if (v.phase === 'over') info = '<span class="pill">🏁 Spielende</span>';
    const room = v.room && v.room.code && v.phase !== 'lobby' ? `<button class="pill pill-room" data-act="show-qr" title="Raum-Code">📱 ${esc(v.room.code)}</button>` : '';
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
    else if (v.phase === 'play') main = playStageHtml(v);
    else if (v.phase === 'show') main = showStageHtml(v);
    else main = overHtml(v);
    return `
      <div class="stage phase-${v.phase}">
        ${topbarHtml(v)}
        <main class="stage-main">${main}</main>
      </div>`;
  }

  /* ---------- Lobby ---------- */

  function settingsHtml(s) {
    const m = MODE_INFO[s.mode];
    return `<div class="settings">
      <div class="setting">
        <div class="setting-label"><b>${m.icon} Modus</b><small>${esc(m.text)}</small></div>
        ${seg('mode', MODES, s.mode, (o) => MODE_INFO[o].label)}
      </div>
      <div class="setting">
        <div class="setting-label"><b>🔢 Schritte</b><small>${s.steps ? `Jede Kette läuft durch ${s.steps} Hände (höchstens so viele wie Personen)` : 'Jede Kette kommt bei allen einmal vorbei'}</small></div>
        ${seg('steps', STEP_OPTIONS, s.steps, (o) => (o ? String(o) : 'Alle'))}
      </div>
      <div class="setting">
        <div class="setting-label"><b>✍️ Zeit Schreiben</b><small>Startsatz und Beschreibungen</small></div>
        ${seg('writeTime', WRITE_TIMES, s.writeTime, (o) => o + ' s')}
      </div>
      <div class="setting">
        <div class="setting-label"><b>🖍️ Zeit Zeichnen</b><small>${s.drawTime ? 'Wer fertig ist, drückt „Fertig“ – sind alle fertig, geht es sofort weiter' : 'Ohne Zeitlimit – am Laptop lässt sich „Beeilung!“ drücken'}</small></div>
        ${seg('drawTime', DRAW_TIMES, s.drawTime, (o) => (o ? o + ' s' : 'ohne'))}
      </div>
      <div class="setting">
        <div class="setting-label"><b>🎬 Vorführung</b><small>${s.replay === 'animate' ? 'Zeichnungen entstehen Strich für Strich – wie gezeichnet, nur schneller' : 'Zeichnungen erscheinen sofort fertig'}</small></div>
        ${seg('replay', ['animate', 'instant'], s.replay, (o) => (o === 'animate' ? 'Nachzeichnen' : 'Sofort fertig'))}
      </div>
      <div class="setting">
        <div class="setting-label"><b>❤️ Lieblingsmoment</b><small>In der Vorführung verteilt jede/r pro Kette ein Herz</small></div>
        ${switchHtml(s.hearts, 'hearts')}
      </div>
      <div class="setting">
        <div class="setting-label"><b>🍻 Trinkregeln</b><small>${s.drinks === 'off' ? 'Normales Spiel' : `Kommt eine Kette völlig anders an, ${s.drinks === 'free' ? 'bekommt die Startperson 1 Strafpunkt' : 'trinkt die Startperson 1'}`}</small></div>
        ${seg('drinks', DRINK_OPTIONS, s.drinks, (o) => DRINK_LABEL[o])}
      </div>
    </div>`;
  }

  function deckPanelHtml(s) {
    if (s.mode === 'words') {
      return `<section class="panel"><h2>🎲 Startwörter</h2>
        <p class="muted">Jede Kette beginnt mit einem zufälligen Begriff aus <b>Guess the word!</b> (Zeichnen, leicht und mittel). Wer ihn nicht mag, würfelt am Handy neu.</p></section>`;
    }
    const decks = ['family', 'adult', 'custom'];
    const label = { family: '👨‍👩‍👧 Familie', adult: '🔞 Ab 18', custom: '✍️ Eigene' };
    const text = ui.customText != null ? ui.customText : s.custom.join('\n');
    const n = s.custom.length;
    return `<section class="panel">
      <h2>🎲 Startsätze <small class="muted">(für den Vorschlag-Knopf)</small></h2>
      <p class="muted small">Wer keine Idee hat, tippt beim Schreiben auf 🎲 und bekommt einen Satz vorgeschlagen.</p>
      ${seg('deck', decks, s.deck, (o) => label[o])}
      ${
        s.deck === 'custom'
          ? `<label class="label" for="custom-sentences">✍️ Eigene Sätze <small class="muted">(einer pro Zeile – z.B. eure Insider)</small></label>
        <textarea id="custom-sentences" class="input textarea" rows="4" maxlength="12000" placeholder="Tante Gabi beim Karaoke&#10;Der Hund klaut die Grillwurst" data-field="custom">${esc(text)}</textarea>
        <p class="muted small">${n ? `${n} ${plural(n, 'eigener Satz', 'eigene Sätze')}` : 'Noch keine eigenen Sätze'}</p>`
          : `<p class="muted small">${s.deck === 'adult' ? Content.DECKS.adult.list.length : Content.DECKS.family.list.length} Sätze – z.B. „${esc((s.deck === 'adult' ? Content.DECKS.adult : Content.DECKS.family).list[0])}“</p>`
      }
    </section>`;
  }

  function lobbyStageHtml(v) {
    const chip = (p) => `<span class="chip ${p.online ? '' : 'is-offline'}" style="${tc(p.color)}"><span class="team-dot"></span>${esc(p.name)}<button class="chip-x" data-act="kick" data-player="${esc(p.id)}" aria-label="${esc(p.name)} entfernen">✕</button></span>`;
    const watching = v.members.filter((m) => !m.playing);
    return `
      <div class="lobby-grid">
        <section class="panel join-panel">
          <h2>📱 Handys verbinden</h2>
          <p class="muted">QR-Code scannen, Namen eingeben – los geht's. Wer später kommt, kann nur noch zuschauen.</p>
          ${roomBoxHtml(v.room, true)}
        </section>
        <div class="lobby-side">
          <section class="panel">
            <h2>Mitspieler <small class="muted">(${v.players.length} / ${MAX_PLAYERS})</small></h2>
            <div class="chips">${v.players.length ? v.players.map(chip).join('') : '<span class="muted">Noch niemand – QR-Code scannen!</span>'}</div>
            ${watching.length ? `<div class="free"><b>Schauen nur zu:</b> <div class="chips">${watching.map((m) => `<span class="chip ${m.online ? '' : 'is-offline'}">${esc(m.name)}<button class="chip-x" data-act="kick" data-player="${esc(m.id)}" aria-label="${esc(m.name)} entfernen">✕</button></span>`).join('')}</div></div>` : ''}
            <p class="muted small">Weitergegeben wird in dieser Reihenfolge – am besten so, wie ihr sitzt.</p>
          </section>
          <section class="panel">
            <h2>Einstellungen</h2>
            ${settingsHtml(v.settings)}
          </section>
          ${deckPanelHtml(v.settings)}
          <div class="sticky-start">
            <button class="btn btn-primary btn-big" data-act="start" ${v.lobbyProblem ? 'disabled' : ''}>Los geht's 🖍️</button>
            ${v.lobbyProblem ? `<p class="muted small center">${esc(v.lobbyProblem)}</p>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ---------- Schritte (Wartebildschirm) ---------- */

  function playStageHtml(v) {
    const si = STEP_INFO[v.stepType];
    const tips = TIPS[v.stepType];
    const tip = tips[v.step % tips.length];
    const chips = v.players
      .map((p) => {
        const state = p.done ? 'done' : p.gone ? 'gone' : v.waiting.includes(p.id) ? (p.online ? 'busy' : 'wait') : 'off';
        const mark = { done: '✓', busy: si.icon, wait: '📴', off: '📴', gone: '🚪' }[state];
        return `<span class="pass-chip is-${state}" style="${tc(p.color)}"><span class="team-dot"></span>${esc(p.name)} <b>${mark}</b></span>`;
      })
      .join('');
    const n = v.players.length;
    const timer = v.timer ? timerHtml(v.timer, { cls: 'timer-big', tick: true }) : '<p class="muted no-limit">⏳ Ohne Zeitlimit – sobald alle fertig sind, geht es weiter.</p>';
    const hurry = v.hurried
      ? `<button class="btn btn-ghost" data-act="hurry">⏭️ Sofort abgeben</button>`
      : `<button class="btn btn-ghost" data-act="hurry">⏩ Beeilung! <small>(noch 10 s)</small></button>`;
    return `
      <div class="center-stage play-stage">
        <div class="step-hero">
          <span class="step-icon" aria-hidden="true">${si.icon}</span>
          <h1 class="stage-title">${esc(si.stage)}</h1>
          <p class="muted step-tip">${esc(tip)}</p>
        </div>
        ${timer}
        <div class="pass-ring">${chips}</div>
        <p class="pass-count"><b>${v.doneCount}</b> von ${n} fertig</p>
        <div class="pass-flow" aria-hidden="true">${v.players.map((p, i) => `<span class="pass-dot" style="${tc(p.color)};--i:${i}"></span>`).join('<span class="pass-line"></span>')}</div>
        <p class="muted small">Hier ist nichts zu sehen – sonst wäre es ja kein Geheimnis. 🤫 Alle Ketten gibt es am Ende.</p>
        <div class="stage-actions">${hurry}</div>
      </div>`;
  }

  /* ---------- Vorführung ---------- */

  function heartBadge(e, hearts) {
    if (!hearts || (!e.hearts && !e.canHeart)) return '';
    return e.hearts ? `<span class="heart-badge" title="${e.hearts} ${plural(e.hearts, 'Herz', 'Herzen')}">❤️ ${e.hearts}</span>` : '';
  }

  function entryHtml(v, e, opts) {
    const o = opts || {};
    const si = STEP_INFO[e.kind] || STEP_INFO.write;
    const who = e.kind === 'word' ? '<b>🎲 Startwort</b>' : `<span class="team-dot"></span><b>${esc(e.name)}</b> <small>${esc(si.verb)}${e.late && !e.empty ? ' <span title="Zwischenstand bei Zeitablauf">⏱</span>' : ''}</small>`;
    let body;
    if (e.drawing) {
      body = e.ref
        ? `<div class="art-frame">${artHtml(e.ref, { anim: o.anim })}<button class="icon-btn art-replay" data-act="replay-art" data-ref="${esc(e.ref)}" title="Nochmal nachzeichnen" aria-label="Nochmal nachzeichnen">🔁</button></div>`
        : `<div class="art-empty">${e.missing ? '(verschollen)' : '(leeres Blatt)'}</div>`;
    } else body = `<p class="entry-text ${e.empty ? 'is-empty' : ''} ${e.kind === 'word' ? 'is-word' : ''}">${esc(e.kind === 'word' ? e.text : entryText(e))}</p>`;
    return `<li class="entry ${e.drawing ? 'entry-draw' : 'entry-say'} ${o.fresh ? 'is-fresh' : ''}" style="${tc(e.color)}" id="e-${domId(v.show ? v.show.owner : '')}-${e.idx}">
      <div class="entry-who">${who}${heartBadge(e, v.settings.hearts)}</div>
      ${body}
    </li>`;
  }

  function verdictHtml(v, show, opts) {
    const o = opts || {};
    const vd = show.verdict;
    if (!vd) return '';
    const unit = v.settings.drinks === 'free' ? '1 Strafpunkt' : '1 Schluck';
    const drinks = show.drinks ? `<p class="drinks">${v.settings.drinks === 'free' ? '⚠️' : '🍺'} <b>${esc(show.ownerName)}</b> ${v.settings.drinks === 'free' ? 'bekommt' : 'trinkt'} ${unit}</p>` : '';
    if (vd.value === null) return drinks;
    const flip = o.stage
      ? `<button class="btn btn-link btn-small" data-act="verdict" data-owner="${esc(show.owner)}" data-value="${vd.value ? '0' : '1'}">${vd.value ? 'Stimmt nicht – doch völlig anders' : 'Stimmt nicht – doch angekommen'}</button>`
      : '';
    return `<div class="verdict ${vd.value ? 'is-ok' : 'is-twist'}">
      <b>${vd.value ? '✅ Angekommen!' : '🔀 Völlig anders angekommen!'}</b>
      ${flip}
      ${drinks}
    </div>`;
  }

  function showStageHtml(v) {
    const sh = v.show;
    const anim = v.settings.replay === 'animate';
    const entries = sh.entries.map((e, i) => entryHtml(v, e, { anim, fresh: i === sh.entries.length - 1 && i > 0 })).join('');
    const lastChain = sh.i === sh.count - 1;
    const nextLabel = !sh.complete ? 'Weiter ▶' : lastChain ? 'Zum Finale 🏁' : 'Nächste Kette ▶';
    const atStart = sh.i === 0 && sh.n === 1;
    return `
      <div class="show">
        <header class="show-head" style="${tc(sh.color)}">
          <span class="team-dot"></span>
          <h1>${esc(genitive(sh.ownerName))} Kette</h1>
          <small class="muted">${sh.n} / ${sh.total}</small>
        </header>
        <ol class="feed">${entries}</ol>
        ${sh.complete ? verdictHtml(v, sh, { stage: true }) : ''}
        <div class="show-controls">
          <button class="btn btn-ghost" data-act="back" ${atStart ? 'disabled' : ''} aria-label="Zurück">◀</button>
          <button class="btn btn-primary btn-big" data-act="next" data-i="${sh.i}" data-n="${sh.n}">${nextLabel}</button>
          ${!sh.complete ? '<button class="btn btn-ghost" data-act="reveal-all">⏭️ Ganze Kette</button>' : `<button class="btn btn-ghost" data-act="save-chain" data-owner="${esc(sh.owner)}">💾 Als Bild</button>`}
        </div>
        <p class="muted small center">${esc(sh.ownerName)} kann auch am Handy weiterschalten · Tastatur: → / Leertaste${v.settings.hearts ? ' · ❤️ Herzen gibt es auf den Handys' : ''}</p>
      </div>`;
  }

  /* ---------- Spielende ---------- */

  function favoriteHtml(v) {
    const fav = (v.awards || []).find((a) => a.owner);
    if (!fav || !v.chains) return '';
    const chain = v.chains.find((c) => c.owner === fav.owner);
    const e = chain && chain.entries.find((x) => x.idx === fav.idx);
    if (!e) return '';
    const body = e.drawing && e.ref ? `<img class="fav-art" src="${thumbUrl(e.ref, 640)}" alt="Zeichnung von ${esc(e.name)}" />` : `<p class="fav-text">${esc(entryText(e))}</p>`;
    return `<section class="favorite">
      <small class="reveal-label">❤️ Lieblingsmoment des Abends</small>
      ${body}
      <p>${e.by === chain.owner ? `<b>${esc(genitive(e.name))}</b> Startsatz` : `<b>${esc(e.name)}</b> in ${esc(genitive(chain.ownerName))} Kette`} · ❤️ ${e.hearts}</p>
    </section>`;
  }

  function galleryHtml(v) {
    if (!v.chains || !v.chains.length) return '';
    const cards = v.chains
      .map((c) => {
        const strip = c.entries
          .map((e) => {
            const inner = e.drawing
              ? e.ref
                ? `<img src="${thumbUrl(e.ref, 320)}" alt="Zeichnung von ${esc(e.name)}" loading="lazy" />`
                : `<span class="mini-empty">${e.missing ? '(verschollen)' : '(leeres Blatt)'}</span>`
              : `<span class="mini-text">${esc(e.kind === 'word' ? e.text : entryText(e))}</span>`;
            return `<figure class="mini ${e.drawing ? 'mini-draw' : 'mini-say'}" style="${tc(e.color)}">${inner}<figcaption>${e.kind === 'word' ? '🎲 Startwort' : esc(e.name)}${e.hearts ? ` · ❤️ ${e.hearts}` : ''}</figcaption></figure>`;
          })
          .join('<span class="mini-arrow" aria-hidden="true">→</span>');
        const vd = c.verdict && c.verdict.value !== null ? (c.verdict.value ? '✅' : '🔀') : '';
        return `<section class="chain-card" style="${tc(c.color)}">
          <header><span class="team-dot"></span><b>${esc(genitive(c.ownerName))} Kette</b> ${vd}
            <button class="btn btn-ghost btn-small" data-act="save-chain" data-owner="${esc(c.owner)}">💾 Bild speichern</button></header>
          <div class="strip">${strip}</div>
        </section>`;
      })
      .join('');
    return `<section class="panel gallery-panel"><h2>🖼️ Alle Ketten</h2>${cards}</section>`;
  }

  function overHtml(v) {
    const awards = (v.awards || []).filter((a) => !a.owner);
    const drinks =
      v.settings.drinks !== 'off' && v.players.some((p) => p.drinks)
        ? `<p class="center muted">${v.settings.drinks === 'free' ? '⚠️ Strafpunkte' : '🍻 Schlucke'}: ${v.players.filter((p) => p.drinks).map((p) => `${esc(p.name)} ${p.drinks}`).join(' · ')}</p>`
        : '';
    return `
      <div class="center-stage over">
        <h1 class="over-title">🏁 Alle Ketten gezeigt!</h1>
        ${favoriteHtml(v)}
        ${awards.length ? `<div class="awards">${awards.map((a) => `<div class="award"><span class="award-icon">${a.icon}</span><div><b>${esc(a.title)}</b><small>${esc(a.text)}</small></div></div>`).join('')}</div>` : ''}
        ${drinks}
        ${galleryHtml(v)}
        <div class="stage-actions">
          <button class="btn btn-ghost" data-act="rewatch">🎬 Vorführung nochmal</button>
          <button class="btn btn-primary btn-big" data-act="again">🔁 Nochmal spielen</button>
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
    else if (v.phase === 'play') body = v.task ? phoneTaskHtml(v) : phoneWatchHtml(v);
    else if (v.phase === 'show') body = phoneShowHtml(v);
    else body = phoneOverHtml(v);
    const info =
      v.phase === 'play' && v.task
        ? `<span class="phone-round">${v.step + 1}/${v.steps}</span>${v.task.done ? '' : timerHtml(v.timer, { clock: true })}`
        : v.phase === 'show' && v.show
          ? `<span class="phone-round">Kette ${v.show.i + 1}/${v.show.count}</span>`
          : '';
    const drawing = v.phase === 'play' && v.task && isDrawTask(v.task) && !v.task.done;
    return `
      <div class="phone ${drawing ? 'is-drawing' : ''}" style="${tc(p ? p.color : '#94a3b8')}">
        <header class="phone-head">
          <span class="team-dot"></span>
          <b>${esc(me.name)}</b>
          <span class="phone-name">${me.playing ? '' : 'Zuschauer'}</span>
          ${info}
          <button class="icon-btn" data-act="menu" aria-label="Menü">☰</button>
        </header>
        ${phoneStatusBanner()}
        <main class="phone-main">${body}</main>
      </div>`;
  }

  function phoneLobbyHtml(v, p) {
    const n = v.players.length;
    if (!p) {
      return `<div class="look-up">👀<b>Du schaust zu</b><small>${n} ${plural(n, 'Person spielt', 'Personen spielen')}</small></div>
        ${n < MAX_PLAYERS ? '<button class="btn btn-primary btn-big btn-wide" data-act="watch" data-watch="0">🖍️ Mitspielen</button>' : '<p class="muted center">Das Spiel ist voll.</p>'}`;
    }
    return `<div class="look-up">🖍️<b>Du bist dabei!</b><small>${n} ${plural(n, 'Person', 'Personen')} im Spiel${n < MIN_PLAYERS ? ` – ab ${MIN_PLAYERS} geht's los` : ''}</small></div>
      <p class="waiting">⏳ Warte, bis es am Laptop losgeht…</p>
      <p class="muted small center">Tipp: Beim Zeichnen das Handy hochkant halten. Alle sind gleichzeitig dran – niemand muss warten.</p>
      <button class="btn btn-link" data-act="watch" data-watch="1">Doch nur zuschauen</button>`;
  }

  function phoneWatchHtml(v) {
    return `<div class="look-up">👀<b>Das Spiel läuft schon</b><small>Die Ketten stehen fest – du schaust zu. Die Vorführung am Ende läuft am Laptop.</small></div>
      <p class="pass-count"><b>${v.doneCount}</b> von ${v.players.length} fertig</p>`;
  }

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
          <button class="pen-btn ${p.tool === 'pen' ? 'on' : ''}" data-act="pen-tool" data-value="pen" aria-label="Stift" title="Stift">✏️</button>
          <button class="pen-btn ${p.tool === 'fill' ? 'on' : ''}" data-act="pen-tool" data-value="fill" aria-label="Farbeimer" title="Farbeimer">🪣</button>
          <button class="pen-btn ${p.tool === 'eraser' ? 'on' : ''}" data-act="pen-tool" data-value="eraser" aria-label="Radierer" title="Radierer">🧽</button>
          <button class="pen-btn" data-act="pen-undo" aria-label="Rückgängig" title="Rückgängig">↶</button>
          <button class="pen-btn" data-act="pen-clear" aria-label="Alles löschen" title="Alles löschen">🗑</button>
        </div>
      </div>`;
  }

  /** Vorlage: der Satz bzw. das Wort davor */
  function promptHtml(t) {
    const p = t.prev;
    if (!p) return '';
    if (p.kind === 'word') {
      return `<div class="prompt"><small>Zeichne den Begriff</small><b>${esc(p.text)}</b>
        ${t.canReroll && !t.done ? '<button class="btn btn-link btn-small" data-act="reroll">🎲 anderes Wort</button>' : ''}</div>`;
    }
    if (p.empty) return `<div class="prompt is-empty"><small>Zeichne</small><b>${p.missing ? '(verschollen)' : '(nichts)'} – denk dir was aus!</b></div>`;
    return `<div class="prompt"><small>Zeichne</small><b>„${esc(p.text)}“</b></div>`;
  }

  /** Die Zeichnung davor (zum Beschreiben bzw. kurz zum Nachzeichnen) */
  function prevArtHtml(t, cls) {
    const p = t.prev;
    if (!p) return '';
    if (p.empty || !p.ref) return `<div class="art-empty phone-art">${p.missing ? '(verschollen)' : '(leeres Blatt)'} – denk dir was aus!</div>`;
    if (!ui.images[p.ref]) return `<div class="art-empty phone-art"><span class="spinner-sm"></span> Zeichnung lädt…</div>`;
    return `<div class="phone-art ${cls || ''}">${artHtml(p.ref, { suffix: '-p' })}</div>`;
  }

  function textFormHtml(t, placeholder) {
    const w = ui.work;
    return `<form class="say-form" data-form="say">
        <textarea id="text-input" class="input say-input" rows="2" maxlength="${MAX_TEXT}" placeholder="${esc(placeholder)}" data-field="say"
          autocomplete="off" enterkeyhint="done">${esc(w.text)}</textarea>
        <div class="say-actions">
          ${t.canSuggest ? '<button class="btn btn-ghost" type="button" data-act="suggest">🎲 Vorschlag</button>' : ''}
          <button class="btn btn-primary btn-big" type="submit">Fertig ✓</button>
        </div>
      </form>`;
  }

  function phoneTaskHtml(v) {
    const t = v.task;
    const si = STEP_INFO[t.type];
    if (t.done) {
      const left = v.waiting.filter((id) => id !== v.me.id);
      const names = left.map((id) => (player(v, id) || {}).name).filter(Boolean);
      return `<div class="look-up win">✅<b>Abgegeben!</b><small>${v.doneCount} von ${v.players.length} fertig</small></div>
        ${names.length ? `<p class="muted center small">Es fehlen noch: ${esc(names.join(', '))}</p>` : ''}
        <p class="waiting">⏳ Gleich wandert alles weiter …</p>
        ${!v.timer || v.timer.remaining > 1500 ? `<button class="btn btn-link" data-act="edit">✏️ Doch noch ändern</button>` : ''}`;
    }
    if (t.type === 'write') {
      return `<h2 class="phone-title">${si.icon} ${esc(si.phone)}</h2>
        <p class="muted center small">Etwas, das man zeichnen kann – je verrückter, desto besser. Niemand sieht ihn, bis zur Vorführung.</p>
        ${textFormHtml(t, 'z.B. Ein Pinguin fährt Ski')}`;
    }
    if (t.type === 'describe') {
      return `<h2 class="phone-title">${si.icon} ${esc(si.phone)}</h2>
        ${prevArtHtml(t)}
        ${textFormHtml(t, t.last ? 'Was ist das? (die letzte Beschreibung!)' : 'Beschreib die Zeichnung in einem Satz')}`;
    }
    // Zeichnen / Nachzeichnen
    if (t.type === 'copy' && peeking(v)) {
      const left = Math.max(1, Math.ceil((ui.work.peekStart + t.peek - Date.now()) / 1000));
      return `<h2 class="phone-title">👀 Merk dir das Bild!</h2>
        ${prevArtHtml(t, 'is-peek')}
        <p class="peek-count">Noch <b>${left}</b> s … dann aus dem Gedächtnis nachzeichnen</p>`;
    }
    if (t.type === 'copy' && t.prev && t.prev.ref && !ui.images[t.prev.ref]) {
      return `<h2 class="phone-title">${si.icon} ${esc(si.phone)}</h2>${prevArtHtml(t)}`;
    }
    const prompt =
      t.type === 'copy'
        ? `<div class="prompt"><small>🔁 Zeichne nach,</small><b>was du gerade gesehen hast</b></div>`
        : promptHtml(t);
    return `${prompt}
      <div class="sketch-frame phone-sketch">
        <div class="sketch-host" id="sketch-host" data-keep data-sketch data-editable="1"></div>
      </div>
      ${penToolsHtml()}
      <button class="btn btn-primary btn-big btn-wide" data-act="submit">Fertig ✓</button>`;
  }

  function phoneEntryHtml(v, owner, e) {
    const label = e.kind === 'word' ? `🎲 Startwort: <b>${esc(e.text)}</b>` : e.drawing ? `🖍️ Zeichnung von <b>${esc(e.name)}</b>${e.empty ? ' (leer)' : ''}` : `<b>${esc(e.name)}:</b> ${esc(entryText(e))}`;
    const mine = e.by === v.me.id;
    const heart =
      v.settings.hearts && e.kind !== 'word'
        ? e.canHeart
          ? `<button class="heart-btn ${e.hearted ? 'on' : ''}" data-act="heart" data-owner="${esc(owner)}" data-idx="${e.idx}" aria-pressed="${e.hearted}" aria-label="Herz">${e.hearted ? '❤️' : '🤍'}${e.hearts ? ` ${e.hearts}` : ''}</button>`
          : `<span class="heart-btn is-static">${mine ? 'du' : ''}${e.hearts ? ` ❤️ ${e.hearts}` : ''}</span>`
        : '';
    return `<li class="phone-entry ${mine ? 'is-mine' : ''}" style="${tc(e.color)}"><span class="team-dot"></span><span class="phone-entry-text">${label}</span>${heart}</li>`;
  }

  function phoneShowHtml(v) {
    const sh = v.show;
    const mineChain = sh.owner === v.me.id;
    const lastChain = sh.i === sh.count - 1;
    const nextLabel = !sh.complete ? 'Weiter ▶' : lastChain ? 'Zum Finale 🏁' : 'Nächste Kette ▶';
    const head = mineChain
      ? `<div class="look-up small win">🎬<b>Deine Kette läuft!</b><small>Du schaltest weiter – schau auf den Laptop</small></div>
        <button class="btn btn-primary btn-big btn-wide" data-act="next" data-i="${sh.i}" data-n="${sh.n}">${nextLabel}</button>`
      : `<div class="look-up small">👀<b>${esc(genitive(sh.ownerName))} Kette</b><small>Schau auf den Laptop!</small></div>`;
    const list = sh.entries.map((e) => phoneEntryHtml(v, sh.owner, e)).join('');
    return `${head}
      ${v.settings.hearts && v.me.playing ? '<p class="muted small center">Tipp auf 🤍 für deinen Lieblingsmoment in dieser Kette.</p>' : ''}
      <ol class="phone-entries">${list}</ol>
      ${sh.complete ? verdictHtml(v, sh) : ''}`;
  }

  function phoneOverHtml(v) {
    const awards = v.awards || [];
    const mine = v.chains && v.chains[0];
    return `<div class="look-up win">🏁<b>Alle Ketten gezeigt!</b>${v.settings.hearts && v.me.playing ? `<small>Du hast ${v.me.hearts} ${plural(v.me.hearts, 'Herz', 'Herzen')} bekommen</small>` : ''}</div>
      ${awards.length ? `<div class="awards">${awards.map((a) => `<div class="award"><span class="award-icon">${a.icon}</span><div><b>${esc(a.title)}</b><small>${esc(a.text)}</small></div></div>`).join('')}</div>` : ''}
      ${mine ? `<h2 class="phone-title">Deine Kette</h2><ol class="phone-entries">${mine.entries.map((e) => phoneEntryHtml(v, mine.owner, e)).join('')}</ol>` : ''}
      <p class="muted small center">Alle Ketten (auch als Bild zum Speichern) gibt es am Laptop. Dort kann auch eine neue Runde gestartet werden.</p>`;
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
      body = `<h2>📱 Raum-Code</h2>${roomBoxHtml(ui.view && ui.view.room, false)}
        <p class="muted small center">Wer schon mitspielt und rausgeflogen ist, kommt hierüber zurück. Neue Leute können nur noch zuschauen.</p>
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
        <p>Stille Post mit Zeichnungen: Alle sind <b>gleichzeitig</b> dran, jede/r mit einer anderen Kette. Nach jedem Schritt
          wandert alles eine Person weiter. Man sieht immer nur den Schritt direkt davor.</p>
        <h3>✍️ Schreiben</h3>
        <p>Am Anfang schreibt jede/r einen <b>Satz</b>, den man zeichnen kann – je verrückter, desto besser. Keine Idee? 🎲 schlägt einen vor.</p>
        <h3>🖍️ Zeichnen</h3>
        <p>Die nächste Person <b>zeichnet</b> den Satz. Farben, 3 Stärken, Farbeimer, Radierer, Rückgängig. Keine Buchstaben! Strichmännchen sind völlig okay.</p>
        <h3>💬 Beschreiben</h3>
        <p>Die nächste Person sieht nur die Zeichnung und <b>beschreibt</b>, was sie sieht. Das wird wieder gezeichnet, wieder beschrieben …</p>
        <h3>⏱ Zeit</h3>
        <p>Wer fertig ist, tippt <b>Fertig</b> (und kann es noch ändern). Sind alle fertig, geht es sofort weiter. Wer nicht fertig wird, gibt automatisch ab, was da ist.</p>
        <h3>🎬 Vorführung</h3>
        <p>Am Ende zeigt der Laptop jede Kette Schritt für Schritt – die Zeichnungen entstehen Strich für Strich noch einmal.
          Wem die Kette gehört, schaltet am Handy weiter. Mit ❤️ verteilt jede/r pro Kette ein Herz für den Lieblingsmoment.
          Am Ende gibt es jede Kette als Bild zum Speichern.</p>
        <h3>🔀 Modi</h3>
        <p><b>Wort-Start:</b> Jede Kette beginnt mit einem Begriff, erst wird gezeichnet. <b>Nur Zeichnen:</b> Man sieht eine Zeichnung nur 3 Sekunden und zeichnet sie aus dem Gedächtnis nach – am Ende wird beschrieben.</p>
        <h3>🍻 Trinkregeln (optional)</h3>
        <p>Kommt eine Kette völlig anders an, als sie angefangen hat, trinkt die Startperson 1. Alkoholfrei: Strafpunkte statt Schlucke.</p>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Los geht's!</button></div>`;
  }

  function menuHtml() {
    const v = ui.view;
    const items = [];
    items.push(`<button class="menu-item" data-act="rules">📖 Spielregeln</button>`);
    items.push(`<button class="menu-item" data-act="mute">${Sound.muted ? '🔊 Ton einschalten' : '🔇 Ton ausschalten'}</button>`);
    if (v && v.me.stage) {
      if (v.room) items.push(`<button class="menu-item" data-act="show-qr">📱 Raum-Code zeigen</button>`);
      if (v.phase === 'play') items.push(`<button class="menu-item" data-act="hurry">⏩ Beeilung! <small>(alle geben in 10 s ab)</small></button>`);
      items.push(`<button class="menu-item" data-act="home-keep">🏠 Hauptmenü <small>(Spiel bleibt gespeichert)</small></button>`);
      if (v.phase === 'play') items.push(`<button class="menu-item danger" data-act="end-game">⏩ Direkt zur Vorführung <small>(Ketten werden kürzer)</small></button>`);
      if (v.phase === 'show') items.push(`<button class="menu-item danger" data-act="end-game">🏁 Vorführung beenden</button>`);
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

  function setSetting(key, value) {
    if (!ui.view) return;
    dispatch('settings', { settings: Object.assign({}, ui.view.settings, { [key]: value }) });
  }

  function saveCustom(text) {
    if (!ui.view) return;
    ui.customText = null;
    setSetting('custom', Content.parseCustom(text));
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

  /** Kette als Bild herunterladen (nur am Laptop – die Bilder liegen dort) */
  function saveChain(owner) {
    const v = ui.view;
    if (!v || !ui.ctrl || !ui.ctrl.image) return;
    const chain = v.chains ? v.chains.find((c) => c.owner === owner) : v.show && v.show.owner === owner ? v.show : null;
    if (!chain) return;
    const entries = chain.entries.map((e) => {
      const base = { name: e.kind === 'word' ? 'Startwort' : e.name, color: e.color || '#e5e7eb', kind: e.kind };
      if (e.drawing) return e.ref ? Object.assign(base, { ops: ui.ctrl.image(e.ref) || [] }) : Object.assign(base, { note: e.missing ? '(verschollen)' : '(leeres Blatt)' });
      if (e.kind === 'word') return Object.assign(base, { text: e.text });
      return Object.assign(base, e.empty ? { note: entryText(e) } : { text: entryText(e) });
    });
    try {
      const canvas = Replay.exportChain({ title: `${genitive(chain.ownerName)} Kette`, entries, fill: Fill.paint });
      canvas.toBlob((blob) => {
        if (!blob) return toast('Das Bild konnte nicht erstellt werden.');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `fluesterpost-${chain.ownerName.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-') || 'kette'}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }, 'image/png');
    } catch (err) {
      toast('Das Bild konnte nicht erstellt werden: ' + err.message);
    }
  }

  const actions = {
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
          Store.remove(IMG_KEY);
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
        text: 'Du kannst über den Raum-Code jederzeit wieder beitreten – deine Ketten warten auf dich.',
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
    'end-game': () => {
      const play = ui.view && ui.view.phase === 'play';
      askConfirm({
        title: play ? 'Direkt zur Vorführung?' : 'Vorführung beenden?',
        text: play ? 'Der laufende Schritt wird noch abgeschlossen, danach werden die (kürzeren) Ketten gezeigt.' : 'Es geht direkt zum Ende mit Lieblingsmoment und Galerie.',
        yes: play ? 'Zur Vorführung' : 'Beenden',
        danger: true,
        run: () => dispatch('end'),
      });
    },

    /* Lobby */
    set: (el) => {
      const key = el.dataset.key;
      let value = el.dataset.value;
      if (['steps', 'writeTime', 'drawTime'].includes(key)) value = +value;
      setSetting(key, value);
    },
    toggle: (el) => setSetting(el.dataset.key, !ui.view.settings[el.dataset.key]),
    kick: (el) => dispatch('kick', { player: el.dataset.player }),
    watch: (el) => {
      ui.modal = null;
      dispatch('watch', { watch: el.dataset.watch === '1' });
    },
    start: () => {
      const ta = app.querySelector('#custom-sentences');
      if (ui.customText != null && ta) saveCustom(ta.value);
      dispatch('start');
    },

    /* Schritte */
    submit: () => submitWork(),
    edit: () => {
      const t = ui.view && ui.view.task;
      if (!t) return;
      if (ui.work) ui.work.auto = false;
      dispatch('edit', { step: t.step });
    },
    suggest: () => {
      const t = ui.view && ui.view.task;
      if (t) dispatch('suggest', { step: t.step });
    },
    reroll: () => {
      const t = ui.view && ui.view.task;
      if (t) dispatch('reroll', { step: t.step });
    },
    hurry: () => dispatch('hurry'),

    /* Vorführung */
    next: (el) => dispatch('next', { i: +el.dataset.i, n: +el.dataset.n }),
    back: () => dispatch('back'),
    'reveal-all': () => dispatch('reveal_all'),
    heart: (el) => {
      vibrate(30);
      dispatch('heart', { owner: el.dataset.owner, idx: +el.dataset.idx });
    },
    verdict: (el) => dispatch('verdict', { owner: el.dataset.owner, value: el.dataset.value === '1' }),
    'replay-art': (el) => {
      const ref = el.dataset.ref;
      for (const a of ui.arts.values()) {
        if (a.ref !== ref) continue;
        const ops = artOps(ref);
        if (ops) play(a, ops);
      }
    },
    'save-chain': (el) => saveChain(el.dataset.owner),
    rewatch: () => {
      ui.animated.clear();
      dispatch('rewatch');
    },
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
    'pen-clear': () => {
      if (!ui.sketch || !ui.sketch.strokes.length) return;
      askConfirm({
        title: 'Alles löschen?',
        text: 'Die ganze Zeichnung wird gelöscht.',
        yes: 'Löschen',
        danger: true,
        run: () => ui.sketch && ui.sketch.clear(),
      });
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
    else if (f === 'custom') ui.customText = el.value;
    else if (f === 'say' && ui.work) {
      ui.work.text = el.value.replace(/\n/g, ' ');
      saveWorkSoon();
    }
  });

  app.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.field === 'custom') saveCustom(el.value);
  });

  app.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key !== 'Enter' || !el.dataset) return;
    if (el.dataset.field === 'name') {
      e.preventDefault();
      const code = app.querySelector('#code-input');
      if (code && !code.value) code.focus();
      else app.querySelector('[data-form="join"] button[type="submit"]').click();
    } else if (el.dataset.field === 'say') {
      // Enter = Fertig (ein Satz braucht keine Zeilenumbrüche)
      e.preventDefault();
      submitWork();
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
      return;
    }
    if (form.dataset.form === 'say') submitWork();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.modal) {
      ui.modal = null;
      ui.confirm = null;
      render();
      return;
    }
    const v = ui.view;
    if (/INPUT|TEXTAREA/.test((e.target || {}).tagName || '') || ui.modal) return;
    // Bühne: Vorführung mit der Tastatur
    if (v && v.me.stage && v.phase === 'show' && v.show) {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        dispatch('next', { i: v.show.i, n: v.show.n });
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        dispatch('back');
      }
    }
    // Handy mit Tastatur: Strg+Z = rückgängig
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && ui.sketch && ui.sketch.editable) {
      e.preventDefault();
      ui.sketch.undo();
    }
  });

  window.addEventListener('beforeunload', () => {
    saveWork();
    if (ui.ctrl && ui.ctrl.mode === 'client') ui.ctrl.bye();
  });

  /* ------------------------------------------------------------------ */
  /* Start                                                               */
  /* ------------------------------------------------------------------ */

  function autoResume() {
    const active = session(ACTIVE_KEY);
    const saves = savedGames();
    let mine = null;
    try {
      mine = JSON.parse(session(CLIENT_KEY) || 'null');
    } catch {
      /* egal */
    }
    const client = mine && mine.code ? mine : saves.client;
    if (active === 'stage' && saves.stage) startStage({ state: saves.stage.state, code: saves.stage.code, key: saves.stage.key });
    else if (active === 'client' && client && (!ui.joinCode || ui.joinCode === client.code)) {
      startClient({ code: client.code, name: client.name, pid: client.pid });
    } else {
      if (ui.screen === 'join') ui.focus = ui.name ? '#code-input' : '#name-input';
      render();
    }
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.FP_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  requestAnimationFrame(timerLoop);
  setInterval(sendDraft, DRAFT_MS);
  autoResume();

  // für Tests
  window.FpApp = { ui, render: renderNow, actions };
})();
