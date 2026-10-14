'use strict';
/* Tests für „Pi mal Daumen“ (ohne Browser): node tests/pi-mal-daumen.test.js */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
const CATS = ['erde', 'geschichte', 'natur', 'mensch', 'technik', 'alltag', 'sport', 'pop', 'ab18', 'uns'];
for (const c of CATS) require(path.join(__dirname, '..', 'pi-mal-daumen', 'js', 'fragen', c + '.js'));
for (const f of ['numbers', 'deck', 'engine']) require(path.join(__dirname, '..', 'pi-mal-daumen', 'js', f + '.js'));
const N = globalThis.PMDNumbers;
const Deck = globalThis.PMDDeck;
const { Engine, STAGE, scoreRound, median, aggregate, sanitizeSettings, GRACE_MS } = globalThis.PMDEngine;

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

const FACT = { key: 'test', cat: 'erde', kind: 'fact', text: 'Wie hoch ist der Eiffelturm?', answer: 330, unit: 'm', fact: 'Fun Fact' };
const YEAR_Q = { key: 'jahr', cat: 'geschichte', kind: 'fact', text: 'Mauerfall?', answer: 1989, unit: 'Jahr', fact: '' };
const UNS_SUM = { key: 'uns-sum', cat: 'uns', kind: 'uns', text: 'Geschwister?', agg: 'sum', unit: 'Geschwister', ask: 'Wie viele Geschwister hast du?', answer: null, fact: '' };
const UNS_COUNT = { key: 'uns-count', cat: 'uns', kind: 'uns', text: 'Brille?', agg: 'count', unit: 'Personen', ask: 'Brille?', answer: null, fact: '' };

/** Frage der laufenden Runde durch eine bekannte ersetzen */
function setQ(e, q) {
  e.s.cur.q = Object.assign({}, q);
}

/** Spiel mit Handys: Lobby, Spieler verbinden, Teams wählen, starten */
function writeGame(settings, teams, now) {
  const state = Engine.create({
    settings: Object.assign({ input: 'write', seconds: 0 }, settings),
    teams: Object.keys(teams).map((id) => ({ id, active: true, name: 'Team ' + id })),
  });
  const e = new Engine(state, { timers: false, now: now || clock() });
  for (const [id, players] of Object.entries(teams)) {
    for (const pid of players) {
      e.connect(pid, pid.toUpperCase());
      assert.ok(e.apply({ type: 'joinTeam', team: id }, pid), 'joinTeam ' + pid);
    }
  }
  assert.ok(e.apply({ type: 'start' }, STAGE), 'start');
  setQ(e, FACT);
  return e;
}

/** Spiel ohne Handy (reihum): startet sofort */
function sayGame(settings, teamIds) {
  const state = Engine.create({
    settings: Object.assign({ input: 'say' }, settings),
    teams: teamIds.map((id) => ({ id, active: true, name: 'Team ' + id })),
  });
  const e = new Engine(state, { timers: false });
  setQ(e, FACT);
  return e;
}

function lock(e, pid, value) {
  return e.apply({ type: 'lock', value, at: e.stepKey() }, pid);
}

function score(e, id) {
  return e.team(id).score;
}

/* ---------- Zahlen ---------- */

console.log('Zahlen einlesen & anzeigen');

test('Deutsche Schreibweisen werden verstanden', () => {
  assert.strictEqual(N.parse('1500'), 1500);
  assert.strictEqual(N.parse('1.500'), 1500);
  assert.strictEqual(N.parse('1.500.000'), 1500000);
  assert.strictEqual(N.parse('1 500 000'), 1500000);
  assert.strictEqual(N.parse('2,5'), 2.5);
  assert.strictEqual(N.parse('1.234,5'), 1234.5);
  assert.strictEqual(N.parse('1.5'), 1.5);
  assert.strictEqual(N.parse('0.500'), 0.5);
  assert.strictEqual(N.parse('-89,2'), -89.2);
});

