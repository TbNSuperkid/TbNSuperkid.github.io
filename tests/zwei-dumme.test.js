'use strict';
/* Tests für „2 Dumme, 1 Gedanke“ (ohne Browser): node tests/zwei-dumme.test.js */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
for (const f of ['match', 'words/begriffe', 'deck', 'engine']) {
  require(path.join(__dirname, '..', 'zwei-dumme', 'js', f + '.js'));
}
const M = globalThis.ZDMatch;
const Deck = globalThis.ZDDeck;
const { Engine, STAGE, kettePoints } = globalThis.ZDEngine;

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

/** Spiel mit Handys: Lobby, Spieler verbinden, Teams wählen, starten */
function writeGame(settings, teams, now) {
  const state = Engine.create({
    settings: Object.assign({ input: 'write' }, settings),
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
  return e;
}

/** Spiel ohne Handy: startet sofort */
function sayGame(settings, teams) {
  const state = Engine.create({
    settings: Object.assign({ input: 'say' }, settings),
    teams: Object.entries(teams).map(([id, players]) => ({ id, active: true, name: 'Team ' + id, players })),
  });
  return new Engine(state, { timers: false });
}

function submit(e, pid, word) {
  const team = e.teamOf(pid);
  return e.apply({ type: 'submit', word, at: e.stepKey(team.id) }, pid);
}

function score(e, id) {
  return e.team(id).score;
}

/* ---------- Wörter vergleichen ---------- */

console.log('Wörter vergleichen');

test('Groß/klein, Leerzeichen, Umlaute und Artikel sind egal', () => {
  assert.ok(M.same('Mond', ' mond '));
  assert.ok(M.same('Müsli', 'Muesli'));
  assert.ok(M.same('der Mond', 'Mond'));
  assert.ok(M.same('New York', 'newyork'));
  assert.ok(M.same('Straße', 'Strasse'));
});

test('Plural und kleine Tippfehler zählen als gleich', () => {
  assert.ok(M.same('Rakete', 'Raketen'));
  assert.ok(M.same('Kind', 'Kinder'));
  assert.ok(M.same('Gitare', 'Gitarre'));
  assert.ok(M.same('Banane', 'Bananen'));
});

test('Verschiedene Wörter bleiben verschieden', () => {
  assert.ok(!M.same('Affe', 'Rakete'));
  assert.ok(!M.same('Kerzen', 'Herzen'));
  assert.ok(!M.same('Tanne', 'Tante'));
  assert.ok(!M.same('Ei', 'Eis'));
  assert.ok(!M.same('', ''));
});

test('Bewertung: alle / teilweise / keiner', () => {
  assert.strictEqual(M.assess(['Sand', 'sand', 'Sand']).outcome, 'all');
  assert.strictEqual(M.assess(['Meer', 'Sand', 'Meer']).outcome, 'some');
  assert.strictEqual(M.assess(['Urlaub', 'Sonne']).outcome, 'none');
  assert.strictEqual(M.assess(['Sand', '']).outcome, 'none', 'ein fehlendes Wort ist kein Treffer');
  assert.strictEqual(M.assess(['Sand']).outcome, 'none', 'allein zählt nicht');
  assert.deepStrictEqual(M.assess(['Meer', 'Sand', 'Meere']).groups, [[0, 2], [1]]);
});

test('Gesperrte Wörter werden auch in Varianten erkannt', () => {
  assert.ok(M.used('Raketen', ['Affe', 'Rakete']));
  assert.ok(!M.used('Laika', ['Affe', 'Rakete']));
});

/* ---------- Begriffe ---------- */

console.log('Begriffe');

test('Begriffslisten: genug Begriffe, keine Dopplungen, keine zu langen Einträge', () => {
  const L = Deck.all();
  assert.ok(L.einzel.length >= 150, 'einzel: ' + L.einzel.length);
  assert.ok(L.kategorie.length >= 100, 'kategorie: ' + L.kategorie.length);
  assert.ok(L.luecke.length >= 50, 'luecke: ' + L.luecke.length);
  const seen = new Map();
  for (const kind of Deck.KINDS) {
    for (const e of L[kind]) {
      assert.ok(!seen.has(e.key), `doppelt: "${e.text}" (${kind} und ${seen.get(e.key)})`);
      seen.set(e.key, kind);
      assert.ok(e.text.length <= 40, 'zu lang: ' + e.text);
    }
  }
});

test('Ziehen ohne Wiederholung im selben Spiel', () => {
  const used = [];
  const keys = new Set();
  for (let i = 0; i < 100; i++) keys.add(Deck.draw('begriff', used).key);
  assert.strictEqual(keys.size, 100);
  assert.strictEqual(used.length, 100);
  const start = Deck.draw('start', []);
  assert.strictEqual(start.kind, 'einzel');
});

/* ---------- Ein Begriff, mit Handy ---------- */

console.log('Ein Begriff – mit Handy');

test('Lobby: Teams mit nur einem Spieler blockieren den Start', () => {
  const state = Engine.create({ settings: { input: 'write' }, teams: [{ id: 'rot', active: true }, { id: 'blau', active: true }] });
  const e = new Engine(state, { timers: false });
  assert.strictEqual(state.phase, 'lobby');
  e.connect('a', 'Anna');
  e.apply({ type: 'joinTeam', team: 'rot' }, 'a');
  assert.match(e.lobbyProblem(), /braucht mindestens 2/);
  assert.ok(!e.apply({ type: 'start' }, STAGE));
  e.connect('b', 'Ben');
  e.apply({ type: 'joinTeam', team: 'rot' }, 'b');
  assert.strictEqual(e.lobbyProblem(), null, 'leeres Team Blau wird einfach ignoriert');
  assert.ok(!e.apply({ type: 'start' }, 'a'), 'nur der Laptop startet');
  assert.ok(e.apply({ type: 'start' }, STAGE));
  assert.deepStrictEqual(state.order, ['rot']);
});

test('Punkte: alle gleich 3, teilweise 1, keiner 0', () => {
  const e = writeGame({ mode: 'begriff', rounds: 5 }, { rot: ['a', 'b', 'c'], blau: ['d', 'e', 'f'], gruen: ['g', 'h'] });
  assert.strictEqual(e.s.phase, 'play');
  submit(e, 'a', 'Sand');
  submit(e, 'b', 'sand');
  submit(e, 'c', 'Sand');
  submit(e, 'd', 'Meer');
  submit(e, 'e', 'Sand');
  submit(e, 'f', 'Meere');
  submit(e, 'g', 'Urlaub');
  assert.strictEqual(e.s.phase, 'play', 'wartet auf h');
  submit(e, 'h', 'Sonne');
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(score(e, 'rot'), 3);
  assert.strictEqual(score(e, 'blau'), 1);
  assert.strictEqual(score(e, 'gruen'), 0);
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.strictEqual(e.s.round, 2);
  assert.strictEqual(e.s.phase, 'play');
});

test('Ansicht verrät fremde Wörter erst nach dem Aufdecken', () => {
  const e = writeGame({ mode: 'begriff' }, { rot: ['a', 'b'], blau: ['c', 'd'] });
  submit(e, 'a', 'Geheim');
  const stage = JSON.stringify(e.viewFor(STAGE));
  const mate = JSON.stringify(e.viewFor('b'));
  const other = JSON.stringify(e.viewFor('c'));
  for (const v of [stage, mate, other]) assert.ok(!v.includes('Geheim'), 'Wort sichtbar: ' + v.slice(0, 80));
  assert.strictEqual(e.viewFor('a').cur.myWord, 'Geheim');
  assert.deepStrictEqual(e.viewFor(STAGE).cur.answered, ['a']);
  submit(e, 'b', 'Geheim');
  submit(e, 'c', 'X1');
  submit(e, 'd', 'X2');
  assert.ok(JSON.stringify(e.viewFor('c')).includes('Geheim'), 'nach dem Aufdecken sichtbar');
});

test('Ändern vor dem Aufdecken, verspätete Eingaben werden ignoriert', () => {
  const e = writeGame({ mode: 'begriff' }, { rot: ['a', 'b'] });
  const at = e.stepKey('rot');
  submit(e, 'a', 'Erst');
  assert.ok(e.apply({ type: 'unsubmit', at }, 'a'));
  assert.strictEqual(e.viewFor('a').cur.myWord, null);
  submit(e, 'a', 'Zweit');
  submit(e, 'b', 'Zweit');
  assert.strictEqual(score(e, 'rot'), 3);
  e.apply({ type: 'next' }, STAGE);
  assert.ok(!e.apply({ type: 'submit', word: 'Alt', at }, 'a'), 'Eingabe für die alte Runde');
  assert.ok(!e.apply({ type: 'submit', word: 'X' }, STAGE), 'der Laptop tippt nicht');
});

test('Zeitlimit: wer nichts eingibt, zählt als verschieden', () => {
  const now = clock();
  const e = writeGame({ mode: 'begriff', seconds: 20 }, { rot: ['a', 'b'] }, now);
  submit(e, 'a', 'Sand');
  now.add(19000);
  assert.ok(!e.tick());
  now.add(2000);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(score(e, 'rot'), 0);
  assert.deepStrictEqual(
    e.s.cur.results.rot.words.map((w) => w.word),
    ['Sand', '']
  );
});

test('Wer die Verbindung verliert, wird nicht abgewartet', () => {
  const e = writeGame({ mode: 'begriff' }, { rot: ['a', 'b', 'c'] });
  submit(e, 'a', 'Sand');
  submit(e, 'b', 'Sand');
  e.disconnect('c');
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(score(e, 'rot'), 3, 'c zählt nicht mit');
});

test('Zweite Chance: Brücke zwischen den eigenen Wörtern bringt 2 Punkte', () => {
  const e = writeGame({ mode: 'begriff', secondChance: true }, { rot: ['a', 'b', 'c'], blau: ['d', 'e'] });
  for (const [p, w] of [['a', 'Meer'], ['b', 'Sand'], ['c', 'Meer'], ['d', 'Sand'], ['e', 'Sand']]) submit(e, p, w);
  assert.strictEqual(score(e, 'blau'), 3, 'sofort gewertet');
  assert.strictEqual(score(e, 'rot'), 0, 'noch offen');
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.phase, 'play');
  assert.strictEqual(e.s.cur.attempt, 2);
  assert.deepStrictEqual(e.s.cur.active, ['rot']);
  assert.ok(!submit(e, 'd', 'Welle'), 'Blau ist fertig');
  for (const p of ['a', 'b', 'c']) submit(e, p, 'Welle');
  assert.strictEqual(score(e, 'rot'), 2);
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.round, 2);
  assert.strictEqual(e.s.history.length, 1);
});

