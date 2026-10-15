'use strict';
/* Tests für „Who knows more?“ (ohne Browser): node tests/who-knows-more.test.js */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
require(path.join(__dirname, '..', 'shared', 'match.js'));
for (const f of ['questions/katalog', 'questions/wissen', 'questions/pop', 'questions/gaming', 'questions/alltag', 'questions/schule', 'questions/wort', 'questions/adult', 'board', 'engine']) {
  require(path.join(__dirname, '..', 'who-knows-more', 'js', f + '.js'));
}
const M = globalThis.GameMatch;
const Board = globalThis.WKMBoard;
const { Engine, STAGE, OPEN_MS, BUZZ_WINDOW_MS, FINAL_MS, EARLY_LOCK_MS } = globalThis.WKMEngine;

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

/* ---------- Hilfen ---------- */

function clock(start) {
  let t = start || 1_000_000;
  const now = () => t;
  now.add = (ms) => (t += ms);
  return now;
}

const SAY = { input: 'say' };

/** Spiel ohne Handy: startet sofort */
function sayGame(settings, teams, now) {
  const state = Engine.create({
    settings: Object.assign({}, SAY, settings),
    teams: (teams || ['rot', 'blau']).map((id) => ({ id, active: true, name: 'Team ' + id })),
  });
  return new Engine(state, { timers: false, now: now || clock() });
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
  if (settings && settings.qm) {
    e.connect(settings.qm, 'Quizmaster');
    assert.ok(e.apply({ type: 'becomeQM' }, settings.qm), 'becomeQM');
  }
  assert.ok(e.apply({ type: 'start' }, STAGE), 'start');
  return e;
}

/** Erstes freies Feld (ohne Joker) in einer Reihe */
function plainCell(e, row) {
  const b = e.board();
  for (let col = 0; col < b.cats.length; col++) {
    const c = b.cats[col].cells[row];
    if (!c.done && !c.joker) return { col, row };
  }
  return null;
}

function jokerCell(e) {
  const b = e.board();
  for (let col = 0; col < b.cats.length; col++) {
    for (let row = 0; row < b.cats[col].cells.length; row++) if (b.cats[col].cells[row].joker && !b.cats[col].cells[row].done) return { col, row };
  }
  return null;
}

function pickPlain(e, row, actor) {
  const c = plainCell(e, row || 0);
  assert.ok(e.apply({ type: 'pick', col: c.col, row: c.row }, actor || STAGE), 'pick');
  return c;
}

function score(e, id) {
  return e.team(id).score;
}

/** Alle Felder der Runde abräumen (ohne Punkte) */
function clearRound(e) {
  while (e.s.phase === 'board') {
    const b = e.board();
    let cell = null;
    b.cats.forEach((k, col) => k.cells.forEach((c, row) => !cell && !c.done && (cell = { col, row })));
    assert.ok(e.apply({ type: 'pick', col: cell.col, row: cell.row }, STAGE));
    assert.ok(e.apply({ type: 'resolve' }, STAGE));
    assert.ok(e.apply({ type: 'next' }, STAGE));
  }
}

/* ---------- Katalog ---------- */

console.log('Katalog');

test('jede Kategorie hat 50 Fragen – 10 je Stufe – und jede Frage eine Antwort', () => {
  const c = Board.catalog();
  assert.ok(c.cats.length >= 40, 'mindestens 40 Kategorien, sind ' + c.cats.length);
  for (const k of c.cats) {
    assert.strictEqual(k.cells.length, 50, k.name + ' hat ' + k.cells.length + ' Fragen');
    for (let level = 1; level <= 5; level++) {
      const n = k.cells.filter((x) => x.level === level).length;
      assert.strictEqual(n, 10, `${k.name}: Stufe ${level} hat ${n} Fragen`);
    }
    for (const cell of k.cells) {
      assert.ok(cell.q.length > 3, k.name + ': leere Frage');
      assert.ok(cell.a.length > 0, k.name + ': keine Antwort bei „' + cell.q + '“');
      assert.ok(!cell.a.includes('|'), k.name + ': „|“ in der Antwort bei „' + cell.q + '“');
    }
  }
});

test('über 2000 normale Fragen und 30 Finalfragen', () => {
  const st = Board.stats();
  assert.ok(st.questions >= 2000, 'Fragen: ' + st.questions);
  assert.ok(st.finals >= 30, 'Finalfragen: ' + st.finals);
  assert.ok(st.adultCats >= 6, '18+-Kategorien: ' + st.adultCats);
});

test('Wand: je Stufe eine Frage der richtigen Stufe, Fragen wiederholen sich erst, wenn alle dran waren', () => {
  Board._reset();
  const byQ = new Map();
  for (const k of Board.catalog().cats) for (const c of k.cells) byQ.set(k.name + '|' + c.q, c.level);
  const seen = new Map(); // Kategorie -> gespielte Fragen
  for (let i = 0; i < 60; i++) {
    for (const k of Board.drawCategories(6, {})) {
      const list = seen.get(k.name) || [];
      k.cells.forEach((c, row) => {
        assert.strictEqual(byQ.get(k.name + '|' + c.q), row + 1, `${k.name}: „${c.q}“ in Reihe ${row + 1}`);
        if (list.length < 50) assert.ok(!list.includes(c.q), `${k.name}: „${c.q}“ kam zu früh wieder`);
        list.push(c.q);
      });
      seen.set(k.name, list);
    }
  }
});

