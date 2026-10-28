'use strict';
/* Tests für „Hit Story“ (ohne Browser, ohne Ton): node tests/hit-story.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

globalThis.window = globalThis;
const SONG_DIR = path.join(__dirname, '..', 'shared', 'songs');
for (const f of fs.readdirSync(SONG_DIR).filter((f) => f.endsWith('.js'))) require(path.join(SONG_DIR, f));
for (const f of ['songs', 'match', 'titles', 'audio-source']) require(path.join(__dirname, '..', 'shared', f + '.js'));
for (const f of ['timeline', 'engine']) require(path.join(__dirname, '..', 'hit-story', 'js', f + '.js'));

const Songs = globalThis.Songs;
const Titles = globalThis.GameTitles;
const AudioSource = globalThis.AudioSource;
const T = globalThis.HSTimeline;
const E = globalThis.HSEngine;
const { Engine, STAGE, TARGETS, MAX_JOKERS, CHALLENGE_MS, COOP_LIVES, SIPS_WRONG, SIPS_CHALLENGED, MIN_POOL, MAX_PLAYERS, sanitizeSettings, cleanName, pool, exactPoints } = E;

let passed = 0;
const pending = [];
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      pending.push(
        r.then(
          () => {
            passed++;
            console.log('  ✓ ' + name);
          },
          (err) => {
            console.error('  ✗ ' + name);
            throw err;
          }
        )
      );
      return;
    }
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

const NAMES = ['Anna', 'Ben', 'Cem', 'Dora', 'Eli'];

/** Ein Gerät: Spiel läuft sofort */
function one(settings, opts) {
  const o = opts || {};
  const hooks = Object.assign({ random: seeded(o.seed || 3), timers: false, now: clock(), used: [] }, o.hooks);
  const state = Engine.create({ settings: Object.assign({ input: 'one', audio: 'itunes' }, settings), players: o.players || NAMES.slice(0, o.n || 3) }, hooks);
  return new Engine(state, hooks);
}

/** Handys: Lobby, alle verbinden, starten */
function phones(settings, pids, opts) {
  const o = opts || {};
  const now = clock();
  const hooks = Object.assign({ random: seeded(o.seed || 5), timers: false, now, used: [] }, o.hooks);
  const state = Engine.create({ settings: Object.assign({ input: 'phones', audio: 'itunes' }, settings) }, hooks);
  const e = new Engine(state, hooks);
  for (const pid of pids || ['a', 'b', 'c']) {
    e.connect(pid, pid.toUpperCase());
    now.add(10);
  }
  e.clock = now;
  if (o.start !== false) assert.ok(e.apply({ type: 'start' }, STAGE), 'Start: ' + e.lobbyProblem());
  return e;
}

const cards = (...years) => years.map((year, i) => ({ id: 'c' + i, title: 'Song ' + i, artist: 'X', year }));
const years = (list) => list.map((c) => c.year);

function rightGap(e) {
  return T.correctGaps(e.line(), e.s.song.year)[0];
}
function wrongGap(e) {
  const ok = T.correctGaps(e.line(), e.s.song.year);
  for (let g = 0; g < T.gapCount(e.line()); g++) if (!ok.includes(g)) return g;
  return null;
}
/** Mitglied des aktiven Teams (Handys) */
function activePid(e) {
  return e.team.members[0];
}
function otherPid(e) {
  return e.s.teams.find((_, i) => i !== e.s.turn).members[0];
}

/** Ein Zug am Laptop: einordnen, ggf. Einspruch-Zeit beenden, auflösen, weiter */
function turn(e, right) {
  let gap = right ? rightGap(e) : wrongGap(e);
  if (gap === null) gap = rightGap(e);
  if (e.hasGaps()) assert.ok(e.apply({ type: 'place', gap }, STAGE));
  else assert.ok(e.apply({ type: 'place', year: right ? e.s.song.year : e.s.song.year + 9 }, STAGE));
  if (e.s.phase === 'challenge') assert.ok(e.apply({ type: 'reveal' }, STAGE));
  assert.strictEqual(e.s.phase, 'reveal');
  // Profi: richtig heißt hier auch Titel + Interpret gewusst
  if (right && e.variant === 'pro') e.apply({ type: 'named', ok: true }, STAGE);
  return e.apply({ type: 'next' }, STAGE);
}

function playToEnd(e, rightFn, max) {
  let guard = 0;
  while (e.s.phase !== 'end' && guard++ < (max || 500)) turn(e, rightFn(e, guard));
  assert.strictEqual(e.s.phase, 'end', 'Spiel endet nicht');
}

console.log('Hit Story – Zeitstrahl');

test('n Karten → n + 1 Lücken mit offenen Rändern', () => {
  const c = cards(1982, 1999, 2013);
  assert.strictEqual(T.gapCount(c), 4);
  assert.deepStrictEqual(T.bounds(c, 0), { lo: null, hi: 1982 });
  assert.deepStrictEqual(T.bounds(c, 2), { lo: 1999, hi: 2013 });
  assert.deepStrictEqual(T.bounds(c, 3), { lo: 2013, hi: null });
  assert.strictEqual(T.gapCount([]), 1);
});

test('Anfang, Mitte, Ende', () => {
  const c = cards(1982, 1999, 2013);
  assert.ok(T.fits(c, 0, 1975));
  assert.ok(!T.fits(c, 0, 1990));
  assert.ok(T.fits(c, 1, 1990));
  assert.ok(T.fits(c, 2, 2005));
  assert.ok(T.fits(c, 3, 2020));
  assert.ok(!T.fits(c, 3, 2010));
  assert.deepStrictEqual(T.correctGaps(c, 1960), [0]);
  assert.deepStrictEqual(T.correctGaps(c, 2024), [3]);
});

test('gleiches Jahr wie eine Nachbarkarte: beide Seiten richtig', () => {
  const c = cards(1982, 1999, 2013);
  assert.deepStrictEqual(T.correctGaps(c, 1999), [1, 2]);
  assert.deepStrictEqual(T.correctGaps(c, 1982), [0, 1]);
  assert.deepStrictEqual(T.correctGaps(c, 2013), [2, 3]);
});

