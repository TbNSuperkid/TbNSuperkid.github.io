/*
 * Handy-Verbindung für alle Spiele: Ein Gerät (Laptop/Host) öffnet einen Raum, Handys treten bei.
 * Baut auf shared/net.js auf und übernimmt alles, was sonst jedes Spiel selbst bräuchte:
 *  - Begrüßung mit Spiel-Kennung (niemand landet mit einem fremden Raum-Code im falschen Spiel)
 *  - Ping, tote Verbindungen erkennen, automatisch wieder verbinden
 *  - Spieler-ID pro Browser-Tab, Speichern im Browser (Store)
 *  - QR-Code und Einladungslink
 *
 * Jedes Spiel holt sich ein eigenes Kit:
 *   const Room = GameRoom.create({ game: 'zwei-dumme', net: 'zweidumme-v1-', storage: 'zweidumme', engine })
 *
 *   Room.HostLink / Room.ClientLink        Verbindungen ohne Spiellogik (z.B. Guess the word!)
 *   Room.StageController / ClientController fertige Controller für „Laptop = Bühne, Handys spielen mit“.
 *                                           Die Engine braucht dafür: new Engine(state, {onChange, onKick}),
 *                                           .s, .write, setAllOffline(), connect(pid, name), disconnect(pid),
 *                                           apply(action, pid), viewFor(pid), dispose()
 *
 * Nachrichten: hello {pid, name, game, …} · welcome {pid, game} · view {v} · action {a} ·
 *              ping · bye · kicked · closed · error {error}
 */
