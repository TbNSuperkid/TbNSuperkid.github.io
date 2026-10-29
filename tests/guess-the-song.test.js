'use strict';
/* Tests für „Guess the song“ (ohne Browser, ohne Ton): node tests/guess-the-song.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

globalThis.window = globalThis;
const SONG_DIR = path.join(__dirname, '..', 'shared', 'songs');
for (const f of fs.readdirSync(SONG_DIR).filter((f) => f.endsWith('.js'))) require(path.join(SONG_DIR, f));
for (const f of ['songs', 'match', 'titles']) require(path.join(__dirname, '..', 'shared', f + '.js'));
require(path.join(__dirname, '..', 'guess-the-song', 'js', 'engine.js'));
require(path.join(__dirname, '..', 'shared', 'snippet.js'));

const E = globalThis.GTSEngine;
const { Engine, STAGE, GUESS_MS, HUM_MS, MAX_TRIES, FIRST_BONUS, HUM_FIRST, HUM_MORE, HUM_HUMMER, SIPS_NOBODY, SIPS_GIVE, MAX_TIEBREAKS, MIN_POOL, MAX_OFFSET, RESUME_MIN_MS, sanitizeSettings, stepPoints, stepSecs, artistPoints, judgeGuess, hintFor } = E;

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

/** Reproduzierbarer Zufall (mulberry32) */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clock(start) {
  let t = start || 1000000;
  const now = () => t;
  now.add = (ms) => (t += ms);
  return now;
}

/** Handys: Lobby, alle verbinden, starten */
function phones(settings, pids, opts) {
  const o = opts || {};
  const now = clock();
  const hooks = Object.assign({ random: seeded(o.seed || 5), timers: false, now, used: [] }, o.hooks);
  const state = Engine.create({ settings: Object.assign({ input: 'phones' }, settings) }, hooks);
  const e = new Engine(state, hooks);
  for (const pid of pids || ['a', 'b', 'c']) {
    e.connect(pid, pid.toUpperCase());
    now.add(10);
  }
  e.clock = now;
  if (o.start !== false) assert.ok(e.apply({ type: 'start' }, STAGE), 'Start: ' + e.lobbyProblem());
  return e;
}

/** Ein Gerät: Spiel läuft sofort */
function one(settings, names, opts) {
  const o = opts || {};
  const now = clock();
  const hooks = Object.assign({ random: seeded(o.seed || 3), timers: false, now, used: [] }, o.hooks);
  const state = Engine.create({ settings: Object.assign({ input: 'one' }, settings), players: names || ['Anna', 'Ben', 'Cem'] }, hooks);
  const e = new Engine(state, hooks);
  e.clock = now;
  return e;
}

const title = (e) => e.s.cur.song.title;
const ti = (e, pid) => e.teamOf(pid);
const res = (e, pid) => e.s.cur.res[ti(e, pid)];

/** Ausschnitt: Stufe zu Ende hören, Ratezeit ablaufen lassen → nächste Stufe */
function nextStep(e) {
  assert.ok(e.apply({ type: 'heard', playId: e.s.cur.playId }, STAGE));
  e.clock.add(GUESS_MS + 1);
  assert.ok(e.tick());
}

/** Eine falsche Antwort, die sicher weder Titel noch Interpret ist */
const WRONG = 'Xylophonzzz Quark';

/** Ein Summen-Song: Summer/in wählt den ersten Vorschlag */
function pickFirst(e) {
  assert.strictEqual(e.s.phase, 'pick');
  const h = e.s.cur.hummer;
  assert.ok(e.apply({ type: 'pick', id: e.s.cur.options[0].id }, h));
  return h;
}

console.log('Guess the song');

/* ---------- Grundlagen ---------- */

test('Einstellungen werden bereinigt, ein Gerät = Buzzer ohne Teams', () => {
  const s = sanitizeSettings({ mode: 'quatsch', count: 99, steps: 'x', artist: 'y', teams: 3, guess: 'type', input: 'one' });
  assert.strictEqual(s.mode, 'snip');
  assert.strictEqual(s.count, 15);
  assert.strictEqual(s.steps, 'classic');
  assert.strictEqual(s.artist, 'half');
  assert.strictEqual(s.teams, 0);
  assert.strictEqual(s.guess, 'buzz');
  const p = sanitizeSettings({ input: 'phones', teams: 3, guess: 'buzz', count: 20, hum: 'knock' });
  assert.strictEqual(p.teams, 3);
  assert.strictEqual(p.guess, 'buzz');
  assert.strictEqual(p.count, 20);
  assert.strictEqual(p.hum, 'knock');
  // Standard laut Planung: tippen, 15 Songs, Interpret halb, Refrain
  const d = sanitizeSettings({});
  assert.deepStrictEqual([d.guess, d.count, d.artist, d.start, d.steps, d.mode], ['type', 15, 'half', 'chorus', 'classic', 'snip']);
});

