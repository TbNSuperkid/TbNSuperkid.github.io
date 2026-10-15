'use strict';
/* Tests für „Geheimsache“ (ohne Browser): node tests/geheimsache.test.js */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
require(path.join(__dirname, '..', 'shared', 'match.js'));
for (const f of ['words/woerter', 'words/adult', 'board', 'engine']) {
  require(path.join(__dirname, '..', 'geheimsache', 'js', f + '.js'));
}
const Board = globalThis.GSBoard;
const { Engine, STAGE, UNLIMITED, cleanCount, guessLimit, winsNeeded } = globalThis.GSEngine;

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

/** Zufall mit festem Startwert, damit Tests wiederholbar sind */
function seeded(seed) {
  let x = seed || 42;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

/** Nur Chef-Handys: startet sofort */
function keysGame(settings, opts) {
  const o = opts || {};
  const hooks = { timers: false, now: o.now || clock(), random: seeded(o.seed) };
  const state = Engine.create(
    {
      settings: Object.assign({ input: 'keys' }, settings),
      teams: [
        { id: 'rot', name: 'Rot-Fuchs', players: o.rot || ['Anna', 'Ben', 'Cem'] },
        { id: 'blau', name: 'Blau-Wal', players: o.blau || ['Dora', 'Emil'] },
      ],
    },
    hooks
  );
  return new Engine(state, hooks);
}

/** Alle mit Handy: Lobby, Spieler verbinden, Teams wählen, starten */
function phoneGame(settings, teams, opts) {
  const o = opts || {};
  const hooks = { timers: false, now: o.now || clock(), random: seeded(o.seed) };
  const state = Engine.create({ settings: Object.assign({ input: 'phones' }, settings), teams: [] }, hooks);
  const e = new Engine(state, hooks);
  for (const [id, players] of Object.entries(teams || { rot: ['a1', 'a2'], blau: ['b1', 'b2'] })) {
    for (const pid of players) {
      e.connect(pid, pid.toUpperCase());
      assert.ok(e.apply({ type: 'joinTeam', team: id }, pid), 'joinTeam ' + pid);
    }
  }
  if (o.start !== false) assert.ok(e.apply({ type: 'start' }, STAGE), 'start');
  return e;
}

/** Index einer verdeckten Karte mit dieser Farbe */
function find(e, owner, skip) {
  const i = e.s.cards.findIndex((c, k) => c.owner === owner && !c.revealed && k !== skip);
  assert.ok(i >= 0, 'Karte ' + owner);
  return i;
}

function clue(e, count, word, actor) {
  return e.apply({ type: 'clue', word: word || '', count }, actor || STAGE);
}

function reveal(e, owner, actor) {
  return e.apply({ type: 'reveal', idx: find(e, owner) }, actor || STAGE);
}

/* ---------- Wörter ---------- */

console.log('Wörterliste');

test('mindestens 500 Wörter und 100 Wörter ab 18, keine Dopplungen', () => {
  assert.ok(Board.words().length >= 500, 'nur ' + Board.words().length);
  assert.ok(Board.adultWords().length >= 100, 'nur ' + Board.adultWords().length + ' ab 18');
  assert.ok(Board.words().length <= Board.ADULT_BASE, 'normale Liste stößt an die 18+-Nummern');
  const words = Board.words().concat(Board.adultWords());
  const keys = new Set(words.map(Board.keyOf));
  assert.strictEqual(keys.size, words.length);
});

test('kein Wort steckt in einem anderen (Ball / Fußball) – auch nicht zwischen den Listen', () => {
  const words = Board.words().concat(Board.adultWords());
  const bad = [];
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) if (Board.relation(words[i], words[j])) bad.push(words[i] + ' / ' + words[j]);
  }
  assert.deepStrictEqual(bad, []);
});

test('Wörter sind kurz genug für die Karten', () => {
  const long = Board.words()
    .concat(Board.adultWords())
    .filter((w) => w.length > 12);
  assert.deepStrictEqual(long, []);
});

/* ---------- Feld & Schlüssel ---------- */

console.log('Feld & Schlüssel');

