'use strict';
/* Tests für „Pointe!“ (ohne Browser): node tests/pointe.test.js */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
const ROOT = path.join(__dirname, '..');
for (const f of ['alltag', 'popkultur', 'waswaere', 'namen', 'arbeit', 'adult', 'finale']) require(path.join(ROOT, 'pointe', 'js', 'satzanfaenge', f + '.js'));
for (const f of ['prompts', 'pairing', 'engine']) require(path.join(ROOT, 'pointe', 'js', f + '.js'));
const P = globalThis.PointePrompts;
const Pair = globalThis.PointePairing;
const { Engine, STAGE, GRACE_MS, READ_MS, FINAL_VOTES, sanitizeSettings, roundPlan, audienceWeight } = globalThis.PointeEngine;

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

/** Spiel mit Handys: Lobby, Leute verbinden, starten. Ohne Sprachausgabe startet die Abstimmung sofort. */
function game(pids, settings, opts) {
  const o = opts || {};
  const now = o.now || clock();
  const state = Engine.create({ settings: Object.assign({ speech: false }, settings) });
  const e = new Engine(state, { timers: false, now, random: o.random || seeded(7) });
  for (const pid of pids) e.connect(pid, pid.toUpperCase());
  for (const pid of o.audience || []) {
    e.connect(pid, pid.toUpperCase());
    assert.ok(e.apply({ type: 'watch', watch: true }, pid), 'Publikum ' + pid);
  }
  assert.ok(e.apply({ type: 'start' }, STAGE), 'start');
  e.clock = now;
  return e;
}

function duels(e) {
  return e.cur().duels;
}

/** Alle schreiben „<pid>-<duell>“ (texts: pid -> Text-Funktion oder null = nichts schreiben) */
function writeAll(e, texts) {
  for (const d of duels(e)) {
    for (const pid of [d.a, d.b]) {
      const t = texts && pid in texts ? texts[pid] : `${pid} zu ${d.id}`;
      if (t === null) continue;
      e.apply({ type: 'answer', target: d.id, parts: [typeof t === 'function' ? t(d) : t] }, pid);
    }
  }
}

/** Zeit fürs Schreiben ablaufen lassen */
function timeUp(e) {
  e.clock.add(e.s.settings.writeTime * 1000 + GRACE_MS + 1);
  assert.ok(e.tick());
}

/** Alle außer den beiden im Duell stimmen für side ('a' / 'b' – Duell-Seite, nicht links/rechts) */
function voteAll(e, side, except) {
  const d = e.duel();
  for (const pid of Object.keys(e.s.members)) {
    if (pid === d.a || pid === d.b || (except || []).includes(pid) || e.s.phase !== 'duel') continue;
    e.apply({ type: 'vote', duel: d.id, pick: typeof side === 'function' ? side(pid) : side }, pid);
  }
}

function sideOf(res, pid) {
  return res.sides.find((x) => x.pid === pid);
}

/** Runde mit Duellen komplett durchspielen (alle schreiben, alle stimmen für a) */
function playDuelRound(e, pick) {
  writeAll(e);
  assert.strictEqual(e.s.phase, 'duel');
  while (e.s.phase === 'duel' || e.s.phase === 'result') {
    if (e.s.phase === 'duel') voteAll(e, pick || 'a');
    assert.strictEqual(e.s.phase, 'result');
    assert.ok(e.apply({ type: 'next' }, STAGE));
  }
}

/* ---------- Inhalt ---------- */

console.log('Satzanfänge');

test('mindestens 600 Satzanfänge, alle Zeilen gültig, keine doppelten', () => {
  const st = P.stats();
  assert.ok(st.total >= 600, 'nur ' + st.total);
  for (const [cat, text] of Object.entries(globalThis.PT_SATZ)) {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const parsed = P.parseList(text, cat);
    parsed.forEach((p, i) => assert.ok(p, `${cat}: ungültige Zeile „${lines[i]}“`));
  }
  const ids = P.list().map((p) => p.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'doppelte Satzanfänge');
  const texts = P.list().map((p) => P.slug(p.text));
  assert.strictEqual(new Set(texts).size, texts.length, 'doppelter Text');
});

test('Kategorien haben ihre Zielgröße ungefähr erreicht', () => {
  const st = P.stats();
  const goal = { alltag: 150, popkultur: 100, waswaere: 100, namen: 80, arbeit: 70, adult: 100, finale: 60 };
  for (const [cat, n] of Object.entries(goal)) assert.ok(st[cat] >= n, `${cat}: ${st[cat]} < ${n}`);
});

test('genau eine Lücke (Finale 1–3) und mindestens 2 passende Rettungen', () => {
  for (const p of P.list()) {
    assert.strictEqual(P.countBlanks(p.text), p.blanks);
    if (p.cat === P.FINALE) assert.ok(p.blanks >= 1 && p.blanks <= 3, p.text);
    else assert.strictEqual(p.blanks, 1, p.text);
    assert.ok(p.rescues.length >= 2, p.text);
    for (const r of p.rescues) {
      assert.strictEqual(r.length, p.blanks, p.text);
      for (const part of r) assert.ok(part.length <= 80, part);
    }
  }
  assert.ok(P.all().finale.some((p) => p.blanks === 3), 'Finale mit drei Feldern');
  assert.ok(P.all().finale.some((p) => /^Erfinde ein Wort/.test(p.text)), 'Finale „Erfinde ein Wort“');
});