test('Punkte je Stufe und Stufenlängen (auch ab zufälliger Startstelle)', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map((i) => stepPoints('classic', i)), [6, 5, 4, 3, 2, 1]);
  assert.deepStrictEqual([0, 1, 2, 3].map((i) => stepPoints('easy', i)), [4, 3, 2, 1]);
  assert.deepStrictEqual(stepSecs('classic', 0), [1, 2, 4, 8, 16, 30]);
  assert.deepStrictEqual(stepSecs('easy', 0), [2, 5, 10, 30]);
  // ab 12 s: die letzte Stufe spielt den Rest, keine Stufe läuft über das Ende des Ausschnitts
  assert.deepStrictEqual(stepSecs('classic', MAX_OFFSET), [1, 2, 4, 8, 16, 18]);
  assert.deepStrictEqual([artistPoints('half', 5), artistPoints('full', 5), artistPoints('none', 5)], [3, 5, 0]);
});

test('Titel-Erkennung: feat., Klammerzusätze, Interpret allein, Tippfehler, „Titel – Interpret“', () => {
  const sweet = { title: 'Sweet Dreams (Are Made of This)', artist: 'Eurythmics', alts: ['Sweet Dreams'] };
  assert.strictEqual(judgeGuess('sweet dreams', sweet, true), 'title');
  assert.strictEqual(judgeGuess('Sweet Dreams (Are Made of This)', sweet, true), 'title');
  assert.strictEqual(judgeGuess('Eurythmics', sweet, true), 'artist');
  assert.strictEqual(judgeGuess('Eurythmics', sweet, false), 'no');
  const bowie = { title: 'Under Pressure', artist: 'Queen & David Bowie', alts: [] };
  assert.strictEqual(judgeGuess('Bowie', bowie, true), 'artist');
  assert.strictEqual(judgeGuess('Under Presure', bowie, true), 'title'); // 1 Tippfehler erlaubt
  assert.strictEqual(judgeGuess('Under Pressure – Queen', bowie, true), 'title');
  assert.strictEqual(judgeGuess('Queen von Under Pressure', bowie, true), 'title');
  const feat = { title: 'Despacito', artist: 'Luis Fonsi feat. Daddy Yankee', alts: [] };
  assert.strictEqual(judgeGuess('Daddy Yankee', feat, true), 'artist');
  assert.strictEqual(judgeGuess('Despacitto', feat, true), 'title');
  const close = { title: 'Bohemian Rhapsody', artist: 'Queen', alts: [] };
  assert.strictEqual(judgeGuess('Bohemien Rapsodi', close, true), 'close');
  assert.strictEqual(judgeGuess(WRONG, close, true), 'no');
  assert.strictEqual(judgeGuess('', close, true), 'no');
});

test('Hinweis: Jahrzehnt und Anfangsbuchstabe (ohne Artikel)', () => {
  assert.deepStrictEqual(hintFor({ title: 'Blinding Lights', artist: 'The Weeknd', year: 2019 }), { decade: '2010er', initial: 'W' });
  assert.deepStrictEqual(hintFor({ title: 'Africa', artist: 'Toto', year: 1982 }), { decade: '80er', initial: 'T' });
});

test('Zu wenige Songs → Fehler', () => {
  assert.throws(() => Engine.create({ settings: { cats: ['film-serie'], decades: [1950], level: 'easy' } }), /Zu wenige Songs/);
  assert.ok(E.pool({}).length >= MIN_POOL);
});

/* ---------- Ausschnitte: Tippen ---------- */

test('Lobby: mindestens 2 Personen, Summen braucht 3', () => {
  const e = phones({}, ['a'], { start: false });
  assert.ok(e.lobbyProblem());
  assert.strictEqual(e.apply({ type: 'start' }, STAGE), false);
  e.connect('b', 'B');
  assert.strictEqual(e.lobbyProblem(), null);
  e.apply({ type: 'settings', settings: { mode: 'hum' } }, STAGE);
  assert.match(e.lobbyProblem(), /mindestens 3/);
  e.connect('c', 'C');
  assert.strictEqual(e.lobbyProblem(), null);
});

test('Ausschnitt: Stufe 1 gibt 6 Punkte + 1 für den Schnellsten, Stufe 3 gibt 4', () => {
  const e = phones({}, ['a', 'b', 'c']);
  assert.strictEqual(e.s.phase, 'play');
  assert.strictEqual(e.s.cur.kind, 'snip');
  assert.ok(e.apply({ type: 'guess', text: title(e) }, 'a'));
  assert.strictEqual(res(e, 'a').points, 6);
  assert.strictEqual(res(e, 'a').bonus, FIRST_BONUS);
  nextStep(e);
  nextStep(e);
  assert.strictEqual(e.s.cur.step, 2);
  assert.ok(e.apply({ type: 'guess', text: title(e) }, 'b'));
  assert.strictEqual(res(e, 'b').points, 4);
  assert.strictEqual(res(e, 'b').bonus, 0, 'Schnellster-Bonus nur einmal');
  // alle fertig? c noch nicht → läuft weiter
  assert.strictEqual(e.s.phase, 'play');
  e.apply({ type: 'guess', text: title(e) }, 'c');
  assert.strictEqual(e.s.phase, 'reveal', 'alle haben es → Auflösung');
  assert.strictEqual(e.s.teams[ti(e, 'a')].points, 7);
  assert.strictEqual(e.s.teams[ti(e, 'b')].points, 4);
  assert.strictEqual(e.s.teams[ti(e, 'c')].points, 4);
});