test('keine doppelten Fragen oder Kategorien', () => {
  const c = Board.catalog();
  const qs = new Set();
  const names = new Set();
  for (const k of c.cats) {
    assert.ok(!names.has(k.name.toLowerCase()), 'Kategorie doppelt: ' + k.name);
    names.add(k.name.toLowerCase());
    for (const cell of k.cells) {
      const key = cell.q.toLowerCase();
      assert.ok(!qs.has(key), 'Frage doppelt: ' + cell.q);
      qs.add(key);
    }
  }
  for (const f of c.finals) {
    assert.ok(f.cat && f.q && f.a, 'Finalfrage unvollständig: ' + JSON.stringify(f));
    const key = f.q.toLowerCase();
    assert.ok(!qs.has(key), 'Finalfrage doppelt: ' + f.q);
    qs.add(key);
  }
});

test('Gruppen sind bekannt', () => {
  const groups = ['wissen', 'pop', 'gaming', 'alltag', 'schule', 'wort', 'adult'];
  for (const k of Board.catalog().cats) assert.ok(groups.includes(k.group), k.name + ': ' + k.group);
});

/* ---------- Wand ---------- */

console.log('Wand');

test('6×5 Felder, Runde 2 mit doppelten Werten', () => {
  Board._reset();
  const game = Board.buildGame({ source: 'katalog', length: 'normal', cols: 6, joker: true }, null);
  assert.strictEqual(game.rounds.length, 2);
  for (const [r, round] of game.rounds.entries()) {
    assert.strictEqual(round.cats.length, 6);
    for (const k of round.cats) assert.deepStrictEqual(k.cells.map((c) => c.value), [1, 2, 3, 4, 5].map((n) => n * 100 * (r + 1)));
  }
  assert.ok(game.final.q && game.final.a);
});

test('Kurz = 1 Runde, 4 oder 5 Kategorien', () => {
  const g4 = Board.buildGame({ source: 'katalog', length: 'short', cols: 4 }, null);
  assert.strictEqual(g4.rounds.length, 1);
  assert.strictEqual(g4.rounds[0].cats.length, 4);
  assert.strictEqual(Board.buildGame({ source: 'katalog', cols: 5 }, null).rounds[0].cats.length, 5);
});

test('Joker: Runde 1 einer, Runde 2 zwei, nie in der obersten Reihe', () => {
  for (let i = 0; i < 30; i++) {
    const game = Board.buildGame({ source: 'katalog', length: 'normal', cols: 6, joker: true }, null);
    game.rounds.forEach((round, r) => {
      const jokers = [];
      round.cats.forEach((k) => k.cells.forEach((c, row) => c.joker && jokers.push(row)));
      assert.strictEqual(jokers.length, r + 1, 'Runde ' + (r + 1));
      assert.ok(jokers.every((row) => row > 0), 'Joker in Reihe 1');
    });
  }
});

test('Joker aus = keine Joker-Felder', () => {
  const game = Board.buildGame({ source: 'katalog', joker: false }, null);
  assert.ok(game.rounds.every((r) => r.cats.every((k) => k.cells.every((c) => !c.joker))));
});

test('keine Wiederholung innerhalb eines Spiels und über mehrere Spiele', () => {
  Board._reset();
  const normal = Board.catalog().cats.filter((k) => !k.adult).length;
  const seen = new Set();
  const games = Math.floor(normal / 12);
  for (let i = 0; i < games; i++) {
    const game = Board.buildGame({ source: 'katalog', length: 'normal', cols: 6 }, null);
    const names = game.rounds.flatMap((r) => r.cats.map((k) => k.name));
    assert.strictEqual(new Set(names).size, names.length, 'doppelt im Spiel');
    for (const n of names) {
      assert.ok(!seen.has(n), 'Wiederholung über Spiele: ' + n);
      seen.add(n);
    }
  }
  // Danach geht es mit gesehenen Kategorien weiter (Topf wird neu gemischt)
  const more = Board.buildGame({ source: 'katalog', length: 'normal', cols: 6 }, null);
  assert.strictEqual(more.rounds.flatMap((r) => r.cats).length, 12);
});

test('pro Runde höchstens 2 Kategorien aus derselben Gruppe', () => {
  Board._reset();
  const groupOf = new Map(Board.catalog().cats.map((k) => [k.name, k.group]));
  for (let i = 0; i < 10; i++) {
    Board._reset(); // genug Ungesehenes – sonst geht „neu“ vor „abwechslungsreich“
    const cats = Board.drawCategories(6, {});
    const count = {};
    for (const k of cats) count[groupOf.get(k.name)] = (count[groupOf.get(k.name)] || 0) + 1;
    assert.ok(Object.values(count).every((n) => n <= 2), JSON.stringify(count));
  }
});