test('Zeilen-Format: Markierungen, kaputte Zeilen', () => {
  const p = P.parseLine('{fam:0} Was ___ macht | A; B', 'alltag');
  assert.strictEqual(p.family, false);
  assert.strictEqual(p.adult, false);
  assert.deepStrictEqual(p.rescues, [['A'], ['B']]);
  assert.strictEqual(P.parseLine('Ohne Lücke | A; B', 'alltag'), null);
  assert.strictEqual(P.parseLine('Zwei ___ Lücken ___ | A; B', 'alltag'), null);
  assert.strictEqual(P.parseLine('Nur eine Rettung ___ | A', 'alltag'), null);
  assert.strictEqual(P.parseLine('Kaputte ____ Lücke | A; B', 'alltag'), null);
  const f = P.parseLine('{18} Drei: ___, ___, ___ | a / b / c; d / e / f; nur / zwei', 'finale');
  assert.strictEqual(f.adult, true);
  assert.strictEqual(f.blanks, 3);
  assert.strictEqual(f.rescues.length, 2, 'Rettung mit falscher Teilezahl fällt weg');
});

test('Filter: Ab 18 nur wenn gewählt, Familienrunde ohne Zweideutiges, Namen nur wenn an', () => {
  const pool = P.pool({ categories: P.DEFAULT_CATEGORIES }, 'duel');
  assert.ok(pool.length > 400);
  assert.ok(!pool.some((p) => p.adult), 'kein Ab 18');
  assert.ok(!pool.some((p) => p.names), 'keine Namen');
  assert.ok(pool.some((p) => !p.family), 'zweideutige sind im Standard dabei');
  const fam = P.pool({ categories: P.CATEGORY_IDS, family: true }, 'duel');
  assert.ok(!fam.some((p) => !p.family || p.adult));
  const adult = P.pool({ categories: ['adult'] }, 'duel');
  assert.ok(adult.length >= 100 && adult.every((p) => p.cat === 'adult'));
  assert.ok(P.pool({ categories: ['adult'], family: true }, 'duel').every((p) => !p.adult), 'Familie schlägt Ab 18');
  const names = P.pool({ categories: P.DEFAULT_CATEGORIES, names: true }, 'duel');
  assert.ok(names.some((p) => p.names));
  assert.ok(!P.pool({}, 'final').some((p) => p.adult), 'Finale: Ab 18 nur mit der Kategorie');
  assert.ok(P.pool({ categories: ['alltag', 'adult'] }, 'final').some((p) => p.adult));
});

test('Namen einsetzen (auch im Genitiv und in den Rettungen)', () => {
  assert.strictEqual(P.genitive('Anna'), 'Annas');
  assert.strictEqual(P.genitive('Klaus'), 'Klaus’');
  const p = P.parseLine('Was {Spieler} macht, wenn {Spielers} Hund bellt: ___ | {Spieler} schläft; Nichts', 'alltag');
  const q = P.prepare(p, ['Lena'], () => 0);
  assert.strictEqual(q.text, 'Was Lena macht, wenn Lenas Hund bellt: ___');
  assert.deepStrictEqual(q.rescues[0], ['Lena schläft']);
  assert.strictEqual(q.name, 'Lena');
});

test('Ziehen ohne Wiederholung im Spiel', () => {
  const pool = P.pool({}, 'duel');
  const used = [];
  const a = P.draw(pool, 30, used, seeded(1));
  const b = P.draw(pool, 30, used, seeded(2));
  const ids = a.concat(b).map((p) => p.id);
  assert.strictEqual(new Set(ids).size, 60);
  assert.strictEqual(used.length, 60);
  const small = P.draw(pool.slice(0, 3), 5, [], seeded(3));
  assert.strictEqual(small.length, 3, 'mehr gibt es nicht');
});

test('Vorlesen: Lücke am Ende fällt weg, in der Mitte „Dingsbums“', () => {
  assert.strictEqual(P.speakable('Der schlechteste Name für ein Kreuzfahrtschiff: ___'), 'Der schlechteste Name für ein Kreuzfahrtschiff');
  assert.strictEqual(P.speakable('Drei Dinge: ___, ___, ___'), 'Drei Dinge: Dingsbums, Dingsbums');
});

/* ---------- Verteilung ---------- */

console.log('Duelle verteilen');

test('3–10 Personen: jede/r genau 2 Duelle, nie gegen sich selbst, 2 verschiedene Gegner', () => {
  for (let n = 3; n <= 10; n++) {
    for (let seed = 1; seed <= 20; seed++) {
      const pids = Array.from({ length: n }, (_, i) => 'p' + i);
      const list = Pair.duels(pids, seeded(seed));
      assert.strictEqual(list.length, n, `${n} Personen → ${n} Duelle`);
      const sum = Pair.summary(list);
      for (const pid of pids) {
        assert.strictEqual(sum[pid].duels, 2, `${n}: ${pid}`);
        assert.ok(!sum[pid].opponents.includes(pid), 'gegen sich selbst');
        assert.notStrictEqual(sum[pid].opponents[0], sum[pid].opponents[1], `${n}: zweimal derselbe Gegner`);
      }
      const keys = list.map((d) => Pair.pairKey(d.a, d.b));
      assert.strictEqual(new Set(keys).size, n, 'kein Paar doppelt');
    }
  }
});