test('Ratezeit läuft erst, wenn die Bühne die Stufe zu Ende gespielt hat', () => {
  const e = phones({}, ['a', 'b']);
  e.clock.add(60000);
  assert.strictEqual(e.tick(), false, 'ohne heard keine Uhr');
  assert.strictEqual(e.apply({ type: 'heard', playId: 99 }, STAGE), false, 'alte Wiedergabe zählt nicht');
  assert.strictEqual(e.apply({ type: 'heard', playId: e.s.cur.playId }, 'a'), false, 'nur die Bühne');
  assert.ok(e.apply({ type: 'heard', playId: e.s.cur.playId }, STAGE));
  e.clock.add(GUESS_MS - 100);
  assert.strictEqual(e.tick(), false);
  e.clock.add(200);
  assert.ok(e.tick());
  assert.strictEqual(e.s.cur.step, 1);
  assert.strictEqual(e.s.cur.heard, false);
});

test('Nochmal hören / Nächste Stufe / Auflösen: nur Laptop und Spielleitung', () => {
  const e = phones({}, ['a', 'b', 'c']);
  assert.strictEqual(e.leadPid(), 'a');
  const id = e.s.cur.playId;
  assert.strictEqual(e.apply({ type: 'replay' }, 'b'), false);
  assert.ok(e.apply({ type: 'replay' }, 'a'));
  assert.strictEqual(e.s.cur.playId, id + 1);
  assert.strictEqual(e.s.cur.step, 0, 'gleiche Stufe');
  assert.ok(e.apply({ type: 'step', step: 0 }, STAGE));
  assert.strictEqual(e.apply({ type: 'step', step: 0 }, STAGE), false, 'doppelter Klick überspringt keine zweite Stufe');
  assert.strictEqual(e.s.cur.step, 1);
  assert.strictEqual(e.apply({ type: 'resolve' }, 'c'), false);
  assert.ok(e.apply({ type: 'resolve' }, 'a'));
  assert.strictEqual(e.s.phase, 'reveal');
  assert.ok(e.s.last.nobody);
});

test('Letzte Stufe: Hinweis, danach Auflösung', () => {
  const e = phones({ steps: 'easy' }, ['a', 'b']);
  for (let i = 0; i < 3; i++) nextStep(e);
  assert.strictEqual(e.s.cur.step, 3);
  const v = e.viewFor('a');
  assert.ok(v.cur.hint && v.cur.hint.initial && v.cur.hint.decade);
  assert.strictEqual(e.viewFor('a').cur.song, null);
  nextStep(e);
  assert.strictEqual(e.s.phase, 'reveal');
});

test('Höchstens 3 Fehlversuche, „knapp daneben“ kostet nichts', () => {
  const e = phones({}, ['a', 'b']);
  const t = title(e);
  // knapp daneben: zwei Buchstaben vertauscht (bei langen Titeln ggf. mehr) – hier gezielt gebaut
  const close = t.length >= 6 ? t.slice(0, -3) + 'qqq' : null;
  if (close && judgeGuess(close, e.s.cur.song, true) === 'close') {
    e.apply({ type: 'guess', text: close }, 'a');
    assert.strictEqual(res(e, 'a').tries, 0);
    assert.strictEqual(e.s.cur.fb.a.result, 'close');
  }
  for (let i = 0; i < MAX_TRIES; i++) assert.ok(e.apply({ type: 'guess', text: WRONG + i }, 'a'));
  assert.ok(res(e, 'a').out);
  assert.strictEqual(e.apply({ type: 'guess', text: t }, 'a'), false, 'raus ist raus');
  assert.strictEqual(e.s.stats.a.wrong, MAX_TRIES);
});

test('Knapp daneben (gezielt): Tippfehler zu viel kostet keinen Versuch', () => {
  const e = phones({}, ['a', 'b']);
  e.s.cur.song = Object.assign({}, e.s.cur.song, { title: 'Bohemian Rhapsody', artist: 'Queen', alts: [] });
  e.apply({ type: 'guess', text: 'Bohemien Rapsodi' }, 'a');
  assert.strictEqual(e.s.cur.fb.a.result, 'close');
  assert.strictEqual(res(e, 'a').tries, 0);
  e.apply({ type: 'guess', text: 'Bohemian Rhapsody' }, 'a');
  assert.ok(res(e, 'a').hit);
});

test('Interpret allein: halbe Punkte, Titel später bringt mehr (höchstens das Bessere zählt)', () => {
  const e = phones({}, ['a', 'b']);
  e.s.cur.song = Object.assign({}, e.s.cur.song, { title: 'Under Pressure', artist: 'Queen & David Bowie', alts: [] });
  e.apply({ type: 'guess', text: 'Bowie' }, 'a');
  assert.strictEqual(e.s.cur.fb.a.result, 'artist');
  assert.strictEqual(res(e, 'a').partial, 3); // halb von 6, aufgerundet
  assert.strictEqual(res(e, 'a').done, false, 'darf weiter raten');
  e.apply({ type: 'guess', text: 'Queen' }, 'a');
  assert.strictEqual(e.s.cur.fb.a.result, 'artist-only', 'zweimal Interpret zählt nicht doppelt');
  assert.strictEqual(res(e, 'a').tries, 0);
  nextStep(e);
  e.apply({ type: 'guess', text: 'Under Pressure' }, 'a');
  assert.strictEqual(res(e, 'a').points, 5);
  assert.ok(res(e, 'a').hit);
});

