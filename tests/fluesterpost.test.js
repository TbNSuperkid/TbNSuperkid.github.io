'use strict';
/* Tests für „Flüsterpost“ (ohne Browser): node tests/fluesterpost.test.js */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'shared', 'match.js'));
require(path.join(ROOT, 'guess-the-word', 'js', 'words', 'zeichnen.js'));
for (const f of ['saetze', 'chain', 'replay', 'engine']) require(path.join(ROOT, 'fluesterpost', 'js', f + '.js'));
const Chain = globalThis.FpChain;
const Replay = globalThis.FpReplay;
const Content = globalThis.FpContent;
const { Engine, STAGE, GRACE_MS, SUBMIT_GRACE_MS, HURRY_MS, MAX_TEXT, sanitizeSettings, arrived } = globalThis.FpEngine;

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

const first = () => 0;

/** Spiel mit n Personen (p0, p1, …), gestartet */
function game(n, settings, now) {
  const state = Engine.create({ settings: Object.assign({}, settings) });
  const e = new Engine(state, { timers: false, now: now || clock(), random: first });
  const pids = [];
  for (let i = 0; i < n; i++) {
    pids.push('p' + i);
    e.connect('p' + i, 'P' + i);
  }
  assert.ok(e.apply({ type: 'start' }, STAGE), 'start');
  return { e, pids };
}

/** Eine kleine Zeichnung (ein Strich) mit Zeitstempeln */
function drawing(id, x) {
  return [
    { k: 'b', id, c: '#1f2937', w: 0.01, x: x || 0.1, y: 0.1, t: 0 },
    { k: 'p', id, pts: [0.2, 0.2, 0.3, 0.3], t: 50 },
  ];
}

/** Alle geben im laufenden Schritt etwas ab */
function submitAll(e, pids, label) {
  const k = e.s.step;
  for (const pid of pids) {
    const t = e.task(pid);
    if (Chain.isDrawing(t.type)) assert.ok(e.apply({ type: 'submit', step: k, ops: drawing(pid + k) }, pid), 'submit draw');
    else assert.ok(e.apply({ type: 'submit', step: k, text: `${label || 'Satz'} ${pid} ${k}` }, pid), 'submit text');
  }
}

/* ---------- Weitergabe ---------- */

console.log('Weitergabe');

test('jede Kette kommt bei allen genau einmal vorbei, niemand sieht die eigene wieder (3–12 Personen)', () => {
  for (let n = 3; n <= 12; n++) {
    const plan = Chain.plan(n, n);
    for (let k = 0; k < n; k++) {
      // in jedem Schritt bearbeitet jede Kette genau eine Person
      assert.strictEqual(new Set(plan[k]).size, n, `n=${n} k=${k}`);
    }
    for (let c = 0; c < n; c++) {
      const holders = plan.map((row) => row.indexOf(c));
      assert.strictEqual(new Set(holders).size, n, `Kette ${c} bei allen (n=${n})`);
      assert.strictEqual(holders[0], c, 'Schritt 0 = eigene Kette');
      assert.ok(holders.slice(1).every((h) => h !== c), 'danach nie mehr die eigene');
      for (let k = 0; k < n; k++) assert.strictEqual(Chain.holderOf(n, k, c), holders[k]);
    }
  }
});

test('Schrittzahl: alle = Personen, sonst höchstens so viele wie Personen', () => {
  assert.strictEqual(Chain.stepCount(5, 0), 5);
  assert.strictEqual(Chain.stepCount(5, 4), 4);
  assert.strictEqual(Chain.stepCount(5, 8), 5);
  assert.strictEqual(Chain.stepCount(10, 6), 6);
});

