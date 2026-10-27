'use strict';
/* Tests für „Echt jetzt?“ (ohne Browser): node tests/echt-jetzt.test.js */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'shared', 'match.js'));
const FILES = ['gesetze', 'tiere', 'erfindungen', 'menschen', 'deutschland', 'essen', 'orte', 'woerterbuch'];
for (const f of FILES) require(path.join(ROOT, 'echt-jetzt', 'js', 'fragen', f + '.js'));
for (const f of ['questions', 'engine']) require(path.join(ROOT, 'echt-jetzt', 'js', f + '.js'));
const Q = globalThis.EchtJetztQuestions;
const { Engine, STAGE, GRACE_MS, POINTS, CATEGORY_S, CHECK_S, MIN_LIES, sanitizeSettings, roundPlan } = globalThis.EchtJetztEngine;

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

function seeded(seed) {
  let x = seed || 42;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

/** Spiel mit Handys: Lobby, Leute verbinden, starten. Standard: ohne Vorlesen und ohne Kategorie-Wahl. */
function game(pids, settings, opts) {
  const o = opts || {};
  const now = o.now || clock();
  const state = Engine.create({ settings: Object.assign({ speech: false, chooseCategory: false }, settings) });
  const e = new Engine(state, { timers: false, now, random: o.random || seeded(7) });
  for (const pid of pids) e.connect(pid, pid.toUpperCase());
  assert.ok(e.apply({ type: 'start' }, STAGE), 'start');
  e.clock = now;
  return e;
}

/** Diese Frage statt der gezogenen verwenden (feste Wahrheit für die Tests) */
function useQuestion(e, q) {
  const c = e.cur();
  c.q = Object.assign({ id: 'test:' + q.truth, cat: 'gesetze', kind: 'fact', forms: [], decoys: ['Feuerwerk', 'Comics', 'Blumenerde', 'Socken'], source: 'https://example.org' }, q);
  return c;
}

const SINGAPUR = { text: 'In Singapur ist der Verkauf von ___ verboten.', truth: 'Kaugummi', forms: ['Kaugummis'] };

function lieAll(e, lies) {
  const c = e.cur();
  for (const pid of c.pids) {
    const t = lies && pid in lies ? lies[pid] : `Lüge von ${pid}`;
    if (t === null) continue;
    e.apply({ type: 'lie', target: c.id, text: t }, pid);
  }
}

function timeUp(e, sec) {
  e.clock.add((sec || 600) * 1000 + GRACE_MS + 1);
  e.tick();
}

function optionOf(c, pred) {
  return c.options.find(pred);
}

function truthKey(c) {
  return optionOf(c, (o) => o.truth).key;
}

function keyOfLie(c, pid) {
  return optionOf(c, (o) => o.authors.includes(pid)).key;
}

/** Alle tippen: picks = pid -> key (oder Funktion) */
function pickAll(e, picks) {
  const c = e.cur();
  for (const p of e.s.players) {
    const k = typeof picks === 'function' ? picks(p.id, c) : picks[p.id];
    if (k == null) continue;
    for (const [slot, key] of (Array.isArray(k) ? k : [k]).entries()) e.apply({ type: 'pick', target: c.id, key, slot }, p.id);
  }
}

/** Auflösung komplett ablaufen lassen */
function revealAll(e) {
  assert.strictEqual(e.s.phase, 'reveal');
  for (let i = 0; i < 30 && !e.cur().done; i++) {
    e.clock.add(20000);
    e.tick();
  }
  assert.ok(e.cur().done);
}

/** Eine Frage komplett: alle lügen, alle tippen die Wahrheit (oder picks), Auflösung, weiter */
function playQuestion(e, picks) {
  if (e.s.phase === 'category') e.apply({ type: 'next', force: true }, STAGE);
  lieAll(e);
  if (e.s.phase === 'check') e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.phase, 'pick');
  // Standard: Wahrheit (im Finale als zweiten Tipp irgendeine fremde Lüge)
  pickAll(e, picks || ((pid, c) => [truthKey(c), c.options.find((o) => !o.truth && !o.authors.includes(pid)).key].slice(0, e.slotsFor(c, pid))));
  revealAll(e);
  assert.ok(e.apply({ type: 'next' }, STAGE));
}

/** Prüft rekursiv, dass ein Objekt einen Schlüssel nicht enthält */
function hasKey(o, key) {
  if (!o || typeof o !== 'object') return false;
  if (Array.isArray(o)) return o.some((x) => hasKey(x, key));
  return Object.keys(o).some((k) => k === key || hasKey(o[k], key));
}

/* ---------- Inhalt ---------- */

console.log('Fragen');

