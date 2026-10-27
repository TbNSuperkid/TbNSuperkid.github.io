'use strict';
/* Tests für „Skribbl“ (ohne Browser): node tests/skribbl.test.js */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'shared', 'match.js'));
require(path.join(ROOT, 'shared', 'fill.js'));
require(path.join(ROOT, 'guess-the-word', 'js', 'words', 'zeichnen.js'));
for (const f of ['tiere', 'essen', 'berufe', 'filme', 'dinge', 'orte', 'aktionen']) require(path.join(ROOT, 'skribbl', 'js', 'woerter', f + '.js'));
for (const f of ['words', 'hints', 'engine']) require(path.join(ROOT, 'skribbl', 'js', f + '.js'));
const Words = globalThis.SkWords;
const Hints = globalThis.SkHints;
const Fill = globalThis.GameFill;
const { Engine, STAGE, GRACE_MS, CHOOSE_MS, REVEAL_MS, FIRST_BONUS, guessPoints, drawerPoints, cleanOp, sanitizeSettings } = globalThis.SkEngine;

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

/* ---------- Hilfen ---------- */

function clock(start) {
  let t = start || 1_000_000;
  const now = () => t;
  now.add = (ms) => (t += ms);
  return now;
}

/** Zufall, der immer dasselbe liefert (0 = erstes Element) */
const first = () => 0;

/** Spiel: Lobby, Spieler verbinden, starten. Zeichnende Person wählt das erste Wort, dann wird es auf `word` gesetzt. */
function game(settings, pids, now, word) {
  const state = Engine.create({ settings: Object.assign({ time: 80, hints: 2 }, settings) });
  const e = new Engine(state, { timers: false, now: now || clock(), random: first });
  for (const pid of pids) e.connect(pid, pid.toUpperCase());
  assert.ok(e.apply({ type: 'start' }, STAGE), 'start');
  if (e.s.phase === 'choose') assert.ok(e.apply({ type: 'choose', i: 0 }, e.s.cur.drawer), 'choose');
  if (word) setWord(e, word);
  return e;
}

function setWord(e, word) {
  e.s.cur.word = { word, key: Words.key(word), level: 1, pack: 'test' };
  e.s.cur.hintPos = Hints.pick(word, Hints.count(word, e.s.settings.hints), first);
  e.s.cur.hintAt = Hints.times(e.s.cur.total, e.s.cur.hintPos.length).map((t) => e.s.cur.startedAt + t);
}

function guess(e, pid, text, now) {
  if (now) now.add(400); // Mindestabstand zwischen Tipps
  return e.apply({ type: 'guess', text }, pid);
}

/* ---------- Tipps prüfen ---------- */

console.log('Tipps prüfen');

test('richtig: gleich, Groß/klein, Artikel, Plural, Umlaut-Plural', () => {
  assert.strictEqual(Words.check('giraffe', 'Giraffe'), 'right');
  assert.strictEqual(Words.check('  GIRAFFE ', 'Giraffe'), 'right');
  assert.strictEqual(Words.check('die Giraffe', 'Giraffe'), 'right');
  assert.strictEqual(Words.check('Giraffen', 'Giraffe'), 'right');
  assert.strictEqual(Words.check('die Kühe', 'Kuh'), 'right');
  assert.strictEqual(Words.check('Haeuser', 'Häuser'), 'right');
  assert.strictEqual(Words.check('Schildkroete', 'Schildkröte'), 'right');
});

test('Mehrwort-Begriffe: Leerzeichen und Artikel egal', () => {
  assert.strictEqual(Words.check('Mann im Mond', 'Mann im Mond'), 'right');
  assert.strictEqual(Words.check('mannimmond', 'Mann im Mond'), 'right');
  assert.strictEqual(Words.check('König der Löwen', 'Der König der Löwen'), 'right');
  assert.strictEqual(Words.check('spiderman', 'Spider-Man'), 'right');
});

test('ein Tippfehler → knapp, bei langen Wörtern auch zwei', () => {
  assert.strictEqual(Words.check('Girafe', 'Giraffe'), 'close');
  assert.strictEqual(Words.check('Grafife', 'Giraffe'), 'wrong');
  assert.strictEqual(Words.check('Leuchtrum', 'Leuchtturm'), 'close');
  assert.strictEqual(Words.check('Leuchtrm', 'Leuchtturm'), 'close');
  assert.strictEqual(Words.check('Mau', 'Maus'), 'close');
});

