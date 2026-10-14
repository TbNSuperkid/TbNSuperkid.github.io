/*
 * Netzwerk für die Online-Modi aller Spiele.
 *
 * Zwei Transportwege mit gleicher Schnittstelle:
 *  - "ws":   WebSocket-Relay des mitgelieferten Node-Servers (npm start)
 *  - "peer": PeerJS/WebRTC – funktioniert auch auf reinem Static-Hosting (z.B. GitHub Pages)
 *
 * Jedes Spiel holt sich eine eigene Instanz: const Net = GameNet.create('meinspiel-v1-')
 * (das Präfix trennt die PeerJS-Räume der Spiele voneinander).
 *
 * Host:   Net.host({code, key, onReady, onJoin, onLeave, onMessage, onError, onDisconnect})
 *           -> { send(connId, data), close() }
 * Client: Net.join(code, {onOpen, onMessage, onClose, onError})
 *           -> { send(data), close() }
 */
(function (root) {
  'use strict';

  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function config() {
    return root.GAME_CONFIG || {};
  }

  function transport() {
    return config().transport === 'ws' ? 'ws' : 'peer';
  }

  function randomCode() {
    let s = '';
    const buf = new Uint32Array(5);
    root.crypto.getRandomValues(buf);
    for (let i = 0; i < 5; i++) s += CODE_CHARS[buf[i] % CODE_CHARS.length];
    return s;
  }

  function cleanCode(code) {
    return String(code || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8);
  }

  /* ------------------------------------------------------------------ */
  /* WebSocket-Relay                                                     */
  /* ------------------------------------------------------------------ */

  function wsUrl() {
    if (config().wsUrl) return config().wsUrl;
    const proto = root.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + root.location.host + '/ws';
  }

  class WsHost {
    constructor(opts) {
      this.opts = opts;
      this.code = opts.code ? cleanCode(opts.code) : null;
      this.key = opts.key || null;
      this.closed = false;
      this.ready = false;
      this.connect();
    }

    connect() {
      const ws = (this.ws = new WebSocket(wsUrl()));
      ws.onopen = () => ws.send(JSON.stringify({ type: 'host', code: this.code, key: this.key }));
      ws.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type === 'hosted') {
          this.code = msg.code;
          this.key = msg.key;
          this.ready = true;
          this.opts.onReady(msg.code, msg.key);
        } else if (msg.type === 'peer-join') this.opts.onJoin(msg.connId);
        else if (msg.type === 'peer-leave') this.opts.onLeave(msg.connId);
        else if (msg.type === 'msg') this.opts.onMessage(msg.from, msg.data);
        else if (msg.type === 'error') {
          if (msg.error === 'code-taken') {
            // Code gehört inzwischen jemand anderem – neuen Raum aufmachen
            this.code = null;
            this.key = null;
            ws.send(JSON.stringify({ type: 'host' }));
          } else if (this.opts.onError) this.opts.onError(msg.error);
        }
      };
      ws.onclose = () => {
        if (this.closed) return;
        if (this.ready && this.opts.onDisconnect) this.opts.onDisconnect();
        this.ready = false;
        clearTimeout(this.retry);
        this.retry = setTimeout(() => this.connect(), 2000);
      };
      ws.onerror = () => {};
    }

    send(connId, data) {
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'msg', to: connId, data }));
    }

    close() {
      this.closed = true;
      clearTimeout(this.retry);
      if (this.ws) this.ws.close();
    }
  }

  class WsClient {
    constructor(code, opts) {
      this.opts = opts;
      this.closed = false;
      this.open = false;
      const ws = (this.ws = new WebSocket(wsUrl()));
      ws.onopen = () => ws.send(JSON.stringify({ type: 'join', code: cleanCode(code) }));
      ws.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type === 'joined') {
          this.open = true;
          opts.onOpen();
        } else if (msg.type === 'msg') opts.onMessage(msg.data);
        else if (msg.type === 'error') {
          this.closed = true;
          ws.close();
          opts.onError(msg.error === 'room-not-found' ? 'not-found' : msg.error);
        }
      };
      ws.onclose = () => {
        if (this.closed) return;
        this.closed = true;
        opts.onClose(this.open ? 'lost' : 'failed');
      };
      ws.onerror = () => {};
    }

    send(data) {
      if (this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'msg', data }));
    }

    close() {
      this.closed = true;
      this.ws.close();
    }
  }

  /* ------------------------------------------------------------------ */
  /* PeerJS (WebRTC)                                                     */
  /* ------------------------------------------------------------------ */

  function peerOptions() {
    const base = {
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun.cloudflare.com:3478' },
        ],
      },
    };
    return Object.assign(base, config().peer || {});
  }

  function needPeer() {
    if (!root.Peer) throw new Error('PeerJS konnte nicht geladen werden.');
  }

  class PeerHost {
    constructor(prefix, opts) {
      needPeer();
      this.prefix = prefix;
      this.opts = opts;
      this.conns = new Map();
      this.closed = false;
      this.ready = false;
      this.tries = 0;
      this.start(opts.code ? cleanCode(opts.code) : randomCode(), !!opts.code);
    }

    start(code, restoring) {
      if (this.closed) return;
      this.code = code;
      const peer = (this.peer = new root.Peer(this.prefix + code.toLowerCase(), peerOptions()));
      peer.on('open', () => {
        this.tries = 0;
        if (!this.ready) {
          this.ready = true;
          this.opts.onReady(code, null);
        }
      });
      peer.on('connection', (conn) => {
        const id = conn.connectionId || conn.peer;
        conn.on('open', () => {
          this.conns.set(id, conn);
          this.opts.onJoin(id);
        });
        conn.on('data', (data) => this.opts.onMessage(id, data));
        const gone = () => {
          if (this.conns.get(id) === conn) {
            this.conns.delete(id);
            this.opts.onLeave(id);
          }
        };
        conn.on('close', gone);
        conn.on('error', gone);
      });
      peer.on('disconnected', () => {
        // Verbindung zum Vermittlungsserver weg – bestehende Verbindungen laufen weiter
        if (this.closed || peer.destroyed) return;
        setTimeout(() => {
          if (!this.closed && !peer.destroyed && peer.disconnected) peer.reconnect();
        }, 2500);
      });
      peer.on('error', (err) => {
        if (this.closed) return;
        if (err.type === 'unavailable-id') {
          peer.destroy();
          if (restoring && this.tries++ < 20) {
            // Die alte Sitzung ist auf dem Server evtl. noch nicht abgelaufen
            setTimeout(() => this.start(code, true), 3000);
          } else {
            this.start(randomCode(), false);
          }
        } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
          if (!this.ready && this.tries++ > 3 && this.opts.onError) this.opts.onError('server');
          if (!peer.destroyed) {
            setTimeout(() => {
              if (!this.closed && !peer.destroyed && peer.disconnected) peer.reconnect();
            }, 3000);
          }
        } else if (err.type === 'browser-incompatible' && this.opts.onError) {
          this.opts.onError('browser');
        }
      });
    }

    send(connId, data) {
      const c = this.conns.get(connId);
      if (c && c.open) c.send(data);
    }

    close() {
      this.closed = true;
      if (this.peer) this.peer.destroy();
    }
  }

  class PeerClient {
    constructor(prefix, code, opts) {
      needPeer();
      this.opts = opts;
      this.closed = false;
      this.open = false;
      const peer = (this.peer = new root.Peer(peerOptions()));
      this.timeout = setTimeout(() => this.fail('failed'), 20000);
      peer.on('open', () => {
        const conn = (this.conn = peer.connect(prefix + cleanCode(code).toLowerCase(), {
          reliable: true,
          serialization: 'json',
        }));
        conn.on('open', () => {
          clearTimeout(this.timeout);
          this.open = true;
          opts.onOpen();
        });
        conn.on('data', (data) => opts.onMessage(data));
        conn.on('close', () => this.fail('lost'));
        conn.on('error', () => this.fail('lost'));
      });
      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') {
          if (this.closed) return;
          this.closed = true;
          clearTimeout(this.timeout);
          peer.destroy();
          opts.onError('not-found');
        } else if (!this.open) {
          this.fail(err.type === 'browser-incompatible' ? 'browser' : 'failed');
        }
      });
    }

    fail(reason) {
      if (this.closed) return;
      this.closed = true;
      clearTimeout(this.timeout);
      try {
        this.peer.destroy();
      } catch {
        /* egal */
      }
      this.opts.onClose(this.open ? 'lost' : reason);
    }

    send(data) {
      if (this.conn && this.conn.open) this.conn.send(data);
    }

    close() {
      this.closed = true;
      clearTimeout(this.timeout);
      this.peer.destroy();
    }
  }

  root.GameNet = {
    /** @param {string} peerPrefix z.B. 'activity-spiel-v1-' */
    create(peerPrefix) {
      return {
        transport,
        cleanCode,
        randomCode,
        host(opts) {
          return transport() === 'ws' ? new WsHost(opts) : new PeerHost(peerPrefix, opts);
        },
        join(code, opts) {
          return transport() === 'ws' ? new WsClient(code, opts) : new PeerClient(peerPrefix, code, opts);
        },
      };
    },
  };
})(window);