test('Interpret zählt „voll“ bzw. „nein“', () => {
  const full = phones({ artist: 'full' }, ['a', 'b']);
  full.s.cur.song = Object.assign({}, full.s.cur.song, { title: 'Africa', artist: 'Toto', alts: [] });
  full.apply({ type: 'guess', text: 'Toto' }, 'a');
  assert.strictEqual(res(full, 'a').points, 6);
  assert.ok(res(full, 'a').hit);
  const none = phones({ artist: 'none' }, ['a', 'b']);
  none.s.cur.song = Object.assign({}, none.s.cur.song, { title: 'Africa', artist: 'Toto', alts: [] });
  none.apply({ type: 'guess', text: 'Toto' }, 'a');
  assert.strictEqual(none.s.cur.fb.a.result, 'artist-only');
  assert.strictEqual(res(none, 'a').points, 0);
  assert.strictEqual(res(none, 'a').tries, 0);
});

test('Gefilterte Ansicht: Handys bekommen den Song erst bei der Auflösung, die Bühne zum Abspielen', () => {
  const e = phones({}, ['a', 'b']);
  const id = e.s.cur.song.id;
  const pv = e.viewFor('a');
  assert.strictEqual(pv.cur.song, null);
  assert.strictEqual(pv.cur.offset, null);
  assert.strictEqual(pv.nextSong, null);
  assert.ok(!JSON.stringify(pv).includes(id), 'keine Song-ID am Handy');
  assert.ok(!JSON.stringify(pv).includes(e.s.cur.song.title), 'kein Titel am Handy');
  const sv = e.viewFor(STAGE);
  assert.strictEqual(sv.cur.song.id, id);
  assert.ok(sv.nextSong, 'Bühne lädt den nächsten Ausschnitt vor');
  e.apply({ type: 'resolve' }, STAGE);
  assert.strictEqual(e.viewFor('a').last.song.id, id);
  assert.strictEqual(e.viewFor('a').cur.song.id, id);
});

test('Fremde Tipps sieht niemand, die Rückmeldung nur man selbst', () => {
  const e = phones({}, ['a', 'b']);
  e.apply({ type: 'guess', text: WRONG }, 'a');
  assert.ok(e.viewFor('a').me.fb);
  assert.strictEqual(e.viewFor('b').me.fb, null);
  assert.ok(!JSON.stringify(e.viewFor('b')).includes(WRONG));
});

test('Zufällige Startstelle: 0–12 s, nur die Bühne kennt sie', () => {
  const offsets = new Set();
  for (let seed = 1; seed < 12; seed++) {
    const e = phones({ start: 'random' }, ['a', 'b'], { seed });
    assert.ok(e.s.cur.offset >= 0 && e.s.cur.offset <= MAX_OFFSET);
    offsets.add(e.s.cur.offset);
    assert.strictEqual(e.viewFor(STAGE).cur.offset, e.s.cur.offset);
  }
  assert.ok(offsets.size > 1);
  assert.strictEqual(phones({}, ['a', 'b']).s.cur.offset, 0, 'Refrain = Anfang des Ausschnitts');
});

test('Kein Ausschnitt → anderer Song ohne Folgen', () => {
  const e = phones({}, ['a', 'b']);
  const old = e.s.cur.song.id;
  e.apply({ type: 'guess', text: WRONG }, 'a');
  assert.strictEqual(e.apply({ type: 'replace', id: 'falsch' }, STAGE), false);
  assert.strictEqual(e.apply({ type: 'replace', id: old }, 'a'), false, 'nur die Bühne');
  assert.ok(e.apply({ type: 'replace', id: old }, STAGE));
  assert.notStrictEqual(e.s.cur.song.id, old);
  assert.strictEqual(res(e, 'a').tries, 0);
  assert.strictEqual(e.s.no, 1);
  assert.ok(e.s.next && e.s.next.id !== e.s.cur.song.id);
});

test('Nach der eingestellten Anzahl Songs: Siegerehrung', () => {
  const e = phones({ count: 10 }, ['a', 'b']);
  for (let i = 0; i < 10; i++) {
    // a gewinnt jeden Song, damit es keinen Gleichstand gibt
    e.apply({ type: 'guess', text: title(e) }, 'a');
    e.apply({ type: 'resolve' }, STAGE);
    assert.strictEqual(e.s.phase, 'reveal');
    assert.strictEqual(e.viewFor(STAGE).willEnd, i === 9);
    assert.ok(e.apply({ type: 'next', no: e.s.no }, STAGE));
  }
  assert.strictEqual(e.s.phase, 'end');
  assert.strictEqual(e.winners()[0].name, 'A');
  assert.strictEqual(new Set(e.s.log.map((x) => x.song.id)).size, 10, 'keine Wiederholung');
  assert.strictEqual(e.ranking()[0].hits, 10);
});

test('Weiter mit alter Song-Nummer (Doppelklick) überspringt keinen Song', () => {
  const e = phones({}, ['a', 'b']);
  e.apply({ type: 'resolve' }, STAGE);
  assert.ok(e.apply({ type: 'next', no: 1 }, 'a'));
  e.apply({ type: 'resolve' }, STAGE);
  assert.strictEqual(e.apply({ type: 'next', no: 1 }, STAGE), false);
  assert.strictEqual(e.s.no, 2);
});

/* ---------- Buzzer ---------- */

