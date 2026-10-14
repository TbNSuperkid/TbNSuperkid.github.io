/*
 * Controller verbinden Oberfläche, Spiellogik und Netzwerk.
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
  const Net = (root.ActivityNet = root.GameNet.create('activity-spiel-v1-'));

  const KEYS = {
    offline: 'activity.offline.v1',
    host: 'activity.host.v1',
    client: 'activity.client.v1',
    remote: 'activity.remote.v1',
  };
  const PING_MS = 4000;
  const DEAD_MS = 16000;

  const Store = {
    get(key) {
      try {
        const raw = root.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        root.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* privat-Modus o.ä. */
      }
    },
    remove(key) {
      try {
        root.localStorage.removeItem(key);
      } catch {
        /* egal */
      }
    },
  };

  function randomId() {
    const buf = new Uint32Array(3);
    root.crypto.getRandomValues(buf);
    return Array.from(buf, (n) => n.toString(36)).join('');
  }

  /** Spieler-ID pro Browser-Tab (bleibt beim Neuladen erhalten) */
  function playerId() {
    try {
      let id = root.sessionStorage.getItem('activity.pid');
      if (!id) {
        id = randomId();
        root.sessionStorage.setItem('activity.pid', id);
      }
      return id;
    } catch {
      return randomId();
    }
  }

  function setPlayerId(id) {
    try {
      root.sessionStorage.setItem('activity.pid', id);
    } catch {
      /* egal */
    }
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
      this.link = null;
      this.remotes = new Map(); // connId -> {last, ok}
      this.strokes = [];
      this.strokeTurn = null;
      this.changed();
      // Nach einem Neuladen den Kartenhand-Raum mit gleichem Code wieder öffnen
      const saved = Store.get(KEYS.remote);
      if (saved && saved.game === state.startedAt) this.enableRemote(saved);
    }

    /* ---- Kartenhand (Handy) ---- */

    enableRemote(saved) {
      if (this.link) return;
      this.remoteCode = saved ? saved.code : null;
      this.remoteKey = saved ? saved.key : null;
      this.remoteState = 'connecting';
      this.link = Net.host({
        code: this.remoteCode,
        key: this.remoteKey,
        onReady: (code, key) => {
          this.remoteCode = code;
          this.remoteKey = key;
          this.remoteState = 'online';
          this.saveRemote();
          this.changed();
        },
        onJoin: (connId) => this.remotes.set(connId, { last: Date.now(), ok: false }),
        onLeave: (connId) => this.dropRemote(connId),
        onMessage: (connId, data) => this.remoteMessage(connId, data),
        onError: (err) => {
          this.remoteState = 'error';
          this.remoteError = err;
          this.changed();
        },
        onDisconnect: () => {
          this.remoteState = 'connecting';
          this.remotes.clear();
          this.changed();
        },
      });
      this.pinger = setInterval(() => this.heartbeat(), PING_MS);
      this.changed();
    }

    disableRemote() {
      if (!this.link) return;
      for (const [connId] of this.remotes) this.link.send(connId, { t: 'closed' });
      const link = this.link;
      setTimeout(() => link.close(), 150);
      this.link = null;
      this.remotes.clear();
      this.remoteState = null;
      clearInterval(this.pinger);
      Store.remove(KEYS.remote);
      this.changed();
    }

    saveRemote() {
      if (this.remoteCode) {
        Store.set(KEYS.remote, { code: this.remoteCode, key: this.remoteKey, game: this.engine.s.startedAt });
      }
    }

    heartbeat() {
      const now = Date.now();
      for (const [connId, r] of this.remotes) {
        if (now - r.last > DEAD_MS) this.dropRemote(connId);
        else this.link.send(connId, { t: 'ping' });
      }
    }

    dropRemote(connId) {
      if (!this.remotes.delete(connId)) return;
      this.changed();
    }

    remoteMessage(connId, data) {
      if (!data || typeof data !== 'object') return;
      let r = this.remotes.get(connId);
      if (!r) {
        r = { last: Date.now(), ok: false };
        this.remotes.set(connId, r);
      }
      r.last = Date.now();
      if (data.t === 'hello') {
        r.ok = true;
        this.link.send(connId, { t: 'welcome', pid: String(data.pid || '') });
        this.changed();
        if (this.strokes.length) this.link.send(connId, { t: 'strokes', all: this.strokes });
      } else if (data.t === 'action' && r.ok) {
        this.engine.apply(data.a, 'local');
      } else if (data.t === 'stroke' && r.ok) {
        this.relayStroke(data.s, connId);
        this.cb.onStroke(data.s);
      } else if (data.t === 'bye') {
        this.dropRemote(connId);
      }
    }

    relayStroke(msg, fromConn) {
      if (!msg || typeof msg !== 'object' || !this.link) return;
      if (msg.k === 'clear') this.strokes = [];
      else this.strokes.push(msg);
      if (this.strokes.length > 5000) this.strokes.splice(0, this.strokes.length - 5000);
      for (const [connId, r] of this.remotes) {
        if (connId !== fromConn && r.ok) this.link.send(connId, { t: 'stroke', s: msg });
      }
    }

    remoteInfo() {
      if (!this.link) return null;
      let connected = 0;
      for (const r of this.remotes.values()) if (r.ok) connected++;
      return { code: this.remoteCode, state: this.remoteState, error: this.remoteError || null, connected };
    }

    /* ---- Ablauf ---- */

    changed() {
      const s = this.engine.s;
      const turnNo = s.turn ? s.turn.no : null;
      if (this.strokeTurn !== turnNo) {
        this.strokes = [];
        this.strokeTurn = turnNo;
      }
      if (s.phase === 'over') Store.remove(KEYS.offline);
      else Store.set(KEYS.offline, s);
      const view = this.engine.viewFor('local');
      view.remote = this.remoteInfo();
      if (this.link) {
        this.saveRemote();
        const remoteView = Object.assign({}, view, { isRemote: true, remote: null });
        for (const [connId, r] of this.remotes) if (r.ok) this.link.send(connId, { t: 'view', v: remoteView });
      }
      this.cb.onView(view);
    }

    dispatch(action) {
      this.engine.apply(action, 'local');
    }

    sendStroke(msg) {
      this.relayStroke(msg, null);
    }

    leave(keepSave) {
      this.engine.dispose();
      clearInterval(this.pinger);
      if (this.link) {
        // Beim Pausieren bleibt das Handy verbunden und wartet auf die Rückkehr
        if (!keepSave) for (const [connId] of this.remotes) this.link.send(connId, { t: 'closed' });
        const link = this.link;
        setTimeout(() => link.close(), 150);
        this.link = null;
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
      this.conns = new Map(); // connId -> {pid, last}
      this.strokes = [];
      this.strokeTurn = null;
      const restore = opts.restore;
      this.pid = restore ? restore.pid : playerId();
      setPlayerId(this.pid);
      const hooks = {
        onChange: () => this.changed(),
        onKick: (pid) => this.kicked(pid),
      };
      const state = restore ? restore.state : Engine.lobby(this.pid, opts.name);
      this.engine = new Engine(state, hooks);
      this.engine.setAllOffline();
      this.code = restore ? restore.code : null;
      this.key = restore ? restore.key : null;
      if (restore && Array.isArray(restore.strokes) && state.turn && restore.strokeTurn === state.turn.no) {
        this.strokes = restore.strokes;
        this.strokeTurn = restore.strokeTurn;
      }
      this.cb.onStatus('connecting');
      this.link = Net.host({
        code: this.code,
        key: this.key,
        onReady: (code, key) => {
          this.code = code;
          this.key = key;
          this.cb.onStatus('online', { code });
          this.changed();
        },
        onJoin: (connId) => this.conns.set(connId, { pid: null, last: Date.now() }),
        onLeave: (connId) => this.dropConn(connId),
        onMessage: (connId, data) => this.message(connId, data),
        onError: (err) => this.cb.onStatus('error', { error: err }),
        onDisconnect: () => {
          this.cb.onStatus('reconnecting');
          for (const id of [...this.conns.keys()]) this.dropConn(id);
        },
      });
      this.pinger = setInterval(() => this.heartbeat(), PING_MS);
      this.changed();
      if (this.strokes.length) this.cb.onStrokes(this.strokes);
    }

    save() {
      if (!this.code) return;
      Store.set(KEYS.host, {
        code: this.code,
        key: this.key,
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

    heartbeat() {
      const now = Date.now();
      for (const [connId, c] of this.conns) {
        if (now - c.last > DEAD_MS) this.dropConn(connId);
        else this.link.send(connId, { t: 'ping' });
      }
    }

    dropConn(connId) {
      const c = this.conns.get(connId);
      if (!c) return;
      this.conns.delete(connId);
      if (c.pid && ![...this.conns.values()].some((o) => o.pid === c.pid)) this.engine.disconnect(c.pid);
    }

    message(connId, data) {
      if (!data || typeof data !== 'object') return;
      let c = this.conns.get(connId);
      if (!c) {
        c = { pid: null, last: Date.now() };
        this.conns.set(connId, c);
      }
      c.last = Date.now();
      if (data.t === 'hello') {
        const pid = String(data.pid || '').slice(0, 40);
        if (!pid || pid === this.pid) {
          this.link.send(connId, { t: 'error', error: 'bad-id' });
          return;
        }
        c.pid = pid;
        this.link.send(connId, { t: 'welcome', pid });
        this.engine.connect(pid, data.name);
        if (this.strokes.length) this.link.send(connId, { t: 'strokes', all: this.strokes });
      } else if (data.t === 'action' && c.pid) {
        this.engine.apply(data.a, c.pid);
      } else if (data.t === 'stroke' && c.pid) {
        const s = this.engine.s;
        if (s.turn && s.turn.explainer === c.pid && ['card', 'running'].includes(s.phase)) {
          this.relayStroke(data.s, connId);
          this.cb.onStroke(data.s);
        }
      } else if (data.t === 'bye' && c.pid) {
        this.dropConn(connId);
      }
    }

    relayStroke(msg, fromConn) {
      if (!msg || typeof msg !== 'object') return;
      const turnNo = this.engine.s.turn ? this.engine.s.turn.no : null;
      if (this.strokeTurn !== turnNo) {
        this.strokes = [];
        this.strokeTurn = turnNo;
      }
      if (msg.k === 'clear') this.strokes = [];
      else this.strokes.push(msg);
      if (this.strokes.length > 5000) this.strokes.splice(0, this.strokes.length - 5000);
      for (const [connId, c] of this.conns) {
        if (connId !== fromConn && c.pid) this.link.send(connId, { t: 'stroke', s: msg });
      }
      this.saveSoon();
    }

    kicked(pid) {
      for (const [connId, c] of this.conns) {
        if (c.pid === pid) {
          this.link.send(connId, { t: 'kicked' });
          c.pid = null;
        }
      }
    }

    changed() {
      const s = this.engine.s;
      const turnNo = s.turn ? s.turn.no : null;
      if (this.strokeTurn !== turnNo) {
        this.strokes = [];
        this.strokeTurn = turnNo;
      }
      this.save();
      for (const [connId, c] of this.conns) {
        if (c.pid) this.link.send(connId, { t: 'view', v: this.engine.viewFor(c.pid), code: this.code });
      }
      const view = this.engine.viewFor(this.pid);
      view.room = this.code;
      this.cb.onView(view);
    }

    dispatch(action) {
      this.engine.apply(action, this.pid);
    }

    sendStroke(msg) {
      this.relayStroke(msg, null);
    }

    leave() {
      clearInterval(this.pinger);
      clearTimeout(this.saveTimer);
      for (const [connId] of this.conns) this.link.send(connId, { t: 'closed' });
      this.engine.dispose();
      setTimeout(() => this.link.close(), 150);
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
      this.cb = cb;
      this.mode = 'client';
      this.code = Net.cleanCode(opts.code);
      this.name = opts.name || '';
      this.role = opts.role || 'player';
      this.pid = opts.pid || playerId();
      setPlayerId(this.pid);
      this.left = false;
      this.everConnected = false;
      this.failures = 0;
      this.connect();
      this.pinger = setInterval(() => this.heartbeat(), PING_MS);
    }

    connect() {
      if (this.left) return;
      this.last = Date.now();
      this.cb.onStatus(this.everConnected ? 'reconnecting' : 'connecting');
      this.link = Net.join(this.code, {
        onOpen: () => {
          this.connected = true;
          this.failures = 0;
          this.last = Date.now();
          this.link.send({ t: 'hello', pid: this.pid, name: this.name, role: this.role });
        },
        onMessage: (data) => this.message(data),
        onClose: () => this.lost(),
        onError: (err) => {
          if (err === 'not-found' && !this.everConnected) {
            this.left = true;
            this.cb.onStatus('error', { error: 'not-found' });
          } else this.lost();
        },
      });
    }

    lost() {
      this.connected = false;
      if (this.left) return;
      this.failures += 1;
      if (!this.everConnected && this.failures >= 3) {
        this.left = true;
        this.cb.onStatus('error', { error: 'failed' });
        return;
      }
      this.cb.onStatus('reconnecting');
      clearTimeout(this.retry);
      this.retry = setTimeout(() => this.connect(), Math.min(8000, 1500 * this.failures));
    }

    heartbeat() {
      if (!this.connected || !this.link) return;
      if (Date.now() - this.last > DEAD_MS) {
        try {
          this.link.close();
        } catch {
          /* egal */
        }
        this.lost();
        return;
      }
      this.link.send({ t: 'ping' });
    }

    message(data) {
      if (!data || typeof data !== 'object') return;
      this.last = Date.now();
      switch (data.t) {
        case 'welcome':
          this.everConnected = true;
          Store.set(KEYS.client, { code: this.code, pid: this.pid, name: this.name, role: this.role, savedAt: Date.now() });
          this.cb.onStatus('online', { code: this.code });
          break;
        case 'view':
          data.v.room = this.code;
          this.cb.onView(data.v);
          break;
        case 'stroke':
          this.cb.onStroke(data.s);
          break;
        case 'strokes':
          this.cb.onStrokes(data.all || []);
          break;
        case 'kicked':
          this.leave();
          this.cb.onKicked('kicked');
          break;
        case 'closed':
          this.leave();
          this.cb.onKicked('closed');
          break;
        default:
          break;
      }
    }

    dispatch(action) {
      if (this.connected) this.link.send({ t: 'action', a: action });
    }

    sendStroke(msg) {
      if (this.connected) this.link.send({ t: 'stroke', s: msg });
    }

    leave() {
      if (this.left && !this.link) return;
      this.left = true;
      clearInterval(this.pinger);
      clearTimeout(this.retry);
      if (this.link) {
        try {
          this.link.send({ t: 'bye' });
        } catch {
          /* egal */
        }
        const link = this.link;
        setTimeout(() => link.close(), 100);
        this.link = null;
      }
      Store.remove(KEYS.client);
    }
  }

  root.ActivityControllers = { OfflineController, HostController, ClientController, Store, KEYS, playerId };
})(window);