test('Zweite Chance verpasst: es bleibt das erste Ergebnis', () => {
  const e = writeGame({ mode: 'begriff', secondChance: true }, { rot: ['a', 'b', 'c'] });
  for (const [p, w] of [['a', 'Meer'], ['b', 'Sand'], ['c', 'Meer']]) submit(e, p, w);
  e.apply({ type: 'next' }, STAGE);
  for (const [p, w] of [['a', 'Welle'], ['b', 'Muschel'], ['c', 'Wasser']]) submit(e, p, w);
  assert.strictEqual(score(e, 'rot'), 1);
});

test('Begriff überspringen zieht einen neuen Begriff und löscht Eingaben', () => {
  const e = writeGame({ mode: 'begriff' }, { rot: ['a', 'b'] });
  const before = e.s.cur.term.text;
  submit(e, 'a', 'Egal');
  assert.ok(e.apply({ type: 'skipTerm' }, STAGE));
  assert.notStrictEqual(e.s.cur.term.text, before);
  assert.deepStrictEqual(e.s.cur.answers, {});
});

test('Mitten im Spiel einem Team beitreten: ab der nächsten Runde dabei', () => {
  const e = writeGame({ mode: 'begriff' }, { rot: ['a', 'b'] });
  e.connect('z', 'Zoe');
  assert.ok(e.apply({ type: 'joinTeam', team: 'rot' }, 'z'));
  submit(e, 'a', 'Sand');
  submit(e, 'b', 'Sand');
  assert.strictEqual(e.s.phase, 'reveal', 'Zoe wird in dieser Runde nicht abgewartet');
  e.apply({ type: 'next' }, STAGE);
  assert.deepStrictEqual(e.s.cur.participants.rot, ['a', 'b', 'z']);
});

