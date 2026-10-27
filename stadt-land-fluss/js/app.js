/*
 * Oberfläche von „Stadt, Land, Fluss“.
 *  - Laptop („Bühne“): Spiel anlegen, Lobby mit QR-Code, Buchstabe, Füllstand, Stopp, Abstimmung Kategorie für
 *    Kategorie, Rundenwertung, Siegerehrung. Ein Gerät: Buchstabe + Timer + Punkteblock.
 *  - Handy: eine Zeile pro Kategorie (falscher Anfangsbuchstabe wird rot), Stopp, 👎 bei der Abstimmung
 * Gerendert wird per HTML-String + morphdom (nur geänderte Teile werden ersetzt).
 */
(function () {
  'use strict';

  const E = window.SLFEngine;
  const { PLAYER_COLORS, ROUND_OPTIONS, END_OPTIONS, TIME_OPTIONS, CAT_MODES, SCORINGS, MIN_PLAYERS, MAX_PLAYERS, MIN_CATS, MAX_CATS, MAX_CUSTOM, PER_ROUND, Engine, sanitizeSettings, catPool, catProblem, letterPool } = E;
  const { StageController, ClientController, Store, KEYS, Net, inviteLink, qrSvg } = window.SLFControllers;
  const { Sound, confetti, synth } = window.GameFx;
  const Kat = window.SLFKategorien;
  const Answers = window.SLFAnswers;

  const INPUT = {
    phones: { icon: '📱', label: 'Mit Handys', text: 'Alle schreiben auf dem eigenen Handy. Die App vergleicht, fasst Doppelte zusammen und zählt – die Gruppe stimmt über Zweifelsfälle ab.' },
    one: { icon: '🖥️', label: 'Ein Gerät', text: 'Geschrieben wird auf Papier. Der Laptop zieht den Buchstaben, läuft als Uhr mit und ist der Punkteblock.' },
  };
  const END_LABEL = { stop: '✋ Stopp', time: '⏱ Zeit', both: 'Beides' };
  const CAT_MODE_LABEL = { standard: 'Standard', pick: 'Auswahl', random: '🎲 Zufall' };
  const STATUS_TEXT = { letter: 'falscher Anfangsbuchstabe', vote: 'weggestimmt', lead: 'Spielleitung: zählt nicht', tie: 'Gleichstand', empty: 'leer' };
  const SETUP_KEY = 'slf.setup.v1';
  const PREFS_KEY = 'slf.prefs.v1';
  const ACTIVE_KEY = 'slf.active';
  const RESUME_MAX_AGE = 12 * 60 * 60 * 1000;
  const SEND_MS = 450; // Antworten gedrosselt an den Laptop schicken
  const SPIN_MS = 1300; // so lange rattert der Buchstabe, bevor er landet
  const ABC_MS = 110; // „ABC im Kopf“: so schnell läuft das Alphabet

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

  function colorOf(v, pid) {
    const p = player(v, pid);
    return p ? p.color : '#e5e7eb';
  }

  function catLabel(cat) {
    return `${Kat.icon(cat)} ${esc(cat)}`;
  }

  function pointsClass(n) {
    return n >= 20 ? 'p20' : n >= 10 ? 'p10' : n > 0 ? 'p5' : 'p0';
  }

  function defaultSetup() {
    return { settings: sanitizeSettings({}), players: ['', '', ''] };
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
    customCat: '', // neue eigene Kategorie (Eingabe)
    answers: [], // Handy: eigene Antworten (die Wahrheit liegt hier, der Laptop bekommt sie gedrosselt)
    answersRound: null,
    sent: null, // zuletzt geschickt (JSON)
    sendTimer: null,
    spin: null, // Bühne: { round, until } – der Buchstabe rattert noch
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
    /** Buchstabe rattert (wie eine Lostrommel) */
    spin() {
      for (let i = 0; i < 11; i++) synth.tone(500 + ((i * 137) % 400), i * 0.11, 0.04, { type: 'square', vol: 0.035 });
      synth.tone(988, 1.25, 0.25, { type: 'triangle', vol: 0.12 });
    },
    /** Stopp! */
    stop() {
      synth.tone(880, 0, 0.12, { type: 'square', vol: 0.08 });
      synth.tone(660, 0.12, 0.3, { type: 'square', vol: 0.08 });
    },
    /** 👎 auf der Bühne */
    boo() {
      synth.tone(220, 0, 0.18, { type: 'sawtooth', to: 150, vol: 0.05 });
    },
    /** Antwort abgegeben / Füllstand steigt */
    pop() {
      synth.tone(880, 0, 0.05, { type: 'sine', to: 1320, vol: 0.04 });
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
    flushAnswers();
    clearTimeout(ui.sendTimer);
    if (ui.ctrl) ui.ctrl.leave(keepSave);
    ui.ctrl = null;
    ui.token = null;
    ui.view = null;
    ui.modal = null;
    ui.flash = null;
    ui.answers = [];
    ui.answersRound = null;
    ui.sent = null;
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
    if (!v.me.stage) syncAnswers(v);
    transitions(prev, v);
    render();
  }

  /** Handy: eigene Antworten zur Runde passend halten (neue Runde leer, nach dem Neuladen vom Laptop zurück) */
  function syncAnswers(v) {
    if (!v.cats.length || !v.mine) return;
    if (ui.answersRound !== v.round) {
      ui.answersRound = v.round;
      ui.answers = v.mine.slice();
      ui.sent = JSON.stringify(ui.answers);
      clearTimeout(ui.sendTimer);
      return;
    }
    // Wiederverbunden, lokal noch nichts: was der Laptop hat, übernehmen
    if (ui.answers.every((t) => !t) && v.mine.some((t) => t)) {
      ui.answers = v.mine.slice();
      ui.sent = JSON.stringify(ui.answers);
    }
  }

  function handleStatus(status, info) {
    ui.status = status;
    if (status === 'online') {
      // nach einem Verbindungsabbruch: Antworten sicherheitshalber nochmal schicken
      ui.sent = null;
      scheduleSend(0);
    }
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
    if (!prev) {
      if (stage && v.phase === 'write') ui.spin = { round: v.round, until: 0 };
      return;
    }
    if (v.phase === 'end' && prev.phase !== 'end') {
      ui.flash = null;
      Sound.fanfare();
      setTimeout(() => confetti(['#f59e0b', '#fde047', '#38bdf8', '#ffffff'], 220), 150);
      return;
    }
    // Neuer Buchstabe
    if (v.phase === 'write' && (prev.phase !== 'write' || prev.round !== v.round) && v.letter && v.letter !== prev.letter) {
      if (stage) {
        ui.spin = { round: v.round, until: performance.now() + (prev.phase === 'draw' ? 0 : SPIN_MS) };
        if (prev.phase === 'draw') Sound.start();
        else Fx.spin();
      } else {
        Sound.start();
        vibrate([60, 40, 60]);
      }
      return;
    }
    if (v.phase === 'draw' && (prev.phase !== 'draw' || prev.round !== v.round)) {
      Sound.flip();
      return;
    }
    if (v.phase === 'grace' && prev.phase !== 'grace') {
      if (v.graceReason === 'time') Sound.buzzer();
      else Fx.stop();
      if (!stage) {
        vibrate([150, 80, 150]);
        // Zeit um: was noch nicht geschickt ist, sofort hinterher
        flushAnswers();
      }
      if (stage && v.stopName) flash(`✋ ${v.stopName} ruft STOPP!`, '#f59e0b');
      return;
    }
    if (stage && v.phase === 'write' && v.fill && prev.fill) {
      const sum = (f) => Object.values(f).reduce((a, b) => a + b, 0);
      if (sum(v.fill) > sum(prev.fill)) Fx.pop();
    }
    if (v.phase === 'review') {
      const r = v.review;
      const pr = prev.phase === 'review' ? prev.review : null;
      if (!pr || pr.cat !== r.cat) {
        Sound.flip();
        return;
      }
      if (stage) {
        const downs = (x) => x.items.reduce((a, it) => a + it.downs, 0);
        if (downs(r) > downs(pr)) Fx.boo();
      }
      return;
    }
    if (v.phase === 'scores' && prev.phase !== 'scores') {
      Sound.success();
      if (stage) setTimeout(() => confetti(['#22c55e', '#fde047', '#ffffff'], 90), 200);
    }
    if (v.phase === 'tally' && prev.phase !== 'tally') Sound.flip();
  }

  /* ------------------------------------------------------------------ */
  /* Antworten schicken (Handy)                                          */
  /* ------------------------------------------------------------------ */

  function canWrite(v) {
    return !!(v && v.me && v.me.playing && (v.phase === 'write' || (v.phase === 'grace' && v.graceReason !== 'time')));
  }

  function scheduleSend(ms) {
    clearTimeout(ui.sendTimer);
    ui.sendTimer = setTimeout(sendAnswers, ms == null ? SEND_MS : ms);
  }

  function sendAnswers() {
    clearTimeout(ui.sendTimer);
    ui.sendTimer = null;
    const v = ui.view;
    if (!ui.ctrl || ui.ctrl.mode !== 'client' || !v || !['write', 'grace'].includes(v.phase) || ui.answersRound !== v.round) return;
    const json = JSON.stringify(ui.answers);
    if (json === ui.sent) return;
    ui.sent = json;
    ui.ctrl.dispatch({ type: 'answers', texts: ui.answers.slice(), round: v.round });
  }

  function flushAnswers() {
    if (ui.sendTimer) sendAnswers();
  }

  /* ------------------------------------------------------------------ */
  /* Timer & Animationen                                                 */
  /* ------------------------------------------------------------------ */

  function timerLoop() {
    requestAnimationFrame(timerLoop);
    const now = performance.now();
    const elapsed = now - ui.viewAt;
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
    // Buchstabe rattert
    for (const el of app.querySelectorAll('[data-spin]')) {
      const until = ui.spin ? ui.spin.until : 0;
      const pool = el.dataset.pool || 'ABCDEFGHIJKLMNOPRSTUVWZ';
      const ch = now < until ? pool[Math.floor(now / 70) % pool.length] : el.dataset.spin;
      if (el.textContent !== ch) el.textContent = ch;
      el.classList.toggle('is-spinning', now < until);
    }
    // ABC im Kopf: das Alphabet läuft
    for (const el of app.querySelectorAll('[data-abc]')) {
      const pool = el.dataset.abc;
      if (!pool) continue;
      const ch = pool[Math.floor(now / ABC_MS) % pool.length];
      if (el.textContent !== ch) el.textContent = ch;
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
      onBeforeElUpdated(fromEl, toEl) {
        if (fromEl === document.activeElement && (fromEl.tagName === 'INPUT' || fromEl.tagName === 'TEXTAREA')) {
          // Fokussiertes Feld nicht anfassen – nur Klassen (rot/grün) und gesperrt übernehmen
          fromEl.className = toEl.className;
          fromEl.disabled = toEl.disabled;
          return false;
        }
        // Rattern und Alphabet steuert die Animation selbst
        if (fromEl.hasAttribute('data-spin') && toEl.hasAttribute('data-spin') && fromEl.dataset.spin === toEl.dataset.spin) return false;
        if (fromEl.hasAttribute('data-abc') && toEl.hasAttribute('data-abc')) return false;
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
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="Stadt, Land, Fluss">
      <span class="logo-icon" aria-hidden="true">✍️</span>
      <span class="logo-text"><span class="l1">Stadt,</span> <span class="l2">Land,</span> <span class="l3">Fluss</span></span>
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

  function settingHtml(title, text, control) {
    return `<div class="setting"><div class="setting-label"><b>${title}</b><small>${text}</small></div>${control}</div>`;
  }

  function settingsHtml(s, scope) {
    const phones = s.input === 'phones';
    const pts = SCORINGS[s.scoring];
    const rows = [
      settingHtml('🔁 Runden', `${s.rounds} Buchstaben, danach Siegerehrung`, seg('rounds', ROUND_OPTIONS, s.rounds, String, scope)),
      settingHtml(
        '✋ Rundenende',
        s.end === 'stop' ? 'Wer alles ausgefüllt hat, ruft Stopp – dann noch 3 Sekunden' : s.end === 'time' ? 'Feste Zeit, kein Stopp' : `Stopp (+3 s) – spätestens nach ${s.time} s`,
        seg('end', END_OPTIONS, s.end, (o) => END_LABEL[o], scope)
      ),
    ];
    if (s.end !== 'stop') rows.push(settingHtml('⏱ Zeit', 'So lange wird höchstens geschrieben', seg('time', TIME_OPTIONS, s.time, (o) => o + ' s', scope)));
    rows.push(
      settingHtml(
        '🔤 Buchstabe',
        s.draw === 'abc' ? 'Wie früher: Das Alphabet läuft, bis jemand Stopp drückt' : 'Zufällig, jeder Buchstabe nur einmal pro Spiel',
        seg('draw', ['random', 'abc'], s.draw, (o) => (o === 'abc' ? '🔤 ABC im Kopf' : '🎲 Zufall'), scope)
      ),
      settingHtml('🧗 Schwere Buchstaben', s.hard ? 'Alle 26 Buchstaben – auch Q, X und Y' : 'Ohne Q, X und Y', switchHtml(s.hard, 'hard', scope)),
      settingHtml('Ä zählt als A', s.umlauts ? '„Ölberg“ gilt bei O, „Überlingen“ bei U' : 'Ä, Ö und Ü sind eigene Buchstaben', switchHtml(s.umlauts, 'umlauts', scope)),
      settingHtml(
        '🏆 Punkte',
        `Einzige gültige Antwort ${pts.solo} · einzigartig ${pts.unique} · doppelt ${pts.dupe}`,
        seg('scoring', Object.keys(SCORINGS), s.scoring, (o) => (o === '10-5' ? 'Einfach 10/5' : '20/10/5'), scope)
      )
    );
    if (phones) {
      rows.push(
        settingHtml(
          '👎 Abstimmung',
          s.vote === 'all' ? 'Gründlich: Jede/r bewertet jede Antwort mit 👍 oder 👎' : 'Schnell: Nur wer zweifelt, drückt 👎 – sonst „Alles ok“',
          seg('vote', ['doubt', 'all'], s.vote, (o) => (o === 'all' ? 'Alle Antworten' : 'Nur angezweifelte'), scope)
        )
      );
    }
    rows.push(settingHtml('🍻 Trinkregeln', '0 Punkte in einer Kategorie → 1 Schluck · Stopp gerufen und trotzdem ein Fehler → 2 dazu', switchHtml(s.drinks, 'drinks', scope)));
    return `<div class="settings">${rows.join('')}</div>`;
  }

  /** Kategorien wählen: Standard, eigene Auswahl aus Paketen, Zufall aus Paketen – plus eigene Kategorien */
  function catsHtml(s, scope) {
    const mode = s.catMode;
    let body = '';
    const customForm = `
      <form class="custom-cat" data-form="custom-cat" data-scope="${scope}">
        <input class="input" type="text" maxlength="${Kat.MAX_CAT}" placeholder="Eigene Kategorie, z.B. Automarke" value="${esc(ui.customCat)}" data-field="custom-cat" autocomplete="off" enterkeyhint="done" />
        <button class="btn btn-ghost" type="submit" ${s.custom.length >= MAX_CUSTOM ? 'disabled' : ''}>＋</button>
      </form>`;
    if (mode === 'standard') {
      body = `<div class="cat-chips">${Kat.STANDARD.map((c) => `<span class="cat-chip on static">${catLabel(c)}</span>`).join('')}</div>
        <p class="muted small">Der Klassiker – oder wählt eure eigenen Kategorien bzw. lasst jede Runde würfeln.</p>`;
    } else if (mode === 'pick') {
      const chosen = s.cats.map((c) => c.toLowerCase());
      const chip = (c, removable) => {
        const on = chosen.includes(c.toLowerCase());
        return `<span class="cat-chip-wrap"><button class="cat-chip ${on ? 'on' : ''}" data-act="cat-toggle" data-cat="${esc(c)}" data-scope="${scope}" aria-pressed="${on}">${catLabel(c)}</button>${
          removable ? `<button class="chip-x" data-act="custom-remove" data-cat="${esc(c)}" data-scope="${scope}" aria-label="${esc(c)} löschen">✕</button>` : ''
        }</span>`;
      };
      const packs = Kat.PACKS.map((p) => `<div class="pack"><div class="pack-head">${p.icon} ${esc(p.label)}${p.adult ? ' <small class="muted">(ab 18)</small>' : ''}</div><div class="cat-chips">${p.cats.map((c) => chip(c)).join('')}</div></div>`).join('');
      const own = `<div class="pack"><div class="pack-head">${Kat.CUSTOM_PACK.icon} Eigene <small class="muted">(in diesem Browser gespeichert)</small></div>
          ${s.custom.length ? `<div class="cat-chips">${s.custom.map((c) => chip(c, true)).join('')}</div>` : ''}${customForm}</div>`;
      body = `<div class="picked">${s.cats.length ? s.cats.map((c, i) => `<span class="cat-chip on static">${i + 1}. ${catLabel(c)}</span>`).join('') : '<span class="muted">Noch nichts ausgewählt</span>'}</div>
        <p class="muted small">${s.cats.length} / ${MAX_CATS} ausgewählt (mindestens ${MIN_CATS}) – in der Reihenfolge des Antippens.</p>
        ${packs}${own}`;
    } else {
      const card = (p, cats) => {
        const on = s.packs.includes(p.id);
        return `<button class="pack-card ${on ? 'on' : ''}" data-act="pack-toggle" data-pack="${p.id}" data-scope="${scope}" aria-pressed="${on}">
          <b>${p.icon} ${esc(p.label)}${p.adult ? ' <small>(ab 18)</small>' : ''}</b>
          <small>${cats.length ? cats.slice(0, 5).map(esc).join(', ') + (cats.length > 5 ? ' …' : '') : 'noch keine – unten eintippen'}</small>
        </button>`;
      };
      const pool = catPool(s);
      body = `<div class="pack-cards">${Kat.PACKS.map((p) => card(p, p.cats)).join('')}${card(Kat.CUSTOM_PACK, s.custom)}</div>
        ${s.custom.length ? `<div class="cat-chips">${s.custom.map((c) => `<span class="cat-chip-wrap"><span class="cat-chip static">${catLabel(c)}</span><button class="chip-x" data-act="custom-remove" data-cat="${esc(c)}" data-scope="${scope}" aria-label="${esc(c)} löschen">✕</button></span>`).join('')}</div>` : ''}
        ${customForm}
        <p class="muted small">Jede Runde ${PER_ROUND} zufällige aus ${pool.length} ${plural(pool.length, 'Kategorie', 'Kategorien')}.</p>`;
    }
    const problem = catProblem(s);
    return `${seg('catMode', CAT_MODES, mode, (o) => CAT_MODE_LABEL[o], scope)}
      <div class="cats-body">${body}</div>
      ${problem ? `<p class="alert small">${esc(problem)}</p>` : ''}`;
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

  /** Der Buchstabe als Kachel (auf der Bühne rattert er erst) */
  function letterHtml(v, opts) {
    const o = opts || {};
    const spin = o.spin && ui.spin && ui.spin.round === v.round;
    const pool = letterPool(v.settings).join('');
    return `<div class="letter-tile ${o.small ? 'lt-small' : ''}" id="lt-${v.round}" aria-label="Buchstabe ${esc(v.letter)}">
      <span ${spin ? `data-spin="${esc(v.letter)}" data-pool="${pool}"` : ''}>${esc(spin && performance.now() < ui.spin.until ? pool[0] : v.letter)}</span>
    </div>`;
  }

  function catsLineHtml(v) {
    return `<div class="cats-line">${v.cats.map((c) => `<span class="cats-line-item">${catLabel(c)}</span>`).join('')}</div>`;
  }

  /** Füllstand ▰▰▱ */
  function fillHtml(n, total) {
    return `<span class="fill" aria-label="${n} von ${total}">${Array.from({ length: total }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
  }

  function roundPill(v) {
    return `<span class="pill">🔁 Runde ${v.round} / ${v.rounds}</span>`;
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
    return `
    <div class="screen home">
      <a class="btn btn-ghost btn-small hub-back" href="../">← Alle Spiele</a>
      <div class="home-hero">
        ${logoHtml()}
        <p class="tagline">Ein Buchstabe, sechs Kategorien – wer zuerst alles hat, ruft <b>„Stopp!“</b><br /><small>Einzigartige Antworten bringen mehr Punkte als doppelte.</small></p>
        <div class="home-sheet" aria-hidden="true">
          <div class="letter-tile lt-small"><span>M</span></div>
          <div class="sheet">
            <span><small>Stadt</small>München</span><span><small>Land</small>Mexiko</span><span><small>Fluss</small>Main</span>
            <span class="is-out"><small>Name</small>Lisa</span><span><small>Tier</small>Maus</span><span><small>Beruf</small>Maurer</span>
          </div>
        </div>
      </div>
      ${resume.join('')}
      <div class="mode-cards">
        <button class="mode-card mode-stage" data-act="new-game">
          <span class="mode-icon">💻</span>
          <span class="mode-body"><b>Spiel anlegen</b><small>Am Laptop, Tablet oder Fernseher: Buchstabe, Uhr, Abstimmung und Punkte.</small></span>
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
      <p class="home-foot">${MIN_PLAYERS}–${MAX_PLAYERS} Personen · Handys oder Papier · ${Kat.PACKS.reduce((n, p) => n + p.cats.length, 0)} Kategorien in ${Kat.PACKS.length} Paketen</p>
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
        .map(
          (p, pi) => `
          <div class="player-row" style="${tc(PLAYER_COLORS[pi % PLAYER_COLORS.length])}">
            <span class="team-dot"></span>
            <input class="input" type="text" maxlength="24" placeholder="Spieler ${pi + 1}" value="${esc(p)}"
              data-field="player-name" data-player="${pi}" autocomplete="off" enterkeyhint="next" />
            ${s.players.length > MIN_PLAYERS ? `<button class="icon-btn" data-act="remove-player" data-player="${pi}" aria-label="Spieler entfernen">✕</button>` : ''}
          </div>`
        )
        .join('');
      people = `<h2>Mitspieler <small class="muted">(${MIN_PLAYERS}–${MAX_PLAYERS} – auch Teams, ein Zettel pro Team)</small></h2>
        <div class="ts-players solo-players">${rows}</div>
        ${s.players.length < MAX_PLAYERS ? '<button class="btn btn-small btn-ghost" data-act="add-player">＋ Spieler</button>' : ''}`;
    } else {
      people = `<h2>Mitspieler</h2><p class="muted">Jede/r tritt mit dem eigenen Handy bei (${MIN_PLAYERS}–${MAX_PLAYERS} Personen). Teams? Dann ein Handy pro Team.</p>`;
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
        <h2>📋 Kategorien</h2>
        ${catsHtml(st, 'setup')}
      </section>
      <section class="panel">
        <h2>Einstellungen</h2>
        ${settingsHtml(st, 'setup')}
      </section>
      <div class="sticky-start">
        <button class="btn btn-primary btn-big" data-act="create-game">${st.input === 'phones' ? 'Raum öffnen 📱' : "Los geht's ✍️"}</button>
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
        <label class="label" for="name-input">Dein Name <small class="muted">(oder Teamname)</small></label>
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
      info = roundPill(v);
      if (v.letter && v.phase !== 'write') info += `<span class="pill pill-hot">🔤 ${esc(v.letter)}</span>`;
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
          <div class="score-num">${p.score}</div>
        </div>`
      )
      .join('')}</footer>`;
  }

  function stageHtml(v) {
    let main;
    if (v.phase === 'lobby') main = lobbyStageHtml(v);
    else if (v.phase === 'end') main = endHtml(v);
    else if (v.phase === 'draw') main = drawStageHtml(v);
    else if (v.phase === 'write' || v.phase === 'grace') main = writeStageHtml(v);
    else if (v.phase === 'review') main = reviewStageHtml(v);
    else if (v.phase === 'tally') main = tallyStageHtml(v);
    else main = scoresStageHtml(v);
    return `
      <div class="stage phase-${v.phase}">
        ${topbarHtml(v)}
        <main class="stage-main">${main}</main>
        ${scoreboardHtml(v)}
      </div>`;
  }

  /* ---------- Lobby ---------- */

  function lobbyStageHtml(v) {
    const chip = (p) => {
      const m = v.members.find((x) => x.id === p.id) || { online: p.online };
      return `<span class="chip ${m.online ? '' : 'is-offline'}" style="${tc(p.color)}"><span class="team-dot"></span>${esc(p.name)}<button class="chip-x" data-act="kick" data-player="${esc(p.id)}" aria-label="${esc(p.name)} entfernen">✕</button></span>`;
    };
    const watching = v.members.filter((m) => !m.playing);
    return `
      <div class="lobby-grid">
        <section class="panel join-panel">
          <h2>📱 Handys verbinden</h2>
          <p class="muted">QR-Code scannen, Namen eingeben – los geht's.</p>
          ${roomBoxHtml(v.room, true)}
        </section>
        <div class="lobby-side">
          <section class="panel">
            <h2>Mitspieler <small class="muted">(${v.players.length} / ${MAX_PLAYERS})</small></h2>
            <div class="chips">${v.players.length ? v.players.map(chip).join('') : '<span class="muted">Noch niemand – QR-Code scannen!</span>'}</div>
            ${watching.length ? `<div class="free"><b>Schauen nur zu:</b> <div class="chips">${watching.map((m) => `<span class="chip ${m.online ? '' : 'is-offline'}">${esc(m.name)}<button class="chip-x" data-act="kick" data-player="${esc(m.id)}" aria-label="${esc(m.name)} entfernen">✕</button></span>`).join('')}</div></div>` : ''}
            <p class="muted small">Das erste Handy ist die 🎬 Spielleitung und kann vom Handy aus weiterschalten.</p>
          </section>
          <section class="panel">
            <h2>📋 Kategorien</h2>
            ${catsHtml(v.settings, 'lobby')}
          </section>
          <section class="panel">
            <h2>Einstellungen</h2>
            ${settingsHtml(v.settings, 'lobby')}
          </section>
          <div class="sticky-start">
            <button class="btn btn-primary btn-big" data-act="start" ${v.lobbyProblem ? 'disabled' : ''}>Los geht's ✍️</button>
            ${v.lobbyProblem ? `<p class="muted small center">${esc(v.lobbyProblem)}</p>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ---------- ABC im Kopf ---------- */

  function drawStageHtml(v) {
    const pool = (v.letters || []).join('');
    return `
      <div class="center-stage draw-stage">
        <h1 class="stage-title">🔤 Runde ${v.round}: Das Alphabet läuft …</h1>
        <div class="letter-tile is-running"><span data-abc="${esc(pool)}">${esc(pool[0] || '?')}</span></div>
        <p class="muted center">Wie früher: Eine/r sagt still das Alphabet auf, jemand anderes ruft <b>Stopp</b>.<br />Hier drücken – oder auf einem Handy.</p>
        ${catsLineHtml(v)}
        <button class="btn btn-primary btn-big btn-stop" data-act="pick">✋ Stopp!</button>
      </div>`;
  }

  /* ---------- Schreiben ---------- */

  function writeStageHtml(v) {
    const phones = v.settings.input === 'phones';
    const grace = v.phase === 'grace';
    let status = '';
    if (phones) {
      status = `<div class="fills">${v.players
        .map((p) => {
          const n = (v.fill || {})[p.id] || 0;
          const stop = v.stopBy === p.id;
          return `<div class="fill-row ${p.online ? '' : 'is-offline'} ${n === v.cats.length ? 'is-full' : ''}" style="${tc(p.color)}">
            <span class="team-dot"></span><b>${esc(p.name)}</b>${fillHtml(n, v.cats.length)}<span class="fill-flag">${stop ? '✋' : p.online ? '' : '📵'}</span>
          </div>`;
        })
        .join('')}</div>`;
    }
    let banner = '';
    if (grace) {
      const who = v.graceReason === 'time' ? '⏰ Zeit um!' : v.stopName ? `✋ ${esc(v.stopName)} ruft STOPP!` : '✋ STOPP!';
      banner = `<div class="stop-banner ${v.graceReason === 'time' ? 'is-time' : ''}"><b>${who}</b>${v.graceReason === 'time' ? '<small>Stifte weg!</small>' : `<small>Noch ${timerHtml(v.timer, { cls: 'timer-inline' })} Sekunden …</small>`}</div>`;
    }
    const howEnd =
      v.settings.end === 'time'
        ? 'Geschrieben wird, bis die Zeit um ist.'
        : phones
          ? 'Wer alles ausgefüllt hat, drückt auf dem Handy <b>Stopp</b> – dann haben alle noch 3 Sekunden.'
          : 'Wer zuerst alles hat, ruft laut <b>„Stopp!“</b> – hier drücken, dann haben alle noch 3 Sekunden.';
    const actions = grace
      ? ''
      : phones
        ? `<div class="stage-actions"><button class="btn btn-ghost btn-small" data-act="force-stop">⏩ Jetzt beenden</button></div>`
        : `<button class="btn btn-primary btn-big btn-stop" data-act="force-stop">✋ STOPP!</button>`;
    return `
      <div class="center-stage write-stage">
        <div class="write-head">
          ${letterHtml(v, { spin: true })}
          <div class="write-info">
            <h1 class="stage-title">Alles mit <b class="hl">${esc(v.letter)}</b>!</h1>
            ${catsLineHtml(v)}
          </div>
        </div>
        ${grace ? banner : timerHtml(v.timer, { tick: true, clock: true, cls: 'timer-big' })}
        ${grace ? '' : `<p class="muted center">${howEnd}</p>`}
        ${status}
        ${actions}
      </div>`;
  }

  /* ---------- Abstimmung ---------- */

  function badgesHtml(it, letter) {
    const b = [];
    if (it.known) b.push('<span class="badge badge-ok" title="steht in unserer Liste – nur eine Hilfe">✓ bekannt</span>');
    if (!it.letterOk) b.push(`<span class="badge badge-bad">✗ nicht mit ${esc(letter)}</span>`);
    if (it.downs) b.push(`<span class="badge badge-veto" title="${it.downs} von ${it.voters}">${'👎'.repeat(Math.min(it.downs, 5))}${it.downs > 5 ? '+' : ''} <small>${it.downs}/${it.voters}</small></span>`);
    if (it.ups) b.push(`<span class="badge badge-up">👍 ${it.ups}</span>`);
    if (it.decided !== null) b.push(`<span class="badge badge-lead">🎬 ${it.decided ? 'zählt' : 'zählt nicht'}</span>`);
    return b.join('');
  }

  /** Spielleitung: zählt / zählt nicht / zurück zur Abstimmung */
  function decideHtml(r, it) {
    const btn = (valid, label, cls) => `<button class="btn btn-small ${cls}" data-act="decide" data-cat="${r.cat}" data-id="${esc(it.id)}" data-valid="${valid}">${label}</button>`;
    if (it.status === 'tie') return `<div class="decide is-tie"><small>⚖️ Gleichstand – Spielleitung:</small>${btn(true, '✓ zählt', 'btn-ok')}${btn(false, '✗ zählt nicht', 'btn-bad')}</div>`;
    if (it.decided !== null) return `<div class="decide">${btn('null', '↺ Abstimmung', 'btn-ghost')}</div>`;
    return `<div class="decide">${it.status === 'out' ? btn(true, '🎬 zählt doch', 'btn-ghost') : btn(false, '🎬 streichen', 'btn-ghost')}</div>`;
  }

  function reviewStageHtml(v) {
    const r = v.review;
    const answers = r.items.length
      ? `<div class="answers">${r.items
          .map((it, i) => {
            const out = it.status === 'out';
            return `<div class="answer is-${it.status}" style="--d:${(i * 0.06).toFixed(2)}s">
              <div class="answer-top">
                <b class="answer-text">${esc(it.text)}</b>
                <span class="answer-points ${out ? 'p0' : pointsClass(it.points)}">${out ? '✗' : it.points}</span>
              </div>
              ${it.variants.length > 1 ? `<small class="answer-variants">${it.variants.slice(1).map(esc).join(' · ')}</small>` : ''}
              <div class="answer-names">${it.pids.map((pid, k) => `<span style="${tc(colorOf(v, pid))}"><span class="team-dot"></span>${esc(it.names[k])}</span>`).join('')}</div>
              <div class="answer-badges">${badgesHtml(it, v.letter)}${out ? `<span class="badge badge-out">${esc(STATUS_TEXT[it.reason] || 'zählt nicht')}</span>` : ''}</div>
              ${decideHtml(r, it)}
            </div>`;
          })
          .join('')}</div>`
      : `<div class="look-away"><div class="look-away-icon">🦗</div><h2>Niemand hat etwas mit ${esc(v.letter)}</h2></div>`;
    const doneNames = r.eligible.length ? `${r.done.length} / ${r.eligible.length} ${v.settings.vote === 'all' ? 'haben abgestimmt' : 'sind fertig'}` : '';
    const last = r.cat === r.total - 1;
    return `
      <div class="center-stage review-stage" id="rv-${v.round}-${r.cat}">
        <div class="review-head">
          <span class="pill">${r.cat + 1} / ${r.total}</span>
          <h1 class="stage-title">${Kat.icon(r.name)} <span class="caps">${esc(r.name)}</span> mit <b class="hl">${esc(v.letter)}</b></h1>
        </div>
        ${answers}
        ${r.empty.length ? `<p class="muted center small">Leer: ${r.empty.map(esc).join(', ')}</p>` : ''}
        <p class="muted center small">${v.settings.vote === 'all' ? 'Auf den Handys 👍 oder 👎 für jede Antwort.' : 'Zweifel? Auf dem Handy 👎 drücken.'} Mehrheit 👎 = zählt nicht · ${doneNames}${r.ties ? ` · ⚖️ ${r.ties}× Gleichstand` : ''}</p>
        <div class="stage-actions">
          ${r.cat > 0 ? `<button class="btn btn-ghost" data-act="back">← ${esc(v.cats[r.cat - 1])}</button>` : ''}
          <button class="btn btn-primary btn-big ${r.done.length >= r.eligible.length && r.eligible.length ? 'is-ready' : ''}" data-act="next" data-cat="${r.cat}">${last ? 'Zur Wertung 🏆' : `Weiter → ${esc(r.nextName)}`}</button>
        </div>
      </div>`;
  }

  /* ---------- Ein Gerät: Punkte eintragen ---------- */

  function tallyStageHtml(v) {
    const pts = SCORINGS[v.settings.scoring];
    const values = [...new Set([0, pts.dupe, pts.unique, pts.solo])];
    const rows = v.players
      .map((p) => {
        const row = (v.tally || {})[p.id] || [];
        const sum = row.reduce((a, b) => a + (b || 0), 0);
        const cells = v.cats
          .map(
            (c, ci) => `<td><div class="tally-cell">${values
              .map((n) => `<button class="tally-btn ${row[ci] === n ? 'on ' + pointsClass(n) : ''}" data-act="cell" data-player="${esc(p.id)}" data-cat="${ci}" data-points="${n}" aria-pressed="${row[ci] === n}">${n}</button>`)
              .join('')}</div></td>`
          )
          .join('');
        return `<tr style="${tc(p.color)}"><th><span class="team-dot"></span>${esc(p.name)}</th>${cells}<td class="tally-sum">${sum}</td></tr>`;
      })
      .join('');
    return `
      <div class="center-stage tally-stage">
        <div class="review-head">
          ${letterHtml(v, { small: true })}
          <h1 class="stage-title">Vorlesen & Punkte eintragen</h1>
        </div>
        <p class="muted center">Kategorie für Kategorie vorlesen. Gleiche Antworten <b>${pts.dupe}</b>, einzigartig <b>${pts.unique}</b>${pts.solo > pts.unique ? `, als Einzige/r eine gültige <b>${pts.solo}</b>` : ''}, leer oder ungültig <b>0</b>. Zweifel? Die Gruppe stimmt ab.</p>
        <div class="tally-wrap"><table class="tally">
          <thead><tr><th></th>${v.cats.map((c) => `<th>${catLabel(c)}</th>`).join('')}<th>Σ</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <button class="btn btn-primary btn-big" data-act="next">Runde werten ✓</button>
      </div>`;
  }

  /* ---------- Rundenwertung ---------- */

  function drinksHtml(v, last) {
    if (!v.settings.drinks) return '';
    const list = Object.entries(last.sips || {});
    if (!list.length) return '<p class="drink">🍻 Niemand muss trinken – alle haben überall Punkte!</p>';
    return `<p class="drink">🍻 ${list.map(([pid, n]) => `<b>${esc(last.names[pid] || '?')}</b> ${n} ${plural(n, 'Schluck', 'Schlucke')}${pid === last.stopBy ? ' (Stopp mit Fehler)' : ''}`).join(' · ')}</p>`;
  }

  function scoresStageHtml(v) {
    const last = v.last;
    const phones = v.settings.input === 'phones';
    const order = v.standings.map((s) => s.id).filter((id) => last.rows[id]);
    const rows = order
      .map((pid) => {
        const row = last.rows[pid];
        const s = v.standings.find((x) => x.id === pid);
        const cells = last.cats
          .map((c, ci) => {
            const n = row.points[ci];
            const st = row.status[ci];
            const text = phones ? row.texts[ci] : '';
            return `<td class="${pointsClass(n)} ${st && st !== 'ok' ? 'is-out' : ''}" title="${esc(STATUS_TEXT[st] || '')}">${phones ? `<span class="cell-text">${esc(text) || '–'}</span>` : ''}<b>${n}</b></td>`;
          })
          .join('');
        return `<tr style="${tc(colorOf(v, pid))}"><th><span class="place">${s ? s.place : ''}.</span><span class="team-dot"></span>${esc(last.names[pid] || '?')}${last.stopBy === pid ? ' ✋' : ''}</th>${cells}<td class="round-sum">+${row.sum}</td><td class="total">${s ? s.score : ''}</td></tr>`;
      })
      .join('');
    const lastRound = v.round >= v.rounds;
    return `
      <div class="center-stage scores-stage" id="sc-${v.round}">
        <div class="review-head">
          ${letterHtml(v, { small: true })}
          <h1 class="stage-title">Runde ${v.round} geschafft!</h1>
        </div>
        ${last.stopName ? `<p class="muted center">✋ Stopp gerufen hat <b>${esc(last.stopName)}</b></p>` : ''}
        <div class="tally-wrap"><table class="results">
          <thead><tr><th></th>${last.cats.map((c) => `<th>${catLabel(c)}</th>`).join('')}<th>Runde</th><th>Gesamt</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        ${drinksHtml(v, last)}
        <button class="btn btn-primary btn-big" data-act="next">${lastRound ? 'Zur Siegerehrung 🏆' : `Nächste Runde (${v.round + 1} / ${v.rounds}) →`}</button>
      </div>`;
  }

  /* ---------- Spielende ---------- */

  function endHtml(v) {
    const st = v.standings;
    const pl = st.map((s) => ({ s, p: player(v, s.id) })).filter((x) => x.p);
    const podium = pl
      .slice(0, 3)
      .map(
        ({ s, p }, i) => `
        <div class="podium-step p${i + 1}" style="${tc(p.color)}">
          <div class="podium-medal">${['🥇', '🥈', '🥉'][s.place - 1] || '🏅'}</div>
          <b>${esc(p.name)}</b>
          <span>${s.score} ${plural(s.score, 'Punkt', 'Punkte')}</span>
          <div class="podium-block">${s.place}</div>
        </div>`
      )
      .join('');
    const rest = pl.slice(3);
    const winners = pl.filter((x) => x.s.place === 1).map((x) => esc(x.p.name));
    const awards = (v.awards || []).map((a) => `<div class="award"><span class="award-icon">${a.icon}</span><div><b>${esc(a.title)}</b><small>${esc(a.text)}</small></div></div>`).join('');
    const rounds = (v.history || [])
      .map(
        (h) => `<li><b class="hl">${esc(h.letter)}</b> <small class="muted">${h.cats.map(esc).join(' · ')}</small>${
          v.settings.input === 'phones'
            ? `<br /><small>${Object.entries(h.rows)
                .map(([pid, row]) => `${esc(h.names[pid] || '?')}: ${row.texts.map((t, i) => (row.points[i] ? esc(t) : `<s>${esc(t)}</s>`)).filter((t) => t && t !== '<s></s>').join(', ') || '–'} (+${row.sum})`)
                .join(' · ')}</small>`
            : ''
        }</li>`
      )
      .join('');
    return `
      <div class="center-stage over">
        <h1 class="over-title">${!pl.length ? '🏁 Spiel vorbei' : winners.length > 1 ? `🤝 Unentschieden: ${winners.join(' & ')}` : `🏆 ${winners[0]} gewinnt!`}</h1>
        ${pl.length > 1 ? `<div class="podium">${podium}</div>` : ''}
        ${rest.length ? `<div class="summary">${rest.map(({ s, p }) => `<div class="summary-row" style="${tc(p.color)}"><span class="team-dot"></span><b>${s.place}. ${esc(p.name)}</b><b class="summary-points">${s.score}</b></div>`).join('')}</div>` : ''}
        ${awards ? `<div class="awards">${awards}</div>` : ''}
        ${rounds ? `<details class="word-list"><summary>📜 Alle Runden (${v.history.length})</summary><ol>${rounds}</ol></details>` : ''}
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
      return `<div class="status-banner"><span class="spinner-sm"></span> Verbindung zum Laptop unterbrochen – deine Antworten bleiben hier, verbinde neu…</div>`;
    }
    return '';
  }

  function playerHtml(v) {
    const me = v.me;
    const p = player(v, me.id);
    let body;
    if (v.phase === 'lobby') body = phoneLobbyHtml(v, p);
    else if (v.phase === 'end') body = phoneEndHtml(v);
    else if (v.phase === 'draw') body = phoneDrawHtml(v);
    else if (v.phase === 'write' || v.phase === 'grace') body = phoneWriteHtml(v);
    else if (v.phase === 'review') body = phoneReviewHtml(v);
    else if (v.phase === 'scores') body = phoneScoresHtml(v);
    else body = '<div class="look-up">⏳<b>Einen Moment …</b></div>';
    const score = p && v.phase !== 'lobby' ? `<span class="phone-points">${p.score} P.</span>` : '';
    return `
      <div class="phone phase-${v.phase}" style="${tc(p ? p.color : '#94a3b8')}">
        <header class="phone-head">
          <span class="team-dot"></span>
          <b>${esc(me.name)}</b>
          <span class="phone-name">${[p ? '' : 'Zuschauer', me.lead ? '🎬 Spielleitung' : '', v.phase !== 'lobby' && v.phase !== 'end' ? `Runde ${v.round}/${v.rounds}` : ''].filter(Boolean).join(' · ')}</span>
          ${score}
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
        ${n < MAX_PLAYERS ? '<button class="btn btn-primary btn-big btn-wide" data-act="watch" data-watch="0">✍️ Mitspielen</button>' : '<p class="muted center">Das Spiel ist voll.</p>'}`;
    }
    const cats = v.settings.catMode === 'random' ? `Jede Runde ${PER_ROUND} zufällige Kategorien` : (v.settings.catMode === 'standard' ? Kat.STANDARD : v.settings.cats).join(' · ');
    return `<div class="look-up">✍️<b>Du bist dabei!</b><small>${n} ${plural(n, 'Person', 'Personen')} im Spiel${n < MIN_PLAYERS ? ` – ab ${MIN_PLAYERS} geht's los` : ''}</small></div>
      <p class="center muted small">📋 ${esc(cats)}</p>
      <p class="waiting">⏳ Warte, bis es am Laptop losgeht…</p>
      <button class="btn btn-link" data-act="watch" data-watch="1">Doch nur zuschauen</button>`;
  }

  function phoneDrawHtml(v) {
    return `<div class="look-up">🔤<b>Das Alphabet läuft …</b><small>Wer drückt Stopp?</small></div>
      ${catsLineHtml(v)}
      ${v.me.playing ? '<button class="btn btn-primary btn-big btn-wide btn-stop" data-act="pick">✋ Stopp!</button>' : ''}`;
  }

  function leadToolsHtml(v, items) {
    if (!v.me.lead || !items.length) return '';
    return `<div class="lead-tools"><small>🎬 Du bist die Spielleitung</small>${items.join('')}</div>`;
  }

  function phoneWriteHtml(v) {
    const grace = v.phase === 'grace';
    const head = `<div class="phone-letter">${letterHtml(v, { small: true })}<div><b>Alles mit ${esc(v.letter)}</b>${grace ? '' : timerHtml(v.timer, { clock: true })}</div></div>`;
    if (!v.me.playing) return `${head}<div class="look-up small">👀<b>Du schaust zu</b><small>Ab der nächsten Runde kannst du mitspielen.</small></div>`;
    const editable = canWrite(v);
    let banner = '';
    if (grace) {
      banner =
        v.graceReason === 'time'
          ? '<div class="stop-banner is-time"><b>⏰ Zeit um!</b><small>Stifte weg.</small></div>'
          : `<div class="stop-banner"><b>✋ ${v.stopBy === v.me.id ? 'Du hast Stopp gerufen!' : v.stopName ? `${esc(v.stopName)} ruft STOPP!` : 'STOPP!'}</b><small>${v.stopBy === v.me.id ? 'Die anderen haben noch' : 'Schnell, noch'} ${timerHtml(v.timer, { cls: 'timer-inline' })} Sekunden!</small></div>`;
    }
    const rows = v.cats
      .map((c, i) => {
        const val = ui.answers[i] || '';
        const filled = !!val.trim();
        const ok = filled && Answers.startsWith(val, v.letter, { umlauts: v.settings.umlauts });
        return `<label class="answer-row ${filled ? (ok ? 'is-ok' : 'is-bad') : ''}">
          <span class="answer-cat">${catLabel(c)}</span>
          <input id="ans-${i}" class="input answer-input ${filled ? (ok ? 'is-ok' : 'is-bad') : ''}" type="text" maxlength="${Answers.MAX_ANSWER}" value="${esc(val)}" placeholder="${esc(v.letter)}…"
            data-field="answer" data-i="${i}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="${i < v.cats.length - 1 ? 'next' : 'done'}" ${editable ? '' : 'disabled'} />
          <span class="answer-mark" aria-hidden="true">${filled ? (ok ? '✓' : '✗') : ''}</span>
        </label>`;
      })
      .join('');
    const full = ui.answers.length >= v.cats.length && v.cats.every((_, i) => (ui.answers[i] || '').trim());
    const bad = v.cats.filter((_, i) => (ui.answers[i] || '').trim() && !Answers.startsWith(ui.answers[i], v.letter, { umlauts: v.settings.umlauts })).length;
    const canStop = !grace && v.settings.end !== 'time';
    const stop = canStop
      ? `<button class="btn btn-primary btn-big btn-wide btn-stop" data-act="stop" ${full ? '' : 'disabled'}>✋ STOPP!${full ? '' : `<small>erst wenn alles ausgefüllt ist (${v.cats.filter((_, i) => (ui.answers[i] || '').trim()).length}/${v.cats.length})</small>`}</button>`
      : '';
    const lead = grace ? '' : leadToolsHtml(v, ['<button class="btn btn-ghost btn-small" data-act="force-stop">⏩ Für alle beenden</button>']);
    return `${head}${banner}
      <form class="answers-form" data-form="answers" autocomplete="off">${rows}</form>
      ${bad ? `<p class="word-error">✗ ${bad} ${plural(bad, 'Antwort beginnt', 'Antworten beginnen')} nicht mit ${esc(v.letter)}</p>` : ''}
      ${stop}${lead}`;
  }

  function phoneReviewHtml(v) {
    const r = v.review;
    const all = v.settings.vote === 'all';
    const lead = v.me.lead;
    const playing = v.me.playing;
    const rows = r.items
      .map((it) => {
        const out = it.status === 'out';
        let buttons = '';
        if (it.mine) buttons = '<span class="mine-tag">deine</span>';
        else if (playing) {
          const vb = (value, label, on) => `<button class="vote-btn ${on ? 'on' : ''} ${value < 0 ? 'down' : 'up'}" data-act="vote" data-cat="${r.cat}" data-id="${esc(it.id)}" data-value="${on ? 0 : value}" aria-pressed="${on}">${label}</button>`;
          buttons = all ? vb(1, '👍', it.myVote === 1) + vb(-1, '👎', it.myVote === -1) : vb(-1, '👎', it.myVote === -1);
        }
        return `<div class="vote-row is-${it.status} ${it.mine ? 'is-mine' : ''}">
          <div class="vote-main">
            <b>${esc(it.text)}</b>
            <small>${it.mine ? (it.names.length > 1 ? `du + ${it.names.length - 1}` : 'nur du') : it.names.map(esc).join(', ')} · <span class="${out ? 'p0' : pointsClass(it.points)}">${out ? 'zählt nicht' : it.points + ' P.'}</span></small>
            <span class="vote-badges">${badgesHtml(it, v.letter)}</span>
            ${lead && !it.mine && (it.status !== 'ok' || it.decided !== null) ? decideHtml(r, it) : ''}
          </div>
          <div class="vote-btns">${buttons}</div>
        </div>`;
      })
      .join('');
    const done = r.done.includes(v.me.id);
    let finish = '';
    if (playing && !all) finish = `<button class="btn ${done ? 'btn-ok' : 'btn-primary'} btn-big btn-wide" data-act="done" data-cat="${r.cat}" ${done ? 'disabled' : ''}>${done ? '✓ Alles ok – warte auf die anderen' : 'Alles ok ✓'}</button>`;
    else if (playing && done) finish = '<p class="waiting">✓ Abgestimmt – warte auf die anderen …</p>';
    const last = r.cat === r.total - 1;
    const leadBtns = leadToolsHtml(v, [
      ...(r.cat > 0 ? ['<button class="btn btn-ghost btn-small" data-act="back">← Zurück</button>'] : []),
      `<button class="btn btn-primary btn-small" data-act="next" data-cat="${r.cat}">${last ? 'Zur Wertung 🏆' : `Weiter → ${esc(r.nextName)}`} <small>(${r.done.length}/${r.eligible.length})</small></button>`,
    ]);
    return `<h2 class="phone-title">${Kat.icon(r.name)} ${esc(r.name)} mit ${esc(v.letter)} <small class="muted">${r.cat + 1}/${r.total}</small></h2>
      <p class="muted small center">${all ? 'Bewerte jede Antwort: 👍 zählt, 👎 zählt nicht.' : 'Zweifel? 👎 drücken. Mehrheit 👎 = zählt nicht.'}</p>
      ${rows ? `<div class="vote-list">${rows}</div>` : `<div class="look-up small">🦗<b>Niemand hat etwas</b></div>`}
      ${finish}${leadBtns}`;
  }

  function phoneScoresHtml(v) {
    const last = v.last;
    const row = last.rows[v.me.id];
    const s = v.standings.find((x) => x.id === v.me.id);
    const lastRound = v.round >= v.rounds;
    const lead = v.me.lead ? `<button class="btn btn-primary btn-big btn-wide btn-col" data-act="next">${lastRound ? 'Zur Siegerehrung 🏆' : 'Nächste Runde →'}<small>Du bist die Spielleitung</small></button>` : '';
    if (!row) return `<div class="look-up">📊<b>Runde ${v.round} vorbei</b><small>Schau auf den Laptop!</small></div>${lead}`;
    const sips = (last.sips || {})[v.me.id];
    const list = last.cats
      .map((c, i) => {
        const st = row.status[i];
        return `<li class="${st && st !== 'ok' ? 'is-out' : ''}"><span>${catLabel(c)}</span><span class="cell-text">${esc(row.texts[i]) || '–'}</span><b class="${pointsClass(row.points[i])}">${row.points[i]}</b></li>`;
      })
      .join('');
    return `<div class="look-up win">📊<b>+${row.sum} Punkte</b><small>Gesamt ${s ? `${s.score} · Platz ${s.place} von ${v.standings.length}` : ''}</small></div>
      <ul class="my-round">${list}</ul>
      ${sips ? `<p class="drink">🍻 Du trinkst ${sips} ${plural(sips, 'Schluck', 'Schlucke')}</p>` : ''}
      ${lead}`;
  }

  function phoneEndHtml(v) {
    const s = v.standings.find((x) => x.id === v.me.id);
    const stats = v.stats && v.stats[v.me.id];
    const head = s
      ? s.place === 1
        ? `<div class="look-up win">🏆<b>Gewonnen!</b><small>${s.score} Punkte</small></div>`
        : `<div class="look-up">${['', '🥇', '🥈', '🥉'][s.place] || '🏅'}<b>Platz ${s.place}</b><small>${s.score} Punkte</small></div>`
      : '<div class="look-up">🏁<b>Spiel vorbei</b></div>';
    const mine = stats ? `<div class="my-stats"><span>⚡ ${stats.stops}× Stopp</span><span>🦄 ${stats.solo}× allein</span><span>🤝 ${stats.dupe}× doppelt</span><span>🤨 ${stats.vetoed}× weggestimmt</span></div>` : '';
    const awards = (v.awards || []).map((a) => `<div class="award"><span class="award-icon">${a.icon}</span><div><b>${esc(a.title)}</b><small>${esc(a.text)}</small></div></div>`).join('');
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
    else if (ui.modal === 'qr') {
      body = `<h2>📱 Mitspieler einladen</h2>${roomBoxHtml(ui.view && ui.view.room, false)}
        <p class="muted small center">Wer jetzt beitritt, spielt sofort mit (mit 0 Punkten).</p>
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
        <p>Ein <b>Buchstabe</b> wird gezogen (jeder nur einmal pro Spiel, ohne Q, X, Y – abschaltbar). Alle füllen so schnell wie möglich
          ihre <b>Kategorien</b> aus: <i>Stadt, Land, Fluss, Name, Tier, Beruf …</i> – jede Antwort muss mit dem Buchstaben beginnen.</p>
        <h3>✋ Stopp!</h3>
        <p>Wer <b>alle</b> Kategorien ausgefüllt hat, darf Stopp rufen. Dann haben alle anderen noch <b>3 Sekunden</b>.
          Alternativ (oder zusätzlich) gibt es eine feste Zeit.</p>
        <h3>👎 Abstimmen</h3>
        <p>Kategorie für Kategorie zeigt der Laptop alle Antworten. Gleiche Antworten fasst die App zusammen (Groß/klein, kleine Tippfehler,
          <i>„Die Mosel“ = „Mosel“</i>, <i>„St.“ = „Sankt“</i>). Wer zweifelt, drückt 👎 – bei <b>Mehrheit 👎</b> zählt die Antwort nicht,
          bei Gleichstand entscheidet die Spielleitung. ✓ <i>bekannt</i> heißt nur: steht in unserer Liste – es ist eine Hilfe, kein Urteil.
          Ob <i>„Lummerland“</i> als Land zählt, entscheidet ihr!</p>
        <h3>🏆 Punkte</h3>
        <p><b>20</b> – einzige Person mit einer gültigen Antwort in der Kategorie · <b>10</b> – einzigartig · <b>5</b> – doppelt (jemand anderes hat dieselbe) ·
          <b>0</b> – leer oder ungültig. Einfache Wertung: 10 / 5.</p>
        <h3>📋 Kategorien</h3>
        <p>Standard, eigene Auswahl aus den Paketen 🏠 Klassisch, 🎬 Popkultur, 🍔 Essen, 🤪 Lustig, 🔥 Ab 18 – plus eigene Kategorien –
          oder <b>Zufall</b>: jede Runde ${PER_ROUND} andere.</p>
        <h3>🖥️ Ein Gerät</h3>
        <p>Ohne Handys: Geschrieben wird auf Papier, der Laptop zieht den Buchstaben, läuft als Uhr mit und ist der Punkteblock.</p>
        <h3>🍻 Trinkregeln (ab 18, optional)</h3>
        <p>0 Punkte in einer Kategorie → 1 Schluck. Stopp gerufen und trotzdem einen Fehler → 2 Schlucke dazu.</p>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Los geht's!</button></div>`;
  }

  function menuHtml() {
    const v = ui.view;
    const items = [];
    items.push(`<button class="menu-item" data-act="rules">📖 Spielregeln</button>`);
    items.push(`<button class="menu-item" data-act="mute">${Sound.muted ? '🔊 Ton einschalten' : '🔇 Ton ausschalten'}</button>`);
    if (v && v.me.stage) {
      if (v.room) items.push(`<button class="menu-item" data-act="show-qr">📱 Mitspieler einladen</button>`);
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

  /** Aktion mit der laufenden Runde (verspätete Klicks landen nicht in der nächsten) */
  function dispatchRound(type, extra) {
    const v = ui.view;
    dispatch(type, Object.assign({ round: v ? v.round : undefined }, extra || {}));
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
    // Eigene Kategorien merkt sich der Browser – auch wenn sie in der Lobby geändert werden
    if (patch.custom) ui.setup.settings = sanitizeSettings({ custom: patch.custom }, ui.setup.settings);
    if (scope === 'setup') {
      ui.setup.settings = sanitizeSettings(Object.assign({}, ui.setup.settings, patch), ui.setup.settings);
      saveSetup();
      render();
    } else if (ui.view) {
      if (patch.custom) saveSetup();
      dispatch('settings', { settings: Object.assign({}, ui.view.settings, patch) });
    }
  }

  function setSetting(scope, key, value) {
    setSettings(scope, { [key]: value });
  }

  function addCustom(scope) {
    const name = Kat.clean(ui.customCat);
    if (!name) return;
    const s = scopeSettings(scope);
    if (s.custom.length >= MAX_CUSTOM) return;
    const lower = (x) => x.toLowerCase();
    const patch = {};
    if (!s.custom.map(lower).includes(lower(name))) patch.custom = s.custom.concat(name);
    // gleich mitnehmen: in der Auswahl ankreuzen bzw. das Paket „Eigene“ einschalten
    if (s.catMode === 'pick' && !s.cats.map(lower).includes(lower(name)) && s.cats.length < MAX_CATS) patch.cats = s.cats.concat(name);
    if (s.catMode === 'random' && !s.packs.includes(Kat.CUSTOM_PACK.id)) patch.packs = s.packs.concat(Kat.CUSTOM_PACK.id);
    ui.customCat = '';
    ui.focus = '[data-field="custom-cat"]';
    if (Object.keys(patch).length) setSettings(scope, patch);
    else render();
  }

  function createGame() {
    const s = ui.setup;
    ui.error = null;
    const problem = catProblem(s.settings);
    if (problem) {
      ui.error = problem;
      render();
      return;
    }
    if (s.settings.input === 'one' && s.players.length < MIN_PLAYERS) {
      ui.error = `Ihr braucht mindestens ${MIN_PLAYERS} Personen.`;
      render();
      return;
    }
    const state = Engine.create({ settings: s.settings, players: s.players });
    Sound.unlock();
    startStage({ state });
  }

  /** Handy: Stopp – mit den letzten Eingaben */
  function phoneStop() {
    const v = ui.view;
    if (!v || v.phase !== 'write') return;
    clearTimeout(ui.sendTimer);
    ui.sendTimer = null;
    ui.sent = JSON.stringify(ui.answers);
    if (document.activeElement) document.activeElement.blur();
    dispatch('stop', { texts: ui.answers.slice(), round: v.round });
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
        text: 'Das Spiel endet sofort – eine laufende Runde zählt nicht.',
        yes: 'Beenden',
        danger: true,
        run: () => dispatch('end'),
      }),

    /* Setup & Lobby */
    set: (el) => {
      const key = el.dataset.key;
      let value = el.dataset.value;
      if (['rounds', 'time'].includes(key)) value = +value;
      setSetting(el.dataset.scope, key, value);
    },
    toggle: (el) => setSetting(el.dataset.scope, el.dataset.key, !scopeSettings(el.dataset.scope)[el.dataset.key]),
    'cat-toggle': (el) => {
      const s = scopeSettings(el.dataset.scope);
      const cat = el.dataset.cat;
      const has = s.cats.some((c) => c.toLowerCase() === cat.toLowerCase());
      if (!has && s.cats.length >= MAX_CATS) {
        toast(`Höchstens ${MAX_CATS} Kategorien`);
        return;
      }
      setSettings(el.dataset.scope, { cats: has ? s.cats.filter((c) => c.toLowerCase() !== cat.toLowerCase()) : s.cats.concat(cat) });
    },
    'pack-toggle': (el) => {
      const s = scopeSettings(el.dataset.scope);
      const id = el.dataset.pack;
      setSettings(el.dataset.scope, { packs: s.packs.includes(id) ? s.packs.filter((x) => x !== id) : s.packs.concat(id) });
    },
    'custom-remove': (el) => {
      const s = scopeSettings(el.dataset.scope);
      const cat = el.dataset.cat.toLowerCase();
      setSettings(el.dataset.scope, { custom: s.custom.filter((c) => c.toLowerCase() !== cat), cats: s.cats.filter((c) => c.toLowerCase() !== cat) });
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
      if (p.length <= MIN_PLAYERS) return;
      p.splice(+el.dataset.player, 1);
      saveSetup();
      render();
    },
    'create-game': createGame,
    kick: (el) => dispatch('kick', { player: el.dataset.player }),
    watch: (el) => {
      ui.modal = null;
      dispatch('watch', { watch: el.dataset.watch === '1' });
    },
    start: () => dispatch('start'),

    /* Spiel */
    pick: () => {
      const el = app.querySelector('[data-abc]');
      dispatchRound('pick', el && ui.view && ui.view.me.stage ? { letter: el.textContent } : {});
    },
    stop: phoneStop,
    'force-stop': () => {
      flushAnswers();
      dispatchRound('stop', { force: true });
    },
    vote: (el) => dispatch('vote', { cat: +el.dataset.cat, id: el.dataset.id, value: +el.dataset.value }),
    done: (el) => dispatch('done', { cat: +el.dataset.cat }),
    decide: (el) => dispatch('decide', { cat: +el.dataset.cat, id: el.dataset.id, valid: el.dataset.valid === 'null' ? null : el.dataset.valid === 'true' }),
    cell: (el) => {
      const v = ui.view;
      const row = (v && v.tally && v.tally[el.dataset.player]) || [];
      const n = +el.dataset.points;
      // nochmal tippen = leeren
      dispatchRound('cell', { player: el.dataset.player, cat: +el.dataset.cat, points: row[+el.dataset.cat] === n ? null : n });
    },
    next: (el) => dispatchRound('next', el.dataset.cat !== undefined ? { cat: +el.dataset.cat } : {}),
    back: () => dispatchRound('back'),
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
    } else if (f === 'custom-cat') {
      ui.customCat = el.value;
    } else if (f === 'answer') {
      const v = ui.view;
      if (!canWrite(v)) return;
      const i = +el.dataset.i;
      while (ui.answers.length < v.cats.length) ui.answers.push('');
      ui.answers[i] = el.value.slice(0, Answers.MAX_ANSWER);
      scheduleSend();
      render();
    }
  });

  app.addEventListener('focusout', (e) => {
    if (e.target.dataset && e.target.dataset.field === 'answer') flushAnswers();
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
    } else if (el.dataset.field === 'answer') {
      // Enter springt zur nächsten Kategorie (die nächste leere zuerst)
      e.preventDefault();
      const i = +el.dataset.i;
      const inputs = [...app.querySelectorAll('[data-field="answer"]')];
      const next = inputs.slice(i + 1).find((x) => !x.value.trim()) || inputs.find((x) => !x.value.trim()) || inputs[i + 1];
      if (next && next !== el) next.focus();
      else el.blur();
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
    } else if (form.dataset.form === 'custom-cat') {
      addCustom(form.dataset.scope);
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
    if (ui.ctrl && ui.ctrl.mode === 'client') {
      flushAnswers();
      ui.ctrl.bye();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAnswers();
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

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.SLF_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  requestAnimationFrame(timerLoop);
  autoResume();

  // für Tests
  window.SLFApp = { ui, render: renderNow, actions };
})();