test('gleiche Jahre nebeneinander', () => {
  const c = cards(1983, 1983, 2000);
  assert.deepStrictEqual(T.correctGaps(c, 1983), [0, 1, 2]);
  assert.deepStrictEqual(T.correctGaps(c, 1990), [2]);
  assert.ok(!T.fits(c, 1, 1984), 'zwischen zwei 1983ern passt nur 1983');
  assert.strictEqual(T.gapLabel(c, 1), 'auch 1983');
});

test('ungültige Lücken passen nie, leerer Zeitstrahl passt immer', () => {
  const c = cards(1990);
  for (const g of [-1, 2, 0.5, null, undefined, '1']) assert.ok(!T.fits(c, g, 1990), String(g));
  assert.ok(T.fits([], 0, 1960));
  assert.strictEqual(T.gapLabel([], 0), 'irgendwann');
});

test('Beschriftung der Lücken', () => {
  const c = cards(1985, 2013);
  assert.deepStrictEqual([0, 1, 2].map((g) => T.gapLabel(c, g)), ['vor 1985', '1985 – 2013', 'nach 2013']);
});

test('insert: an der gewählten Lücke, sonst an der ersten richtigen; Original bleibt', () => {
  const c = cards(1983, 2000);
  const song = { id: 's', year: 1983 };
  assert.strictEqual(T.insert(c, song, 1).at, 1);
  const r2 = T.insert(c, song, 2);
  assert.strictEqual(r2.at, 0);
  assert.deepStrictEqual(years(r2.cards), [1983, 1983, 2000]);
  assert.strictEqual(c.length, 2);
});

test('sort: nach Jahr, gleiche Jahre stabil', () => {
  const c = [{ id: 'a', year: 2000 }, { id: 'b', year: 1990 }, { id: 'c', year: 2000 }];
  assert.deepStrictEqual(T.sort(c).map((x) => x.id), ['b', 'a', 'c']);
});

console.log('Hit Story – Titel und Interpret');

test('Titel: Klammerzusatz egal, weitere Antworten, kleine Tippfehler', () => {
  const song = { title: 'Sweet Dreams (Are Made of This)', artist: 'Eurythmics', alts: ['Sweet Dreams'] };
  assert.strictEqual(Titles.checkTitle('sweet dreams', song), 'yes');
  assert.strictEqual(Titles.checkTitle('Sweet Dreams are made of this', song), 'yes');
  assert.strictEqual(Titles.checkTitle('Swet Dreams', song), 'yes');
  assert.strictEqual(Titles.checkTitle('Dreams', song), 'no');
  assert.strictEqual(Titles.checkTitle('Atemlos', { title: 'Atemlos durch die Nacht', alts: ['Atemlos'] }), 'yes');
  assert.strictEqual(Titles.checkTitle('dont stop me now', { title: "Don't Stop Me Now" }), 'yes');
});

test('Interpret: jede/r Beteiligte zählt, auch der hintere Teil des Namens', () => {
  assert.strictEqual(Titles.checkArtist('Gaga', 'Lady Gaga'), 'yes');
  assert.strictEqual(Titles.checkArtist('Lady', 'Lady Gaga'), 'no');
  assert.strictEqual(Titles.checkArtist('Bowie', 'Queen & David Bowie'), 'yes');
  assert.strictEqual(Titles.checkArtist('queen', 'Queen & David Bowie'), 'yes');
  assert.strictEqual(Titles.checkArtist('Amy Winehouse', 'Mark Ronson feat. Amy Winehouse'), 'yes');
  assert.strictEqual(Titles.checkArtist('Weeknd', 'The Weeknd'), 'yes');
  assert.strictEqual(Titles.checkArtist('Michael', 'Michael Jackson'), 'no');
  assert.strictEqual(Titles.checkArtist('Micheal Jackson', 'Michael Jackson'), 'yes');
  assert.strictEqual(Titles.checkArtist('Ötzi', 'DJ Ötzi & Nik P.'), 'yes');
  assert.deepStrictEqual(Titles.artistParts('A feat. B, C & D'), ['A', 'B', 'C', 'D']);
  // „a-ha“ ist kein Artikel + „ha“, „P!nk“ = Pink
  assert.strictEqual(Titles.checkArtist('a-ha', 'a-ha'), 'yes');
  assert.strictEqual(Titles.checkArtist('A-ha', 'a-ha'), 'yes');
  assert.strictEqual(Titles.checkArtist('Pink', 'P!nk'), 'yes');
  assert.strictEqual(Titles.checkArtist('P!nk', 'Pink'), 'yes');
});

test('checkSong: beides nötig', () => {
  const s = { title: 'Africa', artist: 'Toto' };
  assert.deepStrictEqual(Titles.checkSong('africa', 'toto', s), { title: 'yes', artist: 'yes', both: true });
  assert.strictEqual(Titles.checkSong('africa', '', s).both, false);
});

console.log('Hit Story – Einstellungen');

test('sanitizeSettings: Standard und Unsinn', () => {
  assert.deepStrictEqual(sanitizeSettings(), E.DEFAULT_SETTINGS);
  const s = sanitizeSettings({ target: '15', jokers: '3', dj: 'host', audio: 'manual', variant: 'pro', teams: '3', cats: ['deutsch', 'quatsch', 'deutsch'], decades: ['1980', 1234], level: 'easy', drinks: 1 });
  assert.deepStrictEqual(s, Object.assign({}, E.DEFAULT_SETTINGS, { target: 15, jokers: 3, dj: 'host', audio: 'manual', variant: 'pro', teams: 3, cats: ['deutsch'], decades: [1980], level: 'easy', drinks: true }));
  assert.strictEqual(sanitizeSettings({ target: 7 }).target, 10);
  assert.strictEqual(sanitizeSettings({ jokers: 9 }).jokers, 2);
  assert.strictEqual(sanitizeSettings({ variant: 'x' }).variant, 'normal');
});

test('Teams nur mit Handys und nicht kooperativ', () => {
  assert.strictEqual(sanitizeSettings({ input: 'one', teams: 2 }).teams, 0);
  assert.strictEqual(sanitizeSettings({ variant: 'coop', teams: 2 }).teams, 0);
  assert.strictEqual(sanitizeSettings({ teams: 2 }).teams, 2);
});

test('alles angekreuzt = keine Einschränkung; pool folgt der Auswahl', () => {
  const s = sanitizeSettings({ cats: Songs.CATEGORY_IDS.slice(), decades: Songs.DECADES.slice() });
  assert.deepStrictEqual([s.cats, s.decades], [[], []]);
  assert.strictEqual(pool({}).length, Songs.list().length);
  const p = pool({ decades: [1980, 1990] });
  assert.ok(p.length >= MIN_POOL && p.every((x) => x.decade === 1980 || x.decade === 1990));
});