test('Tsd, Mio, Mrd & Co. werden verstanden', () => {
  assert.strictEqual(N.parse('1,5 Tsd'), 1500);
  assert.strictEqual(N.parse('2 Mio'), 2000000);
  assert.strictEqual(N.parse('2 Millionen'), 2000000);
  assert.strictEqual(N.parse('3,2 Mrd'), 3200000000);
  assert.strictEqual(N.parse('1,1 Mio'), 1100000);
  assert.strictEqual(N.parse('4 Billionen'), 4e12);
  assert.strictEqual(N.parse('20 Billiarden'), 2e16);
  assert.strictEqual(N.parse('12k'), 12000);
});

test('Jahre v. Chr. und Einheiten', () => {
  assert.strictEqual(N.parse('753 v. Chr.'), -753);
  assert.strictEqual(N.parse('44 v.Chr'), -44);
  assert.strictEqual(N.parse('800 n. Chr.'), 800);
  assert.strictEqual(N.parse('330 Meter'), 330);
  assert.strictEqual(N.parse('330 m'), 330);
});

test('Unsinn wird abgelehnt', () => {
  for (const bad of ['', '   ', 'abc', 'zwölf', '..', '12 34', '-']) assert.strictEqual(N.parse(bad), null, bad);
});

test('Anzeige: Tausenderpunkte, Jahre, Worte', () => {
  assert.strictEqual(N.format(1500000, 'm'), '1.500.000');
  assert.strictEqual(N.format(1989, 'Jahr'), '1989');
  assert.strictEqual(N.format(-753, 'Jahr'), '753 v. Chr.');
  assert.strictEqual(N.withUnit(330, 'm'), '330 m');
  assert.strictEqual(N.withUnit(2.5, '%'), '2,5 %');
  assert.strictEqual(N.words(1500000), '1,5 Millionen');
  assert.strictEqual(N.words(1000000), '1 Million');
  assert.strictEqual(N.words(8e9), '8 Milliarden');
  assert.strictEqual(N.words(999999), null);
  assert.strictEqual(N.distance(1, 'Jahr'), '1 Jahr');
  assert.strictEqual(N.distance(12, 'Jahr'), '12 Jahre');
  assert.strictEqual(N.withUnit(1, 'Personen'), '1 Person');
  assert.strictEqual(N.withUnit(2, 'Personen'), '2 Personen');
});

/* ---------- Wertung ---------- */

console.log('Wertung');

test('Rang: ein Punkt für jedes Team, das weiter weg liegt', () => {
  const r = scoreRound(
    [
      { id: 'a', value: 300 },
      { id: 'b', value: 500 },
      { id: 'c', value: 120 },
      { id: 'd', value: 340 },
    ],
    330,
    { mode: 'rank' }
  );
  assert.deepStrictEqual([r.d.points, r.a.points, r.b.points, r.c.points], [3, 2, 1, 0]);
  assert.deepStrictEqual([r.d.rank, r.a.rank, r.b.rank, r.c.rank], [1, 2, 3, 4]);
  assert.strictEqual(r.a.dir, 'under');
  assert.strictEqual(r.b.dir, 'over');
});

test('Rang: gleicher Abstand = gleiche Punkte, kein Tipp = 0', () => {
  const r = scoreRound(
    [
      { id: 'a', value: 320 },
      { id: 'b', value: 340 },
      { id: 'c', value: null },
    ],
    330,
    { mode: 'rank' }
  );
  assert.strictEqual(r.a.points, 1);
  assert.strictEqual(r.b.points, 1);
  assert.strictEqual(r.a.rank, 1);
  assert.strictEqual(r.b.rank, 1);
  assert.strictEqual(r.c.points, 0);
  assert.strictEqual(r.c.rank, null);
});