test('Runde 2: möglichst andere Paare als in Runde 1', () => {
  const pids = Array.from({ length: 8 }, (_, i) => 'p' + i);
  const r1 = Pair.duels(pids, seeded(4));
  const avoid = r1.map((d) => Pair.pairKey(d.a, d.b));
  const r2 = Pair.duels(pids, seeded(5), avoid);
  const overlap = r2.filter((d) => avoid.includes(Pair.pairKey(d.a, d.b))).length;
  assert.strictEqual(overlap, 0);
});

/* ---------- Einstellungen ---------- */

console.log('Einstellungen & Lobby');

test('Einstellungen werden geprüft, Rundenfolge', () => {
  const s = sanitizeSettings({ rounds: 7, writeTime: 61, voteTime: 20, categories: ['quatsch'], speech: 'ja', drinks: true });
  assert.strictEqual(s.rounds, 2);
  assert.strictEqual(s.writeTime, 90);
  assert.strictEqual(s.voteTime, 20);
  assert.deepStrictEqual(s.categories, P.DEFAULT_CATEGORIES);
  assert.strictEqual(s.speech, true);
  assert.strictEqual(s.drinks, true);
  assert.deepStrictEqual(roundPlan({ rounds: 2 }), ['duels', 'duels', 'final']);
  assert.deepStrictEqual(roundPlan({ rounds: 3 }), ['duels', 'duels', 'duels', 'final']);
  assert.deepStrictEqual(roundPlan({ rounds: 0 }), ['final', 'final', 'final']);
});

test('Lobby: mindestens 3 Schreibende, ab 11 Personen Publikum, Publikum freiwillig', () => {
  const state = Engine.create({ settings: {} });
  const e = new Engine(state, { timers: false, now: clock() });
  e.connect('a', 'A');
  e.connect('b', 'B');
  assert.ok(e.lobbyProblem());
  assert.ok(!e.apply({ type: 'start' }, STAGE));
  for (let i = 0; i < 10; i++) e.connect('x' + i, 'X' + i);
  assert.strictEqual(e.s.players.length, 10);
  assert.strictEqual(e.viewFor('x9').me.audience, true, 'die 11. Person ist Publikum');
  assert.ok(e.apply({ type: 'watch', watch: true }, 'a'));
  assert.strictEqual(e.s.players.length, 9);
  assert.ok(e.apply({ type: 'watch', watch: false }, 'x9'));
  assert.ok(!e.apply({ type: 'watch', watch: false }, 'a'), 'voll');
  assert.ok(!e.apply({ type: 'settings', settings: { rounds: 3 } }, 'b'), 'nur der Laptop');
  assert.ok(e.apply({ type: 'settings', settings: { rounds: 3 } }, STAGE));
  assert.ok(e.apply({ type: 'start' }, STAGE));
  assert.strictEqual(e.s.phase, 'write');
  assert.strictEqual(duels(e).length, 10);
});

/* ---------- Schreiben ---------- */

console.log('Schreiben');

test('Jede/r bekommt die eigenen zwei Satzanfänge – fremde sieht niemand, die Bühne keine', () => {
  const e = game(['a', 'b', 'c', 'd']);
  for (const pid of ['a', 'b', 'c', 'd']) {
    const w = e.viewFor(pid).write;
    assert.strictEqual(w.mine.length, 2);
    const ids = w.mine.map((m) => m.target);
    for (const d of duels(e)) assert.strictEqual(ids.includes(d.id), d.a === pid || d.b === pid);
    assert.ok(!JSON.stringify(e.viewFor(pid)).includes(duels(e).find((d) => d.a !== pid && d.b !== pid).prompt.text), 'fremder Satzanfang sichtbar');
  }
  const stage = e.viewFor(STAGE);
  assert.strictEqual(stage.write.mine.length, 0);
  for (const d of duels(e)) assert.ok(!JSON.stringify(stage).includes(d.prompt.text), 'Bühne sieht Satzanfang');
  assert.strictEqual(stage.write.progress.length, 4);
});

test('Die beiden im Duell bekommen die Rettungen in anderer Reihenfolge', () => {
  const e = game(['a', 'b', 'c']);
  const d = duels(e)[0];
  const ra = e.viewFor(d.a).write.mine.find((m) => m.target === d.id).rescues;
  const rb = e.viewFor(d.b).write.mine.find((m) => m.target === d.id).rescues;
  assert.notDeepStrictEqual(ra[0], rb[0]);
});

test('Antworten: nur für eigene Duelle, Länge begrenzt, ändern und leeren geht', () => {
  const e = game(['a', 'b', 'c']);
  const d = duels(e).find((x) => x.a === 'a' || x.b === 'a');
  const other = duels(e).find((x) => x.a !== 'a' && x.b !== 'a');
  assert.ok(!e.apply({ type: 'answer', target: other.id, parts: ['x'] }, 'a'), 'fremdes Duell');
  assert.ok(e.apply({ type: 'answer', target: d.id, parts: ['  Hallo   Welt ' + 'x'.repeat(200)] }, 'a'));
  assert.strictEqual(d.answers.a.parts[0].length, 80);
  assert.ok(d.answers.a.parts[0].startsWith('Hallo Welt x'));
  assert.ok(!e.apply({ type: 'answer', target: d.id, parts: [d.answers.a.parts[0]] }, 'a'), 'unverändert');
  assert.ok(e.apply({ type: 'answer', target: d.id, text: 'Neu' }, 'a'));
  assert.ok(e.apply({ type: 'answer', target: d.id, parts: ['  '] }, 'a'));
  assert.ok(!d.answers.a);
});