test('18+: nur wenn eingeschaltet, 2 Kategorien bei 6 Spalten', () => {
  Board._reset();
  const adultNames = new Set(Board.catalog().cats.filter((k) => k.adult).map((k) => k.name));
  for (let i = 0; i < 10; i++) assert.ok(Board.drawCategories(6, {}).every((k) => !adultNames.has(k.name)));
  const withAdult = Board.drawCategories(6, { adult: true });
  assert.strictEqual(withAdult.filter((k) => adultNames.has(k.name)).length, 2);
  assert.strictEqual(Board.drawCategories(4, { adult: true }).filter((k) => adultNames.has(k.name)).length, 1);
});

/* ---------- Antworten prüfen ---------- */

console.log('Antworten prüfen');

test('mehrere erlaubte Antworten, Klammern, Tippfehler', () => {
  assert.ok(Board.checkAnswer('krake', 'Oktopus / Krake / Tintenfisch'));
  assert.ok(Board.checkAnswer('Oktopuss', 'Oktopus / Krake'));
  assert.ok(Board.checkAnswer('Everest', 'Mount Everest / Everest'));
  assert.ok(Board.checkAnswer('Mount Everest', 'Everest'));
  assert.ok(Board.checkAnswer('rot', 'Rot (Tor)'));
  assert.ok(Board.checkAnswer('42,195 km', '42,195 / 42'));
  assert.ok(Board.checkAnswer('vom Stamm', '… vom Stamm'));
  assert.ok(!Board.checkAnswer('Elefant', 'Gepard'));
  assert.ok(!Board.checkAnswer('', 'Gepard'));
  assert.ok(!Board.checkAnswer('a', 'Ankara'));
});

/* ---------- Eigene Wand ---------- */

console.log('Eigene Wand');

function sampleWall() {
  const w = Board.emptyWall();
  w.title = 'Annas Geburtstag 🎂';
  w.rounds[0].cats = [
    { name: 'Anna', cells: [1, 2, 3, 4, 5].map((n) => ({ q: 'Anna Frage ' + n, a: 'A' + n, img: '', joker: n === 3 })) },
    { name: 'Schule', cells: [1, 2, 3, 4, 5].map((n) => ({ q: 'Schule ' + n + ' – „Zitat“ | Pipe', a: 'S' + n, img: n === 1 ? 'https://example.com/bild.png' : '', joker: false })) },
  ];
  w.rounds.push({ cats: [{ name: 'Runde 2', cells: [1, 2, 3, 4, 5].map((n) => ({ q: 'Zwei ' + n, a: 'Z' + n })) }] });
  w.final = { cat: 'Finale', q: 'Wie alt wird Anna?', a: '30' };
  return w;
}

test('Wand prüfen: leere Kategorien fliegen raus, unsichere Bild-Links auch', () => {
  const w = sampleWall();
  w.rounds[0].cats.push(Board.emptyCat());
  w.rounds[0].cats[1].cells[1].img = 'javascript:alert(1)';
  const s = Board.sanitizeWall(w);
  assert.strictEqual(s.rounds[0].cats.length, 2);
  assert.strictEqual(s.rounds[0].cats[1].cells[0].img, 'https://example.com/bild.png');
  assert.strictEqual(s.rounds[0].cats[1].cells[1].img, '');
  assert.strictEqual(Board.sanitizeWall({ rounds: [{ cats: [Board.emptyCat()] }] }), null);
});

test('Export → Import ergibt dieselbe Wand', () => {
  const w = Board.sanitizeWall(sampleWall());
  const back = Board.importJson(Board.exportJson(w));
  assert.notStrictEqual(back.id, w.id, 'neue ID beim Import');
  assert.deepStrictEqual(back.rounds, w.rounds);
  assert.deepStrictEqual(back.final, w.final);
  assert.strictEqual(back.title, w.title);
  assert.strictEqual(Board.importJson('kein json'), null);
});

test('Link → Wand ergibt dieselbe Wand (komprimiert und kurz genug)', async () => {
  const w = Board.sanitizeWall(sampleWall());
  const code = await Board.encodeLink(w);
  assert.ok(code.startsWith('z'), 'komprimiert');
  const back = await Board.decodeLink(code);
  assert.deepStrictEqual(back.rounds, w.rounds);
  assert.deepStrictEqual(back.final, w.final);
  assert.strictEqual(back.title, w.title);
  // Volle Wand: 2 Runden × 6 Kategorien
  const full = Board.emptyWall();
  full.title = 'Voll';
  full.rounds = [0, 1].map((r) => ({
    cats: Array.from({ length: 6 }, (_, k) => ({
      name: 'Kategorie ' + r + k,
      cells: Array.from({ length: 5 }, (_, i) => ({ q: `Eine ganz normale Frage Nummer ${i} in Kategorie ${k}, Runde ${r}?`, a: 'Antwort ' + i })),
    })),
  }));
  const fullCode = await Board.encodeLink(full);
  assert.ok(fullCode.length < 6000, 'Link-Länge ' + fullCode.length);
  assert.deepStrictEqual((await Board.decodeLink(fullCode)).rounds, Board.sanitizeWall(full).rounds);
  assert.strictEqual(await Board.decodeLink('zkaputt!!'), null);
});

