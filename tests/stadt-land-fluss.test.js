'use strict';
/* Tests für „Stadt, Land, Fluss“ (ohne Browser): node tests/stadt-land-fluss.test.js */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'shared', 'match.js'));
for (const f of ['staedte', 'laender', 'fluesse', 'tiere', 'namen']) require(path.join(ROOT, 'stadt-land-fluss', 'js', 'listen', f + '.js'));
for (const f of ['kategorien', 'answers', 'engine']) require(path.join(ROOT, 'stadt-land-fluss', 'js', f + '.js'));
const A = globalThis.SLFAnswers;
const K = globalThis.SLFKategorien;
const { Engine, STAGE, GRACE_STOP_MS, GRACE_TIME_MS, PER_ROUND, sanitizeSettings, letterPool } = globalThis.SLFEngine;

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

/** Zufall mit festem Startwert */
function seeded(seed) {
  let x = seed || 42;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

/** Spiel mit Handys: Lobby, Spieler verbinden, starten, Buchstabe festlegen */
function phoneGame(settings, pids, opts) {
  const o = opts || {};
  const now = o.now || clock();
  const state = Engine.create({ settings: Object.assign({ input: 'phones' }, settings) });
  const e = new Engine(state, { timers: false, now, random: o.random || seeded(7) });
  for (const pid of pids) e.connect(pid, pid.toUpperCase());
  assert.ok(e.apply({ type: 'start' }, STAGE), 'start');
  if (o.letter) setLetter(e, o.letter);
  e.clock = now;
  return e;
}

function setLetter(e, letter) {
  e.s.used = e.s.used.filter((l) => l !== e.s.letter).concat(letter);
  e.s.letter = letter;
}

/** Antworten schreiben: pid -> [Texte] */
function write(e, answers) {
  for (const [pid, texts] of Object.entries(answers)) assert.ok(e.apply({ type: 'answers', texts, round: e.s.round }, pid), 'answers ' + pid);
}

/** Schreiben beenden (Stopp durch den Laptop + Nachspielzeit) */
function endWriting(e) {
  assert.ok(e.apply({ type: 'stop' }, STAGE));
  e.clock.add(GRACE_STOP_MS + 1);
  assert.ok(e.tick());
}

/** Alle Kategorien der Runde durchklicken */
function finishReview(e) {
  while (e.s.phase === 'review') assert.ok(e.apply({ type: 'next' }, STAGE));
}

function item(e, text) {
  const r = e.s.review;
  return r.items[r.cat].find((it) => it.variants.includes(text));
}

function lastRow(e, pid) {
  return e.s.history[e.s.history.length - 1].rows[pid];
}

/* ---------- Anfangsbuchstabe ---------- */

console.log('Anfangsbuchstabe');

test('Umlaute zählen für den Grundbuchstaben (abschaltbar)', () => {
  assert.ok(A.startsWith('Ölberg', 'O'));
  assert.ok(A.startsWith('Ägypten', 'A'));
  assert.ok(A.startsWith('Überlingen', 'U'));
  assert.ok(!A.startsWith('Ölberg', 'O', { umlauts: false }));
  assert.ok(A.startsWith('Oslo', 'O', { umlauts: false }));
});

test('Akzente egal, Groß/klein egal, Leerzeichen und Anführungszeichen am Anfang egal', () => {
  assert.ok(A.startsWith('Évian', 'E'));
  assert.ok(A.startsWith('  münchen', 'M'));
  assert.ok(A.startsWith('„Mainz“', 'M'));
  assert.ok(!A.startsWith('Berlin', 'M'));
  assert.ok(!A.startsWith('', 'M'));
});

test('Artikel davor: „Die Mosel“ zählt bei M (und bei D wie „Den Haag“)', () => {
  assert.ok(A.startsWith('Die Mosel', 'M'));
  assert.ok(A.startsWith('die Mosel', 'D'));
  assert.ok(A.startsWith('Den Haag', 'D'));
  assert.ok(A.startsWith('Der Spiegel', 'S'));
  assert.ok(!A.startsWith('Diemosel', 'M'));
});

test('„St. Petersburg“ und „Sankt Petersburg“ zählen bei S', () => {
  assert.ok(A.startsWith('St. Petersburg', 'S'));
  assert.ok(A.startsWith('Sankt Petersburg', 'S'));
  assert.ok(!A.startsWith('St. Petersburg', 'P'));
});

/* ---------- Gruppieren ---------- */

console.log('Gleiche Antworten');

test('Groß/klein, Tippfehler und Artikel werden zusammengefasst', () => {
  assert.deepStrictEqual(A.group(['Bremen', 'bremen', 'Berlin']), [[0, 1], [2]]);
  assert.deepStrictEqual(A.group(['Mosel', 'Die Mosel', 'Main']), [[0, 1], [2]]);
  assert.deepStrictEqual(A.group(['Mannheim', 'Manheim', 'München', 'Muenchen']), [[0, 1], [2, 3]]);
});

test('„St.“ = „Sankt“, leere Antworten kommen in keine Gruppe', () => {
  assert.deepStrictEqual(A.group(['St. Petersburg', 'Sankt Petersburg', 'St Petersburg', '']), [[0, 1, 2]]);
});

test('verschiedene Antworten bleiben getrennt', () => {
  assert.deepStrictEqual(A.group(['Madrid', 'Mainz', 'München']), [[0], [1], [2]]);
});

/* ---------- Hilfslisten ---------- */

console.log('Hilfslisten');

test('✓ bekannt: Städte, Länder, Flüsse, Tiere, Namen – auch mit Tippfehler, nie ausgedachtes', () => {
  assert.ok(A.known('staedte', 'München'));
  assert.ok(A.known('staedte', 'muenchen'));
  assert.ok(A.known('staedte', 'Münchn'), 'Tippfehler ab 6 Buchstaben');
  assert.ok(A.known('staedte', 'St. Gallen'));
  assert.ok(!A.known('staedte', 'Mordor'));
  assert.ok(A.known('laender', 'Mexiko'));
  assert.ok(A.known('laender', 'Österreich'));
  assert.ok(A.known('fluesse', 'Die Mosel'));
  assert.ok(A.known('tiere', 'Maulwurf'));
  assert.ok(A.known('namen', 'Lisa'));
  assert.ok(!A.known(null, 'München'));
});

test('Listen sind groß genug und jeder Buchstabe (ohne Q, X, Y) hat Städte, Länder und Tiere', () => {
  assert.ok(A.listSize('staedte') >= 350, 'Städte ' + A.listSize('staedte'));
  assert.ok(A.listSize('laender') >= 190, 'Länder ' + A.listSize('laender'));
  assert.ok(A.listSize('fluesse') >= 150, 'Flüsse ' + A.listSize('fluesse'));
  assert.ok(A.listSize('tiere') >= 250, 'Tiere ' + A.listSize('tiere'));
  assert.ok(A.listSize('namen') >= 350, 'Namen ' + A.listSize('namen'));
  const raw = (id) => globalThis.SLFListen[id].split(/[|\n]/).map((x) => x.trim()).filter((x) => x && !x.startsWith('#'));
  for (const id of ['staedte', 'tiere']) {
    for (const l of 'ABCDEFGHIJKLMNOPRSTUVWZ') {
      if (id === 'staedte' && l === 'C') continue;
      assert.ok(raw(id).some((x) => A.startsWith(x, l)), `${id}: nichts mit ${l}`);
    }
  }
});

test('Kategorien: Standard, Pakete, Hilfslisten, Symbole', () => {
  assert.deepStrictEqual(K.STANDARD, ['Stadt', 'Land', 'Fluss', 'Name', 'Tier', 'Beruf']);
  for (const p of K.PACKS) assert.ok(p.cats.length >= 8, p.id);
  assert.ok(K.pack('ab18').adult);
  assert.strictEqual(K.listId('Stadt'), 'staedte');
  assert.strictEqual(K.listId('Beruf'), null);
  assert.strictEqual(K.icon('Fluss'), '🌊');
  assert.strictEqual(K.icon('Was ganz Neues'), '✏️');
  assert.deepStrictEqual(K.pool(['eigene'], ['Automarke', 'automarke', '', 'Brettspiel']), ['Automarke', 'Brettspiel']);
  // Alle Paket-Kategorien haben ein eigenes Symbol
  for (const p of K.PACKS) for (const c of p.cats) assert.notStrictEqual(K.icon(c), '✏️', c);
});

/* ---------- Buchstaben ---------- */

console.log('Buchstaben');

test('ohne Q, X, Y (Standard) – mit „schwere Buchstaben“ alle 26', () => {
  assert.strictEqual(letterPool(sanitizeSettings({})).length, 23);
  assert.ok(!letterPool(sanitizeSettings({})).includes('Q'));
  assert.strictEqual(letterPool(sanitizeSettings({ hard: true })).length, 26);
});

test('jeder Buchstabe nur einmal pro Spiel – sind alle durch, geht es von vorn los', () => {
  const state = Engine.create({ settings: { input: 'one', rounds: 10 }, players: ['A', 'B'] }, { random: seeded(3) });
  const e = new Engine(state, { timers: false, random: seeded(3) });
  const seen = [];
  for (let i = 0; i < 23; i++) {
    if (i) e.startRound();
    assert.ok(!seen.includes(e.s.letter), 'doppelt: ' + e.s.letter);
    assert.ok(!['Q', 'X', 'Y'].includes(e.s.letter));
    seen.push(e.s.letter);
  }
  assert.strictEqual(new Set(seen).size, 23);
  e.startRound();
  assert.ok(seen.includes(e.s.letter), 'nach allen 23 geht es von vorn los');
  assert.deepStrictEqual(e.s.used, [e.s.letter]);
});

test('ABC im Kopf: Alphabet läuft, Stopp am Laptop nimmt den gezeigten Buchstaben, am Handy einen zufälligen', () => {
  const e = phoneGame({ draw: 'abc' }, ['a', 'b']);
  assert.strictEqual(e.s.phase, 'draw');
  assert.strictEqual(e.s.letter, null);
  assert.ok(e.viewFor(STAGE).letters.includes('M'));
  assert.ok(e.apply({ type: 'pick', letter: 'M', round: 1 }, STAGE));
  assert.strictEqual(e.s.phase, 'write');
  assert.strictEqual(e.s.letter, 'M');
  // nächste Runde: M ist verbraucht – wird ein anderer genommen
  e.s.phase = 'scores';
  e.s.history.push({ rows: {} });
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.strictEqual(e.s.phase, 'draw');
  assert.ok(e.apply({ type: 'pick', letter: 'M' }, 'b'));
  assert.notStrictEqual(e.s.letter, 'M');
});

/* ---------- Schreiben & Stopp ---------- */

console.log('Schreiben & Stopp');

test('Stopp nur mit allen Feldern – danach 3 s Nachspielzeit für alle', () => {
  const e = phoneGame({}, ['a', 'b', 'c'], { letter: 'M' });
  write(e, { a: ['München', 'Mexiko', 'Main', 'Max', 'Maus', ''] });
  assert.ok(!e.apply({ type: 'stop', round: 1 }, 'a'), 'Beruf fehlt');
  // Die letzten Eingaben kommen mit dem Stopp
  assert.ok(e.apply({ type: 'stop', texts: ['München', 'Mexiko', 'Main', 'Max', 'Maus', 'Maurer'], round: 1 }, 'a'));
  assert.strictEqual(e.s.phase, 'grace');
  assert.strictEqual(e.s.stopBy, 'a');
  assert.strictEqual(e.s.players[0].stats.stops, 1);
  // In der Nachspielzeit darf noch geschrieben werden
  e.clock.add(GRACE_STOP_MS - 500);
  assert.ok(!e.tick());
  write(e, { b: ['Madrid', '', '', '', '', ''] });
  e.clock.add(600);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'review');
  // Danach nicht mehr
  assert.ok(!e.apply({ type: 'answers', texts: ['Mainz'], round: 1 }, 'c'));
});