test('Schrittarten wechseln je Modus', () => {
  const types = (mode, steps) => Array.from({ length: steps }, (_, k) => Chain.stepType(mode, k, steps));
  assert.deepStrictEqual(types('normal', 5), ['write', 'draw', 'describe', 'draw', 'describe']);
  assert.deepStrictEqual(types('words', 4), ['draw', 'describe', 'draw', 'describe']);
  assert.deepStrictEqual(types('copy', 5), ['write', 'draw', 'copy', 'copy', 'describe']);
  assert.deepStrictEqual(types('copy', 3), ['write', 'draw', 'describe']);
  for (let k = 1; k < 8; k++) assert.notStrictEqual(Chain.isDrawing(Chain.stepType('normal', k, 8)), Chain.isDrawing(Chain.stepType('normal', k - 1, 8)));
});

/* ---------- Ablauf ---------- */

console.log('Ablauf');

test('Lobby: mindestens 3 Personen, Spätere schauen mitten im Spiel nur zu', () => {
  const state = Engine.create({});
  const e = new Engine(state, { timers: false, now: clock() });
  e.connect('a', 'A');
  e.connect('b', 'B');
  assert.ok(e.lobbyProblem());
  assert.strictEqual(e.apply({ type: 'start' }, STAGE), false);
  e.connect('c', 'C');
  assert.strictEqual(e.lobbyProblem(), null);
  assert.ok(e.apply({ type: 'start' }, STAGE));
  e.connect('d', 'D');
  assert.deepStrictEqual(e.s.order, ['a', 'b', 'c']);
  assert.strictEqual(e.viewFor('d').task, null);
  assert.strictEqual(e.viewFor('d').me.playing, false);
});

test('ganzes Spiel: alle Ketten vollständig, jede/r bearbeitet in jedem Schritt eine andere Kette', () => {
  const { e, pids } = game(4);
  assert.strictEqual(e.s.steps, 4);
  for (let k = 0; k < 4; k++) {
    assert.strictEqual(e.s.phase, 'play');
    assert.strictEqual(e.s.step, k);
    submitAll(e, pids);
  }
  assert.strictEqual(e.s.phase, 'show');
  for (const owner of pids) {
    const chain = e.s.chains[owner];
    assert.strictEqual(chain.length, 4);
    assert.strictEqual(chain[0].by, owner, 'Startsatz von der Besitzerin');
    assert.deepStrictEqual(chain.map((x) => x.kind), ['write', 'draw', 'describe', 'draw']);
    assert.strictEqual(new Set(chain.map((x) => x.by)).size, 4, 'jede/r einmal');
    assert.ok(e.s.images[chain[1].ref].length, 'Zeichnung gespeichert');
  }
});

test('sind alle fertig, geht es sofort weiter; wer abgegeben hat, kann es noch ändern', () => {
  const { e, pids } = game(3);
  assert.ok(e.apply({ type: 'submit', step: 0, text: 'Ein Hund' }, 'p0'));
  assert.ok(e.apply({ type: 'edit', step: 0 }, 'p0'));
  assert.ok(!e.s.done.includes('p0'));
  assert.ok(e.apply({ type: 'submit', step: 0, text: 'Ein Hund liest Zeitung' }, 'p0'));
  assert.ok(e.apply({ type: 'submit', step: 0, text: 'B' }, 'p1'));
  assert.strictEqual(e.s.step, 0);
  assert.ok(e.apply({ type: 'submit', step: 0, text: 'C' }, 'p2'));
  assert.strictEqual(e.s.step, 1);
  assert.strictEqual(e.s.chains.p0[0].text, 'Ein Hund liest Zeitung');
  // veraltete Abgabe für Schritt 0 zählt nicht mehr
  assert.strictEqual(e.apply({ type: 'submit', step: 0, text: 'zu spät' }, 'p0'), false);
  void pids;
});