/* ---------- Gedankenkette, mit Handy ---------- */

console.log('Gedankenkette – mit Handy');

test('Punkte je nach Runde des Treffers', () => {
  assert.deepStrictEqual([1, 2, 3, 4, 5, 8].map(kettePoints), [5, 4, 3, 2, 1, 1]);
});

test('Kette: Teams spielen unabhängig, Treffer bringt Punkte', () => {
  const e = writeGame({ mode: 'kette', rounds: 3 }, { rot: ['a', 'b'], blau: ['c', 'd', 'f'] });
  // Rot trifft in Runde 2
  submit(e, 'a', 'Banane');
  submit(e, 'b', 'Weltraum');
  assert.strictEqual(e.s.cur.chains.rot.steps.length, 1);
  assert.ok(!submit(e, 'a', 'Bananen'), 'gesperrt (Variante eines schon genannten Worts)');
  submit(e, 'a', 'Affe');
  submit(e, 'b', 'Affe');
  assert.strictEqual(e.s.cur.chains.rot.hit, 2);
  assert.strictEqual(score(e, 'rot'), 4);
  assert.strictEqual(e.s.phase, 'play', 'Blau spielt noch');
  // Blau: ganzes Team, 2 von 3 gleich reicht nicht
  submit(e, 'c', 'Hund');
  submit(e, 'd', 'Hund');
  submit(e, 'f', 'Katze');
  assert.strictEqual(e.s.cur.chains.blau.steps[0].outcome, 'some');
  assert.ok(!e.s.cur.chains.blau.done);
  for (const p of ['c', 'd', 'f']) submit(e, p, 'Maus');
  assert.strictEqual(score(e, 'blau'), 4);
  assert.strictEqual(e.s.phase, 'summary');
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.strictEqual(e.s.round, 2);
  assert.strictEqual(e.s.cur.chains.rot.steps.length, 0, 'neue Kette');
});