test('cleanName', () => {
  assert.strictEqual(cleanName('  Anna   Lena '), 'Anna Lena');
  assert.strictEqual(cleanName('<b>x</b>'), 'bx/b');
  assert.strictEqual(cleanName('', 'Gast'), 'Gast');
  assert.strictEqual(cleanName('x'.repeat(40)).length, 20);
});

test('Jahr genau: Punkte', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 4, 20].map(exactPoints), [3, 2, 1, 1, 0, 0]);
});

console.log('Hit Story – ein Gerät');

test('Start: jede Person eine Startkarte und Joker, alle Songs verschieden, nächster Song vorgeladen', () => {
  const e = one({ jokers: 3 }, { n: 5 });
  const s = e.s;
  assert.strictEqual(s.phase, 'listen');
  assert.strictEqual(s.teams.length, 5);
  assert.deepStrictEqual(s.teams.map((t) => t.name), NAMES);
  assert.ok(s.teams.every((t) => t.cards.length === 1 && t.jokers === 3));
  const ids = s.teams.map((t) => t.cards[0].id).concat(s.song.id, s.next.id);
  assert.strictEqual(new Set(ids).size, 7);
  assert.strictEqual(s.turn, s.first);
});

test('Start braucht 2 Namen und genug Songs', () => {
  assert.throws(() => one({}, { players: ['Anna', '  '] }), /Mindestens 2/);
  assert.throws(() => one({ decades: [1950] }), /Zu wenige Songs/);
  const many = Array.from({ length: 14 }, (_, i) => 'P' + i);
  assert.strictEqual(one({}, { players: many }).s.teams.length, MAX_PLAYERS);
});

test('richtig: Karte bleibt – verbucht wird erst beim Weiter', () => {
  const e = one({}, { seed: 7 });
  const t = e.team;
  const song = e.s.song;
  assert.ok(!e.apply({ type: 'place' }, STAGE), 'ohne Lücke kein Einloggen');
  assert.ok(e.apply({ type: 'choose', gap: rightGap(e) }, STAGE));
  assert.ok(e.apply({ type: 'place' }, STAGE));
  if (e.s.phase === 'challenge') e.apply({ type: 'reveal' }, STAGE);
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(e.s.last.correct, true);
  assert.strictEqual(t.cards.length, 1, 'noch nicht verbucht');
  const v = e.viewFor(STAGE);
  assert.strictEqual(v.teams[e.s.turn].cards.length, 2, 'Vorschau zeigt die Karte');
  assert.strictEqual(v.teams[e.s.turn].cards[v.teams[e.s.turn].fresh].id, song.id);
  const ti = e.s.turn;
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.strictEqual(e.s.teams[ti].cards.length, 2);
  assert.deepStrictEqual(years(e.s.teams[ti].cards), years(T.sort(e.s.teams[ti].cards)));
  assert.deepStrictEqual([t.stats.placed, t.stats.right, t.stats.streak, t.stats.best], [1, 1, 1, 1]);
});

test('falsch: Karte ist weg, Serie reißt, Trinkregel', () => {
  const e = one({ drinks: true, jokers: 0 }, { seed: 7 });
  const t = e.team;
  t.stats.streak = 3;
  t.stats.best = 3;
  e.apply({ type: 'place', gap: wrongGap(e) }, STAGE);
  assert.strictEqual(e.s.phase, 'reveal', 'ohne Joker kein Einspruch');
  assert.strictEqual(e.s.last.correct, false);
  assert.deepStrictEqual(e.outcome().sips, [{ team: e.s.turn, sips: SIPS_WRONG }]);
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(t.cards.length, 1);
  assert.deepStrictEqual([t.stats.placed, t.stats.right, t.stats.streak, t.stats.best], [1, 0, 0, 3]);
});

test('Lücke wählen: umentscheiden erlaubt, ungültige Lücke und nach dem Einloggen nicht', () => {
  const e = one();
  assert.ok(e.apply({ type: 'choose', gap: 0 }, STAGE));
  assert.ok(e.apply({ type: 'choose', gap: 1 }, STAGE));
  assert.ok(!e.apply({ type: 'choose', gap: 2 }, STAGE));
  assert.strictEqual(e.s.pick, 1);
  e.apply({ type: 'place' }, STAGE);
  assert.ok(!e.apply({ type: 'choose', gap: 0 }, STAGE));
  assert.ok(!e.apply({ type: 'skip' }, STAGE));
});

test('reihum: nächstes Team, Runde zählt hoch', () => {
  const e = one({}, { n: 3, seed: 11 });
  const first = e.s.first;
  const seen = [];
  for (let k = 0; k < 6; k++) {
    seen.push(e.s.turn);
    turn(e, k % 2 === 0);
  }
  assert.deepStrictEqual(seen, [0, 1, 2, 0, 1, 2].map((k) => (first + k) % 3));
  assert.strictEqual(e.s.round, 3);
});

test('DJ: bei „Selbst abspielen“ die Person davor, sonst niemand', () => {
  const e = one({ audio: 'manual' }, { n: 3 });
  assert.strictEqual(e.djMember(), e.s.teams[(e.s.turn + 2) % 3].members[0]);
  assert.strictEqual(one({ audio: 'manual', dj: 'host' }).djMember(), null);
  assert.strictEqual(one({ audio: 'itunes' }).djMember(), null);
});

test('anderer Song (Ausschnitt fehlt): ohne Folgen, nur mit passender ID', () => {
  const e = one();
  const old = e.s.song.id;
  const next = e.s.next.id;
  e.apply({ type: 'choose', gap: 0 }, STAGE);
  assert.ok(!e.apply({ type: 'replace', id: 'falsch' }, STAGE));
  assert.ok(e.apply({ type: 'replace', id: old }, STAGE));
  assert.strictEqual(e.s.song.id, next, 'der vorgeladene Song kommt dran');
  assert.ok(e.s.next && e.s.next.id !== next);
  assert.strictEqual(e.s.pick, null);
  assert.strictEqual(e.team.jokers, 2);
});