test('mindestens 400 Fragen und 200 Wörter, alle Zeilen gültig, keine doppelten', () => {
  const st = Q.stats();
  assert.ok(st.facts >= 400, 'nur ' + st.facts + ' Fakten');
  assert.ok(st.woerterbuch >= 200, 'nur ' + st.woerterbuch + ' Wörter');
  for (const [cat, text] of Object.entries(globalThis.EJ_FRAGEN)) {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const parsed = Q.parseList(text, cat);
    parsed.forEach((q, i) => assert.ok(q, `${cat}: ungültige Zeile „${lines[i]}“`));
  }
  const ids = Q.list().map((q) => q.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'doppelte Fragen');
});

test('Kategorien haben ihre Zielgröße erreicht', () => {
  const st = Q.stats();
  const goal = { gesetze: 60, tiere: 70, erfindungen: 50, menschen: 60, deutschland: 60, essen: 50, orte: 50, woerterbuch: 200 };
  for (const [cat, n] of Object.entries(goal)) assert.ok(st[cat] >= n, `${cat}: ${st[cat]} < ${n}`);
});

test('Lücke genau einmal, Wahrheit kurz, mind. 3 Köder, Quelle vorhanden', () => {
  for (const q of Q.list()) {
    if (q.kind === 'fact') {
      assert.strictEqual(Q.countBlanks(q.text), 1, q.text);
      assert.ok(q.truth.length <= Q.MAX_TRUTH, q.truth);
    } else {
      assert.strictEqual(Q.countBlanks(q.text), 0, q.text);
      assert.ok(q.truth.length <= Q.MAX_TRUTH_DICT, q.truth);
    }
    assert.ok(q.decoys.length >= 3, q.text);
    assert.ok(/^https?:\/\/\S+$/.test(q.source), q.source);
  }
});

test('kein Köder ist (fast) die Wahrheit, Köder untereinander verschieden', () => {
  for (const q of Q.list()) {
    for (const d of q.decoys) assert.ok(!Q.tooClose(d, q), `${q.text}: Köder „${d}“ ist die Wahrheit`);
    for (let i = 0; i < q.decoys.length; i++) for (let j = i + 1; j < q.decoys.length; j++) assert.ok(!Q.same(q.decoys[i], q.decoys[j]), `${q.text}: doppelter Köder`);
  }
});

test('ungültige Zeilen werden abgelehnt', () => {
  assert.strictEqual(Q.parseLine('Ohne Lücke | A | | x; y; z | https://a.b', 'gesetze'), null);
  assert.strictEqual(Q.parseLine('Zwei ___ und ___ | A | | x; y; z | https://a.b', 'gesetze'), null);
  assert.strictEqual(Q.parseLine('Lücke ___ | A | | x; y | https://a.b', 'gesetze'), null, 'zu wenige Köder');
  assert.strictEqual(Q.parseLine('Lücke ___ | A | | x; y; z | keine Quelle', 'gesetze'), null);
  assert.strictEqual(Q.parseLine('Lücke ___ | ' + 'x'.repeat(31) + ' | | x; y; z | https://a.b', 'gesetze'), null, 'Wahrheit zu lang');
  assert.ok(Q.parseLine('Hagestolz | Älterer Junggeselle | | a; b; c | https://www.dwds.de/wb/Hagestolz', 'woerterbuch'));
});

/* ---------- Nähe zur Wahrheit ---------- */

console.log('Nähe zur Wahrheit');

test('Lüge = Wahrheit (Plural, Tippfehler, Artikel, „ein“, ganzes Wort darin) → zu nah', () => {
  const q = Object.assign({ kind: 'fact' }, SINGAPUR);
  for (const t of ['Kaugummi', 'kaugummi', 'Kaugummis', 'ein Kaugummi', 'Kaugumi', 'KAUGUMMI!', 'Kaugummi mit Minze']) assert.ok(Q.tooClose(t, q), t);
  for (const t of ['Kaugummiautomaten', 'Gummibärchen', 'Feuerwerk', 'Gummi']) assert.ok(!Q.tooClose(t, q), t);
});

test('Zahlen müssen genau passen, Präpositionen am Anfang sind egal', () => {
  const q = { kind: 'fact', truth: '14 Zentimeter', forms: ['14 cm'] };
  assert.ok(Q.tooClose('14 Zentimeter', q));
  assert.ok(Q.tooClose('14 cm', q));
  assert.ok(!Q.tooClose('12 Zentimeter', q));
  assert.ok(!Q.tooClose('140 Zentimeter', q));
  assert.ok(Q.tooClose('für die Geburtshilfe', { kind: 'fact', truth: 'Geburtshilfe', forms: [] }));
});

/* ---------- Ablauf ---------- */

console.log('Ablauf');

