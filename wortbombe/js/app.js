/*
 * Oberfläche von „Wortbombe“ – ein Gerät, das im Kreis herumgeht.
 *  Start → Spiel anlegen (Namen in Sitzreihenfolge, Modus, Stufe, Zündschnur …) → Aufgabe + „Zünden“
 *  → Bombe tickt (ganzes Display = weitergeben) → BUMM (Strafpunkt, ggf. umhängen) → … → Siegerehrung
 * Gerendert wird per HTML-String + morphdom. Die Bombe selbst (Zündschnur, Funke) bewegt sich per
 * requestAnimationFrame direkt im DOM und wird von morphdom nicht angefasst (data-live).
 */
(function () {
  'use strict';

  const E = window.WBEngine;
  const { Engine, FUSES, STRIKES_OUT, ROUNDS, MIN_PLAYERS, MAX_PLAYERS, MAX_NAME, sanitizeSettings, cleanName } = E;
  const Bomb = window.WBBomb;
  const { Sound, confetti } = window.GameFx;

  const MODE = {
    mix: { icon: '🎲', label: 'Gemischt', ex: 'jede Runde ein anderer Modus' },
    silbe: { icon: '🔤', label: 'Silbe', ex: 'Wort mit -ung-, -tt-, schl-' },
    anfang: { icon: '▶️', label: 'Anfang', ex: 'beginnt mit Ver…, Kr…' },
    ende: { icon: '◀️', label: 'Ende', ex: 'endet auf …heit, …chen' },
    kategorie: { icon: '📦', label: 'Kategorie', ex: 'Dinge im Bad, Automarken' },
    kette: { icon: '🔗', label: 'Kette', ex: 'Haus → Sonne → Esel' },
  };
  const LEVEL = { leicht: '🙂 Leicht', mittel: '😬 Mittel', schwer: '🥵 Schwer' };
  const FUSE = { kurz: 'Kurz', normal: 'Normal', lang: 'Lang' };
  const OUT = {
    three: { icon: '☠️', label: `${STRIKES_OUT} Strafpunkte`, text: 'dann raus – wer übrig bleibt, gewinnt' },
    rounds: { icon: '🔟', label: `${ROUNDS} Runden`, text: 'wenigste Strafpunkte gewinnen' },
  };

  const SETUP_KEY = 'wortbombe.setup.v1';
  const GAME_KEY = 'wortbombe.game.v1';
  const USED_KEY = 'wortbombe.used.v1';
  const EVENING = 12 * 60 * 60 * 1000; // „ein Abend“: so lange wiederholen sich keine Aufgaben
  const PASS_GAP = 350; // ms – schneller hintereinander zählt nicht als zweites Weitergeben
  const BOOM_LOCK = 1600; // ms – so lange nach dem Knall sind die Knöpfe gesperrt (wildes Tippen)
  const FUSE_PATH = 'M164 86 C 178 70, 168 52, 186 42 S 226 40, 218 16';
  const FUSE_TIP = [218, 16];

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

  const Store = {
    get(key) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* voll oder gesperrt – dann eben ohne */
      }
    },
    remove(key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* egal */
      }
    },
  };

  function plural(n, one, many) {
    return n === 1 ? one : many;
  }

  function vibrate(p) {
    try {
      if (navigator.vibrate) navigator.vibrate(p);
    } catch {
      /* egal */
    }
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  /* Speicher: Einstellungen, laufendes Spiel, Aufgaben des Abends        */
  /* ------------------------------------------------------------------ */

  function loadSetup() {
    const s = Store.get(SETUP_KEY) || {};
    const names = Array.isArray(s.names) ? s.names.map((n) => String(n || '').slice(0, MAX_NAME)).slice(0, MAX_PLAYERS) : [];
    while (names.length < MIN_PLAYERS) names.push('');
    return { names, settings: sanitizeSettings(s.settings) };
  }

  function saveSetup() {
    Store.set(SETUP_KEY, ui.setup);
  }

  const evening = (() => {
    const saved = Store.get(USED_KEY);
    if (saved && Array.isArray(saved.keys) && Date.now() - saved.at < EVENING) return saved;
    return { at: Date.now(), keys: [] };
  })();

  function onDraw(task, reset) {
    if (reset) {
      const prefix = task.key.split(':')[0] + ':';
      evening.keys = evening.keys.filter((k) => !k.startsWith(prefix));
    }
    if (!evening.keys.includes(task.key)) evening.keys.push(task.key);
    Store.set(USED_KEY, evening);
  }

  const hooks = { used: () => evening.keys, onDraw };

  function saveGame() {
    if (!game) return;
    if (game.s.phase === 'end') Store.remove(GAME_KEY);
    else Store.set(GAME_KEY, { at: Date.now(), state: game.s });
  }

  function savedGame() {
    const g = Store.get(GAME_KEY);
    if (!g || !g.state || g.state.v !== 1 || Date.now() - g.at > EVENING) return null;
    return g;
  }

  /* ------------------------------------------------------------------ */
  /* Zustand der Oberfläche                                              */
  /* ------------------------------------------------------------------ */

  const ui = {
    screen: 'home', // home | setup | game
    setup: loadSetup(),
    modal: null, // rules | menu | blame | quit
    toast: null,
    boomUntil: 0,
    focus: null,
  };
  let game = null; // Engine
  let bomb = null; // WBBomb.Player der laufenden Runde
  let raf = null;
  let lastPass = 0;
  let toastTimer = null;

  function toast(text) {
    ui.toast = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      ui.toast = null;
      render();
    }, 2600);
    render();
  }

  /* ------------------------------------------------------------------ */
  /* Bausteine                                                           */
  /* ------------------------------------------------------------------ */

  function logoHtml() {
    return `<div class="logo" aria-label="Wortbombe">
      <span class="logo-icon" aria-hidden="true">💣</span>
      <span class="logo-text">Wort<span>bombe</span></span>
    </div>`;
  }

  /** Aufgabe als { prompt, big, hint, long } */
  function taskText(task) {
    const up = task.text.toUpperCase();
    switch (task.mode) {
      case 'silbe':
        return { prompt: 'Ein Wort mit', big: `– ${up} –`, hint: 'Die Buchstaben dürfen irgendwo im Wort stehen.' };
      case 'anfang':
        return { prompt: 'Ein Wort, das beginnt mit', big: `${up}…`, hint: 'Das Wort muss genau so anfangen.' };
      case 'ende':
        return { prompt: 'Ein Wort, das endet auf', big: `…${up}`, hint: 'Das Wort muss genau so aufhören.' };
      case 'kategorie':
        return { prompt: 'Etwas aus der Kategorie', big: task.text, hint: 'Jeder Begriff nur einmal pro Runde.', long: task.text.length > 14 };
      case 'kette':
        return { prompt: 'Wortkette! Los geht’s mit', big: up, hint: 'Jedes Wort beginnt mit dem letzten Buchstaben des vorigen – laut sagen!' };
      default:
        return { prompt: '', big: up, hint: '' };
    }
  }

  function taskHtml(task, compact) {
    const t = taskText(task);
    const m = MODE[task.mode];
    return `
      <div class="task mode-${task.mode} ${compact ? 'task-compact' : ''}">
        <span class="task-mode">${m.icon} ${m.label}${task.adult ? ' · 🔞' : ''}</span>
        <p class="task-prompt">${esc(t.prompt)}</p>
        <div class="task-big ${t.long ? 'is-long' : ''} ${t.big.length > 26 ? 'is-longer' : ''}">${esc(t.big)}</div>
        ${compact ? '' : `<p class="task-hint">${esc(t.hint)}</p>`}
      </div>`;
  }

  function dotsHtml(p) {
    if (game.s.settings.out !== 'three') return `<span class="strikes-num">${p.strikes} 💥</span>`;
    let h = '';
    for (let i = 0; i < STRIKES_OUT; i++) h += `<i class="${i < p.strikes ? 'on' : ''}"></i>`;
    return `<span class="dots" aria-label="${p.strikes} von ${STRIKES_OUT} Strafpunkten">${h}</span>`;
  }

  function scoreHtml(highlight) {
    if (!game.named) return '';
    return `<ul class="score">${game.s.players
      .map(
        (p, i) => `
        <li class="${p.out ? 'is-out' : ''} ${i === highlight ? 'is-hot' : ''}">
          <span class="score-name">${p.out ? '☠️ ' : ''}${esc(p.name)}</span>${dotsHtml(p)}
        </li>`
      )
      .join('')}</ul>`;
  }

  function roundLabel() {
    const s = game.s;
    return s.settings.names && s.settings.out === 'rounds' ? `Runde ${s.round} von ${ROUNDS}` : `Runde ${s.round}`;
  }

  function muteBtn() {
    return `<button class="icon-btn" data-act="mute" title="Ton an/aus" aria-label="Ton ${Sound.muted ? 'an' : 'aus'}schalten">${Sound.muted ? '🔇' : '🔊'}</button>`;
  }

  function bombSvg(live) {
    return `
      <svg class="bomb" viewBox="0 0 240 240" ${live ? 'data-live="1"' : ''} aria-hidden="true">
        <defs>
          <radialGradient id="wb-body" cx="36%" cy="34%" r="70%">
            <stop offset="0" stop-color="#6b7180" />
            <stop offset="0.45" stop-color="#252830" />
            <stop offset="1" stop-color="#090a0d" />
          </radialGradient>
          <radialGradient id="wb-glow">
            <stop offset="0" stop-color="#fff6d6" />
            <stop offset="0.3" stop-color="#ffc44d" />
            <stop offset="0.65" stop-color="rgba(255,110,40,0.55)" />
            <stop offset="1" stop-color="rgba(255,80,20,0)" />
          </radialGradient>
        </defs>
        <path class="fuse-ash" d="${FUSE_PATH}" />
        <path class="fuse" d="${FUSE_PATH}" />
        <g class="bomb-body">
          <circle cx="104" cy="148" r="74" fill="url(#wb-body)" />
          <ellipse cx="78" cy="118" rx="22" ry="12" transform="rotate(-38 78 118)" fill="#fff" opacity="0.18" />
          <rect x="146" y="78" width="28" height="22" rx="5" transform="rotate(45 160 89)" fill="#3a3e48" />
          <rect x="150" y="80" width="20" height="5" rx="2" transform="rotate(45 160 89)" fill="#555b67" />
        </g>
        ${
          live
            ? `<g class="spark" transform="translate(${FUSE_TIP[0]} ${FUSE_TIP[1]})">
                <circle class="spark-glow" r="22" fill="url(#wb-glow)" />
                <circle class="spark-core" r="5" fill="#fffbe8" />
                ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<circle class="sp sp${i}" r="2" />`).join('')}
              </g>`
            : `<circle cx="${FUSE_TIP[0]}" cy="${FUSE_TIP[1]}" r="4" fill="#c9a46a" />`
        }
      </svg>`;
  }

  /* ------------------------------------------------------------------ */
  /* Bildschirme                                                         */
  /* ------------------------------------------------------------------ */

  function homeHtml() {
    const saved = savedGame();
    let resume = '';
    if (saved) {
      const s = saved.state;
      const who = s.players.length ? s.players.map((p) => p.name).join(', ') : 'ohne Namen';
      resume = `
        <div class="resume">
          <button class="btn btn-ghost btn-wide" data-act="resume">▶ Weiterspielen
            <small>Runde ${s.round} · ${esc(who)}</small></button>
          <button class="icon-btn" data-act="discard" title="Verwerfen" aria-label="Gespeichertes Spiel verwerfen">✕</button>
        </div>`;
    }
    return `
    <div class="screen home">
      <div class="home-top">
        <a class="btn btn-ghost btn-small hub-back" href="../">← Alle Spiele</a>
        ${muteBtn()}
      </div>
      <div class="home-hero">
        <div class="home-bomb">${bombSvg(false)}</div>
        ${logoHtml()}
        <p class="tagline">Ein Wort sagen, antippen, weitergeben –<br>bevor es <b>BUMM</b> macht.</p>
      </div>
      ${resume}
      <button class="btn btn-primary btn-big btn-wide" data-act="setup">💣 Neues Spiel</button>
      <button class="btn btn-link" data-act="rules">📖 Spielregeln</button>
      <p class="home-foot">${MIN_PLAYERS}–${MAX_PLAYERS} Personen · ein Gerät, das herumgeht · funktioniert offline</p>
    </div>`;
  }

  function choice(key, value, label, on, extra) {
    return `<button class="choice ${on ? 'on' : ''}" data-act="set" data-key="${key}" data-value="${value}" aria-pressed="${on}">${label}${extra || ''}</button>`;
  }

  function toggle(key, on, label, text) {
    return `
      <button class="toggle ${on ? 'on' : ''}" data-act="flip" data-key="${key}" role="switch" aria-checked="${on}">
        <span class="toggle-body"><b>${label}</b><small>${text}</small></span>
        <span class="switch" aria-hidden="true"><i></i></span>
      </button>`;
  }

  function setupHtml() {
    const s = ui.setup;
    const st = s.settings;
    const names = s.names
      .map(
        (n, i) => `
        <li class="name-row">
          <span class="seat">${i + 1}</span>
          <input type="text" maxlength="${MAX_NAME}" value="${esc(n)}" placeholder="Name ${i + 1}" data-field="name" data-i="${i}" id="name-${i}" autocomplete="off" enterkeyhint="next" />
          <button class="icon-btn" data-act="remove-name" data-i="${i}" title="Entfernen" aria-label="${esc(n || 'Name ' + (i + 1))} entfernen" ${s.names.length <= MIN_PLAYERS ? 'disabled' : ''}>✕</button>
        </li>`
      )
      .join('');
    const filled = s.names.map(cleanName).filter(Boolean);
    const dupe = new Set(filled.map((n) => n.toLowerCase())).size !== filled.length;
    let problem = '';
    if (st.names && filled.length < MIN_PLAYERS) problem = `Mindestens ${MIN_PLAYERS} Namen eintragen`;
    else if (st.names && dupe) problem = 'Zwei Personen heißen gleich – bitte unterscheidbar machen';
    const fuseRange = (id) => `<small>${FUSES[id][0]}–${FUSES[id][1]} s</small>`;
    const showAdult = st.mode === 'kategorie' || st.mode === 'mix';
    return `
    <div class="screen setup">
      <header class="screen-head">
        <button class="icon-btn" data-act="home" title="Zurück" aria-label="Zurück">←</button>
        <h1>Neues Spiel</h1>
        ${muteBtn()}
      </header>

      <section class="panel">
        ${toggle('names', st.names, '👥 Namen eintragen', st.names ? 'Strafpunkte pro Person, Gewinner am Ende' : 'Ohne Namen zählt das Spiel nur die Runden')}
        ${
          st.names
            ? `<p class="note">In <b>Sitzreihenfolge</b> eintragen – die Bombe wandert im Uhrzeigersinn, so weiß das Handy, wer sie hält.</p>
               <ol class="names">${names}</ol>
               ${s.names.length < MAX_PLAYERS ? `<button class="btn btn-ghost btn-small" data-act="add-name">＋ Person</button>` : ''}`
            : ''
        }
      </section>

      <section class="panel">
        <h2>Aufgabe</h2>
        <div class="modes">
          ${Object.entries(MODE)
            .map(
              ([id, m]) => `
            <button class="mode ${st.mode === id ? 'on' : ''}" data-act="set" data-key="mode" data-value="${id}" aria-pressed="${st.mode === id}">
              <span class="mode-icon">${m.icon}</span><b>${m.label}</b><small>${m.ex}</small>
            </button>`
            )
            .join('')}
        </div>
        <h2>Schwierigkeit</h2>
        <div class="choices">${Object.entries(LEVEL)
          .map(([id, l]) => choice('level', id, l, st.level === id))
          .join('')}</div>
        ${st.mode === 'kette' ? '<p class="note">Bei der Wortkette gibt es keine Stufen.</p>' : ''}
        <h2>Zündschnur</h2>
        <div class="choices">${Object.entries(FUSE)
          .map(([id, l]) => choice('fuse', id, l, st.fuse === id, fuseRange(id)))
          .join('')}</div>
        <p class="note">Wann es knallt, weiß niemand – auch das Ticken verrät es nicht sicher.</p>
      </section>

      <section class="panel">
        ${
          st.names
            ? `<h2>Wertung</h2>
               <div class="choices">${Object.entries(OUT)
                 .map(([id, o]) => choice('out', id, `${o.icon} ${o.label}`, st.out === id, `<small>${o.text}</small>`))
                 .join('')}</div>`
            : ''
        }
        ${showAdult ? toggle('adult', st.adult, '🔞 Ab 18', 'Zusätzliche Kategorien für Erwachsene') : ''}
        ${toggle('drinks', st.drinks, '🍻 Trinkregeln', 'BUMM → 1 Schluck · 3. Strafpunkt → 3 Schlucke')}
      </section>

      <div class="setup-go">
        ${problem ? `<p class="problem">${esc(problem)}</p>` : ''}
        <button class="btn btn-primary btn-big btn-wide" data-act="start" ${problem ? 'disabled' : ''}>💣 Los geht’s</button>
      </div>
    </div>`;
  }

  function readyHtml() {
    const s = game.s;
    let who = '';
    if (game.named) {
      const name = esc(s.players[s.starter].name);
      const prev = s.log.length ? s.log[s.log.length - 1].loser : null;
      who = s.round === 1 || prev === null ? `🎲 <b>${name}</b> fängt an` : prev === s.starter ? `<b>${name}</b> hat verloren und fängt an` : `<b>${name}</b> fängt an`;
    } else {
      who = 'Wer zündet, fängt an.';
    }
    return `
    <div class="screen game ready">
      <header class="bar">
        <span class="round">${roundLabel()}</span>
        <span class="bar-right">${muteBtn()}<button class="icon-btn" data-act="menu" title="Menü" aria-label="Menü">☰</button></span>
      </header>
      ${taskHtml(s.task)}
      <p class="starter">${who}</p>
      <button class="btn btn-ignite" data-act="ignite">🔥 Zünden</button>
      <button class="btn btn-link" data-act="skip">🔄 Andere Aufgabe</button>
      ${scoreHtml(s.starter)}
    </div>`;
  }

  function burningHtml() {
    const s = game.s;
    const holder = game.named ? s.players[s.holder].name : null;
    return `
    <div class="screen game burning" data-act="pass">
      <header class="bar">
        <span class="round">${roundLabel()}</span>
        <button class="icon-btn abort" data-act="abort" title="Runde abbrechen" aria-label="Runde abbrechen">✕</button>
      </header>
      ${taskHtml(s.task, true)}
      <div class="bomb-wrap">${bombSvg(true)}</div>
      ${
        holder
          ? `<p class="holder" aria-live="polite"><b class="holder-name" data-k="${s.passes}">${esc(holder)}</b> hat die Bombe</p>`
          : `<p class="holder" aria-live="polite"><b class="holder-name" data-k="${s.passes}">${s.passes}</b> ${plural(s.passes, 'Wort', 'Wörter')}</p>`
      }
      <p class="hint">Wort sagen – dann <b>irgendwo tippen</b> = weitergeben</p>
      <p class="grip">Gut festhalten! 😄</p>
    </div>`;
  }

  function boomHtml() {
    const s = game.s;
    const l = s.last;
    const locked = Date.now() < ui.boomUntil;
    const over = game.isOver();
    let who;
    let strike = '';
    let drink = '';
    if (game.named) {
      const name = esc(s.players[l.loser].name);
      who = `<b>${name}</b> hatte die Bombe!`;
      if (l.out) strike = `<p class="boom-strike is-out">☠️ ${name} scheidet aus!</p>`;
      else if (s.settings.out === 'three') strike = `<p class="boom-strike">Strafpunkt ${l.strikes} von ${STRIKES_OUT}</p>`;
      else strike = `<p class="boom-strike">${l.strikes}. Strafpunkt</p>`;
      if (s.settings.drinks) drink = `<p class="drink">🍻 ${name} trinkt ${l.sips} ${plural(l.sips, 'Schluck', 'Schlucke')}</p>`;
    } else {
      who = 'Wer die Bombe hält, hat verloren!';
      if (s.settings.drinks) drink = `<p class="drink">🍻 ${l.sips} Schluck für die Person mit der Bombe</p>`;
    }
    const words = l.passes ? `<p class="boom-stats">${l.passes} ${plural(l.passes, 'Wort', 'Wörter')} in dieser Runde</p>` : '';
    return `
    <div class="screen game boom">
      <div class="flash" aria-hidden="true"></div>
      <div class="boom-icon" aria-hidden="true">💥</div>
      <h1 class="boom-title" role="alert">BUMM!</h1>
      <p class="boom-who">${who}</p>
      ${strike}
      ${drink}
      ${words}
      ${game.named ? `<button class="btn btn-link" data-act="blame-open" ${locked ? 'disabled' : ''}>Falsche Person erwischt?</button>` : ''}
      ${scoreHtml(l.loser)}
      <button class="btn btn-primary btn-big btn-wide" data-act="next" ${locked ? 'disabled' : ''}>${over ? '🏆 Zur Siegerehrung' : 'Nächste Runde →'}</button>
      ${game.named ? '' : `<button class="btn btn-link" data-act="quit">Spiel beenden</button>`}
    </div>`;
  }

  function endHtml() {
    const s = game.s;
    const wins = game.winners();
    const names = wins.map((w) => esc(w.name));
    const title = names.length === 1 ? `${names[0]} gewinnt!` : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]} gewinnen!`;
    const three = s.settings.out === 'three';
    const rows = game
      .ranking()
      .map(
        (r) => `
        <li class="${r.place === 1 ? 'is-win' : ''}">
          <span class="place">${r.place === 1 ? '🏆' : r.place + '.'}</span>
          <span class="score-name">${esc(r.name)}</span>
          <span class="rank-info">${three ? (r.out ? `raus in Runde ${s.players[r.i].outRound}` : 'übrig geblieben') : `${r.strikes} ${plural(r.strikes, 'Strafpunkt', 'Strafpunkte')}`}</span>
        </li>`
      )
      .join('');
    return `
    <div class="screen end">
      <div class="trophy" aria-hidden="true">🏆</div>
      <h1>${title}</h1>
      <p class="end-sub">${s.round} ${plural(s.round, 'Runde', 'Runden')} · ${s.log.reduce((n, r) => n + (r.passes || 0), 0)} Wörter gesagt</p>
      <ol class="ranking">${rows}</ol>
      <div class="end-actions">
        <button class="btn btn-primary btn-big btn-wide" data-act="rematch">🔁 Revanche</button>
        <button class="btn btn-ghost btn-wide" data-act="setup">⚙️ Neues Spiel</button>
        <a class="btn btn-link" href="../">← Alle Spiele</a>
      </div>
    </div>`;
  }

  function rulesHtml() {
    return `
      <h2>📖 So geht’s</h2>
      <ol class="rules">
        <li>Das Handy zeigt eine <b>Aufgabe</b> – z. B. <i>„Ein Wort mit -UNG-“</i>. Wer anfängt, drückt <b>🔥 Zünden</b>.</li>
        <li>Die Bombe tickt. Wer sie hat, sagt ein <b>passendes Wort</b>, das in dieser Runde noch nicht kam, und
            <b>tippt aufs Display</b> – erst dann ist sie weitergegeben. Danach im Uhrzeigersinn an die nächste Person.</li>
        <li>Die Zündschnur ist <b>zufällig lang</b>. Das Ticken wird schneller – aber nicht verlässlich.</li>
        <li><b>💥 BUMM:</b> Wer die Bombe in der Hand hält, bekommt einen Strafpunkt – ohne Diskussion.</li>
        <li>Ungültige Wörter darf die Gruppe nur <b>während</b> der Runde ablehnen (<i>„Gilt nicht!“</i>) – dann muss
            ein neues Wort her, bevor weitergegeben wird.</li>
        <li>Die nächste Runde beginnt, wer verloren hat. Mit Wertung „${STRIKES_OUT} Strafpunkte“ scheidet aus, wer ${STRIKES_OUT} hat –
            die letzte Person gewinnt.</li>
      </ol>
      <h3>Modi</h3>
      <ul class="rules-modes">
        ${['silbe', 'anfang', 'ende', 'kategorie', 'kette', 'mix'].map((id) => `<li>${MODE[id].icon} <b>${MODE[id].label}</b> – ${MODE[id].ex}</li>`).join('')}
      </ul>
      <p class="note">Die Schwierigkeit ist ehrlich gezählt: Für jede Silbe wurde in einer großen deutschen Wortliste
        nachgesehen, wie viele Wörter passen.</p>`;
  }

  function modalHtml() {
    if (!ui.modal) return '';
    let body = '';
    if (ui.modal === 'rules') {
      body = rulesHtml();
    } else if (ui.modal === 'menu') {
      body = `
        <h2>Menü</h2>
        <div class="menu">
          <button class="btn btn-ghost btn-wide" data-act="mute">${Sound.muted ? '🔊 Ton einschalten' : '🔇 Ton ausschalten'}</button>
          <button class="btn btn-ghost btn-wide" data-act="rules">📖 Spielregeln</button>
          <button class="btn btn-danger btn-wide" data-act="quit">Spiel beenden</button>
        </div>`;
    } else if (ui.modal === 'quit') {
      body = `
        <h2>Spiel beenden?</h2>
        <p>Der Spielstand wird gelöscht.</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-act="close-modal">Weiterspielen</button>
          <button class="btn btn-danger" data-act="quit-yes">Beenden</button>
        </div>`;
    } else if (ui.modal === 'blame') {
      const s = game.s;
      body = `
        <h2>Wer hatte die Bombe wirklich?</h2>
        <p class="note">Der Strafpunkt wandert zu der Person, die ihr antippt.</p>
        <div class="blame">${s.players
          .map((p, i) => ({ p, i }))
          .filter(({ p, i }) => !p.out || i === s.last.loser)
          .map(({ p, i }) => `<button class="btn ${i === s.last.loser ? 'btn-primary' : 'btn-ghost'}" data-act="blame" data-i="${i}">${esc(p.name)}</button>`)
          .join('')}</div>`;
    }
    return `
      <div class="modal-bg" data-act="close-modal-bg">
        <div class="modal" role="dialog" aria-modal="true">
          <button class="icon-btn modal-close" data-act="close-modal" aria-label="Schließen">✕</button>
          ${body}
        </div>
      </div>`;
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
    if (ui.screen === 'setup') html = setupHtml();
    else if (ui.screen === 'game' && game) {
      const phase = game.s.phase;
      html = phase === 'burning' ? burningHtml() : phase === 'boom' ? boomHtml() : phase === 'end' ? endHtml() : readyHtml();
    } else html = homeHtml();
    html += modalHtml();
    if (ui.toast) html += `<div class="toast" role="status">${esc(ui.toast)}</div>`;
    window.morphdom(app, `<div id="app">${html}</div>`, {
      onBeforeElUpdated(fromEl, toEl) {
        // Bombe der laufenden Runde: Zündschnur und Funke bewegt burnFrame()
        if (fromEl.dataset && fromEl.dataset.live && toEl.dataset && toEl.dataset.live) return false;
        if (fromEl === document.activeElement && fromEl.tagName === 'INPUT') return false;
        return true;
      },
    });
    if (ui.focus) {
      const el = app.querySelector(ui.focus);
      ui.focus = null;
      if (el) el.focus();
    }
    document.body.classList.toggle('is-burning', !!(game && ui.screen === 'game' && game.s.phase === 'burning'));
  }

  /* ------------------------------------------------------------------ */
  /* Die Bombe                                                           */
  /* ------------------------------------------------------------------ */

  let fuseLen = 0;

  function onTick() {
    const body = app.querySelector('.burning .bomb-body');
    if (!body || reducedMotion()) return;
    body.classList.remove('pulse');
    void body.getBoundingClientRect();
    body.classList.add('pulse');
  }

  /** Zündschnur und Funke nachführen; zur Zündzeit: BUMM */
  function burnFrame() {
    raf = null;
    if (!bomb || !game || game.s.phase !== 'burning') return;
    const t = bomb.elapsed();
    if (t >= bomb.plan.fuse) {
      explode();
      return;
    }
    const fuse = app.querySelector('.burning .fuse');
    const spark = app.querySelector('.burning .spark');
    if (fuse && spark) {
      if (!fuseLen) fuseLen = fuse.getTotalLength();
      const left = fuseLen * (1 - Bomb.burned(bomb.plan, t));
      fuse.setAttribute('stroke-dasharray', `${left.toFixed(1)} ${fuseLen.toFixed(1)}`);
      const pt = fuse.getPointAtLength(left);
      // leichtes Flackern des Funkens
      const s = 0.85 + Math.random() * 0.35;
      spark.setAttribute('transform', `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)}) scale(${s.toFixed(2)})`);
    }
    raf = requestAnimationFrame(burnFrame);
  }

  function stopBomb(withBoom) {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (bomb) {
      if (withBoom) bomb.boom();
      else bomb.stop();
    }
    bomb = null;
  }

  function ignite() {
    if (!game || !game.ignite()) return;
    Sound.unlock();
    Bomb.sounds.strike();
    vibrate(30);
    bomb = new Bomb.Player(Bomb.plan(FUSES[game.s.settings.fuse]), { onTick });
    bomb.start();
    lastPass = Date.now();
    fuseLen = 0;
    ui.modal = null;
    saveGame();
    keepAwake(true);
    renderNow();
    raf = requestAnimationFrame(burnFrame);
  }

  function pass() {
    const now = Date.now();
    if (!game || game.s.phase !== 'burning' || now - lastPass < PASS_GAP) return;
    lastPass = now;
    game.pass();
    Bomb.sounds.swoosh();
    vibrate(15);
    render();
  }

  function explode() {
    stopBomb(true);
    if (!game.explode()) return;
    vibrate([450, 120, 250]);
    ui.boomUntil = Date.now() + BOOM_LOCK;
    saveGame();
    renderNow();
    setTimeout(render, BOOM_LOCK + 20);
  }

  function abortRound(message) {
    stopBomb(false);
    if (game && game.abort()) {
      saveGame();
      toast(message);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Spiel starten / beenden                                             */
  /* ------------------------------------------------------------------ */

  function startGame(state) {
    game = new Engine(state, hooks);
    // Mitten in einer Runde neu geladen? Dann ohne Strafpunkt von vorn.
    if (game.s.phase === 'burning') game.abort();
    ui.screen = 'game';
    ui.modal = null;
    saveGame();
    keepAwake(true);
    render();
  }

  function finish() {
    Sound.fanfare();
    confetti(['#ff5a36', '#ffc44d', '#fff6d6', '#ff8a3d', '#e11d48']);
    keepAwake(false);
  }

  function quitGame() {
    stopBomb(false);
    Store.remove(GAME_KEY);
    game = null;
    ui.screen = 'home';
    ui.modal = null;
    keepAwake(false);
    render();
  }

  /* ------------------------------------------------------------------ */
  /* Aktionen                                                            */
  /* ------------------------------------------------------------------ */

  const actions = {
    home: () => {
      ui.screen = 'home';
      render();
    },
    setup: () => {
      stopBomb(false);
      if (game && game.s.phase === 'end') game = null;
      ui.screen = 'setup';
      ui.modal = null;
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
    resume: () => {
      const g = savedGame();
      if (g) startGame(g.state);
    },
    discard: () => {
      Store.remove(GAME_KEY);
      render();
    },
    set: (el) => {
      ui.setup.settings[el.dataset.key] = el.dataset.value;
      ui.setup.settings = sanitizeSettings(ui.setup.settings);
      saveSetup();
      render();
    },
    flip: (el) => {
      const k = el.dataset.key;
      ui.setup.settings[k] = !ui.setup.settings[k];
      saveSetup();
      render();
    },
    'add-name': () => {
      if (ui.setup.names.length >= MAX_PLAYERS) return;
      ui.setup.names.push('');
      ui.focus = `#name-${ui.setup.names.length - 1}`;
      saveSetup();
      render();
    },
    'remove-name': (el) => {
      if (ui.setup.names.length <= MIN_PLAYERS) return;
      ui.setup.names.splice(+el.dataset.i, 1);
      saveSetup();
      render();
    },
    start: () => {
      const st = ui.setup.settings;
      try {
        startGame(Engine.create({ settings: st, players: st.names ? ui.setup.names : [] }, hooks));
      } catch (err) {
        toast(err.message);
      }
    },
    ignite,
    skip: () => {
      if (game && game.skip()) {
        saveGame();
        render();
      }
    },
    abort: () => abortRound('Runde abgebrochen – kein Strafpunkt'),
    'blame-open': () => {
      ui.modal = 'blame';
      render();
    },
    blame: (el) => {
      const i = +el.dataset.i;
      if (game.blame(i)) {
        saveGame();
        toast(`Strafpunkt geht an ${game.s.players[i].name}`);
      }
      ui.modal = null;
      render();
    },
    next: () => {
      if (Date.now() < ui.boomUntil || !game.next()) return;
      saveGame();
      if (game.s.phase === 'end') finish();
      render();
    },
    rematch: () => {
      startGame(Engine.rematch(game.s, hooks));
    },
    quit: () => {
      ui.modal = 'quit';
      render();
    },
    'quit-yes': quitGame,
    'close-modal': () => {
      ui.modal = null;
      render();
    },
    'close-modal-bg': (el, e) => {
      if (e.target === el) actions['close-modal']();
    },
  };

  /* ------------------------------------------------------------------ */
  /* Ereignisse                                                          */
  /* ------------------------------------------------------------------ */

  // Weitergeben schon beim Berühren (pointerdown) – schneller als click, und der ganze Bildschirm zählt
  app.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.dataset.act !== 'pass') return;
    e.preventDefault();
    pass();
  });

  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled || !app.contains(el)) return;
    const act = el.dataset.act;
    if (act === 'pass') return; // schon per pointerdown erledigt
    const fn = actions[act];
    if (!fn) return;
    Sound.unlock();
    if (!['close-modal-bg', 'ignite', 'mute'].includes(act)) Sound.click();
    if (ui.modal === 'menu' && el.closest('.modal') && !['close-modal', 'mute'].includes(act)) ui.modal = null;
    fn(el, e);
  });

  app.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.field === 'name') {
      ui.setup.names[+el.dataset.i] = el.value;
      saveSetup();
      // Start-Knopf und Hinweis aktualisieren, ohne dem Feld den Fokus zu nehmen
      render();
    }
  });

  app.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key === 'Enter' && el.dataset && el.dataset.field === 'name') {
      e.preventDefault();
      const i = +el.dataset.i;
      if (i + 1 < ui.setup.names.length) app.querySelector(`#name-${i + 1}`).focus();
      else if (el.value.trim()) actions['add-name']();
    } else if (e.key === 'Escape' && ui.modal) {
      actions['close-modal']();
    } else if ((e.key === ' ' || e.key === 'Enter') && game && ui.screen === 'game' && game.s.phase === 'burning' && !ui.modal) {
      // Am Laptop: Leertaste = weitergeben
      e.preventDefault();
      pass();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target !== document.body) return;
    if ((e.key === ' ' || e.key === 'Enter') && game && ui.screen === 'game' && game.s.phase === 'burning') {
      e.preventDefault();
      pass();
    }
  });

  // Bildschirm aus / App gewechselt mitten in der Runde → ohne Strafpunkt abbrechen
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (game && game.s.phase === 'burning') abortRound('Runde abgebrochen – das Handy war weg');
    } else if (game && ui.screen === 'game' && game.s.phase !== 'end') {
      keepAwake(true);
    }
  });

  render();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.WB_NO_SW) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