test('Feld: 25 verschiedene Wörter, 9/8/7/1, Startteam hat 9', () => {
  for (const starter of ['rot', 'blau']) {
    const { cards } = Board.deal({ starter, random: seeded(7) });
    assert.strictEqual(cards.length, 25);
    assert.strictEqual(new Set(cards.map((c) => c.word)).size, 25);
    const n = (o) => cards.filter((c) => c.owner === o).length;
    assert.strictEqual(n(starter), 9);
    assert.strictEqual(n(starter === 'rot' ? 'blau' : 'rot'), 8);
    assert.strictEqual(n('neutral'), 7);
    assert.strictEqual(n('assassin'), 1);
  }
});

test('keine Wiederholung an einem Abend, solange genug Wörter da sind', () => {
  const used = [];
  const seen = new Set();
  const rounds = Math.floor(Board.words().length / 25);
  for (let i = 0; i < rounds; i++) {
    for (const c of Board.deal({ starter: 'rot', used, random: seeded(i + 1) }).cards) {
      assert.ok(!seen.has(c.word), 'doppelt: ' + c.word);
      seen.add(c.word);
    }
  }
  // Danach geht es trotzdem weiter
  assert.strictEqual(Board.deal({ starter: 'rot', used }).cards.length, 25);
});

test('Schlüssel → Link → Schlüssel ergibt dasselbe', () => {
  const { cards, code } = Board.deal({ starter: 'blau', random: seeded(3) });
  assert.ok(code.length < 90, 'Code zu lang: ' + code.length);
  assert.ok(/^[0-9a-zA-Z]+$/.test(code), 'Code nur aus Buchstaben/Ziffern');
  const k = Board.decode(code);
  assert.deepStrictEqual(k.owners, cards.map((c) => c.owner));
  assert.deepStrictEqual(k.words, cards.map((c) => c.word));
  assert.strictEqual(k.starter, 'blau');
});

test('18+: 8 Wörter ab 18 pro Feld, Link funktioniert auch damit', () => {
  const adult = new Set(Board.adultWords());
  const { cards, code } = Board.deal({ starter: 'rot', adult: true, random: seeded(4) });
  assert.strictEqual(cards.filter((c) => adult.has(c.word)).length, Board.ADULT_PER_GAME);
  assert.strictEqual(new Set(cards.map((c) => c.word)).size, 25);
  assert.deepStrictEqual(Board.decode(code).words, cards.map((c) => c.word));
  const normal = Board.deal({ starter: 'rot', random: seeded(4) }).cards;
  assert.strictEqual(normal.filter((c) => adult.has(c.word)).length, 0, 'ohne 18+ keine Wörter ab 18');
});

test('kaputter Link wird erkannt', () => {
  const { code } = Board.deal({ starter: 'rot', random: seeded(5) });
  assert.strictEqual(Board.decode(''), null);
  assert.strictEqual(Board.decode('quatsch'), null);
  assert.strictEqual(Board.decode(code.slice(0, -1)), null);
  // Eine Farbe vertauscht → Prüfsumme passt nicht mehr
  const i = code.indexOf('N', 1);
  const broken = code.slice(0, i) + 'A' + code.slice(i + 1);
  assert.strictEqual(Board.decode(broken), null);
  // Wortnummer verändert
  const j = 1 + 25;
  const broken2 = code.slice(0, j) + (code[j] === '0' ? '1' : '0') + code.slice(j + 1);
  assert.strictEqual(Board.decode(broken2), null);
});

test('andere Wortliste auf dem Handy: Farben ja, Wörter nein', () => {
  const owners = Board.deal({ starter: 'rot', random: seeded(9) }).cards.map((c) => c.owner);
  const code = Board.encode(owners, Array.from({ length: 25 }, (_, i) => i));
  // Länge der Liste im Code fälschen und Prüfsumme neu berechnen
  const body = code.slice(0, -6) + 'zz' + code.slice(-4, -2);
  let h = 7;
  for (let i = 0; i < body.length; i++) h = (h * 31 + body.charCodeAt(i)) % 1296;
  const k = Board.decode(body + h.toString(36).padStart(2, '0'));
  assert.ok(k, 'Code gültig');
  assert.deepStrictEqual(k.owners, owners);
  assert.strictEqual(k.words, null);
});

/* ---------- Hinweis prüfen ---------- */

console.log('Hinweis prüfen');

