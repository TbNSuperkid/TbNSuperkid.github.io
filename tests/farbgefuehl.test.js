'use strict';
/* Tests für „Farbgefühl“ (ohne Browser): node tests/farbgefuehl.test.js */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
require(path.join(__dirname, '..', 'shared', 'match.js'));
for (const f of ['board', 'cards', 'cues', 'engine']) {
  require(path.join(__dirname, '..', 'farbgefuehl', 'js', f + '.js'));
}
const Board = globalThis.FGBoard;
const Cards = globalThis.FGCards;
const Cues = globalThis.FGCues;
const { Engine, STAGE, GOAL, sanitizeSettings } = globalThis.FGEngine;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    console.error('  ✗ ' + name);
    throw err;
  }
}

const NAMES = ['Anna', 'Ben', 'Cem', 'Dora', 'Eli', 'Finn', 'Gabi', 'Hans'];

function game(settings, opts) {
  const o = opts || {};
  let t = 1000;
  const hooks = { random: Cards.seeded(o.seed || 7), now: () => t };
  const state = Engine.create({ settings: Object.assign({ input: 'single' }, settings), players: o.players || NAMES.slice(0, o.n || 4) }, hooks);
  const e = new Engine(state, Object.assign({}, hooks, o.hooks));
  e.tick = (ms) => (t += ms);
  return e;
}

function act(e, type, extra, actor) {
  return e.apply(Object.assign({ type }, extra || {}), actor || STAGE);
}

/** Freie Felder in Lesereihenfolge (für Steine, die sich nicht in die Quere kommen) */
function freeCell(e, near) {
  const start = near || { r: 0, c: 0 };
  for (let d = 0; d < 40; d++) {
    for (let r = start.r - d; r <= start.r + d; r++) {
      for (let c = start.c - d; c <= start.c + d; c++) {
        const cell = { r, c };
        if (Board.valid(cell) && !e.s.stones.some((x) => Board.same(x, cell))) return cell;
      }
    }
  }
  return null;
}

/** Einen ganzen Zug spielen: Karte 0 wählen, Hinweise geben, alle setzen (Steine bei 'near' bzw. weit weg) */
function playTurn(e, near) {
  assert.strictEqual(e.s.phase, 'pick');
  assert.ok(act(e, 'pick', { index: 0 }));
  const target = e.s.target;
  for (let round = 1; round <= (e.s.settings.secondCue ? 2 : 1); round++) {
    assert.strictEqual(e.s.phase, 'cue');
    assert.ok(act(e, 'cue', { text: 'Hinweis' + e.s.turnNo + round }));
    while (e.s.phase === 'place') assert.ok(act(e, 'place', { cell: freeCell(e, near || target) }));
  }
  assert.strictEqual(e.s.phase, 'reveal');
}

/* ---------- Farbtafel ---------- */

console.log('Farbtafel');

