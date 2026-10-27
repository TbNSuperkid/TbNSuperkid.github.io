'use strict';
/* Tests für „Nur einer“ (ohne Browser): node tests/nur-einer.test.js */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'shared', 'match.js'));
require(path.join(ROOT, 'guess-the-word', 'js', 'words', 'erklaeren.js'));
require(path.join(ROOT, 'imposter', 'js', 'words', 'woerter.js'));
for (const f of ['woerter', 'words', 'clues', 'engine']) require(path.join(ROOT, 'nur-einer', 'js', f + '.js'));
const C = globalThis.NEClues;
const Words = globalThis.NEWords;
const { Engine, STAGE, GRACE_MS, MAX_FAILS, sanitizeSettings, rating } = globalThis.NEEngine;

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

/** Wort der laufenden Karte festlegen */
function setWord(e, word) {
  e.s.cur.word = { key: Words.key(word), word, level: 1, src: 'test' };
}

/** Spiel mit Handys: Lobby, Spieler verbinden, starten */
function phoneGame(settings, pids, now, teams) {
  const state = Engine.create({ settings: Object.assign({ input: 'phones', timer: 0 }, settings) });
  const e = new Engine(state, { timers: false, now: now || clock() });
  for (const pid of pids) e.connect(pid, pid.toUpperCase());
  if (teams) for (const [pid, team] of Object.entries(teams)) e.apply({ type: 'joinTeam', team }, pid);
  assert.ok(e.apply({ type: 'start' }, STAGE), 'start');
  setWord(e, 'Sonne');
  return e;
}

/** Alle Hinweisgebenden schreiben (texts: pid -> Hinweis oder [Hinweise]) */
function write(e, texts) {
  for (const [pid, t] of Object.entries(texts)) {
    assert.ok(e.apply({ type: 'clue', texts: Array.isArray(t) ? t : [t] }, pid), 'clue ' + pid);
  }
}

function writers(e) {
  return e.s.cur.writers;
}

/** Karte durchspielen: alle schreiben verschiedene Hinweise, Kontrolle, dann Ergebnis */
function playCard(e, result) {
  const texts = {};
  writers(e).forEach((pid, i) => (texts[pid] = Array.from({ length: e.s.cur.per }, (_, k) => 'Hinweis' + 'abcdefghijklmnop'[i * 2 + k])));
  write(e, texts);
  assert.strictEqual(e.s.phase, 'check');
  assert.ok(e.apply({ type: 'release' }, STAGE));
  assert.ok(e.apply({ type: 'judge', result }, STAGE));
  assert.strictEqual(e.s.phase, 'reveal');
  assert.ok(e.apply({ type: 'next' }, STAGE));
}

/* ---------- Hinweise prüfen ---------- */

console.log('Hinweise prüfen');

test('gleiches Wort, Plural, Tippfehler und Groß/klein → doppelt', () => {
  const r = C.check(['Strand', 'strand', 'Sommer', 'Sommers', 'Urlaub', 'Urlaup', 'Creme'], 'Sonne');
  assert.deepStrictEqual(r.verdicts, ['dupe', 'dupe', 'dupe', 'dupe', 'dupe', 'dupe', 'ok']);
  assert.ok(C.alike('Strände', 'Strand'));
  assert.ok(C.alike('heiß', 'heiss'));
  assert.ok(C.alike('Strnd', 'Strand'), 'Tippfehler ab 5 Buchstaben');
});

test('Synonyme und ähnlich klingende Wörter sind nicht doppelt', () => {
  assert.ok(!C.alike('Auto', 'Wagen'));
  assert.ok(!C.alike('Hase', 'Hass'));
  assert.ok(!C.alike('Kerzen', 'Herzen'));
  assert.deepStrictEqual(C.check(['Auto', 'Wagen'], 'Garage').verdicts, ['ok', 'ok']);
});