test('feste Zeit: nach Ablauf kurz warten (letzte Eingaben), dann ist Schluss – Handy-Stopp geht nicht', () => {
  const e = phoneGame({ end: 'time', time: 60 }, ['a', 'b'], { letter: 'B' });
  write(e, { a: ['Berlin', 'Belgien', 'Bode', 'Ben', 'Bär', 'Bäcker'] });
  assert.ok(!e.apply({ type: 'stop' }, 'a'), 'bei fester Zeit kein Stopp vom Handy');
  e.clock.add(59_000);
  assert.ok(!e.tick());
  assert.strictEqual(e.viewFor('a').timer.remaining, 1000);
  e.clock.add(1001);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'grace');
  assert.strictEqual(e.s.graceReason, 'time');
  write(e, { b: ['Bonn', '', '', '', '', ''] });
  e.clock.add(GRACE_TIME_MS + 1);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'review');
});

test('nur Stopp: keine Zeit – Laptop / Spielleitung können jederzeit beenden', () => {
  const e = phoneGame({ end: 'stop' }, ['a', 'b'], { letter: 'S' });
  assert.strictEqual(e.s.writeEnd, null);
  assert.strictEqual(e.viewFor(STAGE).timer, null);
  assert.ok(!e.apply({ type: 'stop', force: true }, 'b'), 'b ist nicht die Spielleitung');
  assert.ok(e.apply({ type: 'stop', force: true }, 'a'), 'a ist die Spielleitung');
  assert.strictEqual(e.s.phase, 'grace');
  assert.strictEqual(e.s.stopBy, null);
});