test('Joker: überspringen kostet 1, ohne Joker geht es nicht', () => {
  const e = one({ jokers: 2 });
  const t = e.team;
  const old = e.s.song.id;
  assert.ok(e.apply({ type: 'skip' }, STAGE));
  assert.notStrictEqual(e.s.song.id, old);
  assert.strictEqual(t.jokers, 1);
  assert.ok(e.apply({ type: 'skip' }, STAGE));
  assert.ok(!e.apply({ type: 'skip' }, STAGE));
  assert.strictEqual(t.jokers, 0);
  assert.strictEqual(t.stats.skips, 2);
});

test('Joker: 3 → Karte gratis, richtig einsortiert, zählt nicht als Einordnung', () => {
  const e = one({ jokers: 3 });
  const t = e.team;
  const ti = e.s.turn;
  const song = e.s.song;
  assert.ok(e.apply({ type: 'buy' }, STAGE));
  assert.strictEqual(e.s.phase, 'reveal');
  assert.ok(e.s.last.bought && e.s.last.correct);
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(t.jokers, 0);
  assert.ok(e.s.teams[ti].cards.some((c) => c.id === song.id));
  assert.strictEqual(t.stats.placed, 0);
  assert.ok(!one({ jokers: 2 }).apply({ type: 'buy' }, STAGE), 'zu wenige Joker');
});

test('Titel gewusst (Spielleitung bestätigt): +1 Joker, höchstens 5', () => {
  const e = one({ jokers: 3 });
  const t = e.team;
  t.jokers = MAX_JOKERS;
  e.apply({ type: 'place', gap: rightGap(e) }, STAGE);
  if (e.s.phase === 'challenge') e.apply({ type: 'reveal' }, STAGE);
  assert.strictEqual(e.s.last.named, false);
  assert.ok(e.apply({ type: 'named', ok: true }, STAGE));
  assert.ok(!e.apply({ type: 'named', ok: true }, STAGE), 'schon gesetzt');
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(t.jokers, MAX_JOKERS);
  assert.strictEqual(t.stats.named, 1);
});

test('Einspruch am Laptop: ohne Uhr, Team mit Joker, nicht die gleiche Lücke', () => {
  const e = one({ jokers: 2 }, { n: 3, seed: 21 });
  const active = e.s.turn;
  const other = (active + 1) % 3;
  e.apply({ type: 'place', gap: wrongGap(e) }, STAGE);
  assert.strictEqual(e.s.phase, 'challenge');
  assert.strictEqual(e.s.challengeEnd, null);
  assert.ok(!e.apply({ type: 'challenge', team: active, gap: rightGap(e) }, STAGE), 'nicht das aktive Team');
  assert.ok(!e.apply({ type: 'challenge', team: other, gap: e.s.pick }, STAGE), 'nicht die gleiche Lücke');
  const song = e.s.song;
  assert.ok(e.apply({ type: 'challenge', team: other, gap: rightGap(e) }, STAGE));
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(e.s.teams[other].jokers, 1);
  assert.ok(e.outcome().stolen);
  e.apply({ type: 'next' }, STAGE);
  assert.ok(e.s.teams[other].cards.some((c) => c.id === song.id), 'Karte wandert zur Einspruch-Person');
  assert.ok(!e.s.teams[active].cards.some((c) => c.id === song.id));
  assert.strictEqual(e.s.teams[other].stats.challengeWins, 1);
});

test('Einspruch daneben: Joker weg, aktive Person behält die Karte', () => {
  const e = one({ jokers: 2, drinks: true }, { n: 2, seed: 4 });
  const active = e.s.turn;
  const other = 1 - active;
  const ok = rightGap(e);
  e.apply({ type: 'place', gap: ok }, STAGE);
  const bad = wrongGap(e);
  if (bad === null) return; // nur gleiche Jahre – kommt bei diesem Zufall nicht vor
  assert.ok(e.apply({ type: 'challenge', team: other, gap: bad }, STAGE));
  const o = e.outcome();
  assert.ok(o.keep && !o.stolen);
  assert.deepStrictEqual(o.sips, []);
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.teams[other].jokers, 1);
  assert.strictEqual(e.s.teams[active].cards.length, 2);
});

test('Einspruch erfolgreich: Trinkregel 2 Schlucke für die aktive Person', () => {
  const e = one({ jokers: 2, drinks: true }, { n: 2, seed: 4 });
  const other = 1 - e.s.turn;
  e.apply({ type: 'place', gap: wrongGap(e) }, STAGE);
  e.apply({ type: 'challenge', team: other, gap: rightGap(e) }, STAGE);
  assert.deepStrictEqual(e.outcome().sips, [{ team: e.s.turn, sips: SIPS_CHALLENGED }]);
});

test('Spielende: Runde wird zu Ende gespielt, alle gleich oft dran', () => {
  const e = one({ target: 5, jokers: 0 }, { n: 3, seed: 2 });
  const first = e.s.first;
  playToEnd(e, (x) => x.s.turn === first);
  assert.strictEqual(e.s.reason, 'target');
  assert.strictEqual(e.s.teams[first].cards.length, 5);
  assert.ok(e.s.teams.every((t) => t.stats.placed === 4));
  assert.deepStrictEqual(e.winners().map((w) => w.i), [first]);
});

test('willEnd sagt das Spielende voraus', () => {
  const e = one({ target: 5, jokers: 0 }, { n: 2, seed: 9 });
  let guard = 0;
  while (e.s.phase !== 'end' && guard++ < 100) {
    e.apply({ type: 'place', gap: rightGap(e) }, STAGE);
    const will = e.willEnd();
    e.apply({ type: 'next' }, STAGE);
    assert.strictEqual(e.s.phase === 'end', will);
  }
  assert.strictEqual(e.s.phase, 'end');
});

test('Gleichstand: mehr Joker gewinnen, sonst geteilter Sieg', () => {
  const e = one({}, { n: 4 });
  const s = e.s;
  s.teams[0].cards = cards(1, 2, 3);
  s.teams[1].cards = cards(1, 2, 3, 4);
  s.teams[2].cards = cards(1, 2, 3, 4);
  s.teams[3].cards = cards(1);
  s.teams.forEach((t) => (t.jokers = 1));
  s.teams[2].jokers = 3;
  assert.deepStrictEqual(e.ranking().map((r) => [r.i, r.place]), [[2, 1], [1, 2], [0, 3], [3, 4]]);
  s.teams[2].jokers = 1;
  assert.deepStrictEqual(e.winners().map((w) => w.i), [1, 2]);
});