test('Rettung wird erkannt (auch nachträglich getippt), geänderte Rettung zählt normal', () => {
  const e = game(['a', 'b', 'c']);
  const d = duels(e)[0];
  const r = d.prompt.rescues[1][0];
  e.apply({ type: 'answer', target: d.id, parts: [r.toUpperCase()] }, d.a);
  assert.strictEqual(d.answers[d.a].rescue, true);
  e.apply({ type: 'answer', target: d.id, parts: [r + ' und mehr'] }, d.a);
  assert.strictEqual(d.answers[d.a].rescue, false);
});

test('Alle fertig → Duelle beginnen sofort; sonst nach Ablauf der Zeit (+ kurze Gnadenfrist)', () => {
  const e = game(['a', 'b', 'c']);
  writeAll(e);
  assert.strictEqual(e.s.phase, 'duel');
  assert.strictEqual(e.s.current, 0);
  const f = game(['a', 'b', 'c']);
  writeAll(f, { c: null });
  assert.strictEqual(f.s.phase, 'write');
  f.clock.add(f.s.settings.writeTime * 1000 + 10);
  assert.ok(!f.tick(), 'Gnadenfrist');
  const late = duels(f).find((d) => d.a === 'c' || d.b === 'c');
  assert.ok(f.apply({ type: 'answer', target: late.id, parts: ['spät, aber da'] }, 'c'), 'Gnadenfrist: kommt noch an');
  f.clock.add(GRACE_MS);
  assert.ok(f.tick());
  assert.notStrictEqual(f.s.phase, 'write');
  const empty = duels(f).find((d) => d !== late && (d.a === 'c' || d.b === 'c'));
  assert.strictEqual(f.duelResult(empty, 1).forfeit, empty.a === 'c' ? 'a' : 'b', 'leer → kampflos');
});

test('Laptop / Spielleitung kann das Schreiben beenden', () => {
  const e = game(['a', 'b', 'c']);
  assert.ok(!e.apply({ type: 'next' }, STAGE), 'ohne force nicht');
  assert.ok(!e.apply({ type: 'next', force: true }, 'b'), 'nicht die Spielleitung');
  assert.ok(e.apply({ type: 'next', force: true }, 'a'), 'Spielleitung = erstes Handy');
  assert.notStrictEqual(e.s.phase, 'write');
});

/* ---------- Duelle ---------- */

console.log('Duelle & Punkte');

test('Abstimmung: anonym bis zur Auflösung, Seiten gemischt', () => {
  const pids = ['anna', 'ben', 'cem', 'dora', 'emil'];
  const e = game(pids);
  writeAll(e, Object.fromEntries(pids.map((p) => [p, (d) => 'Witz ' + d.id])));
  const d = e.duel();
  for (const pid of pids.concat(STAGE)) {
    const v = e.viewFor(pid).duel;
    assert.strictEqual(v.sides.length, 2);
    for (const x of v.sides) {
      assert.ok(!('pid' in x) && !('name' in x) && !('pct' in x) && !('voters' in x), 'Autor vor der Auflösung');
      assert.strictEqual(x.parts[0], 'Witz ' + d.id);
    }
    const json = JSON.stringify(v);
    for (const author of [d.a, d.b]) assert.ok(!json.includes(author), `Spieler ${author} in der Duell-Ansicht von ${pid}`);
  }
  assert.strictEqual(e.viewFor(d.a).duel.role, 'duelist');
  const voter = pids.find((p) => p !== d.a && p !== d.b);
  assert.strictEqual(e.viewFor(voter).duel.role, 'voter');
  const flips = new Set(duels(e).map((x) => x.flip));
  assert.strictEqual(flips.size, 2, 'links/rechts gemischt');
});

test('Nicht im eigenen Duell abstimmen, umentscheiden geht, alle abgestimmt → Auflösung', () => {
  const e = game(['a', 'b', 'c', 'd']);
  writeAll(e);
  const d = e.duel();
  const voters = ['a', 'b', 'c', 'd'].filter((p) => p !== d.a && p !== d.b);
  assert.ok(!e.apply({ type: 'vote', duel: d.id, pick: 'b' }, d.a), 'eigenes Duell');
  assert.ok(!e.apply({ type: 'vote', duel: d.id, pick: 'b' }, STAGE), 'Laptop stimmt nicht');
  assert.ok(!e.apply({ type: 'vote', duel: 'quatsch', pick: 'b' }, voters[0]));
  assert.ok(e.apply({ type: 'vote', duel: d.id, pick: 'b' }, voters[0]));
  assert.ok(e.apply({ type: 'vote', duel: d.id, pick: 'a' }, voters[0]), 'umentscheiden');
  assert.ok(!e.apply({ type: 'vote', duel: d.id, pick: 'a' }, voters[0]), 'gleiche Stimme');
  assert.strictEqual(e.viewFor(STAGE).duel.voted, 1);
  assert.strictEqual(e.viewFor(voters[0]).duel.myPick, 'a');
  assert.ok(e.apply({ type: 'vote', duel: d.id, pick: 'a' }, voters[1]));
  assert.strictEqual(e.s.phase, 'result');
  const v = e.viewFor(STAGE).duel;
  const a = v.sides.find((x) => x.key === 'a');
  assert.strictEqual(a.name, d.a.toUpperCase());
  assert.strictEqual(a.pct, 100);
  assert.strictEqual(a.voters.length, 2);
});