test('ungültig gegen das Lösungswort: Sonne / sonnig / Sonnenbrille / Sun', () => {
  assert.strictEqual(C.invalid('Sonne', 'Sonne'), 'same');
  assert.strictEqual(C.invalid('die Sonnen', 'Sonne'), 'same');
  assert.strictEqual(C.invalid('sonnig', 'Sonne'), 'stem');
  assert.strictEqual(C.invalid('Sonnenbrille', 'Sonne'), 'contains');
  assert.strictEqual(C.invalid('Sun', 'Sonne'), 'translation');
  assert.strictEqual(C.invalid('Brille', 'Sonnenbrille'), 'inside');
  assert.strictEqual(C.invalid('Nacht', 'Weihnachten'), 'inside');
  assert.strictEqual(C.invalid('Löwe', 'Der König der Löwen'), 'same');
});

test('Übersetzung nur aus der Liste – sonst gültig (Einspruch)', () => {
  assert.strictEqual(C.invalid('Moon', 'Mond'), 'translation');
  assert.strictEqual(C.invalid('Soleado', 'Sonne'), null);
});

test('zwei Wörter sind ungültig, Artikel und Bindestrich nicht', () => {
  assert.strictEqual(C.invalid('heißer Stern', 'Sonne'), 'words');
  assert.strictEqual(C.invalid('der Strand', 'Sonne'), null);
  assert.strictEqual(C.invalid('Sonnen-Creme', 'Sonne'), 'contains');
  assert.strictEqual(C.invalid('E-Mail', 'Brief'), null);
});

test('Zahlen als Ziffern sind ok, Füllwörter zählen nicht als Teil', () => {
  assert.strictEqual(C.invalid('7', 'Zwerg'), null);
  assert.strictEqual(C.invalid('Thron', 'Der König der Löwen'), null);
});

test('ungültig geht vor doppelt, Doppelte werden alle gestrichen', () => {
  const r = C.check(['sonnig', 'sonnig', 'Strand'], 'Sonne');
  assert.deepStrictEqual(r.verdicts, ['invalid', 'invalid', 'ok']);
  assert.deepStrictEqual(r.groups[0], [0, 1]);
});

test('Antwort prüfen: „die Sonne“ = Sonne, Plural, Tippfehler', () => {
  assert.ok(C.correct('die Sonne', 'Sonne'));
  assert.ok(C.correct('Sonnen', 'Sonne'));
  assert.ok(C.correct('Schmeterling', 'Schmetterling'));
  assert.ok(!C.correct('Mond', 'Sonne'));
  assert.ok(!C.correct('', 'Sonne'));
});

/* ---------- Wörter ---------- */

console.log('Wörter');

test('mindestens 800 Wörter, keine Doppelten über alle Quellen', () => {
  const all = Words.all();
  assert.ok(all.length >= 800, `nur ${all.length} Wörter`);
  const keys = new Set(all.map((e) => e.key));
  assert.strictEqual(keys.size, all.length);
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      assert.ok(!globalThis.GameMatch.same(all[i].word, all[j].word) || all[i].level !== all[j].level, `doppelt: ${all[i].word} / ${all[j].word}`);
    }
  }
  const st = Words.stats();
  for (const lv of [1, 2, 3]) assert.ok(st[lv] >= 100, `Stufe ${lv}: nur ${st[lv]}`);
});

test('eigene Liste ohne Doppelte, alle drei Quellen dabei', () => {
  const own = Words.sources().filter((e) => e.src === 'eigene');
  const keys = own.map((e) => Words.key(e.word));
  assert.strictEqual(new Set(keys).size, keys.length, 'Doppelte in js/woerter.js');
  const srcs = new Set(Words.all().map((e) => e.src));
  for (const s of ['eigene', 'guess-the-word', 'imposter']) assert.ok(srcs.has(s), s);
  assert.ok(!Words.all().some((e) => /:in$/.test(e.word)));
  assert.strictEqual(Words.ungender('Ärzt:in'), 'Arzt');
  assert.strictEqual(Words.ungender('Pilot:in'), 'Pilot');
});

