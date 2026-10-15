'use strict';
/* Tests für „Prost!“ (ohne Browser): node tests/prost.test.js */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
// Gesehene Karten landen sonst im echten localStorage – hier ein Speicher nur für den Test
const mem = {};
globalThis.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => (mem[k] = String(v)),
  removeItem: (k) => delete mem[k],
};
for (const f of ['cards/warmup', 'cards/party', 'cards/heftig', 'cards/paerchen', 'cards/adult', 'deck', 'engine']) {
  require(path.join(__dirname, '..', 'prost', 'js', f + '.js'));
}
const Deck = globalThis.PRDeck;
const { Engine, STAGE, RULE_MIN, RULE_MAX, WATER_MIN, WATER_MAX, sanitizeSettings } = globalThis.PREngine;

let passed = 0;
function test(name, fn) {
  try {
    for (const k of Object.keys(mem)) delete mem[k];
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    console.error('  ✗ ' + name);
    throw err;
  }
}

/** Zufall mit festem Startwert, damit Tests wiederholbar sind */
function seeded(seed) {
  let x = seed || 42;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

const NAMES = ['Anna', 'Ben', 'Cem', 'Dora', 'Eli', 'Finn'];

function passGame(settings, opts) {
  const o = opts || {};
  const hooks = { random: seeded(o.seed) };
  const state = Engine.create(
    { settings: Object.assign({ input: 'pass' }, settings), players: o.players || NAMES.slice(0, o.n || 5), couples: o.couples },
    hooks
  );
  return new Engine(state, Object.assign({}, hooks, o.hooks));
}

function next(e) {
  assert.ok(e.apply({ type: 'next', at: e.s.step }, STAGE), 'next');
  return e.s.shown[e.s.view];
}

/** Bis zum Spielende durchtippen, gibt alle aufgedeckten Einträge zurück */
function playAll(e, max) {
  let guard = max || 1000;
  while (e.s.phase === 'play' && guard--) next(e);
  assert.strictEqual(e.s.phase, 'end', 'Spiel endet');
  return e.s.shown;
}

/* ---------- Kartenlisten ---------- */

console.log('Kartenlisten');

test('jede Karte hat einen gültigen Typ und Text', () => {
  for (const c of Deck.all()) {
    assert.ok(Deck.CARD_TYPES.includes(c.type), `Typ „${c.type}“ unbekannt: ${c.text}`);
    assert.ok(c.text.length > 5, 'Text fehlt: ' + c.key);
  }
});

test('Regel und Virus haben einen Ende-Text, andere Typen nicht', () => {
  for (const c of Deck.all()) {
    if (Deck.LASTING.includes(c.type)) assert.ok(c.end, 'Ende-Text fehlt: ' + c.text);
    else assert.strictEqual(c.end, null, 'Ende-Text bei ' + c.type + ': ' + c.text);
  }
});

test('nur bekannte Platzhalter, Paar-Platzhalter nur im Pärchen-Set', () => {
  for (const c of Deck.all()) {
    for (const p of Deck.placeholders(c.text + ' ' + (c.end || ''))) {
      assert.ok(Deck.PLACEHOLDERS.includes(p), `Platzhalter {${p}} unbekannt: ${c.text}`);
    }
    if (c.needs.couple) assert.strictEqual(c.set, 'paerchen', 'Paar-Platzhalter außerhalb Pärchen: ' + c.text);
  }
});

test('Ende-Text nutzt nur Namen, die auch auf der Karte stehen', () => {
  for (const c of Deck.all().filter((x) => x.end)) {
    const own = Deck.placeholders(c.text);
    for (const p of Deck.placeholders(c.end)) if (/^[pc]\d$/.test(p)) assert.ok(own.includes(p), `{${p}} nur im Ende-Text: ${c.text}`);
  }
});

test('Namen lückenlos ({p2} nur mit {p1})', () => {
  for (const c of Deck.all()) {
    const used = Deck.placeholders(c.text + ' ' + (c.end || ''));
    if (used.includes('p2')) assert.ok(used.includes('p1'), c.text);
    if (used.includes('p3')) assert.ok(used.includes('p2'), c.text);
  }
});

test('„Ich hab noch nie“ und „Wer würde eher“ ohne doppelten Satzanfang', () => {
  for (const c of Deck.all()) {
    if (c.type === 'nie') {
      assert.ok(!/^ich hab/i.test(c.text), 'nie mit Satzanfang: ' + c.text);
      assert.ok(/[.!]$/.test(c.text), 'nie ohne Punkt: ' + c.text);
    }
    if (c.type === 'eher') {
      assert.ok(!/^wer/i.test(c.text), 'eher mit Satzanfang: ' + c.text);
      assert.ok(!/[?.]$/.test(c.text), 'eher mit Satzzeichen: ' + c.text);
    }
  }
});

test('keine Dopplungen', () => {
  const keys = new Set();
  for (const c of Deck.all()) {
    const k = c.text.toLowerCase();
    assert.ok(!keys.has(k), 'doppelt: ' + c.text);
    keys.add(k);
  }
});

test('genug Karten in jedem Set (insgesamt ca. 400)', () => {
  const n = Deck.counts();
  assert.ok(n.warmup >= 50, 'Warm-up ' + n.warmup);
  assert.ok(n.party >= 150, 'Party ' + n.party);
  assert.ok(n.heftig >= 60, 'Heftig ' + n.heftig);
  assert.ok(n.paerchen >= 40, 'Pärchen ' + n.paerchen);
  assert.ok(n.adult >= 60, '18+ ' + n.adult);
  assert.ok(n.total >= 380, 'insgesamt ' + n.total);
});

test('jedes Set hat jeden Kartentyp mindestens einmal (außer Kategorie/Duell im Pärchen-Set)', () => {
  for (const s of Deck.SETS) {
    for (const t of Deck.CARD_TYPES) {
      if (s.id === 'paerchen' && t === 'kategorie') continue;
      assert.ok(
        Deck.all().some((c) => c.set === s.id && c.type === t),
        `${s.id}: kein ${t}`
      );
    }
  }
});

/* ---------- Platzhalter ---------- */

console.log('Platzhalter');

const players = (n) => NAMES.slice(0, n).map((name, i) => ({ id: 'p' + (i + 1), name, picked: 0 }));

test('alle Platzhalter werden ersetzt, {p1} ≠ {p2} ≠ {p3}', () => {
  const r = seeded(3);
  for (const c of Deck.all()) {
    const f = Deck.fill(c, { players: players(5), couples: [['p1', 'p2']], random: r });
    assert.ok(f, 'nicht füllbar: ' + c.text);
    assert.ok(!/\{\w+\}/.test(f.text + (f.endText || '')), 'Platzhalter übrig: ' + f.text);
    assert.strictEqual(new Set(f.players).size, f.players.length);
  }
});

test('Schlucke: Einzahl/Mehrzahl und Intensität (mind. 1)', () => {
  assert.strictEqual(Deck.sips(1, 'normal'), '1 Schluck');
  assert.strictEqual(Deck.sips(3, 'normal'), '3 Schlucke');
  assert.strictEqual(Deck.sips(1, 'leicht'), '1 Schluck');
  assert.strictEqual(Deck.sips(4, 'leicht'), '2 Schlucke');
  assert.strictEqual(Deck.sips(2, 'heftig'), '3 Schlucke');
  assert.strictEqual(Deck.sips(3, 'heftig'), '5 Schlucke');
  const card = Deck.parse('aufgabe|{p1} verteilt {s4}.', 'party')[0];
  assert.strictEqual(Deck.fill(card, { players: players(2), intensity: 'leicht', random: seeded(1) }).text.endsWith('verteilt 2 Schlucke.'), true);
});

test('Satzanfang bei „Ich hab noch nie“ und „Wer würde eher“', () => {
  const [nie, eher] = Deck.parse('nie|einen Liebesbrief geschrieben.\neher|bei einer Quizshow mitmachen', 'party');
  const ctx = { players: players(3), random: seeded(1) };
  assert.strictEqual(Deck.fill(nie, ctx).text, 'Ich hab noch nie einen Liebesbrief geschrieben.');
  assert.strictEqual(Deck.fill(eher, ctx).text, 'Wer würde eher bei einer Quizshow mitmachen?');
  assert.ok(Deck.fill(eher, ctx).note.includes('2 Schlucke'));
});

test('zu wenige Personen oder kein Paar → Karte nicht füllbar', () => {
  const [three, pair] = Deck.parse('aufgabe|{p1}, {p2} und {p3} trinken {s1}.\naufgabe|{c1} küsst {c2}.', 'paerchen');
  assert.strictEqual(Deck.fill(three, { players: players(2) }), null);
  assert.strictEqual(Deck.fill(pair, { players: players(4), couples: [] }), null);
  assert.strictEqual(Deck.fill(pair, { players: players(4), couples: [['p1', 'p9']] }), null);
});

test('Paar wird zusammen eingesetzt, {p1} ist dann jemand anderes', () => {
  const [card] = Deck.parse('aufgabe|{p1} stellt {c1} eine Frage über {c2}.', 'paerchen');
  for (let i = 0; i < 20; i++) {
    const f = Deck.fill(card, { players: players(4), couples: [['p2', 'p3']], random: seeded(i + 1) });
    assert.ok(/(Ben|Cem) eine Frage über (Ben|Cem)/.test(f.text), f.text);
    assert.ok(!f.text.startsWith('Ben') && !f.text.startsWith('Cem'), f.text);
  }
});

test('faire Verteilung über 50 Karten', () => {
  const e = passGame({ length: 50, water: false }, { n: 6, seed: 7 });
  playAll(e);
  const picks = e.s.players.map((p) => p.picked);
  assert.ok(Math.max(...picks) - Math.min(...picks) <= 2, 'ungleich: ' + picks.join(','));
});

test('dieselbe Person nicht zweimal hintereinander (wenn es anders geht)', () => {
  const e = passGame({ length: 80, water: false }, { n: 5, seed: 11 });
  const shown = playAll(e).filter((x) => x.kind === 'card');
  let repeats = 0;
  for (let i = 1; i < shown.length; i++) if (shown[i].players.some((id) => shown[i - 1].players.includes(id))) repeats++;
  assert.ok(repeats <= 3, 'zu oft hintereinander: ' + repeats);
});

/* ---------- Stapel ---------- */

console.log('Stapel');

test('Warm-up zuerst, gewählte Sets werden respektiert', () => {
  const deck = Deck.build({ sets: ['warmup', 'party'], length: 50, random: seeded(2) });
  assert.strictEqual(deck.length, 50);
  assert.ok(deck.slice(0, 5).every((c) => c.set === 'warmup'), 'Anfang ist Warm-up');
  assert.ok(deck.every((c) => ['warmup', 'party'].includes(c.set)));
  const hot = Deck.build({ sets: ['heftig', 'adult'], length: 30, random: seeded(2) });
  assert.ok(hot.every((c) => ['heftig', 'adult'].includes(c.set)));
});

test('keine Wiederholungen im Stapel', () => {
  const deck = Deck.build({ sets: ['warmup', 'party', 'heftig'], length: 80, random: seeded(5) });
  assert.strictEqual(new Set(deck.map((c) => c.key)).size, deck.length);
});

test('Pärchen-Set nur mit eingetragenen Paaren', () => {
  const without = Deck.build({ sets: ['paerchen', 'party'], length: 80, couples: false, random: seeded(5) });
  assert.ok(without.every((c) => c.set !== 'paerchen'));
  const withC = Deck.build({ sets: ['paerchen', 'party'], length: 80, couples: true, random: seeded(5) });
  assert.ok(withC.some((c) => c.set === 'paerchen'));
});

test('gesehene Karten kommen beim nächsten Abend erst später', () => {
  const first = Deck.build({ sets: ['warmup'], length: 20, random: seeded(1) });
  for (const c of first) Deck.markSeen(c.key);
  const second = Deck.build({ sets: ['warmup'], length: 20, random: seeded(1) });
  assert.ok(second.every((c) => !first.some((x) => x.key === c.key)), 'nur neue Karten');
});

test('alles gesehen → Set wird wieder freigegeben', () => {
  for (const c of Deck.all().filter((x) => x.set === 'warmup')) Deck.markSeen(c.key);
  const deck = Deck.build({ sets: ['warmup'], length: 20, random: seeded(1) });
  assert.strictEqual(deck.length, 20);
  const seen = Deck.loadSeen();
  assert.ok(!deck.some((c) => seen.has(c.key)), 'Gesehenes zurückgesetzt');
});

/* ---------- Spielablauf ---------- */

console.log('Spielablauf');

test('Ein Gerät startet sofort mit der Startkarte', () => {
  const e = passGame({});
  assert.strictEqual(e.s.phase, 'play');
  assert.strictEqual(e.s.shown[0].kind, 'start');
  assert.strictEqual(e.s.count, 0);
});

test('Spieldauer: genau so viele Karten, dann Ende', () => {
  for (const length of [30, 50]) {
    const e = passGame({ length }, { seed: length });
    const shown = playAll(e);
    assert.strictEqual(shown.filter((x) => x.kind === 'card').length, length);
    assert.strictEqual(e.s.count, length);
  }
});

test('jede Regel endet genau einmal, 5–15 Karten später – oder erst bei Spielende', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const e = passGame({ length: 80, sets: ['party', 'heftig'] }, { seed });
    const shown = playAll(e);
    const rules = shown.filter((x) => x.kind === 'card' && x.rule);
    assert.ok(rules.length > 0, 'es gab Regeln');
    for (const r of rules) {
      const ends = shown.filter((x) => x.kind === 'end' && x.rule === r.rule);
      const atEnd = e.s.ended.filter((x) => x.id === r.rule);
      assert.strictEqual(ends.length + atEnd.length, 1, 'genau ein Ende: ' + r.text);
      if (ends.length) {
        const d = ends[0].count - r.count;
        assert.ok(ends[0].n > r.n, 'Ende nach der Regel');
        assert.ok(d >= RULE_MIN && d <= RULE_MAX, 'Abstand ' + d);
      } else {
        assert.ok(r.count + RULE_MIN > 80 || r.count + RULE_MAX > 80, 'gilt bis Spielende nur, wenn das Ende sonst danach käme');
      }
    }
  }
});