test('Einstellungen werden geprüft, Rundenplan je Länge', () => {
  const s = sanitizeSettings({ mode: 'quatsch', length: 'long', lieTime: 7, pickTime: 45, maxShown: 6, likes: 'ja', categories: ['tiere', 'gibtsnicht'] });
  assert.strictEqual(s.mode, 'facts');
  assert.strictEqual(s.length, 'long');
  assert.strictEqual(s.lieTime, 60);
  assert.strictEqual(s.pickTime, 45);
  assert.strictEqual(s.maxShown, 6);
  assert.strictEqual(s.likes, true);
  assert.deepStrictEqual(s.categories, ['tiere']);
  assert.deepStrictEqual(sanitizeSettings({ categories: [] }).categories, Q.CATEGORY_IDS);
  assert.deepStrictEqual(roundPlan({ length: 'short' }), [2, 2, 1]);
  assert.deepStrictEqual(roundPlan({ length: 'normal' }), [3, 3, 1]);
  assert.deepStrictEqual(roundPlan({ length: 'long' }), [4, 4, 1]);
});

test('Start erst ab 3 Personen', () => {
  const e = new Engine(Engine.create({}), { timers: false });
  e.connect('p1', 'A');
  e.connect('p2', 'B');
  assert.ok(e.lobbyProblem());
  assert.ok(!e.apply({ type: 'start' }, STAGE));
  e.connect('p3', 'C');
  assert.ok(!e.apply({ type: 'start' }, 'p1'), 'nur der Laptop startet');
  assert.ok(e.apply({ type: 'start' }, STAGE));
  assert.strictEqual(e.s.phase, 'category', 'Standard: Kategorie wählen');
});

test('zu nahe Lüge wird abgelehnt und muss neu geschrieben werden', () => {
  const e = game(['p1', 'p2', 'p3']);
  const c = useQuestion(e, SINGAPUR);
  assert.ok(e.apply({ type: 'lie', target: c.id, text: 'ein Kaugummi' }, 'p1'));
  assert.strictEqual(c.lies.p1, undefined);
  assert.strictEqual(c.rejected.p1, 'ein Kaugummi');
  assert.strictEqual(e.viewFor('p1').cur.lie.rejected, 'ein Kaugummi');
  assert.strictEqual(e.viewFor('p2').cur.lie.rejected, null, 'andere sehen die Ablehnung nicht');
  assert.ok(e.apply({ type: 'lie', target: c.id, text: 'Feuerwerk' }, 'p1'));
  assert.strictEqual(c.lies.p1, 'Feuerwerk');
  assert.strictEqual(c.rejected.p1, undefined);
});

test('alle haben gelogen → sofort tippen; Zeit um → Lüge vom Haus füllt auf', () => {
  const e = game(['p1', 'p2', 'p3', 'p4']);
  useQuestion(e, SINGAPUR);
  lieAll(e, { p1: 'Socken', p2: 'Comics', p3: null, p4: null });
  assert.strictEqual(e.s.phase, 'lie');
  timeUp(e);
  assert.strictEqual(e.s.phase, 'pick');
  const c = e.cur();
  // 2 Lügen + 2 vom Haus (für p3, p4) + Wahrheit; Köder, die schon eine Lüge sind, kommen nicht doppelt
  assert.strictEqual(c.options.length, 5);
  assert.strictEqual(c.options.filter((o) => o.house).length, 2);
  assert.strictEqual(c.options.filter((o) => o.truth).length, 1);
  const texts = c.options.map((o) => Q.norm(o.text));
  assert.strictEqual(new Set(texts).size, texts.length, 'keine doppelten Karten');
});

test('mindestens drei Lügen neben der Wahrheit, auch wenn alle dasselbe schreiben', () => {
  const e = game(['p1', 'p2', 'p3']);
  useQuestion(e, SINGAPUR);
  lieAll(e, { p1: 'Gartenzwerge', p2: 'gartenzwerg', p3: 'Gartenzwerge' });
  const c = e.cur();
  assert.strictEqual(e.s.phase, 'pick');
  const lies = c.options.filter((o) => !o.truth);
  assert.strictEqual(lies.length, MIN_LIES);
  const gz = lies.find((o) => o.authors.length);
  assert.deepStrictEqual(gz.authors.sort(), ['p1', 'p2', 'p3'], 'gleiche Lügen zusammengelegt');
});

