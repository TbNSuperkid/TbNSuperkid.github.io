'use strict';
/*
 * MiniGames – kleiner Node-Server
 *  - liefert die statische Website aus (Spieleauswahl + Spiele in Unterordnern)
 *  - stellt unter /ws ein WebSocket-Relay für den Online-Modus bereit
 *
 * Das Relay ist "dumm": Die komplette Spiellogik läuft im Browser des Hosts.
 * Der Server leitet nur Nachrichten zwischen Host und Mitspielern eines Raums weiter.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const ROOM_TTL_MS = 30 * 60 * 1000; // Raum ohne Host wird nach 30 Minuten gelöscht
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Nur diese Pfade werden ausgeliefert (Server-Code, node_modules usw. bleiben privat).
// Neues Spiel? Ordner hier bei PUBLIC_DIRS eintragen.
const PUBLIC_FILES = new Set(['/index.html', '/hub.css', '/manifest.webmanifest', '/sw.js', '/favicon.svg']);
const PUBLIC_DIRS = ['/vendor/', '/shared/', '/assets/', '/activity/', '/zwei-dumme/'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
};

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  // Ordner ohne Schrägstrich (z. B. /activity) umleiten, sonst stimmen relative Pfade nicht
  if (PUBLIC_DIRS.includes(pathname + '/')) {
    const { search } = new URL(req.url, 'http://x');
    res.writeHead(301, { Location: pathname + '/' + search }).end();
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  // Im Server-Betrieb wird das WebSocket-Relay statt PeerJS benutzt
  if (pathname === '/shared/config.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' });
    res.end("window.GAME_CONFIG = { transport: 'ws' };\n");
    return;
  }

  const allowed = PUBLIC_FILES.has(pathname) || PUBLIC_DIRS.some((d) => pathname.startsWith(d));
  const file = path.normalize(path.join(ROOT, pathname));
  if (!allowed || !file.startsWith(ROOT + path.sep) || pathname.includes('..')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res);
});

/* ------------------------------------------------------------------ */
/* WebSocket-Relay                                                     */
/* ------------------------------------------------------------------ */

/** @type {Map<string, {code:string, key:string, host:any, clients:Map<string, any>, emptySince:number|null}>} */
const rooms = new Map();

function randomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 5; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  } while (rooms.has(code));
  return code;
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 512 * 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.role = null; // 'host' | 'client'
  ws.room = null;
  ws.connId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'host' && !ws.role) {
      let room = null;
      const wanted = typeof msg.code === 'string' ? msg.code.toUpperCase() : null;
      if (wanted && rooms.has(wanted)) {
        const existing = rooms.get(wanted);
        // Host darf seinen Raum nach einem Reload zurückholen
        if (existing.key === msg.key) {
          if (existing.host && existing.host !== ws) existing.host.close(4000, 'replaced');
          room = existing;
        } else {
          send(ws, { type: 'error', error: 'code-taken' });
          return;
        }
      } else if (wanted && /^[A-Z0-9]{4,8}$/.test(wanted) && typeof msg.key === 'string') {
        room = { code: wanted, key: msg.key, host: null, clients: new Map(), emptySince: null };
        rooms.set(wanted, room);
      } else {
        const code = randomCode();
        room = { code, key: crypto.randomBytes(12).toString('hex'), host: null, clients: new Map(), emptySince: null };
        rooms.set(code, room);
      }
      room.host = ws;
      room.emptySince = null;
      ws.role = 'host';
      ws.room = room;
      send(ws, { type: 'hosted', code: room.code, key: room.key });
      // Bereits verbundene Mitspieler erneut anmelden
      for (const [connId] of room.clients) send(ws, { type: 'peer-join', connId });
      return;
    }

    if (msg.type === 'join' && !ws.role) {
      const code = typeof msg.code === 'string' ? msg.code.toUpperCase().trim() : '';
      const room = rooms.get(code);
      if (!room || !room.host) {
        send(ws, { type: 'error', error: 'room-not-found' });
        return;
      }
      ws.role = 'client';
      ws.room = room;
      ws.connId = crypto.randomBytes(6).toString('hex');
      room.clients.set(ws.connId, ws);
      send(ws, { type: 'joined', code: room.code, connId: ws.connId });
      send(room.host, { type: 'peer-join', connId: ws.connId });
      return;
    }

    if (msg.type === 'msg' && ws.room) {
      const room = ws.room;
      if (ws.role === 'host') {
        if (msg.to === '*') {
          const payload = JSON.stringify({ type: 'msg', data: msg.data });
          for (const client of room.clients.values()) if (client.readyState === 1) client.send(payload);
        } else {
          send(room.clients.get(msg.to), { type: 'msg', data: msg.data });
        }
      } else if (ws.role === 'client') {
        send(room.host, { type: 'msg', from: ws.connId, data: msg.data });
      }
    }
  });

  ws.on('close', () => {
    const room = ws.room;
    if (!room) return;
    if (ws.role === 'host' && room.host === ws) {
      room.host = null;
      room.emptySince = Date.now();
      // Mitspieler trennen – sie verbinden sich automatisch neu, sobald der Host zurück ist
      for (const client of room.clients.values()) client.close(4001, 'host-left');
      room.clients.clear();
    } else if (ws.role === 'client') {
      room.clients.delete(ws.connId);
      send(room.host, { type: 'peer-leave', connId: ws.connId });
    }
  });
});

// Tote Verbindungen erkennen & verwaiste Räume aufräumen
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.host && room.emptySince && now - room.emptySince > ROOM_TTL_MS) rooms.delete(code);
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`MiniGames läuft auf http://localhost:${PORT}`);
});