test('keine Regel-Enden nach Spielende, offene Regeln werden am Ende angezeigt', () => {
  const e = passGame({ length: 30, sets: ['party'] }, { seed: 9 });
  playAll(e);
  assert.strictEqual(e.s.active.length, 0);
  for (const r of e.s.ended) assert.ok(r.text && r.endText);
});

test('Wasserpausen im Abstand von 13–17 Karten und abschaltbar', () => {
  const e = passGame({ length: 80, water: true }, { seed: 4 });
  const shown = playAll(e);
  const pauses = shown.filter((x) => x.kind === 'pause');
  assert.ok(pauses.length >= 4, 'Pausen: ' + pauses.length);
  assert.ok(pauses[0].text.includes('3 Schlucke Wasser'));
  let last = 0;
  for (const p of pauses) {
    assert.ok(p.count - last >= WATER_MIN && p.count - last <= WATER_MAX + 1, 'Abstand ' + (p.count - last));
    last = p.count;
  }
  const dry = passGame({ length: 80, water: false }, { seed: 4 });
  assert.ok(!playAll(dry).some((x) => x.kind === 'pause'));
});

test('Wasserpause mitten im Spiel einschalten', () => {
  const e = passGame({ length: 80, water: false }, { seed: 4 });
  for (let i = 0; i < 20; i++) next(e);
  assert.ok(e.apply({ type: 'settings', settings: { water: true } }, STAGE));
  assert.ok(e.s.nextWater > e.s.count, 'nicht sofort');
  for (let i = 0; i < 20; i++) next(e);
  assert.ok(e.s.shown.some((x) => x.kind === 'pause'));
});