test('Wände speichern, auflisten, löschen', () => {
  Board._reset();
  const saved = Board.saveWall(sampleWall());
  assert.strictEqual(Board.listWalls().length, 1);
  assert.strictEqual(Board.getWall(saved.id).title, 'Annas Geburtstag 🎂');
  Board.deleteWall(saved.id);
  assert.strictEqual(Board.listWalls().length, 0);
});

test('eigene Wand im Spiel: Joker aus der Wand, gemischt füllt mit Katalog auf', () => {
  const w = Board.sanitizeWall(sampleWall());
  const custom = Board.buildGame({ source: 'custom', length: 'short', cols: 6, joker: true }, w);
  assert.strictEqual(custom.rounds.length, 2, 'eigene Wand bestimmt die Rundenzahl');
  assert.strictEqual(custom.rounds[0].cats.length, 2);
  assert.ok(custom.rounds[0].cats[0].cells[2].joker, 'markierter Joker');
  assert.strictEqual(custom.rounds[0].cats[0].cells.filter((c) => c.joker).length, 1);
  assert.strictEqual(custom.final.q, 'Wie alt wird Anna?');
  const mixed = Board.buildGame({ source: 'mixed', length: 'normal', cols: 6, joker: true }, w);
  assert.strictEqual(mixed.rounds[0].cats.length, 6);
  assert.strictEqual(mixed.rounds[0].cats[0].name, 'Anna');
  assert.strictEqual(mixed.rounds[1].cats.length, 6);
  assert.strictEqual(mixed.rounds[1].cats[0].name, 'Runde 2');
  assert.strictEqual(mixed.rounds[1].cats[0].cells[4].value, 1000);
});

test('Spiel mit eigener Wand über die Engine', () => {
  const state = Engine.create({ settings: { input: 'say', source: 'custom' }, teams: [{ id: 'rot', active: true }], wall: sampleWall() });
  assert.strictEqual(state.settings.source, 'custom');
  assert.strictEqual(state.rounds[0].cats[0].name, 'Anna');
  const noWall = Engine.create({ settings: { input: 'say', source: 'custom' }, teams: [{ id: 'rot', active: true }] });
  assert.strictEqual(noWall.settings.source, 'katalog', 'ohne Wand → Katalog');
});

/* ---------- Ablauf ohne Handy ---------- */

console.log('Ohne Handy');

test('Start: Wand steht, ein Team ist dran', () => {
  const e = sayGame();
  assert.strictEqual(e.s.phase, 'board');
  assert.ok(['rot', 'blau'].includes(e.s.turn));
  assert.strictEqual(e.s.rounds.length, 2);
});

test('Feld wählen → Lesezeit → Buzzer frei → Buzz → richtig: +Wert, Team wählt weiter', () => {
  const now = clock();
  const e = sayGame({}, ['rot', 'blau'], now);
  e.s.turn = 'rot';
  pickPlain(e, 2);
  assert.strictEqual(e.s.phase, 'read');
  assert.ok(!e.apply({ type: 'buzz', team: 'blau' }, 'jemand'), 'fremde Aktion');
  now.add(8000);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'open');
  assert.ok(e.apply({ type: 'buzz', team: 'blau', reaction: 420 }, STAGE));
  assert.strictEqual(e.s.phase, 'buzzed');
  assert.strictEqual(e.s.cur.buzzed.team, 'blau');
  assert.ok(e.apply({ type: 'judge', ok: true }, STAGE));
  assert.strictEqual(score(e, 'blau'), 300);
  assert.strictEqual(e.s.turn, 'blau');
  assert.strictEqual(e.s.phase, 'reveal');
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.strictEqual(e.s.phase, 'board');
});

test('falsch: −Wert, Buzzer wieder frei für die anderen, gesperrtes Team kann nicht mehr', () => {
  const e = sayGame();
  e.s.turn = 'rot';
  pickPlain(e, 0);
  assert.ok(e.apply({ type: 'open' }, STAGE));
  assert.ok(e.apply({ type: 'buzz', team: 'rot' }, STAGE));
  assert.ok(e.apply({ type: 'judge', ok: false }, STAGE));
  assert.strictEqual(score(e, 'rot'), -100);
  assert.strictEqual(e.s.phase, 'open');
  assert.ok(!e.apply({ type: 'buzz', team: 'rot' }, STAGE), 'rot ist gesperrt');
  assert.ok(e.apply({ type: 'buzz', team: 'blau' }, STAGE));
  assert.ok(e.apply({ type: 'judge', ok: false }, STAGE));
  // Alle falsch → Antwort zeigen, gleiches Team wählt weiter
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(e.s.cur.result.team, null);
  assert.strictEqual(e.s.turn, 'rot');
});

test('ohne Minuspunkte: falsch = 0', () => {
  const e = sayGame({ negative: false });
  pickPlain(e, 4);
  e.apply({ type: 'open' }, STAGE);
  e.apply({ type: 'buzz', team: 'rot' }, STAGE);
  e.apply({ type: 'judge', ok: false }, STAGE);
  assert.strictEqual(score(e, 'rot'), 0);
});