test('Zeit um: Handys geben noch ab, danach Zwischenstand oder leer', () => {
  const now = clock();
  const { e } = game(3, { writeTime: 30 }, now);
  e.apply({ type: 'submit', step: 0, text: 'Ein Pinguin fährt Ski' }, 'p0');
  e.apply({ type: 'draft', step: 0, text: 'Halber Sat' }, 'p1');
  now.add(30000);
  assert.strictEqual(e.tick(), false, 'kurze Nachfrist für späte Abgaben');
  now.add(SUBMIT_GRACE_MS);
  assert.ok(e.tick());
  assert.strictEqual(e.s.step, 1);
  assert.strictEqual(e.s.chains.p1[0].text, 'Halber Sat');
  assert.ok(e.s.chains.p1[0].late);
  assert.strictEqual(e.s.chains.p2[0].text, '');
  assert.ok(e.s.chains.p2[0].empty);
  assert.ok(!e.s.chains.p2[0].missing, 'war da, hat nur nichts geschrieben');
  // Wer den leeren Satz bekommt, sieht „(nichts)“
  const holder = e.s.order[Chain.holderOf(3, 1, 2)];
  assert.ok(e.viewFor(holder).task.prev.empty);
});

test('Zeichnung als Zwischenstand wird bei Zeitablauf übernommen', () => {
  const now = clock();
  const { e, pids } = game(3, { drawTime: 60 }, now);
  submitAll(e, pids);
  assert.strictEqual(e.typeOf(e.s.step), 'draw');
  assert.ok(e.apply({ type: 'draft', step: 1, ops: drawing('x') }, 'p0'));
  assert.ok(e.s.images['d:p0']);
  now.add(60000 + SUBMIT_GRACE_MS);
  e.tick();
  const t = { owner: e.s.order[Chain.chainOf(3, 1, 0)], pos: 1 };
  const entry = e.s.chains[t.owner][t.pos];
  assert.ok(entry.ref && e.s.images[entry.ref].length, 'Zwischenstand ist jetzt die Zeichnung');
  assert.ok(!Object.keys(e.s.images).some((r) => r.startsWith('d:')), 'Zwischenstände aufgeräumt');
});

test('ausgefallene Person: nach der Schonfrist „verschollen“, die anderen warten nicht ewig', () => {
  const now = clock();
  const { e } = game(3, { drawTime: 0 }, now);
  e.disconnect('p2');
  e.apply({ type: 'submit', step: 0, text: 'A' }, 'p0');
  e.apply({ type: 'submit', step: 0, text: 'B' }, 'p1');
  assert.strictEqual(e.s.step, 0, 'Schonfrist läuft noch');
  now.add(GRACE_MS + 1);
  assert.ok(e.tick());
  assert.strictEqual(e.s.step, 1);
  assert.ok(e.s.chains.p2[0].missing);
  // Sie kann wieder einsteigen
  e.connect('p2', 'P2');
  assert.ok(e.viewFor('p2').task);
});

test('ohne Zeitlimit beim Zeichnen; „Beeilung!“ gibt 10 s, nochmal sofort', () => {
  const now = clock();
  const { e, pids } = game(3, { drawTime: 0 }, now);
  submitAll(e, pids);
  assert.strictEqual(e.s.endsAt, null);
  assert.strictEqual(e.viewFor(STAGE).timer, null);
  assert.ok(e.apply({ type: 'hurry' }, STAGE));
  assert.strictEqual(e.s.endsAt, now() + HURRY_MS);
  assert.ok(e.apply({ type: 'hurry' }, STAGE));
  assert.strictEqual(e.s.endsAt, now());
  now.add(SUBMIT_GRACE_MS);
  assert.ok(e.tick());
  assert.strictEqual(e.s.step, 2);
  assert.strictEqual(e.apply({ type: 'hurry' }, 'p0'), false, 'nur der Laptop');
});

test('kürzere Schrittzahl', () => {
  const { e, pids } = game(6, { steps: 4 });
  assert.strictEqual(e.s.steps, 4);
  for (let k = 0; k < 4; k++) submitAll(e, pids);
  assert.strictEqual(e.s.phase, 'show');
  assert.strictEqual(e.s.chains.p0.length, 4);
});

