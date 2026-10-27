'use strict';
/* Tests für „Wavelength“ (ohne Browser): node tests/wavelength.test.js */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'shared', 'match.js'));
for (const f of ['klassisch', 'meinung', 'kultur', 'schraeg', 'adult']) require(path.join(ROOT, 'wavelength', 'js', 'skalen', f + '.js'));
for (const f of ['scales', 'dial', 'engine']) require(path.join(ROOT, 'wavelength', 'js', f + '.js'));
const Scales = globalThis.WLScales;
const Dial = globalThis.WLDial;
const { Engine, STAGE, GRACE_MS, COOP_SCALES, points, sideOf, targetRange, bandWidth, clueProblem, sanitizeSettings, coopRating } = globalThis.WLEngine;

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

/** Zufall mit festem Ablauf (für Ziele) */
function seq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

/** Spiel mit Handys: Lobby, Spieler verbinden (teams: pid -> Team), starten */
function phoneGame(settings, teams, now) {
  const state = Engine.create({ settings: Object.assign({ input: 'phones' }, settings) });
  const e = new Engine(state, { timers: false, now: now || clock(), flip: false });
  for (const pid of Object.keys(teams)) e.connect(pid, pid.toUpperCase());
  for (const [pid, team] of Object.entries(teams)) if (team) e.apply({ type: 'joinTeam', team }, pid);
  assert.ok(e.apply({ type: 'start' }, STAGE), 'start');
  return e;
}

const FOUR = { a: 'blau', b: 'blau', c: 'orange', d: 'orange' };

/** Zug durchspielen: Hinweis, Zeiger auf `dial`, festlegen, Tipp `side`, aufdecken */
function playTurn(e, dial, side) {
  const cur = e.s.cur;
  assert.strictEqual(e.s.phase, 'clue');
  assert.ok(e.apply({ type: 'clue', text: 'Test' }, cur.giver), 'clue');
  if (dial !== cur.dial) assert.ok(e.apply({ type: 'dial', angle: dial }, STAGE), 'dial');
  assert.ok(e.apply({ type: 'lockNow' }, STAGE), 'lockNow');
  if (e.s.phase === 'side') assert.ok(e.apply({ type: 'side', side: side || null }, STAGE), 'side');
  assert.strictEqual(e.s.phase, 'reveal');
  return e.s.cur.result;
}

/** Ziel festlegen (für Tests) */
function setTarget(e, t) {
  e.s.cur.target = t;
}

/* ---------- Skalen ---------- */

console.log('Skalen');

test('mindestens 400 Paare, jede Kategorie mit ihrem Ziel', () => {
  const st = Scales.stats();
  assert.ok(st.total >= 400, 'insgesamt ' + st.total);
  for (const c of Scales.CATEGORIES) assert.ok(st[c.id] >= c.target, `${c.id}: ${st[c.id]} < ${c.target}`);
});

test('alle Zeilen gültig, keine leeren Enden, höchstens 40 Zeichen', () => {
  for (const c of Scales.CATEGORY_IDS) {
    const lines = Scales.parseList(globalThis.WL_SKALEN[c], c);
    lines.forEach((x, i) => assert.ok(x, `${c}: Zeile ${i + 1} ungültig`));
  }
  for (const s of Scales.list()) {
    assert.ok(s.left && s.right, s.id);
    assert.ok((s.left + s.right).length <= Scales.MAX_CHARS, `zu lang: ${s.left} | ${s.right}`);
    assert.notStrictEqual(Scales.slug(s.left), Scales.slug(s.right), s.id);
  }
});

test('keine doppelten Paare – auch nicht umgedreht, auch nicht über Kategorien', () => {
  const seen = new Map();
  for (const s of Scales.list()) {
    const k = Scales.pairKey(s.left, s.right);
    assert.ok(!seen.has(k), `doppelt: ${s.id} = ${seen.get(k)}`);
    seen.set(k, s.id);
  }
  assert.strictEqual(Scales.pairKey('kalt', 'heiß'), Scales.pairKey('Heiß', 'kalt'));
});