test('Ziehen ohne Wiederholung und nach Schwierigkeit', () => {
  const used = [];
  for (let i = 0; i < 50; i++) {
    const w = Words.draw('easy', used);
    assert.strictEqual(w.level, 1);
  }
  assert.strictEqual(new Set(used).size, 50);
  assert.ok([2, 3].includes(Words.draw('hard', []).level));
});

/* ---------- Einstellungen ---------- */

console.log('Einstellungen');

test('Einstellungen werden bereinigt', () => {
  const s = sanitizeSettings({ input: 'one', guess: 'type', cards: 7, timer: 45, level: 'xx', versus: true });
  assert.strictEqual(s.input, 'one');
  assert.strictEqual(s.guess, 'voice', 'tippen geht nur mit Handys');
  assert.strictEqual(s.cards, 13);
  assert.strictEqual(s.timer, 60);
  assert.strictEqual(s.level, 'mixed');
  assert.strictEqual(sanitizeSettings({ cards: 0 }).cards, 0);
  assert.strictEqual(sanitizeSettings({ cards: 0, versus: true }).cards, 13, 'Wettkampf nicht endlos');
});

test('Wertung nach Karten', () => {
  assert.strictEqual(rating(13, 13).icon, '🏆');
  assert.strictEqual(rating(8, 13).text, 'Guter Durchschnitt');
  assert.strictEqual(rating(2, 13).icon, '😅');
  assert.strictEqual(rating(20, 20).icon, '🏆');
});

/* ---------- Ablauf mit Handys ---------- */

console.log('Mit Handys');

test('Lobby: mindestens 3 Personen', () => {
  const state = Engine.create({ settings: { input: 'phones' } });
  const e = new Engine(state, { timers: false, now: clock() });
  e.connect('a', 'Anna');
  e.connect('b', 'Ben');
  assert.ok(e.lobbyProblem());
  assert.ok(!e.apply({ type: 'start' }, STAGE));
  e.connect('c', 'Cem');
  assert.strictEqual(e.lobbyProblem(), null);
  assert.ok(e.apply({ type: 'start' }, STAGE));
  assert.strictEqual(e.s.phase, 'write');
});

test('Reihum: ratende Person schreibt nie, Abgemeldete werden übersprungen', () => {
  const now = clock();
  const e = phoneGame({}, ['a', 'b', 'c', 'd'], now);
  assert.strictEqual(e.s.cur.guesser, 'a');
  assert.deepStrictEqual(writers(e), ['b', 'c', 'd']);
  assert.ok(!e.apply({ type: 'clue', texts: ['Strand'] }, 'a'), 'ratende Person darf nicht schreiben');
  playCard(e, 'won');
  assert.strictEqual(e.s.cur.guesser, 'b');
  assert.ok(!writers(e).includes('b'));
  e.disconnect('c');
  playCard(e, 'won');
  assert.strictEqual(e.s.cur.guesser, 'd', 'c ist weg und wird übersprungen');
});

test('Hinweise → Kontrolle → Raten → Auflösung', () => {
  const e = phoneGame({}, ['a', 'b', 'c', 'd', 'e'], clock());
  write(e, { b: 'Strand', c: 'Strand', d: 'Sommer' });
  assert.strictEqual(e.s.phase, 'write', 'e fehlt noch');
  write(e, { e: 'sonnig' });
  assert.strictEqual(e.s.phase, 'check');
  const byText = (t) => e.s.cur.list.filter((x) => x.text === t);
  assert.ok(byText('Strand').every((x) => x.out && x.reason === 'dupe'));
  assert.strictEqual(byText('sonnig')[0].reason, 'stem');
  assert.ok(!byText('Sommer')[0].out);
  // Einspruch und Entscheidung
  const sonnig = byText('sonnig')[0];
  assert.ok(e.apply({ type: 'objection', id: sonnig.id }, 'b'));
  assert.deepStrictEqual(e.s.cur.objections[sonnig.id], ['b']);
  assert.ok(!e.apply({ type: 'verdict', id: sonnig.id }, 'a'), 'ratende Person entscheidet nicht');
  assert.ok(e.apply({ type: 'verdict', id: sonnig.id }, STAGE));
  assert.strictEqual(sonnig.out, false);
  assert.ok(e.apply({ type: 'ready' }, 'c'));
  assert.ok(e.apply({ type: 'release' }, STAGE));
  assert.strictEqual(e.s.phase, 'guess');
  assert.deepStrictEqual(e.viewFor('a').cur.valid.sort(), ['Sommer', 'sonnig']);
  assert.ok(e.apply({ type: 'judge', result: 'won' }, STAGE));
  assert.strictEqual(e.s.stacks[0].won, 1);
  assert.strictEqual(e.viewFor('a').cur.word, 'Sonne');
  assert.strictEqual(e.viewFor('a').cur.clues.length, 4, 'nach dem Raten sieht man auch die gestrichenen');
});