test('Spiel vorzeitig beenden: laufender Schritt zählt, dann Vorführung', () => {
  const { e, pids } = game(4);
  submitAll(e, pids);
  e.apply({ type: 'submit', step: 1, ops: drawing('a') }, 'p0');
  assert.ok(e.apply({ type: 'end' }, STAGE));
  assert.strictEqual(e.s.phase, 'show');
  assert.strictEqual(e.chainLength, 2);
  assert.ok(e.s.chains.p3[1], 'Kette von p3 hat einen (leeren) zweiten Schritt');
});

test('Texte werden gesäubert und gekürzt', () => {
  const { e } = game(3);
  e.apply({ type: 'submit', step: 0, text: '  <b>Hallo</b>\n  Welt ' + 'x'.repeat(200) }, 'p0');
  const t = e.s.chains.p0[0].text;
  assert.ok(!/[<>]/.test(t));
  assert.ok(t.startsWith('bHallo/b Welt'));
  assert.strictEqual(t.length, MAX_TEXT);
});

/* ---------- Gefilterte Ansicht ---------- */

console.log('Gefilterte Ansicht');

test('jede Person sieht nur den direkten Vorgänger-Schritt, nie Bilder in der Ansicht', () => {
  const { e, pids } = game(4);
  submitAll(e, pids, 'Start');
  submitAll(e, pids);
  // Schritt 2: beschreiben
  for (const pid of pids) {
    const v = e.viewFor(pid);
    const t = e.task(pid);
    assert.strictEqual(v.task.type, 'describe');
    assert.ok(v.task.prev.drawing);
    assert.strictEqual(v.task.prev.ref, t.prev.ref);
    assert.strictEqual(e.imageNeed(pid), t.prev.ref);
    const json = JSON.stringify(v);
    assert.ok(!json.includes('Start '), 'Startsätze bleiben geheim');
    assert.ok(!json.includes('"pts"'), 'keine Striche in der Ansicht');
    assert.strictEqual(v.show, null);
    assert.strictEqual(v.chains, null);
  }
  const stage = JSON.stringify(e.viewFor(STAGE));
  assert.ok(!stage.includes('Start '), 'auch die Bühne verrät nichts');
  assert.ok(!stage.includes('"pts"'));
});

test('Zeichnen: man sieht den Satz davor (Text), nicht den Satz zwei Schritte davor', () => {
  const { e, pids } = game(4);
  submitAll(e, pids, 'Start');
  submitAll(e, pids);
  submitAll(e, pids, 'Beschreibung');
  const v = e.viewFor('p0');
  assert.strictEqual(v.task.type, 'draw');
  assert.ok(v.task.prev.text.startsWith('Beschreibung'));
  assert.ok(!JSON.stringify(v).includes('Start '));
});

/* ---------- Modi ---------- */

console.log('Modi');

test('Wort-Start: Kette beginnt mit einem Startwort, erster Schritt ist Zeichnen, neu würfeln geht', () => {
  const { e, pids } = game(3, { mode: 'words' });
  const words = Content.words();
  assert.ok(words.length > 150);
  assert.ok(words.every((w) => w.split(/\s+/).length <= 3));
  for (const pid of pids) {
    assert.strictEqual(e.s.chains[pid][0].kind, 'word');
    assert.ok(words.includes(e.s.chains[pid][0].text));
  }
  const v = e.viewFor('p0');
  assert.strictEqual(v.task.type, 'draw');
  assert.strictEqual(v.task.prev.text, e.s.chains.p0[0].text, 'eigene Kette, eigenes Startwort');
  const before = e.s.chains.p0[0].text;
  e.random = () => 0.5;
  assert.ok(e.apply({ type: 'reroll', step: 0 }, 'p0'));
  assert.notStrictEqual(e.s.chains.p0[0].text, before);
  for (let k = 0; k < 3; k++) submitAll(e, pids);
  assert.strictEqual(e.s.phase, 'show');
  assert.strictEqual(e.s.chains.p0.length, 4);
  assert.strictEqual(e.apply({ type: 'heart', owner: 'p0', idx: 0 }, 'p1'), false, 'Startwort bekommt kein Herz');
});