test('zwei gleiche Lügen → eine Karte, beide bekommen die Punkte', () => {
  const e = game(['p1', 'p2', 'p3', 'p4']);
  useQuestion(e, SINGAPUR);
  lieAll(e, { p1: 'Gartenzwerge', p2: 'Gartenzwerg', p3: 'Socken', p4: 'Comics' });
  const c = e.cur();
  const gz = keyOfLie(c, 'p1');
  assert.strictEqual(gz, keyOfLie(c, 'p2'));
  pickAll(e, { p1: truthKey(c), p2: truthKey(c), p3: gz, p4: gz });
  revealAll(e);
  const g = e.questionResult(c).gains;
  assert.strictEqual(g.p1.fooled, 2 * POINTS.fooled[0]);
  assert.strictEqual(g.p2.fooled, 2 * POINTS.fooled[0]);
  assert.strictEqual(g.p1.truth, POINTS.truth[0]);
  assert.strictEqual(g.p3.total, 0);
});

test('eigene Lüge nicht wählbar, Lügen vom Haus geben keine Punkte', () => {
  const e = game(['p1', 'p2', 'p3']);
  useQuestion(e, SINGAPUR);
  lieAll(e, { p1: 'Socken', p2: 'Comics', p3: null });
  timeUp(e);
  const c = e.cur();
  assert.ok(!e.apply({ type: 'pick', target: c.id, key: keyOfLie(c, 'p1') }, 'p1'), 'eigene gesperrt');
  const v = e.viewFor('p1').cur.pick;
  assert.ok(v.options.find((o) => o.key === keyOfLie(c, 'p1')).mine);
  const house = optionOf(c, (o) => o.house).key;
  pickAll(e, { p1: house, p2: house, p3: truthKey(c) });
  revealAll(e);
  const t = e.totals();
  assert.strictEqual(t.p1, 0);
  assert.strictEqual(t.p2, 0);
  assert.strictEqual(t.p3, POINTS.truth[0]);
});

test('Punkte erst nach dem Aufdecken; Runde 2 mehr; Finale mit zwei Tipps (zweiter halb)', () => {
  const e = game(['p1', 'p2', 'p3'], { length: 'short' });
  assert.deepStrictEqual(e.plan(), [2, 2, 1]);
  useQuestion(e, SINGAPUR);
  lieAll(e);
  const c = e.cur();
  pickAll(e, { p1: truthKey(c), p2: keyOfLie(c, 'p1'), p3: keyOfLie(c, 'p1') });
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(e.totals().p1, 0, 'vor dem Aufdecken zählt nichts');
  revealAll(e);
  assert.strictEqual(e.totals().p1, POINTS.truth[0] + 2 * POINTS.fooled[0]);
  e.apply({ type: 'next' }, STAGE);
  playQuestion(e);
  assert.strictEqual(e.s.phase, 'scores');
  const before = e.totals().p2;
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.round, 2);
  playQuestion(e);
  assert.strictEqual(e.totals().p2 - before, POINTS.truth[1]);
  playQuestion(e);
  assert.strictEqual(e.s.phase, 'scores');
  e.apply({ type: 'next' }, STAGE);
  // Finale
  assert.strictEqual(e.s.round, 3);
  const f = useQuestion(e, SINGAPUR);
  assert.ok(f.final);
  lieAll(e);
  const t = truthKey(f);
  const sec = keyOfLie(f, 'p3');
  assert.strictEqual(e.viewFor('p1').cur.pick.slots, 2);
  const start = e.totals();
  pickAll(e, { p1: [t, sec], p2: [sec, t], p3: [t] });
  assert.strictEqual(e.s.phase, 'pick', 'im Finale braucht es beide Tipps');
  e.apply({ type: 'pick', target: f.id, key: keyOfLie(f, 'p1'), slot: 1 }, 'p3');
  revealAll(e);
  const g = e.questionResult(f).gains;
  assert.strictEqual(g.p1.truth, POINTS.truth[2]);
  assert.strictEqual(g.p2.truth, POINTS.truth[2] / 2, 'zweiter Tipp halb');
  assert.strictEqual(g.p3.fooled, POINTS.fooled[2] + POINTS.fooled[2] / 2, 'p2 erster Tipp + p1 zweiter Tipp');
  assert.strictEqual(e.totals().p1 - start.p1, g.p1.total);
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.phase, 'end');
});

test('Tipp tauschen im Finale, Umentscheiden, nur in der Tipp-Phase', () => {
  const e = game(['p1', 'p2', 'p3'], { length: 'short' });
  for (let i = 0; i < 4; i++) playQuestion(e), e.s.phase === 'scores' && e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.round, 3);
  useQuestion(e, SINGAPUR);
  lieAll(e);
  const c = e.cur();
  const [x, y] = c.options.filter((o) => !o.authors.includes('p1')).map((o) => o.key);
  e.apply({ type: 'pick', target: c.id, key: x, slot: 0 }, 'p1');
  e.apply({ type: 'pick', target: c.id, key: y, slot: 1 }, 'p1');
  e.apply({ type: 'pick', target: c.id, key: y, slot: 0 }, 'p1');
  assert.deepStrictEqual(c.picks.p1, [y, x], 'getauscht');
  assert.ok(!e.apply({ type: 'pick', target: 'falsch', key: x }, 'p1'));
});