test('Kette: nach der maximalen Rundenzahl gescheitert (0 Punkte)', () => {
  const e = writeGame({ mode: 'kette', maxSteps: 5 }, { rot: ['a', 'b'] });
  for (let i = 0; i < 5; i++) {
    submit(e, 'a', 'A' + i + 'x');
    submit(e, 'b', 'B' + i + 'y');
  }
  const ch = e.s.cur.chains.rot;
  assert.ok(ch.done);
  assert.strictEqual(ch.hit, null);
  assert.strictEqual(ch.points, 0);
  assert.strictEqual(e.s.phase, 'summary');
});

test('Kette: vorgegebene Startwörter sind für alle Teams gleich und gesperrt', () => {
  const e = writeGame({ mode: 'kette', startWords: 'given' }, { rot: ['a', 'b'], blau: ['c', 'd'] });
  const start = e.s.cur.chains.rot.start;
  assert.strictEqual(start.length, 2);
  assert.deepStrictEqual(e.s.cur.chains.blau.start, start);
  assert.ok(!submit(e, 'a', start[0]));
});

test('Kette: Zeitlimit pro Team, fehlende Wörter zählen als verschieden', () => {
  const now = clock();
  const e = writeGame({ mode: 'kette', seconds: 15 }, { rot: ['a', 'b'] }, now);
  submit(e, 'a', 'Sonne');
  now.add(16000);
  assert.ok(e.tick());
  const ch = e.s.cur.chains.rot;
  assert.strictEqual(ch.steps.length, 1);
  assert.deepStrictEqual(ch.steps[0].words.map((w) => w.word), ['Sonne', '']);
  assert.ok(ch.timerEnd > now(), 'neue Zeit für die nächste Runde');
});