test('3 Personen: 2 Hinweise pro Person, doppelt auch innerhalb einer Person', () => {
  const e = phoneGame({}, ['a', 'b', 'c'], clock());
  assert.strictEqual(e.s.cur.per, 2);
  assert.ok(!e.apply({ type: 'clue', texts: ['Strand'] }, 'b'), 'braucht 2 Hinweise');
  write(e, { b: ['Strand', 'Strände'], c: ['Sommer', 'gelb'] });
  assert.strictEqual(e.s.phase, 'check');
  const out = e.s.cur.list.filter((x) => x.out).map((x) => x.text);
  assert.deepStrictEqual(out.sort(), ['Strand', 'Strände']);
});

test('Große Runde: ab 8 Personen schreibt abwechselnd nur die Hälfte', () => {
  const pids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  const e = phoneGame({}, pids, clock());
  const first = writers(e).slice();
  assert.ok(first.length >= 4 && first.length <= 6, `${first.length} Hinweisgebende`);
  assert.strictEqual(first.length + e.s.cur.resting.length, 8);
  playCard(e, 'won');
  const second = writers(e);
  assert.ok(second.length >= 4 && second.length <= 6);
  assert.ok(second.some((p) => !first.includes(p)), 'andere Gruppe');
  // ohne Teilen schreiben alle
  const e2 = phoneGame({ split: false }, pids, clock());
  assert.strictEqual(writers(e2).length, 8);
});

test('Gefilterte Ansicht: ratende Person kennt Wort und Hinweise nicht vor dem Raten', () => {
  const e = phoneGame({}, ['a', 'b', 'c', 'd'], clock());
  const leak = (pid) => JSON.stringify(e.viewFor(pid)).includes('Sonne');
  assert.ok(!leak('a'));
  assert.ok(!leak(STAGE), 'der Laptop zeigt das Wort mit Handys nicht');
  assert.ok(leak('b'));
  write(e, { b: 'Strand', c: 'Bikini', d: 'Sommer' });
  const va = e.viewFor('a');
  assert.strictEqual(va.cur.word, null);
  assert.strictEqual(va.cur.clues, null);
  assert.strictEqual(va.cur.valid, null);
  assert.ok(!JSON.stringify(va).includes('Bikini'));
  assert.ok(!JSON.stringify(e.viewFor(STAGE)).includes('Bikini'), 'Laptop zeigt die Hinweise erst, wenn a wegschaut');
  assert.ok(!e.apply({ type: 'away' }, 'b'), 'nur die ratende Person bestätigt');
  assert.ok(e.apply({ type: 'away' }, 'a'));
  assert.ok(JSON.stringify(e.viewFor(STAGE)).includes('Bikini'));
  assert.ok(!JSON.stringify(e.viewFor('a')).includes('Bikini'));
  e.s.cur.list.find((x) => x.text === 'Bikini').out = true;
  e.apply({ type: 'release' }, STAGE);
  const g = e.viewFor('a');
  assert.ok(!JSON.stringify(g).includes('Bikini'), 'gestrichene sieht sie auch beim Raten nicht');
  assert.ok(!JSON.stringify(e.viewFor(STAGE)).includes('Bikini'));
  assert.deepStrictEqual(g.cur.valid.sort(), ['Sommer', 'Strand']);
  assert.ok(!JSON.stringify(g).includes('Sonne'));
});

