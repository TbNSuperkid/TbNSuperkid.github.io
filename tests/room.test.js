'use strict';
/* Tests für den gemeinsamen Handy-Code shared/room.js (ohne Browser): node tests/room.test.js */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}
globalThis.localStorage = memoryStorage();
globalThis.sessionStorage = memoryStorage();
globalThis.location = { origin: 'https://example.org', pathname: '/zwei-dumme/' };

/* ---------- Netzwerk-Ersatz: alle Räume im Speicher, Nachrichten asynchron ---------- */

const rooms = new Map(); // code -> host-Optionen + Verbindungen
let nextConn = 1;
const later = (fn) => setImmediate(fn);
const copy = (data) => JSON.parse(JSON.stringify(data));

globalThis.GameNet = {
  create(prefix) {
    return {
      cleanCode: (c) =>
        String(c || '')
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, ''),
      host(opts) {
        const code = opts.code || 'R' + nextConn++;
        const room = { opts, conns: new Map(), open: true };
        rooms.set(prefix + code, room);
        later(() => opts.onReady(code, 'key-' + code));
        return {
          send(connId, data) {
            const c = room.conns.get(connId);
            if (c && room.open) later(() => c.onMessage(copy(data)));
          },
          close() {
            room.open = false;
            rooms.delete(prefix + code);
            for (const c of room.conns.values()) later(() => c.onClose && c.onClose());
          },
        };
      },
      join(code, opts) {
        const room = rooms.get(prefix + code);
        if (!room) {
          later(() => opts.onError('not-found'));
          return { send() {}, close() {} };
        }
        const connId = 'c' + nextConn++;
        room.conns.set(connId, opts);
        later(() => {
          room.opts.onJoin(connId);
          opts.onOpen();
        });
        return {
          send(data) {
            if (room.open && room.conns.has(connId)) later(() => room.opts.onMessage(connId, copy(data)));
          },
          close() {
            room.conns.delete(connId);
            later(() => room.opts.onLeave(connId));
          },
        };
      },
    };
  },
};

require(path.join(__dirname, '..', 'shared', 'room.js'));
const { GameRoom } = globalThis;

/* ---------- Mini-Engine mit der Schnittstelle, die StageController erwartet ---------- */

const STAGE = '__stage__';
class FakeEngine {
  constructor(state, hooks) {
    this.s = state;
    this.hooks = hooks;
    this.write = state.write;
    this.log = [];
  }
  setAllOffline() {}
  connect(pid, name) {
    this.s.players[pid] = { name, online: true };
    this.hooks.onChange();
  }
  disconnect(pid) {
    if (this.s.players[pid]) this.s.players[pid].online = false;
    this.log.push('gone:' + pid);
    this.hooks.onChange();
  }
  apply(a, pid) {
    this.log.push(pid + ':' + a.type);
    if (a.type === 'kick') this.hooks.onKick(a.pid);
    this.hooks.onChange();
  }
  viewFor(pid) {
    return { game: this.s.game, me: pid, players: Object.keys(this.s.players).length };
  }
  dispose() {}
}

/* ---------- Hilfen ---------- */

const tick = (n = 5) => new Promise((r) => (function step(i) { i ? setImmediate(() => step(i - 1)) : r(); })(n));

function recorder() {
  const r = { views: [], status: [], kicked: [] };
  r.cb = {
    onView: (v) => r.views.push(v),
    onStatus: (s, info) => r.status.push(info && info.error ? s + ':' + info.error : s),
    onKicked: (reason) => r.kicked.push(reason),
  };
  return r;
}

function stageKit(game) {
  return GameRoom.create({ game, net: game + '-', storage: game, engine: { Engine: FakeEngine, STAGE } });
}

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    console.error('  ✗ ' + name);
    throw err;
  }
}

/* ---------- Tests ---------- */