test('Zurück und wieder vor zeigt dieselben Karten', () => {
  const e = passGame({}, { seed: 3 });
  const a = next(e);
  const b = next(e);
  assert.ok(e.apply({ type: 'back', at: e.s.step }, STAGE));
  assert.strictEqual(e.s.shown[e.s.view], a);
  assert.strictEqual(next(e), b, 'vorblättern zeigt die gleiche Karte');
  assert.strictEqual(e.s.count, 2, 'keine neue Karte gezogen');
  const c = next(e);
  assert.notStrictEqual(c, b);
});

test('Zurück geht nicht vor die erste Karte, doppeltes Tippen zählt nur einmal', () => {
  const e = passGame({});
  assert.strictEqual(e.apply({ type: 'back', at: e.s.step }, STAGE), false);
  const at = e.s.step;
  assert.ok(e.apply({ type: 'next', at }, STAGE));
  assert.strictEqual(e.apply({ type: 'next', at }, STAGE), false, 'veralteter Schritt');
});

test('Intensität ändert die Schlucke ab der nächsten Karte', () => {
  const e = passGame({ intensity: 'heftig', sets: ['party'] }, { seed: 2 });
  e.s.deck.splice(e.s.cursor, 0, Deck.parse('aufgabe|{p1} verteilt {s2}.', 'party')[0]);
  assert.ok(next(e).text.endsWith('verteilt 3 Schlucke.'));
  e.apply({ type: 'settings', settings: { intensity: 'leicht' } }, STAGE);
  e.s.deck.splice(e.s.cursor, 0, Deck.parse('aufgabe|{p1} trinkt {s2}.', 'party')[0]);
  assert.ok(next(e).text.endsWith('trinkt 1 Schluck.'));
});

