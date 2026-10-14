'use strict';
/* Unit-Tests der Spiellogik (ohne Browser): node tests/engine.test.js */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
for (const f of ['words/erklaeren', 'words/zeichnen', 'words/pantomime', 'words/adult', 'deck', 'engine']) {
  require(path.join(__dirname, '..', 'guess-the-word', 'js', f + '.js'));
}
const { Engine, makeBoard, guessMatches, POINTS } = globalThis.ActivityEngine;

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

function offlineGame(extra) {
  const state = Engine.offline(
    Object.assign(
      {
        teams: [
          { id: 'rot', active: true, name: 'Die Roten', players: ['Anna', 'Ben', 'Cem'] },
          { id: 'blau', active: true, name: '', players: ['Dora', ''] },
          { id: 'gruen', active: false, name: 'X', players: ['Y'] },
          { id: 'gelb', active: false, name: '', players: [] },
        ],
        settings: { adult: false, timer: 60, length: 40 },
      },
      extra || {}
    )
  );
  const engine = new Engine(state);
  return { state, engine };
}

/** spielt einen kompletten Zug */
function playTurn(engine, success, diff) {
  const s = engine.s;
  if (s.turn.catFree) assert.ok(engine.apply({ type: 'category', cat: 'erklaeren' }, 'local'));
  assert.ok(engine.apply({ type: 'draw', diff: diff || 'mittel' }, 'local'));
  assert.strictEqual(s.phase, 'card');
  assert.ok(engine.apply({ type: 'startTimer' }, 'local'));
  assert.strictEqual(s.phase, 'running');
  assert.ok(engine.apply({ type: success ? 'success' : 'fail' }, 'local'));
  assert.strictEqual(s.phase, 'result');
  const result = s.result;
  engine.dispose();
  assert.ok(engine.apply({ type: 'next' }, 'local'));
  return result;
}

console.log('Spielbrett');
test('Start, Ziel und Länge stimmen', () => {
  for (const len of [32, 40, 48]) {
    const b = makeBoard(len);
    assert.strictEqual(b.length, len);
    assert.strictEqual(b[0], 'start');
    assert.strictEqual(b[len - 1], 'ziel');
  }
});
test('nie drei gleiche Kategorien hintereinander, alle Kategorien vorhanden', () => {
  for (let i = 0; i < 200; i++) {
    const b = makeBoard(40).slice(1, -1);
    for (let k = 2; k < b.length; k++) assert.ok(!(b[k] === b[k - 1] && b[k] === b[k - 2]), b.join(','));
    for (const c of ['erklaeren', 'zeichnen', 'pantomime']) assert.ok(b.includes(c));
  }
});

console.log('Offline-Spiel');
test('Teams werden angelegt, leere Namen bekommen Standardnamen', () => {
  const { state } = offlineGame();
  assert.deepStrictEqual(state.order.slice().sort(), ['blau', 'rot']);
  const blau = state.teams.find((t) => t.id === 'blau');
  assert.strictEqual(blau.name, 'Team Blau');
  assert.deepStrictEqual(blau.players.map((p) => p.name), ['Dora', 'Spieler 2']);
  assert.strictEqual(state.teams.find((t) => t.id === 'gruen').active, false);
  assert.strictEqual(state.phase, 'choose');
  assert.strictEqual(state.turn.catFree, true, 'Startfeld: Kategorie frei wählbar');
});

test('Stapel ziehen geht erst nach Kategoriewahl auf dem Startfeld', () => {
  const { engine } = offlineGame();
  assert.strictEqual(engine.apply({ type: 'draw', diff: 'leicht' }, 'local'), false);
  assert.ok(engine.apply({ type: 'category', cat: 'zeichnen' }, 'local'));
  assert.ok(engine.apply({ type: 'draw', diff: 'leicht' }, 'local'));
  assert.strictEqual(engine.s.turn.card.adult, false);
  assert.ok(engine.s.turn.card.term);
  engine.dispose();
});

test('Punkte: leicht 3, mittel 4, schwer 5 – Figur zieht entsprechend vor', () => {
  for (const diff of ['leicht', 'mittel', 'schwer']) {
    const { engine } = offlineGame();
    const team = engine.currentTeam();
    const r = playTurn(engine, true, diff);
    assert.strictEqual(r.points, POINTS[diff]);
    assert.strictEqual(team.pos, POINTS[diff]);
    assert.strictEqual(team.score, POINTS[diff]);
  }
  assert.deepStrictEqual(POINTS, { leicht: 3, mittel: 4, schwer: 5 });
});