test('480 Felder, gültige Hex-Werte, keine zwei gleich', () => {
  assert.strictEqual(Board.ROWS * Board.COLS, 480);
  const all = Board.COLORS.flat();
  assert.strictEqual(all.length, 480);
  for (const hex of all) assert.match(hex, /^#[0-9a-f]{6}$/);
  assert.strictEqual(new Set(all).size, 480);
});

test('Nachbarn sind sich ähnlicher als weit entfernte Felder', () => {
  let near = 0;
  let far = 0;
  let n = 0;
  for (let r = 0; r < Board.ROWS; r++) {
    for (let c = 0; c < Board.COLS - 1; c++) {
      near += Board.deltaE(Board.COLORS[r][c], Board.COLORS[r][c + 1]);
      far += Board.deltaE(Board.COLORS[r][c], Board.COLORS[(r + 8) % Board.ROWS][(c + 15) % Board.COLS]);
      n++;
    }
  }
  assert.ok(near / n < far / n / 3, 'Nachbarn deutlich ähnlicher');
});

test('Oben hell, unten dunkel', () => {
  const light = (hex) => Board.hexToLab(hex)[0];
  for (let c = 0; c < Board.COLS; c++) assert.ok(light(Board.COLORS[0][c]) > light(Board.COLORS[Board.ROWS - 1][c]) + 0.3);
});

test('Koordinaten A1 ↔ {0,0}, P30 ↔ {15,29}, ungültige Eingaben', () => {
  assert.strictEqual(Board.label({ r: 0, c: 0 }), 'A1');
  assert.strictEqual(Board.label({ r: 15, c: 29 }), 'P30');
  assert.deepStrictEqual(Board.parse('a1'), { r: 0, c: 0 });
  assert.deepStrictEqual(Board.parse(' P 30 '), { r: 15, c: 29 });
  assert.strictEqual(Board.parse('Q1'), null);
  assert.strictEqual(Board.parse('A31'), null);
  assert.strictEqual(Board.parse('A0'), null);
  assert.strictEqual(Board.parse(''), null);
  assert.strictEqual(Board.label({ r: 16, c: 0 }), '');
});

test('Wertung: Abstand 0/1/2/3 → 3/2/1/0, diagonal zählt wie gerade, Rand', () => {
  const t = { r: 5, c: 5 };
  assert.strictEqual(Board.points({ r: 5, c: 5 }, t), 3);
  assert.strictEqual(Board.points({ r: 6, c: 6 }, t), 2);
  assert.strictEqual(Board.points({ r: 4, c: 5 }, t), 2);
  assert.strictEqual(Board.points({ r: 7, c: 3 }, t), 1);
  assert.strictEqual(Board.points({ r: 5, c: 8 }, t), 0);
  assert.ok(Board.inFrame({ r: 4, c: 4 }, t));
  assert.ok(!Board.inFrame({ r: 3, c: 5 }, t));
  // Am Rand wird der Rahmen einfach abgeschnitten
  assert.strictEqual(Board.points({ r: 0, c: 0 }, { r: 0, c: 1 }), 2);
});

/* ---------- Karten ---------- */

console.log('Karten');

test('4 Farben aus 4 Bereichen, mit Abstand', () => {
  const rnd = Cards.seeded(3);
  for (let i = 0; i < 50; i++) {
    const card = Cards.draw(rnd);
    assert.strictEqual(card.length, 4);
    card.forEach((cell, q) => {
      assert.ok(Board.valid(cell));
      assert.ok(cell.c >= Math.round((q * Board.COLS) / 4) && cell.c < Math.round(((q + 1) * Board.COLS) / 4), 'Viertel ' + q);
    });
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) assert.ok(Board.dist(card[a], card[b]) >= Cards.MIN_GAP);
  }
});

test('Gespielte Zielfarben kommen nicht wieder', () => {
  const rnd = Cards.seeded(5);
  const used = [];
  for (let i = 0; i < 60; i++) {
    const card = Cards.draw(rnd, used);
    for (const cell of card) assert.ok(!used.includes(Board.label(cell)));
    used.push(Board.label(card[i % 4]));
  }
});

/* ---------- Hinweise ---------- */

console.log('Hinweise');

test('Grundfarben, hell/dunkel, Zusammensetzungen → Warnung', () => {
  for (const w of ['Dunkelrot', 'himmelblau', 'Grün', 'weiß', 'Hellgelb', 'Schwarzwald', 'blue', 'Light']) {
    const r = Cues.check(w);
    assert.ok(!r.ok, w);
    assert.ok(r.problems.some((p) => p.code === 'color'), w);
  }
});

test('Erlaubte Hinweise: Avocado, Bordeaux, Brot, Karotte, Michelle', () => {
  for (const w of ['Avocado', 'Bordeaux', 'Brot', 'Karotte', 'Michelle', 'Türkis', 'Ocker', 'Flamingo']) assert.ok(Cues.check(w).ok, w);
});

test('Koordinaten, Zahlen, Wortanzahl, leer', () => {
  assert.ok(Cues.check('B12').problems.some((p) => p.code === 'coord'));
  assert.ok(Cues.check('neben b 3', { round: 2 }).problems.some((p) => p.code === 'coord'));
  assert.ok(Cues.check('Route66').problems.some((p) => p.code === 'number'));
  assert.ok(Cues.check('reife Avocado').problems.some((p) => p.code === 'words'));
  assert.ok(Cues.check('reife Avocado', { round: 2 }).ok);
  assert.ok(Cues.check('sehr reife Avocado', { round: 2 }).problems.some((p) => p.code === 'words'));
  assert.strictEqual(Cues.check('  ').problems[0].code, 'empty');
});