test('Volltreffer: höchstens 1 % daneben gibt +2', () => {
  const r = scoreRound(
    [
      { id: 'a', value: 327 },
      { id: 'b', value: 320 },
    ],
    330,
    { mode: 'rank' }
  );
  assert.ok(r.a.hit);
  assert.strictEqual(r.a.points, 1 + 2);
  assert.ok(!r.b.hit);
  assert.strictEqual(r.b.points, 0);
});

test('Volltreffer bei Jahreszahlen nur genau', () => {
  const r = scoreRound(
    [
      { id: 'a', value: 1989 },
      { id: 'b', value: 1990 },
    ],
    1989,
    { mode: 'rank', year: true }
  );
  assert.ok(r.a.hit);
  assert.ok(!r.b.hit);
});

test('Genauigkeit: Punkte nach Prozent bzw. Jahren', () => {
  const pts = (v, a, year) => scoreRound([{ id: 'x', value: v }], a, { mode: 'accuracy', year }).x.points;
  assert.strictEqual(pts(100, 100), 5);
  assert.strictEqual(pts(104, 100), 4);
  assert.strictEqual(pts(110, 100), 3);
  assert.strictEqual(pts(80, 100), 2);
  assert.strictEqual(pts(150, 100), 1);
  assert.strictEqual(pts(200, 100), 0);
  assert.strictEqual(pts(1989, 1989, true), 5);
  assert.strictEqual(pts(1991, 1989, true), 4);
  assert.strictEqual(pts(1980, 1989, true), 2);
  assert.strictEqual(pts(1900, 1989, true), 0);
});

test('Joker verdoppelt die Punkte (inklusive Bonus)', () => {
  const r = scoreRound(
    [
      { id: 'a', value: 330 },
      { id: 'b', value: 100 },
    ],
    330,
    { mode: 'rank', jokers: ['a', 'b'] }
  );
  assert.strictEqual(r.a.points, (1 + 2) * 2);
  assert.strictEqual(r.b.points, 0);
});

test('Median und Summen', () => {
  assert.strictEqual(median([5, 1, 3]), 3);
  assert.strictEqual(median([1, 2, 3, 10]), 2.5);
  assert.strictEqual(median([1988, 1991], true), 1990);
  assert.strictEqual(median([]), null);
  assert.strictEqual(aggregate('sum', [1, 2, 3]), 6);
  assert.strictEqual(aggregate('count', [1, 0, 1, 1]), 3);
});

/* ---------- Ohne Handy (reihum) ---------- */

console.log('Ohne Handy – reihum');

test('Teams nennen nacheinander ihre Zahl, dann wird aufgedeckt', () => {
  const e = sayGame({}, ['rot', 'blau', 'gruen']);
  assert.strictEqual(e.s.phase, 'question');
  assert.strictEqual(e.s.cur.team, 'rot');
  assert.ok(e.apply({ type: 'say', value: '300' }, STAGE));
  assert.strictEqual(e.s.cur.team, 'blau');
  assert.ok(e.apply({ type: 'say', value: '1.000' }, STAGE));
  assert.ok(e.apply({ type: 'say', value: '340' }, STAGE));
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(e.s.cur.answer, 330);
  assert.strictEqual(score(e, 'gruen'), 2);
  assert.strictEqual(score(e, 'rot'), 1);
  assert.strictEqual(score(e, 'blau'), 0);
});

test('Jede Zahl darf nur einmal genannt werden, falsches Team wird abgelehnt', () => {
  const e = sayGame({}, ['rot', 'blau']);
  assert.ok(e.apply({ type: 'say', value: '300' }, STAGE));
  assert.ok(!e.apply({ type: 'say', value: '300' }, STAGE));
  assert.ok(!e.apply({ type: 'say', value: 'quatsch' }, STAGE));
  assert.ok(!e.apply({ type: 'say', value: '301', team: 'rot' }, STAGE));
  assert.ok(e.apply({ type: 'say', value: '301', team: 'blau' }, STAGE));
});

