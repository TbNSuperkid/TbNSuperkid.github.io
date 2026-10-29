'use strict';
/* Tests für „Finish the lyrics“ (ohne Browser, ohne Ton): node tests/finish-the-lyrics.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

globalThis.window = globalThis;
// Node 25 hat ein eigenes localStorage (mit Warnung) – hier gibt es keins, außer ein Test setzt es
Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true, configurable: true });
const SONG_DIR = path.join(__dirname, '..', 'shared', 'songs');
for (const f of fs.readdirSync(SONG_DIR).filter((f) => f.endsWith('.js'))) require(path.join(SONG_DIR, f));
for (const f of ['songs', 'match', 'titles']) require(path.join(__dirname, '..', 'shared', f + '.js'));
require(path.join(__dirname, '..', 'finish-the-lyrics', 'js', 'stops.js'));
require(path.join(__dirname, '..', 'finish-the-lyrics', 'js', 'engine.js'));

const E = globalThis.FTLEngine;
const St = globalThis.FTLStops;
const { Engine, STAGE, POINTS, SING_HIT, SING_SINGER, SING_MS, TYPE_EXTRA_MS, RESUME_MIN_MS, SIPS_WRONG, STREAK, MIN_POOL, sanitizeSettings, tally, likeVerdict, totalSongs, cleanAnswer } = E;

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

function clock(start) {
  let t = start || 1000000;
  const now = () => t;
  now.add = (ms) => (t += ms);
  return now;
}

/** Handys: Lobby, alle verbinden, starten */
function phones(settings, pids, opts) {
  const o = opts || {};
  const now = clock();
  const hooks = Object.assign({ random: seeded(o.seed || 5), timers: false, now, used: [] }, o.hooks);
  const state = Engine.create({ settings: Object.assign({ input: 'phones' }, settings) }, hooks);
  const e = new Engine(state, hooks);
  for (const pid of pids || ['a', 'b', 'c', 'd']) {
    e.connect(pid, pid.toUpperCase());
    now.add(10);
  }
  e.clock = now;
  if (o.start !== false) assert.ok(e.apply({ type: 'start' }, STAGE), 'Start: ' + e.lobbyProblem());
  return e;
}

/** Ein Gerät: Spiel läuft sofort */
function one(settings, names, opts) {
  const o = opts || {};
  const now = clock();
  const hooks = Object.assign({ random: seeded(o.seed || 3), timers: false, now, used: [] }, o.hooks);
  const state = Engine.create({ settings: Object.assign({ input: 'one' }, settings), players: names || ['Anna', 'Ben', 'Cem'] }, hooks);
  const e = new Engine(state, hooks);
  e.clock = now;
  return e;
}

/** Audio: Ausschnitt ist an der Stelle angekommen, Weitersingen-Zeit läuft ab → Abstimmung */
function toVote(e) {
  assert.strictEqual(e.s.phase, 'play');
  assert.ok(e.apply({ type: 'stopped', playId: e.s.cur.playId }, STAGE));
  assert.strictEqual(e.s.phase, 'sing');
  e.clock.add(e.singMs() + 1);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'vote');
}

/** Ansingen: Ansänger/in wählt den ersten Vorschlag */
function pickFirst(e) {
  assert.strictEqual(e.s.phase, 'pick');
  const p = e.s.cur.singer;
  assert.ok(e.apply({ type: 'pick', id: e.s.cur.options[0].id }, p));
  return p;
}

const points = (e, pid) => e.s.teams[e.teamOf(pid)].points;

console.log('Finish the lyrics');

/* ---------- Grundlagen ---------- */

test('Einstellungen: Standard laut Planung, Bereinigung, ein Gerät = reihum', () => {
  const d = sanitizeSettings({});
  assert.deepStrictEqual([d.mode, d.answer, d.count, d.time, d.teams, d.drinks], ['audio', 'teams', 15, 10, 2, false]);
  assert.deepStrictEqual(d.cats, ['deutsch', 'schlager-party']);
  const s = sanitizeSettings({ mode: 'x', answer: 'y', count: 99, time: 3, teams: 7, cats: ['quatsch'] });
  assert.deepStrictEqual([s.mode, s.answer, s.count, s.time, s.teams], ['audio', 'teams', 15, 10, 2]);
  assert.deepStrictEqual(s.cats, [], 'nur ungültige Kategorien = alle');
  // Die Wahl bleibt gespeichert (für das Zurückschalten) – wirksam ist sie nur mit Handys bzw. bei Audio
  assert.strictEqual(sanitizeSettings({ input: 'one', answer: 'teams' }).answer, 'teams');
  const oneTeams = one({ answer: 'teams' }, ['Anna', 'Ben']);
  assert.strictEqual(oneTeams.teamMode, false, 'ein Gerät: reihum');
  assert.strictEqual(oneTeams.s.teams.length, 2);
  const singAll = phones({ mode: 'sing', answer: 'all' }, ['a', 'b', 'c']);
  assert.strictEqual(singAll.allMode, false, 'Ansingen kennt kein „alle gleichzeitig“');
  assert.strictEqual(singAll.s.teams.length, 3, 'jede/r für sich');
  assert.strictEqual(singAll.s.total, 15);
  assert.ok(E.pool({}).length >= MIN_POOL, 'Standard-Kategorien reichen');
  assert.throws(() => Engine.create({ settings: { cats: ['film-serie'], decades: [1950], level: 'easy' } }), /Zu wenige Songs/);
});