test('Schon benutzt (auch Plural/Tippfehler)', () => {
  assert.ok(Cues.check('Avocados', { used: ['Avocado'] }).problems.some((p) => p.code === 'used'));
  assert.ok(Cues.check('reife Avocado', { round: 2, used: ['Avocado'] }).problems.some((p) => p.code === 'used'));
  assert.ok(Cues.check('Flamingo', { used: ['Avocado'] }).ok);
});

/* ---------- Ablauf ---------- */

console.log('Ablauf');

test('Ein Gerät startet direkt mit der Karte, Hinweisgeber reihum', () => {
  const e = game({});
  assert.strictEqual(e.s.phase, 'pick');
  assert.strictEqual(e.s.giver, e.s.players[0].id);
  assert.strictEqual(e.s.card.length, 4);
  playTurn(e);
  assert.ok(act(e, 'next', { at: e.s.step }));
  assert.strictEqual(e.s.giver, e.s.players[1].id);
});

test('Reihenfolge: Runde 1 im Uhrzeigersinn ab dem Nächsten, Runde 2 umgekehrt, Hinweisgeber setzt nicht', () => {
  const e = game({}, { n: 4 });
  act(e, 'next'); // nichts passiert in pick
  const [a, b, c, d] = e.s.players.map((p) => p.id);
  playTurn(e);
  act(e, 'next', { at: e.s.step });
  // Jetzt gibt b den Hinweis
  assert.strictEqual(e.s.giver, b);
  act(e, 'pick', { index: 1 });
  act(e, 'cue', { text: 'Avocado' });
  assert.deepStrictEqual(e.s.queue, [c, d, a]);
  for (let i = 0; i < 3; i++) act(e, 'place', { cell: freeCell(e) });
  act(e, 'cue', { text: 'reife Schale' });
  assert.deepStrictEqual(e.s.queue, [a, d, c]);
  assert.ok(!e.s.stones.some((x) => x.player === b));
});

test('Ein Stein pro Feld (reihum), falsche Person abgelehnt', () => {
  const e = game({});
  act(e, 'pick', { index: 0 });
  act(e, 'cue', { text: 'Avocado' });
  const cell = { r: 3, c: 3 };
  assert.ok(act(e, 'place', { cell }));
  assert.ok(!act(e, 'place', { cell }), 'Feld belegt');
  assert.ok(!act(e, 'place', { cell: { r: 3, c: 4 }, player: e.s.players[0].id }), 'Hinweisgeber setzt nicht');
  assert.ok(!act(e, 'place', { cell: { r: 99, c: 4 } }), 'ungültiges Feld');
});

test('Punkte: Ratende 3/2/1/0 pro Stein, Hinweisgeber 1 pro Stein im 3 × 3-Rahmen', () => {
  const e = game({}, { n: 3 });
  const [g, x, y] = e.s.players;
  act(e, 'pick', { index: 0 });
  const t = e.s.target;
  const at = (dr, dc) => Board.clamp({ r: t.r + dr, c: t.c + dc });
  act(e, 'cue', { text: 'Avocado' });
  act(e, 'place', { cell: t }); // x: 3
  act(e, 'place', { cell: at(t.r > 0 ? -1 : 1, 0) }); // y: 2
  act(e, 'cue', { text: 'reife Schale' });
  // Runde 2 umgekehrt: erst y, dann x
  const far = { r: t.r > 7 ? 0 : 15, c: t.c > 14 ? 0 : 29 };
  act(e, 'place', { cell: far }); // y: 0
  act(e, 'place', { cell: { r: t.r, c: t.c + (t.c > 1 ? -2 : 2) } }); // x: 1
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(x.score, 4);
  assert.strictEqual(y.score, 2);
  assert.strictEqual(g.score, 2, 'zwei Steine im Rahmen');
  assert.strictEqual(x.stats.bullseyes, 1);
  assert.ok(y.stats.far >= 3);
  assert.strictEqual(e.s.result.giverPoints, 2);
  assert.strictEqual(e.s.history.length, 1);
});