test('falsch: anderes Wort, kurze Wörter ohne Tippfehler-Bonus', () => {
  assert.strictEqual(Words.check('Pferd', 'Giraffe'), 'wrong');
  assert.strictEqual(Words.check('Eis', 'Ei'), 'wrong');
  assert.strictEqual(Words.check('', 'Ei'), 'wrong');
  assert.strictEqual(Words.check('Hund', 'Mund'), 'close');
  assert.strictEqual(Words.check('Katze', 'Kerze'), 'wrong');
});

/* ---------- Begriffe ---------- */

console.log('Begriffe');

test('Standardliste ohne lange Sprichwörter, Pakete mit Stufen 1–3', () => {
  const std = Words.entries('standard');
  assert.ok(std.length > 250, 'Standard: ' + std.length);
  assert.ok(!std.some((e) => e.word.includes(',') || e.word.split(/\s+/).length > 3), 'keine Sprichwörter');
  assert.ok(std.some((e) => e.word === 'Schmetterlinge im Bauch'));
  for (const p of Words.packs()) {
    assert.ok(p.count >= 90, `${p.id}: ${p.count}`);
    for (const lv of [1, 2, 3]) assert.ok(Words.entries(p.id).some((e) => e.level === lv), `${p.id} Stufe ${lv}`);
  }
});

test('3 Begriffe zur Auswahl: leicht, mittel, schwer, alle verschieden, nicht schon gespielt', () => {
  const used = [];
  for (let i = 0; i < 30; i++) {
    const o = Words.options({ packs: ['tiere'] }, used);
    assert.deepStrictEqual(o.map((x) => x.level), [1, 2, 3]);
    assert.strictEqual(new Set(o.map((x) => x.key)).size, 3);
    for (const x of o) assert.ok(!used.includes(x.key));
    used.push(o[1].key);
  }
});

test('eigene Wörter: nur eigene oder gemischt, Doppelte raus', () => {
  const custom = Words.parseCustom('Omas Dackel, Partykeller\nomas dackel\n\n Grillparty ');
  assert.deepStrictEqual(custom, ['Omas Dackel', 'Partykeller', 'Grillparty']);
  const only = Words.options({ packs: ['standard'], custom, customOnly: true }, []);
  assert.strictEqual(only.length, 3);
  assert.ok(only.every((x) => custom.includes(x.word)));
  const mixed = Words.pool({ packs: ['tiere'], custom, customOnly: false });
  assert.ok(mixed.some((x) => x.word === 'Partykeller') && mixed.some((x) => x.word === 'Hund'));
});

/* ---------- Hinweise ---------- */

console.log('Hinweise');

test('Anzahl: 0/1/2, kurze Wörter höchstens einer', () => {
  assert.strictEqual(Hints.count('Giraffe', 2), 2);
  assert.strictEqual(Hints.count('Giraffe', 1), 1);
  assert.strictEqual(Hints.count('Giraffe', 0), 0);
  assert.strictEqual(Hints.count('Maus', 2), 1);
  assert.strictEqual(Hints.count('Ei', 2), 1);
});

test('Zeitpunkte nach 50 % und 75 %', () => {
  assert.deepStrictEqual(Hints.times(80000, 2), [40000, 60000]);
  assert.deepStrictEqual(Hints.times(80000, 1), [40000]);
});

test('Lücken: Leerzeichen und Bindestriche bleiben sichtbar, nie zwei Hinweise nebeneinander', () => {
  assert.strictEqual(Hints.mask('Mann im Mond', []), '____ __ ____');
  assert.strictEqual(Hints.mask('T-Shirt', []), '_-_____');
  assert.deepStrictEqual(Hints.lengths('Mann im Mond'), [4, 2, 4]);
  assert.strictEqual(Hints.mask('Giraffe', [4]), '____f__');
  for (let i = 0; i < 50; i++) {
    const [a, b] = Hints.pick('Giraffe', 2);
    assert.ok(Math.abs(a - b) > 1, `${a} ${b}`);
  }
  assert.ok(!Hints.pick('Mann im Mond', 2, first).some((i) => 'Mann im Mond'[i] === ' '));
});

test('Hinweise erscheinen im Spiel zur richtigen Zeit', () => {
  const now = clock();
  const e = game({}, ['a', 'b', 'c'], now, 'Giraffe');
  assert.strictEqual(e.viewFor(STAGE).cur.mask, '_______');
  now.add(40000);
  assert.ok(e.tick());
  assert.strictEqual(e.viewFor(STAGE).cur.mask.replace(/_/g, '').length, 1);
  now.add(20000);
  assert.ok(e.tick());
  assert.strictEqual(e.viewFor(STAGE).cur.mask.replace(/_/g, '').length, 2);
});