test('Abstimmung: Mehrheit, Gleichstand = 🤏, keine Stimmen = offen', () => {
  assert.strictEqual(tally(['yes', 'yes', 'no']).verdict, 'yes');
  assert.strictEqual(tally(['no', 'close', 'no']).verdict, 'no');
  assert.strictEqual(tally(['close']).verdict, 'close');
  assert.strictEqual(tally(['yes', 'no']).verdict, 'close', 'Gleichstand 👍/👎');
  assert.strictEqual(tally(['yes', 'close']).verdict, 'close', 'Gleichstand 👍/🤏');
  assert.strictEqual(tally(['yes', 'close', 'no']).verdict, 'close');
  assert.strictEqual(tally([]).verdict, null);
  assert.deepStrictEqual(tally(['yes', 'x', 'no']), { yes: 1, close: 0, no: 1, total: 2, verdict: 'close' }, 'Unsinn zählt nicht');
  assert.deepStrictEqual([POINTS.yes, POINTS.close, POINTS.no], [3, 1, 0]);
});

test('Alle gleichzeitig: mehr als die Hälfte 👍 = richtig, ein 👍 = fast', () => {
  assert.strictEqual(likeVerdict(3, 4), 'yes');
  assert.strictEqual(likeVerdict(2, 4), 'close', 'genau die Hälfte reicht nicht');
  assert.strictEqual(likeVerdict(1, 4), 'close');
  assert.strictEqual(likeVerdict(0, 4), 'no');
  assert.strictEqual(likeVerdict(1, 1), 'yes');
  assert.strictEqual(likeVerdict(0, 0), null);
});

test('Volle Runden: 15 Songs bei 2 Teams → 16, bei 4 Personen → 16, alle gleichzeitig → 15', () => {
  assert.strictEqual(totalSongs(15, 2), 16);
  assert.strictEqual(totalSongs(10, 3), 12);
  assert.strictEqual(totalSongs(20, 4), 20);
  assert.strictEqual(totalSongs(15, 0), 15);
  assert.strictEqual(phones({}).s.total, 16);
  assert.strictEqual(phones({ answer: 'turns' }).s.total, 16);
  assert.strictEqual(phones({ answer: 'all' }).s.total, 15);
  assert.strictEqual(phones({ answer: 'turns', count: 10 }, ['a', 'b', 'c']).s.total, 12);
});

test('Antworten werden bereinigt und gekürzt', () => {
  assert.strictEqual(cleanAnswer('  la\n la   la '), 'la la la');
  assert.strictEqual(cleanAnswer('x'.repeat(500)).length, E.MAX_ANSWER);
});

/* ---------- Stoppstellen ---------- */

test('Stoppstelle: bekannte Stelle aus der Liste, sonst zufällig 8–20 s', () => {
  const song = { id: 'test:song', title: 'Song', artist: 'Test' };
  for (const r of [0, 0.37, 0.999]) {
    const x = St.stopFor(song, () => r);
    assert.strictEqual(x.known, false);
    assert.ok(x.secs >= St.RANDOM_FROM && x.secs <= St.RANDOM_TO, String(x.secs));
    assert.strictEqual(Math.round(x.secs * 10), x.secs * 10, 'eine Nachkommastelle');
  }
  St.STOPS['test:song'] = 12.4;
  assert.deepStrictEqual(St.stopFor(song, () => 0.5), { secs: 12.4, known: true });
  St.STOPS['test:song'] = 29; // zu spät – unbrauchbar
  assert.strictEqual(St.stopFor(song, () => 0).known, false);
  delete St.STOPS['test:song'];
  assert.ok(!St.valid('12') && !St.valid(NaN) && !St.valid(2) && St.valid(4) && St.valid(26));
});

