'use strict';
/* Tests für „Wortbombe“ (ohne Browser, ohne Ton): node tests/wortbombe.test.js */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
for (const f of ['inhalte/silben', 'inhalte/anfang-ende', 'inhalte/kategorien', 'bomb', 'engine']) {
  require(path.join(__dirname, '..', 'wortbombe', 'js', f + '.js'));
}
const Bomb = globalThis.WBBomb;
const { Engine, FUSES, LEVEL_STUFEN, STRIKES_OUT, ROUNDS, SIPS, SIPS_OUT, MIN_PLAYERS, MAX_PLAYERS, sanitizeSettings, cleanName, pool, drawTask } = globalThis.WBEngine;

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

/** Reproduzierbarer Zufall (mulberry32) */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['Anna', 'Ben', 'Cem', 'Dora', 'Eli'];

function game(settings, opts) {
  const o = opts || {};
  const hooks = Object.assign({ random: seeded(o.seed || 3) }, o.hooks);
  const state = Engine.create({ settings: Object.assign({}, settings), players: o.players || NAMES.slice(0, o.n || 3) }, hooks);
  return new Engine(state, hooks);
}

/** Eine Runde spielen: zünden, n-mal weitergeben, BUMM */
function round(e, passes) {
  assert.ok(e.ignite());
  for (let i = 0; i < passes; i++) e.pass();
  assert.ok(e.explode());
}

console.log('Wortbombe – Bombe');

test('Zündzeit liegt immer im eingestellten Bereich', () => {
  for (const [id, range] of Object.entries(FUSES)) {
    const rnd = seeded(id.length);
    for (let k = 0; k < 300; k++) {
      const p = Bomb.plan(range, rnd);
      assert.ok(p.fuse >= range[0] && p.fuse <= range[1], `${id}: ${p.fuse}`);
    }
  }
  // Ränder: Zufall 0 und knapp 1
  assert.strictEqual(Bomb.plan([10, 30], () => 0).fuse, 10);
  assert.ok(Bomb.plan([10, 30], () => 0.999999).fuse <= 30);
});

test('Beschleunigung beginnt zwischen 40 % und 90 % der Zündzeit', () => {
  const rnd = seeded(11);
  for (let k = 0; k < 500; k++) {
    const p = Bomb.plan(FUSES.normal, rnd);
    const share = p.accelAt / p.fuse;
    assert.ok(share >= 0.4 - 1e-9 && share <= 0.9 + 1e-9, String(share));
  }
});

test('Tick-Abstände werden nach dem Beschleunigungs-Start nie größer', () => {
  const rnd = seeded(5);
  for (let k = 0; k < 300; k++) {
    const p = Bomb.plan(FUSES[['kurz', 'normal', 'lang'][k % 3]], rnd);
    const t = p.ticks;
    assert.ok(t.length > 3);
    assert.strictEqual(t[0], 0);
    for (let i = 1; i < t.length; i++) {
      assert.ok(t[i] > t[i - 1], 'Ticks aufsteigend');
      assert.ok(t[i] < p.fuse, 'kein Tick nach dem Knall');
    }
    for (let i = 2; i < t.length; i++) {
      if (t[i - 2] >= p.accelAt) assert.ok(t[i] - t[i - 1] <= t[i - 1] - t[i - 2] + 1e-9, `Abstand wächst bei ${t[i]}`);
    }
    // vor der Beschleunigung gleichmäßig im Grundtempo
    for (let i = 1; i < t.length && t[i] <= p.accelAt; i++) assert.ok(Math.abs(t[i] - t[i - 1] - p.base) < 1e-9);
  }
});

test('Tempo: Grundtempo um 1/s, nie schneller als 6/s', () => {
  const rnd = seeded(8);
  for (let k = 0; k < 200; k++) {
    const p = Bomb.plan(FUSES.lang, rnd);
    assert.ok(p.base >= 0.85 && p.base <= 1.1);
    for (let i = 1; i < p.ticks.length; i++) assert.ok(p.ticks[i] - p.ticks[i - 1] >= Bomb.FAST - 1e-9);
  }
  // langes Beschleunigen erreicht das Höchsttempo
  const p = Bomb.plan([60, 60], () => 0);
  assert.ok(Math.abs(Bomb.interval(p, p.accelAt + p.ramp + 1) - Bomb.FAST) < 1e-9);
  assert.strictEqual(Bomb.interval(p, p.accelAt - 0.01), p.base);
});