test('Buzzer: wer zuerst ankommt, ist dran – weitere Buzzes zählen nicht', () => {
  const e = phones({ guess: 'buzz' }, ['a', 'b', 'c']);
  assert.strictEqual(e.apply({ type: 'guess', text: title(e) }, 'a'), false, 'kein Tippen im Buzzer-Modus');
  assert.ok(e.apply({ type: 'buzz' }, 'b'));
  assert.strictEqual(e.s.phase, 'buzzed');
  assert.strictEqual(e.apply({ type: 'buzz' }, 'c'), false);
  assert.strictEqual(e.s.cur.buzz.pid, 'b');
  assert.strictEqual(e.viewFor('c').cur.buzz.name, 'B');
});

test('Buzzer falsch → für diesen Song raus, die Musik läuft weiter', () => {
  const e = phones({ guess: 'buzz' }, ['a', 'b', 'c']);
  nextStep(e); // Stufe 2
  assert.ok(e.apply({ type: 'heard', playId: e.s.cur.playId }, STAGE));
  e.clock.add(4000);
  e.apply({ type: 'buzz' }, 'b');
  assert.strictEqual(e.s.cur.deadline, null, 'Uhr steht während des Buzz');
  e.clock.add(20000);
  assert.strictEqual(e.tick(), false);
  assert.strictEqual(e.apply({ type: 'judge', ok: 'wrong' }, 'b'), false, 'eigenen Buzz nicht bewerten');
  assert.ok(e.apply({ type: 'judge', ok: 'wrong' }, STAGE));
  assert.strictEqual(e.s.phase, 'play');
  assert.ok(res(e, 'b').out);
  assert.ok(e.s.cur.deadline - e.now() >= RESUME_MIN_MS, 'Restzeit läuft weiter');
  assert.strictEqual(e.apply({ type: 'buzz' }, 'b'), false, 'raus ist raus');
  assert.ok(e.apply({ type: 'buzz' }, 'c'));
  assert.ok(e.apply({ type: 'judge', ok: 'title' }, STAGE));
  assert.strictEqual(e.s.phase, 'reveal', 'richtig laut gesagt → Song vorbei');
  assert.strictEqual(e.s.last.results[ti(e, 'c')].points, 5);
  assert.strictEqual(e.s.last.results[ti(e, 'c')].bonus, FIRST_BONUS);
});

test('Buzz mitten in der Stufe: danach wird die Stufe nochmal gespielt', () => {
  const e = phones({ guess: 'buzz' }, ['a', 'b', 'c']);
  const id = e.s.cur.playId;
  e.apply({ type: 'buzz' }, 'c');
  e.apply({ type: 'judge', ok: 'wrong' }, STAGE);
  assert.strictEqual(e.s.cur.playId, id + 1);
  assert.strictEqual(e.s.cur.deadline, null);
});

test('Buzzer: Spielleitung bewertet, aber nicht das eigene Team; Lösung zeigen beendet den Song danach', () => {
  const e = phones({ guess: 'buzz' }, ['a', 'b', 'c']);
  e.apply({ type: 'buzz' }, 'a');
  assert.strictEqual(e.apply({ type: 'judge', ok: 'title' }, 'a'), false, 'Spielleitung buzzert selbst');
  assert.strictEqual(e.apply({ type: 'show' }, 'b'), false);
  assert.ok(e.apply({ type: 'show' }, STAGE));
  assert.ok(e.viewFor(STAGE).cur.shown);
  assert.ok(e.apply({ type: 'judge', ok: 'wrong' }, STAGE));
  assert.strictEqual(e.s.phase, 'reveal', 'Lösung war offen → Song vorbei');
  const e2 = phones({ guess: 'buzz' }, ['a', 'b', 'c']);
  e2.apply({ type: 'buzz' }, 'b');
  assert.ok(e2.viewFor('a').me.judge);
  assert.ok(e2.apply({ type: 'judge', ok: 'title' }, 'a'));
});

test('Buzzer: nur Interpret = halbe Punkte, Team ist dann fertig', () => {
  const e = phones({ guess: 'buzz' }, ['a', 'b', 'c']);
  nextStep(e);
  e.apply({ type: 'buzz' }, 'b');
  assert.ok(e.apply({ type: 'judge', ok: 'artist' }, STAGE));
  assert.strictEqual(e.s.phase, 'play');
  assert.strictEqual(res(e, 'b').points, 3); // halb von 5
  assert.ok(res(e, 'b').done);
  const none = phones({ guess: 'buzz', artist: 'none' }, ['a', 'b']);
  none.apply({ type: 'buzz' }, 'b');
  assert.strictEqual(none.apply({ type: 'judge', ok: 'artist' }, STAGE), false);
});

test('Buzzer: alle raus → Auflösung', () => {
  const e = phones({ guess: 'buzz' }, ['a', 'b']);
  e.apply({ type: 'buzz' }, 'a');
  e.apply({ type: 'judge', ok: 'wrong' }, STAGE);
  e.apply({ type: 'buzz' }, 'b');
  e.apply({ type: 'judge', ok: 'wrong' }, STAGE);
  assert.strictEqual(e.s.phase, 'reveal');
  assert.ok(e.s.last.nobody);
});

/* ---------- Teams ---------- */

