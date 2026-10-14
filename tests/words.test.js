'use strict';
/*
 * Prüft die Begriffslisten:
 *  - je Kategorie 333 Begriffe (111 pro Schwierigkeit)
 *  - 200 Begriffe ab 18 (67 / 67 / 66)
 *  - Erklären- und 18+-Begriffe haben genau 3 Tabuwörter
 *  - keine doppelten Begriffe (über alle Listen hinweg)
 *  - kein Tabuwort wiederholt den Begriff selbst
 */
const assert = require('assert');
const path = require('path');

globalThis.window = globalThis;
for (const f of ['erklaeren', 'zeichnen', 'pantomime', 'adult']) {
  require(path.join(__dirname, '..', 'guess-the-word', 'js', 'words', f + '.js'));
}
require(path.join(__dirname, '..', 'guess-the-word', 'js', 'deck.js'));

const W = globalThis.ACTIVITY_WORDS;
const Deck = globalThis.ActivityDeck;
const DIFFS = ['leicht', 'mittel', 'schwer'];

const problems = [];
const seen = new Map();

function check(listName, diff, text, needTaboo, expected) {
  const entries = Deck._parseList(text, false);
  if (entries.length !== expected) problems.push(`${listName}/${diff}: ${entries.length} statt ${expected} Begriffe`);
  for (const e of entries) {
    const where = `${listName}/${diff}: "${e.term}"`;
    if (seen.has(e.key)) problems.push(`Doppelt: ${where} und ${seen.get(e.key)}`);
    seen.set(e.key, `${listName}/${diff}`);
    if (needTaboo) {
      if (e.taboo.length !== 3 || e.taboo.some((t) => !t)) problems.push(`${where} braucht genau 3 Tabuwörter`);
      const lower = e.taboo.map((t) => t.toLowerCase());
      if (new Set(lower).size !== lower.length) problems.push(`${where} hat doppelte Tabuwörter`);
      if (lower.includes(e.key)) problems.push(`${where} hat sich selbst als Tabuwort`);
    } else if (e.taboo.length) {
      problems.push(`${where} sollte keine Tabuwörter haben`);
    }
    if (e.term.length > 40) problems.push(`${where} ist sehr lang`);
  }
  return entries.length;
}

let total = 0;
for (const cat of ['erklaeren', 'zeichnen', 'pantomime']) {
  let catTotal = 0;
  for (const diff of DIFFS) catTotal += check(cat, diff, W[cat][diff], cat === 'erklaeren', 111);
  if (catTotal !== 333) problems.push(`${cat}: ${catTotal} statt 333 Begriffe`);
  total += catTotal;
}
const adultExpected = { leicht: 67, mittel: 67, schwer: 66 };
let adultTotal = 0;
for (const diff of DIFFS) adultTotal += check('adult', diff, W.adult[diff], true, adultExpected[diff]);
if (adultTotal !== 200) problems.push(`18+: ${adultTotal} statt 200 Begriffe`);

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} Problem(e) gefunden.`);
  process.exit(1);
}

const stats = Deck.stats();
assert.strictEqual(stats.total, 999);
assert.strictEqual(stats.adult, 200);
console.log(`✓ Begriffe ok: ${total} normale + ${adultTotal} ab 18`);