test('Feld-Wort, Plural, Groß/klein → abgelehnt', () => {
  const field = ['Schloss', 'Bank', 'Kiefer'];
  assert.deepStrictEqual(Board.clueProblem('schloss', field), { word: 'Schloss', reason: 'same' });
  assert.deepStrictEqual(Board.clueProblem('Schlösser', field), { word: 'Schloss', reason: 'same' });
  assert.deepStrictEqual(Board.clueProblem('BÄNKE', field), { word: 'Bank', reason: 'same' });
  assert.deepStrictEqual(Board.clueProblem('Banken', field), { word: 'Bank', reason: 'same' });
  assert.deepStrictEqual(Board.clueProblem(' der Kiefer ', field), { word: 'Kiefer', reason: 'same' });
});

test('Teilwort in beide Richtungen → abgelehnt (Schloss ↔ Schlosspark)', () => {
  assert.deepStrictEqual(Board.clueProblem('Schlosspark', ['Schloss']), { word: 'Schloss', reason: 'part' });
  assert.deepStrictEqual(Board.clueProblem('Wasser', ['Wasserfall']), { word: 'Wasserfall', reason: 'part' });
  assert.deepStrictEqual(Board.clueProblem('Sitzbank', ['Bank']), { word: 'Bank', reason: 'part' });
});

test('erlaubte Hinweise', () => {
  const field = ['Schloss', 'Bank', 'Kiefer', 'Tor'];
  assert.strictEqual(Board.clueProblem('Wasser', field), null);
  assert.strictEqual(Board.clueProblem('Geld', field), null);
  assert.strictEqual(Board.clueProblem('Ei', ['Eimer']), null, 'zu kurze Teilwörter zählen nicht');
  assert.strictEqual(Board.clueProblem('Schule', ['Schale']), null, 'keine Tippfehler-Toleranz');
});

/* ---------- Züge ---------- */

console.log('Züge');

test('Einstellung 18+ landet im Feld', () => {
  const adult = new Set(Board.adultWords());
  const e = keysGame({ words: 'adult' });
  assert.strictEqual(e.s.settings.words, 'adult');
  assert.strictEqual(e.s.cards.filter((c) => adult.has(c.word)).length, Board.ADULT_PER_GAME);
  assert.strictEqual(keysGame().s.cards.filter((c) => adult.has(c.word)).length, 0);
});

test('Nur Chef-Handys startet sofort mit Hinweis-Phase', () => {
  const e = keysGame();
  assert.strictEqual(e.s.phase, 'clue');
  assert.strictEqual(e.s.gameNo, 1);
  assert.strictEqual(e.s.turn, e.s.starter);
  assert.strictEqual(e.remaining(e.s.starter), 9);
  assert.strictEqual(e.team('rot').chief, e.team('rot').players[0].id);
  assert.ok(e.s.code && Board.decode(e.s.code));
});

test('eigene Farbe → weiter raten, höchstens Zahl + 1', () => {
  const e = keysGame();
  const team = e.s.turn;
  assert.ok(clue(e, 2, 'Wasser'));
  assert.strictEqual(e.s.phase, 'guess');
  assert.strictEqual(e.s.clue.left, 3);
  assert.ok(reveal(e, team));
  assert.ok(reveal(e, team));
  assert.strictEqual(e.s.turn, team, 'noch dran');
  assert.ok(reveal(e, team));
  assert.strictEqual(e.s.turn, team === 'rot' ? 'blau' : 'rot', 'nach Zahl + 1 vorbei');
  assert.strictEqual(e.s.phase, 'clue');
  assert.strictEqual(e.remaining(team), 6);
});

test('neutral und Gegnerfarbe → Zugwechsel, Gegnerkarte zählt für den Gegner', () => {
  const e = keysGame();
  const team = e.s.turn;
  const opp = team === 'rot' ? 'blau' : 'rot';
  clue(e, 1);
  assert.ok(reveal(e, 'neutral'));
  assert.strictEqual(e.s.turn, opp);
  clue(e, 3);
  assert.ok(reveal(e, team));
  assert.strictEqual(e.s.turn, team);
  assert.strictEqual(e.remaining(team), 8);
});

test('Attentäter → Team verliert sofort', () => {
  const e = keysGame();
  const team = e.s.turn;
  const opp = team === 'rot' ? 'blau' : 'rot';
  clue(e, 2);
  assert.ok(reveal(e, 'assassin'));
  assert.strictEqual(e.s.phase, 'game-over');
  assert.strictEqual(e.s.result.winner, opp);
  assert.strictEqual(e.s.result.reason, 'assassin');
  assert.strictEqual(e.team(opp).wins, 1);
});

