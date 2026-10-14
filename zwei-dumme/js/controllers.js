/*
 * Controller verbinden Oberfläche, Spiellogik und Netzwerk.
 *  - StageController:  Laptop/Bühne. Führt die Engine aus; mit Handy öffnet er einen Raum,
 *                      dem die Handys beitreten.
 *  - ClientController: Handy eines Mitspielers, verbunden mit dem Laptop.
 *
 * Beide bieten dispatch(action) und leave(keepSave) und melden sich über die Callbacks
 *   onView(view), onStatus(status, info), onKicked(reason)
 */
(function (root) {
  'use strict';

  const { Engine, STAGE } = root.ZDEngine;
  const Net = root.GameNet.create('zweidumme-v1-');
  const GAME = 'zwei-dumme';

  const KEYS = {
    stage: 'zweidumme.stage.v1',
    client: 'zweidumme.client.v1',
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
      let id = root.sessionStorage.getItem('zweidumme.pid');
      if (!id) {
        id = randomId();
        root.sessionStorage.setItem('zweidumme.pid', id);
      }
      return id;
    } catch {
      return randomId();
    }
  }

  function setPlayerId(id) {
    try {
      root.sessionStorage.setItem('zweidumme.pid', id);
    } catch {
      /* egal */
    }
  }

  /* ------------------------------------------------------------------ */

  class StageController {
    /**
     * @param {{state: object, code?: string, key?: string}} opts
     */
    constructor(opts, cb) {
      this.cb = cb;
      this.mode = 'stage';
      this.conns = new Map(); // connId -> {pid, last}
      this.code = opts.code || null;
      this.key = opts.key || null;
      this.netState = null;
      this.engine = new Engine(opts.state, {
        onChange: () => this.changed(),
        onKick: (pid) => this.kicked(pid),
      });
      if (this.engine.write) {
        this.engine.setAllOffline();
        this.openRoom();
      }
      this.changed();
    }

    openRoom() {
      this.netState = 'connecting';
      this.link = Net.host({
        code: this.code,
        key: this.key,
        onReady: (code, key) => {
          this.code = code;
          this.key = key;
          this.netState = 'online';
          this.changed();
        },
        onJoin: (connId) => this.conns.set(connId, { pid: null, last: Date.now() }),
        onLeave: (connId) => this.dropConn(connId),
        onMessage: (connId, data) => this.message(connId, data),
        onError: (err) => {
          this.netState = 'error';
          this.netError = err;
          this.changed();
        },
        onDisconnect: () => {
          this.netState = 'connecting';
          for (const id of [...this.conns.keys()]) this.dropConn(id);
          this.changed();
        },
      });
      this.pinger = setInterval(() => this.heartbeat(), PING_MS);
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
        if (data.game !== GAME) {
          this.link.send(connId, { t: 'error', error: 'wrong-game' });
          return;
        }
        const pid = String(data.pid || '').slice(0, 40);
        if (!pid || pid === STAGE) {
          this.link.send(connId, { t: 'error', error: 'bad-id' });
          return;
        }
        c.pid = pid;
        this.link.send(connId, { t: 'welcome', pid, game: GAME });
        this.engine.connect(pid, data.name);
      } else if (data.t === 'action' && c.pid) {
        this.engine.apply(data.a, c.pid);
      } else if (data.t === 'bye' && c.pid) {
        this.dropConn(connId);
      }
    }

    kicked(pid) {
      for (const [connId, c] of this.conns) {
        if (c.pid === pid) {
          this.link.send(connId, { t: 'kicked' });
          c.pid = null;
        }
      }
    }

    save() {
      Store.set(KEYS.stage, { state: this.engine.s, code: this.code, key: this.key, savedAt: Date.now() });
    }

    changed() {
      this.save();
      if (this.link) {
        for (const [connId, c] of this.conns) {
          if (c.pid) this.link.send(connId, { t: 'view', v: this.engine.viewFor(c.pid) });
        }
      }
      const view = this.engine.viewFor(STAGE);
      view.room = this.engine.write ? { code: this.code, state: this.netState, error: this.netError || null } : null;
      this.cb.onView(view);
    }

    dispatch(action) {
      this.engine.apply(action, STAGE);
    }

    leave(keepSave) {
      this.engine.dispose();
      clearInterval(this.pinger);
      if (this.link) {
        // Beim Pausieren bleiben die Handys verbunden und warten auf die Rückkehr
        if (!keepSave) for (const [connId] of this.conns) this.link.send(connId, { t: 'closed' });
        const link = this.link;
        setTimeout(() => link.close(), 150);
        this.link = null;
      }
      if (!keepSave) Store.remove(KEYS.stage);
    }
  }

  /* ------------------------------------------------------------------ */

  class ClientController {
    /**
     * @param {{code: string, name: string, pid?: string}} opts
     */
    constructor(opts, cb) {
      this.cb = cb;
      this.mode = 'client';
      this.code = Net.cleanCode(opts.code);
      this.name = opts.name || '';
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
          this.link.send({ t: 'hello', pid: this.pid, name: this.name, game: GAME });
        },
        onMessage: (data) => this.message(data),
        onClose: () => this.lost(),
        onError: (err) => {
          if (err === 'not-found' && !this.everConnected) this.fail('not-found');
          else this.lost();
        },
      });
    }

    fail(error) {
      this.leave();
      this.cb.onStatus('error', { error });
    }

    lost() {
      this.connected = false;
      if (this.left) return;
      this.failures += 1;
      if (!this.everConnected && this.failures >= 3) {
        this.fail('failed');
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
          // Ein anderes Spiel (z.B. Activity) mit demselben Raum-Code antwortet ohne Kennung
          if (data.game !== GAME) {
            this.fail('wrong-game');
            return;
          }
          this.everConnected = true;
          Store.set(KEYS.client, { code: this.code, pid: this.pid, name: this.name, savedAt: Date.now() });
          this.cb.onStatus('online', { code: this.code });
          break;
        case 'view':
          if (data.v && data.v.game === GAME) this.cb.onView(data.v);
          break;
        case 'error':
          this.fail(data.error === 'wrong-game' ? 'wrong-game' : 'failed');
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

  root.ZDControllers = { StageController, ClientController, Store, KEYS, Net, playerId };
})(window);
