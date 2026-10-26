'use strict';
/* Tests für „Schlecht erklärt“ (ohne Browser): node tests/schlecht-erklaert.test.js */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
const DIR = path.join(__dirname, '..', 'schlecht-erklaert', 'js');
require(path.join(__dirname, '..', 'shared', 'match.js'));
const CATS = ['animation', 'action', 'komoedie', 'fantasy', 'spannung', 'drama', 'deutsch', 'klassiker', 'serien'];
for (const c of CATS) require(path.join(DIR, 'filme', c + '.js'));
for (const f of ['titles', 'films', 'engine']) require(path.join(DIR, f + '.js'));
const T = globalThis.SETitles;
const Films = globalThis.SEFilms;
const { Engine, STAGE, GRACE_MS, MAX_TRIES, MAX_CLOSE, EASY_MS, MAX_REROLLS, sanitizeSettings } = globalThis.SEEngine;

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

const OBEN = { id: 'animation:oben', cat: 'animation', title: 'Oben', alts: ['Up'], year: 2009, level: 1, text: 'Ein Rentner nimmt das ganze Haus mit.', tip: 'Von Pixar' };
const POTTER = {
  id: 'fantasy:harry-potter-3',
  cat: 'fantasy',
  title: 'Harry Potter und der Gefangene von Askaban',
  alts: ['Harry Potter 3', '~Harry Potter'],
  year: 2004,
  level: 2,
  text: 'Ein Patenonkel flieht aus dem Gefängnis.',
  tip: 'Mit Gary Oldman',
};

/** Film der laufenden Runde durch einen bekannten ersetzen */
function setFilm(e, film, choices) {
  e.s.cur.film = Object.assign({}, film, { alts: film.alts.slice() });
  if (e.s.cur.choices) e.s.cur.choices = choices || [film.title, 'Coco', 'Soul', 'Luca'];
}

/** Spiel mit Handys: Lobby, Spieler verbinden, Teams wählen, starten */
function writeGame(settings, teams, now) {
  const state = Engine.create({
    settings: Object.assign({ input: 'write', seconds: 0 }, settings),
    teams: Object.keys(teams).map((id) => ({ id, active: true, name: 'Team ' + id })),
  });
  const e = new Engine(state, { timers: false, now: now || clock() });
  for (const [id, players] of Object.entries(teams)) {
    for (const pid of players) {
      e.connect(pid, pid.toUpperCase());
      assert.ok(e.apply({ type: 'joinTeam', team: id }, pid), 'joinTeam ' + pid);
    }
  }
  assert.ok(e.apply({ type: 'start' }, STAGE), 'start');
  if (e.s.phase === 'guess') setFilm(e, OBEN);
  return e;
}

/** Spiel mit einem Gerät: startet sofort */
function sayGame(settings, teamIds) {
  const state = Engine.create({
    settings: Object.assign({ input: 'say' }, settings),
    teams: teamIds.map((id) => ({ id, active: true, name: 'Team ' + id })),
  });
  const e = new Engine(state, { timers: false });
  setFilm(e, OBEN);
  return e;
}

function guess(e, pid, text) {
  return e.apply({ type: 'guess', text, at: e.stepKey() }, pid);
}

function score(e, id) {
  return e.team(id).score;
}

