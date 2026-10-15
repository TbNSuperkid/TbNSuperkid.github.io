'use strict';
/* Tests für „Pferderennen“ (ohne Browser): node tests/pferderennen.test.js */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
for (const f of ['cards', 'race', 'comments', 'odds', 'engine']) {
  require(path.join(__dirname, '..', 'pferderennen', 'js', f + '.js'));
}
const Cards = globalThis.PFCards;
const Race = globalThis.PFRace;
const Comments = globalThis.PFComments;
const { Engine, STAGE, MIN_PLAYERS, CHIPS_START, sanitizeSettings } = globalThis.PFEngine;
const Odds = globalThis.PFOdds;

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

const NAMES = ['Anna', 'Ben', 'Cem', 'Dora', 'Eli', 'Finn'];

/** Rennen von Hand bauen: Strecke und Stapel fest vorgegeben */
function fixedRace(track, stack) {
  const r = Race.create({ length: track.length, random: Cards.seeded(1) });
  r.track = track.slice();
  r.shown = track.map(() => false);
  r.stack = stack.slice();
  return r;
}

function drawAll(r, cards) {
  let race = r;
  const events = [];
  for (const c of cards) {
    const out = Race.apply(race, c);
    race = out.race;
    events.push(...out.events);
  }
  return { race, events };
}

function game(settings, opts) {
  const o = opts || {};
  const hooks = { random: Cards.seeded(o.seed || 7), oddsRuns: 40 };
  const state = Engine.create({ settings: Object.assign({}, settings), players: o.players || NAMES.slice(0, o.n || 4) }, hooks);
  return new Engine(state, Object.assign({}, hooks, o.hooks));
}

function act(e, type, extra) {
  return e.apply(Object.assign({ type }, extra || {}), STAGE);
}

function betAll(e, suits, amount) {
  e.s.players.forEach((p, i) => assert.ok(act(e, 'bet', { player: p.id, suit: suits[i % suits.length], amount: amount || 2 })));
}

function runRace(e) {
  assert.ok(act(e, 'start', { at: e.s.step }), 'Start');
  let guard = 2000;
  while (e.s.phase === 'racing' && guard--) assert.ok(act(e, 'draw', { at: e.s.step }), 'Karte');
  assert.strictEqual(e.s.phase, 'payout', 'Rennen endet mit Abrechnung');
}

/* ---------- Deck ---------- */

console.log('Deck');

test('52 und 32 Karten, ohne Asse 48 bzw. 28', () => {
  assert.strictEqual(Cards.build(52).length, 52);
  assert.strictEqual(Cards.build(32).length, 32);
  assert.strictEqual(Cards.withoutAces(52).length, 48);
  assert.strictEqual(Cards.withoutAces(32).length, 28);
  assert.ok(!Cards.withoutAces(52).some((c) => c.endsWith('A')));
  assert.strictEqual(new Set(Cards.build(52)).size, 52, 'keine Karte doppelt');
});

test('Skatblatt fängt bei 7 an', () => {
  assert.ok(!Cards.build(32).some((c) => ['2', '3', '4', '5', '6'].includes(Cards.rankOf(c))));
});

test('mischen mit Seed ist reproduzierbar und behält alle Karten', () => {
  const a = Cards.shuffle(Cards.build(52), Cards.seeded(5));
  const b = Cards.shuffle(Cards.build(52), Cards.seeded(5));
  const c = Cards.shuffle(Cards.build(52), Cards.seeded(6));
  assert.deepStrictEqual(a, b);
  assert.notDeepStrictEqual(a, c);
  assert.deepStrictEqual(a.slice().sort(), Cards.build(52).sort());
});

test('Anzeige: Bube = B, Dame = D, Herz/Karo rot', () => {
  assert.deepStrictEqual(Cards.label('HQ'), { suit: 'H', symbol: '♥', name: 'Herz', rank: 'D', red: true });
  assert.strictEqual(Cards.label('SJ').rank, 'B');
  assert.strictEqual(Cards.label('C10').red, false);
});

test('Strecke wird vom Stapel genommen', () => {
  for (const size of [52, 32]) {
    for (const length of [5, 6, 7, 8]) {
      const r = Race.create({ size, length, random: Cards.seeded(length) });
      assert.strictEqual(r.track.length, length);
      assert.strictEqual(r.stack.length, size - 4 - length);
      assert.ok(!r.track.some((c) => r.stack.includes(c)), 'Streckenkarte nicht im Stapel');
      assert.ok(!r.track.concat(r.stack).some((c) => c.endsWith('A')), 'keine Asse');
    }
  }
});

/* ---------- Rennen ---------- */

console.log('Rennen');

test('Karte bewegt das Pferd ihrer Farbe', () => {
  const r = fixedRace(['C2', 'C3', 'C4', 'C5', 'C6', 'C7'], []);
  const { race, events } = Race.apply(r, 'H9');
  assert.deepStrictEqual(race.pos, { S: 0, H: 1, D: 0, C: 0 });
  assert.deepStrictEqual(events, [{ type: 'move', suit: 'H', from: 0, to: 1, card: 'H9' }]);
  assert.deepStrictEqual(r.pos, { S: 0, H: 0, D: 0, C: 0 }, 'altes Rennen bleibt unverändert');
});

test('Streckenkarte erst, wenn alle Pferde die Reihe erreicht haben', () => {
  const r = fixedRace(['H2', 'S3', 'D4', 'C5', 'H6', 'S7'], []);
  let { race } = drawAll(r, ['S2', 'S4', 'H3', 'D2']);
  assert.ok(race.shown.every((x) => !x), 'Kreuz fehlt noch');
  const out = Race.apply(race, 'C9');
  race = out.race;
  assert.deepStrictEqual(race.shown.slice(0, 2), [true, false]);
  const t = out.events.find((ev) => ev.type === 'track');
  assert.deepStrictEqual(t, { type: 'track', row: 1, card: 'H2', suit: 'H', from: 1, to: 0 });
  assert.strictEqual(race.pos.H, 0, 'Herz muss zurück');
});

