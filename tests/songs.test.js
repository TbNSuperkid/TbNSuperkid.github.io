'use strict';
/* Tests für die gemeinsame Song-Datenbank (Hit Story & weitere Musikspiele, ohne Browser): node tests/songs.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

globalThis.window = globalThis;
const SHARED = path.join(__dirname, '..', 'shared');
require(path.join(SHARED, 'songs.js'));
const Songs = globalThis.Songs;
for (const c of Songs.CATEGORY_IDS) require(path.join(SHARED, 'songs', c + '.js'));

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

/** Wiederholbarer Zufall */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Alle Datenzeilen einer Kategorie (ohne Kommentare und Leerzeilen) */
function rawLines(cat) {
  return String(globalThis.SONGS[cat] || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

console.log('Song-Datenbank');

/* ---------- Einlesen ---------- */

test('parseLine liest volle und kurze Zeilen', () => {
  const full = Songs.parseLine('Bad Romance | Lady Gaga | 2009 | 1 | Romance; Bad | Böse Romanze | Eine Frau verliebt sich.', 'x');
  assert.deepStrictEqual(full, {
    id: 'lady-gaga:bad-romance',
    cat: 'x',
    title: 'Bad Romance',
    artist: 'Lady Gaga',
    year: 2009,
    decade: 2000,
    level: 1,
    alts: ['Romance', 'Bad'],
    translation: 'Böse Romanze',
    text: 'Eine Frau verliebt sich.',
  });
  const short = Songs.parseLine('Atemlos durch die Nacht | Helene Fischer | 2013 | 1', 'deutsch');
  assert.strictEqual(short.year, 2013);
  assert.deepStrictEqual(short.alts, []);
  assert.strictEqual(short.translation, '');
  assert.strictEqual(short.text, '');
});

test('parseLine lehnt kaputte Zeilen ab', () => {
  const bad = [
    'Nur Titel | Interpret | 2000',
    ' | Interpret | 2000 | 1',
    'Titel |  | 2000 | 1',
    'Titel | Interpret | 99 | 1',
    'Titel | Interpret | 2000a | 1',
    'Titel | Interpret | 1949 | 1',
    'Titel | Interpret | ' + (Songs.MAX_YEAR + 1) + ' | 1',
    'Titel | Interpret | 2000 | 4',
    'Titel | Interpret | 2000 | 1.5',
    'Titel | Interpret | 2000 | 1 | a | b | c | d',
  ];
  for (const line of bad) assert.strictEqual(Songs.parseLine(line, 'x'), null, line);
});

test('IDs: Umlaute, Akzente und Satzzeichen werden vereinheitlicht', () => {
  assert.strictEqual(Songs.songId('Männer', 'Herbert Grönemeyer'), 'herbert-groenemeyer:maenner');
  assert.strictEqual(Songs.songId('My Heart Will Go On', 'Céline Dion'), 'celine-dion:my-heart-will-go-on');
  assert.strictEqual(Songs.songId('...Baby One More Time', 'Britney Spears'), 'britney-spears:baby-one-more-time');
  assert.notStrictEqual(Songs.songId('Dynamite', 'Taio Cruz'), Songs.songId('Dynamite', 'BTS'));
});

test('Jahrzehnte', () => {
  assert.strictEqual(Songs.decadeOf(1989), 1980);
  assert.strictEqual(Songs.decadeOf(2000), 2000);
  assert.strictEqual(Songs.decadeLabel(1980), '80er');
  assert.strictEqual(Songs.decadeLabel(2010), '2010er');
  assert.strictEqual(Songs.DECADES[0], 1950);
  assert.ok(Songs.DECADES.includes(2020));
});

/* ---------- Datenbank ---------- */

test('jede Datei ist geladen und jede Zeile gültig', () => {
  for (const cat of Songs.CATEGORY_IDS) {
    const lines = rawLines(cat);
    assert.ok(lines.length > 0, 'Kategorie leer: ' + cat);
    for (const line of lines) assert.ok(Songs.parseLine(line, cat), cat + ': ungültige Zeile „' + line + '“');
    assert.strictEqual(Songs.all()[cat].length, lines.length, cat);
  }
});

test('es gibt mindestens 1000 Songs', () => {
  assert.ok(Songs.list().length >= 1000, 'nur ' + Songs.list().length + ' Songs');
});

test('kein Song doppelt (auch nicht über Kategorien hinweg)', () => {
  const seen = new Map();
  for (const cat of Songs.CATEGORY_IDS) {
    for (const s of Songs.all()[cat]) {
      assert.ok(!seen.has(s.id), 'doppelt: ' + s.artist + ' – ' + s.title + ' (' + seen.get(s.id) + ' und ' + cat + ')');
      seen.set(s.id, cat);
    }
  }
});

test('Jahr passt zur Kategorie', () => {
  for (const c of Songs.CATEGORIES) {
    for (const s of Songs.all()[c.id]) {
      assert.ok(s.year >= c.from && s.year <= c.to, c.id + ': ' + s.title + ' (' + s.year + ')');
    }
  }
});

test('Felder sind sauber: keine Links, keine doppelten Leerzeichen, Antworten ≠ Titel', () => {
  for (const s of Songs.list()) {
    const all = [s.title, s.artist, s.translation, s.text].concat(s.alts);
    for (const f of all) {
      assert.ok(!/https?:|www\./i.test(f), 'Link in ' + s.title);
      assert.ok(!/\s{2,}/.test(f), 'doppeltes Leerzeichen in ' + s.title);
    }
    assert.ok(!s.alts.includes(s.title), 'Antwort gleich Titel: ' + s.title);
    assert.strictEqual(new Set(s.alts).size, s.alts.length, 'Antwort doppelt: ' + s.title);
  }
});

test('Jahrzehnte 1960–2020 sind gleichmäßig gefüllt', () => {
  const st = Songs.stats();
  const main = [1960, 1970, 1980, 1990, 2000, 2010];
  for (const d of main) assert.ok(st.decades[d] >= 30, Songs.decadeLabel(d) + ': nur ' + st.decades[d]);
  assert.ok(st.decades[2020] >= 20, '2020er: nur ' + st.decades[2020]);
  const counts = main.map((d) => st.decades[d]);
  assert.ok(Math.max(...counts) <= 2 * Math.min(...counts), 'Jahrzehnte zu ungleich: ' + counts.join(', '));
});

test('Stufen: genug leichte Songs, alle Stufen vorhanden', () => {
  const st = Songs.stats();
  // „Bekannt“ braucht genug Songs; Deutschrap & aktuelle Hits sind bewusst oft Stufe 2–3
  assert.ok(st.levels[1] >= 250 && st.levels[1] >= st.total * 0.25, 'zu wenig Stufe 1: ' + st.levels[1]);
  assert.ok(st.levels[2] > 0 && st.levels[3] > 0);
});

/*
 * Stichproben bekannter Fallen: Coverversionen (die bekannte Version zählt), Songs, die Jahre später wieder in
 * den Charts waren, und Songs, die im Jahr vor dem großen Hit erschienen sind.
 */
const TRAPS = [
  ['Soft Cell', 'Tainted Love', 1981], // Original 1964
  ['Whitney Houston', 'I Will Always Love You', 1992], // Dolly Parton 1974
  ['Fugees', 'Killing Me Softly', 1996], // Roberta Flack 1973
  ['Natalie Imbruglia', 'Torn', 1997], // Ednaswap 1995
  ["Sinéad O'Connor", 'Nothing Compares 2 U', 1990], // The Family 1985
  ['Mark Ronson feat. Amy Winehouse', 'Valerie', 2007], // The Zutons 2006
  ['DJ Ötzi & Nik P.', 'Ein Stern (… der deinen Namen trägt)', 2007], // Nik P. 1998
  ['Aretha Franklin', 'Respect', 1967], // Otis Redding 1965
  ['Kate Bush', 'Running Up That Hill', 1985], // Stranger Things 2022
  ['Sophie Ellis-Bextor', 'Murder on the Dancefloor', 2001], // Saltburn 2024
  ['Taylor Swift', 'Cruel Summer', 2019], // Single erst 2023
  ['Wham!', 'Last Christmas', 1984], // jedes Jahr wieder in den Charts
  ['Queen', 'Bohemian Rhapsody', 1975], // Wiederveröffentlichung 1991
  ['Queen', "Don't Stop Me Now", 1978], // Album „Jazz“ 1978, Single 1979
  ['Eagles', 'Hotel California', 1976], // Album 1976, Single 1977
  ['Michael Jackson', 'Billie Jean', 1982], // Album 1982, Single 1983
  ['Bee Gees', "Stayin' Alive", 1977], // Film 1978
  ['Scorpions', 'Wind of Change', 1990], // Single 1991
  ['Radiohead', 'Creep', 1992], // Wiederveröffentlichung 1993
  ['The Killers', 'Mr. Brightside', 2003], // Album 2004
  ['Adele', 'Rolling in the Deep', 2010], // Album „21“ 2011
  ['Carly Rae Jepsen', 'Call Me Maybe', 2011], // weltweiter Hit 2012
  ['Lil Nas X', 'Old Town Road', 2018], // Remix 2019
  ['The Weeknd', 'Blinding Lights', 2019], // Hit 2020
  ['Helene Fischer', 'Atemlos durch die Nacht', 2013],
  ['Status Quo', "Rockin' All Over the World", 1977], // John Fogerty 1975
  ['Joan Jett & the Blackhearts', "I Love Rock 'n' Roll", 1981], // The Arrows 1975
  ['Rage Against the Machine', 'Killing in the Name', 1992], // UK-Weihnachts-Nummer-1 2009
  ['Måneskin', "Beggin'", 2017], // The Four Seasons 1967, Welthit 2021
  ['Harold Faltermeyer', 'Axel F', 1984], // Crazy Frog 2005
  ['Crazy Frog', 'Axel F', 2005],
  ['Tony Christie', '(Is This the Way to) Amarillo', 1971], // wieder ein Hit 2005
  ['Lady Gaga', 'Bloody Mary', 2011], // „Wednesday“ 2022
  ['The Contours', 'Do You Love Me', 1962], // „Dirty Dancing“ 1987
  ['Tim Toupet', 'So ein schöner Tag (Fliegerlied)', 2010], // Donikkl 2005
  ['Timbaland feat. OneRepublic', 'Apologize', 2007], // OneRepublic 2006
  ['Bryan Adams', "Summer of '69", 1984], // Single 1985
  ['Fleetwood Mac', 'Go Your Own Way', 1976], // Album „Rumours“ 1977
  ['a-ha', 'Take On Me', 1985], // erste Fassung 1984
  ['Los del Río', 'Macarena', 1995], // Original 1993
  ['Pet Shop Boys', 'West End Girls', 1985], // erste Fassung 1984
  ['Nena & Kim Wilde', 'Anyplace, Anywhere, Anytime', 2002], // Nena allein 1985
  ['Bushido feat. Karel Gott', 'Für immer jung', 2008], // Alphaville 1984
  ['AnnenMayKantereit & Giant Rooks', "Tom's Diner", 2019], // Suzanne Vega 1987
  ['Connie Francis', 'Pretty Little Baby', 1962], // viral 2025
  ['Chappell Roan', 'Pink Pony Club', 2020], // Welthit 2024
  ['Pitbull feat. Kesha', 'Timber', 2013], // „Global Warming“ 2012, Song erst auf „Meltdown“
  ["The B-52's", 'Love Shack', 1989],
  ['Bonez MC & RAF Camora', 'Palmen aus Plastik', 2016],
];

test('Stichproben bekannter Fallen haben das richtige Jahr', () => {
  for (const [artist, title, year] of TRAPS) {
    const s = Songs.byId(Songs.songId(title, artist));
    assert.ok(s, 'fehlt: ' + artist + ' – ' + title);
    assert.strictEqual(s.year, year, artist + ' – ' + title);
  }
});

/* ---------- Filtern ---------- */

test('filter: ohne Auswahl alle Songs', () => {
  assert.strictEqual(Songs.filter().length, Songs.list().length);
  assert.strictEqual(Songs.filter({ cats: [], decades: [] }).length, Songs.list().length);
});

test('filter: Kategorien, Jahrzehnte und Stufe', () => {
  const de = Songs.filter({ cats: ['deutsch'] });
  assert.ok(de.length > 0 && de.every((s) => s.cat === 'deutsch'));
  const eighties = Songs.filter({ decades: [1980] });
  assert.ok(eighties.some((s) => s.cat === 'deutsch') && eighties.some((s) => s.cat === 'charts-80er'));
  assert.ok(eighties.every((s) => s.decade === 1980));
  const easy = Songs.filter({ cats: ['charts-90er'], level: 'easy' });
  assert.ok(easy.length > 0 && easy.every((s) => s.level === 1 && s.cat === 'charts-90er'));
  const hard = Songs.filter({ level: 'hard' });
  assert.ok(hard.every((s) => s.level >= 2));
});

test('filter: unbekannte Werte werden ignoriert, passt keine Stufe → Stufe egal', () => {
  assert.strictEqual(Songs.filter({ cats: ['gibtsnicht'], decades: [1234] }).length, Songs.list().length);
  const saved = globalThis.SONGS;
  try {
    globalThis.SONGS = { deutsch: 'A | X | 1980 | 1\nB | Y | 1981 | 1\nC | Z | 1995 | 3' };
    Songs._reset();
    // In den 80ern gibt es nur Stufe 1 → „schwer“ fällt auf alle 80er zurück
    assert.deepStrictEqual(Songs.filter({ decades: [1980], level: 'hard' }).map((s) => s.title), ['A', 'B']);
    assert.deepStrictEqual(Songs.filter({ level: 'hard' }).map((s) => s.title), ['C']);
    assert.deepStrictEqual(Songs.filter({ decades: [2020] }), []);
  } finally {
    globalThis.SONGS = saved;
    Songs._reset();
  }
});

/* ---------- Ziehen ---------- */

test('draw: kein Song doppelt, „used“ wird ergänzt, am Ende null', () => {
  const pool = Songs.filter({ cats: ['charts-2020er'] });
  const used = [];
  const rnd = seeded(7);
  const got = new Set();
  for (let i = 0; i < pool.length; i++) {
    const s = Songs.draw(pool, used, { random: rnd });
    assert.ok(s, 'Song ' + i);
    assert.ok(!got.has(s.id), 'doppelt: ' + s.id);
    got.add(s.id);
  }
  assert.strictEqual(used.length, pool.length);
  assert.strictEqual(Songs.draw(pool, used, { random: rnd }), null);
  assert.strictEqual(Songs.draw([], [], { random: rnd }), null);
});

test('draw: liefert eine Kopie (Datenbank bleibt unverändert)', () => {
  const pool = Songs.filter({ cats: ['deutsch'] });
  const s = Songs.draw(pool, [], { random: () => 0 });
  s.alts.push('xyz');
  s.title = 'geändert';
  const orig = Songs.byId(s.id);
  assert.notStrictEqual(orig.title, 'geändert');
  assert.ok(!orig.alts.includes('xyz'));
});

test('draw: mit spread kommen alle Jahrzehnte ungefähr gleich oft', () => {
  const pool = Songs.filter({ decades: [1960, 1970, 1980, 1990, 2000, 2010, 2020] });
  const rnd = seeded(42);
  const count = {};
  const N = 7000;
  for (let i = 0; i < N; i++) {
    const s = Songs.draw(pool, null, { random: rnd });
    count[s.decade] = (count[s.decade] || 0) + 1;
  }
  for (const d of Object.keys(count)) assert.ok(count[d] > N / 7 * 0.8 && count[d] < N / 7 * 1.2, d + ': ' + count[d]);
});

test('draw: ohne spread zählt jeder Song gleich', () => {
  const pool = Songs.filter({ decades: [1950, 2010] });
  const rnd = seeded(3);
  let fifties = 0;
  const N = 5000;
  for (let i = 0; i < N; i++) if (Songs.draw(pool, null, { random: rnd, spread: false }).decade === 1950) fifties++;
  const expected = pool.filter((s) => s.decade === 1950).length / pool.length;
  assert.ok(Math.abs(fifties / N - expected) < 0.03, fifties / N + ' statt ' + expected);
});

/* ---------- Dateien ---------- */

test('jede Kategorie hat eine Datei, keine Datei ohne Kategorie', () => {
  const files = fs
    .readdirSync(path.join(SHARED, 'songs'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.slice(0, -3))
    .sort();
  assert.deepStrictEqual(files, Songs.CATEGORY_IDS.slice().sort());
});

const st = Songs.stats();
console.log(
  '\n' + passed + ' Tests bestanden – ' + st.total + ' Songs (' +
    Songs.DECADES.filter((d) => st.decades[d]).map((d) => Songs.decadeLabel(d) + ' ' + st.decades[d]).join(', ') + ')'
);