test('Punkte: 10 pro Prozent, +100 Sieg, +250 Pointe! – Runde 2 doppelt, Runde 3 dreifach', () => {
  const e = game(['a', 'b', 'c', 'd', 'e', 'f'], { rounds: 3 });
  writeAll(e);
  let d = e.duel();
  const vs = Object.keys(e.s.members).filter((p) => p !== d.a && p !== d.b);
  // 3 zu 1: 75 % / 25 %
  vs.forEach((p, i) => e.apply({ type: 'vote', duel: d.id, pick: i < 3 ? 'a' : 'b' }, p));
  let res = e.duelResult(d, 1);
  assert.strictEqual(sideOf(res, d.a).points, 750 + 100);
  assert.strictEqual(sideOf(res, d.b).points, 250);
  // Pointe!
  e.apply({ type: 'next' }, STAGE);
  d = e.duel();
  voteAll(e, 'b');
  res = e.duelResult(d, 1);
  assert.strictEqual(sideOf(res, d.b).points, 1000 + 100 + 250);
  assert.strictEqual(sideOf(res, d.b).pointe, true);
  assert.strictEqual(sideOf(res, d.a).points, 0);
  // Gleichstand: kein Sieg
  e.apply({ type: 'next' }, STAGE);
  d = e.duel();
  const v3 = Object.keys(e.s.members).filter((p) => p !== d.a && p !== d.b);
  v3.forEach((p, i) => e.apply({ type: 'vote', duel: d.id, pick: i % 2 ? 'a' : 'b' }, p));
  res = e.duelResult(d, 1);
  assert.strictEqual(sideOf(res, d.a).points, 500);
  assert.strictEqual(sideOf(res, d.b).points, 500);
  // Multiplikatoren
  assert.strictEqual(sideOf(e.duelResult(d, 2), d.a).points, 1000);
  const pointeDuel = duels(e)[1];
  assert.strictEqual(sideOf(e.duelResult(pointeDuel, 2), pointeDuel.b).points, 2 * 1350);
  assert.strictEqual(sideOf(e.duelResult(pointeDuel, 3), pointeDuel.b).points, 3 * 1350);
});

test('Runde 2 zählt doppelt (über das ganze Spiel gerechnet)', () => {
  const e = game(['a', 'b', 'c']);
  playDuelRound(e, 'a');
  assert.strictEqual(e.s.phase, 'scores');
  const after1 = e.totals();
  // 3 Personen: eine Stimme pro Duell → jede/r gewinnt ein Duell mit Pointe!, verliert eins
  for (const pid of ['a', 'b', 'c']) assert.strictEqual(after1[pid], 1350);
  assert.deepStrictEqual(e.viewFor(STAGE).gains, after1);
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.strictEqual(e.cur().mult, 2);
  playDuelRound(e, 'a');
  const after2 = e.totals();
  for (const pid of ['a', 'b', 'c']) assert.strictEqual(after2[pid], 1350 * 3);
  assert.strictEqual(e.s.phase, 'scores');
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.strictEqual(e.s.phase, 'final-write');
});

test('Leere Antwort verliert kampflos (ohne Abstimmung), beide leer = keine Punkte', () => {
  const e = game(['a', 'b', 'c']);
  const d0 = duels(e)[0];
  writeAll(e, { [d0.b]: (d) => (d.id === d0.id ? '' : `${d0.b} zu ${d.id}`) });
  timeUp(e);
  assert.strictEqual(e.s.phase, 'result');
  const res = e.duelResult(d0, 1);
  assert.strictEqual(res.forfeit, 'b');
  assert.strictEqual(sideOf(res, d0.a).points, 1000 + 100);
  assert.strictEqual(sideOf(res, d0.a).pointe, false);
  assert.strictEqual(sideOf(res, d0.b).points, 0);
  const v = e.viewFor(STAGE).duel;
  assert.strictEqual(v.forfeit, 'b');
  const g = game(['a', 'b', 'c']);
  timeUp(g);
  const r0 = g.duelResult(duels(g)[0], 1);
  assert.strictEqual(r0.forfeit, 'both');
  assert.ok(r0.sides.every((x) => x.points === 0));
});

test('Rettung halbiert die Punkte', () => {
  const e = game(['a', 'b', 'c']);
  writeAll(e, Object.fromEntries(['a', 'b', 'c'].map((p) => [p, (d) => (d.a === p ? d.prompt.rescues[0][0] : `${p} zu ${d.id}`)])));
  const d = e.duel();
  voteAll(e, 'a');
  const res = e.duelResult(d, 1);
  assert.strictEqual(sideOf(res, d.a).rescue, true);
  assert.strictEqual(sideOf(res, d.a).points, Math.round(1350 / 2));
  assert.strictEqual(e.viewFor(STAGE).duel.sides.find((x) => x.key === 'a').rescue, true);
});

test('Publikum zählt zusammen als 20 % der Stimmen', () => {
  assert.strictEqual(audienceWeight(4, 10), 1);
  assert.strictEqual(audienceWeight(0, 3), 3);
  assert.strictEqual(audienceWeight(4, 0), 0);
  const e = game(['a', 'b', 'c', 'd', 'e', 'f'], {}, { audience: ['z1', 'z2', 'z3', 'z4', 'z5'] });
  writeAll(e);
  const d = e.duel();
  const players = ['a', 'b', 'c', 'd', 'e', 'f'].filter((p) => p !== d.a && p !== d.b);
  // 4 Mitspielende für a, das ganze Publikum für b → b hat genau 20 %
  for (const p of players) e.apply({ type: 'vote', duel: d.id, pick: 'a' }, p);
  assert.strictEqual(e.s.phase, 'duel', 'Publikum fehlt noch');
  for (const z of ['z1', 'z2', 'z3', 'z4', 'z5']) e.apply({ type: 'vote', duel: d.id, pick: 'b' }, z);
  assert.strictEqual(e.s.phase, 'result');
  const res = e.duelResult(d, 1);
  assert.strictEqual(Math.round(sideOf(res, d.b).pct), 20);
  assert.strictEqual(Math.round(sideOf(res, d.a).pct), 80);
  assert.strictEqual(sideOf(res, d.a).pointe, false, 'Publikum hat dagegen gestimmt');
  assert.strictEqual(sideOf(res, d.b).aud, 5);
  assert.strictEqual(e.viewFor('z1').me.audience, true);
});