test('Wertung: richtig +1, falsch kostet 2 Karten, passen kostet 1', () => {
  const e = phoneGame({}, ['a', 'b', 'c', 'd'], clock());
  const st = e.s.stacks[0];
  assert.strictEqual(st.deck, 12);
  playCard(e, 'won');
  assert.deepStrictEqual([st.won, st.lost, st.deck], [1, 0, 11]);
  playCard(e, 'lost');
  assert.deepStrictEqual([st.won, st.lost, st.deck], [1, 2, 9]);
  playCard(e, 'pass');
  assert.deepStrictEqual([st.won, st.lost, st.deck], [1, 3, 8]);
  // bis zum Ende: 13 Karten insgesamt
  while (e.s.phase !== 'over') playCard(e, 'won');
  assert.strictEqual(st.won + st.lost, 13);
});

test('falsch bei der letzten Karte kostet eine gewonnene Karte', () => {
  const e = phoneGame({}, ['a', 'b', 'c'], clock());
  const st = e.s.stacks[0];
  for (let i = 0; i < 12; i++) playCard(e, 'won');
  assert.strictEqual(st.deck, 0);
  playCard(e, 'lost');
  assert.strictEqual(e.s.phase, 'over');
  assert.deepStrictEqual([st.won, st.lost], [11, 2]);
  assert.strictEqual(e.s.history[12].result, 'lost');
});

test('falsch, wenn nur noch 1 Karte im Stapel ist: beide weg', () => {
  const e = phoneGame({}, ['a', 'b', 'c'], clock());
  const st = e.s.stacks[0];
  for (let i = 0; i < 11; i++) playCard(e, 'won');
  assert.strictEqual(st.deck, 1);
  playCard(e, 'lost');
  assert.strictEqual(e.s.phase, 'over');
  assert.deepStrictEqual([st.won, st.lost], [11, 2]);
});

test('Endlos: bis 3 Fehler, passen ist kein Fehler', () => {
  const e = phoneGame({ cards: 0 }, ['a', 'b', 'c'], clock());
  const st = e.s.stacks[0];
  for (let i = 0; i < 20; i++) playCard(e, i % 2 ? 'pass' : 'won');
  assert.strictEqual(e.s.phase, 'write');
  playCard(e, 'lost');
  playCard(e, 'lost');
  assert.strictEqual(e.s.phase, 'write');
  playCard(e, 'lost');
  assert.strictEqual(e.s.phase, 'over');
  assert.strictEqual(st.fails, MAX_FAILS);
  assert.strictEqual(st.won, 10);
});

test('Tippen: App prüft, „zählt doch“ macht es rückgängig', () => {
  const e = phoneGame({ guess: 'type' }, ['a', 'b', 'c', 'd'], clock());
  write(e, { b: 'Strand', c: 'Bikini', d: 'Sommer' });
  e.apply({ type: 'release' }, STAGE);
  assert.ok(!e.apply({ type: 'guess', text: 'Sonne' }, 'b'), 'nur die ratende Person');
  assert.ok(e.apply({ type: 'guess', text: 'Sonnenschein' }, 'a'));
  const st = e.s.stacks[0];
  assert.strictEqual(e.s.cur.result, 'lost');
  assert.deepStrictEqual([st.won, st.lost, st.deck], [0, 2, 11]);
  assert.ok(e.apply({ type: 'accept' }, STAGE));
  assert.strictEqual(e.s.cur.result, 'won');
  assert.deepStrictEqual([st.won, st.lost, st.deck], [1, 0, 12]);
  assert.ok(e.apply({ type: 'accept' }, STAGE), 'nochmal = zurücknehmen');
  assert.deepStrictEqual([st.won, st.lost, st.deck], [0, 2, 11]);
});