test('Nur Zeichnen: nachzeichnen mit kurzem Blick, Ende ist eine Beschreibung', () => {
  const { e, pids } = game(5, { mode: 'copy', drawTime: 60 });
  const types = [];
  for (let k = 0; k < 5; k++) {
    types.push(e.viewFor('p0').task.type);
    if (e.typeOf(k) === 'copy') {
      assert.strictEqual(e.viewFor('p0').task.peek, 3000);
      assert.strictEqual(e.s.total, 63000, 'Blickzeit kommt zur Zeichenzeit dazu');
      assert.ok(e.imageNeed('p0'));
    }
    submitAll(e, pids);
  }
  assert.deepStrictEqual(types, ['write', 'draw', 'copy', 'copy', 'describe']);
});

test('🎲 Vorschlag: nur beim Schreiben, ohne Wiederholung, auch eigene Sätze', () => {
  const { e } = game(3, { deck: 'custom', custom: 'Eins\nZwei\nDrei' });
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    assert.ok(e.apply({ type: 'suggest', step: 0 }, 'p0'));
    seen.add(e.viewFor('p0').task.suggestion.text);
  }
  assert.deepStrictEqual([...seen].sort(), ['Drei', 'Eins', 'Zwei']);
  assert.strictEqual(e.viewFor('p0').task.suggestion.n, 3);
  assert.ok(!JSON.stringify(e.viewFor('p1')).includes('Eins'), 'eigene Sätze gehen nicht an alle Handys');
  const { e: e2 } = game(3);
  assert.ok(Content.DECKS.family.list.length >= 100);
  assert.ok(Content.DECKS.adult.list.length >= 60);
  assert.ok(e2.apply({ type: 'suggest', step: 0 }, 'p1'));
  assert.ok(Content.DECKS.family.list.includes(e2.viewFor('p1').task.suggestion.text));
});

test('Einstellungen werden geprüft; eigene Sätze brauchen mindestens 3', () => {
  const s = sanitizeSettings({ mode: 'quatsch', steps: '6', drawTime: '0', writeTime: 99, hearts: false, deck: 'adult', drinks: 'free' });
  assert.strictEqual(s.mode, 'normal');
  assert.strictEqual(s.steps, 6);
  assert.strictEqual(s.drawTime, 0);
  assert.strictEqual(s.writeTime, 45);
  assert.strictEqual(s.hearts, false);
  assert.strictEqual(s.deck, 'adult');
  assert.strictEqual(s.drinks, 'free');
  const e = new Engine(Engine.create({ settings: { deck: 'custom', custom: ['a', 'b'] } }), { timers: false });
  for (const p of ['a', 'b', 'c']) e.connect(p, p);
  assert.ok(e.lobbyProblem().includes('3 Sätze'));
  e.apply({ type: 'settings', settings: { mode: 'words' } }, STAGE);
  assert.strictEqual(e.lobbyProblem(), null, 'bei Wort-Start egal');
});

/* ---------- Vorführung ---------- */

console.log('Vorführung');

function toShow(n, settings) {
  const r = game(n, settings);
  for (let k = 0; k < r.e.s.steps; k++) submitAll(r.e, r.pids);
  return r;
}