test('Kette: Laptop kann ein Team aufgeben lassen oder die Runde beenden', () => {
  const e = writeGame({ mode: 'kette' }, { rot: ['a', 'b'], blau: ['c', 'd'] });
  assert.ok(e.apply({ type: 'giveUp', team: 'rot' }, STAGE));
  assert.ok(e.s.cur.chains.rot.done);
  assert.strictEqual(e.s.phase, 'play');
  assert.ok(e.apply({ type: 'finishRound' }, STAGE));
  assert.strictEqual(e.s.phase, 'summary');
  assert.strictEqual(score(e, 'blau'), 0);
});

/* ---------- Ohne Handy ---------- */

console.log('Ohne Handy');

test('Ein Begriff ohne Handy: Teams nacheinander, jedes mit eigenem Begriff', () => {
  const e = sayGame({ mode: 'begriff', rounds: 5 }, { rot: ['Anna', 'Ben', 'Cem'], blau: ['Dora', 'Eli'] });
  assert.strictEqual(e.s.phase, 'play', 'startet sofort');
  assert.strictEqual(e.s.cur.team, e.s.order[0]);
  const first = e.s.cur.team;
  const second = e.s.order[1];
  const termA = e.s.cur.term.text;
  assert.ok(!e.apply({ type: 'sayResult', outcome: 'all' }, 'Anna'), 'nur am Laptop');
  assert.ok(e.apply({ type: 'sayResult', outcome: 'all' }, STAGE));
  assert.strictEqual(score(e, first), 3);
  assert.strictEqual(e.s.cur.team, second);
  assert.notStrictEqual(e.s.cur.term.text, termA, 'neuer Begriff');
  e.apply({ type: 'sayResult', outcome: 'some' }, STAGE);
  assert.strictEqual(score(e, second), 1);
  assert.strictEqual(e.s.phase, 'summary');
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.round, 2);
});

test('Ein Begriff ohne Handy: zweite Chance', () => {
  const e = sayGame({ mode: 'begriff', secondChance: true }, { rot: ['A', 'B'] });
  e.apply({ type: 'sayResult', outcome: 'none' }, STAGE);
  assert.strictEqual(e.s.cur.attempt, 2);
  assert.strictEqual(e.s.cur.team, 'rot');
  e.apply({ type: 'sayResult', outcome: 'all' }, STAGE);
  assert.strictEqual(score(e, 'rot'), 2);
});

test('Gedankenkette ohne Handy: Wörter eintragen erkennt Treffer automatisch', () => {
  const e = sayGame({ mode: 'kette' }, { rot: ['Anna', 'Ben'], blau: ['Dora', 'Eli', 'Finn'] });
  const first = e.s.cur.team;
  const n = e.s.cur.chains[first].players.length;
  const words = (w) => Array.from({ length: n }, () => w);
  const diff = ['Banane', 'Weltraum', 'Kakao'].slice(0, n);
  assert.ok(!e.apply({ type: 'sayStep', words: [] }, STAGE), 'ohne Wörter und ohne Urteil geht nicht');
  assert.ok(e.apply({ type: 'sayStep', words: diff }, STAGE));
  assert.strictEqual(e.s.cur.chains[first].steps.length, 1);
  assert.ok(e.apply({ type: 'sayStep', words: words('Laika') }, STAGE));
  assert.strictEqual(score(e, first), 4);
  assert.notStrictEqual(e.s.cur.team, first, 'nächstes Team ist dran');
});

test('Gedankenkette ohne Handy: Schnell-Knöpfe ohne Wörter', () => {
  const e = sayGame({ mode: 'kette' }, { rot: ['Anna', 'Ben'] });
  e.apply({ type: 'sayStep', verdict: 'diff' }, STAGE);
  e.apply({ type: 'sayStep', verdict: 'diff' }, STAGE);
  e.apply({ type: 'sayStep', verdict: 'same' }, STAGE);
  assert.strictEqual(e.s.cur.chains.rot.hit, 3);
  assert.strictEqual(score(e, 'rot'), 3);
  assert.strictEqual(e.s.phase, 'summary');
});