test('Hinweis 2 weglassen → sofort aufdecken; Schnell-Modus ohne zweiten Hinweis', () => {
  const e = game({}, { n: 3 });
  act(e, 'pick', { index: 0 });
  act(e, 'cue', { text: 'Avocado' });
  act(e, 'place', { cell: freeCell(e) });
  act(e, 'place', { cell: freeCell(e) });
  assert.strictEqual(e.s.phase, 'cue');
  assert.ok(act(e, 'skipCue', {}));
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(e.s.stones.length, 2);

  const q = game({ secondCue: false }, { n: 3 });
  act(q, 'pick', { index: 2 });
  act(q, 'cue', { text: 'Avocado' });
  act(q, 'place', { cell: freeCell(q) });
  act(q, 'place', { cell: freeCell(q) });
  assert.strictEqual(q.s.phase, 'reveal');
});

test('Laut gesagter Hinweis (leer) nur am Laptop', () => {
  const e = game({});
  act(e, 'pick', { index: 0 });
  assert.ok(act(e, 'cue', { text: '' }));
  assert.strictEqual(e.s.cues[0], null);
  assert.strictEqual(e.s.phase, 'place');
});

test('Freie Wahl: beliebiges Feld statt Karte', () => {
  const e = game({ freePick: true });
  assert.strictEqual(e.s.card.length, 0);
  assert.ok(!act(e, 'pick', { index: 0 }));
  assert.ok(act(e, 'pick', { cell: { r: 2, c: 7 } }));
  assert.deepStrictEqual(e.s.target, { r: 2, c: 7 });
});

test('Zurücknehmen und Überspringen am Laptop', () => {
  const e = game({});
  act(e, 'pick', { index: 0 });
  act(e, 'cue', { text: 'Avocado' });
  const first = e.s.queue[0];
  act(e, 'place', { cell: { r: 1, c: 1 } });
  assert.ok(act(e, 'undo'));
  assert.strictEqual(e.s.queue[0], first);
  assert.strictEqual(e.s.stones.length, 0);
  assert.ok(act(e, 'skip', { at: e.s.step }));
  assert.notStrictEqual(e.s.queue[0], first);
  assert.strictEqual(e.s.skipped.length, 1);
});

test('Zeit pro Stein: abgelaufen → setzt aus, veraltete Meldung zählt nicht', () => {
  const e = game({ timer: 20 });
  act(e, 'pick', { index: 0 });
  act(e, 'cue', { text: 'Avocado' });
  assert.ok(e.s.deadline);
  const step = e.s.step;
  act(e, 'place', { cell: { r: 1, c: 1 } });
  assert.ok(!act(e, 'timeout', { at: step }), 'alter Stand');
  assert.ok(act(e, 'timeout', { at: e.s.step }));
  assert.strictEqual(e.s.skipped[0].reason, 'timeout');
});

/* ---------- Spielende ---------- */

console.log('Spielende');

test('Durchgänge automatisch: bis 6 Personen 2, ab 7 einer', () => {
  assert.strictEqual(game({}, { n: 3 }).turnsTotal(), 6);
  assert.strictEqual(game({}, { n: 6 }).turnsTotal(), 12);
  assert.strictEqual(game({}, { n: 7 }).turnsTotal(), 7);
  assert.strictEqual(game({ rounds: 3 }, { n: 4 }).turnsTotal(), 12);
});

test('Nach allen Zügen: Ende (ohne Gleichstand) bzw. Stechen bei Gleichstand', () => {
  const e = game({ rounds: 1 }, { n: 3 });
  for (let i = 0; i < 3; i++) {
    playTurn(e);
    if (i < 2) act(e, 'next', { at: e.s.step });
  }
  // Gleichstand an der Spitze erzwingen
  e.s.players[0].score = 10;
  e.s.players[1].score = 10;
  e.s.players[2].score = 3;
  assert.ok(act(e, 'next', { at: e.s.step }));
  assert.strictEqual(e.s.phase, 'pick');
  assert.ok(e.s.tiebreak);
  playTurn(e);
  e.s.players[0].score = 12;
  e.s.players[1].score = 11;
  e.s.players[2].score = 3;
  act(e, 'next', { at: e.s.step });
  assert.strictEqual(e.s.phase, 'end');
  assert.strictEqual(e.standings()[0].id, e.s.players[0].id);
});

test('Bis 50 Punkte', () => {
  const e = game({ to50: true }, { n: 3 });
  playTurn(e);
  act(e, 'next', { at: e.s.step });
  assert.strictEqual(e.s.phase, 'pick');
  playTurn(e);
  e.s.players[2].score = GOAL;
  act(e, 'next', { at: e.s.step });
  assert.strictEqual(e.s.phase, 'end');
});