test('Stoppstellen sammeln (im Browser), gesammelte gelten zuerst, Export als Liste', () => {
  const mem = {};
  globalThis.localStorage = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => (mem[k] = String(v)),
    removeItem: (k) => delete mem[k],
  };
  try {
    const song = { id: 'helene-fischer:atemlos-durch-die-nacht', title: 'Atemlos durch die Nacht', artist: 'Helene Fischer' };
    assert.strictEqual(St.mark(song, 12.44), true);
    assert.strictEqual(St.mark(song, 1), false, 'zu früh');
    assert.deepStrictEqual(St.stopFor(song, () => 0), { secs: 12.4, known: true });
    St.STOPS[song.id] = 15;
    assert.strictEqual(St.get(song.id), 12.4, 'gesammelt schlägt Liste');
    delete St.STOPS[song.id];
    St.mark({ id: "o'neil:x", title: 'X', artist: "O'Neil" }, 9);
    const text = St.exportText();
    assert.strictEqual(text, "  'helene-fischer:atemlos-durch-die-nacht': 12.4, // Atemlos durch die Nacht – Helene Fischer\n  'o\\'neil:x': 9, // X – O'Neil");
    // die exportierte Liste ist gültiges JavaScript
    const parsed = new Function(`return {\n${text}\n};`)();
    assert.deepStrictEqual(parsed, { 'helene-fischer:atemlos-durch-die-nacht': 12.4, "o'neil:x": 9 });
    St.forget("o'neil:x");
    assert.deepStrictEqual(Object.keys(St.collected()), [song.id]);
    St.clear();
    assert.deepStrictEqual(St.collected(), {});
    mem[St.KEY] = 'kaputt{';
    assert.deepStrictEqual(St.collected(), {}, 'kaputter Speicher stört nicht');
  } finally {
    delete globalThis.localStorage;
  }
});

test('Engine nimmt die Stoppstelle aus stops.js', () => {
  const e = phones({ answer: 'turns' }, ['a', 'b']);
  St.STOPS[e.s.next.id] = 14.2;
  try {
    toVote(e);
    e.apply({ type: 'vote', verdict: 'yes' }, e.voters()[0]);
    e.apply({ type: 'next' }, STAGE);
    assert.strictEqual(e.s.cur.stop, 14.2);
    assert.strictEqual(e.s.cur.stopKnown, true);
  } finally {
    for (const k of Object.keys(St.STOPS)) delete St.STOPS[k];
  }
});

/* ---------- Inhalt: keine Liedtexte im Repo ---------- */

test('Inhalt: kein Feld mit Liedtext in shared/songs/ (höchstens 120 Zeichen außer Beschreibung)', () => {
  let n = 0;
  for (const f of fs.readdirSync(SONG_DIR).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(SONG_DIR, f), 'utf8');
    const body = src.slice(src.indexOf('`') + 1, src.lastIndexOf('`'));
    for (const line of body.split('\n')) {
      const l = line.trim();
      if (!l || l.startsWith('#')) continue;
      const parts = l.split('|').map((p) => p.trim());
      parts.slice(0, 6).forEach((p, i) => {
        assert.ok(p.length <= 120, `${f}: Feld ${i + 1} zu lang (${p.length}): ${p.slice(0, 60)}…`);
      });
      for (const alt of (parts[4] || '').split(';')) assert.ok(alt.trim().length <= 120, `${f}: Antwort zu lang: ${alt}`);
      n++;
    }
  }
  assert.ok(n > 500, `${n} Songs geprüft`);
});

test('Inhalt: stops.js enthält nur Zahlen (Sekunden), keine Texte', () => {
  for (const [id, secs] of Object.entries(St.STOPS)) {
    assert.match(id, /^[a-z0-9-]+:[a-z0-9-]+$/, id);
    assert.ok(St.valid(secs), `${id}: ${secs}`);
    assert.ok(globalThis.Songs.byId(id), `${id} steht nicht in der Song-Datenbank`);
  }
  const src = fs.readFileSync(path.join(__dirname, '..', 'finish-the-lyrics', 'js', 'stops.js'), 'utf8');
  const list = src.slice(src.indexOf('const STOPS = {'), src.indexOf('};', src.indexOf('const STOPS = {')));
  for (const line of list.split('\n').slice(1)) {
    const l = line.trim();
    if (!l || l.startsWith('//')) continue;
    assert.match(l, /^'[^']+':\s*\d+(\.\d)?,(\s*\/\/.*)?$/, 'nur Song-ID: Sekunden');
    assert.ok(l.replace(/\/\/.*/, '').length < 120);
  }
});

/* ---------- Audio stoppt: Teams abwechselnd ---------- */

test('Lobby: mindestens 2 Personen, mit Teams mindestens 2 besetzte Teams', () => {
  const e = phones({}, ['a'], { start: false });
  assert.ok(e.lobbyProblem());
  e.connect('b', 'B');
  assert.strictEqual(e.lobbyProblem(), null, 'B landet automatisch im anderen Team');
  e.apply({ type: 'team', team: 0 }, 'b');
  assert.match(e.lobbyProblem(), /zwei Teams/);
  e.apply({ type: 'team', team: 1 }, 'b');
  assert.strictEqual(e.lobbyProblem(), null);
  assert.strictEqual(e.apply({ type: 'team', team: 1 }, 'b'), false, 'schon drin');
  e.apply({ type: 'settings', settings: { answer: 'turns' } }, STAGE);
  assert.strictEqual(e.s.members.a.team, undefined, 'ohne Teams keine Zuteilung');
});

