'use strict';
/* Tests für „Imposter“ (ohne Browser): node tests/imposter.test.js */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
require(path.join(__dirname, '..', 'shared', 'match.js'));
for (const f of ['words/woerter', 'words/fragen', 'deck', 'engine']) {
  require(path.join(__dirname, '..', 'imposter', 'js', f + '.js'));
}
const Deck = globalThis.IMDeck;
const { Engine, STAGE, POINTS, DRINKS, sanitizeSettings, maxImposters } = globalThis.IMEngine;

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

const NAMES = ['Anna', 'Ben', 'Cem', 'Dora', 'Eli', 'Finn', 'Gil', 'Hana', 'Ida'];

/** Ein Gerät: startet sofort mit der ersten Runde */
function passGame(settings, opts) {
  const o = opts || {};
  const hooks = { timers: false, now: o.now || clock(), random: seeded(o.seed) };
  const state = Engine.create({ settings: Object.assign({ input: 'pass' }, settings), players: o.players || NAMES.slice(0, o.n || 5) }, hooks);
  return new Engine(state, hooks);
}

/** Jeder ein Handy: Host spielt mit (ID "stage"), weitere Handys verbinden sich, dann Start */
function phoneGame(settings, opts) {
  const o = opts || {};
  const hooks = { timers: false, now: o.now || clock(), random: seeded(o.seed) };
  const state = Engine.create({ settings: Object.assign({ input: 'phones' }, settings), hostName: 'Host' }, hooks);
  const e = new Engine(state, hooks);
  const ids = o.ids || ['a', 'b', 'c', 'd'];
  for (const id of ids) e.connect(id, id.toUpperCase());
  if (o.start !== false) assert.ok(e.apply({ type: 'start' }, STAGE), 'start');
  return e;
}

function imposters(e) {
  return e.s.order.filter((id) => e.s.roles[id] === 'imposter');
}

function crew(e) {
  return e.s.order.filter((id) => e.s.roles[id] === 'crew');
}

/** Ein Gerät: alle schauen ihr Wort an */
function passReveal(e) {
  while (e.s.phase === 'reveal') assert.ok(e.apply({ type: 'seen', player: e.holder() }, STAGE), 'seen');
}

/** Ein Gerät: Hinweise durchklicken bis zur Diskussion */
function passClues(e) {
  passReveal(e);
  while (e.s.phase === 'clues') assert.ok(e.apply({ type: 'nextClue' }, STAGE), 'nextClue');
  assert.strictEqual(e.s.phase, 'discuss');
}

function toVote(e) {
  passClues(e);
  assert.ok(e.apply({ type: 'startVote' }, STAGE));
  assert.strictEqual(e.s.phase, 'vote');
}

function scores(e) {
  return Object.fromEntries(e.s.players.map((p) => [p.id, p.score]));
}

/** Handys: alle verbundenen Spieler sehen ihr Wort */
function phoneReveal(e) {
  for (const id of e.s.order) if (e.s.phase === 'reveal') e.apply({ type: 'seen' }, id);
}

/** Handys: alle geben reihum ihren Hinweis */
function phoneClues(e, text) {
  phoneReveal(e);
  let guard = 0;
  while (e.s.phase === 'clues' && guard++ < 100) {
    const cur = e.currentClue();
    assert.ok(e.apply({ type: 'clue', text: text || 'Hinweis', at: e.s.step }, cur), 'clue von ' + cur);
  }
}

/* ---------- Wörter & Fragen ---------- */

console.log('Wörter & Fragen');

test('jede Zeile hat Kategorie + Wort + ähnliches Wort', () => {
  const W = globalThis.IM_WORDS;
  const ids = Deck.CATEGORIES.map((c) => c.id);
  for (const line of W.woerter.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))) {
    const parts = line.split('|');
    assert.strictEqual(parts.length, 3, 'Format: ' + line);
    assert.ok(ids.includes(parts[0]), 'Kategorie unbekannt: ' + line);
    assert.ok(parts[1].trim() && parts[2].trim(), 'leer: ' + line);
    assert.notStrictEqual(parts[1].trim().toLowerCase(), parts[2].trim().toLowerCase(), 'Wort = ähnliches Wort: ' + line);
  }
});

test('keine doppelten Wörter, ähnliches Wort zählt beim Raten nicht als richtig', () => {
  const seen = new Map();
  for (const w of Deck.all().words) {
    const k = globalThis.GameMatch.normalize(w.word);
    assert.ok(!seen.has(k), `doppelt: ${w.word} (${seen.get(k)})`);
    seen.set(k, w.word);
    assert.ok(!Deck.guessMatches(w.decoy, w.word), `ähnliches Wort wäre ein Treffer: ${w.word} / ${w.decoy}`);
  }
});