test('Rückgängig nimmt die letzte Zahl zurück', () => {
  const e = sayGame({}, ['rot', 'blau', 'gelb']);
  e.apply({ type: 'say', value: '300' }, STAGE);
  e.apply({ type: 'say', value: '200' }, STAGE);
  assert.ok(e.apply({ type: 'undo' }, STAGE));
  assert.strictEqual(e.s.cur.team, 'blau');
  assert.strictEqual(e.s.cur.said.blau, undefined);
  assert.ok(e.apply({ type: 'say', value: '250' }, STAGE));
  assert.strictEqual(e.s.cur.said.blau, 250);
});

test('Das Team, das anfängt, wechselt mit jeder Frage', () => {
  const e = sayGame({}, ['rot', 'blau', 'gruen']);
  assert.deepStrictEqual(e.s.cur.queue, ['rot', 'blau', 'gruen']);
  e.apply({ type: 'say', value: '1' }, STAGE);
  e.apply({ type: 'say', value: '2' }, STAGE);
  e.apply({ type: 'say', value: '3' }, STAGE);
  assert.ok(e.apply({ type: 'next', no: 1 }, STAGE));
  assert.deepStrictEqual(e.s.cur.queue, ['blau', 'gruen', 'rot']);
});

test('Joker ohne Handy: am Laptop gesetzt, nur einmal pro Spiel', () => {
  const e = sayGame({ joker: true }, ['rot', 'blau']);
  assert.ok(e.apply({ type: 'joker', team: 'rot' }, STAGE));
  e.apply({ type: 'say', value: '330' }, STAGE);
  e.apply({ type: 'say', value: '100' }, STAGE);
  assert.strictEqual(score(e, 'rot'), (1 + 2) * 2);
  assert.ok(e.team('rot').jokerUsed);
  e.apply({ type: 'next' }, STAGE);
  assert.ok(!e.apply({ type: 'joker', team: 'rot' }, STAGE), 'Joker ist verbraucht');
  assert.ok(e.apply({ type: 'joker', team: 'blau' }, STAGE));
  assert.ok(e.apply({ type: 'joker', team: 'blau' }, STAGE), 'zurücknehmen geht');
  assert.deepStrictEqual(e.s.cur.jokers, []);
});

test('Joker ausgeschaltet: geht nicht', () => {
  const e = sayGame({ joker: false }, ['rot', 'blau']);
  assert.ok(!e.apply({ type: 'joker', team: 'rot' }, STAGE));
});

test('„Über uns“ ohne Handy: nach dem Schätzen wird durchgezählt', () => {
  const e = sayGame({}, ['rot', 'blau']);
  setQ(e, UNS_SUM);
  e.apply({ type: 'say', value: '10' }, STAGE);
  e.apply({ type: 'say', value: '15' }, STAGE);
  assert.strictEqual(e.s.phase, 'count');
  assert.ok(!e.apply({ type: 'count', value: '-3' }, STAGE));
  assert.ok(e.apply({ type: 'count', value: '14' }, STAGE));
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(e.s.cur.answer, 14);
  assert.strictEqual(score(e, 'blau'), 1);
});

test('Nur ein Team: Wertung nach Genauigkeit', () => {
  const e = sayGame({ scoring: 'rank' }, ['rot']);
  e.apply({ type: 'say', value: '320' }, STAGE);
  assert.strictEqual(e.s.cur.mode, 'accuracy');
  assert.strictEqual(score(e, 'rot'), 4);
});

/* ---------- Mit Handy ---------- */

console.log('Mit Handy');