test('Vorführung: Schritt für Schritt, Kette für Kette; weiter darf Laptop und Besitzer/in', () => {
  const { e } = toShow(3);
  let v = e.viewFor(STAGE);
  assert.strictEqual(v.show.owner, 'p0');
  assert.strictEqual(v.show.entries.length, 1);
  assert.strictEqual(e.apply({ type: 'next' }, 'p1'), false, 'nicht die eigene Kette');
  assert.ok(e.apply({ type: 'next', i: 0, n: 1 }, 'p0'));
  assert.strictEqual(e.apply({ type: 'next', i: 0, n: 1 }, 'p0'), false, 'doppelter Klick');
  v = e.viewFor(STAGE);
  assert.strictEqual(v.show.entries.length, 2);
  assert.ok(v.show.entries[1].ref, 'Bühne bekommt das Bild');
  assert.strictEqual(e.viewFor('p1').show.entries[1].ref, null, 'Handys nicht');
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.ok(e.viewFor(STAGE).show.complete);
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.strictEqual(e.viewFor(STAGE).show.owner, 'p1');
  assert.ok(e.apply({ type: 'back' }, STAGE));
  assert.strictEqual(e.viewFor(STAGE).show.owner, 'p0');
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.ok(e.apply({ type: 'reveal_all' }, STAGE));
  assert.strictEqual(e.viewFor(STAGE).show.entries.length, 3);
  e.apply({ type: 'next' }, STAGE);
  e.apply({ type: 'reveal_all' }, STAGE);
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.phase, 'over');
  assert.strictEqual(e.viewFor(STAGE).chains.length, 3);
  assert.strictEqual(e.viewFor('p1').chains.length, 1, 'Handy: nur die eigene Kette');
  assert.ok(e.apply({ type: 'rewatch' }, STAGE));
  assert.strictEqual(e.s.phase, 'show');
});

test('Herzen: eins pro Kette und Person, nicht für Eigenes, nur Aufgedecktes', () => {
  const { e } = toShow(3);
  const own = e.s.chains.p0.findIndex((x) => x.by === 'p1');
  assert.strictEqual(e.apply({ type: 'heart', owner: 'p0', idx: own }, 'p1'), false, 'eigener Eintrag');
  assert.strictEqual(e.apply({ type: 'heart', owner: 'p0', idx: 2 }, 'p0'), false, 'noch nicht aufgedeckt');
  e.apply({ type: 'reveal_all' }, STAGE);
  const other = e.s.chains.p0.findIndex((x) => x.by !== 'p1');
  assert.ok(e.apply({ type: 'heart', owner: 'p0', idx: other }, 'p1'));
  const third = e.s.chains.p0.findIndex((x, i) => x.by !== 'p1' && i !== other);
  assert.ok(e.apply({ type: 'heart', owner: 'p0', idx: third }, 'p1'));
  assert.strictEqual(e.heartCount('p0', other), 0, 'Herz umgesetzt');
  assert.strictEqual(e.heartCount('p0', third), 1);
  assert.ok(e.viewFor('p1').show.entries[third].hearted);
  assert.ok(e.apply({ type: 'heart', owner: 'p0', idx: third }, 'p1'));
  assert.strictEqual(e.heartCount('p0', third), 0, 'nochmal = zurücknehmen');
  e.apply({ type: 'heart', owner: 'p0', idx: third }, 'p1');
  e.apply({ type: 'heart', owner: 'p0', idx: third }, e.s.chains.p0[third].by === 'p2' ? 'p0' : 'p2');
  e.apply({ type: 'end' }, STAGE);
  const fav = e.s.awards.find((a) => a.icon === '❤️');
  assert.ok(fav);
  assert.strictEqual(fav.owner, 'p0');
  assert.strictEqual(fav.idx, third);
  const off = toShow(3, { hearts: false }).e;
  off.apply({ type: 'reveal_all' }, STAGE);
  assert.strictEqual(off.apply({ type: 'heart', owner: 'p0', idx: 1 }, 'p2'), false);
});