test('Ziehen ohne Wiederholung, nur aus den gewählten Kategorien, Ab 18 standardmäßig aus', () => {
  assert.ok(!Scales.DEFAULT_CATEGORIES.includes('adult'));
  const used = [];
  for (let i = 0; i < 60; i++) {
    const s = Scales.draw(['kultur'], used);
    assert.strictEqual(s.cat, 'kultur');
  }
  assert.strictEqual(new Set(used).size, 60);
  assert.deepStrictEqual(Scales.cleanCategories([]), Scales.DEFAULT_CATEGORIES);
  assert.deepStrictEqual(Scales.cleanCategories(['adult', 'quatsch']), ['adult']);
});

/* ---------- Wertung ---------- */

console.log('Wertung');

test('Abstand zur Mitte → 4 / 3 / 2 / 0, Kante zählt zum besseren Streifen', () => {
  // normal: Streifen 7° → 4 bis 3,5°, 3 bis 10,5°, 2 bis 17,5°
  assert.strictEqual(points(90, 90, 'normal'), 4);
  assert.strictEqual(points(93.5, 90, 'normal'), 4);
  assert.strictEqual(points(86.5, 90, 'normal'), 4);
  assert.strictEqual(points(93.6, 90, 'normal'), 3);
  assert.strictEqual(points(100.5, 90, 'normal'), 3);
  assert.strictEqual(points(100.6, 90, 'normal'), 2);
  assert.strictEqual(points(107.5, 90, 'normal'), 2);
  assert.strictEqual(points(107.6, 90, 'normal'), 0);
  assert.strictEqual(points(0, 170, 'normal'), 0);
});

test('Zielbreiten: schmal 5°, normal 7°, breit 9°', () => {
  assert.strictEqual(bandWidth('narrow'), 5);
  assert.strictEqual(bandWidth('wide'), 9);
  assert.strictEqual(points(93, 90, 'narrow'), 3);
  assert.strictEqual(points(94.5, 90, 'wide'), 4);
  assert.strictEqual(points(112.5, 90, 'wide'), 2);
  assert.strictEqual(points(112.6, 90, 'wide'), 0);
});

test('Ziel nie so nah am Rand, dass Streifen abgeschnitten werden', () => {
  assert.deepStrictEqual(targetRange('normal'), [17.5, 162.5]);
  for (const width of ['narrow', 'normal', 'wide']) {
    const [lo, hi] = targetRange(width);
    for (const r of [0, 0.0001, 0.5, 0.9999]) {
      const state = Engine.create({ settings: { input: 'one', width }, players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] }, { random: () => r });
      assert.ok(state.cur.target >= lo && state.cur.target <= hi, `${width}: ${state.cur.target}`);
    }
  }
});

test('Links/rechts: richtig/falsch, Zeiger genau auf der Mitte → niemand', () => {
  assert.strictEqual(sideOf(90, 60), 'left');
  assert.strictEqual(sideOf(90, 120), 'right');
  assert.strictEqual(sideOf(90, 90), null);
  assert.strictEqual(sideOf(90.04, 90), null, 'auf eine Nachkommastelle gerundet');
});

test('Hinweis-Prüfung: Zahlen und Wörter der Skala werden angemahnt', () => {
  const scale = { left: 'kalt', right: 'heiß' };
  assert.strictEqual(clueProblem('Kaffee', scale), null);
  assert.strictEqual(clueProblem('30 Grad', scale), 'number');
  assert.strictEqual(clueProblem('halb Prozent', scale), 'number');
  assert.strictEqual(clueProblem('eiskalt', scale), 'scale');
  assert.strictEqual(clueProblem('ziemlich heiss', scale), 'scale');
  assert.strictEqual(clueProblem('Nachtisch', { left: 'klingt nach Dino', right: 'klingt nach Pasta' }), null, 'Füllwörter zählen nicht');
  assert.strictEqual(clueProblem('Spaghetti', { left: 'klingt nach Dino', right: 'klingt nach Pasta' }), null);
});

test('Einstellungen werden bereinigt', () => {
  const s = sanitizeSettings({ input: 'x', mode: 'coop', goal: 12, width: 'narrow', timer: 90, categories: ['adult', 'kultur', 'nix'], drinks: true, sideGuess: 'ja' });
  assert.strictEqual(s.input, 'phones');
  assert.strictEqual(s.mode, 'coop');
  assert.strictEqual(s.goal, 10);
  assert.strictEqual(s.width, 'narrow');
  assert.strictEqual(s.timer, 90);
  assert.deepStrictEqual(s.categories, ['kultur', 'adult']);
  assert.strictEqual(s.drinks, true);
  assert.strictEqual(s.sideGuess, true);
});