test('jede Streckenkarte nur einmal, zurück nie hinter den Start', () => {
  // Reihe 1: ♠ zurück (♠ steht auf 1 → 0), danach erreicht ♠ Reihe 1 erneut – keine zweite Aufdeckung
  const r = fixedRace(['S2', 'C3', 'D4', 'H5', 'S6'], []);
  let { race, events } = drawAll(r, ['S3', 'H3', 'D3', 'C4', 'S4']);
  assert.strictEqual(events.filter((ev) => ev.type === 'track').length, 1);
  assert.strictEqual(race.pos.S, 1);
  // Pferd am Start wird von einer Streckenkarte nicht weiter zurückgeschoben
  const r2 = fixedRace(['S2', 'S3', 'S4', 'S5', 'S6'], []);
  r2.pos = { S: 0, H: 1, D: 1, C: 1 };
  r2.shown = [true, false, false, false, false];
  const out = Race.apply(r2, 'H9');
  assert.strictEqual(out.race.pos.S, 0);
  assert.ok(out.race.pos.S >= 0);
});

test('mehrere Reihen können nacheinander aufgedeckt werden', () => {
  const r = fixedRace(['C2', 'C3', 'C4', 'C5', 'C6'], []);
  r.pos = { S: 3, H: 3, D: 3, C: 2 };
  // Kreuz zieht auf 3 → Reihe 1 (Kreuz zurück auf 2), min ist dann 2 → Reihe 2 (Kreuz zurück auf 1)
  const { race, events } = Race.apply(r, 'C7');
  assert.deepStrictEqual(
    events.filter((ev) => ev.type === 'track').map((ev) => ev.row),
    [1, 2]
  );
  assert.strictEqual(race.pos.C, 1);
  assert.deepStrictEqual(race.shown, [true, true, false, false, false]);
});

test('Ziel erst nach der letzten Reihe', () => {
  const r = fixedRace(['C2', 'C3', 'C4', 'C5', 'C6'], []);
  r.pos = { S: 5, H: 0, D: 0, C: 0 };
  const out = Race.apply(r, 'S8');
  assert.strictEqual(out.race.winner, 'S');
  assert.strictEqual(out.race.pos.S, 6);
  assert.deepStrictEqual(out.events[out.events.length - 1], { type: 'finish', suit: 'S' });
  // Nach dem Sieg passiert nichts mehr
  const after = Race.apply(out.race, 'H8');
  assert.deepStrictEqual(after.events, []);
  assert.strictEqual(after.race.pos.H, 0);
});

test('leerer Stapel wird aus den aufgedeckten Karten neu gemischt', () => {
  const r = fixedRace(['C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9'], ['S2', 'H2']);
  let out = Race.draw(r, Cards.seeded(3));
  out = Race.draw(out.race, Cards.seeded(3));
  assert.strictEqual(out.race.stack.length, 0);
  out = Race.draw(out.race, Cards.seeded(3));
  assert.strictEqual(out.events[0].type, 'reshuffle');
  assert.strictEqual(out.events[0].count, 2);
  assert.strictEqual(out.race.stack.length + out.race.discard.length, 2, 'nur gezogene Karten, ohne Strecke');
  assert.ok(!out.race.stack.concat(out.race.discard).some((c) => c.startsWith('C')));
});

test('volle Rennen enden immer mit einem Sieger (32 und 52 Karten, alle Längen)', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const random = Cards.seeded(seed);
    let r = Race.create({ size: seed % 2 ? 52 : 32, length: 5 + (seed % 4), random });
    let guard = 5000;
    while (!r.winner && guard--) r = Race.draw(r, random).race;
    assert.ok(r.winner, 'Sieger bei Seed ' + seed);
    assert.strictEqual(r.pos[r.winner], r.length + 1);
    for (const s of Cards.SUITS) if (s !== r.winner) assert.ok(r.pos[s] <= r.length);
    assert.strictEqual(r.stack.length + r.discard.length + r.track.length, (seed % 2 ? 48 : 28), 'keine Karte verloren');
  }
});