test('Sieg durch alle eigenen Karten – und durch Gegnerfehler', () => {
  const e = keysGame();
  const team = e.s.turn;
  clue(e, UNLIMITED);
  for (let i = 0; i < 9; i++) assert.ok(reveal(e, team));
  assert.strictEqual(e.s.phase, 'game-over');
  assert.strictEqual(e.s.result.winner, team);

  const f = keysGame({}, { seed: 11 });
  const starter = f.s.turn;
  const second = starter === 'rot' ? 'blau' : 'rot';
  // Startteam deckt nacheinander alle Karten des Gegners auf
  for (let i = 0; i < 8; i++) {
    if (f.s.turn !== starter) {
      clue(f, 1);
      f.apply({ type: 'endTurn' }, STAGE);
    }
    clue(f, 1);
    assert.ok(reveal(f, second));
  }
  assert.strictEqual(f.s.phase, 'game-over');
  assert.strictEqual(f.s.result.winner, second);
  assert.strictEqual(f.s.result.reason, 'cards');
});

test('„0“ und „∞“: unbegrenzt raten', () => {
  assert.strictEqual(guessLimit(0), null);
  assert.strictEqual(guessLimit(UNLIMITED), null);
  assert.strictEqual(guessLimit(3), 4);
  assert.strictEqual(cleanCount('∞'), UNLIMITED);
  assert.strictEqual(cleanCount(10), null);
  assert.strictEqual(cleanCount(-1), null);
  const e = keysGame();
  const team = e.s.turn;
  clue(e, 0);
  for (let i = 0; i < 5; i++) reveal(e, team);
  assert.strictEqual(e.s.turn, team);
  assert.strictEqual(e.s.phase, 'guess');
});

test('Hinweis-Wort darf nicht auf dem Feld liegen (Laptop und Handy)', () => {
  const e = keysGame();
  const word = e.s.cards[0].word;
  assert.ok(!clue(e, 2, word));
  assert.ok(!clue(e, 2, word + 'haus'));
  assert.ok(!clue(e, 12));
  assert.strictEqual(e.s.phase, 'clue');
  assert.ok(clue(e, 2, ''), 'am Laptop ist das Wort freiwillig');
});

test('Zug beenden, Zug überspringen, veraltete Aktionen', () => {
  const e = keysGame();
  const team = e.s.turn;
  const at = e.s.turnNo;
  clue(e, 2);
  assert.ok(e.apply({ type: 'endTurn', at }, STAGE));
  assert.notStrictEqual(e.s.turn, team);
  assert.ok(!e.apply({ type: 'reveal', idx: 0, at }, STAGE), 'alter Zug');
  assert.ok(e.apply({ type: 'skipTurn' }, STAGE));
  assert.strictEqual(e.s.turn, team);
  assert.strictEqual(e.s.clues.length, 2);
});

/* ---------- Sanduhr ---------- */

console.log('Sanduhr');

test('Sanduhr Chef und Team beenden den Zug', () => {
  const now = clock();
  const e = keysGame({ chiefSec: 60, teamSec: 120 }, { now });
  const team = e.s.turn;
  assert.strictEqual(e.s.timerEnd, now() + 60000);
  now.add(59000);
  assert.ok(!e.tick());
  now.add(2000);
  assert.ok(e.tick());
  assert.notStrictEqual(e.s.turn, team);
  assert.strictEqual(e.s.event.kind, 'time');
  clue(e, 2);
  assert.strictEqual(e.s.timerEnd, now() + 120000);
  const t2 = e.s.turn;
  reveal(e, t2);
  assert.strictEqual(e.s.timerEnd, now() + 120000, 'läuft pro Hinweis weiter');
  now.add(121000);
  assert.ok(e.tick());
  assert.strictEqual(e.s.turn, team);
});

/* ---------- Partien & Chefs ---------- */

console.log('Partien & Chefs');