/* ---------- Ablauf mit Handys ---------- */

console.log('Mit Handys');

test('Lobby: jedes Team braucht 2 Personen, kooperativ reichen 2', () => {
  const state = Engine.create({ settings: { input: 'phones' } });
  const e = new Engine(state, { timers: false, now: clock() });
  for (const pid of ['a', 'b', 'c']) e.connect(pid, pid);
  assert.ok(e.lobbyProblem());
  assert.ok(!e.apply({ type: 'start' }, STAGE));
  e.connect('d', 'd');
  assert.strictEqual(e.lobbyProblem(), null, 'automatisch auf beide Teams verteilt');
  e.apply({ type: 'joinTeam', team: 'blau' }, 'c');
  e.apply({ type: 'joinTeam', team: 'blau' }, 'd');
  assert.ok(e.lobbyProblem(), 'Team Orange leer');
  const coop = new Engine(Engine.create({ settings: { input: 'phones', mode: 'coop' } }), { timers: false, now: clock() });
  coop.connect('a', 'a');
  assert.ok(coop.lobbyProblem());
  coop.connect('b', 'b');
  assert.strictEqual(coop.lobbyProblem(), null);
});

test('Ablauf: Hinweis → Zeiger → links/rechts → Aufdecken, Team 2 startet mit 1 Punkt', () => {
  const e = phoneGame({}, FOUR);
  assert.strictEqual(e.s.phase, 'clue');
  assert.strictEqual(e.s.teams[0].score, 0);
  assert.strictEqual(e.s.teams[1].score, 1);
  const cur = e.s.cur;
  assert.strictEqual(cur.team, 'blau');
  assert.ok(['a', 'b'].includes(cur.giver));
  setTarget(e, 120);
  const guesser = cur.giver === 'a' ? 'b' : 'a';
  // Nur die hinweisgebende Person (oder Spielleitung/Laptop) gibt den Hinweis
  assert.ok(!e.apply({ type: 'clue', text: 'x' }, 'c') || e.leadPid() === 'c');
  assert.ok(e.apply({ type: 'clue', text: '  Lauwarmer   Kaffee ' }, cur.giver));
  assert.strictEqual(e.s.phase, 'dial');
  assert.strictEqual(e.s.cur.clue, 'Lauwarmer Kaffee');
  // Gegnerteam und Hinweisgeber/in dürfen den Zeiger nicht drehen
  assert.ok(!e.apply({ type: 'dial', angle: 10 }, 'c'));
  assert.ok(!e.apply({ type: 'dial', angle: 10 }, cur.giver));
  assert.ok(e.apply({ type: 'dial', angle: 118.04 }, guesser));
  assert.strictEqual(e.s.cur.dial, 118);
  assert.ok(e.apply({ type: 'lock' }, guesser));
  // nur eine Person im Team rät → ein „Fertig“ reicht
  assert.strictEqual(e.s.phase, 'side');
  assert.ok(e.apply({ type: 'vote', side: 'left' }, 'c'));
  assert.strictEqual(e.s.phase, 'side');
  assert.ok(!e.apply({ type: 'vote', side: 'left' }, guesser), 'nur das Gegnerteam');
  assert.ok(e.apply({ type: 'vote', side: 'right' }, 'd'));
  // Gleichstand → rechts (richtig: Ziel 120 liegt rechts von 118)
  assert.strictEqual(e.s.phase, 'reveal');
  const r = e.s.cur.result;
  assert.strictEqual(r.points, 4);
  assert.strictEqual(r.sidePoint, 1);
  assert.strictEqual(e.s.teams[0].score, 4);
  assert.strictEqual(e.s.teams[1].score, 2);
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.strictEqual(e.s.cur.team, 'orange');
  assert.strictEqual(e.s.history.length, 1);
});