test('Auflösung: niemand reingefallen zuerst, dann wenige vor vielen, Wahrheit zuletzt', () => {
  const e = game(['p1', 'p2', 'p3', 'p4', 'p5']);
  useQuestion(e, SINGAPUR);
  lieAll(e);
  const c = e.cur();
  const L = (pid) => keyOfLie(c, pid);
  pickAll(e, { p1: L('p2'), p2: L('p3'), p3: L('p2'), p4: L('p2'), p5: truthKey(c) });
  const kinds = c.steps.map((s) => s.kind);
  assert.strictEqual(kinds[0], 'none');
  assert.deepStrictEqual(c.steps[0].keys.sort(), [L('p1'), L('p4'), L('p5')].sort());
  assert.deepStrictEqual(c.steps[1].keys, [L('p3')]);
  assert.deepStrictEqual(c.steps[2].keys, [L('p2')]);
  assert.strictEqual(kinds[kinds.length - 1], 'truth');
  // Schritt für Schritt (ohne Vorlesen per Zeit)
  assert.strictEqual(c.shown, 0);
  e.clock.add(1500);
  e.tick();
  assert.strictEqual(c.shown, 1);
  const v = e.viewFor('p1').cur.reveal;
  assert.ok(v.cards.find((x) => x.key === L('p1')).revealed);
  assert.ok(!v.cards.find((x) => x.key === L('p2')).revealed);
  assert.ok(!hasKey(v.cards.find((x) => x.key === truthKey(c)), 'truth'), 'Wahrheit noch verdeckt');
  assert.strictEqual(v.gains, null);
});

test('Vorlesen: Tipp-Zeit startet erst nach „read“, Auflösung wartet auf „shown“', () => {
  const e = game(['p1', 'p2', 'p3'], { speech: true });
  useQuestion(e, SINGAPUR);
  lieAll(e);
  const c = e.cur();
  assert.ok(e.s.readEnd);
  assert.strictEqual(e.viewFor(STAGE).timer, null);
  assert.ok(!e.apply({ type: 'read', target: c.id }, 'p1'), 'nur der Laptop');
  pickAll(e, () => truthKey(c));
  assert.strictEqual(e.s.phase, 'pick', 'beim Vorlesen wird noch gewartet');
  assert.ok(e.apply({ type: 'read', target: c.id }, STAGE));
  assert.strictEqual(e.s.phase, 'reveal', 'alle hatten schon getippt');
  e.clock.add(1500);
  e.tick();
  assert.strictEqual(c.shown, 1);
  assert.ok(!e.apply({ type: 'shown', target: c.id, shown: 0 }, STAGE), 'falscher Schritt');
  assert.ok(e.apply({ type: 'shown', target: c.id, shown: 1 }, STAGE));
  assert.strictEqual(c.shown, 2);
});

test('Kategorie wählen: reihum, nur Wählende/r oder Spielleitung, Zeit um → zufällig', () => {
  const e = game(['p1', 'p2', 'p3'], { chooseCategory: true });
  assert.strictEqual(e.s.phase, 'category');
  const c = e.cur();
  assert.strictEqual(c.offer.length, 3);
  const other = ['p1', 'p2', 'p3'].find((p) => p !== c.chooser && p !== e.leadPid());
  if (other) assert.ok(!e.apply({ type: 'category', cat: c.offer[0] }, other));
  assert.ok(!e.apply({ type: 'category', cat: 'gibtsnicht' }, c.chooser));
  assert.ok(e.viewFor(c.chooser).cur.category.mine);
  assert.ok(e.apply({ type: 'category', cat: c.offer[1] }, c.chooser));
  assert.strictEqual(e.s.phase, 'lie');
  assert.strictEqual(c.q.cat, c.offer[1]);
  const first = c.chooser;
  lieAll(e);
  pickAll(e, (pid, x) => truthKey(x));
  revealAll(e);
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.phase, 'category');
  assert.notStrictEqual(e.cur().chooser, first, 'nächste Person wählt');
  e.clock.add(CATEGORY_S * 1000 + 1);
  e.tick();
  assert.strictEqual(e.s.phase, 'lie');
  assert.ok(e.cur().offer.includes(e.cur().q.cat));
});