test('Teams abwechselnd: Ablauf play → sing → vote → reveal, das andere Team bewertet', () => {
  const e = phones({}, ['a', 'b', 'c', 'd']);
  assert.strictEqual(e.s.teams.length, 2);
  const cur = e.s.cur;
  assert.strictEqual(cur.kind, 'audio');
  assert.strictEqual(cur.turn, 0);
  assert.ok(cur.stop >= 8 && cur.stop <= 20);
  assert.strictEqual(e.tick(), false, 'ohne Stopp läuft keine Uhr');
  assert.strictEqual(e.apply({ type: 'stopped', playId: 99 }, STAGE), false, 'alte Wiedergabe zählt nicht');
  assert.strictEqual(e.apply({ type: 'stopped', playId: cur.playId }, 'a'), false, 'nur die Bühne');
  assert.ok(e.apply({ type: 'stopped', playId: cur.playId }, STAGE));
  assert.strictEqual(e.s.phase, 'sing');
  assert.strictEqual(cur.deadline - e.now(), 10000);
  e.clock.add(9999);
  assert.strictEqual(e.tick(), false);
  e.clock.add(2);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'vote');
  const team0 = e.s.teams[0].members;
  const team1 = e.s.teams[1].members;
  assert.deepStrictEqual(e.voters().sort(), team1.slice().sort(), 'Team am Zug bewertet nicht sich selbst');
  assert.strictEqual(e.apply({ type: 'vote', verdict: 'yes' }, team0[0]), false);
  assert.strictEqual(e.apply({ type: 'vote', verdict: 'vielleicht' }, team1[0]), false);
  assert.ok(e.apply({ type: 'vote', verdict: 'yes' }, team1[0]));
  assert.strictEqual(e.apply({ type: 'vote', verdict: 'yes' }, team1[0]), false, 'gleiche Stimme nochmal ändert nichts');
  assert.ok(e.apply({ type: 'vote', verdict: 'close' }, team1[0]), 'Stimme ändern geht');
  assert.strictEqual(e.s.phase, 'vote');
  assert.ok(e.apply({ type: 'vote', verdict: 'yes' }, team1[1]));
  assert.strictEqual(e.s.phase, 'reveal', 'alle haben abgestimmt');
  assert.strictEqual(e.s.last.verdict, 'close', 'Gleichstand 👍/🤏 → fast');
  assert.strictEqual(e.s.teams[0].points, POINTS.close);
  assert.ok(e.apply({ type: 'next' }, team0[0]) || e.apply({ type: 'next' }, STAGE));
  assert.strictEqual(e.s.cur.turn, 1, 'jetzt das andere Team');
});

test('Spielleitung überstimmt – aber nicht fürs eigene Team; Laptop immer', () => {
  const e = phones({}, ['a', 'b', 'c', 'd']);
  const lead = e.leadPid();
  assert.strictEqual(lead, 'a');
  // Team von a ist zuerst dran?
  const leadTeam = e.teamOf('a');
  assert.strictEqual(e.s.cur.turn, leadTeam);
  toVote(e);
  assert.strictEqual(e.apply({ type: 'verdict', verdict: 'yes' }, 'a'), false, 'eigenes Team: nein');
  const other = e.voters();
  e.apply({ type: 'vote', verdict: 'no' }, other[0]);
  assert.ok(e.apply({ type: 'verdict', verdict: 'yes' }, STAGE), 'Laptop überstimmt');
  assert.strictEqual(e.s.last.verdict, 'yes');
  assert.strictEqual(e.s.last.overridden, true);
  assert.strictEqual(e.s.teams[leadTeam].points, 3);
  e.apply({ type: 'next' }, STAGE);
  toVote(e);
  assert.ok(e.apply({ type: 'verdict', verdict: 'no' }, 'a'), 'fremdes Team: ja');
  assert.strictEqual(e.s.last.verdict, 'no');
});

test('Auswerten vorzeitig: braucht eine Stimme; Replay und Auflösen', () => {
  const e = phones({}, ['a', 'b', 'c', 'd']);
  assert.ok(e.apply({ type: 'stopped', playId: 1 }, STAGE));
  assert.ok(e.apply({ type: 'replay' }, 'a'), 'Spielleitung: nochmal bis zur Stelle');
  assert.strictEqual(e.s.phase, 'play');
  assert.strictEqual(e.s.cur.playId, 2);
  assert.strictEqual(e.s.cur.deadline, null);
  assert.strictEqual(e.apply({ type: 'replay' }, 'b'), false, 'nur die Spielleitung');
  assert.ok(e.apply({ type: 'resolve' }, STAGE), 'gleich auflösen');
  assert.strictEqual(e.s.phase, 'vote');
  assert.strictEqual(e.apply({ type: 'count' }, STAGE), false, 'ohne Stimme entscheidet der Laptop selbst');
  e.apply({ type: 'vote', verdict: 'no' }, e.voters()[0]);
  assert.ok(e.apply({ type: 'count' }, STAGE));
  assert.strictEqual(e.s.last.verdict, 'no');
  assert.strictEqual(e.s.last.votes.no, 1);
});