test('Nochmal: Punkte und Statistik von vorn, Auszeichnungen', () => {
  const e = game({ rounds: 1 }, { n: 3 });
  for (let i = 0; i < 3; i++) {
    playTurn(e);
    act(e, 'next', { at: e.s.step });
    if (e.s.phase === 'pick' && e.s.tiebreak) break;
  }
  act(e, 'finish');
  assert.strictEqual(e.s.phase, 'end');
  const v = e.viewFor(STAGE);
  assert.ok(Array.isArray(v.awards));
  assert.ok(v.awards.some((a) => a.id === 'eagle' || a.id === 'cue' || a.id === 'poet'));
  assert.ok(act(e, 'again'));
  assert.strictEqual(e.s.phase, 'pick');
  assert.ok(e.s.players.every((p) => p.score === 0));
  assert.strictEqual(e.s.history.length, 0);
});

/* ---------- Mit Handys ---------- */

console.log('Mit Handys');

function phoneGame(settings, n) {
  const e = game(Object.assign({ input: 'phones' }, settings), { players: [] });
  const phones = [];
  for (let i = 0; i < (n || 3); i++) {
    e.connect('ph' + i, NAMES[i]);
    phones.push('ph' + i);
  }
  return { e, phones };
}

test('Lobby: Handys treten bei, Start erst ab 3 Personen', () => {
  const e = game({ input: 'phones' }, { players: [] });
  assert.strictEqual(e.s.phase, 'lobby');
  e.connect('a', 'Anna');
  e.connect('b', 'Ben');
  assert.ok(!act(e, 'open'));
  e.connect('c', 'Cem');
  assert.ok(act(e, 'open'));
  assert.strictEqual(e.s.phase, 'pick');
});

test('Gefilterte Ansicht: Karte und Ziel nur für den Hinweisgeber', () => {
  const { e, phones } = phoneGame();
  act(e, 'open');
  const giverPhone = phones[0];
  assert.ok(e.viewFor(giverPhone).secret.card.length === 4);
  assert.strictEqual(e.viewFor(phones[1]).secret, null);
  assert.strictEqual(e.viewFor(STAGE).secret, null, 'Bühne kennt das Ziel nicht');
  assert.ok(!act(e, 'pick', { index: 0 }), 'Laptop darf nicht für ein verbundenes Handy wählen');
  assert.ok(!act(e, 'pick', { index: 0 }, phones[1]));
  assert.ok(act(e, 'pick', { index: 0 }, giverPhone));
  assert.ok(e.viewFor(giverPhone).secret.target);
  assert.strictEqual(JSON.stringify(e.viewFor(phones[1])).includes('"target"'), false);
  assert.strictEqual(JSON.stringify(e.viewFor(STAGE)).includes('"target"'), false);
  assert.ok(!act(e, 'cue', { text: '' }, giverPhone), 'Handy muss tippen');
  assert.ok(act(e, 'cue', { text: 'Avocado' }, giverPhone));
  assert.ok(!act(e, 'place', { cell: { r: 1, c: 1 } }, phones[2]), 'nicht dran');
  assert.ok(act(e, 'place', { cell: { r: 1, c: 1 } }, phones[1]));
  // Nach dem Aufdecken sehen alle das Ziel
  act(e, 'place', { cell: { r: 1, c: 2 } }, phones[2]);
  act(e, 'skipCue', {}, giverPhone);
  assert.ok(e.viewFor(phones[1]).result.target);
});

test('Offline-Handy: Laptop übernimmt (Karte zeigen, setzen)', () => {
  const { e, phones } = phoneGame();
  act(e, 'open');
  e.disconnect(phones[0]);
  assert.ok(e.viewFor(STAGE).secret, 'Laptop spielt jetzt für den Hinweisgeber');
  assert.ok(act(e, 'pick', { index: 1 }));
  e.connect(phones[0], NAMES[0]);
  assert.strictEqual(e.viewFor(STAGE).secret, null);
});