test('Teams: ein Treffer gilt fürs ganze Team, Punkte gehören dem Team', () => {
  const e = phones({ teams: 2 }, ['a', 'b', 'c', 'd']);
  assert.strictEqual(e.s.teams.length, 2);
  const [t0, t1] = e.s.teams;
  const p0 = t0.members[0];
  const q0 = t0.members[1];
  e.apply({ type: 'guess', text: title(e) }, p0);
  assert.strictEqual(e.apply({ type: 'guess', text: WRONG }, q0), false, 'Team ist schon fertig');
  assert.strictEqual(e.viewFor(q0).cur.res[e.teamOf(q0)].hit.name, e.memberName(p0));
  e.apply({ type: 'guess', text: title(e) }, t1.members[0]);
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(t0.points, 7);
  assert.strictEqual(t1.points, 6);
});

/* ---------- Summen ---------- */

test('Summen: reihum, Song aussuchen, „Kenn ich nicht“, gefilterte Ansicht', () => {
  const e = phones({ mode: 'hum' }, ['a', 'b', 'c']);
  assert.strictEqual(e.s.phase, 'pick');
  const h = e.s.cur.hummer;
  const v = e.viewFor(h);
  assert.strictEqual(v.cur.options.length, 3);
  assert.ok(v.me.hummer);
  const other = ['a', 'b', 'c'].find((p) => p !== h);
  assert.strictEqual(e.viewFor(other).cur.options, null);
  assert.strictEqual(e.viewFor(STAGE).cur.options, null, 'Bühne zeigt die Vorschläge nicht (alle sehen den Laptop)');
  const first = v.cur.options.map((x) => x.id);
  assert.strictEqual(e.apply({ type: 'reroll' }, other), false);
  assert.ok(e.apply({ type: 'reroll' }, h));
  const second = e.s.cur.options.map((x) => x.id);
  assert.ok(second.every((id) => !first.includes(id)), 'drei neue Songs');
  assert.strictEqual(e.apply({ type: 'pick', id: first[0] }, h), false, 'nur aus den aktuellen');
  assert.strictEqual(e.apply({ type: 'pick', id: second[0] }, other), false);
  assert.ok(e.apply({ type: 'pick', id: second[0] }, h));
  assert.strictEqual(e.s.phase, 'play');
  assert.strictEqual(e.viewFor(h).cur.song.id, second[0]);
  assert.strictEqual(e.viewFor(other).cur.song, null);
  assert.strictEqual(e.viewFor(STAGE).cur.song, null);
  assert.ok(!JSON.stringify(e.viewFor(other)).includes(e.s.cur.song.title));
  assert.ok(e.s.used.includes(second[0]));
  assert.ok(!e.s.used.includes(first[0]), 'nicht gewählte Vorschläge bleiben frei');
});

test('Summen: Summer/in kann nicht raten, 3 Punkte für den Ersten, 1 für weitere, Summer/in +2', () => {
  const e = phones({ mode: 'hum' }, ['a', 'b', 'c', 'd']);
  const h = pickFirst(e);
  const others = ['a', 'b', 'c', 'd'].filter((p) => p !== h);
  assert.strictEqual(e.apply({ type: 'guess', text: title(e) }, h), false);
  e.apply({ type: 'guess', text: title(e) }, others[0]);
  e.apply({ type: 'guess', text: title(e) }, others[1]);
  assert.strictEqual(res(e, others[0]).points, HUM_FIRST);
  assert.strictEqual(res(e, others[1]).points, HUM_MORE);
  assert.strictEqual(res(e, others[0]).bonus, 0, 'kein Schnellster-Bonus beim Summen');
  e.apply({ type: 'guess', text: title(e) }, others[2]);
  assert.strictEqual(e.s.phase, 'reveal', 'alle außer der Summer/in fertig');
  assert.strictEqual(e.s.teams[ti(e, h)].points, HUM_HUMMER);
  assert.strictEqual(e.s.stats[h].humHits, 1);
});

test('Summen: niemand errät es → Summer/in bekommt nichts; Zeit läuft nach 60 s ab', () => {
  const e = phones({ mode: 'hum' }, ['a', 'b', 'c']);
  const h = pickFirst(e);
  e.clock.add(HUM_MS - 10);
  assert.strictEqual(e.tick(), false);
  e.clock.add(20);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(e.s.teams[ti(e, h)].points, 0);
  assert.strictEqual(e.s.stats[h].hummed, 1);
  assert.strictEqual(e.s.stats[h].humHits, 0);
});

test('Summen reihum: jede Person einmal, bevor jemand zweimal dran ist', () => {
  const e = phones({ mode: 'hum', count: 10 }, ['a', 'b', 'c']);
  const order = [];
  for (let i = 0; i < 6; i++) {
    order.push(pickFirst(e));
    e.apply({ type: 'resolve' }, STAGE);
    e.apply({ type: 'next' }, STAGE);
  }
  assert.deepStrictEqual(order.slice(3), order.slice(0, 3));
  assert.strictEqual(new Set(order.slice(0, 3)).size, 3);
});