test('Angekommen? Inhaltswörter vergleichen (Plural, Artikel egal); Laptop kann korrigieren; Trinkregel', () => {
  assert.strictEqual(arrived('Ein Pinguin fährt Ski', 'Pinguine auf Skiern'), true);
  assert.strictEqual(arrived('Ein Pinguin fährt Ski', 'Oma bügelt einen Fisch'), false);
  assert.strictEqual(arrived('', 'Oma'), null);
  assert.strictEqual(arrived('Ein Hund mit einer Katze', 'Eine Kuh mit einem Pferd'), false, 'Füllwörter zählen nicht');
  const { e, pids } = game(3, { drinks: 'on' });
  e.apply({ type: 'submit', step: 0, text: 'Ein Pinguin fährt Ski' }, 'p0');
  e.apply({ type: 'submit', step: 0, text: 'Ein Hund liest Zeitung' }, 'p1');
  e.apply({ type: 'submit', step: 0, text: 'Oma bügelt' }, 'p2');
  submitAll(e, pids);
  for (const pid of pids) {
    const t = e.task(pid);
    e.apply({ type: 'submit', step: 2, text: t.owner === 'p0' ? 'Pinguin auf Ski' : 'Ein Vulkan' }, pid);
  }
  assert.strictEqual(e.s.phase, 'show');
  assert.strictEqual(e.drinksFor('p1'), 0, 'noch nicht gezeigt');
  e.apply({ type: 'reveal_all' }, STAGE);
  assert.strictEqual(e.viewFor(STAGE).show.verdict.value, true);
  assert.strictEqual(e.drinksFor('p0'), 0);
  e.apply({ type: 'next' }, STAGE);
  e.apply({ type: 'reveal_all' }, STAGE);
  assert.strictEqual(e.viewFor(STAGE).show.verdict.value, false);
  assert.strictEqual(e.drinksFor('p1'), 1);
  assert.strictEqual(e.viewFor(STAGE).players.find((p) => p.id === 'p1').drinks, 1);
  assert.ok(e.apply({ type: 'verdict', owner: 'p1', value: true }, STAGE));
  assert.strictEqual(e.drinksFor('p1'), 0, 'Korrektur am Laptop');
  assert.strictEqual(e.apply({ type: 'verdict', owner: 'p2', value: true }, STAGE), false, 'noch nicht gezeigt');
});

test('Nochmal: zurück in die Lobby mit denselben Leuten', () => {
  const { e } = toShow(3);
  e.apply({ type: 'end' }, STAGE);
  assert.ok(e.apply({ type: 'again' }, STAGE));
  assert.strictEqual(e.s.phase, 'lobby');
  assert.deepStrictEqual(Object.keys(e.s.images), []);
  assert.strictEqual(e.s.players.length, 3);
  assert.ok(e.apply({ type: 'start' }, STAGE));
});

/* ---------- Zeichnungen ---------- */

console.log('Zeichnungen');

test('cleanOp: ungültige Nachrichten fallen weg, Werte werden begrenzt', () => {
  assert.strictEqual(Replay.cleanOp({ k: 'b', id: 'a', c: 'red', w: 0.01, x: 0, y: 0 }), null);
  assert.strictEqual(Replay.cleanOp({ k: 'p', id: 'a', pts: [0.1] }), null);
  assert.strictEqual(Replay.cleanOp({ k: 'x' }), null);
  assert.deepStrictEqual(Replay.cleanOp({ k: 'b', id: 'a', c: '#ffffff', w: 5, x: 2, y: -1, t: -5 }), { k: 'b', id: 'a', c: '#ffffff', w: 0.1, x: 1, y: 0, t: 0 });
});

test('compact: Rückgängig und Löschen wirken, Reihenfolge und Zeiten bleiben', () => {
  const ops = [
    { k: 'b', id: 'a', c: '#000000', w: 0.01, x: 0.1, y: 0.1, t: 0 },
    { k: 'p', id: 'a', pts: [0.2, 0.2], t: 40 },
    { k: 'clear', t: 100 },
    { k: 'b', id: 'b', c: '#000000', w: 0.01, x: 0.5, y: 0.5, t: 200 },
    { k: 'p', id: 'b', pts: [0.6, 0.6], t: 240 },
    { k: 'b', id: 'c', c: '#ff0000', w: 0.01, x: 0.1, y: 0.9, t: 300 },
    { k: 'u', id: 'c', t: 350 },
    { k: 'f', id: 'd', c: '#00ff00', x: 0.9, y: 0.1, t: 400 },
  ];
  const out = Replay.compact(ops);
  assert.deepStrictEqual(out.map((o) => o.k + (o.id || '')), ['bb', 'pb', 'fd']);
  assert.deepStrictEqual(out.map((o) => o.t), [200, 240, 400]);
});