test('Gedankenkette ohne Handy: jedes Team bekommt eigene Startwörter', () => {
  const e = sayGame({ mode: 'kette', startWords: 'given' }, { rot: ['A', 'B'], blau: ['C', 'D'] });
  const first = e.s.cur.team;
  const startA = e.s.cur.chains[first].start;
  assert.strictEqual(startA.length, 2);
  e.apply({ type: 'sayStep', verdict: 'same' }, STAGE);
  const startB = e.s.cur.chains[e.s.cur.team].start;
  assert.strictEqual(startB.length, 2);
  assert.notDeepStrictEqual(startB, startA);
});

/* ---------- Spielende ---------- */

console.log('Spielende');

test('Gleichstand nach der letzten Runde: Stechen nur mit den Führenden', () => {
  const e = sayGame({ mode: 'begriff', rounds: 5 }, { rot: ['A', 'B'], blau: ['C', 'D'], gruen: ['E', 'F'] });
  const res = { rot: 'all', blau: 'all', gruen: 'none' };
  for (let r = 0; r < 5; r++) {
    while (e.s.phase === 'play') e.apply({ type: 'sayResult', outcome: res[e.s.cur.team] }, STAGE);
    e.apply({ type: 'next' }, STAGE);
  }
  assert.strictEqual(e.s.phase, 'play');
  assert.deepStrictEqual(e.s.tiebreak.slice().sort(), ['blau', 'rot']);
  assert.deepStrictEqual(e.s.cur.queue.slice().sort(), ['blau', 'rot']);
  assert.ok(e.s.cur.tiebreak);
  // Stechen: Rot trifft, Blau nicht
  while (e.s.phase === 'play') e.apply({ type: 'sayResult', outcome: e.s.cur.team === 'rot' ? 'all' : 'none' }, STAGE);
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.phase, 'over');
  assert.deepStrictEqual(e.s.winners, ['rot']);
  assert.deepStrictEqual(e.viewFor(STAGE).ranking, ['rot', 'blau', 'gruen']);
});

test('Spiel vorzeitig beenden und nochmal spielen', () => {
  const e = writeGame({ mode: 'begriff' }, { rot: ['a', 'b'], blau: ['c', 'd'] });
  submit(e, 'a', 'X');
  submit(e, 'b', 'X');
  submit(e, 'c', 'Y');
  submit(e, 'd', 'Z');
  assert.ok(e.apply({ type: 'end' }, STAGE));
  assert.strictEqual(e.s.phase, 'over');
  assert.deepStrictEqual(e.s.winners, ['rot']);
  assert.ok(e.apply({ type: 'again' }, STAGE));
  assert.strictEqual(e.s.phase, 'lobby', 'mit Handy zurück in die Lobby');
  assert.strictEqual(score(e, 'rot'), 0);
  assert.strictEqual(e.team('rot').players.length, 2, 'Teams bleiben');
});

test('Auszeichnungen: Seelenverwandte, Gedankenleser', () => {
  const e = writeGame({ mode: 'kette', rounds: 3 }, { rot: ['a', 'b'] });
  for (let r = 0; r < 3; r++) {
    submit(e, 'a', 'Laika' + r);
    submit(e, 'b', 'Laika' + r);
    e.apply({ type: 'next' }, STAGE);
  }
  assert.strictEqual(e.s.phase, 'over');
  const titles = e.s.awards.map((a) => a.title);
  assert.ok(titles.includes('Seelenverwandte'), titles.join(','));
  assert.ok(titles.includes('Gedankenleser'));
  assert.match(e.s.awards.find((a) => a.title === 'Seelenverwandte').text, /A & B – 3×/);
});

test('Spielstand übersteht Neuladen (Zustand ist reines JSON)', () => {
  const e = writeGame({ mode: 'kette' }, { rot: ['a', 'b'] });
  submit(e, 'a', 'Hund');
  const copy = JSON.parse(JSON.stringify(e.s));
  const e2 = new Engine(copy, { timers: false });
  e2.setAllOffline();
  e2.connect('a', 'A');
  e2.connect('b', 'B');
  assert.strictEqual(e2.viewFor('a').cur.myWord, 'Hund');
  submit(e2, 'b', 'Hund');
  assert.strictEqual(e2.s.cur.chains.rot.hit, 1);
});

console.log(`\n✓ ${passed} Tests bestanden`);