test('Spielleitung: erstes verbundenes Handy darf weiterschalten', () => {
  const { e, phones } = phoneGame();
  act(e, 'open');
  act(e, 'pick', { index: 0 }, phones[0]);
  act(e, 'cue', { text: 'Avocado' }, phones[0]);
  act(e, 'place', { cell: { r: 1, c: 1 } }, phones[1]);
  act(e, 'place', { cell: { r: 1, c: 2 } }, phones[2]);
  act(e, 'skipCue', {}, phones[0]);
  assert.ok(e.viewFor(phones[0]).me.leader);
  assert.ok(!act(e, 'next', { at: e.s.step }, phones[1]));
  assert.ok(act(e, 'next', { at: e.s.step }, phones[0]));
});

test('Gleichzeitig: mehrere Steine pro Feld, fremde erst nach der Runde sichtbar', () => {
  const { e, phones } = phoneGame({ order: 'simultaneous' }, 4);
  act(e, 'open');
  act(e, 'pick', { index: 0 }, phones[0]);
  act(e, 'cue', { text: 'Avocado' }, phones[0]);
  const cell = { r: 4, c: 4 };
  assert.ok(act(e, 'place', { cell }, phones[2]));
  assert.ok(act(e, 'place', { cell }, phones[1]));
  assert.ok(!act(e, 'place', { cell }, phones[1]), 'nur ein Stein pro Runde');
  assert.strictEqual(e.viewFor(phones[1]).stones.length, 1, 'nur der eigene');
  assert.strictEqual(e.viewFor(STAGE).stones.length, 0);
  assert.ok(act(e, 'place', { cell }, phones[3]));
  assert.strictEqual(e.s.phase, 'cue');
  assert.strictEqual(e.viewFor(STAGE).stones.length, 3);
});

test('Gleichzeitig gibt es nur mit Handys', () => {
  assert.strictEqual(sanitizeSettings({ input: 'single', order: 'simultaneous' }).order, 'turns');
});

test('Teams: Handys landen im kleinsten Team, Team setzt gemeinsam', () => {
  const e = game({ input: 'phones', teams: 2 }, { players: [] });
  assert.strictEqual(e.s.players.length, 2);
  e.connect('a', 'Anna');
  e.connect('b', 'Ben');
  e.connect('c', 'Cem');
  const [t1, t2] = e.s.players;
  assert.strictEqual(e.phonesOf(t1).length, 2);
  assert.strictEqual(e.phonesOf(t2).length, 1);
  assert.ok(act(e, 'team', { team: t2.id }, 'c'));
  assert.ok(act(e, 'open'));
  // Team 1 gibt den Hinweis: beide Handys sehen die Karte
  assert.ok(e.viewFor('a').secret);
  assert.strictEqual(e.viewFor('b').secret, null, 'b ist jetzt in Team 2');
  act(e, 'pick', { index: 0 }, 'a');
  act(e, 'cue', { text: 'Avocado' }, 'a');
  assert.ok(act(e, 'place', { cell: { r: 2, c: 2 } }, 'c'));
  assert.strictEqual(e.s.phase, 'cue');
});

test('Farbe wählen tauscht mit der Person, die sie hatte', () => {
  const e = game({});
  const [a, b] = e.s.players;
  const old = a.color;
  assert.ok(act(e, 'color', { player: a.id, color: b.color }));
  assert.strictEqual(b.color, old);
});

test('Trinkregeln: daneben → trinken, Volltreffer → verteilen', () => {
  const e = game({ drinks: true, secondCue: false }, { n: 3 });
  act(e, 'pick', { index: 0 });
  act(e, 'cue', { text: 'Avocado' });
  const t = e.s.target;
  act(e, 'place', { cell: t });
  act(e, 'place', { cell: { r: t.r > 7 ? 0 : 15, c: t.c > 14 ? 0 : 29 } });
  const lines = e.s.result.lines;
  assert.strictEqual(lines[0].give, 2);
  assert.strictEqual(lines[1].drink, 1);
});

test('Hinweisgeber entfernt → Zug beginnt neu', () => {
  const e = game({}, { n: 4 });
  act(e, 'pick', { index: 0 });
  const giver = e.s.giver;
  assert.ok(act(e, 'removePlayer', { player: giver }));
  assert.strictEqual(e.s.phase, 'pick');
  assert.notStrictEqual(e.s.giver, giver);
  assert.strictEqual(e.s.target, null);
});

console.log(`\n${passed} Tests bestanden.`);