test('Songs gehen aus → Spiel endet sofort', () => {
  const e = one({ target: 15 }, { n: 2 });
  const taken = e.taken();
  for (const x of e.pool) if (!taken.has(x.id)) e.s.used.push(x.id);
  e.s.next = null;
  e.apply({ type: 'place', gap: rightGap(e) }, STAGE);
  if (e.s.phase === 'challenge') e.apply({ type: 'reveal' }, STAGE);
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.strictEqual(e.s.phase, 'end');
  assert.strictEqual(e.s.reason, 'empty');
});

test('kein Song kommt in einem Spiel doppelt', () => {
  const e = one({ target: 15, jokers: 3 }, { n: 4, seed: 5 });
  const seen = new Set();
  let guard = 0;
  while (e.s.phase !== 'end' && guard++ < 300) {
    assert.ok(!seen.has(e.s.song.id), e.s.song.id);
    seen.add(e.s.song.id);
    if (guard % 7 === 0 && e.apply({ type: 'skip' }, STAGE)) continue;
    if (guard % 11 === 0 && e.apply({ type: 'replace', id: e.s.song.id }, STAGE)) continue;
    turn(e, guard % 3 !== 0);
  }
  assert.strictEqual(e.s.phase, 'end');
});

test('Songs des Abends werden gemieden, sind sie alle weg, kommen sie wieder', () => {
  const p = pool({ decades: [1980] });
  const evening = p.slice(0, p.length - 8).map((x) => x.id);
  const draws = [];
  const e = one({ decades: [1980], jokers: 0 }, { n: 2, hooks: { used: () => evening, onDraw: (song, reset) => draws.push({ id: song.id, reset }) } });
  // Start: 2 Startkarten + laufender + vorgeladener Song aus den 8 freien
  assert.ok(draws.slice(0, 4).every((d) => !evening.includes(d.id) && !d.reset));
  let guard = 0;
  while (!draws.some((d) => d.reset) && guard++ < 20) turn(e, false);
  assert.strictEqual(draws.findIndex((d) => d.reset), 8);
});

test('Engine.evening: Songs des Abends ohne eigene Hooks (wie im StageController)', () => {
  const seen = [];
  Engine.evening = { used: () => [], onDraw: (song) => seen.push(song.id) };
  try {
    const state = Engine.create({ settings: { input: 'one' }, players: ['A', 'B'] }, { random: seeded(1) });
    assert.strictEqual(seen.length, 4);
    assert.ok(seen.includes(state.song.id));
  } finally {
    Engine.evening = null;
  }
});

test('Spielstand lässt sich speichern und weiterspielen (JSON)', () => {
  const e = one({}, { n: 3, seed: 4 });
  turn(e, true);
  turn(e, false);
  const copy = new Engine(JSON.parse(JSON.stringify(e.s)), { random: seeded(1), timers: false });
  assert.strictEqual(copy.team.name, e.team.name);
  assert.ok(copy.apply({ type: 'place', gap: 0 }, STAGE));
});

test('Revanche: dieselben Leute und Einstellungen, neue Karten', () => {
  const e = one({ target: 5, jokers: 0 }, { n: 3 });
  playToEnd(e, () => true);
  const names = e.s.teams.map((t) => t.name);
  assert.ok(e.apply({ type: 'again' }, STAGE));
  assert.strictEqual(e.s.phase, 'listen');
  assert.deepStrictEqual(e.s.teams.map((t) => t.name), names);
  assert.ok(e.s.teams.every((t) => t.cards.length === 1 && t.stats.placed === 0));
});

test('alle Ziele und Varianten lassen sich bis zum Ende spielen', () => {
  for (const variant of E.VARIANTS) {
    for (const target of TARGETS) {
      const e = one({ target, variant, jokers: 2 }, { n: 3, seed: target + variant.length });
      playToEnd(e, (_, k) => k % 4 !== 0, 800);
      if (variant !== 'coop') assert.ok(e.winners()[0].progress >= e.goal() || e.s.reason === 'empty', `${variant} ${target}`);
    }
  }
});

console.log('Hit Story – Varianten');

test('🟢 Leicht: nur vor/nach einer Karte, landet an der richtigen Stelle', () => {
  const e = one({ variant: 'easy', jokers: 0 }, { n: 2, seed: 8 });
  const t = e.team;
  t.cards = cards(1970, 1990, 2010);
  e.s.ref = 'c1';
  assert.deepStrictEqual(e.line().map((c) => c.year), [1990]);
  assert.ok(!e.apply({ type: 'choose', gap: 2 }, STAGE), 'nur zwei Lücken');
  const before = e.s.song.year <= 1990;
  e.apply({ type: 'place', gap: before ? 0 : 1 }, STAGE);
  assert.ok(e.s.last.correct);
  const ti = e.s.turn;
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.teams[ti].cards.length, 4);
  assert.deepStrictEqual(years(e.s.teams[ti].cards), years(T.sort(e.s.teams[ti].cards)));
});

test('🔴 Profi: ohne Titel + Interpret gilt die Karte nicht', () => {
  const e = one({ variant: 'pro', jokers: 0 }, { n: 2 });
  e.apply({ type: 'place', gap: rightGap(e) }, STAGE);
  assert.ok(e.s.last.correct);
  assert.strictEqual(e.outcome().keep, false);
  e.apply({ type: 'named', ok: true }, STAGE);
  assert.strictEqual(e.outcome().keep, true);
  const ti = e.s.turn;
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.teams[ti].cards.length, 2);
});

test('🤝 Kooperativ: ein Zeitstrahl, reihum tippen, nach 3 Fehlern verloren', () => {
  const e = one({ variant: 'coop', jokers: 2 }, { n: 3, seed: 6 });
  assert.strictEqual(e.s.teams.length, 1);
  assert.strictEqual(e.s.teams[0].members.length, 3);
  assert.strictEqual(e.s.teams[0].cards.length, 1);
  const speakers = [];
  for (let k = 0; k < COOP_LIVES; k++) {
    speakers.push(e.speaker());
    e.apply({ type: 'place', gap: wrongGap(e) }, STAGE);
    assert.strictEqual(e.s.phase, 'reveal', 'kein Einspruch');
    e.apply({ type: 'next' }, STAGE);
  }
  assert.strictEqual(new Set(speakers).size, 3, 'alle waren mal dran');
  assert.strictEqual(e.s.phase, 'end');
  assert.strictEqual(e.s.reason, 'lost');
});

