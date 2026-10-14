/*
 * Controller verbinden Oberfläche, Spiellogik und Netzwerk (Verbindungen: shared/room.js).
 *  - OfflineController: alles auf einem Gerät
 *  - HostController:    Online-Spiel, dieses Gerät ist der Host (führt die Engine aus)
 *  - ClientController:  Online-Spiel, verbunden mit einem Host
 *
 * Alle Controller bieten: dispatch(action), sendStroke(msg), leave()
 * und melden sich über die übergebenen Callbacks:
 *   onView(view), onStroke(msg), onStrokes(list), onStatus(status, info), onKicked()
 */
(function (root) {
  'use strict';

  const { Engine } = root.ActivityEngine;
  const Room = root.GameRoom.create({
    // interne Kennungen stammen aus der Zeit als „Activity“ – sie bleiben, damit gespeicherte
    // Spiele und Räume älterer Versionen weiter funktionieren
    game: 'activity',
    net: 'activity-spiel-v1-',
    storage: 'activity',
    // ältere Versionen schicken noch keine Spiel-Kennung mit
    legacy: true,
  });
  const { Store, playerId, setPlayerId } = Room;

  const KEYS = {
    offline: Room.key('offline'),
    host: Room.key('host'),
    client: Room.KEYS.client,
    remote: Room.key('remote'),
  };
  const MAX_STROKES = 5000;

  /** Zeichenstriche merken (für später verbundene Geräte) und an alle anderen weitergeben */
  function relayStroke(ctrl, msg, fromConn) {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.k === 'clear') ctrl.strokes = [];
    else ctrl.strokes.push(msg);
    if (ctrl.strokes.length > MAX_STROKES) ctrl.strokes.splice(0, ctrl.strokes.length - MAX_STROKES);
    if (ctrl.host) {
      ctrl.host.each((pid, connId) => {
        if (connId !== fromConn) ctrl.host.send(connId, { t: 'stroke', s: msg });
      });
    }
    return true;
  }

  /** Striche gehören immer zum aktuellen Zug – bei einem neuen Zug wird geleert */
  function syncStrokeTurn(ctrl) {
    const s = ctrl.engine.s;
    const turnNo = s.turn ? s.turn.no : null;
    if (ctrl.strokeTurn !== turnNo) {
      ctrl.strokes = [];
      ctrl.strokeTurn = turnNo;
    }
  }

  function sendStrokes(ctrl, connId) {
    if (ctrl.strokes.length) ctrl.host.send(connId, { t: 'strokes', all: ctrl.strokes });
  }

  /* ------------------------------------------------------------------ */

  /**
   * Offline-Spiel auf einem Gerät (z.B. Laptop als Spielbrett).
   * Optional kann sich ein Handy als "Kartenhand" verbinden: Es zeigt die Stapel
   * und die Karte nur für die Person, die gerade dran ist.
   */
  class OfflineController {
    constructor(state, cb) {
      this.cb = cb;
      this.mode = 'offline';
      this.engine = new Engine(state, { onChange: () => this.changed() });
      this.host = null;
      this.strokes = [];
      this.strokeTurn = null;
      this.changed();
      // Nach einem Neuladen den Kartenhand-Raum mit gleichem Code wieder öffnen
      const saved = Store.get(KEYS.remote);
      if (saved && saved.game === state.startedAt) this.enableRemote(saved);
    }

    /* ---- Kartenhand (Handy) ---- */

    enableRemote(saved) {
      if (this.host) return;
      this.host = new Room.HostLink({
        code: saved ? saved.code : null,
        key: saved ? saved.key : null,
        onReady: () => {
          this.saveRemote();
          this.changed();
        },
        onHello: (pid, hello, connId) => {
          this.changed();
          sendStrokes(this, connId);
        },
        onAction: (pid, action) => this.engine.apply(action, 'local'),
        onMessage: (pid, data, connId) => {
          if (data.t === 'stroke' && relayStroke(this, data.s, connId)) this.cb.onStroke(data.s);
        },
        onGone: () => this.changed(),
        onError: () => this.changed(),
        onDisconnect: () => this.changed(),
      });
      this.changed();
    }

    disableRemote() {
      if (!this.host) return;
      this.host.close(true);
      this.host = null;
      Store.remove(KEYS.remote);
      this.changed();
    }

    saveRemote() {
      if (this.host && this.host.code) {
        Store.set(KEYS.remote, { code: this.host.code, key: this.host.key, game: this.engine.s.startedAt });
      }
    }

    remoteInfo() {
      if (!this.host) return null;
      return { code: this.host.code, state: this.host.state, error: this.host.error, connected: this.host.count() };
    }

    /* ---- Ablauf ---- */

    changed() {
      const s = this.engine.s;
      syncStrokeTurn(this);
      if (s.phase === 'over') Store.remove(KEYS.offline);
      else Store.set(KEYS.offline, s);
      const view = this.engine.viewFor('local');
      view.remote = this.remoteInfo();
      if (this.host) {
        this.saveRemote();
        const remoteView = Object.assign({}, view, { isRemote: true, remote: null });
        this.host.each((pid, connId) => this.host.send(connId, { t: 'view', v: remoteView }));
      }
      this.cb.onView(view);
    }

    dispatch(action) {
      this.engine.apply(action, 'local');
    }

    sendStroke(msg) {
      relayStroke(this, msg, null);
    }

    leave(keepSave) {
      this.engine.dispose();
      if (this.host) {
        // Beim Pausieren bleibt das Handy verbunden und wartet auf die Rückkehr
        this.host.close(!keepSave);
        this.host = null;
      }
      if (!keepSave) {
        Store.remove(KEYS.offline);
        Store.remove(KEYS.remote);
      }
    }
  }

  /* ------------------------------------------------------------------ */

  class HostController {
    /**
     * @param {{name?:string, restore?:object}} opts
     */
    constructor(opts, cb) {
      this.cb = cb;
      this.mode = 'host';
      this.host = null;
      this.strokes = [];
      this.strokeTurn = null;
      const restore = opts.restore;
      this.pid = restore ? restore.pid : playerId();
      setPlayerId(this.pid);
      const state = restore ? restore.state : Engine.lobby(this.pid, opts.name);
      this.engine = new Engine(state, {
        onChange: () => this.changed(),
        onKick: (pid) => this.host && this.host.kick(pid),
      });
      this.engine.setAllOffline();
      if (restore && Array.isArray(restore.strokes) && state.turn && restore.strokeTurn === state.turn.no) {
        this.strokes = restore.strokes;
        this.strokeTurn = restore.strokeTurn;
      }
      this.cb.onStatus('connecting');
      this.host = new Room.HostLink({
        code: restore ? restore.code : null,
        key: restore ? restore.key : null,
        accept: (pid) => pid !== this.pid,
        onReady: (code) => {
          this.cb.onStatus('online', { code });
          this.changed();
        },
        onHello: (pid, hello, connId) => {
          this.engine.connect(pid, hello.name);
          sendStrokes(this, connId);
        },
        onAction: (pid, action) => this.engine.apply(action, pid),
        onMessage: (pid, data, connId) => {
          if (data.t !== 'stroke') return;
          const s = this.engine.s;
          if (s.turn && s.turn.explainer === pid && ['card', 'running'].includes(s.phase)) {
            syncStrokeTurn(this);
            if (relayStroke(this, data.s, connId)) {
              this.saveSoon();
              this.cb.onStroke(data.s);
            }
          }
        },
        onGone: (pid) => this.engine.disconnect(pid),
        onError: (err) => this.cb.onStatus('error', { error: err }),
        onDisconnect: () => this.cb.onStatus('reconnecting'),
      });
      this.changed();
      if (this.strokes.length) this.cb.onStrokes(this.strokes);
    }

    save() {
      if (!this.host || !this.host.code) return;
      Store.set(KEYS.host, {
        code: this.host.code,
        key: this.host.key,
        pid: this.pid,
        state: this.engine.s,
        strokes: this.strokes,
        strokeTurn: this.strokeTurn,
        savedAt: Date.now(),
      });
    }

    saveSoon() {
      if (this.saveTimer) return;
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        this.save();
      }, 1000);
    }

    changed() {
      syncStrokeTurn(this);
      this.save();
      if (this.host) this.host.each((pid, connId) => this.host.send(connId, { t: 'view', v: this.engine.viewFor(pid) }));
      const view = this.engine.viewFor(this.pid);
      view.room = this.host ? this.host.code : null;
      this.cb.onView(view);
    }

    dispatch(action) {
      this.engine.apply(action, this.pid);
    }

    sendStroke(msg) {
      syncStrokeTurn(this);
      if (relayStroke(this, msg, null)) this.saveSoon();
    }

    leave() {
      clearTimeout(this.saveTimer);
      this.host.close(true);
      this.engine.dispose();
      Store.remove(KEYS.host);
    }
  }

  /* ------------------------------------------------------------------ */

  class ClientController {
    /**
     * @param {{code:string, name?:string, pid?:string, role?:'remote'}} opts
     *   role 'remote': Handy als Kartenhand für ein Offline-Spiel
     */
    constructor(opts, cb) {
      this.mode = 'client';
      this.role = opts.role || 'player';
      this.link = new Room.ClientLink(
        { code: opts.code, name: opts.name, pid: opts.pid, hello: { role: this.role } },
        {
          onStatus: cb.onStatus,
          onKicked: cb.onKicked,
          onView: (v) => {
            v.room = this.link.code;
            cb.onView(v);
          },
          onMessage: (data) => {
            if (data.t === 'stroke') cb.onStroke(data.s);
            else if (data.t === 'strokes') cb.onStrokes(data.all || []);
          },
        }
      );
    }

    dispatch(action) {
      this.link.dispatch(action);
    }

    sendStroke(msg) {
      this.link.send({ t: 'stroke', s: msg });
    }

    bye() {
      this.link.bye();
    }

    leave() {
      this.link.leave();
    }
  }

  root.ActivityControllers = {
    OfflineController,
    HostController,
    ClientController,
    Store,
    KEYS,
    Net: Room.Net,
    playerId,
    inviteLink: Room.inviteLink,
    qrSvg: Room.qrSvg,
  };
})(window);