test('Best of 3: zwei Siege entscheiden, Chefs wechseln reihum', () => {
  assert.strictEqual(winsNeeded(3), 2);
  assert.strictEqual(winsNeeded(0), null);
  const e = keysGame({ match: 3 });
  const rot = e.team('rot');
  const chiefs = [rot.chief];
  for (let g = 1; g <= 3 && !e.matchWinner(); g++) {
    // Der Starter erwischt den Attentäter → der andere gewinnt
    clue(e, 1);
    reveal(e, 'assassin');
    assert.strictEqual(e.s.phase, 'game-over');
    if (e.matchWinner()) break;
    assert.ok(e.apply({ type: 'nextGame' }, STAGE));
    assert.strictEqual(e.s.gameNo, g + 1);
    chiefs.push(rot.chief);
  }
  assert.ok(e.matchWinner());
  assert.ok(!e.apply({ type: 'nextGame' }, STAGE), 'Match entschieden');
  assert.deepStrictEqual(chiefs.slice(0, 3), rot.players.slice(0, chiefs.length).map((p) => p.id));
  assert.ok(e.apply({ type: 'finish' }, STAGE));
  assert.strictEqual(e.s.phase, 'end');
});

test('frei: beliebig viele Partien, Abend beenden, nochmal', () => {
  const e = keysGame();
  for (let g = 0; g < 4; g++) {
    clue(e, 1);
    reveal(e, 'assassin');
    assert.ok(e.apply({ type: 'nextGame' }, STAGE));
  }
  assert.strictEqual(e.s.gameNo, 5);
  assert.strictEqual(e.team('rot').wins + e.team('blau').wins, 4);
  assert.ok(e.apply({ type: 'finish' }, STAGE), 'auch mitten in einer Partie');
  assert.ok(e.apply({ type: 'again' }, STAGE));
  assert.strictEqual(e.s.gameNo, 1);
  assert.strictEqual(e.s.phase, 'clue');
  assert.strictEqual(e.team('rot').wins, 0);
});

/* ---------- Trinkregeln ---------- */

console.log('Trinkregeln');

test('Trinkregeln laut Tabelle', () => {
  const e = keysGame({ drinks: 'on' });
  const team = e.s.turn;
  const opp = team === 'rot' ? 'blau' : 'rot';
  // Hinweis für 3 komplett gelöst → Gegner trinkt 1
  clue(e, 3);
  reveal(e, team);
  reveal(e, team);
  reveal(e, team);
  assert.deepStrictEqual(e.s.drinks.map((d) => [d.team, d.amount, d.reason]), [[opp, 1, 'clue']]);
  // Neutral → 1, Gegnerkarte → ganzes Team 1
  reveal(e, 'neutral');
  clue(e, 1);
  reveal(e, team);
  assert.deepStrictEqual(e.s.drinks.slice(1).map((d) => [d.team, d.amount, d.reason]), [
    [team, 1, 'neutral'],
    [opp, 1, 'opponent'],
  ]);
  // Attentäter → 3, verloren → 1 pro übriger Karte
  clue(e, 1);
  reveal(e, 'assassin');
  const last = e.s.drinks.slice(3).map((d) => [d.team, d.amount, d.reason]);
  assert.deepStrictEqual(last, [
    [team, 3, 'assassin'],
    [team, e.remaining(team), 'lost'],
  ]);
});

test('Trinkregeln aus → keine Einträge; alkoholfrei → Strafpunkte', () => {
  const e = keysGame();
  clue(e, 1);
  reveal(e, 'assassin');
  assert.strictEqual(e.s.drinks.length, 0);
  const f = keysGame({ drinks: 'free' });
  clue(f, 1);
  reveal(f, 'neutral');
  assert.strictEqual(f.s.drinks.length, 1);
  f.apply({ type: 'finish' }, STAGE);
  assert.ok(f.s.awards.some((a) => a.title === 'Strafpunkte-König'));
});

/* ---------- Alle mit Handy ---------- */

console.log('Alle mit Handy');

test('Lobby: Teams wählen, erster ist Chef, mindestens 2 pro Team', () => {
  const e = phoneGame({}, { rot: ['a1', 'a2'], blau: ['b1'] }, { start: false });
  assert.match(e.lobbyProblem(), /mindestens 2/);
  assert.ok(!e.apply({ type: 'start' }, STAGE));
  e.connect('b2', 'B2');
  e.apply({ type: 'joinTeam', team: 'blau' }, 'b2');
  assert.strictEqual(e.team('rot').chief, 'a1');
  assert.ok(e.apply({ type: 'setChief' }, 'a2'), 'selbst Chef werden');
  assert.strictEqual(e.team('rot').chief, 'a2');
  assert.ok(e.apply({ type: 'start' }, STAGE));
  assert.strictEqual(e.s.phase, 'clue');
});