test('Tempo verrät die Restzeit nicht: mal lange schnell, mal kaum beschleunigt', () => {
  const rnd = seeded(21);
  let fastLong = 0;
  let barely = 0;
  for (let k = 0; k < 400; k++) {
    const p = Bomb.plan(FUSES.normal, rnd);
    const lastGap = p.ticks[p.ticks.length - 1] - p.ticks[p.ticks.length - 2];
    const atTop = p.accelAt + p.ramp;
    if (atTop < p.fuse - 5) fastLong++; // über 5 s im Höchsttempo
    if (lastGap > p.base * 0.6) barely++; // am Ende noch fast im Grundtempo
  }
  assert.ok(fastLong > 20, 'manchmal lange schnell: ' + fastLong);
  assert.ok(barely > 20, 'manchmal kaum schneller: ' + barely);
});

test('Angezeigte Zündschnur: brennt stetig, nie ganz ab und unabhängig von der echten Zündzeit', () => {
  const rnd = seeded(2);
  for (let k = 0; k < 50; k++) {
    const p = Bomb.plan(FUSES.normal, rnd);
    let prev = 0;
    for (let t = 0; t <= 120; t += 0.25) {
      const b = Bomb.burned(p, t);
      assert.ok(b >= prev - 1e-12 && b < Bomb.MAX_BURN, `t=${t}: ${b}`);
      prev = b;
    }
  }
  const a = Bomb.plan([10, 10], () => 0.5);
  const b = Bomb.plan([80, 80], () => 0.5);
  assert.notStrictEqual(a.fuse, b.fuse);
  assert.strictEqual(Bomb.burned(a, 7), Bomb.burned(b, 7));
});

console.log('Wortbombe – Inhalte');

test('Mengen wie geplant: 200 Silben, 120 Anfänge/Enden, 300 Kategorien', () => {
  assert.ok(globalThis.WBSilben.length >= 200, 'Silben: ' + globalThis.WBSilben.length);
  const ae = globalThis.WBAnfangEnde;
  assert.ok(ae.anfang.length + ae.ende.length >= 120);
  const k = globalThis.WBKategorien;
  assert.ok(k.familie.length + k.ab18.length >= 300);
  assert.ok(ae.kette.length >= 30);
});

test('Inhalte: keine Doppelten, gültige Stufen, alle Stufen vorhanden', () => {
  const ae = globalThis.WBAnfangEnde;
  const k = globalThis.WBKategorien;
  const lists = { silben: globalThis.WBSilben, anfang: ae.anfang, ende: ae.ende, kategorien: k.familie.concat(k.ab18) };
  for (const [name, list] of Object.entries(lists)) {
    const seen = new Set();
    for (const [text, stufe] of list) {
      assert.ok(typeof text === 'string' && text.length > 0, name);
      assert.ok([1, 2, 3].includes(stufe), `${name}: ${text} hat Stufe ${stufe}`);
      const key = text.toLowerCase();
      assert.ok(!seen.has(key), `${name}: doppelt ${text}`);
      seen.add(key);
    }
    for (const s of [1, 2, 3]) assert.ok(list.some((e) => e[1] === s), `${name}: keine Stufe ${s}`);
  }
  for (const [text] of globalThis.WBSilben.concat(ae.anfang, ae.ende)) {
    assert.ok(/^[a-zäöü]+$/.test(text), 'nur Kleinbuchstaben: ' + text);
  }
  assert.strictEqual(new Set(ae.kette).size, ae.kette.length);
});

test('Stufen-Filter: leicht nur Stufe 1, mittel 1–2, schwer 2–3', () => {
  for (const mode of ['silbe', 'anfang', 'ende', 'kategorie']) {
    for (const level of ['leicht', 'mittel', 'schwer']) {
      const list = pool(mode, { level });
      assert.ok(list.length >= 10, `${mode}/${level}: nur ${list.length}`);
      for (const t of list) assert.ok(LEVEL_STUFEN[level].includes(t.stufe), `${mode}/${level}: ${t.text}`);
    }
  }
  assert.ok(pool('silbe', { level: 'leicht' }).every((t) => t.stufe === 1));
});

test('Ab-18-Filter: Ab-18-Kategorien nur mit Schalter', () => {
  const ab18 = new Set(globalThis.WBKategorien.ab18.map((e) => 'kat:' + e[0]));
  for (const level of ['leicht', 'mittel', 'schwer']) {
    assert.ok(pool('kategorie', { level }).every((t) => !ab18.has(t.key) && !t.adult));
    const withAdult = pool('kategorie', { level, adult: true });
    assert.ok(withAdult.some((t) => t.adult && ab18.has(t.key)), level);
  }
  // auch beim Ziehen im gemischten Modus nie ohne Schalter
  const rnd = seeded(4);
  for (let k = 0; k < 2000; k++) {
    const { task } = drawTask({ mode: 'mix', level: 'mittel' }, [], rnd);
    assert.ok(!ab18.has(task.key), task.key);
  }
});