test('Platzierung: Sieger, dann Position, bei Gleichstand wer zuerst dort war', () => {
  const r = fixedRace(['C2', 'C3', 'C4', 'C5', 'C6', 'C7'], []);
  // ♦ kommt vor ♥ auf Feld 2, ♣ bleibt bei 1, ♠ gewinnt
  const { race } = drawAll(r, ['D2', 'D3', 'H2', 'H3', 'C9', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
  assert.strictEqual(race.winner, 'S');
  assert.deepStrictEqual(Race.ranking(race), ['S', 'D', 'H', 'C']);
});

test('Gleichstand durch Zurückfallen: wer vorher dort stand, liegt vorn', () => {
  const r = fixedRace(['H2', 'C3', 'C4', 'C5', 'C6', 'C7'], []);
  // ♥ zieht auf 2, die anderen auf 1. Reihe 1 deckt ♥ auf → ♥ fällt auf 1 zurück und kommt als Letzter dort an
  const { race } = drawAll(r, ['H2', 'H3', 'S2', 'D2', 'C2']);
  assert.strictEqual(race.pos.H, 1);
  assert.deepStrictEqual(Race.ranking(race), ['S', 'D', 'C', 'H']);
});

/* ---------- Spiel & Abrechnung ---------- */

console.log('Spiel & Abrechnung');

test('Einstellungen werden geprüft', () => {
  const s = sanitizeSettings({ deck: 33, length: 9, maxBet: 7, payout: 4, speed: 'turbo', races: 4, lastDouble: 'ja' });
  assert.deepStrictEqual(s, sanitizeSettings({}));
  const t = sanitizeSettings({ deck: '32', length: 8, maxBet: 10, payout: 3, speed: 'tap', races: 5, lastDouble: true, secondFree: true });
  assert.deepStrictEqual(
    [t.deck, t.length, t.maxBet, t.payout, t.speed, t.races, t.lastDouble, t.secondFree],
    [32, 8, 10, 3, 'tap', 5, true, true]
  );
});

test('neues Spiel: mindestens 2 Personen, Namen eindeutig', () => {
  const e = game({}, { players: ['Anna', 'anna', ''] });
  assert.deepStrictEqual(e.s.players.map((p) => p.name), ['Anna', 'anna 2']);
  const f = game({}, { players: ['Solo'] });
  assert.strictEqual(f.s.players.length, MIN_PLAYERS);
  assert.strictEqual(f.s.phase, 'betting');
});

test('Wetten: Einsatz 1 bis Maximum, Start erst wenn alle gesetzt haben', () => {
  const e = game({ maxBet: 5 }, { n: 3 });
  const [a, b, c] = e.s.players;
  assert.ok(act(e, 'bet', { player: a.id, suit: 'S', amount: 9 }));
  assert.strictEqual(e.s.bets[a.id].amount, 5);
  assert.ok(!act(e, 'bet', { player: b.id, suit: 'X' }), 'unbekannte Farbe');
  assert.ok(act(e, 'bet', { player: b.id, suit: 'H', amount: 0 }));
  assert.strictEqual(e.s.bets[b.id].amount, 1);
  assert.ok(!act(e, 'amount', { player: b.id, delta: -1 }), 'nicht unter 1');
  assert.ok(act(e, 'amount', { player: b.id, delta: 1 }));
  assert.strictEqual(e.s.bets[b.id].amount, 2);
  assert.ok(!act(e, 'start', { at: e.s.step }), 'Cem fehlt noch');
  assert.deepStrictEqual(e.viewFor(STAGE).missing, [c.id]);
  assert.ok(act(e, 'randomBets'));
  assert.ok(e.s.bets[c.id]);
  assert.strictEqual(e.s.bets[a.id].suit, 'S', 'vorhandene Wetten bleiben');
  assert.ok(act(e, 'start', { at: e.s.step }));
  assert.strictEqual(e.s.phase, 'racing');
  assert.ok(!act(e, 'bet', { player: a.id, suit: 'D' }), 'keine Wetten während des Rennens');
});

test('veraltete Aktionen werden ignoriert (doppelt getippt)', () => {
  const e = game({}, { n: 2 });
  betAll(e, ['S', 'H']);
  const at = e.s.step;
  assert.ok(act(e, 'start', { at }));
  const drawAt = e.s.step;
  assert.ok(act(e, 'draw', { at: drawAt }));
  assert.ok(!act(e, 'draw', { at: drawAt }), 'gleiche Karte nicht zweimal');
});

test('Abrechnung: Sieger verteilen Einsatz × Faktor, die anderen trinken', () => {
  for (const payout of [1, 2, 3]) {
    const e = game({ payout }, { n: 4 });
    betAll(e, ['S', 'H', 'D', 'C'], 3);
    runRace(e);
    const r = e.s.result;
    assert.strictEqual(r.lines.length, 4);
    for (const l of r.lines) {
      if (l.suit === r.winner) {
        assert.strictEqual(l.give, 3 * payout);
        assert.strictEqual(l.drink, 0);
      } else {
        assert.strictEqual(l.give, 0);
        assert.strictEqual(l.drink, 3);
      }
    }
  }
});

test('Option „Letzter trinkt doppelt“ und „Platz 2 trinkt nichts“', () => {
  const e = game({ lastDouble: true, secondFree: true }, { n: 4 });
  betAll(e, ['S', 'H', 'D', 'C'], 2);
  runRace(e);
  const r = e.s.result;
  const bySuit = (s) => r.lines.find((l) => l.suit === s);
  assert.strictEqual(bySuit(r.ranking[0]).give, 4);
  assert.strictEqual(bySuit(r.ranking[1]).drink, 0);
  assert.strictEqual(bySuit(r.ranking[1]).note, 'second');
  assert.strictEqual(bySuit(r.ranking[2]).drink, 2);
  assert.strictEqual(bySuit(r.ranking[3]).drink, 4);
  assert.strictEqual(bySuit(r.ranking[3]).note, 'last');
});

test('niemand setzt auf den Sieger: alle trinken, keiner verteilt', () => {
  // Rennen mit Seed laufen lassen, dann alle auf ein Verliererpferd setzen
  const probe = game({}, { n: 2, seed: 11 });
  betAll(probe, ['S']);
  runRace(probe);
  const loser = probe.s.result.ranking[1];
  const e = game({}, { n: 3, seed: 11 });
  betAll(e, [loser], 2);
  runRace(e);
  assert.notStrictEqual(e.s.result.winner, loser);
  assert.ok(e.s.result.lines.every((l) => l.give === 0 && l.drink === 2));
});

test('Statistik zählt mit, Rangliste sortiert nach verteilt', () => {
  const e = game({ races: 3 }, { n: 4 });
  for (let i = 0; i < 3; i++) {
    if (i) assert.ok(act(e, 'sameBets'));
    else betAll(e, ['S', 'H', 'D', 'C'], 2);
    runRace(e);
    assert.ok(act(e, 'next', { at: e.s.step }));
  }
  assert.strictEqual(e.s.phase, 'end', 'nach 3 Rennen ist Schluss');
  assert.strictEqual(e.s.history.length, 3);
  const v = e.viewFor(STAGE);
  const given = v.standings.map((p) => p.stats.given);
  assert.deepStrictEqual(given, given.slice().sort((x, y) => y - x));
  const total = v.standings.reduce((n, p) => n + p.stats.wins, 0);
  assert.strictEqual(total, 3, 'pro Rennen genau ein Gewinner (jedes Pferd hat eine Person)');
  assert.strictEqual(Object.values(v.wins).reduce((n, x) => n + x, 0), 3);
});

test('nächstes Rennen: Wetten zurückgesetzt, „Gleiche Wette“ übernimmt sie', () => {
  const e = game({ maxBet: 10 }, { n: 2 });
  betAll(e, ['D', 'C'], 7);
  runRace(e);
  assert.ok(act(e, 'next', { at: e.s.step }));
  assert.strictEqual(e.s.raceNo, 2);
  assert.deepStrictEqual(e.s.bets, {});
  assert.ok(e.viewFor(STAGE).hasLastBets);
  // Maximum inzwischen kleiner → Einsatz wird angepasst
  assert.ok(act(e, 'settings', { settings: Object.assign({}, e.s.settings, { maxBet: 5 }) }));
  assert.ok(act(e, 'sameBets'));
  assert.deepStrictEqual(Object.values(e.s.bets).map((b) => [b.suit, b.amount]), [['D', 5], ['C', 5]]);
});

test('Rennen abbrechen: zurück ins Wettbüro, Wetten bleiben', () => {
  const e = game({}, { n: 2 });
  betAll(e, ['S', 'H']);
  assert.ok(act(e, 'start', { at: e.s.step }));
  assert.ok(act(e, 'draw', { at: e.s.step }));
  assert.ok(act(e, 'abort'));
  assert.strictEqual(e.s.phase, 'betting');
  assert.strictEqual(e.s.race, null);
  assert.strictEqual(Object.keys(e.s.bets).length, 2);
});

test('Pause schaltet um, nur im Rennen', () => {
  const e = game({}, { n: 2 });
  assert.ok(!act(e, 'pause'));
  betAll(e, ['S', 'H']);
  act(e, 'start', { at: e.s.step });
  assert.ok(act(e, 'pause'));
  assert.strictEqual(e.s.paused, true);
  assert.ok(!act(e, 'pause', { paused: true }), 'schon pausiert');
  assert.ok(act(e, 'pause', { paused: false }));
});

test('Personen dazu und weg, nie unter 2', () => {
  const e = game({}, { n: 2 });
  assert.ok(act(e, 'addPlayer', { name: 'Cem' }));
  const cem = e.s.players[2];
  act(e, 'bet', { player: cem.id, suit: 'C' });
  assert.ok(act(e, 'removePlayer', { player: cem.id }));
  assert.ok(!e.s.bets[cem.id], 'Wette fällt weg');
  assert.ok(!act(e, 'removePlayer', { player: e.s.players[0].id }), 'mindestens 2');
});

test('Ansicht verrät keine verdeckten Streckenkarten und keinen Stapel', () => {
  const e = game({}, { n: 2 });
  betAll(e, ['S', 'H']);
  act(e, 'start', { at: e.s.step });
  const v = e.viewFor(STAGE);
  assert.ok(v.race.track.every((c) => c === null));
  assert.strictEqual(v.race.stack, undefined);
  assert.strictEqual(v.race.left, 48 - 6);
  const json = JSON.stringify(v);
  for (const c of e.s.race.track) assert.ok(!json.includes(`"${c}"`), 'Streckenkarte ' + c + ' sichtbar');
});

test('Nochmal: Statistik und Rennzähler von vorn', () => {
  const e = game({ races: 3 }, { n: 2 });
  betAll(e, ['S', 'H']);
  runRace(e);
  assert.ok(act(e, 'finish'));
  assert.strictEqual(e.s.phase, 'end');
  assert.ok(act(e, 'again'));
  assert.strictEqual(e.s.raceNo, 1);
  assert.ok(e.s.players.every((p) => p.stats.races === 0));
  assert.strictEqual(e.s.phase, 'betting');
});

test('Spielstand lässt sich als JSON speichern und weiterspielen', () => {
  const e = game({}, { n: 3 });
  betAll(e, ['S', 'H', 'D']);
  act(e, 'start', { at: e.s.step });
  for (let i = 0; i < 5; i++) act(e, 'draw', { at: e.s.step });
  const copy = new Engine(JSON.parse(JSON.stringify(e.s)), { random: Cards.seeded(1) });
  let guard = 2000;
  while (copy.s.phase === 'racing' && guard--) copy.apply({ type: 'draw', at: copy.s.step }, STAGE);
  assert.strictEqual(copy.s.phase, 'payout');
});

/* ---------- Kommentar ---------- */

console.log('Kommentar');

/** Rennen mit vorgegebenen Positionen, dann eine Karte anwenden und kommentieren */
function comment(pos, card, opts) {
  const o = opts || {};
  const r = fixedRace(o.track || ['C2', 'C3', 'C4', 'C5', 'C6', 'C7'], []);
  r.pos = Object.assign({ S: 0, H: 0, D: 0, C: 0 }, pos);
  r.tick = o.tick === undefined ? 5 : o.tick;
  // Reihen, die alle Pferde schon erreicht haben, sind wie im echten Rennen aufgedeckt
  const min = Math.min(...Object.values(r.pos));
  r.shown = o.shown || r.track.map((_, i) => i + 1 <= min);
  const out = Race.apply(r, card);
  return Comments.say(r, out.race, out.events, { bettors: o.bettors || {}, random: Cards.seeded(1) });
}

test('erste Karte: Start-Kommentar', () => {
  const c = comment({}, 'S5', { tick: 0 });
  assert.strictEqual(c.key, 'start');
  assert.ok(c.text.includes('Pik'));
});

test('Streckenkarte schickt Pferd zurück: Drama, beim Spitzenreiter „Bitter!“', () => {
  const c = comment({ S: 1, H: 1, D: 1, C: 0 }, 'C9', { track: ['D2', 'C3', 'C4', 'C5', 'C6', 'C7'], bettors: { D: ['Dora'] } });
  assert.strictEqual(c.key, 'drama');
  assert.strictEqual(c.mood, 'drama');
  assert.ok(c.text.includes('Karo') && c.text.includes('Dora leidet'), c.text);
  const top = comment({ S: 1, H: 1, D: 3, C: 0 }, 'C9', { track: ['D2', 'C3', 'C4', 'C5', 'C6', 'C7'] });
  assert.ok(top.text.startsWith('Bitter! Spitzenreiter ♦ Karo'), top.text);
});

test('Führung: Kopf an Kopf, Führungswechsel mit Jubel der Wettenden', () => {
  assert.strictEqual(comment({ S: 2, H: 3 }, 'S9').key, 'tie');
  const d = comment({ S: 3, H: 3 }, 'S9', { bettors: { S: ['Anna', 'Ben'] } });
  assert.strictEqual(d.key, 'lead');
  assert.ok(d.text.includes('Anna und Ben jubeln'), d.text);
  const e = comment({ S: 3, H: 4, D: 3 }, 'S9');
  assert.strictEqual(e.key, 'tie');
  const f = comment({ S: 4, H: 4, D: 4 }, 'S9');
  assert.ok(f.text.includes('an die Spitze'), f.text);
});

test('davonziehen, Aufholjagd, kurz vor dem Ziel', () => {
  assert.strictEqual(comment({ S: 3, H: 2, D: 1, C: 1 }, 'S9').key, 'away');
  // ♣ war nach einer Streckenkarte allein Letzter (Reihe 2 schon aufgedeckt) und schließt auf
  assert.strictEqual(comment({ S: 3, H: 2, D: 3, C: 1 }, 'C9', { shown: [true, true, false, false, false, false] }).key, 'catchup');
  assert.strictEqual(comment({ S: 5, H: 2, D: 2, C: 1 }, 'S9').key, 'near');
  assert.strictEqual(comment({ S: 6, H: 5, D: 2, C: 1 }, 'H9').key, 'alarm');
});

test('Sieg: normal, überlegen, Fotofinish', () => {
  const photo = comment({ S: 6, H: 6 }, 'S9', { bettors: { S: ['Cem'] } });
  assert.strictEqual(photo.key, 'photo');
  assert.ok(photo.text.includes('Herz') && photo.text.includes('Cem jubelt'), photo.text);
  assert.strictEqual(comment({ S: 6, H: 2 }, 'S9').key, 'win-big');
  const win = comment({ S: 6, H: 5 }, 'S9');
  assert.strictEqual(win.key, 'win');
  assert.ok(win.text.includes('Darauf hat niemand gesetzt'));
});

test('jede gezogene Karte bekommt einen Kommentar', () => {
  const e = game({}, { n: 4 });
  betAll(e, ['S', 'H', 'D', 'C']);
  act(e, 'start', { at: e.s.step });
  let guard = 2000;
  while (e.s.phase === 'racing' && guard--) {
    act(e, 'draw', { at: e.s.step });
    const say = e.viewFor(STAGE).race.say;
    assert.ok(say && say.text, 'Kommentar fehlt bei Karte ' + e.s.race.tick);
  }
  assert.ok(['win', 'win-big', 'photo'].includes(e.s.result.say.key));
});

/* ---------- Statistik ---------- */

console.log('Statistik');

test('Fotofinish wird in Ergebnis und Verlauf vermerkt', () => {
  let photos = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const e = game({}, { n: 2, seed });
    betAll(e, ['S', 'H']);
    runRace(e);
    const r = e.s.result;
    const close = r.ranking.slice(1).some((x) => e.s.race.pos[x] === e.s.race.length);
    assert.strictEqual(r.photo, close);
    assert.strictEqual(e.s.history[0].photo, close);
    assert.strictEqual(r.margin, e.s.race.length + 1 - e.s.race.pos[r.ranking[1]]);
    if (close) photos++;
  }
  assert.ok(photos > 0, 'mindestens ein Fotofinish in 40 Rennen');
});

test('Auszeichnungen: Wettkönig:in, Pechvogel, Zocker:in, Treue Seele', () => {
  const e = game({ maxBet: 10 }, { n: 3 });
  const [a, b, c] = e.s.players;
  assert.deepStrictEqual(e.awards(), [], 'vor dem ersten Rennen keine');
  for (let i = 0; i < 3; i++) {
    act(e, 'bet', { player: a.id, suit: 'S', amount: 10 });
    act(e, 'bet', { player: b.id, suit: i % 2 ? 'H' : 'D', amount: 1 });
    act(e, 'bet', { player: c.id, suit: 'C', amount: 2 });
    runRace(e);
    act(e, 'next', { at: e.s.step });
    if (i === 1) assert.ok(!e.awards().some((x) => x.id === 'loyal'), 'Treue Seele erst ab 3 Rennen');
  }
  const aw = Object.fromEntries(e.awards().map((x) => [x.id, x]));
  assert.deepStrictEqual(aw.gambler.names, ['Anna']);
  assert.strictEqual(aw.gambler.text, '30 Schlucke gesetzt');
  assert.deepStrictEqual(aw.loyal.names, ['Anna', 'Cem'], 'Ben hat gewechselt');
  const expect = (fn) => {
    const max = Math.max(...e.s.players.map(fn));
    const names = e.s.players.filter((p) => fn(p) === max).map((p) => p.name);
    return max && names.length < 3 ? names : undefined;
  };
  assert.deepStrictEqual(aw.unlucky && aw.unlucky.names, expect((p) => p.stats.drank));
  assert.deepStrictEqual(aw.king && aw.king.names, expect((p) => p.stats.given));
});

test('Auszeichnung nur, wenn sie jemanden heraushebt (nicht alle, höchstens 3)', () => {
  const e = game({}, { n: 5 });
  betAll(e, ['S'], 2); // alle auf dasselbe Pferd, gleicher Einsatz
  runRace(e);
  const ids = e.awards().map((x) => x.id);
  assert.ok(!ids.includes('gambler'), 'alle gleich viel gesetzt');
  assert.ok(!ids.includes('unlucky') && !ids.includes('king') && !ids.includes('seer'));
});

test('Pferde-Bilanz: Siege und Ø Platz', () => {
  const e = game({}, { n: 2 });
  for (let i = 0; i < 3; i++) {
    if (i) act(e, 'sameBets');
    else betAll(e, ['S', 'H']);
    runRace(e);
    act(e, 'next', { at: e.s.step });
  }
  const h = e.horseStats();
  assert.strictEqual(h.reduce((n, x) => n + x.wins, 0), 3);
  for (const x of h) assert.ok(x.avg >= 1 && x.avg <= 4);
  assert.ok(h[0].wins >= h[1].wins, 'sortiert nach Siegen');
  assert.strictEqual(e.s.history.reduce((n, x) => n + (x.ranking.indexOf('S') + 1), 0) / 3, h.find((x) => x.suit === 'S').avg);
});

/* ---------- Live-Chancen ---------- */

console.log('Live-Chancen');

test('Chancen ergeben zusammen 100 %, beim Start etwa gleich verteilt', () => {
  const r = Race.create({ random: Cards.seeded(4) });
  const c = Odds.chances(r, { runs: 2000, random: Cards.seeded(5) });
  const sum = Cards.SUITS.reduce((n, s) => n + c[s], 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  for (const s of Cards.SUITS) assert.ok(c[s] > 0.17 && c[s] < 0.33, s + ' ' + c[s]);
});

test('Pferd im Ziel = 100 %, weit vorn = Favorit', () => {
  const r = fixedRace(['C2', 'C3', 'C4', 'C5', 'C6', 'C7'], Cards.withoutAces(52).filter((c) => !c.startsWith('C')));
  const done = Race.apply(Object.assign(Race.clone(r), { pos: { S: 6, H: 0, D: 0, C: 0 } }), 'S9').race;
  assert.deepStrictEqual(Odds.chances(done), { S: 1, H: 0, D: 0, C: 0 });
  const lead = Race.clone(r);
  lead.pos = { S: 5, H: 1, D: 1, C: 1 };
  lead.shown = [true, false, false, false, false, false];
  const c = Odds.chances(lead, { runs: 500, random: Cards.seeded(2) });
  assert.ok(c.S > 0.8, 'Pik ist klarer Favorit: ' + c.S);
});

test('Chancen verraten nicht, wo die verdeckten Streckenkarten liegen', () => {
  // gleiche sichtbare Lage, verdeckte Strecke anders sortiert → identische Chancen
  const a = fixedRace(['C2', 'S3', 'H4', 'D5', 'S6', 'S7'], ['H2', 'D2', 'S2', 'C3', 'H3', 'D3']);
  const b = fixedRace(['C2', 'S7', 'S6', 'D5', 'H4', 'S3'], ['H2', 'D2', 'S2', 'C3', 'H3', 'D3']);
  for (const r of [a, b]) {
    r.pos = { S: 1, H: 2, D: 1, C: 1 };
    r.shown = [true, false, false, false, false, false];
  }
  assert.deepStrictEqual(Odds.chances(a, { runs: 300, random: Cards.seeded(9) }), Odds.chances(b, { runs: 300, random: Cards.seeded(9) }));
});

test('Quoten: unter fair, zwischen Minimum und Maximum', () => {
  assert.strictEqual(Odds.quote(0.5), 1.8);
  assert.strictEqual(Odds.quote(0.25), 3.6);
  assert.strictEqual(Odds.quote(0.1), 9);
  assert.strictEqual(Odds.quote(0.99), Odds.QUOTE_MIN);
  assert.strictEqual(Odds.quote(0), Odds.QUOTE_MAX);
});

test('Engine rechnet Chancen zu jeder Karte (abschaltbar)', () => {
  const e = game({}, { n: 2 });
  betAll(e, ['S', 'H']);
  act(e, 'start', { at: e.s.step });
  assert.ok(e.viewFor(STAGE).race.odds, 'schon am Start');
  act(e, 'draw', { at: e.s.step });
  const v = e.viewFor(STAGE).race;
  assert.ok(v.odds && v.oddsPrev);
  const f = game({ odds: false }, { n: 2 });
  betAll(f, ['S', 'H']);
  act(f, 'start', { at: f.s.step });
  act(f, 'draw', { at: f.s.step });
  assert.strictEqual(f.viewFor(STAGE).race.odds, null);
  assert.strictEqual(f.s.race.odds, undefined, 'gar nicht erst gerechnet');
});

/* ---------- Chips-Modus ---------- */

console.log('Chips-Modus');

test('Chips: Start mit 20, Einsatz höchstens alle eigenen, Sieger × 3 zurück', () => {
  const e = game({ currency: 'chips' }, { n: 4 });
  assert.ok(e.s.players.every((p) => p.chips === CHIPS_START));
  const [a] = e.s.players;
  act(e, 'bet', { player: a.id, suit: 'S', amount: 99 });
  assert.strictEqual(e.s.bets[a.id].amount, CHIPS_START, 'max. alle eigenen Chips');
  betAll(e, ['S', 'H', 'D', 'C'], 5);
  runRace(e);
  const r = e.s.result;
  for (const l of r.lines) {
    const p = e.player(l.id);
    if (l.suit === r.winner) assert.strictEqual(p.chips, CHIPS_START + 10);
    else assert.strictEqual(p.chips, CHIPS_START - 5);
    assert.strictEqual(l.after - l.before, l.delta);
    assert.strictEqual(l.give + l.drink, 0, 'keine Schlucke im Chips-Modus');
  }
});

test('Chips: pleite → Mitleidschip zum nächsten Rennen, Rangliste nach Chips', () => {
  const e = game({ currency: 'chips' }, { n: 2 });
  const [a, b] = e.s.players;
  act(e, 'bet', { player: a.id, suit: 'S', amount: 20 });
  act(e, 'bet', { player: b.id, suit: 'H', amount: 1 });
  runRace(e);
  const loser = e.s.result.winner === 'S' ? b : a;
  if (loser === a) assert.strictEqual(a.chips, 0, 'All-in verloren');
  // jemanden pleite machen, falls nicht schon passiert
  loser.chips = 0;
  assert.ok(!act(e, 'next', { at: e.s.step - 1 }), 'veraltet');
  act(e, 'next', { at: e.s.step });
  assert.strictEqual(loser.chips, 1);
  assert.strictEqual(e.s.event.kind, 'pity');
  const st = e.viewFor(STAGE).standings;
  assert.ok(st[0].chips >= st[1].chips);
});

test('Chips: Auszeichnungen in Chips, Nochmal setzt Chips zurück', () => {
  const e = game({ currency: 'chips', races: 3 }, { n: 3 });
  const [a, b, c] = e.s.players;
  for (let i = 0; i < 3; i++) {
    act(e, 'bet', { player: a.id, suit: 'S', amount: 1 });
    act(e, 'bet', { player: b.id, suit: 'H', amount: 1 });
    act(e, 'bet', { player: c.id, suit: 'D', amount: 6 });
    runRace(e);
    act(e, 'next', { at: e.s.step });
  }
  assert.strictEqual(e.s.phase, 'end');
  const aw = e.awards().find((x) => x.id === 'gambler');
  assert.strictEqual(aw.text, '18 Chips gesetzt');
  act(e, 'again');
  assert.ok(e.s.players.every((p) => p.chips === CHIPS_START));
});

test('Währung lässt sich nur vor dem ersten Rennen wechseln', () => {
  const e = game({}, { n: 2 });
  assert.ok(act(e, 'settings', { settings: Object.assign({}, e.s.settings, { currency: 'chips' }) }));
  assert.strictEqual(e.s.settings.currency, 'chips');
  betAll(e, ['S', 'H']);
  runRace(e);
  act(e, 'settings', { settings: Object.assign({}, e.s.settings, { currency: 'sips' }) });
  assert.strictEqual(e.s.settings.currency, 'chips');
});

/* ---------- Quoten-Wetten ---------- */

console.log('Quoten-Wetten');

/** Bis die erste Streckenkarte aufgedeckt ist */
function untilOdds(e) {
  let guard = 500;
  while (!e.s.oddsWin && e.s.phase === 'racing' && guard--) act(e, 'draw', { at: e.s.step });
  return e.s.oddsWin;
}

test('Nach der ersten Streckenkarte: Fenster zum Nachsetzen, Rennen wartet', () => {
  const e = game({ currency: 'chips', oddsBets: true }, { n: 3 });
  betAll(e, ['S', 'H', 'D'], 5);
  act(e, 'start', { at: e.s.step });
  const w = untilOdds(e);
  assert.ok(w, 'Fenster offen');
  assert.ok(e.s.race.shown[0] && !e.s.race.shown[1]);
  for (const s of Cards.SUITS) assert.ok(w.quotes[s] >= Odds.QUOTE_MIN && w.quotes[s] <= Odds.QUOTE_MAX);
  assert.ok(!act(e, 'draw', { at: e.s.step }), 'Rennen pausiert, bis alle getippt haben');
  const [a, b, c] = e.s.players;
  assert.ok(act(e, 'oddsBet', { player: a.id, suit: 'C', amount: 99 }));
  assert.strictEqual(e.s.oddsWin.bets[a.id].amount, CHIPS_START - 5, 'nur was neben dem Einsatz übrig ist');
  assert.strictEqual(e.s.oddsWin.bets[a.id].odds, w.quotes.C);
  act(e, 'oddsBet', { player: b.id, skip: true });
  assert.ok(e.s.oddsWin, 'Cem fehlt noch');
  act(e, 'oddsBet', { player: c.id, suit: 'D', amount: 2 });
  assert.strictEqual(e.s.oddsWin, null, 'alle haben getippt → weiter');
  assert.deepStrictEqual(Object.keys(e.s.oddsBets).sort(), [a.id, c.id].sort());
  assert.ok(act(e, 'draw', { at: e.s.step }));
});

test('Quoten-Wette wird mit der Quote ausgezahlt', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const e = game({ currency: 'chips', oddsBets: true }, { n: 2, seed });
    betAll(e, ['S', 'H'], 2);
    act(e, 'start', { at: e.s.step });
    if (!untilOdds(e)) continue;
    const [a] = e.s.players;
    act(e, 'oddsBet', { player: a.id, suit: 'D', amount: 4 });
    act(e, 'closeOdds');
    let guard = 500;
    while (e.s.phase === 'racing' && guard--) act(e, 'draw', { at: e.s.step });
    const l = e.s.result.lines.find((x) => x.id === a.id);
    const main = l.suit === e.s.result.winner ? 4 : -2;
    const extra = e.s.result.winner === 'D' ? Math.round(4 * l.extra.odds) - 4 : -4;
    assert.strictEqual(l.extra.delta, extra);
    assert.strictEqual(l.delta, main + extra);
    assert.strictEqual(a.chips, Math.max(0, CHIPS_START + main + extra));
  }
});