test('endlos: Stapel wird nachgelegt', () => {
  const e = passGame({ length: 0, sets: ['warmup'] }, { seed: 6 });
  for (let i = 0; i < 150; i++) next(e);
  assert.strictEqual(e.s.phase, 'play');
  assert.ok(e.s.count > 100);
  assert.ok(e.apply({ type: 'finish' }, STAGE));
  assert.strictEqual(e.s.phase, 'end');
});

test('Sets mitten im Spiel ändern: Rest des Stapels wird neu gebaut', () => {
  const e = passGame({ length: 50, sets: ['warmup', 'party'] }, { seed: 6 });
  for (let i = 0; i < 10; i++) next(e);
  assert.ok(e.apply({ type: 'settings', settings: { sets: ['adult'] } }, STAGE));
  const before = e.s.count;
  const rest = e.s.deck.slice(e.s.cursor);
  assert.ok(rest.length >= 50 - before);
  assert.ok(rest.every((c) => c.set === 'adult'));
});

test('Nochmal: neuer Stapel, gleiche Leute', () => {
  const e = passGame({ length: 30 }, { seed: 6 });
  playAll(e);
  assert.ok(e.apply({ type: 'again' }, STAGE));
  assert.strictEqual(e.s.phase, 'play');
  assert.strictEqual(e.s.count, 0);
  assert.strictEqual(e.s.players.length, 5);
});