test('Tippen: richtige Antwort mit Artikel', () => {
  const e = phoneGame({ guess: 'type' }, ['a', 'b', 'c', 'd'], clock());
  write(e, { b: 'Strand', c: 'Bikini', d: 'Sommer' });
  e.apply({ type: 'release' }, STAGE);
  assert.ok(e.apply({ type: 'guess', text: 'die Sonne' }, 'a'));
  assert.strictEqual(e.s.cur.result, 'won');
});

test('Passen am Handy der ratenden Person', () => {
  const e = phoneGame({}, ['a', 'b', 'c', 'd'], clock());
  write(e, { b: 'Strand', c: 'Bikini', d: 'Sommer' });
  e.apply({ type: 'release' }, STAGE);
  assert.ok(!e.apply({ type: 'pass' }, 'b'));
  assert.ok(e.apply({ type: 'pass' }, 'a'));
  assert.strictEqual(e.s.cur.result, 'pass');
});

test('„Kenn ich nicht“: neues Wort, Hinweise zurückgesetzt, alte Eingaben verfallen', () => {
  const e = phoneGame({}, ['a', 'b', 'c', 'd'], clock());
  const key = e.stepKey();
  write(e, { b: 'Strand' });
  assert.ok(!e.apply({ type: 'skip' }, 'a'), 'ratende Person kennt das Wort nicht');
  assert.ok(e.apply({ type: 'skip', at: key }, 'c'));
  assert.notStrictEqual(e.s.cur.word.word, 'Sonne');
  assert.deepStrictEqual(e.s.cur.clues, {});
  assert.ok(!e.apply({ type: 'clue', texts: ['Strand'], at: key }, 'b'), 'Hinweis zum alten Wort');
  assert.strictEqual(e.s.stacks[0].deck, 12, 'kostet keine Karte');
});

test('Eigenes Wort nur mit Einstellung und nur für die Spielleitung', () => {
  const e = phoneGame({}, ['a', 'b', 'c', 'd'], clock());
  assert.ok(!e.apply({ type: 'customWord', word: 'Kaktus' }, STAGE));
  const e2 = phoneGame({ custom: true }, ['a', 'b', 'c', 'd'], clock());
  assert.ok(!e2.apply({ type: 'customWord', word: 'Kaktus' }, 'c'), 'c ist nicht die Spielleitung');
  assert.ok(e2.apply({ type: 'customWord', word: 'Kaktus' }, 'b'), 'b ist die Spielleitung (a rät)');
  assert.strictEqual(e2.s.cur.word.word, 'Kaktus');
  assert.ok(!JSON.stringify(e2.viewFor('a')).includes('Kaktus'));
});

test('Zeitlimit: nach Ablauf wird mit den vorhandenen Hinweisen verglichen', () => {
  const now = clock();
  const e = phoneGame({ timer: 30 }, ['a', 'b', 'c', 'd'], now);
  write(e, { b: 'Strand' });
  now.add(29000);
  assert.ok(!e.tick());
  now.add(2000);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'check');
  assert.strictEqual(e.s.cur.list.length, 1);
});

test('Verbindung weg: nach der Schonfrist wird nicht mehr gewartet', () => {
  const now = clock();
  const e = phoneGame({}, ['a', 'b', 'c', 'd'], now);
  write(e, { b: 'Strand', c: 'Bikini' });
  e.disconnect('d');
  assert.strictEqual(e.s.phase, 'write');
  now.add(GRACE_MS + 10);
  e.tick();
  assert.strictEqual(e.s.phase, 'check');
});

test('Wiederverbinden mitten in der Runde behält die Hinweise', () => {
  const now = clock();
  const e = phoneGame({}, ['a', 'b', 'c', 'd'], now);
  write(e, { b: 'Strand' });
  e.disconnect('b');
  now.add(3000);
  e.connect('b', 'B');
  assert.deepStrictEqual(e.viewFor('b').cur.mine, ['Strand']);
  assert.strictEqual(e.s.players.length, 4);
});