test('„Fertig“ braucht 2 Personen – Zeiger bewegen setzt die Zustimmung zurück', () => {
  const e = phoneGame({}, { a: 'blau', b: 'blau', c: 'blau', d: 'orange', f: 'orange' });
  const cur = e.s.cur;
  e.apply({ type: 'clue' }, cur.giver);
  const [g1, g2] = e.guessers();
  assert.strictEqual(e.locksNeeded(), 2);
  assert.ok(e.apply({ type: 'lock' }, g1));
  assert.strictEqual(e.s.phase, 'dial');
  assert.ok(e.apply({ type: 'dial', angle: 40 }, g2));
  assert.deepStrictEqual(e.s.cur.locks, []);
  assert.ok(e.apply({ type: 'lock' }, g1));
  assert.ok(e.apply({ type: 'lock' }, g1), 'nochmal = zurücknehmen');
  assert.deepStrictEqual(e.s.cur.locks, []);
  e.apply({ type: 'lock' }, g1);
  e.apply({ type: 'lock' }, g2);
  assert.strictEqual(e.s.phase, 'side');
});

test('Spielleitung legt den Zeiger fest und löst die Abstimmung auf', () => {
  const e = phoneGame({}, FOUR);
  const lead = e.leadPid();
  assert.strictEqual(lead, 'a', 'erstes Handy');
  e.apply({ type: 'clue' }, e.s.cur.giver);
  assert.ok(!e.apply({ type: 'lockNow' }, 'c'));
  assert.ok(e.apply({ type: 'lockNow' }, lead));
  assert.strictEqual(e.s.phase, 'side');
  e.apply({ type: 'vote', side: 'left' }, 'c');
  assert.ok(e.apply({ type: 'closeSide' }, lead));
  assert.strictEqual(e.s.cur.side, 'left');
  assert.strictEqual(e.s.phase, 'reveal');
});

test('Gefilterte Ansicht: nur die hinweisgebende Person kennt das Ziel vor dem Aufdecken', () => {
  const e = phoneGame({}, FOUR);
  const giver = e.s.cur.giver;
  const target = e.s.cur.target;
  const check = (phase) => {
    for (const pid of ['a', 'b', 'c', 'd', STAGE]) {
      const v = e.viewFor(pid);
      if (pid === giver) assert.strictEqual(v.cur.target, target, `${phase}: Hinweisgeber/in sieht das Ziel`);
      else assert.strictEqual(v.cur.target, null, `${phase}: ${pid} kennt das Ziel nicht`);
      assert.ok(!JSON.stringify(v).includes('"target":' + target) || pid === giver, `${phase}: ${pid} – Ziel steckt nirgends in der Ansicht`);
    }
  };
  check('clue');
  e.apply({ type: 'clue' }, giver);
  check('dial');
  e.apply({ type: 'lockNow' }, STAGE);
  check('side');
  e.apply({ type: 'side', side: 'left' }, STAGE);
  for (const pid of ['a', 'b', 'c', 'd', STAGE]) assert.strictEqual(e.viewFor(pid).cur.target, target, 'aufgedeckt');
});

test('Neue Skala: Hinweisgeber/in einmal, Laptop beliebig oft – das Ziel bleibt', () => {
  const e = phoneGame({}, FOUR);
  const cur = e.s.cur;
  const target = cur.target;
  const first = cur.scale.id;
  const key = e.stepKey();
  assert.ok(e.apply({ type: 'reroll', at: key }, cur.giver));
  assert.notStrictEqual(e.s.cur.scale.id, first);
  assert.strictEqual(e.s.cur.target, target);
  assert.ok(!e.apply({ type: 'reroll', at: key }, cur.giver), 'alte Kennung verfällt');
  assert.ok(!e.apply({ type: 'reroll' }, cur.giver), 'nur einmal – auch als Spielleitung');
  assert.ok(e.apply({ type: 'reroll' }, STAGE));
  assert.ok(e.apply({ type: 'reroll' }, STAGE));
  assert.strictEqual(e.s.cur.target, target);
  // Ein Gerät: Der Laptop zieht für die hinweisgebende Person – einmal, aus dem Menü beliebig oft
  const one = new Engine(Engine.create({ settings: { input: 'one' }, players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] }), { timers: false });
  assert.ok(one.apply({ type: 'reroll' }, STAGE));
  assert.ok(!one.apply({ type: 'reroll' }, STAGE));
  assert.ok(one.apply({ type: 'reroll', force: true }, STAGE));
});