test('🤝 Kooperativ: Ziel geschafft → gewonnen', () => {
  const e = one({ variant: 'coop', target: 5 }, { n: 2 });
  playToEnd(e, () => true);
  assert.strictEqual(e.s.reason, 'won');
  assert.strictEqual(e.s.teams[0].cards.length, 5);
});

test('🎯 Jahr genau: Jahr tippen, Punkte, Ziel in Punkten', () => {
  const e = one({ variant: 'exact', target: 5, jokers: 2 }, { n: 2, seed: 3 });
  assert.strictEqual(e.goal(), 10);
  assert.ok(!e.apply({ type: 'choose', gap: 0 }, STAGE), 'keine Lücken');
  assert.ok(!e.apply({ type: 'place' }, STAGE), 'ohne Jahr nicht');
  const ti = e.s.turn;
  const y = e.s.song.year;
  assert.ok(e.apply({ type: 'place', year: y + 1 }, STAGE));
  assert.strictEqual(e.s.phase, 'reveal', 'kein Einspruch');
  assert.deepStrictEqual([e.s.last.diff, e.s.last.points], [1, 2]);
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.teams[ti].points, 2);
  assert.strictEqual(e.s.teams[ti].cards.length, 2, 'Karte zur Erinnerung');
  assert.ok(!e.apply({ type: 'year', year: 1800 }, STAGE));
  playToEnd(e, () => true);
  assert.ok(e.winners()[0].progress >= 10);
});

console.log('Hit Story – Handys');

test('Lobby: Handys treten bei, mindestens 2 Personen', () => {
  const e = phones({}, ['a'], { start: false });
  assert.strictEqual(e.s.phase, 'lobby');
  assert.ok(e.lobbyProblem());
  assert.ok(!e.apply({ type: 'start' }, STAGE));
  e.connect('b', 'Ben');
  assert.strictEqual(e.lobbyProblem(), null);
  assert.ok(!e.apply({ type: 'start' }, 'a'), 'nur der Laptop startet');
  assert.ok(e.apply({ type: 'start' }, STAGE));
  assert.deepStrictEqual(e.s.teams.map((t) => t.name), ['A', 'Ben']);
});

test('später Beitretende schauen zu, Wiederverbinden behält den Platz', () => {
  const e = phones({}, ['a', 'b']);
  e.connect('z', 'Zoe');
  assert.ok(e.s.members.z.watch);
  assert.strictEqual(e.teamOf('z'), null);
  e.disconnect('a');
  assert.ok(!e.isOnline('a'));
  e.connect('a', 'Anna');
  assert.strictEqual(e.teamOf('a'), 0);
  assert.strictEqual(e.s.teams[0].name, 'Anna');
});

test('Lücke wählen nur das aktive Handy (oder der Laptop)', () => {
  const e = phones({}, ['a', 'b', 'c']);
  assert.ok(!e.apply({ type: 'choose', gap: 0 }, otherPid(e)));
  assert.ok(e.apply({ type: 'choose', gap: 0 }, activePid(e)));
  assert.ok(e.apply({ type: 'choose', gap: 1 }, STAGE));
});

test('Gefilterte Ansicht: Song-Daten vor der Auflösung auf keinem Handy', () => {
  const e = phones({ jokers: 2 }, ['a', 'b', 'c']);
  const check = () => {
    for (const pid of ['a', 'b', 'c']) {
      const v = e.viewFor(pid);
      const json = JSON.stringify(v);
      assert.strictEqual(v.song, null, pid);
      assert.strictEqual(v.nextSong, null, pid);
      for (const song of [e.s.song, e.s.next]) {
        assert.ok(!json.includes(JSON.stringify(song.title)), `${pid} sieht den Titel ${song.title}`);
        assert.ok(!json.includes(JSON.stringify(song.artist)) || e.s.teams.some((t) => t.cards.some((c) => c.artist === song.artist)), `${pid} sieht den Interpreten`);
        assert.ok(!json.includes(song.id), `${pid} sieht die ID`);
      }
    }
  };
  check();
  e.apply({ type: 'guess', title: 'Irgendwas', artist: 'Wer' }, activePid(e));
  assert.strictEqual(e.viewFor(otherPid(e)).myGuess, null, 'andere sehen den Tipp nicht');
  assert.strictEqual(e.viewFor(activePid(e)).myGuess.title, 'Irgendwas');
  e.apply({ type: 'place', gap: 0 }, activePid(e));
  assert.strictEqual(e.s.phase, 'challenge');
  check();
  const stage = e.viewFor(STAGE);
  assert.strictEqual(stage.song.id, e.s.song.id, 'die Bühne braucht den Song für den Ausschnitt');
  assert.strictEqual(stage.nextSong.id, e.s.next.id, 'und den nächsten zum Vorladen');
  e.apply({ type: 'reveal' }, STAGE);
  assert.strictEqual(e.viewFor('a').song.title, e.s.song.title, 'nach der Auflösung sehen es alle');
});

test('DJ-Handy (Selbst abspielen) sieht Titel und Interpret, aber nie das Jahr', () => {
  const e = phones({ audio: 'manual' }, ['a', 'b', 'c']);
  const dj = e.djMember();
  assert.ok(dj && e.teamOf(dj) !== e.s.turn);
  const v = e.viewFor(dj);
  assert.deepStrictEqual(Object.keys(v.djSong).sort(), ['artist', 'id', 'title']);
  assert.strictEqual(v.song, null);
  for (const pid of ['a', 'b', 'c'].filter((p) => p !== dj)) assert.strictEqual(e.viewFor(pid).djSong, null);
  // Der DJ darf einen Song ersetzen, aber keinen Einspruch einlegen
  assert.ok(e.apply({ type: 'replace', id: e.s.song.id }, dj));
  e.apply({ type: 'place', gap: 0 }, activePid(e));
  if (e.s.phase === 'challenge') assert.ok(!e.viewFor(STAGE).challengers.includes(e.teamOf(dj)));
});