test('Gefilterte Ansicht: Ermittler sehen keine verdeckten Farben, Chefs schon', () => {
  const e = phoneGame();
  const op = e.viewFor('a2');
  const chief = e.viewFor('a1');
  const stage = e.viewFor(STAGE);
  assert.ok(op.cards.every((c) => c.owner === null));
  assert.ok(stage.cards.every((c) => c.owner === null));
  assert.strictEqual(stage.secret, null, 'mit Handys kein Schlüssel-Link');
  assert.ok(chief.cards.every((c) => c.owner));
  assert.strictEqual(chief.me.role, 'chief');
  assert.strictEqual(op.me.role, 'operative');
  // Nach dem Aufdecken sehen alle die Farbe
  const turnChief = e.team(e.s.turn).chief;
  e.apply({ type: 'clue', word: 'Wasser', count: 1, at: e.s.turnNo }, turnChief);
  const idx = find(e, 'neutral');
  e.apply({ type: 'reveal', idx }, STAGE);
  assert.strictEqual(e.viewFor('a2').cards[idx].owner, 'neutral');
  assert.ok(e.viewFor('a2').cards.filter((c) => c.owner).length === 1);
});

test('Nur Chef-Handys: Laptop bekommt den Schlüssel-Code', () => {
  const e = keysGame();
  assert.strictEqual(e.viewFor(STAGE).secret, e.s.code);
  assert.ok(e.viewFor(STAGE).cards.every((c) => c.owner === null), 'Feld zeigt keine Farben');
});

test('Chef gibt Hinweis, nur der Chef am Zug, verbotene Wörter abgelehnt', () => {
  const e = phoneGame();
  const t = e.team(e.s.turn);
  const o = e.team(e.s.turn === 'rot' ? 'blau' : 'rot');
  const op = t.players.find((p) => p.id !== t.chief).id;
  assert.ok(!e.apply({ type: 'clue', word: 'Wasser', count: 2 }, o.chief), 'falscher Chef');
  assert.ok(!e.apply({ type: 'clue', word: 'Wasser', count: 2 }, op), 'kein Chef');
  assert.ok(!e.apply({ type: 'clue', word: '', count: 2 }, t.chief), 'Wort fehlt');
  assert.ok(!e.apply({ type: 'clue', word: e.s.cards[3].word, count: 2 }, t.chief), 'liegt auf dem Feld');
  assert.ok(e.apply({ type: 'clue', word: 'Wasser', count: 2 }, t.chief));
  assert.strictEqual(e.viewFor(STAGE).clue.word, 'Wasser');
});

test('Vorschläge, Aufdecken und Zug beenden auf dem Handy', () => {
  const e = phoneGame({}, { rot: ['a1', 'a2', 'a3'], blau: ['b1', 'b2', 'b3'] });
  const t = e.team(e.s.turn);
  const o = e.team(e.s.turn === 'rot' ? 'blau' : 'rot');
  const [op1, op2] = t.players.filter((p) => p.id !== t.chief).map((p) => p.id);
  e.apply({ type: 'clue', word: 'Wasser', count: 2 }, t.chief);
  const idx = find(e, t.id);
  assert.ok(e.apply({ type: 'suggest', idx }, op1));
  assert.ok(e.apply({ type: 'suggest', idx }, op2));
  assert.deepStrictEqual(e.viewFor(STAGE).suggestions[idx].map((x) => x.name), [op1.toUpperCase(), op2.toUpperCase()]);
  assert.strictEqual(e.viewFor(op1).me.suggestion, idx);
  assert.ok(e.apply({ type: 'suggest', idx }, op1), 'nochmal antippen nimmt den Vorschlag weg');
  assert.deepStrictEqual(e.s.suggestions[idx], [op2]);
  assert.ok(!e.apply({ type: 'suggest', idx }, t.chief), 'Chef rät nicht mit');
  assert.ok(!e.apply({ type: 'suggest', idx }, o.players[1].id), 'Gegner rät nicht mit');
  assert.ok(!e.apply({ type: 'endTurn' }, op1), 'erst mindestens eine Karte');
  assert.ok(e.apply({ type: 'reveal', idx }, op2));
  assert.strictEqual(e.s.cards[idx].by, op2);
  assert.strictEqual(e.s.suggestions[idx], undefined);
  assert.ok(e.apply({ type: 'endTurn' }, op1));
  assert.strictEqual(e.s.turn, o.id);
});

