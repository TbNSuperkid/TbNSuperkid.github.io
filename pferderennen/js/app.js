/*
 * Oberfläche von „Pferderennen“.
 *  - Gerät mit der Rennbahn („device“ bei Ein Gerät / Echte Karten, „stage“ bei Mit Handys):
 *    Startseite, Spiel anlegen, Lobby mit QR-Code, Wettbüro, Rennbahn mit Galopp, Kartenwenden,
 *    Live-Chancen, Kommentar, Fanfare, Startschuss, Hufgetrappel und Fotofinish, Quoten-Wetten,
 *    Abrechnung mit Verteilen, Statistik, Rangliste/Siegerehrung
 *  - Handy („phone“): beitreten, setzen, eigenes Pferd live (vibriert), nachsetzen, Schlucke verteilen
 * Gerendert wird per HTML-String + morphdom (nur geänderte Teile werden ersetzt).
 */
(function () {
  'use strict';

  const E = window.PFEngine;
  const { Engine, DECKS, LENGTHS, MAX_BETS, PAYOUTS, SPEEDS, SPEED_MS, RACES, MIN_PLAYERS, MAX_PLAYERS, CHIPS_START, CHIPS_PAYOUT, sanitizeSettings } = E;
  const { StageController, ClientController, Store, KEYS, Net, inviteLink, qrSvg } = window.PFControllers;
  const { Sound, confetti } = window.GameFx;
  const Sounds = window.PFSounds;
  const Cards = window.PFCards;
  const SUITS = Cards.SUITS;

  const INPUT = {
    single: {
      icon: '🖥️',
      label: 'Ein Gerät',
      text: 'Laptop, Fernseher oder Handy in der Mitte. Wetten reihum eintragen, dann läuft das Rennen – automatisch oder per Tippen.',
    },
    phones: {
      icon: '📱',
      label: 'Mit Handys',
      text: 'Der Laptop ist die Rennbahn. Alle scannen den QR-Code, setzen auf dem Handy, fiebern mit dem eigenen Pferd mit und verteilen per Antippen.',
    },
    real: {
      icon: '🃏',
      label: 'Echte Karten',
      text: 'Ihr spielt mit einem echten Deck am Tisch. Die App ist Wettbüro und Abrechnung: Wetten eintragen, Siegerpferd antippen.',
    },
  };
  const SPEED_LABEL = { slow: '🐢 Langsam', normal: '🐎 Normal', fast: '⚡ Schnell', tap: '👆 Tippen' };
  const SPEED_TEXT = {
    slow: 'Alle 2,5 Sekunden eine Karte',
    normal: 'Alle 1,5 Sekunden eine Karte',
    fast: 'Alle 0,8 Sekunden eine Karte',
    tap: 'Tippen oder Leertaste = nächste Karte – wie ein echter Kartengeber',
  };
  const SUIT_COLOR = { S: '#7c9cff', H: '#ff4d6a', D: '#ffad33', C: '#2fd57e' };
  const PHASE_LABEL = { lobby: 'Handys verbinden', betting: 'Wettbüro', racing: 'Rennen läuft', payout: 'Abrechnung', end: 'Rangliste' };
  const GAIT_MS = { slow: 560, normal: 440, fast: 340, tap: 440 }; // Dauer eines Galoppsprungs
  const SETUP_KEY = 'pferderennen.setup.v1';
  const PREFS_KEY = 'pferderennen.prefs.v1';
  const ACTIVE_KEY = 'pferderennen.active';
  const RESUME_MAX_AGE = 12 * 60 * 60 * 1000;
  const HOLD_MS = 2800; // Zieleinlauf so lange zeigen, bevor die Abrechnung kommt
  const PHOTO_MS = 1500; // davor beim Fotofinish: Blitz und Zielfoto

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

  /** „Anna“, „Anna und Ben“, „Anna, Ben und Cem“ */
  function joinNames(names) {
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' und ' + names[names.length - 1];
  }

  function suitName(s) {
    return Cards.SUIT[s].name;
  }

  function suitSym(s) {
    return Cards.SUIT[s].symbol;
  }

  function racesLabel(n) {
    return n ? String(n) : '∞';
  }

  function isChips(s) {
    return s.currency === 'chips';
  }

  /** Einheit: 🍺 / 🪙 */
  function icon(s) {
    return isChips(s) ? '🪙' : '🍺';
  }

  function unit(s, n) {
    return isChips(s) ? `${n} ${plural(n, 'Chip', 'Chips')}` : `${n} ${plural(n, 'Schluck', 'Schlucke')}`;
  }

  function signed(n) {
    return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0';
  }

  function pct(p) {
    return p >= 0.995 ? '100 %' : p < 0.005 ? '0 %' : `${Math.round(p * 100)} %`;
  }

  function quoteText(q) {
    return '× ' + String(q).replace('.', ',');
  }

  function pname(v, id) {
    const p = v.players.find((x) => x.id === id);
    return p ? p.name : '?';
  }

  function defaultSetup() {
    return { settings: sanitizeSettings({}), players: ['', '', '', ''] };
  }

  function loadSetup() {
    const saved = Store.get(SETUP_KEY);
    if (!saved || !Array.isArray(saved.players)) return defaultSetup();
    saved.settings = sanitizeSettings(saved.settings);
    while (saved.players.length < 1) saved.players.push('');
    return saved;
  }

  function saveSetup() {
    Store.set(SETUP_KEY, ui.setup);
  }

  /** Namen pro Pferd (ohne geheime Wetten): { S: ['Anna', 'Cem'], … } */
  function bettors(v) {
    const out = { S: [], H: [], D: [], C: [] };
    for (const p of v.players) {
      const b = v.bets[p.id];
      if (b && b.suit) out[b.suit].push(p.name);
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Zustand der Oberfläche                                              */
  /* ------------------------------------------------------------------ */

  const params = new URLSearchParams(location.search);
  const prefs = Object.assign({ hooves: true, name: '' }, Store.get(PREFS_KEY) || {});

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
    focus: null,
    countdown: null, // 3, 2, 1, 0 (= „Los!“) vor dem Rennen
    hold: false, // Zieleinlauf wird noch gezeigt
    photo: false, // Fotofinish-Blitz läuft
    prefs,
    addName: '',
    autoTimer: null,
    autoStep: null,
    realOrder: [], // Echte Karten: angetippte Platzierung
    oddsSel: {}, // Quoten-Wetten: Auswahl pro Person { pid: {suit, amount} }
    giveFor: null, // Laptop verteilt für diese Person
  };
  if (ui.joinCode) ui.screen = 'join';

  function savePrefs() {
    ui.prefs.name = ui.name;
    Store.set(PREFS_KEY, ui.prefs);
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

  function vibrate(p) {
    if (navigator.vibrate) navigator.vibrate(p);
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
    ui.view = null;
    ui.status = null;
    ui.error = null;
    ui.screen = 'connecting';
    session(ACTIVE_KEY, kind);
    try {
      ui.ctrl = factory({ onView: guard(handleView), onStatus: guard(handleStatus), onKicked: guard(handleKicked) });
    } catch (err) {
      ui.ctrl = null;
      ui.token = null;
      session(ACTIVE_KEY, null);
      ui.screen = kind === 'client' ? 'join' : 'setup';
      ui.error = 'Verbindung nicht möglich: ' + err.message;
    }
    render();
  }

  function startStage(opts) {
    startController('stage', (cb) => new StageController(opts, cb));
    // Ein fortgesetztes Rennen startet pausiert
    if (ui.view && ui.view.phase === 'racing') dispatch('pause', { paused: true });
  }

  function startClient(opts) {
    startController('client', (cb) => new ClientController(opts, cb));
  }

  function stopController(keepSave) {
    if (ui.ctrl) ui.ctrl.leave(keepSave);
    ui.ctrl = null;
    ui.token = null;
    ui.view = null;
    ui.modal = null;
    ui.hold = false;
    ui.photo = false;
    ui.realOrder = [];
    ui.oddsSel = {};
    clearTimeout(ui.photoTimer);
    stopCountdown();
    stopAuto();
    Sounds.hooves.stop();
    session(ACTIVE_KEY, null);
    keepAwake(false);
  }

  function goHome(keepSave) {
    stopController(keepSave);
    ui.screen = 'home';
    history.replaceState(null, '', location.pathname);
    render();
  }

  function savedGames() {
    const now = Date.now();
    const stage = Store.get(KEYS.stage);
    const client = Store.get(KEYS.client);
    return {
      stage: stage && stage.state && stage.state.game === 'pferderennen' && stage.state.phase !== 'end' && now - (stage.savedAt || 0) < RESUME_MAX_AGE ? stage : null,
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
    keepAwake(v.phase !== 'end');
    if (v.phase !== 'racing') ui.realOrder = [];
    if (!v.oddsWin) ui.oddsSel = {};
    if (ui.giveFor && (!v.give || !v.give.givers[ui.giveFor])) {
      ui.giveFor = null;
      if (ui.modal === 'give') ui.modal = null;
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
          ? 'Kein Spiel mit diesem Code gefunden. Stimmt der Code und ist die Rennbahn noch online?'
          : e === 'wrong-game'
            ? 'Unter diesem Code läuft ein anderes Spiel.'
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
    toast(reason === 'kicked' ? 'Du wurdest aus dem Spiel entfernt.' : 'Der Rennabend ist vorbei. 🏇');
  }

  /** Sounds, Countdown, Zieleinlauf, Vibration und Konfetti bei Zustandswechseln */
  function transitions(prev, v) {
    if (!prev) return;
    const phone = !v.me.stage;
    const ev = v.event;
    const pev = prev.event;
    if (ev && (!pev || pev.n !== ev.n)) {
      if (ev.kind === 'joined' && !phone) toast(`📱 ${ev.name} ist dabei!`);
      if (ev.kind === 'pity') toast(`🪙 Mitleidschip für ${joinNames(ev.names)}`);
      if (ev.kind === 'odds') {
        Sounds.lead();
        if (phone) vibrate([60, 40, 60]);
      }
    }
    if (v.phase === 'racing' && prev.phase === 'betting') {
      if (phone) {
        vibrate(200);
        return;
      }
      if (v.race) runCountdown();
      return;
    }
    if (v.phase !== 'racing') stopCountdown();
    const r = v.race;
    const pr = prev.race;
    if (r && pr && r.tick > pr.tick) {
      if (phone) {
        const mine = v.me.id && v.bets[v.me.id] && v.bets[v.me.id].suit;
        if (mine && r.events.some((e) => e.type === 'track' && e.suit === mine && e.to < e.from)) vibrate([90, 60, 90]);
        else if (mine && r.events.some((e) => e.type === 'move' && e.suit === mine)) vibrate(40);
      } else {
        Sound.flip();
        if (v.settings.speed === 'tap' && ui.prefs.hooves && !r.winner) Sounds.hooves.once(GAIT_MS.tap);
        const key = r.say && r.say.key;
        if (key === 'drama') setTimeout(() => Sounds.drama(), 380);
        else if (key === 'lead') setTimeout(() => Sounds.lead(), 200);
      }
    }
    if (v.phase === 'payout' && prev.phase === 'racing') {
      if (phone) {
        const line = v.result.lines.find((l) => l.id === v.me.id);
        if (line && line.suit === v.result.winner) {
          vibrate([150, 80, 150, 80, 300]);
          confetti([SUIT_COLOR[v.result.winner], '#facc15', '#fffdf7'], 120);
        }
        return;
      }
      ui.hold = !!v.race;
      clearTimeout(ui.holdTimer);
      clearTimeout(ui.photoTimer);
      const celebrate = () => {
        Sound.fanfare();
        Sounds.cheer();
        const c = SUIT_COLOR[v.result.winner];
        setTimeout(() => confetti([c, '#fffdf7', '#facc15', c], 200), 150);
      };
      if (v.result.photo) {
        // Fotofinish: erst Blitz und Zielfoto, dann der Sieger
        ui.photo = true;
        Sounds.shutter();
        ui.photoTimer = setTimeout(() => {
          ui.photo = false;
          celebrate();
          render();
        }, PHOTO_MS);
        ui.holdTimer = setTimeout(endHold, PHOTO_MS + HOLD_MS);
      } else {
        celebrate();
        if (ui.hold) ui.holdTimer = setTimeout(endHold, HOLD_MS);
      }
    }
    if (v.phase === 'end' && prev.phase !== 'end') {
      Sound.fanfare();
      setTimeout(() => confetti(null, 220), 150);
    }
  }

  function endHold() {
    clearTimeout(ui.holdTimer);
    if (!ui.hold) return;
    if (ui.photo) {
      // Überspringen während des Zielfotos: Jubel trotzdem abspielen
      clearTimeout(ui.photoTimer);
      ui.photo = false;
      Sound.fanfare();
    }
    ui.hold = false;
    render();
  }

  /* ---------- Countdown vor dem Rennen ---------- */

  function stopCountdown() {
    clearInterval(ui.countdownTimer);
    clearTimeout(ui.countdownHide);
    ui.countdown = null;
  }

  /** Fanfare, 3 – 2 – 1, Startschuss */
  function runCountdown() {
    stopCountdown();
    ui.countdown = 3;
    Sounds.bugle();
    ui.countdownTimer = setInterval(() => {
      ui.countdown -= 1;
      if (ui.countdown <= 0) {
        clearInterval(ui.countdownTimer);
        Sounds.shot();
        ui.countdownHide = setTimeout(() => {
          ui.countdown = null;
          render();
        }, 650);
      }
      render();
    }, 900);
  }

  /* ---------- Hufgetrappel & automatisch ziehen ---------- */

  /** Läuft das Rennen gerade von selbst? (nur auf dem Gerät mit der Rennbahn) */
  function running(v) {
    return (
      ui.screen === 'game' &&
      v &&
      v.me.stage &&
      v.phase === 'racing' &&
      v.race &&
      !v.race.winner &&
      !v.paused &&
      !v.oddsWin &&
      v.settings.speed !== 'tap' &&
      !ui.modal &&
      ui.countdown == null
    );
  }

  function syncHooves() {
    const v = ui.view;
    if (ui.prefs.hooves && !Sound.muted && running(v) && document.visibilityState === 'visible') Sounds.hooves.run(GAIT_MS[v.settings.speed]);
    else Sounds.hooves.stop();
  }

  function stopAuto() {
    clearTimeout(ui.autoTimer);
    ui.autoTimer = null;
    ui.autoStep = null;
  }

  function syncAuto() {
    const v = ui.view;
    if (!running(v)) {
      stopAuto();
      return;
    }
    if (ui.autoStep === v.step) return;
    clearTimeout(ui.autoTimer);
    ui.autoStep = v.step;
    const at = v.step;
    ui.autoTimer = setTimeout(() => {
      ui.autoTimer = null;
      dispatch('draw', { at });
    }, SPEED_MS[v.settings.speed]);
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
    syncAuto();
    syncHooves();
  }

  /* ---------- Bausteine ---------- */

  function logoHtml(small) {
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="Pferderennen">
      <span class="logo-icon" aria-hidden="true">🏇</span>
      <span class="logo-text"><span class="l1">Pferde</span><span class="l2">rennen</span></span>
    </div>`;
  }

  /** Spielkarte; ohne Karte = verdeckt */
  function cardHtml(card, cls) {
    if (!card) return `<span class="pc pc-back ${cls || ''}" aria-label="verdeckte Karte"></span>`;
    const l = Cards.label(card);
    return `<span class="pc ${l.red ? 'is-red' : ''} ${cls || ''}" aria-label="${l.name} ${l.rank}"><b>${l.rank}</b><i>${l.symbol}</i></span>`;
  }

  function aceHtml(suit, cls) {
    return cardHtml(suit + 'A', 'pc-ace ' + (cls || ''));
  }

  function seg(key, options, value, fmt, scope, num, disabled) {
    return `<div class="seg" role="group">${options
      .map(
        (o) =>
          `<button class="seg-btn ${o === value ? 'on' : ''}" data-act="set" data-key="${key}" data-value="${o}" data-scope="${scope}" ${num ? 'data-num="1"' : ''} aria-pressed="${o === value}" ${disabled ? 'disabled' : ''}>${fmt(o)}</button>`
      )
      .join('')}</div>`;
  }

  function switchHtml(key, on, scope, label) {
    return `<button class="switch ${on ? 'on' : ''}" data-act="toggle" data-key="${key}" data-scope="${scope}" role="switch" aria-checked="${on}" aria-label="${esc(label)}"><span class="switch-knob"></span>${on ? 'An' : 'Aus'}</button>`;
  }

  function setting(title, sub, control) {
    return `<div class="setting"><div class="setting-label"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div>${control}</div>`;
  }

  /** started: Währung lässt sich nicht mehr wechseln */
  function settingsHtml(s, scope, started) {
    const live = scope === 'live';
    const later = live ? ' · ab dem nächsten Rennen' : '';
    const real = s.input === 'real';
    const chips = isChips(s);
    const rows = [];
    rows.push(
      setting(
        '💱 Währung',
        (chips ? `Alkoholfrei: alle starten mit ${CHIPS_START} Chips, Sieger bekommen Einsatz × ${CHIPS_PAYOUT} zurück` : 'Schlucke setzen, verteilen und trinken') +
          (started ? ' · nach dem ersten Rennen fest' : ''),
        seg('currency', ['sips', 'chips'], s.currency, (o) => (o === 'chips' ? '🪙 Chips' : '🍺 Schlucke'), scope, false, started)
      )
    );
    if (!chips) {
      rows.push(setting('🍺 Max. Einsatz', `1 bis ${s.maxBet} Schlucke pro Wette`, seg('maxBet', MAX_BETS, s.maxBet, String, scope, true)));
      rows.push(setting('🎁 Gewinner verteilen', `Einsatz × ${s.payout}`, seg('payout', PAYOUTS, s.payout, (o) => `× ${o}`, scope, true)));
      rows.push(
        setting('⬇️ Letzter trinkt doppelt', 'Wer auf das letzte Pferd gesetzt hat, trinkt den doppelten Einsatz', switchHtml('lastDouble', s.lastDouble, scope, 'Letzter trinkt doppelt'))
      );
      rows.push(setting('🥈 Platz 2 trinkt nichts', 'Wer auf das zweite Pferd gesetzt hat, kommt ungeschoren davon', switchHtml('secondFree', s.secondFree, scope, 'Platz 2 trinkt nichts')));
    }
    if (!real) {
      rows.push(setting('🃏 Deck', (s.deck === 52 ? '52 Karten – längeres Rennen' : '32 Karten (Skatblatt) – schneller') + later, seg('deck', DECKS, s.deck, (o) => `${o} Karten`, scope, true)));
      rows.push(setting('🛤️ Streckenlänge', `${s.length} verdeckte Streckenkarten${later}`, seg('length', LENGTHS, s.length, String, scope, true)));
      rows.push(setting('⏱ Tempo', SPEED_TEXT[s.speed], seg('speed', SPEEDS, s.speed, (o) => SPEED_LABEL[o], scope)));
      rows.push(setting('📈 Live-Chancen', s.odds ? 'Siegchance jedes Pferdes neben der Bahn' : 'Keine Prozente anzeigen', switchHtml('odds', s.odds, scope, 'Live-Chancen')));
      if (chips)
        rows.push(
          setting(
            '💸 Quoten-Wetten',
            s.oddsBets ? 'Nach der ersten Streckenkarte darf einmal nachgesetzt werden – zu Quoten aus den Live-Chancen' : 'Kein Nachsetzen',
            switchHtml('oddsBets', s.oddsBets, scope, 'Quoten-Wetten')
          )
        );
    }
    if (s.input === 'phones') rows.push(setting('🤫 Geheime Wetten', s.secretBets ? 'Erst beim Start sieht man, wer worauf gesetzt hat' : 'Alle sehen die Wetten', switchHtml('secretBets', s.secretBets, scope, 'Geheime Wetten')));
    rows.push(
      setting(
        '🏁 Rennen',
        s.races ? `Nach ${s.races} Rennen gibt es ${chips ? 'die Siegerehrung' : 'die Rangliste'}` : 'Endlos – Rangliste über das Menü',
        seg('races', RACES, s.races, racesLabel, scope, true)
      )
    );
    return `<div class="settings">${rows.join('')}</div>`;
  }

  function summaryText(s) {
    const parts = [INPUT[s.input].label, isChips(s) ? '🪙 Chips' : `🍺 × ${s.payout}`];
    if (s.input !== 'real') parts.push(`${s.deck} Karten`, `${s.length} Reihen`);
    if (s.races) parts.push(`${s.races} Rennen`);
    if (s.secretBets && s.input === 'phones') parts.push('🤫 geheim');
    return parts.join(' · ');
  }

  function countdownHtml() {
    const c = ui.countdown;
    return `<div class="countdown" role="status"><b id="cd-${esc(c)}">${c === 0 ? 'Los!' : c}</b><small>${c === 0 ? '🏇💨' : 'Die Pferde stehen am Start …'}</small></div>`;
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
            <small>${INPUT[st.settings.input || 'single'].label} · ${st.players.length} Personen · Rennen ${st.raceNo}</small></button>
          <button class="icon-btn" data-act="discard-stage" title="Spielstand löschen" aria-label="Spielstand löschen">✕</button>
        </div>`);
    }
    if (saves.client) {
      resume.push(`
        <div class="resume">
          <button class="btn btn-ghost btn-wide" data-act="resume-client">▶ Zurück ins Rennen
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
    return `
    <div class="screen home">
      <a class="btn btn-ghost btn-small hub-back" href="../">← Alle Spiele</a>
      <div class="home-hero">
        ${logoHtml()}
        <p class="tagline">Die vier Asse sind die Pferde. Setzen, Karte für Karte aufdecken, mitfiebern –<br>wer auf den Sieger gesetzt hat, verteilt.</p>
        <div class="home-aces" aria-hidden="true">${SUITS.map((s) => aceHtml(s)).join('')}</div>
      </div>
      ${resume.join('')}
      <div class="mode-cards">${modeCard('single')}${modeCard('phones')}${modeCard('real')}</div>
      <div class="home-links">
        <button class="btn btn-ghost" data-act="join-screen">📱 Mit dem Handy beitreten</button>
        <button class="btn btn-link" data-act="rules">📖 Spielregeln</button>
      </div>
      <p class="home-foot">${MIN_PLAYERS}–${MAX_PLAYERS} Personen · 52 oder 32 Karten · 🪙 auch alkoholfrei mit Chips</p>
    </div>`;
  }

  /* ---------- Spiel anlegen ---------- */

  function filledNames() {
    return ui.setup.players.map((n) => n.trim()).filter(Boolean);
  }

  function setupHtml() {
    const s = ui.setup;
    const st = s.settings;
    const phones = st.input === 'phones';
    const card = (id) => `
      <button class="input-card ${st.input === id ? 'on' : ''}" data-act="set" data-key="input" data-value="${id}" data-scope="setup" aria-pressed="${st.input === id}">
        <span class="input-icon">${INPUT[id].icon}</span>
        <b>${INPUT[id].label}</b>
        <small>${INPUT[id].text}</small>
      </button>`;
    const minRows = phones ? 1 : MIN_PLAYERS;
    const names = s.players
      .map(
        (p, i) => `
        <div class="player-row">
          <span class="player-num">${i + 1}</span>
          <input class="input" type="text" maxlength="24" placeholder="${phones ? 'Name (ohne Handy)' : 'Name'}" value="${esc(p)}"
            data-field="player-name" data-player="${i}" autocomplete="off" enterkeyhint="next" />
          ${s.players.length > minRows ? `<button class="icon-btn" data-act="remove-player" data-player="${i}" aria-label="Person entfernen">✕</button>` : ''}
        </div>`
      )
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
        <h2>Spielweise</h2>
        <div class="input-cards">${card('single')}${card('phones')}${card('real')}</div>
      </section>
      <section class="panel">
        <h2>Wer wettet mit? <small class="muted">${
          phones ? '(Handys tragen sich gleich selbst ein – hier nur, wer kein Handy hat)' : `(${MIN_PLAYERS}–${MAX_PLAYERS} Personen)`
        }</small></h2>
        <div class="ts-players">${names}</div>
        ${s.players.length < MAX_PLAYERS ? `<button class="btn btn-small btn-ghost add-player" data-act="add-player">＋ Person</button>` : ''}
      </section>
      <section class="panel">
        <h2>Einstellungen</h2>
        ${settingsHtml(st, 'setup', false)}
      </section>
      <div class="sticky-start">
        <button class="btn btn-primary btn-big" data-act="create-game">${phones ? 'Raum öffnen 📱' : 'Ab ins Wettbüro 🎟️'}</button>
      </div>
    </div>`;
  }

  /* ---------- Beitreten (Handy) ---------- */

  function joinHtml() {
    return `
    <div class="screen join">
      <header class="screen-head">
        <button class="btn btn-ghost btn-small" data-act="home">← Zurück</button>
        <h1>Mitwetten</h1>
        <span></span>
      </header>
      <div class="join-hero">${logoHtml(true)}</div>
      ${ui.error ? `<div class="alert">${esc(ui.error)}</div>` : ''}
      <form class="panel" data-form="join">
        <label class="label" for="name-input">Dein Name</label>
        <input id="name-input" class="input input-big" type="text" maxlength="24" placeholder="z.B. Alex" value="${esc(ui.name)}" data-field="name" autocomplete="nickname" enterkeyhint="next" />
        <label class="label" for="code-input">Raum-Code <small class="muted">(steht auf der Rennbahn)</small></label>
        <input id="code-input" class="input input-code" type="text" maxlength="8" placeholder="ABCDE" value="${esc(ui.joinCode)}" data-field="join-code" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" />
        <button class="btn btn-primary btn-wide btn-big" type="submit">Beitreten</button>
      </form>
      <p class="muted small center">Steht dein Name schon auf der Rennbahn, gib ihn genauso ein – dann bist du gleich zugeordnet.</p>
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

  /** device = Ein Gerät / Echte Karten · stage = Rennbahn mit Handys · phone = Handy */
  function kindOf(v) {
    if (!v.me.stage) return 'phone';
    return v.settings.input === 'phones' ? 'stage' : 'device';
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

  function statusBanner() {
    if (ui.ctrl && ui.ctrl.mode === 'client' && (ui.status === 'reconnecting' || ui.status === 'connecting')) {
      return `<div class="status-banner"><span class="spinner-sm"></span> Verbindung zur Rennbahn unterbrochen – verbinde neu…</div>`;
    }
    return '';
  }

  function gameHtml(v) {
    const kind = kindOf(v);
    let main;
    if (kind === 'phone') main = phoneHtml(v);
    else if (v.phase === 'lobby') main = lobbyHtml(v);
    else if (v.phase === 'betting') main = bettingHtml(v, kind);
    else if (v.phase === 'racing' && !v.race) main = realHtml(v);
    else if (v.phase === 'racing' || (v.phase === 'payout' && ui.hold)) main = racingHtml(v, kind);
    else if (v.phase === 'payout') main = payoutHtml(v, kind);
    else main = endHtml(v);
    const total = v.settings.races;
    const title = v.phase === 'end' ? 'Rennabend' : v.phase === 'lobby' ? 'Lobby' : `Rennen ${v.raceNo}${total ? ' / ' + total : ''}`;
    const info = `<b>${title}</b><small>${PHASE_LABEL[v.phase]}</small>`;
    // Während des Zieleinlaufs sieht die Seite noch wie das Rennen aus
    const look = v.phase === 'payout' && ui.hold ? 'racing' : v.phase;
    const room = v.room && v.room.code && v.me.host ? `<button class="pill pill-room" data-act="show-qr" title="Handys verbinden">📱 ${esc(v.room.code)}</button>` : '';
    const me = kind === 'phone' && v.me.name ? `<span class="g-me">${esc(v.me.name)}${isChips(v.settings) && myPlayer(v) ? ` · 🪙 ${myPlayer(v).chips}` : ''}</span>` : '';
    return `
      <div class="game kind-${kind} phase-${look}">
        <header class="g-top">
          <button class="g-brand" data-act="menu" aria-label="Menü">${logoHtml(true)}</button>
          <div class="g-info">${info}</div>
          ${room}${me}
          <div class="g-actions">
            ${kind !== 'phone' ? `<button class="icon-btn" data-act="mute" aria-label="Ton an/aus" title="Ton an/aus">${Sound.muted ? '🔇' : '🔊'}</button>` : ''}
            <button class="icon-btn" data-act="menu" aria-label="Menü" title="Menü">☰</button>
          </div>
        </header>
        ${statusBanner()}
        <main class="g-main">${main}</main>
      </div>`;
  }

  /* ---------- Lobby (Mit Handys) ---------- */

  function playerChipsHtml(v, removable) {
    return v.players
      .map(
        (p) => `<span class="chip ${p.online ? '' : 'is-offline'}">${p.phone ? '<span aria-label="mit Handy">📱</span> ' : ''}${esc(p.name)}${
          removable ? `<button class="chip-x" data-act="remove-player-live" data-player="${esc(p.id)}" aria-label="${esc(p.name)} entfernen">✕</button>` : ''
        }</span>`
      )
      .join('');
  }

  function lobbyHtml(v) {
    return `
      <div class="lobby-grid">
        <section class="panel join-panel">
          <h2>📱 Handys verbinden</h2>
          <p class="muted">QR-Code scannen und Namen eingeben.</p>
          ${roomBoxHtml(v.room, true)}
        </section>
        <div class="lobby-side">
          <section class="panel">
            <div class="row-between"><h2>Wer wettet mit? <small class="muted">(${v.players.length})</small></h2><button class="btn btn-ghost btn-small" data-act="people">👥 Bearbeiten</button></div>
            <div class="chips">${playerChipsHtml(v, true) || '<span class="muted">Noch niemand da – QR-Code scannen!</span>'}</div>
          </section>
          <section class="panel">
            <div class="row-between"><h2>Einstellungen</h2><button class="btn btn-ghost btn-small" data-act="settings">⚙️ Ändern</button></div>
            <p class="muted">${esc(summaryText(v.settings))}</p>
          </section>
          <div class="sticky-start">
            <button class="btn btn-primary btn-big" data-act="open" ${v.lobbyProblem ? 'disabled' : ''}>Ab ins Wettbüro 🎟️</button>
            ${v.lobbyProblem ? `<p class="muted small center">${esc(v.lobbyProblem)}</p>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ---------- Wettbüro ---------- */

  function maxBetOf(v, p) {
    return isChips(v.settings) ? p.chips : v.settings.maxBet;
  }

  function bettingHtml(v, kind) {
    const st = v.settings;
    const chips = isChips(st);
    const by = bettors(v);
    const sum = SUITS.map((s) => {
      const n = by[s].length;
      const total = v.players.reduce((t, p) => t + (v.bets[p.id] && v.bets[p.id].suit === s ? v.bets[p.id].amount : 0), 0);
      return `<div class="odds-tile" style="--sc:${SUIT_COLOR[s]}">
          ${aceHtml(s)}
          <div><b>${suitName(s)}</b><small>${n ? `${n} ${plural(n, 'Wette', 'Wetten')} · ${total} ${icon(st)}` : 'noch keine Wette'}</small></div>
        </div>`;
    }).join('');
    const cards = v.players
      .map((p) => {
        const b = v.bets[p.id];
        const max = maxBetOf(v, p);
        const status = kind === 'stage' && p.phone ? `<span class="bet-phone ${p.online ? '' : 'is-off'}">📱${p.online ? '' : ' offline'}</span>` : '';
        const balance = chips ? `<span class="bet-chips">🪙 ${p.chips}</span>` : '';
        if (b && b.hidden) {
          return `<div class="bet-card is-set is-secret">
              <div class="bet-name">${esc(p.name)} ${status}</div>
              <div class="bet-secret">🤫 hat gesetzt</div>
              ${balance}
            </div>`;
        }
        const suits = SUITS.map(
          (s) =>
            `<button class="suit-btn ${b && b.suit === s ? 'on' : ''} ${Cards.SUIT[s].red ? 'is-red' : ''}" style="--sc:${SUIT_COLOR[s]}" data-act="bet" data-player="${esc(p.id)}" data-suit="${s}" aria-pressed="${!!(b && b.suit === s)}" aria-label="${esc(p.name)} setzt auf ${suitName(s)}" ${max < 1 ? 'disabled' : ''}>${suitSym(s)}</button>`
        ).join('');
        const amount = b
          ? `<div class="bet-amount">
              <button class="icon-btn icon-small" data-act="amount" data-player="${esc(p.id)}" data-delta="-1" ${b.amount <= 1 ? 'disabled' : ''} aria-label="Weniger">−</button>
              <b>${b.amount}</b><span>${icon(st)}</span>
              <button class="icon-btn icon-small" data-act="amount" data-player="${esc(p.id)}" data-delta="1" ${b.amount >= max ? 'disabled' : ''} aria-label="Mehr">＋</button>
              ${chips && b.amount < max ? `<button class="btn btn-ghost btn-small" data-act="all-in" data-player="${esc(p.id)}">All-in</button>` : ''}
            </div>`
          : `<div class="bet-amount is-empty">${p.phone && kind === 'stage' ? 'wählt auf dem Handy …' : 'Pferd wählen'}</div>`;
        return `<div class="bet-card ${b ? 'is-set' : ''}" style="--sc:${b ? SUIT_COLOR[b.suit] : 'transparent'}">
            <div class="bet-name">${esc(p.name)} ${status}</div>
            <div class="bet-suits">${suits}</div>
            ${amount}
            ${balance}
          </div>`;
      })
      .join('');
    const missing = v.missing.map((id) => pname(v, id));
    const tools = [];
    if (v.hasLastBets) tools.push(`<button class="btn btn-ghost btn-small" data-act="same-bets">🔁 Gleiche Wette wie letztes Rennen</button>`);
    if (missing.length) tools.push(`<button class="btn btn-ghost btn-small" data-act="random-bets">🎲 ${missing.length === v.players.length ? 'Alle' : 'Rest'} zufällig</button>`);
    const anyBet = Object.keys(v.bets).length > 0;
    const canStart = kind === 'stage' ? anyBet : !missing.length;
    const rule = chips
      ? `Setzt Chips auf ein Pferd (mindestens 1, höchstens alle eigenen). Sieger bekommen den Einsatz × ${CHIPS_PAYOUT} zurück.`
      : `Jede Person wählt ein Pferd und setzt 1–${st.maxBet} Schlucke. Sieger verteilen Einsatz × ${st.payout}, alle anderen trinken.`;
    return `
      <div class="bet-wrap">
        <div class="bet-head">
          <h1>🎟️ Wettbüro</h1>
          <p class="muted">${rule}${kind === 'stage' ? ' Setzen geht am Handy – für Personen ohne Handy hier.' : ''}</p>
        </div>
        <div class="odds">${sum}</div>
        ${tools.length ? `<div class="bet-tools">${tools.join('')}</div>` : ''}
        <div class="bet-grid">${cards}</div>
        <div class="sticky-start">
          <button class="btn btn-primary btn-big" data-act="start" ${canStart ? '' : 'disabled'}>Start! 🏁</button>
          ${missing.length ? `<p class="muted small center">Noch ohne Pferd: ${esc(joinNames(missing))}</p>` : ''}
        </div>
      </div>`;
  }

  /* ---------- Echte Karten: Ergebnis eintragen ---------- */

  function realHtml(v) {
    const st = v.settings;
    const need = !isChips(st) && (st.lastDouble || st.secondFree) ? 3 : 1;
    const order = ui.realOrder;
    const done = order.length >= need;
    const by = bettors(v);
    const btns = SUITS.map((s) => {
      const place = order.indexOf(s) + 1;
      return `<button class="real-btn ${place ? 'on' : ''}" style="--sc:${SUIT_COLOR[s]}" data-act="real-pick" data-suit="${s}" ${place || done ? 'disabled' : ''}>
          ${aceHtml(s)}
          <b>${place ? place + '.' : suitName(s)}</b>
          <small>${by[s].length ? esc(by[s].join(', ')) : 'keine Wette'}</small>
        </button>`;
    }).join('');
    const hint = !order.length ? 'Welches Pferd hat gewonnen?' : !done ? `Und Platz ${order.length + 1}?` : 'Ergebnis eintragen?';
    return `
      <div class="real">
        <div class="bet-head">
          <h1>🃏 Rennen am Tisch</h1>
          <p class="muted">Deckt die Karten am Tisch auf. Wenn das Rennen vorbei ist, hier antippen.</p>
        </div>
        <h2 class="center">${hint}</h2>
        <div class="real-grid">${btns}</div>
        <div class="host-bar">
          <button class="btn btn-primary btn-big" data-act="real-confirm" ${done ? '' : 'disabled'}>🏆 Abrechnen</button>
          ${order.length ? `<button class="btn btn-ghost" data-act="real-reset">↩️ Neu antippen</button>` : ''}
        </div>
      </div>`;
  }

  /* ---------- Rennbahn ---------- */

  /** Karte zum Umdrehen (3D): Rückseite, bis `open` – dann dreht sie sich zur Vorderseite */
  function flipHtml(card, open, cls, id) {
    return `<span class="flip ${open ? 'is-open' : ''} ${cls || ''}" ${id ? `id="${id}"` : ''}>
      <span class="flip-inner">
        <span class="flip-side flip-back">${cardHtml(null)}</span>
        <span class="flip-side flip-face">${open && card ? cardHtml(card) : ''}</span>
      </span>
    </span>`;
  }

  /** Live-Chance mit Pfeil (gestiegen/gefallen) */
  function chanceHtml(r, s) {
    if (!r.odds) return '';
    const p = r.odds[s];
    const prev = r.oddsPrev ? r.oddsPrev[s] : null;
    const d = prev == null ? 0 : p - prev;
    const arrow = d > 0.015 ? '<i class="up">▲</i>' : d < -0.015 ? '<i class="down">▼</i>' : '';
    return `<div class="lane-odds"><b>${pct(p)}</b>${arrow}</div>`;
  }

  function boardHtml(v) {
    const r = v.race;
    const L = r.length;
    const by = bettors(v);
    const moved = new Set(r.events.filter((e) => e.type === 'move').map((e) => e.suit));
    const back = new Set(r.events.filter((e) => e.type === 'track' && e.to < e.from).map((e) => e.suit));
    const revealed = new Set(r.events.filter((e) => e.type === 'track').map((e) => e.row));
    const run = !r.winner && !v.paused && !v.oddsWin && v.settings.speed !== 'tap' && ui.countdown == null && r.tick > 0;
    const odds = !!r.odds;
    const rows = [];
    for (let i = 1; i <= L; i++) rows.push(i);
    const head = `
      <div class="lane lane-head">
        <div class="lane-label"></div>
        <div class="lane-run">
          <div class="cell cell-start"><small>Start</small></div>
          ${rows
            .map((i) => {
              const drama = revealed.has(i) && back.size ? 'is-drama' : '';
              return `<div class="cell cell-track ${drama}">${flipHtml(r.track[i - 1], !!r.track[i - 1])}<small>${i}</small></div>`;
            })
            .join('')}
          <div class="cell cell-finish"><span aria-hidden="true">🏁</span><small>Ziel</small></div>
        </div>
        ${odds ? '<div class="lane-odds lane-odds-head"><small>Chance</small></div>' : ''}
      </div>`;
    const lanes = SUITS.map((s, k) => {
      const names = by[s];
      const place = r.ranking.indexOf(s) + 1;
      const close = !r.winner && r.pos[s] === L;
      const cls = [
        r.winner === s ? 'is-winner' : '',
        r.winner && r.winner !== s ? 'is-loser' : '',
        moved.has(s) ? 'is-moved' : '',
        back.has(s) ? 'is-back' : '',
        close ? 'is-close' : '',
        !r.winner && place === 1 && r.pos[s] > 0 ? 'is-leader' : '',
      ]
        .filter(Boolean)
        .join(' ');
      // Neue id bei jeder Bewegung → morphdom ersetzt das Element und die Sprung-Animation startet neu
      const key = `${s}-${r.at[s]}`;
      return `
        <div class="lane lane-horse ${cls}" style="--sc:${SUIT_COLOR[s]}; --d:${k * -0.13}s">
          <div class="lane-label">
            <span class="lane-suit ${Cards.SUIT[s].red ? 'is-red' : ''}">${suitSym(s)}${r.tick ? `<b class="lane-place">${place}</b>` : ''}</span>
            <span class="lane-names">${names.length ? esc(names.join(', ')) : '<i>keine Wette</i>'}</span>
          </div>
          <div class="lane-run">
            <div class="cell cell-start"></div>
            ${rows.map(() => '<div class="cell"></div>').join('')}
            <div class="cell cell-finish"></div>
            <div class="horse" id="horse-${s}" style="--pos:${r.pos[s]}">
              <span class="horse-body">
                <span class="horse-card" id="ace-${key}">${aceHtml(s)}</span>
              </span>
              ${moved.has(s) && !back.has(s) ? `<span class="dust" id="dust-${key}" aria-hidden="true"><i>💨</i><i>💨</i></span>` : ''}
              ${moved.has(s) || back.has(s) ? `<span class="horse-fx ${back.has(s) ? 'fx-back' : 'fx-move'}" id="fx-${s}-${r.tick}" aria-hidden="true"></span>` : ''}
            </div>
          </div>
          ${chanceHtml(r, s)}
        </div>`;
    }).join('');
    const tap = v.settings.speed === 'tap' && !r.winner && !v.oddsWin;
    return `<div class="board ${tap ? 'is-tap' : ''} ${run ? 'is-running' : ''} ${odds ? 'has-odds' : ''}" style="--cols:${L + 2}; --gait:${GAIT_MS[v.settings.speed]}ms" ${
      tap ? 'data-tap role="button" tabindex="0" aria-label="Nächste Karte"' : ''
    }>${head}${lanes}</div>`;
  }

  /** Was die letzte Karte genau bewirkt hat (klein unter der Schlagzeile) */
  function detailsHtml(r) {
    const lines = [];
    for (const e of r.events) {
      if (e.type === 'reshuffle') lines.push('🔀 Stapel neu gemischt');
      else if (e.type === 'move') lines.push(e.to > r.length ? `${suitSym(e.suit)} ${suitName(e.suit)} im Ziel` : `${suitSym(e.suit)} ${suitName(e.suit)} → Reihe ${e.to}`);
      else if (e.type === 'track') {
        const l = Cards.label(e.card);
        lines.push(`Reihe ${e.row}: ${l.symbol} ${l.rank} – ${suitName(e.suit)} ${e.to < e.from ? 'zurück auf ' + (e.to ? 'Reihe ' + e.to : 'Start') : 'bleibt'}`);
      }
    }
    return lines.join(' · ');
  }

  function commentaryHtml(r) {
    if (!r.tick) return `<p class="say say-info">Die Pferde stehen am Start …</p>`;
    const say = r.say || { mood: 'info', text: '' };
    return `<p class="say say-${esc(say.mood)}" id="say-${r.tick}">${esc(say.text)}</p><p class="say-details">${esc(detailsHtml(r))}</p>`;
  }

  /** Quoten-Wetten am Gerät: für jede Person (Ein Gerät) bzw. für Personen ohne Handy */
  function oddsPanelHtml(v, kind) {
    const w = v.oddsWin;
    const quotes = SUITS.map(
      (s) => `<div class="quote" style="--sc:${SUIT_COLOR[s]}">${aceHtml(s)}<b>${quoteText(w.quotes[s])}</b><small>${v.race.odds ? pct(v.race.odds[s]) : ''}</small></div>`
    ).join('');
    const rows = v.players
      .map((p) => {
        const done = w.bets[p.id];
        const left = w.left[p.id] || 0;
        if (done) {
          const txt = done.skip ? (left < 1 ? 'nichts übrig' : 'setzt aus') : `${suitSym(done.suit)} ${done.amount} 🪙 ${quoteText(done.odds)}`;
          return `<div class="odds-row is-done"><b>${esc(p.name)}</b><span>✓ ${txt}</span></div>`;
        }
        if (kind === 'stage' && p.phone) return `<div class="odds-row"><b>${esc(p.name)}</b><span class="muted">📱 überlegt …</span></div>`;
        const sel = ui.oddsSel[p.id] || {};
        const amount = Math.min(left, sel.amount || 1);
        const suits = SUITS.map(
          (s) =>
            `<button class="suit-btn suit-sm ${sel.suit === s ? 'on' : ''} ${Cards.SUIT[s].red ? 'is-red' : ''}" style="--sc:${SUIT_COLOR[s]}" data-act="odds-pick" data-player="${esc(p.id)}" data-suit="${s}">${suitSym(s)}</button>`
        ).join('');
        return `<div class="odds-row">
            <b>${esc(p.name)} <small class="muted">(🪙 ${left} frei)</small></b>
            <div class="odds-pick">${suits}
              <button class="icon-btn icon-small" data-act="odds-amount" data-player="${esc(p.id)}" data-delta="-1" ${amount <= 1 ? 'disabled' : ''}>−</button>
              <b>${amount}</b>
              <button class="icon-btn icon-small" data-act="odds-amount" data-player="${esc(p.id)}" data-delta="1" ${amount >= left ? 'disabled' : ''}>＋</button>
              <button class="btn btn-primary btn-small" data-act="odds-set" data-player="${esc(p.id)}" ${sel.suit ? '' : 'disabled'}>Setzen</button>
              <button class="btn btn-ghost btn-small" data-act="odds-skip" data-player="${esc(p.id)}">Aussetzen</button>
            </div>
          </div>`;
      })
      .join('');
    return `<section class="panel odds-panel">
        <div class="row-between"><h2>💸 Nachsetzen zu Quoten</h2><button class="btn btn-primary" data-act="close-odds">Weiter ▶</button></div>
        <p class="muted small">Die erste Streckenkarte ist offen. Wer will, setzt noch einmal auf ein Pferd – gewinnt es, gibt es Einsatz × Quote zurück.</p>
        <div class="quotes">${quotes}</div>
        <div class="odds-rows">${rows}</div>
      </section>`;
  }

  function racingHtml(v, kind) {
    const r = v.race;
    if (!r) return '';
    const tap = v.settings.speed === 'tap';
    let controls;
    if (r.winner) {
      controls = `<button class="btn btn-primary btn-big" data-act="skip-hold">Zur Abrechnung ▶</button>`;
    } else if (v.oddsWin) {
      controls = `<button class="btn btn-primary btn-big" data-act="close-odds">Weiter ▶</button>`;
    } else {
      const speeds = SPEEDS.map(
        (s) =>
          `<button class="seg-btn ${v.settings.speed === s ? 'on' : ''}" data-act="set" data-key="speed" data-value="${s}" data-scope="live" aria-pressed="${v.settings.speed === s}" title="${esc(SPEED_TEXT[s])}" aria-label="${esc(SPEED_LABEL[s].slice(SPEED_LABEL[s].indexOf(' ') + 1))}"><span class="sp-icon">${SPEED_LABEL[s].split(' ')[0]}</span><span class="sp-text"> ${SPEED_LABEL[s].split(' ')[1]}</span></button>`
      ).join('');
      const main = tap
        ? `<button class="btn btn-primary btn-big" data-act="draw">🃏 Nächste Karte</button>`
        : `<button class="btn ${v.paused ? 'btn-primary' : 'btn-ghost'} btn-big" data-act="pause">${v.paused ? '▶ Weiter' : '⏸ Pause'}</button>`;
      controls = `${main}<div class="seg seg-speed" role="group" aria-label="Tempo">${speeds}</div>`;
    }
    let banner = '';
    if (ui.photo) banner = `<div class="win-banner photo-banner">📸 FOTOFINISH!</div>`;
    else if (r.winner) banner = `<div class="win-banner" style="--sc:${SUIT_COLOR[r.winner]}">🏆 ${suitSym(r.winner)} ${suitName(r.winner).toUpperCase()} GEWINNT! 🏆</div>`;
    else if (v.paused && !v.oddsWin) banner = `<div class="pause-banner">⏸ Pausiert</div>`;
    return `
      <div class="race ${ui.photo ? 'is-photo' : ''}">
        ${banner}
        ${ui.photo ? '<div class="photo-flash" aria-hidden="true"></div>' : ''}
        ${boardHtml(v)}
        ${v.oddsWin && !r.winner ? `<div class="overlay odds-overlay">${oddsPanelHtml(v, kind)}</div>` : ''}
        <div class="race-foot">
          <div class="deal">
            <div class="pile" title="Karten im Stapel">${cardHtml(null)}${cardHtml(null, 'pile-top')}<b>${r.left}</b></div>
            <div class="drawn-card">${flipHtml(r.last, !!r.last, r.last ? 'is-dealt' : '', 'drawn-' + r.tick)}</div>
          </div>
          <div class="commentary" aria-live="polite">${commentaryHtml(r)}</div>
          <div class="race-ctrl">${controls}${tap && !r.winner && !v.oddsWin ? '<small class="muted">Leertaste oder auf die Bahn tippen</small>' : ''}</div>
        </div>
      </div>`;
  }

  /* ---------- Abrechnung ---------- */

  function placesHtml(res) {
    return res.ranking
      .map((s, i) => `<div class="place place-${i + 1}" style="--sc:${SUIT_COLOR[s]}"><span class="place-no">${i + 1}.</span>${aceHtml(s)}<b>${suitName(s)}</b></div>`)
      .join('');
  }

  /** Erhaltene Schlucke: „3 von Anna, 2 von Ben“ */
  function receivedText(v, id) {
    const from = v.give && v.give.received[id];
    if (!from) return { n: 0, text: '' };
    const parts = Object.entries(from).map(([g, n]) => `${n} von ${pname(v, g)}`);
    return { n: Object.values(from).reduce((a, b) => a + b, 0), text: parts.join(', ') };
  }

  function giveListText(v, giverId) {
    const g = v.give && v.give.givers[giverId];
    if (!g) return '';
    const parts = Object.entries(g.to).map(([t, n]) => `${pname(v, t)} ${n}`);
    return parts.join(' · ');
  }

  function payoutHtml(v, kind) {
    const res = v.result;
    if (!res) return '';
    const w = res.winner;
    const chips = isChips(v.settings);
    const hero = `
      <div class="payout-hero" style="--sc:${SUIT_COLOR[w]}">
        ${aceHtml(w)}
        <div>
          <h1>🏆 ${suitName(w)} gewinnt!</h1>
          <p class="muted">${res.photo ? '<span class="badge-photo">📸 Fotofinish</span> ' : ''}Rennen ${res.no}${res.draws ? ` · ${res.draws} Karten aufgedeckt` : ' · am Tisch'}</p>
          ${res.say && res.say.text ? `<p class="payout-say">„${esc(res.say.text)}“</p>` : ''}
        </div>
      </div>`;
    let body;
    if (chips) {
      const lines = res.lines
        .slice()
        .sort((a, b) => b.delta - a.delta)
        .map((l) => {
          const extra = l.extra ? `<small>💸 Quote ${suitSym(l.extra.suit)} ${quoteText(l.extra.odds)}: ${signed(l.extra.delta)}</small>` : '';
          return `<li class="pay-line ${l.delta > 0 ? 'pay-give' : 'pay-drink'}"><span>${l.delta > 0 ? '💰' : '📉'} <b>${esc(l.name)}</b> <span class="muted">${l.before} → ${l.after} 🪙</span>${extra}</span><b class="pay-n">${signed(l.delta)}</b></li>`;
        })
        .join('');
      body = `<section class="panel"><h2>🪙 Chips</h2><ul class="pay-list">${lines || '<li class="pay-line pay-none">Niemand hat gesetzt.</li>'}</ul></section>`;
    } else {
      const givers = res.lines.filter((l) => l.give);
      const drinkers = res.lines.filter((l) => !l.give);
      const tracked = !!v.give;
      const giveHtml = givers.length
        ? givers
            .map((l) => {
              const g = tracked && v.give.givers[l.id];
              const p = v.players.find((x) => x.id === l.id);
              const list = g ? giveListText(v, l.id) : '';
              const status = g ? (g.left ? `<small>💭 verteilt noch … ${g.left} übrig${list ? ' · ' + esc(list) : ''}</small>` : `<small>✓ ${esc(list)}</small>`) : '';
              const btn = g && kind !== 'phone' && g.left && (!p || !p.phone || !p.online) ? `<button class="btn btn-ghost btn-small" data-act="give-for" data-player="${esc(l.id)}">Für ${esc(l.name)} verteilen</button>` : '';
              return `<li class="pay-line pay-give"><span>🎁 <b>${esc(l.name)}</b> verteilt ${status}</span>${btn}<b class="pay-n">${l.give}</b></li>`;
            })
            .join('')
        : `<li class="pay-line pay-none">Niemand hat auf ${suitName(w)} gesetzt – alle trinken! 🍺</li>`;
      // Wer trinkt: eigener Einsatz + verteilte Schlucke
      const ids = new Set(drinkers.map((l) => l.id));
      if (tracked) for (const id of Object.keys(v.give.received)) ids.add(id);
      const drinkRows = [...ids]
        .map((id) => {
          const l = res.lines.find((x) => x.id === id) || { id, name: pname(v, id), drink: 0, give: 0 };
          const rec = receivedText(v, id);
          return { l, rec, total: l.drink + rec.n };
        })
        .sort((a, b) => b.total - a.total)
        .map(({ l, rec, total }) => {
          const note = l.note === 'second' ? '<small>🥈 Platz 2 – trinkt nichts</small>' : l.note === 'last' ? '<small>⬇️ Letzter – doppelt</small>' : '';
          const recNote = rec.n ? `<small>${l.drink ? `${l.drink} Einsatz + ` : ''}${esc(rec.text)}</small>` : '';
          return `<li class="pay-line ${total ? 'pay-drink' : 'pay-free'}"><span>${total ? '🍺' : '😇'} <b>${esc(l.name)}</b> ${total ? 'trinkt' : ''} ${note}${recNote}</span><b class="pay-n">${total}</b></li>`;
        })
        .join('');
      body = `
        <section class="panel">
          <h2>🎁 Verteilen</h2>
          <ul class="pay-list">${giveHtml}</ul>
          ${givers.length ? `<p class="muted small">${tracked ? 'Gewinner tippen auf dem Handy an, wer trinkt – nicht sich selbst.' : 'Sagt laut, an wen ihr die Schlucke verteilt – beliebig aufteilen, nur nicht an euch selbst.'}</p>` : ''}
        </section>
        ${drinkRows ? `<section class="panel"><h2>🍺 Trinken</h2><ul class="pay-list">${drinkRows}</ul></section>` : ''}`;
    }
    return `
      <div class="payout">
        ${hero}
        <div class="places">${placesHtml(res)}</div>
        <div class="pay-grid">${body}</div>
        <div class="host-bar">
          <button class="btn btn-primary btn-big" data-act="next">${v.seriesOver ? (chips ? '🏆 Zur Siegerehrung' : '🏆 Zur Rangliste') : '🔁 Nächstes Rennen'}</button>
          <button class="btn btn-ghost" data-act="standings">📊 Statistik</button>
        </div>
      </div>`;
  }

  /* ---------- Statistik & Rangliste ---------- */

  function awardsHtml(v) {
    if (!v.awards.length) return '';
    return `<div class="awards">${v.awards
      .map(
        (a) => `<div class="award award-${esc(a.id)}">
          <span class="award-icon" aria-hidden="true">${a.icon}</span>
          <div><small>${esc(a.title)}</small><b>${esc(joinNames(a.names))}</b><span>${esc(a.text)}</span></div>
        </div>`
      )
      .join('')}</div>`;
  }

  function statsHtml(v) {
    if (!v.history.length) return '<p class="muted">Noch kein Rennen gelaufen.</p>';
    const chips = isChips(v.settings);
    // Gleicher Stand = gleicher Platz
    const same = chips ? (a, b) => a.chips === b.chips : (a, b) => a.stats.given === b.stats.given && a.stats.drank === b.stats.drank;
    const rows = v.standings
      .map((p, i, all) => [p, all.findIndex((q) => same(p, q))])
      .map(
        ([p, i]) => `<tr>
          <td class="st-rank">${['🥇', '🥈', '🥉'][i] || i + 1 + '.'}</td>
          <td class="st-name">${esc(p.name)}</td>
          ${chips ? `<td><b>${p.chips}</b></td>` : ''}
          <td>${p.stats.given}</td>
          <td>${p.stats.drank}</td>
          <td>${p.stats.wins}<small>/${p.stats.races}</small></td>
          <td>${p.stats.staked}</td>
        </tr>`
      )
      .join('');
    const head = chips
      ? '<th title="Chips">🪙</th><th title="gewonnen">💰</th><th title="verloren">📉</th>'
      : '<th title="verteilt">🎁</th><th title="getrunken">🍺</th>';
    const legend = chips
      ? '🪙 Chips · 💰 gewonnen · 📉 verloren · 🎯 richtig getippt · 🎰 gesetzt'
      : '🎁 verteilt · 🍺 getrunken (inkl. verteilter Schlucke, wenn per Handy verteilt) · 🎯 richtig getippt · 🎰 gesetzt';
    const horses = v.horses
      .map(
        (h) => `<div class="horse-win" style="--sc:${SUIT_COLOR[h.suit]}">${aceHtml(h.suit)}
          <div><b>${h.wins}</b> <small>${plural(h.wins, 'Sieg', 'Siege')}</small>
          <span>Ø Platz ${h.avg == null ? '–' : h.avg.toFixed(1).replace('.', ',')}${h.photos ? ` · 📸 ${h.photos}` : ''}</span></div>
        </div>`
      )
      .join('');
    const races = v.history
      .slice()
      .reverse()
      .map((h) => `<span class="race-chip" style="--sc:${SUIT_COLOR[h.winner]}" title="Rennen ${h.no}"><small>${h.no}</small>${suitSym(h.winner)}${h.photo ? ' 📸' : ''}</span>`)
      .join('');
    return `
      ${awardsHtml(v)}
      <h3>🏆 Rangliste</h3>
      <table class="standings">
        <thead><tr><th></th><th class="st-name-h">Name</th>${head}<th title="richtig getippt">🎯</th><th title="gesetzt">🎰</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="muted small">${legend}</p>
      <h3>🐎 Pferde-Bilanz</h3>
      <div class="horse-wins">${horses}</div>
      <h3>🏁 Rennen</h3>
      <div class="race-chips">${races}</div>`;
  }

  /** Siegerehrung im Chips-Modus: Podest */
  function podiumHtml(v) {
    const top = v.standings.slice(0, 3);
    const order = [top[1], top[0], top[2]].filter(Boolean);
    return `<div class="podium">${order
      .map((p) => {
        const place = v.standings.indexOf(p) + 1;
        return `<div class="podium-col podium-${place}">
            <span class="podium-medal">${['🥇', '🥈', '🥉'][place - 1]}</span>
            <b>${esc(p.name)}</b>
            <small>${p.chips} 🪙</small>
            <div class="podium-block">${place}</div>
          </div>`;
      })
      .join('')}</div>`;
  }

  function endHtml(v) {
    const chips = isChips(v.settings);
    return `
      <div class="end">
        <div class="end-hero">
          <div class="end-big" aria-hidden="true">${chips ? '🏆' : '🏁'}</div>
          <h1>${chips ? 'Siegerehrung!' : 'Rennabend vorbei!'}</h1>
          <p class="muted">${v.history.length} Rennen gelaufen · ${v.history.filter((h) => h.photo).length} Fotofinish</p>
        </div>
        ${chips && v.history.length ? podiumHtml(v) : ''}
        <section class="panel">${statsHtml(v)}</section>
        <div class="host-bar">
          <button class="btn btn-primary btn-big" data-act="again">🔁 Nochmal</button>
          <button class="btn btn-ghost" data-act="close-game">🏠 Hauptmenü</button>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Handy                                                               */
  /* ------------------------------------------------------------------ */

  function myPlayer(v) {
    return v.players.find((p) => p.id === v.me.id) || null;
  }

  function phoneHtml(v) {
    const me = myPlayer(v);
    if (!me) {
      return `<div class="look-up">👀<b>Du schaust zu</b><small>Die Runde ist voll oder du wurdest noch nicht eingetragen.</small></div>`;
    }
    switch (v.phase) {
      case 'lobby':
        return `
          <div class="look-up">✅<b>Du bist dabei, ${esc(me.name)}!</b><small>Gleich öffnet das Wettbüro – schau auf die Rennbahn.</small></div>
          <section class="panel"><h2>Wer wettet mit? <small class="muted">(${v.players.length})</small></h2><div class="chips">${playerChipsHtml(v, false)}</div></section>
          <p class="muted small center">${esc(summaryText(v.settings))}</p>`;
      case 'betting':
        return phoneBetHtml(v, me);
      case 'racing':
        return phoneRaceHtml(v, me);
      case 'payout':
        return phonePayoutHtml(v, me);
      default:
        return phoneEndHtml(v, me);
    }
  }

  function phoneBetHtml(v, me) {
    const st = v.settings;
    const b = v.bets[me.id];
    const max = maxBetOf(v, me);
    const chips = isChips(st);
    const horses = SUITS.map(
      (s) => `<button class="ph-horse ${b && b.suit === s ? 'on' : ''}" style="--sc:${SUIT_COLOR[s]}" data-act="bet" data-suit="${s}" aria-pressed="${!!(b && b.suit === s)}" ${max < 1 ? 'disabled' : ''}>
          ${aceHtml(s)}<b>${suitName(s)}</b>
        </button>`
    ).join('');
    const amount = b
      ? `<div class="ph-amount">
          <span>Einsatz</span>
          <button class="icon-btn" data-act="amount" data-delta="-1" ${b.amount <= 1 ? 'disabled' : ''} aria-label="Weniger">−</button>
          <b>${b.amount}</b><span>${icon(st)}</span>
          <button class="icon-btn" data-act="amount" data-delta="1" ${b.amount >= max ? 'disabled' : ''} aria-label="Mehr">＋</button>
          ${chips && b.amount < max ? `<button class="btn btn-ghost btn-small" data-act="all-in">All-in</button>` : ''}
        </div>
        <p class="ph-ok">✓ Wette steht: ${suitSym(b.suit)} ${suitName(b.suit)} · ${unit(st, b.amount)}<small>Ändern geht bis zum Start${st.secretBets ? ' · 🤫 geheim' : ''}</small></p>`
      : `<p class="ph-hint">Tippe auf dein Pferd</p>`;
    return `
      <div class="ph">
        <h2 class="center">🎟️ Rennen ${v.raceNo} · Wetten</h2>
        ${chips ? `<p class="center muted">Du hast 🪙 ${me.chips}</p>` : ''}
        <div class="ph-horses">${horses}</div>
        ${amount}
      </div>`;
  }

  function phoneRaceHtml(v, me) {
    const st = v.settings;
    const b = v.bets[me.id];
    const r = v.race;
    if (!r) {
      return `<div class="look-up">🃏<b>Das Rennen läuft am Tisch</b><small>${b ? `Dein Pferd: ${suitSym(b.suit)} ${suitName(b.suit)}` : 'Du setzt diesmal aus.'}</small></div>`;
    }
    // Nachsetzen zu Quoten
    if (v.oddsWin && !v.oddsWin.done.includes(me.id)) {
      const left = v.oddsWin.left[me.id] || 0;
      const sel = ui.oddsSel[me.id] || {};
      const amount = Math.min(left, sel.amount || 1);
      const btns = SUITS.map(
        (s) => `<button class="ph-horse ph-quote ${sel.suit === s ? 'on' : ''}" style="--sc:${SUIT_COLOR[s]}" data-act="odds-pick" data-player="${esc(me.id)}" data-suit="${s}">
            ${aceHtml(s)}<b>${quoteText(v.oddsWin.quotes[s])}</b><small>${r.odds ? pct(r.odds[s]) : ''}</small>
          </button>`
      ).join('');
      return `
        <div class="ph">
          <h2 class="center">💸 Nachsetzen?</h2>
          <p class="center muted">Die erste Streckenkarte ist offen. Gewinnt dein Pferd, gibt es Einsatz × Quote zurück. Frei: 🪙 ${left}</p>
          <div class="ph-horses">${btns}</div>
          <div class="ph-amount">
            <button class="icon-btn" data-act="odds-amount" data-player="${esc(me.id)}" data-delta="-1" ${amount <= 1 ? 'disabled' : ''}>−</button>
            <b>${amount}</b><span>🪙</span>
            <button class="icon-btn" data-act="odds-amount" data-player="${esc(me.id)}" data-delta="1" ${amount >= left ? 'disabled' : ''}>＋</button>
          </div>
          <div class="ph-actions">
            <button class="btn btn-primary btn-big" data-act="odds-set" data-player="${esc(me.id)}" ${sel.suit ? '' : 'disabled'}>Nachsetzen ✓</button>
            <button class="btn btn-ghost" data-act="odds-skip" data-player="${esc(me.id)}">Aussetzen</button>
          </div>
        </div>`;
    }
    const say = r.say && r.say.text ? `<p class="ph-say say-${esc(r.say.mood)}" id="psay-${r.tick}">${esc(r.say.text)}</p>` : '';
    const waitOdds = v.oddsWin ? `<p class="ph-hint">💸 Die anderen setzen noch nach …</p>` : '';
    if (!b) {
      const lead = r.ranking[0];
      return `<div class="ph ph-race">
          <p class="ph-hint">Du setzt diesmal aus – vorn liegt:</p>
          <div class="ph-big">${aceHtml(lead)}</div>
          <p class="center"><b>${suitName(lead)}</b> · Reihe ${Math.min(r.pos[lead], r.length)} / ${r.length}</p>
          ${say}${waitOdds}
          <p class="muted small center">👀 Schau auf den Laptop</p>
        </div>`;
    }
    const s = b.suit;
    const place = r.ranking.indexOf(s) + 1;
    const pos = r.pos[s];
    const ob = v.oddsBets && v.oddsBets[me.id];
    const backed = r.events.some((e) => e.type === 'track' && e.suit === s && e.to < e.from);
    const moved = r.events.some((e) => e.type === 'move' && e.suit === s);
    return `
      <div class="ph ph-race" style="--sc:${SUIT_COLOR[s]}">
        <p class="center muted">Dein Pferd: <b>${suitSym(s)} ${suitName(s)}</b> · ${unit(st, b.amount)}</p>
        <div class="ph-big ${r.winner === s ? 'is-winner' : ''}"><span class="horse-card ${moved ? 'is-moved' : ''} ${backed ? 'is-back' : ''}" id="pace-${s}-${r.at[s]}">${aceHtml(s)}</span></div>
        <div class="ph-place"><b>${r.winner ? (r.winner === s ? '🏆 Sieg!' : `Platz ${place}`) : `Platz ${place}`}</b><small>von 4</small></div>
        <div class="ph-track" style="--n:${r.length + 1}"><span style="--p:${pos}"></span></div>
        <p class="center">${pos > r.length ? '🏁 Im Ziel' : pos ? `Reihe ${pos} / ${r.length}` : 'am Start'}</p>
        ${r.odds && !r.winner ? `<p class="ph-chance">Chance: <b>${pct(r.odds[s])}</b>${chanceHtml(r, s).includes('up') ? ' ▲' : chanceHtml(r, s).includes('down') ? ' ▼' : ''}</p>` : ''}
        ${ob ? `<p class="center muted">💸 Nachgesetzt: ${suitSym(ob.suit)} ${ob.amount} 🪙 ${quoteText(ob.odds)}</p>` : ''}
        ${say}${waitOdds}
        <p class="muted small center">👀 Schau auf den Laptop</p>
      </div>`;
  }

  function phonePayoutHtml(v, me) {
    const st = v.settings;
    const res = v.result;
    const line = res.lines.find((l) => l.id === me.id);
    const g = v.give && v.give.givers[me.id];
    const head = `<div class="ph-result" style="--sc:${SUIT_COLOR[res.winner]}">${aceHtml(res.winner)}<b>🏆 ${suitName(res.winner)} gewinnt!</b></div>`;
    if (g) {
      const rows = v.players
        .filter((p) => p.id !== me.id)
        .map((p) => {
          const n = g.to[p.id] || 0;
          return `<div class="give-row">
              <b>${esc(p.name)}</b>
              <span class="give-dots">${'●'.repeat(Math.min(n, 12))}${n > 12 ? ' +' + (n - 12) : ''}</span>
              <button class="icon-btn icon-small" data-act="give" data-target="${esc(p.id)}" data-delta="-1" ${n ? '' : 'disabled'} aria-label="Einen zurück">−</button>
              <button class="btn btn-primary btn-small give-plus" data-act="give" data-target="${esc(p.id)}" data-delta="1" ${g.left ? '' : 'disabled'} aria-label="${esc(p.name)} einen geben">＋</button>
            </div>`;
        })
        .join('');
      return `
        <div class="ph">
          ${head}
          <h2 class="center">🎁 Verteile ${unit(st, line.give)}</h2>
          <div class="give-list">${rows}</div>
          <p class="ph-left ${g.left ? '' : 'is-done'}">${g.left ? `${g.left} übrig` : '✓ Alles verteilt'}</p>
        </div>`;
    }
    let mine;
    if (!line) mine = `<p class="ph-hint">Du hast diesmal nicht gesetzt.</p>`;
    else if (isChips(st)) {
      mine = `<div class="ph-sum ${line.delta > 0 ? 'is-good' : 'is-bad'}"><b>${signed(line.delta)} 🪙</b><small>${line.before} → ${line.after} Chips${line.extra ? ` · Quote ${signed(line.extra.delta)}` : ''}</small></div>`;
    } else {
      const rec = receivedText(v, me.id);
      const total = line.drink + rec.n;
      mine = line.give
        ? `<div class="ph-sum is-good"><b>🎁 Du verteilst ${line.give}</b><small>Sag laut, an wen.</small></div>`
        : `<div class="ph-sum ${total ? 'is-bad' : 'is-good'}"><b>${total ? `🍺 Du trinkst ${total}` : '😇 Du trinkst nichts'}</b><small>${
            rec.n ? `${line.drink} Einsatz + ${esc(rec.text)}` : line.note === 'second' ? 'Platz 2 trinkt nichts' : line.note === 'last' ? 'Letzter – doppelt' : ''
          }</small></div>`;
    }
    if (line && !isChips(st) && !line.give && v.give) {
      const waiting = Object.values(v.give.givers).some((x) => x.left);
      if (waiting) mine += `<p class="ph-hint">💭 Die Gewinner verteilen noch …</p>`;
    }
    return `<div class="ph">${head}${mine}<p class="muted small center">Gleich geht's weiter – schau auf den Laptop.</p></div>`;
  }

  function phoneEndHtml(v, me) {
    const rank = v.standings.findIndex((p) => p.id === me.id) + 1;
    const mine = v.standings.find((p) => p.id === me.id);
    const chips = isChips(v.settings);
    const myAwards = v.awards.filter((a) => a.names.includes(me.name));
    return `
      <div class="ph">
        <div class="look-up">${['🥇', '🥈', '🥉'][rank - 1] || '🏁'}<b>Platz ${rank} von ${v.standings.length}</b><small>${
          chips ? `${mine.chips} Chips` : `${mine.stats.given} verteilt · ${mine.stats.drank} getrunken`
        } · ${mine.stats.wins}× richtig getippt</small></div>
        ${myAwards.length ? `<div class="awards">${myAwards.map((a) => `<div class="award"><span class="award-icon">${a.icon}</span><div><small>${esc(a.title)}</small><span>${esc(a.text)}</span></div></div>`).join('')}</div>` : ''}
        <p class="muted center">Danke fürs Mitwetten!</p>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Dialoge                                                             */
  /* ------------------------------------------------------------------ */

  function peopleHtml(v) {
    const canRemove = v.phase === 'lobby' || v.players.length > MIN_PLAYERS;
    return `<h2>👥 Mitspielende</h2>
      <p class="muted small">${v.phase === 'racing' ? 'Wer jetzt dazukommt, wettet ab dem nächsten Rennen mit.' : 'Neue Personen wetten gleich mit.'}${
        v.settings.input === 'phones' ? ' Handys tragen sich selbst ein (📱).' : ''
      }${isChips(v.settings) ? ` Neue starten mit ${CHIPS_START} Chips.` : ''}</p>
      <div class="chips">${playerChipsHtml(v, canRemove)}</div>
      ${
        v.players.length < MAX_PLAYERS
          ? `<form class="add-row" data-form="add-player">
              <input class="input" type="text" maxlength="24" placeholder="Name" value="${esc(ui.addName)}" data-field="add-name" autocomplete="off" enterkeyhint="done" />
              <button class="btn btn-primary" type="submit">＋</button>
            </form>`
          : ''
      }
      <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig</button></div>`;
  }

  /** Laptop verteilt für eine Person ohne Handy */
  function giveModalHtml(v) {
    const id = ui.giveFor;
    const g = v.give && v.give.givers[id];
    if (!g) return '';
    const rows = v.players
      .filter((p) => p.id !== id)
      .map((p) => {
        const n = g.to[p.id] || 0;
        return `<div class="give-row">
            <b>${esc(p.name)}</b>
            <span class="give-dots">${'●'.repeat(Math.min(n, 12))}</span>
            <button class="icon-btn icon-small" data-act="give" data-giver="${esc(id)}" data-target="${esc(p.id)}" data-delta="-1" ${n ? '' : 'disabled'}>−</button>
            <button class="btn btn-primary btn-small" data-act="give" data-giver="${esc(id)}" data-target="${esc(p.id)}" data-delta="1" ${g.left ? '' : 'disabled'}>＋</button>
          </div>`;
      })
      .join('');
    return `<h2>🎁 ${esc(pname(v, id))} verteilt</h2>
      <div class="give-list">${rows}</div>
      <p class="ph-left ${g.left ? '' : 'is-done'}">${g.left ? `${g.left} übrig` : '✓ Alles verteilt'}</p>
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
        <p class="muted small center">Wer jetzt beitritt, wettet ab dem nächsten Rennen mit.</p>
        <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig</button></div>`;
    } else if (ui.modal === 'settings' && v) {
      const started = v.history.length > 0 || v.phase === 'racing' || v.phase === 'payout';
      body = `<h2>⚙️ Einstellungen</h2>${settingsHtml(v.settings, 'live', started)}
        <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig</button></div>`;
    } else if (ui.modal === 'people' && v) {
      body = peopleHtml(v);
    } else if (ui.modal === 'give' && v) {
      body = giveModalHtml(v);
    } else if (ui.modal === 'standings' && v) {
      body = `<h2>📊 Statistik</h2>${statsHtml(v)}<div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Fertig</button></div>`;
    } else if (ui.modal === 'confirm' && ui.confirm) {
      body = `
        <h2>${esc(ui.confirm.title)}</h2>
        <p>${esc(ui.confirm.text)}</p>
        <div class="modal-actions">
          <button class="btn ${ui.confirm.danger ? 'btn-danger' : 'btn-primary'}" data-act="confirm-yes">${esc(ui.confirm.yes)}</button>
          <button class="btn btn-ghost" data-act="close-modal">Abbrechen</button>
        </div>`;
    } else return '';
    if (!body) return '';
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
        <p>Die <b>vier Asse</b> (♠ ♥ ♦ ♣) sind die Pferde und stehen am Start. Quer über der Bahn liegen
          <b>verdeckte Streckenkarten</b> (5–8, eine pro Reihe), der Rest ist der Stapel.</p>
        <h3>🎟️ Wetten</h3>
        <p>Jede Person wählt ein Pferd und setzt 1 bis zum Maximum Schlucke. Alle sehen, wer worauf setzt (mit Handys auch geheim möglich).</p>
        <h3>🏇 Das Rennen</h3>
        <ul>
          <li>Die oberste Karte vom Stapel wird aufgedeckt – das <b>Pferd dieser Farbe zieht ein Feld vor</b>.</li>
          <li>Haben <b>alle vier Pferde</b> eine Reihe erreicht, wird deren Streckenkarte aufgedeckt: Das Pferd dieser Farbe
            muss <b>ein Feld zurück</b> (nie hinter den Start). Jede Streckenkarte wird nur einmal aufgedeckt.</li>
          <li>Das erste Pferd, das über die letzte Reihe hinaus <b>ins Ziel</b> läuft, gewinnt.</li>
          <li>Ist der Stapel leer, werden die aufgedeckten Karten neu gemischt.</li>
        </ul>
        <p class="muted small">Streckenkarten fehlen im Stapel – eine Farbe, die oft in der Strecke liegt, hat es schwerer. Das weiß vorher aber niemand.
          Die <b>📈 Live-Chancen</b> spielen das restliche Rennen 2000-mal durch – mit den noch verdeckten Karten in zufälliger Lage.</p>
        <h3>🎁 Abrechnung</h3>
        <ul>
          <li>Auf den <b>Sieger</b> gesetzt: <b>verteilt den Einsatz × 2</b> (einstellbar × 1 / × 2 / × 3) – beliebig auf andere aufteilen, nicht auf sich selbst.
            Mit Handys tippen Gewinner an, wer trinkt.</li>
          <li>Auf ein anderes Pferd gesetzt: <b>trinkt den Einsatz</b>.</li>
          <li>Optional: „Letzter trinkt doppelt“ und „Platz 2 trinkt nichts“.</li>
        </ul>
        <h3>🪙 Chips-Modus (alkoholfrei)</h3>
        <ul>
          <li>Alle starten mit <b>${CHIPS_START} Chips</b>, gesetzt wird 1 bis alle eigenen.</li>
          <li>Sieger bekommen den <b>Einsatz × ${CHIPS_PAYOUT}</b> zurück, die anderen verlieren ihren Einsatz. Wer pleite ist, bekommt pro Rennen 1 Mitleidschip.</li>
          <li><b>💸 Quoten-Wetten</b> (optional): Nach der ersten Streckenkarte darf jede Person einmal nachsetzen – gewinnt das Pferd, gibt es Einsatz × Quote.</li>
          <li>Am Ende gewinnt, wer die meisten Chips hat – Siegerehrung!</li>
        </ul>
        <h3>📱 Mit Handys</h3>
        <p>Der Laptop zeigt einen QR-Code, alle treten mit Namen bei. Gesetzt wird auf dem Handy, während des Rennens zeigt es das eigene Pferd
          mit Platzierung und vibriert, wenn es vorzieht oder zurückfällt. Wer kein Handy hat, wird am Laptop eingetragen.</p>
        <h3>🃏 Echte Karten</h3>
        <p>Ihr spielt mit einem echten Deck. Die App ist Wettbüro und Abrechnung: Wetten eintragen, nach dem Rennen das Siegerpferd antippen.</p>
        <h3>📊 Statistik</h3>
        <p>Auszeichnungen: 🎁 Wettkönig:in, 🍺 Pechvogel, 🎯 Glückspilz, 🎰 Zocker:in, 🐴 Treue Seele (im Chips-Modus 💰 Großverdiener:in und 📉 Pechvogel).</p>
        <h3>⌨️ Bedienung</h3>
        <p><b>Leertaste</b>: im Tipp-Modus nächste Karte, sonst Pause/Weiter. Das Tempo lässt sich während des Rennens umstellen.</p>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">Alles klar!</button></div>`;
  }

  function menuHtml() {
    const v = ui.view;
    const items = [];
    items.push(`<button class="menu-item" data-act="rules">📖 Spielregeln</button>`);
    if (!v || v.me.host) {
      items.push(`<button class="menu-item" data-act="mute">${Sound.muted ? '🔊 Ton einschalten' : '🔇 Ton ausschalten'}</button>`);
      items.push(`<button class="menu-item" data-act="hooves">🐎 Hufgetrappel <small>(${ui.prefs.hooves ? 'an' : 'aus'})</small></button>`);
    }
    if (v && v.me.host) {
      if (v.phase !== 'end') {
        items.push(`<button class="menu-item" data-act="people">👥 Mitspielende</button>`);
        items.push(`<button class="menu-item" data-act="settings">⚙️ Einstellungen</button>`);
        if (v.history.length) items.push(`<button class="menu-item" data-act="standings">📊 Statistik</button>`);
      }
      if (v.room) items.push(`<button class="menu-item" data-act="show-qr">📱 Handys verbinden</button>`);
      if (v.phase === 'racing') items.push(`<button class="menu-item" data-act="abort-ask">↩️ Rennen abbrechen <small>(zurück ins Wettbüro)</small></button>`);
      items.push(`<button class="menu-item" data-act="home-keep">🏠 Hauptmenü <small>(Spiel bleibt gespeichert)</small></button>`);
      if (v.phase !== 'end' && v.phase !== 'lobby') items.push(`<button class="menu-item danger" data-act="finish-ask">🏁 Rennabend beenden <small>(zur Rangliste)</small></button>`);
      items.push(`<button class="menu-item danger" data-act="close-game">🚪 Spiel schließen</button>`);
    } else if (v) {
      if (v.history.length) items.push(`<button class="menu-item" data-act="standings">📊 Statistik</button>`);
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

  /** Nächste Karte von Hand (Tipp-Modus) */
  function drawNow() {
    const v = ui.view;
    if (!v || !v.me.host || v.phase !== 'racing' || !v.race || v.race.winner || v.oddsWin || ui.modal || ui.countdown != null) return;
    if (v.paused) dispatch('pause', { paused: false });
    dispatch('draw', { at: ui.view.step });
  }

  function createGame() {
    const s = ui.setup;
    ui.error = null;
    const names = filledNames();
    if (s.settings.input !== 'phones' && names.length < MIN_PLAYERS) {
      ui.error = `Bitte mindestens ${MIN_PLAYERS} Namen eintragen.`;
      render();
      return;
    }
    const state = Engine.create({ settings: s.settings, players: names });
    Sound.unlock();
    startStage({ state });
  }

  /** Person für eine Aktion: am Handy die eigene, am Gerät die angetippte */
  function forPlayer(el) {
    const v = ui.view;
    if (!v) return {};
    return v.me.host ? { player: el.dataset.player } : {};
  }

  const actions = {
    home: () => goHome(false),
    'home-keep': () => goHome(true),
    'leave-now': () => goHome(false),
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
    hooves: () => {
      ui.prefs.hooves = !ui.prefs.hooves;
      savePrefs();
      toast(ui.prefs.hooves ? '🐎 Hufgetrappel an' : 'Hufgetrappel aus');
    },
    'close-modal': () => {
      ui.modal = null;
      ui.confirm = null;
      ui.giveFor = null;
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
    set: (el) => setSetting(el.dataset.scope, el.dataset.key, el.dataset.num ? +el.dataset.value : el.dataset.value),
    toggle: (el) => {
      const s = currentSettings(el.dataset.scope);
      if (s) setSetting(el.dataset.scope, el.dataset.key, !s[el.dataset.key]);
    },
    'add-player': () => {
      if (ui.setup.players.length >= MAX_PLAYERS) return;
      ui.setup.players.push('');
      saveSetup();
      ui.focus = `[data-field="player-name"][data-player="${ui.setup.players.length - 1}"]`;
      render();
    },
    'remove-player': (el) => {
      ui.setup.players.splice(+el.dataset.player, 1);
      saveSetup();
      render();
    },
    'create-game': createGame,
    open: () => dispatch('open'),
    bet: (el) => {
      vibrate(25);
      dispatch('bet', Object.assign(forPlayer(el), { suit: el.dataset.suit }));
    },
    amount: (el) => dispatch('amount', Object.assign(forPlayer(el), { delta: +el.dataset.delta })),
    'all-in': (el) => {
      const v = ui.view;
      const p = v.me.host ? v.players.find((x) => x.id === el.dataset.player) : myPlayer(v);
      if (p) dispatch('amount', Object.assign(forPlayer(el), { amount: p.chips }));
    },
    'same-bets': () => dispatch('sameBets'),
    'random-bets': () => dispatch('randomBets'),
    start: () => {
      const v = ui.view;
      if (!v) return;
      if (v.missing.length && kindOf(v) === 'stage') {
        const names = v.missing.map((id) => pname(v, id));
        askConfirm({
          title: 'Trotzdem starten?',
          text: `${joinNames(names)} ${names.length === 1 ? 'hat' : 'haben'} noch nicht gesetzt und ${names.length === 1 ? 'setzt' : 'setzen'} dieses Rennen aus.`,
          yes: 'Start! 🏁',
          run: () => dispatch('start', { at: v.step, force: true }),
        });
        return;
      }
      dispatch('start', { at: v.step });
    },
    draw: drawNow,
    pause: () => dispatch('pause'),
    'skip-hold': endHold,
    next: () => {
      if (ui.view) dispatch('next', { at: ui.view.step });
    },
    'real-pick': (el) => {
      if (!ui.realOrder.includes(el.dataset.suit)) ui.realOrder.push(el.dataset.suit);
      render();
    },
    'real-reset': () => {
      ui.realOrder = [];
      render();
    },
    'real-confirm': () => {
      if (ui.view && ui.realOrder.length) dispatch('result', { at: ui.view.step, ranking: ui.realOrder.slice() });
    },
    'odds-pick': (el) => {
      const id = el.dataset.player;
      ui.oddsSel[id] = Object.assign({ amount: 1 }, ui.oddsSel[id], { suit: el.dataset.suit });
      render();
    },
    'odds-amount': (el) => {
      const v = ui.view;
      const id = el.dataset.player;
      const left = (v.oddsWin && v.oddsWin.left[id]) || 1;
      const cur = Object.assign({ amount: 1 }, ui.oddsSel[id]);
      cur.amount = Math.max(1, Math.min(left, cur.amount + +el.dataset.delta));
      ui.oddsSel[id] = cur;
      render();
    },
    'odds-set': (el) => {
      const id = el.dataset.player;
      const sel = ui.oddsSel[id];
      if (!sel || !sel.suit) return;
      dispatch('oddsBet', Object.assign(forPlayer(el), { suit: sel.suit, amount: sel.amount || 1 }));
    },
    'odds-skip': (el) => dispatch('oddsBet', Object.assign(forPlayer(el), { skip: true })),
    'close-odds': () => dispatch('closeOdds'),
    give: (el) => {
      vibrate(20);
      const extra = { target: el.dataset.target, delta: +el.dataset.delta };
      if (el.dataset.giver) extra.giver = el.dataset.giver;
      dispatch('give', extra);
    },
    'give-for': (el) => {
      ui.giveFor = el.dataset.player;
      ui.modal = 'give';
      render();
    },
    standings: () => {
      ui.modal = 'standings';
      render();
    },
    'show-qr': () => {
      ui.modal = 'qr';
      render();
    },
    people: () => {
      ui.modal = 'people';
      ui.addName = '';
      ui.focus = '[data-field="add-name"]';
      render();
    },
    'remove-player-live': (el) => {
      const v = ui.view;
      const name = v ? pname(v, el.dataset.player) : 'Person';
      askConfirm({
        title: `${name} entfernen?`,
        text: 'Die Person wird aus der Runde genommen, ihre Wette fällt weg.',
        yes: 'Entfernen',
        danger: true,
        run: () => {
          dispatch('removePlayer', { player: el.dataset.player });
          ui.modal = 'people';
        },
      });
    },
    settings: () => {
      ui.modal = 'settings';
      render();
    },
    'abort-ask': () =>
      askConfirm({
        title: 'Rennen abbrechen?',
        text: 'Das Rennen wird nicht gewertet. Ihr kommt zurück ins Wettbüro, die Wetten bleiben stehen.',
        yes: 'Abbrechen',
        run: () => dispatch('abort'),
      }),
    'finish-ask': () =>
      askConfirm({
        title: 'Rennabend beenden?',
        text: ui.view && ui.view.phase === 'racing' ? 'Das laufende Rennen wird nicht gewertet. Danach gibt es die Rangliste.' : 'Danach gibt es die Rangliste.',
        yes: 'Beenden',
        run: () => dispatch('finish'),
      }),
    again: () => dispatch('again'),
    'close-game': () =>
      askConfirm({
        title: 'Spiel schließen?',
        text: ui.view && ui.view.room ? 'Der Raum wird geschlossen, die Handys werden getrennt.' : 'Das Spiel wird beendet und nicht gespeichert.',
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
    const el = e.target.closest('[data-act], [data-tap]');
    if (!el || el.disabled || !app.contains(el)) return;
    Sound.unlock();
    if (!el.dataset.act) {
      drawNow(); // Tippen auf die Bahn
      return;
    }
    const fn = actions[el.dataset.act];
    if (!fn) return;
    if (!['close-modal-bg', 'draw'].includes(el.dataset.act)) Sound.click();
    // Menüpunkte schließen das Menü, bevor sie etwas tun
    if (ui.modal === 'menu' && el.closest('.modal') && !['close-modal', 'mute', 'hooves'].includes(el.dataset.act)) ui.modal = null;
    fn(el, e);
  });

  app.addEventListener('input', (e) => {
    const el = e.target;
    const f = el.dataset && el.dataset.field;
    if (f === 'player-name') {
      ui.setup.players[+el.dataset.player] = el.value;
      saveSetup();
    } else if (f === 'add-name') {
      ui.addName = el.value;
    } else if (f === 'name') {
      ui.name = el.value;
    } else if (f === 'join-code') {
      ui.joinCode = Net.cleanCode(el.value);
    }
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
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.modal) {
      actions['close-modal']();
      return;
    }
    // Tastatur am Laptop: Leertaste/Enter = nächste Karte (Tippen) bzw. Pause/Weiter, P = Pause
    const t = e.target;
    const v = ui.view;
    if (ui.screen !== 'game' || !v || !v.me.host || ui.modal || e.altKey || e.ctrlKey || e.metaKey) return;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (t && t.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
    const go = [' ', 'Enter', 'ArrowRight'].includes(e.key);
    if (v.phase === 'payout' && ui.hold && go) {
      e.preventDefault();
      endHold();
    } else if (v.phase === 'racing' && v.race && !v.race.winner && !v.oddsWin) {
      if (go && v.settings.speed === 'tap') {
        e.preventDefault();
        drawNow();
      } else if ((go && e.key !== 'ArrowRight') || e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        dispatch('pause');
      }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ui.view && ui.view.phase !== 'end') keepAwake(true);
    syncHooves();
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

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.PF_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  autoResume();

  // für Tests
  window.PFApp = { ui, render: renderNow, actions };
})();