/* ---------- Punkte ---------- */

console.log('Punkte');

test('Tempo-Formel und Erste/r-Bonus', () => {
  assert.strictEqual(guessPoints(80000, 80000, false), 150);
  assert.strictEqual(guessPoints(40000, 80000, false), 100);
  assert.strictEqual(guessPoints(0, 80000, false), 50);
  assert.strictEqual(guessPoints(40000, 80000, true), 100 + FIRST_BONUS);
});

test('zeichnende Person: Durchschnitt × Anteil der Treffer, niemand → 0', () => {
  assert.strictEqual(drawerPoints([150, 100], 2), 125);
  assert.strictEqual(drawerPoints([150, 100], 4), 63);
  assert.strictEqual(drawerPoints([], 3), 0);
});

test('im Spiel: schneller = mehr, alle haben es → Zug endet, Punkte für die zeichnende Person', () => {
  const now = clock();
  const e = game({}, ['a', 'b', 'c'], now, 'Giraffe');
  assert.strictEqual(e.s.cur.drawer, 'a');
  now.add(20000);
  assert.ok(guess(e, 'b', 'Giraffe'));
  now.add(20000);
  assert.ok(guess(e, 'c', 'giraffen'));
  assert.strictEqual(e.s.phase, 'reveal');
  const [b, c] = e.s.cur.hits;
  assert.strictEqual(b.pts, Math.round((60 / 80) * 100 + 50) + FIRST_BONUS);
  assert.strictEqual(c.pts, Math.round((40 / 80) * 100 + 50));
  assert.strictEqual(e.player('a').score, Math.round((b.pts + c.pts) / 2));
  assert.strictEqual(e.s.cur.result.reason, 'all');
});

test('Zeit um, niemand hat es → zeichnende Person 0', () => {
  const now = clock();
  const e = game({}, ['a', 'b', 'c'], now, 'Giraffe');
  guess(e, 'b', 'Pferd', now);
  now.add(80000);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(e.s.cur.result.reason, 'time');
  assert.strictEqual(e.player('a').score, 0);
});

test('zeichnende Person kann nicht raten, Treffer zählen nur einmal', () => {
  const now = clock();
  const e = game({}, ['a', 'b', 'c', 'd'], now, 'Giraffe');
  assert.ok(!guess(e, 'a', 'Giraffe', now));
  assert.ok(guess(e, 'b', 'Giraffe', now));
  const score = e.player('b').score;
  assert.ok(guess(e, 'b', 'Giraffe', now)); // nur noch Chat
  assert.strictEqual(e.player('b').score, score);
  assert.strictEqual(e.s.cur.hits.length, 1);
  assert.strictEqual(e.s.cur.chat.pop().kind, 'insider');
});

/* ---------- Ablauf ---------- */

console.log('Ablauf');

test('Wortwahl: 3 Begriffe, nach 10 s entscheidet der Zufall', () => {
  const now = clock();
  const state = Engine.create({ settings: {} });
  const e = new Engine(state, { timers: false, now, random: first });
  for (const pid of ['a', 'b', 'c']) e.connect(pid, pid);
  e.apply({ type: 'start' }, STAGE);
  assert.strictEqual(e.s.phase, 'choose');
  assert.strictEqual(e.viewFor('a').cur.options.length, 3);
  assert.strictEqual(e.viewFor('b').cur.options, null, 'nur die zeichnende Person sieht die Auswahl');
  assert.ok(!e.apply({ type: 'choose', i: 0 }, 'b'));
  now.add(CHOOSE_MS);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'draw');
  assert.ok(e.s.cur.word.word);
});

test('Wortwahl „zufällig“ startet direkt mit dem Zeichnen', () => {
  const e = game({ choice: 'random' }, ['a', 'b', 'c']);
  assert.strictEqual(e.s.phase, 'draw');
});

test('reihum: jede/r zeichnet einmal pro Runde, dann Spielende', () => {
  const now = clock();
  const e = game({ rounds: 2, choice: 'random' }, ['a', 'b', 'c'], now);
  const drawers = [];
  while (e.s.phase !== 'over') {
    drawers.push(e.s.cur.drawer + e.s.cur.round);
    now.add(80000);
    e.tick(); // Zeit um → Auflösung
    now.add(REVEAL_MS);
    e.tick(); // nächster Zug
  }
  assert.deepStrictEqual(drawers, ['a1', 'b1', 'c1', 'a2', 'b2', 'c2']);
});