test('compact: Punkte werden ausgedünnt (~2 px), Größe ist begrenzt', () => {
  const pts = [];
  for (let i = 1; i <= 400; i++) pts.push(0.1 + i * 0.001, 0.1);
  const out = Replay.compact([{ k: 'b', id: 'a', c: '#000000', w: 0.01, x: 0.1, y: 0.1, t: 0 }, { k: 'p', id: 'a', pts, t: 10 }]);
  const n = Replay.points(out);
  assert.ok(n < 120 && n > 80, `ausgedünnt auf ${n} Punkte`);
  // Riesige Zeichnung: wird abgeschnitten
  const big = [];
  for (let s = 0; s < 400; s++) {
    big.push({ k: 'b', id: 's' + s, c: '#000000', w: 0.01, x: 0, y: 0, t: s });
    const p = [];
    for (let i = 1; i <= 100; i++) p.push((i * 0.01) % 1, ((s * 0.0025) + (i % 2) * 0.01) % 1);
    big.push({ k: 'p', id: 's' + s, pts: p, t: s });
  }
  const small = Replay.compact(Replay.cleanOps(big));
  assert.ok(Replay.points(small) * 2 <= Replay.MAX_NUMS + 2);
  assert.ok(JSON.stringify(small).length < 80000, 'unter ~80 KB');
});

test('timeline: Reihenfolge bleibt, Pausen gekürzt, doppelt so schnell, 1,5 bis 9 s', () => {
  const ops = [
    { k: 'b', id: 'a', t: 0 },
    { k: 'p', id: 'a', t: 100 },
    { k: 'b', id: 'b', t: 10000 },
    { k: 'p', id: 'b', t: 10200 },
  ];
  const { events, duration } = Replay.timeline(ops, { minDuration: 0 });
  assert.deepStrictEqual(events.map((e) => e.op.id + e.op.k), ['ab', 'ap', 'bb', 'bp']);
  assert.deepStrictEqual(events.map((e) => e.at), [0, 50, 50 + Replay.MAX_GAP / 2, 50 + Replay.MAX_GAP / 2 + 100]);
  assert.strictEqual(duration, events[3].at);
  assert.strictEqual(Replay.timeline(ops).duration, Replay.MIN_DURATION, 'schnelle Kritzelei wird gestreckt');
  assert.strictEqual(Replay.timeline([ops[0]]).duration, 0, 'ein einzelner Punkt steht sofort da');
  const long = Array.from({ length: 200 }, (_, i) => ({ k: 'p', id: 'a', t: i * 500 }));
  const tl = Replay.timeline(long);
  assert.strictEqual(tl.duration, Replay.MAX_DURATION);
  for (let i = 1; i < tl.events.length; i++) assert.ok(tl.events[i].at >= tl.events[i - 1].at);
});

test('Abgabe einer Zeichnung wird geprüft und verdichtet gespeichert', () => {
  const { e, pids } = game(3);
  submitAll(e, pids);
  const bad = [{ k: 'b', id: 'a', c: 'javascript:', w: 0.01, x: 0, y: 0 }, { k: 'evil' }, ...drawing('ok')];
  assert.ok(e.apply({ type: 'submit', step: 1, ops: bad }, 'p0'));
  const t = e.task('p0');
  const ops = e.s.images[e.s.chains[t.owner][t.pos].ref];
  assert.deepStrictEqual(ops.map((o) => o.id), ['ok', 'ok']);
  assert.ok(e.apply({ type: 'submit', step: 1, ops: [] }, 'p1'));
  const t1 = e.task('p1');
  assert.ok(e.s.chains[t1.owner][t1.pos].empty, 'leeres Blatt');
});

console.log(`\n${passed} Tests bestanden.`);
