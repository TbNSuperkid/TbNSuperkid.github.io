/*
 * Gemeinsame Oberflächen-Bausteine für alle Spiele im neuen Design (Gegenstück zu shared/ui.css).
 * Reine Funktionen, die HTML-Strings liefern – keine Spiellogik, kein Zustand.
 * Braucht shared/icons.js (und für roomBox shared/room.js); laden vor js/app.js:
 *
 *   <script src="../shared/icons.js"></script>
 *   <script src="../shared/ui.js"></script>
 *
 *   const UI = window.GameUI;
 *   UI.seg('length', ['short', 'normal'], s.length, (o) => …, 'setup')
 *   UI.modal(body, { wide: true })
 *
 * Aktionen laufen über data-act (wie bisher in den Spielen): set, toggle, home, menu, mute, close-modal,
 * close-modal-bg, confirm-yes, confirm-no, leave-now, lobby-settings … – die Spiele behandeln sie selbst.
 */
(function (root) {
  'use strict';

  const I = (name, opts) => root.GameIcons.svg(name, opts);

  /* ---------- Text ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function plural(n, one, many) {
    return n === 1 ? one : many;
  }

  /** Inline-Style für eine Team-/Spielerfarbe: style="${UI.teamStyle(color)}" */
  function teamStyle(color) {
    return `--team:${esc(color || '#ffffff')}`;
  }

  /** sessionStorage lesen (value weglassen), setzen oder löschen (null) – gesperrter Speicher wird ignoriert */
  function session(key, value) {
    try {
      if (value === undefined) return root.sessionStorage.getItem(key);
      if (value === null) root.sessionStorage.removeItem(key);
      else root.sessionStorage.setItem(key, value);
    } catch {
      /* gesperrter Speicher – dann eben ohne */
    }
    return null;
  }

  /** Meldung für einen Verbindungsfehler (info.error aus onStatus('error', info)) */
  function connectError(code) {
    if (code === 'not-found') return 'Kein Spiel mit diesem Code gefunden. Stimmt der Code und ist der Laptop noch online?';
    if (code === 'wrong-game') return 'Unter diesem Code läuft ein anderes Spiel.';
    if (code === 'server') return 'Der Verbindungsserver ist gerade nicht erreichbar. Bitte später erneut versuchen.';
    return 'Verbindung fehlgeschlagen. Bitte prüfe deine Internetverbindung.';
  }

  /* ---------- Kopf & Navigation ---------- */

  /** Logo eines Spiels: Icon-Kachel in Akzentfarbe + Name */
  function logo(name, icon, small) {
    return `<div class="logo ${small ? 'logo-small' : ''}" aria-label="${esc(name)}">
      <span class="logo-mark">${I(icon)}</span>
      <span class="logo-text">${esc(name)}</span>
    </div>`;
  }

  /** „Alle Spiele“ oben auf der Startseite eines Spiels */
  function hubBack() {
    return `<a class="hub-back" href="../">${I('back')} Alle Spiele</a>`;
  }

  /** Kopf einer Unterseite: Zurück · Titel · rechts (z. B. Regeln-Knopf) */
  function screenHead(title, opts) {
    const o = opts || {};
    return `<header class="screen-head">
        <button class="back-btn" data-act="${o.back || 'home'}">${I('back')} ${esc(o.backLabel || 'Zurück')}</button>
        <h1>${esc(title)}</h1>
        ${o.right || '<span></span>'}
      </header>`;
  }

  /** Knopf „Spielregeln“ als Icon (für screenHead right) */
  function rulesButton() {
    return `<button class="icon-btn" data-act="rules" aria-label="Spielregeln">${I('help')}</button>`;
  }

  /** Ton- und Menü-Knopf rechts in der Kopfleiste der Bühne */
  function topbarActions(muted) {
    return `<div class="topbar-actions">
          <button class="icon-btn" data-act="mute" aria-label="Ton an/aus" title="Ton an/aus">${I(muted ? 'volume-x' : 'volume')}</button>
          <button class="icon-btn" data-act="menu" aria-label="Menü" title="Menü">${I('menu')}</button>
        </div>`;
  }

  /** Kopfleiste der Bühne: Logo (öffnet das Menü) · Infos (Pillen) · Ton/Menü */
  function topbar(logoHtml, info, muted) {
    return `
      <header class="topbar">
        <button class="topbar-brand" data-act="menu" aria-label="Menü">${logoHtml}</button>
        <div class="topbar-info">${info || ''}</div>
        ${topbarActions(muted)}
      </header>`;
  }

  /* ---------- Startseite ---------- */

  /** Große Karte auf der Startseite (Spiel anlegen / Mitspielen …) */
  function modeCard(o) {
    return `
        <button class="mode-card ${o.cls || ''}" data-act="${o.act}">
          <span class="mode-icon">${I(o.icon)}</span>
          <span class="mode-body"><b>${esc(o.title)}</b><small>${o.text}</small></span>
          <span class="mode-go">${esc(o.go)} ${I('next')}</span>
        </button>`;
  }

  /** „Spiel fortsetzen“ / „Zurück ins Spiel“ mit Verwerfen-Knopf; sub ist HTML */
  function resume(o) {
    return `
        <div class="resume">
          <button class="btn btn-ghost btn-wide" data-act="${o.act}">${esc(o.title)}
            <small>${o.sub || ''}</small></button>
          <button class="icon-btn" data-act="${o.discard}" title="${esc(o.discardLabel || 'Verwerfen')}" aria-label="${esc(o.discardLabel || 'Verwerfen')}">${I('x')}</button>
        </div>`;
  }

  /* ---------- Beitreten / Verbinden ---------- */

  /** Seite „Mitspielen“ (Name + Raum-Code); o: { logo, name, code, error } */
  function joinScreen(o) {
    return `
    <div class="screen join">
      ${screenHead('Mitspielen')}
      <div class="join-hero">${o.logo}</div>
      ${o.error ? `<div class="alert">${esc(o.error)}</div>` : ''}
      <form class="panel" data-form="join">
        <label class="label" for="name-input">Dein Name</label>
        <input id="name-input" class="input input-big" type="text" maxlength="24" placeholder="z.B. Alex" value="${esc(o.name)}" data-field="name" autocomplete="nickname" enterkeyhint="next" />
        <label class="label" for="code-input">Raum-Code <small class="muted">(steht auf dem Laptop)</small></label>
        <input id="code-input" class="input input-code" type="text" maxlength="8" placeholder="ABCDE" value="${esc(o.code)}" data-field="join-code" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" />
        <button class="btn btn-primary btn-wide btn-big" type="submit">Beitreten</button>
      </form>
    </div>`;
  }

  /** Ganzseitig „Verbinde…“ mit Abbrechen */
  function connecting(status) {
    return `
    <div class="screen connecting">
      <div class="spinner" aria-hidden="true"></div>
      <p>${status === 'reconnecting' ? 'Verbindung unterbrochen – verbinde neu…' : 'Verbinde…'}</p>
      <button class="btn btn-ghost" data-act="leave-now">Abbrechen</button>
    </div>`;
  }

  /** Hinweisleiste am Handy, solange die Verbindung zum Laptop weg ist */
  function statusBanner(status) {
    if (status !== 'reconnecting' && status !== 'connecting') return '';
    return `<div class="status-banner"><span class="spinner-sm"></span> Verbindung zum Laptop unterbrochen – verbinde neu…</div>`;
  }

  /** QR-Code, Raum-Code und Link für die Lobby / den Einladen-Dialog */
  function roomBox(room, big, opts) {
    if (!room) return '';
    if (room.state === 'error') {
      return `<div class="alert">Der Raum konnte nicht geöffnet werden. Prüfe die Internetverbindung – es wird weiter versucht.</div>`;
    }
    if (!room.code || room.state !== 'online') {
      return `<div class="qr-wait"><div class="spinner" aria-hidden="true"></div><p>Raum wird geöffnet…</p></div>`;
    }
    const o = opts || {};
    const link = (o.inviteLink || root.GameRoom.inviteLink)(room.code, o.param);
    return `
      <div class="qr ${big ? 'qr-big' : ''}">${(o.qrSvg || root.GameRoom.qrSvg)(link)}</div>
      <div class="room-label">Raum-Code</div>
      <div class="room-code" data-testid="room-code">${esc(room.code)}</div>
      <p class="small muted link-text">${esc(link)}</p>`;
  }

  /* ---------- Einstellungen ---------- */

  /**
   * Umschalter mit mehreren Werten (data-act="set" data-key data-value data-scope).
   * fmt(o) liefert die Beschriftung als HTML (Icons erlaubt).
   */
  function seg(key, options, value, fmt, scope, disabled) {
    return `<div class="seg" role="group">${options
      .map(
        (o) =>
          `<button class="seg-btn ${o === value ? 'on' : ''}" data-act="set" data-key="${esc(key)}" data-value="${esc(o)}" data-scope="${esc(scope)}" aria-pressed="${o === value}" ${disabled ? 'disabled' : ''}>${fmt(o)}</button>`
      )
      .join('')}</div>`;
  }

  /**
   * An/Aus-Schalter. Standard: data-act="toggle" data-key data-scope.
   * opts: { key, scope, act } – act ersetzt "toggle" (dann ohne key möglich).
   */
  function toggle(on, opts) {
    const o = opts || {};
    const attrs = [`data-act="${esc(o.act || 'toggle')}"`];
    if (o.key) attrs.push(`data-key="${esc(o.key)}"`);
    if (o.scope) attrs.push(`data-scope="${esc(o.scope)}"`);
    return `<button class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${!!on}" ${attrs.join(' ')}>
      <span class="switch-knob"></span><span class="switch-text">${on ? 'An' : 'Aus'}</span>
    </button>`;
  }

  /** Eine Zeile in .settings: Titel (HTML, z. B. mit Icon), Erklärung (HTML, optional), Steuerelement */
  function setting(title, text, control) {
    return `<div class="setting"><div class="setting-label"><b>${title}</b>${text ? `<small>${text}</small>` : ''}</div>${control}</div>`;
  }

  /** Lobby: alle Einstellungen als eine Zeile + „Ändern“ (öffnet den Dialog, Standard: data-act="lobby-settings") */
  function settingsSummary(parts, act) {
    return `
      <section class="panel settings-summary">
        <div><h2>Einstellungen</h2><p class="muted">${parts.filter(Boolean).map(esc).join(' · ')}</p></div>
        <button class="btn btn-ghost" data-act="${esc(act || 'lobby-settings')}">${I('settings')} Ändern</button>
      </section>`;
  }

  /**
   * Zusammenfassung aus dem HTML der Einstellungen ableiten (für settingsSummary):
   * je .setting „Titel: gewählter Wert“ – Wert aus .seg-btn.on, .choice.on oder dem An/Aus-Schalter.
   */
  function settingsParts(html) {
    const text = (h) =>
      String(h || '')
        .replace(/<small[\s\S]*?<\/small>/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
    const parts = [];
    for (const row of String(html).split(/<div class="setting[ "]/).slice(1)) {
      const title = text((row.match(/<b>([\s\S]*?)<\/b>/) || [])[1]);
      let value = '';
      const on = row.match(/class="(?:seg-btn|choice) on"[^>]*>([\s\S]*?)<\/button>/);
      if (on) value = text(on[1]);
      else if (/class="switch on"/.test(row)) value = 'an';
      else if (/class="switch\s*"/.test(row) || /class="switch "/.test(row)) value = 'aus';
      if (title && value) parts.push(value === 'an' || value === 'aus' ? `${title} ${value}` : `${title}: ${value}`);
    }
    return parts;
  }

  /* ---------- Bühne ---------- */

  /**
   * Zeitbalken. Die Spiele zählen ihn per requestAnimationFrame herunter ([data-timer], data-rem, data-total).
   * opts: { tick (Ticken in den letzten Sekunden), clock (m:ss statt Sekunden), cls }
   * timer.kind wird zur Klasse timer-<kind> (z. B. für eigene Farben).
   */
  function timer(t, opts) {
    if (!t) return '';
    const o = opts || {};
    const sec = Math.ceil(t.remaining / 1000);
    const label = o.clock ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : String(sec);
    const cls = [t.kind ? `timer-${t.kind}` : '', o.cls || ''].filter(Boolean).join(' ');
    return `<div class="timer ${cls}" data-timer ${o.tick ? 'data-tick' : ''} ${o.clock ? 'data-clock' : ''} data-rem="${Math.round(t.remaining)}" data-total="${t.total}">
      <div class="timer-bar"><span data-timer-bar style="width:${(100 * t.remaining) / (t.total || 1)}%"></span></div>
      <b data-timer-text>${label}</b>
    </div>`;
  }

  /** Spieler-Chip in der Lobby, mit Entfernen-Knopf (data-act="kick") */
  function chip(m, opts) {
    const o = opts || {};
    return `<span class="chip ${m.online ? '' : 'is-offline'} ${o.cls || ''}" ${o.style ? `style="${o.style}"` : ''}>${o.dot ? '<span class="team-dot"></span>' : ''}${esc(m.name)}${
      o.kick === false ? '' : `<button class="chip-x" data-act="kick" data-player="${esc(m.id)}" aria-label="${esc(m.name)} entfernen">${I('x')}</button>`
    }</span>`;
  }

  /** Treppchen-Stufe am Spielende; o: { place, index (0–2), name, points, style, cls } */
  function podiumStep(o) {
    return `
        <div class="podium-step p${o.index + 1} ${o.cls || ''}" ${o.style ? `style="${o.style}"` : ''}>
          <div class="podium-medal">${I(o.place === 1 ? 'trophy' : 'medal')}</div>
          <b>${esc(o.name)}</b>
          <span>${esc(o.points)}</span>
          <div class="podium-block">${o.place}</div>
        </div>`;
  }

  /** Auszeichnung am Spielende; iconMap bildet Emojis aus der Engine auf Icons ab */
  function award(a, iconMap) {
    const icon = iconMap && iconMap[a.icon] ? I(iconMap[a.icon]) : esc(a.icon);
    return `<div class="award"><span class="award-icon">${icon}</span><div><b>${esc(a.title)}</b><small>${esc(a.text)}</small>${a.sub ? `<small class="award-sub">${esc(a.sub)}</small>` : ''}</div></div>`;
  }

  /* ---------- Dialoge ---------- */

  /** Dialog mit Schließen-Knopf; Klick auf den Hintergrund löst data-act="close-modal-bg" aus. opts: { wide, cls } */
  function modal(body, opts) {
    if (!body) return '';
    const o = opts || {};
    return `
      <div class="overlay modal-overlay" data-act="close-modal-bg">
        <div class="${['modal', o.wide ? 'modal-wide' : '', o.cls || ''].filter(Boolean).join(' ')}" role="dialog" aria-modal="true">
          <button class="icon-btn modal-close" data-act="close-modal" aria-label="Schließen">${I('x')}</button>
          ${body}
        </div>
      </div>`;
  }

  /** Inhalt eines Bestätigungs-Dialogs; c: { title, text, yes, no?, danger? } */
  function confirmBody(c) {
    return `
        <h2>${esc(c.title)}</h2>
        <p>${esc(c.text)}</p>
        <div class="modal-actions">
          <button class="btn ${c.danger ? 'btn-danger' : 'btn-primary'}" data-act="confirm-yes">${esc(c.yes)}</button>
          ${c.no ? `<button class="btn btn-ghost" data-act="confirm-no">${esc(c.no)}</button>` : ''}
          <button class="btn btn-ghost" data-act="close-modal">Abbrechen</button>
        </div>`;
  }

  /** Eintrag im Menü-Dialog; opts: { small, danger, attrs (weitere data-*-Attribute als HTML) } */
  function menuItem(act, icon, label, opts) {
    const o = opts || {};
    return `<button class="menu-item ${o.danger ? 'danger' : ''}" data-act="${esc(act)}" ${o.attrs || ''}>${I(icon)} ${esc(label)}${o.small ? ` <small>${esc(o.small)}</small>` : ''}</button>`;
  }

  /** Menü-Dialog: Überschrift + Einträge */
  function menu(items) {
    return `<h2>Menü</h2><div class="menu-list">${items.filter(Boolean).join('')}</div>`;
  }

  /** Einträge, die jedes Menü hat: Spielregeln und Ton */
  function menuBasics(muted) {
    return [menuItem('rules', 'book', 'Spielregeln'), muted ? menuItem('mute', 'volume', 'Ton einschalten') : menuItem('mute', 'volume-x', 'Ton ausschalten')];
  }

  /** Fußzeile eines Dialogs mit einem Knopf, der ihn schließt */
  function modalDone(label) {
    return `<div class="modal-actions"><button class="btn btn-primary" data-act="close-modal">${esc(label || 'Fertig')}</button></div>`;
  }

  /* ---------- Emojis aus Engines und Daten ---------- */

  /**
   * Emoji → Icon-Name. Engines und Fragenlisten liefern oft Emojis (Kategorien, Auszeichnungen);
   * UI.icon() bildet sie hier ab, damit die Engines unverändert bleiben können.
   */
  const EMOJI = {
    '📱': 'phone', '📲': 'phone', '💻': 'laptop', '🖥️': 'laptop', '📺': 'laptop', '✕': 'x', '✖': 'x', '❌': 'x', '✗': 'x',
    '🚫': 'x', '🙅': 'x', '✓': 'check', '✅': 'check', '✔': 'check', '☑️': 'check', '🏆': 'trophy', '🥇': 'trophy',
    '🥈': 'medal', '🥉': 'medal', '🏅': 'medal', '🎖️': 'medal', '▶': 'play', '▶️': 'play', '🏁': 'flag', '🚩': 'flag',
    '🏳️': 'flag', '✋': 'hand', '🤚': 'hand', '🙋': 'hand', '📖': 'book', '📚': 'book', '🔤': 'book', '🙈': 'eye',
    '👀': 'eye', '👁': 'eye', '👁️': 'eye', '🍿': 'eye', '🔊': 'volume', '📣': 'volume', '🔇': 'volume-x', '🙉': 'volume-x',
    '🔁': 'refresh', '🔄': 'refresh', '↻': 'refresh', '🌀': 'refresh', '✍️': 'pencil', '✏️': 'pencil', '🖍️': 'pencil',
    '📝': 'pencil', '🍻': 'glass', '🍺': 'glass', '🍷': 'glass', '🍹': 'glass', '🥤': 'glass', '🎬': 'clapper',
    '🎞️': 'film', '🎲': 'dice', '🎰': 'dice', '👍': 'thumbs-up', '👎': 'thumbs-down', '🪙': 'coins', '💰': 'coins',
    '💸': 'coins', '🎯': 'target', '🤏': 'target', '🎤': 'mic', '🎙️': 'mic', '＋': 'plus', '⏳': 'hourglass',
    '⌛': 'hourglass', '🥁': 'hourglass', '🚪': 'logout', '🕵️': 'search', '🔍': 'search', '🔎': 'search', '☰': 'menu',
    '👥': 'users', '👯': 'users', '👨‍👩‍👧': 'users', '🤝': 'users', '🗣️': 'speak', '💬': 'speak', '⚙️': 'settings',
    '🎛️': 'settings', '⚠️': 'alert', '😬': 'alert', '🤫': 'lock', '🙊': 'lock', '🔒': 'lock', '🔐': 'lock', '⚡': 'zap',
    '⚔️': 'zap', '💥': 'zap', '🔀': 'shuffle', '⇄': 'shuffle', '⏱': 'clock', '⏱️': 'clock', '⏰': 'clock', '🕰️': 'clock',
    '⏩': 'next', '⏭️': 'next', '⏭': 'next', '➤': 'next', '👉': 'next', '🎉': 'sparkles', '🎭': 'sparkles', '🤯': 'sparkles',
    '🔮': 'sparkles', '🧠': 'lightbulb', '💡': 'lightbulb', '🤓': 'lightbulb', '🏠': 'home', '🎁': 'gift', '📊': 'chart',
    '📈': 'trending-up', '📉': 'trending-down', '⌨️': 'keyboard', '🎨': 'palette', '❤️': 'heart', '💕': 'heart',
    '💘': 'heart', '🖤': 'heart', '🤍': 'heart', '💔': 'heart', '⚖️': 'scale', '🎧': 'audio', '📻': 'audio',
    '🔥': 'flame', '🔞': 'flame', '🗳️': 'vote', '☠️': 'skull', '🃏': 'star', '⭐': 'star', '🎟️': 'star', '📜': 'file',
    '📋': 'list', '🗂️': 'list', '📍': 'pin', '🧭': 'pin', '🎶': 'music', '🎵': 'music', '🍏': 'music', '🔔': 'bell',
    '🔑': 'key', '☝️': 'one', '🤔': 'thinking', '💭': 'thinking', '😂': 'smile', '😇': 'smile', '🙂': 'smile',
    '😅': 'smile', '😏': 'smile', '😄': 'smile', '👤': 'user', '🧍': 'user', '↩️': 'undo', '↶': 'undo', '👑': 'crown',
    '📸': 'image', '🖼️': 'image', '📵': 'wifi-off', '📴': 'wifi-off', '🔗': 'link', '👆': 'pointer', '❓': 'help',
    '🤷': 'help', '💧': 'drop', '🌱': 'leaf', '🌿': 'leaf', '🪣': 'bucket', '🧽': 'eraser', '🗑': 'trash', '🗑️': 'trash',
    '💣': 'bomb', '⏸': 'pause', '⏸️': 'pause', '⏹': 'stop', '⏹️': 'stop', '💾': 'save', '⬇️': 'download', '🚀': 'rocket',
    '↻': 'refresh', '⇄': 'shuffle', '⏮': 'back', '😗': 'music', '🤐': 'lock', '🌐': 'globe', '🗺️': 'globe', '🗺': 'globe', '📅': 'clock', '🌡️': 'gauge', '📡': 'wifi-off',
  };

  /** Icon zu einem Icon-Namen oder einem Emoji aus Engine/Daten ('' wenn unbekannt) */
  function icon(x, opts) {
    if (!x) return '';
    const name = root.GameIcons.has(x) ? x : EMOJI[x] || EMOJI[String(x).replace(/️/g, '')] || EMOJI[x + '️'];
    return name ? I(name, opts) : '';
  }

  const api = {
    EMOJI,
    icon,
    esc,
    plural,
    teamStyle,
    session,
    connectError,
    logo,
    hubBack,
    screenHead,
    rulesButton,
    topbar,
    topbarActions,
    modeCard,
    resume,
    joinScreen,
    connecting,
    statusBanner,
    roomBox,
    seg,
    toggle,
    setting,
    settingsSummary,
    settingsParts,
    timer,
    chip,
    podiumStep,
    award,
    modal,
    confirmBody,
    menuItem,
    menu,
    menuBasics,
    modalDone,
  };
  root.GameUI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