test('Gemeinsames Feld: alle im Team sehen den Entwurf, einer legt fest', () => {
  const e = writeGame({ teamInput: 'shared' }, { rot: ['a', 'b'], blau: ['c'] });
  assert.ok(e.apply({ type: 'draft', text: '2 Mio', at: e.stepKey() }, 'a'));
  const vb = e.viewFor('b');
  assert.strictEqual(vb.cur.mine.text, '2 Mio');
  assert.strictEqual(vb.cur.mine.draft, 2000000);
  assert.strictEqual(vb.cur.mine.by, 'A');
  // Fremdes Team sieht nichts davon
  const vc = e.viewFor('c');
  assert.strictEqual(vc.cur.mine.text, '');
  assert.ok(lock(e, 'b', '300'));
  assert.ok(e.s.cur.guesses.rot.locked);
  assert.ok(!e.apply({ type: 'draft', text: '5', at: e.stepKey() }, 'a'), 'festgelegt = kein Entwurf mehr');
  assert.ok(e.apply({ type: 'unlock', at: e.stepKey() }, 'a'));
  assert.ok(lock(e, 'a', '320'));
  assert.ok(lock(e, 'c', '500'));
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(score(e, 'rot'), 1);
});

test('Median: jede/r schätzt geheim, der Median zählt', () => {
  const e = writeGame({ teamInput: 'median' }, { rot: ['a', 'b', 'c'], blau: ['d'] });
  lock(e, 'a', 100);
  lock(e, 'b', 320);
  assert.strictEqual(e.s.phase, 'question');
  lock(e, 'd', 500);
  assert.strictEqual(e.s.phase, 'question', 'c fehlt noch');
  lock(e, 'c', 1000);
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(e.s.cur.results.rot.value, 320);
  assert.strictEqual(e.s.cur.results.rot.members.length, 3);
  assert.strictEqual(score(e, 'rot'), 1);
});

test('Zeit abgelaufen: angefangener Tipp zählt, sonst 0 Punkte', () => {
  const now = clock();
  const e = writeGame({ teamInput: 'shared', seconds: 30 }, { rot: ['a'], blau: ['b'], gelb: ['c'] }, now);
  e.apply({ type: 'draft', text: '310', at: e.stepKey() }, 'a');
  lock(e, 'b', '900');
  now.add(31000);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(e.s.cur.results.rot.value, 310);
  assert.strictEqual(e.s.cur.results.gelb.value, null);
  assert.strictEqual(score(e, 'rot'), 2);
  assert.strictEqual(score(e, 'blau'), 1);
  assert.strictEqual(score(e, 'gelb'), 0);
});

test('Bei Jahreszahlen wird auf ganze Jahre gerundet', () => {
  const e = writeGame({}, { rot: ['a'], blau: ['b'] });
  setQ(e, YEAR_Q);
  e.apply({ type: 'draft', text: '1988,6', at: e.stepKey() }, 'a');
  assert.strictEqual(e.s.cur.guesses.rot.draft, 1989);
  lock(e, 'a', '1988,6');
  lock(e, 'b', '1500');
  assert.strictEqual(e.s.cur.results.rot.value, 1989);
  assert.ok(e.s.cur.results.rot.hit);
});

test('Verspätete Eingaben für eine alte Frage werden ignoriert', () => {
  const e = writeGame({}, { rot: ['a'], blau: ['b'] });
  const old = e.stepKey();
  assert.ok(e.apply({ type: 'skip' }, STAGE));
  assert.ok(!e.apply({ type: 'lock', value: 5, at: old }, 'a'));
  assert.ok(e.apply({ type: 'lock', value: 5, at: e.stepKey() }, 'a'));
});

test('„Über uns“ mit Handy: Antwort aus den eigenen Angaben', () => {
  const e = writeGame({}, { rot: ['a', 'b'], blau: ['c'] });
  setQ(e, UNS_SUM);
  const at = e.stepKey();
  assert.ok(e.apply({ type: 'own', value: '2', at }, 'a'));
  assert.ok(e.apply({ type: 'own', value: '1', at }, 'b'));
  assert.ok(!e.apply({ type: 'own', value: '-1', at }, 'c'));
  lock(e, 'a', 3);
  lock(e, 'c', 10);
  assert.strictEqual(e.s.phase, 'question', 'c hat noch nichts über sich gesagt');
  assert.ok(e.apply({ type: 'own', value: '0', at }, 'c'));
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(e.s.cur.answer, 3);
  assert.deepStrictEqual(e.s.cur.ownCount, { answered: 3, total: 3 });
  assert.strictEqual(score(e, 'rot'), 1 + 2, 'genau richtig = Volltreffer');
});