(function (root) {
  'use strict';

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

  function call(fn, ...args) {
    if (typeof fn === 'function') return fn(...args);
    return undefined;
  }

  function closeSoon(link, ms) {
    setTimeout(() => {
      try {
        link.close();
      } catch {
        /* egal */
      }
    }, ms);
  }

  /** Link, den die Handys öffnen (param 'raum' für Mitspieler, Guess the word! nutzt 'karte' für die Kartenhand) */
  function inviteLink(code, param) {
    return root.location.origin + root.location.pathname + '?' + (param || 'raum') + '=' + encodeURIComponent(code);
  }

  function qrSvg(text) {
    try {
      const qr = root.qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    } catch {
      return '';
    }
  }

  /**
   * @param {object} opts
   * @param {string} opts.game     Spiel-Kennung, wird bei der Begrüßung geprüft
   * @param {string} opts.net      PeerJS-Präfix, trennt die Räume der Spiele
   * @param {string} opts.storage  Präfix für die Speicher-Schlüssel (z.B. 'zweidumme' → 'zweidumme.stage.v1')
   * @param {object} [opts.engine] { Engine, STAGE } – nur für StageController
   * @param {boolean} [opts.legacy] Gegenstellen ohne Spiel-Kennung akzeptieren (ältere Versionen von Guess the word!, früher „Activity“)
   */
  function create(opts) {
    const game = opts.game;
    const storage = opts.storage;
    const legacy = !!opts.legacy;
    const Net = root.GameNet.create(opts.net);
    const PID_KEY = storage + '.pid';

    const key = (name) => storage + '.' + name + '.v1';
    const KEYS = { stage: key('stage'), client: key('client') };

    function sameGame(other) {
      return other === game || (legacy && other == null);
    }

    /** Spieler-ID pro Browser-Tab (bleibt beim Neuladen erhalten) */
    function playerId() {
      try {
        let id = root.sessionStorage.getItem(PID_KEY);
        if (!id) {
          id = randomId();
          root.sessionStorage.setItem(PID_KEY, id);
        }
        return id;
      } catch {
        return randomId();
      }
    }

    function setPlayerId(id) {
      try {
        root.sessionStorage.setItem(PID_KEY, id);
      } catch {
        /* egal */
      }
    }

    /* ---------------------------------------------------------------- */

    /**
     * Raum auf dem Host. Kümmert sich um Verbindungen, Begrüßung und Ping;
     * was gespielt wird, entscheidet das Spiel über die Callbacks:
     *   accept(pid, hello) -> false lehnt ab · onHello(pid, hello, connId) · onAction(pid, action, connId)
     *   onMessage(pid, data, connId) für eigene Nachrichten · onGone(pid) letzte Verbindung weg
     *   onReady(code, key) · onError(err) · onDisconnect()
     */
    class HostLink {
      constructor(o) {
        this.o = o;
        this.conns = new Map(); // connId -> {pid, last}
        this.code = o.code || null;
        this.key = o.key || null;
        this.state = 'connecting';
        this.error = null;
        this.link = Net.host({
          code: this.code,
          key: this.key,
          onReady: (code, k) => {
            this.code = code;
            this.key = k;
            this.state = 'online';
            this.error = null;
            call(o.onReady, code, k);
          },
          onJoin: (connId) => this.conns.set(connId, { pid: null, last: Date.now() }),
          onLeave: (connId) => this.drop(connId),
          onMessage: (connId, data) => this.message(connId, data),
          onError: (err) => {
            this.state = 'error';
            this.error = err;
            call(o.onError, err);
          },
          onDisconnect: () => {
            this.state = 'connecting';
            for (const id of [...this.conns.keys()]) this.drop(id);
            call(o.onDisconnect);
          },
        });
        this.pinger = setInterval(() => this.heartbeat(), PING_MS);
      }

      send(connId, msg) {
        if (this.link) this.link.send(connId, msg);
      }

      /** fn(pid, connId) für jedes begrüßte Gerät */
      each(fn) {
        for (const [connId, c] of this.conns) if (c.pid) fn(c.pid, connId);
      }

      /** Anzahl begrüßter Geräte */
      count() {
        let n = 0;
        this.each(() => n++);
        return n;
      }

      heartbeat() {
        const now = Date.now();
        for (const [connId, c] of this.conns) {
          if (now - c.last > DEAD_MS) this.drop(connId);
          else this.send(connId, { t: 'ping' });
        }
      }

      drop(connId) {
        const c = this.conns.get(connId);
        if (!c) return;
        this.conns.delete(connId);
        if (c.pid && ![...this.conns.values()].some((o) => o.pid === c.pid)) call(this.o.onGone, c.pid);
      }

      message(connId, data) {
        if (!data || typeof data !== 'object') return;
        let c = this.conns.get(connId);
        if (!c) {
          c = { pid: null, last: Date.now() };
          this.conns.set(connId, c);
        }
        c.last = Date.now();
        switch (data.t) {
          case 'hello':
            this.hello(connId, c, data);
            break;
          case 'action':
            if (c.pid) call(this.o.onAction, c.pid, data.a, connId);
            break;
          case 'bye':
            this.drop(connId);
            break;
          case 'ping':
            break;
          default:
            if (c.pid) call(this.o.onMessage, c.pid, data, connId);
        }
      }

      hello(connId, c, data) {
        if (!sameGame(data.game)) {
          this.send(connId, { t: 'error', error: 'wrong-game' });
          return;
        }
        const pid = String(data.pid || '').slice(0, 40);
        if (!pid || call(this.o.accept, pid, data) === false) {
          this.send(connId, { t: 'error', error: 'bad-id' });
          return;
        }
        c.pid = pid;
        this.send(connId, { t: 'welcome', pid, game });
        call(this.o.onHello, pid, data, connId);
      }

      /** Gerät hinauswerfen (es bekommt 'kicked' und wird nicht mehr als Spieler behandelt) */
      kick(pid) {
        for (const [connId, c] of this.conns) {
          if (c.pid === pid) {
            this.send(connId, { t: 'kicked' });
            c.pid = null;
          }
        }
      }

      /** Raum schließen. notify: Handys erfahren, dass das Spiel vorbei ist (sonst warten sie auf die Rückkehr) */
      close(notify) {
        clearInterval(this.pinger);
        if (!this.link) return;
        if (notify) for (const [connId] of this.conns) this.send(connId, { t: 'closed' });
        closeSoon(this.link, 150);
        this.link = null;
        this.conns.clear();
      }
    }

    /* ---------------------------------------------------------------- */

    /**
     * Handy, verbunden mit einem Host. Verbindet sich bei Abbrüchen selbst wieder.
     * opts: { code, name?, pid?, hello?: {…zusätzliche Felder, werden auch gespeichert}, save?: false = nicht fürs Fortsetzen merken }
     * cb:   onView(view), onStatus(status, info), onKicked(reason), onMessage?(data)
     *       status: 'connecting' | 'reconnecting' | 'online' | 'error' (info.error: not-found, wrong-game, failed …)
     */
    class ClientLink {
      constructor(o, cb) {
        this.cb = cb;
        this.mode = 'client';
        this.code = Net.cleanCode(o.code);
        this.name = o.name || '';
        this.extra = o.hello || {};
        this.remember = o.save !== false;
        this.pid = o.pid || playerId();
        setPlayerId(this.pid);
        this.left = false;
        this.connected = false;
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
            this.send(Object.assign({}, this.extra, { t: 'hello', pid: this.pid, name: this.name, game }));
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
        this.send({ t: 'ping' });
      }

      message(data) {
        if (!data || typeof data !== 'object') return;
        this.last = Date.now();
        switch (data.t) {
          case 'welcome':
            // Ein anderes Spiel mit demselben Raum-Code antwortet mit anderer (oder ohne) Kennung
            if (!sameGame(data.game)) {
              this.fail('wrong-game');
              return;
            }
            this.everConnected = true;
            if (this.remember) Store.set(KEYS.client, Object.assign({}, this.extra, { code: this.code, pid: this.pid, name: this.name, savedAt: Date.now() }));
            this.cb.onStatus('online', { code: this.code });
            break;
          case 'view':
            if (data.v && (legacy || data.v.game === game)) this.cb.onView(data.v);
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
          case 'ping':
            break;
          default:
            call(this.cb.onMessage, data);
        }
      }

      send(msg) {
        if (this.connected && this.link) this.link.send(msg);
      }

      dispatch(action) {
        this.send({ t: 'action', a: action });
      }

      /** Beim Schließen der Seite: Host sofort Bescheid geben */
      bye() {
        try {
          this.send({ t: 'bye' });
        } catch {
          /* egal */
        }
      }

      leave() {
        if (this.left && !this.link) return;
        this.left = true;
        this.connected = false;
        clearInterval(this.pinger);
        clearTimeout(this.retry);
        if (this.link) {
          try {
            this.link.send({ t: 'bye' });
          } catch {
            /* egal */
          }
          closeSoon(this.link, 100);
          this.link = null;
        }
        if (this.remember) Store.remove(KEYS.client);
      }
    }

    /* ---------------------------------------------------------------- */

    /**
     * Laptop/Bühne: führt die Engine aus. Mit Handys (engine.write) öffnet er einen Raum.
     * engine.listen: Raum nur nebenbei (z.B. für Schlüsselkarten) – klappt das nicht, läuft das Spiel trotzdem.
     * opts: { state, code?, key? } · cb: onView(view), onStatus(), onKicked()
     * Die Bühnen-Ansicht bekommt view.room = { code, state, error } (nur mit Handys).
     */
    class StageController {
      constructor(o, cb) {
        const { Engine, STAGE } = opts.engine;
        this.STAGE = STAGE;
        this.cb = cb;
        this.mode = 'stage';
        this.code = o.code || null;
        this.key = o.key || null;
        this.host = null;
        this.engine = new Engine(o.state, {
          onChange: () => this.changed(),
          onKick: (pid) => this.host && this.host.kick(pid),
        });
        if (this.engine.write) {
          this.engine.setAllOffline();
          this.openRoom();
        } else if (this.engine.listen) {
          try {
            this.openRoom();
          } catch {
            this.host = null;
          }
        }
        this.changed();
      }

      openRoom() {
        this.host = new HostLink({
          code: this.code,
          key: this.key,
          accept: (pid) => pid !== this.STAGE,
          onReady: (code, k) => {
            this.code = code;
            this.key = k;
            this.changed();
          },
          onHello: (pid, hello) => this.engine.connect(pid, hello.name),
          onAction: (pid, action) => this.engine.apply(action, pid),
          onGone: (pid) => this.engine.disconnect(pid),
          onError: () => this.changed(),
          onDisconnect: () => this.changed(),
        });
      }

      save() {
        Store.set(KEYS.stage, { state: this.engine.s, code: this.code, key: this.key, savedAt: Date.now() });
      }

      changed() {
        this.save();
        if (this.host) this.host.each((pid, connId) => this.host.send(connId, { t: 'view', v: this.engine.viewFor(pid) }));
        const view = this.engine.viewFor(this.STAGE);
        view.room = this.host ? { code: this.code, state: this.host.state, error: this.host.error } : null;
        this.cb.onView(view);
      }

      dispatch(action) {
        this.engine.apply(action, this.STAGE);
      }

      /** keepSave: Spiel pausieren – Spielstand bleibt, Handys warten auf die Rückkehr */
      leave(keepSave) {
        this.engine.dispose();
        if (this.host) {
          this.host.close(!keepSave);
          this.host = null;
        }
        if (!keepSave) Store.remove(KEYS.stage);
      }
    }

    return {
      game,
      Net,
      Store,
      KEYS,
      key,
      playerId,
      setPlayerId,
      inviteLink,
      qrSvg,
      HostLink,
      ClientLink,
      StageController,
      ClientController: ClientLink,
    };
  }

  root.GameRoom = { create, Store, inviteLink, qrSvg, PING_MS, DEAD_MS };
})(typeof window !== 'undefined' ? window : globalThis);