/* ---------- Personen kommen und gehen ---------- */

console.log('Personen');

test('Person kommt dazu: wird ab jetzt eingesetzt, aber nicht dauernd', () => {
  const e = passGame({ length: 80, water: false }, { n: 4, seed: 8 });
  for (let i = 0; i < 30; i++) next(e);
  assert.ok(e.apply({ type: 'addPlayer', name: 'Zoe' }, STAGE));
  const zoe = e.s.players.find((p) => p.name === 'Zoe');
  const startPicked = zoe.picked;
  assert.ok(startPicked > 0, 'startet nicht bei 0');
  for (let i = 0; i < 30; i++) next(e);
  assert.ok(zoe.picked > startPicked, 'Zoe kommt dran');
});

test('doppelte Namen werden unterscheidbar', () => {
  const e = passGame({}, { players: ['Anna', 'anna', 'Ben'] });
  assert.deepStrictEqual(
    e.s.players.map((p) => p.name),
    ['Anna', 'anna 2', 'Ben']
  );
});

test('Person geht: ihre Regeln/Viren enden, Karten werden ohne sie gefüllt', () => {
  const e = passGame({ length: 80, sets: ['party'] }, { n: 4, seed: 12 });
  const virus = Deck.parse('virus|{p1} darf nur noch flüstern.|{p1} darf wieder reden.', 'party')[0];
  e.s.deck.splice(e.s.cursor, 0, virus);
  const entry = next(e);
  const who = entry.players[0];
  assert.strictEqual(e.s.active.length, 1);
  assert.ok(e.apply({ type: 'removePlayer', player: who }, STAGE));
  assert.strictEqual(e.s.active.length, 0, 'Virus endet');
  assert.strictEqual(e.s.event.kind, 'left');
  const name = entry.text.split(' ')[0];
  for (let i = 0; i < 40 && e.s.phase === 'play'; i++) {
    const x = next(e);
    if (x.kind === 'card') assert.ok(!x.players.includes(who) && !x.text.includes(name + ' '), x.text);
    assert.ok(!(x.kind === 'end' && x.text.includes(name)), 'kein Ende für gegangenen Virus');
  }
});