test('Reihum einzeln: alle anderen bewerten, jede/r ist gleich oft dran', () => {
  const e = phones({ answer: 'turns', count: 10 }, ['a', 'b', 'c']);
  assert.strictEqual(e.s.total, 12);
  const turns = [];
  while (e.s.phase !== 'end') {
    turns.push(e.s.cur.turn);
    toVote(e);
    const v = e.voters();
    assert.strictEqual(v.length, 2);
    assert.ok(!v.includes(e.s.teams[e.s.cur.turn].members[0]));
    for (const p of v) e.apply({ type: 'vote', verdict: 'yes' }, p);
    assert.strictEqual(e.s.phase, 'reveal');
    e.apply({ type: 'next' }, STAGE);
  }
  assert.deepStrictEqual(turns, [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2]);
  assert.deepStrictEqual(e.s.teams.map((t) => t.points), [12, 12, 12]);
  assert.strictEqual(e.ranking().filter((r) => r.place === 1).length, 3, 'Gleichstand teilt den Platz');
  assert.strictEqual(e.s.log.length, 12);
  assert.ok(e.awards().some((a) => a.id === 'sure'));
});

test('Weg während der Abstimmung: es wird nicht auf sie gewartet; Team ohne Online-Mitglieder wird übersprungen', () => {
  const e = phones({ answer: 'turns' }, ['a', 'b', 'c']);
  toVote(e);
  const [v1, v2] = e.voters();
  e.apply({ type: 'vote', verdict: 'yes' }, v1);
  e.disconnect(v2);
  assert.strictEqual(e.s.phase, 'reveal', 'die letzte Stimme fehlt nicht mehr');
  assert.strictEqual(e.s.last.verdict, 'yes');
  e.apply({ type: 'next' }, STAGE);
  assert.notStrictEqual(e.s.teams[e.s.cur.turn].members[0], v2, 'wer weg ist, ist nicht dran');
});

test('Kein Ausschnitt → anderer Song für dasselbe Team', () => {
  const e = phones({}, ['a', 'b', 'c', 'd']);
  const id = e.s.cur.song.id;
  const turn = e.s.cur.turn;
  assert.strictEqual(e.apply({ type: 'replace', id: 'falsch' }, STAGE), false);
  assert.ok(e.apply({ type: 'replace', id }, STAGE));
  assert.notStrictEqual(e.s.cur.song.id, id);
  assert.strictEqual(e.s.cur.turn, turn);
  assert.strictEqual(e.s.no, 1);
  assert.ok(e.s.next && e.s.next.id !== e.s.cur.song.id, 'nächster Song wird vorgeladen');
});

test('Ansicht Audio: Titel sehen alle (es geht um den Text), die Stelle nur die Bühne', () => {
  const e = phones({}, ['a', 'b', 'c', 'd']);
  const st = e.viewFor(STAGE);
  const ph = e.viewFor('b');
  assert.strictEqual(st.cur.song.title, e.s.cur.song.title);
  assert.strictEqual(ph.cur.song.title, e.s.cur.song.title);
  assert.strictEqual(st.cur.stop, e.s.cur.stop);
  assert.strictEqual(ph.cur.stop, null);
  assert.ok(st.nextSong, 'Bühne lädt den nächsten Song vor');
  assert.strictEqual(ph.nextSong, null);
  assert.strictEqual(e.viewFor('a').me.turn, true);
  const json = JSON.stringify(ph);
  assert.ok(!/previewUrl|itunes/i.test(json), 'Handys bekommen keine Ausschnitt-URL');
});

/* ---------- Audio stoppt: alle gleichzeitig ---------- */