test('„Über uns“ mit Ja/Nein zählt die Ja-Antworten', () => {
  const e = writeGame({}, { rot: ['a', 'b'], blau: ['c'] });
  setQ(e, UNS_COUNT);
  const at = e.stepKey();
  assert.ok(!e.apply({ type: 'own', value: '1', at }, 'a'), 'nur true/false');
  e.apply({ type: 'own', value: true, at }, 'a');
  e.apply({ type: 'own', value: false, at }, 'b');
  e.apply({ type: 'own', value: true, at }, 'c');
  lock(e, 'a', 2);
  lock(e, 'c', 3);
  assert.strictEqual(e.s.cur.answer, 2);
});

test('Joker mit Handy: setzt jemand aus dem Team', () => {
  const e = writeGame({ joker: true }, { rot: ['a'], blau: ['b'] });
  assert.ok(e.apply({ type: 'joker', at: e.stepKey() }, 'a'));
  assert.deepStrictEqual(e.s.cur.jokers, ['rot']);
  lock(e, 'a', 330);
  lock(e, 'b', 10);
  assert.strictEqual(score(e, 'rot'), 6);
});

test('Schonfrist: wer die Verbindung verliert, wird abgewartet, dann geht es ohne ihn weiter', () => {
  const now = clock();
  const e = writeGame({}, { rot: ['a'], blau: ['b'] }, now);
  lock(e, 'a', 300);
  e.disconnect('b');
  assert.ok(!e.tick());
  assert.strictEqual(e.s.phase, 'question');
  now.add(GRACE_MS + 10);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'reveal');
});

test('Gefilterte Ansicht verrät vor dem Aufdecken weder Antwort noch fremde Tipps', () => {
  const e = writeGame({}, { rot: ['a'], blau: ['b'] });
  lock(e, 'a', '987654');
  for (const viewer of [STAGE, 'a', 'b']) {
    const json = JSON.stringify(e.viewFor(viewer));
    assert.ok(!json.includes('"answer":330'), 'Antwort sichtbar für ' + viewer);
    assert.ok(!json.includes('Fun Fact'), 'Fun Fact sichtbar für ' + viewer);
    if (viewer !== 'a') assert.ok(!json.includes('987654'), 'fremder Tipp sichtbar für ' + viewer);
  }
  lock(e, 'b', 1);
  const after = JSON.stringify(e.viewFor('b'));
  assert.ok(after.includes('987654'));
  assert.ok(after.includes('Fun Fact'));
});

test('Stechen bei Gleichstand: nur die Führenden, nur Rang', () => {
  const e = writeGame({ questions: 5 }, { rot: ['a'], blau: ['b'], gelb: ['c'] });
  e.s.round = 5;
  e.team('rot').score = 7;
  e.team('blau').score = 7;
  e.team('gelb').score = 3;
  lock(e, 'a', 1);
  lock(e, 'b', 2);
  lock(e, 'c', 330);
  // gelb: 2 + 2 Bonus → 7, blau: 1 → 8, rot: 0 → 7
  assert.strictEqual(score(e, 'blau'), 8);
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.phase, 'over');
  assert.deepStrictEqual(e.s.winners, ['blau']);

  const f = writeGame({ questions: 5 }, { rot: ['a'], blau: ['b'], gelb: ['c'] });
  f.s.round = 5;
  lock(f, 'a', 100);
  lock(f, 'b', 100.5);
  lock(f, 'c', 900);
  // Gleichstand an der Spitze herstellen
  f.team('rot').score = 9;
  f.team('blau').score = 9;
  f.team('gelb').score = 1;
  f.apply({ type: 'next' }, STAGE);
  assert.strictEqual(f.s.phase, 'question');
  assert.deepStrictEqual(f.s.cur.teams, ['rot', 'blau']);
  assert.ok(f.s.cur.tiebreak);
  assert.notStrictEqual(f.s.cur.q.cat, 'uns');
  setQ(f, FACT);
  assert.ok(!f.apply({ type: 'joker', at: f.stepKey() }, 'a'), 'kein Joker im Stechen');
  lock(f, 'a', 331);
  lock(f, 'b', 400);
  assert.strictEqual(f.s.cur.results.rot.points, 1, 'kein Volltreffer-Bonus im Stechen');
  f.apply({ type: 'next' }, STAGE);
  assert.strictEqual(f.s.phase, 'over');
  assert.deepStrictEqual(f.s.winners, ['rot']);
});