test('Aufgaben: keine Wiederholung, bis der Topf leer ist', () => {
  const e = game({ mode: 'silbe', level: 'schwer' });
  const size = pool('silbe', { level: 'schwer' }).length;
  const seen = new Set([e.s.task.key]);
  for (let k = 1; k < size; k++) {
    assert.ok(e.skip());
    assert.ok(!seen.has(e.s.task.key), 'Wiederholung: ' + e.s.task.key);
    seen.add(e.s.task.key);
  }
  assert.strictEqual(seen.size, size);
  // Topf leer → beginnt von vorn
  let reset = false;
  e.hooks.onDraw = (t, r) => (reset = r);
  e.skip();
  assert.ok(reset);
  assert.ok(seen.has(e.s.task.key));
});

test('Aufgaben: keine Wiederholung über den Abend (hooks.used)', () => {
  const evening = pool('kette', {}).slice(0, 39).map((t) => t.key);
  const e = game({ mode: 'kette' }, { hooks: { used: () => evening } });
  assert.ok(!evening.includes(e.s.task.key));
  const last = pool('kette', {}).find((t) => !evening.includes(t.key));
  assert.strictEqual(e.s.task.key, last.key);
});

test('Gemischt: alle Modi kommen vor', () => {
  const rnd = seeded(9);
  const modes = new Set();
  for (let k = 0; k < 300; k++) modes.add(drawTask({ mode: 'mix' }, [], rnd).task.mode);
  assert.deepStrictEqual([...modes].sort(), ['anfang', 'ende', 'kategorie', 'kette', 'silbe']);
  const e = game({ mode: 'anfang' });
  for (let k = 0; k < 20; k++) {
    assert.strictEqual(e.s.task.mode, 'anfang');
    e.skip();
  }
});

console.log('Wortbombe – Spiel');

test('Einstellungen und Namen werden bereinigt', () => {
  const s = sanitizeSettings({ mode: 'quatsch', level: 'schwer', fuse: 'lang', out: 'x', names: false, adult: 1 });
  assert.deepStrictEqual(s, { mode: 'mix', level: 'schwer', fuse: 'lang', out: 'three', names: false, adult: true, drinks: false });
  assert.strictEqual(cleanName('  Anna   Lena  '), 'Anna Lena');
  assert.strictEqual(cleanName('x'.repeat(40)).length, 20);
  assert.throws(() => Engine.create({ settings: {}, players: ['Anna', ' '] }));
  const st = Engine.create({ settings: {}, players: Array.from({ length: 20 }, (_, i) => 'P' + i) }, { random: seeded(1) });
  assert.strictEqual(st.players.length, MAX_PLAYERS);
  assert.ok(MIN_PLAYERS === 2);
});

test('Weitergeben geht reihum im Uhrzeigersinn, nur mit Zünden', () => {
  const e = game({}, { n: 3 });
  assert.ok(!e.pass(), 'vor dem Zünden kein Weitergeben');
  const start = e.s.starter;
  e.ignite();
  assert.strictEqual(e.s.holder, start);
  e.pass();
  assert.strictEqual(e.s.holder, (start + 1) % 3);
  e.pass();
  e.pass();
  assert.strictEqual(e.s.holder, start);
  assert.strictEqual(e.s.passes, 3);
});

test('BUMM: wer die Bombe hält, bekommt den Strafpunkt; Verlierer beginnt die nächste Runde', () => {
  const e = game({}, { n: 3 });
  const start = e.s.starter;
  round(e, 4); // 4× weiter bei 3 Personen → Person nach dem Start
  const loser = (start + 1) % 3;
  assert.strictEqual(e.s.last.loser, loser);
  assert.strictEqual(e.s.players[loser].strikes, 1);
  assert.strictEqual(e.s.last.sips, SIPS);
  const task = e.s.task.key;
  e.next();
  assert.strictEqual(e.s.phase, 'ready');
  assert.strictEqual(e.s.round, 2);
  assert.strictEqual(e.s.starter, loser);
  assert.notStrictEqual(e.s.task.key, task);
});

test('Abbrechen gibt keinen Strafpunkt', () => {
  const e = game({});
  e.ignite();
  e.pass();
  assert.ok(e.abort());
  assert.strictEqual(e.s.phase, 'ready');
  assert.ok(e.s.players.every((p) => p.strikes === 0));
  assert.ok(!e.explode());
});