test('Summen + Buzzer: Summer/in bestätigt, richtig → 3 Punkte und Song vorbei', () => {
  const e = phones({ mode: 'hum', guess: 'buzz' }, ['a', 'b', 'c']);
  const h = pickFirst(e);
  const [p, q] = ['a', 'b', 'c'].filter((x) => x !== h);
  e.apply({ type: 'buzz' }, p);
  assert.ok(e.viewFor(h).me.judge);
  const lead = e.leadPid();
  if (lead !== h) assert.strictEqual(e.viewFor(lead).me.judge, false, 'beim Summen entscheidet die Summer/in');
  assert.strictEqual(e.apply({ type: 'judge', ok: 'artist' }, h), false, 'Interpret zählt beim Summen nicht');
  assert.ok(e.apply({ type: 'judge', ok: 'wrong' }, h));
  assert.ok(res(e, p).out);
  e.apply({ type: 'buzz' }, q);
  assert.ok(e.apply({ type: 'judge', ok: 'title' }, h));
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(e.s.last.results[ti(e, q)].points, HUM_FIRST);
  assert.strictEqual(e.s.last.hummerPoints, HUM_HUMMER);
});

test('Summen: Laptop kann eine andere Person summen lassen; gekickte Summer/in → nächste Person', () => {
  const e = phones({ mode: 'hum' }, ['a', 'b', 'c', 'd']);
  const h = e.s.cur.hummer;
  assert.ok(e.apply({ type: 'skiphum' }, STAGE));
  assert.notStrictEqual(e.s.cur.hummer, h);
  const h2 = e.s.cur.hummer;
  assert.ok(e.apply({ type: 'kick', player: h2 }, STAGE));
  assert.strictEqual(e.s.phase, 'pick');
  assert.notStrictEqual(e.s.cur.hummer, h2);
  assert.strictEqual(e.s.no, 1, 'abgebrochener Song zählt nicht');
});

test('Abwechselnd: Ausschnitt, Summen, Ausschnitt …', () => {
  const e = phones({ mode: 'mixed' }, ['a', 'b', 'c']);
  const kinds = [];
  for (let i = 0; i < 4; i++) {
    kinds.push(e.s.cur.kind);
    if (e.s.phase === 'pick') pickFirst(e);
    e.apply({ type: 'resolve' }, STAGE);
    e.apply({ type: 'next' }, STAGE);
  }
  assert.deepStrictEqual(kinds, ['snip', 'hum', 'snip', 'hum']);
});

/* ---------- Ein Gerät ---------- */

test('Ein Gerät: startet sofort, am Laptop wird angetippt, wer zuerst gerufen hat', () => {
  const e = one({}, ['Anna', 'Ben', 'Cem']);
  assert.strictEqual(e.s.phase, 'play');
  assert.strictEqual(e.s.teams.length, 3);
  assert.strictEqual(e.apply({ type: 'guess', text: title(e) }, 'p1'), false);
  assert.ok(e.apply({ type: 'buzz', team: 1 }, STAGE));
  assert.strictEqual(e.s.cur.buzz.pid, 'p2');
  assert.ok(e.apply({ type: 'judge', ok: 'title' }, STAGE));
  assert.strictEqual(e.s.teams[1].points, 6 + FIRST_BONUS);
  assert.throws(() => Engine.create({ settings: { input: 'one', mode: 'hum' }, players: ['A', 'B'] }), /Mindestens 3/);
});

test('Ein Gerät + Summen: Bühne bekommt Vorschläge und Song (verdeckt), Summer/in nicht antippbar', () => {
  const e = one({ mode: 'hum' }, ['Anna', 'Ben', 'Cem']);
  assert.strictEqual(e.s.phase, 'pick');
  const v = e.viewFor(STAGE);
  assert.strictEqual(v.cur.options.length, 3);
  assert.ok(e.apply({ type: 'pick', id: v.cur.options[1].id }, STAGE));
  assert.ok(e.viewFor(STAGE).cur.song);
  const hTeam = e.teamOf(e.s.cur.hummer);
  assert.strictEqual(e.apply({ type: 'buzz', team: hTeam }, STAGE), false);
  const other = [0, 1, 2].find((i) => i !== hTeam);
  assert.ok(e.apply({ type: 'buzz', team: other }, STAGE));
  assert.ok(e.apply({ type: 'judge', ok: 'title' }, STAGE));
  assert.strictEqual(e.s.teams[other].points, HUM_FIRST);
  assert.strictEqual(e.s.teams[hTeam].points, HUM_HUMMER);
});

/* ---------- Stechen, Trinkregeln, Auszeichnungen ---------- */

test('Gleichstand nach dem letzten Song → Stechen, nur die Punktgleichen raten', () => {
  const e = phones({ count: 10 }, ['a', 'b', 'c']);
  for (let i = 0; i < 10; i++) {
    e.apply({ type: 'resolve' }, STAGE);
    if (i < 9) e.apply({ type: 'next' }, STAGE);
  }
  // a und b punktgleich vorn, c dahinter
  e.s.teams[ti(e, 'a')].points = 5;
  e.s.teams[ti(e, 'b')].points = 5;
  e.s.teams[ti(e, 'c')].points = 1;
  assert.strictEqual(e.viewFor(STAGE).willEnd, false);
  assert.ok(e.viewFor(STAGE).willTie);
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.phase, 'play');
  assert.deepStrictEqual(e.s.tiebreak.slice().sort(), [ti(e, 'a'), ti(e, 'b')].sort());
  assert.strictEqual(e.apply({ type: 'guess', text: title(e) }, 'c'), false, 'c ist nicht im Stechen');
  e.apply({ type: 'guess', text: title(e) }, 'b');
  e.apply({ type: 'resolve' }, STAGE);
  assert.ok(e.viewFor(STAGE).willEnd);
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.phase, 'end');
  assert.strictEqual(e.winners().length, 1);
  assert.strictEqual(e.winners()[0].name, 'B');
});