test('Spieler kommen und gehen mitten im Spiel', () => {
  const e = writeGame({}, { rot: ['a'], blau: ['b'] });
  e.connect('z', 'Zoe');
  assert.ok(e.apply({ type: 'joinTeam', team: 'rot' }, 'z'));
  assert.ok(!e.s.cur.participants.rot.includes('z'), 'erst ab der nächsten Frage');
  lock(e, 'a', 1);
  lock(e, 'b', 2);
  e.apply({ type: 'next' }, STAGE);
  assert.ok(e.s.cur.participants.rot.includes('z'));
  assert.ok(e.apply({ type: 'kick', player: 'z' }, STAGE));
  assert.ok(!e.s.cur.participants.rot.includes('z'));
});

test('Jeder für sich (mit Handy): automatisch dabei, eigene Farben', () => {
  const state = Engine.create({ settings: { input: 'write', solo: true, seconds: 0 } });
  const e = new Engine(state, { timers: false });
  e.connect('a', 'Anna');
  e.connect('b', 'Ben');
  assert.strictEqual(e.s.teams.length, 2);
  assert.strictEqual(e.teamOf('a').name, 'Anna');
  assert.notStrictEqual(e.teamOf('a').color, e.teamOf('b').color);
  assert.strictEqual(e.viewFor('a').teamInput, 'shared');
  assert.ok(e.apply({ type: 'start' }, STAGE));
  setQ(e, FACT);
  lock(e, 'a', 320);
  lock(e, 'b', 400);
  assert.strictEqual(score(e, e.teamOf('a').id), 1);
  // Neue Person steigt mitten im Spiel ein
  e.connect('c', 'Cem');
  assert.ok(!e.teamOf('c'));
  assert.ok(e.apply({ type: 'joinTeam', team: 'me' }, 'c'));
  assert.ok(e.s.order.includes(e.teamOf('c').id));
});

test('Jeder für sich (ohne Handy): Namen aus dem Setup', () => {
  const state = Engine.create({ settings: { input: 'say', solo: true }, players: ['Anna', '', 'Cem'] });
  assert.deepStrictEqual(
    state.teams.map((t) => t.name),
    ['Anna', 'Spieler 2', 'Cem']
  );
  assert.strictEqual(state.phase, 'question');
  assert.strictEqual(state.order.length, 3);
});

test('Einstellungen werden geprüft', () => {
  const s = sanitizeSettings({ questions: 7, seconds: 999, scoring: 'quatsch', categories: ['uns'] });
  assert.strictEqual(s.questions, 10);
  assert.strictEqual(s.seconds, 45);
  assert.strictEqual(s.scoring, 'rank');
  assert.ok(s.categories.includes('erde'), 'nur „Über uns“ reicht nicht');
  assert.ok(!s.categories.includes('ab18'), '18+ ist standardmäßig aus');
  const t = sanitizeSettings({ categories: ['ab18', 'uns', 'gibtsnicht'] });
  assert.deepStrictEqual(t.categories, ['ab18', 'uns']);
});