test('Publikum aus: Zuschauende stimmen nicht ab', () => {
  const e = game(['a', 'b', 'c'], { audience: false }, { audience: ['z'] });
  writeAll(e);
  const d = e.duel();
  assert.ok(!e.apply({ type: 'vote', duel: d.id, pick: 'a' }, 'z'));
  assert.strictEqual(e.viewFor('z').duel.role, 'watch');
});

test('Mit Sprachausgabe: Abstimmung schon während des Vorlesens, Zeit läuft erst danach', () => {
  const e = game(['a', 'b', 'c', 'd'], { speech: true });
  writeAll(e);
  const d = e.duel();
  assert.ok(e.s.readEnd && !e.s.voteEnd);
  assert.strictEqual(e.viewFor(STAGE).timer, null);
  assert.strictEqual(e.viewFor(STAGE).reading, true);
  voteAll(e, 'a');
  assert.strictEqual(e.s.phase, 'duel', 'erst fertig vorlesen');
  assert.ok(!e.apply({ type: 'read', target: d.id }, 'a'), 'nur der Laptop');
  assert.ok(e.apply({ type: 'read', target: d.id }, STAGE));
  assert.strictEqual(e.s.phase, 'result', 'alle hatten schon abgestimmt');
  // Laptop meldet sich nicht: spätestens nach READ_MS läuft die Zeit
  e.apply({ type: 'next' }, STAGE);
  assert.ok(e.s.readEnd);
  e.clock.add(READ_MS + 1);
  assert.ok(e.tick());
  assert.ok(e.s.voteEnd && !e.s.readEnd);
  e.clock.add(e.s.settings.voteTime * 1000 + 1);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'result');
});

test('🙈 Ausblenden: Duell zählt für den Gegner, nur Laptop/Spielleitung, wieder zeigen geht', () => {
  const e = game(['a', 'b', 'c', 'd']);
  writeAll(e);
  let d = e.duel();
  // Spielleitung ist a – im eigenen Duell darf sie nicht
  if (d.a === 'a' || d.b === 'a') {
    assert.ok(!e.apply({ type: 'hide', target: d.id, key: 'a' }, 'a'));
    voteAll(e, 'a');
    e.apply({ type: 'next' }, STAGE);
    d = e.duel();
  }
  assert.ok(!e.apply({ type: 'hide', target: d.id, key: 'a' }, 'b') || e.leadPid() === 'b');
  assert.ok(e.apply({ type: 'hide', target: d.id, key: 'b' }, STAGE));
  assert.strictEqual(e.s.phase, 'result', 'sofort kampflos');
  let res = e.duelResult(d, 1);
  assert.strictEqual(res.forfeit, 'b');
  assert.strictEqual(sideOf(res, d.a).points, 1100);
  const v = e.viewFor(STAGE).duel.sides.find((x) => x.key === 'b');
  assert.strictEqual(v.parts, null, 'Text ausgeblendet');
  assert.strictEqual(e.viewFor(d.b).duel.sides.find((x) => x.key === 'b').parts[0], `${d.b} zu ${d.id}`, 'Autor sieht den eigenen Text');
  assert.ok(e.apply({ type: 'hide', target: d.id, key: 'b', hidden: false }, STAGE));
  res = e.duelResult(d, 1);
  assert.strictEqual(res.forfeit, null);
});

test('Punktestand zählt erst nach der Auflösung', () => {
  const e = game(['a', 'b', 'c', 'd']);
  writeAll(e);
  voteAll(e, 'a');
  const before = e.totals();
  assert.ok(Object.values(before).some((n) => n > 0));
  e.apply({ type: 'next' }, STAGE);
  const d2 = e.duel();
  const voter = Object.keys(e.s.members).find((p) => p !== d2.a && p !== d2.b);
  assert.ok(e.apply({ type: 'vote', duel: d2.id, pick: 'a' }, voter));
  assert.strictEqual(e.s.phase, 'duel', 'eine Stimme fehlt noch');
  assert.deepStrictEqual(e.totals(), before, 'laufendes Duell zählt noch nicht');
  const score = (pid) => e.viewFor(STAGE).players.find((p) => p.id === pid).score;
  assert.strictEqual(score(d2.a), before[d2.a]);
});

test('Weiter-Klick aus einem alten Schritt wird ignoriert', () => {
  const e = game(['a', 'b', 'c']);
  writeAll(e);
  voteAll(e, 'a');
  const step = e.viewFor(STAGE).step;
  assert.ok(e.apply({ type: 'next', step }, STAGE));
  assert.ok(!e.apply({ type: 'next', step }, STAGE), 'doppelter Klick');
});

/* ---------- Letzte Pointe ---------- */

console.log('Letzte Pointe');