test('beides (Standard): Stopp oder spätestens nach 120 s', () => {
  const e = phoneGame({}, ['a', 'b']);
  assert.strictEqual(e.s.settings.end, 'both');
  assert.strictEqual(e.s.writeEnd - e.s.writeStart, 120_000);
});

test('gefilterte Ansicht: Während des Schreibens sieht niemand fremde Antworten', () => {
  const e = phoneGame({}, ['a', 'b', 'c'], { letter: 'M' });
  write(e, { a: ['Mannheim', 'Malta', '', '', '', ''], b: ['Madrid', '', '', '', '', ''] });
  const va = e.viewFor('a');
  assert.deepStrictEqual(va.mine.slice(0, 2), ['Mannheim', 'Malta']);
  assert.ok(!JSON.stringify(va).includes('Madrid'), 'a sieht b nicht');
  const vc = e.viewFor('c');
  assert.ok(!JSON.stringify(vc).includes('Madrid') && !JSON.stringify(vc).includes('Mannheim'));
  const vs = e.viewFor(STAGE);
  assert.ok(!JSON.stringify(vs).includes('Madrid') && !JSON.stringify(vs).includes('Mannheim'), 'Bühne sieht nur den Füllstand');
  assert.deepStrictEqual(vs.fill, { a: 2, b: 1, c: 0 });
  assert.strictEqual(vs.mine, null);
  // In der Nachspielzeit genauso
  assert.ok(e.apply({ type: 'stop' }, STAGE));
  assert.ok(!JSON.stringify(e.viewFor('c')).includes('Madrid'));
});