test('Ganzes Spiel bis zur Siegerehrung mit Auszeichnungen', () => {
  const e = writeGame({ questions: 5 }, { rot: ['a'], blau: ['b'] });
  for (let i = 0; i < 5; i++) {
    setQ(e, i % 2 ? YEAR_Q : FACT);
    const ans = e.s.cur.q.answer;
    lock(e, 'a', ans);
    lock(e, 'b', ans * 3 + 7);
    assert.strictEqual(e.s.phase, 'reveal');
    e.apply({ type: 'next' }, STAGE);
  }
  assert.strictEqual(e.s.phase, 'over');
  assert.deepStrictEqual(e.s.winners, ['rot']);
  const titles = e.s.awards.map((a) => a.title);
  assert.ok(titles.includes('Scharfschützen'));
  assert.ok(titles.includes('Optimisten'));
  assert.ok(titles.includes('Weit daneben'));
  assert.ok(e.apply({ type: 'again' }, STAGE));
  assert.strictEqual(e.s.phase, 'lobby');
  assert.strictEqual(score(e, 'rot'), 0);
});

/* ---------- Fragenliste ---------- */

console.log('Fragenliste');

test('Jede Zeile ist gültig', () => {
  const F = globalThis.PMD_FRAGEN;
  for (const cat of CATS) {
    assert.ok(F[cat], 'Datei fehlt: ' + cat);
    for (const [i, q] of Deck._parseList(F[cat], cat).entries()) {
      assert.ok(q, `${cat}: Zeile ${i + 1} ist ungültig`);
    }
  }
});

test('Antworten sind Zahlen, Jahreszahlen ganzzahlig, Texte sinnvoll', () => {
  const L = Deck.all();
  for (const cat of CATS) {
    for (const q of L[cat]) {
      assert.ok(q.text.endsWith('?'), `${cat}: „${q.text}“ endet nicht mit einem Fragezeichen`);
      assert.ok(q.text.length <= 140, `${cat}: „${q.text}“ ist zu lang`);
      if (q.kind === 'fact') {
        assert.ok(Number.isFinite(q.answer), q.text);
        if (q.unit === 'Jahr') assert.ok(Number.isInteger(q.answer), `Jahreszahl nicht ganzzahlig: ${q.text}`);
        if (q.unit === 'Jahr') assert.ok(q.answer >= -5000 && q.answer <= 2100, `Jahreszahl unplausibel: ${q.text}`);
      } else {
        assert.ok(['sum', 'count'].includes(q.agg), q.text);
        assert.ok(q.ask.endsWith('?') || q.ask.endsWith(')') || q.ask.endsWith('!'), `Personenfrage: ${q.ask}`);
      }
    }
  }
});

test('Keine doppelten Fragen', () => {
  const seen = new Map();
  for (const [cat, list] of Object.entries(Deck.all())) {
    for (const q of list) {
      assert.ok(!seen.has(q.key), `doppelt: „${q.text}“ (${cat} und ${seen.get(q.key)})`);
      seen.set(q.key, cat);
    }
  }
});

test('Genug Fragen: insgesamt mindestens 1000, pro Kategorie mindestens 70', () => {
  const st = Deck.stats();
  for (const cat of CATS) assert.ok(st[cat] >= 70, `${cat}: nur ${st[cat]} Fragen`);
  assert.ok(st.total >= 1000, `nur ${st.total} Fragen`);
  console.log(`    (${st.total} Fragen: ${CATS.map((c) => `${c} ${st[c]}`).join(', ')})`);
});

test('Ziehen: ohne Wiederholung, nur gewählte Kategorien', () => {
  const used = [];
  const keys = new Set();
  for (let i = 0; i < 60; i++) {
    const q = Deck.draw(['sport', 'pop'], used);
    assert.ok(['sport', 'pop'].includes(q.cat));
    assert.ok(!keys.has(q.key), 'doppelt gezogen');
    keys.add(q.key);
  }
});

console.log(`\n${passed} Tests bestanden.`);