test('Mindestanzahl je Kategorie, insgesamt ca. 400 Wörter', () => {
  const c = Deck.counts();
  for (const cat of Deck.CATEGORIES) assert.ok(c[cat.id] >= (cat.adult ? 40 : 55), `${cat.label}: nur ${c[cat.id]}`);
  assert.ok(c.words - c.adult >= 400, 'normale Wörter: ' + (c.words - c.adult));
});

test('Fragen: zwei Fragen pro Zeile, keine Dopplungen, ca. 80 normale', () => {
  const W = globalThis.IM_WORDS;
  for (const text of [W.fragen, W.fragenAdult]) {
    for (const line of text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))) {
      const parts = line.split('|');
      assert.strictEqual(parts.length, 2, 'Format: ' + line);
      assert.ok(parts[0].trim().endsWith('?') && parts[1].trim().endsWith('?'), 'Fragezeichen: ' + line);
      assert.notStrictEqual(parts[0].trim(), parts[1].trim(), 'gleich: ' + line);
    }
  }
  const crewQs = Deck.all().questions.map((q) => q.crew.toLowerCase());
  assert.strictEqual(new Set(crewQs).size, crewQs.length, 'doppelte Fragen');
  const c = Deck.counts();
  assert.ok(c.questions - c.adultQuestions >= 80, 'normale Fragen: ' + (c.questions - c.adultQuestions));
  assert.ok(c.adultQuestions >= 10);
});

test('18+ nur, wenn ausgewählt', () => {
  const used = [];
  for (let i = 0; i < 200; i++) {
    assert.notStrictEqual(Deck.drawWord({ categories: Deck.defaultCategories(), used, random: seeded(i + 1) }).category, 'adult');
    assert.ok(!Deck.drawQuestion({ adult: false, used, random: seeded(i + 7) }).adult);
  }
  const w = Deck.drawWord({ categories: ['adult'], used: [], random: seeded(3) });
  assert.strictEqual(w.category, 'adult');
});

test('Ziehen ohne Wiederholung im Spiel', () => {
  const used = [];
  const keys = new Set();
  for (let i = 0; i < 50; i++) keys.add(Deck.drawWord({ categories: ['tiere'], used, random: seeded(i + 11) }).key);
  assert.strictEqual(keys.size, 50);
});

test('Wort raten: Plural, Tippfehler, Groß/klein, Berufe mit :in', () => {
  const ok = [
    ['pizzen', 'Pizza'],
    ['PIZZA', 'Pizza'],
    ['die Pizza', 'Pizza'],
    ['Schokolde', 'Schokolade'],
    ['Pilot', 'Pilot:in'],
    ['Pilotin', 'Pilot:in'],
    ['Arzt', 'Ärzt:in'],
    ['Köchin', 'Köch:in'],
    ['herr der ringe', 'Herr der Ringe'],
    ['Kase', 'Käse'],
  ];
  for (const [g, w] of ok) assert.ok(Deck.guessMatches(g, w), `${g} = ${w}`);
  for (const [g, w] of [
    ['Pasta', 'Pizza'],
    ['Tee', 'Kaffee'],
    ['', 'Pizza'],
    ['Lokführer', 'Pilot:in'],
  ])
    assert.ok(!Deck.guessMatches(g, w), `${g} ≠ ${w}`);
});

/* ---------- Einstellungen ---------- */

console.log('Einstellungen');

test('Standard-Einstellungen wie geplant', () => {
  const s = sanitizeSettings({});
  assert.strictEqual(s.mode, 'word');
  assert.strictEqual(s.input, 'pass');
  assert.strictEqual(s.variant, 'classic');
  assert.strictEqual(s.imposters, 1);
  assert.strictEqual(s.showCategory, true);
  assert.strictEqual(s.clueRounds, 2);
  assert.strictEqual(s.discussSec, 120);
  assert.strictEqual(s.rounds, 'players');
  assert.strictEqual(s.drinks, 'off');
  assert.ok(!s.categories.includes('adult'));
});

test('ungültige Werte werden ignoriert', () => {
  const s = sanitizeSettings({ mode: 'x', imposters: 9, discussSec: 7, rounds: 'viele', categories: ['quatsch'], hostPlays: 'ja' });
  assert.deepStrictEqual(s, sanitizeSettings({}));
  assert.strictEqual(sanitizeSettings({ rounds: '5' }).rounds, 5);
  assert.strictEqual(sanitizeSettings({ rounds: 0 }).rounds, 0);
  assert.strictEqual(sanitizeSettings({ discussSec: 0 }).discussSec, 0);
});

test('höchstens ein Drittel Imposter', () => {
  assert.strictEqual(maxImposters(3), 1);
  assert.strictEqual(maxImposters(5), 1);
  assert.strictEqual(maxImposters(6), 2);
  assert.strictEqual(maxImposters(9), 3);
  const e = passGame({ imposters: 3 }, { n: 5 });
  assert.strictEqual(imposters(e).length, 1);
  const f = passGame({ imposters: 3 }, { n: 9 });
  assert.strictEqual(imposters(f).length, 3);
});