test('Eigene Skala nur mit Einstellung', () => {
  const e = phoneGame({}, FOUR);
  assert.ok(!e.apply({ type: 'customScale', left: 'Pizza', right: 'Salat' }, STAGE));
  const f = phoneGame({ customScale: true }, FOUR);
  assert.ok(!f.apply({ type: 'customScale', left: 'Pizza', right: 'pizza' }, STAGE), 'gleiche Enden');
  assert.ok(f.apply({ type: 'customScale', left: '  Pizza ', right: 'Salat' }, f.s.cur.giver));
  assert.strictEqual(f.s.cur.scale.left, 'Pizza');
  assert.ok(f.s.cur.scale.custom);
});

test('Aufholregel: 4 Punkte und trotzdem hinten → gleich nochmal dran', () => {
  const e = phoneGame({}, FOUR);
  e.s.teams[1].score = 8;
  setTarget(e, 60);
  const r = playTurn(e, 60, 'left');
  assert.strictEqual(r.points, 4);
  assert.strictEqual(r.again, true);
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.cur.team, 'blau', 'Blau nochmal');
  // ohne Aufholregel: Wechsel
  const f = phoneGame({ catchUp: false }, FOUR);
  f.s.teams[1].score = 8;
  setTarget(f, 60);
  assert.strictEqual(playTurn(f, 60, 'left').again, false);
  f.apply({ type: 'next' }, STAGE);
  assert.strictEqual(f.s.cur.team, 'orange');
});

test('Spielende bei 10 Punkten', () => {
  const e = phoneGame({}, FOUR);
  e.s.teams[0].score = 7;
  setTarget(e, 100);
  playTurn(e, 100, 'left');
  assert.strictEqual(e.s.winner, 'blau');
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.strictEqual(e.s.phase, 'over');
  assert.strictEqual(e.viewFor(STAGE).winner, 'blau');
});

test('Beide gleichzeitig über 10: mehr Punkte gewinnt – Gleichstand: Stechen', () => {
  // Blau 8 → +3 = 11, Orange 9 + richtiger Tipp = 10 → Blau gewinnt
  const e = phoneGame({}, FOUR);
  e.s.teams[0].score = 8;
  e.s.teams[1].score = 9;
  setTarget(e, 100);
  playTurn(e, 106, 'left');
  assert.strictEqual(e.s.teams[0].score, 11);
  assert.strictEqual(e.s.teams[1].score, 10);
  assert.strictEqual(e.s.winner, 'blau');
  // Blau 8 → +2 = 10, Orange 9 + 1 = 10 → Stechen
  const f = phoneGame({}, FOUR);
  f.s.teams[0].score = 8;
  f.s.teams[1].score = 9;
  setTarget(f, 100);
  const r = playTurn(f, 112, 'left');
  assert.strictEqual(r.points, 2);
  assert.strictEqual(f.s.winner, null);
  assert.ok(f.s.tiebreak);
  assert.ok(r.tiebreak);
  f.apply({ type: 'next' }, STAGE);
  assert.strictEqual(f.s.phase, 'clue');
  // Stechen: Orange holt 3, aber erst nach der vollen Runde wird entschieden
  setTarget(f, 50);
  playTurn(f, 55, 'left');
  assert.strictEqual(f.s.winner, null, 'Blau darf noch');
  f.apply({ type: 'next' }, STAGE);
  setTarget(f, 50);
  playTurn(f, 80, 'right');
  assert.strictEqual(f.s.winner, 'orange');
});

test('Ohne Links/Rechts-Tipp wird direkt aufgedeckt', () => {
  const e = phoneGame({ sideGuess: false }, FOUR);
  e.apply({ type: 'clue' }, e.s.cur.giver);
  e.apply({ type: 'lockNow' }, STAGE);
  assert.strictEqual(e.s.phase, 'reveal');
});

test('Hinweisgeber/in reihum im Team, Teams wechseln sich ab', () => {
  const e = phoneGame({ sideGuess: false, catchUp: false }, FOUR);
  const givers = [];
  for (let i = 0; i < 4; i++) {
    givers.push(e.s.cur.team + ':' + e.s.cur.giver);
    setTarget(e, 30);
    playTurn(e, 150);
    e.apply({ type: 'next' }, STAGE);
  }
  assert.deepStrictEqual(givers, ['blau:a', 'orange:c', 'blau:b', 'orange:d']);
});