test('Alle gleichzeitig: tippen, anonym bewerten (nicht die eigene), 👍-Mehrheit zählt', () => {
  const e = phones({ answer: 'all' }, ['a', 'b', 'c', 'd']);
  assert.strictEqual(e.s.cur.turn, null);
  assert.ok(e.apply({ type: 'answer', text: 'früh getippt' }, 'a'), 'schon während der Musik');
  assert.ok(e.apply({ type: 'stopped', playId: 1 }, STAGE));
  assert.strictEqual(e.s.cur.deadline - e.now(), 10000 + TYPE_EXTRA_MS);
  assert.strictEqual(e.apply({ type: 'answer', text: '   ' }, 'b'), false, 'leer zählt nicht');
  e.apply({ type: 'answer', text: 'und die Nacht' }, 'a');
  e.apply({ type: 'answer', text: 'durch den Tag' }, 'b');
  e.apply({ type: 'answer', text: 'la la la' }, 'c');
  assert.strictEqual(e.s.phase, 'sing', 'd fehlt noch');
  assert.deepStrictEqual(e.viewFor('d').cur.answered.sort(), ['a', 'b', 'c']);
  assert.strictEqual(e.viewFor('d').cur.answers, null, 'Antworten erst bei der Auflösung');
  e.clock.add(e.singMs() + 1);
  e.tick();
  assert.strictEqual(e.s.phase, 'vote');
  const order = e.s.cur.order;
  assert.strictEqual(order.length, 3, 'nur wer getippt hat');
  const iOf = (pid) => order.indexOf(pid);
  const vb = e.viewFor('b').cur.answers;
  assert.ok(vb.every((x) => !('pid' in x) && !('name' in x)), 'ohne Namen');
  assert.strictEqual(vb[iOf('b')].mine, true);
  assert.strictEqual(vb[0].likes, null, 'Handys sehen die 👍-Zahl nicht');
  assert.strictEqual(e.apply({ type: 'like', i: iOf('a'), on: true }, 'a'), false, 'nicht die eigene');
  // a: 3 von 3 👍 → richtig · b: 1 von 3 → fast · c: keins → falsch
  for (const p of ['b', 'c', 'd']) assert.ok(e.apply({ type: 'like', i: iOf('a') }, p));
  assert.ok(e.apply({ type: 'like', i: iOf('b'), on: true }, 'd'));
  assert.strictEqual(e.apply({ type: 'like', i: iOf('b'), on: true }, 'd'), false, 'schon 👍');
  assert.ok(e.apply({ type: 'like', i: iOf('c'), on: true }, 'a'));
  assert.ok(e.apply({ type: 'like', i: iOf('c'), on: false }, 'a'), '👍 zurücknehmen');
  assert.strictEqual(e.viewFor(STAGE).cur.answers[iOf('a')].likes, 3);
  for (const p of ['a', 'b', 'c']) e.apply({ type: 'done' }, p);
  assert.strictEqual(e.s.phase, 'vote');
  assert.strictEqual(e.apply({ type: 'done' }, 'a'), false, 'schon fertig');
  e.apply({ type: 'done' }, 'd');
  assert.strictEqual(e.s.phase, 'reveal');
  const r = (pid) => e.s.last.results.find((x) => x.pid === pid);
  assert.deepStrictEqual([r('a').verdict, r('a').points], ['yes', 3]);
  assert.deepStrictEqual([r('b').verdict, r('b').points], ['close', 1]);
  assert.deepStrictEqual([r('c').verdict, r('c').points], ['no', 0]);
  assert.deepStrictEqual([r('d').verdict, r('d').points, r('d').text], [null, 0, ''], 'nichts getippt');
  assert.strictEqual(e.viewFor('c').last.results.find((x) => x.pid === 'a').text, 'und die Nacht', 'nach der Auflösung mit Namen');
});

test('Alle gleichzeitig: alle getippt → sofort bewerten; Laptop überstimmt einzelne Antworten', () => {
  const e = phones({ answer: 'all' }, ['a', 'b', 'c']);
  e.apply({ type: 'stopped', playId: 1 }, STAGE);
  for (const p of ['a', 'b', 'c']) e.apply({ type: 'answer', text: 'Antwort ' + p }, p);
  assert.strictEqual(e.s.phase, 'vote', 'alle fertig → nicht auf die Uhr warten');
  const i = e.s.cur.order.indexOf('c');
  assert.ok(e.apply({ type: 'verdict', i, verdict: 'yes' }, STAGE));
  assert.strictEqual(e.apply({ type: 'verdict', i, verdict: 'yes' }, STAGE), false);
  assert.strictEqual(e.apply({ type: 'verdict', i: e.s.cur.order.indexOf('a'), verdict: 'yes' }, 'a'), false, 'Spielleitung nicht für die eigene Antwort');
  assert.strictEqual(e.apply({ type: 'verdict', i: 99, verdict: 'yes' }, STAGE), false);
  assert.ok(e.apply({ type: 'count' }, 'a'), 'Spielleitung wertet aus');
  const r = (pid) => e.s.last.results.find((x) => x.pid === pid);
  assert.strictEqual(r('c').verdict, 'yes');
  assert.strictEqual(r('c').overridden, true);
  assert.strictEqual(r('a').verdict, 'no');
});

test('Alle gleichzeitig: niemand tippt → gleich zur Auflösung', () => {
  const e = phones({ answer: 'all' }, ['a', 'b']);
  e.apply({ type: 'stopped', playId: 1 }, STAGE);
  e.clock.add(e.singMs() + 1);
  e.tick();
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(e.s.last.nobody, true);
});

/* ---------- Ansingen ---------- */

