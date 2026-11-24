'use strict';
/* Tests für die Spieleauswahl (ohne Browser, ohne Ton): node tests/hub.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('index.html').replace(/<!--[\s\S]*?-->/g, ''); // ohne Kommentare (dort steht ein Beispiel-<a>)
const sw = read('sw.js');
const readme = read('README.md');

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

const attr = (tag, name) => (tag.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];
const cards = [...html.matchAll(/<a class="game"([^>]*)>([\s\S]*?)<\/a>/g)].map(([, tag, body]) => ({
  href: attr(tag, 'href'),
  features: attr(tag, 'data-features'),
  min: Number(attr(tag, 'data-min')),
  max: Number(attr(tag, 'data-max')),
  labelledby: attr(tag, 'aria-labelledby'),
  describedby: attr(tag, 'aria-describedby'),
  desc: (body.match(/<p id="d-[^"]*">([\s\S]*?)<\/p>/) || [])[1] || '',
  tags: [...body.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]),
}));

const SETUP = ['Ein Gerät', 'Ein Gerät oder Handys', 'Laptop, Handys optional', 'Laptop + Handys'];
const FEATURES = ['one', 'music', 'drink'];
const text = (li) => li.replace(/<span aria-hidden="true">[^<]*<\/span>\s*/g, '').trim();

console.log('Spieleauswahl');

test('jedes Spiel aus der README hat genau eine Karte, jede Karte einen Ordner', () => {
  const folders = [...readme.matchAll(/\|\s*`([a-z0-9-]+)\/`\s*\|/g)].map((m) => m[1] + '/');
  assert.ok(folders.length >= 20);
  assert.deepStrictEqual(cards.map((c) => c.href).sort(), [...folders].sort());
  for (const c of cards) assert.ok(fs.existsSync(path.join(ROOT, c.href, 'index.html')), c.href);
});

test('Filterdaten: Personenzahl und Merkmale', () => {
  for (const c of cards) {
    assert.ok(c.min >= 1 && c.min <= c.max && c.max <= 20, `${c.href} ${c.min}–${c.max}`);
    assert.ok(typeof c.features === 'string', c.href + ' ohne data-features');
    for (const f of c.features.split(' ').filter(Boolean)) assert.ok(FEATURES.includes(f), `${c.href}: ${f}`);
  }
  // Wer „Ein Gerät“ sagt, muss auch mit einem Gerät gehen – und umgekehrt
  for (const c of cards) {
    const one = c.features.split(' ').includes('one');
    const setup = text(c.tags[1]);
    assert.strictEqual(one, setup !== 'Laptop + Handys', `${c.href}: ${setup} / one=${one}`);
  }
});

test('Tags: Personen zuerst, dann festes Geräte-Vokabular, Emojis für Screenreader versteckt', () => {
  for (const c of cards) {
    assert.ok(c.tags.length >= 2 && c.tags.length <= 4, c.href + ': ' + c.tags.length + ' Tags');
    assert.match(c.tags[0], /^<span aria-hidden="true">(👤|👥)<\/span> /, c.href);
    assert.ok(SETUP.includes(text(c.tags[1])), `${c.href}: „${text(c.tags[1])}“`);
    for (const li of c.tags) {
      assert.match(li, /^<span aria-hidden="true">[^<]+<\/span> \S/, `${c.href}: ${li}`);
      assert.match(text(li), /^[A-ZÄÖÜ0-9]/, `${c.href}: Tag beginnt groß – ${text(li)}`);
    }
  }
});

test('Zugänglicher Name: Titel als Label, Text und Tags als Beschreibung', () => {
  for (const c of cards) {
    assert.ok(html.includes(`<h2 id="${c.labelledby}">`), c.href);
    for (const id of c.describedby.split(' ')) assert.ok(html.includes(`id="${id}"`), `${c.href}: ${id}`);
  }
});

test('Trinkspiele stehen am Ende', () => {
  const drink = cards.map((c, i) => (c.desc.startsWith('Das Trinkspiel') ? i : -1)).filter((i) => i >= 0);
  assert.deepStrictEqual(drink, [cards.length - 2, cards.length - 1]);
});

test('sw.js cacht Skript und Icons, alle Dateien existieren', () => {
  for (const f of ['hub.js', 'hub.css', 'icons/icon-180.png', 'icons/icon-512.png']) {
    assert.ok(sw.includes(`'${f}'`), 'sw.js: ' + f);
    assert.ok(fs.existsSync(path.join(ROOT, f)), 'fehlt: ' + f);
  }
  const manifest = JSON.parse(read('manifest.webmanifest'));
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(ROOT, icon.src)), icon.src);
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
});

console.log(`\nSpieleauswahl: ${passed} Tests bestanden.`);