test('mindestens 2 Personen bleiben im Spiel', () => {
  const e = passGame({}, { n: 2 });
  assert.strictEqual(e.apply({ type: 'removePlayer', player: e.s.players[0].id }, STAGE), false);
});

test('Paar: eintragen beim Start, Person geht → Paar aufgelöst, Pärchen-Karten fallen weg', () => {
  const e = passGame({ sets: ['paerchen'], length: 30 }, { n: 4, couples: [['Anna', 'Ben']], seed: 3 });
  assert.strictEqual(e.s.couples.length, 1);
  const first = next(e);
  assert.strictEqual(first.set, 'paerchen');
  assert.ok(e.apply({ type: 'removePlayer', player: e.s.players[0].id }, STAGE));
  assert.strictEqual(e.s.couples.length, 0);
  // Ohne Paar sind nur noch Karten ohne {c1}/{c2} spielbar
  while (e.s.phase === 'play') {
    const x = next(e);
    if (x.kind === 'card') assert.ok(!x.text.includes('Anna'), x.text);
  }
});

test('Paare: jede Person nur in einem Paar, keine Paare mit sich selbst', () => {
  const e = passGame({}, { n: 4 });
  const [a, b, c] = e.s.players.map((p) => p.id);
  assert.ok(e.apply({ type: 'addCouple', a, b }, STAGE));
  assert.strictEqual(e.apply({ type: 'addCouple', a, b: c }, STAGE), false);
  assert.strictEqual(e.apply({ type: 'addCouple', a: c, b: c }, STAGE), false);
  assert.ok(e.apply({ type: 'removeCouple', index: 0 }, STAGE));
  assert.strictEqual(e.s.couples.length, 0);
});

test('Regel von Hand aufheben', () => {
  const e = passGame({ sets: ['party'] }, { seed: 2 });
  e.s.deck.splice(e.s.cursor, 0, Deck.parse('regel|Neue Regel: Wer lacht, trinkt {s1}.|Ihr dürft wieder lachen.', 'party')[0]);
  next(e);
  const id = e.s.active[0].id;
  assert.ok(e.apply({ type: 'endRule', id }, STAGE));
  assert.strictEqual(e.s.active.length, 0);
});

test('Einstellungen werden geprüft', () => {
  const s = sanitizeSettings({ length: 999, sets: ['quatsch'], intensity: 'extrem', water: 'ja' });
  assert.strictEqual(s.length, 50);
  assert.deepStrictEqual(s.sets, ['warmup', 'party']);
  assert.strictEqual(s.intensity, 'normal');
  assert.strictEqual(s.water, true);
  assert.deepStrictEqual(sanitizeSettings({ sets: ['adult', 'warmup'] }).sets, ['warmup', 'adult']);
});