test('Antworten werden laufend gespeichert – nach dem Neuladen sind sie noch da', () => {
  const e = phoneGame({}, ['a', 'b'], { letter: 'K' });
  write(e, { a: ['Köln', '', '', '', '', ''] });
  const saved = JSON.parse(JSON.stringify(e.s));
  const e2 = new Engine(saved, { timers: false, now: e.clock });
  e2.setAllOffline();
  e2.connect('a', 'A');
  assert.strictEqual(e2.viewFor('a').mine[0], 'Köln');
  // veraltete Runde wird ignoriert
  assert.ok(!e2.apply({ type: 'answers', texts: ['Kiel'], round: 99 }, 'a'));
});

/* ---------- Abstimmung & Punkte ---------- */

console.log('Abstimmung & Punkte');

test('Punkte: einzige gültige 20, einzigartig 10, doppelt 5, leer/falscher Buchstabe 0', () => {
  const e = phoneGame({}, ['a', 'b', 'c', 'd'], { letter: 'M' });
  write(e, {
    a: ['München', 'Mexiko', 'Main', 'Max', '', 'Maurer'],
    b: ['münchen', 'Malta', 'Mosel', 'Mia', '', 'Metzger'],
    c: ['Madrid', 'Mali', '', 'Leon', '', 'Maler'],
    d: ['Mainz', 'Monaco', '', '', 'Maus', 'Bäcker'],
  });
  endWriting(e);
  // Stadt: München doppelt (a, b), Madrid und Mainz einzigartig
  const stadt = e.evalCategory(0).points;
  assert.deepStrictEqual(stadt, { a: 5, b: 5, c: 10, d: 10 });
  // Name: Leon beginnt nicht mit M → 0
  assert.deepStrictEqual(e.evalCategory(3).points, { a: 10, b: 10, c: 0 });
  // Tier: nur d → 20
  assert.deepStrictEqual(e.evalCategory(4).points, { d: 20 });
  finishReview(e);
  assert.strictEqual(e.s.phase, 'scores');
  assert.deepStrictEqual(lastRow(e, 'a').points, [5, 10, 10, 10, 0, 10]);
  assert.deepStrictEqual(lastRow(e, 'c').points, [10, 10, 0, 0, 0, 10]);
  assert.deepStrictEqual(lastRow(e, 'd').points, [10, 10, 0, 0, 20, 0]);
  assert.strictEqual(lastRow(e, 'c').status[3], 'letter');
  assert.strictEqual(e.player('d').score, 40);
  assert.strictEqual(e.player('d').stats.solo, 1);
  assert.strictEqual(e.player('a').stats.dupe, 1);
});