test('Wörterbuch: Prüfen, Zusammenlegen (auch mit der Wahrheit = getroffen), Rückgängig', () => {
  const e = game(['p1', 'p2', 'p3', 'p4'], { mode: 'dict' });
  const c = e.cur();
  assert.strictEqual(c.q.kind, 'dict');
  c.q = { id: 'w:hagestolz', cat: 'woerterbuch', kind: 'dict', text: 'Hagestolz', truth: 'Ein älterer Junggeselle', forms: [], decoys: ['Ein Zaunpfahl', 'Ein Wachhund', 'Ein Hutschmuck'], source: 'https://www.dwds.de/wb/Hagestolz' };
  lieAll(e, { p1: 'Ein alter Junggeselle', p2: 'Ein stolzer Hahn', p3: 'Ein eitler Hahn', p4: 'Ein Hutständer' });
  assert.strictEqual(e.s.phase, 'check');
  const view = e.viewFor(STAGE).cur.check;
  assert.ok(!hasKey(view, 'truth') && !hasKey(view, 'authors'), 'Prüfen ohne Herkunft');
  const k = (pid) => keyOfLie(c, pid);
  assert.ok(!e.apply({ type: 'merge', from: k('p2'), into: k('p3') }, 'p2'), 'nur die Spielleitung');
  const lead = e.leadPid();
  assert.ok(!e.apply({ type: 'merge', from: k(lead), into: truthKey(c) }, lead), 'nicht die eigene Erklärung');
  assert.ok(e.apply({ type: 'merge', from: k('p2'), into: k('p3') }, STAGE));
  assert.deepStrictEqual(optionOf(c, (o) => o.authors.includes('p3')).authors.sort(), ['p2', 'p3']);
  assert.ok(e.apply({ type: 'merge', from: truthKey(c), into: k('p1') }, STAGE), 'Wahrheit bleibt stehen');
  assert.ok(optionOf(c, (o) => o.truth));
  assert.deepStrictEqual(c.hits, ['p1']);
  assert.ok(e.apply({ type: 'unmerge' }, STAGE));
  assert.deepStrictEqual(c.hits, []);
  e.apply({ type: 'merge', from: k('p1'), into: truthKey(c) }, STAGE);
  e.apply({ type: 'merge', from: k('p2'), into: k('p3') }, STAGE);
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.strictEqual(e.s.phase, 'pick');
  const pv = e.viewFor('p1').cur.pick;
  assert.ok(pv.hit && !pv.canPick, 'wer getroffen hat, tippt nicht');
  pickAll(e, { p2: truthKey(c), p3: k('p4'), p4: k('p3') });
  assert.strictEqual(e.s.phase, 'reveal', 'p1 muss nicht tippen');
  revealAll(e);
  const g = e.questionResult(c).gains;
  assert.strictEqual(g.p1.truth, POINTS.truth[0]);
  assert.strictEqual(g.p2.fooled, POINTS.fooled[0], 'zusammengelegte Erklärung zählt für beide');
  assert.strictEqual(g.p3.fooled, POINTS.fooled[0]);
});

test('Wörterbuch: Prüfen endet nach Zeit', () => {
  const e = game(['p1', 'p2', 'p3'], { mode: 'dict' });
  lieAll(e);
  assert.strictEqual(e.s.phase, 'check');
  e.clock.add(CHECK_S * 1000 + 1);
  e.tick();
  assert.strictEqual(e.s.phase, 'pick');
});

test('nur 6 Lügen zeigen: Haus zuerst weg, dann zufällige; Betroffene wissen es', () => {
  const pids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
  const e = game(pids, { maxShown: 6 });
  useQuestion(e, SINGAPUR);
  lieAll(e, { p8: null });
  timeUp(e);
  const c = e.cur();
  assert.strictEqual(c.options.filter((o) => !o.truth).length, 6);
  assert.ok(!c.options.some((o) => o.house));
  assert.strictEqual(c.dropped.length, 1);
  assert.ok(e.viewFor(c.dropped[0]).cur.pick.dropped);
});

test('Likes: nach dem Aufdecken, nicht für eigene/Haus/Wahrheit, 100 Punkte', () => {
  const e = game(['p1', 'p2', 'p3']);
  useQuestion(e, SINGAPUR);
  lieAll(e);
  const c = e.cur();
  assert.ok(!e.apply({ type: 'like', target: c.id, key: keyOfLie(c, 'p2') }, 'p1'), 'nicht beim Tippen');
  pickAll(e, () => truthKey(c));
  revealAll(e);
  assert.ok(!e.apply({ type: 'like', target: c.id, key: keyOfLie(c, 'p1') }, 'p1'), 'nicht die eigene');
  assert.ok(!e.apply({ type: 'like', target: c.id, key: truthKey(c) }, 'p1'));
  assert.ok(e.apply({ type: 'like', target: c.id, key: keyOfLie(c, 'p2') }, 'p1'));
  assert.ok(e.apply({ type: 'like', target: c.id, key: keyOfLie(c, 'p2') }, 'p3'));
  assert.strictEqual(e.questionResult(c).gains.p2.likes, 2 * POINTS.like);
  assert.ok(e.apply({ type: 'like', target: c.id, key: keyOfLie(c, 'p2') }, 'p3'), 'nochmal = zurück');
  assert.strictEqual(e.questionResult(c).gains.p2.likes, POINTS.like);
  e.s.settings.likes = false;
  assert.ok(!e.apply({ type: 'like', target: c.id, key: keyOfLie(c, 'p2') }, 'p3'));
});