test('Ohne Chips-Modus keine Quoten-Wetten', () => {
  const e = game({ oddsBets: true }, { n: 2 });
  betAll(e, ['S', 'H']);
  runRace(e);
  assert.strictEqual(e.s.oddsWin, null);
});

/* ---------- Echte Karten ---------- */

console.log('Echte Karten');

test('Echte Karten: Wetten, Siegerpferd antippen, Abrechnung', () => {
  const e = game({ input: 'real', lastDouble: true }, { n: 3 });
  betAll(e, ['S', 'H', 'D'], 2);
  assert.ok(act(e, 'start', { at: e.s.step }));
  assert.strictEqual(e.s.phase, 'racing');
  assert.strictEqual(e.s.race, null, 'kein Rennen in der App');
  assert.ok(!act(e, 'draw', { at: e.s.step }));
  assert.ok(!act(e, 'result', { at: e.s.step, ranking: ['X'] }));
  assert.ok(act(e, 'result', { at: e.s.step, ranking: ['H', 'C', 'S'] }));
  const r = e.s.result;
  assert.deepStrictEqual(r.ranking, ['H', 'C', 'S', 'D']);
  assert.strictEqual(r.lines.find((l) => l.suit === 'H').give, 4);
  assert.strictEqual(r.lines.find((l) => l.suit === 'D').drink, 4, 'Letzter doppelt');
  assert.strictEqual(r.photo, false);
  assert.strictEqual(e.s.history.length, 1);
});