test('niemand buzzert in 10 Sekunden → Antwort, Feld weg, gleiches Team wählt', () => {
  const now = clock();
  const e = sayGame({}, ['rot', 'blau'], now);
  e.s.turn = 'blau';
  const c = pickPlain(e, 1);
  e.apply({ type: 'open' }, STAGE);
  now.add(OPEN_MS + 1);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'reveal');
  assert.ok(e.cell(c.col, c.row).done);
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.turn, 'blau');
});

test('Frühstarter (Taste vor „Buzzer frei“) ist 0,5 s gesperrt', () => {
  const now = clock();
  const e = sayGame({}, ['rot', 'blau'], now);
  pickPlain(e, 0);
  assert.ok(e.apply({ type: 'buzz', team: 'rot' }, STAGE), 'Frühstart wird gezählt');
  assert.strictEqual(e.team('rot').stats.early, 1);
  e.apply({ type: 'open' }, STAGE);
  assert.ok(!e.apply({ type: 'buzz', team: 'rot' }, STAGE), 'noch gesperrt');
  now.add(EARLY_LOCK_MS + 1);
  assert.ok(e.apply({ type: 'buzz', team: 'rot' }, STAGE));
});

test('Antwort zeigen und dann falsch → kein neuer Buzzer', () => {
  const e = sayGame({}, ['rot', 'blau', 'gruen']);
  pickPlain(e, 0);
  e.apply({ type: 'open' }, STAGE);
  e.apply({ type: 'buzz', team: 'gruen' }, STAGE);
  assert.ok(e.apply({ type: 'show' }, STAGE));
  e.apply({ type: 'judge', ok: false }, STAGE);
  assert.strictEqual(e.s.phase, 'reveal');
});

test('Joker: nur das Team am Zug, Einsatz 5 bis Stand (mindestens bis zum höchsten Feldwert)', () => {
  const e = sayGame();
  e.s.turn = 'rot';
  const j = jokerCell(e);
  assert.ok(j.row > 0);
  assert.ok(e.apply({ type: 'pick', col: j.col, row: j.row }, STAGE));
  assert.strictEqual(e.s.phase, 'wager');
  assert.deepStrictEqual(e.jokerRange('rot'), { min: 5, max: 500 }, 'bei 0 Punkten bis 500');
  assert.ok(!e.apply({ type: 'wager', amount: 4 }, STAGE));
  assert.ok(!e.apply({ type: 'wager', amount: 501 }, STAGE));
  assert.ok(e.apply({ type: 'wager', amount: 500 }, STAGE));
  assert.strictEqual(e.s.phase, 'joker');
  assert.ok(!e.apply({ type: 'buzz', team: 'blau' }, STAGE), 'kein Buzzer beim Joker');
  assert.ok(e.apply({ type: 'judge', ok: false }, STAGE));
  assert.strictEqual(score(e, 'rot'), -500);
  assert.strictEqual(e.s.phase, 'reveal');
});

test('Joker-Grenze bei hohem und negativem Stand', () => {
  const e = sayGame();
  e.team('rot').score = 2300;
  e.team('blau').score = -400;
  assert.deepStrictEqual(e.jokerRange('rot'), { min: 5, max: 2300 });
  assert.deepStrictEqual(e.jokerRange('blau'), { min: 5, max: 500 });
  e.s.round = 1;
  assert.deepStrictEqual(e.jokerRange('blau'), { min: 5, max: 1000 });
});

test('Runde 2: Team mit den wenigsten Punkten beginnt', () => {
  const e = sayGame();
  clearRound(e);
  assert.strictEqual(e.s.phase, 'roundEnd');
  e.team('rot').score = 900;
  e.team('blau').score = 200;
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.round, 1);
  assert.strictEqual(e.s.turn, 'blau');
  assert.strictEqual(e.board().cats[0].cells[0].value, 200);
});

test('Finale ohne Handy: nur Teams > 0, Aufdecken vom letzten Platz, Einsatz ≤ Stand', () => {
  const now = clock();
  const e = sayGame({ length: 'short' }, ['rot', 'blau', 'gruen'], now);
  clearRound(e);
  e.team('rot').score = 800;
  e.team('blau').score = 300;
  e.team('gruen').score = 0;
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.phase, 'finalWager');
  assert.deepStrictEqual(e.s.final.eligible, ['rot', 'blau']);
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.phase, 'finalQ');
  now.add(FINAL_MS + 1);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'finalReveal');
  assert.deepStrictEqual(e.s.final.order, ['blau', 'rot']);
  assert.ok(!e.apply({ type: 'finalJudge', ok: true, wager: 400 }, STAGE), 'Einsatz über Stand');
  assert.ok(!e.apply({ type: 'finalJudge', ok: true }, STAGE), 'ohne Handy muss der Einsatz eingetragen werden');
  assert.ok(e.apply({ type: 'finalJudge', ok: true, wager: 300 }, STAGE));
  assert.strictEqual(score(e, 'blau'), 600);
  assert.ok(e.apply({ type: 'finalJudge', ok: false, wager: 500 }, STAGE));
  assert.strictEqual(score(e, 'rot'), 300);
  assert.ok(e.s.final.done);
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.strictEqual(e.s.phase, 'over');
  assert.deepStrictEqual(e.s.winners, ['blau']);
});

test('Finale fällt aus, wenn niemand Punkte hat', () => {
  const e = sayGame({ length: 'short' });
  clearRound(e);
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.phase, 'over');
  assert.ok(e.s.final.skipped);
});