test('Nicht erraten: Figur bleibt stehen', () => {
  const { engine } = offlineGame();
  const team = engine.currentTeam();
  const r = playTurn(engine, false);
  assert.strictEqual(r.points, 0);
  assert.strictEqual(team.pos, 0);
  assert.strictEqual(team.fail, 1);
});

test('Teams wechseln sich ab, Erklärer rotiert innerhalb des Teams', () => {
  const { engine, state } = offlineGame();
  const seen = { rot: [], blau: [] };
  for (let i = 0; i < 8; i++) {
    seen[state.turn.team].push(state.turn.explainerName);
    const before = state.turn.team;
    playTurn(engine, false);
    assert.notStrictEqual(state.turn.team, before);
  }
  assert.deepStrictEqual(seen.rot, ['Anna', 'Ben', 'Cem', 'Anna']);
  assert.deepStrictEqual(seen.blau, ['Dora', 'Spieler 2', 'Dora', 'Spieler 2']);
});

test('Kategorie kommt vom Feld, auf dem die Figur steht', () => {
  const { engine, state } = offlineGame();
  const first = state.turn.team;
  playTurn(engine, true, 'schwer'); // 5 Felder vor
  playTurn(engine, false); // anderes Team
  assert.strictEqual(state.turn.team, first);
  assert.strictEqual(state.turn.catFree, false);
  assert.strictEqual(state.turn.cat, state.board[5]);
});

test('Ziel erreichen gewinnt', () => {
  const { engine, state } = offlineGame();
  const team = engine.currentTeam();
  team.pos = state.board.length - 3;
  state.turn.cat = 'pantomime';
  state.turn.catFree = false;
  const r = playTurn(engine, true, 'leicht');
  assert.strictEqual(r.winner, true);
  assert.strictEqual(team.pos, state.board.length - 1);
  assert.strictEqual(state.phase, 'over');
  assert.strictEqual(state.winner, team.id);
});

test('Revanche setzt Positionen zurück', () => {
  const { engine, state } = offlineGame();
  playTurn(engine, true, 'schwer');
  assert.ok(engine.apply({ type: 'endGame' }, 'local'));
  assert.strictEqual(state.phase, 'over');
  assert.ok(engine.apply({ type: 'rematch' }, 'local'));
  assert.strictEqual(state.phase, 'choose');
  assert.ok(state.teams.every((t) => t.pos === 0 && t.score === 0));
});

test('Pause hält die Zeit an', () => {
  let now = 1000;
  const { state } = offlineGame();
  const engine = new Engine(state, { now: () => now });
  engine.apply({ type: 'category', cat: 'zeichnen' }, 'local');
  engine.apply({ type: 'draw', diff: 'leicht' }, 'local');
  engine.apply({ type: 'startTimer' }, 'local');
  now += 10000;
  engine.apply({ type: 'pause' }, 'local');
  assert.strictEqual(state.turn.remaining, 50000);
  now += 99999;
  assert.strictEqual(engine.viewFor('local').turn.timer.remaining, 50000);
  engine.apply({ type: 'resume' }, 'local');
  now += 5000;
  assert.strictEqual(engine.viewFor('local').turn.timer.remaining, 45000);
  engine.dispose();
});

test('Doppelte/veraltete Klicks werden ignoriert', () => {
  const { engine, state } = offlineGame();
  playTurn(engine, true, 'leicht');
  const no = state.turn.no;
  assert.strictEqual(engine.apply({ type: 'category', cat: 'erklaeren', no: no - 1 }, 'local'), false);
});

test('Nach dem Neuladen läuft die Zeit weiter bzw. ist abgelaufen', () => {
  let now = 5000;
  const { state } = offlineGame();
  const engine = new Engine(state, { now: () => now });
  engine.apply({ type: 'category', cat: 'erklaeren' }, 'local');
  engine.apply({ type: 'draw', diff: 'leicht' }, 'local');
  engine.apply({ type: 'startTimer' }, 'local');
  engine.dispose();
  now += 20000;
  const saved = JSON.stringify(state);
  const restored = new Engine(JSON.parse(saved), { now: () => now });
  assert.strictEqual(restored.s.phase, 'running');
  assert.strictEqual(restored.viewFor('local').turn.timer.remaining, 40000);
  restored.dispose();
  now += 60000;
  const late = new Engine(JSON.parse(saved), { now: () => now });
  assert.strictEqual(late.s.phase, 'timeout');
  assert.ok(late.s.turn.card.term);
});

