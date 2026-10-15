/*
 * Oberfläche von „Imposter“.
 *  - Ein Gerät („device“): wird herumgereicht – Weitergeben, Karte aufdecken, Reihenfolge, Timer, Abstimmung per Zeigen
 *  - Handy („phone“): eigene Karte (gedrückt halten), Hinweise, geheime Abstimmung. Auch der mitspielende Host.
 *  - Bühne („stage“): Laptop/Fernseher, wenn der Host nicht mitspielt – Reihenfolge, Timer, Abstimmung, Punkte groß
 * Gerendert wird per HTML-String + morphdom (nur geänderte Teile werden ersetzt).
 */
(function () {
  'use strict';

  const E = window.IMEngine;
  const {
    Engine,
    STAGE,
    IMPOSTER_OPTIONS,
    CLUE_OPTIONS,
    DISCUSS_OPTIONS,
    ROUND_OPTIONS,
    VOTING_OPTIONS,
    DRINK_OPTIONS,
    MIN_PLAYERS,
    MAX_PLAYERS,
    MAX_CLUE,
    MAX_ANSWER,
    POINTS,
    DRINKS,
    sanitizeSettings,
  } = E;
  const { StageController, ClientController, Store, KEYS, Net, inviteLink, qrSvg } = window.IMControllers;
  const { Sound, confetti } = window.GameFx;
  const Deck = window.IMDeck;

  const INPUT = {
    pass: {
      icon: '📲',
      label: 'Ein Gerät',
      text: 'Ein Handy wird herumgereicht: Jede Person schaut kurz geheim ihr Wort an. Abgestimmt wird per Zeigen – klappt auch offline.',
    },
    phones: {
      icon: '📱',
      label: 'Jeder ein Handy',
      text: 'Alle scannen den QR-Code. Das Wort steht auf dem eigenen Handy, abgestimmt wird geheim. Optional mit Laptop als Bühne.',
    },
  };
  const MODE = {
    word: { icon: '🔤', label: 'Wort', text: 'Alle kennen das geheime Wort – der Imposter nicht. Jede Person sagt reihum ein passendes Wort.' },
    question: { icon: '❓', label: 'Frage', text: 'Alle beantworten dieselbe Frage – der Imposter bekommt heimlich eine andere mit ähnlicher Antwort.' },
  };
  const DRINK_REASON = { caught: 'erwischt', give: 'unentdeckt – verteilt' };
  const IMP_COLORS = ['#ff5d73', '#ffb347', '#ffffff'];
  const CREW_COLORS = ['#3ddc97', '#5ab8ff', '#ffffff'];
  const SETUP_KEY = 'imposter.setup.v1';
  const PREFS_KEY = 'imposter.prefs.v1';
  const ACTIVE_KEY = 'imposter.active';
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

  function pl(v, id) {
    return v.players.find((p) => p.id === id) || { id, name: '?', score: 0 };
  }

  function pname(v, id) {
    return pl(v, id).name;
  }

  function minutes(sec) {
    return sec ? (sec < 60 ? `${sec} s` : `${sec / 60} Min`) : '∞';
  }

  function roundsLabel(r) {
    return r === 'players' ? 'Alle einmal' : r === 0 ? 'Endlos' : String(r);
  }

  function drinkUnit(n, mode) {
    if (mode === 'free') return `${n} ${plural(n, 'Strafpunkt', 'Strafpunkte')}`;
    return `${n} ${plural(n, 'Schluck', 'Schlucke')}`;
  }

  function fmtTime(sec) {
    return sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : String(sec);
  }

  function defaultSetup() {
    return { settings: sanitizeSettings({}), players: ['', '', '', ''], hostName: '' };
  }

  function loadSetup() {
    const saved = Store.get(SETUP_KEY);
    if (!saved || !Array.isArray(saved.players)) return defaultSetup();
    saved.settings = sanitizeSettings(saved.settings);
    while (saved.players.length < MIN_PLAYERS) saved.players.push('');
    saved.hostName = saved.hostName || '';
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
    drinkPop: null,
    focus: null,
    cardOpen: false, // Karte beim Verteilen aufgedeckt
    clueText: '',
    answerText: '',
    answerEdit: false,
    guessText: '',
    pick: [], // Ein Gerät: wer hat die meisten Stimmen (mehrere = Gleichstand)
    voters: [], // Ein Gerät: wer hat auf diese Person gezeigt
    voteStep: 'count', // Ein Gerät: 'count' (Countdown) → 'pick'
    countdown: null,
    peek: null, // Ein Gerät: Karte nochmal ansehen (Spieler-ID)
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
  function flash(text, kind) {
    ui.flash = { text, kind: kind || 'info', id: ++flashNo };
    clearTimeout(ui.flashTimer);
    ui.flashTimer = setTimeout(() => {
      ui.flash = null;
      render();
    }, 2600);
  }

  function showDrinks(list, mode) {
    if (!list.length) return;
    ui.drinkPop = { id: ++flashNo, lines: list, mode };
    clearTimeout(ui.drinkTimer);
    ui.drinkTimer = setTimeout(() => {
      ui.drinkPop = null;
      render();
    }, 5200);
  }

  /** Bildschirm während des Spiels anlassen (Diskussions-Timer, Weitergeben) */
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
    ui.drinkPop = null;
    ui.countdown = null;
    clearInterval(ui.countdownTimer);
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
    ui.viewAt = performance.now();
    ui.screen = 'game';
    if (!prev || prev.step !== v.step) {
      ui.clueText = '';
      if (v.phase !== 'answer') ui.answerEdit = false;
    }
    if (!prev || prev.phase !== v.phase || prev.round !== v.round) {
      ui.guessText = '';
      if (v.phase !== 'answer') ui.answerText = '';
    }
    // Aufgedeckte Karte wieder zudecken: neue Phase, neue Runde oder (Ein Gerät) nächste Person
    const holder = v.pass ? v.pass.holder : null;
    const prevHolder = prev && prev.pass ? prev.pass.holder : null;
    if (!prev || v.phase !== 'reveal' || prev.round !== v.round || holder !== prevHolder) ui.cardOpen = false;
    if (!prev || !v.vote || !prev.vote || prev.vote.no !== v.vote.no) {
      ui.pick = [];
      ui.voters = [];
      ui.voteStep = v.vote && v.vote.runoff ? 'pick' : 'count';
    }
    if (v.phase !== 'vote' && ui.countdown != null) {
      ui.countdown = null;
      clearInterval(ui.countdownTimer);
    }
    if (ui.peek && !(v.pass && v.pass.cards[ui.peek])) {
      ui.peek = null;
      if (ui.modal === 'peek') ui.modal = null;
    }
    keepAwake(v.phase !== 'lobby' && v.phase !== 'end');
    transitions(prev, v);
    render();
  }

  function handleStatus(status, info) {
    ui.status = status;
    if (status === 'error') {
      const e = (info || {}).error;
      const msg =
        e === 'not-found'
          ? 'Kein Spiel mit diesem Code gefunden. Stimmt der Code und ist das Host-Gerät noch online?'
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
    toast(reason === 'kicked' ? 'Du wurdest aus dem Spiel entfernt.' : 'Das Spiel wurde vom Host beendet.');
  }

  function vibrate(p) {
    if (navigator.vibrate) navigator.vibrate(p);
  }

  /** Sounds, Konfetti und Einblendungen bei Zustandswechseln */
  function transitions(prev, v) {
    if (!prev) return;
    const phone = !!v.me.id;
    const fresh = v.drinks.filter((d) => !prev.drinks.some((x) => x.n === d.n));
    if (fresh.length && v.settings.drinks !== 'off') showDrinks(fresh, v.settings.drinks);

    const ev = v.event;
    const pev = prev.event;
    if (ev && (!pev || pev.n !== ev.n)) {
      if (ev.kind === 'out') {
        const name = pname(v, ev.pid);
        Sound.flip();
        if (ev.role === 'imposter') {
          setTimeout(() => Sound.success(), 300);
          flash(`🕵️ ${name} war ${v.rs && v.rs.mode === 'question' ? 'der Imposter' : 'Imposter'}!`, 'imp');
        } else {
          setTimeout(() => Sound.fail(), 300);
          flash(`😇 ${name} war unschuldig!`, 'crew');
        }
        if (phone) vibrate(ev.pid === v.me.id ? [120, 60, 120] : 60);
      } else if (ev.kind === 'guess') {
        if (ev.correct) {
          setTimeout(() => Sound.fanfare(), 100);
          flash(`🧠 Richtig geraten: „${ev.text}“!`, 'imp');
        } else {
          Sound.fail();
          flash(ev.text ? `❌ Falsch geraten: „${ev.text}“` : '❌ Nicht geraten', 'crew');
        }
      } else if (ev.kind === 'tie') {
        Sound.hop();
        flash('⚖️ Gleichstand – Stichwahl!', 'info');
      } else if (ev.kind === 'deadlock') {
        Sound.buzzer();
        flash('⚖️ Wieder Gleichstand – niemand fliegt raus', 'info');
      } else if (ev.kind === 'time') {
        Sound.buzzer();
        flash('⏰ Zeit um – abstimmen!', 'info');
        if (phone) vibrate([80, 60, 80]);
      }
    }

    if (v.phase === 'end' && prev.phase !== 'end') {
      Sound.fanfare();
      setTimeout(() => confetti(['#ff5d73', '#ffb347', '#3ddc97', '#5ab8ff', '#ffffff'], 260), 150);
      return;
    }
    if (v.phase === 'result' && prev.phase !== 'result' && v.result && !v.result.aborted) {
      const crewWon = v.result.winner === 'crew';
      setTimeout(() => {
        if (v.result.winner !== 'split') confetti(crewWon ? CREW_COLORS : IMP_COLORS, 180);
      }, 500);
      if (phone && v.me.role) vibrate(v.result.points[v.me.id] ? [60, 40, 160] : 200);
    }
    if (v.phase === 'reveal' && (prev.phase !== 'reveal' || prev.round !== v.round)) {
      Sound.start();
      if (phone && v.me.inRound) vibrate(80);
    }
    if (v.phase === 'vote' && prev.phase !== 'vote') Sound.start();
    if (v.phase === 'clues' && v.clue && v.clue.current && (!prev.clue || prev.clue.current !== v.clue.current)) {
      if (phone && v.clue.current === v.me.id) {
        Sound.hop();
        vibrate([60, 60, 60]);
      }
    }
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
      const label = fmtTime(sec);
      if (text && text.textContent !== label) text.textContent = label;
      const bar = el.querySelector('[data-timer-bar]');
      if (bar) bar.style.width = (100 * rem) / total + '%';
      el.classList.toggle('urgent', sec <= 10);
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
      case 'game':
        html = ui.view ? gameHtml(ui.view) : connectingHtml();
        break;
      default:
        html = homeHtml();
    }
    if (ui.countdown != null) html += countdownHtml();
    if (ui.flash) html += `<div class="flash flash-${ui.flash.kind}" id="flash-${ui.flash.id}" role="status">${esc(ui.flash.text)}</div>`;
    if (ui.drinkPop) html += drinkPopHtml();
    html += modalHtml();
    if (ui.toast) html += `<div class="toast" role="status">${esc(ui.toast)}</div>`;
    window.morphdom(app, `<div id="app">${html}</div>`, {
      onBeforeElUpdated(fromEl, toEl) {
        if (fromEl === document.activeElement && (fromEl.tagName === 'INPUT' || fromEl.tagName === 'TEXTAREA')) return false;
        // Gedrückt gehaltene Karte bleibt beim Neuzeichnen sichtbar
        if (fromEl.hasAttribute && fromEl.hasAttribute('data-hold') && fromEl.classList.contains('is-shown')) toEl.classList.add('is-shown');
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
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="Imposter">
      <span class="logo-icon" aria-hidden="true">🕵️</span>
      <span class="logo-text"><span class="l1">Impo</span><span class="l2">ster</span></span>
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

  function switchHtml(key, on, scope, label) {
    return `<button class="switch ${on ? 'on' : ''}" data-act="toggle" data-key="${key}" data-scope="${scope}" role="switch" aria-checked="${on}" aria-label="${esc(label)}"><span class="switch-knob"></span>${on ? 'An' : 'Aus'}</button>`;
  }

  function setting(title, sub, control) {
    return `<div class="setting"><div class="setting-label"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div>${control}</div>`;
  }

  /**
   * Einstellungen. scope: 'setup' (Spiel anlegen) oder 'live' (Lobby / zwischen den Runden, geht an den Host)
   * n: Anzahl Personen (für den Hinweis „höchstens ein Drittel“)
   */
  function settingsHtml(s, scope, n) {
    const word = s.mode === 'word';
    const phones = s.input === 'phones';
    const maxImp = E.maxImposters(Math.max(MIN_PLAYERS, n || 0));
    const rows = [];
    if (scope === 'live') {
      rows.push(setting('🎲 Modus', MODE[s.mode].text, seg('mode', ['word', 'question'], s.mode, (o) => `${MODE[o].icon} ${MODE[o].label}`, scope)));
    }
    if (word) {
      rows.push(
        setting(
          '🎭 Variante',
          s.variant === 'undercover' ? 'Der Imposter bekommt ein ähnliches Wort und weiß nicht, dass er Imposter ist' : 'Der Imposter weiß, dass er Imposter ist',
          seg('variant', ['classic', 'undercover'], s.variant, (o) => ({ classic: 'Klassisch', undercover: 'Undercover' })[o], scope)
        )
      );
    }
    rows.push(
      setting(
        '🕵️ Anzahl Imposter',
        `Höchstens ein Drittel der Runde${n ? ` – bei ${n} Personen ${maxImp}` : ''}${s.imposters > 1 ? ' · Imposter kennen sich nicht' : ''}`,
        seg('imposters', IMPOSTER_OPTIONS, s.imposters, String, scope)
      )
    );
    if (word && s.variant === 'classic') {
      rows.push(setting('🏷️ Imposter sieht Kategorie', 'Macht es leichter – gut für Anfänger', switchHtml('showCategory', s.showCategory, scope, 'Imposter sieht Kategorie')));
    }
    rows.push(setting('🥇 Erste Person nie Imposter', 'Sonst hätte der Imposter noch keinen Hinweis gehört', switchHtml('firstSafe', s.firstSafe, scope, 'Erste Person nie Imposter')));
    if (word) {
      rows.push(setting('💬 Hinweisrunden', 'Wie oft jede Person reihum ein Wort sagt', seg('clueRounds', CLUE_OPTIONS, s.clueRounds, String, scope)));
      if (phones) rows.push(setting('⌨️ Hinweise tippen', 'Die Hinweise werden ins Handy getippt und stehen für alle da', switchHtml('typeClues', s.typeClues, scope, 'Hinweise tippen')));
    }
    rows.push(setting('⏱ Diskussion', 'Danach wird abgestimmt (vorzeitig beenden geht immer)', seg('discussSec', DISCUSS_OPTIONS, s.discussSec, minutes, scope)));
    rows.push(
      setting(
        '🗳️ Abstimmung',
        s.voting === 'last' ? 'Weiter abstimmen, bis alle Imposter raus sind – oder die Crew nicht mehr in der Überzahl ist' : 'Eine Abstimmung pro Runde (bei Gleichstand Stichwahl)',
        seg('voting', VOTING_OPTIONS, s.voting, (o) => ({ once: 'Eine', last: 'Bis zum Ende' })[o], scope)
      )
    );
    rows.push(
      setting(
        '🔁 Runden',
        s.rounds === 'players' ? 'So viele wie Personen – jede/r ist ungefähr einmal Imposter' : s.rounds === 0 ? 'Bis ihr aufhört' : `${s.rounds} Runden`,
        seg('rounds', ROUND_OPTIONS, s.rounds, roundsLabel, scope)
      )
    );
    rows.push(
      setting(
        '🍻 Trinkregeln',
        s.drinks === 'free'
          ? `Alkoholfrei: erwischter Imposter ${DRINKS.caught} Strafpunkte, unentdeckter verteilt ${DRINKS.give}`
          : s.drinks === 'on'
            ? `Erwischter Imposter trinkt ${DRINKS.caught}, unentdeckter verteilt ${DRINKS.give} Schlucke`
            : 'Normales Spiel',
        seg('drinks', DRINK_OPTIONS, s.drinks, (o) => ({ off: 'Aus', on: 'An 🍺', free: 'Alkoholfrei' })[o], scope)
      )
    );
    return `<div class="settings">${rows.join('')}</div>${categoriesHtml(s, scope)}`;
  }

  function categoriesHtml(s, scope) {
    const c = Deck.counts();
    if (s.mode === 'question') {
      const adult = s.categories.includes('adult');
      return `<div class="settings cats-block">${setting(
        '🔞 Fragen ab 18',
        `${c.questions - c.adultQuestions} Fragen${adult ? ` + ${c.adultQuestions} ab 18 (Party, Dating, Liebe)` : ''}`,
        `<button class="switch ${adult ? 'on' : ''}" data-act="cat" data-cat="adult" data-scope="${scope}" role="switch" aria-checked="${adult}"><span class="switch-knob"></span>${adult ? 'An' : 'Aus'}</button>`
      )}</div>`;
    }
    const chips = Deck.CATEGORIES.map((cat) => {
      const on = s.categories.includes(cat.id);
      return `<button class="cat-chip ${on ? 'on' : ''} ${cat.adult ? 'is-adult' : ''}" data-act="cat" data-cat="${cat.id}" data-scope="${scope}" aria-pressed="${on}">${cat.icon} ${esc(cat.label)} <small>${c[cat.id]}</small></button>`;
    }).join('');
    const total = Deck.CATEGORIES.filter((cat) => s.categories.includes(cat.id)).reduce((n, cat) => n + c[cat.id], 0);
    return `<div class="cats-block"><div class="setting-label"><b>📚 Kategorien</b><small>${total} Wörter ausgewählt – 18+ nur, wenn ihr wollt</small></div><div class="cat-chips">${chips}</div></div>`;
  }

  function timerHtml(timer, tick) {
    if (!timer) return '';
    const sec = Math.ceil(timer.remaining / 1000);
    return `<div class="timer" data-timer ${tick ? 'data-tick' : ''} data-rem="${Math.round(timer.remaining)}" data-total="${timer.total}">
      <span class="timer-icon" aria-hidden="true">⏱</span>
      <div class="timer-bar"><span data-timer-bar style="width:${(100 * timer.remaining) / (timer.total || 1)}%"></span></div>
      <b data-timer-text>${fmtTime(sec)}</b>
    </div>`;
  }

  /** Die Karte selbst (Wort, Imposter oder Frage) */
  function cardFaceHtml(card) {
    if (!card) return '';
    if (card.kind === 'imposter') {
      return `<div class="card-face is-imposter">
        <span class="card-emoji" aria-hidden="true">🕵️</span>
        <small>Du bist der</small>
        <b class="card-big">IMPOSTER</b>
        <span class="card-cat">${card.category ? `${card.icon} Kategorie: ${esc(card.category)}` : 'Keine Kategorie – viel Glück!'}</span>
        <p>Lass dich nicht erwischen …</p>
      </div>`;
    }
    if (card.kind === 'question') {
      return `<div class="card-face is-question">
        <small>Deine Frage</small>
        <b class="card-q">${esc(card.question)}</b>
      </div>`;
    }
    return `<div class="card-face is-word">
      <small>Dein Wort</small>
      <b class="card-big">${esc(card.word)}</b>
      <span class="card-cat">${card.icon} ${esc(card.category)}</span>
    </div>`;
  }

  /** Karte zum Gedrückthalten (Handy, und beim „nochmal ansehen“ auf dem Gerät) */
  function holdCardHtml(card, label) {
    if (!card) return '';
    return `<div class="secret" data-hold tabindex="0" role="button" aria-label="Gedrückt halten, um deine Karte zu sehen">
      <div class="secret-cover"><span aria-hidden="true">👆</span> ${esc(label || 'Gedrückt halten: deine Karte')}</div>
      <div class="secret-face">${cardFaceHtml(card)}</div>
    </div>`;
  }

  function drinkPopHtml() {
    const d = ui.drinkPop;
    const lines = d.lines
      .map((x) => {
        const icon = d.mode === 'free' ? '⚠️' : '🍺';
        if (x.reason === 'give') return `<li><b>${esc(x.name)}</b> verteilt ${drinkUnit(x.amount, d.mode)} ${icon}<small>${esc(DRINK_REASON.give)}</small></li>`;
        return `<li><b>${esc(x.name)}:</b> ${drinkUnit(x.amount, d.mode)} ${icon}<small>${esc(DRINK_REASON[x.reason] || '')}</small></li>`;
      })
      .join('');
    return `<div class="drink-pop" id="drink-${d.id}" role="status"><ul>${lines}</ul></div>`;
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
            <small>${INPUT[st.settings.input].label} · ${st.players.length} Personen${st.round ? ' · Runde ' + st.round : ''}</small></button>
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
        <p class="tagline">Alle kennen das geheime Wort – außer einer Person.<br>Findet den Imposter, bevor er euch austrickst!</p>
      </div>
      ${resume.join('')}
      <div class="mode-cards">${modeCard('pass')}${modeCard('phones')}</div>
      <div class="home-links">
        <button class="btn btn-ghost" data-act="join-screen">📱 Mit dem Handy beitreten</button>
        <button class="btn btn-link" data-act="rules">📖 Spielregeln</button>
      </div>
      <p class="home-foot">${c.words - c.adult} Wörter + ${c.adult} ab 18 · ${c.questions} Fragen · 3–15 Personen</p>
    </div>`;
  }

  /* ---------- Spiel anlegen ---------- */

  function setupHtml() {
    const s = ui.setup;
    const st = s.settings;
    const pass = st.input === 'pass';
    const card = (key, def, id) => `
      <button class="input-card ${st[key] === id ? 'on' : ''}" data-act="set" data-key="${key}" data-value="${id}" data-scope="setup" aria-pressed="${st[key] === id}">
        <span class="input-icon">${def[id].icon}</span>
        <b>${def[id].label}</b>
        <small>${def[id].text}</small>
      </button>`;
    const names = s.players
      .map(
        (p, i) => `
        <div class="player-row">
          <span class="player-num">${i + 1}</span>
          <input class="input" type="text" maxlength="24" placeholder="Person ${i + 1}" value="${esc(p)}"
            data-field="player-name" data-player="${i}" autocomplete="off" enterkeyhint="next" />
          ${s.players.length > MIN_PLAYERS ? `<button class="icon-btn" data-act="remove-player" data-player="${i}" aria-label="Person entfernen">✕</button>` : ''}
        </div>`
      )
      .join('');
    const people = pass
      ? `<section class="panel">
          <h2>Wer spielt mit? <small class="muted">(${MIN_PLAYERS}–${MAX_PLAYERS} Personen, in Sitzreihenfolge – so wird das Gerät weitergegeben)</small></h2>
          <div class="ts-players">${names}</div>
          ${s.players.length < MAX_PLAYERS ? `<button class="btn btn-small btn-ghost add-player" data-act="add-player">＋ Person</button>` : ''}
        </section>`
      : `<section class="panel">
          <h2>Dieses Gerät</h2>
          ${setting(
            '🙋 Spielt mit',
            st.hostPlays ? 'Du spielst auf diesem Handy mit und startest die Runden' : 'Nur Bühne: Laptop oder Fernseher zeigt Reihenfolge, Timer, Abstimmung und Punkte groß an',
            switchHtml('hostPlays', st.hostPlays, 'setup', 'Dieses Gerät spielt mit')
          )}
          ${
            st.hostPlays
              ? `<label class="label" for="host-name">Dein Name</label>
                 <input id="host-name" class="input input-big" type="text" maxlength="24" placeholder="z.B. Alex" value="${esc(s.hostName || ui.name)}" data-field="host-name" autocomplete="nickname" />`
              : ''
          }
          <p class="muted small">Die anderen scannen gleich den QR-Code und tragen ihren Namen ein.</p>
        </section>`;
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
        <div class="input-cards">${card('input', INPUT, 'pass')}${card('input', INPUT, 'phones')}</div>
      </section>
      <section class="panel">
        <h2>Modus</h2>
        <div class="input-cards">${card('mode', MODE, 'word')}${card('mode', MODE, 'question')}</div>
      </section>
      ${people}
      <section class="panel">
        <h2>Einstellungen</h2>
        ${settingsHtml(st, 'setup', pass ? s.players.length : 0)}
      </section>
      <div class="sticky-start">
        <button class="btn btn-primary btn-big" data-act="create-game">${pass ? "Los geht's 🕵️" : 'Raum öffnen 📱'}</button>
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
        <label class="label" for="code-input">Raum-Code <small class="muted">(steht auf dem Host-Gerät)</small></label>
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
  /* Spiel                                                               */
  /* ------------------------------------------------------------------ */

  /** device = Ein Gerät · phone = Handy (auch mitspielender Host) · stage = Bühne */
  function kindOf(v) {
    if (v.settings.input === 'pass') return 'device';
    return v.me.id ? 'phone' : 'stage';
  }

  const PHASE_LABEL = {
    lobby: 'Lobby',
    reveal: 'Verteilen',
    clues: 'Hinweise',
    answer: 'Antworten',
    discuss: 'Diskussion',
    vote: 'Abstimmung',
    guess: 'Letzte Chance',
    out: 'Auflösung',
    result: 'Auflösung',
    end: 'Siegerehrung',
  };

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
    const ctx = { kind, host: !!v.me.host, me: v.me, v };
    let main;
    switch (v.phase) {
      case 'lobby':
        main = lobbyHtml(v, ctx);
        break;
      case 'reveal':
        main = revealHtml(v, ctx);
        break;
      case 'clues':
        main = cluesHtml(v, ctx);
        break;
      case 'answer':
        main = answerHtml(v, ctx);
        break;
      case 'discuss':
        main = discussHtml(v, ctx);
        break;
      case 'vote':
        main = voteHtml(v, ctx);
        break;
      case 'guess':
        main = guessHtml(v, ctx);
        break;
      case 'out':
        main = outHtml(v, ctx);
        break;
      case 'result':
        main = resultHtml(v, ctx);
        break;
      case 'end':
        main = endHtml(v, ctx);
        break;
      default:
        main = '';
    }
    // Handy: die eigene Karte ist jederzeit mit Gedrückthalten zu sehen
    const showHold = kind === 'phone' && v.me.card && !['reveal', 'answer', 'result', 'lobby', 'end'].includes(v.phase);
    // Spätankömmling: schaut diese Runde nur zu
    const spectator = kind === 'phone' && !v.me.inRound && !['lobby', 'end', 'result'].includes(v.phase);
    const side = kind === 'stage' && v.phase !== 'lobby' && v.phase !== 'end' ? `<aside class="g-side">${scoreboardHtml(v)}</aside>` : '';
    const room = v.room && v.room.code && ctx.host ? `<button class="pill pill-room" data-act="show-qr" title="Mitspieler einladen">📱 ${esc(v.room.code)}</button>` : '';
    const roundInfo = v.round ? `Runde ${v.round}${v.totalRounds ? ' / ' + v.totalRounds : ''}` : '';
    return `
      <div class="game kind-${kind} phase-${v.phase}">
        <header class="g-top">
          <button class="g-brand" data-act="menu" aria-label="Menü">${logoHtml(true)}</button>
          <div class="g-info"><b>${esc(PHASE_LABEL[v.phase] || '')}</b>${roundInfo && v.phase !== 'lobby' && v.phase !== 'end' ? `<small>${roundInfo}</small>` : ''}</div>
          ${room}
          ${kind === 'phone' ? `<span class="g-me">${esc(v.me.name)}</span>` : ''}
          <div class="g-actions">
            <button class="icon-btn" data-act="mute" aria-label="Ton an/aus" title="Ton an/aus">${Sound.muted ? '🔇' : '🔊'}</button>
            <button class="icon-btn" data-act="menu" aria-label="Menü" title="Menü">☰</button>
          </div>
        </header>
        ${statusBanner()}
        <div class="g-body">
          <main class="g-main">
            ${showHold ? holdCardHtml(v.me.card) : ''}
            ${spectator ? '<div class="banner">⏳ Du bist ab der nächsten Runde dabei – schau solange zu 👀</div>' : ''}
            ${main}
          </main>
          ${side}
        </div>
      </div>`;
  }

  function statusBanner() {
    if (ui.ctrl && ui.ctrl.mode === 'client' && (ui.status === 'reconnecting' || ui.status === 'connecting')) {
      return `<div class="status-banner"><span class="spinner-sm"></span> Verbindung zum Host unterbrochen – verbinde neu…</div>`;
    }
    return '';
  }

  function hostBar(buttons) {
    const list = buttons.filter(Boolean);
    return list.length ? `<div class="host-bar">${list.join('')}</div>` : '';
  }

  /** Spieler-Chips mit Status (✓ gesehen, ✓ abgestimmt …) */
  function statusChipsHtml(v, ids, isDone) {
    return `<div class="chips status-chips">${ids
      .map((id) => {
        const p = pl(v, id);
        const done = isDone(p);
        return `<span class="chip ${done ? 'is-done' : ''} ${p.online ? '' : 'is-offline'}">${done ? '✓' : '⏳'} ${esc(p.name)}</span>`;
      })
      .join('')}</div>`;
  }

  function aliveIds(v) {
    return v.order.filter((id) => !pl(v, id).out);
  }

  /* ---------- Lobby ---------- */

  function lobbyHtml(v, ctx) {
    const players = v.players
      .map(
        (p) => `<span class="chip ${p.online ? '' : 'is-offline'}">${p.host ? '👑 ' : ''}${esc(p.name)}${
          ctx.host && !p.host ? `<button class="chip-x" data-act="kick" data-player="${esc(p.id)}" aria-label="${esc(p.name)} entfernen">✕</button>` : ''
        }</span>`
      )
      .join('');
    const s = v.settings;
    const summary = `${MODE[s.mode].icon} ${MODE[s.mode].label}${s.mode === 'word' ? ' · ' + (s.variant === 'classic' ? 'Klassisch' : 'Undercover') : ''} · ${s.imposters} Imposter · ${roundsLabel(s.rounds)} ${s.rounds === 'players' || s.rounds === 0 ? '' : 'Runden'}`;
    const count = v.players.filter((p) => p.online).length;
    if (!ctx.host) {
      return `
        <div class="look-up">✅<b>Du bist dabei!</b><small>Warte, bis der Host startet …</small></div>
        <section class="panel wide"><h2>Mitspieler <small class="muted">(${count})</small></h2><div class="chips">${players}</div></section>
        <p class="muted small center">${esc(summary)}</p>`;
    }
    return `
      <div class="lobby-grid">
        <section class="panel join-panel">
          <h2>📱 Handys verbinden</h2>
          <p class="muted">QR-Code scannen und Namen eingeben.</p>
          ${roomBoxHtml(v.room, true)}
        </section>
        <div class="lobby-side">
          <section class="panel">
            <h2>Mitspieler <small class="muted">(${count} · mind. ${MIN_PLAYERS}, höchstens ${MAX_PLAYERS})</small></h2>
            <div class="chips">${players || '<span class="muted">Noch niemand da – QR-Code scannen!</span>'}</div>
          </section>
          <section class="panel">
            <div class="row-between"><h2>Einstellungen</h2><button class="btn btn-ghost btn-small" data-act="settings">⚙️ Ändern</button></div>
            <p class="muted">${esc(summary)}</p>
          </section>
          <div class="sticky-start">
            <button class="btn btn-primary btn-big" data-act="start" ${v.lobbyProblem ? 'disabled' : ''}>Spiel starten 🕵️</button>
            ${v.lobbyProblem ? `<p class="muted small center">${esc(v.lobbyProblem)}</p>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ---------- Verteilen ---------- */

  function revealHtml(v, ctx) {
    if (ctx.kind === 'device') {
      const holder = v.pass.holder;
      const p = pl(v, holder);
      const done = v.order.filter((id) => pl(v, id).seen).length;
      if (!holder) return '<div class="look-up">⏳</div>';
      if (!ui.cardOpen) {
        return `
          <div class="pass-screen">
            <small class="muted">Runde ${v.round} · ${done + 1} von ${v.order.length}</small>
            <p class="pass-label">Gib das Gerät an</p>
            <div class="pass-name">👤 ${esc(p.name)}</div>
            <p class="muted">Nur ${esc(p.name)} darf jetzt hinschauen!</p>
            <button class="btn btn-primary btn-big" data-act="open-card">👁 Aufdecken</button>
          </div>`;
      }
      return `
        <div class="reveal-card">
          ${cardFaceHtml(v.pass.cards[holder])}
          <button class="btn btn-primary btn-big" data-act="seen" data-player="${esc(holder)}">Verstanden ✓</button>
          <small class="muted center">Danach wird der Bildschirm wieder neutral.</small>
        </div>`;
    }
    const inRound = v.order;
    const seenAll = inRound.filter((id) => pl(v, id).seen).length;
    const status = `<p class="muted center">${seenAll} von ${inRound.length} haben ihre Karte gesehen</p>${statusChipsHtml(v, inRound, (p) => p.seen)}`;
    const host = ctx.host
      ? hostBar([seenAll < inRound.length ? `<button class="btn btn-ghost" data-act="continue" data-at="${v.step}">⏭ Weiter – nicht auf alle warten</button>` : ''])
      : '';
    if (ctx.kind === 'stage') {
      return `
        <div class="center-stage">
          <h1 class="stage-title">🤫 Alle schauen jetzt geheim auf ihr Handy</h1>
          <p class="muted">Jede Person sieht ihr Wort – der Imposter nicht.</p>
          ${status}${host}
        </div>`;
    }
    if (!v.me.inRound) return `<div class="look-up">👀<b>Die anderen schauen ihre Karte an</b></div>${status}`;
    if (!v.me.seen) {
      if (!ui.cardOpen) {
        return `
          <div class="pass-screen">
            <p class="pass-label">Runde ${v.round}</p>
            <div class="pass-name">🤫 Deine Karte</div>
            <p class="muted">Schau so, dass niemand mitliest.</p>
            <button class="btn btn-primary btn-big" data-act="open-card">👁 Aufdecken</button>
          </div>${host}`;
      }
      return `
        <div class="reveal-card">
          ${cardFaceHtml(v.me.card)}
          <button class="btn btn-primary btn-big" data-act="seen">Verstanden ✓</button>
          <small class="muted center">Später kannst du deine Karte jederzeit gedrückt halten, um sie nochmal zu sehen.</small>
        </div>${host}`;
    }
    return `${holdCardHtml(v.me.card)}<div class="look-up small">✓ Gemerkt! Warte auf die anderen …</div>${status}${host}`;
  }

  /* ---------- Hinweise ---------- */

  /** Reihenfolge mit Hinweisen und Zeiger „jetzt“ */
  function orderHtml(v, opts) {
    const o = opts || {};
    const cur = v.clue ? v.clue.current : null;
    const question = v.rs && v.rs.mode === 'question';
    return `<ol class="order ${o.big ? 'order-big' : ''}">${v.order
      .map((id) => {
        const p = pl(v, id);
        const clues = v.clues.filter((c) => c.pid === id);
        const words = clues
          .map((c) => (c.text ? `<span class="clue-word">„${esc(c.text)}“</span>` : `<span class="clue-done" title="${question ? 'geantwortet' : 'Hinweis gesagt'}">✓</span>`))
          .join('');
        const answer = v.answers[id] ? `<span class="clue-word">„${esc(v.answers[id])}“</span>` : '';
        return `<li class="${id === cur ? 'is-now' : ''} ${p.out ? 'is-out' : ''} ${id === v.me.id ? 'is-me' : ''}">
          <span class="o-name">${esc(p.name)}${p.out ? ` <small>${p.role === 'imposter' ? '🕵️' : '😇'} raus</small>` : ''}</span>
          <span class="o-clues">${words}${answer}</span>
          ${id === cur ? '<span class="o-now">◀ jetzt</span>' : ''}
        </li>`;
      })
      .join('')}</ol>`;
  }

  function cluesHtml(v, ctx) {
    const cur = v.clue.current;
    const question = v.rs.mode === 'question';
    const title = question ? 'Antworten reihum' : `Hinweisrunde ${v.clue.round}${v.clue.rounds > 1 ? ' / ' + v.clue.rounds : ''}`;
    const curName = cur ? pname(v, cur) : '';
    const say = question ? 'beantwortet die eigene Frage laut' : 'sagt ein Wort, das zum geheimen Wort passt';
    const hostButtons = (next) =>
      hostBar([
        next,
        `<button class="btn btn-ghost btn-small" data-act="continue" data-at="${v.step}">${question ? 'Fertig → Diskussion' : 'Hinweise beenden → Diskussion'}</button>`,
      ]);
    if (ctx.kind === 'device') {
      return `
        <h2 class="phase-title">${esc(title)}</h2>
        <div class="now-box"><span class="now-label">👉 Jetzt ist dran</span><b>${esc(curName)}</b><small>${say}</small></div>
        ${hostButtons(`<button class="btn btn-primary btn-big" data-act="next-clue" data-at="${v.step}">Weiter ▶</button>`)}
        ${orderHtml(v)}`;
    }
    if (ctx.kind === 'stage') {
      return `
        <div class="center-stage">
          <h1 class="stage-title">${esc(title)}</h1>
          <div class="now-box big"><span class="now-label">👉 Jetzt ist dran</span><b>${esc(curName)}</b><small>${say}</small></div>
          ${orderHtml(v, { big: true })}
          ${hostButtons(`<button class="btn btn-primary" data-act="next-clue" data-at="${v.step}">⏭ ${esc(curName)} überspringen</button>`)}
        </div>`;
    }
    let mine = '';
    if (cur === v.me.id) {
      mine = v.rs.typeClues
        ? `<form class="word-form" data-form="clue">
            <label class="label center" for="clue-input">🎤 Du bist dran! Dein Hinweis:</label>
            <input id="clue-input" class="input input-word" type="text" maxlength="${MAX_CLUE}" placeholder="ein Wort" value="${esc(ui.clueText)}" data-field="clue" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done" />
            <button class="btn btn-primary btn-big btn-wide" type="submit" ${ui.clueText.trim() ? '' : 'disabled'}>Abschicken ✓</button>
          </form>`
        : `<div class="now-box is-me"><span class="now-label">🎤 Du bist dran!</span><small>${question ? 'Beantworte deine Frage laut' : 'Sag laut ein Wort, das zum Wort passt'}</small>
            <button class="btn btn-primary btn-big" data-act="clue" data-at="${v.step}">Fertig ✓</button></div>`;
    } else {
      mine = `<div class="now-box"><span class="now-label">👉 Jetzt ist dran</span><b>${esc(curName)}</b><small>${say}</small></div>`;
    }
    return `
      <h2 class="phase-title">${esc(title)}</h2>
      ${mine}
      ${orderHtml(v)}
      ${ctx.host ? hostButtons(cur !== v.me.id ? `<button class="btn btn-ghost btn-small" data-act="next-clue" data-at="${v.step}">⏭ ${esc(curName)} überspringen</button>` : '') : ''}`;
  }

  /* ---------- Antworten (Frage-Modus, Handys) ---------- */

  function answerHtml(v, ctx) {
    const alive = aliveIds(v);
    const status = `<p class="muted center">${v.answeredCount} von ${alive.length} haben geantwortet</p>${statusChipsHtml(v, alive, (p) => p.answered)}`;
    const host = ctx.host ? hostBar([`<button class="btn btn-ghost" data-act="continue" data-at="${v.step}">⏭ Weiter – nicht auf alle warten</button>`]) : '';
    if (ctx.kind === 'stage') {
      return `<div class="center-stage"><h1 class="stage-title">✍️ Alle beantworten ihre Frage auf dem Handy</h1>${status}${host}</div>`;
    }
    if (!v.me.inRound) return `<div class="look-up">✍️<b>Die anderen beantworten ihre Frage</b></div>${status}`;
    if (v.me.answer && !ui.answerEdit) {
      return `
        ${cardFaceHtml(v.me.card)}
        <div class="look-up small">✓ Deine Antwort: „${esc(v.me.answer)}“</div>
        <button class="btn btn-link" data-act="edit-answer">Ändern</button>
        ${status}${host}`;
    }
    return `
      ${cardFaceHtml(v.me.card)}
      <form class="word-form" data-form="answer">
        <label class="label center" for="answer-input">Deine Antwort (alle sehen sie gleich gleichzeitig)</label>
        <input id="answer-input" class="input input-word" type="text" maxlength="${MAX_ANSWER}" placeholder="Antwort" value="${esc(ui.answerText)}" data-field="answer" autocomplete="off" enterkeyhint="done" />
        <button class="btn btn-primary btn-big btn-wide" type="submit" ${ui.answerText.trim() ? '' : 'disabled'}>Abschicken ✓</button>
      </form>
      ${status}${host}`;
  }

  /* ---------- Diskussion ---------- */

  function crewQuestionHtml(v) {
    if (!v.crewQuestion) return '';
    const answers = Object.keys(v.answers).length
      ? `<div class="answers">${v.order
          .filter((id) => v.answers[id])
          .map((id) => `<div class="answer"><small>${esc(pname(v, id))}</small><b>${esc(v.answers[id])}</b></div>`)
          .join('')}</div>`
      : '';
    return `<div class="crew-q"><small>Die Frage der Crew war:</small><b>${esc(v.crewQuestion)}</b></div>${answers}`;
  }

  function discussHtml(v, ctx) {
    const word = v.rs.mode === 'word';
    const typed = v.clues.some((c) => c.text);
    const host = ctx.host
      ? hostBar([
          `<button class="btn btn-primary btn-big" data-act="start-vote" data-at="${v.step}">🗳️ Zur Abstimmung</button>`,
          word ? `<button class="btn btn-ghost btn-small" data-act="more-clues" data-at="${v.step}">＋ Noch eine Hinweisrunde</button>` : '',
        ])
      : '<p class="muted small center">Der Host startet die Abstimmung.</p>';
    const timer = v.timer ? timerHtml(v.timer, ctx.host) : '<p class="muted center">⏱ Ohne Zeitlimit</p>';
    const body = `
      <h2 class="phase-title">💬 Wer ist verdächtig?</h2>
      ${timer}
      ${crewQuestionHtml(v)}
      ${word || !v.crewQuestion ? orderHtml(v, { big: ctx.kind === 'stage' && typed }) : ''}
      ${v.impostersLeft ? `<div class="banner">🕵️ Noch ${v.impostersLeft} ${plural(v.impostersLeft, 'Imposter', 'Imposter')} im Spiel!</div>` : ''}
      ${host}`;
    return ctx.kind === 'stage' ? `<div class="center-stage">${body}</div>` : body;
  }

  /* ---------- Abstimmung ---------- */

  function voteHtml(v, ctx) {
    const vote = v.vote;
    const cands = vote.candidates;
    const runoff = vote.runoff ? `<div class="banner">⚖️ Gleichstand! Stichwahl zwischen ${cands.map((id) => esc(pname(v, id))).join(' und ')}</div>` : '';
    if (ctx.kind === 'device') {
      if (ui.voteStep === 'count') {
        return `
          <h2 class="phase-title">🗳️ Wer ist der Imposter?</h2>
          ${runoff}
          <p class="center">Gleich zählt das Gerät runter – bei <b>👉</b> zeigen alle gleichzeitig auf eine Person.</p>
          <div class="host-bar">
            <button class="btn btn-primary btn-big" data-act="countdown">3 – 2 – 1 starten</button>
            <button class="btn btn-link btn-small" data-act="vote-pick">Direkt eintragen</button>
          </div>`;
      }
      const picked = ui.pick;
      const chips = cands
        .map(
          (id) =>
            `<button class="pick ${picked.includes(id) ? 'on' : ''}" data-act="pick" data-player="${esc(id)}" aria-pressed="${picked.includes(id)}">${esc(pname(v, id))}</button>`
        )
        .join('');
      let voters = '';
      if (picked.length === 1) {
        const others = aliveIds(v).filter((id) => id !== picked[0]);
        voters = `
          <div class="voters">
            <small class="muted">Wer hat auf ${esc(pname(v, picked[0]))} gezeigt? <i>(freiwillig – gibt +${POINTS.vote}, falls richtig)</i></small>
            <div class="chips">${others
              .map(
                (id) =>
                  `<button class="chip chip-pick ${ui.voters.includes(id) ? 'on' : ''}" data-act="voter" data-player="${esc(id)}" aria-pressed="${ui.voters.includes(id)}">${ui.voters.includes(id) ? '👉 ' : ''}${esc(pname(v, id))}</button>`
              )
              .join('')}</div>
          </div>`;
      }
      const label =
        picked.length > 1 ? (vote.runoff ? '⚖️ Wieder Gleichstand – niemand fliegt' : '⚖️ Gleichstand → Stichwahl') : picked.length ? `🔍 ${esc(pname(v, picked[0]))} aufdecken` : 'Person antippen …';
      return `
        <h2 class="phase-title">🗳️ Auf wen wurde am meisten gezeigt?</h2>
        ${runoff}
        <p class="muted small center">Gleich viele Stimmen? Einfach mehrere antippen.</p>
        <div class="picks">${chips}</div>
        ${voters}
        <div class="host-bar">
          <button class="btn btn-primary btn-big" data-act="accuse" ${picked.length ? '' : 'disabled'}>${label}</button>
          <button class="btn btn-link btn-small" data-act="countdown">Countdown nochmal</button>
        </div>`;
    }
    const alive = aliveIds(v);
    const voters = alive.filter((id) => pl(v, id).canVote);
    const status = `<p class="muted center">${vote.count} von ${vote.total} haben abgestimmt</p>${statusChipsHtml(v, voters, (p) => p.voted)}`;
    const host = ctx.host
      ? hostBar([vote.count ? `<button class="btn btn-ghost" data-act="end-vote" data-no="${vote.no}">⏹ Abstimmung beenden</button>` : ''])
      : '';
    if (ctx.kind === 'stage') {
      return `<div class="center-stage"><h1 class="stage-title">🗳️ Abstimmung – geheim auf dem Handy</h1>${runoff}${status}${host}</div>`;
    }
    if (!v.me.inRound) return `<h2 class="phase-title">🗳️ Abstimmung</h2>${runoff}${status}`;
    if (v.me.out) return `<div class="look-up">👻<b>Du bist raus</b><small>Die anderen stimmen ab …</small></div>${runoff}${status}${host}`;
    const list = cands
      .filter((id) => id !== v.me.id)
      .map(
        (id) =>
          `<button class="pick ${v.me.vote === id ? 'on' : ''}" data-act="vote" data-target="${esc(id)}" data-no="${vote.no}" aria-pressed="${v.me.vote === id}">${v.me.vote === id ? '🗳️ ' : ''}${esc(pname(v, id))}</button>`
      )
      .join('');
    return `
      <h2 class="phase-title">🗳️ Wer ist der Imposter?</h2>
      ${runoff}
      ${list ? `<div class="picks">${list}</div>` : '<p class="center">Du stehst selbst zur Wahl – die anderen stimmen ab.</p>'}
      <p class="muted small center">${v.me.vote ? `Du hast für ${esc(pname(v, v.me.vote))} gestimmt – umentscheiden geht, bis alle abgestimmt haben.` : 'Geheim – das Ergebnis kommt, wenn alle abgestimmt haben.'}</p>
      ${status}${host}`;
  }

  /* ---------- Letzte Chance ---------- */

  function guessHtml(v, ctx) {
    const g = v.guess;
    const head = `
      <div class="unmask is-imp">
        <span class="unmask-icon" aria-hidden="true">🕵️</span>
        <b>${esc(g.name)} war Imposter!</b>
        <small>Letzte Chance: ${esc(g.name)} darf das Wort raten. Richtig → der Imposter klaut den Sieg.</small>
      </div>`;
    const form = (label) => `
      <form class="word-form" data-form="guess">
        <label class="label center" for="guess-input">${label}</label>
        <input id="guess-input" class="input input-word" type="text" maxlength="${MAX_CLUE}" placeholder="Das Wort ist …" value="${esc(ui.guessText)}" data-field="guess" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done" />
        <button class="btn btn-primary btn-big btn-wide" type="submit" ${ui.guessText.trim() ? '' : 'disabled'}>Raten 🎯</button>
      </form>`;
    const skip = ctx.host ? hostBar([`<button class="btn btn-link btn-small" data-act="skip-guess">Nicht raten (zählt als falsch)</button>`]) : '';
    if (ctx.kind === 'device') return `${head}<p class="center">📲 Gib das Gerät an <b>${esc(g.name)}</b></p>${form(`${esc(g.name)}, was ist das Wort?`)}${skip}`;
    if (ctx.kind === 'stage') return `<div class="center-stage">${head}<p class="muted">${esc(g.name)} tippt auf dem Handy – oder sagt es laut und ihr tippt es hier ein:</p>${form('Geratenes Wort')}${skip}</div>`;
    if (v.me.id === g.pid) return `${head}${form('Was ist das geheime Wort?')}`;
    return `${head}<div class="look-up small">🤔 ${esc(g.name)} überlegt …</div>${skip}`;
  }

  /* ---------- Zwischenstand (bis zum Ende) ---------- */

  function outLineHtml(o) {
    if (o.role === 'imposter') {
      const guess = o.guess == null ? '' : o.guess ? ` – geraten: „${esc(o.guess)}“ ${o.correct ? '✅' : '❌'}` : ' – nicht geraten';
      return `<li class="is-imp">🕵️ <b>${esc(o.name)}</b> war Imposter${guess}</li>`;
    }
    return `<li class="is-crew">😇 <b>${esc(o.name)}</b> war unschuldig</li>`;
  }

  function outHtml(v, ctx) {
    const last = v.outs[v.outs.length - 1];
    const crew = last.role !== 'imposter';
    const body = `
      <div class="unmask ${crew ? 'is-crew' : 'is-imp'}">
        <span class="unmask-icon" aria-hidden="true">${crew ? '😇' : '🕵️'}</span>
        <b>${esc(last.name)} war ${crew ? 'unschuldig!' : 'Imposter!'}</b>
        <small>${last.role === 'imposter' && last.guess != null ? (last.guess ? `Geraten: „${esc(last.guess)}“ – falsch!` : 'Nicht geraten.') : ''}</small>
      </div>
      <div class="banner">🕵️ Es ${v.impostersLeft === 1 ? 'ist' : 'sind'} noch ${v.impostersLeft} Imposter im Spiel – weiter geht's!</div>
      <ul class="out-list">${v.outs.map(outLineHtml).join('')}</ul>
      ${ctx.host ? hostBar([`<button class="btn btn-primary btn-big" data-act="continue" data-at="${v.step}">Weiter → Diskussion</button>`]) : ''}`;
    return ctx.kind === 'stage' ? `<div class="center-stage">${body}</div>` : body;
  }

  /* ---------- Auflösung ---------- */

  function secretHtml(v) {
    const r = v.result;
    const sec = r.secret;
    if (!sec) return '';
    if (sec.kind === 'question') {
      return `<div class="secret-reveal">
        <div><small>Frage der Crew</small><b>${esc(sec.crew)}</b></div>
        <div class="is-imp"><small>Frage des Imposters</small><b>${esc(sec.imposter)}</b></div>
      </div>`;
    }
    return `<div class="secret-reveal">
      <div><small>Das Wort war</small><b class="big">${esc(sec.word)}</b><span>${r.category ? `${r.category.icon} ${esc(r.category.label)}` : ''}</span></div>
      ${v.rs && v.rs.variant === 'undercover' ? `<div class="is-imp"><small>Wort des Imposters</small><b>${esc(sec.decoy)}</b></div>` : ''}
    </div>`;
  }

  function resultHeadline(v) {
    const r = v.result;
    if (r.aborted) return { icon: '🚪', title: 'Runde abgebrochen', sub: 'Es wurde jemand aus dem Spiel entfernt – diese Runde zählt nicht.' };
    const names = r.imposters.map((id) => r.names[id]);
    const many = names.length > 1;
    const caughtRight = v.outs.find((o) => o.role === 'imposter' && o.correct);
    if (r.winner === 'crew') return { icon: '🎉', title: 'Die Crew gewinnt!', sub: `${names.join(' und ')} ${many ? 'wurden' : 'wurde'} entlarvt.` };
    if (r.winner === 'split') return { icon: '⚖️', title: 'Halb erwischt!', sub: 'Ein Teil der Imposter wurde entlarvt, der Rest kam davon.' };
    let sub;
    if (caughtRight) sub = `${caughtRight.name} wurde erwischt, hat aber das Wort erraten!`;
    else if (r.reason === 'deadlock') sub = 'Wieder Gleichstand – niemand flog raus.';
    else if (v.outs.length) sub = `${v.outs.filter((o) => o.role === 'crew').map((o) => o.name).join(', ')} war unschuldig.`;
    else sub = 'Niemand wurde erwischt.';
    return { icon: '🕵️', title: many ? 'Die Imposter gewinnen!' : `${names[0]} gewinnt als Imposter!`, sub };
  }

  /** Persönliches Ergebnis auf dem Handy */
  function myResultHtml(v) {
    const r = v.result;
    if (!v.me.inRound || r.aborted) return '';
    const pts = r.points[v.me.id] || 0;
    const imp = v.me.role === 'imposter';
    return `<div class="my-result ${imp ? 'is-imp' : 'is-crew'}">${imp ? '🕵️ Du warst Imposter' : '😇 Du warst Crew'} · <b>${pts ? '+' + pts : '±0'}</b></div>`;
  }

  function votesSummaryHtml(v) {
    if (!v.votes.length) return '';
    const pass = v.settings.input === 'pass';
    const rows = v.votes
      .map((vt) => {
        // Ein Gerät: gezählt wurde per Zeigen – eingetragen sind nur die Meisten und (freiwillig) wer gezeigt hat
        if (pass) {
          const voters = vt.votes ? Object.keys(vt.votes).map((id) => esc(pname(v, id))) : [];
          return `<li><b>${vt.runoff ? 'Stichwahl' : 'Abstimmung'}:</b> ${vt.top.map((id) => esc(pname(v, id))).join(' / ')}${vt.top.length > 1 ? ' (Gleichstand)' : ''}${
            voters.length ? `<small>Gezeigt haben: ${voters.join(', ')}</small>` : ''
          }</li>`;
        }
        const tally = Object.entries(vt.tally)
          .sort((a, b) => b[1] - a[1])
          .map(([id, n]) => `${esc(pname(v, id))} ${n}`)
          .join(' · ');
        const who = vt.votes && Object.keys(vt.votes).length ? `<small>${Object.entries(vt.votes).map(([a, b]) => `${esc(pname(v, a))} → ${esc(pname(v, b))}`).join(', ')}</small>` : '';
        return `<li><b>${vt.runoff ? 'Stichwahl' : 'Abstimmung'}:</b> ${tally || 'keine Stimmen eingetragen'} ${who}</li>`;
      })
      .join('');
    return `<ul class="vote-list">${rows}</ul>`;
  }

  function resultHtml(v, ctx) {
    const r = v.result;
    const h = resultHeadline(v);
    const pts = Object.entries(r.points || {});
    const points = pts.length
      ? `<div class="chips round-points">${pts
          .sort((a, b) => b[1] - a[1])
          .map(([id, n]) => `<span class="chip ${r.imposters.includes(id) ? 'is-imp' : ''}">${esc(pname(v, id))} <b>+${n}</b></span>`)
          .join('')}</div>`
      : '';
    const last = v.outs[v.outs.length - 1];
    const canJudge = ctx.host && !r.aborted && last && last.role === 'imposter' && last.guess != null && v.rs.mode === 'word';
    const host = ctx.host
      ? hostBar([
          v.lastRound
            ? `<button class="btn btn-primary btn-big" data-act="next-round" data-at="${v.step}">🏆 Zur Siegerehrung</button>`
            : `<button class="btn btn-primary btn-big" data-act="next-round" data-at="${v.step}">Nächste Runde ▶</button>`,
          !v.lastRound ? `<button class="btn btn-ghost btn-small" data-act="finish-ask">🏁 Spiel beenden</button>` : '',
          canJudge
            ? `<button class="btn btn-link btn-small" data-act="judge" data-correct="${last.correct ? '0' : '1'}">${last.correct ? '„' + esc(last.guess) + '“ doch als falsch werten' : last.guess ? '„' + esc(last.guess) + '“ doch als richtig werten' : 'Doch richtig geraten (laut gesagt)'}</button>`
            : '',
        ])
      : `<p class="muted small center">${v.lastRound ? 'Gleich kommt die Siegerehrung …' : 'Warte auf die nächste Runde …'}</p>`;
    const body = `
      <div class="result-head result-${r.winner || 'aborted'}">
        <span class="result-icon">${h.icon}</span>
        <h1>${esc(h.title)}</h1>
        <p>${esc(h.sub)}</p>
      </div>
      ${ctx.kind === 'phone' ? myResultHtml(v) : ''}
      ${secretHtml(v)}
      <div class="imp-reveal">${r.imposters.map((id) => `<span class="chip is-imp">🕵️ ${esc(r.names[id])}</span>`).join('')}</div>
      ${v.outs.length ? `<ul class="out-list">${v.outs.map(outLineHtml).join('')}</ul>` : ''}
      ${votesSummaryHtml(v)}
      ${points}
      ${host}
      ${ctx.kind !== 'stage' ? scoreboardHtml(v) : ''}`;
    return ctx.kind === 'stage' ? `<div class="center-stage">${body}</div>` : body;
  }

  /* ---------- Punkte ---------- */

  function ranked(v) {
    return v.players.slice().sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  function scoreboardHtml(v) {
    const r = v.phase === 'result' ? v.result : null;
    const drinks = v.settings.drinks !== 'off';
    const rows = ranked(v)
      .map((p) => {
        const plus = r && r.points && r.points[p.id] ? `<small class="plus">+${r.points[p.id]}</small>` : '';
        return `<li class="${p.id === v.me.id ? 'is-me' : ''} ${p.online ? '' : 'is-offline'}">
          <span class="sb-name">${esc(p.name)}${p.out && v.phase !== 'result' ? ' 👻' : ''}</span>
          ${drinks && p.drinks ? `<small class="sb-drinks">${v.settings.drinks === 'free' ? '⚠️' : '🍺'} ${p.drinks}</small>` : ''}
          ${plus}<b>${p.score}</b>
        </li>`;
      })
      .join('');
    return `<section class="panel scoreboard"><h2>🏅 Punkte</h2><ol class="sb">${rows}</ol></section>`;
  }

  /* ---------- Siegerehrung ---------- */

  function endHtml(v, ctx) {
    const list = ranked(v);
    // Plätze mit Gleichstand
    let place = 0;
    let last = null;
    const places = list.map((p, i) => {
      if (p.score !== last) place = i + 1;
      last = p.score;
      return place;
    });
    const podium = [1, 0, 2]
      .filter((i) => list[i])
      .map((i) => {
        const p = list[i];
        const medal = ['🥇', '🥈', '🥉'][places[i] - 1] || '🎖️';
        return `<div class="podium-step step-${i + 1}"><span class="podium-medal">${medal}</span><b>${esc(p.name)}</b><small>${p.score} ${plural(p.score, 'Punkt', 'Punkte')}</small><div class="podium-block">${places[i]}</div></div>`;
      })
      .join('');
    const rest = list
      .slice(3)
      .map((p, i) => `<li><span>${places[i + 3]}.</span> ${esc(p.name)} <b>${p.score}</b></li>`)
      .join('');
    const awards = (v.awards || [])
      .map((a) => `<div class="award"><span class="award-icon">${a.icon}</span><div><b>${esc(a.title)}</b><small>${esc(a.text)}</small></div></div>`)
      .join('');
    const me = v.me.id ? list.findIndex((p) => p.id === v.me.id) : -1;
    const host = ctx.host
      ? hostBar([`<button class="btn btn-primary btn-big" data-act="again">🔁 Neues Spiel</button>`, `<button class="btn btn-ghost" data-act="home">Hauptmenü</button>`])
      : '<p class="muted small center">Danke fürs Spielen! Der Host kann ein neues Spiel starten.</p>';
    return `
      <div class="center-stage over">
        <h1 class="over-title">🏆 Siegerehrung</h1>
        ${me >= 0 ? `<p class="my-place">Du bist auf Platz <b>${places[me]}</b> 🎉</p>` : ''}
        ${list.length ? `<div class="podium">${podium}</div>` : ''}
        ${rest ? `<ol class="rest-list">${rest}</ol>` : ''}
        ${awards ? `<div class="awards">${awards}</div>` : ''}
        ${host}
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Dialoge                                                             */
  /* ------------------------------------------------------------------ */

  function modalHtml() {
    if (!ui.modal) return '';
    const v = ui.view;
    let body = '';
    if (ui.modal === 'rules') body = rulesHtml();
    else if (ui.modal === 'menu') body = menuHtml();
    else if (ui.modal === 'qr') {
      body = `<h2>📱 Mitspieler einladen</h2>${roomBoxHtml(v && v.room, false)}
        <p class="muted small center">Wer jetzt beitritt, spielt ab der nächsten Runde mit.</p>
        <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig</button></div>`;
    } else if (ui.modal === 'settings' && v) {
      const n = v.players.filter((p) => p.online).length;
      body = `<h2>⚙️ Einstellungen</h2>${settingsHtml(v.settings, 'live', n)}
        <p class="muted small">Gilt ab der nächsten Runde; die Spielweise bleibt.</p>
        <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig</button></div>`;
    } else if (ui.modal === 'kick-list' && v) {
      const others = v.players.filter((p) => !p.host);
      body = `<h2>🚪 Mitspieler entfernen</h2><p class="muted">Wer ist gegangen? Läuft eine Runde mit dieser Person, geht sie ohne sie weiter.</p>
        <div class="chips">${others
          .map((p) => `<span class="chip ${p.online ? '' : 'is-offline'}">${esc(p.name)}<button class="chip-x" data-act="kick" data-player="${esc(p.id)}" aria-label="${esc(p.name)} entfernen">✕</button></span>`)
          .join('')}</div>
        <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig</button></div>`;
    } else if (ui.modal === 'peek-list' && v && v.pass) {
      body = `<h2>👁 Karte nochmal ansehen</h2><p class="muted">Wer hat sein Wort vergessen?</p>
        <div class="picks">${v.order.map((id) => `<button class="pick" data-act="peek" data-player="${esc(id)}">${esc(pname(v, id))}</button>`).join('')}</div>`;
    } else if (ui.modal === 'peek' && v && v.pass && ui.peek) {
      body = `<h2>📲 Gib das Gerät an ${esc(pname(v, ui.peek))}</h2>
        ${holdCardHtml(v.pass.cards[ui.peek], 'Gedrückt halten zum Ansehen')}
        <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig – Gerät zurück</button></div>`;
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
    return `
      <h2>📖 Spielregeln</h2>
      <div class="rules">
        <p>Alle bekommen dasselbe geheime Wort – <b>außer dem Imposter</b>. Er sieht nur „🕵️ Du bist der Imposter“
          (und auf Wunsch die Kategorie). Gespielt wird mit 3–15 Personen.</p>
        <h3>Ablauf einer Runde</h3>
        <ol>
          <li><b>Verteilen:</b> Jede Person schaut geheim ihre Karte an.</li>
          <li><b>Hinweise:</b> Reihum sagt jede Person <b>ein Wort</b>, das zum geheimen Wort passt – nicht zu offensichtlich
            (sonst errät es der Imposter), nicht zu vage (sonst wirkt man verdächtig). 1–3 Runden.</li>
          <li><b>Diskussion:</b> Wer war verdächtig? Mit Timer, vorzeitig beenden geht immer.</li>
          <li><b>Abstimmung:</b> Alle gleichzeitig – auf einem Gerät per Countdown und Zeigen, mit Handys geheim.
            Wer die meisten Stimmen hat, ist raus und wird aufgedeckt.</li>
          <li><b>Letzte Chance:</b> War es der Imposter, darf er das Wort raten. Richtig → er klaut den Sieg!</li>
        </ol>
        <p><b>Gleichstand:</b> kurze Stichwahl zwischen den Gleichen. Wieder Gleichstand → niemand fliegt, der Imposter gewinnt.</p>
        <h3>Punkte</h3>
        <ul>
          <li>Imposter wird <b>nicht</b> erwischt: Imposter <b>+${POINTS.hidden}</b></li>
          <li>Imposter erwischt, <b>errät aber das Wort</b>: Imposter <b>+${POINTS.guessed}</b></li>
          <li>Imposter erwischt und rät falsch: jede Crew-Person <b>+${POINTS.crew}</b></li>
          <li>Für einen Imposter gestimmt: <b>+${POINTS.vote}</b> extra</li>
        </ul>
        <p class="muted small">Mehrere Imposter kennen sich nicht und werden einzeln gewertet. Variante „bis zum Ende“: Es wird so lange
          weiter diskutiert und abgestimmt, bis alle Imposter raus sind oder die Crew nicht mehr in der Überzahl ist.</p>
        <h3>🎭 Undercover</h3>
        <p>Der Imposter bekommt ein <b>ähnliches Wort</b> (<i>Tee</i> statt <i>Kaffee</i>) und weiß nicht, dass er Imposter ist –
          er merkt es erst an den Hinweisen der anderen.</p>
        <h3>❓ Frage-Modus</h3>
        <p>Alle bekommen eine Frage, der Imposter heimlich eine andere mit ähnlicher Antwort
          (<i>„Wie viele Stunden schläfst du?“</i> ↔ <i>„Wie lang darf ein Film höchstens sein?“</i>). Erst wird geantwortet,
          dann wird die Frage der Crew gezeigt – wessen Antwort passt nicht?</p>
        <h3>🍻 Trinkregeln (optional)</h3>
        <ul>
          <li>Erwischter Imposter (falsch geraten): ${DRINKS.caught} Schlucke</li>
          <li>Unentdeckter Imposter: verteilt ${DRINKS.give} Schlucke</li>
        </ul>
        <p class="muted small">Alkoholfrei-Variante: Strafpunkte statt Schlucke. Trinkt verantwortungsvoll – Wasser zählt auch. 💧</p>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Alles klar!</button></div>`;
  }

  function menuHtml() {
    const v = ui.view;
    const items = [];
    items.push(`<button class="menu-item" data-act="rules">📖 Spielregeln</button>`);
    items.push(`<button class="menu-item" data-act="mute">${Sound.muted ? '🔊 Ton einschalten' : '🔇 Ton ausschalten'}</button>`);
    if (v && v.me.host) {
      const running = !['lobby', 'end'].includes(v.phase);
      if (v.pass && running && v.phase !== 'reveal' && v.phase !== 'result') items.push(`<button class="menu-item" data-act="peek-list">👁 Karte nochmal ansehen <small>(Wort vergessen?)</small></button>`);
      if (v.room) items.push(`<button class="menu-item" data-act="show-qr">📱 Mitspieler einladen</button>`);
      if (v.phase === 'lobby' || v.phase === 'result') items.push(`<button class="menu-item" data-act="settings">⚙️ Einstellungen</button>`);
      if (v.room && v.phase !== 'lobby') {
        const others = v.players.filter((p) => !p.host);
        if (others.length) items.push(`<button class="menu-item" data-act="kick-list">🚪 Mitspieler entfernen <small>(z.B. wer gegangen ist)</small></button>`);
      }
      items.push(`<button class="menu-item" data-act="home-keep">🏠 Hauptmenü <small>(Spiel bleibt gespeichert)</small></button>`);
      if (running) items.push(`<button class="menu-item danger" data-act="finish-ask">🏁 Spiel beenden & Siegerehrung</button>`);
      items.push(`<button class="menu-item danger" data-act="close-game">🚪 Spiel schließen</button>`);
    } else if (v) {
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

  function at(el) {
    return el && el.dataset.at !== undefined ? +el.dataset.at : undefined;
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

  function createGame() {
    const s = ui.setup;
    ui.error = null;
    const pass = s.settings.input === 'pass';
    if (pass) {
      const filled = s.players.filter((n) => n.trim()).length;
      if (filled && filled < MIN_PLAYERS) {
        ui.error = `Bitte mindestens ${MIN_PLAYERS} Namen eintragen.`;
        render();
        return;
      }
    }
    const hostName = (s.hostName || ui.name || '').trim();
    if (!pass && s.settings.hostPlays && !hostName) {
      ui.error = 'Bitte gib deinen Namen ein.';
      ui.focus = '#host-name';
      render();
      return;
    }
    if (hostName) {
      ui.name = hostName;
      savePrefs();
    }
    const state = Engine.create({ settings: s.settings, players: s.players.filter((n) => n.trim()).length ? s.players.filter((n) => n.trim()) : s.players, hostName });
    Sound.unlock();
    startStage({ state });
  }

  function runCountdown() {
    clearInterval(ui.countdownTimer);
    ui.countdown = 3;
    Sound.tick(false);
    render();
    ui.countdownTimer = setInterval(() => {
      if (ui.countdown > 0) {
        ui.countdown -= 1;
        if (ui.countdown > 0) Sound.tick(ui.countdown === 1);
        else Sound.start();
        render();
      } else {
        clearInterval(ui.countdownTimer);
        ui.countdown = null;
        ui.voteStep = 'pick';
        render();
      }
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
    settings: () => {
      ui.modal = 'settings';
      render();
    },
    'close-modal': () => {
      ui.modal = null;
      ui.confirm = null;
      ui.peek = null;
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
    'finish-ask': () =>
      askConfirm({
        title: 'Spiel beenden?',
        text: 'Es geht zur Siegerehrung. Eine laufende Runde zählt nicht mehr.',
        yes: 'Beenden',
        danger: true,
        run: () => dispatch('finish'),
      }),

    /* Setup & Einstellungen */
    set: (el) => {
      const key = el.dataset.key;
      let value = el.dataset.value;
      if (['imposters', 'clueRounds', 'discussSec'].includes(key)) value = +value;
      if (key === 'rounds') value = value === 'players' ? 'players' : +value;
      setSetting(el.dataset.scope, key, value);
    },
    toggle: (el) => {
      const s = currentSettings(el.dataset.scope);
      if (s) setSetting(el.dataset.scope, el.dataset.key, !s[el.dataset.key]);
    },
    cat: (el) => {
      const s = currentSettings(el.dataset.scope);
      if (!s) return;
      const id = el.dataset.cat;
      const cats = s.categories.includes(id) ? s.categories.filter((c) => c !== id) : s.categories.concat(id);
      if (!cats.length) {
        toast('Mindestens eine Kategorie muss ausgewählt sein.');
        return;
      }
      setSetting(el.dataset.scope, 'categories', cats);
    },
    'add-player': () => {
      const list = ui.setup.players;
      if (list.length >= MAX_PLAYERS) return;
      list.push('');
      saveSetup();
      ui.focus = `[data-field="player-name"][data-player="${list.length - 1}"]`;
      render();
    },
    'remove-player': (el) => {
      const list = ui.setup.players;
      if (list.length <= MIN_PLAYERS) return;
      list.splice(+el.dataset.player, 1);
      saveSetup();
      render();
    },
    'create-game': createGame,

    /* Lobby */
    kick: (el) => {
      const v = ui.view;
      const name = v ? pname(v, el.dataset.player) : '';
      askConfirm({
        title: `${name} entfernen?`,
        text: v && v.phase !== 'lobby' ? 'Läuft gerade eine Runde mit dieser Person, geht sie ohne sie weiter (oder wird abgebrochen, wenn es der Imposter war).' : 'Die Person kann über den QR-Code wieder beitreten.',
        yes: 'Entfernen',
        danger: true,
        run: () => dispatch('kick', { player: el.dataset.player }),
      });
    },
    'kick-list': () => {
      ui.modal = 'kick-list';
      render();
    },
    start: () => dispatch('start'),

    /* Verteilen */
    'open-card': () => {
      ui.cardOpen = true;
      Sound.flip();
      render();
    },
    seen: (el) => {
      ui.cardOpen = false;
      if (el.dataset.player) dispatch('seen', { player: el.dataset.player });
      else dispatch('seen');
      render();
    },
    continue: (el) => dispatch('continue', { at: at(el) }),

    /* Hinweise */
    'next-clue': (el) => dispatch('nextClue', { at: at(el) }),
    clue: (el) => dispatch('clue', { at: at(el) }),
    'more-clues': (el) => dispatch('moreClues', { at: at(el) }),

    /* Antworten */
    'edit-answer': () => {
      ui.answerEdit = true;
      ui.answerText = (ui.view && ui.view.me.answer) || '';
      ui.focus = '#answer-input';
      render();
    },

    /* Abstimmung */
    'start-vote': (el) => dispatch('startVote', { at: at(el) }),
    countdown: runCountdown,
    'vote-pick': () => {
      ui.voteStep = 'pick';
      render();
    },
    pick: (el) => {
      const id = el.dataset.player;
      ui.pick = ui.pick.includes(id) ? ui.pick.filter((x) => x !== id) : ui.pick.concat(id);
      ui.voters = ui.voters.filter((x) => ui.pick.length === 1 && x !== ui.pick[0]);
      render();
    },
    voter: (el) => {
      const id = el.dataset.player;
      ui.voters = ui.voters.includes(id) ? ui.voters.filter((x) => x !== id) : ui.voters.concat(id);
      render();
    },
    accuse: () => {
      const v = ui.view;
      if (!v || !v.vote || !ui.pick.length) return;
      dispatch('accuse', { targets: ui.pick.slice(), voters: ui.voters.slice(), no: v.vote.no });
    },
    vote: (el) => dispatch('vote', { target: el.dataset.target, no: +el.dataset.no }),
    'end-vote': (el) =>
      askConfirm({
        title: 'Abstimmung beenden?',
        text: 'Es zählen die Stimmen, die schon abgegeben wurden.',
        yes: 'Auswerten',
        run: () => dispatch('endVote', { no: +el.dataset.no }),
      }),

    /* Raten & Auflösung */
    'skip-guess': () =>
      askConfirm({
        title: 'Nicht raten?',
        text: 'Das zählt als falsch geraten.',
        yes: 'Ja, weiter',
        run: () => dispatch('skipGuess'),
      }),
    judge: (el) => dispatch('judge', { correct: el.dataset.correct === '1' }),
    'next-round': (el) => {
      const v = ui.view;
      if (v && !v.lastRound && v.settings.input === 'phones' && v.players.filter((p) => p.online).length < MIN_PLAYERS) {
        toast(`Für die nächste Runde braucht ihr mindestens ${MIN_PLAYERS} verbundene Personen.`);
        return;
      }
      dispatch('nextRound', { at: at(el) });
    },
    again: () => dispatch('again'),

    /* Ein Gerät: Karte nochmal ansehen */
    'peek-list': () => {
      ui.modal = 'peek-list';
      render();
    },
    peek: (el) => {
      ui.peek = el.dataset.player;
      ui.modal = 'peek';
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

  /* Karte gedrückt halten */
  function holdOf(e) {
    return e.target && e.target.closest ? e.target.closest('[data-hold]') : null;
  }
  app.addEventListener('pointerdown', (e) => {
    const el = holdOf(e);
    if (!el) return;
    el.classList.add('is-shown');
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    app.addEventListener(type, (e) => {
      const el = holdOf(e);
      if (el) el.classList.remove('is-shown');
    });
  }
  app.addEventListener('contextmenu', (e) => {
    if (holdOf(e)) e.preventDefault();
  });
  app.addEventListener('keydown', (e) => {
    const el = holdOf(e);
    if (el && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      el.classList.add('is-shown');
    }
  });
  app.addEventListener('keyup', (e) => {
    const el = holdOf(e);
    if (el && (e.key === ' ' || e.key === 'Enter')) el.classList.remove('is-shown');
  });

  app.addEventListener('input', (e) => {
    const el = e.target;
    const f = el.dataset && el.dataset.field;
    if (!f) return;
    if (f === 'player-name') {
      ui.setup.players[+el.dataset.player] = el.value;
      saveSetup();
    } else if (f === 'host-name') {
      ui.setup.hostName = el.value;
      saveSetup();
    } else if (f === 'name') {
      ui.name = el.value;
    } else if (f === 'join-code') {
      ui.joinCode = Net.cleanCode(el.value);
    } else if (f === 'clue' || f === 'answer' || f === 'guess') {
      const before = (ui[f + 'Text'] || '').trim();
      ui[f + 'Text'] = el.value;
      // Knopf freischalten, sobald etwas drinsteht
      if (!before !== !el.value.trim()) render();
    }
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
    } else if (el.dataset.field === 'host-name') {
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
      return;
    }
    if (!v) return;
    const blur = () => document.activeElement && document.activeElement.blur();
    if (form.dataset.form === 'clue') {
      const text = ui.clueText.trim();
      if (!text) return;
      blur();
      dispatch('clue', { text, at: v.step });
    } else if (form.dataset.form === 'answer') {
      const text = ui.answerText.trim();
      if (!text) return;
      blur();
      ui.answerEdit = false;
      dispatch('answer', { text });
    } else if (form.dataset.form === 'guess') {
      const text = ui.guessText.trim();
      if (!text) return;
      blur();
      dispatch('guess', { text });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.modal) {
      ui.modal = null;
      ui.confirm = null;
      ui.peek = null;
      render();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ui.view && ui.view.phase !== 'lobby' && ui.view.phase !== 'end') keepAwake(true);
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

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.IM_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  requestAnimationFrame(timerLoop);
  autoResume();

  // für Tests
  window.IMApp = { ui, render: renderNow, actions };
})();