/* ---------- Mit Handys ---------- */

console.log('Mit Handys');

function phoneGame(opts) {
  const o = opts || {};
  const kicked = [];
  const hooks = { random: seeded(o.seed || 5), onKick: (pid) => kicked.push(pid) };
  const state = Engine.create({ settings: Object.assign({ input: 'phones', water: false, sets: ['party'] }, o.settings), players: o.players || ['Oma'] }, hooks);
  const e = new Engine(state, hooks);
  e.kicked = kicked;
  for (const id of o.ids || ['a', 'b', 'c']) e.connect(id, id.toUpperCase());
  if (o.start !== false) assert.ok(e.apply({ type: 'start' }, STAGE), 'start');
  return e;
}

/** Nächste Karte vom gewünschten Typ erzwingen */
function force(e, line) {
  e.s.deck.splice(e.s.cursor, 0, Deck.parse(line, 'party')[0]);
  return next(e);
}

test('Lobby: Handys werden zu Personen, eingetragene Namen ohne Handy bleiben', () => {
  const e = phoneGame({ start: false });
  assert.strictEqual(e.s.phase, 'lobby');
  assert.deepStrictEqual(
    e.s.players.map((p) => p.name),
    ['Oma', 'A', 'B', 'C']
  );
  assert.strictEqual(e.voters().length, 3);
  const v = e.viewFor('a');
  assert.strictEqual(v.me.name, 'A');
  assert.ok(v.me.id);
});

test('Handy mit gleichem Namen wie eine eingetragene Person übernimmt sie', () => {
  const e = phoneGame({ start: false, players: ['Anna', 'Ben'], ids: [] });
  e.connect('x', 'anna');
  assert.strictEqual(e.s.players.length, 2);
  assert.strictEqual(e.playerOfPhone('x').name, 'Anna');
});

test('Start erst ab 2 Personen', () => {
  const e = phoneGame({ start: false, players: [], ids: ['a'] });
  assert.ok(e.viewFor(STAGE).lobbyProblem);
  assert.strictEqual(e.apply({ type: 'start' }, STAGE), false);
  e.connect('b', 'B');
  assert.ok(e.apply({ type: 'start' }, STAGE));
});

test('Handys sehen die aktuelle Karte, können aber nicht weiterblättern', () => {
  const e = phoneGame();
  const entry = next(e);
  assert.deepStrictEqual(e.viewFor('a').entry, entry);
  assert.strictEqual(e.apply({ type: 'next', at: e.s.step }, 'a'), false);
});

test('„Wer würde eher“: anonyme Abstimmung, Auflösung sobald alle abgestimmt haben', () => {
  const e = phoneGame();
  const entry = force(e, 'eher|bei einer Quizshow mitmachen');
  const v = e.viewFor('a').vote;
  assert.ok(v && v.kind === 'eher' && v.total === 3);
  const b = e.playerOfPhone('b').id;
  assert.ok(e.apply({ type: 'vote', value: b, no: v.no }, 'a'));
  assert.ok(e.apply({ type: 'vote', value: b, no: v.no }, 'c'));
  assert.strictEqual(e.viewFor('a').vote.mine, b, 'eigene Stimme sichtbar');
  assert.strictEqual(e.viewFor('b').vote.mine, null);
  assert.ok(!entry.result, 'noch offen');
  assert.ok(e.apply({ type: 'vote', value: e.playerOfPhone('c').id, no: v.no }, 'b'));
  assert.ok(entry.result, 'aufgelöst');
  assert.deepStrictEqual(entry.result.top, [b]);
  assert.strictEqual(entry.result.tally[b], 2);
  // Wer wen gewählt hat, steht nirgends in der Ansicht
  assert.ok(!JSON.stringify(e.viewFor(STAGE)).includes('"votes"'));
});