/* ---------- Rollen ---------- */

console.log('Rollen');

test('richtige Anzahl Imposter, erste Person nie Imposter', () => {
  for (let seed = 1; seed < 60; seed++) {
    const e = passGame({ imposters: 2 }, { n: 7, seed });
    assert.strictEqual(imposters(e).length, 2);
    assert.strictEqual(e.s.roles[e.s.order[0]], 'crew', 'erste Person ist Crew');
  }
});

test('erste Person darf Imposter sein, wenn abgeschaltet', () => {
  let first = 0;
  for (let seed = 1; seed < 200; seed++) {
    const e = passGame({ firstSafe: false }, { n: 4, seed });
    if (e.s.roles[e.s.order[0]] === 'imposter') first++;
  }
  assert.ok(first > 10, 'kommt vor: ' + first);
});

function playRoundQuick(e) {
  toVote(e);
  e.apply({ type: 'accuse', targets: [crew(e)[0]] }, STAGE);
  assert.strictEqual(e.s.phase, 'result');
}

test('niemand zweimal hintereinander Imposter, über das Spiel fair verteilt', () => {
  const counts = {};
  for (let seed = 1; seed < 30; seed++) {
    const e = passGame({ rounds: 0 }, { n: 5, seed });
    let last = imposters(e);
    for (let r = 0; r < 10; r++) {
      for (const id of imposters(e)) counts[id] = (counts[id] || 0) + 1;
      playRoundQuick(e);
      assert.ok(e.apply({ type: 'nextRound', at: e.s.step }, STAGE));
      const now = imposters(e);
      assert.ok(!now.some((id) => last.includes(id)), 'zweimal hintereinander');
      last = now;
    }
  }
  const values = Object.values(counts);
  assert.ok(Math.max(...values) / Math.min(...values) < 1.6, 'ungleich verteilt: ' + JSON.stringify(counts));
});

test('bei 3 Personen bleibt der Imposter unberechenbar', () => {
  // Erste Person sicher + „nicht zweimal“ würde bei 3 Personen den Imposter verraten → dann gilt nur die Gewichtung
  const e = passGame({ rounds: 0 }, { n: 3, seed: 5 });
  const options = new Set();
  for (let r = 0; r < 30; r++) {
    playRoundQuick(e);
    e.apply({ type: 'nextRound', at: e.s.step }, STAGE);
    if (e.s.phase !== 'reveal') break;
    options.add(e.s.order.slice(1).sort().join() + '>' + imposters(e)[0]);
  }
  const byRest = {};
  for (const o of options) {
    const [rest, imp] = o.split('>');
    (byRest[rest] = byRest[rest] || new Set()).add(imp);
  }
  assert.ok(Object.values(byRest).some((set) => set.size > 1), 'Imposter immer vorhersehbar');
});

/* ---------- Karten & Ansichten ---------- */

console.log('Karten & Ansichten');

test('Klassisch: Crew sieht das Wort, Imposter nur die Kategorie', () => {
  const e = phoneGame({});
  const imp = imposters(e)[0];
  const mate = crew(e)[0];
  const vi = e.viewFor(imp);
  const vc = e.viewFor(mate);
  assert.strictEqual(vi.me.card.kind, 'imposter');
  assert.ok(vi.me.card.category);
  assert.strictEqual(vi.me.role, 'imposter');
  assert.strictEqual(vc.me.card.kind, 'word');
  assert.strictEqual(vc.me.card.word, e.s.secret.word);
  assert.strictEqual(vc.me.role, 'crew');
  assert.ok(!JSON.stringify(vi).includes(e.s.secret.word), 'Imposter sieht das Wort nirgends');
});

test('Kategorie für den Imposter abschaltbar', () => {
  const e = phoneGame({ showCategory: false });
  const v = e.viewFor(imposters(e)[0]);
  assert.strictEqual(v.me.card.category, null);
});

test('Undercover: Imposter bekommt das ähnliche Wort und die Ansicht sieht wie eine Crew-Ansicht aus', () => {
  const e = phoneGame({ variant: 'undercover' });
  const imp = imposters(e)[0];
  const vi = e.viewFor(imp);
  const vc = e.viewFor(crew(e)[0]);
  assert.strictEqual(vi.me.card.word, e.s.secret.decoy);
  assert.deepStrictEqual(Object.keys(vi.me.card).sort(), Object.keys(vc.me.card).sort());
  assert.strictEqual(vi.me.card.kind, 'word');
  assert.strictEqual(vi.me.card.category, vc.me.card.category);
  assert.strictEqual(vi.me.role, null);
  assert.strictEqual(vc.me.role, null);
  assert.ok(!/"(role|kind)":"imposter"/.test(JSON.stringify(vi)), 'kein Hinweis auf die Rolle');
  assert.ok(!JSON.stringify(vi).includes(e.s.secret.word));
});