function toFinal(e) {
  while (e.s.phase !== 'final-write') {
    if (e.s.phase === 'write') writeAll(e);
    else if (e.s.phase === 'duel') voteAll(e, 'a');
    else assert.ok(e.apply({ type: 'next' }, STAGE), 'weiter in ' + e.s.phase);
  }
  return e.final();
}

function writeFinal(e, except) {
  const f = e.final();
  for (const pid of f.pids) if (!(except || []).includes(pid)) e.apply({ type: 'answer', target: f.id, parts: Array.from({ length: f.prompt.blanks }, (_, i) => `${pid}${i}`) }, pid);
}

function keyOf(f, pid) {
  return String(f.order.indexOf(pid));
}

test('Alle bekommen denselben Satzanfang, den auch die Bühne zeigt', () => {
  const e = game(['a', 'b', 'c', 'd']);
  const f = toFinal(e);
  assert.deepStrictEqual(f.pids.slice().sort(), ['a', 'b', 'c', 'd']);
  for (const pid of ['a', 'b', 'c', 'd']) assert.strictEqual(e.viewFor(pid).write.mine[0].text, f.prompt.text);
  assert.strictEqual(e.viewFor(STAGE).write.prompt.text, f.prompt.text);
  assert.strictEqual(e.viewFor(STAGE).final.prompt.text, f.prompt.text);
});

test('Finale: 3 Stimmen, auch mehrfach auf eine Antwort, nicht auf die eigene – 300 pro Stimme', () => {
  const e = game(['a', 'b', 'c', 'd']);
  const f = toFinal(e);
  writeFinal(e);
  assert.strictEqual(e.s.phase, 'final-vote');
  const v = e.viewFor('a').final;
  assert.strictEqual(v.answers.length, 4);
  assert.ok(v.answers.every((x) => !('pid' in x) && !('name' in x)), 'anonym');
  assert.strictEqual(v.answers.filter((x) => x.mine).length, 1);
  assert.ok(!e.apply({ type: 'votes', final: f.id, votes: { [keyOf(f, 'a')]: 1 } }, 'a'), 'nicht für sich selbst');
  assert.ok(!e.apply({ type: 'votes', final: f.id, votes: { [keyOf(f, 'b')]: 2, [keyOf(f, 'c')]: 2 } }, 'a'), 'höchstens 3');
  assert.ok(!e.apply({ type: 'votes', final: f.id, votes: { 9: 1 } }, 'a'), 'gibt es nicht');
  assert.ok(e.apply({ type: 'votes', final: f.id, votes: { [keyOf(f, 'b')]: 3 } }, 'a'));
  assert.ok(e.apply({ type: 'votes', final: f.id, votes: { [keyOf(f, 'a')]: 2, [keyOf(f, 'c')]: 1 } }, 'b'));
  assert.ok(e.apply({ type: 'votes', final: f.id, votes: { [keyOf(f, 'b')]: 1, [keyOf(f, 'a')]: 1 } }, 'c'));
  assert.strictEqual(e.s.phase, 'final-vote', 'c hat erst 2 vergeben, d fehlt');
  assert.strictEqual(e.viewFor(STAGE).final.done, 2);
  assert.ok(e.apply({ type: 'votes', final: f.id, votes: { [keyOf(f, 'b')]: 1, [keyOf(f, 'a')]: 2 } }, 'c'));
  assert.ok(e.apply({ type: 'votes', final: f.id, votes: { [keyOf(f, 'a')]: 3 } }, 'd'));
  assert.strictEqual(e.s.phase, 'final-result');
  const res = e.finalResult(f);
  const pts = Object.fromEntries(res.entries.map((x) => [x.pid, x.points]));
  assert.deepStrictEqual(pts, { a: 7 * 300, b: 4 * 300, c: 300, d: 0 });
  const view = e.viewFor(STAGE).final.results;
  assert.strictEqual(view[0].name, 'A');
  assert.strictEqual(view[0].votes, 7);
});

test('Finale mit Publikum (20 %) und Rettung (halbe Punkte)', () => {
  const e = game(['a', 'b', 'c'], {}, { audience: ['z'] });
  const f = toFinal(e);
  e.apply({ type: 'answer', target: f.id, parts: f.prompt.rescues[0] }, 'a');
  writeFinal(e, ['a']);
  assert.strictEqual(f.answers.a.rescue, true);
  e.apply({ type: 'votes', final: f.id, votes: { [keyOf(f, 'a')]: 3 } }, 'b');
  e.apply({ type: 'votes', final: f.id, votes: { [keyOf(f, 'a')]: 3 } }, 'c');
  e.apply({ type: 'votes', final: f.id, votes: { [keyOf(f, 'b')]: 3 } }, 'a');
  e.apply({ type: 'votes', final: f.id, votes: { [keyOf(f, 'c')]: 3 } }, 'z');
  assert.strictEqual(e.s.phase, 'final-result');
  const pts = Object.fromEntries(e.finalResult(f).entries.map((x) => [x.pid, x.points]));
  // 9 Spieler-Stimmen → Publikum wiegt 9 × 0,25 = 2,25 Stimmen
  assert.strictEqual(pts.a, Math.round((6 * 300) / 2));
  assert.strictEqual(pts.b, 900);
  assert.strictEqual(pts.c, Math.round(2.25 * 300));
});