test('Echte Karten: nur Sieger getippt reicht', () => {
  const e = game({ input: 'real' }, { n: 2 });
  betAll(e, ['S', 'H']);
  act(e, 'start', { at: e.s.step });
  assert.ok(act(e, 'result', { at: e.s.step, ranking: ['S'] }));
  assert.strictEqual(e.s.result.winner, 'S');
});

/* ---------- Mit Handys ---------- */

console.log('Mit Handys');

function phonesGame(settings, names) {
  const kicked = [];
  const hooks = { random: Cards.seeded(3), oddsRuns: 40, onKick: (pid) => kicked.push(pid) };
  const state = Engine.create({ settings: Object.assign({ input: 'phones' }, settings), players: names || [] }, hooks);
  const e = new Engine(state, hooks);
  e.kicked = kicked;
  return e;
}

test('Handys treten bei, Name übernimmt eingetragene Person, Lobby → Wettbüro', () => {
  const e = phonesGame({}, ['Opa']);
  assert.strictEqual(e.s.phase, 'lobby');
  assert.ok(e.write);
  assert.ok(!act(e, 'open'), 'erst ab 2 Personen');
  e.connect('h1', 'Anna');
  e.connect('h2', 'opa');
  assert.deepStrictEqual(e.s.players.map((p) => [p.name, p.phone]), [['Opa', 'h2'], ['Anna', 'h1']]);
  assert.ok(act(e, 'open'));
  assert.strictEqual(e.s.phase, 'betting');
  e.connect('h3', 'Ben');
  assert.strictEqual(e.s.event.kind, 'joined', 'später dazu');
  assert.strictEqual(e.s.players.length, 3);
});