test('gefilterte Ansicht: niemand sieht fremde Rollen oder Karten', () => {
  const e = phoneGame({ imposters: 2 }, { ids: ['a', 'b', 'c', 'd', 'e', 'f'] });
  for (const id of e.s.order) {
    const v = e.viewFor(id);
    for (const p of v.players) assert.strictEqual(p.role, null, 'Rolle von ' + p.id + ' sichtbar für ' + id);
    assert.ok(!v.pass, 'keine fremden Karten');
    if (e.s.roles[id] === 'imposter') assert.ok(!JSON.stringify(v).includes(e.s.secret.word));
  }
  // Bühne (Host spielt nicht mit) kennt das Wort nicht
  const hooks = { timers: false, random: seeded(3) };
  const st = Engine.create({ settings: { input: 'phones', hostPlays: false } }, hooks);
  const b = new Engine(st, hooks);
  for (const id of ['a', 'b', 'c']) b.connect(id, id);
  b.apply({ type: 'start' }, STAGE);
  const vs = b.viewFor(STAGE);
  assert.strictEqual(vs.me.card, null);
  assert.ok(!JSON.stringify(vs).includes(b.s.secret.word));
  assert.ok(!vs.order.includes(STAGE));
});

test('Host spielt mit: bekommt eigene Karte, aber keine fremden', () => {
  const e = phoneGame({}, { seed: 9 });
  const v = e.viewFor(STAGE);
  assert.ok(v.me.inRound);
  assert.ok(v.me.card);
  assert.ok(v.me.host);
  for (const p of v.players) assert.strictEqual(p.role, null);
});

test('nach Rauswahl ist die Rolle der Person sichtbar, am Ende alle', () => {
  const e = phoneGame({ voting: 'last', imposters: 1 }, { ids: ['a', 'b', 'c', 'd', 'e'] });
  phoneClues(e);
  e.apply({ type: 'startVote' }, STAGE);
  const innocent = crew(e)[0];
  for (const id of e.alive()) e.apply({ type: 'vote', target: id === innocent ? crew(e)[1] : innocent }, id);
  assert.strictEqual(e.s.phase, 'out');
  const v = e.viewFor(imposters(e)[0]);
  assert.strictEqual(v.players.find((p) => p.id === innocent).role, 'crew');
  assert.strictEqual(v.players.filter((p) => p.role).length, 1);
});

/* ---------- Ein Gerät: Ablauf ---------- */

console.log('Ein Gerät');

test('Gerät wird in Sitzreihenfolge weitergegeben, nur der Halter ist dran', () => {
  const e = passGame({}, { n: 4 });
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(e.holder(), 'p1');
  assert.ok(!e.apply({ type: 'seen', player: 'p3' }, STAGE), 'nicht dran');
  assert.ok(e.apply({ type: 'seen', player: 'p1' }, STAGE));
  assert.strictEqual(e.holder(), 'p2');
  assert.strictEqual(e.viewFor(STAGE).pass.holder, 'p2');
  passReveal(e);
  assert.strictEqual(e.s.phase, 'clues');
});

test('Hinweisrunden: jede Person pro Runde einmal, dann Diskussion mit Timer', () => {
  const now = clock();
  const e = passGame({ clueRounds: 3 }, { n: 4, now });
  passReveal(e);
  let n = 0;
  while (e.s.phase === 'clues') {
    assert.strictEqual(e.currentClue(), e.s.order[n % 4]);
    e.apply({ type: 'nextClue' }, STAGE);
    n++;
  }
  assert.strictEqual(n, 12);
  assert.strictEqual(e.s.phase, 'discuss');
  assert.strictEqual(e.viewFor(STAGE).timer.total, 120000);
  now.add(121000);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'vote');
});

test('unbegrenzte Diskussion hat keinen Timer', () => {
  const e = passGame({ discussSec: 0 });
  passClues(e);
  assert.strictEqual(e.viewFor(STAGE).timer, null);
  assert.ok(!e.tick());
});

test('noch eine Hinweisrunde aus der Diskussion', () => {
  const e = passGame({ clueRounds: 1 }, { n: 4 });
  passClues(e);
  assert.ok(e.apply({ type: 'moreClues', at: e.s.step }, STAGE));
  assert.strictEqual(e.s.phase, 'clues');
  assert.strictEqual(e.s.clue.round, 2);
  for (let i = 0; i < 4; i++) e.apply({ type: 'nextClue' }, STAGE);
  assert.strictEqual(e.s.phase, 'discuss');
});

test('doppelt getippt zählt nur einmal (at = Schritt)', () => {
  const e = passGame({});
  passClues(e);
  const at = e.s.step;
  assert.ok(e.apply({ type: 'startVote', at }, STAGE));
  assert.ok(!e.apply({ type: 'startVote', at }, STAGE));
});