test('Punkte korrigieren, Runde überspringen, Spiel beenden', () => {
  const e = sayGame();
  assert.ok(e.apply({ type: 'adjust', team: 'rot', delta: 200 }, STAGE));
  assert.ok(!e.apply({ type: 'adjust', team: 'rot', delta: 0 }, STAGE));
  assert.strictEqual(score(e, 'rot'), 200);
  assert.ok(e.apply({ type: 'skipRound' }, STAGE));
  assert.strictEqual(e.s.phase, 'roundEnd');
  assert.ok(e.apply({ type: 'end' }, STAGE));
  assert.strictEqual(e.s.phase, 'over');
  assert.ok(e.apply({ type: 'again' }, STAGE));
  assert.strictEqual(e.s.phase, 'board');
  assert.strictEqual(score(e, 'rot'), 0);
});

test('verspätete Klicks (alte Frage) werden ignoriert', () => {
  const e = sayGame();
  pickPlain(e, 0);
  const no = e.s.cur.no;
  e.apply({ type: 'resolve' }, STAGE);
  e.apply({ type: 'next' }, STAGE);
  pickPlain(e, 1);
  assert.ok(!e.apply({ type: 'resolve', no }, STAGE));
  assert.strictEqual(e.s.phase, 'read');
});

/* ---------- Buzzer übers Netz ---------- */

console.log('Mit Handy');

test('Lobby: Team wählen, Start braucht mindestens einen Spieler', () => {
  const state = Engine.create({ settings: { input: 'write' }, teams: [{ id: 'rot', active: true }, { id: 'blau', active: true }] });
  const e = new Engine(state, { timers: false });
  assert.strictEqual(e.s.phase, 'lobby');
  assert.ok(e.lobbyProblem());
  assert.ok(!e.apply({ type: 'start' }, STAGE));
  e.connect('p1', 'Anna');
  e.apply({ type: 'joinTeam', team: 'rot' }, 'p1');
  assert.ok(e.apply({ type: 'start' }, STAGE));
  assert.deepStrictEqual(e.s.order, ['rot'], 'leeres Team spielt nicht mit');
});

test('kleinste Reaktionszeit gewinnt, nicht das schnellste Netz', () => {
  const now = clock();
  const e = writeGame({}, { rot: ['r1'], blau: ['b1'], gruen: ['g1'] }, now);
  pickPlain(e, 0, STAGE);
  now.add(8000);
  e.tick();
  const openId = e.s.cur.openId;
  now.add(600);
  assert.ok(e.apply({ type: 'buzz', openId, reaction: 590 }, 'r1'), 'erster Buzz kommt an');
  assert.strictEqual(e.s.phase, 'open', 'Fenster läuft noch');
  now.add(120);
  assert.ok(e.apply({ type: 'buzz', openId, reaction: 410 }, 'b1'), 'langsames Netz, schnellere Hand');
  now.add(BUZZ_WINDOW_MS);
  assert.ok(!e.apply({ type: 'buzz', openId, reaction: 100 }, 'g1') || e.s.phase === 'buzzed');
  assert.strictEqual(e.s.phase, 'buzzed');
  assert.strictEqual(e.s.cur.buzzed.team, 'blau');
  assert.strictEqual(e.s.cur.buzzed.reaction, 410);
});

test('Reaktionszeit kann nicht kleiner gemogelt werden als „vor dem Öffnen“; falsche openId zählt nicht', () => {
  const now = clock();
  const e = writeGame({}, { rot: ['r1'], blau: ['b1'] }, now);
  pickPlain(e, 0);
  e.apply({ type: 'open' }, STAGE);
  assert.ok(!e.apply({ type: 'buzz', openId: 'alt', reaction: 10 }, 'r1'));
  now.add(300);
  e.apply({ type: 'buzz', openId: e.s.cur.openId, reaction: 99999 }, 'r1');
  now.add(BUZZ_WINDOW_MS + 1);
  e.tick();
  assert.strictEqual(e.s.cur.buzzed.reaction, 300, 'höchstens die Zeit seit dem Öffnen');
});

test('Frühstart vom Handy wird gezählt, gesperrtes Team kommt nicht mehr dran', () => {
  const now = clock();
  const e = writeGame({}, { rot: ['r1', 'r2'], blau: ['b1'] }, now);
  pickPlain(e, 0);
  e.apply({ type: 'buzz', early: true }, 'r1');
  e.apply({ type: 'buzz', early: true }, 'r1');
  assert.strictEqual(e.team('rot').stats.early, 1, 'pro Frage einmal pro Person');
  e.apply({ type: 'open' }, STAGE);
  e.apply({ type: 'buzz', openId: e.s.cur.openId, reaction: 200 }, 'r2');
  now.add(BUZZ_WINDOW_MS + 1);
  e.tick();
  assert.strictEqual(e.s.cur.buzzed.team, 'rot');
  e.apply({ type: 'judge', ok: false }, STAGE);
  assert.strictEqual(e.s.phase, 'open');
  assert.ok(!e.apply({ type: 'buzz', openId: e.s.cur.openId, reaction: 50 }, 'r1'), 'rot ist raus');
  assert.ok(e.apply({ type: 'buzz', openId: e.s.cur.openId, reaction: 300 }, 'b1'));
});