test('Mehrheit 👎: Antwort zählt nicht – und wer übrig bleibt, hat die einzige gültige (20)', () => {
  const e = phoneGame({}, ['a', 'b', 'c', 'd'], { letter: 'M' });
  write(e, { a: ['Mordor', '', '', '', '', ''], b: ['Madrid', '', '', '', '', ''] });
  endWriting(e);
  const mordor = item(e, 'Mordor');
  assert.deepStrictEqual(e.evalCategory(0).points, { a: 10, b: 10 });
  // Wähler: b, c, d (nicht a selbst). 2 von 3 → Mehrheit
  assert.ok(!e.apply({ type: 'vote', cat: 0, id: mordor.id, value: -1 }, 'a'), 'eigene Antwort');
  assert.ok(e.apply({ type: 'vote', cat: 0, id: mordor.id, value: -1 }, 'b'));
  assert.strictEqual(e.itemStatus(mordor).status, 'ok', '1 von 3');
  assert.ok(e.apply({ type: 'vote', cat: 0, id: mordor.id, value: -1 }, 'c'));
  assert.strictEqual(e.itemStatus(mordor).status, 'out');
  assert.deepStrictEqual(e.evalCategory(0).points, { a: 0, b: 20 });
  // zurücknehmen
  assert.ok(e.apply({ type: 'vote', cat: 0, id: mordor.id, value: 0 }, 'c'));
  assert.strictEqual(e.itemStatus(mordor).status, 'ok');
  assert.ok(e.apply({ type: 'vote', cat: 0, id: mordor.id, value: -1 }, 'd'));
  assert.ok(e.apply({ type: 'vote', cat: 0, id: mordor.id, value: -1 }, 'c'));
  finishReview(e);
  assert.strictEqual(lastRow(e, 'b').points[0], 20);
  assert.strictEqual(lastRow(e, 'a').status[0], 'vote');
  assert.strictEqual(e.player('a').stats.vetoed, 1);
  assert.strictEqual(e.s.history[0].vetoed[0].text, 'Mordor');
});

test('Gleichstand → Spielleitung entscheidet (ohne Entscheidung zählt die Antwort)', () => {
  const e = phoneGame({}, ['a', 'b', 'c'], { letter: 'L' });
  write(e, { a: ['Lummerland', '', '', '', '', ''] });
  endWriting(e);
  const it = item(e, 'Lummerland');
  assert.ok(e.apply({ type: 'vote', cat: 0, id: it.id, value: -1 }, 'b'));
  assert.strictEqual(e.itemStatus(it).status, 'tie', '1 von 2');
  assert.strictEqual(e.viewFor(STAGE).review.ties, 1);
  assert.deepStrictEqual(e.evalCategory(0).points, { a: 20 });
  assert.ok(!e.apply({ type: 'decide', cat: 0, id: it.id, valid: false }, 'b'), 'b ist nicht die Spielleitung');
  assert.ok(e.apply({ type: 'decide', cat: 0, id: it.id, valid: false }, STAGE));
  assert.strictEqual(e.itemStatus(it).status, 'out');
  assert.strictEqual(e.itemStatus(it).reason, 'lead');
  assert.ok(!e.apply({ type: 'decide', cat: 0, id: it.id, valid: null }, 'a'), 'Spielleitung am Handy entscheidet nicht über die eigene Antwort');
  assert.ok(e.apply({ type: 'decide', cat: 0, id: it.id, valid: null }, STAGE), 'Laptop nimmt die Entscheidung zurück');
  assert.strictEqual(e.itemStatus(it).status, 'tie');
});

test('Spielleitung am Handy entscheidet über fremde Antworten', () => {
  const e = phoneGame({}, ['a', 'b', 'c'], { letter: 'L' });
  write(e, { b: ['Lummerland', '', '', '', '', ''] });
  endWriting(e);
  const it = item(e, 'Lummerland');
  assert.ok(e.apply({ type: 'vote', cat: 0, id: it.id, value: -1 }, 'c'));
  assert.strictEqual(e.itemStatus(it).status, 'tie');
  assert.ok(e.apply({ type: 'decide', cat: 0, id: it.id, valid: false }, 'a'));
  assert.strictEqual(e.itemStatus(it).status, 'out');
});

test('Spielleitung überstimmt den Anfangsbuchstaben-Check', () => {
  const e = phoneGame({}, ['a', 'b'], { letter: 'S' });
  write(e, { a: ['Zürich', '', '', '', '', ''] });
  endWriting(e);
  const it = item(e, 'Zürich');
  assert.strictEqual(e.itemStatus(it).reason, 'letter');
  assert.ok(e.apply({ type: 'decide', cat: 0, id: it.id, valid: true }, STAGE));
  assert.deepStrictEqual(e.evalCategory(0).points, { a: 20 });
});