test('Crew erwischt Imposter, der rät falsch → Crew +1, richtige Zeiger +1', () => {
  const e = passGame({}, { n: 5 });
  toVote(e);
  const imp = imposters(e)[0];
  const mates = crew(e);
  assert.ok(e.apply({ type: 'accuse', targets: [imp], voters: [mates[0], mates[1]] }, STAGE));
  assert.strictEqual(e.s.phase, 'guess');
  assert.ok(e.apply({ type: 'guess', text: 'Quatschwort' }, STAGE));
  assert.strictEqual(e.s.phase, 'result');
  assert.strictEqual(e.s.result.winner, 'crew');
  const sc = scores(e);
  assert.strictEqual(sc[imp], 0);
  assert.strictEqual(sc[mates[0]], POINTS.crew + POINTS.vote);
  assert.strictEqual(sc[mates[2]], POINTS.crew);
});

test('Imposter erwischt, errät aber das Wort → Imposter +2', () => {
  const e = passGame({}, { n: 5 });
  toVote(e);
  const imp = imposters(e)[0];
  e.apply({ type: 'accuse', targets: [imp] }, STAGE);
  assert.ok(e.apply({ type: 'guess', text: e.s.secret.word.toUpperCase() }, STAGE));
  assert.strictEqual(e.s.result.winner, 'imposter');
  assert.strictEqual(scores(e)[imp], POINTS.guessed);
  for (const id of crew(e)) assert.strictEqual(scores(e)[id], 0);
});

test('Falsche Person rausgewählt → Imposter +3', () => {
  const e = passGame({}, { n: 5 });
  toVote(e);
  const imp = imposters(e)[0];
  e.apply({ type: 'accuse', targets: [crew(e)[0]] }, STAGE);
  assert.strictEqual(e.s.phase, 'result');
  assert.strictEqual(e.s.result.winner, 'imposter');
  assert.strictEqual(scores(e)[imp], POINTS.hidden);
});

test('Gleichstand → Stichwahl, wieder Gleichstand → niemand fliegt, Imposter gewinnt', () => {
  const e = passGame({}, { n: 5 });
  toVote(e);
  const [a, b] = crew(e);
  assert.ok(e.apply({ type: 'accuse', targets: [a, b] }, STAGE));
  assert.strictEqual(e.s.phase, 'vote');
  assert.ok(e.s.vote.runoff);
  assert.deepStrictEqual(e.candidates().sort(), [a, b].sort());
  const imp = imposters(e)[0];
  assert.ok(!e.apply({ type: 'accuse', targets: [imp] }, STAGE), 'nur Kandidaten der Stichwahl');
  assert.ok(e.apply({ type: 'accuse', targets: [a, b] }, STAGE));
  assert.strictEqual(e.s.phase, 'result');
  assert.strictEqual(e.s.result.reason, 'deadlock');
  assert.strictEqual(e.s.outs.length, 0);
  assert.strictEqual(scores(e)[imp], POINTS.hidden);
});

test('Stichwahl entschieden → Person fliegt', () => {
  const e = passGame({}, { n: 5 });
  toVote(e);
  const imp = imposters(e)[0];
  e.apply({ type: 'accuse', targets: [imp, crew(e)[0]] }, STAGE);
  e.apply({ type: 'accuse', targets: [imp] }, STAGE);
  assert.strictEqual(e.s.phase, 'guess');
});

test('Host kann das Raten anders werten', () => {
  const e = passGame({}, { n: 5 });
  toVote(e);
  const imp = imposters(e)[0];
  e.apply({ type: 'accuse', targets: [imp] }, STAGE);
  e.apply({ type: 'guess', text: 'Irgendwas' }, STAGE);
  assert.strictEqual(e.s.result.winner, 'crew');
  assert.ok(e.apply({ type: 'judge', correct: true }, STAGE));
  assert.strictEqual(e.s.result.winner, 'imposter');
  assert.strictEqual(scores(e)[imp], POINTS.guessed);
  for (const id of crew(e)) assert.strictEqual(scores(e)[id], 0);
  assert.strictEqual(e.s.history.length, 1);
  assert.ok(e.apply({ type: 'judge', correct: false }, STAGE));
  assert.strictEqual(scores(e)[imp], 0);
  assert.strictEqual(e.s.history.length, 1);
});

test('Raten überspringen zählt als falsch', () => {
  const e = passGame({}, { n: 4 });
  toVote(e);
  e.apply({ type: 'accuse', targets: [imposters(e)[0]] }, STAGE);
  assert.ok(e.apply({ type: 'skipGuess' }, STAGE));
  assert.strictEqual(e.s.result.winner, 'crew');
});

test('Rundenzahl „so viele wie Personen“, danach Siegerehrung', () => {
  const e = passGame({}, { n: 4 });
  assert.strictEqual(e.s.totalRounds, 4);
  for (let r = 1; r <= 4; r++) {
    assert.strictEqual(e.s.round, r);
    playRoundQuick(e);
    e.apply({ type: 'nextRound', at: e.s.step }, STAGE);
  }
  assert.strictEqual(e.s.phase, 'end');
  assert.ok(Array.isArray(e.s.awards));
});