test('Zeitlimit: nach Ablauf zählt der Zeiger, wie er steht', () => {
  const now = clock();
  const e = phoneGame({ timer: 60 }, FOUR, now);
  e.apply({ type: 'clue' }, e.s.cur.giver);
  const g = e.guessers()[0];
  e.apply({ type: 'dial', angle: 33 }, g);
  now.add(59000);
  assert.strictEqual(e.tick(), false);
  now.add(2000);
  assert.strictEqual(e.tick(), true);
  assert.strictEqual(e.s.phase, 'side');
  assert.strictEqual(e.s.cur.dial, 33);
});

test('Verbindung weg: nach der Schonfrist wird bei der Abstimmung nicht mehr gewartet', () => {
  const now = clock();
  const e = phoneGame({}, FOUR, now);
  e.apply({ type: 'clue' }, e.s.cur.giver);
  e.apply({ type: 'lockNow' }, STAGE);
  e.apply({ type: 'vote', side: 'left' }, 'c');
  e.disconnect('d');
  assert.strictEqual(e.tick(), false);
  now.add(GRACE_MS + 10);
  assert.strictEqual(e.tick(), true);
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(e.s.cur.side, 'left');
});

test('Verspätete Zeiger-Nachrichten vom letzten Zug werden ignoriert', () => {
  const e = phoneGame({ sideGuess: false }, FOUR);
  const key = e.stepKey();
  e.apply({ type: 'clue' }, e.s.cur.giver);
  const g = e.guessers()[0];
  e.apply({ type: 'lockNow' }, STAGE);
  e.apply({ type: 'next' }, STAGE);
  e.apply({ type: 'clue' }, e.s.cur.giver);
  assert.ok(!e.apply({ type: 'dial', angle: 12, at: key }, g));
});

test('Hinweisgeber/in entfernt: Zug mit jemand anderem aus dem Team, ohne Wertung', () => {
  const e = phoneGame({}, { a: 'blau', b: 'blau', c: 'blau', d: 'orange', f: 'orange' });
  const giver = e.s.cur.giver;
  e.apply({ type: 'clue' }, giver);
  assert.ok(e.apply({ type: 'kick', player: giver }, STAGE));
  assert.strictEqual(e.s.phase, 'clue');
  assert.notStrictEqual(e.s.cur.giver, giver);
  assert.strictEqual(e.s.cur.team, 'blau');
  assert.strictEqual(e.s.teams[0].score, 0);
});

test('Neue Leute kommen ins kleinere Team', () => {
  const e = phoneGame({}, { a: 'blau', b: 'blau', c: 'blau', d: 'orange', f: 'orange' });
  e.connect('g', 'G');
  assert.strictEqual(e.player('g').team, 'orange');
});

/* ---------- Kooperativ ---------- */

console.log('Kooperativ');

test('Kooperativ: 7 Skalen, alle raten zusammen, kein Links/Rechts', () => {
  const e = phoneGame({ mode: 'coop' }, { a: null, b: null, c: null });
  assert.strictEqual(e.s.coop.total, COOP_SCALES);
  assert.strictEqual(e.guessers().length, 2);
  for (let i = 0; i < COOP_SCALES; i++) {
    setTarget(e, 90);
    const r = playTurn(e, 99);
    assert.strictEqual(r.points, 3);
    assert.ok(e.apply({ type: 'next' }, STAGE));
  }
  assert.strictEqual(e.s.phase, 'over');
  assert.strictEqual(e.s.coop.score, 21);
  assert.strictEqual(e.viewFor(STAGE).coop.rating.title, 'Gleiche Welle');
});

test('Kooperativ: eine 4 bringt eine Skala extra', () => {
  const e = phoneGame({ mode: 'coop' }, { a: null, b: null });
  setTarget(e, 90);
  const r = playTurn(e, 90);
  assert.strictEqual(r.extra, true);
  assert.strictEqual(e.s.coop.total, COOP_SCALES + 1);
});

test('Kooperativ: Wertungsstufen', () => {
  assert.strictEqual(coopRating(0).title, 'Funkloch');
  assert.strictEqual(coopRating(8).title, 'Rauschen');
  assert.strictEqual(coopRating(14).title, 'Guter Empfang');
  assert.strictEqual(coopRating(24).title, 'Gedankenleser');
});

/* ---------- Ein Gerät ---------- */

console.log('Ein Gerät');