test('Abgemeldete werden übersprungen, wer dazukommt, rät sofort mit', () => {
  const now = clock();
  const e = game({ choice: 'random' }, ['a', 'b', 'c'], now);
  e.disconnect('b');
  now.add(GRACE_MS + 1);
  e.connect('d', 'Dora');
  assert.ok(e.s.cur.guessers.includes('d'));
  assert.ok(guess(e, 'd', e.s.cur.word.word, now));
  now.add(80000);
  e.tick();
  now.add(REVEAL_MS);
  e.tick();
  assert.strictEqual(e.s.cur.drawer, 'c', 'b ist weg und wird übersprungen');
});

test('zeichnende Person weg → Zug endet ohne Punkte für sie', () => {
  const now = clock();
  const e = game({ choice: 'random' }, ['a', 'b', 'c'], now);
  e.disconnect('a');
  now.add(GRACE_MS + 1);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(e.s.cur.result.reason, 'left');
});

test('kurz getrennt (Laptop neu geladen) zählt noch als da', () => {
  const now = clock();
  const e = game({ choice: 'random' }, ['a', 'b', 'c'], now);
  e.setAllOffline();
  assert.strictEqual(e.tick(), false);
  assert.strictEqual(e.s.phase, 'draw');
  for (const pid of ['a', 'b', 'c']) e.connect(pid);
  assert.ok(e.canDraw('a'));
});

test('nur die zeichnende Person darf zeichnen – mit „Zeichnen am Laptop“ nur der Laptop', () => {
  const e = game({ choice: 'random' }, ['a', 'b', 'c']);
  assert.ok(e.canDraw('a'));
  assert.ok(!e.canDraw('b'));
  assert.ok(!e.canDraw(STAGE));
  const l = game({ choice: 'random', drawOn: 'laptop' }, ['a', 'b', 'c']);
  assert.ok(l.canDraw(STAGE));
  assert.ok(!l.canDraw('a'));
});

/* ---------- Melden ---------- */

console.log('Melden');

test('Mehrheit der Ratenden bricht ab, zeichnende Person bekommt 0', () => {
  const now = clock();
  const e = game({}, ['a', 'b', 'c', 'd', 'e'], now, 'Giraffe');
  assert.ok(guess(e, 'b', 'Giraffe', now));
  assert.ok(e.apply({ type: 'report' }, 'c'));
  assert.ok(e.apply({ type: 'report' }, 'd'));
  assert.strictEqual(e.s.phase, 'draw', '2 von 4 sind keine Mehrheit');
  assert.ok(!e.apply({ type: 'report' }, 'b'), 'wer es hat, meldet nicht');
  assert.ok(!e.apply({ type: 'report' }, 'a'), 'die zeichnende Person meldet nicht');
  assert.ok(e.apply({ type: 'report' }, 'e'));
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(e.s.cur.result.reason, 'reported');
  assert.strictEqual(e.player('a').score, 0);
  assert.ok(e.player('b').score > 0, 'Ratende behalten ihre Punkte');
});

test('Melden lässt sich zurücknehmen', () => {
  const e = game({}, ['a', 'b', 'c', 'd'], clock(), 'Giraffe');
  e.apply({ type: 'report' }, 'b');
  e.apply({ type: 'report' }, 'b');
  assert.strictEqual(e.s.cur.reports.length, 0);
});

/* ---------- Gefilterte Ansicht ---------- */

console.log('Gefilterte Ansicht');

test('Wort nur für zeichnende Person und alle, die es haben – die Bühne erst bei der Auflösung', () => {
  const now = clock();
  const e = game({}, ['a', 'b', 'c', 'd'], now, 'Giraffe');
  assert.strictEqual(e.viewFor('a').cur.word, 'Giraffe');
  assert.strictEqual(e.viewFor('b').cur.word, null);
  assert.strictEqual(e.viewFor(STAGE).cur.word, null);
  assert.ok(!JSON.stringify(e.viewFor('b')).includes('Giraffe'));
  assert.ok(!JSON.stringify(e.viewFor(STAGE)).includes('Giraffe'));
  guess(e, 'b', 'Giraffe', now);
  assert.strictEqual(e.viewFor('b').cur.word, 'Giraffe');
  assert.strictEqual(e.viewFor('c').cur.word, null);
  assert.ok(!JSON.stringify(e.viewFor('c')).includes('Giraffe'));
  now.add(80000);
  e.tick();
  assert.strictEqual(e.viewFor(STAGE).cur.word, 'Giraffe');
});