test('Neues Spiel setzt Punkte zurück', () => {
  const e = passGame({ rounds: 3 }, { n: 4 });
  for (let r = 0; r < 3; r++) {
    playRoundQuick(e);
    e.apply({ type: 'nextRound', at: e.s.step }, STAGE);
  }
  assert.strictEqual(e.s.phase, 'end');
  assert.ok(e.apply({ type: 'again' }, STAGE));
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(e.s.round, 1);
  assert.ok(e.s.players.every((p) => p.score === 0));
});

test('doppelte Namen werden unterscheidbar', () => {
  const e = passGame({}, { players: ['Anna', 'anna', 'Ben'] });
  assert.deepStrictEqual(e.s.players.map((p) => p.name), ['Anna', 'anna 2', 'Ben']);
});

/* ---------- Mehrere Imposter ---------- */

console.log('Mehrere Imposter');

test('eine Abstimmung: jeder Imposter einzeln gewertet', () => {
  const e = passGame({ imposters: 2 }, { n: 7, seed: 4 });
  toVote(e);
  const [i1, i2] = imposters(e);
  e.apply({ type: 'accuse', targets: [i1] }, STAGE);
  e.apply({ type: 'guess', text: 'falsch' }, STAGE);
  assert.strictEqual(e.s.phase, 'result');
  assert.strictEqual(e.s.result.winner, 'split');
  const sc = scores(e);
  assert.strictEqual(sc[i1], 0);
  assert.strictEqual(sc[i2], POINTS.hidden);
  for (const id of crew(e)) assert.strictEqual(sc[id], POINTS.crew);
});

test('bis zum Ende: weiter abstimmen, bis alle Imposter raus sind', () => {
  const e = passGame({ imposters: 2, voting: 'last' }, { n: 7, seed: 4 });
  toVote(e);
  const [i1, i2] = imposters(e);
  e.apply({ type: 'accuse', targets: [i1] }, STAGE);
  e.apply({ type: 'guess', text: 'falsch' }, STAGE);
  assert.strictEqual(e.s.phase, 'out');
  assert.strictEqual(e.viewFor(STAGE).impostersLeft, 1);
  assert.ok(e.apply({ type: 'continue', at: e.s.step }, STAGE));
  assert.strictEqual(e.s.phase, 'discuss');
  e.apply({ type: 'startVote' }, STAGE);
  assert.ok(!e.candidates().includes(i1), 'Rausgewählte stehen nicht mehr zur Wahl');
  e.apply({ type: 'accuse', targets: [i2] }, STAGE);
  e.apply({ type: 'guess', text: 'auch falsch' }, STAGE);
  assert.strictEqual(e.s.phase, 'result');
  assert.strictEqual(e.s.result.winner, 'crew');
  for (const id of crew(e)) assert.strictEqual(scores(e)[id], 2 * POINTS.crew);
});

test('bis zum Ende: Crew nicht mehr in der Überzahl → Imposter gewinnen', () => {
  const e = passGame({ imposters: 1, voting: 'last' }, { n: 4, seed: 2 });
  toVote(e);
  const imp = imposters(e)[0];
  e.apply({ type: 'accuse', targets: [crew(e)[0]] }, STAGE);
  assert.strictEqual(e.s.phase, 'out'); // 2 Crew gegen 1 Imposter
  e.apply({ type: 'continue' }, STAGE);
  e.apply({ type: 'startVote' }, STAGE);
  e.apply({ type: 'accuse', targets: [e.alive().find((id) => id !== imp)] }, STAGE);
  assert.strictEqual(e.s.phase, 'result'); // 1 gegen 1
  assert.strictEqual(scores(e)[imp], POINTS.hidden);
});

/* ---------- Jeder ein Handy ---------- */

console.log('Jeder ein Handy');

test('Lobby: mindestens 3 Personen, Host zählt mit', () => {
  const e = phoneGame({}, { ids: ['a'], start: false });
  assert.ok(e.viewFor(STAGE).lobbyProblem);
  assert.ok(!e.apply({ type: 'start' }, STAGE));
  e.connect('b', 'Bea');
  assert.strictEqual(e.viewFor(STAGE).lobbyProblem, null);
  assert.ok(!e.apply({ type: 'start' }, 'a'), 'nur der Host startet');
  assert.ok(e.apply({ type: 'start' }, STAGE));
  assert.strictEqual(e.s.order.length, 3);
});

test('alle haben ihr Wort gesehen → Hinweise; Offline-Handys bremsen nicht', () => {
  const e = phoneGame({});
  e.disconnect('d');
  for (const id of e.s.order.filter((x) => x !== 'd')) e.apply({ type: 'seen' }, id);
  assert.strictEqual(e.s.phase, 'clues');
  assert.notStrictEqual(e.currentClue(), 'd', 'Offline wird übersprungen');
});