(async () => {
  console.log('shared/room.js');

  await test('Bühne öffnet Raum, Handy tritt bei und bekommt seine Ansicht', async () => {
    const Kit = stageKit('spiel-a');
    const stage = recorder();
    const ctrl = new Kit.StageController({ state: { game: 'spiel-a', write: true, players: {} } }, stage.cb);
    await tick();
    const room = stage.views[stage.views.length - 1].room;
    assert.strictEqual(room.state, 'online');
    assert.ok(room.code);
    assert.ok(Kit.Store.get(Kit.KEYS.stage).code, 'Spielstand mit Raum-Code gespeichert');

    const phone = recorder();
    const client = new Kit.ClientController({ code: room.code, name: 'Anna' }, phone.cb);
    await tick(10);
    assert.deepStrictEqual(phone.status, ['connecting', 'online']);
    assert.strictEqual(phone.views[phone.views.length - 1].me, client.pid);
    assert.strictEqual(ctrl.engine.s.players[client.pid].name, 'Anna');
    assert.strictEqual(Kit.Store.get(Kit.KEYS.client).name, 'Anna', 'Handy merkt sich den Raum zum Wiederverbinden');

    client.dispatch({ type: 'submit' });
    await tick(10);
    assert.ok(ctrl.engine.log.includes(client.pid + ':submit'));

    client.leave();
    await tick(10);
    assert.ok(ctrl.engine.log.includes('gone:' + client.pid), 'Abmelden meldet den Spieler offline');
    assert.strictEqual(Kit.Store.get(Kit.KEYS.client), null);
    ctrl.leave(false);
    assert.strictEqual(Kit.Store.get(Kit.KEYS.stage), null);
  });

  await test('Ohne Handy wird kein Raum geöffnet', async () => {
    const Kit = stageKit('spiel-b');
    const stage = recorder();
    const ctrl = new Kit.StageController({ state: { game: 'spiel-b', write: false, players: {} } }, stage.cb);
    await tick();
    assert.strictEqual(ctrl.host, null);
    assert.strictEqual(stage.views[0].room, null);
    ctrl.leave(false);
  });

  await test('Handy eines anderen Spiels wird abgewiesen', async () => {
    const A = stageKit('spiel-c');
    const B = GameRoom.create({ game: 'anderes', net: 'spiel-c-', storage: 'anderes' });
    const stage = recorder();
    const ctrl = new A.StageController({ state: { game: 'spiel-c', write: true, players: {} } }, stage.cb);
    await tick();
    const phone = recorder();
    new B.ClientController({ code: ctrl.code, name: 'Ben' }, phone.cb);
    await tick(10);
    assert.deepStrictEqual(phone.status, ['connecting', 'error:wrong-game']);
    assert.deepStrictEqual(ctrl.engine.s.players, {});
    ctrl.leave(false);
  });

  await test('Altes Gerät ohne Spiel-Kennung nur mit legacy erlaubt', async () => {
    for (const legacy of [true, false]) {
      const Kit = GameRoom.create({ game: 'alt', net: 'alt-' + legacy + '-', storage: 'alt', legacy });
      const replies = [];
      const host = new Kit.HostLink({ onHello: (pid) => replies.push('hello:' + pid) });
      await tick();
      const room = rooms.get('alt-' + legacy + '-' + host.code);
      const connId = 'alt' + legacy;
      room.conns.set(connId, { onMessage: (d) => replies.push(d.t + (d.error ? ':' + d.error : '')) });
      room.opts.onJoin(connId);
      room.opts.onMessage(connId, { t: 'hello', pid: 'p1' }); // ohne game
      await tick();
      if (legacy) assert.deepStrictEqual(replies, ['hello:p1', 'welcome']);
      else assert.deepStrictEqual(replies, ['error:wrong-game']);
      host.close(false);
    }
  });

  await test('Reservierte ID (Bühne) wird abgelehnt', async () => {
    const Kit = stageKit('spiel-d');
    const ctrl = new Kit.StageController({ state: { game: 'spiel-d', write: true, players: {} } }, recorder().cb);
    await tick();
    const phone = recorder();
    new Kit.ClientController({ code: ctrl.code, name: 'X', pid: STAGE }, phone.cb);
    await tick(10);
    assert.deepStrictEqual(phone.status, ['connecting', 'error:failed']);
    ctrl.leave(false);
  });

  await test('Hinauswerfen und Spielende erreichen das Handy', async () => {
    const Kit = stageKit('spiel-e');
    const ctrl = new Kit.StageController({ state: { game: 'spiel-e', write: true, players: {} } }, recorder().cb);
    await tick();
    const p1 = recorder();
    const p2 = recorder();
    const c1 = new Kit.ClientController({ code: ctrl.code, name: 'A' }, p1.cb);
    await tick(10);
    sessionStorage.removeItem('spiel-e.pid'); // zweites Handy = neuer Tab
    new Kit.ClientController({ code: ctrl.code, name: 'B' }, p2.cb);
    await tick(10);
    assert.strictEqual(ctrl.host.count(), 2);
    ctrl.dispatch({ type: 'kick', pid: c1.pid });
    await tick(10);
    assert.deepStrictEqual(p1.kicked, ['kicked']);
    assert.strictEqual(ctrl.host.count(), 1);
    ctrl.leave(false);
    await tick(10);
    assert.deepStrictEqual(p2.kicked, ['closed']);
  });

  await test('Pausieren: Handys bekommen kein „closed“ und warten', async () => {
    const Kit = stageKit('spiel-f');
    const ctrl = new Kit.StageController({ state: { game: 'spiel-f', write: true, players: {} } }, recorder().cb);
    await tick();
    const phone = recorder();
    const client = new Kit.ClientController({ code: ctrl.code, name: 'A' }, phone.cb);
    await tick(10);
    ctrl.leave(true);
    await new Promise((r) => setTimeout(r, 200)); // Raum schließt kurz verzögert
    await tick(10);
    assert.deepStrictEqual(phone.kicked, []);
    assert.strictEqual(phone.status[phone.status.length - 1], 'reconnecting');
    assert.ok(Kit.Store.get(Kit.KEYS.stage), 'Spielstand bleibt gespeichert');
    client.leave();
  });

  await test('Unbekannter Raum-Code', async () => {
    const Kit = stageKit('spiel-g');
    const phone = recorder();
    new Kit.ClientController({ code: 'GIBTSNICHT', name: 'A' }, phone.cb);
    await tick(10);
    assert.deepStrictEqual(phone.status, ['connecting', 'error:not-found']);
  });

  await test('Eigene Nachrichten (z.B. Zeichnen) gehen an onMessage', async () => {
    const Kit = GameRoom.create({ game: 'mal', net: 'mal-', storage: 'mal' });
    const got = [];
    const host = new Kit.HostLink({ onMessage: (pid, data) => got.push(data.t) });
    await tick();
    const phone = recorder();
    const msgs = [];
    const client = new Kit.ClientLink({ code: host.code }, Object.assign(phone.cb, { onMessage: (d) => msgs.push(d.t) }));
    await tick(10);
    client.send({ t: 'stroke', s: {} });
    host.each((pid, connId) => host.send(connId, { t: 'strokes', all: [] }));
    await tick(10);
    assert.deepStrictEqual(got, ['stroke']);
    assert.deepStrictEqual(msgs, ['strokes']);
    client.leave();
    host.close(false);
  });

  await test('Einladungslink und QR-Code', () => {
    assert.strictEqual(GameRoom.inviteLink('AB C'), 'https://example.org/zwei-dumme/?raum=AB%20C');
    assert.strictEqual(GameRoom.inviteLink('K1', 'karte'), 'https://example.org/zwei-dumme/?karte=K1');
    assert.strictEqual(GameRoom.qrSvg('x'), '', 'ohne QR-Bibliothek kein Absturz');
  });

  console.log(`\n${passed} Tests bestanden.`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