test('Handy setzt nur für sich, Laptop für alle', () => {
  const e = phonesGame({}, ['Opa']);
  e.connect('h1', 'Anna');
  e.connect('h2', 'Ben');
  act(e, 'open');
  const [opa, anna, ben] = e.s.players;
  assert.ok(e.apply({ type: 'bet', suit: 'S' }, 'h1'));
  assert.strictEqual(e.s.bets[anna.id].suit, 'S');
  assert.ok(!e.apply({ type: 'bet', player: ben.id, suit: 'H' }, 'h1'), 'nicht für andere');
  assert.ok(e.apply({ type: 'amount', delta: 1 }, 'h1'));
  assert.ok(!e.apply({ type: 'start' }, 'h1'), 'Start nur am Laptop');
  assert.ok(act(e, 'bet', { player: opa.id, suit: 'D' }));
  assert.ok(!e.apply({ type: 'bet', suit: 'S' }, 'fremd'), 'unbekanntes Handy');
  assert.ok(!act(e, 'start', { at: e.s.step }), 'Ben fehlt');
  assert.ok(act(e, 'start', { at: e.s.step, force: true }), 'trotzdem starten – Ben setzt aus');
});

test('Geheime Wetten: fremde Handy-Wetten erst beim Start sichtbar', () => {
  const e = phonesGame({ secretBets: true }, ['Opa']);
  e.connect('h1', 'Anna');
  e.connect('h2', 'Ben');
  act(e, 'open');
  const [opa, anna] = e.s.players;
  e.apply({ type: 'bet', suit: 'S' }, 'h1');
  act(e, 'bet', { player: opa.id, suit: 'C' });
  const stage = e.viewFor(STAGE);
  assert.deepStrictEqual(stage.bets[anna.id], { hidden: true });
  assert.strictEqual(stage.bets[opa.id].suit, 'C', 'ohne Handy offen');
  assert.ok(!JSON.stringify(e.viewFor('h2').bets).includes('"S"'));
  assert.strictEqual(e.viewFor('h1').bets[anna.id].suit, 'S', 'eigene Wette sichtbar');
  e.apply({ type: 'bet', suit: 'H' }, 'h2');
  act(e, 'start', { at: e.s.step });
  assert.strictEqual(e.viewFor('h2').bets[anna.id].suit, 'S', 'nach dem Start offen');
});