test(`Stechen höchstens ${MAX_TIEBREAKS}× – dann teilen sie sich den Sieg`, () => {
  const e = phones({ count: 10 }, ['a', 'b']);
  for (let i = 0; i < 10 + MAX_TIEBREAKS; i++) {
    e.apply({ type: 'resolve' }, STAGE);
    e.apply({ type: 'next' }, STAGE);
  }
  assert.strictEqual(e.s.phase, 'end');
  assert.strictEqual(e.s.tiebreaks, MAX_TIEBREAKS);
  assert.strictEqual(e.winners().length, 2);
});

test('Trinkregeln: niemand erkennt den Song → alle; Treffer auf Stufe 1 → verteilen', () => {
  const e = phones({ drinks: true }, ['a', 'b']);
  e.apply({ type: 'resolve' }, STAGE);
  assert.strictEqual(e.s.last.sips.all, SIPS_NOBODY);
  e.apply({ type: 'next' }, STAGE);
  e.apply({ type: 'guess', text: title(e) }, 'a');
  e.apply({ type: 'resolve' }, STAGE);
  assert.deepStrictEqual(e.s.last.sips.give, [ti(e, 'a')]);
  assert.strictEqual(e.s.last.sips.all, 0);
  assert.ok(SIPS_GIVE > 0);
  const dry = phones({}, ['a', 'b']);
  dry.apply({ type: 'resolve' }, STAGE);
  assert.strictEqual(dry.s.last.sips.all, 0);
});

test('Auszeichnungen: ⚡ schnellster Treffer, 🎤 Summ-Star, 🙉 Taub', () => {
  const e = phones({ mode: 'mixed', count: 10 }, ['a', 'b', 'c']);
  // Song 1 (Ausschnitt): b nach 1 s, c tippt 2× daneben
  e.apply({ type: 'guess', text: title(e) }, 'b');
  e.apply({ type: 'guess', text: WRONG }, 'c');
  e.apply({ type: 'guess', text: WRONG + '2' }, 'c');
  e.apply({ type: 'resolve' }, STAGE);
  e.apply({ type: 'next' }, STAGE);
  // Song 2 (Summen): jemand errät es
  const h = pickFirst(e);
  const g = ['a', 'b', 'c'].find((p) => p !== h);
  e.apply({ type: 'guess', text: title(e) }, g);
  e.apply({ type: 'resolve' }, STAGE);
  e.apply({ type: 'end' }, STAGE);
  const awards = e.awards();
  const fast = awards.find((x) => x.id === 'fast');
  assert.deepStrictEqual(fast.pids, ['b']);
  assert.strictEqual(fast.label, 'Eine Sekunde reicht');
  assert.deepStrictEqual(awards.find((x) => x.id === 'hum').pids, [h]);
  assert.deepStrictEqual(awards.find((x) => x.id === 'deaf').pids, ['c']);
  const v = e.viewFor('a');
  assert.strictEqual(v.log.length, 2, 'Playlist des Abends');
  assert.ok(v.ranking && v.awards);
});

test('Revanche und zurück in die Lobby', () => {
  const e = phones({}, ['a', 'b']);
  e.apply({ type: 'guess', text: title(e) }, 'a');
  e.apply({ type: 'end' }, STAGE);
  assert.ok(e.apply({ type: 'again' }, STAGE));
  assert.strictEqual(e.s.phase, 'play');
  assert.strictEqual(e.s.no, 1);
  assert.ok(e.s.teams.every((t) => t.points === 0));
  e.apply({ type: 'end' }, STAGE);
  e.connect('z', 'Z');
  assert.ok(e.s.members.z.watch, 'zu spät: schaut zu');
  assert.ok(e.apply({ type: 'lobby' }, STAGE));
  assert.strictEqual(e.s.members.z.watch, false);
});

test('Songs des Abends wiederholen sich nicht (über mehrere Spiele)', () => {
  const used = [];
  const hooks = { used, onDraw: (s) => used.push(s.id) };
  const e = phones({ count: 10 }, ['a', 'b'], { hooks });
  for (let i = 0; i < 9; i++) {
    e.apply({ type: 'resolve' }, STAGE);
    e.apply({ type: 'next' }, STAGE);
  }
  const before = used.slice();
  assert.ok(before.length >= 10);
  // gleicher Zufall, aber die Songs vom ersten Spiel sind „schon dran gewesen“
  const e2 = phones({ count: 10 }, ['a', 'b'], { hooks });
  assert.ok(!before.includes(e2.s.cur.song.id));
  assert.ok(!before.includes(e2.s.next.id));
});

test('Snippet-Player lässt sich ohne Browser laden', () => {
  const S = globalThis.GameSnippet;
  assert.strictEqual(typeof S.Snippet, 'function');
  const sn = new S.Snippet();
  assert.strictEqual(sn.progress(), null);
  assert.strictEqual(sn.playing, false);
});

console.log(`\n${passed} Tests bestanden.`);