test('Hinweise: nur wer dran ist; mit „Hinweise tippen“ ist Text Pflicht', () => {
  const e = phoneGame({ typeClues: true });
  phoneReveal(e);
  const cur = e.currentClue();
  const other = e.s.order.find((id) => id !== cur);
  assert.ok(!e.apply({ type: 'clue', text: 'rund' }, other));
  assert.ok(!e.apply({ type: 'clue', text: '' }, cur));
  assert.ok(e.apply({ type: 'clue', text: 'rund', at: e.s.step }, cur));
  assert.strictEqual(e.s.clues[0].text, 'rund');
  assert.ok(e.apply({ type: 'nextClue' }, STAGE), 'Host kann überspringen');
});

test('geheime Abstimmung: Ergebnis erst, wenn alle abgestimmt haben', () => {
  const e = phoneGame({}, { ids: ['a', 'b', 'c', 'd'] });
  phoneClues(e);
  e.apply({ type: 'startVote' }, STAGE);
  const imp = imposters(e)[0];
  const voters = e.alive();
  assert.ok(!e.apply({ type: 'vote', target: voters[0] }, voters[0]), 'nicht für sich selbst');
  for (const id of voters.slice(0, -1)) {
    assert.ok(e.apply({ type: 'vote', target: id === imp ? crew(e)[0] : imp }, id));
    const v = e.viewFor(crew(e)[0]);
    assert.strictEqual(v.phase, 'vote');
    assert.ok(v.votes.length === 0, 'noch kein Zwischenstand');
  }
  const last = voters[voters.length - 1];
  e.apply({ type: 'vote', target: last === imp ? crew(e)[0] : imp }, last);
  assert.strictEqual(e.s.phase, 'guess');
  assert.strictEqual(e.s.guess.pid, imp);
  assert.ok(!e.apply({ type: 'guess', text: 'x' }, crew(e)[0]), 'nur der Imposter rät');
  assert.ok(e.apply({ type: 'guess', text: e.s.secret.word }, imp));
  assert.strictEqual(e.s.result.winner, 'imposter');
});

test('Host kann die Abstimmung vorzeitig beenden', () => {
  const e = phoneGame({});
  phoneClues(e);
  e.apply({ type: 'startVote' }, STAGE);
  assert.ok(!e.apply({ type: 'endVote' }, STAGE), 'ohne Stimme geht es nicht');
  const [a, b] = crew(e);
  e.apply({ type: 'vote', target: b }, a);
  assert.ok(e.apply({ type: 'endVote' }, STAGE));
  assert.ok(['result', 'out'].includes(e.s.phase));
  assert.strictEqual(e.s.outs[0].pid, b);
});

test('Frage-Modus: Antworten tippen, dann Crew-Frage + alle Antworten', () => {
  const e = phoneGame({ mode: 'question' });
  const imp = imposters(e)[0];
  const vi = e.viewFor(imp);
  const vc = e.viewFor(crew(e)[0]);
  assert.strictEqual(vi.me.card.kind, 'question');
  assert.strictEqual(vi.me.card.question, e.s.secret.imposter);
  assert.strictEqual(vc.me.card.question, e.s.secret.crew);
  assert.strictEqual(vi.me.role, null, 'Imposter weiß es nicht');
  phoneReveal(e);
  assert.strictEqual(e.s.phase, 'answer');
  assert.strictEqual(e.viewFor(imp).crewQuestion, null);
  for (const id of e.s.order) e.apply({ type: 'answer', text: 'Antwort ' + id }, id);
  assert.strictEqual(e.s.phase, 'discuss');
  const v = e.viewFor(crew(e)[1]);
  assert.strictEqual(v.crewQuestion, e.s.secret.crew);
  assert.strictEqual(Object.keys(v.answers).length, e.s.order.length);
  e.apply({ type: 'startVote' }, STAGE);
  for (const id of e.alive()) e.apply({ type: 'vote', target: id === imp ? crew(e)[0] : imp }, id);
  assert.strictEqual(e.s.phase, 'result', 'kein Wort-Raten im Frage-Modus');
  assert.strictEqual(e.s.result.winner, 'crew');
});

test('Frage-Modus auf einem Gerät: Antworten reihum laut', () => {
  const e = passGame({ mode: 'question' }, { n: 4 });
  passReveal(e);
  assert.strictEqual(e.s.phase, 'clues');
  assert.strictEqual(e.s.clue.rounds, 1);
  passClues(e);
  assert.strictEqual(e.viewFor(STAGE).crewQuestion, e.s.secret.crew);
});