test('Verteilen per Handy: genau der Gewinn, nicht an sich selbst, Summe stimmt', () => {
  const e = phonesGame({ payout: 2 });
  for (const [pid, n] of [['h1', 'Anna'], ['h2', 'Ben'], ['h3', 'Cem'], ['h4', 'Dora']]) e.connect(pid, n);
  act(e, 'open');
  const people = e.s.players;
  // jedes Pferd hat eine Person → genau eine gewinnt
  people.forEach((p, i) => e.apply({ type: 'bet', suit: Cards.SUITS[i], amount: i + 1 }, p.phone));
  runRace(e);
  const r = e.s.result;
  const winLine = r.lines.find((l) => l.give);
  assert.strictEqual(r.lines.filter((l) => l.give).length, 1);
  assert.strictEqual(winLine.give, winLine.amount * 2);
  const giver = e.player(winLine.id);
  const pid = giver.phone;
  const other = people.find((p) => p !== giver);
  assert.ok(!e.apply({ type: 'give', target: giver.id }, pid), 'nicht an sich selbst');
  for (let i = 0; i < winLine.give; i++) assert.ok(e.apply({ type: 'give', target: other.id }, pid));
  assert.ok(!e.apply({ type: 'give', target: other.id }, pid), 'nicht mehr als gewonnen');
  assert.strictEqual(e.giveLeft(giver.id), 0);
  assert.ok(e.apply({ type: 'give', target: other.id, delta: -1 }, pid), 'zurücknehmen');
  assert.ok(e.apply({ type: 'give', target: other.id }, pid));
  const nonGiver = people.find((p) => !e.s.give[p.id]);
  assert.ok(!e.apply({ type: 'give', target: giver.id }, nonGiver.phone), 'wer nicht gewonnen hat, verteilt nicht');
  const v = e.viewFor(STAGE).give;
  assert.strictEqual(v.received[other.id][giver.id], winLine.give);
  const drankBefore = other.stats.drank;
  act(e, 'next', { at: e.s.step });
  assert.strictEqual(other.stats.drank, drankBefore + winLine.give, 'Verteiltes zählt als getrunken');
  assert.strictEqual(other.stats.received, winLine.give);
});