test('Titel tippen: richtig → +1 Joker automatisch, Spielleitung kann korrigieren', () => {
  const e = phones({ jokers: 0 }, ['a', 'b']);
  const pid = activePid(e);
  const ti = e.s.turn;
  const song = e.s.song;
  assert.ok(e.apply({ type: 'place', gap: rightGap(e), title: song.title.toLowerCase(), artist: song.artist }, pid));
  assert.strictEqual(e.s.phase, 'reveal', 'niemand hat Joker → kein Einspruch');
  assert.ok(e.s.last.named && e.s.last.namedAuto);
  assert.ok(e.apply({ type: 'named', ok: false }, STAGE));
  assert.ok(e.apply({ type: 'named', ok: true }, e.leadPid()));
  const notLead = ['a', 'b'].find((p) => p !== e.leadPid());
  assert.ok(!e.apply({ type: 'named', ok: false }, notLead), 'nur Laptop oder Spielleitung');
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.teams[ti].jokers, 1);
});

test('Titel falsch getippt → kein Joker', () => {
  const e = phones({ jokers: 0 }, ['a', 'b']);
  const pid = activePid(e);
  const ti = e.s.turn;
  e.apply({ type: 'place', gap: rightGap(e), title: 'Völlig falsch', artist: e.s.song.artist }, pid);
  assert.strictEqual(e.s.last.named, false);
  assert.strictEqual(e.s.last.check.artist, 'yes');
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.teams[ti].jokers, 0);
});

test('Einspruch-Zeit: läuft ab → Auflösung', () => {
  const e = phones({ jokers: 2 }, ['a', 'b', 'c']);
  e.apply({ type: 'place', gap: 0 }, activePid(e));
  assert.strictEqual(e.s.phase, 'challenge');
  assert.strictEqual(e.s.challengeEnd, e.clock() + CHALLENGE_MS);
  e.clock.add(CHALLENGE_MS - 1);
  assert.ok(!e.tick());
  e.clock.add(2);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'reveal');
});

test('Einspruch per Handy: wer zuerst drückt, Joker-Abzug, Karte wandert', () => {
  const e = phones({ jokers: 2 }, ['a', 'b', 'c'], { seed: 13 });
  const active = e.s.turn;
  const p1 = e.s.teams[(active + 1) % 3].members[0];
  const p2 = e.s.teams[(active + 2) % 3].members[0];
  const song = e.s.song;
  e.apply({ type: 'place', gap: wrongGap(e) }, activePid(e));
  assert.ok(!e.apply({ type: 'challenge', gap: rightGap(e) }, activePid(e)), 'nicht beim eigenen Zug');
  assert.ok(e.apply({ type: 'challenge', gap: rightGap(e) }, p1));
  assert.ok(!e.apply({ type: 'challenge', gap: rightGap(e) }, p2), 'nur der erste Einspruch zählt');
  assert.strictEqual(e.s.challenge.by, p1);
  assert.strictEqual(e.s.teams[e.teamOf(p1)].jokers, 1);
  assert.strictEqual(e.s.teams[e.teamOf(p2)].jokers, 2);
  e.apply({ type: 'next' }, STAGE);
  assert.ok(e.s.teams[e.teamOf(p1)].cards.some((c) => c.id === song.id));
});

test('Spielleitung am Handy: das erste Handy darf weiterschalten, andere nicht', () => {
  const e = phones({ jokers: 0 }, ['a', 'b', 'c']);
  assert.strictEqual(e.leadPid(), 'a');
  e.apply({ type: 'place', gap: 0 }, STAGE);
  assert.ok(!e.apply({ type: 'next' }, 'b'));
  assert.ok(e.apply({ type: 'next' }, 'a'));
});

test('Teams: geteilter Zeitstrahl, ausgeglichen verteilt, Wechsel in der Lobby, Mitglieder wechseln sich ab', () => {
  const e = phones({ teams: 2, jokers: 2 }, ['a', 'b', 'c', 'd'], { start: false });
  assert.deepStrictEqual(['a', 'b', 'c', 'd'].map((p) => e.s.members[p].team), [0, 1, 0, 1]);
  assert.ok(e.apply({ type: 'team', team: 1 }, 'a'));
  assert.ok(!e.apply({ type: 'team', team: 5 }, 'a'));
  assert.ok(e.apply({ type: 'team', player: 'a', team: 0 }, STAGE));
  e.apply({ type: 'start' }, STAGE);
  assert.strictEqual(e.s.teams.length, 2);
  assert.deepStrictEqual(e.s.teams.map((t) => t.members), [['a', 'c'], ['b', 'd']]);
  assert.deepStrictEqual(e.s.teams.map((t) => t.name), ['Team Rot', 'Team Blau']);
  const ti = e.s.turn;
  const [m1, m2] = e.s.teams[ti].members;
  assert.ok(e.apply({ type: 'choose', gap: 0 }, m2), 'jedes Mitglied darf');
  assert.ok(!e.apply({ type: 'choose', gap: 0 }, e.s.teams[1 - ti].members[0]));
  const first = e.speaker();
  assert.strictEqual(first, m1);
  turn(e, true);
  turn(e, true);
  assert.strictEqual(e.speaker(), m2, 'beim nächsten Mal tippt das andere Mitglied');
});

test('Teams: nur ein Team besetzt → kein Start', () => {
  const e = phones({ teams: 2 }, ['a', 'b'], { start: false });
  e.apply({ type: 'team', team: 0 }, 'b');
  assert.match(e.lobbyProblem(), /zwei Teams/);
});

test('Einstellungen in der Lobby: nur der Laptop, Spielweise bleibt', () => {
  const e = phones({}, ['a', 'b'], { start: false });
  assert.ok(!e.apply({ type: 'settings', settings: { target: 5 } }, 'a'));
  assert.ok(e.apply({ type: 'settings', settings: { target: 5, input: 'one', teams: 2 } }, STAGE));
  assert.strictEqual(e.s.settings.target, 5);
  assert.strictEqual(e.s.settings.input, 'phones');
  assert.deepStrictEqual(['a', 'b'].map((p) => e.s.members[p].team), [0, 1]);
});

test('Hinauswerfen: Person verlässt das Spiel, Zeitstrahl bleibt', () => {
  const e = phones({ teams: 2 }, ['a', 'b', 'c', 'd']);
  const kicked = [];
  e.hooks.onKick = (pid) => kicked.push(pid);
  assert.ok(e.apply({ type: 'kick', player: 'c' }, STAGE));
  assert.deepStrictEqual(kicked, ['c']);
  assert.strictEqual(e.teamOf('c'), null);
  assert.strictEqual(e.s.teams.length, 2);
});