test('Abstimmung „nur angezweifelte“: „Alles ok“ – „alle Antworten“: fertig, wenn über jede abgestimmt', () => {
  const e = phoneGame({}, ['a', 'b', 'c'], { letter: 'M' });
  write(e, { a: ['Mainz', '', '', '', '', ''], b: ['Madrid', '', '', '', '', ''] });
  endWriting(e);
  assert.ok(!e.apply({ type: 'vote', cat: 0, id: item(e, 'Mainz').id, value: 1 }, 'b'), '👍 gibt es nur bei „alle“');
  assert.ok(e.apply({ type: 'done', cat: 0 }, 'c'));
  assert.ok(!e.apply({ type: 'done', cat: 0 }, 'c'));
  assert.deepStrictEqual(e.viewFor(STAGE).review.done, ['c']);
  const madrid = item(e, 'Madrid').id;
  assert.ok(e.apply({ type: 'next', cat: 0 }, STAGE));
  assert.deepStrictEqual(e.viewFor(STAGE).review.done, [], 'neue Kategorie, neu abstimmen');
  assert.ok(!e.apply({ type: 'vote', cat: 0, id: madrid, value: -1 }, 'c'), 'verspätete Stimme für die alte Kategorie');
  assert.ok(!e.apply({ type: 'next', cat: 0 }, STAGE), 'doppelter Klick überspringt keine Kategorie');

  const f = phoneGame({ vote: 'all' }, ['a', 'b', 'c'], { letter: 'M' });
  write(f, { a: ['Mainz', '', '', '', '', ''], b: ['Madrid', '', '', '', '', ''] });
  endWriting(f);
  assert.ok(f.apply({ type: 'vote', cat: 0, id: item(f, 'Mainz').id, value: 1 }, 'c'));
  assert.ok(!f.isDone('c'));
  assert.ok(f.apply({ type: 'vote', cat: 0, id: item(f, 'Madrid').id, value: -1 }, 'c'));
  assert.ok(f.isDone('c'));
  assert.ok(!f.isDone('b'));
  assert.ok(f.apply({ type: 'vote', cat: 0, id: item(f, 'Mainz').id, value: 1 }, 'b'));
  assert.ok(f.isDone('b'), 'b muss nur über Mainz abstimmen');
  assert.strictEqual(f.itemStatus(item(f, 'Madrid')).status, 'tie', '1 👎 von 2 (a hat nicht abgestimmt)');
});

test('einfache Wertung 10/5: einzige gültige Antwort gibt 10', () => {
  const e = phoneGame({ scoring: '10-5' }, ['a', 'b', 'c'], { letter: 'B' });
  write(e, { a: ['Berlin', 'Belgien', '', '', '', ''], b: ['berlin', '', '', '', '', ''], c: ['Bonn', '', '', '', '', ''] });
  endWriting(e);
  assert.deepStrictEqual(e.evalCategory(0).points, { a: 5, b: 5, c: 10 });
  assert.deepStrictEqual(e.evalCategory(1).points, { a: 10 });
  finishReview(e);
  assert.strictEqual(e.player('a').stats.solo, 1, 'zählt trotzdem als einzige gültige Antwort');
});

test('Antworten der Abstimmung: gruppiert mit Namen, ✓ bekannt, eigene markiert', () => {
  const e = phoneGame({}, ['a', 'b', 'c'], { letter: 'M' });
  write(e, { a: ['München', '', '', '', '', ''], b: ['münchen', '', '', '', '', ''], c: ['Mordor', '', '', '', '', ''] });
  endWriting(e);
  const r = e.viewFor('a').review;
  assert.strictEqual(r.name, 'Stadt');
  assert.strictEqual(r.nextName, 'Land');
  assert.strictEqual(r.items.length, 2);
  const mu = r.items.find((x) => x.text === 'München');
  assert.deepStrictEqual(mu.names, ['A', 'B']);
  assert.deepStrictEqual(mu.variants, ['München', 'münchen']);
  assert.ok(mu.known && mu.mine);
  const mo = r.items.find((x) => x.text === 'Mordor');
  assert.ok(!mo.known && !mo.mine);
  assert.strictEqual(mo.points, 10);
});

