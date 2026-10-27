/*
 * Oberfläche von „Pointe!“.
 *  - Laptop („Bühne“): Spiel anlegen, Lobby mit QR-Code, Schreib-Fortschritt, Duelle (zwei Antworten ohne Namen,
 *    vorlesen, abstimmen), Auflösung mit Prozentbalken, Zwischenstand, Letzte Pointe, Siegerehrung.
 *  - Handy: eigene Satzanfänge beantworten (🎲 Rettung), abstimmen, im Finale 3 Stimmen verteilen.
 * Gerendert wird per HTML-String + morphdom (nur geänderte Teile werden ersetzt).
 */
(function () {
  'use strict';

  const E = window.PointeEngine;
  const { MIN_PLAYERS, MAX_PLAYERS, MAX_ANSWER, ROUND_OPTIONS, WRITE_OPTIONS, VOTE_OPTIONS, FINAL_VOTES, POINTS, Engine, sanitizeSettings } = E;
  const { StageController, ClientController, Store, KEYS, Net, inviteLink, qrSvg } = window.PointeControllers;
  const { Sound, confetti, synth } = window.GameFx;
  const Speech = window.GameSpeech;
  const Prompts = window.PointePrompts;

  const SETUP_KEY = 'pointe.setup.v1';
  const PREFS_KEY = 'pointe.prefs.v1';
  const ACTIVE_KEY = 'pointe.active';
  const RESUME_MAX_AGE = 12 * 60 * 60 * 1000;
  const ROUND_LABEL = { 2: '2 + Finale', 3: '3 + Finale', 0: 'Nur Finale' };

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

  /** Satzanfang mit hübscher Lücke (bleibt mit dem Wort davor in einer Zeile) */
  function promptHtml(text) {
    return esc(text).replace(/(\S*)\s*___/g, '<span class="nowrap">$1&nbsp;<span class="blank" aria-label="Lücke"></span></span>');
  }

  /** Antwort (ein oder mehrere Teile) */
  function answerHtml(parts, opts) {
    const o = opts || {};
    if (!parts) return '<span class="hidden-answer">🙈 ausgeblendet</span>';
    const list = parts.filter(Boolean);
    if (!list.length) return '<span class="no-answer">(keine Antwort)</span>';
    if (parts.length === 1) return `<span class="answer-text">${o.quote === false ? '' : '„'}${esc(parts[0])}${o.quote === false ? '' : '“'}</span>`;
    return `<ol class="answer-parts">${parts.map((p) => `<li>${p ? esc(p) : '<span class="no-answer">–</span>'}</li>`).join('')}</ol>`;
  }

  function answerSpeak(parts) {
    return (parts || []).filter(Boolean).join(', ');
  }

  function norm(t) {
    return Prompts.slug(t);
  }

  function isRescue(m, parts) {
    return m.rescues.some((r) => r.every((x, i) => norm(x) === norm(parts[i] || '')));
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

  function roundLabel(v) {
    if (v.kind === 'final') {
      const finals = v.plan.filter((k) => k === 'final').length;
      return finals > 1 ? `🏁 Letzte Pointe ${v.plan.slice(0, v.round).filter((k) => k === 'final').length}/${finals}` : '🏁 Letzte Pointe';
    }
    return `Runde ${v.round}/${v.rounds}${v.mult > 1 ? ` · Punkte ×${v.mult}` : ''}`;
  }

  function nextLabel(v) {
    const next = v.plan[v.round];
    if (!next) return 'Zur Siegerehrung 🏆';
    if (next === 'final') return 'Zur Letzten Pointe 🏁';
    return `Runde ${v.round + 1} – Punkte ×${v.plan.slice(0, v.round + 1).filter((k) => k === 'duels').length} →`;
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
    // Handy: Entwürfe der eigenen Antworten (target -> parts), welche Karte gerade offen ist
    drafts: {},
    draftKey: null,
    page: null,
    rescueIdx: {},
    autoSent: null,
    fvotes: {}, // Handy, Finale: eigene Stimmen {key: n}
    fvotesStep: null,
    // Bühne: was gerade vorgelesen wird
    spoken: null,
    readIdx: -1,
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
    /** Stimme abgegeben */
    pop() {
      synth.tone(880, 0, 0.05, { type: 'sine', to: 1320, vol: 0.04 });
    },
    /** Trommelwirbel vor der Auflösung */
    drum() {
      for (let i = 0; i < 9; i++) synth.noise(0.05, i * 0.05, 0.08 + i * 0.01, 300);
      synth.tone(196, 0.48, 0.25, { type: 'triangle', vol: 0.12 });
    },
    /** Grillenzirpen – keine einzige Stimme */
    cricket() {
      for (let k = 0; k < 3; k++) for (let i = 0; i < 4; i++) synth.tone(4300, 0.6 + k * 0.35 + i * 0.04, 0.025, { type: 'sine', vol: 0.03 });
    },
    /** VS-Wusch beim neuen Duell */
    vs() {
      synth.tone(330, 0, 0.18, { type: 'sawtooth', to: 660, vol: 0.05 });
      synth.tone(990, 0.16, 0.12, { type: 'triangle', vol: 0.08 });
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
    ui.drafts = {};
    ui.draftKey = null;
    ui.page = null;
    ui.spoken = null;
    ui.readIdx = -1;
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
    if (!v.me.stage) syncPhone(v);
    transitions(prev, v);
    if (v.me.stage) speechEffects(prev, v);
    render();
  }

  /** Handy: Entwürfe und Finale-Stimmen zur Runde passend halten */
  function syncPhone(v) {
    const key = v.write ? `${v.phase}:${v.round}` : null;
    if (key !== ui.draftKey) {
      ui.draftKey = key;
      ui.drafts = {};
      ui.page = null;
      ui.rescueIdx = {};
      ui.autoSent = null;
    }
    if (v.write) for (const m of v.write.mine) if (!ui.drafts[m.target]) ui.drafts[m.target] = m.parts.slice();
    if (v.phase === 'final-vote' && v.final && ui.fvotesStep !== v.step) {
      ui.fvotesStep = v.step;
      ui.fvotes = Object.assign({}, v.final.myVotes || {});
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

  /** Sounds, Konfetti und Einblendungen bei Zustandswechseln */
  function transitions(prev, v) {
    const stage = !!v.me.stage;
    if (!prev) return;
    const entered = (phase) => v.phase === phase && (prev.phase !== phase || prev.step !== v.step);
    if (entered('end')) {
      ui.flash = null;
      Sound.fanfare();
      setTimeout(() => confetti(['#ff5c8a', '#ffd23f', '#38bdf8', '#ffffff'], 220), 150);
      return;
    }
    if (entered('write') || entered('final-write')) {
      Sound.start();
      if (!stage) vibrate([60, 40, 60]);
      return;
    }
    if (entered('duel')) {
      if (stage) Fx.vs();
      else if (v.duel.role === 'voter') vibrate(40);
      return;
    }
    if (entered('final-vote')) {
      Sound.flip();
      if (!stage) vibrate(40);
      return;
    }
    if (entered('result')) {
      const d = v.duel;
      const pointe = d.sides.find((x) => x.pointe);
      if (stage) {
        Fx.drum();
        setTimeout(() => {
          if (pointe) {
            Sound.fanfare();
            confetti([pointe.color, '#ffd23f', '#ffffff'], 180);
            flash('😂 POINTE!', pointe.color, true);
            render();
          } else if (!d.forfeit && d.sides.some((x) => !x.voters.length && !x.aud)) Fx.cricket();
          else Sound.success();
        }, 650);
      } else {
        const mine = d.sides.find((x) => x.pid === v.me.id);
        if (mine) {
          if (mine.win) Sound.success();
          else Sound.fail();
          vibrate(mine.win ? [80, 40, 80] : 200);
        }
      }
      return;
    }
    if (entered('final-result')) {
      Fx.drum();
      if (stage) setTimeout(() => confetti(['#ffd23f', '#ff5c8a', '#ffffff'], 140), 650);
      return;
    }
    if (entered('scores')) {
      Sound.success();
      return;
    }
    // Neue Stimmen auf der Bühne
    if (stage && v.phase === 'duel' && prev.phase === 'duel' && v.duel.voted > prev.duel.voted) Fx.pop();
    if (stage && v.phase === 'final-vote' && prev.phase === 'final-vote' && v.final.done > prev.final.done) Fx.pop();
  }

  /** Bühne: vorlesen (Satzanfang, Antworten) und danach die Abstimmungszeit starten */
  function speechEffects(prev, v) {
    const step = v.step;
    if (v.reading && ui.spoken !== step) {
      ui.spoken = step;
      let list = [];
      let target = null;
      if (v.phase === 'duel') {
        target = v.duel.id;
        list = [Prompts.speakable(v.duel.prompt.text), ...v.duel.sides.map((x) => answerSpeak(x.parts))];
      } else if (v.phase === 'final-vote') {
        target = v.final.id;
        list = [Prompts.speakable(v.final.prompt.text), ...v.final.answers.map((x) => answerSpeak(x.parts))];
      }
      ui.readIdx = -1;
      // kurz warten, bis der Wusch-Sound durch ist
      setTimeout(() => {
        if (!ui.view || ui.view.step !== step) return;
        Speech.sayAll(list, {
          pause: 350,
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
    if (!v.settings.speech || !prev) return;
    if (v.phase === 'result' && prev.step !== step) {
      const d = v.duel;
      const pointe = d.sides.find((x) => x.pointe);
      setTimeout(() => {
        if (!ui.view || ui.view.step !== step) return;
        if (pointe) Speech.say(`Pointe für ${pointe.name}!`);
        else if (d.forfeit === 'both') Speech.say('Niemand hat geantwortet.');
        else if (d.forfeit) Speech.say(`${d.sides.find((x) => x.win).name} gewinnt kampflos.`);
        else {
          const w = d.sides.find((x) => x.win);
          Speech.say(w ? `${w.name} gewinnt.` : 'Unentschieden!');
        }
      }, 900);
    }
    if (v.phase === 'final-result' && prev.phase !== 'final-result') {
      const top = (v.final.results || [])[0];
      if (top && top.points > 0) setTimeout(() => Speech.say(`Die Letzte Pointe geht an ${top.name}!`), 900);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Handy: Antworten abschicken                                         */
  /* ------------------------------------------------------------------ */

  function sendAnswer(target) {
    const parts = (ui.drafts[target] || []).map((t) => String(t || '').slice(0, MAX_ANSWER));
    dispatch('answer', { target, parts });
  }

  /** Zeit um: was getippt, aber nicht abgeschickt ist, noch schnell hinterher */
  function flushDrafts() {
    const v = ui.view;
    if (!v || !v.write || v.me.stage) return;
    for (const m of v.write.mine) {
      const d = ui.drafts[m.target] || [];
      if (d.some((t) => String(t || '').trim()) && d.some((t, i) => (t || '') !== (m.parts[i] || ''))) sendAnswer(m.target);
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
    // Handy: Schreibzeit gleich um → Entwürfe abschicken
    const v = ui.view;
    if (v && v.write && !v.me.stage && v.timer && ui.autoSent !== ui.draftKey && v.timer.remaining - elapsed <= 400) {
      ui.autoSent = ui.draftKey;
      flushDrafts();
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
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="Pointe!">
      <span class="logo-icon" aria-hidden="true">😂</span>
      <span class="logo-text"><span class="l1">Pointe</span><span class="l2">!</span></span>
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
    const rows = [
      settingHtml(
        '🔁 Runden',
        s.rounds ? `${s.rounds} Duell-Runden (Punkte ×1, ×2${s.rounds > 2 ? ', ×3' : ''}), dann die Letzte Pointe` : 'Drei Runden Letzte Pointe – alle gegen alle',
        seg('rounds', ROUND_OPTIONS, s.rounds, (o) => ROUND_LABEL[o], scope)
      ),
      settingHtml('✍️ Zeit zum Schreiben', 'Für beide Satzanfänge zusammen', seg('writeTime', WRITE_OPTIONS, s.writeTime, (o) => o + ' s', scope)),
      settingHtml('🗳️ Zeit zum Abstimmen', 'Pro Duell (im Finale doppelt so lang)', seg('voteTime', VOTE_OPTIONS, s.voteTime, (o) => o + ' s', scope)),
      settingHtml('🗣️ Vorlesen', s.speech ? 'Der Laptop liest Satzanfang und Antworten vor – erst danach läuft die Zeit' : 'Nur lesen, nichts hören', switchHtml(s.speech, 'speech', scope)),
      settingHtml('👨‍👩‍👧 Familienrunde', s.family ? 'Ohne zweideutige Satzanfänge (und ohne Ab 18)' : 'Auch leicht zweideutige Satzanfänge', switchHtml(s.family, 'family', scope)),
      settingHtml('🙋 Namen der Runde einsetzen', s.names ? '„Was Anna heimlich sammelt: ___“ – kann gemein werden!' : 'Keine Satzanfänge über Mitspielende', switchHtml(s.names, 'names', scope)),
      settingHtml('👥 Publikum', s.audience ? 'Wer nicht mitschreibt, stimmt mit ab (zusammen 20 % der Stimmen)' : 'Wer nicht mitschreibt, schaut nur zu', switchHtml(s.audience, 'audience', scope)),
      settingHtml('🍻 Trinkregeln', 'Keine einzige Stimme → 2 Schlucke · Pointe! → 3 Schlucke verteilen', switchHtml(s.drinks, 'drinks', scope)),
    ];
    return `<div class="settings">${rows.join('')}</div>`;
  }

  function catsHtml(s, scope) {
    const stats = Prompts.stats();
    const cards = Prompts.CATEGORIES.map((c) => {
      const on = s.categories.includes(c.id);
      const off = s.family && c.adult;
      return `<button class="pack-card ${on && !off ? 'on' : ''}" data-act="cat-toggle" data-cat="${c.id}" data-scope="${scope}" aria-pressed="${on}" ${off ? 'disabled' : ''}>
        <b>${c.icon} ${esc(c.label)}${c.adult ? ' <small>(ab 18)</small>' : ''}</b>
        <small>${esc(c.text)} · ${stats[c.id]}</small>
      </button>`;
    }).join('');
    const pool = Prompts.pool(s, 'duel').length;
    return `<div class="pack-cards">${cards}</div>
      <p class="muted small">${pool} Satzanfänge im Topf · Letzte Pointe: ${Prompts.pool(s, 'final').length} eigene Finale-Satzanfänge${s.family ? ' · Familienrunde' : ''}</p>`;
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

  function sipsHtml(v, sips, forMe) {
    if (!sips) return '';
    const list = Object.entries(sips.sips || {}).filter(([pid]) => !forMe || pid === forMe);
    const give = sips.give && (!forMe || sips.give.pid === forMe) ? sips.give : null;
    if (!list.length && !give) return '';
    const name = (pid) => (forMe === pid ? 'Du' : esc((player(v, pid) || {}).name || '?'));
    const parts = list.map(([pid, n]) => `<b>${name(pid)}</b> ${forMe === pid ? 'trinkst' : 'trinkt'} ${n} ${plural(n, 'Schluck', 'Schlucke')}`);
    if (give) parts.push(`<b>${name(give.pid)}</b> ${forMe === give.pid ? 'verteilst' : 'verteilt'} ${give.n} Schlucke`);
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
    return `
    <div class="screen home">
      <a class="btn btn-ghost btn-small hub-back" href="../">← Alle Spiele</a>
      <div class="home-hero">
        ${logoHtml()}
        <p class="tagline">Lustige Satzanfänge, freche Antworten – und alle stimmen ab.<br /><small>Zwei treten gegeneinander an. Wer alle Stimmen holt, landet eine <b>Pointe!</b></small></p>
        <div class="home-duel" aria-hidden="true">
          <p class="home-prompt">${promptHtml('Der schlechteste Name für ein Kreuzfahrtschiff: ___')}</p>
          <div class="home-cards"><span class="mini-card">„MS Seekrank“</span><span class="vs">VS</span><span class="mini-card">„Die schwimmende Kläranlage“</span></div>
        </div>
      </div>
      ${resume.join('')}
      <div class="mode-cards">
        <button class="mode-card mode-stage" data-act="new-game">
          <span class="mode-icon">💻</span>
          <span class="mode-body"><b>Spiel anlegen</b><small>Am Laptop oder Fernseher: Duelle, Vorlesen, Abstimmung und Punkte.</small></span>
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
      <p class="home-foot">${MIN_PLAYERS}–${MAX_PLAYERS} Personen (+ Publikum) · Laptop + Handys · ${Prompts.stats().total} Satzanfänge</p>
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
        <p class="muted">Jede/r tritt mit dem eigenen Handy bei (${MIN_PLAYERS}–${MAX_PLAYERS} Personen schreiben, ab der 11. Person stimmt man als Publikum ab). Der Laptop ist die Bühne – am besten auf den Fernseher und laut machen!</p>
      </section>
      <section class="panel">
        <h2>📋 Kategorien</h2>
        ${catsHtml(st, 'setup')}
      </section>
      <section class="panel">
        <h2>Einstellungen</h2>
        ${settingsHtml(st, 'setup')}
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
    else if (v.phase !== 'lobby') info = `<span class="pill ${v.kind === 'final' ? 'pill-hot' : ''}">${esc(roundLabel(v))}</span>`;
    if (v.phase === 'duel' || v.phase === 'result') info += `<span class="pill">⚔️ Duell ${v.duel.no}/${v.duel.total}</span>`;
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
    else if (v.phase === 'write' || v.phase === 'final-write') main = writeStageHtml(v);
    else if (v.phase === 'duel' || v.phase === 'result') main = duelStageHtml(v);
    else if (v.phase === 'final-vote') main = finalVoteStageHtml(v);
    else if (v.phase === 'final-result') main = finalResultStageHtml(v);
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
    const chip = (p) =>
      `<span class="chip ${p.online ? '' : 'is-offline'}" style="${tc(p.color)}"><span class="team-dot"></span>${esc(p.name)}<button class="chip-x" data-act="kick" data-player="${esc(p.id)}" aria-label="${esc(p.name)} entfernen">✕</button></span>`;
    const aud = v.audience;
    return `
      <div class="lobby-grid">
        <section class="panel join-panel">
          <h2>📱 Handys verbinden</h2>
          <p class="muted">QR-Code scannen, Namen eingeben – los geht's.</p>
          ${roomBoxHtml(v.room, true)}
        </section>
        <div class="lobby-side">
          <section class="panel">
            <h2>✍️ Schreiben mit <small class="muted">(${v.players.length} / ${MAX_PLAYERS})</small></h2>
            <div class="chips">${v.players.length ? v.players.map(chip).join('') : '<span class="muted">Noch niemand – QR-Code scannen!</span>'}</div>
            ${aud.length ? `<div class="free"><b>${v.settings.audience ? '👥 Publikum (stimmt nur ab):' : '👀 Schauen nur zu:'}</b> <div class="chips">${aud.map((m) => `<span class="chip ${m.online ? '' : 'is-offline'}">${esc(m.name)}<button class="chip-x" data-act="kick" data-player="${esc(m.id)}" aria-label="${esc(m.name)} entfernen">✕</button></span>`).join('')}</div></div>` : ''}
            <p class="muted small">Das erste Handy ist die 🎬 Spielleitung und kann vom Handy aus weiterschalten. Freie Antworten kann die App nicht filtern – die Spielleitung kann eine Antwort mit 🙈 ausblenden (das Duell zählt dann für den Gegner).</p>
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
            <button class="btn btn-primary btn-big" data-act="start" ${v.lobbyProblem ? 'disabled' : ''}>Los geht's 😂</button>
            ${v.lobbyProblem ? `<p class="muted small center">${esc(v.lobbyProblem)}</p>` : ''}
          </div>
        </div>
      </div>`;
  }

  /* ---------- Schreiben ---------- */

  function progressHtml(v) {
    const list = (v.write.progress || []).map((x) => ({ x, p: player(v, x.id) })).filter((y) => y.p);
    return `<div class="progress-chips">${list
      .map(
        ({ x, p }) => `<div class="pchip ${p.online ? '' : 'is-offline'} ${x.done >= x.need ? 'is-done' : ''}" style="${tc(p.color)}">
          <span class="team-dot"></span><b>${esc(p.name)}</b>${dotsHtml(x.done, x.need)}${p.online ? '' : '<span>📵</span>'}
        </div>`
      )
      .join('')}</div>`;
  }

  function writeStageHtml(v) {
    const final = v.phase === 'final-write';
    const head = final
      ? `<h1 class="stage-title">🏁 Letzte Pointe</h1>
         <div class="prompt-card prompt-final">${promptHtml(v.write.prompt.text)}</div>
         <p class="muted center">Alle beantworten <b>denselben</b> Satzanfang. Danach verteilt jede/r <b>${FINAL_VOTES} Stimmen</b> – ${POINTS.vote} Punkte pro Stimme.</p>`
      : `<h1 class="stage-title">✍️ ${esc(roundLabel(v))}: Alle schreiben!</h1>
         <p class="muted center">Jede/r hat <b>zwei Satzanfänge</b> auf dem Handy – jeweils gegen jemand anderen. Keine Idee? <b>🎲 Rettung</b> drücken (gibt nur halbe Punkte).${v.mult > 1 ? `<br /><b class="hl">Diese Runde zählt ${v.mult === 2 ? 'doppelt' : 'dreifach'}!</b>` : ''}</p>`;
    return `
      <div class="center-stage write-stage">
        ${head}
        ${timerHtml(v.timer, { tick: true, clock: true, cls: 'timer-big' })}
        ${progressHtml(v)}
        <div class="stage-actions"><button class="btn btn-ghost btn-small" data-act="force" data-step="${esc(v.step)}">⏩ Jetzt beenden</button></div>
      </div>`;
  }

  /* ---------- Duell ---------- */

  function hideBtnHtml(target, key, hidden) {
    return `<button class="hide-btn" data-act="hide" data-target="${esc(target)}" data-key="${esc(key)}" data-hidden="${hidden ? '0' : '1'}" title="${hidden ? 'Wieder zeigen' : 'Antwort ausblenden'}">${hidden ? '👁️' : '🙈'}</button>`;
  }

  function duelCardHtml(v, x, i) {
    const d = v.duel;
    const reveal = v.phase === 'result';
    const reading = v.reading && ui.readIdx === i + 1;
    if (!reveal) {
      return `<div class="duel-card ${reading ? 'is-reading' : ''} ${x.hidden ? 'is-hidden' : ''}" style="--d:${i * 0.12}s">
        <div class="duel-answer">${answerHtml(x.parts)}</div>
        ${hideBtnHtml(d.id, x.key, x.hidden)}
      </div>`;
    }
    const voters = x.voters.map((p) => `<span class="voter" style="${tc(p.color)}"><span class="team-dot"></span>${esc(p.name)}</span>`).join('');
    return `<div class="duel-card is-revealed ${x.win ? 'is-win' : ''} ${x.pointe ? 'is-pointe' : ''} ${x.hidden ? 'is-hidden' : ''}" style="${tc(x.color)};--d:${i * 0.12}s">
      <div class="duel-answer">${answerHtml(x.parts)}</div>
      <div class="pct-bar"><span style="width:${x.pct}%"></span><b>${x.pct} %</b></div>
      <div class="duel-author"><span class="team-dot"></span><b>${esc(x.name)}</b>${x.rescue ? '<span class="badge">🎲 Rettung · halbe Punkte</span>' : ''}${x.pointe ? '<span class="badge badge-pointe">😂 Pointe!</span>' : ''}</div>
      <div class="duel-points">+${x.points}</div>
      <div class="voters">${voters}${x.aud ? `<span class="voter voter-aud">👥 ${x.aud}× Publikum</span>` : ''}${!voters && !x.aud && !d.forfeit ? '<span class="voter voter-none">🦗 keine Stimme</span>' : ''}</div>
      ${hideBtnHtml(d.id, x.key, x.hidden)}
    </div>`;
  }

  function duelStageHtml(v) {
    const d = v.duel;
    const reveal = v.phase === 'result';
    let status;
    if (!reveal) {
      status = v.reading
        ? `<p class="reading-note">🗣️ Wird vorgelesen … <small>abstimmen geht schon</small></p>`
        : timerHtml(v.timer, { tick: true, cls: 'timer-big' });
      status += `<p class="muted center">Abgestimmt: ${dotsHtml(d.voted, d.voterCount)} <small>(${d.voted}/${d.voterCount})</small></p>`;
    } else {
      status = d.forfeit === 'both' ? '<p class="banner">🦗 Niemand hat geantwortet – keine Punkte.</p>' : d.forfeit ? '<p class="banner">🏳️ Kampflos – eine Antwort fehlt oder wurde ausgeblendet.</p>' : '';
      status += sipsHtml(v, d.sips);
    }
    const actions = reveal
      ? `<button class="btn btn-primary btn-big" data-act="next" data-step="${esc(v.step)}" data-next>${d.last ? (v.plan[v.round] ? 'Zum Zwischenstand 📊' : 'Zur Siegerehrung 🏆') : `Nächstes Duell (${d.no + 1}/${d.total}) →`}</button>`
      : `<button class="btn btn-ghost btn-small" data-act="force" data-step="${esc(v.step)}">⏩ Jetzt auflösen</button>`;
    return `
      <div class="center-stage duel-stage" id="duel-${esc(d.id)}">
        <div class="prompt-card">${promptHtml(d.prompt.text)}</div>
        <div class="duel-row">
          ${duelCardHtml(v, d.sides[0], 0)}
          <div class="vs-badge" aria-hidden="true">VS</div>
          ${duelCardHtml(v, d.sides[1], 1)}
        </div>
        ${status}
        <div class="stage-actions">${actions}</div>
      </div>`;
  }

  /* ---------- Letzte Pointe ---------- */

  function finalVoteStageHtml(v) {
    const f = v.final;
    const cards = f.answers
      .map(
        (x, i) => `<div class="final-card ${v.reading && ui.readIdx === i + 1 ? 'is-reading' : ''} ${x.hidden ? 'is-hidden' : ''}" style="--d:${i * 0.08}s">
          <span class="final-no">${i + 1}</span>
          <div class="duel-answer">${answerHtml(x.parts)}</div>
          ${hideBtnHtml(f.id, x.key, x.hidden)}
        </div>`
      )
      .join('');
    return `
      <div class="center-stage final-stage">
        <div class="prompt-card prompt-final">${promptHtml(f.prompt.text)}</div>
        <div class="final-grid">${cards}</div>
        ${v.reading ? '<p class="reading-note">🗣️ Wird vorgelesen … <small>abstimmen geht schon</small></p>' : timerHtml(v.timer, { tick: true, cls: 'timer-big' })}
        <p class="muted center">Auf den Handys ${FINAL_VOTES} Stimmen verteilen (auch mehrere auf eine Antwort, nicht auf die eigene) · fertig: ${dotsHtml(f.done, f.voterCount)} <small>(${f.done}/${f.voterCount})</small></p>
        <div class="stage-actions"><button class="btn btn-ghost btn-small" data-act="force" data-step="${esc(v.step)}">⏩ Jetzt auflösen</button></div>
      </div>`;
  }

  function finalResultStageHtml(v) {
    const f = v.final;
    const top = Math.max(1, ...f.results.map((r) => r.points));
    const rows = f.results
      .map(
        (r, i) => `<div class="final-result ${r.present ? '' : 'is-missing'} ${i === 0 && r.points > 0 ? 'is-top' : ''}" style="${tc(r.color)};--d:${(f.results.length - i) * 0.15}s">
          <div class="fr-head"><span class="team-dot"></span><b>${esc(r.name)}</b>${r.rescue ? '<span class="badge">🎲 halbe Punkte</span>' : ''}<span class="fr-points">+${r.points}</span></div>
          <div class="duel-answer">${r.present || r.hidden ? answerHtml(r.hidden ? null : r.parts) : '<span class="no-answer">(keine Antwort)</span>'}</div>
          <div class="fr-votes">${'●'.repeat(Math.min(r.votes, 30))}${r.aud ? ` <small>+ 👥 ${r.aud}</small>` : ''}</div>
          <div class="pct-bar"><span style="width:${(100 * r.points) / top}%"></span></div>
          ${r.key !== null ? hideBtnHtml(f.id, r.key, r.hidden) : ''}
        </div>`
      )
      .join('');
    return `
      <div class="center-stage final-stage">
        <div class="prompt-card prompt-final">${promptHtml(f.prompt.text)}</div>
        <div class="final-results">${rows}</div>
        ${sipsHtml(v, f.sips)}
        <button class="btn btn-primary btn-big" data-act="next" data-step="${esc(v.step)}" data-next>${esc(nextLabel(v))}</button>
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
          <span class="gain">${g ? '+' + g : ''}</span><span class="total">${s.score}</span>
        </div>`;
      })
      .join('');
    return `
      <div class="center-stage scores-stage">
        <h1 class="stage-title">📊 Zwischenstand nach ${v.kind === 'final' ? 'der Letzten Pointe' : `Runde ${v.round}`}</h1>
        <div class="standings">${rows}</div>
        <button class="btn btn-primary btn-big" data-act="next" data-step="${esc(v.step)}" data-next>${esc(nextLabel(v))}</button>
      </div>`;
  }

  /* ---------- Spielende ---------- */

  function awardsHtml(v) {
    return (v.awards || []).map((a) => `<div class="award"><span class="award-icon">${a.icon}</span><div><b>${esc(a.title)}</b><small>${esc(a.text)}</small>${a.sub ? `<small class="award-sub">${promptHtml(a.sub)}</small>` : ''}</div></div>`).join('');
  }

  function historyHtml(v) {
    const parts = (p) => (p ? p.filter(Boolean).map(esc).join(' · ') || '–' : '🙈');
    return (v.history || [])
      .map((r) => {
        if (r.kind === 'duels') {
          return `<li><b>Runde ${r.no}</b> <small class="muted">(×${r.mult})</small><ul>${r.items
            .map((it) => `<li><small class="muted">${promptHtml(it.prompt)}</small><br />${it.sides.map((x) => `<span class="${x.win ? 'hl' : ''}">„${parts(x.parts)}“ – ${esc(x.name)} ${x.pct} %${x.pointe ? ' 😂' : ''}</span>`).join(' <b>vs</b> ')}</li>`)
            .join('')}</ul></li>`;
        }
        return `<li><b>🏁 Letzte Pointe</b> <small class="muted">${promptHtml(r.prompt)}</small><ul>${r.entries.map((e) => `<li>„${parts(e.parts)}“ – ${esc(e.name)} +${e.points}</li>`).join('')}</ul></li>`;
      })
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
          <span>${s.score} ${plural(s.score, 'Punkt', 'Punkte')}</span>
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
        ${rest.length ? `<div class="summary">${rest.map(({ s, p }) => `<div class="summary-row" style="${tc(p.color)}"><span class="team-dot"></span><b>${s.place}. ${esc(p.name)}</b><b class="summary-points">${s.score}</b></div>`).join('')}</div>` : ''}
        ${awards ? `<div class="awards">${awards}</div>` : ''}
        ${hist ? `<details class="word-list"><summary>📜 Alle Duelle zum Nachlesen</summary><ol>${hist}</ol></details>` : ''}
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
    else if (v.phase === 'write' || v.phase === 'final-write') body = phoneWriteHtml(v);
    else if (v.phase === 'duel') body = phoneDuelHtml(v);
    else if (v.phase === 'result') body = phoneResultHtml(v);
    else if (v.phase === 'final-vote') body = phoneFinalVoteHtml(v);
    else if (v.phase === 'final-result') body = phoneFinalResultHtml(v);
    else body = phoneScoresHtml(v);
    const role = p ? '' : me.audience ? '👥 Publikum' : 'Zuschauer';
    const score = p && v.phase !== 'lobby' ? `<span class="phone-points">${p.score} P.</span>` : '';
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

  function phoneLobbyHtml(v, p) {
    const n = v.players.length;
    if (!p) {
      return `<div class="look-up">${v.me.audience ? '👥' : '👀'}<b>${v.me.audience ? 'Du bist im Publikum' : 'Du schaust zu'}</b><small>${v.me.audience ? 'Du schreibst nicht, aber du stimmst bei jedem Duell mit ab.' : `${n} ${plural(n, 'Person spielt', 'Personen spielen')}`}</small></div>
        ${n < MAX_PLAYERS ? '<button class="btn btn-primary btn-big btn-wide" data-act="watch" data-watch="0">✍️ Doch mitschreiben</button>' : '<p class="muted center">Alle 10 Schreib-Plätze sind belegt.</p>'}`;
    }
    return `<div class="look-up">😂<b>Du bist dabei!</b><small>${n} ${plural(n, 'Person schreibt', 'Personen schreiben')} mit${n < MIN_PLAYERS ? ` – ab ${MIN_PLAYERS} geht's los` : ''}</small></div>
      <p class="center muted small">Du bekommst lustige Satzanfänge und tippst die witzigste Antwort, die dir einfällt. Dann stimmen alle ab, welche Antwort besser ist.</p>
      <p class="waiting">⏳ Warte, bis es am Laptop losgeht…</p>
      ${v.settings.audience ? '<button class="btn btn-link" data-act="watch" data-watch="1">Nur abstimmen (Publikum)</button>' : ''}`;
  }

  /** Eingabefelder für eine Antwort (ein oder mehrere Teile) */
  function draftInputs(m, editable) {
    const d = ui.drafts[m.target] || [];
    if (m.blanks === 1) {
      return `<textarea id="draft-${esc(m.target)}-0" class="input draft-input" rows="2" maxlength="${MAX_ANSWER}" placeholder="Deine witzigste Antwort …" data-field="draft" data-target="${esc(m.target)}" data-i="0" enterkeyhint="send" autocomplete="off" ${editable ? '' : 'disabled'}>${esc(d[0] || '')}</textarea>`;
    }
    return Array.from(
      { length: m.blanks },
      (_, i) =>
        `<label class="part-row"><span class="part-no">${i + 1}.</span><input id="draft-${esc(m.target)}-${i}" class="input draft-input" type="text" maxlength="${MAX_ANSWER}" placeholder="Lücke ${i + 1}" value="${esc(d[i] || '')}" data-field="draft" data-target="${esc(m.target)}" data-i="${i}" enterkeyhint="${i < m.blanks - 1 ? 'next' : 'send'}" autocomplete="off" ${editable ? '' : 'disabled'} /></label>`
    ).join('');
  }

  function phoneWriteHtml(v) {
    const w = v.write;
    const timer = timerHtml(v.timer, { clock: true });
    const final = v.phase === 'final-write';
    if (!w.mine.length) {
      const why = final ? 'Du bist in dieser Runde nicht dabei.' : v.me.playing ? 'Du schreibst ab der nächsten Runde mit – jetzt erst mal abstimmen.' : 'Gleich wird abgestimmt.';
      return `${timer}<div class="look-up">✍️<b>Die anderen schreiben …</b><small>${why}</small></div>
        ${final ? `<div class="prompt-card prompt-small">${promptHtml(w.prompt.text)}</div>` : ''}
        ${leadToolsHtml(v, [`<button class="btn btn-ghost btn-small" data-act="force" data-step="${esc(v.step)}">⏩ Für alle beenden</button>`])}`;
    }
    const answered = (m) => m.parts.some(Boolean);
    let page = ui.page;
    if (page === null || page === undefined) {
      const i = w.mine.findIndex((m) => !answered(m));
      page = i < 0 ? 'done' : i;
    }
    const lead = leadToolsHtml(v, [`<button class="btn btn-ghost btn-small" data-act="force" data-step="${esc(v.step)}">⏩ Für alle beenden</button>`]);
    if (page === 'done' || !w.mine[page]) {
      const list = w.mine
        .map(
          (m, i) => `<div class="my-answer ${answered(m) ? '' : 'is-missing'}">
            <small>${promptHtml(m.text)}</small>
            <b>${answered(m) ? answerHtml(m.parts) : '⚠️ noch keine Antwort'}</b>
            ${m.rescue ? '<span class="badge">🎲 Rettung · halbe Punkte</span>' : ''}
            <button class="btn btn-ghost btn-small" data-act="page" data-page="${i}">✏️ ändern</button>
          </div>`
        )
        .join('');
      const missing = w.mine.filter((m) => !answered(m)).length;
      return `${timer}
        <div class="submitted"><small>${missing ? 'Fast fertig' : 'Abgeschickt'}</small><b>${missing ? `Noch ${missing} offen` : '✓ Alles drin!'}</b></div>
        <div class="my-answers">${list}</div>
        <p class="waiting">${missing ? '' : '⏳ Warte auf die anderen … ändern geht noch.'}</p>
        ${lead}`;
    }
    const m = w.mine[page];
    const draft = ui.drafts[m.target] || [];
    const has = draft.some((t) => String(t || '').trim());
    const rescue = has && isRescue(m, draft);
    const last = page === w.mine.length - 1 || w.mine.every((x, i) => i === page || answered(x));
    return `${timer}
      <div class="write-head">${final ? '<b>🏁 Letzte Pointe</b>' : `<b>Satzanfang ${page + 1}/${w.mine.length}</b>`}${w.mine.length > 1 ? `<span class="pager">${w.mine.map((x, i) => `<button class="pager-dot ${i === page ? 'on' : ''} ${answered(x) ? 'done' : ''}" data-act="page" data-page="${i}" aria-label="Satzanfang ${i + 1}"></button>`).join('')}</span>` : ''}</div>
      <div class="prompt-card prompt-phone">${promptHtml(m.text)}</div>
      <form class="draft-form" data-form="draft" data-target="${esc(m.target)}" data-page="${page}" autocomplete="off">
        ${draftInputs(m, true)}
        ${rescue ? '<p class="rescue-note">🎲 Rettung – gibt nur <b>halbe Punkte</b>. Selbst etwas tippen lohnt sich!</p>' : ''}
        <div class="draft-actions">
          <button class="btn btn-ghost" type="button" data-act="rescue" data-target="${esc(m.target)}" title="Vorgefertigte Antwort (halbe Punkte)">🎲 Rettung</button>
          <button class="btn btn-primary btn-big" type="submit" ${has ? '' : 'disabled'}>${last ? 'Fertig ✓' : 'Weiter →'}</button>
        </div>
      </form>
      ${lead}`;
  }

  function phoneDuelHtml(v) {
    const d = v.duel;
    const reading = v.reading ? '<p class="muted center small">🗣️ Der Laptop liest gerade vor …</p>' : timerHtml(v.timer);
    const hide = (x) => (v.me.lead && d.role !== 'duelist' ? hideBtnHtml(d.id, x.key, x.hidden) : '');
    if (d.role === 'duelist') {
      return `<div class="look-up">😬<b>Du bist im Duell!</b><small>Schau auf den Laptop und leide still.</small></div>
        <div class="prompt-card prompt-small">${promptHtml(d.prompt.text)}</div>
        ${reading}
        <p class="muted center small">Abgestimmt: ${d.voted}/${d.voterCount}</p>
        ${leadToolsHtml(v, [`<button class="btn btn-ghost btn-small" data-act="force" data-step="${esc(v.step)}">⏩ Jetzt auflösen</button>`])}`;
    }
    if (d.role !== 'voter') {
      return `<div class="look-up">👀<b>Schau auf den Laptop</b><small>Duell ${d.no}/${d.total}</small></div>`;
    }
    const btn = (x) => `<div class="vote-wrap">
        <button class="vote-card ${d.myPick === x.key ? 'on' : ''} ${x.hidden ? 'is-hidden' : ''}" data-act="vote" data-duel="${esc(d.id)}" data-pick="${esc(x.key)}" aria-pressed="${d.myPick === x.key}" ${x.hidden ? 'disabled' : ''}>${answerHtml(x.parts)}</button>
        ${hide(x)}
      </div>`;
    return `<h2 class="phone-title">Welche ist besser?</h2>
      <div class="prompt-card prompt-small">${promptHtml(d.prompt.text)}</div>
      <div class="vote-list">${btn(d.sides[0])}${btn(d.sides[1])}</div>
      ${d.myPick ? '<p class="waiting">✓ Abgestimmt – du kannst noch wechseln.</p>' : ''}
      ${reading}
      ${leadToolsHtml(v, [`<button class="btn btn-ghost btn-small" data-act="force" data-step="${esc(v.step)}">⏩ Jetzt auflösen</button>`])}`;
  }

  function phoneResultHtml(v) {
    const d = v.duel;
    const mine = d.sides.find((x) => x.pid === v.me.id);
    const lead = leadToolsHtml(v, [
      ...(d.role !== 'duelist' ? d.sides.map((x) => `<button class="btn btn-ghost btn-small" data-act="hide" data-target="${esc(d.id)}" data-key="${esc(x.key)}" data-hidden="${x.hidden ? '0' : '1'}">${x.hidden ? '👁️ zeigen' : '🙈 ausblenden'}: ${esc(x.name)}</button>`) : []),
      `<button class="btn btn-primary btn-small" data-act="next" data-step="${esc(v.step)}">${d.last ? (v.plan[v.round] ? 'Zum Zwischenstand 📊' : 'Zur Siegerehrung 🏆') : 'Nächstes Duell →'}</button>`,
    ]);
    let head;
    if (mine) {
      head = mine.pointe
        ? `<div class="look-up win">😂<b>POINTE!</b><small>Alle Stimmen für dich · +${mine.points}</small></div>`
        : mine.win
          ? `<div class="look-up win">🎉<b>Gewonnen!</b><small>${mine.pct} % · +${mine.points}</small></div>`
          : d.forfeit === 'both'
            ? '<div class="look-up">🦗<b>Keine Antworten</b><small>Keine Punkte für niemanden.</small></div>'
            : `<div class="look-up">${mine.pct ? '😅' : '🦗'}<b>${mine.pct ? 'Knapp daneben' : 'Grillenzirpen …'}</b><small>${mine.pct} % · +${mine.points}</small></div>`;
    } else {
      const w = d.sides.find((x) => x.win);
      head = `<div class="look-up">${w ? (w.pointe ? '😂' : '🏆') : '🤝'}<b>${w ? `${esc(w.name)} ${w.pointe ? 'landet eine Pointe!' : 'gewinnt'}` : 'Unentschieden!'}</b><small>${d.sides.map((x) => `${esc(x.name)} ${x.pct} %`).join(' · ')}</small></div>`;
    }
    return `${head}
      <div class="mini-results">${d.sides.map((x) => `<div class="mini-result ${x.win ? 'is-win' : ''}" style="${tc(x.color)}"><span class="team-dot"></span><div>${answerHtml(x.parts)}<small>${esc(x.name)} · ${x.pct} % · +${x.points}${x.rescue ? ' · 🎲' : ''}</small></div></div>`).join('')}</div>
      ${sipsHtml(v, d.sips, v.me.id)}
      ${lead}`;
  }

  function phoneFinalVoteHtml(v) {
    const f = v.final;
    const lead = leadToolsHtml(v, [`<button class="btn btn-ghost btn-small" data-act="force" data-step="${esc(v.step)}">⏩ Jetzt auflösen</button>`]);
    if (!f.canVote) return `<div class="look-up">👀<b>Schau auf den Laptop</b><small>Die anderen stimmen ab.</small></div>${lead}`;
    const used = Object.values(ui.fvotes).reduce((a, b) => a + b, 0);
    const left = FINAL_VOTES - used;
    const rows = f.answers
      .map((x, i) => {
        const n = ui.fvotes[x.key] || 0;
        const ctrl = x.mine
          ? '<span class="mine-tag">deine</span>'
          : x.hidden
            ? '<span class="mine-tag">🙈</span>'
            : `<button class="fv-btn" data-act="fvote" data-key="${x.key}" data-delta="-1" ${n ? '' : 'disabled'} aria-label="Stimme weg">−</button><b class="fv-n">${'●'.repeat(n) || '0'}</b><button class="fv-btn" data-act="fvote" data-key="${x.key}" data-delta="1" ${left ? '' : 'disabled'} aria-label="Stimme dazu">＋</button>`;
        return `<div class="fv-row ${n ? 'on' : ''} ${x.mine ? 'is-mine' : ''}">
          <span class="final-no">${i + 1}</span>
          <div class="fv-text">${answerHtml(x.parts)}</div>
          <div class="fv-ctrl">${ctrl}</div>
        </div>`;
      })
      .join('');
    return `<h2 class="phone-title">🏁 Verteile ${FINAL_VOTES} Stimmen</h2>
      <div class="prompt-card prompt-small">${promptHtml(f.prompt.text)}</div>
      <div class="fv-list">${rows}</div>
      <p class="${left ? 'muted center' : 'waiting'}">${left ? `Noch ${left} ${plural(left, 'Stimme', 'Stimmen')} – auch mehrere für eine Antwort.` : '✓ Alle Stimmen vergeben – ändern geht noch.'}</p>
      ${v.reading ? '<p class="muted center small">🗣️ Der Laptop liest gerade vor …</p>' : timerHtml(v.timer)}
      ${lead}`;
  }

  function phoneFinalResultHtml(v) {
    const f = v.final;
    const mine = f.results.find((r) => r.pid === v.me.id);
    const rank = mine ? f.results.indexOf(mine) + 1 : 0;
    const top = f.results[0];
    const head = mine
      ? `<div class="look-up ${rank === 1 && mine.points ? 'win' : ''}">${rank === 1 && mine.points ? '👑' : '🏁'}<b>+${mine.points} Punkte</b><small>${mine.votes} ${plural(mine.votes, 'Stimme', 'Stimmen')}${mine.aud ? ` + ${mine.aud}× Publikum` : ''} · Platz ${rank} von ${f.results.length}</small></div>`
      : `<div class="look-up">🏁<b>${top && top.points ? `${esc(top.name)} gewinnt die Letzte Pointe` : 'Aufgelöst!'}</b><small>Schau auf den Laptop</small></div>`;
    return `${head}${sipsHtml(v, f.sips, v.me.id)}
      ${leadToolsHtml(v, [`<button class="btn btn-primary btn-small" data-act="next" data-step="${esc(v.step)}">${esc(nextLabel(v))}</button>`])}`;
  }

  function phoneScoresHtml(v) {
    const s = v.standings.find((x) => x.id === v.me.id);
    const g = (v.gains || {})[v.me.id] || 0;
    const lead = leadToolsHtml(v, [`<button class="btn btn-primary btn-small" data-act="next" data-step="${esc(v.step)}">${esc(nextLabel(v))}</button>`]);
    if (!s) return `<div class="look-up">📊<b>Zwischenstand</b><small>Schau auf den Laptop!</small></div>${lead}`;
    return `<div class="look-up ${s.place === 1 ? 'win' : ''}">📊<b>Platz ${s.place} von ${v.standings.length}</b><small>${s.score} Punkte${g ? ` · diese Runde +${g}` : ''}</small></div>
      ${v.plan[v.round] && v.plan[v.round] !== 'final' ? '<p class="center muted">Nächste Runde zählt noch mehr – alles ist offen!</p>' : ''}
      ${lead}`;
  }

  function phoneEndHtml(v) {
    const s = v.standings.find((x) => x.id === v.me.id);
    const st = v.stats && v.stats[v.me.id];
    const head = s
      ? s.place === 1
        ? `<div class="look-up win">🏆<b>Gewonnen!</b><small>${s.score} Punkte</small></div>`
        : `<div class="look-up">${['', '🥇', '🥈', '🥉'][s.place] || '🏅'}<b>Platz ${s.place}</b><small>${s.score} Punkte</small></div>`
      : '<div class="look-up">🏁<b>Spiel vorbei</b></div>';
    const mine = st ? `<div class="my-stats"><span>😂 ${st.pointes}× Pointe!</span><span>🏆 ${st.wins} Duelle gewonnen</span><span>🗳️ ${st.votes} Stimmen</span><span>🦗 ${st.zero}× keine Stimme</span>${st.rescues ? `<span>🎲 ${st.rescues}× Rettung</span>` : ''}</div>` : '';
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
    else if (ui.modal === 'qr') {
      body = `<h2>📱 Mitspieler einladen</h2>${roomBoxHtml(ui.view && ui.view.room, false)}
        <p class="muted small center">Wer jetzt beitritt, stimmt sofort mit ab und schreibt ab der nächsten Runde mit.</p>
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
        <p>Auf dem Handy bekommt ihr <b>lustige Satzanfänge</b> – <i>„Der schlechteste Name für ein Kreuzfahrtschiff: ___“</i> – und tippt
          die witzigste Antwort, die euch einfällt. Jeder Satzanfang geht an <b>genau zwei Personen</b>.</p>
        <h3>✍️ Schreiben</h3>
        <p>Jede/r bekommt <b>zwei Satzanfänge</b>, jeweils gegen jemand anderen. Keine Idee? <b>🎲 Rettung</b> setzt eine fertige Antwort ein –
          die bringt aber nur <b>halbe Punkte</b>. Keine Antwort verliert automatisch.</p>
        <h3>⚔️ Duelle</h3>
        <p>Der Laptop zeigt (und liest vor) den Satzanfang und beide Antworten – <b>ohne Namen</b>. Alle anderen stimmen auf dem Handy ab.
          Dann wird aufgelöst: Wer war's und wie viele Stimmen gab es?</p>
        <h3>🏆 Punkte</h3>
        <p><b>10 Punkte pro Prozent</b> der Stimmen, <b>+100</b> fürs gewonnene Duell, <b>+250</b> für eine <b>„Pointe!“</b> – alle Stimmen für dich.
          Runde 2 zählt <b>doppelt</b>, Runde 3 dreifach. Das Publikum zählt zusammen als 20 % der Stimmen.</p>
        <h3>🏁 Letzte Pointe</h3>
        <p>Zum Schluss beantworten <b>alle denselben</b> Satzanfang (manchmal mit mehreren Lücken). Jede/r verteilt <b>3 Stimmen</b> –
          auch mehrere auf eine Antwort, nur nicht auf die eigene. <b>300 Punkte pro Stimme.</b></p>
        <h3>🙈 Ausblenden</h3>
        <p>Freie Texte kann die App nicht prüfen. Die Spielleitung (Laptop oder erstes Handy) kann eine Antwort ausblenden – das Duell zählt dann für den Gegner.</p>
        <h3>🍻 Trinkregeln (ab 18, optional)</h3>
        <p>Keine einzige Stimme bekommen → 2 Schlucke. Pointe! gelandet → 3 Schlucke verteilen.</p>
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

  function menuHtml() {
    const v = ui.view;
    const items = [];
    items.push(`<button class="menu-item" data-act="rules">📖 Spielregeln</button>`);
    items.push(`<button class="menu-item" data-act="mute">${Sound.muted ? '🔊 Ton einschalten' : '🔇 Ton ausschalten'}</button>`);
    if (v && v.me.stage) {
      items.push(`<button class="menu-item" data-act="voice">🗣️ Stimme & Tempo</button>`);
      if (v.room) items.push(`<button class="menu-item" data-act="show-qr">📱 Mitspieler einladen</button>`);
      items.push(`<button class="menu-item" data-act="home-keep">🏠 Hauptmenü <small>(Spiel bleibt gespeichert)</small></button>`);
      if (!['lobby', 'end'].includes(v.phase)) items.push(`<button class="menu-item danger" data-act="end-game">⏹️ Spiel beenden & Siegerehrung</button>`);
      items.push(`<button class="menu-item danger" data-act="close-game">🚪 Spiel schließen</button>`);
    } else if (v) {
      if (v.phase === 'lobby' && v.me.playing && v.settings.audience) items.push(`<button class="menu-item" data-act="watch" data-watch="1">👥 Nur abstimmen (Publikum)</button>`);
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

  /** Handy: Antwort abschicken und zur nächsten offenen Karte */
  function submitDraft(target, page) {
    const v = ui.view;
    if (!v || !v.write) return;
    const d = ui.drafts[target] || [];
    if (!d.some((t) => String(t || '').trim())) return;
    sendAnswer(target);
    if (document.activeElement) document.activeElement.blur();
    const mine = v.write.mine;
    const next = mine.findIndex((m, i) => i !== page && !m.parts.some(Boolean));
    ui.page = next < 0 ? 'done' : next;
    if (next >= 0) ui.focus = `#draft-${CSS.escape(mine[next].target)}-0`;
    render();
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
    'voice-test': () => Speech.say('Der schlechteste Name für ein Kreuzfahrtschiff. MS Seekrank!'),
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
      setSettings(el.dataset.scope, { [key]: +el.dataset.value });
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
      flushDrafts();
      dispatch('next', { force: true, step: el.dataset.step });
    },
    next: (el) => dispatch('next', { step: el.dataset.step }),
    hide: (el) => dispatch('hide', { target: el.dataset.target, key: el.dataset.key, hidden: el.dataset.hidden === '1' }),
    page: (el) => {
      ui.page = +el.dataset.page;
      const v = ui.view;
      const m = v && v.write && v.write.mine[ui.page];
      if (m) ui.focus = `#draft-${CSS.escape(m.target)}-0`;
      render();
    },
    rescue: (el) => {
      const v = ui.view;
      const m = v && v.write && v.write.mine.find((x) => x.target === el.dataset.target);
      if (!m || !m.rescues.length) return;
      const i = ((ui.rescueIdx[m.target] ?? -1) + 1) % m.rescues.length;
      ui.rescueIdx[m.target] = i;
      ui.drafts[m.target] = m.rescues[i].slice();
      render();
    },
    vote: (el) => {
      vibrate(20);
      dispatch('vote', { duel: el.dataset.duel, pick: el.dataset.pick });
    },
    fvote: (el) => {
      const v = ui.view;
      if (!v || !v.final) return;
      const key = el.dataset.key;
      const delta = +el.dataset.delta;
      const used = Object.values(ui.fvotes).reduce((a, b) => a + b, 0);
      const n = (ui.fvotes[key] || 0) + delta;
      if (n < 0 || (delta > 0 && used >= FINAL_VOTES)) return;
      if (n) ui.fvotes[key] = n;
      else delete ui.fvotes[key];
      vibrate(15);
      dispatch('votes', { final: v.final.id, votes: Object.assign({}, ui.fvotes) });
      render();
    },
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
    if (f === 'name') ui.name = el.value;
    else if (f === 'join-code') ui.joinCode = Net.cleanCode(el.value);
    else if (f === 'draft') {
      const t = el.dataset.target;
      const d = (ui.drafts[t] = ui.drafts[t] || []);
      d[+el.dataset.i] = el.value.replace(/\n/g, ' ').slice(0, MAX_ANSWER);
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
    } else if (el.dataset.field === 'draft') {
      // Enter: nächstes Feld bzw. abschicken
      e.preventDefault();
      const next = app.querySelector(`#draft-${CSS.escape(el.dataset.target)}-${+el.dataset.i + 1}`);
      if (next) next.focus();
      else {
        const form = el.closest('form');
        if (form) form.requestSubmit ? form.requestSubmit() : form.querySelector('[type="submit"]').click();
      }
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
    } else if (form.dataset.form === 'draft') {
      submitDraft(form.dataset.target, +form.dataset.page);
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

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.POINTE_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  requestAnimationFrame(timerLoop);
  autoResume();

  // für Tests
  window.PointeApp = { ui, render: renderNow, actions };
})();
