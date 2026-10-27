'use strict';
/*
 * Stufen für „Wortbombe“ ehrlich bestimmen: Für jede Silbe / jeden Anfang / jedes Ende zählen, wie viele Wörter
 * einer freien deutschen Wortliste passen. Viele Wörter = leicht, wenige = schwer.
 *
 *   node scripts/wortbombe-stufen.js <wortliste.txt> [--dry]
 *
 * Die Wortliste (ein Wort pro Zeile) kommt NICHT ins Repo und nicht ins Spiel – sie wird nur zum Zählen gebraucht.
 * Benutzt wurde https://github.com/davidak/wortliste (≈ 240 000 Wörter aus DWDS, Leipzig Corpora, DeReWo).
 * Das Skript schreibt die Stufen direkt in wortbombe/js/inhalte/silben.js und anfang-ende.js
 * (mit --dry nur anzeigen) und warnt bei Einträgen, die zu wenige Wörter haben.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'wortbombe', 'js', 'inhalte');

// Ab so vielen passenden Wörtern (Anteil an der ganzen Liste) gilt ein Eintrag als leicht bzw. mittel.
// Anfang/Ende ist strenger als „enthält“, deshalb eigene Grenzen.
const LIMITS = {
  silbe: { leicht: 0.02, mittel: 0.004, min: 0.0003 },
  anfang: { leicht: 0.008, mittel: 0.0025, min: 0.0002 },
  ende: { leicht: 0.008, mittel: 0.002, min: 0.0002 },
};

function load(file) {
  globalThis.window = globalThis;
  delete require.cache[require.resolve(file)];
  require(file);
}

function stufe(share, lim) {
  if (share >= lim.leicht) return 1;
  if (share >= lim.mittel) return 2;
  return 3;
}

function grade(entries, words, kind, test) {
  const lim = LIMITS[kind];
  return entries.map(([s, old]) => {
    let hits = 0;
    for (const w of words) if (test(w, s)) hits++;
    const share = hits / words.length;
    return { s, old, hits, share, stufe: stufe(share, lim), rare: share < lim.min };
  });
}

/** In der Quelldatei die Stufe jedes Eintrags ersetzen – nur im angegebenen Abschnitt (anfang/ende) */
function rewrite(src, rows, section) {
  let start = 0;
  let end = src.length;
  if (section) {
    start = src.indexOf(section + ': [');
    end = src.indexOf('\n    ],', start); // schließende Klammer des Abschnitts
    if (start < 0 || end < 0) throw new Error('Abschnitt nicht gefunden: ' + section);
  }
  let part = src.slice(start, end);
  for (const r of rows) {
    const re = new RegExp(`\\['${r.s}', \\d\\]`);
    if (!re.test(part)) throw new Error('Eintrag nicht gefunden: ' + r.s);
    part = part.replace(re, `['${r.s}', ${r.stufe}]`);
  }
  return src.slice(0, start) + part + src.slice(end);
}

function report(title, rows) {
  const n = [0, 0, 0, 0];
  rows.forEach((r) => n[r.stufe]++);
  console.log(`\n${title}: ${rows.length} Einträge – leicht ${n[1]}, mittel ${n[2]}, schwer ${n[3]}`);
  const sorted = rows.slice().sort((a, b) => b.hits - a.hits);
  for (const r of sorted) {
    const mark = r.old !== r.stufe ? ` (vorher ${r.old})` : '';
    const warn = r.rare ? '  ⚠ sehr wenige Wörter' : '';
    console.log(`  ${r.s.padEnd(8)} ${String(r.hits).padStart(6)}  Stufe ${r.stufe}${mark}${warn}`);
  }
}

function main() {
  const listFile = process.argv[2];
  const dry = process.argv.includes('--dry');
  if (!listFile || !fs.existsSync(listFile)) {
    console.error('Aufruf: node scripts/wortbombe-stufen.js <wortliste.txt> [--dry]');
    process.exit(1);
  }
  const words = [
    ...new Set(
      fs
        .readFileSync(listFile, 'utf8')
        .split(/\r?\n/)
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length >= 2 && /^[a-zäöüß-]+$/.test(w))
    ),
  ];
  console.log(`Wortliste: ${words.length} Wörter`);

  const silbenFile = path.join(DIR, 'silben.js');
  const aeFile = path.join(DIR, 'anfang-ende.js');
  load(silbenFile);
  load(aeFile);

  const silben = grade(globalThis.WBSilben, words, 'silbe', (w, s) => w.includes(s));
  const anfang = grade(globalThis.WBAnfangEnde.anfang, words, 'anfang', (w, s) => w.startsWith(s));
  const ende = grade(globalThis.WBAnfangEnde.ende, words, 'ende', (w, s) => w.endsWith(s));
  report('Silben (enthält)', silben);
  report('Anfang', anfang);
  report('Ende', ende);

  if (dry) return;
  fs.writeFileSync(silbenFile, rewrite(fs.readFileSync(silbenFile, 'utf8'), silben));
  let ae = fs.readFileSync(aeFile, 'utf8');
  ae = rewrite(ae, anfang, 'anfang');
  ae = rewrite(ae, ende, 'ende');
  fs.writeFileSync(aeFile, ae);
  console.log('\nStufen geschrieben.');
}

main();