test('Trinkregeln: 0 Punkte je Kategorie → 1 Schluck, Stopp-Rufer mit Fehler → 2 dazu', () => {
  const e = phoneGame({ drinks: true }, ['a', 'b'], { letter: 'M' });
  assert.ok(e.apply({ type: 'stop', texts: ['München', 'Mexiko', 'Main', 'Max', 'Maus', 'Lehrer'], round: 1 }, 'a'));
  write(e, { b: ['Mainz', 'Malta', 'Mosel', 'Mia', 'Maus', 'Maler'] });
  e.clock.add(GRACE_STOP_MS + 1);
  e.tick();
  finishReview(e);
  const h = e.s.history[0];
  assert.deepStrictEqual(h.sips, { a: 1 + 2 });
  assert.strictEqual(h.stopName, 'A');
});

/* ---------- Ablauf ---------- */

console.log('Ablauf');

test('Spiel über alle Runden bis zur Siegerehrung mit Auszeichnungen', () => {
  const e = phoneGame({ rounds: 5 }, ['a', 'b', 'c']);
  for (let r = 1; r <= 5; r++) {
    const L = e.s.letter;
    assert.strictEqual(e.s.round, r);
    write(e, { a: [L + 'aaa', L + 'bbb', '', '', '', ''], b: [L + 'aaa', '', '', '', '', ''], c: [L + 'quatsch' + r, '', '', '', '', ''] });
    if (r === 1) {
      assert.ok(e.apply({ type: 'stop', texts: [L + 'aaa', L + 'bbb', L + 'c', L + 'd', L + 'e', L + 'f'], round: r }, 'a'));
      e.clock.add(GRACE_STOP_MS + 1);
      e.tick();
    } else endWriting(e);
    if (r === 2) {
      const it = e.s.review.items[0].find((x) => x.pids.includes('c'));
      e.apply({ type: 'vote', cat: 0, id: it.id, value: -1 }, 'a');
      e.apply({ type: 'vote', cat: 0, id: it.id, value: -1 }, 'b');
    }
    finishReview(e);
    assert.strictEqual(e.s.phase, 'scores');
    assert.ok(e.apply({ type: 'next' }, STAGE));
  }
  assert.strictEqual(e.s.phase, 'end');
  const titles = e.s.awards.map((x) => x.title);
  assert.ok(titles.includes('Schnellste Finger'));
  assert.ok(titles.includes('Kreativ'));
  assert.ok(titles.includes('Mainstream'));
  assert.ok(titles.includes('Erwischt'));
  assert.ok(e.s.awards.find((x) => x.title === 'Netter Versuch').text.includes('quatsch2'));
  assert.strictEqual(e.viewFor(STAGE).standings[0].id, 'a');
  // Nochmal: zurück in die Lobby, Punkte auf 0
  assert.ok(e.apply({ type: 'again' }, STAGE));
  assert.strictEqual(e.s.phase, 'lobby');
  assert.strictEqual(e.player('a').score, 0);
});

test('Zufalls-Modus: jede Runde 6 andere Kategorien aus den gewählten Paketen', () => {
  const e = phoneGame({ catMode: 'random', packs: ['klassisch', 'essen', 'eigene'], custom: ['Brettspiel'] }, ['a', 'b'], { random: seeded(11) });
  const pool = K.pool(['klassisch', 'essen', 'eigene'], ['Brettspiel']);
  const first = e.s.cats.slice();
  assert.strictEqual(first.length, PER_ROUND);
  assert.ok(first.every((c) => pool.includes(c)));
  e.startRound();
  assert.strictEqual(e.s.cats.length, PER_ROUND);
  assert.ok(!e.s.cats.some((c) => first.includes(c)), 'nicht dieselben wie zuletzt');
});

test('eigene Auswahl: mindestens 3 Kategorien, höchstens 12', () => {
  const s = sanitizeSettings({ catMode: 'pick', cats: ['Stadt', 'stadt', 'Land'] });
  assert.deepStrictEqual(s.cats, ['Stadt', 'Land']);
  const state = Engine.create({ settings: s });
  const e = new Engine(state, { timers: false });
  e.connect('a', 'A');
  e.connect('b', 'B');
  assert.ok(/mindestens 3/.test(e.lobbyProblem()));
  assert.ok(e.apply({ type: 'settings', settings: Object.assign({}, s, { cats: ['Stadt', 'Land', 'Automarke'] }) }, STAGE));
  assert.strictEqual(e.lobbyProblem(), null);
  assert.ok(e.apply({ type: 'start' }, STAGE));
  assert.deepStrictEqual(e.s.cats, ['Stadt', 'Land', 'Automarke']);
  assert.strictEqual(sanitizeSettings({ cats: Array.from({ length: 20 }, (_, i) => 'K' + i) }).cats.length, 12);
});