test('Finale: Mehrfeld-Antworten, leere Antwort = 0 Punkte und nicht zur Wahl', () => {
  const e = game(['a', 'b', 'c', 'd']);
  const f = toFinal(e);
  f.prompt = { id: 'x', text: 'Drei Dinge: ___, ___, ___', blanks: 3, rescues: [['a', 'b', 'c'], ['d', 'e', 'f']] };
  assert.ok(e.apply({ type: 'answer', target: f.id, parts: ['eins', '', 'drei', 'zu viel'] }, 'a'));
  assert.deepStrictEqual(f.answers.a.parts, ['eins', '', 'drei']);
  writeFinal(e, ['a', 'd']);
  timeUp(e);
  assert.strictEqual(e.s.phase, 'final-vote');
  assert.strictEqual(f.order.length, 3);
  assert.ok(!f.order.includes('d'));
  e.apply({ type: 'next', force: true }, STAGE);
  const res = e.finalResult(f);
  assert.strictEqual(res.entries.find((x) => x.pid === 'd').points, 0);
});

test('Ganzes Spiel: 2 Runden + Finale → Siegerehrung mit Auszeichnungen, Nochmal', () => {
  const e = game(['a', 'b', 'c', 'd']);
  const f = toFinal(e);
  writeFinal(e);
  for (const pid of ['a', 'b', 'c', 'd']) {
    const other = f.order.find((x) => x !== pid);
    e.apply({ type: 'votes', final: f.id, votes: { [keyOf(f, other)]: 3 } }, pid);
  }
  assert.strictEqual(e.s.phase, 'final-result');
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.strictEqual(e.s.phase, 'end');
  const v = e.viewFor(STAGE);
  assert.ok(v.awards.some((a) => a.icon === '🎤'), 'Pointen-König/in');
  assert.ok(v.awards.some((a) => a.icon === '🔥'), 'Beste Antwort');
  assert.ok(v.awards.some((a) => a.icon === '🦗'), 'Grillenzirpen');
  assert.ok(v.awards.some((a) => a.icon === '👑'), 'Letzte Pointe');
  assert.strictEqual(v.history.length, 3);
  assert.ok(v.stats.a.answers >= 2);
  assert.ok(e.apply({ type: 'again' }, STAGE));
  assert.strictEqual(e.s.phase, 'lobby');
  assert.strictEqual(e.totals().a, 0);
});

test('Nur Finale: drei Runden Letzte Pointe', () => {
  const e = game(['a', 'b', 'c'], { rounds: 0 });
  for (let i = 1; i <= 3; i++) {
    assert.strictEqual(e.s.phase, 'final-write');
    assert.strictEqual(e.s.round, i);
    writeFinal(e);
    e.apply({ type: 'next', force: true }, STAGE);
    assert.strictEqual(e.s.phase, 'final-result');
    e.apply({ type: 'next' }, STAGE);
    if (i < 3) {
      assert.strictEqual(e.s.phase, 'scores');
      e.apply({ type: 'next' }, STAGE);
    }
  }
  assert.strictEqual(e.s.phase, 'end');
  const ids = e.s.rounds.map((r) => r.final.prompt.id);
  assert.strictEqual(new Set(ids).size, 3, 'drei verschiedene Satzanfänge');
});

/* ---------- Sonstiges ---------- */

console.log('Sonstiges');

test('Trinkregeln: keine Stimme → 2 Schlucke, Pointe! → 3 verteilen', () => {
  const e = game(['a', 'b', 'c'], { drinks: true });
  writeAll(e);
  const d = e.duel();
  voteAll(e, 'a');
  const sips = e.viewFor(STAGE).duel.sips;
  assert.deepStrictEqual(sips.sips, { [d.b]: 2 });
  assert.deepStrictEqual(sips.give, { pid: d.a, n: 3 });
  const g = game(['a', 'b', 'c']);
  writeAll(g);
  voteAll(g, 'a');
  assert.strictEqual(g.viewFor(STAGE).duel.sips, null, 'ohne Trinkregeln');
});

test('Rauswerfen mitten im Duell: Gegner gewinnt kampflos', () => {
  const e = game(['a', 'b', 'c', 'd']);
  writeAll(e);
  const d = e.duel();
  assert.ok(e.apply({ type: 'kick', player: d.b }, STAGE));
  assert.strictEqual(e.s.phase, 'result');
  assert.strictEqual(e.duelResult(d, 1).forfeit, 'b');
});

test('Wer mitten im Spiel dazukommt, stimmt sofort ab und schreibt ab der nächsten Runde', () => {
  const e = game(['a', 'b', 'c']);
  e.connect('n', 'Neu');
  assert.ok(e.player('n'));
  assert.ok(!duels(e).some((d) => d.a === 'n' || d.b === 'n'));
  playDuelRound(e, 'a');
  e.apply({ type: 'next' }, STAGE);
  assert.ok(duels(e).some((d) => d.a === 'n' || d.b === 'n'));
  assert.strictEqual(duels(e).length, 4);
});

test('Timer: Engine stellt sich selbst (Schreiben → Gnadenfrist)', () => {
  const now = clock();
  let changes = 0;
  const state = Engine.create({ settings: { speech: false } });
  const e = new Engine(state, { now, onChange: () => changes++ });
  for (const p of ['a', 'b', 'c']) e.connect(p, p);
  e.apply({ type: 'start' }, STAGE);
  assert.strictEqual(e.nextDeadline(), e.s.writeEnd + GRACE_MS);
  assert.ok(e.timer);
  e.dispose();
  assert.ok(changes >= 4);
});

console.log(`\n${passed} Tests bestanden.`);
