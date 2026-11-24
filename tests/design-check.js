'use strict';
/*
 * Gemeinsame Prüfung für Spiele im neuen Design (siehe DESIGN.md → „Ein Spiel umstellen“):
 *  - nur Icons, die es in shared/icons.js gibt, und keine Emojis mehr in der Oberfläche
 *  - shared/ui.css vor css/style.css, shared/icons.js und shared/ui.js vor js/app.js, alles im Service Worker
 *  - style.css ohne alte Schriften, Akzentfarbe wie auf der Karte in der Spieleauswahl
 *
 *   checkDesign(assert, 'who-knows-more', { files: ['js/app.js', 'js/editor.js'], cats: ['…'] })
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Icons = require(path.join(ROOT, 'shared', 'icons.js'));

/** Alle Icon-Namen, die im Code vorkommen (direkt, per Bedingung oder über Tabellen) */
function usedIcons(src) {
  const used = [...src.matchAll(/\bI\(\s*'([a-z-]+)'/g)].map((m) => m[1]);
  const parts = [...src.matchAll(/\bI\(([^()]*\?[^()]*)\)/g)].map((m) => m[1]);
  parts.push(...[...src.matchAll(/[A-Z_]+_ICON = \{[^}]*\}/g)].map((m) => m[0].replace(/'[^']*':/g, '')));
  parts.push(...[...src.matchAll(/REPORT_REASONS = \{[^}]*\}/g)].map((m) => m[0].replace(/'[^']*':/g, '')));
  for (const m of src.matchAll(/\bicon: '([a-z-]+)'/g)) used.push(m[1]);
  // Bausteine aus shared/ui.js: UI.menuItem('act', 'icon', …), UI.logo('Name', 'icon', …)
  for (const m of src.matchAll(/UI\.menuItem\('[\w-]+', '([a-z-]+)'/g)) used.push(m[1]);
  for (const m of src.matchAll(/UI\.logo\((?:'[^']*'|"[^"]*"), '([a-z-]+)'/g)) used.push(m[1]);
  for (const part of parts) for (const m of part.matchAll(/'([a-z-]+)'/g)) used.push(m[1]);
  return used;
}

/** Emojis und Symbolzeichen, die durch Icons ersetzt sein sollten (Kommentare und *_ICON-Tabellen ausgenommen) */
function emojiLines(src) {
  const bad = /[\p{Extended_Pictographic}✓✗✕☰＋▶⏩⏭⏹]/u;
  return src
    .split(/\r?\n/)
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line) && !/_ICON = \{/.test(line) && bad.test(line));
}

function checkDesign(assert, game, opts) {
  const o = opts || {};
  const dir = path.join(ROOT, game);
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

  // Icons
  const files = o.files || ['js/app.js'];
  const used = [];
  for (const f of files) {
    const src = read(f);
    used.push(...usedIcons(src));
    const left = emojiLines(src);
    assert.ok(!left.length, `${game}/${f}: noch Emojis in der Oberfläche:\n` + left.map((x) => `    ${x.no}: ${x.line.trim().slice(0, 100)}`).join('\n'));
  }
  assert.ok(new Set(used).size >= (o.minIcons || 25), 'zu wenige Icons gefunden: ' + new Set(used).size);
  for (const name of used) assert.ok(Icons.has(name), `${game}: Icon fehlt in shared/icons.js: ${name}`);
  if (o.cats) {
    const table = read('js/app.js').match(/CAT_ICON = \{[^}]*\}/);
    assert.ok(table, 'CAT_ICON fehlt');
    for (const id of o.cats) assert.ok(new RegExp(`\\b${id}: '`).test(table[0]), 'Kategorie ohne Icon: ' + id);
  }

  // Einbinden
  const html = read('index.html');
  const ui = html.indexOf('../shared/ui.css');
  assert.ok(ui > 0 && ui < html.indexOf('css/style.css'), 'ui.css vor style.css laden');
  const icons = html.indexOf('../shared/icons.js');
  assert.ok(icons > 0 && icons < html.indexOf('js/app.js'), 'icons.js vor app.js laden');
  const uiJs = html.indexOf('../shared/ui.js');
  assert.ok(uiJs > icons && uiJs < html.indexOf('js/app.js'), 'ui.js nach icons.js und vor app.js laden');
  assert.ok(html.includes('name="theme-color" content="#0e0c16"'), 'theme-color #0e0c16');
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.strictEqual(manifest.theme_color, '#0e0c16');
  assert.strictEqual(manifest.background_color, '#0e0c16');

  // Service Worker
  const sw = read('sw.js');
  for (const f of ['../shared/ui.css', '../shared/icons.js', '../shared/ui.js', '../vendor/fonts/inter.woff2']) {
    assert.ok(sw.includes(`'${f}'`), 'sw.js: ' + f);
    assert.ok(fs.existsSync(path.join(dir, f)), 'fehlt: ' + f);
  }
  for (const f of ['fredoka.woff2', 'nunito.woff2']) assert.ok(!sw.includes(f), 'sw.js lädt noch ' + f);

  // Eigenes CSS: nur Spielspezifisches, Akzent wie in der Spieleauswahl
  const css = read('css/style.css');
  assert.ok(!/@font-face|Fredoka|Nunito/.test(css), 'style.css: alte Schriften entfernen');
  const accent = (css.match(/--accent:\s*(#[0-9a-f]{6})/i) || [])[1];
  const hub = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const card = (hub.match(new RegExp(`href="${game}/" style="--c: (#[0-9a-f]{6})"`, 'i')) || [])[1];
  assert.ok(accent && card, 'Akzentfarbe nicht gefunden');
  assert.strictEqual(accent.toLowerCase(), card.toLowerCase(), 'Akzentfarbe weicht von der Spieleauswahl ab');
}

module.exports = { checkDesign, usedIcons, emojiLines };