test('Chat: falsche Tipps für alle, „knapp“ nur für sich, Insider nur für die Richtigen', () => {
  const now = clock();
  const e = game({}, ['a', 'b', 'c', 'd'], now, 'Giraffe');
  guess(e, 'c', 'Pferd', now);
  guess(e, 'c', 'Girafe', now);
  guess(e, 'b', 'Giraffe', now);
  guess(e, 'b', 'lang und gefleckt', now);
  const kinds = (pid) => e.viewFor(pid).cur.chat.map((x) => x.kind + ':' + x.text);
  assert.deepStrictEqual(kinds('d'), ['guess:Pferd', 'hit:']);
  assert.deepStrictEqual(kinds('c'), ['guess:Pferd', 'close:Girafe', 'hit:']);
  assert.deepStrictEqual(kinds('b'), ['guess:Pferd', 'hit:', 'insider:lang und gefleckt']);
  assert.deepStrictEqual(kinds('a'), ['guess:Pferd', 'hit:', 'insider:lang und gefleckt']);
  assert.deepStrictEqual(kinds(STAGE), ['guess:Pferd', 'hit:']);
  assert.ok(!JSON.stringify(e.viewFor('d')).includes('Giraffe'));
});

test('Chat aus: die Bühne zeigt nur Treffer', () => {
  const now = clock();
  const e = game({ chat: false }, ['a', 'b', 'c'], now, 'Giraffe');
  guess(e, 'c', 'Pferd', now);
  guess(e, 'b', 'Giraffe', now);
  assert.deepStrictEqual(e.viewFor(STAGE).cur.chat.map((x) => x.kind), ['hit']);
  assert.deepStrictEqual(e.viewFor('a').cur.chat.map((x) => x.kind), ['guess', 'hit']);
});

test('eigene Wörter stehen nicht in den Ansichten der Handys', () => {
  const state = Engine.create({ settings: { custom: ['Omas Dackel', 'Partykeller', 'Grillparty'] } });
  const e = new Engine(state, { timers: false });
  e.connect('a', 'A');
  assert.deepStrictEqual(e.viewFor('a').settings.custom, []);
  assert.strictEqual(e.viewFor('a').settings.customCount, 3);
  assert.strictEqual(e.viewFor(STAGE).settings.custom.length, 3);
});

/* ---------- Lobby, Einstellungen, Ende ---------- */

console.log('Lobby & Ende');

test('Start erst ab 3 Personen und mit Begriffen', () => {
  const e = new Engine(Engine.create({ settings: {} }), { timers: false });
  e.connect('a', 'A');
  e.connect('b', 'B');
  assert.ok(!e.apply({ type: 'start' }, STAGE));
  e.connect('c', 'C');
  e.apply({ type: 'settings', settings: { packs: [] } }, STAGE);
  assert.ok(e.lobbyProblem());
  e.apply({ type: 'settings', settings: { packs: ['tiere'], customOnly: true } }, STAGE);
  assert.ok(e.lobbyProblem(), 'nur eigene, aber keine eigenen Wörter');
  e.apply({ type: 'settings', settings: { customOnly: false } }, STAGE);
  assert.ok(e.apply({ type: 'start' }, STAGE));
});

test('Einstellungen werden geprüft', () => {
  const s = sanitizeSettings({ rounds: 9, time: '100', hints: 1, packs: ['tiere', 'quatsch'], drawOn: 'laptop', drinks: 'free', chat: false });
  assert.strictEqual(s.rounds, 2);
  assert.strictEqual(s.time, 100);
  assert.strictEqual(s.hints, 1);
  assert.deepStrictEqual(s.packs, ['tiere']);
  assert.strictEqual(s.drawOn, 'laptop');
  assert.strictEqual(s.drinks, 'free');
  assert.strictEqual(s.chat, false);
});

test('Trinkregeln: niemand → zeichnende Person 2, Letzte/r → 1', () => {
  const now = clock();
  const e = game({ drinks: 'on' }, ['a', 'b', 'c'], now, 'Giraffe');
  now.add(80000);
  e.tick();
  assert.deepStrictEqual(e.s.cur.result.drinks, [{ pid: 'a', n: 2, why: 'none' }]);
  now.add(REVEAL_MS);
  e.tick();
  if (e.s.phase === 'choose') e.apply({ type: 'choose', i: 0 }, e.s.cur.drawer);
  setWord(e, 'Kaktus');
  guess(e, 'a', 'Kaktus', now);
  guess(e, 'c', 'Kaktus', now);
  assert.deepStrictEqual(e.s.cur.result.drinks, [{ pid: 'c', n: 1, why: 'last' }]);
});

