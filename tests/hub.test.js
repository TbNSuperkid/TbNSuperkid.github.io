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
const ICON = /^<svg class="ico" aria-hidden="true"><use href="#i-([a-z-]+)"\/><\/svg> /;
const iconOf = (li) => (li.match(ICON) || [])[1];
const text = (li) => li.replace(/<svg[\s\S]*?<\/svg>\s*/g, '').trim();

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

test('Tags: Personen zuerst, dann festes Geräte-Vokabular, Icons für Screenreader versteckt', () => {
  for (const c of cards) {
    assert.ok(c.tags.length >= 2 && c.tags.length <= 4, c.href + ': ' + c.tags.length + ' Tags');
    assert.ok(['user', 'users'].includes(iconOf(c.tags[0])), `${c.href}: erstes Tag braucht #i-user oder #i-users`);
    const setup = text(c.tags[1]);
    assert.ok(SETUP.includes(setup), `${c.href}: „${setup}“`);
    assert.strictEqual(iconOf(c.tags[1]), setup.startsWith('Laptop') ? 'laptop' : 'phone', `${c.href}: Geräte-Icon`);
    for (const li of c.tags) {
      assert.match(li, ICON, `${c.href}: ${li}`);
      assert.match(text(li), /^[A-ZÄÖÜ0-9]/, `${c.href}: Tag beginnt groß – ${text(li)}`);
    }
  }
});

test('Icons: jedes benutzte Icon steht im Sprite und gleicht shared/icons.js', () => {
  const Icons = require(path.join(ROOT, 'shared', 'icons.js'));
  const symbols = new Map([...html.matchAll(/<symbol id="i-([a-z-]+)"[\s\S]*?<\/symbol>/g)].map((m) => [m[1], m[0]]));
  const used = new Set([...html.matchAll(/<use href="#i-([a-z-]+)"\/>/g)].map((m) => m[1]));
  assert.ok(used.size > 20);
  for (const name of used) {
    assert.ok(symbols.has(name), 'fehlt im Sprite: ' + name);
    assert.strictEqual(symbols.get(name), Icons.symbol(name), 'Sprite veraltet (neu aus shared/icons.js erzeugen): ' + name);
  }
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(html.replace(/<script>[\s\S]*?<\/script>/g, '')), 'Emoji in der Spieleauswahl');
});

test('Kategorien: jede Karte steht in genau einer Kategorie mit Akzentfarbe und Icon', () => {
  const sections = [...html.matchAll(/<section class="cat" aria-labelledby="(c-[a-z]+)">([\s\S]*?)<\/section>/g)];
  assert.ok(sections.length >= 4, 'zu wenige Kategorien');
  const inSections = sections.flatMap(([, , body]) => [...body.matchAll(/<a class="game" href="([^"]+)"/g)].map((m) => m[1]));
  assert.deepStrictEqual(inSections.slice().sort(), cards.map((c) => c.href).sort());
  for (const [, id, body] of sections) {
    assert.ok(html.includes(`<h2 id="${id}">`), id);
    const n = (body.match(/<a class="game"/g) || []).length;
    assert.ok(body.includes(`<span class="cat-count" aria-hidden="true">${n}</span>`), `${id}: Anzahl ${n}`);
  }
  for (const [, tag, body] of html.matchAll(/<a class="game"([^>]*)>([\s\S]*?)<\/a>/g)) {
    assert.match(tag, /style="--c: #[0-9a-f]{6}"/, attr(tag, 'href'));
    assert.match(body, /<span class="game-icon"><svg class="ico" aria-hidden="true"><use href="#i-[a-z-]+"\/><\/svg><\/span>/, attr(tag, 'href'));
  }
});

test('Zugänglicher Name: Titel als Label, Text und Tags als Beschreibung', () => {
  for (const c of cards) {
    assert.ok(html.includes(`<h3 id="${c.labelledby}">`), c.href);
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

test('Node-Server liefert alles aus, was sw.js vorab speichert', () => {
  const server = read('server/server.js');
  const files = JSON.parse(server.match(/PUBLIC_FILES = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  const dirs = JSON.parse(server.match(/PUBLIC_DIRS = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  const assets = [...sw.matchAll(/'([^']+\.[a-z0-9]+)'/g)].map((m) => '/' + m[1].replace(/^\.\//, ''));
  for (const a of assets) assert.ok(files.includes(a) || dirs.some((d) => a.startsWith(d)), 'Server liefert nicht aus: ' + a);
});

console.log(`\nSpieleauswahl: ${passed} Tests bestanden.`);