test('nur das Team am Zug wählt das Feld auf dem Handy', () => {
  const e = writeGame({}, { rot: ['r1'], blau: ['b1'] });
  e.s.turn = 'rot';
  const c = plainCell(e, 0);
  assert.ok(!e.apply({ type: 'pick', col: c.col, row: c.row }, 'b1'));
  assert.ok(e.apply({ type: 'pick', col: c.col, row: c.row }, 'r1'));
});

test('Spieler können nicht selbst urteilen oder den Buzzer öffnen', () => {
  const e = writeGame({}, { rot: ['r1'], blau: ['b1'] });
  pickPlain(e, 0);
  assert.ok(!e.apply({ type: 'open' }, 'r1'));
  e.apply({ type: 'open' }, STAGE);
  e.apply({ type: 'buzz', team: 'rot' }, STAGE);
  assert.ok(!e.apply({ type: 'judge', ok: true }, 'r1'));
  assert.ok(!e.apply({ type: 'show' }, 'r1'));
});

test('Joker-Einsatz geheim auf dem Handy des Teams am Zug', () => {
  const e = writeGame({}, { rot: ['r1'], blau: ['b1'] });
  e.s.turn = 'rot';
  const j = jokerCell(e);
  e.apply({ type: 'pick', col: j.col, row: j.row }, 'r1');
  assert.ok(!e.apply({ type: 'wager', amount: 100 }, 'b1'));
  assert.ok(e.apply({ type: 'wager', amount: 100 }, 'r1'));
  assert.strictEqual(e.s.cur.wager, 100);
});

test('Quizmaster: sieht die Antwort, gibt Buzzer frei, urteilt; Lesezeit läuft nicht automatisch ab', () => {
  const now = clock();
  const e = writeGame({ host: 'qm', qm: 'q1' }, { rot: ['r1'], blau: ['b1'] }, now);
  assert.strictEqual(e.s.qm, 'q1');
  assert.ok(!e.teamOf('q1'));
  pickPlain(e, 0, 'q1');
  now.add(20000);
  e.tick();
  assert.strictEqual(e.s.phase, 'read', 'wartet auf den Quizmaster');
  const qmView = e.viewFor('q1');
  assert.ok(qmView.cur.solution, 'Quizmaster sieht die Antwort');
  assert.strictEqual(qmView.me.role, 'qm');
  assert.strictEqual(e.viewFor('r1').cur.solution, null, 'Spieler nicht');
  assert.ok(e.apply({ type: 'open' }, 'q1'));
  e.apply({ type: 'buzz', openId: e.s.cur.openId, reaction: 300 }, 'b1');
  now.add(BUZZ_WINDOW_MS + 1);
  e.tick();
  assert.ok(e.apply({ type: 'judge', ok: true }, 'q1'));
  assert.strictEqual(score(e, 'blau'), 100);
  assert.ok(e.viewFor('r1').cur.solution, 'nach dem Aufdecken sehen alle die Antwort');
});

test('nur ein Quizmaster; offline kann ihn jemand ablösen', () => {
  const e = writeGame({ host: 'qm', qm: 'q1' }, { rot: ['r1'] });
  e.connect('q2', 'Zweiter');
  assert.ok(!e.apply({ type: 'becomeQM' }, 'q2'));
  e.disconnect('q1');
  assert.ok(e.apply({ type: 'becomeQM' }, 'q2'));
  assert.strictEqual(e.s.qm, 'q2');
});

test('ohne Handy mit Quizmaster: Raum nur fürs Quizmaster-Handy', () => {
  const state = Engine.create({ settings: { input: 'say', host: 'qm' }, teams: [{ id: 'rot', active: true }] });
  const e = new Engine(state, { timers: false });
  assert.ok(e.write, 'Raum wird geöffnet');
  assert.strictEqual(e.s.phase, 'board');
  e.connect('q1', 'QM');
  assert.ok(!e.apply({ type: 'joinTeam', team: 'rot' }, 'q1'), 'ohne Handy keine Buzzer-Handys');
  assert.ok(e.apply({ type: 'becomeQM' }, 'q1'));
});