test('Ein Gerät: Ziel nur in der Hinweis-Phase auf dem Laptop, dann Zeiger, Tipp, Aufdecken', () => {
  const state = Engine.create({
    settings: { input: 'one' },
    players: [
      { name: 'Anna', team: 'blau' },
      { name: 'Ben', team: 'blau' },
      { name: 'Cem', team: 'orange' },
      { name: 'Dana', team: 'orange' },
    ],
  });
  const e = new Engine(state, { timers: false, now: clock() });
  assert.strictEqual(e.s.phase, 'clue');
  assert.strictEqual(e.playerName(e.s.cur.giver), 'Anna');
  const target = e.s.cur.target;
  assert.strictEqual(e.viewFor(STAGE).cur.target, target);
  assert.ok(e.apply({ type: 'clue', text: 'Kaffee' }, STAGE));
  assert.strictEqual(e.viewFor(STAGE).cur.target, null, 'nach dem Verdecken nicht mehr abrufbar');
  assert.ok(e.apply({ type: 'dial', angle: target }, STAGE));
  assert.ok(e.apply({ type: 'lockNow' }, STAGE));
  assert.ok(e.apply({ type: 'side', side: 'left' }, STAGE));
  assert.strictEqual(e.s.cur.result.points, 4);
  assert.strictEqual(e.s.cur.result.sidePoint, 0, 'Zeiger genau auf der Mitte');
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.playerName(e.s.cur.giver), 'Cem');
});

test('Statistik: Volltreffer, Gleiche Welle, Funkloch', () => {
  const e = phoneGame({ sideGuess: false, catchUp: false }, FOUR);
  const turns = [
    [90, 90],
    [50, 140],
    [70, 76],
    [100, 106],
  ];
  for (const [t, d] of turns) {
    setTarget(e, t);
    playTurn(e, d);
    e.apply({ type: 'next' }, STAGE);
  }
  e.apply({ type: 'end' }, STAGE);
  const titles = e.s.awards.map((a) => a.title);
  assert.ok(titles.includes('Volltreffer'), titles.join());
  assert.ok(titles.includes('Gleiche Welle'));
  assert.ok(titles.includes('Funkloch'));
  assert.strictEqual(e.s.phase, 'over');
});

test('Nochmal: zurück in die Lobby mit denselben Leuten', () => {
  const e = phoneGame({}, FOUR);
  e.apply({ type: 'end' }, STAGE);
  assert.ok(e.apply({ type: 'again' }, STAGE));
  assert.strictEqual(e.s.phase, 'lobby');
  assert.strictEqual(e.s.players.length, 4);
  assert.ok(e.apply({ type: 'start' }, STAGE));
  assert.strictEqual(e.s.teams[1].score, 1);
});

/* ---------- Skala als SVG ---------- */

console.log('Skala');

test('SVG: Ziel nur, wenn bekannt, Abdeckung und Zeiger', () => {
  const closed = Dial.svg({ id: 'x', dial: 45, target: null, band: 7, cover: 'closed' });
  assert.ok(closed.includes('wl-cover'));
  assert.ok(!closed.includes('wl-band'));
  assert.ok(closed.includes('rotate(45deg)'));
  const open = Dial.svg({ id: 'x', dial: 45, target: 100, band: 7, cover: 'open' });
  assert.strictEqual((open.match(/wl-band wl-b/g) || []).length, 5);
  assert.ok(open.includes('is-open'));
  assert.ok(Dial.svg({ id: 'y', dial: 0, band: 7, input: true }).includes('data-dial-input'));
});

test('Winkel unter dem Finger: links 0°, oben 90°, rechts 180°, unten das nähere Ende', () => {
  const el = { getBoundingClientRect: () => ({ left: 0, top: 0, width: Dial.W, height: Dial.H }) };
  assert.strictEqual(Dial.angleAt(el, Dial.CX - 100, Dial.CY), 0);
  assert.strictEqual(Dial.angleAt(el, Dial.CX, Dial.CY - 100), 90);
  assert.strictEqual(Dial.angleAt(el, Dial.CX + 100, Dial.CY), 180);
  assert.strictEqual(Dial.angleAt(el, Dial.CX - 50, Dial.CY + 10), 0);
  assert.strictEqual(Dial.angleAt(el, Dial.CX + 50, Dial.CY + 10), 180);
  assert.strictEqual(Dial.angleAt(el, Dial.CX - 100, Dial.CY - 100), 45);
});

console.log(`\n${passed} Tests bestanden.`);