test('„Ich hab noch nie“: zeigt nur die Anzahl', () => {
  const e = phoneGame();
  const entry = force(e, 'nie|einen Liebesbrief geschrieben.');
  const no = e.s.vote.no;
  e.apply({ type: 'vote', value: 'yes', no }, 'a');
  e.apply({ type: 'vote', value: 'yes', no }, 'b');
  e.apply({ type: 'vote', value: 'no', no }, 'c');
  assert.deepStrictEqual(entry.result, { kind: 'nie', yes: 2, total: 3 });
});

test('Weiter löst eine angefangene Abstimmung erst auf, ohne Stimmen geht es direkt weiter', () => {
  const e = phoneGame();
  const entry = force(e, 'eher|einen Marathon laufen');
  e.apply({ type: 'vote', value: e.playerOfPhone('a').id, no: e.s.vote.no }, 'a');
  next(e);
  assert.ok(entry.result, 'aufgelöst');
  assert.strictEqual(e.s.shown[e.s.view], entry, 'Karte bleibt stehen');
  const other = force(e, 'eher|eine Sekte gründen');
  assert.ok(e.s.vote);
  const after = next(e);
  assert.notStrictEqual(after, other);
  assert.ok(!other.result);
  assert.ok(!(e.s.vote && e.s.vote.entry === other.n), 'Abstimmung verworfen');
});

test('Ungültige Stimmen werden ignoriert, Kartengerät kann vorzeitig auflösen', () => {
  const e = phoneGame();
  force(e, 'nie|im Kino geschlafen.');
  const no = e.s.vote.no;
  assert.strictEqual(e.apply({ type: 'vote', value: 'vielleicht', no }, 'a'), false);
  assert.strictEqual(e.apply({ type: 'vote', value: 'yes', no: no + 1 }, 'a'), false);
  assert.strictEqual(e.apply({ type: 'vote', value: 'yes', no }, 'fremd'), false);
  assert.ok(e.apply({ type: 'vote', value: 'yes', no }, 'a'));
  assert.ok(e.apply({ type: 'closeVote' }, STAGE));
  assert.strictEqual(e.s.shown[e.s.view].result.yes, 1);
});

test('Handy geht offline → zählt nicht mehr mit, Abstimmung löst sich auf', () => {
  const e = phoneGame();
  force(e, 'nie|im Auto geschlafen.');
  const no = e.s.vote.no;
  e.apply({ type: 'vote', value: 'yes', no }, 'a');
  e.apply({ type: 'vote', value: 'no', no }, 'b');
  e.disconnect('c');
  assert.strictEqual(e.s.vote, null);
  assert.strictEqual(e.s.shown[e.s.view].result.total, 2);
});

test('ohne verbundene Handys keine Abstimmung (dann wird gezeigt)', () => {
  const e = phoneGame({ ids: ['a', 'b'] });
  e.disconnect('a');
  e.disconnect('b');
  force(e, 'eher|eine Sekte gründen');
  assert.strictEqual(e.s.vote, null);
  const p = passGame({});
  force(p, 'eher|eine Sekte gründen');
  assert.strictEqual(p.s.vote, null);
});

test('Handy kommt mitten im Spiel dazu', () => {
  const e = phoneGame();
  next(e);
  e.connect('d', 'Dana');
  assert.ok(e.s.players.some((p) => p.name === 'Dana'));
  assert.strictEqual(e.s.event.kind, 'joined');
});

test('Person mit Handy entfernen wirft das Handy raus', () => {
  const e = phoneGame();
  const p = e.playerOfPhone('b');
  assert.ok(e.apply({ type: 'removePlayer', player: p.id }, STAGE));
  assert.deepStrictEqual(e.kicked, ['b']);
  assert.ok(!e.s.members.b);
});

test('Neuladen des Kartengeräts: alle offline, Neuverbinden übernimmt die Person wieder', () => {
  const e = phoneGame();
  const before = e.s.players.length;
  e.setAllOffline();
  assert.strictEqual(e.voters().length, 0);
  e.connect('a', 'A');
  assert.strictEqual(e.s.players.length, before);
  assert.strictEqual(e.voters().length, 1);
});

console.log(`\n${passed} Tests bestanden.`);