console.log('Karten');
test('Erklären-Karten haben 3 Tabuwörter, Begriffe wiederholen sich im Spiel nicht', () => {
  const { engine, state } = offlineGame();
  const terms = new Set();
  for (let i = 0; i < 60; i++) {
    state.turn.cat = 'erklaeren';
    state.turn.catFree = false;
    engine.apply({ type: 'draw', diff: 'mittel' }, 'local');
    assert.strictEqual(state.turn.card.taboo.length, 3);
    assert.ok(!terms.has(state.turn.card.term), 'doppelt: ' + state.turn.card.term);
    terms.add(state.turn.card.term);
    engine.apply({ type: 'fail' }, 'local');
    engine.apply({ type: 'next' }, 'local');
  }
});

test('18+-Begriffe kommen nur, wenn eingeschaltet', () => {
  const off = offlineGame();
  const on = offlineGame({ settings: { adult: true, timer: 60, length: 40 } });
  let adultOff = 0;
  let adultOn = 0;
  for (const [g, inc] of [
    [off, () => adultOff++],
    [on, () => adultOn++],
  ]) {
    for (let i = 0; i < 80; i++) {
      g.state.turn.cat = 'pantomime';
      g.state.turn.catFree = false;
      g.engine.apply({ type: 'draw', diff: 'schwer' }, 'local');
      if (g.state.turn.card.adult) inc();
      g.engine.apply({ type: 'fail' }, 'local');
      g.engine.apply({ type: 'next' }, 'local');
    }
  }
  assert.strictEqual(adultOff, 0);
  assert.ok(adultOn > 0);
});

test('Tipps werden tolerant verglichen', () => {
  assert.ok(guessMatches('leuchtturm', 'Leuchtturm'));
  assert.ok(guessMatches('Leuchturm', 'Leuchtturm'), 'ein Tippfehler');
  assert.ok(guessMatches('zaehne putzen', 'Zähneputzen'));
  assert.ok(guessMatches('  Hänsel & Gretel ', 'Hänsel und Gretel') === false);
  assert.ok(!guessMatches('Hut', 'Hund'));
  assert.ok(!guessMatches('', 'Hund'));
});

console.log('Online-Spiel');
function onlineGame() {
  const state = Engine.lobby('host', 'Hanna');
  const engine = new Engine(state);
  engine.connect('p2', 'Paul');
  engine.connect('p3', 'Pia');
  engine.connect('p4', 'Olaf');
  engine.apply({ type: 'joinTeam', team: 'rot' }, 'host');
  engine.apply({ type: 'joinTeam', team: 'rot' }, 'p2');
  engine.apply({ type: 'joinTeam', team: 'blau' }, 'p3');
  engine.apply({ type: 'joinTeam', team: 'blau' }, 'p4');
  return { state, engine };
}

test('Nur der Host darf Einstellungen ändern und starten', () => {
  const { engine, state } = onlineGame();
  assert.strictEqual(engine.apply({ type: 'settings', settings: { adult: true } }, 'p2'), false);
  assert.ok(engine.apply({ type: 'settings', settings: { adult: true, timer: 90 } }, 'host'));
  assert.strictEqual(state.settings.timer, 90);
  assert.strictEqual(engine.apply({ type: 'start' }, 'p2'), false);
  assert.ok(engine.apply({ type: 'start' }, 'host'));
  assert.strictEqual(state.phase, 'choose');
});

test('Start braucht zwei Teams mit Spielern', () => {
  const state = Engine.lobby('host', 'Hanna');
  const engine = new Engine(state);
  engine.apply({ type: 'joinTeam', team: 'rot' }, 'host');
  assert.ok(engine.lobbyProblem());
  assert.strictEqual(engine.apply({ type: 'start' }, 'host'), false);
});

test('Host wählt nicht für fremde Teams, solange dort jemand verbunden ist', () => {
  const { engine, state } = onlineGame();
  engine.apply({ type: 'start' }, 'host');
  if (state.turn.team === 'rot') playTurnOnline(engine);
  assert.strictEqual(state.turn.team, 'blau');
  assert.strictEqual(engine.apply({ type: 'category', cat: 'zeichnen' }, 'host'), false);
  engine.disconnect('p3');
  engine.disconnect('p4');
  assert.ok(engine.apply({ type: 'category', cat: 'zeichnen' }, 'host'), 'Team Blau komplett offline -> Host springt ein');
});