test('Laptop verteilt für Personen ohne Handy', () => {
  const e = phonesGame({}, ['Opa', 'Oma', 'Tante']);
  e.connect('h1', 'Anna');
  act(e, 'open');
  const people = e.s.players;
  people.forEach((p, i) => act(e, 'bet', { player: p.id, suit: Cards.SUITS[i], amount: 1 }));
  runRace(e);
  const giver = e.player(e.s.result.lines.find((l) => l.give).id);
  const target = people.find((p) => p !== giver);
  assert.ok(act(e, 'give', { giver: giver.id, target: target.id }));
  assert.strictEqual(e.giveLeft(giver.id), 1);
});

test('Wiederverbinden: gleiches Handy = gleiche Person, Host-Neustart setzt alle offline', () => {
  const e = phonesGame();
  e.connect('h1', 'Anna');
  e.connect('h2', 'Ben');
  act(e, 'open');
  e.apply({ type: 'bet', suit: 'C' }, 'h1');
  e.disconnect('h1');
  assert.strictEqual(e.viewFor(STAGE).players[0].online, false);
  e.connect('h1', 'Anna');
  assert.strictEqual(e.s.players.length, 2);
  assert.strictEqual(e.viewFor('h1').me.id, e.s.players[0].id);
  assert.strictEqual(e.viewFor('h1').bets[e.s.players[0].id].suit, 'C', 'Wette bleibt');
  const copy = new Engine(JSON.parse(JSON.stringify(e.s)), {});
  copy.setAllOffline();
  assert.ok(Object.values(copy.s.members).every((m) => !m.online));
});

test('Person entfernen wirft ihr Handy raus', () => {
  const e = phonesGame();
  e.connect('h1', 'Anna');
  e.connect('h2', 'Ben');
  e.connect('h3', 'Cem');
  act(e, 'removePlayer', { player: e.s.players[2].id });
  assert.deepStrictEqual(e.kicked, ['h3']);
  assert.ok(!e.s.members.h3);
});

test('Handy-Ansicht verrät keine verdeckten Streckenkarten', () => {
  const e = phonesGame();
  e.connect('h1', 'Anna');
  e.connect('h2', 'Ben');
  act(e, 'open');
  e.apply({ type: 'bet', suit: 'C' }, 'h1');
  e.apply({ type: 'bet', suit: 'S' }, 'h2');
  act(e, 'start', { at: e.s.step });
  for (let i = 0; i < 4; i++) act(e, 'draw', { at: e.s.step });
  const json = JSON.stringify(e.viewFor('h1'));
  e.s.race.track.forEach((c, i) => {
    if (!e.s.race.shown[i]) assert.ok(!json.includes(`"${c}"`), 'Streckenkarte ' + c + ' sichtbar');
  });
  assert.ok(!json.includes('"stack"'));
});

test('Spielstand aus Etappe 1 lässt sich weiterspielen', () => {
  const old = {
    v: 1, game: 'pferderennen', settings: { input: 'single', deck: 52, length: 6, maxBet: 5, payout: 2, lastDouble: false, secondFree: false, speed: 'normal', races: 0 },
    phase: 'betting', step: 3, players: [{ id: 'p1', name: 'Anna', phone: null, stats: { drank: 2, given: 0, wins: 0, races: 1, staked: 2 } }, { id: 'p2', name: 'Ben', phone: null, stats: { drank: 0, given: 4, wins: 1, races: 1, staked: 2 } }],
    members: {}, nextId: 3, raceNo: 2, bets: {}, lastBets: {}, race: null, paused: false, result: null, history: [{ no: 1, winner: 'S', ranking: ['S', 'H', 'D', 'C'], draws: 20 }], event: null, eventNo: 0,
  };
  const e = new Engine(old, { random: Cards.seeded(1), oddsRuns: 20 });
  assert.strictEqual(e.s.settings.currency, 'sips');
  betAll(e, ['S', 'H']);
  runRace(e);
  assert.strictEqual(e.s.history.length, 2);
  assert.ok(e.awards());
});

console.log(`\n${passed} Tests bestanden.`);