test('Lobby: mindestens 2 Personen; wer später kommt, spielt sofort mit', () => {
  const state = Engine.create({ settings: { input: 'phones' } });
  const e = new Engine(state, { timers: false, now: clock() });
  e.connect('a', 'A');
  assert.ok(e.lobbyProblem());
  assert.ok(!e.apply({ type: 'start' }, STAGE));
  e.connect('b', 'B');
  assert.ok(e.apply({ type: 'start' }, STAGE));
  e.connect('c', 'C');
  assert.ok(e.player('c'));
  assert.ok(e.apply({ type: 'answers', texts: [e.s.letter + 'x'], round: 1 }, 'c'));
});

test('Hinauswerfen während der Abstimmung entfernt Antworten und Stimmen', () => {
  const e = phoneGame({}, ['a', 'b', 'c'], { letter: 'M' });
  write(e, { a: ['Mainz', '', '', '', '', ''], c: ['Madrid', '', '', '', '', ''] });
  endWriting(e);
  e.apply({ type: 'vote', cat: 0, id: item(e, 'Mainz').id, value: -1 }, 'c');
  assert.ok(e.apply({ type: 'kick', player: 'c' }, STAGE));
  assert.ok(!item(e, 'Madrid'));
  assert.strictEqual(e.itemStatus(item(e, 'Mainz')).downs, 0);
});

test('Zurück zur vorigen Kategorie, Spiel vorzeitig beenden (laufende Runde zählt nicht)', () => {
  const e = phoneGame({}, ['a', 'b'], { letter: 'M' });
  endWriting(e);
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.ok(e.apply({ type: 'back' }, 'a'));
  assert.strictEqual(e.s.review.cat, 0);
  assert.ok(!e.apply({ type: 'back' }, STAGE));
  assert.ok(e.apply({ type: 'end' }, STAGE));
  assert.strictEqual(e.s.phase, 'end');
  assert.strictEqual(e.s.round, 0);
  assert.strictEqual(e.s.history.length, 0);
});

test('Zeitlimit läuft auch ohne Tests weiter (Timer stellt sich selbst)', () => {
  const now = clock();
  const state = Engine.create({ settings: { input: 'phones', end: 'time', time: 60 } });
  let changes = 0;
  const e = new Engine(state, { now, onChange: () => changes++ });
  assert.strictEqual(e.nextDeadline(), null);
  e.connect('a', 'A');
  e.connect('b', 'B');
  e.apply({ type: 'start' }, STAGE);
  assert.strictEqual(e.nextDeadline(), e.s.writeEnd);
  assert.ok(e.timer, 'Timer ist gestellt');
  e.dispose();
  assert.ok(changes >= 3);
});

/* ---------- Ein Gerät ---------- */

console.log('Ein Gerät');

test('Ein Gerät: Buchstabe, Stopp am Laptop, Punkte eintragen, Runde abschließen', () => {
  const now = clock();
  const state = Engine.create({ settings: { input: 'one', rounds: 5 }, players: ['Anna', 'Ben', ''] }, { now, random: seeded(5) });
  const e = new Engine(state, { timers: false, now });
  assert.strictEqual(e.s.phase, 'write');
  assert.strictEqual(e.s.players[2].name, 'Spieler 3');
  assert.ok(e.s.letter);
  assert.ok(!e.apply({ type: 'answers', texts: ['x'] }, 'p1'), 'kein Handy');
  assert.ok(e.apply({ type: 'stop' }, STAGE));
  now.add(GRACE_STOP_MS + 1);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'tally');
  assert.ok(e.apply({ type: 'cell', player: 'p1', cat: 0, points: 20 }, STAGE));
  assert.ok(e.apply({ type: 'cell', player: 'p1', cat: 1, points: 5 }, STAGE));
  assert.ok(!e.apply({ type: 'cell', player: 'p1', cat: 1, points: 7 }, STAGE), 'nur 0/5/10/20');
  assert.ok(e.apply({ type: 'cell', player: 'p2', cat: 2, points: 10 }, STAGE));
  assert.ok(e.apply({ type: 'cell', player: 'p2', cat: 2, points: null }, STAGE), 'leeren');
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.strictEqual(e.s.phase, 'scores');
  assert.strictEqual(e.player('p1').score, 25);
  assert.strictEqual(e.player('p1').stats.solo, 1);
  assert.strictEqual(e.player('p2').score, 0);
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.strictEqual(e.s.round, 2);
  assert.strictEqual(e.s.phase, 'write');
});

console.log(`\n${passed} Tests bestanden.`);