test('wer später dazukommt, spielt ab der nächsten Runde mit', () => {
  const e = phoneGame({});
  e.connect('z', 'Zoe');
  assert.ok(!e.s.order.includes('z'));
  assert.strictEqual(e.viewFor('z').me.inRound, false);
  assert.strictEqual(e.viewFor('z').me.card, null);
  phoneClues(e);
  e.apply({ type: 'startVote' }, STAGE);
  for (const id of e.alive()) e.apply({ type: 'vote', target: id === crew(e)[0] ? crew(e)[1] : crew(e)[0] }, id);
  e.apply({ type: 'nextRound', at: e.s.step }, STAGE);
  assert.ok(e.s.order.includes('z'));
});

test('Imposter verlässt das Spiel → Runde abgebrochen, keine Punkte', () => {
  let e = null;
  for (let seed = 1; !e; seed++) {
    const g = phoneGame({}, { ids: ['a', 'b', 'c', 'd'], seed });
    if (!imposters(g).includes(STAGE)) e = g;
  }
  const imp = imposters(e)[0];
  assert.ok(e.apply({ type: 'kick', player: imp }, STAGE));
  assert.strictEqual(e.s.phase, 'result');
  assert.ok(e.s.result.aborted);
  assert.ok(e.s.players.every((p) => p.score === 0));
  assert.ok(!e.s.players.some((p) => p.id === imp));
});

test('Crew-Person verlässt das Spiel → Runde läuft weiter', () => {
  const e = phoneGame({}, { ids: ['a', 'b', 'c', 'd', 'e'], seed: 3 });
  phoneReveal(e);
  const leaver = crew(e).find((id) => id !== STAGE && id !== e.currentClue());
  e.apply({ type: 'kick', player: leaver }, STAGE);
  assert.strictEqual(e.s.phase, 'clues');
  assert.ok(!e.s.order.includes(leaver));
  phoneClues(e);
  assert.strictEqual(e.s.phase, 'discuss');
});

test('Neuladen des Hosts: abgelaufene Diskussion geht zur Abstimmung', () => {
  const now = clock();
  const e = phoneGame({}, { now });
  phoneClues(e);
  const saved = JSON.parse(JSON.stringify(e.s));
  now.add(200000);
  const e2 = new Engine(saved, { timers: false, now });
  assert.strictEqual(e2.s.phase, 'vote');
});

/* ---------- Trinkregeln & Auszeichnungen ---------- */

console.log('Trinkregeln & Auszeichnungen');

test('Trinkregeln: erwischt trinkt 2, unentdeckt verteilt 3', () => {
  const e = passGame({ drinks: 'on' }, { n: 5 });
  toVote(e);
  const imp = imposters(e)[0];
  e.apply({ type: 'accuse', targets: [imp] }, STAGE);
  e.apply({ type: 'guess', text: 'nö' }, STAGE);
  assert.deepStrictEqual(
    e.s.drinks.map((d) => [d.pid, d.amount, d.reason]),
    [[imp, DRINKS.caught, 'caught']]
  );
  e.apply({ type: 'nextRound', at: e.s.step }, STAGE);
  toVote(e);
  const imp2 = imposters(e)[0];
  e.apply({ type: 'accuse', targets: [crew(e)[0]] }, STAGE);
  assert.deepStrictEqual(e.s.drinks.slice(-1).map((d) => [d.pid, d.amount, d.reason]), [[imp2, DRINKS.give, 'give']]);
  const off = passGame({}, { n: 4 });
  toVote(off);
  off.apply({ type: 'accuse', targets: [crew(off)[0]] }, STAGE);
  assert.strictEqual(off.s.drinks.length, 0);
});

test('Auszeichnungen am Ende', () => {
  const e = passGame({ rounds: 0 }, { n: 4, seed: 8 });
  // Runde 1: Imposter unentdeckt, Runde 2: Imposter errät das Wort
  toVote(e);
  const imp1 = imposters(e)[0];
  const sus = crew(e)[0];
  e.apply({ type: 'accuse', targets: [sus], voters: e.alive().filter((id) => id !== sus) }, STAGE);
  e.apply({ type: 'nextRound', at: e.s.step }, STAGE);
  toVote(e);
  const imp2 = imposters(e)[0];
  const det = crew(e)[0];
  e.apply({ type: 'accuse', targets: [imp2], voters: [det] }, STAGE);
  e.apply({ type: 'guess', text: e.s.secret.word }, STAGE);
  assert.ok(e.apply({ type: 'finish' }, STAGE));
  assert.strictEqual(e.s.phase, 'end');
  const titles = Object.fromEntries(e.s.awards.map((a) => [a.title, a.text]));
  assert.ok(titles['Meisterlügner:in'].startsWith(e.playerName(imp1)));
  assert.ok(titles['Detektiv:in'].startsWith(e.playerName(det)));
  assert.ok(titles['Verdächtig'].startsWith(e.playerName(sus)));
  assert.ok(titles['Gedankenleser:in'].startsWith(e.playerName(imp2)));
});

console.log(`\n${passed} Tests bestanden.`);