test('Neutral auf dem Handy: wer angetippt hat, trinkt', () => {
  const e = phoneGame({ drinks: 'on' });
  const t = e.team(e.s.turn);
  const op = t.players.find((p) => p.id !== t.chief).id;
  e.apply({ type: 'clue', word: 'Wasser', count: 2 }, t.chief);
  e.apply({ type: 'reveal', idx: find(e, 'neutral') }, op);
  assert.deepStrictEqual(e.s.drinks.map((d) => [d.pid, d.amount]), [[op, 1]]);
  assert.strictEqual(e.viewFor(STAGE).teams.find((x) => x.id === t.id).players.find((p) => p.id === op).drinks, 1);
});

test('Chef-Wechsel mit Handys überspringt getrennte Spieler', () => {
  const e = phoneGame({}, { rot: ['a1', 'a2', 'a3'], blau: ['b1', 'b2'] });
  e.disconnect('a2');
  e.apply({ type: 'clue', word: 'Wasser', count: 1 }, e.team(e.s.turn).chief);
  e.apply({ type: 'reveal', idx: find(e, 'assassin') }, STAGE);
  assert.strictEqual(e.viewFor(STAGE).teams[0].nextChief, 'a3');
  e.apply({ type: 'nextGame' }, STAGE);
  assert.strictEqual(e.team('rot').chief, 'a3');
  assert.strictEqual(e.team('blau').chief, 'b2');
  // Laptop wählt die Chefs selbst
  e.apply({ type: 'clue', word: 'Wasser', count: 1 }, e.team(e.s.turn).chief);
  e.apply({ type: 'reveal', idx: find(e, 'assassin') }, STAGE);
  assert.ok(!e.apply({ type: 'setChief' }, 'a1'), 'zwischen den Partien wählt der Laptop');
  e.apply({ type: 'nextGame', chiefs: { rot: 'a1', blau: 'zzz' } }, STAGE);
  assert.strictEqual(e.team('rot').chief, 'a1');
  assert.strictEqual(e.team('blau').chief, 'b1', 'unbekannter Spieler → reihum');
});

test('Später dazukommen: als Ermittler:in', () => {
  const e = phoneGame();
  e.connect('c1', 'C1');
  assert.ok(e.apply({ type: 'joinTeam', team: 'blau' }, 'c1'));
  assert.strictEqual(e.roleOf('c1'), 'operative');
  assert.ok(!e.apply({ type: 'joinTeam', team: 'rot' }, 'c1'), 'kein Teamwechsel im Spiel');
});

/* ---------- Auszeichnungen & Speichern ---------- */

console.log('Auszeichnungen & Speichern');

test('Auszeichnungen: Meisterhinweis, Pechvogel, Sauberes Team', () => {
  const e = keysGame();
  const team = e.s.turn;
  clue(e, 3, 'Wasser');
  reveal(e, team);
  reveal(e, team);
  reveal(e, team);
  reveal(e, team);
  e.apply({ type: 'endTurn' }, STAGE);
  clue(e, 1);
  reveal(e, 'assassin');
  e.apply({ type: 'nextGame' }, STAGE);
  const t2 = e.s.turn;
  clue(e, UNLIMITED);
  for (let i = 0; i < 9; i++) reveal(e, t2);
  e.apply({ type: 'finish' }, STAGE);
  const titles = e.s.awards.map((a) => a.title);
  assert.deepStrictEqual(titles, ['Meisterhinweis', 'Pechvogel', 'Sauberes Team']);
  assert.match(e.s.awards[0].text, /„Wasser“ für 3/);
});

test('Spielstand übersteht Neuladen (Zustand ist reines JSON)', () => {
  const now = clock();
  const e = keysGame({ teamSec: 60 }, { now });
  clue(e, 2);
  const copy = JSON.parse(JSON.stringify(e.s));
  now.add(61000);
  const f = new Engine(copy, { timers: false, now });
  assert.strictEqual(f.s.phase, 'clue', 'abgelaufene Sanduhr beim Laden ausgewertet');
  assert.notStrictEqual(f.s.turn, e.s.turn);
});

console.log(`\n✓ ${passed} Tests bestanden`);