test('Finale mit Handy: Einsatz geheim, Frage kommt, wenn alle gesetzt haben', () => {
  const now = clock();
  const e = writeGame({ length: 'short' }, { rot: ['r1', 'r2'], blau: ['b1'] }, now);
  clearRound(e);
  e.team('rot').score = 500;
  e.team('blau').score = 700;
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.phase, 'finalWager');
  assert.strictEqual(e.viewFor('r1').final.q, null, 'Frage noch geheim');
  assert.ok(!e.apply({ type: 'finalWager', amount: 600 }, 'r1'), 'über Stand');
  assert.ok(e.apply({ type: 'finalWager', amount: 400 }, 'r1'));
  assert.strictEqual(e.viewFor('r2').final.wagers.rot, 400, 'Team sieht den eigenen Einsatz');
  assert.strictEqual(e.viewFor('b1').final.wagers.rot, undefined, 'fremder Einsatz bleibt geheim');
  assert.ok(e.apply({ type: 'finalWager', amount: 700 }, 'b1'));
  assert.strictEqual(e.s.phase, 'finalQ');
  assert.ok(e.viewFor('b1').final.q);
  assert.ok(e.apply({ type: 'finalAnswer', text: e.s.final.a.split(' / ')[0] }, 'r2'));
  assert.ok(e.apply({ type: 'finalAnswer', text: 'keine Ahnung' }, 'b1'));
  assert.strictEqual(e.viewFor('r1').final.answers.blau, undefined, 'fremde Antwort geheim');
  assert.strictEqual(e.viewFor('b1').final.a, null, 'Lösung geheim');
  now.add(FINAL_MS + 1);
  e.tick();
  assert.strictEqual(e.s.phase, 'finalReveal');
  assert.deepStrictEqual(e.s.final.order, ['rot', 'blau'], 'letzter Platz zuerst');
  const stage = e.viewFor(STAGE);
  assert.strictEqual(stage.final.suggest, true, 'Vorschlag: richtig');
  assert.ok(e.apply({ type: 'finalShow' }, STAGE));
  assert.ok(e.viewFor('b1').final.answers.rot, 'aufgedeckte Antwort sehen alle');
  assert.ok(e.apply({ type: 'finalJudge', ok: true }, STAGE));
  assert.strictEqual(score(e, 'rot'), 900);
  assert.strictEqual(e.viewFor(STAGE).final.suggest, false);
  assert.ok(e.apply({ type: 'finalJudge', ok: false }, STAGE));
  assert.strictEqual(score(e, 'blau'), 0);
  e.apply({ type: 'next' }, STAGE);
  assert.deepStrictEqual(e.s.winners, ['rot']);
  const titles = e.s.awards.map((a) => a.title);
  assert.ok(titles.includes('Zocker'), titles.join(','));
});

test('gefilterte Ansicht: Handys sehen keine Antworten und keine versteckten Joker', () => {
  const e = writeGame({}, { rot: ['r1'], blau: ['b1'] });
  const json = JSON.stringify(e.viewFor('r1'));
  for (const k of e.board().cats) {
    // kurze Antworten wie „Blau“ stecken zufällig auch in Teamnamen – geprüft werden die aussagekräftigen
    for (const c of k.cells) assert.ok(c.a.length < 6 || !json.includes(JSON.stringify(c.a).slice(1, -1)), 'Antwort im Handy-View: ' + c.a);
  }
  assert.ok(e.viewFor('r1').board.cats.every((k) => k.cells.every((c) => !c.joker)), 'Joker versteckt');
  assert.ok(!json.includes(e.s.final.a), 'Final-Antwort nicht drin');
  pickPlain(e, 2);
  assert.strictEqual(e.viewFor('r1').cur.solution, null);
  assert.ok(e.viewFor(STAGE).cur.solution, 'der Laptop hat sie (zeigt sie nur bei Quizmaster-Blick)');
});

test('Umgekehrt: Wand zeigt die Antwort, gesucht ist die Frage', () => {
  const e = sayGame({ reverse: true });
  const c = pickPlain(e, 0);
  const cell = e.cell(c.col, c.row);
  const v = e.viewFor(STAGE);
  assert.strictEqual(v.cur.clue, cell.a);
  assert.strictEqual(v.cur.solution, cell.q);
});

test('Neuladen: abgelaufene Zeiten werden nachgeholt, Handys gelten als offline', () => {
  const now = clock();
  const e = writeGame({}, { rot: ['r1'], blau: ['b1'] }, now);
  pickPlain(e, 0);
  const saved = JSON.parse(JSON.stringify(e.s));
  now.add(60000);
  const e2 = new Engine(saved, { timers: false, now });
  assert.strictEqual(e2.s.phase, 'reveal', 'Lesezeit und Buzzer-Zeit sind abgelaufen');
  e2.setAllOffline();
  assert.ok(!e2.isOnline('r1'));
  e2.connect('r1', 'R1');
  assert.ok(e2.isOnline('r1'));
});

test('Auszeichnungen: schnellster Buzzer, treffsicher', () => {
  const now = clock();
  const e = writeGame({ length: 'short' }, { rot: ['r1'], blau: ['b1'] }, now);
  for (let i = 0; i < 2; i++) {
    pickPlain(e, i);
    e.apply({ type: 'open' }, STAGE);
    now.add(500);
    e.apply({ type: 'buzz', openId: e.s.cur.openId, reaction: 400 - i * 100 }, 'r1');
    now.add(BUZZ_WINDOW_MS + 1);
    e.tick();
    e.apply({ type: 'judge', ok: true }, STAGE);
    e.apply({ type: 'next' }, STAGE);
  }
  e.apply({ type: 'end' }, STAGE);
  const fast = e.s.awards.find((a) => a.title === 'Schnellster Buzzer');
  assert.ok(fast && fast.text.includes('R1') && fast.text.includes('0,30'), JSON.stringify(e.s.awards));
  assert.ok(e.s.awards.find((a) => a.title === 'Treffsicher').text.includes('2 richtige'));
});

Promise.all(pending).then(
  () => console.log(`\n${passed} Tests bestanden.`),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