/* ---------- Geheimhaltung ---------- */

console.log('Gefilterte Ansicht');

test('vor der Auflösung: keine Wahrheit, keine Autoren – nirgends', () => {
  const e = game(['p1', 'p2', 'p3', 'p4'], { chooseCategory: true });
  const viewers = [STAGE, 'p1', 'p2', 'p3', 'p4'];
  const check = () => {
    for (const v of viewers) {
      const view = e.viewFor(v);
      const json = JSON.stringify(view);
      assert.ok(!hasKey(view.cur, 'truth'), `${e.s.phase}/${v}: truth`);
      assert.ok(!hasKey(view.cur, 'authors'), `${e.s.phase}/${v}: authors`);
      assert.ok(!hasKey(view.cur, 'house'), `${e.s.phase}/${v}: house`);
      // Vor dem Tippen steht die Wahrheit nirgends (danach ist sie eine Karte unter vielen)
      if (['category', 'lie'].includes(e.s.phase)) assert.ok(!json.includes('Kaugummi'), `${e.s.phase}/${v}: Wahrheit im Text`);
      assert.ok(!json.includes('example.org'), `${e.s.phase}/${v}: Quelle`);
    }
  };
  check();
  e.apply({ type: 'next', force: true }, STAGE);
  useQuestion(e, SINGAPUR);
  check();
  lieAll(e);
  check();
  const c = e.cur();
  // Kennungen verraten nichts: Buchstaben in der Reihenfolge der Karten
  assert.deepStrictEqual(c.options.map((o) => o.key), c.options.map((_, i) => String.fromCharCode(97 + i)));
  // fremde Lügen sind für niemanden als „mine“ markiert
  const v1 = e.viewFor('p1').cur.pick.options;
  assert.strictEqual(v1.filter((o) => o.mine).length, 1);
  assert.strictEqual(e.viewFor(STAGE).cur.pick.options.filter((o) => o.mine).length, 0);
  pickAll(e, { p1: truthKey(c), p2: truthKey(c) });
  check();
  // Wer was getippt hat, sehen andere nicht
  assert.strictEqual(e.viewFor('p3').cur.pick.myPicks.length, 0);
  assert.ok(!hasKey(e.viewFor(STAGE).cur.pick, 'picks'));
});

test('während der Lügen sieht niemand fremde Lügen', () => {
  const e = game(['p1', 'p2', 'p3']);
  useQuestion(e, SINGAPUR);
  e.apply({ type: 'lie', target: e.cur().id, text: 'Geheimlüge' }, 'p1');
  assert.ok(JSON.stringify(e.viewFor('p1')).includes('Geheimlüge'));
  for (const v of [STAGE, 'p2', 'p3']) assert.ok(!JSON.stringify(e.viewFor(v)).includes('Geheimlüge'), v);
});

/* ---------- Sonstiges ---------- */

console.log('Sonstiges');

test('Rauswurf mitten in der Frage: Lüge weg, wer übrig ist, kann weiter', () => {
  const e = game(['p1', 'p2', 'p3', 'p4']);
  useQuestion(e, SINGAPUR);
  lieAll(e, { p4: null });
  assert.strictEqual(e.s.phase, 'lie');
  assert.ok(e.apply({ type: 'kick', player: 'p4' }, STAGE));
  assert.strictEqual(e.s.phase, 'pick', 'alle Übrigen haben gelogen');
  const c = e.cur();
  pickAll(e, { p1: truthKey(c), p2: truthKey(c) });
  assert.ok(e.apply({ type: 'kick', player: 'p3' }, STAGE));
  assert.strictEqual(e.s.phase, 'reveal');
  assert.ok(!c.options.some((o) => o.authors.includes('p3')));
});