test('Nach dem Spiel zurück in die Lobby: Zuschauer spielen mit', () => {
  const e = phones({ target: 5, jokers: 0 }, ['a', 'b']);
  e.connect('z', 'Zoe');
  playToEnd(e, () => true);
  assert.ok(e.apply({ type: 'lobby' }, STAGE));
  assert.strictEqual(e.s.phase, 'lobby');
  assert.ok(!e.s.members.z.watch);
  e.apply({ type: 'start' }, STAGE);
  assert.strictEqual(e.s.teams.length, 3);
});

test('Auszeichnungen: Zeitreise, Musiklexikon, Besserwisser', () => {
  const e = one({}, { n: 3 });
  e.s.teams[0].stats.best = 4;
  e.s.teams[1].stats.named = 2;
  e.s.teams[2].stats.challengeWins = 1;
  e.s.teams[2].stats.best = 4;
  const a = Object.fromEntries(e.awards().map((x) => [x.id, x.teams]));
  assert.deepStrictEqual(a, { time: [0, 2], lexikon: [1], besser: [2] });
});

console.log('Hit Story – Audio');

const SONG = { id: 'toto:africa', title: 'Africa', artist: 'Toto', year: 1982, alts: [] };
const hit = (o) => Object.assign({ kind: 'song', trackName: 'Africa', artistName: 'Toto', collectionName: 'Toto IV', releaseDate: '1982-04-08T08:00:00Z', previewUrl: 'https://x/p.m4a', trackViewUrl: 'https://music.apple.com/x' }, o);

test('iTunes-Treffer: richtiger Interpret und Titel, keine Live-/Karaoke-Fassung, nah am Jahr', () => {
  const r = AudioSource.pick(
    [
      hit({ artistName: 'Weezer', previewUrl: 'https://x/weezer.m4a' }),
      hit({ trackName: 'Africa (Live)', previewUrl: 'https://x/live.m4a' }),
      hit({ artistName: 'Karaoke Hits', previewUrl: 'https://x/karaoke.m4a' }),
      hit({ releaseDate: '2008-01-01T00:00:00Z', collectionName: 'Greatest Hits', previewUrl: 'https://x/best.m4a' }),
      hit({}),
      hit({ trackName: 'Rosanna', previewUrl: 'https://x/rosanna.m4a' }),
    ],
    SONG
  );
  assert.strictEqual(r.url, 'https://x/p.m4a');
  assert.strictEqual(r.storeUrl, 'https://music.apple.com/x');
  assert.strictEqual(AudioSource.pick([hit({ previewUrl: null })], SONG), null);
  assert.strictEqual(AudioSource.pick([], SONG), null);
});

test('iTunes-Treffer: Interpret „feat.“ und Klammerzusatz im Titel', () => {
  const song = { title: 'Sweet Dreams (Are Made of This)', artist: 'Eurythmics', year: 1983, alts: ['Sweet Dreams'] };
  assert.ok(AudioSource.pick([hit({ trackName: 'Sweet Dreams (Are Made of This) [Remastered]', artistName: 'Eurythmics, Annie Lennox & Dave Stewart', releaseDate: '1983-01-04T08:00:00Z' })], song));
  const valerie = { title: 'Valerie', artist: 'Mark Ronson feat. Amy Winehouse', year: 2007, alts: [] };
  assert.ok(AudioSource.pick([hit({ trackName: 'Valerie (feat. Amy Winehouse)', artistName: 'Mark Ronson', releaseDate: '2007-04-16T07:00:00Z' })], valerie));
});

test('iTunes: find fragt die Suche mit Interpret + Titel ab (ohne Netz, mit Attrappe)', async () => {
  const urls = [];
  const fakeFetch = async (url) => {
    urls.push(url);
    return { ok: true, json: async () => ({ results: [hit({})] }) };
  };
  const r = await AudioSource.itunes.find(SONG, { fetch: fakeFetch, cache: false });
  assert.strictEqual(r.url, 'https://x/p.m4a');
  assert.ok(urls[0].startsWith('https://itunes.apple.com/search?'));
  assert.ok(urls[0].includes('term=Toto+Africa') && urls[0].includes('country=de') && urls[0].includes('entity=song'));
  const none = await AudioSource.itunes.find(SONG, { fetch: async () => ({ ok: true, json: async () => ({ results: [] }) }), cache: false });
  assert.strictEqual(none, null);
  await assert.rejects(AudioSource.itunes.find(SONG, { fetch: async () => ({ ok: false, status: 429 }), cache: false }), /429/);
});

test('Such-Links: Interpret + Titel, ohne Klammerzusatz, sauber kodiert', () => {
  assert.strictEqual(AudioSource.query({ title: 'Sweet Dreams (Are Made of This)', artist: 'Eurythmics' }), 'Eurythmics Sweet Dreams');
  const links = AudioSource.searchLinks({ title: 'Rock & Roll', artist: 'AC/DC' });
  assert.deepStrictEqual(links.map((l) => l.id), AudioSource.SERVICE_IDS);
  for (const l of links) assert.ok(l.url.startsWith('https://') && l.url.includes('AC%2FDC%20Rock%20%26%20Roll'), l.url);
});

test('AudioSource.manual liefert nur Links, kein Audio', async () => {
  const r = await AudioSource.manual.find({ title: 'Africa', artist: 'Toto' });
  assert.strictEqual(r.manual, true);
  assert.strictEqual(r.url, undefined);
});

console.log('Hit Story – Seite');

test('index.html und sw.js laden jede Song-Datei und alle Skripte', () => {
  const dir = path.join(__dirname, '..', 'hit-story');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
  for (const f of fs.readdirSync(SONG_DIR).filter((f) => f.endsWith('.js'))) {
    assert.ok(html.includes(`../shared/songs/${f}`), 'index.html: ' + f);
    assert.ok(sw.includes(`'../shared/songs/${f}'`), 'sw.js: ' + f);
  }
  for (const src of html.match(/src="[^"]+\.js"/g).map((m) => m.slice(5, -1))) {
    assert.ok(fs.existsSync(path.join(dir, src)), 'fehlt: ' + src);
    assert.ok(sw.includes(`'${src}'`), 'sw.js cacht nicht: ' + src);
  }
});

Promise.all(pending)
  .then(() => console.log(`\n${passed} Tests bestanden.`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