function sentences(text) {
  return text.split(/(?<=[.!?…])["“”»]?\s+/).filter(Boolean).length;
}

/* ---------- Inhalte ---------- */

console.log('Filme & Serien');

const ALL = Films.list();
const FILMS = ALL.filter((f) => f.cat !== 'serien');

test('Jede Zeile ist gültig (6 Felder, Jahr, Stufe 1–3, Tipp)', () => {
  for (const c of Films.CATEGORIES) {
    const lines = globalThis.SE_FILME[c.id]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    for (const line of lines) assert.ok(Films.parseLine(line, c.id), `[${c.id}] ungültig: ${line.slice(0, 60)}`);
  }
});

test('Mindestens 500 Filme, jede Kategorie erreicht ihr Ziel', () => {
  assert.ok(FILMS.length >= 500, `nur ${FILMS.length} Filme`);
  for (const c of Films.CATEGORIES) assert.ok(Films.all()[c.id].length >= c.target, `${c.id}: ${Films.all()[c.id].length} < ${c.target}`);
});

test('Beschreibungen: 1–3 Sätze, höchstens 220 Zeichen, mit Satzende, ohne Abkürzungen', () => {
  for (const f of ALL) {
    const n = sentences(f.text);
    assert.ok(n >= 1 && n <= 3, `${f.title}: ${n} Sätze`);
    assert.ok(f.text.length <= 220, `${f.title}: ${f.text.length} Zeichen`);
    assert.ok(/[.!?…]["“”»]?$/.test(f.text), `${f.title}: kein Satzende`);
    assert.ok(!/\b(z|d|u|bzw|ca|Dr|Mr|Mrs|St|Nr)\.\s/.test(f.text), `${f.title}: Abkürzung`);
  }
});

test('Kein Titelwort in Beschreibung und Tipp', () => {
  for (const f of ALL) {
    assert.deepStrictEqual(T.leaks(f.text, f), [], `${f.title} → ${f.text}`);
    assert.deepStrictEqual(T.leaks(f.tip, f), [], `${f.title} (Tipp) → ${f.tip}`);
  }
});

test('Keine doppelten Filme', () => {
  const ids = new Set();
  for (const f of ALL) {
    assert.ok(!ids.has(f.id), 'doppelt: ' + f.id);
    ids.add(f.id);
  }
});

test('Keine Antwort passt auf zwei Filme', () => {
  for (const a of ALL) {
    for (const ans of T.answers(a, true)) {
      for (const b of ALL) {
        if (a !== b) assert.notStrictEqual(T.check(ans.text, b, { strict: true }), 'yes', `„${ans.text}“ (${a.title}) passt auf ${b.title}`);
      }
    }
  }
});

test('Mischung: mind. 30 % leicht, mind. 15 % vor 1990', () => {
  const easy = FILMS.filter((f) => f.level === 1).length;
  const old = FILMS.filter((f) => f.year < 1990).length;
  assert.ok(easy / FILMS.length >= 0.3, `nur ${easy} leichte Filme`);
  assert.ok(old / FILMS.length >= 0.15, `nur ${old} Filme vor 1990`);
});

test('Ziehen: ohne Wiederholung, Kategorie und Schwierigkeit werden beachtet', () => {
  const used = [];
  for (let i = 0; i < 40; i++) {
    const f = Films.draw(['deutsch'], 'easy', used);
    assert.strictEqual(f.cat, 'deutsch');
    assert.strictEqual(f.level, 1);
  }
  assert.strictEqual(new Set(used).size, used.length > Films.pool(['deutsch'], 'easy').length ? Films.pool(['deutsch'], 'easy').length : used.length);
  // Serien kommen nur, wenn sie gewählt sind
  for (let i = 0; i < 30; i++) assert.notStrictEqual(Films.draw(Films.DEFAULT_CATEGORIES, 'all', []).cat, 'serien');
});

test('Auswahl: 4 verschiedene Titel, der richtige ist dabei', () => {
  for (const f of ALL.slice(0, 80)) {
    const c = Films.choices(f);
    assert.strictEqual(c.length, 4);
    assert.strictEqual(new Set(c).size, 4);
    assert.ok(c.includes(f.title));
  }
});

/* ---------- Titel erkennen ---------- */

console.log('Titel erkennen');

const KOENIG = { title: 'Der König der Löwen', alts: ['König der Löwen', 'The Lion King'] };

test('Groß/klein, Umlaute, Artikel, Satzzeichen sind egal', () => {
  for (const g of ['der könig der löwen', 'Koenig der Loewen', 'König der Löwen!', 'DER KÖNIG DER LÖWEN', 'the lion king', 'Lion King']) {
    assert.strictEqual(T.check(g, KOENIG), 'yes', g);
  }
  assert.strictEqual(T.check('A-Team', { title: 'Das A-Team', alts: [] }), 'yes');
  assert.strictEqual(T.check('Ocean’s Eleven', { title: "Ocean's Eleven", alts: [] }), 'yes');
});

test('Kleine Tippfehler zählen, kurze Titel müssen genau stimmen', () => {
  assert.strictEqual(T.check('Könog der Löwen', KOENIG), 'yes');
  assert.strictEqual(T.check('Herr der Rnge die Gefährten', { title: 'Der Herr der Ringe: Die Gefährten', alts: [] }), 'yes');
  assert.strictEqual(T.check('Open', { title: 'Oben', alts: [] }), 'close');
  assert.strictEqual(T.check('Rock', { title: 'Rocky', alts: [] }), 'close');
  assert.strictEqual(T.check('Löwen', KOENIG), 'no');
  assert.strictEqual(T.check('', KOENIG), 'no');
});

test('Zahlen: 2 = II = zwei, aber Teil 2 ≠ Teil 3', () => {
  const ts3 = { title: 'Toy Story 3', alts: [] };
  assert.strictEqual(T.check('Toy Story III', ts3), 'yes');
  assert.strictEqual(T.check('toy story drei', ts3), 'yes');
  assert.strictEqual(T.check('Toy Story 2', ts3), 'no');
  assert.strictEqual(T.check('Toy Story', ts3), 'no');
});

test('Reihenname zählt nur, wenn nicht streng gespielt wird', () => {
  assert.strictEqual(T.check('Harry Potter', POTTER), 'yes');
  assert.strictEqual(T.check('Harry Potter', POTTER, { strict: true }), 'no');
  assert.strictEqual(T.check('Harry Potter 3', POTTER, { strict: true }), 'yes');
  assert.strictEqual(T.check('Harry Potter 2', POTTER), 'no');
});

test('Lücken-Hinweis zeigt nur die Anfangsbuchstaben', () => {
  assert.strictEqual(T.gaps('Der König der Löwen'), 'D__ K____ d__ L____');
  assert.strictEqual(T.gaps('Spider-Man'), 'S_____-M__');
  assert.strictEqual(T.gaps('101 Dalmatiner'), '1__ D_________');
  assert.strictEqual(T.gaps("Ralph reicht's"), "R____ r_____'_");
});

test('Vorschläge: Wortanfänge, Titel mit passendem Anfang zuerst', () => {
  const list = [{ title: 'Der König der Löwen', alts: ['The Lion King'] }, { title: 'Königreich für ein Lama', alts: [] }, { title: 'Burger King', alts: [] }];
  assert.deepStrictEqual(T.suggest('kön', list), ['Der König der Löwen', 'Königreich für ein Lama']);
  assert.deepStrictEqual(T.suggest('lion', list), ['Der König der Löwen']);
  assert.deepStrictEqual(T.suggest('k', list), []);
  assert.ok(T.suggest('star wars', Films.titles()).length >= 3);
});

test('Verräterische Wörter werden gefunden (auch als Wortteil)', () => {
  assert.deepStrictEqual(T.leaks('Ein Löwe wird König.', KOENIG), ['koenig', 'loewen']);
  assert.deepStrictEqual(T.leaks('Ein Kater erbt ein Reich.', KOENIG), []);
  assert.deepStrictEqual(T.leaks('Viele Kleinstädte', { title: 'Gremlins – Kleine Monster', alts: [] }), ['kleine']);
  assert.deepStrictEqual(T.leaks('Sie redet über sich selbst.', { title: 'Who Am I – Kein System ist sicher', alts: [] }), []);
});

/* ---------- Spiel mit Handys ---------- */

console.log('Spiel mit Handys');

test('Treffer ohne Hinweis: 4 Punkte + 1 für die Schnellsten', () => {
  const now = clock();
  const e = writeGame({}, { rot: ['a'], blau: ['b'] }, now);
  now.add(3000);
  assert.ok(guess(e, 'a', 'oben'));
  now.add(2000);
  assert.ok(guess(e, 'b', 'Up'));
  assert.strictEqual(e.s.phase, 'reveal');
  assert.strictEqual(score(e, 'rot'), 5);
  assert.strictEqual(score(e, 'blau'), 4);
  assert.strictEqual(e.s.cur.results.rot.ms, 3000);
});

test('Hinweise senken die Punkte: 4 / 3 / 2 / 1', () => {
  const e = writeGame({}, { rot: ['a'], blau: ['b'] });
  for (let i = 0; i < 3; i++) assert.ok(e.apply({ type: 'hint' }, STAGE));
  assert.ok(!e.apply({ type: 'hint' }, STAGE), 'mehr als 3 Hinweise gibt es nicht');
  assert.ok(guess(e, 'a', 'Oben'));
  assert.ok(guess(e, 'b', 'Oben'));
  assert.strictEqual(score(e, 'rot'), 1 + 1);
  assert.strictEqual(score(e, 'blau'), 1);
});

test('Mit Zeitlimit kommen die Hinweise automatisch (je ein Viertel der Zeit)', () => {
  const now = clock();
  const e = writeGame({ seconds: 60 }, { rot: ['a'] }, now);
  now.add(14000);
  assert.ok(!e.tick());
  now.add(1000);
  assert.ok(e.tick());
  assert.strictEqual(e.s.cur.hint, 1);
  now.add(30000);
  e.tick();
  assert.strictEqual(e.s.cur.hint, 3);
  now.add(15000);
  e.tick();
  assert.strictEqual(e.s.phase, 'reveal');
});

test('3 falsche Versuche, dann raus – „knapp daneben“ und Wiederholungen kosten nichts', () => {
  const e = writeGame({}, { rot: ['a', 'a2'], blau: ['b'] });
  assert.ok(guess(e, 'a', 'Open'));
  assert.strictEqual(e.s.cur.guesses.rot.tries, 0);
  assert.ok(guess(e, 'a', 'Cars'));
  assert.ok(!guess(e, 'a2', 'cars'), 'derselbe falsche Titel zählt nicht');
  assert.ok(guess(e, 'a2', 'Coco'));
  assert.ok(guess(e, 'a', 'Soul'));
  assert.strictEqual(e.s.cur.guesses.rot.tries, MAX_TRIES);
  assert.ok(e.s.cur.guesses.rot.done);
  assert.ok(!guess(e, 'a', 'Oben'), 'raus ist raus');
});

test('Knapp daneben ist nur begrenzt kostenlos', () => {
  const e = writeGame({}, { rot: ['a'], blau: ['b'] });
  for (const g of ['Open', 'Oden', 'Obem'].slice(0, MAX_CLOSE)) assert.ok(guess(e, 'a', g));
  assert.ok(guess(e, 'a', 'Ober'));
  assert.strictEqual(e.s.cur.guesses.rot.tries, 1);
});

test('Nur ein Team: kein Bonus fürs Schnellste', () => {
  const e = writeGame({}, { rot: ['a'] });
  assert.ok(guess(e, 'a', 'Oben'));
  assert.strictEqual(score(e, 'rot'), 4);
});

test('Streng: Reihenname zählt nicht', () => {
  const e = writeGame({ strict: true }, { rot: ['a'] });
  setFilm(e, POTTER);
  assert.ok(guess(e, 'a', 'Harry Potter'));
  assert.strictEqual(e.s.cur.guesses.rot.ok, false);
  assert.ok(guess(e, 'a', 'Harry Potter 3'));
  assert.ok(e.s.cur.guesses.rot.ok);
});

test('„zählt doch“ gibt die Punkte nachträglich (und nimmt sie zurück)', () => {
  const e = writeGame({}, { rot: ['a'], blau: ['b'] });
  e.apply({ type: 'hint' }, STAGE);
  guess(e, 'a', 'Das fliegende Haus');
  assert.ok(e.apply({ type: 'finishRound' }, STAGE));
  assert.ok(e.apply({ type: 'accept', team: 'rot' }, STAGE));
  assert.strictEqual(score(e, 'rot'), 3);
  assert.ok(!e.apply({ type: 'accept', team: 'blau' }, STAGE), 'ohne Tipp nichts zu werten');
  assert.ok(e.apply({ type: 'accept', team: 'rot' }, STAGE));
  assert.strictEqual(score(e, 'rot'), 0);
});

test('Auswahl: ein Versuch, 2 Punkte + 1 für die Schnellsten', () => {
  const e = writeGame({ answer: 'choice' }, { rot: ['a'], blau: ['b'], gruen: ['c'] });
  setFilm(e, OBEN, ['Coco', 'Oben', 'Soul', 'Luca']);
  assert.ok(e.apply({ type: 'pick', index: 1, at: e.stepKey() }, 'a'));
  assert.ok(!e.apply({ type: 'pick', index: 2, at: e.stepKey() }, 'a'), 'nur ein Versuch');
  assert.ok(!guess(e, 'b', 'Oben'), 'tippen geht im Auswahl-Modus nicht');
  assert.ok(e.apply({ type: 'pick', index: 0, at: e.stepKey() }, 'b'));
  assert.ok(e.apply({ type: 'pick', index: 1, at: e.stepKey() }, 'c'));
  assert.deepStrictEqual([score(e, 'rot'), score(e, 'blau'), score(e, 'gruen')], [3, 0, 2]);
  assert.ok(!e.apply({ type: 'hint' }, STAGE), 'keine Hinweise im Auswahl-Modus');
});

test('Im Team zählt der erste Treffer, Versuche werden geteilt', () => {
  const e = writeGame({}, { rot: ['a', 'a2'], blau: ['b'] });
  guess(e, 'a', 'Cars');
  guess(e, 'a2', 'Coco');
  assert.strictEqual(e.s.cur.guesses.rot.tries, 2);
  assert.ok(guess(e, 'a2', 'Oben'));
  assert.ok(!guess(e, 'a', 'Up'), 'schon erraten');
});

test('Verspätete Eingaben für den letzten Film werden ignoriert', () => {
  const e = writeGame({}, { rot: ['a'] });
  const old = e.stepKey();
  e.apply({ type: 'skip' }, STAGE);
  assert.ok(!e.apply({ type: 'guess', text: 'Oben', at: old }, 'a'));
});

test('Getrennte Spieler werden abgewartet, nach der Schonfrist geht es ohne sie weiter', () => {
  const now = clock();
  const e = writeGame({}, { rot: ['a'], blau: ['b'] }, now);
  e.disconnect('b');
  guess(e, 'a', 'Oben');
  assert.strictEqual(e.s.phase, 'guess');
  now.add(GRACE_MS + 10);
  e.tick();
  assert.strictEqual(e.s.phase, 'reveal');
});

test('Vor der Auflösung kennt keine Ansicht den Titel', () => {
  const e = writeGame({}, { rot: ['a'], blau: ['b'] });
  setFilm(e, POTTER);
  for (let i = 0; i < 3; i++) e.apply({ type: 'hint' }, STAGE);
  for (const viewer of [STAGE, 'a', 'b']) {
    const json = JSON.stringify(e.viewFor(viewer));
    assert.ok(!json.includes('Askaban') && !json.includes('Harry'), viewer + ' sieht den Titel');
  }
  e.apply({ type: 'finishRound' }, STAGE);
  assert.strictEqual(e.viewFor('a').cur.film.title, POTTER.title);
});

test('Gleichstand an der Spitze: Stechen, dann Siegerehrung', () => {
  const e = writeGame({ films: 10 }, { rot: ['a'], blau: ['b'] });
  e.s.settings.films = 1;
  guess(e, 'a', 'Oben');
  e.apply({ type: 'finishRound' }, STAGE);
  e.team('blau').score = e.team('rot').score;
  e.apply({ type: 'next' }, STAGE);
  assert.deepStrictEqual(e.s.tiebreak, ['rot', 'blau']);
  setFilm(e, OBEN);
  guess(e, 'b', 'Oben');
  guess(e, 'a', 'Cars');
  guess(e, 'a', 'Coco');
  guess(e, 'a', 'Soul');
  e.apply({ type: 'next' }, STAGE);
  assert.strictEqual(e.s.phase, 'over');
  assert.deepStrictEqual(e.s.winners, ['blau']);
  assert.ok(e.s.awards.some((a) => a.title === 'Blitzmerker'));
});

test('Spielleitung am Handy darf Hinweise aufdecken und weiterschalten', () => {
  const e = writeGame({}, { rot: ['a'], blau: ['b'] });
  assert.ok(!e.apply({ type: 'hint', at: e.stepKey() }, 'b'));
  assert.ok(e.apply({ type: 'hint', at: e.stepKey() }, 'a'));
  e.apply({ type: 'finishRound' }, STAGE);
  assert.ok(e.apply({ type: 'next', no: 1 }, 'a'));
});

/* ---------- Selbst erklären ---------- */

console.log('Selbst erklären');

function explainGame(teams, now) {
  const e = writeGame({ mode: 'explain' }, teams, now);
  assert.strictEqual(e.s.phase, 'explain');
  return e;
}

test('Nur die erklärende Person sieht den Film, „Kenn ich nicht“ ist begrenzt', () => {
  const e = explainGame({ rot: ['a', 'a2'], blau: ['b'] });
  const ex = e.s.cur.explainer;
  assert.strictEqual(ex, 'a');
  assert.ok(e.viewFor(ex).cur.secret.title);
  for (const viewer of [STAGE, 'a2', 'b']) assert.ok(!e.viewFor(viewer).cur.secret, viewer);
  for (let i = 0; i < MAX_REROLLS; i++) assert.ok(e.apply({ type: 'reroll', at: e.stepKey() }, ex));
  assert.ok(!e.apply({ type: 'reroll', at: e.stepKey() }, ex));
  assert.ok(!e.apply({ type: 'reroll', at: e.stepKey() }, 'b'), 'nur die erklärende Person');
});

test('Nach dem Erklären raten alle anderen – Punkte fürs Erklären pro Team', () => {
  const now = clock();
  const e = explainGame({ rot: ['a', 'a2'], blau: ['b'], gruen: ['c'] }, now);
  setFilm(e, OBEN);
  assert.ok(!e.apply({ type: 'explain', text: 'kurz', at: e.stepKey() }, 'a'), 'zu kurz');
  assert.ok(e.apply({ type: 'explain', text: 'Ein Opa fliegt mit seinem Haus nach Südamerika.', at: e.stepKey() }, 'a'));
  assert.strictEqual(e.s.phase, 'guess');
  assert.deepStrictEqual(e.s.cur.participants.rot, ['a2']);
  assert.strictEqual(e.viewFor('b').cur.text, 'Ein Opa fliegt mit seinem Haus nach Südamerika.');
  assert.ok(!guess(e, 'a', 'Oben'), 'die erklärende Person rät nicht mit');
  now.add(20000);
  guess(e, 'b', 'Oben');
  guess(e, 'a2', 'Oben');
  guess(e, 'c', 'Cars');
  guess(e, 'c', 'Coco');
  guess(e, 'c', 'Soul');
  assert.strictEqual(e.s.phase, 'reveal');
  // rot: 4 (a2) + 1 Punkt fürs Erklären (blau hat es) · blau: 4 + 1 Bonus
  assert.strictEqual(e.s.cur.results.rot.explain, 1);
  assert.strictEqual(score(e, 'rot'), 5);
  assert.strictEqual(score(e, 'blau'), 5);
});

test('Zu leicht erklärt (alle sofort richtig) gibt 0 Punkte', () => {
  const now = clock();
  const e = explainGame({ rot: ['a'], blau: ['b'], gruen: ['c'] }, now);
  setFilm(e, OBEN);
  e.apply({ type: 'explain', text: 'Ein Pixarfilm mit Ballons am Haus.', at: e.stepKey() }, 'a');
  now.add(EASY_MS / 2);
  guess(e, 'b', 'Oben');
  guess(e, 'c', 'Oben');
  assert.strictEqual(e.s.cur.results.rot.explain, 0);
  assert.ok(e.s.cur.tooEasy);
});

test('Erklärende Person geht offline – nach der Schonfrist ist jemand anderes dran', () => {
  const now = clock();
  const e = explainGame({ rot: ['a'], blau: ['b'] }, now);
  e.disconnect('a');
  now.add(GRACE_MS + 10);
  e.tick();
  assert.strictEqual(e.s.phase, 'explain');
  assert.strictEqual(e.s.cur.explainer, 'b');
});

test('Selbst erklären reihum über die Teams', () => {
  const e = explainGame({ rot: ['a', 'a2'], blau: ['b'] });
  const order = [];
  for (let i = 0; i < 4; i++) {
    order.push(e.s.cur.explainer);
    e.apply({ type: 'explain', text: 'Irgendein Film mit irgendwas.', at: e.stepKey() }, e.s.cur.explainer);
    e.apply({ type: 'finishRound' }, STAGE);
    e.apply({ type: 'next' }, STAGE);
  }
  assert.deepStrictEqual(order, ['a', 'b', 'a2', 'a']);
});

test('Selbst erklären braucht Handys und mindestens zwei Personen', () => {
  assert.strictEqual(sanitizeSettings({ input: 'say', mode: 'explain' }).mode, 'db');
  const state = Engine.create({ settings: { input: 'write', mode: 'explain' }, teams: [{ id: 'rot', active: true }] });
  const e = new Engine(state, { timers: false });
  e.connect('a', 'A');
  e.apply({ type: 'joinTeam', team: 'rot' }, 'a');
  assert.ok(e.lobbyProblem());
  assert.ok(!e.apply({ type: 'start' }, STAGE));
});

/* ---------- Ein Gerät ---------- */

console.log('Ein Gerät');

test('Hinweise, Auflösen, dann antippen, wer es hatte', () => {
  const e = sayGame({}, ['rot', 'blau']);
  assert.ok(e.apply({ type: 'hint' }, STAGE));
  assert.ok(e.apply({ type: 'reveal' }, STAGE));
  assert.strictEqual(e.s.phase, 'reveal');
  assert.ok(e.apply({ type: 'had', team: 'blau' }, STAGE));
  assert.strictEqual(score(e, 'blau'), 3);
  assert.ok(e.apply({ type: 'had', team: 'blau' }, STAGE));
  assert.strictEqual(score(e, 'blau'), 0);
  assert.ok(!e.apply({ type: 'guess', text: 'Oben' }, 'x'));
  assert.ok(e.apply({ type: 'next' }, STAGE));
  assert.strictEqual(e.s.round, 2);
});

test('Jeder für sich mit Namen, Auswahl gibt 2 Punkte', () => {
  const state = Engine.create({ settings: { input: 'say', solo: true, answer: 'choice' }, players: ['Anna', 'Ben'] });
  const e = new Engine(state, { timers: false });
  assert.deepStrictEqual(
    e.s.order.map((id) => e.team(id).name),
    ['Anna', 'Ben']
  );
  e.apply({ type: 'reveal' }, STAGE);
  e.apply({ type: 'had', team: e.s.order[0] }, STAGE);
  assert.strictEqual(e.team(e.s.order[0]).score, 2);
});

console.log(`\n${passed} Tests bestanden.`);