test('Neue Leute spielen ab der nächsten Karte mit', () => {
  const e = phoneGame({}, ['a', 'b', 'c'], clock());
  e.connect('d', 'Dora');
  assert.ok(!writers(e).includes('d'));
  assert.ok(!e.apply({ type: 'clue', texts: ['Strand', 'Meer'] }, 'd'));
  playCard(e, 'won');
  assert.ok(writers(e).includes('d'));
});

test('Ratende Person entfernt: Karte beginnt neu, ohne Wertung', () => {
  const e = phoneGame({}, ['a', 'b', 'c', 'd'], clock());
  assert.ok(e.apply({ type: 'kick', player: 'a' }, STAGE));
  assert.notStrictEqual(e.s.cur.guesser, 'a');
  assert.strictEqual(e.s.phase, 'write');
  assert.strictEqual(e.s.stacks[0].lost, 0);
});

test('Spielleitung am Handy: erstes Handy, nie die ratende Person', () => {
  const e = phoneGame({}, ['a', 'b', 'c', 'd'], clock());
  assert.strictEqual(e.leadPid(), 'b');
  write(e, { b: 'Strand', c: 'Bikini', d: 'Sommer' });
  assert.ok(e.apply({ type: 'release' }, 'b'));
  assert.ok(!e.apply({ type: 'judge', result: 'won' }, 'a'));
  assert.ok(e.apply({ type: 'judge', result: 'won' }, 'b'));
  assert.ok(e.apply({ type: 'next' }, 'b'));
});

test('Wettkampf: zwei Teams mit eigenem Stapel, abwechselnd', () => {
  const e = phoneGame({ versus: true }, ['a', 'b', 'c', 'd', 'e', 'f'], clock(), { a: 'rot', b: 'blau', c: 'rot', d: 'blau', e: 'rot', f: 'blau' });
  assert.strictEqual(e.s.stacks.length, 2);
  assert.strictEqual(e.s.stacks[0].size, 7);
  assert.strictEqual(e.s.cur.guesser, 'a');
  assert.deepStrictEqual(writers(e), ['c', 'e'], 'nur das eigene Team schreibt');
  playCard(e, 'won');
  assert.strictEqual(e.s.stacks[e.s.cur.stack].team, 'blau');
  assert.strictEqual(e.s.cur.guesser, 'b');
  assert.deepStrictEqual(writers(e), ['d', 'f']);
  playCard(e, 'lost');
  assert.strictEqual(e.s.cur.guesser, 'c');
  while (e.s.phase !== 'over') playCard(e, 'won');
  assert.strictEqual(e.s.stacks[0].won, 7);
  assert.strictEqual(e.s.stacks[1].won + e.s.stacks[1].lost, 7);
});

test('Wettkampf: jedes Team braucht 2 Personen', () => {
  const state = Engine.create({ settings: { input: 'phones', versus: true } });
  const e = new Engine(state, { timers: false, now: clock() });
  for (const p of ['a', 'b', 'c']) e.connect(p, p);
  e.apply({ type: 'joinTeam', team: 'rot' }, 'b');
  assert.ok(e.lobbyProblem());
  e.connect('d', 'd');
  e.apply({ type: 'joinTeam', team: 'blau' }, 'd');
  e.apply({ type: 'joinTeam', team: 'blau' }, 'c');
  assert.strictEqual(e.lobbyProblem(), null);
});