test('Die Karte sieht nur, wer dran ist', () => {
  const { engine, state } = onlineGame();
  engine.apply({ type: 'start' }, 'host');
  const team = engine.currentTeam();
  const explainer = state.turn.explainer;
  const mate = team.players.find((p) => p.id !== explainer).id;
  assert.ok(engine.apply({ type: 'category', cat: 'erklaeren' }, mate), 'Teamkollege darf Kategorie wählen');
  const other = state.teams.find((t) => t.id !== team.id && t.players.length).players.find((p) => p.id !== 'host').id;
  assert.strictEqual(engine.apply({ type: 'draw', diff: 'leicht' }, other), false, 'anderes Team darf nicht ziehen');
  assert.ok(engine.apply({ type: 'draw', diff: 'leicht' }, explainer));
  assert.ok(engine.viewFor(explainer).turn.card.term);
  assert.strictEqual(engine.viewFor(mate).turn.card, null);
  assert.strictEqual(engine.viewFor(other).turn.card, null);
  assert.strictEqual(engine.apply({ type: 'startTimer' }, mate), mate === 'host');
  engine.dispose();
});

test('Richtiger Tipp aus dem eigenen Team beendet den Zug erfolgreich', () => {
  const { engine, state } = onlineGame();
  engine.apply({ type: 'start' }, 'host');
  const team = engine.currentTeam();
  const explainer = state.turn.explainer;
  const mate = team.players.find((p) => p.id !== explainer).id;
  const other = state.teams.find((t) => t.id !== team.id && t.players.length).players.find((p) => p.id !== 'host').id;
  engine.apply({ type: 'category', cat: 'zeichnen' }, explainer);
  engine.apply({ type: 'draw', diff: 'mittel' }, explainer);
  engine.apply({ type: 'startTimer' }, explainer);
  const term = state.turn.card.term;
  assert.strictEqual(engine.apply({ type: 'guess', text: term }, other), false, 'fremdes Team rät nicht mit');
  assert.ok(engine.apply({ type: 'guess', text: 'völlig falsch' }, mate));
  assert.strictEqual(state.phase, 'running');
  assert.ok(engine.apply({ type: 'guess', text: term.toLowerCase() }, mate));
  assert.strictEqual(state.phase, 'result');
  assert.strictEqual(state.result.success, true);
  assert.strictEqual(team.pos, 4);
});

test('Getrennte Spieler werden beim Erklären übersprungen', () => {
  const { engine, state } = onlineGame();
  engine.apply({ type: 'start' }, 'host');
  // Team Rot: Hanna (Host) und Paul – Paul verliert die Verbindung
  engine.disconnect('p2');
  for (let i = 0; i < 6; i++) {
    if (state.turn.team === 'rot') assert.strictEqual(state.turn.explainer, 'host');
    playTurnOnline(engine);
  }
});

function playTurnOnline(engine) {
  const s = engine.s;
  const who = s.turn.explainer;
  if (s.turn.catFree) assert.ok(engine.apply({ type: 'category', cat: 'pantomime' }, who));
  assert.ok(engine.apply({ type: 'draw', diff: 'leicht' }, who));
  assert.ok(engine.apply({ type: 'fail' }, who));
  assert.ok(engine.apply({ type: 'next' }, who));
}

test('Zuschauer können im laufenden Spiel einem Team beitreten', () => {
  const { engine, state } = onlineGame();
  engine.apply({ type: 'start' }, 'host');
  engine.connect('late', 'Lena');
  assert.ok(engine.apply({ type: 'joinTeam', team: 'blau' }, 'late'));
  assert.ok(state.teams.find((t) => t.id === 'blau').players.some((p) => p.id === 'late'));
  assert.strictEqual(engine.apply({ type: 'joinTeam', team: 'rot' }, 'late'), false, 'kein Teamwechsel im Spiel');
});

test('Host kann getrennte Spieler entfernen', () => {
  const { engine, state } = onlineGame();
  engine.disconnect('p4');
  assert.strictEqual(engine.apply({ type: 'kick', player: 'p4' }, 'p2'), false);
  assert.ok(engine.apply({ type: 'kick', player: 'p4' }, 'host'));
  assert.ok(!state.members.p4);
  assert.ok(!state.teams.some((t) => t.players.some((p) => p.id === 'p4')));
});

console.log(`\n✓ ${passed} Tests bestanden`);