test('Auszeichnungen am Ende: Picasso, Adlerauge, Rätselhaft', () => {
  const now = clock();
  const e = game({ rounds: 1 }, ['a', 'b', 'c'], now, 'Giraffe');
  now.add(5000);
  guess(e, 'b', 'Giraffe');
  now.add(5000);
  guess(e, 'c', 'Giraffe');
  now.add(REVEAL_MS);
  e.tick();
  e.apply({ type: 'choose', i: 0 }, e.s.cur.drawer);
  setWord(e, 'Kaktus');
  now.add(80000);
  e.tick();
  assert.ok(e.apply({ type: 'end' }, STAGE));
  const titles = e.s.awards.map((x) => x.title);
  assert.ok(titles.includes('Picasso'));
  assert.ok(titles.includes('Adlerauge'));
  const riddle = e.s.awards.find((x) => x.title === 'Rätselhaft');
  assert.ok(riddle && riddle.no === 2 && riddle.text.includes('Kaktus'));
});

test('Nochmal: zurück in die Lobby, Punkte auf 0', () => {
  const e = game({ rounds: 1, choice: 'random' }, ['a', 'b', 'c'], clock());
  e.apply({ type: 'end' }, STAGE);
  assert.ok(e.apply({ type: 'again' }, STAGE));
  assert.strictEqual(e.s.phase, 'lobby');
  assert.ok(e.s.players.every((p) => p.score === 0));
});

/* ---------- Zeichnen ---------- */

console.log('Zeichnen');

test('Zeichen-Nachrichten vom Handy werden geprüft', () => {
  assert.deepStrictEqual(cleanOp({ k: 'b', id: 'x1', c: '#ff0000', w: 0.01, x: 0.5, y: 2 }), { k: 'b', id: 'x1', c: '#ff0000', w: 0.01, x: 0.5, y: 1 });
  assert.strictEqual(cleanOp({ k: 'b', id: 'x1', c: 'red', w: 0.01, x: 0, y: 0 }), null);
  assert.strictEqual(cleanOp({ k: 'b', id: 'x1', c: '#ff0000"><script>', w: 0.01, x: 0, y: 0 }), null);
  assert.deepStrictEqual(cleanOp({ k: 'p', id: 'x1', pts: [0.1, 0.2] }), { k: 'p', id: 'x1', pts: [0.1, 0.2] });
  assert.strictEqual(cleanOp({ k: 'p', id: 'x1', pts: [0.1] }), null);
  assert.strictEqual(cleanOp({ k: 'p', id: 'x1', pts: ['a', 0.1] }), null);
  assert.deepStrictEqual(cleanOp({ k: 'f', id: 'f1', c: '#00ff00', x: 0.3, y: 0.3 }), { k: 'f', id: 'f1', c: '#00ff00', x: 0.3, y: 0.3 });
  assert.deepStrictEqual(cleanOp({ k: 'clear', evil: 1 }), { k: 'clear' });
  assert.strictEqual(cleanOp({ k: 'boom' }), null);
});

test('Farbeimer füllt die umrandete Fläche und nicht darüber hinaus', () => {
  const w = 10;
  const h = 10;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  // schwarzer Rahmen von (2,2) bis (7,7)
  for (let i = 2; i <= 7; i++) {
    for (const [x, y] of [[i, 2], [i, 7], [2, i], [7, i]]) {
      const p = (y * w + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = 0;
    }
  }
  const n = Fill.flood(data, w, h, 4, 4, '#ff0000');
  assert.ok(n > 0);
  const px = (x, y) => Array.from(data.slice((y * w + x) * 4, (y * w + x) * 4 + 3));
  assert.deepStrictEqual(px(4, 4), [255, 0, 0], 'innen rot');
  assert.deepStrictEqual(px(0, 0), [255, 255, 255], 'außen bleibt weiß');
  assert.deepStrictEqual(px(9, 9), [255, 255, 255]);
  assert.strictEqual(Fill.flood(data, w, h, 4, 4, '#ff0000'), 0, 'gleiche Farbe: nichts zu tun');
});

console.log(`\n${passed} Tests bestanden.`);