test('Neu dazu mitten im Spiel: tippt sofort, lügt ab der nächsten Frage', () => {
  const e = game(['p1', 'p2', 'p3']);
  e.connect('p9', 'Neu');
  const c = e.cur();
  assert.ok(!c.pids.includes('p9'));
  assert.ok(!e.apply({ type: 'lie', target: c.id, text: 'x' }, 'p9'));
  lieAll(e);
  assert.ok(e.apply({ type: 'pick', target: c.id, key: truthKey(c) }, 'p9'));
  pickAll(e, (pid) => (pid === 'p9' ? null : truthKey(c)));
  revealAll(e);
  e.apply({ type: 'next' }, STAGE);
  assert.ok(e.cur().pids.includes('p9'));
});

test('Spielleitung am Handy darf weiterschalten, andere nicht; alte Klicks zählen nicht', () => {
  const e = game(['p1', 'p2', 'p3']);
  const lead = e.leadPid();
  const other = ['p1', 'p2', 'p3'].find((p) => p !== lead);
  const step = e.stepKey();
  assert.ok(!e.apply({ type: 'next', force: true }, other));
  assert.ok(e.apply({ type: 'next', force: true, step }, lead));
  assert.strictEqual(e.s.phase, 'pick');
  assert.ok(!e.apply({ type: 'next', force: true, step }, lead), 'alter Schritt');
});

test('Trinkregeln: pro Lüge 1 Schluck, Wahrheit → 1 verteilen', () => {
  const e = game(['p1', 'p2', 'p3'], { drinks: true });
  useQuestion(e, SINGAPUR);
  lieAll(e);
  const c = e.cur();
  pickAll(e, { p1: truthKey(c), p2: keyOfLie(c, 'p1'), p3: keyOfLie(c, 'p1') });
  revealAll(e);
  const sips = e.viewFor(STAGE).cur.reveal.sips;
  assert.deepStrictEqual(sips.sips, { p2: 1, p3: 1 });
  assert.deepStrictEqual(sips.give.map((g) => g.pid), ['p1']);
});

test('Auszeichnungen am Ende, Nochmal setzt zurück', () => {
  const e = game(['p1', 'p2', 'p3'], { length: 'short' });
  let n = 0;
  while (e.s.phase !== 'end' && n++ < 20) {
    if (e.s.phase === 'scores') {
      e.apply({ type: 'next' }, STAGE);
      continue;
    }
    // p1 und p2 erkennen die Wahrheit, p3 fällt immer auf p1 rein
    lieAll(e);
    const c = e.cur();
    const otherLie = (pid) => c.options.find((o) => !o.truth && !o.authors.includes(pid)).key;
    const picks = { p1: [truthKey(c), otherLie('p1')], p2: [truthKey(c), otherLie('p2')], p3: [keyOfLie(c, 'p1'), truthKey(c)] };
    pickAll(e, (pid) => picks[pid].slice(0, e.slotsFor(c, pid)));
    revealAll(e);
    if (c.options.some((o) => o.authors.includes('p1'))) e.apply({ type: 'like', target: c.id, key: keyOfLie(c, 'p1') }, 'p2');
    e.apply({ type: 'next' }, STAGE);
  }
  assert.strictEqual(e.s.phase, 'end');
  const titles = e.s.awards.map((a) => a.title);
  assert.ok(titles.includes('Meisterlügner/in'), titles.join(', '));
  assert.ok(titles.includes('Lügendetektor'));
  assert.ok(titles.includes('Beste Lüge'));
  assert.ok(e.s.awards.find((a) => a.title === 'Meisterlügner/in').text.startsWith('P1'));
  const v = e.viewFor(STAGE);
  assert.strictEqual(v.history.length, 5);
  assert.ok(v.history[0].truth && v.history[0].source);
  assert.ok(e.apply({ type: 'again' }, STAGE));
  assert.strictEqual(e.s.phase, 'lobby');
  assert.strictEqual(e.s.questions.length, 0);
});

test('Ansicht ist JSON-fähig und der Spielstand lässt sich wiederherstellen', () => {
  const e = game(['p1', 'p2', 'p3']);
  lieAll(e);
  const saved = JSON.parse(JSON.stringify(e.s));
  const e2 = new Engine(saved, { timers: false, now: e.clock });
  assert.strictEqual(e2.s.phase, 'pick');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(e2.viewFor('p1'))), e2.viewFor('p1'));
});

test('Ziehen ohne Wiederholung im Spiel', () => {
  const e = game(['p1', 'p2', 'p3'], { length: 'long' });
  const seen = new Set();
  let n = 0;
  while (e.s.phase !== 'end' && n++ < 30) {
    if (e.s.phase === 'scores') {
      e.apply({ type: 'next' }, STAGE);
      continue;
    }
    assert.ok(!seen.has(e.cur().q.id), 'doppelt: ' + e.cur().q.id);
    seen.add(e.cur().q.id);
    playQuestion(e);
  }
  assert.strictEqual(seen.size, 9);
});

console.log(`\n${passed} Tests bestanden.`);