test('Ansingen: Songs nur für die Ansänger/in, ✋ → bestätigen → 2 + 1 Punkte', () => {
  const e = phones({ mode: 'sing', answer: 'turns' }, ['a', 'b', 'c']);
  assert.strictEqual(e.s.phase, 'pick');
  const singer = e.s.cur.singer;
  const others = ['a', 'b', 'c'].filter((p) => p !== singer);
  assert.strictEqual(e.viewFor(singer).cur.options.length, 3);
  assert.strictEqual(e.viewFor(others[0]).cur.options, null);
  assert.strictEqual(e.viewFor(STAGE).cur.options, null, 'mit Handys kennt auch der Laptop die Songs nicht');
  assert.strictEqual(e.apply({ type: 'pick', id: e.s.cur.options[0].id }, others[0]), false);
  const seen = e.s.cur.options.map((x) => x.id);
  assert.ok(e.apply({ type: 'reroll' }, singer));
  assert.ok(e.s.cur.options.every((x) => !seen.includes(x.id)), 'Kenn ich nicht → drei andere');
  pickFirst(e);
  assert.strictEqual(e.s.phase, 'play');
  assert.strictEqual(e.s.cur.deadline - e.now(), SING_MS);
  assert.ok(e.viewFor(singer).cur.song);
  assert.strictEqual(e.viewFor(others[0]).cur.song, null, 'Titel bleibt geheim');
  assert.strictEqual(e.viewFor(STAGE).cur.song, null);
  assert.strictEqual(e.apply({ type: 'buzz' }, singer), false, 'Ansänger/in singt nicht selbst weiter');
  assert.ok(e.apply({ type: 'buzz' }, others[0]));
  assert.strictEqual(e.s.phase, 'buzzed');
  assert.strictEqual(e.apply({ type: 'buzz' }, others[1]), false);
  assert.strictEqual(e.apply({ type: 'judge', ok: true }, others[1]), false, 'nur die Ansänger/in bestätigt');
  assert.ok(e.viewFor(singer).me.judge);
  assert.ok(e.apply({ type: 'judge', ok: true }, singer));
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(points(e, others[0]), SING_HIT);
  assert.strictEqual(points(e, singer), SING_SINGER);
  assert.strictEqual(points(e, others[1]), 0);
  assert.ok(e.viewFor(others[1]).last.song.title, 'nach der Auflösung sehen alle den Song');
});

test('Ansingen: falsch → raus für diesen Song, Zeit läuft weiter; niemand → Ansänger/in bekommt nichts', () => {
  const e = phones({ mode: 'sing', answer: 'turns' }, ['a', 'b', 'c']);
  const singer = pickFirst(e);
  const [x, y] = ['a', 'b', 'c'].filter((p) => p !== singer);
  e.clock.add(SING_MS - 1000);
  e.apply({ type: 'buzz' }, x);
  assert.ok(e.apply({ type: 'judge', ok: false }, STAGE), 'Laptop darf auch bestätigen');
  assert.strictEqual(e.s.phase, 'play');
  assert.strictEqual(e.s.cur.deadline - e.now(), RESUME_MIN_MS, 'mindestens 5 s Zeit bleiben');
  assert.strictEqual(e.apply({ type: 'buzz' }, x), false, 'raus');
  assert.strictEqual(e.viewFor(x).me.canBuzz, false);
  e.apply({ type: 'buzz' }, y);
  e.apply({ type: 'judge', ok: false }, singer);
  assert.strictEqual(e.s.phase, 'reveal', 'niemand darf mehr');
  assert.strictEqual(e.s.last.nobody, true);
  assert.deepStrictEqual(e.s.teams.map((t) => t.points), [0, 0, 0]);
  assert.strictEqual(e.s.stats[x].wrong, 1);
  e.apply({ type: 'next' }, STAGE);
  assert.notStrictEqual(e.s.cur.singer, singer, 'reihum');
  pickFirst(e);
  e.clock.add(SING_MS + 1);
  assert.ok(e.tick());
  assert.strictEqual(e.s.phase, 'reveal', 'Zeit um');
});

test('Ansingen mit Teams: nur das gegnerische Team singt weiter, Ansänger/innen abwechselnd', () => {
  const e = phones({ mode: 'sing', answer: 'teams' }, ['a', 'b', 'c', 'd']);
  const singers = [];
  for (let k = 0; k < 4; k++) {
    const singer = pickFirst(e);
    singers.push(e.teamOf(singer));
    const mate = e.s.teams[e.teamOf(singer)].members.find((p) => p !== singer);
    assert.strictEqual(e.apply({ type: 'buzz' }, mate), false, 'eigenes Team darf nicht');
    const opp = e.s.teams[1 - e.teamOf(singer)].members[0];
    assert.ok(e.apply({ type: 'buzz' }, opp));
    e.apply({ type: 'judge', ok: true }, singer);
    e.apply({ type: 'next' }, STAGE);
  }
  assert.deepStrictEqual(singers, [0, 1, 0, 1]);
  assert.deepStrictEqual(e.s.teams.map((t) => t.points), [6, 6]);
});

test('Ansingen: Ansänger/in fliegt raus → Song ohne Wertung, nächste Person', () => {
  const e = phones({ mode: 'sing', answer: 'turns' }, ['a', 'b', 'c']);
  const singer = pickFirst(e);
  assert.ok(e.apply({ type: 'kick', player: singer }, STAGE));
  assert.strictEqual(e.s.no, 1);
  assert.strictEqual(e.s.phase, 'pick');
  assert.notStrictEqual(e.s.cur.singer, singer);
});

/* ---------- Ein Gerät ---------- */

test('Ein Gerät, Audio: reihum, der Laptop entscheidet für die Runde', () => {
  const e = one({ mode: 'audio' }, ['Anna', 'Ben']);
  assert.strictEqual(e.s.phase, 'play');
  assert.strictEqual(e.s.total, 16);
  assert.strictEqual(e.s.cur.turn, 0);
  toVote(e);
  assert.deepStrictEqual(e.voters(), [], 'keine Handys');
  assert.ok(e.apply({ type: 'verdict', verdict: 'yes' }, STAGE));
  assert.strictEqual(e.s.teams[0].points, 3);
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.cur.turn, 1);
});