test('Statistik: Einzigartig, Seelenverwandte, Bester Hinweis', () => {
  const e = phoneGame({}, ['a', 'b', 'c', 'd'], clock());
  const card = (texts, result) => {
    write(e, texts);
    e.apply({ type: 'release' }, STAGE);
    e.apply({ type: 'judge', result }, STAGE);
    e.apply({ type: 'next' }, STAGE);
  };
  const w = () => writers(e);
  // Karte 1: a rät, b+c doppelt
  card({ b: 'Strand', c: 'Strand', d: 'Hitze' }, 'won');
  // Karte 2: b rät
  setWord(e, 'Hund');
  card({ a: 'Eins', c: 'Zwei', d: 'Drei' }, 'won');
  // Karte 3: c rät, b+d doppelt
  setWord(e, 'Mond');
  card({ a: 'Nacht', b: 'Sterne', d: 'Stern' }, 'won');
  // Karte 4: d rät, b+c doppelt (nicht erraten)
  setWord(e, 'Tasse');
  card({ a: 'Vier', b: 'Kaffee', c: 'Kaffee' }, 'lost');
  assert.deepStrictEqual(w().length, 3);
  e.apply({ type: 'end' }, STAGE);
  const titles = e.s.awards.map((x) => x.title);
  assert.ok(titles.includes('Einzigartig'), titles.join());
  const soul = e.s.awards.find((x) => x.title === 'Seelenverwandte');
  assert.ok(soul && soul.text.startsWith('B & C'), soul && soul.text);
  const best = e.s.awards.find((x) => x.title === 'Bester Hinweis');
  assert.ok(best && best.text.includes('Nacht'), best && best.text);
  const st = e.playerStats();
  assert.strictEqual(st.b.dupes, 3);
  assert.strictEqual(st.a.dupes, 0);
});

test('Spiel beenden: laufende Karte zählt nicht', () => {
  const e = phoneGame({}, ['a', 'b', 'c'], clock());
  playCard(e, 'won');
  e.apply({ type: 'end' }, STAGE);
  assert.strictEqual(e.s.phase, 'over');
  assert.deepStrictEqual([e.s.stacks[0].won, e.s.stacks[0].played], [1, 1]);
});

test('Nochmal: zurück in die Lobby mit denselben Leuten', () => {
  const e = phoneGame({}, ['a', 'b', 'c'], clock());
  e.apply({ type: 'end' }, STAGE);
  assert.ok(e.apply({ type: 'again' }, STAGE));
  assert.strictEqual(e.s.phase, 'lobby');
  assert.strictEqual(e.s.players.length, 3);
});

/* ---------- Ein Gerät ---------- */

console.log('Ein Gerät');

test('Ein Gerät: Wort zeigen → raten → auflösen', () => {
  const state = Engine.create({ settings: { input: 'one' }, players: ['Anna', 'Ben', 'Cem'] });
  const e = new Engine(state, { timers: false });
  assert.strictEqual(e.s.phase, 'word');
  assert.strictEqual(e.s.cur.guesser, 'p1');
  assert.ok(e.viewFor(STAGE).cur.word, 'Laptop zeigt das Wort (Anna schaut weg)');
  assert.ok(e.apply({ type: 'skip' }, STAGE));
  assert.ok(e.apply({ type: 'written' }, STAGE));
  assert.strictEqual(e.s.phase, 'guess');
  assert.strictEqual(e.viewFor(STAGE).cur.word, null, 'beim Raten ist das Wort weg');
  assert.ok(e.apply({ type: 'judge', result: 'lost' }, STAGE));
  assert.strictEqual(e.s.stacks[0].lost, 2);
  assert.ok(e.apply({ type: 'rejudge', result: 'won' }, STAGE), 'falsch geklickt');
  assert.deepStrictEqual([e.s.stacks[0].won, e.s.stacks[0].lost, e.s.stacks[0].deck], [1, 0, 12]);
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.strictEqual(e.s.cur.guesser, 'p2');
});

test('Ein Gerät, Wettkampf: Namen abwechselnd auf die Teams verteilt', () => {
  const state = Engine.create({ settings: { input: 'one', versus: true }, players: ['A', 'B', 'C', 'D'] });
  const e = new Engine(state, { timers: false });
  assert.deepStrictEqual(
    e.s.players.map((p) => p.team),
    ['rot', 'blau', 'rot', 'blau']
  );
  assert.strictEqual(e.s.cur.guesser, 'p1');
  e.apply({ type: 'written' }, STAGE);
  e.apply({ type: 'judge', result: 'won' }, STAGE);
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.cur.guesser, 'p2');
});

console.log(`\n${passed} Tests bestanden.`);