test('Strafpunkt umhängen (falsche Person) – auch beim Ausscheiden', () => {
  const e = game({}, { n: 3 });
  e.s.starter = 0;
  round(e, 0);
  assert.strictEqual(e.s.players[0].strikes, 1);
  assert.ok(e.blame(2));
  assert.strictEqual(e.s.players[0].strikes, 0);
  assert.strictEqual(e.s.players[2].strikes, 1);
  assert.strictEqual(e.s.last.loser, 2);
  assert.ok(!e.blame(2), 'dieselbe Person nochmal geht nicht');
  // Ausscheiden rückgängig machen
  e.s.players[1].strikes = 2;
  e.next();
  e.s.starter = 1;
  round(e, 0);
  assert.ok(e.s.players[1].out);
  assert.strictEqual(e.s.last.sips, SIPS_OUT);
  assert.ok(e.blame(0));
  assert.ok(!e.s.players[1].out);
  assert.strictEqual(e.s.players[1].strikes, 2);
  assert.strictEqual(e.s.players[0].strikes, 1);
  assert.strictEqual(e.s.last.sips, SIPS);
});

test('Ausscheiden nach 3 Strafpunkten, Ausgeschiedene werden übersprungen, letzte Person gewinnt', () => {
  const e = game({ out: 'three' }, { n: 3 });
  e.s.starter = 1;
  for (let k = 0; k < STRIKES_OUT; k++) {
    round(e, 0); // Ben verliert immer (Verlierer beginnt)
    if (k < STRIKES_OUT - 1) e.next();
  }
  assert.ok(e.s.players[1].out);
  assert.strictEqual(e.s.last.out, true);
  e.next();
  assert.strictEqual(e.s.starter, 2, 'nach Ben kommt Cem');
  e.ignite();
  e.pass();
  assert.strictEqual(e.s.holder, 0, 'Ben wird übersprungen');
  e.pass();
  assert.strictEqual(e.s.holder, 2);
  e.explode();
  // Cem verliert noch 2×
  e.next();
  round(e, 0);
  e.next();
  round(e, 0);
  assert.ok(e.s.players[2].out);
  assert.ok(e.isOver());
  e.next();
  assert.strictEqual(e.s.phase, 'end');
  const r = e.ranking();
  assert.deepStrictEqual(
    r.map((x) => [x.name, x.place]),
    [
      ['Anna', 1],
      ['Cem', 2],
      ['Ben', 3],
    ]
  );
  assert.deepStrictEqual(
    e.winners().map((w) => w.name),
    ['Anna']
  );
});

test('Ohne Ausscheiden: 10 Runden, wenigste Strafpunkte gewinnen, Gleichstand teilt den Platz', () => {
  const e = game({ out: 'rounds' }, { n: 4, players: NAMES.slice(0, 4) });
  const losers = [0, 0, 0, 1, 1, 1, 2, 2, 0, 1]; // Anna 4, Ben 4, Cem 2, Dora 0
  losers.forEach((l, k) => {
    e.s.starter = l;
    round(e, 0);
    assert.strictEqual(e.s.last.out, false);
    assert.strictEqual(e.s.phase, 'boom');
    e.next();
    if (k < ROUNDS - 1) assert.strictEqual(e.s.phase, 'ready');
  });
  assert.strictEqual(e.s.phase, 'end');
  assert.strictEqual(e.s.round, ROUNDS);
  assert.ok(e.s.players.every((p) => !p.out));
  assert.deepStrictEqual(
    e.ranking().map((x) => [x.name, x.place]),
    [
      ['Dora', 1],
      ['Cem', 2],
      ['Anna', 3],
      ['Ben', 3],
    ]
  );
});

test('Ohne Namen: nur Runden zählen, endlos', () => {
  const e = game({ names: false }, { players: [] });
  assert.strictEqual(e.s.players.length, 0);
  assert.strictEqual(e.s.starter, null);
  for (let k = 0; k < 15; k++) {
    round(e, 3);
    assert.strictEqual(e.s.last.loser, null);
    assert.strictEqual(e.s.last.passes, 3);
    assert.ok(!e.blame(0));
    e.next();
  }
  assert.strictEqual(e.s.phase, 'ready');
  assert.strictEqual(e.s.round, 16);
});

test('Revanche: gleiche Leute und Einstellungen, alles auf null', () => {
  const e = game({ out: 'rounds', level: 'schwer' }, { n: 3 });
  round(e, 1);
  e.next();
  const s = Engine.rematch(e.s, { random: seeded(2) });
  assert.deepStrictEqual(
    s.players.map((p) => p.name),
    NAMES.slice(0, 3)
  );
  assert.ok(s.players.every((p) => p.strikes === 0));
  assert.strictEqual(s.settings.level, 'schwer');
  assert.strictEqual(s.round, 1);
});

test('Zustand bleibt JSON-tauglich (Fortsetzen nach Neuladen)', () => {
  const e = game({}, { n: 4, players: NAMES.slice(0, 4) });
  round(e, 2);
  const copy = new Engine(JSON.parse(JSON.stringify(e.s)), { random: seeded(1) });
  assert.deepStrictEqual(copy.s, e.s);
  assert.ok(copy.next());
});

console.log(`\nWortbombe: ${passed} Tests bestanden.`);