test('Ein Gerät, Ansingen: Songs nur im „Nur für dich“-Fenster, angetippt wird, wer weitergesungen hat', () => {
  const e = one({ mode: 'sing' }, ['Anna', 'Ben', 'Cem']);
  assert.strictEqual(e.s.phase, 'pick');
  assert.ok(e.viewFor(STAGE).cur.options, 'Bühne zeigt sie der Ansänger/in');
  assert.ok(e.apply({ type: 'pick', id: e.s.cur.options[1].id }, STAGE));
  const singerTeam = e.teamOf(e.s.cur.singer);
  assert.strictEqual(e.apply({ type: 'buzz', team: singerTeam }, STAGE), false);
  const other = (singerTeam + 1) % 3;
  assert.ok(e.apply({ type: 'buzz', team: other }, STAGE));
  assert.ok(e.apply({ type: 'judge', ok: true }, STAGE));
  assert.strictEqual(e.s.teams[other].points, SING_HIT);
  assert.strictEqual(e.s.teams[singerTeam].points, SING_SINGER);
});

/* ---------- Trinkregeln, Ende ---------- */

test('Trinkregeln: 👎 → 1 Schluck, 3 × 👍 hintereinander → verteilen', () => {
  const e = phones({ answer: 'turns', drinks: true }, ['a', 'b']);
  const round = (verdict) => {
    toVote(e);
    e.apply({ type: 'verdict', verdict }, STAGE);
    const l = e.s.last;
    e.apply({ type: 'next' }, STAGE);
    return l;
  };
  const l1 = round('no');
  assert.deepStrictEqual(l1.sips.drink, [0]);
  assert.strictEqual(SIPS_WRONG, 1);
  let gave = null;
  for (let k = 0; k < STREAK * 2; k++) {
    const l = round('yes');
    if (l.sips.give.length && !gave) gave = { k, team: l.sips.give[0] };
  }
  assert.ok(gave, 'nach drei 👍 in Folge');
  // Song 2–7: Teams 1,0,1,0,1,0 – Team 1 hat zuerst 3 × 👍 (Songs 2, 4, 6)
  assert.deepStrictEqual(gave.team, 1);
  const off = phones({ answer: 'turns' }, ['a', 'b']);
  toVote(off);
  off.apply({ type: 'verdict', verdict: 'no' }, STAGE);
  assert.deepStrictEqual(off.s.last.sips, { drink: [], give: [] }, 'ohne Trinkregeln nichts');
});

test('Spielende nach allen Songs, Revanche, zurück in die Lobby', () => {
  const e = phones({ answer: 'turns', count: 10 }, ['a', 'b']);
  while (e.s.phase !== 'end') {
    if (e.s.phase === 'play') toVote(e);
    e.apply({ type: 'verdict', verdict: e.s.no % 2 ? 'yes' : 'close' }, STAGE);
    assert.strictEqual(e.viewFor(STAGE).willEnd, e.s.no === 10);
    e.apply({ type: 'next' }, STAGE);
  }
  assert.strictEqual(e.s.reason, 'done');
  const v = e.viewFor('a');
  assert.strictEqual(v.ranking[0].points, 15);
  assert.strictEqual(v.log.length, 10);
  assert.ok(e.apply({ type: 'again' }, STAGE));
  assert.strictEqual(e.s.no, 1);
  assert.deepStrictEqual(e.s.teams.map((t) => t.points), [0, 0]);
  assert.ok(e.apply({ type: 'end' }, STAGE));
  assert.ok(e.apply({ type: 'lobby' }, STAGE));
  assert.strictEqual(e.s.phase, 'lobby');
});

test('Songs wiederholen sich an einem Abend nicht', () => {
  const used = [];
  const e = phones({ answer: 'turns', count: 20 }, ['a', 'b'], { hooks: { used, onDraw: (s) => used.includes(s.id) || used.push(s.id) } });
  const ids = [];
  while (e.s.phase !== 'end') {
    ids.push(e.s.cur.song.id);
    toVote(e);
    e.apply({ type: 'verdict', verdict: 'no' }, STAGE);
    e.apply({ type: 'next' }, STAGE);
  }
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('Spielstand übersteht Neuladen (JSON) und läuft weiter', () => {
  const e = phones({}, ['a', 'b', 'c', 'd']);
  e.apply({ type: 'stopped', playId: 1 }, STAGE);
  const copy = JSON.parse(JSON.stringify(e.s));
  const e2 = new Engine(copy, { timers: false, now: e.clock, random: seeded(1), used: [] });
  e2.setAllOffline();
  for (const p of ['a', 'b', 'c', 'd']) e2.connect(p);
  assert.strictEqual(e2.s.phase, 'sing');
  e.clock.add(20000);
  assert.ok(e2.tick());
  assert.strictEqual(e2.s.phase, 'vote');
});

console.log(`\n${passed} Tests bestanden.`);
